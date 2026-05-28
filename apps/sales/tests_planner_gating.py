from decimal import Decimal
from types import SimpleNamespace
from contextlib import nullcontext
from unittest.mock import Mock, patch

from django.test import SimpleTestCase

from apps.sales.services.order_service import SalesOrderService


class SalesConfirmPlannerGatingTests(SimpleTestCase):
    @patch("apps.sales.services.order_service.SalesOrder.objects.select_for_update")
    @patch("apps.sales.services.order_service.SalesOrderService.preview_sales_item")
    @patch("apps.sales.services.order_service.transaction.atomic")
    @patch("apps.materials.services_web_width_policy.web_width_context_from_sales_order_item")
    @patch("apps.materials.services_web_width_policy.evaluate_web_width_plan")
    @patch("apps.production.services.in_house_demand_service.InHouseDemandService.create_for_order")
    def test_confirm_sets_planning_required_without_job_release(
        self,
        mock_create_demand,
        mock_evaluate_width,
        mock_width_context,
        mock_atomic,
        mock_preview,
        mock_select_for_update,
    ):
        mock_atomic.return_value = nullcontext()
        template = SimpleNamespace(
            name="Template A",
            status="LIVE",
            routing_rule=SimpleNamespace(ordered_processes=["EXTRUSION", "PRINT"]),
            fg_type="POUCH",
            geometry_schema={"base": {"width_mm": 120, "height_mm": 180}, "adjustments": []},
            layer_schema=[],
            printing_schema={"enabled": False},
            addons_schema=[],
        )

        item = SimpleNamespace(
            id="item-1",
            template=template,
            qty_value=Decimal("100"),
            qty_uom="KG",
            price_basis="KG",
            geometry_snapshot={},
            layer_snapshot=[],
            packaging_snapshot={},
            printing_snapshot={},
            addons_snapshot=[],
            bom_snapshot={},
            unit_weight_g=Decimal("0"),
            total_weight_kg=Decimal("0"),
            save=Mock(),
            artwork_assignment_required=False,
            assigned_artwork_id="",
            preferred_lane_count=1,
            planned_parent_width_mm=None,
            lane_count_source="manual",
        )

        order = SimpleNamespace(
            id="SO-1",
            status="DRAFT",
            geometry_override={"width_mm": 150, "height_mm": 220, "adjustments": []},
            commercial_confirmed_at=None,
            items=SimpleNamespace(all=lambda: [item]),
            save=Mock(),
        )

        mock_select_for_update.return_value.get.return_value = order
        mock_preview.return_value = {
            "bom": {"films": []},
            "unit_weight_g": 25.0,
            "total_weight_kg": 100.0,
        }
        mock_width_context.return_value = {}
        mock_evaluate_width.return_value = {
            "planned_parent_width_mm": 150,
            "policy_id": None,
            "policy_code": None,
            "policy_name": None,
            "scope_type": None,
            "scope_ref": None,
            "parent_width_strategy": "CALCULATED",
            "computed_run_width_mm": 150,
            "trim_mm": 0,
            "remainder_mm": 0,
            "remainder_disposition": "NONE",
        }

        returned = SalesOrderService.confirm_sales_order(order.id)

        self.assertIs(returned, order)
        self.assertEqual(order.status, "PLANNING_REQUIRED")
        self.assertIsNotNone(order.commercial_confirmed_at)
        order.save.assert_called_once()
        item.save.assert_called_once()
        mock_create_demand.assert_called_once_with(order)
