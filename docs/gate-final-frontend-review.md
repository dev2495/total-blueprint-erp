# Final integration review from Codex

Please finish these with Opus 5.5 Medium, then run the final frontend checks and write provenance. Codex did not change frontend code.

- Visitor queues and today's register must permit paging and server-side search/filtering beyond the newest 100 rows. The server caps page_size at 100.
- The generic ReportTabPage currently displays only the first 10 configured columns. The Gate report has 14, so reconciliation_status, reference, amount_basis, and plant are silently hidden. Show the gate matching status and source reference in the table and make all other fields accessible through details or all columns. Unknown amounts must remain unknown.
- Report KPI inward/outward counts are register entries, not distinct vehicle counts. Label them entries/movements.
- Backend now supports TRADE source candidates and exposes warnings for DRAFT challans, which save as DISCREPANCY. Display those warnings.
- New plants automatically receive a QR link on creation. Remove instructions telling an owner to run configure_gate_links from the normal QR error page; use retry/contact administrator language. The command remains a backend recovery tool only.
- Backend report agent is adding truthful daily inward/outward series. Read the updated backend contract for the series shape and enable the trend measures.
- Independent macOS Vision scanning passed branded QR screenshots at 390 and 1440px: output/playwright/qr-poster-390.png and qr-poster-1440.png. The decoder is /private/tmp/tpp-gate-qr-scan (needs permission to use native Vision). Exact URL was decoded, including the center mark.
- Codex browser verified public PAN plus selfie submission at 360px to PENDING, no personal response fields or visitor values in browser storage. Matched inward save after a lost response produced one row and one audit event. Visitor admission and checkout completed.

Keep all implementation and final frontend fixes with Opus. Please include actual build, typecheck, lint/nav/help validation results and browser evidence in docs/claude-gate-frontend-delivery.md.
