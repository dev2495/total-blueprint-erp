from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from django.core.exceptions import ValidationError
from django.test import SimpleTestCase

from apps.materials.models import InventoryMaterial
from apps.production.models import PlannedBulkStockOrder, PlannedOrder, PlannedStockOrder
from apps.templates.models import TemplateBlueprint


class StockOrderClassTests(SimpleTestCase):
    def test_planned_stock_order_derives_planner_stock_class(self):
        template = TemplateBlueprint(
            fg_type="ROLL",
        )
        template._state.fields_cache["routing_rule"] = SimpleNamespace(ordered_processes=[1, 2, 3])

        order = PlannedStockOrder(
            template=template,
            stock_purpose="PRODUCT",
            stop_step_index=1,
        )

        self.assertEqual(order.derive_planner_stock_class(), "SHARED_INVARIANT_ROLL")

    def test_planned_stock_order_derives_extruded_base_roll_for_start_step_zero(self):
        template = TemplateBlueprint(
            fg_type="ROLL",
        )
        template._state.fields_cache["routing_rule"] = SimpleNamespace(ordered_processes=[1, 2, 3])

        order = PlannedStockOrder(
            template=template,
            stock_purpose="PRODUCT",
            stop_step_index=0,
        )

        self.assertEqual(order.derive_planner_stock_class(), "EXTRUDED_BASE_ROLL")

    def test_planned_stock_order_derives_final_plain_roll_for_final_roll_step(self):
        template = TemplateBlueprint(
            fg_type="ROLL",
        )
        template._state.fields_cache["routing_rule"] = SimpleNamespace(ordered_processes=[1, 2, 3])

        order = PlannedStockOrder(
            template=template,
            stock_purpose="PRODUCT",
            stop_step_index=2,
        )

        self.assertEqual(order.derive_planner_stock_class(), "FINAL_PLAIN_ROLL")

    def test_planned_bulk_stock_order_rejects_non_pod_material(self):
        material = InventoryMaterial(code="FILM-1", name="Film", category="FILM_VARIANT", base_uom="KG")
        order = PlannedBulkStockOrder(material=material, target_qty_kg=Decimal("10"))

        with self.assertRaises(ValidationError):
            order.clean()

    def test_planned_bulk_stock_order_accepts_pod_material(self):
        material = InventoryMaterial(code="POD-1", name="POD", category="POD", base_uom="KG")
        order = PlannedBulkStockOrder(material=material, target_qty_kg=Decimal("10"))

        order.clean()

    @patch("apps.production.models.PlannedOrder.objects.filter")
    def test_planned_order_uses_highest_existing_reference_suffix(self, mock_filter):
        mock_filter.return_value.values_list.return_value = [
            "MTS-2026-0002",
            "MTS-2026-0016",
            "MTS-2026-0040",
            "INVALID",
        ]

        self.assertEqual(PlannedOrder._next_reference_code(now=SimpleNamespace(year=2026)), "MTS-2026-0041")

    @patch("apps.production.models.PlannedStockOrder.objects.filter")
    def test_planned_stock_order_uses_highest_existing_order_suffix(self, mock_filter):
        mock_filter.return_value.values_list.return_value = [
            "STK-2026-0002",
            "STK-2026-0016",
            "STK-2026-0100",
            "STK-2025-9999",
            "BROKEN",
        ]

        self.assertEqual(PlannedStockOrder._next_order_number(now=SimpleNamespace(year=2026)), "STK-2026-0101")

    @patch("apps.production.models.PlannedBulkStockOrder.objects.filter")
    def test_planned_bulk_order_uses_highest_existing_order_suffix(self, mock_filter):
        mock_filter.return_value.values_list.return_value = [
            "PBK-2026-0001",
            "PBK-2026-0004",
            "PBK-2026-0020",
            "X",
        ]

        self.assertEqual(PlannedBulkStockOrder._next_order_number(now=SimpleNamespace(year=2026)), "PBK-2026-0021")
