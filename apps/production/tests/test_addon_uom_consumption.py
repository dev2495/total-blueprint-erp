from decimal import Decimal

from django.test import TestCase

from apps.factory.models import Plant, Process, WorkCenter
from apps.inventory.models import BulkTransaction, InventoryBulk, InventoryLocation
from apps.materials.models import InventoryMaterial
from apps.production.models import JobMaterialRequirement, ProductionJob
from apps.production.services.services_execution import ExecutionService
from apps.routing.models import RoutingRule
from apps.sales.models import SalesOrder, SalesOrderItem
from apps.templates.models import TemplateBlueprint, TemplateProcessStep, TemplateProcessStepMaterial


class AddonUomConsumptionTests(TestCase):
    def setUp(self):
        self.plant = Plant.objects.create(name="Addon Consume Plant", code="ADDON-CONSUME")
        self.location = InventoryLocation.objects.create(
            plant=self.plant,
            code="ADDON-CONSUME-RM",
            name="Addon Consume RM",
            type="RM",
        )
        self.work_center = WorkCenter.objects.create(
            plant=self.plant,
            name="Addon Consume WC",
            code="ADDON_CONSUME_WC",
            default_wip_location=self.location,
        )
        self.process = Process.objects.create(code="ADDON_CONSUME_STEP", name="Addon Consume Step")
        self.route = RoutingRule.objects.create(name="Addon Consume Route", ordered_processes=[self.process.code])
        self.template = TemplateBlueprint.objects.create(name="Addon Consume Template", fg_type="POUCH", status="LIVE")
        self.step = TemplateProcessStep.objects.create(template=self.template, sequence_number=1, process=self.process)
        TemplateProcessStepMaterial.objects.create(
            template_step=self.step,
            category_code="ADDON",
            consumption_basis="CATEGORY_FORMULA",
            formula_driver="ADDON_MASTER_WEIGHT_MODE",
            value=Decimal("0"),
            issue_policy_mode="NONE",
            capture_mode="AUTO_ESTIMATED_CONFIRM",
        )
        self.zipper = InventoryMaterial.objects.create(
            code="ZIP-MTR-CONSUME-E2E",
            name="Meter zipper consume e2e",
            category="ADDON",
            base_uom="METER",
            weight_mode="PER_MM",
            weight_value=0.015,
            addon_is_purchased=True,
            addon_purchase_uom="METER",
        )
        self.sales_order = SalesOrder.objects.create(customer_name="Addon Customer")
        self.item = SalesOrderItem.objects.create(
            sales_order=self.sales_order,
            template=self.template,
            qty_value=10,
            qty_uom="PCS",
            unit_price=1,
            bom_snapshot={
                "planning_lines": [
                    {
                        "category_code": "ADDON",
                        "material_id": str(self.zipper.id),
                        "material_code": self.zipper.code,
                        "material_name": self.zipper.name,
                        "uom": "METER",
                        "step_id": str(self.step.id),
                        "theoretical_qty": 4.0,
                        "planned_issue_qty": 4.0,
                    }
                ]
            },
        )
        self.job = ProductionJob.objects.create(
            job_number="JOB-ADDON-METER-CONSUME",
            template=self.template,
            sales_order_item=self.item,
            routing_rule=self.route,
            current_step_index=0,
            current_process=self.process,
            process=self.process,
            work_center=self.work_center,
            from_location=self.location,
            quantity=Decimal("1.00"),
            uom="KG",
            remaining_qty=Decimal("1.0000"),
        )

    def test_requirement_and_reconcile_consume_meter_stock(self):
        requirements = ExecutionService.calculate_requirements_v2(self.job)

        self.assertEqual(len(requirements), 1)
        req = requirements[0]
        self.assertEqual(req.material, self.zipper)
        self.assertEqual(req.uom, "METER")
        self.assertEqual(req.required_qty, Decimal("4.0000"))

        preview = ExecutionService.get_bulk_consumption_preview(self.job)
        self.assertEqual(preview[0]["uom"], "METER")
        self.assertEqual(preview[0]["required_qty"], 4.0)

        InventoryBulk.objects.create(
            material=self.zipper,
            plant=self.plant,
            location=self.location,
            qty_kg=Decimal("10.0000"),
        )

        ExecutionService._reconcile_step_bulk_consumption(
            self.job,
            produced_kg=Decimal("1.0000"),
            consumption_location_id=str(self.location.id),
        )

        stock = InventoryBulk.objects.get(material=self.zipper, location=self.location)
        self.assertEqual(stock.qty_kg, Decimal("6.0000"))
        req.refresh_from_db()
        self.assertEqual(req.consumed_qty, Decimal("4.0000"))
        tx = BulkTransaction.objects.get(material=self.zipper, type="CONSUME")
        self.assertEqual(tx.qty_kg, Decimal("-4.0000"))
