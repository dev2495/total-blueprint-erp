"""
PO Receipt Service — the single source of truth for stock mutation against PO.

Thin wrapper that delegates posting to the existing inventory services:
    - BulkService.add_bulk          (granule, ink, solvent, adhesive, addon)
    - RollService.create_roll       (FILM_VARIANT, POD)
    - PackagingService.add_packaging_stock (PACKAGING)

No stock-mutation logic is duplicated here.
"""

from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import connection, transaction
import hashlib
from django.utils import timezone

from apps.inventory.models import InventoryLocation
from apps.inventory.services.bulk_service import BulkService
from apps.inventory.services.packaging_service import PackagingService
from apps.inventory.services.roll_service import RollService
from apps.procurement.models import (
    PurchaseOrder,
    PurchaseOrderReceipt,
    PurchaseOrderReceiptLine,
)
from apps.procurement.services.purchase_order import PurchaseOrderService


BULK_CATEGORIES = {"GRANULE", "INK", "ADHESIVE", "SOLVENT", "ADDON", "FILM_FAMILY"}
ROLL_CATEGORIES = {"FILM_VARIANT", "POD"}
PACK_CATEGORIES = {"PACKAGING"}


class PurchaseOrderReceiptService:

    OVER_RECEIPT_TOLERANCE = Decimal("1.05")  # 5%

    @classmethod
    def _resolve_default_location(cls, plant) -> InventoryLocation:
        loc = (
            InventoryLocation.objects.filter(
                plant=plant, type__in=["WAREHOUSE", "RM", "QC", "WIP"]
            )
            .order_by("type", "name")
            .first()
        )
        if not loc:
            loc = InventoryLocation.objects.filter(plant=plant).first()
        if not loc:
            raise ValidationError(f"No InventoryLocation configured for plant {plant}")
        return loc

    @classmethod
    @transaction.atomic
    def create(
        cls,
        *,
        po: PurchaseOrder,
        user,
        lines_data: list,
        vendor_invoice_no: str = "",
        vendor_invoice_date=None,
        vehicle_no: str = "",
        driver_name: str = "",
        lr_no: str = "",
        notes: str = "",
        quality_status: str = "PENDING",
        location: InventoryLocation = None,
        client_token: str = "",
    ) -> PurchaseOrderReceipt:
        po = PurchaseOrder.objects.select_for_update().get(pk=po.pk)
        client_token = str(client_token or "").strip()[:64]
        if client_token:
            existing = PurchaseOrderReceipt.objects.filter(
                purchase_order=po, client_token=client_token
            ).first()
            if existing:
                existing._idempotent_replay = True
                return existing
        if po.status not in {"SENT", "ACK", "PARTIAL"}:
            raise ValidationError(f"Cannot receive against {po.status} PO")
        if not lines_data:
            raise ValidationError("At least one line required")

        # Vendor-level dedup: same vendor cannot raise two receipts (across POs) with
        # the same invoice number. The model's unique constraint is scoped to a PO;
        # this guards the multi-PO case as well.
        inv_no = (vendor_invoice_no or "").strip()
        if inv_no:
            lock_key = int.from_bytes(hashlib.sha256(f"vendor-invoice:{po.vendor_id}:{inv_no}".encode()).digest()[:8], "big", signed=True)
            with connection.cursor() as cursor:
                cursor.execute("SELECT pg_advisory_xact_lock(%s)", [lock_key])
            if PurchaseOrderReceipt.objects.filter(
                purchase_order__vendor=po.vendor,
                vendor_invoice_no=inv_no,
            ).exists():
                raise ValidationError(
                    f"Duplicate vendor invoice '{inv_no}' for vendor {po.vendor.code}."
                )

        receipt = PurchaseOrderReceipt.objects.create(
            purchase_order=po,
            plant=po.plant,
            received_at=timezone.now(),
            vendor_invoice_no=inv_no,
            vendor_invoice_date=vendor_invoice_date,
            vehicle_no=vehicle_no or "",
            driver_name=driver_name or "",
            lr_no=lr_no or "",
            notes=notes or "",
            quality_status=quality_status or "PENDING",
            client_token=client_token,
            received_by=user if (user and getattr(user, "is_authenticated", True)) else None,
        )

        # Lock and post in material order across all receipts, regardless of
        # the user's line-selection order. Shared stock rows cannot be acquired
        # A->B in one receipt and B->A in another.
        item_ids = [ld.get('po_item_id') for ld in lines_data]
        if any(not item_id for item_id in item_ids):
            raise ValidationError('po_item_id is required on each receipt line.')
        items = {str(item.pk): item for item in po.items.select_related('material')
                 .select_for_update(of=('self',)).filter(pk__in=item_ids).order_by('material_id', 'id')}
        if any(str(item_id) not in items for item_id in item_ids):
            raise ValidationError('Every receipt line must belong to this purchase order.')
        ordered_lines = sorted(lines_data, key=lambda ld: (str(items[str(ld['po_item_id'])].material_id), str(ld['po_item_id'])))
        for ld in ordered_lines:
            po_item_id = ld.get("po_item_id")
            if not po_item_id:
                raise ValidationError("po_item_id is required on each receipt line.")
            qty = Decimal(str(ld.get("qty_received") or "0"))
            if qty <= 0:
                continue

            it = items[str(po_item_id)]
            if it.is_closed:
                raise ValidationError(
                    f"Line {it.line_no} is already closed; cannot receive against it."
                )

            ordered = it.qty_ordered or Decimal("0")
            already = it.qty_received or Decimal("0")
            remaining = ordered - already
            if remaining <= 0:
                raise ValidationError(
                    f"Line {it.line_no}: no open quantity remains to receive."
                )
            tolerance_cap = remaining * cls.OVER_RECEIPT_TOLERANCE
            if qty > tolerance_cap:
                raise ValidationError(
                    f"Line {it.line_no}: over-receipt > 5% tolerance "
                    f"(allowed {tolerance_cap}, attempted {qty})"
                )

            rate = Decimal(str(ld.get("rate") or it.rate_per_uom or "0"))
            line_loc = location or cls._resolve_default_location(po.plant)

            rl = PurchaseOrderReceiptLine.objects.create(
                receipt=receipt,
                po_item=it,
                qty_received=qty,
                rate=rate,
                notes=ld.get("notes", "") or "",
                rejection_reason=ld.get("rejection_reason", "") or "",
            )

            mat = it.material
            reference = (
                f"PO:{po.code} | VENDOR:{po.vendor.code} | INV:{vendor_invoice_no or '-'}"
            )

            # CALL EXISTING SERVICES — single source of truth
            if mat.category in ROLL_CATEGORIES:
                width = ld.get("width_mm") or it.expected_width_mm or Decimal("0")
                thickness = (
                    ld.get("thickness_micron")
                    or it.expected_thickness_micron
                    or Decimal("0")
                )
                if Decimal(str(width)) <= 0 or Decimal(str(thickness)) <= 0:
                    raise ValidationError(
                        f"Roll receipt for line {it.line_no} needs width_mm and thickness_micron."
                    )
                roll = RollService.create_roll(
                    material=mat,
                    weight_kg=qty,
                    location=line_loc,
                    width_mm=Decimal(str(width)),
                    thickness_micron=Decimal(str(thickness)),
                    batch_no=vendor_invoice_no or None,
                    plant=po.plant,
                    user=user if (user and getattr(user, "is_authenticated", True)) else None,
                    notes=reference,
                )
                rl.roll_id = roll.id
            elif mat.category in PACK_CATEGORIES:
                # PO receipt header carries the unique invoice; individual line
                # PackagingTransactions only stamp vendor FK (no invoice_no) so
                # the BulkTransaction/PackagingTransaction partial-unique doesn't
                # collide across the multiple lines of a single receipt.
                tx = PackagingService.add_packaging_stock(
                    material_id=str(mat.id),
                    qty=qty,
                    location_id=str(line_loc.id),
                    cost=rate,
                    vendor_id=str(po.vendor.id),
                    reference=reference,
                )
                rl.packaging_tx_id = getattr(tx, "id", None)
            elif mat.category in BULK_CATEGORIES:
                tx = BulkService.add_bulk(
                    material_id=str(mat.id),
                    qty=qty,
                    plant_id=str(po.plant.id),
                    location_id=str(line_loc.id),
                    cost=rate,
                    reference=reference,
                    tx_type="INWARD",
                    vendor_id=str(po.vendor.id),
                    # vendor_invoice_no intentionally left blank; PO receipt
                    # header is the source of truth for invoice dedup here.
                    qty_uom=getattr(mat, "base_uom", None),
                )
                rl.bulk_tx_id = getattr(tx, "id", None)
            else:
                raise ValidationError(
                    f"Material category {mat.category} not supported for PO receipt."
                )

            rl.save(update_fields=["bulk_tx_id", "roll_id", "packaging_tx_id"])

            it.qty_received = already + qty
            it.save(update_fields=["qty_received"])

        PurchaseOrderService._recompute_status(po, user, note=f"receipt {receipt.code}")
        return receipt
