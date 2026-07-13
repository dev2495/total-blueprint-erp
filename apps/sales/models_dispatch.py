"""CustomerDispatch — Sprint 2 lifecycle closure for SalesOrder.

A CustomerDispatch is a single shipment of one or more SO lines to the customer.
Confirming a dispatch increments the dispatched-qty roll-up on the SO items; once
all items are fully dispatched, ``SalesOrderService.try_complete`` flips the SO
to COMPLETED.

Status flow:
    DRAFT → CONFIRMED → DISPATCHED
    DRAFT → CANCELLED
    CONFIRMED → CANCELLED

The only state that contributes to qty_dispatched is CONFIRMED or DISPATCHED.
"""

from __future__ import annotations

import re
import logging
import uuid
from decimal import Decimal

from django.db import models
from django.utils import timezone

logger = logging.getLogger(__name__)


class CustomerDispatch(models.Model):
    STATUS_CHOICES = [
        ("DRAFT", "Draft"),
        ("CONFIRMED", "Confirmed"),
        ("DISPATCHED", "Dispatched"),
        ("CANCELLED", "Cancelled"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=24, unique=True, db_index=True, blank=True)
    sales_order = models.ForeignKey(
        "sales.SalesOrder",
        on_delete=models.PROTECT,
        related_name="customer_dispatches",
    )
    plant = models.ForeignKey(
        "factory.Plant",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="customer_dispatches",
    )
    customer = models.ForeignKey(
        "sales.Customer",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="customer_dispatches",
    )
    dispatch_date = models.DateField(default=timezone.now)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="DRAFT", db_index=True)
    vehicle_no = models.CharField(max_length=40, blank=True, default="")
    driver_name = models.CharField(max_length=80, blank=True, default="")
    lr_no = models.CharField(max_length=40, blank=True, default="")
    invoice_no = models.CharField(max_length=40, blank=True, default="")
    notes = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)
    dispatched_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="customer_dispatches_created",
    )

    class Meta:
        db_table = "sales_customer_dispatch"
        ordering = ["-dispatch_date", "-created_at"]
        verbose_name = "Customer dispatch"
        verbose_name_plural = "Customer dispatches"

    def __str__(self):
        return f"{self.code or self.id} ({self.status})"

    # ------------------------------------------------------------------
    # Code generation: CD-YYYY-NNNN
    # ------------------------------------------------------------------
    @classmethod
    def next_code(cls, *, now=None):
        year = (now or timezone.now()).year
        prefix = f"CD-{year}-"
        pattern = re.compile(rf"^{re.escape(prefix)}(\d+)$")
        max_seq = 0
        for value in cls.objects.filter(code__startswith=prefix).values_list("code", flat=True):
            m = pattern.match(str(value or ""))
            if m:
                try:
                    max_seq = max(max_seq, int(m.group(1)))
                except ValueError:
                    continue
        return f"{prefix}{max_seq + 1:04d}"

    def save(self, *args, **kwargs):
        if not self.code:
            self.code = self.next_code()
        # Auto-fill customer from SO if missing.
        if self.sales_order_id and not self.customer_id:
            try:
                self.customer_id = self.sales_order.customer_id
            except Exception:
                logger.warning("Unable to auto-fill dispatch customer from sales order=%s", getattr(self, "sales_order_id", None), exc_info=True)
        super().save(*args, **kwargs)


class CustomerDispatchLine(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    dispatch = models.ForeignKey(
        CustomerDispatch,
        on_delete=models.CASCADE,
        related_name="lines",
    )
    sales_order_item = models.ForeignKey(
        "sales.SalesOrderItem",
        on_delete=models.PROTECT,
        related_name="dispatch_lines",
    )
    qty_dispatched = models.DecimalField(max_digits=14, decimal_places=3, default=Decimal("0"))
    uom = models.CharField(max_length=12, default="KG")
    notes = models.CharField(max_length=255, blank=True, default="")

    class Meta:
        db_table = "sales_customer_dispatch_line"
        ordering = ["id"]

    def __str__(self):
        return f"{self.dispatch.code} :: {self.sales_order_item_id} ({self.qty_dispatched})"
