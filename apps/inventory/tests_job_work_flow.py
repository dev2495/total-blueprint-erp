"""Job work end to end: Vee Dee pouch job work, lamination lineage, partial
returns, short-close, emergency release, bill link, QR and challan."""
import hashlib
from decimal import Decimal

from django.test import TestCase
from django.utils import timezone

from apps.gate.models import GateAuditEvent, InwardBillIntake, InwardBillReceiptReference
from apps.inventory.models import (
    BulkTransaction,
    InventoryBulk,
    InventoryRoll,
    JobWorkChallan,
    JobWorkOrder,
    JobWorkReturn,
    JobWorkSettlement,
    RollConsumption,
    RollLink,
)
from apps.inventory.services.bulk_service import BulkService
from apps.inventory.services.packaging_service import PackagingService
from apps.production.models import FinishedGoodsBatch, JobExecutionLog, ScrapLog, ScrapReason
from apps.production.services.dispatch_service import FGDispatchService
from apps.production.services.packing_service import PackingService

from .tests_job_work_base import JobWorkFixtureMixin, token


class VeeDeePouchJobWorkTests(JobWorkFixtureMixin, TestCase):
    """28,825 pcs @ ₹2.75 in 72 boxes, 2 balance rolls 103.8 kg, 130.7 kg wastage."""

    def setUp(self):
        super().setUp()
        self.job = self.make_job("VD")
        weights = ["80", "80", "80", "80", "101.375", "101.375"]  # 522.75 kg of printed laminate
        self.rolls = [self.make_roll(f"PR-VD-{i}", w, job=self.job) for i, w in enumerate(weights, start=1)]
        self.bill = InwardBillIntake.objects.create(
            plant=self.plant, created_by=self.owner, content_hash=hashlib.sha256(b"vd-0036").hexdigest(),
            review_data={"vendor_id": str(self.vendor.id), "invoice_number": "JW/0001"},
        )

    def vee_dee_return(self, order, **overrides):
        payload = {
            "vendor_document_no": "JW/0001",
            "vendor_document_date": "2026-10-08",
            "sent_lines": [
                *[{"sent_line_id": self.sent_line(order, roll)["id"], "disposition": "PROCESSED"} for roll in self.rolls[:4]],
                {"sent_line_id": self.sent_line(order, self.rolls[4])["id"], "disposition": "PARTLY_USED", "returned_qty": "51.900", "location_id": str(self.rm.id)},
                {"sent_line_id": self.sent_line(order, self.rolls[5])["id"], "disposition": "PARTLY_USED", "returned_qty": "51.900", "location_id": str(self.rm.id)},
            ],
            "fg": {"qty_pcs": 28825, "boxes": 72, "location_id": str(self.fg.id)},
            "wastage": {"kg": "130.700", "bags": 10, "returned_to_factory": True},
            "bill": {"bill_id": str(self.bill.id), "billed_qty": "28825", "billed_uom": "PCS", "billed_rate": "2.75", "billed_amount": "79268.75", "complete": True},
        }
        payload.update(overrides)
        return payload

    def test_full_vee_dee_flow_from_challan_to_closed_route_step(self):
        order = self.create_order(job=self.job)
        self.assertTrue(order["number"].startswith("JWO-"))
        self.assertEqual(order["status"], "DRAFT")
        self.assertEqual(order["rate"], "2.75")  # from the vendor rate card
        self.assertEqual(order["rate_uom"], "PCS")
        self.job.refresh_from_db()
        self.assertTrue(self.job.is_on_hold)

        sent = self.dispatch(order["id"], self.rolls, vehicle_no="DD03U9802")
        challan = JobWorkChallan.objects.get(id=sent["challan_id"])
        self.assertTrue(challan.number.startswith("JWC-"))
        self.assertEqual(challan.total_qty_kg, Decimal("522.750"))
        self.assertEqual(challan.consignee["gstin"], "24ABCPV1234K1Z9")
        self.assertEqual(challan.place_of_supply, "Gujarat")
        self.assertEqual(sent["order"]["status"], "SENT")
        self.assertEqual(sent["order"]["at_vendor"]["kg"], "522.75")
        for roll in self.rolls:
            roll.refresh_from_db()
            self.assertEqual((roll.status, roll.location_id), ("SENT_JOBWORK", self.jw_out.id))

        pdf = self.api.get(sent["order"]["challans"][0]["pdf_url"])
        self.assertEqual(pdf.status_code, 200)
        self.assertEqual(pdf["Content-Type"], "application/pdf")
        self.assertTrue(pdf.content.startswith(b"%PDF"))

        result = self.post_return(order["id"], self.vee_dee_return(sent["order"]))
        ret = JobWorkReturn.objects.get(id=result["return_id"])
        self.assertTrue(ret.number.startswith("JWR-"))
        self.assertEqual((ret.output_pcs, ret.output_kg, ret.balance_kg, ret.wastage_kg), (28825, Decimal("288.250"), Decimal("103.800"), Decimal("130.700")))
        self.assertEqual(ret.variance_kg, Decimal("0.000"))
        self.assertEqual(ret.warnings, [])
        self.assertEqual(result["order"]["status"], "RETURNED")

        # Sent rolls are consumed: nothing phantom stays at the job worker.
        self.assertFalse(InventoryRoll.objects.filter(location=self.jw_out).exclude(status="CONSUMED").exists())
        self.assertEqual(InventoryRoll.objects.filter(id__in=[r.id for r in self.rolls], status="CONSUMED", weight_kg=0).count(), 6)
        self.assertEqual(RollConsumption.objects.filter(job=self.job, input_roll__in=self.rolls).count(), 6)
        balance_rolls = InventoryRoll.objects.filter(parent_roll__in=self.rolls[4:], status="AVAILABLE")
        self.assertEqual(sorted(r.weight_kg for r in balance_rolls), [Decimal("51.900"), Decimal("51.900")])
        self.assertTrue(all(r.location_id == self.rm.id for r in balance_rolls))
        self.assertEqual(RollLink.objects.filter(parent_roll__in=self.rolls[4:], relation_type="SPLIT").count(), 2)

        # FG batch exactly like an in-house completion and available to packing/dispatch.
        batch = FinishedGoodsBatch.objects.get(production_job=self.job)
        self.assertEqual(batch.batch_number, f"BATCH-{self.job.job_number}-001")
        self.assertEqual((batch.qty_pcs, batch.qty_kg, batch.status, batch.location_id), (28825, Decimal("288.2500"), "AVAILABLE", self.fg.id))
        self.assertEqual(batch.sales_order_item_id, self.job.sales_order_item_id)
        self.assertEqual(batch.template_id, self.job.template_id)
        self.assertEqual(batch.meta_json["jobwork"]["boxes"], 72)
        self.assertEqual(batch.meta_json["primary_uom"], "PCS")
        units = FGDispatchService.get_dispatchable_units(job_id=str(self.job.id))
        self.assertEqual([row["id"] for row in units["batch_units"]], [batch.id])
        PackagingService.add_packaging_stock(material_id=self.gonny.id, qty=5, location_id=self.fg.id, input_uom="PCS")
        gonny = PackingService.create_gonny(str(batch.id), 400, self.store, gonny_material_id=str(self.gonny.id))
        self.assertEqual(gonny.qty_pcs, 400)

        # Wastage, job progress, bill link.
        scrap = ScrapLog.objects.get(production_job=self.job)
        self.assertEqual((scrap.reason, scrap.quantity), ("JOBWORK_WASTE", Decimal("130.7000")))
        self.assertIn("10 bags", scrap.notes)
        self.assertEqual(JobExecutionLog.objects.get(production_job=self.job).quantity, Decimal("288.2500"))
        self.job.refresh_from_db()
        self.assertEqual(self.job.produced_qty, Decimal("28825"))
        self.bill.refresh_from_db()
        self.assertEqual(self.bill.status, "RECEIPTED")
        reference = InwardBillReceiptReference.objects.get(intake=self.bill)
        self.assertEqual((reference.kind, str(reference.object_id)), ("JOBWORK_RETURN", str(ret.id)))
        self.assertEqual(reference.snapshot["quantity"], "28825.000")
        self.assertEqual(ret.bill_id, self.bill.id)

        closed = self.api.post(f"/api/inventory/job-work/{order['id']}/close/", {"client_token": token()}, format="json")
        self.assertEqual(closed.status_code, 200, closed.data)
        self.assertEqual(closed.data["order"]["status"], "CLOSED")
        self.assertEqual(closed.data["step"]["action"], "STEP_COMPLETED")
        self.job.refresh_from_db()
        self.assertEqual(self.job.job_state, "COMPLETED")
        self.assertEqual(self.job.closed_by_id, self.store.id)
        self.assertFalse(self.job.is_on_hold)
        actions = list(GateAuditEvent.objects.filter(object_id=order["id"]).values_list("action", flat=True).order_by("created_at"))
        self.assertEqual(actions, ["JW_CREATED", "JW_DISPATCHED", "JW_RETURNED", "JW_CLOSED"])

    def test_bill_mismatch_is_recorded_as_warnings_not_blocked(self):
        order = self.create_order(job=self.job)
        sent = self.dispatch(order["id"], self.rolls)
        payload = self.vee_dee_return(sent["order"])
        payload["bill"] = {"bill_id": str(self.bill.id), "billed_qty": "29000", "billed_uom": "PCS", "billed_rate": "2.90", "billed_amount": "80000.00"}
        result = self.post_return(order["id"], payload)
        codes = {row["code"] for row in result["warnings"]}
        self.assertEqual(codes, {"BILLED_QTY", "RATE_ORDER", "RATE_CARD", "AMOUNT"})
        self.bill.refresh_from_db()
        self.assertEqual(self.bill.status, "PARTIAL_GRN")

    def test_bill_from_another_vendor_or_closed_bill_is_refused(self):
        order = self.create_order(job=self.job)
        sent = self.dispatch(order["id"], self.rolls)
        self.bill.review_data = {"vendor_id": str(self.other_vendor.id)}
        self.bill.save(update_fields=["review_data"])
        refused = self.post_return(order["id"], self.vee_dee_return(sent["order"]), expect=400)
        self.assertIn("bill", refused["detail"])
        self.assertFalse(JobWorkReturn.objects.exists())
        self.assertEqual(InventoryRoll.objects.filter(status="SENT_JOBWORK").count(), 6)

    def test_material_balance_beyond_tolerance_needs_a_reason(self):
        order = self.create_order(job=self.job)
        sent = self.dispatch(order["id"], self.rolls)
        payload = self.vee_dee_return(sent["order"], wastage={"kg": "90", "bags": 7, "returned_to_factory": False})
        payload.pop("bill")
        refused = self.post_return(order["id"], payload, expect=400)
        self.assertIn("variance_reason", refused["detail"])
        self.assertIn("40.700 kg", refused["message"])
        payload["variance_reason"] = "Vendor kept 4 bags of trim; recovery note follows"
        result = self.post_return(order["id"], payload)
        self.assertEqual(JobWorkReturn.objects.get(id=result["return_id"]).variance_kg, Decimal("40.700"))

    def test_closing_with_material_still_at_vendor_is_a_conflict(self):
        order = self.create_order(job=self.job)
        self.dispatch(order["id"], self.rolls)
        response = self.api.post(f"/api/inventory/job-work/{order['id']}/close/", {"client_token": token()}, format="json")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data["code"], "CONFLICT")
        self.assertIn("still at the job worker", response.data["message"])


class LaminationAndPartialReturnTests(JobWorkFixtureMixin, TestCase):
    def test_lamination_job_work_returns_rolls_with_lineage(self):
        job = self.make_job("LAM", process=self.lam_process, quantity="155", uom="KG", unit_weight_g="0", fg_type="ROLL")
        printed = self.make_roll("PR-LAM-1", "100", job=job)
        plain = self.make_roll("PE-LAM-1", "60", job=job)
        order = self.create_order(job=job, expected_output_kind="ROLLS", expected_qty="155", expected_uom="KG", rate="9.5", rate_uom="KG")
        sent = self.dispatch(order["id"], [printed, plain])
        result = self.post_return(order["id"], {
            "sent_lines": [{"sent_line_id": line["id"], "disposition": "PROCESSED"} for line in sent["order"]["sent_lines"]],
            "output_rolls": [{"material_id": str(self.lam_film.id), "weight_kg": "155", "width_mm": "830", "thickness_micron": "62", "location_id": str(self.wip.id)}],
            "wastage": {"kg": "5", "returned_to_factory": False},
        })
        out = InventoryRoll.objects.get(job_work_return_lines__job_work_return_id=result["return_id"], job_work_return_lines__kind="OUTPUT_ROLL")
        self.assertEqual((out.created_by_job_id, out.production_job_id, out.created_process_id), (job.id, job.id, self.lam_process.id))
        self.assertEqual((out.completed_step_index, out.current_step_index, out.status), (0, 1, "AVAILABLE"))
        self.assertTrue(out.label_id.startswith(f"R-{job.job_number}-"))
        links = RollLink.objects.filter(child_roll=out)
        self.assertEqual({link.parent_roll_id for link in links}, {printed.id, plain.id})
        self.assertEqual(sum(link.qty_used_kg for link in links), Decimal("160.000"))
        self.assertEqual(RollConsumption.objects.filter(job=job, output_roll=out).count(), 2)
        closed = self.api.post(f"/api/inventory/job-work/{order['id']}/close/", {"client_token": token()}, format="json")
        self.assertEqual(closed.status_code, 200, closed.data)
        job.refresh_from_db()
        self.assertEqual(job.job_state, "COMPLETED")

    def test_two_partial_returns_then_close(self):
        job = self.make_job("PART")
        rolls = [self.make_roll(f"PR-PART-{i}", "100", job=job) for i in range(1, 5)]
        order = self.create_order(job=job)
        sent = self.dispatch(order["id"], rolls)["order"]
        first = self.post_return(order["id"], {
            "sent_lines": [{"sent_line_id": self.sent_line(sent, roll)["id"], "disposition": "PROCESSED"} for roll in rolls[:2]],
            "fg": {"qty_pcs": 15000, "boxes": 38, "location_id": str(self.fg.id)},
            "wastage": {"kg": "50", "bags": 4, "returned_to_factory": True},
        })
        self.assertEqual(first["order"]["status"], "PARTLY_RETURNED")
        self.assertEqual(first["order"]["at_vendor"]["kg"], "200")
        second = self.post_return(order["id"], {
            "sent_lines": [
                {"sent_line_id": self.sent_line(sent, rolls[2])["id"], "disposition": "PROCESSED"},
                {"sent_line_id": self.sent_line(sent, rolls[3])["id"], "disposition": "RETURNED", "location_id": str(self.rm.id)},
            ],
            "fg": {"qty_pcs": 8000, "boxes": 20, "location_id": str(self.fg.id)},
            "wastage": {"kg": "20", "bags": 2},
        })
        self.assertEqual(second["order"]["status"], "RETURNED")
        rolls[3].refresh_from_db()
        self.assertEqual((rolls[3].status, rolls[3].location_id, rolls[3].weight_kg), ("AVAILABLE", self.rm.id, Decimal("100.000")))
        self.assertEqual(FinishedGoodsBatch.objects.filter(production_job=job).count(), 2)
        self.assertEqual(sorted(FinishedGoodsBatch.objects.filter(production_job=job).values_list("batch_number", flat=True)), [f"BATCH-{job.job_number}-001", f"BATCH-{job.job_number}-002"])
        totals = second["order"]["totals"]
        self.assertEqual((totals["output_pcs"], totals["at_vendor_kg"], totals["variance_kg"]), (23000, "0", "0"))
        closed = self.api.post(f"/api/inventory/job-work/{order['id']}/close/", {"client_token": token(), "step_force_reason": "Customer accepted 23,000 pcs"}, format="json")
        self.assertEqual(closed.status_code, 200, closed.data)
        self.assertFalse(InventoryRoll.objects.filter(location=self.jw_out, status="SENT_JOBWORK").exists())

    def test_short_close_writes_off_remaining_material_with_reason(self):
        job = self.make_job("SHORT")
        rolls = [self.make_roll(f"PR-SHORT-{i}", "100", job=job) for i in range(1, 4)]
        order = self.create_order(job=job)
        sent = self.dispatch(order["id"], rolls)["order"]
        self.post_return(order["id"], {
            "sent_lines": [{"sent_line_id": self.sent_line(sent, rolls[0])["id"], "disposition": "PROCESSED"}],
            "fg": {"qty_pcs": 9000, "location_id": str(self.fg.id)},
            "wastage": {"kg": "10"},
        })
        too_short = self.api.post(f"/api/inventory/job-work/{order['id']}/short-close/", {"client_token": token(), "reason": "no"}, format="json")
        self.assertEqual(too_short.status_code, 400)
        response = self.api.post(f"/api/inventory/job-work/{order['id']}/short-close/", {"client_token": token(), "reason": "Vendor fire; 2 rolls destroyed"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["order"]["status"], "CLOSED")
        self.assertEqual(response.data["order"]["short_close_reason"], "Vendor fire; 2 rolls destroyed")
        self.assertEqual(len(response.data["written_off"]), 2)
        self.assertEqual(JobWorkSettlement.objects.filter(order_id=order["id"], written_off=True).count(), 2)
        for roll in rolls[1:]:
            roll.refresh_from_db()
            self.assertEqual((roll.status, roll.weight_kg), ("CONSUMED", Decimal("0")))
            self.assertIn("jobwork_write_off", roll.meta_json)
        self.assertFalse(InventoryRoll.objects.filter(location=self.jw_out, status="SENT_JOBWORK").exists())
        job.refresh_from_db()
        self.assertEqual(job.job_state, "COMPLETED")
        self.assertTrue(job.closed_with_variance)
        self.assertEqual(job.completion_force_reason, "Vendor fire; 2 rolls destroyed")


class EmergencyAndBulkTests(JobWorkFixtureMixin, TestCase):
    def test_emergency_order_releases_the_job_hold_on_close(self):
        job = self.make_job("EMG", process=self.lam_process, quantity="100", uom="KG", unit_weight_g="0", fg_type="ROLL", state="RELEASED")
        roll = self.make_roll("PR-EMG-1", "100", job=job)
        order = self.create_order(job=job, mode="EMERGENCY", emergency_reason="Laminator breakdown", expected_output_kind="ROLLS")
        job.refresh_from_db()
        self.assertEqual((job.job_state, job.is_on_hold), ("PAUSED", True))
        sent = self.dispatch(order["id"], [roll])["order"]
        self.post_return(order["id"], {
            "sent_lines": [{"sent_line_id": sent["sent_lines"][0]["id"], "disposition": "PROCESSED"}],
            "output_rolls": [{"material_id": str(self.lam_film.id), "weight_kg": "98", "width_mm": "830", "thickness_micron": "62", "location_id": str(self.wip.id)}],
            "wastage": {"kg": "2"},
        })
        job.refresh_from_db()
        self.assertTrue(job.is_on_hold)  # still held until the order closes
        closed = self.api.post(f"/api/inventory/job-work/{order['id']}/close/", {"client_token": token()}, format="json")
        self.assertEqual(closed.status_code, 200, closed.data)
        self.assertEqual(closed.data["step"]["action"], "RELEASED")
        job.refresh_from_db()
        self.assertEqual((job.job_state, job.is_on_hold, job.hold_reason), ("RELEASED", False, None))

    def test_bulk_job_work_settles_through_jobwork_out_and_never_creates_stock_from_nothing(self):
        BulkService.add_bulk(material_id=str(self.granule.id), qty=Decimal("50"), plant_id=str(self.plant.id), location_id=str(self.rm.id), cost=Decimal("100"))
        order = self.create_order(expected_output_kind="BULK")
        sent = self.dispatch(order["id"], [], bulk_items=[{"material_id": str(self.granule.id), "location_id": str(self.rm.id), "quantity": "50"}])["order"]
        self.assertEqual(InventoryBulk.objects.get(material=self.granule, location=self.jw_out).qty_kg, Decimal("50.0000"))
        line = sent["sent_lines"][0]
        over = self.post_return(order["id"], {"sent_lines": [{"sent_line_id": line["id"], "disposition": "PARTLY_USED", "consumed_qty": "45", "returned_qty": "10", "location_id": str(self.rm.id)}]}, expect=400)
        self.assertIn("only 50", over["message"])
        # Someone drains JOBWORK_OUT outside the flow: the return must refuse, not add stock.
        BulkService.consume_bulk(str(self.granule.id), Decimal("50"), str(self.jw_out.id))
        before = BulkTransaction.objects.count()
        conflict = self.post_return(order["id"], {"sent_lines": [{"sent_line_id": line["id"], "disposition": "RETURNED", "location_id": str(self.rm.id)}]}, expect=409)
        self.assertIn("holds only 0 KG", conflict["message"])
        self.assertEqual(BulkTransaction.objects.count(), before)
        self.assertEqual(InventoryBulk.objects.get(material=self.granule, location=self.rm).qty_kg, Decimal("0.0000"))

    def test_bulk_partly_used_and_balance_back(self):
        BulkService.add_bulk(material_id=str(self.granule.id), qty=Decimal("50"), plant_id=str(self.plant.id), location_id=str(self.rm.id), cost=Decimal("100"))
        order = self.create_order(expected_output_kind="BULK")
        sent = self.dispatch(order["id"], [], bulk_items=[{"material_id": str(self.granule.id), "location_id": str(self.rm.id), "quantity": "50"}])["order"]
        line = sent["sent_lines"][0]
        result = self.post_return(order["id"], {
            "sent_lines": [{"sent_line_id": line["id"], "disposition": "PARTLY_USED", "consumed_qty": "40", "returned_qty": "10", "location_id": str(self.rm.id)}],
            "output_bulk": [{"material_id": str(self.granule.id), "quantity": "38", "location_id": str(self.wip.id)}],
            "wastage": {"kg": "2"},
        })
        self.assertEqual(result["order"]["status"], "RETURNED")
        self.assertEqual(InventoryBulk.objects.get(material=self.granule, location=self.jw_out).qty_kg, Decimal("0.0000"))
        self.assertEqual(InventoryBulk.objects.get(material=self.granule, location=self.rm).qty_kg, Decimal("10.0000"))
        produced = BulkTransaction.objects.get(location=self.wip, material=self.granule)
        self.assertEqual((produced.type, produced.qty_kg), ("PRODUCE", Decimal("38.0000")))


class ChallanQRAndGateTests(JobWorkFixtureMixin, TestCase):
    def test_qr_resolves_challan_and_gate_out_stamps_without_moving_stock(self):
        from apps.gate.qr import QR_HANDLERS, make_token, parse_token
        from rest_framework.exceptions import ValidationError

        roll = self.make_roll("PR-QR-1", "40")
        order = self.create_order()
        sent = self.dispatch(order["id"], [roll])
        challan = JobWorkChallan.objects.get(id=sent["challan_id"])
        kind, object_id = parse_token(make_token("JOBWORK_CHALLAN", challan.id))
        handler = QR_HANDLERS[kind]
        snapshot = handler["resolve"](object_id, self.plant)
        self.assertEqual(snapshot["kind"], "JOBWORK_CHALLAN")
        self.assertIn(challan.number, snapshot["reference"])
        self.assertEqual(snapshot["party_name"], "Vee Dee Enterprises")
        self.assertNotIn("value", str(snapshot["lines"]).lower())
        with self.assertRaises(ValidationError):
            handler["resolve"](object_id, self.other_plant)
        roll.refresh_from_db()
        before = (roll.status, roll.location_id)
        departed = timezone.now()
        handler["on_gate_out"](object_id, departed, self.watchman)
        handler["on_gate_out"](object_id, timezone.now(), self.watchman)
        challan.refresh_from_db()
        self.assertEqual(challan.gate_out_at, departed)
        roll.refresh_from_db()
        self.assertEqual((roll.status, roll.location_id), before)
        self.assertEqual(GateAuditEvent.objects.filter(object_id=order["id"], action="JW_GATE_OUT").count(), 1)

    def test_office_outward_search_finds_challans_of_the_plant_only(self):
        from apps.gate.outward_registry import OUTWARD_SEARCHES

        roll = self.make_roll("PR-SRCH-1", "40")
        order = self.create_order()
        sent = self.dispatch(order["id"], [roll], vehicle_no="GJ15AB1234")
        search = OUTWARD_SEARCHES["JOBWORK_CHALLAN"]
        found = search(self.plant, sent["challan_number"], around=timezone.now(), limit=10)
        self.assertEqual([row["id"] for row in found], [sent["challan_id"]])
        self.assertEqual(found[0]["line_count"], 1)
        self.assertNotIn("value", found[0]["lines"][0])
        self.assertEqual(search(self.plant, "", around=timezone.now(), limit=10)[0]["id"], sent["challan_id"])
        self.assertEqual(search(self.other_plant, sent["challan_number"], around=timezone.now(), limit=10), [])

    def test_challan_rows_are_immutable(self):
        roll = self.make_roll("PR-IMM-1", "40")
        order = self.create_order()
        sent = self.dispatch(order["id"], [roll])
        challan = JobWorkChallan.objects.get(id=sent["challan_id"])
        challan.purpose = "Edited"
        with self.assertRaises(TypeError):
            challan.save()
        with self.assertRaises(TypeError):
            challan.delete()
        line = challan.lines.get()
        with self.assertRaises(TypeError):
            line.save(update_fields=["value"])


class ScrapReasonMigrationTests(TestCase):
    def test_jobwork_waste_reason_is_created_once(self):
        from importlib import import_module

        from django.apps import apps as django_apps

        migration = import_module("apps.production.migrations.0074_jobwork_waste_scrap_reason")
        ScrapReason.objects.filter(code="JOBWORK_WASTE").delete()
        migration.add_jobwork_waste_reason(django_apps, None)
        migration.add_jobwork_waste_reason(django_apps, None)
        self.assertEqual(ScrapReason.objects.filter(code="JOBWORK_WASTE").count(), 1)


class OverdueReminderTests(JobWorkFixtureMixin, TestCase):
    def test_overdue_and_itc04_alerts_are_published_once(self):
        from datetime import timedelta

        from apps.inventory.models import JobWorkSentLine
        from apps.inventory.services.job_work_integrations import run_jobwork_overdue_reminders
        from apps.users.models import Notification

        roll = self.make_roll("PR-OD-1", "40")
        order = self.create_order()
        self.dispatch(order["id"], [roll])
        JobWorkOrder.objects.filter(id=order["id"]).update(expected_return_date=timezone.localdate() - timedelta(days=3))
        JobWorkSentLine.objects.filter(order_id=order["id"]).update(sent_at=timezone.now() - timedelta(days=310))
        stats = run_jobwork_overdue_reminders()
        self.assertEqual((stats["overdue"], stats["itc04"]), (1, 1))
        notices = Notification.objects.filter(event_key="jobwork.return_overdue")
        recipients = set(notices.values_list("user_id", flat=True))
        self.assertIn(self.store.id, recipients)
        self.assertIn(self.owner.id, recipients)
        self.assertNotIn(self.planner.id, recipients)
        self.assertNotIn(self.watchman.id, recipients)
        count = notices.count()
        from apps.inventory.tasks import jobwork_overdue_task

        jobwork_overdue_task()
        self.assertEqual(notices.count(), count)
        self.assertEqual(set(notices.values_list("priority", flat=True)), {"NORMAL", "HIGH"})
        listing = self.api.get("/api/inventory/job-work/", {"tab": "OVERDUE"})
        self.assertEqual([row["id"] for row in listing.data["results"]], [order["id"]])
        self.assertTrue(listing.data["results"][0]["itc04_alert"])
        report = self.api.get("/api/inventory/job-work/reports/at-vendor/")
        self.assertEqual(report.status_code, 200)
        self.assertEqual(report.data["rows"][0]["buckets"]["301_365"], "40")
