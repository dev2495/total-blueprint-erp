"""Late and monthly job-work bills: one bill linked to returns received
earlier, across orders of the same job worker (one of them closed)."""
import hashlib
from decimal import Decimal

from django.test import TestCase

from apps.gate.models import GateAuditEvent, InwardBillIntake, InwardBillReceiptReference
from apps.inventory.models import InventoryBulk, InventoryRoll, JobWorkBillLink, JobWorkReturn, Vendor
from apps.production.models import FinishedGoodsBatch
from apps.users.models import Role, User

from .tests_job_work_base import JobWorkFixtureMixin, token

LINK_URL = "/api/inventory/job-work/link-bill/"
LIST_URL = "/api/inventory/job-work/unbilled-returns/"


class LateBillFixtureMixin(JobWorkFixtureMixin):
    def setUp(self):
        super().setUp()
        self.pouch_vendor = Vendor.objects.create(
            code="DEMOPOUCH", name="Demo Pouch Works", type="JOBWORK", gst_no="24BBBBB1111B1Z6", mailing_state="Gujarat",
            jobwork_rates=[{"process_code": "POUCH_JOBWORK", "rate": "2.00", "uom": "PCS"}],
        )
        self.bills_seq = 0

    def bill(self, *, vendor=None, invoice="DEMO/INV/0001", plant=None, category="JOBWORK", taxable=None, **extra):
        self.bills_seq += 1
        vendor = vendor or self.pouch_vendor
        return InwardBillIntake.objects.create(
            plant=plant or self.plant, created_by=self.owner, content_hash=hashlib.sha256(f"demo-bill-{self.bills_seq}".encode()).hexdigest(),
            review_data={"vendor_id": str(vendor.id), "invoice_number": invoice}, category=category, taxable_amount=taxable, **extra,
        )

    def received(self, suffix, pcs, *, vendor=None, close=False):
        """A planned pouch order with one roll back as finished pieces (no bill)."""
        vendor = vendor or self.pouch_vendor
        job = self.make_job(suffix)
        roll = self.make_roll(f"PR-{suffix}", "150", job=job)
        order = self.create_order(job=job, vendor=str(vendor.id), rate="2.00", rate_uom="PCS")
        sent = self.dispatch(order["id"], [roll])["order"]
        kg = Decimal(pcs) * Decimal("10") / Decimal("1000")
        result = self.post_return(order["id"], {
            "vendor_document_no": f"DC-{suffix}",
            "sent_lines": [{"sent_line_id": sent["sent_lines"][0]["id"], "disposition": "PROCESSED"}],
            "fg": {"qty_pcs": pcs, "location_id": str(self.fg.id)},
            "wastage": {"kg": str(Decimal("150") - kg)},
        })
        if close:
            closed = self.api.post(f"/api/inventory/job-work/{order['id']}/close/", {"client_token": token(), "step_force_reason": "Rest not needed"}, format="json")
            self.assertEqual(closed.status_code, 200, closed.data)
        return order, JobWorkReturn.objects.get(id=result["return_id"])

    def link(self, bill, returns, *, client=None, expect=201, **extra):
        payload = {"client_token": token(), "bill_id": str(bill.id), "return_ids": [str(ret.id) for ret in returns]}
        payload.update(extra)
        response = (client or self.api).post(LINK_URL, payload, format="json")
        self.assertEqual(response.status_code, expect, getattr(response, "data", response))
        return response.data


class MonthlyBillTests(LateBillFixtureMixin, TestCase):
    def test_one_bill_covers_returns_of_two_orders_one_closed(self):
        order_a, ret_a = self.received("MB-A", 10000, close=True)
        order_b, ret_b = self.received("MB-B", 8000)
        bill = self.bill(taxable=Decimal("36000.00"))
        self.assertEqual(self.api.get(f"/api/inventory/job-work/{order_a['id']}/").data["status"], "CLOSED")

        listing = self.api.get(LIST_URL, {"bill": str(bill.id)})
        self.assertEqual(listing.status_code, 200, listing.data)
        self.assertEqual({row["number"] for row in listing.data["results"]}, {ret_a.number, ret_b.number})
        row_a = next(row for row in listing.data["results"] if row["id"] == str(ret_a.id))
        self.assertEqual((row_a["order_status"], row_a["output_pcs"], row_a["order_rate"]), ("CLOSED", 10000, "2"))
        self.assertEqual(listing.data["vendor"]["name"], "Demo Pouch Works")

        stock_before = (InventoryRoll.objects.count(), FinishedGoodsBatch.objects.count(), list(InventoryBulk.objects.values_list("id", "qty_kg").order_by("id")))
        payload = {
            "client_token": token(), "bill_id": str(bill.id), "return_ids": [str(ret_b.id), str(ret_a.id)],
            "billed_qty": "18000", "billed_uom": "PCS", "billed_rate": "2.00", "billed_amount": "36000.00", "complete": True,
        }
        response = self.api.post(LINK_URL, payload, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["warnings"], [])
        self.assertEqual(response.data["return_count"], 2)
        self.assertEqual(response.data["bill"]["status"], "RECEIPTED")
        allocated = {row["return_number"]: row["allocated_amount"] for row in response.data["links"]}
        self.assertEqual(allocated, {ret_a.number: "20000", ret_b.number: "16000"})

        bill.refresh_from_db()
        self.assertEqual(bill.status, "RECEIPTED")
        refs = {str(ref.object_id): ref for ref in InwardBillReceiptReference.objects.filter(intake=bill)}
        self.assertEqual(set(refs), {str(ret_a.id), str(ret_b.id)})
        self.assertEqual({ref.snapshot["invoice_number"] for ref in refs.values()}, {"DEMO/INV/0001"})
        self.assertEqual(refs[str(ret_a.id)].snapshot["quantity"], "10000")
        links = JobWorkBillLink.objects.filter(bill=bill)
        self.assertEqual(links.count(), 2)
        self.assertTrue(all(link.billed_amount == Decimal("36000.00") and link.bill_complete for link in links))
        self.assertEqual(GateAuditEvent.objects.filter(object_id__in=[order_a["id"], order_b["id"]], action="JW_BILL_LINKED").count(), 2)
        # Linking a bill moves no stock.
        self.assertEqual(stock_before, (InventoryRoll.objects.count(), FinishedGoodsBatch.objects.count(), list(InventoryBulk.objects.values_list("id", "qty_kg").order_by("id"))))

        detail = self.api.get(f"/api/inventory/job-work/{order_a['id']}/").data
        shown = detail["returns"][0]
        self.assertEqual((shown["bill"]["id"], shown["bill"]["linked"], shown["bill"]["invoice_number"]), (str(bill.id), "LATER", "DEMO/INV/0001"))
        self.assertEqual(shown["bill_link"]["allocated_amount"], "20000")
        self.assertEqual(shown["bill_link"]["return_count"], 2)
        self.assertEqual(self.api.get(LIST_URL, {"vendor": str(self.pouch_vendor.id)}).data["results"], [])

        replay = self.api.post(LINK_URL, payload, format="json")
        self.assertEqual(replay.status_code, 200)
        self.assertTrue(replay.data["replayed"])
        changed = self.api.post(LINK_URL, {**payload, "billed_amount": "35000.00"}, format="json")
        self.assertEqual(changed.status_code, 409)
        self.assertEqual(JobWorkBillLink.objects.count(), 2)

    def test_differences_are_warnings_and_the_bill_stays_open(self):
        _, ret_a = self.received("WR-A", 10000)
        _, ret_b = self.received("WR-B", 8000)
        bill = self.bill(taxable=Decimal("39000.00"))
        result = self.link(bill, [ret_a, ret_b], billed_qty="18500", billed_uom="PCS", billed_rate="2.10", billed_amount="40000.00")
        self.assertEqual({row["code"] for row in result["warnings"]}, {"BILLED_QTY", "RATE_ORDER", "RATE_CARD", "AMOUNT", "BILL_TAXABLE"})
        self.assertEqual(result["bill"]["status"], "PARTIAL_GRN")
        self.assertEqual(JobWorkBillLink.objects.get(job_work_return=ret_a).warnings, result["warnings"])
        detail = self.api.get(f"/api/inventory/job-work/{ret_b.order_id}/").data
        self.assertEqual(len(detail["returns"][0]["bill_link"]["warnings"]), 5)

    def test_return_billed_in_its_own_save_shows_its_bill_and_cannot_be_billed_again(self):
        job = self.make_job("OWN")
        roll = self.make_roll("PR-OWN", "100", job=job)
        order = self.create_order(job=job, vendor=str(self.pouch_vendor.id))
        sent = self.dispatch(order["id"], [roll])["order"]
        first_bill = self.bill(invoice="DEMO/INV/0002")
        result = self.post_return(order["id"], {
            "sent_lines": [{"sent_line_id": sent["sent_lines"][0]["id"], "disposition": "PROCESSED"}],
            "fg": {"qty_pcs": 9000, "location_id": str(self.fg.id)}, "wastage": {"kg": "10"},
            "bill": {"bill_id": str(first_bill.id), "billed_qty": "9000", "billed_uom": "PCS", "billed_rate": "2.00", "billed_amount": "18000.00"},
        })
        shown = result["order"]["returns"][0]
        self.assertEqual((shown["bill"]["id"], shown["bill"]["linked"], shown["bill_link"]), (str(first_bill.id), "WITH_RETURN", None))
        ret = JobWorkReturn.objects.get(id=result["return_id"])
        self.assertEqual(self.api.get(LIST_URL, {"vendor": str(self.pouch_vendor.id)}).data["results"], [])
        conflict = self.link(self.bill(invoice="DEMO/INV/0003"), [ret], expect=409)
        self.assertIn("Already billed", conflict["message"])

    def test_bill_desk_link_is_shown_and_excluded(self):
        from apps.gate.bill_services import attach_receipt_to_bill
        from django.db import transaction

        order, ret = self.received("DESK", 5000)
        bill = self.bill(invoice="DEMO/INV/0004")
        with transaction.atomic():
            attach_receipt_to_bill(self.store, bill.id, "JOBWORK_RETURN", ret.id)
        detail = self.api.get(f"/api/inventory/job-work/{order['id']}/").data
        self.assertEqual((detail["returns"][0]["bill"]["id"], detail["returns"][0]["bill"]["linked"]), (str(bill.id), "BILL_DESK"))
        self.assertEqual(self.api.get(LIST_URL, {"vendor": str(self.pouch_vendor.id)}).data["results"], [])
        self.link(self.bill(invoice="DEMO/INV/0005"), [ret], expect=409)


class LateBillValidationTests(LateBillFixtureMixin, TestCase):
    def test_refusals(self):
        _, ret = self.received("VAL-A", 6000)
        _, other_vendor_ret = self.received("VAL-B", 6000, vendor=self.vendor)
        other_vendor_bill = self.bill(vendor=self.vendor, invoice="DEMO/INV/0101")
        refused = self.link(other_vendor_bill, [ret], expect=400)
        self.assertIn("another vendor", refused["message"])
        mixed = self.link(self.bill(invoice="DEMO/INV/0102"), [ret, other_vendor_ret], expect=400)
        self.assertIn("another vendor", mixed["message"])
        other_plant_bill = self.bill(invoice="DEMO/INV/0103", plant=self.other_plant)
        self.assertEqual(self.api.get(LIST_URL, {"bill": str(other_plant_bill.id)}).data["results"], [])
        cross_plant = self.link(other_plant_bill, [ret], expect=400)
        self.assertIn("Dabhel", cross_plant["message"])
        stock_bill = self.link(self.bill(invoice="DEMO/INV/0104", category="STOCK"), [ret], expect=400)
        self.assertIn("job-work bill", stock_bill["message"])
        closed = self.bill(invoice="DEMO/INV/0105")
        InwardBillIntake.objects.filter(id=closed.id).update(status="FILED", resolved_at=closed.arrival_at)
        self.link(closed, [ret], expect=409)
        missing = self.link(self.bill(invoice="DEMO/INV/0106"), [ret], expect=400, return_ids=[str(ret.id), "00000000-0000-0000-0000-000000000000"])
        self.assertIn("no longer exist", missing["message"])
        duplicate = self.link(self.bill(invoice="DEMO/INV/0107"), [ret], expect=400, return_ids=[str(ret.id), str(ret.id)])
        self.assertIn("return_ids", duplicate["field_errors"])
        empty = self.link(self.bill(invoice="DEMO/INV/0108"), [], expect=400)
        self.assertIn("return_ids", empty["field_errors"])
        self.assertFalse(JobWorkBillLink.objects.exists())
        self.assertFalse(InwardBillReceiptReference.objects.exists())
        unknown_bill = self.api.get(LIST_URL, {"bill": "00000000-0000-0000-0000-000000000000"})
        self.assertEqual(unknown_bill.status_code, 404)
        no_vendor = self.api.get(LIST_URL)
        self.assertEqual(no_vendor.status_code, 400)

    def test_permission_matrix(self):
        bill_role = Role.objects.create(code="BILL_DESK", name="Bill desk", default_permissions=["inventory.view", "inventory.manage", "documents.manage"])
        role_user = User.objects.create_user(username="jw-billdesk", role=bill_role)
        extra = User.objects.create_user(username="jw-billextra", role=Role.objects.get(code="SALES"), extra_permissions=["inventory.view", "inventory.manage", "documents.manage"])
        returns = [self.received(f"PM-{index}", 1000)[1] for index in range(4)]
        bill = self.bill(invoice="DEMO/INV/0201")
        for user in (self.planner, self.sales, self.watchman, self.desk_user):
            with self.subTest(user=user.username):
                self.link(bill, returns[:1], client=self.client_for(user), expect=403)
                self.assertIn(self.client_for(user).get(LIST_URL, {"bill": str(bill.id)}).status_code, {403})
        for user, ret in zip((self.store, self.owner, role_user, extra), returns):
            with self.subTest(user=user.username):
                listed = self.client_for(user).get(LIST_URL, {"bill": str(bill.id)})
                self.assertEqual(listed.status_code, 200, listed.data)
                self.link(bill, [ret], client=self.client_for(user))
        self.assertEqual(JobWorkBillLink.objects.filter(bill=bill).count(), 4)
        self.assertEqual(set(JobWorkBillLink.objects.values_list("linked_by__username", flat=True)), {"jw-store", "jw-owner", "jw-billdesk", "jw-billextra"})

    def test_link_rows_are_append_only(self):
        _, ret = self.received("IMM", 3000)
        self.link(self.bill(invoice="DEMO/INV/0301"), [ret])
        link = JobWorkBillLink.objects.get(job_work_return=ret)
        link.billed_amount = Decimal("1")
        with self.assertRaises(TypeError):
            link.save()
        with self.assertRaises(TypeError):
            link.delete()
