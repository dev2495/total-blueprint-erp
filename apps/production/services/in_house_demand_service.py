"""
InHouseDemandService — bridges confirmed Sales Orders to the planner queue
when items require in-house produced packaging or in-house POD.

Idempotent: safe to call multiple times for the same order. Failure to
create any single demand never blocks the confirm — issues are logged via
PermissionAuditLog and the missing demand is reported back to the caller.
"""
from __future__ import annotations

import logging
from decimal import Decimal, ROUND_CEILING
from uuid import UUID
from typing import Iterable

from django.db import transaction
from django.db.models import Sum

from apps.materials.models import InventoryMaterial, ProductMaster
from apps.materials.services_product_variant import find_or_create_product_variant
from apps.physics.spec_signature import (
    build_invariant_payload,
    build_invariant_signature,
    build_spec_payload,
    build_spec_signature,
)
from apps.production.models import (
    PlannedBulkStockOrder,
    PlannedStockOrder,
    SalesOrderItemInHouseDemand,
)

logger = logging.getLogger(__name__)


def _audit(action: str, details: dict, user=None):
    try:
        from apps.users.models import PermissionAuditLog
        PermissionAuditLog.objects.create(
            user=user,
            action=action,
            method="SERVICE",
            path="InHouseDemandService",
            effective_role=getattr(user, "effective_role_code", "") or "",
            details=details,
        )
    except Exception:
        # Audit failure must never block the trigger; production logs catch it.
        logger.warning("InHouseDemandService audit log failed", extra={"action": action, "details": details})


def _json_safe(value):
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, dict):
        return {key: _json_safe(child) for key, child in value.items()}
    if isinstance(value, list):
        return [_json_safe(child) for child in value]
    return value


class InHouseDemandService:
    @classmethod
    def create_for_order(cls, order, *, user=None) -> dict:
        """
        Inspect every confirmed item on `order` and create/refresh a
        SalesOrderItemInHouseDemand link for each in-house packaging line
        and in-house POD profile. Returns a summary dict.
        """
        created: list[SalesOrderItemInHouseDemand] = []
        skipped: list[dict] = []

        items = order.items.all() if hasattr(order.items, "all") else order.items
        try:
            items = items.select_related("product_master")  # type: ignore[attr-defined]
        except AttributeError:
            logger.debug("Order items are already materialized; skipping select_related")
        for item in items:
            cls._ensure_packaging(item, created, skipped, user=user)
            cls._ensure_pod(item, created, skipped, user=user)

        if created or skipped:
            _audit(
                "IN_HOUSE_DEMAND_TRIGGERED",
                {
                    "order_id": str(order.id),
                    "order_number": getattr(order, "order_number", None),
                    "created": [str(d.id) for d in created],
                    "skipped": skipped,
                },
                user=user,
            )

        return {
            "order_id": str(order.id),
            "created": [
                {
                    "demand_id": str(d.id),
                    "kind": d.demand_kind,
                    "material_id": str(d.packaging_material_id),
                    "stock_order_id": str(d.planned_stock_order_id) if d.planned_stock_order_id else None,
                    "bulk_stock_order_id": str(d.planned_bulk_stock_order_id) if d.planned_bulk_stock_order_id else None,
                }
                for d in created
            ],
            "skipped": skipped,
        }

    # ------------------------------------------------------------------
    # Packaging path
    # ------------------------------------------------------------------
    @classmethod
    def _ensure_packaging(cls, item, created, skipped, *, user=None):
        snapshot = item.packaging_snapshot or {}
        lines = list(cls._iter_packaging_lines(item, snapshot))
        if not lines:
            return

        grouped: dict[tuple[str, str], dict] = {}
        for line in lines:
            material_id = (line or {}).get("material_id")
            if not material_id:
                continue
            try:
                material = InventoryMaterial.objects.select_related("production_template").get(id=material_id)
            except InventoryMaterial.DoesNotExist:
                skipped.append({"item_id": str(item.id), "kind": "PACKAGING", "reason": "material_not_found", "material_id": str(material_id)})
                continue

            mode = (material.packaging_supply_mode or "").upper()
            if mode == "PURCHASED":
                continue
            if mode not in {"IN_HOUSE", "BOTH"}:
                continue
            qty_decimal, uom = cls._estimate_packaging_line_qty(item, line, material)
            if qty_decimal <= 0:
                skipped.append({"item_id": str(item.id), "kind": "PACKAGING", "reason": "non_positive_qty", "material_id": str(material.id)})
                continue
            base_uom = str(material.base_uom or "").upper()
            if base_uom in {"KG", "PCS"}:
                uom = base_uom
            key = (str(material.id), uom)
            if key not in grouped:
                grouped[key] = {"material": material, "uom": uom, "qty": Decimal("0")}
            grouped[key]["qty"] += qty_decimal

        for row in grouped.values():
            required_qty = row["qty"]
            available_qty = cls._available_packaging_stock_qty(
                row["material"],
                plant_id=getattr(item.sales_order, "plant_id", None),
            )
            shortage_qty = required_qty - available_qty
            if shortage_qty <= 0:
                skipped.append({
                    "item_id": str(item.id),
                    "kind": "PACKAGING",
                    "reason": "stock_available",
                    "material_id": str(row["material"].id),
                    "material_code": row["material"].code,
                    "required_qty": str(required_qty),
                    "available_qty": str(available_qty),
                    "qty_uom": row["uom"],
                })
                continue
            target_qty = shortage_qty if available_qty > 0 else required_qty

            contract, skip_reason = cls._resolve_packaging_production_contract(
                material=row["material"],
                target_qty=target_qty,
                uom=row["uom"],
            )
            if not contract:
                skipped.append({
                    "item_id": str(item.id),
                    "kind": "PACKAGING",
                    "reason": skip_reason or "no_production_template",
                    "material_id": str(row["material"].id),
                    "material_code": row["material"].code,
                })
                continue

            link, was_created = cls._upsert_packaging_demand(
                item=item,
                material=row["material"],
                target_qty=target_qty,
                uom=row["uom"],
                contract=contract,
                user=user,
            )
            if was_created:
                created.append(link)

    @classmethod
    def _iter_packaging_lines(cls, item, snapshot: dict) -> Iterable[dict]:
        snapshot_lines = snapshot.get("packaging_lines") if isinstance(snapshot.get("packaging_lines"), list) else []
        if snapshot_lines:
            for line in snapshot_lines:
                if isinstance(line, dict):
                    yield line
            return

        primary = snapshot.get("primary_inner_pack") if isinstance(snapshot.get("primary_inner_pack"), dict) else {}
        if primary.get("enabled") and primary.get("material_id"):
            qty, uom = cls._estimate_primary_pack_qty(item, primary)
            yield {
                "material_id": primary.get("material_id"),
                "qty": qty,
                "uom": uom,
                "basis": "PRIMARY_INNER_PACK",
            }

        roll_pack = snapshot.get("roll_dispatch_pack") if isinstance(snapshot.get("roll_dispatch_pack"), dict) else {}
        if roll_pack.get("enabled"):
            for line in roll_pack.get("lines") or []:
                if isinstance(line, dict):
                    yield line

    @staticmethod
    def _estimate_primary_pack_qty(item, primary: dict) -> tuple[Decimal, str]:
        explicit_qty = Decimal(str(primary.get("qty") or primary.get("target_qty") or 0))
        if explicit_qty > 0:
            return explicit_qty, str(primary.get("uom") or "PCS").upper()

        pcs_per_pack = Decimal(str(primary.get("pcs_per_pack") or 0))
        if pcs_per_pack <= 0:
            return Decimal("0"), "PCS"

        qty_value = Decimal(str(getattr(item, "qty_value", 0) or 0))
        qty_uom = str(getattr(item, "qty_uom", "PCS") or "PCS").upper()
        if qty_uom == "PCS":
            pieces = qty_value
        elif qty_uom == "KG":
            unit_weight_g = Decimal(str(getattr(item, "unit_weight_g", 0) or 0))
            pieces = (qty_value * Decimal("1000") / unit_weight_g) if unit_weight_g > 0 else Decimal("0")
        else:
            pieces = Decimal("0")

        if pieces <= 0:
            return Decimal("0"), "PCS"
        packs = (pieces / pcs_per_pack).to_integral_value(rounding=ROUND_CEILING)
        return packs, "PCS"

    @classmethod
    def _estimate_packaging_line_qty(cls, item, line: dict, material: InventoryMaterial) -> tuple[Decimal, str]:
        explicit_qty = Decimal(str(line.get("qty") or line.get("target_qty") or 0))
        uom = str(line.get("uom") or material.base_uom or "PCS").upper()
        if explicit_qty > 0:
            return explicit_qty, uom

        basis = str(line.get("basis") or "").upper()
        defaults = material.packaging_defaults_json if isinstance(material.packaging_defaults_json, dict) else {}
        pcs_per_pack = Decimal(str(line.get("pcs_per_pack") or defaults.get("pcs_per_pack") or defaults.get("pcs_per_carton") or 0))
        kg_per_pack = Decimal(str(line.get("kg_per_pack") or line.get("kg_per_bag") or defaults.get("kg_per_pack") or defaults.get("kg_per_bag") or 0))

        if basis in {"PCS_PER_PACK", "PRIMARY_INNER_PACK"} or pcs_per_pack > 0:
            pieces = cls._estimate_order_pieces(item)
            if pieces > 0 and pcs_per_pack > 0:
                return (pieces / pcs_per_pack).to_integral_value(rounding=ROUND_CEILING), "PCS"

        if basis == "KG_PER_PACK" or kg_per_pack > 0:
            kg = cls._estimate_order_kg(item)
            if kg > 0 and kg_per_pack > 0:
                return (kg / kg_per_pack).to_integral_value(rounding=ROUND_CEILING), "PCS"

        return Decimal("0"), uom

    @staticmethod
    def _estimate_order_pieces(item) -> Decimal:
        qty_value = Decimal(str(getattr(item, "qty_value", 0) or 0))
        qty_uom = str(getattr(item, "qty_uom", "PCS") or "PCS").upper()
        if qty_uom == "PCS":
            return qty_value
        unit_weight_g = Decimal(str(getattr(item, "unit_weight_g", 0) or 0))
        if qty_uom == "KG" and unit_weight_g > 0:
            return qty_value * Decimal("1000") / unit_weight_g
        return Decimal("0")

    @staticmethod
    def _estimate_order_kg(item) -> Decimal:
        qty_value = Decimal(str(getattr(item, "qty_value", 0) or 0))
        qty_uom = str(getattr(item, "qty_uom", "KG") or "KG").upper()
        if qty_uom == "KG":
            return qty_value
        unit_weight_g = Decimal(str(getattr(item, "unit_weight_g", 0) or 0))
        if qty_uom == "PCS" and unit_weight_g > 0:
            return qty_value * unit_weight_g / Decimal("1000")
        return Decimal("0")

    @classmethod
    def _resolve_packaging_production_contract(cls, *, material: InventoryMaterial, target_qty: Decimal, uom: str) -> tuple[dict | None, str | None]:
        """
        In-house packaging can be backed either by the direct material
        production_template or by a ProductMaster contract whose packaging axis
        points at this packaging SKU. The latter is the v3 route for packaging
        pouches/rolls created as normal product masters.
        """
        direct_template = getattr(material, "production_template", None) if getattr(material, "production_template_id", None) else None
        product_master = cls._packaging_product_master_for_material(material)
        template = (
            getattr(product_master, "template", None)
            or getattr(product_master, "default_template", None)
            or direct_template
        )
        if not template:
            return None, "no_production_template"

        contract = {
            "template": template,
            "product_master": product_master,
            "axis_values": {},
            "geometry_snapshot": {},
            "layer_snapshot": [],
            "printing_snapshot": {"enabled": False},
            "addons_snapshot": [],
            "packaging_snapshot": {},
            "bom_snapshot": {},
            "spec_signature": "",
            "invariant_signature": "",
            "unit_weight_g": Decimal("0"),
            "total_weight_kg": Decimal("0"),
            "start_step_index": 0,
            "stop_step_index": None,
            "target_step_index": None,
        }

        if not product_master:
            return contract, None

        try:
            axis_values = cls._default_packaging_axis_values(product_master, material)
            variant, _created = find_or_create_product_variant(product_master, axis_values)
            geometry = variant.geometry_snapshot or {}
            layers = variant.layer_snapshot or []
            fixed = product_master.fixed_attributes if isinstance(product_master.fixed_attributes, dict) else {}
            printing = fixed.get("printing_snapshot") if isinstance(fixed.get("printing_snapshot"), dict) else {"enabled": False}
            addons = fixed.get("addons_snapshot") if isinstance(fixed.get("addons_snapshot"), list) else []

            from apps.sales.services.order_service import SalesOrderService

            preview = SalesOrderService.preview_sales_item(
                {
                    "finished_good_type": str(geometry.get("finished_good_type") or fixed.get("fg_type") or template.fg_type or "ROLL").upper(),
                    "geometry": geometry,
                    "film_layers": layers,
                    "printing": printing,
                    "chemicals": (printing or {}).get("chemicals") or {},
                    "addons": addons,
                    "packaging_snapshot": {},
                    "roll_form": geometry.get("roll_form"),
                    "order_qty": float(target_qty),
                    "uom": str(uom or material.base_uom or "KG").upper(),
                }
            )
            spec_payload = build_spec_payload(
                fg_type=str(geometry.get("finished_good_type") or fixed.get("fg_type") or template.fg_type or "ROLL").upper(),
                roll_form=geometry.get("roll_form"),
                geometry=geometry,
                film_layers=layers,
                printing=printing,
                addons=addons,
            )
            invariant_payload = build_invariant_payload(film_layers=layers, printing=printing)
            contract.update(
                {
                    "axis_values": axis_values,
                    "geometry_snapshot": geometry,
                    "layer_snapshot": layers,
                    "printing_snapshot": printing,
                    "addons_snapshot": addons,
                    "bom_snapshot": preview.get("bom") or {},
                    "spec_signature": build_spec_signature(spec_payload),
                    "invariant_signature": build_invariant_signature(invariant_payload),
                    "unit_weight_g": Decimal(str(preview.get("unit_weight_g") or 0)),
                    "total_weight_kg": Decimal(str(preview.get("total_weight_kg") or 0)),
                    "stop_step_index": cls._route_last_index(template),
                    "target_step_index": cls._route_last_index(template),
                }
            )
        except Exception as exc:
            return None, f"product_master_contract_failed: {exc}"

        return contract, None

    @staticmethod
    def _packaging_product_master_for_material(material: InventoryMaterial):
        code = str(getattr(material, "code", "") or "").strip()
        if not code:
            return None
        try:
            linked_variant = getattr(material, "produced_by_product_variant", None)
            if linked_variant and getattr(linked_variant, "master", None):
                master = linked_variant.master
                if (
                    str(getattr(master, "product_kind", "") or "").upper() == "PACKAGING"
                    and getattr(master, "active", False)
                    and getattr(master, "is_current_version", True)
                ):
                    return master
            defaults = material.packaging_defaults_json if isinstance(material.packaging_defaults_json, dict) else {}
            explicit = InHouseDemandService._product_master_from_defaults(defaults, product_kind="PACKAGING")
            if explicit:
                return explicit
            masters = ProductMaster.objects.filter(
                product_kind="PACKAGING",
                active=True,
                is_current_version=True,
            ).select_related("template", "default_template")
            for master in masters:
                fixed = master.fixed_attributes if isinstance(master.fixed_attributes, dict) else {}
                fixed_codes = {
                    str(fixed.get("packaging_material_code") or "").strip(),
                    str(fixed.get("output_packaging_material_code") or "").strip(),
                }
                if code in fixed_codes:
                    return master
                for axis in master.variant_axes if isinstance(master.variant_axes, list) else []:
                    if not isinstance(axis, dict):
                        continue
                    if str(axis.get("type") or "").strip() != "packaging_ref":
                        continue
                    options = axis.get("options") if isinstance(axis.get("options"), list) else []
                    option_codes = {
                        str((opt or {}).get("code") or (opt or {}).get("material_code") or "").strip()
                        if isinstance(opt, dict)
                        else str(opt or "").strip()
                        for opt in options
                    }
                    if code in option_codes:
                        return master
        except Exception:
            logger.warning(
                "Packaging product-master lookup failed material_id=%s material_code=%s",
                getattr(material, "id", None),
                code,
                exc_info=True,
            )
            return None
        return None

    @staticmethod
    def _default_packaging_axis_values(master: ProductMaster, material: InventoryMaterial) -> dict:
        defaults = material.packaging_defaults_json if isinstance(material.packaging_defaults_json, dict) else {}
        axis_values: dict = InHouseDemandService._axis_values_from_defaults(defaults)
        first_size = master.sizes.filter(active=True).order_by("sort_order", "code").first()
        layer_defaults = InHouseDemandService._default_layer_axis_maps(master, first_size)
        for axis in master.variant_axes if isinstance(master.variant_axes, list) else []:
            if not isinstance(axis, dict):
                continue
            key = str(axis.get("axis") or "").strip()
            axis_type = str(axis.get("type") or "").strip()
            options = axis.get("options") if isinstance(axis.get("options"), list) else []
            required = bool(axis.get("required"))
            if not key:
                continue
            if key in axis_values:
                continue
            if axis_type == "geometry" or key in {"size", "size_code"}:
                if first_size:
                    axis_values[key] = first_size.code
                elif options:
                    axis_values[key] = str(options[0])
            elif axis_type == "packaging_ref" or key in {"packaging", "packaging_ref"}:
                axis_values[key] = material.code
            elif key in layer_defaults:
                axis_values[key] = layer_defaults[key]
            elif required and options:
                first = options[0]
                axis_values[key] = first.get("code") if isinstance(first, dict) else first
        return axis_values

    @staticmethod
    def _route_last_index(template) -> int:
        try:
            steps = list(template.process_steps.all())
            if steps:
                return max(int(step.sequence_number or 0) for step in steps)
        except Exception:
            logger.warning("Unable to resolve route steps for template=%s", getattr(template, "id", None), exc_info=True)
        try:
            route_steps = getattr(getattr(template, "routing_rule", None), "ordered_processes", None) or []
            return max(0, len(route_steps) - 1)
        except Exception:
            return 0

    @staticmethod
    def _available_packaging_stock_qty(material: InventoryMaterial, *, plant_id=None) -> Decimal:
        try:
            from apps.inventory.models import PackagingStock

            qs = PackagingStock.objects.filter(material=material)
            if plant_id:
                qs = qs.filter(plant_id=plant_id)
            total = qs.aggregate(total=Sum("qty")).get("total") or Decimal("0")
            return Decimal(str(total))
        except Exception:
            logger.warning(
                "Available packaging stock lookup failed material_id=%s plant_id=%s",
                getattr(material, "id", None),
                plant_id,
                exc_info=True,
            )
            return Decimal("0")

    @staticmethod
    def _available_bulk_stock_kg(material: InventoryMaterial, *, plant_id=None) -> Decimal:
        try:
            from apps.inventory.models import InventoryBulk

            qs = InventoryBulk.objects.filter(material=material)
            if plant_id:
                qs = qs.filter(plant_id=plant_id)
            total = qs.aggregate(total=Sum("qty_kg")).get("total") or Decimal("0")
            return Decimal(str(total))
        except Exception:
            logger.warning(
                "Available bulk stock lookup failed material_id=%s plant_id=%s",
                getattr(material, "id", None),
                plant_id,
                exc_info=True,
            )
            return Decimal("0")

    @staticmethod
    def _pod_product_master_for_variant(variant):
        code = str(getattr(variant, "code", "") or getattr(getattr(variant, "pod_sku", None), "code", "") or "").strip()
        if not code:
            return None
        try:
            defaults = getattr(variant, "production_defaults_json", {}) if isinstance(getattr(variant, "production_defaults_json", {}), dict) else {}
            explicit = InHouseDemandService._product_master_from_defaults(defaults)
            if explicit:
                return explicit
            masters = ProductMaster.objects.filter(
                active=True,
                is_current_version=True,
            ).select_related("template", "default_template")
            for master in masters:
                fixed = master.fixed_attributes if isinstance(master.fixed_attributes, dict) else {}
                fixed_codes = {
                    str(fixed.get("pod_sku_variant_code") or "").strip(),
                    str(fixed.get("pod_material_code") or "").strip(),
                    str(fixed.get("output_pod_material_code") or "").strip(),
                }
                material_code = str(getattr(getattr(variant, "material", None), "code", "") or "").strip()
                if code in fixed_codes or (material_code and material_code in fixed_codes):
                    return master
                for axis in master.variant_axes if isinstance(master.variant_axes, list) else []:
                    if not isinstance(axis, dict):
                        continue
                    if str(axis.get("type") or "").strip() != "pod_ref":
                        continue
                    options = axis.get("options") if isinstance(axis.get("options"), list) else []
                    option_codes = {
                        str((opt or {}).get("code") or (opt or {}).get("pod_sku_code") or "").strip()
                        if isinstance(opt, dict)
                        else str(opt or "").strip()
                        for opt in options
                    }
                    if code in option_codes:
                        return master
        except Exception:
            logger.warning(
                "POD product-master lookup failed variant_id=%s variant_code=%s",
                getattr(variant, "id", None),
                code,
                exc_info=True,
            )
            return None
        return None

    @staticmethod
    def _default_pod_axis_values(master: ProductMaster, variant) -> dict:
        defaults = getattr(variant, "production_defaults_json", {}) if isinstance(getattr(variant, "production_defaults_json", {}), dict) else {}
        axis_values: dict = InHouseDemandService._axis_values_from_defaults(defaults)
        pod_code = str(getattr(variant, "code", "") or getattr(getattr(variant, "pod_sku", None), "code", "") or "").strip()
        first_size = master.sizes.filter(active=True).order_by("sort_order", "code").first()
        layer_defaults = InHouseDemandService._default_layer_axis_maps(master, first_size)
        for axis in master.variant_axes if isinstance(master.variant_axes, list) else []:
            if not isinstance(axis, dict):
                continue
            key = str(axis.get("axis") or "").strip()
            axis_type = str(axis.get("type") or "").strip()
            options = axis.get("options") if isinstance(axis.get("options"), list) else []
            required = bool(axis.get("required"))
            if not key:
                continue
            if key in axis_values:
                continue
            if axis_type == "geometry" or key in {"size", "size_code"}:
                if first_size:
                    axis_values[key] = first_size.code
                elif options:
                    first = options[0]
                    axis_values[key] = first.get("code") if isinstance(first, dict) else first
            elif axis_type == "pod_ref" or key in {"pod", "pod_ref"}:
                axis_values[key] = pod_code
            elif key in layer_defaults:
                axis_values[key] = layer_defaults[key]
            elif required and options:
                first = options[0]
                axis_values[key] = first.get("code") if isinstance(first, dict) else first
        return axis_values

    @staticmethod
    def _axis_values_from_defaults(defaults: dict) -> dict:
        if not isinstance(defaults, dict):
            return {}
        for key in ("production_axis_values", "product_master_axis_values", "axis_values"):
            axis_values = defaults.get(key)
            if isinstance(axis_values, dict):
                return dict(axis_values)
        return {}

    @staticmethod
    def _product_master_from_defaults(defaults: dict, *, product_kind: str | None = None):
        if not isinstance(defaults, dict):
            return None
        product_master_id = str(defaults.get("production_product_master_id") or defaults.get("product_master_id") or "").strip()
        product_master_code = str(defaults.get("production_product_master_code") or defaults.get("product_master_code") or "").strip()
        qs = ProductMaster.objects.filter(
            active=True,
            is_current_version=True,
        ).select_related("template", "default_template")
        if product_kind:
            qs = qs.filter(product_kind=product_kind)
        try:
            if product_master_id:
                row = qs.filter(id=product_master_id).first()
                if row:
                    return row
            if product_master_code:
                row = qs.filter(code__iexact=product_master_code).first()
                if row:
                    return row
        except Exception:
            logger.warning(
                "Product-master default lookup failed product_master_id=%s product_master_code=%s",
                product_master_id or None,
                product_master_code or None,
                exc_info=True,
            )
            return None
        return None

    @staticmethod
    def _default_layer_axis_maps(master: ProductMaster, size) -> dict:
        rows = master.layer_template if isinstance(master.layer_template, list) and master.layer_template else master.canonical_layer_stack
        layers = [row for row in (rows or []) if isinstance(row, dict)]
        roll_width = Decimal("0")
        if size is not None:
            try:
                roll_width = Decimal(str(size.roll_width_mm or size.width_mm or 0))
            except Exception:
                roll_width = Decimal("0")

        thicknesses: dict[str, float] = {}
        widths: dict[str, float] = {}
        grades: dict[str, str] = {}
        for index, layer in enumerate(layers, start=1):
            key = str(index)
            thickness = layer.get("thickness_micron") or layer.get("thickness_um") or layer.get("default_thickness_micron") or layer.get("default_thickness_um")
            if thickness not in (None, ""):
                try:
                    thicknesses[key] = float(Decimal(str(thickness)))
                except Exception:
                    logger.warning("Invalid thickness in in-house demand layer=%s", index, exc_info=True)
            width = layer.get("input_roll_width_mm") or layer.get("roll_width_mm") or roll_width
            if width not in (None, ""):
                try:
                    width_dec = Decimal(str(width))
                    if width_dec > 0:
                        widths[key] = float(width_dec)
                except Exception:
                    logger.warning("Invalid roll width in in-house demand layer=%s", index, exc_info=True)
            grade = str(layer.get("default_grade") or layer.get("grade_name") or layer.get("grade") or "").strip()
            if grade:
                grades[key] = grade

        defaults = {}
        if thicknesses:
            defaults.update({
                "layer_thicknesses": thicknesses,
                "layer_thickness_um": thicknesses,
                "thickness_by_layer": thicknesses,
                "thickness_um_by_layer": thicknesses,
            })
        if widths:
            defaults.update({
                "layer_widths": widths,
                "layer_roll_widths": widths,
                "roll_width_by_layer": widths,
                "input_roll_widths": widths,
                "input_roll_width_by_layer": widths,
            })
        if grades:
            defaults.update({
                "layer_grades": grades,
                "grade_by_layer": grades,
                "layer_grade": grades,
            })
        return defaults

    @staticmethod
    def _upsert_packaging_demand(*, item, material: InventoryMaterial, target_qty: Decimal, uom: str, contract: dict, user=None):
        existing = SalesOrderItemInHouseDemand.objects.filter(
            sales_order_item=item,
            demand_kind="PACKAGING",
            packaging_material=material,
        ).first()
        if existing:
            updated_fields = []
            try:
                existing_target = Decimal(str(existing.target_qty or 0))
            except Exception:
                existing_target = target_qty
            if existing_target != target_qty:
                existing.target_qty = target_qty
                updated_fields.append("target_qty")
            order_uom = uom if uom in {"KG", "PCS", "METER"} else "PCS"
            base_uom = (material.base_uom or "").upper()
            if base_uom in {"KG", "PCS"} and order_uom != base_uom:
                order_uom = base_uom
            if str(existing.qty_uom or "").upper() != order_uom:
                existing.qty_uom = order_uom
                updated_fields.append("qty_uom")
            if updated_fields:
                existing.save(update_fields=updated_fields)
            if getattr(existing, "planned_stock_order_id", None):
                stock_updates = []
                if Decimal(str(existing.planned_stock_order.target_qty or 0)) != target_qty:
                    existing.planned_stock_order.target_qty = target_qty
                    stock_updates.append("target_qty")
                if str(existing.planned_stock_order.quantity_uom or "").upper() != order_uom:
                    existing.planned_stock_order.quantity_uom = order_uom
                    stock_updates.append("quantity_uom")
                if stock_updates:
                    # Confirmation and master propagation own the surrounding
                    # transaction. Never report an updated demand link while
                    # its pre-release planner order is still stale.
                    existing.planned_stock_order.save(update_fields=stock_updates)
            return existing, False

        order_uom = uom if uom in {"KG", "PCS", "METER"} else "PCS"
        # Honour the material's base UOM constraint (PACKAGING must match base_uom).
        base_uom = (material.base_uom or "").upper()
        if base_uom in {"KG", "PCS"} and order_uom != base_uom:
            order_uom = base_uom

        plant_id = getattr(item.sales_order, "plant_id", None)

        stock_order = PlannedStockOrder.objects.create(
            internal_name=f"In-house {material.code} for {item.sales_order.order_number}",
            template=contract["template"],
            plant_id=plant_id,
            product_master=contract.get("product_master"),
            axis_values=_json_safe(contract.get("axis_values") or {}),
            stock_purpose="PACKAGING",
            stock_strategy="PACKAGING_STOCK",
            quantity_uom=order_uom,
            target_qty=target_qty,
            geometry_override=_json_safe(contract.get("geometry_snapshot") or {}),
            geometry_snapshot=_json_safe(contract.get("geometry_snapshot") or {}),
            layer_snapshot=_json_safe(contract.get("layer_snapshot") or []),
            printing_snapshot=_json_safe(contract.get("printing_snapshot") or {"enabled": False}),
            addons_snapshot=_json_safe(contract.get("addons_snapshot") or []),
            packaging_snapshot=_json_safe(contract.get("packaging_snapshot") or {}),
            bom_snapshot=_json_safe(contract.get("bom_snapshot") or {}),
            spec_signature=contract.get("spec_signature") or "",
            invariant_signature=contract.get("invariant_signature") or "",
            unit_weight_g=contract.get("unit_weight_g") or Decimal("0"),
            total_weight_kg=contract.get("total_weight_kg") or Decimal("0"),
            packaging_material=material,
            commitment_scope="GENERIC",
            output_type="PACKAGING_STOCK",
            start_step_index=contract.get("start_step_index") or 0,
            stop_step_index=contract.get("stop_step_index"),
            target_step_index=contract.get("target_step_index"),
            planner_origin_meta={
                "trigger": "sales_confirm",
                "sales_order_id": str(item.sales_order_id),
                "sales_order_item_id": str(item.id),
                "production_contract": "product_master" if contract.get("product_master") else "material_template",
            },
            status="PLANNING_REQUIRED",
            created_by=user,
        )

        link = SalesOrderItemInHouseDemand.objects.create(
            sales_order_item=item,
            demand_kind="PACKAGING",
            packaging_material=material,
            planned_stock_order=stock_order,
            target_qty=target_qty,
            qty_uom=order_uom,
        )
        return link, True

    # ------------------------------------------------------------------
    # POD path
    # ------------------------------------------------------------------
    @classmethod
    def _ensure_pod(cls, item, created, skipped, *, user=None):
        snapshot = item.packaging_snapshot or {}
        pod = snapshot.get("pod") or {}
        if not pod.get("enabled"):
            return

        pod_sku_variant_id = pod.get("pod_sku_variant_id")
        if not pod_sku_variant_id:
            skipped.append({"item_id": str(item.id), "kind": "POD", "reason": "no_pod_sku_variant"})
            return

        try:
            from apps.materials.models import PodSkuVariant
            variant = PodSkuVariant.objects.select_related("material", "material__production_template").get(id=pod_sku_variant_id)
        except Exception:
            skipped.append({"item_id": str(item.id), "kind": "POD", "reason": "pod_sku_variant_lookup_failed", "pod_sku_variant_id": str(pod_sku_variant_id)})
            return

        material = variant.material
        if not material:
            skipped.append({"item_id": str(item.id), "kind": "POD", "reason": "no_material_on_pod_variant"})
            return
        if not getattr(material, "pod_is_inhouse_produced", False):
            return  # purchased POD — no auto-trigger

        target_qty_kg = cls._estimate_pod_qty_kg(item, variant)
        if target_qty_kg <= 0:
            skipped.append({"item_id": str(item.id), "kind": "POD", "reason": "non_positive_qty", "material_id": str(material.id)})
            return

        link = SalesOrderItemInHouseDemand.objects.filter(
            sales_order_item=item,
            demand_kind="POD",
            packaging_material=material,
        ).first()
        if link:
            updated_fields = []
            if Decimal(str(link.target_qty or 0)) != target_qty_kg:
                link.target_qty = target_qty_kg
                updated_fields.append("target_qty")
            if str(link.qty_uom or "").upper() != "KG":
                link.qty_uom = "KG"
                updated_fields.append("qty_uom")
            if updated_fields:
                link.save(update_fields=updated_fields)
            if link.planned_bulk_stock_order_id and Decimal(str(link.planned_bulk_stock_order.target_qty_kg or 0)) != target_qty_kg:
                link.planned_bulk_stock_order.target_qty_kg = target_qty_kg
                link.planned_bulk_stock_order.save(update_fields=["target_qty_kg"])
            if link.planned_bulk_stock_order_id:
                cls._backfill_pod_origin_meta(
                    link.planned_bulk_stock_order,
                    item=item,
                    variant=variant,
                    material=material,
                )
            return

        available_qty_kg = cls._available_bulk_stock_kg(material, plant_id=getattr(item.sales_order, "plant_id", None))
        shortage_qty_kg = (target_qty_kg - available_qty_kg).quantize(Decimal("0.0001"))
        if shortage_qty_kg <= 0:
            skipped.append({
                "item_id": str(item.id),
                "kind": "POD",
                "reason": "stock_available",
                "material_id": str(material.id),
                "material_code": material.code,
                "required_qty_kg": str(target_qty_kg),
                "available_qty_kg": str(available_qty_kg),
            })
            return
        target_qty_kg = shortage_qty_kg if available_qty_kg > 0 else target_qty_kg

        pod_product_master = cls._pod_product_master_for_variant(variant)
        pod_axis_values = cls._default_pod_axis_values(pod_product_master, variant) if pod_product_master else {}
        bulk_order = PlannedBulkStockOrder.objects.create(
            internal_name=f"In-house POD {material.code} for {item.sales_order.order_number}",
            material=material,
            plant_id=getattr(item.sales_order, "plant_id", None),
            target_qty_kg=target_qty_kg,
            pod_profile_snapshot={
                "material_id": str(material.id),
                "material_code": material.code,
                "material_name": material.name,
                "pod_sku_variant_id": str(variant.id),
                "pod_sku_code": str(getattr(variant, "code", "") or getattr(variant.pod_sku, "code", "")),
            },
            planner_origin_meta={
                "trigger": "sales_confirm",
                "sales_order_id": str(item.sales_order_id),
                "sales_order_item_id": str(item.id),
                "production_contract": "product_master" if pod_product_master else "pod_material",
                "product_master_id": str(getattr(pod_product_master, "id", "") or ""),
                "axis_values": _json_safe(pod_axis_values),
            },
            created_by=user,
        )

        link = SalesOrderItemInHouseDemand.objects.create(
            sales_order_item=item,
            demand_kind="POD",
            packaging_material=material,
            planned_bulk_stock_order=bulk_order,
            target_qty=target_qty_kg,
            qty_uom="KG",
        )
        created.append(link)

    @classmethod
    def _backfill_pod_origin_meta(cls, bulk_order, *, item, variant, material):
        existing = bulk_order.planner_origin_meta if isinstance(bulk_order.planner_origin_meta, dict) else {}
        pod_product_master = cls._pod_product_master_for_variant(variant)
        pod_axis_values = cls._default_pod_axis_values(pod_product_master, variant) if pod_product_master else {}
        merged = {
            **existing,
            "trigger": existing.get("trigger") or "sales_confirm",
            "sales_order_id": existing.get("sales_order_id") or str(item.sales_order_id),
            "sales_order_item_id": existing.get("sales_order_item_id") or str(item.id),
            "production_contract": existing.get("production_contract") or ("product_master" if pod_product_master else "pod_material"),
            "product_master_id": existing.get("product_master_id") or str(getattr(pod_product_master, "id", "") or ""),
            "axis_values": existing.get("axis_values") or _json_safe(pod_axis_values),
            "pod_material_code": existing.get("pod_material_code") or str(getattr(material, "code", "") or ""),
        }
        if merged != existing:
            bulk_order.planner_origin_meta = merged
            bulk_order.save(update_fields=["planner_origin_meta"])

    @staticmethod
    def _estimate_pod_qty_kg(item, variant) -> Decimal:
        """
        POD must follow the frozen BOM/physics quantity. The whole finished
        good weight is not a valid POD demand proxy.
        """
        material = variant.material
        bom_snapshot = getattr(item, "bom_snapshot", None) if isinstance(getattr(item, "bom_snapshot", None), dict) else {}
        for row in bom_snapshot.get("planning_lines") or []:
            if not isinstance(row, dict):
                continue
            category = str(row.get("category_code") or "").upper()
            material_match = (
                str(row.get("material_id") or "") == str(getattr(material, "id", "") or "")
                or str(row.get("material_code") or "") == str(getattr(material, "code", "") or "")
            )
            if category != "POD" and not material_match:
                continue
            qty = Decimal(str(row.get("planned_issue_qty") or row.get("theoretical_qty") or 0))
            if qty > 0:
                return qty.quantize(Decimal("0.0001"))

        order_qty = Decimal(str(getattr(item, "qty_value", 0) or 0))
        panels = Decimal(str(getattr(material, "pod_panel_count", 1) or 1))
        # Per-piece consumption falls out of unit_weight_g if available.
        unit_weight_g = Decimal(str(getattr(item, "unit_weight_g", 0) or 0))
        if unit_weight_g > 0 and panels > 0:
            est = (order_qty * unit_weight_g * panels) / Decimal("1000")
            return est.quantize(Decimal("0.0001"))
        # Fallback: assume 1g per panel per piece.
        return (order_qty * panels / Decimal("1000")).quantize(Decimal("0.0001"))
