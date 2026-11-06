"""Floor screens read a job's own artwork with production rights; the engineering library stays closed."""
import shutil
import tempfile
from pathlib import Path
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.artwork.models import Artwork, ArtworkImage
from apps.artwork.tests.test_api_approval_controls import png_bytes
from apps.production.tests.test_wcm_audit_events import WcmAuditEventTests

RESOLVER = "apps.production.services.queue_enrichment.resolve_committed_artwork"


@override_settings(STRICT_RBAC=True)
class JobArtworkAccessTests(TestCase):
    """Borrows the WCM fixture: a Work Center Manager (no engineering rights) and one job at their WC."""

    def setUp(self):
        WcmAuditEventTests.setUp(self)
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root)
        media = override_settings(MEDIA_ROOT=self.root)
        media.enable()
        self.addCleanup(media.disable)
        self.artwork = Artwork.objects.create(design_code="QR-CODE", name="QR CODE", print_type="ROTO")
        self.image = ArtworkImage.objects.create(artwork=self.artwork, image=SimpleUploadedFile("qr.png", png_bytes()))
        self.other = Artwork.objects.create(design_code="OTHER", name="Other job art", print_type="ROTO")
        self.other_image = ArtworkImage.objects.create(artwork=self.other, image=SimpleUploadedFile("other.png", png_bytes()))
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_wcm_without_engineering_rights_sees_the_jobs_artwork_and_image(self):
        self.assertEqual(self.client.get(f"/api/engineering/artworks/{self.artwork.id}/").status_code, 403)
        with patch(RESOLVER, return_value=self.artwork):
            response = self.client.get(f"/api/production/jobs/{self.job.id}/artwork/")
            self.assertEqual(response.status_code, 200, response.data)
            self.assertEqual(response.data["artwork"]["design_code"], "QR-CODE")
            url = response.data["artwork"]["images"][0]["image"]
            self.assertEqual(url, f"/api/production/jobs/{self.job.id}/artwork-image/{self.image.id}/")
            image = self.client.get(url, HTTP_ACCEPT="image/png")
        self.assertEqual(image.status_code, 200)
        self.assertEqual(image["Content-Type"], "image/png")
        self.assertIn("sandbox", image["Content-Security-Policy"])
        self.assertEqual(b"".join(image.streaming_content), png_bytes())

    def test_only_the_jobs_own_artwork_images_are_served(self):
        with patch(RESOLVER, return_value=self.artwork):
            response = self.client.get(f"/api/production/jobs/{self.job.id}/artwork-image/{self.other_image.id}/", HTTP_ACCEPT="image/png")
        self.assertEqual(response.status_code, 404)

    def test_job_without_artwork(self):
        with patch(RESOLVER, return_value=None):
            response = self.client.get(f"/api/production/jobs/{self.job.id}/artwork/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, {"artwork": None, "cylinder_slots": []})

    def test_anonymous_cannot_read(self):
        self.assertIn(APIClient().get(f"/api/production/jobs/{self.job.id}/artwork/").status_code, (401, 403))
        self.assertTrue(Path(self.root, self.image.image.name).exists())
