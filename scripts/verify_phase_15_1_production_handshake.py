import os
import sys
import django
import uuid
from decimal import Decimal
from pathlib import Path

# Add project root to sys.path
root_path = Path(__file__).resolve().parent.parent
sys.path.append(str(root_path))

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from apps.templates.models import TemplateBlueprint
from apps.sales.services.order_service import SalesOrderService
from apps.sales.models import SalesOrder
from apps.production.models import ProductionJob
from apps.production.services import JobService
from apps.routing.models import RoutingRule
from apps.factory.models import Process
from apps.users.models import User, Role

def verify_handshake():
    print("--- Verifying Phase 15.1 Production Handshake ---")
    
    # 0. Cleanup and Setup
    ProductionJob.objects.all().delete()
    role, _ = Role.objects.get_or_create(role_code='OPERATOR', defaults={'name': 'Operator'})
    user, _ = User.objects.get_or_create(username='testoperator', defaults={'role': role})
    p1, _ = Process.objects.get_or_create(code='EXT', name='Extrusion')
    p2, _ = Process.objects.get_or_create(code='PRN', name='Printing')
    rule, _ = RoutingRule.objects.get_or_create(name='Multi Step Rule', defaults={'ordered_processes': ['EXT', 'PRN']})
    
    # 1. Setup LIVE Template
    template = TemplateBlueprint.objects.create(
        name="Live Pouch",
        fg_type="POUCH",
        status="LIVE",
        routing_rule=rule,
        geometry_schema={"base": {"width_mm": 100, "height_mm": 200}},
        layer_schema=[]
    )
    
    # 2. Create and Confirm Order
    order = SalesOrder.objects.create(customer_name="Handshake Test")
    item = order.items.create(
        template=template,
        qty_value=500,
        qty_uom="KG",
        mode="TEMPLATE"
    )
    
    print(f"Order {order.order_number} confirmed. Generating jobs...")
    SalesOrderService.confirm_sales_order(order.id)
    
    # 3. Check Jobs
    jobs = ProductionJob.objects.filter(sales_order_item=item).order_by('routing_step_index')
    print(f"Jobs generated: {jobs.count()}")
    assert jobs.count() == 2
    
    for job in jobs:
        print(f"Job {job.job_number}: {job.process.code}, State: {job.job_state}")
        assert job.job_state == 'PLANNED'

    # 4. Verify Lifecycle
    job = jobs[0]
    print(f"Releasing job {job.job_number}...")
    JobService.release_job(job.id)
    job.refresh_from_db()
    assert job.job_state == 'RELEASED'
    
    # Needs assignment before start
    from apps.factory.models import Machine, WorkCenter, Plant
    plant = Plant.objects.create(name="Test Plant", code="TP1")
    wc = WorkCenter.objects.create(name="Test WC", code="TWC", plant=plant)
    machine = Machine.objects.create(name="Test Machine", code="TM1", work_center=wc)
    
    print(f"Assigning job {job.job_number}...")
    JobService.assign_job(job, machine, user)
    job.refresh_from_db()
    assert job.status == 'ASSIGNED'

    print(f"Starting job {job.job_number}...")
    JobService.start_job(job)
    job.refresh_from_db()
    assert job.job_state == 'EXECUTING'
    
    print(f"Pausing job {job.job_number}...")
    JobService.pause_job(job.id, reason="Test Pause")
    job.refresh_from_db()
    assert job.job_state == 'PAUSED'
    assert job.hold_reason == "Test Pause"
    
    print(f"Resuming job {job.job_number}...")
    JobService.resume_job(job.id)
    job.refresh_from_db()
    assert job.job_state == 'EXECUTING'
    
    print(f"Completing job {job.job_number}...")
    JobService.complete_job(job, 505)
    job.refresh_from_db()
    assert job.job_state == 'COMPLETED'
    assert job.quantity == 505

    print("--- Handshake Verification PASSED ---")

if __name__ == "__main__":
    verify_handshake()
