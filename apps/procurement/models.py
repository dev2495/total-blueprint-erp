"""
Procurement app models (Phase 70).

Adds PurchaseOrder + receipts on top of existing inventory/vendor masters.
No existing tables touched. Stock posting from receipts is delegated to the
existing inventory services (BulkService / RollService / PackagingService).
"""

import uuid
from decimal import Decimal

from django.db import models
from django.utils import timezone


def gen_code(prefix: str, model_cls) -> str:
    """Yearly-sequential code, e.g. PO-2026-0001."""
    year = timezone.now().year
    last = (
        model_cls.objects.filter(code__startswith=f"{prefix}-{year}-")
        .order_by("-code")
        .first()
    )
    if last:
        try:
            seq = int(str(last.code).split("-")[-1]) + 1
        except Exception:
            seq = 1
    else:
        seq = 1
    return f"{prefix}-{year}-{seq:04d}"


class PurchaseOrder(models.Model):
    STATUS_CHOICES = [
        ("DRAFT", "Draft"),
        ("SENT", "Sent"),
        ("ACK", "Acknowledged"),
        ("PARTIAL", "Partially Received"),
        ("COMPLETED", "Completed"),
        ("CANCELLED", "Cancelled"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=24, unique=True, db_index=True)

    vendor = models.ForeignKey(
        "inventory.Vendor",
        on_delete=models.PROTECT,
        related_name="purchase_orders",
    )
    plant = models.ForeignKey(
        "factory.Plant",
        on_delete=models.PROTECT,
        related_name="purchase_orders",
    )

    order_date = models.DateField(default=timezone.now)
    expected_delivery_date = models.DateField(null=True, blank=True)

    status = models.CharField(
        max_length=12, choices=STATUS_CHOICES, default="DRAFT", db_index=True
    )

    currency = models.CharField(max_length=8, default="INR")
    payment_terms = models.CharField(max_length=120, blank=True, default="")
    freight_terms = models.CharField(max_length=120, blank=True, default="")
    delivery_address = models.TextField(blank=True, default="")
    notes = models.TextField(blank=True, default="")

    source_mrp_suggestion = models.ForeignKey(
        "mrp.MRPSuggestion",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="purchase_orders",
    )

    subtotal = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))
    gst_total = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))
    freight_amount = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))
    grand_total = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))

    sent_at = models.DateTimeField(null=True, blank=True)
    sent_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="purchase_orders_sent",
    )
    acknowledged_at = models.DateTimeField(null=True, blank=True)
    ack_ref = models.CharField(max_length=80, blank=True, default="")
    completed_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancelled_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="purchase_orders_cancelled",
    )
    cancel_reason = models.TextField(blank=True, default="")

    status_history = models.JSONField(default=list, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="purchase_orders_created",
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "procurement_purchase_order"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.code} · {self.vendor.name}"

    def save(self, *args, **kwargs):
        if not self.code:
            self.code = gen_code("PO", PurchaseOrder)
        super().save(*args, **kwargs)

    @property
    def open_qty_total(self) -> Decimal:
        total = Decimal("0")
        for it in self.items.all():
            if it.is_closed:
                continue
            total += max((it.qty_ordered or Decimal("0")) - (it.qty_received or Decimal("0")), Decimal("0"))
        return total


class PurchaseOrderItem(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    purchase_order = models.ForeignKey(
        PurchaseOrder, on_delete=models.CASCADE, related_name="items"
    )
    line_no = models.PositiveIntegerField(default=1)
    material = models.ForeignKey(
        "materials.InventoryMaterial",
        on_delete=models.PROTECT,
        related_name="po_items",
    )
    description = models.CharField(max_length=255, blank=True, default="")
    qty_ordered = models.DecimalField(max_digits=14, decimal_places=3, default=Decimal("0"))
    uom = models.CharField(max_length=12, default="KG")
    rate_per_uom = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))
    gst_pct = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("18"))
    line_subtotal = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))
    line_gst = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))
    line_total = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))
    expected_delivery_date = models.DateField(null=True, blank=True)

    qty_received = models.DecimalField(max_digits=14, decimal_places=3, default=Decimal("0"))
    is_closed = models.BooleanField(default=False)  # short-closed manually
    close_reason = models.TextField(blank=True, default="")

    # Roll-specific hint (optional)
    expected_width_mm = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    expected_thickness_micron = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)

    class Meta:
        db_table = "procurement_purchase_order_item"
        ordering = ["line_no", "id"]

    @property
    def qty_open(self) -> Decimal:
        if self.is_closed:
            return Decimal("0")
        return max((self.qty_ordered or Decimal("0")) - (self.qty_received or Decimal("0")), Decimal("0"))

    @property
    def progress_pct(self) -> float:
        if not self.qty_ordered:
            return 0.0
        return min(round(float(self.qty_received or 0) / float(self.qty_ordered) * 100, 1), 100.0)


class PurchaseOrderReceipt(models.Model):
    """GRN header against a PO. One header can cover multiple PO lines."""

    QUALITY_CHOICES = [
        ("PENDING", "Pending"),
        ("APPROVED", "Approved"),
        ("REJECTED", "Rejected"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=24, unique=True, db_index=True)
    purchase_order = models.ForeignKey(
        PurchaseOrder, on_delete=models.PROTECT, related_name="receipts"
    )
    plant = models.ForeignKey(
        "factory.Plant", on_delete=models.PROTECT, related_name="po_receipts"
    )
    received_at = models.DateTimeField(default=timezone.now)

    vendor_invoice_no = models.CharField(max_length=60, blank=True, default="")
    vendor_invoice_date = models.DateField(null=True, blank=True)
    vehicle_no = models.CharField(max_length=40, blank=True, default="")
    driver_name = models.CharField(max_length=80, blank=True, default="")
    lr_no = models.CharField(max_length=40, blank=True, default="")

    quality_status = models.CharField(
        max_length=12, choices=QUALITY_CHOICES, default="PENDING"
    )
    notes = models.TextField(blank=True, default="")

    received_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="po_receipts_received",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "procurement_po_receipt"
        ordering = ["-received_at"]

    def save(self, *args, **kwargs):
        if not self.code:
            self.code = gen_code("PORG", PurchaseOrderReceipt)
        super().save(*args, **kwargs)


class PurchaseOrderReceiptLine(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    receipt = models.ForeignKey(
        PurchaseOrderReceipt, on_delete=models.CASCADE, related_name="lines"
    )
    po_item = models.ForeignKey(
        PurchaseOrderItem, on_delete=models.PROTECT, related_name="receipt_lines"
    )
    qty_received = models.DecimalField(max_digits=14, decimal_places=3, default=Decimal("0"))
    rate = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))
    notes = models.CharField(max_length=255, blank=True, default="")
    rejection_reason = models.CharField(max_length=255, blank=True, default="")

    # Linkage to actual stock entries created via existing services
    bulk_tx_id = models.UUIDField(null=True, blank=True)  # BulkTransaction.id
    roll_id = models.UUIDField(null=True, blank=True)  # InventoryRoll.id
    packaging_tx_id = models.UUIDField(null=True, blank=True)  # PackagingTransaction.id

    class Meta:
        db_table = "procurement_po_receipt_line"
