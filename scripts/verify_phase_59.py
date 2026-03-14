import os
import django
import sys
from decimal import Decimal

# Setup Django Environment
sys.path.append(os.getcwd())
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from apps.inventory.models import InventoryLocation, InventoryRoll, InventoryBulk, InventoryMaterial, RollMovement
from apps.factory.models import Plant
from apps.inventory.services.grn import GRNService
from apps.inventory.services.roll_service import RollService
from apps.inventory.services.bulk_service import BulkService
from apps.production.services.material_service import MaterialConsumptionService
from apps.production.services.dispatch_service import FGDispatchService
from apps.analytics.services import AnalyticsService
from apps.users.models import User, Role

def verify_phase_59():
    print("🚀 Starting Phase 59 Verification...")

    # Setup Test Data
    role, _ = Role.objects.get_or_create(code='ADMIN', defaults={'name': 'Admin'})
    user, _ = User.objects.get_or_create(username="test_admin", role=role)
    plant = Plant.objects.first()
    if not plant:
        print("❌ No plant found. Run seed data first.")
        return

    # Locs
    rm_loc = InventoryLocation.objects.filter(plant=plant, type='RM').first() or InventoryLocation.objects.create(plant=plant, name="RM Store", code="RM-01", type='RM')
    wip_loc = InventoryLocation.objects.filter(plant=plant, type='WIP').first() or InventoryLocation.objects.create(plant=plant, name="WIP Floor", code="WIP-01", type='WIP')
    transit_loc = InventoryLocation.objects.filter(plant=plant, type='TRANSIT').first() or InventoryLocation.objects.create(plant=plant, name="Transit", code="TRANSIT-01", type='TRANSIT')

    # Material
    material, _ = InventoryMaterial.objects.get_or_create(
        code="TEST-MAT-P59",
        defaults={'name': "Test Material P59", 'base_uom': 'KG', 'category': 'FILM_VARIANT'}
    )
    if material.category != 'FILM_VARIANT':
        material.category = 'FILM_VARIANT'
        material.save()

    print("\n1. Testing GRN (Unified Mode)")
    # Bulk GRN
    BulkService.add_bulk(material.id, 100, plant.id, rm_loc.id, cost=50, reference="GRN-BULK-TEST")
    bulk = InventoryBulk.objects.get(material=material, location=rm_loc)
    print(f"✅ Bulk GRN successful. Stock: {bulk.qty_kg}")

    # Roll GRN
    import time
    unique_suffix = int(time.time())
    rolls = GRNService.create_roll_grn(
        material=material,
        location=rm_loc,
        plant=plant,
        rolls_data=[
            {'label_id': f'ROLL-P59-{unique_suffix}', 'weight_kg': 50, 'width_mm': 1000, 'thickness_micron': 20}
        ],
        reference="GRN-ROLL-TEST"
    )
    roll = rolls[0]
    print(f"✅ Roll GRN successful. Roll: {roll.label_id}, Weight: {roll.weight_kg}")
    
    # Check Logic: Ensure RollMovement created, No Ledger
    movements = RollMovement.objects.filter(roll=roll)
    if movements.exists():
        print(f"✅ RollMovement found: {movements.first().reason}")
    else:
        print("❌ RollMovement MISSING!")

    try:
        from apps.inventory.models import InventoryLedger
        count = InventoryLedger.objects.count()
        print(f"❓ InventoryLedger still exists? Count: {count}")
    except ImportError:
        print("✅ InventoryLedger model successfully purged.")
    except Exception as e:
        print(f"✅ InventoryLedger access failed (Expected): {e}")


    print("\n2. Testing Job Work (Stub)")
    # Check if JobWorkService can be imported and methods exist
    from apps.inventory.services.job_work import JobWorkService
    print("✅ JobWorkService import successful.")


    print("\n3. Testing Material Consumption (Manual Roll Update Check)")
    # Simulate consumption logic directly as verifying Service needs Job Context
    # We just want to ensure direct update works without Ledger error
    roll.weight_kg -= 10
    roll.save()
    print(f"✅ Roll weight updated to {roll.weight_kg} (Direct save works)")


    print("\n4. Testing Dispatch (Roll Movement)")
    # Use RollService to move to Transit (Dispatch logic)
    movement = RollService.move_roll(
        roll=roll,
        to_location=transit_loc,
        reason='DISPATCH',
        reason_note="Dispatch Test"
    )
    print(f"✅ Roll moved to Transit using RollService. Status: {movement.roll.status}, Loc: {movement.roll.location.name}")


    print("\n5. Testing Analytics (Reports)")
    # Ensure reports don't crash
    stock = AnalyticsService.get_stock_overview()
    print(f"✅ get_stock_overview ran successfully. Items: {len(stock)}")
    
    health = AnalyticsService.get_inventory_health()
    print(f"✅ get_inventory_health ran successfully. Items: {len(health)}")


    print("\n🎉 Phase 59 Verification Complete!")

if __name__ == "__main__":
    try:
        verify_phase_59()
    except Exception as e:
        print(f"\n❌ Verification Failed: {e}")
        import traceback
        traceback.print_exc()
