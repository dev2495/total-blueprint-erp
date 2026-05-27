from decimal import Decimal

from django.core.exceptions import ValidationError
from django.test import TestCase

from apps.factory.models import Plant
from apps.inventory.models import InventoryLocation, Vendor
from apps.materials.models import InventoryMaterial
from apps.procurement.models import PurchaseOrder, PurchaseOrderItem
from apps.procurement.services.po_receipt import PurchaseOrderReceiptService
from apps.procurement.services.purchase_order import PurchaseOrderService


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
