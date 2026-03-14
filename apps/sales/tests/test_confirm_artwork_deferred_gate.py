from contextlib import nullcontext
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import SimpleTestCase

from apps.sales.services.order_service import SalesOrderService


class SalesConfirmArtworkDeferredGateTests(SimpleTestCase):
    @patch("apps.sales.services.order_service.SalesOrder.objects.get")
    @patch("apps.sales.services.order_service.SalesOrderService.preview_sales_item")
    @patch("apps.sales.services.order_service._validate_printing_snapshot_for_confirm")
    @patch("apps.sales.services.order_service._validate_template_film_constraints")
    @patch("apps.sales.services.order_service.transaction.atomic")
    def test_confirm_allows_printing_without_artwork_and_sets_planner_gate(
        self,
        mock_atomic,
        _mock_template_constraints,
        mock_validate_printing,
        mock_preview,
        mock_get_order,
    ):
        mock_atomic.return_value = nullcontext()
        template = SimpleNamespace(
            name="Template A",
            status="LIVE",
            routing_rule=SimpleNamespace(ordered_processes=["EXTRUSION", "PRINT"]),
            routing_rule_id="route-1",
            fg_type="POUCH",
        )
        item = SimpleNamespace(
            template=template,
            template_id="tpl-1",
            qty_value=Decimal("100"),
            qty_uom="KG",
            price_basis="KG",
            geometry_snapshot={"base": {"width_mm": 120, "height_mm": 180}},
            layer_snapshot=[],
            packaging_snapshot={},
            printing_snapshot={
                "enabled": True,
                "type": "ROTO",
                "substrate_mode": "SHEET",
                "front_colors_count": 2,
                "back_colors_count": 0,
                "ink_gsm_total": 1.2,
                "artwork_id": None,
            },
            addons_snapshot=[],
            bom_snapshot={},
            unit_weight_g=Decimal("0"),
            total_weight_kg=Decimal("0"),
            save=Mock(),
            artwork_assignment_required=False,
            assigned_artwork_id="",
        )
        order = SimpleNamespace(
            id="SO-PLANNER-GATE",
            status="DRAFT",
            geometry_override={},
            commercial_confirmed_at=None,
            items=SimpleNamespace(all=lambda: [item]),
            save=Mock(),
        )

        mock_get_order.return_value = order
        mock_validate_printing.return_value = (
            {
                "enabled": True,
                "type": "ROTO",
                "substrate_mode": "SHEET",
                "front_colors_count": 2,
                "back_colors_count": 0,
                "ink_gsm_total": 1.2,
            },
            True,
            None,
        )
        mock_preview.return_value = {
            "bom": {"inks": []},
            "unit_weight_g": 25.0,
            "total_weight_kg": 100.0,
        }

        SalesOrderService.confirm_sales_order("SO-PLANNER-GATE")

        self.assertEqual(order.status, "PLANNING_REQUIRED")
        self.assertTrue(item.artwork_assignment_required)
        self.assertIsNone(item.assigned_artwork_id)
        mock_validate_printing.assert_called_once()
        self.assertTrue(mock_validate_printing.call_args.kwargs.get("allow_missing_artwork"))
