from __future__ import annotations

from decimal import Decimal
import logging
from typing import Any
from uuid import UUID

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Q

from apps.inventory.models import (
    BulkTransaction,
    InventoryBulk,
    InventoryCorrectionAudit,
    InventoryLocation,
    InventoryRoll,
    PackagingStock,
    PackagingTransaction,
    RollMovement,
)
from apps.inventory.services.bulk_service import BulkService
from apps.inventory.services.packaging_service import PackagingService
from apps.materials.models import TradingGoodStock
from apps.procurement.models import TradingGoodReceipt
from apps.users.models import PermissionAuditLog

logger = logging.getLogger(__name__)


def _dec(value: Any) -> Decimal:
    return Decimal(str(value or 0))


def _float(value: Any) -> float:
    return float(_dec(value))


def _role_code(user) -> str:
    explicit = str(getattr(user, "effective_role_code", "") or "").strip()
    if explicit:
        return explicit.upper()
    return str(getattr(getattr(user, "role", None), "code", "") or "").upper()


def _vendor_from_reference(reference: str) -> dict[str, str | None]:
    text = str(reference or "")
    if not text.startswith("VENDOR:"):
        return {"vendor_code": None, "vendor_name": None}
    code = text.split("|", 1)[0].replace("VENDOR:", "").strip()
    return {"vendor_code": code or None, "vendor_name": code or None}


class GRNHistoryService:
    REASON_CODES = [
        {"code": "QTY_MISMATCH", "label": "Quantity mismatch", "description": "Invoice, challan, or unloading quantity was entered incorrectly."},
        {"code": "RATE_MISMATCH", "label": "Rate mismatch", "description": "Unit cost was entered incorrectly and valuation needs correction."},
        {"code": "VENDOR_DOC", "label": "Vendor document update", "description": "Invoice, reference, or supplier document changed after posting."},
        {"code": "ROLL_IDENTITY", "label": "Roll identity/spec correction", "description": "Roll label, batch, width, thickness, length, or stock form was keyed incorrectly."},
        {"code": "LOCATION_MISMATCH", "label": "Location mismatch", "description": "Receipt was posted to the wrong store location."},
        {"code": "OTHER", "label": "Other approved correction", "description": "Approved correction that does not fit another code."},
    ]

    @classmethod
    def reason_codes(cls) -> list[dict[str, str]]:
        return cls.REASON_CODES

    @classmethod
    def _reason_label(cls, code: str) -> str:
        normalized = str(code or "OTHER").upper()
        match = next((item for item in cls.REASON_CODES if item["code"] == normalized), None)
        if not match:
            raise ValidationError("Invalid correction reason code.")
        return match["label"]

    @classmethod
    def list_history(cls, params) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        source = str(params.get("source_type") or params.get("stock_class") or "ALL").upper()
        search = str(params.get("search") or "").strip().lower()
        material = params.get("material")
        vendor = str(params.get("vendor") or "").strip().lower()
        reference = str(params.get("reference") or "").strip().lower()
        plant = params.get("plant")
        location = params.get("location")
        date_from = params.get("date_from") or params.get("from")
        date_to = params.get("date_to") or params.get("to")
        try:
            limit = max(1, min(500, int(params.get("limit") or 500)))
        except Exception:
            limit = 500
        try:
            offset = max(0, min(10000, int(params.get("offset") or 0)))
        except Exception:
            offset = 0

        if source in {"ALL", "BULK"}:
            qs = BulkTransaction.objects.select_related("material", "granule_code", "location", "location__plant", "vendor").filter(type="INWARD")
            if material:
                qs = qs.filter(material_id=material)
            if plant:
                qs = qs.filter(location__plant_id=plant)
            if location:
                qs = qs.filter(location_id=location)
            if date_from:
                qs = qs.filter(created_at__date__gte=date_from)
            if date_to:
                qs = qs.filter(created_at__date__lte=date_to)
            if reference:
                qs = qs.filter(reference__icontains=reference)
            if vendor:
                qs = qs.filter(reference__icontains=vendor)
            for tx in qs[:500]:
                rows.append(cls._bulk_row(tx))

        if source in {"ALL", "PACKAGING"}:
            qs = PackagingTransaction.objects.select_related("material", "location", "location__plant", "vendor").filter(type="INWARD")
            if material:
                qs = qs.filter(material_id=material)
            if plant:
                qs = qs.filter(location__plant_id=plant)
            if location:
                qs = qs.filter(location_id=location)
            if date_from:
                qs = qs.filter(created_at__date__gte=date_from)
            if date_to:
                qs = qs.filter(created_at__date__lte=date_to)
            if reference:
                qs = qs.filter(reference__icontains=reference)
            if vendor:
                qs = qs.filter(Q(vendor__name__icontains=vendor) | Q(vendor__code__icontains=vendor))
            for tx in qs[:500]:
                rows.append(cls._packaging_row(tx))

        if source in {"ALL", "ROLL"}:
            qs = RollMovement.objects.select_related(
                "roll",
                "roll__material",
                "roll__grade",
                "to_location",
                "to_location__plant",
                "moved_by",
            ).filter(Q(reason="GRN") | Q(roll__meta_json__grn_source="GRN_INWARD"))
            if material:
                qs = qs.filter(roll__material_id=material)
            if plant:
                qs = qs.filter(to_location__plant_id=plant)
            if location:
                qs = qs.filter(to_location_id=location)
            if date_from:
                qs = qs.filter(timestamp__date__gte=date_from)
            if date_to:
                qs = qs.filter(timestamp__date__lte=date_to)
            for movement in qs[:500]:
                row = cls._roll_row(movement)
                if reference and reference not in str(row.get("reference") or "").lower():
                    continue
                if vendor:
                    vendor_blob = f"{row.get('vendor_code') or ''} {row.get('vendor_name') or ''}".lower()
                    if vendor not in vendor_blob:
                        continue
                rows.append(row)

        rows = cls._apply_latest_corrections(rows)
        if search:
            rows = [row for row in rows if search in cls._search_blob(row)]
        rows.sort(key=lambda row: str(row.get("created_at") or ""), reverse=True)
        return rows[offset : offset + limit]

    @staticmethod
    def _apply_latest_corrections(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if not rows:
            return rows
        source_ids = []
        for row in rows:
            try:
                source_ids.append(UUID(str(row.get("source_id") or row.get("id"))))
            except Exception:
                continue
        if not source_ids:
            return rows
        latest: dict[tuple[str, str], InventoryCorrectionAudit] = {}
        audits = InventoryCorrectionAudit.objects.filter(source_id__in=source_ids).order_by("-created_at")
        for audit in audits:
            key = (str(audit.source_type or "").upper(), str(audit.source_id))
            if key not in latest:
                latest[key] = audit
        for row in rows:
            key = (str(row.get("source_type") or "").upper(), str(row.get("source_id") or row.get("id")))
            audit = latest.get(key)
            if not audit:
                row["has_correction"] = False
                continue
            before = dict(audit.before_json or {})
            after = dict(audit.after_json or {})
            row["has_correction"] = True
            row["correction"] = {
                "id": str(audit.id),
                "reason": audit.reason,
                "created_at": audit.created_at.isoformat() if audit.created_at else None,
                "actor": getattr(audit.actor, "username", "") if audit.actor_id else "",
                "before": before,
                "after": after,
                "delta": audit.delta_json or {},
            }
            row["original_quantity"] = before.get("quantity", row.get("quantity"))
            row["original_avg_cost"] = before.get("avg_cost", row.get("avg_cost"))
            for field in (
                "quantity",
                "avg_cost",
                "reference",
                "location",
                "location_name",
                "label_id",
                "batch_no",
                "vendor_invoice_no",
                "manual_po_ref",
            ):
                if field in after:
                    row[field] = after[field]
        return rows

    @classmethod
    @transaction.atomic
    def reconcile_effective_stock_rates(cls, *, plant_id: str | None = None) -> dict[str, int]:
        """Apply latest GRN correction rates to live stock valuation rows.

        Older correction audits may have updated the GRN history overlay without
        updating InventoryBulk/PackagingStock. Stock lifecycle KPIs use those
        stock rows, so this idempotent reconciliation keeps history, stock cards,
        snapshots, and class views on the same effective rate.
        """
        latest: dict[tuple[str, str], InventoryCorrectionAudit] = {}
        audits = InventoryCorrectionAudit.objects.filter(source_type__in=["BULK", "PACKAGING"]).order_by("-created_at")
        for audit in audits:
            key = (str(audit.source_type or "").upper(), str(audit.source_id))
            if key not in latest:
                latest[key] = audit

        bulk_ids = [source_id for source_type, source_id in latest if source_type == "BULK"]
        packaging_ids = [source_id for source_type, source_id in latest if source_type == "PACKAGING"]
        bulk_txs = {
            str(tx.id): tx
            for tx in BulkTransaction.objects.select_related("material", "granule_code", "location", "location__plant")
            .filter(id__in=bulk_ids, type="INWARD")
        }
        packaging_txs = {
            str(tx.id): tx
            for tx in PackagingTransaction.objects.select_related("material", "location", "location__plant")
            .filter(id__in=packaging_ids, type="INWARD")
        }

        result = {"bulk_updated": 0, "packaging_updated": 0, "adjustments_created": 0}
        for (source_type, source_id), audit in latest.items():
            after = dict(audit.after_json or {})
            corrected_rate = _dec(after.get("avg_cost"))
            if corrected_rate <= 0:
                continue
            if source_type == "BULK":
                tx = bulk_txs.get(source_id)
                if not tx:
                    continue
                location_id = after.get("location") or str(tx.location_id)
                stock = InventoryBulk.objects.select_for_update().filter(
                    material=tx.material,
                    granule_code=tx.granule_code,
                    location_id=location_id,
                ).first()
                if not stock:
                    continue
                if plant_id and str(stock.plant_id) != str(plant_id):
                    continue
                if _dec(stock.avg_cost) != corrected_rate:
                    stock.avg_cost = corrected_rate
                    stock.save(update_fields=["avg_cost", "updated_at"])
                    result["bulk_updated"] += 1
                reference = f"GRN_CORRECTION:{tx.id}"
                if not BulkTransaction.objects.filter(type="ADJUST", qty_kg=Decimal("0"), reference__contains=reference).exists():
                    BulkTransaction.objects.create(
                        material=tx.material,
                        granule_code=tx.granule_code,
                        location=stock.location,
                        type="ADJUST",
                        qty_kg=Decimal("0"),
                        avg_cost=corrected_rate,
                        reference=f"{reference} | reconciled effective rate",
                    )
                    result["adjustments_created"] += 1
            elif source_type == "PACKAGING":
                tx = packaging_txs.get(source_id)
                if not tx:
                    continue
                location_id = after.get("location") or str(tx.location_id)
                stock = PackagingStock.objects.select_for_update().filter(
                    material=tx.material,
                    location_id=location_id,
                ).first()
                if not stock:
                    continue
                if plant_id and str(stock.plant_id) != str(plant_id):
                    continue
                if _dec(stock.avg_cost) != corrected_rate:
                    stock.avg_cost = corrected_rate
                    stock.save(update_fields=["avg_cost", "updated_at"])
                    result["packaging_updated"] += 1
                reference = f"GRN_CORRECTION:{tx.id}"
                if not PackagingTransaction.objects.filter(type="ADJUST", qty=Decimal("0"), reference__contains=reference).exists():
                    PackagingTransaction.objects.create(
                        type="ADJUST",
                        material=tx.material,
                        location=stock.location,
                        qty=Decimal("0"),
                        avg_cost=corrected_rate,
                        reference=f"{reference} | reconciled effective rate",
                        meta_json={"corrected_from_packaging_transaction_id": str(tx.id), "rate_reconciled": True},
                    )
                    result["adjustments_created"] += 1
        return result

    @staticmethod
    def _search_blob(row: dict[str, Any]) -> str:
        keys = [
            "source_type",
            "material_code",
            "material_name",
            "reference",
            "vendor_code",
            "vendor_name",
            "location_name",
            "plant_name",
            "label_id",
            "batch_no",
            "granule_quality_code",
        ]
        return " ".join(str(row.get(key) or "").lower() for key in keys)

    @staticmethod
    def _bulk_row(tx: BulkTransaction) -> dict[str, Any]:
        reference_vendor = _vendor_from_reference(tx.reference or "")
        vendor_code = tx.vendor.code if tx.vendor_id and tx.vendor else reference_vendor.get("vendor_code")
        vendor_name = tx.vendor.name if tx.vendor_id and tx.vendor else reference_vendor.get("vendor_name")
        uom = (tx.material.base_uom if tx.material else "") or "KG"
        return {
            "id": str(tx.id),
            "source_type": "BULK",
            "source_id": str(tx.id),
            "material": str(tx.material_id),
            "material_code": tx.material.code if tx.material else "",
            "material_name": tx.material.name if tx.material else "",
            "material_category": tx.material.category if tx.material else "",
            "granule_quality_code": tx.granule_code.code if tx.granule_code else "",
            "plant": str(tx.location.plant_id) if tx.location_id and tx.location else "",
            "plant_name": tx.location.plant.name if tx.location_id and tx.location and tx.location.plant else "",
            "location": str(tx.location_id),
            "location_name": tx.location.name if tx.location else "",
            "quantity": _float(tx.qty_kg),
            "uom": uom,
            "base_uom": uom,
            "stock_uom": uom,
            "avg_cost": _float(tx.avg_cost),
            "reference": tx.reference or "",
            "vendor_invoice_no": tx.vendor_invoice_no or "",
            "manual_po_ref": tx.manual_po_ref or "",
            "vendor": str(tx.vendor_id) if tx.vendor_id else None,
            "vendor_code": vendor_code,
            "vendor_name": vendor_name,
            "created_at": tx.created_at.isoformat() if tx.created_at else None,
        }

    @staticmethod
    def _packaging_row(tx: PackagingTransaction) -> dict[str, Any]:
        return {
            "id": str(tx.id),
            "source_type": "PACKAGING",
            "source_id": str(tx.id),
            "material": str(tx.material_id),
            "material_code": tx.material.code if tx.material else "",
            "material_name": tx.material.name if tx.material else "",
            "material_category": tx.material.category if tx.material else "",
            "packaging_kind": getattr(tx.material, "packaging_kind", "") if tx.material else "",
            "plant": str(tx.location.plant_id) if tx.location_id and tx.location else "",
            "plant_name": tx.location.plant.name if tx.location_id and tx.location and tx.location.plant else "",
            "location": str(tx.location_id),
            "location_name": tx.location.name if tx.location else "",
            "quantity": _float(tx.qty),
            "uom": getattr(tx.material, "base_uom", "") or "PCS",
            "avg_cost": _float(tx.avg_cost),
            "reference": tx.reference or "",
            "vendor_invoice_no": tx.vendor_invoice_no or "",
            "manual_po_ref": tx.manual_po_ref or "",
            "vendor": str(tx.vendor_id) if tx.vendor_id else None,
            "vendor_code": tx.vendor.code if tx.vendor else None,
            "vendor_name": tx.vendor.name if tx.vendor else None,
            "created_at": tx.created_at.isoformat() if tx.created_at else None,
        }

    @staticmethod
    def _roll_row(movement: RollMovement) -> dict[str, Any]:
        roll = movement.roll
        meta = roll.meta_json or {}
        return {
            "id": str(movement.id),
            "source_type": "ROLL",
            "source_id": str(movement.id),
            "roll": str(roll.id) if roll else "",
            "label_id": roll.label_id if roll else "",
            "batch_no": roll.batch_no if roll else "",
            "material": str(roll.material_id) if roll and roll.material_id else "",
            "material_code": roll.material.code if roll and roll.material else "",
            "material_name": roll.material.name if roll and roll.material else "",
            "material_category": roll.material.category if roll and roll.material else "",
            "grade_name": roll.grade.name if roll and roll.grade else "",
            "width_mm": _float(roll.width_mm) if roll else 0,
            "stock_form": roll.stock_form if roll else "",
            "width_basis": roll.width_basis if roll else "",
            "thickness_micron": _float(roll.thickness_micron) if roll else 0,
            "plant": str(movement.to_location.plant_id) if movement.to_location_id and movement.to_location else "",
            "plant_name": movement.to_location.plant.name if movement.to_location_id and movement.to_location and movement.to_location.plant else "",
            "location": str(movement.to_location_id),
            "location_name": movement.to_location.name if movement.to_location else "",
            "quantity": _float(roll.weight_kg) if roll else 0,
            "uom": "KG",
            "avg_cost": 0,
            "reference": meta.get("grn_reference") or movement.reason_note or "",
            "vendor_invoice_no": (roll.vendor_invoice_no if roll else "") or meta.get("grn_vendor_invoice_no") or "",
            "manual_po_ref": (roll.manual_po_ref if roll else "") or "",
            "vendor": meta.get("grn_vendor_id"),
            "vendor_code": meta.get("grn_vendor_code"),
            "vendor_name": meta.get("grn_vendor_name"),
            "created_at": movement.timestamp.isoformat() if movement.timestamp else None,
        }

    @classmethod
    @transaction.atomic
    def correct(cls, *, source_type: str, source_id: str, payload: dict[str, Any], user) -> InventoryCorrectionAudit:
        source_type = str(source_type or "").upper()
        reason = str(payload.get("reason") or "").strip()
        if not reason:
            raise ValidationError("Correction reason is required.")
        reason_code = str(payload.get("reason_code") or "OTHER").strip().upper()
        reason_label = cls._reason_label(reason_code)
        try:
            UUID(str(source_id))
        except Exception as exc:
            raise ValidationError("Invalid GRN history row id.") from exc

        if source_type == "BULK":
            before, after, delta = cls._correct_bulk(source_id, payload)
        elif source_type == "PACKAGING":
            before, after, delta = cls._correct_packaging(source_id, payload)
        elif source_type == "ROLL":
            before, after, delta = cls._correct_roll(source_id, payload)
        elif source_type == "TRADING":
            before, after, delta = cls._correct_trading(source_id, payload)
        else:
            raise ValidationError("source_type must be BULK, PACKAGING, ROLL, or TRADING.")
        after = {**after, "correction_reason_code": reason_code, "correction_reason_label": reason_label}
        delta = {**delta, "reason_code": reason_code, "reason_label": reason_label}

        audit = InventoryCorrectionAudit.objects.create(
            source_type=source_type,
            source_id=source_id,
            reason=f"{reason_code}: {reason}",
            before_json=before,
            after_json=after,
            delta_json=delta,
            actor=user if getattr(user, "is_authenticated", False) else None,
            effective_role=_role_code(user),
        )
        cls.reconcile_effective_stock_rates(plant_id=after.get("plant"))
        cls._mirror_permission_audit(audit, user)
        return audit

    @classmethod
    def _correct_bulk(cls, source_id: str, payload: dict[str, Any]):
        tx = BulkTransaction.objects.select_related("material", "granule_code", "location").get(id=source_id, type="INWARD")
        before = cls._bulk_row(tx)
        corrected_qty = _dec(payload.get("quantity", tx.qty_kg))
        corrected_cost = _dec(payload.get("avg_cost", tx.avg_cost or 0))
        if corrected_qty < 0:
            raise ValidationError("Corrected bulk quantity cannot be negative.")
        delta_qty = corrected_qty - _dec(tx.qty_kg)
        reference = f"GRN_CORRECTION:{tx.id} | {payload.get('reference') or tx.reference or ''}"
        stock_uom = tx.material.base_uom or "KG"
        target_location_id = payload.get("location") or payload.get("location_id")
        target_location = None
        location_changed = False
        if target_location_id:
            target_location = InventoryLocation.objects.select_related("plant").get(id=target_location_id)
            location_changed = str(target_location.id) != str(tx.location_id)

        if delta_qty > 0:
            BulkService.add_bulk(
                tx.material_id,
                delta_qty,
                tx.location.plant_id,
                tx.location_id,
                cost=corrected_cost,
                reference=reference,
                tx_type="ADJUST",
                granule_code_id=tx.granule_code_id,
                qty_uom=stock_uom,
            )
        elif delta_qty < 0:
            adjust_tx = BulkService.consume_bulk(
                tx.material_id,
                abs(delta_qty),
                tx.location_id,
                reference=reference,
                granule_code_id=tx.granule_code_id,
                qty_uom=stock_uom,
            )
            adjust_tx.type = "ADJUST"
            adjust_tx.save(update_fields=["type"])

        if location_changed and corrected_qty > 0:
            BulkService.transfer_bulk(
                tx.material_id,
                corrected_qty,
                tx.location_id,
                target_location.id,
                reference=reference,
                granule_code_id=tx.granule_code_id,
                qty_uom=stock_uom,
            )

        rate_location = target_location if location_changed and target_location else tx.location
        stock = InventoryBulk.objects.select_for_update().filter(
            material=tx.material,
            granule_code=tx.granule_code,
            plant=rate_location.plant,
            location=rate_location,
        ).first()
        if stock and corrected_cost > 0 and corrected_cost != _dec(stock.avg_cost):
            stock.avg_cost = corrected_cost
            stock.save(update_fields=["avg_cost", "updated_at"])
            if delta_qty == 0 and not location_changed:
                BulkTransaction.objects.create(
                    material=tx.material,
                    granule_code=tx.granule_code,
                    location=tx.location,
                    type="ADJUST",
                    qty_kg=Decimal("0"),
                    avg_cost=corrected_cost,
                    reference=reference,
                )
        after = {**before, "quantity": float(corrected_qty), "avg_cost": float(corrected_cost), "reference": payload.get("reference") or tx.reference or ""}
        if location_changed and target_location:
            after.update({
                "plant": str(target_location.plant_id),
                "plant_name": target_location.plant.name if target_location.plant else "",
                "location": str(target_location.id),
                "location_name": target_location.name,
            })
        delta = {
            "quantity": float(delta_qty),
            "avg_cost": float(corrected_cost - _dec(tx.avg_cost or 0)),
            "location_changed": location_changed,
        }
        return before, after, delta

    @classmethod
    def _correct_packaging(cls, source_id: str, payload: dict[str, Any]):
        tx = PackagingTransaction.objects.select_related("material", "location", "vendor").get(id=source_id, type="INWARD")
        before = cls._packaging_row(tx)
        corrected_qty = _dec(payload.get("quantity", tx.qty))
        corrected_cost = _dec(payload.get("avg_cost", tx.avg_cost or 0))
        if corrected_qty < 0:
            raise ValidationError("Corrected packaging quantity cannot be negative.")
        delta_qty = corrected_qty - _dec(tx.qty)
        reference = f"GRN_CORRECTION:{tx.id} | {payload.get('reference') or tx.reference or ''}"
        target_location_id = payload.get("location") or payload.get("location_id")
        target_location = None
        location_changed = False
        if target_location_id:
            target_location = InventoryLocation.objects.select_related("plant").get(id=target_location_id)
            location_changed = str(target_location.id) != str(tx.location_id)

        if delta_qty != 0:
            PackagingService.adjust_packaging_stock(
                material_id=tx.material_id,
                qty=delta_qty,
                location_id=tx.location_id,
                reference=reference,
                meta_json={"corrected_from_packaging_transaction_id": str(tx.id)},
            )
        if location_changed and corrected_qty > 0:
            PackagingService.transfer_packaging_stock(
                material_id=tx.material_id,
                qty=corrected_qty,
                from_location_id=tx.location_id,
                to_location_id=target_location.id,
                reference=reference,
                input_uom=tx.material.base_uom,
            )

        rate_location = target_location if location_changed and target_location else tx.location
        stock = PackagingStock.objects.select_for_update().filter(
            material=tx.material,
            plant=rate_location.plant,
            location=rate_location,
        ).first()
        if stock and corrected_cost > 0 and corrected_cost != _dec(stock.avg_cost):
            stock.avg_cost = corrected_cost
            stock.save(update_fields=["avg_cost", "updated_at"])
            if delta_qty == 0 and not location_changed:
                PackagingTransaction.objects.create(
                    type="ADJUST",
                    material=tx.material,
                    location=tx.location,
                    qty=Decimal("0"),
                    avg_cost=corrected_cost,
                    reference=reference,
                    meta_json={"corrected_from_packaging_transaction_id": str(tx.id), "rate_only": True},
                )
        after = {**before, "quantity": float(corrected_qty), "avg_cost": float(corrected_cost), "reference": payload.get("reference") or tx.reference or ""}
        if location_changed and target_location:
            after.update({
                "plant": str(target_location.plant_id),
                "plant_name": target_location.plant.name if target_location.plant else "",
                "location": str(target_location.id),
                "location_name": target_location.name,
            })
        delta = {
            "quantity": float(delta_qty),
            "avg_cost": float(corrected_cost - _dec(tx.avg_cost or 0)),
            "location_changed": location_changed,
        }
        return before, after, delta

    @classmethod
    def _correct_roll(cls, source_id: str, payload: dict[str, Any]):
        movement = RollMovement.objects.select_related("roll", "roll__material", "roll__grade", "to_location", "to_location__plant").get(
            Q(reason="GRN") | Q(roll__meta_json__grn_source="GRN_INWARD"),
            id=source_id,
        )
        roll: InventoryRoll = movement.roll
        if roll.consumptions_as_input.exists() or roll.child_links.exists() or roll.parent_links.exists():
            raise ValidationError("This roll already has genealogy or consumption history. Use stock count / correction instead.")
        if str(roll.status or "").upper() in {"CONSUMED", "SCRAPPED"}:
            raise ValidationError("Consumed or scrapped rolls cannot be corrected from GRN history. Use stock count / correction instead.")
        before = cls._roll_row(movement)
        fields = []
        if "quantity" in payload:
            qty = _dec(payload.get("quantity"))
            if qty <= 0:
                raise ValidationError("Corrected roll weight must be greater than zero.")
            roll.weight_kg = qty
            fields.append("weight_kg")
        if "label_id" in payload and str(payload.get("label_id") or "").strip():
            roll.label_id = str(payload.get("label_id")).strip()
            fields.append("label_id")
        if "batch_no" in payload:
            roll.batch_no = str(payload.get("batch_no") or "").strip()
            fields.append("batch_no")
        if "width_mm" in payload:
            width = _dec(payload.get("width_mm"))
            if width <= 0:
                raise ValidationError("Corrected roll width must be greater than zero.")
            roll.width_mm = width
            fields.append("width_mm")
        if "thickness_micron" in payload:
            micron = _dec(payload.get("thickness_micron"))
            if micron <= 0:
                raise ValidationError("Corrected roll thickness must be greater than zero.")
            roll.thickness_micron = micron
            fields.append("thickness_micron")
        if "length_m" in payload:
            length = _dec(payload.get("length_m"))
            if length < 0:
                raise ValidationError("Corrected roll length cannot be negative.")
            roll.length_m = length
            fields.append("length_m")
        if "stock_form" in payload:
            roll.stock_form = str(payload.get("stock_form") or "").strip() or roll.stock_form
            fields.append("stock_form")
        if "width_basis" in payload:
            roll.width_basis = str(payload.get("width_basis") or "").strip()
            fields.append("width_basis")
        location_id = payload.get("location") or payload.get("location_id")
        location_changed = False
        original_location = roll.location
        if location_id:
            location = InventoryLocation.objects.get(id=location_id)
            roll.location = location
            fields.append("location")
            location_changed = str(getattr(original_location, "id", "")) != str(location.id)
        if fields:
            if "stock_form" in fields and "width_basis" not in fields:
                fields.append("width_basis")
            roll.save(update_fields=list(dict.fromkeys(fields)))
        if location_changed:
            RollMovement.objects.create(
                roll=roll,
                from_location=original_location,
                to_location=roll.location,
                reason="ADJUSTMENT",
                reason_note=f"GRN_CORRECTION:{source_id}",
            )
        after = cls._roll_row(movement)
        delta = {"quantity": _float(_dec(after["quantity"]) - _dec(before["quantity"])), "fields": fields}
        return before, after, delta

    @staticmethod
    def _trading_row(receipt: TradingGoodReceipt) -> dict[str, Any]:
        return {
            "id": str(receipt.id),
            "source_type": "TRADING",
            "source_id": str(receipt.id),
            "material": str(receipt.trading_good_id),
            "material_code": receipt.trading_good.code if receipt.trading_good else "",
            "material_name": receipt.trading_good.name if receipt.trading_good else "",
            "material_category": "TRADING",
            "plant": str(receipt.plant_id),
            "plant_name": receipt.plant.name if receipt.plant else "",
            "quantity": _float(receipt.qty_received),
            "uom": receipt.trading_good.base_uom if receipt.trading_good else "",
            "avg_cost": _float(receipt.rate),
            "gst_percent": _float(receipt.gst_pct),
            "gst": _float(receipt.line_gst),
            "line_subtotal": _float(receipt.line_subtotal),
            "line_total": _float(receipt.line_total),
            "reference": receipt.code or "",
            "vendor_invoice_no": receipt.vendor_invoice_no or "",
            "manual_po_ref": receipt.manual_po_ref or "",
            "vendor": str(receipt.vendor_id) if receipt.vendor_id else None,
            "vendor_code": receipt.vendor.code if receipt.vendor else None,
            "vendor_name": receipt.vendor.name if receipt.vendor else None,
            "created_at": receipt.received_at.isoformat() if receipt.received_at else None,
        }

    @classmethod
    def _correct_trading(cls, source_id: str, payload: dict[str, Any]):
        receipt = TradingGoodReceipt.objects.select_related("trading_good", "vendor", "plant").get(id=source_id)
        before = cls._trading_row(receipt)
        corrected_qty = _dec(payload.get("quantity", receipt.qty_received))
        corrected_rate = _dec(payload.get("avg_cost", receipt.rate or 0))
        corrected_gst_pct = _dec(payload.get("gst_percent", payload.get("gst_pct", receipt.gst_pct or 0)))
        if corrected_qty < 0:
            raise ValidationError("Corrected trading-good quantity cannot be negative.")
        if corrected_rate < 0:
            raise ValidationError("Corrected trading-good rate cannot be negative.")
        if corrected_gst_pct < 0:
            raise ValidationError("Corrected trading-good GST percent cannot be negative.")

        target_plant_id = payload.get("plant") or payload.get("plant_id") or receipt.plant_id
        target_plant_id = str(target_plant_id)
        location_changed = target_plant_id != str(receipt.plant_id)
        original_qty = _dec(receipt.qty_received)
        original_rate = _dec(receipt.rate or 0)

        if location_changed:
            source_stock = TradingGoodStock.objects.select_for_update().get(
                trading_good=receipt.trading_good,
                plant=receipt.plant,
            )
            source_qty_after = _dec(source_stock.qty) - original_qty
            if source_qty_after < 0:
                raise ValidationError("Cannot move this trading-good GRN because the original plant stock is already below the received quantity.")
            source_value_after = (_dec(source_stock.qty) * _dec(source_stock.avg_cost)) - (original_qty * original_rate)
            source_stock.qty = source_qty_after
            source_stock.avg_cost = source_value_after / source_qty_after if source_qty_after > 0 else Decimal("0")
            source_stock.save(update_fields=["qty", "avg_cost", "updated_at"])

            target_stock, _ = TradingGoodStock.objects.select_for_update().get_or_create(
                trading_good=receipt.trading_good,
                plant_id=target_plant_id,
                defaults={"qty": Decimal("0"), "avg_cost": Decimal("0")},
            )
            target_qty_after = _dec(target_stock.qty) + corrected_qty
            target_value_after = (_dec(target_stock.qty) * _dec(target_stock.avg_cost)) + (corrected_qty * corrected_rate)
            target_stock.qty = target_qty_after
            target_stock.avg_cost = target_value_after / target_qty_after if target_qty_after > 0 else Decimal("0")
            target_stock.save(update_fields=["qty", "avg_cost", "updated_at"])
        else:
            stock = TradingGoodStock.objects.select_for_update().get(
                trading_good=receipt.trading_good,
                plant=receipt.plant,
            )
            qty_after = _dec(stock.qty) - original_qty + corrected_qty
            if qty_after < 0:
                raise ValidationError("Cannot reduce this trading-good GRN below already dispatched/adjusted stock.")
            value_after = (_dec(stock.qty) * _dec(stock.avg_cost)) - (original_qty * original_rate) + (corrected_qty * corrected_rate)
            stock.qty = qty_after
            stock.avg_cost = value_after / qty_after if qty_after > 0 else Decimal("0")
            stock.save(update_fields=["qty", "avg_cost", "updated_at"])

        after = {
            **before,
            "quantity": float(corrected_qty),
            "avg_cost": float(corrected_rate),
            "gst_percent": float(corrected_gst_pct),
            "gst": float((corrected_qty * corrected_rate) * corrected_gst_pct / Decimal("100")),
            "line_subtotal": float(corrected_qty * corrected_rate),
            "line_total": float((corrected_qty * corrected_rate) * (Decimal("1") + corrected_gst_pct / Decimal("100"))),
            "reference": payload.get("reference") or receipt.code or "",
        }
        if location_changed:
            target_stock = TradingGoodStock.objects.select_related("plant").get(
                trading_good=receipt.trading_good,
                plant_id=target_plant_id,
            )
            after.update({
                "plant": str(target_stock.plant_id),
                "plant_name": target_stock.plant.name if target_stock.plant else "",
            })
        delta = {
            "quantity": float(corrected_qty - original_qty),
            "avg_cost": float(corrected_rate - original_rate),
            "gst_percent": float(corrected_gst_pct - _dec(receipt.gst_pct or 0)),
            "plant_changed": location_changed,
        }
        return before, after, delta

    @staticmethod
    def _mirror_permission_audit(audit: InventoryCorrectionAudit, user) -> None:
        try:
            PermissionAuditLog.objects.create(
                user=user if getattr(user, "is_authenticated", False) else None,
                action="MASTER_DATA_CHANGED",
                method="POST",
                path=f"/api/inventory/grn/history/{audit.source_type}/{audit.source_id}/correct/",
                effective_role=audit.effective_role,
                details={
                    "area": "INVENTORY_GRN_CORRECTION",
                    "source_type": audit.source_type,
                    "source_id": str(audit.source_id),
                    "correction_audit_id": str(audit.id),
                    "reason": audit.reason,
                    "delta": audit.delta_json,
                },
            )
        except Exception:
            logger.warning("Unable to mirror GRN correction audit id=%s to permission audit log", getattr(audit, "id", None), exc_info=True)
