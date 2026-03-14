from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from apps.inventory.views import RollViewSet


class RollSplitApiTests(SimpleTestCase):
    def test_split_endpoint_returns_claim_and_balance_children(self):
        roll = SimpleNamespace(
            id="parent-roll",
            label_id="ROLL-1",
            status="AVAILABLE",
            weight_kg=Decimal("10"),
            sales_order_item_id=None,
            meta_json={},
            save=MagicMock(),
        )
        claim_child = SimpleNamespace(id="claim-roll", label_id="ROLL-1-CLAIM", meta_json={"split_role": "CLAIM_CHILD"})
        balance_child = SimpleNamespace(id="balance-roll", label_id="ROLL-1-BAL", meta_json={"split_role": "BALANCE_CHILD"})
        request = SimpleNamespace(
            data={"child_weight_kg": "4", "reason": "SALES_CLAIM"},
            user=SimpleNamespace(is_authenticated=False),
        )

        def serialize(obj):
            return SimpleNamespace(data={"id": str(obj.id), "label_id": obj.label_id})

        with patch("apps.inventory.views.InventoryRoll.objects.select_related") as roll_select, \
             patch("apps.production.models.InventoryAllocation.objects.filter") as allocation_filter, \
             patch("apps.inventory.views.RollService.split_roll", return_value=[claim_child, balance_child]), \
             patch("apps.inventory.views.InventoryRollSerializer", side_effect=serialize):
            roll_select.return_value.get.return_value = roll
            allocation_filter.return_value.exists.return_value = False

            response = RollViewSet().split_for_claim(request, pk="parent-roll")

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["status"], "split")
        self.assertEqual(response.data["claim_roll"]["id"], "claim-roll")
        self.assertEqual(response.data["balance_roll"]["id"], "balance-roll")
