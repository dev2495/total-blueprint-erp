from decimal import Decimal

from django.test import TestCase

from apps.factory.models import Plant
from apps.inventory.models import InventoryLocation, PackagingStock
from apps.materials.models import InventoryMaterial
from apps.production.services.packing_count_service import PackingCountService


class PackingCountServiceTests(TestCase):
    def setUp(self):
        self.plant = Plant.objects.create(name="Packing Plant", code="PKG-P")
        self.location = InventoryLocation.objects.create(
            plant=self.plant,
            code="PKG-YARD",
            name="Packing Yard",
            type="FG",
        )
        self.tape = InventoryMaterial.objects.create(
            code="PKG-TAPE-EOD",
            name="EOD Tape",
            category="PACKAGING",
            base_uom="PCS",
            packaging_kind="TAPE",
            packaging_supply_mode="PURCHASED",
        )
        self.sheet = InventoryMaterial.objects.create(
            code="PKG-SHEET-EOD",
            name="EOD Sheet",
            category="PACKAGING",
            base_uom="PCS",
            packaging_kind="SHEET",
            packaging_supply_mode="PURCHASED",
        )
        self.inner = InventoryMaterial.objects.create(
            code="PKG-INNER-EOD",
            name="Auto Inner Pouch",
            category="PACKAGING",
            base_uom="PCS",
            packaging_kind="INNER_POUCH",
            packaging_supply_mode="PURCHASED",
        )
        self.gonny = InventoryMaterial.objects.create(
            code="PKG-GONNY-EOD",
            name="Auto Gonny",
            category="PACKAGING",
            base_uom="PCS",
            packaging_kind="GONNY",
            packaging_supply_mode="PURCHASED",
        )
        PackagingStock.objects.create(
            material=self.sheet,
            plant=self.plant,
            location=self.location,
            qty=Decimal("7.0000"),
        )
        PackagingStock.objects.create(
            material=self.inner,
            plant=self.plant,
            location=self.location,
            qty=Decimal("100.0000"),
        )
        PackagingStock.objects.create(
            material=self.gonny,
            plant=self.plant,
            location=self.location,
            qty=Decimal("12.0000"),
        )

    def test_snapshot_lists_manual_packaging_masters_for_location_and_excludes_auto_posted_kinds(self):
        snapshot = PackingCountService.snapshot(location_id=str(self.location.id))
        codes = [row["material_code"] for row in snapshot["stocks"]]

        self.assertIn(self.tape.code, codes)
        self.assertIn(self.sheet.code, codes)
        self.assertNotIn(self.inner.code, codes)
        self.assertNotIn(self.gonny.code, codes)

        tape_row = next(row for row in snapshot["stocks"] if row["material_code"] == self.tape.code)
        self.assertEqual(tape_row["book_qty"], 0.0)
        self.assertTrue(tape_row["is_virtual"])
        self.assertTrue(tape_row["id"].startswith("virtual:"))

    def test_post_count_accepts_virtual_manual_packaging_row(self):
        snapshot = PackingCountService.snapshot(location_id=str(self.location.id))
        tape_row = next(row for row in snapshot["stocks"] if row["material_code"] == self.tape.code)

        result = PackingCountService.post_count(
            lines=[{"stock_id": tape_row["id"], "counted_qty": "9"}],
            count_date=snapshot["count_date"],
        )

        stock = PackagingStock.objects.get(material=self.tape, location=self.location)
        self.assertEqual(stock.qty, Decimal("9.0000"))
        self.assertEqual(result["posted_transactions"], 1)
        self.assertEqual(result["results"][0]["material_code"], self.tape.code)

    def test_snapshot_reports_eod_consumption_metrics(self):
        snapshot = PackingCountService.snapshot(location_id=str(self.location.id))
        sheet_row = next(row for row in snapshot["stocks"] if row["material_code"] == self.sheet.code)

        PackingCountService.post_count(
            lines=[{"stock_id": sheet_row["id"], "counted_qty": "5"}],
            count_date=snapshot["count_date"],
        )

        updated = PackingCountService.snapshot(location_id=str(self.location.id))
        metrics = updated["eod_allocation"]
        self.assertEqual(metrics["sessions"], 1)
        self.assertEqual(metrics["transactions"], 1)
        self.assertEqual(metrics["consumed_qty"], 2.0)
        self.assertEqual(metrics["unassigned_qty"], 2.0)
        self.assertEqual(metrics["top_materials"][0]["material_code"], self.sheet.code)
