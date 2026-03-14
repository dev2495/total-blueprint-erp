
import os
import django
import uuid
from decimal import Decimal

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from apps.factory.models import Plant, Process, WorkCenter, Machine, WorkCenterProcess
from apps.inventory.models import InventoryLocation, InventoryRoll, InventoryMaterial
from apps.templates.models import TemplateBlueprint
from apps.routing.models import RoutingRule
from apps.production.models import ProductionJob, WorkCenterAssignment
from apps.production.services import JobService, WCManagerService
from apps.production.services.roll_allocation_service import RollAllocationService
from apps.users.models import User

def verify_phase_29():
    print("🚀 Starting Phase 29 Verification: Work Center Execution & Roll Allocation\n")

    # 1. Setup Data
    plant = Plant.objects.first()
    user = User.objects.filter(is_superuser=True).first()
    
    # Processes
    ext_proc, _ = Process.objects.get_or_create(code="EXTRUSION", defaults={"name": "Extrusion", "input_form": "BULK", "output_form": "ROLL"})
    prn_proc, _ = Process.objects.get_or_create(code="PRINTING", defaults={"name": "Printing", "input_form": "ROLL", "output_form": "ROLL"})
    
    # Work Center & Machine
    wc, _ = WorkCenter.objects.get_or_create(name="WC-1", defaults={"plant": plant})
    machine, _ = Machine.objects.get_or_create(name="Machine-1", defaults={"work_center": wc})
    WorkCenterProcess.objects.get_or_create(work_center=wc, process=ext_proc)
    WorkCenterProcess.objects.get_or_create(work_center=wc, process=prn_proc)

    routing, _ = RoutingRule.objects.get_or_create(name="Phase 29 Routing", defaults={
        "ordered_processes": ["EXTRUSION", "PRINTING"]
    })

    template, _ = TemplateBlueprint.objects.get_or_create(name="Phase 29 Template", defaults={
        "routing_rule": routing,
        "fg_type": "ROLL",
        "geometry_schema": {"width_mm": 1000}
    })

    # --- Case 1: Bulk Process (Extrusion) ---
    print("Case 1: Bulk Process (Extrusion)")
    job_ext = ProductionJob.objects.create(
        job_number=f"JOB-29-EXT-{uuid.uuid4().hex[:4]}",
        origin='MTO',
        template=template,
        routing_rule=routing,
        current_step_index=0,
        current_process=ext_proc,
        input_form='BULK',
        output_form='ROLL',
        work_center=wc,
        quantity=500,
        uom='KG',
        job_state='PLANNED'
    )
    
    # Release Job
    JobService.release_job(job_ext.id)
    assignment = WorkCenterAssignment.objects.get(production_job=job_ext)
    print(f"  ✅ WorkCenterAssignment created: {assignment.status}")
    
    # Try marking ready without machine (should fail)
    try:
        WCManagerService.mark_execution_ready(assignment.id)
    except ValueError as e:
        print(f"  ✅ Validation caught: {e}")

    # Assign Machine
    WCManagerService.assign_machine(assignment.id, machine.id)
    print(f"  ✅ Machine assigned: {machine.name}")
    
    # Mark Ready (Bulk process doesn't need rolls)
    WCManagerService.mark_execution_ready(assignment.id)
    assignment.refresh_from_db()
    print(f"  ✅ Status updated to: {assignment.status}")
    assert assignment.status == 'EXECUTION_READY'

    # --- Case 2: Roll Input Process (Printing) ---
    print("\nCase 2: Roll Input Process (Printing)")
    job_prn = ProductionJob.objects.create(
        job_number=f"JOB-29-PRN-{uuid.uuid4().hex[:4]}",
        origin='MTO',
        template=template,
        routing_rule=routing,
        current_step_index=1,
        current_process=prn_proc,
        input_form='ROLL',
        output_form='ROLL',
        work_center=wc,
        quantity=500,
        uom='KG',
        job_state='PLANNED'
    )
    
    JobService.release_job(job_prn.id)
    assignment_prn = WorkCenterAssignment.objects.get(production_job=job_prn)
    WCManagerService.assign_machine(assignment_prn.id, machine.id)
    
    # Create an eligible roll
    roll = InventoryRoll.objects.create(
        label_id=f"WIP-TEST-{uuid.uuid4().hex[:4]}",
        material=InventoryMaterial.objects.first(),
        width_mm=1000,
        weight_kg=100,
        location=InventoryLocation.objects.filter(plant=plant, type='WIP').first(),
        template=template,
        current_step_index=1, # Completed Step 0
        status='AVAILABLE',
        production_job=job_ext
    )
    
    eligible = RollAllocationService.get_eligible_rolls(job_prn)
    print(f"  ✅ Eligible rolls found: {eligible.count()}")
    assert roll in eligible
    
    # Try marking ready without rolls (should fail)
    try:
        WCManagerService.mark_execution_ready(assignment_prn.id)
    except ValueError as e:
        print(f"  ✅ Validation caught: {e}")

    # Allocate Roll
    WCManagerService.assign_rolls(assignment_prn.id, [roll.id], user)
    print(f"  ✅ Roll allocated: {roll.label_id}")
    
    # Mark Ready
    WCManagerService.mark_execution_ready(assignment_prn.id)
    assignment_prn.refresh_from_db()
    print(f"  ✅ Status updated to: {assignment_prn.status}")
    assert assignment_prn.status == 'EXECUTION_READY'

    print("\n✨ All Phase 29 checks passed!")

if __name__ == "__main__":
    verify_phase_29()
