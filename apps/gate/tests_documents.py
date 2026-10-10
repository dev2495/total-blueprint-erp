"""Bills & documents register: office upload (photos + PDF), classify, file,
attach/detach/reopen, void rules, register filters, reports, reminders and
permissions. No action here may change production stock."""
import csv
import hashlib
import io
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from decimal import Decimal

from PIL import Image
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import close_old_connections, connection, connections
from django.test import TestCase, TransactionTestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from apps.factory.models import Plant
from apps.inventory.models import BulkTransaction, InventoryBulk, InventoryLocation, InventoryRoll, PackagingStock, PackagingTransaction, Vendor
from apps.users.models import Notification, Role, User
from .bill_services import backfill_headers_from_review, bill_payload, bill_queryset
from .document_pages import serialize_pages
from .document_reminders import DUE_EVENT, VALID_UNTIL_EVENT, run_document_reminders
from .models import DocumentOriginalFile, GateAuditEvent, InwardBillIntake, InwardBillPage, InwardBillReceiptReference
from .services import gate_today, invoice_fiscal_year
from .tests import fixture


def png_bytes(color="#eeeeee", size=(1200, 1600)):
    buffer = io.BytesIO()
    Image.new("RGB", size, color).save(buffer, "PNG")
    return buffer.getvalue()


def pdf_bytes(pages=2, password=None):
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas
    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=A4, encrypt=password)
    for index in range(pages):
        pdf.setFont("Helvetica", 18)
        pdf.drawString(72, 760, f"Sample Power Co utility bill - page {index + 1}")
        pdf.drawString(72, 720, "Amount payable Rs 9,87,654.00")
        pdf.showPage()
    pdf.save()
    return buffer.getvalue()


def upload(data, name, content_type):
    return SimpleUploadedFile(name, data, content_type=content_type)


def make_user(username, role_code, extras=None, role_permissions=None, **flags):
    role, _ = Role.objects.get_or_create(code=role_code, defaults={"name": role_code.title()})
    if role_permissions is not None:
        role.default_permissions = role_permissions
        role.save(update_fields=["default_permissions"])
    return User.objects.create_user(username=username, email=f"{username}@example.test", role=role, extra_permissions=extras or [], **flags)


def client_for(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


def stock_counts():
    return {model.__name__: model.objects.count() for model in (InventoryRoll, InventoryBulk, BulkTransaction, PackagingStock, PackagingTransaction)}


DOCUMENT_RIGHTS = ["documents.view", "documents.upload", "documents.manage"]


class DocumentFixtureMixin:
    def build_fixture(self):
        self.owner, self.watchman, self.plant, self.other, self.link, self.vendor, self.material = fixture()
        self.store = make_user("doc-store", "STORE")
        self.planner = make_user("doc-planner", "PLANNER")
        self.sales = make_user("doc-sales", "SALES", extras=["*"])
        self.accounts = make_user("doc-accounts", "ACCOUNTS", role_permissions=DOCUMENT_RIGHTS)
        self.extra = make_user("doc-extra", "DISPATCH", extras=DOCUMENT_RIGHTS)
        self.uploader = make_user("doc-uploader", "CLERK", extras=["documents.upload"])
        self.vendor_two = Vendor.objects.create(code="DOC-V2", name="Shree Sai Consultancy")
        self.clients = {}

    def as_(self, user):
        if user.pk not in self.clients:
            self.clients[user.pk] = client_for(user)
        return self.clients[user.pk]

    def make_doc(self, plant=None, source="GATE", created_by=None, pages=1, **fields):
        bill = InwardBillIntake.objects.create(plant=plant or self.plant, created_by=created_by or self.watchman, content_hash=uuid.uuid4().hex + uuid.uuid4().hex, source=source, **fields)
        for number in range(1, pages + 1):
            data = png_bytes(size=(400, 400))
            InwardBillPage.objects.create(intake=bill, page_number=number, data=data, width=400, height=400, byte_size=len(data), sha256=hashlib.sha256(data).hexdigest())
        return bill

    def classify(self, bill_id, user=None, **fields):
        bill = InwardBillIntake.objects.get(id=bill_id)
        payload = {"client_token": str(uuid.uuid4()), "header_version": bill.header_version, **fields}
        return self.as_(user or self.store).post(f"/api/gate/inward-bills/{bill_id}/classify/", payload, format="json")

    def utility_header(self, **changes):
        data = {"doc_type": "UTILITY_BILL", "category": "UTILITY", "party_name": "Sample Power Co", "invoice_number": "UTL-2026-0101", "invoice_date": str(gate_today() - timedelta(days=4)), "taxable_amount": "837000.00", "tax_amount": "150654.00", "total_amount": "987654.00", "due_date": str(gate_today() + timedelta(days=10))}
        data.update(changes)
        return data

    def office(self, user, files, token=None, **fields):
        data = {"client_token": str(token or uuid.uuid4()), "plant": str(self.plant.id), "files": files, **fields}
        return self.as_(user).post("/api/gate/inward-bills/office-upload/", data, format="multipart")


class OfficeUploadTests(DocumentFixtureMixin, TestCase):
    def setUp(self):
        self.build_fixture()

    def test_pdf_and_photo_render_pages_keep_original_and_replay_once(self):
        before = stock_counts()
        pdf, photo = pdf_bytes(2), png_bytes()
        token = uuid.uuid4()
        first = self.office(self.store, [upload(pdf, "power-bill.pdf", "application/pdf"), upload(photo, "page.png", "image/png")], token)
        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(first.data["source"], "OFFICE")
        self.assertEqual(first.data["status"], "PENDING_GRN")
        self.assertEqual(first.data["page_count"], 3)
        self.assertFalse(first.data["replayed"])
        bill = InwardBillIntake.objects.get()
        self.assertEqual(bill.source, "OFFICE")
        pages = list(bill.pages.order_by("page_number"))
        for page in pages:
            image = Image.open(io.BytesIO(bytes(page.data)))
            self.assertEqual(image.format, "JPEG")
            self.assertLessEqual(max(image.size), 2400)
            self.assertGreaterEqual(min(image.size), 320)
        # A4 at ~200 DPI is about 1654 x 2339 px.
        self.assertAlmostEqual(pages[0].width, 1654, delta=4)
        original = DocumentOriginalFile.objects.get()
        self.assertEqual(original.page_count, 2)
        self.assertEqual(original.content_type, "application/pdf")
        self.assertEqual(bytes(original.data), pdf)
        self.assertEqual(original.file_name, "power-bill.pdf")
        self.assertEqual(len(first.data["original_files"]), 1)
        self.assertEqual(GateAuditEvent.objects.filter(action="BILL_OFFICE_UPLOADED", object_id=bill.id).count(), 1)
        self.assertFalse(Notification.objects.filter(event_key="gate.inward_bill_uploaded").exists())
        replay = self.office(self.store, [upload(pdf, "power-bill.pdf", "application/pdf"), upload(photo, "page.png", "image/png")], token)
        self.assertEqual(replay.status_code, 201, replay.data)
        self.assertTrue(replay.data["replayed"])
        self.assertEqual(replay.data["id"], first.data["id"])
        changed = self.office(self.store, [upload(pdf, "power-bill.pdf", "application/pdf")], token)
        self.assertEqual(changed.status_code, 409)
        self.assertEqual(InwardBillIntake.objects.count(), 1)
        self.assertEqual(DocumentOriginalFile.objects.count(), 1)
        download = self.as_(self.store).get(first.data["original_files"][0]["download_url"])
        self.assertEqual(download.status_code, 200)
        self.assertEqual(download["Content-Type"], "application/pdf")
        self.assertIn("attachment;", download["Content-Disposition"])
        self.assertIn("power-bill.pdf", download["Content-Disposition"])
        self.assertEqual(download["Cache-Control"], "private, no-store")
        self.assertEqual(download.content, pdf)
        for outsider in (self.planner, self.sales):
            self.assertEqual(self.as_(outsider).get(first.data["original_files"][0]["download_url"]).status_code, 403)
        self.assertEqual(self.as_(self.watchman).get(first.data["original_files"][0]["download_url"]).status_code, 403)
        inbox = self.as_(self.store).get("/api/gate/inward-bills/", {"status": "NEEDS_CLASSIFYING"})
        self.assertEqual([row["id"] for row in inbox.data["results"]], [first.data["id"]])
        self.assertEqual(stock_counts(), before)
        with self.assertRaises(TypeError):
            original.save()

    def test_encrypted_damaged_oversized_and_wrong_files_are_refused_whole(self):
        cases = [
            ([upload(pdf_bytes(1, password="secret"), "locked.pdf", "application/pdf")], "password"),
            ([upload(b"%PDF-1.4\n%garbage that is not a pdf", "broken.pdf", "application/pdf")], "damaged"),
            ([upload(pdf_bytes(21), "long.pdf", "application/pdf")], "20 pages"),
            ([upload(png_bytes(), "a.png", "image/png"), upload(pdf_bytes(20), "fits-not.pdf", "application/pdf")], "only 19 more"),
            ([upload(b"plain text", "notes.txt", "text/plain")], "JPEG"),
            ([upload(png_bytes(size=(200, 200)), "tiny.png", "image/png")], "320"),
        ]
        for files, needle in cases:
            with self.subTest(needle=needle):
                response = self.office(self.store, files)
                self.assertEqual(response.status_code, 400, response.data)
                self.assertIn(needle, str(response.data))
        big = SimpleUploadedFile("huge.pdf", b"%PDF-1.4\n" + b"0" * (15 * 1024 * 1024), content_type="application/pdf")
        self.assertEqual(self.office(self.store, [big]).status_code, 400)
        self.assertFalse(InwardBillIntake.objects.exists())
        self.assertFalse(DocumentOriginalFile.objects.exists())

    def test_upload_permission_matrix_and_upload_only_cannot_file(self):
        allowed = [self.store, self.owner, self.accounts, self.extra, self.uploader]
        for user in allowed:
            with self.subTest(user=user.username):
                response = self.office(user, [upload(png_bytes(color=f"#{abs(hash(user.username)) % 0xFFFFFF:06x}"), "p.png", "image/png")])
                self.assertEqual(response.status_code, 201, response.data)
        for user in (self.planner, self.sales, self.watchman):
            with self.subTest(user=user.username):
                self.assertEqual(self.office(user, [upload(png_bytes(), "p.png", "image/png")]).status_code, 403)
        uploaded = InwardBillIntake.objects.filter(created_by=self.uploader).get()
        self.assertEqual(self.classify(uploaded.id, self.uploader, **self.utility_header()).status_code, 403)
        self.assertEqual(self.as_(self.uploader).post(f"/api/gate/inward-bills/{uploaded.id}/file/", {"client_token": str(uuid.uuid4())}, format="json").status_code, 403)
        # documents.upload implies documents.view: the uploader can open what was uploaded.
        self.assertEqual(self.as_(self.uploader).get(f"/api/gate/inward-bills/{uploaded.id}/").status_code, 200)

    def test_upload_with_quick_header_is_classified(self):
        response = self.office(self.store, [upload(pdf_bytes(1), "licence.pdf", "application/pdf")], vendor_id=str(self.vendor_two.id), doc_type="TAX_INVOICE", category="PROFESSIONAL_STATUTORY", invoice_number=" ssc / 26 - 91 ", invoice_date=str(gate_today() - timedelta(days=2)), total_amount="48000.00", valid_until=str(gate_today() + timedelta(days=5 * 365)))
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["category"], "PROFESSIONAL_STATUTORY")
        self.assertEqual(response.data["vendor"], str(self.vendor_two.id))
        self.assertEqual(response.data["header_version"], 1)
        bill = InwardBillIntake.objects.get()
        self.assertEqual(bill.invoice_number, "ssc / 26 - 91")
        self.assertEqual(bill.invoice_normalized, "SSC / 26 - 91")
        self.assertEqual(bill.invoice_fy, invoice_fiscal_year(gate_today() - timedelta(days=2)))
        self.assertEqual(bill.review_data["vendor_id"], str(self.vendor_two.id))


class ClassifyFileAttachTests(DocumentFixtureMixin, TestCase):
    def setUp(self):
        self.build_fixture()
        self.location = InventoryLocation.objects.create(code="DOC-RM", name="Raw material store", plant=self.plant, type="RM")

    def test_classify_validates_versions_amounts_and_syncs_review_data(self):
        bill = self.make_doc()
        bad_total = self.classify(bill.id, **self.utility_header(total_amount="987660.00"))
        self.assertEqual(bad_total.status_code, 400)
        self.assertIn("total_amount", str(bad_total.data))
        future = self.classify(bill.id, **self.utility_header(invoice_date=str(gate_today() + timedelta(days=3))))
        self.assertEqual(future.status_code, 400)
        Vendor.objects.filter(id=self.vendor_two.id).update(status="INACTIVE")
        self.assertEqual(self.classify(bill.id, vendor_id=str(self.vendor_two.id)).status_code, 400)
        both = self.classify(bill.id, vendor_id=str(self.vendor.id), party_name="Someone else")
        self.assertEqual(both.status_code, 400)
        saved = self.classify(bill.id, **self.utility_header())
        self.assertEqual(saved.status_code, 200, saved.data)
        self.assertEqual(saved.data["header_version"], 1)
        self.assertEqual(saved.data["category"], "UTILITY")
        self.assertEqual(saved.data["party_display"], "Sample Power Co")
        self.assertIn("duplicate_candidates", saved.data)
        self.assertIn("file", saved.data["allowed_actions"])
        bill.refresh_from_db()
        self.assertEqual(bill.invoice_normalized, "UTL-2026-0101")
        self.assertEqual(bill.review_data["invoice_number"], "UTL-2026-0101")
        self.assertEqual(bill.classified_by, self.store)
        stale = self.as_(self.store).post(f"/api/gate/inward-bills/{bill.id}/classify/", {"client_token": str(uuid.uuid4()), "header_version": 0, "notes": "Late edit"}, format="json")
        self.assertEqual(stale.status_code, 409)
        event = GateAuditEvent.objects.filter(object_id=bill.id, action="BILL_CLASSIFIED").get()
        self.assertEqual(event.before["category"], "")
        self.assertEqual(event.after["category"], "UTILITY")
        with_vendor = self.classify(bill.id, vendor_id=str(self.vendor.id), ship_to_plant=str(self.other.id))
        self.assertEqual(with_vendor.status_code, 200, with_vendor.data)
        self.assertEqual(with_vendor.data["party_name"], "")
        self.assertEqual(with_vendor.data["ship_to_plant_name"], self.other.name)
        self.assertEqual(InwardBillIntake.objects.get(id=bill.id).review_data["vendor_id"], str(self.vendor.id))

    def test_classify_permission_matrix(self):
        bill = self.make_doc()
        for user, expected in [(self.store, 200), (self.owner, 200), (self.accounts, 200), (self.extra, 200), (self.planner, 403), (self.sales, 403), (self.watchman, 403)]:
            with self.subTest(user=user.username):
                response = self.classify(bill.id, user, notes=f"checked by {user.username}")
                self.assertEqual(response.status_code, expected, response.data)

    def test_review_endpoint_updates_register_columns(self):
        bill = self.make_doc()
        response = self.as_(self.store).post(f"/api/gate/inward-bills/{bill.id}/review/", {"client_token": str(uuid.uuid4()), "vendor_id": str(self.vendor.id), "invoice_number": "s 5203", "invoice_date": str(gate_today() - timedelta(days=1))}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        bill.refresh_from_db()
        self.assertEqual(bill.vendor, self.vendor)
        self.assertEqual(bill.invoice_number, "s 5203")
        self.assertEqual(bill.invoice_normalized, "S 5203")
        self.assertEqual(bill.header_version, 1)
        self.assertEqual(response.data["invoice_number"], "s 5203")

    def test_file_needs_header_blocks_duplicates_and_accepts_override(self):
        bill = self.make_doc(source="OFFICE")
        refused = self.as_(self.store).post(f"/api/gate/inward-bills/{bill.id}/file/", {"client_token": str(uuid.uuid4())}, format="json")
        self.assertEqual(refused.status_code, 400)
        self.assertIn("category", str(refused.data))
        self.classify(bill.id, doc_type="UTILITY_BILL", category="UTILITY")
        missing = self.as_(self.store).post(f"/api/gate/inward-bills/{bill.id}/file/", {"client_token": str(uuid.uuid4())}, format="json")
        self.assertEqual(missing.status_code, 400)
        for field in ("vendor_id", "invoice_number", "invoice_date", "total_amount"):
            self.assertIn(field, str(missing.data))
        self.classify(bill.id, **self.utility_header())
        filed = self.as_(self.store).post(f"/api/gate/inward-bills/{bill.id}/file/", {"client_token": str(uuid.uuid4()), "reason": "Monthly HT power bill"}, format="json")
        self.assertEqual(filed.status_code, 200, filed.data)
        self.assertEqual(filed.data["status"], "FILED")
        self.assertIsNotNone(filed.data["resolved_at"])
        self.assertEqual(filed.data["resolved_by_name"], self.store.username)
        self.assertEqual(self.classify(bill.id, notes="after filing").status_code, 409)
        # The same paper uploaded again at the other factory is a duplicate across plants.
        twin = self.make_doc(plant=self.other, source="OFFICE")
        self.classify(twin.id, **self.utility_header(invoice_number="utl-2026-0101"))
        detail = self.as_(self.store).get(f"/api/gate/inward-bills/{twin.id}/")
        self.assertEqual([row["id"] for row in detail.data["duplicate_candidates"]], [str(bill.id)])
        blocked = self.as_(self.store).post(f"/api/gate/inward-bills/{twin.id}/file/", {"client_token": str(uuid.uuid4())}, format="json")
        self.assertEqual(blocked.status_code, 409)
        self.assertIn("duplicate_override_reason", str(blocked.data))
        override = self.as_(self.store).post(f"/api/gate/inward-bills/{twin.id}/file/", {"client_token": str(uuid.uuid4()), "duplicate_override_reason": "Supplementary bill with the same number"}, format="json")
        self.assertEqual(override.status_code, 200, override.data)
        event = GateAuditEvent.objects.get(object_id=twin.id, action="BILL_FILED")
        self.assertEqual(event.after["duplicate_override_reason"], "Supplementary bill with the same number")
        self.assertEqual(event.after["duplicate_ids"], [str(bill.id)])

    def test_file_eligibility_debit_note_and_permissions(self):
        stock = self.make_doc()
        self.classify(stock.id, doc_type="TAX_INVOICE", category="STOCK", vendor_id=str(self.vendor.id), invoice_number="S1001", invoice_date=str(gate_today()), total_amount="100")
        self.assertEqual(self.as_(self.store).post(f"/api/gate/inward-bills/{stock.id}/file/", {"client_token": str(uuid.uuid4())}, format="json").status_code, 400)
        note = self.make_doc(source="OFFICE")
        self.classify(note.id, doc_type="DEBIT_NOTE", vendor_id=str(self.vendor.id), invoice_number="DN/26-27/01", invoice_date=str(gate_today() - timedelta(days=1)), total_amount="41000.00")
        for user in (self.planner, self.uploader, self.watchman):
            self.assertEqual(self.as_(user).post(f"/api/gate/inward-bills/{note.id}/file/", {"client_token": str(uuid.uuid4())}, format="json").status_code, 403)
        filed = self.as_(self.accounts).post(f"/api/gate/inward-bills/{note.id}/file/", {"client_token": str(uuid.uuid4()), "original_invoice_ref": "INV/26-27/1180"}, format="json")
        self.assertEqual(filed.status_code, 200, filed.data)
        self.assertEqual(filed.data["original_invoice_ref"], "INV/26-27/1180")

    def grn(self, bill_id, **changes):
        data = {"client_token": str(uuid.uuid4()), "inward_bill_id": str(bill_id), "klass": "BULK", "vendor_id": str(self.vendor.id), "vendor_invoice_no": "S1001", "plant_id": str(self.plant.id), "store_location_id": str(self.location.id), "lines": [{"material_id": str(self.material.id), "qty": "25", "unit_cost": "4", "uom": "KG"}]}
        data.update(changes)
        return self.as_(self.store).post("/api/inventory/grn/create/", data, format="json")

    def test_grn_adopts_stock_header_and_record_only_category_is_refused_after_receipts(self):
        bill = self.make_doc()
        posted = self.grn(bill.id)
        self.assertEqual(posted.status_code, 201, posted.data)
        bill.refresh_from_db()
        self.assertEqual(bill.category, "STOCK")
        self.assertEqual(bill.vendor, self.vendor)
        self.assertEqual(bill.invoice_number, "S1001")
        self.assertEqual(bill.status, "PARTIAL_GRN")
        refused = self.classify(bill.id, category="UTILITY")
        self.assertEqual(refused.status_code, 400)
        self.assertIn("receipts linked", str(refused.data))
        self.assertEqual(self.as_(self.store).post(f"/api/gate/inward-bills/{bill.id}/file/", {"client_token": str(uuid.uuid4())}, format="json").status_code, 409)
        record_only = self.make_doc()
        self.classify(record_only.id, category="UTILITY")
        self.assertEqual(self.grn(record_only.id).status_code, 400)
        self.assertEqual(BulkTransaction.objects.count(), 1)

    def test_transport_lr_attaches_to_stock_bill_then_detach_and_reopen_are_owner_only(self):
        stock = self.make_doc()
        self.classify(stock.id, category="STOCK", vendor_id=str(self.vendor.id), invoice_number="S1001")
        lr = self.make_doc()
        self.classify(lr.id, doc_type="LR_TRANSPORT", category="TRANSPORT", party_name="Sample Roadlines", invoice_number="LR-100200", total_amount="4800.00")
        other_plant = self.make_doc(plant=self.other)
        self.assertEqual(self.as_(self.store).post(f"/api/gate/inward-bills/{lr.id}/attach/", {"client_token": str(uuid.uuid4()), "target_bill_id": str(other_plant.id), "reason": "Freight LR for film rolls"}, format="json").status_code, 400)
        self.assertEqual(self.as_(self.planner).post(f"/api/gate/inward-bills/{lr.id}/attach/", {"client_token": str(uuid.uuid4()), "target_bill_id": str(stock.id), "reason": "Freight LR for film rolls"}, format="json").status_code, 403)
        attached = self.as_(self.store).post(f"/api/gate/inward-bills/{lr.id}/attach/", {"client_token": str(uuid.uuid4()), "target_bill_id": str(stock.id), "reason": "Freight LR for film rolls (to pay)"}, format="json")
        self.assertEqual(attached.status_code, 200, attached.data)
        self.assertEqual(attached.data["status"], "FILED")
        self.assertEqual(attached.data["attached_to"]["id"], str(stock.id))
        target = self.as_(self.store).get(f"/api/gate/inward-bills/{stock.id}/").data
        self.assertEqual(target["supporting_documents"][0]["id"], str(lr.id))
        self.assertEqual(target["supporting_documents"][0]["total_amount"], "4800.00")
        self.assertEqual(target["supporting_documents"][0]["page_count"], 1)
        self.assertNotIn("void", target["allowed_actions"])
        self.assertEqual(self.as_(self.store).post(f"/api/gate/inward-bills/{stock.id}/void/", {"client_token": str(uuid.uuid4()), "reason": "Wrong upload of the bill", "resolution_code": "UNREADABLE"}, format="json").status_code, 409)
        self.assertEqual(GateAuditEvent.objects.filter(object_id=stock.id, action="BILL_SUPPORT_ADDED").count(), 1)
        self.assertEqual(self.as_(self.store).post(f"/api/gate/inward-bills/{lr.id}/detach/", {"client_token": str(uuid.uuid4()), "reason": "Attached to the wrong bill"}, format="json").status_code, 403)
        detached = self.as_(self.owner).post(f"/api/gate/inward-bills/{lr.id}/detach/", {"client_token": str(uuid.uuid4()), "reason": "Attached to the wrong bill"}, format="json")
        self.assertEqual(detached.status_code, 200, detached.data)
        self.assertEqual(detached.data["status"], "PENDING_GRN")
        self.assertIsNone(detached.data["attached_to"])
        filed = self.make_doc(source="OFFICE")
        self.classify(filed.id, **self.utility_header(invoice_number="UTL-2026-0199"))
        self.as_(self.store).post(f"/api/gate/inward-bills/{filed.id}/file/", {"client_token": str(uuid.uuid4())}, format="json")
        self.assertEqual(self.as_(self.store).post(f"/api/gate/inward-bills/{filed.id}/reopen/", {"client_token": str(uuid.uuid4()), "reason": "Filed against the wrong category"}, format="json").status_code, 403)
        reopened = self.as_(self.owner).post(f"/api/gate/inward-bills/{filed.id}/reopen/", {"client_token": str(uuid.uuid4()), "reason": "Filed against the wrong category"}, format="json")
        self.assertEqual(reopened.status_code, 200, reopened.data)
        self.assertEqual(reopened.data["status"], "PENDING_GRN")
        self.assertIsNone(reopened.data["resolved_at"])
        self.assertEqual(GateAuditEvent.objects.filter(object_id=filed.id, action="BILL_REOPENED").count(), 1)
        received = self.make_doc()
        self.assertEqual(self.grn(received.id, bill_complete=True, vendor_invoice_no="S5300").status_code, 201)
        received.refresh_from_db()
        self.assertEqual(received.status, "RECEIPTED")
        self.assertEqual(self.as_(self.owner).post(f"/api/gate/inward-bills/{received.id}/reopen/", {"client_token": str(uuid.uuid4()), "reason": "Trying to reopen a received bill"}, format="json").status_code, 409)

    def test_void_rules_for_document_managers(self):
        bill = self.make_doc()
        self.assertEqual(self.as_(self.accounts).post(f"/api/gate/inward-bills/{bill.id}/void/", {"client_token": str(uuid.uuid4()), "reason": "Old cleared bill", "resolution_code": "NON_STOCK"}, format="json").status_code, 400)
        response = self.as_(self.accounts).post(f"/api/gate/inward-bills/{bill.id}/void/", {"client_token": str(uuid.uuid4()), "reason": "Bill of the neighbouring unit", "resolution_code": "NOT_OUR_DOCUMENT"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["resolution_code"], "NOT_OUR_DOCUMENT")
        self.assertEqual(self.as_(self.planner).post(f"/api/gate/inward-bills/{self.make_doc().id}/void/", {"client_token": str(uuid.uuid4()), "reason": "Not allowed here", "resolution_code": "UNREADABLE"}, format="json").status_code, 403)
        original = self.make_doc(plant=self.other)
        self.classify(original.id, vendor_id=str(self.vendor.id), invoice_number="MM/1180", invoice_date=str(gate_today()))
        copy = self.make_doc()
        self.classify(copy.id, vendor_id=str(self.vendor.id), invoice_number="mm/1180", invoice_date=str(gate_today()))
        unrelated = self.make_doc(plant=self.other)
        self.assertEqual(self.as_(self.store).post(f"/api/gate/inward-bills/{copy.id}/void/", {"client_token": str(uuid.uuid4()), "reason": "Same courier copy", "resolution_code": "DUPLICATE", "duplicate_of": str(unrelated.id)}, format="json").status_code, 400)
        voided = self.as_(self.store).post(f"/api/gate/inward-bills/{copy.id}/void/", {"client_token": str(uuid.uuid4()), "reason": "Same courier copy", "resolution_code": "DUPLICATE", "duplicate_of": str(original.id)}, format="json")
        self.assertEqual(voided.status_code, 200, voided.data)


class RegisterAndReportTests(DocumentFixtureMixin, TestCase):
    def setUp(self):
        self.build_fixture()
        today = gate_today()
        self.power = self.make_doc(source="OFFICE", doc_type="UTILITY_BILL", category="UTILITY", party_name="Sample Power Co", invoice_number="UTL-0101", invoice_normalized="UTL-0101", invoice_date=today - timedelta(days=4), invoice_fy=invoice_fiscal_year(today), total_amount=Decimal("987654.00"))
        self.spares = self.make_doc(doc_type="TAX_INVOICE", category="SPARES", vendor=self.vendor, invoice_number="SP-1200", invoice_normalized="SP-1200", invoice_date=today - timedelta(days=2), invoice_fy=invoice_fiscal_year(today), total_amount=Decimal("12000.00"))
        self.inbox = self.make_doc()
        self.other_plant = self.make_doc(plant=self.other, category="OTHER_EXPENSE", party_name="=HYPERLINK(\"http://x\")", invoice_number="X1", invoice_normalized="X1", invoice_fy=invoice_fiscal_year(today), total_amount=Decimal("10"))

    def ids(self, response):
        self.assertEqual(response.status_code, 200, response.data)
        return {row["id"] for row in response.data["results"]}

    def test_register_filters_search_ordering(self):
        client = self.as_(self.store)
        self.assertEqual(self.ids(client.get("/api/gate/inward-bills/", {"status": "NEEDS_CLASSIFYING"})), {str(self.inbox.id)})
        self.assertEqual(self.ids(client.get("/api/gate/inward-bills/", {"status": "WAITING_RECEIPT"})), {str(self.power.id), str(self.spares.id), str(self.other_plant.id)})
        self.assertEqual(self.ids(client.get("/api/gate/inward-bills/", {"status": "ALL", "category": "UTILITY,SPARES"})), {str(self.power.id), str(self.spares.id)})
        self.assertEqual(self.ids(client.get("/api/gate/inward-bills/", {"status": "ALL", "category": "NONE", "plant": str(self.plant.id)})), {str(self.inbox.id)})
        self.assertEqual(self.ids(client.get("/api/gate/inward-bills/", {"status": "ALL", "source": "OFFICE"})), {str(self.power.id)})
        self.assertEqual(self.ids(client.get("/api/gate/inward-bills/", {"status": "ALL", "vendor": str(self.vendor.id)})), {str(self.spares.id)})
        self.assertEqual(self.ids(client.get("/api/gate/inward-bills/", {"status": "ALL", "search": "sample power"})), {str(self.power.id)})
        self.assertEqual(self.ids(client.get("/api/gate/inward-bills/", {"status": "ALL", "search": "sp-120"})), {str(self.spares.id)})
        self.assertEqual(self.ids(client.get("/api/gate/inward-bills/", {"status": "ALL", "search": str(self.inbox.id)[:8].upper()})), {str(self.inbox.id)})
        self.assertEqual(self.ids(client.get("/api/gate/inward-bills/", {"status": "ALL", "date_basis": "invoice", "date_from": str(gate_today() - timedelta(days=3)), "date_to": str(gate_today())})), {str(self.spares.id)})
        ordered = client.get("/api/gate/inward-bills/", {"status": "ALL", "ordering": "-total_amount"}).data["results"]
        self.assertEqual(ordered[0]["id"], str(self.power.id))
        newest = client.get("/api/gate/inward-bills/", {"status": "ALL", "ordering": "-arrival_at"}).data["results"]
        self.assertEqual(newest[0]["id"], str(self.other_plant.id))
        for params in ({"status": "BOGUS"}, {"category": "FOOD"}, {"ordering": "party"}, {"date_basis": "due"}, {"source": "EMAIL"}):
            self.assertEqual(client.get("/api/gate/inward-bills/", params).status_code, 400)
        row = next(item for item in client.get("/api/gate/inward-bills/", {"status": "ALL"}).data["results"] if item["id"] == str(self.power.id))
        for key in ("doc_type", "category", "party_display", "invoice_number", "total_amount", "original_files", "supporting_documents", "attached_to", "allowed_actions", "header_version"):
            self.assertIn(key, row)
        self.assertNotIn("duplicate_candidates", row)
        self.assertEqual(self.as_(self.planner).get("/api/gate/inward-bills/").status_code, 403)
        self.assertEqual(self.as_(self.accounts).get("/api/gate/inward-bills/", {"status": "ALL"}).status_code, 200)

    def test_watchman_redaction_hides_every_header_field(self):
        self.inbox.invoice_number = "SECRET-INVOICE"
        self.inbox.party_name = "Secret party"
        self.inbox.total_amount = Decimal("99")
        self.inbox.save()
        listing = self.as_(self.watchman).get("/api/gate/inward-bills/", {"plant": str(self.plant.id)})
        self.assertEqual(listing.status_code, 200, listing.data)
        mine = next(row for row in listing.data["results"] if row["id"] == str(self.inbox.id))
        for key in ("invoice_number", "party_name", "party_display", "total_amount", "category", "doc_type", "vendor", "allowed_actions", "original_files"):
            self.assertNotIn(key, mine)
        self.assertNotIn("SECRET", str(listing.data))
        self.assertEqual(self.as_(self.watchman).get("/api/gate/inward-bills/", {"status": "ALL"}).status_code, 403)

    def test_list_payload_queries_do_not_grow_with_rows(self):
        def count_queries():
            client = self.as_(self.store)
            with CaptureQueriesContext(connection) as ctx:
                response = client.get("/api/gate/inward-bills/", {"status": "ALL", "page_size": 100})
            self.assertEqual(response.status_code, 200)
            return len(ctx.captured_queries)
        baseline = count_queries()
        for _ in range(5):
            bill = self.make_doc(pages=3, category="SERVICE", vendor=self.vendor)
            self.make_doc(attached_to=bill, status="FILED", resolved_at=timezone.now())
        self.assertEqual(count_queries(), baseline)

    def test_batched_page_rows_match_shared_serializer(self):
        bill = bill_queryset(self.store).get(id=self.power.id)
        expected = serialize_pages("INWARD", bill.pages.all(), lambda page: f"/api/gate/inward-bills/{bill.id}/pages/{page.id}/")
        self.assertEqual(bill_payload(bill, self.store)["pages"], expected)

    def test_report_summary_and_csv_export(self):
        twin = self.make_doc(plant=self.other, category="SPARES", vendor=self.vendor, invoice_number="sp-1200", invoice_normalized="SP-1200", invoice_fy=invoice_fiscal_year(gate_today()), total_amount=Decimal("12000.00"))
        self.make_doc(arrival_at=timezone.now() - timedelta(days=9))
        params = {"date_from": str(gate_today() - timedelta(days=30)), "date_to": str(gate_today())}
        summary = self.as_(self.store).get("/api/gate/document-reports/summary/", params)
        self.assertEqual(summary.status_code, 200, summary.data)
        data = summary.data
        self.assertEqual(data["by_source"].get("OFFICE"), 1)
        spares = next(row for row in data["by_category"] if row["category"] == "SPARES")
        self.assertEqual(spares["total_amount"], "24000.00")
        self.assertEqual(spares["count"], 2)
        self.assertEqual(data["duplicates_flagged"], 2)
        ageing = {row["bucket"]: row["count"] for row in data["open_ageing"]}
        self.assertEqual(ageing["gt_7d"], 1)
        self.assertEqual(sum(ageing.values()), data["open_total"])
        self.assertEqual(data["top_vendors"][0]["name"], "Sample Power Co")
        plant_only = self.as_(self.store).get("/api/gate/document-reports/summary/", {**params, "plant": str(self.plant.id)}).data
        self.assertEqual(plant_only["documents"], 4)
        for user in (self.planner, self.sales, self.watchman):
            self.assertEqual(self.as_(user).get("/api/gate/document-reports/summary/", params).status_code, 403)
        filed = InwardBillIntake.objects.order_by("arrival_at").first()
        InwardBillIntake.objects.filter(id=filed.id).update(status="FILED", resolved_at=timezone.now(), resolution_reason="Filed for the export check")
        export = self.as_(self.store).get("/api/gate/document-reports/register.csv", {"status": "ALL"})
        self.assertEqual(export.status_code, 200)
        self.assertIn("attachment", export["Content-Disposition"])
        rows = list(csv.DictReader(io.StringIO(export.content.decode("utf-8-sig"))))
        self.assertEqual(len(rows), InwardBillIntake.objects.count())
        injected = next(row for row in rows if row["id"] == str(self.other_plant.id))
        self.assertTrue(injected["party"].startswith("'="))
        resolved = [row for row in rows if row["resolved_at"]]
        self.assertTrue(resolved)
        for row in resolved:
            self.assertEqual(row["resolved_at"][-6:], row["arrival_at"][-6:], "both timestamps use the factory time zone")
        filtered = self.as_(self.store).get("/api/gate/document-reports/register.csv/", {"status": "ALL", "category": "UTILITY"})
        self.assertEqual(len(list(csv.DictReader(io.StringIO(filtered.content.decode("utf-8-sig"))))), 1)
        self.assertEqual(self.as_(self.planner).get("/api/gate/document-reports/register.csv").status_code, 403)

    def test_form_options_and_pending_summary_for_document_accounts(self):
        options = self.as_(self.accounts).get("/api/gate/inward-bills/form-options/", {"q": "supplier"})
        self.assertEqual(options.status_code, 200, options.data)
        self.assertEqual([row["id"] for row in options.data["vendors"]], [str(self.vendor.id)])
        self.assertEqual({row["code"] for row in options.data["categories"]} >= {"UTILITY", "SPARES"}, True)
        self.assertNotIn("NON_STOCK", options.data["void_codes"])
        self.assertEqual(self.as_(self.planner).get("/api/gate/inward-bills/form-options/").status_code, 403)
        summary = self.as_(self.accounts).get("/api/users/notifications/inward-bill-summary/")
        self.assertEqual(summary.status_code, 200, summary.data)
        self.assertEqual(summary.data["needs_classifying"], 1)
        self.assertEqual(summary.data["waiting_receipt"], 3)
        self.assertEqual(summary.data["pending_count"], 4)
        self.assertEqual(self.as_(self.planner).get("/api/users/notifications/inward-bill-summary/").status_code, 403)

    def test_backfill_copies_legacy_review_data_once(self):
        legacy = self.make_doc(review_data={"vendor_id": str(self.vendor.id), "invoice_number": "legacy 77", "invoice_date": str(gate_today() - timedelta(days=1))})
        self.assertEqual(backfill_headers_from_review(), 1)
        legacy.refresh_from_db()
        self.assertEqual((legacy.vendor_id, legacy.invoice_normalized), (self.vendor.id, "LEGACY 77"))
        self.assertEqual(backfill_headers_from_review(), 0)


class ReminderTests(DocumentFixtureMixin, TestCase):
    def setUp(self):
        self.build_fixture()

    def test_due_and_valid_until_reminders_fire_once_per_threshold(self):
        today = gate_today()
        due = self.make_doc(party_name="Sample Power Co", invoice_number="UTL-0101", total_amount=Decimal("987654"), due_date=today + timedelta(days=2), status="FILED", resolved_at=timezone.now())
        licence = self.make_doc(vendor=self.vendor_two, invoice_number="SSC/91", valid_until=today + timedelta(days=25))
        far = self.make_doc(due_date=today + timedelta(days=20), valid_until=today + timedelta(days=400))
        voided = self.make_doc(due_date=today, status="VOID", resolved_at=timezone.now(), resolution_code="CANCELLED")
        managers = {user.id for user in User.objects.filter(is_active=True) if user.id in {self.owner.id, self.store.id, self.accounts.id, self.extra.id}}
        first = run_document_reminders(today)
        self.assertEqual(first["due_notifications"], len(managers))
        self.assertEqual(first["valid_until_notifications"], len(managers))
        self.assertEqual(set(Notification.objects.filter(event_key=DUE_EVENT).values_list("user_id", flat=True)), managers)
        self.assertFalse(Notification.objects.filter(user__in=[self.planner, self.watchman, self.uploader, self.sales]).exists())
        self.assertFalse(Notification.objects.filter(related_object_id__in=[far.id, voided.id]).exists())
        valid_priorities = {code for code, _ in Notification.PRIORITY_CHOICES}
        self.assertTrue(set(Notification.objects.values_list("priority", flat=True)) <= valid_priorities)
        notice = Notification.objects.filter(event_key=VALID_UNTIL_EVENT, user=self.store).get()
        self.assertEqual(notice.deep_link, f"/inventory/gate-bills/{licence.id}")
        self.assertIn("25 days", notice.title)
        again = run_document_reminders(today)
        self.assertEqual((again["due_notifications"], again["valid_until_notifications"]), (0, 0))
        later = run_document_reminders(today + timedelta(days=3))
        self.assertEqual(later["due_notifications"], len(managers))  # now overdue: next threshold
        self.assertEqual(later["valid_until_notifications"], 0)  # still inside the 30-day threshold
        self.assertEqual(run_document_reminders(today + timedelta(days=19))["valid_until_notifications"], len(managers))
        self.assertEqual(Notification.objects.filter(related_object_id=due.id, user=self.store).count(), 2)
        visible = self.as_(self.store).get("/api/users/notifications/list/", {"limit": 50})
        self.assertEqual(visible.status_code, 200)
        self.assertIn(str(licence.id), str(visible.data))


class ConcurrentClassifyTests(DocumentFixtureMixin, TransactionTestCase):
    def setUp(self):
        self.build_fixture()

    def test_two_editors_with_the_same_version_one_wins(self):
        if connection.vendor != "postgresql":
            self.skipTest("PostgreSQL concurrency acceptance")
        bill = self.make_doc()
        second = make_user("doc-store-two", "STORE")

        def save(args):
            user_id, number = args
            close_old_connections()
            try:
                client = APIClient()
                client.force_authenticate(User.objects.get(id=user_id))
                return client.post(f"/api/gate/inward-bills/{bill.id}/classify/", {"client_token": str(uuid.uuid4()), "header_version": 0, "invoice_number": number}, format="json").status_code
            finally:
                connections["default"].close()
        with ThreadPoolExecutor(max_workers=2) as pool:
            statuses = sorted(pool.map(save, [(self.store.id, "A-1"), (second.id, "B-2")]))
        self.assertEqual(statuses, [200, 409])
        bill.refresh_from_db()
        self.assertEqual(bill.header_version, 1)
        self.assertEqual(GateAuditEvent.objects.filter(object_id=bill.id, action="BILL_CLASSIFIED").count(), 1)
        self.assertFalse(InwardBillReceiptReference.objects.exists())
        self.assertEqual(Plant.objects.count(), 2)
