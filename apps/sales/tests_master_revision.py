from unittest.mock import patch

from django.core.exceptions import ValidationError
from django.test import TestCase

from apps.factory.models import Process
from apps.materials.models import ProductMaster
from apps.production.models import ProductionJob
from apps.routing.models import RoutingRule
from apps.sales.models import SalesOrder, SalesOrderItem
from apps.sales.services.order_service import SalesOrderService
from apps.templates.models import TemplateBlueprint
from apps.templates.services import RouteDispatchError


class MasterRevisionSafetyTests(TestCase):
    def setUp(self):
        self.process = Process.objects.create(code="REV-QUEUE-PROC", name="Revision queue process")
        self.route = RoutingRule.objects.create(name="Revision queue route", ordered_processes=[self.process.code])
        self.template = TemplateBlueprint.objects.create(
            name="Revision queue template",
            fg_type="POUCH",
            status="LIVE",
            pouch_style="THREE_SIDE_SEAL",
            routing_rule=self.route,
        )
        self.master = ProductMaster.objects.create(
            code="REV-QUEUE-MASTER",
            name="Revision master",
            product_kind="POUCH",
            default_reporting_group="FG",
            template=self.template,
            default_template=self.template,
        )

    def _item(self, *, order_status="PLANNED", line_status="PLANNED", line_name="Customer display name"):
        order = SalesOrder.objects.create(customer_name="Revision customer", status=order_status)
        return SalesOrderItem.objects.create(
            sales_order=order,
            template=self.template,
            product_master=self.master,
            line_status=line_status,
            line_name=line_name,
            qty_value=100,
            qty_uom="PCS",
            price_basis="PCS",
            unit_price=1,
            geometry_snapshot={"finished_good_type": "POUCH"},
            printing_snapshot={"enabled": False},
        )

    @patch("apps.production.services.job_services.JobService.create_jobs_for_so_item", return_value=[])
    def test_pristine_queued_jobs_are_cancelled_and_rebuilt(self, create_jobs):
        item = self._item()
        job = ProductionJob.objects.create(
            job_number="REV-QUEUE-001",
            template=self.template,
            routing_rule=self.route,
            sales_order_item=item,
            quantity=100,
            remaining_qty=100,
            status="QUEUED",
            job_state="PLANNED",
        )

        result = SalesOrderService._rebuild_pristine_pre_release_jobs(item, reason="TEST_MASTER_EDIT")

        self.assertEqual(result["status"], "rebuilt")
        self.assertEqual(result["cancelled"], 1)
        create_jobs.assert_called_once()
        job.refresh_from_db()
        self.assertEqual(job.job_state, "CANCELLED")
        self.assertEqual(job.status, "CANCELLED")

    @patch(
        "apps.production.services.job_services.JobService.create_jobs_for_so_item",
        side_effect=RouteDispatchError("Planner must choose a work center for EXT at step 1."),
    )
    def test_pristine_queue_becomes_planning_required_when_dispatch_needs_decision(self, create_jobs):
        item = self._item(order_status="PLANNED", line_status="PLANNED")
        job = ProductionJob.objects.create(
            job_number="REV-QUEUE-DISPATCH",
            template=self.template,
            routing_rule=self.route,
            sales_order_item=item,
            quantity=100,
            remaining_qty=100,
            status="QUEUED",
            job_state="PLANNED",
        )

        result = SalesOrderService._rebuild_pristine_pre_release_jobs(item, reason="TEST_MASTER_EDIT")

        self.assertEqual(result["status"], "planner_decision_required")
        self.assertEqual(result["cancelled"], 1)
        create_jobs.assert_called_once()
        item.refresh_from_db()
        item.sales_order.refresh_from_db()
        job.refresh_from_db()
        self.assertEqual(item.line_status, "PLANNING_REQUIRED")
        self.assertEqual(item.sales_order.status, "PLANNING_REQUIRED")
        self.assertEqual(job.job_state, "CANCELLED")
        self.assertEqual(job.status, "CANCELLED")

    @patch("apps.sales.services.order_service.SalesOrderService.preview_sales_item")
    @patch("apps.sales.services.axis_resolver.OrderResolutionService.resolve_line")
    def test_snapshot_refresh_preserves_customer_line_name(self, resolve_line, preview_sales_item):
        item = self._item(order_status="CONFIRMED", line_status="OPEN", line_name="Do not rename this line")
        resolve_line.return_value = {
            "template": str(self.template.id),
            "product_variant": None,
            "customer_product_overlay": None,
            "geometry_snapshot": {"finished_good_type": "POUCH"},
            "layer_snapshot": [],
            "printing_snapshot": {"enabled": False},
            "addons_snapshot": [],
            "packaging_snapshot": {},
        }
        preview_sales_item.return_value = {"unit_weight_g": 1, "total_weight_kg": 0.1, "bom": {}}

        result = SalesOrderService.refresh_open_snapshots_for_items(
            SalesOrderItem.objects.filter(id=item.id),
            reason="TEST_MASTER_EDIT",
        )

        self.assertEqual(result["refreshed"], 1, result)
        item.refresh_from_db()
        self.assertEqual(item.line_name, "Do not rename this line")
        self.assertEqual(item.line_status, "PLANNING_REQUIRED")

    @patch("apps.sales.services.order_service.SalesOrderService.preview_sales_item")
    @patch("apps.sales.services.axis_resolver.OrderResolutionService.resolve_line")
    def test_strict_snapshot_refresh_rolls_back_all_lines_on_failure(self, resolve_line, preview_sales_item):
        first = self._item(order_status="CONFIRMED", line_status="OPEN", line_name="First line")
        second = self._item(order_status="CONFIRMED", line_status="OPEN", line_name="Second line")
        resolved = {
            "template": str(self.template.id),
            "product_variant": None,
            "customer_product_overlay": None,
            "geometry_snapshot": {"finished_good_type": "POUCH", "width_mm": 999},
            "layer_snapshot": [],
            "printing_snapshot": {"enabled": False},
            "addons_snapshot": [],
            "packaging_snapshot": {},
        }
        resolve_line.side_effect = [resolved, RuntimeError("forced second-line failure")]
        preview_sales_item.return_value = {"unit_weight_g": 1, "total_weight_kg": 0.1, "bom": {}}

        with self.assertRaises(ValidationError):
            SalesOrderService.refresh_open_snapshots_for_items(
                SalesOrderItem.objects.filter(id__in=[first.id, second.id]),
                reason="TEST_STRICT_MASTER_EDIT",
                raise_on_error=True,
            )

        first.refresh_from_db()
        second.refresh_from_db()
        self.assertNotIn("width_mm", first.geometry_snapshot)
        self.assertNotIn("width_mm", second.geometry_snapshot)
        self.assertEqual(first.line_status, "OPEN")
        self.assertEqual(second.line_status, "OPEN")
