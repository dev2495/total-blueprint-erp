from django.db import models
import uuid
from apps.materials.models import InventoryMaterial

class RecipeGrade(models.Model):
    """
    Authoritative grades for recipe matching.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100, unique=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = 'recipe_grades'

    def __str__(self):
        return self.name

class ExtrusionRecipe(models.Model):
    """
    Precision engineering for multi-layer films.
    Matches on: Variant + Grade + Thickness Range.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    film_variant = models.ForeignKey(
        InventoryMaterial, 
        on_delete=models.CASCADE,
        limit_choices_to={'category': 'FILM_VARIANT', 'is_extrudable': True},
        related_name='recipes'
    )
    grade = models.ForeignKey(RecipeGrade, on_delete=models.PROTECT)
    thickness_min_micron = models.IntegerField(default=20)
    thickness_max_micron = models.IntegerField(default=100)
    
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'extrusion_recipes'
        unique_together = [['film_variant', 'grade', 'thickness_min_micron', 'thickness_max_micron', 'is_active']]

    def __str__(self):
        return f"{self.film_variant.code} | {self.grade.name} | {self.thickness_min_micron}-{self.thickness_max_micron}μ"

class ExtrusionRecipeComponent(models.Model):
    """
    Atomic granule composition.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    recipe = models.ForeignKey(ExtrusionRecipe, on_delete=models.CASCADE, related_name='components')
    granule = models.ForeignKey(
        InventoryMaterial, 
        on_delete=models.PROTECT,
        limit_choices_to={'category': 'GRANULE'}
    )
    percentage = models.FloatField(help_text="0-100%")

    class Meta:
        db_table = 'extrusion_recipe_components'
        unique_together = ['recipe', 'granule']

    def __str__(self):
        return f"{self.granule.code} ({self.percentage}%)"
