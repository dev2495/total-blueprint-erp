"""Outward gate photos, QR auto-link, office matching, QR prints."""
import io
import re
import uuid
from datetime import timedelta
from types import SimpleNamespace

from PIL import Image
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import DatabaseError, transaction
from django.test import TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.inventory.models import BulkTransaction, DeliveryChallan as InterPlantChallan, InventoryRoll
from apps.production.models import DeliveryChallan
from apps.sales.models import Customer, CustomerDispatch, SalesOrder
from apps.users.models import Notification, Role, User

from .models import GateAssignment, GateAuditEvent, GatePass, GatePassLine, OutwardDocument, OutwardDocumentLink, OutwardDocumentPage
from .qr import make_token, parse_token
from .services import gate_today
from .tests import fixture

PENDING = "documents.outward_pending"


def photo(color="#eeeeee", size=(420, 640), name="page.png"):
    buffer = io.BytesIO()
    Image.new("RGB", size, color).save(buffer, "PNG")
    return SimpleUploadedFile(name, buffer.getvalue(), content_type="image/png")


def make_role(code, defaults=None):
    role, _ = Role.objects.get_or_create(code=code, defaults={"name": code.title()})
    if defaults is not None:
        role.default_permissions = defaults
        role.save(update_fields=["default_permissions"])
    return role


def jwt(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


def token_in(payload):
    match = re.search(rb"TPP1\.[A-Z_]+\.[0-9a-f-]{36}\.[0-9a-f]{16}", payload)
    return match.group(0).decode() if match else None


class OutwardBase(TransactionTestCase):
    def setUp(self):
        self.owner, self.watchman, self.plant, self.other, _, self.vendor, _ = fixture()
        self.store = User.objects.create_user(username="out-store", role=make_role("STORE"))
        self.planner = User.objects.create_user(username="out-planner", role=make_role("PLANNER"))
        self.dispatcher = User.objects.create_user(username="out-dispatch", role=make_role("DISPATCH"))
        self.gate, self.office, self.boss = jwt(self.watchman), jwt(self.store), jwt(self.owner)
        self.dc = DeliveryChallan.objects.create(dc_no="DC-2627-0412", customer_name="Buyer One", plant=self.plant, status="DISPATCHED", vehicle_no="GJ15AB1234")
        self.other_dc = DeliveryChallan.objects.create(dc_no="DC-2627-0999", customer_name="Buyer Two", plant=self.other, status="DISPATCHED")

    def issued_pass(self, kind="RETURNABLE", plant=None):
        gate_pass = GatePass.objects.create(
            number=f"RGP-T-{uuid.uuid4().hex[:6]}" if kind == "RETURNABLE" else f"NRGP-T-{uuid.uuid4().hex[:6]}", kind=kind, plant=plant or self.plant,
            vendor=self.vendor, party_name=self.vendor.name, purpose="REPAIR" if kind == "RETURNABLE" else "SCRAP_SALE",
            expected_return_date=gate_today() + timedelta(days=5) if kind == "RETURNABLE" else None,
            status="ISSUED", issued_at=timezone.now(), issued_by=self.owner, created_by=self.owner,
        )
        GatePassLine.objects.create(gate_pass=gate_pass, line_no=1, description="Printing roller", quantity=2, uom="NOS")
        return gate_pass

    def capture(self, client=None, token=None, codes=(), images=None, plant=None, vehicle="gj 15-ab 1234"):
        data = {"client_token": str(token or uuid.uuid4()), "plant": str((plant or self.plant).id), "vehicle_number": vehicle, "images": images or [photo()]}
        if codes:
            data["scanned_codes"] = list(codes)
        return (client or self.gate).post("/api/gate/outward-documents/", data, format="multipart")

    def stock_counts(self):
        return InventoryRoll.objects.count(), BulkTransaction.objects.count()


class OutwardCaptureTests(OutwardBase):
    def test_multi_page_qr_capture_auto_links_marks_pass_out_and_replays_once(self):
        gate_pass = self.issued_pass()
        stock = self.stock_counts()
        token = uuid.uuid4()
        codes = [make_token("SALES_DC", self.dc.id), make_token("GATE_PASS", gate_pass.id)]
        before = timezone.now()
        first = self.capture(token=token, codes=codes, images=[photo(), photo("#dddddd")])
        self.assertEqual(first.status_code, 201, first.data)
        data = first.data
        self.assertEqual(data["status"], "MATCHED")
        self.assertEqual(data["page_count"], 2)
        self.assertEqual([page["page_number"] for page in data["pages"]], [1, 2])
        self.assertEqual(data["vehicle_number"], "GJ15AB1234")
        self.assertEqual({row["reference"] for row in data["links"]}, {"DC-2627-0412", gate_pass.number})
        for row in data["links"]:
            self.assertEqual(set(row), {"id", "kind", "kind_label", "reference", "party_name"}, "watchman sees reference + party only")
        self.assertNotIn("snapshot", str(data))
        document = OutwardDocument.objects.get()
        self.assertGreaterEqual(document.departed_at, before)
        self.assertEqual(document.links.filter(link_source="QR").count(), 2)
        gate_pass.refresh_from_db()
        self.assertEqual(gate_pass.status, "OUT")
        self.assertEqual(gate_pass.out_at, document.departed_at)
        self.dc.refresh_from_db()
        self.assertEqual(self.dc.status, "DISPATCHED", "matching never marks delivery")
        self.assertEqual(self.stock_counts(), stock, "gate records never move stock")
        self.assertFalse(Notification.objects.filter(event_key=PENDING).exists())
        replay = self.capture(token=token, codes=codes, images=[photo(), photo("#dddddd")])
        self.assertEqual(replay.status_code, 201)
        self.assertTrue(replay.data["replayed"])
        self.assertEqual(replay.data["id"], data["id"])
        self.assertEqual(OutwardDocument.objects.count(), 1)
        self.assertEqual(GateAuditEvent.objects.filter(object_type="OUTWARD", action="OUTWARD_RECORDED").count(), 1)
        changed = self.capture(token=token, codes=codes[:1], images=[photo()])
        self.assertEqual(changed.status_code, 409)
        self.assertEqual(OutwardDocument.objects.count(), 1)

    def test_invalid_and_cross_plant_codes_are_kept_without_blocking_and_notify_office(self):
        good = make_token("SALES_DC", self.dc.id)
        tampered = good[:-1] + ("0" if good[-1] != "0" else "1")
        response = self.capture(codes=["https://example.com/not-ours", tampered, make_token("SALES_DC", self.other_dc.id), good])
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["status"], "PENDING_MATCH")
        self.assertEqual(len(response.data["links"]), 1)
        refs = response.data["scanned_refs"]
        self.assertEqual([row["status"] for row in refs], ["INVALID", "INVALID", "INVALID", "LINKED"])
        self.assertIn("not an ERP document code", refs[0]["error"])
        self.assertIn("could not be verified", refs[1]["error"])
        self.assertIn("another factory", refs[2]["error"])
        self.assertNotIn("code", refs[0], "raw scanned text is office-only")
        notices = Notification.objects.filter(event_key=PENDING)
        self.assertEqual(set(notices.values_list("user_id", flat=True)), {self.owner.id, self.store.id})
        self.assertTrue(all(row.deep_link.startswith("/inventory/outward-documents/") for row in notices))
        office = self.office.get(f"/api/gate/outward-documents/{response.data['id']}/")
        self.assertEqual(office.status_code, 200)
        self.assertEqual(office.data["scanned_refs"][0]["code"], "https://example.com/not-ours")

    def test_draft_dc_link_needs_office_review(self):
        draft = DeliveryChallan.objects.create(dc_no="DC-DRAFT-1", customer_name="Buyer", plant=self.plant, status="DRAFT")
        response = self.capture(codes=[make_token("SALES_DC", draft.id)])
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["status"], "PENDING_MATCH")
        detail = self.office.get(f"/api/gate/outward-documents/{response.data['id']}/").data
        self.assertIn("draft", detail["links"][0]["snapshot"]["warnings"][0])

    def test_validation_and_plant_scope(self):
        self.assertEqual(self.capture(plant=self.other).status_code, 403)
        self.assertEqual(self.capture(images=[photo(size=(100, 100))]).status_code, 400)
        self.assertEqual(self.capture(images=[photo() for _ in range(7)]).status_code, 400)
        self.assertEqual(self.capture(vehicle="GJ-15 <script>").status_code, 400)
        self.assertEqual(self.capture(codes=[f"code-{index}" for index in range(11)]).status_code, 400)
        self.assertEqual(self.capture(client=self.office).status_code, 403, "office cannot invent a gate departure")
        self.assertFalse(OutwardDocument.objects.exists())
        self.assertEqual(self.capture(client=self.boss, plant=self.other).status_code, 201, "owner may record at any gate")

    def test_watchman_sees_only_own_records_of_today_and_no_office_endpoints(self):
        mine = self.capture().data
        colleague = User.objects.create_user(username="out-watch-2", role=self.watchman.role)
        GateAssignment.objects.create(user=colleague, plant=self.plant)
        theirs = self.capture(client=jwt(colleague)).data
        old = OutwardDocument.objects.create(plant=self.plant, created_by=self.watchman, departed_at=timezone.now() - timedelta(days=2), content_hash="x" * 64)
        listing = self.gate.get(f"/api/gate/outward-documents/?plant={self.plant.id}")
        self.assertEqual(listing.status_code, 200)
        self.assertEqual([row["id"] for row in listing.data["results"]], [mine["id"]])
        self.assertIn("GJ15AB1234", listing.data["recent_vehicles"])
        self.assertNotIn("counts", listing.data)
        self.assertEqual(self.gate.get(f"/api/gate/outward-documents/{theirs['id']}/").status_code, 404)
        self.assertEqual(self.gate.get(f"/api/gate/outward-documents/{old.id}/").status_code, 404)
        self.assertEqual(self.gate.get("/api/gate/outward-documents/?status=MATCHED").status_code, 403)
        self.assertEqual(self.gate.get(f"/api/gate/outward-documents/?plant={self.other.id}").status_code, 403)
        page = mine["pages"][0]
        self.assertEqual(self.gate.get(page["image_url"]).status_code, 200)
        self.assertEqual(self.gate.get(page["thumb_url"]).status_code, 200)
        for method, path in [
            ("get", f"/api/gate/outward-documents/{mine['id']}/candidates/"),
            ("post", f"/api/gate/outward-documents/{mine['id']}/link/"),
            ("post", f"/api/gate/outward-documents/{mine['id']}/resolve/"),
            ("post", f"/api/gate/outward-documents/{mine['id']}/void/"),
            ("get", "/api/gate/gate-passes/"),
            ("get", "/api/gate/gate-passes/open-lines/"),
            ("post", "/api/gate/document-pages/rotation/"),
        ]:
            self.assertEqual(getattr(self.gate, method)(path, {}, format="json").status_code, 403, (method, path))
        self.assertEqual(self.gate.get("/api/gate/qr/token/?kind=SALES_DC&id=" + str(self.dc.id)).status_code, 403)


class OutwardMatchingTests(OutwardBase):
    def act(self, client, document_id, action, **data):
        return client.post(f"/api/gate/outward-documents/{document_id}/{action}/", {"client_token": str(uuid.uuid4()), **data}, format="json")

    def test_link_resolve_unlink_discrepancy_and_multi_trip_warning(self):
        first = self.capture().data["id"]
        second = self.capture(images=[photo("#cccccc")]).data["id"]
        stock = self.stock_counts()
        search = self.office.get(f"/api/gate/outward-documents/{first}/candidates/?q=0412")
        self.assertEqual(search.status_code, 200)
        self.assertEqual([row["reference"] for row in search.data["results"]], ["DC-2627-0412"])
        nearby = self.office.get(f"/api/gate/outward-documents/{first}/candidates/").data["results"]
        self.assertIn(str(self.dc.id), {row["id"] for row in nearby})
        self.assertNotIn(str(self.other_dc.id), {row["id"] for row in nearby}, "other factory documents are never offered")
        self.assertEqual(self.act(self.office, first, "resolve").status_code, 400, "matched needs a link")
        linked = self.act(self.office, first, "link", kind="SALES_DC", object_id=str(self.dc.id))
        self.assertEqual(linked.status_code, 200, linked.data)
        self.assertEqual(linked.data["link_warnings"], [])
        self.assertEqual(self.act(self.office, first, "link", kind="SALES_DC", object_id=str(self.dc.id)).status_code, 409)
        self.assertEqual(self.act(self.office, first, "link", kind="SALES_DC", object_id=str(self.other_dc.id)).status_code, 400)
        resolved = self.act(self.office, first, "resolve", reason="Driver carried DC copy.")
        self.assertEqual(resolved.data["status"], "MATCHED")
        self.assertEqual(self.act(self.office, first, "resolve").status_code, 409)
        trip = self.act(self.office, second, "link", kind="SALES_DC", object_id=str(self.dc.id))
        self.assertEqual(trip.status_code, 200)
        self.assertEqual([row["document_id"] for row in trip.data["link_warnings"]], [first], "same DC on a second trip warns, never blocks")
        detail = self.office.get(f"/api/gate/outward-documents/{second}/").data
        self.assertEqual(detail["links"][0]["other_departures"][0]["document_id"], first)
        other = self.act(self.office, second, "link", kind="OTHER", reference="SRN-77", reason="Supplier return note")
        self.assertEqual(other.status_code, 200, other.data)
        self.assertEqual(self.act(self.office, second, "link", kind="OTHER", reference="").status_code, 400)
        link_id = OutwardDocumentLink.objects.get(document_id=first).id
        self.assertEqual(self.act(self.office, first, "unlink", link_id=str(link_id), reason="no").status_code, 400)
        unlinked = self.act(self.office, first, "unlink", link_id=str(link_id), reason="Wrong challan picked")
        self.assertEqual(unlinked.data["status"], "PENDING_MATCH")
        self.assertEqual(unlinked.data["removed_links"][0]["removed_reason"], "Wrong challan picked")
        self.assertEqual(self.act(self.office, first, "unlink", link_id=str(link_id), reason="Wrong challan picked again").status_code, 409)
        flagged = self.act(self.office, first, "discrepancy", notes="Two bags short against the DC")
        self.assertEqual(flagged.data["status"], "DISCREPANCY")
        self.assertEqual(flagged.data["discrepancies"][0]["notes"], "Two bags short against the DC")
        actions = list(GateAuditEvent.objects.filter(object_type="OUTWARD", object_id=first).order_by("created_at").values_list("action", flat=True))
        self.assertEqual(actions, ["OUTWARD_RECORDED", "OUTWARD_LINKED", "OUTWARD_MATCHED", "OUTWARD_UNLINKED", "OUTWARD_DISCREPANCY"])
        self.assertEqual(self.stock_counts(), stock)

    def test_queue_filters_counts_and_search(self):
        a = self.capture(codes=[make_token("SALES_DC", self.dc.id)]).data["id"]
        b = self.capture(vehicle="MH12XY9999").data["id"]
        queue = self.office.get("/api/gate/outward-documents/?status=PENDING_MATCH")
        self.assertEqual([row["id"] for row in queue.data["results"]], [b])
        self.assertEqual(queue.data["counts"]["PENDING_MATCH"], 1)
        self.assertEqual(queue.data["counts"]["MATCHED"], 1)
        self.assertEqual(queue.data["counts"]["ALL"], 2)
        self.assertEqual([row["id"] for row in self.office.get("/api/gate/outward-documents/?search=buyer one").data["results"]], [a])
        self.assertEqual([row["id"] for row in self.office.get("/api/gate/outward-documents/?search=mh12 xy").data["results"]], [b])
        self.assertEqual([row["id"] for row in self.office.get("/api/gate/outward-documents/?has_links=false").data["results"]], [b])
        today = gate_today().isoformat()
        self.assertEqual(self.office.get(f"/api/gate/outward-documents/?date_from={today}&date_to={today}").data["count"], 2)
        self.assertEqual(self.office.get(f"/api/gate/outward-documents/?plant={self.other.id}").data["count"], 0)
        self.assertEqual(self.office.get("/api/gate/outward-documents/?status=NOPE").status_code, 400)
        self.assertIn("snapshot", self.office.get(f"/api/gate/outward-documents/{a}/").data["links"][0])

    def test_void_is_owner_only_and_releases_gate_pass(self):
        gate_pass = self.issued_pass()
        document = self.capture(codes=[make_token("GATE_PASS", gate_pass.id)]).data["id"]
        gate_pass.refresh_from_db()
        self.assertEqual(gate_pass.status, "OUT")
        self.assertEqual(self.act(self.office, document, "void", reason="Duplicate photo").status_code, 403)
        voided = self.act(self.boss, document, "void", reason="Duplicate photo of the same truck")
        self.assertEqual(voided.status_code, 200, voided.data)
        self.assertEqual(voided.data["status"], "VOID")
        self.assertEqual(voided.data["links"], [])
        self.assertTrue(voided.data["voided_by_name"])
        gate_pass.refresh_from_db()
        self.assertEqual(gate_pass.status, "ISSUED")
        self.assertIsNone(gate_pass.out_at)
        self.assertEqual(self.act(self.office, document, "link", kind="SALES_DC", object_id=str(self.dc.id)).status_code, 409)

    def test_departure_evidence_and_links_are_immutable_in_the_database(self):
        document = OutwardDocument.objects.get(id=self.capture(codes=[make_token("SALES_DC", self.dc.id)]).data["id"])
        for statement in [
            lambda: OutwardDocument.objects.filter(id=document.id).update(departed_at=timezone.now() - timedelta(hours=3)),
            lambda: OutwardDocument.objects.filter(id=document.id).update(plant=self.other),
            lambda: OutwardDocument.objects.filter(id=document.id).delete(),
            lambda: OutwardDocumentLink.objects.filter(document=document).update(reference="CHANGED"),
            lambda: OutwardDocumentLink.objects.filter(document=document).delete(),
        ]:
            with self.assertRaises(DatabaseError):
                with transaction.atomic():
                    statement()
        with self.assertRaises(TypeError):
            OutwardDocumentPage.objects.filter(document=document).update(page_number=9)
        OutwardDocument.objects.filter(id=document.id).update(notes="Office note")  # non-evidence fields stay editable
        link = OutwardDocumentLink.objects.get(document=document)
        link.removed_at, link.removed_by, link.removed_reason = timezone.now(), self.store, "Mistake"
        link.save(update_fields=["removed_at", "removed_by", "removed_reason"])
        with self.assertRaises(DatabaseError):
            with transaction.atomic():
                OutwardDocumentLink.objects.filter(id=link.id).update(removed_reason="Rewritten")


class OutwardPermissionTests(OutwardBase):
    def test_permission_matrix(self):
        self.capture()
        granted_role = User.objects.create_user(username="out-role", role=make_role("ACCOUNTS", ["outward.reconcile"]))
        granted_user = User.objects.create_user(username="out-extra", role=make_role("PLANNER"), extra_permissions=["outward.reconcile"])
        wildcard = User.objects.create_user(username="out-star", role=make_role("PLANNER"), extra_permissions=["*"])
        for user, expected in [(self.store, 200), (self.owner, 200), (granted_role, 200), (granted_user, 200), (self.planner, 403), (self.dispatcher, 403), (wildcard, 403)]:
            response = jwt(user).get("/api/gate/outward-documents/?status=ALL")
            self.assertEqual(response.status_code, expected, user.username)
        document = OutwardDocument.objects.get()
        self.assertEqual(jwt(self.planner).get(f"/api/gate/outward-documents/{document.id}/").status_code, 403)
        self.assertEqual(jwt(granted_user).post(f"/api/gate/outward-documents/{document.id}/link/", {"client_token": str(uuid.uuid4()), "kind": "SALES_DC", "object_id": str(self.dc.id)}, format="json").status_code, 200)

    @override_settings(STRICT_RBAC=True)
    def test_strict_rbac_keeps_the_same_matrix(self):
        self.assertEqual(self.office.get("/api/gate/outward-documents/").status_code, 200)
        self.assertEqual(jwt(self.planner).get("/api/gate/outward-documents/").status_code, 403)
        self.assertEqual(self.capture().status_code, 201)

    @override_settings(STRICT_RBAC=True)
    def test_outward_right_alone_opens_outward_pages_only(self):
        from apps.users.permission_service import PermissionService

        from .models import InwardBillIntake, InwardBillPage

        matcher = User.objects.create_user(username="out-only", role=make_role("PLANNER"), extra_permissions=["outward.reconcile"])
        self.assertTrue(PermissionService.has_document_permission(matcher, "outward.reconcile"))
        self.assertFalse(PermissionService.has_document_permission(matcher, "documents.view"), "matching outward photos does not open the bill register")
        perms = set(PermissionService.get_user_permissions(matcher))
        self.assertIn("page.inventory.outward_documents.view", perms)
        self.assertFalse({"page.inventory.gate_bills.view", "page.inventory.general_receipts.view", "page.inventory.gate_passes.view"} & perms)
        client = jwt(matcher)
        listing = client.get("/api/gate/outward-documents/")
        self.assertEqual(listing.status_code, 200)
        self.assertTrue({str(self.plant.id), str(self.other.id)} <= {row["id"] for row in listing.data["plants"]}, "factory filter options come with the list")
        for path in ["/api/gate/inward-bills/?status=OPEN", "/api/gate/gate-passes/", "/api/procurement/general-receipts/"]:
            self.assertEqual(client.get(path).status_code, 403, path)
        self.assertEqual(self.capture().status_code, 201)
        outward_page = OutwardDocumentPage.objects.first()
        rotate = client.post("/api/gate/document-pages/rotation/", {"client_token": str(uuid.uuid4()), "page_kind": "OUTWARD", "page_id": str(outward_page.id), "rotation": 90}, format="json")
        self.assertEqual(rotate.status_code, 200, rotate.content)
        bill = InwardBillIntake.objects.create(plant=self.plant, created_by=self.watchman, content_hash="z" * 64)
        inward_page = InwardBillPage.objects.create(intake=bill, page_number=1, data=b"jpeg", width=10, height=10, byte_size=4, sha256="y" * 64)
        refused = client.post("/api/gate/document-pages/rotation/", {"client_token": str(uuid.uuid4()), "page_kind": "INWARD", "page_id": str(inward_page.id), "rotation": 90}, format="json")
        self.assertEqual(refused.status_code, 403, refused.content)
        self.assertEqual(jwt(self.planner).post("/api/gate/document-pages/rotation/", {"client_token": str(uuid.uuid4()), "page_kind": "OUTWARD", "page_id": str(outward_page.id), "rotation": 180}, format="json").status_code, 403)

    def test_qr_resolve_chip_scope(self):
        code = make_token("SALES_DC", self.dc.id)
        chip = self.gate.get("/api/gate/qr/resolve/", {"code": code, "plant": str(self.plant.id)})
        self.assertEqual(chip.status_code, 200, chip.data)
        self.assertEqual(chip.data["reference"], "DC-2627-0412")
        self.assertEqual(chip.data["party_name"], "Buyer One")
        self.assertNotIn("snapshot", chip.data)
        self.assertEqual(self.gate.get("/api/gate/qr/resolve/", {"code": code, "plant": str(self.other.id)}).status_code, 403)
        self.assertEqual(self.gate.get("/api/gate/qr/resolve/", {"code": "hello", "plant": str(self.plant.id)}).status_code, 400)
        office = self.office.get("/api/gate/qr/resolve/", {"code": code, "plant": str(self.plant.id)})
        self.assertIn("snapshot", office.data)
        self.assertEqual(self.office.get("/api/gate/qr/resolve/", {"code": code, "plant": str(self.other.id)}).status_code, 400, "plant mismatch")
        self.assertEqual(jwt(self.planner).get("/api/gate/qr/resolve/", {"code": code, "plant": str(self.plant.id)}).status_code, 403)

    def test_qr_token_for_html_prints(self):
        response = self.office.get("/api/gate/qr/token/", {"kind": "INTERPLANT_DC", "id": str(uuid.uuid4())})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(parse_token(response.data["token"])[0], "INTERPLANT_DC")
        self.assertTrue(response.data["svg"].startswith("<svg"))
        self.assertEqual(self.office.get("/api/gate/qr/token/", {"kind": "NOPE", "id": str(uuid.uuid4())}).status_code, 400)
        self.assertEqual(self.boss.get("/api/gate/qr/token/", {"kind": "SALES_DC", "id": str(self.dc.id)}).status_code, 200)


class OutwardResolverTests(OutwardBase):
    def test_customer_dispatch_trade_and_interplant_resolvers(self):
        customer = Customer.objects.create(code="OUT-C1", name="Dispatch Buyer")
        order = SalesOrder.objects.create(order_number="OUT-SO", customer=customer, customer_name=customer.name)
        dispatch = CustomerDispatch.objects.create(code="OUT-CD", sales_order=order, customer=customer, plant=self.plant, invoice_no="INV-9", status="CONFIRMED")
        cancelled = CustomerDispatch.objects.create(code="OUT-CD2", sales_order=order, customer=customer, plant=self.plant, status="CANCELLED")
        challan = InterPlantChallan.objects.create(from_plant=self.plant, to_plant=self.other, dc_no="IP-2627-0007", status="APPROVED")
        response = self.capture(codes=[make_token("CUSTOMER_DISPATCH", dispatch.id), make_token("INTERPLANT_DC", challan.id), make_token("CUSTOMER_DISPATCH", cancelled.id)])
        refs = response.data["scanned_refs"]
        self.assertEqual([row["status"] for row in refs], ["LINKED", "LINKED", "INVALID"])
        self.assertEqual(refs[1]["reference"], "IP-2627-0007")
        self.assertIn("cancelled", refs[2]["error"])
        detail = self.office.get(f"/api/gate/outward-documents/{response.data['id']}/").data
        self.assertEqual(detail["links"][1]["party_name"], f"To {self.other.name}")
        self.assertNotIn("rate", str(detail["links"]), "snapshots never carry prices")


class QRPrintTests(OutwardBase):
    def test_dispatch_slip_pdf_and_html_carry_a_verified_gate_qr(self):
        from apps.production.services.dispatch_pdf import DispatchListPDFService, canvas
        from apps.production.tests.test_dispatch_pdf_output import _ready_row, _snapshot_challan

        challan = _snapshot_challan([_ready_row(1), _ready_row(2)])
        challan.id = self.dc.id
        html = DispatchListPDFService.render_html(challan)
        self.assertIn('class="gate-qr"', html)
        self.assertIn("<svg", html)
        self.assertNotIn("<?xml", html)
        if canvas is None:
            self.skipTest("reportlab not installed")
        pdf = DispatchListPDFService.render(challan).getvalue()
        self.assertIn(b"/Subtype /Image", pdf)
        self.assertEqual(parse_token(token_in(pdf)), ("SALES_DC", self.dc.id))
        preview = SimpleNamespace(**{**challan.__dict__, "id": "dc-preview"})
        self.assertNotIn(b"/Subtype /Image", DispatchListPDFService.render(preview).getvalue(), "no QR without a saved challan id")
        escp = DispatchListPDFService.render_escp(challan).getvalue()
        self.assertNotIn(b"TPP1.", escp, "the Epson raw job is unchanged")

    def test_interplant_pdf_carries_a_verified_gate_qr(self):
        from apps.inventory.services.challan_pdf import ChallanPDFService

        challan = InterPlantChallan.objects.create(from_plant=self.plant, to_plant=self.other, dc_no="IP-2627-0008", status="APPROVED")
        pdf = ChallanPDFService.generate_pdf_bytes(challan)
        self.assertTrue(pdf.startswith(b"%PDF"))
        self.assertIn(b"/Subtype /Image", pdf)
        self.assertEqual(parse_token(token_in(pdf)), ("INTERPLANT_DC", challan.id))
