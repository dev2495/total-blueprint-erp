from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from apps.production.services.services_execution import ExecutionService


class ExecutionProfileTargetTests(SimpleTestCase):
    def _build_job(self, *, current_step_index: int, stop_step_index: int | None):
        process = SimpleNamespace(input_form="ROLL", roll_behavior="MULTI_INPUT_COMBINE")
        mts_order = SimpleNamespace(stop_step_index=stop_step_index, target_qty=Decimal("700"), total_weight_kg=Decimal("700"))
        routing_rule = SimpleNamespace(ordered_processes=["P1", "P2", "P3", "P4"])
        return SimpleNamespace(
            id=f"profile-job-{current_step_index}",
            current_process=process,
            process=process,
            current_step_index=current_step_index,
            routing_rule=routing_rule,
            mts_order=mts_order,
            sales_order_item=None,
            quantity=Decimal("10"),
            uom="KG",
        )

    @patch("apps.production.services.services_execution.JobExecutionLog.objects.filter")
    @patch("apps.production.services.services_execution.JobMaterialRequirement.objects.select_related")
    @patch.object(ExecutionService, "calculate_requirements")
    @patch.object(ExecutionService, "_resolve_step_roll_spec", return_value={})
    @patch.object(ExecutionService, "_job_unit_weight_g", return_value=Decimal("1000"))
    @patch.object(
        ExecutionService,
        "_job_bom_snapshot",
        return_value={"films": [{"weight_kg": "0.2", "density_g_cm3": "1.4", "source": "PURCHASE"}]},
    )
    def test_stock_stop_step_forces_terminal_order_target(
        self,
        _mock_bom,
        _mock_unit_weight,
        _mock_roll_spec,
        _mock_calc_requirements,
        mock_select_related,
        mock_execution_logs,
    ):
        mock_select_related.return_value.filter.return_value = []
        mock_execution_logs.return_value.only.return_value = []

        job = self._build_job(current_step_index=2, stop_step_index=2)

        profile = ExecutionService._resolve_step_execution_profile_v2(job)

        self.assertAlmostEqual(profile["step_target_total_kg"], 700.0, places=6)
        self.assertAlmostEqual(profile["step_roll_target_kg"], 700.0, places=6)
        self.assertEqual(profile["target_source"], "V2_FINAL_STEP_ORDER_TARGET")

    @patch("apps.production.services.services_execution.JobExecutionLog.objects.filter")
    @patch("apps.production.services.services_execution.JobMaterialRequirement.objects.select_related")
    @patch.object(ExecutionService, "calculate_requirements")
    @patch.object(ExecutionService, "_resolve_step_roll_spec", return_value={})
    @patch.object(ExecutionService, "_job_unit_weight_g", return_value=Decimal("1000"))
    @patch.object(
        ExecutionService,
        "_job_bom_snapshot",
        return_value={"films": [{"weight_kg": "0.2", "density_g_cm3": "1.4", "source": "PURCHASE"}]},
    )
    def test_non_terminal_step_keeps_step_level_derivation(
        self,
        _mock_bom,
        _mock_unit_weight,
        _mock_roll_spec,
        _mock_calc_requirements,
        mock_select_related,
        mock_execution_logs,
    ):
        mock_select_related.return_value.filter.return_value = []
        mock_execution_logs.return_value.only.return_value = []

        # stop step is 2, but current step is 1 -> not terminal for this order.
        job = self._build_job(current_step_index=1, stop_step_index=2)

        profile = ExecutionService._resolve_step_execution_profile_v2(job)

        # quantity=10 KG with unit_weight=1000g => 10 pcs; film weight=0.2 kg per pc => 2.0 kg
        self.assertAlmostEqual(profile["step_target_total_kg"], 2.0, places=6)
        self.assertEqual(profile["target_source"], "V2_COMBINE_FILM_SUM")
