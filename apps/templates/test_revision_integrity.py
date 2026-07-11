from django.core.exceptions import ValidationError
from django.test import TestCase

from apps.factory.models import Process
from apps.routing.models import RoutingRule
from apps.templates.models import TemplateBlueprint, TemplateProcessStep
from apps.templates.services import TemplateGovernanceService


class TemplateRevisionIntegrityTests(TestCase):
    def test_correction_copy_preserves_batch_and_step_execution_policy(self):
        process = Process.objects.create(
            code="REV-COPY-PROC",
            name="Revision copy process",
            allows_optional_at_planning=True,
            allows_skip_after_previous_output=True,
        )
        route = RoutingRule.objects.create(name="Revision copy route", ordered_processes=[process.code])
        source = TemplateBlueprint.objects.create(
            name="Revision copy source",
            fg_type="ROLL",
            status="LIVE",
            routing_rule=route,
            batch_execution_policy={"default_batch_size_kg": 500, "allow_partial_movement": False},
        )
        TemplateProcessStep.objects.create(
            template=source,
            sequence_number=1,
            process=process,
            optional_at_planning=True,
            skippable_after_previous_output=True,
        )

        copy = TemplateGovernanceService._copy_template(source, preserve_name=True)
        copied_step = copy.process_steps.get()

        self.assertEqual(copy.batch_execution_policy, source.batch_execution_policy)
        self.assertTrue(copied_step.optional_at_planning)
        self.assertTrue(copied_step.skippable_after_previous_output)

    def test_missing_route_process_fails_before_existing_steps_are_changed(self):
        process = Process.objects.create(code="ROUTE-SAFE-PROC", name="Route-safe process")
        route = RoutingRule.objects.create(name="Route safety route", ordered_processes=["MISSING-PROCESS"])
        template = TemplateBlueprint.objects.create(
            name="Route safety template",
            fg_type="ROLL",
            status="DRAFT",
            routing_rule=route,
        )
        step = TemplateProcessStep.objects.create(template=template, sequence_number=1, process=process)

        with self.assertRaises(ValidationError):
            TemplateGovernanceService.apply_route_sync(template)

        step.refresh_from_db()
        self.assertFalse(step.is_removed_from_route)
        self.assertEqual(step.sequence_number, 1)
