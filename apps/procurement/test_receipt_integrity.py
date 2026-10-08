from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TransactionTestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.inventory.models import InventoryBulk
from apps.procurement.models import PurchaseOrderReceipt
from apps.procurement.services.po_receipt import PurchaseOrderReceiptService
from apps.procurement import test_concurrency as concurrency_helpers, tests as receipt_fixtures
from apps.procurement.views import PurchaseOrderReceiptViewSet


class PurchaseOrderReceiptIntegrityTests(TransactionTestCase):
    setUp = receipt_fixtures.PurchaseOrderReceiptServiceTests.setUp
    _sent_po = receipt_fixtures.PurchaseOrderReceiptServiceTests._sent_po
    race = concurrency_helpers.ProcurementConcurrencyTests.race

    def _actor(self):
        return get_user_model().objects.create_user(
            username="receipt-integrity-admin", is_staff=True, is_superuser=True
        )

    def test_concurrent_duplicate_submission_posts_stock_once(self):
        po, item = self._sent_po()
        actor = self._actor()

        def receive():
            request = APIRequestFactory().post(
                "/api/procurement/purchase-order-receipts/",
                {"purchase_order": str(po.pk), "lines": [{
                    "po_item_id": str(item.pk), "qty_received": "10"
                }]},
                format="json", HTTP_IDEMPOTENCY_KEY="same-receipt-request",
            )
            force_authenticate(request, actor)
            response = PurchaseOrderReceiptViewSet.as_view({"post": "create"})(request)
            self.assertIn(response.status_code, (200, 201), response.data)
            return response.status_code, str(response.data["id"])

        results = self.race([receive, receive])
        self.assertCountEqual([status for status, _ in results], [200, 201])
        self.assertEqual(len({pk for _, pk in results}), 1)
        self.assertEqual(PurchaseOrderReceipt.objects.count(), 1)
        item.refresh_from_db()
        self.assertEqual(item.qty_received, Decimal("10"))
        self.assertEqual(sum(InventoryBulk.objects.values_list("qty_kg", flat=True)), Decimal("10"))

    def test_receipt_deletion_preserves_stock_posting_history(self):
        po, item = self._sent_po()
        receipt = PurchaseOrderReceiptService.create(
            po=po, user=None,
            lines_data=[{"po_item_id": str(item.pk), "qty_received": "10"}],
        )
        request = APIRequestFactory().delete("/api/procurement/purchase-order-receipts/")
        force_authenticate(request, self._actor())
        response = PurchaseOrderReceiptViewSet.as_view({"delete": "destroy"})(request, pk=receipt.pk)
        self.assertEqual(response.status_code, 405)
        self.assertTrue(PurchaseOrderReceipt.objects.filter(pk=receipt.pk).exists())
        self.assertEqual(receipt.lines.count(), 1)
        self.assertEqual(sum(InventoryBulk.objects.values_list("qty_kg", flat=True)), Decimal("10"))

    def test_receipt_cannot_be_reparented_but_quality_metadata_can_change(self):
        po, item = self._sent_po()
        other_po, _ = self._sent_po()
        receipt = PurchaseOrderReceiptService.create(
            po=po, user=None,
            lines_data=[{"po_item_id": str(item.pk), "qty_received": "10"}],
        )
        original_received_at = receipt.received_at
        from apps.factory.models import Plant
        other_plant = Plant.objects.create(code="PO-OTHER", name="Other plant")
        request = APIRequestFactory().patch(
            "/api/procurement/purchase-order-receipts/",
            {"purchase_order": str(other_po.pk), "plant": str(other_plant.pk),
             "received_at": "2020-01-01T00:00:00Z", "notes": "QC checked"}, format="json",
        )
        force_authenticate(request, self._actor())
        response = PurchaseOrderReceiptViewSet.as_view({"patch": "partial_update"})(request, pk=receipt.pk)
        self.assertEqual(response.status_code, 200, response.data)
        receipt.refresh_from_db()
        self.assertEqual(receipt.purchase_order_id, po.pk)
        self.assertEqual(receipt.plant_id, self.plant.pk)
        self.assertEqual(receipt.received_at, original_received_at)
        self.assertEqual(receipt.notes, "QC checked")
        self.assertEqual(receipt.lines.first().po_item.purchase_order_id, receipt.purchase_order_id)

    def test_service_replays_completed_purchase_order_before_status_validation(self):
        po, item = self._sent_po(qty="10")
        kwargs = {"po": po, "user": None, "client_token": "completed-retry",
                  "lines_data": [{"po_item_id": str(item.pk), "qty_received": "10"}]}
        receipt = PurchaseOrderReceiptService.create(**kwargs)
        po.refresh_from_db()
        self.assertEqual(po.status, "COMPLETED")
        replay = PurchaseOrderReceiptService.create(**kwargs)
        self.assertEqual(replay.pk, receipt.pk)
        self.assertTrue(replay._idempotent_replay)
        self.assertEqual(PurchaseOrderReceipt.objects.count(), 1)
        self.assertEqual(sum(InventoryBulk.objects.values_list("qty_kg", flat=True)), Decimal("10"))
