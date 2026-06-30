from django.test import SimpleTestCase

from apps.materials.product_spec import build_product_label, build_product_spec


class ProductSpecLabelTests(SimpleTestCase):
    def test_customer_label_leads_and_versions_stay_out_of_display_label(self):
        label = build_product_label(
            geometry={
                "finished_good_type": "POUCH",
                "base": {"width_mm": 220, "height_mm": 320, "gusset_mm": 35},
            },
            layers=[
                {"variant_code": "PET12", "thickness_micron": 12},
                {"variant_code": "LDMW", "grade_code": "GP", "thickness_micron": 40},
            ],
            printing={
                "type": "ROTO",
                "front_colors_count": 5,
                "back_colors_count": 1,
                "ink_gsm_total": 2,
                "chemicals": {"adhesive_gsm": 0.7, "solvent_gsm": 0.3},
            },
            addons=[{"code": "ZIP"}],
            packaging={
                "pod": {"enabled": True, "pod_sku_code": "POD"},
                "primary_inner_pack": {"enabled": True, "material_code": "IP", "pcs_per_pack": 24},
            },
            product_master_name="PM Dry Pouch v4 route template",
            customer_display_name="AAP Almond Pouch 500g",
            customer_item_code="AAP-ALM-500G",
            qty_value=2250,
            qty_uom="KG",
        )

        self.assertTrue(label.startswith("AAP Almond Pouch 500g - 220x320+35G"))
        self.assertIn("12+40", label)
        self.assertIn("PET/LDMW GP", label)
        self.assertIn("I2/A&S1", label)
        self.assertIn("ROTO6C", label)
        self.assertNotIn("ZIP", label)
        self.assertNotIn("POD", label)
        self.assertNotIn("IP24", label)
        self.assertIn("2250 KG", label)
        self.assertNotIn("v4", label.lower())
        self.assertNotIn("template", label.lower())
        self.assertNotIn("route", label.lower())

    def test_product_spec_exposes_label_facets_without_changing_legacy_fields(self):
        spec = build_product_spec(
            geometry={
                "finished_good_type": "POUCH",
                "base": {"width_mm": 180, "height_mm": 260, "gusset_mm": 30},
            },
            layers=[
                {"variant_code": "PET", "thickness_micron": 12},
                {"variant_code": "LD", "grade_code": "FOOD-A", "thickness_micron": 65},
            ],
            printing={
                "type": "FLEXO",
                "front_colors_count": 3,
                "ink_gsm_total": 1.5,
                "chemicals": {"adhesive_gsm": 0.5, "solvent_gsm": 0.25},
            },
            customer_display_name="Customer Food Pouch",
            product_name="Internal food pouch",
            qty_value=1000,
            qty_uom="PCS",
        )

        self.assertEqual(spec["size"]["compact_label"], "180x260+30G")
        self.assertEqual(spec["layer_stack"]["thickness_label"], "12+65")
        self.assertEqual(spec["layer_stack"]["material_label"], "PET/LD FOOD-A")
        self.assertEqual(spec["chemistry"]["gsm_label"], "I1.5/A&S0.75")
        self.assertEqual(spec["chemistry"]["print_label"], "FLEXO3C")
        self.assertTrue(spec["display_label"].startswith("Customer Food Pouch - 180x260+30G"))
        self.assertEqual(len(spec["layers"]), 2)
        self.assertEqual(spec["layers"][0]["label"], "PET · 12µ")
        self.assertEqual(spec["layers"][1]["label"], "LD · FOOD-A · 65µ")
