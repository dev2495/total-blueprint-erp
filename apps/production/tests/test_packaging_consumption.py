from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from apps.production.services.dispatch_service import FGDispatchService
from apps.production.services.packing_service import PackingService


class PackagingConsumptionTests(SimpleTestCase):
    def test_packaging_mass_kg_uses_weight_per_piece_for_pcs_stock(self):
        material = SimpleNamespace(
            base_uom="PCS",
            packaging_defaults_json={"weight_kg_per_base_uom": "0.150000"},
        )

        with patch("apps.production.services.packing_service.InventoryMaterial.objects.get", return_value=material), \
             patch("apps.production.services.packing_service.PackagingService._resolve_base_qty", return_value=(Decimal("2"), {})):
            mass = PackingService._packaging_mass_kg("gonny-1", 2, input_uom="PCS")

        self.assertEqual(mass, Decimal("0.300000"))

    def test_packaging_mass_kg_uses_converted_meter_qty(self):
        material = SimpleNamespace(
            base_uom="METER",
            packaging_defaults_json={"weight_kg_per_base_uom": "0.020000"},
        )

        with patch("apps.production.services.packing_service.InventoryMaterial.objects.get", return_value=material), \
             patch("apps.production.services.packing_service.PackagingService._resolve_base_qty", return_value=(Decimal("6.5"), {})):
            mass = PackingService._packaging_mass_kg("tape-1", 2, input_uom="PCS")

        self.assertEqual(mass, Decimal("0.130000"))

    def test_create_gonny_consumes_selected_gonny_material(self):
        batch = SimpleNamespace(
            id="batch-1",
            batch_number="B-1",
            status="AVAILABLE",
            qty_pcs=100,
            packing_units=SimpleNamespace(count=lambda: 0),
            location=SimpleNamespace(id="loc-1"),
            production_job_id=None,
            sales_order_item=None,
            sales_order_item_id=None,
            save=MagicMock(),
        )
        created = SimpleNamespace(id="gonny-1", label_id="G-B-1-001", qty_pcs=20, status="OPEN")

        with patch("apps.production.services.packing_service.FinishedGoodsBatch.objects.select_for_update") as select_for_update, \
             patch("apps.production.services.packing_service.PackagingService.consume_packaging_stock") as consume_stock, \
             patch("apps.production.services.packing_service.PackingUnit.objects.create", return_value=created) as create_unit:
            select_for_update.return_value.get.return_value = batch

            result = PackingService.create_gonny.__wrapped__("batch-1", 20, user=None, gonny_material_id="gonny-mat-1")

        self.assertIs(result, created)
        consume_stock.assert_called_once()
        self.assertEqual(consume_stock.call_args.kwargs["material_id"], "gonny-mat-1")
        self.assertEqual(consume_stock.call_args.kwargs["qty"], 1)
        self.assertEqual(create_unit.call_args.kwargs["qty_pcs"], 20)
        self.assertEqual(create_unit.call_args.kwargs["content_mode"], "LOOSE_POUCHES")
        self.assertEqual(batch.qty_pcs, 80)

    def test_create_gonny_defaults_primary_pack_count_from_sales_snapshot(self):
        batch = SimpleNamespace(
            id="batch-2",
            batch_number="B-2",
            status="AVAILABLE",
            qty_pcs=200,
            packing_units=SimpleNamespace(count=lambda: 0),
            location=SimpleNamespace(id="loc-1"),
            production_job_id=None,
            sales_order_item=SimpleNamespace(
                packaging_snapshot={
                    "primary_inner_pack": {
                        "enabled": True,
                        "material_id": "inner-1",
                        "pcs_per_pack": 50,
                    }
                }
            ),
            sales_order_item_id="so-item-2",
            meta_json={
                "primary_inner_pack": {
                    "enabled": True,
                    "material_id": "inner-1",
                    "pcs_per_pack": 50,
                    "pack_count": 4,
                    "consumed_at_fg": True,
                }
            },
            save=MagicMock(),
        )
        created = SimpleNamespace(id="gonny-2", label_id="G-B-2-001", qty_pcs=125, status="OPEN")

        with patch("apps.production.services.packing_service.FinishedGoodsBatch.objects.select_for_update") as select_for_update, \
             patch("apps.production.services.packing_service.PackagingService.consume_packaging_stock"), \
             patch("apps.production.services.packing_service.PackingUnit.objects.create", return_value=created) as create_unit:
            select_for_update.return_value.get.return_value = batch

            PackingService.create_gonny.__wrapped__(
                "batch-2",
                125,
                user=None,
                gonny_material_id="gonny-mat-2",
            )

        self.assertEqual(create_unit.call_args.kwargs["content_mode"], "PRIMARY_PACKS")
        self.assertEqual(create_unit.call_args.kwargs["primary_pack_count"], 3)

    def test_create_gonny_persists_weight_breakdown_for_primary_packs(self):
        batch = SimpleNamespace(
            id="batch-2",
            batch_number="B-2",
            status="AVAILABLE",
            qty_pcs=200,
            packing_units=SimpleNamespace(count=lambda: 0),
            location=SimpleNamespace(id="loc-1"),
            production_job_id=None,
            sales_order_item=SimpleNamespace(
                packaging_snapshot={
                    "primary_inner_pack": {
                        "enabled": True,
                        "material_id": "inner-1",
                        "pcs_per_pack": 50,
                    }
                }
            ),
            sales_order_item_id="so-item-2",
            meta_json={
                "primary_inner_pack": {
                    "enabled": True,
                    "material_id": "inner-1",
                    "pcs_per_pack": 50,
                    "pack_count": 4,
                    "consumed_at_fg": True,
                }
            },
            save=MagicMock(),
        )
        created = SimpleNamespace(id="gonny-2", label_id="G-B-2-001", qty_pcs=125, status="OPEN")

        with patch("apps.production.services.packing_service.FinishedGoodsBatch.objects.select_for_update") as select_for_update, \
             patch("apps.production.services.packing_service.PackingService._net_product_weight_kg", return_value=Decimal("18.5000")), \
             patch("apps.production.services.packing_service.PackingService._packaging_mass_kg", side_effect=[Decimal("1.2500"), Decimal("0.7500")]), \
             patch("apps.production.services.packing_service.PackagingService.consume_packaging_stock"), \
             patch("apps.production.services.packing_service.PackingUnit.objects.create", return_value=created) as create_unit:
            select_for_update.return_value.get.return_value = batch

            PackingService.create_gonny.__wrapped__(
                "batch-2",
                125,
                user=None,
                gonny_material_id="gonny-mat-2",
            )

        payload = create_unit.call_args.kwargs
        self.assertEqual(payload["content_mode"], "PRIMARY_PACKS")
        self.assertEqual(payload["primary_pack_count"], 3)
        self.assertEqual(payload["net_product_weight_kg"], Decimal("18.5000"))
        self.assertEqual(payload["inner_pack_tare_kg"], Decimal("1.2500"))
        self.assertEqual(payload["secondary_pack_tare_kg"], Decimal("0.7500"))
        self.assertIsNone(payload["gross_weight_kg"])
        self.assertEqual(payload["expected_gross_weight_kg"], Decimal("20.5000"))
        self.assertEqual(payload["tare_breakdown_json"]["expected_gross_weight_kg"], 20.5)
        self.assertEqual(payload["tare_breakdown_json"]["primary_pack_count"], 3)
        self.assertEqual(payload["meta_json"]["weight_breakdown"]["net_product_weight_kg"], 18.5)

    def test_create_gonny_does_not_double_consume_prepacked_inner_packs(self):
        batch = SimpleNamespace(
            id="batch-3",
            batch_number="B-3",
            status="AVAILABLE",
            qty_pcs=240,
            packing_units=SimpleNamespace(
                count=lambda: 0,
                filter=lambda **kwargs: [SimpleNamespace(primary_pack_count=1)],
            ),
            location=SimpleNamespace(id="loc-1"),
            production_job_id=None,
            sales_order_item=SimpleNamespace(
                packaging_snapshot={
                    "primary_inner_pack": {
                        "enabled": True,
                        "material_id": "inner-1",
                        "pcs_per_pack": 100,
                    }
                }
            ),
            sales_order_item_id="so-item-3",
            meta_json={
                "primary_inner_pack": {
                    "enabled": True,
                    "material_id": "inner-1",
                    "pcs_per_pack": 100,
                    "pack_count": 3,
                    "consumed_at_fg": True,
                }
            },
            save=MagicMock(),
        )
        created = SimpleNamespace(id="gonny-3", label_id="G-B-3-001", qty_pcs=100, status="OPEN")

        with patch("apps.production.services.packing_service.FinishedGoodsBatch.objects.select_for_update") as select_for_update, \
             patch("apps.production.services.packing_service.PackingService._net_product_weight_kg", return_value=Decimal("12.0000")), \
             patch("apps.production.services.packing_service.PackingService._packaging_mass_kg", side_effect=[Decimal("0.8000"), Decimal("0.3000")]), \
             patch("apps.production.services.packing_service.PackagingService.consume_packaging_stock") as consume_stock, \
             patch("apps.production.services.packing_service.PackingUnit.objects.create", return_value=created) as create_unit:
            select_for_update.return_value.get.return_value = batch

            PackingService.create_gonny.__wrapped__(
                "batch-3",
                100,
                user=None,
                gonny_material_id="gonny-mat-3",
                content_mode="PRIMARY_PACKS",
            )

        self.assertEqual(consume_stock.call_count, 1)
        self.assertEqual(consume_stock.call_args.kwargs["material_id"], "gonny-mat-3")
        self.assertTrue(create_unit.call_args.kwargs["meta_json"]["primary_packs_prepacked"])

    def test_seal_gonny_consumes_submitted_extras_before_legacy_snapshot(self):
        gonny = SimpleNamespace(
            id="gonny-1",
            label_id="G-1",
            status="OPEN",
            location_id="loc-1",
            fg_batch_id="batch-1",
            fg_batch=SimpleNamespace(production_job_id=None),
            sales_order_item_id="so-item-1",
            sales_order_item=SimpleNamespace(
                packaging_snapshot={
                    "secondary_gonny": {
                        "enabled": True,
                        "extras": [{"material_id": "legacy-extra", "qty": 9, "uom": "PCS", "basis": "PER_GONNY"}],
                    }
                }
            ),
            content_mode="LOOSE_POUCHES",
            primary_pack_count=None,
            save=MagicMock(),
        )

        with patch("apps.production.services.packing_service.PackingUnit.objects.select_for_update") as select_for_update, \
             patch("apps.production.services.packing_service.PackagingService.consume_packaging_stock") as consume_stock:
            select_for_update.return_value.get.return_value = gonny

            PackingService.seal_gonny.__wrapped__(
                "gonny-1",
                Decimal("5.5"),
                user=None,
                extras=[{"material_id": "tape-1", "qty": 2, "uom": "PCS", "basis": "PER_GONNY"}],
            )

        consume_stock.assert_called_once()
        self.assertEqual(consume_stock.call_args.kwargs["material_id"], "tape-1")
        self.assertEqual(consume_stock.call_args.kwargs["basis"], "PER_GONNY")
        self.assertEqual(gonny.meta_json["seal_extras"][0]["material_id"], "tape-1")

    def test_seal_gonny_updates_extras_tare_and_gross_breakdown(self):
        gonny = SimpleNamespace(
            id="gonny-2",
            label_id="G-2",
            status="OPEN",
            location_id="loc-1",
            fg_batch_id="batch-1",
            fg_batch=SimpleNamespace(production_job_id=None),
            sales_order_item_id="so-item-1",
            sales_order_item=SimpleNamespace(packaging_snapshot={}),
            content_mode="PRIMARY_PACKS",
            primary_pack_count=4,
            net_product_weight_kg=Decimal("10.0000"),
            inner_pack_tare_kg=Decimal("0.4000"),
            secondary_pack_tare_kg=Decimal("0.2000"),
            meta_json={},
            save=MagicMock(),
        )

        with patch("apps.production.services.packing_service.PackingUnit.objects.select_for_update") as select_for_update, \
             patch("apps.production.services.packing_service.PackagingService.consume_packaging_stock") as consume_stock, \
             patch("apps.production.services.packing_service.PackingService._packaging_mass_kg", return_value=Decimal("0.1500")):
            select_for_update.return_value.get.return_value = gonny

            PackingService.seal_gonny.__wrapped__(
                "gonny-2",
                Decimal("10.9000"),
                user=None,
                extras=[{"material_id": "tape-1", "qty": 2, "uom": "PCS", "basis": "PER_GONNY"}],
            )

        consume_stock.assert_called_once()
        self.assertEqual(gonny.extras_tare_kg, Decimal("0.1500"))
        self.assertEqual(gonny.gross_weight_kg, Decimal("10.9000"))
        self.assertEqual(gonny.tare_breakdown_json["gross_weight_kg"], 10.9)
        self.assertEqual(gonny.tare_breakdown_json["content_mode"], "PRIMARY_PACKS")
        self.assertEqual(gonny.meta_json["seal_extras"][0]["material_id"], "tape-1")
        self.assertEqual(gonny.meta_json["weight_breakdown"]["extras_tare_kg"], 0.15)

    def test_seal_gonny_requires_reason_when_variance_exceeds_two_percent(self):
        gonny = SimpleNamespace(
            id="gonny-variance",
            label_id="G-VAR",
            status="OPEN",
            location_id="loc-1",
            fg_batch_id="batch-1",
            fg_batch=SimpleNamespace(production_job_id=None),
            sales_order_item_id="so-item-1",
            sales_order_item=SimpleNamespace(packaging_snapshot={}),
            content_mode="LOOSE_POUCHES",
            primary_pack_count=None,
            net_product_weight_kg=Decimal("10.0000"),
            inner_pack_tare_kg=Decimal("0.0000"),
            secondary_pack_tare_kg=Decimal("0.0000"),
            meta_json={},
            save=MagicMock(),
        )

        with patch("apps.production.services.packing_service.PackingUnit.objects.select_for_update") as select_for_update, \
             patch("apps.production.services.packing_service.PackagingService.consume_packaging_stock"):
            select_for_update.return_value.get.return_value = gonny

            with self.assertRaisesMessage(ValueError, "Variance reason is required"):
                PackingService.seal_gonny.__wrapped__(
                    "gonny-variance",
                    Decimal("10.3000"),
                    user=None,
                    extras=[],
                )

    def test_seal_gonny_records_variance_when_reason_supplied(self):
        gonny = SimpleNamespace(
            id="gonny-variance-ok",
            label_id="G-VAR-OK",
            status="OPEN",
            location_id="loc-1",
            fg_batch_id="batch-1",
            fg_batch=SimpleNamespace(production_job_id=None),
            sales_order_item_id="so-item-1",
            sales_order_item=SimpleNamespace(packaging_snapshot={}),
            content_mode="LOOSE_POUCHES",
            primary_pack_count=None,
            net_product_weight_kg=Decimal("10.0000"),
            inner_pack_tare_kg=Decimal("0.0000"),
            secondary_pack_tare_kg=Decimal("0.0000"),
            meta_json={},
            save=MagicMock(),
        )

        with patch("apps.production.services.packing_service.PackingUnit.objects.select_for_update") as select_for_update, \
             patch("apps.production.services.packing_service.PackagingService.consume_packaging_stock"):
            select_for_update.return_value.get.return_value = gonny

            PackingService.seal_gonny.__wrapped__(
                "gonny-variance-ok",
                Decimal("10.3000"),
                user=None,
                extras=[],
                variance_reason="Scale reading accepted after supervisor check",
            )

        self.assertEqual(gonny.expected_gross_weight_kg, Decimal("10.0000"))
        self.assertEqual(gonny.gross_weight_kg, Decimal("10.3000"))
        self.assertEqual(gonny.gross_variance_kg, Decimal("0.3000"))
        self.assertEqual(gonny.gross_variance_reason, "Scale reading accepted after supervisor check")

    def test_release_gonny_rejects_missing_actual_gross_weight(self):
        gonny = SimpleNamespace(
            id="gonny-no-weight",
            label_id="G-NO-WEIGHT",
            status="SEALED",
            gross_weight_kg=None,
            meta_json={},
            sales_order_item=None,
            save=MagicMock(),
        )

        with patch("apps.production.services.dispatch_service.PackingUnit.objects.select_related") as select_related:
            select_related.return_value.get.return_value = gonny

            with self.assertRaisesMessage(ValueError, "no actual sealed gross weight"):
                FGDispatchService.release_gonny_to_dispatch.__wrapped__("gonny-no-weight", user=None)

    def test_pack_roll_persists_explicit_lines_as_consumed_lines(self):
        roll = SimpleNamespace(
            id="roll-1",
            label_id="ROLL-1",
            sales_order_item_id="so-item-1",
            sales_order_item=SimpleNamespace(
                packaging_snapshot={
                    "roll_dispatch_pack": {
                        "enabled": True,
                        "lines": [
                            {"material_id": "sheet-1", "qty": 0, "uom": "PCS", "basis": "PER_ROLL"},
                            {"material_id": "tape-1", "qty": 0, "uom": "PCS", "basis": "PER_ROLL"},
                        ],
                    }
                },
                sales_order=SimpleNamespace(order_number="SO-1"),
            ),
            location_id="loc-1",
        )

        def build_record(**kwargs):
            return SimpleNamespace(**kwargs)

        with patch("apps.production.services.dispatch_service.InventoryRoll.objects.select_related") as select_related, \
             patch("apps.production.services.dispatch_service.RollDispatchPackRecord.objects.filter") as existing_filter, \
             patch("apps.production.services.dispatch_service.RollDispatchPackRecord.objects.create", side_effect=build_record), \
             patch("apps.inventory.services.packaging_service.PackagingService.consume_packaging_stock") as consume_stock:
            select_related.return_value.get.return_value = roll
            existing_filter.return_value.first.return_value = None
            consume_stock.side_effect = [SimpleNamespace(id="tx-1"), SimpleNamespace(id="tx-2")]

            record = FGDispatchService.pack_roll.__wrapped__(
                "roll-1",
                [
                    {"material_id": "sheet-1", "qty": 1, "uom": "PCS", "basis": "PER_ROLL"},
                    {"material_id": "tape-1", "qty": 2, "uom": "PCS", "basis": "PER_ROLL"},
                ],
                user=None,
            )

        self.assertEqual(len(record.lines), 2)
        self.assertEqual(record.lines[0]["material_id"], "sheet-1")
        self.assertEqual(record.lines[1]["material_id"], "tape-1")
        self.assertFalse(record.meta_json["defaulted_from_snapshot"])
