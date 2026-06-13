from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase, TestCase

from apps.factory.models import Plant, Process, WorkCenter
from apps.inventory.models import InkMaterial, InventoryLocation
from apps.production.models import JobMaterialRequirement, ProductionJob
from apps.production.services.services_execution import ExecutionService
from apps.routing.models import RoutingRule
from apps.sales.models import SalesOrder, SalesOrderItem
from apps.templates.models import TemplateBlueprint, TemplateProcessStep, TemplateProcessStepMaterial


class InkTheoryRequirementTests(TestCase):
    def setUp(self):
        self.plant = Plant.objects.create(name="Ink Theory Plant", code="INK-THEORY-P")
        self.location = InventoryLocation.objects.create(
            plant=self.plant,
            code="INK-THEORY-RM",
            name="Ink Theory RM",
            type="RM",
        )
        self.work_center = WorkCenter.objects.create(
            plant=self.plant,
            name="Ink Theory WC",
            code="INK_THEORY_WC",
            default_wip_location=self.location,
        )
        self.process = Process.objects.create(code="PRINT_FLOOR_INK", name="Print Floor Ink")
        self.route = RoutingRule.objects.create(name="Ink Theory Route", ordered_processes=[self.process.code])
        self.template = TemplateBlueprint.objects.create(name="Ink Theory Template", fg_type="POUCH", status="LIVE")
        self.step = TemplateProcessStep.objects.create(template=self.template, sequence_number=1, process=self.process)
        TemplateProcessStepMaterial.objects.create(
            template_step=self.step,
            category_code="INK",
            consumption_basis="SNAPSHOT_GSM",
            formula_driver="NONE",
            value=Decimal("0"),
            issue_policy_mode="NONE",
            capture_mode="AUTO_ESTIMATED_CONFIRM",
        )
        self.ink = InkMaterial.objects.create(base_type="POLY", color_name="CYAN")
        self.sales_order = SalesOrder.objects.create(customer_name="Ink Theory Customer")
        self.item = SalesOrderItem.objects.create(
            sales_order=self.sales_order,
            template=self.template,
            qty_value=10,
            qty_uom="PCS",
            unit_price=1,
            bom_snapshot={
                "inks": [
                    {
                        "material_id": str(self.ink.id),
                        "code": self.ink.code,
                        "name": self.ink.name,
                        "color": "CYAN",
                        "weight_kg": 4.0,
                        "gsm_total": 1.2,
                    }
                ]
            },
        )
        self.job = ProductionJob.objects.create(
            job_number="JOB-INK-THEORY",
            template=self.template,
            sales_order_item=self.item,
            routing_rule=self.route,
            current_step_index=0,
            current_process=self.process,
            process=self.process,
            work_center=self.work_center,
            from_location=self.location,
            quantity=Decimal("10.00"),
            uom="PCS",
            remaining_qty=Decimal("10.0000"),
        )

    def test_calculate_requirements_v2_excludes_ink_theory_from_job_requirements(self):
        requirements = ExecutionService.calculate_requirements_v2(self.job)

        self.assertEqual(requirements, [])
        self.assertFalse(JobMaterialRequirement.objects.filter(production_job=self.job, material=self.ink).exists())


class InkStepTargetTests(SimpleTestCase):
    @patch("apps.production.services.services_execution.JobExecutionLog.objects.filter")
    @patch("apps.production.services.services_execution.JobMaterialRequirement.objects.select_related")
    @patch.object(ExecutionService, "calculate_requirements")
    @patch.object(ExecutionService, "_resolve_step_roll_spec", return_value={})
    @patch.object(ExecutionService, "_job_unit_weight_g", return_value=Decimal("1000"))
    @patch.object(
        ExecutionService,
        "_job_bom_snapshot",
        return_value={"films": [{"weight_kg": "0.2", "density_g_cm3": "0.92", "source": "PURCHASE"}]},
    )
    def test_ink_requirements_are_ignored_in_step_bulk_target(
        self,
        _mock_bom,
        _mock_unit_weight,
        _mock_roll_spec,
        _mock_calc_requirements,
        mock_select_related,
        mock_execution_logs,
    ):
        ink_req = SimpleNamespace(
            required_qty=Decimal("4.0000"),
            material=SimpleNamespace(category="INK"),
        )
        adhesive_req = SimpleNamespace(
            required_qty=Decimal("1.5000"),
            material=SimpleNamespace(category="ADHESIVE"),
        )
        mock_select_related.return_value.filter.return_value = [ink_req, adhesive_req]
        mock_execution_logs.return_value.only.return_value = []
        process = SimpleNamespace(input_form="ROLL", roll_behavior="MULTI_INPUT_COMBINE")
        job = SimpleNamespace(
            current_process=process,
            process=process,
            current_step_index=0,
            routing_rule=SimpleNamespace(ordered_processes=["PRINT"]),
            mts_order=None,
            sales_order_item=None,
            quantity=Decimal("10"),
            uom="KG",
        )

        profile = ExecutionService._resolve_step_execution_profile_v2(job)

        self.assertAlmostEqual(profile["step_bulk_target_kg"], 1.5, places=6)
