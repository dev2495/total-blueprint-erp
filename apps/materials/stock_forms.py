"""Shared stock-form vocabulary for film rolls and pouch-style math."""

from __future__ import annotations

from decimal import Decimal
from typing import Any


STOCK_FORM_OPEN_WEB = "OPEN_WEB"
STOCK_FORM_LAYFLAT_TUBE = "LAYFLAT_TUBE"
STOCK_FORM_FOLDED_WEB = "FOLDED_WEB"

STOCK_FORM_CHOICES = [
    (STOCK_FORM_OPEN_WEB, "Open web / sheet"),
    (STOCK_FORM_LAYFLAT_TUBE, "Lay-flat tube"),
    (STOCK_FORM_FOLDED_WEB, "Folded web"),
]

WIDTH_BASIS_OPEN_WEB = "OPEN_WEB_WIDTH"
WIDTH_BASIS_LAYFLAT = "LAYFLAT_WIDTH"
WIDTH_BASIS_FOLDED = "FOLDED_WIDTH"

WIDTH_BASIS_CHOICES = [
    (WIDTH_BASIS_OPEN_WEB, "Open-web width"),
    (WIDTH_BASIS_LAYFLAT, "Lay-flat width"),
    (WIDTH_BASIS_FOLDED, "Folded width"),
]

SLIT_POLICY_ALLOWED = "SLIT_ALLOWED"
SLIT_POLICY_EXACT_ONLY = "EXACT_ONLY"

SLIT_POLICY_CHOICES = [
    (SLIT_POLICY_ALLOWED, "Slit allowed"),
    (SLIT_POLICY_EXACT_ONLY, "Exact stock width only"),
]

_STOCK_FORM_ALIASES = {
    "": STOCK_FORM_OPEN_WEB,
    "OPEN": STOCK_FORM_OPEN_WEB,
    "OPEN_WEB": STOCK_FORM_OPEN_WEB,
    "SHEET": STOCK_FORM_OPEN_WEB,
    "OPENWEB": STOCK_FORM_OPEN_WEB,
    "WEB": STOCK_FORM_OPEN_WEB,
    "TUBE": STOCK_FORM_LAYFLAT_TUBE,
    "TUBING": STOCK_FORM_LAYFLAT_TUBE,
    "LAYFLAT": STOCK_FORM_LAYFLAT_TUBE,
    "LAYFLAT_TUBE": STOCK_FORM_LAYFLAT_TUBE,
    "LAY_FLAT_TUBE": STOCK_FORM_LAYFLAT_TUBE,
    "FOLDED": STOCK_FORM_FOLDED_WEB,
    "FOLDED_WEB": STOCK_FORM_FOLDED_WEB,
}


def normalize_stock_form(value: Any) -> str:
    key = str(value or "").upper().strip().replace("-", "_").replace(" ", "_")
    return _STOCK_FORM_ALIASES.get(key, STOCK_FORM_OPEN_WEB)


def default_width_basis(stock_form: Any) -> str:
    form = normalize_stock_form(stock_form)
    if form == STOCK_FORM_LAYFLAT_TUBE:
        return WIDTH_BASIS_LAYFLAT
    if form == STOCK_FORM_FOLDED_WEB:
        return WIDTH_BASIS_FOLDED
    return WIDTH_BASIS_OPEN_WEB


def default_slit_policy(stock_form: Any) -> str:
    form = normalize_stock_form(stock_form)
    if form == STOCK_FORM_OPEN_WEB:
        return SLIT_POLICY_ALLOWED
    return SLIT_POLICY_EXACT_ONLY


def normalize_width_basis(value: Any, *, stock_form: Any = None) -> str:
    raw = str(value or "").upper().strip().replace("-", "_").replace(" ", "_")
    aliases = {
        "": default_width_basis(stock_form),
        "WIDTH": default_width_basis(stock_form),
        "OPEN_WEB": WIDTH_BASIS_OPEN_WEB,
        "OPEN_WEB_WIDTH": WIDTH_BASIS_OPEN_WEB,
        "LAYFLAT": WIDTH_BASIS_LAYFLAT,
        "LAYFLAT_WIDTH": WIDTH_BASIS_LAYFLAT,
        "TUBE_WIDTH": WIDTH_BASIS_LAYFLAT,
        "FOLDED": WIDTH_BASIS_FOLDED,
        "FOLDED_WIDTH": WIDTH_BASIS_FOLDED,
    }
    return aliases.get(raw, default_width_basis(stock_form))


def normalize_slit_policy(value: Any, *, stock_form: Any = None) -> str:
    raw = str(value or "").upper().strip().replace("-", "_").replace(" ", "_")
    aliases = {
        "": default_slit_policy(stock_form),
        "YES": SLIT_POLICY_ALLOWED,
        "ALLOW": SLIT_POLICY_ALLOWED,
        "ALLOWED": SLIT_POLICY_ALLOWED,
        "SLIT_ALLOWED": SLIT_POLICY_ALLOWED,
        "NO": SLIT_POLICY_EXACT_ONLY,
        "EXACT": SLIT_POLICY_EXACT_ONLY,
        "EXACT_ONLY": SLIT_POLICY_EXACT_ONLY,
        "EXACT_WIDTH_ONLY": SLIT_POLICY_EXACT_ONLY,
        "NO_SLIT": SLIT_POLICY_EXACT_ONLY,
    }
    return aliases.get(raw, default_slit_policy(stock_form))


def film_area_factor_for_stock_form(stock_form: Any) -> int:
    """How many film walls are represented by one stored physical width."""
    form = normalize_stock_form(stock_form)
    if form in {STOCK_FORM_LAYFLAT_TUBE, STOCK_FORM_FOLDED_WEB}:
        return 2
    return 1


# What a style's width formula gives for a folded / tube form:
#   STOCK_WIDTH - the folded / lay-flat width itself (the default; tube styles written for blown tube)
#   OPEN_WEB    - the open web before the fold; the folded width then comes from the fold rule, so the open
#                 width, the rolls picked before the fold and the film / kg targets stay what the formula says.
FORMULA_BASIS_STOCK = "STOCK_WIDTH"
FORMULA_BASIS_OPEN = "OPEN_WEB"


def normalize_formula_basis(value: Any) -> str:
    raw = str(value or "").upper().strip().replace("-", "_").replace(" ", "_")
    return FORMULA_BASIS_OPEN if raw in {"OPEN", "OPEN_WEB", "OPEN_WIDTH"} else FORMULA_BASIS_STOCK


# Fold geometry: a folded web or a lay-flat tube made from one open web.
#   open width = 2 x stored width + flap + seal + trim
# flap  = the longer wall's extra (J-fold, courier-bag lip); 0 for a plain C-fold
# seal  = film taken by the edge seal when the folder also seals into a tube
# trim  = edge trim cut off at the folder (scrap, not film area)
FOLD_KEYS = ("flap_mm", "seal_mm", "trim_mm")
FOLDABLE_FORMS = {STOCK_FORM_FOLDED_WEB, STOCK_FORM_LAYFLAT_TUBE}


def _fold_number(value: Any) -> Decimal:
    try:
        number = Decimal(str(value if value not in (None, "") else 0))
    except Exception:
        return Decimal("0")
    return number if number > 0 else Decimal("0")


def normalize_fold(raw: Any) -> dict:
    """{flap_mm, seal_mm, trim_mm} as Decimals >= 0; anything else is ignored."""
    raw = raw if isinstance(raw, dict) else {}
    return {key: _fold_number(raw.get(key)) for key in FOLD_KEYS}


def fold_as_json(fold: Any) -> dict:
    clean = normalize_fold(fold)
    return {key: float(clean[key]) for key in FOLD_KEYS}


def open_width_for(stock_form: Any, width: Any, fold: Any = None) -> Decimal:
    """Open web needed to make `width` of this form (2W + flap + seal + trim); open web is itself."""
    stored = _fold_number(width)
    if normalize_stock_form(stock_form) not in FOLDABLE_FORMS:
        return stored
    if stored <= 0:
        return Decimal("0")
    f = normalize_fold(fold)
    return (stored * 2 + f["flap_mm"] + f["seal_mm"] + f["trim_mm"]).quantize(Decimal("0.01"))


def folded_width_from_open(open_width: Any, fold: Any = None) -> Decimal:
    """Stored folded / lay-flat width one open web gives: (open - flap - seal - trim) / 2."""
    f = normalize_fold(fold)
    width = (_fold_number(open_width) - f["flap_mm"] - f["seal_mm"] - f["trim_mm"]) / 2
    return width.quantize(Decimal("0.01")) if width > 0 else Decimal("0")


def film_area_width_for(stock_form: Any, width: Any, fold: Any = None) -> Decimal:
    """Film in one stored width: open is itself, folded/tube is 2W + flap + seal (trim is scrap)."""
    stored = _fold_number(width)
    if normalize_stock_form(stock_form) not in FOLDABLE_FORMS:
        return stored.quantize(Decimal("0.01"))
    f = normalize_fold(fold)
    return (stored * 2 + f["flap_mm"] + f["seal_mm"]).quantize(Decimal("0.01"))


def convert_width(from_form: Any, to_form: Any, width: Any, fold: Any = None) -> Decimal:
    """Width after a form change, by the fold rule. Same form keeps the width."""
    source = normalize_stock_form(from_form)
    target = normalize_stock_form(to_form)
    if source == target:
        return _fold_number(width).quantize(Decimal("0.01"))
    if source == STOCK_FORM_OPEN_WEB and target in FOLDABLE_FORMS:
        return folded_width_from_open(width, fold)
    if source in FOLDABLE_FORMS and target == STOCK_FORM_OPEN_WEB:
        f = normalize_fold(fold)
        return (_fold_number(width) * 2 + f["flap_mm"] + f["seal_mm"]).quantize(Decimal("0.01"))
    # Folded <-> tube keeps the lay-flat width (seal or slit the folded edge).
    return _fold_number(width).quantize(Decimal("0.01"))


def describe_form(stock_form: Any, width: Any = None, fold: Any = None) -> str:
    """Short floor text, e.g. "Folded 300 mm + 20 flap" or "Tube 250 mm"."""
    form = normalize_stock_form(stock_form)
    label = {STOCK_FORM_OPEN_WEB: "Open", STOCK_FORM_LAYFLAT_TUBE: "Tube", STOCK_FORM_FOLDED_WEB: "Folded"}[form]
    stored = _fold_number(width)
    text = f"{label} {stored.normalize():f} mm" if stored > 0 else label
    if form in FOLDABLE_FORMS:
        f = normalize_fold(fold)
        if f["flap_mm"] > 0:
            text += f" + {f['flap_mm'].normalize():f} flap"
    return text


# The roll size editor's older "Roll form" picker (geometry_config.roll_form).
_ROLL_FORM_TO_STOCK_FORM = {
    "FLAT": STOCK_FORM_OPEN_WEB,
    "OPEN": STOCK_FORM_OPEN_WEB,
    "SHEET": STOCK_FORM_OPEN_WEB,
    "FOLDED": STOCK_FORM_FOLDED_WEB,
    "TUBING": STOCK_FORM_LAYFLAT_TUBE,
    "TUBE": STOCK_FORM_LAYFLAT_TUBE,
}
_STOCK_FORM_TO_ROLL_FORM = {
    STOCK_FORM_OPEN_WEB: "FLAT",
    STOCK_FORM_FOLDED_WEB: "FOLDED",
    STOCK_FORM_LAYFLAT_TUBE: "TUBING",
}


def stock_form_from_roll_form(value: Any) -> str | None:
    """FLAT / FOLDED / TUBING -> canonical stock form; None when blank or unknown."""
    return _ROLL_FORM_TO_STOCK_FORM.get(str(value or "").upper().strip())


def roll_form_from_stock_form(value: Any) -> str:
    return _STOCK_FORM_TO_ROLL_FORM[normalize_stock_form(value)]
