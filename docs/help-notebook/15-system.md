# System administration

## Overview (English)
# System administration

The System module is where Owners and Admins run the ERP itself: who can sign in, what each role may open, how changes are audited, what the company letterhead says, which daily report packs are archived, which shifts the plant runs, which scrap and downtime reasons operators can choose, and when a material counts as low on stock. All of these screens are tabs of the **Reports & admin** workspace (Admin group: Report center, Audit, System health, Users, Role matrix, Governance, Company profile, Reorder policy, Reason codes, Settings; Factory group: Plants, Locations, Work centres, Machines, Shift timing). The old address /system simply forwards to /system/users.

## Who uses it
- **OWNER / ADMIN / SUPER_ADMIN** see every System screen. Owner and Super Admin land on the Owner dashboard; Admin lands on System health (/dashboard/admin).
- Other roles do not see System screens. A person can be given a single screen through a personal override (for example production.manage opens Reason codes, materials.manage opens Reorder policy, system.view opens Company profile).
- Pages under /system open only for the roles (or personal grants) their sidebar entry lists, even if someone types the address.

## The screens and how they connect
1. **User Management (/system/users)** – the list of accounts with tiles Total users, Active, Owners, With overrides. "Add user" opens /system/users/new; a row opens /system/users/<id>.
2. **Add / Edit user** – identity, initial password (at least 8 characters, not only numbers), Active switch, Owner flag (only an Owner may change it), one Base role card, Extra access overrides, and the scope that the role needs: work centres for a Work Center Manager, machines for a Machine Operator, gate plants for a Watchman. "Reset password" forces a new sign-in.
3. **Role Matrix (/system/role-matrix)** – default permissions of each role. OWNER/ADMIN/SUPER_ADMIN must be unlocked before editing. Quick presets only add. Unticking and pressing "Save Matrix" really removes a permission, even a built-in default; a personal override still applies. "Bills & documents" rights belong to Store by default, Owner/Admin always, Watchman never.
4. **Governance (/system/governance)** – four tabs: Notification Rules (event key, target roles, IN_APP/EMAIL, priority, escalation, templates), Role Signoffs (bootstrap rows, approve or revoke module.action per role), Profile Approvals (approve or reject staff profile change requests) and Visibility + Audit (revalidate role visibility, recent permission audit).
5. **Audit Center (/system/audit)** – one ledger for operational flow, production runs, inventory movement, master data, session & login, permissions, report archives, gate register (masters only) and system config. Search a reference such as SO-2026-0123, filter by range, actor and severity, open a row for before/after data, export CSV.
6. **Company Profile (/system/company-profile)** – letterhead, tax numbers, bank, terms, signatory and the production rule "Wastage reason limit (%)" (default 5): when trim plus scrap on a machine log reaches this share, the operator must give a scrap reason.
7. **Report Center (/system/report-center)** – switch daily packs Active/Paused, "Generate now", and download archived packs (PDF and detail workbook, last 45 days). Packs notify Owner/Admin in the bell; email delivery and per-pack schedules were removed. **Settings (/system/settings)** only explains this and links to the Report Center.
8. **Reason Codes (/system/reason-codes)** – scrap and downtime reasons with parent/sub-codes, sort order and Active flag.
9. **Reorder Policy (/system/reorder-policy)** – reorder quantity, safety stock and lead days per material; "Run reorder scan" (the automatic scan runs daily at 06:00). Below reorder raises an alert; below safety is HIGH.
10. **Shift Timing (/system/shift-timing)** – fixed shift windows per plant. Issues, returns, counts, WCM and machine logs take their shift from the event time; operators never pick a shift.

## Main flows
**New staff member**: Users → Add user → fill identity and initial password → choose base role → add scope (work centres / machines / gate plants) → Create user → hand over username and password → the person changes it in My Profile → Security.

**Person changes job or leaves**: open the user → change Base role and scope, or switch Active off. Nothing is deleted; history in the audit stays.

**Whole role needs a page**: Role Matrix → select role → tick → Save Matrix → users sign in again.

**Staff profile change**: the user submits on My Profile → Governance → Profile Approvals → Approve or Reject.

**Investigation**: Audit Center → search the reference → open the row → read Before/After → Copy reference or Export CSV.

## Financial year and archive
The header has a financial-year picker ("Financial year shown in lists"). Empty = the working set (this year plus anything still open from earlier years); a year such as 2025-2026 = that year, archived or not; "All years" = everything. Closed years are the archive. Only long lists are scoped; detail pages always open. If an old record seems missing, choose "All years".

## Backups
Database backups and the weekly restore drill run on the server on a schedule; they are not started from these screens. System health (/dashboard/admin) warns when the disk is filling ("Prune old backups and Docker images before it reaches capacity").

## Rules and limits
- The last active owner cannot be disabled or demoted; add another owner first.
- A Watchman can never be an owner and gets only the gate terminal.
- A Machine Operator gets machines, never work centres; a Work Center Manager gets work centres, never machines directly.
- Too many failed sign-ins lock an account for 15 minutes ("Too many failed sign-in attempts for this account. Wait 15 minutes or ask an administrator to reset the password.").
- Shift and reason changes affect new logs only.

## Problems and fixes
- *User cannot open a page*: check the role in Role Matrix, then the user's overrides; ask the user to sign in again.
- *Operator sees no jobs*: no machine is ticked in "Machines this operator runs".
- *WCM cannot be saved*: tick at least one work centre.
- *Audit shows nothing*: widen Range to Last 7d or All audit, press Reset.
- *Quotation PDF shows the old address*: save Company Profile, then generate the PDF again.
- *Daily pack missing*: check it is Active in Report Center and look at Latest status; press Generate now.
- *Logs fall in the wrong shift*: fix the shift windows and the Crosses midnight tick for that plant.

## सारांश (हिंदी)
# सिस्टम एडमिनिस्ट्रेशन (System)

System मॉड्यूल में Owner और Admin खुद ERP को चलाते हैं: कौन login कर सकता है, कौन-सा रोल क्या खोल सकता है, बदलावों का audit, कंपनी का letterhead, कौन-से daily report pack archive होते हैं, प्लांट की shift, operator कौन-से scrap और downtime कारण चुन सकते हैं, और कब कोई material कम stock में गिना जाए। ये सारी स्क्रीन **Reports & admin** workspace के टैब हैं (Admin समूह: Report center, Audit, System health, Users, Role matrix, Governance, Company profile, Reorder policy, Reason codes, Settings; Factory समूह: Plants, Locations, Work centres, Machines, Shift timing)। पुराना पता /system सीधे /system/users पर भेज देता है।

## कौन इस्तेमाल करता है
- **OWNER / ADMIN / SUPER_ADMIN** को हर System स्क्रीन दिखती है। Owner और Super Admin, Owner dashboard पर पहुँचते हैं; Admin, System health (/dashboard/admin) पर।
- बाकी रोल को System स्क्रीन नहीं दिखती। किसी व्यक्ति को personal override से एक स्क्रीन दी जा सकती है (जैसे production.manage से Reason codes, materials.manage से Reorder policy, system.view से Company profile)।
- /system के पेज सिर्फ़ उन्हीं रोल (या personal अनुमति) के लिए खुलते हैं जो sidebar में लिखे हैं, चाहे कोई पता टाइप करे।

## स्क्रीन और उनका जुड़ाव
1. **User Management (/system/users)** – सभी खातों की लिस्ट; tile: Total users, Active, Owners, With overrides। "Add user" से /system/users/new; row पर क्लिक से /system/users/<id>।
2. **Add / Edit user** – पहचान, शुरुआती password (कम से कम 8 अक्षर, सिर्फ़ अंक नहीं), Active switch, Owner flag (सिर्फ़ Owner बदल सकता है), एक Base role card, Extra access overrides, और रोल के हिसाब से scope: Work Center Manager के लिए work centre, Machine Operator के लिए machine, Watchman के लिए gate प्लांट। "Reset password" के बाद फिर login करना पड़ता है।
3. **Role Matrix (/system/role-matrix)** – हर रोल की default permission। OWNER/ADMIN/SUPER_ADMIN को बदलने से पहले unlock करना होता है। Quick preset सिर्फ़ जोड़ते हैं। अनटिक करके "Save Matrix" दबाने से permission सच में हटती है, built-in default भी; personal override फिर भी लागू रहता है। "Bills & documents" अधिकार default में Store के पास, Owner/Admin के पास हमेशा, Watchman के पास कभी नहीं।
4. **Governance (/system/governance)** – चार टैब: Notification Rules (event key, target roles, IN_APP/EMAIL, priority, escalation, template), Role Signoffs (rows bootstrap करें, हर रोल के module.action को approve या revoke करें), Profile Approvals (कर्मचारियों की profile बदलाव request मंज़ूर/अस्वीकार), और Visibility + Audit (role visibility revalidate, हाल का permission audit)।
5. **Audit Center (/system/audit)** – एक रजिस्टर: operational flow, production run, inventory movement, master data, session & login, permissions, report archive, gate register (सिर्फ़ master) और system config। SO-2026-0123 जैसा reference खोजें, range, actor और severity से छाँटें, row खोलकर पहले/बाद का डेटा देखें, CSV export करें।
6. **Company Profile (/system/company-profile)** – letterhead, टैक्स नंबर, बैंक, terms, signatory और production नियम "Wastage reason limit (%)" (default 5): machine log पर trim + scrap इस हिस्से तक पहुँचे तो operator को scrap का कारण देना पड़ता है।
7. **Report Center (/system/report-center)** – daily pack को Active/Paused करें, "Generate now" दबाएँ, archive से pack (PDF और detail workbook, पिछले 45 दिन) डाउनलोड करें। Pack की सूचना Owner/Admin को bell में जाती है; email और हर pack का schedule हटा दिया गया है। **Settings (/system/settings)** सिर्फ़ यही बताता है और Report Center का लिंक देता है।
8. **Reason Codes (/system/reason-codes)** – scrap और downtime कारण, parent/sub-code, क्रम और Active।
9. **Reorder Policy (/system/reorder-policy)** – हर material की reorder मात्रा, safety stock और lead days; "Run reorder scan" (अपने-आप scan रोज़ 06:00 बजे)। Reorder से नीचे alert; safety से नीचे HIGH।
10. **Shift Timing (/system/shift-timing)** – हर प्लांट की तय shift। Issue, return, count, WCM और machine log की shift घटना के समय से तय होती है; operator कभी shift नहीं चुनते।

## मुख्य काम (flow)
**नया कर्मचारी**: Users → Add user → पहचान और शुरुआती password → base role → scope (work centre / machine / gate प्लांट) → Create user → username और password व्यक्ति को दें → वह My Profile → Security में बदल ले।

**काम बदला या नौकरी छोड़ी**: यूज़र खोलें → Base role और scope बदलें, या Active बंद करें। कुछ delete नहीं होता; audit में इतिहास रहता है।

**पूरे रोल को कोई पेज चाहिए**: Role Matrix → रोल चुनें → टिक करें → Save Matrix → यूज़र फिर login करें।

**कर्मचारी की profile का बदलाव**: यूज़र My Profile पर भेजता है → Governance → Profile Approvals → Approve या Reject।

**जाँच-पड़ताल**: Audit Center → reference खोजें → row खोलें → Before/After पढ़ें → reference Copy करें या CSV Export करें।

## Financial year और archive
Header में financial-year picker है ("Financial year shown in lists")। खाली = चालू सेट (इस साल का और पिछले सालों का जो अभी खुला है); 2025-2026 जैसा साल = वही साल, archive हो या नहीं; "All years" = सब कुछ। बंद साल ही archive हैं। सिर्फ़ लंबी लिस्ट पर असर होता है; detail पेज हमेशा खुलते हैं। पुराना रिकॉर्ड न दिखे तो "All years" चुनें।

## Backup
Database backup और हफ़्ते का restore drill सर्वर पर तय समय से अपने-आप चलते हैं; इन स्क्रीन से शुरू नहीं होते। Disk भरने लगे तो System health (/dashboard/admin) चेतावनी देता है ("Prune old backups and Docker images before it reaches capacity")।

## नियम और सीमाएँ
- आख़िरी active owner को बंद या नीचे नहीं किया जा सकता; पहले दूसरा owner बनाएँ।
- Watchman कभी owner नहीं बन सकता और उसे सिर्फ़ gate terminal मिलता है।
- Machine Operator को machine मिलती है, work centre नहीं; Work Center Manager को work centre मिलते हैं, सीधे machine नहीं।
- बहुत बार गलत login से खाता 15 मिनट के लिए बंद होता है।
- Shift और कारण के बदलाव सिर्फ़ नए log पर लागू होते हैं।

## दिक्कतें और हल
- *यूज़र पेज नहीं खोल पा रहा*: Role Matrix में रोल देखें, फिर यूज़र के override; यूज़र को फिर login करवाएँ।
- *Operator को कोई job नहीं दिखता*: "Machines this operator runs" में कोई machine टिक नहीं है।
- *WCM सेव नहीं होता*: कम से कम एक work centre टिक करें।
- *Audit में कुछ नहीं दिखता*: Range को Last 7d या All audit करें, Reset दबाएँ।
- *Quotation PDF पर पुराना पता*: Company Profile सेव करें, फिर PDF दोबारा बनाएँ।
- *Daily pack नहीं आया*: Report Center में देखें वह Active है और Latest status क्या है; Generate now दबाएँ।
- *Log गलत shift में जा रहे हैं*: उस प्लांट की shift का समय और Crosses midnight ठीक करें।

## Every screen (English)

### System Admin Console (/dashboard/admin)
Screen address: /dashboard/admin · Roles: ADMIN, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=dashboard-admin

Server vitals, database health, access sign-off and safe maintenance for the whole ERP, in one place.

Admin's landing page. Open it at the start of the day or when users say the ERP is slow: check CPU, memory, disk, database latency and the error rate, see which department sign-offs are pending, and run housekeeping. Links lead to Users, Role matrix, Audit centre, Company profile, Shift timing and Report centre.

**Before you start**
- ADMIN or SUPER_ADMIN role.

**Step by step**
1. Read the top tiles: "Active users" (signed in, last 24 h), "Error rate" (failed requests), "Database latency" and "Database size".
2. Check "Server resources" for CPU, Memory and Disk. If it shows "Telemetry stale", press "Refresh vitals".
3. In "Department sign-off" see Approved and Pending counts. Press "Open Governance Console" to approve pending role or module visibility.
4. Under "Maintenance", press "Clear application cache" if reports or dashboards show old numbers. Cached reports rebuild on the next view.
5. To reclaim database space, press "Vacuum…", then "Run vacuum now" to confirm (or "Cancel"). Run it off-shift.
6. Read "System event stream" for the latest platform activity.
7. Use "Administration" links to jump to Users, Role matrix, Audit centre, Company profile, Shift timing or Report centre.

**What is on the screen**
- **Active users**: People signed in during the last 24 hours.
- **Error rate**: Share of failed requests. A rise means something is breaking; check the event stream and Audit centre.
- **Database latency / Database size**: How fast the database answers, its size and open connections.
- **CPU / Memory / Disk**: Live use of the server. Disk near full needs action before backups fail.
- **Department sign-off**: Approved vs pending role and module visibility approvals. "Every role is signed off." means nothing is pending.
- **Clear application cache**: Drops cached reports and dashboards. Safe at any time.
- **Vacuum database**: Reclaims space and refreshes planner statistics. Asks for a second click to confirm.

**Common problems and fixes**
- "System health did not respond. The rest of the ERP is unaffected." — The health endpoint timed out. Press "Retry". Other screens keep working.
- "Telemetry stale" — Vitals are old. Press "Refresh vitals".
- "Could not clear cache / Vacuum failed" — The maintenance call failed; the toast shows the server reason. Try again off-shift or check server logs.

**If stuck**
1. If tiles show "—", press "Retry"; the server may be busy.
2. If users report wrong report numbers, use "Clear application cache" first.

Related pages: /system/users, /system/role-matrix, /system/audit, /system/company-profile, /system/shift-timing, /system/report-center, /system/governance

### System (opens User Management) (/system)
Screen address: /system · Roles: ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=system

This address has no screen of its own. It sends you straight to User Management (/system/users).

Old links and the "System" section of All screens point here. The redirect keeps them working: the first admin job is people and access, so you land on the user list. Every other admin screen is a tab of the "Reports & admin" workspace.

**Before you start**
- You are signed in as Owner, Admin or Super Admin, or you have a users.view / rbac grant.

**Step by step**
1. Open /system or click "System" under "All screens" in the sidebar.
2. The page moves you to "User Management" at once.
3. Use the workspace bar tabs (Users, Role matrix, Governance, Company profile, Settings…) to reach other admin screens.
4. If you see "Access denied" on the user list, ask an Owner for the rbac.view permission.

**What is on the screen**
- **Redirect target**: Always /system/users. Nothing is saved or changed by this address.

**Common problems and fixes**
- "Access denied (on the user list)" — Your role is not Owner/Admin and you have no rbac.view grant. Ask an Owner to add it in Role matrix or as a user override.

**If stuck**
1. If the page stays blank, open /system/users directly.
2. Use the "Reports & admin" workspace in the sidebar to pick the admin screen you need.

Related pages: /system/users, /system/role-matrix, /system/governance, /system/settings

**Not done yet / watch out**
- /system has no overview page of its own; it always jumps to User Management.

### Audit Center (/system/audit)
Screen address: /system/audit · Roles: ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=system-audit

One searchable ledger of who did what and when: production runs, stock moves, master edits, logins, permission changes, report archives, gate register and system config.

Open it when you must prove or investigate a change: a roll that went missing, a permission someone got, a sales order that changed, a failed login. Search a reference (SO, ROLL, JOB, user, route), narrow by stream, range, actor or severity, then open a row to see the captured before/after data. Export CSV for an outside review.

**Before you start**
- Role Owner, Admin or Super Admin. Any other role sees "Audit Center is limited to owner and admin roles".
- The "Gate Register" stream shows only for a gate master (Owner/Admin/Super Admin).

**Step by step**
1. Type a reference in the search box, e.g. SO-2026-0123, ROLL-…, JOB-…, a user name, a route or a permission code.
2. Pick "Stream", "Range" (default "Last 24h"), "Actor" and "Severity" to narrow the list. Clicking a stream card also filters to it.
3. Read the list in "Timeline" (grouped by Today / Yesterday / date) or "Table" view; newest first, 100 rows per page with "Prev"/"Next".
4. Click a row: it opens "Diff / Raw" with "Before" and "After" (or "Captured details" and "Raw audit payload").
5. Check the "Investigation" panel on the right: trace summary, timeline and related entities of a supported reference. "Copy" copies the reference; "Open bill" opens a gate bill event.
6. Press "15s tail" to pause or resume the live refresh (every 15 seconds). "Reset" clears all filters.
7. Press "Export CSV" to download the rows shown on this page as audit-events-<date>.csv.

**What is on the screen**
- **Events Found**: Total events that match the filters (all pages), with how many are shown on this page.
- **Actors In Scope**: Users, services and system jobs that appear in the result (top 7 are listed in the actor board).
- **High Signals**: HIGH + CRITICAL events. CRITICAL = denied, failed, critical or mismatch; HIGH = role, override, void or scrap.
- **Freshness**: "Syncing" while loading, otherwise "Green" with the time of the last response.
- **Stream cards**: Operational Flow, Production Runs, Inventory Movement, Master Data, Session & Login, Permissions, Report Archives, Gate Register, System Config. Each shows its count and a small trend line.
- **Range**: Last hour, Today, Last 24h, Last 7d, This month, All audit.
- **Severity**: LOW, MEDIUM (warnings, pending, adjustments, all master-data edits), HIGH, CRITICAL.
- **Heatmap, actor board, action mix, signal panel**: Charts of the events on this page. Clicking an actor, an action or a severity applies it as a filter.
- **Trace badge**: Shows "Trace ready" when the search text is a reference the system can trace (sales order, roll, job…).

**Common problems and fixes**
- "Audit Center is limited to owner and admin roles." — Your active role is not Owner/Admin/Super Admin. Use "Open Roll Genealogy" for roll history, or ask an Owner.
- "No audit events match the current filters." — The range is too short or a stream/actor/severity filter hides the rows. Set Range to "Last 7d" or "All audit", or press "Reset".
- "Trace shows a warning icon" — The text is not a traceable reference. Type the full code exactly (e.g. SO-2026-0123) or open the row and use its reference.

**If stuck**
1. Press "Reset" to return to the default (Last 24h, all streams).
2. If the list does not move, turn "15s tail" on, or reload the page; the filters stay in the address bar.
3. Export CSV exports only the current page; go through "Next" pages to export more.

Related pages: /system/report-center, /inventory/traceability, /system/governance, /system/role-matrix, /inventory/gate-bills

**Not done yet / watch out**
- Export CSV saves only the rows of the current page (up to 100), not the whole filtered result.
- Audit Center checks the role (Owner/Admin/Super Admin) on screen, so a user given rbac.view through an override still sees the access message.

### Company Profile (/system/company-profile)
Screen address: /system/company-profile · Roles: ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=system-company-profile

The company details printed on quotations, invoices and purchase orders, plus one production rule: the wastage reason limit.

Open it when the address, GSTIN, bank, terms or signatory changes, or to change how much trim and scrap an operator may log before a reason is required. Changes apply to every PDF made after you save.

**Before you start**
- system.view to see the page; system.manage to edit and see the "Save changes" bar (Owner/Admin have both).

**Step by step**
1. Open "Company profile" in the Reports & admin workspace.
2. Go through the tabs: "Identity", "Address & Contact", "Tax & Statutory", "Bank", "Terms & Signatory", "Production".
3. Edit the fields; watch the "Letterhead preview" on the right update as you type.
4. In "Production", set "Wastage reason limit (%)" (0–100, default 5).
5. Press "Save changes" in the bottom bar. You see "Company profile saved".

**What is on the screen**
- **Legal Name**: Printed bold on the quotation header and PDF metadata.
- **Trading Name / Tagline**: Optional brand name; tagline is the italic line under the legal name.
- **Logo Path**: File path inside frontend_v2/public/. Default brand/tpp-logo-pdf.svg.
- **Address, phones, email, website**: Letterhead contact block.
- **GSTIN, PAN, CIN, Udyam Reg., IEC Code**: Statutory numbers. GSTIN appears in the letterhead and footer of every quote.
- **Bank Name, Branch, Account Number, IFSC, UPI ID**: Payment details on documents. UPI is shown only if filled.
- **Default Payment Terms / Default Jurisdiction / Quote Validity (days)**: Shown on every quotation; validity sets the default expiry of new quotations.
- **Standard Terms & Conditions**: Leave blank to use the built-in terms.
- **Authorised Signatory Name / Signatory Role**: Printed under the signature line.
- **Wastage reason limit (%)**: When trim + scrap on a machine output log reaches this share of the run, the operator must choose a scrap reason and write why.
- **Last updated**: Time of the last save, shown in the page header.

**Common problems and fixes**
- "Access denied" — You lack system.view. Ask an Owner or Admin to grant it.
- "Save failed" — The server refused a value (message shown under the title) or the network dropped. Fix the field and press "Save changes" again.
- "Fields are grey and there is no save bar" — You have view but not system.manage. Only view is possible.

**If stuck**
1. Old PDFs keep the old details; re-generate the quotation PDF after saving.
2. If the logo is missing on PDFs, check that Logo Path matches a real file under public/.

Related pages: /sales/quotations, /procurement/purchase-orders, /production/machine-selector, /system/reason-codes

### RBAC + Notification Operations (Governance) (/system/governance)
Screen address: /system/governance · Roles: ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=system-governance

Admin console for notification routing rules, role visibility signoffs, profile change approvals and the recent permission audit.

Open it to decide who gets which in-app/email notification for an event, to approve a staff member's profile change request, to sign off which role may see which module action, and to re-check visibility after permission changes.

**Before you start**
- Role Owner, Admin or Super Admin; others see "This governance console is limited to ADMIN/OWNER roles."

**Step by step**
1. Read the four tiles: "Notification rules", "Active rules", "Signoff approved", "Signoff pending".
2. "Notification Rules" tab: enter "Event key" (e.g. production.fg_ready), pick "Target roles", "Channels" (IN_APP / EMAIL), "Priority", "Escalation (minutes)", subject/body templates, keep "Rule active" on, then "Create rule". Use "Edit" on a row and "Update rule" to change it.
3. "Role Signoffs" tab: press "Bootstrap pending rows" once to create rows from role permissions; then per row "Approve" or "Revoke", or fill "Role Signoff Editor" (Role, Action, Module, Approved, Notes) and "Create signoff"/"Update signoff".
4. "Profile Approvals" tab: read "Requested changes", add an optional review note, press "Approve" or "Reject".
5. "Visibility + Audit" tab: press "Revalidate" under "Role Visibility Revalidation"; check "Recent Permission Audit" (User, Action, Path, When) and "Reload" it.
6. Press "Refresh" at the top to reload all tabs; "Role Matrix" opens the permission editor.

**What is on the screen**
- **Event key**: The system event the rule listens to, e.g. production.fg_ready. Required.
- **Target roles**: Roles that receive the notification; click a role chip to add or remove it.
- **Channels**: IN_APP (bell tray) and/or EMAIL.
- **Priority / Escalation (minutes)**: LOW, NORMAL, HIGH, URGENT; escalation time if nobody acts.
- **Rule active**: Inactive rules are not used for routing.
- **Email subject / body template**: Text with placeholders such as {{batch_number}}; used for the email channel.
- **Module.Action / Status (signoffs)**: Which module action a role may see; APPROVED or PENDING.
- **Profile request columns**: Requestor, Requested changes, Submitted, Status, Review note.

**Common problems and fixes**
- "Event key is required (example: production.fg_ready)." — You pressed "Create rule" with an empty event key. Fill it.
- "Role, module key, and action key are required." — A signoff needs all three. Pick the role and type the module and action.
- "Only pending requests can be reviewed" — The profile request was already approved, rejected or cancelled by the user. Refresh the tab.
- "Access denied" — Your role is not Owner/Admin/Super Admin.

**If stuck**
1. Press "Refresh" if numbers look old.
2. If notifications do not arrive, check the rule is ACTIVE, the role is in Target roles and the channel is ticked.
3. You can open a tab directly with ?tab=signoffs, ?tab=profiles or ?tab=visibility.

Related pages: /system/role-matrix, /system/users, /profile, /system/audit

**Not done yet / watch out**
- The governance console checks only the role, so an rbac.view override does not open it.

### Scrap & Downtime Reasons (/system/reason-codes)
Screen address: /system/reason-codes · Roles: ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=system-reason-codes

The fixed list of reasons operators pick when they log scrap or machine downtime, with sub-codes under broad parents.

Open it when operators say the right reason is missing, a reason is confusing, or the order of the list needs changing. The machine terminal reads this list; reports group scrap and downtime by these codes.

**Before you start**
- Owner, Admin, Super Admin, or a user with production.manage.

**Step by step**
1. Pick the tab "Scrap reasons" (why material was scrapped during a step) or "Downtime reasons" (why a machine stopped).
2. Press "New reason", type "Code" (turns to capitals), "Label" and "Sort", then "Add".
3. To add a detail under a parent, press "Add sub-code under <code>" and then "Add sub-code".
4. Use "Edit reason" (pencil) to change the label, order or Active state; press the tick to save.
5. Use "Delete reason" only for a wrong entry; confirm the prompt. Old logs keep the reason text they stored.
6. Press "Refresh" to reload the list.

**What is on the screen**
- **Code**: Short unique code, stored in capitals, e.g. INK-SMEAR.
- **Label**: The words the operator sees.
- **Sort order**: Lower numbers show first in the operator's list.
- **Inactive**: Hidden from new logs but kept for history. Prefer this over delete.
- **Parent / sub-code**: Broad reason with detailed reasons under it.

**Common problems and fixes**
- "Access denied — needs production.manage (OWNER or ADMIN)" — Your role cannot manage reasons. Ask an Owner to grant production.manage.
- "Could not add reason" — Usually the code already exists in this list, or Code/Label is empty. Use another code.
- "Delete failed" — The server refused the delete. Mark the reason Inactive instead.
- "Failed to load reasons" — Network or server problem. Press "Refresh".

**If stuck**
1. If an operator cannot find a reason, check it is Active and in the right tab (scrap vs downtime).
2. The wastage limit that forces a reason is set in Company Profile → Production.

Related pages: /system/company-profile, /production/machine-selector, /maintenance/faults, /analytics/scrap

### Reorder & safety stock policy (/system/reorder-policy)
Screen address: /system/reorder-policy · Roles: ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=system-reorder-policy

Set the reorder point, safety stock and lead days for every material, and run the low-stock scan.

Open it when a material keeps running out, when a new material is added, or before the month's purchase planning. Anything below the reorder point raises a low-stock alert; below safety stock is flagged HIGH. Alerts appear in Inventory Alerts and feed purchase orders.

**Before you start**
- Owner/Admin/Super Admin, or materials.view / materials.manage / inventory.manage.
- Materials exist in the masters (films, granules, inks, adhesives, packaging…).

**Step by step**
1. Read the tiles: "Materials", "Coverage" (how many have a policy), "Below reorder", "Below safety".
2. Use "Filter": pick "Category", type in "Search code or name", or tick "Only materials without policy".
3. In the table, type "Reorder qty", "Safety stock" and "Lead days" in the row.
4. Press "Save" on that row. You see "Saved — <code>: policy updated."
5. Press "Run reorder scan" to check all stock now; the toast shows scanned / raised / resolved.

**What is on the screen**
- **Material / Category**: Material code, name and its master category.
- **Stock**: Current stock on hand; marked when below reorder or safety.
- **Reorder qty**: Stock level that raises a low-stock alert.
- **Safety stock**: Minimum buffer. Below it the alert is HIGH severity.
- **Lead days**: Days the vendor usually takes to deliver; helps decide when to order.
- **Last alert**: When this material last raised an alert.

**Common problems and fixes**
- "Save failed" — A value is not a valid number or you lack materials.manage/inventory.manage. Correct it or ask an Owner.
- "Scan failed" — The scan could not run (server busy or no permission). Try again in a minute.
- "No materials match the current filter." — Clear the search and category, untick "Only materials without policy".

**If stuck**
1. A daily scan also runs automatically (06:00); "Run reorder scan" is only for an immediate check.
2. After raising stock through a GRN, run the scan again to resolve the alert.

Related pages: /inventory/alerts, /procurement/purchase-orders/new, /analytics/mrp, /dashboard/inventory

**Not done yet / watch out**
- A low-stock alert does not create a purchase order; the buyer must raise the PO by hand.

### Report Center (/system/report-center)
Screen address: /system/report-center · Roles: ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=system-report-center

Turn daily report packs on or off, generate a pack now, and download archived packs (PDF and detail workbook).

Daily packs are generated into an archive and announced to Owner/Admin in the notification bell. Email delivery and per-pack schedules were removed on purpose. Open this page to choose which packs run, to make one now, or to fetch an older pack for an audit.

**Before you start**
- Owner/Admin/Super Admin with analytics.view or analytics.manage (report admin).

**Step by step**
1. Check the tiles: "Active daily packs", "Successful archives", "Archive shelf", "Stored PDF size".
2. Under "Daily packs", switch each pack Active or Paused.
3. Press "Save active packs". You see "Report center saved".
4. To make a pack now, press "Generate now" on it. You see "Daily pack generated" and Owner/Admin get an in-app notice.
5. In "Archive shelf — Recent generated packs" (last 45 days) use "Preview", "Download PDF" or "Detail workbook".
6. Press "Refresh archive" to reload the list.

**What is on the screen**
- **Active / Paused switch**: Active packs are included in the next daily archive cycle.
- **Latest status / Latest archive**: Result and time of the last run of that pack.
- **Inbox audience**: Who is told in the bell: Owner and Admin.
- **Stored PDF size**: Disk used by successful archives in the recent window.

**Common problems and fixes**
- "Report Center Restricted" — Only report admins can see archives. Ask an Owner for analytics.view.
- "Could not generate report pack" — The pack failed to build (message shows why). Try again later; check System Health if it repeats.
- "No archived report packs yet." — No pack has run in the last 45 days. Turn one Active and press "Generate now".

**If stuck**
1. If a pack does not arrive in the morning, check it is Active and look at its Latest status.
2. Analytics screens stay in Reports Hub; this center only builds and keeps the archive.

Related pages: /system/settings, /analytics, /analytics/costing, /dashboard/admin, /system/audit

**Not done yet / watch out**
- Report packs cannot be emailed or scheduled per pack; they only go to the archive and the Owner/Admin bell.

### Role Matrix (/system/role-matrix)
Screen address: /system/role-matrix · Roles: ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=system-role-matrix

Choose a role and tick the permissions it gets by default. Every user of that role inherits them.

Open it when a whole role needs more or less access, e.g. give every Store user "Bills & documents" rights or remove a page from Sales. For one person only, use the user's "Extra access overrides" in User Management instead.

**Before you start**
- Owner/Admin/Super Admin, or rbac.view (to look) / rbac.manage (to save).

**Step by step**
1. Pick the role in "Select role".
2. For OWNER/ADMIN/SUPER_ADMIN, switch on the "System role lock" unlock first; these roles need an explicit unlock before any edit.
3. Optionally apply "Quick Presets": "Read-only preset" or "Floor ops preset" (they only add permissions).
4. Search with "Search permission...", filter by "Module", tick or untick permissions. "Selected only" shows ticked ones; "Add visible" / "Remove visible extras" work on the filtered list.
5. Watch the badge: "Unsaved changes" or "All changes saved".
6. Press "Save Matrix". You see "Role matrix updated" with the roles changed.
7. "Reset to baseline" removes all custom additions for the role (asks to confirm). "Sync Defaults" re-applies built-in defaults to all roles.

**What is on the screen**
- **Easy Mode**: Simple view with presets and grouped permissions; switch off for the full list.
- **Locked**: Permission that is part of the system role and cannot be removed here.
- **Bills & documents group**: documents.*, gatepass.manage, outward.reconcile rights. Store has them by default; Owner/Admin always; Watchman never.
- **Unticking**: Unticking and saving really removes the permission, even a built-in default. A per-user override still applies.

**Common problems and fixes**
- "System role editing is locked. Enable unlock to modify this role." — You chose OWNER/ADMIN/SUPER_ADMIN. Switch on the unlock first.
- "Save failed" — You lack rbac.manage or the server refused a code. Read the message and retry.
- "No change — preset did not add new permissions" — The role already has everything in that preset.

**If stuck**
1. If a user still cannot open a page after saving, ask them to sign out and in again.
2. If a user can still open a page you removed, check their personal overrides in User Management.

Related pages: /system/users, /system/governance, /system/audit

### System Settings — Report delivery settings removed (/system/settings)
Screen address: /system/settings · Roles: ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=system-settings

A notice page: daily report email and schedule settings were removed. It shows the report pack counts and links to the Report Center.

Open it when someone looks for the old email schedule. Reports now generate into the archive and notify Owner/Admin in-app; use the Report Center to switch packs or generate one.

**Before you start**
- Owner or Admin (page.system.settings.view).

**Step by step**
1. Read the three tiles: "Active daily packs", "Successful archives" (last 8 runs within 30 days), "Inbox audience" (OWNER · ADMIN).
2. Press "Refresh status" to reload the counts.
3. Press "Open Report Center" or "Open archive controls" to manage packs.
4. Press "Open Reports Hub" for analytics reports.

**What is on the screen**
- **Active daily packs**: Packs switched Active in the Report Center.
- **Successful archives**: Recent runs with status SUCCEEDED.
- **Inbox audience**: Always OWNER · ADMIN.

**Common problems and fixes**
- "Counts show 0" — No pack is Active or you lack analytics access. Open the Report Center to check.

**If stuck**
1. Everything to change is in the Report Center; this page has no settings to save.

Related pages: /system/report-center, /analytics

**Not done yet / watch out**
- The Settings page has no settings left; it only explains that report email schedules were removed and links to the Report Center.

### Shift Timing — Fixed shift windows (/system/shift-timing)
Screen address: /system/shift-timing · Roles: ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=system-shift-timing

Define each plant's shift windows (code, name, start, end). Issues, returns, counts, WCM and machine logs get their shift from the event time.

Open it when the plant starts, changes or drops a shift. Operators never pick a shift by hand, so wrong windows put output in the wrong shift on reports.

**Before you start**
- Owner/Admin (factory.view / factory.manage). The plant exists under Factory → Plants.

**Step by step**
1. Pick the "Plant".
2. In "Add shift" fill "Code" (e.g. A), "Name" (e.g. Morning), "Start time", "End time".
3. Check "Crosses midnight" — it ticks itself when the end time is earlier than the start; the duration shows next to it.
4. Set "Priority" (default 100) and keep "Active" on.
5. Press "Add shift" (or "Save shift" when editing).
6. In the list use "Edit" or the delete icon (asks "Delete shift <code>?").

**What is on the screen**
- **Code / Name**: Short code (stored in capitals) and readable name.
- **Start time / End time**: Shift window in 24-hour time.
- **Crosses midnight**: For night shifts that end the next day.
- **Priority**: Used when two windows overlap; decides which shift wins.
- **Active**: Inactive shifts stay stored but are not used for new timestamp inference.
- **Table: Shift, Window, Priority, Status, Actions**: All shifts of the chosen plant.

**Common problems and fixes**
- "Shift save failed" — Code or name is empty, the code already exists for the plant, or times are invalid. Fix and save again.
- "Delete failed" — The server refused. Switch the shift to inactive instead.
- "No shifts configured for this plant." — Add at least one shift so logs get a shift.

**If stuck**
1. If the button stays grey, fill Plant, Code, Name and both times.
2. Changing a window affects new logs only; old logs keep their shift.

Related pages: /factory/plants, /production/work-center, /production/machine-selector, /analytics/reports/shift-performance

**Not done yet / watch out**
- Changing a shift window does not re-assign shifts of logs already recorded.

### User Management (/system/users)
Screen address: /system/users · Roles: ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=system-users

The list of everyone who can sign in: role, owner flag, active state and personal overrides. Add or open a user from here.

Open it when someone joins, leaves, changes job, forgets a password or cannot open a page. Roles set the baseline, overrides give one-off access, and the effective view shows what a person can really do.

**Before you start**
- Owner/Admin/Super Admin, or users.view / rbac.view. Editing needs rbac.manage.

**Step by step**
1. Read the tiles: "Total users", "Active", "Owners", "With overrides" — they also work as filters ("All").
2. Search with "Search by name, email or role…".
3. Click a user row to open the editor (/system/users/<id>).
4. Press "Add user" to create a new account.
5. Press "Role matrix" to change what a whole role can do.

**What is on the screen**
- **Total users / Active / Owners / With overrides**: Counts and quick filters of the list.
- **Owner badge**: Account has the owner flag (bypasses permission checks).
- **Overrides count**: How many extra permissions the user has beyond the role.

**Common problems and fixes**
- "Access denied — you need rbac.view to see the user registry." — Ask an Owner to grant rbac.view.
- "No users match — Try clearing filters." — Clear the search box and click "All".

**If stuck**
1. A person who left: open them and switch "Active" off; history stays.
2. Too many failed sign-ins lock an account for 15 minutes; reset the password from the editor if needed.

Related pages: /system/users/new, /system/users/[id], /system/role-matrix, /system/governance

**Not done yet / watch out**
- There is no delete for users; leavers must be switched to inactive.

### Edit user (/system/users/[id])
Screen address: /system/users/[id] · Roles: ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=system-users-id

Change one user's identity, active state, role, owner flag, extra overrides, work-centre or machine scope, and reset their password.

Open it from User Management when a person changes job, needs one extra page, gets new machines or work centres, leaves, or forgets their password.

**Before you start**
- rbac.manage (Owner/Admin) to edit; without it the page is read-only. Only an Owner may change the owner flag.
- Work centres and machines exist in Factory set-up.

**Step by step**
1. Check "Identity" (login credentials & contact) and the "Active" switch.
2. Pick one "Base role" card.
3. For a Work Center Manager tick work centres in "Work-center scope"; for a Machine Operator tick machines in "Machines this operator runs"; for a Watchman tick plants in "Gate assignment".
4. Add one-off rights in "Extra access overrides" (search permissions, pages, modules; click a chip).
5. Review "Access summary" and press "Save changes". You see "User saved".
6. To reset a password, open "Reset password", type the "New password" (at least 8 characters) and confirm. The user must sign in again.
7. Press "Back to users" to return.

**What is on the screen**
- **Username ***: Sign-in name, e.g. priya.s. Required.
- **Email ***: Required for every user.
- **First name / Last name / Phone**: Contact details shown in lists and audit.
- **Active**: Off blocks every sign-in for this account. Use this instead of deleting a person who left.
- **Owner flag**: Bypasses all permission checks. Only an existing Owner may change it; the last active owner cannot lose it.
- **Base role**: One role card: sets the baseline permissions and the landing page.
- **Extra access overrides**: One-off permissions for this user only. Green chips are overrides; muted chips already come from the role.
- **Work-center scope**: Required for Work Center Manager users; their machines come from these work centres.
- **Machines this operator runs**: Required for Machine Operator; the operator sees and works only on these machines.
- **Gate assignment**: Watchman only: plants whose gate this watchman can log.
- **Access summary**: Base role, extra overrides and effective permissions — review before saving.

**Common problems and fixes**
- "Work center required — Work Center Manager users must be assigned to at least one work center." — Tick at least one work centre under "Work-center scope".
- "Machine required — A Machine Operator must be given at least one machine to run." — Tick at least one machine under "Machines this operator runs".
- "A Machine Operator is given machines, not work centres. Assign machines instead." — Operators get machines; managers get work centres. Clear the work centres.
- "Only an owner can grant owner rights. / Only an owner can change an owner account." — Ask an existing Owner to make this change.
- "This is the last active owner account; add another owner first." — Make a second user Owner before disabling or demoting this one.
- "Watchman users cannot be owners. / Watchman permissions are limited to the gate terminal." — A Watchman gets only the gate; remove overrides and the owner flag.
- "Permission '<code>' is not assignable as user-level override." — That permission can only come from a role. Change it in the Role Matrix.
- "Reset failed" — The new password is too short, too common or only numbers. Use a stronger one.

**If stuck**
1. If the user still sees old pages, ask them to sign out and sign in.
2. To change many users of the same role, edit the Role Matrix instead of each user.
3. An operator who sees no jobs usually has no machine ticked here.

Related pages: /system/users, /system/role-matrix, /factory/work-centers, /factory/machines, /system/audit

**Not done yet / watch out**
- Password reset sets a password the admin types; there is no reset-by-email link.

### Add user (/system/users/new)
Screen address: /system/users/new · Roles: ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=system-users-new

Create a new sign-in account: identity, initial password, base role, scope and any extra overrides.

Open it from "Add user" on User Management when a new person joins. Give the person their username and initial password; they can change it later on My Profile → Security.

**Before you start**
- rbac.manage (Owner/Admin).
- For WCM or operator: work centres / machines already exist.

**Step by step**
1. Fill "Username *", "Email *", "First name", "Last name", "Phone".
2. Type the "Initial password *" — at least 8 characters, not only numbers.
3. Pick the "Base role" card.
4. Set scope: work centres (WCM), machines (operator) or gate plants (watchman).
5. Add "Extra access overrides" only if this person needs more than the role.
6. Press "Create user". You see "User created".

**What is on the screen**
- **Username ***: Sign-in name, e.g. priya.s. Required.
- **Email ***: Required for every user.
- **First name / Last name / Phone**: Contact details shown in lists and audit.
- **Initial password ***: At least 8 characters, not only numbers; also checked against common passwords.
- **Owner flag**: Bypasses all permission checks. Only an existing Owner may change it; the last active owner cannot lose it.
- **Base role**: One role card: sets the baseline permissions and the landing page.
- **Extra access overrides**: One-off permissions for this user only. Green chips are overrides; muted chips already come from the role.
- **Work-center scope**: Required for Work Center Manager users; their machines come from these work centres.
- **Machines this operator runs**: Required for Machine Operator; the operator sees and works only on these machines.
- **Gate assignment**: Watchman only: plants whose gate this watchman can log.
- **Access summary**: Base role, extra overrides and effective permissions — review before saving.

**Common problems and fixes**
- "Password required — Enter an initial password for the new user." — Type an initial password.
- "The initial password must be at least 8 characters. / cannot be only numbers." — Use 8+ characters with letters.
- "Email is required." — Fill the Email field.
- "Create failed" — Username or email is already used, or a scope rule failed (message shows which). Fix and retry.
- "Work center required — Work Center Manager users must be assigned to at least one work center." — Tick at least one work centre under "Work-center scope".
- "Machine required — A Machine Operator must be given at least one machine to run." — Tick at least one machine under "Machines this operator runs".
- "A Machine Operator is given machines, not work centres. Assign machines instead." — Operators get machines; managers get work centres. Clear the work centres.

**If stuck**
1. If the person cannot sign in, check "Active" is on and the username is exactly as created.
2. These screens have no delete button; switch off Active to stop access.

Related pages: /system/users, /system/role-matrix, /profile

## हर स्क्रीन (हिंदी)

### System Admin Console (/dashboard/admin)
स्क्रीन का पता: /dashboard/admin · भूमिकाएँ: ADMIN, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=dashboard-admin&lang=hi

पूरे ERP के server की हालत, database health, access sign-off और सुरक्षित maintenance एक जगह।

Admin का पहला पेज। दिन की शुरुआत में या जब लोग कहें कि ERP धीमा है, तब खोलें: CPU, memory, disk, database latency और error rate देखें, कौन-से department sign-off बाकी हैं देखें, और सफ़ाई के काम चलाएँ। यहाँ से Users, Role matrix, Audit centre, Company profile, Shift timing और Report centre के link हैं।

**शुरू करने से पहले**
- ADMIN या SUPER_ADMIN role।

**स्टेप बाय स्टेप**
1. ऊपर के tile पढ़ें: "Active users" (पिछले 24 घंटे में login), "Error rate" (fail हुई requests), "Database latency" और "Database size"।
2. "Server resources" में CPU, Memory और Disk देखें। "Telemetry stale" दिखे तो "Refresh vitals" दबाएँ।
3. "Department sign-off" में Approved और Pending गिनती देखें। बाकी role/module visibility मंज़ूर करने के लिए "Open Governance Console" दबाएँ।
4. "Maintenance" में, अगर report या dashboard पुराने आँकड़े दिखाएँ तो "Clear application cache" दबाएँ। अगली बार खोलने पर report फिर से बनते हैं।
5. database की जगह खाली करने के लिए "Vacuum…" दबाएँ, फिर पक्का करने के लिए "Run vacuum now" (या "Cancel")। इसे shift के बाहर चलाएँ।
6. "System event stream" में platform की ताज़ा गतिविधि पढ़ें।
7. "Administration" के link से Users, Role matrix, Audit centre, Company profile, Shift timing या Report centre पर जाएँ।

**स्क्रीन पर क्या है**
- **Active users**: पिछले 24 घंटे में login करने वाले लोग।
- **Error rate**: fail हुई requests का हिस्सा। बढ़े तो कुछ टूट रहा है; event stream और Audit centre देखें।
- **Database latency / Database size**: database कितनी जल्दी जवाब देता है, उसका आकार और खुले connections।
- **CPU / Memory / Disk**: server का चालू उपयोग। Disk भरने के पास हो तो backup fail होने से पहले कदम उठाएँ।
- **Department sign-off**: role और module visibility की मंज़ूरी: Approved बनाम Pending। "Every role is signed off." का मतलब कुछ बाकी नहीं।
- **Clear application cache**: cache में रखे report और dashboard हटाता है। कभी भी सुरक्षित।
- **Vacuum database**: जगह खाली करता है और planner statistics ताज़ा करता है। पक्का करने के लिए दूसरा click माँगता है।

**आम दिक्कतें और हल**
- "System health did not respond. The rest of the ERP is unaffected." — health endpoint ने समय पर जवाब नहीं दिया। "Retry" दबाएँ। बाकी स्क्रीन चलती रहती हैं।
- "Telemetry stale" — आँकड़े पुराने हैं। "Refresh vitals" दबाएँ।
- "Could not clear cache / Vacuum failed" — maintenance call fail हुई; toast में server का कारण दिखता है। shift के बाहर फिर कोशिश करें या server log देखें।

**अटक गए तो**
1. tile में "—" दिखे तो "Retry" दबाएँ; server व्यस्त हो सकता है।
2. report के आँकड़े गलत लगें तो पहले "Clear application cache" चलाएँ।

जुड़े पेज: /system/users, /system/role-matrix, /system/audit, /system/company-profile, /system/shift-timing, /system/report-center, /system/governance

### System (User Management खुलता है) (/system)
स्क्रीन का पता: /system · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=system&lang=hi

इस पते की अपनी कोई स्क्रीन नहीं है। यह आपको सीधे User Management (/system/users) पर ले जाता है।

पुराने लिंक और All screens का "System" सेक्शन इसी पते पर आते हैं। यह redirect उन्हें चालू रखता है: एडमिन का पहला काम लोग और उनकी पहुँच है, इसलिए आप यूज़र लिस्ट पर पहुँचते हैं। बाकी सभी एडमिन स्क्रीन "Reports & admin" workspace के टैब हैं।

**शुरू करने से पहले**
- आप Owner, Admin या Super Admin के रूप में लॉग-इन हैं, या आपके पास users.view / rbac की अनुमति है।

**स्टेप बाय स्टेप**
1. /system खोलें या साइडबार में "All screens" के नीचे "System" पर क्लिक करें।
2. पेज तुरंत आपको "User Management" पर ले जाता है।
3. दूसरी एडमिन स्क्रीन के लिए workspace bar के टैब (Users, Role matrix, Governance, Company profile, Settings…) इस्तेमाल करें।
4. अगर यूज़र लिस्ट पर "Access denied" दिखे तो Owner से rbac.view अनुमति माँगें।

**स्क्रीन पर क्या है**
- **Redirect कहाँ जाता है**: हमेशा /system/users। इस पते से कुछ सेव या बदलता नहीं है।

**आम दिक्कतें और हल**
- "Access denied (यूज़र लिस्ट पर)" — आपका रोल Owner/Admin नहीं है और rbac.view अनुमति नहीं है। Owner से Role matrix में या यूज़र override में यह अनुमति जुड़वाएँ।

**अटक गए तो**
1. अगर पेज खाली रहे तो सीधे /system/users खोलें।
2. साइडबार में "Reports & admin" workspace से अपनी ज़रूरत की एडमिन स्क्रीन चुनें।

जुड़े पेज: /system/users, /system/role-matrix, /system/governance, /system/settings

**अभी नहीं होता / ध्यान दें**
- /system का अपना कोई overview पेज नहीं है; यह हमेशा User Management पर जाता है।

### Audit Center (ऑडिट केंद्र) (/system/audit)
स्क्रीन का पता: /system/audit · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=system-audit&lang=hi

एक खोजने लायक रजिस्टर कि किसने क्या और कब किया: production run, stock movement, master बदलाव, login, permission बदलाव, report archive, gate register और system config।

जब किसी बदलाव को साबित करना या जाँचना हो तब खोलें: कोई roll गायब हुआ, किसी को permission मिली, sales order बदला, login fail हुआ। Reference (SO, ROLL, JOB, यूज़र, route) खोजें, stream, range, actor या severity से छाँटें, फिर row खोलकर पहले/बाद का डेटा देखें। बाहर की जाँच के लिए CSV export करें।

**शुरू करने से पहले**
- रोल Owner, Admin या Super Admin होना चाहिए। बाकी रोल को "Audit Center is limited to owner and admin roles" दिखता है।
- "Gate Register" stream सिर्फ़ gate master (Owner/Admin/Super Admin) को दिखती है।

**स्टेप बाय स्टेप**
1. सर्च बॉक्स में reference लिखें, जैसे SO-2026-0123, ROLL-…, JOB-…, यूज़र का नाम, route या permission code।
2. "Stream", "Range" (default "Last 24h"), "Actor" और "Severity" चुनकर लिस्ट छोटी करें। Stream card पर क्लिक करने से भी वही filter लगता है।
3. लिस्ट "Timeline" (Today / Yesterday / तारीख के हिसाब से) या "Table" में पढ़ें; सबसे नया ऊपर, एक पेज पर 100 row, "Prev"/"Next" से आगे-पीछे।
4. किसी row पर क्लिक करें: "Diff / Raw" खुलता है जिसमें "Before" और "After" (या "Captured details" और "Raw audit payload") दिखते हैं।
5. दाईं ओर "Investigation" पैनल देखें: समर्थित reference का trace सार, timeline और जुड़ी चीज़ें। "Copy" reference कॉपी करता है; gate bill की घटना पर "Open bill" बिल खोलता है।
6. "15s tail" दबाकर live refresh (हर 15 सेकंड) रोकें या चालू करें। "Reset" सारे filter हटाता है।
7. "Export CSV" दबाकर इस पेज पर दिख रही rows audit-events-<date>.csv फ़ाइल में डाउनलोड करें।

**स्क्रीन पर क्या है**
- **"Events Found" वाला हिस्सा**: Filter से मिलने वाली कुल घटनाएँ (सभी पेज), और इस पेज पर कितनी दिख रही हैं।
- **"Actors In Scope" वाला हिस्सा**: नतीजे में आने वाले यूज़र, सर्विस और system job (actor board में ऊपर के 7 दिखते हैं)।
- **"High Signals" वाला हिस्सा**: HIGH + CRITICAL घटनाएँ। CRITICAL = denied, failed, critical या mismatch; HIGH = role, override, void या scrap।
- **"Freshness" वाला हिस्सा**: लोड होते समय "Syncing", वरना "Green" और आख़िरी जवाब का समय।
- **"Stream cards" वाला हिस्सा**: Operational Flow, Production Runs, Inventory Movement, Master Data, Session & Login, Permissions, Report Archives, Gate Register, System Config। हर card पर गिनती और छोटी trend line दिखती है।
- **"Range" वाला हिस्सा**: Last hour, Today, Last 24h, Last 7d, This month, All audit।
- **"Severity" वाला हिस्सा**: LOW, MEDIUM (warning, pending, adjustment, हर master-data बदलाव), HIGH, CRITICAL।
- **"Heatmap, actor board, action mix, signal panel" वाला हिस्सा**: इस पेज की घटनाओं के चार्ट। किसी actor, action या severity पर क्लिक करने से वह filter लग जाता है।
- **"Trace badge" वाला हिस्सा**: जब खोजा गया text ऐसा reference हो जिसे सिस्टम trace कर सके (sales order, roll, job…) तब "Trace ready" दिखता है।

**आम दिक्कतें और हल**
- "स्क्रीन पर संदेश: "Audit Center is limited to owner and admin roles."" — आपका चालू रोल Owner/Admin/Super Admin नहीं है। Roll का इतिहास देखने के लिए "Open Roll Genealogy" दबाएँ, या Owner से पूछें।
- "स्क्रीन पर संदेश: "No audit events match the current filters."" — Range बहुत छोटा है या stream/actor/severity filter rows छुपा रहा है। Range "Last 7d" या "All audit" करें, या "Reset" दबाएँ।
- "Trace पर चेतावनी का निशान" — लिखा गया text trace होने वाला reference नहीं है। पूरा code सही लिखें (जैसे SO-2026-0123) या row खोलकर उसका reference इस्तेमाल करें।

**अटक गए तो**
1. "Reset" दबाकर default (Last 24h, सभी stream) पर लौटें।
2. अगर लिस्ट नहीं बदल रही तो "15s tail" चालू करें या पेज reload करें; filter address bar में बने रहते हैं।
3. Export CSV सिर्फ़ इस पेज की rows निकालता है; ज़्यादा के लिए "Next" पेज पर जाकर फिर export करें।

जुड़े पेज: /system/report-center, /inventory/traceability, /system/governance, /system/role-matrix, /inventory/gate-bills

**अभी नहीं होता / ध्यान दें**
- Export CSV सिर्फ़ इस पेज की rows (100 तक) सेव करता है, पूरा filter किया नतीजा नहीं।
- Audit Center स्क्रीन पर रोल (Owner/Admin/Super Admin) जाँचता है, इसलिए override से rbac.view पाया यूज़र भी access संदेश ही देखता है।

### Company Profile (कंपनी की जानकारी) (/system/company-profile)
स्क्रीन का पता: /system/company-profile · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=system-company-profile&lang=hi

Quotation, invoice और purchase order पर छपने वाली कंपनी की जानकारी, और production का एक नियम: wastage reason limit।

जब पता, GSTIN, बैंक, terms या signatory बदले, या यह बदलना हो कि operator बिना कारण कितना trim और scrap लिख सकता है, तब खोलें। सेव करने के बाद बनने वाले हर PDF पर बदलाव लागू होता है।

**शुरू करने से पहले**
- पेज देखने के लिए system.view; बदलने और "Save changes" बार देखने के लिए system.manage (Owner/Admin के पास दोनों हैं)।

**स्टेप बाय स्टेप**
1. Reports & admin workspace में "Company profile" खोलें।
2. टैब एक-एक करके देखें: "Identity", "Address & Contact", "Tax & Statutory", "Bank", "Terms & Signatory", "Production"।
3. फ़ील्ड बदलें; दाईं ओर "Letterhead preview" तुरंत बदलता दिखेगा।
4. "Production" में "Wastage reason limit (%)" भरें (0–100, default 5)।
5. नीचे की बार में "Save changes" दबाएँ। "Company profile saved" दिखेगा।

**स्क्रीन पर क्या है**
- **"Legal Name" वाला हिस्सा**: Quotation के header और PDF metadata में मोटे अक्षरों में छपता है।
- **"Trading Name / Tagline" वाला हिस्सा**: वैकल्पिक brand नाम; tagline legal name के नीचे तिरछी लाइन है।
- **"Logo Path" वाला हिस्सा**: frontend_v2/public/ के अंदर फ़ाइल का path। Default brand/tpp-logo-pdf.svg।
- **"Address, phones, email, website" वाला हिस्सा**: Letterhead का संपर्क हिस्सा।
- **"GSTIN, PAN, CIN, Udyam Reg., IEC Code" वाला हिस्सा**: कानूनी नंबर। GSTIN हर quote के letterhead और footer में आता है।
- **"Bank Name, Branch, Account Number, IFSC, UPI ID" वाला हिस्सा**: दस्तावेज़ों पर भुगतान की जानकारी। UPI भरा हो तभी दिखता है।
- **"Default Payment Terms / Default Jurisdiction / Quote Validity (days)" वाला हिस्सा**: हर quotation पर दिखते हैं; validity नए quotation की default समाप्ति तय करती है।
- **"Standard Terms & Conditions" वाला हिस्सा**: खाली छोड़ें तो built-in terms इस्तेमाल होंगे।
- **"Authorised Signatory Name / Signatory Role" वाला हिस्सा**: हस्ताक्षर की लाइन के नीचे छपता है।
- **"Wastage reason limit (%)" वाला हिस्सा**: जब machine output log पर trim + scrap run के इस हिस्से तक पहुँचे, तो operator को scrap reason चुनना और कारण लिखना ज़रूरी है।
- **"Last updated" वाला हिस्सा**: आख़िरी save का समय, पेज के ऊपर।

**आम दिक्कतें और हल**
- "स्क्रीन पर संदेश: "Access denied"" — आपके पास system.view नहीं है। Owner या Admin से दिलवाएँ।
- "स्क्रीन पर संदेश: "Save failed"" — सर्वर ने कोई value नहीं मानी (title के नीचे संदेश) या नेटवर्क टूटा। फ़ील्ड ठीक करके फिर "Save changes" दबाएँ।
- "फ़ील्ड धूसर हैं और save बार नहीं है" — आपके पास देखने की अनुमति है पर system.manage नहीं। सिर्फ़ देख सकते हैं।

**अटक गए तो**
1. पुराने PDF में पुरानी जानकारी रहती है; save के बाद quotation PDF फिर से बनाएँ।
2. PDF पर logo न दिखे तो देखें कि Logo Path public/ में असली फ़ाइल से मेल खाता है।

जुड़े पेज: /sales/quotations, /procurement/purchase-orders, /production/machine-selector, /system/reason-codes

### RBAC + Notification Operations (Governance — अनुमति और सूचना नियंत्रण) (/system/governance)
स्क्रीन का पता: /system/governance · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=system-governance&lang=hi

Notification routing rules, role visibility signoff, profile बदलाव की मंज़ूरी और हाल के permission audit का एडमिन कंसोल।

इसे तब खोलें जब तय करना हो कि किसी event की in-app/email notification किसे जाए, किसी कर्मचारी की profile बदलाव की request मंज़ूर करनी हो, कौन-सा रोल कौन-सा module action देखे इसका signoff करना हो, या permission बदलने के बाद visibility दोबारा जाँचनी हो।

**शुरू करने से पहले**
- रोल Owner, Admin या Super Admin; बाकी को "This governance console is limited to ADMIN/OWNER roles." दिखता है।

**स्टेप बाय स्टेप**
1. चार tile पढ़ें: "Notification rules", "Active rules", "Signoff approved", "Signoff pending"।
2. "Notification Rules" टैब: "Event key" (जैसे production.fg_ready) भरें, "Target roles", "Channels" (IN_APP / EMAIL), "Priority", "Escalation (minutes)", subject/body template चुनें, "Rule active" चालू रखें, फिर "Create rule"। बदलने के लिए row पर "Edit" और फिर "Update rule"।
3. "Role Signoffs" टैब: एक बार "Bootstrap pending rows" दबाएँ ताकि role permissions से rows बनें; फिर हर row पर "Approve" या "Revoke", या "Role Signoff Editor" (Role, Action, Module, Approved, Notes) भरकर "Create signoff"/"Update signoff"।
4. "Profile Approvals" टैब: "Requested changes" पढ़ें, चाहें तो review note लिखें, "Approve" या "Reject" दबाएँ।
5. "Visibility + Audit" टैब: "Role Visibility Revalidation" में "Revalidate" दबाएँ; "Recent Permission Audit" (User, Action, Path, When) देखें और "Reload" करें।
6. ऊपर "Refresh" सभी टैब फिर लोड करता है; "Role Matrix" permission editor खोलता है।

**स्क्रीन पर क्या है**
- **"Event key" वाला हिस्सा**: वह system event जिस पर rule चलता है, जैसे production.fg_ready। ज़रूरी।
- **"Target roles" वाला हिस्सा**: जिन रोल को notification जाएगी; chip पर क्लिक करके जोड़ें या हटाएँ।
- **"Channels" वाला हिस्सा**: IN_APP (bell tray) और/या EMAIL।
- **"Priority / Escalation (minutes)" वाला हिस्सा**: LOW, NORMAL, HIGH, URGENT; कोई कार्रवाई न हो तो escalation का समय।
- **"Rule active" वाला हिस्सा**: बंद rule routing में इस्तेमाल नहीं होते।
- **"Email subject / body template" वाला हिस्सा**: {{batch_number}} जैसे placeholder वाला text; email channel के लिए।
- **"Module.Action / Status (signoffs)" वाला हिस्सा**: कौन-सा module action रोल देख सकता है; APPROVED या PENDING।
- **"Profile request columns" वाला हिस्सा**: Requestor, Requested changes, Submitted, Status, Review note।

**आम दिक्कतें और हल**
- "स्क्रीन पर संदेश: "Event key is required (example: production.fg_ready)."" — Event key खाली रखकर "Create rule" दबाया। उसे भरें।
- "स्क्रीन पर संदेश: "Role, module key, and action key are required."" — Signoff के लिए तीनों चाहिए। रोल चुनें और module व action लिखें।
- "स्क्रीन पर संदेश: "Only pending requests can be reviewed"" — Profile request पहले ही मंज़ूर, अस्वीकार या यूज़र द्वारा रद्द हो चुकी है। टैब refresh करें।
- "स्क्रीन पर संदेश: "Access denied"" — आपका रोल Owner/Admin/Super Admin नहीं है।

**अटक गए तो**
1. आँकड़े पुराने लगें तो "Refresh" दबाएँ।
2. Notification न पहुँचे तो देखें rule ACTIVE है, रोल Target roles में है और channel टिक है।
3. ?tab=signoffs, ?tab=profiles या ?tab=visibility से कोई टैब सीधे खोल सकते हैं।

जुड़े पेज: /system/role-matrix, /system/users, /profile, /system/audit

**अभी नहीं होता / ध्यान दें**
- Governance console सिर्फ़ रोल जाँचता है, इसलिए rbac.view override से यह नहीं खुलता।

### Scrap & Downtime Reasons (scrap और downtime के कारण) (/system/reason-codes)
स्क्रीन का पता: /system/reason-codes · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=system-reason-codes&lang=hi

वह तय लिस्ट जिसमें से operator scrap या machine downtime लिखते समय कारण चुनते हैं; बड़े parent के नीचे sub-code।

जब operator कहें कि सही कारण लिस्ट में नहीं है, कोई कारण उलझन वाला है, या लिस्ट का क्रम बदलना हो, तब खोलें। Machine terminal यही लिस्ट पढ़ता है; रिपोर्ट scrap और downtime को इन्हीं code से जोड़ती हैं।

**शुरू करने से पहले**
- Owner, Admin, Super Admin, या production.manage वाला यूज़र।

**स्टेप बाय स्टेप**
1. टैब चुनें: "Scrap reasons" (किसी step में material क्यों scrap हुआ) या "Downtime reasons" (machine क्यों रुकी)।
2. "New reason" दबाएँ, "Code" (अपने-आप capital), "Label" और "Sort" भरें, फिर "Add"।
3. किसी parent के नीचे detail जोड़ने के लिए "Add sub-code under <code>" और फिर "Add sub-code" दबाएँ।
4. Label, क्रम या Active बदलने के लिए "Edit reason" (पेंसिल) दबाएँ; save के लिए tick दबाएँ।
5. "Delete reason" सिर्फ़ गलत entry के लिए; पूछे जाने पर पक्का करें। पुराने log में उनका लिखा कारण बना रहता है।
6. लिस्ट फिर लोड करने के लिए "Refresh" दबाएँ।

**स्क्रीन पर क्या है**
- **"Code" वाला हिस्सा**: छोटा अलग code, capital में, जैसे INK-SMEAR।
- **"Label" वाला हिस्सा**: Operator को दिखने वाले शब्द।
- **"Sort order" वाला हिस्सा**: छोटा नंबर operator की लिस्ट में पहले आता है।
- **"Inactive" वाला हिस्सा**: नए log में नहीं दिखता पर इतिहास में रहता है। Delete की जगह यही बेहतर है।
- **"Parent / sub-code" वाला हिस्सा**: बड़ा कारण और उसके नीचे विस्तृत कारण।

**आम दिक्कतें और हल**
- "Access denied — production.manage चाहिए (OWNER या ADMIN)" — आपका रोल कारण नहीं बदल सकता। Owner से production.manage दिलवाएँ।
- "स्क्रीन पर संदेश: "Could not add reason"" — आम तौर पर यह code पहले से लिस्ट में है, या Code/Label खाली है। दूसरा code लें।
- "स्क्रीन पर संदेश: "Delete failed"" — सर्वर ने delete नहीं माना। उसकी जगह कारण को Inactive करें।
- "स्क्रीन पर संदेश: "Failed to load reasons"" — नेटवर्क या सर्वर की दिक्कत। "Refresh" दबाएँ।

**अटक गए तो**
1. Operator को कारण न मिले तो देखें वह Active है और सही टैब (scrap या downtime) में है।
2. जिस wastage limit पर कारण ज़रूरी होता है वह Company Profile → Production में है।

जुड़े पेज: /system/company-profile, /production/machine-selector, /maintenance/faults, /analytics/scrap

### Reorder & safety stock policy (दोबारा मँगाने और safety stock की नीति) (/system/reorder-policy)
स्क्रीन का पता: /system/reorder-policy · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=system-reorder-policy&lang=hi

हर material के लिए reorder point, safety stock और lead days तय करें, और low-stock scan चलाएँ।

जब कोई material बार-बार खत्म हो, नया material जुड़े, या महीने की खरीद योजना से पहले खोलें। Reorder point से नीचे जाने पर low-stock alert बनता है; safety stock से नीचे HIGH निशान। Alert Inventory Alerts में दिखते हैं और purchase order की ज़रूरत बताते हैं।

**शुरू करने से पहले**
- Owner/Admin/Super Admin, या materials.view / materials.manage / inventory.manage।
- Material master में बने हों (film, granule, ink, adhesive, packaging…)।

**स्टेप बाय स्टेप**
1. Tile पढ़ें: "Materials", "Coverage" (कितनों की policy है), "Below reorder", "Below safety"।
2. "Filter" इस्तेमाल करें: "Category" चुनें, "Search code or name" में लिखें, या "Only materials without policy" टिक करें।
3. टेबल की row में "Reorder qty", "Safety stock" और "Lead days" भरें।
4. उसी row पर "Save" दबाएँ। "Saved — <code>: policy updated." दिखेगा।
5. अभी सारा stock जाँचने के लिए "Run reorder scan" दबाएँ; संदेश में scanned / raised / resolved दिखेगा।

**स्क्रीन पर क्या है**
- **"Material / Category" वाला हिस्सा**: Material code, नाम और master category।
- **"Stock" वाला हिस्सा**: अभी का stock; reorder या safety से कम हो तो निशान।
- **"Reorder qty" वाला हिस्सा**: वह stock स्तर जिस पर low-stock alert बनता है।
- **"Safety stock" वाला हिस्सा**: न्यूनतम buffer। इससे नीचे alert HIGH होता है।
- **"Lead days" वाला हिस्सा**: Vendor आम तौर पर कितने दिन में देता है; कब order करें यह तय करने में मदद।
- **"Last alert" वाला हिस्सा**: इस material का आख़िरी alert कब बना।

**आम दिक्कतें और हल**
- "स्क्रीन पर संदेश: "Save failed"" — कोई value सही नंबर नहीं है या आपके पास materials.manage/inventory.manage नहीं है। ठीक करें या Owner से पूछें।
- "स्क्रीन पर संदेश: "Scan failed"" — Scan नहीं चल सका (सर्वर व्यस्त या अनुमति नहीं)। एक मिनट बाद फिर करें।
- "स्क्रीन पर संदेश: "No materials match the current filter."" — Search और category हटाएँ, "Only materials without policy" अनटिक करें।

**अटक गए तो**
1. रोज़ अपने-आप scan भी चलता है (06:00); "Run reorder scan" सिर्फ़ तुरंत जाँच के लिए है।
2. GRN से stock आने के बाद alert हटाने के लिए scan फिर चलाएँ।

जुड़े पेज: /inventory/alerts, /procurement/purchase-orders/new, /analytics/mrp, /dashboard/inventory

**अभी नहीं होता / ध्यान दें**
- Low-stock alert से purchase order अपने-आप नहीं बनता; खरीदार को PO खुद बनाना होता है।

### Report Center (रिपोर्ट केंद्र) (/system/report-center)
स्क्रीन का पता: /system/report-center · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=system-report-center&lang=hi

Daily report pack चालू या बंद करें, अभी pack बनाएँ, और archive से pack (PDF और detail workbook) डाउनलोड करें।

Daily pack archive में बनते हैं और Owner/Admin को notification bell में सूचना जाती है। Email भेजना और हर pack का schedule जानबूझकर हटाया गया है। कौन-से pack चलें यह चुनने, अभी एक बनाने, या audit के लिए पुराना pack निकालने के लिए यह पेज खोलें।

**शुरू करने से पहले**
- analytics.view या analytics.manage वाले Owner/Admin/Super Admin (report admin)।

**स्टेप बाय स्टेप**
1. Tile देखें: "Active daily packs", "Successful archives", "Archive shelf", "Stored PDF size"।
2. "Daily packs" में हर pack को Active या Paused करें।
3. "Save active packs" दबाएँ। "Report center saved" दिखेगा।
4. अभी pack बनाने के लिए उस पर "Generate now" दबाएँ। "Daily pack generated" दिखेगा और Owner/Admin को in-app सूचना जाएगी।
5. "Archive shelf — Recent generated packs" (पिछले 45 दिन) में "Preview", "Download PDF" या "Detail workbook" दबाएँ।
6. लिस्ट फिर लोड करने के लिए "Refresh archive" दबाएँ।

**स्क्रीन पर क्या है**
- **"Active / Paused switch" वाला हिस्सा**: Active pack अगले daily archive cycle में शामिल होते हैं।
- **"Latest status / Latest archive" वाला हिस्सा**: उस pack के आख़िरी run का नतीजा और समय।
- **"Inbox audience" वाला हिस्सा**: Bell में किसे बताया जाता है: Owner और Admin।
- **"Stored PDF size" वाला हिस्सा**: हाल के समय में सफल archive की जगह (disk)।

**आम दिक्कतें और हल**
- "स्क्रीन पर संदेश: "Report Center Restricted"" — Archive सिर्फ़ report admin देख सकते हैं। Owner से analytics.view माँगें।
- "स्क्रीन पर संदेश: "Could not generate report pack"" — Pack नहीं बना (संदेश में कारण)। बाद में फिर करें; बार-बार हो तो System Health देखें।
- "स्क्रीन पर संदेश: "No archived report packs yet."" — पिछले 45 दिन में कोई pack नहीं चला। एक को Active करके "Generate now" दबाएँ।

**अटक गए तो**
1. सुबह pack न आए तो देखें वह Active है और उसका Latest status क्या है।
2. Analytics स्क्रीन Reports Hub में हैं; यह center सिर्फ़ archive बनाता और रखता है।

जुड़े पेज: /system/settings, /analytics, /analytics/costing, /dashboard/admin, /system/audit

**अभी नहीं होता / ध्यान दें**
- Report pack email या अलग-अलग schedule नहीं हो सकते; वे सिर्फ़ archive और Owner/Admin bell में जाते हैं।

### Role Matrix (रोल की अनुमति तालिका) (/system/role-matrix)
स्क्रीन का पता: /system/role-matrix · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=system-role-matrix&lang=hi

एक रोल चुनें और टिक करें कि उसे default में कौन-सी permissions मिलें। उस रोल के हर यूज़र को वे मिलती हैं।

जब पूरे रोल की पहुँच बढ़ानी या घटानी हो तब खोलें, जैसे हर Store यूज़र को "Bills & documents" देना या Sales से कोई पेज हटाना। सिर्फ़ एक व्यक्ति के लिए User Management में उसके "Extra access overrides" इस्तेमाल करें।

**शुरू करने से पहले**
- Owner/Admin/Super Admin, या rbac.view (देखने) / rbac.manage (सेव करने) के लिए।

**स्टेप बाय स्टेप**
1. "Select role" में रोल चुनें।
2. OWNER/ADMIN/SUPER_ADMIN के लिए पहले "System role lock" का unlock चालू करें; इन रोल को बदलने से पहले unlock ज़रूरी है।
3. चाहें तो "Quick Presets" लगाएँ: "Read-only preset" या "Floor ops preset" (ये सिर्फ़ permission जोड़ते हैं)।
4. "Search permission..." से खोजें, "Module" से छाँटें, permission टिक या अनटिक करें। "Selected only" सिर्फ़ टिक वाली दिखाता है; "Add visible" / "Remove visible extras" छँटी लिस्ट पर काम करते हैं।
5. Badge देखें: "Unsaved changes" या "All changes saved"।
6. "Save Matrix" दबाएँ। "Role matrix updated" और बदले गए रोल दिखेंगे।
7. "Reset to baseline" उस रोल के सभी custom जोड़ हटाता है (पुष्टि पूछता है)। "Sync Defaults" सभी रोल पर built-in default फिर लगाता है।

**स्क्रीन पर क्या है**
- **"Easy Mode" वाला हिस्सा**: Preset और समूह वाली आसान view; पूरी लिस्ट के लिए बंद करें।
- **"Locked" वाला हिस्सा**: System role का हिस्सा, यहाँ से हटाई नहीं जा सकती।
- **"Bills & documents group" वाला हिस्सा**: documents.*, gatepass.manage, outward.reconcile अधिकार। Store के पास default; Owner/Admin के पास हमेशा; Watchman के पास कभी नहीं।
- **"Unticking" वाला हिस्सा**: अनटिक करके save करने से permission सच में हटती है, built-in default भी। यूज़र का अपना override फिर भी लागू रहता है।

**आम दिक्कतें और हल**
- "स्क्रीन पर संदेश: "System role editing is locked. Enable unlock to modify this role."" — आपने OWNER/ADMIN/SUPER_ADMIN चुना है। पहले unlock चालू करें।
- "स्क्रीन पर संदेश: "Save failed"" — आपके पास rbac.manage नहीं है या सर्वर ने कोई code नहीं माना। संदेश पढ़कर फिर करें।
- "No change — preset ने कुछ नहीं जोड़ा" — रोल के पास उस preset की सारी permission पहले से हैं।

**अटक गए तो**
1. Save के बाद भी यूज़र पेज न खोल पाए तो उसे sign out करके फिर login करवाएँ।
2. हटाया गया पेज यूज़र फिर भी खोल ले तो User Management में उसके personal override देखें।

जुड़े पेज: /system/users, /system/governance, /system/audit

### System Settings — Report delivery settings removed (रिपोर्ट भेजने की settings हटाई गईं) (/system/settings)
स्क्रीन का पता: /system/settings · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=system-settings&lang=hi

सूचना पेज: daily report email और schedule की settings हटा दी गई हैं। यह report pack की गिनती दिखाता है और Report Center का लिंक देता है।

जब कोई पुराना email schedule ढूँढे तब खोलें। अब रिपोर्ट archive में बनती हैं और Owner/Admin को in-app बताया जाता है; pack चालू करने या बनाने के लिए Report Center इस्तेमाल करें।

**शुरू करने से पहले**
- Owner या Admin (page.system.settings.view)।

**स्टेप बाय स्टेप**
1. तीन tile पढ़ें: "Active daily packs", "Successful archives" (30 दिन में आख़िरी 8 run), "Inbox audience" (OWNER · ADMIN)।
2. गिनती फिर लोड करने के लिए "Refresh status" दबाएँ।
3. Pack संभालने के लिए "Open Report Center" या "Open archive controls" दबाएँ।
4. Analytics रिपोर्ट के लिए "Open Reports Hub" दबाएँ।

**स्क्रीन पर क्या है**
- **"Active daily packs" वाला हिस्सा**: Report Center में Active किए गए pack।
- **"Successful archives" वाला हिस्सा**: हाल के SUCCEEDED run।
- **"Inbox audience" वाला हिस्सा**: हमेशा OWNER · ADMIN।

**आम दिक्कतें और हल**
- "गिनती 0 दिखती है" — कोई pack Active नहीं है या analytics अनुमति नहीं है। Report Center में जाँचें।

**अटक गए तो**
1. बदलने लायक सब Report Center में है; इस पेज पर सेव करने को कुछ नहीं है।

जुड़े पेज: /system/report-center, /analytics

**अभी नहीं होता / ध्यान दें**
- Settings पेज पर अब कोई setting नहीं है; यह सिर्फ़ बताता है कि report email schedule हटाए गए और Report Center का लिंक देता है।

### Shift Timing — Fixed shift windows (तय shift का समय) (/system/shift-timing)
स्क्रीन का पता: /system/shift-timing · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=system-shift-timing&lang=hi

हर प्लांट की shift (code, नाम, शुरू, खत्म) तय करें। Issue, return, count, WCM और machine log की shift घटना के समय से अपने-आप तय होती है।

जब प्लांट में shift शुरू हो, बदले या बंद हो तब खोलें। Operator कभी shift खुद नहीं चुनते, इसलिए गलत समय रखने से रिपोर्ट में output गलत shift में जाएगा।

**शुरू करने से पहले**
- Owner/Admin (factory.view / factory.manage)। Plant, Factory → Plants में बना हो।

**स्टेप बाय स्टेप**
1. "Plant" चुनें।
2. "Add shift" में "Code" (जैसे A), "Name" (जैसे Morning), "Start time", "End time" भरें।
3. "Crosses midnight" देखें — खत्म होने का समय शुरू से पहले हो तो अपने-आप टिक होता है; बगल में अवधि दिखती है।
4. "Priority" (default 100) रखें और "Active" चालू रखें।
5. "Add shift" दबाएँ (बदलते समय "Save shift")।
6. लिस्ट में "Edit" या delete आइकन (पूछता है "Delete shift <code>?") इस्तेमाल करें।

**स्क्रीन पर क्या है**
- **"Code / Name" वाला हिस्सा**: छोटा code (capital में) और पढ़ने लायक नाम।
- **"Start time / End time" वाला हिस्सा**: 24 घंटे के समय में shift।
- **"Crosses midnight" वाला हिस्सा**: रात की shift जो अगले दिन खत्म होती है।
- **"Priority" वाला हिस्सा**: दो shift एक-दूसरे पर चढ़ें तो कौन-सी माने, यह तय करता है।
- **"Active" वाला हिस्सा**: बंद shift सेव रहती है पर नए समय से shift तय करने में इस्तेमाल नहीं होती।
- **"Table: Shift, Window, Priority, Status, Actions" वाला हिस्सा**: चुने गए प्लांट की सभी shift।

**आम दिक्कतें और हल**
- "स्क्रीन पर संदेश: "Shift save failed"" — Code या नाम खाली है, code प्लांट में पहले से है, या समय गलत है। ठीक करके फिर सेव करें।
- "स्क्रीन पर संदेश: "Delete failed"" — सर्वर ने मना किया। उसकी जगह shift को inactive करें।
- "स्क्रीन पर संदेश: "No shifts configured for this plant."" — कम से कम एक shift जोड़ें ताकि log को shift मिले।

**अटक गए तो**
1. बटन धूसर रहे तो Plant, Code, Name और दोनों समय भरें।
2. समय बदलने का असर सिर्फ़ नए log पर; पुराने log की shift वही रहती है।

जुड़े पेज: /factory/plants, /production/work-center, /production/machine-selector, /analytics/reports/shift-performance

**अभी नहीं होता / ध्यान दें**
- Shift का समय बदलने से पहले दर्ज log की shift नहीं बदलती।

### User Management (यूज़र प्रबंधन) (/system/users)
स्क्रीन का पता: /system/users · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=system-users&lang=hi

Login कर सकने वाले हर व्यक्ति की लिस्ट: रोल, owner flag, active स्थिति और personal override। यहीं से नया यूज़र जोड़ें या खोलें।

जब कोई नया आए, चला जाए, काम बदले, password भूले या कोई पेज न खोल पाए तब खोलें। रोल बुनियाद तय करता है, override एक-बार की पहुँच देता है, और effective view दिखाता है कि व्यक्ति असल में क्या कर सकता है।

**शुरू करने से पहले**
- Owner/Admin/Super Admin, या users.view / rbac.view। बदलने के लिए rbac.manage।

**स्टेप बाय स्टेप**
1. Tile पढ़ें: "Total users", "Active", "Owners", "With overrides" — ये filter भी हैं ("All")।
2. "Search by name, email or role…" से खोजें।
3. Editor खोलने के लिए यूज़र की row पर क्लिक करें (/system/users/<id>)।
4. नया खाता बनाने के लिए "Add user" दबाएँ।
5. पूरे रोल की पहुँच बदलने के लिए "Role matrix" दबाएँ।

**स्क्रीन पर क्या है**
- **"Total users / Active / Owners / With overrides" वाला हिस्सा**: लिस्ट की गिनती और जल्दी filter।
- **"Owner badge" वाला हिस्सा**: खाते पर owner flag है (permission जाँच नहीं होती)।
- **"Overrides count" वाला हिस्सा**: रोल के अलावा यूज़र की कितनी extra permission हैं।

**आम दिक्कतें और हल**
- "Access denied — user registry देखने के लिए rbac.view चाहिए।" — Owner से rbac.view दिलवाएँ।
- "स्क्रीन पर संदेश: "No users match — Try clearing filters."" — Search खाली करें और "All" पर क्लिक करें।

**अटक गए तो**
1. जो चला गया: उसे खोलें और "Active" बंद करें; इतिहास बना रहता है।
2. बहुत बार गलत login से खाता 15 मिनट के लिए बंद होता है; ज़रूरत हो तो editor से password reset करें।

जुड़े पेज: /system/users/new, /system/users/[id], /system/role-matrix, /system/governance

**अभी नहीं होता / ध्यान दें**
- यूज़र delete करने का विकल्प नहीं है; छोड़ने वालों को inactive करना होता है।

### यूज़र बदलें (Edit user) (/system/users/[id])
स्क्रीन का पता: /system/users/[id] · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=system-users-id&lang=hi

एक यूज़र की पहचान, active स्थिति, रोल, owner flag, extra override, work-centre या machine scope बदलें, और password reset करें।

User Management से तब खोलें जब किसी का काम बदले, एक extra पेज चाहिए, नई machine या work centre मिलें, वह चला जाए, या password भूल जाए।

**शुरू करने से पहले**
- बदलने के लिए rbac.manage (Owner/Admin); इसके बिना पेज सिर्फ़ पढ़ने के लिए है। Owner flag सिर्फ़ Owner बदल सकता है।
- Work centre और machine, Factory set-up में बने हों।

**स्टेप बाय स्टेप**
1. "Identity" (login और संपर्क) और "Active" switch देखें।
2. एक "Base role" card चुनें।
3. Work Center Manager के लिए "Work-center scope" में work centre टिक करें; Machine Operator के लिए "Machines this operator runs" में machine; Watchman के लिए "Gate assignment" में प्लांट।
4. "Extra access overrides" में एक-बार की पहुँच जोड़ें (permission, पेज, module खोजें; chip पर क्लिक)।
5. "Access summary" देखें और "Save changes" दबाएँ। "User saved" दिखेगा।
6. Password reset के लिए "Reset password" खोलें, "New password" (कम से कम 8 अक्षर) लिखें और पक्का करें। यूज़र को फिर login करना होगा।
7. वापस जाने के लिए "Back to users" दबाएँ।

**स्क्रीन पर क्या है**
- **"Username *" वाला हिस्सा**: Login नाम, जैसे priya.s। ज़रूरी।
- **"Email *" वाला हिस्सा**: हर यूज़र के लिए ज़रूरी।
- **"First name / Last name / Phone" वाला हिस्सा**: लिस्ट और audit में दिखने वाली जानकारी।
- **"Active" वाला हिस्सा**: बंद करने पर इस खाते से कोई login नहीं होगा। जो व्यक्ति चला गया उसे हटाने की जगह यही करें।
- **"Owner flag" वाला हिस्सा**: सारी permission जाँच छोड़ देता है। सिर्फ़ मौजूदा Owner बदल सकता है; आख़िरी active owner से यह नहीं हटता।
- **"Base role" वाला हिस्सा**: एक रोल card: बुनियादी permission और शुरुआती पेज तय करता है।
- **"Extra access overrides" वाला हिस्सा**: सिर्फ़ इस यूज़र की अतिरिक्त permission। हरे chip override हैं; हल्के chip रोल से पहले ही मिलते हैं।
- **"Work-center scope" वाला हिस्सा**: Work Center Manager के लिए ज़रूरी; उनकी machines इन्हीं work centre से आती हैं।
- **"Machines this operator runs" वाला हिस्सा**: Machine Operator के लिए ज़रूरी; operator सिर्फ़ इन्हीं machines को देखता और चलाता है।
- **"Gate assignment" वाला हिस्सा**: सिर्फ़ Watchman: किन प्लांट के gate पर यह watchman entry कर सकता है।
- **"Access summary" वाला हिस्सा**: Base role, extra override और असली (effective) permission — सेव से पहले देखें।

**आम दिक्कतें और हल**
- "स्क्रीन पर संदेश: "Work center required — Work Center Manager users must be assigned to at least one work center."" — "Work-center scope" में कम से कम एक work centre टिक करें।
- "स्क्रीन पर संदेश: "Machine required — A Machine Operator must be given at least one machine to run."" — "Machines this operator runs" में कम से कम एक machine टिक करें।
- "स्क्रीन पर संदेश: "A Machine Operator is given machines, not work centres. Assign machines instead."" — Operator को machine मिलती है, manager को work centre। Work centre हटाएँ।
- "स्क्रीन पर संदेश: "Only an owner can grant owner rights. / Only an owner can change an owner account."" — मौजूदा Owner से यह बदलाव करवाएँ।
- "स्क्रीन पर संदेश: "This is the last active owner account; add another owner first."" — इसे बंद या नीचे करने से पहले किसी दूसरे यूज़र को Owner बनाएँ।
- "स्क्रीन पर संदेश: "Watchman users cannot be owners. / Watchman permissions are limited to the gate terminal."" — Watchman को सिर्फ़ gate मिलता है; override और owner flag हटाएँ।
- "स्क्रीन पर संदेश: "Permission '<code>' is not assignable as user-level override."" — यह permission सिर्फ़ रोल से मिलती है। Role Matrix में बदलें।
- "स्क्रीन पर संदेश: "Reset failed"" — नया password बहुत छोटा, बहुत आम या सिर्फ़ अंकों का है। मज़बूत password लें।

**अटक गए तो**
1. यूज़र को पुराने पेज ही दिखें तो sign out करके फिर login करवाएँ।
2. एक ही रोल के कई यूज़र बदलने हों तो हर यूज़र की जगह Role Matrix बदलें।
3. जिस operator को कोई job न दिखे, अक्सर यहाँ उसकी कोई machine टिक नहीं होती।

जुड़े पेज: /system/users, /system/role-matrix, /factory/work-centers, /factory/machines, /system/audit

**अभी नहीं होता / ध्यान दें**
- Password reset में admin खुद password लिखता है; email से reset लिंक नहीं है।

### नया यूज़र (Add user) (/system/users/new)
स्क्रीन का पता: /system/users/new · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=system-users-new&lang=hi

नया login खाता बनाएँ: पहचान, शुरुआती password, base role, scope और कोई extra override।

जब कोई नया व्यक्ति जुड़े तब User Management पर "Add user" से खोलें। उसे username और शुरुआती password दें; वह बाद में My Profile → Security में बदल सकता है।

**शुरू करने से पहले**
- rbac.manage (Owner/Admin)।
- WCM या operator के लिए: work centre / machine पहले से बने हों।

**स्टेप बाय स्टेप**
1. "Username *", "Email *", "First name", "Last name", "Phone" भरें।
2. "Initial password *" लिखें — कम से कम 8 अक्षर, सिर्फ़ अंक नहीं।
3. "Base role" card चुनें।
4. Scope भरें: work centre (WCM), machine (operator) या gate प्लांट (watchman)।
5. "Extra access overrides" तभी जोड़ें जब व्यक्ति को रोल से ज़्यादा चाहिए।
6. "Create user" दबाएँ। "User created" दिखेगा।

**स्क्रीन पर क्या है**
- **"Username *" वाला हिस्सा**: Login नाम, जैसे priya.s। ज़रूरी।
- **"Email *" वाला हिस्सा**: हर यूज़र के लिए ज़रूरी।
- **"First name / Last name / Phone" वाला हिस्सा**: लिस्ट और audit में दिखने वाली जानकारी।
- **"Initial password *" वाला हिस्सा**: कम से कम 8 अक्षर, सिर्फ़ अंक नहीं; आम password से भी जाँचा जाता है।
- **"Owner flag" वाला हिस्सा**: सारी permission जाँच छोड़ देता है। सिर्फ़ मौजूदा Owner बदल सकता है; आख़िरी active owner से यह नहीं हटता।
- **"Base role" वाला हिस्सा**: एक रोल card: बुनियादी permission और शुरुआती पेज तय करता है।
- **"Extra access overrides" वाला हिस्सा**: सिर्फ़ इस यूज़र की अतिरिक्त permission। हरे chip override हैं; हल्के chip रोल से पहले ही मिलते हैं।
- **"Work-center scope" वाला हिस्सा**: Work Center Manager के लिए ज़रूरी; उनकी machines इन्हीं work centre से आती हैं।
- **"Machines this operator runs" वाला हिस्सा**: Machine Operator के लिए ज़रूरी; operator सिर्फ़ इन्हीं machines को देखता और चलाता है।
- **"Gate assignment" वाला हिस्सा**: सिर्फ़ Watchman: किन प्लांट के gate पर यह watchman entry कर सकता है।
- **"Access summary" वाला हिस्सा**: Base role, extra override और असली (effective) permission — सेव से पहले देखें।

**आम दिक्कतें और हल**
- "स्क्रीन पर संदेश: "Password required — Enter an initial password for the new user."" — शुरुआती password लिखें।
- "स्क्रीन पर संदेश: "The initial password must be at least 8 characters. / cannot be only numbers."" — अक्षरों के साथ 8 या ज़्यादा characters लें।
- "स्क्रीन पर संदेश: "Email is required."" — Email भरें।
- "स्क्रीन पर संदेश: "Create failed"" — Username या email पहले से इस्तेमाल में है, या scope का नियम टूटा (संदेश बताएगा)। ठीक करके फिर करें।
- "स्क्रीन पर संदेश: "Work center required — Work Center Manager users must be assigned to at least one work center."" — "Work-center scope" में कम से कम एक work centre टिक करें।
- "स्क्रीन पर संदेश: "Machine required — A Machine Operator must be given at least one machine to run."" — "Machines this operator runs" में कम से कम एक machine टिक करें।
- "स्क्रीन पर संदेश: "A Machine Operator is given machines, not work centres. Assign machines instead."" — Operator को machine मिलती है, manager को work centre। Work centre हटाएँ।

**अटक गए तो**
1. व्यक्ति login न कर पाए तो देखें "Active" चालू है और username वैसा ही है जैसा बनाया।
2. इन स्क्रीन पर delete बटन नहीं है; पहुँच रोकने के लिए Active बंद करें।

जुड़े पेज: /system/users, /system/role-matrix, /profile
