from types import SimpleNamespace

from django.core.exceptions import ValidationError
from django.test import TestCase

from apps.production.services.stock_validator import validate_planner_stop_step


class PlannerStockValidatorTests(TestCase):
    def _template(self):
        return SimpleNamespace(
            routing_rule=SimpleNamespace(ordered_processes=["EXTRUSION", "PRINT", "POUCHING"])
        )

    def test_generic_stock_must_stop_before_first_artwork_step(self):
        result = validate_planner_stop_step(
            template=self._template(),
            stop_step_index=0,
            commitment_scope="GENERIC",
            committed_artwork=None,
            committed_customer=None,
        )

        self.assertEqual(result.first_artwork_step_index, 1)

        with self.assertRaises(ValidationError):
            validate_planner_stop_step(
                template=self._template(),
                stop_step_index=1,
                commitment_scope="GENERIC",
                committed_artwork=None,
                committed_customer=None,
            )

    def test_artwork_stock_requires_artwork_and_stops_at_or_after_artwork_step(self):
        with self.assertRaises(ValidationError):
            validate_planner_stop_step(
                template=self._template(),
                stop_step_index=0,
                commitment_scope="ARTWORK",
                committed_artwork="art-1",
                committed_customer=None,
            )

        result = validate_planner_stop_step(
            template=self._template(),
            stop_step_index=1,
            commitment_scope="ARTWORK",
            committed_artwork="art-1",
            committed_customer=None,
        )

        self.assertEqual(result.first_artwork_step_index, 1)

    def test_customer_artwork_scope_requires_both_commitments(self):
        with self.assertRaises(ValidationError):
            validate_planner_stop_step(
                template=self._template(),
                stop_step_index=2,
                commitment_scope="CUSTOMER_ARTWORK",
                committed_artwork="art-1",
                committed_customer=None,
            )
