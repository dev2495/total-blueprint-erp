from unittest.mock import patch

from django.core.exceptions import ValidationError as DjangoValidationError
from django.test import TestCase
from rest_framework.exceptions import ValidationError as DRFValidationError

from apps.materials.models import InventoryMaterial, ProductMaster
from apps.recipes.models import RecipeGrade, ExtrusionRecipe
from apps.recipes.serializers import ExtrusionRecipeSerializer
from apps.recipes.services import (
    layer_matches_recipe_contract,
    refresh_open_sales_boms_for_recipe_contracts,
)
from apps.sales.models import SalesOrder, SalesOrderItem
from apps.templates.models import TemplateBlueprint


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

    def test_create_refreshes_matching_open_boms_after_components_exist(self):
        refresh_stats = {
            "matched_items": 1,
            "checked": 1,
            "refreshed": 1,
            "failed": 0,
            "skipped": 0,
            "queues_rebuilt": 1,
            "queues_frozen": 0,
            "queues_planning_required": 0,
            "still_blocked": 0,
        }
        serializer = ExtrusionRecipeSerializer(data={
            "film_variant": str(self.variant.id),
            "grade": str(self.grade.id),
            "thickness_min_micron": 40,
            "thickness_max_micron": 60,
            "is_active": True,
            "components": [
                {"granule": str(self.granule_a.id), "percentage": "25.00"},
                {"granule": str(self.granule_b.id), "percentage": "75.00"},
            ],
        })
        self.assertTrue(serializer.is_valid(), serializer.errors)

        with patch(
            "apps.recipes.serializers.refresh_open_sales_boms_for_recipe_contracts",
            return_value=refresh_stats,
        ) as refresh:
            recipe = serializer.save()

        self.assertEqual(recipe.components.count(), 2)
        refresh.assert_called_once()
        self.assertTrue(refresh.call_args.kwargs["raise_on_error"])
        self.assertEqual(ExtrusionRecipeSerializer(recipe).data["bom_refresh"], refresh_stats)

    def test_create_rolls_back_recipe_when_open_bom_refresh_fails(self):
        serializer = ExtrusionRecipeSerializer(data={
            "film_variant": str(self.variant.id),
            "grade": str(self.grade.id),
            "thickness_min_micron": 40,
            "thickness_max_micron": 60,
            "is_active": True,
            "components": [
                {"granule": str(self.granule_a.id), "percentage": "25.00"},
                {"granule": str(self.granule_b.id), "percentage": "75.00"},
            ],
        })
        self.assertTrue(serializer.is_valid(), serializer.errors)

        with patch(
            "apps.recipes.serializers.refresh_open_sales_boms_for_recipe_contracts",
            side_effect=DjangoValidationError("dependent BOM refresh failed"),
        ):
            with self.assertRaises(DRFValidationError):
                serializer.save()

        self.assertFalse(ExtrusionRecipe.objects.exists())

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

    def test_recipe_contract_matches_variant_grade_and_thickness(self):
        contract = {
            "film_variant_id": str(self.variant.id),
            "film_variant_code": self.variant.code,
            "grade_id": str(self.grade.id),
            "grade_name": self.grade.name,
            "thickness_min_micron": 39,
            "thickness_max_micron": 40,
        }
        matching_layer = {
            "variant_id": str(self.variant.id),
            "film_variant_code": self.variant.code,
            "grade_id": str(self.grade.id),
            "grade": self.grade.name,
            "thickness_micron": 40,
        }

        self.assertTrue(layer_matches_recipe_contract(matching_layer, contract))
        self.assertFalse(layer_matches_recipe_contract(
            {**matching_layer, "thickness_micron": 41},
            contract,
        ))

    def test_recipe_change_selects_only_matching_mutable_order_lines(self):
        template = TemplateBlueprint.objects.create(
            name="Recipe refresh template",
            fg_type="ROLL",
            status="LIVE",
        )
        master = ProductMaster.objects.create(
            code="RECIPE-REFRESH-MASTER",
            name="Recipe refresh master",
            product_kind="ROLL",
            template=template,
        )
        open_order = SalesOrder.objects.create(
            customer_name="Recipe refresh customer",
            status="PLANNING_REQUIRED",
        )
        matching_item = SalesOrderItem.objects.create(
            sales_order=open_order,
            template=template,
            product_master=master,
            qty_value=100,
            qty_uom="KG",
            line_status="PLANNING_REQUIRED",
            layer_snapshot=[{
                "variant_id": str(self.variant.id),
                "film_variant_code": self.variant.code,
                "grade_id": str(self.grade.id),
                "grade": self.grade.name,
                "thickness_micron": 40,
            }],
        )
        released_order = SalesOrder.objects.create(
            customer_name="Released recipe customer",
            status="RELEASED",
        )
        SalesOrderItem.objects.create(
            sales_order=released_order,
            template=template,
            product_master=master,
            qty_value=100,
            qty_uom="KG",
            line_status="RELEASED",
            layer_snapshot=matching_item.layer_snapshot,
        )
        contract = {
            "film_variant_id": str(self.variant.id),
            "film_variant_code": self.variant.code,
            "grade_id": str(self.grade.id),
            "grade_name": self.grade.name,
            "thickness_min_micron": 40,
            "thickness_max_micron": 60,
        }
        refresh_stats = {
            "checked": 1,
            "refreshed": 1,
            "failed": 0,
            "skipped": 0,
            "queues_rebuilt": 0,
            "queues_frozen": 0,
            "queues_planning_required": 0,
        }

        with patch(
            "apps.sales.services.order_service.SalesOrderService.refresh_open_snapshots_for_items",
            return_value=refresh_stats,
        ) as refresh:
            stats = refresh_open_sales_boms_for_recipe_contracts([contract])
            selected_ids = list(refresh.call_args.args[0].values_list("id", flat=True))

        self.assertEqual(selected_ids, [matching_item.id])
        self.assertEqual(stats["matched_items"], 1)
        self.assertEqual(stats["refreshed"], 1)
