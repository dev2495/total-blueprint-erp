from decimal import Decimal
from datetime import datetime

from django.test import TestCase
from django.utils import timezone

from apps.factory.models import Plant
from apps.inventory.models import InventoryLocation, PackagingStock
from apps.materials.models import InventoryMaterial
from apps.production.models import FinishedGoodsBatch, PackingUnit, ProductionJob
from apps.production.services.packing_count_service import PackingCountService
from apps.routing.models import RoutingRule
from apps.sales.models import SalesOrder, SalesOrderItem
from apps.templates.models import TemplateBlueprint


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
        self.sheet_stock = PackagingStock.objects.create(
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

    def test_snapshot_lists_all_packaging_masters_for_location(self):
        snapshot = PackingCountService.snapshot(location_id=str(self.location.id))
        codes = [row["material_code"] for row in snapshot["stocks"]]

        self.assertIn(self.tape.code, codes)
        self.assertIn(self.sheet.code, codes)
        self.assertIn(self.inner.code, codes)
        self.assertIn(self.gonny.code, codes)

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

    def test_post_count_allocates_only_to_packing_done_before_count_timestamp(self):
        template = TemplateBlueprint.objects.create(name="Count Window Template", fg_type="POUCH", status="LIVE")
        route = RoutingRule.objects.create(name="Count Window Route")
        count_at = timezone.make_aware(datetime(2026, 6, 14, 10, 0, 0))
        before_item = self._create_packed_item(
            template=template,
            route=route,
            label="BEFORE",
            created_at=timezone.make_aware(datetime(2026, 6, 14, 9, 0, 0)),
        )
        self._create_packed_item(
            template=template,
            route=route,
            label="AFTER",
            created_at=timezone.make_aware(datetime(2026, 6, 14, 15, 0, 0)),
        )

        result = PackingCountService.post_count(
            lines=[{"stock_id": str(self.sheet_stock.id), "counted_qty": "5"}],
            counted_at=count_at.isoformat(),
        )

        tx_rows = result["results"][0]["transactions"]
        self.assertEqual(len(tx_rows), 1)
        self.assertEqual(tx_rows[0]["qty"], -2.0)
        tx = self.sheet.packaging_transactions.get(reference__startswith="PACKING_EOD_COUNT:2026-06-14:")
        self.assertEqual(tx.sales_order_item_id, before_item.id)
        self.assertEqual(tx.meta_json["counted_at"], count_at.isoformat())

    def _create_packed_item(self, *, template, route, label, created_at):
        order = SalesOrder.objects.create(customer_name=f"{label} Customer")
        item = SalesOrderItem.objects.create(
            sales_order=order,
            template=template,
            qty_value=10,
            qty_uom="PCS",
            unit_price=1,
            packaging_snapshot={"packaging_lines": [{"material_id": str(self.sheet.id)}]},
        )
        job = ProductionJob.objects.create(
            job_number=f"PKG-COUNT-{label}",
            template=template,
            sales_order_item=item,
            routing_rule=route,
            quantity=Decimal("1.00"),
            uom="PCS",
            remaining_qty=Decimal("1.0000"),
            from_location=self.location,
        )
        batch = FinishedGoodsBatch.objects.create(
            batch_number=f"FG-COUNT-{label}",
            template=template,
            production_job=job,
            sales_order_item=item,
            qty_pcs=10,
            qty_kg=Decimal("1.0000"),
            location=self.location,
        )
        unit = PackingUnit.objects.create(
            label_id=f"G-COUNT-{label}",
            fg_batch=batch,
            sales_order_item=item,
            qty_pcs=10,
            location=self.location,
        )
        PackingUnit.objects.filter(id=unit.id).update(created_at=created_at)
        return item
