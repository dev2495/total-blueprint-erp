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
- Visitors (FINAL flow, supersedes the earlier pending/admit notes below): the public QR form records the visitor's entry on submit (backend `status: "INSIDE"`, `entry_at` = server submission time); the receipt says "Entry recorded" and that the watchman confirms exit. The watchman screen is the Inside queue only (server search, oldest entry first, "Load more") with Check out confirmation; there are no watchman walk-in, admit or cancel controls, and the watchman never requests the PENDING queue. Legacy PENDING rows are visible and recoverable (Record entry / Remove with backend reason presets) only by the owner. `/gate/visitors/new` (walk-in) is owner-only and is not linked from watchman flows. A card adopts the server status so a completed step is never offered again. Selfies are in-memory object URLs only.
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

## Final visitor flow change (docs/gate-latest-visitor-flow.md)

Files: `public-visitor.tsx` (receipt/title/hints by `receipt.status`; INSIDE ⇒ "Entry recorded", entry time; submit "Record my entry"), `visitor-form.tsx` (consent mentions entry/exit times), `gate-qr-poster.tsx` (steps Scan · Submit "Your entry is recorded" · Exit "The watchman checks you out"), `visitor-queue.tsx` (Inside-only queue + owner-only legacy pending recovery), `visitor-cards.tsx` (PENDING actions owner-only, wording), `gate-home.tsx` (Inside now / Overdue stats, "Inside longest" with checkout, no walk-in link), `gate-format.ts` (PENDING = "Legacy pending", CANCELLED = "Cancelled"), `walk-in-visitor.tsx` + `app/gate/visitors/new/page.tsx` (owner-only), `gate-guards.tsx`, `gate-intelligence.tsx` (Inside / Overdue now; "Legacy pending" exception), `services/gate.ts` (receipt status `INSIDE`, `entry_at`), `lib/sidebar-nav.ts` (Gate parent href `/analytics/reports/gate`), help `roles.json` (WATCHMAN guide: visitors self-record entry, watchman checks out).

Checks: `tsc` 0 errors, `eslint src` 0 problems, theme-token guard, help (173/173, 12 role guides) and nav validators pass, isolated `npm run build` exit 0.

Browser (QA stack):
- 360px public form: header/hint "Your entry is recorded when you submit; the watchman confirms your exit", no horizontal scroll. Before the backend restart the API still returned `PENDING` + the old server message; the UI shows a neutral "Registration received" state (it never claims an admission step). See the post-restart section for the INSIDE path.
- Watchman 390px: `/gate` and `/gate/visitors` show Inside-only UI with no Admit/Walk-in/Remove/Waiting controls and no `status=PENDING` request; `/gate/visitors/new` ⇒ "owner only".
- Owner: legacy pending recovery lists 2 rows; removed my stale QA row "QA Final Flow Visitor" with "Duplicate / mistaken registration" (toast + row gone).
- Delegate (`gate.reports`): sidebar Gate parent and command palette both resolve to `/analytics/reports/gate`.

Post-restart verification (API pid started 17:10:44):
- 360px public submit "QA Self Entry Visitor" ⇒ receipt "Entry recorded", entry time 05:11 PM, reference shown; no horizontal scroll; localStorage holds only UI prefs (`tpp-theme`, sidebar pin), sessionStorage empty.
- Watchman 390px `/gate`: "Inside now 1 · Overdue >12h 0", the visitor listed under "Inside longest" with only a Check out control; confirmation sheet "Check out visitor? … Inside since 05:11 PM" ⇒ toast "checked out at 05:11 PM"; INSIDE search for the visitor returns 0 afterwards.
- Watchman API refusals: POST `visitors/` (walk-in) 403, `visitors/<id>/check-in/` 403, `visitors/<id>/cancel/` 403.
- Last wording change (removal toast "removed from the queue") re-checked: `eslint src` 0 problems, help/nav validators pass, isolated `npm run build` exit 0.
- Frontend source is final; no further frontend edits after this pass.

## Defensive guard (final, Opus 5.5 Medium)

- `src/components/gate/visitor-cards.tsx` `VisitorPass`: the PENDING action footer (Record entry / Remove) now renders only when `visitor.status === "PENDING" && isOwner`, matching the already owner-gated PENDING timer branch. A stale cached or malformed PENDING row can no longer expose entry/cancel controls to a watchman (the backend already returns 403). No other changes.
- Checks: `tsc --noEmit` no errors, `eslint src` 0 problems, help (173/173) and nav validators pass, isolated `npm run build` exit 0 (theme-token guard passed, compiled successfully).

## Receipt time and invalid-link copy (final, Opus 5.5 Medium)

- `src/components/gate/public-visitor.tsx`: the receipt's "Entry time" row renders only for `status: "INSIDE"` and only from the server receipt's `entry_at` (unknown ⇒ "—"); the device-clock fallback (`savedAt`/`submittedAt`) was removed entirely. Non-INSIDE receipts show no time row.
- Invalid/missing-token notice now reads: "This link is incomplete. Please rescan the QR code displayed at this factory's gate, or ask the watchman for the correct gate QR." (no "register you" wording).
- Browser (API reloaded with `entry_at` in safe receipts), 360px: public submit "QA Receipt Time Visitor" ⇒ receipt keys `receipt_id, status, entry_at, message, replayed`, status INSIDE, `entry_at` 2026-10-07T11:48:43Z; UI "Entry time 05:18 PM" equals the server value in Asia/Kolkata. `/visit` shows the new notice copy. (This QA visitor remains INSIDE in the QA DB.)
- Checks: `tsc` 0 errors, `eslint src` 0 problems, help (173/173) and nav validators pass, isolated `npm run build` exit 0.
- Frontend source frozen.

## Admin/Owner full gate access, Gate Setup, discoverability, one-page print (Opus 5.5 Medium)

Supersedes the earlier "owner-only" wording above. Policy implemented (mirrors backend `PermissionService.is_gate_master`, read in `apps/users/permission_service.py`; `entitlements.gate_master` is sent by `/api/users/me`):
1. WATCHMAN ceiling first — actual or effective (role preview) WATCHMAN never gets master access.
2. Actual role ADMIN / SUPER_ADMIN / OWNER, or `is_owner`, or `is_superuser` ⇒ full Gate (setup, terminal, visitors, register, history/corrections/audit, QR, report, daily pack). A non-watchman preview (e.g. Admin previewing Owner) keeps it. When the backend sends `gate_master`, the UI uses it.
3. Everyone else: literal `gate.reports` only ⇒ sanitized report and read-only archive; never inferred from `*`.

Files (base commit f7fbd1b):
- `src/components/gate/gate-access.ts` — `isGateMaster` (+`GATE_MASTER_ROLES`); `isGateOwner` is now an alias; `canLogAtGate` / `canViewGateReports` use it.
- `src/lib/sidebar-nav.ts` — `canAccessGateTarget` uses actual base role / is_owner / is_superuser / `gateMaster` (removed the `currentRole === baseRole` over-restriction; watchman ceiling first). New first-class section **"Gate & Visitors"** ordered right after Operations: Gate Setup, Gate Terminal, Visitors Inside, Today's Gate Register, Gate History, Visitor QR Poster, Gate Report, Gate Report Pack. Parent href `/analytics/reports/gate` (valid for delegates). Old "Gate" section removed.
- `src/components/layout/sidebar-content.tsx`, `src/components/layout/command-palette.tsx` — pass `isSuperuser` and `gateMaster` to the access context (search uses the same rule).
- `src/components/auth-provider.tsx` — `entitlements.gate_master` type.
- `src/lib/navigation-routes.ts` — `/gate/setup`.
- New `src/app/gate/setup/page.tsx`, `src/components/gate/gate-setup.tsx` — explains that gates/QRs come automatically with each plant (no separate registration); 1 choose factory (+ link to real plant master `/factory/plants`), 2 print that factory's QR (shows its public link, opens `/gate/qr`), 3 assign a watchman via real `/system/users` and `/system/users/new` (role Watchman + Gate assignment), 4 tools: terminal, visitors, today, history, report, daily pack (`/system/report-center`).
- `src/components/gate/gate-shell.tsx` — Gate setup in account menu, "Admin / Owner · full gate access" label, `gate-main` class for print, admin/owner copy in blocked states, **Exit role preview** button when a non-watchman account is previewing Watchman.
- `src/components/gate/gate-guards.tsx`, `gate-home.tsx` (Gate oversight: setup, history, QR, report), `gate-history.tsx`, `gate-qr-poster.tsx`, `visitor-queue.tsx` — "Admin · Owner" copy.
- Print: `gate-tokens.css` print rules scoped to the poster page (`html:has(.gate-print-root)`, `.gate-main`, `.gate-canvas`, `.gate-print-root > *`, `.gate-poster` 210mm × 296.5mm, no radius/shadow, break-avoid); the A4 zero-margin `@page` stays inside the poster component so other ERP pages print unchanged. QR/logo/module artwork unchanged. Visible keyboard focus ring for `.gate-press` controls.
- `src/app/(dashboard)/analytics/reports/page.tsx` — "Gate & Visitors" group: Gate Register report (masters + `gate.reports`) and Gate Register Daily pack card (masters only).
- `src/app/(dashboard)/analytics/reports/gate/page.tsx` — admin/owner default access copy.
- `src/help/content/pages/pages.json` — gate report guide roles ADMIN/OWNER/SUPER_ADMIN, admin/owner default access, Gate Setup action, related routes incl. `/system/users`, `/factory/plants`.
- Audit Center gate stream and the executive Gate card follow automatically (they use `isGateOwner`/backend `gate` data).

Browser (QA stack, API restarted 18:40:36 with master policy):
- Actual ADMIN `gate_qa_admin` (`is_owner=false`, `gate_master=true`): `/analytics/reports/gate` renders the report (no "not assigned"); sidebar shows all Gate & Visitors links incl. setup and report pack.
- Same admin previewing OWNER (`x_role_override=OWNER`, entitlements role OWNER, `gate_master=true`): report renders; `/gate/setup` renders 4 steps, factory QR link, links `/factory/plants`, `/gate/qr`, `/system/users`, `/system/users/new`, terminal/visitors/today/history/report/pack.
- Same admin previewing WATCHMAN: `/api/users/me` `gate_master=false`, report API 403, ERP page redirects to `/gate`, setup locked; "Exit role preview" returned to `/dashboard/admin`.
- Actual OWNER: reports hub Gate & Visitors shows report + daily pack; sidebar full; `/gate/setup` renders.
- Delegate `gate.reports`: sidebar/hub only `/analytics/reports/gate`, no pack card; `/gate/setup` ⇒ "No gate access".
- Actual WATCHMAN 360px and 390px: bottom tabs Gate / Goods / Visitors / Today (86×56 each, `aria-current`), visible keyboard focus ring, no horizontal scroll, no setup link, Visitors = "Inside now" with no entry controls.
- Print: headless Google Chrome via playwright-core, admin login, `/gate/qr`, `page.pdf({format:"A4", preferCSSPageSize:true, margin:0, scale:1, printBackground:true})` ⇒ **1 page**, poster box 793.7 × 1120.6 CSS px (210 × 296.5 mm) at top 0; visually complete (header, QR + centre mark, URL, 3 steps).

Checks: `tsc --noEmit` 0 errors, `eslint src` 0 problems, theme-token guard, help (173/173, 12 role guides), nav (86 sidebar / 154 resolver routes), user-facing version privacy — all pass. Full `npm run build` in a separate copy: exit 0 (BUILD_ID `odNSoU8daRJ0P4Tj24Qwp`).

Production build copy for independent root UI QA (source = this worktree on f7fbd1b + the uncommitted frontend changes above; `node_modules` symlinked; `.next` production output present):
`/private/tmp/claude-501/-Users-devarshthakkar-Documents-total-blueprint-erp/e86e327f-49cf-4e85-8b8b-c55401132baa/scratchpad/fe-build`
Print check script used: `…/scratchpad/print-check.cjs` (reads the local QA fixture; writes the PDF path given as argv).
No deployment, commit or push by Claude.
