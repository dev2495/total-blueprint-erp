from django.core.exceptions import ValidationError
from django.test import TestCase
from rest_framework.request import Request
from rest_framework.test import APIRequestFactory

from apps.factory.models import Plant
from apps.materials.models import InventoryMaterial, MaterialCodeAlias
from apps.materials.services_product_variant import _material_by_code
from apps.inventory.models import InventoryLocation, Vendor
from apps.inventory.services.grn import GRNService
from apps.materials.serializers import FilmVariantSerializer
from apps.recipes.models import RecipeGrade
from apps.recipes.views import RecipeGradeViewSet
from apps.sales.services.order_service import _normalize_layer_snapshot


class FilmVariantGradeContractTests(TestCase):
    def setUp(self):
        self.family = InventoryMaterial.objects.create(
            code="PET-FAM",
            name="PET",
            category="FILM_FAMILY",
            base_uom="KG",
            density_gcm3="1.4000",
        )

    def test_extrudable_variant_master_does_not_require_grade(self):
        serializer = FilmVariantSerializer(data={
            "code": "MILKY",
            "name": "Milky",
            "parent_family": str(self.family.id),
            "is_extrudable": True,
            "is_purchasable": True,
        })

        self.assertTrue(serializer.is_valid(), serializer.errors)
        variant = serializer.save()

        self.assertTrue(variant.is_extrudable)
        self.assertTrue(variant.is_purchasable)
        self.assertIsNone(variant.grade_id)

    def test_variant_update_clears_legacy_default_grade(self):
        grade = RecipeGrade.objects.create(name="GP")
        variant = InventoryMaterial.objects.create(
            code="LEGACY-MILKY",
            name="Legacy Milky",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=self.family,
            grade=grade,
            is_extrudable=True,
            is_purchasable=True,
        )

        serializer = FilmVariantSerializer(variant, data={
            "code": variant.code,
            "name": "Milky",
            "parent_family": str(self.family.id),
            "is_extrudable": True,
            "is_purchasable": True,
        })

        self.assertTrue(serializer.is_valid(), serializer.errors)
        updated = serializer.save()

        self.assertIsNone(updated.grade_id)

    def test_variant_code_rename_keeps_a_resolvable_alias(self):
        variant = InventoryMaterial.objects.create(
            code="OLD-FILM-CODE",
            name="Renamed film",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=self.family,
            is_extrudable=False,
            is_purchasable=True,
        )
        serializer = FilmVariantSerializer(
            variant,
            data={
                "code": "NEW-FILM-CODE",
                "name": variant.name,
                "parent_family": str(self.family.id),
                "is_extrudable": False,
                "is_purchasable": True,
            },
        )

        self.assertTrue(serializer.is_valid(), serializer.errors)
        updated = serializer.save()
        alias = MaterialCodeAlias.objects.get(alias="OLD-FILM-CODE")
        self.assertEqual(alias.material_id, updated.id)
        self.assertEqual(_material_by_code("OLD-FILM-CODE").id, updated.id)

class RecipeGradeMasterContractTests(TestCase):
    def setUp(self):
        self.factory = APIRequestFactory()

    def test_recipe_grade_list_is_global_even_when_variant_id_is_sent(self):
        RecipeGrade.objects.create(name="GP")
        RecipeGrade.objects.create(name="SP")

        request = Request(self.factory.get("/api/recipes/grades/", {"variant_id": "00000000-0000-0000-0000-000000000000"}))
        view = RecipeGradeViewSet()
        view.request = request
        view.format_kwarg = None
        view.action = "list"

        self.assertEqual(list(view.get_queryset().values_list("name", flat=True)), ["GP", "SP"])

class FilmGradeTransactionContractTests(TestCase):
    def setUp(self):
        self.grade = RecipeGrade.objects.create(name="SP")
        self.family = InventoryMaterial.objects.create(
            code="LDPE-FAM",
            name="LDPE",
            category="FILM_FAMILY",
            base_uom="KG",
            density_gcm3="0.9200",
        )
        self.extrudable_variant = InventoryMaterial.objects.create(
            code="MILKY",
            name="Milky",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=self.family,
            is_extrudable=True,
            is_purchasable=True,
        )
        self.buy_only_variant = InventoryMaterial.objects.create(
            code="PET-BOUGHT",
            name="Bought PET",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=self.family,
            is_extrudable=False,
            is_purchasable=True,
        )
        self.plant = Plant.objects.create(name="Plant Grade", code="PL-GRADE")
        self.location = InventoryLocation.objects.create(
            plant=self.plant,
            code="RM-GRADE",
            name="RM Grade",
            type="RM",
        )
        self.vendor = Vendor.objects.create(name="Grade Vendor", code="GRADE-V", type="RM", status="ACTIVE")

    def test_sales_snapshot_requires_grade_only_for_extrudable_variant(self):
        with self.assertRaises(ValidationError):
            _normalize_layer_snapshot([{
                "family_id": str(self.family.id),
                "variant_id": str(self.extrudable_variant.id),
                "thickness_micron": 50,
                "roll_width_mm": 1000,
            }])

        rows = _normalize_layer_snapshot([{
            "family_id": str(self.family.id),
            "variant_id": str(self.extrudable_variant.id),
            "grade_id": str(self.grade.id),
            "thickness_micron": 50,
            "roll_width_mm": 1000,
        }])
        self.assertEqual(rows[0]["grade_id"], str(self.grade.id))

    def test_sales_snapshot_drops_grade_for_buy_only_variant(self):
        rows = _normalize_layer_snapshot([{
            "family_id": str(self.family.id),
            "variant_id": str(self.buy_only_variant.id),
            "grade_id": str(self.grade.id),
            "thickness_micron": 12,
            "roll_width_mm": 900,
        }])

        self.assertIsNone(rows[0]["grade_id"])

    def test_roll_grn_requires_grade_only_for_extrudable_variant(self):
        with self.assertRaises(ValidationError):
            GRNService.create_roll_grn(
                material=self.extrudable_variant,
                location=self.location,
                vendor=self.vendor,
                plant=self.plant,
                rolls_data=[{"thickness_micron": 50, "width_mm": 1000, "weight_kg": 25}],
                reference="NO-GRADE",
            )

        created = GRNService.create_roll_grn(
            material=self.extrudable_variant,
            location=self.location,
            vendor=self.vendor,
            plant=self.plant,
            rolls_data=[{"thickness_micron": 50, "width_mm": 1000, "weight_kg": 25, "grade_id": str(self.grade.id)}],
            reference="WITH-GRADE",
        )
        self.assertEqual(created[0].grade_id, self.grade.id)

    def test_roll_grn_does_not_store_grade_for_buy_only_variant(self):
        created = GRNService.create_roll_grn(
            material=self.buy_only_variant,
            location=self.location,
            vendor=self.vendor,
            plant=self.plant,
            rolls_data=[{"thickness_micron": 12, "width_mm": 900, "weight_kg": 10, "grade_id": str(self.grade.id)}],
            reference="BUY-ONLY",
        )

        self.assertIsNone(created[0].grade_id)
