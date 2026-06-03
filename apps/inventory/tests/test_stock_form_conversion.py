from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient, APIRequestFactory, force_authenticate

from apps.factory.models import Plant
from apps.inventory.models import InventoryLocation, InventoryRoll, RollLink
from apps.inventory.services.stock_form_conversion import StockFormConversionService
from apps.inventory.views import RollViewSet
from apps.materials.models import InventoryMaterial
from apps.production.services.stock_form_resolver import StockFormResolver
from apps.users.models import Role, User


class StockFormConversionServiceTests(TestCase):
    def setUp(self):
        self.plant = Plant.objects.create(name="Form Plant", code="FORM")
        self.location = InventoryLocation.objects.create(
            plant=self.plant,
            code="FORM-WIP",
            name="Form WIP",
            type="WIP",
        )
        self.material = InventoryMaterial.objects.create(
            code="FORM-BOPP",
            name="BOPP form test",
            category="FILM_VARIANT",
            base_uom="KG",
        )
        self.role = Role.objects.create(
            code="FORM-ADMIN",
            name="Form Admin",
            default_permissions=["inventory.view", "inventory.manage"],
        )
        self.user = User.objects.create_user(
            username="form-admin",
            password="pass12345",
            role=self.role,
        )

    def _roll(self, label, *, width, weight, stock_form, width_basis):
        return InventoryRoll.objects.create(
            label_id=label,
            material=self.material,
            plant=self.plant,
            location=self.location,
            width_mm=Decimal(str(width)),
            thickness_micron=Decimal("50.00"),
            stock_form=stock_form,
            width_basis=width_basis,
            original_weight_kg=Decimal(str(weight)),
            weight_kg=Decimal(str(weight)),
            net_weight_kg=Decimal(str(weight)),
            status="AVAILABLE",
        )

    def test_open_layflat_tube_to_one_open_web_doubles_width_and_preserves_weight(self):
        parent = self._roll(
            "TUBE-ONE",
            width="400.00",
            weight="100.000",
            stock_form="LAYFLAT_TUBE",
            width_basis="LAYFLAT_WIDTH",
        )

        result = StockFormConversionService.convert(
            parent,
            operation="OPEN_TUBE_ONE_WEB",
            user=self.user,
        )

        parent.refresh_from_db()
        self.assertEqual(parent.status, "CONSUMED")
        self.assertEqual(len(result["children"]), 1)
        child = InventoryRoll.objects.get(id=result["children"][0]["roll_id"])
        self.assertEqual(child.stock_form, "OPEN_WEB")
        self.assertEqual(child.width_basis, "OPEN_WEB_WIDTH")
        self.assertEqual(child.width_mm, Decimal("800.00"))
        self.assertEqual(child.weight_kg, Decimal("100.000"))
        self.assertEqual(
            RollLink.objects.get(parent_roll=parent, child_roll=child).relation_type,
            "FORM_CONVERT",
        )

    def test_open_layflat_tube_to_two_open_webs_creates_two_equal_sheets(self):
        parent = self._roll(
            "TUBE-TWO",
            width="400.00",
            weight="100.000",
            stock_form="LAYFLAT_TUBE",
            width_basis="LAYFLAT_WIDTH",
        )

        result = StockFormConversionService.convert(
            parent,
            operation="OPEN_TUBE_TWO_WEBS",
            user=self.user,
        )

        children = list(InventoryRoll.objects.filter(parent_roll=parent).order_by("label_id"))
        self.assertEqual(len(children), 2)
        self.assertEqual({child.stock_form for child in children}, {"OPEN_WEB"})
        self.assertEqual({child.width_mm for child in children}, {Decimal("400.00")})
        self.assertEqual(sum((child.weight_kg for child in children), Decimal("0")), Decimal("100.000"))
        self.assertEqual(result["operation"], "OPEN_TUBE_TWO_WEBS")

    def test_slit_open_web_preserves_form_and_conserves_weight(self):
        parent = self._roll(
            "WEB-SLIT",
            width="1000.00",
            weight="100.000",
            stock_form="OPEN_WEB",
            width_basis="OPEN_WEB_WIDTH",
        )

        result = StockFormConversionService.convert(
            parent,
            operation="SLIT_OPEN_WEB",
            child_widths_mm=["300", "500"],
            trim_mm="10",
            user=self.user,
        )

        children = list(InventoryRoll.objects.filter(parent_roll=parent).order_by("width_mm"))
        self.assertEqual([child.width_mm for child in children], [Decimal("300.00"), Decimal("500.00")])
        self.assertEqual({child.stock_form for child in children}, {"OPEN_WEB"})
        self.assertEqual(result["remainder"]["width_mm"], 180.0)
        total_child_weight = sum((child.weight_kg for child in children), Decimal("0"))
        remainder = InventoryRoll.objects.get(id=result["remainder"]["roll_id"])
        self.assertEqual(total_child_weight + remainder.weight_kg, Decimal("98.000"))
        self.assertEqual(Decimal(str(result["scrap_weight_kg"])), Decimal("2.000"))

    def test_convert_open_web_to_folded_web_halves_stored_width_and_preserves_weight(self):
        parent = self._roll(
            "WEB-FOLD",
            width="800.00",
            weight="100.000",
            stock_form="OPEN_WEB",
            width_basis="OPEN_WEB_WIDTH",
        )

        result = StockFormConversionService.convert(
            parent,
            operation="FOLD_OPEN_WEB",
            user=self.user,
        )

        child = InventoryRoll.objects.get(id=result["children"][0]["roll_id"])
        self.assertEqual(child.stock_form, "FOLDED_WEB")
        self.assertEqual(child.width_basis, "FOLDED_WIDTH")
        self.assertEqual(child.width_mm, Decimal("400.00"))
        self.assertEqual(child.weight_kg, Decimal("100.000"))

    def test_invalid_form_operation_rejects_without_mutating_parent(self):
        parent = self._roll(
            "WEB-BAD-TUBE",
            width="800.00",
            weight="100.000",
            stock_form="OPEN_WEB",
            width_basis="OPEN_WEB_WIDTH",
        )

        with self.assertRaises(ValueError):
            StockFormConversionService.convert(parent, operation="OPEN_TUBE_ONE_WEB", user=self.user)

        parent.refresh_from_db()
        self.assertEqual(parent.status, "AVAILABLE")
        self.assertEqual(InventoryRoll.objects.filter(parent_roll=parent).count(), 0)

    def test_stock_form_resolver_reads_sales_geometry_before_legacy_default(self):
        class SOI:
            geometry_snapshot = {
                "stock_form": "tube",
                "slit_policy": "exact",
                "planned_parent_width_mm": "400",
                "width_basis": "LAYFLAT_WIDTH",
            }

        class Job:
            sales_order_item = SOI()
            meta_json = {}

        contract = StockFormResolver.from_job(Job())
        self.assertEqual(contract.stock_form, "LAYFLAT_TUBE")
        self.assertEqual(contract.slit_policy, "EXACT_ONLY")
        self.assertEqual(contract.width_mm, Decimal("400"))
        self.assertEqual(contract.width_basis, "LAYFLAT_WIDTH")

    def test_convert_stock_form_api_exposes_atomic_conversion(self):
        parent = self._roll(
            "TUBE-API",
            width="400.00",
            weight="100.000",
            stock_form="LAYFLAT_TUBE",
            width_basis="LAYFLAT_WIDTH",
        )
        request = APIRequestFactory().post(
            f"/api/inventory/rolls/{parent.id}/convert-stock-form/",
            {"operation": "OPEN_TUBE_ONE_WEB"},
            format="json",
        )
        force_authenticate(request, user=self.user)
        response = RollViewSet.as_view({"post": "convert_stock_form"})(request, pk=str(parent.id))

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["operation"], "OPEN_TUBE_ONE_WEB")
        self.assertEqual(response.data["children"][0]["stock_form"], "OPEN_WEB")
        child = InventoryRoll.objects.get(id=response.data["children"][0]["roll_id"])
        self.assertEqual(child.width_mm, Decimal("800.00"))

    def test_stock_form_operations_top_level_alias_is_live(self):
        client = APIClient()
        client.force_authenticate(user=self.user)

        response = client.get("/api/inventory/stock-form-operations/")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["operations"])
        self.assertIn("code", response.data["operations"][0])
        self.assertIn("from_stock_form", response.data["operations"][0])
        self.assertIn("to_stock_form", response.data["operations"][0])
