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
  - Protected analytics tracking API returned 401 without session, expected for unauthenticated API access.

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
