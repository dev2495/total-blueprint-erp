from __future__ import annotations

from copy import deepcopy
from decimal import Decimal
from typing import Any

from django.core.exceptions import ValidationError

from apps.artwork.models import Artwork
from apps.materials.chemistry_defaults import chemicals_payload_from_fixed_attributes
from apps.materials.models import ProductMaster, ProductVariant
from apps.materials.services_product_variant import (
    apply_layer_totals_to_geometry,
    axis_signature,
    canonical_axis_values,
    compute_geometry,
    compute_layers,
    find_or_create_product_variant,
    validate_axis_values,
)
from apps.sales.models import Customer, CustomerProductOverlay
from apps.templates.models import TemplateBlueprint


def _clean_uuid(value: Any) -> str | None:
    raw = str(value or "").strip()
    return raw or None


def _template_for(master: ProductMaster, template_id: Any = None) -> TemplateBlueprint:
    if template_id:
        try:
            return TemplateBlueprint.objects.get(id=template_id)
        except TemplateBlueprint.DoesNotExist as exc:
            raise ValidationError("template_id is invalid.") from exc
    template = master.template or master.default_template
    if not template:
        raise ValidationError("Product Master must be bound to a live template before preview/order.")
    return template


def _resolve_customer(customer_id: Any) -> Customer | None:
    customer_id = _clean_uuid(customer_id)
    if not customer_id:
        return None
    try:
        return Customer.objects.get(id=customer_id)
    except Customer.DoesNotExist as exc:
        raise ValidationError("customer is invalid.") from exc


def _resolve_overlay(*, overlay_id: Any = None, customer: Customer | None, master: ProductMaster, axis_values: dict[str, Any]):
    overlay_id = _clean_uuid(overlay_id)
    if overlay_id:
        try:
            overlay = CustomerProductOverlay.objects.select_related("customer", "product_master", "default_artwork").get(id=overlay_id, active=True)
        except CustomerProductOverlay.DoesNotExist as exc:
            raise ValidationError("customer_product_overlay is invalid.") from exc
        if overlay.product_master_id != master.id:
            raise ValidationError("customer_product_overlay does not belong to the selected Product Master.")
        if customer and overlay.customer_id != customer.id:
            raise ValidationError("customer_product_overlay does not belong to the selected customer.")
        return overlay
    return CustomerProductOverlay.find_for(customer=customer, product_master=master, axis_values=axis_values)


def _positive_int(value: Any, default: int = 0) -> int:
    try:
        parsed = int(value)
    except Exception:
        parsed = int(default)
    return max(0, parsed)


def _positive_decimal(value: Any, default: Decimal = Decimal("0")) -> Decimal:
    try:
        parsed = Decimal(str(value))
    except Exception:
        parsed = Decimal(str(default))
    return parsed if parsed > 0 else Decimal(str(default))


def _printing_from_payload(payload: dict[str, Any], *, master: ProductMaster, overlay: CustomerProductOverlay | None) -> dict[str, Any]:
    printing = deepcopy(payload.get("printing") or payload.get("printing_snapshot") or {})
    if not isinstance(printing, dict):
        printing = {}
    fixed = master.fixed_attributes if isinstance(master.fixed_attributes, dict) else {}
    artwork_id = (
        printing.get("artwork_id")
        or payload.get("artwork")
        or payload.get("artwork_id")
        or (overlay.default_artwork_id if overlay else None)
    )
    artwork = None
    if artwork_id:
        artwork = Artwork.objects.filter(id=artwork_id).first()
    # `printing.enabled` is the BOM-resolver gate: it decides whether ink
    # rows + colors get computed for this line. It is TRUE only when:
    #   (a) an artwork is actually attached on the line / overlay, OR
    #   (b) the master forces artwork (artwork_required=true) — confirm-time
    #       validation will then either resolve a PM default or block the
    #       confirm with a clear error.
    # If the master is merely print_capable with optional artwork AND no
    # artwork is on the line, enabled stays FALSE → the line is a
    # warning-print run (date stamps / batch codes / plain) and the BOM
    # carries ZERO ink rows. Production routing still hits the printing
    # step because routing is template-driven, not `enabled`-driven.
    artwork_required = bool(fixed.get("artwork_required", False))
    incoming_enabled = printing.get("enabled")
    if incoming_enabled is None:
        printing["enabled"] = bool(artwork) or artwork_required
    else:
        # Explicit caller-supplied enabled flag wins (e.g. preview flows that
        # want enabled=false). But never force it ON without an artwork or
        # artwork_required — that's the "fake ink" trap we just designed out.
        printing["enabled"] = bool(incoming_enabled) and (bool(artwork) or artwork_required)
    printing.setdefault("defer_artwork_to_planner", bool(payload.get("defer_artwork_to_planner", False)))
    if artwork:
        artwork_mapping = getattr(artwork, "color_mapping", {}) if isinstance(getattr(artwork, "color_mapping", {}), dict) else {}
        incoming_mapping = printing.get("color_mapping") if isinstance(printing.get("color_mapping"), dict) else {}
        printing.update(
            {
                "artwork_id": str(artwork.id),
                "artwork_design_code": artwork.design_code,
                "design_family_code": getattr(artwork, "design_family_code", "") or "",
                "colorway_name": getattr(artwork, "colorway_name", "") or "",
                "front_colors": getattr(artwork, "front_colors", None) or getattr(artwork, "color_list", None) or [],
                "back_colors": getattr(artwork, "back_colors", None) or [],
                "front_colors_count": getattr(artwork, "front_colors_count", None) or len(getattr(artwork, "front_colors", None) or getattr(artwork, "color_list", None) or []),
                "back_colors_count": getattr(artwork, "back_colors_count", None) or len(getattr(artwork, "back_colors", None) or []),
                "print_type": getattr(artwork, "print_type", "") or printing.get("print_type") or fixed.get("print_type") or "ROTO",
                "type": getattr(artwork, "print_type", "") or printing.get("type") or printing.get("print_type") or fixed.get("print_type") or "ROTO",
                "color_mapping": {**artwork_mapping, **incoming_mapping},
            }
        )
    else:
        printing.setdefault("print_type", fixed.get("print_type") or "ROTO")
        printing.setdefault("type", printing.get("print_type") or fixed.get("print_type") or "ROTO")
    default_chemicals = chemicals_payload_from_fixed_attributes(
        fixed,
        layer_template=master.layer_template or master.canonical_layer_stack,
    )
    chemicals = deepcopy(default_chemicals)
    incoming_chemicals = payload.get("chemicals") or printing.get("chemicals") or {}
    if isinstance(incoming_chemicals, dict):
        chemicals.update(incoming_chemicals)
    if chemicals:
        printing["chemicals"] = chemicals
    if printing.get("enabled", False):
        substrate_mode = str(
            printing.get("substrate_mode")
            or printing.get("film_type")
            or fixed.get("film_type")
            or "SHEET"
        ).strip().upper()
        if substrate_mode not in {"SHEET", "TUBING"}:
            substrate_mode = "SHEET"
        printing["substrate_mode"] = substrate_mode
        printing["film_type"] = substrate_mode

        print_type = str(
            printing.get("type")
            or printing.get("method")
            or printing.get("print_type")
            or fixed.get("print_type")
            or "ROTO"
        ).strip().upper()
        if print_type:
            printing["type"] = print_type
            printing["method"] = print_type
            printing["print_type"] = print_type

        front_default = (
            fixed.get("default_front_colors")
            or fixed.get("front_colors_count")
            or fixed.get("default_color_count")
            or 1
        )
        back_default = (
            fixed.get("default_back_colors")
            or fixed.get("back_colors_count")
            or 0
        )
        front_count = _positive_int(
            printing.get("front_colors_count")
            or len(printing.get("front_colors") or [])
            or front_default,
            1,
        )
        back_count = _positive_int(
            printing.get("back_colors_count")
            or len(printing.get("back_colors") or [])
            or back_default,
            0,
        )
        if substrate_mode == "SHEET":
            back_count = 0
        printing["front_colors_count"] = front_count
        printing["back_colors_count"] = back_count

        ink_gsm = _positive_decimal(
            printing.get("ink_gsm_total")
            or printing.get("ink_gsm")
            or fixed.get("default_ink_gsm_total")
            or fixed.get("ink_gsm_total")
            or fixed.get("ink_gsm")
            or Decimal("1.2"),
            Decimal("1.2"),
        )
        printing["ink_gsm_total"] = float(ink_gsm)
        printing["ink_gsm"] = float(ink_gsm)
    return printing


class OrderResolutionService:
    @staticmethod
    def resolve_line(payload: dict[str, Any], *, create_variant: bool = False) -> dict[str, Any]:
        payload = payload if isinstance(payload, dict) else {}
        product_id = _clean_uuid(payload.get("product_master") or payload.get("product_master_id"))
        if not product_id:
            raise ValidationError("product_master is required.")
        try:
            master = ProductMaster.objects.select_related("template", "default_template").get(id=product_id, active=True)
        except ProductMaster.DoesNotExist as exc:
            raise ValidationError("product_master is invalid or inactive.") from exc

        axis_values = canonical_axis_values(payload.get("axis_values") if isinstance(payload.get("axis_values"), dict) else {})
        validate_axis_values(master, axis_values)
        template = _template_for(master, payload.get("template_id") or payload.get("template"))
        customer = _resolve_customer(payload.get("customer") or payload.get("customer_id"))
        overlay = _resolve_overlay(
            overlay_id=payload.get("customer_product_overlay") or payload.get("customer_product_overlay_id"),
            customer=customer,
            master=master,
            axis_values=axis_values,
        )

        variant = None
        variant_created = False
        if create_variant:
            variant, variant_created = find_or_create_product_variant(master, axis_values, code=payload.get("variant_code") or payload.get("code"))
        else:
            signature = axis_signature(master, axis_values)
            variant = ProductVariant.objects.filter(master=master, bom_signature=signature, active=True).first()

        geometry = deepcopy(getattr(variant, "geometry_snapshot", None) or compute_geometry(master, axis_values))
        layers = deepcopy(getattr(variant, "layer_snapshot", None) or compute_layers(master, axis_values, geometry))
        geometry = apply_layer_totals_to_geometry(geometry, layers)

        from apps.sales.services import order_service as order_helpers

        addons = order_helpers._addons_from_axis_values(
            payload.get("addons") if isinstance(payload.get("addons"), list) else axis_values
        )
        fixed_attrs = master.fixed_attributes if isinstance(master.fixed_attributes, dict) else {}
        base_packaging_snapshot = deepcopy(payload.get("packaging_snapshot") or payload.get("packaging") or {})
        if isinstance(fixed_attrs.get("packaging_lines"), list) and fixed_attrs.get("packaging_lines"):
            base_packaging_snapshot.setdefault("packaging_lines", deepcopy(fixed_attrs.get("packaging_lines") or []))
        if fixed_attrs.get("pod_enabled"):
            base_packaging_snapshot.setdefault(
                "pod",
                {
                    "enabled": True,
                    "pod_sku_variant_id": fixed_attrs.get("pod_variant") or fixed_attrs.get("pod_variant_id") or fixed_attrs.get("pod_variant_code"),
                    "pod_sku_code": fixed_attrs.get("pod_variant_code") or "",
                    "pod_profile_id": fixed_attrs.get("pod_material") or fixed_attrs.get("pod_material_id"),
                },
            )
        packaging_snapshot = order_helpers._merge_axis_packaging_snapshot(
            base_packaging_snapshot,
            axis_values,
            overlay=overlay,
            finished_good_type=str(master.product_kind or template.fg_type or "").upper(),
        )
        normalized_packaging = order_helpers._normalize_packaging_snapshot(packaging_snapshot)
        if str(template.fg_type or "").upper() == "POUCH":
            normalized_packaging["pod"] = order_helpers._hydrate_pod_snapshot(normalized_packaging.get("pod") or {})
        printing = order_helpers._normalize_printing_snapshot(_printing_from_payload(payload, master=master, overlay=overlay))
        layer_snapshot = order_helpers._normalize_layer_snapshot(layers, strict=False)
        fg_type = str(master.product_kind or template.fg_type or "POUCH").upper()
        quantity = Decimal(str(payload.get("qty") or payload.get("quantity") or payload.get("order_qty") or payload.get("qty_value") or 0))
        quantity_uom = str(payload.get("uom") or payload.get("quantity_uom") or payload.get("qty_uom") or "KG").upper()
        if fg_type == "ROLL":
            quantity_uom = "KG"

        preview_payload = {
            "template_id": str(template.id),
            "finished_good_type": fg_type,
            "fg_type": fg_type,
            "geometry": geometry,
            "film_layers": layer_snapshot,
            "printing": printing,
            "chemicals": printing.get("chemicals") or payload.get("chemicals") or {},
            "addons": addons,
            "packaging_snapshot": normalized_packaging,
            "roll_form": geometry.get("roll_form"),
            "order_qty": float(quantity),
            "uom": quantity_uom,
        }
        return {
            "product_master": str(master.id),
            "product_master_code": master.code,
            "product_master_name": master.name,
            "product_variant": str(variant.id) if variant else None,
            "product_variant_code": getattr(variant, "code", None) if variant else None,
            "variant_exists": bool(variant),
            "variant_created": variant_created,
            "customer_product_overlay": str(overlay.id) if overlay else None,
            "axis_values": axis_values,
            "template": str(template.id),
            "template_name": template.name,
            "finished_good_type": fg_type,
            "geometry_snapshot": geometry,
            "layer_snapshot": layer_snapshot,
            "printing_snapshot": printing,
            "addons_snapshot": addons,
            "packaging_snapshot": normalized_packaging,
            "preview_payload": preview_payload,
        }
