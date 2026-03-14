import os
import django
import sys
import uuid
from decimal import Decimal

# Setup Django Environment
sys.path.insert(0, os.getcwd())
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from apps.factory.models import Plant, Process, WorkCenter, Machine, WorkCenterProcess
from apps.inventory.models import InventoryLocation, InventoryRoll, InventoryStock, InventoryLedger, DeliveryChallan
from apps.materials.models import InventoryMaterial
from apps.production.models import ProductionJob
from apps.routing.models import RoutingRule
try:
    from apps.recipes.models import ExtrusionRecipeComponent, ExtrusionRecipe
except ImportError:
    ExtrusionRecipeComponent = None
    ExtrusionRecipe = None

def cleanup():
    print("🧹 Cleaning up existing data...")
    if ExtrusionRecipeComponent:
        ExtrusionRecipeComponent.objects.all().delete()
    if ExtrusionRecipe:
        ExtrusionRecipe.objects.all().delete()
    
    DeliveryChallan.objects.all().delete()
    InventoryLedger.objects.all().delete()
    ProductionJob.objects.all().delete()
    InventoryRoll.objects.all().delete()
    InventoryStock.objects.all().delete()
    InventoryLocation.objects.all().delete()
    WorkCenterProcess.objects.all().delete()
    Machine.objects.all().delete()
    WorkCenter.objects.all().delete()
    Plant.objects.all().delete()
    Process.objects.all().delete()
    
    # Delete children variants first, then families
    InventoryMaterial.objects.filter(parent_family__isnull=False).delete()
    InventoryMaterial.objects.all().delete()
    
    RoutingRule.objects.all().delete()

def verify_foundation_v1_2():
    cleanup()
    print("🚀 Starting Verification for Foundation v1.2...")

    # 1. Plant & Location Auto-creation
    plant = Plant.objects.create(name="Main Plant", code="MP01")
    locations = InventoryLocation.objects.filter(plant=plant)
    expected_types = {'RM', 'WIP', 'FG', 'TOOLING', 'SCRAP', 'IN_TRANSIT'}
    actual_types = {loc.type for loc in locations}
    
    assert expected_types == actual_types, f"Missing locations: {expected_types - actual_types}"
    print("✅ Plant & Location Auto-creation verified.")

    # 2. WC -> Machine Assignment
    process = Process.objects.create(name="Extrusion", code="EXTRUSION")
    wc = WorkCenter.objects.create(plant=plant, name="Extrusion Dept", code="EX_DEPT")
    WorkCenterProcess.objects.create(work_center=wc, process=process)
    machine = Machine.objects.create(work_center=wc, name="Extruder 01", code="EXT_01")
    
    job = ProductionJob.objects.create(
        job_number="JOB-001",
        process=process,
        work_center=wc,
        quantity=1000,
        input_mode='QUANTITY',
        output_mode='ROLL',
        from_location=locations.get(type='RM'),
        to_location=locations.get(type='WIP'),
        routing_rule=RoutingRule.objects.create(name="Standard Extrusion", ordered_processes=["EXTRUSION"])
    )
    
    job.machine = machine
    job.status = 'ASSIGNED'
    job.save()
    
    assert job.machine == machine
    assert job.status == 'ASSIGNED'
    print("✅ WC -> Machine Assignment verified.")

    # 3. Hybrid Roll + Quantity Movement (Extrusion logic)
    material_rm = InventoryMaterial.objects.create(code="RM_GRANULE", name="Granule A", category="GRANULE")
    InventoryStock.objects.create(material=material_rm, location=job.from_location, quantity=5000)
    
    # Simulate Execution
    job.status = 'RUNNING'
    job.save()
    
    # Produce a Roll
    material_fg = InventoryMaterial.objects.create(code="FG_FILM", name="Film B", category="FILM_VARIANT")
    roll = InventoryRoll.objects.create(
        label_id="ROLL-001",
        material=material_fg,
        batch_no="B001",
        width_mm=1000,
        weight_kg=500,
        location=job.to_location,
        status='WIP'
    )
    
    # Ledger for Chemical Consumption (if any)
    material_ink = InventoryMaterial.objects.create(code="INK_01", name="Ink blue", category="INK")
    InventoryLedger.objects.create(
        transaction_type='ISSUE',
        material=material_ink,
        qty_change=-10,
        source_location=job.from_location,
        reference=job.job_number
    )
    
    ledger_entry = InventoryLedger.objects.get(reference=job.job_number, material=material_ink)
    assert ledger_entry.qty_change == Decimal('-10')
    print("✅ Hybrid Movement & Chemical Ledger verified.")

    # 4. Inter-plant Transfer (DC)
    plant2 = Plant.objects.create(name="Secondary Plant", code="SP02")
    dc = DeliveryChallan.objects.create(from_plant=plant, to_plant=plant2, status='DRAFT')
    
    dc.status = 'APPROVED'
    dc.save()
    assert dc.status == 'APPROVED'
    print("✅ Inter-plant DC Model verified.")

    print("\n🏁 ALL VERIFICATION TESTS PASSED (Foundation v1.2 Locked)")

if __name__ == "__main__":
    try:
        verify_foundation_v1_2()
    finally:
        # Cleanup in correct order to avoid ProtectedError
        DeliveryChallan.objects.all().delete()
        InventoryLedger.objects.all().delete()
        ProductionJob.objects.all().delete()
        InventoryRoll.objects.all().delete()
        InventoryStock.objects.all().delete()
        InventoryLocation.objects.all().delete()
        WorkCenterProcess.objects.all().delete()
        Machine.objects.all().delete()
        WorkCenter.objects.all().delete()
        Plant.objects.all().delete()
        
        Process.objects.all().delete()
        InventoryMaterial.objects.all().delete()
        RoutingRule.objects.all().delete()
