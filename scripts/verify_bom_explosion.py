import os
import sys
import django
from decimal import Decimal

# Setup Django Environment
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from apps.materials.models import InventoryMaterial
from apps.recipes.models import ExtrusionRecipe, RecipeGrade, ExtrusionRecipeComponent
from apps.bom.services_resolver import BOMResolverService

def test_bom_explosion():
    print("--- Testing BOM Explosion (Integration) ---")
    
    # 1. Setup Master Data
    try:
        # Materials
        pet_fam = InventoryMaterial.objects.create(code="FF-PET", name="PET Family", category="FILM_FAMILY", density_gcm3=1.4)
        pet_var = InventoryMaterial.objects.create(code="FV-PET-12", name="PET 12", category="FILM_VARIANT", parent_family=pet_fam, is_extrudable=True)
        
        granule_a = InventoryMaterial.objects.create(code="GR-A", name="Granule A", category="GRANULE")
        granule_b = InventoryMaterial.objects.create(code="GR-B", name="Granule B", category="GRANULE")
        
        ink = InventoryMaterial.objects.create(code="INK-PET", name="PET Ink", category="INK")
        adh = InventoryMaterial.objects.create(code="AD-ADHESIVE", name="Standard Adhesive", category="ADHESIVE")
        
        grade = RecipeGrade.objects.create(name="Standard")
        
        # Recipe
        recipe = ExtrusionRecipe.objects.create(film_variant=pet_var, grade=grade, thickness_min_micron=10, thickness_max_micron=20)
        ExtrusionRecipeComponent.objects.create(recipe=recipe, granule=granule_a, percentage=80)
        ExtrusionRecipeComponent.objects.create(recipe=recipe, granule=granule_b, percentage=20)
    except Exception as e:
        print(f"Setup Warning: {e} (might already exist)")
        pet_var = InventoryMaterial.objects.get(code="FV-PET-12")
        grade = RecipeGrade.objects.get(name="Standard")

    # 2. Simulate Input Snapshots
    # Physics Output for 1000m2 of PET 12
    # Weight = 1000 * 12 * 1.4 = 16.8 kg
    physics_snapshot = {
        "geometry_snapshot": {
            "area_m2": 1000.0,
            "finished_good_type": "ROLL",
            "effective_width_mm": 1000,
            "effective_height_mm": 1000
        },
        "breakdown": {
            "film_layers": [{"weight_g": 16800.0}], # 16.8kg
            "inks": [],
            "chemicals": []
        },
        "total_weight_g": 16800.0
    }
    
    template_snapshot = {
        "film_layers": [
            {
                "variant_id": str(pet_var.id),
                "thickness_micron": 12,
                "grade_id": str(grade.id)
            }
        ],
        "is_printing_enabled": False,
        "uom": "KG",
        "order_qty": 16.8
    }

    # 3. Run Resolver
    try:
        bom = BOMResolverService.resolve(template_snapshot, physics_snapshot)
        
        # 4. Assertions
        print("\nResults:")
        
        # Check Layers
        if len(bom['film_layers']) == 1:
            print(f"PASS: 1 Film Layer Resolved ({bom['film_layers'][0]['weight_kg']} kg)")
        else:
            print(f"FAIL: Expected 1 layer, got {len(bom['film_layers'])}")
            
        # Check Extrusion
        # Should be 16.8 * 0.8 = 13.44 kg A
        # Should be 16.8 * 0.2 = 3.36 kg B
        granules = bom['extrusion_bom']
        if len(granules) == 2:
            print(f"PASS: 2 Granules Resolved")
            for g in granules:
                print(f" - {g['granule_code']}: {g['weight_kg']} kg ({g['percentage']}%)")
        else:
            print(f"FAIL: Expected 2 granules, got {len(granules)}")
            
        if abs(bom['summary']['total_material_weight_kg'] - 16.8) < 0.1:
            print("PASS: Total Weight Matches Input")
        else:
            print(f"FAIL: Weight Mismatch {bom['summary']['total_material_weight_kg']}")
            
    except Exception as e:
        print(f"FAIL: Verification Error: {e}")

if __name__ == "__main__":
    test_bom_explosion()
