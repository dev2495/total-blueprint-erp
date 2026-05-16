from django.test import TestCase

from apps.artwork.models import Artwork
from apps.factory.models import Plant
from apps.inventory.models import InventoryLocation, Vendor
from apps.tooling.models import Cylinder, CylinderSlotAssignment
from apps.tooling.serializers import CylinderSerializer
from apps.tooling.services import CylinderService


class CylinderSlotAssignmentFlowTests(TestCase):
    def setUp(self):
        self.vendor = Vendor.objects.create(name="Reuse Vendor", code="REUSE-VENDOR")
        self.plant = Plant.objects.create(name="Main Plant", code="MAIN")
        self.location = InventoryLocation.objects.create(
            plant=self.plant,
            code="TOOL",
            name="Tool Room",
            type="TOOLING",
        )

    def test_generate_targets_only_requested_artwork_color_slot(self):
        artwork = Artwork.objects.create(
            design_code="ART-GEN-TARGET",
            name="Targeted Generation",
            print_type="ROTO",
            substrate_mode="SHEET",
            front_colors=["YELLOW", "BLACK"],
            front_colors_count=2,
            color_list=["YELLOW", "BLACK"],
            colors_count=2,
            cylinder_circumference_mm=420,
            cylinder_length_mm=620,
        )

        result = CylinderService.generate_for_artwork(
            artwork.id,
            targets=[{"side": "FRONT", "slot": 2}],
        )

        self.assertEqual(len(result["created"]), 1)
        cylinder = result["created"][0]
        self.assertEqual(cylinder.side, "FRONT")
        self.assertEqual(cylinder.side_slot_index, 2)
        self.assertEqual(cylinder.color_name, "BLACK")
        self.assertEqual(float(cylinder.circumference), 420.0)
        self.assertEqual(float(cylinder.width_mm), 620.0)
        self.assertFalse(Cylinder.objects.filter(artwork=artwork, side_slot_index=1).exists())
        self.assertTrue(CylinderSlotAssignment.objects.filter(artwork=artwork, side="FRONT", side_slot_index=2).exists())

    def test_existing_ready_cylinder_can_be_reused_for_another_artwork_slot(self):
        source = Artwork.objects.create(
            design_code="ART-REUSE-SOURCE",
            name="Reuse Source",
            print_type="ROTO",
            substrate_mode="SHEET",
            front_colors=["CYAN"],
            front_colors_count=1,
            color_list=["CYAN"],
            colors_count=1,
            cylinder_circumference_mm=314,
            cylinder_length_mm=500,
        )
        target = Artwork.objects.create(
            design_code="ART-REUSE-TARGET",
            name="Reuse Target",
            print_type="ROTO",
            substrate_mode="SHEET",
            front_colors=["CYAN"],
            front_colors_count=1,
            color_list=["CYAN"],
            colors_count=1,
            cylinder_circumference_mm=314,
            cylinder_length_mm=500,
        )
        cylinder = Cylinder.objects.create(
            code="CYL-REUSE-CYAN",
            name="Reusable Cyan",
            artwork=source,
            engraving_vendor=self.vendor,
            storage_location=self.location,
            color_name="CYAN",
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

        assignment = CylinderService.assign_existing_to_slot(
            artwork_id=target.id,
            cylinder_id=cylinder.id,
            side="FRONT",
            slot=1,
        )

        self.assertEqual(assignment.artwork_id, target.id)
        self.assertEqual(assignment.cylinder_id, cylinder.id)
        self.assertEqual(assignment.color_name, "CYAN")

    def test_generated_draft_cylinder_confirms_with_only_vendor_location_and_circumference(self):
        artwork = Artwork.objects.create(
            design_code="ART-MIN-CYL",
            name="Minimal Cylinder Details",
            print_type="ROTO",
            substrate_mode="SHEET",
            front_colors=["GREEN"],
            front_colors_count=1,
            color_list=["GREEN"],
            colors_count=1,
            cylinder_circumference_mm=340,
            cylinder_length_mm=540,
        )
        result = CylinderService.generate_for_artwork(artwork.id, targets=[{"side": "FRONT", "slot": 1}])
        cylinder = result["created"][0]

        serializer = CylinderSerializer(
            cylinder,
            data={
                "circumference": 340,
                "width_mm": 540,
                "engraving_vendor": str(self.vendor.id),
                "storage_location": str(self.location.id),
                "is_draft": False,
                "lifecycle_status": "ACTIVE",
                "status": "ACTIVE",
            },
            partial=True,
        )

        self.assertTrue(serializer.is_valid(), serializer.errors)
        saved = serializer.save()
        self.assertFalse(saved.is_draft)
        self.assertEqual(saved.lifecycle_status, "ACTIVE")
        self.assertEqual(saved.status, "ACTIVE")

    def test_reuse_blocks_cylinder_with_different_artwork_circumference(self):
        source = Artwork.objects.create(
            design_code="ART-REUSE-420",
            name="Reuse Source 420",
            print_type="ROTO",
            substrate_mode="SHEET",
            front_colors=["CYAN"],
            front_colors_count=1,
            color_list=["CYAN"],
            colors_count=1,
            cylinder_circumference_mm=420,
            cylinder_length_mm=500,
        )
        target = Artwork.objects.create(
            design_code="ART-REUSE-500",
            name="Reuse Target 500",
            print_type="ROTO",
            substrate_mode="SHEET",
            front_colors=["CYAN"],
            front_colors_count=1,
            color_list=["CYAN"],
            colors_count=1,
            cylinder_circumference_mm=500,
            cylinder_length_mm=500,
        )
        cylinder = Cylinder.objects.create(
            code="CYL-REUSE-420",
            name="Reusable 420",
            artwork=source,
            engraving_vendor=self.vendor,
            storage_location=self.location,
            color_name="CYAN",
            diameter_mm=100,
            width_mm=500,
            circumference=420,
            side="FRONT",
            side_slot_index=1,
            is_draft=False,
            lifecycle_status="ACTIVE",
            status="ACTIVE",
        )

        with self.assertRaisesMessage(ValueError, "circumference must match"):
            CylinderService.assign_existing_to_slot(
                artwork_id=target.id,
                cylinder_id=cylinder.id,
                side="FRONT",
                slot=1,
            )

    def test_reuse_blocks_cylinder_with_different_artwork_length(self):
        source = Artwork.objects.create(
            design_code="ART-REUSE-LEN-SOURCE",
            name="Reuse Length Source",
            print_type="ROTO",
            substrate_mode="SHEET",
            front_colors=["CYAN"],
            front_colors_count=1,
            color_list=["CYAN"],
            colors_count=1,
            cylinder_circumference_mm=420,
            cylinder_length_mm=500,
        )
        target = Artwork.objects.create(
            design_code="ART-REUSE-LEN-TARGET",
            name="Reuse Length Target",
            print_type="ROTO",
            substrate_mode="SHEET",
            front_colors=["CYAN"],
            front_colors_count=1,
            color_list=["CYAN"],
            colors_count=1,
            cylinder_circumference_mm=420,
            cylinder_length_mm=650,
        )
        cylinder = Cylinder.objects.create(
            code="CYL-REUSE-LEN-500",
            name="Reusable Length 500",
            artwork=source,
            engraving_vendor=self.vendor,
            storage_location=self.location,
            color_name="CYAN",
            diameter_mm=100,
            width_mm=500,
            circumference=420,
            side="FRONT",
            side_slot_index=1,
            is_draft=False,
            lifecycle_status="ACTIVE",
            status="ACTIVE",
        )

        with self.assertRaisesMessage(ValueError, "length must match"):
            CylinderService.assign_existing_to_slot(
                artwork_id=target.id,
                cylinder_id=cylinder.id,
                side="FRONT",
                slot=1,
            )
