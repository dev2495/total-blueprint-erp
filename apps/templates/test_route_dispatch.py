from unittest.mock import patch

from django.core.exceptions import ValidationError
from django.test import TestCase

from apps.factory.models import Plant, Process, WorkCenter, WorkCenterProcess
from apps.production.models import ProductionJob, WorkCenterAssignment
from apps.routing.models import RoutingRule
from apps.templates.models import TemplateBlueprint, TemplateProcessStep
from apps.templates.services import RouteDispatchError, TemplateDispatchService


class TemplateRouteDispatchTests(TestCase):
    def setUp(self):
        self.plant = Plant.objects.create(code="P1", name="Plant 1")
        self.process = Process.objects.create(
            code="EXTRUSION",
            name="Extrusion",
            input_form="BULK",
            output_form="ROLL",
            roll_behavior="CREATE_NEW",
        )
        self.wc_a = WorkCenter.objects.create(plant=self.plant, code="EXT-A", name="Extruder A")
        self.wc_b = WorkCenter.objects.create(plant=self.plant, code="EXT-B", name="Extruder B")
        WorkCenterProcess.objects.create(work_center=self.wc_a, process=self.process)
        WorkCenterProcess.objects.create(work_center=self.wc_b, process=self.process)
        self.route = RoutingRule.objects.create(name="Double Extrusion", ordered_processes=["EXTRUSION", "EXTRUSION"])
        self.template = TemplateBlueprint.objects.create(
            name="Double Extrusion Template",
            fg_type="ROLL",
            status="LIVE",
            routing_rule=self.route,
        )
        self.step_1 = TemplateProcessStep.objects.create(
            template=self.template,
            sequence_number=1,
            process=self.process,
        )
        self.step_2 = TemplateProcessStep.objects.create(
            template=self.template,
            sequence_number=2,
            process=self.process,
        )

    def test_ambiguous_process_requires_dispatch_decision(self):
        with self.assertRaises(RouteDispatchError):
            TemplateDispatchService.resolve_work_center(
                self.process,
                plant=self.plant,
                template=self.template,
                step_index=0,
                strict=True,
            )

    def test_step_default_resolves_work_center(self):
        TemplateDispatchService.update_step_dispatch(
            self.step_1,
            allowed_work_center_ids=[str(self.wc_a.id), str(self.wc_b.id)],
            default_work_center_id=str(self.wc_a.id),
            selection_policy=TemplateDispatchService.AUTO_DEFAULT,
        )
        resolved = TemplateDispatchService.resolve_work_center(
            self.process,
            plant=self.plant,
            template=self.template,
            step_index=0,
            strict=True,
        )
        self.assertEqual(resolved.id, self.wc_a.id)

    def test_repeated_same_process_steps_can_route_to_different_work_centers(self):
        TemplateDispatchService.update_step_dispatch(
            self.step_1,
            allowed_work_center_ids=[str(self.wc_a.id)],
            default_work_center_id=str(self.wc_a.id),
            selection_policy=TemplateDispatchService.AUTO_DEFAULT,
        )
        TemplateDispatchService.update_step_dispatch(
            self.step_2,
            allowed_work_center_ids=[str(self.wc_b.id)],
            default_work_center_id=str(self.wc_b.id),
            selection_policy=TemplateDispatchService.AUTO_DEFAULT,
        )
        first = TemplateDispatchService.resolve_work_center(
            self.process,
            plant=self.plant,
            template=self.template,
            step_index=0,
            strict=True,
        )
        second = TemplateDispatchService.resolve_work_center(
            self.process,
            plant=self.plant,
            template=self.template,
            step_index=1,
            strict=True,
        )
        self.assertEqual(first.id, self.wc_a.id)
        self.assertEqual(second.id, self.wc_b.id)

    @patch("apps.sales.services.order_service.SalesOrderService.refresh_open_snapshots_for_template")
    def test_dispatch_edit_refreshes_open_planned_jobs_for_step(self, refresh_open_snapshots):
        TemplateDispatchService.update_step_dispatch(
            self.step_1,
            allowed_work_center_ids=[str(self.wc_a.id)],
            default_work_center_id=str(self.wc_a.id),
            selection_policy=TemplateDispatchService.AUTO_DEFAULT,
        )
        job = ProductionJob.objects.create(
            job_number="ROUTE-REFRESH-1",
            template=self.template,
            routing_rule=self.route,
            current_step_index=0,
            current_process=self.process,
            process=self.process,
            work_center=self.wc_a,
            quantity=100,
            remaining_qty=100,
            status="QUEUED",
            job_state="PLANNED",
        )
        assignment = WorkCenterAssignment.objects.create(
            production_job=job,
            work_center=self.wc_a,
            status="WC_READY",
        )

        TemplateDispatchService.update_step_dispatch(
            self.step_1,
            allowed_work_center_ids=[str(self.wc_b.id)],
            default_work_center_id=str(self.wc_b.id),
            selection_policy=TemplateDispatchService.AUTO_DEFAULT,
        )

        job.refresh_from_db()
        assignment.refresh_from_db()
        self.assertEqual(job.work_center_id, self.wc_b.id)
        self.assertEqual(assignment.work_center_id, self.wc_b.id)
        refresh_open_snapshots.assert_called_with(
            self.step_1.template,
            reason="TEMPLATE_DISPATCH_EDIT",
        )

    def test_planner_required_step_requires_explicit_work_center(self):
        TemplateDispatchService.update_step_dispatch(
            self.step_1,
            allowed_work_center_ids=[str(self.wc_a.id), str(self.wc_b.id)],
            default_work_center_id=str(self.wc_a.id),
            selection_policy=TemplateDispatchService.PLANNER_REQUIRED,
        )

        status = TemplateDispatchService.step_status(self.step_1, plant=self.plant)
        self.assertEqual(status["status"], "PLANNER_REQUIRED")

        with self.assertRaises(RouteDispatchError):
            TemplateDispatchService.resolve_work_center(
                self.process,
                plant=self.plant,
                template=self.template,
                step_index=0,
                strict=True,
            )

        resolved = TemplateDispatchService.resolve_work_center(
            self.process,
            plant=self.plant,
            template=self.template,
            step_index=0,
            strict=True,
            selected_work_center_id=str(self.wc_b.id),
        )
        self.assertEqual(resolved.id, self.wc_b.id)

    def test_selected_work_center_must_be_allowed_for_route_step(self):
        TemplateDispatchService.update_step_dispatch(
            self.step_1,
            allowed_work_center_ids=[str(self.wc_a.id)],
            selection_policy=TemplateDispatchService.PLANNER_REQUIRED,
        )

        with self.assertRaises(RouteDispatchError):
            TemplateDispatchService.resolve_work_center(
                self.process,
                plant=self.plant,
                template=self.template,
                step_index=0,
                strict=True,
                selected_work_center_id=str(self.wc_b.id),
            )

    def test_route_skip_flags_require_process_capability(self):
        with self.assertRaises(ValidationError):
            TemplateDispatchService.update_step_dispatch(
                self.step_1,
                optional_at_planning=True,
            )

        with self.assertRaises(ValidationError):
            TemplateDispatchService.update_step_dispatch(
                self.step_1,
                skippable_after_previous_output=True,
            )

        self.process.allows_optional_at_planning = True
        self.process.allows_skip_after_previous_output = True
        self.process.save(
            update_fields=[
                "allows_optional_at_planning",
                "allows_skip_after_previous_output",
            ]
        )

        TemplateDispatchService.update_step_dispatch(
            self.step_1,
            optional_at_planning=True,
            skippable_after_previous_output=True,
        )

        self.step_1.refresh_from_db()
        self.assertTrue(self.step_1.optional_at_planning)
        self.assertTrue(self.step_1.skippable_after_previous_output)
