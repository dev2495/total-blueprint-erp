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
