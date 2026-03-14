from decimal import Decimal

from django.test import SimpleTestCase, TestCase

from apps.materials.models import InventoryMaterial
from apps.physics.services_physics import PhysicsEngine
from apps.physics.spec_signature import (
    build_invariant_payload,
    build_invariant_signature,
    build_spec_payload,
    build_spec_signature,
)


class RollMathTests(SimpleTestCase):
    def test_roll_mass_invariants_drive_derived_area_and_length(self):
        result = PhysicsEngine.calculate(
            {
                "finished_good_type": "ROLL",
                "order_qty": 10,
                "uom": "KG",
                "geometry": {
                    "base": {"width_mm": 1000, "height_mm": 0},
                },
                "film_layers": [
                    {
                        "thickness_micron": 50,
                        "density_g_cm3": 0.92,
                        "width_mm": 1000,
                    }
                ],
                "printing": {"enabled": False},
                "addons": [],
                "chemicals": {},
            }
        )

        preview = result["roll_preview"]
        self.assertEqual(result["unit_weight_g"], 0.0)
        self.assertEqual(result["total_weight_kg"], 10.0)
        self.assertGreater(preview["derived_area_m2"], 0)
        self.assertGreater(preview["derived_length_m"], 0)
        self.assertEqual(preview["width_mm"], 1000.0)
        self.assertEqual(preview["thickness_micron"], 50.0)

    def test_roll_area_ignores_repeat_length_and_uses_mass_formula(self):
        base_payload = {
            "finished_good_type": "ROLL",
            "order_qty": 10,
            "uom": "KG",
            "film_layers": [
                {
                    "thickness_micron": 50,
                    "density_g_cm3": 0.92,
                    "width_mm": 1000,
                }
            ],
        }

        area_without_repeat = PhysicsEngine.calculate_total_area(
            {
                **base_payload,
                "geometry": {"base": {"width_mm": 1000, "height_mm": 0}},
            }
        )
        area_with_repeat = PhysicsEngine.calculate_total_area(
            {
                **base_payload,
                "geometry": {
                    "base": {"width_mm": 1000, "height_mm": 0},
                },
            }
        )

        expected = PhysicsEngine.roll_area_m2(
            Decimal("10"),
            Decimal("50") / Decimal("1000000"),
            Decimal("0.92") * Decimal("1000"),
        )
        self.assertEqual(area_without_repeat, expected)
        self.assertEqual(area_with_repeat, expected)

    def test_roll_signature_ignores_geometry_but_changes_with_width(self):
        base_kwargs = {
            "fg_type": "ROLL",
            "roll_form": "CENTER_SEAL",
            "printing": {"enabled": False},
            "addons": [],
        }

        spec_a = build_spec_payload(
            film_layers=[
                {
                    "family_id": "fam-1",
                    "variant_id": "var-1",
                    "grade_id": "g-1",
                    "thickness_micron": 50,
                    "density_g_cm3": 0.92,
                    "width_mm": 1000,
                }
            ],
            geometry={"width_mm": 1000},
            **base_kwargs,
        )
        spec_b = build_spec_payload(
            film_layers=[
                {
                    "family_id": "fam-1",
                    "variant_id": "var-1",
                    "grade_id": "g-1",
                    "thickness_micron": 50,
                    "density_g_cm3": 0.92,
                    "width_mm": 1000,
                }
            ],
            geometry={"width_mm": 1000},
            **base_kwargs,
        )
        spec_c = build_spec_payload(
            film_layers=[
                {
                    "family_id": "fam-1",
                    "variant_id": "var-1",
                    "grade_id": "g-1",
                    "thickness_micron": 50,
                    "density_g_cm3": 0.92,
                    "width_mm": 1200,
                }
            ],
            geometry={"width_mm": 1200},
            **base_kwargs,
        )

        invariant_a = build_invariant_payload(
            film_layers=[
                {
                    "family_id": "fam-1",
                    "variant_id": "var-1",
                    "grade_id": "g-1",
                    "thickness_micron": 50,
                    "density_g_cm3": 0.92,
                    "width_mm": 1000,
                }
            ],
            printing=base_kwargs["printing"],
        )
        invariant_b = build_invariant_payload(
            film_layers=[
                {
                    "family_id": "fam-1",
                    "variant_id": "var-1",
                    "grade_id": "g-1",
                    "thickness_micron": 50,
                    "density_g_cm3": 0.92,
                    "width_mm": 1000,
                }
            ],
            printing=base_kwargs["printing"],
        )

        self.assertEqual(build_spec_signature(spec_a), build_spec_signature(spec_b))
        self.assertNotEqual(build_spec_signature(spec_a), build_spec_signature(spec_c))
        self.assertEqual(build_invariant_signature(invariant_a), build_invariant_signature(invariant_b))


class PouchMathTests(TestCase):
    def test_pod_weight_increases_unit_weight_for_pouch_flows(self):
        pod_profile = InventoryMaterial.objects.create(
            code="POD-TEST-001",
            name="Test POD Film",
            category="POD",
            base_uom="KG",
            pod_type="DOUBLE",
            pod_fixed_height_mm=40,
            pod_thickness_micron=25,
            pod_panel_count=2,
            density_gcm3=0.91,
        )

        base_payload = {
            "finished_good_type": "POUCH",
            "order_qty": 1000,
            "uom": "PCS",
            "geometry": {"base": {"width_mm": 200, "height_mm": 300}},
            "film_layers": [
                {
                    "thickness_micron": 50,
                    "density_g_cm3": 0.92,
                    "width_mm": 200,
                }
            ],
            "printing": {"enabled": False},
            "addons": [],
            "chemicals": {},
        }

        without_pod = PhysicsEngine.calculate(base_payload)
        with_pod = PhysicsEngine.calculate(
            {
                **base_payload,
                "packaging_snapshot": {"pod": {"enabled": True, "pod_profile_id": str(pod_profile.id)}},
            }
        )

        self.assertGreater(with_pod["pod_unit_weight_g"], 0)
        self.assertGreater(with_pod["unit_weight_g"], without_pod["unit_weight_g"])
        self.assertGreater(with_pod["total_weight_kg"], without_pod["total_weight_kg"])
