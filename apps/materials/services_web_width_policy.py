from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from django.core.exceptions import ValidationError

from apps.materials.models import WebWidthPolicy


DEFAULT_SLITTING_RULE = {"inter_cut_mm": 5, "edge_trim_mm": 2, "formula": "PER_CUT"}


def _as_decimal(value: Any, default: Decimal = Decimal("0")) -> Decimal:
    try:
        if value in (None, ""):
            return default
        return Decimal(str(value))
    except Exception:
        return default


def _q2(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _positive_numbers(values: Any) -> list[Decimal]:
    out: list[Decimal] = []
    if not isinstance(values, list):
        return out
    for raw in values:
        val = _as_decimal(raw)
        if val > 0:
            out.append(_q2(val))
    return sorted(set(out))


def _positive_lanes(values: Any) -> list[int]:
    out: list[int] = []
    if not isinstance(values, list):
        return out
    for raw in values:
        try:
            lane = int(raw)
        except Exception:
            continue
        if lane > 0:
            out.append(lane)
    return sorted(set(out))


def compute_trim_mm(lane_count: int, rule: dict[str, Any] | None = None) -> Decimal:
    rule = rule if isinstance(rule, dict) else {}
    inter_cut = _as_decimal(rule.get("inter_cut_mm"), Decimal("5"))
    edge_trim = _as_decimal(rule.get("edge_trim_mm"), Decimal("2"))
    formula = str(rule.get("formula") or "PER_CUT").upper()

    if formula == "PER_LANE":
        trim = Decimal(lane_count) * inter_cut + Decimal("2") * edge_trim
    elif formula == "FIXED":
        trim = inter_cut + Decimal("2") * edge_trim
    else:
        trim = Decimal(max(0, lane_count - 1)) * inter_cut + Decimal("2") * edge_trim
    return _q2(max(Decimal("0"), trim))


def web_width_context_from_sales_order_item(item: Any) -> dict[str, str]:
    context: dict[str, str] = {}
    product_master = getattr(item, "product_master", None)
    if product_master:
        context["product_master_id"] = str(getattr(product_master, "id", "") or "")
        context["product_master_code"] = str(getattr(product_master, "code", "") or "").strip()
        context["product_kind"] = str(getattr(product_master, "product_kind", "") or "").strip().upper()
        fixed = getattr(product_master, "fixed_attributes", None) or {}
        if isinstance(fixed, dict):
            style = fixed.get("default_pouch_style") or fixed.get("pouch_style")
            if style:
                context["pouch_style"] = str(style).strip().upper()

    geom = getattr(item, "geometry_snapshot", None) or {}
    if isinstance(geom, dict):
        for key in ("pouch_style", "default_pouch_style"):
            if geom.get(key):
                context["pouch_style"] = str(geom.get(key)).strip().upper()
                break
        config = geom.get("geometry_config") if isinstance(geom.get("geometry_config"), dict) else {}
        if config.get("pouch_style"):
            context["pouch_style"] = str(config.get("pouch_style")).strip().upper()

    return {k: v for k, v in context.items() if v}


def web_width_context_from_job(job: Any) -> dict[str, str]:
    item = getattr(job, "sales_order_item", None)
    context = web_width_context_from_sales_order_item(item) if item else {}
    process = getattr(job, "current_process", None) or getattr(job, "process", None)
    if process:
        if getattr(process, "id", None):
            context["process_id"] = str(process.id)
        if getattr(process, "code", None):
            context["process_code"] = str(process.code).strip().upper()
    machine = getattr(job, "assigned_machine", None) or getattr(job, "machine", None)
    if machine:
        if getattr(machine, "id", None):
            context["machine_id"] = str(machine.id)
        if getattr(machine, "code", None):
            context["machine_code"] = str(machine.code).strip().upper()
    return {k: v for k, v in context.items() if v}


def resolve_web_width_policy(context: dict[str, Any] | None = None) -> WebWidthPolicy | None:
    context = context or {}
    qs = WebWidthPolicy.objects.filter(deprecated=False)

    candidates: list[tuple[str, list[str]]] = [
        (
            "PRODUCT_MASTER",
            [
                str(context.get("product_master_id") or "").strip(),
                str(context.get("product_master_code") or "").strip().upper(),
            ],
        ),
        ("POUCH_STYLE", [str(context.get("pouch_style") or "").strip().upper()]),
        (
            "MACHINE",
            [
                str(context.get("machine_id") or "").strip(),
                str(context.get("machine_code") or "").strip().upper(),
            ],
        ),
        (
            "PROCESS",
            [
                str(context.get("process_id") or "").strip(),
                str(context.get("process_code") or "").strip().upper(),
            ],
        ),
        ("PRODUCT_KIND", [str(context.get("product_kind") or "").strip().upper()]),
    ]

    for scope_type, refs in candidates:
        refs = [ref for ref in refs if ref]
        if not refs:
            continue
        match = qs.filter(scope_type=scope_type, scope_ref__in=refs).order_by("-is_default", "name").first()
        if match:
            return match

    return (
        qs.filter(is_default=True).order_by("name").first()
        or qs.filter(scope_type="GLOBAL").order_by("name").first()
        or qs.order_by("name").first()
    )


def evaluate_web_width_plan(
    child_width_mm: Any,
    lane_count: Any,
    *,
    policy: WebWidthPolicy | None = None,
    context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    child = _as_decimal(child_width_mm)
    try:
        lane = int(lane_count or 1)
    except Exception:
        lane = 1
    lane = max(1, lane)
    if child <= 0:
        raise ValidationError("Child target width is required before web-width planning.")

    policy = policy or resolve_web_width_policy(context)
    allowed_lanes = _positive_lanes(getattr(policy, "allowed_lanes", []) if policy else [])
    if allowed_lanes and lane not in allowed_lanes:
        raise ValidationError(f"Lane count {lane}-up is not allowed by web-width policy {policy.code}.")

    rule = getattr(policy, "slitting_waste_rule", None) if policy else DEFAULT_SLITTING_RULE
    rule = rule if isinstance(rule, dict) else DEFAULT_SLITTING_RULE
    trim = compute_trim_mm(lane, rule)
    computed = _q2(child * Decimal(lane) + trim)

    min_parent = _as_decimal(getattr(policy, "min_parent_width_mm", None), Decimal("0")) if policy else Decimal("0")
    max_parent = _as_decimal(getattr(policy, "max_parent_width_mm", None), Decimal("0")) if policy else Decimal("0")
    strategy = str(getattr(policy, "parent_width_strategy", "CALCULATED") if policy else "CALCULATED").upper()
    allowed_widths = _positive_numbers(getattr(policy, "allowed_parent_widths", []) if policy else [])

    planned = computed
    selected_standard: Decimal | None = None
    warnings: list[str] = []

    if strategy in {"NEAREST_STANDARD", "STRICT_STANDARD"}:
        fits = [w for w in allowed_widths if w >= computed]
        if min_parent > 0:
            fits = [w for w in fits if w >= min_parent]
        if max_parent > 0:
            fits = [w for w in fits if w <= max_parent]
        if fits:
            selected_standard = fits[0]
            planned = selected_standard
        elif strategy == "STRICT_STANDARD":
            widths = ", ".join(str(int(w)) if w == w.to_integral() else str(w) for w in allowed_widths) or "none configured"
            raise ValidationError(
                f"No allowed parent width can fit {computed} mm under web-width policy {policy.code}. Allowed widths: {widths}."
            )
        else:
            warnings.append("No standard parent width fit; using calculated width.")

    if min_parent > 0 and planned < min_parent:
        planned = min_parent
        warnings.append(f"Raised to minimum parent width {min_parent} mm.")
    if max_parent > 0 and planned > max_parent:
        raise ValidationError(
            f"Planned parent width {planned} mm exceeds max parent width {max_parent} mm for web-width policy {policy.code}."
        )

    remainder = _q2(max(Decimal("0"), planned - computed))
    min_remainder = _as_decimal(getattr(policy, "min_remainder_mm", None), Decimal("50")) if policy else Decimal("50")
    if remainder > 0 and remainder < min_remainder:
        remainder_disposition = "SCRAP"
    elif remainder > 0:
        remainder_disposition = "KEEP"
    else:
        remainder_disposition = "NONE"

    return {
        "policy": policy,
        "policy_id": str(policy.id) if policy else None,
        "policy_code": policy.code if policy else "BUILTIN",
        "policy_name": policy.name if policy else "Built-in fallback",
        "scope_type": getattr(policy, "scope_type", "GLOBAL") if policy else "GLOBAL",
        "scope_ref": getattr(policy, "scope_ref", "") if policy else "",
        "parent_width_strategy": strategy,
        "allowed_lanes": allowed_lanes,
        "allowed_parent_widths": [float(w) for w in allowed_widths],
        "child_width_mm": float(_q2(child)),
        "lane_count": lane,
        "trim_mm": float(trim),
        "computed_run_width_mm": float(computed),
        "planned_parent_width_mm": float(_q2(planned)),
        "selected_standard_parent_width_mm": float(selected_standard) if selected_standard else None,
        "remainder_mm": float(remainder),
        "remainder_disposition": remainder_disposition,
        "min_remainder_mm": float(min_remainder),
        "prefer_remainder_first": bool(getattr(policy, "prefer_remainder_first", True)) if policy else True,
        "warnings": warnings,
    }
