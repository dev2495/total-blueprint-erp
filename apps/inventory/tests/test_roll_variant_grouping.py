from django.test import SimpleTestCase

from apps.inventory.views import _group_rows_by_variant


class RollVariantGroupingTests(SimpleTestCase):
    def test_groups_rolls_by_family_then_physically_interchangeable_variant(self):
        rows = [
            {
                "id": "roll-1",
                "label_id": "ROLL-1",
                "family_display_name": "PET Printed Laminate",
                "form_label": "Pouch",
                "reporting_group": "LAMINATED",
                "variant_display_name": "PET Printed Laminate · 420 mm x 62 micron · Laminated",
                "size_line": "420 mm x 62 micron",
                "stage_name": "Laminated",
                "width_mm": 420,
                "thickness_micron": 62,
                "print_status": "Printed",
                "lamination_status": "Laminated",
                "stock_strategy": "INTERMEDIATE_POOL",
                "stock_strategy_label": "Intermediate pool",
                "status": "AVAILABLE",
                "weight_kg": 10.0,
                "plant_id": "plant-a",
                "plant_name": "Plant A",
                "location_name": "LAM Store",
                "created_at": "2026-03-10T10:00:00+05:30",
            },
            {
                "id": "roll-2",
                "label_id": "ROLL-2",
                "family_display_name": "PET Printed Laminate",
                "form_label": "Pouch",
                "reporting_group": "LAMINATED",
                "variant_display_name": "PET Printed Laminate · 420 mm x 62 micron · Laminated",
                "size_line": "420 mm x 62 micron",
                "stage_name": "Laminated",
                "width_mm": 420,
                "thickness_micron": 62,
                "print_status": "Printed",
                "lamination_status": "Laminated",
                "stock_strategy": "INTERMEDIATE_POOL",
                "stock_strategy_label": "Intermediate pool",
                "status": "RESERVED",
                "weight_kg": 6.5,
                "plant_id": "plant-a",
                "plant_name": "Plant A",
                "location_name": "Dispatch Store",
                "created_at": "2026-03-09T10:00:00+05:30",
            },
            {
                "id": "roll-3",
                "label_id": "ROLL-3",
                "family_display_name": "PET Printed Laminate",
                "form_label": "Pouch",
                "reporting_group": "LAMINATED",
                "variant_display_name": "PET Printed Laminate · 510 mm x 62 micron · Laminated",
                "size_line": "510 mm x 62 micron",
                "stage_name": "Laminated",
                "width_mm": 510,
                "thickness_micron": 62,
                "print_status": "Printed",
                "lamination_status": "Laminated",
                "stock_strategy": "INTERMEDIATE_POOL",
                "stock_strategy_label": "Intermediate pool",
                "status": "AVAILABLE",
                "weight_kg": 8.0,
                "plant_id": "plant-b",
                "plant_name": "Plant B",
                "location_name": "LAM Store",
                "created_at": "2026-03-08T10:00:00+05:30",
            },
        ]

        grouped = _group_rows_by_variant(rows)

        self.assertEqual(len(grouped), 1)
        family = grouped[0]
        self.assertEqual(family["family_display_name"], "PET Printed Laminate")
        self.assertEqual(family["total_roll_count"], 3)
        self.assertEqual(family["total_available_kg"], 18.0)
        self.assertEqual(family["total_reserved_kg"], 6.5)
        self.assertEqual(len(family["variants"]), 2)

        narrow_variant = next(variant for variant in family["variants"] if variant["size_line"] == "420 mm x 62 micron")
        self.assertEqual(narrow_variant["roll_count"], 2)
        self.assertEqual(narrow_variant["available_kg"], 10.0)
        self.assertEqual(narrow_variant["reserved_kg"], 6.5)
        self.assertEqual(len(narrow_variant["plant_summary"]), 1)
        self.assertEqual(
            narrow_variant["plant_summary"][0]["locations"],
            ["Dispatch Store", "LAM Store"],
        )

        wide_variant = next(variant for variant in family["variants"] if variant["size_line"] == "510 mm x 62 micron")
        self.assertEqual(wide_variant["roll_count"], 1)
        self.assertEqual(wide_variant["available_kg"], 8.0)
