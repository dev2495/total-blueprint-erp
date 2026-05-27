"""
Vendor performance metrics computed from PurchaseOrder + Receipt history.
"""

from datetime import date
from decimal import Decimal

from django.db.models import Sum
from django.utils import timezone

from apps.procurement.models import (
    PurchaseOrder,
    PurchaseOrderReceipt,
    PurchaseOrderReceiptLine,
)


class VendorPerformanceService:

    @staticmethod
    def _fy_start(today: date) -> date:
        # Indian financial year starts 1 Apr.
        year = today.year if today.month >= 4 else today.year - 1
        return date(year, 4, 1)

    @classmethod
    def compute(cls, vendor) -> dict:
        today = timezone.now().date()
        fy_start = cls._fy_start(today)

        pos = PurchaseOrder.objects.filter(vendor=vendor)
        completed_fy = pos.filter(status="COMPLETED", completed_at__date__gte=fy_start)
        open_pos = pos.exclude(status__in=["COMPLETED", "CANCELLED"])

        receipts = PurchaseOrderReceipt.objects.filter(purchase_order__vendor=vendor)
        rec_lines = PurchaseOrderReceiptLine.objects.filter(
            receipt__purchase_order__vendor=vendor
        ).select_related("receipt", "po_item")

        total_lines = rec_lines.count()
        rejected = rec_lines.exclude(rejection_reason="").count()
        quality_reject_pct = (
            round((rejected / total_lines) * 100, 1) if total_lines else 0.0
        )

        on_time = 0
        late = 0
        delays = []
        for rl in rec_lines:
            expected = rl.po_item.expected_delivery_date
            if not expected:
                continue
            received_d = rl.receipt.received_at.date()
            if received_d <= expected:
                on_time += 1
            else:
                late += 1
                delays.append((received_d - expected).days)
        otd_total = on_time + late
        on_time_delivery_pct = (
            round((on_time / otd_total) * 100, 1) if otd_total else 0.0
        )
        avg_delay_days = round(sum(delays) / len(delays), 1) if delays else 0.0

        ytd_value = completed_fy.aggregate(total=Sum("grand_total"))["total"] or Decimal("0")
        open_value = open_pos.aggregate(total=Sum("grand_total"))["total"] or Decimal("0")

        return {
            "vendor_id": str(vendor.id),
            "vendor_name": vendor.name,
            "on_time_delivery_pct": on_time_delivery_pct,
            "quality_reject_pct": quality_reject_pct,
            "avg_delay_days": avg_delay_days,
            "ytd_value_inr": float(ytd_value),
            "open_po_value_inr": float(open_value),
            "total_pos": pos.count(),
            "completed_pos_fy": completed_fy.count(),
            "open_pos": open_pos.count(),
            "total_receipts": receipts.count(),
        }
