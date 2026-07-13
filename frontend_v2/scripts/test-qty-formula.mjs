import assert from "node:assert/strict";

import { evaluateQtyFormula } from "../src/lib/qty-formula.mjs";

assert.equal(
  evaluateQtyFormula("ceil(total_pouches / pcs_per_inner)", {
    total_pouches: 100,
    pcs_per_inner: 24,
  }),
  5,
);
assert.equal(evaluateQtyFormula("floor(total_kg / 3)", { total_kg: 10 }), 3);
assert.equal(evaluateQtyFormula("round(2.5)"), 2);
assert.equal(evaluateQtyFormula("round(3.5)"), 4);
assert.equal(evaluateQtyFormula("-(fixed_qty + 2) * 3", { fixed_qty: 2 }), -12);
assert.equal(evaluateQtyFormula("total_pcs + fixed_qty   ", { total_pcs: 3 }), 3);
assert.throws(() => evaluateQtyFormula("__import__('os')"), /Unsupported|Expected/);
assert.throws(() => evaluateQtyFormula("total_pcs / 0", { total_pcs: 3 }), /divide by zero/);
assert.throws(() => evaluateQtyFormula("total_pcs ** 2", { total_pcs: 3 }), /Expected|trailing/);

console.log("Quantity formula parser checks passed.");
