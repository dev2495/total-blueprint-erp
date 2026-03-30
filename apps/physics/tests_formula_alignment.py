from decimal import Decimal

from django.test import SimpleTestCase

from apps.physics.services_physics import PhysicsEngine
from apps.physics.spec_signature import (
    build_invariant_payload,
    build_invariant_signature,
    build_spec_payload,
    build_spec_signature,
)


class FormulaAlignmentTests(SimpleTestCase):
    def test_multilayer_pouch_weight_matches_gsm_area_formula(self):
        payload = {
            "finished_good_type": "POUCH",
            "order_qty": 1000,
            "uom": "PCS",
            "geometry": {
                "base": {"width_mm": 200, "height_mm": 300},
                "multipliers": {"faces": 2},
            },
            "film_layers": [
                {"thickness_micron": 12, "density_g_cm3": 1.4},
                {"thickness_micron": 50, "density_g_cm3": 0.92},
            ],
            "printing": {
                "enabled": True,
                "front_colors_count": 4,
                "ink_gsm_total": 2.0,
            },
            "chemicals": {
                "adhesive_gsm": 2.5,
                "solvent_gsm": 1.0,
            },
            "addons": [],
        }

        result = PhysicsEngine.calculate(payload)

        area_m2_per_piece = Decimal("0.12")
        total_qty = Decimal("1000")
        film_gsm = Decimal("12") * Decimal("1.4") + Decimal("50") * Decimal("0.92")
        total_film_weight_g = area_m2_per_piece * film_gsm * total_qty
        total_ink_weight_g = area_m2_per_piece * Decimal("2.0") * total_qty
        total_chem_weight_g = area_m2_per_piece * Decimal("3.5") * total_qty
        expected_total_weight_g = total_film_weight_g + total_ink_weight_g + total_chem_weight_g

        self.assertEqual(Decimal(str(result["total_film_weight"])), total_film_weight_g)
        self.assertEqual(Decimal(str(result["total_ink_weight"])), total_ink_weight_g)
        self.assertEqual(Decimal(str(result["total_chem_weight"])), total_chem_weight_g)
        self.assertEqual(Decimal(str(result["total_weight_g"])), expected_total_weight_g)
        self.assertEqual(Decimal(str(result["unit_weight_g"])), expected_total_weight_g / total_qty)

    def test_pouch_style_changes_spec_signature_but_not_invariant_signature(self):
        layers = [
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
            film_layers=layers,
            printing={"enabled": True, "front_colors_count": 4},
            addons=[],
            geometry={"width_mm": 180, "height_mm": 260, "gusset_mm": 35, "pouch_style": "STAND_UP"},
        )
        spec_b = build_spec_payload(
            fg_type="POUCH",
            roll_form="CENTER_SEAL",
            film_layers=layers,
            printing={"enabled": True, "front_colors_count": 4},
            addons=[],
            geometry={"width_mm": 180, "height_mm": 260, "gusset_mm": 35, "pouch_style": "QUAD_SEAL"},
        )
        invariant_a = build_invariant_signature(
            build_invariant_payload(
                film_layers=layers,
                printing={"enabled": True, "front_colors_count": 4},
            )
        )
        invariant_b = build_invariant_signature(
            build_invariant_payload(
                film_layers=layers,
                printing={"enabled": True, "front_colors_count": 4},
            )
        )

        self.assertNotEqual(build_spec_signature(spec_a), build_spec_signature(spec_b))
        self.assertEqual(invariant_a, invariant_b)

    def test_pouch_addon_and_pod_weight_matches_geometry_adjusted_formula(self):
        payload = {
            "finished_good_type": "POUCH",
            "order_qty": 500,
            "uom": "PCS",
            "geometry": {
                "base": {"width_mm": 180, "height_mm": 240},
                "gusset_mm": 35,
                "trim_loss_mm": 4,
                "adjustments": [
                    {"name": "Seal loss", "value": 6, "impact": "HEIGHT"},
                ],
                "multipliers": {"faces": 2},
                "pouch_style": "SPOUT",
            },
            "film_layers": [
                {"thickness_micron": 12, "density_g_cm3": 1.4},
                {"thickness_micron": 50, "density_g_cm3": 0.92},
            ],
            "printing": {"enabled": False},
            "chemicals": {"adhesive_gsm": 2.5},
            "addons": [
                {"name": "Top Spout", "weight_mode": "PER_PIECE", "weight_value": 1.5, "quantity": 1},
                {"name": "Zipper track", "weight_mode": "PER_MM", "weight_value": 0.002, "applies_to": "WIDTH", "quantity": 1},
            ],
            "packaging_snapshot": {
                "pod": {
                    "enabled": True,
                    "pod": {
                        "pod_type": "SINGLE",
                    },
                }
            },
            "pod_enabled": True,
            "pod_profile_id": "test-pod-profile",
        }

        from unittest.mock import patch

        class _PodProfile:
            id = "test-pod-profile"
            code = "POD-SINGLE"
            name = "POD SINGLE"
            pod_type = "SINGLE"
            pod_fixed_height_mm = Decimal("160")
            pod_thickness_micron = Decimal("30")
            pod_panel_count = 1
            density_gcm3 = Decimal("0.92")

        with patch("apps.materials.models.InventoryMaterial.objects.filter") as filter_mock:
            filter_mock.return_value.only.return_value.first.return_value = _PodProfile()
            result = PhysicsEngine.calculate(payload)

        area_m2_per_piece = Decimal("0.219") * Decimal("0.246") * Decimal("2")
        total_qty = Decimal("500")
        film_gsm = Decimal("12") * Decimal("1.4") + Decimal("50") * Decimal("0.92")
        expected_film = area_m2_per_piece * film_gsm * total_qty
        expected_chem = area_m2_per_piece * Decimal("2.5") * total_qty
        expected_addons = (Decimal("1.5") + (Decimal("0.002") * Decimal("219"))) * total_qty
        expected_pod_kg = (
            (Decimal("0.219") * Decimal("0.16") * Decimal("1"))
            * (Decimal("30") / Decimal("1000000"))
            * (Decimal("0.92") * Decimal("1000"))
            * total_qty
        )
        expected_total_g = expected_film + expected_chem + expected_addons + (expected_pod_kg * Decimal("1000"))

        self.assertEqual(Decimal(str(result["total_film_weight"])), expected_film)
        self.assertEqual(Decimal(str(result["total_chem_weight"])), expected_chem)
        self.assertEqual(Decimal(str(result["total_addon_weight"])), expected_addons)
        self.assertEqual(Decimal(str(result["total_weight_g"])), expected_total_g)
