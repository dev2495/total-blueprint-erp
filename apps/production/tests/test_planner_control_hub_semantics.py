from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from apps.production.views_planner import PlannerViewSet


class PlannerControlHubSemanticTests(SimpleTestCase):
    @patch("apps.production.views_planner.JobExecutionLog.objects.filter")
    def test_partial_shortfall_is_zero_until_final_output_exists(self, mock_filter):
        mock_filter.return_value.aggregate.return_value = {"total": 0}

        metrics = PlannerViewSet()._sales_item_partial_metrics(
            SimpleNamespace(total_weight_kg=Decimal("360.704")),
            route_last_index=3,
        )

        self.assertFalse(metrics["has_started_final_output"])
        self.assertEqual(metrics["produced_kg"], Decimal("0"))
        self.assertEqual(metrics["shortfall_kg"], Decimal("0"))
        self.assertEqual(metrics["shortfall_pct"], Decimal("0"))
        self.assertFalse(metrics["requires_replan"])

    @patch("apps.production.views_planner.JobExecutionLog.objects.filter")
    def test_partial_shortfall_appears_only_after_completed_final_output(self, mock_filter):
        mock_filter.return_value.aggregate.return_value = {"total": Decimal("120")}

        metrics = PlannerViewSet()._sales_item_partial_metrics(
            SimpleNamespace(total_weight_kg=Decimal("200")),
            route_last_index=2,
        )

        self.assertTrue(metrics["has_started_final_output"])
        self.assertEqual(metrics["shortfall_kg"], Decimal("80"))
        self.assertTrue(metrics["shortfall_pct"] > Decimal("5"))
        self.assertTrue(metrics["requires_replan"])

    def test_queue_lifecycle_filter_matches_partial_replan_rows(self):
        viewset = PlannerViewSet()
        partial_row = {
            "order_number": "SO-PARTIAL",
            "line_status": "PARTIAL",
            "qty_dispatchable": 200,
            "qty_replan_remaining_kg": 300,
            "partial_replan_required": True,
        }
        normal_row = {
            "order_number": "SO-NORMAL",
            "line_status": "PLANNING_REQUIRED",
            "qty_dispatchable": 0,
            "qty_replan_remaining_kg": 0,
            "partial_replan_required": False,
        }

        self.assertTrue(viewset._control_hub_row_matches_queue_filters(partial_row, {"lifecycle": "partial_replan"}))
        self.assertTrue(viewset._control_hub_row_matches_queue_filters(partial_row, {"lifecycle": "partial_dispatchable"}))
        self.assertFalse(viewset._control_hub_row_matches_queue_filters(normal_row, {"lifecycle": "partial_replan"}))
        self.assertFalse(viewset._control_hub_row_matches_queue_filters(normal_row, {"lifecycle": "partial_dispatchable"}))

    def test_artwork_blocker_clears_when_artwork_is_assigned(self):
        viewset = PlannerViewSet()

        blockers = viewset._row_blockers(
            {
                "printing_enabled": True,
                "artwork_assignment_required": True,
                "assigned_artwork_id": "artwork-1",
                "math_valid": True,
            }
        )

        self.assertNotIn("ARTWORK_REQUIRED", {blocker["code"] for blocker in blockers})

    def test_artwork_blocker_remains_when_required_artwork_is_missing(self):
        viewset = PlannerViewSet()

        blockers = viewset._row_blockers(
            {
                "printing_enabled": True,
                "artwork_assignment_required": True,
                "assigned_artwork_id": "",
                "math_valid": True,
            }
        )

        self.assertIn("ARTWORK_REQUIRED", {blocker["code"] for blocker in blockers})

    def test_bom_not_ready_blocks_release_checklist_even_with_material_lines(self):
        viewset = PlannerViewSet()
        row = {
            "math_valid": True,
            "material_plan_lines": [{"material_name": "PP", "planned_issue_qty": 10, "uom": "KG"}],
            "inventory_options": [],
            "bom_readiness_errors": ["No recipe for PP (grade, 40.0μ)"],
        }

        blockers = viewset._row_blockers(row)
        row["blockers"] = blockers
        checklist = viewset._row_release_checklist(row)

        self.assertIn("BOM_NOT_READY", {blocker["code"] for blocker in blockers})
        self.assertFalse(checklist["release_ready"])
        material_item = next(item for item in checklist["items"] if item["code"] == "MATERIAL_PLAN")
        self.assertEqual(material_item["status"], "BLOCKED")
        self.assertIn("No recipe for PP", material_item["message"])

    def test_upstream_stock_allocation_rows_do_not_advance_wip_resume_step(self):
        viewset = PlannerViewSet()

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

    def test_work_center_overrides_payload_normalizes_step_choices(self):
        viewset = PlannerViewSet()

        overrides = viewset._work_center_overrides_from_payload(
            {
                "work_center_overrides": [
                    {"step_index": "1", "work_center_id": "wc-1"},
                    {"step_index": "bad", "work_center_id": "wc-bad"},
                    {"step_index": "2", "work_center": "wc-2"},
                    {"step_index": "3", "work_center_id": ""},
                ]
            }
        )

        self.assertEqual(
            overrides,
            [
                {"step_index": 1, "work_center_id": "wc-1"},
                {"step_index": 2, "work_center_id": "wc-2"},
            ],
        )

    @patch.object(
        PlannerViewSet,
        "_pod_source_availability",
        return_value={
            "pod_bulk_material_count": 0,
            "pod_bulk_qty_kg": Decimal("0"),
            "pod_inhouse_producible_count": 0,
            "has_pod_bulk_stock": False,
            "has_pod_inhouse_production": False,
        },
    )
    def test_source_availability_keeps_step0_upstream_stock_out_of_wip(self, _mock_pod):
        row = {
            "inventory_options": [
                {
                    "inventory_type": "ROLL",
                    "completed_step_index": 0,
                    "is_final_step": False,
                    "signature_match_mode": "STEP0_RAW",
                },
                {
                    "inventory_type": "ROLL",
                    "completed_step_index": 2,
                    "is_final_step": False,
                    "signature_match_mode": "SEMI_INVARIANT",
                    "source_bucket": "SHARED_INVARIANT_ROLL_STOCK",
                },
                {
                    "inventory_type": "ROLL",
                    "completed_step_index": 2,
                    "is_final_step": False,
                    "signature_match_mode": "SEMI_INVARIANT",
                    "source_bucket": "CARRY_FORWARD_WIP",
                }
            ]
        }

        availability = PlannerViewSet()._source_availability(row)

        self.assertEqual(availability["carry_forward_wip_count"], 1)
        self.assertEqual(availability["shared_invariant_roll_count"], 1)
        self.assertEqual(availability["compatible_upstream_roll_match_count"], 1)
        self.assertEqual(availability["wip_match_count"], 1)
        self.assertTrue(availability["has_carry_forward_wip"])
        self.assertTrue(availability["has_shared_invariant_roll_stock"])
        self.assertTrue(availability["has_compatible_upstream_roll"])

    @patch.object(
        PlannerViewSet,
        "_pod_source_availability",
        return_value={
            "pod_bulk_material_count": 0,
            "pod_bulk_qty_kg": Decimal("0"),
            "pod_inhouse_producible_count": 0,
            "has_pod_bulk_stock": False,
            "has_pod_inhouse_production": False,
        },
    )
    def test_upstream_stock_gets_its_own_recommendation_label(self, _mock_pod):
        viewset = PlannerViewSet()
        row = {
            "inventory_options": [
                {
                    "inventory_type": "ROLL",
                    "completed_step_index": 0,
                    "is_final_step": False,
                    "signature_match_mode": "STEP0_RAW",
                }
            ],
            "matching_stock_orders": [],
        }
        row["source_availability"] = viewset._source_availability(row)

        summary = viewset._row_source_summary(row)

        self.assertEqual(summary["recommended_option"], "UPSTREAM_STOCK")
        self.assertEqual(summary["recommended_label"], "Use compatible upstream roll stock")

    @patch.object(
        PlannerViewSet,
        "_pod_source_availability",
        return_value={
            "pod_bulk_material_count": 0,
            "pod_bulk_qty_kg": Decimal("0"),
            "pod_inhouse_producible_count": 0,
            "has_pod_bulk_stock": False,
            "has_pod_inhouse_production": False,
        },
    )
    @patch.object(
        PlannerViewSet,
        "_packaging_source_availability",
        return_value={
            "packaging_stock_material_count": 0,
            "packaging_stock_row_count": 0,
            "packaging_inhouse_producible_count": 0,
            "has_packaging_stock": False,
            "has_packaging_inhouse_production": False,
        },
    )
    def test_source_availability_treats_pre_start_rolls_as_upstream(self, _mock_packaging, _mock_pod):
        row = {
            "required_start_step": 2,
            "inventory_options": [
                {
                    "inventory_type": "ROLL",
                    "completed_step_index": 1,
                    "is_final_step": False,
                    "signature_match_mode": "SEMI_INVARIANT",
                },
                {
                    "inventory_type": "ROLL",
                    "completed_step_index": 2,
                    "is_final_step": False,
                    "signature_match_mode": "SEMI_INVARIANT",
                },
            ],
        }

        availability = PlannerViewSet()._source_availability(row)

        self.assertEqual(availability["carry_forward_wip_count"], 1)
        self.assertEqual(availability["compatible_upstream_roll_match_count"], 1)
        self.assertEqual(availability["wip_match_count"], 1)

    @patch.object(
        PlannerViewSet,
        "_pod_source_availability",
        return_value={
            "pod_bulk_material_count": 0,
            "pod_bulk_qty_kg": Decimal("0"),
            "pod_inhouse_producible_count": 0,
            "has_pod_bulk_stock": False,
            "has_pod_inhouse_production": False,
        },
    )
    @patch.object(
        PlannerViewSet,
        "_packaging_source_availability",
        return_value={
            "packaging_stock_material_count": 0,
            "packaging_stock_row_count": 0,
            "packaging_inhouse_producible_count": 0,
            "has_packaging_stock": False,
            "has_packaging_inhouse_production": False,
        },
    )
    def test_shared_invariant_has_priority_over_upstream_stock(self, _mock_packaging, _mock_pod):
        viewset = PlannerViewSet()
        row = {
            "inventory_options": [
                {
                    "inventory_type": "ROLL",
                    "completed_step_index": 2,
                    "is_final_step": False,
                    "signature_match_mode": "SEMI_INVARIANT",
                    "source_bucket": "SHARED_INVARIANT_ROLL_STOCK",
                },
                {
                    "inventory_type": "ROLL",
                    "completed_step_index": 0,
                    "is_final_step": False,
                    "signature_match_mode": "STEP0_RAW",
                    "source_bucket": "COMPATIBLE_UPSTREAM_ROLL_STOCK",
                },
            ],
            "matching_stock_orders": [],
        }
        row["source_availability"] = viewset._source_availability(row)

        summary = viewset._row_source_summary(row)

        self.assertEqual(summary["recommended_option"], "SHARED_INVARIANT")
        self.assertEqual(summary["recommended_label"], "Use shared invariant roll stock")

    def test_row_continuation_prioritizes_exact_fg_before_other_paths(self):
        viewset = PlannerViewSet()
        row = {
            "required_start_step": 2,
            "route_last_step_index": 3,
            "inventory_options": [
                {
                    "inventory_type": "FG_BATCH",
                    "inventory_id": "fg-1",
                    "label": "FG-1",
                    "source_bucket": "FINISHED_STOCK",
                    "stock_strategy": "FINAL_STOCK",
                    "planner_stock_class": "FINAL_PRODUCT",
                    "completed_step_index": 3,
                    "allocatable_qty_kg": 120,
                },
                {
                    "inventory_type": "ROLL",
                    "inventory_id": "roll-1",
                    "label": "ROLL-1",
                    "source_bucket": "SHARED_INVARIANT_ROLL_STOCK",
                    "stock_strategy": "INTERMEDIATE_POOL",
                    "planner_stock_class": "SHARED_INVARIANT_ROLL",
                    "completed_step_index": 2,
                    "allocatable_qty_kg": 80,
                },
            ],
            "matching_stock_orders": [
                {
                    "order_id": "mts-1",
                    "order_number": "MTS-1",
                    "status": "RELEASED",
                    "match_mode": "EXACT_SPEC",
                    "start_step_index": 0,
                    "stop_step_index": 2,
                    "stock_strategy": "INTERMEDIATE_POOL",
                    "planner_stock_class": "SHARED_INVARIANT_ROLL",
                    "remaining_qty_kg": 50,
                    "produced_qty_kg": 10,
                }
            ],
        }

        continuation = viewset._row_continuation(row)

        self.assertEqual(continuation["recommended_mode"], "EXACT_FG")
        self.assertEqual(continuation["recommended_label"], "Use exact finished stock")
        self.assertEqual(len(continuation["exact_fg_candidates"]), 1)
        self.assertEqual(len(continuation["exact_stock_route_candidates"]), 1)

    def test_row_continuation_prioritizes_exact_stock_route_before_invariant_route(self):
        viewset = PlannerViewSet()
        row = {
            "required_start_step": 1,
            "route_last_step_index": 3,
            "inventory_options": [
                {
                    "inventory_type": "ROLL",
                    "inventory_id": "roll-1",
                    "label": "ROLL-1",
                    "source_bucket": "SHARED_INVARIANT_ROLL_STOCK",
                    "stock_strategy": "INTERMEDIATE_POOL",
                    "planner_stock_class": "SHARED_INVARIANT_ROLL",
                    "completed_step_index": 1,
                    "allocatable_qty_kg": 80,
                }
            ],
            "matching_stock_orders": [
                {
                    "order_id": "mts-final",
                    "order_number": "MTS-FINAL",
                    "status": "RELEASED",
                    "match_mode": "EXACT_SPEC",
                    "start_step_index": 0,
                    "stop_step_index": 1,
                    "stock_strategy": "INTERMEDIATE_POOL",
                    "planner_stock_class": "SHARED_INVARIANT_ROLL",
                    "remaining_qty_kg": 120,
                    "produced_qty_kg": 0,
                },
                {
                    "order_id": "mts-wip",
                    "order_number": "MTS-WIP",
                    "status": "RELEASED",
                    "match_mode": "SEMI_INVARIANT",
                    "start_step_index": 0,
                    "stop_step_index": 1,
                    "stock_strategy": "INTERMEDIATE_POOL",
                    "planner_stock_class": "SHARED_INVARIANT_ROLL",
                    "remaining_qty_kg": 120,
                    "produced_qty_kg": 0,
                },
            ],
        }

        continuation = viewset._row_continuation(row)

        self.assertEqual(continuation["recommended_mode"], "EXACT_STOCK_ROUTE")
        self.assertEqual(continuation["recommended_label"], "Continue exact stock order route")
        self.assertEqual(len(continuation["exact_stock_route_candidates"]), 1)
        self.assertEqual(len(continuation["stopped_invariant_route_candidates"]), 1)
        self.assertTrue(continuation["exact_stock_route_candidates"][0]["resume_action_allowed"])
        self.assertEqual(continuation["exact_stock_route_candidates"][0]["recommended_action"], "RESUME_STOCK_ROUTE")

    def test_derive_planner_stock_class_distinguishes_intermediate_roll_modes(self):
        viewset = PlannerViewSet()
        roll_template = SimpleNamespace(fg_type="ROLL", routing_rule=SimpleNamespace(ordered_processes=[1, 2, 3]))
        pouch_template = SimpleNamespace(fg_type="POUCH", routing_rule=SimpleNamespace(ordered_processes=[1, 2, 3]))

        self.assertEqual(
            viewset._derive_planner_stock_class(template=roll_template, stock_purpose="PRODUCT", stop_step_index=0),
            "EXTRUDED_BASE_ROLL",
        )
        self.assertEqual(
            viewset._derive_planner_stock_class(template=roll_template, stock_purpose="PRODUCT", stop_step_index=1),
            "SHARED_INVARIANT_ROLL",
        )
        self.assertEqual(
            viewset._derive_planner_stock_class(template=roll_template, stock_purpose="PRODUCT", stop_step_index=2),
            "FINAL_PLAIN_ROLL",
        )
        self.assertEqual(
            viewset._derive_planner_stock_class(template=pouch_template, stock_purpose="PRODUCT", stop_step_index=2),
            "FINAL_PRODUCT",
        )
        self.assertEqual(
            viewset._derive_planner_stock_class(template=pouch_template, stock_purpose="PACKAGING", stop_step_index=1),
            "PACKAGING_STOCK",
        )

    @patch.object(PlannerViewSet, "_order_items_for_planner")
    def test_aggregate_packaging_requirements_keeps_multiple_skus_distinct(self, mock_order_items):
        mock_order_items.return_value = [
            SimpleNamespace(
                qty_uom="PCS",
                qty_value=Decimal("240"),
                unit_weight_g=Decimal("0"),
                total_weight_kg=Decimal("0"),
                packaging_snapshot={
                    "primary_inner_pack": {
                        "enabled": True,
                        "material_id": "inner-pack-1",
                        "pcs_per_pack": 100,
                    },
                    "roll_dispatch_pack": {
                        "enabled": True,
                        "lines": [
                            {
                                "material_id": "sheet-1",
                                "qty": "2.5",
                                "uom": "KG",
                                "basis": "PER_ORDER",
                            },
                            {
                                "material_id": "tape-1",
                                "qty": "1",
                                "uom": "PCS",
                                "basis": "PER_ROLL",
                            },
                        ],
                    },
                },
            )
        ]

        requirements, warnings = PlannerViewSet()._aggregate_packaging_requirements("sales", SimpleNamespace())

        self.assertEqual(requirements[("inner-pack-1", "PCS")], Decimal("3"))
        self.assertEqual(requirements[("sheet-1", "KG")], Decimal("2.5"))
        self.assertEqual(warnings, [])
        self.assertNotIn(("tape-1", "PCS"), requirements)

    @patch("apps.production.views_planner.PlannedBulkStockOrder.objects.create")
    @patch("apps.production.views_planner.PlannedBulkStockOrder.objects.filter")
    @patch("apps.production.views_planner.InventoryBulk.objects.filter")
    @patch("apps.production.views_planner.InventoryMaterial.objects.get")
    @patch.object(PlannerViewSet, "_aggregate_material_plan_lines")
    def test_create_pod_bulk_orders_creates_only_shortage_qty(
        self,
        mock_material_lines,
        mock_material_get,
        mock_bulk_filter,
        mock_planned_filter,
        mock_create,
    ):
        mock_material_lines.return_value = [
            {
                "category_code": "POD",
                "material_id": "pod-1",
                "planned_issue_qty": "125",
            }
        ]
        mock_material_get.return_value = SimpleNamespace(
            id="pod-1",
            code="POD-1",
            name="POD One",
            category="POD",
            pod_is_inhouse_produced=True,
            pod_type="CENTER_SEAL",
            pod_fixed_height_mm=85,
            pod_thickness_micron=60,
            pod_panel_count=2,
        )
        mock_bulk_filter.return_value.aggregate.return_value = {"total": Decimal("25")}
        mock_planned_filter.return_value.aggregate.return_value = {"total": Decimal("50")}
        created_order = SimpleNamespace(id="bulk-1")
        mock_create.return_value = created_order

        created, skipped = PlannerViewSet()._create_pod_bulk_orders(
            order_kind="sales",
            order_obj=SimpleNamespace(id="sales-1", order_number="SO-1", plant=None),
            created_by=None,
        )

        self.assertEqual(created, [created_order])
        self.assertEqual(skipped, [])
        self.assertEqual(mock_create.call_args.kwargs["target_qty_kg"], Decimal("50.0000"))

    @patch("apps.production.views_planner.PlannedBulkStockOrder.objects.create")
    @patch("apps.production.views_planner.PlannedBulkStockOrder.objects.filter")
    @patch("apps.production.views_planner.InventoryBulk.objects.filter")
    @patch("apps.production.views_planner.InventoryMaterial.objects.get")
    @patch.object(PlannerViewSet, "_aggregate_material_plan_lines")
    def test_create_pod_bulk_orders_preserves_280mm_origin_metadata(
        self,
        mock_material_lines,
        mock_material_get,
        mock_bulk_filter,
        mock_planned_filter,
        mock_create,
    ):
        mock_material_lines.return_value = [
            {
                "category_code": "POD",
                "material_id": "pod-280",
                "planned_issue_qty": "32.5",
            }
        ]
        mock_material_get.return_value = SimpleNamespace(
            id="pod-280",
            code="UAT-GREEN-SALES-POD-280",
            name="UAT-GREEN Sales POD 280",
            category="POD",
            pod_is_inhouse_produced=True,
            pod_type="SINGLE",
            pod_fixed_height_mm=280,
            pod_thickness_micron=35,
            pod_panel_count=1,
        )
        mock_bulk_filter.return_value.aggregate.return_value = {"total": Decimal("0")}
        mock_planned_filter.return_value.aggregate.return_value = {"total": Decimal("0")}
        created_order = SimpleNamespace(id="bulk-280")
        mock_create.return_value = created_order

        created, skipped = PlannerViewSet()._create_pod_bulk_orders(
            order_kind="sales",
            order_obj=SimpleNamespace(id="sales-280", order_number="SO-280", plant=None),
            created_by=SimpleNamespace(username="admin"),
        )

        self.assertEqual(created, [created_order])
        self.assertEqual(skipped, [])
        self.assertEqual(mock_create.call_args.kwargs["target_qty_kg"], Decimal("32.5000"))
        self.assertEqual(mock_create.call_args.kwargs["pod_profile_snapshot"]["pod_fixed_height_mm"], 280.0)
        self.assertEqual(mock_create.call_args.kwargs["planner_origin_meta"]["origin_order_number"], "SO-280")

    @patch("apps.production.views_planner.PlannedBulkStockOrder.objects.create")
    @patch("apps.production.views_planner.PlannedBulkStockOrder.objects.filter")
    @patch("apps.production.views_planner.InventoryBulk.objects.filter")
    @patch("apps.production.views_planner.InventoryMaterial.objects.get")
    @patch.object(PlannerViewSet, "_aggregate_material_plan_lines")
    def test_create_pod_bulk_orders_skips_external_pod(
        self,
        mock_material_lines,
        mock_material_get,
        _mock_bulk_filter,
        _mock_planned_filter,
        mock_create,
    ):
        mock_material_lines.return_value = [
            {
                "category_code": "POD",
                "material_id": "pod-1",
                "planned_issue_qty": "50",
            }
        ]
        mock_material_get.return_value = SimpleNamespace(
            id="pod-1",
            code="POD-1",
            name="POD Buy",
            category="POD",
            pod_is_inhouse_produced=False,
        )

        created, skipped = PlannerViewSet()._create_pod_bulk_orders(
            order_kind="sales",
            order_obj=SimpleNamespace(id="sales-1", order_number="SO-1", plant=None),
            created_by=None,
        )

        self.assertEqual(created, [])
        self.assertEqual(len(skipped), 1)
        self.assertIn("not enabled for in-house production", skipped[0]["reason"])
        mock_create.assert_not_called()
