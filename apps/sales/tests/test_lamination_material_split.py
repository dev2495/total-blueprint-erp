from django.test import TestCase

from apps.factory.models import Process
from apps.routing.models import RoutingRule
from apps.sales.services.order_service import _build_material_plan_lines
from apps.templates.models import (
    TemplateBlueprint,
    TemplateProcessStep,
    TemplateProcessStepMaterial,
    TemplateProcessStepRollSpec,
)


class LaminationMaterialSplitTests(TestCase):
    def test_adhesive_and_solvent_plan_split_by_lamination_pass(self):
        process = Process.objects.create(
            code="LAM",
            name="Lamination",
            input_form="ROLL",
            output_form="ROLL",
            roll_behavior="MULTI_INPUT_COMBINE",
        )
        route = RoutingRule.objects.create(name="Two Pass Lamination", ordered_processes=["LAM", "LAM"])
        template = TemplateBlueprint.objects.create(
            name="Three Layer Laminate",
            fg_type="ROLL",
            routing_rule=route,
        )
        step_one = TemplateProcessStep.objects.create(template=template, sequence_number=1, process=process)
        step_two = TemplateProcessStep.objects.create(template=template, sequence_number=2, process=process)
        TemplateProcessStepRollSpec.objects.create(
            template_step=step_one,
            input_roll_count=2,
            combine_mode="LANE_GROUPS",
            input_lane_count=2,
            lamination_pass_index=1,
            active_min_layer_count=2,
            adhesive_split_pct=40,
            solvent_split_pct=25,
        )
        TemplateProcessStepRollSpec.objects.create(
            template_step=step_two,
            input_roll_count=2,
            combine_mode="LANE_GROUPS",
            input_lane_count=2,
            lamination_pass_index=2,
            active_min_layer_count=3,
            adhesive_split_pct=60,
            solvent_split_pct=75,
        )
        for step in (step_one, step_two):
            TemplateProcessStepMaterial.objects.create(
                template_step=step,
                source_kind="CATEGORY",
                category_code="ADHESIVE",
                consumption_basis="SNAPSHOT_GSM",
                quantity_mode="GSM",
                value=0,
            )
            TemplateProcessStepMaterial.objects.create(
                template_step=step,
                source_kind="CATEGORY",
                category_code="SOLVENT",
                consumption_basis="SNAPSHOT_GSM",
                quantity_mode="GSM",
                value=0,
            )

        lines = _build_material_plan_lines(
            {"template_id": str(template.id)},
            {
                "chemicals": [
                    {"type": "ADHESIVE", "name": "Fixed Adhesive", "code": "ADH", "weight_kg": 100},
                    {"type": "SOLVENT", "name": "Fixed Solvent", "code": "SOL", "weight_kg": 40},
                ]
            },
        )

        adhesive = [row for row in lines if row["category_code"] == "ADHESIVE"]
        solvent = [row for row in lines if row["category_code"] == "SOLVENT"]

        self.assertEqual([row["step_sequence"] for row in adhesive], [1, 2])
        self.assertEqual([row["theoretical_qty"] for row in adhesive], [40.0, 60.0])
        self.assertEqual([row["split_pct"] for row in adhesive], [40.0, 60.0])
        self.assertEqual([row["theoretical_qty"] for row in solvent], [10.0, 30.0])
        self.assertTrue(all("@" in row["policy_key"] for row in adhesive + solvent))
