from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.materials.models import InventoryMaterial
from apps.recipes.models import ExtrusionRecipe, ExtrusionRecipeRevision, RecipeGrade


class RecipeLifecycleApiTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="recipe-owner",
            password="test-pass",
            is_superuser=True,
            is_staff=True,
            is_owner=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        family = InventoryMaterial.objects.create(
            code="LIFE-FAM", name="Lifecycle family", category="FILM_FAMILY", base_uom="KG"
        )
        variant = InventoryMaterial.objects.create(
            code="LIFE-VAR", name="Lifecycle variant", category="FILM_VARIANT",
            base_uom="KG", parent_family=family, is_extrudable=True,
        )
        grade = RecipeGrade.objects.create(name="Lifecycle GP")
        granule = InventoryMaterial.objects.create(
            code="LIFE-GRAN", name="Lifecycle granule", category="GRANULE", base_uom="KG"
        )
        self.recipe = ExtrusionRecipe.objects.create(
            film_variant=variant,
            grade=grade,
            thickness_min_micron=40,
            thickness_max_micron=60,
        )
        self.recipe.components.create(granule=granule, percentage=100)

    @patch("apps.recipes.views.recipe_change_impact")
    def test_impact_endpoint_is_read_only(self, impact):
        impact.return_value = {
            "matched_total": 3, "refreshable": 1, "frozen": 2, "released": 2,
            "in_production": 0, "closed": 0, "without_queue": 0, "samples": [],
        }

        response = self.client.post(
            f"/api/recipes/recipes/{self.recipe.id}/impact/",
            {
                "film_variant": str(self.recipe.film_variant_id),
                "grade": str(self.recipe.grade_id),
                "thickness_min_micron": 40,
                "thickness_max_micron": 60,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["frozen"], 2)
        self.recipe.refresh_from_db()
        self.assertTrue(self.recipe.is_active)
        self.assertEqual(self.recipe.revision_no, 1)

    def test_hard_delete_is_rejected(self):
        response = self.client.delete(f"/api/recipes/recipes/{self.recipe.id}/")

        self.assertEqual(response.status_code, 400)
        self.assertTrue(ExtrusionRecipe.objects.filter(id=self.recipe.id).exists())

    @patch("apps.recipes.views.refresh_open_sales_boms_for_recipe_contracts")
    @patch("apps.recipes.views.recipe_change_impact")
    def test_disable_preserves_recipe_and_records_revision(self, impact, refresh):
        impact.return_value = {
            "matched_total": 1, "refreshable": 0, "frozen": 1, "released": 1,
            "in_production": 0, "closed": 0, "without_queue": 0, "samples": [],
        }
        refresh.return_value = {
            "matched_items": 0, "checked": 0, "refreshed": 0, "failed": 0,
            "skipped": 0, "queues_rebuilt": 0, "queues_frozen": 0,
            "queues_planning_required": 0, "still_blocked": 0,
        }

        response = self.client.post(
            f"/api/recipes/recipes/{self.recipe.id}/disable/",
            {"change_reason": "Superseded formulation"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.recipe.refresh_from_db()
        self.assertFalse(self.recipe.is_active)
        self.assertEqual(self.recipe.revision_no, 2)
        self.assertEqual(
            list(ExtrusionRecipeRevision.objects.filter(recipe=self.recipe).values_list("event", flat=True)),
            ["DISABLE", "BASELINE"],
        )
