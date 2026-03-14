import os
import sys
import django
from django.db import transaction

# Setup Django Environment
sys.path.insert(0, os.getcwd())
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from apps.materials.models import InventoryMaterial
from apps.inventory.models import InventoryLocation, InventoryStock

def test_transaction_rollback():
    print("--- Testing Transaction Rollback ---")
    
    # 1. Clear existing
    InventoryMaterial.objects.filter(code="ROLLBACK_TEST").delete()
    
    try:
        with transaction.atomic():
            mat = InventoryMaterial.objects.create(
                code="ROLLBACK_TEST",
                name="Rollback Test Material",
                category="RESIN"
            )
            print("✅ Created material in transaction")
            
            # Intentionally cause an error
            raise ValueError("Forced error for rollback")
            
    except ValueError as e:
        print(f"Caught expected error: {e}")

    # Verify material does NOT exist
    exists = InventoryMaterial.objects.filter(code="ROLLBACK_TEST").exists()
    if not exists:
        print("✅ PASS: Transaction rolled back successfully.")
    else:
        print("❌ FAIL: Transaction did not roll back.")
        sys.exit(1)

if __name__ == "__main__":
    test_transaction_rollback()
