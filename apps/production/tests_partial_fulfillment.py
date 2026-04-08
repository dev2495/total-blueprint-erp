from contextlib import nullcontext
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import SimpleTestCase
from apps.production.services.job_services import JobService
from apps.production.views_planner import PlannerViewSet


class JobServicePartialFulfillmentTests(SimpleTestCase):
    def _build_job(self):
        sales_order = SimpleNamespace(status="RELEASED", save=Mock())
        so_item = SimpleNamespace(sales_order=sales_order, total_weight_kg=Decimal("100"))
        job = SimpleNamespace(
            sales_order_item=so_item,
            routing_rule=SimpleNamespace(ordered_processes=["P1", "P2", "P3"]),
            current_step_index=2,
        )
        return job, sales_order, so_item

    @patch("apps.production.services.job_services.ProductionJob.objects.filter")
    @patch.object(JobService, "_sales_item_shortfall_metrics")
    def test_final_step_sets_planning_required_for_high_shortfall(self, mock_metrics, mock_filter):
        job, sales_order, _ = self._build_job()
        mock_metrics.return_value = {"requires_replan": True}
        mock_filter.return_value.exclude.return_value.exists.return_value = False

        JobService._update_sales_order_post_final_step(job)

        self.assertEqual(sales_order.status, "PLANNING_REQUIRED")
        sales_order.save.assert_called_once_with(update_fields=["status"])

    @patch("apps.production.services.job_services.ProductionJob.objects.filter")
    @patch.object(JobService, "_sales_item_shortfall_metrics")
    def test_final_step_sets_packing_ready_when_shortfall_within_threshold(self, mock_metrics, mock_filter):
        job, sales_order, _ = self._build_job()
        mock_metrics.return_value = {"requires_replan": False}
        mock_filter.return_value.exclude.return_value.exists.return_value = False

        JobService._update_sales_order_post_final_step(job)

        self.assertEqual(sales_order.status, "PACKING_READY")
        sales_order.save.assert_called_once_with(update_fields=["status"])

    @patch("apps.production.services.job_services.ProductionJob.objects.filter")
    @patch.object(JobService, "_sales_item_shortfall_metrics")
    def test_final_step_does_not_change_status_if_active_jobs_exist(self, mock_metrics, mock_filter):
        job, sales_order, _ = self._build_job()
        mock_metrics.return_value = {"requires_replan": True}
        mock_filter.return_value.exclude.return_value.exists.return_value = True

        JobService._update_sales_order_post_final_step(job)

        self.assertEqual(sales_order.status, "RELEASED")
        sales_order.save.assert_not_called()

    @patch.object(JobService, "_sales_item_final_output_kg")
    def test_shortfall_metrics_require_replan_even_when_final_output_zero(self, mock_output):
        mock_output.return_value = Decimal("0")
        so_item = SimpleNamespace(total_weight_kg=Decimal("50"))

        metrics = JobService._sales_item_shortfall_metrics(so_item, route_last_index=3)

        self.assertEqual(metrics["shortfall_kg"], Decimal("50"))
        self.assertEqual(metrics["shortfall_pct"], Decimal("100"))
        self.assertTrue(metrics["requires_replan"])

    @patch.object(JobService, "_sales_item_final_output_kg")
    def test_shortfall_metrics_for_partial_50_target_30_produced(self, mock_output):
        mock_output.return_value = Decimal("30")
        so_item = SimpleNamespace(total_weight_kg=Decimal("50"))

        metrics = JobService._sales_item_shortfall_metrics(so_item, route_last_index=3)

        self.assertEqual(metrics["target_kg"], Decimal("50"))
        self.assertEqual(metrics["produced_kg"], Decimal("30"))
        self.assertEqual(metrics["shortfall_kg"], Decimal("20"))
        self.assertEqual(metrics["shortfall_pct"], Decimal("40"))
        self.assertTrue(metrics["requires_replan"])


class PlannerShortCloseTests(SimpleTestCase):
    @patch("apps.production.views_planner.transaction.atomic")
    @patch("apps.production.views_planner.ProductionJob.objects.filter")
    @patch.object(PlannerViewSet, "_sales_partial_metrics")
    @patch.object(PlannerViewSet, "_get_order_for_kind")
    def test_short_close_sales_order_updates_status_and_reason(
        self,
        mock_get_order,
        mock_partial_metrics,
        mock_job_filter,
        mock_atomic,
    ):
        mock_atomic.return_value = nullcontext()
        mock_partial_metrics.return_value = {
            "shortfall_kg": Decimal("8.5"),
            "shortfall_pct": Decimal("12.5"),
        }
        final_job = SimpleNamespace(
            completion_force_reason=None,
            save=Mock(),
        )
        mock_job_filter.return_value.order_by.return_value.first.return_value = final_job

        sales_item = SimpleNamespace()
        sales_order = SimpleNamespace(
            id="SO-1",
            status="PLANNING_REQUIRED",
            save=Mock(),
            items=SimpleNamespace(first=lambda: sales_item),
        )
        template = SimpleNamespace()
        mock_get_order.return_value = ("sales", sales_order, template, 3)

        request = SimpleNamespace(
            data={"reason": "Customer accepted short close"},
            user=SimpleNamespace(is_authenticated=False),
        )

        view = PlannerViewSet()
        response = view.control_hub_short_close(request, order_kind="sales", order_id="SO-1")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(sales_order.status, "PACKING_READY")
        sales_order.save.assert_called_once_with(update_fields=["status"])
        self.assertIn("Planner short-close", str(final_job.completion_force_reason))
        final_job.save.assert_called_once()
