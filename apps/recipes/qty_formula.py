import ast
import math
import operator


ALLOWED_BINOPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
}
ALLOWED_FUNCS = {
    "ceil": math.ceil,
    "floor": math.floor,
    "round": round,
}
ALLOWED_TOKENS = {
    "fixed_qty",
    "pcs_per_inner",
    "total_kg",
    "total_pouches",
    "total_pcs",
}


def evaluate_qty_formula(formula: str, context: dict) -> float:
    """
    Evaluate the tiny quantity-expression language used by catalog-backed
    ProductMaster axes. This intentionally rejects attributes, imports,
    comprehensions, indexing, and arbitrary function calls.
    """
    tree = ast.parse(str(formula or "0"), mode="eval")

    def _eval(node):
        if isinstance(node, ast.Expression):
            return _eval(node.body)
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            return float(node.value)
        if isinstance(node, ast.Name):
            if node.id not in ALLOWED_TOKENS:
                raise ValueError(f"Disallowed name: {node.id}")
            return float((context or {}).get(node.id, 0) or 0)
        if isinstance(node, ast.BinOp) and type(node.op) in ALLOWED_BINOPS:
            return ALLOWED_BINOPS[type(node.op)](_eval(node.left), _eval(node.right))
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in ALLOWED_FUNCS:
            return float(ALLOWED_FUNCS[node.func.id](*[_eval(arg) for arg in node.args]))
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
            return -_eval(node.operand)
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.UAdd):
            return _eval(node.operand)
        raise ValueError(f"Disallowed expression: {ast.dump(node)}")

    return float(_eval(tree))
