# What changed, newest first (release notes)
These describe the latest behaviour; when they conflict with older text, the newest wins.

---



## Sales → Orders → Create, on the approved sample

The order payload sent to the planner is unchanged (same fields, same checks, same blockers). What changed
is how the order is put together:

- **Start.** Until a customer is set the page asks one question, *Who is this order for?*: type two letters
  (arrow keys + Enter pick), a recent customer, or the full list. A draft left in this browser is offered
  (*Resume draft* / *Start fresh*); drafts autosave as you type and the header shows *Draft saved hh:mm*.
- **Order facts in one row.** Customer (click to change), Ship to, Promised dispatch with "in N days",
  Plant (Auto · planner), Job name, Ship address and Note for dispatch (both open a small editor; blank
  address still means the saved one, and the saved one is shown).
- **Lines table.** One row per line: product and line label, size in mm with inches, layers with the total
  gauge, print (Roto/Flexo, colours, artwork or "artwork later"), quantity, rate, value and a status that
  names the first thing missing ("Needs rate", "Needs artwork" …). A totals row adds lines, kg + pcs and ₹.
  Row menu: duplicate, move up/down, remove (with Undo). Keys on a row: Enter opens, D duplicates,
  Alt ↑/↓ moves, Delete removes.
- **Quick-add row.** Product (⌘K) → size → qty → unit → rate → Enter adds the line without opening
  anything; Shift+Enter or *Editor* opens it. A product that prints or packs into pouches is added as
  *Check the line* and cannot be placed until it is opened once, so artwork and packing are never skipped.
  *Quick Start* (last order, customer items) sits under it as before.
- **Line drawer.** *Add line* (Alt N) or a row opens the full line editor in a wide drawer: line tabs with
  status dots, Alt ←/→ between lines, the step chips, the spec plate and live preview on the right.
  Footer: Remove, Duplicate, status, value, *Done with this line*, *Save & add another*.
- **Before you place / Customer.** Two chips under the lines open the readiness list (each item has
  *Fix →*: opens that line or puts the cursor in the field) and the customer's history panel. The place
  bar keeps Make for stock, Save as quotation and Place order (⌘↵); its blocker pill opens the same list.
- **After placing.** A summary replaces the jump to the orders list: order number and job name, lines,
  quantity, value, promised dispatch, what was sent, and Open order / Open in planner /
  New order for the same customer / New order. The placed draft is cleared.

## Release tick list: one rule

Inner pouches are never in the list: they are taken off stock automatically at packing. **Every other active
packing item is always listed** (gonny, sheet, putha, box, tape, label, tag, outer bag, other), on roll and pouch
releases alike, and any number can be ticked per release. Ticks are marks only; the evening count books the use.

- Masters → Packaging no longer defaults a new item to *Inner pouch* (that default is how Putha dropped out of
  the list): it starts with no kind (*What is this item?*), will not save until one is picked, and each kind says
  how the yard uses it. Item cards show the same line.
- The evening count now counts an item **once per unit**, however many times it was marked on that unit (the
  gonny chosen when a pouch unit is sealed and the same gonny ticked again at release), so showing gonny on
  pouch lines cannot skew the split between orders. An explicit quantity is kept.

**Data step after go-live (owner):** open Masters → Packaging, set *Putha* to *Sheet · putha · board* (any kind
except Inner pouch works) and make sure it is active. It then shows in the tick list.


---

## Help guide for every screen, in English and Hindi · machine output never blocked by inner-pouch count · 27 Oct 2026

## Fix: last machine step refused output ("primary_inner_pack.pcs_per_pack must be > 0")

Seen on SO-2026-0604 (side sealing): the order line had an inner pouch (LD-GREY-BAGS, in stock and
through (it only checked a typed override), and the machine then refused every output at the last step,
against the owner's rule that the inner pouch never blocks an output.

- **Machine**: pieces per inner pouch now comes from the order line, then the inner pouch's default
  (Masters → Packaging "Pouches per inner pouch (default)"), then the product master's PRIMARY_INNER
  packing line. With none, the output is saved anyway; the operator gets a notice; the batch is marked
  "count the inner packs at packing".
- **Packing Yard**: such a batch asks "Inner packs filled"; those packs become marks the evening packing
  count books to the order (one mark per unit).
  ("Packing: set pieces per inner pouch…"). The server fills a missing number from the customer's packing
  recipe or the product master's PRIMARY_INNER line for the same inner pouch; it does not refuse (repeat
  orders, quotations and older masters keep working), because the machine no longer stops for it.
- **To finish SO-2026-0604 cleanly**: set "Pouches per inner pouch (default)" on LD-GREY-BAGS in Masters →
  Packaging (then the machine counts them), or just log the output and count the packs at packing.

Reviewed before release by an independent multi-agent review (5 areas, every finding checked by two
skeptics) and a fix-verification pass. Also fixed from it:
  real server preview; the override is kept when the pouch comes from the generic packaging axis; the
  "Using the default N" number follows the same sources as the server (line, customer recipe, master);
- the machine and job-work returns never refuse over the inner pouch (no material → logged as loose
  pouches with a notice; kg-only or 0-piece outputs → counted at packing; non-UUID ids resolved by code);
- inner packs counted at packing are weighed on the batch's own day (estimated from its pouches until the
  yard types them); typed packs cannot exceed pouches and a pouch-sized number must be confirmed;
- stock orders without pieces per inner pouch say plainly that the count shows the use as not on any order.
- Known limit: a batch logged after that day's evening count was posted is not marked in any count.

The Layers column shows one layer per line: film name, thickness in large bold digits with µ, and the
grade as a bold tag, plus the total gauge for multi-layer lines. Size in mm is larger; inches are darker.

## What changed

- **Every page guide rewritten from the code** (214 screens, up from 202 guides of mostly template text).
  Each guide has what the page is for, before-you-start, numbered steps with the exact on-screen labels,
  what each field and tile means, the real error messages with their fix, what to do when stuck, related
  pages and a screenshot. Hindi is written for the floor in Devanagari; on-screen labels and error texts
  stay in English, quoted, as the screen shows them. The gate module, login and visitor pages now have
  guides too.
- **Process charts.** 44 end-to-end processes (order to dispatch, packing and release, evening count,
  closed-line goods, GRN, job work, maintenance, month end…) drawn as numbered steps with the role and the
  screen; each step opens that screen's guide. Every page shows which processes it belongs to, with the
  step before and after.
- **Decision flows** rewritten for sales orders, planning and release, the WC terminal, packing and
  release, the evening count, closed goods, dispatch, gate visitors, maintenance, quotations, buying and
  sign-in (26 flows).
- **Role guides** follow the real start pages; maintenance supervisor and technician added. A "Roles"
  document explains each role's start page, sidebar workspaces and daily routine.
- **FAQ** of the questions the floor asks (missing tick-list item, grey Place order, lost draft, closed
  goods, reprint a slip, no roll fits, Hindi, sharing…).

## Where to find it

- **Help inside the ERP** (`/help`): search across every screen, process and role; modules; processes;
  roles; English / हिंदी; Share, WhatsApp and Link buttons.
- **Public guide** (`/guide`): the same guide for anyone, no sign-in, made to share. Links keep the
  language (`?lang=hi`) and point at a page (`?page=sales-orders-create`), a process, a role or a module.
- **Header Help button**: the guide of the page you are on (steps, fields, problems, flow), loaded only
  when opened — the header no longer carries every guide in the browser.

Screenshots come from an anonymized copy of the test database (no real customer, supplier or person
names; every shot is checked against the real names before it is saved).

## Help bot sources (NotebookLM)

`docs/help-notebook/` holds 24 markdown sources built from the same content (start here, roles, one file
per module with every screen in English and Hindi, processes and flows, an index of every error message,
what is missing, release notes) and `SOURCES.md`, the upload list. Illustrated PDFs per module (screens
and charts) are generated with `frontend_v2/scripts/capture_help_pdfs.mjs` into `docs/help-notebook-pdf/`
(not committed: about 80 MB). Regenerate both after any help change:
`node frontend_v2/scripts/generate_help_notebook.mjs`.


---

## Closed-order goods, Dispatch Bay tabs, packing audit · 26 Oct 2026

## Goods made for a closed line or order

A line can be short-closed, completed or cancelled (or the whole order completed / cancelled) while
rolls, gonnies or pouches made for it are still in the yard. Until now Dispatch Bay showed them as ready
and then refused the slip ("SO-… is COMPLETED; a challan cannot be created"). Now the owner's rule
applies: those goods may go **either** way, decided at dispatch.

- **Ship them to the customer.** Dispatch Bay marks the line ("Order completed" / "Line short-closed")
  and shows the real quantities (ordered, closed, made and waiting) instead of "Ordered 0 kg". Loading it
  shows a box on the tray, *Send goods of closed lines*, that must be ticked before Create and Mark
  dispatched. The server refuses a closed line without that confirmation (create-slips and dispatch both
  take `ship_closed_lines`). Proof of delivery never reopens or rewrites a closed line or order.
- **Move them to free stock.** "Move to stock" on the line (Dispatch Bay or Packing Yard) picks the
  rolls, sealed gonnies and unpacked batches with a reason. They leave the order and Dispatch Bay and
  keep a record of where they came from. The planner's *use finished stock* now offers them to any order
  with the same specification (rolls, batches and whole sealed gonnies). Units of an open line, units on
  a draft slip and dispatched units cannot move.
- A draft order still never dispatches. A draft slip whose line closes afterwards needs the same
  confirmation to leave (History shows "Line closed" and asks before dispatching it).

`POST /api/production/challans/move-to-stock/` · `{roll_ids?, gonny_ids?, batch_ids?, reason}`

## Dispatch Bay

Three tabs: **Ready to dispatch** (board + loading tray), **This load** (the slips just created with the
exact Epson text, print, PDF, QR, mark dispatched; opens by itself after Create), **Challans & history**
(drafts, awaiting POD, delivered, cancelled; search, dates, customer; reprint, dispatch a draft, confirm
POD). The figure tiles open the matching tab. The order page links to its slips:
`/logistics/dispatch?history=SO-…`.

## Packing audit

Same rule as before (only inner pouches are taken at packing; gonny, box, tape and extras are ticked at
release and booked by the evening count to the lines that ticked them), shown in three views:

- **Evening counts**: one card per count with, per material, book → counted → used, the ticks, and the
  share each order line took (with line numbers). A warning shows when the ticks differ from what was
  counted. Usage not on any order and stock found above the book are shown too.
- **Inner pouches · at packing** and **Ticks at release** (each tick says whether a count has booked it).
- Pieces are shared in whole pieces from now on: 1 gonny counted used goes to one line, not 1/14 of a
  gonny to fourteen lines. Bookings made before this release keep their old fractional shares.

`GET /api/production/packing/count-sessions/` · `order-consumption/?view=inner|count|ticks`


---

## Floor pages · 25 Oct 2026

Packing Yard, Dispatch Bay and the WC terminal rebuilt on the samples approved on 25 Oct, with the

## Owner's rules applied

- **Packing items are ticks only.** No quantity is asked anywhere; a tick is one use on that unit and the
  evening count gives the consumption. Pouch gonny release now has the same tick list as rolls.
  Inner pouches and the gonny are already booked from each unit, so they are not ticked.
- **Vehicle number is optional.** Slips are created, printed and dispatched with or without it.
  The transporter stays required (printed as TRANSPORT NAME), with one-tap choices.
- **One slip per order line**, never mixed. A tray can hold lines from several orders; a line whose
  units sit at two plants gets two slips. Every slip of a tray is created together or none is.
- **WC terminal: only rolls and granule grade codes are entered.** Every other step material shows as
  "Auto · step mapping" and is sent at its planned quantity, exactly as before when nobody edited it
  (the machine's step close still receives it). One granule can be split over several grade codes.

## Packing Yard

- Order cards with the job name first and their ready lines inside (size in mm and inches, layers,
  inner pouch plan, pouches, net, machine, ready since, location). Tabs: Queue · In progress · History.
- Tick lines across orders, **Pack selected** opens one window with a tab per line: product plate,
  1 machine figures (with "Figures checked"), 2 how the pouches arrive (the order's choice), 3 build
  gonnies (pack, put on the scale, enter gross: sealed in the same step, or add open and weigh in the
  list), 4 packing items (ticks), 5 release. "Release all N lines" when every tab is ready.
- Released lines leave the queue and show in **History** (Today / 7 days / All): who, when, every
  gonny with its weights, the items ticked, the slip it is on.
- Kept: packing check (in Details), held-check notice, ready slip, audit, evening count, trace links.
- KPIs: lines ready, weight still to pack (pieces left × net per pouch), gonnies packed today, open /
  sealed, released today, variance alerts.

## Dispatch Bay

- Ready board customer → order → line, with ordered / dispatched / on this load / remaining per line,
  what is still in packing, and the per-unit manifest (packing slip on the Epson or A4 PDF).
- Loading tray: transport (vehicle optional), lines loaded per order with the delivery location,
  "N lines → N slips", Create → Print → Mark dispatched.
- The slips of the load show the exact text the Epson prints (the existing print endpoint, unchanged),
  with print, A4 PDF, QR sticker and copy.
- History: status tabs (drafts, awaiting POD, delivered, cancelled), date, customer, search; reprint,
  PDF, QR sticker, dispatch a draft, confirm POD.

## WC terminal (rebuilt on the sample)

- Page head: work center, plant · shift, clock and sync, and four figure chips (Running / ready,
  Waiting, Queue, No machine) that switch the view. Queue and job pane fill the screen under the head
  and scroll inside, so the page itself does not scroll on 1366 × 768.
- Queue panel: tabs Queue · Running / ready · Stalled · History, search, filters (material, grade,
  thickness, size, process), saved views and sort in popovers, status chips, removable filter tokens,
  and the sample's job rows (M R I C gates, size in mm and inches, layers with microns, inks, machine,
  artwork, cylinder, POD, add-ons, rolls, blockers, ⋯ menu, sales-order progress). Paged.
- Job pane: head with step, status, priority, job name and blockers; a rail of five steps; then
  Order (ordered / produced / remaining / blockers, the dark "what is to be made" plate, step figures,
  order spine, order facts · stock contract · production spec), Machine (one row per machine with its
  live state, tap to pick), Rolls (target / reserved / lineage / fallback, contract, lanes, picker),
  Input issue, Release checklist. Release bar pinned at the bottom of the pane with the gates and ⋯
  (Close short, Cancel, Recalculate from masters).
- Granule grade codes in a popup per granule: tap a code to take the balance from it (capped at its free
  stock), or pick a code with a part kg; "Next: granule" moves on.

## Scale

- Dispatch history and the Dispatch Bay figures come from `GET /api/production/challans/history/`:
  status tab, date range, customer and search are applied on the server, 8 slips a page. The page no
  longer loads every challan ever made. The logistics dashboard reads its counts the same way.
- Packing history pages on the server (60 a page). Packing and Dispatch boards page their orders and
  load line details only for the visible page. The WC queue searches on the server and pages on screen;
  WC history is filtered by date and search on the server.

## Not changed (awaiting the owner)

- The slip print itself (10 × 6 in, 96 columns, ESC/P prefix). Vehicle / driver / LR / job name are
  saved on the challan but not added to the printed slip.
- The yard cannot switch a line between inner packs and loose: the order's choice is used.
- No print log per slip and no cancelling of draft slips.


---

## Plan queue release (24 Oct 2026)

## What changes for users

- **Plan queue rows** show, for every order line:
  - the product (size, type, layers, print, order, customer, age);
  - demand in kg and pcs;
  - four release gates: **Spec** (math), **Material** (recipe/BOM and material plan), **Artwork**, **Route**;
  - the route by step name; steps a WIP or stock source already covers are dashed;
  - one state badge with the reason in words, plus the due date.
- **Layout by width:**
  - On wide screens (≥1,920 px) the queue is a table with column headers, and the gates show as S M A R tiles.
  - On laptops and iPads each row is a card, with the gates written out in words.
  - On phones the row stacks.
- **Sort and selection:** sort by Newest / Due first / Largest. The selected line's detail stays beside the queue (sticky).
- **Layers everywhere in the planner** read as chips, e.g. `PET 12µ + LD-MW SP 51µ = 63µ`, instead of a thin coloured bar.
- **Detail pane:**
  - its header shows the product identity instead of the long raw line label;
  - the spine and the "what is to be made" plate are full width.
- **Blocked KPI** splits the reasons: recipe/spec fix vs artwork only (vs replan, stock check).
- **Sales orders list:**
  - The customer cell reads customer name, then job name (both bold), then the SO number in regular weight.
  - The initials badge text uses its tone colour, so it is readable; before, it was white on a pale tint.
- **Top bar:** the breadcrumb no longer slides under the working-set picker on 1,280–1,535 px screens.
- **Contrast:**
  - In dark mode: the workspace pill text, the older indigo/violet planner shades, the plate's small labels, and the Material readiness buttons, funnel and count pills.
  - In light mode: the primary blue is a touch deeper, so white text passes 4.5:1.
  - Result: axe WCAG 2.1 AA shows 0 violations on Plan queue, Live production, Completed trace and Material readiness, in both themes.

## Bug fixed

Before this release, a line whose only open item was "assign artwork" showed a red **Blocked** badge, and its Material segment turned red. That happened for any blocker, including artwork. The detail pane's release checklist did the same.

Now each gate reflects only its own check:
- An artwork-only line is amber **Artwork pending**.
- Material is red only when the recipe/BOM is not production-ready.

Release rules are unchanged: release still waits for artwork, recipe, math and route.

## Backend

Compact queue rows carry `queue_route_steps` (index, process code, name, parallel group). These are resolved once per template per request (`PlannerViewSet._row_route_codes`), with no write.

## Proof

- **Backend:** 1,579 tests OK, including a new test that checks compact rows carry route steps and that the step lookup runs once per template.
- **Unit:** `npm run test:planner-queue` (state and gate rules, including the artwork-only case and id-free recipe messages).
- **e2e:** on a fresh isolated DB — gate, mutations, observations.

## Hotfix (same day): product master with more than 120 sizes

  - 33 live masters hold 328–528 sizes each.
  - The editor saw only the first 120. On save, the backend retired every active size the editor had not sent.
  - On 22 Oct this retired 16 sizes of MULTILAYER-SHEET-V30 (840–990.6 mm).
  - On 24 Oct, adding size 680 failed with "The fields product_master, code must make a unique set": 680 already existed beyond row 120.
- **Fix:**
  - Size lists load every size (`limit` up to 5000; the editor and pickers ask for all).
  - Workspace save retires only sizes the editor loaded and the user removed (`loaded_size_ids`). Rows it never saw are untouched.
  - Existing rows are saved before new ones, so a code freed by a rename can be reused in the same save.
  - A new row whose code matches a retired size brings that size back.
  - A code already in use gives "Size code "680" is already on this master (in use). Search the size list for 680 and edit that row instead of adding a new one."
- **Tests:** 7 new backend tests (long size list, no retirement of unloaded rows, removal still retires, duplicate message, restore, rename-then-reuse, single-size endpoint). Backend 1,586 OK.

## Round 3 (same day): job name, stock web, WC compaction, short screens

- **Plan queue:**
  - Each row starts with the job name: large, tinted, with a "JOB" key. Compact queue rows now keep `job_name`.
  - The detail header shows the same job name.
  - The detail gets the larger share: 0.9fr / 1.1fr from 1,280 px, 0.85fr / 1.15fr from 1,600 px.
  - Rows are tighter.
- **Spec card ("What is to be made"), the same component on every screen:**
  - Shows **Stock web**, e.g. "Open web · 655 mm roll · slit allowed" or "Lay-flat tube · 380 mm roll (760 mm film) · exact width only", taken from the line's geometry.
  - Shows the job name above the headline.
  - New fields `made.stock_web` / `stock_form` / `stock_width_mm` / `job_name`.
- **WC terminal, input issue:**
  - "Issue policy · template rules" is closed by default; it opens itself when an override is active.
  - Each material shows its template rule on one line; the override inputs appear only after Override.
  - Granule grade codes use one bar: pick the code and store, kg defaults to the balance, Add code. Added codes show as a short list with remove.
  - The bar stays until every issued kg has a code, and machine release still waits for that.
- **Short screens (≤ 900 px tall, factory PCs at 1366×768 / 1280×720):** the plan queue header drops its subtitle and the KPI tiles drop their footnotes, so the queue and detail start in the first screen.
- **Size naming:** applies to new sizes only. Existing sizes keep their codes and labels.
  - A new size row gets its code and label from its dimensions as they are typed:
    - roll: `500` / `500X45` (width × micron), label `500 mm web · 45 µ`;
    - pouch or bag: `140X305` / `140X305G40`, label `140 × 305 mm + 40 G`.
  - The editor shows "Auto from size"; typing a code or label overrides it, and "Use auto name" goes back.
  - Copied rows and imported rows without a code follow the same rule.
  - The backend fills a blank code or label on create (`apps/materials/size_naming.py`, mirrored by `src/lib/size-naming.ts`). A saved size cannot be blanked.
  - A size with no dimensions and no code is refused with "Enter the size …".
- **Inches beside mm:** worked out from mm, never typed; 1 decimal, no trailing zero.
  - Machine-setting widths (trim, parent web, lanes, pitch) stay mm-only.
  - Printed slips and challans keep their fixed layouts.
  - Tests: `npm run test:size-naming` and backend `ProductMasterSizeNamingTests`.

## Round 4 (same day): Excel size sheet, larger inches, roll orders cleared

- **Excel size sheet:**
  - "Excel sheet" downloads an .xlsx: size columns first (green); code and label last (grey, optional); the master's current sizes so they can be edited and uploaded back; a "How to fill" sheet.
  - Bulk upload takes .xlsx or .csv and is read by the server (`size-sheet` endpoint; friendly headers like "Width" or "Code (optional)" are mapped).
  - Blank codes and labels are made from the size and marked "auto from size" in the review. They follow size edits there, and an update keeps a saved size's label.
  - Nothing is saved until import + Save.
  - Template cells are plain Excel values (sizes as numbers, ids as text).
- **Inches:** now the same size and weight as the mm figure beside it, in a softer colour.
- **Live data:** see `.runtime/ops-20261024/` (close running ROLL-master lines through the planner cancel and short-close rules; retire the current roll masters' sizes; backup + restore drill first; reversal manifest).

## Round 5 (25 Oct): roll allocation ±20 mm, lane-aware run web

- **Tolerance:** a roll is used as it is within **±20 mm** of the planned web (`ROLL_PICK_WIDTH_TOLERANCE_MM`, default now 20).
  - The extra "+10%" allowance is removed.
  - Wider rolls are slit, or allocated by a manual override with a reason.
  - Narrower than −20 mm is refused.
- **Lane-aware:** before the route's slitting (SPLIT) step, a line runs its **planned parent web** (`SalesOrderItem.planned_parent_width_mm` = lanes × child + trim).
  - The step's roll specs, slots, job context and the picker all use it (`ExecutionService._run_web_width`, `_split_step_before`; `RollAllocationService.planned_parent_width` returns the child width after slitting).
  - Example: SO-2026-0677, a 3-up 230 mm line on a 700 mm web. The print step accepted only up to 253 mm before; now 680–720 mm, wider rolls slit, 495/570 mm refused.
  - Slitting still cuts 230 mm children.
- **Message:** "Selected roll width is outside the planned web ±20 mm. Slit it to the planned web, or use manual override with a reason to allocate it."
- **Tests:**
  - Lane run-web and ±20 window tests; the WCM discovery test moved to the ±20 boundary.
  - Backend 1,598 OK; probes floor 99/99, ink 10/10, job-work 65/65.
  - e2e gate 310, mutations 13, observations 10.


---

## Release: one order spine across the ERP (17 Oct 2026)

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
- Local demo data: `python manage.py seed_local_floor_demo` (see docs in the command) builds a live-like floor so
  the stack can be exercised end to end on the local E2E database.

## Third pass (18 Oct 2026) — calm design system, seven-workspace sidebar, large spec

- **Design system (Fable 5.1 design pass, merged from `design/calm-ui-20261018`)**: flat neutral canvas, white
  hairline cards, one accent, soft shadows, 10/14 px radii, sentence-case labels, quiet badges/tables/buttons,
  light page headers instead of gradient banners (PageHero, GradientHero, planner/ds heroes, product-master
  a scoped compatibility layer keeps old white-on-navy utilities readable inside the now-light heroes.
- **Sidebar = seven workspaces** (Products, Orders, Plan, Floor, Stock, Yard & Dispatch, Reports & admin) with
  every old section folded under "All screens" (opens automatically on a page outside the workspaces).
  A workspace shows when any of its screens is in the user's sidebar today (`accessibleWorkspaces`), so role
  defaults and per-user permission overrides carry over with no second role mapping. `npm run
  test:workspace-roles` checks every role: no screen lost, no access added.
- **Spec block** (`components/spine/spec-block.tsx`): size large, then each layer with name, micron (large),
  machine, planner, yard), planner queue rows, WC queue cards and the machine queue rail. Order line layer
  snapshots now carry `grade_name` at read time (snapshot rows are not modified).
- Orders list: calm header, neutral KPI tiles (status colour on the number), header and rows share one column
  template with a wider spec column.

Checks: typecheck, lint, nav:validate, test:workspace-roles, next build; backend suite 1517 OK.

## Fourth pass (19 Oct 2026) — the spec plate, step layouts, app-wide calm

- **Spec plate** (`components/plate/spec-plate.tsx`): one dark surface for "what is being made" — size in large
  numerals, every layer with micron and grade, total gauge, and a cross-section drawn to scale (outer layer on
  closed lines), product master editor and view, stock launcher and every `MadeCard` (order page, WC terminal,
  machine screen, planner, packing yard). New tokens `--plate*` / `--film-*` in light and dark.
- **Shared blocks** (`components/plate/steps.tsx`): numbered `StepSection`, `ChoiceCard`, `StatTile`,
  `CheckRow`, `Pill`, fixed `ActionBar`. `SectionCardV3`, `ValidationFooter`, `StepStrip` and the live BOM rail
  restyled to match (no coloured stripes, neutral numbers, readable labels).
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

### Local test data on the live masters (19 Oct 2026)

Two local-only commands (both refuse a production settings profile; both are safe to re-run):

- `python manage.py seed_local_live_masters --catalog <export.json>` loads a read-only export of
  the live master tables (processes, work centres, machines, materials, recipes with thickness
  bands, routes, templates, pouch styles, lane policies, active product masters and sizes). Codes
  are matched the way the models normalise them; when a template name has a LIVE version and a
  newer draft, the LIVE one is loaded. No customers, orders, stock or users are in the export.
- `python manage.py seed_local_demo_orders [--dry-run]` adds ten synthetic `DEMO-` customers,
  opening stock in plant 01 (purchased film rolls labelled `LIVE-DEMO-`, granules, inks, adhesive,
  solvent, purchased add-ons, packaging) and thirteen `DEMO LIVE ·` orders on the live masters,
  saved through `SalesOrderService` exactly as the create-order API does: ten placed (planner
  queue, printed lines with artwork deferred) and three drafts. Sizes sold by the kilo get kilo
  quantities and rates.

UI fixes found while checking this data: the orders list columns are rebalanced so the quantity
tiles, line chips and status pill no longer overlap at desktop width; the "what is to be made"
plate on a multi-line order shows line 1's kilos with the order total in brackets.


---

## Release: parallel-route and laminate fixes found by the full PET + LD walkthrough (17 Oct 2026)

**How found:** `apps/production/tests/test_pet_ld_walkthrough.py` drives the live stand-up pouch route
(EXT ∥ PRT → Lam → Slt → Pch → pack → check → challan) with a real BOM, real order confirmation,
real consumption and real step targets, and asserts the WIP pool at every step. Six gaps showed up
on the way; each is fixed here, each is additive, and linear routes behave exactly as before
(their only root is step 0, so every new rule collapses to the old one).

## Fixes

1. **Extrusion made the wrong film.** A roll-making (CREATE_NEW) step took layer 1 of the BOM as its
   output film. On EXT ∥ PRT routes with PET first, extrusion produced "PET 12 µ" rolls. Now the step
   makes its branch's layer (branch key, else the extruded/producer layer; `_job_output_layer_snapshot`).
2. **Printing could not take purchased PET.** The printing root sits at template index 1, so raw stock
   was refused ("requires a lineage output roll") and the WCM was offered the LD rolls from extrusion
   instead. A route root is now step 0 for input gating (`_input_gate_step_index`), in the compatibility
   check, SQL pre-filter, WIP pool, eligible rolls, auto-pick, output logging and step targets.
3. **Branch target specs.** A root branch job's target specs cover only its own layer
   (`_job_branch_layer_indexes`): printing asks for the PET web, extrusion for the LD web.
4. **Slitting and pouching after lamination saw no rolls.** Downstream steps asked for per-layer film
   specs (12 µ PET, 50 µ LD) so a 62 µ laminate never matched. Steps after a combine now carry one
   laminate spec (summed gauge, min width, `LAMINATED_WIP`); the match accepts the laminate and rolls
   cut from it (slit children keep `is_laminate` / `structure`).
5. **Slitting step target was one film.** The laminate roll carries the PET code, so the "variant match"
   target used the PET mass (255 kg) and refused a 285 kg entry. Steps after lamination target the full
   laminate film mass (`V2_LAMINATE_FILM_SUM`).
6. **Slitting child width.** `target_child_width` returned the input web width (980) instead of the order's
   child target (490); it now reads the order geometry first (`target_child_width_mm` / `child_target_width_mm`).
7. **Purchased layer invisible at lamination.** Found by the route-family walkthroughs: on PRT → Lam → Slt → Pch
   (bought LD, no extrusion) and on the 3-ply first pass (bought met-PET), the WIP pool and the picker looked
   beyond lineage only when the lineage roll *count* was short. Two printed rolls satisfied "two lanes", so the
   bought layer's stock rolls were never offered. Both now check lane slots: when lineage leaves a lane empty,
   that lane's stock rolls are discovered (`_match_rolls_to_lane_slots … unmatched_target_slots`).
8. **Two-pass lamination target.** The lamination roll target summed every BOM film on every pass, so pass 1 of a
   3-ply route (PET + met-PET) carried the LD layer's mass too and the met-PET lane asked for far more than it
   needed. A pass now sums layers 1..pass+1 only (`V2_COMBINE_FILM_SUM`); single-pass routes are unchanged.
9. **Second lamination pass refused the first pass's laminate.** The spec builder treated any combine step as
   "no prior lamination", so pass 2 asked for three single films and rejected the 24 µ laminate. Pass 2 now
   specs the earlier laminate (layers 1..pass, summed gauge) plus the next BOM layer; the pool, picker and
   assign-time physical check all use the same specs.

Also: adhesive/solvent lines fall back to the lamination (chemical) step and are operator-confirmed
(`AUTO_ESTIMATED_CONFIRM`) when a template does not map them; printing-enabled lines without a product
master get the same substrate/colour defaults at confirm as master lines.

## Verified by the walkthrough (numbers from the report)

100,000 stand-up pouches 160×230, PET 12 µ printed + milky LD 50 µ (70/30 LDPE/LLDPE), 2.5 g/m² adhesive, 1.5 g/m² ink.
Unit 10.147 g → 1,014.7 kg; films 953.9 kg, adhesive 38.0, ink 22.8. Confirm: 2 lanes, planned parent 989 mm.
Targets: EXT 698.7 (LD), PRT 255.2 (PET), Lam/Slt 991.9 (films + adhesive), Pch 1,014.7 kg = 100,000 pcs.
EXT: 6 rolls × 116.46 kg, granules 490.5 + 210.2 kg incl. 2 kg start-up. PRT: 4 × 66.8 kg in → 4 × 64.8 kg out, 8 kg scrap.
Lam WIP pool before allocation: all 4 PET + 6 LD rolls; shares PET 0.274 / LD 0.689 / adhesive 0.037; 3 laminate rolls 304.4 kg, 62 µ.
Slt WIP pool: the 3 laminates; 6 children × 151.7 kg @ 490 mm; 3 kg trim; balance stays on parent.
Pch WIP pool: the 6 children; 3 × 29,000 pcs counted first; 870 inner pouches consumed; 26 kg left on the last child.
Packing: 9 gonnies marked for the evening count; 3 packing checks VERIFIED (0% variance); challan created.

## Route families also walked (apps/production/tests/test_route_family_walkthroughs.py)

- Purchased 2-ply printed: PRT → Lam → Slt → Pch (bought LD loaded raw at lamination).
- 3-ply printed: EXT ∥ PRT → Lam → Lam → Slt → Pch (bought met-PET at pass 1, extruded LD at pass 2; 84 µ laminate).
- Purchased 2-ply plain: Lam → Slt → Pch (both films from stock at the route root).
- Courier bag: EXT → side seal (roll → bulk, pieces).
Each asserts the WIP pool at every step, lane mode at lamination, laminate flag and gauge, child width, FG batch.

## Open findings (decision needed, not changed)

- Ink is not a job requirement row by design (ink floor sessions book it); step targets after printing therefore
  exclude ink mass (2.2% here). Keep, or add ink to the printed-roll target.
- Step-0 roll→bulk accepts any film in the plant (see perf release notes).


---

## Release: roll lanes, packing check and faster office screens (16 Oct 2026)

- **Base:** live `0bf34e1ede7c` (floor logic + maintenance + QR scan, 15 Oct 2026).
- **Branch:** `codex/roll-flow-ui-20261016`.
- **Why:** the 16 Oct review ran the client's lamination case (6 PET rolls + 4 milky LD rolls) on a test copy and found that the WCM could give a laminate step only one roll per layer, that a roll-fed step after the first could take only one output entry per allocation, that rolls were used in allocation order rather than by layer share, and that pouching with two or more rolls refused part entries. Decision report: https://claude.ai/artifact/FsudJmXZE3NJa1cMuixAb6. Not in this release: the QR roll flow (being refined).
- **Rule for every screen change:** add-on only. No existing field, rule or check was removed; screens were reordered, reworded, given defaults and shortcuts.

## Roll lanes (backend contract)

| Step type | Mode | What changed |
|---|---|---|
| Plain roll to bulk/pieces (pouching, side seal, bottom seal) | MASS, one lane | Part entries work with any number of rolls; the running roll gives first; untouched rolls stay reserved. |
| Printing / modify, slitting, roll-fed create | MASS, one lane | Rolls queue one after another (was "exactly one"). Each output row the machine sends becomes its own output roll. Slitting keeps the unslit balance on the parent. |
| Lamination in lane-group mode | LANES, one lane per layer slot | Any number of rolls per layer. Each entry takes each lane's share of the output by g/m² (micron × density, ink on the printed layer, this pass's adhesive as the rest). The tightest lane caps the output. Film gauge is never exactly the plan, so a lane may run up to 5% (min 0.25 kg) short of its share on an entry: it gives what it has, the other lanes cover the gap, and the output roll records it in `lane_share_adjusted`. Past that the lane is named in the refusal and the WCM loads its next roll. Weighing the balance on return corrects any drift. |
| Strict combine (not lane groups) and legacy roll-to-roll NONE with several layers | COUNT | Unchanged. |

- **In place, same label:** a part-used roll keeps its id and label with less weight left. Nothing is re-labelled as a leftover (REM) roll on the lane flow. A roll taken to zero is CONSUMED and its reservation FULFILLED. Every use is recorded in `RollConsumption` with the balance left on the same roll.
- **Running job:** the WCM can add the next roll to a released or running job (MASS/LANES). An untouched roll can be taken off; a part-used roll leaves only through **Return balance** (back to stock, same label; a weighed balance below the system figure is booked as scrap) or **Roll finished** (core end booked as scrap). Machine screen and WCM terminal both offer it. Job completion returns any roll still on the job to stock with its label (rolls marked IN_PROCESS included).
- **Mass cap:** stock or other orders' rolls cannot be locked to a job whose remaining need is already covered (remaining need + close tolerance). The order's own WIP rolls are always allowed.
- **Laminate identity:** laminate output rolls carry `is_laminate`, `structure_label` (for example "PET 12 printed 12 µ / Milky LD 50 50 µ") and the per-lane structure in their metadata; the material link is unchanged so downstream slitting and pouching still match.
- **Step targets on roll products:** where a step target is "the mass loaded on the job" (roll-product lamination, first-step printing/slitting), loaded mass is now what the job used plus what is still on its rolls, so the target no longer shrinks with each entry.
- **Pouching pieces:** on piece jobs the progress leads with the pieces counted at the machine; the kg-based count is shown beside it as a check.

## Packing check (new, additive)

- New table `packing_verifications` (one per finished-goods batch). Net packed = scale gross − inner packs − gonny/carton − tape/tags, as already stored on each sealed pack.
- **Close check:** pieces and net kg are compared with what the machine logged. Within `PACKING_VERIFY_PCS_PCT` and `PACKING_VERIFY_KG_PCT` (default 2% each, env) the batch is VERIFIED: unpacked pieces are booked as packing loss on the pouching job and finished stock follows the packed figures. Outside the limits the batch is HELD.
- **Held batches** cannot be released to dispatch or put on a challan until a production supervisor/manager accepts with a reason (rejects, count error, machine over-logged, scale checked, other + note).
- Optional sample: weigh 100 pouches once for the real weight per pouch.
- Machine logging is unchanged; batches never checked keep working as before.

## Packing material: base rule and fixes

Base rule (from the owner): **only inner pouches are consumed automatically** (one per N pouches at pouching, with in-house demand when short). Gonnies, cartons, extras and in-house packing rolls/sheets are **marked at packing and taken off stock by the evening packing count**.

- **Gonny now follows the rule.** Creating a gonny marks it on the unit (`packaging_marks`, `MARKED_FOR_COUNT`) instead of consuming one from stock, so the packing yard is never blocked by missing gonny stock in the ERP. `PACKING_GONNY_AUTO_CONSUME=true` (env, default off) restores the old consume-on-create.
- **Evening count books to the orders that used it.** A count shortfall is shared over the same day's orders that *marked* that material (gonny, seal extras, release extras, roll-pack lines), by marked quantity; orders whose packing plan merely allows it are the fallback. When nothing was packed at the stock's own location (store vs FG store), the whole plant's packing is used instead of leaving the shortfall unassigned.
- **Inner pouch draw across the plant.** Pouching takes inner pouches from the output location first, then any other location of the plant (one CONSUME row per location, `drawn_from_location_id` in meta). A real shortage names what the plant has, per location.
- **Code-only inner pouch on an order** (older lines) is resolved from the packaging master at pouching and when the order snapshot is built (id, name, supply mode, pcs per pack from the master default).
- **Unused inner pouches go back.** When the packing check closes (verified or accepted), inner pouches consumed at the machine but not used in packed units return to stock for that order (ADJUST row, `basis=INNER_PACK_RETURN`, at the consumption cost and location). The packing check dialog shows "taken at the machine · used in packs · back to stock". The order's packaging history lists returns and every marked item.
- **In-house demand nets other orders.** For the inner pouch, free stock = plant stock + in-house stock orders still to produce − inner pouches still needed by other open orders; what this line already consumed is not planned again.
- **Product master switch is honoured.** "Auto-demand" off on a master's packaging (or POD) axis now stops in-house demand at order confirm (the master preview already showed that). A missing flag means on, as before; the screens now show it as on.
- **Product master inner pouch.** Choose the default inner pouch from the allowed list and the pouches per inner; the box shows made here / bought / both and the product master that makes it (or a warning when an in-house pouch has none, since demand cannot be planned). The default can no longer be switched on without a material and moves to an allowed pouch when its SKU is removed from the list.

## Screens

- **WCM terminal:** rolls by lane with loaded vs still-needed kilos, running and queued rolls, "Add next roll" while running, Return balance / Roll finished, remove untouched rolls. The roll banner no longer says "covered" while a lane is short: it says "Ready to start: every layer has a roll" and names each lane still short for the full order (not blocking), and when a lane has no roll it names that lane after "Assign N more roll(s) before release".
- **Machine screen:** the same lane view (operator can return or finish a roll), output limit from the tightest lane, counted pieces strip on pouching.
- **Packing yard:** Packing check panel and dialog. A notice at the top lists batches on hold across all orders, each one tap from its order (the queue rows now carry `sales_order_id`). Closing a check while pieces of the batch are still unpacked shows a warning first: pieces not packed by then count as short.
- **Order entry:** customer search (type 2 letters) with the last five customers one tap away, above the unchanged dropdown; "Pouches: use pieces" hint on pouch lines in KG; the material list files in-house film as film, greys it as "made here · not added", and leaves it out of the subtotal (the 1,000 kg order no longer shows 1,575.7 kg). The saved BOM was already correct; planning lines now also carry each film's source.
- **Pouch style:** built-in styles show their fixed formula in words ("child width = 2 × (W + G) + 10") instead of an empty builder, with "Edit as terms" to switch; the banner says "Approved style · N sizes use it" (it wrongly said "locked because sizes use it" when none did).
- **Product master:** sticky step bar over the long edit page; plainer section titles and wording; numbering no longer skips 7; lamination passes a product will not run are shown as skipped on edit and detail; Disable is quiet next to Open; breadcrumb names Product / Pouch style instead of "Terminal". Lane-up, child web width, override, stock form, width basis and allocator fields are untouched.


---

## Release: floor terminal speed (16 Oct 2026, evening)

**Root cause:** roll discovery loaded every available roll of the plant (6,300+ on live) into Python and ran the compatibility check per roll, and did so 4–8 times per request (`get_job_context` resolves the WIP pool twice plus satisfaction plus eligible rolls; `tiered-rolls` calls `get_job_context` four times). The WCM history serialized each row's "skip next step" options by rebuilding the route graph per job (~150 queries per row).

## Changes (behaviour unchanged, only faster)

- **Per-request memo** (`config/request_context.py`, armed by the middleware for GET/HEAD only): job context, WIP pool, satisfaction, step target specs/slots, step roll spec, eligible rolls, combine process codes, route graph normalisation, template policy, predecessor completion sets and runtime skip options are computed once per request. Writes never use it.
- **SQL candidate pre-filter** (`ExecutionService._roll_candidate_prefilter`): the rules `_is_roll_step_compatible` applies to every roll (step bound, raw/remainder exclusion past step 0, step-0 purchasable variants, film variant/family from the target specs) now run in SQL before rolls are loaded. Proven identical: eligible rolls, discoverable and lineage pools matched with and without the filter for 225 open jobs on a 15,400-roll test DB, and `test_read_performance_guards.py` keeps that proof.
- **Eligible rolls serializer** loads plant, batch and job in the same query set (was 2 queries per roll). The WCM page asks for the first 400 inline suggestions (`?limit=`); the roll picker still loads the complete tiered list.
- **WCM history** skips the per-job execution profile (the panel never reads it) and joins routing rule, work centre, stock order and batch.
- **Screens:** a background refresh that times out while the screen still shows data no longer raises the "Data load failed" toast (the sync banner carries it); history polls every 2 min, stats and stalled jobs every 60 s.

| request | before | after |
|---|---|---|
| pouching `tiered-rolls` | 2,611 ms | 94 ms |
| pouching `context` | 589 ms | 74 ms |
| lamination `tiered-rolls` | 633 ms | 190 ms |
| WCM `history` (20 rows) | 1,580 ms / 3,567 q | 349 ms / 184 q |
| printing with 3,000 matching stock rolls `eligible-rolls` | 1,780 ms / 6,099 q | 938 ms / 18 q |
| 12 terminals loading at the same instant, p95 | 7.1 s | 3.6 s |

## Known business gap (not changed here)

A roll→bulk step at step 0 (bag making straight from purchased film) accepts any roll of the plant with a step index ≤ 1 regardless of film, by design of `_is_roll_step_compatible` ("layer-level target specs do not apply" to roll→bulk). With thousands of purchased rolls this is also the heaviest list. Recommend: filter step-0 roll→bulk candidates by the order's film variant/family and width like other steps. Decision needed.


---

## Release: floor logic contracts + preventive maintenance (15 Oct 2026)

- **Base:** live `28aa4de42a5f` (UI polish + dialog scroll hotfix, 14 Oct 2026).
- **Branch:** `codex/floor-logic-20261015`.
- **Why:** the 15 Oct floor review (SO-2026-0608, Rajtilak 65,000 silver BOPP bags) found seven symptoms behind three missing contracts; the client also asked for preventive maintenance on the phone, per-machine and per-location QR codes, and a machine setting for running several orders at once.

## Floor logic (what changed and why)

| # | Symptom | Cause | Now |
|---|---|---|---|
| 1 | "65000 kg required", "Output now 65000.005 kg" | A pieces figure went through a kg formatter; job-level PCS fields were used as kg fallbacks | Terminal figures are unit-safe: kg from kg fields only; piece jobs show pieces and kg; the output seed is capped by the step target |
| 2 | BOPP tape missing from the machine issue area | Add-ons without a template step mapping never got a requirement row for any step | Add-ons default to the last route step (packaging stays with the packing flow); they appear in the issue area in their own unit (meters) |
| 3 | Tape plan 18,200 m; "per 10 mm" weight in the master | The master had no basis field; the coefficient was read as per 1 mm | `addon_weight_basis_mm` (1 or 10) on the add-on master, used by the resolver; live example on the master page; master edits re-resolve open lines; released lines get "Recalculate from masters" on the WCM terminal (refused once output exists) |
| 4 | 300 + 700 kg rolls could not both be allocated | Roll readiness and allocation were a count; roll→bulk NONE was hard-set to exactly one roll | Roll contract per step: MASS (any number of rolls until the step mass is covered, capped at target + tolerance) or COUNT (combine lanes, laminate layers, split/modify). WCM shows "N rolls · X of Y kg" |
| 5 | Batch progress lagged the job | Simple log path never synced the batch | Both log paths sync batch progress |
| 6 | Step target unexplained | Single number | "Target comes from" line: film + ink + chemicals + add-ons per piece × pieces; per-unit basis on order BOM rows |
| 7 | Pause kept time only for costing | No downtime record on pause | Pause writes a `DowntimeLog` (bucket + governed reason code + note, `source=PAUSE`); resume and completion close it; both terminals use one pause dialog. OEE and maintenance read one timeline |

Also: **add-on shortage switch** `ADDON_SHORTAGE_BLOCKS` (env, default off). Add-on rows are always shown, issued and consumed at their step; a shortage is flagged in amber on the WCM release bar ("Add-on stock short (not blocking)") and blocks release or start only when the switch is on. Turn it on once tape and zipper stock is received into the ERP at each plant; until then the floor keeps running.

**Calmer screens**: the header bell's gate-bill summary polled every 5 s on every page for bill reviewers, the inventory bill inbox polled again under its own key, and the machine terminal polled every 8 s and 5 s. Now 30 s, 30 s, 15 s (bill queues) and 15 s (terminal); every action still refreshes what it changed at once, and windows refresh on focus.

**Machine concurrency policy** (`Machine.concurrency_policy`: AUTO = bulk→roll steps may run several orders, others one at a time; ALLOW; DENY), enforced at start with a clear refusal naming the running job; set on the machine master.

## Preventive maintenance (new module `apps.maintenance`)
- Schedules per machine (daily / weekly / monthly / every N running hours), fixed-calendar or after-last-service due rules, checklist items (OK/Issue or reading with range), operator check vs technician service, critical = verified.
- Faults: report from any screen; a stopping fault pauses the running step as a breakdown and marks the machine DOWN; assign creates the repair job; resolve returns the machine to ACTIVE.
- Spares are a note on the job (item, qty, cost); no stock.
- Board (due today, overdue, open faults, machines awaiting repair, awaiting verification), reports (compliance, breakdowns & downtime from the production downtime log, recurring faults, spares & time, technician workload), machine history timeline.
- Overdue reminder at 08:00 via the notification service (`maintenance.overdue`), fault reports via `maintenance.fault_reported`.

## QR and phone scan
- Printable QR posters for every machine and every stock location (`/maintenance/qr`, plus a QR button on the machine card and a "QR code" action on the locations master).
- Scan icon in the header for every role (desktop and phone), using the existing gate scanner.
- A QR opened by the phone camera while signed out goes to sign-in and then back to that machine or location card (follow-up release on top of `80ba0619527f`).
- `/m/<machine code>`: role-aware machine card. Operator: today's checks, report fault, terminal link. Technician: open jobs, schedules, history. Supervisor / work-centre manager: running order with a quick output log. Owner / plant manager: queue, 30-day run hours, downtime, breakdowns. Maintenance supervisor: the machine's board.
- `/loc/<location code>`: what the system says is at the location (rolls by material, bulk lines, packed units, totals); store users count against it and post differences as a stock adjustment (count correction) through the normal posting rules; owners see the totals.

## Security and data checks
- Maintenance, scan and QR endpoints keep the global role guard (strict RBAC in production); the watchman is refused everywhere; the location card needs `inventory.view`, the machine card `production.view`, QR images `factory.view`, maintenance panels `maintenance.view`.
- Photos are served only through the logged-in API (`/api/maintenance/attachments/<id>/file/`), stored on the persistent media volume, 8 MB limit, images and PDF only.
- The phone count only offers materials a stock adjustment can post (bulk categories, one quality code at the location); coded granules held under several codes go to the physical count. A failed post removes its draft.
- Resume honours the machine concurrency policy, same as start.

## Guard rails
- Unit tests: `apps/production/tests/test_floor_logic_contracts.py` (19: resume guard and add-on shortage switch added; roll contract, add-on basis, add-on issue step, pause/resume downtime, concurrency policy, recalc guard), `apps/maintenance/tests.py` (11: fixed-calendar vs after-last-service, unable/issue outcomes, fault pauses job, strict-RBAC per role).
- E2E: `tests/e2e/gate/maintenance.spec.ts` (schedule → due job → record → fault → QR → machine and location scan cards; header scan button; signed-out QR scan returns to the machine card after sign-in), plus the existing sweeps.

## E2E suite repairs (long-standing failures, none caused by this release)
- **Operator flow**: the mutation seed now releases the operator's extrusion job through the WCM's own coded granule issue, and the extrusion fixtures carry a real granule line on their BOM (the screens build requirements from the frozen BOM since 30 Sep, so the old stored-only row was invisible). The test uses the pause-reason dialog and the current labels.
- **WCM release**: same fixture fix; the seed stores the projected requirements as a planner release would.
- **Dispatch (two tests)**: selectors follow the current packing route button and proof-of-delivery labels.
- **Job work**: rewritten for the redesigned create, dispatch (declared value per roll for Rule 45 challans) and receive (mass balance within 3 %) screens.
- **WIP route proof**: the telemetry seed wrote execution logs onto queued proof jobs, which marked them started and locked WCM preparation; telemetry now goes only on jobs that ran.


---

## Hotfix: planner release dialog could not scroll

- **Base:** live `e1bed53d6539` (UI polish, 14 Oct 2026).
- **Reported:** 14 Oct 2026 12:52 IST by the client (WhatsApp screenshot of "Release planning SO-2026-0628": "not able to scroll here on this window").
- **Cause:** since 30 Sep (`e92acec`) the dialog body was a `<fieldset>` used as the scroll container inside a flex column. Chrome does not scroll a fieldset's own overflow, and a fieldset flex item does not shrink, so content below the fold was clipped by the dialog box. On shorter screens the "Release immediately after planning" option was out of reach. The 12 px caption floor in the UI-polish release made the body a little taller, which is why it surfaced now.
- **Fix:** the scroll container is a `div` wrapping the fieldset (`overflow-y: auto; flex: 1; min-height: 0`); the fieldset keeps its `disabled` gating of every control, so behaviour is unchanged. The artwork picker dialog's scroller gained `min-height: 0` for the same shrink reason.
- **Verified locally (dev stack, 1280×720 and 1280×480):** release dialog wheel-scrolls, bottom reachable, option checkbox visible; artwork picker shrinks without clipping; typecheck, lint, theme-token guard pass.


---

## Release: UI polish (readability, accessibility, navigation, operator terminal)

- **Base:** the live release `94866005cc7b` (`codex/stock-reconciliation-20261012`).
- **Branch:** `codex/ui-polish-20261012`.
- **Scope:** the seven fixes from the 12 Oct 2026 UI review. No business logic, API or database change. Every screen, field and action is still there; what changed is how it looks, reads and is reached.

## What changes for users

| Area | Change |
|---|---|
| Machine terminal (operator) | The sticky machine header is readable again (navy panel; it rendered white-on-white before). Captions are 12 px minimum. The action bar and output fields are bilingual: Start · शुरू करें, Log output · माल लिखें, Complete · पूरा हुआ, Total produced · कुल बना, Output width · चौड़ाई, Trim · ट्रिम, Scrap · खराब माल, Target/Produced/Remaining/Yield. Tile captions say what they mean ("Can log now (max)", "Finish within", "Output goes to"). The idle card tells the operator what to do next, in English and Hindi. The job card keeps everything it showed: job and order number, product, customer, step, priority, batch, route, planner note, production spec (thickness, web, stock form, finished size, grade, film layers), target/produced/remaining/yield, reserved and issued material, roll rows. |
| Readability everywhere | 3,353 pieces of 9–11 px text now render at 12 px (`text-caption`) with a darker caption grey (4.6:1 contrast, was 3.05:1). Status pills no longer fade their text. |
| Navigation | Long sidebar sections are grouped: Inventory has Stock · Receive · Documents · Move & convert · Count & adjust · Job work · Reports & history; Operations has Planning · Floor; Administration has Monitoring · People & access · Company. A group opens when it holds the current page or when tapped. Every link is still there and still reachable. |
| Page headers | GRN ("Receive goods"), the work-centre chooser ("Choose your machine group") and the machine selector ("Choose your machine") now use the same header as the rest of the product, with plain-words summaries. The order-create header says "Sales · New order". |
| Sign-in | Plain copy ("Sign in to your factory workspace"); fields are named for password managers and screen readers; the dead "Forgot?" mail link is replaced by "Ask your administrator". |
| Reminders | The "Add your email" reminder can be dismissed for the session instead of sitting on every page. |
| Keyboard and assistive tech | A visible 2 px focus ring on every control; the hidden sidebar variant is inert (it was in the Tab order); scroll panels are keyboard-scrollable; icon-only buttons, the role switcher, the queue sort and filters, the keypad inputs and the navigation menu button have names. |
| Theme tokens | Tokens are alpha-capable (`rgb(var(--x-rgb) / <alpha-value>)`) and the opacity scale covers the steps the product uses (12, 14, 58, 72, 76, 78, 88, 92, 94, 96), so the 641 translucent panel styles that were silently dropped now render as designed. |

## Not changed on purpose
- The dark "ink" page header stays as the product's one header (52 screens already use it, 13.9:1 contrast); the review's light-header mockup was not adopted, the outliers were moved onto the existing header instead.
- No screen was removed, merged or re-routed. Business rules, forms, fields, API calls and tests of behaviour are untouched.
- Dark theme: not re-walked in this pass.

## E2E test changes
- `run_release_green.mjs`: creates the admin account (`scripts/ensure_superuser.py`) before seeding, and seeds telemetry after the tagged acceptance (which creates the production jobs it needs). Both were fresh-database failures.
- `seed_ui_e2e_planner_gate.py`: seeded lines carry the SKU's axis values. `run_dryfruit_courier_ui_proof.py`: the route-default seed no longer revises other fixtures' open order lines (`refresh_open_sources=False`). Together these unblock the dry-fruit proof that stopped every green run since 10 Oct.
- `sales-fast-entry.spec.ts`: header copy updated to "Sales · New order".
- `variant-stock-and-capability.spec.ts`: expectation aligned with the real heading ("What this ERP supports today, by configuration, or only with new logic"); it was out of date before this branch.
- `static-routes.spec.ts`, `responsive-shell.spec.ts`: the gate app (`/gate/*`) and the public visitor page (`/visit`) are excluded from the dashboard-shell sweeps because they use their own shell; they were failing before this branch.
- New `gate/gate-shell.spec.ts`: every gate route renders the gate shell at desktop and phone width with no overflow; the visitor page loads signed-out.
- `navigation.spec.ts`: the expected route list now includes the document links the signed-in account is entitled to (the helper gained `documentEntitlements`); it ignored them before.
- `planner-truth.spec.ts`, `packaging-proof.spec.ts`, `dispatch.spec.ts`, `dryfruit-pouch-dispatch.spec.ts`, `jobwork.spec.ts`: selectors aligned with the current screens (passport labels, "Packing audit", the destination placeholder, a test id on the job-work plant select). All were stale before this branch.

## Green run (12 Oct 2026, fresh database `test_ui_green_20261012`)
- Playwright, full suite: gate 276 passed / 12 failed, mutations 6 passed / 7 failed, observations 10 passed / 0 failed. After the test alignments in this branch the re-run of the affected specs is 188 passed / 5 failed.
- The 5 that still fail are E2E fixture or environment items that predate this branch and are unrelated to the UI change: `jobwork.spec` (written for test ids the job-work dialog never had: `jobwork-create-mode` and friends), `dispatch.spec` ×2 (the mutation seed leaves no packed roll unit to release), `wip-route-proof.spec` (an assigned roll is left behind by repeated seeding on the same database), `quotations.spec` (needs `RESEND_API_KEY`/local SMTP sink in the API environment), and `operator.spec` (the seeded LDPE issue needs the operator to pick a grade/code, which the test predates). Each has the backend message recorded in `.runtime/ui-e2e`.
- Flows proven green in this run: printing output logging, roll split and combine proofs, roll allocation on the work-centre terminal, GRN, packing yard to dispatch bay with challan print (dry-fruit pouch flow), quotations workspace build and save, inventory workspace and stock lifecycle, gate app on desktop and phone, every static route at desktop, tablet and phone width.


---

## Release: nightly stock reconciliation (false alarms, alert pile-up, gap list)

- **Base:** the live release `9b0a7400d9f6` (`codex/review-hardening-20261011`).
- **Branch:** `codex/stock-reconciliation-20261012`.
- **Why:** every night the inventory check reported 90 bulk stock mismatches and created 90 new alert rows for them (9,204 open `TXN_MISMATCH` alerts by 12 Oct 2026). 70 of the 90 were false alarms; 20 are real gaps that need a physical count.

## What changes

| Area | Change |
|---|---|
| Stock check | Bulk stock is held per material + quality code + location. The check used to compare each quality code's stock with the ledger of **all** codes at that location, so any item split across codes was flagged. It now compares each stock row with its own ledger (`InventoryAuditService.bulk_ledger_gaps`). |
| Alerts | The nightly run keeps **one open alert per condition** (`InventoryAlert.scope_key`, `last_seen_at`) and updates it instead of creating a new one. When the condition clears, the alert is resolved automatically with a note. Applies to `TXN_MISMATCH`, `NEGATIVE_STOCK`, `WEIGHT_MISMATCH`, `ORPHAN_ROLL`, `STUCK_WIP`. Other alert types are untouched. |
| Alert messages | Mismatch messages now name the quality code: `Bulk WHITE-MB [WHITE-57-F] @ Raw Materials Store: …`. |
| API | `GET /api/inventory/alerts/` rows carry `scope_key` and `last_seen_at`. No screen change needed. |
| Commands | `bulk_ledger_gaps` (read-only list for the store team) and `collapse_inventory_alerts` (one-time clean-up of the old pile; idempotent). |

## The 20 real gaps (production, 12 Oct 2026, read-only)

All in plant 01, Raw Materials Store. In every row the system shows **more** stock than the ledger explains; no stock is missing on paper, some stock is missing its paper.

| # | Material | Quality code | Stock kg | Ledger kg | Gap kg | Kind |
|---|---|---|---|---|---|---|
| 1 | ANTIBLOCK-AB-220-MB | – | 325.000 | 0.000 | +325.000 | A · no ledger |
| 2 | BLACK-7A-10-F-S-MB | 7A-10-F(S | 325.000 | 250.000 | +75.000 | B · short ledger (last entry 13 Sep) |
| 3 | BLUE-224-FF-MB | – | 25.000 | 0.000 | +25.000 | A · no ledger |
| 4 | FILLER | – | 1200.000 | 0.000 | +1200.000 | A · no ledger |
| 5 | GREEN-1859-FF-MB | – | 50.000 | 0.000 | +50.000 | A · no ledger |
| 6 | HDPE | ACP144 | 0.000 | −25.500 | +25.500 | C · over-issued ledger (last 15 Jun) |
| 7 | IVORY-97-FF-MB | – | 75.000 | 0.000 | +75.000 | A · no ledger |
| 8 | LDPE-NON-SLIP | RIL-22FA002 | 12358.853 | 12321.353 | +37.500 | B · short ledger (last 11 Oct) |
| 9 | LDPE-SLIP | RIL-1005FY-20 | 57346.902 | 57282.402 | +64.500 | B · short ledger (last 11 Oct) |
| 10 | LLDPE-NON-SLIP | 010F18A | 0.000 | −196.800 | +196.800 | C · over-issued ledger (last 26 Jun) |
| 11 | LLDPE-SLIP | F1801SA | 0.000 | −392.025 | +392.025 | C · over-issued ledger (last 15 Jun) |
| 12 | MASTER-BATCH | SLIP-110-C | 2202.496 | 2198.822 | +3.675 | B · short ledger (last 30 Sep) |
| 13 | METALLOCENE-NON-SLIP | F0118-LM | 4420.632 | 4405.632 | +15.000 | B · short ledger (last 11 Oct) |
| 14 | METALLOCENE-SLIP | F0120-LM | 823.735 | 808.735 | +15.000 | B · short ledger (last 11 Oct) |
| 15 | ORANGE-554-MB | – | 25.000 | 0.000 | +25.000 | A · no ledger |
| 16 | RED-329-FF-MB | – | 25.000 | 0.000 | +25.000 | A · no ledger |
| 17 | SLIP-110-C-MB | – | 825.000 | 700.000 | +125.000 | B · short ledger (last 26 Aug) |
| 18 | UV-404-MB | – | 125.000 | 0.000 | +125.000 | A · no ledger |
| 19 | WHITE-MB | WHITE-57-F | 2800.000 | 1000.000 | +1800.000 | B · short ledger (last 10 Oct) |
| 20 | YELLOW-627-FF-MB | – | 125.000 | 0.000 | +125.000 | A · no ledger |

Total 4,725 kg. Kinds:
- **A · no ledger (9 rows, 1,975 kg):** stock entered directly, before the ledger started on 1 Jun 2026, and never given an opening-balance entry. Masterbatches and filler.
- **B · short ledger (8 rows, 2,135 kg):** receipts or counts that reached the stock figure but not the ledger. Row 19 (WHITE-MB, +1,800 kg, last entry 10 Oct) and row 17 (+125 kg) are the ones to check first.
- **C · over-issued ledger (3 rows, 614 kg):** the ledger for that quality code shows more issued than received (negative), and stock is 0. Most likely the material was received under one quality code and issued under another in June. Check whether another code of the same material carries a matching surplus.

## Correction steps (after the physical count; owner approval)

1. **Count** each of the 20 rows (material + quality code) in the Raw Materials Store.
2. **Count equals the stock figure, paper is missing (kinds A and B):** post an **opening-balance adjustment** ledger row (`OPENING_BALANCE_ADJUST`, reference "Ledger reconciliation 2026-10, counted on <date>") for the gap. Stock does not change; the stock card becomes complete. Use the Opening Stock batch screen (Inventory → Count & adjust), which writes exactly this row type.
3. **Count is lower than the stock figure:** draft a **stock adjustment** for the difference with reason "Physical count 2026-10". A second store user posts it (maker-checker). Both stock and ledger move.
4. **Kind C:** if another quality code of the same material shows a matching surplus, post a **stock conversion** between the codes (Move & convert) for the June quantity; otherwise treat as kind A with an opening-balance entry on the issued code.
5. Run `python manage.py bulk_ledger_gaps`: it should print `0 row(s)`, and the nightly alerts resolve themselves the following night.

Nothing in this release changes stock quantities; the corrections above are posted by the store team through the normal screens.


---

## Release: review hardening (stock integrity, permissions, order guards, wastage reasons)

- **Base:** the live AWS release `c8833f41e6f0` (`codex/documents-jobwork-20261010`).
- **Branch:** `codex/review-hardening-20261011`.
- **Scope:** fixes from the 11 Oct 2026 full-stack review, plus the operator request to record why wastage was high on the machine terminal. Credit and finance (credit limits, invoices, receivables) are out of scope for this release.

## What changes for users

| Area | Change |
|---|---|
| Inventory rights | Changing stock now needs the right capability. GRNs need inventory or purchase receipt rights. Roll moves, quarantine and splits need inventory rights. Stock-form conversion, inter-plant challans and ink-floor posting need inventory or production rights. Locations need factory administration. Resolving inventory alerts needs inventory view (store, planning, work centers). Reading stock, rolls and locations is unchanged for every signed-in user. |
| Rolls | Roll rows can no longer be created, edited or deleted directly; weight, status and location change only through receipts, production, dispatch, job work, moves and adjustments. A move needs an available, unreserved roll, a real same-plant location and a manual reason; cross-plant moves use an inter-plant challan. Quarantine needs a reason and keeps a history. |
| Retired endpoints (410) | `inventory/rolls/reserve`, `rolls/release`, `rolls/consume` and `inventory/bulk/inward`. No screen used them. Reservations and consumption run on the work-center and machine terminals, and bulk receipts run through the GRN. |
| Splits | A split must account for every kilogram of the parent roll. Each child gets a movement record, so the roll stock card stays correct. |
| Stock adjustments | Someone other than the person who drafted an adjustment must post it (owners and administrators may post their own). Every line writes the stock ledger, so the stock card ties to on-hand stock. Lines must be in the adjustment's plant, in the item's stock unit, and not in a virtual location. Consumed or dispatched rolls cannot be revived. A void is refused if the roll has changed since posting. |
| Sales orders | Only a draft order can be edited or deleted; confirmed orders change through Cancel. Quotation evidence on an order comes only from the quote-to-order conversion and cannot be supplied by a client. The Commercial and Finance approval gates of a quotation need two different approvers, unless the approver is an owner. |
| Machine terminal | Trim and scrap now take a **wastage reason** (from the scrap reason list) and a **note**. Both are required when the wastage share of an output log reaches the company limit (default 5 %; Company profile → Production). The reason is stored on the scrap logs, so scrap reports show real causes. |
| Users | Administrators manage staff, but only an owner can grant owner rights or change an owner account. The last active owner cannot be removed. Delete now deactivates the account: its name stays on history and its sessions are revoked. |
| Role matrix | Unticking a permission and saving now really removes it, including built-in defaults. Restore defaults clears the removals, and a per-user grant still applies. |
| Sign-in | After 10 failed attempts in 15 minutes an account is locked for 15 minutes, whether the email or the username was typed. The lock is audited. |
| Gate | Owners can replace a plant's visitor QR from Gate setup (with a reason, audited); the old printed QR stops working. Each gate accepts at most `GATE_PUBLIC_HOURLY_CAP` (120) self-registrations per hour. |
| Reliability | A request that changes data and ends in an error now commits nothing; before, the writes made before the failure were kept. Permission denials are now actually recorded in the system audit; before, they were rolled back with the request. |

## Test tooling fixed in this release
These scripts have no effect on production behaviour; the fixes let the release gate run from an empty database.
- `bootstrap_report_smoke` no longer tries to write the private gate register to media files. The watchman release made it database-only, and the command crashed on it.
- The `JOBWORK_PLANNED_STEP` acceptance check uses the job-work statuses introduced on 10 Oct (`PARTLY_RETURNED` / `RETURNED`).
- `seed_ui_e2e.py` creates an active LDPE quality code, and `seed_ui_e2e_sales.py` never falls back to its own quotation approver as the submitter.

## Not in this release
- **Customer returns after dispatch** (return-to-stock). This is a separate feature: it needs a returns workflow and quality disposition, plus fulfilment recalculation across dispatch and sales reports.
- **Public GitHub repository.** Make `dev2495/total-blueprint-erp` private; that is a GitHub setting, not code.


---

## Release: bills & documents, outward evidence, gate passes, general receipts and job work

- **Base:** the live AWS release `38ca792b` (`origin/codex/bill-intake-live-20261008`).
- **Branch:** `codex/documents-jobwork-20261010`.
- **Specification:** `docs/documents-jobwork/SPEC.md`.
- **Image storage:** `docs/documents-jobwork/STORAGE.md`.

## What users get
| Area | Change |
|---|---|
| Bill viewer | The bill stays beside the Smart GRN, the PO receipt, bill details, General Receipt, job-work receive and outward matching screens. Modes: dock split with independent scrolling, floating window, pop-out synced to a second monitor, hidden rail, and a bottom sheet on phones. You can fit width, zoom, pan, rotate (saved for everyone), pin a region, and use shortcuts. |
| Bills & documents | One register for every bill. **Inbox:** needs classifying, waiting for receipt, partly received. **All documents** and **Filed:** searchable, with CSV export. **Non-stock follow-ups**, and **Reports**, including a storage card for Owner/Admin. |
| Office upload | Inventory can upload photos or PDFs that came by post or email. PDFs are rendered to pages and the original is kept. |
| Classify | Each bill gets a type, category, vendor or party, bill number and date, amounts, due date, valid-until and ship-to factory. Duplicate bills are flagged. The next step depends on the category: stock goes to a GRN, job work to a job-work receipt, spares/machinery/services to a General Receipt, and utilities, fees, transport and notes are filed (or attached to another bill). |
| General Receipts | Record who received the goods or confirmed the service, linked to the machine, and close lines on returnable gate passes. **Never changes stock.** Includes a machine history view. |
| Outward | The watchman scans the QR on ERP papers, photographs the pages and records the departure. The office matches each departure to its ERP document. **Never moves stock.** |
| Gate passes | Returnable (RGP) and non-returnable (NRGP) gate passes, numbered and printed with a QR. RGPs track items until they come back, with overdue alerts. |
| Job work | Order → Rule 45 challan with QR → reconciled returns (finished pieces in boxes, output rolls, balance rolls, wastage) with a material-balance check → bill linked and checked against the vendor rate card → close, which completes the route step. Includes ageing/ITC-04 and yield reports, overdue alerts, and a one-time owner screen for orders stuck before the upgrade. |
| Fixes | Smart GRN no longer offers "Job work return", which double-counted stock. Job work no longer leaves phantom rolls at JOBWORK_OUT. GRNs into virtual locations are refused. Challan PDFs print factory time. |
| Rights | Bill and document rights belong to Inventory (Store) by default; Owner/Admin always have them. Grant them to other roles or users under Role matrix → "Bills & documents", or in the user override editor. Watchman can never have office rights. |


---

## Bill intake release — 8 October 2026

Production parent is 72759ea64c703118a670b507b5aacfec417ae6f7. Preserve its 57 private review repairs, including inventory/receipt locking, report permissions, exact backup binding, mobile goods geometry and durable Redis. The recovered source baseline is 5482847f901440408231ae2a4964f4568c945a1e; its tree matched all 2,178 regular files in the live release. This reconstructed commit is not the original unpublished private Git object.

## Before building

## Recovery prerequisite

Run managed-backup-restore.py explicitly in the current backend with expected parent SHA and a unique gate-release-bill- attempt identifier. This action creates a managed backup and verifies that exact artifact in a temporary restore database. It does not restore business records into the live database. Preserve its single safe JSON result outside Git and on the host for activation. The activation guard independently verifies the linked successful backup/restore records, artifact size/checksum and freshness within one hour.

## Post-release acceptance

Run the frozen authenticated bill acceptance harness inside the candidate backend with the exact expected APP_BUILD_SHA. Use real signed bearer/cookie authentication and a nested fixture savepoint inside a rolled-back outer transaction. Create UUID-only synthetic plants/locations/users/assignments/bills plus one direct receipt projection on the synthetic plant, then roll back all fixtures before comparing all protected table fingerprints. Never reset production passwords or persist test identities. Block external notification fanout and constrain every SQL mutation to reviewed feature/auth tables. Read existing master data privately and prove ERP/master row contents remain unchanged. Do not call stock posting or consume production document numbering sequences. The direct synthetic receipt insertion uses a UUID and does not invoke receipt or stock services; it permits meaningful existing-receipt candidate/link checks without locking real plants or receipts.

Collect read-only release status before and after acceptance. Check Watchman photo-only inward submission, retry/duplicate behavior, plant-scoped inventory queue/notifications, private images, master access, legacy goods direction limits, safe reports and real GRN-link projection without persistent synthetic factory transactions. QR self-entry and watchman exit flows remain governed by their existing contract. Do not claim physical camera/QR/printer or sustained peak-load evidence from API/browser tests.


---

## Watchman and visitor gate release, 7 October 2026

## Verified starting point

The isolated checkout is `/private/tmp/tpp-watchman-20261007`, on branch
`codex/watchman-gate-20261007`, based on
`d04c2c06cac24bf6a3c35edcaec6e25ffc7db96f` from
`https://github.com/dev2495/total-blueprint-erp.git`.

different source files. The running image revision labels are `unknown`; this
release's build script explicitly embeds and verifies the full candidate SHA.

Public readiness returned `ready`. Backend/frontend were healthy, worker/beat
running, and the host had 39 GB free. These observations establish the baseline,
not acceptance of the new gate feature.

## Local development

Use the fresh local PostgreSQL database `tpp_gate_dev_20261007`; no production
database or records are imported. Dependencies are installed in `.venv` and
`frontend_v2/node_modules`. Local environment values are in ignored
`.runtime/gate-local.env` with mode 0600. API and frontend ports are 8017 and 3017.

From the repository root:

```sh
set -a
. .runtime/gate-local.env
set +a
```

In a separate terminal, from `frontend_v2`:

```sh
set -a
. ../.runtime/gate-local.env
set +a
```

The local environment supplies Codex's bundled Node 24.19 executable through
`WORKSPACE_NODE_BIN`; the host default Node 26 does not meet this project's
supported-version check. Installs use temporary writable npm/uv caches; no user
cache permissions were changed.

Gate dependencies are pinned to cryptography 50.0.2, Pillow 12.3.0, and qrcode 8.2.
The regenerated hash lock kept every existing pinned version unchanged by
constraining resolution to the original lock. Only cffi, cryptography, pycparser,
and qrcode are new lock entries; Pillow was already a transitive dependency.

run frontend typecheck/build/lint and mobile/desktop browser acceptance before
creating the candidate release archive. Never use reset or wipe scripts.

## Gate privacy and durable storage

The backend stores bounded, sanitized visitor selfies in private database fields.
Government IDs use Fernet encryption with `GATE_ID_ENCRYPTION_KEY`. Protected gate
API handlers return images only to authorized users. Neither selfies nor IDs are
written to `MEDIA_ROOT`, and no public media volume is added.

production host. It appends a fresh random key only if one is absent, validates
and retains an existing valid key, uses an atomic mode-0600 update, and never
prints secret values. Do not run with shell tracing. The existing private
environment file must be preserved with the deployment recovery configuration;
losing or replacing the encryption key makes existing encrypted gate IDs

`GATE_TIME_ZONE=Asia/Kolkata` without changing the ERP's global timezone.
Public QR/form URLs must use that origin and the plant's active opaque UUID
gate token. Plant codes or plant IDs are not public registration authority. Photos and
government IDs must not appear in audit payloads, reports, log messages, error
traces, browser URLs, or report attachments.

The final visitor flow records `INSIDE` and the server entry timestamp immediately
on successful QR submission, with one entry audit event even under retries.
The watchman sees inside visitors and confirms only their exit; watchman walk-in
creation, admission and cancellation are denied. Existing pending visits remain
available only for owner recovery and never appear in the watchman's queue or
photo access until the owner recovers their entry.

network gateway and backend health access logs. Current Caddy configuration has
The reviewed change makes Caddy overwrite `X-Real-IP` with `{remote_host}` and
trusts only that exact proxy address for gate throttling. It never trusts inbound
`X-Forwarded-For` or broad private ranges. This header overwrite is required:
unmodified incoming headers would otherwise allow callers to spoof their rate
bucket. [Caddy's header documentation](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#headers)
describes overwrite semantics and the default pass-through behavior.

byte match to the reviewed candidate, together with the recorded gateway. It
validates the candidate and preserves the current file for this release's
the first gate activation replaces the original configuration and restores it
including the already-enabled gate proxy when the parent is a gate release.
If the live configuration or network changes, stop and review the exact proxy
instead of weakening the checks. After deployment, verify spoofed `X-Real-IP`
headers do not create caller-selected rate buckets.

Administrators and owners now receive full gate/history/private/report/config
rights by default, including actual `ADMIN` without an owner flag and canonical
`SUPER_ADMIN`. The actual or effective `WATCHMAN` ceiling always takes precedence.
An ordinary non-master with literal `gate.reports` remains a sanitized report
delegate. Daily report recipients remain OWNER-only by default.

application, whose authenticated ERP views do not implement the watchman ceiling.
It changes no passwords and no users in other roles. Original account IDs and
with directory mode 0700/file mode 0600; account IDs are never printed. Recovery
must retain this file and re-enable only the recorded accounts that still hold
the WATCHMAN role after the repaired release passes the ceiling checks. Automatic

## Release sequence

1. Finish backend, RBAC, Claude-authored frontend, report integration and QR
   acceptance. Record validation results and current commit in this directory.
   complete candidate. Create the archive with `git archive --format=tar.gz` so
   `.env`, `.venv`, `.runtime`, `node_modules`, and unrelated local files are
3. Recheck the expected parent, runtime health, available disk space and image
   identities. Run `BackupService.run_database_backup` with a unique release
   attempt key, followed by `BackupService.run_restore_drill(backup_record=backup)`;
   bind the restore to that exact artifact and require successful
   checksums and restored-database smoke results before changing production.
4. Upload the reviewed archive as `/tmp/tpp-gate-<12-char SHA>.tar.gz`. Run
   host as root. This only stages source/builds and preserves current images.
5. Provision/validate the private gate key. Run Django `check --deploy` on the
6. Activate the candidate using the reviewed activation script. Preserve the
   `/login` must return 200. Verify all service image revisions match the SHA and
   update `current-commit` only after acceptance checks pass. Capture the entire
   pipeline consumers can otherwise cause a false SIGPIPE failure.
7. Run `scripts/verify_gate_live_acceptance.py --expected-sha <full SHA>` inside
   the new backend container. It requires the matching runtime build SHA and
   production PostgreSQL, signs ordinary JWTs for temporary users, exercises
   bearer/cookie/CSRF authentication and actual gate API endpoints, checks
   owner/report/watchman ceilings and plant scopes, verifies private encrypted
   visitor data, lifecycle/idempotency, corrections, audit and QR flows, and
   hashes complete rows in 103 ERP/master tables. An SQL mutation allowlist
   rejects writes outside feature/auth tables. All acceptance writes run inside
   zero persistent synthetic users, visitors, movements, audit, receipts or
   throttle buckets. No existing passwords, users, plants or business masters
   are changed. Per-request savepoints keep expected DRF 4xx responses from
   aborting this test transaction. Concurrency is tested separately against
   isolated local PostgreSQL, where committed synthetic fixtures are safe.
8. Run `scripts/collect_gate_release_status.py --expected-sha <full SHA>` inside
   the new backend container for bounded PostgreSQL read-only status. It records
   daily report default, encryption/proxy/timezone configuration and backup/
   restore identifiers; it never provisions missing state. Finish browser
   public-form/QR acceptance and record any remaining physical-phone selfie/
   camera and printed-QR scan gates honestly.

The existing release procedure restarts application containers. Earlier releases
observed brief HTTP 502 responses during activation; this procedure does not
promise zero downtime. Roll back application images/source on health failure
while retaining the additive schema and encryption key. Never restore the live
business database merely to roll back an additive application release.

The first activation of `556740b1082c1d38cee1ee09904d7858b345d540` automatically
rolled back after backend and frontend reported healthy. Its next health probe
141 (SIGPIPE). The repaired probe consumes the full output before checking it.
Application source/images and Caddy returned to the verified `d04c2c06` parent;
watchman accounts required quarantine. Before resuming with the repaired release,
