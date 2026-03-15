import os
from decimal import Decimal
from django.db import transaction
from django.db import connection
from django.db.models import Q
from django.utils import timezone
from apps.production.models import (
    ProductionJob,
    FinishedGoodsBatch,
    PackingUnit,
    DeliveryChallan,
    DeliveryChallanItem,
    RollDispatchPackRecord,
)
from apps.inventory.models import InventoryRoll, InventoryLocation, InventoryMaterial


class FGDispatchService:
    """
    Service for managing Finished Goods dispatch readiness.
    """

    @staticmethod
    def _packed_roll_map(roll_ids: list[str]) -> dict[str, bool]:
        if not roll_ids:
            return {}
        packed_ids = {
            str(v)
            for v in RollDispatchPackRecord.objects.filter(roll_id__in=roll_ids).values_list("roll_id", flat=True)
        }
        return {str(roll_id): (str(roll_id) in packed_ids) for roll_id in roll_ids}
    
    @staticmethod
    def get_dispatchable_units(
        fg_batch_id: str = None,
        job_id: str = None,
        template_id: str = None,
        plant_id: str = None,
    ):
        """
        Returns dispatchable units for a given FG batch, Job, or Template.
        
        For ROLL FG:
            - Returns list of InventoryRoll with is_fg=True, status=AVAILABLE
            - Ready for immediate dispatch
            
        For POUCH FG:
            - Returns FinishedGoodsBatch records
            - May require packing into gonnies before dispatch
        """
        result = {
            'roll_units': [],
            'batch_units': [],
            'summary': {
                'total_rolls': 0,
                'total_batches': 0,
                'total_kg': 0,
                'total_pcs': 0,
            }
        }
        
        # Query FG Rolls
        roll_qs = InventoryRoll.objects.filter(
            is_fg=True,
            status='AVAILABLE',
            sales_order_item__isnull=False,
        ).select_related('material', 'location', 'production_job')
        roll_qs = roll_qs.filter(
            Q(meta_json__is_internal_stock=False) | Q(meta_json__is_internal_stock__isnull=True)
        )
        
        if job_id:
            roll_qs = roll_qs.filter(production_job_id=job_id)
        
        if template_id:
            roll_qs = roll_qs.filter(production_job__template_id=template_id)

        if plant_id:
            roll_qs = roll_qs.filter(location__plant_id=plant_id)
        
        roll_units = list(roll_qs.values(
            'id', 'label_id', 'batch_no', 'weight_kg', 'width_mm',
            'material__name', 'location__name', 'production_job__job_number'
        ))
        
        result['roll_units'] = roll_units
        result['summary']['total_rolls'] = len(roll_units)
        result['summary']['total_kg'] = sum(float(r['weight_kg']) for r in roll_units)
        
        # Query FG Batches
        batch_qs = FinishedGoodsBatch.objects.filter(
            status='AVAILABLE',
            sales_order_item__isnull=False,
        ).select_related('template', 'location', 'production_job')
        batch_qs = batch_qs.filter(
            Q(meta_json__is_internal_stock=False) | Q(meta_json__is_internal_stock__isnull=True)
        )
        
        if fg_batch_id:
            batch_qs = batch_qs.filter(id=fg_batch_id)
        
        if job_id:
            batch_qs = batch_qs.filter(production_job_id=job_id)
        
        if template_id:
            batch_qs = batch_qs.filter(template_id=template_id)

        if plant_id:
            batch_qs = batch_qs.filter(location__plant_id=plant_id)
        
        batch_units = list(batch_qs.values(
            'id', 'batch_number', 'qty_pcs', 'qty_kg',
            'template__name', 'location__name', 'production_job__job_number', 'status'
        ))
        
        result['batch_units'] = batch_units
        result['summary']['total_batches'] = len(batch_units)
        result['summary']['total_pcs'] = sum(b['qty_pcs'] for b in batch_units)
        
        return result
    
    @staticmethod
    def get_fg_for_sales_order(sales_order_id: str):
        """
        Returns all dispatchable FG units for a given Sales Order.
        Useful for dispatch planning.
        """
        # Get all jobs for this SO
        jobs = ProductionJob.objects.filter(
            sales_order_item__sales_order_id=sales_order_id,
            job_state='COMPLETED'
        ).values_list('id', flat=True)
        
        all_rolls = []
        all_batches = []
        
        for job_id in jobs:
            result = FGDispatchService.get_dispatchable_units(job_id=str(job_id))
            all_rolls.extend(result['roll_units'])
            all_batches.extend(result['batch_units'])
        
        return {
            'roll_units': all_rolls,
            'batch_units': all_batches,
            'summary': {
                'total_rolls': len(all_rolls),
                'total_batches': len(all_batches),
                'total_kg': sum(float(r['weight_kg']) for r in all_rolls),
                'total_pcs': sum(b['qty_pcs'] for b in all_batches),
            }
        }
    
    @staticmethod
    def get_sales_orders_with_fg():
        """
        Returns SalesOrders that have available dispatchable goods:
        - FG rolls
        - available FG batches (remaining qty > 0)
        - OPEN/SEALED gonnies (packing in-progress + ready)
        """
        from apps.sales.models import SalesOrder
        # SOs with available FG Rolls
        so_ids_with_rolls = InventoryRoll.objects.filter(
            is_fg=True,
            status='AVAILABLE',
            sales_order_item__isnull=False,
        ).filter(
            Q(meta_json__is_internal_stock=False) | Q(meta_json__is_internal_stock__isnull=True)
        ).values_list('sales_order_item__sales_order_id', flat=True)

        # SOs with available FG batches
        so_ids_with_batches = FinishedGoodsBatch.objects.filter(
            qty_pcs__gt=0,
            status__in=['AVAILABLE', 'PACKED'],
            sales_order_item__isnull=False,
        ).filter(
            Q(meta_json__is_internal_stock=False) | Q(meta_json__is_internal_stock__isnull=True)
        ).values_list('sales_order_item__sales_order_id', flat=True)

        # SOs with packing units (OPEN => pending seal, SEALED => dispatch-ready)
        so_ids_with_gonnies = PackingUnit.objects.filter(
            status__in=['OPEN', 'SEALED'],
            sales_order_item__isnull=False,
        ).values_list('sales_order_item__sales_order_id', flat=True)

        combined_so_ids = set(list(so_ids_with_rolls) + list(so_ids_with_batches) + list(so_ids_with_gonnies))
        
        # Filter out None/Null (if any legacy data exists)
        combined_so_ids = [sid for sid in combined_so_ids if sid]

        return (
            SalesOrder.objects
            .filter(id__in=combined_so_ids)
            .order_by('-created_at')
            .values('id', 'order_number', 'customer_name', 'status')
        )

    @staticmethod
    def get_aggregated_dispatch_summary(plant_id: str = None) -> dict:
        """
        Aggregated view for a plant/warehouse to show total dispatchable inventory.
        """
        from apps.factory.models import Plant
        plants = Plant.objects.all()
        if plant_id:
            plants = plants.filter(id=plant_id)
        
        all_rolls = []
        all_batches = []
        
        for p in plants:
            result = FGDispatchService.get_dispatchable_units(plant_id=str(p.id))
            all_rolls.extend(result['roll_units'])
            all_batches.extend(result['batch_units'])
        
        return {
            'roll_units': all_rolls,
            'batch_units': all_batches,
            'summary': {
                'total_rolls': len(all_rolls),
                'total_batches': len(all_batches),
                'total_kg': sum(float(r['weight_kg']) for r in all_rolls),
                'total_pcs': sum(b['qty_pcs'] for b in all_batches),
            }
        }
    
    @staticmethod
    def get_dispatchable_units_by_so(so_id: str) -> dict:
        """
        Returns dispatchable units for a Sales Order with complete quantity summary.
        This is the primary method for SO-driven dispatch.
        
        Returns:
            {
                'sales_order': {...},
                'ordered_qty': X,
                'produced_qty': X,
                'packed_qty': X,
                'dispatched_qty': X,
                'balance_qty': X,
                'rolls': [...],
                'gonnies': [...]
            }
        """
        from apps.sales.models import SalesOrderItem
        from django.db.models import Sum
        
        so = FGDispatchService._sales_order_row(so_id)
        if not so:
            raise ValueError(f"Sales Order {so_id} not found")
        
        # Get all SO items
        so_items = SalesOrderItem.objects.filter(sales_order_id=so_id)
        so_item_ids = list(so_items.values_list('id', flat=True))
        
        # Calculate ordered quantity (sum of all SO item quantities)
        ordered_qty = so_items.aggregate(total=Sum('qty_value'))['total'] or Decimal('0')
        
        # Get all FG Rolls linked to this SO
        all_rolls = InventoryRoll.objects.filter(
            is_fg=True,
            sales_order_item__in=so_item_ids
        ).select_related('material', 'location', 'production_job', 'sales_order_item')
        all_rolls = all_rolls.filter(
            Q(meta_json__is_internal_stock=False) | Q(meta_json__is_internal_stock__isnull=True)
        )
        
        # Get all FG Batches linked to this SO
        all_batches = FinishedGoodsBatch.objects.filter(
            sales_order_item__in=so_item_ids
        ).select_related('template', 'location', 'production_job', 'sales_order_item')
        all_batches = all_batches.filter(
            Q(meta_json__is_internal_stock=False) | Q(meta_json__is_internal_stock__isnull=True)
        )
        
        # Get all Gonnies from those batches
        all_gonnies = PackingUnit.objects.filter(
            fg_batch__sales_order_item__in=so_item_ids
        ).select_related('fg_batch', 'location')
        
        # Calculate quantities
        # Produced = all FG rolls (by weight) + all FG batch pieces (including those already packed)
        produced_rolls_kg = all_rolls.aggregate(total=Sum('weight_kg'))['total'] or Decimal('0')
        
        # Packed = all gonnies (pieces packed)
        packed_pcs = all_gonnies.aggregate(total=Sum('qty_pcs'))['total'] or 0

        # Produced Batches = Current Batch Qty + Packed Qty
        unpacked_batches_pcs = all_batches.aggregate(total=Sum('qty_pcs'))['total'] or 0
        produced_batches_pcs = unpacked_batches_pcs + packed_pcs
        
        # Dispatched = rolls with status IN_TRANSIT/CONSUMED + gonnies with status DISPATCHED
        dispatched_rolls_kg = all_rolls.filter(
            status__in=['IN_TRANSIT', 'CONSUMED']
        ).aggregate(total=Sum('weight_kg'))['total'] or Decimal('0')
        
        dispatched_gonnies_pcs = all_gonnies.filter(
            status='DISPATCHED'
        ).aggregate(total=Sum('qty_pcs'))['total'] or 0
        
        # Available for dispatch
        available_rolls = all_rolls.filter(status='AVAILABLE')
        available_gonnies = all_gonnies.filter(status='SEALED')
        open_gonnies = all_gonnies.filter(status='OPEN')
        unpacked_batches = all_batches.filter(status__in=['AVAILABLE', 'PACKED'], qty_pcs__gt=0)
        
        # Build response
        available_roll_rows = list(all_rolls.filter(status='AVAILABLE'))
        source_stock_ids = {
            str(((getattr(r, "meta_json", None) or {}).get("claimed_from_stock_order_id") or "")).strip()
            for r in available_roll_rows
            if str(((getattr(r, "meta_json", None) or {}).get("claimed_from_stock_order_id") or "")).strip()
        }
        source_remaining_map = {}
        if source_stock_ids:
            source_pool_rolls = (
                InventoryRoll.objects.filter(
                    is_fg=True,
                    status='AVAILABLE',
                    sales_order_item__isnull=True,
                )
                .filter(
                    Q(meta_json__is_internal_stock=False) | Q(meta_json__is_internal_stock__isnull=True)
                )
                .filter(
                    Q(created_by_job__mts_order_id__in=source_stock_ids)
                    | Q(production_job__mts_order_id__in=source_stock_ids)
                )
                .select_related("created_by_job__mts_order", "production_job__mts_order")
            )
            for source_roll in source_pool_rolls:
                source_stock = (
                    getattr(getattr(source_roll, "created_by_job", None), "mts_order", None)
                    or getattr(getattr(source_roll, "production_job", None), "mts_order", None)
                )
                if not source_stock:
                    continue
                source_key = str(source_stock.id)
                source_remaining_map[source_key] = float(source_remaining_map.get(source_key, 0.0)) + float(
                    source_roll.weight_kg or 0
                )
        packed_map = FGDispatchService._packed_roll_map([str(r.id) for r in available_roll_rows])
        roll_units = [{
            'id': str(r.id),
            'sales_order_item_id': str(r.sales_order_item_id) if r.sales_order_item_id else None,
            'label_id': r.label_id,
            'batch_no': r.batch_no or "",
            'weight_kg': float(r.weight_kg),
            'location': {
                'id': str(r.location.id),
                'name': r.location.name,
                'plant_id': str(r.location.plant_id),
                'plant_name': r.location.plant.name
            },
            'packed_for_dispatch': bool(packed_map.get(str(r.id), False)),
            'default_pack_lines': (
                (
                    (
                        (getattr(r.sales_order_item, "packaging_snapshot", {}) or {}).get("roll_dispatch_pack")
                        or {}
                    ).get("lines")
                    or []
                )
                if bool(
                    (
                        (getattr(r.sales_order_item, "packaging_snapshot", {}) or {}).get("roll_dispatch_pack")
                        or {}
                    ).get("enabled", False)
                )
                else []
            ),
            'dispatch_lineage': str(((getattr(r, "meta_json", None) or {}).get("dispatch_mode") or "MTO")).upper(),
            'source_stock_order_id': ((getattr(r, "meta_json", None) or {}).get("claimed_from_stock_order_id")),
            'source_stock_order_no': ((getattr(r, "meta_json", None) or {}).get("claimed_from_stock_order_no")),
            'remaining_stock_pool_kg': float(
                source_remaining_map.get(
                    str(((getattr(r, "meta_json", None) or {}).get("claimed_from_stock_order_id") or "")).strip(),
                    0.0,
                )
            ),
            'split_parent_label': (
                (getattr(r, "meta_json", None) or {}).get("split_parent_label")
            ),
            'job_no': r.production_job.job_number if r.production_job else None
        } for r in available_roll_rows]
        
        gonny_units = [{
            'id': str(g.id),
            'label_id': g.label_id,
            'qty_pcs': g.qty_pcs,
            'content_mode': g.content_mode,
            'primary_pack_count': g.primary_pack_count,
            'weight_kg': float(g.weight_kg or 0),
            'net_product_weight_kg': float(g.net_product_weight_kg or 0),
            'inner_pack_tare_kg': float(g.inner_pack_tare_kg or 0),
            'secondary_pack_tare_kg': float(g.secondary_pack_tare_kg or 0),
            'extras_tare_kg': float(g.extras_tare_kg or 0),
            'gross_weight_kg': float(g.gross_weight_kg or g.weight_kg or 0),
            'location': {
                'id': str(g.location.id),
                'name': g.location.name,
                'plant_id': str(g.location.plant_id),
                'plant_name': g.location.plant.name
            },
            'batch_no': g.fg_batch.batch_number,
            'fg_batch__batch_number': g.fg_batch.batch_number,
        } for g in all_gonnies.filter(status='SEALED')]

        batch_units = [{
            'id': str(b.id),
            'batch_number': b.batch_number,
            'qty_pcs': int(b.qty_pcs or 0),
            'qty_kg': float(b.qty_kg or 0),
            'status': b.status,
            'location': {
                'id': str(b.location.id) if b.location else None,
                'name': b.location.name if b.location else None,
                'plant_id': str(b.location.plant_id) if b.location else None,
                'plant_name': b.location.plant.name if b.location else None,
            },
        } for b in unpacked_batches]
        
        return {
            'sales_order': {
                'id': so['id'],
                'order_number': so['order_number'],
                'customer_name': so['customer_name'],
                'status': so['status'],
            },
            'ordered_qty': float(ordered_qty),
            'produced_qty': {
                'rolls_kg': float(produced_rolls_kg),
                'batches_pcs': produced_batches_pcs,
            },
            'packed_qty': packed_pcs,
            'dispatched_qty': {
                'rolls_kg': float(dispatched_rolls_kg),
                'gonnies_pcs': dispatched_gonnies_pcs,
            },
            'available_for_dispatch': {
                'rolls_count': available_rolls.count(),
                'rolls_kg': float(available_rolls.aggregate(total=Sum('weight_kg'))['total'] or 0),
                'gonnies_count': available_gonnies.count(),
                'gonnies_pcs': available_gonnies.aggregate(total=Sum('qty_pcs'))['total'] or 0,
                'gonnies_net_kg': float(available_gonnies.aggregate(total=Sum('net_product_weight_kg'))['total'] or 0),
                'gonnies_gross_kg': float(available_gonnies.aggregate(total=Sum('gross_weight_kg'))['total'] or 0),
            },
            'packing_pending': {
                'open_gonnies_count': open_gonnies.count(),
                'open_gonnies_pcs': open_gonnies.aggregate(total=Sum('qty_pcs'))['total'] or 0,
                'unpacked_batch_count': unpacked_batches.count(),
                'unpacked_batch_pcs': unpacked_batches.aggregate(total=Sum('qty_pcs'))['total'] or 0,
            },
            'rolls': roll_units,
            'gonnies': gonny_units,
            'batches': batch_units,
        }
    
    @staticmethod
    @transaction.atomic
    def pack_roll(roll_id: str, lines: list | None = None, user=None) -> RollDispatchPackRecord:
        try:
            roll = InventoryRoll.objects.select_related("sales_order_item", "location", "sales_order_item__sales_order").get(id=roll_id)
        except InventoryRoll.DoesNotExist:
            raise ValueError(f"Roll {roll_id} not found")

        if not roll.sales_order_item_id:
            raise ValueError(f"Roll {roll.label_id} has no sales-order lineage and cannot be dispatch-packed.")

        existing = RollDispatchPackRecord.objects.filter(
            roll_id=roll.id,
            sales_order_item_id=roll.sales_order_item_id,
        ).first()
        if existing:
            raise ValueError(f"Roll {roll.label_id} is already packed for dispatch.")

        snapshot = dict(getattr(roll.sales_order_item, "packaging_snapshot", {}) or {})
        roll_pack_cfg = (snapshot or {}).get("roll_dispatch_pack") or {}
        default_lines = (roll_pack_cfg.get("lines") or []) if bool(roll_pack_cfg.get("enabled", False)) else []
        pack_lines = lines if isinstance(lines, list) and len(lines) > 0 else default_lines
        if not pack_lines:
            raise ValueError(
                f"Roll {roll.label_id} has no packaging lines. Configure roll dispatch packaging or submit explicit pack lines."
            )

        tx_ids = []
        consumed_lines = []
        from apps.inventory.services.packaging_service import PackagingService
        so_no = (
            roll.sales_order_item.sales_order.order_number
            if getattr(roll.sales_order_item, "sales_order", None)
            else "N/A"
        )
        reference = f"ROLL_PACK:SO:{so_no} ROLL:{roll.label_id}"
        for idx, line in enumerate(pack_lines):
            if not isinstance(line, dict):
                continue
            material_id = line.get("material_id")
            qty = Decimal(str(line.get("qty") or 0))
            if qty <= 0:
                continue
            if not material_id:
                raise ValueError(f"Pack line {idx + 1}: material_id is required.")
            input_uom = str(line.get("uom") or "").upper() or None
            basis = str(line.get("basis") or "PER_ROLL").upper()
            tx = PackagingService.consume_packaging_stock(
                material_id=material_id,
                qty=qty,
                input_uom=input_uom,
                location_id=roll.location_id,
                sales_order_item_id=roll.sales_order_item_id,
                reference=reference,
                basis=basis,
                roll_id=roll.id,
                meta_json={"roll_id": str(roll.id), "sales_order_item_id": str(roll.sales_order_item_id)},
            )
            tx_ids.append(str(tx.id))
            consumed_lines.append(
                {
                    "material_id": str(material_id),
                    "qty": float(qty),
                    "uom": input_uom or "",
                    "basis": basis,
                    "tx_id": str(tx.id),
                }
            )

        if not consumed_lines:
            raise ValueError(
                f"Roll {roll.label_id} has no valid packaging lines to consume. Provide material_id and qty > 0."
            )

        return RollDispatchPackRecord.objects.create(
            roll=roll,
            sales_order_item_id=roll.sales_order_item_id,
            packed_by=user,
            lines=consumed_lines,
            tx_ids=tx_ids,
            meta_json={
                "defaulted_from_snapshot": not (isinstance(lines, list) and len(lines) > 0),
                "snapshot_enabled": bool(roll_pack_cfg.get("enabled", False)),
            },
        )

    @staticmethod
    @transaction.atomic
    def create_challan(customer_name: str, plant_id: str, sales_order_id: str = None,
                       vehicle_no: str = '', driver_name: str = '', driver_phone: str = '',
                       roll_ids: list = None, gonny_ids: list = None, batch_items: list = None, user=None) -> DeliveryChallan:
        """
        Create a Delivery Challan with selected items.
        
        Args:
            batch_items: List of dicts {'batch_id': UUID, 'qty_pcs': int, 'weight_kg': float}
        """
        from apps.factory.models import Plant

        if not sales_order_id:
            raise ValueError("Sales Order ID is required for strict lineage dispatch")
        if batch_items:
            raise ValueError("Direct FG batch dispatch is not allowed for sales orders. Dispatch sealed gonnies instead.")

        # Generate DC number only after request validation to avoid unnecessary DB work on rejected requests.
        dc_count = DeliveryChallan.objects.count() + 1
        dc_no = f"DC-{timezone.now().strftime('%Y%m%d')}-{dc_count:04d}"

        plant = Plant.objects.get(id=plant_id)
        # Create challan
        challan = DeliveryChallan.objects.create(
            dc_no=dc_no,
            customer_name=customer_name,
            plant=plant,
            sales_order_id=sales_order_id,
            vehicle_no=vehicle_no,
            driver_name=driver_name,
            driver_phone=driver_phone,
            status='DRAFT',
            created_by=user
        )
        
        # Add items
        if roll_ids:
            rolls = InventoryRoll.objects.filter(id__in=roll_ids)
            for roll in rolls:
                # Validation: must belong to same SO
                if not roll.sales_order_item_id or str(roll.sales_order_item.sales_order_id) != str(sales_order_id):
                    raise ValueError(f"Roll {roll.label_id} belongs to a different Sales Order")
                packed_exists = RollDispatchPackRecord.objects.filter(
                    roll_id=roll.id,
                    sales_order_item_id=roll.sales_order_item_id,
                ).exists()
                if not packed_exists:
                    strict_pack = str(os.getenv("STRICT_DISPATCH_PACKING", "False")).strip().lower() == "true"
                    if strict_pack:
                        raise ValueError(f"Roll {roll.label_id} is not packed. Pack it before creating challan.")
                    try:
                        FGDispatchService.pack_roll(str(roll.id), user=user)
                    except Exception:
                        # Backward-compatible mode: challan can still be created when
                        # dispatch-pack snapshots are unavailable.
                        pass
                
                DeliveryChallanItem.objects.create(
                    challan=challan,
                    sales_order_item=roll.sales_order_item,
                    roll=roll,
                    weight_kg=roll.weight_kg,
                    qty_pcs=None
                )
        
        if gonny_ids:
            gonnies = PackingUnit.objects.filter(id__in=gonny_ids)
            for gonny in gonnies:
                if not gonny.sales_order_item_id or str(gonny.sales_order_item.sales_order_id) != str(sales_order_id):
                    raise ValueError(f"Gonny {gonny.label_id} belongs to a different Sales Order")
                if gonny.status != 'SEALED':
                    raise ValueError(f"Gonny {gonny.label_id} must be sealed before dispatch.")
                if gonny.weight_kg is None:
                    raise ValueError(f"Gonny {gonny.label_id} is missing sealed weight.")
                
                DeliveryChallanItem.objects.create(
                    challan=challan,
                    sales_order_item=gonny.sales_order_item,
                    packing_unit=gonny,
                    weight_kg=gonny.weight_kg,
                    qty_pcs=gonny.qty_pcs
                )
        
        return challan
    
    @staticmethod
    @transaction.atomic
    def dispatch_challan(challan_id: str, user=None) -> DeliveryChallan:
        """
        Dispatch a challan - updates inventory locations to IN_TRANSIT and creates ledger entries.
        
        Args:
            challan_id: UUID of the challan to dispatch
            user: User performing the dispatch
            
        Returns:
            Updated DeliveryChallan instance
        """
        try:
            challan = DeliveryChallan.objects.select_for_update().get(id=challan_id)
        except DeliveryChallan.DoesNotExist:
            raise ValueError(f"Challan {challan_id} not found")
        
        if challan.status != 'DRAFT':
            raise ValueError(f"Challan {challan.dc_no} is already {challan.status}")
        
        # Find or create IN_TRANSIT location
        transit_location, _ = InventoryLocation.objects.get_or_create(
            plant=challan.plant,
            code='IN-TRANSIT',
            defaults={'name': 'In Transit', 'type': 'TRANSIT'}
        )
        
        # Process each item
        for item in challan.items.all():
            if item.roll:
                # Use RollService for movement (Strict Compliance)
                from apps.inventory.services.roll_service import RollService
                RollService.move_roll(
                    roll=item.roll,
                    to_location=transit_location,
                    reason='DISPATCH',
                    reason_note=f"DC-DISPATCH: {challan.dc_no}",
                    user=user
                )
                # RollService handles status update if moved to transit? 
                # Actually move_roll leaves status as AVAILABLE usually, or checks rules.
                # Only "CONSUMED" status changes.
                # We need to ensure status is IN_TRANSIT.
                item.roll.status = 'IN_TRANSIT'
                item.roll.save(update_fields=['status'])
            
            elif item.packing_unit:
                # Update gonny status and location
                gonny = item.packing_unit
                
                gonny.status = 'DISPATCHED'
                gonny.location = transit_location
                gonny.save()
                
                # Ledger removed
            
            elif item.fg_batch:
                # Update batch dispatched quantity
                batch = item.fg_batch
                batch.dispatched_qty_pcs += (item.qty_pcs or 0)
                
                # If fully dispatched, update status
                if batch.dispatched_qty_pcs >= batch.qty_pcs:
                    batch.status = 'DISPATCHED'
                batch.save()
                
                # Ledger removed
        
        # Update challan status
        challan.status = 'DISPATCHED'
        challan.dispatch_date = timezone.now()
        challan.save()
        
        return challan
    
    @staticmethod
    def update_challan_status(challan_id: str, new_status: str, user=None) -> DeliveryChallan:
        """
        Update the status of a delivery challan.
        Handles final state transitions for items.
        """
        try:
            challan = DeliveryChallan.objects.get(id=challan_id)
        except DeliveryChallan.DoesNotExist:
            raise ValueError(f"Challan {challan_id} not found")
        
        valid_transitions = {
            'DRAFT': ['DISPATCHED', 'CANCELLED'],
            'DISPATCHED': ['IN_TRANSIT', 'DELIVERED', 'RETURNED', 'CANCELLED'],
            'IN_TRANSIT': ['DELIVERED', 'RETURNED', 'CANCELLED'],
            'DELIVERED': [],
            'RETURNED': [],
            'CANCELLED': []
        }
        
        if new_status not in valid_transitions.get(challan.status, []):
            raise ValueError(f"Invalid transition from {challan.status} to {new_status}")
            
        challan.status = new_status
        if new_status == 'DELIVERED':
            challan.received_date = timezone.now()
            
            # Update items to final status
            for item in challan.items.all():
                if item.roll:
                    item.roll.status = 'CONSUMED'
                    item.roll.save()
                if item.packing_unit:
                    item.packing_unit.status = 'DISPATCHED' # Already set during dispatch, but ensure
                    item.packing_unit.save()
                    
        elif new_status == 'RETURNED':
            # Handle return logic if needed (e.g. move back to warehouse)
            pass
            
        challan.save()
        return challan

    @staticmethod
    def mark_received(challan_id: str, user=None) -> DeliveryChallan:
        """
        Shorthand for marking as DELIVERED.
        """
        return FGDispatchService.update_challan_status(challan_id, 'DELIVERED', user)
    
    @staticmethod
    def mark_dispatched(roll_ids: list = None, batch_ids: list = None):
        """
        Marks the specified rolls or batches as dispatched.
        """
        if roll_ids:
            InventoryRoll.objects.filter(id__in=roll_ids).update(status='CONSUMED')
        
        if batch_ids:
            FinishedGoodsBatch.objects.filter(id__in=batch_ids).update(status='DISPATCHED')
        
        return True
    @staticmethod
    def _sales_order_row(so_id: str):
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT id, order_number, customer_name, status FROM sales_orders WHERE id = %s::uuid",
                [str(so_id)],
            )
            row = cursor.fetchone()
        if not row:
            return None
        return {
            "id": str(row[0]),
            "order_number": row[1],
            "customer_name": row[2],
            "status": row[3],
        }
