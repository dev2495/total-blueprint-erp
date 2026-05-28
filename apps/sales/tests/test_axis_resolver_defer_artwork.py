from types import SimpleNamespace

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
