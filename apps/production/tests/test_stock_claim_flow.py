from contextlib import nullcontext
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from apps.production.views_planner import PlannerViewSet


class StockClaimFlowTests(SimpleTestCase):
    @patch("apps.production.views_planner.Process.objects.filter")
    @patch("apps.production.views_planner.InventoryMaterial.objects.filter")
    def test_sales_required_start_step_uses_first_roll_input_for_purchased_layers(self, material_filter, process_filter):
        template = SimpleNamespace(routing_rule=SimpleNamespace(ordered_processes=["EXTRUDE", "LAMINATION", "POUCH"]))
        process_filter.return_value.only.return_value = [
            SimpleNamespace(code="EXTRUDE", input_form="BULK"),
            SimpleNamespace(code="LAMINATION", input_form="ROLL"),
            SimpleNamespace(code="POUCH", input_form="ROLL"),
        ]
        material_filter.return_value.values.return_value = [
            {"id": "film-1", "is_extrudable": False},
            {"id": "film-2", "is_extrudable": False},
        ]

        required_start = PlannerViewSet()._sales_required_start_step(
            template,
            [
                {"variant_id": "film-1"},
                {"variant_id": "film-2"},
            ],
        )

        self.assertEqual(required_start, 1)

    @patch("apps.production.views_planner.Process.objects.filter")
    @patch("apps.production.views_planner.InventoryMaterial.objects.filter")
    def test_sales_required_start_step_stays_raw_for_extrudable_layers(self, material_filter, process_filter):
        template = SimpleNamespace(routing_rule=SimpleNamespace(ordered_processes=["EXTRUDE", "LAMINATION", "POUCH"]))
        process_filter.return_value.only.return_value = [
            SimpleNamespace(code="EXTRUDE", input_form="BULK"),
            SimpleNamespace(code="LAMINATION", input_form="ROLL"),
            SimpleNamespace(code="POUCH", input_form="ROLL"),
        ]
        material_filter.return_value.values.return_value = [
            {"id": "film-1", "is_extrudable": True},
        ]

        required_start = PlannerViewSet()._sales_required_start_step(
            template,
            [
                {"variant_id": "film-1"},
            ],
        )

        self.assertEqual(required_start, 0)

    @patch.object(PlannerViewSet, "_route_step_accepts_roll_input", return_value=True)
    @patch("apps.production.views_planner.InventoryMaterial.objects.filter")
    def test_purchasable_roll_input_suppresses_missing_extrusion_recipe_blocker(self, material_filter, _roll_input):
        material_filter.return_value.values.return_value = [
            {"id": "pp-variant", "is_purchasable": True},
        ]

        payload = PlannerViewSet()._effective_bom_readiness_payload(
            {"errors": ["No recipe for PP (pp-variant, 40.0μ)"], "films": [{"code": "PP"}]},
            template=SimpleNamespace(routing_rule=SimpleNamespace(ordered_processes=["LAMINATION", "SLITTING", "POUCH"])),
            layer_snapshot=[{"variant_id": "pp-variant", "source_mode": "EXTRUDE"}],
            required_start_step=0,
        )

        self.assertTrue(payload["bom_ready"])
        self.assertEqual(payload["bom_readiness_errors"], [])

    @patch("apps.production.views_planner.Process.objects.filter")
    @patch("apps.production.views_planner.InventoryMaterial.objects.filter")
    def test_non_extrusion_start_suppresses_purchased_film_recipe_blocker_even_with_stale_input_form(self, material_filter, process_filter):
        material_filter.return_value.values.return_value = [
            {"id": "pp-variant", "is_purchasable": True},
        ]
        process_filter.return_value.only.return_value.first.return_value = SimpleNamespace(
            code="LAMINATION",
            name="Lamination",
            input_form="BULK",
        )

        payload = PlannerViewSet()._effective_bom_readiness_payload(
            {"errors": ["No recipe for PP (pp-variant, 40.0μ)"], "films": [{"code": "PP"}]},
            template=SimpleNamespace(routing_rule=SimpleNamespace(ordered_processes=["LAMINATION", "SLITTING", "POUCH"])),
            layer_snapshot=[{"variant_id": "pp-variant", "source_mode": "EXTRUDE"}],
            required_start_step=0,
        )

        self.assertTrue(payload["bom_ready"])
        self.assertEqual(payload["bom_readiness_errors"], [])

    @patch("apps.production.views_planner.Process.objects.filter")
    @patch("apps.production.views_planner.InventoryMaterial.objects.filter")
    def test_purchased_roll_route_suppresses_missing_recipe_error_by_grade_id(self, material_filter, process_filter):
        material_filter.return_value.values.return_value = [
            {"id": "pp-variant", "is_purchasable": True},
        ]
        process_filter.return_value.only.return_value.first.return_value = SimpleNamespace(
            code="Lam",
            name="Lamination",
            input_form="ROLL",
        )

        payload = PlannerViewSet()._effective_bom_readiness_payload(
            {"errors": ["No recipe for PP (pp-grade, 40.0μ)"], "films": [{"code": "PP"}]},
            template=SimpleNamespace(routing_rule=SimpleNamespace(ordered_processes=["Lam", "Slt", "Pouch"])),
            layer_snapshot=[
                {"variant_id": "pet-variant", "grade_id": None, "source_mode": "PURCHASE"},
                {"variant_id": "pp-variant", "grade_id": "pp-grade", "source_mode": "EXTRUDE"},
            ],
            required_start_step=0,
        )

        self.assertTrue(payload["bom_ready"])
        self.assertEqual(payload["bom_readiness_errors"], [])

    @patch.object(PlannerViewSet, "_route_step_accepts_roll_input", return_value=False)
    @patch("apps.production.views_planner.InventoryMaterial.objects.filter")
    def test_bulk_start_keeps_missing_extrusion_recipe_blocker(self, material_filter, _bulk_input):
        material_filter.return_value.values.return_value = [
            {"id": "pp-variant", "is_purchasable": True},
        ]

        payload = PlannerViewSet()._effective_bom_readiness_payload(
            {"errors": ["No recipe for PP (pp-variant, 40.0μ)"], "films": [{"code": "PP"}]},
            template=SimpleNamespace(routing_rule=SimpleNamespace(ordered_processes=["EXTRUSION", "LAMINATION"])),
            layer_snapshot=[{"variant_id": "pp-variant", "source_mode": "EXTRUDE"}],
            required_start_step=0,
        )

        self.assertFalse(payload["bom_ready"])
        self.assertIn("No recipe for PP", payload["bom_readiness_errors"][0])

    @patch.object(PlannerViewSet, "_route_step_accepts_roll_input", return_value=True)
    @patch("apps.production.views_planner.InventoryMaterial.objects.filter")
    def test_roll_input_purchase_layer_snapshot_marks_purchasable_variants_purchase(self, material_filter, _roll_input):
        material_filter.return_value.values.return_value = [
            {"id": "pp-variant", "is_purchasable": True},
            {"id": "pet-variant", "is_purchasable": False},
        ]

        layers = PlannerViewSet()._roll_input_purchase_layer_snapshot(
            SimpleNamespace(routing_rule=SimpleNamespace(ordered_processes=["LAMINATION", "POUCH"])),
            [
                {"variant_id": "pp-variant", "source_mode": "EXTRUDE"},
                {"variant_id": "pet-variant", "source_mode": "EXTRUDE"},
            ],
            0,
        )

        self.assertEqual(layers[0]["source_mode"], "PURCHASE")
        self.assertEqual(layers[1]["source_mode"], "EXTRUDE")

    def test_source_availability_counts_fg_and_wip_matches(self):
        row = {
            "required_start_step": 2,
            "inventory_options": [
                {"is_final_step": True, "completed_step_index": 3},
                {"is_final_step": False, "completed_step_index": 2},
                {"is_final_step": False, "completed_step_index": 1},
            ],
        }

        availability = PlannerViewSet()._source_availability(row)

        self.assertEqual(availability["fg_match_count"], 1)
        self.assertEqual(availability["wip_match_count"], 1)
        self.assertTrue(availability["has_fg"])
        self.assertTrue(availability["has_wip"])

    def test_matching_stock_orders_requires_stopped_wip_width_at_or_above_sales_width(self):
        template = SimpleNamespace(routing_rule=SimpleNamespace(ordered_processes=["LAMINATION", "SLITTING", "POUCH"]))
        sales_item = SimpleNamespace(
            planned_parent_width_mm=Decimal("500"),
            layer_snapshot=[{"material_code": "PET", "thickness_micron": 12}],
        )
        wide_stock = SimpleNamespace(
            id="wide",
            order_number="STK-WIDE",
            status="STOCK_READY",
            start_step_index=0,
            stop_step_index=1,
            stock_strategy="INTERMEDIATE_POOL",
            stock_purpose="PRODUCT",
            target_qty=Decimal("100"),
            produced_qty=Decimal("0"),
            planner_origin_meta={"wip_roll_width_mm": 600},
            geometry_snapshot={"wip_roll_width_mm": 600},
            geometry_override={},
            layer_snapshot=[{"material_code": "PET", "thickness_micron": 12, "roll_width_mm": 600}],
            printing_snapshot={},
            addons_snapshot=[],
            invariant_signature="inv",
            spec_signature="",
        )
        narrow_stock = SimpleNamespace(
            id="narrow",
            order_number="STK-NARROW",
            status="STOCK_READY",
            start_step_index=0,
            stop_step_index=1,
            stock_strategy="INTERMEDIATE_POOL",
            stock_purpose="PRODUCT",
            target_qty=Decimal("100"),
            produced_qty=Decimal("0"),
            planner_origin_meta={"wip_roll_width_mm": 430},
            geometry_snapshot={"wip_roll_width_mm": 430},
            geometry_override={},
            layer_snapshot=[{"material_code": "PET", "thickness_micron": 12, "roll_width_mm": 430}],
            printing_snapshot={},
            addons_snapshot=[],
            invariant_signature="inv",
            spec_signature="",
        )
        view = PlannerViewSet()
        order_invariant = view._layer_only_invariant_signature(sales_item.layer_snapshot)
        wide_stock.invariant_signature = ""
        narrow_stock.invariant_signature = ""

        stock_qs = MagicMock()
        stock_qs.order_by.return_value = [wide_stock, narrow_stock]
        allocation_qs = MagicMock()
        allocation_qs.aggregate.return_value = {"total": Decimal("0")}

        with patch("apps.production.views_planner.PlannedStockOrder.objects.filter", return_value=stock_qs), \
             patch("apps.production.views_planner.InventoryAllocation.objects.filter", return_value=allocation_qs), \
             patch.object(PlannerViewSet, "_route_last_index", return_value=2), \
             patch.object(PlannerViewSet, "_stopped_stock_order_allocatable_roll_qty", return_value=Decimal("100")):
            matches = view._matching_stock_orders_for_sales(
                template,
                order_signature="",
                order_invariant_signature=order_invariant,
                required_start_step=1,
                sales_item=sales_item,
            )

        self.assertEqual([row["order_number"] for row in matches], ["STK-WIDE"])
        self.assertEqual(matches[0]["width_match_mode"], "WIDER_SLITTABLE")
        self.assertEqual(matches[0]["required_width_mm"], 500.0)
        self.assertEqual(matches[0]["stock_width_mm"], 600.0)

    def test_one_step_roll_inventory_options_require_exact_final_spec(self):
        template = SimpleNamespace(id="template-1", routing_rule_id="route-1")
        material = SimpleNamespace(parent_family_id="family-1")
        exact_roll = SimpleNamespace(
            id="roll-exact",
            label_id="ROLL-EXACT",
            template=template,
            template_id="template-1",
            material_id="mat-1",
            material=material,
            completed_step_index=0,
            width_mm=Decimal("640"),
            weight_kg=Decimal("120"),
            sales_order_item=None,
        )
        wrong_spec_roll = SimpleNamespace(
            id="roll-wrong",
            label_id="ROLL-WRONG",
            template=template,
            template_id="template-1",
            material_id="mat-1",
            material=material,
            completed_step_index=0,
            width_mm=Decimal("660"),
            weight_kg=Decimal("58"),
            sales_order_item=None,
        )
        sales_item = SimpleNamespace(
            planned_parent_width_mm=Decimal("640"),
            layer_snapshot=[{"variant_id": "mat-1", "thickness_micron": 65}],
        )

        roll_qs = MagicMock()
        roll_qs.select_related.return_value = roll_qs
        roll_qs.order_by.return_value = [wrong_spec_roll, exact_roll]
        batch_qs = MagicMock()
        batch_qs.select_related.return_value = batch_qs
        batch_qs.order_by.return_value = []

        def signature_for(roll):
            return "spec-required" if roll.id == "roll-exact" else "spec-wrong"

        with patch("apps.production.views_planner.InventoryRoll.objects.filter", return_value=roll_qs), \
             patch("apps.production.views_planner.FinishedGoodsBatch.objects.filter", return_value=batch_qs), \
             patch("apps.production.views_planner.build_roll_naming_payload", return_value={
                 "variant_display_name": "LD NATURAL - ML",
                 "family_display_name": "LD NATURAL - ML",
                 "size_line": "640 mm x 65 micron",
                 "process_state_label": "Final stock",
             }), \
             patch("apps.production.views_planner.resolve_roll_role", return_value="OUTPUT"), \
             patch.object(PlannerViewSet, "_sales_item_roll_width_mm", return_value=Decimal("640")), \
             patch.object(PlannerViewSet, "_route_step_label", return_value="Extrusion"), \
             patch.object(PlannerViewSet, "_roll_signature", side_effect=signature_for), \
             patch.object(PlannerViewSet, "_roll_invariant_signature", return_value="inv-required"), \
             patch.object(PlannerViewSet, "_stock_commitment_matches_sales_item", return_value=True), \
             patch.object(PlannerViewSet, "_planner_stock_class_for_roll", return_value="PRODUCT_ROLL"), \
             patch.object(PlannerViewSet, "_origin_stock_order_for_roll", return_value=None):
            options = PlannerViewSet()._eligible_inventory_for_order(
                "sales",
                sales_item,
                template,
                order_signature="spec-required",
                order_invariant_signature="inv-required",
                required_start_step=0,
                route_last_index=0,
                roll_alloc_map={},
                fg_alloc_map={},
                order_layer_snapshot=sales_item.layer_snapshot,
                sales_item=sales_item,
            )

        self.assertEqual([row["inventory_id"] for row in options], ["roll-exact"])
        self.assertEqual(options[0]["source_bucket"], "FINISHED_STOCK")
        self.assertEqual(options[0]["signature_match_mode"], "FINAL_SPEC")
        self.assertEqual(options[0]["width_match_mode"], "EXACT_WIDTH")

    def test_step0_bulk_route_suppresses_raw_roll_input_options(self):
        template = SimpleNamespace(id="template-1", routing_rule_id="route-1")
        raw_roll = SimpleNamespace(
            id="roll-raw",
            label_id="ROLL-RAW",
            template=template,
            template_id="template-1",
            material_id="mat-1",
            material=SimpleNamespace(parent_family_id="family-1"),
            completed_step_index=0,
            width_mm=Decimal("640"),
            weight_kg=Decimal("120"),
            sales_order_item=None,
        )
        sales_item = SimpleNamespace(
            planned_parent_width_mm=Decimal("640"),
            layer_snapshot=[{"variant_id": "mat-1", "thickness_micron": 65}],
        )
        roll_qs = MagicMock()
        roll_qs.select_related.return_value = roll_qs
        roll_qs.order_by.return_value = [raw_roll]
        batch_qs = MagicMock()
        batch_qs.select_related.return_value = batch_qs
        batch_qs.order_by.return_value = []

        with patch("apps.production.views_planner.InventoryRoll.objects.filter", return_value=roll_qs), \
             patch("apps.production.views_planner.FinishedGoodsBatch.objects.filter", return_value=batch_qs), \
             patch.object(PlannerViewSet, "_route_step_accepts_roll_input", return_value=False), \
             patch.object(PlannerViewSet, "_sales_item_roll_width_mm", return_value=Decimal("640")), \
             patch.object(PlannerViewSet, "_roll_signature", return_value="spec-raw"), \
             patch.object(PlannerViewSet, "_roll_invariant_signature", return_value="inv-raw"):
            options = PlannerViewSet()._eligible_inventory_for_order(
                "sales",
                sales_item,
                template,
                order_signature="spec-required",
                order_invariant_signature="inv-required",
                required_start_step=0,
                route_last_index=2,
                roll_alloc_map={},
                fg_alloc_map={},
                order_layer_snapshot=sales_item.layer_snapshot,
                sales_item=sales_item,
            )

        self.assertEqual(options, [])

    def test_step0_bulk_route_keeps_same_lineage_wip_as_carry_forward(self):
        template = SimpleNamespace(id="template-1", routing_rule_id="route-1")
        wip_roll = SimpleNamespace(
            id="roll-wip",
            label_id="ROLL-WIP",
            template=template,
            template_id="template-1",
            material_id="mat-1",
            material=SimpleNamespace(parent_family_id="family-1"),
            completed_step_index=0,
            width_mm=Decimal("640"),
            weight_kg=Decimal("120"),
            sales_order_item=None,
        )
        sales_item = SimpleNamespace(
            planned_parent_width_mm=Decimal("640"),
            layer_snapshot=[{"variant_id": "mat-1", "material_code": "LD", "thickness_micron": 65}],
        )
        roll_qs = MagicMock()
        roll_qs.select_related.return_value = roll_qs
        roll_qs.order_by.return_value = [wip_roll]
        batch_qs = MagicMock()
        batch_qs.select_related.return_value = batch_qs
        batch_qs.order_by.return_value = []

        with patch("apps.production.views_planner.InventoryRoll.objects.filter", return_value=roll_qs), \
             patch("apps.production.views_planner.FinishedGoodsBatch.objects.filter", return_value=batch_qs), \
             patch("apps.production.views_planner.build_roll_naming_payload", return_value={
                 "variant_display_name": "LD WIP",
                 "family_display_name": "LD WIP",
                 "size_line": "640 mm x 65 micron",
                 "process_state_label": "Extrusion WIP",
             }), \
             patch("apps.production.views_planner.resolve_roll_role", return_value="OUTPUT"), \
             patch.object(PlannerViewSet, "_route_step_accepts_roll_input", return_value=False), \
             patch.object(PlannerViewSet, "_route_step_label", return_value="Extrusion"), \
             patch.object(PlannerViewSet, "_sales_item_roll_width_mm", return_value=Decimal("640")), \
             patch.object(PlannerViewSet, "_is_same_order_lineage_roll", return_value=True), \
             patch.object(PlannerViewSet, "_origin_stock_order_for_roll", return_value=None), \
             patch.object(PlannerViewSet, "_planner_stock_class_for_roll", return_value="EXTRUDED_BASE_ROLL"), \
             patch.object(PlannerViewSet, "_roll_signature", return_value="spec-wip"), \
             patch.object(PlannerViewSet, "_roll_invariant_signature", return_value="inv-wip"):
            options = PlannerViewSet()._eligible_inventory_for_order(
                "sales",
                sales_item,
                template,
                order_signature="spec-required",
                order_invariant_signature="inv-required",
                required_start_step=0,
                route_last_index=2,
                roll_alloc_map={},
                fg_alloc_map={},
                order_layer_snapshot=sales_item.layer_snapshot,
                sales_item=sales_item,
            )

        self.assertEqual(len(options), 1)
        self.assertEqual(options[0]["source_bucket"], "CARRY_FORWARD_WIP")
        self.assertEqual(options[0]["signature_match_mode"], "SEMI_INVARIANT")

    def test_step0_bulk_route_keeps_matching_extruded_stock_as_shared_wip(self):
        template = SimpleNamespace(id="template-1", routing_rule_id="route-1")
        layer_snapshot = [{"variant_id": "mat-1", "material_code": "LD", "thickness_micron": 65}]
        wip_roll = SimpleNamespace(
            id="roll-stock-wip",
            label_id="ROLL-STOCK-WIP",
            template=template,
            template_id="template-1",
            material_id="mat-1",
            material=SimpleNamespace(parent_family_id="family-1"),
            completed_step_index=0,
            width_mm=Decimal("640"),
            weight_kg=Decimal("120"),
            sales_order_item=None,
        )
        source_stock_order = SimpleNamespace(layer_snapshot=layer_snapshot)
        sales_item = SimpleNamespace(
            planned_parent_width_mm=Decimal("640"),
            layer_snapshot=layer_snapshot,
        )
        roll_qs = MagicMock()
        roll_qs.select_related.return_value = roll_qs
        roll_qs.order_by.return_value = [wip_roll]
        batch_qs = MagicMock()
        batch_qs.select_related.return_value = batch_qs
        batch_qs.order_by.return_value = []

        with patch("apps.production.views_planner.InventoryRoll.objects.filter", return_value=roll_qs), \
             patch("apps.production.views_planner.FinishedGoodsBatch.objects.filter", return_value=batch_qs), \
             patch("apps.production.views_planner.build_roll_naming_payload", return_value={
                 "variant_display_name": "LD STOCK WIP",
                 "family_display_name": "LD STOCK WIP",
                 "size_line": "640 mm x 65 micron",
                 "process_state_label": "Extruded base",
             }), \
             patch("apps.production.views_planner.resolve_roll_role", return_value="OUTPUT"), \
             patch.object(PlannerViewSet, "_route_step_accepts_roll_input", return_value=False), \
             patch.object(PlannerViewSet, "_route_step_label", return_value="Extrusion"), \
             patch.object(PlannerViewSet, "_sales_item_roll_width_mm", return_value=Decimal("640")), \
             patch.object(PlannerViewSet, "_is_same_order_lineage_roll", return_value=False), \
             patch.object(PlannerViewSet, "_origin_stock_order_for_roll", return_value=source_stock_order), \
             patch.object(PlannerViewSet, "_stock_commitment_matches_sales_item", return_value=True), \
             patch.object(PlannerViewSet, "_planner_stock_class_for_roll", return_value="EXTRUDED_BASE_ROLL"), \
             patch.object(PlannerViewSet, "_roll_signature", return_value="spec-wip"), \
             patch.object(PlannerViewSet, "_roll_invariant_signature", return_value="inv-wip"):
            options = PlannerViewSet()._eligible_inventory_for_order(
                "sales",
                sales_item,
                template,
                order_signature="spec-required",
                order_invariant_signature="inv-required",
                required_start_step=0,
                route_last_index=2,
                roll_alloc_map={},
                fg_alloc_map={},
                order_layer_snapshot=sales_item.layer_snapshot,
                sales_item=sales_item,
            )

        self.assertEqual(len(options), 1)
        self.assertEqual(options[0]["source_bucket"], "SHARED_INVARIANT_ROLL_STOCK")
        self.assertEqual(options[0]["signature_match_mode"], "PRE_ARTWORK_INVARIANT")

    def test_stage0_wip_buckets_resume_at_next_step(self):
        viewset = PlannerViewSet()
        roll_qs = MagicMock()
        roll_qs.only.return_value.first.return_value = SimpleNamespace(completed_step_index=0)

        with patch("apps.production.views_planner.InventoryRoll.objects.filter", return_value=roll_qs):
            for source_bucket in ("CARRY_FORWARD_WIP", "SHARED_INVARIANT_ROLL_STOCK"):
                validation_step, job_start = viewset._derive_wip_allocation_resume_points(
                    [
                        {
                            "inventory_type": "ROLL",
                            "inventory_id": "wip-roll-1",
                            "source_bucket": source_bucket,
                            "signature_match_mode": "SEMI_INVARIANT",
                        }
                    ],
                    route_last=2,
                )

                self.assertEqual(validation_step, 0)
                self.assertEqual(job_start, 1)

    def test_non_raw_upstream_roll_resumes_at_next_step(self):
        viewset = PlannerViewSet()
        roll_qs = MagicMock()
        roll_qs.only.return_value.first.return_value = SimpleNamespace(completed_step_index=0)

        with patch("apps.production.views_planner.InventoryRoll.objects.filter", return_value=roll_qs):
            validation_step, job_start = viewset._derive_wip_allocation_resume_points(
                [
                    {
                        "inventory_type": "ROLL",
                        "inventory_id": "upstream-roll-1",
                        "source_bucket": "COMPATIBLE_UPSTREAM_ROLL_STOCK",
                        "signature_match_mode": "SEMI_INVARIANT",
                    }
                ],
                route_last=2,
                include_upstream=True,
            )

        self.assertEqual(validation_step, 0)
        self.assertEqual(job_start, 1)

    def test_raw_step0_input_does_not_skip_its_consuming_step(self):
        viewset = PlannerViewSet()
        roll_qs = MagicMock()
        roll_qs.only.return_value.first.return_value = SimpleNamespace(completed_step_index=0)

        with patch("apps.production.views_planner.InventoryRoll.objects.filter", return_value=roll_qs):
            validation_step, job_start = viewset._derive_wip_allocation_resume_points(
                [
                    {
                        "inventory_type": "ROLL",
                        "inventory_id": "raw-roll-1",
                        "source_bucket": "COMPATIBLE_UPSTREAM_ROLL_STOCK",
                        "signature_match_mode": "STEP0_RAW",
                    }
                ],
                route_last=2,
            )

        self.assertIsNone(validation_step)
        self.assertIsNone(job_start)

    def test_step0_roll_route_keeps_raw_roll_input_options(self):
        template = SimpleNamespace(id="template-1", routing_rule_id="route-1")
        raw_roll = SimpleNamespace(
            id="roll-raw",
            label_id="ROLL-RAW",
            template=template,
            template_id="template-1",
            material_id="mat-1",
            material=SimpleNamespace(parent_family_id="family-1"),
            completed_step_index=0,
            width_mm=Decimal("640"),
            weight_kg=Decimal("120"),
            sales_order_item=None,
        )
        sales_item = SimpleNamespace(
            planned_parent_width_mm=Decimal("640"),
            layer_snapshot=[{"variant_id": "mat-1", "thickness_micron": 65}],
        )
        roll_qs = MagicMock()
        roll_qs.select_related.return_value = roll_qs
        roll_qs.order_by.return_value = [raw_roll]
        batch_qs = MagicMock()
        batch_qs.select_related.return_value = batch_qs
        batch_qs.order_by.return_value = []

        with patch("apps.production.views_planner.InventoryRoll.objects.filter", return_value=roll_qs), \
             patch("apps.production.views_planner.FinishedGoodsBatch.objects.filter", return_value=batch_qs), \
             patch("apps.production.views_planner.build_roll_naming_payload", return_value={
                 "variant_display_name": "LD NATURAL - ML",
                 "family_display_name": "LD NATURAL - ML",
                 "size_line": "640 mm x 65 micron",
                 "process_state_label": "Raw Material",
             }), \
             patch("apps.production.views_planner.resolve_roll_role", return_value="RAW_MATERIAL"), \
             patch.object(PlannerViewSet, "_route_step_accepts_roll_input", return_value=True), \
             patch.object(PlannerViewSet, "_route_step_label", return_value="Raw Material"), \
             patch.object(PlannerViewSet, "_sales_item_roll_width_mm", return_value=Decimal("640")), \
             patch.object(PlannerViewSet, "_roll_signature", return_value="spec-raw"), \
             patch.object(PlannerViewSet, "_roll_invariant_signature", return_value="inv-raw"), \
             patch.object(PlannerViewSet, "_stock_commitment_matches_sales_item", return_value=True), \
             patch.object(PlannerViewSet, "_planner_stock_class_for_roll", return_value="EXTRUDED_BASE_ROLL"), \
             patch.object(PlannerViewSet, "_origin_stock_order_for_roll", return_value=None):
            options = PlannerViewSet()._eligible_inventory_for_order(
                "sales",
                sales_item,
                template,
                order_signature="spec-required",
                order_invariant_signature="inv-required",
                required_start_step=0,
                route_last_index=2,
                roll_alloc_map={},
                fg_alloc_map={},
                order_layer_snapshot=sales_item.layer_snapshot,
                sales_item=sales_item,
            )

        self.assertEqual(len(options), 1)
        self.assertEqual(options[0]["source_bucket"], "COMPATIBLE_UPSTREAM_ROLL_STOCK")
        self.assertEqual(options[0]["signature_match_mode"], "STEP0_RAW")

    def test_step0_roll_route_filters_input_stock_to_order_layer_materials(self):
        template = SimpleNamespace(id="template-1", routing_rule_id="route-1")
        good_roll = SimpleNamespace(
            id="roll-pp",
            label_id="ROLL-PP",
            template=template,
            template_id="template-1",
            material_id="pp-variant",
            material=SimpleNamespace(parent_family_id="family-pp"),
            completed_step_index=0,
            width_mm=Decimal("430"),
            weight_kg=Decimal("80"),
            sales_order_item=None,
        )
        bad_roll = SimpleNamespace(
            id="roll-other",
            label_id="ROLL-OTHER",
            template=template,
            template_id="template-1",
            material_id="other-variant",
            material=SimpleNamespace(parent_family_id="family-other"),
            completed_step_index=0,
            width_mm=Decimal("430"),
            weight_kg=Decimal("80"),
            sales_order_item=None,
        )
        sales_item = SimpleNamespace(
            planned_parent_width_mm=Decimal("430"),
            layer_snapshot=[
                {"variant_id": "pet-variant", "thickness_micron": 12},
                {"variant_id": "pp-variant", "thickness_micron": 40},
            ],
        )
        roll_qs = MagicMock()
        roll_qs.select_related.return_value = roll_qs
        roll_qs.order_by.return_value = [good_roll, bad_roll]
        batch_qs = MagicMock()
        batch_qs.select_related.return_value = batch_qs
        batch_qs.order_by.return_value = []

        with patch("apps.production.views_planner.InventoryRoll.objects.filter", return_value=roll_qs), \
             patch("apps.production.views_planner.FinishedGoodsBatch.objects.filter", return_value=batch_qs), \
             patch("apps.production.views_planner.build_roll_naming_payload", return_value={
                 "variant_display_name": "Input roll",
                 "family_display_name": "Input roll",
                 "size_line": "430 mm",
                 "process_state_label": "Raw Material",
             }), \
             patch("apps.production.views_planner.resolve_roll_role", return_value="RAW_MATERIAL"), \
             patch.object(PlannerViewSet, "_route_step_can_start_from_purchased_roll", return_value=True), \
             patch.object(PlannerViewSet, "_route_step_label", return_value="Raw Material"), \
             patch.object(PlannerViewSet, "_sales_item_roll_width_mm", return_value=Decimal("430")), \
             patch.object(PlannerViewSet, "_stock_commitment_matches_sales_item", return_value=True), \
             patch.object(PlannerViewSet, "_planner_stock_class_for_roll", return_value="EXTRUDED_BASE_ROLL"), \
             patch.object(PlannerViewSet, "_origin_stock_order_for_roll", return_value=None), \
             patch.object(PlannerViewSet, "_roll_signature", return_value="different-spec"), \
             patch.object(PlannerViewSet, "_roll_invariant_signature", return_value="different-invariant"):
            options = PlannerViewSet()._eligible_inventory_for_order(
                "sales",
                sales_item,
                template,
                order_signature="spec-required",
                order_invariant_signature="inv-required",
                required_start_step=0,
                route_last_index=2,
                roll_alloc_map={},
                fg_alloc_map={},
                order_layer_snapshot=sales_item.layer_snapshot,
                sales_item=sales_item,
            )

        self.assertEqual([row["inventory_id"] for row in options], ["roll-pp"])

    def test_allocation_rejects_stage0_roll_for_bulk_start_step(self):
        template = SimpleNamespace(id="template-1", routing_rule_id="route-1")
        sales_order = SimpleNamespace(id="so-1", geometry_override={})
        sales_item = SimpleNamespace(
            geometry_snapshot={},
            layer_snapshot=[],
            printing_snapshot={},
            addons_snapshot=[],
            spec_signature="",
            invariant_signature="",
        )
        raw_roll = SimpleNamespace(
            id="roll-raw",
            label_id="ROLL-RAW",
            template=template,
            template_id="template-1",
            completed_step_index=0,
        )
        roll_qs = MagicMock()
        roll_qs.filter.return_value = roll_qs
        roll_qs.get.return_value = raw_roll

        with patch("apps.production.views_planner.InventoryRoll.objects.select_related", return_value=roll_qs), \
             patch.object(PlannerViewSet, "_route_step_accepts_roll_input", return_value=False), \
             patch.object(PlannerViewSet, "_upstream_stock_start_blocker", return_value="Fresh run required for bulk extrusion."), \
             patch.object(PlannerViewSet, "_order_signature", return_value="spec"), \
             patch.object(PlannerViewSet, "_order_invariant_signature", return_value="inv"), \
             patch.object(PlannerViewSet, "_inventory_active_allocation_maps", return_value=({}, {})):
            with self.assertRaisesRegex(ValueError, "Fresh run required"):
                PlannerViewSet()._create_inventory_allocations(
                    order_kind="sales",
                    order_obj=sales_order,
                    template=template,
                    route_last=2,
                    start_step=0,
                    option="WIP_CONTINUE",
                    allocation_rows=[{
                        "inventory_type": "ROLL",
                        "inventory_id": "roll-raw",
                        "allocated_qty_kg": "10",
                    }],
                    created_by=None,
                    sales_item_override=sales_item,
                )

    def test_allocation_accepts_verified_stage0_shared_wip_and_resumes_after_bulk_step(self):
        template = SimpleNamespace(id="template-1", routing_rule_id="route-1")
        sales_order = SimpleNamespace(id="so-1", geometry_override={})
        sales_item = SimpleNamespace(
            id="so-item-1",
            geometry_snapshot={},
            layer_snapshot=[{"variant_id": "film-1"}],
            printing_snapshot={"enabled": True},
            addons_snapshot=[],
            spec_signature="required-spec",
            invariant_signature="required-invariant",
        )
        source_stock_order = SimpleNamespace(
            id="stock-1",
            layer_snapshot=[{"variant_id": "film-1"}],
        )
        shared_roll = MagicMock()
        shared_roll.id = "roll-shared"
        shared_roll.label_id = "ROLL-SHARED"
        shared_roll.template = template
        shared_roll.template_id = "template-1"
        shared_roll.sales_order_item = None
        shared_roll.sales_order_item_id = None
        shared_roll.completed_step_index = 0
        shared_roll.weight_kg = Decimal("20")
        shared_roll.meta_json = {}
        roll_qs = MagicMock()
        roll_qs.filter.return_value = roll_qs
        roll_qs.get.return_value = shared_roll

        with patch("apps.production.views_planner.InventoryRoll.objects.select_related", return_value=roll_qs), \
             patch("apps.production.views_planner.InventoryAllocation.objects.create", return_value=SimpleNamespace(id="allocation-1")), \
             patch.object(PlannerViewSet, "_route_step_accepts_roll_input", return_value=False), \
             patch.object(PlannerViewSet, "_order_signature", return_value="required-spec"), \
             patch.object(PlannerViewSet, "_order_invariant_signature", return_value="required-invariant"), \
             patch.object(PlannerViewSet, "_layer_only_invariant_signature", return_value="same-layer-signature"), \
             patch.object(PlannerViewSet, "_roll_invariant_signature", return_value="pre-artwork-invariant"), \
             patch.object(PlannerViewSet, "_origin_stock_order_for_roll", return_value=source_stock_order), \
             patch.object(PlannerViewSet, "_is_same_order_lineage_roll", return_value=False), \
             patch.object(PlannerViewSet, "_is_pre_artwork_shared_stock", return_value=True), \
             patch.object(PlannerViewSet, "_stock_commitment_matches_sales_item", return_value=True), \
             patch.object(PlannerViewSet, "_inventory_active_allocation_maps", return_value=({}, {})), \
             patch.object(PlannerViewSet, "_append_claim_history", return_value={"claimed": True}):
            allocations = PlannerViewSet()._create_inventory_allocations(
                order_kind="sales",
                order_obj=sales_order,
                template=template,
                route_last=2,
                start_step=0,
                option="WIP_CONTINUE",
                allocation_rows=[{
                    "inventory_type": "ROLL",
                    "inventory_id": "roll-shared",
                    "allocated_qty_kg": "10",
                }],
                created_by=None,
                sales_item_override=sales_item,
            )

        self.assertEqual(len(allocations), 1)
        shared_roll.save.assert_called_once_with(update_fields=["sales_order_item", "meta_json"])

    def test_math_state_marks_missing_unit_weight_invalid_for_pcs(self):
        valid, message = PlannerViewSet()._math_state(
            required_qty_kg=Decimal("5"),
            qty_uom="PCS",
            unit_weight_g=Decimal("0"),
        )

        self.assertFalse(valid)
        self.assertIn("unit weight", message.lower())

    def test_claim_candidates_marks_split_required_for_oversized_roll(self):
        so_item = SimpleNamespace(
            id="so-item-1",
            sales_order=SimpleNamespace(order_number="SO-1"),
            template=SimpleNamespace(routing_rule=object()),
            template_id="template-1",
            geometry_snapshot={},
            layer_snapshot=[],
            printing_snapshot={},
            addons_snapshot=[],
            spec_signature="sig",
            invariant_signature="inv",
        )
        roll = SimpleNamespace(id="roll-1", label_id="ROLL-1", weight_kg=Decimal("8"))
        source_order = SimpleNamespace(id="mts-1", order_number="MTS-1")

        roll_qs = MagicMock()
        roll_qs.exclude.return_value = roll_qs
        roll_qs.filter.return_value = roll_qs
        roll_qs.select_related.return_value = roll_qs
        roll_qs.order_by.return_value = [roll]

        batch_qs = MagicMock()
        batch_qs.exclude.return_value = batch_qs
        batch_qs.filter.return_value = batch_qs
        batch_qs.select_related.return_value = batch_qs
        batch_qs.order_by.return_value = []

        request = SimpleNamespace(query_params={}, data={}, user=SimpleNamespace())

        with patch("apps.production.views_planner.SalesOrderItem.objects.select_related") as so_select, \
             patch("apps.production.views_planner.InventoryRoll.objects.filter", return_value=roll_qs), \
             patch("apps.production.views_planner.FinishedGoodsBatch.objects.filter", return_value=batch_qs), \
             patch.object(PlannerViewSet, "_route_last_index", return_value=4), \
             patch.object(PlannerViewSet, "_order_signature", return_value="sig"), \
             patch.object(PlannerViewSet, "_order_invariant_signature", return_value="inv"), \
             patch.object(PlannerViewSet, "_sales_item_remaining_qty_kg", return_value=Decimal("5")), \
             patch.object(PlannerViewSet, "_inventory_active_allocation_maps", return_value=({}, {})), \
             patch.object(PlannerViewSet, "_origin_stock_order_for_roll", return_value=source_order), \
             patch.object(PlannerViewSet, "_roll_signature", return_value="sig"), \
             patch.object(PlannerViewSet, "_roll_invariant_signature", return_value="inv"):
            so_select.return_value.get.return_value = so_item
            response = PlannerViewSet().claim_candidates(request, sales_order_item_id="so-item-1")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["candidates"]), 1)
        self.assertTrue(response.data["candidates"][0]["requires_split_for_partial"])

    def test_claim_candidates_excludes_route_mismatched_roll(self):
        so_item = SimpleNamespace(
            id="so-item-1",
            sales_order=SimpleNamespace(order_number="SO-1"),
            template=SimpleNamespace(routing_rule=object(), routing_rule_id="route-A"),
            template_id="template-1",
            geometry_snapshot={},
            layer_snapshot=[],
            printing_snapshot={},
            addons_snapshot=[],
            spec_signature="sig",
            invariant_signature="inv",
        )
        roll = SimpleNamespace(
            id="roll-1",
            label_id="ROLL-ROUTE-B",
            weight_kg=Decimal("8"),
            template=SimpleNamespace(routing_rule_id="route-B"),
            template_id="template-roll",
        )
        source_order = SimpleNamespace(id="mts-1", order_number="MTS-1")

        roll_qs = MagicMock()
        roll_qs.exclude.return_value = roll_qs
        roll_qs.filter.return_value = roll_qs
        roll_qs.select_related.return_value = roll_qs
        roll_qs.order_by.return_value = [roll]

        batch_qs = MagicMock()
        batch_qs.exclude.return_value = batch_qs
        batch_qs.filter.return_value = batch_qs
        batch_qs.select_related.return_value = batch_qs
        batch_qs.order_by.return_value = []

        request = SimpleNamespace(query_params={}, data={}, user=SimpleNamespace())

        with patch("apps.production.views_planner.SalesOrderItem.objects.select_related") as so_select, \
             patch("apps.production.views_planner.InventoryRoll.objects.filter", return_value=roll_qs), \
             patch("apps.production.views_planner.FinishedGoodsBatch.objects.filter", return_value=batch_qs), \
             patch.object(PlannerViewSet, "_route_last_index", return_value=4), \
             patch.object(PlannerViewSet, "_order_signature", return_value="sig"), \
             patch.object(PlannerViewSet, "_order_invariant_signature", return_value="inv"), \
             patch.object(PlannerViewSet, "_sales_item_remaining_qty_kg", return_value=Decimal("5")), \
             patch.object(PlannerViewSet, "_inventory_active_allocation_maps", return_value=({}, {})), \
             patch.object(PlannerViewSet, "_origin_stock_order_for_roll", return_value=source_order), \
             patch.object(PlannerViewSet, "_roll_signature", return_value="sig"), \
             patch.object(PlannerViewSet, "_roll_invariant_signature", return_value="inv"):
            so_select.return_value.get.return_value = so_item
            response = PlannerViewSet().claim_candidates(request, sales_order_item_id="so-item-1")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["candidates"], [])

    def test_claim_stock_rejects_direct_partial_roll_claim(self):
        so_item = SimpleNamespace(
            id="so-item-1",
            sales_order=SimpleNamespace(order_number="SO-1"),
            template=SimpleNamespace(routing_rule=object()),
            geometry_snapshot={},
            layer_snapshot=[],
            printing_snapshot={},
            addons_snapshot=[],
            spec_signature="sig",
            invariant_signature="inv",
        )
        roll = SimpleNamespace(
            id="roll-1",
            label_id="ROLL-1",
            status="AVAILABLE",
            is_fg=True,
            completed_step_index=4,
            sales_order_item_id=None,
            weight_kg=Decimal("8"),
        )
        source_order = SimpleNamespace(id="mts-1", order_number="MTS-1", stock_purpose="PRODUCT")
        request = SimpleNamespace(
            data={"inventory_type": "ROLL", "inventory_id": "roll-1", "claim_qty_kg": "5"},
            user=SimpleNamespace(is_authenticated=False),
        )

        with patch("apps.production.views_planner.SalesOrderItem.objects.select_related") as so_select, \
             patch("apps.production.views_planner.InventoryRoll.objects.select_for_update") as roll_select, \
             patch("apps.production.views_planner.InventoryAllocation.objects.filter") as allocation_filter, \
             patch("apps.production.views_planner.transaction.atomic", return_value=nullcontext()), \
             patch.object(PlannerViewSet, "_sales_item_remaining_qty_kg", return_value=Decimal("10")), \
             patch.object(PlannerViewSet, "_order_signature", return_value="sig"), \
            patch.object(PlannerViewSet, "_order_invariant_signature", return_value="inv"), \
            patch.object(PlannerViewSet, "_route_last_index", return_value=4), \
            patch.object(PlannerViewSet, "_origin_stock_order_for_roll", return_value=source_order), \
            patch.object(PlannerViewSet, "_roll_signature", return_value="sig"), \
            patch.object(PlannerViewSet, "_roll_invariant_signature", return_value="inv"):
            so_select.return_value.get.return_value = so_item
            roll_select.return_value.get.return_value = roll
            allocation_filter.return_value.exists.return_value = False

            response = PlannerViewSet().claim_stock(request, sales_order_item_id="so-item-1")

        self.assertEqual(response.status_code, 400)
        self.assertIn("Direct partial claim is not allowed", response.data["error"])

    def test_matching_stock_orders_uses_invariant_for_intermediate_pool_only(self):
        template = SimpleNamespace(routing_rule=None)
        final_stock = SimpleNamespace(
            id="mts-final",
            order_number="MTS-FINAL",
            status="RELEASED",
            spec_signature="spec-final-mismatch",
            invariant_signature="inv-shared",
            geometry_snapshot={},
            geometry_override={},
            layer_snapshot=[],
            printing_snapshot={},
            addons_snapshot=[],
            start_step_index=0,
            stop_step_index=3,
            stock_strategy="FINAL_STOCK",
            stock_purpose="PRODUCT",
            target_qty=Decimal("10"),
            produced_qty=Decimal("0"),
        )
        intermediate_stock = SimpleNamespace(
            id="mts-wip",
            order_number="MTS-WIP",
            status="RELEASED",
            spec_signature="spec-other",
            invariant_signature="inv-shared",
            geometry_snapshot={},
            geometry_override={},
            layer_snapshot=[],
            printing_snapshot={},
            addons_snapshot=[],
            start_step_index=0,
            stop_step_index=2,
            stock_strategy="INTERMEDIATE_POOL",
            stock_purpose="PRODUCT",
            target_qty=Decimal("8"),
            produced_qty=Decimal("0"),
        )
        qs = MagicMock()
        qs.order_by.return_value = [final_stock, intermediate_stock]

        alloc_qs = MagicMock()
        alloc_qs.aggregate.return_value = {"total": Decimal("0")}

        with patch("apps.production.views_planner.PlannedStockOrder.objects.filter", return_value=qs), \
             patch("apps.production.views_planner.InventoryAllocation.objects.filter", return_value=alloc_qs):
            matches = PlannerViewSet()._matching_stock_orders_for_sales(
                template=template,
                order_signature="spec-required",
                order_invariant_signature="inv-shared",
                required_start_step=2,
            )

        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0]["order_id"], "mts-wip")
        self.assertEqual(matches[0]["stock_strategy"], "INTERMEDIATE_POOL")
        self.assertEqual(matches[0]["match_mode"], "SEMI_INVARIANT")

    def test_matching_stock_orders_uses_spec_for_final_stock_and_respects_required_start_step(self):
        template = SimpleNamespace(routing_rule=None)
        final_stock = SimpleNamespace(
            id="mts-final",
            order_number="MTS-FINAL",
            status="RELEASED",
            spec_signature="spec-required",
            invariant_signature="inv-shared",
            geometry_snapshot={},
            geometry_override={},
            layer_snapshot=[],
            printing_snapshot={},
            addons_snapshot={},
            start_step_index=0,
            stop_step_index=3,
            stock_strategy="FINAL_STOCK",
            stock_purpose="PRODUCT",
            target_qty=Decimal("10"),
            produced_qty=Decimal("2"),
        )
        too_early_wip = SimpleNamespace(
            id="mts-early",
            order_number="MTS-EARLY",
            status="RELEASED",
            spec_signature="spec-other",
            invariant_signature="inv-shared",
            geometry_snapshot={},
            geometry_override={},
            layer_snapshot=[],
            printing_snapshot={},
            addons_snapshot=[],
            start_step_index=0,
            stop_step_index=1,
            stock_strategy="INTERMEDIATE_POOL",
            stock_purpose="PRODUCT",
            target_qty=Decimal("8"),
            produced_qty=Decimal("0"),
        )
        qs = MagicMock()
        qs.order_by.return_value = [final_stock, too_early_wip]

        alloc_qs = MagicMock()
        alloc_qs.aggregate.return_value = {"total": Decimal("0")}

        with patch("apps.production.views_planner.PlannedStockOrder.objects.filter", return_value=qs), \
             patch("apps.production.views_planner.InventoryAllocation.objects.filter", return_value=alloc_qs):
            matches = PlannerViewSet()._matching_stock_orders_for_sales(
                template=template,
                order_signature="spec-required",
                order_invariant_signature="inv-shared",
                required_start_step=2,
            )

        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0]["order_id"], "mts-final")
        self.assertEqual(matches[0]["remaining_qty_kg"], 8.0)
        self.assertEqual(matches[0]["match_mode"], "EXACT_SPEC")

    def test_matching_stock_orders_allows_exact_spec_stopped_routes(self):
        template = SimpleNamespace(routing_rule=None)
        stopped_exact = SimpleNamespace(
            id="mts-stop",
            order_number="MTS-STOP",
            status="RELEASED",
            spec_signature="spec-required",
            invariant_signature="inv-shared",
            geometry_snapshot={},
            geometry_override={},
            layer_snapshot=[],
            printing_snapshot={},
            addons_snapshot=[],
            start_step_index=0,
            stop_step_index=1,
            stock_strategy="INTERMEDIATE_POOL",
            stock_purpose="PRODUCT",
            target_qty=Decimal("12"),
            produced_qty=Decimal("4"),
        )
        qs = MagicMock()
        qs.order_by.return_value = [stopped_exact]

        alloc_qs = MagicMock()
        alloc_qs.aggregate.return_value = {"total": Decimal("0")}

        with patch("apps.production.views_planner.PlannedStockOrder.objects.filter", return_value=qs), \
             patch("apps.production.views_planner.InventoryAllocation.objects.filter", return_value=alloc_qs):
            matches = PlannerViewSet()._matching_stock_orders_for_sales(
                template=template,
                order_signature="spec-required",
                order_invariant_signature="inv-shared",
                required_start_step=0,
            )

        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0]["order_id"], "mts-stop")
        self.assertEqual(matches[0]["match_mode"], "EXACT_SPEC")

    def test_resume_stock_route_rejects_non_stopped_final_candidate(self):
        so_item = SimpleNamespace(
            id="so-item-1",
            sales_order=SimpleNamespace(order_number="SO-1", status="PLANNING_REQUIRED", save=MagicMock()),
            template=SimpleNamespace(routing_rule=object(), routing_rule_id="route-1"),
            template_id="template-1",
            geometry_snapshot={},
            layer_snapshot=[],
            printing_snapshot={},
            addons_snapshot=[],
            invariant_signature="inv",
            spec_signature="sig",
        )
        stock_order = SimpleNamespace(
            id="mts-1",
            order_number="MTS-1",
            stock_purpose="PRODUCT",
            template_id="template-1",
        )
        request = SimpleNamespace(data={"stock_order_id": "mts-1"}, user=SimpleNamespace(is_authenticated=False))

        with patch("apps.production.views_planner.SalesOrderItem.objects.select_related") as so_select, \
             patch("apps.production.views_planner.PlannedStockOrder.objects.select_related") as stock_select, \
             patch.object(PlannerViewSet, "_route_last_index", return_value=3), \
             patch.object(PlannerViewSet, "_order_signature", return_value="sig"), \
             patch.object(PlannerViewSet, "_order_invariant_signature", return_value="inv"), \
             patch.object(PlannerViewSet, "_matching_stock_orders_for_sales", return_value=[{
                 "order_id": "mts-1",
                 "order_number": "MTS-1",
                 "match_mode": "EXACT_SPEC",
                 "stop_step_index": 3,
             }]):
            so_select.return_value.get.return_value = so_item
            stock_select.return_value.get.return_value = stock_order
            response = PlannerViewSet().resume_stock_route(request, sales_order_item_id="so-item-1")

        self.assertEqual(response.status_code, 400)
        self.assertIn("claim", response.data["error"].lower())

    def test_resume_stock_route_creates_allocations_and_jobs_for_stopped_exact_route(self):
        sales_order = SimpleNamespace(order_number="SO-1", status="PLANNING_REQUIRED", save=MagicMock())
        so_item = SimpleNamespace(
            id="so-item-1",
            sales_order=sales_order,
            template=SimpleNamespace(routing_rule=object(), routing_rule_id="route-1"),
            template_id="template-1",
            geometry_snapshot={},
            layer_snapshot=[],
            printing_snapshot={},
            addons_snapshot=[],
            invariant_signature="inv",
            spec_signature="sig",
        )
        stock_order = SimpleNamespace(
            id="mts-1",
            order_number="MTS-1",
            stock_purpose="PRODUCT",
            template_id="template-1",
        )
        created_allocations = [SimpleNamespace(id="alloc-1"), SimpleNamespace(id="alloc-2")]
        created_jobs = [SimpleNamespace(id="job-1", job_number="JOB-1"), SimpleNamespace(id="job-2", job_number="JOB-2")]
        request = SimpleNamespace(data={"stock_order_id": "mts-1"}, user=SimpleNamespace(is_authenticated=False))
        empty_jobs = MagicMock()
        empty_jobs.exclude.return_value.exists.return_value = False

        with patch("apps.production.views_planner.SalesOrderItem.objects.select_related") as so_select, \
             patch("apps.production.views_planner.PlannedStockOrder.objects.select_related") as stock_select, \
             patch("apps.production.views_planner.transaction.atomic", return_value=nullcontext()), \
             patch.object(PlannerViewSet, "_route_last_index", return_value=3), \
             patch.object(PlannerViewSet, "_order_signature", return_value="sig"), \
             patch.object(PlannerViewSet, "_order_invariant_signature", return_value="inv"), \
             patch.object(PlannerViewSet, "_matching_stock_orders_for_sales", return_value=[{
                 "order_id": "mts-1",
                 "order_number": "MTS-1",
                 "match_mode": "EXACT_SPEC",
                 "stop_step_index": 1,
             }]), \
             patch.object(PlannerViewSet, "_order_job_queryset", return_value=empty_jobs), \
             patch.object(PlannerViewSet, "_resume_allocations_for_sales_from_stock_route", return_value=(created_allocations, 2)), \
             patch("apps.production.views_planner.JobService.create_jobs_for_so_item", return_value=created_jobs) as create_jobs:
            so_select.return_value.get.return_value = so_item
            stock_select.return_value.get.return_value = stock_order
            response = PlannerViewSet().resume_stock_route(request, sales_order_item_id="so-item-1")

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["allocations_created"], 2)
        self.assertEqual(response.data["created_job_numbers"], ["JOB-1", "JOB-2"])
        self.assertEqual(response.data["resume_mode"], "EXACT_STOPPED_ROUTE")
        create_jobs.assert_called_once()
        self.assertEqual(create_jobs.call_args.kwargs["start_index"], 2)

    def test_prime_stock_order_for_release_creates_jobs_and_marks_order_planned(self):
        order = SimpleNamespace(
            template=SimpleNamespace(routing_rule=object()),
            start_step_index=1,
            stop_step_index=2,
            target_step_index=2,
            status="PLANNING_REQUIRED",
            save=MagicMock(),
        )
        existing_jobs = MagicMock()
        existing_jobs.exclude.return_value.exists.return_value = False
        created_jobs = [SimpleNamespace(id="job-1"), SimpleNamespace(id="job-2")]

        with patch.object(PlannerViewSet, "_route_last_index", return_value=3), \
             patch.object(PlannerViewSet, "_order_job_queryset", return_value=existing_jobs), \
             patch("apps.production.views_planner.JobService.create_jobs_for_planned_order", return_value=created_jobs) as create_jobs:
            jobs = PlannerViewSet()._prime_stock_order_for_release(order)

        self.assertEqual(jobs, created_jobs)
        self.assertEqual(order.status, "PLANNED")
        create_jobs.assert_called_once_with(order, start_index=1, stop_index=2)
        order.save.assert_called_once()

    def test_one_step_roll_inventory_options_require_exact_final_spec(self):
        view = PlannerViewSet()
        template = SimpleNamespace(id="template-1", routing_rule_id="route-1", routing_rule=None)
        sales_item = SimpleNamespace(planned_parent_width_mm=Decimal("640"))
        exact_roll = SimpleNamespace(
            id="roll-exact",
            label_id="EXACT",
            template=template,
            template_id="template-1",
            completed_step_index=0,
            weight_kg=Decimal("203.8"),
            width_mm=Decimal("640"),
            sales_order_item=None,
            material=None,
        )
        wrong_roll = SimpleNamespace(
            id="roll-wrong",
            label_id="WRONG",
            template=template,
            template_id="template-1",
            completed_step_index=0,
            weight_kg=Decimal("204.6"),
            width_mm=Decimal("660"),
            sales_order_item=None,
            material=None,
        )
        roll_qs = MagicMock()
        roll_qs.select_related.return_value.order_by.return_value = [exact_roll, wrong_roll]
        fg_qs = MagicMock()
        fg_qs.select_related.return_value.order_by.return_value = []

        def roll_signature(roll):
            return "final-sig" if roll.id == "roll-exact" else "other-final-sig"

        def width_payload(stock_width, required_width):
            stock = Decimal(str(stock_width or 0))
            required = Decimal(str(required_width or 0))
            return stock >= required, {
                "required_width_mm": float(required),
                "stock_width_mm": float(stock),
                "width_match_mode": "EXACT_WIDTH" if stock == required else "CAN_SLIT",
                "can_slit_to_required_width": stock > required,
            }

        with patch("apps.production.views_planner.InventoryRoll.objects.filter", return_value=roll_qs), \
             patch("apps.production.views_planner.FinishedGoodsBatch.objects.filter", return_value=fg_qs), \
             patch("apps.production.views_planner.build_roll_naming_payload", return_value={
                 "variant_display_name": "LD NATURAL - ML",
                 "family_display_name": "LD NATURAL - ML",
                 "size_line": "640 mm",
                 "process_state_label": "Final stock",
             }), \
             patch("apps.production.views_planner.resolve_roll_role", return_value="OUTPUT"), \
             patch.object(view, "_roll_signature", side_effect=roll_signature), \
             patch.object(view, "_roll_invariant_signature", return_value="inv-sig"), \
             patch.object(view, "_planner_stock_class_for_roll", return_value="FINISHED_ROLL"), \
             patch.object(view, "_origin_stock_order_for_roll", return_value=None), \
             patch.object(view, "_width_match_payload", side_effect=width_payload):
            options = view._eligible_inventory_for_order(
                "sales",
                SimpleNamespace(id="order-1"),
                template,
                order_signature="final-sig",
                order_invariant_signature="inv-sig",
                required_start_step=0,
                route_last_index=0,
                roll_alloc_map={},
                fg_alloc_map={},
                order_layer_snapshot=[{"variant_id": "ldnat-ml", "thickness_micron": 65}],
                sales_item=sales_item,
            )

        self.assertEqual([option["inventory_id"] for option in options], ["roll-exact"])
        self.assertEqual(options[0]["source_bucket"], "FINISHED_STOCK")
        self.assertEqual(options[0]["signature_match_mode"], "FINAL_SPEC")
        self.assertEqual(options[0]["width_match_mode"], "EXACT_WIDTH")
