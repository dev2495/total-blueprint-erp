# Analytics and reports

## Overview (English)
# Analytics module (TPP ERP)

## What it does
Analytics turns what the floor, store, sales and gate record into numbers for decisions. It does not create stock or orders itself, except three working tools: the **Costing Center** (monthly cost close), **Process Rates** (hourly cost estimates) and **MRP Center** (material shortage planning and draft purchase orders). Every other analytics page is read-only.

## Screens and how they connect
- **Analytics and Reports Hub** (/analytics): live headline cards (OEE, Scrap Rate, Availability, Efficiency, Revenue, Output), roll reuse pools, POD stock, trends and the list of reports you may open. Admins/owners generate the daily report pack here.
- **Reports Hub** (/analytics/reports): the report library by area — Production, Quality & materials, Sales & logistics, Inventory & finance, and Gate & Visitors for permitted users — plus "Generate daily pack" and "Recent report runs".
- **Report pages** (/analytics/reports/production, oee, downtime, shift-performance, operator, scrap, material-variance, mrp, ink-intelligence, sales, dispatch, interplant, inventory, inventory-lineage, costing, gate): all share one layout — period (7D/30D/90D/MTD/FY/Custom), Plant, Process, Shift filters; coverage chips; KPI tiles with targets; Trend; Insights; breakdown panels; a detail table with "Filter rows", sorting, "CSV"; and "PDF" export. Some show "Turn this report into action" links.
- **Trading Pulse** (/analytics/reports/trading): traded goods revenue, margin, slow movers.
- **Executive Control Center** (/analytics/kpis; /analytics/kpi redirects here): the owner's whole-business deck with day/week/month/year timeframes.
- **Costing Center** (/analytics/costing), **Order Profitability** (/analytics/orders/costing) and one line's profitability (/analytics/orders/[id]/costing), **Process Rates** (/analytics/process-rates).
- **MRP Center** (/analytics/mrp).
- **Scrap Center** (/analytics/scrap): machine scrap plus store write-offs.
- **Inventory Health Matrix** (/analytics/inventory-health) and **Inventory Snapshot History** (/analytics/inventory-history).
- **Capability Matrix** (/analytics/capability-matrix): what the ERP supports today.

## Where the numbers come from
- Output, scrap and downtime come from the work-center terminal. A pause on the terminal writes a downtime record with a reason. Pieces are converted to KG only when the sales line has a unit weight.
- Yield = good ÷ (good + scrap). Scrap rate = 100 − yield. Targets: scrap 5%, yield 95%.
- OEE (report) = availability × performance × quality per machine. Availability uses 24-hour calendar days minus downtime; performance needs the machine's standard rate (kg/h); quality = good ÷ (good + scrap). Target 85%. The hub's OEE card is a quicker estimate (7-day availability × quality) and will not match.
- Material variance = consumed − theoretical (recipe). Planning accuracy = theoretical ÷ consumed; issue accuracy = planned issue ÷ issued; waste factor = (required − theoretical) ÷ theoretical.
- Costing: each plant-month pool (electricity + labour = conversion; overhead + maintenance + service burden = overhead) is divided by the productive running hours of that cost group in that month to give ₹/hour. Job cost = actual material (issued − returned × material rate) + hours × conversion rate + hours × overhead rate. When actuals are missing, order cost falls back to BOM × rate and (order KG ÷ 150) hours × process rate (₹800/hour default). Coverage = how many of the three parts (material, conversion, overhead) are actual. Margin = selling price − total cost.
- MRP: demand = open quantity of confirmed sales lines (from their frozen BOM) + planned stock orders; supply = bulk + packaging + AVAILABLE rolls + packaging WIP; shortage = demand − supply per material. Priority HIGH at 500 or more, MEDIUM 100–499, LOW below 100. Open purchase orders are not counted as supply. The engine runs nightly at 02:00 IST and on "Run planning engine".
- Inventory snapshots are taken nightly at 23:45 IST (day close).

## Main flows
1. **Daily review**: open the Hub → check cards → open the report with a red or "Pending" figure → use "Turn this report into action".
2. **Month close**: Costing Center → create plant month → enter totals → allocate or edit groups → "Mark reviewed" → "Lock month" → check Order Profitability.
3. **Material planning**: MRP Center → "Run planning engine" → "Material gaps" → "Draft actions" → "Create PO" or "Draft all HIGH" → finish the PO in Purchase orders.
4. **Stock health**: Inventory Health Matrix → "Run smart audit" → fix in Inventory → "Resolve Event" with a note.

## Rules and limits
- Reports show only what your role is allowed; the Gate report needs gate.reports (admins/owners have it) and never opens for watchmen.
- The Process filter on report pages is not applied by the server yet.
- Inventory report figures are current stock and ignore dates.
- Locked cost months cannot be edited; there is no unlock button.
- Missing material rates count as zero cost and lower coverage; add material cost snapshots.
- Figures never show a fake zero: when data is missing you see "Pending", "—", "N/A" or a yellow warning.

## Who does what
- OWNER/ADMIN/SUPER_ADMIN: everything, including month close, process rates, daily packs and the gate report.
- PLANT_MANAGER: hub, KPIs, production/quality/logistics reports, scrap center.
- PLANNER: MRP Center, material reports, inventory pages, capability matrix.
- STORE: inventory health, history and inventory reports.
- SALES: sales report and Trading Pulse. DISPATCH: dispatch and inter-plant reports. WORK_CENTER_MANAGER: production, OEE, downtime, scrap, inventory health.

## Problems and fixes
- "Pending" on hub cards: nothing logged today or this week — make sure operators log output.
- OEE or performance 0%: the machine has no standard rate (kg/h) — set it in the machine master.
- "No shift schedule configured.": define plant shifts.
- "No material actuals captured.": store has not posted issues/consumption against jobs.
- Low actual-cost coverage or high "Unabsorbed pool": operators are not starting/stopping jobs, a machine has no cost group, or the month pool is missing.
- MRP keeps showing a shortage after ordering: open POs are not supply; it clears after the GRN.
- "Locked cost pool months and their lines cannot be changed.": the month is closed; ask an admin.
- "Gate report not available for this account": ask an admin/owner for the Gate reports pack.
- Example: order SO-2026-0123 for ABC Foods shows a loss — open Order Profitability, check whether cost is estimated (BOM × rate) and whether the material rate is missing, then press "Refresh Deep-Dive" after production is logged.

## सारांश (हिंदी)
# Analytics मॉड्यूल (TPP ERP)

## यह क्या करता है
Analytics, floor, store, sales और gate पर दर्ज जानकारी को फैसले के लिए आँकड़ों में बदलता है। यह खुद stock या order नहीं बनाता, सिवाय तीन काम के औज़ारों के: **Costing Center** (महीने का cost close), **Process Rates** (प्रति घंटा लागत का अनुमान) और **MRP Center** (material की कमी की योजना और draft purchase order)। बाकी सभी analytics पेज केवल पढ़ने के लिए हैं।

## पेज और उनका आपसी संबंध
- **Analytics and Reports Hub** (/analytics): live कार्ड (OEE, Scrap Rate, Availability, Efficiency, Revenue, Output), roll reuse pool, POD stock, ट्रेंड और आपकी खुलने वाली रिपोर्टें। Admin/Owner यहीं daily report pack बनाते हैं।
- **Reports Hub** (/analytics/reports): क्षेत्र-वार रिपोर्ट सूची — Production, Quality & materials, Sales & logistics, Inventory & finance, और अनुमति हो तो Gate & Visitors — साथ में "Generate daily pack" और "Recent report runs"।
- **रिपोर्ट पेज** (production, oee, downtime, shift-performance, operator, scrap, material-variance, mrp, ink-intelligence, sales, dispatch, interplant, inventory, inventory-lineage, costing, gate): सबका एक जैसा ढाँचा — अवधि (7D/30D/90D/MTD/FY/Custom), Plant, Process, Shift filter; कवरेज chips; target वाली KPI tiles; Trend; Insights; ब्योरे के panel; "Filter rows", sort और "CSV" वाली detail table; और "PDF"। कुछ में "Turn this report into action" link होते हैं।
- **Trading Pulse** (/analytics/reports/trading): trading माल की कमाई, margin, धीमे बिकने वाले माल।
- **Executive Control Center** (/analytics/kpis; /analytics/kpi यहीं भेजता है): मालिक का पूरा deck, day/week/month/year के साथ।
- **Costing Center**, **Order Profitability**, एक line का मुनाफ़ा पेज, **Process Rates**।
- **MRP Center** (/analytics/mrp)।
- **Scrap Center** (/analytics/scrap): मशीन scrap और store write-off।
- **Inventory Health Matrix** और **Inventory Snapshot History**।
- **Capability Matrix**: ERP आज क्या कर सकता है।

## आँकड़े कहाँ से आते हैं
- Output, scrap और downtime work-center terminal से आते हैं। Terminal पर pause करने से कारण के साथ downtime record बनता है। Pieces तभी KG में बदलते हैं जब sales line पर unit weight हो।
- Yield = अच्छा ÷ (अच्छा + scrap)। Scrap rate = 100 − yield। Target: scrap 5%, yield 95%।
- OEE (रिपोर्ट) = हर मशीन का availability × performance × quality। Availability 24 घंटे के कैलेंडर दिन में से downtime घटाकर; performance के लिए मशीन का standard rate (kg/h) चाहिए; quality = अच्छा ÷ (अच्छा + scrap)। Target 85%। Hub का OEE कार्ड जल्दी वाला अनुमान है (7 दिन availability × quality), मेल नहीं खाएगा।
- Material variance = खपत − theoretical (recipe)। Planning accuracy = theoretical ÷ खपत; issue accuracy = planned issue ÷ issue; waste factor = (required − theoretical) ÷ theoretical।
- Costing: हर plant-month pool (बिजली + labour = conversion; overhead + maintenance + service burden = overhead) को उस महीने उस cost group के चलने के घंटों से बाँटकर ₹/घंटा बनता है। Job cost = असली material (issue − वापसी × material rate) + घंटे × conversion rate + घंटे × overhead rate। असली न हो तो order cost BOM × rate और (order KG ÷ 150) घंटे × process rate (default ₹800/घंटा) से अनुमान लगाता है। Coverage = तीन हिस्सों (material, conversion, overhead) में से कितने असली। Margin = selling price − कुल लागत।
- MRP: माँग = पक्की sales lines की बाकी मात्रा (उनके frozen BOM से) + planned stock order; supply = bulk + packaging + AVAILABLE roll + packaging WIP; कमी = हर material की माँग − supply। 500 या ज़्यादा HIGH, 100–499 MEDIUM, 100 से कम LOW। खुले purchase order supply में नहीं गिने जाते। Engine रात 02:00 IST पर और "Run planning engine" दबाने पर चलता है।
- Inventory snapshot रात 23:45 IST पर (दिन का close) लिया जाता है।

## मुख्य काम क्रम से
1. **रोज़ की जाँच**: Hub खोलें → कार्ड देखें → लाल या "Pending" वाले आँकड़े की रिपोर्ट खोलें → "Turn this report into action" इस्तेमाल करें।
2. **Month close**: Costing Center → plant month बनाएँ → totals भरें → allocate करें या group भरें → "Mark reviewed" → "Lock month" → Order Profitability देखें।
3. **Material योजना**: MRP Center → "Run planning engine" → "Material gaps" → "Draft actions" → "Create PO" या "Draft all HIGH" → Purchase orders में PO पूरा करें।
4. **Stock जाँच**: Inventory Health Matrix → "Run smart audit" → Inventory में ठीक करें → नोट के साथ "Resolve Event"।

## नियम और सीमाएँ
- रिपोर्ट वही दिखती है जिसकी आपके role को अनुमति है; Gate रिपोर्ट के लिए gate.reports चाहिए (admin/owner के पास है) और watchman के लिए कभी नहीं खुलती।
- रिपोर्ट पेज का Process filter अभी server लागू नहीं करता।
- Inventory रिपोर्ट के आँकड़े अभी के stock के हैं, तारीख नहीं मानते।
- Lock हुए cost month बदले नहीं जा सकते; unlock बटन नहीं है।
- Material rate न हो तो लागत शून्य गिनी जाती है और coverage घटता है; material cost snapshot जोड़ें।
- आँकड़े कभी झूठा शून्य नहीं दिखाते: डेटा न हो तो "Pending", "—", "N/A" या पीली चेतावनी दिखती है।

## कौन क्या करता है
- OWNER/ADMIN/SUPER_ADMIN: सब कुछ, month close, process rate, daily pack और gate रिपोर्ट समेत।
- PLANT_MANAGER: hub, KPIs, production/quality/logistics रिपोर्ट, scrap center।
- PLANNER: MRP Center, material रिपोर्ट, inventory पेज, capability matrix।
- STORE: inventory health, इतिहास और inventory रिपोर्ट।
- SALES: sales रिपोर्ट और Trading Pulse। DISPATCH: dispatch और inter-plant रिपोर्ट। WORK_CENTER_MANAGER: production, OEE, downtime, scrap, inventory health।

## समस्याएँ और समाधान
- Hub कार्ड पर "Pending": आज या इस हफ़्ते कुछ दर्ज नहीं — operator से output दर्ज करवाएँ।
- OEE या performance 0%: मशीन पर standard rate (kg/h) नहीं — machine master में भरें।
- "No shift schedule configured.": plant की shift बनाएँ।
- "No material actuals captured.": store ने job पर issue/खपत दर्ज नहीं की।
- कम actual-cost coverage या ज़्यादा "Unabsorbed pool": operator job start/stop नहीं कर रहे, मशीन पर cost group नहीं, या महीने का pool नहीं भरा।
- Order देने के बाद भी MRP कमी दिखाए: खुले PO supply नहीं गिने जाते; GRN के बाद हटेगी।
- "Locked cost pool months and their lines cannot be changed.": महीना बंद है; admin से बात करें।
- "Gate report not available for this account": admin/owner से Gate reports pack माँगें।
- उदाहरण: ABC Foods का order SO-2026-0123 घाटा दिखा रहा है — Order Profitability खोलें, देखें cost अनुमान (BOM × rate) है या material rate गायब है, फिर production दर्ज होने के बाद "Refresh Deep-Dive" दबाएँ।

## Every screen (English)

### Analytics and Reports Hub (/analytics)
Screen address: /analytics · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=analytics

Live headline numbers for the whole plant (OEE, scrap rate, availability, efficiency, booked order value, output), roll reuse pools, POD stock, trends and the list of reports you may open.

Open it at the start of the day or before a review meeting to see if the plant is healthy, then jump into the report that needs attention. Admins and owners also generate and check the daily report pack here.

**Before you start**
- Production must be logged on the work-center terminals (output, scrap, downtime); otherwise OEE, scrap and efficiency show "Pending".
- Your role needs the Reports Hub permission (page.analytics.home.view).
- Daily report packs are configured by an admin in Report Center (/system/report-center).

**Step by step**
1. Read the six cards at the top: "OEE", "Scrap Rate", "Availability", "Efficiency", "Revenue", "Output".
2. Check "Operational KPI Pulse": each bar shows the value against its target (OEE 85, Availability 90, Efficiency 92, Scrap 2.5 or less).
3. Look at "Live Trendboard" for the last 7 days of production and the sales trend.
4. Look at "Reuse and Exception Signals" and "SKU and Customer Leaders" for open risks and top products and customers.
5. Under "Available Reports" click a report card to open it.
6. Admin/Owner: in "Report Generation Control" press "Generate <pack name> now" to archive today's pack; check it in "Run History Snapshot".
7. Press "Refresh" (top right) to reload; the page also refreshes itself every 2 minutes.

**What is on the screen**
- **OEE**: Quick plant-wide estimate = Availability × quality ÷ 100. Quality = 100 − scrap rate. It is not the same as the machine-by-machine OEE in the OEE Deep Dive report.
- **Scrap Rate**: Scrap ÷ (good output + scrap) × 100, using today's logs; if nothing was logged today it uses the last 7 days.
- **Availability**: Average over all machines of (24 h × 7 days − downtime) ÷ (24 h × 7 days). Counts calendar hours, not shift hours.
- **Efficiency**: Score = 0.6 × OEE + 0.4 × quality.
- **Revenue**: Booked order value: total of sales-order line amounts of the last 30 days (not invoiced revenue).
- **Output**: Production output in KG for the last 30 days.
- **Pending**: Shown when there is no production evidence or the source could not be read. The page never shows a fake zero.
- **Final Roll Pool / Invariant Pool / Upstream Pool**: Roll stock (KG) the planner can reuse: rolls ready as finished goods, matching intermediate rolls, and upstream rolls that can still go down the route.
- **POD Stock Target / Active POD SKUs**: Planned POD stock orders with their target KG, and how many POD SKUs and variants are active.
- **Recent Report Runs**: Latest daily report packs that were generated (admin/owner only).

**Common problems and fixes**
- "Reports Hub could not load live analytics." — The summary request failed. Cards are paused instead of showing zeros. Press "Refresh"; if it stays, tell the admin.
- "Report catalog data could not be loaded." — The list of reports did not load. Refresh the page.
- "Report activity degraded" — Report runs or pack settings could not load (often because your role is not admin/owner). Live numbers above still work.
- "No execution telemetry is recorded for the current window." — No output was logged on the machines in the period. Ask work centers to log output on the terminal.

**If stuck**
1. Press "Refresh" and wait a minute.
2. If a card says "Pending", open the matching report (Production, OEE, Scrap) to see which data is missing.
3. If you do not see a report card, your role does not have that report; ask an admin.

Related pages: /analytics/reports, /analytics/kpis, /analytics/costing, /analytics/reports/production, /analytics/reports/oee, /analytics/reports/scrap, /system/report-center

**Not done yet / watch out**
- The OEE card on the hub is a quick estimate (7-day availability × quality) and will not match the OEE Deep Dive report, which also uses machine standard rates.
- The hub has no date or plant filter on screen; it always shows fixed windows (today/7 days/30 days).
- There are two hub pages: /analytics (Analytics and Reports Hub) and /analytics/reports (Reports Hub); both list reports and daily packs, which can confuse users.

### Capability Matrix (/analytics/capability-matrix)
Screen address: /analytics/capability-matrix · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANNER, PLANT_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=analytics-capability-matrix

A read-only list of what this ERP supports today, what needs only configuration, and what would need new code.

Open it before promising a customer a new product type or process, or when planning a new master. It tells you whether the ERP can already handle it.

**Before you start**
- Nothing to set up. The list comes from a fixed file kept by the development team (docs/runbooks/capability-registry.json).

**Step by step**
1. Read the three sections in order: "Supported Today", "Config Only Extensions", "Needs New Physical Logic".
2. In each card read "What it means" and "Why".
3. Check "Examples" to match your case.
4. See "Needs only config" for master/setting work and "Needs code / module" for development work.
5. Read "Limits" before you commit to anything.

**What is on the screen**
- **Supported Today**: Works now: flexible packaging core (rolls, pouches, routes) and operational costing.
- **Config Only Extensions**: Can be done by adding masters or settings, e.g. master data extensions, report distribution.
- **Needs New Physical Logic**: Needs development: new manufacturing behaviours and new traceability models.
- **Needs only config / Needs code / module**: "Nothing extra" or "No new code needed" means the list is empty for that card.

**Common problems and fixes**
- "Capability matrix could not be loaded." — The registry file is missing on the server or the request failed. Ask the admin to check the deployment.

**If stuck**
1. Reload the page.
2. If it still fails, report it to the admin; there is nothing to fix on this page yourself.

Related pages: /analytics, /factory/plants, /engineering/routing

**Not done yet / watch out**
- The list is a static file; it is not edited from the ERP and can go out of date after new releases.
- Section colours (green/amber/red) do not show because the registry has no status codes, so all sections look the same.

### Costing Center (/analytics/costing)
Screen address: /analytics/costing · Roles: ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=analytics-costing

Monthly cost close for each plant: enter electricity, labour, overhead, maintenance and service costs, split them over cost groups, review and lock the month. Also the master of cost groups.

Open at month end (or when bills arrive) to enter the plant's monthly costs. These pools are divided by the machine running hours of that month to give a ₹/hour rate, which is charged to every job and order. Locked months cannot change.

**Before you start**
- Plants, work centers and machines exist, each with a cost group (machine override → work-center default → route-step mapping → plant default).
- At least one cost group exists ("Cost groups" view → "New Cost Group").
- Operators start/stop jobs on the terminal so running hours are recorded; without hours the pool stays "unabsorbed".

**Step by step**
1. Choose "Month close" at the top.
2. Under "Plant month" pick "Plant", "Year" and "Month", choose the entry model "Direct" (edit each group) or "Allocated" (split plant totals by %).
3. Press "Create or reopen plant month". It appears under "Recent months".
4. In "Plant month workspace" enter "Electricity", "Labor", "Overhead", "Maintenance", "Service burden" and "Month notes", then press "Save month totals".
5. Allocated mode: set "Alloc %" on each group card and press "Allocate from totals". Direct mode: type the amounts on each group card and press "Save Group" one group at a time.
6. Check "Close health" and "Margin leakage" (orders with the lowest margin).
7. Press "Mark reviewed", then "Lock month" when the numbers are final.
8. To add or edit groups switch to "Cost groups", press "New Cost Group" (or the pencil), fill "Code", "Label", "Description", "Default intensity factor", Active, then "Create Group" / "Save Group".

**What is on the screen**
- **Actual-cost coverage**: Average over order costs of how many of 3 cost parts are actual: material actually issued, conversion from running hours, overhead absorbed. 100% = fully actual; 0% = fully estimated.
- **Unabsorbed pool**: Month cost that could not be charged to jobs because the cost group had no running hours in that month.
- **Cost groups / Locked months**: Number of cost buckets, and months already frozen.
- **Electricity, Labor (conversion)**: Conversion rate per hour = (electricity + labour) ÷ productive hours of that cost group in that plant-month.
- **Overhead, Maintenance, Service burden**: Overhead rate per hour = (overhead + maintenance + service burden) ÷ the same productive hours.
- **Alloc %**: Allocated mode only: share of each plant total given to this group (amount = total × % ÷ 100).
- **Status DRAFT / REVIEWED / LOCKED**: Badge on each month. LOCKED months and their lines cannot be changed.
- **Actual / Hybrid / Estimated orders**: Order costs with 3 of 3 actual parts, 1–2 actual parts, or none.
- **Assignment precedence**: Machine override wins, then work-center default, then route-step mapping, then plant default. Counts show plants/work centers missing defaults and machines using inheritance.
- **Default intensity factor**: Weight of the cost group (kept on the master).

**Common problems and fixes**
- "Locked cost pool months and their lines cannot be changed." — The month is LOCKED. There is no unlock button; ask an admin if a correction is really needed.
- "percentages object is required." — "Allocate from totals" was pressed without any "Alloc %". Enter percentages first.
- "A cost pool line cannot be moved to another month." — A group line belongs to one month only. Open the right month and enter it there.
- "Unabsorbed pool is high" — Machines in that cost group did not record running hours (jobs not started/stopped on the terminal) or the machine has no cost group.

**If stuck**
1. Pick the plant first; "Create or reopen plant month" stays disabled without a plant.
2. Save totals before allocating, then allocate, then review.
3. If coverage is low, check that jobs on that plant have material issued and that operators start and stop jobs on the terminal.
4. Use "Open Plants", "Open Work Centers", "Open Machines" to fix missing cost groups.

Related pages: /analytics/process-rates, /analytics/orders/costing, /analytics/reports/costing, /factory/plants, /factory/work-centers, /factory/machines

**Not done yet / watch out**
- "Lock month" works even if the month was never marked reviewed, and there is no confirmation or unlock button.
- The delete (bin) button on a cost group deletes without asking for confirmation.
- Month totals and group lines are separate saves; changing totals in Direct mode does not update the group lines automatically.

### KPIs (old link) (/analytics/kpi)
Screen address: /analytics/kpi · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=analytics-kpi

Old address. It sends you straight to /analytics/kpis (Executive Control Center).

Kept so old bookmarks and links still work. Use /analytics/kpis directly.

**Before you start**
- Same access as the KPIs page.

**Step by step**
1. Open the old link /analytics/kpi.
2. The page redirects at once; you land on "Executive Control Center".
3. Use the KPIs page as usual (timeframe, tiles, panels).
4. Update your bookmark to /analytics/kpis.

**What is on the screen**
- **Redirect**: Automatic; nothing to fill.

**Common problems and fixes**
- "Page not allowed after redirect" — Your role lacks the KPIs permission. Ask an admin.

**If stuck**
1. Open /analytics/kpis from the "Reports & admin" menu (tab "KPIs").

Related pages: /analytics/kpis

### Executive Control Center (/analytics/kpis)
Screen address: /analytics/kpis · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=analytics-kpis

Company-wide live KPIs for the owner: booked order value, margin, output, overdue orders, stock, scrap, utilisation, cost coverage, P&L, order book, top customers, material and ink discipline, POD, procurement, trading, live floor and alerts.

Open daily (or in review meetings) to see the whole business on one screen and click into the area that needs action. It is the same deck as the owner dashboard, under the Analytics title.

**Before you start**
- Sales orders, production logs and costing must be posted; empty areas show messages like "No production logged in the last 30 days".

**Step by step**
1. Pick the "Timeframe": "day", "week", "month" (default) or "year" (last 1, 7, 30 or 365 days).
2. Read the hero numbers: "Booked order value", "Gross margin", "Production output", "Overdue orders".
3. Check the tiles "Inventory on hand", "Scrap", "Machine utilisation", "Actual-cost coverage" (each opens its report).
4. Review "Profit & loss" and "Six-month financials".
5. Review "Order book health" (Overdue / Ready to ship), "Top customers", "SKU Performance", "Stock position", "Job status".
6. Check "Material discipline" and "Ink control".
7. Act on "Alerts & risk signals"; use the links "Full report", "Costing centre", "Orders", "Purchase orders", "Trading pulse", "Live production".
8. Press "Refresh" to reload.

**What is on the screen**
- **Booked order value**: Total sales-order line amounts in the timeframe. It is order value, not invoiced revenue.
- **Gross margin**: From posted order costs: revenue − (material + conversion + absorbed overhead), as % of revenue. Shows "actual costing not posted" when no cost rows exist.
- **Production output**: KG produced in the timeframe, with % change against the previous period.
- **Overdue orders**: Open orders past their promised delivery date.
- **Inventory on hand**: Stock weight with an approximate rated value (bulk and packaging at weighted average cost).
- **Machine utilisation**: Machine time not lost to downtime (calendar hours).
- **Actual-cost coverage**: How much of order costing is based on actual material, hours and overhead (see Costing Center).
- **Profit & loss**: Revenue − material − conversion − absorbed overhead = gross profit; minus unabsorbed overheads = net profit.
- **Material discipline**: Issue discipline (issued vs planned issue; red above 110%), return efficiency, variance vs theoretical (red above 12%).
- **Ink control**: Ink consumed and returned against issued, and remix ratio (amber above 30%).
- **Route Reuse Pools**: Final, invariant and upstream roll pools in KG available for reuse routing.

**Common problems and fixes**
- "— shown instead of a number" — No data for that figure in the timeframe, or the source was unavailable. Try a longer timeframe.
- "Waiting for material postings" — No material issue/consumption is posted against jobs yet.

**If stuck**
1. Switch to "month" or "year" if the day view is empty.
2. Use "Refresh"; data is cached for a short time.

Related pages: /analytics, /analytics/costing, /analytics/reports/production, /analytics/reports/scrap, /analytics/reports/oee, /sales/orders, /logistics/dispatch, /procurement/purchase-orders, /analytics/reports/trading

**Not done yet / watch out**
- There is no plant filter; every figure is company-wide.

### MRP Center (/analytics/mrp)
Screen address: /analytics/mrp · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANNER · Share link: https://erp.totalpolyprint.com/guide?page=analytics-mrp

Material Requirement Planning: totals what open orders need (from their frozen BOM), subtracts stock and incoming WIP, and lists shortages with suggested actions (buy, produce, transfer).

Open each morning (the engine also runs nightly at 02:00 IST) to see which materials will run short and to draft purchase orders. Shortages come from confirmed sales orders and planned stock orders; drafts go to Procurement.

**Before you start**
- Sales order lines must have a BOM snapshot (lines without it are skipped).
- Material masters with category and unit; material cost snapshots for the purchase value estimate.
- At least one vendor and one plant exist (needed to draft a PO).

**Step by step**
1. Pick a run in "Plan run" (the latest clean run is chosen by default).
2. Press "Run planning engine" to refresh with today's demand and stock.
3. On "Overview" read "Demand", "Effective supply", "Shortage gap", "Coverage ratio", "Purchase exposure", "Drafted actions".
4. Open "Material gaps" to see each material at risk; use the category filter if needed.
5. Open "Draft actions": press "Create PO" for a purchase, "Open planner" for produce, "Open transfers" for transfer.
6. To buy all urgent items at once press "Draft all HIGH (n)" and confirm "Draft n POs for HIGH-priority items?".
7. Use "Compare with previous run" to see what changed; the draft PO opens in Purchase orders for vendor and price review.

**What is on the screen**
- **Demand**: Total KG needed: open qty of sales-order lines (scaled from their BOM snapshot) + planned stock (MTS) orders. Only KG materials are added into this total.
- **Effective supply**: Available stock (bulk + packaging stock + AVAILABLE rolls) + WIP from released/planned packaging stock orders. Open purchase orders are not counted.
- **Shortage gap**: Per material: demand − stock − WIP (never below 0), added up.
- **Coverage ratio**: Effective supply ÷ demand × 100.
- **Purchase exposure**: Estimated cost of buy suggestions = shortage × latest material cost rate (0 where no rate).
- **Priority HIGH / MEDIUM / LOW**: By shortage size: 500 or more = HIGH, 100–499 = MEDIUM, below 100 = LOW.
- **Action type**: Granules, ink, adhesive, solvent, additive, packaging, add-ons and bought film/POD → Purchase (need in 7 days). Extrudable film and in-house POD → Produce (2 days). Stock in another plant → Transfer (today).
- **Audit only**: A run with unrealistic totals (demand or shortage of 5,000,000 KG or more, supply of 1,000,000 KG or more) is kept for audit and excluded from trends; drafting POs is blocked on it.
- **Non-KG shortages**: Materials counted in pieces or metres; shown separately and not mixed into KG totals.

**Common problems and fixes**
- "No vendor available — create a vendor master first." — No vendor exists to put on the draft PO. Create a vendor in the vendor master.
- "No plant available — create a plant master first." — No plant exists. Create one in Factory → Plants.
- "Draft PO is valid only for PURCHASE suggestions." — You tried to buy a produce/transfer suggestion. Use "Open planner" or "Open transfers".
- "Audit-only MRP run selected" — The chosen run is an outlier. Select the latest clean operational run before drafting purchase orders.
- "No HIGH PURCHASE suggestions pending" — Nothing urgent to buy in this run. Run the engine again after new orders.
- "MRP failed" — The engine stopped with an error; the run is saved as FAILED. Try again; tell the admin if it repeats.

**If stuck**
1. If a material you expect is missing, check that the order line is confirmed and has a BOM snapshot.
2. If shortage looks too high, remember open POs are not counted as supply; check Purchase orders before buying again.
3. After a bulk draft, read the toast: "Drafted n POs · m failed" means some need manual drafting.

Related pages: /procurement/purchase-orders, /production/planner, /inventory/inter-plant, /analytics/reports/mrp, /sales/orders

**Not done yet / watch out**
- Open purchase orders and goods in transit are not counted as supply, so the same shortage keeps appearing until the GRN is posted.
- "Run planning engine" always runs for all plants; there is no plant choice on the page, so Transfer suggestions only come from plant-specific runs.
- Draft POs pick the vendor from the last receipt of that material, or the first active vendor by name, so vendor and price must be checked on the PO.
- Available stock does not subtract rolls or bulk already reserved for other jobs except rolls not in AVAILABLE status.

### Order Profitability (one order line) (/analytics/orders/[id]/costing)
Screen address: /analytics/orders/[id]/costing · Roles: ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=analytics-orders-id-costing

Profit view of one sales-order line: sales price, material cost, conversion cost, total cost and margin. [id] is the sales-order line id.

Open from Order Profitability (arrow button) to check why a line is in loss, or to recalculate after material issue and production are posted.

**Before you start**
- The line has a price (line amount). Jobs, material issues and running hours make the cost actual; otherwise BOM and process rates are used as estimate.

**Step by step**
1. If you see "Cost Data Not Found", press "Initialize Cost Calculation".
2. Read "Net Profit Margin" (% and "Margin Value"); above 15% shows "Healthy Profit", else "Low Margin Alert".
3. Compare "Sales Price", "Material Cost" and "Conversion Cost".
4. Check "Total Lifecycle Cost Impact" for the material vs conversion share.
5. After new production or issues press "Refresh Deep-Dive" to recalculate.
6. Use "Back to Center" to return to the Costing Center.

**What is on the screen**
- **Sales Price**: Line amount of the sales-order line.
- **Material Cost**: Actual: (issued − returned, or consumed + scrap) × latest material cost rate for each job requirement, plus packaging and bulk consumed for the line. If no actual exists: BOM snapshot quantities × rate.
- **Conversion Cost**: Actual: running hours × conversion rate of the plant-month pool. If missing: estimate = (order KG ÷ 150) hours × process rate per hour for each route step (₹800/h when no rate).
- **Total cost**: Material + conversion + absorbed overhead (overhead only from actual running hours).
- **Net Profit Margin / Margin Value**: Absorbed margin = sales price − total cost; % = margin ÷ sales price × 100.

**Common problems and fixes**
- "Sales Order Item not found." — The id in the address is not a sales-order line. Open the line from Order Profitability.
- "Could not calculate cost." — The engine returned nothing for this line. Check that the line has a BOM snapshot and a price.

**If stuck**
1. If cost looks too low, the material rate may be missing (missing rate counts as ₹0); add material cost snapshots.
2. Press "Refresh Deep-Dive" after month close so the new pool rates apply.

Related pages: /analytics/orders/costing, /analytics/costing, /analytics/process-rates, /sales/orders

**Not done yet / watch out**
- The "Material Components" and "Process Routing Costs" panels are placeholders; no material-wise or step-wise breakdown is shown.
- The page does not show the costing mode (Actual/Hybrid/Estimated) or coverage %, so a fully estimated cost looks the same as an actual one.
- "Back to Center" goes to the Costing Center, not back to the Order Profitability list.

### Order Profitability (/analytics/orders/costing)
Screen address: /analytics/orders/costing · Roles: ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=analytics-orders-costing

Ledger of every costed sales-order line with material, conversion, total cost, sales price and margin.

Open to find loss-making or low-margin lines and drill into one line.

**Before you start**
- Order costs exist (they are created when a line's cost is calculated).

**Step by step**
1. Type in "Filter orders, customers or SKUs..." to narrow the list.
2. Read "Margin Health": red = loss, amber = below 15%, green = healthy.
3. Compare "Direct Material", "Conversion", "Total Cost" and "Sales Price" for the line.
4. Press the arrow at the end of a row to open that line's profitability page.
5. On the line page press "Refresh Deep-Dive" after new production to update the figures here.

**What is on the screen**
- **Order Details**: Order number, customer and product.
- **Direct Material**: Material cost of the line (actual, or BOM estimate).
- **Conversion**: Machine/labour cost (actual hours × pool rate, or estimate).
- **Total Cost**: Material + conversion + absorbed overhead.
- **Sales Price**: Line amount.
- **Margin Health**: Sales price − total cost, and % of sales price. "Loss" when negative.

**Common problems and fixes**
- "No matching orders found in the ledger" — No cost rows match your filter, or no costs have been calculated yet. Clear the filter or calculate a line.

**If stuck**
1. Clear the search box.
2. Open a line and press "Initialize Cost Calculation" if it has no cost.

Related pages: /analytics/orders/[id]/costing, /analytics/costing, /analytics/reports/costing

**Not done yet / watch out**
- The "Export" and filter buttons do nothing yet.
- Lines that were never calculated do not appear; there is no button to calculate all lines from this list.

### Process Rates (/analytics/process-rates)
Screen address: /analytics/process-rates · Roles: ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=analytics-process-rates

Hourly cost rates (power, labour, overhead) per process, with optional machine overrides. Used to estimate conversion cost when actual running hours are not available.

Set once and update when power or wage rates change. Order costing falls back to these rates for estimates; actual cost uses the monthly plant pools in the Costing Center.

**Before you start**
- Processes exist in Factory → Processes; machines exist for machine overrides.

**Step by step**
1. Press "New Override".
2. Choose "Target Process" and, if needed, "Specific Machine (Optional)" (leave "General Process Rate" for all machines).
3. Enter "Power/hr", "Labor/hr", "Overhead/hr" in ₹ and press "Registry Override".
4. To change a rate, edit the numbers in "Master Process Rate Matrix" and press the save icon on that row.

**What is on the screen**
- **Power /hr**: Electricity cost per running hour.
- **Labor /hr**: Operator wage cost per hour.
- **Overhead /hr**: Fixed overhead per hour.
- **Total ₹/HR**: Sum of the three rates. The estimate uses (order KG ÷ 150) hours × this rate for each route step; with no active rate it uses ₹800/hour.
- **Generic Process Override / Machine**: Row applies to all machines of the process, or to one machine.

**Common problems and fixes**
- "Creation Failed" — The server rejected the new rate (for example a duplicate process/machine pair). Read the message and change the selection.
- "Update Failed" — Could not save the new rate. Check the numbers and try again.
- "No process rates configured. The engine will use system defaults." — No rates yet; estimates use ₹800/hour. Add rates with "New Override".

**If stuck**
1. "Registry Override" stays disabled until a process is chosen.
2. Edited numbers are not saved until you press the row's save icon.

Related pages: /analytics/costing, /analytics/orders/costing, /factory/processes

**Not done yet / watch out**
- The cost estimate looks up the rate by process only, so a machine-specific override is not used by the estimate.
- The 150 KG per hour speed used in the estimate is fixed in code and cannot be set per process or machine.
- There is no delete button for a rate row.

### Reports Hub (/analytics/reports)
Screen address: /analytics/reports · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, PLANNER, STORE, SALES · Share link: https://erp.totalpolyprint.com/guide?page=analytics-reports

The library of all operational reports grouped by area, plus daily report pack generation and the archive of generated packs.

Open to pick a report. Admins and owners also generate the daily pack and preview past packs here. Old links like /analytics/reports?tab=sales are sent to the report page automatically.

**Before you start**
- Each report opens only if your role has that report's permission.
- Daily packs are set up in Report Center by an admin.

**Step by step**
1. Pick a group: "Production", "Quality & materials", "Sales & logistics", "Inventory & finance" (and "Gate & Visitors" if allowed).
2. Click a report card to open it.
3. Admin/Owner: in "Report generation" press "Generate daily pack" for a pack. The toast "Report generated" confirms it was archived and owner/admin were notified in-app.
4. In "Recent report runs" open "Preview PDF" or "Detail workbook".
5. Use "Latest daily pack" (top) to open the newest pack.

**What is on the screen**
- **Reports**: Number of report cards you can see and how many domains.
- **Daily packs**: Scheduled distributions; "Restricted" if your role cannot configure them.
- **Recent runs / Last generated**: Archived packs and when the latest was generated; status SUCCEEDED/SENT is green, FAILED is red.
- **Gate Register Daily pack**: Link to Report Center (admin/owner) to turn on, generate and archive the gate pack.

**Common problems and fixes**
- "Report generation failed" — The pack could not be generated; the message shows the server reason. Try again or check Report Center.
- "Archive restricted for this role" — Pack history is only for report admins. All reports are still available to open and export.
- "No daily packs configured" — An admin has not set up any pack in Report Center.

**If stuck**
1. If a report card opens with an error, your role lacks that report; ask an admin.

Related pages: /analytics, /analytics/reports/production, /analytics/reports/scrap, /analytics/reports/sales, /analytics/reports/inventory, /analytics/reports/costing, /analytics/reports/gate, /system/report-center

**Not done yet / watch out**
- "Generate daily pack" has no confirmation and can be pressed repeatedly, creating extra archived runs.

### Costing & Profitability (/analytics/reports/costing)
Screen address: /analytics/reports/costing · Roles: ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=analytics-reports-costing

Revenue, production cost, margin, cost per kg, cost split, margin by customer and monthly overheads from posted job and order costs.

Open after month close to review profitability. Numbers come from cost rows calculated in the period.

**Before you start**
- Order and job costs are calculated; plant months are entered in Costing Center.

**Step by step**
1. Choose the period (7D, 30D, 90D, MTD, FY or Custom) and, if needed, Plant and Shift.
2. Check the chips at the top (period, "Updated", data coverage) and any yellow warning.
3. Read "Revenue", "Production cost", "Gross margin", "Margin %", "Cost per kg", "Contribution", "Actual-cost coverage", "Jobs costed".
4. Use "Trend" (pick the measure) and "Insights" to see direction.
5. Read the breakdown panels and the detail table; use "Filter rows" and click column headers to sort.
6. Download with "CSV" (rows) or "PDF" (whole report); "All reports" goes back to the Reports Hub.

**What is on the screen**
- **Revenue**: Sum of selling price (line amount) of order costs created in the period.
- **Production cost / Jobs costed**: Sum of job total cost (material + conversion + absorbed overhead) and number of job costs.
- **Gross margin / Margin %**: Sum of absorbed margin (selling − total cost); Margin % is the simple average of each order's margin %, target 25%.
- **Contribution**: Selling price − material − conversion (before overhead).
- **Cost per kg**: Average of job cost per kg (job total cost ÷ produced quantity).
- **Actual-cost coverage**: Average share of actual (not estimated) cost parts; target 100%.
- **Sections**: "Cost split" (material, conversion, absorbed overhead), "Margin by customer" (top 10 by revenue), "Overheads by month" (last 12 plant months).
- **Period (7D / 30D / 90D / MTD / FY / Custom)**: Date window. Default 30D. MTD = this month to date; FY = from 1 April. "Custom" shows "From date" and "To date". Filters are kept in the page address so the link can be shared.
- **Plant / Process / Shift**: Narrow the report to one plant or shift. The process filter is shown on every report but is not applied by the server today.
- **Machine logs / Material actuals / Shift tags**: Data coverage chips: % of jobs created in the period that have output logs; % that have material issued/consumed/returned; % of output logs carrying a shift code. Green 80%+, amber 30%+, red below; N/A when the report does not use it.
- **KPI tiles (On target / Below target)**: Up to 8 tiles. Where a target exists the tile turns good or bad against it.
- **Trend / Insights**: Daily chart for the chosen measure (quiet days shown as zero) and short insights computed from the same data.
- **Detail table**: Sortable rows, "Filter rows" search, 25 rows per page, "CSV" downloads the filtered rows.

**Common problems and fixes**
- "This report could not be loaded. Try refreshing." — The server request failed or your role lacks this report. Press "Refresh"; if it repeats, ask an admin for access.
- "No figures for this period" — Nothing was recorded for the filters. Widen the period or clear filters.
- "No telemetry in selected period." — No job in the period has machine output logs. Ask work centers to log output on the terminal.
- "No shift tags captured in selected telemetry. / No shift schedule configured." — Output logs have no shift code, or the plant has no active shift definitions. Set up shifts in factory settings.

**If stuck**
1. If coverage is low, finish the month close in Costing Center first.
2. Press "Refresh" (the report also refreshes every 3 minutes).
3. Switch to 90D or FY if the period is empty, and set Plant and Shift back to "All".
4. Read the yellow warning box; it names the missing data.

Related pages: /analytics/reports, /analytics/costing, /analytics/orders/costing

**Not done yet / watch out**
- Only the date filter applies; plant, process and shift filters do not change costing figures.
- Margin % is a simple average of order margins, not total margin ÷ total revenue, so small orders weigh as much as big ones.

### Dispatch & Logistics (/analytics/reports/dispatch)
Screen address: /analytics/reports/dispatch · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, DISPATCH · Share link: https://erp.totalpolyprint.com/guide?page=analytics-reports-dispatch

Delivery challans: how many, dispatched vs pending, weight and pieces shipped, by customer.

Open to review dispatch volume and pending challans.

**Before you start**
- Dispatch slips/challans are made in Dispatch Bay.

**Step by step**
1. Choose the period (7D, 30D, 90D, MTD, FY or Custom) and, if needed, Plant and Shift.
2. Check the chips at the top (period, "Updated", data coverage) and any yellow warning.
3. Read "Challans", "Dispatched", "Pending", "Weight shipped", "Pieces shipped".
4. Use "Trend" (pick the measure) and "Insights" to see direction.
5. Read the breakdown panels and the detail table; use "Filter rows" and click column headers to sort.
6. Use "Open dispatch bay".
7. Download with "CSV" (rows) or "PDF" (whole report); "All reports" goes back to the Reports Hub.

**What is on the screen**
- **Challans**: Delivery challans created in the period (plant filter applies).
- **Dispatched**: Challans in DISPATCHED, IN_TRANSIT or DELIVERED.
- **Pending**: Challans still in DRAFT.
- **Weight shipped / Pieces shipped**: Sum of challan line weight (KG) and pieces.
- **Period (7D / 30D / 90D / MTD / FY / Custom)**: Date window. Default 30D. MTD = this month to date; FY = from 1 April. "Custom" shows "From date" and "To date". Filters are kept in the page address so the link can be shared.
- **Plant / Process / Shift**: Narrow the report to one plant or shift. The process filter is shown on every report but is not applied by the server today.
- **Machine logs / Material actuals / Shift tags**: Data coverage chips: % of jobs created in the period that have output logs; % that have material issued/consumed/returned; % of output logs carrying a shift code. Green 80%+, amber 30%+, red below; N/A when the report does not use it.
- **KPI tiles (On target / Below target)**: Up to 8 tiles. Where a target exists the tile turns good or bad against it.
- **Trend / Insights**: Daily chart for the chosen measure (quiet days shown as zero) and short insights computed from the same data.
- **Detail table**: Sortable rows, "Filter rows" search, 25 rows per page, "CSV" downloads the filtered rows.

**Common problems and fixes**
- "This report could not be loaded. Try refreshing." — The server request failed or your role lacks this report. Press "Refresh"; if it repeats, ask an admin for access.
- "No figures for this period" — Nothing was recorded for the filters. Widen the period or clear filters.
- "No telemetry in selected period." — No job in the period has machine output logs. Ask work centers to log output on the terminal.
- "No shift tags captured in selected telemetry. / No shift schedule configured." — Output logs have no shift code, or the plant has no active shift definitions. Set up shifts in factory settings.

**If stuck**
1. Press "Refresh" (the report also refreshes every 3 minutes).
2. Switch to 90D or FY if the period is empty, and set Plant and Shift back to "All".
3. Read the yellow warning box; it names the missing data.

Related pages: /analytics/reports, /logistics/dispatch

**Not done yet / watch out**
- Shift and process filters have no effect on this report.

### Downtime Analysis (/analytics/reports/downtime)
Screen address: /analytics/reports/downtime · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, WORK_CENTER_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=analytics-reports-downtime

Total stoppage time, number of stoppages, mean time to repair and a Pareto of reasons and machines.

Open to decide which stoppage reasons to fix first. Every pause on the work-center terminal writes a downtime record with a reason, so this shows real lost time.

**Before you start**
- Operators pause jobs with a reason on the terminal; resume or completion closes the record.

**Step by step**
1. Choose the period (7D, 30D, 90D, MTD, FY or Custom) and, if needed, Plant and Shift.
2. Check the chips at the top (period, "Updated", data coverage) and any yellow warning.
3. Read "Downtime", "Stoppages", "Mean time to repair", "Stoppages per day".
4. Use "Trend" (pick the measure) and "Insights" to see direction.
5. Read the breakdown panels and the detail table; use "Filter rows" and click column headers to sort.
6. Download with "CSV" (rows) or "PDF" (whole report); "All reports" goes back to the Reports Hub.

**What is on the screen**
- **Downtime**: Sum of (end − start) of downtime records in hours.
- **Stoppages**: Number of downtime records.
- **Mean time to repair**: Total downtime minutes ÷ stoppages.
- **Stoppages per day**: Stoppages ÷ days that had downtime.
- **Sections**: "Downtime reasons (Pareto)" — fix the top reasons first; "Machines losing the most time".
- **Period (7D / 30D / 90D / MTD / FY / Custom)**: Date window. Default 30D. MTD = this month to date; FY = from 1 April. "Custom" shows "From date" and "To date". Filters are kept in the page address so the link can be shared.
- **Plant / Process / Shift**: Narrow the report to one plant or shift. The process filter is shown on every report but is not applied by the server today.
- **Machine logs / Material actuals / Shift tags**: Data coverage chips: % of jobs created in the period that have output logs; % that have material issued/consumed/returned; % of output logs carrying a shift code. Green 80%+, amber 30%+, red below; N/A when the report does not use it.
- **KPI tiles (On target / Below target)**: Up to 8 tiles. Where a target exists the tile turns good or bad against it.
- **Trend / Insights**: Daily chart for the chosen measure (quiet days shown as zero) and short insights computed from the same data.
- **Detail table**: Sortable rows, "Filter rows" search, 25 rows per page, "CSV" downloads the filtered rows.

**Common problems and fixes**
- "This report could not be loaded. Try refreshing." — The server request failed or your role lacks this report. Press "Refresh"; if it repeats, ask an admin for access.
- "No figures for this period" — Nothing was recorded for the filters. Widen the period or clear filters.
- "No telemetry in selected period." — No job in the period has machine output logs. Ask work centers to log output on the terminal.
- "No shift tags captured in selected telemetry. / No shift schedule configured." — Output logs have no shift code, or the plant has no active shift definitions. Set up shifts in factory settings.

**If stuck**
1. A pause still open (no resume) is not counted until it is closed.
2. Press "Refresh" (the report also refreshes every 3 minutes).
3. Switch to 90D or FY if the period is empty, and set Plant and Shift back to "All".
4. Read the yellow warning box; it names the missing data.

Related pages: /analytics/reports, /analytics/reports/oee, /maintenance

**Not done yet / watch out**
- Downtime is linked to a machine through its job, so stoppages logged without a job are not shown.

### Gate Register (/analytics/reports/gate)
Screen address: /analytics/reports/gate · Roles: ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=analytics-reports-gate

Inward and outward vehicle entries from the watchman register, checked against ERP documents, plus bill counts and visitor counts (counts only, no personal details).

Open daily to make sure every gate movement matches an ERP document and no visitor has stayed too long.

**Before you start**
- Admins and owners see it by default; others need the Gate reports pack (gate.reports) granted in User Management. Watchman accounts never see it.
- Watchman logs goods movements and visitors at the gate.

**Step by step**
1. Choose the period (7D, 30D, 90D, MTD, FY or Custom) and, if needed, Plant and Shift.
2. Check the chips at the top (period, "Updated", data coverage) and any yellow warning.
3. Read "Register entries", "Inward entries", "Outward entries", "Awaiting ERP match", "ERP mismatches", "Visitor entries", "Visitor exits", "Overdue inside now" and the "Inward bills" panel.
4. Use "Trend" (pick the measure) and "Insights" to see direction.
5. Read the breakdown panels and the detail table; use "Filter rows" and click column headers to sort.
6. Download with "CSV" (rows) or "PDF" (whole report); "All reports" goes back to the Reports Hub.

**What is on the screen**
- **Register entries**: Movements logged (not distinct vehicles), split inward/outward. Days follow Asia/Kolkata.
- **Awaiting ERP match**: Entries not yet linked to an ERP document (UNMATCHED). Target 0.
- **ERP mismatches**: Entries whose lines differ from the linked document (DISCREPANCY). Target 0.
- **Overdue inside now**: Visitors still inside who entered more than 12 hours ago (current, not for the period).
- **Inward bills / Bills captured, received, resolved**: Bill flow: capture → inventory review → confirmed receipt.
- **Amount**: Known line amounts only; may exclude tax or freight. Not an accounting total.
- **Period (7D / 30D / 90D / MTD / FY / Custom)**: Date window. Default 30D. MTD = this month to date; FY = from 1 April. "Custom" shows "From date" and "To date". Filters are kept in the page address so the link can be shared.
- **Plant / Process / Shift**: Narrow the report to one plant or shift. The process filter is shown on every report but is not applied by the server today.
- **Machine logs / Material actuals / Shift tags**: Data coverage chips: % of jobs created in the period that have output logs; % that have material issued/consumed/returned; % of output logs carrying a shift code. Green 80%+, amber 30%+, red below; N/A when the report does not use it.
- **KPI tiles (On target / Below target)**: Up to 8 tiles. Where a target exists the tile turns good or bad against it.
- **Trend / Insights**: Daily chart for the chosen measure (quiet days shown as zero) and short insights computed from the same data.
- **Detail table**: Sortable rows, "Filter rows" search, 25 rows per page, "CSV" downloads the filtered rows.

**Common problems and fixes**
- "Gate report not available for this account" — Your account lacks gate.reports. Ask an admin or owner to grant the Gate reports pack.
- "Choose an ordered date range of 366 days or fewer." — The custom range is longer than a year or reversed. Shorten it.
- "The start date must be on or before the end date." — Fix the From/To dates.
- "Plant does not exist." — The plant in the link is invalid. Pick a plant from the list.
- "This report could not be loaded. Try refreshing." — The server request failed or your role lacks this report. Press "Refresh"; if it repeats, ask an admin for access.
- "No figures for this period" — Nothing was recorded for the filters. Widen the period or clear filters.
- "No telemetry in selected period." — No job in the period has machine output logs. Ask work centers to log output on the terminal.
- "No shift tags captured in selected telemetry. / No shift schedule configured." — Output logs have no shift code, or the plant has no active shift definitions. Set up shifts in factory settings.

**If stuck**
1. Press "Refresh" (the report also refreshes every 3 minutes).
2. Switch to 90D or FY if the period is empty, and set Plant and Shift back to "All".
3. Read the yellow warning box; it names the missing data.

Related pages: /analytics/reports, /gate/register, /gate/history, /inventory/gate-bills, /system/report-center

**Not done yet / watch out**
- Visitor figures are counts only; names and details are deliberately not shown.

### Ink Intelligence (/analytics/reports/ink-intelligence)
Screen address: /analytics/reports/ink-intelligence · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, PLANNER, WORK_CENTER_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=analytics-reports-ink-intelligence

Ink needed, issued, consumed and returned by colour family, with variance and issue discipline.

Open to control ink use on printing jobs and returns to the ink kitchen.

**Before you start**
- Ink materials have category INK; ink issues and returns are posted against jobs.

**Step by step**
1. Choose the period (7D, 30D, 90D, MTD, FY or Custom) and, if needed, Plant and Shift.
2. Check the chips at the top (period, "Updated", data coverage) and any yellow warning.
3. Read "Ink needed", "Ink issued", "Ink consumed", "Returned", "Variance", "Colour families".
4. Use "Trend" (pick the measure) and "Insights" to see direction.
5. Read the breakdown panels and the detail table; use "Filter rows" and click column headers to sort.
6. Download with "CSV" (rows) or "PDF" (whole report); "All reports" goes back to the Reports Hub.

**What is on the screen**
- **Colour family**: Taken from the ink name: C (cyan), M (magenta), Y (yellow), K (black/key), W (white), SPECIAL, else CUSTOM.
- **Variance**: Consumed − theoretical ink.
- **Issue discipline**: Issued ÷ planned issue × 100.
- **Returns**: Returned ÷ issued × 100.
- **Period (7D / 30D / 90D / MTD / FY / Custom)**: Date window. Default 30D. MTD = this month to date; FY = from 1 April. "Custom" shows "From date" and "To date". Filters are kept in the page address so the link can be shared.
- **Plant / Process / Shift**: Narrow the report to one plant or shift. The process filter is shown on every report but is not applied by the server today.
- **Machine logs / Material actuals / Shift tags**: Data coverage chips: % of jobs created in the period that have output logs; % that have material issued/consumed/returned; % of output logs carrying a shift code. Green 80%+, amber 30%+, red below; N/A when the report does not use it.
- **KPI tiles (On target / Below target)**: Up to 8 tiles. Where a target exists the tile turns good or bad against it.
- **Trend / Insights**: Daily chart for the chosen measure (quiet days shown as zero) and short insights computed from the same data.
- **Detail table**: Sortable rows, "Filter rows" search, 25 rows per page, "CSV" downloads the filtered rows.

**Common problems and fixes**
- "No material actuals captured." — No issue, consumption or return was posted against jobs in the period.
- "This report could not be loaded. Try refreshing." — The server request failed or your role lacks this report. Press "Refresh"; if it repeats, ask an admin for access.
- "No figures for this period" — Nothing was recorded for the filters. Widen the period or clear filters.
- "No telemetry in selected period." — No job in the period has machine output logs. Ask work centers to log output on the terminal.
- "No shift tags captured in selected telemetry. / No shift schedule configured." — Output logs have no shift code, or the plant has no active shift definitions. Set up shifts in factory settings.

**If stuck**
1. Press "Refresh" (the report also refreshes every 3 minutes).
2. Switch to 90D or FY if the period is empty, and set Plant and Shift back to "All".
3. Read the yellow warning box; it names the missing data.

Related pages: /analytics/reports, /production/ink-control

**Not done yet / watch out**
- Colour family is guessed from the ink name; inks not named with cyan/magenta/yellow/black/white fall into CUSTOM.

### Inter-Plant Logistics (/analytics/reports/interplant)
Screen address: /analytics/reports/interplant · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, STORE, DISPATCH · Share link: https://erp.totalpolyprint.com/guide?page=analytics-reports-interplant

Inter-plant transfer challans: dispatched, received, in transit and drafts, with weights.

Open to make sure every transfer sent was received and nothing is stuck in transit.

**Before you start**
- Transfers are made in Inventory → Inter-plant.

**Step by step**
1. Choose the period (7D, 30D, 90D, MTD, FY or Custom) and, if needed, Plant and Shift.
2. Check the chips at the top (period, "Updated", data coverage) and any yellow warning.
3. Read "Transfers", "Dispatched", "Received", "In transit", "Weight in transit", "Received challans", "Drafts".
4. Use "Trend" (pick the measure) and "Insights" to see direction.
5. Read the breakdown panels and the detail table; use "Filter rows" and click column headers to sort.
6. Use "Receive an incoming transfer".
7. Download with "CSV" (rows) or "PDF" (whole report); "All reports" goes back to the Reports Hub.

**What is on the screen**
- **Transfers**: Challans created in the period where the plant is sender or receiver.
- **Dispatched / Received**: Sum of dispatched and received KG on challan lines.
- **In transit / Weight in transit**: Challans in IN_TRANSIT, and output weight sent but not yet received on them.
- **Recent transfers**: Table with DC no, status, from/to plant, dates and weights.
- **Period (7D / 30D / 90D / MTD / FY / Custom)**: Date window. Default 30D. MTD = this month to date; FY = from 1 April. "Custom" shows "From date" and "To date". Filters are kept in the page address so the link can be shared.
- **Plant / Process / Shift**: Narrow the report to one plant or shift. The process filter is shown on every report but is not applied by the server today.
- **Machine logs / Material actuals / Shift tags**: Data coverage chips: % of jobs created in the period that have output logs; % that have material issued/consumed/returned; % of output logs carrying a shift code. Green 80%+, amber 30%+, red below; N/A when the report does not use it.
- **KPI tiles (On target / Below target)**: Up to 8 tiles. Where a target exists the tile turns good or bad against it.
- **Trend / Insights**: Daily chart for the chosen measure (quiet days shown as zero) and short insights computed from the same data.
- **Detail table**: Sortable rows, "Filter rows" search, 25 rows per page, "CSV" downloads the filtered rows.

**Common problems and fixes**
- "This report could not be loaded. Try refreshing." — The server request failed or your role lacks this report. Press "Refresh"; if it repeats, ask an admin for access.
- "No figures for this period" — Nothing was recorded for the filters. Widen the period or clear filters.
- "No telemetry in selected period." — No job in the period has machine output logs. Ask work centers to log output on the terminal.
- "No shift tags captured in selected telemetry. / No shift schedule configured." — Output logs have no shift code, or the plant has no active shift definitions. Set up shifts in factory settings.

**If stuck**
1. Press "Refresh" (the report also refreshes every 3 minutes).
2. Switch to 90D or FY if the period is empty, and set Plant and Shift back to "All".
3. Read the yellow warning box; it names the missing data.

Related pages: /analytics/reports, /inventory/inter-plant

**Not done yet / watch out**
- Shift and process filters have no effect on this report.

### Inventory Health (/analytics/reports/inventory)
Screen address: /analytics/reports/inventory · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, STORE, PLANNER · Share link: https://erp.totalpolyprint.com/guide?page=analytics-reports-inventory

Stock posture: roll and bulk weight, aging, value and valuation coverage, by stage, family, material, location and plant.

Open weekly to find old stock to use first and materials without a cost rate.

**Before you start**
- Material cost snapshots exist for valuation.

**Step by step**
1. Choose the period (7D, 30D, 90D, MTD, FY or Custom) and, if needed, Plant and Shift.
2. Check the chips at the top (period, "Updated", data coverage) and any yellow warning.
3. Read "Roll stock", "Bulk stock", "Stock items", "Aged stock", "Aged items", "Estimated value", "Valuation coverage", "Items without a rate".
4. Use "Trend" (pick the measure) and "Insights" to see direction.
5. Read the breakdown panels and the detail table; use "Filter rows" and click column headers to sort.
6. Use "Find available rolls" or "Review stock exceptions".
7. Download with "CSV" (rows) or "PDF" (whole report); "All reports" goes back to the Reports Hub.

**What is on the screen**
- **Roll stock**: Total weight of rolls in scope (plant filter applies). It is current stock, not stock on the selected dates.
- **Bulk stock**: Granules, chemicals and other bulk stock in KG (all plants).
- **Stock items**: Number of rolls.
- **Aged stock / Aged items**: Rolls older than 90 days (from creation date).
- **Estimated value**: Roll weight × latest material cost snapshot rate, only for materials that have a rate.
- **Valuation coverage / Items without a rate**: Weight with a rate ÷ total weight × 100 (target 100%), and rolls whose material has no rate.
- **Sections**: "Stock aging" bands, "By stage" (RAW, WIP_STEP_n, FG), "By item type", "Largest stock families", "By material", "By location", "By plant"; table "Stock items".
- **Period (7D / 30D / 90D / MTD / FY / Custom)**: Date window. Default 30D. MTD = this month to date; FY = from 1 April. "Custom" shows "From date" and "To date". Filters are kept in the page address so the link can be shared.
- **Plant / Process / Shift**: Narrow the report to one plant or shift. The process filter is shown on every report but is not applied by the server today.
- **Machine logs / Material actuals / Shift tags**: Data coverage chips: % of jobs created in the period that have output logs; % that have material issued/consumed/returned; % of output logs carrying a shift code. Green 80%+, amber 30%+, red below; N/A when the report does not use it.
- **KPI tiles (On target / Below target)**: Up to 8 tiles. Where a target exists the tile turns good or bad against it.
- **Trend / Insights**: Daily chart for the chosen measure (quiet days shown as zero) and short insights computed from the same data.
- **Detail table**: Sortable rows, "Filter rows" search, 25 rows per page, "CSV" downloads the filtered rows.

**Common problems and fixes**
- "This report could not be loaded. Try refreshing." — The server request failed or your role lacks this report. Press "Refresh"; if it repeats, ask an admin for access.
- "No figures for this period" — Nothing was recorded for the filters. Widen the period or clear filters.
- "No telemetry in selected period." — No job in the period has machine output logs. Ask work centers to log output on the terminal.
- "No shift tags captured in selected telemetry. / No shift schedule configured." — Output logs have no shift code, or the plant has no active shift definitions. Set up shifts in factory settings.

**If stuck**
1. Press "Refresh" (the report also refreshes every 3 minutes).
2. Switch to 90D or FY if the period is empty, and set Plant and Shift back to "All".
3. Read the yellow warning box; it names the missing data.

Related pages: /analytics/reports, /inventory/rolls, /inventory/alerts, /analytics/inventory-health

**Not done yet / watch out**
- Stock figures ignore the date filter (they are always current), bulk stock ignores the plant filter, and the roll query has no status filter, so consumed or scrapped rolls may be included in totals.

### Inventory Lineage (/analytics/reports/inventory-lineage)
Screen address: /analytics/reports/inventory-lineage · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, STORE, PLANNER · Share link: https://erp.totalpolyprint.com/guide?page=analytics-reports-inventory-lineage

Stock by family, stage, material, location and plant, as a starting point to trace stock back through stages.

Open to see which families sit at which stage, then trace an exact roll in Roll genealogy.

**Before you start**
- Rolls carry material, stage and location.

**Step by step**
1. Choose the period (7D, 30D, 90D, MTD, FY or Custom) and, if needed, Plant and Shift.
2. Check the chips at the top (period, "Updated", data coverage) and any yellow warning.
3. Read the stock tiles and the "By stage" and "Largest stock families" panels.
4. Use "Trend" (pick the measure) and "Insights" to see direction.
5. Read the breakdown panels and the detail table; use "Filter rows" and click column headers to sort.
6. Use "Trace an exact roll" (ERP ID, supplier roll reference or QR).
7. Download with "CSV" (rows) or "PDF" (whole report); "All reports" goes back to the Reports Hub.

**What is on the screen**
- **Roll stock**: Total weight of rolls in scope (plant filter applies). It is current stock, not stock on the selected dates.
- **Bulk stock**: Granules, chemicals and other bulk stock in KG (all plants).
- **Stock items**: Number of rolls.
- **Aged stock / Aged items**: Rolls older than 90 days (from creation date).
- **Estimated value**: Roll weight × latest material cost snapshot rate, only for materials that have a rate.
- **Valuation coverage / Items without a rate**: Weight with a rate ÷ total weight × 100 (target 100%), and rolls whose material has no rate.
- **Sections**: "Stock aging" bands, "By stage" (RAW, WIP_STEP_n, FG), "By item type", "Largest stock families", "By material", "By location", "By plant"; table "Stock items".
- **Period (7D / 30D / 90D / MTD / FY / Custom)**: Date window. Default 30D. MTD = this month to date; FY = from 1 April. "Custom" shows "From date" and "To date". Filters are kept in the page address so the link can be shared.
- **Plant / Process / Shift**: Narrow the report to one plant or shift. The process filter is shown on every report but is not applied by the server today.
- **Machine logs / Material actuals / Shift tags**: Data coverage chips: % of jobs created in the period that have output logs; % that have material issued/consumed/returned; % of output logs carrying a shift code. Green 80%+, amber 30%+, red below; N/A when the report does not use it.
- **KPI tiles (On target / Below target)**: Up to 8 tiles. Where a target exists the tile turns good or bad against it.
- **Trend / Insights**: Daily chart for the chosen measure (quiet days shown as zero) and short insights computed from the same data.
- **Detail table**: Sortable rows, "Filter rows" search, 25 rows per page, "CSV" downloads the filtered rows.

**Common problems and fixes**
- "This report could not be loaded. Try refreshing." — The server request failed or your role lacks this report. Press "Refresh"; if it repeats, ask an admin for access.
- "No figures for this period" — Nothing was recorded for the filters. Widen the period or clear filters.
- "No telemetry in selected period." — No job in the period has machine output logs. Ask work centers to log output on the terminal.
- "No shift tags captured in selected telemetry. / No shift schedule configured." — Output logs have no shift code, or the plant has no active shift definitions. Set up shifts in factory settings.

**If stuck**
1. Press "Refresh" (the report also refreshes every 3 minutes).
2. Switch to 90D or FY if the period is empty, and set Plant and Shift back to "All".
3. Read the yellow warning box; it names the missing data.

Related pages: /analytics/reports, /inventory/traceability, /analytics/reports/inventory

**Not done yet / watch out**
- Inventory Lineage returns exactly the same data as Inventory Health; there is no stage-to-stage lineage view on this page.

### Material Variance (/analytics/reports/material-variance)
Screen address: /analytics/reports/material-variance · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, PLANNER · Share link: https://erp.totalpolyprint.com/guide?page=analytics-reports-material-variance

Planned requirement compared with issued and recorded material usage, by material and job.

Open to find materials and jobs with the largest overuse. Uses the same numbers as MRP & Consumption Variance.

**Before you start**
- Jobs have material requirements and store posts issues, consumption and returns.

**Step by step**
1. Choose the period (7D, 30D, 90D, MTD, FY or Custom) and, if needed, Plant and Shift.
2. Check the chips at the top (period, "Updated", data coverage) and any yellow warning.
3. Read the variance tiles and "Variance by material".
4. Use "Trend" (pick the measure) and "Insights" to see direction.
5. Read the breakdown panels and the detail table; use "Filter rows" and click column headers to sort.
6. Download with "CSV" (rows) or "PDF" (whole report); "All reports" goes back to the Reports Hub.

**What is on the screen**
- **Theoretical need**: No-loss quantity from recipes for jobs created in the period (job-worker supplied material excluded).
- **Issued / Consumed / Returned to store**: Actual material issued to jobs, consumed, and returned.
- **Variance**: Consumed − theoretical. Positive = overuse.
- **Waste factor**: (Required − theoretical) ÷ theoretical × 100: the planned wastage allowance. Target 5% or less.
- **Planning accuracy**: Theoretical ÷ consumed × 100. Target 95%.
- **Issue accuracy**: Planned issue ÷ actual issued × 100. Target 95%.
- **Sections**: "Material flow" (theoretical → issued → consumed → returns → net variance), "Variance by material" (top 20 by consumption; OVER/UNDER/OK), "Jobs with the largest overuse" (top 15).
- **Period (7D / 30D / 90D / MTD / FY / Custom)**: Date window. Default 30D. MTD = this month to date; FY = from 1 April. "Custom" shows "From date" and "To date". Filters are kept in the page address so the link can be shared.
- **Plant / Process / Shift**: Narrow the report to one plant or shift. The process filter is shown on every report but is not applied by the server today.
- **Machine logs / Material actuals / Shift tags**: Data coverage chips: % of jobs created in the period that have output logs; % that have material issued/consumed/returned; % of output logs carrying a shift code. Green 80%+, amber 30%+, red below; N/A when the report does not use it.
- **KPI tiles (On target / Below target)**: Up to 8 tiles. Where a target exists the tile turns good or bad against it.
- **Trend / Insights**: Daily chart for the chosen measure (quiet days shown as zero) and short insights computed from the same data.
- **Detail table**: Sortable rows, "Filter rows" search, 25 rows per page, "CSV" downloads the filtered rows.

**Common problems and fixes**
- "No material actuals captured." — No issue, consumption or return was posted against jobs in the period.
- "This report could not be loaded. Try refreshing." — The server request failed or your role lacks this report. Press "Refresh"; if it repeats, ask an admin for access.
- "No figures for this period" — Nothing was recorded for the filters. Widen the period or clear filters.
- "No telemetry in selected period." — No job in the period has machine output logs. Ask work centers to log output on the terminal.
- "No shift tags captured in selected telemetry. / No shift schedule configured." — Output logs have no shift code, or the plant has no active shift definitions. Set up shifts in factory settings.

**If stuck**
1. Press "Refresh" (the report also refreshes every 3 minutes).
2. Switch to 90D or FY if the period is empty, and set Plant and Shift back to "All".
3. Read the yellow warning box; it names the missing data.

Related pages: /analytics/reports, /analytics/reports/mrp, /production/ink-control

**Not done yet / watch out**
- Material Variance and MRP & Consumption Variance show the same numbers.

### MRP & Consumption Variance (/analytics/reports/mrp)
Screen address: /analytics/reports/mrp · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, PLANNER · Share link: https://erp.totalpolyprint.com/guide?page=analytics-reports-mrp

Theoretical vs required vs issued vs actually consumed material, with material and job variance.

Open after jobs finish to see where material was overused. This is consumption variance; the shortage plan itself is in MRP Center.

**Before you start**
- Jobs have material requirements and store posts issues, consumption and returns.

**Step by step**
1. Choose the period (7D, 30D, 90D, MTD, FY or Custom) and, if needed, Plant and Shift.
2. Check the chips at the top (period, "Updated", data coverage) and any yellow warning.
3. Read "Theoretical need", "Issued", "Consumed", "Variance", "Waste factor", "Planning accuracy", "Issue accuracy", "Returned to store".
4. Use "Trend" (pick the measure) and "Insights" to see direction.
5. Read the breakdown panels and the detail table; use "Filter rows" and click column headers to sort.
6. Use "Review material demand" to open MRP Center.
7. Download with "CSV" (rows) or "PDF" (whole report); "All reports" goes back to the Reports Hub.

**What is on the screen**
- **Theoretical need**: No-loss quantity from recipes for jobs created in the period (job-worker supplied material excluded).
- **Issued / Consumed / Returned to store**: Actual material issued to jobs, consumed, and returned.
- **Variance**: Consumed − theoretical. Positive = overuse.
- **Waste factor**: (Required − theoretical) ÷ theoretical × 100: the planned wastage allowance. Target 5% or less.
- **Planning accuracy**: Theoretical ÷ consumed × 100. Target 95%.
- **Issue accuracy**: Planned issue ÷ actual issued × 100. Target 95%.
- **Sections**: "Material flow" (theoretical → issued → consumed → returns → net variance), "Variance by material" (top 20 by consumption; OVER/UNDER/OK), "Jobs with the largest overuse" (top 15).
- **Period (7D / 30D / 90D / MTD / FY / Custom)**: Date window. Default 30D. MTD = this month to date; FY = from 1 April. "Custom" shows "From date" and "To date". Filters are kept in the page address so the link can be shared.
- **Plant / Process / Shift**: Narrow the report to one plant or shift. The process filter is shown on every report but is not applied by the server today.
- **Machine logs / Material actuals / Shift tags**: Data coverage chips: % of jobs created in the period that have output logs; % that have material issued/consumed/returned; % of output logs carrying a shift code. Green 80%+, amber 30%+, red below; N/A when the report does not use it.
- **KPI tiles (On target / Below target)**: Up to 8 tiles. Where a target exists the tile turns good or bad against it.
- **Trend / Insights**: Daily chart for the chosen measure (quiet days shown as zero) and short insights computed from the same data.
- **Detail table**: Sortable rows, "Filter rows" search, 25 rows per page, "CSV" downloads the filtered rows.

**Common problems and fixes**
- "No material actuals captured." — No issue, consumption or return was posted against jobs in the period.
- "This report could not be loaded. Try refreshing." — The server request failed or your role lacks this report. Press "Refresh"; if it repeats, ask an admin for access.
- "No figures for this period" — Nothing was recorded for the filters. Widen the period or clear filters.
- "No telemetry in selected period." — No job in the period has machine output logs. Ask work centers to log output on the terminal.
- "No shift tags captured in selected telemetry. / No shift schedule configured." — Output logs have no shift code, or the plant has no active shift definitions. Set up shifts in factory settings.

**If stuck**
1. Press "Refresh" (the report also refreshes every 3 minutes).
2. Switch to 90D or FY if the period is empty, and set Plant and Shift back to "All".
3. Read the yellow warning box; it names the missing data.

Related pages: /analytics/reports, /analytics/mrp, /analytics/reports/material-variance

**Not done yet / watch out**
- This report shows consumption variance, not the MRP shortage plan; the name can make users expect shortages here.

### OEE Deep Dive (/analytics/reports/oee)
Screen address: /analytics/reports/oee · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, WORK_CENTER_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=analytics-reports-oee

Machine-by-machine OEE = availability × performance × quality, with the plant headline, OEE bands and work-centre averages.

Open weekly to see which machines lose time, speed or quality. The "Where OEE is lost" panel shows the weakest factor, where effort pays back first.

**Before you start**
- Operators log output, scrap (with reason) and pauses/downtime on the work-center terminal.
- Each machine needs a standard rate (kg/h) in the machine master; otherwise its performance and OEE read 0%.

**Step by step**
1. Choose the period (7D, 30D, 90D, MTD, FY or Custom) and, if needed, Plant and Shift.
2. Check the chips at the top (period, "Updated", data coverage) and any yellow warning.
3. Read "OEE", "Availability", "Performance", "Quality", "Output", "Scrap", "Machines running", "Idle machines".
4. Use "Trend" (pick the measure) and "Insights" to see direction.
5. Read the breakdown panels and the detail table; use "Filter rows" and click column headers to sort.
6. Use "Review machine setup" to check downtime and missing rated capacity.
7. Download with "CSV" (rows) or "PDF" (whole report); "All reports" goes back to the Reports Hub.

**What is on the screen**
- **Availability**: Per machine: (24 h × days − downtime hours) ÷ (24 h × days). Calendar hours, not shift hours. Plant figure = average of running machines. Target 90%.
- **Performance**: Produced KG ÷ (standard rate kg/h × available hours), capped at 100%. Plant figure = total output ÷ total theoretical output. Target 95%.
- **Quality**: Produced ÷ (produced + scrap). Target 99%.
- **OEE**: Availability × performance × quality. Target 85% (world class).
- **Machines running / Idle machines**: Active machines with output, scrap or downtime in the period / active machines with none.
- **Machines by OEE band**: "World class (85%+)", "Stable (60–85%)", "Needs attention (<60%)".
- **Period (7D / 30D / 90D / MTD / FY / Custom)**: Date window. Default 30D. MTD = this month to date; FY = from 1 April. "Custom" shows "From date" and "To date". Filters are kept in the page address so the link can be shared.
- **Plant / Process / Shift**: Narrow the report to one plant or shift. The process filter is shown on every report but is not applied by the server today.
- **Machine logs / Material actuals / Shift tags**: Data coverage chips: % of jobs created in the period that have output logs; % that have material issued/consumed/returned; % of output logs carrying a shift code. Green 80%+, amber 30%+, red below; N/A when the report does not use it.
- **KPI tiles (On target / Below target)**: Up to 8 tiles. Where a target exists the tile turns good or bad against it.
- **Trend / Insights**: Daily chart for the chosen measure (quiet days shown as zero) and short insights computed from the same data.
- **Detail table**: Sortable rows, "Filter rows" search, 25 rows per page, "CSV" downloads the filtered rows.

**Common problems and fixes**
- "N active machine(s) have no standard rate (kg/h)…" — Set the standard rate on those machines in the machine master.
- "No machine telemetry found in the selected window." — No output, scrap or downtime on any active machine in the period.
- "This report could not be loaded. Try refreshing." — The server request failed or your role lacks this report. Press "Refresh"; if it repeats, ask an admin for access.
- "No figures for this period" — Nothing was recorded for the filters. Widen the period or clear filters.
- "No telemetry in selected period." — No job in the period has machine output logs. Ask work centers to log output on the terminal.
- "No shift tags captured in selected telemetry. / No shift schedule configured." — Output logs have no shift code, or the plant has no active shift definitions. Set up shifts in factory settings.

**If stuck**
1. Press "Refresh" (the report also refreshes every 3 minutes).
2. Switch to 90D or FY if the period is empty, and set Plant and Shift back to "All".
3. Read the yellow warning box; it names the missing data.

Related pages: /analytics/reports, /analytics/reports/downtime, /production/machine-selector, /factory/machines

**Not done yet / watch out**
- Availability uses 24-hour calendar days, not planned shift hours, so plants that run one shift will always show low availability and OEE.

### Operator Performance (/analytics/reports/operator)
Screen address: /analytics/reports/operator · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, WORK_CENTER_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=analytics-reports-operator

Leaderboard of operators: output, efficiency, scrap and jobs.

Open to recognise good operators and coach those with high scrap.

**Before you start**
- Jobs have an assigned operator.

**Step by step**
1. Choose the period (7D, 30D, 90D, MTD, FY or Custom) and, if needed, Plant and Shift.
2. Check the chips at the top (period, "Updated", data coverage) and any yellow warning.
3. Read "Active operators", "Output", "Avg efficiency", "Top performer" and the "Operator leaderboard".
4. Use "Trend" (pick the measure) and "Insights" to see direction.
5. Read the breakdown panels and the detail table; use "Filter rows" and click column headers to sort.
6. Download with "CSV" (rows) or "PDF" (whole report); "All reports" goes back to the Reports Hub.

**What is on the screen**
- **Output**: Produced quantity of jobs created in the period, by the job's assigned operator (top 20).
- **Avg efficiency**: Average of each operator's produced ÷ (produced + scrap). It is a yield, not a speed. Target 95%.
- **Top performer**: Operator with the highest efficiency.
- **Completion rate / Target achievement**: Completed jobs ÷ jobs; produced ÷ job quantity.
- **Period (7D / 30D / 90D / MTD / FY / Custom)**: Date window. Default 30D. MTD = this month to date; FY = from 1 April. "Custom" shows "From date" and "To date". Filters are kept in the page address so the link can be shared.
- **Plant / Process / Shift**: Narrow the report to one plant or shift. The process filter is shown on every report but is not applied by the server today.
- **Machine logs / Material actuals / Shift tags**: Data coverage chips: % of jobs created in the period that have output logs; % that have material issued/consumed/returned; % of output logs carrying a shift code. Green 80%+, amber 30%+, red below; N/A when the report does not use it.
- **KPI tiles (On target / Below target)**: Up to 8 tiles. Where a target exists the tile turns good or bad against it.
- **Trend / Insights**: Daily chart for the chosen measure (quiet days shown as zero) and short insights computed from the same data.
- **Detail table**: Sortable rows, "Filter rows" search, 25 rows per page, "CSV" downloads the filtered rows.

**Common problems and fixes**
- "This report could not be loaded. Try refreshing." — The server request failed or your role lacks this report. Press "Refresh"; if it repeats, ask an admin for access.
- "No figures for this period" — Nothing was recorded for the filters. Widen the period or clear filters.
- "No telemetry in selected period." — No job in the period has machine output logs. Ask work centers to log output on the terminal.
- "No shift tags captured in selected telemetry. / No shift schedule configured." — Output logs have no shift code, or the plant has no active shift definitions. Set up shifts in factory settings.

**If stuck**
1. Press "Refresh" (the report also refreshes every 3 minutes).
2. Switch to 90D or FY if the period is empty, and set Plant and Shift back to "All".
3. Read the yellow warning box; it names the missing data.

Related pages: /analytics/reports, /analytics/reports/production

**Not done yet / watch out**
- "Efficiency" is really a yield (good ÷ good + scrap), not output per hour, and only the top 20 operators by output are listed.
- Output is credited to the job's assigned operator, not to whoever actually logged the output.

### Production Performance (/analytics/reports/production)
Screen address: /analytics/reports/production · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, PLANNER, WORK_CENTER_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=analytics-reports-production

Output, yield, scrap and job completion for the period, split by process, work centre, shift, machine and operator.

Open daily or weekly to judge production and find the machine or process pulling yield down. Data comes from terminal output and scrap logs.

**Before you start**
- Operators log output, scrap (with reason) and pauses/downtime on the work-center terminal.
- Sales lines in pieces need a unit weight (g) so pieces can be converted to KG.

**Step by step**
1. Choose the period (7D, 30D, 90D, MTD, FY or Custom) and, if needed, Plant and Shift.
2. Check the chips at the top (period, "Updated", data coverage) and any yellow warning.
3. Read "Output", "Yield", "Scrap rate", "Job completion", "Jobs", "Output per machine", "Active machines", "Avg job size".
4. Use "Trend" (pick the measure) and "Insights" to see direction.
5. Read the breakdown panels and the detail table; use "Filter rows" and click column headers to sort.
6. Use "Turn this report into action" → "Resolve waiting jobs" to open the planner.
7. Download with "CSV" (rows) or "PDF" (whole report); "All reports" goes back to the Reports Hub.

**What is on the screen**
- **Output**: Good output logged in the period, in KG. Piece logs are converted only when the line's unit weight is known; others are left out.
- **Yield**: Output ÷ (output + scrap) × 100. Target 95%.
- **Scrap rate**: 100 − yield. Target 5% or less.
- **Job completion**: Jobs created in the period that are COMPLETED ÷ all jobs created in the period.
- **Output per machine / Active machines**: Output ÷ machines that had jobs in the period.
- **Avg job size**: Average planned KG of jobs (jobs without a KG conversion excluded).
- **Sections**: "Output by process", "Output by work centre", "Output by shift", "Job status mix", "Machine output", "Scrap reasons", "Output by operator"; table "Jobs in period".
- **Period (7D / 30D / 90D / MTD / FY / Custom)**: Date window. Default 30D. MTD = this month to date; FY = from 1 April. "Custom" shows "From date" and "To date". Filters are kept in the page address so the link can be shared.
- **Plant / Process / Shift**: Narrow the report to one plant or shift. The process filter is shown on every report but is not applied by the server today.
- **Machine logs / Material actuals / Shift tags**: Data coverage chips: % of jobs created in the period that have output logs; % that have material issued/consumed/returned; % of output logs carrying a shift code. Green 80%+, amber 30%+, red below; N/A when the report does not use it.
- **KPI tiles (On target / Below target)**: Up to 8 tiles. Where a target exists the tile turns good or bad against it.
- **Trend / Insights**: Daily chart for the chosen measure (quiet days shown as zero) and short insights computed from the same data.
- **Detail table**: Sortable rows, "Filter rows" search, 25 rows per page, "CSV" downloads the filtered rows.

**Common problems and fixes**
- "Jobs exist in the selected window but no execution output was logged." — Jobs were created but nobody logged output. Check the terminals.
- "Scrap exceeded good output in the selected production window." — More scrap than good output. Check for wrong entries (KG vs pieces) or a real quality problem.
- "N jobs have no reliable KG conversion…" — These jobs are in pieces without a unit weight. Add the unit weight on the sales line.
- "This report could not be loaded. Try refreshing." — The server request failed or your role lacks this report. Press "Refresh"; if it repeats, ask an admin for access.
- "No figures for this period" — Nothing was recorded for the filters. Widen the period or clear filters.
- "No telemetry in selected period." — No job in the period has machine output logs. Ask work centers to log output on the terminal.
- "No shift tags captured in selected telemetry. / No shift schedule configured." — Output logs have no shift code, or the plant has no active shift definitions. Set up shifts in factory settings.

**If stuck**
1. Press "Refresh" (the report also refreshes every 3 minutes).
2. Switch to 90D or FY if the period is empty, and set Plant and Shift back to "All".
3. Read the yellow warning box; it names the missing data.

Related pages: /analytics/reports, /production/planner, /analytics/reports/scrap, /analytics/reports/oee

**Not done yet / watch out**
- The Process filter is shown on all report pages but the server ignores it, so choosing a process does not change the numbers.
- Job completion and job counts use jobs created in the period, while output uses logs in the period, so a long job can count output in one period and completion in another.

### Sales Fulfillment (/analytics/reports/sales)
Screen address: /analytics/reports/sales · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, SALES · Share link: https://erp.totalpolyprint.com/guide?page=analytics-reports-sales

Order value, weight ordered, on-time completion, open and overdue orders, quote conversion, top customers and products.

Open weekly to review the order book and chase overdue orders.

**Before you start**
- Sales orders with delivery dates; challans dispatched.

**Step by step**
1. Choose the period (7D, 30D, 90D, MTD, FY or Custom) and, if needed, Plant and Shift.
2. Check the chips at the top (period, "Updated", data coverage) and any yellow warning.
3. Read "Order value", "Weight ordered", "On-time completion proxy", "Open orders", "Overdue orders", "Completed", "Quote conversion", "Repeat business".
4. Use "Trend" (pick the measure) and "Insights" to see direction.
5. Read the breakdown panels and the detail table; use "Filter rows" and click column headers to sort.
6. Use "Review overdue orders" to open Sales orders.
7. Download with "CSV" (rows) or "PDF" (whole report); "All reports" goes back to the Reports Hub.

**What is on the screen**
- **Order value / Weight ordered**: Line amounts and line weights of orders created in the period (cancelled orders excluded).
- **On-time completion proxy**: Completed orders whose last challan dispatch date (else confirmation or creation date) is on or before the delivery date ÷ completed orders. Not a true OTIF: quantity and POD are not checked.
- **Open orders / Overdue orders**: Orders not COMPLETED; of those, delivery date before today.
- **Quote conversion**: Quotations converted to a sales order ÷ quotations.
- **Sections**: "Order pipeline", "Top customers", "Products by value", "Most overdue orders"; table "Overdue orders".
- **Period (7D / 30D / 90D / MTD / FY / Custom)**: Date window. Default 30D. MTD = this month to date; FY = from 1 April. "Custom" shows "From date" and "To date". Filters are kept in the page address so the link can be shared.
- **Plant / Process / Shift**: Narrow the report to one plant or shift. The process filter is shown on every report but is not applied by the server today.
- **Machine logs / Material actuals / Shift tags**: Data coverage chips: % of jobs created in the period that have output logs; % that have material issued/consumed/returned; % of output logs carrying a shift code. Green 80%+, amber 30%+, red below; N/A when the report does not use it.
- **KPI tiles (On target / Below target)**: Up to 8 tiles. Where a target exists the tile turns good or bad against it.
- **Trend / Insights**: Daily chart for the chosen measure (quiet days shown as zero) and short insights computed from the same data.
- **Detail table**: Sortable rows, "Filter rows" search, 25 rows per page, "CSV" downloads the filtered rows.

**Common problems and fixes**
- "Completion timing is a proxy, not OTIF…" — Standing warning: the on-time figure is approximate until full-quantity and POD policy are set.
- "This report could not be loaded. Try refreshing." — The server request failed or your role lacks this report. Press "Refresh"; if it repeats, ask an admin for access.
- "No figures for this period" — Nothing was recorded for the filters. Widen the period or clear filters.
- "No telemetry in selected period." — No job in the period has machine output logs. Ask work centers to log output on the terminal.
- "No shift tags captured in selected telemetry. / No shift schedule configured." — Output logs have no shift code, or the plant has no active shift definitions. Set up shifts in factory settings.

**If stuck**
1. Press "Refresh" (the report also refreshes every 3 minutes).
2. Switch to 90D or FY if the period is empty, and set Plant and Shift back to "All".
3. Read the yellow warning box; it names the missing data.

Related pages: /analytics/reports, /sales/orders, /logistics/dispatch

**Not done yet / watch out**
- The on-time figure is a proxy, not OTIF: it does not check delivered quantity or proof of delivery, and short-closed orders that are not COMPLETED still count as open.

### Scrap & Yield (/analytics/reports/scrap)
Screen address: /analytics/reports/scrap · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, WORK_CENTER_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=analytics-reports-scrap

Production scrap, scrap rate, yield and cost of scrap, by reason, process, machine, operator and job.

Open to find the biggest source of waste and its cost. Covers scrap logged on machines only; store write-offs are in Scrap Center.

**Before you start**
- Operators log output, scrap (with reason) and pauses/downtime on the work-center terminal.
- Material cost snapshots exist for the cost of scrap.

**Step by step**
1. Choose the period (7D, 30D, 90D, MTD, FY or Custom) and, if needed, Plant and Shift.
2. Check the chips at the top (period, "Updated", data coverage) and any yellow warning.
3. Read "Scrap", "Scrap rate", "Yield", "Cost of scrap", "Scrap events", "Avg per event", "Top reason", "Worst machine".
4. Use "Trend" (pick the measure) and "Insights" to see direction.
5. Read the breakdown panels and the detail table; use "Filter rows" and click column headers to sort.
6. Use "Review production exceptions" to open the planner.
7. Download with "CSV" (rows) or "PDF" (whole report); "All reports" goes back to the Reports Hub.

**What is on the screen**
- **Scrap rate / Yield**: Scrap ÷ (good + scrap) and good ÷ (good + scrap). Targets 5% scrap, 95% yield.
- **Cost of scrap**: Scrap KG × average rate of all material cost snapshots. Blank if no rates exist.
- **Avg per event**: Scrap KG ÷ number of scrap logs.
- **Sections**: "Scrap by reason" (Pareto), "Scrap by process" with yield, "Scrap by machine", "Scrap by operator", "Jobs with the most scrap"; table "Scrap events".
- **Period (7D / 30D / 90D / MTD / FY / Custom)**: Date window. Default 30D. MTD = this month to date; FY = from 1 April. "Custom" shows "From date" and "To date". Filters are kept in the page address so the link can be shared.
- **Plant / Process / Shift**: Narrow the report to one plant or shift. The process filter is shown on every report but is not applied by the server today.
- **Machine logs / Material actuals / Shift tags**: Data coverage chips: % of jobs created in the period that have output logs; % that have material issued/consumed/returned; % of output logs carrying a shift code. Green 80%+, amber 30%+, red below; N/A when the report does not use it.
- **KPI tiles (On target / Below target)**: Up to 8 tiles. Where a target exists the tile turns good or bad against it.
- **Trend / Insights**: Daily chart for the chosen measure (quiet days shown as zero) and short insights computed from the same data.
- **Detail table**: Sortable rows, "Filter rows" search, 25 rows per page, "CSV" downloads the filtered rows.

**Common problems and fixes**
- "No scrap events were logged for the selected filter window." — No scrap logs in the period. Widen the dates or check that operators log scrap.
- "This report could not be loaded. Try refreshing." — The server request failed or your role lacks this report. Press "Refresh"; if it repeats, ask an admin for access.
- "No figures for this period" — Nothing was recorded for the filters. Widen the period or clear filters.
- "No telemetry in selected period." — No job in the period has machine output logs. Ask work centers to log output on the terminal.
- "No shift tags captured in selected telemetry. / No shift schedule configured." — Output logs have no shift code, or the plant has no active shift definitions. Set up shifts in factory settings.

**If stuck**
1. Press "Refresh" (the report also refreshes every 3 minutes).
2. Switch to 90D or FY if the period is empty, and set Plant and Shift back to "All".
3. Read the yellow warning box; it names the missing data.

Related pages: /analytics/reports, /analytics/scrap, /production/planner

**Not done yet / watch out**
- Cost of scrap uses one average rate across all material snapshots, not the rate of the material that was scrapped.

### Shift Performance (/analytics/reports/shift-performance)
Screen address: /analytics/reports/shift-performance · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, WORK_CENTER_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=analytics-reports-shift-performance

Output, scrap and downtime compared shift by shift.

Open to compare day and night shifts and spot a weak shift.

**Before you start**
- Operators log output, scrap (with reason) and pauses/downtime on the work-center terminal.
- Shifts are defined for the plant so logs carry a shift code.

**Step by step**
1. Choose the period (7D, 30D, 90D, MTD, FY or Custom) and, if needed, Plant and Shift.
2. Check the chips at the top (period, "Updated", data coverage) and any yellow warning.
3. Read "Output", "Scrap", "Downtime", "Shifts" and the "Shift comparison" panel.
4. Use "Trend" (pick the measure) and "Insights" to see direction.
5. Read the breakdown panels and the detail table; use "Filter rows" and click column headers to sort.
6. Download with "CSV" (rows) or "PDF" (whole report); "All reports" goes back to the Reports Hub.

**What is on the screen**
- **Output / Scrap**: Logged quantities per shift code; logs without a shift show as UNASSIGNED.
- **Downtime**: Downtime minutes per shift.
- **Shift comparison**: Each shift's output with yield (output ÷ output + scrap) and downtime.
- **Period (7D / 30D / 90D / MTD / FY / Custom)**: Date window. Default 30D. MTD = this month to date; FY = from 1 April. "Custom" shows "From date" and "To date". Filters are kept in the page address so the link can be shared.
- **Plant / Process / Shift**: Narrow the report to one plant or shift. The process filter is shown on every report but is not applied by the server today.
- **Machine logs / Material actuals / Shift tags**: Data coverage chips: % of jobs created in the period that have output logs; % that have material issued/consumed/returned; % of output logs carrying a shift code. Green 80%+, amber 30%+, red below; N/A when the report does not use it.
- **KPI tiles (On target / Below target)**: Up to 8 tiles. Where a target exists the tile turns good or bad against it.
- **Trend / Insights**: Daily chart for the chosen measure (quiet days shown as zero) and short insights computed from the same data.
- **Detail table**: Sortable rows, "Filter rows" search, 25 rows per page, "CSV" downloads the filtered rows.

**Common problems and fixes**
- "This report could not be loaded. Try refreshing." — The server request failed or your role lacks this report. Press "Refresh"; if it repeats, ask an admin for access.
- "No figures for this period" — Nothing was recorded for the filters. Widen the period or clear filters.
- "No telemetry in selected period." — No job in the period has machine output logs. Ask work centers to log output on the terminal.
- "No shift tags captured in selected telemetry. / No shift schedule configured." — Output logs have no shift code, or the plant has no active shift definitions. Set up shifts in factory settings.

**If stuck**
1. Press "Refresh" (the report also refreshes every 3 minutes).
2. Switch to 90D or FY if the period is empty, and set Plant and Shift back to "All".
3. Read the yellow warning box; it names the missing data.

Related pages: /analytics/reports, /analytics/reports/production

**Not done yet / watch out**
- Shift output and scrap add raw logged quantities without converting pieces to KG.

### Trading Pulse (/analytics/reports/trading)
Screen address: /analytics/reports/trading · Roles: ADMIN, OWNER, SUPER_ADMIN, SALES, PLANT_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=analytics-reports-trading

Report for traded goods and sellable materials: stock value, open trade orders, revenue, gross margin, top items and customers, slow movers and stock by plant.

Open to review trading business separately from manufacturing.

**Before you start**
- Trading goods and sellable materials are set up; trade orders are dispatched/invoiced.

**Step by step**
1. Pick "daily" (today), "weekly" (7 days), "monthly" (30 days, default) or "custom" with From/to dates.
2. Choose a plant or "All Plants".
3. Read "Trading Stock Value", "Open Trade Orders", "Revenue", "Gross Margin %".
4. Review "Trade Revenue Trend", "Status mix", "By item type", "Top items", "Top customers".
5. Act on "Slow movers — held stock with no dispatch in 60 days" and check "Stock by plant".
6. Press "Export PDF" to save, "Refresh" to reload.

**What is on the screen**
- **Trading Stock Value**: Trading-good stock × average cost + sellable material stock (bulk, packaging, rolls) × average cost.
- **Open Trade Orders**: Trade orders in DRAFT or CONFIRMED.
- **Revenue**: Grand total of trade orders DISPATCHED or INVOICED in the period, with % change against the previous period of the same length.
- **Gross Margin %**: (Pre-GST revenue − cost of goods) ÷ pre-GST revenue × 100; cost = qty × current average cost.
- **Slow movers**: Trading goods with stock but no dispatch in the last 60 days.

**Common problems and fixes**
- "Report forbidden" — The trading report needs sales view permission.

**If stuck**
1. Choose "monthly" if daily is empty.
2. If margin looks wrong, check average costs on trading stock.

Related pages: /analytics/reports, /analytics/kpis, /sales/orders

**Not done yet / watch out**
- Margin uses today's average cost, not the cost at the time of sale, so past margins change when costs change.

### Scrap Center (/analytics/scrap)
Screen address: /analytics/scrap · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=analytics-scrap

Production scrap logged on machines compared with scrap written off through stock adjustments, with process, machine and reason drill-downs.

Open to see total waste including store write-offs, which the Scrap & Yield report does not include.

**Before you start**
- Scrap is logged on the work-center terminal with a reason; adjustments are posted in Inventory.

**Step by step**
1. Choose "Plant" (or "All plants").
2. Set "Date From" and "Date To". Leave both empty to see all recorded history.
3. Read the six cards: "Production Scrap", "Adjustment Scrap", "Total Scrap", "Output", "Consumed", "Scrap Rate".
4. Check "By Process", "By Machine" and "By Reason".
5. Review "Recent Scrap Events"; press "Refresh" to reload.

**What is on the screen**
- **Production Scrap**: Sum of scrap logs on jobs in the period.
- **Adjustment Scrap**: Negative bulk adjustments plus rolls moved to scrap without a job (whole roll weight).
- **Total Scrap**: Production scrap + adjustment scrap.
- **Output**: Good output logged on machines.
- **Consumed**: Material consumption logged against jobs.
- **Scrap Rate**: Total scrap ÷ (output + total scrap) × 100.

**Common problems and fixes**
- "No scrap rows in this period" — Nothing was logged for the plant and dates. Widen the dates.

**If stuck**
1. Clear the dates and choose "All plants" to check that data exists.

Related pages: /analytics/reports/scrap, /inventory/adjustments, /analytics/reports/production

**Not done yet / watch out**
- Output and scrap here add raw quantities without unit conversion, so the scrap rate can differ from the Scrap & Yield report, which converts pieces to KG.
- Roll adjustment scrap counts at most 500 roll movements in the period.

## हर स्क्रीन (हिंदी)

### Analytics and Reports Hub (रिपोर्ट केंद्र) (/analytics)
स्क्रीन का पता: /analytics · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=analytics&lang=hi

पूरे प्लांट के मुख्य आँकड़े एक जगह: OEE, scrap rate, availability, efficiency, बुक हुए order की कीमत और output। साथ में roll reuse pool, POD stock, ट्रेंड और आपकी खुलने वाली रिपोर्टों की सूची।

दिन की शुरुआत में या review meeting से पहले खोलें। देखें प्लांट ठीक चल रहा है या नहीं, फिर जिस रिपोर्ट पर ध्यान चाहिए उसमें जाएँ। Admin और Owner यहीं से daily report pack बनाते और जाँचते हैं।

**शुरू करने से पहले**
- Work-center terminal पर output, scrap और downtime दर्ज होना चाहिए, वरना OEE, scrap और efficiency में "Pending" दिखेगा।
- आपके role को Reports Hub की अनुमति (page.analytics.home.view) चाहिए।
- Daily report pack की सेटिंग Admin, Report Center (/system/report-center) में करता है।

**स्टेप बाय स्टेप**
1. ऊपर के छह कार्ड पढ़ें: "OEE", "Scrap Rate", "Availability", "Efficiency", "Revenue", "Output"।
2. "Operational KPI Pulse" देखें: हर पट्टी अपने target के सामने है (OEE 85, Availability 90, Efficiency 92, Scrap 2.5 या कम)।
3. "Live Trendboard" में पिछले 7 दिन का production और sales ट्रेंड देखें।
4. "Reuse and Exception Signals" और "SKU and Customer Leaders" में खुले जोखिम और top product/customer देखें।
5. "Available Reports" में किसी रिपोर्ट कार्ड पर क्लिक करके उसे खोलें।
6. Admin/Owner: "Report Generation Control" में "Generate <pack name> now" दबाकर आज का pack बनाएँ; "Run History Snapshot" में जाँचें।
7. दोबारा लोड करने के लिए ऊपर दाईं ओर "Refresh" दबाएँ; पेज हर 2 मिनट में खुद भी ताज़ा होता है।

**स्क्रीन पर क्या है**
- **स्क्रीन पर: "OEE"**: पूरे प्लांट का जल्दी वाला अनुमान = Availability × quality ÷ 100। Quality = 100 − scrap rate। यह OEE Deep Dive रिपोर्ट के मशीन-वार OEE जैसा नहीं है।
- **स्क्रीन पर: "Scrap Rate"**: Scrap ÷ (अच्छा output + scrap) × 100। आज के log से; आज कुछ दर्ज नहीं हुआ तो पिछले 7 दिन से।
- **स्क्रीन पर: "Availability"**: सभी मशीनों का औसत: (24 घंटे × 7 दिन − downtime) ÷ (24 घंटे × 7 दिन)। यह कैलेंडर घंटे गिनता है, shift घंटे नहीं।
- **स्क्रीन पर: "Efficiency"**: Score = 0.6 × OEE + 0.4 × quality।
- **स्क्रीन पर: "Revenue"**: बुक हुए order की कीमत: पिछले 30 दिन की sales order lines की कुल राशि (invoice वाली कमाई नहीं)।
- **स्क्रीन पर: "Output"**: पिछले 30 दिन का production output (KG में)।
- **स्क्रीन पर: "Pending"**: जब production का कोई सबूत न हो या डेटा न पढ़ा जा सके तब दिखता है। पेज कभी झूठा शून्य नहीं दिखाता।
- **स्क्रीन पर: "Final Roll Pool / Invariant Pool / Upstream Pool"**: Planner जो roll stock (KG) दोबारा इस्तेमाल कर सकता है: सीधे FG बनने लायक roll, मेल खाते बीच के roll, और ऊपर के stage के roll जो आगे route में जा सकते हैं।
- **स्क्रीन पर: "POD Stock Target / Active POD SKUs"**: योजना वाले POD stock order और उनका target KG, और कितने POD SKU व variant चालू हैं।
- **स्क्रीन पर: "Recent Report Runs"**: हाल में बने daily report pack (केवल admin/owner)।

**आम दिक्कतें और हल**
- "संदेश: "Reports Hub could not load live analytics."" — Summary request फेल हुआ। कार्ड शून्य दिखाने के बजाय रोक दिए गए हैं। "Refresh" दबाएँ; फिर भी रहे तो admin को बताएँ।
- "संदेश: "Report catalog data could not be loaded."" — रिपोर्टों की सूची लोड नहीं हुई। पेज refresh करें।
- "संदेश: "Report activity degraded"" — Report runs या pack की सेटिंग लोड नहीं हुई (अक्सर role admin/owner नहीं होने से)। ऊपर के live आँकड़े फिर भी चलते हैं।
- "संदेश: "No execution telemetry is recorded for the current window."" — इस अवधि में मशीनों पर कोई output दर्ज नहीं हुआ। Work center से terminal पर output दर्ज करवाएँ।

**अटक गए तो**
1. "Refresh" दबाएँ और एक मिनट रुकें।
2. किसी कार्ड पर "Pending" हो तो उससे जुड़ी रिपोर्ट (Production, OEE, Scrap) खोलकर देखें कि कौन सा डेटा कमी है।
3. कोई रिपोर्ट कार्ड न दिखे तो आपके role को वह रिपोर्ट नहीं मिली; admin से पूछें।

जुड़े पेज: /analytics/reports, /analytics/kpis, /analytics/costing, /analytics/reports/production, /analytics/reports/oee, /analytics/reports/scrap, /system/report-center

**अभी नहीं होता / ध्यान दें**
- Hub का OEE कार्ड जल्दी वाला अनुमान है (7 दिन availability × quality), यह OEE Deep Dive रिपोर्ट से मेल नहीं खाएगा क्योंकि वहाँ मशीन का standard rate भी लगता है।
- Hub पर तारीख या plant का कोई filter नहीं है; यह हमेशा तय अवधि (आज/7 दिन/30 दिन) दिखाता है।
- दो hub पेज हैं: /analytics और /analytics/reports; दोनों में रिपोर्ट और daily pack हैं, इससे भ्रम हो सकता है।

### Capability Matrix (क्षमता सूची) (/analytics/capability-matrix)
स्क्रीन का पता: /analytics/capability-matrix · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANNER, PLANT_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=analytics-capability-matrix&lang=hi

केवल पढ़ने वाली सूची: ERP आज क्या कर सकता है, क्या सिर्फ सेटिंग से हो सकता है, और किसके लिए नया code चाहिए।

ग्राहक से नया product या process का वादा करने से पहले, या नया master बनाने से पहले खोलें। इससे पता चलता है कि ERP यह संभाल सकता है या नहीं।

**शुरू करने से पहले**
- कुछ सेट नहीं करना। सूची development team की एक तय फाइल (docs/runbooks/capability-registry.json) से आती है।

**स्टेप बाय स्टेप**
1. तीनों भाग क्रम से पढ़ें: "Supported Today", "Config Only Extensions", "Needs New Physical Logic"।
2. हर कार्ड में "What it means" और "Why" पढ़ें।
3. "Examples" देखकर अपना मामला मिलाएँ।
4. "Needs only config" में master/सेटिंग का काम और "Needs code / module" में development का काम देखें।
5. कोई वादा करने से पहले "Limits" पढ़ें।

**स्क्रीन पर क्या है**
- **स्क्रीन पर: "Supported Today"**: अभी चलता है: flexible packaging का मुख्य काम (roll, pouch, route) और operational costing।
- **स्क्रीन पर: "Config Only Extensions"**: Master या सेटिंग जोड़कर हो सकता है, जैसे master data बढ़ाना, report distribution।
- **स्क्रीन पर: "Needs New Physical Logic"**: Development चाहिए: नए manufacturing तरीके और नए traceability मॉडल।
- **स्क्रीन पर: "Needs only config / Needs code / module"**: "Nothing extra" या "No new code needed" का मतलब उस कार्ड में कुछ नहीं चाहिए।

**आम दिक्कतें और हल**
- "संदेश: "Capability matrix could not be loaded."" — Server पर registry फाइल नहीं है या request फेल हुआ। Admin से deployment जँचवाएँ।

**अटक गए तो**
1. पेज दोबारा लोड करें।
2. फिर भी न चले तो admin को बताएँ; इस पेज पर आप खुद कुछ ठीक नहीं कर सकते।

जुड़े पेज: /analytics, /factory/plants, /engineering/routing

**अभी नहीं होता / ध्यान दें**
- सूची एक स्थिर फाइल है; ERP से बदली नहीं जाती और नए release के बाद पुरानी हो सकती है।
- Registry में status code नहीं हैं, इसलिए हरा/पीला/लाल रंग नहीं दिखता और सभी भाग एक जैसे दिखते हैं।

### Costing Center (लागत केंद्र) (/analytics/costing)
स्क्रीन का पता: /analytics/costing · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=analytics-costing&lang=hi

हर प्लांट का महीने का cost close: बिजली, labour, overhead, maintenance और service खर्च भरें, cost group में बाँटें, review करें और महीना lock करें। Cost group का master भी यहीं है।

महीने के अंत में (या bill आने पर) प्लांट का मासिक खर्च भरने के लिए खोलें। यह pool उस महीने के मशीन चलने के घंटों से बाँटकर ₹/घंटा rate बनता है, जो हर job और order पर लगता है। Lock हुआ महीना बदला नहीं जा सकता।

**शुरू करने से पहले**
- Plant, work center और machine बने हों, और हर एक पर cost group लगा हो (machine override → work-center default → route step → plant default)।
- कम से कम एक cost group हो ("Cost groups" → "New Cost Group")।
- Operator terminal पर job start/stop करें ताकि चलने के घंटे दर्ज हों; घंटे न हों तो pool "unabsorbed" रहता है।

**स्टेप बाय स्टेप**
1. ऊपर "Month close" चुनें।
2. "Plant month" में "Plant", "Year", "Month" चुनें; entry model "Direct" (हर group अलग भरें) या "Allocated" (प्लांट का कुल % से बाँटें) चुनें।
3. "Create or reopen plant month" दबाएँ। महीना "Recent months" में दिखेगा।
4. "Plant month workspace" में "Electricity", "Labor", "Overhead", "Maintenance", "Service burden" और "Month notes" भरें, फिर "Save month totals" दबाएँ।
5. Allocated में हर group कार्ड पर "Alloc %" भरें और "Allocate from totals" दबाएँ। Direct में हर group कार्ड पर राशि लिखें और एक-एक करके "Save Group" दबाएँ।
6. "Close health" और "Margin leakage" (सबसे कम margin वाले order) देखें।
7. आँकड़े पक्के होने पर "Mark reviewed" और फिर "Lock month" दबाएँ।
8. Group जोड़ने/बदलने के लिए "Cost groups" चुनें, "New Cost Group" (या पेंसिल) दबाएँ, "Code", "Label", "Description", "Default intensity factor", Active भरें, फिर "Create Group" / "Save Group"।

**स्क्रीन पर क्या है**
- **स्क्रीन पर: "Actual-cost coverage"**: Order cost में 3 हिस्सों में से कितने असली हैं उसका औसत: issue हुआ material, चलने के घंटों से conversion, absorbed overhead। 100% = पूरा असली; 0% = पूरा अनुमान।
- **स्क्रीन पर: "Unabsorbed pool"**: महीने का वह खर्च जो job पर नहीं लग पाया क्योंकि उस cost group में उस महीने कोई चलने के घंटे नहीं थे।
- **स्क्रीन पर: "Cost groups / Locked months"**: Cost bucket की संख्या, और कितने महीने lock हो चुके।
- **स्क्रीन पर: "Electricity, Labor (conversion)"**: Conversion rate प्रति घंटा = (बिजली + labour) ÷ उस plant-month में उस cost group के चलने के घंटे।
- **स्क्रीन पर: "Overhead, Maintenance, Service burden"**: Overhead rate प्रति घंटा = (overhead + maintenance + service burden) ÷ वही चलने के घंटे।
- **स्क्रीन पर: "Alloc %"**: केवल Allocated में: प्लांट के कुल में से इस group का हिस्सा (राशि = कुल × % ÷ 100)।
- **स्क्रीन पर: "Status DRAFT / REVIEWED / LOCKED"**: हर महीने पर badge। LOCKED महीना और उसकी lines बदली नहीं जा सकतीं।
- **स्क्रीन पर: "Actual / Hybrid / Estimated orders"**: जिन order cost में 3 में से 3 हिस्से असली, 1–2 असली, या कोई नहीं।
- **स्क्रीन पर: "Assignment precedence"**: पहले machine override, फिर work-center default, फिर route step, फिर plant default। गिनती दिखाती है किन plant/work center में default नहीं है और कौन सी मशीन inherit कर रही है।
- **स्क्रीन पर: "Default intensity factor"**: Cost group का भार (master में रखा जाता है)।

**आम दिक्कतें और हल**
- "संदेश: "Locked cost pool months and their lines cannot be changed."" — महीना LOCKED है। Unlock बटन नहीं है; सच में सुधार चाहिए तो admin से बात करें।
- "संदेश: "percentages object is required."" — "Alloc %" भरे बिना "Allocate from totals" दबाया। पहले प्रतिशत भरें।
- "संदेश: "A cost pool line cannot be moved to another month."" — Group line एक ही महीने की होती है। सही महीना खोलकर वहीं भरें।
- "Unabsorbed pool ज़्यादा है" — उस cost group की मशीनों पर चलने के घंटे दर्ज नहीं हुए (terminal पर job start/stop नहीं हुआ) या मशीन पर cost group नहीं है।

**अटक गए तो**
1. पहले plant चुनें; plant के बिना "Create or reopen plant month" बंद रहता है।
2. पहले totals save करें, फिर allocate, फिर review।
3. Coverage कम हो तो देखें कि job पर material issue हुआ है और operator terminal पर job start/stop करते हैं।
4. Cost group की कमी ठीक करने के लिए "Open Plants", "Open Work Centers", "Open Machines" इस्तेमाल करें।

जुड़े पेज: /analytics/process-rates, /analytics/orders/costing, /analytics/reports/costing, /factory/plants, /factory/work-centers, /factory/machines

**अभी नहीं होता / ध्यान दें**
- "Lock month" बिना review के भी चल जाता है, और न कोई पुष्टि पूछी जाती है न unlock बटन है।
- Cost group का delete (कूड़ेदान) बटन बिना पुष्टि पूछे delete कर देता है।
- Month totals और group lines अलग-अलग save होते हैं; Direct mode में totals बदलने से group lines अपने आप नहीं बदलतीं।

### KPIs (पुराना link) (/analytics/kpi)
स्क्रीन का पता: /analytics/kpi · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=analytics-kpi&lang=hi

पुराना पता। यह सीधे /analytics/kpis (Executive Control Center) पर भेज देता है।

पुराने bookmark और link चलते रहें इसलिए रखा है। सीधे /analytics/kpis खोलें।

**शुरू करने से पहले**
- KPIs पेज जैसी ही अनुमति।

**स्टेप बाय स्टेप**
1. पुराना link /analytics/kpi खोलें।
2. पेज तुरंत आगे भेजता है; आप "Executive Control Center" पर पहुँचेंगे।
3. KPIs पेज हमेशा की तरह इस्तेमाल करें (timeframe, tiles, panels)।
4. अपना bookmark /analytics/kpis पर बदल लें।

**स्क्रीन पर क्या है**
- **स्क्रीन पर: "Redirect"**: अपने आप होता है; कुछ भरना नहीं।

**आम दिक्कतें और हल**
- "Redirect के बाद पेज की अनुमति नहीं" — आपके role को KPIs की अनुमति नहीं। Admin से पूछें।

**अटक गए तो**
1. "Reports & admin" मेनू के "KPIs" tab से /analytics/kpis खोलें।

जुड़े पेज: /analytics/kpis

### Executive Control Center (मालिक का डैशबोर्ड) (/analytics/kpis)
स्क्रीन का पता: /analytics/kpis · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=analytics-kpis&lang=hi

मालिक के लिए पूरी कंपनी के live KPI: बुक order की कीमत, margin, output, overdue order, stock, scrap, utilisation, cost coverage, P&L, order book, top customer, material और ink अनुशासन, POD, procurement, trading, live floor और alerts।

रोज़ (या review meeting में) खोलें ताकि पूरा कारोबार एक स्क्रीन पर दिखे और जिस हिस्से पर काम चाहिए उसमें क्लिक करें। यह owner dashboard वाला ही deck है, Analytics नाम से।

**शुरू करने से पहले**
- Sales order, production log और costing दर्ज हों; खाली हिस्सों में "No production logged in the last 30 days" जैसे संदेश दिखते हैं।

**स्टेप बाय स्टेप**
1. "Timeframe" चुनें: "day", "week", "month" (default) या "year" (पिछले 1, 7, 30 या 365 दिन)।
2. ऊपर के आँकड़े पढ़ें: "Booked order value", "Gross margin", "Production output", "Overdue orders"।
3. Tiles "Inventory on hand", "Scrap", "Machine utilisation", "Actual-cost coverage" देखें (हर एक अपनी रिपोर्ट खोलता है)।
4. "Profit & loss" और "Six-month financials" देखें।
5. "Order book health" (Overdue / Ready to ship), "Top customers", "SKU Performance", "Stock position", "Job status" देखें।
6. "Material discipline" और "Ink control" देखें।
7. "Alerts & risk signals" पर काम करें; "Full report", "Costing centre", "Orders", "Purchase orders", "Trading pulse", "Live production" link इस्तेमाल करें।
8. दोबारा लाने के लिए "Refresh" दबाएँ।

**स्क्रीन पर क्या है**
- **स्क्रीन पर: "Booked order value"**: Timeframe में sales order lines की कुल राशि। यह order की कीमत है, invoice वाली कमाई नहीं।
- **स्क्रीन पर: "Gross margin"**: दर्ज order cost से: revenue − (material + conversion + absorbed overhead), revenue के % में। Cost न हो तो "actual costing not posted" दिखता है।
- **स्क्रीन पर: "Production output"**: Timeframe में बना KG, पिछली अवधि से % बदलाव के साथ।
- **स्क्रीन पर: "Overdue orders"**: खुले order जिनकी वादा की गई delivery तारीख निकल गई।
- **स्क्रीन पर: "Inventory on hand"**: Stock का वज़न और अनुमानित कीमत (bulk और packaging, weighted average cost पर)।
- **स्क्रीन पर: "Machine utilisation"**: मशीन का वह समय जो downtime में नहीं गया (कैलेंडर घंटे)।
- **स्क्रीन पर: "Actual-cost coverage"**: Order costing कितना असली material, घंटे और overhead पर आधारित है (Costing Center देखें)।
- **स्क्रीन पर: "Profit & loss"**: Revenue − material − conversion − absorbed overhead = gross profit; उसमें से unabsorbed overhead घटाकर = net profit।
- **स्क्रीन पर: "Material discipline"**: Issue discipline (issue बनाम planned issue; 110% से ऊपर लाल), return efficiency, theoretical से variance (12% से ऊपर लाल)।
- **स्क्रीन पर: "Ink control"**: Issue के सामने खपत और वापस हुई ink, और remix ratio (30% से ऊपर पीला)।
- **स्क्रीन पर: "Route Reuse Pools"**: Reuse के लिए उपलब्ध final, invariant और upstream roll pool (KG)।

**आम दिक्कतें और हल**
- "आँकड़े की जगह — दिखता है" — उस timeframe में डेटा नहीं या स्रोत उपलब्ध नहीं। लंबा timeframe चुनें।
- "संदेश: "Waiting for material postings"" — Job पर अभी material issue/खपत दर्ज नहीं हुई।

**अटक गए तो**
1. Day view खाली हो तो "month" या "year" चुनें।
2. "Refresh" दबाएँ; डेटा थोड़ी देर cache रहता है।

जुड़े पेज: /analytics, /analytics/costing, /analytics/reports/production, /analytics/reports/scrap, /analytics/reports/oee, /sales/orders, /logistics/dispatch, /procurement/purchase-orders, /analytics/reports/trading

**अभी नहीं होता / ध्यान दें**
- Plant filter नहीं है; हर आँकड़ा पूरी कंपनी का है।

### MRP Center (सामग्री योजना) (/analytics/mrp)
स्क्रीन का पता: /analytics/mrp · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANNER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=analytics-mrp&lang=hi

Material Requirement Planning: खुले order को क्या चाहिए (उनके frozen BOM से) जोड़ता है, stock और आने वाला WIP घटाता है, और कमी के साथ सुझाव देता है (खरीदें, बनाएँ, transfer करें)।

हर सुबह खोलें (engine रात 02:00 IST पर भी चलता है)। देखें कौन सा material कम पड़ेगा और purchase order का draft बनाएँ। कमी पक्के sales order और planned stock order से आती है; draft Procurement में जाता है।

**शुरू करने से पहले**
- Sales order line में BOM snapshot होना चाहिए (बिना उसके line छूट जाती है)।
- Material master में category और unit; खरीद अनुमान के लिए material cost snapshot।
- कम से कम एक vendor और एक plant हो (PO draft के लिए ज़रूरी)।

**स्टेप बाय स्टेप**
1. "Plan run" में run चुनें (default में नवीनतम साफ़ run चुना जाता है)।
2. आज की माँग और stock से ताज़ा करने के लिए "Run planning engine" दबाएँ।
3. "Overview" में "Demand", "Effective supply", "Shortage gap", "Coverage ratio", "Purchase exposure", "Drafted actions" पढ़ें।
4. हर जोखिम वाला material देखने के लिए "Material gaps" खोलें; ज़रूरत हो तो category filter लगाएँ।
5. "Draft actions" खोलें: खरीद के लिए "Create PO", बनाने के लिए "Open planner", transfer के लिए "Open transfers" दबाएँ।
6. सभी ज़रूरी चीज़ें एक साथ खरीदने के लिए "Draft all HIGH (n)" दबाएँ और "Draft n POs for HIGH-priority items?" की पुष्टि करें।
7. क्या बदला देखने के लिए "Compare with previous run"; draft PO, Purchase orders में vendor और दाम जाँचने के लिए खुलता है।

**स्क्रीन पर क्या है**
- **स्क्रीन पर: "Demand"**: कुल ज़रूरी KG: sales order lines की बाकी मात्रा (BOM snapshot से) + planned stock (MTS) order। इस कुल में केवल KG वाले material जुड़ते हैं।
- **स्क्रीन पर: "Effective supply"**: उपलब्ध stock (bulk + packaging stock + AVAILABLE roll) + released/planned packaging stock order का WIP। खुले purchase order नहीं गिने जाते।
- **स्क्रीन पर: "Shortage gap"**: हर material: माँग − stock − WIP (0 से नीचे नहीं), सबका जोड़।
- **स्क्रीन पर: "Coverage ratio"**: Effective supply ÷ demand × 100।
- **स्क्रीन पर: "Purchase exposure"**: खरीद सुझावों की अनुमानित लागत = कमी × नवीनतम material rate (rate न हो तो 0)।
- **स्क्रीन पर: "Priority HIGH / MEDIUM / LOW"**: कमी के आकार से: 500 या ज़्यादा = HIGH, 100–499 = MEDIUM, 100 से कम = LOW।
- **स्क्रीन पर: "Action type"**: Granule, ink, adhesive, solvent, additive, packaging, add-on और खरीदी film/POD → Purchase (7 दिन में)। Extrude होने वाली film और घर में बनने वाला POD → Produce (2 दिन)। दूसरे plant में stock → Transfer (आज)।
- **स्क्रीन पर: "Audit only"**: असामान्य totals वाला run (माँग या कमी 5,000,000 KG या ज़्यादा, supply 1,000,000 KG या ज़्यादा) केवल audit के लिए रखा जाता है, trend में नहीं गिना जाता; उस पर PO draft नहीं होता।
- **स्क्रीन पर: "Non-KG shortages"**: Pieces या metre में गिने material; अलग दिखाए जाते हैं, KG में नहीं जोड़े जाते।

**आम दिक्कतें और हल**
- "संदेश: "No vendor available — create a vendor master first."" — Draft PO पर लगाने के लिए कोई vendor नहीं। Vendor master में vendor बनाएँ।
- "संदेश: "No plant available — create a plant master first."" — कोई plant नहीं। Factory → Plants में बनाएँ।
- "संदेश: "Draft PO is valid only for PURCHASE suggestions."" — Produce/transfer सुझाव पर खरीद की कोशिश। "Open planner" या "Open transfers" इस्तेमाल करें।
- "संदेश: "Audit-only MRP run selected"" — चुना गया run असामान्य है। PO draft से पहले नवीनतम साफ़ run चुनें।
- "संदेश: "No HIGH PURCHASE suggestions pending"" — इस run में कोई ज़रूरी खरीद नहीं। नए order के बाद engine फिर चलाएँ।
- "संदेश: "MRP failed"" — Engine गड़बड़ी से रुका; run FAILED के रूप में सहेजा गया। फिर चलाएँ; बार-बार हो तो admin को बताएँ।

**अटक गए तो**
1. जो material दिखना चाहिए वह न दिखे तो देखें order line पक्की है और उसमें BOM snapshot है।
2. कमी बहुत ज़्यादा लगे तो याद रखें खुले PO supply में नहीं गिने जाते; दोबारा खरीदने से पहले Purchase orders देखें।
3. Bulk draft के बाद संदेश पढ़ें: "Drafted n POs · m failed" का मतलब कुछ हाथ से बनाने होंगे।

जुड़े पेज: /procurement/purchase-orders, /production/planner, /inventory/inter-plant, /analytics/reports/mrp, /sales/orders

**अभी नहीं होता / ध्यान दें**
- खुले purchase order और रास्ते में माल supply में नहीं गिने जाते, इसलिए GRN होने तक वही कमी दिखती रहती है।
- "Run planning engine" हमेशा सभी plants के लिए चलता है; पेज पर plant चुनने का विकल्प नहीं, इसलिए Transfer सुझाव केवल plant-वार run से आते हैं।
- Draft PO में vendor उस material की आखिरी receipt से, या नाम से पहला चालू vendor लिया जाता है; PO पर vendor और दाम ज़रूर जाँचें।
- उपलब्ध stock में दूसरी job के लिए रखी चीज़ें नहीं घटतीं, सिवाय उन roll के जो AVAILABLE status में नहीं हैं।

### Order Profitability (एक order line) (/analytics/orders/[id]/costing)
स्क्रीन का पता: /analytics/orders/[id]/costing · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=analytics-orders-id-costing&lang=hi

एक sales order line का मुनाफ़ा: sales price, material cost, conversion cost, कुल cost और margin। [id] sales order line का id है।

Order Profitability के तीर बटन से खोलें; देखें line घाटे में क्यों है, या material issue और production दर्ज होने के बाद दोबारा गणना करें।

**शुरू करने से पहले**
- Line की कीमत (line amount) हो। Job, material issue और चलने के घंटे से cost असली बनती है; नहीं तो BOM और process rate से अनुमान लगता है।

**स्टेप बाय स्टेप**
1. "Cost Data Not Found" दिखे तो "Initialize Cost Calculation" दबाएँ।
2. "Net Profit Margin" (% और "Margin Value") पढ़ें; 15% से ऊपर "Healthy Profit", नहीं तो "Low Margin Alert"।
3. "Sales Price", "Material Cost" और "Conversion Cost" की तुलना करें।
4. Material और conversion का हिस्सा "Total Lifecycle Cost Impact" में देखें।
5. नए production या issue के बाद दोबारा गणना के लिए "Refresh Deep-Dive" दबाएँ।
6. Costing Center पर लौटने के लिए "Back to Center"।

**स्क्रीन पर क्या है**
- **स्क्रीन पर: "Sales Price"**: Sales order line की राशि।
- **स्क्रीन पर: "Material Cost"**: असली: हर job ज़रूरत के लिए (issue − वापसी, या खपत + scrap) × नवीनतम material rate, साथ में line के लिए खर्च हुई packaging और bulk। असली न हो तो: BOM snapshot मात्रा × rate।
- **स्क्रीन पर: "Conversion Cost"**: असली: चलने के घंटे × plant-month pool का conversion rate। न हो तो अनुमान = (order KG ÷ 150) घंटे × हर route step का process rate (rate न हो तो ₹800/घंटा)।
- **स्क्रीन पर: "Total cost"**: Material + conversion + absorbed overhead (overhead केवल असली चलने के घंटों से)।
- **स्क्रीन पर: "Net Profit Margin / Margin Value"**: Absorbed margin = sales price − कुल cost; % = margin ÷ sales price × 100।

**आम दिक्कतें और हल**
- "संदेश: "Sales Order Item not found."" — पते का id sales order line नहीं है। Order Profitability से line खोलें।
- "संदेश: "Could not calculate cost."" — इस line के लिए गणना नहीं हुई। देखें line में BOM snapshot और कीमत है।

**अटक गए तो**
1. Cost बहुत कम लगे तो material rate नहीं होगा (rate न हो तो ₹0 गिना जाता है); material cost snapshot जोड़ें।
2. Month close के बाद "Refresh Deep-Dive" दबाएँ ताकि नए pool rate लगें।

जुड़े पेज: /analytics/orders/costing, /analytics/costing, /analytics/process-rates, /sales/orders

**अभी नहीं होता / ध्यान दें**
- "Material Components" और "Process Routing Costs" पैनल खाली नमूने हैं; material-वार या step-वार ब्योरा नहीं दिखता।
- पेज costing mode (Actual/Hybrid/Estimated) या coverage % नहीं दिखाता, इसलिए पूरा अनुमान और असली cost एक जैसे दिखते हैं।
- "Back to Center" Costing Center पर ले जाता है, Order Profitability सूची पर नहीं।

### Order Profitability (order का मुनाफ़ा) (/analytics/orders/costing)
स्क्रीन का पता: /analytics/orders/costing · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=analytics-orders-costing&lang=hi

हर costed sales order line की सूची: material, conversion, कुल cost, sales price और margin।

घाटे या कम margin वाली lines ढूँढने और किसी line में जाने के लिए खोलें।

**शुरू करने से पहले**
- Order cost बने हों (line की cost गणना होने पर बनते हैं)।

**स्टेप बाय स्टेप**
1. सूची छोटी करने के लिए "Filter orders, customers or SKUs..." में लिखें।
2. "Margin Health" पढ़ें: लाल = घाटा, पीला = 15% से कम, हरा = ठीक।
3. Line के "Direct Material", "Conversion", "Total Cost" और "Sales Price" की तुलना करें।
4. उस line का मुनाफ़ा पेज खोलने के लिए पंक्ति के अंत का तीर दबाएँ।
5. नए production के बाद line पेज पर "Refresh Deep-Dive" दबाएँ ताकि यहाँ आँकड़े ताज़ा हों।

**स्क्रीन पर क्या है**
- **स्क्रीन पर: "Order Details"**: Order number, customer और product।
- **स्क्रीन पर: "Direct Material"**: Line की material cost (असली, या BOM अनुमान)।
- **स्क्रीन पर: "Conversion"**: मशीन/labour cost (असली घंटे × pool rate, या अनुमान)।
- **स्क्रीन पर: "Total Cost"**: Material + conversion + absorbed overhead।
- **स्क्रीन पर: "Sales Price"**: Line की राशि।
- **स्क्रीन पर: "Margin Health"**: Sales price − कुल cost, और sales price का %। ऋणात्मक हो तो "Loss"।

**आम दिक्कतें और हल**
- "संदेश: "No matching orders found in the ledger"" — Filter से कोई cost row नहीं मिली, या अभी गणना नहीं हुई। Filter हटाएँ या line की गणना करें।

**अटक गए तो**
1. Search box खाली करें।
2. Line खोलें और cost न हो तो "Initialize Cost Calculation" दबाएँ।

जुड़े पेज: /analytics/orders/[id]/costing, /analytics/costing, /analytics/reports/costing

**अभी नहीं होता / ध्यान दें**
- "Export" और filter बटन अभी कुछ नहीं करते।
- जिन lines की गणना नहीं हुई वे नहीं दिखतीं; इस सूची से सभी lines की गणना करने का बटन नहीं है।

### Process Rates (प्रक्रिया दर) (/analytics/process-rates)
स्क्रीन का पता: /analytics/process-rates · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=analytics-process-rates&lang=hi

हर process की प्रति घंटा दर (बिजली, labour, overhead), चाहें तो मशीन के लिए अलग। जब असली चलने के घंटे न हों तब conversion cost के अनुमान में इस्तेमाल होती है।

एक बार सेट करें और बिजली या मज़दूरी दर बदलने पर बदलें। अनुमान के लिए order costing इन दरों का इस्तेमाल करता है; असली cost, Costing Center के मासिक pool से आती है।

**शुरू करने से पहले**
- Factory → Processes में process बने हों; मशीन override के लिए मशीन बनी हों।

**स्टेप बाय स्टेप**
1. "New Override" दबाएँ।
2. "Target Process" चुनें और ज़रूरत हो तो "Specific Machine (Optional)" (सभी मशीनों के लिए "General Process Rate" रहने दें)।
3. "Power/hr", "Labor/hr", "Overhead/hr" ₹ में भरें और "Registry Override" दबाएँ।
4. दर बदलने के लिए "Master Process Rate Matrix" में अंक बदलें और उस पंक्ति का save icon दबाएँ।

**स्क्रीन पर क्या है**
- **स्क्रीन पर: "Power /hr"**: प्रति चलने के घंटे बिजली खर्च।
- **स्क्रीन पर: "Labor /hr"**: प्रति घंटा operator मज़दूरी।
- **स्क्रीन पर: "Overhead /hr"**: प्रति घंटा स्थायी overhead।
- **स्क्रीन पर: "Total ₹/HR"**: तीनों दरों का जोड़। अनुमान में हर route step के लिए (order KG ÷ 150) घंटे × यह दर; कोई चालू दर न हो तो ₹800/घंटा।
- **स्क्रीन पर: "Generic Process Override / Machine"**: पंक्ति process की सभी मशीनों पर, या एक मशीन पर लागू।

**आम दिक्कतें और हल**
- "संदेश: "Creation Failed"" — Server ने नई दर नहीं ली (जैसे वही process/machine जोड़ी पहले से)। संदेश पढ़कर चुनाव बदलें।
- "संदेश: "Update Failed"" — नई दर save नहीं हुई। अंक जाँचकर फिर करें।
- "संदेश: "No process rates configured. The engine will use system defaults."" — अभी कोई दर नहीं; अनुमान ₹800/घंटा पर। "New Override" से दर जोड़ें।

**अटक गए तो**
1. Process चुने बिना "Registry Override" बंद रहता है।
2. पंक्ति का save icon दबाए बिना बदले अंक save नहीं होते।

जुड़े पेज: /analytics/costing, /analytics/orders/costing, /factory/processes

**अभी नहीं होता / ध्यान दें**
- अनुमान दर केवल process से ढूँढता है, इसलिए मशीन-वार override अनुमान में इस्तेमाल नहीं होता।
- अनुमान में 150 KG/घंटा की गति code में तय है; process या मशीन के हिसाब से नहीं बदल सकते।
- किसी दर की पंक्ति हटाने का बटन नहीं है।

### Reports Hub (रिपोर्ट सूची) (/analytics/reports)
स्क्रीन का पता: /analytics/reports · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, PLANNER, STORE, SALES · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=analytics-reports&lang=hi

सभी रिपोर्टों की सूची क्षेत्र-वार, साथ में daily report pack बनाना और बने pack का archive।

रिपोर्ट चुनने के लिए खोलें। Admin और Owner यहीं daily pack बनाते और पुराने pack देखते हैं। पुराने link जैसे /analytics/reports?tab=sales अपने आप रिपोर्ट पेज पर जाते हैं।

**शुरू करने से पहले**
- हर रिपोर्ट तभी खुलती है जब आपके role को उसकी अनुमति हो।
- Daily pack की सेटिंग admin, Report Center में करता है।

**स्टेप बाय स्टेप**
1. समूह चुनें: "Production", "Quality & materials", "Sales & logistics", "Inventory & finance" (अनुमति हो तो "Gate & Visitors")।
2. रिपोर्ट कार्ड पर क्लिक करके खोलें।
3. Admin/Owner: "Report generation" में "Generate daily pack" दबाएँ। "Report generated" संदेश बताता है pack archive हुआ और owner/admin को app में सूचना गई।
4. "Recent report runs" में "Preview PDF" या "Detail workbook" खोलें।
5. सबसे नया pack खोलने के लिए ऊपर "Latest daily pack"।

**स्क्रीन पर क्या है**
- **स्क्रीन पर: "Reports"**: आपको दिखने वाले रिपोर्ट कार्ड और कितने क्षेत्र।
- **स्क्रीन पर: "Daily packs"**: तय किए गए pack; आपका role सेट नहीं कर सकता तो "Restricted"।
- **स्क्रीन पर: "Recent runs / Last generated"**: Archive हुए pack और आखिरी कब बना; SUCCEEDED/SENT हरा, FAILED लाल।
- **स्क्रीन पर: "Gate Register Daily pack"**: Report Center (admin/owner) का link: gate pack चालू, बनाना और archive।

**आम दिक्कतें और हल**
- "संदेश: "Report generation failed"" — Pack नहीं बना; संदेश में server का कारण है। फिर करें या Report Center देखें।
- "संदेश: "Archive restricted for this role"" — Pack इतिहास केवल report admin के लिए। सभी रिपोर्टें फिर भी खुलती और export होती हैं।
- "संदेश: "No daily packs configured"" — Admin ने Report Center में कोई pack नहीं बनाया।

**अटक गए तो**
1. रिपोर्ट कार्ड खोलने पर error आए तो आपके role को वह रिपोर्ट नहीं मिली; admin से पूछें।

जुड़े पेज: /analytics, /analytics/reports/production, /analytics/reports/scrap, /analytics/reports/sales, /analytics/reports/inventory, /analytics/reports/costing, /analytics/reports/gate, /system/report-center

**अभी नहीं होता / ध्यान दें**
- "Generate daily pack" बिना पुष्टि के बार-बार दबाया जा सकता है, जिससे फालतू run बनते हैं।

### Costing & Profitability (लागत और मुनाफ़ा) (/analytics/reports/costing)
स्क्रीन का पता: /analytics/reports/costing · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=analytics-reports-costing&lang=hi

दर्ज job और order cost से revenue, उत्पादन लागत, margin, प्रति kg लागत, लागत का बँटवारा, customer-वार margin और मासिक overhead।

Month close के बाद मुनाफ़ा देखने के लिए खोलें। आँकड़े अवधि में बनी cost rows से आते हैं।

**शुरू करने से पहले**
- Order और job cost की गणना हुई हो; Costing Center में plant month भरे हों।

**स्टेप बाय स्टेप**
1. अवधि चुनें (7D, 30D, 90D, MTD, FY या Custom) और ज़रूरत हो तो Plant और Shift।
2. ऊपर के chips (अवधि, "Updated", डेटा कवरेज) और कोई पीली चेतावनी देखें।
3. "Revenue", "Production cost", "Gross margin", "Margin %", "Cost per kg", "Contribution", "Actual-cost coverage", "Jobs costed" पढ़ें।
4. "Trend" (माप चुनें) और "Insights" से दिशा देखें।
5. ब्योरे के panel और detail table पढ़ें; "Filter rows" और column header पर क्लिक करके sort करें।
6. "CSV" (पंक्तियाँ) या "PDF" (पूरी रिपोर्ट) से डाउनलोड करें; "All reports" से Reports Hub पर लौटें।

**स्क्रीन पर क्या है**
- **स्क्रीन पर: "Revenue"**: अवधि में बनी order cost का selling price (line राशि) जोड़।
- **स्क्रीन पर: "Production cost / Jobs costed"**: Job कुल लागत (material + conversion + absorbed overhead) का जोड़ और job cost की संख्या।
- **स्क्रीन पर: "Gross margin / Margin %"**: Absorbed margin (बिक्री − कुल लागत) का जोड़; Margin % हर order के margin % का साधारण औसत, target 25%।
- **स्क्रीन पर: "Contribution"**: Selling price − material − conversion (overhead से पहले)।
- **स्क्रीन पर: "Cost per kg"**: Job की प्रति kg लागत का औसत (कुल लागत ÷ बनी मात्रा)।
- **स्क्रीन पर: "Actual-cost coverage"**: असली (अनुमान नहीं) लागत हिस्सों का औसत; target 100%।
- **स्क्रीन पर: "Sections"**: "Cost split" (material, conversion, absorbed overhead), "Margin by customer" (revenue से top 10), "Overheads by month" (पिछले 12 plant month)।
- **स्क्रीन पर: "Period (7D / 30D / 90D / MTD / FY / Custom)"**: तारीख की अवधि। Default 30D। MTD = इस महीने अब तक; FY = 1 अप्रैल से। "Custom" में "From date" और "To date" आते हैं। Filter पेज के पते में रहते हैं, link भेजा जा सकता है।
- **स्क्रीन पर: "Plant / Process / Shift"**: रिपोर्ट को एक plant या shift तक सीमित करें। Process filter हर रिपोर्ट पर दिखता है पर अभी server उसे लागू नहीं करता।
- **स्क्रीन पर: "Machine logs / Material actuals / Shift tags"**: डेटा कवरेज chips: अवधि में बने job में से कितने % पर output log है; कितने % पर material issue/खपत/वापसी है; कितने % output log पर shift code है। 80%+ हरा, 30%+ पीला, कम तो लाल; रिपोर्ट में काम न आए तो N/A।
- **स्क्रीन पर: "KPI tiles (On target / Below target)"**: अधिकतम 8 tiles। जहाँ target है वहाँ tile उसके हिसाब से अच्छा या खराब रंग लेती है।
- **स्क्रीन पर: "Trend / Insights"**: चुने माप का रोज़ का chart (खाली दिन शून्य) और उसी डेटा से छोटे निष्कर्ष।
- **स्क्रीन पर: "Detail table"**: Sort होने वाली पंक्तियाँ, "Filter rows" खोज, हर पेज 25 पंक्ति, "CSV" से filter की हुई पंक्तियाँ डाउनलोड।

**आम दिक्कतें और हल**
- "संदेश: "This report could not be loaded. Try refreshing."" — Server request फेल हुआ या आपके role को यह रिपोर्ट नहीं मिली। "Refresh" दबाएँ; बार-बार हो तो admin से अनुमति माँगें।
- "संदेश: "No figures for this period"" — Filter के हिसाब से कुछ दर्ज नहीं। अवधि बढ़ाएँ या filter हटाएँ।
- "संदेश: "No telemetry in selected period."" — अवधि के किसी job पर machine output log नहीं। Work center से terminal पर output दर्ज करवाएँ।
- "संदेश: "No shift tags captured in selected telemetry. / No shift schedule configured."" — Output log पर shift code नहीं, या plant में कोई चालू shift नहीं। Factory setting में shift बनाएँ।

**अटक गए तो**
1. Coverage कम हो तो पहले Costing Center में month close पूरा करें।
2. "Refresh" दबाएँ (रिपोर्ट हर 3 मिनट में खुद भी ताज़ा होती है)।
3. अवधि खाली हो तो 90D या FY चुनें, और Plant व Shift को फिर "All" करें।
4. पीला चेतावनी बॉक्स पढ़ें; उसमें कमी वाले डेटा का नाम होता है।

जुड़े पेज: /analytics/reports, /analytics/costing, /analytics/orders/costing

**अभी नहीं होता / ध्यान दें**
- केवल तारीख filter लागू होता है; plant, process और shift filter से costing आँकड़े नहीं बदलते।
- Margin % order margin का साधारण औसत है, कुल margin ÷ कुल revenue नहीं; छोटे order का भार बड़े जितना।

### Dispatch & Logistics (dispatch रिपोर्ट) (/analytics/reports/dispatch)
स्क्रीन का पता: /analytics/reports/dispatch · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, DISPATCH · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=analytics-reports-dispatch&lang=hi

Delivery challan: कितने, dispatch बनाम pending, भेजा वज़न और pieces, customer-वार।

Dispatch की मात्रा और pending challan देखने के लिए खोलें।

**शुरू करने से पहले**
- Dispatch Bay में slip/challan बने हों।

**स्टेप बाय स्टेप**
1. अवधि चुनें (7D, 30D, 90D, MTD, FY या Custom) और ज़रूरत हो तो Plant और Shift।
2. ऊपर के chips (अवधि, "Updated", डेटा कवरेज) और कोई पीली चेतावनी देखें।
3. "Challans", "Dispatched", "Pending", "Weight shipped", "Pieces shipped" पढ़ें।
4. "Trend" (माप चुनें) और "Insights" से दिशा देखें।
5. ब्योरे के panel और detail table पढ़ें; "Filter rows" और column header पर क्लिक करके sort करें।
6. "Open dispatch bay" इस्तेमाल करें।
7. "CSV" (पंक्तियाँ) या "PDF" (पूरी रिपोर्ट) से डाउनलोड करें; "All reports" से Reports Hub पर लौटें।

**स्क्रीन पर क्या है**
- **स्क्रीन पर: "Challans"**: अवधि में बने delivery challan (plant filter लागू)।
- **स्क्रीन पर: "Dispatched"**: DISPATCHED, IN_TRANSIT या DELIVERED वाले challan।
- **स्क्रीन पर: "Pending"**: अभी DRAFT वाले challan।
- **स्क्रीन पर: "Weight shipped / Pieces shipped"**: Challan lines का वज़न (KG) और pieces का जोड़।
- **स्क्रीन पर: "Period (7D / 30D / 90D / MTD / FY / Custom)"**: तारीख की अवधि। Default 30D। MTD = इस महीने अब तक; FY = 1 अप्रैल से। "Custom" में "From date" और "To date" आते हैं। Filter पेज के पते में रहते हैं, link भेजा जा सकता है।
- **स्क्रीन पर: "Plant / Process / Shift"**: रिपोर्ट को एक plant या shift तक सीमित करें। Process filter हर रिपोर्ट पर दिखता है पर अभी server उसे लागू नहीं करता।
- **स्क्रीन पर: "Machine logs / Material actuals / Shift tags"**: डेटा कवरेज chips: अवधि में बने job में से कितने % पर output log है; कितने % पर material issue/खपत/वापसी है; कितने % output log पर shift code है। 80%+ हरा, 30%+ पीला, कम तो लाल; रिपोर्ट में काम न आए तो N/A।
- **स्क्रीन पर: "KPI tiles (On target / Below target)"**: अधिकतम 8 tiles। जहाँ target है वहाँ tile उसके हिसाब से अच्छा या खराब रंग लेती है।
- **स्क्रीन पर: "Trend / Insights"**: चुने माप का रोज़ का chart (खाली दिन शून्य) और उसी डेटा से छोटे निष्कर्ष।
- **स्क्रीन पर: "Detail table"**: Sort होने वाली पंक्तियाँ, "Filter rows" खोज, हर पेज 25 पंक्ति, "CSV" से filter की हुई पंक्तियाँ डाउनलोड।

**आम दिक्कतें और हल**
- "संदेश: "This report could not be loaded. Try refreshing."" — Server request फेल हुआ या आपके role को यह रिपोर्ट नहीं मिली। "Refresh" दबाएँ; बार-बार हो तो admin से अनुमति माँगें।
- "संदेश: "No figures for this period"" — Filter के हिसाब से कुछ दर्ज नहीं। अवधि बढ़ाएँ या filter हटाएँ।
- "संदेश: "No telemetry in selected period."" — अवधि के किसी job पर machine output log नहीं। Work center से terminal पर output दर्ज करवाएँ।
- "संदेश: "No shift tags captured in selected telemetry. / No shift schedule configured."" — Output log पर shift code नहीं, या plant में कोई चालू shift नहीं। Factory setting में shift बनाएँ।

**अटक गए तो**
1. "Refresh" दबाएँ (रिपोर्ट हर 3 मिनट में खुद भी ताज़ा होती है)।
2. अवधि खाली हो तो 90D या FY चुनें, और Plant व Shift को फिर "All" करें।
3. पीला चेतावनी बॉक्स पढ़ें; उसमें कमी वाले डेटा का नाम होता है।

जुड़े पेज: /analytics/reports, /logistics/dispatch

**अभी नहीं होता / ध्यान दें**
- Shift और process filter का इस रिपोर्ट पर कोई असर नहीं।

### Downtime Analysis (रुकावट विश्लेषण) (/analytics/reports/downtime)
स्क्रीन का पता: /analytics/reports/downtime · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, WORK_CENTER_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=analytics-reports-downtime&lang=hi

कुल रुकावट समय, रुकावटों की गिनती, मरम्मत का औसत समय, और कारणों व मशीनों का Pareto।

कौन से कारण पहले ठीक करें यह तय करने के लिए खोलें। Terminal पर हर pause कारण के साथ downtime record बनाता है, इसलिए यह असली खोया समय दिखाता है।

**शुरू करने से पहले**
- Operator terminal पर कारण के साथ job pause करें; resume या पूरा करने पर record बंद होता है।

**स्टेप बाय स्टेप**
1. अवधि चुनें (7D, 30D, 90D, MTD, FY या Custom) और ज़रूरत हो तो Plant और Shift।
2. ऊपर के chips (अवधि, "Updated", डेटा कवरेज) और कोई पीली चेतावनी देखें।
3. "Downtime", "Stoppages", "Mean time to repair", "Stoppages per day" पढ़ें।
4. "Trend" (माप चुनें) और "Insights" से दिशा देखें।
5. ब्योरे के panel और detail table पढ़ें; "Filter rows" और column header पर क्लिक करके sort करें।
6. "CSV" (पंक्तियाँ) या "PDF" (पूरी रिपोर्ट) से डाउनलोड करें; "All reports" से Reports Hub पर लौटें।

**स्क्रीन पर क्या है**
- **स्क्रीन पर: "Downtime"**: Downtime record के (अंत − शुरुआत) का जोड़, घंटों में।
- **स्क्रीन पर: "Stoppages"**: Downtime record की संख्या।
- **स्क्रीन पर: "Mean time to repair"**: कुल downtime मिनट ÷ रुकावटें।
- **स्क्रीन पर: "Stoppages per day"**: रुकावटें ÷ जिन दिनों downtime हुआ।
- **स्क्रीन पर: "Sections"**: "Downtime reasons (Pareto)" — ऊपर के कारण पहले ठीक करें; "Machines losing the most time"।
- **स्क्रीन पर: "Period (7D / 30D / 90D / MTD / FY / Custom)"**: तारीख की अवधि। Default 30D। MTD = इस महीने अब तक; FY = 1 अप्रैल से। "Custom" में "From date" और "To date" आते हैं। Filter पेज के पते में रहते हैं, link भेजा जा सकता है।
- **स्क्रीन पर: "Plant / Process / Shift"**: रिपोर्ट को एक plant या shift तक सीमित करें। Process filter हर रिपोर्ट पर दिखता है पर अभी server उसे लागू नहीं करता।
- **स्क्रीन पर: "Machine logs / Material actuals / Shift tags"**: डेटा कवरेज chips: अवधि में बने job में से कितने % पर output log है; कितने % पर material issue/खपत/वापसी है; कितने % output log पर shift code है। 80%+ हरा, 30%+ पीला, कम तो लाल; रिपोर्ट में काम न आए तो N/A।
- **स्क्रीन पर: "KPI tiles (On target / Below target)"**: अधिकतम 8 tiles। जहाँ target है वहाँ tile उसके हिसाब से अच्छा या खराब रंग लेती है।
- **स्क्रीन पर: "Trend / Insights"**: चुने माप का रोज़ का chart (खाली दिन शून्य) और उसी डेटा से छोटे निष्कर्ष।
- **स्क्रीन पर: "Detail table"**: Sort होने वाली पंक्तियाँ, "Filter rows" खोज, हर पेज 25 पंक्ति, "CSV" से filter की हुई पंक्तियाँ डाउनलोड।

**आम दिक्कतें और हल**
- "संदेश: "This report could not be loaded. Try refreshing."" — Server request फेल हुआ या आपके role को यह रिपोर्ट नहीं मिली। "Refresh" दबाएँ; बार-बार हो तो admin से अनुमति माँगें।
- "संदेश: "No figures for this period"" — Filter के हिसाब से कुछ दर्ज नहीं। अवधि बढ़ाएँ या filter हटाएँ।
- "संदेश: "No telemetry in selected period."" — अवधि के किसी job पर machine output log नहीं। Work center से terminal पर output दर्ज करवाएँ।
- "संदेश: "No shift tags captured in selected telemetry. / No shift schedule configured."" — Output log पर shift code नहीं, या plant में कोई चालू shift नहीं। Factory setting में shift बनाएँ।

**अटक गए तो**
1. खुला pause (resume नहीं हुआ) बंद होने तक नहीं गिना जाता।
2. "Refresh" दबाएँ (रिपोर्ट हर 3 मिनट में खुद भी ताज़ा होती है)।
3. अवधि खाली हो तो 90D या FY चुनें, और Plant व Shift को फिर "All" करें।
4. पीला चेतावनी बॉक्स पढ़ें; उसमें कमी वाले डेटा का नाम होता है।

जुड़े पेज: /analytics/reports, /analytics/reports/oee, /maintenance

**अभी नहीं होता / ध्यान दें**
- Downtime मशीन से job के ज़रिए जुड़ता है, इसलिए बिना job के दर्ज रुकावट नहीं दिखती।

### Gate Register (gate रजिस्टर) (/analytics/reports/gate)
स्क्रीन का पता: /analytics/reports/gate · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=analytics-reports-gate&lang=hi

Watchman रजिस्टर से अंदर-बाहर गाड़ियों की entry, ERP दस्तावेज़ों से मिलाई हुई, साथ में bill और visitor की गिनती (केवल गिनती, निजी जानकारी नहीं)।

रोज़ खोलें; देखें हर gate movement किसी ERP दस्तावेज़ से मिलता है और कोई visitor ज़्यादा देर अंदर नहीं।

**शुरू करने से पहले**
- Admin और Owner को default में दिखता है; बाकी को User Management में Gate reports pack (gate.reports) चाहिए। Watchman को कभी नहीं दिखता।
- Watchman gate पर माल और visitor दर्ज करे।

**स्टेप बाय स्टेप**
1. अवधि चुनें (7D, 30D, 90D, MTD, FY या Custom) और ज़रूरत हो तो Plant और Shift।
2. ऊपर के chips (अवधि, "Updated", डेटा कवरेज) और कोई पीली चेतावनी देखें।
3. "Register entries", "Inward entries", "Outward entries", "Awaiting ERP match", "ERP mismatches", "Visitor entries", "Visitor exits", "Overdue inside now" और "Inward bills" panel पढ़ें।
4. "Trend" (माप चुनें) और "Insights" से दिशा देखें।
5. ब्योरे के panel और detail table पढ़ें; "Filter rows" और column header पर क्लिक करके sort करें।
6. "CSV" (पंक्तियाँ) या "PDF" (पूरी रिपोर्ट) से डाउनलोड करें; "All reports" से Reports Hub पर लौटें।

**स्क्रीन पर क्या है**
- **स्क्रीन पर: "Register entries"**: दर्ज movement (अलग गाड़ियाँ नहीं), अंदर/बाहर में बँटे। दिन Asia/Kolkata समय से।
- **स्क्रीन पर: "Awaiting ERP match"**: जो entry अभी ERP दस्तावेज़ से नहीं जुड़ी (UNMATCHED)। Target 0।
- **स्क्रीन पर: "ERP mismatches"**: जिनकी lines जुड़े दस्तावेज़ से अलग हैं (DISCREPANCY)। Target 0।
- **स्क्रीन पर: "Overdue inside now"**: अभी अंदर visitor जो 12 घंटे से ज़्यादा पहले आए (अभी की गिनती, अवधि की नहीं)।
- **स्क्रीन पर: "Inward bills / Bills captured, received, resolved"**: Bill का क्रम: capture → inventory review → पक्की receipt।
- **स्क्रीन पर: "Amount"**: केवल ज्ञात line राशि; tax या भाड़ा शामिल न हो। Accounting का कुल नहीं।
- **स्क्रीन पर: "Period (7D / 30D / 90D / MTD / FY / Custom)"**: तारीख की अवधि। Default 30D। MTD = इस महीने अब तक; FY = 1 अप्रैल से। "Custom" में "From date" और "To date" आते हैं। Filter पेज के पते में रहते हैं, link भेजा जा सकता है।
- **स्क्रीन पर: "Plant / Process / Shift"**: रिपोर्ट को एक plant या shift तक सीमित करें। Process filter हर रिपोर्ट पर दिखता है पर अभी server उसे लागू नहीं करता।
- **स्क्रीन पर: "Machine logs / Material actuals / Shift tags"**: डेटा कवरेज chips: अवधि में बने job में से कितने % पर output log है; कितने % पर material issue/खपत/वापसी है; कितने % output log पर shift code है। 80%+ हरा, 30%+ पीला, कम तो लाल; रिपोर्ट में काम न आए तो N/A।
- **स्क्रीन पर: "KPI tiles (On target / Below target)"**: अधिकतम 8 tiles। जहाँ target है वहाँ tile उसके हिसाब से अच्छा या खराब रंग लेती है।
- **स्क्रीन पर: "Trend / Insights"**: चुने माप का रोज़ का chart (खाली दिन शून्य) और उसी डेटा से छोटे निष्कर्ष।
- **स्क्रीन पर: "Detail table"**: Sort होने वाली पंक्तियाँ, "Filter rows" खोज, हर पेज 25 पंक्ति, "CSV" से filter की हुई पंक्तियाँ डाउनलोड।

**आम दिक्कतें और हल**
- "संदेश: "Gate report not available for this account"" — आपके account को gate.reports नहीं मिला। Admin या owner से Gate reports pack माँगें।
- "संदेश: "Choose an ordered date range of 366 days or fewer."" — Custom अवधि एक साल से लंबी या उल्टी है। छोटी करें।
- "संदेश: "The start date must be on or before the end date."" — From/To तारीख ठीक करें।
- "संदेश: "Plant does not exist."" — Link में plant गलत है। सूची से plant चुनें।
- "संदेश: "This report could not be loaded. Try refreshing."" — Server request फेल हुआ या आपके role को यह रिपोर्ट नहीं मिली। "Refresh" दबाएँ; बार-बार हो तो admin से अनुमति माँगें।
- "संदेश: "No figures for this period"" — Filter के हिसाब से कुछ दर्ज नहीं। अवधि बढ़ाएँ या filter हटाएँ।
- "संदेश: "No telemetry in selected period."" — अवधि के किसी job पर machine output log नहीं। Work center से terminal पर output दर्ज करवाएँ।
- "संदेश: "No shift tags captured in selected telemetry. / No shift schedule configured."" — Output log पर shift code नहीं, या plant में कोई चालू shift नहीं। Factory setting में shift बनाएँ।

**अटक गए तो**
1. "Refresh" दबाएँ (रिपोर्ट हर 3 मिनट में खुद भी ताज़ा होती है)।
2. अवधि खाली हो तो 90D या FY चुनें, और Plant व Shift को फिर "All" करें।
3. पीला चेतावनी बॉक्स पढ़ें; उसमें कमी वाले डेटा का नाम होता है।

जुड़े पेज: /analytics/reports, /gate/register, /gate/history, /inventory/gate-bills, /system/report-center

**अभी नहीं होता / ध्यान दें**
- Visitor आँकड़े केवल गिनती हैं; नाम और ब्योरा जानबूझकर नहीं दिखाए जाते।

### Ink Intelligence (ink विश्लेषण) (/analytics/reports/ink-intelligence)
स्क्रीन का पता: /analytics/reports/ink-intelligence · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, PLANNER, WORK_CENTER_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=analytics-reports-ink-intelligence&lang=hi

रंग-परिवार के हिसाब से ink की ज़रूरत, issue, खपत और वापसी, variance और issue अनुशासन के साथ।

Printing job पर ink खपत और ink kitchen में वापसी पर नियंत्रण के लिए खोलें।

**शुरू करने से पहले**
- Ink material की category INK हो; ink issue और वापसी job पर दर्ज हों।

**स्टेप बाय स्टेप**
1. अवधि चुनें (7D, 30D, 90D, MTD, FY या Custom) और ज़रूरत हो तो Plant और Shift।
2. ऊपर के chips (अवधि, "Updated", डेटा कवरेज) और कोई पीली चेतावनी देखें।
3. "Ink needed", "Ink issued", "Ink consumed", "Returned", "Variance", "Colour families" पढ़ें।
4. "Trend" (माप चुनें) और "Insights" से दिशा देखें।
5. ब्योरे के panel और detail table पढ़ें; "Filter rows" और column header पर क्लिक करके sort करें।
6. "CSV" (पंक्तियाँ) या "PDF" (पूरी रिपोर्ट) से डाउनलोड करें; "All reports" से Reports Hub पर लौटें।

**स्क्रीन पर क्या है**
- **स्क्रीन पर: "Colour family"**: Ink के नाम से: C (cyan), M (magenta), Y (yellow), K (black/key), W (white), SPECIAL, बाकी CUSTOM।
- **स्क्रीन पर: "Variance"**: खपत − theoretical ink।
- **स्क्रीन पर: "Issue discipline"**: Issue ÷ planned issue × 100।
- **स्क्रीन पर: "Returns"**: वापसी ÷ issue × 100।
- **स्क्रीन पर: "Period (7D / 30D / 90D / MTD / FY / Custom)"**: तारीख की अवधि। Default 30D। MTD = इस महीने अब तक; FY = 1 अप्रैल से। "Custom" में "From date" और "To date" आते हैं। Filter पेज के पते में रहते हैं, link भेजा जा सकता है।
- **स्क्रीन पर: "Plant / Process / Shift"**: रिपोर्ट को एक plant या shift तक सीमित करें। Process filter हर रिपोर्ट पर दिखता है पर अभी server उसे लागू नहीं करता।
- **स्क्रीन पर: "Machine logs / Material actuals / Shift tags"**: डेटा कवरेज chips: अवधि में बने job में से कितने % पर output log है; कितने % पर material issue/खपत/वापसी है; कितने % output log पर shift code है। 80%+ हरा, 30%+ पीला, कम तो लाल; रिपोर्ट में काम न आए तो N/A।
- **स्क्रीन पर: "KPI tiles (On target / Below target)"**: अधिकतम 8 tiles। जहाँ target है वहाँ tile उसके हिसाब से अच्छा या खराब रंग लेती है।
- **स्क्रीन पर: "Trend / Insights"**: चुने माप का रोज़ का chart (खाली दिन शून्य) और उसी डेटा से छोटे निष्कर्ष।
- **स्क्रीन पर: "Detail table"**: Sort होने वाली पंक्तियाँ, "Filter rows" खोज, हर पेज 25 पंक्ति, "CSV" से filter की हुई पंक्तियाँ डाउनलोड।

**आम दिक्कतें और हल**
- "संदेश: "No material actuals captured."" — अवधि में job पर कोई issue, खपत या वापसी दर्ज नहीं।
- "संदेश: "This report could not be loaded. Try refreshing."" — Server request फेल हुआ या आपके role को यह रिपोर्ट नहीं मिली। "Refresh" दबाएँ; बार-बार हो तो admin से अनुमति माँगें।
- "संदेश: "No figures for this period"" — Filter के हिसाब से कुछ दर्ज नहीं। अवधि बढ़ाएँ या filter हटाएँ।
- "संदेश: "No telemetry in selected period."" — अवधि के किसी job पर machine output log नहीं। Work center से terminal पर output दर्ज करवाएँ।
- "संदेश: "No shift tags captured in selected telemetry. / No shift schedule configured."" — Output log पर shift code नहीं, या plant में कोई चालू shift नहीं। Factory setting में shift बनाएँ।

**अटक गए तो**
1. "Refresh" दबाएँ (रिपोर्ट हर 3 मिनट में खुद भी ताज़ा होती है)।
2. अवधि खाली हो तो 90D या FY चुनें, और Plant व Shift को फिर "All" करें।
3. पीला चेतावनी बॉक्स पढ़ें; उसमें कमी वाले डेटा का नाम होता है।

जुड़े पेज: /analytics/reports, /production/ink-control

**अभी नहीं होता / ध्यान दें**
- Colour family ink के नाम से अंदाज़ा लगाई जाती है; जिन ink के नाम में cyan/magenta/yellow/black/white नहीं, वे CUSTOM में जाती हैं।

### Inter-Plant Logistics (प्लांट के बीच माल) (/analytics/reports/interplant)
स्क्रीन का पता: /analytics/reports/interplant · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, STORE, DISPATCH · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=analytics-reports-interplant&lang=hi

प्लांट के बीच transfer challan: भेजे, मिले, रास्ते में और draft, वज़न के साथ।

देखें हर भेजा transfer मिला और कुछ रास्ते में अटका नहीं।

**शुरू करने से पहले**
- Transfer Inventory → Inter-plant में बने हों।

**स्टेप बाय स्टेप**
1. अवधि चुनें (7D, 30D, 90D, MTD, FY या Custom) और ज़रूरत हो तो Plant और Shift।
2. ऊपर के chips (अवधि, "Updated", डेटा कवरेज) और कोई पीली चेतावनी देखें।
3. "Transfers", "Dispatched", "Received", "In transit", "Weight in transit", "Received challans", "Drafts" पढ़ें।
4. "Trend" (माप चुनें) और "Insights" से दिशा देखें।
5. ब्योरे के panel और detail table पढ़ें; "Filter rows" और column header पर क्लिक करके sort करें।
6. "Receive an incoming transfer" इस्तेमाल करें।
7. "CSV" (पंक्तियाँ) या "PDF" (पूरी रिपोर्ट) से डाउनलोड करें; "All reports" से Reports Hub पर लौटें।

**स्क्रीन पर क्या है**
- **स्क्रीन पर: "Transfers"**: अवधि में बने challan जहाँ plant भेजने या पाने वाला है।
- **स्क्रीन पर: "Dispatched / Received"**: Challan lines पर भेजा और मिला KG।
- **स्क्रीन पर: "In transit / Weight in transit"**: IN_TRANSIT वाले challan, और उन पर भेजा पर अभी न मिला output वज़न।
- **स्क्रीन पर: "Recent transfers"**: DC no, status, from/to plant, तारीख और वज़न वाली table।
- **स्क्रीन पर: "Period (7D / 30D / 90D / MTD / FY / Custom)"**: तारीख की अवधि। Default 30D। MTD = इस महीने अब तक; FY = 1 अप्रैल से। "Custom" में "From date" और "To date" आते हैं। Filter पेज के पते में रहते हैं, link भेजा जा सकता है।
- **स्क्रीन पर: "Plant / Process / Shift"**: रिपोर्ट को एक plant या shift तक सीमित करें। Process filter हर रिपोर्ट पर दिखता है पर अभी server उसे लागू नहीं करता।
- **स्क्रीन पर: "Machine logs / Material actuals / Shift tags"**: डेटा कवरेज chips: अवधि में बने job में से कितने % पर output log है; कितने % पर material issue/खपत/वापसी है; कितने % output log पर shift code है। 80%+ हरा, 30%+ पीला, कम तो लाल; रिपोर्ट में काम न आए तो N/A।
- **स्क्रीन पर: "KPI tiles (On target / Below target)"**: अधिकतम 8 tiles। जहाँ target है वहाँ tile उसके हिसाब से अच्छा या खराब रंग लेती है।
- **स्क्रीन पर: "Trend / Insights"**: चुने माप का रोज़ का chart (खाली दिन शून्य) और उसी डेटा से छोटे निष्कर्ष।
- **स्क्रीन पर: "Detail table"**: Sort होने वाली पंक्तियाँ, "Filter rows" खोज, हर पेज 25 पंक्ति, "CSV" से filter की हुई पंक्तियाँ डाउनलोड।

**आम दिक्कतें और हल**
- "संदेश: "This report could not be loaded. Try refreshing."" — Server request फेल हुआ या आपके role को यह रिपोर्ट नहीं मिली। "Refresh" दबाएँ; बार-बार हो तो admin से अनुमति माँगें।
- "संदेश: "No figures for this period"" — Filter के हिसाब से कुछ दर्ज नहीं। अवधि बढ़ाएँ या filter हटाएँ।
- "संदेश: "No telemetry in selected period."" — अवधि के किसी job पर machine output log नहीं। Work center से terminal पर output दर्ज करवाएँ।
- "संदेश: "No shift tags captured in selected telemetry. / No shift schedule configured."" — Output log पर shift code नहीं, या plant में कोई चालू shift नहीं। Factory setting में shift बनाएँ।

**अटक गए तो**
1. "Refresh" दबाएँ (रिपोर्ट हर 3 मिनट में खुद भी ताज़ा होती है)।
2. अवधि खाली हो तो 90D या FY चुनें, और Plant व Shift को फिर "All" करें।
3. पीला चेतावनी बॉक्स पढ़ें; उसमें कमी वाले डेटा का नाम होता है।

जुड़े पेज: /analytics/reports, /inventory/inter-plant

**अभी नहीं होता / ध्यान दें**
- Shift और process filter का इस रिपोर्ट पर कोई असर नहीं।

### Inventory Health (stock रिपोर्ट) (/analytics/reports/inventory)
स्क्रीन का पता: /analytics/reports/inventory · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, STORE, PLANNER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=analytics-reports-inventory&lang=hi

Stock की स्थिति: roll और bulk वज़न, उम्र, कीमत और valuation coverage, stage, family, material, location और plant के हिसाब से।

हफ़्ते में खोलें; पुराना stock पहले इस्तेमाल करने और बिना दर वाले material ढूँढने के लिए।

**शुरू करने से पहले**
- Valuation के लिए material cost snapshot हों।

**स्टेप बाय स्टेप**
1. अवधि चुनें (7D, 30D, 90D, MTD, FY या Custom) और ज़रूरत हो तो Plant और Shift।
2. ऊपर के chips (अवधि, "Updated", डेटा कवरेज) और कोई पीली चेतावनी देखें।
3. "Roll stock", "Bulk stock", "Stock items", "Aged stock", "Aged items", "Estimated value", "Valuation coverage", "Items without a rate" पढ़ें।
4. "Trend" (माप चुनें) और "Insights" से दिशा देखें।
5. ब्योरे के panel और detail table पढ़ें; "Filter rows" और column header पर क्लिक करके sort करें।
6. "Find available rolls" या "Review stock exceptions" इस्तेमाल करें।
7. "CSV" (पंक्तियाँ) या "PDF" (पूरी रिपोर्ट) से डाउनलोड करें; "All reports" से Reports Hub पर लौटें।

**स्क्रीन पर क्या है**
- **स्क्रीन पर: "Roll stock"**: दायरे के roll का कुल वज़न (plant filter लागू)। यह अभी का stock है, चुनी तारीख का नहीं।
- **स्क्रीन पर: "Bulk stock"**: Granule, chemical और बाकी bulk stock KG में (सभी plants)।
- **स्क्रीन पर: "Stock items"**: Roll की संख्या।
- **स्क्रीन पर: "Aged stock / Aged items"**: 90 दिन से पुराने roll (बनने की तारीख से)।
- **स्क्रीन पर: "Estimated value"**: Roll वज़न × नवीनतम material cost rate, केवल उन material के लिए जिनकी दर है।
- **स्क्रीन पर: "Valuation coverage / Items without a rate"**: दर वाला वज़न ÷ कुल वज़न × 100 (target 100%), और जिन roll के material की दर नहीं।
- **स्क्रीन पर: "Sections"**: "Stock aging" band, "By stage" (RAW, WIP_STEP_n, FG), "By item type", "Largest stock families", "By material", "By location", "By plant"; table "Stock items"।
- **स्क्रीन पर: "Period (7D / 30D / 90D / MTD / FY / Custom)"**: तारीख की अवधि। Default 30D। MTD = इस महीने अब तक; FY = 1 अप्रैल से। "Custom" में "From date" और "To date" आते हैं। Filter पेज के पते में रहते हैं, link भेजा जा सकता है।
- **स्क्रीन पर: "Plant / Process / Shift"**: रिपोर्ट को एक plant या shift तक सीमित करें। Process filter हर रिपोर्ट पर दिखता है पर अभी server उसे लागू नहीं करता।
- **स्क्रीन पर: "Machine logs / Material actuals / Shift tags"**: डेटा कवरेज chips: अवधि में बने job में से कितने % पर output log है; कितने % पर material issue/खपत/वापसी है; कितने % output log पर shift code है। 80%+ हरा, 30%+ पीला, कम तो लाल; रिपोर्ट में काम न आए तो N/A।
- **स्क्रीन पर: "KPI tiles (On target / Below target)"**: अधिकतम 8 tiles। जहाँ target है वहाँ tile उसके हिसाब से अच्छा या खराब रंग लेती है।
- **स्क्रीन पर: "Trend / Insights"**: चुने माप का रोज़ का chart (खाली दिन शून्य) और उसी डेटा से छोटे निष्कर्ष।
- **स्क्रीन पर: "Detail table"**: Sort होने वाली पंक्तियाँ, "Filter rows" खोज, हर पेज 25 पंक्ति, "CSV" से filter की हुई पंक्तियाँ डाउनलोड।

**आम दिक्कतें और हल**
- "संदेश: "This report could not be loaded. Try refreshing."" — Server request फेल हुआ या आपके role को यह रिपोर्ट नहीं मिली। "Refresh" दबाएँ; बार-बार हो तो admin से अनुमति माँगें।
- "संदेश: "No figures for this period"" — Filter के हिसाब से कुछ दर्ज नहीं। अवधि बढ़ाएँ या filter हटाएँ।
- "संदेश: "No telemetry in selected period."" — अवधि के किसी job पर machine output log नहीं। Work center से terminal पर output दर्ज करवाएँ।
- "संदेश: "No shift tags captured in selected telemetry. / No shift schedule configured."" — Output log पर shift code नहीं, या plant में कोई चालू shift नहीं। Factory setting में shift बनाएँ।

**अटक गए तो**
1. "Refresh" दबाएँ (रिपोर्ट हर 3 मिनट में खुद भी ताज़ा होती है)।
2. अवधि खाली हो तो 90D या FY चुनें, और Plant व Shift को फिर "All" करें।
3. पीला चेतावनी बॉक्स पढ़ें; उसमें कमी वाले डेटा का नाम होता है।

जुड़े पेज: /analytics/reports, /inventory/rolls, /inventory/alerts, /analytics/inventory-health

**अभी नहीं होता / ध्यान दें**
- Stock आँकड़े तारीख filter नहीं मानते (हमेशा अभी के), bulk stock plant filter नहीं मानता, और roll में status filter नहीं है, इसलिए consumed या scrapped roll भी कुल में आ सकते हैं।

### Inventory Lineage (stock वंश) (/analytics/reports/inventory-lineage)
स्क्रीन का पता: /analytics/reports/inventory-lineage · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, STORE, PLANNER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=analytics-reports-inventory-lineage&lang=hi

Family, stage, material, location और plant के हिसाब से stock; stages में पीछे trace करने की शुरुआत।

देखें कौन सी family किस stage पर है, फिर Roll genealogy में सही roll trace करें।

**शुरू करने से पहले**
- Roll पर material, stage और location हो।

**स्टेप बाय स्टेप**
1. अवधि चुनें (7D, 30D, 90D, MTD, FY या Custom) और ज़रूरत हो तो Plant और Shift।
2. ऊपर के chips (अवधि, "Updated", डेटा कवरेज) और कोई पीली चेतावनी देखें।
3. Stock tiles और "By stage" व "Largest stock families" panel पढ़ें।
4. "Trend" (माप चुनें) और "Insights" से दिशा देखें।
5. ब्योरे के panel और detail table पढ़ें; "Filter rows" और column header पर क्लिक करके sort करें।
6. "Trace an exact roll" (ERP ID, supplier roll reference या QR) इस्तेमाल करें।
7. "CSV" (पंक्तियाँ) या "PDF" (पूरी रिपोर्ट) से डाउनलोड करें; "All reports" से Reports Hub पर लौटें।

**स्क्रीन पर क्या है**
- **स्क्रीन पर: "Roll stock"**: दायरे के roll का कुल वज़न (plant filter लागू)। यह अभी का stock है, चुनी तारीख का नहीं।
- **स्क्रीन पर: "Bulk stock"**: Granule, chemical और बाकी bulk stock KG में (सभी plants)।
- **स्क्रीन पर: "Stock items"**: Roll की संख्या।
- **स्क्रीन पर: "Aged stock / Aged items"**: 90 दिन से पुराने roll (बनने की तारीख से)।
- **स्क्रीन पर: "Estimated value"**: Roll वज़न × नवीनतम material cost rate, केवल उन material के लिए जिनकी दर है।
- **स्क्रीन पर: "Valuation coverage / Items without a rate"**: दर वाला वज़न ÷ कुल वज़न × 100 (target 100%), और जिन roll के material की दर नहीं।
- **स्क्रीन पर: "Sections"**: "Stock aging" band, "By stage" (RAW, WIP_STEP_n, FG), "By item type", "Largest stock families", "By material", "By location", "By plant"; table "Stock items"।
- **स्क्रीन पर: "Period (7D / 30D / 90D / MTD / FY / Custom)"**: तारीख की अवधि। Default 30D। MTD = इस महीने अब तक; FY = 1 अप्रैल से। "Custom" में "From date" और "To date" आते हैं। Filter पेज के पते में रहते हैं, link भेजा जा सकता है।
- **स्क्रीन पर: "Plant / Process / Shift"**: रिपोर्ट को एक plant या shift तक सीमित करें। Process filter हर रिपोर्ट पर दिखता है पर अभी server उसे लागू नहीं करता।
- **स्क्रीन पर: "Machine logs / Material actuals / Shift tags"**: डेटा कवरेज chips: अवधि में बने job में से कितने % पर output log है; कितने % पर material issue/खपत/वापसी है; कितने % output log पर shift code है। 80%+ हरा, 30%+ पीला, कम तो लाल; रिपोर्ट में काम न आए तो N/A।
- **स्क्रीन पर: "KPI tiles (On target / Below target)"**: अधिकतम 8 tiles। जहाँ target है वहाँ tile उसके हिसाब से अच्छा या खराब रंग लेती है।
- **स्क्रीन पर: "Trend / Insights"**: चुने माप का रोज़ का chart (खाली दिन शून्य) और उसी डेटा से छोटे निष्कर्ष।
- **स्क्रीन पर: "Detail table"**: Sort होने वाली पंक्तियाँ, "Filter rows" खोज, हर पेज 25 पंक्ति, "CSV" से filter की हुई पंक्तियाँ डाउनलोड।

**आम दिक्कतें और हल**
- "संदेश: "This report could not be loaded. Try refreshing."" — Server request फेल हुआ या आपके role को यह रिपोर्ट नहीं मिली। "Refresh" दबाएँ; बार-बार हो तो admin से अनुमति माँगें।
- "संदेश: "No figures for this period"" — Filter के हिसाब से कुछ दर्ज नहीं। अवधि बढ़ाएँ या filter हटाएँ।
- "संदेश: "No telemetry in selected period."" — अवधि के किसी job पर machine output log नहीं। Work center से terminal पर output दर्ज करवाएँ।
- "संदेश: "No shift tags captured in selected telemetry. / No shift schedule configured."" — Output log पर shift code नहीं, या plant में कोई चालू shift नहीं। Factory setting में shift बनाएँ।

**अटक गए तो**
1. "Refresh" दबाएँ (रिपोर्ट हर 3 मिनट में खुद भी ताज़ा होती है)।
2. अवधि खाली हो तो 90D या FY चुनें, और Plant व Shift को फिर "All" करें।
3. पीला चेतावनी बॉक्स पढ़ें; उसमें कमी वाले डेटा का नाम होता है।

जुड़े पेज: /analytics/reports, /inventory/traceability, /analytics/reports/inventory

**अभी नहीं होता / ध्यान दें**
- Inventory Lineage बिल्कुल Inventory Health जैसा डेटा देता है; इस पेज पर stage-से-stage वंश नहीं दिखता।

### Material Variance (material अंतर) (/analytics/reports/material-variance)
स्क्रीन का पता: /analytics/reports/material-variance · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, PLANNER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=analytics-reports-material-variance&lang=hi

योजना की ज़रूरत बनाम issue और दर्ज खपत, material और job के हिसाब से।

सबसे ज़्यादा अधिक इस्तेमाल वाले material और job ढूँढने के लिए खोलें। MRP & Consumption Variance जैसे ही आँकड़े।

**शुरू करने से पहले**
- Job पर material requirement हो और store issue, खपत, वापसी दर्ज करे।

**स्टेप बाय स्टेप**
1. अवधि चुनें (7D, 30D, 90D, MTD, FY या Custom) और ज़रूरत हो तो Plant और Shift।
2. ऊपर के chips (अवधि, "Updated", डेटा कवरेज) और कोई पीली चेतावनी देखें।
3. Variance tiles और "Variance by material" पढ़ें।
4. "Trend" (माप चुनें) और "Insights" से दिशा देखें।
5. ब्योरे के panel और detail table पढ़ें; "Filter rows" और column header पर क्लिक करके sort करें।
6. "CSV" (पंक्तियाँ) या "PDF" (पूरी रिपोर्ट) से डाउनलोड करें; "All reports" से Reports Hub पर लौटें।

**स्क्रीन पर क्या है**
- **स्क्रीन पर: "Theoretical need"**: अवधि में बने job की recipe से बिना नुकसान वाली मात्रा (job worker का अपना material छोड़कर)।
- **स्क्रीन पर: "Issued / Consumed / Returned to store"**: Job को असल में issue, खपत और वापस हुआ material।
- **स्क्रीन पर: "Variance"**: खपत − theoretical। धनात्मक = ज़्यादा इस्तेमाल।
- **स्क्रीन पर: "Waste factor"**: (Required − theoretical) ÷ theoretical × 100: योजना में रखी बर्बादी। Target 5% या कम।
- **स्क्रीन पर: "Planning accuracy"**: Theoretical ÷ खपत × 100। Target 95%।
- **स्क्रीन पर: "Issue accuracy"**: Planned issue ÷ असल issue × 100। Target 95%।
- **स्क्रीन पर: "Sections"**: "Material flow" (theoretical → issue → खपत → वापसी → कुल variance), "Variance by material" (खपत से top 20; OVER/UNDER/OK), "Jobs with the largest overuse" (top 15)।
- **स्क्रीन पर: "Period (7D / 30D / 90D / MTD / FY / Custom)"**: तारीख की अवधि। Default 30D। MTD = इस महीने अब तक; FY = 1 अप्रैल से। "Custom" में "From date" और "To date" आते हैं। Filter पेज के पते में रहते हैं, link भेजा जा सकता है।
- **स्क्रीन पर: "Plant / Process / Shift"**: रिपोर्ट को एक plant या shift तक सीमित करें। Process filter हर रिपोर्ट पर दिखता है पर अभी server उसे लागू नहीं करता।
- **स्क्रीन पर: "Machine logs / Material actuals / Shift tags"**: डेटा कवरेज chips: अवधि में बने job में से कितने % पर output log है; कितने % पर material issue/खपत/वापसी है; कितने % output log पर shift code है। 80%+ हरा, 30%+ पीला, कम तो लाल; रिपोर्ट में काम न आए तो N/A।
- **स्क्रीन पर: "KPI tiles (On target / Below target)"**: अधिकतम 8 tiles। जहाँ target है वहाँ tile उसके हिसाब से अच्छा या खराब रंग लेती है।
- **स्क्रीन पर: "Trend / Insights"**: चुने माप का रोज़ का chart (खाली दिन शून्य) और उसी डेटा से छोटे निष्कर्ष।
- **स्क्रीन पर: "Detail table"**: Sort होने वाली पंक्तियाँ, "Filter rows" खोज, हर पेज 25 पंक्ति, "CSV" से filter की हुई पंक्तियाँ डाउनलोड।

**आम दिक्कतें और हल**
- "संदेश: "No material actuals captured."" — अवधि में job पर कोई issue, खपत या वापसी दर्ज नहीं।
- "संदेश: "This report could not be loaded. Try refreshing."" — Server request फेल हुआ या आपके role को यह रिपोर्ट नहीं मिली। "Refresh" दबाएँ; बार-बार हो तो admin से अनुमति माँगें।
- "संदेश: "No figures for this period"" — Filter के हिसाब से कुछ दर्ज नहीं। अवधि बढ़ाएँ या filter हटाएँ।
- "संदेश: "No telemetry in selected period."" — अवधि के किसी job पर machine output log नहीं। Work center से terminal पर output दर्ज करवाएँ।
- "संदेश: "No shift tags captured in selected telemetry. / No shift schedule configured."" — Output log पर shift code नहीं, या plant में कोई चालू shift नहीं। Factory setting में shift बनाएँ।

**अटक गए तो**
1. "Refresh" दबाएँ (रिपोर्ट हर 3 मिनट में खुद भी ताज़ा होती है)।
2. अवधि खाली हो तो 90D या FY चुनें, और Plant व Shift को फिर "All" करें।
3. पीला चेतावनी बॉक्स पढ़ें; उसमें कमी वाले डेटा का नाम होता है।

जुड़े पेज: /analytics/reports, /analytics/reports/mrp, /production/ink-control

**अभी नहीं होता / ध्यान दें**
- Material Variance और MRP & Consumption Variance एक ही आँकड़े दिखाते हैं।

### MRP & Consumption Variance (खपत अंतर) (/analytics/reports/mrp)
स्क्रीन का पता: /analytics/reports/mrp · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, PLANNER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=analytics-reports-mrp&lang=hi

Theoretical बनाम required बनाम issue बनाम असल खपत, material और job variance के साथ।

Job पूरे होने के बाद खोलें; देखें कहाँ material ज़्यादा लगा। यह खपत का अंतर है; कमी की योजना MRP Center में है।

**शुरू करने से पहले**
- Job पर material requirement हो और store issue, खपत, वापसी दर्ज करे।

**स्टेप बाय स्टेप**
1. अवधि चुनें (7D, 30D, 90D, MTD, FY या Custom) और ज़रूरत हो तो Plant और Shift।
2. ऊपर के chips (अवधि, "Updated", डेटा कवरेज) और कोई पीली चेतावनी देखें।
3. "Theoretical need", "Issued", "Consumed", "Variance", "Waste factor", "Planning accuracy", "Issue accuracy", "Returned to store" पढ़ें।
4. "Trend" (माप चुनें) और "Insights" से दिशा देखें।
5. ब्योरे के panel और detail table पढ़ें; "Filter rows" और column header पर क्लिक करके sort करें।
6. MRP Center खोलने के लिए "Review material demand"।
7. "CSV" (पंक्तियाँ) या "PDF" (पूरी रिपोर्ट) से डाउनलोड करें; "All reports" से Reports Hub पर लौटें।

**स्क्रीन पर क्या है**
- **स्क्रीन पर: "Theoretical need"**: अवधि में बने job की recipe से बिना नुकसान वाली मात्रा (job worker का अपना material छोड़कर)।
- **स्क्रीन पर: "Issued / Consumed / Returned to store"**: Job को असल में issue, खपत और वापस हुआ material।
- **स्क्रीन पर: "Variance"**: खपत − theoretical। धनात्मक = ज़्यादा इस्तेमाल।
- **स्क्रीन पर: "Waste factor"**: (Required − theoretical) ÷ theoretical × 100: योजना में रखी बर्बादी। Target 5% या कम।
- **स्क्रीन पर: "Planning accuracy"**: Theoretical ÷ खपत × 100। Target 95%।
- **स्क्रीन पर: "Issue accuracy"**: Planned issue ÷ असल issue × 100। Target 95%।
- **स्क्रीन पर: "Sections"**: "Material flow" (theoretical → issue → खपत → वापसी → कुल variance), "Variance by material" (खपत से top 20; OVER/UNDER/OK), "Jobs with the largest overuse" (top 15)।
- **स्क्रीन पर: "Period (7D / 30D / 90D / MTD / FY / Custom)"**: तारीख की अवधि। Default 30D। MTD = इस महीने अब तक; FY = 1 अप्रैल से। "Custom" में "From date" और "To date" आते हैं। Filter पेज के पते में रहते हैं, link भेजा जा सकता है।
- **स्क्रीन पर: "Plant / Process / Shift"**: रिपोर्ट को एक plant या shift तक सीमित करें। Process filter हर रिपोर्ट पर दिखता है पर अभी server उसे लागू नहीं करता।
- **स्क्रीन पर: "Machine logs / Material actuals / Shift tags"**: डेटा कवरेज chips: अवधि में बने job में से कितने % पर output log है; कितने % पर material issue/खपत/वापसी है; कितने % output log पर shift code है। 80%+ हरा, 30%+ पीला, कम तो लाल; रिपोर्ट में काम न आए तो N/A।
- **स्क्रीन पर: "KPI tiles (On target / Below target)"**: अधिकतम 8 tiles। जहाँ target है वहाँ tile उसके हिसाब से अच्छा या खराब रंग लेती है।
- **स्क्रीन पर: "Trend / Insights"**: चुने माप का रोज़ का chart (खाली दिन शून्य) और उसी डेटा से छोटे निष्कर्ष।
- **स्क्रीन पर: "Detail table"**: Sort होने वाली पंक्तियाँ, "Filter rows" खोज, हर पेज 25 पंक्ति, "CSV" से filter की हुई पंक्तियाँ डाउनलोड।

**आम दिक्कतें और हल**
- "संदेश: "No material actuals captured."" — अवधि में job पर कोई issue, खपत या वापसी दर्ज नहीं।
- "संदेश: "This report could not be loaded. Try refreshing."" — Server request फेल हुआ या आपके role को यह रिपोर्ट नहीं मिली। "Refresh" दबाएँ; बार-बार हो तो admin से अनुमति माँगें।
- "संदेश: "No figures for this period"" — Filter के हिसाब से कुछ दर्ज नहीं। अवधि बढ़ाएँ या filter हटाएँ।
- "संदेश: "No telemetry in selected period."" — अवधि के किसी job पर machine output log नहीं। Work center से terminal पर output दर्ज करवाएँ।
- "संदेश: "No shift tags captured in selected telemetry. / No shift schedule configured."" — Output log पर shift code नहीं, या plant में कोई चालू shift नहीं। Factory setting में shift बनाएँ।

**अटक गए तो**
1. "Refresh" दबाएँ (रिपोर्ट हर 3 मिनट में खुद भी ताज़ा होती है)।
2. अवधि खाली हो तो 90D या FY चुनें, और Plant व Shift को फिर "All" करें।
3. पीला चेतावनी बॉक्स पढ़ें; उसमें कमी वाले डेटा का नाम होता है।

जुड़े पेज: /analytics/reports, /analytics/mrp, /analytics/reports/material-variance

**अभी नहीं होता / ध्यान दें**
- यह रिपोर्ट खपत का अंतर दिखाती है, MRP कमी योजना नहीं; नाम से लोग यहाँ कमी देखने की उम्मीद कर सकते हैं।

### OEE Deep Dive (OEE विश्लेषण) (/analytics/reports/oee)
स्क्रीन का पता: /analytics/reports/oee · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, WORK_CENTER_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=analytics-reports-oee&lang=hi

मशीन-वार OEE = availability × performance × quality, प्लांट का कुल, OEE band और work-centre औसत।

हफ़्ते में खोलें; देखें कौन सी मशीन समय, गति या quality खो रही है। "Where OEE is lost" panel सबसे कमज़ोर हिस्सा दिखाता है, जहाँ मेहनत का सबसे जल्दी फायदा है।

**शुरू करने से पहले**
- Operator work-center terminal पर output, scrap (कारण सहित) और pause/downtime दर्ज करें।
- हर मशीन के master में standard rate (kg/h) चाहिए; नहीं तो उसका performance और OEE 0% दिखेगा।

**स्टेप बाय स्टेप**
1. अवधि चुनें (7D, 30D, 90D, MTD, FY या Custom) और ज़रूरत हो तो Plant और Shift।
2. ऊपर के chips (अवधि, "Updated", डेटा कवरेज) और कोई पीली चेतावनी देखें।
3. "OEE", "Availability", "Performance", "Quality", "Output", "Scrap", "Machines running", "Idle machines" पढ़ें।
4. "Trend" (माप चुनें) और "Insights" से दिशा देखें।
5. ब्योरे के panel और detail table पढ़ें; "Filter rows" और column header पर क्लिक करके sort करें।
6. Downtime और गायब rated capacity जाँचने के लिए "Review machine setup"।
7. "CSV" (पंक्तियाँ) या "PDF" (पूरी रिपोर्ट) से डाउनलोड करें; "All reports" से Reports Hub पर लौटें।

**स्क्रीन पर क्या है**
- **स्क्रीन पर: "Availability"**: हर मशीन: (24 घंटे × दिन − downtime घंटे) ÷ (24 घंटे × दिन)। कैलेंडर घंटे, shift घंटे नहीं। प्लांट का आँकड़ा = चलती मशीनों का औसत। Target 90%।
- **स्क्रीन पर: "Performance"**: बना KG ÷ (standard rate kg/h × उपलब्ध घंटे), अधिकतम 100%। प्लांट = कुल output ÷ कुल सैद्धांतिक output। Target 95%।
- **स्क्रीन पर: "Quality"**: बना ÷ (बना + scrap)। Target 99%।
- **स्क्रीन पर: "OEE"**: Availability × performance × quality। Target 85% (world class)।
- **स्क्रीन पर: "Machines running / Idle machines"**: अवधि में output, scrap या downtime वाली चालू मशीनें / जिनमें कुछ नहीं।
- **स्क्रीन पर: "Machines by OEE band"**: "World class (85%+)", "Stable (60–85%)", "Needs attention (<60%)"।
- **स्क्रीन पर: "Period (7D / 30D / 90D / MTD / FY / Custom)"**: तारीख की अवधि। Default 30D। MTD = इस महीने अब तक; FY = 1 अप्रैल से। "Custom" में "From date" और "To date" आते हैं। Filter पेज के पते में रहते हैं, link भेजा जा सकता है।
- **स्क्रीन पर: "Plant / Process / Shift"**: रिपोर्ट को एक plant या shift तक सीमित करें। Process filter हर रिपोर्ट पर दिखता है पर अभी server उसे लागू नहीं करता।
- **स्क्रीन पर: "Machine logs / Material actuals / Shift tags"**: डेटा कवरेज chips: अवधि में बने job में से कितने % पर output log है; कितने % पर material issue/खपत/वापसी है; कितने % output log पर shift code है। 80%+ हरा, 30%+ पीला, कम तो लाल; रिपोर्ट में काम न आए तो N/A।
- **स्क्रीन पर: "KPI tiles (On target / Below target)"**: अधिकतम 8 tiles। जहाँ target है वहाँ tile उसके हिसाब से अच्छा या खराब रंग लेती है।
- **स्क्रीन पर: "Trend / Insights"**: चुने माप का रोज़ का chart (खाली दिन शून्य) और उसी डेटा से छोटे निष्कर्ष।
- **स्क्रीन पर: "Detail table"**: Sort होने वाली पंक्तियाँ, "Filter rows" खोज, हर पेज 25 पंक्ति, "CSV" से filter की हुई पंक्तियाँ डाउनलोड।

**आम दिक्कतें और हल**
- "संदेश: "N active machine(s) have no standard rate (kg/h)…"" — उन मशीनों के master में standard rate भरें।
- "संदेश: "No machine telemetry found in the selected window."" — अवधि में किसी चालू मशीन पर output, scrap या downtime नहीं।
- "संदेश: "This report could not be loaded. Try refreshing."" — Server request फेल हुआ या आपके role को यह रिपोर्ट नहीं मिली। "Refresh" दबाएँ; बार-बार हो तो admin से अनुमति माँगें।
- "संदेश: "No figures for this period"" — Filter के हिसाब से कुछ दर्ज नहीं। अवधि बढ़ाएँ या filter हटाएँ।
- "संदेश: "No telemetry in selected period."" — अवधि के किसी job पर machine output log नहीं। Work center से terminal पर output दर्ज करवाएँ।
- "संदेश: "No shift tags captured in selected telemetry. / No shift schedule configured."" — Output log पर shift code नहीं, या plant में कोई चालू shift नहीं। Factory setting में shift बनाएँ।

**अटक गए तो**
1. "Refresh" दबाएँ (रिपोर्ट हर 3 मिनट में खुद भी ताज़ा होती है)।
2. अवधि खाली हो तो 90D या FY चुनें, और Plant व Shift को फिर "All" करें।
3. पीला चेतावनी बॉक्स पढ़ें; उसमें कमी वाले डेटा का नाम होता है।

जुड़े पेज: /analytics/reports, /analytics/reports/downtime, /production/machine-selector, /factory/machines

**अभी नहीं होता / ध्यान दें**
- Availability 24 घंटे के कैलेंडर दिन से है, planned shift घंटों से नहीं; एक shift चलाने वाले plant में availability और OEE हमेशा कम दिखेगा।

### Operator Performance (operator प्रदर्शन) (/analytics/reports/operator)
स्क्रीन का पता: /analytics/reports/operator · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, WORK_CENTER_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=analytics-reports-operator&lang=hi

Operators की सूची: output, efficiency, scrap और job।

अच्छे operator को पहचानने और ज़्यादा scrap वालों को सिखाने के लिए खोलें।

**शुरू करने से पहले**
- Job पर operator लगा हो।

**स्टेप बाय स्टेप**
1. अवधि चुनें (7D, 30D, 90D, MTD, FY या Custom) और ज़रूरत हो तो Plant और Shift।
2. ऊपर के chips (अवधि, "Updated", डेटा कवरेज) और कोई पीली चेतावनी देखें।
3. "Active operators", "Output", "Avg efficiency", "Top performer" और "Operator leaderboard" पढ़ें।
4. "Trend" (माप चुनें) और "Insights" से दिशा देखें।
5. ब्योरे के panel और detail table पढ़ें; "Filter rows" और column header पर क्लिक करके sort करें।
6. "CSV" (पंक्तियाँ) या "PDF" (पूरी रिपोर्ट) से डाउनलोड करें; "All reports" से Reports Hub पर लौटें।

**स्क्रीन पर क्या है**
- **स्क्रीन पर: "Output"**: अवधि में बने job की बनी मात्रा, job के operator के हिसाब से (top 20)।
- **स्क्रीन पर: "Avg efficiency"**: हर operator के बना ÷ (बना + scrap) का औसत। यह yield है, गति नहीं। Target 95%।
- **स्क्रीन पर: "Top performer"**: सबसे ऊँची efficiency वाला operator।
- **स्क्रीन पर: "Completion rate / Target achievement"**: पूरे job ÷ job; बना ÷ job की मात्रा।
- **स्क्रीन पर: "Period (7D / 30D / 90D / MTD / FY / Custom)"**: तारीख की अवधि। Default 30D। MTD = इस महीने अब तक; FY = 1 अप्रैल से। "Custom" में "From date" और "To date" आते हैं। Filter पेज के पते में रहते हैं, link भेजा जा सकता है।
- **स्क्रीन पर: "Plant / Process / Shift"**: रिपोर्ट को एक plant या shift तक सीमित करें। Process filter हर रिपोर्ट पर दिखता है पर अभी server उसे लागू नहीं करता।
- **स्क्रीन पर: "Machine logs / Material actuals / Shift tags"**: डेटा कवरेज chips: अवधि में बने job में से कितने % पर output log है; कितने % पर material issue/खपत/वापसी है; कितने % output log पर shift code है। 80%+ हरा, 30%+ पीला, कम तो लाल; रिपोर्ट में काम न आए तो N/A।
- **स्क्रीन पर: "KPI tiles (On target / Below target)"**: अधिकतम 8 tiles। जहाँ target है वहाँ tile उसके हिसाब से अच्छा या खराब रंग लेती है।
- **स्क्रीन पर: "Trend / Insights"**: चुने माप का रोज़ का chart (खाली दिन शून्य) और उसी डेटा से छोटे निष्कर्ष।
- **स्क्रीन पर: "Detail table"**: Sort होने वाली पंक्तियाँ, "Filter rows" खोज, हर पेज 25 पंक्ति, "CSV" से filter की हुई पंक्तियाँ डाउनलोड।

**आम दिक्कतें और हल**
- "संदेश: "This report could not be loaded. Try refreshing."" — Server request फेल हुआ या आपके role को यह रिपोर्ट नहीं मिली। "Refresh" दबाएँ; बार-बार हो तो admin से अनुमति माँगें।
- "संदेश: "No figures for this period"" — Filter के हिसाब से कुछ दर्ज नहीं। अवधि बढ़ाएँ या filter हटाएँ।
- "संदेश: "No telemetry in selected period."" — अवधि के किसी job पर machine output log नहीं। Work center से terminal पर output दर्ज करवाएँ।
- "संदेश: "No shift tags captured in selected telemetry. / No shift schedule configured."" — Output log पर shift code नहीं, या plant में कोई चालू shift नहीं। Factory setting में shift बनाएँ।

**अटक गए तो**
1. "Refresh" दबाएँ (रिपोर्ट हर 3 मिनट में खुद भी ताज़ा होती है)।
2. अवधि खाली हो तो 90D या FY चुनें, और Plant व Shift को फिर "All" करें।
3. पीला चेतावनी बॉक्स पढ़ें; उसमें कमी वाले डेटा का नाम होता है।

जुड़े पेज: /analytics/reports, /analytics/reports/production

**अभी नहीं होता / ध्यान दें**
- "Efficiency" असल में yield है (अच्छा ÷ अच्छा + scrap), प्रति घंटा output नहीं; और केवल output से top 20 operator दिखते हैं।
- Output job पर लगे operator के नाम जाता है, उसके नहीं जिसने असल में output दर्ज किया।

### Production Performance (उत्पादन प्रदर्शन) (/analytics/reports/production)
स्क्रीन का पता: /analytics/reports/production · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, PLANNER, WORK_CENTER_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=analytics-reports-production&lang=hi

अवधि का output, yield, scrap और job पूरे होने की दर, process, work centre, shift, मशीन और operator के हिसाब से।

उत्पादन आँकने और yield गिराने वाली मशीन या process ढूँढने के लिए रोज़ या हफ़्ते में खोलें। डेटा terminal के output और scrap log से आता है।

**शुरू करने से पहले**
- Operator work-center terminal पर output, scrap (कारण सहित) और pause/downtime दर्ज करें।
- Pieces वाली sales lines में unit weight (g) चाहिए ताकि pieces को KG में बदला जा सके।

**स्टेप बाय स्टेप**
1. अवधि चुनें (7D, 30D, 90D, MTD, FY या Custom) और ज़रूरत हो तो Plant और Shift।
2. ऊपर के chips (अवधि, "Updated", डेटा कवरेज) और कोई पीली चेतावनी देखें।
3. "Output", "Yield", "Scrap rate", "Job completion", "Jobs", "Output per machine", "Active machines", "Avg job size" पढ़ें।
4. "Trend" (माप चुनें) और "Insights" से दिशा देखें।
5. ब्योरे के panel और detail table पढ़ें; "Filter rows" और column header पर क्लिक करके sort करें।
6. Planner खोलने के लिए "Turn this report into action" → "Resolve waiting jobs"।
7. "CSV" (पंक्तियाँ) या "PDF" (पूरी रिपोर्ट) से डाउनलोड करें; "All reports" से Reports Hub पर लौटें।

**स्क्रीन पर क्या है**
- **स्क्रीन पर: "Output"**: अवधि में दर्ज अच्छा output, KG में। Piece log तभी बदले जाते हैं जब line का unit weight पता हो; बाकी छोड़ दिए जाते हैं।
- **स्क्रीन पर: "Yield"**: Output ÷ (output + scrap) × 100। Target 95%।
- **स्क्रीन पर: "Scrap rate"**: 100 − yield। Target 5% या कम।
- **स्क्रीन पर: "Job completion"**: अवधि में बने job में से COMPLETED ÷ अवधि में बने सभी job।
- **स्क्रीन पर: "Output per machine / Active machines"**: Output ÷ अवधि में job वाली मशीनें।
- **स्क्रीन पर: "Avg job size"**: Job की औसत planned KG (बिना KG बदलाव वाले job छोड़कर)।
- **स्क्रीन पर: "Sections"**: "Output by process", "Output by work centre", "Output by shift", "Job status mix", "Machine output", "Scrap reasons", "Output by operator"; table "Jobs in period"।
- **स्क्रीन पर: "Period (7D / 30D / 90D / MTD / FY / Custom)"**: तारीख की अवधि। Default 30D। MTD = इस महीने अब तक; FY = 1 अप्रैल से। "Custom" में "From date" और "To date" आते हैं। Filter पेज के पते में रहते हैं, link भेजा जा सकता है।
- **स्क्रीन पर: "Plant / Process / Shift"**: रिपोर्ट को एक plant या shift तक सीमित करें। Process filter हर रिपोर्ट पर दिखता है पर अभी server उसे लागू नहीं करता।
- **स्क्रीन पर: "Machine logs / Material actuals / Shift tags"**: डेटा कवरेज chips: अवधि में बने job में से कितने % पर output log है; कितने % पर material issue/खपत/वापसी है; कितने % output log पर shift code है। 80%+ हरा, 30%+ पीला, कम तो लाल; रिपोर्ट में काम न आए तो N/A।
- **स्क्रीन पर: "KPI tiles (On target / Below target)"**: अधिकतम 8 tiles। जहाँ target है वहाँ tile उसके हिसाब से अच्छा या खराब रंग लेती है।
- **स्क्रीन पर: "Trend / Insights"**: चुने माप का रोज़ का chart (खाली दिन शून्य) और उसी डेटा से छोटे निष्कर्ष।
- **स्क्रीन पर: "Detail table"**: Sort होने वाली पंक्तियाँ, "Filter rows" खोज, हर पेज 25 पंक्ति, "CSV" से filter की हुई पंक्तियाँ डाउनलोड।

**आम दिक्कतें और हल**
- "संदेश: "Jobs exist in the selected window but no execution output was logged."" — Job बने पर किसी ने output दर्ज नहीं किया। Terminal जाँचें।
- "संदेश: "Scrap exceeded good output in the selected production window."" — अच्छे output से ज़्यादा scrap। गलत entry (KG बनाम pieces) या असली quality समस्या जाँचें।
- "संदेश: "N jobs have no reliable KG conversion…"" — ये job pieces में हैं और unit weight नहीं। Sales line पर unit weight जोड़ें।
- "संदेश: "This report could not be loaded. Try refreshing."" — Server request फेल हुआ या आपके role को यह रिपोर्ट नहीं मिली। "Refresh" दबाएँ; बार-बार हो तो admin से अनुमति माँगें।
- "संदेश: "No figures for this period"" — Filter के हिसाब से कुछ दर्ज नहीं। अवधि बढ़ाएँ या filter हटाएँ।
- "संदेश: "No telemetry in selected period."" — अवधि के किसी job पर machine output log नहीं। Work center से terminal पर output दर्ज करवाएँ।
- "संदेश: "No shift tags captured in selected telemetry. / No shift schedule configured."" — Output log पर shift code नहीं, या plant में कोई चालू shift नहीं। Factory setting में shift बनाएँ।

**अटक गए तो**
1. "Refresh" दबाएँ (रिपोर्ट हर 3 मिनट में खुद भी ताज़ा होती है)।
2. अवधि खाली हो तो 90D या FY चुनें, और Plant व Shift को फिर "All" करें।
3. पीला चेतावनी बॉक्स पढ़ें; उसमें कमी वाले डेटा का नाम होता है।

जुड़े पेज: /analytics/reports, /production/planner, /analytics/reports/scrap, /analytics/reports/oee

**अभी नहीं होता / ध्यान दें**
- Process filter सभी रिपोर्ट पेज पर दिखता है पर server उसे नहीं मानता, इसलिए process चुनने से आँकड़े नहीं बदलते।
- Job completion और गिनती अवधि में बने job से है, जबकि output अवधि के log से; लंबा job output एक अवधि में और completion दूसरी में गिन सकता है।

### Sales Fulfillment (बिक्री पूर्ति) (/analytics/reports/sales)
स्क्रीन का पता: /analytics/reports/sales · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, SALES · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=analytics-reports-sales&lang=hi

Order की कीमत, order वज़न, समय पर पूरा होना, खुले और overdue order, quote conversion, top customer और product।

हफ़्ते में order book देखने और overdue order का पीछा करने के लिए खोलें।

**शुरू करने से पहले**
- Delivery तारीख वाले sales order; dispatch हुए challan।

**स्टेप बाय स्टेप**
1. अवधि चुनें (7D, 30D, 90D, MTD, FY या Custom) और ज़रूरत हो तो Plant और Shift।
2. ऊपर के chips (अवधि, "Updated", डेटा कवरेज) और कोई पीली चेतावनी देखें।
3. "Order value", "Weight ordered", "On-time completion proxy", "Open orders", "Overdue orders", "Completed", "Quote conversion", "Repeat business" पढ़ें।
4. "Trend" (माप चुनें) और "Insights" से दिशा देखें।
5. ब्योरे के panel और detail table पढ़ें; "Filter rows" और column header पर क्लिक करके sort करें।
6. Sales orders खोलने के लिए "Review overdue orders"।
7. "CSV" (पंक्तियाँ) या "PDF" (पूरी रिपोर्ट) से डाउनलोड करें; "All reports" से Reports Hub पर लौटें।

**स्क्रीन पर क्या है**
- **स्क्रीन पर: "Order value / Weight ordered"**: अवधि में बने order (cancelled छोड़कर) की line राशि और line वज़न।
- **स्क्रीन पर: "On-time completion proxy"**: पूरे order जिनकी आखिरी challan dispatch तारीख (नहीं तो confirmation या बनने की तारीख) delivery तारीख तक है ÷ पूरे order। असली OTIF नहीं: मात्रा और POD नहीं जाँचे जाते।
- **स्क्रीन पर: "Open orders / Overdue orders"**: COMPLETED नहीं हुए order; उनमें से delivery तारीख आज से पहले वाले।
- **स्क्रीन पर: "Quote conversion"**: Sales order में बदली quotation ÷ quotation।
- **स्क्रीन पर: "Sections"**: "Order pipeline", "Top customers", "Products by value", "Most overdue orders"; table "Overdue orders"।
- **स्क्रीन पर: "Period (7D / 30D / 90D / MTD / FY / Custom)"**: तारीख की अवधि। Default 30D। MTD = इस महीने अब तक; FY = 1 अप्रैल से। "Custom" में "From date" और "To date" आते हैं। Filter पेज के पते में रहते हैं, link भेजा जा सकता है।
- **स्क्रीन पर: "Plant / Process / Shift"**: रिपोर्ट को एक plant या shift तक सीमित करें। Process filter हर रिपोर्ट पर दिखता है पर अभी server उसे लागू नहीं करता।
- **स्क्रीन पर: "Machine logs / Material actuals / Shift tags"**: डेटा कवरेज chips: अवधि में बने job में से कितने % पर output log है; कितने % पर material issue/खपत/वापसी है; कितने % output log पर shift code है। 80%+ हरा, 30%+ पीला, कम तो लाल; रिपोर्ट में काम न आए तो N/A।
- **स्क्रीन पर: "KPI tiles (On target / Below target)"**: अधिकतम 8 tiles। जहाँ target है वहाँ tile उसके हिसाब से अच्छा या खराब रंग लेती है।
- **स्क्रीन पर: "Trend / Insights"**: चुने माप का रोज़ का chart (खाली दिन शून्य) और उसी डेटा से छोटे निष्कर्ष।
- **स्क्रीन पर: "Detail table"**: Sort होने वाली पंक्तियाँ, "Filter rows" खोज, हर पेज 25 पंक्ति, "CSV" से filter की हुई पंक्तियाँ डाउनलोड।

**आम दिक्कतें और हल**
- "संदेश: "Completion timing is a proxy, not OTIF…"" — स्थायी चेतावनी: पूरी मात्रा और POD नियम तय होने तक on-time आँकड़ा अनुमान है।
- "संदेश: "This report could not be loaded. Try refreshing."" — Server request फेल हुआ या आपके role को यह रिपोर्ट नहीं मिली। "Refresh" दबाएँ; बार-बार हो तो admin से अनुमति माँगें।
- "संदेश: "No figures for this period"" — Filter के हिसाब से कुछ दर्ज नहीं। अवधि बढ़ाएँ या filter हटाएँ।
- "संदेश: "No telemetry in selected period."" — अवधि के किसी job पर machine output log नहीं। Work center से terminal पर output दर्ज करवाएँ।
- "संदेश: "No shift tags captured in selected telemetry. / No shift schedule configured."" — Output log पर shift code नहीं, या plant में कोई चालू shift नहीं। Factory setting में shift बनाएँ।

**अटक गए तो**
1. "Refresh" दबाएँ (रिपोर्ट हर 3 मिनट में खुद भी ताज़ा होती है)।
2. अवधि खाली हो तो 90D या FY चुनें, और Plant व Shift को फिर "All" करें।
3. पीला चेतावनी बॉक्स पढ़ें; उसमें कमी वाले डेटा का नाम होता है।

जुड़े पेज: /analytics/reports, /sales/orders, /logistics/dispatch

**अभी नहीं होता / ध्यान दें**
- On-time आँकड़ा अनुमान है, OTIF नहीं: delivered मात्रा या POD नहीं जाँचता, और short-closed order जो COMPLETED नहीं हैं वे खुले गिने जाते हैं।

### Scrap & Yield (scrap और yield) (/analytics/reports/scrap)
स्क्रीन का पता: /analytics/reports/scrap · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, WORK_CENTER_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=analytics-reports-scrap&lang=hi

Production scrap, scrap rate, yield और scrap की लागत, कारण, process, मशीन, operator और job के हिसाब से।

सबसे बड़ी बर्बादी और उसकी लागत ढूँढने के लिए खोलें। केवल मशीन पर दर्ज scrap; store write-off Scrap Center में है।

**शुरू करने से पहले**
- Operator work-center terminal पर output, scrap (कारण सहित) और pause/downtime दर्ज करें।
- Scrap की लागत के लिए material cost snapshot हों।

**स्टेप बाय स्टेप**
1. अवधि चुनें (7D, 30D, 90D, MTD, FY या Custom) और ज़रूरत हो तो Plant और Shift।
2. ऊपर के chips (अवधि, "Updated", डेटा कवरेज) और कोई पीली चेतावनी देखें।
3. "Scrap", "Scrap rate", "Yield", "Cost of scrap", "Scrap events", "Avg per event", "Top reason", "Worst machine" पढ़ें।
4. "Trend" (माप चुनें) और "Insights" से दिशा देखें।
5. ब्योरे के panel और detail table पढ़ें; "Filter rows" और column header पर क्लिक करके sort करें।
6. Planner खोलने के लिए "Review production exceptions"।
7. "CSV" (पंक्तियाँ) या "PDF" (पूरी रिपोर्ट) से डाउनलोड करें; "All reports" से Reports Hub पर लौटें।

**स्क्रीन पर क्या है**
- **स्क्रीन पर: "Scrap rate / Yield"**: Scrap ÷ (अच्छा + scrap) और अच्छा ÷ (अच्छा + scrap)। Target 5% scrap, 95% yield।
- **स्क्रीन पर: "Cost of scrap"**: Scrap KG × सभी material cost snapshot की औसत दर। दर न हो तो खाली।
- **स्क्रीन पर: "Avg per event"**: Scrap KG ÷ scrap log की संख्या।
- **स्क्रीन पर: "Sections"**: "Scrap by reason" (Pareto), "Scrap by process" yield के साथ, "Scrap by machine", "Scrap by operator", "Jobs with the most scrap"; table "Scrap events"।
- **स्क्रीन पर: "Period (7D / 30D / 90D / MTD / FY / Custom)"**: तारीख की अवधि। Default 30D। MTD = इस महीने अब तक; FY = 1 अप्रैल से। "Custom" में "From date" और "To date" आते हैं। Filter पेज के पते में रहते हैं, link भेजा जा सकता है।
- **स्क्रीन पर: "Plant / Process / Shift"**: रिपोर्ट को एक plant या shift तक सीमित करें। Process filter हर रिपोर्ट पर दिखता है पर अभी server उसे लागू नहीं करता।
- **स्क्रीन पर: "Machine logs / Material actuals / Shift tags"**: डेटा कवरेज chips: अवधि में बने job में से कितने % पर output log है; कितने % पर material issue/खपत/वापसी है; कितने % output log पर shift code है। 80%+ हरा, 30%+ पीला, कम तो लाल; रिपोर्ट में काम न आए तो N/A।
- **स्क्रीन पर: "KPI tiles (On target / Below target)"**: अधिकतम 8 tiles। जहाँ target है वहाँ tile उसके हिसाब से अच्छा या खराब रंग लेती है।
- **स्क्रीन पर: "Trend / Insights"**: चुने माप का रोज़ का chart (खाली दिन शून्य) और उसी डेटा से छोटे निष्कर्ष।
- **स्क्रीन पर: "Detail table"**: Sort होने वाली पंक्तियाँ, "Filter rows" खोज, हर पेज 25 पंक्ति, "CSV" से filter की हुई पंक्तियाँ डाउनलोड।

**आम दिक्कतें और हल**
- "संदेश: "No scrap events were logged for the selected filter window."" — अवधि में scrap log नहीं। तारीख बढ़ाएँ या देखें operator scrap दर्ज करते हैं।
- "संदेश: "This report could not be loaded. Try refreshing."" — Server request फेल हुआ या आपके role को यह रिपोर्ट नहीं मिली। "Refresh" दबाएँ; बार-बार हो तो admin से अनुमति माँगें।
- "संदेश: "No figures for this period"" — Filter के हिसाब से कुछ दर्ज नहीं। अवधि बढ़ाएँ या filter हटाएँ।
- "संदेश: "No telemetry in selected period."" — अवधि के किसी job पर machine output log नहीं। Work center से terminal पर output दर्ज करवाएँ।
- "संदेश: "No shift tags captured in selected telemetry. / No shift schedule configured."" — Output log पर shift code नहीं, या plant में कोई चालू shift नहीं। Factory setting में shift बनाएँ।

**अटक गए तो**
1. "Refresh" दबाएँ (रिपोर्ट हर 3 मिनट में खुद भी ताज़ा होती है)।
2. अवधि खाली हो तो 90D या FY चुनें, और Plant व Shift को फिर "All" करें।
3. पीला चेतावनी बॉक्स पढ़ें; उसमें कमी वाले डेटा का नाम होता है।

जुड़े पेज: /analytics/reports, /analytics/scrap, /production/planner

**अभी नहीं होता / ध्यान दें**
- Scrap की लागत सभी material snapshot की एक औसत दर से है, scrap हुए material की दर से नहीं।

### Shift Performance (shift प्रदर्शन) (/analytics/reports/shift-performance)
स्क्रीन का पता: /analytics/reports/shift-performance · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, WORK_CENTER_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=analytics-reports-shift-performance&lang=hi

Shift-वार output, scrap और downtime की तुलना।

दिन और रात की shift की तुलना कर कमज़ोर shift पहचानने के लिए खोलें।

**शुरू करने से पहले**
- Operator work-center terminal पर output, scrap (कारण सहित) और pause/downtime दर्ज करें।
- Plant में shift बनी हों ताकि log पर shift code आए।

**स्टेप बाय स्टेप**
1. अवधि चुनें (7D, 30D, 90D, MTD, FY या Custom) और ज़रूरत हो तो Plant और Shift।
2. ऊपर के chips (अवधि, "Updated", डेटा कवरेज) और कोई पीली चेतावनी देखें।
3. "Output", "Scrap", "Downtime", "Shifts" और "Shift comparison" panel पढ़ें।
4. "Trend" (माप चुनें) और "Insights" से दिशा देखें।
5. ब्योरे के panel और detail table पढ़ें; "Filter rows" और column header पर क्लिक करके sort करें।
6. "CSV" (पंक्तियाँ) या "PDF" (पूरी रिपोर्ट) से डाउनलोड करें; "All reports" से Reports Hub पर लौटें।

**स्क्रीन पर क्या है**
- **स्क्रीन पर: "Output / Scrap"**: हर shift code का दर्ज मात्रा; बिना shift के log UNASSIGNED में।
- **स्क्रीन पर: "Downtime"**: हर shift का downtime मिनट।
- **स्क्रीन पर: "Shift comparison"**: हर shift का output, yield (output ÷ output + scrap) और downtime के साथ।
- **स्क्रीन पर: "Period (7D / 30D / 90D / MTD / FY / Custom)"**: तारीख की अवधि। Default 30D। MTD = इस महीने अब तक; FY = 1 अप्रैल से। "Custom" में "From date" और "To date" आते हैं। Filter पेज के पते में रहते हैं, link भेजा जा सकता है।
- **स्क्रीन पर: "Plant / Process / Shift"**: रिपोर्ट को एक plant या shift तक सीमित करें। Process filter हर रिपोर्ट पर दिखता है पर अभी server उसे लागू नहीं करता।
- **स्क्रीन पर: "Machine logs / Material actuals / Shift tags"**: डेटा कवरेज chips: अवधि में बने job में से कितने % पर output log है; कितने % पर material issue/खपत/वापसी है; कितने % output log पर shift code है। 80%+ हरा, 30%+ पीला, कम तो लाल; रिपोर्ट में काम न आए तो N/A।
- **स्क्रीन पर: "KPI tiles (On target / Below target)"**: अधिकतम 8 tiles। जहाँ target है वहाँ tile उसके हिसाब से अच्छा या खराब रंग लेती है।
- **स्क्रीन पर: "Trend / Insights"**: चुने माप का रोज़ का chart (खाली दिन शून्य) और उसी डेटा से छोटे निष्कर्ष।
- **स्क्रीन पर: "Detail table"**: Sort होने वाली पंक्तियाँ, "Filter rows" खोज, हर पेज 25 पंक्ति, "CSV" से filter की हुई पंक्तियाँ डाउनलोड।

**आम दिक्कतें और हल**
- "संदेश: "This report could not be loaded. Try refreshing."" — Server request फेल हुआ या आपके role को यह रिपोर्ट नहीं मिली। "Refresh" दबाएँ; बार-बार हो तो admin से अनुमति माँगें।
- "संदेश: "No figures for this period"" — Filter के हिसाब से कुछ दर्ज नहीं। अवधि बढ़ाएँ या filter हटाएँ।
- "संदेश: "No telemetry in selected period."" — अवधि के किसी job पर machine output log नहीं। Work center से terminal पर output दर्ज करवाएँ।
- "संदेश: "No shift tags captured in selected telemetry. / No shift schedule configured."" — Output log पर shift code नहीं, या plant में कोई चालू shift नहीं। Factory setting में shift बनाएँ।

**अटक गए तो**
1. "Refresh" दबाएँ (रिपोर्ट हर 3 मिनट में खुद भी ताज़ा होती है)।
2. अवधि खाली हो तो 90D या FY चुनें, और Plant व Shift को फिर "All" करें।
3. पीला चेतावनी बॉक्स पढ़ें; उसमें कमी वाले डेटा का नाम होता है।

जुड़े पेज: /analytics/reports, /analytics/reports/production

**अभी नहीं होता / ध्यान दें**
- Shift output और scrap में दर्ज मात्रा सीधे जुड़ती है, pieces को KG में नहीं बदला जाता।

### Trading Pulse (trading रिपोर्ट) (/analytics/reports/trading)
स्क्रीन का पता: /analytics/reports/trading · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, SALES, PLANT_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=analytics-reports-trading&lang=hi

Trading माल और बिकने वाले material की रिपोर्ट: stock की कीमत, खुले trade order, कमाई, gross margin, top item और customer, धीमे बिकने वाले माल और plant-वार stock।

Trading कारोबार को manufacturing से अलग देखने के लिए खोलें।

**शुरू करने से पहले**
- Trading goods और sellable material बने हों; trade order dispatch/invoice हों।

**स्टेप बाय स्टेप**
1. "daily" (आज), "weekly" (7 दिन), "monthly" (30 दिन, default) या "custom" (From/to तारीख) चुनें।
2. Plant या "All Plants" चुनें।
3. "Trading Stock Value", "Open Trade Orders", "Revenue", "Gross Margin %" पढ़ें।
4. "Trade Revenue Trend", "Status mix", "By item type", "Top items", "Top customers" देखें।
5. "Slow movers — held stock with no dispatch in 60 days" पर काम करें और "Stock by plant" देखें।
6. सहेजने के लिए "Export PDF", दोबारा लाने के लिए "Refresh"।

**स्क्रीन पर क्या है**
- **स्क्रीन पर: "Trading Stock Value"**: Trading goods stock × औसत cost + बिकने वाले material का stock (bulk, packaging, roll) × औसत cost।
- **स्क्रीन पर: "Open Trade Orders"**: DRAFT या CONFIRMED वाले trade order।
- **स्क्रीन पर: "Revenue"**: अवधि में DISPATCHED या INVOICED trade order का कुल, उतनी ही पिछली अवधि से % बदलाव।
- **स्क्रीन पर: "Gross Margin %"**: (GST से पहले कमाई − माल की लागत) ÷ GST से पहले कमाई × 100; लागत = मात्रा × अभी की औसत cost।
- **स्क्रीन पर: "Slow movers"**: जिन trading goods का stock है पर पिछले 60 दिन में dispatch नहीं।

**आम दिक्कतें और हल**
- "रिपोर्ट की अनुमति नहीं" — Trading रिपोर्ट के लिए sales देखने की अनुमति चाहिए।

**अटक गए तो**
1. Daily खाली हो तो "monthly" चुनें।
2. Margin गलत लगे तो trading stock की औसत cost जाँचें।

जुड़े पेज: /analytics/reports, /analytics/kpis, /sales/orders

**अभी नहीं होता / ध्यान दें**
- Margin आज की औसत cost से निकलता है, बिक्री के समय की cost से नहीं, इसलिए cost बदलने पर पुराना margin भी बदल जाता है।

### Scrap Center (scrap केंद्र) (/analytics/scrap)
स्क्रीन का पता: /analytics/scrap · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=analytics-scrap&lang=hi

मशीनों पर दर्ज production scrap और stock adjustment से लिखा गया scrap, process, मशीन और कारण के ब्योरे के साथ।

Store के write-off समेत कुल बर्बादी देखने के लिए खोलें; Scrap & Yield रिपोर्ट में यह शामिल नहीं होता।

**शुरू करने से पहले**
- Work-center terminal पर कारण के साथ scrap दर्ज हो; adjustment Inventory में दर्ज हों।

**स्टेप बाय स्टेप**
1. "Plant" चुनें (या "All plants")।
2. "Date From" और "Date To" भरें। दोनों खाली रखें तो पूरा इतिहास दिखेगा।
3. छह कार्ड पढ़ें: "Production Scrap", "Adjustment Scrap", "Total Scrap", "Output", "Consumed", "Scrap Rate"।
4. "By Process", "By Machine" और "By Reason" देखें।
5. "Recent Scrap Events" देखें; दोबारा लाने के लिए "Refresh" दबाएँ।

**स्क्रीन पर क्या है**
- **स्क्रीन पर: "Production Scrap"**: अवधि में job पर दर्ज scrap का जोड़।
- **स्क्रीन पर: "Adjustment Scrap"**: Bulk के ऋणात्मक adjustment और बिना job के scrap में गए roll (पूरे roll का वज़न)।
- **स्क्रीन पर: "Total Scrap"**: Production scrap + adjustment scrap।
- **स्क्रीन पर: "Output"**: मशीनों पर दर्ज अच्छा output।
- **स्क्रीन पर: "Consumed"**: Job पर दर्ज material खपत।
- **स्क्रीन पर: "Scrap Rate"**: कुल scrap ÷ (output + कुल scrap) × 100।

**आम दिक्कतें और हल**
- "संदेश: "No scrap rows in this period"" — Plant और तारीख में कुछ दर्ज नहीं। तारीख बढ़ाएँ।

**अटक गए तो**
1. डेटा है या नहीं देखने के लिए तारीख हटाएँ और "All plants" चुनें।

जुड़े पेज: /analytics/reports/scrap, /inventory/adjustments, /analytics/reports/production

**अभी नहीं होता / ध्यान दें**
- यहाँ output और scrap बिना unit बदले जोड़े जाते हैं, इसलिए scrap rate, Scrap & Yield रिपोर्ट (जो pieces को KG में बदलती है) से अलग हो सकता है।
- Roll adjustment scrap में अवधि के अधिकतम 500 roll movement ही गिने जाते हैं।
