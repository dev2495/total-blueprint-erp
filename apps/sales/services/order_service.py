from decimal import Decimal
import uuid

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from apps.artwork.models import Artwork
from apps.inventory.models import InkMaterial
from apps.bom.services_resolver import BOMResolverService
from apps.physics.geometry_override import normalize_geometry_override, sanitize_geometry_override
from apps.physics.spec_signature import (
    build_spec_payload,
    build_spec_signature,
    build_invariant_payload,
    build_invariant_signature,
)
from apps.physics.services_physics import PhysicsEngine
from apps.materials.models import InventoryMaterial
from apps.templates.models import TemplateBlueprint, TemplateProcessStep
from apps.tooling.models import Cylinder

from ..models import SalesOrder, SalesOrderItem


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
    for layer in layer_snapshot if isinstance(layer_snapshot, list) else []:
        if not isinstance(layer, dict):
            continue
        density = Decimal(str(layer.get("density_g_cm3") or 0))
        if density >= Decimal("1.4"):
            return "PET"
    return "POLY"


def _normalize_printing_snapshot(raw):
    src = raw if isinstance(raw, dict) else {}
    out = dict(src)
    out["enabled"] = bool(out.get("enabled", False))

    ptype = str(out.get("type") or out.get("method") or "").strip().upper()
    if ptype:
        out["type"] = ptype
        out["method"] = ptype

    substrate_mode = str(out.get("substrate_mode") or "").strip().upper()
    if substrate_mode:
        out["substrate_mode"] = substrate_mode

    front_count = max(0, _as_int(out.get("front_colors_count"), 0))
    back_count = max(0, _as_int(out.get("back_colors_count"), 0))
    out["front_colors_count"] = front_count
    out["back_colors_count"] = back_count
    out["colors"] = front_count + back_count
    out["ink_gsm_total"] = float(Decimal(str(out.get("ink_gsm_total") or out.get("ink_gsm") or 0)))
    out["ink_gsm"] = out["ink_gsm_total"]
    out["artwork_id"] = str(out.get("artwork_id") or "").strip()
    out["front_colors"] = out.get("front_colors") if isinstance(out.get("front_colors"), list) else []
    out["back_colors"] = out.get("back_colors") if isinstance(out.get("back_colors"), list) else []
    out["color_names"] = out.get("color_names") if isinstance(out.get("color_names"), list) else []
    out["color_mapping"] = out.get("color_mapping") if isinstance(out.get("color_mapping"), dict) else {}
    return out


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
        if not material_id or qty <= 0:
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
        },
    }


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
        return printing, True, None

    artwork = Artwork.objects.filter(id=artwork_id).first()
    if not artwork:
        raise ValidationError(f"Item {_item_label(item)}: artwork_id is invalid.")
    if artwork.status != "APPROVED":
        raise ValidationError(f"Item {_item_label(item)}: artwork must be APPROVED before confirmation.")
    artwork_type = str(getattr(artwork, "print_type", "") or "").upper().strip()
    if artwork_type and artwork_type != print_type:
        raise ValidationError(
            f"Item {_item_label(item)}: artwork print type {artwork_type} does not match selected print type {print_type}."
        )

    art_front = [str(v).strip() for v in (artwork.front_colors or []) if str(v).strip()]
    art_back = [str(v).strip() for v in (artwork.back_colors or []) if str(v).strip()]
    if not art_front and not art_back:
        legacy_colors = [str(v).strip() for v in (artwork.color_list or []) if str(v).strip()]
        if legacy_colors:
            art_front = legacy_colors

    art_front_count = int(artwork.front_colors_count or len(art_front) or 0)
    art_back_count = int(artwork.back_colors_count or len(art_back) or 0)
    if art_front_count != front_count or art_back_count != back_count:
        raise ValidationError(
            f"Item {_item_label(item)}: artwork color counts mismatch (expected {front_count}/{back_count}, got {art_front_count}/{art_back_count})."
        )

    if print_type == "ROTO":
        front_ready = Cylinder.objects.filter(
            artwork_id=artwork.id,
            side="FRONT",
            side_slot_index__lte=max(front_count, 0),
            is_draft=False,
        ).values_list("side_slot_index", flat=True)
        back_ready = Cylinder.objects.filter(
            artwork_id=artwork.id,
            side="BACK",
            side_slot_index__lte=max(back_count, 0),
            is_draft=False,
        ).values_list("side_slot_index", flat=True)
        if len(set(front_ready)) < front_count:
            raise ValidationError(f"Item {_item_label(item)}: ROTO requires full front cylinder coverage from artwork.")
        if len(set(back_ready)) < back_count:
            raise ValidationError(f"Item {_item_label(item)}: ROTO requires full back cylinder coverage from artwork.")

    color_names = [str(v).strip().upper() for v in (art_front + art_back) if str(v).strip()]
    ink_base = _resolve_ink_base_from_layers(item.layer_snapshot or [])
    color_mapping = {}
    unresolved_colors = []
    for color in color_names:
        ink = InkMaterial.objects.filter(base_type=ink_base, color_name__iexact=color).first()
        if ink:
            color_mapping[color] = str(ink.id)
        else:
            unresolved_colors.append(color)

    if unresolved_colors:
        missing = ", ".join(unresolved_colors)
        raise ValidationError(f"Item {_item_label(item)}: missing {ink_base} ink master mapping for colors: {missing}")

    printing["front_colors"] = [str(v).strip().upper() for v in art_front]
    printing["back_colors"] = [str(v).strip().upper() for v in art_back]
    printing["color_names"] = color_names
    printing["color_mapping"] = color_mapping
    printing["ink_base_family"] = ink_base
    printing["artwork_design_code"] = artwork.design_code
    printing["cylinder_required"] = print_type == "ROTO"

    return printing, False, str(artwork.id)


class SalesOrderService:
    @staticmethod
    def create_sales_order(payload):
        with transaction.atomic():
            customer = None
            customer_name = payload.get("customer_name")
            if payload.get("customer"):
                from ..models import Customer

                try:
                    customer = Customer.objects.get(id=payload.get("customer"))
                    if not customer_name:
                        customer_name = customer.name
                except Customer.DoesNotExist:
                    pass

            order_geometry_override = sanitize_geometry_override(payload.get("geometry_override") or payload.get("geometry") or {})
            order = SalesOrder.objects.create(
                customer=customer,
                customer_name=customer_name or "Unknown Customer",
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
                        "qty_value": payload.get("qty_value"),
                        "qty_uom": payload.get("qty_uom"),
                        "mode": payload.get("mode", "TEMPLATE"),
                        "fg_type": payload.get("fg_type"),
                        "roll_form": payload.get("roll_form"),
                        "geometry": payload.get("geometry"),
                        "film_layers": payload.get("film_layers"),
                        "printing": payload.get("printing"),
                        "addons": payload.get("addons"),
                        "packaging_snapshot": payload.get("packaging_snapshot"),
                        "line_name": payload.get("line_name"),
                        "price_basis": payload.get("price_basis"),
                        "unit_price": payload.get("unit_price"),
                    }
                ]

            if not items_data:
                raise ValidationError("At least one order item is required.")

            for item_data in items_data:
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

                qty_value = Decimal(str(item_data.get("qty_value", 0) or 0))
                layer_snapshot = _normalize_layer_snapshot(item_data.get("film_layers") or [])
                _validate_template_film_constraints(template, layer_snapshot, template.name)
                printing_snapshot = _normalize_printing_snapshot(item_data.get("printing"))
                addons_snapshot = item_data.get("addons") or []
                packaging_snapshot = _normalize_packaging_snapshot(item_data.get("packaging_snapshot") or {})
                if fg_type == "POUCH":
                    pod_cfg = packaging_snapshot.get("pod") if isinstance(packaging_snapshot.get("pod"), dict) else {}
                    if bool(pod_cfg.get("enabled")) and not str(pod_cfg.get("pod_profile_id") or "").strip():
                        raise ValidationError(f"Item {template.name}: POD profile is required when POD is enabled.")
                else:
                    packaging_snapshot["pod"] = {"enabled": False, "pod_profile_id": None}
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
    def preview_sales_item(payload):
        normalized_payload = dict(payload or {})
        fg_type = _resolve_preview_fg_type(normalized_payload)
        normalized_payload["finished_good_type"] = fg_type
        normalized_payload["geometry"] = _normalize_preview_geometry(normalized_payload.get("geometry") or {}, fg_type)
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
                    if bool(pod_cfg.get("enabled")) and not str(pod_cfg.get("pod_profile_id") or "").strip():
                        raise ValidationError(f"Item {item.template.name}: POD profile is required when POD is enabled.")
                else:
                    item.packaging_snapshot["pod"] = {"enabled": False, "pod_profile_id": None}
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
