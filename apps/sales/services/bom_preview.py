from __future__ import annotations

from decimal import Decimal, ROUND_CEILING
from typing import Any

from apps.sales.services.axis_resolver import OrderResolutionService


class BOMPreviewService:
    @staticmethod
    def for_line(payload: dict[str, Any]) -> dict[str, Any]:
        resolved = OrderResolutionService.resolve_line(payload, create_variant=False)

        from apps.sales.services.order_service import SalesOrderService

        preview = SalesOrderService.preview_sales_item(resolved["preview_payload"])
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
                "qty": float(line.get("theoretical_qty") or line.get("planned_issue_qty") or 0),
                "uom": str(line.get("uom") or "PCS").upper(),
                "kind": str(params.get("role") or line.get("consumption_basis") or "PACKAGING").upper(),
                "basis": str(params.get("basis") or line.get("consumption_basis") or "").upper(),
                "supply_mode": params.get("supply_mode"),
                "material_code": line.get("material_code"),
                "material_name": line.get("material_name"),
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
                "qty": float(_estimate_packaging_line_qty(payload or {}, preview or {}, line)),
                "uom": str(line.get("uom") or "PCS").upper(),
                "kind": str(line.get("role") or line.get("kind") or "PACKAGING").upper(),
                "basis": str(line.get("basis") or "").upper(),
                "supply_mode": line.get("supply_mode"),
                "material_code": line.get("material_code"),
                "material_name": line.get("material_name"),
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
        m = InventoryMaterial.objects.only("id", "code", "name", "packaging_supply_mode").get(id=material_id)
        row["material_code"] = m.code
        row["material_name"] = m.name
        row["supply_mode"] = (m.packaging_supply_mode or "PURCHASED").upper()
    except Exception:
        return
