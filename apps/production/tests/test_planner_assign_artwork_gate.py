from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import patch

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
