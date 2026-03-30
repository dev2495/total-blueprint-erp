from contextlib import nullcontext
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from apps.production.services.job_services import WCManagerService
from apps.production.services.services_execution import ExecutionService


class WipRouteTruthTests(SimpleTestCase):
    def test_unassign_roll_keeps_reservation_truth_explicit(self):
        roll = SimpleNamespace(status="RESERVED", save=MagicMock())
        reservation = SimpleNamespace(
            roll=roll,
            quantity=Decimal("2.5000"),
            material="material-1",
            delete=MagicMock(),
        )
        requirement = SimpleNamespace(assigned_qty=Decimal("5.0000"), save=MagicMock())
        assignment = SimpleNamespace(allocated_rolls=MagicMock())
        remaining_reservations = MagicMock()
        remaining_reservations.values_list.return_value = ["roll-2"]
        remaining_roll_qs = object()

        with patch("apps.production.services.services_execution.transaction.atomic", return_value=nullcontext()), \
             patch("apps.production.services.services_execution.InventoryReservation.objects.get", return_value=reservation), \
             patch("apps.production.services.services_execution.JobMaterialRequirement.objects.filter") as requirement_filter, \
             patch("apps.production.services.services_execution.WorkCenterAssignment.objects.filter") as assignment_filter, \
             patch("apps.production.services.services_execution.InventoryReservation.objects.filter", return_value=remaining_reservations), \
             patch("apps.production.services.services_execution.InventoryRoll.objects.filter", return_value=remaining_roll_qs), \
             patch.object(ExecutionService, "get_job_context", return_value={"ok": True}) as get_job_context:
            requirement_filter.return_value.first.return_value = requirement
            assignment_filter.return_value.first.return_value = assignment

            result = ExecutionService.unassign_roll("job-1", "reservation-1")

        self.assertEqual(result, {"ok": True})
        self.assertEqual(roll.status, "AVAILABLE")
        roll.save.assert_called_once()
        reservation.delete.assert_called_once()
        self.assertEqual(requirement.assigned_qty, Decimal("2.5000"))
        requirement.save.assert_called_once()
        assignment.allocated_rolls.set.assert_called_once_with(remaining_roll_qs)
        get_job_context.assert_called_once_with("job-1", reconcile_assignment=False)

    def test_wc_manager_unassign_roll_does_not_auto_satisfy_inputs(self):
        job = SimpleNamespace(id="job-1")
        allocated_rolls = MagicMock()
        assignment = SimpleNamespace(
            id="assignment-1",
            production_job=job,
            allocated_rolls=allocated_rolls,
            assigned_by=None,
            assigned_at=None,
            save=MagicMock(),
        )
        remaining_reservations = MagicMock()
        remaining_reservations.values_list.return_value = ["roll-2"]
        remaining_roll_qs = object()

        with patch("apps.production.services.job_services.transaction.atomic", return_value=nullcontext()), \
             patch("apps.production.services.job_services.WorkCenterAssignment.objects.get", return_value=assignment), \
             patch("apps.production.services.job_services.InventoryReservation.objects.filter", return_value=remaining_reservations), \
             patch("apps.production.services.job_services.InventoryRoll.objects.filter", return_value=remaining_roll_qs), \
             patch("django.utils.timezone.now", return_value="now-ts"), \
             patch.object(WCManagerService, "_sync_assignment_status") as sync_status, \
             patch("apps.production.services.services_execution.ExecutionService.unassign_roll") as exec_unassign, \
             patch("apps.production.services.services_execution.ExecutionService.auto_satisfy_inputs") as auto_satisfy:
            WCManagerService.unassign_roll("assignment-1", "reservation-1", user="admin")

        allocated_rolls.clear.assert_called_once()
        exec_unassign.assert_called_once_with("job-1", "reservation-1")
        allocated_rolls.set.assert_called_once_with(remaining_roll_qs)
        auto_satisfy.assert_not_called()
        sync_status.assert_called_once_with(assignment)
        assignment.save.assert_called_once()
