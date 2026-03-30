from django.test import TestCase

from apps.artwork.models import Artwork
from apps.inventory.models import Vendor
from apps.tooling.models import Cylinder
from apps.tooling.serializers import CylinderSerializer


class CylinderFinalizeValidationTests(TestCase):
    def setUp(self):
        self.artwork = Artwork.objects.create(
            design_code="ART-CYL-TEST-001",
            name="Cylinder Test Artwork",
            print_type="ROTO",
            file_path="/tmp/cylinder-test-artwork.pdf",
            front_colors=["YELLOW"],
            front_colors_count=1,
        )
        self.vendor = Vendor.objects.create(name="Cylinder Vendor", code="CYL-VENDOR-001")

    def _base_payload(self):
        return {
            "code": "CYL-TEST-001",
            "name": "Test Cylinder",
            "color_name": "YELLOW",
            "diameter_mm": 100,
            "width_mm": 500,
            "circumference": 314,
            "cell_depth_microns": 28,
            "side": "FRONT",
            "side_slot_index": 1,
            "is_draft": True,
            "lifecycle_status": "DRAFT",
            "status": "ACTIVE",
            "artwork": str(self.artwork.id),
        }

    def test_rejects_unknown_lifecycle_status(self):
        payload = self._base_payload()
        payload["lifecycle_status"] = "FREE_TEXT_STATUS"

        serializer = CylinderSerializer(data=payload)

        self.assertFalse(serializer.is_valid())
        self.assertIn("lifecycle_status", serializer.errors)

    def test_finalize_requires_cell_depth_and_vendor(self):
        payload = self._base_payload()
        payload.update(
            {
                "is_draft": False,
                "lifecycle_status": "READY",
                "cell_depth_microns": 0,
                "engraving_vendor": None,
            }
        )

        serializer = CylinderSerializer(data=payload)

        self.assertFalse(serializer.is_valid())
        detail = str(serializer.errors.get("detail", ""))
        self.assertIn("cell_depth_microns", detail)
        self.assertIn("engraving_vendor", detail)

    def test_finalize_rejects_duplicate_finalized_slot_for_same_artwork(self):
        Cylinder.objects.create(
            code="CYL-EXISTING-001",
            name="Existing Finalized Cylinder",
            artwork=self.artwork,
            engraving_vendor=self.vendor,
            color_name="YELLOW",
            diameter_mm=100,
            width_mm=500,
            circumference=314,
            cell_depth_microns=28,
            side="FRONT",
            side_slot_index=1,
            is_draft=False,
            lifecycle_status="READY",
            status="ACTIVE",
        )
        payload = self._base_payload()
        payload.update(
            {
                "code": "CYL-TEST-002",
                "engraving_vendor": str(self.vendor.id),
                "is_draft": False,
                "lifecycle_status": "READY",
            }
        )

        serializer = CylinderSerializer(data=payload)

        self.assertFalse(serializer.is_valid())
        self.assertIn("already has a finalized cylinder", str(serializer.errors.get("detail", "")))

    def test_rejects_non_positive_slot_index(self):
        payload = self._base_payload()
        payload["side_slot_index"] = 0

        serializer = CylinderSerializer(data=payload)

        self.assertFalse(serializer.is_valid())
        self.assertIn("side_slot_index", serializer.errors)

    def test_rejects_slot_index_beyond_artwork_side_color_count(self):
        payload = self._base_payload()
        payload["side_slot_index"] = 2

        serializer = CylinderSerializer(data=payload)

        self.assertFalse(serializer.is_valid())
        self.assertIn("exceeds approved artwork", str(serializer.errors.get("side_slot_index", "")))
