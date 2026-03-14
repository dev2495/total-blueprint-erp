from django.test import SimpleTestCase

from apps.physics.spec_signature import (
    build_invariant_payload,
    build_invariant_signature,
    build_spec_payload,
    build_spec_signature,
)


class InvariantSignatureTests(SimpleTestCase):
    def test_invariant_signature_changes_with_layer_width(self):
        base_layers = [
            {
                "family_id": "fam-1",
                "variant_id": "var-1",
                "thickness_micron": 40,
                "roll_width_mm": 1200,
            }
        ]
        changed_width_layers = [
            {
                "family_id": "fam-1",
                "variant_id": "var-1",
                "thickness_micron": 40,
                "roll_width_mm": 1400,
            }
        ]

        sig_a = build_invariant_signature(
            build_invariant_payload(film_layers=base_layers, printing={"enabled": False})
        )
        sig_b = build_invariant_signature(
            build_invariant_payload(film_layers=changed_width_layers, printing={"enabled": False})
        )

        self.assertNotEqual(sig_a, sig_b)

    def test_invariant_signature_stays_stable_when_only_downstream_pouch_geometry_changes(self):
        base_layers = [
            {
                "family_id": "fam-1",
                "variant_id": "var-1",
                "grade_id": "g-1",
                "thickness_micron": 40,
                "density_g_cm3": 0.92,
                "roll_width_mm": 1200,
            }
        ]

        spec_a = build_spec_payload(
            fg_type="POUCH",
            roll_form="CENTER_SEAL",
            film_layers=base_layers,
            printing={"enabled": True, "front_colors_count": 4},
            addons=[],
            geometry={"width_mm": 180, "height_mm": 240, "gusset_mm": 20},
        )
        spec_b = build_spec_payload(
            fg_type="POUCH",
            roll_form="CENTER_SEAL",
            film_layers=base_layers,
            printing={"enabled": True, "front_colors_count": 4},
            addons=[],
            geometry={"width_mm": 220, "height_mm": 320, "gusset_mm": 35},
        )

        invariant_a = build_invariant_signature(
            build_invariant_payload(
                film_layers=base_layers,
                printing={"enabled": True, "front_colors_count": 4},
            )
        )
        invariant_b = build_invariant_signature(
            build_invariant_payload(
                film_layers=base_layers,
                printing={"enabled": True, "front_colors_count": 4},
            )
        )

        self.assertNotEqual(build_spec_signature(spec_a), build_spec_signature(spec_b))
        self.assertEqual(invariant_a, invariant_b)
