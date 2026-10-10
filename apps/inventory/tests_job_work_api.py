"""Job-work API: permissions, validation, idempotency, state conflicts,
cross-plant refusal, GRN refusal and Owner legacy reconciliation."""
from datetime import timedelta
from decimal import Decimal

from django.test import TestCase
from django.utils import timezone

from apps.gate.models import GateAuditEvent
from apps.inventory.models import (
    BulkTransaction,
    InventoryRoll,
    JobWorkChallan,
    JobWorkOrder,
    JobWorkReturn,
    JobWorkSentLine,
    JobWorkSettlement,
    RollLink,
    RollMovement,
    Vendor,
)

from .tests_job_work_base import JobWorkFixtureMixin, token


class JobWorkPermissionTests(JobWorkFixtureMixin, TestCase):
    def test_read_matrix(self):
        expected = {
            self.store: 200, self.planner: 200, self.owner: 200, self.desk_user: 200, self.extra_user: 200,
            self.sales: 403, self.watchman: 403,
        }
        for user, code in expected.items():
            with self.subTest(user=user.username):
                self.assertEqual(self.client_for(user).get("/api/inventory/job-work/").status_code, code)

    def test_write_matrix(self):
        expected = {
            self.store: 201, self.owner: 201, self.desk_user: 201, self.extra_user: 201,
            self.planner: 403, self.sales: 403, self.watchman: 403,
        }
        for user, code in expected.items():
            with self.subTest(user=user.username):
                payload = {"client_token": token(), "plant": str(self.plant.id), "vendor": str(self.vendor.id), "mode": "EMERGENCY", "emergency_reason": "Breakdown", "expected_output_kind": "ROLLS"}
                response = self.client_for(user).post("/api/inventory/job-work/", payload, format="json")
                self.assertEqual(response.status_code, code, response.data)
        self.assertEqual(JobWorkOrder.objects.count(), 4)

    def test_eligible_jobs_are_listed_for_inventory_accounts_under_strict_rbac(self):
        paused = self.make_job("ELIG-1")
        done = self.make_job("ELIG-2", state="COMPLETED")
        with self.settings(STRICT_RBAC=True):
            response = self.client_for(self.store).get("/api/inventory/job-work/eligible-jobs/")
            self.assertEqual(response.status_code, 200, response.data)
            rows = {row["job_number"]: row for row in response.data["results"]}
            self.assertIn(paused.job_number, rows)
            self.assertNotIn(done.job_number, rows, "completed jobs cannot go to job work")
            row = rows[paused.job_number]
            self.assertEqual((row["process_code"], row["uom"], row["quantity"], row["plant_name"], row["work_center_name"]), ("POUCH_JOBWORK", "PCS", "28825", "Dabhel", "Pouching JW"))
            self.assertEqual(self.client_for(self.store).get("/api/inventory/job-work/eligible-jobs/", {"search": "nothing-matches"}).data["results"], [])
            for user in (self.sales, self.watchman):
                self.assertEqual(self.client_for(user).get("/api/inventory/job-work/eligible-jobs/").status_code, 403, user.username)

    def test_planner_can_read_detail_but_not_dispatch_or_close(self):
        roll = self.make_roll("PR-PERM-1", "40")
        order = self.create_order()
        planner = self.client_for(self.planner)
        detail = planner.get(f"/api/inventory/job-work/{order['id']}/")
        self.assertEqual(detail.status_code, 200)
        self.assertFalse(detail.data["permissions"]["can_manage"])
        self.assertFalse(detail.data["actions"]["can_dispatch"])
        denied = planner.post(f"/api/inventory/job-work/{order['id']}/dispatch/", {"client_token": token(), "rolls": [{"roll_id": str(roll.id)}], "hsn_code": "3920"}, format="json")
        self.assertEqual(denied.status_code, 403)
        roll.refresh_from_db()
        self.assertEqual(roll.status, "AVAILABLE")

    def test_legacy_reconciliation_is_owner_only(self):
        for user in [self.store, self.planner, self.desk_user]:
            self.assertEqual(self.client_for(user).get("/api/inventory/job-work/legacy/").status_code, 403)
        self.assertEqual(self.client_for(self.owner).get("/api/inventory/job-work/legacy/").status_code, 200)

    def test_bill_link_needs_bill_receiving_rights(self):
        roll = self.make_roll("PR-BILLP-1", "40")
        order = self.create_order(client=self.client_for(self.desk_user))
        sent = self.dispatch(order["id"], [roll], client=self.client_for(self.desk_user))["order"]
        payload = {"client_token": token(), "sent_lines": [{"sent_line_id": sent["sent_lines"][0]["id"], "disposition": "RETURNED", "location_id": str(self.rm.id)}], "bill": {"bill_id": str(roll.id)}}
        response = self.client_for(self.desk_user).post(f"/api/inventory/job-work/{order['id']}/returns/", payload, format="json")
        self.assertEqual(response.status_code, 403)
        self.assertFalse(JobWorkReturn.objects.exists())


class JobWorkValidationTests(JobWorkFixtureMixin, TestCase):
    def test_create_validation_messages(self):
        bad = self.api.post("/api/inventory/job-work/", {"client_token": token(), "vendor": str(self.vendor.id), "expected_output_kind": "ROLLS", "mode": "EMERGENCY", "plant": str(self.plant.id)}, format="json")
        self.assertEqual(bad.status_code, 400)
        self.assertIn("emergency_reason", bad.data["field_errors"])
        rm_vendor = Vendor.objects.create(code="RMONLY", name="Film supplier", type="RM")
        wrong_vendor = self.api.post("/api/inventory/job-work/", {"client_token": token(), "vendor": str(rm_vendor.id), "plant": str(self.plant.id), "mode": "EMERGENCY", "emergency_reason": "x", "expected_output_kind": "ROLLS"}, format="json")
        self.assertEqual(wrong_vendor.status_code, 400)
        self.assertIn("vendor", wrong_vendor.data["field_errors"])
        no_token = self.api.post("/api/inventory/job-work/", {"vendor": str(self.vendor.id), "plant": str(self.plant.id), "mode": "EMERGENCY", "emergency_reason": "x", "expected_output_kind": "ROLLS"}, format="json")
        self.assertEqual(no_token.status_code, 400)
        fg_without_job = self.api.post("/api/inventory/job-work/", {"client_token": token(), "vendor": str(self.vendor.id), "plant": str(self.plant.id), "mode": "EMERGENCY", "emergency_reason": "x", "expected_output_kind": "FG_PCS"}, format="json")
        self.assertEqual(fg_without_job.status_code, 400)

    def test_one_open_order_per_job_and_job_plant_wins(self):
        job = self.make_job("ONE")
        self.create_order(job=job)
        duplicate = self.api.post("/api/inventory/job-work/", {"client_token": token(), "vendor": str(self.vendor.id), "production_job": str(job.id), "mode": "PLANNED_STEP", "expected_output_kind": "FG_PCS"}, format="json")
        self.assertEqual(duplicate.status_code, 400)
        self.assertIn("already has open job-work order", duplicate.data["message"])
        other = self.make_job("TWO")
        mismatch = self.api.post("/api/inventory/job-work/", {"client_token": token(), "vendor": str(self.vendor.id), "production_job": str(other.id), "plant": str(self.other_plant.id), "mode": "PLANNED_STEP", "expected_output_kind": "FG_PCS"}, format="json")
        self.assertEqual(mismatch.status_code, 400)
        self.assertIn("runs at Dabhel", mismatch.data["message"])

    def test_dispatch_refuses_other_plant_rolls_and_sent_rolls(self):
        order = self.create_order()
        foreign = self.make_roll("PR-FOREIGN", "40", plant=self.other_plant)
        response = self.dispatch(order["id"], [foreign], expect=400)
        self.assertIn("Kachigam", response["message"])
        mine = self.make_roll("PR-MINE", "40")
        self.dispatch(order["id"], [mine])
        again = self.dispatch(order["id"], [mine], expect=400)
        self.assertIn("already at a job worker", again["message"])
        self.assertEqual(JobWorkChallan.objects.count(), 1)

    def test_dispatch_requires_value_and_hsn(self):
        order = self.create_order()
        roll = self.make_roll("PR-NOVAL", "40", rate="0")
        no_value = self.dispatch(order["id"], [roll], expect=400)
        self.assertIn("Enter the value", no_value["message"])
        no_hsn = self.api.post(f"/api/inventory/job-work/{order['id']}/dispatch/", {"client_token": token(), "rolls": [{"roll_id": str(roll.id), "value": "500"}]}, format="json")
        self.assertEqual(no_hsn.status_code, 400)
        self.assertIn("HSN", no_hsn.data["message"])
        bad_hsn = self.api.post(f"/api/inventory/job-work/{order['id']}/dispatch/", {"client_token": token(), "rolls": [{"roll_id": str(roll.id), "value": "500"}], "hsn_code": "39A"}, format="json")
        self.assertEqual(bad_hsn.status_code, 400)
        ok = self.api.post(f"/api/inventory/job-work/{order['id']}/dispatch/", {"client_token": token(), "rolls": [{"roll_id": str(roll.id), "value": "500", "hsn_code": "39219099"}]}, format="json")
        self.assertEqual(ok.status_code, 201, ok.data)
        line = JobWorkSentLine.objects.get()
        self.assertEqual((line.value, line.hsn_code), (Decimal("500.00"), "39219099"))

    def test_return_refuses_other_plant_location_and_foreign_sent_lines(self):
        roll = self.make_roll("PR-LOC-1", "40")
        order = self.create_order()
        sent = self.dispatch(order["id"], [roll])["order"]
        line_id = sent["sent_lines"][0]["id"]
        wrong_location = self.post_return(order["id"], {"sent_lines": [{"sent_line_id": line_id, "disposition": "RETURNED", "location_id": str(self.other_rm.id)}]}, expect=400)
        self.assertIn("Kachigam", wrong_location["message"])
        other_order = self.create_order()
        foreign = self.post_return(other_order["id"], {"sent_lines": [{"sent_line_id": line_id, "disposition": "PROCESSED"}]}, expect=409)
        self.assertIn("Nothing has been sent", foreign["message"])
        nothing = self.post_return(order["id"], {}, expect=400)
        self.assertIn("Record what came back", nothing["message"])
        self.assertFalse(JobWorkReturn.objects.exists())

    def test_partly_used_remainder_must_be_less_than_the_roll(self):
        roll = self.make_roll("PR-REM-1", "40")
        order = self.create_order()
        sent = self.dispatch(order["id"], [roll])["order"]
        too_big = self.post_return(order["id"], {"sent_lines": [{"sent_line_id": sent["sent_lines"][0]["id"], "disposition": "PARTLY_USED", "returned_qty": "40", "location_id": str(self.rm.id)}]}, expect=400)
        self.assertIn("less than 40", too_big["message"])

    def test_fg_pieces_need_a_job(self):
        roll = self.make_roll("PR-FGJ-1", "40")
        order = self.create_order()
        sent = self.dispatch(order["id"], [roll])["order"]
        refused = self.post_return(order["id"], {"sent_lines": [{"sent_line_id": sent["sent_lines"][0]["id"], "disposition": "PROCESSED"}], "fg": {"qty_pcs": 100, "location_id": str(self.fg.id)}}, expect=400)
        self.assertIn("production job", refused["message"])


class JobWorkIdempotencyTests(JobWorkFixtureMixin, TestCase):
    def test_same_token_replays_and_changed_payload_conflicts(self):
        rolls = [self.make_roll(f"PR-IDEM-{i}", "40") for i in range(2)]
        order = self.create_order()
        dispatch_token = token()
        payload = {"client_token": dispatch_token, "rolls": [{"roll_id": str(rolls[0].id)}], "hsn_code": "3920"}
        first = self.api.post(f"/api/inventory/job-work/{order['id']}/dispatch/", payload, format="json")
        replay = self.api.post(f"/api/inventory/job-work/{order['id']}/dispatch/", payload, format="json")
        self.assertEqual((first.status_code, replay.status_code), (201, 200))
        self.assertTrue(replay.data["replayed"])
        self.assertEqual(first.data["challan_id"], replay.data["challan_id"])
        changed = self.api.post(f"/api/inventory/job-work/{order['id']}/dispatch/", {**payload, "rolls": [{"roll_id": str(rolls[1].id)}]}, format="json")
        self.assertEqual(changed.status_code, 409)
        self.assertEqual(JobWorkChallan.objects.count(), 1)

        line_id = first.data["order"]["sent_lines"][0]["id"]
        return_payload = {"client_token": token(), "sent_lines": [{"sent_line_id": line_id, "disposition": "PROCESSED"}], "output_rolls": [{"material_id": str(self.lam_film.id), "weight_kg": "39", "width_mm": "830", "thickness_micron": "30", "location_id": str(self.wip.id)}], "wastage": {"kg": "1"}}
        done = self.api.post(f"/api/inventory/job-work/{order['id']}/returns/", return_payload, format="json")
        again = self.api.post(f"/api/inventory/job-work/{order['id']}/returns/", return_payload, format="json")
        self.assertEqual((done.status_code, again.status_code), (201, 200), again.data)
        self.assertEqual(done.data["return_id"], again.data["return_id"])
        self.assertEqual(JobWorkReturn.objects.count(), 1)
        self.assertEqual(InventoryRoll.objects.filter(material=self.lam_film).count(), 1)
        mutated = self.api.post(f"/api/inventory/job-work/{order['id']}/returns/", {**return_payload, "wastage": {"kg": "2"}}, format="json")
        self.assertEqual(mutated.status_code, 409)
        second_try = self.api.post(f"/api/inventory/job-work/{order['id']}/returns/", {**return_payload, "client_token": token()}, format="json")
        self.assertEqual(second_try.status_code, 409)
        self.assertIn("already settled", second_try.data["message"])

        close_token = token()
        closed = self.api.post(f"/api/inventory/job-work/{order['id']}/close/", {"client_token": close_token}, format="json")
        replayed = self.api.post(f"/api/inventory/job-work/{order['id']}/close/", {"client_token": close_token}, format="json")
        self.assertEqual((closed.status_code, replayed.status_code), (200, 200))
        self.assertTrue(replayed.data["replayed"])
        self.assertEqual(GateAuditEvent.objects.filter(object_id=order["id"], action="JW_CLOSED").count(), 1)
        late = self.api.post(f"/api/inventory/job-work/{order['id']}/close/", {"client_token": token()}, format="json")
        self.assertEqual(late.status_code, 409)

    def test_create_replay_returns_the_same_order(self):
        payload = {"client_token": token(), "plant": str(self.plant.id), "vendor": str(self.vendor.id), "mode": "EMERGENCY", "emergency_reason": "Breakdown", "expected_output_kind": "ROLLS"}
        first = self.api.post("/api/inventory/job-work/", payload, format="json")
        again = self.api.post("/api/inventory/job-work/", payload, format="json")
        self.assertEqual((first.status_code, again.status_code), (201, 200))
        self.assertEqual(first.data["order"]["id"], again.data["order"]["id"])
        self.assertEqual(JobWorkOrder.objects.count(), 1)


class JobWorkStateTests(JobWorkFixtureMixin, TestCase):
    def test_cancel_only_drafts_and_releases_emergency_job(self):
        job = self.make_job("CANC", state="RELEASED", process=self.lam_process, uom="KG", quantity="50", unit_weight_g="0", fg_type="ROLL")
        order = self.create_order(job=job, mode="EMERGENCY", emergency_reason="Breakdown", expected_output_kind="ROLLS")
        job.refresh_from_db()
        self.assertTrue(job.is_on_hold)
        short = self.api.post(f"/api/inventory/job-work/{order['id']}/cancel/", {"client_token": token(), "reason": ""}, format="json")
        self.assertEqual(short.status_code, 400)
        cancelled = self.api.post(f"/api/inventory/job-work/{order['id']}/cancel/", {"client_token": token(), "reason": "Machine repaired"}, format="json")
        self.assertEqual(cancelled.status_code, 200, cancelled.data)
        self.assertEqual(cancelled.data["order"]["status"], "CANCELLED")
        job.refresh_from_db()
        self.assertEqual((job.job_state, job.is_on_hold), ("RELEASED", False))
        roll = self.make_roll("PR-CANC-1", "30")
        sent_order = self.create_order()
        self.dispatch(sent_order["id"], [roll])
        refused = self.api.post(f"/api/inventory/job-work/{sent_order['id']}/cancel/", {"client_token": token(), "reason": "Changed mind"}, format="json")
        self.assertEqual(refused.status_code, 409)
        draft_close = self.api.post(f"/api/inventory/job-work/{order['id']}/dispatch/", {"client_token": token(), "rolls": [{"roll_id": str(roll.id)}], "hsn_code": "3920"}, format="json")
        self.assertEqual(draft_close.status_code, 409)

    def test_list_filters_search_and_open_orders_for_bill(self):
        roll = self.make_roll("PR-LIST-1", "30")
        sent_order = self.create_order()
        challan = self.dispatch(sent_order["id"], [roll])["challan_number"]
        draft = self.create_order()
        listing = self.api.get("/api/inventory/job-work/", {"tab": "OPEN"})
        self.assertEqual(listing.data["count"], 2)
        self.assertEqual(listing.data["tab_counts"]["AT_VENDOR"], 1)
        at_vendor = self.api.get("/api/inventory/job-work/", {"tab": "AT_VENDOR"})
        self.assertEqual([row["id"] for row in at_vendor.data["results"]], [sent_order["id"]])
        self.assertEqual(at_vendor.data["results"][0]["at_vendor_kg"], "30")
        by_challan = self.api.get("/api/inventory/job-work/", {"search": challan})
        self.assertEqual([row["id"] for row in by_challan.data["results"]], [sent_order["id"]])
        by_number = self.api.get("/api/inventory/job-work/", {"search": draft["number"]})
        self.assertEqual([row["id"] for row in by_number.data["results"]], [draft["id"]])
        open_orders = self.api.get("/api/inventory/job-work/open-orders/", {"vendor": str(self.vendor.id)})
        self.assertEqual([row["id"] for row in open_orders.data["results"]], [sent_order["id"]])
        self.assertEqual(self.api.get("/api/inventory/job-work/", {"page_size": "500"}).status_code, 400)

    def test_vendor_rate_card_and_yield_report(self):
        saved = self.api.post("/api/inventory/job-work/vendor-rates/", {"client_token": token(), "vendor": str(self.vendor.id), "process_code": "lam_jobwork", "rate": "9.25", "uom": "KG"}, format="json")
        self.assertEqual(saved.status_code, 201, saved.data)
        self.vendor.refresh_from_db()
        self.assertIn({"process_code": "LAM_JOBWORK", "rate": "9.25", "uom": "KG"}, self.vendor.jobwork_rates)
        bad = self.api.post("/api/inventory/job-work/vendor-rates/", {"client_token": token(), "vendor": str(self.vendor.id), "process_code": "NOPE", "rate": "1", "uom": "KG"}, format="json")
        self.assertEqual(bad.status_code, 400)
        planner = self.client_for(self.planner).post("/api/inventory/job-work/vendor-rates/", {"client_token": token(), "vendor": str(self.vendor.id), "process_code": "LAM_JOBWORK", "rate": "1", "uom": "KG"}, format="json")
        self.assertEqual(planner.status_code, 403)
        order = self.create_order(process=str(self.lam_process.id))
        self.assertEqual((order["rate"], order["rate_uom"]), ("9.25", "KG"))
        roll = self.make_roll("PR-YIELD-1", "100")
        sent = self.dispatch(order["id"], [roll])["order"]
        self.post_return(order["id"], {"sent_lines": [{"sent_line_id": sent["sent_lines"][0]["id"], "disposition": "PROCESSED"}], "output_rolls": [{"material_id": str(self.lam_film.id), "weight_kg": "96", "width_mm": "830", "thickness_micron": "40", "location_id": str(self.wip.id)}], "wastage": {"kg": "4"}})
        report = self.api.get("/api/inventory/job-work/reports/yield/")
        row = report.data["rows"][0]
        self.assertEqual((row["vendor_name"], row["output_kg"], row["wastage_pct"], row["yield_pct"]), ("Vee Dee Enterprises", "96", "4", "96"))


class GrnJobWorkRefusalTests(JobWorkFixtureMixin, TestCase):
    def test_smart_grn_refuses_job_work_source(self):
        payload = {
            "klass": "BULK", "source_type": "JOBWORK", "vendor_id": str(self.other_vendor.id), "vendor_invoice_no": "LW/0001",
            "store_location_id": str(self.rm.id), "lines": [{"material_id": str(self.granule.id), "qty": "25", "unit_cost": "4", "uom": "KG"}],
        }
        response = self.api.post("/api/inventory/grn/create/", payload, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("Job work", str(response.data))
        self.assertFalse(BulkTransaction.objects.exists())
        for path in ["/api/inventory/grn/bulk/", "/api/inventory/grn/roll/", "/api/inventory/grn/packaging/"]:
            self.assertEqual(self.api.post(path, {**payload, "source_type": "jobwork"}, format="json").status_code, 400)
        payload["source_type"] = "DIRECT"
        direct = self.api.post("/api/inventory/grn/create/", payload, format="json"); self.assertEqual(direct.status_code, 201, direct.data)


class LegacyReconciliationTests(JobWorkFixtureMixin, TestCase):
    """Rolls left SENT_JOBWORK in JOBWORK_OUT by the pre-upgrade flow."""

    def setUp(self):
        super().setUp()
        self.job = self.make_job("LEG", process=self.lam_process, uom="KG", quantity="200", unit_weight_g="0", fg_type="ROLL")
        self.legacy = JobWorkOrder.objects.create(
            number="JWO-L-000001", plant=self.plant, vendor=self.vendor, vendor_name=self.vendor.name, production_job=self.job,
            mode="PLANNED_STEP", status="PARTLY_RETURNED", dispatched_at=timezone.now() - timedelta(days=20), received_at=timezone.now() - timedelta(days=5),
        )
        JobWorkOrder.objects.filter(id=self.legacy.id).update(created_at=timezone.now() - timedelta(days=21))
        self.stuck = []
        for index in range(2):
            roll = self.make_roll(f"PR-LEG-{index}", "100", job=self.job, location=self.jw_out, status="SENT_JOBWORK")
            RollMovement.objects.create(roll=roll, from_location=self.rm, to_location=self.jw_out, reason="JOBWORK", reason_note=f"JW-OUT: {self.vendor.name}")
            self.stuck.append(roll)
        self.output = self.make_roll("OUT-LEG-1", "95", location=self.wip, material=self.lam_film)
        InventoryRoll.objects.filter(id=self.output.id).update(batch_no=f"JW-{self.legacy.id}")
        self.owner_api = self.client_for(self.owner)

    def test_legacy_list_reconcile_consume_and_return_then_close(self):
        listing = self.owner_api.get("/api/inventory/job-work/legacy/")
        row = next(r for r in listing.data["rows"] if r["order"] and r["order"]["id"] == str(self.legacy.id))
        self.assertEqual({r["label_id"] for r in row["rolls"]}, {"PR-LEG-0", "PR-LEG-1"})
        self.assertEqual([o["label_id"] for o in row["output_candidates"]], ["OUT-LEG-1"])
        blocked = self.api.post(f"/api/inventory/job-work/{self.legacy.id}/close/", {"client_token": token()}, format="json")
        self.assertEqual(blocked.status_code, 409)
        self.assertIn("before the upgrade", blocked.data["message"])

        consume_token = token()
        payload = {"client_token": consume_token, "order_id": str(self.legacy.id), "action": "CONSUME", "roll_ids": [str(self.stuck[0].id)], "output_roll_ids": [str(self.output.id)], "reason": "Vendor confirmed roll used for laminate OUT-LEG-1"}
        done = self.owner_api.post("/api/inventory/job-work/legacy/reconcile/", payload, format="json")
        self.assertEqual(done.status_code, 201, done.data)
        replay = self.owner_api.post("/api/inventory/job-work/legacy/reconcile/", payload, format="json")
        self.assertEqual(replay.status_code, 200)
        self.assertTrue(replay.data["replayed"])
        self.stuck[0].refresh_from_db()
        self.assertEqual((self.stuck[0].status, self.stuck[0].weight_kg), ("CONSUMED", Decimal("0")))
        self.assertTrue(RollLink.objects.filter(parent_roll=self.stuck[0], child_roll=self.output, relation_type="PROCESS_OUTPUT").exists())
        self.assertEqual(JobWorkSentLine.objects.filter(order=self.legacy, is_legacy=True).count(), 1)

        store_attempt = self.api.post("/api/inventory/job-work/legacy/reconcile/", {**payload, "client_token": token(), "roll_ids": [str(self.stuck[1].id)]}, format="json")
        self.assertEqual(store_attempt.status_code, 403)
        missing_location = self.owner_api.post("/api/inventory/job-work/legacy/reconcile/", {"client_token": token(), "order_id": str(self.legacy.id), "action": "RETURN", "roll_ids": [str(self.stuck[1].id)], "reason": "Came back last month"}, format="json")
        self.assertEqual(missing_location.status_code, 400)
        returned = self.owner_api.post("/api/inventory/job-work/legacy/reconcile/", {"client_token": token(), "order_id": str(self.legacy.id), "action": "RETURN", "roll_ids": [str(self.stuck[1].id)], "location_id": str(self.rm.id), "reason": "Came back last month, never booked"}, format="json")
        self.assertEqual(returned.status_code, 201, returned.data)
        self.stuck[1].refresh_from_db()
        self.assertEqual((self.stuck[1].status, self.stuck[1].location_id), ("AVAILABLE", self.rm.id))
        already = self.owner_api.post("/api/inventory/job-work/legacy/reconcile/", {"client_token": token(), "order_id": str(self.legacy.id), "action": "RETURN", "roll_ids": [str(self.stuck[1].id)], "location_id": str(self.rm.id), "reason": "Again by mistake"}, format="json")
        self.assertEqual(already.status_code, 409)
        self.assertFalse(InventoryRoll.objects.filter(location=self.jw_out, status="SENT_JOBWORK").exists())
        self.assertEqual(JobWorkSettlement.objects.filter(order=self.legacy, source="RECONCILE").count(), 2)
        self.assertEqual(GateAuditEvent.objects.filter(object_id=self.legacy.id, action="JW_RECONCILED").count(), 2)
        self.legacy.refresh_from_db()
        self.assertEqual(self.legacy.status, "RETURNED")
        closed = self.api.post(f"/api/inventory/job-work/{self.legacy.id}/close/", {"client_token": token(), "step_force_reason": "Legacy order closed after reconciliation"}, format="json")
        self.assertEqual(closed.status_code, 200, closed.data)

    def test_new_orders_never_attract_legacy_rolls(self):
        order = self.create_order()
        detail = self.api.get(f"/api/inventory/job-work/{order['id']}/")
        self.assertEqual(detail.data["legacy"]["stuck_rolls"], 0)
        legacy_detail = self.api.get(f"/api/inventory/job-work/{self.legacy.id}/")
        self.assertEqual(legacy_detail.data["legacy"]["stuck_rolls"], 2)
        self.assertFalse(legacy_detail.data["actions"]["can_receive"])

    def test_data_migration_backfills_numbers_and_status(self):
        from importlib import import_module

        from django.apps import apps as django_apps

        migration = import_module("apps.inventory.migrations.0055_backfill_job_work_numbers")
        JobWorkOrder.objects.filter(id=self.legacy.id).update(number="", status="PARTIAL")
        older = JobWorkOrder.objects.create(plant=self.plant, vendor=self.vendor, vendor_name=self.vendor.name, status="SENT")
        JobWorkOrder.objects.filter(id=older.id).update(number="", created_at=timezone.now() - timedelta(days=60))
        migration.forwards(django_apps, None)
        self.legacy.refresh_from_db()
        older.refresh_from_db()
        self.assertEqual((older.number, self.legacy.number), ("JWO-L-000001", "JWO-L-000002"))
        self.assertEqual(self.legacy.status, "PARTLY_RETURNED")
