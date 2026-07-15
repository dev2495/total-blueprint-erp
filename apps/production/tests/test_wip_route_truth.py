from contextlib import nullcontext
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from apps.production.services.job_services import JobService, WCManagerService
from apps.production.services.services_execution import ExecutionService


class WipRouteTruthTests(SimpleTestCase):
    def test_route_graph_error_is_not_replaced_with_legacy_route_length(self):
        routing_rule = SimpleNamespace(ordered_processes=["EXTRUSION", "PRINTING"])

        with patch(
            "apps.production.services.batch_route_service.RouteGraphService.normalize",
            side_effect=RuntimeError("route graph unavailable"),
        ):
            with self.assertRaisesRegex(RuntimeError, "route graph unavailable"):
                JobService._route_last_index(routing_rule)

    def test_lamination_pass_lookup_error_is_not_silently_rewritten(self):
        with patch(
            "apps.production.services.job_services.Process.objects.filter",
            side_effect=RuntimeError("process lookup unavailable"),
        ):
            with self.assertRaisesRegex(RuntimeError, "process lookup unavailable"):
                JobService._lamination_pass_index_for_route(["LAMINATION"], 0)

    def test_route_step_policy_lookup_error_blocks_job_generation(self):
        source = SimpleNamespace(layer_snapshot=[{"layer": 1}, {"layer": 2}])
        process = SimpleNamespace(roll_behavior="MULTI_INPUT_COMBINE")

        with patch(
            "apps.templates.models.TemplateProcessStep.objects.select_related",
            side_effect=RuntimeError("route step lookup unavailable"),
        ):
            with self.assertRaisesRegex(RuntimeError, "route step lookup unavailable"):
                JobService._route_step_active_for_source(
                    source=source,
                    template=SimpleNamespace(id="template-1"),
                    process=process,
                    processes=["LAMINATION"],
                    index=0,
                )

    def test_job_layer_identity_hash_failure_is_not_silently_dropped(self):
        source = SimpleNamespace(bom_snapshot={}, layer_snapshot=[{"variant_id": "film-1"}])

        with patch(
            "apps.production.services.roll_allocation_service.layer_signature_hash",
            side_effect=RuntimeError("hash unavailable"),
        ):
            with self.assertRaisesMessage(RuntimeError, "hash unavailable"):
                JobService._source_layer_identity_meta(source)

    def test_job_layer_identity_preserves_version_and_generic_stock_role(self):
        source = SimpleNamespace(
            bom_snapshot={"layer_signature_hash": "immutable-layer-sig"},
            layer_snapshot=[{"variant_id": "film-1"}],
            commitment_scope="GENERIC",
        )

        with patch("apps.production.services.roll_allocation_service.layer_signature_hash") as compute_hash:
            meta = JobService._source_layer_identity_meta(source, include_stock_role=True)

        compute_hash.assert_not_called()
        self.assertEqual(meta["layer_signature_hash"], "immutable-layer-sig")
        self.assertEqual(meta["roll_role"], "GENERIC_JUMBO")
        self.assertTrue(meta["is_generic_stock"])

    def test_corrupt_roll_step_identity_is_not_allocatable(self):
        job = SimpleNamespace(current_step_index=1)
        process = SimpleNamespace(
            input_form="ROLL",
            output_form="ROLL",
            roll_behavior="MODIFY_EXISTING",
        )
        roll = SimpleNamespace(
            stock_form="OPEN_WEB",
            current_step_index="not-a-step",
            stage_index=0,
            meta_json={},
        )

        with patch(
            "apps.production.services.services_execution.StockFormResolver.process_accepts_input",
            return_value=True,
        ):
            self.assertFalse(
                ExecutionService._is_roll_step_compatible(
                    job,
                    process,
                    roll,
                    [{"min_width_mm": 100}],
                )
            )

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

    def test_mark_execution_ready_persists_wcm_material_confirmations(self):
        material_confirmations = [
            {
                "requirement_id": "req-1",
                "material_id": "granule-1",
                "actual_issued_qty": 4,
                "actual_returned_qty": 0,
                "actual_scrap_qty": 0,
                "is_estimated": False,
                "granule_code_allocations": [
                    {"granule_code_id": "code-a", "qty_kg": 1.25},
                    {"granule_code_id": "code-b", "qty_kg": 2.75},
                ],
            }
        ]
        job = SimpleNamespace(
            id="job-1",
            sales_order_item_id="so-item-1",
            mts_order_id=None,
            template_id=None,
            current_step_index=1,
            status="PLANNED",
            job_state="ASSIGNED",
            current_step_material_confirmations=[],
        )
        assignment = SimpleNamespace(
            id="assignment-1",
            assigned_machine=SimpleNamespace(id="machine-1"),
            production_job=job,
            status="ASSIGNED",
            updated_at=None,
        )
        lineage_qs = MagicMock()
        lineage_qs.filter.return_value = lineage_qs
        lineage_qs.exclude.return_value = lineage_qs
        lineage_qs.order_by.return_value.first.return_value = None

        with patch("apps.production.services.job_services.WorkCenterAssignment.objects.get", return_value=assignment), \
             patch("apps.production.services.job_services.WorkCenterAssignment.objects.filter") as assignment_filter, \
             patch("apps.production.services.job_services.ProductionJob.objects.exclude", return_value=lineage_qs), \
             patch("apps.production.services.job_services.ProductionJob.objects.filter") as job_filter, \
             patch.object(WCManagerService, "_running_job_for_machine", return_value=None), \
             patch.object(WCManagerService, "_ensure_job_source_location"), \
             patch("apps.production.services.services_execution.ExecutionService.top_up_bulk_source_location") as top_up_bulk, \
             patch("apps.production.services.services_execution.ExecutionService.auto_satisfy_inputs"), \
             patch("apps.production.services.services_execution.ExecutionService.get_satisfaction_status", return_value={"is_satisfied": True}), \
             patch("django.utils.timezone.now", return_value="ready-ts"):
            assignment_filter.return_value.update.return_value = 1

            result = WCManagerService.mark_execution_ready(
                "assignment-1",
                material_confirmations=material_confirmations,
            )

        self.assertIs(result, assignment)
        top_up_bulk.assert_called_once_with(
            "job-1",
            material_confirmations=material_confirmations,
        )
        self.assertEqual(job.current_step_material_confirmations, material_confirmations)
        assignment_filter.return_value.update.assert_called_once_with(
            status="EXECUTION_READY",
            updated_at="ready-ts",
        )
        job_filter.return_value.update.assert_called_once_with(
            status="ASSIGNED",
            job_state="RELEASED",
            current_step_material_confirmations=material_confirmations,
            updated_at="ready-ts",
        )

    def test_wc_manager_blocks_machine_changes_after_release_to_operator(self):
        job = SimpleNamespace(id="job-1", machine=None, save=MagicMock())
        assignment = SimpleNamespace(
            id="assignment-1",
            status="EXECUTION_READY",
            assigned_machine=None,
            production_job=job,
            save=MagicMock(),
        )
        machine = SimpleNamespace(id="machine-1")

        with patch("apps.production.services.job_services.transaction.atomic", return_value=nullcontext()), \
             patch("apps.production.services.job_services.WorkCenterAssignment.objects.get", return_value=assignment), \
             patch("apps.factory.models.Machine.objects.get", return_value=machine), \
             patch.object(WCManagerService, "_sync_assignment_status"):
            with self.assertRaisesRegex(ValueError, "already released"):
                WCManagerService.assign_machine("assignment-1", "machine-1", user="admin")

        assignment.save.assert_not_called()
        job.save.assert_not_called()

    def test_wc_manager_allows_machine_assignment_after_planner_release_to_wcm(self):
        job = SimpleNamespace(
            id="job-1",
            machine=None,
            save=MagicMock(),
            status="QUEUED",
            job_state="RELEASED",
        )
        assignment = SimpleNamespace(
            id="assignment-1",
            status="WC_READY",
            assigned_machine=None,
            production_job=job,
            production_job_id="job-1",
            work_center_id=None,
            save=MagicMock(),
        )
        machine = SimpleNamespace(id="machine-1", name="Machine 1", work_center_id=None)

        with patch("apps.production.services.job_services.transaction.atomic", return_value=nullcontext()), \
             patch("apps.production.services.job_services.WorkCenterAssignment.objects.get", return_value=assignment), \
             patch("apps.factory.models.Machine.objects.get", return_value=machine), \
             patch.object(WCManagerService, "_sync_assignment_status"):
            result = WCManagerService.assign_machine("assignment-1", "machine-1", user="admin")

        self.assertIs(result, assignment)
        self.assertIs(assignment.assigned_machine, machine)
        assignment.save.assert_called_once()
        job.save.assert_called_once()

    def test_wc_manager_blocks_roll_changes_after_release_to_operator(self):
        process = SimpleNamespace(input_form="ROLL", output_form="ROLL", roll_behavior="MULTI_INPUT_COMBINE")
        job = SimpleNamespace(id="job-1", current_process=process, process=process)
        allocated_rolls = MagicMock()
        assignment = SimpleNamespace(
            id="assignment-1",
            status="EXECUTION_READY",
            production_job=job,
            allocated_rolls=allocated_rolls,
            assigned_by=None,
            assigned_at=None,
            save=MagicMock(),
        )
        reservations = MagicMock()
        reservations.values_list.return_value = []
        reserved_rolls = object()

        with patch("apps.production.services.job_services.transaction.atomic", return_value=nullcontext()), \
             patch("apps.production.services.job_services.WorkCenterAssignment.objects.get", return_value=assignment), \
             patch("apps.production.services.job_services.InventoryReservation.objects.filter", return_value=reservations), \
             patch("apps.production.services.job_services.InventoryRoll.objects.filter", return_value=reserved_rolls), \
             patch("apps.production.services.services_execution.ExecutionService._required_roll_count", return_value=1), \
             patch.object(WCManagerService, "_validate_roll_assignment_set"), \
             patch.object(WCManagerService, "_sync_assignment_status"):
            with self.assertRaisesRegex(ValueError, "already released"):
                WCManagerService.assign_rolls("assignment-1", [], user="admin")

        allocated_rolls.set.assert_not_called()
        assignment.save.assert_not_called()
