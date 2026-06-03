from __future__ import annotations

from decimal import Decimal
from typing import Any
from uuid import UUID

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Q

from apps.inventory.models import (
    BulkTransaction,
    InventoryBulk,
    InventoryCorrectionAudit,
    InventoryRoll,
    PackagingTransaction,
    RollMovement,
)
from apps.inventory.services.bulk_service import BulkService
from apps.inventory.services.packaging_service import PackagingService
from apps.users.models import PermissionAuditLog


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

        if search:
            rows = [row for row in rows if search in cls._search_blob(row)]
        rows.sort(key=lambda row: str(row.get("created_at") or ""), reverse=True)
        return rows[:1000]

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
        else:
            raise ValidationError("source_type must be BULK, PACKAGING, or ROLL.")

        audit = InventoryCorrectionAudit.objects.create(
            source_type=source_type,
            source_id=source_id,
            reason=reason,
            before_json=before,
            after_json=after,
            delta_json=delta,
            actor=user if getattr(user, "is_authenticated", False) else None,
            effective_role=_role_code(user),
        )
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
        after = {**before, "quantity": float(corrected_qty), "avg_cost": float(corrected_cost), "reference": payload.get("reference") or tx.reference or ""}
        delta = {"quantity": float(delta_qty), "avg_cost": float(corrected_cost - _dec(tx.avg_cost or 0))}
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
        if delta_qty != 0:
            PackagingService.adjust_packaging_stock(
                material_id=tx.material_id,
                qty=delta_qty,
                location_id=tx.location_id,
                reference=reference,
                meta_json={"corrected_from_packaging_transaction_id": str(tx.id)},
            )
        after = {**before, "quantity": float(corrected_qty), "avg_cost": float(corrected_cost), "reference": payload.get("reference") or tx.reference or ""}
        delta = {"quantity": float(delta_qty), "avg_cost": float(corrected_cost - _dec(tx.avg_cost or 0))}
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
        if fields:
            roll.save(update_fields=fields)
        after = cls._roll_row(movement)
        delta = {"quantity": _float(_dec(after["quantity"]) - _dec(before["quantity"])), "fields": fields}
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
            pass
