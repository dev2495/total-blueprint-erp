from decimal import Decimal
from io import StringIO
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.core.management import call_command
from django.test import SimpleTestCase, TestCase

from apps.bom.readiness import BomReadinessError, bom_readiness_errors
from apps.factory.models import Plant, Process, WorkCenter
from apps.inventory.models import InventoryLocation
from apps.materials.models import InventoryMaterial
from apps.production.models import JobMaterialRequirement, ProductionJob, WorkCenterAssignment
from apps.production.services.job_services import JobService
from apps.routing.models import RoutingRule
from apps.sales.models import SalesOrder, SalesOrderItem
from apps.sales.services.order_service import SalesOrderService
from apps.templates.models import TemplateBlueprint


class BomReadinessTests(SimpleTestCase):
    def test_incomplete_snapshot_reports_original_recipe_error(self):
        errors = bom_readiness_errors(
            {
                "is_complete": False,
                "errors": ["No recipe for LDMW-MONO (grade, 67.5μ)"],
                "films": [],
                "granules": [],
            }
        )

        self.assertEqual(errors, ["No recipe for LDMW-MONO (grade, 67.5μ)"])

    @patch.object(SalesOrderService, "preview_sales_item")
    def test_rebuild_bom_snapshot_requires_ready_preview(self, preview_sales_item):
        preview_sales_item.return_value = {
            "unit_weight_g": 5,
            "total_weight_kg": 100,
            "bom": {
                "is_complete": True,
                "errors": [],
                "planning_lines": [{"material_code": "LDPE", "planned_issue_qty": 100}],
            },
        }
        item = SimpleNamespace(
            id="item-1",
            template=SimpleNamespace(fg_type="POUCH"),
            geometry_snapshot={"finished_good_type": "POUCH"},
            layer_snapshot=[],
            printing_snapshot={},
            addons_snapshot=[],
            packaging_snapshot={},
            qty_value=Decimal("100"),
            qty_uom="KG",
            save=Mock(),
        )

        SalesOrderService.rebuild_bom_snapshot_for_item(item, require_ready=True)

        self.assertTrue(item.bom_snapshot["is_complete"])
        self.assertEqual(item.total_weight_kg, Decimal("100"))
        item.save.assert_called_once()


class ProductionBomGuardTests(TestCase):
    def setUp(self):
        self.process = Process.objects.create(code="BOM-GUARD-EXT", name="BOM Guard Extrusion")
        self.route = RoutingRule.objects.create(name="BOM Guard Route", ordered_processes=[self.process.code])
        self.template = TemplateBlueprint.objects.create(
            name="BOM Guard Template",
            fg_type="POUCH",
            status="LIVE",
            routing_rule=self.route,
            pouch_style="THREE_SIDE_SEAL",
        )
        self.order = SalesOrder.objects.create(
            order_number="SO-BOM-GUARD",
            customer_name="Guard Customer",
            status="PLANNING_REQUIRED",
        )
        self.item = SalesOrderItem.objects.create(
            sales_order=self.order,
            template=self.template,
            qty_value=Decimal("100"),
            qty_uom="KG",
            total_weight_kg=Decimal("100"),
            line_status="PLANNING_REQUIRED",
            geometry_snapshot={"finished_good_type": "POUCH"},
            layer_snapshot=[],
            printing_snapshot={"enabled": False},
            addons_snapshot=[],
            bom_snapshot={
                "is_complete": False,
                "errors": ["No recipe for LDMW-MONO (grade, 67.5μ)"],
                "films": [],
                "granules": [],
            },
        )

    def test_job_creation_blocks_incomplete_bom_snapshot(self):
        with self.assertRaisesMessage(BomReadinessError, "No recipe for LDMW-MONO"):
            JobService.create_jobs_for_so_item(self.item)

        self.assertFalse(ProductionJob.objects.exists())

    def test_job_release_blocks_incomplete_bom_snapshot(self):
        job = ProductionJob.objects.create(
            job_number="BOM-GUARD-JOB",
            origin="MTO",
            template=self.template,
            sales_order_item=self.item,
            routing_rule=self.route,
            current_step_index=0,
            current_process=self.process,
            process=self.process,
            quantity=Decimal("100"),
            remaining_qty=Decimal("100"),
            uom="KG",
            status="QUEUED",
            job_state="PLANNED",
        )

        with self.assertRaisesMessage(BomReadinessError, "No recipe for LDMW-MONO"):
            JobService.release_job(job.id)


class RepairIncompleteBomJobsCommandTests(TestCase):
    def setUp(self):
        self.process = Process.objects.create(code="BOM-REPAIR-EXT", name="BOM Repair Extrusion")
        self.route = RoutingRule.objects.create(name="BOM Repair Route", ordered_processes=[self.process.code])
        self.template = TemplateBlueprint.objects.create(
            name="BOM Repair Template",
            fg_type="POUCH",
            status="LIVE",
            routing_rule=self.route,
            pouch_style="THREE_SIDE_SEAL",
        )
        self.order = SalesOrder.objects.create(
            order_number="SO-BOM-REPAIR",
            customer_name="Repair Customer",
            status="RELEASED",
        )
        self.item = SalesOrderItem.objects.create(
            sales_order=self.order,
            template=self.template,
            qty_value=Decimal("100"),
            qty_uom="KG",
            total_weight_kg=Decimal("100"),
            line_status="RELEASED",
            geometry_snapshot={"finished_good_type": "POUCH"},
            layer_snapshot=[],
            printing_snapshot={"enabled": False},
            addons_snapshot=[],
            bom_snapshot={
                "is_complete": False,
                "errors": ["No recipe for LDMW-MONO (grade, 67.5μ)"],
                "films": [],
                "granules": [],
            },
        )
        plant = Plant.objects.create(code="BOMRP", name="BOM Repair Plant")
        rm = InventoryLocation.objects.create(code="BOMRP-RM", name="RM", plant=plant, type="RM")
        wip = InventoryLocation.objects.create(code="BOMRP-WIP", name="WIP", plant=plant, type="WIP")
        self.work_center = WorkCenter.objects.create(
            plant=plant,
            code="BOMRP-WC",
            name="BOM Repair WC",
            default_wip_location=wip,
        )
        self.material = InventoryMaterial.objects.create(code="BOMRP-MAT", name="Bad Plan Mat", category="ADDON")
        self.job = ProductionJob.objects.create(
            job_number="BOM-REPAIR-JOB",
            origin="MTO",
            template=self.template,
            sales_order_item=self.item,
            routing_rule=self.route,
            current_step_index=0,
            current_process=self.process,
            process=self.process,
            work_center=self.work_center,
            from_location=rm,
            to_location=wip,
            quantity=Decimal("100"),
            remaining_qty=Decimal("100"),
            uom="KG",
            status="QUEUED",
            job_state="RELEASED",
        )
        WorkCenterAssignment.objects.create(production_job=self.job, work_center=self.work_center)
        JobMaterialRequirement.objects.create(
            production_job=self.job,
            material=self.material,
            required_qty=Decimal("1"),
            planned_issue_qty=Decimal("1"),
            uom="KG",
        )

    def test_apply_cancels_unstarted_jobs_and_returns_line_to_planner(self):
        dry_out = StringIO()
        call_command(
            "repair_incomplete_bom_jobs",
            "--order-number",
            self.order.order_number,
            stdout=dry_out,
        )
        self.assertIn("Eligible sales lines to reverse: 1", dry_out.getvalue())
        self.job.refresh_from_db()
        self.assertEqual(self.job.job_state, "RELEASED")

        apply_out = StringIO()
        call_command(
            "repair_incomplete_bom_jobs",
            "--order-number",
            self.order.order_number,
            "--apply",
            stdout=apply_out,
        )

        self.job.refresh_from_db()
        self.item.refresh_from_db()
        self.order.refresh_from_db()
        self.assertEqual(self.job.job_state, "CANCELLED")
        self.assertEqual(self.job.status, "CANCELLED")
        self.assertEqual(self.item.line_status, "PLANNING_REQUIRED")
        self.assertEqual(self.order.status, "PLANNING_REQUIRED")
        self.assertFalse(WorkCenterAssignment.objects.filter(production_job=self.job).exists())
        self.assertFalse(JobMaterialRequirement.objects.filter(production_job=self.job).exists())
        self.assertIn("Reversed 1 sales lines back to planner queue", apply_out.getvalue())
