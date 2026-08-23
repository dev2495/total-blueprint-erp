from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from apps.costing.services import CostingService
from apps.factory.models import Plant, Process
from apps.materials.models import InventoryMaterial
from apps.templates.models import TemplateBlueprint, TemplateProcessStep
from apps.templates.services import TemplateGovernanceService

from ..models import Customer, Quotation, QuotationAuditEvent, QuotationItem, SalesSkuVariant
from .order_service import SalesOrderService, _make_json_serializable


def _dec(value: Any, default: Decimal = Decimal("0")) -> Decimal:
    try:
        if value in (None, ""):
            return default
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return default


def _safe_dec_or_none(value: Any):
    if value in (None, ""):
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return None


def _uuid_str(value: Any) -> str | None:
    if value in (None, ""):
        return None
    return str(value)


def _date_value(value: Any):
    if value in (None, ""):
        return None
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value))
    except Exception:
        raise ValidationError({"valid_until": "valid_until must be an ISO date."})


def _merge_nested(base: Any, override: Any):
    if not isinstance(base, dict) or not isinstance(override, dict):
        return deepcopy(override if override is not None else base)
    merged = deepcopy(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _merge_nested(merged[key], value)
        else:
            merged[key] = deepcopy(value)
    return merged


_VARIANT_COMMERCIAL_KEYS = {
    "rate_per_kg", "quote_rate", "quote_cost_rate", "override_rate",
    "cost_source_type", "cost_source_ref", "cost_source_lot_ref",
    "cost_source_effective_at", "cost_available_qty", "cost_uom",
    "baseline_rate", "effective_rate", "component_cost", "cost_overrides",
}


def _technical_variant_spec(value):
    if isinstance(value, dict):
        return {
            key: _technical_variant_spec(child)
            for key, child in value.items()
            if key not in _VARIANT_COMMERCIAL_KEYS
        }
    if isinstance(value, list):
        return [_technical_variant_spec(child) for child in value]
    return deepcopy(value)


def _quote_variant_identity(*, product_master_id, pouch_style_id, spec):
    technical = _technical_variant_spec(spec or {})
    identity = {
        "base_product_master_id": str(product_master_id),
        "pouch_style_id": str(pouch_style_id or ""),
        "width_mm": technical.get("width_mm"),
        "height_mm": technical.get("height_mm"),
        "gusset_mm": technical.get("gusset_mm"),
        "flap_mm": technical.get("flap_mm"),
        "layers": technical.get("layers") or [],
        "inks": technical.get("inks") or [],
        "adhesives": technical.get("adhesives") or [],
        "solvents": technical.get("solvents") or [],
        "additives": technical.get("additives") or [],
        "addons": technical.get("addons") or [],
    }
    signature = hashlib.sha256(
        json.dumps(identity, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    ).hexdigest()
    return technical, identity, signature


class QuotationService:
    DEFAULT_MARGIN_PERCENT = Decimal("15")
    DEFAULT_PROCESS_THROUGHPUT_KG_PER_HOUR = Decimal("150")

    @classmethod
    def preview_line(cls, payload: dict[str, Any]) -> dict[str, Any]:
        line_payload = cls._build_line_payload(payload)
        preview = cls._preview_line_core(line_payload)
        costing = cls._calculate_line_costing(
            bom_snapshot=preview.get("bom", {}),
            process_rows=line_payload["process_cost_rows"],
            commercial_snapshot=line_payload["commercial_snapshot"],
            qty_value=line_payload["qty_value"],
            qty_uom=line_payload["qty_uom"],
            price_basis=line_payload["price_basis"],
            total_weight_kg=_dec(preview.get("total_weight_kg")),
        )
        preview["costing"] = costing
        preview["process_cost_rows"] = _make_json_serializable(line_payload["process_cost_rows"])
        preview["commercial_snapshot"] = _make_json_serializable(line_payload["commercial_snapshot"])
        preview["template_id"] = line_payload.get("template_id")
        preview["sku_variant_id"] = line_payload.get("sku_variant_id")
        preview["sku_variant_code"] = getattr(line_payload.get("sku_variant"), "code", None)
        preview["sku_variant_name"] = getattr(line_payload.get("sku_variant"), "name", None)
        preview["source_mode"] = "SKU" if line_payload.get("sku_variant_id") else "CUSTOM"
        preview["line_name"] = line_payload.get("line_name")
        preview["qty_value"] = float(line_payload["qty_value"])
        preview["qty_uom"] = line_payload["qty_uom"]
        preview["price_basis"] = line_payload["price_basis"]
        return _make_json_serializable(preview)

    @classmethod
    @transaction.atomic
    def create_quotation(cls, payload: dict[str, Any], *, user=None) -> Quotation:
        quotation = Quotation()
        quotation = cls._save_quotation(quotation, payload, is_create=True, user=user)
        QuotationAuditEvent.objects.create(
            quotation=quotation,
            event_type="DRAFT_CREATED",
            after_snapshot={"customer_id": str(quotation.customer_id or ""), "revision_no": quotation.revision_no},
            actor=user if getattr(user, "is_authenticated", False) else None,
        )
        return quotation

    @classmethod
    @transaction.atomic
    def update_quotation(cls, quotation: Quotation, payload: dict[str, Any], *, user=None) -> Quotation:
        return cls._save_quotation(quotation, payload, is_create=False, user=user)

    @classmethod
    @transaction.atomic
    def duplicate_quotation(cls, quotation: Quotation) -> Quotation:
        duplicate = Quotation(
            customer=quotation.customer,
            customer_name=quotation.customer_name,
            plant=quotation.plant,
            status="DRAFT",
            valid_until=quotation.valid_until,
            currency=quotation.currency,
            terms=quotation.terms,
            notes=quotation.notes,
        )
        duplicate.save()
        for item in quotation.items.all():
            QuotationItem.objects.create(
                quotation=duplicate,
                template=item.template,
                sku_variant=item.sku_variant,
                line_name=item.line_name,
                finished_good_type=item.finished_good_type,
                roll_form=item.roll_form,
                qty_value=item.qty_value,
                qty_uom=item.qty_uom,
                price_basis=item.price_basis,
                geometry_snapshot=deepcopy(item.geometry_snapshot or {}),
                layer_snapshot=deepcopy(item.layer_snapshot or []),
                printing_snapshot=deepcopy(item.printing_snapshot or {}),
                chemicals_snapshot=deepcopy(item.chemicals_snapshot or {}),
                addons_snapshot=deepcopy(item.addons_snapshot or []),
                packaging_snapshot=deepcopy(item.packaging_snapshot or {}),
                physics_snapshot=deepcopy(item.physics_snapshot or {}),
                bom_snapshot=deepcopy(item.bom_snapshot or {}),
                process_cost_rows=deepcopy(item.process_cost_rows or []),
                commercial_snapshot=deepcopy(item.commercial_snapshot or {}),
                costing_snapshot=deepcopy(item.costing_snapshot or {}),
                unit_weight_g=item.unit_weight_g,
                total_weight_kg=item.total_weight_kg,
                quoted_unit_price=item.quoted_unit_price,
                quoted_line_total=item.quoted_line_total,
                line_kind=item.line_kind,
                spec_snapshot=deepcopy(item.spec_snapshot or {}),
                margin_lock=item.margin_lock,
                manual_rate_override=item.manual_rate_override,
            )
        cls._refresh_totals(duplicate)
        return duplicate

    @classmethod
    @transaction.atomic
    def convert_to_sales_order(cls, quotation: Quotation):
        quotation = Quotation.objects.select_for_update().get(pk=quotation.pk)
        if quotation.converted_sales_order_id or hasattr(quotation, "converted_order"):
            raise ValidationError("Quotation has already been converted.")
        if quotation.status != "ACCEPTED":
            raise ValidationError("Only an accepted customer quotation revision can be converted.")
        try:
            cost_build = quotation.cost_build
        except Exception as exc:
            raise ValidationError("The accepted quotation has no frozen cost build.") from exc
        if cost_build.status != "FROZEN" or not cost_build.checksum:
            raise ValidationError("The exact approved cost build must be frozen before conversion.")

        item_errors: list[str] = []
        items_payload: list[dict[str, Any]] = []

        quote_items = list(
            quotation.items.select_related("template", "sku_variant", "product_master", "product_variant").all()
        )
        for item in quote_items:
            if not item.template_id:
                item_errors.append(f"{item.line_name or item.id}: attach a LIVE template before conversion.")
                continue
            if item.template.status != "LIVE":
                item_errors.append(f"{item.line_name or item.template.name}: template must be LIVE before conversion.")
                continue
            unit_price = _dec(item.quoted_unit_price)
            if unit_price <= 0:
                item_errors.append(f"{item.line_name or item.template.name}: quoted unit price must be greater than zero.")
                continue

            printing = deepcopy(item.printing_snapshot or {})
            if item.chemicals_snapshot:
                printing["chemicals"] = deepcopy(item.chemicals_snapshot)

            spec_snapshot = deepcopy(item.spec_snapshot or {})
            geometry = deepcopy(item.geometry_snapshot or {})
            layer_snapshot = deepcopy(item.layer_snapshot or [])
            if item.line_kind == "AD_HOC":
                if not geometry.get("width_mm") and spec_snapshot.get("width_mm"):
                    geometry = {
                        "width_mm": spec_snapshot.get("width_mm"),
                        "height_mm": spec_snapshot.get("height_mm"),
                        "gusset_mm": spec_snapshot.get("gusset_mm"),
                        "flap_mm": spec_snapshot.get("flap_mm") or 0,
                    }
                if not layer_snapshot and spec_snapshot.get("layers"):
                    layer_snapshot = deepcopy(spec_snapshot.get("layers") or [])

            so_item_payload = {
                "template_id": str(item.template_id),
                "mode": "TEMPLATE",
                "sku_variant": str(item.sku_variant_id) if item.sku_variant_id else None,
                "line_name": item.line_name,
                "qty_value": float(item.qty_value),
                "qty_uom": item.qty_uom,
                "price_basis": item.price_basis,
                "unit_price": float(unit_price),
                "fg_type": item.finished_good_type,
                "roll_form": item.roll_form or None,
                "geometry": geometry,
                "film_layers": layer_snapshot,
                "printing": printing,
                "addons": deepcopy(item.addons_snapshot or []),
                "packaging_snapshot": deepcopy(item.packaging_snapshot or {}),
                "product_master": str(item.product_master_id),
                "product_variant": str(item.product_variant_id) if item.line_kind == "CATALOG" and item.product_variant_id else None,
                "source_chip": "QUOTE",
                "source_ref": f"{quotation.quote_number}-R{quotation.revision_no}",
            }
            if item.line_kind == "AD_HOC" and spec_snapshot:
                # A quote-scoped variant is carried as a frozen snapshot. No
                # Product/Variant/Layer/Size master is created or promoted here.
                so_item_payload["quote_variant_snapshot"] = {
                    "kind": "QUOTE_SCOPED_VARIANT",
                    "base_product_master_id": str(item.product_master_id),
                    "base_product_master_code": getattr(item.product_master, "code", ""),
                    "base_product_master_version": getattr(item.product_master, "version", None),
                    "canonical_source_snapshot": deepcopy(item.canonical_source_snapshot or {}),
                    "spec_snapshot": spec_snapshot,
                    "spec_signature": item.spec_signature,
                    "quotation_id": str(quotation.id),
                    "quotation_item_id": str(item.id),
                    "revision_no": quotation.revision_no,
                }
            items_payload.append(so_item_payload)

        if item_errors:
            raise ValidationError({"items": item_errors})

        order_payload = {
            "customer": str(quotation.customer_id) if quotation.customer_id else None,
            "customer_name": quotation.customer_name,
            "order_name": quotation.quote_number,
            "order_type": "MTO",
            "delivery_date": quotation.requested_delivery_date,
            "address_override": quotation.shipping_address,
            "items": items_payload,
        }

        sales_order = SalesOrderService.create_sales_order(order_payload)
        commercial_snapshot = {
            "quotation_id": str(quotation.id),
            "quote_number": quotation.quote_number,
            "revision_no": quotation.revision_no,
            "customer_id": str(quotation.customer_id),
            "enquiry_reference": quotation.enquiry_reference,
            "billing_address": quotation.billing_address,
            "shipping_address": quotation.shipping_address,
            "payment_terms": quotation.payment_terms,
            "delivery_terms": quotation.delivery_terms,
            "currency": quotation.currency,
            "tax_snapshot": deepcopy(quotation.tax_snapshot or {}),
            "totals_snapshot": deepcopy(quotation.totals_snapshot or {}),
        }
        acceptance_snapshot = {
            "reference": quotation.acceptance_reference,
            "channel": quotation.acceptance_channel,
            "accepted_at": quotation.accepted_at.isoformat() if quotation.accepted_at else None,
            "recorded_by_id": str(quotation.accepted_by_id or ""),
        }
        cost_snapshot = {
            "checksum": cost_build.checksum,
            "formula_version": cost_build.formula_version,
            "source_snapshot": deepcopy(cost_build.source_snapshot or {}),
            "readiness_snapshot": deepcopy(cost_build.readiness_snapshot or {}),
            "components": [
                {
                    "id": str(component.id), "category": component.category, "role": component.role,
                    "material_id": str(component.material_id or ""), "source_type": component.source_type,
                    "source_ref": component.source_ref, "source_lot_ref": component.source_lot_ref,
                    "baseline_rate": str(component.baseline_rate), "effective_rate": str(component.effective_rate),
                    "quote_quantity": str(component.quote_quantity), "quote_uom": component.quote_uom,
                    "component_cost": str(component.component_cost), "override_status": component.override_status,
                }
                for component in cost_build.components.all()
            ],
        }
        sales_order.source_quotation_revision = quotation
        sales_order.bill_to_address = quotation.billing_address
        sales_order.ship_to_address = quotation.shipping_address
        sales_order.customer_po_reference = quotation.acceptance_reference
        sales_order.payment_terms = quotation.payment_terms
        sales_order.delivery_terms = quotation.delivery_terms
        sales_order.currency = quotation.currency
        sales_order.quote_commercial_snapshot = commercial_snapshot
        sales_order.quote_cost_snapshot = cost_snapshot
        sales_order.quote_acceptance_snapshot = acceptance_snapshot
        sales_order.save(update_fields=[
            "source_quotation_revision", "bill_to_address", "ship_to_address", "customer_po_reference",
            "payment_terms", "delivery_terms", "currency", "quote_commercial_snapshot", "quote_cost_snapshot",
            "quote_acceptance_snapshot",
        ])
        for quote_item, order_item in zip(quote_items, sales_order.items.order_by("created_at", "id")):
            quote_variant_snapshot = items_payload[quote_items.index(quote_item)].get("quote_variant_snapshot") or {}
            order_item.quote_variant_snapshot = quote_variant_snapshot
            order_item.quote_cost_snapshot = {
                "quotation_cost_checksum": cost_build.checksum,
                "quotation_item_id": str(quote_item.id),
                "components": [row for row in cost_snapshot["components"] if row.get("id")],
            }
            order_item.save(update_fields=["quote_variant_snapshot", "quote_cost_snapshot"])
            quote_item.converted_sales_order_item = order_item
            quote_item.save(update_fields=["converted_sales_order_item", "updated_at"])
        quotation.status = "CONVERTED"
        quotation.converted_sales_order = sales_order
        quotation.save(update_fields=["status", "converted_sales_order", "updated_at"])
        QuotationAuditEvent.objects.create(
            quotation=quotation,
            event_type="CONVERTED_ONCE",
            note=f"Converted to {sales_order.order_number}",
            after_snapshot={"sales_order_id": str(sales_order.id), "cost_checksum": cost_build.checksum},
        )
        return sales_order

    @classmethod
    def recalc(cls, quotation: Quotation) -> Quotation:
        """V37 entrypoint — refresh totals snapshot from the current items.

        Idempotent. Use after bulk_update_items or any direct QuotationItem
        mutation outside the legacy ``update_quotation`` path.
        """
        cls._refresh_totals(quotation)
        return quotation

    @classmethod
    @transaction.atomic
    def bulk_update_items(cls, quotation: Quotation, items_payload: list[dict[str, Any]], *, user=None) -> Quotation:
        """Replace lines on a draft revision using governed catalog or quote-scoped variants.

        This method is intentionally incapable of creating Product, ProductVariant,
        ProductMasterSize, Layer, Pouch Style, or RM master records.
        """
        import hashlib
        import json

        from apps.materials.models import (
            PouchStyleMaster,
            ProductMaster,
            ProductMasterSize,
            ProductVariant,
        )

        quotation = Quotation.objects.select_for_update().get(pk=quotation.pk)
        if quotation.status != "DRAFT" or quotation.frozen_at:
            raise ValidationError("Only an unfrozen draft quotation revision can be edited.")
        rows = items_payload or []
        if not rows:
            raise ValidationError({"items": "At least one quote line is required."})

        prepared = []
        for raw in rows:
            row = dict(raw or {})
            line_kind = str(row.get("line_kind") or "CATALOG").upper()
            if line_kind not in {"CATALOG", "AD_HOC"}:
                raise ValidationError({"items": "line_kind must be CATALOG or AD_HOC."})
            spec = deepcopy(row.get("spec_snapshot") or {})
            forbidden = {
                "save_as_master", "create_product_master", "create_variant_master",
                "promote_to_master", "create_size_master", "create_layer_master",
            }
            if any(bool(spec.get(key) or row.get(key)) for key in forbidden):
                raise ValidationError(
                    {"items": "Quotation can only create a quote-scoped configuration; master creation or promotion is forbidden."}
                )

            qty = _dec(row.get("qty_value") if row.get("qty_value") is not None else row.get("qty"))
            if qty <= 0:
                raise ValidationError({"items": "Each line needs a positive quantity."})
            uom = str(row.get("qty_uom") or row.get("uom") or "KG").upper()
            if uom not in {"PCS", "KG"}:
                raise ValidationError({"items": "Quotation quantity UOM must be PCS or KG."})
            price_basis = str(row.get("price_basis") or uom).upper()
            if price_basis not in {"PCS", "KG"}:
                raise ValidationError({"items": "Price basis must be PCS or KG."})

            pm_id = _uuid_str(
                row.get("product_master")
                or row.get("product_master_id")
                or spec.get("base_product_master_id")
                or spec.get("product_master_id")
            )
            pm = (
                ProductMaster.objects.select_related("template", "default_template")
                .filter(id=pm_id, active=True, is_current_version=True)
                .first()
                if pm_id else None
            )
            if not pm:
                raise ValidationError({"items": "Select an existing active current Base Product Master."})

            product_variant = None
            product_size = None
            sku_variant_id = _uuid_str(row.get("sku_variant") or row.get("sku_variant_id"))
            if line_kind == "CATALOG":
                variant_id = _uuid_str(row.get("product_variant") or row.get("product_variant_id"))
                size_id = _uuid_str(row.get("size") or row.get("size_id") or spec.get("size_id"))
                product_variant = (
                    ProductVariant.objects.filter(id=variant_id, master=pm, active=True).first()
                    if variant_id else None
                )
                product_size = (
                    ProductMasterSize.objects.filter(id=size_id, product_master=pm, active=True).first()
                    if size_id else None
                )
                if not (product_variant or product_size or sku_variant_id):
                    raise ValidationError(
                        {"items": "Fast path requires an existing ready Product Variant, Product Size, or Sales SKU Variant."}
                    )
                if variant_id and not product_variant:
                    raise ValidationError({"items": "Product Variant is inactive or does not belong to the selected Product Master."})
                if size_id and not product_size:
                    raise ValidationError({"items": "Product Size is inactive or does not belong to the selected Product Master."})
                if product_variant:
                    requested = spec
                    inherited = deepcopy(product_variant.spec_snapshot or {})
                    if not inherited:
                        inherited = {
                            **deepcopy(product_variant.geometry_snapshot or {}),
                            "layers": deepcopy(product_variant.layer_snapshot or []),
                        }
                    # The fast path inherits the governed technical structure.
                    # Sales may make only light geometry edits plus explicit
                    # quote-cost assumptions; structural changes use Path B.
                    for key in (
                        "width_mm", "height_mm", "gusset_mm", "flap_mm",
                        "cost_overrides", "optional_inner_pack",
                        "product_master_id", "product_master_code", "product_master_name",
                        "product_variant_id", "product_variant_code",
                    ):
                        if key in requested:
                            inherited[key] = deepcopy(requested.get(key))
                    spec = inherited
                    spec["layers"] = deepcopy(product_variant.layer_snapshot or inherited.get("layers") or [])
                if product_size:
                    spec.update({
                        "size_id": str(product_size.id),
                        "size_code": product_size.code,
                        "size_label": product_size.label,
                        "width_mm": float(product_size.width_mm) if product_size.width_mm is not None else spec.get("width_mm"),
                        "height_mm": float(product_size.height_mm) if product_size.height_mm is not None else spec.get("height_mm"),
                        "gusset_mm": float(product_size.gusset_mm) if product_size.gusset_mm is not None else spec.get("gusset_mm"),
                    })
            else:
                # Path B deliberately does not require a preconfigured Size or
                # ProductVariant. It remains a quotation-owned snapshot.
                saved_variant_id = _uuid_str(spec.get("saved_variant_id"))
                requested_variant_id = _uuid_str(row.get("product_variant") or row.get("product_variant_id"))
                if requested_variant_id and requested_variant_id != saved_variant_id:
                    raise ValidationError(
                        {"items": "Ad-hoc lines may only link a Product Variant created by the explicit Save reusable variant action."}
                    )
                if saved_variant_id:
                    product_variant = ProductVariant.objects.filter(
                        id=saved_variant_id, master=pm, active=True
                    ).first()
                    if not product_variant:
                        raise ValidationError({"items": "Saved Product Variant is inactive or does not belong to the Base Product Master."})
                if spec.get("size_id"):
                    raise ValidationError(
                        {"items": "Quote-scoped variant path starts from Base Product Master only; remove Product Size master links."}
                    )

            template = None
            for candidate in (pm.template, pm.default_template):
                if TemplateGovernanceService.is_current_live_template(candidate):
                    template = candidate
                    break
            explicit_template_id = _uuid_str(row.get("template") or row.get("template_id"))
            if explicit_template_id:
                explicit = TemplateBlueprint.objects.filter(
                    id=explicit_template_id, status="LIVE", is_current_version=True
                ).first()
                if not explicit or explicit.id != getattr(template, "id", None):
                    raise ValidationError({"items": "Quotation template must be the current LIVE template governed by the Base Product Master."})
                template = explicit
            if not template:
                raise ValidationError({"items": f"{pm.code}: configure a current LIVE template in Product Master before quotation."})

            style_id = _uuid_str(
                row.get("pouch_style_master")
                or row.get("pouch_style_id")
                or spec.get("pouch_style_id")
                or getattr(product_size, "pouch_style_master_id", None)
            )
            style = (
                PouchStyleMaster.objects.filter(id=style_id, locked=True, deprecated=False).first()
                if style_id else None
            )
            if str(getattr(template, "fg_type", "POUCH") or "POUCH").upper() == "POUCH" and not style:
                raise ValidationError({"items": "Select an existing approved Pouch Style Master."})

            canonical_layers = []
            raw_layers = spec.get("layers") or row.get("layer_snapshot") or []
            if not raw_layers:
                raise ValidationError({"items": f"{pm.code}: add at least one governed RM layer."})
            material_ids = []
            for index, layer in enumerate(raw_layers, start=1):
                if not isinstance(layer, dict):
                    raise ValidationError({"items": f"Layer {index} is invalid."})
                material_id = _uuid_str(layer.get("material_id") or layer.get("variant_id") or layer.get("family_id"))
                material = InventoryMaterial.objects.filter(id=material_id).first() if material_id else None
                if not material or material.category not in {"FILM_FAMILY", "FILM_VARIANT", "POD"}:
                    raise ValidationError({"items": f"Layer {index} must reference a governed film/POD RM master."})
                density = _dec(
                    getattr(material, "density_gcm3", None)
                    or getattr(getattr(material, "parent_family", None), "density_gcm3", None)
                )
                micron = _dec(layer.get("micron") or layer.get("thickness_micron"))
                gsm = _dec(layer.get("gsm"))
                if gsm <= 0 and micron > 0 and density > 0:
                    gsm = micron * density
                if gsm <= 0:
                    raise ValidationError({"items": f"Layer {index} needs GSM or master-density-backed thickness."})
                canonical = {
                    **layer,
                    "material_id": str(material.id),
                    "family_id": str(material.id) if material.category == "FILM_FAMILY" else str(getattr(material, "parent_family_id", "") or ""),
                    "variant_id": str(material.id) if material.category == "FILM_VARIANT" else None,
                    "material_code": material.code,
                    "material_name": material.name,
                    "material_category": material.category,
                    "base_uom": material.base_uom,
                    "density_gcm3": str(density),
                    "density_g_cm3": str(density),
                    "micron": str(micron),
                    "thickness_micron": str(micron),
                    "gsm": str(gsm),
                    "position": index,
                }
                canonical_layers.append(canonical)
                material_ids.append(str(material.id))
            spec["layers"] = canonical_layers

            for field_name, allowed in (
                ("inks", {"INK"}), ("adhesives", {"ADHESIVE"}), ("solvents", {"SOLVENT"}),
                ("additives", {"GRANULE", "ADDON"}), ("addons", {"ADDON", "PACKAGING"}),
            ):
                values = spec.get(field_name) or []
                legacy_name = field_name[:-1] if field_name.endswith("s") else field_name
                if not values and isinstance(spec.get(legacy_name), dict) and spec[legacy_name].get("material_id"):
                    values = [spec[legacy_name]]
                if not isinstance(values, list):
                    raise ValidationError({"items": f"{field_name} must be a list of governed RM components."})
                canonical_values = []
                for value in values:
                    material_id = _uuid_str(value.get("material_id")) if isinstance(value, dict) else None
                    material = InventoryMaterial.objects.filter(id=material_id).first() if material_id else None
                    if not material or material.category not in allowed:
                        raise ValidationError({"items": f"Every {field_name} row must reference the correct governed RM category."})
                    canonical_values.append({
                        **value, "material_id": str(material.id), "material_code": material.code,
                        "material_name": material.name, "material_category": material.category,
                        "base_uom": material.base_uom,
                    })
                    material_ids.append(str(material.id))
                spec[field_name] = canonical_values
            # Remove legacy singular free-text chemical representations.
            for legacy in ("ink", "adhesive", "solvent", "additive", "save_as_master"):
                spec.pop(legacy, None)

            width = _dec(spec.get("width_mm"))
            height = _dec(spec.get("height_mm"))
            if width <= 0 or height <= 0:
                raise ValidationError({"items": "Finished width and height must be positive."})
            total_gsm = sum((_dec(layer["gsm"]) for layer in canonical_layers), Decimal("0"))
            for field_name in ("inks", "adhesives", "solvents", "additives"):
                total_gsm += sum((_dec(value.get("gsm")) for value in spec[field_name]), Decimal("0"))
            if total_gsm <= 0:
                raise ValidationError({"items": "Total pouch GSM must be positive."})
            gusset = _dec(spec.get("gusset_mm"))
            area_m2 = (Decimal("2") * width * height + Decimal("2") * gusset * height) / Decimal("1000000")
            unit_weight_g = area_m2 * total_gsm
            total_weight_kg = qty if uom == "KG" else (qty * unit_weight_g / Decimal("1000"))

            spec.update({
                "quote_variant_kind": "EXISTING_READY" if line_kind == "CATALOG" else "QUOTE_SCOPED_VARIANT",
                "base_product_master_id": str(pm.id),
                "base_product_master_code": pm.code,
                "base_product_master_name": pm.name,
                "base_product_master_version": getattr(pm, "version", 1),
                "base_product_master_version_group": str(getattr(pm, "version_group", "") or ""),
                "pouch_style_id": str(style.id) if style else None,
                "pouch_style_code": getattr(style, "code", "") if style else "",
                "total_gsm": str(total_gsm),
                "unit_weight_g": str(unit_weight_g),
                "total_weight_kg": str(total_weight_kg),
            })
            if line_kind == "AD_HOC" and product_variant:
                _, _, current_variant_signature = _quote_variant_identity(
                    product_master_id=pm.id,
                    pouch_style_id=getattr(style, "id", None),
                    spec=spec,
                )
                if current_variant_signature != product_variant.bom_signature:
                    raise ValidationError(
                        {"items": "This quote configuration changed after the reusable variant was saved. Save it as a new variant or keep it quote-only."}
                    )
            canonical_source = {
                "path": "A_EXISTING_READY" if line_kind == "CATALOG" else "B_QUOTE_SCOPED_VARIANT",
                "base_product_master": {
                    "id": str(pm.id), "code": pm.code, "version": getattr(pm, "version", 1),
                    "version_group": str(getattr(pm, "version_group", "") or ""), "invariant_signature": getattr(pm, "invariant_signature", ""),
                },
                "template": {
                    "id": str(template.id), "version": getattr(template, "version", 1),
                    "version_group": str(getattr(template, "version_group", "") or ""), "status": template.status,
                },
                "product_variant_id": str(product_variant.id) if product_variant else None,
                "variant_linkage": "EXPLICIT_QUOTE_SAVE" if line_kind == "AD_HOC" and product_variant else "EXISTING_READY",
                "product_size_id": str(product_size.id) if product_size else None,
                "pouch_style": {"id": str(style.id), "code": style.code, "version": style.version} if style else None,
                "rm_master_ids": sorted(set(material_ids)),
                "formula_version": "QUOTE_SPEC_V3_2026_08",
                "actor_id": str(getattr(user, "id", "") or ""),
                "captured_at": timezone.now().isoformat(),
                "master_mutation": False,
            }
            signature_payload = {"canonical_source": canonical_source, "spec": spec}
            spec_signature = hashlib.sha256(
                json.dumps(signature_payload, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
            ).hexdigest()
            rate = _dec(row.get("rate") if row.get("rate") is not None else row.get("quoted_unit_price"))
            if rate < 0:
                raise ValidationError({"items": "Quoted rate cannot be negative."})
            if price_basis == uom:
                line_total = qty * rate
            elif price_basis == "KG" and uom == "PCS":
                line_total = total_weight_kg * rate
            elif price_basis == "PCS" and uom == "KG" and unit_weight_g > 0:
                line_total = ((qty * Decimal("1000")) / unit_weight_g) * rate
            else:
                raise ValidationError({"items": "PCS/KG conversion requires a positive calculated unit weight."})
            prepared.append({
                "quotation": quotation, "template": template, "sku_variant_id": sku_variant_id,
                "product_master": pm, "product_master_size": product_size, "product_variant": product_variant,
                "pouch_style_master": style, "line_name": str(row.get("line_name") or pm.name),
                "finished_good_type": str(row.get("finished_good_type") or getattr(template, "fg_type", "POUCH") or "POUCH").upper(),
                "roll_form": str(row.get("roll_form") or "").upper(), "qty_value": qty, "qty_uom": uom,
                "price_basis": price_basis, "geometry_snapshot": {
                    "width_mm": str(width), "height_mm": str(height), "gusset_mm": str(gusset),
                    "flap_mm": str(_dec(spec.get("flap_mm"))),
                }, "layer_snapshot": canonical_layers,
                "printing_snapshot": deepcopy(row.get("printing_snapshot") or {"inks": spec["inks"]}),
                "chemicals_snapshot": {"adhesives": spec["adhesives"], "solvents": spec["solvents"], "additives": spec["additives"]},
                "addons_snapshot": deepcopy(spec["addons"]), "packaging_snapshot": deepcopy(row.get("packaging_snapshot") or {}),
                "physics_snapshot": {"area_m2_per_piece": str(area_m2), "total_gsm": str(total_gsm)},
                "bom_snapshot": deepcopy(row.get("bom_snapshot") or {}), "process_cost_rows": deepcopy(row.get("process_cost_rows") or []),
                "commercial_snapshot": deepcopy(row.get("commercial_snapshot") or {}), "costing_snapshot": {},
                "canonical_source_snapshot": canonical_source, "spec_signature": spec_signature,
                "unit_weight_g": unit_weight_g, "total_weight_kg": total_weight_kg,
                "quoted_unit_price": rate, "quoted_line_total": line_total, "line_kind": line_kind,
                "spec_snapshot": spec, "margin_lock": bool(row.get("margin_lock", True)),
                "manual_rate_override": _safe_dec_or_none(row.get("manual_rate_override")),
                "hsn_code": str(row.get("hsn_code") or ""), "gst_rate": _dec(row.get("gst_rate") or quotation.gst_rate),
            })

        # Draft-only replacement is safe; sent/approved revisions never enter this method.
        quotation.items.all().delete()
        for values in prepared:
            QuotationItem.objects.create(**values)
        cls._refresh_totals(quotation)
        QuotationAuditEvent.objects.create(
            quotation=quotation,
            event_type="DRAFT_LINES_REPLACED",
            note=f"{len(prepared)} quotation line(s) saved.",
            after_snapshot={"item_count": len(prepared), "spec_signatures": [row["spec_signature"] for row in prepared]},
            actor=user if getattr(user, "is_authenticated", False) else None,
        )
        return quotation

    @classmethod
    @transaction.atomic
    def save_quote_item_as_variant(
        cls,
        quotation: Quotation,
        *,
        quotation_item_id: str,
        code: str,
        reason: str,
        user=None,
    ):
        """Deliberately promote one draft quote-scoped specification to a reusable variant.

        This never creates Product, Size, Layer, Pouch Style or RM masters, and it
        never writes quote cost assumptions into Product Master. The action is
        explicit, permission-gated by the view, idempotent by a stable BOM
        signature, and preserved in the quotation audit trail.
        """
        from apps.materials.models import ProductVariant
        from apps.materials.naming import normalize_code

        quotation = Quotation.objects.select_for_update().get(pk=quotation.pk)
        if quotation.status != "DRAFT" or quotation.frozen_at:
            raise ValidationError("Only an unfrozen draft quotation can save a reusable variant.")
        item = quotation.items.select_related("product_master", "pouch_style_master").filter(
            id=quotation_item_id
        ).first()
        if not item:
            raise ValidationError({"quotation_item_id": "Quotation line was not found."})
        if item.line_kind != "AD_HOC":
            raise ValidationError("Only an ad-hoc quote-scoped configuration can be saved as a reusable variant.")
        if not item.product_master_id or not item.spec_snapshot:
            raise ValidationError("Complete and save the Base Product Master configuration first.")
        code = normalize_code(code, max_length=80)
        reason = str(reason or "").strip()
        if not code:
            raise ValidationError({"code": "Variant code is required."})
        if not reason:
            raise ValidationError({"reason": "Explain why this quote configuration should become reusable."})

        spec = deepcopy(item.spec_snapshot or {})
        technical_spec, identity, bom_signature = _quote_variant_identity(
            product_master_id=item.product_master_id,
            pouch_style_id=item.pouch_style_master_id,
            spec=spec,
        )
        stripped_layers = technical_spec.get("layers") or []
        variant = ProductVariant.objects.filter(
            master=item.product_master, bom_signature=bom_signature
        ).first()
        created = False
        if variant is None:
            if ProductVariant.objects.filter(master=item.product_master, code=code, active=True).exists():
                raise ValidationError({"code": "That active variant code already exists on this Product Master."})
            variant = ProductVariant.objects.create(
                master=item.product_master,
                code=code,
                axis_values={
                    "source": "QUOTATION_EXPLICIT_SAVE",
                    "pouch_style_code": getattr(item.pouch_style_master, "code", ""),
                    "width_mm": spec.get("width_mm"),
                    "height_mm": spec.get("height_mm"),
                    "gusset_mm": spec.get("gusset_mm"),
                },
                geometry_snapshot={
                    key: deepcopy(spec.get(key))
                    for key in (
                        "width_mm", "height_mm", "gusset_mm", "flap_mm",
                        "pouch_style_id", "pouch_style_code", "stock_form",
                        "width_basis", "film_area_width_mm", "child_web_width_mm",
                    )
                    if spec.get(key) not in (None, "")
                },
                layer_snapshot=stripped_layers,
                spec_snapshot=technical_spec,
                bom_signature=bom_signature,
                active=True,
            )
            created = True

        promotion = {
            "explicit": True,
            "created_variant_id": str(variant.id),
            "created_variant_code": variant.code,
            "created": created,
            "reason": reason,
            "actor_id": str(getattr(user, "id", "") or ""),
            "at": timezone.now().isoformat(),
            "costs_promoted": False,
        }
        item.product_variant = variant
        item.spec_snapshot = {**spec, "saved_variant_id": str(variant.id), "saved_variant_code": variant.code}
        item.canonical_source_snapshot = {**(item.canonical_source_snapshot or {}), "promotion": promotion}
        item.save(update_fields=["product_variant", "spec_snapshot", "canonical_source_snapshot", "updated_at"])
        QuotationAuditEvent.objects.create(
            quotation=quotation,
            event_type="QUOTE_VARIANT_SAVED",
            note=f"{item.line_name or item.id} saved as reusable variant {variant.code}.",
            after_snapshot={
                "quotation_item_id": str(item.id),
                "product_master_id": str(item.product_master_id),
                "product_variant_id": str(variant.id),
                "product_variant_code": variant.code,
                "created": created,
                "costs_promoted": False,
            },
            metadata={"reason": reason},
            actor=user if getattr(user, "is_authenticated", False) else None,
        )
        return item, variant, created

    @classmethod
    def _save_quotation(cls, quotation: Quotation, payload: dict[str, Any], *, is_create: bool, user=None) -> Quotation:
        if not is_create and (quotation.status != "DRAFT" or quotation.frozen_at):
            raise ValidationError("This quotation revision is immutable; clone a new draft revision to make changes.")
        if "status" in payload and str(payload.get("status") or "DRAFT").upper() != "DRAFT":
            raise ValidationError("Quotation status is controlled by lifecycle actions, not by form updates.")
        customer = quotation.customer
        if "customer" in payload:
            customer_id = _uuid_str(payload.get("customer"))
            customer = Customer.objects.filter(id=customer_id).first() if customer_id else None
            if customer_id and customer is None:
                raise ValidationError({"customer": "Customer not found."})

        plant = quotation.plant
        if "plant" in payload:
            plant_id = _uuid_str(payload.get("plant"))
            plant = Plant.objects.filter(id=plant_id).first() if plant_id else None
            if plant_id and plant is None:
                raise ValidationError({"plant": "Plant not found."})

        customer_name = str(payload.get("customer_name") or getattr(customer, "name", "") or quotation.customer_name or "").strip()
        if not customer_name:
            raise ValidationError({"customer_name": "Customer name is required."})

        quotation.customer = customer
        quotation.customer_name = customer_name
        quotation.plant = plant
        quotation.status = "DRAFT"
        if is_create and customer:
            # Snapshot governed Customer Master context into the draft. Later
            # customer edits do not rewrite a submitted quotation revision.
            customer_defaults = {
                "contact_name": customer.contact_person,
                "contact_email": customer.email,
                "contact_phone": customer.phone,
                "billing_address": customer.billing_address,
                "shipping_address": customer.shipping_address,
                "place_of_supply": customer.mailing_state,
            }
            for field, value in customer_defaults.items():
                if field not in payload:
                    setattr(quotation, field, str(value or ""))
        quotation.valid_until = _date_value(payload.get("valid_until")) if "valid_until" in payload else quotation.valid_until
        quotation.currency = str(payload.get("currency") or quotation.currency or "INR").upper()
        quotation.terms = str(payload.get("terms", quotation.terms or ""))
        quotation.notes = str(payload.get("notes", quotation.notes or ""))
        for field in (
            "enquiry_reference", "contact_name", "contact_email", "contact_phone",
            "billing_address", "shipping_address", "payment_terms", "delivery_terms", "place_of_supply",
        ):
            if field in payload:
                setattr(quotation, field, str(payload.get(field) or ""))
        if "requested_delivery_date" in payload:
            quotation.requested_delivery_date = _date_value(payload.get("requested_delivery_date"))
        if "tax_snapshot" in payload:
            if not isinstance(payload.get("tax_snapshot"), dict):
                raise ValidationError({"tax_snapshot": "tax_snapshot must be an object."})
            quotation.tax_snapshot = deepcopy(payload.get("tax_snapshot") or {})
        # V37 commercials — discount / freight / other charges / custom terms
        if "discount_pct" in payload:
            quotation.discount_pct = _dec(payload.get("discount_pct"))
        if "discount_amount" in payload:
            quotation.discount_amount = _dec(payload.get("discount_amount"))
        if "freight_amount" in payload:
            quotation.freight_amount = _dec(payload.get("freight_amount"))
        if "freight_included" in payload:
            quotation.freight_included = bool(payload.get("freight_included"))
        if "other_charges" in payload:
            raw_oc = payload.get("other_charges") or []
            if isinstance(raw_oc, list):
                quotation.other_charges = [
                    {"label": str(it.get("label") or "Charge"), "amount": float(_dec(it.get("amount")))}
                    for it in raw_oc
                    if isinstance(it, dict)
                ]
        if "gst_rate" in payload:
            quotation.gst_rate = _dec(payload.get("gst_rate"))
        if "custom_terms" in payload:
            quotation.custom_terms = str(payload.get("custom_terms") or "")
        quotation.save()

        if is_create or "items" in payload:
            items_payload = payload.get("items") or []
            if not items_payload:
                if is_create:
                    # V37 supports creating an empty draft quote and adding lines later.
                    cls._refresh_totals(quotation)
                    return quotation
                raise ValidationError({"items": "At least one quote line is required."})
            # V37 lines carry `line_kind` (CATALOG / AD_HOC) and use the
            # spec_snapshot shape. Route those through bulk_update_items rather
            # than the legacy template-driven `_persist_item` flow.
            if any(
                isinstance(r, dict)
                and (
                    r.get("line_kind")
                    or r.get("spec_snapshot")
                    or (r.get("rate") is not None and r.get("template") is None and r.get("template_id") is None)
                )
                for r in items_payload
            ):
                cls.bulk_update_items(quotation, items_payload, user=user)
            else:
                quotation.items.all().delete()
                for raw_item in items_payload:
                    cls._persist_item(quotation, raw_item or {})

        cls._refresh_totals(quotation)
        return quotation

    @classmethod
    def _persist_item(cls, quotation: Quotation, raw_item: dict[str, Any]) -> QuotationItem:
        item_payload = deepcopy(raw_item or {})
        if quotation.plant_id and not item_payload.get("plant") and not item_payload.get("plant_id"):
            item_payload["plant"] = str(quotation.plant_id)
        line_payload = cls._build_line_payload(item_payload)
        preview = cls._preview_line_core(line_payload)
        costing = cls._calculate_line_costing(
            bom_snapshot=preview.get("bom", {}),
            process_rows=line_payload["process_cost_rows"],
            commercial_snapshot=line_payload["commercial_snapshot"],
            qty_value=line_payload["qty_value"],
            qty_uom=line_payload["qty_uom"],
            price_basis=line_payload["price_basis"],
            total_weight_kg=_dec(preview.get("total_weight_kg")),
        )

        return QuotationItem.objects.create(
            quotation=quotation,
            template_id=line_payload.get("template_id"),
            sku_variant_id=line_payload.get("sku_variant_id"),
            line_name=line_payload["line_name"],
            finished_good_type=line_payload["finished_good_type"],
            roll_form=line_payload["roll_form"],
            qty_value=line_payload["qty_value"],
            qty_uom=line_payload["qty_uom"],
            price_basis=line_payload["price_basis"],
            geometry_snapshot=_make_json_serializable(line_payload["geometry_snapshot"]),
            layer_snapshot=_make_json_serializable(line_payload["layer_snapshot"]),
            printing_snapshot=_make_json_serializable(line_payload["printing_snapshot"]),
            chemicals_snapshot=_make_json_serializable(line_payload["chemicals_snapshot"]),
            addons_snapshot=_make_json_serializable(line_payload["addons_snapshot"]),
            packaging_snapshot=_make_json_serializable(line_payload["packaging_snapshot"]),
            physics_snapshot=_make_json_serializable(preview.get("physics", {})),
            bom_snapshot=_make_json_serializable(preview.get("bom", {})),
            process_cost_rows=_make_json_serializable(line_payload["process_cost_rows"]),
            commercial_snapshot=_make_json_serializable(line_payload["commercial_snapshot"]),
            costing_snapshot=_make_json_serializable(costing),
            unit_weight_g=_dec(preview.get("unit_weight_g")),
            total_weight_kg=_dec(preview.get("total_weight_kg")),
            quoted_unit_price=_dec(costing.get("unit_price")),
            quoted_line_total=_dec(costing.get("net_total")),
        )

    @classmethod
    def _build_line_payload(cls, raw_item: dict[str, Any]) -> dict[str, Any]:
        sku_variant_id = _uuid_str(raw_item.get("sku_variant") or raw_item.get("sku_variant_id"))
        sku_variant = (
            SalesSkuVariant.objects.select_related("sku", "sku__template").filter(id=sku_variant_id).first()
            if sku_variant_id
            else None
        )
        if sku_variant and (not sku_variant.active or not sku_variant.sku.active):
            raise ValidationError({"sku_variant": f"SKU variant {sku_variant.code} is inactive."})
        if sku_variant and not TemplateGovernanceService.is_current_live_template(sku_variant.sku.template):
            raise ValidationError({"sku_variant": f"SKU {sku_variant.sku.code} must link to the current LIVE template."})

        template_id = _uuid_str(raw_item.get("template") or raw_item.get("template_id"))
        if sku_variant and not template_id:
            template_id = str(sku_variant.sku.template_id)
        template = (
            TemplateBlueprint.objects.filter(
                id=template_id,
                status="LIVE",
                is_current_version=True,
            )
            .only("id", "name", "fg_type", "routing_rule_id", "status", "is_current_version")
            .first()
            if template_id
            else None
        )
        if template_id and not template:
            raise ValidationError({"template_id": "template_id must point to the current LIVE template."})
        plant_id = _uuid_str(raw_item.get("plant") or raw_item.get("plant_id"))
        plant = Plant.objects.filter(id=plant_id).only("id", "name", "code", "default_cost_absorption_group_id").first() if plant_id else None

        finished_good_type = str(
            raw_item.get("finished_good_type")
            or raw_item.get("fg_type")
            or (sku_variant.finished_good_type if sku_variant else "")
            or getattr(template, "fg_type", "POUCH")
            or "POUCH"
        ).upper()
        if finished_good_type not in {"POUCH", "ROLL"}:
            finished_good_type = "POUCH"

        roll_form = str(raw_item.get("roll_form") or "").upper()
        if finished_good_type != "ROLL":
            roll_form = ""
        elif roll_form not in {"FLAT", "FOLDED", "TUBING"}:
            roll_form = "FLAT"

        qty_value = _dec(raw_item.get("qty_value"), Decimal("0"))
        if qty_value <= 0:
            raise ValidationError({"qty_value": "Quantity must be greater than zero."})

        qty_uom = str(raw_item.get("qty_uom") or raw_item.get("uom") or "PCS").upper()
        if finished_good_type == "ROLL":
            qty_uom = "KG"
        elif qty_uom not in {"PCS", "KG"}:
            qty_uom = "PCS"

        price_basis = str(raw_item.get("price_basis") or "KG").upper()
        if finished_good_type == "ROLL":
            price_basis = "KG"
        elif price_basis not in {"KG", "PCS"}:
            price_basis = "PCS"

        raw_geometry = deepcopy(raw_item.get("geometry_snapshot") or raw_item.get("geometry") or {})
        raw_layers = deepcopy(raw_item.get("layer_snapshot") or raw_item.get("film_layers") or [])
        raw_printing = deepcopy(raw_item.get("printing_snapshot") or raw_item.get("printing") or {})
        raw_chemicals = deepcopy(raw_item.get("chemicals_snapshot") or raw_item.get("chemicals") or {})
        raw_addons = deepcopy(raw_item.get("addons_snapshot") or raw_item.get("addons") or [])
        raw_packaging = deepcopy(raw_item.get("packaging_snapshot") or raw_item.get("packaging") or {})
        if sku_variant:
            geometry_snapshot = _merge_nested(deepcopy(sku_variant.geometry_snapshot or {}), raw_geometry)
            layer_snapshot = raw_layers or deepcopy(sku_variant.layer_snapshot or [])
            printing_snapshot = _merge_nested(deepcopy(sku_variant.printing_snapshot or {}), raw_printing)
            chemicals_snapshot = raw_chemicals or deepcopy(sku_variant.chemicals_snapshot or {})
            addons_snapshot = raw_addons or deepcopy(sku_variant.addons_snapshot or [])
            packaging_snapshot = _merge_nested(deepcopy(sku_variant.packaging_snapshot or {}), raw_packaging)
        else:
            geometry_snapshot = raw_geometry
            layer_snapshot = raw_layers
            printing_snapshot = raw_printing
            chemicals_snapshot = raw_chemicals
            addons_snapshot = raw_addons
            packaging_snapshot = raw_packaging
        commercial_snapshot = cls._normalize_commercial_snapshot(raw_item.get("commercial_snapshot") or raw_item.get("commercial") or {})

        preview_payload = {
            "template_id": template_id,
            "sku_variant_id": sku_variant_id,
            "finished_good_type": finished_good_type,
            "roll_form": roll_form or None,
            "geometry": deepcopy(geometry_snapshot),
            "film_layers": deepcopy(layer_snapshot),
            "printing": deepcopy(printing_snapshot),
            "chemicals": deepcopy(chemicals_snapshot),
            "addons": deepcopy(addons_snapshot),
            "packaging_snapshot": deepcopy(packaging_snapshot),
            "order_qty": float(qty_value),
            "uom": qty_uom,
        }
        preview = SalesOrderService.preview_sales_item(preview_payload)

        process_cost_rows = cls._normalize_process_rows(raw_item.get("process_cost_rows") or raw_item.get("process_rows") or [])
        if not process_cost_rows and template:
            process_cost_rows = cls._seed_process_rows(template, _dec(preview.get("total_weight_kg")), plant=plant)

        line_name = str(
            raw_item.get("line_name")
            or (sku_variant.name if sku_variant else "")
            or (sku_variant.sku.default_line_name if sku_variant and sku_variant.sku else "")
            or (sku_variant.sku.name if sku_variant and sku_variant.sku else "")
            or getattr(template, "name", "")
            or finished_good_type.title()
        ).strip()
        return {
            "template_id": template_id,
            "template": template,
            "sku_variant_id": sku_variant_id,
            "sku_variant": sku_variant,
            "line_name": line_name,
            "finished_good_type": finished_good_type,
            "roll_form": roll_form,
            "qty_value": qty_value,
            "qty_uom": qty_uom,
            "price_basis": price_basis,
            "geometry_snapshot": geometry_snapshot,
            "layer_snapshot": layer_snapshot,
            "printing_snapshot": printing_snapshot,
            "chemicals_snapshot": chemicals_snapshot,
            "addons_snapshot": addons_snapshot,
            "packaging_snapshot": packaging_snapshot,
            "commercial_snapshot": commercial_snapshot,
            "process_cost_rows": process_cost_rows,
        }

    @classmethod
    def _preview_line_core(cls, line_payload: dict[str, Any]) -> dict[str, Any]:
        preview_payload = {
            "template_id": line_payload.get("template_id"),
            "finished_good_type": line_payload["finished_good_type"],
            "roll_form": line_payload["roll_form"] or None,
            "geometry": deepcopy(line_payload["geometry_snapshot"]),
            "film_layers": deepcopy(line_payload["layer_snapshot"]),
            "printing": deepcopy(line_payload["printing_snapshot"]),
            "chemicals": deepcopy(line_payload["chemicals_snapshot"]),
            "addons": deepcopy(line_payload["addons_snapshot"]),
            "packaging_snapshot": deepcopy(line_payload["packaging_snapshot"]),
            "order_qty": float(line_payload["qty_value"]),
            "uom": line_payload["qty_uom"],
        }
        return SalesOrderService.preview_sales_item(preview_payload)

    @classmethod
    def _estimate_run_hours(cls, total_weight_kg: Decimal) -> Decimal:
        if total_weight_kg <= 0:
            return Decimal("0")
        return (total_weight_kg / cls.DEFAULT_PROCESS_THROUGHPUT_KG_PER_HOUR).quantize(Decimal("0.0001"))

    @classmethod
    def _seed_process_rows(
        cls,
        template: TemplateBlueprint,
        total_weight_kg: Decimal,
        *,
        plant: Plant | None = None,
    ) -> list[dict[str, Any]]:
        route_steps = list(
            template.process_steps.select_related("process", "cost_absorption_group").order_by("sequence_number")
        )
        estimated_hours = cls._estimate_run_hours(total_weight_kg)
        rows: list[dict[str, Any]] = []

        def _hourly_rate_for_step(step: TemplateProcessStep | None = None) -> tuple[Decimal, str]:
            cost_group = CostingService.resolve_cost_absorption_group(template_step=step, plant=plant)
            if not plant:
                return Decimal("0"), "Select a plant to load current cost-pool estimate."
            if not cost_group:
                return Decimal("0"), "Cost group is not mapped for this route step yet."
            pool_rates = CostingService.get_pool_rates_for_timestamp(plant=plant, cost_group=cost_group)
            if pool_rates.pool_line and pool_rates.productive_hours > 0:
                hourly_rate = (pool_rates.conversion_rate_per_hour + pool_rates.overhead_rate_per_hour).quantize(Decimal("0.0001"))
                return hourly_rate, f"Estimated from {cost_group.code} absorbed pool."
            if pool_rates.pool_line and pool_rates.productive_hours <= 0:
                return Decimal("0"), f"{cost_group.code} pool exists but has zero productive hours this month."
            return Decimal("0"), f"No current monthly pool line found for {cost_group.code}."

        if route_steps:
            for step in route_steps:
                hourly_rate, notes = _hourly_rate_for_step(step)
                rows.append(
                    {
                        "sequence": step.sequence_number,
                        "process_id": str(step.process_id),
                        "process_code": step.process.code,
                        "process_name": step.process.name,
                        "machine_id": None,
                        "machine_name": "",
                        "rate_id": None,
                        "hourly_rate": float(hourly_rate),
                        "setup_hours": 0.0,
                        "run_hours": float(estimated_hours),
                        "notes": notes,
                    }
                )
            return rows

        if not getattr(template, "routing_rule_id", None):
            return []
        codes = list(getattr(template.routing_rule, "ordered_processes", []) or [])
        if not codes:
            return []
        process_map = {proc.code: proc for proc in Process.objects.filter(code__in=codes)}
        for sequence, code in enumerate(codes, start=1):
            process = process_map.get(str(code))
            if process is None:
                continue
            hourly_rate, notes = _hourly_rate_for_step(None)
            rows.append(
                {
                    "sequence": sequence,
                    "process_id": str(process.id),
                    "process_code": process.code,
                    "process_name": process.name,
                    "machine_id": None,
                    "machine_name": "",
                    "rate_id": None,
                    "hourly_rate": float(hourly_rate),
                    "setup_hours": 0.0,
                    "run_hours": float(estimated_hours),
                    "notes": notes,
                }
            )
        return rows

    @classmethod
    def _normalize_process_rows(cls, raw_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for index, raw in enumerate(raw_rows or [], start=1):
            if not isinstance(raw, dict):
                continue
            process_id = _uuid_str(raw.get("process_id"))
            process = Process.objects.filter(id=process_id).first() if process_id else None
            rows.append(
                {
                    "sequence": int(raw.get("sequence") or index),
                    "process_id": str(process.id) if process else process_id,
                    "process_code": process.code if process else str(raw.get("process_code") or ""),
                    "process_name": process.name if process else str(raw.get("process_name") or ""),
                    "machine_id": _uuid_str(raw.get("machine_id")),
                    "machine_name": str(raw.get("machine_name") or ""),
                    "rate_id": None,
                    "hourly_rate": float(_dec(raw.get("hourly_rate"))),
                    "setup_hours": float(_dec(raw.get("setup_hours"))),
                    "run_hours": float(_dec(raw.get("run_hours"))),
                    "notes": str(raw.get("notes") or ""),
                }
            )
        return rows

    @classmethod
    def _normalize_commercial_snapshot(cls, raw: dict[str, Any]) -> dict[str, Any]:
        snapshot = raw if isinstance(raw, dict) else {}
        return {
            "wastage_percent": float(_dec(snapshot.get("wastage_percent"))),
            "freight_value": float(_dec(snapshot.get("freight_value"))),
            "packing_value": float(_dec(snapshot.get("packing_value"))),
            "misc_value": float(_dec(snapshot.get("misc_value"))),
            "discount_percent": float(_dec(snapshot.get("discount_percent"))),
            "discount_value": float(_dec(snapshot.get("discount_value"))),
            "tax_percent": float(_dec(snapshot.get("tax_percent"))),
            "margin_target_percent": float(_dec(snapshot.get("margin_target_percent"), cls.DEFAULT_MARGIN_PERCENT)),
            "manual_unit_price": float(_dec(snapshot.get("manual_unit_price"))),
            "manual_line_total": float(_dec(snapshot.get("manual_line_total"))),
        }

    @classmethod
    def _calculate_line_costing(
        cls,
        *,
        bom_snapshot: dict[str, Any],
        process_rows: list[dict[str, Any]],
        commercial_snapshot: dict[str, Any],
        qty_value: Decimal,
        qty_uom: str,
        price_basis: str,
        total_weight_kg: Decimal,
    ) -> dict[str, Any]:
        material_lines: list[dict[str, Any]] = []
        material_cost_total = Decimal("0")

        for category in ("films", "granules", "inks", "chemicals", "addons", "pod"):
            rows = bom_snapshot.get(category) or []
            for row in rows:
                if not isinstance(row, dict):
                    continue
                weight_kg = _dec(row.get("weight_kg"))
                if weight_kg <= 0:
                    continue
                material_id = _uuid_str(
                    row.get("material_id")
                    or row.get("variant_id")
                    or row.get("granule_id")
                    or row.get("addon_id")
                    or row.get("family_id")
                )
                material = InventoryMaterial.objects.filter(id=material_id).first() if material_id else None
                if material is None and row.get("code"):
                    material = InventoryMaterial.objects.filter(code=row.get("code")).first()
                rate = CostingService.get_material_rate(material) if material else Decimal("0")
                cost = weight_kg * rate
                material_cost_total += cost
                material_lines.append(
                    {
                        "category": category.upper(),
                        "material_id": material_id,
                        "material_code": getattr(material, "code", None) or row.get("code"),
                        "material_name": getattr(material, "name", None) or row.get("name") or row.get("code"),
                        "weight_kg": float(weight_kg.quantize(Decimal("0.0001"))),
                        "rate_per_kg": float(rate.quantize(Decimal("0.0001"))),
                        "cost": float(cost.quantize(Decimal("0.0001"))),
                    }
                )

        process_lines: list[dict[str, Any]] = []
        process_cost_total = Decimal("0")
        for row in process_rows:
            if not isinstance(row, dict):
                continue
            setup_hours = _dec(row.get("setup_hours"))
            run_hours = _dec(row.get("run_hours"))
            hourly_rate = _dec(row.get("hourly_rate"))
            line_cost = (setup_hours + run_hours) * hourly_rate
            process_cost_total += line_cost
            process_lines.append(
                {
                    "sequence": int(row.get("sequence") or 0),
                    "process_id": row.get("process_id"),
                    "process_code": row.get("process_code"),
                    "process_name": row.get("process_name"),
                    "machine_id": row.get("machine_id"),
                    "machine_name": row.get("machine_name"),
                    "rate_id": row.get("rate_id"),
                    "hourly_rate": float(hourly_rate.quantize(Decimal("0.0001"))),
                    "setup_hours": float(setup_hours.quantize(Decimal("0.0001"))),
                    "run_hours": float(run_hours.quantize(Decimal("0.0001"))),
                    "cost": float(line_cost.quantize(Decimal("0.0001"))),
                    "notes": row.get("notes") or "",
                }
            )

        wastage_percent = _dec(commercial_snapshot.get("wastage_percent"))
        freight_value = _dec(commercial_snapshot.get("freight_value"))
        packing_value = _dec(commercial_snapshot.get("packing_value"))
        misc_value = _dec(commercial_snapshot.get("misc_value"))
        discount_percent = _dec(commercial_snapshot.get("discount_percent"))
        discount_value = _dec(commercial_snapshot.get("discount_value"))
        tax_percent = _dec(commercial_snapshot.get("tax_percent"))
        margin_target_percent = _dec(commercial_snapshot.get("margin_target_percent"), cls.DEFAULT_MARGIN_PERCENT)
        manual_unit_price = _dec(commercial_snapshot.get("manual_unit_price"))
        manual_line_total = _dec(commercial_snapshot.get("manual_line_total"))

        direct_cost = material_cost_total + process_cost_total
        wastage_cost = direct_cost * wastage_percent / Decimal("100")
        landed_cost = direct_cost + wastage_cost + freight_value + packing_value + misc_value

        price_quantity = qty_value if price_basis == "PCS" else total_weight_kg
        if qty_uom == "KG" and price_basis == "PCS" and total_weight_kg > 0 and qty_value <= 0:
            price_quantity = Decimal("0")

        if manual_line_total > 0:
            gross_sell_total = manual_line_total
            pricing_mode = "MANUAL_TOTAL"
        elif manual_unit_price > 0 and price_quantity > 0:
            gross_sell_total = manual_unit_price * price_quantity
            pricing_mode = "MANUAL_UNIT_PRICE"
        else:
            gross_sell_total = landed_cost * (Decimal("1") + (margin_target_percent / Decimal("100")))
            pricing_mode = "TARGET_MARGIN"

        discount_amount = discount_value + (gross_sell_total * discount_percent / Decimal("100"))
        net_total = max(Decimal("0"), gross_sell_total - discount_amount)
        tax_value = net_total * tax_percent / Decimal("100")
        grand_total = net_total + tax_value
        unit_price = (net_total / price_quantity) if price_quantity > 0 else Decimal("0")
        margin_value = net_total - landed_cost
        margin_percent = (margin_value / net_total * Decimal("100")) if net_total > 0 else Decimal("0")

        warnings: list[str] = []
        if not process_lines:
            warnings.append("No process cost rows attached; pricing currently reflects material + commercial stack only.")
        if manual_unit_price <= 0 and manual_line_total <= 0 and pricing_mode == "TARGET_MARGIN":
            warnings.append("Line is using target margin pricing.")

        return {
            "material_lines": material_lines,
            "process_lines": process_lines,
            "material_cost": float(material_cost_total.quantize(Decimal("0.0001"))),
            "process_cost": float(process_cost_total.quantize(Decimal("0.0001"))),
            "direct_cost": float(direct_cost.quantize(Decimal("0.0001"))),
            "wastage_percent": float(wastage_percent.quantize(Decimal("0.0001"))),
            "wastage_cost": float(wastage_cost.quantize(Decimal("0.0001"))),
            "freight_value": float(freight_value.quantize(Decimal("0.0001"))),
            "packing_value": float(packing_value.quantize(Decimal("0.0001"))),
            "misc_value": float(misc_value.quantize(Decimal("0.0001"))),
            "landed_cost": float(landed_cost.quantize(Decimal("0.0001"))),
            "discount_percent": float(discount_percent.quantize(Decimal("0.0001"))),
            "discount_value": float(discount_value.quantize(Decimal("0.0001"))),
            "discount_amount": float(discount_amount.quantize(Decimal("0.0001"))),
            "tax_percent": float(tax_percent.quantize(Decimal("0.0001"))),
            "tax_value": float(tax_value.quantize(Decimal("0.0001"))),
            "gross_sell_total": float(gross_sell_total.quantize(Decimal("0.0001"))),
            "net_total": float(net_total.quantize(Decimal("0.0001"))),
            "grand_total": float(grand_total.quantize(Decimal("0.0001"))),
            "unit_price": float(unit_price.quantize(Decimal("0.0001"))),
            "margin_value": float(margin_value.quantize(Decimal("0.0001"))),
            "margin_percent": float(margin_percent.quantize(Decimal("0.0001"))),
            "price_quantity": float(price_quantity.quantize(Decimal("0.0001"))) if price_quantity > 0 else 0.0,
            "price_basis": price_basis,
            "pricing_mode": pricing_mode,
            "warnings": warnings,
        }

    @classmethod
    def _refresh_totals(cls, quotation: Quotation) -> None:
        line_subtotal = Decimal("0")
        direct_cost_total = Decimal("0")
        item_count = 0

        for item in quotation.items.all():
            item_count += 1
            costing = item.costing_snapshot or {}
            net_total = _dec(costing.get("net_total"))
            if net_total <= 0:
                # V37 ad-hoc / catalog lines store line totals directly on the item.
                net_total = _dec(item.quoted_line_total)
            line_subtotal += net_total
            landed = _dec(costing.get("landed_cost"))
            if landed <= 0:
                cost_per_kg = _dec(costing.get("total_cost_per_kg"))
                if cost_per_kg > 0:
                    qty_kg = (
                        _dec(item.qty_value)
                        if item.qty_uom == "KG"
                        else _dec(item.total_weight_kg)
                    )
                    landed = cost_per_kg * qty_kg
            direct_cost_total += landed

        # Apply commercials: discount → freight → other charges → GST
        discount_amount = _dec(getattr(quotation, "discount_amount", 0))
        discount_pct = _dec(getattr(quotation, "discount_pct", 0))
        if discount_amount <= 0 and discount_pct > 0:
            discount_amount = (line_subtotal * discount_pct / Decimal("100"))
        freight = _dec(getattr(quotation, "freight_amount", 0))
        freight_included = bool(getattr(quotation, "freight_included", True))
        freight_extra = freight if not freight_included else Decimal("0")
        other_charges_total = Decimal("0")
        for charge in (getattr(quotation, "other_charges", None) or []):
            other_charges_total += _dec((charge or {}).get("amount"))
        taxable = max(Decimal("0"), line_subtotal - discount_amount + freight_extra + other_charges_total)
        gst_rate = _dec(getattr(quotation, "gst_rate", 18))
        tax_total = (taxable * gst_rate / Decimal("100"))
        grand_total = taxable + tax_total
        margin_total = max(Decimal("0"), taxable - direct_cost_total)
        margin_percent = (margin_total / taxable * Decimal("100")) if taxable > 0 else Decimal("0")

        quotation.totals_snapshot = _make_json_serializable(
            {
                "item_count": item_count,
                "subtotal": float(line_subtotal.quantize(Decimal("0.0001"))),
                "discount_amount": float(discount_amount.quantize(Decimal("0.0001"))),
                "discount_pct": float(discount_pct.quantize(Decimal("0.0001"))),
                "freight_amount": float(freight.quantize(Decimal("0.0001"))),
                "freight_included": freight_included,
                "other_charges_total": float(other_charges_total.quantize(Decimal("0.0001"))),
                "taxable_amount": float(taxable.quantize(Decimal("0.0001"))),
                "gst_rate": float(gst_rate.quantize(Decimal("0.0001"))),
                "tax_total": float(tax_total.quantize(Decimal("0.0001"))),
                "grand_total": float(grand_total.quantize(Decimal("0.0001"))),
                "landed_cost_total": float(direct_cost_total.quantize(Decimal("0.0001"))),
                "margin_total": float(margin_total.quantize(Decimal("0.0001"))),
                "margin_percent": float(margin_percent.quantize(Decimal("0.0001"))),
                "currency": quotation.currency,
            }
        )
        quotation.save(update_fields=["totals_snapshot", "updated_at"])

    @classmethod
    def append_status_history(cls, quotation: Quotation, *, status: str, user=None, note: str = "") -> None:
        history = list(getattr(quotation, "status_history", None) or [])
        history.append(
            {
                "status": status,
                "at": timezone.now().isoformat(),
                "by_id": str(getattr(user, "id", "")) if user is not None and getattr(user, "is_authenticated", False) else None,
                "by_name": (
                    getattr(user, "full_name", None)
                    or (getattr(user, "get_full_name", lambda: "")() or None)
                    or getattr(user, "username", None)
                    or None
                ) if user is not None else None,
                "note": note or "",
            }
        )
        quotation.status_history = history
        quotation.save(update_fields=["status_history", "updated_at"])
