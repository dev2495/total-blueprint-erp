from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from apps.mrp.services import MRPService


class MRPPodSuggestionTests(SimpleTestCase):
    @patch("apps.mrp.services.MRPService._get_available_stock", return_value=Decimal("0"))
    @patch("apps.mrp.services.MRPService._required_date_for_suggestion", return_value="2026-03-16")
    @patch("apps.mrp.services.MRPSuggestion.objects.create")
    def test_inhouse_pod_creates_mts_produce_suggestion(self, mock_create, _mock_required_date, _mock_available):
        plan = SimpleNamespace(purchase_value_est=Decimal("0"))
        material = SimpleNamespace(category="POD", pod_is_inhouse_produced=True, name="POD Inhouse")

        MRPService._generate_suggestions(plan, material, Decimal("125"), "plant-1")

        mock_create.assert_called_once()
        self.assertEqual(mock_create.call_args.kwargs["type"], "MTS_PRODUCE")
        self.assertEqual(plan.purchase_value_est, Decimal("0"))

    @patch("apps.mrp.services.MRPService._get_available_stock", return_value=Decimal("0"))
    @patch("apps.mrp.services.CostingService.get_material_rate", return_value=Decimal("12.5"))
    @patch("apps.mrp.services.MRPService._required_date_for_suggestion", return_value="2026-03-16")
    @patch("apps.mrp.services.MRPSuggestion.objects.create")
    def test_external_pod_stays_purchase_suggestion(self, mock_create, _mock_required_date, _mock_rate, _mock_available):
        plan = SimpleNamespace(purchase_value_est=Decimal("0"))
        material = SimpleNamespace(category="POD", pod_is_inhouse_produced=False, name="POD Buy")

        MRPService._generate_suggestions(plan, material, Decimal("20"), "plant-1")

        mock_create.assert_called_once()
        self.assertEqual(mock_create.call_args.kwargs["type"], "PURCHASE")
        self.assertEqual(plan.purchase_value_est, Decimal("250.0"))
