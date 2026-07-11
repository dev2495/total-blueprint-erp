from __future__ import annotations

from copy import deepcopy
from decimal import Decimal
from typing import Any

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Q

from apps.artwork.compatibility import product_master_print_context, validate_artwork_compatibility
from apps.artwork.models import Artwork
from apps.inventory.models import InventoryRoll
from apps.materials.models import ProductMaster, ProductVariant
from apps.physics.spec_signature import (
    build_invariant_payload,
    build_invariant_signature,
    build_spec_payload,
    build_spec_signature,
)
from apps.production.models import InventoryAllocation, JobMaterialRequirement, MaterialConsumptionLog, ProductionJob
from apps.sales.models import CustomerProductOverlay, SalesOrderItem
from apps.sales.services.axis_resolver import OrderResolutionService
from apps.sales.services import order_service as order_helpers


FROZEN_ORDER_STATUSES = {
    "RELEASED",
    "PACKING_READY",
    "DISPATCH_READY",
    "COMPLETED",
    "CANCELLED",
}


def _strip_artwork(printing: dict[str, Any]) -> dict[str, Any]:
    cleaned = deepcopy(printing if isinstance(printing, dict) else {})
    for key in (
        "artwork",
        "artwork_id",
        "artwork_ref",
        "artwork_design_code",
        "design_family_code",
        "colorway_name",
        "ink_gsm",
        "ink_gsm_total",
    ):
        cleaned.pop(key, None)
    return cleaned


def _printing_with_current_context(item: SalesOrderItem, current_master: ProductMaster) -> dict[str, Any]:
    printing = deepcopy(item.printing_snapshot or {})
    if not isinstance(printing, dict):
        printing = {}
    axis_values = item.axis_values if isinstance(item.axis_values, dict) else {}
    context = product_master_print_context(current_master, axis_values=axis_values)
    printing.update(
        {
            "print_type": context["print_type"],
            "type": context["print_type"],
            "method": context["print_type"],
            "substrate_mode": context["substrate_mode"],
            "film_type": context["substrate_mode"],
            "compatibility_source": "PRODUCT_MASTER_CURRENT_VERSION",
        }
    )

    artwork_id = str(printing.get("artwork_id") or "").strip()
    if artwork_id:
        artwork = Artwork.objects.filter(id=artwork_id).first()
        try:
            if not artwork:
                raise ValidationError("Artwork does not exist.")
            validate_artwork_compatibility(
                artwork,
                print_type=context["print_type"],
                substrate_mode=context["substrate_mode"],
                require_asset=False,
            )
        except ValidationError:
            printing = _strip_artwork(printing)
            printing.update(
                {
                    "print_type": context["print_type"],
                    "type": context["print_type"],
                    "method": context["print_type"],
                    "substrate_mode": context["substrate_mode"],
                    "film_type": context["substrate_mode"],
                    "defer_artwork_to_planner": True,
                    "artwork_rebase_reason": "CLEARED_INCOMPATIBLE_WITH_CURRENT_PRODUCT_MASTER",
                    "compatibility_source": "PRODUCT_MASTER_CURRENT_VERSION",
                }
            )
    return printing


def _current_size_axis_values(item: SalesOrderItem, current_master: ProductMaster) -> dict[str, Any]:
    """Map a historical size code to the current equivalent by frozen dimensions.

    Product Master size labels can be improved (for example, adding a flap
    suffix) without changing the physical pouch. Rebase must use the current
    size's bound style/formula, not reject the order because its old code no
    longer exists.
    """
    axis_values = deepcopy(item.axis_values or {}) if isinstance(item.axis_values, dict) else {}
    requested = str(axis_values.get("size") or axis_values.get("size_code") or "").strip()
    active_sizes = list(current_master.sizes.filter(active=True).select_related("pouch_style_master"))
    if requested and any(
        requested.lower() in {str(size.code or "").lower(), str(size.label or "").lower()}
        for size in active_sizes
    ):
        return axis_values

    geometry = item.geometry_snapshot if isinstance(item.geometry_snapshot, dict) else {}
    base = geometry.get("base") if isinstance(geometry.get("base"), dict) else {}

    def _decimal(value):
        try:
            return Decimal(str(value or 0))
        except Exception:
            return Decimal("0")

    width = _decimal(geometry.get("width_mm") or base.get("width_mm"))
    height = _decimal(geometry.get("height_mm") or base.get("height_mm"))
    gusset = _decimal(geometry.get("gusset_mm") or base.get("gusset_mm"))
    if width <= 0 or height <= 0:
        return axis_values
    matches = [
        size
        for size in active_sizes
        if abs(Decimal(str(size.width_mm or 0)) - width) <= Decimal("0.01")
        and abs(Decimal(str(size.height_mm or 0)) - height) <= Decimal("0.01")
        and abs(Decimal(str(size.gusset_mm or 0)) - gusset) <= Decimal("0.01")
    ]
    if len(matches) == 1:
        axis_values["size"] = matches[0].code
        axis_values.pop("size_code", None)
    return axis_values


def sales_order_item_product_master_lock_reason(item: SalesOrderItem) -> str:
    order = getattr(item, "sales_order", None)
    status = str(getattr(order, "status", "") or "").upper()
    if status in FROZEN_ORDER_STATUSES:
        return f"order status is {status}"
    active_jobs = ProductionJob.objects.filter(sales_order_item=item).exclude(status="CANCELLED")
    if active_jobs.exists():
        # A queued, unallocated planner draft is not execution truth. Permit it
        # to follow the revised Product Master and let the order service cancel
        # and rebuild its route. Anything released, issued, or started remains
        # frozen and is reported as such.
        revision_lock = order_helpers.SalesOrderService._pre_release_revision_lock_reason(item)
        if revision_lock:
            return revision_lock
    if MaterialConsumptionLog.objects.filter(production_job__sales_order_item=item).exists():
        return "material consumption already logged"
    if (
        JobMaterialRequirement.objects.filter(production_job__sales_order_item=item)
        .filter(Q(assigned_qty__gt=0) | Q(actual_issued_qty__gt=0) | Q(consumed_qty__gt=0))
        .exists()
    ):
        return "material has already been allocated, issued, or consumed"
    if order and InventoryAllocation.objects.filter(sales_order=order).exists():
        return "planner inventory allocation already exists"
    if InventoryRoll.objects.filter(sales_order_item=item).exists():
        return "finished/WIP stock is already linked to the order line"
    return ""


def _rebase_item_to_master(item: SalesOrderItem, current_master: ProductMaster) -> None:
    order = item.sales_order
    axis_values = _current_size_axis_values(item, current_master)
    overlay = None
    if getattr(order, "customer_id", None):
        overlay = CustomerProductOverlay.find_for(
            customer=order.customer,
            product_master=current_master,
            axis_values=axis_values,
        )

    payload = {
        "product_master": str(current_master.id),
        "template_id": str(current_master.template_id or current_master.default_template_id or item.template_id),
        "axis_values": axis_values,
        "customer": str(order.customer_id) if getattr(order, "customer_id", None) else None,
        "customer_product_overlay": str(overlay.id) if overlay else None,
        "qty": float(item.qty_value or 0),
        "quantity_uom": item.qty_uom,
        "printing": _printing_with_current_context(item, current_master),
        "addons": deepcopy(item.addons_snapshot or []),
        "packaging_snapshot": deepcopy(item.packaging_snapshot or {}),
    }
    resolved = OrderResolutionService.resolve_line(payload, create_variant=True)
    variant_id = resolved.get("product_variant")
    product_variant = ProductVariant.objects.filter(id=variant_id, master=current_master, active=True).first() if variant_id else None

    item.product_master = current_master
    item.product_variant = product_variant
    item.customer_product_overlay = overlay
    item.template_id = resolved["template"]
    item.axis_values = deepcopy(resolved.get("axis_values") or {})
    item.geometry_snapshot = deepcopy(resolved.get("geometry_snapshot") or {})
    item.layer_snapshot = deepcopy(resolved.get("layer_snapshot") or [])
    item.printing_snapshot = deepcopy(resolved.get("printing_snapshot") or {})
    item.addons_snapshot = deepcopy(resolved.get("addons_snapshot") or [])
    item.packaging_snapshot = deepcopy(resolved.get("packaging_snapshot") or {})

    try:
        validated_printing, artwork_required, assigned_artwork_id = order_helpers._validate_printing_snapshot_for_confirm(
            item,
            allow_missing_artwork=True,
        )
    except ValidationError:
        item.printing_snapshot = _strip_artwork(item.printing_snapshot)
        item.printing_snapshot["defer_artwork_to_planner"] = True
        validated_printing, artwork_required, assigned_artwork_id = order_helpers._validate_printing_snapshot_for_confirm(
            item,
            allow_missing_artwork=True,
        )
    item.printing_snapshot = validated_printing
    item.artwork_assignment_required = bool(artwork_required)
    item.assigned_artwork_id = assigned_artwork_id

    fg_type = str(
        item.geometry_snapshot.get("finished_good_type")
        or item.geometry_snapshot.get("fg_type")
        or getattr(item.template, "fg_type", "")
        or "POUCH"
    ).upper()
    preview_payload = {
        "finished_good_type": fg_type,
        "geometry": item.geometry_snapshot,
        "film_layers": item.layer_snapshot,
        "printing": item.printing_snapshot,
        "chemicals": (item.printing_snapshot or {}).get("chemicals") or {},
        "addons": item.addons_snapshot,
        "packaging_snapshot": item.packaging_snapshot,
        "roll_form": item.geometry_snapshot.get("roll_form"),
        "order_qty": float(item.qty_value or 0),
        "uom": item.qty_uom,
    }
    preview = order_helpers.SalesOrderService.preview_sales_item(preview_payload)
    item.unit_weight_g = Decimal(str(preview.get("unit_weight_g") or 0))
    item.total_weight_kg = Decimal(str(preview.get("total_weight_kg") or 0))
    item.packaging_snapshot = order_helpers._materialize_packaging_snapshot_quantities(
        item.packaging_snapshot,
        preview_payload,
        item.unit_weight_g,
        item.total_weight_kg,
    )
    item.bom_snapshot = order_helpers._make_json_serializable(preview.get("bom") or {})

    spec_payload = build_spec_payload(
        fg_type=fg_type,
        roll_form=item.geometry_snapshot.get("roll_form"),
        geometry=item.geometry_snapshot,
        film_layers=item.layer_snapshot,
        printing=item.printing_snapshot,
        addons=item.addons_snapshot,
    )
    item.spec_signature = build_spec_signature(spec_payload)
    item.invariant_signature = build_invariant_signature(
        build_invariant_payload(film_layers=item.layer_snapshot, printing=item.printing_snapshot)
    )
    if not item.line_name:
        item.line_name = current_master.name

    item.save(
        update_fields=[
            "template",
            "product_master",
            "product_variant",
            "customer_product_overlay",
            "axis_values",
            "geometry_snapshot",
            "layer_snapshot",
            "printing_snapshot",
            "addons_snapshot",
            "packaging_snapshot",
            "bom_snapshot",
            "unit_weight_g",
            "total_weight_kg",
            "spec_signature",
            "invariant_signature",
            "artwork_assignment_required",
            "assigned_artwork",
            "line_name",
        ]
    )
    if str(order.status or "").upper() in {"CONFIRMED", "PLANNED"}:
        order.status = "PLANNING_REQUIRED"
        order.save(update_fields=["status"])

    # Recreate a planner-only queue from the rebased snapshots. This method is
    # a no-op when no queue exists and refuses every released/allocated/started
    # line through the lock check above.
    order_helpers.SalesOrderService._rebuild_pristine_pre_release_jobs(
        item,
        reason="PRODUCT_MASTER_REBASE",
    )


def rebase_open_sales_lines_to_current_master(source: ProductMaster, current: ProductMaster) -> dict[str, Any]:
    if not source or not current:
        return {"updated": 0, "skipped": 0, "failed": 0, "details": []}
    version_group = current.version_group or source.version_group or source.code
    old_master_ids = list(
        ProductMaster.objects.filter(version_group=version_group)
        .exclude(id=current.id)
        .values_list("id", flat=True)
    )
    if not old_master_ids:
        old_master_ids = [source.id]

    details: list[dict[str, Any]] = []
    updated = skipped = failed = 0
    queryset = (
        SalesOrderItem.objects.select_related("sales_order", "template", "product_master")
        .filter(product_master_id__in=old_master_ids)
        .order_by("sales_order__order_number", "created_at")
    )
    for item in queryset:
        label = getattr(getattr(item, "sales_order", None), "order_number", None) or str(item.id)
        reason = sales_order_item_product_master_lock_reason(item)
        if reason:
            skipped += 1
            details.append({"item_id": str(item.id), "order_number": label, "status": "skipped", "reason": reason})
            continue
        try:
            with transaction.atomic():
                locked = SalesOrderItem.objects.select_for_update().select_related("sales_order", "template").get(id=item.id)
                reason = sales_order_item_product_master_lock_reason(locked)
                if reason:
                    skipped += 1
                    details.append({"item_id": str(item.id), "order_number": label, "status": "skipped", "reason": reason})
                    continue
                _rebase_item_to_master(locked, current)
            updated += 1
            details.append({"item_id": str(item.id), "order_number": label, "status": "updated", "reason": ""})
        except Exception as exc:
            failed += 1
            details.append({"item_id": str(item.id), "order_number": label, "status": "failed", "reason": str(exc)})

    return {"updated": updated, "skipped": skipped, "failed": failed, "details": details[:25]}
