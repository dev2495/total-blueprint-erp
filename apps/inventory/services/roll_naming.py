from __future__ import annotations

from decimal import Decimal


POUCH_STYLE_LABELS = {
    "THREE_SIDE_SEAL": "Three Side Seal",
    "PILLOW": "Pillow",
    "STAND_UP": "Stand Up",
    "SIDE_GUSSET": "Side Gusset",
    "QUAD_SEAL": "Quad Seal",
    "FLAT_BOTTOM": "Flat Bottom",
    "SPOUT": "Spout",
    "SHAPED": "Shaped",
}

ROLL_FORM_LABELS = {
    "ROLL": "Roll",
    "SHEET": "Sheet",
}

ORIGIN_LABELS = {
    "IN_HOUSE": "In-house made",
    "PURCHASED": "Purchased",
    "JOBWORK_RETURN": "Jobwork return",
    "INTERPLANT_IN": "Inter-plant",
    "REMAINDER": "Remainder",
}

STOCK_STRATEGY_LABELS = {
    "FINAL_STOCK": "Final stock",
    "INTERMEDIATE_POOL": "Intermediate pool",
    "PACKAGING_STOCK": "Packaging only",
}


def resolve_roll_stock_strategy(roll) -> str:
    meta = getattr(roll, "meta_json", {}) or {}
    strategy = str(
        meta.get("stock_strategy")
        or getattr(getattr(roll, "created_by_job", None), "mts_order", None) and getattr(roll.created_by_job.mts_order, "stock_strategy", "")
        or ("PACKAGING_STOCK" if str(getattr(getattr(roll, "material", None), "category", "") or "").upper() == "PACKAGING" else "")
        or ("FINAL_STOCK" if bool(getattr(roll, "is_fg", False)) else "INTERMEDIATE_POOL")
    ).upper()
    if strategy not in STOCK_STRATEGY_LABELS:
        return "FINAL_STOCK" if bool(getattr(roll, "is_fg", False)) else "INTERMEDIATE_POOL"
    return strategy


def resolve_roll_origin_type(roll, *, role: str = "") -> str:
    meta = getattr(roll, "meta_json", {}) or {}
    explicit = str(meta.get("origin_type") or "").upper()
    if explicit in ORIGIN_LABELS:
        return explicit
    if str(role or "").upper() == "REMAINDER":
        return "REMAINDER"
    if str(getattr(getattr(roll, "created_by_job", None), "source_type", "") or "").upper() == "JOBWORK_RETURN":
        return "JOBWORK_RETURN"
    if meta.get("interplant_challan_id") or meta.get("from_plant_id") or meta.get("received_from_challan"):
        return "INTERPLANT_IN"
    if getattr(roll, "created_by_job_id", None) or getattr(roll, "production_job_id", None):
        return "IN_HOUSE"
    if str(getattr(roll, "status", "") or "").upper() == "SENT_JOBWORK":
        return "JOBWORK_RETURN"
    return "PURCHASED"


def stock_strategy_label(value: str | None) -> str:
    return STOCK_STRATEGY_LABELS.get(str(value or "").upper(), "Final stock")


def origin_type_label(value: str | None) -> str:
    return ORIGIN_LABELS.get(str(value or "").upper(), str(value or "").strip() or "Unknown")


def print_status_from_stage(stage_name: str) -> str:
    stage = str(stage_name or "").strip().lower()
    return "Printed" if stage in {"printed", "laminated", "slit", "finished good"} else "Plain / Extruded"


def lamination_status_from_stage(stage_name: str) -> str:
    stage = str(stage_name or "").strip().lower()
    return "Laminated" if stage in {"laminated", "slit", "finished good"} else "Not laminated"


def roll_form_label(roll) -> str:
    template = getattr(roll, "template", None)
    pouch_style = str(getattr(template, "pouch_style", "") or "").upper().strip()
    if pouch_style in POUCH_STYLE_LABELS:
        return POUCH_STYLE_LABELS[pouch_style]
    roll_form = str((getattr(roll, "geometry_override", {}) or {}).get("roll_form") or "").upper().strip()
    if roll_form in ROLL_FORM_LABELS:
        return ROLL_FORM_LABELS[roll_form]
    fg_type = str(getattr(template, "fg_type", "") or "ROLL").upper().strip()
    if fg_type == "POUCH":
        return "Pouch"
    return "Roll"


def commercial_family_name_for_roll(roll) -> str:
    template = getattr(roll, "template", None)
    material = getattr(roll, "material", None)
    family_candidates = [
        getattr(getattr(template, "commercial_family", None), "name", ""),
        getattr(getattr(material, "commercial_family", None), "name", ""),
        getattr(getattr(getattr(material, "parent_family", None), "commercial_family", None), "name", ""),
        getattr(getattr(material, "parent_family", None), "name", ""),
        getattr(material, "name", ""),
        getattr(template, "name", ""),
        getattr(roll, "label_id", ""),
    ]
    for candidate in family_candidates:
        if str(candidate or "").strip():
            return str(candidate).strip()
    return "Material"


def commercial_reporting_group_for_roll(roll) -> str:
    template = getattr(roll, "template", None)
    material = getattr(roll, "material", None)
    group_candidates = [
        getattr(getattr(template, "commercial_family", None), "default_reporting_group", ""),
        getattr(getattr(material, "commercial_family", None), "default_reporting_group", ""),
        getattr(getattr(getattr(material, "parent_family", None), "commercial_family", None), "default_reporting_group", ""),
    ]
    for candidate in group_candidates:
        if str(candidate or "").strip():
            return str(candidate).strip().upper()
    return "OTHER"


def size_line_for_roll(roll) -> str:
    width_mm = _safe_number(getattr(roll, "width_mm", 0))
    thickness_micron = _safe_number(getattr(roll, "thickness_micron", 0))
    parts: list[str] = []
    if width_mm > 0:
        parts.append(f"{width_mm:.0f} mm")
    if thickness_micron > 0:
        parts.append(f"{thickness_micron:.0f} micron")
    return " × ".join(parts) if parts else "Size not captured"


def process_state_label(stage_name: str, strategy: str) -> str:
    stage = str(stage_name or "").strip() or "Raw Material"
    if str(strategy or "").upper() == "FINAL_STOCK":
        return f"{stage} · Final stock"
    if str(strategy or "").upper() == "PACKAGING_STOCK":
        return f"{stage} · Packaging only"
    return f"{stage} · Intermediate pool"


def availability_label(status: str, weight_kg: Decimal | float | int) -> str:
    normalized = str(status or "").upper()
    weight = _safe_number(weight_kg)
    if normalized == "AVAILABLE":
        return f"{weight:.1f} kg ready"
    if normalized == "RESERVED":
        return f"{weight:.1f} kg reserved"
    if normalized == "IN_PROCESS":
        return f"{weight:.1f} kg in process"
    return normalized.replace("_", " ").title()


def build_roll_naming_payload(roll, *, role: str, stage_name: str) -> dict:
    strategy = resolve_roll_stock_strategy(roll)
    family_name = commercial_family_name_for_roll(roll)
    size_line = size_line_for_roll(roll)
    form_label = roll_form_label(roll)
    print_status = print_status_from_stage(stage_name)
    lamination_status = lamination_status_from_stage(stage_name)
    variant_display_name = f"{family_name} · {size_line}"
    return {
        "family_display_name": family_name,
        "variant_display_name": variant_display_name,
        "size_line": size_line,
        "form_label": form_label,
        "process_state_label": process_state_label(stage_name, strategy),
        "availability_label": availability_label(getattr(roll, "status", ""), getattr(roll, "weight_kg", 0)),
        "print_status": print_status,
        "lamination_status": lamination_status,
        "stock_strategy": strategy,
        "stock_strategy_label": stock_strategy_label(strategy),
        "origin_type": resolve_roll_origin_type(roll, role=role),
        "origin_label": origin_type_label(resolve_roll_origin_type(roll, role=role)),
        "reporting_group": commercial_reporting_group_for_roll(roll),
    }


def build_variant_key(payload: dict) -> tuple:
    return (
        str(payload.get("family_display_name") or "").strip(),
        str(payload.get("form_label") or "").strip(),
        str(payload.get("stage_name") or "").strip(),
        _safe_number(payload.get("width_mm")),
        _safe_number(payload.get("thickness_micron")),
        str(payload.get("print_status") or "").strip(),
        str(payload.get("lamination_status") or "").strip(),
        str(payload.get("stock_strategy") or "").strip(),
    )


def _safe_number(value, default: float = 0.0) -> float:
    try:
        return float(value or 0)
    except Exception:
        return default
