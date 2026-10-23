"""Only inner pouches and gonnies weigh anything in a dispatch unit: in-house pouches by the BOM
of their linked Product Master variant, bought pouches and gonnies by the weight entered on the
master (required). Everything else is counted in its own unit at the evening count."""
from decimal import Decimal
from unittest.mock import patch

from django.core.exceptions import ValidationError
from django.test import TestCase
from rest_framework.test import APIClient

from apps.inventory.services.packaging_measure import describe, piece_weight
from apps.inventory.services.packaging_service import PackagingService
from apps.materials.models import InventoryMaterial, ProductMaster, ProductVariant
from apps.production.services.packing_service import PackingService
from apps.users.models import Role, User

D = Decimal
PREVIEW = "apps.sales.services.order_service.SalesOrderService.preview_sales_item"


class PackagingWeightRuleTests(TestCase):
    def setUp(self):
        self.master = ProductMaster.objects.create(
            code="BOTTOM-SEAL-T", name="Bottom sealing grey bags", product_kind="PACKAGING",
            packaging_kind="INNER_POUCH", default_reporting_group="PACKAGING", fixed_attributes={"fg_type": "POUCH"},
        )
        self.variant = ProductVariant.objects.create(
            master=self.master, code="BOTTOM-SEAL-T-13X16", bom_signature="sig-13x16", axis_values={"size": "13X16X200"},
            geometry_snapshot={"finished_good_type": "POUCH", "pouch_style": "PILLOW"},
            layer_snapshot=[{"material_code": "LD-GREY", "thickness_micron": 50, "density_g_cm3": 0.92, "width_mm": 330}],
        )

    def _item(self, **extra):
        values = {
            "code": "LD-GREY-BAGS-T", "name": "LD grey bags", "category": "PACKAGING", "base_uom": "KG",
            "packaging_kind": "INNER_POUCH", "packaging_supply_mode": "IN_HOUSE", "status": "ACTIVE",
        }
        values.update(extra)
        return InventoryMaterial.objects.create(**values)

    def test_in_house_pouch_weighs_what_its_linked_bom_says(self):
        bags = self._item(produced_by_product_variant=self.variant)
        with patch(PREVIEW, return_value={"unit_weight_g": 6.17826}):
            weight = piece_weight(bags)
            base_qty, _meta = PackagingService._resolve_base_qty(bags, 100, input_uom="PCS")
            info = describe(bags)
        self.assertEqual((weight["source"], weight["weight_kg"]), ("BOM", D("0.006178")))
        self.assertEqual(base_qty, D("0.6178"))
        self.assertEqual(info["bom"]["variant_code"], "BOTTOM-SEAL-T-13X16")
        self.assertEqual((info["stock_rule"], info["demand_rule"]), ("AT_MACHINE", "AUTO"))

    def test_in_house_pouch_without_a_link_has_no_weight_and_says_link_it(self):
        bags = self._item(per_sheet_base_qty=D("0.5"))
        self.assertEqual(piece_weight(bags)["source"], "MISSING", "a typed weight never replaces the BOM")
        with self.assertRaisesMessage(ValidationError, "link it to its packaging Product Master variant"):
            PackagingService._resolve_base_qty(bags, 10, input_uom="PCS")

    def test_bought_pouch_and_gonny_weigh_what_the_master_says(self):
        bought = self._item(code="PP-BAG-T", packaging_supply_mode="PURCHASED", per_sheet_base_qty=D("0.0085"))
        gonny = self._item(code="GONNY-T", base_uom="PCS", packaging_kind="GONNY", packaging_supply_mode="PURCHASED",
                           packaging_defaults_json={"weight_kg_per_base_uom": 0.12})
        self.assertEqual(describe(bought)["source"], "MASTER")
        self.assertEqual((describe(bought)["stock_rule"], describe(bought)["demand_rule"]), ("EVENING_COUNT", "PURCHASE"))
        self.assertEqual(PackingService._packaging_mass_kg(bought.id, 100, input_uom="PCS"), D("0.8500"))
        self.assertEqual(PackingService._packaging_mass_kg(gonny.id, 1, input_uom="PCS"), D("0.12"))

    def test_other_packing_items_carry_no_weight_and_are_counted(self):
        sheet = self._item(code="LD-SHEET-T", packaging_kind="SHEET", per_sheet_base_qty=D("0.06"))
        tape = self._item(code="TAPE-T", base_uom="PCS", packaging_kind="TAPE", packaging_supply_mode="PURCHASED",
                          packaging_defaults_json={"weight_kg_per_base_uom": 0.05})
        self.assertEqual(describe(sheet)["source"], "NOT_WEIGHED")
        self.assertEqual((describe(sheet)["stock_rule"], describe(sheet)["demand_rule"]), ("EVENING_COUNT", "MANUAL_STOCK_LAUNCHER"))
        self.assertEqual(PackingService._packaging_mass_kg(tape.id, 3, input_uom="PCS"), D("0"))
        with self.assertRaisesMessage(ValidationError, "counted in KG"):
            PackagingService._resolve_base_qty(sheet, 10, input_uom="PCS")


class PackagingMasterWeightApiTests(TestCase):
    def setUp(self):
        role = Role.objects.create(code="PKG-ADMIN", name="Packaging admin", default_permissions=["master.view", "master.manage"])
        user = User.objects.create_user(username="pkg-admin", password="pass12345", role=role, is_superuser=True)
        self.api = APIClient(SERVER_NAME="127.0.0.1")
        self.api.force_authenticate(user)

    def test_bought_pouch_and_gonny_need_a_weight_and_other_items_keep_none(self):
        refused = self.api.post("/api/master/packaging/", {
            "code": "PUTHA-T", "name": "Putha", "base_uom": "KG", "packaging_kind": "INNER_POUCH", "packaging_supply_mode": "PURCHASED",
        }, format="json")
        self.assertEqual(refused.status_code, 400, refused.data)
        self.assertIn("weight of one pouch", str(refused.data))
        gonny = self.api.post("/api/master/packaging/", {
            "code": "GONNY-50-T", "name": "Gonny 50", "base_uom": "PCS", "packaging_kind": "GONNY", "packaging_supply_mode": "PURCHASED",
        }, format="json")
        self.assertEqual(gonny.status_code, 400, gonny.data)
        ok = self.api.post("/api/master/packaging/", {
            "code": "PUTHA-T", "name": "Putha", "base_uom": "KG", "packaging_kind": "INNER_POUCH", "packaging_supply_mode": "PURCHASED",
            "per_sheet_base_qty": "0.3",
        }, format="json")
        self.assertEqual(ok.status_code, 201, ok.data)
        sheet = self.api.post("/api/master/packaging/", {
            "code": "LD-SHEET-T", "name": "LD sheet", "base_uom": "KG", "packaging_kind": "SHEET", "packaging_supply_mode": "IN_HOUSE",
            "per_sheet_base_qty": "0.06", "packaging_defaults_json": {"tare_kg_per_meter": 0.02, "brand_name": "Plain"},
        }, format="json")
        self.assertEqual(sheet.status_code, 201, sheet.data)
        saved = InventoryMaterial.objects.get(code="LD-SHEET-T")
        self.assertIsNone(saved.per_sheet_base_qty)
        self.assertEqual(saved.packaging_defaults_json, {"brand_name": "Plain"})
