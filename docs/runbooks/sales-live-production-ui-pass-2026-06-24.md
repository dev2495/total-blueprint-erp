# Sales Order And Live Production UI Pass

Date: 2026-06-24
Worktree: `/Users/devarshthakkar/Documents/total_blueprint_erp/route_dispatch_release`

## User Request

- Sales order list must show total order quantity/progress for all line items in consolidated view.
- Expanded sales order rows must show line-wise stage/status breakdown, order flow, production batches, and smaller horizontal actions.
- Planner live production must stop stretching headline KPIs at the top, move totals lower, and show line-wise route + batch production details.
- Sales order detail and production tracking must be consolidated into one complete order page with line status, stage breakdown, production batches, docs, technical specs, BOM/materials, and live tracking.
- Released planner jobs with no production activity must be safely reversed to planned/planner queue state before users refresh templates/routes and release again.
- AWS production must be verified after implementation.

## Checklist

- [x] Inspect current sales list, order detail, order tracking, planner live production, and backend data contracts.
- [x] Patch backend payloads so frontend receives line id, route node, branch, and batch metadata without guessing.
- [x] Sync sales order status after planner release/reset actions.
- [x] Redesign sales order list consolidated and expanded UI.
- [x] Redesign planner live production route board as sales-line grouped cards with batch/stage progress.
- [x] Consolidate order detail/tracking page into one live order page.
- [x] Dry-run and apply safe reset for released-but-not-started planner jobs.
- [x] Run backend checks and targeted tests.
- [x] Run frontend type/build checks.
- [x] Deploy to AWS, run migrations/checks, restart services, and verify live routes.
- [x] Commit and push changes.

## Design Decisions

- A sales order line remains the commercial demand unit.
- Live production rows group by `sales_order_item_id` first, then order number fallback, so a multi-line sales order does not collapse into one route row.
- Route Master remains the flow definition. Batch details, source path, progress, and release execution state are displayed from template/order/job snapshots.
- Planner live production headline keeps orientation only; DB-wide KPIs move into a lower operations totals section.
- The main sales order detail page becomes the primary full tracker. The separate `/tracking` route stays compatible, but list actions point users to the consolidated order page.
- Reset of released jobs is allowed only when there are no execution logs, runtime sessions, scrap, downtime, consumption, machine assignment, or start date.

## Implementation Log

- Started implementation and confirmed current Git worktree is clean on `codex/prod-stability-rbac`.
- Added `sales_order_item_id`, sales line label, production batch, route node, route branch, and route payload fields into production and analytics serializers so Sales/Planner can group by line instead of only order number.
- Kept lightweight `template_steps` in planner active-order summaries so live production can show all route stages, including parallel and join nodes, even when only the first jobs are active.
- Enriched production batch summaries with current route node label/process, branch, join key, parallel group, and route graph snapshot.
- Updated released-job reset command to sync linked batches and parent sales orders after moving safe rows back to `PLANNED/QUEUED`.
- Updated job release path to resync parent sales order status after a line moves to `RELEASED`.
- Rebuilt planner live production:
  - Groups route board by sales line (`sales_order_item_id`) first.
  - Shows line target, produced/open KG, progress, live batches, route stages, branch/join flags, and jobs under each line.
  - Moves broad KPI totals to a lower `Live totals` section.
- Rebuilt sales order list expanded rows:
  - Consolidated row quantity explicitly labels `Total order`.
  - Expanded drawer now has compact order snapshot, total-order flow meter, horizontal action rail, and line flow cards.
  - Line cards show route stages, batch/lots, produced/packed/dispatched/open KG, and batch route labels.
- Rebuilt `/sales/orders/[id]` as the unified order tracker:
  - Header fulfillment truth, live KPIs, line route cards, batch/lots, jobs, technical geometry, BOM/materials, documents, and audit trail.
  - Removed placeholder production percentages and fake geometry defaults.
- Changed `/sales/orders/[id]/tracking` to a compatibility redirect into the unified order tracker.
- Verified local backend:
  - `python -m py_compile` for modified backend files passed.
  - `python manage.py check` passed.
  - Focused tests passed: route graph batches, planner stock launcher, WIP route truth, sales order list summary. Result: 21 tests OK.
- Verified local frontend:
  - `npm run typecheck` passed: theme tokens, Next route typegen, and `tsc --noEmit`.
  - Local `npm run build` reached Next optimized build but stayed silent too long; it was stopped and replaced with the AWS Docker production build gate.
  - Local `npm run lint` stayed silent too long and was stopped; TypeScript and Docker build are the completed frontend gates.
- Deployed to AWS:
  - Synced worktree to `/opt/tpp-erp/app`.
  - Built Docker images for backend, frontend, worker, and beat.
  - Frontend Docker build completed successfully; Next compiled `/sales/orders`, `/sales/orders/[id]`, `/sales/orders/[id]/tracking`, planner live production, and stock launcher routes.
  - Remote `python manage.py check` passed.
  - Remote `python manage.py migrate --noinput` reported no migrations to apply.
  - AWS reset dry-run inspected 27 released jobs, found 1 eligible, skipped 26 machine-assigned/started jobs.
  - AWS reset apply moved `SO-2026-0128-4161-1` back to `PLANNED/QUEUED` and synced 1 sales order.
  - AWS data check confirmed order `SO-2026-0128` is `PLANNED` and job `SO-2026-0128-4161-1` is `PLANNED/QUEUED`.
  - Recreated backend, frontend, worker, and beat services.
  - Container status: backend and frontend healthy; worker, beat, postgres, redis running.
- Live route probes:
  - `https://erp.totalpolyprint.com/api/health/ready/` returned 200.
  - `https://erp.totalpolyprint.com/sales/orders` returned 200.
  - `https://erp.totalpolyprint.com/dashboard/planner/control-tower/live-production` returned 200.
  - `https://erp.totalpolyprint.com/production/planner/stock-launcher` returned 200.
  - `https://erp.totalpolyprint.com/sales/orders/7dfa83cd-90a9-47ee-929d-396993aed1f4` returned 200.
  - `https://erp.totalpolyprint.com/sales/orders/7dfa83cd-90a9-47ee-929d-396993aed1f4/tracking` returned 200.

## Collapsed Sales List Line-Color Addon

Time: 2026-06-24, after reviewing the live screenshot at 6:54 PM.

### Additional User Requirements

- Every sales line needs a visible color icon so multi-line orders are easy to visualize.
- The collapsed consolidated sales order row must show the same line-wise route/progress bar as the expanded view.
- Progress bars should show produced, ready, and dispatched quantities as strong colors; WIP/open should remain a lighter in-progress tone.
- The collapsed total order area must show produced/ready/dispatched as bold colored cards.
- Multi-line collapsed rows must show the top two line items by KG with full line detail chips; single-line rows show the one line.

### Additional Implementation Log

- Added lightweight `line_preview` to `SalesOrderListSerializer`:
  - Returns only the top two sales lines by ordered KG for list display.
  - Includes line specs, snapshots needed for chips, and batch summary needed for route/live progress.
  - Keeps the full heavy `items` payload reserved for detail/expanded pages.
- Updated sales order list collapsed rows:
  - Shows top one/two line preview cards with numbered color icons, line label, status, spec chips, produced/ready/dispatched values.
  - Shows line-wise live route progress with numbered color icons even in compact/collapsed mode.
  - Shows bold colored cards for Produced, Ready, Dispatch, and WIP/open.
  - Uses light blue WIP/open rail background behind produced/ready/dispatched progress.
- Updated unified sales order tracker:
  - Changed packed wording to Ready for user-facing progress truth.
  - Added the same numbered color icons in line-wise route completion chips.
  - Uses light WIP/open progress rail background.

### Additional Verification Log

- `python3 -m py_compile apps/sales/serializers_orders.py` passed.
- `.venv/bin/python manage.py check` passed.
- `.venv/bin/python manage.py test apps.sales.tests.test_sales_order_list_summary --noinput` passed: 7 tests OK.
- `npm run typecheck` passed.
- `npm run build` passed and included `/sales/orders` plus `/sales/orders/[id]`.
  - Protected analytics tracking API returned 401 without session, expected for unauthenticated API access.
- AWS deployment for the collapsed line-color addon:
  - Synced the committed worktree to `/opt/tpp-erp/app`.
  - `sudo docker compose -f deploy/aws/docker-compose.yml build backend frontend worker beat` passed.
  - Remote `python manage.py check` passed with no issues.
  - Remote `python manage.py migrate --noinput` reported no migrations to apply.
  - Recreated backend, frontend, worker, and beat services.
  - Container status after restart: backend and frontend healthy; worker, beat, postgres, and redis running.
- Live route probes after the collapsed line-color addon:
  - `https://erp.totalpolyprint.com/api/health/ready/` returned 200.
  - `https://erp.totalpolyprint.com/sales/orders` returned 200.
  - `https://erp.totalpolyprint.com/sales/orders/7dfa83cd-90a9-47ee-929d-396993aed1f4` returned 200.
  - `https://erp.totalpolyprint.com/sales/orders/7dfa83cd-90a9-47ee-929d-396993aed1f4/tracking` returned 200.
  - `https://erp.totalpolyprint.com/dashboard/planner/control-tower/live-production` returned 200.
  - `https://erp.totalpolyprint.com/production/planner/stock-launcher` returned 200.

## Mockup Polish Pass

Time: 2026-06-24, after reviewing supplied HTML mockups:

- `/Users/devarshthakkar/Library/Group Containers/group.com.apple.coreservices.useractivityd/shared-pasteboard/items/344F7A91-3A13-4706-B5EC-5799E1316CBF/sales-order-list.html`
- `/Users/devarshthakkar/Library/Group Containers/group.com.apple.coreservices.useractivityd/shared-pasteboard/items/7608AAD0-B0F6-4B71-BFE3-252B3312CF73/planner-live-production.html`
- `/Users/devarshthakkar/Library/Group Containers/group.com.apple.coreservices.useractivityd/shared-pasteboard/items/A2BC815E-015E-4169-9BCC-955C01EE387E/order-tracker-detail.html`

### Additional User Requirements

- Keep existing filters and views because they are operationally important.
- Rework the visible page structure to match the mockups: clearer cards, line breakdowns, route/batch chips, progress bars, better color separation, larger readable text, and full-width layouts without empty gaps.
- Add line-separated progress coloring: each commercial line gets its own color in order-level progress bars; segment width is proportional to line demand, and fill is proportional to live route/batch completion.

### Additional Decisions

- The existing filters and tab/view controls remain intact; this pass changes the information layout and visual hierarchy only.
- Order-level segmented progress still shows fulfillment truth: dispatched, packed, produced, and open quantities are not double counted.
- The new line-wise progress bar uses route graph completion when available, with KG fulfillment completion as the fallback. This means a released/running line is visibly progressing even before output KG is posted.
- Line segment width is based on ordered KG share, so large lines take more visual space than small lines.
- Route Master behavior remains unchanged. Route graph snapshots and production batch snapshots drive the display.

### Additional Implementation Log

- Sales order list:
  - Added `orderPackedKg` and shared stage-aware flow band math so produced/packed/dispatched/open bars are accurate.
  - Added line-wise color progress bars to collapsed and expanded order views.
  - Updated expanded line cards to use larger line headers, clearer route chips, batch rows, and right-side production truth panels.
  - Kept saved views, filters, density toggle, selection, cancellation flow, and reorder/tracker actions unchanged.
- Planner live production:
  - Reworked each sales-line route card into a compact header, main route/progress area, and side context panel.
  - Added active state left border, active route label, larger line target/progress numbers, live batch cards, and work-center/machine/operator/source details.
  - Kept source path rail, state filters, route search, and lower KPI totals unchanged.
- Sales order detail:
  - Added the same line-wise route completion bar to the fulfillment truth panel.
  - Added produced/packed/dispatched/open legend tiles below the main segmented progress bar.
  - Added line spec chips to line tracking and technical/BOM cards so product/template/geometry context is visible without switching pages.
  - Kept documents, audit, dispatch ledger action, and confirm-commercial action unchanged.

### Additional Verification Log

- Local frontend `npm run typecheck` passed after the mockup polish pass:
  - Theme token guard passed.
  - Next route types generated successfully.
  - `tsc --noEmit` passed.
- Local frontend `npm run build` passed after the mockup polish pass:
  - Next optimized build compiled successfully.
  - Route list included `/sales/orders`, `/sales/orders/[id]`, `/sales/orders/[id]/tracking`, `/dashboard/planner/control-tower/live-production`, and `/production/planner/stock-launcher`.
- AWS deployment after the mockup polish pass:
  - Synced the committed worktree to `/opt/tpp-erp/app`.
  - `sudo docker compose -f deploy/aws/docker-compose.yml build backend frontend worker beat` passed.
  - AWS frontend Docker build compiled successfully and generated the same touched routes.
  - Remote `python manage.py check` passed with no issues.
  - Remote `python manage.py migrate --noinput` reported no migrations to apply.
  - Recreated backend, frontend, worker, and beat services.
  - Container status after restart: backend and frontend healthy; worker, beat, postgres, and redis running.
- Live route probes after the mockup polish pass:
  - `https://erp.totalpolyprint.com/api/health/ready/` returned 200.
  - `https://erp.totalpolyprint.com/sales/orders` returned 200.
  - `https://erp.totalpolyprint.com/dashboard/planner/control-tower/live-production` returned 200.
  - `https://erp.totalpolyprint.com/production/planner/stock-launcher` returned 200.
  - `https://erp.totalpolyprint.com/sales/orders/7dfa83cd-90a9-47ee-929d-396993aed1f4` returned 200.
  - `https://erp.totalpolyprint.com/sales/orders/7dfa83cd-90a9-47ee-929d-396993aed1f4/tracking` returned 200.

## Ready/WIP Fulfillment Correction Pass

Time: 2026-06-24, after the user clarified that produced and ready must not be separate user-facing buckets.

### Final User Correction

- Ready means final production output is complete and available for packing/dispatch. It is not a second bucket after produced.
- Dispatched is separate and only reflects customer shipment/dispatch.
- WIP is live route/batch quantity currently in process.
- Open is remaining commercial demand not yet ready, dispatched, or in WIP.
- Sales order list should use one total order progress bar, split by sales line color and proportional to ordered KG.
- Within a line segment:
  - dispatched and ready use strong line color,
  - WIP uses the lighter tone of the same line color,
  - open demand remains neutral.
- Collapsed sales-order rows should show the top one or two highest-KG line previews with line color icons and line chips, while the progress bar still represents all lines.
- Roll order list rows must not show `PCS n/a`; KG remains the primary quantity for roll lines.
- Artwork thumbnail logic should prefer the highest-KG line artwork for multi-line orders.
- Search and filters must match line item data, not only order header fields.
- Single-line cancellation remains allowed only before planner release; released lines must go through planner cancel/short-close rules.

### Final Decisions

- User-facing fulfillment language is now `Ready`, `Dispatched`, `WIP`, and `Open`.
- Backend list summaries now return all compact line previews, sorted by ordered KG, so the frontend can choose top preview lines without losing full line context.
- The full order tracker is `/sales/orders/[id]`; `/sales/orders/[id]/tracking` remains a compatibility redirect only.
- The line color bar is a demand-share visualization, not a route-definition editor. Route Master and Template Studio ownership rules remain unchanged.
- The sales list applies status, master, FG type, geometry, thickness, and pouch-style filters against both the order header and line preview/snapshot data.

### Final Implementation Log

- Backend sales list payload:
  - Added `assigned_artwork` to list queryset prefetch/selects.
  - Expanded sales order search to line template, SKU, product master, JSON snapshots, and artwork fields.
  - Returned all compact `line_preview` rows with `artwork_preview`, geometry, layer, printing, addon, packaging, and batch summary fields.
- Sales service contract:
  - Added optional line snapshot fields for geometry, layer, printing, addons, packaging, BOM, and artwork preview.
- Sales order list:
  - Reworked fulfillment math so Ready is final output not yet dispatched, Dispatched is shipped quantity, WIP is live in-process batch quantity, and Open is the remaining demand.
  - Added `orderFulfillmentMetrics` to aggregate all display lines before falling back to order-level summary fields.
  - Replaced produced/ready split with one Ready card and one Dispatched card.
  - Removed duplicate tiny metric text below progress bars.
  - Added line color icons on preview lines and contribution bars.
  - Added one consolidated line-wise fulfillment bar in collapsed and expanded views.
  - Segment width is proportional to each line's ordered KG.
  - Segment fill is split by dispatched, ready, WIP, and open using the corrected model.
  - `QuantityStack` no longer renders `PCS n/a for roll`.
  - Collapsed multi-line rows show the top line preview cards by KG, while still using all lines for the total bar.
  - Artwork preview chooses the highest-KG line artwork where available.
  - Status/master/FG/width/height/thickness/style filters now inspect line previews and line snapshots as well as order header data.
  - Cancel modal uses line previews and disables released/in-production/packing/dispatch/completed/cancelled/short-closed lines with a planner-only label.
- Unified sales order tracker:
  - Added order-level fulfillment truth using the same Ready/Dispatched/WIP/Open model.
  - Added line-wise fulfillment bar in the header panel.
  - Added per-line tracker cards with color icons, artwork thumbnails, route/stage flow, batch/lots, jobs, technical chips, and side KPIs.
  - Added Technical + BOM, Documents, and Audit tabs without splitting tracking into a separate action.
  - Replaced the empty-looking header status badge with an explicit visible status badge.

### Final Local Verification Log

- `python3 -m py_compile apps/sales/views_orders.py apps/sales/serializers_orders.py`: passed.
- `.venv/bin/python manage.py check`: passed.
- `.venv/bin/python manage.py test apps.sales.tests.test_sales_order_list_summary apps.sales.tests.test_sales_order_cancel_and_ship_to --noinput`: passed, 18 tests.
- Direct ORM search smoke for the new line/snapshot/artwork search predicates compiled and executed without lookup errors.
- `npm run typecheck`: passed.
- `npm run build`: passed and compiled the touched routes:
  - `/sales/orders`
  - `/sales/orders/[id]`
  - `/sales/orders/[id]/tracking`
  - `/dashboard/planner/control-tower/live-production`
  - `/production/planner/stock-launcher`
- Local rendered QA used the compiled Next production server on `127.0.0.1:3002` with local Django on `127.0.0.1:8000` and authenticated `admin/admin123`.
- Rendered QA checks passed with no browser console errors:
  - Sales list shows total order, ready, dispatch, WIP, open, and line-wise progress.
  - Sales list does not show `PCS n/a`.
  - Collapsed list has line preview chips.
  - Expanded row shows line flow breakdown.
  - Tracker shows Ready, Dispatched, WIP, Open, line-wise fulfillment, and Batch sections.
- Rendered QA order used for proof:
  - `SO-2026-0486`
  - customer `UAT-GREEN Sales Customer`
  - two line previews: `UAT-GREEN Dry Fruit Pouch 240 x 300` and `UAT-GREEN Repeat Pouch`
- Screenshot evidence captured locally:
  - `.runtime/sales-ui-qa/sales-orders-desktop.png`
  - `.runtime/sales-ui-qa/sales-orders-expanded-desktop.png`
  - `.runtime/sales-ui-qa/sales-order-tracker-desktop.png`
  - `.runtime/sales-ui-qa/sales-orders-mobile.png`

## Dark Contrast And Planned-Batch WIP Correction

Time: 2026-06-25, after reviewing the live dark-mode screenshots at 12:31 AM and 12:32 AM.

### User Correction

- Dark-mode WIP and Ready colors must be readable immediately.
- Collapsed sales-order rows should remove repeated common order details from the center and give that space to larger line cards.
- WIP must mean live in-process route/batch quantity only.
- Planned or released-but-not-started batches must remain Open, not WIP.
- Ready means completed final output available in packing yard/dispatch bay but not dispatched to customer.
- Dispatched means sent to customer.
- Expanded rows must show route graph, route jobs, batch/lots, completed route cards, active route cards, and remaining route cards clearly.
- `SO-2026-0166` on AWS showed WIP in the UI while its visible jobs were planned; this had to be verified against the real database.

### Data Truth Found On AWS

- AWS order `SO-2026-0166` exists with id `a73a0a6e-fd7b-46c4-bb14-4d3ecee3f69b`.
- Customer: `Royal Prints`; order status: `RELEASED`.
- Order fulfillment summary from serializer data: produced `0.00 KG`, dispatched `0.00 KG`, remaining `415.00 KG`, completion `0%`.
- Line 1:
  - quantity `175.00 KG`
  - batch `SO-2026-0166-fabd-B01`
  - batch status `PLANNED`
  - job `SO-2026-0166-fabd-1`
  - job state `PLANNED`
  - produced, packed, and dispatched all `0`
  - route node `step_1_EXT`
- Line 2:
  - quantity `240.00 KG`
  - batch `SO-2026-0166-42fc-B01`
  - batch status `PLANNED`
  - job `SO-2026-0166-42fc-1`
  - job state `PLANNED`
  - produced, packed, and dispatched all `0`
  - route node `step_1_EXT`
- Correct UI result for this order is:
  - Target `415 KG`
  - Ready `0 KG`
  - Dispatched `0 KG`
  - WIP `0 KG`
  - Open `415 KG`

### Additional Implementation Log

- Backend batch serializer now includes route jobs under each production batch:
  - job number
  - job state/status
  - quantity/uom
  - produced and remaining quantity
  - work center, machine, operator
  - process code/name
  - route node and branch
  - hold flag
- Sales service types now include batch jobs so frontend route cards do not infer hidden job state.
- Sales order list fulfillment math now treats only active in-process batches/jobs as WIP.
- `PLANNED`, `RELEASED`, `QUEUED`, `READY`, and other pre-production states no longer convert remaining demand into WIP.
- Generic `WAITING` jobs are not counted as WIP; `WAITING_JOIN` remains WIP because it represents an in-route join wait.
- The old fallback that counted a released line's remaining quantity as WIP was removed.
- Open quantity is calculated as target minus Ready, Dispatched, and true WIP.
- Dark-mode color constants were strengthened:
  - Ready uses cyan.
  - Dispatched uses green.
  - WIP uses violet with stronger borders and text.
  - Open uses neutral dark/light surfaces.
  - Line colors use stronger fill plus lighter WIP tones per line.
- Collapsed sales order layout was widened for line cards and reduced in repeated order-level text.
- Line preview cards now show larger line title/status, spec chips, and compact Ready/Dispatched/WIP/Open values.
- Expanded line flow cards now include:
  - route graph cards with Done, Active, Next, and Pending states
  - branch, parallel group, and join key where present
  - batch/lots with current route node and source
  - job rows with work center, process, output, and status
  - completed route cards in green, active route cards in WIP violet, next route cards in amber, pending route cards in neutral
- Unified order tracker uses the same corrected WIP semantics and route card states.

### Tracker Design Reference

- Generated design reference image for the next tracker direction:
  - `/Users/devarshthakkar/.codex/generated_images/019ef613-9645-7311-8795-3a635e3d346a/ig_060ba7789f3db6c4016a3c330ad4488191bc243294f3f93ba3.png`
- Direction captured:
  - sales order fulfillment cockpit and production route cockpit
  - high-contrast dark theme
  - Ready cyan, Dispatched green, WIP violet, Open neutral
  - route graph timeline, batch cards, job cards, and line-color segmented bars

### Verification Log For This Correction

- Repeated AWS Django shell lookup errors were caused by guessed model field names. After two repeats, web search was performed and the fix was to inspect/query actual model attributes instead of guessed `values_list` fields.
- AWS database proof for `SO-2026-0166` confirmed UI WIP was wrong before this pass.
- `python3 -m py_compile apps/production/services/batch_route_service.py apps/sales/serializers_orders.py apps/sales/views_orders.py`: passed.
- `.venv/bin/python manage.py check`: passed.
- `.venv/bin/python manage.py test apps.sales.tests.test_sales_order_list_summary apps.sales.tests.test_sales_order_cancel_and_ship_to --noinput`: passed, 18 tests.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- Local rendered QA initially hit a stale `.next` chunk map. After two repeated Playwright heading timeouts, web search was performed; the efficient fix was to remove the generated `.next` artifact, rebuild, restart the production server, and rerun the smoke.
- Local rendered QA after clean rebuild passed:
  - sales list shows total order, ready, dispatch, WIP, open, and line-wise progress
  - sales list does not show `PCS n/a`
  - collapsed list has line preview chips
  - expanded row shows line flow breakdown
  - tracker shows Ready, Dispatched, WIP, Open, line-wise fulfillment, and Batch sections
  - no browser console errors
- Current local screenshot evidence:
  - `.runtime/sales-ui-qa/sales-orders-desktop.png`
  - `.runtime/sales-ui-qa/sales-orders-expanded-desktop.png`
  - `.runtime/sales-ui-qa/sales-order-tracker-desktop.png`
  - `.runtime/sales-ui-qa/sales-orders-mobile.png`
- Local `next start` on this Mac returns `400` for direct route-group chunk URLs under `_next/static/chunks/app/(dashboard)/...`; live AWS currently serves the route pages and already displayed the affected dark-mode UI, so final dark-mode truth must be verified on AWS after deploy.

### AWS Deployment And Live Verification

- Commit deployed: `d8ad885` (`Fix sales WIP route batch status UI`).
- Git branch pushed: `codex/prod-stability-rbac`.
- Synced worktree to `/opt/tpp-erp/app` on AWS.
- Built Docker images on AWS:
  - backend: passed
  - frontend: passed
  - worker: passed
  - beat: passed
- AWS frontend Docker build compiled touched routes:
  - `/sales/orders`
  - `/sales/orders/[id]`
  - `/sales/orders/[id]/tracking`
  - `/dashboard/planner/control-tower/live-production`
  - `/production/planner/stock-launcher`
- Remote `python manage.py check`: passed.
- Remote `python manage.py migrate --noinput`: no migrations to apply.
- Recreated backend, frontend, worker, and beat containers.
- Container status after recreate:
  - backend healthy
  - frontend healthy
  - postgres healthy
  - redis healthy
  - worker running
  - beat running
- Live route probes after deploy:
  - `https://erp.totalpolyprint.com/api/health/ready/`: 200
  - `https://erp.totalpolyprint.com/sales/orders`: 200
  - `https://erp.totalpolyprint.com/dashboard/planner/control-tower/live-production`: 200
  - `https://erp.totalpolyprint.com/production/planner/stock-launcher`: 200
  - `https://erp.totalpolyprint.com/sales/orders/a73a0a6e-fd7b-46c4-bb14-4d3ecee3f69b`: 200
- Live Next asset proof:
  - `https://erp.totalpolyprint.com/_next/static/chunks/app/(dashboard)/sales/orders/page-083f535c04ab37c7.js`: 200
- AWS deployed data truth for `SO-2026-0166`:
  - line 1 batch `SO-2026-0166-fabd-B01` status `PLANNED`, job state `PLANNED`, WIP false
  - line 2 batch `SO-2026-0166-42fc-B01` status `PLANNED`, job state `PLANNED`, WIP false
  - expected UI after deploy: Target `415 KG`, Ready `0 KG`, Dispatched `0 KG`, WIP `0 KG`, Open `415 KG`

## Expanded Row Route SVG Simplification

Time: 2026-06-25, after reviewing the 2:04 PM screenshot.

### User Correction

- Expanded line rows should not render one large card per route step and one large card per batch/job because long routes will bloat the page.
- Each line should show one compact live route graph instead.
- Route graph must color-code Done, Live, Next, and Open/remaining steps.
- Numbers below/around the graph should make the current route position, batch count, jobs, WIP, ready, dispatched, and open quantities easy to understand.
- Right-side line truth card should stay on the row but use clearer labels and better sizing.
- Keep the page lightweight for many users and large route masters.

### Implementation Log

- Replaced expanded route-step card grid with a single SVG route graph per sales line.
- The route graph uses fixed-height SVG rendering with horizontal overflow instead of growing the row vertically.
- Long routes are compacted around the active/next step with a `+N` hidden-node marker, so route size does not create a huge DOM block.
- Route graph colors:
  - Done: green
  - Live: violet
  - Next: amber
  - Open/remaining: neutral
- The graph header now shows live route status counts: Done, Live, Next, Open.
- The graph footer now shows total steps, batch count, and current batch number.
- Removed the expanded batch/job card grid from the row body.
- Moved batch/job summary into the right-side line production truth card:
  - target quantity
  - Ready
  - Dispatched
  - Route WIP
  - Open
  - current route step
  - batch count
  - job count
  - current batch/status
- Avoided duplicate route graph computation by passing precomputed route graph data into the SVG component.

### Verification Log

- `npm run typecheck`: passed.
- `npm run build`: passed and compiled `/sales/orders`.
- Focused Playwright expanded-row smoke:
  - `Live route graph`: present
  - `Line production truth`: present
  - `Done` and `Next` route counters: present
  - browser console errors: none
  - screenshot: `.runtime/sales-ui-qa/sales-orders-route-svg-expanded.png`
- Full sales UI Playwright smoke passed:
  - sales list shows total order, ready, dispatch, WIP, open, and line-wise progress
  - sales list does not show `PCS n/a`
  - collapsed list has line preview chips
  - expanded row shows line flow breakdown
  - tracker shows Ready, Dispatched, WIP, Open, line-wise fulfillment, and Batch
  - browser console errors: none

## Sales Order Tracker Full Redesign

Time: 2026-06-25, after tracker redesign mockup review.

### User Correction

- Replace the old tracker page instead of patching small sections.
- Use the attached tracker mockup style as the source of truth: dense, full-width, clear KPI cards, line-wise details, route graph, batch production, BOM, documents, and material audit.
- The marked line header area must show each sales-order line details in chips like the sales order list.
- WIP, Ready, Dispatched, Open must not be mixed:
  - Ready means final production is complete and available in packing yard / dispatch bay, not yet sent to the customer.
  - Dispatched means sent to the customer.
  - WIP means only live route/batch work currently in process.
  - Open means remaining target quantity after Ready, Dispatched, and WIP.
- Planned or released lines without active batch work must not show fake WIP.
- The page must work in light and dark mode, desktop, tablet, and mobile, without horizontal overflow.
- Route visualization must be compact enough for long route masters and must not create CPU spikes for many users.

### Implementation Log

- Rebuilt `frontend_v2/src/app/(dashboard)/sales/orders/[id]/page.tsx` into a full order tracker workspace.
- Added a production-truth header with:
  - customer/order identity
  - status, placed date, due date, line count, and ordered quantity
  - fulfillment truth card with one order-level progress bar split by line colors and by fulfillment state
- Added line chips in the header area for each sales-order line:
  - line color marker
  - product / template
  - bag type
  - roll/pcs label
  - width, height, layer, and artwork chips when present
- Added top KPI cards:
  - Ordered
  - Ready (FG)
  - Dispatched
  - WIP
  - Scrap
  - Open
- Added tabs:
  - Line items + live route
  - Technical + BOM
  - Documents
  - Material audit + timeline
- Reworked each line row with:
  - compact line identity and chips
  - artwork thumbnail when available
  - line fulfillment progress bar
  - compact SVG route graph with Done, Live, Next, Open status coloring
  - job-wise breakdown
  - right-side batch/BOM inspector
- Kept the route graph bounded:
  - long route graphs compact around the current route area
  - hidden route nodes show as a `+N` marker
  - graph uses a fixed visual area instead of expanding row height per route step
- Added batch/job detail rendering from live production data:
  - batch status
  - produced quantity
  - current node
  - job sequence, work center, produced quantity, and state
- Added BOM/layer stack detail in the right inspector and Technical + BOM tab.
- Added document and audit/timeline tabs so tracker remains the single production/sales truth page.
- Added responsive layouts:
  - wide desktop: line detail, route graph, and batch inspector use the available horizontal space
  - tablet/mobile: cards stack without horizontal page overflow
- Improved dark-mode contrast for route graph, metric cards, chips, borders, and state colors.
- Updated `frontend_v2/src/components/layout/sidebar-content.tsx` with `prefetch={false}` on sidebar navigation links.
  - This prevents unrelated dashboard links from eagerly fetching chunks during tracker QA and reduces unnecessary network/CPU work in dense production pages.

### Data Rules Locked In

- Sales order line remains the commercial demand.
- Production can split into multiple live batches/lots below that line.
- Route graph is display-only route execution truth:
  - route master controls the route sequence/branches
  - template controls batch/detail flags and commercial production metadata
  - tracker shows the frozen sales-line snapshot and the live batch execution state
- Quantity truth:
  - `orderedKg` = sales line target
  - `readyKg` = finished goods ready but not customer-dispatched
  - `dispatchedKg` = customer-dispatched quantity
  - `wipKg` = active live batch route output in process only
  - `openKg` = max(target - ready - dispatched - wip, 0)
- No fallback WIP is shown for planned-only lines.
- Roll orders skip misleading PCS counts in the sales/order tracker surfaces.

### Verification Log

- `npm run typecheck`: passed.
- `npm run build`: passed.
- Local clean restart with explicit CSRF/CORS origins:
  - `CSRF_TRUSTED_ORIGINS=http://localhost:3002,http://127.0.0.1:3002`
  - `CORS_ALLOWED_ORIGINS=http://localhost:3002,http://127.0.0.1:3002`
  - `FRONTEND_PORT=3002 ./start_all.sh restart`
  - backend health: 200
  - frontend health: 200
- Browser smoke against `http://localhost:3002`:
  - logged in through API CSRF flow
  - opened tracker for `SO-2026-0486`
  - found order number, Line items + live route tab, Fulfillment truth, Order fulfillment, route graph, job breakdown, Ready KPI, and WIP KPI
  - desktop console errors: none
  - bad network responses: none
  - mobile no horizontal overflow: true
  - dark mode width check: true
- Screenshot evidence:
  - `.runtime/tracker-ui-qa/tracker-desktop.png`
  - `.runtime/tracker-ui-qa/tracker-desktop-dark.png`
  - `.runtime/tracker-ui-qa/tracker-mobile.png`

### Completion Status

- Frontend tracker rewrite: complete.
- Backend data contracts reused without breaking API shape.
- Route graph and batch-wise status display: complete.
- Responsive and dark-mode QA: complete.
- Production build verification: complete.
- Git commit and push: complete.
- AWS deploy and live route probes: complete.

### Git And AWS Release Evidence

- Commit deployed: `2e351e6` (`Redesign sales order tracker workspace`).
- Git branch pushed: `origin/codex/prod-stability-rbac`.
- AWS deployment method:
  - targeted sync of changed tracker/sidebar/runbook files to `/opt/tpp-erp/app`
  - rebuilt `frontend` image using `deploy/aws/docker-compose.yml`
  - force-recreated the live frontend container
- AWS frontend Docker build: passed.
  - compiled `/sales/orders`
  - compiled `/sales/orders/[id]`
  - compiled `/sales/orders/[id]/tracking`
  - compiled `/dashboard/planner/control-tower/live-production`
  - compiled `/production/planner/stock-launcher`
- AWS container status after deploy:
  - backend: healthy
  - frontend: healthy
  - postgres: healthy
  - redis: healthy
  - worker: running
  - beat: running
- AWS source hash audit matched local for:
  - `frontend_v2/src/app/(dashboard)/sales/orders/[id]/page.tsx`
  - `frontend_v2/src/components/layout/sidebar-content.tsx`
  - `docs/runbooks/sales-live-production-ui-pass-2026-06-24.md`
- Live route probes after deploy:
  - `https://erp.totalpolyprint.com/api/health/ready/`: 200
  - `https://erp.totalpolyprint.com/sales/orders`: 200
  - `https://erp.totalpolyprint.com/sales/orders/a73a0a6e-fd7b-46c4-bb14-4d3ecee3f69b`: 200
  - `https://erp.totalpolyprint.com/dashboard/planner/control-tower/live-production`: 200
  - `https://erp.totalpolyprint.com/production/planner/stock-launcher`: 200

## Tracker Tab Completion Pass

Time: 2026-06-25, after the live tracker screenshots showed the line/live-route tab was acceptable but the remaining tabs were incomplete.

### User Requirements Covered

- Completed the remaining tracker tabs:
  - `Technical + BOM`
  - `Documents`
  - `Material audit + timeline`
- Kept the tracker as the single sales-order truth page:
  - top order summary stays shared across all tabs
  - line chips show the frozen commercial snapshot
  - each tab uses the same real order/tracking/dispatch API contracts
- Removed the confusing empty-BOM outcome:
  - explicit BOM rows are shown when present
  - when an older order has no explicit BOM table, the frozen layer stack is used as the material architecture fallback
  - the old `No BOM architecture defined on this order snapshot` copy is no longer shown on the technical tab
- Documents now show useful records instead of three generic cards:
  - sales protocol snapshot
  - line technical sheets
  - order tracker link
  - system audit center link
  - customer dispatch documents from `/api/sales/customer-dispatches/`
  - internal production challans from tracking evidence
  - production batch/job documents from line batch summaries and tracking jobs
- Material audit now shows production/material truth from backend data:
  - target, latest output, WIP output, consumed, scrap, and mass gap
  - line material flow cards
  - material ledger with required/used/remaining quantities
  - WIP and interplant trace
  - latest timeline when events exist, with clear real-data empty state when no events are linked
- Visual polish added without placeholder data:
  - soft tinted section headers
  - stronger icon/color hierarchy
  - line-colored technical card headers
  - real quantity cards and progress bars
  - responsive grid layout for desktop, tablet, and mobile

### Data Contracts Used

- Order detail: `/api/sales/orders/{id}/`
- Tracking truth: `/api/analytics/orders/{id}/tracking/`
- Customer dispatch documents: `/api/sales/customer-dispatches/?sales_order={id}`
- Material audit fields:
  - `tracking.material_audit.summary`
  - `tracking.material_audit.item_flow`
  - `tracking.material_audit.materials`
  - `tracking.audit_timeline`
  - `tracking.wip_lineage`
  - `tracking.interplant_links`
- Line technical fields:
  - product master code/name
  - template name
  - order quantity and price basis
  - line status/open demand
  - axis values
  - geometry snapshot
  - printing snapshot
  - packaging snapshot
  - artwork preview
  - explicit `bom_snapshot` or layer-stack fallback

### Verification Log

- `npm run typecheck`: passed.
- `npm run build`: passed.
- Local prod stack restarted with explicit QA origins:
  - `CSRF_TRUSTED_ORIGINS=http://127.0.0.1:3002,http://localhost:3002`
  - `CORS_ALLOWED_ORIGINS=http://127.0.0.1:3002,http://localhost:3002`
  - `FRONTEND_PORT=3002 ./start_all.sh restart`
  - backend health: 200
  - frontend health: 200
- Rendered Playwright QA used temporary Chromium at `/private/tmp/ms-playwright`.
- Live-data tracker QA order:
  - order: `SO-2026-0407`
  - status: `RELEASED`
  - tracking rows: 3 job steps, 2 material ledger rows
- Rendered QA assertions:
  - Technical tab found product/order snapshot, geometry, layer architecture, and BOM/material architecture.
  - Documents tab found document center, commercial/technical docs, customer dispatch docs, internal challans, and batch/job documents.
  - Material audit tab found material audit header, material ledger, line material flow, latest timeline, and WIP/interplant trace.
  - Tracker-only console errors: none.
  - Tracker-only failed requests: none.
  - Mobile horizontal overflow: false (`390px` scroll width equals client width).
- Screenshot evidence:
  - `/private/tmp/tpp-tracker-tabs-qa/live-route.png`
  - `/private/tmp/tpp-tracker-tabs-qa/technical-bom.png`
  - `/private/tmp/tpp-tracker-tabs-qa/documents.png`
  - `/private/tmp/tpp-tracker-tabs-qa/material-audit.png`
  - `/private/tmp/tpp-tracker-tabs-qa/mobile-technical.png`

### Implementation Files

- `frontend_v2/src/app/(dashboard)/sales/orders/[id]/page.tsx`
  - added complete `TechnicalLine` content using real product/order snapshots
  - added BOM/layer fallback helpers
  - added `DocumentsTab`
  - added `MaterialAuditTab`
  - added customer dispatch query for document records
- `docs/runbooks/sales-live-production-ui-pass-2026-06-24.md`
  - appended this completion and verification record
