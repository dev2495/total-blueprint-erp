from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from apps.production.services.dispatch_service import FGDispatchService


class DispatchLineageTests(SimpleTestCase):
    def test_pack_roll_marks_explicit_lines_as_non_defaulted(self):
        roll = SimpleNamespace(
            id="roll-1",
            label_id="ROLL-1",
            sales_order_item_id="so-item-1",
            sales_order_item=SimpleNamespace(
                packaging_snapshot={"roll_dispatch_pack": {"enabled": True, "lines": [{"material_id": "default-1", "qty": 1}]}},
                sales_order=SimpleNamespace(order_number="SO-1"),
            ),
            location_id="loc-1",
        )

        def build_record(**kwargs):
            return SimpleNamespace(**kwargs)

        with patch("apps.production.services.dispatch_service.InventoryRoll.objects.select_related") as select_related, \
             patch("apps.production.services.dispatch_service.RollDispatchPackRecord.objects.filter") as existing_filter, \
             patch("apps.production.services.dispatch_service.RollDispatchPackRecord.objects.create", side_effect=build_record), \
             patch("apps.inventory.services.packaging_service.PackagingService.consume_packaging_stock", return_value=SimpleNamespace(id="tx-1")):
            select_related.return_value.get.return_value = roll
            existing_filter.return_value.first.return_value = None

            record = FGDispatchService.pack_roll.__wrapped__(
                "roll-1",
                [{"material_id": "sheet-1", "qty": 1, "uom": "PCS", "basis": "PER_ROLL"}],
                user=None,
            )

        self.assertEqual(record.lines[0]["material_id"], "sheet-1")
        self.assertFalse(record.meta_json["defaulted_from_snapshot"])

    def test_create_challan_rejects_direct_batch_dispatch_for_sales_order(self):
        with self.assertRaisesMessage(
            ValueError,
            "Direct FG batch dispatch is not allowed for sales orders. Dispatch sealed gonnies instead.",
        ):
            FGDispatchService.create_challan.__wrapped__(
                customer_name="Test Customer",
                plant_id="plant-1",
                sales_order_id="so-1",
                batch_items=[{"batch_id": "batch-1", "qty_pcs": 10, "weight_kg": 2.5}],
                user=None,
            )

    def test_create_challan_rejects_unsealed_gonny(self):
        challan = SimpleNamespace(id="dc-1", dc_no="DC-1")
        gonny = SimpleNamespace(
            id="gonny-1",
            label_id="G-1",
            status="OPEN",
            weight_kg=None,
            qty_pcs=20,
            sales_order_item_id="so-item-1",
            sales_order_item=SimpleNamespace(sales_order_id="so-1"),
        )

        with patch("apps.factory.models.Plant.objects.get", return_value=SimpleNamespace(id="plant-1")), \
             patch("apps.production.services.dispatch_service.DeliveryChallan.objects.count", return_value=0), \
             patch("apps.production.services.dispatch_service.DeliveryChallan.objects.create", return_value=challan), \
             patch("apps.production.services.dispatch_service.PackingUnit.objects.filter", return_value=[gonny]):
            with self.assertRaisesMessage(ValueError, "must be sealed before dispatch"):
                FGDispatchService.create_challan.__wrapped__(
                    customer_name="Test Customer",
                    plant_id="plant-1",
                    sales_order_id="so-1",
                    gonny_ids=["gonny-1"],
                    user=None,
                )
