"""The floor roll picker accepts rolls within ±20 mm of the planned web, and a whole
roll picked as it is never pays slitting trim (the 'requested children=540 > parent
width=530' refusal from the WC terminal)."""
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.test import TestCase, override_settings

from apps.factory.models import Process
from apps.production.services.roll_allocation_service import RollAllocationService
from apps.production.services.roll_width import as_is_window, too_narrow, usable_as_is
from apps.production.tests import test_roll_allocation_batch as batch


class RollWidthToleranceTests(batch._FakeAssignMixin, TestCase):
    _job = batch.RollAllocationBatchTests._job
    _roll = batch.RollAllocationBatchTests._roll

    def setUp(self):
        batch.RollAllocationBatchTests.setUp(self)
        # A printing step: slitting there costs trim, which a whole-roll pick must not pay.
        self.process = Process.objects.create(code="PRINT-TOL", name="Rotogravure print", input_form="ROLL", output_form="ROLL", roll_behavior="MODIFY_EXISTING")
        self.job.current_process = self.process
        self.job.process = self.process
        self.job.meta_json = {**self.job.meta_json, "planned_parent_width_mm": 540.0}
        self.job.save(update_fields=["current_process", "process", "meta_json"])

    def test_window(self):
        self.assertEqual(as_is_window(Decimal("540")), (Decimal("520"), Decimal("560")))
        self.assertEqual(as_is_window(Decimal("100")), (Decimal("80"), Decimal("120")))
        self.assertTrue(usable_as_is(530, 540))
        self.assertTrue(usable_as_is(520, 540))
        self.assertTrue(usable_as_is(560, 540))
        self.assertFalse(usable_as_is(519, 540))
        self.assertFalse(usable_as_is(561, 540), "no +10% widening any more: wider than +20 mm is slit")
        self.assertTrue(too_narrow(510, 540))
        self.assertFalse(too_narrow(525, 540))

    def test_a_10mm_narrower_roll_is_picked_whole_without_trim(self):
        roll = self._roll("ROLL-530", width="530.00", weight="854.940")
        widths, jobs = RollAllocationService._resolve_pick_plan(self.job, roll, "ONE")
        self.assertEqual(widths, [530.0])
        with self._patch_execution_helpers():
            result = RollAllocationService.perform_slit_assign_batch(
                job=self.job, picks=[{"roll_id": str(roll.id), "mode": "ONE"}], user=self.user,
            )
        self.assertEqual(result["picks_count"], 1)
        roll.refresh_from_db()
        self.assertEqual(roll.status, "CONSUMED")

    def test_a_roll_more_than_20mm_narrower_is_refused(self):
        roll = self._roll("ROLL-510", width="510.00", weight="296.600")
        with self.assertRaises(ValueError):
            RollAllocationService._resolve_pick_plan(self.job, roll, "ONE")
        with self._patch_execution_helpers():
            with self.assertRaises(ValidationError):
                RollAllocationService.perform_slit_assign_batch(
                    job=self.job, picks=[{"roll_id": str(roll.id), "mode": "ONE"}], user=self.user,
                )
        roll.refresh_from_db()
        self.assertEqual(roll.status, "AVAILABLE")

    def test_a_wider_roll_beyond_the_window_still_slits_with_trim(self):
        roll = self._roll("ROLL-1200", width="1200.00", weight="900.000")
        widths, _ = RollAllocationService._resolve_pick_plan(self.job, roll, "ONE")
        self.assertEqual(widths, [540.0])

    @override_settings(ROLL_PICK_WIDTH_TOLERANCE_MM=5)
    def test_tolerance_is_a_setting(self):
        self.assertFalse(usable_as_is(530, 540))
        self.assertTrue(usable_as_is(536, 540))


class LaneAwareRunWebTests(TestCase):
    """A multi-lane line runs its planned parent web until the route slits it; then each lane is a child roll."""

    def setUp(self):
        from apps.routing.models import RoutingRule

        Process.objects.create(code="PRT-LANE", name="Print", input_form="ROLL", output_form="ROLL", roll_behavior="MODIFY_EXISTING")
        Process.objects.create(code="SLT-LANE", name="Slit", input_form="ROLL", output_form="ROLL", roll_behavior="SPLIT")
        Process.objects.create(code="PCH-LANE", name="Pouch", input_form="ROLL", output_form="PCS", roll_behavior="NONE")
        self.rule = RoutingRule.objects.create(name="Lane route", ordered_processes=["PRT-LANE", "SLT-LANE", "PCH-LANE"])

    def _job(self, step, parent=700.0):
        from types import SimpleNamespace

        return SimpleNamespace(id=f"job-{step}", routing_rule=self.rule, current_step_index=step, sales_order_item=None, meta_json={"planned_parent_width_mm": parent})

    def test_three_up_runs_the_parent_web_before_slitting_and_the_child_after(self):
        from apps.production.services.services_execution import ExecutionService

        print_job, slit_job, pouch_job = self._job(0), self._job(1), self._job(2)
        self.assertEqual(ExecutionService._run_web_width(print_job, None, 230.0), 700.0, "3-up 230 mm prints on the 700 mm web")
        self.assertEqual(ExecutionService._run_web_width(slit_job, None, 230.0), 700.0, "slitting takes the parent web in")
        self.assertEqual(ExecutionService._run_web_width(pouch_job, None, 230.0), 230.0, "after slitting each lane is a 230 mm roll")
        self.assertTrue(usable_as_is(718, 700))
        self.assertTrue(usable_as_is(681, 700))
        self.assertFalse(usable_as_is(495, 700))
        self.assertTrue(too_narrow(495, 700), "a 495 mm roll cannot run a 3-up 700 mm web")

    def test_one_up_and_unset_parent_keep_the_layer_width(self):
        from apps.production.services.services_execution import ExecutionService

        self.assertEqual(ExecutionService._run_web_width(self._job(0, parent=0), None, 655.0), 655.0)
        self.assertEqual(ExecutionService._run_web_width(self._job(0, parent=659.0), None, 655.0), 659.0)
        self.assertEqual(ExecutionService._run_web_width(self._job(0, parent=600.0), None, 655.0), 655.0, "a parent narrower than the layer is ignored")
