from decimal import Decimal

from django.core.exceptions import ValidationError
from django.test import TestCase

from apps.factory.models import Plant
from apps.inventory.models import InventoryBulk, InventoryLocation, Vendor
from apps.materials.models import InventoryMaterial, TradingGood, TradingGoodStock
from apps.procurement.models import PurchaseOrder, PurchaseOrderItem
from apps.procurement.services.po_receipt import PurchaseOrderReceiptService
from apps.procurement.services.purchase_order import PurchaseOrderService
from apps.procurement.services.trading_good_receipt import TradingGoodReceiptService


class PurchaseOrderReceiptServiceTests(TestCase):
    def setUp(self):
        self.plant = Plant.objects.create(code="PO-TST", name="PO Test Plant")
        self.location = InventoryLocation.objects.create(
            plant=self.plant,
            code="PO-RM",
            name="PO Raw Store",
            type="RM",
        )
        self.vendor = Vendor.objects.create(
            code="PO-VEND",
            name="PO Vendor",
            type="RM",
            status="ACTIVE",
        )
        self.material = InventoryMaterial.objects.create(
            code="PO-GRANULE",
            name="PO Granule",
            category="GRANULE",
            base_uom="KG",
        )

    def _sent_po(self, qty="100"):
        po = PurchaseOrder.objects.create(vendor=self.vendor, plant=self.plant)
        item = PurchaseOrderItem.objects.create(
            purchase_order=po,
            line_no=1,
            material=self.material,
            qty_ordered=Decimal(qty),
            uom="KG",
            rate_per_uom=Decimal("10"),
            gst_pct=Decimal("18"),
        )
        PurchaseOrderService.recalc_totals(po)
        PurchaseOrderService.send(po, user=None)
        po.refresh_from_db()
        return po, item

    def test_receipt_posts_bulk_stock_and_marks_completed(self):
        po, item = self._sent_po(qty="100")

        receipt = PurchaseOrderReceiptService.create(
            po=po,
            user=None,
            lines_data=[
                {"po_item_id": str(item.id), "qty_received": "100", "rate": "10"},
            ],
            vendor_invoice_no="INV-PO-001",
        )

        po.refresh_from_db()
        item.refresh_from_db()
        line = receipt.lines.first()
        self.assertEqual(po.status, "COMPLETED")
        self.assertEqual(item.qty_received, Decimal("100.000"))
        self.assertIsNotNone(line.bulk_tx_id)

    def test_receipt_posts_meter_addon_stock(self):
        addon = InventoryMaterial.objects.create(
            code="PO-ZIP-METER",
            name="PO zipper meter",
            category="ADDON",
            base_uom="METER",
            weight_mode="PER_MM",
            weight_value=0.015,
            addon_is_purchased=True,
            addon_purchase_uom="METER",
        )
        po = PurchaseOrder.objects.create(vendor=self.vendor, plant=self.plant)
        item = PurchaseOrderItem.objects.create(
            purchase_order=po,
            line_no=1,
            material=addon,
            qty_ordered=Decimal("500"),
            uom="METER",
            rate_per_uom=Decimal("0.40"),
            gst_pct=Decimal("18"),
        )
        PurchaseOrderService.recalc_totals(po)
        PurchaseOrderService.send(po, user=None)
        po.refresh_from_db()

        receipt = PurchaseOrderReceiptService.create(
            po=po,
            user=None,
            location=self.location,
            lines_data=[
                {"po_item_id": str(item.id), "qty_received": "500", "rate": "0.40"},
            ],
            vendor_invoice_no="INV-PO-ZIP-001",
        )

        po.refresh_from_db()
        line = receipt.lines.first()
        stock = InventoryBulk.objects.get(material=addon, location=self.location)
        self.assertEqual(po.status, "COMPLETED")
        self.assertEqual(stock.qty_kg, Decimal("500.0000"))
        self.assertEqual(stock.material.base_uom, "METER")
        self.assertIsNotNone(line.bulk_tx_id)

    def test_rejects_receipt_when_no_open_qty_remains(self):
        po, item = self._sent_po(qty="100")
        PurchaseOrderReceiptService.create(
            po=po,
            user=None,
            lines_data=[
                {"po_item_id": str(item.id), "qty_received": "100", "rate": "10"},
            ],
            vendor_invoice_no="INV-PO-002",
        )
        po.refresh_from_db()
        po.status = "PARTIAL"
        po.save(update_fields=["status"])

        with self.assertRaisesMessage(ValidationError, "no open quantity remains"):
            PurchaseOrderReceiptService.create(
                po=po,
                user=None,
                lines_data=[
                    {"po_item_id": str(item.id), "qty_received": "1", "rate": "10"},
                ],
                vendor_invoice_no="INV-PO-003",
            )


class TradingGoodReceiptServiceTests(TestCase):
    def setUp(self):
        self.plant = Plant.objects.create(code="TGR-TST", name="Trading GRN Test")
        self.vendor = Vendor.objects.create(
            code="TGR-VEND",
            name="Trading Vendor",
            type="TRADING",
            status="ACTIVE",
        )
        self.good = TradingGood.objects.create(
            code="TGR-POUCH",
            name="Ready pouch",
            trade_type="READY_POUCH",
            base_uom="PCS",
            default_gst_pct=Decimal("12.00"),
            default_buy_rate=Decimal("2.50"),
            is_active=True,
        )

    def test_trading_receipt_persists_gst_but_stock_average_uses_pre_gst_rate(self):
        receipt = TradingGoodReceiptService.create(
            trading_good=self.good,
            vendor=self.vendor,
            plant=self.plant,
            qty="100",
            rate="2.50",
            gst_pct="18",
            vendor_invoice_no="TGR-INV-001",
        )

        receipt.refresh_from_db()
        stock = TradingGoodStock.objects.get(trading_good=self.good, plant=self.plant)

        self.assertEqual(receipt.gst_pct, Decimal("18"))
        self.assertEqual(receipt.line_subtotal, Decimal("250.00"))
        self.assertEqual(receipt.line_gst, Decimal("45.00"))
        self.assertEqual(receipt.line_total, Decimal("295.00"))
        self.assertEqual(stock.qty, Decimal("100.000"))
        self.assertEqual(stock.avg_cost, Decimal("2.50"))

    def test_trading_receipt_defaults_gst_from_trading_good_master(self):
        receipt = TradingGoodReceiptService.create(
            trading_good=self.good,
            vendor=self.vendor,
            plant=self.plant,
            qty="20",
            rate="3.00",
            vendor_invoice_no="TGR-INV-002",
        )

        self.assertEqual(receipt.gst_pct, Decimal("12.00"))
        self.assertEqual(receipt.line_gst, Decimal("7.20"))
