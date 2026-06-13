"""Service for direct vendor receipts of TradingGood items.

Mirrors PurchaseOrderReceiptService for the no-PO case where the company
purchases a ready trading good (e.g., ready-made pouches) directly from a
vendor. Credits TradingGoodStock with weighted-average cost.
"""

from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from apps.procurement.models import TradingGoodReceipt


class TradingGoodReceiptService:
    @classmethod
    @transaction.atomic
    def create(
        cls,
        *,
        trading_good,
        vendor,
        plant,
        qty,
        rate,
        gst_pct=None,
        vendor_invoice_no: str = "",
        vendor_invoice_date=None,
        vehicle_no: str = "",
        driver_name: str = "",
        lr_no: str = "",
        notes: str = "",
        user=None,
    ) -> TradingGoodReceipt:
        if trading_good is None:
            raise ValidationError("Trading good is required.")
        if vendor is None:
            raise ValidationError("Vendor is required.")
        if plant is None:
            raise ValidationError("Plant is required.")

        qty = Decimal(str(qty or "0"))
        rate = Decimal(str(rate or "0"))
        if gst_pct is None:
            gst_pct = getattr(trading_good, "default_gst_pct", Decimal("0")) or Decimal("0")
        gst_pct = Decimal(str(gst_pct or "0"))
        if qty <= 0:
            raise ValidationError("Quantity must be positive.")
        if rate < 0:
            raise ValidationError("Rate cannot be negative.")
        if gst_pct < 0:
            raise ValidationError("GST percent cannot be negative.")
        line_subtotal = qty * rate
        line_gst = line_subtotal * gst_pct / Decimal("100")
        line_total = line_subtotal + line_gst

        inv_no = (vendor_invoice_no or "").strip()
        if inv_no and TradingGoodReceipt.objects.filter(
            vendor=vendor, vendor_invoice_no=inv_no
        ).exists():
            raise ValidationError(
                f"Duplicate vendor invoice '{inv_no}' for vendor {vendor.code}."
            )

        receipt = TradingGoodReceipt.objects.create(
            trading_good=trading_good,
            vendor=vendor,
            plant=plant,
            qty_received=qty,
            rate=rate,
            gst_pct=gst_pct,
            line_subtotal=line_subtotal,
            line_gst=line_gst,
            line_total=line_total,
            vendor_invoice_no=inv_no,
            vendor_invoice_date=vendor_invoice_date,
            vehicle_no=vehicle_no or "",
            driver_name=driver_name or "",
            lr_no=lr_no or "",
            notes=notes or "",
            received_at=timezone.now(),
            received_by=user if (user and getattr(user, "is_authenticated", True)) else None,
        )

        # Credit TradingGoodStock atomically with weighted-average cost.
        from apps.materials.models import TradingGoodStock

        stock, _ = TradingGoodStock.objects.select_for_update().get_or_create(
            trading_good=trading_good,
            plant=plant,
            defaults={"qty": Decimal("0"), "avg_cost": rate},
        )
        existing_qty = stock.qty or Decimal("0")
        existing_cost = stock.avg_cost or Decimal("0")
        new_qty = existing_qty + qty
        if new_qty > 0:
            stock.avg_cost = (
                (existing_qty * existing_cost) + (qty * rate)
            ) / new_qty
        stock.qty = new_qty
        stock.save(update_fields=["qty", "avg_cost", "updated_at"])

        return receipt
