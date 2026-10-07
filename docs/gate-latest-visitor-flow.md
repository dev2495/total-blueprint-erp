# Latest human requirements (before activation)

The user clarified: visitors scan the QR themselves and submit their details; the watchman only confirms visitor exit. This overrides the earlier pending/admit visitor flow. Goods inward/outward logging is unchanged.

Backend final contract is being updated:
- Public QR registration returns INSIDE immediately; entry_at is the server submission time. Safe receipt still has no private fields.
- Watchman cannot create walk-in visitors, admit or cancel. Only visitor checkout is permitted. Goods operations remain available.
- Legacy PENDING rows are preserved; only owners can recover/admit/cancel those. No production records are rewritten.
- Public registration and its entry audit are idempotent; checkout remains idempotent and scoped to the assigned gate.

Opus 5.5 Medium frontend work:
- Public receipt, form hints, poster and help must say entry recorded, not wait for admission. Last poster step can say exit checked by watchman.
- Watchman visitor screen is an Inside queue with server search and paging, checkout-only confirmation. Remove watchman walk-in/admit/cancel/Waiting controls. Restrict walk-in route to owners or remove it from normal flows.
- Update home visitor counts/actions for the final flow, sidebar links, route/help coverage and provenance. Owner recovery controls may remain owner-only for legacy pending records.
- Correct Gate parent navigation: it currently points to `/gate/history` while a gate.reports delegate can access the parent. Use `/analytics/reports/gate` as the parent destination so both sidebar and command palette have a valid target. Owner History, QR and Terminal remain children.
- Keep invoice/vehicle typed and existing master selectors, owner/report controls, privacy/retry contracts unchanged.
- Test public self-registration -> INSIDE -> watchman exit, no watchman entry controls or APIs; mobile widths, navigation, build/type/lint/help. Update docs/claude-gate-frontend-delivery.md with final behavior superseding previous pending/admit notes.

No candidate has been activated. All frontend edits must still come from Claude Desktop Opus 5.5 Medium.
