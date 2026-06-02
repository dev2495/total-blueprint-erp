from decimal import Decimal

from django.core.exceptions import ValidationError
from django.test import TestCase

from apps.artwork.models import Artwork
from apps.artwork.print_contract import get_artwork_contract, validate_frozen_printing_snapshot
from apps.bom.services_resolver import BOMResolverService
from apps.inventory.models import InkMaterial
from apps.materials.models import InventoryMaterial
from apps.physics.services_physics import PhysicsEngine


class PrintContractSnapshotTests(TestCase):
    def setUp(self):
        self.poly_cyan = InkMaterial.objects.create(base_type="POLY", color_name="CYAN")
        self.pet_red = InkMaterial.objects.create(base_type="PET", color_name="RED")

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
                "color_mapping": {},
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
                "color_mapping": {"RED": str(self.pet_red.id)},
                "ink_base_family": "PET",
                "artwork_design_code": "ART-2A",
                "cylinder_required": False,
            },
            layer_snapshot=[{"density_g_cm3": 1.31}],
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

    def test_artwork_contract_splits_total_ink_gsm_equally_by_color(self):
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
            ink_gsm_split_mode="EQUAL",
        )

        contract = get_artwork_contract(artwork, require_ink_usage=True)

        self.assertEqual(contract["ink_gsm_total"], 1.2)
        self.assertEqual(contract["ink_gsm_split_mode"], "EQUAL")
        self.assertEqual(contract["ink_gsm_by_color"], {"CYAN": 0.6, "BLACK": 0.6})

    def test_artwork_contract_splits_total_ink_gsm_by_percentages(self):
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
            ink_gsm_split_mode="PERCENT",
            ink_gsm_color_percentages={"CYAN": 70, "BLACK": 30},
        )

        contract = get_artwork_contract(artwork, require_ink_usage=True)

        self.assertEqual(contract["ink_gsm_by_color"], {"CYAN": 1.05, "BLACK": 0.45})

    def test_bom_resolver_uses_artwork_ink_gsm_by_color_and_pet_layer_base(self):
        pet_black = InkMaterial.objects.create(base_type="PET", color_name="BLACK")
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
                    "color_mapping": {"RED": str(self.pet_red.id), "BLACK": str(pet_black.id)},
                    "ink_gsm_total": 1.5,
                    "ink_gsm_split_mode": "PERCENT",
                    "ink_gsm_color_percentages": {"RED": 70, "BLACK": 30},
                    "ink_gsm_by_color": {"RED": 1.05, "BLACK": 0.45},
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

        ink_by_color = {row["color"]: row for row in result["inks"]}
        self.assertEqual(result["errors"], [])
        self.assertEqual(ink_by_color["RED"]["ink_base_family"], "PET")
        self.assertEqual(ink_by_color["RED"]["material_id"], str(self.pet_red.id))
        self.assertEqual(ink_by_color["BLACK"]["material_id"], str(pet_black.id))
        self.assertEqual(ink_by_color["RED"]["gsm_per_color"], 1.05)
        self.assertEqual(ink_by_color["BLACK"]["gsm_per_color"], 0.45)
