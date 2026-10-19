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

## Second pass (18 Oct 2026) — bolder layout + full spec everywhere

- WC terminal detail pane is a real dossier: card **1 · What it is** (order, spine, made-card, step target), card
  **2 · What it needs** grouping rolls-by-lane (full width), machine, materials and the cylinder/artwork gate in a
  grid, with **Input issue** folded into a drawer that opens itself when entries are unsaved or material is blocked;
  card **3 · Ready?** (release), card **4 · Where the rolls came from**. Every action, gate and endpoint unchanged.
- Made-card now shows the whole spec on every screen: size with gusset, pouch style, each layer as
  `L1 PET 12 µ · bought`, `L2 LD MW 50 µ · FOOD · made here`, laminate gauge, print method · colours · artwork code,
  unit weight · order kg, lanes, route, due. Backend `made.layers[]` carries material, micron, grade (resolved
  from RecipeGrade), source, density, width and kg per layer. Shown on order page, WC, machine, planner Plan Queue
  order detail and the packing yard.
- Spine strip is larger by default (compact only inside dark headers).
- Product master edit: visible banners `1 · What it is / 2 · What is fixed / 3 · What sales choose` above each
  group; sections ordered the same way.
- Composer: the order note field is labelled "Client note · prints on the dispatch slip when written".
- Local demo data: `python manage.py seed_local_floor_demo` (see docs in the command) builds a live-like floor so
  the stack can be exercised end to end on the local E2E database.

## Third pass (18 Oct 2026) — calm design system, seven-workspace sidebar, large spec

- **Design system (Fable 5.1 design pass, merged from `design/calm-ui-20261018`)**: flat neutral canvas, white
  hairline cards, one accent, soft shadows, 10/14 px radii, sentence-case labels, quiet badges/tables/buttons,
  light page headers instead of gradient banners (PageHero, GradientHero, planner/ds heroes, product-master
  sections, header, WC/machine headers, composer hero and cart bar), light + dark tokens. Token names unchanged;
  a scoped compatibility layer keeps old white-on-navy utilities readable inside the now-light heroes.
- **Sidebar = seven workspaces** (Products, Orders, Plan, Floor, Stock, Yard & Dispatch, Reports & admin) with
  every old section folded under "All screens" (opens automatically on a page outside the workspaces).
  A workspace shows when any of its screens is in the user's sidebar today (`accessibleWorkspaces`), so role
  defaults and per-user permission overrides carry over with no second role mapping. `npm run
  test:workspace-roles` checks every role: no screen lost, no access added.
- **Spec block** (`components/spine/spec-block.tsx`): size large, then each layer with name, micron (large),
  grade and source, plus total gauge — on the orders list, order lines, composer line, made-card (order, WC,
  machine, planner, yard), planner queue rows, WC queue cards and the machine queue rail. Order line layer
  snapshots now carry `grade_name` at read time (snapshot rows are not modified).
- Orders list: calm header, neutral KPI tiles (status colour on the number), header and rows share one column
  template with a wider spec column.

Checks: typecheck, lint, nav:validate, test:workspace-roles, next build; backend suite 1517 OK.

## Fourth pass (19 Oct 2026) — the spec plate, step layouts, app-wide calm

Approved samples: order composer, product master editor and stock launcher (artifacts linked in the session).

- **Spec plate** (`components/plate/spec-plate.tsx`): one dark surface for "what is being made" — size in large
  numerals, every layer with micron and grade, total gauge, and a cross-section drawn to scale (outer layer on
  top, adhesive line between layers, film colours from new `--film-*` tokens). Used by the composer (open and
  closed lines), product master editor and view, stock launcher and every `MadeCard` (order page, WC terminal,
  machine screen, planner, packing yard). New tokens `--plate*` / `--film-*` in light and dark.
- **Shared blocks** (`components/plate/steps.tsx`): numbered `StepSection`, `ChoiceCard`, `StatTile`,
  `CheckRow`, `Pill`, fixed `ActionBar`. `SectionCardV3`, `ValidationFooter`, `StepStrip` and the live BOM rail
  restyled to match (no coloured stripes, neutral numbers, readable labels).
- **Order composer**: header with an Order / Quotation switch (quotation start screen pre-selects the customer),
  customer card, product search bar (⌘K) with the customer's usual items as chips, line cards with the plate,
  the open line as numbered steps (Product, Size, Layers, Quantity & rate, Print & artwork, Packing, More options
  for lane / add-ons / wastage), live preview with readiness first, note for dispatch, readiness card and a fixed
  place bar (Make for stock · Save as quotation · Place order ⌘↵). Rate and quantity select their text on focus.
  Same fields, payload and checks as before.
- **Product master editor**: page header, section list as a left column on wide screens (sticky bar below),
  numbered sections, plain fields, layer cards and summaries without tinted gradients, pinned plate +
  anatomy + live BOM on the right. New-master dialog uses the same numbered steps. Product master view header
  is a summary card beside the plate.
- **Stock launcher**: header with decision status, three decision cards side by side (What to build ·
  Commitment · Build up to with a tap-to-stop route list that still sets start and stop), plate with stock form
  and WIP width, size and layers card, quantity card with the derived strategy/class/output/owner always
  visible, and a side rail for blockers, required material, matching demand, commitment safety and the BOM.
  The control tower's duplicate tab strip is removed (the workspace bar lists the same seven tabs by role;
  keys 1–7 still switch tabs).
- **App-wide**: ~280 tinted gradients flattened (status colours kept), 28 decorative blur blobs hidden, 640
  all-caps field labels made sentence case, shell uses `overflow-x-clip` so sticky rails and step lists work,
  fixed bars start after the sidebar (`--sidebar-width`).
- `next.config.mjs` accepts `NEXT_DIST_DIR` so a second local dev server can build into its own folder.
