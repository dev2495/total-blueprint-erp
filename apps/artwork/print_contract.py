from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any

from django.core.exceptions import ValidationError

from apps.inventory.models import InkMaterial
from apps.tooling.models import Cylinder, CylinderSlotAssignment


def _as_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return int(default)


def _as_decimal(value: Any, default: Decimal = Decimal("0")) -> Decimal:
    try:
        if value in (None, ""):
            return default
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return default


def _normalize_color_list(raw: Any) -> list[str]:
    if not isinstance(raw, list):
        return []
    return [str(value).strip().upper() for value in raw if str(value).strip()]


def normalize_printing_snapshot(raw: Any) -> dict[str, Any]:
    src = raw if isinstance(raw, dict) else {}
    out = dict(src)
    out["enabled"] = bool(out.get("enabled", False))

    print_type = str(out.get("type") or out.get("method") or "").strip().upper()
    if print_type:
        out["type"] = print_type
        out["method"] = print_type

    substrate_mode = str(out.get("substrate_mode") or "").strip().upper()
    if substrate_mode:
        out["substrate_mode"] = substrate_mode

    front_count = max(0, _as_int(out.get("front_colors_count"), 0))
    back_count = max(0, _as_int(out.get("back_colors_count"), 0))
    out["front_colors_count"] = front_count
    out["back_colors_count"] = back_count
    out["colors"] = front_count + back_count
    out["ink_gsm_total"] = float(_as_decimal(out.get("ink_gsm_total") or out.get("ink_gsm") or 0))
    out["ink_gsm"] = out["ink_gsm_total"]
    out["artwork_id"] = str(out.get("artwork_id") or "").strip()
    out["front_colors"] = _normalize_color_list(out.get("front_colors"))
    out["back_colors"] = _normalize_color_list(out.get("back_colors"))
    out["color_names"] = _normalize_color_list(out.get("color_names"))
    out["color_mapping"] = out.get("color_mapping") if isinstance(out.get("color_mapping"), dict) else {}
    return out


def _print_type(snapshot: dict[str, Any]) -> str:
    return str(snapshot.get("type") or snapshot.get("method") or "").strip().upper()


def _validate_side_color_contract(
    *,
    substrate_mode: str = "SHEET",
    front_count: int,
    back_count: int,
    front_colors: list[str],
    back_colors: list[str],
    context_label: str,
) -> None:
    mode = str(substrate_mode or "SHEET").strip().upper()
    if mode not in {"SHEET", "TUBING"}:
        raise ValidationError(f"{context_label}: film type must be SHEET or TUBING.")
    if front_count < 0 or back_count < 0:
        raise ValidationError(f"{context_label}: front/back color counts cannot be negative.")
    if mode == "SHEET" and (back_count > 0 or back_colors):
        raise ValidationError(f"{context_label}: sheet film supports front colors only.")
    if front_count + back_count <= 0:
        raise ValidationError(f"{context_label}: at least one color is required when printing is enabled.")
    if len(front_colors) != front_count:
        raise ValidationError(f"{context_label}: front color list must exactly match front color count.")
    if len(back_colors) != back_count:
        raise ValidationError(f"{context_label}: back color list must exactly match back color count.")


def resolve_ink_base_from_layers(layer_snapshot: Any) -> str:
    for layer in layer_snapshot if isinstance(layer_snapshot, list) else []:
        if not isinstance(layer, dict):
            continue
        density = _as_decimal(layer.get("density_g_cm3") or layer.get("density_gcm3") or 0)
        if density >= Decimal("1.4"):
            return "PET"
    return "POLY"


def resolve_ink_contract(
    *,
    color_names: list[str],
    layer_snapshot: Any,
    existing_mapping: Any = None,
    strict: bool,
) -> dict[str, Any]:
    normalized_colors = [str(color).strip().upper() for color in color_names if str(color).strip()]
    base_family = resolve_ink_base_from_layers(layer_snapshot)
    supplied_mapping = existing_mapping if isinstance(existing_mapping, dict) else {}
    normalized_mapping = {
        str(key).strip().upper(): str(value).strip()
        for key, value in supplied_mapping.items()
        if str(key).strip() and str(value).strip()
    }

    resolved_mapping: dict[str, str] = {}
    unresolved: list[str] = []
    for color in normalized_colors:
        ink = None
        try:
            mapped_id = normalized_mapping.get(color)
            if mapped_id:
                ink = InkMaterial.objects.filter(id=mapped_id, base_type=base_family).first()
            if ink is None:
                ink = InkMaterial.objects.filter(base_type=base_family, color_name__iexact=color).first()
        except Exception:
            ink = None

        if ink is None:
            unresolved.append(color)
            continue
        resolved_mapping[color] = str(ink.id)

    if strict and unresolved:
        missing = ", ".join(unresolved)
        raise ValidationError(f"missing {base_family} ink master mapping for colors: {missing}")

    return {
        "ink_base_family": base_family,
        "color_names": normalized_colors,
        "color_mapping": resolved_mapping,
        "unresolved_colors": unresolved,
    }


def get_artwork_contract(artwork, *, require_asset: bool = False) -> dict[str, Any]:
    has_image_list = False
    try:
        has_image_list = artwork.images.exists()
    except Exception:
        has_image_list = False
    if require_asset and not getattr(artwork, "file_path", None) and not getattr(artwork, "image", None) and not has_image_list:
        raise ValidationError("Cannot approve artwork without an uploaded file/image asset.")

    front_count = _as_int(getattr(artwork, "front_colors_count", 0), 0)
    back_count = _as_int(getattr(artwork, "back_colors_count", 0), 0)
    front_colors = _normalize_color_list(getattr(artwork, "front_colors", []))
    back_colors = _normalize_color_list(getattr(artwork, "back_colors", []))
    raw_substrate_mode = getattr(artwork, "substrate_mode", None)
    substrate_mode = str(raw_substrate_mode or ("TUBING" if back_count > 0 or back_colors else "SHEET")).upper()

    _validate_side_color_contract(
        substrate_mode=substrate_mode,
        front_count=front_count,
        back_count=back_count,
        front_colors=front_colors,
        back_colors=back_colors,
        context_label="Artwork",
    )

    return {
        "print_type": str(getattr(artwork, "print_type", "FLEXO") or "FLEXO").upper(),
        "substrate_mode": substrate_mode,
        "front_colors_count": front_count,
        "back_colors_count": back_count,
        "front_colors": front_colors,
        "back_colors": back_colors,
        "color_names": front_colors + back_colors,
    }


def _cylinder_incomplete(row) -> bool:
    return (
        not str(getattr(row, "code", "") or "").strip()
        or not str(getattr(row, "name", "") or "").strip()
        or not str(getattr(row, "color_name", "") or "").strip()
        or getattr(row, "circumference", None) is None
        or float(getattr(row, "circumference", 0) or 0) <= 0
        or not getattr(row, "engraving_vendor_id", None)
        or not getattr(row, "storage_location_id", None)
        or str(getattr(row, "lifecycle_status", "DRAFT") or "DRAFT").upper() == "DRAFT"
    )


def validate_roto_cylinder_readiness(artwork) -> dict[str, Any]:
    contract = get_artwork_contract(artwork, require_asset=True)
    if contract["print_type"] != "ROTO":
        return contract

    front_count = contract["front_colors_count"]
    back_count = contract["back_colors_count"]
    required_front_slots = set(range(1, front_count + 1))
    required_back_slots = set(range(1, back_count + 1))

    try:
        assignment_query = CylinderSlotAssignment.objects.filter(artwork_id=artwork.id, cylinder__is_draft=False).select_related("cylinder")
        if hasattr(assignment_query, "order_by"):
            assignment_rows = list(assignment_query.order_by("side", "side_slot_index", "created_at"))
        else:
            assignment_rows = list(assignment_query)
    except Exception:
        assignment_rows = []
    direct_query = Cylinder.objects.filter(artwork_id=artwork.id, is_draft=False)
    if hasattr(direct_query, "order_by"):
        direct_rows = list(direct_query.order_by("side", "side_slot_index", "created_at"))
    else:
        direct_rows = list(direct_query)

    finalized_rows = []
    direct_seen = set()
    for assignment in assignment_rows:
        cylinder = assignment.cylinder
        setattr(cylinder, "_assignment_side", assignment.side)
        setattr(cylinder, "_assignment_slot", assignment.side_slot_index)
        finalized_rows.append(cylinder)
        direct_seen.add(str(getattr(cylinder, "id", id(cylinder))))
    for row in direct_rows:
        if str(getattr(row, "id", id(row))) not in direct_seen:
            finalized_rows.append(row)

    coverage: dict[tuple[str, int], list[Any]] = {}
    invalid_slots: list[str] = []
    unexpected_slots: list[str] = []
    incomplete_slots: list[str] = []
    for row in finalized_rows:
        side = str(getattr(row, "_assignment_side", getattr(row, "side", "FRONT")) or "FRONT").upper()
        slot = _as_int(getattr(row, "_assignment_slot", getattr(row, "side_slot_index", 0)), 0)
        if slot <= 0:
            invalid_slots.append(f"{side}-0")
            continue
        if side not in {"FRONT", "BACK"}:
            invalid_slots.append(f"{side}-{slot}")
            continue
        if (side == "FRONT" and slot not in required_front_slots) or (side == "BACK" and slot not in required_back_slots):
            unexpected_slots.append(f"{side}-{slot}")
            continue
        key = (side, slot)
        coverage.setdefault(key, []).append(row)
        if _cylinder_incomplete(row):
            incomplete_slots.append(f"{side}-{slot}")

    duplicate_slots = sorted(f"{side}-{slot}" for (side, slot), rows in coverage.items() if len(rows) > 1)
    if duplicate_slots:
        raise ValidationError(
            "ROTO approval blocked: duplicate finalized cylinder coverage exists for slots "
            f"{duplicate_slots}."
        )
    if invalid_slots:
        raise ValidationError(
            "ROTO approval blocked: finalized cylinders have invalid slot positions "
            f"{sorted(invalid_slots)}."
        )
    if unexpected_slots:
        raise ValidationError(
            "ROTO approval blocked: finalized cylinders exceed the approved artwork slot range "
            f"{sorted(unexpected_slots)}."
        )

    front_slots_ready = {slot for (side, slot), rows in coverage.items() if side == "FRONT" and rows}
    back_slots_ready = {slot for (side, slot), rows in coverage.items() if side == "BACK" and rows}
    missing_front = sorted(required_front_slots - front_slots_ready)
    missing_back = sorted(required_back_slots - back_slots_ready)
    if missing_front:
        raise ValidationError(f"ROTO approval blocked: finalized front cylinders missing for slots {missing_front}.")
    if missing_back:
        raise ValidationError(f"ROTO approval blocked: finalized back cylinders missing for slots {missing_back}.")
    if incomplete_slots:
        raise ValidationError(
            "ROTO approval blocked: finalize cylinder technical details for slots "
            f"{sorted(set(incomplete_slots))}."
        )

    return contract


def validate_frozen_printing_snapshot(
    printing_snapshot: Any,
    *,
    layer_snapshot: Any,
    require_artwork: bool = True,
    strict_inks: bool = True,
) -> dict[str, Any]:
    printing = normalize_printing_snapshot(printing_snapshot)
    if not printing.get("enabled", False):
        return printing

    print_type = _print_type(printing)
    if not print_type:
        raise ValidationError("Frozen printing snapshot is missing print type.")

    substrate_mode = str(printing.get("substrate_mode") or "").strip().upper()
    if substrate_mode not in {"SHEET", "TUBING"}:
        raise ValidationError("Frozen printing snapshot requires substrate_mode SHEET or TUBING.")

    front_count = int(printing.get("front_colors_count") or 0)
    back_count = int(printing.get("back_colors_count") or 0)
    front_colors = _normalize_color_list(printing.get("front_colors"))
    back_colors = _normalize_color_list(printing.get("back_colors"))
    _validate_side_color_contract(
        substrate_mode=substrate_mode,
        front_count=front_count,
        back_count=back_count,
        front_colors=front_colors,
        back_colors=back_colors,
        context_label="Frozen printing snapshot",
    )

    color_names = _normalize_color_list(printing.get("color_names"))
    expected_colors = front_colors + back_colors
    if color_names != expected_colors:
        raise ValidationError("Frozen printing snapshot color_names must exactly match front/back side colors.")

    if _as_decimal(printing.get("ink_gsm_total") or printing.get("ink_gsm") or 0) <= Decimal("0"):
        raise ValidationError("Frozen printing snapshot requires total ink GSM greater than zero.")

    artwork_id = str(printing.get("artwork_id") or "").strip()
    artwork_design_code = str(printing.get("artwork_design_code") or "").strip()
    if require_artwork and not artwork_id:
        raise ValidationError("Frozen printing snapshot requires artwork_id.")
    if require_artwork and not artwork_design_code:
        raise ValidationError("Frozen printing snapshot requires artwork_design_code.")

    expected_cylinder_required = print_type == "ROTO"
    if bool(printing.get("cylinder_required")) != expected_cylinder_required:
        raise ValidationError(
            f"Frozen printing snapshot cylinder_required must be {expected_cylinder_required} for {print_type}."
        )

    ink_contract = resolve_ink_contract(
        color_names=color_names,
        layer_snapshot=layer_snapshot,
        existing_mapping=printing.get("color_mapping") or {},
        strict=strict_inks,
    )

    existing_base = str(printing.get("ink_base_family") or "").strip().upper()
    if existing_base and existing_base != ink_contract["ink_base_family"]:
        raise ValidationError(
            "Frozen printing snapshot ink_base_family does not match the resolved substrate ink base."
        )
    if strict_inks and ink_contract["unresolved_colors"]:
        raise ValidationError(
            "Frozen printing snapshot has unresolved colors: "
            f"{', '.join(ink_contract['unresolved_colors'])}."
        )

    printing["front_colors"] = front_colors
    printing["back_colors"] = back_colors
    printing["substrate_mode"] = substrate_mode
    printing["color_names"] = color_names
    printing["color_mapping"] = ink_contract["color_mapping"]
    printing["ink_base_family"] = ink_contract["ink_base_family"]
    printing["cylinder_required"] = expected_cylinder_required
    if artwork_id:
        printing["artwork_id"] = artwork_id
    if artwork_design_code:
        printing["artwork_design_code"] = artwork_design_code
    return printing
