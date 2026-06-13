from decimal import Decimal

from django.core.exceptions import ValidationError
from django.test import TestCase

from apps.artwork.models import Artwork
from apps.artwork.print_contract import get_artwork_contract, validate_frozen_printing_snapshot
from apps.bom.services_resolver import BOMResolverService
from apps.materials.models import InventoryMaterial
from apps.physics.services_physics import PhysicsEngine


class PrintContractSnapshotTests(TestCase):
    def test_deferred_artwork_snapshot_can_have_zero_ink_gsm_until_artwork_is_assigned(self):
        validated = validate_frozen_printing_snapshot(
            {
                "enabled": True,
                "type": "ROTO",
                "substrate_mode": "SHEET",
                "front_colors_count": 2,
                "back_colors_count": 0,
                "ink_gsm_total": 0,
                "front_colors": ["FRONT 1", "FRONT 2"],
                "back_colors": [],
                "color_names": ["FRONT 1", "FRONT 2"],
                "cylinder_required": True,
            },
            layer_snapshot=[{"density_g_cm3": 0.92}],
            require_artwork=False,
            strict_inks=False,
        )

        self.assertEqual(validated["ink_gsm_total"], 0.0)
        self.assertEqual(validated["cylinder_required"], True)

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
                "ink_base_family": "PET",
                "artwork_design_code": "ART-2",
                "cylinder_required": False,
            },
            layer_snapshot=[{"density_g_cm3": 1.42}],
            require_artwork=True,
            strict_inks=True,
        )

        self.assertEqual(validated["ink_base_family"], "PET")
        self.assertNotIn("color_mapping", validated)

    def test_layer_density_above_one_point_three_resolves_pet_ink_base_family(self):
        validated = validate_frozen_printing_snapshot(
            {
                "enabled": True,
                "type": "FLEXO",
                "substrate_mode": "SHEET",
                "front_colors_count": 1,
                "back_colors_count": 0,
                "ink_gsm_total": 1.2,
                "artwork_id": "art-2a",
                "front_colors": ["RED"],
                "back_colors": [],
                "color_names": ["RED"],
                "ink_base_family": "PET",
                "artwork_design_code": "ART-2A",
                "cylinder_required": False,
            },
            layer_snapshot=[{"density_g_cm3": 1.31}],
            require_artwork=True,
            strict_inks=True,
        )

        self.assertEqual(validated["ink_base_family"], "PET")
        self.assertNotIn("color_mapping", validated)

    def test_preview_ink_consumption_does_not_auto_consume_inks(self):
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
                },
                "film_layers": [{"density_g_cm3": 0.92}],
            },
            total_qty=Decimal("1"),
            area_override_m2=Decimal("10"),
        )

        self.assertEqual(len(consumptions), 1)
        self.assertIsNone(consumptions[0]["material_id"])
        self.assertEqual(consumptions[0]["material_code"], "INK-THEORY")
        self.assertEqual(consumptions[0]["color"], "TOTAL")
        self.assertEqual(consumptions[0]["weight_kg"], 0.01)

    def test_artwork_contract_keeps_total_ink_gsm_without_color_split(self):
        artwork = Artwork.objects.create(
            design_code="ART-INK-EQ",
            name="Equal ink GSM",
            print_type="FLEXO",
            substrate_mode="SHEET",
            front_colors=["CYAN", "BLACK"],
            front_colors_count=2,
            back_colors=[],
            back_colors_count=0,
            color_list=["CYAN", "BLACK"],
            colors_count=2,
            ink_gsm_total=Decimal("1.20"),
        )

        contract = get_artwork_contract(artwork, require_ink_usage=True)

        self.assertEqual(contract["ink_gsm_total"], 1.2)
        self.assertNotIn("ink_gsm_split_mode", contract)
        self.assertNotIn("ink_gsm_by_color", contract)
        self.assertNotIn("color_mapping", contract)

    def test_artwork_contract_ignores_percent_ink_gsm_split(self):
        artwork = Artwork.objects.create(
            design_code="ART-INK-PCT",
            name="Percent ink GSM",
            print_type="FLEXO",
            substrate_mode="SHEET",
            front_colors=["CYAN", "BLACK"],
            front_colors_count=2,
            back_colors=[],
            back_colors_count=0,
            color_list=["CYAN", "BLACK"],
            colors_count=2,
            ink_gsm_total=Decimal("1.50"),
        )

        contract = get_artwork_contract(artwork, require_ink_usage=True)

        self.assertEqual(contract["ink_gsm_total"], 1.5)
        self.assertNotIn("ink_gsm_split_mode", contract)
        self.assertNotIn("ink_gsm_color_percentages", contract)
        self.assertNotIn("ink_gsm_by_color", contract)

    def test_bom_resolver_uses_total_ink_gsm_theory_row_and_pet_layer_base(self):
        pet_film = InventoryMaterial.objects.create(
            code="PET-12-INK-GSM-T",
            name="PET 12 ink GSM test",
            category="FILM_VARIANT",
            base_uom="KG",
            density_gcm3="1.3100",
        )

        result = BOMResolverService.resolve(
            {
                "finished_good_type": "POUCH",
                "uom": "PCS",
                "order_qty": 1,
                "film_layers": [
                    {
                        "variant_id": str(pet_film.id),
                        "thickness_micron": 12,
                        "density_g_cm3": 1.31,
                    }
                ],
                "printing": {
                    "enabled": True,
                    "type": "FLEXO",
                    "substrate_mode": "SHEET",
                    "front_colors_count": 2,
                    "back_colors_count": 0,
                    "front_colors": ["RED", "BLACK"],
                    "back_colors": [],
                    "color_names": ["RED", "BLACK"],
                    "ink_gsm_total": 1.5,
                },
            },
            {
                "geometry_snapshot": {
                    "finished_good_type": "POUCH",
                    "effective_width_mm": 100,
                    "effective_height_mm": 100,
                    "faces": 2,
                }
            },
        )

        self.assertEqual(result["errors"], [])
        self.assertEqual(len(result["inks"]), 1)
        ink_row = result["inks"][0]
        self.assertEqual(ink_row["color"], "TOTAL")
        self.assertEqual(ink_row["code"], "INK-THEORY")
        self.assertIsNone(ink_row["material_id"])
        self.assertEqual(ink_row["ink_base_family"], "PET")
        self.assertEqual(ink_row["gsm_total"], 1.5)
        self.assertIsNone(ink_row["gsm_per_color"])
