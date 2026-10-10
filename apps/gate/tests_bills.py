import io
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from decimal import Decimal

from PIL import Image
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import DatabaseError, close_old_connections, connection, connections, transaction
from django.test import TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken
from apps.inventory.models import BulkTransaction, InventoryBulk, InventoryLocation
from apps.materials.models import InventoryMaterial, TradingGood
from apps.procurement.models import PurchaseOrder, PurchaseOrderItem, PurchaseOrderReceipt
from apps.users.models import Notification, Role, User
from .bill_services import resolve_bill, upload_bill
from .bill_serializers import BillUploadSerializer
from .models import GateAssignment, GateAuditEvent, InwardBillIntake, InwardBillPage, InwardBillReceiptReference
from .services import Conflict
from .tests import fixture


def photo(color="#eeeeee", size=(1600, 2400)):
    buffer = io.BytesIO()
    Image.new("RGB", size, color).save(buffer, "PNG")
    return SimpleUploadedFile("bill.png", buffer.getvalue(), content_type="image/png")


class BillIntakeTests(TransactionTestCase):
    def setUp(self):
        self.owner, self.watchman, self.plant, self.other, self.link, self.vendor, self.material = fixture()
        role, _ = Role.objects.get_or_create(code="STORE", defaults={"name": "Inventory"})
        self.store = User.objects.create_user(username="bill-store", role=role)
        self.gate, self.review = APIClient(), APIClient()
        self.gate.force_authenticate(self.watchman)
        self.review.force_authenticate(self.store)
        self.location = InventoryLocation.objects.create(code="BILL-RM", name="Raw material store", plant=self.plant, type="RM")
        self.other_location = InventoryLocation.objects.create(code="BILL-OTHER", name="Other store", plant=self.other, type="RM")

    def upload(self, token=None, **changes):
        data = {"client_token": str(token or uuid.uuid4()), "plant": str(self.plant.id), "images": [photo()]}
        data.update(changes)
        return self.gate.post("/api/gate/inward-bills/", data, format="multipart")

    def new_bill(self):
        result = self.upload()
        self.assertEqual(result.status_code, 201, result.data)
        return result.data["id"]

    def grn(self, bill, **changes):
        data = {"client_token": str(uuid.uuid4()), "inward_bill_id": bill, "klass": "BULK", "vendor_id": str(self.vendor.id), "vendor_invoice_no": str(uuid.uuid4())[:12], "plant_id": str(self.plant.id), "store_location_id": str(self.location.id), "lines": [{"material_id": str(self.material.id), "qty": "25", "unit_cost": "4", "uom": "KG"}]}
        data.update(changes)
        return data

    def test_photo_arrival_atomic_readable_private_and_idempotent_without_stock(self):
        token = uuid.uuid4()
        first = self.upload(token, images=[photo(), photo("#dddddd")])
        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(first.data["status"], "PENDING_GRN")
        bill = InwardBillIntake.objects.get()
        self.assertEqual(first.data["arrival_at"], bill.arrival_at.isoformat())
        self.assertEqual(first.data["page_count"], 2)
        self.assertEqual([page["page_number"] for page in first.data["pages"]], [1, 2])
        page = InwardBillPage.objects.first()
        image = Image.open(io.BytesIO(bytes(page.data)))
        self.assertEqual(image.format, "JPEG")
        self.assertEqual(image.size, (1600, 2400))
        self.assertLessEqual(page.byte_size, 2*1024*1024)
        self.assertFalse(BulkTransaction.objects.exists())
        self.assertFalse(InventoryBulk.objects.exists())
        notices = Notification.objects.filter(event_key="gate.inward_bill_uploaded")
        self.assertEqual(set(notices.values_list("user_id", flat=True)), {self.owner.id, self.store.id})
        self.assertTrue(all(row.channels == ["IN_APP"] for row in notices))
        retry = self.upload(token, images=[photo(), photo("#dddddd")])
        self.assertTrue(retry.data["replayed"])
        self.assertEqual(retry.data["id"], first.data["id"])
        self.assertEqual(InwardBillIntake.objects.count(), 1)
        self.assertEqual(GateAuditEvent.objects.filter(action="BILL_ARRIVED").count(), 1)
        self.assertEqual(notices.count(), 2)
        changed = self.upload(token, images=[photo("#bbbbbb")])
        self.assertEqual(changed.status_code, 409)
        public = APIClient()
        url = first.data["pages"][0]["image_url"]
        self.assertNotEqual(public.get(url).status_code, 200)
        result = self.review.get(url, HTTP_ACCEPT="image/jpeg")
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result["Cache-Control"], "private, no-store")
        self.assertNotIn("data", first.data["pages"][0])

    def test_invalid_page_or_limits_reject_the_whole_arrival_and_notifications(self):
        for images in [[photo(), SimpleUploadedFile("bad.jpg", b"not image")], [photo(size=(100, 100))], [photo() for _ in range(7)], [SimpleUploadedFile("large.jpg", b"x"*(10*1024*1024+1))]]:
            response = self.upload(images=images)
            self.assertEqual(response.status_code, 400, response.data)
        self.assertFalse(InwardBillIntake.objects.exists())
        self.assertFalse(InwardBillPage.objects.exists())
        self.assertFalse(Notification.objects.filter(event_key="gate.inward_bill_uploaded").exists())

    def test_scope_camera_only_bypass_and_inventory_metadata_are_enforced(self):
        self.assertEqual(self.upload(plant=str(self.other.id)).status_code, 403)
        bill_id = self.new_bill()
        self.assertEqual(self.gate.post(f"/api/gate/inward-bills/{bill_id}/review/", {"client_token": str(uuid.uuid4()), "vendor_id": str(self.vendor.id)}, format="json").status_code, 403)
        self.assertEqual(self.gate.get(f"/api/gate/inward-bills/{bill_id}/receipt-candidates/").status_code, 403)
        manual = {"client_token": str(uuid.uuid4()), "plant": str(self.plant.id), "direction": "INWARD", "invoice_number": "MANUAL", "vehicle_number": "DD03U9802", "party_kind": "VENDOR", "party_id": str(self.vendor.id), "lines": [{"product_kind": "MATERIAL", "product_id": str(self.material.id), "quantity": "1", "uom": "KG"}]}
        self.assertEqual(self.gate.post("/api/gate/goods/", manual, format="json").status_code, 403)
        saved = self.review.post(f"/api/gate/inward-bills/{bill_id}/review/", {"client_token": str(uuid.uuid4()), "vendor_id": str(self.vendor.id), "invoice_number": "PRIVATE-INVOICE", "vehicle_number": "PRIVATE-VEHICLE"}, format="json")
        self.assertEqual(saved.status_code, 200, saved.data)
        own = self.gate.get(f"/api/gate/inward-bills/{bill_id}/")
        self.assertEqual(own.data["review_data"], {})
        self.assertNotIn("PRIVATE-INVOICE", str(own.data))
        second = self.new_bill()
        warning = self.gate.get(f"/api/gate/inward-bills/{second}/").data["duplicate_warning"]
        self.assertTrue(warning["possible_duplicate"])
        self.assertEqual(warning["bill_ids"], [])
        self.assertIn(bill_id, self.review.get(f"/api/gate/inward-bills/{second}/").data["duplicate_warning"]["bill_ids"])

    def test_unified_post_is_partial_retry_once_then_explicit_complete(self):
        bill = self.new_bill()
        payload = self.grn(bill)
        first = self.review.post("/api/inventory/grn/create/", payload, format="json")
        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(first.data["inward_bill"]["status"], "PARTIAL_GRN")
        retry = self.review.post("/api/inventory/grn/create/", payload, format="json")
        self.assertEqual(retry.status_code, 200, retry.data)
        self.assertTrue(retry.data["replayed"])
        self.assertEqual(first.data["stock_movements"], retry.data["stock_movements"])
        self.assertEqual(BulkTransaction.objects.filter(type="INWARD").count(), 1)
        self.assertEqual(InventoryBulk.objects.get().qty_kg, Decimal("25"))
        self.assertEqual(self.review.get("/api/gate/inward-bills/").data["count"], 1)
        payload["lines"][0]["qty"] = "30"
        self.assertEqual(self.review.post("/api/inventory/grn/create/", payload, format="json").status_code, 409)
        done = self.review.post(f"/api/gate/inward-bills/{bill}/complete/", {"client_token": str(uuid.uuid4()), "reason": "All lines on this bill have been received"}, format="json")
        self.assertEqual(done.status_code, 200, done.data)
        self.assertEqual(done.data["status"], "RECEIPTED")
        self.assertEqual(self.review.get("/api/gate/inward-bills/").data["count"], 0)
        self.assertEqual(self.review.post("/api/inventory/grn/create/", self.grn(bill), format="json").status_code, 409)

    def test_failed_or_cross_plant_post_rolls_back_stock_and_keeps_pending(self):
        bill = self.new_bill()
        for payload in [self.grn(bill, store_location_id=str(self.other_location.id), plant_id=str(self.other.id)), self.grn(bill, lines=[{"material_id": str(self.material.id), "qty": "25", "uom": "KG"}, {"material_id": str(uuid.uuid4()), "qty": "1"}])]:
            response = self.review.post("/api/inventory/grn/create/", payload, format="json")
            self.assertEqual(response.status_code, 400, response.data)
            self.assertFalse(BulkTransaction.objects.exists())
            self.assertFalse(InwardBillReceiptReference.objects.exists())
            self.assertEqual(InwardBillIntake.objects.get().status, "PENDING_GRN")

    def test_mixed_classes_and_trading_keep_partial_until_explicit_final_post(self):
        bill = self.new_bill()
        bulk = self.review.post("/api/inventory/grn/create/", self.grn(bill), format="json")
        self.assertEqual(bulk.status_code, 201, bulk.data)
        product = TradingGood.objects.create(code="BILL-TG", name="Ready pouch", base_uom="PCS")
        payload = {"client_token": str(uuid.uuid4()), "inward_bill_id": bill, "bill_complete": True, "trading_good": str(product.id), "vendor": str(self.vendor.id), "plant": str(self.plant.id), "qty": "10", "rate": "5", "vendor_invoice_no": "BILL-T1"}
        trading = self.review.post("/api/procurement/trading-good-receipts/", payload, format="json")
        self.assertEqual(trading.status_code, 201, trading.data)
        self.assertEqual(trading.data["inward_bill"]["status"], "RECEIPTED")
        self.assertEqual(InwardBillReceiptReference.objects.count(), 2)
        self.assertTrue(self.review.post("/api/procurement/trading-good-receipts/", payload, format="json").data["replayed"])

    def test_po_posting_and_mixed_unit_quantity_are_truthful(self):
        bill = self.new_bill()
        packaging = InventoryMaterial.objects.create(code="BILL-PACK", name="Boxes", category="PACKAGING", base_uom="PCS")
        po = PurchaseOrder.objects.create(code="BILL-PO", vendor=self.vendor, plant=self.plant, status="SENT")
        first = PurchaseOrderItem.objects.create(purchase_order=po, material=self.material, qty_ordered=25, uom="KG", rate_per_uom=4)
        second = PurchaseOrderItem.objects.create(purchase_order=po, material=packaging, qty_ordered=10, uom="PCS", rate_per_uom=2)
        data = {"client_token": str(uuid.uuid4()), "inward_bill_id": bill, "purchase_order": str(po.id), "location_id": str(self.location.id), "vendor_invoice_no": "BILL-PO-I", "lines": [{"po_item_id": str(first.id), "qty_received": "25"}, {"po_item_id": str(second.id), "qty_received": "10"}]}
        result = self.review.post("/api/procurement/purchase-order-receipts/", data, format="json")
        self.assertEqual(result.status_code, 201, result.data)
        ref = InwardBillReceiptReference.objects.get().snapshot
        self.assertEqual(ref["uom"], "MIXED")
        self.assertIsNone(ref["quantity"])
        self.assertEqual(ref["quantities_by_uom"], {"KG": "25.000", "PCS": "10.000"})
        self.assertTrue(self.review.post("/api/procurement/purchase-order-receipts/", data, format="json").data["replayed"])
        self.assertEqual(PurchaseOrderReceipt.objects.count(), 1)
        physical_id = BulkTransaction.objects.get().id
        duplicate_bill = self.new_bill()
        duplicate = self.review.post(f"/api/gate/inward-bills/{duplicate_bill}/link-receipts/", {"client_token": str(uuid.uuid4()), "receipt_refs": [{"kind": "BULK", "id": str(physical_id)}], "reason": "Attempted physical receipt alias overlap"}, format="json")
        self.assertEqual(duplicate.status_code, 409)
        self.assertEqual(InwardBillReceiptReference.objects.count(), 1)

    def po_payload(self, **changes):
        po = PurchaseOrder.objects.create(code="BILL-LEGACY-PO", vendor=self.vendor, plant=self.plant, status="SENT")
        line = PurchaseOrderItem.objects.create(purchase_order=po, material=self.material, qty_ordered=100, uom="KG", rate_per_uom=4)
        data = {"client_token": str(uuid.uuid4()), "purchase_order": str(po.id), "location_id": str(self.location.id), "vendor_invoice_no": "BILL-LEGACY-I", "lines": [{"po_item_id": str(line.id), "qty_received": "5"}]}
        data.update(changes)
        return data

    def test_rejected_po_children_are_neither_candidates_nor_linkable(self):
        bill = self.new_bill()
        posted = self.review.post("/api/procurement/purchase-order-receipts/", self.po_payload(quality_status="REJECTED"), format="json")
        self.assertEqual(posted.status_code, 201, posted.data)
        tx = BulkTransaction.objects.get()
        rows = self.review.get(f"/api/gate/inward-bills/{bill}/receipt-candidates/").data["results"]
        self.assertFalse(any(row["id"] == str(tx.id) for row in rows))
        rejected = self.review.post(f"/api/gate/inward-bills/{bill}/link-receipts/", {"client_token": str(uuid.uuid4()), "receipt_refs": [{"kind": "BULK", "id": str(tx.id)}], "reason": "Attempt to match a rejected parent receipt"}, format="json")
        self.assertEqual(rejected.status_code, 400, rejected.data)
        self.assertFalse(InwardBillReceiptReference.objects.exists())
        self.assertEqual(InwardBillIntake.objects.get().status, "PENDING_GRN")

    def test_parent_and_physical_child_alias_in_same_request_roll_back_all_links(self):
        bill = self.new_bill()
        posted = self.review.post("/api/procurement/purchase-order-receipts/", self.po_payload(), format="json")
        self.assertEqual(posted.status_code, 201, posted.data)
        tx = BulkTransaction.objects.get()
        refs = [{"kind": "PO_RECEIPT", "id": str(posted.data["id"])}, {"kind": "BULK", "id": str(tx.id)}]
        for ordered in [refs, list(reversed(refs))]:
            result = self.review.post(f"/api/gate/inward-bills/{bill}/link-receipts/", {"client_token": str(uuid.uuid4()), "receipt_refs": ordered, "reason": "Parent and child represent the same physical receipt"}, format="json")
            self.assertEqual(result.status_code, 409, result.data)
            self.assertFalse(InwardBillReceiptReference.objects.exists())
        self.assertEqual(InventoryBulk.objects.get().qty_kg, Decimal("5"))

    def test_legacy_po_token_collision_requires_explicit_matching_and_header_agreement(self):
        payload = self.po_payload()
        posted = self.review.post("/api/procurement/purchase-order-receipts/", payload, format="json")
        self.assertEqual(posted.status_code, 201, posted.data)
        bill = self.new_bill()
        actor = User.objects.create_user(username="bill-second-po-actor", role=self.store.role)
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(actor).access_token}")
        changed = {**payload, "inward_bill_id": bill, "vendor_invoice_no": "BILL-CHANGED-I", "lines": [{**payload["lines"][0], "qty_received": "20"}]}
        result = client.post("/api/procurement/purchase-order-receipts/", changed, format="json")
        self.assertEqual(result.status_code, 409, result.data)
        self.assertFalse(InwardBillReceiptReference.objects.exists())
        self.assertEqual(PurchaseOrderReceipt.objects.count(), 1)
        self.assertEqual(InventoryBulk.objects.get().qty_kg, Decimal("5"))
        changed["client_token"] = str(uuid.uuid4())
        mismatch = client.post("/api/procurement/purchase-order-receipts/", changed, format="json", HTTP_IDEMPOTENCY_KEY=payload["client_token"])
        self.assertEqual(mismatch.status_code, 400, mismatch.data)
        self.assertFalse(InwardBillReceiptReference.objects.exists())
        self.assertEqual(InventoryBulk.objects.get().qty_kg, Decimal("5"))

    @override_settings(ALLOW_ROLE_OVERRIDE=True)
    def test_real_jwt_master_upload_retry_in_watchman_preview_redacts_cached_payload(self):
        first_bill = self.new_bill()
        GateAssignment.objects.create(user=self.owner, plant=self.plant)
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(self.owner).access_token}")
        token = str(uuid.uuid4())
        def payload():
            return {"client_token": token, "plant": str(self.plant.id), "images": [photo()]}
        initial = client.post("/api/gate/inward-bills/", payload(), format="multipart")
        self.assertEqual(initial.status_code, 201, initial.data)
        self.assertIn(first_bill, initial.data["duplicate_warning"]["bill_ids"])
        replay = client.post("/api/gate/inward-bills/", payload(), format="multipart", HTTP_X_ROLE_OVERRIDE="WATCHMAN")
        self.assertEqual(replay.status_code, 201, replay.data)
        self.assertTrue(replay.data["replayed"])
        self.assertEqual(replay.data["duplicate_warning"]["bill_ids"], [])
        self.assertEqual(replay.data["review_data"], {})
        self.assertEqual(replay.data["receipt_refs"], [])
        self.assertEqual(InwardBillIntake.objects.count(), 2)

    def test_packaging_and_roll_posting_are_linked_without_early_completion(self):
        bill = self.new_bill()
        packaging = InventoryMaterial.objects.create(code="BILL-BOXES", name="Boxes", category="PACKAGING", base_uom="PCS")
        payload = self.grn(bill, klass="PACKAGING", lines=[{"material_id": str(packaging.id), "qty": "10", "uom": "PCS", "unit_cost": "2"}])
        packaged = self.review.post("/api/inventory/grn/create/", payload, format="json")
        self.assertEqual(packaged.status_code, 201, packaged.data)
        self.assertEqual(packaged.data["inward_bill"]["status"], "PARTIAL_GRN")
        film = InventoryMaterial.objects.create(code="BILL-FILM", name="Film", category="FILM_VARIANT", base_uom="KG")
        payload = self.grn(bill, klass="ROLL", lines=[{"material_id": str(film.id), "net_weight_kg": "20", "width_mm": "500", "thickness_micron": "25", "unit_cost": "3"}], bill_complete=True)
        rolled = self.review.post("/api/inventory/grn/create/", payload, format="json")
        self.assertEqual(rolled.status_code, 201, rolled.data)
        self.assertEqual(rolled.data["inward_bill"]["status"], "RECEIPTED")
        self.assertEqual(set(InwardBillReceiptReference.objects.values_list("kind", flat=True)), {"PACKAGING", "ROLL"})

    def test_consumed_legacy_roll_links_original_receipt_quantity(self):
        from apps.inventory.services.grn import GRNService
        from apps.inventory.services.roll_service import RollService
        bill = self.new_bill()
        material = InventoryMaterial.objects.create(code="BILL-LEGACY-FILM", name="Legacy film", category="FILM_VARIANT", base_uom="KG")
        roll = GRNService.create_roll_grn(material=material, location=self.location, vendor=self.vendor, plant=self.plant, rolls_data=[{"width_mm": "500", "thickness_micron": "25", "weight_kg": "20"}], vendor_invoice_no="BILL-OLD-ROLL")[0]
        RollService.split_roll(roll, [{"weight_kg": "20"}], user=self.store)
        roll.refresh_from_db()
        self.assertEqual(roll.weight_kg, 0)
        self.assertIsNone(roll.net_weight_kg)
        candidates = self.review.get(f"/api/gate/inward-bills/{bill}/receipt-candidates/", {"search": "BILL-OLD-ROLL"})
        row = next(item for item in candidates.data["results"] if item["id"] == str(roll.id))
        self.assertEqual(Decimal(row["quantity"]), Decimal("20"))
        result = self.review.post(f"/api/gate/inward-bills/{bill}/link-receipts/", {"client_token": str(uuid.uuid4()), "receipt_refs": [{"kind": "ROLL", "id": str(roll.id)}], "reason": "Original receipt is valid after the roll was split", "bill_complete": True}, format="json")
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual(result.data["status"], "RECEIPTED")
        self.assertEqual(Decimal(result.data["receipt_refs"][0]["quantity"]), Decimal("20"))

    def test_invoice_reference_required_and_concurrent_distinct_post_tokens_do_not_double_stock(self):
        bill = self.new_bill()
        missing = self.review.post("/api/inventory/grn/create/", self.grn(bill, vendor_invoice_no=""), format="json")
        self.assertEqual(missing.status_code, 400)
        self.assertFalse(BulkTransaction.objects.exists())
        if connection.vendor != "postgresql":
            self.skipTest("PostgreSQL concurrency acceptance")
        role, _ = Role.objects.get_or_create(code="STORE", defaults={"name": "Inventory"})
        second = User.objects.create_user(username="bill-store-second", role=role)
        def post(actor):
            close_old_connections()
            try:
                client = APIClient()
                client.force_authenticate(User.objects.get(id=actor))
                return client.post("/api/inventory/grn/create/", self.grn(bill, vendor_invoice_no="BILL-RACE"), format="json").status_code
            finally:
                connections["default"].close()
        with ThreadPoolExecutor(max_workers=2) as pool:
            statuses = list(pool.map(post, [self.store.id, second.id]))
        self.assertEqual(statuses.count(201), 1)
        self.assertEqual(statuses.count(400), 1)
        self.assertEqual(BulkTransaction.objects.filter(type="INWARD").count(), 1)
        self.assertEqual(InventoryBulk.objects.get().qty_kg, Decimal("25"))
        self.assertEqual(InwardBillReceiptReference.objects.count(), 1)

    def test_link_existing_grn_reference_search_and_empty_completion_guard(self):
        bill = self.new_bill()
        self.assertEqual(self.review.post(f"/api/gate/inward-bills/{bill}/complete/", {"client_token": str(uuid.uuid4()), "reason": "Trying to finish without any stock receipt"}, format="json").status_code, 400)
        payload = self.grn(bill, vendor_invoice_no="LINK-I")
        payload.pop("inward_bill_id")
        posted = self.review.post("/api/inventory/grn/create/", payload, format="json")
        self.assertEqual(posted.status_code, 201, posted.data)
        tx = BulkTransaction.objects.get()
        tx.reference = "UNIQUE-REFERENCE"
        tx.save()
        candidates = self.review.get(f"/api/gate/inward-bills/{bill}/receipt-candidates/", {"search": "UNIQUE-REFERENCE"})
        self.assertEqual(candidates.status_code, 200, candidates.data)
        self.assertEqual(candidates.data["results"][0]["id"], str(tx.id))
        token = str(uuid.uuid4())
        link = {"client_token": token, "receipt_refs": [{"kind": "BULK", "id": str(tx.id)}], "reason": "Matched the invoice images against the receipt", "bill_complete": True}
        linked = self.review.post(f"/api/gate/inward-bills/{bill}/link-receipts/", link, format="json")
        self.assertEqual(linked.status_code, 200, linked.data)
        self.assertEqual(linked.data["status"], "RECEIPTED")
        self.assertTrue(self.review.post(f"/api/gate/inward-bills/{bill}/link-receipts/", link, format="json").data["replayed"])
        self.assertEqual(BulkTransaction.objects.count(), 1)
        other = self.new_bill()
        link["client_token"] = str(uuid.uuid4())
        self.assertEqual(self.review.post(f"/api/gate/inward-bills/{other}/link-receipts/", link, format="json").status_code, 409)

    def test_explained_void_preserves_images_and_sql_evidence(self):
        bill = self.new_bill()
        refused = self.review.post(f"/api/gate/inward-bills/{bill}/void/", {"client_token": str(uuid.uuid4()), "reason": "Equipment service bill has no inventory stock", "resolution_code": "NON_STOCK"}, format="json")
        self.assertEqual(refused.status_code, 400, refused.data)
        self.assertIn("General Receipt", str(refused.data))
        result = self.review.post(f"/api/gate/inward-bills/{bill}/void/", {"client_token": str(uuid.uuid4()), "reason": "Photo is blurred beyond reading", "resolution_code": "UNREADABLE"}, format="json")
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual(result.data["status"], "VOID")
        self.assertEqual(InwardBillPage.objects.count(), 1)
        self.assertEqual(GateAuditEvent.objects.filter(action="BILL_VOIDED").count(), 1)
        page = InwardBillPage.objects.get()
        with self.assertRaises(TypeError):
            page.save()
        if connection.vendor == "postgresql":
            for sql, args in [(f'UPDATE {InwardBillPage._meta.db_table} SET width=1 WHERE id=%s', [str(page.id)]), (f'DELETE FROM {InwardBillIntake._meta.db_table} WHERE id=%s', [bill])]:
                with self.assertRaises(DatabaseError), transaction.atomic():
                    with connection.cursor() as cursor:
                        cursor.execute(sql, args)

    def test_concurrent_same_upload_token_records_one_arrival_and_notification_set(self):
        if connection.vendor != "postgresql":
            self.skipTest("PostgreSQL concurrency acceptance")
        serializer = BillUploadSerializer(data={"client_token": uuid.uuid4(), "plant": self.plant.id, "images": [photo()]})
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        def submit(_):
            close_old_connections()
            try:
                return upload_bill(User.objects.get(id=self.watchman.id), data)
            finally:
                connections["default"].close()
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(submit, [1, 2]))
        self.assertEqual({row["id"] for row in results}, {str(InwardBillIntake.objects.get().id)})
        self.assertEqual(sum(row["replayed"] for row in results), 1)
        self.assertEqual(GateAuditEvent.objects.filter(action="BILL_ARRIVED").count(), 1)
        self.assertEqual(Notification.objects.filter(event_key="gate.inward_bill_uploaded").count(), 2)
