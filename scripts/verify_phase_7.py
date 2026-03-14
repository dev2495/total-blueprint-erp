import os
import django
import sys
from decimal import Decimal

# Setup Django Environment
sys.path.insert(0, os.getcwd())
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from apps.factory.models import Plant, Process, WorkCenter, Machine, WorkCenterProcess
from apps.inventory.models import InventoryLocation, InventoryStock
from apps.inventory.services import InventoryService
from apps.production.models import ProductionJob
from apps.production.services import JobService
from apps.sales.models import SalesOrder, SalesOrderItem
from apps.templates.models import TemplateBlueprint
from apps.routing.models import RoutingRule
from apps.materials.models import InventoryMaterial
from apps.users.models import User, Role

def verify_erp_shell():
    print("🚀 Verifying ERP Foundation Wrapping (Phase 7)...")
    
    # 1. Verification of Plant Signal
    print("\n--- Testing Plant & Location Auto-creation ---")
    plant, _ = Plant.objects.get_or_create(code="PL01", name="Main Plant")
    locs = InventoryLocation.objects.filter(plant=plant)
    print(f"✅ Locations created for {plant.code}: {[l.type for l in locs]}")
    assert locs.filter(type='RM').exists()
    assert locs.filter(type='FG').exists()

    # 2. Setup Process & WC
    print("\n--- Testing WC -> Process Wiring ---")
    proc, _ = Process.objects.get_or_create(code="EXTRUSION", name="Extrusion")
    wc, _ = WorkCenter.objects.get_or_create(code="WC_EXT", name="Extrusion Dept", plant=plant)
    WorkCenterProcess.objects.get_or_create(work_center=wc, process=proc)
    machine, _ = Machine.objects.get_or_create(code="MACH01", name="Extruder 1", work_center=wc)
    print(f"✅ Machine {machine.code} linked to {proc.code}")

    # 3. Create Template & Routing
    print("\n--- Testing Routing & Template ---")
    rr, _ = RoutingRule.objects.get_or_create(
        name="Standard Extrusion",
        ordered_processes=["EXTRUSION"]
    )
    temp, _ = TemplateBlueprint.objects.get_or_create(
        name="Test Film Template",
        fg_type="ROLL",
        status="LIVE",
        routing_rule=rr
    )
    print(f"✅ Template '{temp.name}' created with routing")

    # 4. Sales Order -> Job Trigger
    print("\n--- Testing Sales Order -> Job Creation ---")
    so = SalesOrder.objects.create(
        order_number="SO-1001",
        customer_name="Global Corp",
        plant=plant
    )
    so_item = SalesOrderItem.objects.create(
        sales_order=so,
        template=temp,
        ordered_qty=Decimal("500.00"),
        uom="KG"
    )
    
    jobs = JobService.create_jobs_for_so_item(so_item)
    print(f"✅ Jobs created: {len(jobs)}")
    assert len(jobs) == 1
    job = jobs[0]
    print(f"✅ Job: {job.job_number} | Process: {job.process.code} | From: {job.from_location.type} | To: {job.to_location.type}")

    # 5. Inventory GRN
    print("\n--- Testing Inventory Inward (GRN) ---")
    material, _ = InventoryMaterial.objects.get_or_create(code="PE_RESIN", name="Polyethylene Resin", category="RESIN")
    rm_loc = locs.filter(type='RM').first()
    InventoryService.record_grn(material, rm_loc, Decimal("1000.00"))
    stock = InventoryStock.objects.get(material=material, location=rm_loc)
    print(f"✅ Stock Inwarded: {stock.quantity} {stock.uom}")
    assert stock.quantity == Decimal("1000.00")

    # 6. Job Start (Execution)
    print("\n--- Testing Job Execution (Start) ---")
    operator = User.objects.filter(role__role_code='OPERATOR').first()
    JobService.start_job(job, machine, operator)
    job.refresh_from_db()
    print(f"✅ Job Status: {job.status} | Machine: {job.machine.code} | Operator: {job.operator.username}")
    assert job.status == 'RUNNING'

    print("\n✨ ALL PHASE 7 VERIFICATION TESTS PASSED! ✨")

if __name__ == "__main__":
    verify_erp_shell()
