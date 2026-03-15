from django.core.exceptions import ValidationError
from django.test import TestCase

from apps.factory.models import Plant
from apps.inventory.models import InventoryLocation
from apps.tooling.models import ToolAsset


class ToolAssetValidationTests(TestCase):
    def setUp(self):
        self.plant_a = Plant.objects.create(code="PLANT_A_TOOL", name="Plant A Tool")
        self.plant_b = Plant.objects.create(code="PLANT_B_TOOL", name="Plant B Tool")
        self.tool_room = InventoryLocation.objects.create(
            plant=self.plant_a,
            code="TOOL_A",
            name="Plant A Tool Room",
            type="TOOLING",
        )
        self.rm_store = InventoryLocation.objects.create(
            plant=self.plant_a,
            code="RM_A",
            name="Plant A RM",
            type="RM",
        )
        self.other_plant_tool_room = InventoryLocation.objects.create(
            plant=self.plant_b,
            code="TOOL_B",
            name="Plant B Tool Room",
            type="TOOLING",
        )

    def test_tool_asset_requires_tooling_location_type(self):
        asset = ToolAsset(
            plant=self.plant_a,
            asset_type="ANILOX",
            code="ANX-001",
            name="Anilox 001",
            status="READY",
            storage_location=self.rm_store,
        )

        with self.assertRaises(ValidationError) as exc:
            asset.clean()

        self.assertIn("TOOLING location", str(exc.exception))

    def test_tool_asset_requires_same_plant_location(self):
        asset = ToolAsset(
            plant=self.plant_a,
            asset_type="ANILOX",
            code="ANX-002",
            name="Anilox 002",
            status="READY",
            storage_location=self.other_plant_tool_room,
        )

        with self.assertRaises(ValidationError) as exc:
            asset.clean()

        self.assertIn("same plant", str(exc.exception))

    def test_tool_asset_accepts_tool_room_with_same_plant(self):
        asset = ToolAsset(
            plant=self.plant_a,
            asset_type="ANILOX",
            code="ANX-003",
            name="Anilox 003",
            status="READY",
            storage_location=self.tool_room,
            rack_code="R-01",
            slot_code="S-02",
        )

        asset.clean()
