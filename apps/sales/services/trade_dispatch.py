"""Trade order dispatch service — decrement stock pools on dispatch.

Stock decrement strategy depends on the item type:
- TRADING_GOOD: locks the TradingGoodStock row for the order's plant and decrements.
- INVENTORY_MATERIAL (PACKAGING/POD): consumes PackagingStock rows FIFO by updated_at.
- INVENTORY_MATERIAL (FILM_VARIANT): consumes InventoryRoll rows FIFO by created_at, in the order's plant.
- INVENTORY_MATERIAL (GRANULE/FILM_FAMILY/SOLVENT/INK/ADHESIVE/ADDON): consumes InventoryBulk FIFO.
"""

from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Count, Sum
from django.utils import timezone

from apps.inventory.models import InventoryBulk, InventoryRoll, PackagingStock
from apps.materials.models import TradingGoodStock


def get_available_stock_for_trading_good(*, trading_good, plant) -> Decimal:
    row = TradingGoodStock.objects.filter(
        trading_good=trading_good,
        plant=plant,
    ).first()
    return (row.qty if row else Decimal("0")) or Decimal("0")


def get_available_stock_for_inventory_material(*, material, plant) -> Decimal:
    cat = (material.category or "").upper()

    if cat in {"PACKAGING", "POD"}:
        value = (
            PackagingStock.objects.filter(material=material, plant=plant, qty__gt=0)
            .aggregate(total=Sum("qty"))
            .get("total")
        )
        return value or Decimal("0")

    if cat == "FILM_VARIANT":
        value = (
            InventoryRoll.objects.filter(
                material=material,
                plant=plant,
                status="AVAILABLE",
                weight_kg__gt=0,
            )
            .aggregate(total=Sum("weight_kg"))
            .get("total")
        )
        return value or Decimal("0")

    value = (
        InventoryBulk.objects.filter(material=material, plant=plant, qty_kg__gt=0)
        .aggregate(total=Sum("qty_kg"))
        .get("total")
    )
    return value or Decimal("0")


def get_stock_rows_for_inventory_material(*, material, plant=None) -> list[dict]:
    cat = (material.category or "").upper()

    if cat in {"PACKAGING", "POD"}:
        qs = PackagingStock.objects.select_related("plant", "location").filter(material=material, qty__gt=0)
        if plant:
            qs = qs.filter(plant=plant)
        grouped = (
            qs.values("plant_id", "plant__name", "plant__code")
            .annotate(qty=Sum("qty"), location_count=Count("location", distinct=True))
            .order_by("plant__name")
        )
        return [
            {
                "plant": str(row["plant_id"]) if row["plant_id"] else "",
                "plant_name": row["plant__name"] or "",
                "plant_code": row["plant__code"] or "",
                "qty": row["qty"] or Decimal("0"),
                "uom": material.base_uom or "PCS",
                "stock_class": "PACKAGING",
                "detail": f"{row['location_count'] or 0} location(s)",
            }
            for row in grouped
        ]

    if cat == "FILM_VARIANT":
        qs = InventoryRoll.objects.select_related("plant", "location").filter(
            material=material,
            status="AVAILABLE",
            weight_kg__gt=0,
        )
        if plant:
            qs = qs.filter(plant=plant)
        grouped = (
            qs.values("plant_id", "plant__name", "plant__code")
            .annotate(qty=Sum("weight_kg"), roll_count=Count("id"))
            .order_by("plant__name")
        )
        return [
            {
                "plant": str(row["plant_id"]) if row["plant_id"] else "",
                "plant_name": row["plant__name"] or "",
                "plant_code": row["plant__code"] or "",
                "qty": row["qty"] or Decimal("0"),
                "uom": "KG",
                "stock_class": "ROLL",
                "detail": f"{row['roll_count'] or 0} available roll(s)",
            }
            for row in grouped
        ]

    qs = InventoryBulk.objects.select_related("plant", "location").filter(material=material, qty_kg__gt=0)
    if plant:
        qs = qs.filter(plant=plant)
    grouped = (
        qs.values("plant_id", "plant__name", "plant__code")
        .annotate(qty=Sum("qty_kg"), location_count=Count("location", distinct=True))
        .order_by("plant__name")
    )
    return [
        {
            "plant": str(row["plant_id"]) if row["plant_id"] else "",
            "plant_name": row["plant__name"] or "",
            "plant_code": row["plant__code"] or "",
            "qty": row["qty"] or Decimal("0"),
            "uom": material.base_uom or "KG",
            "stock_class": "BULK",
            "detail": f"{row['location_count'] or 0} location(s)",
        }
        for row in grouped
    ]


def _stock_available_for_item(*, item, plant) -> Decimal:
    if item.item_type == "TRADING_GOOD":
        return get_available_stock_for_trading_good(trading_good=item.trading_good, plant=plant)

    if item.item_type != "INVENTORY_MATERIAL" or not item.inventory_material_id:
        return Decimal("0")

    return get_available_stock_for_inventory_material(material=item.inventory_material, plant=plant)


def get_trade_order_stock_shortages(*, order) -> list[str]:
    if not order.plant_id:
        return ["Trade order must have a plant set before confirmation/dispatch."]

    shortages: list[str] = []
    for item in order.items.select_related("inventory_material", "trading_good").order_by("line_no"):
        qty = item.qty or Decimal("0")
        if qty <= 0:
            shortages.append(f"Line #{item.line_no}: quantity must be greater than zero.")
            continue
        available = _stock_available_for_item(item=item, plant=order.plant)
        if available < qty:
            shortages.append(
                f"Line #{item.line_no}: {item.display_name} — insufficient stock ({available} < {qty})."
            )
    return shortages


@transaction.atomic
def dispatch_trade_order(*, order, user=None):
    if order.status != "CONFIRMED":
        raise ValidationError("Only CONFIRMED trade orders can be dispatched.")
    shortages = get_trade_order_stock_shortages(order=order)
    if shortages:
        raise ValidationError(shortages)

    for item in order.items.select_related("inventory_material", "trading_good").order_by("line_no"):
        qty = item.qty or Decimal("0")
        if qty <= 0:
            continue

        if item.item_type == "TRADING_GOOD":
            stock = (
                TradingGoodStock.objects.select_for_update()
                .filter(trading_good=item.trading_good, plant=order.plant)
                .first()
            )
            if not stock or stock.qty < qty:
                available = stock.qty if stock else Decimal("0")
                raise ValidationError(
                    f"Line #{item.line_no}: {item.display_name} — insufficient stock ({available} < {qty})."
                )
            stock.qty -= qty
            stock.save(update_fields=["qty", "updated_at"])
            continue

        if item.item_type == "INVENTORY_MATERIAL":
            mat = item.inventory_material
            if not mat:
                raise ValidationError(f"Line #{item.line_no}: missing inventory material reference.")
            cat = (mat.category or "").upper()

            if cat in {"PACKAGING", "POD"}:
                rows = (
                    PackagingStock.objects.select_for_update()
                    .filter(material=mat, plant=order.plant, qty__gt=0)
                    .order_by("updated_at")
                )
                remaining = qty
                for r in rows:
                    take = min(r.qty, remaining)
                    r.qty -= take
                    r.save(update_fields=["qty", "updated_at"])
                    remaining -= take
                    if remaining <= 0:
                        break
                if remaining > 0:
                    raise ValidationError(
                        f"Line #{item.line_no}: {item.display_name} — insufficient packaging stock (short {remaining})."
                    )

            elif cat == "FILM_VARIANT":
                rolls = (
                    InventoryRoll.objects.select_for_update()
                    .filter(material=mat, plant=order.plant, status="AVAILABLE", weight_kg__gt=0)
                    .order_by("created_at")
                )
                remaining = qty
                for roll in rolls:
                    take = min(roll.weight_kg or Decimal("0"), remaining)
                    roll.weight_kg = (roll.weight_kg or Decimal("0")) - take
                    update_fields = ["weight_kg", "status"]
                    if roll.weight_kg <= Decimal("0.01"):
                        roll.status = "CONSUMED"
                    roll.save(update_fields=update_fields)
                    remaining -= take
                    if remaining <= 0:
                        break
                if remaining > 0:
                    raise ValidationError(
                        f"Line #{item.line_no}: {item.display_name} — insufficient roll stock (short {remaining} kg)."
                    )

            else:
                # GRANULE, FILM_FAMILY, SOLVENT, INK, ADHESIVE, ADDON, etc.
                rows = (
                    InventoryBulk.objects.select_for_update()
                    .filter(material=mat, plant=order.plant, qty_kg__gt=0)
                    .order_by("updated_at")
                )
                remaining = qty
                for r in rows:
                    take = min(r.qty_kg, remaining)
                    r.qty_kg -= take
                    r.save(update_fields=["qty_kg", "updated_at"])
                    remaining -= take
                    if remaining <= 0:
                        break
                if remaining > 0:
                    raise ValidationError(
                        f"Line #{item.line_no}: {item.display_name} — insufficient bulk stock (short {remaining})."
                    )

    order.status = "DISPATCHED"
    order.dispatched_at = timezone.now()
    order.save(update_fields=["status", "dispatched_at", "updated_at"])
    return order
