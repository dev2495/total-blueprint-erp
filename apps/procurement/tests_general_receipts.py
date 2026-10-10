"""General Receipts: non-stock goods and services against bills. Never touches stock."""
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from decimal import Decimal

from django.db import close_old_connections, connection, connections
from django.test import TestCase, TransactionTestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.factory.models import Machine, WorkCenter
from apps.gate.models import GateAuditEvent, GatePass, GatePassLine, GatePassReturn, InwardBillIntake, InwardBillReceiptReference
from apps.gate.services import gate_today
from apps.gate.tests_documents import DocumentFixtureMixin, make_user, stock_counts
from apps.users.models import User

from .models import GeneralReceipt, GeneralReceiptLine


class GeneralReceiptFixture(DocumentFixtureMixin):
    def build(self):
        self.build_fixture()
        self.press_wc = WorkCenter.objects.create(plant=self.plant, name="Printing", code="GR-WC-PRINT")
        self.kachigam_wc = WorkCenter.objects.create(plant=self.other, name="Extrusion", code="GR-WC-EXT")
        self.mamata = Machine.objects.create(work_center=self.press_wc, name="Mamata pouch machine", code="MM-1")
        self.scale = Machine.objects.create(work_center=self.press_wc, name="Weighing scale 300 kg", code="WS-1", status="MAINTENANCE")
        self.extruder = Machine.objects.create(work_center=self.kachigam_wc, name="Blown film line", code="BF-1")
        self.fitter = make_user("gr-fitter", "WORK_CENTER_MANAGER")

    def bill(self, **fields):
        defaults = {"doc_type": "TAX_INVOICE", "category": "SPARES", "vendor": self.vendor, "invoice_number": "MM/26-27/1180", "invoice_normalized": "MM/26-27/1180", "invoice_date": gate_today(), "invoice_fy": 2026 if gate_today().month >= 4 else 2025, "total_amount": Decimal("12000.00")}
        defaults.update(fields)
        return self.make_doc(**defaults)

    def payload(self, bill=None, **changes):
        data = {
            "client_token": str(uuid.uuid4()), "plant": str(self.plant.id), "receipt_type": "GOODS", "received_at": timezone.now().isoformat(),
            "lines": [
                {"line_category": "SPARES", "description": "Barrel teflon seal 65 mm", "quantity": "4", "uom": "NOS", "rate": "2500", "gst_rate": "18", "disposition": "INSTALLED", "machine": str(self.mamata.id), "serial_no": ""},
                {"line_category": "SPARES", "description": "Die seal set", "quantity": "2", "uom": "SET", "rate": "6000", "gst_rate": "18", "disposition": "KEPT_IN_STORE"},
                {"line_category": "CHARGE", "description": "Courier charges", "quantity": "1", "uom": "LOT", "amount": "350.00", "gst_rate": "18"},
            ],
        }
        if bill is not None:
            data["document"] = str(bill.id)
        data.update(changes)
        return data

    def post(self, data, user=None):
        return self.as_(user or self.store).post("/api/procurement/general-receipts/", data, format="json")


class GeneralReceiptTests(GeneralReceiptFixture, TestCase):
    def setUp(self):
        self.build()

    def test_receipt_against_bill_links_audits_and_never_touches_stock(self):
        before = stock_counts()
        bill = self.bill()
        response = self.post(self.payload(bill))
        self.assertEqual(response.status_code, 201, response.data)
        data = response.data
        self.assertRegex(data["number"], r"^GR-\d{4}-000001$")
        self.assertEqual(data["amount"], "22350.00")
        self.assertEqual(data["gst_amount"], "4023.00")
        self.assertEqual(data["party_name"], self.vendor.name)
        self.assertEqual(data["invoice_number"], "MM/26-27/1180")
        self.assertEqual(data["received_by"], str(self.store.id))
        self.assertEqual(data["lines"][0]["machine"]["name"], "Mamata pouch machine")
        self.assertEqual(data["lines"][2]["rate"], "350.0000")
        self.assertFalse(data["replayed"])
        bill.refresh_from_db()
        self.assertEqual(bill.status, "PARTIAL_GRN")
        ref = InwardBillReceiptReference.objects.get(intake=bill)
        self.assertEqual((ref.kind, ref.snapshot["reference"], ref.snapshot["uom"]), ("GENERAL_RECEIPT", data["number"], "MIXED"))
        self.assertEqual(GeneralReceipt.objects.get().document, bill)
        self.assertEqual(GateAuditEvent.objects.filter(object_type="GEN_RECEIPT", action="GR_POSTED", plant=self.plant).count(), 1)
        self.assertEqual(GateAuditEvent.objects.filter(object_type="BILL", object_id=bill.id, action="BILL_LINKED").count(), 1)
        detail = self.as_(self.store).get(f"/api/gate/inward-bills/{bill.id}/").data
        self.assertEqual(detail["receipt_refs"][0]["receipt_status"], "POSTED")
        self.assertIn("complete", detail["allowed_actions"])
        done = self.as_(self.accounts).post(f"/api/gate/inward-bills/{bill.id}/complete/", {"client_token": str(uuid.uuid4()), "reason": "Seals and courier all received"}, format="json")
        self.assertEqual(done.status_code, 200, done.data)
        self.assertEqual(done.data["status"], "RECEIPTED")
        self.assertEqual(stock_counts(), before)

    def test_bill_complete_blank_category_and_service_receipt(self):
        bill = self.bill(category="", vendor=self.vendor_two, invoice_number="XL/2006", invoice_normalized="XL/2006", source="OFFICE")
        service = self.payload(bill, receipt_type="SERVICE", bill_complete=True, received_by=str(self.fitter.id), lines=[
            {"line_category": "SERVICE", "description": "Engineer visit 28/9 - heater fault", "quantity": "1", "uom": "VISIT", "rate": "1700", "gst_rate": "18", "machine": str(self.scale.id)},
        ])
        response = self.post(service)
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["received_by_name"], self.fitter.username)
        bill.refresh_from_db()
        self.assertEqual((bill.status, bill.category), ("RECEIPTED", "SERVICE"))

    def test_same_token_replays_and_changed_payload_conflicts(self):
        bill = self.bill()
        data = self.payload(bill)
        first = self.post(data)
        self.assertEqual(first.status_code, 201, first.data)
        replay = self.post(data)
        self.assertEqual(replay.status_code, 200, replay.data)
        self.assertTrue(replay.data["replayed"])
        self.assertEqual(replay.data["id"], first.data["id"])
        changed = {**data, "notes": "different"}
        self.assertEqual(self.post(changed).status_code, 409)
        self.assertEqual(GeneralReceipt.objects.count(), 1)
        self.assertEqual(InwardBillReceiptReference.objects.count(), 1)

    def test_validation_rules(self):
        bill = self.bill()
        future = (timezone.now() + timedelta(hours=2)).isoformat()
        early = (bill.arrival_at - timedelta(hours=30)).isoformat()
        line = self.payload()["lines"][0]
        cases = {
            "amount": {"lines": [{**line, "amount": "9999.00"}]},
            "gst": {"lines": [{**line, "gst_rate": "7"}]},
            "uom": {"lines": [{**line, "uom": "BUNDLE"}]},
            "service-line": {"receipt_type": "SERVICE"},
            "goods-line": {"lines": [{"line_category": "SERVICE", "description": "Labour", "quantity": "1", "uom": "JOB"}, {"line_category": "CHARGE", "description": "Freight", "quantity": "1", "uom": "LOT"}]},
            "installed": {"lines": [{**line, "machine": None, "equipment_text": ""}]},
            "machine-plant": {"lines": [{**line, "machine": str(self.extruder.id)}]},
            "machine-missing": {"lines": [{**line, "machine": str(uuid.uuid4())}]},
            "receiver": {"received_by": str(make_user("gr-left", "STORE", is_active=False).id)},
            "future": {"received_at": future},
            "early": {"received_at": early},
            "vendor-and-party": {"vendor": str(self.vendor.id), "party_name": "Someone else"},
            "returned-without-pass": {"lines": [{**line, "returned_quantity": "1"}]},
        }
        for name, change in cases.items():
            with self.subTest(case=name):
                response = self.post(self.payload(bill, **change))
                self.assertEqual(response.status_code, 400, response.data)
        no_party = self.payload()
        self.assertEqual(self.post(no_party).status_code, 400)
        self.assertFalse(GeneralReceipt.objects.exists())
        office = self.bill(source="OFFICE", invoice_number="MM/OLD", invoice_normalized="MM/OLD")
        thirty = self.post(self.payload(office, received_at=(office.arrival_at - timedelta(days=30)).isoformat()))
        self.assertEqual(thirty.status_code, 201, thirty.data)
        office_two = self.bill(source="OFFICE", invoice_number="MM/OLDER", invoice_normalized="MM/OLDER")
        self.assertEqual(self.post(self.payload(office_two, received_at=(office_two.arrival_at - timedelta(days=61)).isoformat())).status_code, 400)

    def test_cross_plant_ship_to_and_record_only_rules(self):
        bill = self.bill()
        self.assertEqual(self.post(self.payload(bill, plant=str(self.other.id))).status_code, 400)
        shipped = self.bill(category="MACHINERY", ship_to_plant=self.other, invoice_number="SM/2001", invoice_normalized="SM/2001", total_amount=Decimal("118000"))
        machine_line = {"line_category": "MACHINERY", "description": "Pneumatic system complete", "quantity": "1", "uom": "SET", "rate": "100000", "gst_rate": "18", "disposition": "INSTALLED", "machine": str(self.extruder.id), "serial_no": "PN-2231"}
        ok = self.post(self.payload(shipped, plant=str(self.other.id), lines=[machine_line]))
        self.assertEqual(ok.status_code, 201, ok.data)
        self.assertEqual(ok.data["plant_name"], self.other.name)
        utility = self.bill(category="UTILITY", invoice_number="U1", invoice_normalized="U1")
        self.assertEqual(self.post(self.payload(utility)).status_code, 400)
        filed = self.bill(status="FILED", resolved_at=timezone.now(), invoice_number="F1", invoice_normalized="F1")
        self.assertEqual(self.post(self.payload(filed)).status_code, 409)

    def test_duplicate_invoice_blocks_until_override(self):
        first = self.bill()
        self.bill(plant=self.other, status="FILED", resolved_at=timezone.now(), category="SPARES")
        blocked = self.post(self.payload(first))
        self.assertEqual(blocked.status_code, 409, blocked.data)
        self.assertIn("duplicate_override_reason", str(blocked.data))
        allowed = self.post(self.payload(first, duplicate_override_reason="Second consignment billed on the same number"))
        self.assertEqual(allowed.status_code, 201, allowed.data)
        audit = GateAuditEvent.objects.get(object_type="GEN_RECEIPT", action="GR_POSTED")
        self.assertEqual(audit.reason, "Second consignment billed on the same number")

    def test_permission_matrix(self):
        statuses = {}
        for user in (self.store, self.owner, self.accounts, self.extra, self.planner, self.sales, self.watchman, self.uploader):
            bill = self.bill(invoice_number=f"P-{user.username}", invoice_normalized=f"P-{user.username}")
            statuses[user.username] = self.post(self.payload(bill), user).status_code
        self.assertEqual(statuses, {"doc-store": 201, "gate-owner": 201, "doc-accounts": 201, "doc-extra": 201, "doc-planner": 403, "doc-sales": 403, "gate-watch": 403, "doc-uploader": 403})
        receipt = GeneralReceipt.objects.first()
        for user, expected in [(self.uploader, 200), (self.accounts, 200), (self.planner, 403), (self.sales, 403), (self.watchman, 403)]:
            with self.subTest(user=user.username):
                self.assertEqual(self.as_(user).get("/api/procurement/general-receipts/").status_code, expected)
                self.assertEqual(self.as_(user).get(f"/api/procurement/general-receipts/{receipt.id}/").status_code, expected)
                self.assertEqual(self.as_(user).get("/api/procurement/general-receipts/options/").status_code, expected)

    def gate_pass(self, quantity="2", status="OUT", plant=None):
        gate_pass = GatePass.objects.create(number=f"RGP-2627-{GatePass.objects.count() + 1:04d}", kind="RETURNABLE", plant=plant or self.plant, vendor=self.vendor, party_name=self.vendor.name, purpose="REPAIR", expected_return_date=gate_today() + timedelta(days=7), status=status, created_by=self.store, out_at=timezone.now() - timedelta(days=3))
        line = GatePassLine.objects.create(gate_pass=gate_pass, line_no=1, description="Printing roller for re-chroming", quantity=Decimal(quantity), uom="NOS", machine=self.mamata)
        return gate_pass, line

    def test_gate_pass_return_inside_the_receipt_and_reverse_rules(self):
        gate_pass, line = self.gate_pass()
        bill = self.bill(category="SERVICE", invoice_number="BV/3001", invoice_normalized="BV/3001")
        repair = {"line_category": "SERVICE", "description": "Roller re-chroming and patta milling", "quantity": "2", "uom": "NOS", "rate": "5000", "gst_rate": "18", "disposition": "INSTALLED", "machine": str(self.mamata.id), "gate_pass_line": str(line.id), "returned_quantity": "1"}
        over = self.post(self.payload(bill, receipt_type="SERVICE", lines=[{**repair, "returned_quantity": "3"}]))
        self.assertEqual(over.status_code, 400, over.data)
        self.assertFalse(GeneralReceipt.objects.exists())
        other_gp, other_line = self.gate_pass(plant=self.other)
        self.assertEqual(self.post(self.payload(bill, receipt_type="SERVICE", lines=[{**repair, "gate_pass_line": str(other_line.id)}])).status_code, 400)
        response = self.post(self.payload(bill, receipt_type="SERVICE", lines=[repair]))
        self.assertEqual(response.status_code, 201, response.data)
        line.refresh_from_db()
        gate_pass.refresh_from_db()
        self.assertEqual(line.returned_quantity, Decimal("1"))
        self.assertEqual(gate_pass.status, "PARTLY_RETURNED")
        event = GatePassReturn.objects.get()
        self.assertEqual(str(event.general_receipt_line_id), response.data["lines"][0]["id"])
        self.assertEqual(event.inward_document_id, bill.id)
        self.assertEqual(response.data["lines"][0]["returned_quantity"], "1.000")
        self.assertFalse(response.data["can_reverse"])
        refused = self.as_(self.owner).post(f"/api/procurement/general-receipts/{response.data['id']}/reverse/", {"client_token": str(uuid.uuid4()), "reason": "Posted against the wrong bill"}, format="json")
        self.assertEqual(refused.status_code, 409)
        self.assertIn(gate_pass.number, str(refused.data))
        plain = self.post(self.payload(self.bill(invoice_number="R-1", invoice_normalized="R-1")))
        self.assertEqual(self.as_(self.store).post(f"/api/procurement/general-receipts/{plain.data['id']}/reverse/", {"client_token": str(uuid.uuid4()), "reason": "Posted against the wrong bill"}, format="json").status_code, 403)
        reversed_ = self.as_(self.owner).post(f"/api/procurement/general-receipts/{plain.data['id']}/reverse/", {"client_token": str(uuid.uuid4()), "reason": "Posted against the wrong bill"}, format="json")
        self.assertEqual(reversed_.status_code, 200, reversed_.data)
        self.assertEqual(reversed_.data["status"], "REVERSED")
        self.assertEqual(self.as_(self.owner).post(f"/api/procurement/general-receipts/{plain.data['id']}/reverse/", {"client_token": str(uuid.uuid4()), "reason": "Posted against the wrong bill"}, format="json").status_code, 409)
        linked_bill = GeneralReceipt.objects.get(id=plain.data["id"]).document
        detail = self.as_(self.store).get(f"/api/gate/inward-bills/{linked_bill.id}/").data
        self.assertEqual(detail["receipt_refs"][0]["receipt_status"], "REVERSED")
        self.assertTrue(GateAuditEvent.objects.filter(object_id=linked_bill.id, action="BILL_REF_REVERSED").exists())
        self.assertTrue(GateAuditEvent.objects.filter(object_type="GEN_RECEIPT", action="GR_REVERSED").exists())

    def test_non_stock_followup_keeps_the_void_and_leaves_the_list(self):
        old = self.make_doc(status="VOID", resolved_at=timezone.now(), resolved_by=self.store, resolution_code="NON_STOCK", resolution_reason="Service bill, no stock")
        listing = self.as_(self.store).get("/api/gate/inward-bills/", {"status": "NON_STOCK_FOLLOWUP"})
        self.assertEqual([row["id"] for row in listing.data["results"]], [str(old.id)])
        self.assertTrue(listing.data["results"][0]["needs_followup"])
        self.assertIn("followup", listing.data["results"][0]["allowed_actions"])
        self.assertEqual(self.as_(self.planner).get("/api/gate/inward-bills/", {"status": "NON_STOCK_FOLLOWUP"}).status_code, 403)
        self.assertEqual(self.as_(self.uploader).get("/api/gate/inward-bills/", {"status": "NON_STOCK_FOLLOWUP"}).status_code, 403)
        data = self.payload(followup_of_bill=str(old.id), vendor=str(self.vendor_two.id), invoice_number="PS/4001", receipt_type="SERVICE", lines=[
            {"line_category": "SERVICE", "description": "Weighing scale service", "quantity": "1", "uom": "VISIT", "rate": "1500", "gst_rate": "18", "machine": str(self.scale.id)},
            {"line_category": "SPARES", "description": "Load cell 300 kg", "quantity": "1", "uom": "NOS", "rate": "3200", "gst_rate": "18", "disposition": "INSTALLED", "machine": str(self.scale.id)},
        ])
        response = self.post(data)
        self.assertEqual(response.status_code, 201, response.data)
        self.assertTrue(response.data["document"]["followup"])
        old.refresh_from_db()
        self.assertEqual((old.status, old.resolution_code), ("VOID", "NON_STOCK"))
        self.assertFalse(InwardBillReceiptReference.objects.filter(intake=old).exists())
        self.assertTrue(GateAuditEvent.objects.filter(object_id=old.id, action="NON_STOCK_FOLLOWUP").exists())
        self.assertEqual(self.as_(self.store).get("/api/gate/inward-bills/", {"status": "NON_STOCK_FOLLOWUP"}).data["count"], 0)
        self.assertEqual(self.post({**data, "client_token": str(uuid.uuid4())}).status_code, 409)
        live = self.bill(invoice_number="L-1", invoice_normalized="L-1")
        self.assertEqual(self.post(self.payload(followup_of_bill=str(live.id), vendor=str(self.vendor.id))).status_code, 400)
        self.assertEqual(self.as_(self.owner).post(f"/api/gate/inward-bills/{old.id}/reopen/", {"client_token": str(uuid.uuid4()), "reason": "Trying to reopen a followed-up void"}, format="json").status_code, 409)

    def test_link_existing_receipt_by_document_manager_and_candidates(self):
        unlinked = self.post(self.payload(vendor=str(self.vendor.id), invoice_number="MM/26-27/1180"))
        self.assertEqual(unlinked.status_code, 201, unlinked.data)
        bill = self.bill()
        candidates = self.as_(self.accounts).get(f"/api/gate/inward-bills/{bill.id}/receipt-candidates/")
        self.assertEqual(candidates.status_code, 200, candidates.data)
        self.assertEqual([row["id"] for row in candidates.data["results"]], [unlinked.data["id"]])
        linked = self.as_(self.accounts).post(f"/api/gate/inward-bills/{bill.id}/link-receipts/", {"client_token": str(uuid.uuid4()), "receipt_refs": [{"kind": "GENERAL_RECEIPT", "id": unlinked.data["id"]}], "reason": "Receipt was recorded before the bill came", "bill_complete": True}, format="json")
        self.assertEqual(linked.status_code, 200, linked.data)
        self.assertEqual(linked.data["status"], "RECEIPTED")
        self.assertEqual(GeneralReceipt.objects.get(id=unlinked.data["id"]).document_id, bill.id)
        other = self.bill(invoice_number="MM/26-27/1180", plant=self.plant)
        again = self.as_(self.store).post(f"/api/gate/inward-bills/{other.id}/link-receipts/", {"client_token": str(uuid.uuid4()), "receipt_refs": [{"kind": "GENERAL_RECEIPT", "id": unlinked.data["id"]}], "reason": "Second link attempt"}, format="json")
        self.assertEqual(again.status_code, 409)

    def test_list_filters_machine_history_suggestions_and_options(self):
        bill = self.bill()
        self.post(self.payload(bill))
        gate_pass, line = self.gate_pass()
        GatePassReturn.objects.create(line=line, quantity=Decimal("1"), received_by=self.store)
        service = self.post(self.payload(vendor=str(self.vendor_two.id), receipt_type="SERVICE", lines=[{"line_category": "SERVICE", "description": "Barrel heater rewiring", "quantity": "3", "uom": "HRS", "rate": "400", "machine": str(self.mamata.id)}]))
        self.assertEqual(service.status_code, 201, service.data)
        client = self.as_(self.store)
        self.assertEqual(client.get("/api/procurement/general-receipts/", {"machine": str(self.mamata.id)}).data["count"], 2)
        self.assertEqual(client.get("/api/procurement/general-receipts/", {"receipt_type": "SERVICE"}).data["count"], 1)
        self.assertEqual(client.get("/api/procurement/general-receipts/", {"line_category": "CHARGE"}).data["count"], 1)
        self.assertEqual(client.get("/api/procurement/general-receipts/", {"search": "teflon"}).data["count"], 1)
        self.assertEqual(client.get("/api/procurement/general-receipts/", {"vendor": str(self.vendor_two.id)}).data["count"], 1)
        self.assertEqual(client.get("/api/procurement/general-receipts/", {"date_from": str(gate_today()), "date_to": str(gate_today())}).data["count"], 2)
        self.assertEqual(client.get("/api/procurement/general-receipts/", {"receipt_type": "RENT"}).status_code, 400)
        history = client.get("/api/procurement/general-receipts/machine-history/", {"machine": str(self.mamata.id)})
        self.assertEqual(history.status_code, 200, history.data)
        kinds = [row["kind"] for row in history.data["events"]]
        self.assertEqual(set(kinds), {"GENERAL_RECEIPT", "GATE_PASS_OUT", "GATE_PASS_RETURN"})
        stamps = [row["at"] for row in history.data["events"]]
        self.assertEqual(stamps, sorted(stamps, reverse=True))
        self.assertEqual(history.data["totals"]["amount"], "11200.00")
        self.assertEqual(client.get("/api/procurement/general-receipts/machine-history/").status_code, 404)
        self.assertEqual(self.as_(self.planner).get("/api/procurement/general-receipts/machine-history/", {"machine": str(self.mamata.id)}).status_code, 403)
        suggestions = client.get("/api/procurement/general-receipts/suggestions/", {"q": "seal", "vendor": str(self.vendor.id)})
        self.assertEqual(suggestions.status_code, 200)
        rows = suggestions.data["results"]
        self.assertEqual({row["description"] for row in rows}, {"Barrel teflon seal 65 mm", "Die seal set"})
        self.assertEqual(next(row for row in rows if row["description"] == "Die seal set")["last_rate"], "6000.0000")
        options = client.get("/api/procurement/general-receipts/options/", {"plant": str(self.plant.id)})
        self.assertEqual(options.status_code, 200, options.data)
        self.assertEqual({row["code"] for row in options.data["machines"]}, {"MM-1", "WS-1"})
        self.assertIn("40", options.data["gst_rates"])
        self.assertIn(str(self.fitter.id), {row["id"] for row in options.data["receivers"]})


class GeneralReceiptConcurrencyTests(GeneralReceiptFixture, TransactionTestCase):
    def setUp(self):
        self.build()

    def run_parallel(self, payloads):
        def send(data):
            close_old_connections()
            try:
                client = APIClient()
                client.force_authenticate(User.objects.get(id=self.store.id))
                response = client.post("/api/procurement/general-receipts/", data, format="json")
                return response.status_code, response.data.get("number")
            finally:
                connections["default"].close()
        with ThreadPoolExecutor(max_workers=len(payloads)) as pool:
            return list(pool.map(send, payloads))

    def test_numbers_are_unique_and_sequential_under_concurrency(self):
        if connection.vendor != "postgresql":
            self.skipTest("PostgreSQL concurrency acceptance")
        results = self.run_parallel([self.payload(vendor=str(self.vendor.id)) for _ in range(4)])
        self.assertEqual([status for status, _ in results], [201] * 4)
        numbers = sorted(number for _, number in results)
        self.assertEqual(len(set(numbers)), 4)
        self.assertEqual([int(number.rsplit("-", 1)[1]) for number in numbers], [1, 2, 3, 4])

    def test_same_token_in_parallel_records_one_receipt(self):
        if connection.vendor != "postgresql":
            self.skipTest("PostgreSQL concurrency acceptance")
        bill = self.bill()
        data = self.payload(bill)
        results = self.run_parallel([data, data])
        self.assertEqual(sorted(status for status, _ in results), [200, 201])
        self.assertEqual(len({number for _, number in results}), 1)
        self.assertEqual(GeneralReceipt.objects.count(), 1)
        self.assertEqual(GeneralReceiptLine.objects.count(), 3)
        self.assertEqual(InwardBillReceiptReference.objects.count(), 1)
        self.assertEqual(InwardBillIntake.objects.get(id=bill.id).status, "PARTIAL_GRN")
