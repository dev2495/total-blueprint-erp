from decimal import Decimal
from unittest.mock import patch

from django.core.exceptions import ValidationError
from django.test import TestCase

from apps.factory.models import Process
from apps.materials.models import InventoryMaterial, ProductMaster, ProductMasterSize, WebWidthPolicy
from apps.routing.models import RoutingRule
from apps.sales.models import Customer
from apps.sales.services.order_service import SalesOrderService
from apps.templates.models import TemplateBlueprint


class SalesWebWidthLanePlanningTests(TestCase):
    def setUp(self):
        self.customer = Customer.objects.create(code="LANE-CUST", name="Lane Customer")
        self.process = Process.objects.create(
            code="POUCH-LANE",
            name="Lane pouching",
            input_form="ROLL",
            output_form="POUCH",
            roll_behavior="MODIFY_EXISTING",
        )
        self.route = RoutingRule.objects.create(name="Lane pouch route", ordered_processes=[self.process.code])
        self.template = TemplateBlueprint.objects.create(
            name="Lane pouch template",
            fg_type="POUCH",
            status="LIVE",
            pouch_style="STAND_UP",
            routing_rule=self.route,
        )
        family = InventoryMaterial.objects.create(
            code="LANE-FAM",
            name="Lane film family",
            category="FILM_FAMILY",
            base_uom="KG",
            density_gcm3="0.9200",
        )
        InventoryMaterial.objects.create(
            code="LANE-LD",
            name="Lane LD",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=family,
            is_purchasable=True,
            is_extrudable=False,
        )
        self.master = ProductMaster.objects.create(
            code="PM-LANE-POUCH",
            name="Lane pouch master",
            product_kind="POUCH",
            template=self.template,
            default_template=self.template,
            layer_template=[{"role": "sealant", "material_code": "LANE-LD", "thickness_micron": 60, "default_grade": ""}],
            variant_axes=[{"axis": "size", "type": "geometry", "required": True, "options": ["LANE-440"]}],
            fixed_attributes={"fg_type": "POUCH", "layer_count": 1, "default_pouch_style": "STAND_UP"},
        )
        ProductMasterSize.objects.create(
            product_master=self.master,
            code="LANE-440",
            label="Lane 440 child",
            width_mm=200,
            height_mm=300,
            gusset_mm=80,
            roll_width_mm=880,
            child_target_width_mm=440,
            child_target_override=False,
            standard_qty=1000,
            qty_uom="PCS",
            geometry_config={"multipliers": {"faces": 2}, "pouch_style": "STAND_UP"},
        )
        WebWidthPolicy.objects.update(is_default=False)
        self.policy = WebWidthPolicy.objects.create(
            code="LANE-POLICY",
            name="Lane test policy",
            is_default=True,
            allowed_lanes=[1, 2, 3],
            slitting_waste_rule={"inter_cut_mm": 5, "edge_trim_mm": 2, "formula": "PER_CUT"},
        )

    def _order_payload(self, lane_count=2):
        return {
            "customer": str(self.customer.id),
            "delivery_date": "2026-05-22",
            "items": [
                {
                    "product_master": str(self.master.id),
                    "template_id": str(self.template.id),
                    "qty_value": 1000,
                    "qty_uom": "PCS",
                    "unit_price": 4,
                    "price_basis": "PCS",
                    "preferred_lane_count": lane_count,
                    "lane_count_source": "OPERATOR_CHOICE",
                    "axis_values": {"size": "LANE-440"},
                    "printing": {"enabled": False},
                }
            ],
        }

    @patch("apps.sales.services.order_service.SalesOrderService.preview_sales_item")
    def test_confirm_preserves_child_target_and_plans_parent_from_lane_count(self, preview_sales_item):
        preview_sales_item.return_value = {
            "unit_weight_g": Decimal("8.0000"),
            "total_weight_kg": Decimal("8.0000"),
            "bom": {"planning_lines": [], "is_complete": True},
        }

        order = SalesOrderService.create_sales_order(self._order_payload(lane_count=2))
        item = order.items.get()
        self.assertEqual(item.geometry_snapshot["child_target_width_mm"], 440.0)
        self.assertEqual(item.geometry_snapshot["roll_width_mm"], 880.0)

        confirmed = SalesOrderService.confirm_sales_order(order.id)
        item = confirmed.items.get()

        self.assertEqual(item.geometry_snapshot["child_target_width_mm"], 440.0)
        self.assertEqual(item.geometry_snapshot["target_child_width_mm"], 440.0)
        self.assertEqual(item.geometry_snapshot["roll_width_mm"], 880.0)
        self.assertEqual(item.preferred_lane_count, 2)
        self.assertEqual(item.planned_parent_width_mm, Decimal("889"))

    @patch("apps.sales.services.order_service.SalesOrderService.preview_sales_item")
    def test_confirm_rejects_lane_outside_default_policy(self, preview_sales_item):
        preview_sales_item.return_value = {
            "unit_weight_g": Decimal("8.0000"),
            "total_weight_kg": Decimal("8.0000"),
            "bom": {"planning_lines": [], "is_complete": True},
        }

        order = SalesOrderService.create_sales_order(self._order_payload(lane_count=4))

        with self.assertRaisesMessage(ValidationError, "Lane count 4-up is not allowed"):
            SalesOrderService.confirm_sales_order(order.id)

    @patch("apps.sales.services.order_service.SalesOrderService.preview_sales_item")
    def test_confirm_respects_web_width_policy_formula_modes(self, preview_sales_item):
        preview_sales_item.return_value = {
            "unit_weight_g": Decimal("8.0000"),
            "total_weight_kg": Decimal("8.0000"),
            "bom": {"planning_lines": [], "is_complete": True},
        }
        self.policy.slitting_waste_rule = {"inter_cut_mm": 6, "edge_trim_mm": 3, "formula": "PER_LANE"}
        self.policy.save(update_fields=["slitting_waste_rule"])

        order = SalesOrderService.create_sales_order(self._order_payload(lane_count=3))
        confirmed = SalesOrderService.confirm_sales_order(order.id)
        item = confirmed.items.get()

        self.assertEqual(item.planned_parent_width_mm, Decimal("1344"))

    @patch("apps.sales.services.order_service.SalesOrderService.preview_sales_item")
    def test_nearest_standard_parent_width_strategy_picks_standard_width(self, preview_sales_item):
        preview_sales_item.return_value = {
            "unit_weight_g": Decimal("8.0000"),
            "total_weight_kg": Decimal("8.0000"),
            "bom": {"planning_lines": [], "is_complete": True},
        }
        self.policy.parent_width_strategy = "NEAREST_STANDARD"
        self.policy.allowed_parent_widths = [880, 1320]
        self.policy.slitting_waste_rule = {"inter_cut_mm": 0, "edge_trim_mm": 0, "formula": "FIXED"}
        self.policy.save(update_fields=["parent_width_strategy", "allowed_parent_widths", "slitting_waste_rule"])

        order = SalesOrderService.create_sales_order(self._order_payload(lane_count=2))
        confirmed = SalesOrderService.confirm_sales_order(order.id)
        item = confirmed.items.get()

        self.assertEqual(item.planned_parent_width_mm, Decimal("880"))
        self.assertEqual(item.geometry_snapshot["web_width_policy"]["parent_width_strategy"], "NEAREST_STANDARD")
        self.assertEqual(item.geometry_snapshot["web_width_policy"]["remainder_disposition"], "NONE")

    @patch("apps.sales.services.order_service.SalesOrderService.preview_sales_item")
    def test_strict_standard_parent_width_rejects_when_no_width_fits(self, preview_sales_item):
        preview_sales_item.return_value = {
            "unit_weight_g": Decimal("8.0000"),
            "total_weight_kg": Decimal("8.0000"),
            "bom": {"planning_lines": [], "is_complete": True},
        }
        self.policy.parent_width_strategy = "STRICT_STANDARD"
        self.policy.allowed_parent_widths = [880]
        self.policy.slitting_waste_rule = {"inter_cut_mm": 0, "edge_trim_mm": 0, "formula": "FIXED"}
        self.policy.save(update_fields=["parent_width_strategy", "allowed_parent_widths", "slitting_waste_rule"])

        order = SalesOrderService.create_sales_order(self._order_payload(lane_count=3))

        with self.assertRaisesMessage(ValidationError, "No allowed parent width can fit"):
            SalesOrderService.confirm_sales_order(order.id)

    @patch("apps.sales.services.order_service.SalesOrderService.preview_sales_item")
    def test_product_kind_scoped_policy_overrides_global_policy(self, preview_sales_item):
        preview_sales_item.return_value = {
            "unit_weight_g": Decimal("8.0000"),
            "total_weight_kg": Decimal("8.0000"),
            "bom": {"planning_lines": [], "is_complete": True},
        }
        self.policy.allowed_lanes = [1]
        self.policy.save(update_fields=["allowed_lanes"])
        WebWidthPolicy.objects.create(
            code="POUCH-LANE-SCOPE",
            name="Pouch scope policy",
            scope_type="PRODUCT_KIND",
            scope_ref="POUCH",
            allowed_lanes=[2],
            slitting_waste_rule={"inter_cut_mm": 0, "edge_trim_mm": 0, "formula": "FIXED"},
        )

        order = SalesOrderService.create_sales_order(self._order_payload(lane_count=2))
        confirmed = SalesOrderService.confirm_sales_order(order.id)
        item = confirmed.items.get()

        self.assertEqual(item.planned_parent_width_mm, Decimal("880"))
        self.assertEqual(item.geometry_snapshot["web_width_policy"]["policy_code"], "POUCH-LANE-SCOPE")
