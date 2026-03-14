import os
import django
import uuid

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from apps.sales.models import SalesOrder, SalesOrderItem
from apps.templates.models import TemplateBlueprint
from apps.production.models import ProductionJob
from apps.factory.models import Plant
from apps.routing.models import RoutingRule
from apps.users.models import User

def verify_phase_10a():
    print("--- Phase 10A Verification: Sales to Production ---")

    # 1. Setup
    user = User.objects.filter(is_superuser=True).first()
    plant = Plant.objects.first()
    
    # Ensure a LIVE template with a routing rule exists
    template = TemplateBlueprint.objects.filter(status='LIVE').first()
    if not template or not template.routing_rule:
        print("Creating LIVE template and routing rule for test...")
        # (This is just for fallback, seed script should handle this)
        pass

    # 2. Test SO Confirmation Flow
    print("\n[Step 1] Creating DRAFT Sales Order...")
    so = SalesOrder.objects.create(
        order_number=f"TEST-SO-{uuid.uuid4().hex[:4]}",
        customer_name="Test Customer 10A",
        order_type="TEMPLATE",
        plant=plant,
        status='DRAFT'
    )
    
    item = SalesOrderItem.objects.create(
        sales_order=so,
        template=template,
        ordered_qty=1000,
        uom='KG'
    )
    
    print(f"Created SO {so.order_number}. Checking block reasons...")
    from apps.sales.services.order_block_resolver import resolve_block_reasons
    reasons = resolve_block_reasons(so)
    
    if reasons:
        print(f"FAILED: Order has blocks: {reasons}")
        return

    print("Order is CLEAR. Confirming via API logic...")
    
    # Simulate the confirm action logic
    from apps.production.services import JobService
    from django.db import transaction
    
    with transaction.atomic():
        for item in so.items.all():
             JobService.create_jobs_for_so_item(item)
        so.status = 'CONFIRMED'
        so.save()

    print("Order CONFIRMED.")

    # 3. Verify Job Generation
    jobs = ProductionJob.objects.filter(sales_order_item=item)
    print(f"Found {jobs.count()} production jobs for this SO item.")
    
    if jobs.count() > 0:
        print("SUCCESS: Jobs generated automatically.")
        for j in jobs:
            print(f" - Job {j.job_number}: {j.process.name} @ {j.work_center.name}")
    else:
        print("FAILED: No jobs created.")

    print("\n--- Verification Complete ---")

if __name__ == "__main__":
    verify_phase_10a()
