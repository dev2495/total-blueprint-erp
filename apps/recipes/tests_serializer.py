from django.test import TestCase

from apps.materials.models import InventoryMaterial
from apps.recipes.models import RecipeGrade, ExtrusionRecipe
from apps.recipes.serializers import ExtrusionRecipeSerializer


class ExtrusionRecipeSerializerTests(TestCase):
    def setUp(self):
        self.family = InventoryMaterial.objects.create(
            code="MLD-FAM",
            name="MLD",
            category="FILM_FAMILY",
            base_uom="KG",
            density_gcm3="0.9200",
        )
        self.variant = InventoryMaterial.objects.create(
            code="MILKY",
            name="Milky",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=self.family,
            is_extrudable=True,
            is_purchasable=True,
        )
        self.grade = RecipeGrade.objects.create(name="GP")
        self.granule_a = InventoryMaterial.objects.create(
            code="GRA-001",
            name="Granule A",
            category="GRANULE",
            base_uom="KG",
        )
        self.granule_b = InventoryMaterial.objects.create(
            code="GRA-002",
            name="Granule B",
            category="GRANULE",
            base_uom="KG",
        )

    def test_accepts_balanced_components_with_two_decimal_rounding(self):
        serializer = ExtrusionRecipeSerializer(data={
            "film_variant": str(self.variant.id),
            "grade": str(self.grade.id),
            "thickness_min_micron": 40,
            "thickness_max_micron": 60,
            "is_active": True,
            "components": [
                {"granule": str(self.granule_a.id), "percentage": "26.245"},
                {"granule": str(self.granule_b.id), "percentage": "73.75"},
            ],
        })

        self.assertTrue(serializer.is_valid(), serializer.errors)
        recipe = serializer.save()

        saved_percentages = list(recipe.components.order_by("granule__code").values_list("percentage", flat=True))
        self.assertEqual(saved_percentages, [26.25, 73.75])

    def test_rejects_components_when_remaining_delta_is_still_material(self):
        serializer = ExtrusionRecipeSerializer(data={
            "film_variant": str(self.variant.id),
            "grade": str(self.grade.id),
            "thickness_min_micron": 40,
            "thickness_max_micron": 60,
            "is_active": True,
            "components": [
                {"granule": str(self.granule_a.id), "percentage": "26.10"},
                {"granule": str(self.granule_b.id), "percentage": "73.80"},
            ],
        })

        self.assertFalse(serializer.is_valid())
        self.assertIn("Total percentage must be 100.00%", str(serializer.errors))

    def test_rejects_duplicate_granule_rows(self):
        serializer = ExtrusionRecipeSerializer(data={
            "film_variant": str(self.variant.id),
            "grade": str(self.grade.id),
            "thickness_min_micron": 40,
            "thickness_max_micron": 60,
            "is_active": True,
            "components": [
                {"granule": str(self.granule_a.id), "percentage": "50.00"},
                {"granule": str(self.granule_a.id), "percentage": "50.00"},
            ],
        })

        self.assertFalse(serializer.is_valid())
        self.assertIn("Each granule can be used only once", str(serializer.errors))

    def test_rejects_inverted_thickness_range(self):
        serializer = ExtrusionRecipeSerializer(data={
            "film_variant": str(self.variant.id),
            "grade": str(self.grade.id),
            "thickness_min_micron": 60,
            "thickness_max_micron": 40,
            "is_active": True,
            "components": [
                {"granule": str(self.granule_a.id), "percentage": "50.00"},
                {"granule": str(self.granule_b.id), "percentage": "50.00"},
            ],
        })

        self.assertFalse(serializer.is_valid())
        self.assertIn("Max thickness must be greater than or equal to min thickness.", str(serializer.errors))

    def test_rejects_exact_duplicate_active_recipe(self):
        ExtrusionRecipe.objects.create(
            film_variant=self.variant,
            grade=self.grade,
            thickness_min_micron=40,
            thickness_max_micron=60,
            is_active=True,
        )

        serializer = ExtrusionRecipeSerializer(data={
            "film_variant": str(self.variant.id),
            "grade": str(self.grade.id),
            "thickness_min_micron": 40,
            "thickness_max_micron": 60,
            "is_active": True,
            "components": [
                {"granule": str(self.granule_a.id), "percentage": "50.00"},
                {"granule": str(self.granule_b.id), "percentage": "50.00"},
            ],
        })

        self.assertFalse(serializer.is_valid())
        self.assertIn("An active recipe already exists", str(serializer.errors))

    def test_rejects_overlapping_active_recipe_range(self):
        ExtrusionRecipe.objects.create(
            film_variant=self.variant,
            grade=self.grade,
            thickness_min_micron=30,
            thickness_max_micron=50,
            is_active=True,
        )

        serializer = ExtrusionRecipeSerializer(data={
            "film_variant": str(self.variant.id),
            "grade": str(self.grade.id),
            "thickness_min_micron": 45,
            "thickness_max_micron": 65,
            "is_active": True,
            "components": [
                {"granule": str(self.granule_a.id), "percentage": "50.00"},
                {"granule": str(self.granule_b.id), "percentage": "50.00"},
            ],
        })

        self.assertFalse(serializer.is_valid())
        self.assertIn("Thickness range overlaps", str(serializer.errors))
