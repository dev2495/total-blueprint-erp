from django.test import TestCase

from apps.tooling.serializers import CylinderSerializer


class CylinderFinalizeValidationTests(TestCase):
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
