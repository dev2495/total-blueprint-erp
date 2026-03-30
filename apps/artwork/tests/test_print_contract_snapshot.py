from decimal import Decimal

from django.core.exceptions import ValidationError
from django.test import TestCase

from apps.artwork.print_contract import validate_frozen_printing_snapshot
from apps.inventory.models import InkMaterial
from apps.physics.services_physics import PhysicsEngine


class PrintContractSnapshotTests(TestCase):
    def setUp(self):
        self.poly_cyan = InkMaterial.objects.create(base_type="POLY", color_name="CYAN")
        self.pet_red = InkMaterial.objects.create(base_type="PET", color_name="RED")

    def test_frozen_snapshot_requires_artwork_design_code(self):
        with self.assertRaises(ValidationError) as exc:
            validate_frozen_printing_snapshot(
                {
                    "enabled": True,
                    "type": "FLEXO",
                    "substrate_mode": "SHEET",
                    "front_colors_count": 1,
                    "back_colors_count": 0,
                    "ink_gsm_total": 1.2,
                    "artwork_id": "art-1",
                    "front_colors": ["CYAN"],
                    "back_colors": [],
                    "color_names": ["CYAN"],
                    "color_mapping": {"CYAN": str(self.poly_cyan.id)},
                    "ink_base_family": "POLY",
                    "cylinder_required": False,
                },
                layer_snapshot=[{"density_g_cm3": 0.92}],
                require_artwork=True,
                strict_inks=True,
            )

        self.assertIn("artwork_design_code", str(exc.exception))

    def test_frozen_snapshot_resolves_pet_ink_base_family(self):
        validated = validate_frozen_printing_snapshot(
            {
                "enabled": True,
                "type": "FLEXO",
                "substrate_mode": "SHEET",
                "front_colors_count": 1,
                "back_colors_count": 0,
                "ink_gsm_total": 1.2,
                "artwork_id": "art-2",
                "front_colors": ["RED"],
                "back_colors": [],
                "color_names": ["RED"],
                "color_mapping": {"RED": str(self.pet_red.id)},
                "ink_base_family": "PET",
                "artwork_design_code": "ART-2",
                "cylinder_required": False,
            },
            layer_snapshot=[{"density_g_cm3": 1.42}],
            require_artwork=True,
            strict_inks=True,
        )

        self.assertEqual(validated["ink_base_family"], "PET")
        self.assertEqual(validated["color_mapping"]["RED"], str(self.pet_red.id))

    def test_preview_ink_consumption_surfaces_unmapped_colors_without_blocking(self):
        consumptions = PhysicsEngine.calculate_ink_consumption(
            {
                "printing": {
                    "enabled": True,
                    "type": "FLEXO",
                    "substrate_mode": "SHEET",
                    "front_colors_count": 1,
                    "back_colors_count": 0,
                    "ink_gsm_total": 1.0,
                    "front_colors": ["MAGENTA"],
                    "back_colors": [],
                    "color_names": ["MAGENTA"],
                    "color_mapping": {},
                },
                "film_layers": [{"density_g_cm3": 0.92}],
            },
            total_qty=Decimal("1"),
            area_override_m2=Decimal("10"),
        )

        self.assertEqual(len(consumptions), 1)
        self.assertIsNone(consumptions[0]["material_id"])
        self.assertIn("UNMAPPED", consumptions[0]["material_code"])
