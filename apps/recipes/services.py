from __future__ import annotations

import logging
from decimal import Decimal
from typing import Any, Iterable


logger = logging.getLogger(__name__)


def recipe_contract(recipe) -> dict[str, Any]:
    return {
        "film_variant_id": str(getattr(recipe, "film_variant_id", "") or ""),
        "film_variant_code": str(getattr(getattr(recipe, "film_variant", None), "code", "") or ""),
        "grade_id": str(getattr(recipe, "grade_id", "") or ""),
        "grade_name": str(getattr(getattr(recipe, "grade", None), "name", "") or ""),
        "thickness_min_micron": int(getattr(recipe, "thickness_min_micron", 0) or 0),
        "thickness_max_micron": int(getattr(recipe, "thickness_max_micron", 0) or 0),
    }


def recipe_component_snapshot(recipe) -> list[dict[str, Any]]:
    return [
        {
            "granule_id": str(component.granule_id),
            "granule_code": str(getattr(component.granule, "code", "") or ""),
            "granule_name": str(getattr(component.granule, "name", "") or ""),
            "percentage": str(Decimal(str(component.percentage or 0)).quantize(Decimal("0.01"))),
        }
        for component in recipe.components.select_related("granule").order_by("granule__code")
    ]


def recipe_change_impact(contracts: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """Classify matching order lines without mutating planning or production state."""

    from django.db.models import Q

    from apps.production.models import ProductionJob
    from apps.sales.models import SalesOrderItem
    from apps.sales.services.order_service import SalesOrderService

    contracts = [contract for contract in contracts if isinstance(contract, dict)]
    result: dict[str, Any] = {
        "matched_total": 0,
        "refreshable": 0,
        "frozen": 0,
        "released": 0,
        "in_production": 0,
        "closed": 0,
        "without_queue": 0,
        "samples": [],
    }
    if not contracts:
        return result

    contract_filter = Q()
    for contract in contracts:
        variant_id = str(contract.get("film_variant_id") or "").strip()
        grade_id = str(contract.get("grade_id") or "").strip()
        if variant_id and grade_id:
            contract_filter |= Q(layer_snapshot__contains=[{"variant_id": variant_id, "grade_id": grade_id}])
    items = SalesOrderItem.objects.select_related("sales_order").order_by("-created_at")
    if contract_filter.children:
        items = items.filter(contract_filter)
    for item in items.iterator():
        layers = item.layer_snapshot if isinstance(item.layer_snapshot, list) else []
        if not any(
            layer_matches_recipe_contract(layer, contract)
            for layer in layers
            for contract in contracts
        ):
            continue

        result["matched_total"] += 1
        order_status = str(item.sales_order.status or "").upper()
        line_status = str(item.line_status or "").upper()
        lock_reason = SalesOrderService._pre_release_revision_lock_reason(item)
        if lock_reason:
            result["frozen"] += 1
        else:
            result["refreshable"] += 1
        if order_status == "RELEASED" or line_status == "RELEASED":
            result["released"] += 1
        if line_status in {"IN_PRODUCTION", "PARTIAL"}:
            result["in_production"] += 1
        if order_status in {"PACKING_READY", "DISPATCH_READY", "COMPLETED", "CANCELLED"} or line_status in {
            "PACKING_READY", "DISPATCH_READY", "COMPLETED", "CANCELLED", "SHORT_CLOSED"
        }:
            result["closed"] += 1
        if not ProductionJob.objects.filter(sales_order_item=item).exclude(job_state="CANCELLED").exists():
            result["without_queue"] += 1
        if len(result["samples"]) < 8:
            result["samples"].append(
                {
                    "order_number": item.sales_order.order_number,
                    "line_id": str(item.id),
                    "order_status": order_status,
                    "line_status": line_status,
                    "outcome": "FROZEN" if lock_reason else "REFRESHABLE",
                    "reason": lock_reason or "Open line will refresh against this recipe",
                }
            )
    return result


def record_recipe_revision(
    recipe,
    *,
    event: str,
    change_reason: str = "",
    impact_snapshot: dict[str, Any] | None = None,
    changed_by=None,
):
    from .models import ExtrusionRecipeRevision

    return ExtrusionRecipeRevision.objects.create(
        recipe=recipe,
        revision_no=recipe.revision_no,
        event=event,
        change_reason=str(change_reason or "").strip()[:255],
        contract_snapshot=recipe_contract(recipe),
        components_snapshot=recipe_component_snapshot(recipe),
        impact_snapshot=impact_snapshot or {},
        changed_by=changed_by if getattr(changed_by, "is_authenticated", False) else None,
    )


def layer_matches_recipe_contract(layer: Any, contract: dict[str, Any]) -> bool:
    if not isinstance(layer, dict) or not isinstance(contract, dict):
        return False

    variant_id = str(layer.get("variant_id") or layer.get("material_id") or "").strip()
    variant_code = str(
        layer.get("material_code")
        or layer.get("film_variant_code")
        or layer.get("code")
        or ""
    ).strip().upper()
    wanted_variant_id = str(contract.get("film_variant_id") or "").strip()
    wanted_variant_code = str(contract.get("film_variant_code") or "").strip().upper()
    if wanted_variant_id:
        if variant_id != wanted_variant_id:
            return False
    elif wanted_variant_code and variant_code != wanted_variant_code:
        return False

    grade_id = str(layer.get("grade_id") or "").strip()
    grade_name = str(layer.get("grade_code") or layer.get("grade") or "").strip().upper()
    wanted_grade_id = str(contract.get("grade_id") or "").strip()
    wanted_grade_name = str(contract.get("grade_name") or "").strip().upper()
    if wanted_grade_id:
        if grade_id and grade_id != wanted_grade_id:
            return False
        if not grade_id and wanted_grade_name and grade_name != wanted_grade_name:
            return False
    elif wanted_grade_name and grade_name != wanted_grade_name:
        return False

    try:
        thickness = Decimal(str(layer.get("thickness_micron") or layer.get("thickness_um") or 0))
        minimum = Decimal(str(contract.get("thickness_min_micron") or 0))
        maximum = Decimal(str(contract.get("thickness_max_micron") or 0))
    except Exception:
        return False
    return minimum > 0 and maximum >= minimum and minimum <= thickness <= maximum


def refresh_open_sales_boms_for_recipe_contracts(
    contracts: Iterable[dict[str, Any]],
    *,
    raise_on_error: bool = False,
) -> dict[str, int]:
    """Refresh mutable sales BOMs affected by a recipe create/edit/delete.

    Released/executing history remains immutable because the shared sales
    refresh service applies the normal pre-release locks and queue safeguards.
    """

    from apps.sales.models import SalesOrderItem
    from apps.sales.services.order_service import SalesOrderService

    contracts = [contract for contract in contracts if isinstance(contract, dict)]
    empty_stats = {
        "matched_items": 0,
        "checked": 0,
        "refreshed": 0,
        "failed": 0,
        "skipped": 0,
        "queues_rebuilt": 0,
        "queues_frozen": 0,
        "queues_planning_required": 0,
        "still_blocked": 0,
    }
    if not contracts:
        return empty_stats

    candidates = SalesOrderItem.objects.select_related("sales_order", "product_master").filter(
        sales_order__status__in={"DRAFT", "CONFIRMED", "PLANNING_REQUIRED", "PLANNED"},
        line_status__in={"OPEN", "PLANNING_REQUIRED", "PLANNED", ""},
        product_master__active=True,
        product_master__is_current_version=True,
    )
    matched_ids = []
    for item in candidates.iterator():
        layers = item.layer_snapshot if isinstance(item.layer_snapshot, list) else []
        if any(
            layer_matches_recipe_contract(layer, contract)
            for layer in layers
            for contract in contracts
        ):
            matched_ids.append(item.id)

    if not matched_ids:
        return empty_stats

    try:
        stats = SalesOrderService.refresh_open_snapshots_for_items(
            SalesOrderItem.objects.filter(id__in=matched_ids),
            reason="EXTRUSION_RECIPE_CHANGED",
            raise_on_error=raise_on_error,
        )
    except Exception:
        logger.exception("Recipe saved, but matching open BOM snapshots could not be refreshed.")
        if raise_on_error:
            raise
        return {**empty_stats, "matched_items": len(matched_ids), "failed": len(matched_ids)}

    still_blocked = 0
    for bom_snapshot in SalesOrderItem.objects.filter(id__in=matched_ids).values_list(
        "bom_snapshot", flat=True
    ):
        errors = bom_snapshot.get("errors") if isinstance(bom_snapshot, dict) else None
        if errors:
            still_blocked += 1
    return {
        **empty_stats,
        **stats,
        "matched_items": len(matched_ids),
        "still_blocked": still_blocked,
    }
