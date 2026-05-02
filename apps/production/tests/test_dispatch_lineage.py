from decimal import Decimal
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
                packaging_snapshot={"roll_dispatch_pack": {"enabled": True, "lines": [{"material_id": "sheet-1", "qty": 0, "uom": "PCS", "basis": "PER_ROLL"}]}},
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

    def test_pack_roll_defaults_from_sku_snapshot_when_lines_not_overridden(self):
        roll = SimpleNamespace(
            id="roll-1",
            label_id="ROLL-1",
            sales_order_item_id="so-item-1",
            sales_order_item=SimpleNamespace(
                packaging_snapshot={"roll_dispatch_pack": {"enabled": True, "lines": [{"material_id": "sheet-1", "qty": 2, "uom": "PCS", "basis": "PER_ROLL"}]}},
                sales_order=SimpleNamespace(order_number="SO-1"),
            ),
            location_id="loc-1",
        )

        with patch("apps.production.services.dispatch_service.InventoryRoll.objects.select_related") as select_related, \
             patch("apps.production.services.dispatch_service.RollDispatchPackRecord.objects.filter") as existing_filter, \
             patch("apps.production.services.dispatch_service.RollDispatchPackRecord.objects.create") as create_record, \
             patch("apps.inventory.services.packaging_service.PackagingService.consume_packaging_stock", return_value=SimpleNamespace(id="tx-1")):
            select_related.return_value.get.return_value = roll
            existing_filter.return_value.first.return_value = None
            create_record.side_effect = lambda **kwargs: SimpleNamespace(**kwargs)

            record = FGDispatchService.pack_roll.__wrapped__("roll-1", None, user=None)

        self.assertEqual(record.lines[0]["material_id"], "sheet-1")
        self.assertEqual(record.lines[0]["qty"], 2.0)
        self.assertTrue(record.meta_json["defaulted_from_snapshot"])
        self.assertFalse(record.meta_json["snapshot_override"])

    def test_pack_roll_allows_explicit_material_override_outside_snapshot(self):
        roll = SimpleNamespace(
            id="roll-1",
            label_id="ROLL-1",
            sales_order_item_id="so-item-1",
            sales_order_item=SimpleNamespace(
                packaging_snapshot={"roll_dispatch_pack": {"enabled": True, "lines": [{"material_id": "sheet-1", "qty": 0, "uom": "PCS", "basis": "PER_ROLL"}]}},
                sales_order=SimpleNamespace(order_number="SO-1"),
            ),
            location_id="loc-1",
        )

        with patch("apps.production.services.dispatch_service.InventoryRoll.objects.select_related") as select_related, \
             patch("apps.production.services.dispatch_service.RollDispatchPackRecord.objects.filter") as existing_filter, \
             patch("apps.production.services.dispatch_service.RollDispatchPackRecord.objects.create") as create_record, \
             patch("apps.inventory.services.packaging_service.PackagingService.consume_packaging_stock", return_value=SimpleNamespace(id="tx-1")):
            select_related.return_value.get.return_value = roll
            existing_filter.return_value.first.return_value = None
            create_record.side_effect = lambda **kwargs: SimpleNamespace(**kwargs)

            record = FGDispatchService.pack_roll.__wrapped__(
                "roll-1",
                [{"material_id": "tape-1", "qty": 1, "uom": "PCS", "basis": "PER_ROLL"}],
                user=None,
            )

        self.assertTrue(record.meta_json["snapshot_override"])
        self.assertEqual(record.meta_json["override_material_ids"], ["tape-1"])
        self.assertTrue(record.lines[0]["snapshot_override"])

    def test_pack_roll_allows_explicit_lines_when_snapshot_not_configured(self):
        roll = SimpleNamespace(
            id="roll-1",
            label_id="ROLL-1",
            sales_order_item_id="so-item-1",
            sales_order_item=SimpleNamespace(
                packaging_snapshot={"roll_dispatch_pack": {"enabled": False, "lines": []}},
                sales_order=SimpleNamespace(order_number="SO-1"),
            ),
            location_id="loc-1",
        )

        with patch("apps.production.services.dispatch_service.InventoryRoll.objects.select_related") as select_related, \
             patch("apps.production.services.dispatch_service.RollDispatchPackRecord.objects.filter") as existing_filter, \
             patch("apps.production.services.dispatch_service.RollDispatchPackRecord.objects.create") as create_record, \
             patch("apps.inventory.services.packaging_service.PackagingService.consume_packaging_stock", return_value=SimpleNamespace(id="tx-1")):
            select_related.return_value.get.return_value = roll
            existing_filter.return_value.first.return_value = None
            create_record.side_effect = lambda **kwargs: SimpleNamespace(**kwargs)

            record = FGDispatchService.pack_roll.__wrapped__(
                "roll-1",
                [{"material_id": "sheet-1", "qty": 1, "uom": "PCS", "basis": "PER_ROLL"}],
                user=None,
            )

        self.assertTrue(record.meta_json["snapshot_override"])
        self.assertFalse(record.meta_json["snapshot_enabled"])

    def test_pack_roll_rejects_default_packed_release_when_snapshot_not_configured(self):
        roll = SimpleNamespace(
            id="roll-1",
            label_id="ROLL-1",
            sales_order_item_id="so-item-1",
            sales_order_item=SimpleNamespace(
                packaging_snapshot={"roll_dispatch_pack": {"enabled": False, "lines": []}},
                sales_order=SimpleNamespace(order_number="SO-1"),
            ),
            location_id="loc-1",
        )

        with patch("apps.production.services.dispatch_service.InventoryRoll.objects.select_related") as select_related, \
             patch("apps.production.services.dispatch_service.RollDispatchPackRecord.objects.filter") as existing_filter:
            select_related.return_value.get.return_value = roll
            existing_filter.return_value.first.return_value = None

            with self.assertRaisesMessage(ValueError, "has no allowed packing materials"):
                FGDispatchService.pack_roll.__wrapped__("roll-1", None, user=None)

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

    def test_create_challan_rejects_roll_not_released_from_packing_yard(self):
        challan = SimpleNamespace(id="dc-1", dc_no="DC-1")
        roll = SimpleNamespace(
            id="roll-1",
            label_id="ROLL-1",
            sales_order_item_id="so-item-1",
            sales_order_item=SimpleNamespace(sales_order_id="so-1"),
            weight_kg=10,
        )

        roll_qs = [roll]
        record_filter = SimpleNamespace(first=lambda: SimpleNamespace(meta_json={"released_to_dispatch": False}))

        with patch("apps.factory.models.Plant.objects.get", return_value=SimpleNamespace(id="plant-1")), \
             patch("apps.production.services.dispatch_service.DeliveryChallan.objects.count", return_value=0), \
             patch("apps.production.services.dispatch_service.DeliveryChallan.objects.create", return_value=challan), \
             patch("apps.production.services.dispatch_service.InventoryRoll.objects.filter", return_value=roll_qs), \
             patch("apps.production.services.dispatch_service.RollDispatchPackRecord.objects.filter", return_value=record_filter):
            with self.assertRaisesMessage(ValueError, "is not released to Dispatch Bay yet"):
                FGDispatchService.create_challan.__wrapped__(
                    customer_name="Test Customer",
                    plant_id="plant-1",
                    sales_order_id="so-1",
                    roll_ids=["roll-1"],
                    user=None,
                )

    def test_create_challan_uses_gonny_gross_weight_as_shipping_weight(self):
        challan = SimpleNamespace(id="dc-1", dc_no="DC-1")
        sales_order_item = SimpleNamespace(sales_order_id="so-1")
        gonny = SimpleNamespace(
            id="gonny-1",
            label_id="G-1",
            status="SEALED",
            weight_kg=Decimal("10.0000"),
            gross_weight_kg=Decimal("11.5000"),
            qty_pcs=20,
            sales_order_item_id="so-item-1",
            sales_order_item=sales_order_item,
            meta_json={"released_to_dispatch": True, "dispatch_unit_no": "G-1"},
        )
        challan_filter = SimpleNamespace(values_list=lambda *args, **kwargs: [], exists=lambda: False)

        with patch("apps.factory.models.Plant.objects.get", return_value=SimpleNamespace(id="plant-1")), \
             patch("apps.production.services.dispatch_service.DeliveryChallan.objects.filter", return_value=challan_filter), \
             patch("apps.production.services.dispatch_service.DeliveryChallan.objects.create", return_value=challan), \
             patch("apps.production.services.dispatch_service.DeliveryChallanItem.objects.create") as create_item, \
             patch("apps.production.services.dispatch_service.PackingUnit.objects.filter", return_value=[gonny]):
            result = FGDispatchService.create_challan.__wrapped__(
                customer_name="Test Customer",
                plant_id="plant-1",
                sales_order_id="so-1",
                gonny_ids=["gonny-1"],
                user=None,
            )

        self.assertIs(result, challan)
        self.assertEqual(create_item.call_args.kwargs["weight_kg"], Decimal("11.5000"))

    def test_release_gonny_to_dispatch_marks_release_meta(self):
        gonny = SimpleNamespace(
            id="gonny-1",
            label_id="G-1",
            status="SEALED",
            gross_weight_kg=Decimal("12.5000"),
            meta_json={},
            save=lambda **kwargs: None,
        )

        with patch("apps.production.services.dispatch_service.PackingUnit.objects.select_related") as select_related:
            select_related.return_value.get.return_value = gonny
            result = FGDispatchService.release_gonny_to_dispatch.__wrapped__("gonny-1", user=None)

        self.assertIs(result, gonny)
        self.assertTrue(gonny.meta_json["released_to_dispatch"])
        self.assertEqual(gonny.meta_json["dispatch_unit_no"], "G-1")

    def test_release_roll_to_dispatch_allows_unpacked_release(self):
        roll = SimpleNamespace(
            id="roll-1",
            label_id="ROLL-1",
            sales_order_item_id="so-item-1",
            sales_order_item=SimpleNamespace(sales_order=SimpleNamespace(order_number="SO-1")),
            status="AVAILABLE",
        )

        def build_record(**kwargs):
            return SimpleNamespace(save=lambda **save_kwargs: None, **kwargs)

        with patch("apps.production.services.dispatch_service.InventoryRoll.objects.select_related") as select_related, \
             patch("apps.production.services.dispatch_service.RollDispatchPackRecord.objects.filter") as existing_filter, \
             patch("apps.production.services.dispatch_service.RollDispatchPackRecord.objects.create", side_effect=build_record):
            select_related.return_value.get.return_value = roll
            existing_filter.return_value.first.return_value = None

            record = FGDispatchService.release_roll_to_dispatch.__wrapped__(
                "roll-1",
                user=None,
                lines=[],
                release_mode="UNPACKED",
            )

        self.assertEqual(record.lines, [])
        self.assertTrue(record.meta_json["released_to_dispatch"])
        self.assertEqual(record.meta_json["release_mode"], "UNPACKED")
        self.assertEqual(record.meta_json["dispatch_unit_no"], "RDU-ROLL-1")

    def test_bulk_release_rolls_consumes_total_pack_material_once(self):
        sales_order = SimpleNamespace(order_number="SO-1", status="IN_PROGRESS", save=lambda **kwargs: None)
        sales_order_item = SimpleNamespace(
            packaging_snapshot={"roll_dispatch_pack": {"enabled": True, "lines": [{"material_id": "sheet-1", "qty": 1, "uom": "PCS", "basis": "PER_ROLL"}]}},
            sales_order=sales_order,
        )
        rolls = [
            SimpleNamespace(id="roll-1", label_id="ROLL-1", batch_no="B-1", sales_order_item_id="so-item-1", sales_order_item=sales_order_item, location_id="loc-1", status="AVAILABLE"),
            SimpleNamespace(id="roll-2", label_id="ROLL-2", batch_no="B-2", sales_order_item_id="so-item-1", sales_order_item=sales_order_item, location_id="loc-1", status="AVAILABLE"),
        ]
        existing_filter = SimpleNamespace(values_list=lambda *args, **kwargs: [])

        with patch("apps.production.services.dispatch_service.InventoryRoll.objects.select_related") as select_related, \
             patch("apps.production.services.dispatch_service.RollDispatchPackRecord.objects.filter", return_value=existing_filter), \
             patch("apps.production.services.dispatch_service.RollDispatchPackRecord.objects.create") as create_record, \
             patch("apps.inventory.services.packaging_service.PackagingService.consume_packaging_stock", return_value=SimpleNamespace(id="tx-1")) as consume_stock:
            select_related.return_value.filter.return_value = rolls
            create_record.side_effect = lambda **kwargs: SimpleNamespace(**kwargs)

            records = FGDispatchService.release_rolls_to_dispatch.__wrapped__(
                ["roll-1", "roll-2"],
                user=None,
                lines=[{"material_id": "sheet-1", "qty": 2.5, "uom": "PCS", "basis": "TOTAL_ROLLS"}],
                release_mode="PACKED",
            )

        self.assertEqual(len(records), 2)
        consume_stock.assert_called_once()
        self.assertEqual(consume_stock.call_args.kwargs["qty"], Decimal("2.5"))
        self.assertEqual(consume_stock.call_args.kwargs["meta_json"]["roll_count"], 2)
        self.assertEqual(records[0].lines[0]["bulk_total_qty"], 2.5)
        self.assertEqual(records[0].lines[0]["qty"], 1.25)
        self.assertEqual(records[0].meta_json["bulk_roll_count"], 2)
