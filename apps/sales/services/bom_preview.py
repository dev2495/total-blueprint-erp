from __future__ import annotations

from decimal import Decimal, ROUND_CEILING
from typing import Any

from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework.exceptions import ErrorDetail, ValidationError as DRFValidationError

from apps.sales.services.axis_resolver import OrderResolutionService


class BOMPreviewService:
    @staticmethod
    def for_line(payload: dict[str, Any]) -> dict[str, Any]:
        try:
            resolved = OrderResolutionService.resolve_line(payload, create_variant=False)

            from apps.sales.services.order_service import SalesOrderService

            preview = SalesOrderService.preview_sales_item(resolved["preview_payload"])
        except (DjangoValidationError, DRFValidationError) as exc:
            errors = _validation_messages(exc)
            return _incomplete_preview(payload, errors)
        bom = preview.get("bom") or {}
        planning_lines = bom.get("planning_lines") or []
        grouped: dict[str, dict[str, Any]] = {}
        for row in planning_lines:
            step_key = str(row.get("step_sequence") or row.get("step_name") or "unassigned")
            group = grouped.setdefault(
                step_key,
                {
                    "step_sequence": row.get("step_sequence"),
                    "step_name": row.get("step_name") or "Unassigned",
                    "lines": [],
                    "planned_issue_qty": 0.0,
                    "theoretical_qty": 0.0,
                },
            )
            group["lines"].append(row)
            group["planned_issue_qty"] += float(row.get("planned_issue_qty") or 0)
            group["theoretical_qty"] += float(row.get("theoretical_qty") or 0)

        packaging_lines, pod_lines = _expose_packaging_and_pod_lines(
            payload.get("packaging_snapshot") or payload.get("packaging") or {},
            payload=payload,
            preview=preview,
        )

        return {
            **resolved,
            "unit_weight_g": preview.get("unit_weight_g"),
            "total_weight_kg": preview.get("total_weight_kg"),
            "physics": preview.get("physics"),
            "roll_preview": preview.get("roll_preview"),
            "bom": bom,
            "bom_preview": preview.get("bom_preview") or {},
            "bom_by_step": list(grouped.values()),
            "packaging_lines": packaging_lines,
            "pod_lines": pod_lines,
            "is_complete": bool(bom.get("is_complete", True)),
            "errors": bom.get("errors") or [],
        }


def _incomplete_preview(payload: dict[str, Any], errors: list[str]) -> dict[str, Any]:
    clean_errors = [error for error in errors if error] or ["Live BOM preview could not be resolved."]
    return {
        "product_master": str(payload.get("product_master") or payload.get("product_master_id") or ""),
        "product_variant": str(payload.get("product_variant") or payload.get("product_variant_id") or ""),
        "axis_values": payload.get("axis_values") if isinstance(payload.get("axis_values"), dict) else {},
        "bom": {
            "is_complete": False,
            "errors": clean_errors,
            "planning_lines": [],
        },
        "bom_preview": {},
        "bom_by_step": [],
        "packaging_lines": [],
        "pod_lines": [],
        "is_complete": False,
        "errors": clean_errors,
        "blockers": clean_errors,
        "pre_submit_blockers": clean_errors,
    }


def _validation_messages(exc: BaseException) -> list[str]:
    for value in (
        getattr(exc, "detail", None),
        getattr(exc, "message_dict", None),
        getattr(exc, "messages", None),
    ):
        messages = _flatten_error_value(value)
        if messages:
            return messages
    return _flatten_error_value(str(exc)) or [exc.__class__.__name__]


def _flatten_error_value(value: Any, prefix: str = "") -> list[str]:
    if value in (None, "", [], {}):
        return []
    if isinstance(value, ErrorDetail):
        return [f"{prefix}: {str(value)}" if prefix else str(value)]
    if isinstance(value, str):
        return [f"{prefix}: {value}" if prefix else value]
    if isinstance(value, (list, tuple, set)):
        messages: list[str] = []
        for item in value:
            messages.extend(_flatten_error_value(item, prefix=prefix))
        return messages
    if isinstance(value, dict):
        messages: list[str] = []
        for key, item in value.items():
            next_prefix = f"{prefix}.{key}" if prefix else str(key)
            messages.extend(_flatten_error_value(item, prefix=next_prefix))
        return messages
    return [f"{prefix}: {value}" if prefix else str(value)]


def _expose_packaging_and_pod_lines(
    snapshot: dict[str, Any],
    *,
    payload: dict[str, Any] | None = None,
    preview: dict[str, Any] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if not isinstance(snapshot, dict):
        return [], []
    packaging_lines: list[dict[str, Any]] = []
    pod_lines: list[dict[str, Any]] = []
    preview_bom = (preview or {}).get("bom") if isinstance((preview or {}).get("bom"), dict) else {}
    packaging_plan_lines = [
        row for row in (preview_bom.get("planning_lines") or [])
        if isinstance(row, dict) and str(row.get("category_code") or "").upper() == "PACKAGING"
    ]
    if packaging_plan_lines:
        for line in packaging_plan_lines:
            params = line.get("formula_params") if isinstance(line.get("formula_params"), dict) else {}
            row = {
                "material_id": str(line.get("material_id")) if line.get("material_id") else None,
                "qty": float(line.get("count_qty") or params.get("count_qty") or line.get("theoretical_qty") or line.get("planned_issue_qty") or 0),
                "uom": str(line.get("count_uom") or params.get("count_uom") or line.get("uom") or "PCS").upper(),
                "kind": str(params.get("role") or line.get("consumption_basis") or "PACKAGING").upper(),
                "basis": str(params.get("basis") or line.get("consumption_basis") or "").upper(),
                "supply_mode": params.get("supply_mode"),
                "material_code": line.get("material_code"),
                "material_name": line.get("material_name"),
                "stock_qty": line.get("stock_qty") if line.get("stock_qty") not in (None, "") else params.get("stock_qty"),
                "stock_uom": line.get("stock_uom") or params.get("stock_uom"),
                "weight_kg": line.get("weight_kg") if line.get("weight_kg") not in (None, "") else params.get("weight_kg"),
                "pcs_per_pack": params.get("pcs_per_pack"),
                "kg_per_pack": params.get("kg_per_pack"),
                "pack_count_pcs": line.get("pack_count_pcs") or params.get("pack_count_pcs"),
                "unit_base_qty": line.get("unit_base_qty") or params.get("unit_base_qty"),
                "unit_weight_kg": line.get("unit_weight_kg") or params.get("unit_weight_kg"),
                "base_uom": line.get("base_uom") or params.get("base_uom"),
                "stock_conversion_missing": bool(line.get("stock_conversion_missing") or params.get("stock_conversion_missing")),
                "production_template_id": params.get("production_template_id"),
                "produced_by_product_variant_id": params.get("produced_by_product_variant_id"),
            }
            _hydrate_packaging_line(row)
            packaging_lines.append(row)
        return packaging_lines, _expose_pod_lines(snapshot, preview=preview)

    frozen_lines = snapshot.get("packaging_lines") if isinstance(snapshot.get("packaging_lines"), list) else []
    if frozen_lines:
        for line in frozen_lines:
            if not isinstance(line, dict):
                continue
            material_id = line.get("material_id") or line.get("packaging_material_id")
            row = {
                "material_id": str(material_id) if material_id else None,
                "qty": float(line.get("count_qty") or line.get("pack_count_pcs") or _estimate_packaging_line_qty(payload or {}, preview or {}, line)),
                "uom": str(line.get("count_uom") or "PCS").upper(),
                "kind": str(line.get("role") or line.get("kind") or "PACKAGING").upper(),
                "basis": str(line.get("basis") or "").upper(),
                "supply_mode": line.get("supply_mode"),
                "material_code": line.get("material_code"),
                "material_name": line.get("material_name"),
                "stock_qty": line.get("stock_qty"),
                "stock_uom": line.get("stock_uom"),
                "weight_kg": line.get("weight_kg"),
                "pcs_per_pack": line.get("pcs_per_pack"),
                "kg_per_pack": line.get("kg_per_pack"),
                "pack_count_pcs": line.get("pack_count_pcs"),
                "unit_base_qty": line.get("unit_base_qty"),
                "unit_weight_kg": line.get("unit_weight_kg"),
                "base_uom": line.get("base_uom"),
                "stock_conversion_missing": bool(line.get("stock_conversion_missing")),
                "production_template_id": line.get("production_template_id"),
                "produced_by_product_variant_id": line.get("produced_by_product_variant_id"),
            }
            _hydrate_packaging_line(row)
            packaging_lines.append(row)
        return packaging_lines, _expose_pod_lines(snapshot, preview=preview)

    roll_pack = snapshot.get("roll_dispatch_pack") if isinstance(snapshot.get("roll_dispatch_pack"), dict) else {}
    if roll_pack.get("enabled"):
        for line in roll_pack.get("lines") or []:
            material_id = line.get("material_id")
            row = {
                "material_id": str(material_id) if material_id else None,
                "qty": float(line.get("qty") or 0),
                "uom": str(line.get("uom") or "PCS").upper(),
                "kind": "ROLL_DISPATCH",
                "supply_mode": None,
                "material_code": None,
                "material_name": None,
            }
            _hydrate_packaging_line(row)
            packaging_lines.append(row)

    primary = snapshot.get("primary_inner_pack") if isinstance(snapshot.get("primary_inner_pack"), dict) else {}
    if primary.get("enabled") and primary.get("material_id"):
        qty = _estimate_primary_pack_qty(payload or {}, preview or {}, primary)
        row = {
            "material_id": str(primary.get("material_id")),
            "qty": float(qty),
            "uom": "PCS",
            "kind": "PRIMARY_INNER",
            "basis": f"{primary.get('pcs_per_pack') or 0} pcs/pack",
            "supply_mode": None,
            "material_code": None,
            "material_name": None,
        }
        _hydrate_packaging_line(row)
        packaging_lines.append(row)

    pod_lines = _expose_pod_lines(snapshot, preview=preview)

    return packaging_lines, pod_lines


def _expose_pod_lines(snapshot: dict[str, Any], *, preview: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    pod_lines: list[dict[str, Any]] = []
    pod = snapshot.get("pod") if isinstance(snapshot.get("pod"), dict) else {}
    if pod.get("enabled") and pod.get("pod_sku_variant_id"):
        try:
            from apps.materials.models import PodSkuVariant
            variant = PodSkuVariant.objects.select_related("material").get(id=pod.get("pod_sku_variant_id"))
            material = variant.material
            qty = None
            preview_bom = (preview or {}).get("bom") if isinstance((preview or {}).get("bom"), dict) else {}
            for line in preview_bom.get("planning_lines") or []:
                if not isinstance(line, dict):
                    continue
                if str(line.get("material_id") or "") == str(getattr(material, "id", "") or ""):
                    qty = float(line.get("theoretical_qty") or line.get("planned_issue_qty") or 0)
                    break
            pod_lines.append({
                "material_id": str(material.id) if material else None,
                "material_code": getattr(material, "code", None),
                "material_name": getattr(material, "name", None),
                "kind": "POD",
                "supply_mode": "IN_HOUSE" if getattr(material, "pod_is_inhouse_produced", False) else "PURCHASED",
                "qty": qty,
                "uom": "KG",
            })
        except Exception:
            pass

    return pod_lines


def _estimate_primary_pack_qty(payload: dict[str, Any], preview: dict[str, Any], primary: dict[str, Any]) -> Decimal:
    explicit = Decimal(str(primary.get("qty") or primary.get("target_qty") or 0))
    if explicit > 0:
        return explicit

    pcs_per_pack = Decimal(str(primary.get("pcs_per_pack") or 0))
    if pcs_per_pack <= 0:
        return Decimal("0")

    qty = Decimal(str(payload.get("qty") or payload.get("quantity") or payload.get("order_qty") or payload.get("qty_value") or 0))
    uom = str(payload.get("uom") or payload.get("quantity_uom") or payload.get("qty_uom") or "PCS").upper()
    if uom == "PCS":
        pieces = qty
    elif uom == "KG":
        unit_weight_g = Decimal(str(preview.get("unit_weight_g") or payload.get("unit_weight_g") or 0))
        pieces = (qty * Decimal("1000") / unit_weight_g) if unit_weight_g > 0 else Decimal("0")
    else:
        pieces = Decimal("0")

    if pieces <= 0:
        return Decimal("0")
    return (pieces / pcs_per_pack).to_integral_value(rounding=ROUND_CEILING)


def _estimate_packaging_line_qty(payload: dict[str, Any], preview: dict[str, Any], line: dict[str, Any]) -> Decimal:
    explicit = Decimal(str(line.get("qty") or line.get("target_qty") or 0))
    if explicit > 0:
        return explicit
    basis = str(line.get("basis") or "").upper()
    pcs_per_pack = Decimal(str(line.get("pcs_per_pack") or 0))
    kg_per_pack = Decimal(str(line.get("kg_per_pack") or line.get("kg_per_bag") or 0))
    qty = Decimal(str(payload.get("qty") or payload.get("quantity") or payload.get("order_qty") or payload.get("qty_value") or 0))
    uom = str(payload.get("uom") or payload.get("quantity_uom") or payload.get("qty_uom") or "PCS").upper()
    unit_weight_g = Decimal(str(preview.get("unit_weight_g") or payload.get("unit_weight_g") or 0))

    pieces = qty if uom == "PCS" else ((qty * Decimal("1000") / unit_weight_g) if uom == "KG" and unit_weight_g > 0 else Decimal("0"))
    kg = qty if uom == "KG" else ((qty * unit_weight_g / Decimal("1000")) if uom == "PCS" and unit_weight_g > 0 else Decimal("0"))

    if (basis in {"PCS_PER_PACK", "PRIMARY_INNER_PACK"} or pcs_per_pack > 0) and pieces > 0 and pcs_per_pack > 0:
        return (pieces / pcs_per_pack).to_integral_value(rounding=ROUND_CEILING)
    if (basis == "KG_PER_PACK" or kg_per_pack > 0) and kg > 0 and kg_per_pack > 0:
        return (kg / kg_per_pack).to_integral_value(rounding=ROUND_CEILING)
    return Decimal("0")


def _hydrate_packaging_line(row: dict[str, Any]) -> None:
    material_id = row.get("material_id")
    if not material_id:
        return
    try:
        from apps.materials.models import InventoryMaterial
        m = InventoryMaterial.objects.only(
            "id",
            "code",
            "name",
            "base_uom",
            "packaging_supply_mode",
            "packaging_kind",
            "per_sheet_base_qty",
            "production_template_id",
            "produced_by_product_variant_id",
        ).get(id=material_id)
        row["material_code"] = m.code
        row["material_name"] = m.name
        row["supply_mode"] = (m.packaging_supply_mode or "PURCHASED").upper()
        row["packaging_kind"] = (m.packaging_kind or "").upper()
        if row.get("base_uom") in (None, ""):
            row["base_uom"] = (m.base_uom or "PCS").upper()
        if row.get("stock_uom") in (None, ""):
            row["stock_uom"] = (m.base_uom or "PCS").upper()
        if row.get("unit_base_qty") in (None, "") and m.per_sheet_base_qty is not None:
            row["unit_base_qty"] = float(m.per_sheet_base_qty)
        if row.get("unit_weight_kg") in (None, "") and str(m.base_uom or "").upper() == "KG" and m.per_sheet_base_qty is not None:
            row["unit_weight_kg"] = float(m.per_sheet_base_qty)
        if row.get("production_template_id") in (None, ""):
            row["production_template_id"] = str(m.production_template_id) if m.production_template_id else None
        if row.get("produced_by_product_variant_id") in (None, ""):
            row["produced_by_product_variant_id"] = str(m.produced_by_product_variant_id) if m.produced_by_product_variant_id else None
    except Exception:
        return
