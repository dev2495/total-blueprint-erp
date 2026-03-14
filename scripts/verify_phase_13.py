import os
import django
import sys
from decimal import Decimal

# Setup Django Environment
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from apps.factory.models import Plant
from apps.materials.models import InventoryMaterial
from apps.inventory.models import InventoryLocation, InventoryStock, InventoryRoll, InventoryLedger, JobWorkOrder
from apps.inventory.services.grn import GRNService
from apps.inventory.services.stock import StockService
from apps.inventory.services.job_work import JobWorkService
from django.utils import timezone

def run_test():
    print(">>> Phase 13 Verification: Inventory Execution & Job Work Foundation")

    # 1. Setup Data
    print("\n--- 1. Setup ---")
    plant_code = "TEST_PLANT_13"
    plant, _ = Plant.objects.get_or_create(code=plant_code, defaults={'name': 'Test Plant 13'})
    
    # Verify System Locations
    print(f"Plant locations: {InventoryLocation.objects.filter(plant=plant).count()}")
    rm_loc = InventoryLocation.objects.get(plant=plant, code='RM')
    fg_loc = InventoryLocation.objects.get(plant=plant, code='FG')
    print("System locations confirmed.")

    # Materials
    bulk_mat, _ = InventoryMaterial.objects.get_or_create(
        code="BULK-001", 
        defaults={'name': 'Test Bulk Granule','category': 'GRANULE', 'base_uom': 'KG'}
    )
    film_fam, _ = InventoryMaterial.objects.get_or_create(
        code="FILM-FAM-001",
        defaults={'name': 'Test Film Family', 'category': 'FILM_FAMILY', 'base_uom': 'KG', 'density_gcm3': 0.92}
    )

    # 2. Test Bulk GRN
    print("\n--- 2. Bulk GRN ---")
    GRNService.create_bulk_grn(
        material=bulk_mat,
        location=rm_loc,
        quantity=100.0,
        plant=plant,
        reference="GRN-BULK-001"
    )
    
    # Check Stock
    stock = InventoryStock.objects.get(material=bulk_mat, location=rm_loc)
    print(f"Bulk Stock: {stock.quantity} {stock.uom}")
    assert stock.quantity == 100.0
    
    # Check Ledger
    ledger = InventoryLedger.objects.get(reference="GRN-BULK-001")
    print(f"Ledger: {ledger.transaction_type} +{ledger.qty_change} @ {ledger.dest_location.code}")
    assert ledger.qty_change == 100.0

    # 3. Test Roll GRN
    print("\n--- 3. Roll GRN ---")
    rolls_payload = [
        {'label_id': 'ROLL-001', 'width_mm': 1000, 'weight_kg': 50, 'batch_no': 'B1'},
        {'label_id': 'ROLL-002', 'width_mm': 1200, 'weight_kg': 60, 'batch_no': 'B1'}
    ]
    
    created_rolls = GRNService.create_roll_grn(
        material=film_fam,
        location=fg_loc,
        plant=plant,
        rolls_data=rolls_payload,
        reference="GRN-ROLL-001"
    )
    
    print(f"Created {len(created_rolls)} rolls.")
    assert len(created_rolls) == 2
    assert created_rolls[0].status == 'AVAILABLE'
    
    # Check Stock Service
    stock_summary = StockService.get_roll_stock(plant.id, fg_loc.id)
    print(f"Stock Summary Rolls: {len(stock_summary)}")
    assert len(stock_summary) >= 2

    # 4. Job Work - Dispatch
    print("\n--- 4. Job Work Dispatch ---")
    jw_order = JobWorkService.create_order(
        plant=plant, 
        vendor_name="Venkatesh Poly", 
        expected_return="FG",
        notes="Lamination Job"
    )
    
    # Dispatch ROLL-001
    roll_to_send = created_rolls[0]
    JobWorkService.dispatch_material(
        order_id=jw_order.id,
        roll_ids=[str(roll_to_send.id)],
        bulk_items=[] 
    )
    
    # Verify Dispatch
    roll_to_send.refresh_from_db()
    print(f"Roll Status: {roll_to_send.status}, Location: {roll_to_send.location.code}")
    assert roll_to_send.status == 'SENT_JOBWORK'
    assert roll_to_send.location.code == 'JOBWORK_OUT'
    
    dispatch_ledger = InventoryLedger.objects.filter(roll=roll_to_send, transaction_type='JOBWORK_OUT').last()
    assert dispatch_ledger is not None
    print("Dispatch Ledger Confirmed.")

    # 5. Job Work - Receive
    print("\n--- 5. Job Work Receive ---")
    # Receive processed roll (New Roll)
    received_roll_data = {
        'material_id': str(film_fam.id), # Returning as same material for simplicity test
        'label_id': 'ROLL-001-LAM',
        'width_mm': 1000,
        'weight_kg': 52.0, # Added value
        'batch_no': 'JW-B1'
    }
    
    JobWorkService.receive_material(
        order_id=jw_order.id,
        target_location=fg_loc,
        received_rolls=[received_roll_data]
    )
    
    # Verify Receipt
    new_roll = InventoryRoll.objects.get(label_id='ROLL-001-LAM')
    print(f"Received Roll: {new_roll.label_id} @ {new_roll.location.code} ({new_roll.weight_kg}kg)")
    assert new_roll.status == 'AVAILABLE'
    
    receipt_ledger = InventoryLedger.objects.filter(roll=new_roll, transaction_type='JOBWORK_IN').first()
    assert receipt_ledger is not None
    print("Receipt Ledger Confirmed.")

    print("\n>>> Verification SUCCESS!")

if __name__ == "__main__":
    try:
        with django.db.transaction.atomic():
            run_test()
            # raise Exception("Dry Run - Rolling Back") 
            # Actually for verifying persistence we can keep it, 
            # but usually test scripts rollback to keep DB clean.
            # I'll let it commit to see in Admin if needed, or user can delete test plant.
            # I will allow commit for now as these are new tables.
    except Exception as e:
        print(f"\nFailed: {e}")
        import traceback
        traceback.print_exc()
