"""
Standard size names, the same rule as the frontend (src/lib/size-naming.ts):

  code  — mm only, no spaces: roll `500` / `500X45` (width × micron); pouch or bag `140X305` / `140X305G40`.
  label — `500 mm web · 45 µ`, `140 × 305 mm + 40 G`.

Only new sizes saved without a code or label get these; existing sizes keep what they were saved with.
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation


def _positive(value) -> Decimal:
    try:
        number = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal("0")
    return number if number > 0 else Decimal("0")


def _mm(value: Decimal) -> str:
    rounded = value.quantize(Decimal("0.1"))
    return format(rounded.normalize(), "f") if rounded != rounded.to_integral() else str(int(rounded))


def standard_size_name(*, width_mm=None, height_mm=None, gusset_mm=None, roll_width_mm=None, thickness_micron=None, is_roll: bool) -> tuple[str, str] | None:
    micron = _positive(thickness_micron)
    if is_roll:
        width = _positive(width_mm) or _positive(roll_width_mm)
        if not width:
            return None
        code = f"{_mm(width)}X{_mm(micron)}" if micron else _mm(width)
        label = f"{_mm(width)} mm web" + (f" · {_mm(micron)} µ" if micron else "")
        return code, label
    width, height = _positive(width_mm), _positive(height_mm)
    if not width or not height:
        return None
    gusset = _positive(gusset_mm)
    code = f"{_mm(width)}X{_mm(height)}" + (f"G{_mm(gusset)}" if gusset else "")
    label = f"{_mm(width)} × {_mm(height)} mm" + (f" + {_mm(gusset)} G" if gusset else "")
    return code, label
