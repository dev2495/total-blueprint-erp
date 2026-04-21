from copy import deepcopy
from decimal import Decimal
import uuid

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from apps.artwork.models import Artwork
from apps.artwork.print_contract import (
    get_artwork_contract,
    normalize_printing_snapshot as shared_normalize_printing_snapshot,
    resolve_ink_base_from_layers as shared_resolve_ink_base_from_layers,
    resolve_ink_contract,
    validate_frozen_printing_snapshot,
    validate_roto_cylinder_readiness,
)
from apps.bom.services_resolver import BOMResolverService
from apps.physics.geometry_override import (
    normalize_geometry_override,
    sanitize_geometry_override,
    validate_pouch_geometry_contract,
)
from apps.physics.spec_signature import (
    build_spec_payload,
    build_spec_signature,
    build_invariant_payload,
    build_invariant_signature,
)
from apps.physics.services_physics import PhysicsEngine
from apps.materials.models import InventoryMaterial, PodSkuVariant
from apps.templates.models import TemplateBlueprint, TemplateProcessStep
from ..models import SalesOrder, SalesOrderItem, SalesSkuVariant


def _as_int(value, default=0):
    try:
        return int(value)
    except Exception:
        return int(default)


def _make_json_serializable(obj):
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, dict):
        return {k: _make_json_serializable(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_make_json_serializable(v) for v in obj]
    return obj


def _item_label(item):
    try:
        return item.template.name
    except Exception:
        return "item"


def _safe_uuid_str(value):
    try:
        return str(uuid.UUID(str(value)))
    except Exception:
        return None


def _normalize_layer_snapshot(raw_layers, strict=True):
    src = raw_layers if isinstance(raw_layers, list) else []
    variant_ids = []
    family_ids = []
    for idx, row in enumerate(src):
        if not isinstance(row, dict):
            continue
        variant_id = row.get("variant_id")
        family_id = row.get("family_id")
        safe_variant = _safe_uuid_str(variant_id)
        safe_family = _safe_uuid_str(family_id)
        if safe_variant:
            variant_ids.append(safe_variant)
        if safe_family:
            family_ids.append(safe_family)

    variants_map = {
        str(v.id): v
        for v in InventoryMaterial.objects.select_related("parent_family").filter(id__in=variant_ids, category="FILM_VARIANT")
    }
    families_map = {
        str(f.id): f
        for f in InventoryMaterial.objects.filter(id__in=family_ids, category="FILM_FAMILY")
    }

    normalized = []
    for idx, row in enumerate(src):
        if not isinstance(row, dict):
            continue
        family_id = _safe_uuid_str(row.get("family_id")) or str(row.get("family_id") or "")
        variant_id = _safe_uuid_str(row.get("variant_id")) or str(row.get("variant_id") or "")
        grade_id = row.get("grade_id")
        thickness = Decimal(str(row.get("thickness_micron") or 0))
        # V2 rule: density is derived from master data (variant/family), never
        # trusted from user-entered payload density.
        density = Decimal("0")
        roll_width_mm = Decimal(str(row.get("roll_width_mm") or row.get("width_mm") or 0))
        variant_obj = variants_map.get(variant_id)
        family_obj = families_map.get(family_id)
        if variant_obj:
            density = Decimal(
                str(
                    variant_obj.density_gcm3
                    or (variant_obj.parent_family.density_gcm3 if getattr(variant_obj, "parent_family", None) else 0)
                    or density
                )
            )
        elif family_obj:
            density = Decimal(str(family_obj.density_gcm3 or density or 0))

        if strict and density <= 0:
            raise ValidationError(
                f"Layer {idx + 1}: density is missing in film family/variant master data."
            )

        if strict and variant_obj and bool(getattr(variant_obj, "is_extrudable", False)) and not grade_id:
            raise ValidationError(
                f"Layer {idx + 1}: grade is required for extrudable film variants."
            )

        normalized.append(
            {
                "family_id": family_id,
                "variant_id": variant_id or None,
                "grade_id": str(grade_id) if (grade_id and variant_obj and bool(getattr(variant_obj, "is_extrudable", False))) else None,
                "thickness_micron": float(thickness),
                "density_g_cm3": float(density),
                "roll_width_mm": float(roll_width_mm) if roll_width_mm > 0 else 0.0,
            }
        )
    return normalized


def _validate_template_film_constraints(template, layer_snapshot, item_label):
    # V2 hard-cut: template no longer controls sales/stock material identity constraints.
    # Product identity comes from sales/stock snapshots and BOM resolution only.
    return


def _resolve_ink_base_from_layers(layer_snapshot):
    return shared_resolve_ink_base_from_layers(layer_snapshot)


def _normalize_printing_snapshot(raw):
    return shared_normalize_printing_snapshot(raw)


def _normalize_packaging_snapshot(raw):
    src = raw if isinstance(raw, dict) else {}

    primary_src = src.get("primary_inner_pack") if isinstance(src.get("primary_inner_pack"), dict) else {}
    roll_src = src.get("roll_dispatch_pack") if isinstance(src.get("roll_dispatch_pack"), dict) else {}
    pod_src = src.get("pod") if isinstance(src.get("pod"), dict) else {}

    lines = []
    for line in roll_src.get("lines") if isinstance(roll_src.get("lines"), list) else []:
        if not isinstance(line, dict):
            continue
        material_id = _safe_uuid_str(line.get("material_id")) or str(line.get("material_id") or "").strip() or None
        qty = Decimal(str(line.get("qty") or 0))
        if not material_id:
            continue
        lines.append(
            {
                "material_id": material_id,
                "qty": float(qty),
                "uom": str(line.get("uom") or "PCS").upper(),
                "basis": str(line.get("basis") or "PER_ROLL").upper(),
            }
        )

    pod_enabled = bool(pod_src.get("enabled", False))
    if "pod_enabled" in src and src.get("pod_enabled") is not None:
        pod_enabled = bool(src.get("pod_enabled"))
    pod_profile_id = (
        _safe_uuid_str(pod_src.get("pod_profile_id"))
        or str(pod_src.get("pod_profile_id") or "").strip()
        or _safe_uuid_str(src.get("pod_profile_id"))
        or str(src.get("pod_profile_id") or "").strip()
        or None
    )
    pod_sku_variant_id = (
        _safe_uuid_str(pod_src.get("pod_sku_variant_id"))
        or str(pod_src.get("pod_sku_variant_id") or "").strip()
        or _safe_uuid_str(src.get("pod_sku_variant_id"))
        or str(src.get("pod_sku_variant_id") or "").strip()
        or None
    )

    return {
        "primary_inner_pack": {
            "enabled": bool(primary_src.get("enabled", False)),
            "material_id": _safe_uuid_str(primary_src.get("material_id")) or str(primary_src.get("material_id") or "").strip() or None,
            "pcs_per_pack": _as_int(primary_src.get("pcs_per_pack"), 0),
        },
        "roll_dispatch_pack": {
            "enabled": bool(roll_src.get("enabled", False)),
            "lines": lines,
        },
        "pod": {
            "enabled": pod_enabled,
            "pod_profile_id": pod_profile_id if pod_enabled else None,
            "pod_sku_variant_id": pod_sku_variant_id if pod_enabled else None,
        },
    }


def _hydrate_pod_snapshot(pod_cfg):
    config = dict(pod_cfg or {})
    enabled = bool(config.get("enabled"))
    if not enabled:
        return {"enabled": False, "pod_profile_id": None, "pod_sku_variant_id": None, "pod_sku_code": None, "pod_sku_name": None}

    pod_profile_id = str(config.get("pod_profile_id") or "").strip() or None
    pod_sku_variant_id = _safe_uuid_str(config.get("pod_sku_variant_id")) or str(config.get("pod_sku_variant_id") or "").strip() or None
    pod_sku_code = str(config.get("pod_sku_code") or "").strip() or None
    pod_sku_name = str(config.get("pod_sku_name") or "").strip() or None
    if pod_sku_variant_id and not pod_profile_id:
        try:
            variant = PodSkuVariant.objects.select_related("material").get(id=pod_sku_variant_id, active=True)
        except PodSkuVariant.DoesNotExist as exc:
            raise ValidationError("Selected POD SKU variant is invalid or inactive.") from exc
        pod_profile_id = str(variant.material_id)
        pod_sku_code = pod_sku_code or str(variant.code or variant.pod_sku.code)
        pod_sku_name = pod_sku_name or str(variant.name or variant.pod_sku.name)

    if not pod_profile_id:
        raise ValidationError("POD profile is required when POD is enabled.")

    return {
        "enabled": True,
        "pod_profile_id": pod_profile_id,
        "pod_sku_variant_id": pod_sku_variant_id,
        "pod_sku_code": pod_sku_code,
        "pod_sku_name": pod_sku_name,
    }


def _resolve_source_item(raw_item):
    item_id = _safe_uuid_str(raw_item.get("repeat_source_item_id") or raw_item.get("repeat_source_item"))
    if not item_id:
        return None
    try:
        return SalesOrderItem.objects.select_related("template", "sku_variant", "sales_order").get(id=item_id)
    except SalesOrderItem.DoesNotExist as exc:
        raise ValidationError("repeat_source_item_id is invalid.") from exc


def _resolve_sku_variant(raw_item):
    variant_id = _safe_uuid_str(raw_item.get("sku_variant_id") or raw_item.get("sku_variant"))
    if not variant_id:
        return None
    try:
        variant = SalesSkuVariant.objects.select_related("sku", "sku__template").get(id=variant_id)
    except SalesSkuVariant.DoesNotExist as exc:
        raise ValidationError("sku_variant_id is invalid.") from exc
    if not variant.active or not variant.sku.active:
        raise ValidationError(f"SKU variant {variant.code} is inactive.")
    if str(getattr(variant.sku.template, "status", "") or "").upper() != "LIVE":
        raise ValidationError(f"SKU {variant.sku.code} must link to a LIVE template.")
    return variant


def _merge_item_source_defaults(raw_item):
    item = dict(raw_item or {})
    variant = _resolve_sku_variant(item)
    repeat_source = _resolve_source_item(item)

    if variant:
        default_printing = deepcopy(variant.printing_snapshot or {})
        default_chemicals = deepcopy(variant.chemicals_snapshot or {})
        if default_chemicals and not isinstance(default_printing.get("chemicals"), dict):
            default_printing["chemicals"] = default_chemicals
        item.setdefault("template_id", str(variant.sku.template_id))
        item.setdefault("fg_type", variant.finished_good_type)
        item.setdefault("roll_form", variant.roll_form or None)
        item.setdefault("geometry", deepcopy(variant.geometry_snapshot or {}))
        item.setdefault("film_layers", deepcopy(variant.layer_snapshot or []))
        item.setdefault("printing", default_printing)
        item.setdefault("chemicals", default_chemicals)
        item.setdefault("addons", deepcopy(variant.addons_snapshot or []))
        item.setdefault("packaging_snapshot", deepcopy(variant.packaging_snapshot or {}))
        item.setdefault("line_name", variant.name or variant.sku.default_line_name or variant.sku.name)

    if repeat_source:
        source_geometry = deepcopy(repeat_source.geometry_snapshot or {})
        source_printing = deepcopy(repeat_source.printing_snapshot or {})
        source_chemicals = source_printing.get("chemicals") if isinstance(source_printing.get("chemicals"), dict) else {}
        item.setdefault("template_id", str(repeat_source.template_id))
        item.setdefault("fg_type", source_geometry.get("finished_good_type") or getattr(repeat_source.template, "fg_type", "POUCH"))
        item.setdefault("roll_form", source_geometry.get("roll_form") or None)
        item.setdefault("geometry", source_geometry)
        item.setdefault("film_layers", deepcopy(repeat_source.layer_snapshot or []))
        item.setdefault("printing", source_printing)
        item.setdefault("chemicals", source_chemicals)
        item.setdefault("addons", deepcopy(repeat_source.addons_snapshot or []))
        item.setdefault("packaging_snapshot", deepcopy(repeat_source.packaging_snapshot or {}))
        item.setdefault("line_name", repeat_source.line_name or getattr(repeat_source.template, "name", ""))
        item.setdefault("price_basis", repeat_source.price_basis)
        item.setdefault("qty_uom", repeat_source.qty_uom)
        item.setdefault("unit_price", float(repeat_source.unit_price or 0))

    explicit_chemicals = item.get("chemicals")
    if isinstance(explicit_chemicals, dict):
        printing = item.get("printing") if isinstance(item.get("printing"), dict) else {}
        if explicit_chemicals:
            printing["chemicals"] = explicit_chemicals
        item["printing"] = printing

    if repeat_source and not item.get("mode"):
        item["mode"] = "REPEAT"
    elif not item.get("mode"):
        item["mode"] = "TEMPLATE"

    item["_resolved_sku_variant"] = variant
    item["_resolved_repeat_source_item"] = repeat_source
    return item


def _resolve_preview_fg_type(payload):
    src = payload if isinstance(payload, dict) else {}
    template_id = _safe_uuid_str(src.get("template_id"))
    if template_id:
        template = TemplateBlueprint.objects.filter(id=template_id).only("fg_type").first()
        if template and str(template.fg_type or "").upper() in {"POUCH", "ROLL"}:
            return str(template.fg_type).upper()
    geometry = src.get("geometry") if isinstance(src.get("geometry"), dict) else {}
    fg_type = str(
        src.get("finished_good_type")
        or src.get("fg_type")
        or geometry.get("finished_good_type")
        or geometry.get("fg_type")
        or "POUCH"
    ).upper()
    return fg_type if fg_type in {"POUCH", "ROLL"} else "POUCH"


def _planning_category_for_row(section_name, row):
    section = str(section_name or "").upper()
    if section == "FILMS":
        return "FILM"
    if section == "GRANULES":
        return "GRANULE"
    if section == "INKS":
        return "INK"
    if section == "CHEMICALS":
        typ = str((row or {}).get("type") or "").upper()
        if typ in {"ADHESIVE", "SOLVENT"}:
            return typ
        return "CHEMICAL"
    if section == "ADDONS":
        return "ADDON"
    if section == "POD":
        return "POD"
    return section.rstrip("S")


def _planning_material_identity(section_name, row):
    if not isinstance(row, dict):
        return None, None, None
    material_id = _safe_uuid_str(
        row.get("material_id")
        or row.get("variant_id")
        or row.get("granule_id")
        or row.get("addon_id")
        or row.get("ink_id")
        or row.get("chemical_id")
    )
    material_name = str(row.get("name") or row.get("code") or f"Unknown {section_name}").strip()
    material_code = str(row.get("code") or "").strip() or None
    return material_id, material_name, material_code


def _collect_template_issue_policies(template_id):
    template_id = _safe_uuid_str(template_id)
    if not template_id:
        return {}
    rows = (
        TemplateProcessStep.objects.filter(template_id=template_id)
        .prefetch_related("materials", "process")
        .order_by("sequence_number")
    )
    mapping = {}
    for step in rows:
        for mat in step.materials.all():
            category_code = str(getattr(mat, "category_code", "") or "").strip().upper()
            if not category_code or category_code in mapping:
                continue
            mapping[category_code] = {
                "step_id": str(step.id),
                "step_sequence": int(step.sequence_number or 0),
                "step_name": str(getattr(step.process, "name", "") or f"Step {step.sequence_number}"),
                "consumption_basis": str(getattr(mat, "consumption_basis", "FIXED_KG") or "FIXED_KG").upper(),
                "formula_driver": str(getattr(mat, "formula_driver", "NONE") or "NONE").upper(),
                "formula_params": dict(getattr(mat, "formula_params", {}) or {}),
                "issue_policy_mode": str(getattr(mat, "issue_policy_mode", "NONE") or "NONE").upper(),
                "issue_policy_value": Decimal(str(getattr(mat, "issue_policy_value", 0) or 0)),
                "capture_mode": str(getattr(mat, "capture_mode", "AUTO_FROM_OUTPUT") or "AUTO_FROM_OUTPUT").upper(),
            }
    return mapping


def _normalize_issue_policy_overrides(raw):
    src = raw if isinstance(raw, list) else []
    out = {}
    for row in src:
        if not isinstance(row, dict):
            continue
        policy_key = str(row.get("policy_key") or "").strip()
        if not policy_key:
            continue
        mode = str(row.get("issue_policy_mode") or "NONE").strip().upper()
        if mode not in {"NONE", "PERCENT_OVER_THEORY", "FIXED_EXTRA_KG", "MINIMUM_ISSUE_KG"}:
            mode = "NONE"
        try:
            value = Decimal(str(row.get("issue_policy_value") or 0))
        except Exception:
            value = Decimal("0")
        out[policy_key] = {
            "issue_policy_mode": mode,
            "issue_policy_value": value,
        }
    return out


def _planned_issue_qty(theoretical_qty: Decimal, mode: str, value: Decimal) -> Decimal:
    theoretical_qty = Decimal(str(theoretical_qty or 0))
    value = Decimal(str(value or 0))
    mode = str(mode or "NONE").upper()
    if theoretical_qty < 0:
        theoretical_qty = Decimal("0")
    if mode == "PERCENT_OVER_THEORY":
        return (theoretical_qty * (Decimal("1") + (value / Decimal("100")))).quantize(Decimal("0.0001"))
    if mode == "FIXED_EXTRA_KG":
        return (theoretical_qty + value).quantize(Decimal("0.0001"))
    if mode == "MINIMUM_ISSUE_KG":
        return max(theoretical_qty, value).quantize(Decimal("0.0001"))
    return theoretical_qty.quantize(Decimal("0.0001"))


def _summarize_material_plan_lines(lines):
    src = lines if isinstance(lines, list) else []
    theoretical_total = Decimal("0")
    planned_total = Decimal("0")
    override_count = 0
    for row in src:
        if not isinstance(row, dict):
            continue
        theoretical_total += Decimal(str(row.get("theoretical_qty") or 0))
        planned_total += Decimal(str(row.get("planned_issue_qty") or 0))
        if str(row.get("policy_source") or "").upper() == "ORDER_OVERRIDE":
            override_count += 1
    return {
        "line_count": len([row for row in src if isinstance(row, dict)]),
        "override_count": override_count,
        "default_count": max(0, len([row for row in src if isinstance(row, dict)]) - override_count),
        "theoretical_total_qty": float(theoretical_total.quantize(Decimal("0.0001"))),
        "planned_issue_total_qty": float(planned_total.quantize(Decimal("0.0001"))),
        "uom": "KG",
    }


def _build_material_plan_lines(template_snapshot, bom_result):
    template_snapshot = template_snapshot if isinstance(template_snapshot, dict) else {}
    bom_result = bom_result if isinstance(bom_result, dict) else {}
    template_policy_map = _collect_template_issue_policies(template_snapshot.get("template_id"))
    override_map = _normalize_issue_policy_overrides(template_snapshot.get("issue_policy_overrides"))
    lines = []

    for section_name in ("films", "granules", "inks", "chemicals", "addons", "pod"):
        rows = bom_result.get(section_name) or []
        if not isinstance(rows, list):
            continue
        for row in rows:
            if not isinstance(row, dict):
                continue
            material_id, material_name, material_code = _planning_material_identity(section_name, row)
            theoretical_qty = Decimal(str(row.get("weight_kg") or 0))
            if theoretical_qty <= 0:
                continue
            category_code = _planning_category_for_row(section_name, row)
            policy_key = f"{category_code}:{material_id or material_code or material_name}"
            template_policy = template_policy_map.get(category_code, {})
            override_policy = override_map.get(policy_key)
            template_mode = str(template_policy.get("issue_policy_mode", "NONE") or "NONE").upper()
            template_value = Decimal(str(template_policy.get("issue_policy_value", 0) or 0))
            effective_mode = str((override_policy or {}).get("issue_policy_mode") or template_mode or "NONE").upper()
            effective_value = Decimal(str((override_policy or {}).get("issue_policy_value", template_value) or template_value or 0))
            planned_qty = _planned_issue_qty(theoretical_qty, effective_mode, effective_value)
            lines.append(
                {
                    "policy_key": policy_key,
                    "category_code": category_code,
                    "material_id": material_id,
                    "material_code": material_code,
                    "material_name": material_name,
                    "uom": "KG",
                    "step_id": template_policy.get("step_id"),
                    "step_sequence": template_policy.get("step_sequence"),
                    "step_name": template_policy.get("step_name"),
                    "consumption_basis": template_policy.get("consumption_basis"),
                    "formula_driver": template_policy.get("formula_driver"),
                    "formula_params": template_policy.get("formula_params") or {},
                    "capture_mode": template_policy.get("capture_mode"),
                    "theoretical_qty": float(theoretical_qty.quantize(Decimal("0.0001"))),
                    "planned_issue_qty": float(planned_qty),
                    "template_issue_policy_mode": template_mode,
                    "template_issue_policy_value": float(template_value),
                    "override_issue_policy_mode": (override_policy or {}).get("issue_policy_mode"),
                    "override_issue_policy_value": float((override_policy or {}).get("issue_policy_value", 0)) if override_policy else None,
                    "effective_issue_policy_mode": effective_mode,
                    "effective_issue_policy_value": float(effective_value),
                    "policy_source": "ORDER_OVERRIDE" if override_policy else "TEMPLATE_DEFAULT",
                }
            )
    return lines


def _normalize_preview_geometry(raw_geometry, fg_type: str):
    geometry = normalize_geometry_override({}, raw_geometry or {})
    geometry["finished_good_type"] = fg_type
    multipliers = geometry.get("multipliers") if isinstance(geometry.get("multipliers"), dict) else {}
    if "repeats" in multipliers:
        multipliers.pop("repeats", None)
    geometry["multipliers"] = multipliers

    base = geometry.get("base") if isinstance(geometry.get("base"), dict) else {}
    if fg_type == "ROLL":
        base["height_mm"] = 0.0
        geometry["base"] = base
        geometry.pop("repeat_length_mm", None)
    return geometry


def _placeholder_color_names(front_count, back_count):
    front = [f"FRONT-{idx + 1}" for idx in range(max(0, int(front_count or 0)))]
    back = [f"BACK-{idx + 1}" for idx in range(max(0, int(back_count or 0)))]
    return front, back


def _validate_printing_snapshot_for_confirm(item, allow_missing_artwork=False):
    printing = _normalize_printing_snapshot(item.printing_snapshot)
    if not printing.get("enabled", False):
        return printing, False, None

    print_type = str(printing.get("type") or printing.get("method") or "").upper()
    if not print_type:
        raise ValidationError(f"Item {_item_label(item)}: printing type is required when printing is enabled.")

    substrate_mode = str(printing.get("substrate_mode") or "").upper()
    if substrate_mode not in {"SHEET", "TUBING"}:
        raise ValidationError(f"Item {_item_label(item)}: substrate_mode must be SHEET or TUBING.")

    front_count = int(printing.get("front_colors_count") or 0)
    back_count = int(printing.get("back_colors_count") or 0)
    if front_count < 0 or back_count < 0:
        raise ValidationError(f"Item {_item_label(item)}: front/back color counts cannot be negative.")
    if front_count + back_count <= 0:
        raise ValidationError(f"Item {_item_label(item)}: at least one color is required when printing is enabled.")
    if Decimal(str(printing.get("ink_gsm_total") or 0)) <= 0:
        raise ValidationError(f"Item {_item_label(item)}: total ink GSM must be greater than zero.")

    artwork_id = printing.get("artwork_id")
    if not artwork_id:
        if not allow_missing_artwork:
            raise ValidationError(f"Item {_item_label(item)}: approved artwork is required when printing is enabled.")
        front_colors, back_colors = _placeholder_color_names(front_count, back_count)
        printing["front_colors"] = front_colors
        printing["back_colors"] = back_colors
        printing["color_names"] = front_colors + back_colors
        printing["color_mapping"] = {}
        printing["ink_base_family"] = _resolve_ink_base_from_layers(item.layer_snapshot or [])
        printing["cylinder_required"] = print_type == "ROTO"
        printing = validate_frozen_printing_snapshot(
            printing,
            layer_snapshot=item.layer_snapshot or [],
            require_artwork=False,
            strict_inks=False,
        )
        return printing, True, None

    artwork = Artwork.objects.filter(id=artwork_id).first()
    if not artwork:
        raise ValidationError(f"Item {_item_label(item)}: artwork_id is invalid.")
    if artwork.status != "APPROVED":
        raise ValidationError(f"Item {_item_label(item)}: artwork must be APPROVED before confirmation.")
    contract = get_artwork_contract(artwork, require_asset=True)
    artwork_type = str(contract["print_type"] or "").upper().strip()
    if artwork_type and artwork_type != print_type:
        raise ValidationError(
            f"Item {_item_label(item)}: artwork print type {artwork_type} does not match selected print type {print_type}."
        )
    art_front = contract["front_colors"]
    art_back = contract["back_colors"]
    art_front_count = int(contract["front_colors_count"] or len(art_front) or 0)
    art_back_count = int(contract["back_colors_count"] or len(art_back) or 0)
    if art_front_count != front_count or art_back_count != back_count:
        raise ValidationError(
            f"Item {_item_label(item)}: artwork color counts mismatch (expected {front_count}/{back_count}, got {art_front_count}/{art_back_count})."
        )

    if print_type == "ROTO":
        try:
            validate_roto_cylinder_readiness(artwork)
        except ValidationError as exc:
            raise ValidationError(f"Item {_item_label(item)}: {exc}") from exc

    ink_contract = resolve_ink_contract(
        color_names=contract["color_names"],
        layer_snapshot=item.layer_snapshot or [],
        existing_mapping=printing.get("color_mapping") or {},
        strict=True,
    )

    printing["front_colors"] = [str(v).strip().upper() for v in art_front]
    printing["back_colors"] = [str(v).strip().upper() for v in art_back]
    printing["color_names"] = ink_contract["color_names"]
    printing["color_mapping"] = ink_contract["color_mapping"]
    printing["ink_base_family"] = ink_contract["ink_base_family"]
    printing["artwork_id"] = str(artwork.id)
    printing["artwork_design_code"] = artwork.design_code
    printing["cylinder_required"] = print_type == "ROTO"
    printing = validate_frozen_printing_snapshot(
        printing,
        layer_snapshot=item.layer_snapshot or [],
        require_artwork=True,
        strict_inks=True,
    )

    return printing, False, str(artwork.id)


class SalesOrderService:
    @staticmethod
    def create_sales_order(payload):
        with transaction.atomic():
            customer = None
            customer_name = payload.get("customer_name")
            ship_to_customer = None
            ship_to_customer_name = payload.get("ship_to_customer_name")
            if payload.get("customer"):
                from ..models import Customer

                try:
                    customer = Customer.objects.get(id=payload.get("customer"))
                    if not customer_name:
                        customer_name = customer.name
                except Customer.DoesNotExist:
                    pass
            ship_to_id = payload.get("ship_to_customer") or payload.get("ship_to")
            if ship_to_id:
                from ..models import Customer

                try:
                    ship_to_customer = Customer.objects.get(id=ship_to_id)
                    ship_to_customer_name = ship_to_customer.name
                except Customer.DoesNotExist:
                    raise ValidationError("Ship-to customer was not found.")
            elif customer:
                ship_to_customer = customer
                ship_to_customer_name = customer.name

            order_geometry_override = sanitize_geometry_override(payload.get("geometry_override") or payload.get("geometry") or {})
            order = SalesOrder.objects.create(
                customer=customer,
                customer_name=customer_name or "Unknown Customer",
                ship_to_customer=ship_to_customer,
                ship_to_customer_name=ship_to_customer_name or customer_name or "Unknown Customer",
                remarks=str(payload.get("remarks") or "").strip(),
                order_name=str(payload.get("order_name") or "").strip(),
                order_type=payload.get("order_type", "MTO"),
                delivery_date=payload.get("delivery_date"),
                geometry_override=order_geometry_override,
                status="DRAFT",
                execution_model_version=2,
            )

            items_data = payload.get("items", [])
            if not items_data and payload.get("template_id"):
                items_data = [
                    {
                        "template_id": payload.get("template_id"),
                        "sku_variant_id": payload.get("sku_variant_id"),
                        "repeat_source_item_id": payload.get("repeat_source_item_id"),
                        "qty_value": payload.get("qty_value"),
                        "qty_uom": payload.get("qty_uom"),
                        "mode": payload.get("mode", "TEMPLATE"),
                        "fg_type": payload.get("fg_type"),
                        "roll_form": payload.get("roll_form"),
                        "geometry": payload.get("geometry"),
                        "film_layers": payload.get("film_layers"),
                        "printing": payload.get("printing"),
                        "chemicals": payload.get("chemicals"),
                        "addons": payload.get("addons"),
                        "packaging_snapshot": payload.get("packaging_snapshot"),
                        "line_name": payload.get("line_name"),
                        "price_basis": payload.get("price_basis"),
                        "unit_price": payload.get("unit_price"),
                    }
                ]

            if not items_data:
                raise ValidationError("At least one order item is required.")

            for raw_item_data in items_data:
                item_data = _merge_item_source_defaults(raw_item_data)
                template_id = item_data.get("template_id")
                if not template_id:
                    raise ValidationError("template_id is required for every sales order item.")
                template = TemplateBlueprint.objects.get(id=template_id)

                if item_data.get("film_layers") is None:
                    raise ValidationError(f"Item {template.name}: film_layers snapshot is required.")
                if item_data.get("printing") is None:
                    raise ValidationError(f"Item {template.name}: printing snapshot is required.")
                if item_data.get("addons") is None:
                    raise ValidationError(f"Item {template.name}: addons snapshot is required.")

                item_geometry_override = sanitize_geometry_override(item_data.get("geometry") or item_data.get("geometry_override") or order.geometry_override)
                normalized_geometry = normalize_geometry_override({}, item_geometry_override)
                fg_type = str(template.fg_type or "POUCH").upper()
                if fg_type not in {"POUCH", "ROLL"}:
                    raise ValidationError(f"Item {template.name}: fg_type must be POUCH or ROLL.")
                normalized_geometry["finished_good_type"] = fg_type
                qty_uom = str(item_data.get("qty_uom", "KG") or "KG").upper()
                if fg_type == "ROLL":
                    normalized_geometry["roll_form"] = str(item_data.get("roll_form") or "FLAT").upper()
                    normalized_geometry.pop("repeat_length_mm", None)
                    base = normalized_geometry.get("base") if isinstance(normalized_geometry.get("base"), dict) else {}
                    base["height_mm"] = 0.0
                    normalized_geometry["base"] = base
                    qty_uom = "KG"
                else:
                    normalized_geometry.pop("roll_form", None)
                    normalized_geometry = validate_pouch_geometry_contract(
                        fg_type=fg_type,
                        geometry=normalized_geometry,
                        addons=item_data.get("addons") or [],
                        template_pouch_style=str(getattr(template, "pouch_style", "") or ""),
                        context_label=f"Item {template.name}",
                    )

                qty_value = Decimal(str(item_data.get("qty_value", 0) or 0))
                layer_snapshot = _normalize_layer_snapshot(item_data.get("film_layers") or [])
                _validate_template_film_constraints(template, layer_snapshot, template.name)
                printing_snapshot = _normalize_printing_snapshot(item_data.get("printing"))
                addons_snapshot = item_data.get("addons") or []
                packaging_snapshot = _normalize_packaging_snapshot(item_data.get("packaging_snapshot") or {})
                if fg_type == "POUCH":
                    pod_cfg = packaging_snapshot.get("pod") if isinstance(packaging_snapshot.get("pod"), dict) else {}
                    packaging_snapshot["pod"] = _hydrate_pod_snapshot(pod_cfg)
                else:
                    packaging_snapshot["pod"] = {"enabled": False, "pod_profile_id": None, "pod_sku_variant_id": None}
                line_name = str(item_data.get("line_name") or payload.get("line_name") or "").strip()
                price_basis = str(item_data.get("price_basis") or payload.get("price_basis") or "KG").upper()
                if price_basis not in {"KG", "PCS"}:
                    raise ValidationError(f"Item {template.name}: price_basis must be KG or PCS.")
                if fg_type == "ROLL":
                    price_basis = "KG"
                unit_price = Decimal(str(item_data.get("unit_price", payload.get("unit_price", 0)) or 0))
                if unit_price <= 0:
                    raise ValidationError(f"Item {template.name}: unit_price must be greater than zero.")
                spec_payload = build_spec_payload(
                    fg_type=fg_type,
                    roll_form=normalized_geometry.get("roll_form"),
                    geometry=normalized_geometry,
                    film_layers=layer_snapshot,
                    printing=printing_snapshot,
                    addons=addons_snapshot,
                )
                spec_signature = build_spec_signature(spec_payload)
                inv_payload = build_invariant_payload(film_layers=layer_snapshot, printing=printing_snapshot)

                item = SalesOrderItem.objects.create(
                    sales_order=order,
                    template=template,
                    mode=item_data.get("mode", "TEMPLATE"),
                    sku_variant=item_data.get("_resolved_sku_variant"),
                    repeat_source_item=item_data.get("_resolved_repeat_source_item"),
                    line_name=line_name,
                    qty_uom=qty_uom,
                    qty_value=qty_value,
                    price_basis=price_basis,
                    unit_price=unit_price,
                    geometry_snapshot=normalized_geometry,
                    layer_snapshot=layer_snapshot,
                    printing_snapshot=printing_snapshot,
                    addons_snapshot=addons_snapshot,
                    packaging_snapshot=packaging_snapshot,
                    spec_signature=spec_signature,
                    invariant_signature=build_invariant_signature(inv_payload),
                )

                preview_data = {
                    "finished_good_type": fg_type,
                    "geometry": item.geometry_snapshot,
                    "film_layers": item.layer_snapshot,
                    "printing": printing_snapshot,
                    "chemicals": printing_snapshot.get("chemicals") or {},
                    "addons": item.addons_snapshot,
                    "packaging_snapshot": item.packaging_snapshot,
                    "roll_form": normalized_geometry.get("roll_form"),
                    "order_qty": float(item.qty_value),
                    "uom": qty_uom,
                }
                preview = SalesOrderService.preview_sales_item(preview_data)
                item.unit_weight_g = Decimal(str(preview["unit_weight_g"]))
                item.total_weight_kg = Decimal(str(preview["total_weight_kg"]))
                item.bom_snapshot = _make_json_serializable(preview["bom"])
                item.save(update_fields=["unit_weight_g", "total_weight_kg", "bom_snapshot"])

            return order

    @staticmethod
    def create_sales_order_batch(payload):
        customer_id = payload.get("customer")
        customer_name = payload.get("customer_name")
        orders_data = payload.get("orders") or []
        if not isinstance(orders_data, list) or not orders_data:
            raise ValidationError("orders must contain at least one queued sales order.")

        results = []
        for index, raw_order in enumerate(orders_data):
            row = raw_order if isinstance(raw_order, dict) else {}
            client_reference = str(row.get("client_reference") or "").strip()
            source_type = str(row.get("source_type") or "CUSTOM").upper()
            row_payload = {
                "customer": customer_id,
                "customer_name": customer_name,
                "ship_to_customer": row.get("ship_to_customer") or payload.get("ship_to_customer") or payload.get("ship_to"),
                "ship_to_customer_name": row.get("ship_to_customer_name") or payload.get("ship_to_customer_name"),
                "remarks": row.get("remarks") or payload.get("remarks") or "",
                "order_name": str(row.get("order_name") or "").strip(),
                "order_type": str(row.get("order_type") or "MTO").upper(),
                "delivery_date": row.get("delivery_date"),
                "items": row.get("items") or [],
            }
            try:
                items = row_payload["items"]
                if not isinstance(items, list) or len(items) != 1:
                    raise ValidationError("Each queued sales order must contain exactly one item.")
                item = items[0]
                if not isinstance(item, dict):
                    raise ValidationError("Queued sales order item must be an object.")
                if source_type == "CUSTOM":
                    item.setdefault("mode", "CUSTOM")
                elif source_type == "REPEAT":
                    item.setdefault("mode", "REPEAT")
                else:
                    item.setdefault("mode", "TEMPLATE")

                with transaction.atomic():
                    order = SalesOrderService.create_sales_order(row_payload)
                    confirmed_order = SalesOrderService.confirm_sales_order(order.id)

                results.append(
                    {
                        "client_reference": client_reference or str(index),
                        "source_type": source_type,
                        "status": "created",
                        "sales_order_id": str(confirmed_order.id),
                        "sales_order_number": confirmed_order.order_number,
                        "error": "",
                    }
                )
            except Exception as exc:
                results.append(
                    {
                        "client_reference": client_reference or str(index),
                        "source_type": source_type,
                        "status": "failed",
                        "sales_order_id": "",
                        "sales_order_number": "",
                        "error": str(exc),
                    }
                )

        created_count = sum(1 for row in results if row["status"] == "created")
        failed_count = len(results) - created_count
        return {
            "customer": customer_id,
            "customer_name": customer_name,
            "created_count": created_count,
            "failed_count": failed_count,
            "results": results,
        }

    @staticmethod
    def preview_sales_item(payload):
        normalized_payload = dict(payload or {})
        fg_type = _resolve_preview_fg_type(normalized_payload)
        normalized_payload["finished_good_type"] = fg_type
        normalized_payload["geometry"] = _normalize_preview_geometry(normalized_payload.get("geometry") or {}, fg_type)
        if fg_type == "POUCH":
            normalized_payload["geometry"] = validate_pouch_geometry_contract(
                fg_type=fg_type,
                geometry=normalized_payload.get("geometry") or {},
                addons=normalized_payload.get("addons") or [],
                template_pouch_style=str(normalized_payload.get("pouch_style") or ""),
                context_label="Preview item",
            )
        normalized_payload["film_layers"] = _normalize_layer_snapshot(normalized_payload.get("film_layers") or [], strict=False)
        qty_uom = str(normalized_payload.get("uom", "KG") or "KG").upper()
        if fg_type == "ROLL" and qty_uom != "KG":
            raise ValidationError("Roll preview requires KG quantity.")
        if fg_type == "ROLL":
            normalized_payload["uom"] = "KG"
        physics_result = PhysicsEngine.calculate(normalized_payload)
        unit_weight_g = physics_result.get("unit_weight_g", 0) or 0

        printing = normalized_payload.get("printing") or {}
        if printing.get("enabled") and printing.get("artwork_id"):
            artwork = Artwork.objects.filter(id=printing["artwork_id"]).first()
            if artwork:
                art_front = [str(v).strip() for v in (artwork.front_colors or []) if str(v).strip()]
                art_back = [str(v).strip() for v in (artwork.back_colors or []) if str(v).strip()]
                if not art_front and not art_back:
                    legacy_colors = [str(v).strip() for v in (artwork.color_list or []) if str(v).strip()]
                    if legacy_colors:
                        art_front = legacy_colors
                printing["front_colors"] = [str(v).strip().upper() for v in art_front]
                printing["back_colors"] = [str(v).strip().upper() for v in art_back]
                printing["color_names"] = [str(v).strip().upper() for v in (art_front + art_back) if str(v).strip()]

        try:
            bom_result = BOMResolverService.resolve(normalized_payload, physics_result)
        except Exception as exc:
            bom_result = {
                "films": [],
                "granules": [],
                "inks": [],
                "chemicals": [],
                "addons": [],
                "is_complete": False,
                "errors": [str(exc)],
                "summary": {"unit_weight_g": float(round(unit_weight_g, 4))},
            }

        qty_value = Decimal(str(normalized_payload.get("order_qty", 0)))
        qty_uom = str(normalized_payload.get("uom", "KG") or "KG").upper()
        if fg_type == "ROLL":
            total_weight_kg = qty_value
        elif qty_uom == "KG":
            total_weight_kg = qty_value
        else:
            total_weight_kg = (Decimal(str(unit_weight_g)) * qty_value) / Decimal("1000")

        components = []
        roll_kg_absolute_mode = qty_uom == "KG" and fg_type == "ROLL"
        if fg_type == "ROLL":
            sim_qty = Decimal("1")
        elif qty_uom == "PCS":
            sim_qty = qty_value
        elif unit_weight_g > 0:
            sim_qty = (qty_value * Decimal("1000")) / Decimal(str(unit_weight_g))
        else:
            sim_qty = Decimal("1") if qty_uom == "KG" else Decimal("0")

        for category in ["films", "granules", "inks", "chemicals", "addons", "pod"]:
            for row in bom_result.get(category, []):
                unit_weight = Decimal(str(row.get("weight_kg", 0)))
                total_qty = unit_weight if roll_kg_absolute_mode else (unit_weight * sim_qty)
                material_name = row.get("name") or row.get("code") or f"Unknown {category[:-1]}"
                existing = next((c for c in components if c["material_name"] == material_name), None)
                if existing:
                    existing["qty"] = float(round(Decimal(str(existing["qty"])) + total_qty, 4))
                else:
                    components.append(
                        {
                            "material_name": material_name,
                            "qty": float(round(total_qty, 4)),
                            "uom": "KG",
                        }
                    )

        planning_lines = _build_material_plan_lines(normalized_payload, bom_result)
        planning_summary = _summarize_material_plan_lines(planning_lines)
        bom_payload = dict(bom_result or {})
        bom_payload["planning_lines"] = planning_lines
        bom_payload["planning_summary"] = planning_summary

        theoretical_lines = [
            {
                "policy_key": row.get("policy_key"),
                "category_code": row.get("category_code"),
                "material_id": row.get("material_id"),
                "material_code": row.get("material_code"),
                "material_name": row.get("material_name"),
                "uom": row.get("uom") or "KG",
                "theoretical_qty": row.get("theoretical_qty"),
                "template_issue_policy_mode": row.get("template_issue_policy_mode"),
                "template_issue_policy_value": row.get("template_issue_policy_value"),
                "step_id": row.get("step_id"),
                "step_sequence": row.get("step_sequence"),
                "step_name": row.get("step_name"),
            }
            for row in planning_lines
        ]
        planned_issue_lines = [
            {
                "policy_key": row.get("policy_key"),
                "category_code": row.get("category_code"),
                "material_id": row.get("material_id"),
                "material_code": row.get("material_code"),
                "material_name": row.get("material_name"),
                "uom": row.get("uom") or "KG",
                "planned_issue_qty": row.get("planned_issue_qty"),
                "template_issue_policy_mode": row.get("template_issue_policy_mode"),
                "template_issue_policy_value": row.get("template_issue_policy_value"),
                "override_issue_policy_mode": row.get("override_issue_policy_mode"),
                "override_issue_policy_value": row.get("override_issue_policy_value"),
                "effective_issue_policy_mode": row.get("effective_issue_policy_mode"),
                "effective_issue_policy_value": row.get("effective_issue_policy_value"),
                "policy_source": row.get("policy_source"),
                "step_id": row.get("step_id"),
                "step_sequence": row.get("step_sequence"),
                "step_name": row.get("step_name"),
            }
            for row in planning_lines
        ]

        return {
            "unit_weight_g": float(round(unit_weight_g, 4)),
            "total_weight_kg": float(round(total_weight_kg, 4)),
            "physics": physics_result,
            "roll_preview": physics_result.get("roll_preview"),
            "final_product_type": fg_type,
            "bom": bom_payload,
            "bom_preview": {
                "components": components,
                "theoretical_lines": theoretical_lines,
                "planned_issue_lines": planned_issue_lines,
                "planning_summary": planning_summary,
            },
        }

    @staticmethod
    def create_custom_order(payload):
        raise ValidationError("Custom template/R&D sales flow is removed in V2 hard-cut.")

    @staticmethod
    def confirm_sales_order(order_id):
        with transaction.atomic():
            order = SalesOrder.objects.get(id=order_id)
            if order.status not in ["DRAFT", "CONFIRMED"]:
                raise ValidationError(f"Order cannot be confirmed from status {order.status}.")

            for item in order.items.all():
                if item.template.status != "LIVE":
                    raise ValidationError(f"Item {item.template.name} is not LIVE.")
                has_routing = bool(
                    getattr(item.template, "routing_rule_id", None)
                    or getattr(item.template, "routing_rule", None)
                )
                if not has_routing:
                    raise ValidationError(f"Item {item.template.name} has no routing rule assigned.")

                if not hasattr(item, "geometry_snapshot"):
                    item.geometry_snapshot = {}
                if not hasattr(item, "layer_snapshot"):
                    item.layer_snapshot = []
                if not hasattr(item, "packaging_snapshot"):
                    item.packaging_snapshot = {}
                if not hasattr(item, "printing_snapshot"):
                    item.printing_snapshot = {}
                if not hasattr(item, "addons_snapshot"):
                    item.addons_snapshot = []

                normalized_geometry = normalize_geometry_override({}, item.geometry_snapshot or order.geometry_override)
                fg_type = str(item.template.fg_type or "POUCH").upper()
                if fg_type not in {"POUCH", "ROLL"}:
                    fg_type = "POUCH"
                normalized_geometry["finished_good_type"] = fg_type
                if fg_type == "ROLL":
                    normalized_geometry["roll_form"] = str((item.geometry_snapshot or {}).get("roll_form") or "FLAT").upper()
                    normalized_geometry.pop("repeat_length_mm", None)
                    base = normalized_geometry.get("base") if isinstance(normalized_geometry.get("base"), dict) else {}
                    base["height_mm"] = 0.0
                    normalized_geometry["base"] = base
                    item.qty_uom = "KG"
                    item.price_basis = "KG"
                else:
                    normalized_geometry.pop("roll_form", None)

                item.geometry_snapshot = normalized_geometry
                item.layer_snapshot = _normalize_layer_snapshot(item.layer_snapshot or [])
                _validate_template_film_constraints(item.template, item.layer_snapshot, item.template.name)
                item.packaging_snapshot = _normalize_packaging_snapshot(item.packaging_snapshot or {})
                if fg_type == "POUCH":
                    pod_cfg = item.packaging_snapshot.get("pod") if isinstance(item.packaging_snapshot.get("pod"), dict) else {}
                    item.packaging_snapshot["pod"] = _hydrate_pod_snapshot(pod_cfg)
                else:
                    item.packaging_snapshot["pod"] = {"enabled": False, "pod_profile_id": None, "pod_sku_variant_id": None}
                (
                    normalized_printing,
                    artwork_required,
                    assigned_artwork_id,
                ) = _validate_printing_snapshot_for_confirm(
                    item,
                    allow_missing_artwork=True,
                )
                item.printing_snapshot = normalized_printing
                item.artwork_assignment_required = bool(artwork_required)
                item.assigned_artwork_id = assigned_artwork_id
                spec_payload = build_spec_payload(
                    fg_type=fg_type,
                    roll_form=item.geometry_snapshot.get("roll_form"),
                    geometry=item.geometry_snapshot,
                    film_layers=item.layer_snapshot or [],
                    printing=item.printing_snapshot or {},
                    addons=item.addons_snapshot or [],
                )
                item.spec_signature = build_spec_signature(spec_payload)
                inv_payload = build_invariant_payload(
                    film_layers=item.layer_snapshot or [],
                    printing=item.printing_snapshot or {}
                )
                item.invariant_signature = build_invariant_signature(inv_payload)

                preview_data = {
                    "finished_good_type": fg_type,
                    "geometry": item.geometry_snapshot,
                    "film_layers": item.layer_snapshot or [],
                    "printing": item.printing_snapshot or {},
                    "chemicals": (item.printing_snapshot or {}).get("chemicals") or {},
                    "addons": item.addons_snapshot or [],
                    "packaging_snapshot": item.packaging_snapshot or {},
                    "roll_form": item.geometry_snapshot.get("roll_form"),
                    "order_qty": float(item.qty_value),
                    "uom": "KG" if fg_type == "ROLL" else item.qty_uom,
                }
                preview = SalesOrderService.preview_sales_item(preview_data)

                if bool((item.printing_snapshot or {}).get("enabled", False)):
                    inks = ((preview or {}).get("bom") or {}).get("inks") or []
                    if not inks and not item.artwork_assignment_required:
                        raise ValidationError(f"Item {item.template.name}: printing enabled but no inks resolved.")

                item.bom_snapshot = _make_json_serializable(preview["bom"])
                item.unit_weight_g = Decimal(str(preview["unit_weight_g"]))
                item.total_weight_kg = Decimal(str(preview["total_weight_kg"]))
                item.save(
                    update_fields=[
                        "geometry_snapshot",
                        "layer_snapshot",
                        "printing_snapshot",
                        "packaging_snapshot",
                        "artwork_assignment_required",
                        "assigned_artwork",
                        "qty_uom",
                        "price_basis",
                        "spec_signature",
                        "invariant_signature",
                        "bom_snapshot",
                        "unit_weight_g",
                        "total_weight_kg",
                    ]
                )

            order.status = "PLANNING_REQUIRED"
            order.execution_model_version = 2
            order.commercial_confirmed_at = timezone.now()
            order.save(update_fields=["status", "execution_model_version", "commercial_confirmed_at"])
            return order

    @staticmethod
    def cancel_sales_order(order_id, *, user=None, reason=""):
        with transaction.atomic():
            order = SalesOrder.objects.select_for_update().prefetch_related("items").get(id=order_id)
            if order.status in ["RELEASED", "PACKING_READY", "DISPATCH_READY", "COMPLETED", "CANCELLED"]:
                raise ValidationError(f"Order cannot be cancelled from status {order.status}.")

            from apps.production.models import ProductionJob

            jobs = list(ProductionJob.objects.select_for_update().filter(sales_order_item__sales_order=order))
            blocking = [job for job in jobs if str(job.job_state).upper() in {"RELEASED", "EXECUTING", "PAUSED", "COMPLETED"} or str(job.status).upper() in {"RUNNING", "COMPLETED"}]
            if blocking:
                raise ValidationError("Order already has released, executing, paused, or completed production jobs and cannot be cancelled from Sales.")

            for job in jobs:
                job.job_state = "CANCELLED"
                job.status = "CANCELLED"
                job.hold_reason = str(reason or "Sales order cancelled before planner release.")[:255]
                job.save(update_fields=["job_state", "status", "hold_reason", "updated_at"])

            previous_status = order.status
            order.status = "CANCELLED"
            order.save(update_fields=["status"])

            try:
                from apps.users.models import PermissionAuditLog

                PermissionAuditLog.objects.create(
                    user=user if getattr(user, "is_authenticated", False) else None,
                    action="SALES_ORDER_CHANGED",
                    method="POST",
                    path=f"/api/sales/orders/{order.id}/cancel/",
                    required_permission="sales.manage",
                    effective_role=str(getattr(user, "effective_role_code", "") or getattr(user, "role_code", "") or ""),
                    details={
                        "operation": "CANCEL",
                        "order_id": str(order.id),
                        "order_number": order.order_number,
                        "previous_status": previous_status,
                        "new_status": order.status,
                        "cancelled_jobs": len(jobs),
                        "reason": str(reason or ""),
                    },
                )
            except Exception:
                pass
            return order
