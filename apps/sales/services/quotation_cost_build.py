from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from apps.costing.models import MaterialCostSnapshot, ProcessCostRate
from apps.inventory.models import InventoryBulk, InventoryRoll, PackagingStock
from apps.materials.models import InventoryMaterial
from apps.users.permission_registry import can_with_wildcard
from apps.users.permission_service import PermissionService

from ..models import Quotation, QuotationCostComponent, QuotationCostSnapshot


MATERIAL_ROLE_CATEGORIES = {
    "LAYER": {"FILM_FAMILY", "FILM_VARIANT", "POD"},
    "INK": {"INK"},
    "ADHESIVE": {"ADHESIVE"},
    "SOLVENT": {"SOLVENT"},
    "ADDITIVE": {"GRANULE", "ADDON"},
    "ADDON": {"ADDON", "PACKAGING"},
    "PACKING": {"PACKAGING", "ADDON"},
}
CONVERSION_CATEGORIES = {"PROCESS", "LABOUR", "OVERHEAD", "WASTAGE", "PACKING", "FREIGHT", "OTHER"}
FORMULA_VERSION = "QUOTE_COST_V3_2026_08"


def dec(value: Any, default: Decimal = Decimal("0")) -> Decimal:
    if value in (None, ""):
        return default
    try:
        parsed = Decimal(str(value))
        return parsed if parsed.is_finite() else default
    except (InvalidOperation, TypeError, ValueError):
        return default


def q(value: Decimal, places: str = "0.0001") -> Decimal:
    return value.quantize(Decimal(places), rounding=ROUND_HALF_UP)


def stable_checksum(value: Any) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _parse_datetime(value: Any):
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValidationError("Override validity must be an ISO date/time.") from exc
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed)
    return parsed


@dataclass(frozen=True)
class Baseline:
    source_type: str
    source_ref: str
    lot_ref: str
    rate: Decimal
    available_qty: Decimal
    uom: str
    effective_at: Any
    snapshot_id: str | None = None
    provenance: dict | None = None


class QuotationCostBuildService:
    """Authoritative, audit-ready quotation costing.

    This service never writes inventory or master data. Source values are read from
    governed cost/inventory records; all user assumptions remain quote-scoped.
    """

    @classmethod
    def resolve_material_baseline(cls, material: InventoryMaterial, plant) -> Baseline:
        uom = str(material.base_uom or "").upper()
        plant_id = getattr(plant, "id", None)

        if uom == "KG":
            rolls = InventoryRoll.objects.filter(
                material=material,
                status="AVAILABLE",
                weight_kg__gt=0,
            )
            if plant_id:
                rolls = rolls.filter(plant_id=plant_id)
            rolls = list(rolls.order_by("created_at", "id"))
            available = sum((dec(r.weight_kg) for r in rolls), Decimal("0"))
            for roll in rolls:
                meta = roll.meta_json if isinstance(roll.meta_json, dict) else {}
                for key in ("unit_cost_per_kg", "unit_cost", "rate_per_kg", "rate_per_uom"):
                    rate = dec(meta.get(key))
                    if rate > 0:
                        return Baseline(
                            "INVENTORY_FIFO",
                            str(roll.id),
                            str(roll.batch_no or roll.label_id),
                            q(rate, "0.000001"),
                            q(available, "0.000001"),
                            "KG",
                            roll.created_at,
                            provenance={"model": "InventoryRoll", "field": f"meta_json.{key}", "fifo_label": roll.label_id},
                        )

            bulk = InventoryBulk.objects.filter(material=material, qty_kg__gt=0)
            if plant_id:
                bulk = bulk.filter(plant_id=plant_id)
            bulk_rows = list(bulk)
            bulk_qty = sum((dec(row.qty_kg) for row in bulk_rows), Decimal("0"))
            bulk_value = sum((dec(row.qty_kg) * dec(row.avg_cost) for row in bulk_rows), Decimal("0"))
            if bulk_qty > 0 and bulk_value > 0:
                latest = max((row.updated_at for row in bulk_rows), default=None)
                return Baseline(
                    "INVENTORY_AVERAGE",
                    f"InventoryBulk:{material.id}:{plant_id or 'ALL'}",
                    "",
                    q(bulk_value / bulk_qty, "0.000001"),
                    q(bulk_qty, "0.000001"),
                    "KG",
                    latest,
                    provenance={"model": "InventoryBulk", "method": "weighted_average", "row_count": len(bulk_rows)},
                )

        packaging = PackagingStock.objects.filter(material=material, qty__gt=0)
        if plant_id:
            packaging = packaging.filter(plant_id=plant_id)
        packaging_rows = list(packaging)
        package_qty = sum((dec(row.qty) for row in packaging_rows), Decimal("0"))
        package_value = sum((dec(row.qty) * dec(row.avg_cost) for row in packaging_rows), Decimal("0"))
        if package_qty > 0 and package_value > 0:
            latest = max((row.updated_at for row in packaging_rows), default=None)
            return Baseline(
                "INVENTORY_AVERAGE",
                f"PackagingStock:{material.id}:{plant_id or 'ALL'}",
                "",
                q(package_value / package_qty, "0.000001"),
                q(package_qty, "0.000001"),
                uom,
                latest,
                provenance={"model": "PackagingStock", "method": "weighted_average", "row_count": len(packaging_rows)},
            )

        snapshot = MaterialCostSnapshot.objects.filter(material=material).order_by("-effective_date", "-id").first()
        if snapshot and dec(snapshot.avg_rate_per_kg) > 0:
            return Baseline(
                "MATERIAL_COST_SNAPSHOT",
                str(snapshot.id),
                "",
                q(dec(snapshot.avg_rate_per_kg), "0.000001"),
                q(available if uom == "KG" else package_qty, "0.000001"),
                str(snapshot.uom or uom).upper(),
                snapshot.effective_date,
                snapshot_id=str(snapshot.id),
                provenance={"model": "MaterialCostSnapshot", "field": "avg_rate_per_kg"},
            )

        return Baseline(
            "MISSING",
            "",
            "",
            Decimal("0"),
            q(available if uom == "KG" else package_qty, "0.000001"),
            uom,
            None,
            provenance={"reason": "No positive FIFO, inventory average, or material cost snapshot exists."},
        )

    @classmethod
    def _material_rows(cls, item, spec: dict) -> list[dict]:
        rows: list[dict] = []
        for index, layer in enumerate(spec.get("layers") or item.layer_snapshot or [], start=1):
            if not isinstance(layer, dict):
                raise ValidationError(f"{item.line_name}: layer {index} is invalid.")
            row = dict(layer)
            row.update({"role": "LAYER", "label": row.get("name") or f"Layer {index}", "sequence": index})
            rows.append(row)
        aliases = (
            ("adhesives", "adhesive", "ADHESIVE"),
            ("inks", "ink", "INK"),
            ("solvents", "solvent", "SOLVENT"),
            ("additives", "additive", "ADDITIVE"),
        )
        sequence = 100
        for plural, singular, role in aliases:
            values = spec.get(plural)
            if not isinstance(values, list):
                legacy = spec.get(singular)
                values = [legacy] if isinstance(legacy, dict) else []
            for value in values:
                sequence += 1
                if isinstance(value, dict):
                    rows.append({**value, "role": role, "label": value.get("name") or role.title(), "sequence": sequence})
        for value in spec.get("addons") or []:
            sequence += 1
            if isinstance(value, dict) and value.get("material_id"):
                rows.append({**value, "role": "ADDON", "label": value.get("name") or "Add-on", "sequence": sequence})
        return rows

    @classmethod
    def _quantity_facts(cls, item, spec: dict, rows: list[dict]) -> tuple[Decimal, Decimal, dict]:
        width = dec(spec.get("width_mm") or item.geometry_snapshot.get("width_mm"))
        height = dec(spec.get("height_mm") or item.geometry_snapshot.get("height_mm"))
        gusset = dec(spec.get("gusset_mm") or item.geometry_snapshot.get("gusset_mm"))
        if width <= 0 or height <= 0:
            raise ValidationError(f"{item.line_name}: width and height must be positive.")
        gsm_rows = []
        total_gsm = Decimal("0")
        for row in rows:
            gsm = dec(row.get("gsm"))
            if gsm <= 0 and row["role"] == "LAYER":
                gsm = dec(row.get("micron")) * dec(row.get("density_gcm3"))
            if row["role"] in {"LAYER", "INK", "ADHESIVE", "SOLVENT", "ADDITIVE"}:
                if gsm <= 0:
                    raise ValidationError(f"{item.line_name}: {row['label']} needs GSM or density-backed micron.")
                total_gsm += gsm
                gsm_rows.append((row, gsm))
        if total_gsm <= 0:
            raise ValidationError(f"{item.line_name}: total pouch GSM must be positive.")
        area_m2 = (Decimal("2") * width * height + Decimal("2") * gusset * height) / Decimal("1000000")
        unit_weight_g = q(area_m2 * total_gsm, "0.000001")
        if item.qty_uom == "KG":
            output_kg = dec(item.qty_value)
        elif item.qty_uom == "PCS":
            output_kg = dec(item.qty_value) * unit_weight_g / Decimal("1000")
        else:
            raise ValidationError(f"{item.line_name}: only PCS or KG quotation quantities are supported.")
        if output_kg <= 0:
            raise ValidationError(f"{item.line_name}: calculated quotation weight must be positive.")
        return output_kg, unit_weight_g, {
            "width_mm": str(width), "height_mm": str(height), "gusset_mm": str(gusset),
            "area_m2_per_piece": str(q(area_m2, "0.000001")), "total_gsm": str(q(total_gsm, "0.000001")),
            "unit_weight_g": str(unit_weight_g), "output_weight_kg": str(q(output_kg, "0.000001")),
            "layer_gsm": [{"role": row["role"], "material_id": str(row.get("material_id") or ""), "gsm": str(q(gsm, "0.000001"))} for row, gsm in gsm_rows],
        }

    @classmethod
    def _margin_floor(cls, quotation: Quotation, item) -> tuple[Decimal | None, str]:
        from ..models import CustomerProductOverlay
        overlay = CustomerProductOverlay.objects.filter(
            customer_id=quotation.customer_id,
            product_master_id=item.product_master_id,
            active=True,
            margin_floor_pct__isnull=False,
        ).order_by("-updated_at").first()
        if overlay:
            return dec(overlay.margin_floor_pct), f"CustomerProductOverlay:{overlay.id}"
        style = item.pouch_style_master
        if style and getattr(style, "default_margin_pct", None) is not None:
            return dec(style.default_margin_pct), f"PouchStyleMaster:{style.id}"
        if quotation.plant and getattr(quotation.plant, "default_margin_pct", None) is not None:
            return dec(quotation.plant.default_margin_pct), f"Plant:{quotation.plant_id}"
        return None, "MISSING"

    @classmethod
    def preview(cls, quotation: Quotation, payload: dict, *, user=None) -> dict:
        if quotation.status != "DRAFT":
            raise ValidationError("Only a draft quotation revision can be costed.")
        pricing_definition = str(payload.get("pricing_definition") or "GROSS_MARGIN_ON_SALES").upper()
        if pricing_definition not in {"MARKUP_ON_COST", "GROSS_MARGIN_ON_SALES"}:
            raise ValidationError("pricing_definition must be MARKUP_ON_COST or GROSS_MARGIN_ON_SALES.")
        target_percent = dec(payload.get("target_percent"))
        if target_percent < 0 or (pricing_definition == "GROSS_MARGIN_ON_SALES" and target_percent >= 100):
            raise ValidationError("Target percentage is outside the valid range.")
        override_map = {str(row.get("material_id")): row for row in payload.get("material_overrides") or [] if isinstance(row, dict)}
        if override_map:
            allowed = (
                getattr(user, "is_authenticated", False)
                and (
                    getattr(user, "is_superuser", False)
                    or getattr(user, "is_owner", False)
                    or can_with_wildcard(
                        PermissionService.get_user_permissions(user),
                        "sales.quote.cost_override",
                    )
                )
            )
            if not allowed:
                raise ValidationError("You do not have permission to enter quote-specific cost assumptions.")
        conversion_rows = payload.get("conversion_components") or []
        if not isinstance(conversion_rows, list):
            raise ValidationError("conversion_components must be a list.")

        item_results = []
        component_results = []
        errors: list[str] = []
        warnings: list[str] = []
        total_material_cost = Decimal("0")
        total_conversion_cost = Decimal("0")
        now = timezone.now()

        for item in quotation.items.select_related("product_master", "pouch_style_master").all():
            spec = dict(item.spec_snapshot or {})
            rows = cls._material_rows(item, spec)
            output_kg, unit_weight_g, physics = cls._quantity_facts(item, spec, rows)
            total_gsm = dec(physics["total_gsm"])
            item_material_cost = Decimal("0")
            material_results = []
            for row in rows:
                material_id = row.get("material_id")
                material = InventoryMaterial.objects.filter(id=material_id).first() if material_id else None
                if not material:
                    raise ValidationError(f"{item.line_name}: {row['label']} must reference an existing RM master.")
                allowed = MATERIAL_ROLE_CATEGORIES.get(row["role"], set())
                if material.category not in allowed:
                    raise ValidationError(f"{item.line_name}: {material.code} is not valid for {row['role'].lower()}.")
                baseline = cls.resolve_material_baseline(material, quotation.plant)
                row_gsm = dec(row.get("gsm")) or (dec(row.get("micron")) * dec(row.get("density_gcm3")))
                if row["role"] in {"LAYER", "INK", "ADHESIVE", "SOLVENT", "ADDITIVE"}:
                    quote_qty = q(output_kg * row_gsm / total_gsm, "0.000001")
                    quote_uom = "KG"
                else:
                    quote_qty = dec(row.get("quantity") or row.get("qty") or row.get("qty_per_pouch"))
                    if row.get("qty_per_pouch") not in (None, "") and item.qty_uom == "PCS":
                        quote_qty *= dec(item.qty_value)
                    quote_uom = str(row.get("uom") or material.base_uom).upper()
                if quote_qty <= 0:
                    raise ValidationError(f"{item.line_name}: {row['label']} needs a positive quote quantity.")
                if quote_uom != str(baseline.uom or material.base_uom).upper():
                    errors.append(f"{item.line_name}: {material.code} requires a governed {quote_uom} to {baseline.uom or material.base_uom} conversion.")
                override = override_map.get(str(material.id)) or {}
                override_rate = dec(override.get("rate"), Decimal("-1"))
                override_expires_at = _parse_datetime(override.get("expires_at"))
                override_reason = str(override.get("reason") or "").strip()
                override_status = "NOT_REQUIRED"
                effective_rate = baseline.rate
                if override_rate >= 0:
                    if override_rate <= 0:
                        errors.append(f"{material.code}: quote override must be greater than zero.")
                    if not override_reason:
                        errors.append(f"{material.code}: quote override requires a reason.")
                    if not override_expires_at or override_expires_at <= now:
                        errors.append(f"{material.code}: quote override requires a future expiry.")
                    override_status = "PENDING"
                    effective_rate = override_rate
                if baseline.rate <= 0 and override_rate < 0:
                    errors.append(f"{material.code}: authoritative cost source is missing; add a governed cost or an approved quote override.")
                readiness = "MISSING_SOURCE" if effective_rate <= 0 else ("PENDING_APPROVAL" if override_status == "PENDING" else "READY")
                if baseline.available_qty < quote_qty:
                    warnings.append(f"{material.code}: required {q(quote_qty)} {quote_uom}; available {q(baseline.available_qty)} {baseline.uom}.")
                component_cost = q(quote_qty * max(effective_rate, Decimal("0")), "0.000001")
                item_material_cost += component_cost
                material_results.append({
                    "category": "MATERIAL", "role": row["role"], "label": row["label"], "sequence": row["sequence"],
                    "quotation_item_id": str(item.id), "material_id": str(material.id), "material_code": material.code,
                    "material_name": material.name, "material_category": material.category, "source_type": baseline.source_type,
                    "source_ref": baseline.source_ref, "source_lot_ref": baseline.lot_ref,
                    "source_effective_at": baseline.effective_at.isoformat() if baseline.effective_at else None,
                    "material_cost_snapshot_id": baseline.snapshot_id, "baseline_rate": str(baseline.rate),
                    "baseline_available_qty": str(baseline.available_qty), "baseline_uom": baseline.uom,
                    "quote_quantity": str(quote_qty), "quote_uom": quote_uom, "effective_rate": str(effective_rate),
                    "component_cost": str(component_cost), "override_rate": str(override_rate) if override_rate >= 0 else None,
                    "override_reason": override_reason, "override_expires_at": override_expires_at.isoformat() if override_expires_at else None,
                    "override_status": override_status, "readiness_status": readiness,
                    "provenance": {**(baseline.provenance or {}), "quote_input": row},
                })
            total_material_cost += item_material_cost
            item_results.append({"quotation_item_id": str(item.id), "physics": physics, "material_cost": str(q(item_material_cost)), "materials": material_results})
            component_results.extend(material_results)

        if not conversion_rows:
            errors.append("Conversion Cost is missing. Add applicable process, labour, overhead, wastage/yield, packing, freight, or other governed components.")
        for sequence, row in enumerate(conversion_rows, start=1000):
            if not isinstance(row, dict):
                raise ValidationError("Conversion cost rows must be objects.")
            category = str(row.get("category") or "").upper()
            if category not in CONVERSION_CATEGORIES:
                raise ValidationError(f"Unknown conversion category: {category or 'blank'}.")
            label = str(row.get("label") or "").strip()
            if not label:
                raise ValidationError("Every conversion cost component needs a label.")
            process_rate = None
            source_type = str(row.get("source_type") or "MISSING").upper()
            source_ref = str(row.get("source_ref") or "")
            rate = dec(row.get("rate"))
            process_rate_id = row.get("process_cost_rate_id")
            if process_rate_id:
                process_rate = ProcessCostRate.objects.filter(id=process_rate_id, is_active=True).select_related("process", "machine").first()
                if not process_rate:
                    errors.append(f"{label}: process rate is inactive or missing.")
                else:
                    source_type = "PROCESS_RATE"
                    source_ref = str(process_rate.id)
                    rate = dec(process_rate.cost_per_hour)
            quantity = dec(row.get("quantity"))
            basis = str(row.get("basis") or "FIXED").upper()
            if category == "WASTAGE" and basis == "PERCENT":
                component_cost = q(total_material_cost * dec(row.get("percent")) / Decimal("100"), "0.000001")
                quantity = dec(row.get("percent"))
                rate = total_material_cost
            else:
                component_cost = q(quantity * rate, "0.000001")
            reason = str(row.get("override_reason") or "").strip()
            expires_at = _parse_datetime(row.get("override_expires_at"))
            is_override = source_type == "QUOTE_OVERRIDE"
            if source_type not in {choice[0] for choice in QuotationCostComponent.SOURCE_CHOICES}:
                errors.append(f"{label}: select a governed source or explicit quote override.")
            if is_override and (not reason or not expires_at or expires_at <= now):
                errors.append(f"{label}: quote override requires reason and future expiry.")
            if rate <= 0 or quantity <= 0:
                errors.append(f"{label}: quantity and rate/percentage must be greater than zero.")
            readiness = "PENDING_APPROVAL" if is_override else ("READY" if component_cost > 0 and source_type != "MISSING" else "MISSING_SOURCE")
            result = {
                "category": category, "role": "", "label": label, "sequence": sequence,
                "quotation_item_id": row.get("quotation_item_id"), "material_id": row.get("material_id"),
                "process_id": str(process_rate.process_id) if process_rate else row.get("process_id"),
                "machine_id": str(process_rate.machine_id) if process_rate and process_rate.machine_id else row.get("machine_id"),
                "process_cost_rate_id": str(process_rate.id) if process_rate else None,
                "source_type": source_type, "source_ref": source_ref, "source_effective_at": process_rate.updated_at.isoformat() if process_rate else None,
                "baseline_rate": str(rate), "baseline_available_qty": "0", "baseline_uom": str(row.get("uom") or ""),
                "quote_quantity": str(quantity), "quote_uom": str(row.get("uom") or ""), "effective_rate": str(rate),
                "component_cost": str(component_cost), "override_rate": str(rate) if is_override else None,
                "override_reason": reason, "override_expires_at": expires_at.isoformat() if expires_at else None,
                "override_status": "PENDING" if is_override else "NOT_REQUIRED", "readiness_status": readiness,
                "provenance": {"basis": basis, "input": row},
            }
            component_results.append(result)
            total_conversion_cost += component_cost

        total_cost = q(total_material_cost + total_conversion_cost)
        if pricing_definition == "GROSS_MARGIN_ON_SALES":
            target_price = q(total_cost / (Decimal("1") - target_percent / Decimal("100"))) if total_cost > 0 else Decimal("0")
        else:
            target_price = q(total_cost * (Decimal("1") + target_percent / Decimal("100")))
        # Commercial value is sourced from the explicit quote line rates. The
        # target definition is a transparent recommendation, never a hidden
        # rewrite of salesperson-entered prices.
        list_price = q(sum((dec(item.quoted_line_total) for item in quotation.items.all()), Decimal("0")))
        if list_price <= 0:
            errors.append("Enter positive line rates; target pricing is advisory and never silently replaces commercial values.")
        discount = dec(payload.get("discount_amount") or quotation.discount_amount)
        net_sale = q(list_price - discount)
        tax_rate = dec(payload.get("tax_rate") if payload.get("tax_rate") is not None else quotation.gst_rate)
        tax_amount = q(net_sale * tax_rate / Decimal("100"))
        rounding = dec(payload.get("rounding_amount"))
        grand_total = q(net_sale + tax_amount + rounding)
        contribution = q(net_sale - total_cost)
        markup_pct = q((contribution / total_cost) * Decimal("100")) if total_cost > 0 else Decimal("0")
        gross_margin_pct = q((contribution / net_sale) * Decimal("100")) if net_sale > 0 else Decimal("0")
        floor_values = [cls._margin_floor(quotation, item) for item in quotation.items.all()]
        configured_floors = [row for row in floor_values if row[0] is not None]
        if not configured_floors:
            errors.append("Commercial margin floor is not configured for this customer/product, pouch style, or plant.")
            floor = None
            floor_source = "MISSING"
        else:
            floor, floor_source = max(configured_floors, key=lambda row: row[0])
            if gross_margin_pct < floor:
                errors.append(f"Gross margin {gross_margin_pct}% is below the configured floor {floor}% ({floor_source}).")
        pending_overrides = [row for row in component_results if row["override_status"] == "PENDING"]
        if pending_overrides:
            errors.append(f"{len(pending_overrides)} quote cost override(s) require segregated approval.")
        readiness = {"ready": not errors, "errors": errors, "warnings": warnings, "pending_override_count": len(pending_overrides), "margin_floor_pct": str(floor) if floor is not None else None, "margin_floor_source": floor_source}
        sensitivity = {}
        for delta in (Decimal("-5"), Decimal("5"), Decimal("10")):
            stressed_cost = total_cost * (Decimal("1") + delta / Decimal("100"))
            sensitivity[f"cost_{int(delta):+d}_pct"] = {"cost": str(q(stressed_cost)), "contribution": str(q(net_sale - stressed_cost)), "gross_margin_pct": str(q(((net_sale - stressed_cost) / net_sale) * Decimal("100"))) if net_sale > 0 else "0"}
        source_snapshot = {
            "formula_version": FORMULA_VERSION, "plant_id": str(quotation.plant_id or ""),
            "generated_at": now.isoformat(), "items": item_results,
            "target_price": str(target_price), "actual_line_price": str(list_price),
        }
        result = {
            "currency": quotation.currency, "pricing_definition": pricing_definition, "target_percent": str(target_percent),
            "material_cost": str(q(total_material_cost)), "conversion_cost": str(q(total_conversion_cost)), "total_cost": str(total_cost),
            "target_price": str(target_price),
            "list_price": str(list_price), "discount_amount": str(q(discount)), "net_sale": str(net_sale), "tax_amount": str(tax_amount),
            "rounding_amount": str(q(rounding)), "grand_total": str(grand_total), "contribution": str(contribution),
            "markup_pct": str(markup_pct), "gross_margin_pct": str(gross_margin_pct), "formula_version": FORMULA_VERSION,
            "readiness": readiness, "sensitivity": sensitivity, "source_snapshot": source_snapshot, "components": component_results,
        }
        result["checksum"] = stable_checksum({key: value for key, value in result.items() if key != "checksum"})
        return result

    @classmethod
    @transaction.atomic
    def persist(cls, quotation: Quotation, payload: dict, *, user=None) -> dict:
        result = cls.preview(quotation, payload, user=user)
        snapshot, _ = QuotationCostSnapshot.objects.get_or_create(quotation=quotation)
        if snapshot.status == "FROZEN":
            raise ValidationError("This quotation cost snapshot is frozen; create a new revision to change it.")
        for field in (
            "currency", "pricing_definition", "target_percent", "material_cost", "conversion_cost", "total_cost", "list_price",
            "discount_amount", "net_sale", "tax_amount", "rounding_amount", "grand_total", "contribution", "markup_pct", "gross_margin_pct",
        ):
            setattr(snapshot, field, result[field])
        snapshot.formula_version = result["formula_version"]
        snapshot.sensitivity_snapshot = result["sensitivity"]
        snapshot.readiness_snapshot = result["readiness"]
        snapshot.source_snapshot = result["source_snapshot"]
        snapshot.effective_at = timezone.now()
        snapshot.expires_at = _parse_datetime(payload.get("expires_at")) or (timezone.make_aware(datetime.combine(quotation.valid_until, datetime.max.time())) if quotation.valid_until else None)
        snapshot.checksum = result["checksum"]
        snapshot.save()
        snapshot.components.all().delete()
        item_map = {str(item.id): item for item in quotation.items.all()}
        for row in result["components"]:
            component = QuotationCostComponent(
                cost_snapshot=snapshot,
                quotation_item=item_map.get(str(row.get("quotation_item_id") or "")),
                sequence=row["sequence"], category=row["category"], role=row["role"], label=row["label"],
                material_id=row.get("material_id"), material_cost_snapshot_id=row.get("material_cost_snapshot_id"),
                process_id=row.get("process_id"), machine_id=row.get("machine_id"), process_cost_rate_id=row.get("process_cost_rate_id"),
                source_type=row["source_type"], source_ref=row.get("source_ref") or "", source_lot_ref=row.get("source_lot_ref") or "",
                source_effective_at=_parse_datetime(row.get("source_effective_at")), baseline_rate=row["baseline_rate"],
                baseline_available_qty=row["baseline_available_qty"], baseline_uom=row["baseline_uom"], quote_quantity=row["quote_quantity"],
                quote_uom=row["quote_uom"], effective_rate=row["effective_rate"], component_cost=row["component_cost"],
                override_rate=row.get("override_rate"), override_reason=row.get("override_reason") or "", override_status=row["override_status"],
                override_by=user if row["override_status"] == "PENDING" and getattr(user, "is_authenticated", False) else None,
                override_at=timezone.now() if row["override_status"] == "PENDING" else None,
                override_expires_at=_parse_datetime(row.get("override_expires_at")), readiness_status=row["readiness_status"], provenance=row["provenance"],
            )
            component.save()
        quotation.totals_snapshot = {**(quotation.totals_snapshot or {}), "cost_build": {key: result[key] for key in ("material_cost", "conversion_cost", "total_cost", "net_sale", "tax_amount", "grand_total", "contribution", "markup_pct", "gross_margin_pct", "checksum")}, "readiness": result["readiness"]}
        quotation.save(update_fields=["totals_snapshot", "updated_at"])
        return result
