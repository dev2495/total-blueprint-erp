from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from apps.production.services.dispatch_pdf import DispatchListPDFService, _line_spec, canvas


def _pdf_page_count(payload: bytes) -> int:
    return payload.count(b"/Type /Page") - payload.count(b"/Type /Pages")


def _ready_row(index: int, *, line_key: str = "line-1") -> dict:
    return {
        "line_key": line_key,
        "description": "Ready pouch",
        "product_code": "PM-READY",
        "size": "16X20X240",
        "thickness": "12+60",
        "grade": "B+W",
        "unit_type": "BAG" if index % 2 else "ROLL",
        "unit_id": f"UNIT-{index:03d}",
        "batch_ref": f"BATCH-{index:03d}",
        "location": "Dispatch Bay",
        "pcs": 1200 if index % 2 else 0,
        "gross_kg": 34.66 + index,
        "tare_kg": 0.12,
        "net_kg": 34.54 + index,
    }


class DispatchPDFOutputTests(SimpleTestCase):
    def test_line_spec_uses_compact_multilayer_thickness(self):
        item = SimpleNamespace(
            id="soi-1",
            line_name="Printed pouch 16x20",
            axis_values={"size": "16X20X240"},
            geometry_snapshot={"finished_good_type": "POUCH"},
            layer_snapshot=[
                {"material_code": "PET", "thickness_micron": 12, "grade_code": "B+W"},
                {"material_code": "LD", "thickness_micron": 60, "grade_code": "MILKY"},
            ],
            product_master=SimpleNamespace(code="PM-POUCH", name="Printed pouch"),
            product_variant=SimpleNamespace(code="PM-POUCH-16X20"),
            template=SimpleNamespace(code="TPL-1", name="Pouch route"),
        )

        spec = _line_spec(item)

        self.assertEqual(spec["size"], "16X20X240")
        self.assertEqual(spec["thickness"], "12+60")
        self.assertEqual(spec["grade"], "B+W+MILKY")

    def test_line_spec_prefers_actual_geometry_over_size_code(self):
        item = SimpleNamespace(
            id="soi-2",
            line_name="Legacy code label",
            axis_values={"size": "SIZE-CODE-OLD"},
            geometry_snapshot={
                "finished_good_type": "POUCH",
                "base": {"width_mm": 16, "height_mm": 20, "gusset_mm": 240},
            },
            layer_snapshot=[],
            product_master=SimpleNamespace(code="PM-POUCH", name="Actual pouch master"),
            product_variant=None,
            template=None,
        )

        spec = _line_spec(item)

        self.assertEqual(spec["description"], "Actual pouch master")
        self.assertEqual(spec["size"], "16X20X240")

    def test_render_includes_gonny_metadata_in_valid_pdf(self):
        if canvas is None:
            self.skipTest("reportlab not installed")

        challan = SimpleNamespace(
            id="dc-1",
            dc_no="DC-TEST-1",
            status="DRAFT",
            customer_name="Test Customer",
            plant=SimpleNamespace(name="Main Plant"),
            vehicle_no="MH12AB1234",
            driver_name="Driver",
            driver_phone="9999999999",
            dispatch_date=None,
            sales_order_id="so-1",
        )

        with patch.object(DispatchListPDFService, "_safe_sales_order_number", return_value="SO-TEST-1"), \
             patch.object(
                 DispatchListPDFService,
                 "_load_item_rows",
                 return_value=[
                     {
                         "id": "item-roll",
                         "roll_id": "roll-1",
                         "packing_unit_id": None,
                         "fg_batch_id": None,
                         "weight_kg": 12.5,
                         "qty_pcs": None,
                         "roll_label": "ROLL-1",
                         "roll_batch_no": "BATCH-ROLL-1",
                         "material_name": "Roll Film",
                         "roll_location": "FG Store",
                         "gonny_label": None,
                         "gonny_content_mode": None,
                         "gonny_primary_pack_count": None,
                         "gonny_location": None,
                         "gonny_batch_number": None,
                         "batch_number": None,
                     },
                     {
                         "id": "item-gonny",
                         "roll_id": None,
                         "packing_unit_id": "gonny-1",
                         "fg_batch_id": None,
                         "weight_kg": 7.2,
                         "qty_pcs": 240,
                         "roll_label": None,
                         "roll_batch_no": None,
                         "material_name": None,
                         "roll_location": None,
                         "gonny_label": "G-BATCH-1-001",
                         "gonny_content_mode": "PRIMARY_PACKS",
                         "gonny_primary_pack_count": 6,
                         "gonny_location": "Packing Yard",
                         "gonny_batch_number": "BATCH-1",
                         "batch_number": None,
                     },
                 ],
             ):
            buffer = DispatchListPDFService.render(challan)

        self.assertTrue(buffer.getvalue().startswith(b"%PDF"))
        payload = buffer.getvalue().decode("latin-1", errors="ignore")
        self.assertIn("DISPATCH ITEM LIST", payload)
        self.assertIn("BAG/ROLL ID", payload)
        self.assertIn("DESCRIPTION", payload)
        self.assertIn("GROSS KG", payload)

    def test_render_ready_slip_is_client_safe_pdf(self):
        if canvas is None:
            self.skipTest("reportlab not installed")

        sales_order = SimpleNamespace(
            id="so-1",
            order_number="SO-READY-1",
            customer_name="Ready Customer",
        )

        with patch.object(
            DispatchListPDFService,
            "_load_ready_rows",
            return_value=(
                sales_order,
                [
                    {
                        "line_key": "line-1",
                        "description": "Ready pouch",
                        "product_code": "PM-READY",
                        "size": "16X20X240",
                        "thickness": "12+60",
                        "grade": "B+W",
                        "unit_type": "BAG",
                        "unit_id": "9631",
                        "batch_ref": "BATCH-1",
                        "location": "Dispatch Bay",
                        "pcs": 1200,
                        "gross_kg": 34.66,
                        "tare_kg": 0.12,
                        "net_kg": 34.54,
                    }
                ],
            ),
        ):
            buffer = DispatchListPDFService.render_ready_slip("so-1")

        self.assertTrue(buffer.getvalue().startswith(b"%PDF"))
        payload = buffer.getvalue().decode("latin-1", errors="ignore")
        self.assertIn("MATERIAL READY SLIP", payload)
        self.assertIn("CLIENT PREVIEW ONLY", payload)
        self.assertIn("PCS", payload)
        self.assertIn("NET KG", payload)
        self.assertNotIn("VEHICLE :", payload)

    def test_ready_slip_uses_single_page_dot_matrix_layout(self):
        if canvas is None:
            self.skipTest("reportlab not installed")

        sales_order = SimpleNamespace(
            id="so-1",
            order_number="SO-READY-1",
            customer_name="Ready Customer",
        )

        with patch.object(
            DispatchListPDFService,
            "_load_ready_rows",
            return_value=(
                sales_order,
                [_ready_row(index, line_key=f"line-{index % 3}") for index in range(1, 13)],
            ),
        ):
            buffer = DispatchListPDFService.render_ready_slip("so-1")

        payload = buffer.getvalue()
        decoded = payload.decode("latin-1", errors="ignore")
        self.assertEqual(_pdf_page_count(payload), 1)
        self.assertIn("/MediaBox [ 0 0 864 396 ]", decoded)
        self.assertIn("MATERIAL READY SLIP", decoded)
        self.assertNotIn("(CONT.)", decoded)

    def test_dispatch_print_list_uses_same_single_page_layout(self):
        if canvas is None:
            self.skipTest("reportlab not installed")

        challan = SimpleNamespace(
            id="dc-1",
            dc_no="DC-TEST-1",
            status="DRAFT",
            customer_name="Test Customer",
            plant=SimpleNamespace(name="Main Plant"),
            vehicle_no="MH12AB1234",
            transporter_name="Fast Roadlines",
            lr_number="LR-1",
            driver_name="Driver",
            driver_phone="9999999999",
            dispatch_date=None,
            sales_order_id="so-1",
        )

        with patch.object(DispatchListPDFService, "_safe_sales_order_number", return_value="SO-TEST-1"), \
             patch.object(
                 DispatchListPDFService,
                 "_load_item_rows",
                 return_value=[_ready_row(index, line_key=f"line-{index % 2}") for index in range(1, 9)],
             ):
            buffer = DispatchListPDFService.render(challan)

        payload = buffer.getvalue()
        decoded = payload.decode("latin-1", errors="ignore")
        self.assertEqual(_pdf_page_count(payload), 1)
        self.assertIn("/MediaBox [ 0 0 864 396 ]", decoded)
        self.assertIn("DISPATCH ITEM LIST", decoded)
        self.assertIn("VEHICLE :", decoded)
        self.assertNotIn("(CONT.)", decoded)
