"""End to end: a partial run and its balance, both carried to finished pieces (1 Nov 2026).

PRT -> Lam -> Slt -> Pch. Printing gets one roll for ~40% of the order and closes short with the
balance sent back. The cut-down batch runs on to pouches; the line must stay open. The balance
batch runs from printing with an over-allocated roll (the leftover is returned under the same
label), through lamination (which may also see the first batch's leftovers of the same line),
slitting and pouching. Only then is the line packing-ready, with pieces from both batches.
A one-step side-seal line does the same with a partial and a balance run.
"""
from decimal import Decimal

from apps.inventory.models import InventoryReservation, InventoryRoll
from apps.production.models import FinishedGoodsBatch, ProductionBatch, ProductionJob, WorkCenterAssignment
from apps.production.services.job_services import JobService
from apps.production.services.operator_service import OperatorService
from apps.production.services.services_execution import ExecutionService
from apps.production.tests import test_route_family_walkthroughs as walkthroughs
from apps.production.views_planner import PlannerViewSet

D = Decimal


class PartialFlowEndToEndTests(walkthroughs.RouteFamilyWalkthroughTests):
    test_purchased_two_ply_printed_pouch = None
    test_three_ply_printed_two_lamination_passes = None
    test_purchased_two_ply_plain_lamination_first = None
    test_courier_bag_from_extruded_rolls = None

    # ---------------------------------------------------------------- steps (pool may hold more)
    def _open(self, job):
        job.refresh_from_db()
        if job.job_state == "WAITING":
            JobService.release_ready_frontier_jobs(ProductionJob.objects.filter(production_batch=job.production_batch))
            job.refresh_from_db()
        self.assertIn(job.job_state, {"PLANNED", "RELEASED"}, f"{job.job_number} did not open")
        return job

    def _laminate_rolls(self, job, printed, ld_label):
        self._open(job)
        pool = set(self._pool(job))
        self.assertTrue({r.label_id for r in printed} <= pool, "lamination sees this batch's printed rolls")
        ld = self._stock_for_lane(job, self.ld_bought, 50, 2, ld_label)
        self._run(job, roll_ids=[r.id for r in printed] + [r.id for r in ld])
        req = ExecutionService._roll_requirement(job)
        loaded = {}
        for lane in req["lanes"]:
            rolls = printed if lane.get("material_name") != self.ld_bought.name else ld
            loaded[lane["lane_key"]] = sum((D(str(InventoryRoll.objects.get(id=r.id).weight_kg)) for r in rolls), D("0"))
        capacity = min(loaded[l["lane_key"]] / D(str(l["share"])) for l in req["lanes"])
        out = (min(capacity * D("0.98"), D(str(req["remaining_kg"]))) / 2).quantize(D("0.01"))
        for _ in range(2):
            OperatorService.log_output_step(str(job.id), float(out), self.user, roll_outputs=[{"weight_kg": str(out), "width_mm": 989}])
        adhesive = job.material_requirements.filter(material=self.adhesive).first()
        conf = [{"material_id": str(self.adhesive.id), "actual_issued_qty": str(D(str(adhesive.required_qty)) * D("0.95")), "actual_returned_qty": "0"}] if adhesive else None
        closed = JobService.complete_step(job, user=self.user, material_confirmations=conf, force_reason="Ran what came", requeue_balance=False)
        return self._outputs(job), closed

    def _slit_rolls(self, job, parents):
        self._open(job)
        self.assertTrue({r.label_id for r in parents} <= set(self._pool(job)))
        self._run(job, roll_ids=[r.id for r in parents])
        for parent in parents:
            parent.refresh_from_db()
            half = (D(str(parent.weight_kg)) / 2 - D("0.5")).quantize(D("0.001"))
            OperatorService.log_output_step(str(job.id), float(half * 2), self.user, split_outputs=[{"width_mm": 490, "weight_kg": str(half)}] * 2, trim_qty=1)
        JobService.complete_step(job, user=self.user, force_reason="Ran what came", requeue_balance=False)
        return self._outputs(job, role="SPLIT_OUTPUT")

    def _pouch_rolls(self, job, rolls, item):
        self._open(job)
        self.assertTrue({r.label_id for r in rolls} <= set(self._pool(job)))
        self._run(job, roll_ids=[r.id for r in rolls])
        job.refresh_from_db()
        unit_g = D(str(item.unit_weight_g))
        film = sum((D(str(InventoryRoll.objects.get(id=r.id).weight_kg)) for r in rolls), D("0"))
        pcs = int(min(film * D("0.98") * 1000 / unit_g, D(str(job.quantity))) // 100 * 100)
        kg = (D(pcs) * unit_g / 1000).quantize(D("0.001"))
        OperatorService.log_output_step(str(job.id), float(kg), self.user, output_pcs=pcs, scrap_qty=0.5)
        JobService.complete_step(job, user=self.user, force_reason="Film used up", requeue_balance=False)
        return pcs

    # ---------------------------------------------------------------- the flows
    def test_partial_print_then_both_batches_to_pouches(self):
        template = self._route("E2E 2 PLY PRT", ["PRT", "Lam", "Slt", "Pch"])
        layers = [self._layer(self.pet, 12, 1.40), self._layer(self.ld_bought, 50, 0.92)]
        item, jobs = self._order(template, layers, printed=True, qty=D("50000"))
        order_qty = D(str(item.qty_value))

        # 1. Printing released with one roll for ~40% (a partial run is not a gate).
        prt = jobs["step_1_PRT"]
        target = self._target(prt)
        short_roll = self._raw_roll(self.pet, 12, (target * D("0.4")).quantize(D("0.01")) + D("2"), "E2E-PET-SHORT")
        self._run(prt, roll_ids=[short_roll.id])
        self.assertEqual(ExecutionService.roll_readiness(prt)["rolls_missing"], 0)
        made = (target * D("0.4")).quantize(D("0.01"))
        OperatorService.log_output_step(str(prt.id), float(made), self.user, roll_outputs=[{"weight_kg": str(made), "width_mm": 989}])
        closed = JobService.complete_step(prt, user=self.user, force_reason="Film ran out", requeue_balance=True)
        balance = closed._partial_balance
        balance_qty = D(str(balance["qty"]))
        covered = order_qty - balance_qty
        printed_b1 = self._outputs(prt)
        short_roll.refresh_from_db()
        self.assertIn(short_roll.status, {"CONSUMED", "AVAILABLE"})

        # 2. The cut-down first batch runs to pouches; the line stays open (balance queued).
        lam1, closed_lam1 = self._laminate_rolls(jobs["step_2_Lam"], printed_b1, "E2E-LD-B1")
        self.assertIsNone(closed_lam1._partial_balance)
        children1 = self._slit_rolls(jobs["step_3_Slt"], lam1)
        pch1 = ProductionJob.objects.get(id=jobs["step_4_Pch"].id)
        self.assertEqual(pch1.quantity, covered)
        pcs1 = self._pouch_rolls(pch1, children1, item)
        self.assertGreater(pcs1, 0)
        item.refresh_from_db()
        self.assertNotIn(item.line_status, {"PACKING_READY", "COMPLETED", "PARTIAL"}, "balance still queued")
        self.assertNotEqual(item.sales_order.status, "PACKING_READY")

        # 3. The balance is in the printing WC queue; it runs on an over-allocated roll.
        b2 = {j.route_node_id: j for j in ProductionJob.objects.filter(production_batch__batch_number=balance["batch_number"])}
        prt2 = b2["step_1_PRT"]
        self.assertTrue(WorkCenterAssignment.objects.filter(production_job=prt2, work_center=prt.work_center).exists())
        target2 = self._target(prt2)
        self.assertAlmostEqual(float(target2), float(target) * float(balance_qty / order_qty), delta=float(target) * 0.02)
        big = self._raw_roll(self.pet, 12, (target2 * D("1.5")).quantize(D("0.01")), "E2E-PET-BIG")
        self._run(prt2, roll_ids=[big.id])
        OperatorService.log_output_step(str(prt2.id), float(target2), self.user, roll_outputs=[{"weight_kg": str(target2), "width_mm": 989}])
        big.refresh_from_db()
        left = D(str(big.weight_kg))
        self.assertGreater(left, 0, "over-allocated roll still holds film")
        ExecutionService.return_roll_balance(prt2.id, big.id, user=self.user, mode="RETURN")
        big.refresh_from_db()
        self.assertEqual((big.status, big.label_id), ("AVAILABLE", "E2E-PET-BIG"), "leftover back in stock under its label")
        self.assertEqual(big.location_id, self.rm.id)
        closed2 = JobService.complete_step(prt2, user=self.user, requeue_balance=True)
        self.assertIsNone(closed2._partial_balance, "a full run queues nothing")
        printed_b2 = self._outputs(prt2)

        # 4. Balance lamination -> slitting -> pouching; then the line is packing-ready.
        lam2, _ = self._laminate_rolls(b2["step_2_Lam"], printed_b2, "E2E-LD-B2")
        children2 = self._slit_rolls(b2["step_3_Slt"], lam2)
        pcs2 = self._pouch_rolls(b2["step_4_Pch"], children2, item)
        total = pcs1 + pcs2
        # Test yields (98% capacity, trim, whole hundreds) compound over four steps.
        self.assertAlmostEqual(total / float(order_qty), 0.9, delta=0.08, msg=f"{pcs1}+{pcs2} of {order_qty}")
        self.assertEqual(FinishedGoodsBatch.objects.filter(production_job__sales_order_item=item).count(), 2)
        self.assertFalse(ProductionJob.objects.filter(sales_order_item=item).exclude(job_state__in=["COMPLETED", "CANCELLED"]).exists())
        item.refresh_from_db()
        item.sales_order.refresh_from_db()
        metrics = JobService._sales_item_shortfall_metrics(item, 3)
        if metrics["requires_replan"]:
            self.assertEqual(item.line_status, "PARTIAL")
        else:
            self.assertIn(item.line_status, {"PACKING_READY", "COMPLETED"})
            self.assertEqual(item.sales_order.status, "PACKING_READY")
        self.assertEqual(sorted(ProductionBatch.objects.filter(sales_order_item=item).values_list("batch_sequence", flat=True)), [1, 2])
        planned = sum(ProductionBatch.objects.filter(sales_order_item=item).values_list("planned_qty", flat=True))
        self.assertEqual(planned, order_qty, "batches plan the order once")
        self.assertFalse(InventoryReservation.objects.filter(job__sales_order_item=item, status="ACTIVE").exists(), "no roll left locked")
        # The planner does not ask for a re-plan of a line both batches finished.
        partial = PlannerViewSet()._sales_item_partial_metrics(item, 3)
        self.assertEqual(partial["requires_replan"], metrics["requires_replan"])

    def test_side_seal_partial_then_balance_with_leftover_returned(self):
        template = self._route("E2E SIDE SEAL", ["SS"])
        item, jobs = self._order(template, [self._layer(self.ld_bought, 50, 0.92)], printed=False, qty=D("20000"))
        ss = jobs["step_1_SS"]
        unit_g = D(str(item.unit_weight_g))
        target = self._target(ss)
        roll = self._raw_roll(self.ld_bought, 50, (target * D("0.5")).quantize(D("0.01")), "E2E-SS-HALF")
        self._run(ss, roll_ids=[roll.id])
        pcs1 = int(D(str(item.qty_value)) * D("0.48"))
        OperatorService.log_output_step(str(ss.id), float((D(pcs1) * unit_g / 1000).quantize(D("0.001"))), self.user, output_pcs=pcs1)
        closed = JobService.complete_step(ss, user=self.user, force_reason="Roll finished", requeue_balance=True)
        bal = ProductionJob.objects.get(id=closed._partial_balance["first_job_id"])
        roll.refresh_from_db()
        self.assertNotEqual(roll.status, "RESERVED")

        target2 = self._target(bal)
        big = self._raw_roll(self.ld_bought, 50, (target2 * 2).quantize(D("0.01")), "E2E-SS-BIG")
        self._run(bal, roll_ids=[big.id])
        pcs2 = int(D(str(bal.quantity)))
        OperatorService.log_output_step(str(bal.id), float((D(pcs2) * unit_g / 1000).quantize(D("0.001"))), self.user, output_pcs=pcs2)
        JobService.complete_step(bal, user=self.user, requeue_balance=True)
        big.refresh_from_db()
        self.assertEqual(big.status, "AVAILABLE", "loaded leftover is released at close")
        self.assertGreater(D(str(big.weight_kg)), 0)
        item.refresh_from_db()
        self.assertIn(item.line_status, {"PACKING_READY", "COMPLETED"})
        self.assertEqual(pcs1 + pcs2, int(item.qty_value))
        self.assertEqual(FinishedGoodsBatch.objects.filter(production_job__sales_order_item=item).count(), 2)
