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
