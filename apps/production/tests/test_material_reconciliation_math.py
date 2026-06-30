from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from apps.production.services.services_execution import ExecutionService


class ExecutionMathRegressionTests(SimpleTestCase):
    def test_planned_issue_qty_modes_are_deterministic(self):
        self.assertEqual(
            ExecutionService._planned_issue_qty(Decimal("10"), "PERCENT_OVER_THEORY", Decimal("5")),
            Decimal("10.5000"),
        )
        self.assertEqual(
            ExecutionService._planned_issue_qty(Decimal("10"), "FIXED_EXTRA_KG", Decimal("2.25")),
            Decimal("12.2500"),
        )
        self.assertEqual(
            ExecutionService._planned_issue_qty(Decimal("10"), "MINIMUM_ISSUE_KG", Decimal("12")),
            Decimal("12.0000"),
        )
        self.assertEqual(
            ExecutionService._planned_issue_qty(Decimal("-5"), "NONE", Decimal("0")),
            Decimal("0.0000"),
        )

    @patch("apps.production.services.services_execution.MaterialConsumptionLog.objects.create")
    @patch("apps.production.services.services_execution.BulkService.add_bulk")
    @patch("apps.production.services.services_execution.BulkService.consume_bulk")
    @patch("apps.production.services.services_execution.InventoryLocation.objects.filter")
    @patch("apps.production.services.services_execution.JobMaterialRequirement.objects.select_related")
    def test_actual_reconciliation_uses_issued_minus_returned_and_tracks_scrap(
        self,
        select_related,
        location_filter,
        consume_bulk,
        add_bulk,
        _log_create,
    ):
        requirement = MagicMock()
        requirement.id = "req-1"
        requirement.material_id = "mat-1"
        requirement.material = SimpleNamespace(name="Test Ink")
        requirement.uom = "KG"
        requirement.theoretical_qty = Decimal("8")
        requirement.actual_issued_qty = Decimal("0")
        requirement.actual_returned_qty = Decimal("0")
        requirement.actual_scrap_qty = Decimal("0")
        requirement.consumed_qty = Decimal("0")

        req_qs = MagicMock()
        req_qs.filter.return_value = req_qs
        req_qs.exists.return_value = True
        req_qs.__iter__.return_value = iter([requirement])
        select_related.return_value = req_qs

        location_filter.return_value.first.return_value = SimpleNamespace(id="loc-1", plant_id="plant-1")

        job = SimpleNamespace(id="job-1", current_step_index=0, job_number="JOB-1")
        confirmations = [
            {
                "requirement_id": "req-1",
                "actual_issued_qty": "10",
                "actual_returned_qty": "1",
                "actual_scrap_qty": "0.5",
                "is_estimated": False,
            }
        ]

        with patch.object(ExecutionService, "_resolve_requirement_capture_mode", return_value="MANUAL_CONFIRM"):
            ExecutionService.reconcile_step_material_actuals(
                job=job,
                material_confirmations=confirmations,
                consumption_location_id="loc-1",
                strict=True,
            )

        consume_bulk.assert_called_once()
        add_bulk.assert_not_called()
        self.assertEqual(requirement.actual_issued_qty, Decimal("10.0000"))
        self.assertEqual(requirement.actual_returned_qty, Decimal("1.0000"))
        self.assertEqual(requirement.actual_scrap_qty, Decimal("0.5000"))
        self.assertEqual(requirement.consumed_qty, Decimal("9.0000"))
        self.assertEqual(requirement.variance_qty, Decimal("1.0000"))
        requirement.save.assert_called_once()

    @patch("apps.production.services.services_execution.MaterialConsumptionLog.objects.create")
    @patch("apps.production.services.services_execution.BulkService.add_bulk")
    @patch("apps.production.services.services_execution.BulkService.consume_bulk")
    @patch("apps.production.services.services_execution.InventoryLocation.objects.filter")
    @patch("apps.production.services.services_execution.JobMaterialRequirement.objects.select_related")
    def test_bulk_reconcile_does_not_return_wcm_issued_material_as_negative_log(
        self,
        select_related,
        location_filter,
        consume_bulk,
        add_bulk,
        log_create,
    ):
        requirement = MagicMock()
        requirement.id = "req-wcm"
        requirement.material_id = "mat-wcm"
        requirement.material = SimpleNamespace(name="WCM Granule", category="GRANULE")
        requirement.uom = "KG"
        requirement.required_qty = Decimal("10.0000")
        requirement.theoretical_qty = Decimal("10.0000")
        requirement.actual_issued_qty = Decimal("10.0000")
        requirement.actual_returned_qty = Decimal("0.0000")
        requirement.consumed_qty = Decimal("10.0000")
        requirement.variance_qty = Decimal("0.0000")
        requirement.is_estimated = False

        req_qs = MagicMock()
        req_qs.filter.return_value = req_qs
        req_qs.exists.return_value = True
        req_qs.__iter__.return_value = iter([requirement])
        select_related.return_value = req_qs
        location_filter.return_value.first.return_value = SimpleNamespace(id="loc-1", plant_id="plant-1")

        job = SimpleNamespace(id="job-1", current_step_index=0, job_number="JOB-WCM", quantity=Decimal("10.0000"))
        with patch.object(
            ExecutionService,
            "_resolve_step_execution_profile",
            return_value={"step_target_total_kg": Decimal("10.0000")},
        ), patch.object(ExecutionService, "_resolve_requirement_capture_mode", return_value="MANUAL_CONFIRM"):
            ExecutionService._reconcile_step_bulk_consumption(
                job=job,
                produced_kg=Decimal("8.0000"),
                consumption_location_id="loc-1",
            )

        consume_bulk.assert_not_called()
        add_bulk.assert_not_called()
        log_create.assert_not_called()
        self.assertEqual(requirement.consumed_qty, Decimal("10.0000"))
