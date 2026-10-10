# Bills & documents, outward evidence, gate passes and job work — build spec

Branch `codex/documents-jobwork-20261010`, based on the live AWS release `38ca792b` (`origin/codex/bill-intake-live-20261008`).
Business plan: `~/Documents/total_blueprint_erp/gate-documents-plan-20261009/FINAL-PLAN.md` (read §0–§5 before starting).

Client decisions (10 Oct 2026):
- Stock items are what the ERP must get right. Every other bill is mainly a record.
- **No spares stock ledger.** General Receipt lines only carry *kept in store / installed / consumed* + machine.
- **PDF uploads are accepted** from the office (rendered to page images server-side; original kept).
- **Images stay in PostgreSQL.** Growth is monitored (`apps/gate/storage_monitor.py`, already built).
- **All bill/document rights belong to Inventory (STORE) only by default.** Owner/Admin always have them. Any other role or account gets them only through the Role matrix (role overrides) or user extra permissions. Watchman never has office rights.

## 0. Ground rules for every workstream

- **Git:** never commit, stash, reset, checkout or push. The coordinator commits.
- **Ownership:** only edit files you own (§2). If you must change a file outside your ownership, keep the change minimal and list it in your final report under "Out-of-ownership edits".
- **Backend tests:** `source /private/tmp/claude-501/-Users-devarshthakkar-packaging-erp/4b6c5a9d-9d6d-44b3-afa8-12ca9e020a7f/scratchpad/testenv.sh` and then override `DB_NAME` with your own (A: none, B: `tpp_ws_b`, C: `tpp_ws_c`, D: `tpp_ws_d`). Example: `DB_NAME=tpp_ws_b venv/bin/python manage.py test apps.gate --keepdb --noinput`. The first run creates `test_tpp_ws_b` (about 90 s). Never edit a migration after it has run; add a new one.
- **Migrations:** the coordinator already created `gate.0004_documents_outward_gate_passes` and `procurement.0006_general_receipts`. Only these may add migrations:
  - **B:** `procurement`
  - **C:** `inventory`, `production`
  - **D:** `gate` (0005+)
  - B must not add gate migrations. If B needs a gate schema change, it uses existing fields or reports the need.
  - Any new NOT NULL column on an existing table needs `db_default` (rollback compatibility: the previous app image must still be able to INSERT).
- **Frontend checks:** `cd frontend_v2 && ./scripts/with-supported-node.sh npx tsc --noEmit -p tsconfig.json` and `./scripts/with-supported-node.sh npx eslint <your files>`.
  - Never run `next build` or `next dev`, and never touch `.next`. The coordinator builds and runs browser E2E.
- **Patterns to reuse:**
  - Idempotency: `apps.gate.services.idempotent_action(plant, scope, data_with_client_token, operation)`, or a model `request_key` + fingerprint as in `procurement`.
  - Audit: `GateAuditEvent`, append-only, `object_type` ≤ 12 chars. Use `BILL`, `OUTWARD`, `GATE_PASS`, `GEN_RECEIPT`, `JOBWORK`.
  - Private images: `apps.gate.views.private_response` and `apps.gate.document_pages`.
  - Pagination: `apps.gate.views.paginated`.
- **Quality bar:** production ready.
  - Server-side validation of plant scope, permissions, quantities, states and concurrency (`select_for_update` on the parent row). Atomic transactions. Retry-safe tokens.
  - No TODO/placeholder logic.
  - Every UI page has loading, empty, error-with-retry, permission-denied, success and mobile (360–390 px) states, plus keyboard-accessible controls.
  - Copy is plain and specific. Use the existing design tokens and components (`frontend_v2/src/components/ui`, `gate-tokens.css` patterns, `bill-common.tsx` helpers).
- **Tests:** API tests for every endpoint. Include:
  - Happy path.
  - Permission matrix: Store yes; Planner/Sales no; Watchman no; Owner yes; a role granted via `Role.default_permissions` yes; a user granted via `extra_permissions` yes.
  - Validation errors, cross-plant refusal, same-token replay, changed-payload replay (409) and state conflicts.
  - Proof that no production stock changes where none should.

## 1. Already built (foundation, do not rebuild)

**Models (`apps/gate/models.py`)**
- `InwardBillIntake` gained header fields:
  - `source` (GATE / OFFICE), `doc_type`, `category`, `vendor`, `party_name`
  - `invoice_number`, `invoice_normalized`, `invoice_date`, `invoice_fy`
  - `taxable_amount`, `tax_amount`, `total_amount`, `due_date`, `valid_until`
  - `ship_to_plant`, `attached_to` (supporting document), `classified_at/by`
  - `header_version` (optimistic concurrency for header edits)
  - status `FILED`
- Constants: `DOCUMENT_TYPES`, `DOCUMENT_CATEGORIES`, `RECORD_ONLY_CATEGORIES`, `GENERAL_RECEIPT_CATEGORIES`.
- New models:
  - `DocumentPageView` (shared rotation)
  - `DocumentOriginalFile` (original PDF, immutable)
  - `DocumentSequence`
  - `OutwardDocument` / `OutwardDocumentPage` / `OutwardDocumentLink`
  - `GatePass` / `GatePassLine` / `GatePassReturn`
- PostgreSQL triggers make these immutable or append-only: pages, originals, returns, outward departure evidence and outward links (only `removed_*` may be stamped, once).

**Models (`apps/procurement/models.py`)**
- `GeneralReceipt` and `GeneralReceiptLine`, plus choices `GENERAL_RECEIPT_TYPES`, `GENERAL_LINE_CATEGORIES`, `GENERAL_LINE_DISPOSITIONS`, `GENERAL_UOMS`.

**Helpers**
- `apps/gate/numbering.py` — `next_document_number(key, prefix=..., width=...)` inside a transaction gives `GR-2627-000001`. Keys and prefixes:
  - `GR` General Receipt
  - `RGP` / `NRGP` gate passes
  - `JWO` job-work order
  - `JWC` job-work challan
  - `JWR` job-work return
- `apps/gate/bill_services.py`:
  - `register_receipt_kind(kind, snapshot, is_linked=None)`
  - `receipt_kinds()`
  - `attach_receipt_to_bill(user, bill_id, kind, object_id, complete=False, reason="")`. Call it inside your receipt transaction. It locks the bill, checks vendor/invoice consistency and one-bill-per-receipt, sets PARTIAL_GRN or RECEIPTED, and writes audit.
  - Receipt kinds `GENERAL_RECEIPT` and `JOBWORK_RETURN` are allowed in `InwardBillReceiptReference.kind`.
- `apps/gate/document_pages.py`:
  - `serialize_pages(kind, pages, url_for)` adds `thumb_url` and `display_rotation`.
  - `page_image_bytes(page, request)` serves `?w=160|320|640` thumbnails.
  - The rotation endpoint is `POST /api/gate/document-pages/rotation/` `{page_kind, page_id, rotation, client_token}`.
- `apps/gate/qr.py`:
  - `make_token(kind, uuid)` → `TPP1.KIND.uuid.sig`
  - `parse_token(raw)`, `register_qr_kind(kind, resolve, on_gate_out=None)`
  - `qr_svg(token)`, `qr_png_bytes(token)`
- `apps/gate/gate_pass_services.py` — `record_gate_pass_return(user, line_id=, quantity=, general_receipt_line_id=, inward_document_id=, notes=)`, plus snapshot and audit helpers. D owns this file afterwards.
- `apps/gate/storage_monitor.py`, `storage_views.py`, the `document_storage_report` command and `GET /api/gate/document-reports/storage/` (Owner/Admin).
- `apps/gate/tasks.py`, with beat entries in settings for:
  - `document_reminders_task` → `apps.gate.document_reminders.run_document_reminders` (**B implements**)
  - `gate_pass_overdue_task` → `gate_pass_services.run_gate_pass_overdue_reminders` (**D implements**)
  - `apps.inventory.tasks.jobwork_overdue_task` (**C creates in `apps/inventory/tasks.py`**)

**Permissions**
- Registry entries:
  - `documents.view`, `documents.upload`, `documents.manage`, `gatepass.manage`, `outward.reconcile` (STORE default)
  - `gate.outward.submit` (WATCHMAN)
  - page permissions `page.inventory.{general_receipts,gate_passes,outward_documents}.view`
- `PermissionService.has_document_permission(user, code)` — real account only; Owner/Admin true; Watchman false. `documents.view` is implied by any other document right.
- `PermissionService.document_entitlements(user)`, `PermissionService.document_plants(user)`.
- `has_inventory_bill_review` also accepts `documents.manage` (it still needs `inventory.manage` or `procurement.manage`; it is stock-posting authority).
- Entitlements payload includes `documents: {code: bool}`.
- RBAC route map: `/api/gate/document-pages/`, `/api/gate/outward-documents/`, `/api/gate/qr/resolve`, `/api/gate/gate-passes/`, `/api/gate/document-reports/`, `/api/procurement/general-receipts/`.
- Inward-bills actions: `office-upload` → `documents.upload`; `<id>/(classify|file|attach|detach|reopen)` → `documents.manage`. Views must still re-check.
- Watchman middleware allows exactly:
  - `POST /api/gate/outward-documents`
  - `GET /api/gate/outward-documents`, `/<uuid>` and `/<uuid>/pages/<uuid>`
  - `GET /api/gate/qr/resolve`
  - It denies document-pages, gate-passes and document-reports.

**Notifications (`apps/users/services/bill_notifications.py`)**
- `register_document_event(event_key, permission_code)`
- `publish_document_event(event_key=, plant=, object_id=, object_type=, title=, message=, deep_link=, priority=, dedupe_suffix=)` — persists IN_APP notifications for the accounts that hold the permission. Call it inside your transaction.
- `visible_bill_notifications` hides each registered event from accounts that no longer hold its permission.
- Register your events at module import time from your own module, and make sure that module is imported (e.g. from your views module).

**Frontend**
- Sidebar entries under "Inventory Workspace": Bills & documents (`/inventory/gate-bills`), General receipts, Gate passes, Outward documents. They use the `documentAccess` descriptor (literal grants).
- Page permission map, navigable routes and dynamic patterns are registered for:
  - `/inventory/general-receipts[/new|/<id>]`, `/inventory/gate-passes[/new|/<id>]`, `/inventory/outward-documents[/<id>|/<id>/view]`
  - `/inventory/gate-bills/<id>/view`, `/inventory/job-work/<id>`, `/gate/outward`
- `BillPage` type gained `thumb_url`, `display_rotation`, `page_kind`.
- `src/services/document-pages.ts` provides `documentPagesApi.saveRotation`.
- Help content (`src/help/content/pages/pages.json`, `route-registry.ts`) is shared. Do not edit it; put a short help text for each new page in your final report and the coordinator will add it.

## 2. Workstreams and file ownership

### A — Bill workspace (frontend only)
Owns:
- `frontend_v2/src/components/documents/**` (new)
- `frontend_v2/src/components/inventory/gate-bills/bill-viewer.tsx`
- `frontend_v2/src/app/(dashboard)/inventory/gate-bills/[id]/view/page.tsx` (new)
- the outer layout of `frontend_v2/src/components/inventory/grn-smart.tsx` (and the "Job work return" source chip removal there)
- the bill integration in `frontend_v2/src/components/procurement/grn-wizard.tsx` and its PO receive page

### B — Documents register, office upload, classify/file, General Receipts, reports
Owns:
- `apps/gate/bill_services.py`, `bill_views.py`, `bill_serializers.py`, `document_reminders.py`, `tests_bills.py`, new `apps/gate/tests_documents.py`
- `apps/procurement/general_receipt_*.py` (new), procurement migrations, `apps/procurement/urls.py` additions
- `apps/users/services/bill_notifications.py`
- `frontend_v2/src/components/inventory/gate-bills/{bill-detail,bill-queue,bill-common,bill-grn-context}.tsx` and new files in that folder
- `frontend_v2/src/app/(dashboard)/inventory/gate-bills/page.tsx`, `[id]/page.tsx`
- `frontend_v2/src/app/(dashboard)/inventory/general-receipts/**`, `frontend_v2/src/components/documents-register/**` (new)
- `frontend_v2/src/services/gate-bills.ts`, `src/services/general-receipts.ts` (new)

### C — Job work rebuild
Owns:
- `apps/inventory/services/job_work*.py`, the `JobWorkOrderViewSet` and job-work serializers in `apps/inventory/{views,serializers,urls}.py`
- inventory/production migrations, `apps/inventory/tasks.py` (add `jobwork_overdue_task`)
- `JobService.send_to_jobwork` / `_auto_pause_for_planned_jobwork` in `apps/production/services/job_services.py`
- server-side refusal of GRN `source_type="JOBWORK"` in the inventory GRN create view
- `frontend_v2/src/app/(dashboard)/inventory/job-work/**`, `frontend_v2/src/components/job-work/**` (new), `frontend_v2/src/services/job-work.ts` (new)
- the job-work service functions in `frontend_v2/src/services/inventory.ts`

### D — Outward capture, matching, gate passes, QR on prints
Owns:
- `apps/gate/outward_*.py`, `apps/gate/gate_pass_*.py` (plus `gate_pass_services.py`), `apps/gate/qr_views.py`, `apps/gate/tests_outward.py`, gate migrations 0005+
- `apps/gate/urls.py` additions
- QR additions in `apps/production/services/dispatch_pdf.py` and `apps/inventory/services/challan_pdf.py` (and any frontend print page for sales/inter-plant challans)
- `frontend_v2/src/components/gate/**` (watchman Outward tile/flow; may refactor `bill-capture.tsx` into a shared camera component)
- `frontend_v2/src/app/gate/outward/**`
- `frontend_v2/src/app/(dashboard)/inventory/{outward-documents,gate-passes}/**`, `frontend_v2/src/components/outward/**`, `frontend_v2/src/components/gate-passes/**`
- `frontend_v2/src/services/outward.ts`, `src/services/gate-passes.ts`

## 3. Cross-workstream contracts

### 3.1 `<BillWorkspace>` (A builds; B, C, D consume)
`import { BillWorkspace } from "@/components/documents/bill-workspace"`
```tsx
type WorkspaceDocument = {
  id: string;                 // bill / outward document id (storage key)
  label: string;              // e.g. "Bill 3F2A91C0 · Vee Dee Enterprises"
  statusLabel?: string;       // short chip text
  statusTone?: "neutral" | "info" | "warning" | "success" | "danger";
  meta?: string;              // e.g. "Arrived 8 Oct, 10:42 · Factory A"
  pages: BillPage[];          // from services/gate-bills (thumb_url, display_rotation, page_kind)
  popoutHref?: string;        // e.g. `/inventory/gate-bills/${id}/view`
};
<BillWorkspace document={doc | null} headerActions?={<ReactNode/>} defaultMode?="dock"|"float"|"hidden">
  {/* the form; when document is null children render unchanged, full width */}
</BillWorkspace>
```
- On desktop (≥1024 px), dock mode is a split: children (form) in a left scroll pane, bill in a right pane. Both panes fill `100dvh` minus app chrome and scroll independently, with a draggable keyboard-accessible divider and a remembered ratio.
- Modes: dock / float (draggable, resizable, non-modal PiP) / pop-out (opens `popoutHref`, synced via `BroadcastChannel("bill-view-"+id)`) / hidden (slim rail with "Show bill").
- On phone (<768 px), a bottom sheet with peek/half/full snaps, which drops to peek while the keyboard is open (`visualViewport`).
- The canvas supports:
  - Fit width (default), fit page, zoom 50–400 %, Ctrl/⌘+wheel and pinch zoom
  - drag pan, double-click zoom at the point
  - rotate, and "save rotation for everyone" via `documentPagesApi.saveRotation` when `page_kind` is set
  - page strip with `thumb_url`
  - region pin (Shift-drag a rectangle)
  - shortcuts: Alt+B toggle, Alt+←/→ page, Alt+=/− zoom, Alt+0 fit width, Alt+R rotate
- View state (page, zoom, pan, rotation, mode) persists per document in `sessionStorage` and survives re-renders, dropdowns and refresh. Image bytes are never stored.
- Export also `BillPopoutView({ loadDocument })`, used by the pop-out pages (A builds the inward one; D builds the outward one).

### 3.2 Routes between workstreams
- Classify screen (B) → primary actions:
  - `STOCK` → `/inventory/grn?bill=<id>` (existing)
  - `JOBWORK` → `/inventory/job-work?bill=<id>&vendor=<vendorId>` (C: shows the open orders of that vendor; picking one goes to `/inventory/job-work/<orderId>?bill=<id>` with the receive panel inside `<BillWorkspace>`)
  - `SPARES` / `MACHINERY` / `SERVICE` → `/inventory/general-receipts/new?bill=<id>` (B)
  - record-only → File (B)
- General Receipt form (B) RGP return picker: `GET /api/gate/gate-passes/open-lines/?vendor=<uuid>&party=<text>&plant=<uuid>` (D) → `[{line_id, gate_pass_id, gate_pass_number, line_no, description, uom, outstanding_quantity, machine_name, expected_return_date}]`. On posting, B calls `record_gate_pass_return` inside its transaction.
- Job-work bill link (C): `register_receipt_kind("JOBWORK_RETURN", ...)` and `attach_receipt_to_bill` within the return transaction.
- Outward matching (D) of job-work challans: C registers `register_qr_kind("JOBWORK_CHALLAN", resolve, on_gate_out)`. D registers `GATE_PASS`, `SALES_DC`, `CUSTOMER_DISPATCH`, `TRADE_ORDER` and `INTERPLANT_DC`.
  - The resolve snapshot shape (`OutwardLinkSnapshot`) is `{kind, id, reference, party_name, plant, plant_name, status, document_date, lines:[{description, quantity, uom}], summary}`.
- Notifications: the existing `gate.inward_bill_uploaded` stays (B extends its audience). B registers `documents.due_reminder` and `documents.valid_until_reminder` (documents.manage). D registers `documents.outward_pending` (outward.reconcile) and `documents.gate_pass_overdue` (gatepass.manage). C registers `jobwork.return_overdue` (documents.manage) or uses inventory notifications as it sees fit.

## 4. Done means
A final report with:
- files changed
- endpoints (method, path, permission, request/response)
- UI routes and states covered
- tests added and their exact results (counts, command)
- out-of-ownership edits
- known limitations (should be none)
- help text for each new page
