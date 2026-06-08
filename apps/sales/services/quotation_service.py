from __future__ import annotations

from copy import deepcopy
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

from ..models import Customer, Quotation, QuotationItem, SalesSkuVariant
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
    def create_quotation(cls, payload: dict[str, Any]) -> Quotation:
        quotation = Quotation()
        return cls._save_quotation(quotation, payload, is_create=True)

    @classmethod
    @transaction.atomic
    def update_quotation(cls, quotation: Quotation, payload: dict[str, Any]) -> Quotation:
        return cls._save_quotation(quotation, payload, is_create=False)

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
        if quotation.status == "CONVERTED" and quotation.converted_sales_order_id:
            raise ValidationError("Quotation has already been converted.")

        # First pass: promote AD_HOC items into ProductMaster (when save_as_master=True)
        # and attach a fallback template when the line was authored ad-hoc.
        cls._promote_adhoc_items(quotation)

        item_errors: list[str] = []
        items_payload: list[dict[str, Any]] = []

        for item in quotation.items.select_related("template", "sku_variant").all():
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

            # V37 ad-hoc items keep geometry/layers in spec_snapshot rather than
            # the legacy *_snapshot fields. Build a geometry+layer dict that the
            # SO physics validator will accept.
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
            }
            # V37 ad-hoc: forward product_master pointer (if promoted) so the SO line
            # can be planned from the auto-created master and downstream production
            # has spec_snapshot available for the manufacturing flow.
            promoted_pm_id = spec_snapshot.get("product_master_id")
            if promoted_pm_id:
                so_item_payload["product_master"] = str(promoted_pm_id)
            if item.line_kind == "AD_HOC" and spec_snapshot:
                # Preserve the spec for production planning even without save_as_master.
                so_item_payload["adhoc_spec_snapshot"] = spec_snapshot
            items_payload.append(so_item_payload)

        if item_errors:
            raise ValidationError({"items": item_errors})

        order_payload = {
            "customer": str(quotation.customer_id) if quotation.customer_id else None,
            "customer_name": quotation.customer_name,
            "order_name": quotation.quote_number,
            "order_type": "MTO",
            "delivery_date": None,
            "items": items_payload,
        }

        sales_order = SalesOrderService.create_sales_order(order_payload)
        quotation.status = "CONVERTED"
        quotation.converted_sales_order = sales_order
        quotation.save(update_fields=["status", "converted_sales_order", "updated_at"])
        return sales_order

    # ------------------------------------------------------------------ #
    # V37 ad-hoc helpers
    # ------------------------------------------------------------------ #

    @classmethod
    def _promote_adhoc_items(cls, quotation: Quotation) -> None:
        """For each AD_HOC item where spec_snapshot.save_as_master is True, create
        a ProductMaster + ProductVariant and stamp the IDs onto spec_snapshot so
        downstream conversion can link them to the SalesOrderItem.

        Also fills in a fallback LIVE template for AD_HOC items that lack one,
        so the conversion path (which requires a template per item) can run for
        a V37-authored quote.
        """
        from apps.materials.models import ProductMaster, ProductMasterSize, ProductVariant
        from apps.templates.models import TemplateBlueprint
        import hashlib
        import json as _json

        fallback_template = None

        def _dim_label(value):
            dec = _dec(value)
            if dec == dec.to_integral_value():
                return str(int(dec))
            return str(dec.normalize())

        def _size_code_from_spec(spec: dict[str, Any]) -> str:
            parts = [
                _dim_label(spec.get("width_mm")),
                "X",
                _dim_label(spec.get("height_mm")),
            ]
            gusset = _dec(spec.get("gusset_mm"))
            flap = _dec(spec.get("flap_mm"))
            if gusset:
                parts.extend(["-G", _dim_label(gusset)])
            if flap:
                parts.extend(["-F", _dim_label(flap)])
            return "".join(parts)

        def _get_fallback_template():
            nonlocal fallback_template
            if fallback_template is not None:
                return fallback_template
            fallback_template = (
                TemplateBlueprint.objects
                .filter(status="LIVE", fg_type="POUCH")
                .order_by("-updated_at")
                .first()
                or TemplateBlueprint.objects.filter(status="LIVE").order_by("-updated_at").first()
            )
            return fallback_template

        for item in quotation.items.all():
            if item.line_kind != "AD_HOC":
                continue
            spec = dict(item.spec_snapshot or {})
            updated = False
            base_pm_id = _uuid_str(spec.get("base_product_master_id"))
            base_pm = (
                ProductMaster.objects.filter(id=base_pm_id, active=True, is_current_version=True).first()
                if base_pm_id
                else None
            )
            base_size_id = _uuid_str(spec.get("base_size_id") or spec.get("size_id"))
            base_size = ProductMasterSize.objects.filter(id=base_size_id).first() if base_size_id else None
            base_template = (
                getattr(base_pm, "template", None)
                or getattr(base_pm, "default_template", None)
                or None
            )
            if base_template is not None and str(getattr(base_template, "fg_type", "") or "").upper() != "POUCH":
                base_template = None

            if spec.get("save_as_master") and not spec.get("product_master_id"):
                width = _dec(spec.get("width_mm"))
                height = _dec(spec.get("height_mm"))
                if width <= 0 or height <= 0:
                    raise ValidationError(
                        {"items": f"{item.line_name or 'Ad-hoc line'} needs width and height before Product Master promotion."}
                    )
                # Build a deterministic-ish code from the geometry hash.
                geo_key = _json.dumps(
                    {
                        "w": spec.get("width_mm"),
                        "h": spec.get("height_mm"),
                        "g": spec.get("gusset_mm"),
                        "f": spec.get("flap_mm"),
                        "layers": [
                            (l.get("micron"), l.get("gsm")) for l in (spec.get("layers") or [])
                        ],
                    },
                    sort_keys=True,
                    default=str,
                )
                short = hashlib.sha256(geo_key.encode("utf-8")).hexdigest()[:8].upper()
                code_root = f"PM-AUTO-{short}"
                code = code_root
                seq = 1
                while ProductMaster.objects.filter(code=code).exists():
                    seq += 1
                    code = f"{code_root}-{seq}"
                name = (
                    item.line_name
                    or f"Ad-hoc {spec.get('width_mm','?')}x{spec.get('height_mm','?')} {short}"
                )
                base_fixed = deepcopy(getattr(base_pm, "fixed_attributes", None) or {})
                pm = ProductMaster.objects.create(
                    code=code,
                    name=name,
                    product_kind="POUCH",
                    reusable_policy=getattr(base_pm, "reusable_policy", None) or "CONFIGURABLE",
                    template=base_template if getattr(base_template, "id", None) else None,
                    default_template=getattr(base_pm, "default_template", None) if base_pm else None,
                    commercial_family=getattr(base_pm, "commercial_family", None) if base_pm else None,
                    default_reporting_group=getattr(base_pm, "default_reporting_group", None) or "FG",
                    canonical_layer_stack=deepcopy(spec.get("layers") or []),
                    layer_template=deepcopy(spec.get("layers") or getattr(base_pm, "layer_template", []) or []),
                    variant_axes=deepcopy(getattr(base_pm, "variant_axes", []) or []),
                    fixed_attributes={
                        **base_fixed,
                        "fg_type": "POUCH",
                        "auto_from_quotation": str(quotation.id),
                        "base_product_master_id": str(base_pm.id) if base_pm else "",
                        "base_product_master_code": getattr(base_pm, "code", "") if base_pm else "",
                    },
                    description=f"Auto-created from quotation {quotation.quote_number}",
                )
                geometry_snapshot = {
                    "width_mm": spec.get("width_mm"),
                    "height_mm": spec.get("height_mm"),
                    "gusset_mm": spec.get("gusset_mm"),
                    "flap_mm": spec.get("flap_mm"),
                }
                size_code = _size_code_from_spec(spec)
                size_label = str(
                    spec.get("size_label")
                    or spec.get("base_size_label")
                    or f"{_dim_label(width)} x {_dim_label(height)}"
                )
                size = ProductMasterSize.objects.create(
                    product_master=pm,
                    code=size_code,
                    label=size_label,
                    width_mm=width,
                    height_mm=height,
                    gusset_mm=_dec(spec.get("gusset_mm")) or None,
                    qty_uom=str(item.qty_uom or "KG").upper(),
                    geometry_config={
                        "source": "quotation",
                        "flap_mm": float(_dec(spec.get("flap_mm"))),
                        "quotation_id": str(quotation.id),
                        "quotation_item_id": str(item.id),
                        "base_product_master_id": str(base_pm.id) if base_pm else "",
                        "base_size_id": str(base_size.id) if base_size else "",
                    },
                    default_packing=deepcopy(spec.get("optional_inner_pack") or {}),
                    pouch_style_master=getattr(base_size, "pouch_style_master", None) if base_size else None,
                    pouch_style_version=getattr(base_size, "pouch_style_version", 0) if base_size else 0,
                    stock_form=getattr(base_size, "stock_form", "OPEN_WEB") if base_size else "OPEN_WEB",
                    width_basis=getattr(base_size, "width_basis", "OPEN_WEB_WIDTH") if base_size else "OPEN_WEB_WIDTH",
                    slit_policy=getattr(base_size, "slit_policy", "SLIT_ALLOWED") if base_size else "SLIT_ALLOWED",
                    sort_order=1,
                )
                variant_signature = hashlib.sha256(
                    _json.dumps(
                        {
                            **geometry_snapshot,
                            "size_id": str(size.id),
                            "layers": spec.get("layers") or [],
                        },
                        sort_keys=True,
                        default=str,
                    ).encode("utf-8")
                ).hexdigest()[:64]
                ProductVariant.objects.create(
                    master=pm,
                    code=f"V-{short}",
                    axis_values={
                        "size_id": str(size.id),
                        "size_code": size.code,
                        "width_mm": str(width),
                        "height_mm": str(height),
                    },
                    geometry_snapshot=geometry_snapshot,
                    layer_snapshot=deepcopy(spec.get("layers") or []),
                    bom_signature=variant_signature,
                )
                spec["product_master_id"] = str(pm.id)
                spec["product_master_code"] = pm.code
                spec["product_master_name"] = pm.name
                spec["size_id"] = str(size.id)
                spec["size_code"] = size.code
                spec["size_label"] = size.label
                updated = True

            # Attach fallback template only if missing — needed because
            # SalesOrderItem.template is non-null and downstream conversion
            # rejects rows without one. Template is just the route hint; the
            # spec_snapshot remains the source of truth for production.
            if not item.template_id:
                ft = base_template or _get_fallback_template()
                if ft is not None:
                    item.template = ft
                    item.save(update_fields=["template", "updated_at"])

            if updated:
                item.spec_snapshot = spec
                item.save(update_fields=["spec_snapshot", "updated_at"])

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
    def bulk_update_items(cls, quotation: Quotation, items_payload: list[dict[str, Any]]) -> Quotation:
        """V37 nested write — replace the item list with the supplied rows.

        Each row accepts the V37 shape::

            {
              "line_kind": "CATALOG" | "AD_HOC",
              "line_name": "...",
              "qty": <number>,                  # alias for qty_value
              "uom": "PCS" | "KG",              # alias for qty_uom
              "rate": <number>,                 # unit price (alias for quoted_unit_price)
              "line_total": <number>,           # qty * rate
              "spec_snapshot": {...},           # for ad-hoc lines
              "costing_snapshot": {...},        # last preview result
              "margin_lock": true|false,
              "manual_rate_override": <number|null>,
              # plus optional CATALOG fields:
              "product_master": <uuid>,
              "size_id": <uuid>,
            }

        Backwards-compatible: the older template/sku_variant shape still works.
        """
        rows = items_payload or []
        quotation.items.all().delete()

        from apps.materials.models import ProductMaster, ProductMasterSize

        for raw in rows:
            row = dict(raw or {})
            line_kind = str(row.get("line_kind") or "CATALOG").upper()
            if line_kind not in {"CATALOG", "AD_HOC"}:
                line_kind = "CATALOG"

            qty = _dec(row.get("qty_value") or row.get("qty"), Decimal("0"))
            if qty <= 0:
                raise ValidationError({"items": "Each line needs a positive quantity."})

            uom = str(row.get("qty_uom") or row.get("uom") or "KG").upper()
            if uom not in {"PCS", "KG"}:
                uom = "KG"
            price_basis = str(row.get("price_basis") or uom).upper()
            if price_basis not in {"PCS", "KG"}:
                price_basis = uom

            rate = _dec(row.get("rate") or row.get("quoted_unit_price"), Decimal("0"))
            line_total = _dec(row.get("line_total") or row.get("quoted_line_total"), rate * qty)

            spec_snapshot = row.get("spec_snapshot") or {}
            costing_snapshot = row.get("costing_snapshot") or {}

            # CATALOG → resolve product master + size, freeze geometry into spec_snapshot.
            template_id = _uuid_str(row.get("template") or row.get("template_id"))
            sku_variant_id = _uuid_str(row.get("sku_variant") or row.get("sku_variant_id"))
            line_name = str(row.get("line_name") or "").strip()
            if line_kind == "CATALOG":
                pm_id = _uuid_str(row.get("product_master") or row.get("product_master_id"))
                size_id = _uuid_str(row.get("size") or row.get("size_id"))
                pm = (
                    ProductMaster.objects.filter(id=pm_id, active=True, is_current_version=True).first()
                    if pm_id
                    else None
                )
                if pm_id and not pm:
                    raise ValidationError({"items": "product_master is invalid, inactive, or not the current version."})
                size = (
                    ProductMasterSize.objects.filter(id=size_id, product_master=pm, active=True).first()
                    if size_id and pm
                    else None
                )
                if size_id and pm and not size:
                    raise ValidationError({"items": "size is invalid or does not belong to the selected Product Master."})
                if pm and not template_id and pm.template_id:
                    template_id = str(pm.template_id)
                elif pm and not template_id and pm.default_template_id:
                    template_id = str(pm.default_template_id)
                if not line_name and pm:
                    line_name = pm.name
                if pm:
                    spec_snapshot = {
                        **spec_snapshot,
                        "product_master_id": str(pm.id),
                        "product_master_code": pm.code,
                        "product_master_name": pm.name,
                        "size_id": str(size.id) if size else None,
                        "size_code": size.code if size else None,
                        "size_label": size.label if size else spec_snapshot.get("size_label"),
                        "width_mm": float(size.width_mm) if size and size.width_mm else spec_snapshot.get("width_mm"),
                        "height_mm": float(size.height_mm) if size and size.height_mm else spec_snapshot.get("height_mm"),
                        "gusset_mm": float(size.gusset_mm) if size and size.gusset_mm else spec_snapshot.get("gusset_mm"),
                    }
            elif line_kind == "AD_HOC":
                base_pm_id = _uuid_str(spec_snapshot.get("base_product_master_id"))
                base_pm = (
                    ProductMaster.objects.filter(id=base_pm_id, active=True, is_current_version=True).first()
                    if base_pm_id
                    else None
                )
                if base_pm_id and not base_pm:
                    raise ValidationError({"items": "base_product_master is invalid, inactive, or not the current version."})
                base_size_id = _uuid_str(spec_snapshot.get("base_size_id"))
                base_size = (
                    ProductMasterSize.objects.filter(id=base_size_id, product_master=base_pm, active=True).first()
                    if base_size_id and base_pm
                    else None
                )
                if base_size_id and base_pm and not base_size:
                    raise ValidationError({"items": "base_size is invalid or does not belong to the base Product Master."})
                if base_pm and not template_id:
                    for candidate in (getattr(base_pm, "template", None), getattr(base_pm, "default_template", None)):
                        if candidate and str(getattr(candidate, "fg_type", "") or "").upper() == "POUCH":
                            template_id = str(candidate.id)
                            break
                if base_pm and not line_name:
                    line_name = f"New {base_pm.name}"

            QuotationItem.objects.create(
                quotation=quotation,
                template_id=template_id,
                sku_variant_id=sku_variant_id,
                line_name=line_name or ("Ad-hoc line" if line_kind == "AD_HOC" else "Catalog line"),
                finished_good_type=str(row.get("finished_good_type") or row.get("fg_type") or "POUCH").upper(),
                roll_form=str(row.get("roll_form") or "").upper(),
                qty_value=qty,
                qty_uom=uom,
                price_basis=price_basis,
                geometry_snapshot=row.get("geometry_snapshot") or {
                    "width_mm": spec_snapshot.get("width_mm"),
                    "height_mm": spec_snapshot.get("height_mm"),
                    "gusset_mm": spec_snapshot.get("gusset_mm"),
                    "flap_mm": spec_snapshot.get("flap_mm"),
                },
                layer_snapshot=row.get("layer_snapshot") or (spec_snapshot.get("layers") or []),
                printing_snapshot=row.get("printing_snapshot") or {},
                chemicals_snapshot=row.get("chemicals_snapshot") or {},
                addons_snapshot=row.get("addons_snapshot") or [],
                packaging_snapshot=row.get("packaging_snapshot") or (
                    {"optional_inner_pack": spec_snapshot.get("optional_inner_pack")}
                    if spec_snapshot.get("optional_inner_pack")
                    else {}
                ),
                physics_snapshot=row.get("physics_snapshot") or {},
                bom_snapshot=row.get("bom_snapshot") or {},
                process_cost_rows=row.get("process_cost_rows") or [],
                commercial_snapshot=row.get("commercial_snapshot") or {},
                costing_snapshot=costing_snapshot,
                quoted_unit_price=rate,
                quoted_line_total=line_total,
                line_kind=line_kind,
                spec_snapshot=spec_snapshot,
                margin_lock=bool(row.get("margin_lock", True)),
                manual_rate_override=_safe_dec_or_none(row.get("manual_rate_override")),
            )

        cls._refresh_totals(quotation)
        return quotation

    @classmethod
    def _save_quotation(cls, quotation: Quotation, payload: dict[str, Any], *, is_create: bool) -> Quotation:
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
        quotation.status = str(payload.get("status") or quotation.status or "DRAFT").upper()
        quotation.valid_until = _date_value(payload.get("valid_until")) if "valid_until" in payload else quotation.valid_until
        quotation.currency = str(payload.get("currency") or quotation.currency or "INR").upper()
        quotation.terms = str(payload.get("terms", quotation.terms or ""))
        quotation.notes = str(payload.get("notes", quotation.notes or ""))
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
                cls.bulk_update_items(quotation, items_payload)
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
        if sku_variant and str(getattr(sku_variant.sku.template, "status", "") or "").upper() != "LIVE":
            raise ValidationError({"sku_variant": f"SKU {sku_variant.sku.code} must link to a LIVE template."})

        template_id = _uuid_str(raw_item.get("template") or raw_item.get("template_id"))
        if sku_variant and not template_id:
            template_id = str(sku_variant.sku.template_id)
        template = TemplateBlueprint.objects.filter(id=template_id).only("id", "name", "fg_type", "routing_rule_id").first() if template_id else None
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
