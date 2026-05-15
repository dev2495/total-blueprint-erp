# Product Master, Artwork, WIP, Packaging Final Green Report - 2026-05-13

Worktree: `/Users/devarshthakkar/local_repos/erp total/.claude/worktrees/optimistic-borg-130fe2`

## Final Model Implemented

- Product Master owns the stable engineering contract: route template, layer identity, size geometry, allowed axes, packaging/POD contract, and print capability.
- Variant tuples are created from sales/planner axis choices. Size, layer thickness, layer grade where required, layer width override, POD, add-ons, packaging, and artwork choices combine into a canonical tuple.
- Thickness presets are only suggestions. Any positive micron value can be entered; extrusion BOM selection still uses the active recipe thickness range for the selected film variant and grade.
- Purchased film layers do not require grade. Extrudable film layers still resolve grade from the grade master and extrusion recipe.
- Sales order creation now sends eligible orders directly to the planner queue. Draft is not exposed on the create page.
- Generic WIP stock uses the invariant signature before artwork/customer lock. Artwork/customer committed WIP locks only the selected scope. This keeps reusable roll pools without requiring a separate generic Product Master.
- Packaging and POD replenishment can point to exact in-house Product Masters through production defaults, so stock launcher and auto-demand create the right internal production order.

## Artwork And Colorway Model

- Artwork is now the production print asset/colorway, not only an image.
- Each artwork can carry:
  - print type: FLEXO, ROTO, DIGITAL
  - substrate mode: SHEET or TUBING
  - front/back colors and color counts
  - design family and colorway name
  - inventory ink mapping
- Ink mapping is validated against the real `InkMaterial` inventory master.
- Mapping supports:
  - direct color to ink id
  - color to film base map, for example `{ "CYAN": { "POLY": "...", "PET": "..." } }`
- Sales BOM resolution now pulls artwork color mapping into the printing snapshot, so ink BOM and consumption use inventory ink materials instead of free text colors.
- Printing enabled without artwork remains allowed as a planner gate. It creates a planning-required order with artwork assignment required, so warning/tape/plain printing can be handled without fake artwork while true artwork jobs remain blocked until assigned.
- Product Master print method/web form are fallback defaults only. They do not restrict the master to only ROTO/SHEET. The selected artwork/colorway overrides with actual method, sheet/tubing mode, color counts, ink mapping, and cylinder requirements.

## Packing And EOD Consumption Model

- Product Master packing contract stores allowed catalog SKUs and rules, not per-order manual quantities.
- `PRIMARY_INNER` can allow multiple inner pouch SKUs. Sales chooses the category/SKU, then consumption is automatic by `ceil(total_pouches / pcs_per_inner)`.
- Inner pouch can be purchased or in-house; in-house replenishment is launched through the Product Master/stock launcher demand path.
- `FINAL_GUNNY` is consumed from Packing Yard sealed-count events.
- Tape, sheet, labels, tags, boxes, cartons, and extra packing SKUs are only allow-listed on the master/order. They are consumed from the evening open-close packing count and allocated back to same-day orders that allowed those SKUs.
- Inventory packaging workspace now shows EOD consumed quantity, mapped order count, unassigned count-short quantity, and top consumed materials so the packing material cycle is visible from inventory, not only logistics.

## Sample Data Created

Seed command recreated clean Codex samples and removed prior Codex sample masters/orders first.

Product Masters:

- `PM-CODEX-DRYFRUIT-3L`
- `PM-CODEX-MANGO-3L`
- `PM-CODEX-BOPP-VARIABLE`
- `PM-CODEX-BOPP-1L-VARIABLE`
- `PM-CODEX-INNER-POUCH-PACK`
- `PM-CODEX-POD-FILM`

Sales sample orders created:

- direct sales
- artwork pending
- artwork assigned 2F
- artwork assigned 3F other design
- same design alternate colorway
- POD 220 stock available
- POD 260 auto-demand
- BOPP single layer with no grade requirement

All sample sales orders landed in `PLANNING_REQUIRED`, which is the planner queue state.

## Verification

Backend:

- `manage.py check`: passed
- `makemigrations --check --dry-run`: no changes detected
- Targeted tests: 18 passed
- Sample seed/e2e API command: all GRN, stock launcher, sales, packaging demand, and POD demand checks passed

Frontend:

- `npm run typecheck`: passed
- Production build via `./start_all.sh restart`: passed
- `npm run help:validate`: passed
- `npm run nav:validate`: passed
- `./start_all.sh verify`: deep route and static asset verification passed
- Packing EOD metric backend test: `apps.production.tests.test_packing_count_service` passed, including snapshot `eod_allocation`.
- Focused inventory/packing browser gates: `inventory-workspace.spec.ts` and `packaging-proof.spec.ts` passed after the final routing model update.

Browser/UI:

- Browser plugin rendered login but could not complete interaction because of local browser-control clipboard/runtime issue.
- Playwright Chrome fallback against the live server passed 6/6 gate tests:
  - sales create and Product Master lanes
  - inventory workspace
  - inventory filters
  - packaging proof
  - stock lifecycle workspace
  - stock lifecycle legacy redirects

Local server:

- Frontend: `http://127.0.0.1:3001/login`
- Backend: `http://127.0.0.1:8000/api/health/`
- LAN frontend: `http://192.168.0.229:3001/login`
- LAN backend: `http://192.168.0.229:8000/api/health/`

## Notes Before Commit

- The working tree contains a large set of prior Claude/Codex changes beyond this final patch. Review/stage carefully instead of blindly committing everything.
- The only verification warning seen is the existing Next.js custom font warning in `src/app/layout.tsx`; it does not fail build or runtime checks.
