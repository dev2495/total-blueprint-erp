# Gate & Visitor Register — frontend delivery (Claude)

## Provenance

- Author: Claude Code desktop, model **Opus 5.5** (`claude-opus-5-5`), effort **Medium**. No subagents were used; all frontend code in this delivery was written in this single session.
- Checkout: `/private/tmp/tpp-watchman-20261007/frontend_v2`, branch `codex/watchman-gate-20261007`. No backend files edited, no commits/push/deploy, no migrations or manual DB changes.
- QA data: browser checks ran against the isolated local QA stack (backend `127.0.0.1:8017`, frontend dev `127.0.0.1:3017`, fixture `.runtime/gate-qa.json`). Test entries created through the UI there: invoices `CLQA-7731` (later corrected with reason), `CLQA-LOST-743657`, one public visitor "QA Claude Visitor" (admitted, checked out). Fixture passwords were used only in-browser for login and not copied into any file in the repo.
- Contracts followed: `docs/gate-api-contract.md`, `docs/gate-rbac-frontend-contract.md`, `docs/gate-final-frontend-review.md`.

## Files

New
- `src/services/gate.ts` — typed client for `/api/gate/*`; public visitor client uses `fetch` with `credentials: "omit"`.
- `src/components/gate/` — `gate-tokens.css` (gate design tokens), `gate-shell.tsx` (watchman shell, plant scope, blocked states), `gate-access.ts` (owner = actual `is_owner`/OWNER; `gate.reports`/`gate.log` literal grants, never `*`), `use-gate-operation.ts` (one action → one frozen payload + client_token), `gate-ui.tsx`, `gate-format.ts`, `gate-home.tsx`, `goods-entry.tsx`, `register-ledger.tsx`, `today-register.tsx`, `visitor-cards.tsx`, `visitor-queue.tsx`, `visitor-form.tsx`, `selfie-capture.tsx`, `walk-in-visitor.tsx`, `public-visitor.tsx`, `gate-history.tsx`, `gate-qr-poster.tsx`, `gate-intelligence.tsx`, `gate-guards.tsx`.
- Routes: `src/app/gate/{layout,page}.tsx`, `gate/goods`, `gate/visitors`, `gate/visitors/new`, `gate/register`, `gate/history`, `gate/qr`; public `src/app/visit/{layout,page}.tsx`, `visit/[token]/page.tsx`; `src/app/(dashboard)/analytics/reports/gate/page.tsx`.
- `src/components/system-users/gate-plant-scope.tsx`.

Modified
- `middleware.ts` — `camera=(self)` only on `/visit/*` and `/gate/visitors/new`; all other routes keep `camera=()`.
- `auth-provider.tsx` — `/visit` is public (no login redirect / keepalive).
- `(dashboard)/dashboard-layout-client.tsx` — WATCHMAN never renders ERP chrome; redirected to `/gate`.
- `lib/roles.ts` (WATCHMAN label + `/gate` landing), `lib/sidebar-nav.ts` (Gate section with `gateAccess` owner-only / literal-permission rule), `lib/navigation-routes.ts`.
- `system-users/user-editor.tsx` — `gate_plant_ids` picker; WATCHMAN saves with `is_owner=false`, `extra_permissions=[]`; overrides / work-center sections hidden for that role.
- `dashboard/executive-deck.tsx` — owner Gate register card from control-tower `gate`.
- `system/audit/page.tsx` — `gate` stream (shown only to actual owner).
- `analytics/reports/page.tsx` (Gate & security group for owner/`gate.reports`), `analytics/report-config.ts` (+`maxColumns`, +`dateKey`, gate config with `dateKey: "date"`, `trendMeasures: inward/outward/total`), `analytics/report-view.tsx` (honours `maxColumns` and an explicit `dateKey`, falling back to auto-detect for other reports).
- `app/layout.tsx` imports gate tokens; help `pages.json` (+`/analytics/reports/gate`) and `roles.json` (+WATCHMAN).
- Report pack: `gate_register_daily` comes from backend profiles; no `GATE_REGISTER` code added.

## Behaviour notes

- Invoice and vehicle numbers are typed; vehicle is never prefilled from ERP. Party/products/units come only from `/api/gate/masters/` (server search, 100 cap). ERP match fills party/lines/date/amount; source warnings (draft challan, unlinked rows) are shown; unmatched saves as owner review; observed quantities optional on matched docs.
- Idempotency: first tap freezes payload + UUID token (Blob-safe). Offline/timeout/408/429/any 5xx ⇒ "Not confirmed yet", form locked, "Send same entry again" resends identical bytes. 4xx ⇒ "Not saved", form intact, token retired. `GATE_ID_STORAGE_UNAVAILABLE` ⇒ definitive, asks to choose ID "None". Saved only after a server receipt; a failing cache refresh cannot demote it.
- Visitors: public form → PENDING "wait for watchman" only. Queues use server search + paging: the API sorts PENDING by oldest submission and INSIDE by oldest entry (across all pages), the first page of 100 loads, and "Load more" fetches further pages on demand (no automatic multi-page fetch, for mobile performance). Counts come from the server summary. Admit / Check out / Not admitted (backend presets) with confirmation; card adopts server status so a completed step is never offered again. Selfies are in-memory object URLs only.
- QR poster renders the backend SVG as an `<img>` (no redraw); optional small centre mark.

## Checks (all run in this session)

- `node scripts/check-theme-tokens.mjs` — passed.
- `tsc --noEmit` — 0 errors. `eslint src --ext .ts,.tsx` — 0 problems.
- `validate_help_coverage.mjs` — passed (173 routes / 173 guides / 12 role guides). `validate_nav_routes.mjs` — passed (83 sidebar / 153 resolver routes). `check-user-facing-version-labels.mjs` — passed.
- `npm run build` (full script: token guard, typegen, tsc, next build) — exit 0. Run in an isolated copy (`node_modules` symlinked) so the running dev server's `.next` was not touched.
- Browser (built-in pane, 390×844 and desktop):
  - `/visit/<gate_token>`: config from backend, validation, submit → PENDING receipt; localStorage/sessionStorage contain no visitor data. `Permissions-Policy` verified: `camera=(self)` on `/visit`, `camera=()` on `/login`.
  - WATCHMAN: `/dashboard/owner` → redirected to `/gate`; admit → check-out with server times; exited visitor leaves active queue; `/gate/history` blocked.
  - Goods: ERP-matched duplicate invoice ⇒ 409 "Not saved", form preserved, double tap sent 1 POST. Unmatched entry saved with receipt (Owner review).
  - Lost response: first POST committed (201) but response dropped by an XHR shim ⇒ "Not confirmed yet"; retry sent identical bytes and the same `client_token`; server replayed; 1 register row and exactly 1 audit event (`GOODS_LOGGED`).
  - Owner: history filters, mismatch detail with Gate-vs-ERP comparison, reasoned correction with before→after in append-only audit; QR poster; QR decoded by the browser `BarcodeDetector` to the exact public URL both plain and with the centre mark; executive Gate card; Audit Center gate stream (40 events); Report Center lists Gate Register Daily; user editor shows/hydrates gate assignment.
  - Unassigned watchman ⇒ "Gate not assigned". Delegate (`gate.reports`) ⇒ report only (14 columns, entries labels, unknown amount "—"), no history.

## Known / pending

- Gate report trend: wired to the backend daily series `{date, inward, outward, total}` (Asia/Kolkata) via `dateKey: "date"` and `trendMeasures: inward/outward/total`. Populated-chart browser verification: see "Trend verification" below.
- Pre-existing dev warning on every route: CSP nonce hydration mismatch in the root `<Script>` (not gate code).
- Help screenshots for gate pages were not generated (not required by validators).

## Trend verification (after backend API restart, pid started 16:37:54)

- `GET /api/analytics/reports/gate/?date_from=2026-09-08&date_to=2026-10-07` → 200, 30 daily rows `{date, inward, outward, total}`; non-zero: 2026-10-06 inward 3/total 3, 2026-10-07 inward 11/total 11.
- `/analytics/reports/gate` (delegate `gate.reports` session): "No time series" message gone; one trend chart rendered over 8 Sept–7 Oct with measure toggle Inward / Total and the line rising to 3 and 11 on the last two days; insight "Peak inward was 11 on 7 Oct."
- Outward toggle is not shown because the shared ReportView hides measures that are zero on every day (existing behaviour for all reports); the QA data has no outward entries. It appears automatically when outward data exists.
- Re-run after the series change: `tsc` 0 errors, `eslint src` 0 problems, help/nav validators pass, isolated `npm run build` exit 0.

## Final pass (backend reloaded with oldest-first visitor sort)

- Removed the automatic 5-page visitor fetch; `visitor-queue.tsx` and `gate-home.tsx` comments now describe the server's oldest-first order. "Load more" + server `search` keep every active visit reachable.
- Browser: watchman `/gate/visitors` order matches `GET /api/gate/visitors/?status=PENDING` (oldest `submitted_at` first); no page≥2 request fired automatically; no Load more shown because only one active visitor exists in QA data.
- Trend re-verified after reload: API 30 rows (6 Oct total 3, 7 Oct total 11); chart rendered with one curve, Inward/Total toggles, insight "Peak inward was 11 on 7 Oct."
- Final checks: `tsc` 0 errors, `eslint src` 0 problems, help (173/173) and nav validators pass, isolated `npm run build` exit 0.

## Reports Hub archive access (delegate fix)

- `src/app/(dashboard)/analytics/reports/page.tsx`: split `configRestricted` (profiles 403 → pack generation panel hidden, "Daily packs: Restricted") from `archiveRestricted` (runs 403 → runs panel hidden). The "restricted" placeholder shows only when both are 403. The expected 403s no longer raise the global "Data load failed" toast (`meta.suppressGlobalError`).
- QA setup: as owner, generated one `gate_register_daily` run for 2026-10-07 (run 1, SUCCEEDED) via the existing send endpoint, so the delegate had a gate archive to read.
- Browser as `gate.reports` delegate on `/analytics/reports`: `report-distributions` 403, `report-runs` 200; "Recent report runs" panel shows "Gate Register Daily · succeeded" read-only, with Preview PDF (200) and Detail workbook (200); 0 "Generate daily pack" buttons, no generation panel, no error toast; direct POST `…/gate_register_daily/send/` → 403 and PUT `report-distributions/` → 403.
- Checks: `tsc` 0 errors (via build), `eslint src` 0 problems, help/nav validators pass, isolated `npm run build` exit 0.
- Frontend source is final; no further frontend edits after this pass.
