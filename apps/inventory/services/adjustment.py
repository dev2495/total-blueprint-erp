"""Unified Stock Adjustment service — applies adjustment lines to the
correct stock pool (BULK / ROLL / PACKAGING / TRADING_GOOD) atomically."""

from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from apps.inventory.models import (
    InventoryBulk,
    InventoryRoll,
    PackagingStock,
    StockAdjustment,
    StockAdjustmentLine,
)
from apps.materials.models import TradingGoodStock


def _generate_adj_code() -> str:
    """ADJ-{YYYY}-{NNNN} per-year sequence."""
    year = timezone.now().year
    prefix = f"ADJ-{year}-"
    last = (
        StockAdjustment.objects.filter(code__startswith=prefix)
        .order_by("-code")
        .values_list("code", flat=True)
        .first()
    )
    next_num = 1
    if last:
        try:
            next_num = int(last.split("-")[-1]) + 1
        except Exception:
            next_num = StockAdjustment.objects.filter(code__startswith=prefix).count() + 1
    return f"{prefix}{next_num:04d}"


class StockAdjustmentService:
    @classmethod
    @transaction.atomic
    def post(cls, *, adjustment: StockAdjustment, user=None) -> StockAdjustment:
        if adjustment.status != "DRAFT":
            raise ValidationError(f"Cannot post adjustment in status {adjustment.status}")
        for line in adjustment.lines.select_for_update().all():
            cls._apply_line(line)
        adjustment.status = "POSTED"
        adjustment.posted_at = timezone.now()
        adjustment.posted_by = user
        adjustment.save(update_fields=["status", "posted_at", "posted_by"])
        return adjustment

    @classmethod
    @transaction.atomic
    def void(cls, *, adjustment: StockAdjustment, user=None) -> StockAdjustment:
        if adjustment.status == "VOID":
            return adjustment
        if adjustment.status == "POSTED":
            # Reverse each line by applying inverse delta to the same stock pool.
            for line in adjustment.lines.select_for_update().all():
                inverse = StockAdjustmentLine(
                    adjustment=line.adjustment,
                    stock_class=line.stock_class,
                    inventory_material_id=line.inventory_material_id,
                    trading_good_id=line.trading_good_id,
                    location_id=line.location_id,
                    inventory_roll_id=line.inventory_roll_id,
                    delta_qty=-(line.delta_qty or Decimal("0")),
                    uom=line.uom,
                )
                cls._apply_line(inverse, persist=False)
        adjustment.status = "VOID"
        adjustment.save(update_fields=["status"])
        return adjustment

    @classmethod
    def _apply_line(cls, line: StockAdjustmentLine, persist: bool = True):
        delta = line.delta_qty or Decimal("0")
        if line.stock_class == "BULK":
            if not line.inventory_material_id or not line.location_id:
                raise ValidationError(
                    f"Line {line.line_no}: BULK requires material + location."
                )
            row = (
                InventoryBulk.objects.select_for_update()
                .filter(
                    material_id=line.inventory_material_id,
                    plant_id=line.adjustment.plant_id,
                    location_id=line.location_id,
                )
                .first()
            )
            if not row:
                if delta <= 0:
                    raise ValidationError(
                        f"Line {line.line_no}: no bulk stock row to decrement."
                    )
                row = InventoryBulk.objects.create(
                    material_id=line.inventory_material_id,
                    plant_id=line.adjustment.plant_id,
                    location_id=line.location_id,
                    qty_kg=Decimal("0"),
                )
            line.before_qty = row.qty_kg or Decimal("0")
            new_qty = line.before_qty + delta
            if new_qty < 0:
                raise ValidationError(
                    f"Line {line.line_no}: adjustment would make stock negative ({new_qty})."
                )
            row.qty_kg = new_qty
            row.save(update_fields=["qty_kg", "updated_at"])
            line.after_qty = new_qty
            line.value_inr = delta * (row.avg_cost or Decimal("0"))
        elif line.stock_class == "PACKAGING":
            if not line.inventory_material_id or not line.location_id:
                raise ValidationError(
                    f"Line {line.line_no}: PACKAGING requires material + location."
                )
            row = (
                PackagingStock.objects.select_for_update()
                .filter(
                    material_id=line.inventory_material_id,
                    plant_id=line.adjustment.plant_id,
                    location_id=line.location_id,
                )
                .first()
            )
            if not row:
                if delta <= 0:
                    raise ValidationError(
                        f"Line {line.line_no}: no packaging stock row to decrement."
                    )
                row = PackagingStock.objects.create(
                    material_id=line.inventory_material_id,
                    plant_id=line.adjustment.plant_id,
                    location_id=line.location_id,
                    qty=Decimal("0"),
                )
            line.before_qty = row.qty or Decimal("0")
            new_qty = line.before_qty + delta
            if new_qty < 0:
                raise ValidationError(
                    f"Line {line.line_no}: adjustment would make stock negative ({new_qty})."
                )
            row.qty = new_qty
            row.save(update_fields=["qty", "updated_at"])
            line.after_qty = new_qty
            line.value_inr = delta * (row.avg_cost or Decimal("0"))
        elif line.stock_class == "ROLL":
            roll = (
                InventoryRoll.objects.select_for_update()
                .filter(id=line.inventory_roll_id)
                .first()
            )
            if not roll:
                raise ValidationError(f"Line {line.line_no}: roll not found.")
            line.before_qty = roll.weight_kg or Decimal("0")
            new_qty = line.before_qty + delta
            if new_qty < 0:
                raise ValidationError(
                    f"Line {line.line_no}: adjustment would make roll weight negative."
                )
            roll.weight_kg = new_qty
            if new_qty <= Decimal("0.01"):
                roll.status = "CONSUMED"
            elif roll.status == "CONSUMED":
                roll.status = "AVAILABLE"
            roll.save(update_fields=["weight_kg", "status"])
            line.after_qty = new_qty
        elif line.stock_class == "TRADING_GOOD":
            if not line.trading_good_id:
                raise ValidationError(
                    f"Line {line.line_no}: TRADING_GOOD requires trading_good."
                )
            stock = (
                TradingGoodStock.objects.select_for_update()
                .filter(
                    trading_good_id=line.trading_good_id,
                    plant_id=line.adjustment.plant_id,
                )
                .first()
            )
            if not stock:
                if delta <= 0:
                    raise ValidationError(
                        f"Line {line.line_no}: no trading-good stock row to decrement."
                    )
                stock = TradingGoodStock.objects.create(
                    trading_good_id=line.trading_good_id,
                    plant_id=line.adjustment.plant_id,
                    qty=Decimal("0"),
                )
            line.before_qty = stock.qty or Decimal("0")
            new_qty = line.before_qty + delta
            if new_qty < 0:
                raise ValidationError(
                    f"Line {line.line_no}: would make trading-good stock negative."
                )
            stock.qty = new_qty
            stock.save(update_fields=["qty", "updated_at"])
            line.after_qty = new_qty
            line.value_inr = delta * (stock.avg_cost or Decimal("0"))
        else:
            raise ValidationError(
                f"Line {line.line_no}: unknown stock_class {line.stock_class}"
            )
        if persist:
            line.save(
                update_fields=["before_qty", "after_qty", "value_inr"]
            )
