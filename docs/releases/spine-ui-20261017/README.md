# Release: one order spine across the ERP (17 Oct 2026)

UI unification approved by the owner on 17 Oct 2026 from the two proposal pages ("One Order Spine", part one
and two). Layout, links and navigation only: no rule, formula, target, BOM, lane or packing logic changes.
Backend adds one read-only endpoint and exposes commercial head fields that already existed on the order.

## What users see

- **Order spine** — one strip, seven stations (Master → Quote → Order → Plan → Floor → Yard → Dispatch) with the
  live figure for each and a link to that page for the order. Shown on the sales order page, the planner plan
  queue (job sheet), the WC terminal dossier, the machine screen and the packing yard.
- **"What is to be made"** — the same made-card (qty · product · size, structure, print, route, lanes, kg, due)
  on the order page, the WC terminal and the machine screen. Figures come from one endpoint so screens agree.
- **Sales order page** — spine on top, made-card in the header, and a collapsible **Commercial head** (bill-to,
  ship-to, PO reference, payment/delivery terms, client note). This is the only screen that shows bill-to etc.
  The client note (`remarks`) prints on the dispatch slip as `NOTE :` when written (commit 923c7a3).
- **WC terminal** — the detail pane reads as a dossier: `1 · What it is` (current order + spine + made-card),
  `2 · What it needs` (rolls, machine, input issue, materials), `3 · Ready?` (release bar), and a new
  `4 · Where the rolls came from` card (latest lineage rolls on the order). Every action and gate is unchanged.
- **Machine screen** — a focus strip first: Target · Done · Left in the unit the operator counts (pieces on
  pouching, kg elsewhere) with the other unit underneath, progress bar, spine and made-card; then the output
  entry panel. The full job hero (spec rail, planner note, yield) moves into an "Order, spec and lineage"
  drawer under the entry panel. The rolls-on-the-machine card moves to the top of the right rail.
- **Planner** — Plan Queue cards use the shared job card (order · step · target, customer · line · WC, progress,
  badges); the job sheet shows the spine. **Stock launcher is now Control Tower tab 7 "Launch Stock"**
  (`/dashboard/planner/control-tower/stock-launcher`, keyboard 7). The old `/production/planner/stock-launcher`
  route redirects there and keeps `?master=` parameters; the sidebar entry points at the tab.
- **Sales order composer** — the sticky bar keeps "Create + send to planner" as the main action and adds two
  side exits: "Save as quotation" (quotation composer, customer carried) and "Make for stock" (launcher tab,
  first line's product master carried).
- **Product master edit** — the step bar groups the eight sections under three questions (1 · What it is:
  Basics, Summary · 2 · What is fixed: Layers, Printing, Adhesive · 3 · What sales choose: What sales can
  change, Sizes & web width, Add-ons & packing), the sections are ordered the same way, and on wide screens
  the live anatomy + BOM preview is pinned beside the form.
- **Packing yard** — spine above the selected order's header.

Not done on purpose (owner's call, 17 Oct): sidebar narrowing by role; bill-to anywhere except the order page.

## Backend

- `apps/sales/services/order_spine_service.py` — `OrderSpineService.for_order(order)` / `for_job(job)`; pure
  read over SalesOrder/Item, ProductionJob, FinishedGoodsBatch, PackingVerification, DeliveryChallan.
- `GET /api/sales/orders/<id>/spine/` and `GET /api/production/jobs/<id>/spine/` (stock jobs return empty
  stations). Tests: `apps/sales/tests/test_order_spine.py`.
- `SalesOrderSerializer` (canonical, `serializers_orders.py`) now returns `bill_to_address`, `ship_to_address`,
  `customer_po_reference`, `payment_terms`, `delivery_terms`, `source_quotation_revision` (read-only).

## Frontend

- `src/services/spine.ts`, `src/components/spine/{order-spine,made-card,job-card}.tsx` (react-query key
  `["order-spine", orderId, jobId]`, 30 s stale, no refetch on focus).
- Pages touched: `sales/orders/[id]`, `production/work-center/[id]`, `production/machine/[machine_id]`,
  `components/planner/queue-tab.tsx`, control-tower `layout.tsx` + new `stock-launcher/page.tsx`,
  `production/planner/stock-launcher/page.tsx` (redirect), `lib/sidebar-nav.ts`, `lib/navigation-routes.ts`,
  `logistics/packing/page.tsx`, `components/sales-order-create/sales-order-workspace.tsx`,
  `components/product-master/{pm-step-nav,product-master-edit}.tsx`.
- Checks: `npm run typecheck`, `npm run lint`, `npm run nav:validate`, `npm run build` all green; theme-token
  guard passed (no raw colours).

## Verification before go-live

Local stack (backend 8401 on the seeded E2E database, frontend 3401 production build) reviewed in the browser
with the local test admin. Go-live only on the owner's word after that review; release scripts follow the
`.runtime/release-*` pattern (PARENT = live commit, no migration, no env change).
