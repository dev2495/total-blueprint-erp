from types import SimpleNamespace
from unittest.mock import patch

from django.core.exceptions import ValidationError
from django.test import SimpleTestCase

from apps.artwork.services import ArtworkService


def _build_cylinder(*, side, slot, is_draft=False, cell_depth=28, lifecycle_status="READY"):
    return SimpleNamespace(
        side=side,
        side_slot_index=slot,
        is_draft=is_draft,
        code=f"CYL-{side}-{slot}",
        name=f"Cylinder {side}-{slot}",
        color_name="YELLOW",
        diameter_mm=100,
        width_mm=500,
        circumference=314,
        cell_depth_microns=cell_depth,
        lifecycle_status=lifecycle_status,
    )


class RotoApprovalGateTests(SimpleTestCase):
    @patch("apps.artwork.services.Artwork.objects.get")
    @patch("apps.artwork.services.Cylinder.objects.filter")
    def test_approval_fails_when_front_slots_are_missing(self, mock_filter, mock_get):
        artwork = SimpleNamespace(
            id="art-1",
            file_path="/tmp/art.png",
            image=None,
            front_colors_count=2,
            back_colors_count=0,
            front_colors=["YELLOW", "BLACK"],
            back_colors=[],
            print_type="ROTO",
        )
        mock_get.return_value = artwork
        mock_filter.side_effect = [
            [_build_cylinder(side="FRONT", slot=1)],
            [],
        ]

        with self.assertRaises(ValidationError) as exc:
            ArtworkService.approve_artwork("art-1", user=SimpleNamespace())

        self.assertIn("missing for slots [2]", str(exc.exception))

    @patch("apps.artwork.services.Artwork.objects.get")
    @patch("apps.artwork.services.Cylinder.objects.filter")
    def test_approval_fails_when_finalized_cylinder_is_technically_incomplete(self, mock_filter, mock_get):
        artwork = SimpleNamespace(
            id="art-2",
            file_path="/tmp/art.png",
            image=None,
            front_colors_count=1,
            back_colors_count=0,
            front_colors=["RED"],
            back_colors=[],
            print_type="ROTO",
        )
        mock_get.return_value = artwork
        mock_filter.side_effect = [
            [_build_cylinder(side="FRONT", slot=1, cell_depth=0)],
            [],
        ]

        with self.assertRaises(ValidationError) as exc:
            ArtworkService.approve_artwork("art-2", user=SimpleNamespace())

        self.assertIn("finalize cylinder technical details", str(exc.exception).lower())

    @patch("apps.artwork.services.Artwork.objects.get")
    @patch("apps.artwork.services.Cylinder.objects.filter")
    def test_approval_succeeds_when_roto_slots_are_finalized(self, mock_filter, mock_get):
        artwork = SimpleNamespace(
            id="art-3",
            file_path="/tmp/art.png",
            image=None,
            front_colors_count=1,
            back_colors_count=1,
            front_colors=["CYAN"],
            back_colors=["BLACK"],
            print_type="ROTO",
            status="DRAFT",
            color_list=[],
            colors_count=0,
            save=lambda: None,
        )
        mock_get.return_value = artwork
        mock_filter.side_effect = [
            [_build_cylinder(side="FRONT", slot=1)],
            [_build_cylinder(side="BACK", slot=1)],
        ]

        result = ArtworkService.approve_artwork("art-3", user=SimpleNamespace(username="qa"))

        self.assertEqual(result.status, "APPROVED")
        self.assertEqual(result.colors_count, 2)
