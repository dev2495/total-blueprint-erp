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
    updated_at = models.DateTimeField(auto_now=True)
    revision_no = models.PositiveIntegerField(default=1)

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


class ExtrusionRecipeRevision(models.Model):
    """Immutable audit snapshot for every governed recipe change."""

    EVENT_CHOICES = [
        ("CREATE", "Created"),
        ("BASELINE", "Baseline captured"),
        ("UPDATE", "Updated"),
        ("DISABLE", "Disabled"),
        ("ENABLE", "Enabled"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    recipe = models.ForeignKey(
        ExtrusionRecipe,
        on_delete=models.PROTECT,
        related_name="revisions",
    )
    revision_no = models.PositiveIntegerField()
    event = models.CharField(max_length=16, choices=EVENT_CHOICES)
    change_reason = models.CharField(max_length=255, blank=True, default="")
    contract_snapshot = models.JSONField(default=dict)
    components_snapshot = models.JSONField(default=list)
    impact_snapshot = models.JSONField(default=dict)
    changed_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="extrusion_recipe_revisions",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "extrusion_recipe_revisions"
        ordering = ["-revision_no", "-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["recipe", "revision_no"],
                name="uniq_extrusion_recipe_revision_no",
            )
        ]

    def __str__(self):
        return f"{self.recipe_id} · v{self.revision_no} · {self.event}"
