from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase
from rest_framework.test import APIRequestFactory

from apps.sales.models import SalesOrderItem
from apps.sales.serializers_orders import SalesOrderListSerializer, SalesOrderSerializer
from apps.sales.views_orders import SalesOrderViewSet


class _Manager:
    def __init__(self, rows):
        self._rows = list(rows)

    def all(self):
        return list(self._rows)


class _RaisingManager:
    def all(self):
        raise AssertionError("compact list serializer must not touch heavy reverse relations")


class SalesOrderListSummaryTests(SimpleTestCase):
    def _serializer(self):
        return SalesOrderSerializer()

    def test_serializer_builds_item_qty_and_fulfillment_summaries_for_pouch_lines(self):
        first_item = SimpleNamespace(
            sku_variant=SimpleNamespace(code="CB2-3L-POD", name="Courier Bag 2 3L POD"),
            template=SimpleNamespace(name="Courier Bag Template", fg_type="POUCH"),
            geometry_snapshot={"base": {"width_mm": 220, "height_mm": 320}, "finished_good_type": "POUCH"},
            layer_snapshot=[{"code": "PET12"}, {"code": "MPET12"}, {"code": "PE40"}],
            printing_snapshot={"enabled": True, "type": "ROTO", "front_colors_count": 4, "back_colors_count": 1},
            addons_snapshot=[{"id": "zipper"}],
            packaging_snapshot={
                "pod": {"enabled": True},
                "primary_inner_pack": {"enabled": True, "pcs_per_pack": 25},
            },
            total_weight_kg=Decimal("18.5"),
            qty_uom="PCS",
            qty_value=Decimal("5000"),
            unit_weight_g=Decimal("3.7"),
            inventory_rolls=_Manager([]),
            fg_batches=_Manager(
                [
                    SimpleNamespace(qty_pcs=1200, qty_kg=Decimal("4.2"), status="AVAILABLE", meta_json={}),
                ]
            ),
            packing_units=_Manager(
                [
                    SimpleNamespace(qty_pcs=800, net_product_weight_kg=Decimal("2.8"), weight_kg=Decimal("3.0"), status="SEALED"),
                    SimpleNamespace(qty_pcs=600, net_product_weight_kg=Decimal("2.1"), weight_kg=Decimal("2.2"), status="DISPATCHED"),
                ]
            ),
        )
        second_item = SimpleNamespace(
            sku_variant=SimpleNamespace(code="CB2-3L-POD-SM", name="Courier Bag 2 Small"),
            template=SimpleNamespace(name="Courier Bag Template", fg_type="POUCH"),
            geometry_snapshot={"base": {"width_mm": 180, "height_mm": 240}, "finished_good_type": "POUCH"},
            layer_snapshot=[{"id": "1"}, {"id": "2"}, {"id": "3"}],
            printing_snapshot={"enabled": False},
            addons_snapshot=[],
            packaging_snapshot={"pod": {"enabled": False}},
            total_weight_kg=Decimal("5.5"),
            qty_uom="PCS",
            qty_value=Decimal("1500"),
            inventory_rolls=_Manager([]),
            fg_batches=_Manager([]),
            packing_units=_Manager([]),
        )
        order = SimpleNamespace(items=_Manager([first_item, second_item]))

        serializer = self._serializer()
        item_summary = serializer.get_item_summary(order)
        qty_summary = serializer.get_qty_summary(order)
        fulfillment = serializer.get_fulfillment_summary(order)

        self.assertEqual(item_summary["variant_code"], "CB2-3L-POD")
        self.assertEqual(item_summary["line_count"], 2)
        self.assertEqual(item_summary["size_or_form"], "220 x 320")
        self.assertEqual(item_summary["layer_count"], 3)
        self.assertEqual(item_summary["layer_labels"], ["PET12", "MPET12", "PE40"])
        self.assertEqual(item_summary["printing_summary"], "ROTO F4/B1")
        self.assertTrue(item_summary["pod_enabled"])
        self.assertEqual(item_summary["template_tag"], "TPL Courier Bag Template")
        self.assertEqual(item_summary["packaging_summary"], "25 pcs/pack · POD enabled")
        self.assertEqual(item_summary["unit_weight_g"], 3.7)
        self.assertEqual(item_summary["size"]["label"], "220 x 320 mm")
        self.assertEqual(len(item_summary["layers"]), 3)
        self.assertEqual(item_summary["layers"][0]["thickness_micron"], 12.0)
        self.assertIn("POD", " ".join(item_summary["pod_labels"]))
        self.assertIn("220 x 320", item_summary["search_text"])

        self.assertEqual(qty_summary["ordered_kg"], 24.0)
        self.assertEqual(qty_summary["ordered_pcs"], 6500.0)

        self.assertEqual(fulfillment["produced_pcs"], 2600.0)
        self.assertEqual(fulfillment["dispatched_pcs"], 600.0)
        self.assertEqual(fulfillment["remaining_pcs"], 5900.0)
        self.assertGreater(fulfillment["produced_kg"], 0)
        self.assertGreater(fulfillment["completion_percent"], 0)

    def test_serializer_uses_roll_kg_progress_when_pieces_are_not_relevant(self):
        roll_item = SimpleNamespace(
            sku_variant=SimpleNamespace(code="ROLL-PLAIN", name="Roll Plain"),
            template=SimpleNamespace(name="Roll Template", fg_type="ROLL"),
            geometry_snapshot={"finished_good_type": "ROLL", "roll_form": "FLAT"},
            layer_snapshot=[{"id": "1"}, {"id": "2"}],
            printing_snapshot={"enabled": False},
            addons_snapshot=[],
            packaging_snapshot={"pod": {"enabled": False}},
            total_weight_kg=Decimal("250"),
            qty_uom="KG",
            qty_value=Decimal("250"),
            inventory_rolls=_Manager(
                [
                    SimpleNamespace(weight_kg=Decimal("80"), status="AVAILABLE", meta_json={}),
                    SimpleNamespace(weight_kg=Decimal("40"), status="IN_TRANSIT", meta_json={}),
                ]
            ),
            fg_batches=_Manager([]),
            packing_units=_Manager([]),
        )
        order = SimpleNamespace(items=_Manager([roll_item]))

        serializer = self._serializer()
        qty_summary = serializer.get_qty_summary(order)
        fulfillment = serializer.get_fulfillment_summary(order)

        self.assertEqual(qty_summary["ordered_kg"], 250.0)
        self.assertIsNone(qty_summary["ordered_pcs"])
        self.assertEqual(fulfillment["produced_kg"], 120.0)
        self.assertEqual(fulfillment["dispatched_kg"], 40.0)
        self.assertEqual(fulfillment["remaining_kg"], 210.0)
        self.assertIsNone(fulfillment["produced_pcs"])

    def test_roll_packaging_summary_marks_actual_consumption_capture_for_zero_qty_lines(self):
        roll_item = SimpleNamespace(
            packaging_snapshot={
                "roll_dispatch_pack": {
                    "enabled": True,
                    "lines": [
                        {"material_id": "sheet-1", "qty": 0, "uom": "KG", "basis": "PER_ROLL"},
                    ],
                }
            }
        )

        serializer = self._serializer()
        with patch.object(serializer, "_get_material", return_value=SimpleNamespace(code="WRAP-SHEET")):
            summary = serializer._packaging_summary(roll_item)

        self.assertEqual(summary, "WRAP-SHEET actual at packing")

    def test_serializer_derives_piece_counts_for_kg_entered_pouch_orders(self):
        pouch_item = SimpleNamespace(
            sku_variant=SimpleNamespace(code="POUCH-KG", name="Pouch KG"),
            template=SimpleNamespace(name="Courier Bag Template", fg_type="POUCH"),
            geometry_snapshot={"base": {"width_mm": 200, "height_mm": 300}, "finished_good_type": "POUCH"},
            layer_snapshot=[{"code": "PET12"}, {"code": "PE40"}],
            printing_snapshot={"enabled": False},
            addons_snapshot=[],
            packaging_snapshot={"pod": {"enabled": False}},
            total_weight_kg=Decimal("10"),
            qty_uom="KG",
            qty_value=Decimal("10"),
            unit_weight_g=Decimal("2.5"),
            inventory_rolls=_Manager([]),
            fg_batches=_Manager([]),
            packing_units=_Manager(
                [
                    SimpleNamespace(qty_pcs=0, net_product_weight_kg=Decimal("3"), weight_kg=Decimal("3"), status="DISPATCHED"),
                ]
            ),
        )
        order = SimpleNamespace(items=_Manager([pouch_item]))

        serializer = self._serializer()
        qty_summary = serializer.get_qty_summary(order)
        fulfillment = serializer.get_fulfillment_summary(order)

        self.assertEqual(qty_summary["ordered_kg"], 10.0)
        self.assertEqual(qty_summary["ordered_pcs"], 4000.0)
        self.assertEqual(fulfillment["produced_pcs"], 1200.0)
        self.assertEqual(fulfillment["dispatched_pcs"], 1200.0)
        self.assertEqual(fulfillment["remaining_pcs"], 2800.0)

    def test_line_amount_uses_derived_pieces_when_qty_is_in_kg_but_price_is_per_piece(self):
        item = SalesOrderItem(
            qty_value=Decimal("10"),
            qty_uom="KG",
            price_basis="PCS",
            unit_price=Decimal("2.50"),
            unit_weight_g=Decimal("2.5"),
            total_weight_kg=Decimal("10"),
        )

        self.assertEqual(item.line_amount, Decimal("10000"))

    def test_compact_list_serializer_avoids_heavy_fulfillment_relations(self):
        item = SimpleNamespace(
            sku_variant=SimpleNamespace(code="ROLL-FAST", name="Fast Roll"),
            template=SimpleNamespace(name="Roll Template", fg_type="ROLL"),
            geometry_snapshot={"finished_good_type": "ROLL", "roll_form": "FLAT"},
            layer_snapshot=[{"variant_code": "PET", "thickness_micron": 12, "roll_width_mm": 535}],
            printing_snapshot={"enabled": False},
            addons_snapshot=[],
            packaging_snapshot={"pod": {"enabled": False}},
            total_weight_kg=Decimal("250"),
            qty_uom="KG",
            qty_value=Decimal("250"),
            unit_weight_g=Decimal("0"),
            inventory_rolls=_RaisingManager(),
            fg_batches=_RaisingManager(),
            packing_units=_RaisingManager(),
        )
        order = SimpleNamespace(
            order_number="SO-FAST-001",
            customer_name="Fast Customer",
            status="PACKING_READY",
            items=_Manager([item]),
        )

        serializer = SalesOrderListSerializer()
        item_summary = serializer.get_item_summary(order)
        fulfillment = serializer.get_fulfillment_summary(order)

        self.assertEqual(item_summary["line_count"], 1)
        self.assertEqual(item_summary["layer_labels"], ["L1 · PET · 12u · 535mm"])
        self.assertEqual(fulfillment["produced_kg"], 250.0)
        self.assertEqual(fulfillment["dispatched_kg"], 0.0)
        self.assertTrue(fulfillment["list_estimate"])

    def test_summary_query_uses_compact_serializer_only_for_list_requests(self):
        factory = APIRequestFactory()
        view = SalesOrderViewSet()
        view.action = "list"
        view.request = factory.get("/api/sales/orders/", {"summary": "1"})

        self.assertIs(view.get_serializer_class(), SalesOrderListSerializer)

        view.request = factory.get("/api/sales/orders/")
        self.assertIs(view.get_serializer_class(), SalesOrderSerializer)
