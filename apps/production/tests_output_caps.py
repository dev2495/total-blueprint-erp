from decimal import Decimal
from types import SimpleNamespace

from django.test import SimpleTestCase

from apps.production.services.services_execution import ExecutionService


class OutputCapRulesTests(SimpleTestCase):
    def test_roll_step_cap_uses_input_when_lower_than_remaining(self):
        process = SimpleNamespace(input_form="ROLL")
        step_profile = {"step_remaining_kg": 46.1}
        input_rolls = [SimpleNamespace(weight_kg=45)]

        cap = ExecutionService._resolve_runtime_output_cap_kg(
            process,
            step_profile,
            input_rolls=input_rolls,
            scrap_qty=Decimal("0"),
        )

        self.assertEqual(cap["cap_source"], "STEP_AND_INPUT")
        self.assertEqual(cap["max_output_kg"], Decimal("45"))

    def test_roll_step_cap_reduces_by_scrap(self):
        process = SimpleNamespace(input_form="ROLL")
        step_profile = {"step_remaining_kg": 46.1}
        input_rolls = [SimpleNamespace(weight_kg=45)]

        cap = ExecutionService._resolve_runtime_output_cap_kg(
            process,
            step_profile,
            input_rolls=input_rolls,
            scrap_qty=Decimal("1"),
        )

        self.assertEqual(cap["max_output_kg"], Decimal("44"))

    def test_roll_step_cap_respects_step_remaining_when_lower(self):
        process = SimpleNamespace(input_form="ROLL")
        step_profile = {"step_remaining_kg": 30}
        input_rolls = [SimpleNamespace(weight_kg=45)]

        cap = ExecutionService._resolve_runtime_output_cap_kg(
            process,
            step_profile,
            input_rolls=input_rolls,
            scrap_qty=Decimal("0"),
        )

        self.assertEqual(cap["max_output_kg"], Decimal("30"))

    def test_roll_step_uses_input_only_when_step_remaining_unavailable(self):
        process = SimpleNamespace(input_form="ROLL")
        step_profile = {"step_remaining_kg": 0}
        input_rolls = [SimpleNamespace(weight_kg=45)]

        cap = ExecutionService._resolve_runtime_output_cap_kg(
            process,
            step_profile,
            input_rolls=input_rolls,
            scrap_qty=Decimal("0"),
        )

        self.assertEqual(cap["cap_source"], "INPUT_ONLY")
        self.assertEqual(cap["max_output_kg"], Decimal("45"))

    def test_bulk_step_cap_uses_step_remaining(self):
        process = SimpleNamespace(input_form="BULK")
        step_profile = {"step_remaining_kg": 18.5}

        cap = ExecutionService._resolve_runtime_output_cap_kg(
            process,
            step_profile,
            input_rolls=[],
            scrap_qty=Decimal("0"),
        )

        self.assertEqual(cap["cap_source"], "STEP_ONLY")
        self.assertEqual(cap["max_output_kg"], Decimal("18.5"))
