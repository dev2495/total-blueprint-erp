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


class MRPBomDemandExplosionTests(SimpleTestCase):
    @patch("apps.mrp.services.MRPService._add_to_demand")
    def test_count_only_packaging_and_addons_do_not_become_kg_demand(self, mock_add_to_demand):
        bom = {
            "packaging": [
                {"material_id": "bag-count-only", "qty": 25000},
                {"material_id": "carton-weighted", "qty": 50, "weight_kg": "12.5"},
            ],
            "addons": [
                {"material_id": "sticker-count-only", "qty": 1000},
                {"material_id": "zipper-weighted", "qty": 1000, "weight_kg": "4.25"},
            ],
        }

        MRPService._aggregate_bom_into_map(bom, {}, Decimal("2"))

        calls = [(args[0], args[1]) for args, _kwargs in mock_add_to_demand.call_args_list]
        self.assertEqual(calls, [
            ("carton-weighted", Decimal("25.0")),
            ("zipper-weighted", Decimal("8.50")),
        ])

    @patch("apps.mrp.services.MRPService._add_to_demand")
    def test_materialized_packaging_stock_qty_is_not_scaled_again(self, mock_add_to_demand):
        bom = {
            "packaging": [
                {
                    "material_id": "pp-bag",
                    "qty": 250,
                    "count_qty": 250,
                    "stock_qty": "2.125",
                    "stock_uom": "KG",
                    "weight_kg": "2.125",
                    "qty_source": "ORDER_QUANTITY",
                },
            ],
        }

        MRPService._aggregate_bom_into_map(bom, {}, Decimal("25000"))

        mock_add_to_demand.assert_called_once_with("pp-bag", Decimal("2.125"), {})

    @patch("apps.mrp.services.MRPService._add_to_demand")
    def test_materialized_packaging_count_uses_unit_base_qty(self, mock_add_to_demand):
        bom = {
            "packaging": [
                {
                    "material_id": "pp-bag",
                    "count_qty": 250,
                    "unit_base_qty": "0.0085",
                    "stock_uom": "KG",
                },
            ],
        }

        MRPService._aggregate_bom_into_map(bom, {}, Decimal("25000"))

        mock_add_to_demand.assert_called_once_with("pp-bag", Decimal("2.1250"), {})
