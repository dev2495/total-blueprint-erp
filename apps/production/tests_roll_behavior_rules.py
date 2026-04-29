from types import SimpleNamespace

from django.test import SimpleTestCase

from apps.production.services.services_execution import ExecutionService


class RequiredRollCountRulesTests(SimpleTestCase):
    def _job(self, process, **extra):
        payload = {"current_process": process, "process": process}
        payload.update(extra)
        return SimpleNamespace(**payload)

    def test_multi_input_combine_uses_step_spec_input_roll_count(self):
        process = SimpleNamespace(input_form="ROLL", roll_behavior="MULTI_INPUT_COMBINE")
        job = self._job(process)

        count = ExecutionService._required_roll_count(
            job,
            process=process,
            step_roll_spec={"input_roll_count": 3},
        )

        self.assertEqual(count, 3)

    def test_multi_input_combine_falls_back_to_two_when_missing_spec(self):
        process = SimpleNamespace(input_form="ROLL", roll_behavior="MULTI_INPUT_COMBINE")
        job = self._job(process)

        count = ExecutionService._required_roll_count(
            job,
            process=process,
            step_roll_spec={"input_roll_count": 0},
        )

        self.assertEqual(count, 2)

    def test_multi_input_combine_uses_layer_count_when_higher_than_spec(self):
        process = SimpleNamespace(input_form="ROLL", roll_behavior="MULTI_INPUT_COMBINE")
        sales_order_item = SimpleNamespace(
            layer_snapshot=[
                {"variant_id": "v1"},
                {"variant_id": "v2"},
                {"variant_id": "v3"},
            ]
        )
        job = self._job(process, sales_order_item=sales_order_item, template=None)

        count = ExecutionService._required_roll_count(
            job,
            process=process,
            step_roll_spec={"input_roll_count": 2},
        )

        self.assertEqual(count, 3)

    def test_roll_to_roll_none_requires_each_layer_when_layer_count_is_higher_than_spec(self):
        process = SimpleNamespace(input_form="ROLL", output_form="ROLL", roll_behavior="NONE")
        sales_order_item = SimpleNamespace(
            layer_snapshot=[
                {"variant_id": "v1"},
                {"variant_id": "v2"},
            ]
        )
        job = self._job(process, sales_order_item=sales_order_item, template=None)

        count = ExecutionService._required_roll_count(
            job,
            process=process,
            step_roll_spec={"input_roll_count": 1},
        )

        self.assertEqual(count, 2)

    def test_lane_group_lamination_requires_two_lanes_not_three_physical_rolls(self):
        process = SimpleNamespace(input_form="ROLL", roll_behavior="MULTI_INPUT_COMBINE")
        sales_order_item = SimpleNamespace(
            layer_snapshot=[
                {"variant_id": "v1"},
                {"variant_id": "v2"},
                {"variant_id": "v3"},
            ]
        )
        job = self._job(process, sales_order_item=sales_order_item, template=None)

        count = ExecutionService._required_roll_count(
            job,
            process=process,
            step_roll_spec={
                "input_roll_count": 2,
                "combine_mode": "LANE_GROUPS",
                "input_lane_count": 2,
            },
        )

        self.assertEqual(count, 2)

    def test_modify_existing_is_always_one(self):
        process = SimpleNamespace(input_form="ROLL", roll_behavior="MODIFY_EXISTING")
        job = self._job(process)

        count = ExecutionService._required_roll_count(
            job,
            process=process,
            step_roll_spec={"input_roll_count": 5},
        )

        self.assertEqual(count, 1)

    def test_bulk_create_new_requires_no_input_rolls(self):
        process = SimpleNamespace(input_form="BULK", roll_behavior="CREATE_NEW")
        job = self._job(process)

        count = ExecutionService._required_roll_count(
            job,
            process=process,
            step_roll_spec={"input_roll_count": 1},
        )

        self.assertEqual(count, 0)
