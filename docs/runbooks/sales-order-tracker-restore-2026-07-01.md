# Sales Order Tracker Restore - 2026-07-01

## Outcome

Restored the full sales order detail/tracker workspace that was live before the label/sidebar polish work. The production page at `/sales/orders/[id]` is back to the detailed tracker surface with line route tracking, order flow, batch/job panels, technical and BOM tabs, documents, and material audit/timeline.

The restore was deployed to AWS production and verified on `erp.totalpolyprint.com`.

## Cause

The full tracker implementation lived in `frontend_v2/src/app/(dashboard)/sales/orders/[id]/page.tsx`. Later sales label/sidebar work replaced that detailed page with a simplified order detail page, while `/sales/orders/[id]/tracking` remained only a redirect-style route. That is why the rich tracker disappeared from the live order detail page even though list/label work was still present.

## Restored Page Surface

- Header and fulfillment truth summary.
- Full order KPI strip.
- `Lines + live route` tab with per-line route flow, job breakdown, batch inspector, and live progress.
- `Technical + BOM` tab with product geometry, materials, route and sourcing detail.
- `Documents` tab with dispatch/document center.
- `Material audit + timeline` tab with material control and latest events.
- Existing API-backed tracking data remains used through `getOrderTracking`.

## Label Rules Preserved

- Sales order line label still prefers the canonical line label from the latest label work.
- Product line chips remain in the newer format:
  - no generic `2 layers` chip,
  - no wasted `L1/L2` text in layer chips,
  - no layer width duplicated inside layer chips,
  - printing chip appears only for print orders,
  - layer chips show layer variant, grade, and thickness in the compact readable format.
- Packing details remain out of the visible line label/chip set.

## Code Change

- Restored the full tracker file from the pre-regression implementation at commit `717f25d`.
- Re-applied the latest label/chip helper logic on top of the restored tracker file.
- Fixed the tracker TypeScript boundary for runtime `unit_weight_g` data by reading it through the order snapshot/runtime record.

Changed file:

- `frontend_v2/src/app/(dashboard)/sales/orders/[id]/page.tsx`

## Git

- Restore commit: `c12be6a Restore full sales order tracker page`
- Pushed to `origin/main`.

## Local Verification

- `git diff --check`: passed.
- Targeted TSX transpile check for the restored page: passed.
- Single-file TypeScript program check for the restored page: passed.
- Static section check confirmed the restored tracker sections exist:
  - `OrderFlowBar`
  - `LineTrackerSection`
  - `RouteGraph`
  - `BatchInspector`
  - `TechnicalLine`
  - `DocumentsTab`
  - `MaterialAuditTab`

Note: local full `npm run typecheck` reached theme-token guard and route type generation, then stalled in the local `tsc --noEmit` phase as seen in prior work on this stack. The AWS Docker production build below was used as the hard compile gate.

## AWS Deployment

- Exported committed source from `c12be6a` into `/private/tmp/tpp-tracker-restore-c12be6a`.
- Synced the clean export to AWS Lightsail host `3.6.77.159` at `/opt/tpp-erp/app`.
- Preserved runtime/build/media/dependency paths during sync:
  - `.env`
  - `.runtime`
  - `.venv`
  - `venv_311`
  - `node_modules`
  - `frontend_v2/node_modules`
  - `frontend_v2/.next`
  - `.next`
  - `staticfiles`
  - `media`

Source hash parity for the restored tracker file:

- Local: `324383527a5492ac41e55f08a0c60d6091d4bfbf8dd7c2646e20b6336ef86490`
- AWS: `324383527a5492ac41e55f08a0c60d6091d4bfbf8dd7c2646e20b6336ef86490`

## AWS Build And Runtime Verification

- `sudo docker compose -f /opt/tpp-erp/app/deploy/aws/docker-compose.yml build backend frontend worker beat`: passed.
- Frontend production build passed:
  - theme-token guard,
  - route type generation,
  - TypeScript,
  - Next optimized production build.
- Build output includes `/sales/orders/[id]` as the restored dynamic tracker route.
- `python manage.py check`: passed with no issues.
- `python manage.py migrate --noinput`: passed with no migrations to apply.
- Recreated production containers:
  - backend healthy,
  - frontend healthy,
  - postgres healthy,
  - redis healthy,
  - worker running,
  - beat running.

Live HTTPS probes returned `200`:

- `https://erp.totalpolyprint.com/api/health/ready/`
- `https://erp.totalpolyprint.com/sales/orders`
- `https://erp.totalpolyprint.com/sales/orders/7dfa83cd-90a9-47ee-929d-396993aed1f4`
- `https://erp.totalpolyprint.com/sales/orders/7dfa83cd-90a9-47ee-929d-396993aed1f4/tracking`
- `https://erp.totalpolyprint.com/dashboard/planner/control-tower/live-production`
- `https://erp.totalpolyprint.com/production/planner/stock-launcher`

Production log sample after restart:

- Frontend started and reported ready.
- Backend health probes returned 200.
- Worker connected to Redis and processed scheduled checks.
- Beat started and dispatched scheduled tasks.
- No traceback or page compile/runtime error appeared in the sampled logs.
