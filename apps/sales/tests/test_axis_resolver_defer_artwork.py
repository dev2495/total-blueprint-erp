from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from apps.sales.services.axis_resolver import _printing_from_payload


class AxisResolverDeferArtworkTests(SimpleTestCase):
    def test_nested_defer_flag_keeps_printing_enabled_for_planner_gate(self):
        master = SimpleNamespace(
            fixed_attributes={
                "print_capable": True,
                "artwork_required": False,
                "print_type": "ROTO",
                "film_type": "SHEET",
                "default_front_colors": 2,
            },
            layer_template=[],
            canonical_layer_stack=[],
        )

        printing = _printing_from_payload(
            {
                "printing": {
                    "enabled": True,
                    "defer_artwork_to_planner": True,
                    "print_type": "ROTO",
                    "film_type": "SHEET",
                }
            },
            master=master,
            overlay=None,
        )

        self.assertTrue(printing["defer_artwork_to_planner"])
        self.assertTrue(printing["enabled"])
        self.assertEqual(printing["front_colors_count"], 2)
        self.assertEqual(printing["ink_gsm_total"], 0.0)

    @patch("apps.sales.services.axis_resolver.Artwork.objects.filter")
    def test_defer_flag_ignores_overlay_default_artwork(self, mock_filter):
        master = SimpleNamespace(
            fixed_attributes={
                "print_capable": True,
                "artwork_required": True,
                "print_type": "FLEXO",
                "film_type": "SHEET",
                "default_front_colors": 2,
            },
            layer_template=[],
            canonical_layer_stack=[],
        )
        overlay = SimpleNamespace(default_artwork_id="overlay-default-artwork")

        printing = _printing_from_payload(
            {
                "printing": {
                    "enabled": True,
                    "defer_artwork_to_planner": True,
                    "print_type": "FLEXO",
                    "film_type": "SHEET",
                }
            },
            master=master,
            overlay=overlay,
        )

        self.assertTrue(printing["defer_artwork_to_planner"])
        self.assertTrue(printing["enabled"])
        self.assertFalse(printing.get("artwork_id"))
        self.assertEqual(printing["front_colors_count"], 2)
        mock_filter.assert_not_called()
