import shutil
import tempfile
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.artwork.models import Artwork, ArtworkImage
from apps.factory.models import Plant
from apps.inventory.models import InventoryLocation
from apps.inventory.models import Vendor
from apps.tooling.models import Cylinder
from apps.users.models import Role


class ArtworkApiApprovalControlTests(TestCase):
    @classmethod
    def setUpClass(cls):
        cls._media_root = tempfile.mkdtemp(prefix="artwork-api-media-")
        cls._settings_override = override_settings(MEDIA_ROOT=cls._media_root, MEDIA_URL="/media/")
        cls._settings_override.enable()
        super().setUpClass()

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        cls._settings_override.disable()
        shutil.rmtree(cls._media_root, ignore_errors=True)

    def setUp(self):
        self.client = APIClient()
        self.engineering_role = Role.objects.create(
            code="ENGINEERING",
            name="Engineering",
            default_permissions=["engineering.view", "engineering.manage", "users.self_manage"],
        )
        self.user = get_user_model().objects.create_user(
            username="engineer1",
            email="engineer1@example.com",
            password="engineerpass123",
            role=self.engineering_role,
        )
        self.client.force_authenticate(user=self.user)
        self.artwork = Artwork.objects.create(
            design_code="ART-API-1",
            name="API Artwork",
            print_type="FLEXO",
            status="DRAFT",
        )

    def test_create_rejects_direct_approved_status(self):
        response = self.client.post(
            "/api/engineering/artworks/",
            {
                "design_code": "ART-API-2",
                "name": "Should Fail",
                "print_type": "FLEXO",
                "status": "APPROVED",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.content)
        self.assertFalse(Artwork.objects.filter(design_code="ART-API-2").exists())

    def test_patch_rejects_direct_approval_metadata_writes(self):
        response = self.client.patch(
            f"/api/engineering/artworks/{self.artwork.id}/",
            {
                "approved_by": str(self.user.id),
                "approved_at": "2026-03-14T00:00:00Z",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.content)
        self.artwork.refresh_from_db()
        self.assertIsNone(self.artwork.approved_by)
        self.assertIsNone(self.artwork.approved_at)

    def test_patch_rejects_direct_approved_status(self):
        response = self.client.patch(
            f"/api/engineering/artworks/{self.artwork.id}/",
            {"status": "APPROVED"},
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.content)
        self.artwork.refresh_from_db()
        self.assertEqual(self.artwork.status, "DRAFT")

    def test_approve_action_remains_the_only_approval_path(self):
        with patch(
            "apps.artwork.services.ArtworkService.approve_artwork",
            return_value=SimpleNamespace(id=self.artwork.id),
        ) as approve_artwork:
            response = self.client.post(
                f"/api/engineering/artworks/{self.artwork.id}/approve/",
                {},
                format="json",
            )

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(str(response.data["id"]), str(self.artwork.id))
        approve_artwork.assert_called_once_with(str(self.artwork.id), self.user)

    def test_patch_persists_uploaded_artwork_image_and_returns_url(self):
        upload = SimpleUploadedFile(
            "artwork-preview.png",
            b"not-a-production-image-but-a-valid-upload-payload",
            content_type="image/png",
        )

        response = self.client.patch(
            f"/api/engineering/artworks/{self.artwork.id}/",
            {"image": upload},
            format="multipart",
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.artwork.refresh_from_db()
        self.assertTrue(self.artwork.image.name)
        self.assertIn("/media/artworks/", response.data["image"])
        self.assertEqual(len(response.data["images"]), 1)
        self.assertIn("/media/artworks/", response.data["primary_image"])

    def test_patch_persists_up_to_three_artwork_images(self):
        uploads = [
            SimpleUploadedFile(f"artwork-preview-{index}.png", f"payload-{index}".encode(), content_type="image/png")
            for index in range(3)
        ]

        response = self.client.patch(
            f"/api/engineering/artworks/{self.artwork.id}/",
            {"images": uploads},
            format="multipart",
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.artwork.refresh_from_db()
        self.assertEqual(ArtworkImage.objects.filter(artwork=self.artwork).count(), 3)
        self.assertEqual(len(response.data["images"]), 3)
        self.assertEqual(response.data["primary_image"], response.data["images"][0]["image"])

    def test_patch_finalized_artwork_creates_new_current_version(self):
        vendor = Vendor.objects.create(name="Version Cylinder Vendor", code="VER-CYL-VENDOR")
        plant = Plant.objects.create(name="Version Plant", code="VER-PLANT")
        location = InventoryLocation.objects.create(plant=plant, code="VER-TOOL", name="Version Tool Room", type="TOOLING")
        self.artwork.print_type = "ROTO"
        self.artwork.substrate_mode = "SHEET"
        self.artwork.front_colors = ["CYAN"]
        self.artwork.front_colors_count = 1
        self.artwork.color_list = ["CYAN"]
        self.artwork.colors_count = 1
        self.artwork.save()
        Cylinder.objects.create(
            code="CYL-VER-F1",
            name="Versioned Front Cylinder",
            artwork=self.artwork,
            engraving_vendor=vendor,
            storage_location=location,
            color_name="CYAN",
            diameter_mm=100,
            width_mm=500,
            circumference=314,
            cell_depth_microns=28,
            side="FRONT",
            side_slot_index=1,
            is_draft=False,
            lifecycle_status="ACTIVE",
            status="ACTIVE",
        )

        response = self.client.patch(
            f"/api/engineering/artworks/{self.artwork.id}/",
            {
                "substrate_mode": "TUBING",
                "front_colors": ["CYAN", "BLACK"],
                "back_colors": ["WHITE"],
                "front_colors_count": 2,
                "back_colors_count": 1,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.artwork.refresh_from_db()
        self.assertFalse(self.artwork.is_current_version)
        self.assertNotEqual(str(response.data["id"]), str(self.artwork.id))
        self.assertEqual(response.data["version"], self.artwork.version + 1)
        self.assertEqual(str(response.data["previous_version"]), str(self.artwork.id))
        self.assertEqual(response.data["substrate_mode"], "TUBING")
        self.assertEqual(response.data["front_colors"], ["CYAN", "BLACK"])
        self.assertEqual(response.data["back_colors"], ["WHITE"])

    def test_patch_rejects_more_than_three_artwork_images(self):
        uploads = [
            SimpleUploadedFile(f"artwork-preview-{index}.png", f"payload-{index}".encode(), content_type="image/png")
            for index in range(4)
        ]

        response = self.client.patch(
            f"/api/engineering/artworks/{self.artwork.id}/",
            {"images": uploads},
            format="multipart",
        )

        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(ArtworkImage.objects.filter(artwork=self.artwork).count(), 0)

    def test_sheet_artwork_clears_back_colors_instead_of_turning_into_tubing(self):
        response = self.client.patch(
            f"/api/engineering/artworks/{self.artwork.id}/",
            {
                "substrate_mode": "SHEET",
                "front_colors": ["CYAN"],
                "back_colors": ["BLACK"],
                "front_colors_count": 1,
                "back_colors_count": 1,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.artwork.refresh_from_db()
        self.assertEqual(self.artwork.substrate_mode, "SHEET")
        self.assertEqual(self.artwork.back_colors, [])
        self.assertEqual(self.artwork.back_colors_count, 0)

    def test_uploaded_roto_artwork_can_be_approved_after_cylinders_are_ready(self):
        artwork = Artwork.objects.create(
            design_code="ART-API-ROTO-1",
            name="Roto approval with image",
            print_type="ROTO",
            substrate_mode="TUBING",
            front_colors=["YELLOW"],
            back_colors=["BLACK"],
            front_colors_count=1,
            back_colors_count=1,
            color_list=["YELLOW", "BLACK"],
            colors_count=2,
            status="DRAFT",
        )
        vendor = Vendor.objects.create(name="Approval Cylinder Vendor", code="APR-CYL-VENDOR")
        plant = Plant.objects.create(name="Approval Plant", code="APR-PLANT")
        location = InventoryLocation.objects.create(plant=plant, code="TOOL", name="Tool Room", type="TOOLING")
        for side, color in (("FRONT", "YELLOW"), ("BACK", "BLACK")):
            Cylinder.objects.create(
                code=f"CYL-APR-{side}",
                name=f"Approval {side.title()} Cylinder",
                artwork=artwork,
                engraving_vendor=vendor,
                storage_location=location,
                color_name=color,
                diameter_mm=100,
                width_mm=500,
                circumference=314,
                cell_depth_microns=28,
                side=side,
                side_slot_index=1,
                is_draft=False,
                lifecycle_status="READY",
                status="ACTIVE",
            )
        upload = SimpleUploadedFile(
            "roto-artwork.png",
            b"roto-artwork-upload-payload",
            content_type="image/png",
        )

        upload_response = self.client.patch(
            f"/api/engineering/artworks/{artwork.id}/",
            {"image": upload, "update_in_place": "true"},
            format="multipart",
        )
        self.assertEqual(upload_response.status_code, 200, upload_response.content)

        saved_artwork_id = upload_response.data["id"]
        approve_response = self.client.post(
            f"/api/engineering/artworks/{saved_artwork_id}/approve/",
            {},
            format="json",
        )

        self.assertEqual(approve_response.status_code, 200, approve_response.content)
        saved_artwork = Artwork.objects.get(id=saved_artwork_id)
        self.assertEqual(saved_artwork.status, "APPROVED")
        self.assertTrue(saved_artwork.image.name)
