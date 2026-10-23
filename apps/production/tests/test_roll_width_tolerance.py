"""The floor roll picker accepts rolls within ±15 mm of the planned web, and a whole
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
        self.assertEqual(as_is_window(Decimal("540")), (Decimal("525"), Decimal("594.00")))
        self.assertEqual(as_is_window(Decimal("100")), (Decimal("85"), Decimal("115")))
        self.assertTrue(usable_as_is(530, 540))
        self.assertTrue(usable_as_is(525, 540))
        self.assertFalse(usable_as_is(524, 540))
        self.assertTrue(too_narrow(510, 540))
        self.assertFalse(too_narrow(530, 540))

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

    def test_a_roll_more_than_15mm_narrower_is_refused(self):
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
