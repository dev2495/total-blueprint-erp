from decimal import Decimal
from types import SimpleNamespace
from contextlib import nullcontext
from unittest.mock import Mock, patch

from django.test import SimpleTestCase

from apps.sales.services.order_service import SalesOrderService


class SalesConfirmPlannerGatingTests(SimpleTestCase):
    @patch("apps.sales.services.order_service.SalesOrder.objects.get")
    @patch("apps.sales.services.order_service.SalesOrderService.preview_sales_item")
    @patch("apps.sales.services.order_service.transaction.atomic")
    def test_confirm_sets_planning_required_without_job_release(self, mock_atomic, mock_preview, mock_get_order):
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
            template=template,
            qty_value=Decimal("100"),
            qty_uom="KG",
            geometry_snapshot={},
            layer_snapshot=[],
            printing_snapshot={},
            addons_snapshot=[],
            bom_snapshot={},
            unit_weight_g=Decimal("0"),
            total_weight_kg=Decimal("0"),
            save=Mock(),
        )

        order = SimpleNamespace(
            id="SO-1",
            status="DRAFT",
            geometry_override={"width_mm": 150, "height_mm": 220, "adjustments": []},
            commercial_confirmed_at=None,
            items=SimpleNamespace(all=lambda: [item]),
            save=Mock(),
        )

        mock_get_order.return_value = order
        mock_preview.return_value = {
            "bom": {"films": []},
            "unit_weight_g": 25.0,
            "total_weight_kg": 100.0,
        }

        returned = SalesOrderService.confirm_sales_order("SO-1")

        self.assertIs(returned, order)
        self.assertEqual(order.status, "PLANNING_REQUIRED")
        self.assertIsNotNone(order.commercial_confirmed_at)
        order.save.assert_called_once()
        item.save.assert_called_once()
