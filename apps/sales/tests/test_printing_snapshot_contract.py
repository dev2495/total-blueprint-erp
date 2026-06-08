from types import SimpleNamespace
from unittest.mock import patch

from django.core.exceptions import ValidationError
from django.test import SimpleTestCase

from apps.sales.services.order_service import _validate_printing_snapshot_for_confirm


def _item(printing_snapshot, *, layer_snapshot=None):
    return SimpleNamespace(
        template=SimpleNamespace(name="Test Template"),
        layer_snapshot=layer_snapshot or [{"density_g_cm3": 0.92}],
        printing_snapshot=printing_snapshot,
    )


class PrintingSnapshotContractTests(SimpleTestCase):
    def test_confirm_rejects_sheet_back_colors(self):
        item = _item(
            {
                "enabled": True,
                "type": "FLEXO",
                "substrate_mode": "SHEET",
                "front_colors_count": 1,
                "back_colors_count": 1,
                "ink_gsm_total": 1.2,
            }
        )

        with self.assertRaises(ValidationError) as exc:
            _validate_printing_snapshot_for_confirm(item, allow_missing_artwork=True)

        self.assertIn("sheet film supports front colors only", str(exc.exception).lower())

    @patch("apps.sales.services.order_service.Artwork.objects.filter")
    def test_confirm_rejects_stale_artwork_id(self, mock_filter):
        mock_filter.return_value.first.return_value = None
        item = _item(
            {
                "enabled": True,
                "type": "FLEXO",
                "substrate_mode": "SHEET",
                "front_colors_count": 1,
                "back_colors_count": 0,
                "ink_gsm_total": 1.2,
                "artwork_id": "missing-artwork-id",
            }
        )

        with self.assertRaises(ValidationError) as exc:
            _validate_printing_snapshot_for_confirm(item, allow_missing_artwork=False)

        self.assertIn("artwork_id is invalid", str(exc.exception))

    @patch("apps.sales.services.order_service.Artwork.objects.filter")
    def test_confirm_rejects_print_type_mismatch_against_artwork(self, mock_filter):
        mock_filter.return_value.first.return_value = SimpleNamespace(
            id="art-1",
            status="APPROVED",
            design_code="ART-1",
            print_type="FLEXO",
            file_path="/tmp/art-1.pdf",
            image=None,
            front_colors=["CYAN"],
            back_colors=[],
            front_colors_count=1,
            back_colors_count=0,
        )
        item = _item(
            {
                "enabled": True,
                "type": "ROTO",
                "substrate_mode": "SHEET",
                "front_colors_count": 1,
                "back_colors_count": 0,
                "ink_gsm_total": 1.2,
                "artwork_id": "art-1",
            }
        )

        with self.assertRaises(ValidationError) as exc:
            _validate_printing_snapshot_for_confirm(item, allow_missing_artwork=False)

        self.assertIn("does not match selected print type", str(exc.exception))

    @patch("apps.sales.services.order_service.resolve_ink_contract")
    @patch("apps.sales.services.order_service.Artwork.objects.filter")
    def test_confirm_rejects_unresolved_ink_mapping(self, mock_filter, mock_resolve_ink_contract):
        mock_filter.return_value.first.return_value = SimpleNamespace(
            id="art-2",
            status="APPROVED",
            design_code="ART-2",
            print_type="FLEXO",
            file_path="/tmp/art-2.pdf",
            image=None,
            front_colors=["RED"],
            back_colors=[],
            front_colors_count=1,
            back_colors_count=0,
        )
        mock_resolve_ink_contract.side_effect = ValidationError("missing POLY ink master mapping for colors: RED")
        item = _item(
            {
                "enabled": True,
                "type": "FLEXO",
                "substrate_mode": "SHEET",
                "front_colors_count": 1,
                "back_colors_count": 0,
                "ink_gsm_total": 1.2,
                "artwork_id": "art-2",
            }
        )

        with self.assertRaises(ValidationError) as exc:
            _validate_printing_snapshot_for_confirm(item, allow_missing_artwork=False)

        self.assertIn("missing POLY ink master mapping", str(exc.exception))

    @patch("apps.sales.services.order_service.Artwork.objects.filter")
    def test_confirm_rejects_nonzero_color_count_with_empty_side_list(self, mock_filter):
        mock_filter.return_value.first.return_value = SimpleNamespace(
            id="art-3",
            status="APPROVED",
            design_code="ART-3",
            print_type="FLEXO",
            file_path="/tmp/art-3.pdf",
            image=None,
            front_colors=[],
            back_colors=[],
            front_colors_count=1,
            back_colors_count=0,
        )
        item = _item(
            {
                "enabled": True,
                "type": "FLEXO",
                "substrate_mode": "SHEET",
                "front_colors_count": 1,
                "back_colors_count": 0,
                "ink_gsm_total": 1.2,
                "artwork_id": "art-3",
            }
        )

        with self.assertRaises(ValidationError) as exc:
            _validate_printing_snapshot_for_confirm(item, allow_missing_artwork=False)

        self.assertIn("front color list must exactly match", str(exc.exception).lower())

    def test_preview_mode_allows_placeholder_colors_until_artwork_is_assigned(self):
        item = _item(
            {
                "enabled": True,
                "type": "ROTO",
                "substrate_mode": "TUBING",
                "front_colors_count": 2,
                "back_colors_count": 1,
                "ink_gsm_total": 1.2,
            }
        )

        printing, artwork_required, assigned_artwork_id = _validate_printing_snapshot_for_confirm(
            item,
            allow_missing_artwork=True,
        )

        self.assertTrue(artwork_required)
        self.assertIsNone(assigned_artwork_id)
        self.assertEqual(printing["front_colors"], ["FRONT-1", "FRONT-2"])
        self.assertEqual(printing["back_colors"], ["BACK-1"])
        self.assertEqual(printing["color_names"], ["FRONT-1", "FRONT-2", "BACK-1"])
        self.assertEqual(printing["color_mapping"], {})

    @patch("apps.sales.services.order_service.Artwork.objects.filter")
    def test_explicit_defer_skips_product_master_default_artwork(self, mock_filter):
        item = _item(
            {
                "enabled": True,
                "type": "ROTO",
                "substrate_mode": "SHEET",
                "front_colors_count": 1,
                "back_colors_count": 0,
                "ink_gsm_total": 0,
                "artwork_id": None,
                "defer_artwork_to_planner": True,
            }
        )
        item.product_master_id = "pm-1"
        item.product_master = SimpleNamespace(
            fixed_attributes={
                "print_capable": True,
                "artwork_required": True,
                "default_artwork_id": "default-artwork",
                "default_front_colors": 1,
                "film_type": "SHEET",
            }
        )

        printing, artwork_required, assigned_artwork_id = _validate_printing_snapshot_for_confirm(
            item,
            allow_missing_artwork=True,
        )

        self.assertTrue(artwork_required)
        self.assertIsNone(assigned_artwork_id)
        self.assertFalse(printing.get("artwork_id"))
        self.assertEqual(printing["front_colors"], ["FRONT-1"])
        mock_filter.assert_not_called()
