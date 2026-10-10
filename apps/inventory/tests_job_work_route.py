"""Job work in the middle of a route: PLAIN FILM → PRINT (at a job worker) →
POUCHING (in-house). Printed rolls come back in lots, production continues
with what is back (release-step), the step guard, and the job-work step's
material actuals (no WIP consumption on close)."""
from decimal import Decimal

from django.test import TestCase
from django.utils import timezone

from apps.factory.models import Process, WorkCenter, WorkCenterProcess
from apps.gate.models import GateAuditEvent
from apps.inventory.models import BulkTransaction, InventoryBulk, InventoryRoll, JobWorkOrder, Vendor
from apps.inventory.services.bulk_service import BulkService
from apps.materials.models import InventoryMaterial
from apps.production.models import FinishedGoodsBatch, JobExecutionLog, JobMaterialRequirement, ProductionJob
from apps.production.services.job_services import JobService
from apps.production.services.roll_allocation_service import RollAllocationService
from apps.production.services.services_execution import ExecutionService
from apps.routing.models import RoutingRule
from apps.sales.models import SalesOrder, SalesOrderItem
from apps.templates.models import TemplateBlueprint, TemplateProcessStep

from .tests_job_work_base import JobWorkFixtureMixin, token


class MidRouteFixtureMixin(JobWorkFixtureMixin):
    """A 2-step route job: PRINT at a job worker (roll → roll), then POUCHING
    in-house (roll → pieces). One ProductionJob per route step, linked by the
    route graph, as the planner creates them."""

    def setUp(self):
        super().setUp()
        self.print_process = Process.objects.create(
            code="PRINT_JOBWORK_T", name="Printing (job work)", input_form="ROLL", output_form="ROLL",
            roll_behavior="MODIFY_EXISTING", print_capable=True,
        )
        self.pouch_process = Process.objects.create(code="POUCHING_T", name="Pouching", input_form="ROLL", output_form="BULK", roll_behavior="NONE")
        self.print_wc = WorkCenter.objects.create(plant=self.plant, name="Print job-work desk", code="PRINT-JW-T", default_wip_location=self.wip)
        self.pouch_wc = WorkCenter.objects.create(plant=self.plant, name="Pouch line 1", code="POUCH-L1-T", default_wip_location=self.wip)
        WorkCenterProcess.objects.create(work_center=self.print_wc, process=self.print_process)
        WorkCenterProcess.objects.create(work_center=self.pouch_wc, process=self.pouch_process)
        self.print_vendor = Vendor.objects.create(
            code="DEMOPRINT", name="Demo Print Works", type="JOBWORK", gst_no="24AAAAA0000A1Z5", mailing_state="Gujarat",
            jobwork_rates=[{"process_code": "PRINT_JOBWORK_T", "rate": "18", "uom": "KG"}],
        )
        self.plain_film = InventoryMaterial.objects.create(code="JW-BOPP20", name="Plain BOPP 20", category="FILM_VARIANT", base_uom="KG", parent_family=self.family, density_gcm3=Decimal("0.9100"))
        self.ink = InventoryMaterial.objects.create(code="JW-INK-CYAN", name="Cyan ink", category="INK", base_uom="KG")
        self.adhesive = InventoryMaterial.objects.create(code="JW-ADH-1", name="Print primer", category="CHEMICAL", base_uom="KG")

    def make_route_job(self, suffix):
        route = RoutingRule.objects.create(name=f"Print then pouch {suffix}", ordered_processes=[self.print_process.code, self.pouch_process.code])
        template = TemplateBlueprint.objects.create(name=f"Printed pouch {suffix}", fg_type="POUCH", status="DRAFT", routing_rule=route, pouch_style="PILLOW")
        print_step = TemplateProcessStep.objects.create(template=template, sequence_number=1, process=self.print_process)
        TemplateProcessStep.objects.create(template=template, sequence_number=2, process=self.pouch_process)
        so = SalesOrder.objects.create(
            customer_name="Sample Snacks Co", order_name=f"Demo order {suffix}", order_type="MTO", status="CONFIRMED",
            geometry_override={"fg_type": "POUCH"}, commercial_confirmed_at=timezone.now(), delivery_date=timezone.localdate(),
        )
        item = SalesOrderItem.objects.create(
            sales_order=so, template=template, mode="TEMPLATE", line_name=f"Printed pouch {suffix}",
            geometry_snapshot={"fg_type": "POUCH", "width_mm": 400, "height_mm": 71}, layer_snapshot=[], printing_snapshot={},
            addons_snapshot=[], packaging_snapshot={}, bom_snapshot={
                "is_complete": True,
                "films": [{"variant_id": str(self.plain_film.id), "weight_kg": "0.01", "source": "PURCHASE"}],
                "inks": [{"material_id": str(self.ink.id), "weight_kg": "6"}],
            },
            unit_weight_g=Decimal("10"), total_weight_kg=Decimal("400"), qty_uom="PCS", qty_value=Decimal("40000"),
            price_basis="PCS", unit_price=Decimal("1.0000"),
        )
        common = dict(template=template, sales_order_item=item, routing_rule=route, quantity=Decimal("40000"), remaining_qty=Decimal("40000"), uom="PCS", status="QUEUED")
        print_job = ProductionJob.objects.create(
            job_number=f"JOB-MR-{suffix}-1", current_step_index=0, current_process=self.print_process, process=self.print_process,
            route_node_id=f"step_1_{self.print_process.code}", work_center=self.print_wc, from_location=self.wip, to_location=self.wip,
            input_form="ROLL", output_form="ROLL", job_state="PAUSED", is_on_hold=True, hold_reason="Planned job work", **common,
        )
        pouch_job = ProductionJob.objects.create(
            job_number=f"JOB-MR-{suffix}-2", current_step_index=1, current_process=self.pouch_process, process=self.pouch_process,
            route_node_id=f"step_2_{self.pouch_process.code}", work_center=self.pouch_wc, from_location=self.wip, to_location=self.fg,
            input_form="ROLL", output_form="BULK", job_state="WAITING", **common,
        )
        ink_req = JobMaterialRequirement.objects.create(
            production_job=print_job, material=self.ink, process_step=print_step, required_qty=Decimal("6"),
            theoretical_qty=Decimal("5"), planned_issue_qty=Decimal("6"), uom="KG",
        )
        return print_job, pouch_job, ink_req

    def print_order(self, job, client=None, **extra):
        payload = {"vendor": str(self.print_vendor.id), "expected_output_kind": "ROLLS", "expected_qty": "400", "expected_uom": "KG", "rate": "18", "rate_uom": "KG"}
        payload.update(extra)
        return self.create_order(job=job, client=client, **payload)

    def plain_rolls(self, prefix, job, count=4, weight="100"):
        return [self.make_roll(f"{prefix}-{i}", weight, job=job, material=self.plain_film) for i in range(1, count + 1)]

    def printed_lot(self, sent_order, rolls, *, out_weight="98", wastage="4"):
        return {
            "sent_lines": [{"sent_line_id": self.sent_line(sent_order, roll)["id"], "disposition": "PROCESSED"} for roll in rolls],
            "output_rolls": [
                {"material_id": str(self.film.id), "weight_kg": out_weight, "width_mm": "830", "thickness_micron": "20", "location_id": str(self.wip.id)}
                for _ in rolls
            ],
            "wastage": {"kg": wastage, "returned_to_factory": True},
        }

    def release(self, order_id, client=None, expect=200, **payload):
        body = {"client_token": token(), **payload}
        response = (client or self.api).post(f"/api/inventory/job-work/{order_id}/release-step/", body, format="json")
        self.assertEqual(response.status_code, expect, getattr(response, "data", response))
        return response.data

    def wip_ink(self):
        return InventoryBulk.objects.filter(material=self.ink, location=self.wip).values_list("qty_kg", flat=True).first() or Decimal("0")


class ContinueProductionWithWhatIsBackTests(MidRouteFixtureMixin, TestCase):
    def test_print_at_job_worker_then_pouch_in_house_in_two_lots(self):
        print_job, pouch_job, ink_req = self.make_route_job("A")
        film_req = JobMaterialRequirement.objects.create(
            production_job=print_job, material=self.plain_film, process_step=ink_req.process_step, required_qty=Decimal("400"),
            theoretical_qty=Decimal("392"), uom="KG",
        )
        BulkService.add_bulk(material_id=str(self.ink.id), qty=Decimal("50"), plant_id=str(self.plant.id), location_id=str(self.wip.id), cost=Decimal("400"))
        rolls = self.plain_rolls("PL-A", print_job)
        order = self.print_order(print_job)
        self.assertEqual(order["route_step"]["number"], 1)
        self.assertFalse(order["actions"]["can_release_step"])
        sent = self.dispatch(order["id"], rolls)["order"]

        # Lot 1: two printed rolls back; production cannot continue before it.
        self.release(order["id"], expect=409)
        lot1 = self.post_return(order["id"], self.printed_lot(sent, rolls[:2]))
        detail = lot1["order"]
        self.assertEqual(detail["status"], "PARTLY_RETURNED")
        self.assertTrue(detail["actions"]["can_release_step"])
        self.assertEqual(detail["route_step"]["position"], "ON_STEP")
        self.assertTrue(detail["route_step"]["progress"]["short"])
        self.assertEqual([row["job_number"] for row in detail["route_step"]["next_jobs"]], [pouch_job.job_number])

        # Short of the step target: a reason is required, nothing changes without it.
        refused = self.release(order["id"], expect=400)
        self.assertIn("step_force_reason", refused["field_errors"])
        print_job.refresh_from_db()
        self.assertEqual(print_job.job_state, "PAUSED")

        released = self.release(order["id"], step_force_reason="Pouching starts with the first two printed rolls")
        self.assertEqual(released["step"]["action"], "STEP_COMPLETED")
        self.assertEqual(released["order"]["status"], "PARTLY_RETURNED")  # still open for the rest
        self.assertIsNotNone(released["order"]["step_release"])
        self.assertEqual(released["order"]["step_release"]["reason"], "Pouching starts with the first two printed rolls")
        self.assertFalse(released["order"]["actions"]["can_release_step"])
        self.assertTrue(released["order"]["actions"]["can_receive"])
        self.assertEqual(released["order"]["route_step"]["position"], "PAST")

        print_job.refresh_from_db()
        pouch_job.refresh_from_db()
        self.assertEqual((print_job.job_state, print_job.is_on_hold, print_job.closed_by_id), ("COMPLETED", False, self.store.id))
        self.assertTrue(print_job.closed_with_variance)
        # The planner / WCM see the pouching step released to its work centre, not held.
        self.assertEqual((pouch_job.job_state, pouch_job.is_on_hold, pouch_job.work_center_id), ("RELEASED", False, self.pouch_wc.id))
        self.assertEqual(pouch_job.current_step_index, 1)

        # Printed rolls are lineage output of the print job, ready for step 2,
        # and exactly what the WCM roll query offers the pouching job.
        lot1_rolls = list(InventoryRoll.objects.filter(job_work_return_lines__job_work_return_id=lot1["return_id"], job_work_return_lines__kind="OUTPUT_ROLL"))
        self.assertEqual(len(lot1_rolls), 2)
        for roll in lot1_rolls:
            self.assertEqual((roll.production_job_id, roll.created_by_job_id, roll.status), (print_job.id, print_job.id, "AVAILABLE"))
            self.assertEqual((roll.completed_step_index, roll.current_step_index), (0, pouch_job.current_step_index))
        wcm_rolls = RollAllocationService.get_eligible_rolls(
            pouch_job, include_non_lineage_fallback=ExecutionService._allow_non_lineage_roll_discovery(pouch_job, self.pouch_process), include_remainder=True,
        )
        self.assertEqual({roll.id for roll in wcm_rolls}, {roll.id for roll in lot1_rolls})

        # The job worker printed with their own ink: WIP ink is untouched and
        # the requirement shows zero factory consumption.
        self.assertEqual(self.wip_ink(), Decimal("50.0000"))
        self.assertFalse(BulkTransaction.objects.filter(material=self.ink, type="CONSUME").exists())
        ink_req.refresh_from_db()
        self.assertEqual((ink_req.supply_source, ink_req.consumed_qty, ink_req.actual_issued_qty, ink_req.variance_qty, ink_req.is_estimated),
                         ("JOBWORK_VENDOR", Decimal("0"), Decimal("0"), Decimal("0"), False))
        self.assertIn("Demo Print Works", ink_req.supply_note)
        # Our plain film went out on the challan: counted from the settled rolls.
        film_req.refresh_from_db()
        self.assertEqual((film_req.supply_source, film_req.consumed_qty, film_req.actual_issued_qty, film_req.actual_scrap_qty),
                         ("JOBWORK_SENT", Decimal("200.0000"), Decimal("200.0000"), Decimal("4.0000")))

        # Lot 2 after the release: lands ready for pouching too.
        lot2 = self.post_return(order["id"], self.printed_lot(sent, rolls[2:]))
        self.assertEqual(lot2["order"]["status"], "RETURNED")
        lot2_rolls = list(InventoryRoll.objects.filter(job_work_return_lines__job_work_return_id=lot2["return_id"], job_work_return_lines__kind="OUTPUT_ROLL"))
        self.assertTrue(all(roll.current_step_index == 1 and roll.production_job_id == print_job.id for roll in lot2_rolls))
        wcm_rolls = RollAllocationService.get_eligible_rolls(pouch_job, include_remainder=True)
        self.assertEqual({roll.id for roll in wcm_rolls}, {roll.id for roll in lot1_rolls + lot2_rolls})
        self.assertEqual(JobExecutionLog.objects.filter(production_job=print_job).count(), 2)

        closed_at = print_job.closed_at
        closed = self.api.post(f"/api/inventory/job-work/{order['id']}/close/", {"client_token": token()}, format="json")
        self.assertEqual(closed.status_code, 200, closed.data)
        self.assertEqual(closed.data["order"]["status"], "CLOSED")
        self.assertEqual(closed.data["step"]["action"], "STEP_RELEASED_EARLIER")
        print_job.refresh_from_db()
        pouch_job.refresh_from_db()
        self.assertEqual((print_job.job_state, print_job.closed_at), ("COMPLETED", closed_at))
        self.assertEqual(pouch_job.job_state, "RELEASED")
        self.assertEqual(self.wip_ink(), Decimal("50.0000"))
        film_req.refresh_from_db()  # refreshed at close with lot 2
        self.assertEqual((film_req.consumed_qty, film_req.actual_scrap_qty, film_req.variance_qty), (Decimal("400.0000"), Decimal("8.0000"), Decimal("8.0000")))
        actions = list(GateAuditEvent.objects.filter(object_id=order["id"]).values_list("action", flat=True).order_by("created_at"))
        self.assertEqual(actions, ["JW_CREATED", "JW_DISPATCHED", "JW_RETURNED", "JW_STEP_RELEASED", "JW_RETURNED", "JW_CLOSED"])
        labels = [row["label"] for row in closed.data["order"]["timeline"]]
        self.assertIn("Production continued with what's back", labels)

    def test_ink_sent_on_the_challan_is_counted_on_the_requirement(self):
        print_job, pouch_job, ink_req = self.make_route_job("INK")
        BulkService.add_bulk(material_id=str(self.ink.id), qty=Decimal("20"), plant_id=str(self.plant.id), location_id=str(self.rm.id), cost=Decimal("400"))
        BulkService.add_bulk(material_id=str(self.ink.id), qty=Decimal("50"), plant_id=str(self.plant.id), location_id=str(self.wip.id), cost=Decimal("400"))
        rolls = self.plain_rolls("PL-INK", print_job)
        order = self.print_order(print_job)
        sent = self.dispatch(order["id"], rolls, bulk_items=[{"material_id": str(self.ink.id), "location_id": str(self.rm.id), "quantity": "5", "hsn_code": "3215"}])["order"]
        ink_line = next(line for line in sent["sent_lines"] if line["kind"] == "BULK")
        payload = self.printed_lot(sent, rolls[:2])
        payload["sent_lines"].append({"sent_line_id": ink_line["id"], "disposition": "PARTLY_USED", "consumed_qty": "3", "returned_qty": "0"})
        self.post_return(order["id"], payload)
        released = self.release(order["id"], step_force_reason="Start pouching")
        ink_req.refresh_from_db()
        self.assertEqual((ink_req.supply_source, ink_req.consumed_qty, ink_req.actual_issued_qty, ink_req.actual_returned_qty),
                         ("JOBWORK_SENT", Decimal("3.0000"), Decimal("3.0000"), Decimal("0.0000")))
        self.assertEqual(ink_req.variance_qty, Decimal("-2.0000"))  # 3 used − 5 theoretical
        self.assertIn(sent["challans"][0]["number"], ink_req.supply_note)
        materials = {row["material"]: row for row in released["step"]["materials"]}
        self.assertEqual(materials["Cyan ink"]["supply_source"], "JOBWORK_SENT")

        # The rest is written off at short-close: the requirement now counts it.
        response = self.api.post(f"/api/inventory/job-work/{order['id']}/short-close/", {"client_token": token(), "reason": "Two rolls damaged at the printer"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["step"]["action"], "STEP_RELEASED_EARLIER")
        ink_req.refresh_from_db()
        self.assertEqual((ink_req.consumed_qty, ink_req.actual_issued_qty), (Decimal("5.0000"), Decimal("5.0000")))
        self.assertEqual(ink_req.variance_qty, Decimal("0.0000"))
        from apps.costing.services import CostingService

        _, _, breakdown, _ = CostingService.get_material_actual_cost(print_job)
        self.assertEqual([(row["material_code"], row["actual_qty"]) for row in breakdown], [(self.ink.code, 5.0)])
        # Stock: 5 kg left RM on the challan, nothing came back, WIP never touched.
        self.assertEqual(InventoryBulk.objects.get(material=self.ink, location=self.rm).qty_kg, Decimal("15.0000"))
        self.assertEqual(InventoryBulk.objects.get(material=self.ink, location=self.jw_out).qty_kg, Decimal("0.0000"))
        self.assertEqual(self.wip_ink(), Decimal("50.0000"))

    def test_close_without_release_completes_the_step_without_wip_consumption(self):
        print_job, pouch_job, ink_req = self.make_route_job("CL")
        primer = JobMaterialRequirement.objects.create(
            production_job=print_job, material=self.adhesive, process_step=ink_req.process_step, required_qty=Decimal("2"), theoretical_qty=Decimal("2"), uom="KG",
        )
        BulkService.add_bulk(material_id=str(self.ink.id), qty=Decimal("50"), plant_id=str(self.plant.id), location_id=str(self.wip.id), cost=Decimal("400"))
        BulkService.add_bulk(material_id=str(self.adhesive.id), qty=Decimal("10"), plant_id=str(self.plant.id), location_id=str(self.wip.id), cost=Decimal("90"))
        rolls = self.plain_rolls("PL-CL", print_job, count=2)
        order = self.print_order(print_job)
        sent = self.dispatch(order["id"], rolls)["order"]
        self.post_return(order["id"], self.printed_lot(sent, rolls, out_weight="96", wastage="8"))
        closed = self.api.post(f"/api/inventory/job-work/{order['id']}/close/", {"client_token": token(), "step_force_reason": "Half the order printed"}, format="json")
        self.assertEqual(closed.status_code, 200, closed.data)
        self.assertEqual(closed.data["step"]["action"], "STEP_COMPLETED")
        self.assertEqual(self.wip_ink(), Decimal("50.0000"))
        self.assertEqual(InventoryBulk.objects.get(material=self.adhesive, location=self.wip).qty_kg, Decimal("10.0000"))
        for req in (ink_req, primer):
            req.refresh_from_db()
            self.assertEqual((req.supply_source, req.consumed_qty), ("JOBWORK_VENDOR", Decimal("0")))
        pouch_job.refresh_from_db()
        self.assertEqual(pouch_job.job_state, "RELEASED")

        # Costing and usage-variance reports treat the job worker's material
        # as theirs: no factory cost, not "missing", no fake under-use variance.
        from apps.analytics.reports_service import ReportService
        from apps.costing.services import CostingService

        cost, has_actuals, breakdown, flags = CostingService.get_material_actual_cost(print_job)
        self.assertEqual((cost, has_actuals, breakdown), (Decimal("0"), True, []))
        self.assertIn(f"MATERIAL_SUPPLIED_BY_JOB_WORKER:{self.ink.code}", flags)
        self.assertFalse([flag for flag in flags if flag.startswith("MATERIAL_ACTUALS_MISSING")])
        report = ReportService.get_mrp_consumption({})
        self.assertNotIn(self.ink.code, [row["code"] for row in report["by_material"]])
        self.assertNotIn(self.adhesive.code, [row["code"] for row in report["by_material"]])

    def test_complete_step_option_skips_only_the_close_reconciliation(self):
        """Other callers keep auto-consuming step materials at close; job work opts out."""
        from apps.inventory.services.job_work import record_job_output

        BulkService.add_bulk(material_id=str(self.ink.id), qty=Decimal("50"), plant_id=str(self.plant.id), location_id=str(self.wip.id), cost=Decimal("400"))
        in_house, _, in_house_req = self.make_route_job("OPT")
        record_job_output(in_house, Decimal("200"), None, self.planner)
        JobService.complete_step(in_house, user=self.planner, force_reason="Half printed in-house")
        in_house_req.refresh_from_db()
        self.assertEqual(in_house_req.consumed_qty, Decimal("3.0000"))  # 6 kg × 200/400 from WIP
        self.assertEqual(self.wip_ink(), Decimal("47.0000"))

        job_work, _, job_work_req = self.make_route_job("OPT2")
        record_job_output(job_work, Decimal("200"), None, self.planner)
        JobService.complete_step(job_work, user=self.planner, force_reason="Printed at the job worker", material_settled_externally=True)
        job_work.refresh_from_db()
        self.assertEqual(job_work.job_state, "COMPLETED")
        self.assertEqual(self.wip_ink(), Decimal("47.0000"))
        job_work_req.refresh_from_db()
        self.assertEqual((job_work_req.consumed_qty, job_work_req.supply_source), (Decimal("0"), "FACTORY"))


class StepGuardTests(MidRouteFixtureMixin, TestCase):
    def test_planner_completed_the_step_manually(self):
        print_job, pouch_job, ink_req = self.make_route_job("PLN")
        BulkService.add_bulk(material_id=str(self.ink.id), qty=Decimal("50"), plant_id=str(self.plant.id), location_id=str(self.wip.id), cost=Decimal("400"))
        rolls = self.plain_rolls("PL-PLN", print_job, count=2)
        order = self.print_order(print_job)
        sent = self.dispatch(order["id"], rolls)["order"]
        self.post_return(order["id"], self.printed_lot(sent, rolls[:1]))
        JobService.complete_step(print_job, user=self.planner, force_reason="Planner moved the job on")
        print_job.refresh_from_db()
        closed_at = print_job.closed_at

        refused = self.release(order["id"], expect=409)
        self.assertIn("already completed", refused["message"])
        detail = self.api.get(f"/api/inventory/job-work/{order['id']}/").data
        self.assertFalse(detail["actions"]["can_release_step"])
        self.assertEqual(detail["route_step"]["position"], "PAST")

        self.post_return(order["id"], self.printed_lot(sent, rolls[1:]))
        closed = self.api.post(f"/api/inventory/job-work/{order['id']}/close/", {"client_token": token()}, format="json")
        self.assertEqual(closed.status_code, 200, closed.data)
        self.assertEqual(closed.data["step"]["action"], "ALREADY_COMPLETED")
        self.assertIn("already completed by jw-planner", closed.data["step"]["detail"])
        print_job.refresh_from_db()
        self.assertEqual((print_job.closed_at, print_job.closed_by_id), (closed_at, self.planner.id))
        ink_req.refresh_from_db()
        self.assertEqual(ink_req.supply_source, "FACTORY")  # not ours to rewrite

    def test_job_behind_the_order_step_is_a_conflict(self):
        print_job, _, _ = self.make_route_job("BEH")
        rolls = self.plain_rolls("PL-BEH", print_job, count=1)
        order = self.print_order(print_job)
        sent = self.dispatch(order["id"], rolls)["order"]
        self.post_return(order["id"], self.printed_lot(sent, rolls))
        JobWorkOrder.objects.filter(id=order["id"]).update(route_step_index=1)
        response = self.api.post(f"/api/inventory/job-work/{order['id']}/close/", {"client_token": token(), "step_force_reason": "x"}, format="json")
        self.assertEqual(response.status_code, 409)
        self.assertIn("before this order's route step 2", response.data["message"])
        self.release(order["id"], expect=409)
        JobWorkOrder.objects.filter(id=order["id"]).update(route_step_index=0)
        ProductionJob.objects.filter(id=print_job.id).update(job_state="WAITING")
        response = self.api.post(f"/api/inventory/job-work/{order['id']}/close/", {"client_token": token()}, format="json")
        self.assertEqual(response.status_code, 409)
        self.assertIn("has not reached route step 1", response.data["message"])
        self.assertEqual(JobWorkOrder.objects.get(id=order["id"]).status, "RETURNED")

    def test_terminal_step_cannot_release_and_fg_after_manual_completion_still_books(self):
        job = self.make_job("TRM")
        rolls = [self.make_roll(f"PR-TRM-{i}", "100", job=job) for i in range(1, 3)]
        order = self.create_order(job=job)
        sent = self.dispatch(order["id"], rolls)["order"]
        first = self.post_return(order["id"], {
            "sent_lines": [{"sent_line_id": self.sent_line(sent, rolls[0])["id"], "disposition": "PROCESSED"}],
            "fg": {"qty_pcs": 9000, "location_id": str(self.fg.id)}, "wastage": {"kg": "10"},
        })
        self.assertFalse(first["order"]["actions"]["can_release_step"])
        self.assertIn("last route step", first["order"]["route_step"]["release_blocked_reason"])
        refused = self.release(order["id"], expect=409)
        self.assertIn("last route step", refused["message"])
        job.refresh_from_db()
        self.assertEqual(job.job_state, "PAUSED")

        # The planner completes the terminal job by hand; later pieces still book.
        JobService.complete_step(job, user=self.planner, force_reason="Customer wants partial dispatch")
        self.post_return(order["id"], {
            "sent_lines": [{"sent_line_id": self.sent_line(sent, rolls[1])["id"], "disposition": "PROCESSED"}],
            "fg": {"qty_pcs": 9000, "boxes": 22, "location_id": str(self.fg.id)}, "wastage": {"kg": "10"},
        })
        batches = FinishedGoodsBatch.objects.filter(production_job=job).order_by("batch_number")
        self.assertEqual([batch.qty_pcs for batch in batches], [9000, 9000])
        self.assertTrue(all(batch.status == "AVAILABLE" and batch.location_id == self.fg.id for batch in batches))
        job.refresh_from_db()
        self.assertEqual((job.job_state, job.produced_qty), ("COMPLETED", Decimal("18000")))
        closed = self.api.post(f"/api/inventory/job-work/{order['id']}/close/", {"client_token": token()}, format="json")
        self.assertEqual(closed.status_code, 200, closed.data)
        self.assertEqual(closed.data["step"]["action"], "ALREADY_COMPLETED")


class ReleaseStepApiTests(MidRouteFixtureMixin, TestCase):
    def _ready_order(self, suffix, client=None):
        print_job, pouch_job, _ = self.make_route_job(suffix)
        rolls = self.plain_rolls(f"PL-{suffix}", print_job, count=2)
        order = self.print_order(print_job, client=client)
        sent = self.dispatch(order["id"], rolls, client=client)["order"]
        self.post_return(order["id"], self.printed_lot(sent, rolls[:1]), client=client)
        return order, print_job, pouch_job

    def test_permission_matrix(self):
        order, print_job, _ = self._ready_order("PM")
        for user in (self.planner, self.sales, self.watchman):
            with self.subTest(user=user.username):
                self.release(order["id"], client=self.client_for(user), expect=403, step_force_reason="x")
        print_job.refresh_from_db()
        self.assertEqual(print_job.job_state, "PAUSED")
        allowed = {"PMO": self.owner, "PMD": self.desk_user, "PME": self.extra_user, "PMS": self.store}
        for suffix, user in allowed.items():
            with self.subTest(user=user.username):
                own_order, own_job, _ = self._ready_order(suffix)
                result = self.release(own_order["id"], client=self.client_for(user), step_force_reason="Continue in-house")
                self.assertEqual(result["step"]["action"], "STEP_COMPLETED")
                own_job.refresh_from_db()
                self.assertEqual((own_job.job_state, own_job.closed_by_id), ("COMPLETED", user.id))

    def test_replay_conflict_and_state_errors(self):
        order, print_job, pouch_job = self._ready_order("RP")
        payload = {"client_token": token(), "step_force_reason": "Continue in-house"}
        first = self.api.post(f"/api/inventory/job-work/{order['id']}/release-step/", payload, format="json")
        self.assertEqual(first.status_code, 200, first.data)
        self.assertFalse(first.data["replayed"])
        again = self.api.post(f"/api/inventory/job-work/{order['id']}/release-step/", payload, format="json")
        self.assertEqual(again.status_code, 200)
        self.assertTrue(again.data["replayed"])
        changed = self.api.post(f"/api/inventory/job-work/{order['id']}/release-step/", {**payload, "step_force_reason": "Other"}, format="json")
        self.assertEqual(changed.status_code, 409)
        twice = self.release(order["id"], expect=409, step_force_reason="Again")
        self.assertIn("already continued", twice["message"])
        self.assertEqual(GateAuditEvent.objects.filter(object_id=order["id"], action="JW_STEP_RELEASED").count(), 1)
        bad = self.api.post(f"/api/inventory/job-work/{order['id']}/release-step/", {"step_force_reason": "x"}, format="json")
        self.assertEqual(bad.status_code, 400)
        missing = self.api.post("/api/inventory/job-work/00000000-0000-0000-0000-000000000000/release-step/", {"client_token": token()}, format="json")
        self.assertEqual(missing.status_code, 404)

    def test_emergency_and_draft_orders_cannot_release(self):
        roll = self.make_roll("PR-EMR-1", "40")
        draft = self.create_order()
        self.release(draft["id"], expect=409)
        sent = self.dispatch(draft["id"], [roll])["order"]
        self.post_return(draft["id"], {
            "sent_lines": [{"sent_line_id": sent["sent_lines"][0]["id"], "disposition": "PROCESSED"}],
            "output_rolls": [{"material_id": str(self.lam_film.id), "weight_kg": "38", "width_mm": "830", "thickness_micron": "30", "location_id": str(self.wip.id)}],
            "wastage": {"kg": "2"},
        })
        refused = self.release(draft["id"], expect=409)
        self.assertIn("planned route-step order", refused["message"])
