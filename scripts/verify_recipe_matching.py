import os
import sys
import django
from django.core.exceptions import ValidationError

# Setup Django Environment
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from apps.materials.models import InventoryMaterial
from apps.recipes.models import ExtrusionRecipe, RecipeGrade

def test_recipe_matching():
    print("--- Testing Recipe Matching Engine ---")
    
    # 1. Setup
    try:
        family = InventoryMaterial.objects.create(code="FF-REC-TEST", name="Recipe Test Family", category="FILM_FAMILY", density_gcm3=1.0)
        variant = InventoryMaterial.objects.create(
            code="FV-REC-TEST", name="Recipe Test Variant", category="FILM_VARIANT", 
            parent_family=family, is_extrudable=True
        )
        grade = RecipeGrade.objects.create(name="Grade A")
        
        # Recipe: 20-100 microns
        recipe = ExtrusionRecipe.objects.create(
            film_variant=variant,
            grade=grade,
            thickness_min_micron=20,
            thickness_max_micron=100,
            is_active=True
        )
        print("Setup Complete.")
    except Exception as e:
        print(f"Setup Failed: {e}")
        return

    # 2. Test Success Match
    match = ExtrusionRecipe.objects.filter(
        film_variant=variant,
        grade=grade,
        thickness_min_micron__lte=50,
        thickness_max_micron__gte=50,
        is_active=True
    ).first()
    
    if match and match == recipe:
        print("PASS: Matched correct recipe for 50 micron")
    else:
        print("FAIL: Did not match recipe for 50 micron")

    # 3. Test Range Failure
    match_fail = ExtrusionRecipe.objects.filter(
        film_variant=variant,
        grade=grade,
        thickness_min_micron__lte=10, # Requesting 10
        thickness_max_micron__gte=10, 
        is_active=True
    ).first()
    
    if not match_fail:
        print("PASS: Correctly failed to match 10 micron (Out of range)")
    else:
        print("FAIL: Incorrectly matched 10 micron")

if __name__ == "__main__":
    # Clean up
    InventoryMaterial.objects.filter(code__contains="REC-TEST").delete()
    RecipeGrade.objects.filter(name="Grade A").delete()
    test_recipe_matching()
