from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase, TestCase

from apps.production.services.operator_service import OperatorService
from apps.production.services.services_execution import ExecutionService


class _FakeRequirement:
    def __init__(self, **kwargs):
        self.id = kwargs.get("id", 1)
        self.material_id = kwargs.get("material_id", "mat-1")
        self.material = kwargs.get("material", SimpleNamespace(id="mat-1", category="ADHESIVE", name="Test Adhesive"))
        self.theoretical_qty = kwargs.get("theoretical_qty", Decimal("1.2000"))
        self.planned_issue_qty = kwargs.get("planned_issue_qty", Decimal("1.5000"))
        self.required_qty = kwargs.get("required_qty", Decimal("1.2000"))
        self.uom = kwargs.get("uom", "KG")
        self.consumed_qty = kwargs.get("consumed_qty", Decimal("0.0000"))
        self.actual_issued_qty = kwargs.get("actual_issued_qty", Decimal("0.0000"))
        self.actual_returned_qty = kwargs.get("actual_returned_qty", Decimal("0.0000"))
        self.actual_scrap_qty = kwargs.get("actual_scrap_qty", Decimal("0.0000"))
        self.variance_qty = kwargs.get("variance_qty", Decimal("0.0000"))
        self.is_estimated = kwargs.get("is_estimated", True)
        self._saved = False

    def save(self, update_fields=None):
        self._saved = True
        self._update_fields = list(update_fields or [])


class _FakeRequirementQuerySet(list):
    def exists(self):
        return bool(self)


class ReconcileStepMaterialActualsTests(SimpleTestCase):
    def _job(self):
        return SimpleNamespace(
            id="job-1",
            job_number="JOB-001",
            current_step_index=0,
            from_location_id="loc-1",
            work_center=None,
        )

    def test_granule_requirements_default_to_confirm_mode_for_code_issue(self):
        req = _FakeRequirement(
            material_id="granule-1",
            material=SimpleNamespace(id="granule-1", category="GRANULE", name="LDPE Granule"),
        )

        self.assertEqual(
            ExecutionService._resolve_requirement_capture_mode(req),
            "AUTO_ESTIMATED_CONFIRM",
        )

    @patch("apps.production.services.services_execution.MaterialConsumptionLog.objects.create")
    @patch("apps.production.services.services_execution.BulkService.consume_bulk")
    @patch("apps.production.services.services_execution.ExecutionService._resolve_requirement_capture_mode")
    @patch("apps.production.services.services_execution.InventoryLocation.objects.filter")
    @patch("apps.production.services.services_execution.JobMaterialRequirement.objects.select_related")
    def test_confirmed_material_actuals_persist_to_requirement_and_bulk_ledger(
        self,
        mock_select_related,
        mock_location_filter,
        mock_capture_mode,
        mock_consume_bulk,
        mock_log_create,
    ):
        req = _FakeRequirement()
        mock_capture_mode.return_value = "AUTO_ESTIMATED_CONFIRM"
        mock_select_related.return_value.filter.return_value = _FakeRequirementQuerySet([req])
        mock_location_filter.return_value.first.return_value = SimpleNamespace(id="loc-1", plant_id="plant-1")

        ExecutionService.reconcile_step_material_actuals(
            self._job(),
            material_confirmations=[
                {
                    "requirement_id": req.id,
                    "material_id": req.material_id,
                    "actual_issued_qty": "1.7000",
                    "actual_returned_qty": "0.2000",
                    "actual_scrap_qty": "0.1000",
                    "is_estimated": False,
                }
            ],
            consumption_location_id="loc-1",
            strict=True,
        )

        self.assertEqual(req.actual_issued_qty, Decimal("1.7000"))
        self.assertEqual(req.actual_returned_qty, Decimal("0.2000"))
        self.assertEqual(req.actual_scrap_qty, Decimal("0.1000"))
        self.assertEqual(req.consumed_qty, Decimal("1.5000"))
        self.assertEqual(req.variance_qty, Decimal("0.3000"))
        self.assertFalse(req.is_estimated)
        self.assertTrue(req._saved)
        mock_consume_bulk.assert_called_once()
        mock_log_create.assert_called_once()

    @patch("apps.production.services.services_execution.MaterialConsumptionLog.objects.create")
    @patch("apps.production.services.services_execution.BulkService.consume_bulk")
    @patch("apps.production.services.services_execution.InventoryLocation.objects.filter")
    @patch("apps.production.services.services_execution.JobMaterialRequirement.objects.select_related")
    def test_ink_requirements_are_not_reconciled_from_machine_actuals(
        self,
        mock_select_related,
        mock_location_filter,
        mock_consume_bulk,
        mock_log_create,
    ):
        req = _FakeRequirement(
            material=SimpleNamespace(id="ink-1", category="INK", name="Theory Ink"),
            material_id="ink-1",
        )
        mock_select_related.return_value.filter.return_value = _FakeRequirementQuerySet([req])
        mock_location_filter.return_value.first.return_value = SimpleNamespace(id="loc-1", plant_id="plant-1")

        ExecutionService.reconcile_step_material_actuals(
            self._job(),
            material_confirmations=[
                {
                    "requirement_id": req.id,
                    "material_id": req.material_id,
                    "actual_issued_qty": "1.7000",
                    "actual_returned_qty": "0.2000",
                    "actual_scrap_qty": "0.1000",
                    "is_estimated": False,
                }
            ],
            consumption_location_id="loc-1",
            strict=True,
        )

        self.assertEqual(req.actual_issued_qty, Decimal("0.0000"))
        self.assertEqual(req.consumed_qty, Decimal("0.0000"))
        self.assertFalse(req._saved)
        mock_consume_bulk.assert_not_called()
        mock_log_create.assert_not_called()

    @patch("apps.production.services.services_execution.MaterialConsumptionLog.objects.create")
    @patch("apps.production.services.services_execution.ExecutionService._resolve_requirement_capture_mode")
    @patch("apps.production.services.services_execution.InventoryLocation.objects.filter")
    @patch("apps.production.services.services_execution.JobMaterialRequirement.objects.select_related")
    def test_auto_from_output_rows_use_existing_consumption_without_manual_confirmation(
        self,
        mock_select_related,
        mock_location_filter,
        mock_capture_mode,
        mock_log_create,
    ):
        req = _FakeRequirement(
            material=SimpleNamespace(id="mat-2", category="ADHESIVE", name="Test Adhesive"),
            consumed_qty=Decimal("2.2500"),
            theoretical_qty=Decimal("2.0000"),
            planned_issue_qty=Decimal("2.4000"),
        )
        mock_capture_mode.return_value = "AUTO_FROM_OUTPUT"
        mock_select_related.return_value.filter.return_value = _FakeRequirementQuerySet([req])
        mock_location_filter.return_value.first.return_value = SimpleNamespace(id="loc-1", plant_id="plant-1")

        ExecutionService.reconcile_step_material_actuals(
            self._job(),
            material_confirmations=[],
            consumption_location_id="loc-1",
            strict=False,
        )

        self.assertEqual(req.actual_issued_qty, Decimal("2.2500"))
        self.assertEqual(req.actual_returned_qty, Decimal("0.0000"))
        self.assertEqual(req.actual_scrap_qty, Decimal("0.0000"))
        self.assertEqual(req.consumed_qty, Decimal("2.2500"))
        self.assertEqual(req.variance_qty, Decimal("0.2500"))
        self.assertFalse(req.is_estimated)
        self.assertTrue(req._saved)
        mock_log_create.assert_not_called()

    @patch("apps.production.services.services_execution.MaterialConsumptionLog.objects.create")
    @patch("apps.production.services.services_execution.BulkService.consume_bulk")
    @patch("apps.production.services.services_execution.ExecutionService._resolve_requirement_capture_mode")
    @patch("apps.production.services.services_execution.InventoryLocation.objects.filter")
    @patch("apps.production.services.services_execution.JobMaterialRequirement.objects.select_related")
    def test_granule_code_allocations_split_issue_and_log_by_code(
        self,
        mock_select_related,
        mock_location_filter,
        mock_capture_mode,
        mock_consume_bulk,
        mock_log_create,
    ):
        req = _FakeRequirement(
            material_id="granule-1",
            material=SimpleNamespace(id="granule-1", category="GRANULE", name="Milky Granule"),
            theoretical_qty=Decimal("4.0000"),
            planned_issue_qty=Decimal("4.0000"),
        )
        mock_capture_mode.return_value = "MANUAL_CONFIRM"
        mock_select_related.return_value.filter.return_value = _FakeRequirementQuerySet([req])
        mock_location_filter.return_value.first.return_value = SimpleNamespace(id="loc-1", plant_id="plant-1")

        ExecutionService.reconcile_step_material_actuals(
            self._job(),
            material_confirmations=[
                {
                    "requirement_id": req.id,
                    "material_id": req.material_id,
                    "actual_issued_qty": "4.0000",
                    "actual_returned_qty": "0.0000",
                    "actual_scrap_qty": "0.0000",
                    "is_estimated": False,
                    "granule_code_allocations": [
                        {"granule_code_id": "code-a", "qty_kg": "1.2500"},
                        {"granule_code_id": "code-b", "qty_kg": "2.7500"},
                    ],
                }
            ],
            consumption_location_id="loc-1",
            strict=True,
        )

        self.assertEqual(req.actual_issued_qty, Decimal("4.0000"))
        self.assertEqual(req.actual_returned_qty, Decimal("0.0000"))
        self.assertEqual(req.actual_scrap_qty, Decimal("0.0000"))
        self.assertEqual(req.consumed_qty, Decimal("4.0000"))
        self.assertEqual(req.variance_qty, Decimal("0.0000"))
        self.assertFalse(req.is_estimated)
        self.assertTrue(req._saved)
        self.assertEqual(mock_consume_bulk.call_count, 2)
        first_call = mock_consume_bulk.call_args_list[0].kwargs
        second_call = mock_consume_bulk.call_args_list[1].kwargs
        self.assertEqual(first_call["granule_code_id"], "code-a")
        self.assertEqual(first_call["qty"], Decimal("1.2500"))
        self.assertEqual(second_call["granule_code_id"], "code-b")
        self.assertEqual(second_call["qty"], Decimal("2.7500"))
        self.assertEqual(mock_log_create.call_count, 2)


class OperatorOutputFailClosedTests(TestCase):
    @patch("apps.production.services.operator_service.JobService.log_output_event")
    @patch("apps.production.services.services_execution.ExecutionService.auto_satisfy_inputs")
    @patch("apps.production.services.operator_service.ProductionJob.objects.get")
    def test_output_is_not_logged_when_input_reservation_fails(
        self,
        mock_job_get,
        mock_auto_satisfy,
        mock_log_output,
    ):
        mock_job_get.return_value = SimpleNamespace(
            id="job-1",
            job_state="EXECUTING",
        )
        mock_auto_satisfy.side_effect = RuntimeError("reservation lookup failed")

        with self.assertRaisesRegex(RuntimeError, "reservation lookup failed"):
            OperatorService.log_output_step("job-1", 12.5, user=SimpleNamespace(id="user-1"))

        mock_log_output.assert_not_called()
