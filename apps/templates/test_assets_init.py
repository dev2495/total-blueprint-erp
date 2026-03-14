from django.test import TestCase
from apps.templates.models import TemplateBlueprint
from apps.artwork.services import ArtworkService
from apps.tooling.services import CylinderService


class AssetInitializationTest(TestCase):
    def setUp(self):
        self.template = TemplateBlueprint.objects.create(
            name="Test Mango Pouch",
            fg_type="POUCH",
        )

    def test_artwork_creation_from_template(self):
        artwork = ArtworkService.create_from_template(self.template.id)
        self.assertIsNotNone(artwork)
        self.assertEqual(artwork.colors_count, 0)
        self.assertEqual(len(artwork.color_list or []), 0)

    def test_cylinder_generation_for_artwork(self):
        artwork = ArtworkService.create_from_template(self.template.id)
        with self.assertRaises(ValueError):
            CylinderService.generate_for_artwork(artwork.id)

    def test_full_initialization_via_viewset_logic(self):
        artwork = ArtworkService.create_from_template(self.template.id)
        self.assertIsNotNone(artwork)
