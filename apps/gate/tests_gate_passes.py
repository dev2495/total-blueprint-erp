"""Gate passes (RGP / NRGP): lifecycle, returns, picker contract, reminders, print, permissions."""
import re
import uuid
from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from django.test import TransactionTestCase
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.factory.models import Machine, PlantLegalProfile, WorkCenter
from apps.inventory.models import BulkTransaction, InventoryRoll
from apps.users.models import Notification, Role, User

from .gate_pass_services import overdue_threshold, record_gate_pass_return, run_gate_pass_overdue_reminders
from .models import GateAuditEvent, GatePass, GatePassLine, GatePassReturn
from .qr import make_token, parse_token
from .services import gate_today
from .tests import fixture
from .tests_outward import photo

OVERDUE = "documents.gate_pass_overdue"


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


class GatePassBase(TransactionTestCase):
    def setUp(self):
        self.owner, self.watchman, self.plant, self.other, _, self.vendor, _ = fixture()
        self.vendor.gst_no = "24ABCDE1234F1Z5"
        self.vendor.address = "Plot 7, GIDC Vapi"
        self.vendor.save(update_fields=["gst_no", "address"])
        self.store = User.objects.create_user(username="gp-store", role=make_role("STORE"))
        self.planner = User.objects.create_user(username="gp-planner", role=make_role("PLANNER"))
        self.office, self.boss, self.gate = jwt(self.store), jwt(self.owner), jwt(self.watchman)
        center = WorkCenter.objects.create(plant=self.plant, name="Printing", code="GP-WC1")
        other_center = WorkCenter.objects.create(plant=self.other, name="Printing B", code="GP-WC2")
        self.machine = Machine.objects.create(work_center=center, name="Rotogravure 1", code="RG1", status="DOWN")
        self.other_machine = Machine.objects.create(work_center=other_center, name="Rotogravure 9", code="RG9")
        PlantLegalProfile.objects.create(plant=self.plant, legal_name="Total Poly Print Pvt Ltd", gstin="24AAACT1234A1Z5", address="Survey 375/14, Kachigam, Daman")

    def payload(self, **changes):
        data = {
            "client_token": str(uuid.uuid4()), "kind": "RETURNABLE", "plant": str(self.plant.id), "vendor": str(self.vendor.id),
            "purpose": "REPAIR", "expected_return_date": str(gate_today() + timedelta(days=7)), "carried_by": "Ramesh", "vehicle_number": "dd 03 u 9802",
            "lines": [
                {"description": "Printing roller (patta milling)", "quantity": "2", "uom": "NOS", "machine": str(self.machine.id), "serial_no": "R-77", "approx_value": "18000"},
                {"description": "Weighing scale", "quantity": "1", "uom": "NOS", "equipment_text": "Dispatch scale 300 kg"},
            ],
        }
        data.update(changes)
        return data

    def create(self, client=None, **changes):
        return (client or self.office).post("/api/gate/gate-passes/", self.payload(**changes), format="json")

    def act(self, gate_pass_id, action, client=None, **data):
        return (client or self.office).post(f"/api/gate/gate-passes/{gate_pass_id}/{action}/", {"client_token": str(uuid.uuid4()), **data}, format="json")

    def issued(self, **changes):
        draft = self.create(**changes)
        self.assertEqual(draft.status_code, 201, draft.data)
        issued = self.act(draft.data["id"], "issue", version=draft.data["version"])
        self.assertEqual(issued.status_code, 200, issued.data)
        return issued.data

    def leave_gate(self, gate_pass_id):
        response = self.gate.post("/api/gate/outward-documents/", {"client_token": str(uuid.uuid4()), "plant": str(self.plant.id), "images": [photo()], "scanned_codes": [make_token("GATE_PASS", gate_pass_id)]}, format="multipart")
        self.assertEqual(response.status_code, 201, response.data)
        return response.data


class GatePassLifecycleTests(GatePassBase):
    def test_rgp_draft_issue_out_partial_return_full_return(self):
        stock = (InventoryRoll.objects.count(), BulkTransaction.objects.count())
        draft = self.create()
        self.assertEqual(draft.status_code, 201, draft.data)
        data = draft.data
        self.assertEqual(data["status"], "DRAFT")
        self.assertIsNone(data["number"])
        self.assertTrue(data["display_number"].startswith("Draft "))
        self.assertEqual(data["party_name"], self.vendor.name)
        self.assertEqual(data["party_gstin"], "24ABCDE1234F1Z5")
        self.assertEqual(data["vehicle_number"], "DD03U9802")
        self.assertEqual(data["lines"][0]["machine_name"], "Rotogravure 1 (RG1)", "a machine that is down for repair is still a valid machine")
        self.assertEqual(set(data["actions"]), {"edit", "issue", "cancel"})
        edited = self.office.patch(f"/api/gate/gate-passes/{data['id']}/", self.payload(version=data["version"], notes="Urgent", lines=[{"description": "Printing roller", "quantity": "3", "uom": "NOS"}]), format="json")
        self.assertEqual(edited.status_code, 200, edited.data)
        self.assertEqual(edited.data["line_count"], 1)
        self.assertEqual(edited.data["notes"], "Urgent")
        stale = self.office.patch(f"/api/gate/gate-passes/{data['id']}/", self.payload(version=data["version"]), format="json")
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(self.act(data["id"], "issue", version=data["version"]).status_code, 409, "issue checks the version too")
        issued = self.act(data["id"], "issue", version=edited.data["version"])
        self.assertEqual(issued.status_code, 200, issued.data)
        self.assertRegex(issued.data["number"], r"^RGP-\d{4}-\d{4}$")
        self.assertEqual(issued.data["status"], "ISSUED")
        self.assertEqual(self.office.patch(f"/api/gate/gate-passes/{data['id']}/", self.payload(version=issued.data["version"]), format="json").status_code, 409)
        self.leave_gate(data["id"])
        gate_pass = GatePass.objects.get(id=data["id"])
        self.assertEqual(gate_pass.status, "OUT")
        line = gate_pass.lines.get()
        partial = self.act(data["id"], "receive-back", lines=[{"line_id": str(line.id), "quantity": "1"}], reason="One roller back after milling")
        self.assertEqual(partial.status_code, 200, partial.data)
        self.assertEqual(partial.data["status"], "PARTLY_RETURNED")
        self.assertEqual(partial.data["lines"][0]["outstanding_quantity"], "2")
        over = self.act(data["id"], "receive-back", lines=[{"line_id": str(line.id), "quantity": "3"}], reason="Too many rollers")
        self.assertEqual(over.status_code, 400)
        self.assertEqual(GatePassReturn.objects.count(), 1)
        full = self.act(data["id"], "receive-back", lines=[{"line_id": str(line.id), "quantity": "2"}], reason="Remaining rollers back")
        self.assertEqual(full.data["status"], "RETURNED")
        self.assertIsNotNone(full.data["closed_at"])
        self.assertEqual(len(full.data["returns"]), 2)
        self.assertEqual(full.data["outward_documents"][0]["link_source"], "QR")
        self.assertEqual(self.act(data["id"], "receive-back", lines=[{"line_id": str(line.id), "quantity": "1"}], reason="Nothing left").status_code, 409)
        actions = list(GateAuditEvent.objects.filter(object_type="GATE_PASS", object_id=data["id"]).order_by("created_at").values_list("action", flat=True))
        self.assertEqual(actions, ["GATE_PASS_DRAFTED", "GATE_PASS_EDITED", "GATE_PASS_ISSUED", "GATE_PASS_OUT", "GATE_PASS_RETURNED", "GATE_PASS_RETURNED"])
        self.assertEqual((InventoryRoll.objects.count(), BulkTransaction.objects.count()), stock, "gate passes never move stock")

    def test_nrgp_closes_when_it_leaves_and_manual_link_works(self):
        data = self.issued(kind="NON_RETURNABLE", purpose="SCRAP_SALE", expected_return_date=None)
        self.assertRegex(data["number"], r"^NRGP-\d{4}-\d{4}$")
        departure = self.gate.post("/api/gate/outward-documents/", {"client_token": str(uuid.uuid4()), "plant": str(self.plant.id), "images": [photo()]}, format="multipart").data
        linked = self.office.post(f"/api/gate/outward-documents/{departure['id']}/link/", {"client_token": str(uuid.uuid4()), "kind": "GATE_PASS", "object_id": data["id"]}, format="json")
        self.assertEqual(linked.status_code, 200, linked.data)
        gate_pass = GatePass.objects.get(id=data["id"])
        self.assertEqual(gate_pass.status, "CLOSED")
        self.assertEqual(gate_pass.out_at, gate_pass.closed_at)
        self.assertEqual(self.act(data["id"], "receive-back", lines=[{"line_id": str(gate_pass.lines.first().id), "quantity": "1"}], reason="Not returnable").status_code, 400)
        self.assertEqual(self.act(data["id"], "short-close", reason="Not applicable here").status_code, 409)
        link = self.office.get(f"/api/gate/outward-documents/{departure['id']}/").data["links"][0]
        removed = self.office.post(f"/api/gate/outward-documents/{departure['id']}/unlink/", {"client_token": str(uuid.uuid4()), "link_id": link["id"], "reason": "Wrong pass matched"}, format="json")
        self.assertEqual(removed.status_code, 200)
        gate_pass.refresh_from_db()
        self.assertEqual(gate_pass.status, "ISSUED", "removing the only departure re-opens the pass")

    def test_cancel_and_short_close_rules(self):
        draft = self.create().data
        self.assertEqual(self.act(draft["id"], "cancel", reason="no").status_code, 400)
        cancelled = self.act(draft["id"], "cancel", reason="Raised by mistake")
        self.assertEqual(cancelled.data["status"], "CANCELLED")
        self.assertEqual(self.act(draft["id"], "issue").status_code, 409)
        issued = self.issued()
        self.assertEqual(self.act(issued["id"], "short-close", reason="Vendor scrapped it").status_code, 409, "not out yet")
        self.leave_gate(issued["id"])
        self.assertEqual(self.act(issued["id"], "cancel", reason="Too late to cancel").status_code, 409)
        closed = self.act(issued["id"], "short-close", reason="Vendor scrapped the roller")
        self.assertEqual(closed.status_code, 200)
        self.assertEqual(closed.data["status"], "SHORT_CLOSED")
        self.assertEqual(closed.data["close_reason"], "Vendor scrapped the roller")
        cancelled_scan = self.gate.get("/api/gate/qr/resolve/", {"code": make_token("GATE_PASS", draft["id"]), "plant": str(self.plant.id)})
        self.assertEqual(cancelled_scan.status_code, 400)
        self.assertIn("cancelled", str(cancelled_scan.data))

    def test_validation(self):
        today = gate_today()
        cases = [
            {"expected_return_date": None},
            {"expected_return_date": str(today - timedelta(days=1))},
            {"purpose": "SCRAP_SALE"},
            {"vendor": None, "party_name": ""},
            {"party_gstin": "BAD-GST"},
            {"lines": []},
            {"lines": [{"description": "Roller", "quantity": "0", "uom": "NOS"}]},
            {"lines": [{"description": "Roller", "quantity": "1", "uom": "BAGS"}]},
            {"lines": [{"description": "Roller", "quantity": "1", "uom": "NOS", "machine": str(self.other_machine.id)}]},
            {"plant": str(uuid.uuid4())},
        ]
        for changes in cases:
            self.assertEqual(self.create(**changes).status_code, 400, changes)
        self.assertFalse(GatePass.objects.exists())
        free_text = self.create(vendor=None, party_name="Shree Fabricators", party_gstin="")
        self.assertEqual(free_text.status_code, 201, free_text.data)
        nrgp = self.create(kind="NON_RETURNABLE", purpose="SAMPLE", expected_return_date=str(today - timedelta(days=3)))
        self.assertEqual(nrgp.status_code, 201, nrgp.data)
        self.assertIsNone(nrgp.data["expected_return_date"], "a non-returnable pass has no return date")
        self.vendor.gst_no = "N/A"
        self.vendor.save(update_fields=["gst_no"])
        messy_master = self.create(party_gstin="")
        self.assertEqual(messy_master.status_code, 201, messy_master.data)
        self.assertEqual(messy_master.data["party_gstin"], "", "a malformed vendor-master GSTIN is never copied onto the pass")

    def test_idempotent_create_and_draft_scan_refused(self):
        payload = self.payload()
        first = self.office.post("/api/gate/gate-passes/", payload, format="json")
        replay = self.office.post("/api/gate/gate-passes/", payload, format="json")
        self.assertEqual(replay.data["id"], first.data["id"])
        self.assertTrue(replay.data["replayed"])
        changed = self.office.post("/api/gate/gate-passes/", {**payload, "notes": "different"}, format="json")
        self.assertEqual(changed.status_code, 409)
        self.assertEqual(GatePass.objects.count(), 1)
        scan = self.leave_gate(first.data["id"])
        self.assertEqual(scan["status"], "PENDING_MATCH")
        self.assertIn("draft", scan["scanned_refs"][0]["error"])
        self.assertEqual(GatePass.objects.get().status, "DRAFT")

    def test_record_return_requires_the_receipt_transaction(self):
        data = self.issued()
        self.leave_gate(data["id"])
        line = GatePassLine.objects.filter(gate_pass_id=data["id"]).first()
        with self.assertRaises(RuntimeError):
            record_gate_pass_return(self.store, line_id=line.id, quantity=1)
        with transaction.atomic():
            record_gate_pass_return(self.store, line_id=line.id, quantity=Decimal("1"), general_receipt_line_id=uuid.uuid4(), notes="GR-2627-000001")
        self.assertEqual(GatePass.objects.get(id=data["id"]).status, "PARTLY_RETURNED")


class GatePassQueryTests(GatePassBase):
    def test_open_lines_contract_and_filters(self):
        out = self.issued()
        self.leave_gate(out["id"])
        self.issued(vendor=None, party_name="Prime Systems", lines=[{"description": "Load cell", "quantity": "1", "uom": "NOS"}])
        lines = self.office.get("/api/gate/gate-passes/open-lines/", {"vendor": str(self.vendor.id), "plant": str(self.plant.id)})
        self.assertEqual(lines.status_code, 200)
        self.assertEqual(len(lines.data), 2, "only passes that are out, with outstanding quantity")
        required = {"line_id", "gate_pass_id", "gate_pass_number", "line_no", "description", "uom", "outstanding_quantity", "machine_name", "expected_return_date"}
        self.assertTrue(required <= set(lines.data[0]))
        self.assertEqual(lines.data[0]["gate_pass_number"], out["number"])
        self.assertEqual(lines.data[0]["machine_name"], "Rotogravure 1 (RG1)")
        self.assertEqual(lines.data[0]["outstanding_quantity"], "2")
        self.assertEqual(self.office.get("/api/gate/gate-passes/open-lines/", {"party": "prime"}).data, [], "issued but not out yet")
        self.assertEqual(self.office.get("/api/gate/gate-passes/open-lines/", {"plant": str(self.other.id)}).data, [])
        with transaction.atomic():
            record_gate_pass_return(self.store, line_id=lines.data[1]["line_id"], quantity=1)
        self.assertEqual(len(self.office.get("/api/gate/gate-passes/open-lines/").data), 1)

    def test_list_tabs_counts_filters_and_detail(self):
        draft = self.create().data
        out = self.issued()
        self.leave_gate(out["id"])
        late = self.issued()
        self.leave_gate(late["id"])
        GatePass.objects.filter(id=late["id"]).update(expected_return_date=gate_today() - timedelta(days=2))
        listing = self.office.get("/api/gate/gate-passes/", {"status": "OPEN"})
        self.assertEqual(listing.data["counts"], {"OPEN": 2, "OVERDUE": 1, "DONE": 0, "DRAFT": 1, "ALL": 3})
        self.assertEqual(listing.data["results"][0]["id"], late["id"], "earliest due first")
        overdue = self.office.get("/api/gate/gate-passes/", {"status": "OVERDUE"}).data["results"]
        self.assertEqual([row["id"] for row in overdue], [late["id"]])
        self.assertEqual(overdue[0]["days_overdue"], 2)
        self.assertEqual(self.office.get("/api/gate/gate-passes/", {"status": "DRAFT"}).data["results"][0]["id"], draft["id"])
        self.assertEqual(self.office.get("/api/gate/gate-passes/", {"machine": str(self.machine.id)}).data["count"], 3)
        self.assertEqual(self.office.get("/api/gate/gate-passes/", {"search": "weighing"}).data["count"], 3)
        self.assertEqual(self.office.get("/api/gate/gate-passes/", {"search": out["number"]}).data["count"], 1)
        self.assertEqual(self.office.get("/api/gate/gate-passes/", {"kind": "NON_RETURNABLE"}).data["count"], 0)
        self.assertEqual(self.office.get("/api/gate/gate-passes/", {"status": "BAD"}).status_code, 400)
        detail = self.office.get(f"/api/gate/gate-passes/{out['id']}/").data
        self.assertEqual(detail["outward_documents"][0]["active"], True)
        self.assertTrue(detail["outward_documents"][0]["thumb_url"])
        self.assertEqual([row["action"] for row in detail["timeline"]], ["GATE_PASS_DRAFTED", "GATE_PASS_ISSUED", "GATE_PASS_OUT"])
        options = self.office.get("/api/gate/gate-passes/form-options/", {"plant": str(self.plant.id)}).data
        self.assertEqual([row["id"] for row in options["machines"]], [str(self.machine.id)])
        self.assertIn("NOS", options["uoms"])

    def test_overdue_reminders_once_per_step(self):
        self.assertEqual([overdue_threshold(days) for days in [0, 2, 3, 6, 7, 13, 14, 20, 21]], [0, 0, 3, 3, 7, 7, 14, 14, 21])
        data = self.issued()
        self.leave_gate(data["id"])
        self.issued()  # issued, never left: no reminder
        due = gate_today() + timedelta(days=7)
        GatePass.objects.filter(id=data["id"]).update(expected_return_date=due)
        self.assertEqual(run_gate_pass_overdue_reminders(today=due - timedelta(days=1))["notifications"], 0)
        first = run_gate_pass_overdue_reminders(today=due)
        self.assertEqual(first["notifications"], 2, "store + owner")
        notices = Notification.objects.filter(event_key=OVERDUE)
        self.assertEqual(set(notices.values_list("user_id", flat=True)), {self.store.id, self.owner.id})
        self.assertIn("due back today", notices.first().title)
        self.assertEqual(run_gate_pass_overdue_reminders(today=due)["notifications"], 0, "same day again: nothing new")
        self.assertEqual(run_gate_pass_overdue_reminders(today=due + timedelta(days=2))["notifications"], 0)
        self.assertEqual(run_gate_pass_overdue_reminders(today=due + timedelta(days=3))["notifications"], 2)
        self.assertEqual(run_gate_pass_overdue_reminders(today=due + timedelta(days=5))["notifications"], 0)
        self.assertEqual(run_gate_pass_overdue_reminders(today=due + timedelta(days=7))["notifications"], 2)
        self.assertEqual(run_gate_pass_overdue_reminders(today=due + timedelta(days=14))["notifications"], 2)
        self.assertEqual(notices.count(), 8)
        self.assertFalse(Notification.objects.filter(event_key=OVERDUE, user=self.planner).exists())


class GatePassPrintAndPermissionTests(GatePassBase):
    def test_print_pdf_carries_a_verified_qr_only_when_issued(self):
        draft = self.create().data
        draft_pdf = self.office.get(f"/api/gate/gate-passes/{draft['id']}/print.pdf")
        self.assertEqual(draft_pdf.status_code, 200)
        self.assertEqual(draft_pdf["Content-Type"], "application/pdf")
        self.assertNotIn(b"/Subtype /Image", draft_pdf.content, "drafts can never be matched at the gate")
        issued = self.act(draft["id"], "issue", version=draft["version"]).data
        pdf = self.office.get(f"/api/gate/gate-passes/{draft['id']}/print.pdf")
        self.assertTrue(pdf.content.startswith(b"%PDF"))
        self.assertIn(b"/Subtype /Image", pdf.content)
        token = re.search(rb"TPP1\.[A-Z_]+\.[0-9a-f-]{36}\.[0-9a-f]{16}", pdf.content).group(0).decode()
        self.assertEqual(parse_token(token), ("GATE_PASS", uuid.UUID(draft["id"])))
        self.assertIn(issued["number"].encode(), pdf.content)
        self.assertEqual(pdf["Cache-Control"], "private, no-store")
        many = self.issued(lines=[{"description": f"Spare part {index}", "quantity": "1", "uom": "NOS", "remarks": "check on return " * 4} for index in range(30)])
        long_pdf = self.office.get(f"/api/gate/gate-passes/{many['id']}/print.pdf").content
        self.assertGreater(long_pdf.count(b"/Type /Page") - long_pdf.count(b"/Type /Pages"), 1)

    def test_permission_matrix(self):
        granted_role = User.objects.create_user(username="gp-role", role=make_role("ACCOUNTS", ["gatepass.manage"]))
        viewer = User.objects.create_user(username="gp-viewer", role=make_role("PLANNER"), extra_permissions=["documents.view"])
        dispatcher = User.objects.create_user(username="gp-dispatch", role=make_role("DISPATCH"))
        for user, expected in [(self.store, 201), (self.owner, 201), (granted_role, 201), (viewer, 403), (self.planner, 403), (dispatcher, 403)]:
            self.assertEqual(self.create(client=jwt(user)).status_code, expected, user.username)
        self.assertEqual(jwt(viewer).get("/api/gate/gate-passes/").status_code, 200)
        self.assertEqual(jwt(self.planner).get("/api/gate/gate-passes/").status_code, 403)
        self.assertEqual(jwt(dispatcher).get("/api/gate/gate-passes/open-lines/").status_code, 403)
        some = GatePass.objects.first()
        self.assertEqual(jwt(viewer).get(f"/api/gate/gate-passes/{some.id}/print.pdf").status_code, 200)
        self.assertEqual(jwt(viewer).get(f"/api/gate/gate-passes/{some.id}/").data["actions"], [])
        self.assertEqual(self.act(some.id, "issue", client=jwt(viewer)).status_code, 403)
        self.assertEqual(self.gate.get("/api/gate/gate-passes/").status_code, 403)
        self.assertEqual(self.gate.get(f"/api/gate/gate-passes/{some.id}/print.pdf").status_code, 403)
