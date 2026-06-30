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


def _first_decimal(*values: Any) -> Decimal | None:
    for value in values:
        number = _number(value)
        if number is not None:
            return number
    return None


def _positive_decimal(*values: Any) -> Decimal | None:
    for value in values:
        number = _number(value)
        if number is not None and number > 0:
            return number
    return None


def _code_token(value: Any) -> str:
    text = _text(value).upper()
    text = re.sub(r"\s+", "", text)
    text = text.replace("_", "-")
    return text


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
        "compact_label": compact_size_label(geometry),
    }


def compact_size_label(geometry: dict | None = None, axis_values: dict | None = None) -> str:
    geometry = _as_dict(geometry)
    axis_values = _as_dict(axis_values)
    base = _as_dict(geometry.get("base")) or geometry
    finished_good_type = _text(geometry.get("finished_good_type")).upper()
    if finished_good_type == "ROLL":
        roll_width = _first_decimal(
            base.get("roll_width_mm"),
            geometry.get("roll_width_mm"),
            geometry.get("stock_width_mm"),
            axis_values.get("roll_width_mm"),
        )
        return f"{_compact_number(roll_width)}mm" if roll_width is not None else _text(geometry.get("roll_form"), "ROLL")

    width = _first_decimal(base.get("width_mm"), geometry.get("width_mm"), axis_values.get("width_mm"))
    height = _first_decimal(base.get("height_mm"), geometry.get("height_mm"), axis_values.get("height_mm"))
    gusset = _first_decimal(base.get("gusset_mm"), geometry.get("gusset_mm"), axis_values.get("gusset_mm"))
    if width is None and height is None:
        return _code_token(axis_values.get("size") or geometry.get("size_code") or geometry.get("size_label"))
    parts = [_compact_number(width) or "?", _compact_number(height) or "?"]
    label = "x".join(parts)
    if gusset is not None and gusset > 0:
        label = f"{label}+{_compact_number(gusset)}G"
    return label


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
        label_parts = [material_label]
        if grade_name and grade_name.lower() not in material_label.lower():
            label_parts.append(grade_name)
        if thickness is not None:
            label_parts.append(f"{_compact_number(thickness)}µ")

        rows.append(
            {
                "index": idx,
                "variant_id": material_id or None,
                "variant_code": variant_code,
                "variant_name": variant_name,
                "grade_id": grade_id or None,
                "grade": grade_name,
                "grade_code": grade_name,
                "thickness_micron": _plain_number(thickness),
                "width_mm": _plain_number(width),
                "label": " · ".join([part for part in label_parts if part]),
            }
        )

    return rows


def _strip_thickness_suffix(code: str, thickness: Any) -> str:
    token = _code_token(code)
    number = _number(thickness)
    if number is None or not token:
        return token
    compact = _compact_number(number)
    if compact and token.endswith(compact) and len(token) > len(compact):
        return token[: -len(compact)].rstrip("-")
    return token


def layer_stack_summary(layers: list[dict], geometry: dict | None = None) -> dict:
    rows = layer_spec_rows(_as_list(layers), geometry or {})
    thickness_values: list[str] = []
    material_values: list[str] = []
    for row in rows:
        thickness = row.get("thickness_micron")
        thickness_text = _compact_number(_number(thickness))
        if thickness_text:
            thickness_values.append(thickness_text)
        material = _strip_thickness_suffix(
            row.get("variant_code") or row.get("variant_name") or row.get("label"),
            thickness,
        )
        grade = _code_token(row.get("grade_code") or row.get("grade"))
        if grade and grade not in material:
            material = f"{material} {grade}".strip()
        if material:
            material_values.append(material)

    return {
        "thickness_label": "+".join(thickness_values),
        "material_label": "/".join(material_values),
        "label": " ".join(part for part in ["+".join(thickness_values), "/".join(material_values)] if part),
        "layers": rows,
    }


def print_and_chemistry_summary(printing: dict | None = None) -> dict:
    printing = _as_dict(printing)
    chemicals = _as_dict(printing.get("chemicals"))
    ink_gsm = _first_decimal(printing.get("ink_gsm_total"), printing.get("ink_gsm"))
    adhesive_gsm = _first_decimal(chemicals.get("adhesive_gsm"), chemicals.get("adhesive_gsm_total"))
    solvent_gsm = _first_decimal(chemicals.get("solvent_gsm"), chemicals.get("solvent_gsm_total"))
    adhesive_solvent_total = Decimal("0")
    if adhesive_gsm is not None:
        adhesive_solvent_total += adhesive_gsm
    if solvent_gsm is not None:
        adhesive_solvent_total += solvent_gsm

    total_gsm_parts = []
    if ink_gsm is not None and ink_gsm > 0:
        total_gsm_parts.append(f"I{_compact_number(ink_gsm)}")
    if adhesive_solvent_total > 0:
        total_gsm_parts.append(f"A&S{_compact_number(adhesive_solvent_total)}")

    print_type = _code_token(printing.get("print_type") or printing.get("type"))
    front = _number(printing.get("front_colors_count") or 0) or Decimal("0")
    back = _number(printing.get("back_colors_count") or 0) or Decimal("0")
    total_colors = int(front + back)
    has_print_evidence = bool(printing.get("enabled")) or total_colors > 0 or _positive_decimal(ink_gsm) is not None
    print_label = ""
    if has_print_evidence:
        print_label = f"{print_type}{total_colors}C" if print_type and total_colors > 0 else print_type

    return {
        "ink_gsm": _plain_number(ink_gsm),
        "adhesive_solvent_gsm": _plain_number(adhesive_solvent_total) if adhesive_solvent_total > 0 else None,
        "gsm_label": "/".join(total_gsm_parts),
        "print_label": print_label,
    }


def compact_catalog_label(addons: list | None = None, packaging: dict | None = None) -> str:
    labels: list[str] = []
    for addon in _as_list(addons):
        row = _as_dict(addon)
        label = _code_token(row.get("code") or row.get("label") or row.get("name") or row.get("addon_name"))
        if label:
            labels.append(label)
    packaging = _as_dict(packaging)
    pod = _as_dict(packaging.get("pod"))
    if pod.get("enabled") or pod.get("pod_sku_code"):
        labels.append(_code_token(pod.get("pod_sku_code") or "POD"))
    primary = _as_dict(packaging.get("primary_inner_pack"))
    if primary.get("enabled"):
        pcs = _text(primary.get("pcs_per_pack"))
        material = _code_token(primary.get("material_code") or "IP")
        labels.append(f"{material}{pcs}" if pcs else material)
    final_outer = _as_dict(packaging.get("final_outer_pack"))
    if final_outer.get("enabled"):
        material = _code_token(final_outer.get("material_code") or "PACK")
        labels.append(material)
    return "+".join(list(dict.fromkeys([label for label in labels if label])))


def build_product_label(
    *,
    geometry: dict | None = None,
    layers: list | None = None,
    printing: dict | None = None,
    addons: list | None = None,
    packaging: dict | None = None,
    product_name: str = "",
    product_master_name: str = "",
    product_variant_name: str = "",
    customer_display_name: str = "",
    customer_item_code: str = "",
    axis_values: dict | None = None,
    qty_value: Any = None,
    qty_uom: str = "",
) -> str:
    lead = _text(customer_display_name, customer_item_code, product_name, product_variant_name, product_master_name, "Sales product")
    size_label = compact_size_label(geometry, axis_values)
    stack = layer_stack_summary(_as_list(layers), geometry)
    chem = print_and_chemistry_summary(printing)
    qty = _number(qty_value)
    qty_label = ""
    uom = _text(qty_uom).upper()
    if qty is not None and qty > 0 and uom:
        qty_label = f"{_compact_number(qty)} {uom}"
    lead_lower = lead.lower()
    parts = [lead]
    for part in [
        size_label,
        stack.get("thickness_label"),
        stack.get("material_label"),
        chem.get("gsm_label"),
        chem.get("print_label"),
        qty_label,
    ]:
        clean = str(part or "").strip()
        if clean and clean.lower() not in lead_lower:
            parts.append(clean)
    return " - ".join(list(dict.fromkeys([str(part).strip() for part in parts if str(part or "").strip()])))


def pod_labels(printing: dict | None = None, packaging: dict | None = None, geometry: dict | None = None) -> list[str]:
    labels = []
    packaging = _as_dict(packaging)
    geometry = _as_dict(geometry)
    pod = _as_dict(packaging.get("pod")) or _as_dict(geometry.get("pod"))
    if pod.get("enabled") or pod.get("pod_sku_code") or pod.get("pod_sku_name"):
        labels.append(_text(pod.get("pod_sku_code"), pod.get("pod_sku_name"), "POD"))

    return list(dict.fromkeys([label for label in labels if label]))


def addon_labels(addons: list | None = None, packaging: dict | None = None) -> list[str]:
    labels = []
    for addon in _as_list(addons):
        row = _as_dict(addon)
        label = _text(row.get("name"), row.get("addon_name"), row.get("code"), row.get("material_name"), row.get("label"))
        if label:
            labels.append(label)

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
    product_master_code: str = "",
    product_master_name: str = "",
    product_variant_code: str = "",
    product_variant_name: str = "",
    customer_display_name: str = "",
    customer_item_code: str = "",
    axis_values: dict | None = None,
    qty_value: Any = None,
    qty_uom: str = "",
) -> dict:
    size = geometry_summary(geometry or {})
    layer_rows = layer_spec_rows(_as_list(layers), geometry or {})
    layer_stack = layer_stack_summary(_as_list(layers), geometry or {})
    chemistry = print_and_chemistry_summary(printing)
    pods = pod_labels(printing, packaging, geometry)
    add_ons = addon_labels(addons, packaging)
    product = _text(product_name, variant_name, template_name, "Sales product")
    display_label = build_product_label(
        geometry=geometry,
        layers=layers,
        printing=printing,
        addons=addons,
        packaging=packaging,
        product_name=product_name,
        product_master_name=product_master_name,
        product_variant_name=product_variant_name,
        customer_display_name=customer_display_name,
        customer_item_code=customer_item_code,
        axis_values=axis_values,
        qty_value=qty_value,
        qty_uom=qty_uom,
    )
    search_text = " ".join(
        [
            customer_name,
            order_number,
            display_label,
            product,
            template_name,
            variant_code,
            variant_name,
            product_master_code,
            product_master_name,
            product_variant_code,
            product_variant_name,
            customer_item_code,
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
        "product_master_code": product_master_code or "",
        "product_master_name": product_master_name or "",
        "product_variant_code": product_variant_code or "",
        "product_variant_name": product_variant_name or "",
        "customer_display_name": customer_display_name or "",
        "customer_item_code": customer_item_code or "",
        "display_label": display_label,
        "line_label": display_label,
        "axis_values": axis_values if isinstance(axis_values, dict) else {},
        "size": size,
        "layers": layer_rows,
        "layer_stack": {
            "thickness_label": layer_stack.get("thickness_label") or "",
            "material_label": layer_stack.get("material_label") or "",
            "label": layer_stack.get("label") or "",
        },
        "chemistry": chemistry,
        "pod_labels": pods,
        "addon_labels": add_ons,
        "has_pod": bool(pods),
        "has_addons": bool(add_ons),
        "qty_value": _plain_number(_number(qty_value)),
        "qty_uom": _text(qty_uom).upper() or "",
        "search_text": search_text,
    }
