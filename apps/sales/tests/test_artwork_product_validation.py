"""
Unit tests for ART-3: artwork compatibility at confirm.

Mirrors the SimpleNamespace-mocking style of test_printing_snapshot_contract.py
so we don't depend on full DB setup.
"""
from types import SimpleNamespace
from unittest.mock import patch

from django.core.exceptions import ValidationError
from django.test import SimpleTestCase

from apps.sales.services.order_service import _validate_printing_snapshot_for_confirm


def _printing_payload(artwork_id="art-1"):
    return {
        "enabled": True,
        "type": "FLEXO",
        "substrate_mode": "SHEET",
        "front_colors_count": 1,
        "back_colors_count": 0,
        "ink_gsm_total": 1.2,
        "artwork_id": artwork_id,
    }


def _item(*, product_master_id, printing_snapshot):
    return SimpleNamespace(
        template=SimpleNamespace(name="Test Template"),
        layer_snapshot=[{"density_g_cm3": 0.92}],
        printing_snapshot=printing_snapshot,
        product_master_id=product_master_id,
    )


def _approved_artwork(*, product_master_id):
    return SimpleNamespace(
        id="art-1",
        status="APPROVED",
        design_code="ART-1",
        print_type="FLEXO",
        substrate_mode="SHEET",
        file_path="/tmp/art-1.pdf",
        image=None,
        front_colors=["CYAN"],
        back_colors=[],
        front_colors_count=1,
        back_colors_count=0,
        product_master_id=product_master_id,
        ink_gsm_total=1.2,
        ink_gsm_split_mode="EQUAL",
        ink_gsm_color_percentages={},
        ink_gsm_by_color={"CYAN": 1.2},
        color_mapping={"CYAN": {"POLY": "ink-poly-cyan", "PET": "ink-pet-cyan"}},
    )


class ArtworkCompatibilityTests(SimpleTestCase):
    @patch("apps.sales.services.order_service.validate_frozen_printing_snapshot")
    @patch("apps.sales.services.order_service.resolve_ink_contract")
    @patch("apps.sales.services.order_service.Artwork.objects.filter")
    def test_confirm_allows_artwork_bound_to_other_product_master_when_print_form_match(
        self,
        mock_filter,
        mock_resolve_ink_contract,
        mock_validate_frozen,
    ):
        mock_filter.return_value.first.return_value = _approved_artwork(product_master_id="pm-A")
        mock_resolve_ink_contract.return_value = {
            "color_names": ["CYAN"],
            "color_mapping": {"CYAN": "ink-poly-cyan"},
            "ink_base_family": "POLY",
        }
        mock_validate_frozen.side_effect = lambda printing, **kwargs: printing

        item = _item(product_master_id="pm-B", printing_snapshot=_printing_payload())

        printing, required, artwork_id = _validate_printing_snapshot_for_confirm(
            item, allow_missing_artwork=False
        )

        self.assertFalse(required)
        self.assertEqual(artwork_id, "art-1")
        self.assertEqual(printing["artwork_id"], "art-1")
        self.assertEqual(printing["ink_gsm_total"], 1.2)

    @patch("apps.sales.services.order_service.Artwork.objects.filter")
    def test_confirm_rejects_artwork_print_type_mismatch(self, mock_filter):
        artwork = _approved_artwork(product_master_id="pm-A")
        artwork.print_type = "ROTO"
        mock_filter.return_value.first.return_value = artwork

        item = _item(product_master_id="pm-B", printing_snapshot=_printing_payload())

        with self.assertRaises(ValidationError) as exc:
            _validate_printing_snapshot_for_confirm(item, allow_missing_artwork=False)

        message = str(exc.exception).lower()
        self.assertIn("print type", message)

    @patch("apps.sales.services.order_service.Artwork.objects.filter")
    def test_confirm_rejects_artwork_sheet_tube_mismatch(self, mock_filter):
        artwork = _approved_artwork(product_master_id="pm-A")
        artwork.substrate_mode = "TUBING"
        mock_filter.return_value.first.return_value = artwork

        item = _item(product_master_id="pm-B", printing_snapshot=_printing_payload())

        with self.assertRaises(ValidationError) as exc:
            _validate_printing_snapshot_for_confirm(item, allow_missing_artwork=False)

        message = str(exc.exception).lower()
        self.assertIn("film type", message)

    @patch("apps.sales.services.order_service.validate_frozen_printing_snapshot")
    @patch("apps.sales.services.order_service.resolve_ink_contract")
    @patch("apps.sales.services.order_service.get_artwork_contract")
    @patch("apps.sales.services.order_service.Artwork.objects.filter")
    def test_confirm_allows_artwork_bound_to_same_product_master(
        self,
        mock_filter,
        mock_get_contract,
        mock_resolve_ink_contract,
        mock_validate_frozen,
    ):
        mock_filter.return_value.first.return_value = _approved_artwork(product_master_id="pm-A")
        mock_get_contract.return_value = {
            "print_type": "FLEXO",
            "substrate_mode": "SHEET",
            "front_colors": ["CYAN"],
            "back_colors": [],
            "front_colors_count": 1,
            "back_colors_count": 0,
            "color_names": ["CYAN"],
            "ink_gsm_total": 1.2,
            "ink_gsm_split_mode": "EQUAL",
            "ink_gsm_color_percentages": {},
            "ink_gsm_by_color": {"CYAN": 1.2},
        }
        mock_resolve_ink_contract.return_value = {
            "color_names": ["CYAN"],
            "color_mapping": {"CYAN": "ink-1"},
            "ink_base_family": "WB",
        }
        mock_validate_frozen.side_effect = lambda printing, **kwargs: printing

        item = _item(product_master_id="pm-A", printing_snapshot=_printing_payload())

        printing, required, artwork_id = _validate_printing_snapshot_for_confirm(
            item, allow_missing_artwork=False
        )
        call_kwargs = mock_resolve_ink_contract.call_args.kwargs
        self.assertEqual(
            call_kwargs["existing_mapping"],
            {"CYAN": {"POLY": "ink-poly-cyan", "PET": "ink-pet-cyan"}},
        )
        self.assertFalse(required)
        self.assertEqual(artwork_id, "art-1")
        self.assertEqual(printing["artwork_id"], "art-1")

    @patch("apps.sales.services.order_service.validate_frozen_printing_snapshot")
    @patch("apps.sales.services.order_service.resolve_ink_contract")
    @patch("apps.sales.services.order_service.get_artwork_contract")
    @patch("apps.sales.services.order_service.Artwork.objects.filter")
    def test_confirm_uses_artwork_inventory_ink_mapping_when_payload_has_none(
        self,
        mock_filter,
        mock_get_contract,
        mock_resolve_ink_contract,
        mock_validate_frozen,
    ):
        mock_filter.return_value.first.return_value = _approved_artwork(product_master_id="pm-A")
        mock_get_contract.return_value = {
            "print_type": "FLEXO",
            "substrate_mode": "SHEET",
            "front_colors": ["CYAN"],
            "back_colors": [],
            "front_colors_count": 1,
            "back_colors_count": 0,
            "color_names": ["CYAN"],
            "color_mapping": {"CYAN": {"POLY": "ink-poly-cyan", "PET": "ink-pet-cyan"}},
            "ink_gsm_total": 1.2,
            "ink_gsm_split_mode": "EQUAL",
            "ink_gsm_color_percentages": {},
            "ink_gsm_by_color": {"CYAN": 1.2},
        }
        mock_resolve_ink_contract.return_value = {
            "color_names": ["CYAN"],
            "color_mapping": {"CYAN": "ink-poly-cyan"},
            "ink_base_family": "POLY",
        }
        mock_validate_frozen.side_effect = lambda printing, **kwargs: printing

        item = _item(product_master_id="pm-A", printing_snapshot=_printing_payload())

        printing, required, artwork_id = _validate_printing_snapshot_for_confirm(item, allow_missing_artwork=False)

        self.assertFalse(required)
        self.assertEqual(artwork_id, "art-1")
        self.assertEqual(printing["color_mapping"], {"CYAN": "ink-poly-cyan"})
        self.assertEqual(
            mock_resolve_ink_contract.call_args.kwargs["existing_mapping"],
            {"CYAN": {"POLY": "ink-poly-cyan", "PET": "ink-pet-cyan"}},
        )

    @patch("apps.sales.services.order_service.validate_frozen_printing_snapshot")
    @patch("apps.sales.services.order_service.resolve_ink_contract")
    @patch("apps.sales.services.order_service.get_artwork_contract")
    @patch("apps.sales.services.order_service.Artwork.objects.filter")
    def test_confirm_allows_unbound_artwork(
        self,
        mock_filter,
        mock_get_contract,
        mock_resolve_ink_contract,
        mock_validate_frozen,
    ):
        # Artwork without a product_master FK ⇒ legacy / generic asset; allowed.
        mock_filter.return_value.first.return_value = _approved_artwork(product_master_id=None)
        mock_get_contract.return_value = {
            "print_type": "FLEXO",
            "substrate_mode": "SHEET",
            "front_colors": ["CYAN"],
            "back_colors": [],
            "front_colors_count": 1,
            "back_colors_count": 0,
            "color_names": ["CYAN"],
            "ink_gsm_total": 1.2,
            "ink_gsm_split_mode": "EQUAL",
            "ink_gsm_color_percentages": {},
            "ink_gsm_by_color": {"CYAN": 1.2},
        }
        mock_resolve_ink_contract.return_value = {
            "color_names": ["CYAN"],
            "color_mapping": {"CYAN": "ink-1"},
            "ink_base_family": "WB",
        }
        mock_validate_frozen.side_effect = lambda printing, **kwargs: printing

        item = _item(product_master_id="pm-A", printing_snapshot=_printing_payload())

        _, _, artwork_id = _validate_printing_snapshot_for_confirm(item, allow_missing_artwork=False)
        self.assertEqual(artwork_id, "art-1")
