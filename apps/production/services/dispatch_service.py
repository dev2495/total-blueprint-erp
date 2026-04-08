import os
from decimal import Decimal
from django.db import transaction
from django.db import connection
from django.db.models import Q, Sum
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
    def _roll_dispatch_record_map(roll_ids: list[str]) -> dict[str, dict]:
        if not roll_ids:
            return {}
        rows = (
            RollDispatchPackRecord.objects.filter(roll_id__in=roll_ids)
            .values("roll_id", "lines", "meta_json", "packed_at", "sales_order_item_id")
        )
        result = {}
        for row in rows:
            roll_id = str(row["roll_id"])
            meta = dict(row.get("meta_json") or {})
            lines = list(row.get("lines") or [])
            result[roll_id] = {
                "packed_for_dispatch": True,
                "released_to_dispatch": bool(meta.get("released_to_dispatch")),
                "released_to_dispatch_at": meta.get("released_to_dispatch_at"),
                "release_mode": str(meta.get("release_mode") or ("PACKED" if lines else "UNPACKED")).upper(),
                "lines": lines,
            }
        return result

    @staticmethod
    def _packed_roll_map(roll_ids: list[str]) -> dict[str, bool]:
        dispatch_map = FGDispatchService._roll_dispatch_record_map(roll_ids)
        return {str(roll_id): bool(dispatch_map.get(str(roll_id), {}).get("packed_for_dispatch")) for roll_id in roll_ids}

    @staticmethod
    def _gonny_released_for_dispatch(gonny: PackingUnit) -> bool:
        return bool(dict(getattr(gonny, "meta_json", {}) or {}).get("released_to_dispatch"))

    @staticmethod
    def _mark_release_meta(meta_json: dict | None, *, user=None, release_mode: str | None = None) -> dict:
        payload = dict(meta_json or {})
        payload["released_to_dispatch"] = True
        payload["released_to_dispatch_at"] = timezone.now().isoformat()
        if user is not None and getattr(user, "id", None):
            payload["released_to_dispatch_by"] = str(user.id)
            payload["released_to_dispatch_by_name"] = str(
                getattr(user, "get_full_name", lambda: "")() or getattr(user, "username", "") or ""
            ).strip()
        if release_mode:
            payload["release_mode"] = str(release_mode).upper()
        return payload

    @staticmethod
    def _set_sales_order_status(sales_order, status_value: str):
        if not sales_order:
            return
        current = str(getattr(sales_order, "status", "") or "").upper()
        target = str(status_value or "").upper()
        if not target or current == target:
            return
        if current in {"CANCELLED", "COMPLETED"}:
            return
        sales_order.status = target
        save = getattr(sales_order, "save", None)
        if callable(save):
            save(update_fields=["status"])
    
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
        Returns SalesOrders that have units already released from Packing Yard
        and therefore can appear in Dispatch Bay.
        """
        from apps.sales.models import SalesOrder

        ready_rolls = list(
            InventoryRoll.objects.filter(
                is_fg=True,
                status="AVAILABLE",
                sales_order_item__isnull=False,
            )
            .filter(
                Q(meta_json__is_internal_stock=False) | Q(meta_json__is_internal_stock__isnull=True)
            )
            .values("id", "sales_order_item__sales_order_id")
        )
        roll_dispatch_map = FGDispatchService._roll_dispatch_record_map([str(row["id"]) for row in ready_rolls])
        so_ids_with_rolls = {
            str(row["sales_order_item__sales_order_id"])
            for row in ready_rolls
            if roll_dispatch_map.get(str(row["id"]), {}).get("released_to_dispatch")
        }

        so_ids_with_gonnies = {
            str(gonny.sales_order_item.sales_order_id)
            for gonny in PackingUnit.objects.filter(
                status="SEALED",
                sales_order_item__isnull=False,
            ).select_related("sales_order_item__sales_order")
            if FGDispatchService._gonny_released_for_dispatch(gonny)
        }

        combined_so_ids = [sid for sid in set(so_ids_with_rolls).union(so_ids_with_gonnies) if sid]

        return (
            SalesOrder.objects
            .filter(id__in=combined_so_ids)
            .order_by('-created_at')
            .values('id', 'order_number', 'customer_name', 'status')
        )

    @staticmethod
    def get_sales_orders_for_packing():
        """
        Returns sales orders that have packable or releasable goods in Packing Yard.
        This includes:
        - finished rolls tied to sales orders
        - finished pouch batches tied to sales orders
        - open or sealed gonnies tied to sales orders
        """
        from apps.sales.models import SalesOrder

        so_ids_with_rolls = InventoryRoll.objects.filter(
            is_fg=True,
            status='AVAILABLE',
            sales_order_item__isnull=False,
        ).filter(
            Q(meta_json__is_internal_stock=False) | Q(meta_json__is_internal_stock__isnull=True)
        ).values_list('sales_order_item__sales_order_id', flat=True)

        so_ids_with_batches = FinishedGoodsBatch.objects.filter(
            qty_pcs__gt=0,
            status__in=['AVAILABLE', 'PACKED'],
            sales_order_item__isnull=False,
        ).filter(
            Q(meta_json__is_internal_stock=False) | Q(meta_json__is_internal_stock__isnull=True)
        ).values_list('sales_order_item__sales_order_id', flat=True)

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
    def get_packing_units_by_so(so_id: str) -> dict:
        """
        Returns packable and releasable units for a Sales Order.
        Packing Yard uses this view to create gonnies, seal them, pack rolls,
        and explicitly release physical units to Dispatch Bay.
        """
        from apps.sales.models import SalesOrderItem

        so = FGDispatchService._sales_order_row(so_id)
        if not so:
            raise ValueError(f"Sales Order {so_id} not found")

        so_items = SalesOrderItem.objects.filter(sales_order_id=so_id)
        so_item_ids = list(so_items.values_list("id", flat=True))
        ordered_qty = so_items.aggregate(total=Sum("qty_value"))["total"] or Decimal("0")

        rolls = list(
            InventoryRoll.objects.filter(
                is_fg=True,
                sales_order_item__in=so_item_ids,
                status="AVAILABLE",
            )
            .filter(Q(meta_json__is_internal_stock=False) | Q(meta_json__is_internal_stock__isnull=True))
            .select_related("location__plant", "production_job", "sales_order_item")
        )
        roll_dispatch_map = FGDispatchService._roll_dispatch_record_map([str(roll.id) for roll in rolls])

        batches = list(
            FinishedGoodsBatch.objects.filter(
                sales_order_item__in=so_item_ids,
                status__in=["AVAILABLE", "PACKED"],
                qty_pcs__gt=0,
            )
            .filter(Q(meta_json__is_internal_stock=False) | Q(meta_json__is_internal_stock__isnull=True))
            .select_related("location__plant", "template", "production_job", "sales_order_item")
        )

        gonnies = list(
            PackingUnit.objects.filter(
                sales_order_item__in=so_item_ids,
                status__in=["OPEN", "SEALED"],
            ).select_related("location__plant", "fg_batch", "sales_order_item")
        )

        roll_rows = []
        for roll in rolls:
            dispatch_meta = roll_dispatch_map.get(str(roll.id), {})
            roll_rows.append(
                {
                    "id": str(roll.id),
                    "sales_order_item_id": str(roll.sales_order_item_id) if roll.sales_order_item_id else None,
                    "label_id": roll.label_id,
                    "batch_no": roll.batch_no or "",
                    "weight_kg": float(roll.weight_kg or 0),
                    "width_mm": float(roll.width_mm or 0),
                    "material__name": getattr(getattr(roll, "material", None), "name", ""),
                    "location": {
                        "id": str(roll.location.id),
                        "name": roll.location.name,
                        "plant_id": str(roll.location.plant_id),
                        "plant_name": roll.location.plant.name,
                    },
                    "packed_for_dispatch": bool(dispatch_meta.get("packed_for_dispatch")),
                    "released_to_dispatch": bool(dispatch_meta.get("released_to_dispatch")),
                    "release_mode": dispatch_meta.get("release_mode") or "UNPACKED",
                    "default_pack_lines": (
                        (
                            (
                                (getattr(roll.sales_order_item, "packaging_snapshot", {}) or {}).get("roll_dispatch_pack")
                                or {}
                            ).get("lines")
                            or []
                        )
                        if bool(
                            (
                                (getattr(roll.sales_order_item, "packaging_snapshot", {}) or {}).get("roll_dispatch_pack")
                                or {}
                            ).get("enabled", False)
                        )
                        else []
                    ),
                    "job_no": roll.production_job.job_number if roll.production_job else None,
                }
            )

        batch_rows = [
            {
                "id": str(batch.id),
                "batch_number": batch.batch_number,
                "qty_pcs": int(batch.qty_pcs or 0),
                "qty_kg": float(batch.qty_kg or 0),
                "status": batch.status,
                "template_name": batch.template.name if batch.template else None,
                "customer": batch.customer_name,
                "so_number": batch.sales_order_no,
                "primary_pack_enabled": bool(
                    (
                        dict(getattr(batch.sales_order_item, "packaging_snapshot", {}) or {}).get("primary_inner_pack", {})
                        if getattr(batch, "sales_order_item", None)
                        else {}
                    ).get("enabled", False)
                ),
                "pcs_per_pack": (
                    int(
                        (
                            dict(getattr(batch.sales_order_item, "packaging_snapshot", {}) or {}).get("primary_inner_pack", {})
                            if getattr(batch, "sales_order_item", None)
                            else {}
                        ).get("pcs_per_pack") or 0
                    )
                    if getattr(batch, "sales_order_item", None)
                    else None
                ),
                "default_content_mode": (
                    "PRIMARY_PACKS"
                    if bool(
                        (
                            dict(getattr(batch.sales_order_item, "packaging_snapshot", {}) or {}).get("primary_inner_pack", {})
                            if getattr(batch, "sales_order_item", None)
                            else {}
                        ).get("enabled", False)
                    )
                    else "LOOSE_POUCHES"
                ),
                "location": {
                    "id": str(batch.location.id) if batch.location else None,
                    "name": batch.location.name if batch.location else None,
                    "plant_id": str(batch.location.plant_id) if batch.location else None,
                    "plant_name": batch.location.plant.name if batch.location else None,
                },
            }
            for batch in batches
        ]

        gonny_rows = [
            {
                "id": str(gonny.id),
                "label_id": gonny.label_id,
                "qty_pcs": int(gonny.qty_pcs or 0),
                "content_mode": gonny.content_mode,
                "primary_pack_count": gonny.primary_pack_count,
                "weight_kg": float(gonny.weight_kg or 0) if gonny.weight_kg is not None else None,
                "net_product_weight_kg": float(gonny.net_product_weight_kg or 0),
                "inner_pack_tare_kg": float(gonny.inner_pack_tare_kg or 0),
                "secondary_pack_tare_kg": float(gonny.secondary_pack_tare_kg or 0),
                "extras_tare_kg": float(gonny.extras_tare_kg or 0),
                "gross_weight_kg": float(gonny.gross_weight_kg or gonny.weight_kg or 0) if gonny.gross_weight_kg is not None or gonny.weight_kg is not None else None,
                "status": gonny.status,
                "released_to_dispatch": FGDispatchService._gonny_released_for_dispatch(gonny),
                "batch_no": gonny.fg_batch.batch_number if gonny.fg_batch else None,
                "location": {
                    "id": str(gonny.location.id) if gonny.location_id else None,
                    "name": gonny.location.name if gonny.location_id else None,
                    "plant_id": str(gonny.location.plant_id) if gonny.location_id else None,
                    "plant_name": gonny.location.plant.name if gonny.location_id else None,
                },
            }
            for gonny in gonnies
        ]

        ready_rolls = [row for row in roll_rows if row["released_to_dispatch"]]
        ready_gonnies = [row for row in gonny_rows if row["released_to_dispatch"] and str(row["status"]).upper() == "SEALED"]

        return {
            "sales_order": so,
            "ordered_qty": float(ordered_qty),
            "packing_pending": {
                "rolls_count": len([row for row in roll_rows if not row["released_to_dispatch"]]),
                "batches_count": len(batch_rows),
                "batches_pcs": sum(int(row["qty_pcs"] or 0) for row in batch_rows),
                "open_gonnies_count": len([row for row in gonny_rows if str(row["status"]).upper() == "OPEN"]),
                "sealed_gonnies_count": len([row for row in gonny_rows if str(row["status"]).upper() == "SEALED" and not row["released_to_dispatch"]]),
            },
            "ready_for_dispatch": {
                "rolls_count": len(ready_rolls),
                "rolls_kg": float(sum(float(row["weight_kg"] or 0) for row in ready_rolls)),
                "gonnies_count": len(ready_gonnies),
                "gonnies_pcs": sum(int(row["qty_pcs"] or 0) for row in ready_gonnies),
                "gonnies_gross_kg": float(sum(float(row["gross_weight_kg"] or 0) for row in ready_gonnies)),
            },
            "rolls": roll_rows,
            "batches": batch_rows,
            "gonnies": gonny_rows,
        }

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
        roll_dispatch_map = FGDispatchService._roll_dispatch_record_map([str(r.id) for r in available_roll_rows])
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
            'packed_for_dispatch': bool(roll_dispatch_map.get(str(r.id), {}).get("packed_for_dispatch")),
            'released_to_dispatch': bool(roll_dispatch_map.get(str(r.id), {}).get("released_to_dispatch")),
            'release_mode': str(roll_dispatch_map.get(str(r.id), {}).get("release_mode") or "UNPACKED").upper(),
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
        } for r in available_roll_rows if bool(roll_dispatch_map.get(str(r.id), {}).get("released_to_dispatch"))]

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
            'released_to_dispatch': FGDispatchService._gonny_released_for_dispatch(g),
        } for g in all_gonnies.filter(status='SEALED') if FGDispatchService._gonny_released_for_dispatch(g)]

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
                'rolls_count': len(roll_units),
                'rolls_kg': float(sum(float(row['weight_kg'] or 0) for row in roll_units)),
                'gonnies_count': len(gonny_units),
                'gonnies_pcs': sum(int(row['qty_pcs'] or 0) for row in gonny_units),
                'gonnies_net_kg': float(sum(float(row['net_product_weight_kg'] or 0) for row in gonny_units)),
                'gonnies_gross_kg': float(sum(float(row['gross_weight_kg'] or 0) for row in gonny_units)),
            },
            'packing_pending': {
                'open_gonnies_count': open_gonnies.count(),
                'open_gonnies_pcs': open_gonnies.aggregate(total=Sum('qty_pcs'))['total'] or 0,
                'unpacked_batch_count': unpacked_batches.count(),
                'unpacked_batch_pcs': unpacked_batches.aggregate(total=Sum('qty_pcs'))['total'] or 0,
                'unreleased_rolls_count': len([row for row in available_roll_rows if not bool(roll_dispatch_map.get(str(row.id), {}).get("released_to_dispatch"))]),
                'unreleased_sealed_gonnies_count': len([
                    gonny for gonny in all_gonnies.filter(status='SEALED')
                    if not FGDispatchService._gonny_released_for_dispatch(gonny)
                ]),
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
    def release_roll_to_dispatch(roll_id: str, user=None, lines: list | None = None, release_mode: str = "PACKED") -> RollDispatchPackRecord:
        try:
            roll = InventoryRoll.objects.select_related("sales_order_item", "sales_order_item__sales_order").get(id=roll_id)
        except InventoryRoll.DoesNotExist:
            raise ValueError(f"Roll {roll_id} not found")

        if not roll.sales_order_item_id:
            raise ValueError(f"Roll {roll.label_id} has no sales-order lineage and cannot be released to dispatch.")
        if str(roll.status or "").upper() != "AVAILABLE":
            raise ValueError(f"Roll {roll.label_id} is not AVAILABLE.")

        normalized_mode = str(release_mode or "PACKED").upper()
        if normalized_mode not in {"PACKED", "UNPACKED"}:
            raise ValueError("release_mode must be PACKED or UNPACKED.")

        record = RollDispatchPackRecord.objects.filter(
            roll_id=roll.id,
            sales_order_item_id=roll.sales_order_item_id,
        ).first()

        if record is None:
            if normalized_mode == "PACKED":
                record = FGDispatchService.pack_roll(roll_id=str(roll.id), lines=lines, user=user)
            else:
                record = RollDispatchPackRecord.objects.create(
                    roll=roll,
                    sales_order_item_id=roll.sales_order_item_id,
                    packed_by=user,
                    lines=[],
                    tx_ids=[],
                    meta_json={
                        "defaulted_from_snapshot": False,
                        "release_mode": "UNPACKED",
                    },
                )

        record.meta_json = FGDispatchService._mark_release_meta(
            record.meta_json,
            user=user,
            release_mode=normalized_mode if normalized_mode else ("PACKED" if record.lines else "UNPACKED"),
        )
        record.save(update_fields=["meta_json"])
        FGDispatchService._set_sales_order_status(
            getattr(getattr(roll, "sales_order_item", None), "sales_order", None),
            "DISPATCH_READY",
        )
        return record

    @staticmethod
    @transaction.atomic
    def release_gonny_to_dispatch(gonny_id: str, user=None) -> PackingUnit:
        try:
            gonny = PackingUnit.objects.select_related("sales_order_item", "sales_order_item__sales_order").get(id=gonny_id)
        except PackingUnit.DoesNotExist:
            raise ValueError(f"Packing unit {gonny_id} not found")

        if str(gonny.status or "").upper() != "SEALED":
            raise ValueError(f"Gonny {gonny.label_id} must be SEALED before release to dispatch.")

        gonny.meta_json = FGDispatchService._mark_release_meta(gonny.meta_json, user=user, release_mode="GONNY")
        gonny.save(update_fields=["meta_json"])
        FGDispatchService._set_sales_order_status(
            getattr(getattr(gonny, "sales_order_item", None), "sales_order", None),
            "DISPATCH_READY",
        )
        return gonny

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

        validated_rolls = []
        if roll_ids:
            rolls = InventoryRoll.objects.filter(id__in=roll_ids)
            for roll in rolls:
                # Validation: must belong to same SO
                if not roll.sales_order_item_id or str(roll.sales_order_item.sales_order_id) != str(sales_order_id):
                    raise ValueError(f"Roll {roll.label_id} belongs to a different Sales Order")
                dispatch_record = RollDispatchPackRecord.objects.filter(
                    roll_id=roll.id,
                    sales_order_item_id=roll.sales_order_item_id,
                ).first()
                if not dispatch_record:
                    raise ValueError(f"Roll {roll.label_id} is not released from Packing Yard.")
                if not bool(dict(getattr(dispatch_record, "meta_json", {}) or {}).get("released_to_dispatch")):
                    raise ValueError(f"Roll {roll.label_id} is not released to Dispatch Bay yet.")

                validated_rolls.append(roll)

        validated_gonnies = []
        if gonny_ids:
            gonnies = PackingUnit.objects.filter(id__in=gonny_ids)
            for gonny in gonnies:
                if not gonny.sales_order_item_id or str(gonny.sales_order_item.sales_order_id) != str(sales_order_id):
                    raise ValueError(f"Gonny {gonny.label_id} belongs to a different Sales Order")
                if gonny.status != 'SEALED':
                    raise ValueError(f"Gonny {gonny.label_id} must be sealed before dispatch.")
                if not FGDispatchService._gonny_released_for_dispatch(gonny):
                    raise ValueError(f"Gonny {gonny.label_id} is not released from Packing Yard.")
                if gonny.weight_kg is None:
                    raise ValueError(f"Gonny {gonny.label_id} is missing sealed weight.")

                validated_gonnies.append(gonny)

        # Generate DC number only after all request validation to keep rejection paths side-effect free.
        dc_prefix = f"DC-{timezone.now().strftime('%Y%m%d')}-"
        todays_numbers = DeliveryChallan.objects.filter(dc_no__startswith=dc_prefix).values_list("dc_no", flat=True)
        next_suffix = 1
        for value in todays_numbers:
            try:
                suffix = int(str(value).rsplit("-", 1)[-1])
            except Exception:
                continue
            if suffix >= next_suffix:
                next_suffix = suffix + 1
        dc_no = f"{dc_prefix}{next_suffix:04d}"
        while DeliveryChallan.objects.filter(dc_no=dc_no).exists():
            next_suffix += 1
            dc_no = f"{dc_prefix}{next_suffix:04d}"

        plant = Plant.objects.get(id=plant_id)
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

        for roll in validated_rolls:
            DeliveryChallanItem.objects.create(
                challan=challan,
                sales_order_item=roll.sales_order_item,
                roll=roll,
                weight_kg=roll.weight_kg,
                qty_pcs=None
            )

        for gonny in validated_gonnies:
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
