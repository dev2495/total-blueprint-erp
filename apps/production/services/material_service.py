from decimal import Decimal
from django.db import transaction
from django.utils import timezone
from apps.artwork.print_contract import validate_frozen_printing_snapshot
from apps.production.models import ProductionJob, MaterialConsumptionLog, WorkCenterAssignment
from apps.inventory.models import InventoryRoll
from apps.inventory.services.roll_service import RollService
from apps.bom.services_resolver import BOMResolverService
from apps.physics.services_physics import PhysicsEngine


class MaterialConsumptionService:
    @staticmethod
    def calculate_projected_consumption(job: ProductionJob, output_qty: Decimal):
        """
        Calculates theoretical consumption based on BOM and Output Qty.
        Returns a list of consumption dicts (material/roll, qty, uom).
        """
        # 1. Get BOM Snapshot and Payload for dynamic calculations
        geometry_snapshot = (
            (job.sales_order_item.geometry_snapshot if getattr(job, "sales_order_item", None) else None)
            or (job.mts_order.geometry_snapshot if getattr(job, "mts_order", None) else None)
            or {}
        )
        layer_snapshot = (
            (job.sales_order_item.layer_snapshot if getattr(job, "sales_order_item", None) else None)
            or (job.mts_order.layer_snapshot if getattr(job, "mts_order", None) else None)
            or []
        )
        printing_snapshot = (
            (job.sales_order_item.printing_snapshot if getattr(job, "sales_order_item", None) else None)
            or (job.mts_order.printing_snapshot if getattr(job, "mts_order", None) else None)
            or {}
        )
        addons_snapshot = (
            (job.sales_order_item.addons_snapshot if getattr(job, "sales_order_item", None) else None)
            or (job.mts_order.addons_snapshot if getattr(job, "mts_order", None) else None)
            or []
        )

        if isinstance(printing_snapshot, dict) and bool(printing_snapshot.get("enabled", False)):
            printing_snapshot = validate_frozen_printing_snapshot(
                printing_snapshot,
                layer_snapshot=layer_snapshot,
                require_artwork=True,
                strict_inks=True,
            )

        payload = {
            "finished_good_type": (job.template.fg_type if job.template else "POUCH"),
            "geometry": geometry_snapshot,
            "film_layers": layer_snapshot,
            "printing": printing_snapshot,
            "chemicals": (printing_snapshot or {}).get("chemicals") if isinstance(printing_snapshot, dict) else {},
            "addons": addons_snapshot,
            "order_qty": float(output_qty), # Dynamic based on output
            "uom": job.uom
        }

        bom = None
        if job.sales_order_item and job.sales_order_item.bom_snapshot:
            bom = job.sales_order_item.bom_snapshot
        else:
            # We only need the BOM part, specifically weights
            physics = PhysicsEngine.calculate(payload)
            bom = BOMResolverService.resolve(payload, physics)

        consumption_plan = []
        
        # 2. Bulk Materials (Granules, Chems, Addons)
        # These are consumed from Bulk Inventory via BulkService
        # We need to map BOM items to InventoryMaterial
        
        # Helper to process a BOM section
        def process_section(items, section_name):
            if not items: return
            for item in items:
                # We need material_id from the BOM item. 
                # BOMResolver usually provides material_id or code.
                mat_id = item.get('material_id')
                if not mat_id: continue
                
                weight_kg = Decimal(str(item.get('weight_kg', 0)))
                # Proportional calculation if bom was for full order but we are calculating for partial output?
                # Actually PhysicsEngine.calculate with output_qty gives exact requirements for that qty.
                
                consumption_plan.append({
                    "type": "BULK",
                    "material_id": mat_id,
                    "quantity": weight_kg,
                    "uom": "KG",
                    "source": section_name
                })

        process_section(bom.get('granules', []), 'Granules')

        process_section(bom.get('chemicals', []), 'Chemicals')
        process_section(bom.get('addons', []), 'Addons')

        # New POD Logic (Phase 51)
        pod_res = PhysicsEngine.calculate_pod_consumption(payload, Decimal(str(output_qty)))
        if pod_res:
            # We need to find the material_id for this POD material
            from apps.materials.models import InventoryMaterial
            try:
                pod_mat = InventoryMaterial.objects.get(code=pod_res['material_code'])
                consumption_plan.append({
                    "type": "BULK",
                    "material_id": pod_mat.id,
                    "quantity": Decimal(str(pod_res['weight_kg'])),
                    "uom": "KG",
                    "source": f"POD Film ({pod_res['pod_type']})"
                })
            except InventoryMaterial.DoesNotExist:
                # Log or handle missing POD material
                pass

        # 3. Rolls (Films)
        # These are consumed from Assigned Rolls (WorkCenterAssignment)
        # We need to distribute the BOM requirement across assigned rolls of the matching variant.
        
        assignment = getattr(job, 'assignment', None)
        assigned_rolls = list(assignment.allocated_rolls.filter(status='AVAILABLE')) if assignment else []
        
        for film in bom.get('films', []):
            mat_id = film.get('material_id')
            required_qty = Decimal(str(film.get('weight_kg', 0)))
            
            # Find matching rolls
            matching_rolls = [r for r in assigned_rolls if r.material_id == mat_id]
            
            # FIFO Consumption logic (simplified: consume from first available)
            remaining_req = required_qty
            
            for roll in matching_rolls:
                if remaining_req <= 0: break
                
                # Check roll balance (we need to know current weight)
                # Assuming roll.weight_kg is current balance.
                consume = min(roll.weight_kg, remaining_req)
                
                consumption_plan.append({
                    "type": "ROLL",
                    "roll_id": roll.id,
                    "material_id": mat_id,
                    "quantity": consume,
                    "uom": "KG",
                    "source": "Films"
                })
                
                remaining_req -= consume

        return consumption_plan

    @staticmethod
    @transaction.atomic
    def finalize_consumption(job: ProductionJob, final_output_qty: Decimal):
        """
        Commits consumption to Ledger and updates Stock/Rolls.
        Called once at Job Completion.
        """
        plan = MaterialConsumptionService.calculate_projected_consumption(job, final_output_qty)
        
        for item in plan:
            # 1. Skip ROLL items if they are already handled by RollService in log_output
            # This is common for jobs with input_form == 'ROLL'
            if item['type'] == 'ROLL' and job.input_form == 'ROLL':
                continue

            # 2. Create Log
            MaterialConsumptionLog.objects.create(
                production_job=job,
                material_id=item['material_id'],
                roll_id=item.get('roll_id'),
                quantity=item['quantity'],
                uom=item['uom'],
                is_estimated=True # Calculated via BOM
            )
            
            # 2. Update Inventory (Ledger + Stock/Roll model)
            if item['type'] == 'ROLL' and item.get('roll_id'):
                roll = InventoryRoll.objects.get(id=item['roll_id'])

                # Strict compliance: do not mutate roll balance directly.
                # Route all roll depletion through RollService so genealogy
                # and consumption audit stay consistent with the rest of the ERP.
                RollService.consume_input_only(
                    input_roll=roll,
                    used_kg=item['quantity'],
                    job=job,
                    process=job.current_process,
                    machine=None,
                    user=None,
                    notes=f"Projected BOM issue for Job {job.job_number}",
                )

            elif item['type'] == 'BULK':
                # Deduct from Pooled Stock at Job's From Location
                location = job.from_location
                if location:
                    from apps.inventory.services.bulk_service import BulkService
                    BulkService.consume_bulk(
                        material_id=item['material_id'],
                        qty=item['quantity'],
                        location_id=location.id,
                        job_id=job.id,
                        reference=f"Consumed for Job {job.job_number}",
                        qty_uom=item.get("uom"),
                    )
