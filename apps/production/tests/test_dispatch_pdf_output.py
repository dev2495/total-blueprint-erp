from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from zipfile import ZipFile

from django.conf import settings
from django.test import SimpleTestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.production.views import DeliveryChallanViewSet
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
    def test_windows_helper_zip_matches_source_and_backend_print_contract(self):
        root = Path(settings.BASE_DIR)
        source_dir = root / "deploy" / "windows" / "epson-fx2175ii"
        archive_path = (
            root
            / "frontend_v2"
            / "public"
            / "downloads"
            / "epson-fx2175ii"
            / "tpp-epson-print-helper.zip"
        )
        agent = (source_dir / "TppEpsonPrintAgent.ps1").read_text(encoding="ascii")
        prefix_numbers = ", ".join(str(value) for value in DispatchListPDFService.ESC_P_PREFIX.encode("ascii"))

        self.assertIn(f"$requiredPrefix = [byte[]]({prefix_numbers})", agent)
        self.assertIn('printer=EPSON-FX-2175II', agent)
        self.assertIn('paper=15x5.5', agent)
        with ZipFile(archive_path) as archive:
            for source_file in source_dir.iterdir():
                if source_file.is_file():
                    self.assertEqual(archive.read(source_file.name), source_file.read_bytes())

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

        self.assertEqual(spec["description"], "Legacy code label - 16x20+240G")
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
        self.assertIn("DISPATCH SLIP", payload)
        self.assertIn("UNIT NO.", payload)
        self.assertIn("ITEM DESCRIPTION", payload)
        self.assertIn("THK MIC", payload)
        self.assertIn("GROSS", payload)
        self.assertIn("PCS", payload)
        self.assertIn("TARE", payload)
        self.assertIn("NET", payload)

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
        self.assertIn("PACKING SLIP", payload)
        self.assertNotIn("CLIENT PREVIEW ONLY", payload)
        self.assertIn("PCS", payload)
        self.assertIn("NET", payload)
        self.assertNotIn("VEHICLE :", payload)

    def test_ready_slip_uses_single_full_page_copy(self):
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
                [_ready_row(index, line_key=f"line-{index % 3}") for index in range(1, 9)],
            ),
        ):
            buffer = DispatchListPDFService.render_ready_slip("so-1")

        payload = buffer.getvalue()
        decoded = payload.decode("latin-1", errors="ignore")
        self.assertEqual(_pdf_page_count(payload), 1)
        self.assertIn("/MediaBox [ 0 0 1080 396 ]", decoded)
        self.assertEqual(decoded.count("PACKING SLIP"), 1)
        self.assertEqual(decoded.count("CLIENT PREVIEW ONLY"), 0)
        self.assertGreaterEqual(decoded.count("2 Tr"), 1)
        self.assertNotIn("CUT HERE", decoded)
        self.assertNotIn("(CONT.)", decoded)

    def test_ready_slip_text_mode_is_single_copy_ascii(self):
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
                [_ready_row(index, line_key=f"line-{index % 3}") for index in range(1, 9)],
            ),
        ):
            text = DispatchListPDFService.render_ready_slip_text("so-1")

        text.encode("ascii")
        self.assertEqual(text.count("PACKING SLIP"), 1)
        self.assertEqual(text.count("CLIENT PREVIEW ONLY"), 0)
        self.assertIn("NO.", text)
        self.assertIn("UNIT NO.", text)
        self.assertIn("ITEM DESCRIPTION", text)
        self.assertIn("THK MIC", text)
        self.assertIn("GROSS", text)
        self.assertNotIn("CUT HERE", text)

    def test_ready_slip_html_uses_print_optimized_plain_text(self):
        sales_order = SimpleNamespace(
            id="so-1",
            order_number="SO-READY-1",
            customer_name="Ready Customer",
        )

        with patch.object(
            DispatchListPDFService,
            "_load_ready_rows",
            return_value=(sales_order, [_ready_row(1)]),
        ):
            html = DispatchListPDFService.render_ready_slip_html("so-1")

        self.assertIn('<pre class="sheet">', html)
        self.assertIn("size: 15in 5.5in", html)
        self.assertNotIn("size: A4", html)
        self.assertIn("font-weight: 900", html)
        self.assertIn("window.print()", html)
        self.assertIn("PACKING SLIP", html)

    def test_material_ready_slip_api_uses_non_drf_print_format_parameter(self):
        factory = APIRequestFactory()
        request = factory.get(
            "/api/production/challans/material-ready-slip/?sales_order_id=so-1&print_format=html"
        )
        force_authenticate(request, user=SimpleNamespace(pk=1, is_authenticated=True, is_superuser=True))
        view = DeliveryChallanViewSet.as_view({"get": "material_ready_slip"})

        with patch.object(
            DispatchListPDFService,
            "render_ready_slip_html",
            return_value="<html><body><pre>MATERIAL READY LIST</pre></body></html>",
        ) as renderer:
            response = view(request)

        self.assertEqual(response.status_code, 200)
        self.assertIn("text/html", response["Content-Type"])
        self.assertIn(b"MATERIAL READY LIST", response.content)
        renderer.assert_called_once_with("so-1", roll_ids=None, gonny_ids=None)

    def test_ready_slip_prn_uses_escp_text_mode_controls(self):
        sales_order = SimpleNamespace(
            id="so-1",
            order_number="SO-READY-1",
            customer_name="Ready Customer",
        )

        with patch.object(
            DispatchListPDFService,
            "_load_ready_rows",
            return_value=(sales_order, [_ready_row(1)]),
        ):
            payload = DispatchListPDFService.render_ready_slip_escp("so-1").getvalue()

        self.assertTrue(payload.startswith(b"\x1b@\x12\x1bP\x1b2\x1bC!\x1bO\x1bE\x1bG"))
        self.assertNotIn(b"\x0f", payload[:32])
        self.assertIn(b"PACKING SLIP", payload)
        self.assertNotIn(b"\n", payload.replace(b"\r\n", b""))
        self.assertTrue(payload.rstrip().endswith(b"\x1bH\x1bF\x12"))

    def test_ready_slip_tpp_package_has_validated_header_and_native_job(self):
        sales_order = SimpleNamespace(
            id="so-1",
            order_number="SO-READY-1",
            customer_name="Ready Customer",
        )

        with patch.object(
            DispatchListPDFService,
            "_load_ready_rows",
            return_value=(sales_order, [_ready_row(1)]),
        ):
            payload = DispatchListPDFService.render_ready_slip_tpp_print("so-1").getvalue()

        header, escp = payload.split(b"\n\n", 1)
        self.assertEqual(
            header,
            b"TPPPRINT/1\nprinter=EPSON-FX-2175II\npaper=15x5.5\nlanguage=ESC/P",
        )
        self.assertTrue(escp.startswith(DispatchListPDFService.ESC_P_PREFIX.encode("ascii")))
        self.assertIn(b"PACKING SLIP", escp)

    def test_material_ready_slip_api_downloads_tpp_package_without_cache(self):
        factory = APIRequestFactory()
        request = factory.get(
            "/api/production/challans/material-ready-slip/?sales_order_id=so-1&print_format=tpp",
            HTTP_ACCEPT="application/vnd.totalpolyprint.epson-raw",
        )
        force_authenticate(request, user=SimpleNamespace(pk=1, is_authenticated=True, is_superuser=True))
        view = DeliveryChallanViewSet.as_view({"get": "material_ready_slip"})
        payload = DispatchListPDFService.TPP_PRINT_PACKAGE_HEADER + b"\x1b@TEST\f"

        with patch.object(
            DispatchListPDFService,
            "render_ready_slip_tpp_print",
            return_value=BytesIO(payload),
        ) as renderer:
            response = view(request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "application/vnd.totalpolyprint.epson-raw")
        self.assertEqual(response["Cache-Control"], "no-store")
        self.assertIn("material-ready-so-1.tppprint", response["Content-Disposition"])
        self.assertEqual(b"".join(response.streaming_content), payload)
        renderer.assert_called_once_with("so-1", roll_ids=None, gonny_ids=None)

    def test_text_pages_fit_five_and_half_inch_form_at_six_lines_per_inch(self):
        sales_order = SimpleNamespace(
            id="so-1",
            order_number="SO-READY-1",
            customer_name="Ready Customer",
        )

        with patch.object(
            DispatchListPDFService,
            "_load_ready_rows",
            return_value=(sales_order, [_ready_row(index) for index in range(1, 29)]),
        ):
            text = DispatchListPDFService.render_ready_slip_text("so-1")

        pages = text.rstrip("\r\n").split("\f")
        self.assertEqual(len(pages), 2)
        self.assertTrue(
            all(len(page.splitlines()) <= DispatchListPDFService.DOT_MATRIX_LINES_PER_PAGE for page in pages)
        )

    def test_ready_slip_accepts_selected_unit_filters(self):
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
            return_value=(sales_order, [_ready_row(1)]),
        ) as loader:
            DispatchListPDFService.render_ready_slip(
                "so-1",
                roll_ids=["roll-1"],
                gonny_ids=["gonny-1"],
            )

        loader.assert_called_once_with(
            "so-1",
            roll_ids=["roll-1"],
            gonny_ids=["gonny-1"],
        )

    def test_dispatch_print_list_uses_single_full_page_copy(self):
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
        self.assertIn("/MediaBox [ 0 0 1080 396 ]", decoded)
        self.assertEqual(decoded.count("DISPATCH SLIP"), 1)
        self.assertEqual(decoded.count("VEHICLE :"), 0)
        self.assertGreaterEqual(decoded.count("2 Tr"), 1)
        self.assertNotIn("CUT HERE", decoded)
        self.assertNotIn("(CONT.)", decoded)

    def test_dispatch_print_text_mode_keeps_same_columns(self):
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
            text = DispatchListPDFService.render_text(challan)

        text.encode("ascii")
        self.assertEqual(text.count("DISPATCH SLIP"), 1)
        self.assertEqual(text.count("VEHICLE :"), 0)
        self.assertIn("NO.", text)
        self.assertIn("UNIT NO.", text)
        self.assertIn("ITEM DESCRIPTION", text)
        self.assertIn("THK MIC", text)
        self.assertIn("TARE", text)
        self.assertIn("NET", text)
