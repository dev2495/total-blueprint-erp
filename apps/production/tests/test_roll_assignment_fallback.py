from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from apps.production.services.services_execution import ExecutionService


class RollAssignmentFallbackTests(SimpleTestCase):
    def _job(self, process, **extra):
        payload = {
            "current_process": process,
            "process": process,
            "current_step_index": 1,
            "sales_order_item": None,
            "mts_order": None,
            "template": None,
        }
        payload.update(extra)
        return SimpleNamespace(**payload)

    def _roll(self, roll_id, variant_id, *, family_id="fam-1", grade_id=None, thickness=12, width=1000, stage_index=1, current_step_index=1, stock_form="OPEN_WEB", meta=None):
        family = SimpleNamespace(id=family_id)
        material = SimpleNamespace(id=variant_id, parent_family_id=family_id, parent_family=family, name=f"Variant {variant_id}")
        return SimpleNamespace(
            id=roll_id,
            label_id=f"ROLL-{roll_id}",
            material_id=variant_id,
            material=material,
            grade_id=grade_id,
            grade=SimpleNamespace(id=grade_id, name=f"Grade {grade_id}") if grade_id else None,
            thickness_micron=thickness,
            width_mm=width,
            stock_form=stock_form,
            stage_index=stage_index,
            current_step_index=current_step_index,
            completed_step_index=current_step_index,
            meta_json=meta or {},
        )

    @patch.object(ExecutionService, "_job_geometry_snapshot", return_value={"base": {"width_mm": 1000}})
    @patch.object(ExecutionService, "_resolve_step_roll_spec", return_value={"input_roll_count": 3})
    def test_three_roll_combine_requires_distinct_slot_coverage(self, _spec, _geometry):
        process = SimpleNamespace(input_form="ROLL", output_form="ROLL", roll_behavior="MULTI_INPUT_COMBINE")
        sales_order_item = SimpleNamespace(
            layer_snapshot=[
                {"variant_id": "v1", "thickness_micron": 12, "roll_width_mm": 1000},
                {"variant_id": "v2", "thickness_micron": 15, "roll_width_mm": 1000},
                {"variant_id": "v3", "thickness_micron": 20, "roll_width_mm": 1000},
            ]
        )
        job = self._job(process, sales_order_item=sales_order_item)

        invalid_summary = ExecutionService._summarize_roll_assignment_validation(
            job,
            process,
            [
                self._roll("1", "v1", thickness=12),
                self._roll("2", "v1", thickness=12),
                self._roll("3", "v1", thickness=12),
            ],
            allow_input_stock_fallback=True,
        )
        self.assertFalse(invalid_summary["slot_satisfied"])
        self.assertEqual(len(invalid_summary["matched_target_slots"]), 1)
        self.assertEqual(len(invalid_summary["unmatched_target_slots"]), 2)

        valid_summary = ExecutionService._summarize_roll_assignment_validation(
            job,
            process,
            [
                self._roll("1", "v1", thickness=12),
                self._roll("2", "v2", thickness=15),
                self._roll("3", "v3", thickness=20),
            ],
            allow_input_stock_fallback=True,
        )
        self.assertTrue(valid_summary["slot_satisfied"])
        self.assertTrue(valid_summary["is_complete"])
        self.assertEqual(len(valid_summary["matched_target_slots"]), 3)
        self.assertEqual(len(valid_summary["unmatched_target_slots"]), 0)

    @patch.object(ExecutionService, "_job_geometry_snapshot", return_value={"base": {"width_mm": 1000}})
    @patch.object(
        ExecutionService,
        "_resolve_step_roll_spec",
        return_value={
            "input_roll_count": 2,
            "combine_mode": "LANE_GROUPS",
            "input_lane_count": 2,
            "lamination_pass_index": 1,
            "active_min_layer_count": 2,
        },
    )
    def test_lane_group_lamination_allows_many_physical_rolls_per_lane(self, _spec, _geometry):
        process = SimpleNamespace(input_form="ROLL", output_form="ROLL", roll_behavior="MULTI_INPUT_COMBINE")
        sales_order_item = SimpleNamespace(
            layer_snapshot=[
                {"variant_id": "v1", "thickness_micron": 12, "roll_width_mm": 1000},
                {"variant_id": "v2", "thickness_micron": 15, "roll_width_mm": 1000},
                {"variant_id": "v3", "thickness_micron": 20, "roll_width_mm": 1000},
            ]
        )
        job = self._job(process, current_step_index=1, sales_order_item=sales_order_item)

        summary = ExecutionService._summarize_roll_assignment_validation(
            job,
            process,
            [
                self._roll("a1", "v1", thickness=12),
                self._roll("a2", "v1", thickness=12),
                self._roll("a3", "v1", thickness=12),
                self._roll("a4", "v1", thickness=12),
                self._roll("a5", "v1", thickness=12),
                self._roll("b1", "v2", thickness=15),
            ],
            allow_input_stock_fallback=True,
        )

        self.assertTrue(summary["slot_satisfied"])
        self.assertTrue(summary["is_complete"])
        self.assertEqual(summary["required_rolls"], 2)
        self.assertEqual(summary["input_lane_count"], 2)
        self.assertEqual(len(summary["lane_groups"]), 2)
        self.assertEqual(len(summary["lane_groups"][0]["rolls"]), 5)
        self.assertEqual(len(summary["lane_groups"][1]["rolls"]), 1)

    @patch.object(ExecutionService, "_job_geometry_snapshot", return_value={"base": {"width_mm": 1000}})
    @patch.object(
        ExecutionService,
        "_resolve_step_roll_spec",
        return_value={
            "input_roll_count": 2,
            "combine_mode": "LANE_GROUPS",
            "input_lane_count": 2,
            "lamination_pass_index": 2,
            "active_min_layer_count": 3,
        },
    )
    def test_second_lamination_pass_uses_prior_laminate_plus_next_layer(self, _spec, _geometry):
        process = SimpleNamespace(input_form="ROLL", output_form="ROLL", roll_behavior="MULTI_INPUT_COMBINE")
        sales_order_item = SimpleNamespace(
            layer_snapshot=[
                {"variant_id": "v1", "thickness_micron": 12, "roll_width_mm": 1000},
                {"variant_id": "v2", "thickness_micron": 15, "roll_width_mm": 1000},
                {"variant_id": "v3", "thickness_micron": 20, "roll_width_mm": 1000},
            ]
        )
        job = self._job(process, current_step_index=2, sales_order_item=sales_order_item)

        summary = ExecutionService._summarize_roll_assignment_validation(
            job,
            process,
            [
                self._roll(
                    "lam-1",
                    "laminate-v12",
                    thickness=27,
                    stage_index=1,
                    current_step_index=1,
                    meta={"roll_role": "OUTPUT", "source_behavior": "MULTI_INPUT_COMBINE"},
                ),
                self._roll("c1", "v3", thickness=20, stage_index=0, current_step_index=0),
            ],
            allow_input_stock_fallback=True,
        )

        self.assertTrue(summary["slot_satisfied"])
        self.assertTrue(summary["is_complete"])
        self.assertEqual(summary["lane_groups"][0]["source_role"], "LAMINATED_WIP")
        self.assertEqual(summary["lane_groups"][1]["layer_index"], 3)

    def test_downstream_raw_roll_is_only_compatible_in_fallback_mode(self):
        process = SimpleNamespace(input_form="ROLL", output_form="ROLL", roll_behavior="MODIFY_EXISTING")
        job = self._job(process)
        raw_roll = self._roll(
            "raw-1",
            "v1",
            thickness=12,
            width=1000,
            stage_index=0,
            current_step_index=0,
            meta={"roll_role": "RAW_MATERIAL"},
        )
        target_specs = [{"variant_id": "v1", "thickness_micron": 12, "min_width_mm": 1000}]

        self.assertFalse(
            ExecutionService._is_roll_step_compatible(
                job,
                process,
                raw_roll,
                target_specs,
                allow_input_stock_fallback=False,
            )
        )
        self.assertTrue(
            ExecutionService._is_roll_step_compatible(
                job,
                process,
                raw_roll,
                target_specs,
                allow_input_stock_fallback=True,
            )
        )

    def test_roll_input_jobs_allow_fallback_discovery_but_not_auto_pick(self):
        roll_to_roll = SimpleNamespace(input_form="ROLL", output_form="ROLL", roll_behavior="MODIFY_EXISTING")
        packaging_roll_to_bulk = SimpleNamespace(input_form="ROLL", output_form="BULK", roll_behavior="NONE")

        roll_job = self._job(roll_to_roll, stock_purpose="PRODUCT", quantity_uom="KG")
        packaging_job = self._job(packaging_roll_to_bulk, stock_purpose="PACKAGING", quantity_uom="PCS")

        self.assertTrue(ExecutionService._allow_non_lineage_roll_discovery(roll_job, roll_to_roll))
        self.assertFalse(ExecutionService._allow_non_lineage_roll_auto_pick(roll_job, roll_to_roll))
        self.assertTrue(ExecutionService._allow_non_lineage_roll_discovery(packaging_job, packaging_roll_to_bulk))
        self.assertTrue(ExecutionService._allow_non_lineage_roll_auto_pick(packaging_job, packaging_roll_to_bulk))

    def test_wcm_roll_picker_requires_exact_grade_thickness_and_auto_width_window(self):
        process = SimpleNamespace(input_form="ROLL", output_form="ROLL", roll_behavior="MODIFY_EXISTING")
        job = self._job(process, current_step_index=0)
        target_specs = [
            {
                "variant_id": "ldnat-ml",
                "grade_id": "g-metallocene",
                "thickness_micron": 65,
                "stock_form": "OPEN_WEB",
                "min_width_mm": 640,
                "max_auto_width_mm": 704,
            }
        ]

        exact = self._roll(
            "exact",
            "ldnat-ml",
            grade_id="g-metallocene",
            thickness=65,
            width=640,
            stock_form="OPEN_WEB",
            stage_index=0,
            current_step_index=0,
        )
        wrong_thickness = self._roll(
            "wrong-thickness",
            "ldnat-ml",
            grade_id="g-metallocene",
            thickness=55,
            width=640,
            stock_form="OPEN_WEB",
            stage_index=0,
            current_step_index=0,
        )
        wrong_grade = self._roll(
            "wrong-grade",
            "ldnat-ml",
            grade_id="g-natural",
            thickness=65,
            width=640,
            stock_form="OPEN_WEB",
            stage_index=0,
            current_step_index=0,
        )
        too_narrow = self._roll(
            "too-narrow",
            "ldnat-ml",
            grade_id="g-metallocene",
            thickness=65,
            width=600,
            stock_form="OPEN_WEB",
            stage_index=0,
            current_step_index=0,
        )
        too_wide_for_auto = self._roll(
            "too-wide",
            "ldnat-ml",
            grade_id="g-metallocene",
            thickness=65,
            width=765,
            stock_form="OPEN_WEB",
            stage_index=0,
            current_step_index=0,
        )

        self.assertTrue(ExecutionService._is_roll_step_compatible(job, process, exact, target_specs))
        self.assertFalse(ExecutionService._is_roll_step_compatible(job, process, wrong_thickness, target_specs))
        self.assertFalse(ExecutionService._is_roll_step_compatible(job, process, wrong_grade, target_specs))
        self.assertFalse(ExecutionService._is_roll_step_compatible(job, process, too_narrow, target_specs))
        self.assertFalse(
            ExecutionService._roll_matches_target_specs(
                too_wide_for_auto,
                target_specs,
                enforce_auto_width_window=True,
            )
        )
        self.assertTrue(
            ExecutionService._roll_matches_target_specs(
                too_wide_for_auto,
                target_specs,
                enforce_auto_width_window=False,
            )
        )

    def test_wcm_roll_picker_does_not_auto_match_when_target_specs_are_missing(self):
        process = SimpleNamespace(input_form="ROLL", output_form="ROLL", roll_behavior="MODIFY_EXISTING")
        job = self._job(process, current_step_index=0)
        roll = self._roll(
            "unknown",
            "ldnat-ml",
            grade_id="g-metallocene",
            thickness=65,
            width=640,
            stock_form="OPEN_WEB",
            stage_index=0,
            current_step_index=0,
        )

        self.assertFalse(ExecutionService._is_roll_step_compatible(job, process, roll, []))
