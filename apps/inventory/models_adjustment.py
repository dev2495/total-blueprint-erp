"""
Stock Adjustment models — unified audit trail for adjustments across
InventoryBulk, InventoryRoll, PackagingStock, and TradingGoodStock pools.
"""
import uuid
from decimal import Decimal

from django.db import models


class StockAdjustment(models.Model):
    STATUS_CHOICES = [
        ("DRAFT", "Draft"),
        ("POSTED", "Posted"),
        ("VOID", "Voided"),
    ]
    REASON_CHOICES = [
        ("DAMAGE", "Damaged / spoiled"),
        ("WRITE_OFF", "Write-off"),
        ("FOUND", "Found / unaccounted"),
        ("COUNT_CORRECTION", "Count correction"),
        ("RECLASSIFY", "Reclassification"),
        ("OTHER", "Other"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=40, unique=True, db_index=True)
    plant = models.ForeignKey(
        "factory.Plant",
        on_delete=models.PROTECT,
        related_name="stock_adjustments",
    )
    reason = models.CharField(max_length=24, choices=REASON_CHOICES, default="OTHER")
    status = models.CharField(
        max_length=12, choices=STATUS_CHOICES, default="DRAFT", db_index=True
    )
    notes = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_stock_adjustments",
    )
    posted_at = models.DateTimeField(null=True, blank=True)
    posted_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="posted_stock_adjustments",
    )

    class Meta:
        db_table = "inventory_stock_adjustment"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.code} [{self.status}]"


class StockAdjustmentLine(models.Model):
    STOCK_CLASS_CHOICES = [
        ("BULK", "Bulk"),
        ("ROLL", "Roll"),
        ("PACKAGING", "Packaging"),
        ("TRADING_GOOD", "Trading Good"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    adjustment = models.ForeignKey(
        StockAdjustment, on_delete=models.CASCADE, related_name="lines"
    )
    line_no = models.PositiveIntegerField(default=1)
    stock_class = models.CharField(max_length=16, choices=STOCK_CLASS_CHOICES)
    inventory_material = models.ForeignKey(
        "materials.InventoryMaterial",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
    )
    trading_good = models.ForeignKey(
        "materials.TradingGood",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
    )
    location = models.ForeignKey(
        "inventory.InventoryLocation",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
    )
    inventory_roll = models.ForeignKey(
        "inventory.InventoryRoll",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        help_text="Specific roll being adjusted (ROLL class only)",
    )
    before_qty = models.DecimalField(max_digits=14, decimal_places=3, default=Decimal("0"))
    delta_qty = models.DecimalField(max_digits=14, decimal_places=3, default=Decimal("0"))
    after_qty = models.DecimalField(max_digits=14, decimal_places=3, default=Decimal("0"))
    uom = models.CharField(max_length=10, default="KG")
    value_inr = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))
    notes = models.CharField(max_length=255, blank=True, default="")

    class Meta:
        db_table = "inventory_stock_adjustment_line"
        ordering = ["line_no", "id"]

    def __str__(self):
        return f"{self.adjustment.code} #{self.line_no} {self.stock_class}"
