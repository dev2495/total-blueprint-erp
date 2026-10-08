# Inward bill review permissions and notifications

Watchman captures bill pages for an inward arrival. Inventory records or matches the receipt; uploading never posts stock. The public visitor QR and watchman exit-only visitor flow are unchanged. No AI extraction is implemented or promised.

## Account and plant authority

`gate.bill.submit` is part of the closed WATCHMAN terminal permissions and default full master rights. `gate.bill.review` and `page.inventory.gate_bills.view` cover the inventory queue. Every queue, private page, receipt transition, count and notification checks actual account authority on the backend.

Actual ADMIN/SUPER_ADMIN/OWNER or owner/superuser flag gets full master access. Actual **or effective** WATCHMAN takes precedence over every flag, wildcard or stale extra permission and cannot review inventory. STORE gets review by default because its actual canonical account permissions include inventory/procurement receipt authority. Other accounts must have literal `gate.bill.review` **and** literal actual `inventory.manage` or `procurement.manage`. DISPATCH with only `inventory.manage`, SALES with a wildcard, and a role preview that changes SALES to STORE do not qualify.

Existing inventory receipt APIs have global plant scope and no canonical inventory plant-assignment model. Review preserves that global scope for current STORE users and eligible custom accounts; no new setup is required. GateAssignment continues to restrict the watchman's capture plants only. Do not describe STORE notifications as restricted to one assigned plant. Plant filters on queue/count views select among the user's authorized receipt plants.

User `entitlements` includes `inventory_bill_review: boolean` and `inventory_bill_scope: "ALL_PLANTS" | "NONE"`, in addition to existing `gate_master` and permission codes. Use this explicit boolean to display inventory queue navigation, even when a wildcard appears in permissions.

## Durable in-app notification

Bill upload persists user-targeted `Notification` rows inside the same database transaction as the intake and audit. A unique database constraint prevents duplicate `gate.inward_bill_uploaded` alerts for the same bill/account on retries or concurrent publication. No role broadcast, email, SMS, web push, AI callback or external action occurs. A rolled-back upload leaves no notification. Permission revocation or WATCHMAN preview hides an existing bill alert on every read/count/mark-read.

Poll while the inventory UI is visible at **5 seconds**, refresh on window focus, and refresh queue + summary after successful receipt/void. This is persisted in-app delivery; the response does not promise browser push. Queue pending counts represent unresolved bills independently of notification read state.

`GET /api/users/notifications/list/?limit=50` (existing alias `/api/auth/notifications/list/`) remains an array. New fields are `plant` (UUID/null) and `deep_link`; bill alerts have `event_key: "gate.inward_bill_uploaded"`, `related_object_type: "GateInwardBill"`, `related_object_id: <intake UUID>`, `deep_link: "/inventory/gate-bills/<UUID>"`, channels `["IN_APP"]` and in-app `DELIVERED` state. Notification message has only plant label and review instruction; no photo content, invoice, filename, visitor, government ID or vendor data.

`GET /api/users/notifications/inward-bill-summary/?plant=<optional UUID>` returns:

```json
{
  "pending_count": 3,
  "unread_count": 2,
  "plant_counts": [{"plant": "UUID", "plant_name": "Plant name", "pending_count": 3}],
  "deep_link": "/inventory/gate-bills",
  "poll_interval_seconds": 5,
  "scope": "ALL_PLANTS"
}
```

Unauthorized returns 403; malformed plant 400; unknown/out-of-scope plant 404. `pending_count` counts PENDING_GRN and PARTIAL_GRN bills, `unread_count` counts the viewer's unread saved bill alerts. RECEIPTED/VOID removes a bill from pending immediately without marking the arrival alert read. Existing mark-read and mark-all-read affect only notifications still visible to the real account. All notification responses are `private, no-store`.

Queue statuses are `PENDING_GRN`, `PARTIAL_GRN`, `RECEIPTED`, `VOID`. Both PENDING_GRN and PARTIAL_GRN count as pending until inventory explicitly confirms all bill lines are received. An explained VOID resolves service/non-stock bills without inventing a goods receipt. Use the companion core API contract for upload, private pages, receipt linkage and queue fields.

## Existing gate reports and intelligence

Gate summary/report/daily-pack aggregates add `bill_arrivals`, `bill_received`, `bill_voided` for the selected business-date period; `bill_pending_grn` and `bill_partial_grn` are current unresolved counts across all arrival dates in the selected plant scope. `bill_pending_oldest_arrival_at` is an aggregate timestamp or null. `bill_pending_scope` explains the current backlog basis. These counts flow into existing master intelligence and sanitized report delegates without image URLs, bill UUIDs, invoice/vendor details or review notes.

`GET /api/analytics/reports/gate/` additionally returns `bill_series: [{date, bill_arrivals, bill_received, bill_voided}]`, zero-filled by factory business day. Existing goods `series`/`inward`/`outward`/quantities retain their meaning; captured bill arrivals are a separate series and do not invent goods quantities or accounting amounts. The gate PDF/daily pack includes aggregate bill lifecycle counts. Bill immutable events automatically appear in the existing master audit stream as `object_type: "BILL"`, actions BILL_ARRIVED/BILL_REVIEWED/BILL_LINKED/BILL_RECEIPTED/BILL_VOIDED; delegates and watchmen have no master audit access.
