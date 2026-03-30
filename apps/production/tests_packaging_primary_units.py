from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from apps.production.services.job_services import JobService
from apps.production.services.services_execution import ExecutionService


class PackagingPrimaryUnitTests(SimpleTestCase):
    databases = {"default"}

    def test_roll_to_bulk_packaging_job_uses_pcs_as_primary_unit(self):
        process = SimpleNamespace(input_form="ROLL", output_form="BULK")
        job = SimpleNamespace(
            mts_order=SimpleNamespace(stock_purpose="PACKAGING"),
            current_process=process,
            process=process,
            uom="PCS",
            quantity=Decimal("4"),
            produced_qty=Decimal("2"),
            remaining_qty=Decimal("2"),
        )

        metrics = ExecutionService._resolve_primary_step_metrics(
            job,
            process=process,
            step_target_total_kg=Decimal("1.0000"),
            step_produced_kg=Decimal("0.5000"),
            step_remaining_kg=Decimal("0.5000"),
            step_target_pcs=Decimal("4"),
            step_produced_pcs=Decimal("2"),
            step_remaining_pcs=Decimal("2"),
            tolerance_kg=Decimal("0.25"),
        )

        self.assertEqual(metrics["primary_uom"], "PCS")
        self.assertEqual(metrics["secondary_uom"], "KG")
        self.assertEqual(metrics["step_target_primary"], 4.0)
        self.assertEqual(metrics["step_produced_primary"], 2.0)
        self.assertEqual(metrics["step_remaining_primary"], 2.0)
        self.assertEqual(metrics["tolerance_primary"], 0.01)

    @patch("apps.production.services.job_services.JobExecutionLog.objects.create")
    @patch("apps.production.services.services_execution.ExecutionService.execute_completion")
    def test_log_output_event_uses_output_pcs_for_piece_jobs(self, mock_execute_completion, mock_log_create):
        job = SimpleNamespace(
            id="job-1",
            job_state="EXECUTING",
            status="RUNNING",
            uom="PCS",
            quantity=Decimal("4"),
            produced_qty=Decimal("0"),
            remaining_qty=Decimal("4"),
            save=MagicMock(),
        )

        JobService.log_output_event(
            job,
            Decimal("1.2000"),
            completion_meta={"output_pcs": 4},
            user=None,
        )

        self.assertEqual(job.produced_qty, Decimal("4"))
        self.assertEqual(job.remaining_qty, Decimal("0"))
        mock_execute_completion.assert_called_once()
        mock_log_create.assert_called_once()

    @patch.object(JobService, "_finalize_step_completion")
    @patch("apps.production.services.services_execution.ExecutionService.reconcile_step_material_actuals")
    @patch("apps.production.services.services_execution.ExecutionService._reconcile_step_bulk_consumption")
    @patch("apps.production.services.services_execution.ExecutionService.get_step_execution_profile")
    def test_complete_step_uses_primary_piece_remaining_for_roll_to_bulk_packaging_jobs(
        self,
        mock_step_profile,
        mock_reconcile_bulk,
        mock_reconcile_actuals,
        mock_finalize,
    ):
        job = SimpleNamespace(
            id="job-1",
            job_state="EXECUTING",
            status="RUNNING",
            from_location_id=None,
            work_center=None,
        )
        mock_step_profile.return_value = {
            "primary_uom": "PCS",
            "step_remaining_primary": 0.0,
            "tolerance_primary": 0.01,
            "step_remaining_kg": 0.2500,
            "step_produced_kg": 0.7500,
        }
        mock_finalize.return_value = job

        result = JobService.complete_step(job, user=None)

        self.assertIs(result, job)
        mock_reconcile_bulk.assert_called_once()
        mock_reconcile_actuals.assert_called_once()
        mock_finalize.assert_called_once_with(
            job,
            user=None,
            closed_with_variance=False,
            variance_kg=Decimal("0"),
            force_reason=None,
        )
