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
            )
        cls._refresh_totals(duplicate)
        return duplicate

    @classmethod
    @transaction.atomic
    def convert_to_sales_order(cls, quotation: Quotation):
        if quotation.status == "CONVERTED" and quotation.converted_sales_order_id:
            raise ValidationError("Quotation has already been converted.")

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

            items_payload.append(
                {
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
                    "geometry": deepcopy(item.geometry_snapshot or {}),
                    "film_layers": deepcopy(item.layer_snapshot or []),
                    "printing": printing,
                    "addons": deepcopy(item.addons_snapshot or []),
                    "packaging_snapshot": deepcopy(item.packaging_snapshot or {}),
                }
            )

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
        quotation.save()

        if is_create or "items" in payload:
            items_payload = payload.get("items") or []
            if not items_payload:
                raise ValidationError({"items": "At least one quote line is required."})
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
        subtotal = Decimal("0")
        tax_total = Decimal("0")
        grand_total = Decimal("0")
        direct_cost_total = Decimal("0")
        margin_total = Decimal("0")
        item_count = 0

        for item in quotation.items.all():
            item_count += 1
            costing = item.costing_snapshot or {}
            subtotal += _dec(costing.get("net_total"))
            tax_total += _dec(costing.get("tax_value"))
            grand_total += _dec(costing.get("grand_total"))
            direct_cost_total += _dec(costing.get("landed_cost"))
            margin_total += _dec(costing.get("margin_value"))

        quotation.totals_snapshot = _make_json_serializable(
            {
                "item_count": item_count,
                "subtotal": float(subtotal.quantize(Decimal("0.0001"))),
                "tax_total": float(tax_total.quantize(Decimal("0.0001"))),
                "grand_total": float(grand_total.quantize(Decimal("0.0001"))),
                "landed_cost_total": float(direct_cost_total.quantize(Decimal("0.0001"))),
                "margin_total": float(margin_total.quantize(Decimal("0.0001"))),
                "margin_percent": float((margin_total / subtotal * Decimal("100")).quantize(Decimal("0.0001"))) if subtotal > 0 else 0.0,
                "currency": quotation.currency,
            }
        )
        quotation.save(update_fields=["totals_snapshot", "updated_at"])
