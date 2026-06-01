"""Shared stock-form vocabulary for film rolls and pouch-style math."""

from __future__ import annotations

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
    if form == STOCK_FORM_LAYFLAT_TUBE:
        return 2
    return 1
