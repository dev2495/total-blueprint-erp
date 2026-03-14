import os
import sys
import django
from decimal import Decimal

# Setup Django
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from django.contrib.auth import get_user_model
from apps.users.models import Role # Import Role
from apps.factory.models import Plant, WorkCenter, Machine, Process, WorkCenterProcess
from apps.inventory.models import InventoryLocation, InventoryMaterial, InventoryRoll, InventoryStock
from apps.templates.models import TemplateBlueprint
from apps.routing.models import RoutingRule
from apps.sales.models import SalesOrder, SalesOrderItem
from apps.production.services import JobService, WCManagerService, OperatorService
from apps.production.models import ProductionJob

User = get_user_model()

def setup_data():
    print("--- Setting up Data ---")
    role, _ = Role.objects.get_or_create(role_code="OPERATOR", defaults={"name": "Operator"})
    user, _ = User.objects.get_or_create(username="operator_test", defaults={"email":"op@test.com", "role": role})
    
    plant, _ = Plant.objects.get_or_create(code="PLANT-17", defaults={"name":"Test Plant 17"})
    
    loc_wip, _ = InventoryLocation.objects.get_or_create(plant=plant, code="WIP-17", defaults={"name":"WIP Area", "type":"WIP"})
    loc_fg, _ = InventoryLocation.objects.get_or_create(plant=plant, code="FG-17", defaults={"name":"FG Area", "type":"FG"})
    
    # Process & Routing
    # Process & Routing
    proc_ext, _ = Process.objects.get_or_create(code="EXT-17", defaults={"name":"Extrusion", "category":"EXTRUSION"})
    routing, _ = RoutingRule.objects.get_or_create(name="Simple Extrusion-17", defaults={"ordered_processes": ["EXT-17"]})
    # routing.ordered_processes = ["EXT-17"] # already in defaults
    
    # Work Center & Machine
    wc, _ = WorkCenter.objects.get_or_create(code="WC-EXT-17", plant=plant, defaults={"name":"Extrusion WC"})
    WorkCenterProcess.objects.get_or_create(work_center=wc, process=proc_ext)
    
    machine, _ = Machine.objects.get_or_create(code="M-EXT-01", work_center=wc, defaults={"name":"Extruder 01"})
    
    # Template
    template, _ = TemplateBlueprint.objects.get_or_create(
        name="Test Template 17",
        defaults={
            "status": "APPROVED",
            "fg_type": "ROLL",
            "routing_rule": routing,
            "geometry_schema": {"width": 100},
            "layer_schema": [{"material": "PE", "ratio": 100}], # Simplified
            "chemistry_gsm": {},
            "addons_schema": []
        }
    )
    
    # Material & Stock (Granules)
    mat_granule, _ = InventoryMaterial.objects.get_or_create(code="GR-17", defaults={"name":"Test Granule", "category":"GRANULE"})
    
    # Mock BOM Snapshot (usually resolved by Physics)
    bom_snapshot = {
        "granules": [{"material_id": str(mat_granule.id), "weight_kg": 100}],
        "films": [] # No input rolls for extrusion usually
    }
    
    # Sales Order
    so, _ = SalesOrder.objects.get_or_create(order_number="SO-17", defaults={"customer_name":"Test Cust"})
    so_item, _ = SalesOrderItem.objects.get_or_create(
        sales_order=so,
        template=template,
        defaults={
            "qty_value": 100,
            "qty_uom": "KG",
            "bom_snapshot": bom_snapshot
        }
    )
    
    # Stock setup
    InventoryStock.objects.update_or_create(
        material=mat_granule, location=loc_wip,
        defaults={"quantity": 1000}
    )

    return user, wc, machine, so_item, mat_granule, loc_wip

def verify_operator_flow():
    user, wc, machine, so_item, mat_granule, loc_wip = setup_data()
    
    print("\n--- 0. Cleanup ---")
    ProductionJob.objects.filter(sales_order_item=so_item).delete()
    
    print("\n--- 1. Creating Jobs ---")
    jobs = JobService.create_jobs_for_so_item(so_item)
    job = jobs[0]
    print(f"Created Job: {job.job_number} | State: {job.job_state}")
    
    # Link Locations (since JobService basic logic might miss if using mocks)
    job.from_location = loc_wip
    job.save()
    
    print("\n--- 2. WC Manager Assignment ---")
    # Release first (Planner)
    JobService.release_job(job.id)
    
    assignment = WCManagerService.prepare_job_for_wc(job)
    WCManagerService.assign_machine(assignment.id, machine.id)
    WCManagerService.mark_execution_ready(assignment.id)
    job.refresh_from_db()
    
    print(f"Job Assignment Status: {job.assignment.status}")
    assert job.assignment.status == 'EXECUTION_READY', "Assignment should be EXECUTION_READY"
    
    print("\n--- 3. Operator: Start Job ---")
    OperatorService.start_job(job.id, user)
    job.refresh_from_db()
    print(f"Job State: {job.job_state}")
    assert job.job_state == 'EXECUTING', "Job should be EXECUTING"
    assert job.status == 'RUNNING', "Job Status should be RUNNING"
    
    print("\n--- 4. Operator: Log Output ---")
    OperatorService.log_output(job.id, 50.0, user)
    OperatorService.log_output(job.id, 45.0, user) # Total 95
    
    # Verify Logs
    logs = job.execution_logs.all()
    print(f"Execution Logs: {logs.count()}")
    assert logs.count() == 2
    
    print("\n--- 5. Operator: Log Scrap ---")
    OperatorService.log_scrap(job.id, 5.0, "SETUP", "Initial setup waste", user)
    
    # Verify Logs
    scraps = job.scrap_logs.all()
    print(f"Scrap Logs: {scraps.count()}")
    assert scraps.count() == 1
    
    print("\n--- 6. Operator: Complete Job ---")
    OperatorService.complete_job(job.id, user)
    job.refresh_from_db()
    
    print(f"Job Final State: {job.job_state}")
    assert job.job_state == 'COMPLETED'
    assert job.quantity == 95.0 # Updated to actual? Or remains planned? 
    # JobService.complete_job updates job.quantity to final_qty.
    
    print("\n--- 7. Verifying Material Consumption ---")
    cons_logs = job.consumption_logs.all()
    print(f"Consumption Logs: {cons_logs.count()}")
    assert cons_logs.count() >= 1
    
    total_consumed = sum(l.quantity for l in cons_logs)
    print(f"Total Consumed (Expected ~100kg for 100kg output/scrap): {total_consumed}")
    
    # Check Stock
    stock = InventoryStock.objects.get(material=mat_granule, location=loc_wip)
    print(f"Remaining Stock: {stock.quantity}")
    assert stock.quantity < 1000, "Stock should be reduced"
    
    print("\n--- VERIFICATION SUCCESSFUL ---")

if __name__ == "__main__":
    verify_operator_flow()
