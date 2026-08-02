# Epson Packing/Dispatch and POD Go-Live Report

Date: 17 July 2026  
Runtime commit: `5310f1c` (`Fix Epson dispatch printing and POD closure`)  
Environment: AWS production, `https://erp.totalpolyprint.com`

## Outcome

The production ERP now has a dedicated fixed-width print path for both packing slips and dispatch slips, designed for the Epson FX-2175II continuous-stationery workflow. Dispatch no longer asks for driver, vehicle, LR, e-way bill, GPS, ETA, or accounting-bill data. The dispatch desk records the material movement, prints the slip, confirms POD, and closes the sales order only when all dispatched quantity is covered.

The graphical PDF and the raw Epson job are generated from the same canonical document model. This prevents the labels, quantities, totals, and order balance from drifting between preview and physical printing.

## Delivered behavior

- Packing slip is available before dispatch for ready packing material.
- Dispatch slip is generated from the frozen dispatch snapshot after challan creation.
- Both formats support:
  - a dark, fixed-width 15 x 5.5 inch continuous-form PDF;
  - a raw Epson ESC/P job for the Windows print helper.
- The fixed columns are `UNIT NO.`, `ITEM DESCRIPTION`, `GRADE`, `SIZE`, `THK MIC`, `GROSS KG`, `PCS`, `TARE KG`, and `NET KG`.
- Roll-based lines show `PCS` as `N/A`; the system does not invent a piece quantity.
- Customer/product overlay labels are preferred where configured.
- Totals and balance-order rows are printed from the same frozen dispatch facts.
- Each raw job validates its maximum character width and form length and ends page boundaries with an actual form-feed byte.
- The Epson endpoint has an explicit binary renderer, eliminating the earlier HTTP 406 content-negotiation failure.

## Dispatch and POD workflow

1. The user selects ready packing material and creates the dispatch challan.
2. The ERP freezes the printable dispatch facts so an old slip cannot silently change when master data is edited later.
3. The user may open the continuous-form PDF or download/send the raw Epson job through the Windows helper.
4. After delivery, the user selects **Confirm POD** and records received-by, POD reference, and optional notes.
5. A partial POD keeps the affected sales line/order open with its remaining balance.
6. Final POD coverage closes the sales-order line and closes the sales order only after every line is fully covered.
7. Repeating the same POD request is idempotent and does not double-close or double-consume anything.

## Removed misleading data

The dispatch workflow no longer collects or displays fake or unnecessary vehicle, driver, LR, e-way, live-GPS, ETA, driver-photo, or signed-LR information. Those details belong to the external accounting/billing system in this operating model. The ERP retains only the optional dispatch note and the real POD fields needed to close material dispatch.

## Verification evidence

- Django schema check: no missing migrations.
- Django system check: passed.
- Focused dispatch regression suite: 31 tests passed.
- Full backend regression suite: 938 tests passed.
- Frontend production build: passed on local and AWS production builders.
- Real challan render: `DC-20260713-0007` rendered as one 15 x 5.5 inch page and was visually checked for darkness, alignment, labels, totals, balance, and absence of transport fields.
- Raw Epson job: generated as 2,302 bytes for the same real challan with `EPSON-FX-2175II`, `15x5.5`, and `ESC/P` job metadata.
- Vendor-specific Epson `Accept` header: now negotiates the Epson renderer and no longer returns 406.
- POD regression coverage: partial remains open, final closes, repeat confirmation remains safe.
- Production database backup: `/opt/tpp-erp/backups/daily/tpp-erp-db-20260717-133628+0530.sql.gz`.
- Migration `0069_delivery_challan_print_snapshot_pod` applied on production.
- Production services: backend and frontend healthy; PostgreSQL and Redis healthy; worker and scheduler running.
- Live probes: readiness, application root, and dispatch UI returned successfully; protected dispatch route redirected an anonymous browser to login.
- Source parity: SHA-256 hashes matched between the committed worktree and AWS for the renderer, dispatch service, API view, dispatch page, and frontend logistics client.
- Post-deploy logs: no application traceback, task failure, or frontend startup error. The only 401 was the intentional anonymous API negotiation probe.

## Client workstation requirement

AWS cannot directly operate the client's USB/tractor-feed printer. The client Windows workstation must retain the Epson driver, the 15 x 5.5 inch continuous form, and the Total Poly Print Windows print helper described in [windows-epson-fx2175ii-client-setup.md](./windows-epson-fx2175ii-client-setup.md). The helper validates the signed job, preserves the raw ESC/P bytes, and sends them to the selected Windows RAW spooler queue; it does not recalculate or redesign the slip.

One physical sign-off print is still required at the workstation: align the first perforation, print one packing slip and one dispatch slip, then confirm that the next form starts on the following perforation. Any small mechanical top-of-form correction belongs in the printer/helper calibration, not in the ERP's business data or formulas.

## Rollback

If a production-only issue appears, preserve the database backup above and redeploy the prior runtime commit `cde0932`. Do not roll back the database by deleting dispatch or POD records manually.

## Physical-print correction - 27 July 2026

The first client print proved that RAW delivery and 5.5-inch form feeding worked, but the text was faint and horizontally ghosted. The cause was inside the printer-ready job: `ESC @` resets the FX-2175II, after which the job selected pitch, line spacing, emphasis, and form length but did not explicitly override the printer's Draft/Bi-D quality defaults. Windows preferences cannot safely fill that gap for a RAW job.

The corrected contract now explicitly sends:

- 10 CPI pitch;
- Roman NLQ print quality;
- unidirectional head motion;
- 6 lines per inch and 33-line form length;
- form feed at the slip boundary.

The existing installed helper remains compatible because the approved legacy prefix is unchanged and the quality controls are appended to it. The downloadable helper was also updated so new installations validate the complete quality profile and write it into the success log. The PDF fallback now uses true 12 pt Courier Bold, equivalent to 10 CPI, on the exact 15 x 5.5 inch page.
