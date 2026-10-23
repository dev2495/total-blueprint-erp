"""One width rule for picking a roll at a floor step.

A roll may be used as it is when its width is within ROLL_PICK_WIDTH_TOLERANCE_MM
(default 15 mm) of the planned web either side, or up to the +10% auto window when
that is wider. Wider than that it must be slit; narrower than the tolerance it is
refused. Picker, eligibility, allocation and the machine screen all read this.
"""
from decimal import Decimal

from django.conf import settings

AUTO_WINDOW_RATIO = Decimal("1.10")
EPSILON = Decimal("0.01")


def width_tolerance_mm() -> Decimal:
    try:
        return max(Decimal("0"), Decimal(str(getattr(settings, "ROLL_PICK_WIDTH_TOLERANCE_MM", 15))))
    except Exception:
        return Decimal("15")


def _dec(value) -> Decimal:
    try:
        return Decimal(str(value or 0))
    except Exception:
        return Decimal("0")


def as_is_window(required) -> tuple[Decimal, Decimal]:
    """(lowest, widest) roll width usable without slitting for this planned width."""
    required = _dec(required)
    tol = width_tolerance_mm()
    return required - tol, max(required * AUTO_WINDOW_RATIO, required + tol)


def too_narrow(stock, required) -> bool:
    required = _dec(required)
    return required > 0 and _dec(stock) + width_tolerance_mm() + EPSILON < required


def usable_as_is(stock, required) -> bool:
    required = _dec(required)
    if required <= 0:
        return True
    low, high = as_is_window(required)
    return low - EPSILON <= _dec(stock) <= high + EPSILON


def within_tolerance(stock, required) -> bool:
    """Close enough to count as the planned width (tube/folded stock that cannot be slit)."""
    required = _dec(required)
    return required <= 0 or abs(_dec(stock) - required) <= width_tolerance_mm() + EPSILON
