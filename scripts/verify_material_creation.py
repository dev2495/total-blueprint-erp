import os
import sys
import django
from django.core.exceptions import ValidationError

# Setup Django Environment
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from apps.materials.models import InventoryMaterial

from decimal import Decimal

def test_material_constraints():
    print("--- Testing Material Master Constraints ---")
    
    # 1. Success Case: Film Family with Density
    try:
        pet_family = InventoryMaterial.objects.create(
            code="FF-TEST-PET",
            name="Test PET Family",
            category="FILM_FAMILY",
            density_gcm3=Decimal("1.4")
        )
        pet_family.full_clean()
        print("PASS: Created Film Family with Density")
    except Exception as e:
        print(f"FAIL: Could not create valid family: {e}")
        return

    # 2. Fail Case: Film Family WITHOUT Density
    try:
        bad_family = InventoryMaterial(
            code="FF-Unstable",
            name="Unstable Family",
            category="FILM_FAMILY"
        )
        bad_family.clean()
        print("FAIL: Allowed Film Family without Density")
    except ValidationError:
        print("PASS: Blocked Film Family without Density")
        
    # 3. Success Case: Variant with Parent
    try:
        pet_12 = InventoryMaterial.objects.create(
            code="FV-TEST-PET-12",
            name="PET 12 Micron",
            category="FILM_VARIANT",
            parent_family=pet_family,
            is_extrudable=True
        )
        pet_12.full_clean()
        print("PASS: Created Film Variant with Parent")
    except Exception as e:
        print(f"FAIL: Could not create valid variant: {e}")

    # 4. Fail Case: Variant WITHOUT Parent
    try:
        bad_variant = InventoryMaterial(
            code="FV-Orphan",
            name="Orphan Variant",
            category="FILM_VARIANT"
        )
        bad_variant.clean()
        print("FAIL: Allowed Film Variant without Parent")
    except ValidationError:
        print("PASS: Blocked Film Variant without Parent")

if __name__ == "__main__":
    # Clean up test data
    InventoryMaterial.objects.filter(code__startswith="FF-TEST").delete()
    InventoryMaterial.objects.filter(code__startswith="FV-TEST").delete()
    test_material_constraints()
