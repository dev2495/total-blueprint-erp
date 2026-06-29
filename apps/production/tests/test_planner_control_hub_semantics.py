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

        self.assertTrue(
            viewset._control_hub_row_matches_queue_filters(
                {
                    "line_status": "PARTIAL",
                    "partial_replan_required": True,
                    "qty_replan_remaining_kg": 300,
                    "qty_dispatchable": 200,
                },
                {"lifecycle": "partial_replan"},
            )
        )
        self.assertTrue(
            viewset._control_hub_row_matches_queue_filters(
                {
                    "line_status": "PARTIAL",
                    "partial_replan_required": True,
                    "qty_replan_remaining_kg": 300,
                    "qty_dispatchable": 200,
                },
                {"lifecycle": "partial_dispatchable"},
            )
        )
        self.assertFalse(
            viewset._control_hub_row_matches_queue_filters(
                {"line_status": "PLANNING_REQUIRED", "qty_replan_remaining_kg": 0, "qty_dispatchable": 0},
                {"lifecycle": "partial_replan"},
            )
        )

    def test_v2_spec_summary_promotes_geometry_and_thickness_expression(self):
        summary = PlannerViewSet()._row_spec_summary(
            {
                "effective_dims": {"width_mm": 420, "height_mm": 280},
                "layer_snapshot": [
                    {"variant_code": "PET-12", "variant_name": "Clear PET", "thickness_micron": 12},
                    {"material_code": "LDPE", "variant_name": "Milk LDPE", "thickness_micron": 40},
                ],
                "printing_snapshot": {"type": "ROTO", "front_colors_count": 4, "back_colors_count": 1},
                "packaging_snapshot": {"primary_inner_pack": {"enabled": True, "pcs_per_pack": 50}},
                "source_availability": {},
            }
        )

        self.assertEqual(summary["size_label"], "420 x 280 mm")
        self.assertEqual(summary["total_thickness_micron"], 52.0)
        self.assertEqual(summary["thickness_expression"], "12+40")
        self.assertEqual(summary["layer_recipe_label"], "PET-12 · Clear PET 12μ + LDPE · Milk LDPE 40μ")
        self.assertEqual(summary["layer_recipe"][0]["label"], "PET-12 · Clear PET")
        self.assertEqual(summary["layer_recipe"][0]["variant_code"], "PET-12")
        self.assertEqual(summary["layer_recipe"][1]["thickness_micron"], 40.0)
        self.assertEqual(summary["layer_material_labels"], ["PET-12 · Clear PET", "LDPE · Milk LDPE"])
        self.assertIn("Inner pack 50 pcs", summary["packaging_label"])

    def test_partial_replan_trace_is_live_replan_required(self):
        trace = PlannerViewSet()._row_production_trace(
            {
                "status": "PLANNED",
                "line_status": "PARTIAL",
                "partial_replan_required": True,
                "required_start_step": 0,
                "route_last_step_index": 2,
                "job_count": 2,
                "jobs_completed": 1,
                "jobs_released": 0,
                "required_qty_kg": 200,
                "qty_uom": "KG",
                "template_steps": [
                    {"sequence_number": 0, "process_code": "EXT", "process_name": "Extrusion"},
                    {"sequence_number": 1, "process_code": "PRINT", "process_name": "Printing"},
                ],
                "completed_jobs": [
                    {"job_number": "JOB-1", "planned_qty": 200, "produced_qty": 150, "remaining_qty": 50, "scrap_qty": 0, "uom": "KG"}
                ],
                "material_plan_summary": {"line_count": 1},
            }
        )

        self.assertEqual(trace["job_state"], "REPLAN_REQUIRED")
        self.assertEqual(trace["wcm_handoff_state"], "REPLAN_REQUIRED")
        self.assertEqual(trace["produced_qty"], 150.0)

    def test_v2_production_trace_uses_completed_jobs_without_capacity_fields(self):
        trace = PlannerViewSet()._row_production_trace(
            {
                "status": "RELEASED",
                "required_start_step": 0,
                "route_last_step_index": 2,
                "job_count": 2,
                "jobs_completed": 1,
                "jobs_released": 1,
                "required_qty_kg": 200,
                "qty_uom": "KG",
                "template_steps": [
                    {"sequence_number": 0, "process_code": "EXTR", "process_name": "Extrusion"},
                    {"sequence_number": 1, "process_code": "PRINT", "process_name": "Printing"},
                ],
                "completed_jobs": [
                    {
                        "job_number": "JOB-1",
                        "planned_qty": 200,
                        "produced_qty": 120,
                        "remaining_qty": 80,
                        "scrap_qty": 2,
                        "uom": "KG",
                    }
                ],
                "source_availability": {"has_fg": False, "has_wip": True},
                "source_summary": {"recommended_option": "WIP_CONTINUE", "recommended_label": "Carry forward WIP"},
                "continuation": {"shared_invariant_count": 2},
                "material_plan_summary": {"line_count": 2},
            }
        )

        self.assertEqual(trace["job_state"], "IN_PRODUCTION")
        self.assertEqual(trace["route_steps"][0]["state"], "COMPLETED")
        self.assertEqual(trace["route_steps"][1]["state"], "ACTIVE")
        self.assertEqual(trace["produced_qty"], 120.0)
        self.assertEqual(trace["route_topology"][0]["key"], "source")
        self.assertEqual(trace["route_topology"][1]["key"], "route")
        self.assertTrue(any(lane["key"] == "combine" for lane in trace["route_topology"]))
        self.assertNotIn("capacity", str(trace).lower())
        self.assertNotIn("free_slots", str(trace).lower())

    def test_v2_production_trace_preserves_route_dispatch_and_roll_handling(self):
        trace = PlannerViewSet()._row_production_trace(
            {
                "status": "RELEASED",
                "required_start_step": 0,
                "route_last_step_index": 2,
                "job_count": 2,
                "jobs_completed": 0,
                "jobs_released": 1,
                "required_qty_kg": 200,
                "qty_uom": "KG",
                "template_steps": [
                    {
                        "step_id": "step-ext",
                        "route_index": 0,
                        "sequence_number": 1,
                        "process_code": "EXT",
                        "process_name": "Extrusion",
                        "input_form": "RAW",
                        "output_form": "ROLL",
                        "roll_behavior": "ROLL_OUTPUT",
                        "work_center_selection_policy": "AUTO_DEFAULT",
                        "default_work_center_name": "Multilayer LD Plant",
                        "dispatch_status": {"status": "CONFIGURED", "selection_policy": "AUTO_DEFAULT"},
                        "roll_handling": {"input_roll_count": 1, "input_lane_count": 0, "combine_mode": "STRICT_ROLL_COUNT"},
                    },
                    {
                        "step_id": "step-lam",
                        "route_index": 1,
                        "sequence_number": 2,
                        "process_code": "LAM",
                        "process_name": "Lamination",
                        "input_form": "ROLL",
                        "output_form": "ROLL",
                        "roll_behavior": "MULTI_INPUT_COMBINE",
                        "work_center_selection_policy": "PLANNER_REQUIRED",
                        "dispatch_status": {"status": "NEEDS_DECISION", "selection_policy": "PLANNER_REQUIRED"},
                        "roll_handling": {"input_roll_count": 2, "input_lane_count": 2, "combine_mode": "LANE_GROUPS"},
                    },
                ],
                "completed_jobs": [],
                "material_plan_summary": {"line_count": 2},
            }
        )

        self.assertEqual(trace["template_route_source"], "template_process_steps")
        self.assertEqual(trace["route_steps"][0]["step_id"], "step-ext")
        self.assertEqual(trace["route_steps"][0]["route_index"], 0)
        self.assertEqual(trace["route_steps"][0]["default_work_center_name"], "Multilayer LD Plant")
        self.assertEqual(trace["route_steps"][0]["dispatch_status"]["status"], "CONFIGURED")
        self.assertEqual(trace["route_steps"][1]["roll_behavior"], "MULTI_INPUT_COMBINE")
        self.assertEqual(trace["route_steps"][1]["roll_handling"]["input_lane_count"], 2)

    def test_v2_control_hub_analytics_aggregate_real_row_signals(self):
        viewset = PlannerViewSet()
        queue_row = {
            "required_qty_kg": 100,
            "blockers": [{"code": "ARTWORK_REQUIRED"}],
            "release_checklist": {"release_ready": False},
            "artwork_gate": {"active": True},
            "analytics": {"source_path": "FRESH", "coverage_pct": 25},
            "production_trace": {"job_state": "PLANNING_REQUIRED"},
        }
        active_row = {
            "required_qty_kg": 80,
            "blockers": [],
            "analytics": {"source_path": "WIP", "coverage_pct": 100},
            "production_trace": {"job_state": "IN_PRODUCTION"},
        }
        history_row = {
            "required_qty_kg": 60,
            "completed_at": "2026-06-27T10:30:00+00:00",
            "analytics": {"source_path": "FG", "coverage_pct": 100, "completed_at": "2026-06-27T10:30:00+00:00"},
            "production_trace": {"job_state": "COMPLETED"},
        }

        analytics = viewset._control_hub_v2_analytics([queue_row], [active_row], [history_row])

        self.assertEqual(analytics["completion_funnel"]["planning_queue"], 1)
        self.assertEqual(analytics["completion_funnel"]["blocked_queue"], 1)
        self.assertEqual(analytics["blocker_counts"][0]["code"], "ARTWORK_REQUIRED")
        self.assertEqual(analytics["output_rhythm"][0]["orders"], 1)
        self.assertNotIn("capacity", str(analytics).lower())
        self.assertNotIn("free_slots", str(analytics).lower())

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
