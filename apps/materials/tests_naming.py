from django.test import SimpleTestCase, TestCase

from apps.materials.models import InventoryMaterial, ProductMaster, ProductMasterSize, ProductVariant
from apps.materials.naming import (
    material_code,
    normalize_code,
    product_master_code,
    product_master_size_code,
    product_variant_code,
)


class NamingConventionUtilityTests(SimpleTestCase):
    def test_normalize_code_keeps_stable_uppercase_tokens(self):
        self.assertEqual(normalize_code(" dry fruit / 3 layer "), "DRY-FRUIT-3-LAYER")
        self.assertEqual(normalize_code("INK_CYAN"), "INK_CYAN")
        self.assertEqual(normalize_code("pod.220 mm"), "POD.220-MM")

    def test_master_size_and_material_code_helpers(self):
        self.assertEqual(
            product_master_code(family="Dry Fruit", form="STP", layer_count=3),
            "PM-DRY-FRUIT-STP-3L",
        )
        self.assertEqual(
            product_master_size_code(width_mm=140, height_mm=200, gusset_mm=60, roll_width_mm=330),
            "140X200-G60",
        )
        self.assertEqual(
            material_code(category="PACKAGING", kind="INNER", family="POUCH", spec="24 PCS"),
            "PKG-INNER-POUCH-24-PCS",
        )

    def test_product_variant_code_is_semantic_short_and_hash_stable(self):
        code = product_variant_code(
            master_code="PM-DF-STP-3L",
            axis_values={
                "size": "DF-250-140X200",
                "pod_variant": "POD 220",
                "packaging_inner": "INNER POUCH 24",
            },
            geometry={"roll_width_mm": 330, "thickness_um": 97},
            layers=[
                {"thickness_micron": 12, "roll_width_mm": 330},
                {"thickness_micron": 20, "roll_width_mm": 330},
                {"thickness_micron": 65, "roll_width_mm": 330},
            ],
        )

        self.assertLessEqual(len(code), 80)
        self.assertIn("DF-250-140X200", code)
        self.assertNotIn("RW330", code)
        self.assertIn("T97U", code)
        self.assertRegex(code, r"-[A-F0-9]{6}$")

    def test_product_variant_code_uses_final_size_not_roll_width_when_size_axis_missing(self):
        code = product_variant_code(
            master_code="PM-DF-STP-3L",
            axis_values={},
            geometry={
                "base": {"width_mm": 140, "height_mm": 200, "gusset_mm": 60},
                "roll_width_mm": 330,
                "thickness_um": 97,
            },
        )

        self.assertIn("140X200-G60", code)
        self.assertNotIn("RW330", code)
        self.assertIn("T97U", code)


class NamingConventionModelTests(TestCase):
    def test_master_material_size_and_variant_codes_normalize_on_save(self):
        master = ProductMaster.objects.create(
            code=" pm dry / fruit ",
            name="Dry Fruit Pouch",
            product_kind="POUCH",
            default_reporting_group="FG",
        )
        material = InventoryMaterial.objects.create(
            code=" inner pouch / 24 pcs ",
            name="Inner pouch 24 pcs",
            category="PACKAGING",
            base_uom="PCS",
            packaging_kind="INNER_POUCH",
            packaging_supply_mode="PURCHASED",
        )
        size = ProductMasterSize.objects.create(
            product_master=master,
            code=" size 250g ",
            label="250g",
            width_mm=140,
            height_mm=200,
        )
        variant = ProductVariant.objects.create(
            master=master,
            code=" dry fruit variant ",
            bom_signature="naming-test-signature",
        )

        self.assertEqual(master.code, "PM-DRY-FRUIT")
        self.assertEqual(material.code, "INNER-POUCH-24-PCS")
        self.assertEqual(size.code, "SIZE-250G")
        self.assertEqual(variant.code, "DRY-FRUIT-VARIANT")
