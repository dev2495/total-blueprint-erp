from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase

from apps.factory.models import Process
from apps.materials.models import ProductMaster
from apps.routing.models import RoutingRule
from apps.sales.models import Customer, SalesOrder, SalesOrderItem
from apps.sales.services.order_service import SalesOrderService
from apps.templates.models import TemplateBlueprint


class OpenSalesSnapshotRefreshTests(TestCase):
    def setUp(self):
        self.customer = Customer.objects.create(code="SNAP", name="Snapshot Customer")
        self.process = Process.objects.create(code="EXT", name="Extrusion", input_form="BULK", output_form="ROLL")
        self.route = RoutingRule.objects.create(name="Snapshot route", ordered_processes=[self.process.code])
        self.template = TemplateBlueprint.objects.create(
            name="Snapshot roll template",
            fg_type="ROLL",
            status="LIVE",
            routing_rule=self.route,
        )
        self.master = ProductMaster.objects.create(
            code="PM-SNAPSHOT",
            name="Snapshot PM",
            product_kind="ROLL",
            template=self.template,
            default_template=self.template,
            variant_axes=[{"axis": "size", "type": "geometry", "required": True, "options": ["500"]}],
            fixed_attributes={"fg_type": "ROLL"},
        )

    def _order_item(self, *, order_status="PLANNING_REQUIRED", line_status="PLANNING_REQUIRED"):
        order = SalesOrder.objects.create(
            customer=self.customer,
            customer_name=self.customer.name,
            status=order_status,
        )
        return SalesOrderItem.objects.create(
            sales_order=order,
            template=self.template,
            product_master=self.master,
            line_name="Old snapshot",
            qty_uom="KG",
            qty_value=Decimal("100"),
            price_basis="KG",
            unit_price=Decimal("10"),
            axis_values={"size": "500"},
            line_status=line_status,
            geometry_snapshot={"finished_good_type": "ROLL", "roll_width_mm": 400},
            layer_snapshot=[{"variant_code": "OLD", "thickness_micron": 40}],
            printing_snapshot={"enabled": False},
            addons_snapshot=[],
            packaging_snapshot={},
            bom_snapshot={"planning_lines": [{"material_code": "OLD"}]},
        )

    @patch("apps.sales.services.order_service.SalesOrderService.preview_sales_item")
    @patch("apps.sales.services.axis_resolver.OrderResolutionService.resolve_line")
    def test_product_master_edit_refreshes_open_planning_line_snapshots(self, resolve_line, preview_sales_item):
        item = self._order_item()
        resolve_line.return_value = {
            "product_master": str(self.master.id),
            "product_master_code": self.master.code,
            "product_master_name": self.master.name,
            "product_variant": None,
            "customer_product_overlay": None,
            "axis_values": {"size": "500"},
            "template": str(self.template.id),
            "template_name": self.template.name,
            "finished_good_type": "ROLL",
            "geometry_snapshot": {"finished_good_type": "ROLL", "roll_width_mm": 500, "roll_form": "FLAT"},
            "layer_snapshot": [{"material_code": "LD-NEW", "thickness_micron": 50}],
            "printing_snapshot": {"enabled": False},
            "addons_snapshot": [],
            "packaging_snapshot": {},
            "preview_payload": {},
        }
        preview_sales_item.return_value = {
            "unit_weight_g": Decimal("0"),
            "total_weight_kg": Decimal("100"),
            "bom": {"planning_lines": [{"material_code": "LD-NEW"}], "is_complete": True},
        }

        stats = SalesOrderService.refresh_open_snapshots_for_product_master(self.master)

        self.assertEqual(stats["checked"], 1)
        self.assertEqual(stats["refreshed"], 1)
        item.refresh_from_db()
        self.assertEqual(item.geometry_snapshot["roll_width_mm"], 500)
        self.assertEqual(item.layer_snapshot[0]["material_code"], "LD-NEW")
        self.assertEqual(item.bom_snapshot["planning_lines"][0]["material_code"], "LD-NEW")

    @patch("apps.sales.services.axis_resolver.OrderResolutionService.resolve_line")
    def test_product_master_edit_does_not_rewrite_released_lines(self, resolve_line):
        item = self._order_item(order_status="RELEASED", line_status="RELEASED")

        stats = SalesOrderService.refresh_open_snapshots_for_product_master(self.master)

        self.assertEqual(stats["checked"], 0)
        resolve_line.assert_not_called()
        item.refresh_from_db()
        self.assertEqual(item.geometry_snapshot["roll_width_mm"], 400)
        self.assertEqual(item.bom_snapshot["planning_lines"][0]["material_code"], "OLD")
