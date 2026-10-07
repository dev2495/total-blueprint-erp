# Independent browser acceptance

All data and accounts below are synthetic in isolated local PostgreSQL `tpp_gate_dev_20261007`. No persistent live business or visitor records were created by these checks. Frontend implementation/fixes came from Claude Desktop Opus 5.5 Medium; Codex independently exercised the browser and backend.

- WATCHMAN login lands at `/gate`, with gate-only navigation. At 390px the inward form matched `GATE-QA-1001`: master party, add-on Loop Handles, 1000 PCS, invoice date and INR 2360 derived from ERP; vehicle remained typed.
- Lost-response acceptance intercepted a committed goods response and delivered a 503. UI displayed unconfirmed/locked state. Retry used the same serialized payload and client UUID. Observed final UI was Saved; SQL found one GoodsMovement and one GOODS_LOGGED audit event. One harness initially waited for the wrong success label (`Entry saved`); the actual UI says `Saved to gate register`. The timeout was a harness label mismatch, not a failed save. Claude independently repeated the complete dropped-response test with identical payload, one row and one audit event.
- Watchman admitted a pending visitor, then confirmed checkout. Active queue changed from waiting to inside to closed. Owner history is blocked to watchman; an unassigned watchman is blocked from gate operations.
- Public visitor at 360px submitted name, mobile, company, purpose, synthetic optional PAN and a synthetic JPEG. HTTP 201 returned PENDING receipt without visitor personal fields. Visitor values were absent from localStorage/sessionStorage; document width matched the 360px viewport. The public route never lists visits.
- Actual branded QR poster screenshots at 390px and 1440px, including the centre TPP mark, both decoded via macOS Vision to the exact public URL. Browser BarcodeDetector also decoded the plain and branded QR (Claude evidence). Physical print and camera quality on an actual gate handset remain an on-device check.
- Explicit gate.reports delegate loaded the actual gate report at 360px. All 14 columns were present: logged time, direction, invoice number, party, vehicle, product, quantity, UOM, amount, reconciliation status, reference, invoice date, amount basis and plant. Unknown amounts were shown as an em dash; private visitor name was absent; viewport/document width both 360px.
- Claude independently checked owner history filters, reasoned correction with before/after audit, ERP comparison, owner intelligence card, Audit Center stream, gate daily report pack, and gate plant assignment in user editor. See `docs/claude-gate-frontend-delivery.md` for source provenance and checks.

The development server exposes the repository's existing CSP nonce hydration warning. Final production-build browser checks are recorded separately before release.

## Production UI build validation

A separate copy of the Claude-authored frontend was built with supported Node 24 and started in production mode on 3018. The actual delegated gate report loaded 14 columns and a populated daily trend at 360px with document width 360px, zero page errors and zero console errors. The development-only nonce hydration message did not appear. The initial harness looked for an `Inward` button; the report uses a different accessible element for its measure toggle. The corrected harness waited for the populated trend insight and passed. Final delegated archive/queue follow-ups are additionally checked by Opus and the deployment's final production build.

## Latest visitor requirement supersedes admission checks

Before any production activation, the human clarified that visitors must register themselves through QR and the watchman only confirms visitor exit. The earlier PENDING/admit browser checks above describe the previous local candidate only. The shipping flow is public self-registration -> INSIDE with a server entry time -> watchman-confirmed EXITED. Watchman creation/admission/cancellation is denied; owner-only legacy recovery remains. Final revised-flow checks are appended below and in the updated Opus provenance and backend reports.

## Independent revised flow acceptance

- At 360px a synthetic visitor self-submitted name/mobile/company/purpose, optional PAN and JPEG selfie. HTTP 201 returned INSIDE with no name/mobile fields; the public receipt showed Entry recorded. Neither browser storage held the private visitor values, and document/viewport widths were both 360px.
- At 390px the watchman saw the visitor inside with its private selfie and masked ID, with Check out as its only action. Confirm check out recorded EXITED and removed the visitor from the active search. Document/viewport widths were both 390px.
- Direct local database assertions found exactly REGISTERED, ENTERED and EXITED audit events; registration/entry actors were null and exit actor was the watchman. Submission, consent and entry used one identical server timestamp; the selfie remained private and the government ID encrypted.
- The independent check found that the public POST initially omitted entry_at while the receipt UI substituted device time. The shipping backend now includes the exact saved server timestamp and preserves it on replay; Opus removed the device-clock fallback. Both independent API helpers and all 1,121 backend tests pass with the final timestamp contract.
- Final 360px browser submission on the reloaded backend returned INSIDE and `entry_at=2026-10-07T11:51:32.842986+00:00`; the receipt displayed the corresponding 05:21 PM. Its private response and browser-storage checks passed with document width 360px.
- Two browser harness assumptions were corrected: POST receipt originally lacked entry_at (the contract issue above), and waiting for the success sheet's Done button raced the queue refresh that unmounted the visitor card. The actual EXITED response, refreshed empty search and database assertions establish the completed exit.

Final frontend implementation and checks, including owner-only cached PENDING controls and QR help wording, are recorded by Opus in the provenance file. Actual handset camera and printed-poster scans remain physical-device acceptance checks.
