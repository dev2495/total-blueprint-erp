import os
import django

# Set up Django environment
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from apps.materials.models import InventoryMaterial
from apps.recipes.models import ExtrusionRecipe, ExtrusionRecipeComponent

def cleanup_film_data():
    print(">>> Starting Film Data Cleanup...")
    
    # 1. Clear Recipes (Dependent on Variants)
    print("Clearing Extrusion Recipes & Components...")
    ExtrusionRecipeComponent.objects.all().delete()
    ExtrusionRecipe.objects.all().delete()
    
    # 2. Clear Film Variants & Families
    print("Clearing Film Variants & Families...")
    InventoryMaterial.objects.filter(category__in=['FILM_VARIANT', 'FILM_FAMILY']).delete()
    
    # 3. Clear Film Families if they were just for testing? 
    # User said "remove all recipes film family variants clean it out"
    # I'll keep families for now to avoid deleting core setup.
    
    print(">>> Film Data Cleanup Complete.")

if __name__ == "__main__":
    cleanup_film_data()
