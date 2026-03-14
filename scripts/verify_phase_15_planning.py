import os
import django
import sys
from decimal import Decimal

# Setup Django Environment
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from apps.factory.models import Plant, Process, WorkCenter, WorkCenterProcess
from apps.materials.models import InventoryMaterial
from apps.routing.models import RoutingRule
from apps.templates.models import TemplateBlueprint
from apps.production.models import ProductionJob, PlannedOrder
from apps.production.services import JobService
from apps.production.services_planning import PlanningService
from apps.production.services_control import JobControlService
from apps.inventory.models import JobWorkOrder

def run_test():
    print(">>> Phase 15 Verification: Production Planning & Control")

    # 1. Setup Data
    print("\n--- 1. Setup ---")
    plant, _ = Plant.objects.get_or_create(code="PLANT-15", defaults={'name': 'Planning Plant'})
    
    proc_ext, _ = Process.objects.get_or_create(code="EXT-P15", defaults={'name': 'Extrusion'})
    proc_bag, _ = Process.objects.get_or_create(code="BAG-P15", defaults={'name': 'Bagging'})
    
    wc, _ = WorkCenter.objects.get_or_create(code="WC-P15", defaults={'name': 'Combo WC', 'plant': plant})
    WorkCenterProcess.objects.get_or_create(work_center=wc, process=proc_ext)
    WorkCenterProcess.objects.get_or_create(work_center=wc, process=proc_bag)

    routing, _ = RoutingRule.objects.get_or_create(
        name="RULE-P15",
        defaults={'ordered_processes': ["EXT-P15", "BAG-P15"]}
    )

    template, _ = TemplateBlueprint.objects.get_or_create(
        name="TEMP-P15",
        defaults={
            'fg_type': 'ROLL',
            'status': 'LIVE',
            'routing_rule': routing,
            'geometry_schema': {'width': 500},
            'layer_schema': []
        }
    )
    # Ensure template is LIVE for MTS
    if template.status != 'LIVE':
        template.status = 'LIVE'
        template.save()

    # 2. Test MTS Order Creation
    print("\n--- 2. MTS Order Creation ---")
    mts_order = PlanningService.create_mts_order(
        template_id=template.id,
        quantity=500.0,
        plant_id=plant.id
    )
    print(f"MTS Order: {mts_order.reference_code}, Status: {mts_order.status}")
    assert mts_order.status == 'DRAFT'
    
    # Check no jobs spawned yet
    jobs_count = ProductionJob.objects.filter(job_number__startswith=mts_order.reference_code).count()
    print(f"Jobs spawned before release: {jobs_count}")
    assert jobs_count == 0

    # 3. Test MTS Release
    print("\n--- 3. MTS Release ---")
    PlanningService.release_mts_order(mts_order.id)
    mts_order.refresh_from_db()
    print(f"MTS Status after release: {mts_order.status}")
    assert mts_order.status == 'RELEASED'
    
    jobs = ProductionJob.objects.filter(job_number__startswith=mts_order.reference_code).order_by('routing_step_index')
    print(f"Jobs spawned after release: {jobs.count()}")
    assert jobs.count() == 2
    
    for job in jobs:
        print(f"Job: {job.job_number} | State: {job.job_state} | Source: {job.source_type}")
        assert job.job_state == 'RELEASED'
        assert job.source_type == 'MTS'

    # 4. Test Job Control: Hold & Release
    print("\n--- 4. Job Control: Hold & Release ---")
    target_job = jobs[0]
    JobControlService.hold_job(target_job.id, "Material Shortage")
    target_job.refresh_from_db()
    print(f"Job state after hold: {target_job.job_state}, Hold: {target_job.is_on_hold}")
    assert target_job.job_state == 'PAUSED'
    assert target_job.is_on_hold is True

    # Verify visibility in WC Queue
    queue = JobService.get_work_center_queue(wc.id)
    print(f"Jobs in WC Queue: {queue.count()}")
    # Should only show the non-paused job (BAG-P15)
    assert target_job not in queue
    
    JobControlService.release_job(target_job.id)
    target_job.refresh_from_db()
    print(f"Job state after release: {target_job.job_state}")
    assert target_job.job_state == 'RELEASED'
    assert target_job.is_on_hold is False
    
    queue = JobService.get_work_center_queue(wc.id)
    assert target_job in queue

    # 5. Test Job Work Detour
    print("\n--- 5. Job Work Detour ---")
    jw_order = PlanningService.convert_job_to_jobwork(target_job.id, "External Print Shop")
    target_job.refresh_from_db()
    print(f"Job state during Job Work: {target_job.job_state}")
    assert target_job.job_state == 'PAUSED'
    assert jw_order.status == 'SENT'
    
    # Receive and Resume
    PlanningService.receive_jobwork_and_resume(jw_order.id, plant.id)
    target_job.refresh_from_db()
    print(f"Job state after Job Work Return: {target_job.job_state}, Routing Index: {target_job.routing_step_index}")
    assert target_job.job_state == 'RELEASED'
    assert target_job.routing_step_index == 1
    assert target_job.source_type == 'JOBWORK_RETURN'

    # 6. Test Priority Ordering
    print("\n--- 6. Priority Ordering ---")
    # Reset jobs for fresh testing
    ProductionJob.objects.all().delete()
    
    # Create 3 jobs with different priorities
    job_mid = ProductionJob.objects.create(
        job_number="JOB-MID", work_center=wc, routing_rule=routing, 
        quantity=100, job_state='RELEASED', priority=100
    )
    job_high = ProductionJob.objects.create(
        job_number="JOB-HIGH", work_center=wc, routing_rule=routing, 
        quantity=100, job_state='RELEASED', priority=10
    )
    job_low = ProductionJob.objects.create(
        job_number="JOB-LOW", work_center=wc, routing_rule=routing, 
        quantity=100, job_state='RELEASED', priority=500
    )
    
    queue = list(JobService.get_work_center_queue(wc.id))
    print("Queue Order:")
    for j in queue:
        print(f"  {j.job_number} (Priority: {j.priority})")
    
    assert queue[0] == job_high
    assert queue[1] == job_mid
    assert queue[2] == job_low

    print("\n>>> PHASE 15 PLANNING VERIFIED")

if __name__ == "__main__":
    try:
        with django.db.transaction.atomic():
            run_test()
    except Exception as e:
        print(f"\nFailed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
