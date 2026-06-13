from types import SimpleNamespace
from unittest.mock import patch

from django.core.exceptions import ValidationError
from django.test import SimpleTestCase

from apps.artwork.services import ArtworkService


def _ink_contract():
    return {
        "ink_gsm_total": 1.2,
    }


def _build_cylinder(*, side, slot, is_draft=False, cell_depth=0, lifecycle_status="READY", vendor_id="vendor-1", circumference=314, width_mm=500):
    return SimpleNamespace(
        side=side,
        side_slot_index=slot,
        is_draft=is_draft,
        code=f"CYL-{side}-{slot}",
        name=f"Cylinder {side}-{slot}",
        color_name="YELLOW",
        diameter_mm=100,
        width_mm=width_mm,
        circumference=circumference,
        cell_depth_microns=cell_depth,
        engraving_vendor_id=vendor_id,
        storage_location_id="rack-1",
        lifecycle_status=lifecycle_status,
    )


class RotoApprovalGateTests(SimpleTestCase):
    @patch("apps.artwork.services.Artwork.objects.get")
    def test_approval_fails_when_artwork_asset_is_missing(self, mock_get):
        artwork = SimpleNamespace(
            id="art-missing-asset",
            file_path="",
            image=None,
            front_colors_count=1,
            back_colors_count=0,
            front_colors=["CYAN"],
            back_colors=[],
            print_type="FLEXO",
        )
        mock_get.return_value = artwork

        with self.assertRaises(ValidationError) as exc:
            ArtworkService.approve_artwork("art-missing-asset", user=SimpleNamespace())

        self.assertIn("uploaded file/image asset", str(exc.exception))

    @patch("apps.artwork.services.Artwork.objects.get")
    @patch("apps.artwork.print_contract.Cylinder.objects.filter")
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
            cylinder_circumference_mm=314,
            cylinder_length_mm=500,
            **_ink_contract(),
        )
        mock_get.return_value = artwork
        mock_filter.return_value.order_by.return_value = [_build_cylinder(side="FRONT", slot=1)]

        with self.assertRaises(ValidationError) as exc:
            ArtworkService.approve_artwork("art-1", user=SimpleNamespace())

        self.assertIn("missing for slots [2]", str(exc.exception))

    @patch("apps.artwork.services.Artwork.objects.get")
    @patch("apps.artwork.print_contract.Cylinder.objects.filter")
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
            cylinder_circumference_mm=314,
            cylinder_length_mm=500,
            **_ink_contract(),
        )
        mock_get.return_value = artwork
        mock_filter.return_value.order_by.return_value = [_build_cylinder(side="FRONT", slot=1, vendor_id="")]

        with self.assertRaises(ValidationError) as exc:
            ArtworkService.approve_artwork("art-2", user=SimpleNamespace())

        self.assertIn("finalize cylinder technical details", str(exc.exception).lower())

    @patch("apps.artwork.services.Artwork.objects.get")
    @patch("apps.artwork.print_contract.Cylinder.objects.filter")
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
            cylinder_circumference_mm=314,
            cylinder_length_mm=500,
            status="DRAFT",
            color_list=[],
            colors_count=0,
            save=lambda: None,
            **_ink_contract(),
        )
        mock_get.return_value = artwork
        mock_filter.return_value.order_by.return_value = [
            _build_cylinder(side="FRONT", slot=1),
            _build_cylinder(side="BACK", slot=1),
        ]

        result = ArtworkService.approve_artwork("art-3", user=SimpleNamespace(username="qa"))

        self.assertEqual(result.status, "APPROVED")
        self.assertEqual(result.colors_count, 2)

    @patch("apps.artwork.services.Artwork.objects.get")
    @patch("apps.artwork.print_contract.Cylinder.objects.filter")
    def test_approval_fails_when_duplicate_finalized_slots_exist(self, mock_filter, mock_get):
        artwork = SimpleNamespace(
            id="art-4",
            file_path="/tmp/art.png",
            image=None,
            front_colors_count=1,
            back_colors_count=0,
            front_colors=["YELLOW"],
            back_colors=[],
            print_type="ROTO",
            cylinder_circumference_mm=314,
            cylinder_length_mm=500,
            **_ink_contract(),
        )
        mock_get.return_value = artwork
        mock_filter.return_value.order_by.return_value = [
            _build_cylinder(side="FRONT", slot=1),
            _build_cylinder(side="FRONT", slot=1),
        ]

        with self.assertRaises(ValidationError) as exc:
            ArtworkService.approve_artwork("art-4", user=SimpleNamespace())

        self.assertIn("duplicate finalized cylinder coverage", str(exc.exception).lower())

    @patch("apps.artwork.services.Artwork.objects.get")
    @patch("apps.artwork.print_contract.Cylinder.objects.filter")
    def test_approval_fails_when_finalized_slot_is_out_of_range(self, mock_filter, mock_get):
        artwork = SimpleNamespace(
            id="art-5",
            file_path="/tmp/art.png",
            image=None,
            front_colors_count=1,
            back_colors_count=0,
            front_colors=["YELLOW"],
            back_colors=[],
            print_type="ROTO",
            cylinder_circumference_mm=314,
            cylinder_length_mm=500,
            **_ink_contract(),
        )
        mock_get.return_value = artwork
        mock_filter.return_value.order_by.return_value = [_build_cylinder(side="FRONT", slot=2)]

        with self.assertRaises(ValidationError) as exc:
            ArtworkService.approve_artwork("art-5", user=SimpleNamespace())

        self.assertIn("exceed the approved artwork slot range", str(exc.exception).lower())

    @patch("apps.artwork.services.Artwork.objects.get")
    @patch("apps.artwork.print_contract.Cylinder.objects.filter")
    def test_approval_fails_when_finalized_cylinder_length_does_not_match_artwork(self, mock_filter, mock_get):
        artwork = SimpleNamespace(
            id="art-length",
            file_path="/tmp/art.png",
            image=None,
            front_colors_count=1,
            back_colors_count=0,
            front_colors=["YELLOW"],
            back_colors=[],
            print_type="ROTO",
            cylinder_circumference_mm=314,
            cylinder_length_mm=650,
            status="DRAFT",
            color_list=[],
            colors_count=0,
            save=lambda: None,
            **_ink_contract(),
        )
        mock_get.return_value = artwork
        mock_filter.return_value.order_by.return_value = [_build_cylinder(side="FRONT", slot=1, width_mm=500)]

        with self.assertRaises(ValidationError) as exc:
            ArtworkService.approve_artwork("art-length", user=SimpleNamespace())

        self.assertIn("cylinder length must match artwork", str(exc.exception).lower())
