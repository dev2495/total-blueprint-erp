# Gate bill frontend validation

The user authorized Codex takeover after the single Claude Desktop Opus 5.5 Medium assignment reached its limit. Claude authored the initial capture/inventory interface; Codex completed integration, receiving retry integrity, notification and navigation behavior, audit links and verification.

## User flow

- Watchman signs in to the phone gate terminal, selects the assigned factory if necessary, taps Record inward, takes or chooses 1–6 bill photos and records arrival. No inward invoice, vehicle, vendor, product or quantity typing. Today's own arrival references show inventory status. Visitor self-entry and watchman exit remain separate from outward goods.
- Inventory Workspace → Gate bills opens the oldest pending/partly received arrivals. The inventory dashboard, command search and notification bell also link to this queue. A five-second poll delivers fresh pending/unread state without confusing read notifications with completed GRNs.
- Open a bill to inspect its private images (pages, zoom, rotate, fullscreen, download), pick existing vendor/PO masters and save human-reviewed invoice details. Create a GRN through the existing ERP receiving process or match a posted same-factory receipt. Partial receipt remains in the queue until inventory explicitly confirms every line received. Explained non-stock/duplicate resolutions retain images and history.
- Owner/Admin → Gate setup provides the factory QR and gate assignments; Gate intelligence, Analytics → Reports → Gate and System → Audit expose the approved oversight flows. Report-only delegates see aggregates, without private image or receiving access. Actual/effective Watchman preview retains the restricted terminal.

## Browser acceptance (isolated synthetic data)

Chrome tested the real frontend/API under strict RBAC with fixture credentials restricted to loopback. No real factory transactions, actual visitor details or live credentials were used.

- Phone widths 360/390: rear-camera/gallery controls, cancelled Retake then Add page preserve two pages; no manual inward fields or document overflow. An upload connection failure before saving reuses the exact token on retry and saves one arrival. Separate backend tests cover committed-upload replay and concurrency.
- Production Next build: capture, private bill image, full-screen viewer and Escape close pass with zero unexpected console/page errors. Viewport screenshots confirm one page heading and correct fixed-header placement; full-page Chrome screenshots of fixed layers are not treated as reliable geometry evidence.
- Public visitor phone page: no-login self-registration with an uploaded synthetic photo and no government ID returns INSIDE immediately; watchman search/confirm exit returns EXITED and removes the visitor from the inside queue. The final production-build run reports zero console/page errors.
- Two independent sessions: inventory queue and durable bell notification appeared within 4.8 seconds of the gate save. Marking the alert read kept the pending bill count. Explained NON_STOCK resolution removed it from pending while preserving its record.
- Existing posted GRN: human review → match → PARTIAL_GRN → explicit all-lines confirmation → RECEIPTED. No stock is created by matching or completion.
- New PO GRN: selected master PO/vendor/warehouse and received 100 kg. A real committed server response was deliberately hidden with a 503; retry used an identical body/token and returned one receipt reference. The bill stayed PARTIAL_GRN. Stock-class/source controls stayed locked until the uncertain request was resolved.
- Admin/Owner setup, report/intelligence links, Store queue/dashboard/sidebar/search links and delegated report privacy were exercised. Audit Open bill opens the private workspace without requesting unsupported trace data. Mobile report measures wrap at 360/390 widths.

The executable real-hook retry regression, strict TypeScript, targeted ESLint, theme-token checks, help coverage and navigation validators pass. The frozen production build is compiled from a separate source copy compared byte-for-byte to the release source; its exact build/source receipt is retained in the delivery evidence.

The final local production build ID is `F1CpEXwoMNio1IcPbjkGL`. All 922 regular frontend source files compared identically (generated Next types and private build/runtime/output files excluded). Targeted ESLint passed across all 39 changed frontend source files. After closing obsolete QA browser sessions and restarting the threaded local API with frozen source, production-mode capture/viewer and visitor-entry/exit acceptance both passed without errors. The earlier local database connection exhaustion came from accumulated polling QA sessions and is not production-load evidence.

## Practical limits

Browser tests use file uploads to simulate camera images. They do not establish physical handset permissions, low-bandwidth performance, printed QR readability, physical printer output or sustained peak traffic. AWS exact-image suites, fresh managed backup/restore and signed rollback-only production acceptance are recorded separately by the release coordinator. No OCR/Jev extraction is implemented.
