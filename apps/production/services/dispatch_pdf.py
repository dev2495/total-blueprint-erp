from __future__ import annotations

import re
from collections import OrderedDict
from decimal import Decimal
from html import escape
from io import BytesIO
from typing import Any

from django.utils import timezone

from apps.production.models import DeliveryChallan, DeliveryChallanItem, PackingUnit, RollDispatchPackRecord
from apps.production.serializers import _sales_item_display_label

try:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import inch, mm
    from reportlab.pdfgen import canvas
except Exception:  # pragma: no cover
    A4 = None
    inch = None
    mm = None
    canvas = None


def _dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _text(*values: Any) -> str:
    for value in values:
        raw = str(value or "").strip()
        if raw and raw.lower() not in {"none", "null", "undefined", "nan", "-"}:
            return raw
    return ""


def _dec(value: Any) -> Decimal:
    try:
        return Decimal(str(value or 0))
    except Exception:
        return Decimal("0")


def _int(value: Any) -> int:
    try:
        return int(Decimal(str(value or 0)))
    except Exception:
        return 0


def _compact(value: Any, places: int = 3) -> str:
    number = _dec(value)
    if not number:
        return "0"
    quant = Decimal("1") if number == number.to_integral_value() else Decimal("0." + ("0" * (places - 1)) + "1")
    formatted = f"{number.quantize(quant):f}"
    return formatted.rstrip("0").rstrip(".") if "." in formatted else formatted


def _clip(value: Any, width: int) -> str:
    raw = str(value or "").replace("\n", " ").strip()
    if len(raw) <= width:
        return raw
    return raw[: max(0, width - 1)] + "."


def _display_unit_id(value: Any, unit_type: str = "") -> str:
    raw = _text(value)
    if not raw:
        return "-"
    if len(raw) <= 18:
        return raw
    match = re.search(r"(?:^|-)(\d{2,5})(?:-(?:NEW|MOD|SPL|COMB|REM))?$", raw, re.I)
    if match:
        suffix = match.group(1).lstrip("0") or "0"
        return f"{'GNY' if str(unit_type).upper() == 'BAG' else 'RDU'}-{suffix}"
    token = re.sub(r"[^A-Z0-9]+", "", raw, flags=re.I)[-7:]
    return f"{'GNY' if str(unit_type).upper() == 'BAG' else 'RDU'}-{token or raw[-7:]}"


def _net_pcs_label(row: dict[str, Any]) -> str:
    pcs = _int(row.get("pcs"))
    net = _compact(row.get("net_kg"))
    return f"{net}/{pcs}pc" if pcs else net


def _layer_thickness_label(layers: list[Any], geometry: dict[str, Any]) -> str:
    values: list[str] = []
    for row in layers:
        if not isinstance(row, dict):
            continue
        thickness = (
            row.get("thickness_micron")
            or row.get("thickness_um")
            or row.get("fixed_thickness_um")
            or row.get("micron")
        )
        if thickness in (None, ""):
            continue
        label = _compact(thickness, 2)
        if label and label != "0":
            values.append(label)
    if not values:
        thickness = (
            geometry.get("thickness_um")
            or geometry.get("thickness_micron")
            or geometry.get("total_thickness_micron")
        )
        label = _compact(thickness, 2) if thickness not in (None, "") else ""
        if label and label != "0":
            values.append(label)
    return "+".join(values) if values else "-"


def _grade_label(layers: list[Any]) -> str:
    values: list[str] = []
    seen: set[str] = set()
    for row in layers:
        if not isinstance(row, dict):
            continue
        grade = _text(row.get("grade_code"), row.get("grade_name"), row.get("default_grade"), row.get("grade"))
        if not grade:
            continue
        key = grade.lower()
        if key in seen:
            continue
        seen.add(key)
        values.append(grade)
    return "+".join(values) if values else "-"


def _size_label(geometry: dict[str, Any], axis_values: dict[str, Any], fallback_width: Any = None) -> str:
    base = _dict(geometry.get("base"))
    source = base if base else geometry
    width = (
        source.get("width_mm")
        or source.get("width")
        or axis_values.get("width_mm")
        or axis_values.get("width")
        or fallback_width
    )
    height = source.get("height_mm") or source.get("height") or axis_values.get("height_mm") or axis_values.get("height")
    gusset = source.get("gusset_mm") or source.get("gusset") or axis_values.get("gusset_mm") or axis_values.get("gusset")
    fg_type = _text(geometry.get("finished_good_type"), geometry.get("fg_type")).upper()

    if fg_type == "ROLL" or (width and not height):
        if width not in (None, ""):
            return f"{_compact(width, 2)}MM"
    parts = [_compact(width, 2) if width not in (None, "") else "", _compact(height, 2) if height not in (None, "") else ""]
    if gusset not in (None, "", 0, "0"):
        parts.append(_compact(gusset, 2))
    label = "X".join([part for part in parts if part])
    if label:
        return label

    return _text(axis_values.get("size"), axis_values.get("size_code"), geometry.get("size_code"), geometry.get("label")) or "-"


def _line_spec(sales_order_item: Any, *, fallback_width: Any = None) -> dict[str, str]:
    if not sales_order_item:
        return {
            "line_key": "UNLINKED",
            "description": "SALES PRODUCT",
            "product_code": "-",
            "size": "-",
            "thickness": "-",
            "grade": "-",
        }

    geometry = _dict(getattr(sales_order_item, "geometry_snapshot", None))
    layers = _list(getattr(sales_order_item, "layer_snapshot", None))
    axis_values = _dict(getattr(sales_order_item, "axis_values", None))
    product_master = getattr(sales_order_item, "product_master", None)
    product_variant = getattr(sales_order_item, "product_variant", None)
    template = getattr(sales_order_item, "template", None)

    product_code = _text(
        getattr(product_variant, "code", ""),
        getattr(product_master, "code", ""),
        getattr(template, "code", ""),
    ) or "-"
    description = _text(
        _sales_item_display_label(sales_order_item),
        getattr(sales_order_item, "line_name", ""),
        getattr(product_master, "name", ""),
        getattr(product_variant, "code", ""),
        getattr(template, "name", ""),
        product_code,
        "SALES PRODUCT",
    )
    return {
        "line_key": str(getattr(sales_order_item, "id", "") or product_code or description),
        "description": description,
        "product_code": product_code,
        "size": _size_label(geometry, axis_values, fallback_width=fallback_width),
        "thickness": _layer_thickness_label(layers, geometry),
        "grade": _grade_label(layers),
    }


class DispatchListPDFService:
    """
    Dot-matrix friendly production dispatch and ready-slip PDFs.

    The layout intentionally uses Courier, black text, compact columns, and no
    decorative assets so it prints predictably on shop-floor printers.
    """

    DOT_MATRIX_PAGE_SIZE = (15 * inch, 5.5 * inch) if inch is not None else A4
    TEXT_RENDER_MODE_FILL_STROKE = 2
    TEXT_STROKE_WIDTH = 0.82
    TEXT_DARKEN_OFFSETS = ((0.0, 0.0),)
    DOT_MATRIX_COLUMNS = 132
    DOT_MATRIX_ENTRIES_PER_PAGE = 18
    DOT_MATRIX_LINES_PER_PAGE = 33
    ESC = "\x1b"
    # Epson FX-2175II native mode: reset, cancel condensed, select 10 CPI,
    # 1/6-inch line spacing, 33 lines (5.5 inches), no perforation skip,
    # then bold + double-strike for a dark and readable impact print.
    ESC_P_PREFIX = "\x1b@\x12\x1bP\x1b2\x1bC!\x1bO\x1bE\x1bG"
    ESC_P_SUFFIX = "\x1bH\x1bF\x12"
    TPP_PRINT_PACKAGE_HEADER = (
        b"TPPPRINT/1\n"
        b"printer=EPSON-FX-2175II\n"
        b"paper=15x5.5\n"
        b"language=ESC/P\n\n"
    )

    @staticmethod
    def _fmt_dt(value):
        if not value:
            return "-"
        local = timezone.localtime(value) if timezone.is_aware(value) else value
        return local.strftime("%d/%m/%Y %H:%M")

    @staticmethod
    def _safe_sales_order_number(challan: DeliveryChallan) -> str:
        sales_order = getattr(challan, "sales_order", None)
        if sales_order and getattr(sales_order, "order_number", None):
            return sales_order.order_number
        if not getattr(challan, "sales_order_id", None):
            return "-"
        try:
            from apps.sales.models import SalesOrder

            return SalesOrder.objects.only("order_number").get(id=challan.sales_order_id).order_number
        except Exception:
            return "-"

    @staticmethod
    def _roll_dispatch_record(roll_id: Any, sales_order_item_id: Any) -> RollDispatchPackRecord | None:
        if not roll_id or not sales_order_item_id:
            return None
        return (
            RollDispatchPackRecord.objects.filter(roll_id=roll_id, sales_order_item_id=sales_order_item_id)
            .order_by("-packed_at")
            .first()
        )

    @classmethod
    def _row_from_roll(cls, roll: Any, sales_order_item: Any = None, pack_record: Any = None) -> dict[str, Any]:
        sales_order_item = sales_order_item or getattr(roll, "sales_order_item", None)
        pack_record = pack_record or cls._roll_dispatch_record(getattr(roll, "id", None), getattr(sales_order_item, "id", None))
        pack_meta = _dict(getattr(pack_record, "meta_json", None))
        spec = _line_spec(sales_order_item, fallback_width=getattr(roll, "width_mm", None))
        net = _dec(getattr(roll, "net_weight_kg", None) or getattr(roll, "weight_kg", 0))
        tare = _dec(getattr(roll, "tare_weight_kg", 0))
        gross = _dec(getattr(roll, "gross_weight_kg", None) or net + tare)
        if gross < net:
            gross = net + tare
        return {
            **spec,
            "unit_type": "ROLL",
            "unit_id": _text(pack_meta.get("dispatch_unit_no"), f"RDU-{getattr(roll, 'batch_no', '') or getattr(roll, 'label_id', '')}", getattr(roll, "label_id", "")),
            "batch_ref": _text(getattr(roll, "batch_no", ""), getattr(roll, "label_id", "")),
            "location": _text(getattr(getattr(roll, "location", None), "name", ""), "-"),
            "pcs": 0,
            "net_kg": net,
            "tare_kg": tare,
            "gross_kg": gross,
        }

    @classmethod
    def _row_from_gonny(cls, gonny: PackingUnit) -> dict[str, Any]:
        meta = _dict(getattr(gonny, "meta_json", None))
        sales_order_item = getattr(gonny, "sales_order_item", None) or getattr(getattr(gonny, "fg_batch", None), "sales_order_item", None)
        spec = _line_spec(sales_order_item)
        net = _dec(getattr(gonny, "net_product_weight_kg", 0))
        tare = (
            _dec(getattr(gonny, "inner_pack_tare_kg", 0))
            + _dec(getattr(gonny, "secondary_pack_tare_kg", 0))
            + _dec(getattr(gonny, "extras_tare_kg", 0))
        )
        gross = _dec(getattr(gonny, "gross_weight_kg", None) or getattr(gonny, "weight_kg", None) or net + tare)
        if not tare and gross > net:
            tare = gross - net
        return {
            **spec,
            "unit_type": "BAG",
            "unit_id": _text(meta.get("dispatch_unit_no"), getattr(gonny, "label_id", "")),
            "batch_ref": _text(getattr(getattr(gonny, "fg_batch", None), "batch_number", ""), getattr(gonny, "label_id", "")),
            "location": _text(getattr(getattr(gonny, "location", None), "name", ""), "-"),
            "pcs": _int(getattr(gonny, "qty_pcs", 0)),
            "net_kg": net,
            "tare_kg": tare,
            "gross_kg": gross,
        }

    @classmethod
    def _row_from_legacy_dict(cls, item: dict[str, Any]) -> dict[str, Any]:
        is_roll = bool(item.get("roll_id"))
        is_gonny = bool(item.get("packing_unit_id"))
        net = _dec(
            item.get("roll_net_weight_kg")
            if is_roll
            else item.get("gonny_net_product_weight_kg")
            if is_gonny
            else item.get("weight_kg")
        )
        tare = _dec(item.get("roll_tare_weight_kg") if is_roll else item.get("gonny_tare_weight_kg"))
        gross = _dec(
            item.get("roll_gross_weight_kg")
            if is_roll
            else item.get("gonny_gross_weight_kg")
            if is_gonny
            else item.get("weight_kg")
        )
        if not net:
            net = gross or _dec(item.get("weight_kg"))
        if not tare and gross > net:
            tare = gross - net
        return {
            "line_key": str(item.get("sales_order_item_id") or "LEGACY"),
            "description": _text(item.get("description"), item.get("material_name"), "SALES PRODUCT"),
            "product_code": _text(item.get("product_code"), "-"),
            "size": _text(item.get("size"), "-"),
            "thickness": _text(item.get("thickness"), "-"),
            "grade": _text(item.get("grade"), "-"),
            "unit_type": "ROLL" if is_roll else "BAG" if is_gonny else "BATCH",
            "unit_id": _text(item.get("dispatch_unit_no"), item.get("roll_label"), item.get("gonny_label"), item.get("batch_number"), "-"),
            "batch_ref": _text(item.get("roll_batch_no"), item.get("gonny_batch_number"), item.get("batch_number"), "-"),
            "location": _text(item.get("roll_location"), item.get("gonny_location"), "-"),
            "pcs": _int(item.get("qty_pcs")),
            "net_kg": net,
            "tare_kg": tare,
            "gross_kg": gross or _dec(item.get("weight_kg")),
        }

    @classmethod
    def _load_item_rows(cls, challan_id):
        qs = (
            DeliveryChallanItem.objects.filter(challan_id=challan_id)
            .select_related(
                "roll__location",
                "roll__material",
                "roll__sales_order_item__sales_order",
                "roll__sales_order_item__template",
                "roll__sales_order_item__product_master",
                "roll__sales_order_item__product_variant",
                "packing_unit__location",
                "packing_unit__fg_batch",
                "packing_unit__sales_order_item__sales_order",
                "packing_unit__sales_order_item__template",
                "packing_unit__sales_order_item__product_master",
                "packing_unit__sales_order_item__product_variant",
                "sales_order_item__sales_order",
                "sales_order_item__template",
                "sales_order_item__product_master",
                "sales_order_item__product_variant",
            )
            .order_by("created_at", "id")
        )
        rows: list[dict[str, Any]] = []
        for item in qs:
            if item.roll_id:
                rows.append(cls._row_from_roll(item.roll, item.sales_order_item or item.roll.sales_order_item))
            elif item.packing_unit_id:
                rows.append(cls._row_from_gonny(item.packing_unit))
            else:
                spec = _line_spec(item.sales_order_item)
                rows.append(
                    {
                        **spec,
                        "unit_type": "BATCH",
                        "unit_id": getattr(getattr(item, "fg_batch", None), "batch_number", "") or "-",
                        "batch_ref": getattr(getattr(item, "fg_batch", None), "batch_number", "") or "-",
                        "location": "-",
                        "pcs": _int(item.qty_pcs),
                        "net_kg": _dec(item.weight_kg),
                        "tare_kg": Decimal("0"),
                        "gross_kg": _dec(item.weight_kg),
                    }
                )
        return rows

    @classmethod
    def _load_ready_rows(
        cls,
        sales_order_id: str,
        *,
        roll_ids: list[str] | None = None,
        gonny_ids: list[str] | None = None,
    ) -> tuple[Any, list[dict[str, Any]]]:
        from apps.production.services.dispatch_service import FGDispatchService
        from apps.inventory.models import InventoryRoll
        from apps.sales.models import SalesOrder

        sales_order = SalesOrder.objects.get(id=sales_order_id)
        summary = FGDispatchService.get_dispatchable_units_by_so(sales_order_id)
        ready_roll_ids = [str(row.get("id")) for row in summary.get("rolls", []) if row.get("id")]
        ready_gonny_ids = [str(row.get("id")) for row in summary.get("gonnies", []) if row.get("id")]
        if roll_ids is not None or gonny_ids is not None:
            requested_roll_ids = {str(value) for value in (roll_ids or []) if value}
            requested_gonny_ids = {str(value) for value in (gonny_ids or []) if value}
            ready_roll_ids = [value for value in ready_roll_ids if value in requested_roll_ids]
            ready_gonny_ids = [value for value in ready_gonny_ids if value in requested_gonny_ids]

        rows: list[dict[str, Any]] = []
        for roll in (
            InventoryRoll.objects.filter(id__in=ready_roll_ids)
            .select_related(
                "location",
                "sales_order_item__sales_order",
                "sales_order_item__template",
                "sales_order_item__product_master",
                "sales_order_item__product_variant",
            )
            .order_by("created_at", "id")
        ):
            rows.append(cls._row_from_roll(roll, roll.sales_order_item))

        for gonny in (
            PackingUnit.objects.filter(id__in=ready_gonny_ids)
            .select_related(
                "location",
                "fg_batch",
                "sales_order_item__sales_order",
                "sales_order_item__template",
                "sales_order_item__product_master",
                "sales_order_item__product_variant",
            )
            .order_by("created_at", "id")
        ):
            rows.append(cls._row_from_gonny(gonny))
        return sales_order, rows

    @staticmethod
    def _group_rows(rows: list[dict[str, Any]]) -> OrderedDict[str, list[dict[str, Any]]]:
        grouped: OrderedDict[str, list[dict[str, Any]]] = OrderedDict()
        for row in rows:
            grouped.setdefault(str(row.get("line_key") or "UNLINKED"), []).append(row)
        return grouped

    @staticmethod
    def _totals(rows: list[dict[str, Any]]) -> dict[str, Any]:
        return {
            "units": len(rows),
            "bags": sum(1 for row in rows if row.get("unit_type") == "BAG"),
            "rolls": sum(1 for row in rows if row.get("unit_type") == "ROLL"),
            "pcs": sum(_int(row.get("pcs")) for row in rows),
            "gross": sum((_dec(row.get("gross_kg")) for row in rows), Decimal("0")),
            "tare": sum((_dec(row.get("tare_kg")) for row in rows), Decimal("0")),
            "net": sum((_dec(row.get("net_kg")) for row in rows), Decimal("0")),
        }

    @staticmethod
    def _prime_black_ink(pdf):
        pdf.setFillGray(0)
        pdf.setStrokeGray(0)
        pdf.setLineWidth(1.65)

    @staticmethod
    def _heavy_text(pdf, x, y, value: Any, *, right: bool = False):
        text = str(value or "")
        if not text:
            return
        font_name = getattr(pdf, "_fontname", "Courier-Bold")
        font_size = getattr(pdf, "_fontsize", 8.8)
        origin_x = x - pdf.stringWidth(text, font_name, font_size) if right else x

        pdf.saveState()
        pdf.setFillGray(0)
        pdf.setStrokeGray(0)
        pdf.setLineWidth(DispatchListPDFService.TEXT_STROKE_WIDTH)
        try:
            for dx, dy in DispatchListPDFService.TEXT_DARKEN_OFFSETS:
                text_object = pdf.beginText()
                text_object.setTextOrigin(origin_x + dx, y + dy)
                text_object.setFont(font_name, font_size)
                text_object.setTextRenderMode(DispatchListPDFService.TEXT_RENDER_MODE_FILL_STROKE)
                text_object.textOut(text)
                pdf.drawText(text_object)
        except Exception:
            pdf.restoreState()
            draw = pdf.drawRightString if right else pdf.drawString
            draw(x, y, text)
            return
        pdf.restoreState()

    @classmethod
    def _render_rows_pdf(
        cls,
        *,
        title: str,
        doc_ref: str,
        customer_name: str,
        sales_order_no: str,
        plant_name: str,
        rows: list[dict[str, Any]],
        transport_lines: list[str] | None = None,
        footer_note: str = "",
    ) -> BytesIO:
        if canvas is None:
            raise RuntimeError("PDF engine unavailable: reportlab is not installed.")

        normalized_rows = [cls._row_from_legacy_dict(row) if "gross_kg" not in row else row for row in rows]
        grouped = cls._group_rows(normalized_rows)
        show_group = len(grouped) > 1
        buffer = BytesIO()
        page_size = cls.DOT_MATRIX_PAGE_SIZE or A4
        pdf = canvas.Canvas(buffer, pagesize=page_size, pageCompression=0)
        width, height = page_size
        margin = 5.2 * mm
        cls._prime_black_ink(pdf)
        row_step = 5.1 * mm
        row_font = 11.0
        header_font = 11.0
        entries: list[dict[str, Any]] = []
        line_no = 0
        row_no = 0
        for group_rows in grouped.values():
            if not group_rows:
                continue
            line_no += 1
            first = group_rows[0]
            if show_group:
                entries.append({"kind": "group", "line_no": line_no, "row": first})
            for row in group_rows:
                row_no += 1
                entries.append({"kind": "row", "row_no": row_no, "row": row})
            if show_group:
                entries.append({"kind": "subtotal", "subtotal": cls._totals(group_rows)})

        entries_per_page = cls.DOT_MATRIX_ENTRIES_PER_PAGE
        pages = [
            entries[index : index + entries_per_page]
            for index in range(0, len(entries), entries_per_page)
        ] or [[]]
        page_count = len(pages)
        totals = cls._totals(normalized_rows)

        def draw_page(page_entries: list[dict[str, Any]], page_number: int):
            cls._prime_black_ink(pdf)
            bottom = 4.0 * mm
            y = height - 7.2 * mm
            pdf.setFont("Courier-Bold", 15.0)
            cls._heavy_text(pdf, margin, y, "TOTAL POLY PRINT PVT LTD")
            pdf.setFont("Courier-Bold", 14.6)
            cls._heavy_text(pdf, width - margin, y, title, right=True)
            y -= 5.1 * mm
            pdf.setDash(3, 1.4)
            pdf.line(margin, y, width - margin, y)
            pdf.setDash()
            y -= 4.9 * mm
            pdf.setFont("Courier-Bold", 10.8)
            cls._heavy_text(pdf, margin, y, f"REF : {_clip(doc_ref, 31)}")
            cls._heavy_text(pdf, 92 * mm, y, f"SO : {_clip(sales_order_no, 26)}")
            cls._heavy_text(pdf, 183 * mm, y, f"DATE : {timezone.localdate().strftime('%d/%m/%y')}")
            cls._heavy_text(pdf, width - margin, y, f"PAGE : {page_number}/{page_count}", right=True)
            y -= 4.8 * mm
            cls._heavy_text(pdf, margin, y, f"CUSTOMER : {_clip(customer_name, 46)}")
            cls._heavy_text(pdf, 133 * mm, y, f"PLANT : {_clip(plant_name, 22)}")
            cls._heavy_text(pdf, width - margin, y, f"PRINT : {cls._fmt_dt(timezone.now())}", right=True)
            for line in transport_lines or []:
                y -= 4.3 * mm
                cls._heavy_text(pdf, margin, y, _clip(line, 112))
            y -= 5.0 * mm
            cls._draw_table_header(pdf, y, margin, width, header_font)
            y -= 4.7 * mm

            for entry in page_entries:
                kind = entry["kind"]
                if kind == "group":
                    first = entry["row"]
                    pdf.setFont("Courier-Bold", 8.8)
                    cls._heavy_text(
                        pdf,
                        margin,
                        y,
                        _clip(
                            f"LINE {entry['line_no']}: {first.get('product_code')} / {first.get('description')}  {first.get('size')}  {first.get('thickness')}  {first.get('grade')}",
                            112,
                        ),
                    )
                elif kind == "subtotal":
                    subtotal = entry["subtotal"]
                    pdf.setFont("Courier-Bold", 8.8)
                    cls._heavy_text(
                        pdf,
                        width - margin,
                        y,
                        f"LINE TOTAL  PCS {subtotal['pcs']}  GROSS {_compact(subtotal['gross'])}  TARE {_compact(subtotal['tare'])}  NET {_compact(subtotal['net'])}",
                        right=True,
                    )
                else:
                    cls._draw_row(pdf, y, margin, width, entry["row"], entry["row_no"], row_font)
                y -= row_step

            if page_number < page_count:
                pdf.setFont("Courier-Bold", 8.0)
                cls._heavy_text(pdf, margin, bottom + 10 * mm, "CONTINUED ON NEXT PAGE")
                return

            # Half-sheet continuous stationery has little vertical slack. Keep
            # totals directly after the table so 12-roll challans stay one side.
            totals_y = max(y - 1.6 * mm, bottom + 10 * mm)
            pdf.setLineWidth(1.35)
            pdf.line(margin, totals_y, width - margin, totals_y)
            totals_y -= 4.7 * mm
            pdf.setFont("Courier-Bold", 10.0)
            cls._heavy_text(
                pdf,
                margin,
                totals_y,
                f"BAGS: {totals['bags']}  ROLLS: {totals['rolls']}  UNITS: {totals['units']}  PCS: {totals['pcs']}",
            )
            cls._heavy_text(
                pdf,
                width - margin,
                totals_y,
                f"GROSS KG: {_compact(totals['gross'])}  TARE KG: {_compact(totals['tare'])}  NET KG: {_compact(totals['net'])}",
                right=True,
            )
            totals_y -= 5.7 * mm
            pdf.setFont("Courier-Bold", 8.9)
            cls._heavy_text(pdf, margin, totals_y, "Dispatch Incharge: __________________")
            cls._heavy_text(pdf, 104 * mm, totals_y, "Driver: ______________")
            cls._heavy_text(pdf, 195 * mm, totals_y, "Receiver: ______________")
            if footer_note:
                totals_y -= 4.2 * mm
                pdf.setFont("Courier-Bold", 8.0)
                cls._heavy_text(
                    pdf,
                    margin,
                    totals_y,
                    _clip(footer_note, 112),
                )

        for page_number, page_entries in enumerate(pages, start=1):
            if page_number > 1:
                cls._prime_black_ink(pdf)
            draw_page(page_entries, page_number)
            pdf.showPage()

        pdf.save()
        buffer.seek(0)
        return buffer

    @staticmethod
    def _draw_table_header(pdf, y, margin, width, font_size: float = 8.8):
        pdf.setFont("Courier-Bold", font_size)
        DispatchListPDFService._heavy_text(pdf, margin, y, "NO.")
        DispatchListPDFService._heavy_text(pdf, 15 * mm, y, "PS.NO.")
        DispatchListPDFService._heavy_text(pdf, 42 * mm, y, "DESCRIPTION")
        DispatchListPDFService._heavy_text(pdf, 160 * mm, y, "GRADE")
        DispatchListPDFService._heavy_text(pdf, 184 * mm, y, "SIZE")
        DispatchListPDFService._heavy_text(pdf, 209 * mm, y, "GSM")
        DispatchListPDFService._heavy_text(pdf, 234 * mm, y, "GROSS", right=True)
        DispatchListPDFService._heavy_text(pdf, 253 * mm, y, "PCS", right=True)
        DispatchListPDFService._heavy_text(pdf, 272 * mm, y, "TARE", right=True)
        DispatchListPDFService._heavy_text(pdf, width - margin, y, "NET", right=True)
        pdf.line(margin, y - 1.8 * mm, width - margin, y - 1.8 * mm)

    @staticmethod
    def _draw_row(pdf, y, margin, width, row: dict[str, Any], line_no: int, font_size: float = 8.8):
        pdf.setFont("Courier-Bold", font_size)
        DispatchListPDFService._heavy_text(pdf, margin, y, str(line_no))
        DispatchListPDFService._heavy_text(pdf, 15 * mm, y, _clip(_display_unit_id(row.get("unit_id"), row.get("unit_type")), 12))
        DispatchListPDFService._heavy_text(pdf, 42 * mm, y, _clip(row.get("description"), 48))
        DispatchListPDFService._heavy_text(pdf, 160 * mm, y, _clip(row.get("grade"), 10))
        DispatchListPDFService._heavy_text(pdf, 184 * mm, y, _clip(row.get("size"), 12))
        DispatchListPDFService._heavy_text(pdf, 209 * mm, y, _clip(row.get("thickness"), 8))
        DispatchListPDFService._heavy_text(pdf, 234 * mm, y, _compact(row.get("gross_kg")), right=True)
        DispatchListPDFService._heavy_text(pdf, 253 * mm, y, str(_int(row.get("pcs")) or "-"), right=True)
        DispatchListPDFService._heavy_text(pdf, 272 * mm, y, _compact(row.get("tare_kg")), right=True)
        DispatchListPDFService._heavy_text(pdf, width - margin, y, _compact(row.get("net_kg")), right=True)

    @classmethod
    def _render_rows_text(
        cls,
        *,
        title: str,
        doc_ref: str,
        customer_name: str,
        sales_order_no: str,
        plant_name: str,
        rows: list[dict[str, Any]],
        transport_lines: list[str] | None = None,
        footer_note: str = "",
    ) -> str:
        normalized_rows = [cls._row_from_legacy_dict(row) if "gross_kg" not in row else row for row in rows]
        grouped = cls._group_rows(normalized_rows)
        show_group = len(grouped) > 1
        entries: list[dict[str, Any]] = []
        line_no = 0
        row_no = 0
        for group_rows in grouped.values():
            if not group_rows:
                continue
            line_no += 1
            first = group_rows[0]
            if show_group:
                entries.append({"kind": "group", "line_no": line_no, "row": first})
            for row in group_rows:
                row_no += 1
                entries.append({"kind": "row", "row_no": row_no, "row": row})
            if show_group:
                entries.append({"kind": "subtotal", "subtotal": cls._totals(group_rows)})

        entries_per_page = cls.DOT_MATRIX_ENTRIES_PER_PAGE
        pages = [entries[index : index + entries_per_page] for index in range(0, len(entries), entries_per_page)] or [[]]
        page_count = len(pages)
        totals = cls._totals(normalized_rows)
        printed_at = cls._fmt_dt(timezone.now())
        today = timezone.localdate().strftime("%d/%m/%y")

        def clean(value: Any) -> str:
            return re.sub(r"\s+", " ", str(value or "").replace("\n", " ")).strip().encode("ascii", "replace").decode("ascii")

        def cell(value: Any, width: int, align: str = "left") -> str:
            text = clean(value)
            if len(text) > width:
                text = text[: max(0, width - 1)] + "."
            return text.rjust(width) if align == "right" else text.ljust(width)

        def row_line(values: list[tuple[Any, int, str]]) -> str:
            return " ".join(cell(value, width, align) for value, width, align in values).rstrip()

        def divider(char: str = "-") -> str:
            return char * cls.DOT_MATRIX_COLUMNS

        table_header = row_line(
            [
                ("NO.", 4, "left"),
                ("PS.NO.", 12, "left"),
                ("DESCRIPTION", 38, "left"),
                ("GRADE", 8, "left"),
                ("SIZE", 10, "left"),
                ("GSM", 7, "right"),
                ("GROSS", 10, "right"),
                ("PCS", 7, "right"),
                ("TARE", 8, "right"),
                ("NET", 10, "right"),
            ]
        )

        rendered_pages: list[str] = []
        for page_number, page_entries in enumerate(pages, start=1):
            lines: list[str] = []
            lines.append(row_line([("TOTAL POLY PRINT PVT LTD", 62, "left"), (title, 62, "right")]))
            lines.append(divider("="))
            lines.append(
                row_line(
                    [
                        (f"REF : {doc_ref}", 42, "left"),
                        (f"SO : {sales_order_no}", 34, "left"),
                        (f"DATE : {today}", 22, "left"),
                        (f"PAGE : {page_number}/{page_count}", 24, "right"),
                    ]
                )
            )
            lines.append(
                row_line(
                    [
                        (f"CUSTOMER : {customer_name}", 58, "left"),
                        (f"PLANT : {plant_name}", 26, "left"),
                        (f"PRINT : {printed_at}", 38, "right"),
                    ]
                )
            )
            for line in transport_lines or []:
                lines.append(cell(line, cls.DOT_MATRIX_COLUMNS))
            lines.append(table_header)
            lines.append(divider("-"))

            for entry in page_entries:
                kind = entry["kind"]
                if kind == "group":
                    first = entry["row"]
                    lines.append(
                        cell(
                            f"LINE {entry['line_no']}: {first.get('product_code')} / {first.get('description')}  {first.get('size')}  {first.get('thickness')}  {first.get('grade')}",
                            cls.DOT_MATRIX_COLUMNS,
                        )
                    )
                elif kind == "subtotal":
                    subtotal = entry["subtotal"]
                    lines.append(
                        cell(
                            f"LINE TOTAL PCS {subtotal['pcs']}  GROSS {_compact(subtotal['gross'])}  TARE {_compact(subtotal['tare'])}  NET {_compact(subtotal['net'])}",
                            cls.DOT_MATRIX_COLUMNS,
                            "right",
                        )
                    )
                else:
                    row = entry["row"]
                    lines.append(
                        row_line(
                            [
                                (entry["row_no"], 4, "left"),
                                (_display_unit_id(row.get("unit_id"), row.get("unit_type")), 12, "left"),
                                (row.get("description"), 38, "left"),
                                (row.get("grade"), 8, "left"),
                                (row.get("size"), 10, "left"),
                                (row.get("thickness"), 7, "right"),
                                (_compact(row.get("gross_kg")), 10, "right"),
                                (str(_int(row.get("pcs")) or "-"), 7, "right"),
                                (_compact(row.get("tare_kg")), 8, "right"),
                                (_compact(row.get("net_kg")), 10, "right"),
                            ]
                        )
                    )

            if page_number < page_count:
                lines.append("")
                lines.append("CONTINUED ON NEXT PAGE")
                rendered_pages.append("\n".join(lines))
                continue

            lines.append(divider("-"))
            lines.append(
                row_line(
                    [
                        (f"BAGS: {totals['bags']}  ROLLS: {totals['rolls']}  UNITS: {totals['units']}  PCS: {totals['pcs']}", 60, "left"),
                        (f"GROSS KG: {_compact(totals['gross'])}  TARE KG: {_compact(totals['tare'])}  NET KG: {_compact(totals['net'])}", 62, "right"),
                    ]
                )
            )
            lines.append("")
            lines.append(
                row_line(
                    [
                        ("Dispatch Incharge: ________________", 42, "left"),
                        ("Driver: ______________", 36, "left"),
                        ("Receiver: ______________", 36, "left"),
                    ]
                )
            )
            if footer_note:
                lines.append(clean(footer_note))
            rendered_pages.append("\n".join(lines))

        return "\f\n".join(rendered_pages).rstrip() + "\n"

    @classmethod
    def _render_rows_text_html(cls, text: str, *, title: str) -> str:
        pages = [page for page in text.rstrip("\n").split("\f\n") if page]
        if not pages:
            pages = [""]
        page_html = "\n".join(f'  <pre class="sheet">{escape(page)}</pre>' for page in pages)
        return f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>{escape(title)}</title>
  <style>
    @page {{ size: 15in 5.5in; margin: 0.2in; }}
    html, body {{ margin: 0; background: #fff; color: #000; }}
    body {{ padding: 0; }}
    .toolbar {{ display: flex; gap: 8px; padding: 8px 10px; border-bottom: 1px solid #111; font: 12px Arial, sans-serif; }}
    .toolbar button {{ border: 1px solid #111; background: #fff; color: #000; padding: 5px 9px; font-weight: 700; cursor: pointer; }}
    pre.sheet {{
      margin: 0;
      padding: 0;
      color: #000;
      background: #fff;
      font-family: "Courier New", Courier, monospace;
      font-size: 12pt;
      font-weight: 900;
      line-height: 1;
      letter-spacing: 0;
      white-space: pre;
      text-rendering: geometricPrecision;
      -webkit-font-smoothing: none;
      font-synthesis-weight: auto;
      page-break-after: always;
    }}
    pre.sheet:last-of-type {{
      page-break-after: auto;
    }}
    @media print {{
      .toolbar {{ display: none; }}
      pre.sheet {{
        font-size: 12pt;
        font-weight: 900;
        color: #000 !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }}
    }}
  </style>
</head>
<body>
  <div class="toolbar">
    <button onclick="window.print()">Print</button>
    <span>Browser fallback only. Select the 15 x 5.5 inch form and Actual size. For the Epson FX-2175II use Print on Epson in the ERP.</span>
  </div>
{page_html}
  <script>
    window.addEventListener("load", function () {{
      setTimeout(function () {{ window.print(); }}, 200);
    }});
  </script>
</body>
</html>"""

    @classmethod
    def _render_rows_escp(cls, text: str) -> BytesIO:
        payload = (cls.ESC_P_PREFIX + text + "\f" + cls.ESC_P_SUFFIX).encode("ascii", "replace")
        return BytesIO(payload)

    @classmethod
    def _package_escp(cls, escp_buffer: BytesIO) -> BytesIO:
        """Wrap a native ESC/P job in the validated contract used by the Windows helper."""
        return BytesIO(cls.TPP_PRINT_PACKAGE_HEADER + escp_buffer.getvalue())

    @classmethod
    def render(cls, challan: DeliveryChallan) -> BytesIO:
        rows = cls._load_item_rows(challan.id)
        transport_lines = [
            f"VEHICLE : {getattr(challan, 'vehicle_no', '') or '-'}   TRANSPORTER : {getattr(challan, 'transporter_name', '') or '-'}   LR : {getattr(challan, 'lr_number', '') or '-'}",
            f"DRIVER  : {getattr(challan, 'driver_name', '') or '-'} / {getattr(challan, 'driver_phone', '') or '-'}   DISPATCH : {cls._fmt_dt(getattr(challan, 'dispatch_date', None))}",
        ]
        return cls._render_rows_pdf(
            title="PACKING LIST",
            doc_ref=challan.dc_no,
            customer_name=challan.customer_name or "-",
            sales_order_no=cls._safe_sales_order_number(challan),
            plant_name=challan.plant.name if challan.plant else "-",
            rows=rows,
            transport_lines=transport_lines,
            footer_note="System generated dispatch slip. Verify physical loading before vehicle release.",
        )

    @classmethod
    def render_text(cls, challan: DeliveryChallan) -> str:
        rows = cls._load_item_rows(challan.id)
        transport_lines = [
            f"VEHICLE : {getattr(challan, 'vehicle_no', '') or '-'}   TRANSPORTER : {getattr(challan, 'transporter_name', '') or '-'}   LR : {getattr(challan, 'lr_number', '') or '-'}",
            f"DRIVER  : {getattr(challan, 'driver_name', '') or '-'} / {getattr(challan, 'driver_phone', '') or '-'}   DISPATCH : {cls._fmt_dt(getattr(challan, 'dispatch_date', None))}",
        ]
        return cls._render_rows_text(
            title="PACKING LIST",
            doc_ref=challan.dc_no,
            customer_name=challan.customer_name or "-",
            sales_order_no=cls._safe_sales_order_number(challan),
            plant_name=challan.plant.name if challan.plant else "-",
            rows=rows,
            transport_lines=transport_lines,
            footer_note="System generated dispatch slip. Verify physical loading before vehicle release.",
        )

    @classmethod
    def render_html(cls, challan: DeliveryChallan) -> str:
        return cls._render_rows_text_html(cls.render_text(challan), title=f"{challan.dc_no} packing list")

    @classmethod
    def render_escp(cls, challan: DeliveryChallan) -> BytesIO:
        return cls._render_rows_escp(cls.render_text(challan))

    @classmethod
    def render_tpp_print(cls, challan: DeliveryChallan) -> BytesIO:
        return cls._package_escp(cls.render_escp(challan))

    @classmethod
    def render_ready_slip(
        cls,
        sales_order_id: str,
        *,
        roll_ids: list[str] | None = None,
        gonny_ids: list[str] | None = None,
    ) -> BytesIO:
        sales_order, rows = cls._load_ready_rows(
            sales_order_id,
            roll_ids=roll_ids,
            gonny_ids=gonny_ids,
        )
        return cls._render_rows_pdf(
            title="MATERIAL READY LIST",
            doc_ref=f"READY-{sales_order.order_number}",
            customer_name=sales_order.customer_name or "-",
            sales_order_no=sales_order.order_number or "-",
            plant_name="-",
            rows=rows,
            transport_lines=["CLIENT PREVIEW ONLY - NOT A DISPATCH CHALLAN"],
            footer_note="Material shown is physically ready in Packing Yard / Dispatch Bay as of print time.",
        )

    @classmethod
    def render_ready_slip_text(
        cls,
        sales_order_id: str,
        *,
        roll_ids: list[str] | None = None,
        gonny_ids: list[str] | None = None,
    ) -> str:
        sales_order, rows = cls._load_ready_rows(
            sales_order_id,
            roll_ids=roll_ids,
            gonny_ids=gonny_ids,
        )
        return cls._render_rows_text(
            title="MATERIAL READY LIST",
            doc_ref=f"READY-{sales_order.order_number}",
            customer_name=sales_order.customer_name or "-",
            sales_order_no=sales_order.order_number or "-",
            plant_name="-",
            rows=rows,
            transport_lines=["CLIENT PREVIEW ONLY - NOT A DISPATCH CHALLAN"],
            footer_note="Material shown is physically ready in Packing Yard / Dispatch Bay as of print time.",
        )

    @classmethod
    def render_ready_slip_html(
        cls,
        sales_order_id: str,
        *,
        roll_ids: list[str] | None = None,
        gonny_ids: list[str] | None = None,
    ) -> str:
        text = cls.render_ready_slip_text(sales_order_id, roll_ids=roll_ids, gonny_ids=gonny_ids)
        return cls._render_rows_text_html(text, title=f"material-ready-{sales_order_id}")

    @classmethod
    def render_ready_slip_escp(
        cls,
        sales_order_id: str,
        *,
        roll_ids: list[str] | None = None,
        gonny_ids: list[str] | None = None,
    ) -> BytesIO:
        text = cls.render_ready_slip_text(sales_order_id, roll_ids=roll_ids, gonny_ids=gonny_ids)
        return cls._render_rows_escp(text)

    @classmethod
    def render_ready_slip_tpp_print(
        cls,
        sales_order_id: str,
        *,
        roll_ids: list[str] | None = None,
        gonny_ids: list[str] | None = None,
    ) -> BytesIO:
        escp_buffer = cls.render_ready_slip_escp(
            sales_order_id,
            roll_ids=roll_ids,
            gonny_ids=gonny_ids,
        )
        return cls._package_escp(escp_buffer)
