from types import SimpleNamespace

from django.test import SimpleTestCase

from apps.production.services.services_execution import ExecutionService


class ExecutionBulkSemanticsTests(SimpleTestCase):
    def _job(self, *, fg_type="POUCH", current_step_index=0, route_len=3, stop_step_index=None, packaging=False):
        template = SimpleNamespace(fg_type=fg_type)
        routing_rule = SimpleNamespace(ordered_processes=list(range(route_len)))
        job = SimpleNamespace(
            current_step_index=current_step_index,
            routing_rule=routing_rule,
            template=template,
            template_id=None,
            mts_order=SimpleNamespace(stop_step_index=stop_step_index) if stop_step_index is not None else None,
            sales_order_item=None,
            to_location=None,
            work_center=None,
            from_location=None,
            packaging_purpose=packaging,
        )
        return job

    def test_terminal_pouch_bulk_step_creates_fg_semantics(self):
        job = self._job(fg_type="POUCH", current_step_index=2, route_len=3)
        process = SimpleNamespace(output_form="BULK")

        self.assertTrue(ExecutionService._is_terminal_pouch_fg_bulk_step(job, process=process))

    def test_intermediate_bulk_step_does_not_create_fg_semantics(self):
        job = self._job(fg_type="POUCH", current_step_index=1, route_len=3)
        process = SimpleNamespace(output_form="BULK")

        self.assertFalse(ExecutionService._is_terminal_pouch_fg_bulk_step(job, process=process))

    def test_terminal_roll_bulk_step_does_not_create_fg_batch_semantics(self):
        job = self._job(fg_type="ROLL", current_step_index=2, route_len=3)
        process = SimpleNamespace(output_form="BULK")

        self.assertFalse(ExecutionService._is_terminal_pouch_fg_bulk_step(job, process=process))

    def test_packaging_purpose_bulk_step_does_not_create_fg_semantics(self):
        job = self._job(fg_type="POUCH", current_step_index=2, route_len=3)
        process = SimpleNamespace(output_form="BULK")

        original = ExecutionService._is_packaging_purpose_job
        try:
            ExecutionService._is_packaging_purpose_job = classmethod(lambda cls, _job: True)
            self.assertFalse(ExecutionService._is_terminal_pouch_fg_bulk_step(job, process=process))
        finally:
            ExecutionService._is_packaging_purpose_job = original
