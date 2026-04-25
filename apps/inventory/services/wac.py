from __future__ import annotations

from decimal import Decimal, ROUND_HALF_EVEN, ROUND_HALF_UP
from typing import Any, Tuple


Q4 = Decimal("0.0001")
MONEY = Decimal("0.01")


def dec(value: Any, fallback: str = "0") -> Decimal:
    if value in (None, ""):
        return Decimal(fallback)
    return Decimal(str(value))


def q4(value: Any) -> Decimal:
    return dec(value).quantize(Q4, rounding=ROUND_HALF_UP)


def money2(value: Any) -> Decimal:
    return dec(value).quantize(MONEY, rounding=ROUND_HALF_EVEN)


def apply_wac(*, balance_qty: Any, balance_rate: Any, delta_qty: Any, posting_rate: Any) -> Tuple[Decimal, Decimal]:
    """Apply the stock lifecycle weighted-average-cost rule and return qty/rate at 4 dp."""
    bal_qty = q4(balance_qty)
    bal_rate = q4(balance_rate)
    qty = q4(delta_qty)
    rate = q4(posting_rate)

    if qty == 0:
        return bal_qty, rate

    new_qty = q4(bal_qty + qty)
    if qty > 0:
        if new_qty == 0:
            return new_qty, rate
        new_rate = ((bal_qty * bal_rate) + (qty * rate)) / new_qty
        return new_qty, q4(new_rate)

    if new_qty < 0:
        raise ValueError("NEGATIVE_STOCK")
    return new_qty, bal_rate


def signed_value(qty: Any, rate: Any) -> Decimal:
    return q4(dec(qty) * dec(rate))


def display_value(qty: Any, rate: Any) -> Decimal:
    return money2(dec(qty) * dec(rate))
