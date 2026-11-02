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
    FOLDABLE_FORMS,
    FORMULA_BASIS_OPEN,
    FORMULA_BASIS_STOCK,
    STOCK_FORM_OPEN_WEB,
    default_slit_policy,
    default_width_basis,
    film_area_factor_for_stock_form,
    fold_as_json,
    folded_width_from_open,
    normalize_fold,
    normalize_formula_basis,
    normalize_slit_policy,
    normalize_stock_form,
    normalize_width_basis,
    open_width_for,
)


_AST_MAX_DEPTH = 64
_BINARY_OPS = {"+", "-", "*", "/"}

_WIDTH_FIELDS = {"W", "WIDTH", "WIDTH_MM"}
_HEIGHT_FIELDS = {"H", "HEIGHT", "HEIGHT_MM"}
_CLOSED_FORMULA_AXIS = {
    "SIMPLE_DOUBLE": "WIDTH",
    "THREE_SIDE_SEAL": "WIDTH",
    "GUSSETED_SIDE": "WIDTH",
    "GUSSETED_BOTTOM": "WIDTH",
    "QUAD_SEAL": "WIDTH",
    "FLAT_BOTTOM": "WIDTH",
    "CENTER_SEAL_H": "HEIGHT",
    "SPOUT": "WIDTH",
    "STICK_PACK": "WIDTH",
    "SACHET": "WIDTH",
}


def normalize_formula_axis(value: Any) -> str:
    """Return the canonical finished dimension used to build stock/web width."""
    raw = str(value or "").strip().upper()
    return {
        "W": "WIDTH",
        "H": "HEIGHT",
        "WEB_WIDTH_FROM_W": "WIDTH",
        "WEB_WIDTH_FROM_H": "HEIGHT",
    }.get(raw, raw)


def _dimension_axis_for_fields(fields: Iterable[Any]) -> str | None:
    canonical = {str(field or "").strip().upper() for field in fields}
    uses_width = bool(canonical & _WIDTH_FIELDS)
    uses_height = bool(canonical & _HEIGHT_FIELDS)
    if uses_width == uses_height:
        # No finished dimension, or both dimensions, cannot be inferred safely.
        return None
    return "WIDTH" if uses_width else "HEIGHT"


def _linear_formula_fields(params: Dict[str, Any]) -> set[str]:
    fields: set[str] = set()
    terms = params.get("terms") if isinstance(params, dict) else []
    for term in terms if isinstance(terms, list) else []:
        if not isinstance(term, dict):
            continue
        factors = term.get("factors")
        if isinstance(factors, list):
            for factor in factors:
                if isinstance(factor, dict) and str(factor.get("kind") or "").upper() == "FIELD":
                    fields.add(str(factor.get("field") or ""))
        elif term.get("field") not in (None, ""):
            fields.add(str(term.get("field")))
    return fields


def _ast_formula_fields(node: Any) -> set[str]:
    if not isinstance(node, dict):
        return set()
    fields: set[str] = set()
    if str(node.get("op") or "").upper() == "VAR" and node.get("name") not in (None, ""):
        fields.add(str(node.get("name")))
    for key in ("left", "right"):
        fields.update(_ast_formula_fields(node.get(key)))
    return fields


def infer_formula_roll_axis(
    formula_kind: Any,
    formula_params: Any = None,
    formula_ast: Any = None,
) -> str | None:
    """Infer the finished dimension that the stock-width formula consumes.

    The other finished dimension is the per-piece cut pitch.  Auxiliary fields
    such as flap, gusset, HD, or trim do not change that relationship.
    """
    kind = str(formula_kind or "LINEAR").strip().upper()
    if kind in _CLOSED_FORMULA_AXIS:
        return _CLOSED_FORMULA_AXIS[kind]
    if kind == "LINEAR":
        return _dimension_axis_for_fields(_linear_formula_fields(_safe_dict(formula_params)))
    if kind == "CUSTOM_AST":
        return _dimension_axis_for_fields(_ast_formula_fields(_safe_dict(formula_ast)))
    return None


def formula_axis_contract_error(
    *,
    default_roll_axis: Any,
    formula_kind: Any,
    formula_params: Any = None,
    formula_ast: Any = None,
) -> str:
    declared = normalize_formula_axis(default_roll_axis)
    inferred = infer_formula_roll_axis(formula_kind, formula_params, formula_ast)
    if inferred and declared != inferred:
        return (
            f"Formula consumes {inferred.lower()} to build the stock/web width, "
            f"but the declared roll axis is {declared.lower() or 'missing'}. "
            f"Set default_roll_axis to {inferred}."
        )
    return ""


def resolved_formula_roll_axis(style: Any) -> str:
    """Resolve the authoritative web-formula axis, self-healing legacy bad data."""
    inferred = infer_formula_roll_axis(
        getattr(style, "formula_kind", None),
        getattr(style, "formula_params", None),
        getattr(style, "formula_ast", None),
    )
    declared = normalize_formula_axis(getattr(style, "default_roll_axis", None))
    return inferred or (declared if declared in {"WIDTH", "HEIGHT", "BOTH", "NONE"} else "WIDTH")


def consumption_pitch_axis(web_formula_axis: Any) -> str:
    axis = normalize_formula_axis(web_formula_axis)
    if axis == "WIDTH":
        return "HEIGHT"
    if axis == "HEIGHT":
        return "WIDTH"
    return ""


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
    fold = normalize_fold(raw) if chosen_form in FOLDABLE_FORMS else normalize_fold(None)
    formula_basis = normalize_formula_basis(raw.get("formula_basis")) if chosen_form in FOLDABLE_FORMS else FORMULA_BASIS_STOCK
    return {
        "stock_form": chosen_form,
        "width_basis": width_basis,
        "slit_policy": slit_policy,
        "film_area_factor": film_area_factor,
        "fold": fold,
        "formula_basis": formula_basis,
        # The formula input that is the fold's flap (e.g. "Flap"): each size's own flap, not one style value.
        "flap_field": str(raw.get("flap_field") or "").strip() if chosen_form in FOLDABLE_FORMS else "",
    }


def flap_from_inputs(inputs: Dict[str, Any], field: str, default: Decimal) -> Decimal:
    """The size's value of the formula field that is the fold flap.

    The named field wins (exact, then any case). The generic flap / flap_mm keys (the size's flap tape,
    often 0) are only a fallback and only when they hold a value above 0.
    """
    def number(value):
        try:
            parsed = Decimal(str(value))
        except Exception:
            return None
        return parsed if parsed > 0 else Decimal("0")

    inputs = inputs or {}
    if inputs.get(field) not in (None, ""):
        found = number(inputs.get(field))
        if found is not None:
            return found
    for key, value in inputs.items():
        if str(key).lower() == field.lower() and value not in (None, ""):
            found = number(value)
            if found is not None:
                return found
    if "flap" in field.lower():
        for key in ("flap", "flap_mm"):
            found = number(inputs.get(key)) if inputs.get(key) not in (None, "") else None
            if found:
                return found
    return default


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
    fold = cfg["fold"]
    if cfg["flap_field"]:
        fold = {**fold, "flap_mm": flap_from_inputs(inputs, cfg["flap_field"], fold["flap_mm"])}
    open_from_formula = None
    if cfg["stock_form"] in FOLDABLE_FORMS and cfg["formula_basis"] == FORMULA_BASIS_OPEN:
        # The formula gives the open web before the fold: keep it as the open width and the film area
        # (so rolls before the fold and kg targets match the open-web math), and fold it to the stored width.
        open_from_formula = stock_width.quantize(Decimal("0.01"))
        stock_width = folded_width_from_open(open_from_formula, fold)
        film_area_width = open_from_formula
    else:
        film_area_width = (stock_width * cfg["film_area_factor"] + fold["flap_mm"] + fold["seal_mm"]).quantize(Decimal("0.01"))
    result = {
        "stock_width_mm": stock_width.quantize(Decimal("0.01")),
        "child_target_width_mm": stock_width.quantize(Decimal("0.01")),
        "film_area_width_mm": film_area_width,
        "stock_form": cfg["stock_form"],
        "width_basis": cfg["width_basis"],
        "slit_policy": cfg["slit_policy"],
        "film_area_factor": cfg["film_area_factor"],
    }
    if cfg["stock_form"] in FOLDABLE_FORMS:
        result["fold"] = fold_as_json(fold)
        if open_from_formula is not None:
            result["fold"]["formula_basis"] = FORMULA_BASIS_OPEN
        if cfg["flap_field"]:
            result["fold"]["flap_field"] = cfg["flap_field"]
        result["open_width_mm"] = open_from_formula if open_from_formula is not None else open_width_for(cfg["stock_form"], stock_width, fold)
    return result


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
