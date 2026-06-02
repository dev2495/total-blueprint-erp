from django.test import TestCase

from apps.inventory.models import InkMaterial
from apps.materials.models import InventoryMaterial
from apps.production.services.services_execution import ExecutionService


class MixReturnInkTests(TestCase):
    def test_generic_mix_return_uses_source_ink_base_family(self):
        source = InkMaterial.objects.create(base_type="PET", color_name="RED")

        target = ExecutionService._generic_mix_return_ink(source)

        self.assertEqual(target.base_type, "PET")
        self.assertEqual(target.color_name, "MIX RETURN")
        self.assertEqual(target.code, "INK-PET-MIX-RETURN")

    def test_generic_mix_return_infers_pet_from_material_identity(self):
        source = InventoryMaterial.objects.create(
            code="PET-INK-ODD",
            name="Returned PET ink without child row",
            category="INK",
            base_uom="KG",
        )

        target = ExecutionService._generic_mix_return_ink(source)

        self.assertEqual(target.base_type, "PET")
        self.assertEqual(target.color_name, "MIX RETURN")
