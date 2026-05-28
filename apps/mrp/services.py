from decimal import Decimal
from typing import Dict, List, Any
from datetime import timedelta
from django.db import transaction
from django.db.models import Sum, F
from django.utils import timezone
from apps.sales.models import SalesOrderItem
from apps.production.models import PlannedStockOrder
from apps.inventory.models import InventoryBulk, InventoryRoll, InventoryLocation
from apps.materials.models import InventoryMaterial
from .models import MRPPlan, MRPRequirement, MRPSuggestion
from apps.costing.services import CostingService
import logging

logger = logging.getLogger(__name__)

class MRPService:
    @staticmethod
    def _priority_for_shortage(shortage: Decimal) -> str:
        qty = Decimal(str(shortage or 0))
        if qty >= Decimal('500'):
            return 'HIGH'
        if qty >= Decimal('100'):
            return 'MEDIUM'
        return 'LOW'

    @staticmethod
    def _required_date_for_suggestion(type_code: str):
        today = timezone.now().date()
        t = str(type_code or '').upper()
        if t == 'TRANSFER':
            return today
        if t == 'MTS_PRODUCE':
            return today + timedelta(days=2)
        return today + timedelta(days=7)

    @staticmethod
    def run_mrp(plant_id: str = None, user=None) -> MRPPlan:
        """
        Main MRP Execution Entry Point.
        """
        plan = MRPPlan.objects.create(
            plant_id=plant_id,
            status='RUNNING',
            created_by=user
        )

        try:
            with transaction.atomic():
                # 1. Aggregate Demand
                demand_map = MRPService._explode_all_demand()
                
                # 2. Netting and Suggestions
                total_shortage = Decimal('0')
                total_demand = Decimal('0')
                total_available = Decimal('0')
                total_wip = Decimal('0')
                
                for mat_id, data in demand_map.items():
                    material = data['material']
                    required_qty = data['total_qty']
                    total_demand += required_qty
                    
                    # Get current stock & WIP
                    stock_available = MRPService._get_available_stock(material, plant_id)
                    wip_incoming = MRPService._get_wip_stock(material, plant_id)
                    
                    total_available += stock_available
                    total_wip += wip_incoming
                    
                    # Net Demand = Demand - Stock - WIP
                    net_demand = max(Decimal('0'), required_qty - stock_available - wip_incoming)
                    
                    # Save Requirement with WIP details
                    MRPRequirement.objects.create(
                        plan=plan,
                        material=material,
                        required_qty_kg=required_qty,
                        available_qty_kg=stock_available,
                        wip_qty_kg=wip_incoming,
                        shortage_qty_kg=net_demand,
                        source_type='SO',
                        source_ref='MULTIPLE'
                    )

                    if net_demand > 0:
                        total_shortage += net_demand
                        MRPService._generate_suggestions(plan, material, net_demand, plant_id)

                plan.total_demand_kg = total_demand
                plan.total_available_kg = total_available
                plan.total_wip_kg = total_wip
                plan.total_shortage_kg = total_shortage
                plan.status = 'COMPLETED'
                plan.save()
                
            return plan

        except Exception as e:
            logger.error(f"MRP Run Failed: {str(e)}", exc_info=True)
            # Re-fetch plan to ensure valid state if needed, though here we just update status
            plan.status = 'FAILED'
            plan.save()
            raise e

    @staticmethod
    def _explode_all_demand() -> Dict[str, Any]:
        """
        Scans SOs and MTS orders to find all material needs.
        """
        demand_map = {} # mat_id -> {material, total_qty}

        # 1. Sales Orders (commercially confirmed onward)
        so_items = SalesOrderItem.objects.filter(
            sales_order__status__in=['PLANNING_REQUIRED', 'PLANNED', 'RELEASED', 'PACKING_READY', 'DISPATCH_READY']
        ).select_related('template', 'sales_order')

        for item in so_items:
            bom = item.bom_snapshot
            if not bom:
                logger.warning(f"Skipping SO Item {item.id}: bom_snapshot missing under V2 hard-cut.")
                continue

            scaling_factor = Decimal('1')
            if item.qty_uom == 'PCS':
                scaling_factor = Decimal(str(item.qty_value))
            elif item.qty_uom == 'KG':
                unit_weight_g = item.unit_weight_g or Decimal('0')
                if unit_weight_g > 0:
                    scaling_factor = (Decimal(str(item.qty_value)) * Decimal('1000')) / unit_weight_g

            MRPService._aggregate_bom_into_map(bom, demand_map, scaling_factor)

        # 2. MTS Orders (Make To Stock)
        from apps.production.models import PlannedStockOrder
        mts_orders = PlannedStockOrder.objects.filter(
            status__in=['PLANNING_REQUIRED', 'PLANNED', 'RELEASED']
        ).select_related('template')

        for mts in mts_orders:
            bom = mts.bom_snapshot
            if not bom:
                logger.warning(f"Skipping MTS Order {mts.order_number}: bom_snapshot missing under V2 hard-cut.")
                continue

            scaling_factor = Decimal('1')
            unit_weight_g = Decimal(str(getattr(mts, 'unit_weight_g', 0) or 0))
            if unit_weight_g > 0:
                scaling_factor = (Decimal(str(mts.target_qty)) * Decimal('1000')) / unit_weight_g
            MRPService._aggregate_bom_into_map(bom, demand_map, scaling_factor)

        return demand_map

    @staticmethod
    def _aggregate_bom_into_map(bom: Dict[str, Any], demand_map: Dict[str, Any], scaling_factor: Decimal = Decimal('1')):
        """
        Helper to extract material needs from solved BOM JSON.
        """
        # Films (Purchased)
        for film in bom.get('films', []):
            if film.get('source') == 'PURCHASE':
                mat_id = film.get('variant_id') or film.get('family_id')
                qty = Decimal(str(film.get('weight_kg', 0))) * scaling_factor
                MRPService._add_to_demand(mat_id, qty, demand_map)

        # Granules (Extrusion)
        for granule in bom.get('granules', []):
            mat_id = granule.get('granule_id')
            qty = Decimal(str(granule.get('weight_kg', 0))) * scaling_factor
            MRPService._add_to_demand(mat_id, qty, demand_map)

        # Inks
        for ink in bom.get('inks', []):
            mat_id = ink.get('material_id')
            qty = Decimal(str(ink.get('weight_kg', 0))) * scaling_factor
            MRPService._add_to_demand(mat_id, qty, demand_map)

        # Chemicals
        for chem in bom.get('chemicals', []):
            mat_id = chem.get('material_id')
            qty = Decimal(str(chem.get('weight_kg', 0))) * scaling_factor
            MRPService._add_to_demand(mat_id, qty, demand_map)

        # POD
        for pod in bom.get('pod', []):
            mat_id = pod.get('material_id')
            qty = Decimal(str(pod.get('weight_kg', 0))) * scaling_factor
            MRPService._add_to_demand(mat_id, qty, demand_map)

        # Sprint 4 — packaging / adhesive / solvent / addon completeness.
        for pkg in bom.get('packaging', []) or []:
            mat_id = pkg.get('material_id') or pkg.get('packaging_id')
            qty_field = pkg.get('weight_kg', pkg.get('qty', 0))
            qty = Decimal(str(qty_field or 0)) * scaling_factor
            MRPService._add_to_demand(mat_id, qty, demand_map)

        for adh in bom.get('adhesives', []) or bom.get('adhesive', []) or []:
            mat_id = adh.get('material_id')
            qty = Decimal(str(adh.get('weight_kg', 0))) * scaling_factor
            MRPService._add_to_demand(mat_id, qty, demand_map)

        for sol in bom.get('solvents', []) or bom.get('solvent', []) or []:
            mat_id = sol.get('material_id')
            qty = Decimal(str(sol.get('weight_kg', 0))) * scaling_factor
            MRPService._add_to_demand(mat_id, qty, demand_map)

        for addon in bom.get('addons', []) or bom.get('addon', []) or []:
            mat_id = addon.get('material_id') or addon.get('addon_id')
            qty_field = addon.get('weight_kg', addon.get('qty', 0))
            qty = Decimal(str(qty_field or 0)) * scaling_factor
            MRPService._add_to_demand(mat_id, qty, demand_map)

    @staticmethod
    def _add_to_demand(mat_id, qty, demand_map):
        if not mat_id: return
        try:
            mat_id_str = str(mat_id)
            if mat_id_str not in demand_map:
                demand_map[mat_id_str] = {
                    'material': InventoryMaterial.objects.get(id=mat_id),
                    'total_qty': Decimal('0')
                }
            demand_map[mat_id_str]['total_qty'] += qty
        except InventoryMaterial.DoesNotExist:
            pass

    @staticmethod
    def _get_available_stock(material: InventoryMaterial, plant_id: str = None) -> Decimal:
        """
        Gets current usable stock (Phase 57: Uses InventoryBulk + InventoryRoll).
        """
        bulk_query = InventoryBulk.objects.filter(material=material)
        if plant_id:
            bulk_query = bulk_query.filter(plant_id=plant_id)
        
        # Also include unconsumed rolls (only if it's the exact material)
        roll_query = InventoryRoll.objects.filter(material=material, status='AVAILABLE')
        if plant_id:
            roll_query = roll_query.filter(location__plant_id=plant_id)
            
        bulk_qty = bulk_query.aggregate(total=Sum('qty_kg'))['total'] or Decimal('0')
        roll_qty = roll_query.aggregate(total=Sum('weight_kg'))['total'] or Decimal('0')
        
        return bulk_qty + roll_qty

    @staticmethod
    def _get_wip_stock(material: InventoryMaterial, plant_id: str = None) -> Decimal:
        """
        Calculates expected incoming stock from active Production Jobs.
        """
        from apps.production.models import ProductionJob
        
        # Jobs that are RELEASED (Pending) or EXECUTING (Running)
        # We assume the output material matches the requested material (true for Extrusion/Conversion)
        # Note: This is an estimation. 
        jobs = ProductionJob.objects.filter(
            job_state__in=['PENDING', 'RLSE', 'EXECUTING'],
            # For simplicity, assuming job output matches material. 
            # In a complex BOM, we'd check the job's BOM output.
            # Here we check if the job works ON this material (Conversion) or produces it (Extrusion)
        )
        
        # Refined: Check jobs where the Process output implies this material?
        # Or simpler: Check PlannedStockOrders if MTS.
        # For SO-based jobs, the material is the FG.
        
        # Strategy: 
        # 1. MTS Jobs for this material
        # 2. SO Jobs for this material (if material is FG)
        
        wip_qty = Decimal('0')
        
        # Case A: Material is an intermediate or FG from MTS
        # We check PlannedStockOrder for this material
        from apps.production.models import PlannedStockOrder
        mts_wip = PlannedStockOrder.objects.filter(
            status__in=['RELEASED', 'PLANNED'],
            template__name__icontains=material.name # Heuristic matching if direct link missing
            # In real implementations, PlannedStockOrder should link to InventoryMaterial variant
        ).aggregate(total=Sum('target_qty'))['total'] or 0
        
        wip_qty += Decimal(str(mts_wip))
        
        # Case B: Active Jobs producing this material (e.g. Extrusion Job producing Base Film)
        # This requires traversing the Job -> Process -> Output Material link.
        # For Phase 64, we'll keep it simple and trust MTS WIP + Safety Stock logic.
        
        return wip_qty

    @staticmethod
    def _generate_suggestions(plan: MRPPlan, material: InventoryMaterial, shortage: Decimal, plant_id: str):
        """
        Heuristic for suggestions.
        """
        priority = MRPService._priority_for_shortage(shortage)
        
        # 1. Inter-plant transfer check
        if plant_id:
            total_stock = MRPService._get_available_stock(material)
            local_stock = MRPService._get_available_stock(material, plant_id)
            other_stock = total_stock - local_stock
            
            if other_stock > 0:
                transfer_qty = min(shortage, other_stock)
                MRPSuggestion.objects.create(
                    plan=plan,
                    type='TRANSFER',
                    material=material,
                    qty=transfer_qty,
                    reason=f"Stock exists in other plant locations.",
                    target_plant_id=plant_id,
                    required_date=MRPService._required_date_for_suggestion('TRANSFER'),
                    priority=priority,
                    # Note: source_plant could be inferred if there's only one other, but keeping simple
                )
                shortage -= transfer_qty
        
        if shortage <= 0: return

        # 2. Category based defaults
        if material.category == 'POD':
            if getattr(material, 'pod_is_inhouse_produced', False):
                MRPSuggestion.objects.create(
                    plan=plan,
                    type='MTS_PRODUCE',
                    material=material,
                    qty=shortage,
                    reason="In-house POD stock is required.",
                    target_plant_id=plant_id,
                    required_date=MRPService._required_date_for_suggestion('MTS_PRODUCE'),
                    priority=priority,
                )
            else:
                MRPSuggestion.objects.create(
                    plan=plan,
                    type='PURCHASE',
                    material=material,
                    qty=shortage,
                    reason="Stockout detected for POD material.",
                    target_plant_id=plant_id,
                    required_date=MRPService._required_date_for_suggestion('PURCHASE'),
                    priority=priority,
                )
                rate = CostingService.get_material_rate(material)
                cost_impact = shortage * rate
                plan.purchase_value_est += cost_impact
        
        elif material.category in ['GRANULE', 'INK', 'ADHESIVE', 'SOLVENT', 'ADDITIVE', 'PACKAGING', 'ADDON']:
            MRPSuggestion.objects.create(
                plan=plan,
                type='PURCHASE',
                material=material,
                qty=shortage,
                reason="Stockout detected for direct material.",
                target_plant_id=plant_id,
                required_date=MRPService._required_date_for_suggestion('PURCHASE'),
                priority=priority,
            )
            # Update plan purchase value est
            rate = CostingService.get_material_rate(material)
            cost_impact = shortage * rate
            plan.purchase_value_est += cost_impact
        
        elif material.category == 'FILM_VARIANT':
            if material.is_extrudable:
                MRPSuggestion.objects.create(
                    plan=plan,
                    type='MTS_PRODUCE',
                    material=material,
                    qty=shortage,
                    reason="Semi-finished film variant needs extrusion.",
                    target_plant_id=plant_id,
                    required_date=MRPService._required_date_for_suggestion('MTS_PRODUCE'),
                    priority=priority,
                )
            else:
                MRPSuggestion.objects.create(
                    plan=plan,
                    type='PURCHASE',
                    material=material,
                    qty=shortage,
                    reason="Purchased base film stockout.",
                    target_plant_id=plant_id,
                    required_date=MRPService._required_date_for_suggestion('PURCHASE'),
                    priority=priority,
                )
                plan.purchase_value_est += shortage * CostingService.get_material_rate(material)

    @staticmethod
    @transaction.atomic
    def create_suggestion_draft(suggestion: MRPSuggestion, draft_type: str, user=None) -> Dict[str, Any]:
        """
        Create draft references from MRP suggestions.

        For 'po', this actually creates a DRAFT PurchaseOrder (auto-picks vendor
        from material's last BulkTransaction.reference VENDOR:<code>) and returns
        the PO id so the UI can navigate to it.

        For 'job' / 'transfer', kept as the lightweight stub for V1.
        """
        kind = str(draft_type or '').lower().strip()
        if kind not in {'po', 'job', 'transfer'}:
            raise ValueError("draft_type must be one of: po, job, transfer")

        sug_type = str(suggestion.type or '').upper()
        if kind == 'po' and sug_type != 'PURCHASE':
            raise ValueError("Draft PO is valid only for PURCHASE suggestions.")
        if kind == 'job' and sug_type != 'MTS_PRODUCE':
            raise ValueError("Draft Job is valid only for MTS_PRODUCE suggestions.")
        if kind == 'transfer' and sug_type != 'TRANSFER':
            raise ValueError("Draft Transfer is valid only for TRANSFER suggestions.")

        now = timezone.now()

        # ── PO PATH ──────────────────────────────────────────────────────
        if kind == 'po':
            from apps.procurement.models import PurchaseOrder, PurchaseOrderItem
            from apps.procurement.services.purchase_order import PurchaseOrderService
            from apps.inventory.models import BulkTransaction, Vendor

            # Auto-pick vendor from the material's most recent INWARD BulkTransaction.
            # The vendor is stored in reference as "VENDOR:<code>".
            vendor = None
            last_rate = Decimal('0')
            last_tx = (
                BulkTransaction.objects
                .filter(material=suggestion.material, type='INWARD')
                .order_by('-created_at')
                .first()
            )
            if last_tx and last_tx.reference:
                ref = str(last_tx.reference)
                if 'VENDOR:' in ref:
                    code_segment = ref.split('VENDOR:', 1)[1].split('|', 1)[0].strip()
                    vendor = Vendor.objects.filter(code=code_segment).first()
                last_rate = Decimal(str(last_tx.avg_cost or 0))

            if not vendor:
                # Packaging may have a vendor FK on the most recent packaging tx.
                try:
                    from apps.inventory.models import PackagingTransaction
                    pkg_tx = (
                        PackagingTransaction.objects
                        .filter(material=suggestion.material, type='INWARD', vendor__isnull=False)
                        .order_by('-created_at')
                        .first()
                    )
                    if pkg_tx and pkg_tx.vendor:
                        vendor = pkg_tx.vendor
                        last_rate = Decimal(str(pkg_tx.avg_cost or 0))
                except Exception:
                    pass

            if not vendor:
                vendor = Vendor.objects.filter(status='ACTIVE').order_by('name').first()
            if not vendor:
                vendor = Vendor.objects.order_by('name').first()
            if not vendor:
                raise ValueError("No vendor available — create a vendor master first.")

            plant = suggestion.target_plant or suggestion.plan.plant
            if not plant:
                from apps.factory.models import Plant
                plant = Plant.objects.first()
            if not plant:
                raise ValueError("No plant available — create a plant master first.")

            po = PurchaseOrder.objects.create(
                vendor=vendor,
                plant=plant,
                source_mrp_suggestion=suggestion,
                created_by=user if (user and getattr(user, 'is_authenticated', False)) else None,
                status='DRAFT',
                order_date=now.date(),
                expected_delivery_date=suggestion.required_date,
                notes=f"Auto-drafted from MRP suggestion: {suggestion.reason or ''}".strip(),
            )
            PurchaseOrderItem.objects.create(
                purchase_order=po,
                line_no=1,
                material=suggestion.material,
                qty_ordered=suggestion.qty or Decimal('0'),
                uom=str(suggestion.material.base_uom or 'KG'),
                rate_per_uom=last_rate,
                expected_delivery_date=suggestion.required_date,
            )
            PurchaseOrderService.recalc_totals(po)

            suggestion.draft_ref = po.code
            suggestion.action_status = 'PO_DRAFTED'
            suggestion.last_action_at = now
            suggestion.last_action_by = user if user and getattr(user, 'is_authenticated', False) else None
            suggestion.save(update_fields=['draft_ref', 'action_status', 'last_action_at', 'last_action_by'])

            try:
                from apps.users.services import NotificationService
                NotificationService.create_notification(
                    user=None,
                    target_role='STORE',
                    title="MRP: Purchase Order Drafted",
                    message=f"PO {po.code} drafted for {suggestion.qty} {suggestion.material.base_uom or 'KG'} of {suggestion.material.name}. Review and send.",
                    notification_type='LOW_STOCK',
                    related_object_type='PurchaseOrder',
                    related_object_id=str(po.id),
                    priority='HIGH' if suggestion.priority == 'HIGH' else 'NORMAL',
                )
            except Exception as e:
                logger.error(f"Failed to send PO Notification: {e}", exc_info=True)

            return {
                'suggestion_id': str(suggestion.id),
                'action': 'PO',
                'action_status': suggestion.action_status,
                'draft_ref': po.code,
                'po_id': str(po.id),
            }

        # ── JOB / TRANSFER STUB PATH (legacy V1) ─────────────────────────
        ts = now.strftime('%Y%m%d-%H%M%S')
        short_id = str(suggestion.id).split('-')[0].upper()
        prefix = {'job': 'DJOB', 'transfer': 'DTRN'}[kind]
        draft_ref = f"{prefix}-{ts}-{short_id}"

        suggestion.draft_ref = draft_ref
        suggestion.action_status = 'DRAFT_CREATED'
        suggestion.last_action_at = now
        suggestion.last_action_by = user if user and getattr(user, 'is_authenticated', False) else None
        suggestion.save(update_fields=['draft_ref', 'action_status', 'last_action_at', 'last_action_by'])

        return {
            'suggestion_id': str(suggestion.id),
            'action': kind.upper(),
            'action_status': suggestion.action_status,
            'draft_ref': draft_ref,
        }
