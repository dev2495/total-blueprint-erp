from contextlib import nullcontext
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from django.core.exceptions import ValidationError
from django.test import SimpleTestCase

from apps.production.views_planner import PlannerViewSet


class PlannerAssignArtworkGateTests(SimpleTestCase):
    @patch("apps.production.views_planner.transaction.atomic", return_value=nullcontext())
    @patch("apps.production.views_planner.Artwork.objects.get")
    @patch.object(PlannerViewSet, "_get_order_for_kind")
    @patch.object(PlannerViewSet, "_pending_sales_print_items")
    def test_rejects_item_id_not_in_pending_artwork_state(
        self,
        mock_pending,
        mock_get_order,
        mock_get_artwork,
        _mock_atomic,
    ):
        pending_item = SimpleNamespace(id="item-pending")
        non_pending_item = SimpleNamespace(id="item-non-pending")
        order_obj = SimpleNamespace(
            id="order-1",
            items=SimpleNamespace(all=lambda: [pending_item, non_pending_item], first=lambda: non_pending_item),
        )
        mock_get_order.return_value = ("sales", order_obj, None, 0)
        mock_pending.return_value = [pending_item]
        mock_get_artwork.return_value = SimpleNamespace(id="art-1", status="APPROVED")

        request = SimpleNamespace(data={"artwork_id": "art-1", "item_id": "item-non-pending"})
        response = PlannerViewSet().control_hub_assign_artwork(request, order_kind="sales", order_id="order-1")

        self.assertEqual(response.status_code, 400)
        self.assertIn("pending printing artwork-assignment", str(response.data.get("error")))

    @patch("apps.production.views_planner.transaction.atomic", return_value=nullcontext())
    @patch("apps.production.views_planner.Artwork.objects.get")
    @patch.object(PlannerViewSet, "_get_order_for_kind")
    @patch.object(PlannerViewSet, "_pending_sales_print_items")
    def test_rejects_assignment_when_no_pending_items_exist(
        self,
        mock_pending,
        mock_get_order,
        mock_get_artwork,
        _mock_atomic,
    ):
        order_obj = SimpleNamespace(id="order-2", items=SimpleNamespace(all=lambda: [], first=lambda: None))
        mock_get_order.return_value = ("sales", order_obj, None, 0)
        mock_pending.return_value = []
        mock_get_artwork.return_value = SimpleNamespace(id="art-2", status="APPROVED")

        request = SimpleNamespace(data={"artwork_id": "art-2"})
        response = PlannerViewSet().control_hub_assign_artwork(request, order_kind="sales", order_id="order-2")

        self.assertEqual(response.status_code, 400)
        self.assertIn("No pending printing item", str(response.data.get("error")))

    @patch("apps.production.views_planner.transaction.atomic", return_value=nullcontext())
    @patch("apps.production.views_planner.Artwork.objects.get")
    @patch.object(PlannerViewSet, "_get_order_for_kind")
    @patch.object(PlannerViewSet, "_pending_sales_print_items")
    @patch.object(PlannerViewSet, "_apply_artwork_to_sales_item")
    def test_assigns_when_item_is_pending(
        self,
        mock_apply,
        mock_pending,
        mock_get_order,
        mock_get_artwork,
        _mock_atomic,
    ):
        pending_item = SimpleNamespace(id="item-1")
        order_obj = SimpleNamespace(
            id="order-3",
            items=SimpleNamespace(all=lambda: [pending_item], first=lambda: pending_item),
        )
        artwork = SimpleNamespace(id="art-3", status="APPROVED")
        mock_get_order.return_value = ("sales", order_obj, None, 0)
        mock_pending.return_value = [pending_item]
        mock_get_artwork.return_value = artwork

        request = SimpleNamespace(data={"artwork_id": "art-3", "item_id": "item-1"})
        response = PlannerViewSet().control_hub_assign_artwork(request, order_kind="sales", order_id="order-3")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data.get("status"), "assigned")
        mock_apply.assert_called_once_with(pending_item, artwork)

    @patch("apps.production.views_planner.SalesOrderService.preview_sales_item")
    @patch("apps.production.views_planner._validate_printing_snapshot_for_confirm")
    def test_apply_artwork_to_sales_item_replaces_snapshot_artwork_and_clears_gate(
        self,
        mock_validate_printing,
        mock_preview,
    ):
        item = SimpleNamespace(
            id="item-apply-1",
            printing_snapshot={
                "enabled": True,
                "type": "ROTO",
                "substrate_mode": "SHEET",
                "front_colors_count": 1,
                "back_colors_count": 0,
                "artwork_id": "stale-artwork",
            },
            artwork_assignment_required=True,
            assigned_artwork_id="",
            geometry_snapshot={"finished_good_type": "POUCH"},
            layer_snapshot=[{"density_g_cm3": 0.92}],
            addons_snapshot=[],
            bom_snapshot={},
            qty_value=Decimal("100"),
            qty_uom="KG",
            template=SimpleNamespace(fg_type="POUCH"),
            save=lambda **kwargs: None,
        )
        artwork = SimpleNamespace(id="approved-artwork-1")
        mock_validate_printing.return_value = (
            {
                "enabled": True,
                "type": "ROTO",
                "substrate_mode": "SHEET",
                "front_colors_count": 1,
                "back_colors_count": 0,
                "artwork_id": "approved-artwork-1",
                "front_colors": ["CYAN"],
                "back_colors": [],
                "color_names": ["CYAN"],
                "color_mapping": {"CYAN": "ink-1"},
                "ink_base_family": "POLY",
                "artwork_design_code": "ART-APPROVED-1",
                "cylinder_required": True,
            },
            False,
            "approved-artwork-1",
        )
        mock_preview.return_value = {"bom": {"inks": []}, "unit_weight_g": 25.0, "total_weight_kg": 100.0}

        PlannerViewSet()._apply_artwork_to_sales_item(item, artwork)

        self.assertEqual(item.printing_snapshot["artwork_id"], "approved-artwork-1")
        self.assertFalse(item.artwork_assignment_required)
        self.assertEqual(item.assigned_artwork_id, "approved-artwork-1")

    @patch("apps.production.views_planner._validate_printing_snapshot_for_confirm")
    def test_release_validation_blocks_invalid_print_contract_even_without_pending_flag(self, mock_validate):
        item = SimpleNamespace(
            printing_snapshot={"enabled": True, "type": "FLEXO"},
            artwork_assignment_required=False,
        )
        order_obj = SimpleNamespace(items=SimpleNamespace(all=lambda: [item]))
        mock_validate.side_effect = ValidationError("Item X: artwork_id is invalid.")

        with self.assertRaises(ValidationError) as exc:
            PlannerViewSet()._validate_order_printing_for_release("sales", order_obj)

        self.assertIn("artwork_id is invalid", str(exc.exception))
