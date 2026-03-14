import os
import django
import uuid
from decimal import Decimal

import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
sys.path.append(str(root))

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.core.exceptions import ValidationError
from apps.inventory.models import InventoryLocation, InventoryRoll, InventoryStock, InventoryLedger, JobWorkOrder, DeliveryChallan
from apps.factory.models import Plant
from apps.materials.models import InventoryMaterial
from apps.production.models import ProductionJob

def verify_phase_13_logic():
    print("--- VERIFYING PHASE 13 REFINED LOGIC ---")
    
    # 1. Setup Test Data
    uid = str(uuid.uuid4())[:8]
    plant_a = Plant.objects.create(name=f"Plant A {uid}", code=f"PA{uid}")
    plant_b = Plant.objects.create(name=f"Plant B {uid}", code=f"PB{uid}")
    
    granule = InventoryMaterial.objects.create(name=f"Resin X {uid}", code=f"RX{uid}", category='GRANULE')
    film_family = InventoryMaterial.objects.create(name=f"BOPP Clear {uid}", code=f"BC{uid}", category='FILM_FAMILY', density_gcm3=Decimal('0.91'))
    
    # 2. Verify Auto-Location Creation (Signals)
    # The signal should have created locations for plant_a and plant_b
    system_locations = InventoryLocation.objects.filter(plant=plant_a, is_system=True)
    print(f"System locations for Plant A: {system_locations.count()}")
    assert system_locations.count() >= 5 # WIP, FG, SCRAP, JOBWORK_OUT, IN_TRANSIT
    
    warehouse_a = InventoryLocation.objects.create(plant=plant_a, name="Warehouse A", code="WHA", type='WAREHOUSE')
    qc_a = InventoryLocation.objects.create(plant=plant_a, name="QC A", code="QCA", type='QC')
    
    # 3. Verify GRN Location Governance
    from apps.inventory.services.grn import GRNService
    
    print("Verifying GRN Location Governance...")
    # Success: GRN to WAREHOUSE
    GRNService.create_bulk_grn(material=granule, location=warehouse_a, quantity=100, plant=plant_a)
    stock = InventoryStock.objects.get(location=warehouse_a, material=granule)
    assert stock.quantity == 100
    
    # Failure: GRN to WIP (System Location)
    wip_a = InventoryLocation.objects.get(plant=plant_a, code='WIP')
    try:
        GRNService.create_bulk_grn(material=granule, location=wip_a, quantity=100, plant=plant_a)
        raise Exception("GRN to WIP should have failed")
    except ValidationError as e:
        print(f"Correctly blocked GRN to WIP: {e}")

    # 4. Verify Job Work / Receive logic
    from apps.inventory.services.job_work import JobWorkService
    
    print("Verifying Job Work Flow...")
    order = JobWorkService.create_order(
        plant=plant_a,
        vendor_name="External Processor",
        sent_material_type='RM',
        expected_return='WIP'
    )
    
    # Create a roll to dispatch
    roll = InventoryRoll.objects.create(
        location=warehouse_a,
        material=film_family,
        label_id=f"TR-{uid}-01",
        width_mm=Decimal('1000'),
        weight_kg=Decimal('50.5'),
        status='AVAILABLE'
    )
    
    JobWorkService.dispatch_material(order.id, roll_ids=[roll.id])
    roll.refresh_from_db()
    assert roll.status == 'SENT_JOBWORK'
    assert roll.location.code == 'JOBWORK_OUT'
    
    # Receive back from Job Work
    JobWorkService.receive_material(
        order.id, 
        target_location=warehouse_a,
        received_rolls=[{
            'label_id': f"REC-{uid}-01",
            'material_id': film_family.id,
            'width_mm': 1000,
            'weight_kg': 48,
            'batch_no': 'B1'
        }]
    )
    order.refresh_from_db()
    # Order status changes to PARTIAL initially if not closed manually or logic not auto-closing
    # Let's check logic: if order.status == 'SENT': order.status = 'PARTIAL'
    assert order.status == 'PARTIAL'
    
    new_roll = InventoryRoll.objects.get(label_id=f"REC-{uid}-01")
    assert new_roll.location == warehouse_a
    assert new_roll.location.plant == plant_a

    # 5. Verify Inter-Plant Transfer
    from apps.inventory.services.inter_plant import InterPlantService
    
    print("Verifying Inter-Plant Transfer...")
    challan = InterPlantService.create_challan(from_plant_id=plant_a.id, to_plant_id=plant_b.id)
    InterPlantService.dispatch_challan(challan.id, roll_ids=[new_roll.id])
    
    new_roll.refresh_from_db()
    assert new_roll.location.code == 'IN_TRANSIT'
    assert new_roll.location.plant == plant_a
    
    warehouse_b = InventoryLocation.objects.create(plant=plant_b, name=f"Warehouse B {uid}", code=f"WHB{uid}", type='WAREHOUSE')
    InterPlantService.receive_challan(challan.id, target_location_id=warehouse_b.id, roll_ids=[new_roll.id])
    
    new_roll.refresh_from_db()
    assert new_roll.location.plant == plant_b
    assert new_roll.location == warehouse_b
    
    # 6. Verify Ledger Integrity
    print("Verifying Ledger...")
    ledger_entries = InventoryLedger.objects.filter(roll__label_id=f"REC-{uid}-01")
    print(f"Ledger entries for roll REC-{uid}-01: {ledger_entries.count()}")
    assert ledger_entries.count() >= 3
    
    print("--- ALL PHASE 13 LOGIC VERIFIED ---")

if __name__ == "__main__":
    verify_phase_13_logic()
