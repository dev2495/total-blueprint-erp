from decimal import Decimal

from django.core.exceptions import ValidationError
from django.test import TestCase

from apps.factory.models import Plant
from apps.inventory.models import InventoryBulk, InventoryLocation, Vendor
from apps.inventory.services.grn import GRNService
from apps.materials.models import InventoryMaterial
from apps.materials.serializers import InventoryMaterialSerializer


class AddonBulkGrnTests(TestCase):
    def setUp(self):
        self.plant = Plant.objects.create(name="Addon Plant", code="ADDON-PLANT")
        self.location = InventoryLocation.objects.create(
            plant=self.plant,
            code="ADDON-RM",
            name="Addon RM",
            type="RM",
        )
        self.vendor = Vendor.objects.create(name="Addon Vendor", code="ADDON-V", type="RM", status="ACTIVE")

    def test_purchased_pcs_addon_can_be_inwarded_as_bulk_stock(self):
        addon = InventoryMaterial.objects.create(
            code="ZIP-PCS",
            name="Purchased zipper",
            category="ADDON",
            base_uom="PCS",
            weight_mode="PER_PIECE",
            weight_value=1.2,
            addon_is_purchased=True,
            addon_purchase_uom="PCS",
        )

        tx = GRNService.create_bulk_grn(
            material=addon,
            location=self.location,
            vendor=self.vendor,
            quantity=Decimal("250"),
            plant=self.plant,
            cost=Decimal("0.75"),
            reference="ADDON-GRN-1",
        )

        stock = InventoryBulk.objects.get(material=addon, location=self.location)
        self.assertEqual(stock.qty_kg, Decimal("250.0000"))
        self.assertEqual(stock.material.category, "ADDON")
        self.assertEqual(stock.material.base_uom, "PCS")
        self.assertEqual(tx.material, addon)
        self.assertEqual(tx.qty_kg, Decimal("250.0000"))

    def test_material_library_serializer_exposes_purchase_flags_for_grn_picker(self):
        addon = InventoryMaterial.objects.create(
            code="ZIP-LIB",
            name="Library purchased zipper",
            category="ADDON",
            base_uom="PCS",
            weight_mode="PER_PIECE",
            weight_value=1.2,
            addon_is_purchased=True,
            addon_purchase_uom="PCS",
        )

        data = InventoryMaterialSerializer(addon).data

        self.assertTrue(data["addon_is_purchased"])
        self.assertEqual(data["addon_purchase_uom"], "PCS")
        self.assertEqual(data["weight_mode"], "PER_PIECE")
        self.assertEqual(data["base_uom"], "PCS")

    def test_non_purchased_addon_cannot_be_inwarded(self):
        addon = InventoryMaterial.objects.create(
            code="ZIP-INTERNAL",
            name="Internal zipper calc only",
            category="ADDON",
            base_uom="KG",
            weight_mode="PER_PIECE",
            weight_value=1.2,
            addon_is_purchased=False,
        )

        with self.assertRaises(ValidationError):
            GRNService.create_bulk_grn(
                material=addon,
                location=self.location,
                vendor=self.vendor,
                quantity=Decimal("10"),
                plant=self.plant,
                cost=Decimal("1"),
                reference="ADDON-GRN-2",
            )
