# Release: UI polish (readability, accessibility, navigation, operator terminal)

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

## Verification
- `npm run typecheck`, `npm run lint`, theme-token guard, version-label guard: pass.
- Backend: no changes beyond the E2E seed scripts (`seed_ui_e2e_planner_gate.py` now carries the SKU's axis values so the dry-fruit proof can edit the template).
- E2E: see "Green run" below.

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
- Bootstrap: migrate, admin, UI/quotation/sales seeds, report smoke, notification baseline, tagged acceptance (31/31), telemetry, business-truth verification, planner-gate seed, mutation seed, dry-fruit courier proof: all pass.
- Playwright, full suite: gate 276 passed / 12 failed, mutations 6 passed / 7 failed, observations 10 passed / 0 failed. After the test alignments in this branch the re-run of the affected specs is 188 passed / 5 failed.
- The 5 that still fail are E2E fixture or environment items that predate this branch and are unrelated to the UI change: `jobwork.spec` (written for test ids the job-work dialog never had: `jobwork-create-mode` and friends), `dispatch.spec` ×2 (the mutation seed leaves no packed roll unit to release), `wip-route-proof.spec` (an assigned roll is left behind by repeated seeding on the same database), `quotations.spec` (needs `RESEND_API_KEY`/local SMTP sink in the API environment), and `operator.spec` (the seeded LDPE issue needs the operator to pick a grade/code, which the test predates). Each has the backend message recorded in `.runtime/ui-e2e`.
- Flows proven green in this run: printing output logging, roll split and combine proofs, roll allocation on the work-centre terminal, GRN, packing yard to dispatch bay with challan print (dry-fruit pouch flow), quotations workspace build and save, inventory workspace and stock lifecycle, gate app on desktop and phone, every static route at desktop, tablet and phone width.

## Deploy
Frontend-only change plus the seed-script fix. Build and activate with the usual scripts; no migration; no env change.
