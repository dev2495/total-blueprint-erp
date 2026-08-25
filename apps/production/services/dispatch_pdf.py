from __future__ import annotations

import re
from collections import OrderedDict
from decimal import Decimal
from html import escape
from io import BytesIO
from typing import Any

from django.utils import timezone

from apps.production.models import DeliveryChallan, DeliveryChallanItem, PackingUnit, RollDispatchPackRecord

try:
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.units import inch, mm
    from reportlab.pdfgen import canvas
except Exception:  # pragma: no cover
    A4 = None
    landscape = None
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


def _layer_material_label(layers: list[Any]) -> str:
    """Return only the governed layer/material stack for the print description.

    Grade, size, micron and product-version data have their own columns and
    must not be repeated inside the layer name.
    """
    values: list[str] = []
    seen: set[str] = set()
    for row in layers:
        if not isinstance(row, dict):
            continue
        label = _text(
            row.get("material_code"),
            row.get("variant_code"),
            row.get("film_variant_code"),
            row.get("name"),
            row.get("material_name"),
            row.get("variant_name"),
            row.get("film_variant_name"),
        )
        if not label:
            continue
        key = label.casefold()
        if key in seen:
            continue
        seen.add(key)
        values.append(label)
    return " / ".join(values)


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
    overlay = getattr(sales_order_item, "customer_product_overlay", None)

    product_code = _text(
        getattr(overlay, "customer_item_code", ""),
        getattr(product_variant, "code", ""),
        getattr(product_master, "code", ""),
        getattr(template, "code", ""),
    ) or "-"
    description = _text(
        _layer_material_label(layers),
        getattr(product_master, "name", ""),
        getattr(template, "name", ""),
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
    PDF_PAGE_SIZE = landscape(A4) if landscape is not None and A4 is not None else A4
    # Vector PDF text must remain native fill-only text. The former 0.82 pt
    # outline expanded every Courier glyph by several printer pixels when the
    # Windows driver rasterized it for the FX-2175II, producing the blurred,
    # over-struck output seen on the physical form.
    TEXT_RENDER_MODE_FILL = 0
    TEXT_DARKEN_OFFSETS = ((0.0, 0.0),)
    # The legacy slip is an intentionally compact 110-column business form.
    # 132 columns made descriptions, group headings, and balances visually
    # merge even though the printer was correctly operating at 10 CPI.
    DOT_MATRIX_COLUMNS = 110
    DOT_MATRIX_ENTRIES_PER_PAGE = 18
    DOT_MATRIX_LINES_PER_PAGE = 31
    PDF_FONT_NAME = "Courier"
    PDF_BOLD_FONT_NAME = "Courier-Bold"
    PDF_FONT_SIZE = 12.0
    PDF_LINE_LEADING = 14.0
    # Keep office-printer content outside typical hardware non-printable
    # edges.  The 110-column form still fits A4 landscape at 10 CPI.
    PDF_MARGIN_LEFT = 24.0
    PDF_MARGIN_TOP = 30.0
    ESC = "\x1b"
    # Keep the original prefix first so helpers already installed at the
    # customer site continue to accept jobs generated after this upgrade.
    # The quality profile that follows is deliberately explicit: RAW spooler
    # jobs bypass the driver's graphic-quality choices, and ESC @ otherwise
    # restores the printer's configured (often Draft/Bi-D) defaults.
    ESC_P_LEGACY_COMPAT_PREFIX = "\x1b@\x12\x1bP\x1b2\x1bC!\x1bO\x1bE\x1bG"
    # ESC x 1 = NLQ, ESC k 0 = Roman, ESC U 1 = unidirectional. NLQ provides
    # the density; unidirectional motion prevents horizontal registration
    # drift. The legacy prefix must remain byte-for-byte first because the
    # helper already installed at the customer validates it.
    ESC_P_QUALITY_PROFILE = "\x1bx\x01\x1bk\x00\x1bU\x01"
    # ESC F / ESC H explicitly cancel emphasized and double-strike after the
    # compatibility prefix. Combining simulated bold with NLQ caused multiple
    # impacts to visually merge on the photographed continuous stationery.
    ESC_P_CLARITY_PROFILE = "\x1bF\x1bH"
    ESC_P_PREFIX = ESC_P_LEGACY_COMPAT_PREFIX + ESC_P_QUALITY_PROFILE + ESC_P_CLARITY_PROFILE
    # Restore direction/enhancement state after form feed without resetting or
    # moving the continuous paper again.
    ESC_P_SUFFIX = "\x1bU\x00\x1bH\x1bF\x12"
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
            "sales_order_item_id": str(getattr(sales_order_item, "id", "") or ""),
            "sales_order_id": str(getattr(sales_order_item, "sales_order_id", "") or ""),
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
            "sales_order_item_id": str(getattr(sales_order_item, "id", "") or ""),
            "sales_order_id": str(getattr(sales_order_item, "sales_order_id", "") or ""),
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
            "sales_order_item_id": str(item.get("sales_order_item_id") or ""),
            "sales_order_id": str(item.get("sales_order_id") or ""),
            "so_line_no": str(item.get("so_line_no") or ""),
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
                "roll__sales_order_item__customer_product_overlay",
                "packing_unit__location",
                "packing_unit__fg_batch",
                "packing_unit__sales_order_item__sales_order",
                "packing_unit__sales_order_item__template",
                "packing_unit__sales_order_item__product_master",
                "packing_unit__sales_order_item__product_variant",
                "packing_unit__sales_order_item__customer_product_overlay",
                "sales_order_item__sales_order",
                "sales_order_item__template",
                "sales_order_item__product_master",
                "sales_order_item__product_variant",
                "sales_order_item__customer_product_overlay",
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
                        "sales_order_item_id": str(getattr(item, "sales_order_item_id", "") or ""),
                        "sales_order_id": str(
                            getattr(getattr(item, "sales_order_item", None), "sales_order_id", "") or ""
                        ),
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

    @staticmethod
    def _sales_order_line_numbers(sales_order: Any) -> dict[str, int]:
        manager = getattr(sales_order, "items", None)
        if manager is None:
            return {}
        try:
            line_ids = manager.order_by("created_at", "id").values_list("id", flat=True)
        except Exception:
            return {}
        return {str(line_id): index for index, line_id in enumerate(line_ids, start=1)}

    @classmethod
    def _decorate_rows_for_sales_order(
        cls,
        sales_order: Any,
        rows: list[dict[str, Any]],
        *,
        require_lineage: bool = True,
    ) -> list[dict[str, Any]]:
        expected_order_id = str(getattr(sales_order, "id", "") or "")
        line_numbers = cls._sales_order_line_numbers(sales_order)
        decorated: list[dict[str, Any]] = []
        for source in rows:
            row = dict(source)
            row_order_id = str(row.get("sales_order_id") or "")
            if require_lineage and (not row_order_id or row_order_id != expected_order_id):
                raise RuntimeError("Dispatch document blocked: a physical unit is not linked to the selected sales order.")
            line_id = str(row.get("sales_order_item_id") or row.get("line_key") or "")
            row["sales_order_id"] = row_order_id or expected_order_id
            row["so_line_no"] = str(line_numbers.get(line_id) or row.get("so_line_no") or "-")
            decorated.append(row)
        return decorated

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
            unavailable_roll_ids = requested_roll_ids.difference(ready_roll_ids)
            unavailable_gonny_ids = requested_gonny_ids.difference(ready_gonny_ids)
            if unavailable_roll_ids or unavailable_gonny_ids:
                raise ValueError("Packing slip blocked: one or more selected units no longer belong to this sales order or are no longer dispatch-ready.")
            ready_roll_ids = [value for value in ready_roll_ids if value in requested_roll_ids]
            ready_gonny_ids = [value for value in ready_gonny_ids if value in requested_gonny_ids]

        if not ready_roll_ids and not ready_gonny_ids:
            raise ValueError("Packing slip blocked: no dispatch-ready units were selected.")

        rows: list[dict[str, Any]] = []
        rolls = list(
            InventoryRoll.objects.filter(id__in=ready_roll_ids)
            .select_related(
                "location",
                "sales_order_item__sales_order",
                "sales_order_item__template",
                "sales_order_item__product_master",
                "sales_order_item__product_variant",
                "sales_order_item__customer_product_overlay",
            )
            .order_by("created_at", "id")
        )
        if len(rolls) != len(set(ready_roll_ids)):
            raise RuntimeError("Packing slip blocked: selected roll data is incomplete.")
        for roll in rolls:
            rows.append(cls._row_from_roll(roll, roll.sales_order_item))

        gonnies = list(
            PackingUnit.objects.filter(id__in=ready_gonny_ids)
            .select_related(
                "location",
                "fg_batch",
                "sales_order_item__sales_order",
                "sales_order_item__template",
                "sales_order_item__product_master",
                "sales_order_item__product_variant",
                "sales_order_item__customer_product_overlay",
            )
            .order_by("created_at", "id")
        )
        if len(gonnies) != len(set(ready_gonny_ids)):
            raise RuntimeError("Packing slip blocked: selected packing-unit data is incomplete.")
        for gonny in gonnies:
            rows.append(cls._row_from_gonny(gonny))
        return sales_order, cls._decorate_rows_for_sales_order(sales_order, rows)

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
    def _json_row(row: dict[str, Any]) -> dict[str, Any]:
        """Return the stable, JSON-safe business fields used by every renderer."""
        return {
            "sales_order_id": str(row.get("sales_order_id") or ""),
            "sales_order_item_id": str(row.get("sales_order_item_id") or row.get("line_key") or ""),
            "line_key": str(row.get("line_key") or row.get("sales_order_item_id") or "UNLINKED"),
            "so_line_no": str(row.get("so_line_no") or "-"),
            "description": _text(row.get("description"), "SALES PRODUCT"),
            "product_code": _text(row.get("product_code"), "-"),
            "size": _text(row.get("size"), "-"),
            "thickness": _text(row.get("thickness"), "-"),
            "grade": _text(row.get("grade"), "-"),
            "unit_type": _text(row.get("unit_type"), "UNIT").upper(),
            "unit_id": _text(row.get("unit_id"), "-"),
            "batch_ref": _text(row.get("batch_ref"), "-"),
            "location": _text(row.get("location"), "-"),
            "pcs": _int(row.get("pcs")),
            "net_kg": _compact(row.get("net_kg"), 4),
            "tare_kg": _compact(row.get("tare_kg"), 4),
            "gross_kg": _compact(row.get("gross_kg"), 4),
        }

    @staticmethod
    def _challan_item_net(item: DeliveryChallanItem) -> Decimal:
        if getattr(item, "roll_id", None):
            roll = item.roll
            return _dec(getattr(roll, "net_weight_kg", None) or getattr(roll, "weight_kg", 0))
        if getattr(item, "packing_unit_id", None):
            gonny = item.packing_unit
            return _dec(getattr(gonny, "net_product_weight_kg", None) or getattr(gonny, "weight_kg", 0))
        return _dec(getattr(item, "weight_kg", 0))

    @classmethod
    def _balance_rows(cls, challan: DeliveryChallan, rows: list[dict[str, Any]]) -> list[dict[str, str]]:
        sales_order = getattr(challan, "sales_order", None)
        if not sales_order:
            return []

        current_by_line: dict[str, dict[str, Decimal]] = {}
        for row in rows:
            line_id = str(row.get("sales_order_item_id") or row.get("line_key") or "")
            if not line_id:
                continue
            bucket = current_by_line.setdefault(line_id, {"KG": Decimal("0"), "PCS": Decimal("0")})
            bucket["KG"] += _dec(row.get("net_kg"))
            bucket["PCS"] += Decimal(str(_int(row.get("pcs"))))

        prior_by_line: dict[str, dict[str, Decimal]] = {}
        prior_items = (
            DeliveryChallanItem.objects.filter(
                challan__sales_order_id=sales_order.id,
                challan__status__in=["DISPATCHED", "IN_TRANSIT", "DELIVERED"],
            )
            .exclude(challan_id=challan.id)
            .select_related("roll", "packing_unit")
        )
        for item in prior_items:
            line_id = str(getattr(item, "sales_order_item_id", "") or "")
            if not line_id:
                continue
            bucket = prior_by_line.setdefault(line_id, {"KG": Decimal("0"), "PCS": Decimal("0")})
            bucket["KG"] += cls._challan_item_net(item)
            bucket["PCS"] += Decimal(str(_int(getattr(item, "qty_pcs", 0))))

        balance_rows: list[dict[str, str]] = []
        for index, item in enumerate(sales_order.items.select_related(
            "template", "product_master", "product_variant", "customer_product_overlay"
        ).order_by("created_at", "id"), start=1):
            if str(getattr(item, "line_status", "") or "").upper() == "CANCELLED":
                continue
            line_id = str(item.id)
            # A dispatch document is evidence for the units physically loaded
            # on this challan. Printing every other open line from the parent
            # SO produced BAL L1..L13 on an eight-roll/two-item challan, made
            # one SO look like many orders, and forced a mostly blank page 1.
            if line_id not in current_by_line:
                continue
            uom = str(getattr(item, "qty_uom", "KG") or "KG").upper()
            if uom not in {"KG", "PCS"}:
                uom = "KG"
            ordered = max(
                _dec(getattr(item, "qty_value", 0))
                - _dec(getattr(item, "qty_cancelled", 0))
                - _dec(getattr(item, "qty_short_closed", 0)),
                Decimal("0"),
            )
            previous = prior_by_line.get(line_id, {}).get(uom, Decimal("0"))
            current = current_by_line.get(line_id, {}).get(uom, Decimal("0"))
            balance = max(ordered - previous - current, Decimal("0"))
            spec = _line_spec(item)
            balance_rows.append(
                {
                    "line": str(index),
                    "sales_order_item_id": line_id,
                    "description": _clip(spec.get("description"), 28),
                    "uom": uom,
                    "ordered": _compact(ordered),
                    "previous": _compact(previous),
                    "current": _compact(current),
                    "balance": _compact(balance),
                }
            )
        return balance_rows

    @classmethod
    def build_challan_snapshot(cls, challan: DeliveryChallan) -> dict[str, Any]:
        """Build the immutable dispatch document stored when the vehicle leaves."""
        sales_order = getattr(challan, "sales_order", None)
        if not sales_order or str(getattr(sales_order, "id", "") or "") != str(getattr(challan, "sales_order_id", "") or ""):
            raise RuntimeError("Dispatch document blocked: challan has no valid parent sales order.")
        source_rows = cls._decorate_rows_for_sales_order(sales_order, cls._load_item_rows(challan.id))
        if not source_rows:
            raise RuntimeError("Dispatch document blocked: challan has no physical units.")
        rows = [cls._json_row(row) for row in source_rows]
        document_date = getattr(challan, "dispatch_date", None) or getattr(challan, "created_at", None) or timezone.now()
        delivery = _dict(getattr(challan, "ship_to_address_snapshot", None))
        if not delivery.get("delivery_to") or not delivery.get("location"):
            from apps.production.services.dispatch_service import FGDispatchService

            canonical = FGDispatchService._sales_order_delivery_context(sales_order)
            delivery = {
                **delivery,
                "sales_order_id": str(challan.sales_order_id),
                "sales_order_number": cls._safe_sales_order_number(challan),
                "delivery_to": _text(
                    delivery.get("delivery_to"),
                    delivery.get("customer_name"),
                    canonical.get("delivery_to"),
                    challan.customer_name,
                ),
                "address": _text(delivery.get("address"), canonical.get("address")),
                "address_source": _text(delivery.get("address_source"), canonical.get("address_source")),
                "location": _text(
                    delivery.get("location"),
                    delivery.get("address"),
                    canonical.get("location"),
                ),
                "location_source": _text(delivery.get("location_source"), canonical.get("location_source")),
            }
        return {
            "version": 3,
            "document_type": "DISPATCH_SLIP",
            "document_ref": challan.dc_no,
            "document_date": document_date.isoformat(),
            "customer_name": challan.customer_name or "-",
            "sales_order_no": cls._safe_sales_order_number(challan),
            "sales_order_id": str(challan.sales_order_id),
            "plant_name": challan.plant.name if challan.plant else "-",
            "delivery": delivery,
            "transporter_name": _text(getattr(challan, "transporter_name", "")),
            "rows": rows,
            "balance_rows": cls._balance_rows(challan, source_rows),
        }

    @classmethod
    def _challan_document(cls, challan: DeliveryChallan) -> dict[str, Any]:
        snapshot = _dict(getattr(challan, "print_snapshot", None))
        if not snapshot:
            return cls.build_challan_snapshot(challan)

        expected_order_id = str(getattr(challan, "sales_order_id", "") or "")
        expected_ref = str(getattr(challan, "dc_no", "") or "")
        if snapshot.get("version") not in {2, 3}:
            raise RuntimeError("Dispatch document blocked: frozen snapshot uses an unsupported version.")
        if str(snapshot.get("document_type") or "") != "DISPATCH_SLIP":
            raise RuntimeError("Dispatch document blocked: frozen snapshot has an invalid document type.")
        if not expected_ref or str(snapshot.get("document_ref") or "") != expected_ref:
            raise RuntimeError("Dispatch document blocked: frozen snapshot reference does not match this challan.")
        snapshot_order_id = str(snapshot.get("sales_order_id") or "")
        if not expected_order_id or not snapshot_order_id or snapshot_order_id != expected_order_id:
            raise RuntimeError("Dispatch document blocked: frozen snapshot belongs to a different sales order.")
        rows = snapshot.get("rows")
        if not isinstance(rows, list) or not rows:
            raise RuntimeError("Dispatch document blocked: frozen snapshot has no physical units.")
        for row in rows:
            if not isinstance(row, dict):
                raise RuntimeError("Dispatch document blocked: frozen snapshot contains an invalid row.")
            row_order_id = str(row.get("sales_order_id") or "")
            row_item_id = str(row.get("sales_order_item_id") or "")
            if row_order_id != expected_order_id or not row_item_id:
                raise RuntimeError(
                    "Dispatch document blocked: frozen snapshot contains foreign or unlinked sales-order data."
                )
        if snapshot.get("version") == 3:
            delivery = snapshot.get("delivery")
            if not isinstance(delivery, dict):
                raise RuntimeError("Dispatch document blocked: frozen snapshot has invalid delivery data.")
            delivery_order_id = str(delivery.get("sales_order_id") or "")
            if delivery_order_id and delivery_order_id != expected_order_id:
                raise RuntimeError("Dispatch document blocked: frozen delivery data belongs to a different sales order.")
        return snapshot

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
        font_name = getattr(pdf, "_fontname", "Courier")
        font_size = getattr(pdf, "_fontsize", 8.8)
        origin_x = x - pdf.stringWidth(text, font_name, font_size) if right else x

        pdf.saveState()
        pdf.setFillGray(0)
        try:
            for dx, dy in DispatchListPDFService.TEXT_DARKEN_OFFSETS:
                text_object = pdf.beginText()
                text_object.setTextOrigin(origin_x + dx, y + dy)
                text_object.setFont(font_name, font_size)
                text_object.setTextRenderMode(DispatchListPDFService.TEXT_RENDER_MODE_FILL)
                text_object.textOut(text)
                pdf.drawText(text_object)
        except Exception:
            pdf.restoreState()
            draw = pdf.drawRightString if right else pdf.drawString
            draw(x, y, text)
            return
        pdf.restoreState()

    @staticmethod
    def _is_emphasis_line(line: str) -> bool:
        clean_line = str(line or "").strip()
        return bool(
            clean_line.startswith("TOTAL POLY PRINT")
            or clean_line.startswith("NO. ")
            or clean_line.startswith("BAGS:")
        )

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
        document_date: Any = None,
        balance_rows: list[dict[str, Any]] | None = None,
        signature_labels: tuple[str, str, str] | None = None,
        detail_lines: list[str] | None = None,
    ) -> BytesIO:
        if canvas is None:
            raise RuntimeError("PDF engine unavailable: reportlab is not installed.")
        text = cls._render_rows_text(
            title=title,
            doc_ref=doc_ref,
            customer_name=customer_name,
            sales_order_no=sales_order_no,
            plant_name=plant_name,
            rows=rows,
            transport_lines=transport_lines,
            footer_note=footer_note,
            document_date=document_date,
            balance_rows=balance_rows,
            signature_labels=signature_labels,
            detail_lines=detail_lines,
        )
        buffer = BytesIO()
        # PDF is the office-printer path. A4 landscape prevents a standard
        # printer driver from shrinking a 15-inch Epson form to the page.
        # Native tractor geometry is emitted only by the RAW ESC/P path.
        page_size = cls.PDF_PAGE_SIZE or A4
        pdf = canvas.Canvas(buffer, pagesize=page_size, pageCompression=0)
        _, height = page_size
        pages = text.rstrip("\r\n").split("\f")
        for page_number, page in enumerate(pages):
            if page_number:
                pdf.showPage()
            # Twelve-point Courier is exactly 10 CPI and keeps the canonical
            # 110-column form inside A4 landscape without viewer scaling.
            y = height - cls.PDF_MARGIN_TOP
            for line in page.replace("\r\n", "\n").split("\n"):
                pdf.setFont(
                    cls.PDF_BOLD_FONT_NAME if cls._is_emphasis_line(line) else cls.PDF_FONT_NAME,
                    cls.PDF_FONT_SIZE,
                )
                cls._heavy_text(pdf, cls.PDF_MARGIN_LEFT, y, line)
                y -= cls.PDF_LINE_LEADING
        pdf.save()
        buffer.seek(0)
        return buffer

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
        document_date: Any = None,
        balance_rows: list[dict[str, Any]] | None = None,
        signature_labels: tuple[str, str, str] | None = None,
        detail_lines: list[str] | None = None,
    ) -> str:
        normalized_rows = [cls._row_from_legacy_dict(row) if "gross_kg" not in row else dict(row) for row in rows]
        fallback_line_numbers: dict[str, int] = {}
        entries: list[dict[str, Any]] = []
        for row_no, row in enumerate(normalized_rows, start=1):
            line_key = str(row.get("sales_order_item_id") or row.get("line_key") or "UNLINKED")
            if line_key not in fallback_line_numbers:
                fallback_line_numbers[line_key] = len(fallback_line_numbers) + 1
            row["so_line_no"] = str(row.get("so_line_no") or fallback_line_numbers[line_key])
            entries.append({"row_no": row_no, "row": row})

        totals = cls._totals(normalized_rows)
        printed_at = cls._fmt_dt(timezone.now())
        if hasattr(document_date, "strftime"):
            slip_date = document_date.strftime("%d/%m/%y")
        else:
            raw_date = str(document_date or "")[:10]
            try:
                slip_date = timezone.datetime.fromisoformat(raw_date).strftime("%d/%m/%y")
            except (TypeError, ValueError):
                slip_date = timezone.localdate().strftime("%d/%m/%y")

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
                ("NO.", 3, "left"),
                ("ITEM", 4, "left"),
                ("UNIT NO.", 10, "left"),
                ("LAYERS", 25, "left"),
                ("GRADE", 16, "left"),
                ("SIZE", 10, "left"),
                ("MIC", 6, "right"),
                ("GROSS", 7, "right"),
                ("PCS", 6, "right"),
                ("TARE", 6, "right"),
                ("NET", 7, "right"),
            ]
        )

        balance_lines = []
        for balance in balance_rows or []:
            balance_lines.append(
                clean(
                    f"SO ITEM {balance.get('line') or '-'} BALANCE: "
                    f"ORDER {_compact(balance.get('ordered'))} | PREVIOUS {_compact(balance.get('previous'))} | "
                    f"THIS {_compact(balance.get('current'))} | BALANCE {_compact(balance.get('balance'))} {balance.get('uom') or ''}"
                )
            )

        normalized_detail_lines = [clean(line) for line in (detail_lines or []) if clean(line)]
        fixed_header_lines = 6 + len(transport_lines or [])
        final_footer_lines = (
            2 + len(balance_lines) + len(normalized_detail_lines)
            if normalized_detail_lines
            else 4 + len(balance_lines) + (1 if footer_note else 0)
        )
        final_capacity = cls.DOT_MATRIX_LINES_PER_PAGE - fixed_header_lines - final_footer_lines
        regular_capacity = cls.DOT_MATRIX_LINES_PER_PAGE - fixed_header_lines - 2
        if final_capacity < 1:
            raise RuntimeError("Dispatch slip has too many balance lines for the configured form length.")
        pages: list[list[dict[str, Any]]] = []
        remaining = list(entries)
        while len(remaining) > final_capacity:
            take = min(regular_capacity, len(remaining) - final_capacity)
            pages.append(remaining[:take])
            remaining = remaining[take:]
        pages.append(remaining)
        page_count = len(pages)

        rendered_pages: list[str] = []
        for page_number, page_entries in enumerate(pages, start=1):
            lines: list[str] = []
            lines.append(row_line([("TOTAL POLY PRINT PVT LTD", 54, "left"), (title, 55, "right")]))
            lines.append(divider("="))
            lines.append(
                row_line(
                    [
                        (f"REF : {doc_ref}", 32, "left"),
                        (f"ONE SO : {sales_order_no}", 30, "left"),
                        (f"DATE : {slip_date}", 20, "left"),
                        (f"PAGE : {page_number}/{page_count}", 25, "right"),
                    ]
                )
            )
            lines.append(
                row_line(
                    [
                        (f"CUSTOMER : {customer_name}", 46, "left"),
                        (f"PLANT : {plant_name}", 25, "left"),
                        (f"PRINT : {printed_at}", 37, "right"),
                    ]
                )
            )
            for line in transport_lines or []:
                lines.append(cell(line, cls.DOT_MATRIX_COLUMNS))
            lines.append(table_header)
            lines.append(divider("-"))

            for entry in page_entries:
                row = entry["row"]
                lines.append(
                    row_line(
                        [
                            (entry["row_no"], 3, "left"),
                            (f"L{row.get('so_line_no') or '-'}", 4, "left"),
                            (_display_unit_id(row.get("unit_id"), row.get("unit_type")), 10, "left"),
                            (row.get("description"), 25, "left"),
                            (row.get("grade"), 16, "left"),
                            (row.get("size"), 10, "left"),
                            (row.get("thickness"), 6, "right"),
                            (_compact(row.get("gross_kg")), 7, "right"),
                            ("N/A" if row.get("unit_type") == "ROLL" else str(_int(row.get("pcs")) or "-"), 6, "right"),
                            (_compact(row.get("tare_kg")), 6, "right"),
                            (_compact(row.get("net_kg")), 7, "right"),
                        ]
                    )
                )

            if page_number < page_count:
                lines.append("")
                lines.append("CONTINUED ON NEXT PAGE")
                rendered_pages.append("\r\n".join(lines))
                continue

            lines.append(divider("-"))
            lines.append(
                row_line(
                    [
                        (f"BAGS: {totals['bags']}  ROLLS: {totals['rolls']}  UNITS: {totals['units']}  PCS: {totals['pcs']}", 54, "left"),
                        (f"GROSS: {_compact(totals['gross'])} KG  TARE: {_compact(totals['tare'])} KG  NET: {_compact(totals['net'])} KG", 55, "right"),
                    ]
                )
            )
            lines.extend(balance_lines)
            if normalized_detail_lines:
                lines.extend(cell(line, cls.DOT_MATRIX_COLUMNS) for line in normalized_detail_lines)
            else:
                lines.append("")
                signatures = signature_labels or ("Dispatch Incharge", "Security", "Receiver")
                lines.append(
                    row_line(
                        [
                            (f"{signatures[0]}: ____________", 36, "left"),
                            (f"{signatures[1]}: ____________", 36, "left"),
                            (f"{signatures[2]}: ____________", 36, "left"),
                        ]
                    )
                )
                if footer_note:
                    lines.append(clean(footer_note))
            if len(lines) > cls.DOT_MATRIX_LINES_PER_PAGE:
                raise RuntimeError(f"Dispatch slip page {page_number} exceeds the configured form length.")
            rendered_pages.append("\r\n".join(lines))

        text = "\f".join(rendered_pages).rstrip() + "\r\n"
        for page_number, page in enumerate(text.rstrip("\r\n").split("\f"), start=1):
            for line_number, line in enumerate(page.split("\r\n"), start=1):
                if len(line) > cls.DOT_MATRIX_COLUMNS:
                    raise RuntimeError(f"Dispatch slip page {page_number} line {line_number} exceeds {cls.DOT_MATRIX_COLUMNS} columns.")
        return text

    @classmethod
    def _render_rows_text_html(cls, text: str, *, title: str) -> str:
        pages = [page.replace("\r\n", "\n") for page in text.rstrip("\r\n").split("\f") if page]
        if not pages:
            pages = [""]
        page_html = "\n".join(f'  <pre class="sheet">{escape(page)}</pre>' for page in pages)
        return f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>{escape(title)}</title>
  <style>
    @page {{ size: A4 landscape; margin: 0.2in; }}
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
      font-weight: 400;
      line-height: 14pt;
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
        font-weight: 400;
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
    <span>A4 landscape fallback for a normal office printer. For continuous paper use Epson tractor print in the ERP.</span>
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
        if "\n" in text.replace("\r\n", ""):
            raise RuntimeError("Epson dispatch text must use CRLF line endings.")
        # Keep detail rows in single-impact NLQ. Only the short heading and
        # totals lines receive emphasis, immediately cancelled with ESC F.
        # This prevents the global over-strike that blurred the photographed
        # output while preserving strong visual anchors.
        styled_pages: list[str] = []
        for page in text.split("\f"):
            styled_lines: list[str] = []
            for line in page.split("\r\n"):
                if line and cls._is_emphasis_line(line):
                    styled_lines.append(f"{cls.ESC}E{line}{cls.ESC}F")
                else:
                    styled_lines.append(line)
            styled_pages.append("\r\n".join(styled_lines))
        styled_text = "\f".join(styled_pages)
        payload = (cls.ESC_P_PREFIX + styled_text + "\f" + cls.ESC_P_SUFFIX).encode("ascii", "replace")
        return BytesIO(payload)

    @classmethod
    def _package_escp(cls, escp_buffer: BytesIO) -> BytesIO:
        """Wrap a native ESC/P job in the validated contract used by the Windows helper."""
        return BytesIO(cls.TPP_PRINT_PACKAGE_HEADER + escp_buffer.getvalue())

    @classmethod
    def render(cls, challan: DeliveryChallan) -> BytesIO:
        document = cls._challan_document(challan)
        delivery = _dict(document.get("delivery"))
        return cls._render_rows_pdf(
            title="DISPATCH SLIP",
            doc_ref=document["document_ref"],
            customer_name=document["customer_name"],
            sales_order_no=document["sales_order_no"],
            plant_name=document["plant_name"],
            rows=document["rows"],
            document_date=document.get("document_date"),
            balance_rows=document.get("balance_rows") or [],
            detail_lines=[
                f"DELIVERY TO : {_text(delivery.get('delivery_to'), document.get('customer_name'), 'NOT RECORDED')}",
                f"TRANSPORT NAME : {_text(document.get('transporter_name'), 'NOT RECORDED')}",
                f"LOCATION : {_text(delivery.get('location'), 'NOT RECORDED')}",
            ],
        )

    @classmethod
    def render_text(cls, challan: DeliveryChallan) -> str:
        document = cls._challan_document(challan)
        delivery = _dict(document.get("delivery"))
        return cls._render_rows_text(
            title="DISPATCH SLIP",
            doc_ref=document["document_ref"],
            customer_name=document["customer_name"],
            sales_order_no=document["sales_order_no"],
            plant_name=document["plant_name"],
            rows=document["rows"],
            document_date=document.get("document_date"),
            balance_rows=document.get("balance_rows") or [],
            detail_lines=[
                f"DELIVERY TO : {_text(delivery.get('delivery_to'), document.get('customer_name'), 'NOT RECORDED')}",
                f"TRANSPORT NAME : {_text(document.get('transporter_name'), 'NOT RECORDED')}",
                f"LOCATION : {_text(delivery.get('location'), 'NOT RECORDED')}",
            ],
        )

    @classmethod
    def render_html(cls, challan: DeliveryChallan) -> str:
        return cls._render_rows_text_html(cls.render_text(challan), title=f"{challan.dc_no} dispatch slip")

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
            title="PACKING SLIP",
            doc_ref=f"PACK-{sales_order.order_number}",
            customer_name=sales_order.customer_name or "-",
            sales_order_no=sales_order.order_number or "-",
            plant_name="-",
            rows=rows,
            document_date=timezone.localdate(),
            signature_labels=("Packed By", "Checked By", "Dispatch Incharge"),
            footer_note="Packing verification slip. Create the dispatch slip only after physical loading.",
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
            title="PACKING SLIP",
            doc_ref=f"PACK-{sales_order.order_number}",
            customer_name=sales_order.customer_name or "-",
            sales_order_no=sales_order.order_number or "-",
            plant_name="-",
            rows=rows,
            document_date=timezone.localdate(),
            signature_labels=("Packed By", "Checked By", "Dispatch Incharge"),
            footer_note="Packing verification slip. Create the dispatch slip only after physical loading.",
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
        return cls._render_rows_text_html(text, title=f"packing-slip-{sales_order_id}")

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
