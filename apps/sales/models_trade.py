"""Trade Order models — resale flow, kept SEPARATE from manufacturing sales orders."""

import uuid
from decimal import Decimal

from django.db import models
from django.utils import timezone


class TradeOrder(models.Model):
    """A customer trade order — resells stock without invoking the production cycle."""

    STATUS_CHOICES = [
        ("DRAFT", "Draft"),
        ("CONFIRMED", "Confirmed"),
        ("DISPATCHED", "Dispatched"),
        ("INVOICED", "Invoiced"),
        ("CANCELLED", "Cancelled"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=40, unique=True, db_index=True)
    customer = models.ForeignKey(
        "sales.Customer", on_delete=models.PROTECT, related_name="trade_orders"
    )
    plant = models.ForeignKey(
        "factory.Plant",
        on_delete=models.PROTECT,
        related_name="trade_orders",
        null=True,
        blank=True,
    )
    order_date = models.DateField(default=timezone.localdate)
    status = models.CharField(
        max_length=20, choices=STATUS_CHOICES, default="DRAFT", db_index=True
    )
    notes = models.TextField(blank=True, default="")

    # Totals (computed on save via recompute_totals)
    subtotal = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))
    gst_total = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))
    grand_total = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))

    dispatched_at = models.DateTimeField(null=True, blank=True)
    invoice_no = models.CharField(max_length=60, blank=True, default="")

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_trade_orders",
    )

    class Meta:
        db_table = "sales_trade_order"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.code} · {self.customer.name if self.customer_id else '?'}"

    def recompute_totals(self, save=True):
        subtotal = Decimal("0")
        gst_total = Decimal("0")
        for item in self.items.all():
            line_sub = (item.qty or Decimal("0")) * (item.rate or Decimal("0"))
            line_gst = line_sub * (item.gst_pct or Decimal("0")) / Decimal("100")
            item.line_subtotal = line_sub
            item.line_gst = line_gst
            item.line_total = line_sub + line_gst
            item.save(update_fields=["line_subtotal", "line_gst", "line_total"])
            subtotal += line_sub
            gst_total += line_gst
        self.subtotal = subtotal
        self.gst_total = gst_total
        self.grand_total = subtotal + gst_total
        if save:
            self.save(update_fields=["subtotal", "gst_total", "grand_total", "updated_at"])


class TradeOrderItem(models.Model):
    """Individual line in a trade order. Either an InventoryMaterial (sellable
    granule/film variant) or a TradingGood master row."""

    ITEM_TYPE_CHOICES = [
        ("INVENTORY_MATERIAL", "Inventory Material"),
        ("TRADING_GOOD", "Trading Good"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    trade_order = models.ForeignKey(
        TradeOrder, on_delete=models.CASCADE, related_name="items"
    )
    line_no = models.PositiveIntegerField(default=1)
    item_type = models.CharField(max_length=20, choices=ITEM_TYPE_CHOICES)
    inventory_material = models.ForeignKey(
        "materials.InventoryMaterial",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="trade_order_items",
    )
    trading_good = models.ForeignKey(
        "materials.TradingGood",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="trade_order_items",
    )
    description = models.CharField(max_length=255, blank=True, default="")
    qty = models.DecimalField(max_digits=14, decimal_places=3, default=Decimal("0"))
    uom = models.CharField(max_length=10, default="PCS")
    rate = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))
    gst_pct = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("18.00"))
    line_subtotal = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))
    line_gst = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))
    line_total = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))

    class Meta:
        db_table = "sales_trade_order_item"
        ordering = ["line_no", "id"]

    def __str__(self):
        return f"{self.trade_order.code} #{self.line_no}"

    @property
    def display_name(self):
        if self.item_type == "TRADING_GOOD" and self.trading_good_id:
            return f"{self.trading_good.code} · {self.trading_good.name}"
        if self.item_type == "INVENTORY_MATERIAL" and self.inventory_material_id:
            return f"{self.inventory_material.code} · {self.inventory_material.name}"
        return self.description or "—"
