from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.artwork.models import Artwork
from apps.users.models import Role


class ArtworkApiApprovalControlTests(TestCase):
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
