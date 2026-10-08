from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.artwork.models import Artwork
from apps.materials.models import ProductMaster
from apps.users.models import Role, User


@override_settings(STRICT_RBAC=True)
class ArtworkRevisionCommercialIdentityTests(TestCase):
    def setUp(self):
        role = Role.objects.create(code="ENGINEERING", name="Engineering")
        self.client = APIClient()
        self.client.force_authenticate(User.objects.create_user(username="revision-engineer", role=role))
        self.master = ProductMaster.objects.create(code="REVISION-MASTER", name="Original product")
        self.artwork = Artwork.objects.create(
            design_code="REVISION-ART", name="Approved artwork", status="APPROVED",
            product_master=self.master, design_family_code="DESIGN-FAMILY", colorway_name="Blue",
            front_colors=["CYAN"], front_colors_count=1,
        )

    def test_editing_approved_artwork_preserves_omitted_commercial_identity(self):
        response = self.client.patch(
            f"/api/engineering/artworks/{self.artwork.pk}/",
            {"name": "Revised artwork"}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        revised = Artwork.objects.get(pk=response.data["id"])
        self.assertNotEqual(revised.pk, self.artwork.pk)
        self.assertEqual(revised.previous_version_id, self.artwork.pk)
        self.assertEqual(revised.status, "DRAFT")
        self.assertEqual(revised.product_master_id, self.master.pk)
        self.assertEqual(revised.design_family_code, "DESIGN-FAMILY")
        self.assertEqual(revised.colorway_name, "Blue")
        self.artwork.refresh_from_db()
        self.assertFalse(self.artwork.is_current_version)
        self.assertEqual(self.artwork.product_master_id, self.master.pk)
        self.assertEqual(self.artwork.name, "Approved artwork")

    def test_revision_respects_explicit_identity_changes_and_clears(self):
        response = self.client.patch(
            f"/api/engineering/artworks/{self.artwork.pk}/",
            {"product_master": None, "design_family_code": "OTHER-FAMILY", "colorway_name": ""},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        revised = Artwork.objects.get(pk=response.data["id"])
        self.assertIsNone(revised.product_master_id)
        self.assertEqual(revised.design_family_code, "OTHER-FAMILY")
        self.assertEqual(revised.colorway_name, "")
