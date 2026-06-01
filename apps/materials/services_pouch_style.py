"""
Pouch style formula resolver.

Formula modes:
  - Closed-set kinds  — seeded pouch styles such as SIMPLE_DOUBLE,
                        GUSSETED_BOTTOM, CENTER_SEAL_H, etc.
  - LINEAR (default) — sum of (coefficient × field value) + trim_mm.
                        Each row in `formula_params.terms` looks like
                        `{ "field": "W", "coefficient": 2 }`.
                        Plus a `trim_mm` constant (or via `field_adjustments.trim_default_mm`).
  - SHAPED_OVERRIDE   — operator types `override_width` directly.
  - CUSTOM_AST        — operator builds an expression tree by hand.

No `eval()`. No `compile()`. AST = JSON tree of nodes with op + operands.

Public entry point:

    compute_child_target_width_mm(style, inputs) → Decimal
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any, Dict, Iterable

from .stock_forms import (
    STOCK_FORM_OPEN_WEB,
    default_slit_policy,
    default_width_basis,
    film_area_factor_for_stock_form,
    normalize_slit_policy,
    normalize_stock_form,
    normalize_width_basis,
)


_AST_MAX_DEPTH = 64
_BINARY_OPS = {"+", "-", "*", "/"}


def compute_child_target_width_mm(style, inputs: Dict[str, Any]) -> Decimal:
    """
    Evaluate the style's formula with the given inputs and return mm.

    `style` is a PouchStyleMaster instance or any object with attributes:
        - formula_kind: str
        - formula_params: dict
        - formula_ast: dict
        - field_adjustments: dict
    `inputs` is a dict of input field values, e.g.:
        {"W": 127, "H": 203, "gusset": 80, "flap": 25, "override_width": 200, ...}
    """
    kind = str(getattr(style, "formula_kind", "") or "LINEAR").upper()
    params = _safe_dict(getattr(style, "formula_params", None))
    adjustments = _safe_dict(getattr(style, "field_adjustments", None))

    if kind == "SHAPED_OVERRIDE":
        return _to_dec(_safe_float(inputs.get("override_width", 0)))

    if kind in _CLOSED_FORMULAS:
        return _to_dec(_eval_closed_formula(kind, params, adjustments, inputs))

    if kind == "CUSTOM_AST":
        ast = _safe_dict(getattr(style, "formula_ast", None))
        if not ast:
            raise ValueError("Style is CUSTOM_AST but formula_ast is empty.")
        return _to_dec(_eval_ast(ast, inputs, params))

    # Default: LINEAR
    return _to_dec(_eval_linear(params, adjustments, inputs))


def stock_form_config(style, stock_form: Any = None) -> Dict[str, Any]:
    """
    Resolve the per-style stock-form contract.

    Pouch styles produce a physical stock width through their normal formula.
    The stock form decides how that width is interpreted for film-area math and
    whether allocation may slit from a wider parent.
    """
    chosen_form = normalize_stock_form(stock_form or getattr(style, "default_stock_form", None) or STOCK_FORM_OPEN_WEB)
    options = getattr(style, "stock_form_options", None)
    if not isinstance(options, dict):
        options = {}
    raw = options.get(chosen_form) if isinstance(options.get(chosen_form), dict) else {}
    width_basis = normalize_width_basis(raw.get("width_basis") or getattr(style, "default_width_basis", None), stock_form=chosen_form)
    slit_policy = normalize_slit_policy(raw.get("slit_policy") or getattr(style, "default_slit_policy", None), stock_form=chosen_form)
    factor = raw.get("film_area_factor", None)
    try:
        film_area_factor = Decimal(str(factor)) if factor not in (None, "") else Decimal(str(film_area_factor_for_stock_form(chosen_form)))
    except Exception:
        film_area_factor = Decimal(str(film_area_factor_for_stock_form(chosen_form)))
    if film_area_factor <= 0:
        film_area_factor = Decimal("1")
    return {
        "stock_form": chosen_form,
        "width_basis": width_basis,
        "slit_policy": slit_policy,
        "film_area_factor": film_area_factor,
    }


def compute_stock_geometry(style, inputs: Dict[str, Any], stock_form: Any = None, override_width: Any = None) -> Dict[str, Any]:
    """
    Compute both widths required by the rest of the ERP:

    - stock_width_mm: the physical roll width / lay-flat width operators stock
      and allocate.
    - film_area_width_mm: the width used in BOM/costing film area.

    For OPEN_WEB they are the same. For LAYFLAT_TUBE the film-area width is
    2x the lay-flat stock width, so tube purchases are not under-costed.
    """
    cfg = stock_form_config(style, stock_form=stock_form)
    stock_width = _to_dec(override_width) if override_width not in (None, "") else compute_child_target_width_mm(style, inputs)
    if stock_width < 0:
        stock_width = Decimal("0")
    film_area_width = (stock_width * cfg["film_area_factor"]).quantize(Decimal("0.01"))
    return {
        "stock_width_mm": stock_width.quantize(Decimal("0.01")),
        "child_target_width_mm": stock_width.quantize(Decimal("0.01")),
        "film_area_width_mm": film_area_width,
        "stock_form": cfg["stock_form"],
        "width_basis": cfg["width_basis"],
        "slit_policy": cfg["slit_policy"],
        "film_area_factor": cfg["film_area_factor"],
    }


_CLOSED_FORMULAS = {
    "SIMPLE_DOUBLE",
    "THREE_SIDE_SEAL",
    "GUSSETED_SIDE",
    "GUSSETED_BOTTOM",
    "QUAD_SEAL",
    "FLAT_BOTTOM",
    "CENTER_SEAL_H",
    "SPOUT",
    "STICK_PACK",
    "SACHET",
}


def _eval_closed_formula(kind: str, params: Dict[str, Any], adj: Dict[str, Any], inputs: Dict[str, Any]) -> float:
    width = _input_float(inputs, "W", "width", "width_mm")
    height = _input_float(inputs, "H", "height", "height_mm")
    gusset = _input_float(inputs, "G", "gusset", "gusset_mm")
    flap = _input_float(inputs, "flap", "flap_mm")
    trim = _safe_float(params.get("trim_mm", adj.get("trim_default_mm", 0)))

    if kind in {"SIMPLE_DOUBLE", "THREE_SIDE_SEAL", "SACHET"}:
        return 2 * width + trim
    if kind in {"GUSSETED_SIDE", "QUAD_SEAL"}:
        return 2 * (width + gusset) + trim
    if kind == "GUSSETED_BOTTOM":
        bottom_factor = _safe_float(params.get("bottom_factor", inputs.get("bottom_factor", 1.0)), default=1.0)
        return 2 * width + gusset * bottom_factor + trim
    if kind == "FLAT_BOTTOM":
        return 2 * width + 2 * gusset + trim
    if kind == "CENTER_SEAL_H":
        overlap = _input_float(inputs, "overlap", "overlap_mm")
        if not overlap:
            overlap = _safe_float(params.get("overlap_mm", params.get("overlap", 0)))
        return height + overlap + trim
    if kind == "SPOUT":
        return 2 * width + flap + trim
    if kind == "STICK_PACK":
        stick_factor = _safe_float(params.get("stick_factor", inputs.get("stick_factor", 1.0)), default=1.0)
        return width * stick_factor + trim
    return 0.0


def _eval_linear(params: Dict[str, Any], adj: Dict[str, Any], inputs: Dict[str, Any]) -> float:
    """
    Evaluate a LINEAR formula.

    Term shapes accepted (mixed within the same list is OK):

      Modern · product chain
        {"factors": [
            {"kind": "NUMBER", "value": 2},
            {"kind": "FIELD",  "field": "W"},
            {"kind": "FIELD",  "field": "bottom_factor"}
        ]}
        → 2 × W × bottom_factor

      Legacy · single coefficient × field
        {"field": "W", "coefficient": 2}
        → 2 × W

    All terms are summed, then trim_mm is added once.
    """
    terms = params.get("terms", [])
    if not isinstance(terms, list):
        terms = []
    total = 0.0

    for term in terms:
        if not isinstance(term, dict):
            continue

        factors = term.get("factors")
        if isinstance(factors, list) and factors:
            product = 1.0
            saw_anything = False
            for f in factors:
                if not isinstance(f, dict):
                    continue
                kind = str(f.get("kind", "")).upper()
                if kind == "NUMBER":
                    product *= _safe_float(f.get("value", 0))
                    saw_anything = True
                elif kind == "FIELD":
                    field = str(f.get("field") or "")
                    if field:
                        product *= _safe_float(inputs.get(field, 0))
                        saw_anything = True
                # silently skip unknown kinds
            if saw_anything:
                total += product
            continue

        # Legacy single-field form
        field = str(term.get("field") or "")
        if field:
            coeff = _safe_float(term.get("coefficient", 1.0), default=1.0)
            value = _safe_float(inputs.get(field))
            total += coeff * value

    trim = _safe_float(params.get("trim_mm", adj.get("trim_default_mm", 0)))
    total += trim
    return total


def _eval_ast(node: Any, inputs: Dict[str, Any], params: Dict[str, Any], depth: int = 0) -> float:
    if depth > _AST_MAX_DEPTH:
        raise ValueError("Formula AST too deep")
    if not isinstance(node, dict):
        raise ValueError("AST node must be an object")

    op = str(node.get("op", "")).upper()

    if op == "NUM":
        return _safe_float(node.get("value", 0))
    if op == "VAR":
        name = str(node.get("name", "") or "")
        return _safe_float(inputs.get(name, 0))
    if op == "PARAM":
        name = str(node.get("name", "") or "")
        return _safe_float(params.get(name, 0))

    if op in _BINARY_OPS:
        left = _eval_ast(node.get("left"), inputs, params, depth + 1)
        right = _eval_ast(node.get("right"), inputs, params, depth + 1)
        if op == "+":
            return left + right
        if op == "-":
            return left - right
        if op == "*":
            return left * right
        if op == "/":
            if right == 0:
                return 0.0
            return left / right

    raise ValueError(f"Unsupported AST op: {op!r}")


def _safe_dict(value: Any) -> Dict[str, Any]:
    if isinstance(value, dict):
        return value
    return {}


def _safe_float(value: Any, default: float = 0.0) -> float:
    if value in (None, ""):
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _input_float(inputs: Dict[str, Any], *names: str) -> float:
    for name in names:
        value = inputs.get(name)
        if value not in (None, ""):
            return _safe_float(value)
    return 0.0


def _to_dec(value: float) -> Decimal:
    try:
        d = Decimal(str(value or 0))
    except Exception:
        d = Decimal("0")
    return d.quantize(Decimal("0.01"))
