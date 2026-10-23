"""Weight of one packing piece from the linked Product Master variant's BOM, and the stock
rules: only in-house inner pouches are taken at the machine and demanded automatically;
bought inner pouches and every other packing item go to the evening count."""
from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase

from apps.inventory.services.packaging_measure import describe, piece_measure
from apps.inventory.services.packaging_service import PackagingService
from apps.materials.models import InventoryMaterial, ProductMaster, ProductVariant
from apps.production.services.packing_service import PackingService

D = Decimal
PREVIEW = "apps.sales.services.order_service.SalesOrderService.preview_sales_item"


class PackagingMeasureTests(TestCase):
    def setUp(self):
        self.master = ProductMaster.objects.create(
            code="BOTTOM-SEAL-T", name="Bottom sealing grey bags", product_kind="PACKAGING",
            packaging_kind="INNER_POUCH", default_reporting_group="PACKAGING", fixed_attributes={"fg_type": "POUCH"},
        )
        self.variant = ProductVariant.objects.create(
            master=self.master, code="BOTTOM-SEAL-T-13X16", bom_signature="sig-13x16",
            axis_values={"size": "13X16X200"},
            geometry_snapshot={"finished_good_type": "POUCH", "pouch_style": "PILLOW"},
            layer_snapshot=[{"material_code": "LD-GREY", "thickness_micron": 50, "density_g_cm3": 0.92, "width_mm": 330}],
        )

    def _bags(self, **extra):
        values = {
            "code": "LD-GREY-BAGS-T", "name": "LD grey bags", "category": "PACKAGING", "base_uom": "KG",
            "packaging_kind": "INNER_POUCH", "packaging_supply_mode": "IN_HOUSE", "status": "ACTIVE",
        }
        values.update(extra)
        return InventoryMaterial.objects.create(**values)

    def test_linked_bag_weighs_what_its_variant_bom_says(self):
        bags = self._bags(produced_by_product_variant=self.variant, per_sheet_base_qty=D("0.5"))
        with patch(PREVIEW, return_value={"unit_weight_g": 6.17826}):
            measure = piece_measure(bags)
            base_qty, meta = PackagingService._resolve_base_qty(bags, 100, input_uom="PCS")
            info = describe(bags)
        # The BOM wins over a stale figure typed on the master.
        self.assertEqual((measure["source"], measure["per_piece"]), ("BOM", D("0.006178")))
        self.assertEqual(base_qty, D("0.6178"))
        self.assertEqual(meta["conversion_factor"], 0.006178)
        self.assertEqual(info["bom"]["variant_code"], "BOTTOM-SEAL-T-13X16")
        self.assertEqual((info["stock_rule"], info["demand_rule"]), ("AT_MACHINE", "AUTO"))

    def test_unlinked_bought_inner_pouch_uses_the_master_entry_and_the_evening_count(self):
        bought = self._bags(code="PP-BAG-T", packaging_supply_mode="PURCHASED", per_sheet_base_qty=D("0.0085"))
        info = describe(bought)
        self.assertEqual((info["source"], info["per_piece"]), ("MASTER", 0.0085))
        self.assertEqual((info["stock_rule"], info["demand_rule"]), ("EVENING_COUNT", "PURCHASE"))
        missing = self._bags(code="NO-WEIGHT-T")
        self.assertEqual(describe(missing)["source"], "MISSING")

    def test_in_house_sheets_and_rolls_are_counted_and_restocked_by_hand(self):
        sheet = self._bags(code="LD-SHEET-T", packaging_kind="SHEET", per_sheet_base_qty=D("0.06"))
        self.assertEqual((describe(sheet)["stock_rule"], describe(sheet)["demand_rule"]), ("EVENING_COUNT", "MANUAL_STOCK_LAUNCHER"))

    def test_packing_roll_weight_per_metre_comes_from_its_layers(self):
        roll_master = ProductMaster.objects.create(
            code="LD-WRAP-T", name="LD wrap roll", product_kind="PACKAGING", packaging_kind="SHEET",
            default_reporting_group="PACKAGING", fixed_attributes={"fg_type": "ROLL"},
        )
        roll_variant = ProductVariant.objects.create(
            master=roll_master, code="LD-WRAP-T-1000", bom_signature="sig-wrap",
            geometry_snapshot={"finished_good_type": "ROLL", "width_mm": 1000},
            layer_snapshot=[{"material_code": "LD", "thickness_micron": 50, "density_g_cm3": 0.92}],
        )
        wrap = self._bags(code="LD-WRAP-ROLL-T", packaging_kind="SHEET", base_uom="METER", produced_by_product_variant=roll_variant)
        # 1 m x 50 micron x 0.92 = 46 g per metre.
        self.assertEqual(piece_measure(wrap)["kg_per_metre"], D("0.046000"))
        self.assertEqual(PackingService._packaging_mass_kg(wrap.id, 10, input_uom="METER"), D("0.460000"))

    def test_pieces_stocked_as_pieces_still_weigh_from_the_bom_for_the_dispatch_weight(self):
        pouches = self._bags(code="INNER-PCS-T", base_uom="PCS", produced_by_product_variant=self.variant)
        with patch(PREVIEW, return_value={"unit_weight_g": 6.17826}):
            self.assertEqual(PackingService._packaging_mass_kg(pouches.id, 100, input_uom="PCS"), D("0.617800"))
            self.assertEqual(describe(pouches)["weight_source"], "BOM")
