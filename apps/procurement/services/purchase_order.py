"""
Purchase Order service: status transitions, totals recompute, history audit.
"""

from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from apps.procurement.models import PurchaseOrder


class PurchaseOrderService:

    @classmethod
    @transaction.atomic
    def recalc_totals(cls, po: PurchaseOrder) -> PurchaseOrder:
        sub = Decimal("0")
        gst = Decimal("0")
        for it in po.items.select_for_update():
            it.line_subtotal = (it.qty_ordered or Decimal("0")) * (
                it.rate_per_uom or Decimal("0")
            )
            it.line_gst = it.line_subtotal * (it.gst_pct or Decimal("0")) / Decimal("100")
            it.line_total = it.line_subtotal + it.line_gst
            it.save(update_fields=["line_subtotal", "line_gst", "line_total"])
            sub += it.line_subtotal
            gst += it.line_gst
        po.subtotal = sub
        po.gst_total = gst
        po.grand_total = sub + gst + (po.freight_amount or Decimal("0"))
        po.save(update_fields=["subtotal", "gst_total", "grand_total", "updated_at"])
        return po

    @classmethod
    def _append_history(cls, po, status, user=None, note=""):
        history = list(po.status_history or [])
        history.append(
            {
                "status": status,
                "at": timezone.now().isoformat(),
                "by_id": str(getattr(user, "id", "")) if user else None,
                "by_name": getattr(user, "full_name", "") or getattr(user, "username", "") if user else "",
                "note": note,
            }
        )
        po.status_history = history

    @classmethod
    @transaction.atomic
    def send(cls, po: PurchaseOrder, user, channel: str = "pdf_only") -> PurchaseOrder:
        po = PurchaseOrder.objects.select_for_update().get(pk=po.pk)
        if po.status != "DRAFT":
            raise ValidationError(
                f"Only DRAFT POs can be sent (current: {po.status})"
            )
        if not po.items.exists():
            raise ValidationError("Cannot send an empty PO")
        po.status = "SENT"
        po.sent_at = timezone.now()
        po.sent_by = user if (user and getattr(user, "is_authenticated", True)) else None
        cls._append_history(po, "SENT", user, note=f"channel={channel}")
        po.save()
        return po

    @classmethod
    @transaction.atomic
    def acknowledge(cls, po, user, ack_ref, ack_date=None) -> PurchaseOrder:
        po = PurchaseOrder.objects.select_for_update().get(pk=po.pk)
        if po.status not in {"SENT", "DRAFT"}:
            raise ValidationError(f"Cannot acknowledge in status {po.status}")
        po.status = "ACK"
        po.ack_ref = ack_ref or ""
        po.acknowledged_at = ack_date or timezone.now()
        cls._append_history(po, "ACK", user, note=f"ack_ref={ack_ref}")
        po.save()
        return po

    @classmethod
    @transaction.atomic
    def cancel(cls, po, user, reason="") -> PurchaseOrder:
        po = PurchaseOrder.objects.select_for_update().get(pk=po.pk)
        if po.status in {"COMPLETED", "CANCELLED"}:
            raise ValidationError(f"Cannot cancel a {po.status} PO")
        po.status = "CANCELLED"
        po.cancelled_at = timezone.now()
        po.cancelled_by = user if (user and getattr(user, "is_authenticated", True)) else None
        po.cancel_reason = reason or ""
        cls._append_history(po, "CANCELLED", user, note=reason)
        po.save()
        return po

    @classmethod
    @transaction.atomic
    def close_short(cls, po, user, line_id=None, reason="") -> PurchaseOrder:
        """Mark a line (or entire PO) as closed-short. Promotes to COMPLETED if all closed."""
        po = PurchaseOrder.objects.select_for_update().get(pk=po.pk)
        if line_id:
            it = po.items.select_for_update().get(pk=line_id)
            it.is_closed = True
            it.close_reason = reason
            it.save()
        else:
            for it in po.items.select_for_update().filter(is_closed=False):
                it.is_closed = True
                it.close_reason = reason
                it.save()
        cls._recompute_status(po, user, note=f"close_short {reason}")
        return po

    @classmethod
    def _recompute_status(cls, po, user=None, note=""):
        po.refresh_from_db()
        items = list(po.items.all())
        if not items:
            return
        any_received = any((it.qty_received or 0) > 0 for it in items)
        all_done = all(
            it.is_closed or (it.qty_received or 0) >= (it.qty_ordered or 0)
            for it in items
        )
        if all_done:
            po.status = "COMPLETED"
            po.completed_at = timezone.now()
            cls._append_history(po, "COMPLETED", user, note=note)
        elif any_received:
            po.status = "PARTIAL"
            cls._append_history(po, "PARTIAL", user, note=note)
        po.save()
