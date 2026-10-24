# Plan queue release (24 Oct 2026)

Parent (live before): `1ee72ae5e003`. No migration, no env change.

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

## Deploy

Scripts: `.runtime/release-planner-queue/{build,activate}-pq-release.sh`

- Rollback images: `rollback-pq-<tag>`.
- The activate script refuses any migration plan.

## Hotfix (same day): product master with more than 120 sizes

- **Problem:** the size list behind product master view/edit, the variant editor, the stock launcher and the order composer returned at most 120 sizes.
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
  - Shown on product sizes and roll widths across the stack: spec plate, spec block, planner identity, the shared spec label, orders list chips, order detail facts, composer size tiles and preview, quotation lines, product master size list and view, variant titles, packing yard and dispatch size cells, WC target web, production spec rail, stock launcher, rolls list and board, roll picker and machine roll cards.
  - Machine-setting widths (trim, parent web, lanes, pitch) stay mm-only.
  - Printed slips and challans keep their fixed layouts.
  - Tests: `npm run test:size-naming` and backend `ProductMasterSizeNamingTests`.
