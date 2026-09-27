import shutil
import tempfile
from pathlib import Path
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from apps.artwork.models import Artwork
from apps.artwork.tests.test_api_approval_controls import png_bytes, pdf_bytes


class ArtworkUploadSecurityTests(TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root)
        self.override = override_settings(MEDIA_ROOT=self.root)
        self.override.enable()
        self.addCleanup(self.override.disable)
        self.client = APIClient()
        self.user = get_user_model().objects.create_user(username='upload-review', extra_permissions=['engineering.manage', 'engineering.view'])
        self.client.force_authenticate(self.user)
        self.art = Artwork.objects.create(design_code='SEC-UPLOAD', name='Proof', print_type='FLEXO')
        self.url = f'/api/engineering/artworks/{self.art.pk}/'

    def test_every_alias_rejects_active_content_before_storage(self):
        for alias in ('image', 'images', 'images[]', 'artwork_images'):
            for name in ('attack.html', 'attack.svg', 'disguised.png', 'disguised.pdf'):
                with self.subTest(alias=alias, name=name):
                    upload = SimpleUploadedFile(name, b'<script>alert(document.cookie)</script>')
                    response = self.client.patch(self.url, {alias: upload}, format='multipart')
                    self.assertEqual(response.status_code, 400)
                    self.assertFalse(any(Path(self.root).rglob('*.*')))

    def test_valid_plural_cannot_hide_malicious_singleton(self):
        response = self.client.patch(self.url, {
            'image': SimpleUploadedFile('attack.html', b'<script>alert(1)</script>'),
            'images': SimpleUploadedFile('good.png', png_bytes()),
        }, format='multipart')
        self.assertEqual(response.status_code, 400)
        self.assertFalse(any(Path(self.root).rglob('*.*')))

    def test_authenticated_controls_and_anonymous_legacy_media(self):
        for name, payload in (('image.png', png_bytes()), ('proof.pdf', pdf_bytes())):
            response = self.client.patch(self.url, {'image': SimpleUploadedFile(name, payload)}, format='multipart')
            self.assertEqual(response.status_code, 200, response.data)
            path = response.data['image'].split('testserver')[-1]
            media = self.client.get(path, HTTP_ACCEPT='application/pdf' if name.endswith('.pdf') else 'image/png')
            self.assertEqual(media.status_code, 200)
            self.assertIn('sandbox', media['Content-Security-Policy'])
            self.assertEqual(media['X-Frame-Options'], 'SAMEORIGIN')
            self.assertIn(APIClient().get(path).status_code, (401, 403))
        legacy = Path(self.root)/'artworks'/'legacy.html'
        legacy.write_text('<script>alert(1)</script>')
        media = self.client.get('/media/artworks/legacy.html')
        self.assertEqual(media['Content-Type'], 'application/octet-stream')
        self.assertEqual(media['Content-Disposition'], 'attachment')

    @override_settings(STRICT_RBAC=True)
    def test_authenticated_user_without_artwork_permission_cannot_read_media(self):
        folder = Path(self.root) / 'artworks'
        folder.mkdir()
        (folder / 'private.png').write_bytes(png_bytes())
        outsider = get_user_model().objects.create_user(username='no-artwork-permission')
        self.client.force_authenticate(outsider)
        self.assertEqual(self.client.get('/media/artworks/private.png').status_code, 403)
