from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.artwork.models import Artwork
from apps.factory.models import Plant
from apps.inventory.models import InventoryLocation, Vendor
from apps.tooling.models import Cylinder, CylinderSlotAssignment
from apps.users.models import Role, User


@override_settings(STRICT_RBAC=True)
class CylinderAssignmentIdentityTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        role = Role.objects.create(code="ENGINEERING", name="Engineering")
        self.client.force_authenticate(User.objects.create_user(username="slot-engineer", role=role))
        plant = Plant.objects.create(code="SLOT-PLANT", name="Slot plant")
        vendor = Vendor.objects.create(code="SLOT-VENDOR", name="Slot vendor")
        location = InventoryLocation.objects.create(plant=plant, code="SLOT-TOOL", name="Tool room", type="TOOLING")
        self.artwork = Artwork.objects.create(
            design_code="SLOT-ART", name="Slot artwork", substrate_mode="TUBING",
            front_colors=["CYAN", "BLACK"], front_colors_count=2,
            back_colors=["CYAN"], back_colors_count=1,
        )
        self.other = Artwork.objects.create(design_code="SLOT-OTHER", name="Other", front_colors=["CYAN"], front_colors_count=1)
        cylinders = [Cylinder.objects.create(
            code=f"SLOT-CYL-{index}", name=f"Cylinder {index}", diameter_mm=100,
            circumference=314, width_mm=500, color_name="CYAN", is_draft=False,
            engraving_vendor=vendor, storage_location=location,
        ) for index in (1, 2)]
        self.first, self.second = cylinders
        self.assignment = CylinderSlotAssignment.objects.create(
            artwork=self.artwork, cylinder=self.first, side="FRONT", side_slot_index=1,
        )

    def test_patch_cannot_move_assignment_or_create_another_slot(self):
        for payload in ({"artwork": str(self.other.pk)}, {"side": "BACK"}, {"side_slot_index": 2}, {"slot": 2}):
            with self.subTest(payload=payload):
                response = self.client.patch(
                    f"/api/tooling/cylinder-slot-assignments/{self.assignment.pk}/", payload, format="json",
                )
                self.assertEqual(response.status_code, 400, response.data)
                self.assignment.refresh_from_db()
                self.assertEqual(self.assignment.artwork_id, self.artwork.pk)
                self.assertEqual(self.assignment.side, "FRONT")
                self.assertEqual(self.assignment.side_slot_index, 1)
                self.assertEqual(CylinderSlotAssignment.objects.count(), 1)

    def test_patch_replaces_cylinder_at_addressed_slot_and_post_still_assigns_another_slot(self):
        response = self.client.patch(
            f"/api/tooling/cylinder-slot-assignments/{self.assignment.pk}/",
            {"artwork": str(self.artwork.pk), "side": "FRONT", "side_slot_index": 1, "cylinder": str(self.second.pk)},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(str(response.data["id"]), str(self.assignment.pk))
        self.assignment.refresh_from_db()
        self.assertEqual(self.assignment.cylinder_id, self.second.pk)
        response = self.client.post(
            "/api/tooling/cylinder-slot-assignments/",
            {"artwork": str(self.other.pk), "side": "FRONT", "side_slot_index": 1, "cylinder": str(self.first.pk)},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertNotEqual(str(response.data["id"]), str(self.assignment.pk))
