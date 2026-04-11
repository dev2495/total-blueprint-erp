from decimal import Decimal

from django.test import TestCase

from apps.factory.models import Plant
from apps.inventory.models import InventoryBulk, InventoryLocation, Vendor
from apps.inventory.services.grn import GRNService
from apps.materials.models import GranuleQualityCode, InventoryMaterial


class GranuleQualityCodeContractTests(TestCase):
    def setUp(self):
        self.granule = InventoryMaterial.objects.create(
            code="GR-LDPE",
            name="LDPE Granule",
            category="GRANULE",
            base_uom="KG",
        )
        self.plant = Plant.objects.create(name="Plant GQ", code="PL-GQ")
        self.location = InventoryLocation.objects.create(
            plant=self.plant,
            code="RM-GQ",
            name="RM Granule",
            type="RM",
        )
        self.vendor_a = Vendor.objects.create(name="Vendor A", code="VEN-A", type="RM", status="ACTIVE")
        self.vendor_b = Vendor.objects.create(name="Vendor B", code="VEN-B", type="RM", status="ACTIVE")
        self.code = GranuleQualityCode.objects.create(granule=self.granule, code="GP-12A", status="ACTIVE")

    def test_bulk_grn_reuses_same_granule_code_across_multiple_vendors(self):
        GRNService.create_bulk_grn(
            material=self.granule,
            location=self.location,
            vendor=self.vendor_a,
            quantity=10,
            plant=self.plant,
            cost=100,
            reference="GRN-A",
            granule_code_id=str(self.code.id),
        )
        GRNService.create_bulk_grn(
            material=self.granule,
            location=self.location,
            vendor=self.vendor_b,
            quantity=5,
            plant=self.plant,
            cost=120,
            reference="GRN-B",
            granule_code_id=str(self.code.id),
        )

        self.assertEqual(GranuleQualityCode.objects.filter(granule=self.granule, code="GP-12A").count(), 1)
        stock = InventoryBulk.objects.get(
            material=self.granule,
            granule_code=self.code,
            plant=self.plant,
            location=self.location,
        )
        self.assertEqual(stock.qty_kg, Decimal("15.0000"))

    def test_bulk_grn_auto_creates_code_without_vendor_ownership(self):
        GRNService.create_bulk_grn(
            material=self.granule,
            location=self.location,
            vendor=self.vendor_a,
            quantity=7,
            plant=self.plant,
            cost=95,
            reference="GRN-C",
            granule_code="SP-22",
        )

        created = GranuleQualityCode.objects.get(granule=self.granule, code="SP-22")
        stock = InventoryBulk.objects.get(material=self.granule, granule_code=created, plant=self.plant, location=self.location)

        self.assertEqual(stock.qty_kg, Decimal("7.0000"))
