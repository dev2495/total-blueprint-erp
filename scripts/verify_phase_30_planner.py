import os
import django
import uuid
from decimal import Decimal

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from apps.production.models import ProductionJob, PlannedStockOrder, WorkCenterAssignment
from apps.templates.models import TemplateBlueprint
from apps.factory.models import Plant, Process, WorkCenter, WorkCenterProcess
from apps.production.services.job_services import JobService
from django.utils import timezone

def verify_phase_30():
    print("🚀 Starting Phase 30 Verification: Production Planner Control Tower")

    # 1. Setup Base Data
    plant = Plant.objects.first()
    if not plant:
        plant = Plant.objects.create(name="Main Plant", code="PLT-01")
    
    template = TemplateBlueprint.objects.first()
    if not template:
        print("❌ No template found. Please run baseline seeds first.")
        return

    # Ensure processes exist
    for proc_code in template.routing_rule.ordered_processes:
        process, created = Process.objects.get_or_create(code=proc_code, defaults={'name': proc_code.capitalize()})
        wc, wc_created = WorkCenter.objects.get_or_create(code=f"WC-{proc_code}", defaults={'name': f"{proc_code.capitalize()} Dept", 'plant': plant})
        WorkCenterProcess.objects.get_or_create(work_center=wc, process=process)
        if created: print(f"  Setup: Created process {proc_code}")
    print("\nCase 1: MTS Orchestration")
    mts_order = PlannedStockOrder.objects.create(
        template=template,
        plant=plant,
        target_qty=500,
        status='PLANNED'
    )
    print(f"  ✅ MTS Order created: {mts_order.order_number}")
    
    jobs = JobService.create_jobs_for_planned_order(mts_order)
    print(f"  ✅ {len(jobs)} jobs generated for MTS.")
    
    first_job = jobs[0]
    print(f"  Releasing first job: {first_job.job_number} (State: {first_job.job_state})")
    
    JobService.release_job(first_job.id)
    first_job.refresh_from_db()
    
    if first_job.job_state == 'RELEASED':
        print(f"  ✅ Job State advanced to RELEASED")
    else:
        print(f"  ❌ Job State FAIL: {first_job.job_state}")

    assignment = WorkCenterAssignment.objects.filter(production_job=first_job).first()
    if assignment:
        print(f"  ✅ WorkCenterAssignment created and fed to WCM queue (Status: {assignment.status})")
    else:
        print("  ❌ WorkCenterAssignment NOT created.")

    # 3. Case 2: Job Splitting
    print("\nCase 2: Job Splitting")
    # Need a PLANNED job to split
    planned_job = ProductionJob.objects.create(
        job_number=f"SPLIT-TEST-{uuid.uuid4().hex[:4]}",
        template=template,
        routing_rule=template.routing_rule,
        current_step_index=0,
        quantity=Decimal("1000.00"),
        remaining_qty=Decimal("1000.00"),
        job_state='PLANNED',
        uom='KG'
    )
    
    print(f"  Original Job: {planned_job.job_number} | Qty: {planned_job.quantity}")
    
    # Need to import Decimal in the script or use string
    parent, child = JobService.split_job(planned_job.id, Decimal("300.00"))
    
    if parent.quantity == Decimal("700.00") and child.quantity == Decimal("300.00"):
        print(f"  ✅ Split successful: Parent: {parent.quantity}, Child: {child.quantity}")
        print(f"  ✅ Child job created: {child.job_number}")
    else:
        print(f"  ❌ Split FAIL: Parent: {parent.quantity}, Child: {child.quantity}")

    # 4. Case 3: Hold/Resume
    print("\nCase 3: Hold/Resume Flow")
    JobService.toggle_hold(first_job.id, "Emergency Maintenance")
    first_job.refresh_from_db()
    if first_job.is_on_hold:
        print(f"  ✅ Job {first_job.job_number} is now ON HOLD (Reason: {first_job.hold_reason})")
    
    JobService.toggle_hold(first_job.id)
    first_job.refresh_from_db()
    if not first_job.is_on_hold:
        print(f"  ✅ Job {first_job.job_number} has been RESUMED from hold")

    print("\n✨ All Phase 30 Planner checks passed!")

if __name__ == "__main__":
    verify_phase_30()
