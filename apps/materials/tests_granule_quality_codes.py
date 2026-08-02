from decimal import Decimal

from django.test import TestCase
from django.core.exceptions import ValidationError
from rest_framework.test import APIClient

from apps.factory.models import Plant
from apps.inventory.models import InventoryBulk, InventoryLocation, Vendor
from apps.inventory.services.grn import GRNService
from apps.inventory.services.bulk_service import BulkService
from apps.materials.models import (
    GranuleQualityCode,
    InventoryMaterial,
    canonical_granule_quality_code,
)
from apps.materials.serializers import GranuleQualityCodeSerializer
from apps.users.models import User


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

    def test_bulk_code_create_is_atomic_and_rejects_existing_code(self):
        user = User.objects.create_superuser(username="granule-admin", password="pass12345")
        client = APIClient()
        client.force_authenticate(user=user)

        response = client.post(
            "/api/master/granule-codes/bulk-create/",
            {"granule": str(self.granule.id), "codes": ["PPA-703-A", "BRIGHT"]},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(
            set(self.granule.quality_codes.values_list("code", flat=True)),
            {"GP-12A", "PPA-703-A", "BRIGHT"},
        )

        duplicate_response = client.post(
            "/api/master/granule-codes/bulk-create/",
            {"granule": str(self.granule.id), "codes": ["NEW-CODE", "BRIGHT"]},
            format="json",
        )
        self.assertEqual(duplicate_response.status_code, 400)
        self.assertFalse(self.granule.quality_codes.filter(code="NEW-CODE").exists())

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

    def test_separator_variants_share_one_canonical_identity(self):
        self.assertEqual(canonical_granule_quality_code(" slip_110 c "), "SLIP-110-C")
        serializer = GranuleQualityCodeSerializer(
            data={"granule": str(self.granule.id), "code": "GP 12A", "status": "ACTIVE"}
        )

        self.assertFalse(serializer.is_valid())
        self.assertIn("Equivalent code", str(serializer.errors))

    def test_bulk_create_rejects_separator_equivalent_codes_atomically(self):
        user = User.objects.create_superuser(username="granule-canonical-admin", password="pass12345")
        client = APIClient()
        client.force_authenticate(user=user)

        response = client.post(
            "/api/master/granule-codes/bulk-create/",
            {"granule": str(self.granule.id), "codes": ["SLIP-110 C", "SLIP_110-C"]},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(self.granule.quality_codes.filter(code__startswith="SLIP").exists())

    def test_grn_text_code_reuses_existing_canonical_record(self):
        existing = GranuleQualityCode.objects.create(
            granule=self.granule,
            code="SLIP-110-C",
            status="ACTIVE",
        )

        GRNService.create_bulk_grn(
            material=self.granule,
            location=self.location,
            vendor=self.vendor_a,
            quantity=3,
            plant=self.plant,
            cost=88,
            reference="GRN-CANONICAL",
            granule_code="SLIP 110 C",
        )

        self.assertEqual(
            GranuleQualityCode.objects.filter(
                granule=self.granule,
                canonical_key="SLIP-110-C",
                status="ACTIVE",
            ).count(),
            1,
        )
        self.assertEqual(
            InventoryBulk.objects.get(material=self.granule, granule_code=existing).qty_kg,
            Decimal("3.0000"),
        )

    def test_coded_granule_cannot_receive_uncoded_stock(self):
        with self.assertRaisesMessage(ValidationError, "Select the internal grade/code"):
            BulkService.add_bulk(
                material_id=str(self.granule.id),
                qty=1,
                plant_id=str(self.plant.id),
                location_id=str(self.location.id),
                reference="UNCODED-BLOCKED",
            )

    def test_uncoded_granule_family_remains_supported_until_codes_are_configured(self):
        uncoded = InventoryMaterial.objects.create(
            code="GR-UNCODED",
            name="Uncoded Granule",
            category="GRANULE",
            base_uom="KG",
        )

        BulkService.add_bulk(
            material_id=str(uncoded.id),
            qty=2,
            plant_id=str(self.plant.id),
            location_id=str(self.location.id),
            reference="LEGACY-UNCODED",
        )

        self.assertEqual(
            InventoryBulk.objects.get(material=uncoded, granule_code__isnull=True).qty_kg,
            Decimal("2.0000"),
        )
