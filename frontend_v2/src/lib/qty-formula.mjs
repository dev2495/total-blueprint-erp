const ALLOWED_NAMES = new Set([
  "fixed_qty",
  "pcs_per_inner",
  "total_kg",
  "total_pouches",
  "total_pcs",
]);
const ALLOWED_FUNCTIONS = new Set(["ceil", "floor", "round"]);

function pythonRound(value) {
  const lower = Math.floor(value);
  const fraction = value - lower;
  if (Math.abs(fraction - 0.5) <= Number.EPSILON * Math.max(1, Math.abs(value))) {
    return lower % 2 === 0 ? lower : lower + 1;
  }
  return Math.round(value);
}

function tokenize(formula) {
  const text = String(formula || "0");
  const tokens = [];
  const tokenPattern = /\s*(?:(\d+(?:\.\d*)?|\.\d+)|([A-Za-z_][A-Za-z0-9_]*)|([()+\-*/,]))/y;
  let offset = 0;

  while (offset < text.length) {
    if (!text.slice(offset).trim()) break;
    tokenPattern.lastIndex = offset;
    const match = tokenPattern.exec(text);
    if (!match) {
      throw new Error(`Unsupported quantity formula token at position ${offset + 1}.`);
    }
    if (match[1] !== undefined) tokens.push({ type: "number", value: match[1] });
    else if (match[2] !== undefined) tokens.push({ type: "name", value: match[2] });
    else tokens.push({ type: "operator", value: match[3] });
    offset = tokenPattern.lastIndex;
  }
  tokens.push({ type: "eof", value: "" });
  return tokens;
}

/**
 * Evaluate the same deliberately tiny arithmetic language as
 * apps/recipes/qty_formula.py.  This parser never converts strings to code.
 *
 * @param {string} formula
 * @param {Record<string, number>} context
 * @returns {number}
 */
export function evaluateQtyFormula(formula, context = {}) {
  const tokens = tokenize(formula);
  let index = 0;

  const current = () => tokens[index];
  const consume = (value) => {
    const token = current();
    if (token.value !== value) throw new Error(`Expected '${value}' in quantity formula.`);
    index += 1;
  };

  const parsePrimary = () => {
    const token = current();
    if (token.type === "number") {
      index += 1;
      return Number(token.value);
    }
    if (token.value === "(") {
      index += 1;
      const value = parseExpression();
      consume(")");
      return value;
    }
    if (token.type === "name") {
      index += 1;
      const name = token.value;
      if (current().value === "(") {
        if (!ALLOWED_FUNCTIONS.has(name)) {
          throw new Error(`Unsupported quantity formula function: ${name}.`);
        }
        index += 1;
        const value = parseExpression();
        consume(")");
        if (name === "ceil") return Math.ceil(value);
        if (name === "floor") return Math.floor(value);
        return pythonRound(value);
      }
      if (!ALLOWED_NAMES.has(name)) {
        throw new Error(`Unsupported quantity formula name: ${name}.`);
      }
      const value = Number(context[name] ?? 0);
      if (!Number.isFinite(value)) throw new Error(`Quantity formula value for ${name} is not finite.`);
      return value;
    }
    throw new Error("Expected a number, allowed name, or parenthesized expression in quantity formula.");
  };

  const parseUnary = () => {
    if (current().value === "+") {
      index += 1;
      return parseUnary();
    }
    if (current().value === "-") {
      index += 1;
      return -parseUnary();
    }
    return parsePrimary();
  };

  const parseTerm = () => {
    let value = parseUnary();
    while (current().value === "*" || current().value === "/") {
      const operator = current().value;
      index += 1;
      const right = parseUnary();
      if (operator === "/" && right === 0) throw new Error("Quantity formula cannot divide by zero.");
      value = operator === "*" ? value * right : value / right;
    }
    return value;
  };

  function parseExpression() {
    let value = parseTerm();
    while (current().value === "+" || current().value === "-") {
      const operator = current().value;
      index += 1;
      const right = parseTerm();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  }

  const result = parseExpression();
  if (current().type !== "eof") throw new Error("Quantity formula contains trailing input.");
  if (!Number.isFinite(result)) throw new Error("Quantity formula result is not finite.");
  return result;
}
