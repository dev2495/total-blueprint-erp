from django.db import transaction
from django.core.exceptions import ValidationError
from django.utils import timezone
from apps.inventory.models import (
    JobWorkOrder, InventoryRoll, InventoryLocation, Vendor
)
from apps.inventory.services.bulk_service import BulkService
from apps.inventory.services.roll_service import RollService
from apps.factory.models import Plant
from apps.materials.models import InventoryMaterial
from apps.recipes.models import RecipeGrade
from typing import List, Dict, Any
from decimal import Decimal

class JobWorkService:
    @classmethod
    def _job_process_context(cls, production_job):
        process = getattr(production_job, "current_process", None) or getattr(production_job, "process", None)
        process_code = str(getattr(process, "code", "") or "").upper()
        plant = None
        if getattr(production_job, "work_center_id", None) and getattr(production_job, "work_center", None):
            plant = production_job.work_center.plant
        if not plant and getattr(production_job, "from_location_id", None) and getattr(production_job, "from_location", None):
            plant = production_job.from_location.plant
        if not plant and getattr(production_job, "to_location_id", None) and getattr(production_job, "to_location", None):
            plant = production_job.to_location.plant
        return process_code, plant

    @classmethod
    def vendor_matches_jobwork(cls, vendor: Vendor, *, process_code: str = "", plant=None) -> Dict[str, Any]:
        capabilities = [str(code or "").upper() for code in (vendor.jobwork_capabilities or []) if str(code or "").strip()]
        plants = [str(code or "").upper() for code in (vendor.jobwork_plants or []) if str(code or "").strip()]

        process_ok = True
        if capabilities and process_code:
            process_ok = process_code in capabilities

        plant_token_id = str(getattr(plant, "id", "") or "").upper()
        plant_token_code = str(getattr(plant, "code", "") or "").upper()
        plant_ok = True
        if plants:
            plant_ok = plant_token_id in plants or plant_token_code in plants

        vendor_active = str(vendor.status or "").upper() == "ACTIVE"
        vendor_type_ok = str(vendor.type or "").upper() in {"JOBWORK", "BOTH"}

        match = bool(vendor_active and vendor_type_ok and process_ok and plant_ok)
        reasons = []
        if not vendor_active:
            reasons.append("Vendor is not ACTIVE.")
        if not vendor_type_ok:
            reasons.append("Vendor type must be JOBWORK or BOTH.")
        if not process_ok:
            reasons.append(f"Vendor does not support process {process_code}.")
        if not plant_ok:
            reasons.append("Vendor is not mapped to this plant.")
        return {
            "match": match,
            "reasons": reasons,
            "process_ok": process_ok,
            "plant_ok": plant_ok,
        }

    @classmethod
    def compatible_vendors(cls, *, process_code: str = "", plant=None):
        vendors = Vendor.objects.filter(status="ACTIVE", type__in=["JOBWORK", "BOTH"]).order_by("name")
        rows = []
        for vendor in vendors:
            verdict = cls.vendor_matches_jobwork(vendor, process_code=process_code, plant=plant)
            rows.append((vendor, verdict))
        return rows

    @classmethod
    @transaction.atomic
    def create_order(cls, plant: Plant, vendor: Vendor,
                     sent_material_type: str, expected_return: str, 
                     production_job=None, notes: str = "",
                     mode: str | None = None, route_step_index=None, emergency_reason: str = "") -> JobWorkOrder:
        """
        Create a new Job Work Order.
        """
        process_code = ""
        resolved_plant = plant
        if production_job:
            process_code, plant_from_job = cls._job_process_context(production_job)
            if plant_from_job:
                resolved_plant = plant_from_job

        if vendor:
            verdict = cls.vendor_matches_jobwork(vendor, process_code=process_code, plant=resolved_plant)
            if not verdict["match"]:
                raise ValidationError(" ".join(verdict["reasons"]) or "Vendor is not compatible for this jobwork context.")

        default_mode = "PLANNED_STEP" if production_job else "EMERGENCY"
        safe_mode = str(mode or default_mode).upper()
        if safe_mode not in {"PLANNED_STEP", "EMERGENCY"}:
            raise ValidationError("mode must be PLANNED_STEP or EMERGENCY.")
        if safe_mode == "EMERGENCY" and not str(emergency_reason or "").strip():
            raise ValidationError("emergency_reason is required for EMERGENCY jobwork.")

        if route_step_index is None and production_job:
            route_step_index = int(getattr(production_job, "current_step_index", 0) or 0)

        return JobWorkOrder.objects.create(
            plant=resolved_plant,
            vendor=vendor,
            vendor_name=vendor.name if vendor else "",
            production_job=production_job,
            sent_material_type=sent_material_type,
            expected_return_type=expected_return,
            mode=safe_mode,
            route_step_index=route_step_index,
            emergency_reason=str(emergency_reason or "").strip(),
            notes=notes,
            status='DRAFT'
        )

    @classmethod
    @transaction.atomic
    def dispatch_material(cls, order_id: str, roll_ids: List[str] = None, bulk_items: List[Dict] = None):
        """
        Dispatch material to Job Worker.
        Moves stock to 'JOBWORK_OUT' virtual location.
        Uses RollService for rolls and BulkService for bulk.
        """
        order = JobWorkOrder.objects.get(id=order_id)
        if order.status == 'CLOSED':
            raise ValidationError("Cannot dispatch to a closed order.")

        # Find JOBWORK_OUT system location for this plant
        try:
            jw_loc = InventoryLocation.objects.get(plant=order.plant, code='JOBWORK_OUT', is_system=True)
        except InventoryLocation.DoesNotExist:
            raise ValidationError(f"System location JOBWORK_OUT not found for plant {order.plant.code}")

        # 1. Dispatch Rolls — Use RollService
        if roll_ids:
            rolls = InventoryRoll.objects.filter(id__in=roll_ids, location__plant=order.plant)
            
            for roll in rolls:
                allowed_statuses = {'AVAILABLE', 'RESERVED', 'IN_PROCESS', 'SENT_JOBWORK'}
                if roll.status not in allowed_statuses:
                    raise ValidationError(f"Roll {roll.label_id} cannot be dispatched from status {roll.status}.")
                linked_to_source = True
                if order.production_job_id:
                    linked_to_source = (
                        str(getattr(roll, "production_job_id", "") or "") == str(order.production_job_id)
                        or str(getattr(roll, "created_by_job_id", "") or "") == str(order.production_job_id)
                    )
                    if not linked_to_source:
                        meta = dict(order.meta_json or {})
                        cross = list(meta.get("cross_job_dispatch_rolls") or [])
                        if roll.label_id not in cross:
                            cross.append(roll.label_id)
                        meta["cross_job_dispatch_rolls"] = cross
                        order.meta_json = meta
                if roll.status in {'RESERVED', 'IN_PROCESS'}:
                    roll.status = 'AVAILABLE'
                    roll.save(update_fields=['status'])
                
                # Move roll to JW location and update status
                RollService.move_roll(
                    roll=roll,
                    to_location=jw_loc,
                    reason='JOBWORK',
                    reason_note=f"JW-OUT: {order.vendor_name}"
                )
                
                # Update roll status
                roll.status = 'SENT_JOBWORK'
                roll.save(update_fields=['status'])

        # 2. Dispatch Bulk — Use BulkService
        if bulk_items:
            for item in bulk_items:
                material = InventoryMaterial.objects.get(id=item['material_id'])
                qty = float(item['quantity'])
                source_loc = InventoryLocation.objects.get(id=item['location_id'])

                # Transfer bulk from source to JW location
                BulkService.transfer_bulk(
                    material_id=str(material.id),
                    qty=qty,
                    from_location_id=str(source_loc.id),
                    to_location_id=str(jw_loc.id),
                    reference=f"JW-OUT-BULK: {order.vendor_name}"
                )

        if order.status == 'DRAFT':
            order.status = 'SENT'
            order.dispatched_at = timezone.now()
            order.save(update_fields=['status', 'dispatched_at', 'meta_json', 'updated_at'])

    @classmethod
    @transaction.atomic
    def receive_material(cls, order_id: str, 
                         target_location: InventoryLocation,
                         received_rolls: List[Dict] = None, 
                         received_bulk: List[Dict] = None):
        """
        Receive processed material from Job Work.
        Uses RollService and BulkService for inventory updates.
        """
        order = JobWorkOrder.objects.get(id=order_id)
        if order.status == 'CLOSED':
            raise ValidationError("Order is closed.")

        # Resolve JW Location
        jw_loc = InventoryLocation.objects.get(plant=order.plant, code='JOBWORK_OUT', is_system=True)

        # 1. Receive Rolls — Use RollService
        if received_rolls:
            for data in received_rolls:
                # If 'roll_id' is provided, we transition existing roll back to available
                # If not, we create a new roll (output of conversion)
                if 'roll_id' in data:
                    roll = InventoryRoll.objects.get(id=data['roll_id'])
                    
                    # Move roll to target location
                    RollService.move_roll(
                        roll=roll,
                        to_location=target_location,
                        reason='JOBWORK',
                        reason_note=f"JW-IN: {order.vendor_name}"
                    )
                    
                    # Update status back to available
                    roll.status = 'AVAILABLE'
                    roll.save(update_fields=['status'])
                else:
                    # Create new roll for converted output
                    material = InventoryMaterial.objects.get(id=data['material_id'])
                    grade = None
                    if data.get('grade_id'):
                        try:
                            grade = RecipeGrade.objects.get(id=data['grade_id'])
                        except RecipeGrade.DoesNotExist as exc:
                            raise ValidationError("Selected return-roll grade was not found.") from exc
                    
                    roll = RollService.create_roll(
                        material=material,
                        weight_kg=Decimal(str(data['weight_kg'])),
                        location=target_location,
                        width_mm=Decimal(str(data['width_mm'])),
                        thickness_micron=Decimal(str(data['thickness_micron'])),
                        batch_no=data.get('batch_no', f"JW-{order.id}"),
                        length_m=Decimal(str(data.get('length_m', 0))),
                        grade=grade,
                        is_fg=False,
                        plant=order.plant,
                        user=None,
                        notes=f"JW-IN: {order.vendor_name}"
                    )
                    
                    # Label override if provided
                    if data.get('label_id'):
                        roll.label_id = data['label_id']
                        roll.save(update_fields=['label_id'])

        # 2. Receive Bulk — Use BulkService
        if received_bulk:
            for item in received_bulk:
                material = InventoryMaterial.objects.get(id=item['material_id'])
                qty = float(item['quantity'])
                
                # Transfer from JW location to target
                try:
                    BulkService.transfer_bulk(
                        material_id=str(material.id),
                        qty=qty,
                        from_location_id=str(jw_loc.id),
                        to_location_id=str(target_location.id),
                        reference=f"JW-IN-BULK: {order.vendor_name}"
                    )
                except ValidationError:
                    # If no stock at JW location (edge case), just add to target
                    BulkService.add_bulk(
                        material_id=str(material.id),
                        qty=qty,
                        plant_id=str(target_location.plant_id),
                        location_id=str(target_location.id),
                        reference=f"JW-IN-BULK: {order.vendor_name}"
                    )
        
        if order.status == 'SENT':
            order.status = 'PARTIAL'
            order.received_at = timezone.now()
            order.save()

        if order.production_job_id:
            from apps.production.models import ProductionJob

            job = ProductionJob.objects.filter(id=order.production_job_id).first()
            if job:
                mode = str(order.mode or "EMERGENCY").upper()
                if mode == "PLANNED_STEP":
                    from apps.production.services.job_services import JobService

                    try:
                        JobService.complete_step(
                            job,
                            user=None,
                            force_reason=f"Completed via planned jobwork return ({order.vendor_name})",
                        )
                    except Exception:
                        # Keep recoverable state for manual action if route-close automation fails.
                        job.job_state = "RELEASED"
                        job.hold_reason = f"Jobwork received ({order.vendor_name}); manual close required."
                        job.save(update_fields=["job_state", "hold_reason", "updated_at"])
                else:
                    job.job_state = "RELEASED"
                    job.hold_reason = None
                    job.save(update_fields=["job_state", "hold_reason", "updated_at"])
