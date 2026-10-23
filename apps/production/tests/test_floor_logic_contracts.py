"""
Floor logic contracts (15 Oct 2026 review):
- roll steps are fed by mass (any number of rolls) unless the step fixes a count;
- a pause is downtime with a reason, closed on resume;
- only bulk->roll steps may run two orders together on one machine (DENY stops even that);
- add-on weight coefficients carry their basis (per 1 mm or per 10 mm);
- add-ons without a mapped step are issued at the last step of the route;
- a released line can be recalculated from masters only before any output.
"""
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase, TestCase
from django.utils import timezone

from apps.bom.services_resolver import BOMResolverService
from apps.factory.models import Machine, Plant, Process, WorkCenter
from apps.inventory.models import InventoryLocation
from apps.materials.models import InventoryMaterial
from apps.production.models import DowntimeLog, DowntimeReason, JobExecutionLog, ProductionJob
from apps.production.services.job_services import JobService, MachineBusyError
from apps.production.services.services_execution import ExecutionService
from apps.routing.models import RoutingRule
from apps.sales.models import SalesOrder, SalesOrderItem
from apps.sales.services.order_service import SalesOrderService
from apps.templates.models import TemplateBlueprint, TemplateProcessStep, TemplateProcessStepMaterial


class RollContractTests(SimpleTestCase):
    def _job(self, process):
        return SimpleNamespace(current_process=process, process=process)

    def test_roll_to_bulk_plain_step_is_mass_fed(self):
        process = SimpleNamespace(input_form="ROLL", output_form="BULK", roll_behavior="NONE")
        requirement = ExecutionService._roll_requirement(self._job(process), process, step_roll_spec={})
        self.assertEqual(requirement["mode"], "MASS")
        self.assertEqual(requirement["min_count"], 1)
        self.assertEqual(requirement["max_count"], ExecutionService.MASS_MODE_MAX_ROLLS)

    def test_combine_step_keeps_fixed_count(self):
        process = SimpleNamespace(input_form="ROLL", output_form="ROLL", roll_behavior="MULTI_INPUT_COMBINE")
        requirement = ExecutionService._roll_requirement(self._job(process), process, step_roll_spec={"input_roll_count": 2})
        self.assertEqual(requirement["mode"], "COUNT")
        self.assertEqual(requirement["max_count"], 2)

    def test_mass_mode_accepts_a_second_roll(self):
        process = SimpleNamespace(input_form="ROLL", output_form="BULK", roll_behavior="NONE")
        job = self._job(process)
        requirement = ExecutionService._roll_requirement(job, process, step_roll_spec={})
        with patch("apps.inventory.models.InventoryRoll.objects.filter") as roll_filter, \
             patch.object(ExecutionService, "_roll_lane_state", return_value={"mode": "MASS", "lanes": [{"lane_key": "MAIN", "remaining_kg": 0, "rolls": []}]}):
            roll_filter.return_value.select_related.return_value = []
            ExecutionService.validate_roll_selection(job, process, existing_roll_ids=[], new_roll_ids=["a", "b"], requirement=requirement)

    def test_single_unwinder_steps_queue_rolls(self):
        # Printing and slitting run one roll after another: queue-fed, not "exactly one".
        for behavior in ("MODIFY_EXISTING", "SPLIT"):
            process = SimpleNamespace(input_form="ROLL", output_form="ROLL", roll_behavior=behavior)
            requirement = ExecutionService._roll_requirement(self._job(process), process, step_roll_spec={})
            self.assertEqual(requirement["mode"], "MASS", behavior)
            self.assertEqual(requirement["min_count"], 1)

    def test_count_mode_refuses_extra_roll(self):
        process = SimpleNamespace(input_form="ROLL", output_form="ROLL", roll_behavior="MULTI_INPUT_COMBINE")
        job = self._job(process)
        requirement = ExecutionService._roll_requirement(job, process, step_roll_spec={"input_roll_count": 2})
        with self.assertRaises(ValueError):
            ExecutionService.validate_roll_selection(job, process, existing_roll_ids=["a", "b"], new_roll_ids=["c"], requirement=requirement)

    def test_bulk_step_takes_no_rolls(self):
        process = SimpleNamespace(input_form="BULK", output_form="ROLL", roll_behavior="NONE")
        job = self._job(process)
        with self.assertRaises(ValueError):
            ExecutionService.validate_roll_selection(job, process, existing_roll_ids=[], new_roll_ids=["a"])


class AddonBasisTests(TestCase):
    def setUp(self):
        self.template = TemplateBlueprint.objects.create(name="Basis Template", fg_type="POUCH", status="LIVE")
        self.process = Process.objects.create(code="BASIS_STEP", name="Basis Step")
        self.step = TemplateProcessStep.objects.create(template=self.template, sequence_number=1, process=self.process)
        TemplateProcessStepMaterial.objects.create(
            template_step=self.step,
            category_code="ADDON",
            consumption_basis="CATEGORY_FORMULA",
            formula_driver="ADDON_MASTER_WEIGHT_MODE",
            value=Decimal("0"),
            issue_policy_mode="NONE",
            capture_mode="AUTO_ESTIMATED_CONFIRM",
        )

    def _resolve(self, addon):
        template_snapshot = {
            "template_id": str(self.template.id),
            "order_qty": 1,
            "uom": "PCS",
            "addons": [{"addon_id": str(addon.id), "qty": 1, "applies_to": "WIDTH"}],
            "film_layers": [],
            "printing": {"enabled": False},
        }
        physics_snapshot = {"geometry_snapshot": {"finished_good_type": "POUCH", "effective_width_mm": 280, "effective_height_mm": 505}}
        return BOMResolverService.resolve(template_snapshot, physics_snapshot)["addons"][0]

    def test_per_10mm_basis_divides_the_coefficient(self):
        tape_per_mm = InventoryMaterial.objects.create(
            code="TAPE-PER-MM", name="Tape per mm", category="ADDON", base_uom="METER",
            weight_mode="PER_MM", weight_value=0.01, addon_weight_basis_mm=1,
            addon_is_purchased=True, addon_purchase_uom="METER",
        )
        tape_per_10mm = InventoryMaterial.objects.create(
            code="TAPE-PER-10MM", name="Tape per 10 mm", category="ADDON", base_uom="METER",
            weight_mode="PER_MM", weight_value=0.1, addon_weight_basis_mm=10,
            addon_is_purchased=True, addon_purchase_uom="METER",
        )
        row_mm = self._resolve(tape_per_mm)
        row_10mm = self._resolve(tape_per_10mm)
        # Same physical tape described two ways: 0.01 g/mm == 0.1 g per 10 mm.
        self.assertAlmostEqual(row_mm["weight_kg"], 0.0028, places=6)
        self.assertAlmostEqual(row_10mm["weight_kg"], 0.0028, places=6)
        self.assertEqual(row_10mm["weight_basis_mm"], 10)
        # Stock plan is one strip across the bag width: 0.28 m per bag, whatever the basis.
        self.assertAlmostEqual(row_10mm["stock_qty"], 0.28, places=6)


class FloorFixtureMixin:
    def build_floor(self):
        self.plant = Plant.objects.create(name="Floor Plant", code="FLOOR-PLANT")
        self.location = InventoryLocation.objects.create(plant=self.plant, code="FLOOR-RM", name="Floor RM", type="RM")
        self.work_center = WorkCenter.objects.create(plant=self.plant, name="Floor WC", code="FLOOR_WC", default_wip_location=self.location)
        self.pouching = Process.objects.create(code="FLOOR_POUCH", name="Pouching", input_form="ROLL", output_form="BULK", roll_behavior="NONE")
        self.extrusion = Process.objects.create(code="FLOOR_EXTR", name="Extrusion", input_form="BULK", output_form="ROLL", roll_behavior="NONE")
        self.route = RoutingRule.objects.create(name="Floor Route", ordered_processes=[self.pouching.code])
        self.template = TemplateBlueprint.objects.create(name="Floor Template", fg_type="POUCH", status="LIVE")
        self.step = TemplateProcessStep.objects.create(template=self.template, sequence_number=1, process=self.pouching)
        self.sales_order = SalesOrder.objects.create(customer_name="Floor Customer")
        self.item = SalesOrderItem.objects.create(sales_order=self.sales_order, template=self.template, qty_value=10, qty_uom="PCS", unit_price=1, bom_snapshot={})
        self.machine = Machine.objects.create(work_center=self.work_center, name="Mamata", code="MC-04")

    def make_job(self, number, process, *, running=False, machine=None):
        job = ProductionJob.objects.create(
            job_number=number,
            template=self.template,
            sales_order_item=self.item,
            routing_rule=self.route,
            current_step_index=0,
            current_process=process,
            process=process,
            work_center=self.work_center,
            from_location=self.location,
            quantity=Decimal("10"),
            uom="PCS",
            remaining_qty=Decimal("10"),
            machine=machine or self.machine,
        )
        if running:
            job.status = "RUNNING"
            job.job_state = "EXECUTING"
            job.start_date = timezone.now()
            job.save(update_fields=["status", "job_state", "start_date"])
        return job


class PauseDowntimeTests(FloorFixtureMixin, TestCase):
    def setUp(self):
        self.build_floor()
        self.job = self.make_job("JOB-PAUSE-1", self.pouching, running=True)

    def test_pause_records_downtime_and_resume_closes_it(self):
        power, _ = DowntimeReason.objects.get_or_create(code="POWER", defaults={"label": "Power failure"})
        cut = DowntimeReason.objects.create(code="POWER_GRID_E2E", label="Grid cut", parent=power)
        JobService.pause_job(self.job.id, "Grid went down", reason_code_id=str(cut.id))
        log = DowntimeLog.objects.get(production_job=self.job)
        self.assertEqual(log.source, "PAUSE")
        self.assertEqual(log.reason, "POWER")
        self.assertEqual(log.reason_code, cut)
        self.assertIsNone(log.end_time)
        self.job.refresh_from_db()
        self.assertEqual(self.job.job_state, "PAUSED")
        self.assertIn("Grid cut", self.job.hold_reason)

        JobService.resume_job(self.job.id)
        log.refresh_from_db()
        self.assertIsNotNone(log.end_time)
        self.job.refresh_from_db()
        self.assertEqual(self.job.job_state, "EXECUTING")
        self.assertEqual(self.job.hold_reason, "")

    def test_pause_needs_a_reason(self):
        with self.assertRaises(ValueError):
            JobService.pause_job(self.job.id, "")
        self.assertFalse(DowntimeLog.objects.filter(production_job=self.job).exists())

    def test_bucket_only_pause_is_enough(self):
        JobService.pause_job(self.job.id, "", reason_bucket="MATERIAL")
        log = DowntimeLog.objects.get(production_job=self.job)
        self.assertEqual(log.reason, "MATERIAL")


class MachineConcurrencyTests(FloorFixtureMixin, TestCase):
    def setUp(self):
        self.build_floor()
        self.running = self.make_job("JOB-RUN-1", self.pouching, running=True)

    def test_auto_policy_blocks_second_order_on_roll_to_bulk_step(self):
        waiting = self.make_job("JOB-WAIT-1", self.pouching)
        self.assertEqual(JobService.machine_concurrency_block(waiting), "JOB-RUN-1")
        with self.assertRaises(MachineBusyError):
            JobService.start_job(waiting)

    def test_auto_policy_allows_bulk_to_roll_steps_together(self):
        extruder = Machine.objects.create(work_center=self.work_center, name="Extruder", code="EX-01")
        self.make_job("JOB-EXT-1", self.extrusion, running=True, machine=extruder)
        second = self.make_job("JOB-EXT-2", self.extrusion, machine=extruder)
        self.assertIsNone(JobService.machine_concurrency_block(second))

    def test_only_bulk_to_roll_steps_run_several_orders_even_when_the_machine_allows_it(self):
        self.machine.concurrency_policy = "ALLOW"
        self.machine.save(update_fields=["concurrency_policy"])
        waiting = self.make_job("JOB-WAIT-2", self.pouching)
        self.assertEqual(JobService.machine_concurrency_block(waiting), "JOB-RUN-1", "pouching runs one order at a time")

    def test_resume_respects_the_policy(self):
        # A paused order cannot be resumed while another order runs on a one-at-a-time machine.
        paused = self.make_job("JOB-PAUSED-1", self.pouching)
        paused.status = "RUNNING"
        paused.job_state = "PAUSED"
        paused.save(update_fields=["status", "job_state"])
        with self.assertRaises(MachineBusyError):
            JobService.resume_job(paused.id)
        paused.refresh_from_db()
        self.assertEqual(paused.job_state, "PAUSED")

    def test_deny_policy_blocks_even_extrusion(self):
        extruder = Machine.objects.create(work_center=self.work_center, name="Extruder D", code="EX-02", concurrency_policy="DENY")
        self.make_job("JOB-EXT-D1", self.extrusion, running=True, machine=extruder)
        second = self.make_job("JOB-EXT-D2", self.extrusion, machine=extruder)
        self.assertEqual(JobService.machine_concurrency_block(second), "JOB-EXT-D1")


class AddonIssueStepTests(FloorFixtureMixin, TestCase):
    def setUp(self):
        self.build_floor()
        # Two-step route: printing then pouching. The template maps no step for ADDON.
        self.printing = Process.objects.create(code="FLOOR_PRINT", name="Printing", input_form="ROLL", output_form="ROLL", roll_behavior="NONE")
        self.step.sequence_number = 2
        self.step.save(update_fields=["sequence_number"])
        TemplateProcessStep.objects.create(template=self.template, sequence_number=1, process=self.printing)
        self.tape = InventoryMaterial.objects.create(
            code="TAPE-STEP", name="Tape step", category="ADDON", base_uom="METER",
            weight_mode="PER_MM", weight_value=0.01, addon_is_purchased=True, addon_purchase_uom="METER",
        )
        self.item.bom_snapshot = {
            "planning_lines": [
                {
                    "category_code": "ADDON",
                    "material_id": str(self.tape.id),
                    "material_code": self.tape.code,
                    "material_name": self.tape.name,
                    "uom": "METER",
                    "step_id": None,
                    "theoretical_qty": 2.8,
                    "planned_issue_qty": 2.8,
                }
            ]
        }
        self.item.save(update_fields=["bom_snapshot"])
        self.route.ordered_processes = [self.printing.code, self.pouching.code]
        self.route.save(update_fields=["ordered_processes"])
        self.job = self.make_job("JOB-ADDON-STEP", self.printing)

    def test_unmapped_addon_is_issued_at_the_last_step(self):
        requirements = ExecutionService.calculate_requirements_v2(self.job)
        tape_rows = [row for row in requirements if row.material_id == self.tape.id]
        self.assertEqual(len(tape_rows), 1)
        self.assertEqual(tape_rows[0].process_step.sequence_number, 2)
        self.assertEqual(tape_rows[0].uom, "METER")
        self.assertEqual(tape_rows[0].planned_issue_qty, Decimal("2.8000"))


class RecalculateFromMastersGuardTests(FloorFixtureMixin, TestCase):
    def setUp(self):
        self.build_floor()
        self.job = self.make_job("JOB-RECALC", self.pouching)

    def test_released_line_without_output_can_be_recalculated(self):
        self.assertIsNone(SalesOrderService.released_line_recalc_block_reason(self.item))

    def test_logged_output_blocks_recalculation(self):
        JobExecutionLog.objects.create(production_job=self.job, quantity=Decimal("1"), uom="PCS")
        reason = SalesOrderService.released_line_recalc_block_reason(self.item)
        self.assertIn("logged", reason)


class AddonShortageSwitchTests(FloorFixtureMixin, TestCase):
    """Add-on shortage at the current step is flagged, and blocks only when switched on."""

    def setUp(self):
        self.build_floor()
        self.tape = InventoryMaterial.objects.create(
            code="TAPE-SHORT", name="Tape short", category="ADDON", base_uom="METER",
            weight_mode="PER_MM", weight_value=0.01, addon_is_purchased=True, addon_purchase_uom="METER",
        )
        self.item.bom_snapshot = {
            "planning_lines": [
                {"category_code": "ADDON", "material_id": str(self.tape.id), "material_code": self.tape.code,
                 "material_name": self.tape.name, "uom": "METER", "step_id": str(self.step.id),
                 "theoretical_qty": 5.0, "planned_issue_qty": 5.0}
            ]
        }
        self.item.save(update_fields=["bom_snapshot"])
        self.job = self.make_job("JOB-ADDON-SHORT", self.pouching)

    def _status(self):
        return ExecutionService.get_satisfaction_status(str(self.job.id))

    def test_shortage_is_flagged_but_not_blocking_by_default(self):
        from django.test import override_settings
        with override_settings(ADDON_SHORTAGE_BLOCKS=False):
            status = self._status()
        tape_rows = [row for row in status["bulk_consumption"] if row.get("material_id") == str(self.tape.id)]
        self.assertEqual(len(tape_rows), 1)
        self.assertFalse(tape_rows[0]["blocking"])
        self.assertEqual(status["addon_shortages"][0]["material_id"], str(self.tape.id))
        self.assertAlmostEqual(status["addon_shortages"][0]["short_qty"], 5.0, places=3)

    def test_switch_on_makes_shortage_block(self):
        from django.test import override_settings
        with override_settings(ADDON_SHORTAGE_BLOCKS=True):
            status = self._status()
        tape_rows = [row for row in status["bulk_consumption"] if row.get("material_id") == str(self.tape.id)]
        self.assertTrue(tape_rows[0]["blocking"])
        self.assertEqual(status["addon_shortages"], [])
        self.assertFalse(status["is_satisfied"])


class AddonMasterPropagationTests(FloorFixtureMixin, TestCase):
    """Editing an add-on's weight basis re-resolves the open lines that use it."""

    def setUp(self):
        from apps.users.models import User
        self.build_floor()
        self.tape = InventoryMaterial.objects.create(
            code="TAPE-PROP", name="Tape prop", category="ADDON", base_uom="METER",
            weight_mode="PER_MM", weight_value=0.1, addon_weight_basis_mm=1, addon_is_purchased=True, addon_purchase_uom="METER",
        )
        self.item.bom_snapshot = {"addons": [{"addon_id": str(self.tape.id), "code": self.tape.code, "weight_kg": 0.028}]}
        self.item.save(update_fields=["bom_snapshot"])
        self.other = SalesOrderItem.objects.create(sales_order=self.sales_order, template=self.template, qty_value=5, qty_uom="PCS", unit_price=1, bom_snapshot={"addons": []})
        self.admin = User.objects.create_superuser(username="prop-admin", password="x", email="prop@example.com")

    def test_basis_change_refreshes_only_lines_using_the_addon(self):
        from unittest.mock import patch
        from rest_framework.test import APIClient
        client = APIClient()
        client.force_authenticate(user=self.admin)
        with patch("apps.sales.services.order_service.SalesOrderService.refresh_open_snapshots_for_items", return_value={"checked": 1, "refreshed": 1, "skipped": 0}) as refresh:
            response = client.patch(f"/api/materials/addons/{self.tape.id}/", {"addon_weight_basis_mm": 10}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.tape.refresh_from_db()
        self.assertEqual(self.tape.addon_weight_basis_mm, 10)
        self.assertIn("addon_weight_basis_mm", response.data["open_lines_refresh"]["changed_fields"])
        refresh.assert_called_once()
        queryset = refresh.call_args.args[0]
        self.assertEqual(list(queryset.values_list("id", flat=True)), [self.item.id])

    def test_name_only_edit_does_not_refresh(self):
        from unittest.mock import patch
        from rest_framework.test import APIClient
        client = APIClient()
        client.force_authenticate(user=self.admin)
        with patch("apps.sales.services.order_service.SalesOrderService.refresh_open_snapshots_for_items") as refresh:
            response = client.patch(f"/api/materials/addons/{self.tape.id}/", {"name": "Tape renamed"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertNotIn("open_lines_refresh", response.data)
        refresh.assert_not_called()


class RecalculateFromMastersTests(FloorFixtureMixin, TestCase):
    """The released line takes the current master weights; jobs get their requirements rebuilt."""

    def setUp(self):
        self.build_floor()
        self.item.unit_weight_g = Decimal("16.000000")
        self.item.total_weight_kg = Decimal("0.160000")
        self.item.save(update_fields=["unit_weight_g", "total_weight_kg"])
        self.job = self.make_job("JOB-RECALC-OK", self.pouching)

    def test_recalculation_saves_new_weights_and_rebuilds_requirements(self):
        from unittest.mock import patch
        preview = {"unit_weight_g": 16.73, "total_weight_kg": 0.1673, "bom": {"films": [], "addons": [], "planning_lines": []}}
        with patch("apps.sales.services.order_service.SalesOrderService.preview_sales_item", return_value=preview), \
             patch("apps.production.services.services_execution.ExecutionService.calculate_requirements") as calc:
            out = SalesOrderService.recalculate_line_bom_from_masters(self.item)
        self.item.refresh_from_db()
        self.assertEqual(self.item.unit_weight_g, Decimal("16.730000"))
        self.assertEqual(self.item.total_weight_kg, Decimal("0.167300"))
        self.assertEqual(out["before"]["unit_weight_g"], 16.0)
        self.assertEqual(out["jobs_recalculated"], 1)
        calc.assert_called_once()

    def test_preview_failure_is_refused_with_a_plain_message(self):
        from unittest.mock import patch
        from django.core.exceptions import ValidationError
        with patch("apps.sales.services.order_service.SalesOrderService.preview_sales_item", side_effect=ValidationError("bad artwork")):
            with self.assertRaises(ValidationError) as ctx:
                SalesOrderService.recalculate_line_bom_from_masters(self.item)
        self.assertIn("Could not rebuild this line's BOM", ctx.exception.messages[0])
        self.item.refresh_from_db()
        self.assertEqual(self.item.unit_weight_g, Decimal("16.000000"))
