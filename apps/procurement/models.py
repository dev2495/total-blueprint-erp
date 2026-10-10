"""
Procurement app models (Phase 70).

Adds PurchaseOrder + receipts on top of existing inventory/vendor masters.
No existing tables touched. Stock posting from receipts is delegated to the
existing inventory services (BulkService / RollService / PackagingService).
"""

import uuid
import hashlib
from decimal import Decimal

from django.db import models, transaction, connections, router
from django.conf import settings
from django.db.models import Q
from django.db.models.functions import Length
from django.utils import timezone


def gen_code(prefix: str, model_cls, using="default") -> str:
    """Yearly-sequential code, e.g. PO-2026-0001."""
    year = timezone.now().year
    # Hold the namespace lock through INSERT (save() opens the transaction).
    db = connections[using]
    if db.vendor == "postgresql":
        key = int.from_bytes(hashlib.sha256(f"procurement:{prefix}:{year}".encode()).digest()[:8], "big", signed=True)
        with db.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(%s)", [key])
    last = (
        model_cls.objects.using(using).filter(code__startswith=f"{prefix}-{year}-")
        .order_by(Length("code").desc(), "-code")
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
        if self.code:
            return super().save(*args, **kwargs)
        using = kwargs.get("using") or router.db_for_write(type(self), instance=self)
        with transaction.atomic(using=using):
            self.code = gen_code("PO", PurchaseOrder, using=using)
            return super().save(*args, **kwargs)

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

    # Idempotency: optional client-supplied token to defeat double-submits from the UI.
    client_token = models.CharField(max_length=64, blank=True, default="", db_index=True)

    class Meta:
        db_table = "procurement_po_receipt"
        ordering = ["-received_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["purchase_order", "vendor_invoice_no"],
                condition=models.Q(vendor_invoice_no__gt=""),
                name="uniq_po_vendor_invoice",
            ),
            models.UniqueConstraint(
                fields=["purchase_order", "client_token"],
                condition=models.Q(client_token__gt=""),
                name="uniq_po_client_token",
            ),
        ]

    def save(self, *args, **kwargs):
        if self.code:
            return super().save(*args, **kwargs)
        using = kwargs.get("using") or router.db_for_write(type(self), instance=self)
        with transaction.atomic(using=using):
            self.code = gen_code("PORG", PurchaseOrderReceipt, using=using)
            return super().save(*args, **kwargs)


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


class TradingGoodReceipt(models.Model):
    """Direct vendor receipt for a TradingGood (no PO required).

    Credits TradingGoodStock with weighted-average cost. Partial unique
    constraint by vendor + vendor_invoice_no prevents duplicate invoices.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=24, unique=True, db_index=True)
    trading_good = models.ForeignKey(
        "materials.TradingGood", on_delete=models.PROTECT, related_name="receipts"
    )
    vendor = models.ForeignKey(
        "inventory.Vendor", on_delete=models.PROTECT, related_name="trading_good_receipts"
    )
    plant = models.ForeignKey(
        "factory.Plant", on_delete=models.PROTECT, related_name="trading_good_receipts"
    )
    qty_received = models.DecimalField(max_digits=14, decimal_places=3)
    rate = models.DecimalField(max_digits=14, decimal_places=2)
    gst_pct = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("0.00"))
    line_subtotal = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0.00"))
    line_gst = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0.00"))
    line_total = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0.00"))

    vendor_invoice_no = models.CharField(max_length=80, blank=True, default="", db_index=True)
    vendor_invoice_date = models.DateField(null=True, blank=True)
    manual_po_ref = models.CharField(
        max_length=80,
        blank=True,
        default="",
        db_index=True,
        help_text="Vendor's PO ref when receiving against a PO not in our system.",
    )
    vehicle_no = models.CharField(max_length=40, blank=True, default="")
    driver_name = models.CharField(max_length=80, blank=True, default="")
    lr_no = models.CharField(max_length=40, blank=True, default="")
    notes = models.TextField(blank=True, default="")

    received_at = models.DateTimeField(default=timezone.now)
    received_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="trading_good_receipts",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "procurement_trading_good_receipt"
        ordering = ["-received_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["vendor", "vendor_invoice_no"],
                condition=models.Q(vendor_invoice_no__gt=""),
                name="uniq_tgr_vendor_invoice",
            ),
        ]

    def save(self, *args, **kwargs):
        if self.code:
            return super().save(*args, **kwargs)
        using = kwargs.get("using") or router.db_for_write(type(self), instance=self)
        with transaction.atomic(using=using):
            self.code = gen_code("TGR", TradingGoodReceipt, using=using)
            return super().save(*args, **kwargs)


GENERAL_RECEIPT_TYPES = [("GOODS", "Goods received"), ("SERVICE", "Service / work done")]
GENERAL_LINE_CATEGORIES = [
    ("SPARES", "Spares and parts"),
    ("MACHINERY", "Machinery / equipment"),
    ("TOOLS", "Tools"),
    ("CONSUMABLE", "General consumable"),
    ("SAFETY", "Safety items"),
    ("ELECTRICAL", "Electrical"),
    ("CIVIL", "Civil / building"),
    ("OFFICE", "Office / admin"),
    ("SERVICE", "Service / labour"),
    ("CHARGE", "Freight / other charge"),
]
GENERAL_LINE_DISPOSITIONS = [
    ("KEPT_IN_STORE", "Kept in store"),
    ("INSTALLED", "Installed / fitted"),
    ("CONSUMED", "Used immediately"),
    ("NOT_APPLICABLE", "Not applicable"),
]
GENERAL_UOMS = ["NOS", "PCS", "SET", "PAIR", "KG", "LTR", "MTR", "BOX", "ROLL", "JOB", "HRS", "VISIT", "LOT"]


class GeneralReceipt(models.Model):
    """Receipt of non-stock goods or acceptance of a service against a bill.

    Records who received/confirmed what and when. It never posts production
    stock; inventory balances stay owned by the stock GRN services.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    number = models.CharField(max_length=32, unique=True)
    plant = models.ForeignKey("factory.Plant", on_delete=models.PROTECT, related_name="general_receipts")
    document = models.ForeignKey("gate.InwardBillIntake", on_delete=models.PROTECT, null=True, blank=True, related_name="general_receipts")
    vendor = models.ForeignKey("inventory.Vendor", on_delete=models.PROTECT, null=True, blank=True, related_name="general_receipts")
    party_name = models.CharField(max_length=255)
    invoice_number = models.CharField(max_length=80, blank=True, default="")
    invoice_date = models.DateField(null=True, blank=True)
    receipt_type = models.CharField(max_length=8, choices=GENERAL_RECEIPT_TYPES)
    received_at = models.DateTimeField()
    received_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="general_receipts_received")
    reference = models.CharField(max_length=80, blank=True, default="")
    notes = models.CharField(max_length=1000, blank=True, default="")
    status = models.CharField(max_length=10, choices=[("POSTED", "Posted"), ("REVERSED", "Reversed")], default="POSTED")
    reversed_at = models.DateTimeField(null=True, blank=True)
    reversed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="general_receipts_reversed")
    reversal_reason = models.CharField(max_length=500, blank=True, default="")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="general_receipts_created")
    created_at = models.DateTimeField(auto_now_add=True)
    request_key = models.CharField(max_length=128, unique=True, null=True, blank=True, editable=False)
    request_fingerprint = models.CharField(max_length=64, blank=True, default="", editable=False)

    class Meta:
        ordering = ["-received_at", "-id"]
        indexes = [
            models.Index(fields=["plant", "received_at"], name="general_receipt_plant_idx"),
            models.Index(fields=["vendor", "received_at"], name="general_receipt_vendor_idx"),
        ]
        constraints = [models.CheckConstraint(condition=Q(status="POSTED") | Q(reversed_at__isnull=False), name="general_receipt_reversal_timestamp")]


class GeneralReceiptLine(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    receipt = models.ForeignKey(GeneralReceipt, on_delete=models.PROTECT, related_name="lines")
    line_no = models.PositiveSmallIntegerField()
    line_category = models.CharField(max_length=12, choices=GENERAL_LINE_CATEGORIES)
    description = models.CharField(max_length=255)
    quantity = models.DecimalField(max_digits=14, decimal_places=3)
    uom = models.CharField(max_length=8)
    rate = models.DecimalField(max_digits=14, decimal_places=4, null=True, blank=True)
    amount = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    gst_rate = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    disposition = models.CharField(max_length=16, choices=GENERAL_LINE_DISPOSITIONS, default="NOT_APPLICABLE")
    machine = models.ForeignKey("factory.Machine", on_delete=models.PROTECT, null=True, blank=True, related_name="general_receipt_lines")
    equipment_text = models.CharField(max_length=160, blank=True, default="")
    serial_no = models.CharField(max_length=80, blank=True, default="")
    gate_pass_line = models.ForeignKey("gate.GatePassLine", on_delete=models.PROTECT, null=True, blank=True, related_name="general_receipt_lines")
    remarks = models.CharField(max_length=255, blank=True, default="")

    class Meta:
        ordering = ["line_no"]
        indexes = [models.Index(fields=["machine"], name="general_line_machine_idx")]
        constraints = [
            models.UniqueConstraint(fields=["receipt", "line_no"], name="general_receipt_line_unique"),
            models.CheckConstraint(condition=Q(quantity__gt=0), name="general_line_qty_positive"),
            models.CheckConstraint(condition=Q(amount__isnull=True) | Q(amount__gte=0), name="general_line_amount_nonnegative"),
        ]
