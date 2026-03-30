from django.test import SimpleTestCase

from apps.physics.spec_signature import build_invariant_payload, build_invariant_signature, build_spec_payload, build_spec_signature


class InvariantReuseSignatureTests(SimpleTestCase):
    def test_invariant_signature_stays_stable_across_geometry_variants(self):
        layer_snapshot = [
            {
                "family_id": "family-1",
                "variant_id": "variant-1",
                "thickness_micron": 50,
                "density_g_cm3": 0.92,
                "roll_width_mm": 420,
            }
        ]
        printing_snapshot = {"enabled": False}
        geometries = [
            {"base": {"width_mm": 200, "height_mm": 300}, "multipliers": {"faces": 1}, "finished_good_type": "POUCH"},
            {"base": {"width_mm": 240, "height_mm": 360}, "multipliers": {"faces": 1}, "finished_good_type": "POUCH"},
            {"base": {"width_mm": 210, "height_mm": 330}, "multipliers": {"faces": 1}, "finished_good_type": "POUCH"},
        ]

        spec_signatures = {
            build_spec_signature(
                build_spec_payload(
                    fg_type="POUCH",
                    roll_form=None,
                    geometry=geometry,
                    film_layers=layer_snapshot,
                    printing=printing_snapshot,
                    addons=[],
                )
            )
            for geometry in geometries
        }
        invariant_signatures = {
            build_invariant_signature(
                build_invariant_payload(
                    film_layers=layer_snapshot,
                    printing=printing_snapshot,
                )
            )
            for _geometry in geometries
        }

        self.assertEqual(len(spec_signatures), len(geometries))
        self.assertEqual(len(invariant_signatures), 1)
