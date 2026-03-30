from contextlib import nullcontext
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from apps.production.views_planner import PlannerViewSet


class StockClaimFlowTests(SimpleTestCase):
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
             patch.object(PlannerViewSet, "_resume_allocations_for_sales_from_stock_route", return_value=(created_allocations, 1)), \
             patch("apps.production.views_planner.JobService.create_jobs_for_so_item", return_value=created_jobs):
            so_select.return_value.get.return_value = so_item
            stock_select.return_value.get.return_value = stock_order
            response = PlannerViewSet().resume_stock_route(request, sales_order_item_id="so-item-1")

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["allocations_created"], 2)
        self.assertEqual(response.data["created_job_numbers"], ["JOB-1", "JOB-2"])
        self.assertEqual(response.data["resume_mode"], "EXACT_STOPPED_ROUTE")
