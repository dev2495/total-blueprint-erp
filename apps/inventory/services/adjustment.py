"""Unified Stock Adjustment service — applies adjustment lines to the
correct stock pool (BULK / ROLL / PACKAGING / TRADING_GOOD) atomically."""

from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from apps.inventory.models import (
    BulkTransaction,
    InventoryBulk,
    InventoryReservation,
    InventoryRoll,
    PackagingStock,
    PackagingTransaction,
    RollMovement,
    StockAdjustment,
    StockAdjustmentLine,
)
from apps.materials.models import TradingGoodStock

ZERO = Decimal("0")
ROLL_EMPTY_KG = Decimal("0.01")
VIRTUAL_LOCATION_TYPES = {"JOBWORK", "TRANSIT", "SCRAP"}
VIRTUAL_LOCATION_CODES = {"JOBWORK_OUT", "IN_TRANSIT", "IN-TRANSIT", "SCRAP"}


def _is_virtual(location) -> bool:
    return (
        str(getattr(location, "type", "") or "").upper() in VIRTUAL_LOCATION_TYPES
        or str(getattr(location, "code", "") or "").upper() in VIRTUAL_LOCATION_CODES
    )


def can_self_post(user) -> bool:
    """Owners and administrators may post an adjustment they drafted."""
    from apps.users.permission_service import PermissionService

    return bool(
        getattr(user, "is_superuser", False)
        or getattr(user, "is_owner", False)
        or PermissionService.is_gate_master(user)
    )


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
    """Posts and voids stock adjustments.

    Every stock-changing line also writes the ledger row its pool is reported
    from (BulkTransaction / PackagingTransaction type ADJUST, a RollMovement
    with reason ADJUSTMENT), so the stock card and ledger reconciliation see
    the change. Posting needs a second person unless the poster is an owner
    or administrator.
    """

    @staticmethod
    def _locked_lines(adjustment):
        lines = list(adjustment.lines.select_for_update().order_by("id"))
        # Header -> lines -> stock. Use the same material-first stock order
        # across adjustments/receipts, preserving line order within one pool.
        return sorted(lines, key=lambda line: (
            str(line.inventory_material_id or line.trading_good_id or line.inventory_roll_id or ""),
            line.stock_class, str(line.location_id or ""), line.line_no, str(line.id),
        ))

    @classmethod
    @transaction.atomic
    def post(cls, *, adjustment: StockAdjustment, user=None) -> StockAdjustment:
        adjustment = StockAdjustment.objects.select_for_update().get(pk=adjustment.pk)
        if adjustment.status == "POSTED":
            return adjustment
        if adjustment.status != "DRAFT":
            raise ValidationError(f"Cannot post adjustment in status {adjustment.status}")
        if (
            user is not None
            and adjustment.created_by_id
            and adjustment.created_by_id == getattr(user, "id", None)
            and not can_self_post(user)
        ):
            raise ValidationError(
                "A stock adjustment needs a second person: someone other than the person who drafted it must post it."
            )
        lines = cls._locked_lines(adjustment)
        if not lines:
            raise ValidationError("Add at least one line before posting.")
        for line in lines:
            cls._apply_line(line, user=user)
        adjustment.status = "POSTED"
        adjustment.posted_at = timezone.now()
        adjustment.posted_by = user
        adjustment.save(update_fields=["status", "posted_at", "posted_by"])
        return adjustment

    @classmethod
    @transaction.atomic
    def void(cls, *, adjustment: StockAdjustment, user=None) -> StockAdjustment:
        adjustment = StockAdjustment.objects.select_for_update().get(pk=adjustment.pk)
        if adjustment.status == "VOID":
            return adjustment
        if adjustment.status == "POSTED":
            # Reverse each line on the same pool and record the reversal.
            for line in cls._locked_lines(adjustment):
                cls._reverse_line(line, user=user)
        adjustment.status = "VOID"
        adjustment.save(update_fields=["status"])
        return adjustment

    # ------------------------------------------------------------------ helpers
    @staticmethod
    def _reference(line, prefix=""):
        adjustment = line.adjustment
        text = f"{prefix}{adjustment.code} #{line.line_no} {adjustment.reason}"
        return text[:255]

    @staticmethod
    def _check_location(line, delta):
        location = line.location
        if location is None:
            raise ValidationError(f"Line {line.line_no}: choose a location.")
        if location.plant_id != line.adjustment.plant_id:
            raise ValidationError(f"Line {line.line_no}: {location.name} belongs to another plant.")
        if _is_virtual(location):
            raise ValidationError(
                f"Line {line.line_no}: {location.name} is a virtual location (job work, transit or scrap); its stock is settled by that flow."
            )
        if delta > 0 and not location.is_active:
            raise ValidationError(f"Line {line.line_no}: {location.name} is closed.")
        return location

    @staticmethod
    def _check_uom(line, material):
        expected = str(getattr(material, "base_uom", "") or "").strip().upper()
        given = str(line.uom or "").strip().upper()
        if expected and given and given != expected:
            raise ValidationError(
                f"Line {line.line_no}: {material.code} is stocked in {expected}; enter the quantity in {expected}."
            )

    @staticmethod
    def _bulk_row(line, delta):
        from apps.inventory.services.bulk_service import BulkService

        rows = list(
            InventoryBulk.objects.select_for_update()
            .filter(
                material_id=line.inventory_material_id,
                plant_id=line.adjustment.plant_id,
                location_id=line.location_id,
            )
            .order_by("id")
        )
        if len(rows) > 1:
            raise ValidationError(
                f"Line {line.line_no}: this material is held under several quality codes at this location. "
                "Adjust it through a physical count, which records the code."
            )
        if rows:
            return rows[0]
        if delta <= 0:
            raise ValidationError(f"Line {line.line_no}: no bulk stock row to decrement.")
        # Refuses uncoded stock for coded granule families.
        BulkService._resolve_granule_code(line.inventory_material_id, None)
        return InventoryBulk.objects.create(
            material_id=line.inventory_material_id,
            plant_id=line.adjustment.plant_id,
            location_id=line.location_id,
            qty_kg=ZERO,
        )

    @classmethod
    def _apply_line(cls, line: StockAdjustmentLine, user=None):
        delta = line.delta_qty or ZERO
        if delta == 0:
            raise ValidationError(f"Line {line.line_no}: delta quantity cannot be zero.")
        reference = cls._reference(line)
        if line.stock_class == "BULK":
            if not line.inventory_material_id or not line.location_id:
                raise ValidationError(f"Line {line.line_no}: BULK requires material + location.")
            cls._check_location(line, delta)
            cls._check_uom(line, line.inventory_material)
            row = cls._bulk_row(line, delta)
            line.before_qty = row.qty_kg or ZERO
            new_qty = line.before_qty + delta
            if new_qty < 0:
                raise ValidationError(f"Line {line.line_no}: adjustment would make stock negative ({new_qty}).")
            row.qty_kg = new_qty
            row.save(update_fields=["qty_kg", "updated_at"])
            line.after_qty = new_qty
            line.value_inr = delta * (row.avg_cost or ZERO)
            BulkTransaction.objects.create(
                material_id=row.material_id, granule_code_id=row.granule_code_id, location_id=row.location_id,
                type="ADJUST", qty_kg=delta, avg_cost=row.avg_cost or ZERO, reference=reference,
            )
        elif line.stock_class == "PACKAGING":
            if not line.inventory_material_id or not line.location_id:
                raise ValidationError(f"Line {line.line_no}: PACKAGING requires material + location.")
            cls._check_location(line, delta)
            cls._check_uom(line, line.inventory_material)
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
                    raise ValidationError(f"Line {line.line_no}: no packaging stock row to decrement.")
                row = PackagingStock.objects.create(
                    material_id=line.inventory_material_id,
                    plant_id=line.adjustment.plant_id,
                    location_id=line.location_id,
                    qty=ZERO,
                )
            line.before_qty = row.qty or ZERO
            new_qty = line.before_qty + delta
            if new_qty < 0:
                raise ValidationError(f"Line {line.line_no}: adjustment would make stock negative ({new_qty}).")
            row.qty = new_qty
            row.save(update_fields=["qty", "updated_at"])
            line.after_qty = new_qty
            line.value_inr = delta * (row.avg_cost or ZERO)
            PackagingTransaction.objects.create(
                material_id=row.material_id, location_id=row.location_id, type="ADJUST",
                qty=delta, avg_cost=row.avg_cost or ZERO, reference=reference,
            )
        elif line.stock_class == "ROLL":
            roll = (
                InventoryRoll.objects.select_for_update(of=("self",))
                .select_related("location")
                .filter(id=line.inventory_roll_id)
                .first()
            )
            if not roll:
                raise ValidationError(f"Line {line.line_no}: roll not found.")
            roll_plant = roll.plant_id or getattr(roll.location, "plant_id", None)
            if roll_plant != line.adjustment.plant_id:
                raise ValidationError(f"Line {line.line_no}: roll {roll.label_id} belongs to another plant.")
            if str(line.uom or "KG").strip().upper() != "KG":
                raise ValidationError(f"Line {line.line_no}: roll adjustments are entered in KG.")
            # Only stock sitting in the store can be corrected here. Consumed,
            # dispatched, in-transit or job-work rolls are settled by their flows.
            if roll.status == "MISSING" and delta > 0:
                next_status = "AVAILABLE"
            elif roll.status != "AVAILABLE":
                raise ValidationError(
                    f"Line {line.line_no}: roll {roll.label_id} is {roll.status}; only an available roll can be adjusted."
                )
            else:
                next_status = "AVAILABLE"
            if InventoryReservation.objects.filter(roll=roll, status="ACTIVE").exists():
                raise ValidationError(f"Line {line.line_no}: roll {roll.label_id} is reserved for a job. Unassign it first.")
            line.before_qty = roll.weight_kg or ZERO
            new_qty = line.before_qty + delta
            if new_qty < 0:
                raise ValidationError(f"Line {line.line_no}: adjustment would make roll weight negative.")
            if new_qty <= ROLL_EMPTY_KG:
                next_status = "CONSUMED"
            roll.weight_kg = new_qty
            roll.status = next_status
            roll.save(update_fields=["weight_kg", "status"])
            line.after_qty = new_qty
            line.value_inr = delta * cls._roll_rate(roll)
            RollMovement.objects.create(
                roll=roll, from_location=roll.location, to_location=roll.location, reason="ADJUSTMENT",
                reason_note=f"{reference}: {line.before_qty} -> {new_qty} kg"[:255],
                moved_by=user if getattr(user, "is_authenticated", False) else None,
            )
        elif line.stock_class == "TRADING_GOOD":
            if not line.trading_good_id:
                raise ValidationError(f"Line {line.line_no}: TRADING_GOOD requires trading_good.")
            stock = (
                TradingGoodStock.objects.select_for_update()
                .filter(trading_good_id=line.trading_good_id, plant_id=line.adjustment.plant_id)
                .first()
            )
            if not stock:
                if delta <= 0:
                    raise ValidationError(f"Line {line.line_no}: no trading-good stock row to decrement.")
                stock = TradingGoodStock.objects.create(
                    trading_good_id=line.trading_good_id,
                    plant_id=line.adjustment.plant_id,
                    qty=ZERO,
                )
            line.before_qty = stock.qty or ZERO
            new_qty = line.before_qty + delta
            if new_qty < 0:
                raise ValidationError(f"Line {line.line_no}: would make trading-good stock negative.")
            stock.qty = new_qty
            stock.save(update_fields=["qty", "updated_at"])
            line.after_qty = new_qty
            line.value_inr = delta * (stock.avg_cost or ZERO)
        else:
            raise ValidationError(f"Line {line.line_no}: unknown stock_class {line.stock_class}")
        line.save(update_fields=["before_qty", "after_qty", "value_inr"])

    @classmethod
    def _reverse_line(cls, line: StockAdjustmentLine, user=None):
        delta = -(line.delta_qty or ZERO)
        reference = cls._reference(line, prefix="VOID ")
        if line.stock_class == "BULK":
            row = cls._bulk_row(line, delta)
            new_qty = (row.qty_kg or ZERO) + delta
            if new_qty < 0:
                raise ValidationError(f"Line {line.line_no}: voiding would make stock negative; the stock has been used since.")
            row.qty_kg = new_qty
            row.save(update_fields=["qty_kg", "updated_at"])
            BulkTransaction.objects.create(
                material_id=row.material_id, granule_code_id=row.granule_code_id, location_id=row.location_id,
                type="ADJUST", qty_kg=delta, avg_cost=row.avg_cost or ZERO, reference=reference,
            )
        elif line.stock_class == "PACKAGING":
            row = (
                PackagingStock.objects.select_for_update()
                .filter(material_id=line.inventory_material_id, plant_id=line.adjustment.plant_id, location_id=line.location_id)
                .first()
            )
            new_qty = (getattr(row, "qty", None) or ZERO) + delta
            if row is None or new_qty < 0:
                raise ValidationError(f"Line {line.line_no}: voiding would make stock negative; the stock has been used since.")
            row.qty = new_qty
            row.save(update_fields=["qty", "updated_at"])
            PackagingTransaction.objects.create(
                material_id=row.material_id, location_id=row.location_id, type="ADJUST",
                qty=delta, avg_cost=row.avg_cost or ZERO, reference=reference,
            )
        elif line.stock_class == "ROLL":
            roll = InventoryRoll.objects.select_for_update(of=("self",)).select_related("location").filter(id=line.inventory_roll_id).first()
            if not roll:
                raise ValidationError(f"Line {line.line_no}: roll not found.")
            expected_status = "CONSUMED" if (line.after_qty or ZERO) <= ROLL_EMPTY_KG else "AVAILABLE"
            if (roll.weight_kg or ZERO) != (line.after_qty or ZERO) or roll.status != expected_status:
                raise ValidationError(
                    f"Line {line.line_no}: roll {roll.label_id} has changed since this adjustment was posted. Post a new adjustment instead."
                )
            restored = line.before_qty or ZERO
            roll.weight_kg = restored
            roll.status = "AVAILABLE" if restored > ROLL_EMPTY_KG else "CONSUMED"
            roll.save(update_fields=["weight_kg", "status"])
            RollMovement.objects.create(
                roll=roll, from_location=roll.location, to_location=roll.location, reason="ADJUSTMENT",
                reason_note=f"{reference}: {line.after_qty} -> {restored} kg"[:255],
                moved_by=user if getattr(user, "is_authenticated", False) else None,
            )
        elif line.stock_class == "TRADING_GOOD":
            stock = TradingGoodStock.objects.select_for_update().filter(trading_good_id=line.trading_good_id, plant_id=line.adjustment.plant_id).first()
            new_qty = (getattr(stock, "qty", None) or ZERO) + delta
            if stock is None or new_qty < 0:
                raise ValidationError(f"Line {line.line_no}: voiding would make stock negative; the stock has been used since.")
            stock.qty = new_qty
            stock.save(update_fields=["qty", "updated_at"])

    @staticmethod
    def _roll_rate(roll) -> Decimal:
        meta = roll.meta_json or {}
        for key in ("unit_cost_per_kg", "unit_cost", "rate_per_kg"):
            try:
                value = Decimal(str(meta.get(key)))
            except Exception:
                continue
            if value.is_finite() and value > 0:
                return value
        return ZERO
