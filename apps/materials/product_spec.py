from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation
from typing import Any
from uuid import UUID


def _as_dict(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


def _as_list(value: Any) -> list:
    return value if isinstance(value, list) else []


def _text(*values: Any) -> str:
    for value in values:
        text = str(value or "").strip()
        if text and text.lower() not in {"none", "null", "undefined", "nan", "—"}:
            return text
    return ""


def _number(value: Any) -> Decimal | None:
    if value in (None, ""):
        return None
    try:
        num = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return None
    return num if num.is_finite() else None


def _plain_number(value: Decimal | None) -> float | None:
    if value is None:
        return None
    return float(value)


def _compact_number(value: Decimal | None) -> str:
    if value is None:
        return ""
    quantized = value.quantize(Decimal("0.001")).normalize()
    text = format(quantized, "f")
    return text.rstrip("0").rstrip(".") if "." in text else text


def _material_maps(layers: list[dict]) -> tuple[dict[str, Any], dict[str, Any]]:
    variant_ids = []
    grade_ids = []
    for layer in layers:
        variant_id = _text(layer.get("variant_id"), layer.get("material_id"), layer.get("family_id"))
        grade_id = _text(layer.get("grade_id"))
        if variant_id:
            variant_ids.append(variant_id)
        if grade_id:
            grade_ids.append(grade_id)

    variant_ids = [value for value in variant_ids if _is_uuid(value)]
    grade_ids = [value for value in grade_ids if _is_uuid(value)]

    try:
        from apps.materials.models import InventoryMaterial

        materials = {
            str(row.id): row
            for row in InventoryMaterial.objects.filter(id__in=sorted(set(variant_ids)))
        }
    except Exception:
        materials = {}

    try:
        from apps.recipes.models import RecipeGrade

        grades = {
            str(row.id): row
            for row in RecipeGrade.objects.filter(id__in=sorted(set(grade_ids)))
        }
    except Exception:
        grades = {}

    return materials, grades


def _is_uuid(value: str) -> bool:
    try:
        UUID(str(value))
    except (ValueError, TypeError):
        return False
    return True


def geometry_summary(geometry: dict) -> dict:
    geometry = _as_dict(geometry)
    base = _as_dict(geometry.get("base")) or geometry
    width = _number(base.get("width_mm") or base.get("width"))
    height = _number(base.get("height_mm") or base.get("height"))
    gusset = _number(base.get("gusset_mm") or base.get("gusset"))
    roll_form = _text(geometry.get("roll_form"))
    finished_good_type = _text(geometry.get("finished_good_type")).upper()

    if finished_good_type == "ROLL":
        label = roll_form or "ROLL"
    elif width or height:
        parts = [_compact_number(width) or "—", _compact_number(height) or "—"]
        if gusset and gusset > 0:
            parts.append(_compact_number(gusset))
        label = " x ".join(parts) + " mm"
    else:
        label = "Size not captured"

    return {
        "finished_good_type": finished_good_type or None,
        "roll_form": roll_form or None,
        "width_mm": _plain_number(width),
        "height_mm": _plain_number(height),
        "gusset_mm": _plain_number(gusset),
        "label": label,
    }


def layer_spec_rows(layers: list[dict], geometry: dict | None = None) -> list[dict]:
    source_layers = [_as_dict(layer).copy() for layer in _as_list(layers)]
    material_by_id, grade_by_id = _material_maps(source_layers)
    size = geometry_summary(geometry or {})
    fallback_width = size.get("width_mm")
    rows = []

    for idx, layer in enumerate(source_layers, start=1):
        material_id = _text(layer.get("variant_id"), layer.get("material_id"), layer.get("family_id"))
        grade_id = _text(layer.get("grade_id"))
        material = material_by_id.get(material_id)
        grade = grade_by_id.get(grade_id)
        variant_code = _text(
            getattr(material, "code", ""),
            layer.get("variant_code"),
            layer.get("material_code"),
            layer.get("family_code"),
            layer.get("code"),
        )
        variant_name = _text(
            getattr(material, "name", ""),
            layer.get("variant_name"),
            layer.get("material_name"),
            layer.get("family_name"),
            layer.get("name"),
        )
        grade_name = _text(
            getattr(grade, "name", ""),
            getattr(grade, "code", ""),
            layer.get("grade_name"),
            layer.get("grade_code"),
            layer.get("grade"),
        )
        thickness = _number(layer.get("thickness_micron") or layer.get("thickness"))
        width = _number(layer.get("roll_width_mm") or layer.get("width_mm") or layer.get("width") or fallback_width)

        material_label = _text(variant_code, variant_name, grade_name, f"Layer {idx}")
        if thickness is None:
            match = re.search(r"(\d+(?:\.\d+)?)$", material_label)
            if match:
                thickness = _number(match.group(1))
        label_parts = [f"L{idx}", material_label]
        if thickness is not None:
            label_parts.append(f"{_compact_number(thickness)}u")
        if grade_name and grade_name.lower() not in material_label.lower():
            label_parts.append(grade_name)
        if width is not None:
            label_parts.append(f"{_compact_number(width)}mm")

        rows.append(
            {
                "index": idx,
                "variant_id": material_id or None,
                "variant_code": variant_code,
                "variant_name": variant_name,
                "grade_id": grade_id or None,
                "grade": grade_name,
                "thickness_micron": _plain_number(thickness),
                "width_mm": _plain_number(width),
                "label": " · ".join([part for part in label_parts if part]),
            }
        )

    return rows


def pod_labels(printing: dict | None = None, packaging: dict | None = None, geometry: dict | None = None) -> list[str]:
    labels = []
    packaging = _as_dict(packaging)
    geometry = _as_dict(geometry)
    pod = _as_dict(packaging.get("pod")) or _as_dict(geometry.get("pod"))
    if pod.get("enabled") or pod.get("pod_sku_code") or pod.get("pod_sku_name"):
        labels.append(_text(pod.get("pod_sku_code"), pod.get("pod_sku_name"), "POD"))

    printing = _as_dict(printing)
    if printing.get("enabled"):
        press = _text(printing.get("press"), printing.get("type"), "Print")
        front = _number(printing.get("front_colors_count") or 0) or Decimal("0")
        back = _number(printing.get("back_colors_count") or 0) or Decimal("0")
        total_colors = int(front + back)
        artwork = _text(printing.get("artwork_code"), printing.get("artwork_ref"), printing.get("artwork_number"))
        pieces = [press]
        if total_colors > 0:
            pieces.append(f"{total_colors}-color")
        if artwork:
            pieces.append(artwork)
        labels.append(" · ".join(pieces))

    return list(dict.fromkeys([label for label in labels if label]))


def addon_labels(addons: list | None = None, packaging: dict | None = None) -> list[str]:
    labels = []
    for addon in _as_list(addons):
        row = _as_dict(addon)
        label = _text(row.get("name"), row.get("addon_name"), row.get("code"), row.get("material_name"), row.get("label"))
        if label:
            labels.append(label)

    packaging = _as_dict(packaging)
    primary = _as_dict(packaging.get("primary_inner_pack"))
    if primary.get("enabled"):
        pcs = _text(primary.get("pcs_per_pack"))
        labels.append(f"{pcs} pcs/pack" if pcs else "Inner pack")

    return list(dict.fromkeys(labels))


def build_product_spec(
    *,
    geometry: dict | None = None,
    layers: list | None = None,
    printing: dict | None = None,
    addons: list | None = None,
    packaging: dict | None = None,
    customer_name: str = "",
    order_number: str = "",
    product_name: str = "",
    template_name: str = "",
    variant_code: str = "",
    variant_name: str = "",
    qty_value: Any = None,
    qty_uom: str = "",
) -> dict:
    size = geometry_summary(geometry or {})
    layer_rows = layer_spec_rows(_as_list(layers), geometry or {})
    pods = pod_labels(printing, packaging, geometry)
    add_ons = addon_labels(addons, packaging)
    product = _text(product_name, variant_name, template_name, "Sales product")
    search_text = " ".join(
        [
            customer_name,
            order_number,
            product,
            template_name,
            variant_code,
            variant_name,
            size.get("label") or "",
            " ".join(row.get("label", "") for row in layer_rows),
            " ".join(row.get("grade", "") for row in layer_rows),
            " ".join(pods),
            " ".join(add_ons),
        ]
    ).lower()

    return {
        "customer_name": customer_name or "",
        "order_number": order_number or "",
        "product_name": product,
        "template_name": template_name or "",
        "variant_code": variant_code or "",
        "variant_name": variant_name or "",
        "size": size,
        "layers": layer_rows,
        "pod_labels": pods,
        "addon_labels": add_ons,
        "has_pod": bool(pods),
        "has_addons": bool(add_ons),
        "qty_value": _plain_number(_number(qty_value)),
        "qty_uom": _text(qty_uom).upper() or "",
        "search_text": search_text,
    }
