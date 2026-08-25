import hashlib
import struct
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from django.conf import settings
from django.test import SimpleTestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.production.views import DeliveryChallanViewSet
from apps.production.services.dispatch_pdf import DispatchListPDFService, _line_spec, canvas


def _pdf_page_count(payload: bytes) -> int:
    return payload.count(b"/Type /Page") - payload.count(b"/Type /Pages")


def _ready_row(index: int, *, line_key: str = "line-1") -> dict:
    return {
        "sales_order_id": "so-1",
        "sales_order_item_id": line_key,
        "line_key": line_key,
        "so_line_no": str(index % 3 + 1),
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


def _snapshot_challan(
    rows: list[dict],
    *,
    balance_rows: list[dict] | None = None,
    version: int = 2,
) -> SimpleNamespace:
    snapshot = {
        "version": version,
        "document_type": "DISPATCH_SLIP",
        "document_ref": "DC-TEST-1",
        "document_date": "2026-07-28T10:30:00+05:30",
        "customer_name": "Test Customer",
        "sales_order_no": "SO-TEST-1",
        "sales_order_id": "so-1",
        "plant_name": "Main Plant",
        "rows": rows,
        "balance_rows": balance_rows or [],
    }
    if version == 3:
        snapshot.update(
            {
                "transporter_name": "Illustrative Test Transport",
                "delivery": {
                    "sales_order_id": "so-1",
                    "delivery_to": "Test Customer Warehouse",
                    "location": "Illustrative Test Location",
                },
            }
        )
    return SimpleNamespace(
        id="dc-1",
        dc_no="DC-TEST-1",
        status="DRAFT",
        sales_order_id="so-1",
        print_snapshot=snapshot,
    )


class DispatchPDFOutputTests(SimpleTestCase):
    def test_native_windows_setup_matches_source_and_backend_print_contract(self):
        root = Path(settings.BASE_DIR)
        source_dir = root / "deploy" / "windows" / "epson-fx2175ii"
        installer_path = (
            root
            / "frontend_v2"
            / "public"
            / "downloads"
            / "epson-fx2175ii"
            / "TotalPolyPrint-Epson-Setup.exe"
        )
        helper_source = (source_dir / "native-helper" / "main.go").read_text(encoding="utf-8")
        windows_source = (source_dir / "native-helper" / "platform_windows.go").read_text(
            encoding="utf-8"
        )
        prefix_numbers = ", ".join(str(value) for value in DispatchListPDFService.ESC_P_PREFIX.encode("ascii"))

        self.assertIn(f"requiredPrefix = []byte{{{prefix_numbers}}}", helper_source)
        self.assertIn("printer=EPSON-FX-2175II", helper_source)
        self.assertIn("paper=15x5.5", helper_source)
        self.assertIn('appVersion           = "3.0.1"', helper_source)
        self.assertIn("serverAccessAdminister  = 0x00000001", windows_source)
        self.assertNotIn("printerAccessAdminister", windows_source)

        installer = installer_path.read_bytes()
        self.assertGreater(len(installer), 1_000_000)
        self.assertEqual(installer[:2], b"MZ")
        pe_offset = struct.unpack_from("<I", installer, 0x3C)[0]
        self.assertEqual(installer[pe_offset : pe_offset + 4], b"PE\0\0")
        self.assertEqual(struct.unpack_from("<H", installer, pe_offset + 4)[0], 0x8664)

        checksum_path = installer_path.with_name("SHA256SUMS.txt")
        expected_hash, expected_name = checksum_path.read_text(encoding="ascii").strip().split(maxsplit=1)
        self.assertEqual(expected_name, installer_path.name)
        self.assertEqual(hashlib.sha256(installer).hexdigest(), expected_hash)

    def test_escp_job_explicitly_selects_readable_printer_modes(self):
        prefix = DispatchListPDFService.ESC_P_PREFIX.encode("ascii")

        # Retain compatibility with the helper already installed at the site.
        self.assertTrue(
            prefix.startswith(DispatchListPDFService.ESC_P_LEGACY_COMPAT_PREFIX.encode("ascii"))
        )
        # Never rely on the printer/driver default after ESC @ reset.
        self.assertIn(b"\x1bx\x01", prefix)  # NLQ
        self.assertIn(b"\x1bk\x00", prefix)  # Roman
        self.assertIn(b"\x1bU\x01", prefix)  # unidirectional
        self.assertTrue(prefix.endswith(b"\x1bF\x1bH"))  # cancel global emphasis/double-strike
        self.assertNotIn(b"\x1bx\x00", prefix)  # no Draft fallback
        self.assertTrue(DispatchListPDFService.ESC_P_SUFFIX.encode("ascii").startswith(b"\x1bU\x00"))

    def test_pdf_and_raw_have_separate_native_page_contracts(self):
        self.assertEqual(DispatchListPDFService.DOT_MATRIX_PAGE_SIZE, (15 * 72, 5.5 * 72))
        self.assertAlmostEqual(DispatchListPDFService.PDF_PAGE_SIZE[0], 841.89, places=1)
        self.assertAlmostEqual(DispatchListPDFService.PDF_PAGE_SIZE[1], 595.28, places=1)
        self.assertEqual(DispatchListPDFService.DOT_MATRIX_COLUMNS, 110)
        self.assertEqual(DispatchListPDFService.PDF_FONT_NAME, "Courier")
        self.assertEqual(DispatchListPDFService.PDF_FONT_SIZE, 12.0)
        self.assertGreaterEqual(DispatchListPDFService.PDF_MARGIN_LEFT, 24.0)
        self.assertGreaterEqual(DispatchListPDFService.PDF_MARGIN_TOP, 28.0)
        # Courier uses a 0.6-em advance. The canonical text form fits A4
        # landscape without a PDF viewer shrinking it.
        self.assertLess(
            (110 * 12.0 * 0.6) + DispatchListPDFService.PDF_MARGIN_LEFT,
            DispatchListPDFService.PDF_PAGE_SIZE[0],
        )

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
        self.assertEqual(spec["description"], "PET / LD")
        self.assertNotIn("16X20", spec["description"])
        self.assertNotIn("12", spec["description"])

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

    def test_line_spec_removes_version_size_micron_and_grade_repetition_from_layer_name(self):
        item = SimpleNamespace(
            id="soi-live-shape",
            line_name="MLD-LDMW-V3-V-495X80-T80U-1C72FB",
            axis_values={"size": "495X80"},
            geometry_snapshot={"finished_good_type": "ROLL", "base": {"width_mm": 495}},
            layer_snapshot=[
                {
                    "material_code": "LD-MW",
                    "grade_code": "20% METALLOCENE",
                    "thickness_micron": 80,
                }
            ],
            product_master=SimpleNamespace(code="MLD-LDMW-V3", name="Multilayer LDMW Sheet"),
            product_variant=SimpleNamespace(code="MLD-LDMW-V3-V-495X80-T80U-1C72FB"),
            template=None,
        )

        spec = _line_spec(item)

        self.assertEqual(spec["description"], "LD-MW")
        self.assertEqual(spec["grade"], "20% METALLOCENE")
        self.assertEqual(spec["size"], "495MM")
        self.assertEqual(spec["thickness"], "80")
        self.assertNotIn("V3", spec["description"])

    def test_render_includes_gonny_metadata_in_valid_pdf(self):
        if canvas is None:
            self.skipTest("reportlab not installed")

        roll = _ready_row(1)
        roll.update({"unit_type": "ROLL", "unit_id": "ROLL-1", "pcs": 0})
        gonny = _ready_row(2)
        gonny.update({"unit_type": "BAG", "unit_id": "G-BATCH-1-001", "pcs": 240})
        buffer = DispatchListPDFService.render(_snapshot_challan([roll, gonny]))

        self.assertTrue(buffer.getvalue().startswith(b"%PDF"))
        payload = buffer.getvalue().decode("latin-1", errors="ignore")
        self.assertIn("DISPATCH SLIP", payload)
        self.assertIn("UNIT NO.", payload)
        self.assertIn("LAYERS", payload)
        self.assertIn("MIC", payload)
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
        self.assertIn("/MediaBox [ 0 0 841", decoded)
        self.assertEqual(decoded.count("PACKING SLIP"), 1)
        self.assertEqual(decoded.count("CLIENT PREVIEW ONLY"), 0)
        self.assertNotIn("2 Tr", decoded)
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
        self.assertIn("LAYERS", text)
        self.assertIn("MIC", text)
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
        self.assertIn("size: A4 landscape", html)
        self.assertNotIn("size: 15in 5.5in", html)
        self.assertIn("font-weight: 400", html)
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

        self.assertTrue(payload.startswith(DispatchListPDFService.ESC_P_PREFIX.encode("ascii")))
        self.assertIn(b"\x1bx\x01", payload[:64])
        self.assertIn(b"\x1bU\x01", payload[:64])
        self.assertNotIn(b"\x0f", payload[:32])
        self.assertIn(b"PACKING SLIP", payload)
        self.assertNotIn(b"\n", payload.replace(b"\r\n", b""))
        self.assertTrue(payload.rstrip().endswith(DispatchListPDFService.ESC_P_SUFFIX.encode("ascii")))

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

        challan = _snapshot_challan(
            [_ready_row(index, line_key=f"line-{index % 2}") for index in range(1, 9)]
        )
        buffer = DispatchListPDFService.render(challan)

        payload = buffer.getvalue()
        decoded = payload.decode("latin-1", errors="ignore")
        self.assertEqual(_pdf_page_count(payload), 1)
        self.assertIn("/MediaBox [ 0 0 841", decoded)
        self.assertEqual(decoded.count("DISPATCH SLIP"), 1)
        self.assertEqual(decoded.count("VEHICLE :"), 0)
        self.assertNotIn("2 Tr", decoded)
        self.assertNotIn("CUT HERE", decoded)
        self.assertNotIn("(CONT.)", decoded)

    def test_dispatch_print_text_mode_keeps_same_columns(self):
        challan = _snapshot_challan(
            [_ready_row(index, line_key=f"line-{index % 2}") for index in range(1, 9)]
        )
        text = DispatchListPDFService.render_text(challan)

        text.encode("ascii")
        self.assertEqual(text.count("DISPATCH SLIP"), 1)
        self.assertEqual(text.count("VEHICLE :"), 0)
        self.assertIn("NO.", text)
        self.assertIn("UNIT NO.", text)
        self.assertIn("LAYERS", text)
        self.assertIn("MIC", text)
        self.assertIn("TARE", text)
        self.assertIn("NET", text)

    def test_dispatch_footer_replaces_signatures_with_sales_order_destination_and_transport(self):
        text = DispatchListPDFService.render_text(
            _snapshot_challan([_ready_row(1)], version=3)
        )

        self.assertIn("DELIVERY TO : Test Customer Warehouse", text)
        self.assertIn("TRANSPORT NAME : Illustrative Test Transport", text)
        self.assertIn("LOCATION : Illustrative Test Location", text)
        self.assertNotIn("Dispatch Incharge", text)
        self.assertNotIn("Security:", text)
        self.assertNotIn("Dispatch slip only", text)

    def test_grade_column_keeps_live_fifteen_character_grade_visible(self):
        row = _ready_row(1)
        row.update({"description": "LD-MW", "grade": "20% METALLOCENE", "size": "495MM", "thickness": "80"})

        text = DispatchListPDFService.render_text(_snapshot_challan([row], version=3))

        self.assertIn("20% METALLOCENE", text)
        self.assertNotIn("20% METAL.", text)

    def test_packing_slip_does_not_ask_for_or_print_dispatch_transport(self):
        sales_order = SimpleNamespace(id="so-1", order_number="SO-READY-1", customer_name="Ready Customer")
        with patch.object(
            DispatchListPDFService,
            "_load_ready_rows",
            return_value=(sales_order, [_ready_row(1)]),
        ):
            text = DispatchListPDFService.render_ready_slip_text("so-1")

        self.assertNotIn("DELIVERY TO :", text)
        self.assertNotIn("TRANSPORT NAME :", text)
        self.assertNotIn("LOCATION :", text)
        self.assertIn("Packed By", text)

    def test_photographed_eight_unit_challan_fits_one_form_and_shows_one_order(self):
        rows = []
        for index in range(1, 9):
            line_no = "9" if index <= 2 else "1"
            row = _ready_row(index, line_key=f"line-{line_no}")
            row["so_line_no"] = line_no
            rows.append(row)
        balances = [
            {"line": "9", "ordered": "500", "previous": "100", "current": "80", "balance": "320", "uom": "KG"},
            {"line": "1", "ordered": "900", "previous": "250", "current": "210", "balance": "440", "uom": "KG"},
        ]

        text = DispatchListPDFService.render_text(_snapshot_challan(rows, balance_rows=balances))

        pages = text.rstrip("\r\n").split("\f")
        self.assertEqual(len(pages), 1)
        self.assertLessEqual(len(pages[0].split("\r\n")), DispatchListPDFService.DOT_MATRIX_LINES_PER_PAGE)
        self.assertIn("ONE SO : SO-TEST-1", text)
        self.assertIn("SO ITEM 9 BALANCE", text)
        self.assertIn("SO ITEM 1 BALANCE", text)
        self.assertNotIn("LINE TOTAL", text)
        self.assertNotIn("BAL L", text)
        self.assertTrue(all(len(line) <= 110 for line in pages[0].split("\r\n")))

    def test_photographed_sixteen_unit_three_item_challan_fits_one_form(self):
        rows = []
        for index in range(1, 17):
            line_no = str(((index - 1) % 3) + 1)
            row = _ready_row(index, line_key=f"line-{line_no}")
            row["so_line_no"] = line_no
            rows.append(row)
        balances = [
            {"line": str(line), "ordered": "1000", "previous": "100", "current": "200", "balance": "700", "uom": "KG"}
            for line in range(1, 4)
        ]

        text = DispatchListPDFService.render_text(_snapshot_challan(rows, balance_rows=balances))

        pages = text.rstrip("\r\n").split("\f")
        self.assertEqual(len(pages), 1)
        self.assertLessEqual(len(pages[0].split("\r\n")), DispatchListPDFService.DOT_MATRIX_LINES_PER_PAGE)
        self.assertEqual(text.count("SO ITEM "), 3)

    def test_raw_job_uses_normal_body_and_selective_heading_emphasis(self):
        text = DispatchListPDFService.render_text(_snapshot_challan([_ready_row(1)]))

        payload = DispatchListPDFService._render_rows_escp(text).getvalue()

        prefix = DispatchListPDFService.ESC_P_PREFIX.encode("ascii")
        body = payload[len(prefix):]
        self.assertTrue(prefix.endswith(b"\x1bF\x1bH"))
        self.assertIn(b"\x1bETOTAL POLY PRINT", body)
        self.assertIn(b"\x1bENO.", body)
        self.assertIn(b"\x1bEBAGS:", body)
        detail = next(line for line in body.split(b"\r\n") if b"UNIT-001" in line)
        self.assertNotIn(b"\x1bE", detail)

    def test_frozen_snapshot_from_another_order_fails_closed(self):
        challan = _snapshot_challan([_ready_row(1)])
        challan.print_snapshot["sales_order_id"] = "so-other"

        with self.assertRaisesMessage(RuntimeError, "different sales order"):
            DispatchListPDFService.render_text(challan)

    def test_frozen_snapshot_foreign_or_unlinked_row_fails_closed(self):
        challan = _snapshot_challan([_ready_row(1)])
        challan.print_snapshot["rows"][0]["sales_order_id"] = "so-other"

        with self.assertRaisesMessage(RuntimeError, "foreign or unlinked"):
            DispatchListPDFService.render_text(challan)

        challan = _snapshot_challan([_ready_row(1)])
        challan.print_snapshot["rows"][0]["sales_order_item_id"] = ""
        with self.assertRaisesMessage(RuntimeError, "foreign or unlinked"):
            DispatchListPDFService.render_text(challan)

    def test_malformed_frozen_snapshot_contract_fails_closed(self):
        cases = (
            ("version", 1, "unsupported version"),
            ("document_type", "PACKING_LIST", "invalid document type"),
            ("document_ref", "DC-OTHER", "reference does not match"),
            ("sales_order_id", "", "different sales order"),
            ("rows", [], "no physical units"),
        )
        for field, value, message in cases:
            with self.subTest(field=field):
                challan = _snapshot_challan([_ready_row(1)])
                challan.print_snapshot[field] = value
                with self.assertRaisesMessage(RuntimeError, message):
                    DispatchListPDFService.render_text(challan)
