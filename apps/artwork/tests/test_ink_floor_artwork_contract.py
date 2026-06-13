from decimal import Decimal

from django.test import TestCase

from apps.artwork.models import Artwork
from apps.artwork.print_contract import get_artwork_contract, validate_frozen_printing_snapshot
from apps.bom.services_resolver import BOMResolverService
from apps.materials.models import InventoryMaterial


class InkFloorArtworkContractTests(TestCase):
    def test_artwork_contract_keeps_total_ink_theory_without_master_mapping(self):
        artwork = Artwork.objects.create(
            design_code="ART-FLOOR-INK-1",
            name="Floor ink artwork",
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
        self.assertEqual(contract["color_names"], ["CYAN", "BLACK"])
        self.assertNotIn("color_mapping", contract)
        self.assertNotIn("ink_gsm_by_color", contract)
        self.assertNotIn("ink_gsm_color_percentages", contract)

    def test_frozen_printing_snapshot_strict_inks_does_not_require_ink_master_mapping(self):
        validated = validate_frozen_printing_snapshot(
            {
                "enabled": True,
                "type": "FLEXO",
                "substrate_mode": "SHEET",
                "front_colors_count": 1,
                "back_colors_count": 0,
                "ink_gsm_total": 1.2,
                "artwork_id": "art-floor-1",
                "artwork_design_code": "ART-FLOOR-1",
                "front_colors": ["GOLD MIX"],
                "back_colors": [],
                "color_names": ["GOLD MIX"],
                "cylinder_required": False,
            },
            layer_snapshot=[{"density_g_cm3": 0.92}],
            require_artwork=True,
            strict_inks=True,
        )

        self.assertEqual(validated["ink_gsm_total"], 1.2)
        self.assertNotIn("color_mapping", validated)
        self.assertEqual(validated["ink_base_family"], "POLY")

    def test_bom_resolver_emits_one_theory_only_ink_row(self):
        film = InventoryMaterial.objects.create(
            code="FILM-FLOOR-INK",
            name="Film for floor ink theory",
            category="FILM_VARIANT",
            base_uom="KG",
            density_gcm3="0.9200",
        )

        result = BOMResolverService.resolve(
            {
                "finished_good_type": "POUCH",
                "uom": "PCS",
                "order_qty": 1,
                "film_layers": [
                    {
                        "variant_id": str(film.id),
                        "thickness_micron": 12,
                        "density_g_cm3": 0.92,
                    }
                ],
                "printing": {
                    "enabled": True,
                    "type": "FLEXO",
                    "substrate_mode": "SHEET",
                    "front_colors_count": 2,
                    "back_colors_count": 0,
                    "front_colors": ["CYAN", "BLACK"],
                    "back_colors": [],
                    "color_names": ["CYAN", "BLACK"],
                    "ink_gsm_total": 1.5,
                    "artwork_id": "art-floor-2",
                    "artwork_design_code": "ART-FLOOR-2",
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
        row = result["inks"][0]
        self.assertIsNone(row["material_id"])
        self.assertEqual(row["code"], "INK-THEORY")
        self.assertEqual(row["name"], "Theoretical printing ink")
        self.assertEqual(row["color"], "TOTAL")
        self.assertEqual(row["gsm_total"], 1.5)
        self.assertEqual(row["weight_kg"], 0.00003)
