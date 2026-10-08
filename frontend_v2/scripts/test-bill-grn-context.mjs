import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Execute the real hook with a persistent hook-state harness. No HTTP or stock
// writes are performed: callbacks record the exact body they would send.
const source = fs.readFileSync("src/components/inventory/gate-bills/bill-grn-context.tsx", "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const billA = "00000000-0000-4000-8000-000000000001";
const billB = "00000000-0000-4000-8000-000000000002";
let params, bill, cells, cursor, tokenCount;
const invalidations = [];
const state = (initial) => {
  const index = cursor++;
  if (!(index in cells)) cells[index] = typeof initial === "function" ? initial() : initial;
  return [cells[index], (value) => { cells[index] = typeof value === "function" ? value(cells[index]) : value; }];
};
const jsx = (type, props) => ({ type, props });
const imports = {
  react: { useCallback: (fn) => fn, useRef: (initial) => state({ current: initial })[0], useState: state },
  "react/jsx-runtime": { jsx, jsxs: jsx },
  "next/navigation": { useSearchParams: () => params, usePathname: () => "/inventory/grn" },
  "next/link": { __esModule: true, default: "Link" },
  "@tanstack/react-query": { useQueryClient: () => ({}), useQuery: () => ({}) },
  "@/lib/api": { getApiErrorStatus: (e) => e?.response?.status },
  "@/lib/utils": { cn: () => "" },
  "@/services/gate-bills": { BILL_STATUS_META: {}, gateBillsApi: {} },
  "@/components/gate/use-gate-operation": { newClientToken: () => `frozen-token-${++tokenCount}`, isUncertainFailure: (e) => !e?.response?.status || e.response.status >= 500, gateErrorMessage: () => "unavailable" },
  "./bill-detail": { useBill: () => ({ data: bill, isLoading: false }), invalidateBillViews: (_qc, id) => invalidations.push(id) },
  "./bill-common": { billRef: (id) => id },
};
const module = { exports: {} };
vm.runInNewContext(output, { module, exports: module.exports, require: (name) => imports[name] || {}, console });
const { useGrnBillContext, GrnBillBanner } = module.exports;
const reset = (query = `inward_bill_id=${billA}`, status = "PENDING_GRN") => {
  params = new URLSearchParams(query);
  bill = { id: billA, status, plant: "plant-a", plant_name: "A", pages: [], receipt_refs: [] };
  cells = []; cursor = 0; tokenCount = 0; invalidations.length = 0;
};
const render = () => { cursor = 0; return useGrnBillContext(); };

reset();
let ctx = render();
const sent = [];
const draft = { vendor_invoice_no: "INV-1", klass: "BULK", lines: [{ qty: "5", uom: "KG" }] };
await assert.rejects(ctx.wrapPost("UNIFIED", draft, async (body) => { sent.push(body); throw { response: { status: 503 } }; }));
assert.equal(sent.length, 1);
draft.lines[0].qty = "999";

params = new URLSearchParams(`inward_bill_id=${billB}`);
bill = { ...bill, id: billB };
ctx = render();
await assert.rejects(ctx.wrapPost("UNIFIED", draft, async () => { throw new Error("must not call changed bill"); }), /original bill/);
assert.equal(ctx.pendingBillId, billA);
assert.equal(ctx.pendingRetryHref, `/inventory/grn?inward_bill_id=${billA}`);
assert.ok(JSON.stringify(GrnBillBanner({ ctx })).includes(ctx.pendingRetryHref));

params = new URLSearchParams("");
ctx = render();
await assert.rejects(ctx.wrapPost("UNIFIED", draft, async () => { throw new Error("must not post unlinked"); }), /original bill/);
assert.ok(JSON.stringify(GrnBillBanner({ ctx })).includes(ctx.pendingRetryHref));

params = new URLSearchParams(`inward_bill_id=${billA}`);
bill = { ...bill, id: billA, status: "RECEIPTED" };
ctx = render();
await assert.rejects(ctx.wrapPost("TRADING", draft, async () => { throw new Error("must not call another receiving type"); }), /original receiving type/);
const response = await ctx.wrapPost("UNIFIED", { ...draft, vendor_invoice_no: "CHANGED" }, async (body) => { sent.push(body); return { inward_bill: { id: billA, status: "RECEIPTED" } }; });
assert.equal(sent.length, 2);
assert.deepEqual(sent[0], sent[1]);
assert.equal(sent[1].lines[0].qty, "5");
assert.equal(sent[1].bill_complete, false);
assert.equal(tokenCount, 1);
params = new URLSearchParams(`inward_bill_id=${billB}`);
bill = { ...bill, id: billB, status: "PENDING_GRN" };
ctx = render();
ctx.onPosted(response, "Original receipt");
assert.deepEqual(invalidations, [billA]);
ctx = render();
assert.equal(ctx.lastLinked.billId, billA);
params = new URLSearchParams(`inward_bill_id=${billA}`);
bill = { ...bill, id: billA, status: "RECEIPTED" };
ctx = render();
await assert.rejects(ctx.wrapPost("UNIFIED", draft, async () => { throw new Error("must not post closed bill"); }), /already closed/);

for (const query of ["inward_bill_id=", "inward_bill_id=invalid"]) {
  reset(query); bill = undefined; ctx = render();
  assert.equal(ctx.requested, true);
  await assert.rejects(ctx.wrapPost("UNIFIED", draft, async () => { throw new Error("must not call invalid context"); }), /invalid/);
}
reset(`inward_bill_id=${billA}`); bill = undefined; ctx = render();
await assert.rejects(ctx.wrapPost("UNIFIED", draft, async () => { throw new Error("must not call unavailable context"); }), /Wait for the gate bill/);
reset(); ctx = render();
await assert.rejects(ctx.wrapPost("UNIFIED", { vendor_invoice_no: " " }, async () => { throw new Error("must not call without reference"); }), /invoice or delivery reference/);
reset(""); ctx = render();
assert.equal(await ctx.wrapPost("UNIFIED", draft, async (body) => body), draft);
console.log("Bill GRN retry/context regression passed: frozen body/token, changed/removed/invalid/closed context, kind isolation, original retry link and ordinary posting.");
