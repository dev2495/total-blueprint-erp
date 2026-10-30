"""Reported 30 Oct 2026 on live (WC terminal, SO-2026-0550-f8dd-B01-1):

- One 264 kg roll allocated against a 180 kg step, yet release read "Roll shortage: 1 more roll(s)
  required": the queue's material flag was computed before the roll was added and never refreshed,
  and it used a different roll rule than the release check.
- A step closed short left every later step at the full order quantity and the unmade part of the
  order nowhere (SO-2026-0669 printing closed at 0, its next step still asked for 30,000 pcs).

Now: one roll gate for the satisfaction status, the queue flag and release; a short close cuts
the later steps to what was made and queues the balance at the same step as a new batch.
"""
from decimal import Decimal
from unittest.mock import patch

from django.test import override_settings

from apps.inventory.models import InventoryReservation
from apps.production.models import ProductionBatch, ProductionJob, WorkCenterAssignment
from apps.production.services import queue_enrichment
from apps.production.services.job_services import JobService, WCManagerService
from apps.production.services.operator_service import OperatorService
from apps.production.services.partial_balance import PartialBalanceService
from apps.production.services.services_execution import ExecutionService
from apps.production.tests import test_route_family_walkthroughs as walkthroughs

D = Decimal


class PartialBalanceFlowTests(walkthroughs.RouteFamilyWalkthroughTests):
    # Reuse the route-family fixture and helpers, not its walkthroughs.
    test_purchased_two_ply_printed_pouch = None
    test_three_ply_printed_two_lamination_passes = None
    test_purchased_two_ply_plain_lamination_first = None
    test_courier_bag_from_extruded_rolls = None

    def _printed_order(self):
        template = self._route("BAL 2 PLY PRT", ["PRT", "Lam", "Slt", "Pch"])
        layers = [self._layer(self.pet, 12, 1.40), self._layer(self.ld_bought, 50, 0.92)]
        return self._order(template, layers, printed=True)

    def _print_short(self, job, share):
        """Run printing on one roll carrying only `share` of the step target."""
        target = self._target(job)
        roll = self._raw_roll(self.pet, 12, (target * share).quantize(D("0.01")) + D("1"), f"RAW-SHORT-{job.job_number}")
        self._run(job, roll_ids=[roll.id])
        out = (target * share).quantize(D("0.01"))
        OperatorService.log_output_step(str(job.id), float(out), self.user, roll_outputs=[{"weight_kg": str(out), "width_mm": 989}])
        return target, out

    def test_short_close_cuts_later_steps_and_queues_the_balance(self):
        item, jobs = self._printed_order()
        prt = jobs["step_1_PRT"]
        target, made = self._print_short(prt, D("0.4"))
        closed = JobService.complete_step(prt, user=self.user, force_reason="Film ran out", requeue_balance=True)

        self.assertTrue(closed.closed_with_variance)
        balance = closed._partial_balance
        self.assertIsNotNone(balance)
        order_qty = D(str(item.qty_value))
        balance_qty = D(str(balance["qty"]))
        self.assertAlmostEqual(float(balance_qty / order_qty), 0.6, delta=0.01)

        # Later steps of the first batch make only what printing made.
        for node in ("step_2_Lam", "step_3_Slt", "step_4_Pch"):
            row = ProductionJob.objects.get(id=jobs[node].id)
            self.assertEqual(row.quantity, order_qty - balance_qty, node)
            self.assertEqual(row.meta_json["quantity_basis"], "JOB")
            self.assertEqual(row.meta_json["quantity_reduced"]["by_job"], prt.job_number)

        # The balance is a new batch of the same line: every step from printing on.
        batch = ProductionBatch.objects.get(batch_number=balance["batch_number"])
        self.assertEqual(batch.sales_order_item_id, item.id)
        self.assertEqual(batch.parent_batch_id, prt.production_batch_id)
        self.assertEqual(batch.planned_qty, balance_qty)
        balance_jobs = {j.route_node_id: j for j in ProductionJob.objects.filter(production_batch=batch)}
        self.assertEqual(set(balance_jobs), {"step_1_PRT", "step_2_Lam", "step_3_Slt", "step_4_Pch"})
        first = balance_jobs["step_1_PRT"]
        self.assertEqual(first.job_state, "RELEASED")
        self.assertTrue(WorkCenterAssignment.objects.filter(production_job=first, work_center=prt.work_center).exists(), "back in the same WC queue")
        self.assertEqual(first.meta_json["partial_balance"]["of_job"], prt.job_number)
        for node in ("step_2_Lam", "step_3_Slt", "step_4_Pch"):
            self.assertEqual(balance_jobs[node].job_state, "WAITING")
            self.assertEqual(balance_jobs[node].quantity, balance_qty)
        self.assertEqual(ProductionBatch.objects.get(id=prt.production_batch_id).planned_qty, order_qty - balance_qty)

        # The balance printing step takes plant film again; its own quantity sets its target.
        fresh = self._raw_roll(self.pet, 12, 500, "RAW-BALANCE-PET")
        self.assertIn(fresh.label_id, self._pool(first))
        self.assertAlmostEqual(float(self._target(first)), float(target) * 0.6, delta=float(target) * 0.02)

        # The cut-down pouching step targets its own pieces, not the whole line.
        pch = ProductionJob.objects.get(id=jobs["step_4_Pch"].id)
        profile = ExecutionService.get_step_execution_profile(str(pch.id), job=pch)
        self.assertEqual(profile["target_source"], "V2_FINAL_STEP_PARTIAL_REPLAN_TARGET")
        self.assertAlmostEqual(profile["step_target_total_kg"], float(D(str(pch.quantity)) * D(str(item.unit_weight_g)) / 1000), delta=0.05)

        item.refresh_from_db()
        self.assertNotEqual(item.line_status, "PARTIAL")

    def test_nothing_made_retires_later_steps_and_queues_everything(self):
        item, jobs = self._printed_order()
        prt = jobs["step_1_PRT"]
        roll = self._raw_roll(self.pet, 12, 50, "RAW-NONE")
        self._run(prt, roll_ids=[roll.id])
        closed = JobService.complete_step(prt, user=self.user, force_reason="Wrong cylinder, stopped", requeue_balance=True)

        self.assertEqual(D(str(closed._partial_balance["qty"])), D(str(item.qty_value)))
        for node in ("step_2_Lam", "step_3_Slt", "step_4_Pch"):
            row = ProductionJob.objects.get(id=jobs[node].id)
            self.assertEqual(row.job_state, "CANCELLED", node)
        roll.refresh_from_db()
        self.assertEqual(roll.status, "AVAILABLE", "the untouched roll is free for the balance")
        self.assertFalse(InventoryReservation.objects.filter(roll=roll, status="ACTIVE").exists())

    def test_without_requeue_a_short_close_keeps_the_old_behaviour(self):
        item, jobs = self._printed_order()
        prt = jobs["step_1_PRT"]
        self._print_short(prt, D("0.4"))
        closed = JobService.complete_step(prt, user=self.user, force_reason="Customer wants partial", requeue_balance=False)
        self.assertIsNone(closed._partial_balance)
        self.assertEqual(ProductionBatch.objects.filter(sales_order_item=item).count(), 1)
        self.assertEqual(ProductionJob.objects.get(id=jobs["step_2_Lam"].id).quantity, D(str(item.qty_value)))

    def test_final_step_short_close_keeps_the_line_running(self):
        template = self._route("BAL SIDE SEAL", ["SS"])
        item, jobs = self._order(template, [self._layer(self.ld_bought, 50, 0.92)], printed=False, qty=D("20000"))
        ss = jobs["step_1_SS"]
        target = self._target(ss)
        roll = self._raw_roll(self.ld_bought, 50, (target * D("0.5")).quantize(D("0.01")), "RAW-SS-HALF")
        self._run(ss, roll_ids=[roll.id])

        # A short load is a partial run, not a gate: the queue flag and release agree.
        readiness = ExecutionService.roll_readiness(ss)
        self.assertEqual(readiness["mode"], "MASS")
        self.assertEqual(readiness["rolls_missing"], 0)
        self.assertEqual(queue_enrichment._material_block(ss), (False, ""))

        pcs = int(D(str(item.qty_value)) * D("0.45"))
        kg = (D(pcs) * D(str(item.unit_weight_g)) / 1000).quantize(D("0.001"))
        OperatorService.log_output_step(str(ss.id), float(kg), self.user, output_pcs=pcs)
        closed = JobService.complete_step(ss, user=self.user, force_reason="Roll finished", requeue_balance=True)

        balance = closed._partial_balance
        self.assertTrue(balance["released"])
        item.refresh_from_db()
        self.assertNotIn(item.line_status, {"PARTIAL", "PACKING_READY", "COMPLETED"})
        item.sales_order.refresh_from_db()
        self.assertNotEqual(item.sales_order.status, "PLANNING_REQUIRED", "no re-plan while the balance is queued")
        first = ProductionJob.objects.get(id=balance["first_job_id"])
        self.assertEqual(first.current_process.code, "SS")
        self.assertAlmostEqual(float(first.quantity), float(item.qty_value) * 0.55, delta=1)

    def test_preview_matches_what_the_close_sends_back(self):
        item, jobs = self._printed_order()
        prt = jobs["step_1_PRT"]
        self._print_short(prt, D("0.25"))
        prt.refresh_from_db()
        preview = PartialBalanceService.preview(prt, ExecutionService.get_step_execution_profile(str(prt.id), job=prt))
        self.assertTrue(preview["eligible"])
        closed = JobService.complete_step(prt, user=self.user, force_reason="Film ran out", requeue_balance=True)
        self.assertEqual(preview["balance_qty"], closed._partial_balance["qty"])

    def test_continuation_runs_its_own_quantity_in_its_own_batch(self):
        item, jobs = self._printed_order()
        first_batch = ProductionBatch.objects.get(sales_order_item=item)
        created = JobService.create_jobs_for_so_item(
            item, start_index=1, quantity_override=D("123.4"), quantity_uom_override="KG", planner_note_prefix="PARTIAL_REPLAN remaining_kg=123.4",
        )
        self.assertTrue(created)
        self.assertEqual(len({j.production_batch_id for j in created}), 1)
        batch = created[0].production_batch
        self.assertNotEqual(batch.id, first_batch.id)
        self.assertEqual(batch.planned_qty, D("123.4"))
        self.assertTrue(all(j.quantity == D("123.40") and j.uom == "KG" for j in created))
        self.assertTrue(all(j.meta_json.get("quantity_basis") == "JOB" for j in created))


class QueueMaterialFlagTests(walkthroughs.RouteFamilyWalkthroughTests):
    test_purchased_two_ply_printed_pouch = None
    test_three_ply_printed_two_lamination_passes = None
    test_purchased_two_ply_plain_lamination_first = None
    test_courier_bag_from_extruded_rolls = None

    def test_queue_flag_uses_the_release_rule(self):
        template = self._route("FLAG SIDE SEAL", ["SS"])
        item, jobs = self._order(template, [self._layer(self.ld_bought, 50, 0.92)], printed=False, qty=D("20000"))
        ss = jobs["step_1_SS"]
        JobService.release_job(ss.id)
        ss.refresh_from_db()
        blocked, reason = queue_enrichment._material_block(ss)
        self.assertTrue(blocked)
        self.assertIn("no roll with weight", reason)

        # One roll heavier than the whole step clears it (over-allocation is allowed; the
        # leftover is returned at the end of the run).
        roll = self._raw_roll(self.ld_bought, 50, self._target(ss) * 2, "RAW-SS-BIG")
        assignment = WorkCenterAssignment.objects.get(production_job=ss)
        WCManagerService.assign_rolls(assignment.id, [str(roll.id)], user=self.user)
        self.assertEqual(queue_enrichment._material_block(ss), (False, ""))
        status = ExecutionService.get_satisfaction_status(ss.id)
        self.assertEqual(status["rolls_missing"], 0)
        self.assertTrue(status["is_satisfied"])

    @override_settings(ADDON_SHORTAGE_BLOCKS=False)
    def test_add_on_shortage_does_not_flag_the_queue_when_it_does_not_block_release(self):
        template = self._route("FLAG ADDON", ["SS"])
        item, jobs = self._order(template, [self._layer(self.ld_bought, 50, 0.92)], printed=False, qty=D("20000"))
        ss = jobs["step_1_SS"]
        roll = self._raw_roll(self.ld_bought, 50, 500, "RAW-SS-ADDON")
        JobService.release_job(ss.id)
        assignment = WorkCenterAssignment.objects.get(production_job=ss)
        WCManagerService.assign_rolls(assignment.id, [str(roll.id)], user=self.user)
        preview = [{"category": "ADDON", "material_name": "Zipper", "required_qty_kg": 10, "available_qty_kg": 0}]
        with patch.object(ExecutionService, "get_bulk_consumption_preview", return_value=preview):
            self.assertEqual(queue_enrichment._material_block(ss), (False, ""))
        with override_settings(ADDON_SHORTAGE_BLOCKS=True), patch.object(ExecutionService, "get_bulk_consumption_preview", return_value=preview):
            self.assertTrue(queue_enrichment._material_block(ss)[0])
