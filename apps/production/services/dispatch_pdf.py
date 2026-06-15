from __future__ import annotations

from collections import OrderedDict
from decimal import Decimal
from io import BytesIO
from typing import Any

from django.utils import timezone

from apps.production.models import DeliveryChallan, DeliveryChallanItem, PackingUnit, RollDispatchPackRecord

try:
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas
except Exception:  # pragma: no cover
    A4 = None
    landscape = None
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
    size_code = _text(axis_values.get("size"), axis_values.get("size_code"), geometry.get("size_code"), geometry.get("label"))
    if size_code:
        return size_code

    base = _dict(geometry.get("base"))
    source = base if base else geometry
    width = source.get("width_mm") or source.get("width") or fallback_width
    height = source.get("height_mm") or source.get("height")
    gusset = source.get("gusset_mm") or source.get("gusset")
    fg_type = _text(geometry.get("finished_good_type"), geometry.get("fg_type")).upper()

    if fg_type == "ROLL" or (width and not height):
        return f"{_compact(width, 2)}MM" if width not in (None, "") else "-"
    parts = [_compact(width, 2) if width not in (None, "") else "", _compact(height, 2) if height not in (None, "") else ""]
    if gusset not in (None, "", 0, "0"):
        parts.append(_compact(gusset, 2))
    label = "X".join([part for part in parts if part])
    return label or "-"


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
    decorative assets so it prints predictably on continuous stationery.
    """

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
    def _load_ready_rows(cls, sales_order_id: str) -> tuple[Any, list[dict[str, Any]]]:
        from apps.production.services.dispatch_service import FGDispatchService
        from apps.inventory.models import InventoryRoll
        from apps.sales.models import SalesOrder

        sales_order = SalesOrder.objects.get(id=sales_order_id)
        summary = FGDispatchService.get_dispatchable_units_by_so(sales_order_id)
        roll_ids = [str(row.get("id")) for row in summary.get("rolls", []) if row.get("id")]
        gonny_ids = [str(row.get("id")) for row in summary.get("gonnies", []) if row.get("id")]

        rows: list[dict[str, Any]] = []
        for roll in (
            InventoryRoll.objects.filter(id__in=roll_ids)
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
            PackingUnit.objects.filter(id__in=gonny_ids)
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
        buffer = BytesIO()
        pdf = canvas.Canvas(buffer, pagesize=landscape(A4), pageCompression=0)
        width, height = landscape(A4)
        margin = 8 * mm

        def header(page_title: str):
            y = height - 10 * mm
            pdf.setFont("Courier-Bold", 13)
            pdf.drawString(margin, y, "TOTAL POLY PRINT ERP")
            pdf.setFont("Courier-Bold", 11)
            pdf.drawRightString(width - margin, y, page_title)
            y -= 5 * mm
            pdf.line(margin, y, width - margin, y)
            y -= 5 * mm
            pdf.setFont("Courier", 8.2)
            pdf.drawString(margin, y, f"REF : {_clip(doc_ref, 32)}")
            pdf.drawString(92 * mm, y, f"SO : {_clip(sales_order_no, 28)}")
            pdf.drawRightString(width - margin, y, f"PRINT : {cls._fmt_dt(timezone.now())}")
            y -= 4.5 * mm
            pdf.drawString(margin, y, f"CUSTOMER : {_clip(customer_name, 44)}")
            pdf.drawString(125 * mm, y, f"PLANT : {_clip(plant_name, 32)}")
            for line in transport_lines or []:
                y -= 4.5 * mm
                pdf.drawString(margin, y, _clip(line, 130))
            y -= 6 * mm
            cls._draw_table_header(pdf, y, margin, width)
            return y - 5 * mm

        y = header(title)
        grouped = cls._group_rows(normalized_rows)
        show_group = len(grouped) > 1
        line_no = 0
        for group_rows in grouped.values():
            if not group_rows:
                continue
            line_no += 1
            first = group_rows[0]
            if show_group:
                if y < 24 * mm:
                    pdf.showPage()
                    y = header(f"{title} (CONT.)")
                pdf.setFont("Courier-Bold", 7.7)
                pdf.drawString(
                    margin,
                    y,
                    _clip(
                        f"LINE {line_no}: {first.get('product_code')} / {first.get('description')}  SIZE {first.get('size')}  THK {first.get('thickness')}  GRADE {first.get('grade')}",
                        150,
                    ),
                )
                y -= 4.2 * mm
            for row in group_rows:
                if y < 18 * mm:
                    pdf.showPage()
                    y = header(f"{title} (CONT.)")
                cls._draw_row(pdf, y, margin, row, line_no)
                y -= 4.6 * mm
            if show_group:
                subtotal = cls._totals(group_rows)
                pdf.setFont("Courier-Bold", 7.2)
                pdf.drawRightString(
                    width - margin,
                    y,
                    f"LINE TOTAL  PCS {subtotal['pcs']}  GROSS KG {_compact(subtotal['gross'])}  TARE KG {_compact(subtotal['tare'])}  NET KG {_compact(subtotal['net'])}",
                )
                y -= 4 * mm

        if y < 28 * mm:
            pdf.showPage()
            y = header(f"{title} (TOTAL)")
        y -= 1 * mm
        pdf.line(margin, y, width - margin, y)
        y -= 5 * mm
        totals = cls._totals(normalized_rows)
        pdf.setFont("Courier-Bold", 8.5)
        pdf.drawString(margin, y, f"BAGS: {totals['bags']}   ROLLS: {totals['rolls']}   UNITS: {totals['units']}   PCS: {totals['pcs']}")
        pdf.drawRightString(
            width - margin,
            y,
            f"GROSS KG: {_compact(totals['gross'])}   TARE KG: {_compact(totals['tare'])}   NET KG: {_compact(totals['net'])}",
        )

        y -= 8 * mm
        pdf.setFont("Courier", 8)
        pdf.drawString(margin, y, "Dispatch Incharge: ____________________")
        pdf.drawString(112 * mm, y, "Driver: ____________________")
        pdf.drawString(192 * mm, y, "Receiver: ____________________")
        if footer_note:
            y -= 5 * mm
            pdf.drawString(margin, y, _clip(footer_note, 150))

        pdf.showPage()
        pdf.save()
        buffer.seek(0)
        return buffer

    @staticmethod
    def _draw_table_header(pdf, y, margin, width):
        pdf.setFont("Courier-Bold", 7.4)
        pdf.drawString(margin, y, "SR")
        pdf.drawString(17 * mm, y, "BAG/ROLL ID")
        pdf.drawString(56 * mm, y, "DESCRIPTION")
        pdf.drawString(128 * mm, y, "GRADE")
        pdf.drawString(162 * mm, y, "SIZE")
        pdf.drawString(199 * mm, y, "THK")
        pdf.drawRightString(226 * mm, y, "GROSS KG")
        pdf.drawRightString(247 * mm, y, "PCS")
        pdf.drawRightString(266 * mm, y, "TARE KG")
        pdf.drawRightString(width - margin, y, "NET KG")
        pdf.line(margin, y - 1.8 * mm, width - margin, y - 1.8 * mm)

    @staticmethod
    def _draw_row(pdf, y, margin, row: dict[str, Any], line_no: int):
        pdf.setFont("Courier", 7.25)
        pdf.drawString(margin, y, str(line_no))
        pdf.drawString(17 * mm, y, _clip(row.get("unit_id"), 18))
        pdf.drawString(56 * mm, y, _clip(row.get("description"), 34))
        pdf.drawString(128 * mm, y, _clip(row.get("grade"), 15))
        pdf.drawString(162 * mm, y, _clip(row.get("size"), 16))
        pdf.drawString(199 * mm, y, _clip(row.get("thickness"), 10))
        pdf.drawRightString(226 * mm, y, _compact(row.get("gross_kg")))
        pdf.drawRightString(247 * mm, y, str(_int(row.get("pcs"))) if _int(row.get("pcs")) else "-")
        pdf.drawRightString(266 * mm, y, _compact(row.get("tare_kg")))
        pdf.drawRightString(289 * mm, y, _compact(row.get("net_kg")))

    @classmethod
    def render(cls, challan: DeliveryChallan) -> BytesIO:
        rows = cls._load_item_rows(challan.id)
        transport_lines = [
            f"VEHICLE : {getattr(challan, 'vehicle_no', '') or '-'}   TRANSPORTER : {getattr(challan, 'transporter_name', '') or '-'}   LR : {getattr(challan, 'lr_number', '') or '-'}",
            f"DRIVER  : {getattr(challan, 'driver_name', '') or '-'} / {getattr(challan, 'driver_phone', '') or '-'}   DISPATCH : {cls._fmt_dt(getattr(challan, 'dispatch_date', None))}",
        ]
        return cls._render_rows_pdf(
            title="DISPATCH ITEM LIST",
            doc_ref=challan.dc_no,
            customer_name=challan.customer_name or "-",
            sales_order_no=cls._safe_sales_order_number(challan),
            plant_name=challan.plant.name if challan.plant else "-",
            rows=rows,
            transport_lines=transport_lines,
            footer_note="System generated dispatch slip. Verify physical loading before vehicle release.",
        )

    @classmethod
    def render_ready_slip(cls, sales_order_id: str) -> BytesIO:
        sales_order, rows = cls._load_ready_rows(sales_order_id)
        return cls._render_rows_pdf(
            title="MATERIAL READY SLIP",
            doc_ref=f"READY-{sales_order.order_number}",
            customer_name=sales_order.customer_name or "-",
            sales_order_no=sales_order.order_number or "-",
            plant_name="-",
            rows=rows,
            transport_lines=["CLIENT PREVIEW ONLY - NOT A DISPATCH CHALLAN"],
            footer_note="Material shown is physically ready in Packing Yard / Dispatch Bay as of print time.",
        )
