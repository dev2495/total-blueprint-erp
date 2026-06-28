# Sales Tracker V3.7 Production Completion

## Date
2026-06-28

## Scope
Tracker page Technical + BOM and Material Audit + Timeline were aligned to `docs/mockups/sales-tracker-tech-bom-material-timeline-v37.html` using real order snapshot and tracking API data.

## Completed

### Technical + BOM
- Removed the duplicated sales-detail header inside each technical line card. Sales line details stay in the tracker header/line chips.
- Geometry now renders only relevant pouch/roll fields from the frozen product/order snapshot.
- UAT pouch example shows size, width, height, unit weight, pcs/kg, and total pcs; empty gusset/roll-web placeholders are not rendered.
- Layer architecture shows the frozen layer stack with total thickness and per-layer bars.
- BOM now reads frozen `bom_snapshot.planning_lines` first, then falls back to films, inks, granules, chemicals, addons, POD, packaging, materials, and components.
- BOM rows are grouped as Film, Extrusion recipe, Ink, Chemicals & solvents, Packaging & catalog refs, and Other.
- Direct purchase films and extrusion recipe rows are differentiated so purchase-film orders do not imply an in-house extrusion recipe.
- BOM-by-route-step summary is shown from frozen step data when present, otherwise as a snapshot bucket.

### Backend Tracking Data
- `AnalyticsService.get_order_tracking` now includes frozen sales-order BOM material requirements in `material_audit.materials` even before job material requirements or consumption logs exist.
- Job-generated requirements still dedupe against frozen BOM rows by sales line, step, and material code.
- Material rows now include `source`, `line_labels`, and `row_count` for UI/audit clarity.
- Consumption-only materials continue to appear if production logs exist without a matching requirement.

### Material Audit + Timeline
- Added mockup-style order mass-balance flow: target, output, ready FG, dispatched, live WIP, and open gap.
- Material consumption and yield bars use live tracking totals.
- Material ledger now shows frozen BOM requirements from the backend, not placeholders.
- WIP/interplant trace and timeline remain real-data only with styled empty states when no events exist.

## Verified Locally
- `python3 -m py_compile apps/analytics/services.py`: passed.
- `npm -s --prefix frontend_v2 run lint`: passed with the pre-existing `app/layout.tsx` custom-font warning only.
- `npm -s --prefix frontend_v2 run build`: passed.
- `env FRONTEND_PORT=3000 ./start_all.sh restart`: backend/frontend restarted; both health probes returned 200.
- `env FRONTEND_PORT=3000 ./start_all.sh verify`: deep verification passed across health, route probes, and static asset probes.
- Browser QA on `SO-2026-0489` / `UAT-GREEN Sales Customer`:
  - Technical+BOM active panel shows geometry, layer architecture, Film + Ink BOM rows, `UAT-GREEN-PET-12`, `UAT-GREEN-PE-40`, and `INK-THEORY`.
  - Duplicate technical header sentence is absent.
  - Empty `Gusset --` and `Roll web --` fields are absent.
  - Material Audit API `/api/analytics/orders/7c7d4ed9-db6b-4d29-88a0-6974fd6f5d49/tracking/` returns 3 material rows from frozen BOM: `UAT-GREEN-PE-40`, `UAT-GREEN-PET-12`, and `INK-THEORY`.
  - Responsive dark QA at `390x844` shows Technical+BOM and Material Audit markers with zero horizontal overflow.

## Evidence Screenshots
- `tracker-technical-bom-v37-qa.png`
- `tracker-material-audit-v37-qa.png`

## Related Local UI/Runtime Additions Included
- Sales order list line preview cards were kept in the staged set because they expose the same frozen line geometry/layer details used by the tracker.
- Sales service typings now include `unit_weight_g` so pouch PCS/kg and total PCS math is typed on the frontend.
- Local startup now checks both `.venv` and `venv` Python paths so the active local backend starts reliably after GLM/local changes.
- The accepted v37 tracker and planner mockups are committed as durable design references.

## Modified Files
- `apps/analytics/services.py`
- `frontend_v2/src/app/(dashboard)/sales/orders/[id]/page.tsx`
- `frontend_v2/src/components/sales-orders/sales-orders-list.tsx`
- `frontend_v2/src/services/sales.ts`
- `start_all.sh`
- `docs/changelog/sales-tracker-v37-redesign.md`
- `docs/mockups/sales-tracker-tech-bom-material-timeline-v37.html`
- `docs/mockups/planner-control-tower-v37.html`

## AWS Deployment Evidence
- Git commit deployed: `2403b7fb8dd21bfe56ea86260b6cce3942c1ba83`.
- Git push target: `origin/codex/prod-stability-rbac`.
- Production backup created before deploy: `/opt/tpp-erp/backups/daily/tpp-erp-db-20260628-123454+0530.sql.gz`.
- AWS target: Lightsail `3.6.77.159` / `erp.totalpolyprint.com`, app root `/opt/tpp-erp/app`, Docker Compose file `deploy/aws/docker-compose.yml`.
- Synced the staged tracker/backend/sales-list/runtime/doc/mockup files to `/opt/tpp-erp/app`.
- AWS Docker build passed for `backend`, `frontend`, `worker`, and `beat`; frontend `npm run build` completed the optimized Next.js production build.
- AWS `python manage.py check`: passed with no system-check issues.
- AWS `python manage.py migrate --noinput`: no migrations to apply.
- AWS force-recreate completed for `backend`, `frontend`, `worker`, and `beat`.
- AWS container status after deploy: backend healthy, frontend healthy, postgres healthy, redis healthy, worker up, beat up.
- AWS source hash audit matched local for all deployed files in this pass.
- AWS 3-minute log scan after recreate found no `ERROR`, `CRITICAL`, `Traceback`, `Exception`, `failed`, or `panic` signatures.
- Live route probes returned HTTP 200:
  - `https://erp.totalpolyprint.com/api/health/ready/`
  - `https://erp.totalpolyprint.com/sales/orders`
  - `https://erp.totalpolyprint.com/sales/orders/a73a0a6e-fd7b-46c4-bb14-4d3ecee3f69b`
  - `https://erp.totalpolyprint.com/sales/orders/a73a0a6e-fd7b-46c4-bb14-4d3ecee3f69b/tracking`
  - `https://erp.totalpolyprint.com/dashboard/planner/control-tower/live-production`
  - `https://erp.totalpolyprint.com/production/planner/stock-launcher`

## 2026-06-28 BOM Recipe Correction

### Issue Fixed
- In-house extrusion routes were showing the created film/roll output (`FILM`, e.g. `LDNAT-ML`) alongside the raw-material extrusion recipe in BOM inputs.
- The right-side live line inspector used raw snapshot fields and showed `--` for quantities even when frozen `planned_issue_qty` existed.
- Material Audit could appear empty/dull when API audit events were not posted yet, despite the sales-order snapshot, batches, and BOM being present.

### Completed
- Frontend now detects `EXTRUDE` film rows as created roll output and removes them from consumable BOM input rows.
- Technical+BOM now shows a compact lane header per line with demand, status, batch count, created output, recipe row count, and total BOM rows.
- Technical+BOM grouping now classifies `LDPE`, `LLDPE`, `HDPE`, `METALLOCENE`, `MASTER-BATCH`, and resin rows under `Extrusion recipe`, not `Film`.
- The line inspector right rail now renders layer stack, created output, and normalized recipe/direct-purchase rows with real quantities.
- Material Audit now includes a line-level layer stack and BOM recipe section for each commercial line.
- Material Audit timeline now falls back to real snapshot-derived order, line, batch, and job lifecycle events when the backend audit timeline has no rows.
- Backend material audit now skips created extrusion film outputs while retaining direct-purchase films and raw recipe inputs.
- Backend material audit now also dedupes frozen snapshot material rows when live job requirements already exist for the same sales line/material, preventing recipe totals from doubling after planner release.

### Expected Live Result
- For `SO-2026-0168`, `LDNAT-ML` is visible as created output/layer context, while the consumable BOM/material ledger shows the full extrusion recipe rows only.
- Sidebar `Layer stack / BOM` quantities show `70u`, `250 kg created output`, and recipe quantities instead of `--`.
- Material Audit required kg matches the recipe input total, not recipe plus duplicated job requirements.
