# Dashboards, planner control tower and work-center terminal

## Overview (English)
# Dashboards

Every role lands on its own dashboard after login. A dashboard shows live numbers and links; the real work is done on the pages it links to. If a data feed fails, a dashboard shows "—", "Unavailable" or a "paused" message instead of zeros, so a zero on screen is always a real zero.

## Which dashboard opens for whom
- **Admin / Super Admin** → System Admin Console (`/dashboard/admin`).
- **Owner** → Owner dashboard (`/dashboard/owner`).
- **Sales** → Sales Command Center (`/dashboard/sales`).
- **Planner** → Planner Command Center (`/dashboard/planner`).
- **Work Center Manager** → WC terminal (`/production/work-center`); the Command Deck is `/dashboard/work-center`.
- **Operator** → Machine terminal (`/production/machine-selector`). `/dashboard/operator` is an old address that redirects there.
- **Store** → Rolls; the Inventory Control Hub is `/dashboard/inventory`.
- **Dispatch** → Total Logistics Hub (`/dashboard/logistics`).
- **Plant Manager** → KPIs. **Watchman** → Gate terminal.
- `/dashboard` itself has no screen; it sends you to `/`, which opens your role's page.

## The screens
**Owner dashboard.** Money, output, stock and risk for a chosen timeframe (day, week, month, year): booked order value, gross margin, production output, overdue orders, inventory, scrap, machine utilisation and actual-cost coverage. Panels: Profit & loss, Six-month financials, Order book health (Draft, Needs planning, Packing ready, Dispatch ready), Top customers, SKU Performance, Stock position, Job status, Material discipline, Ink control, POD Intelligence, Route Reuse Pools, Procurement, Trading, Live floor activity, Shift output & quality, and Alerts & risk signals. Each links to its report.

**System Admin Console.** Active users, error rate, database latency and size, CPU / memory / disk, department sign-off (approved vs pending, with "Open Governance Console"), maintenance ("Clear application cache", "Vacuum…" then "Run vacuum now") and the system event stream.

**Sales Command Center.** Order value (30 days), open pipeline, On time in full, overdue orders, Orders today, Drafts to confirm, Ready to ship, Quote conversion, the 30-day intake chart (Weight / Orders), Needs attention, Order pipeline, Top customers, Products by value, Recent orders and Most overdue. "Create order" starts a new order.

**Inventory Control Hub.** Bulk stock, rolls on hand, finished goods, open alerts, available vs reserved rolls, aged stock (90d+), stock value, stock aging, by stage, by location, by plant, largest families and the Critical action centre. Links: "Create GRN", "Health diagnostics", "All alerts".

**Total Logistics Hub.** Pending Challans (drafts), Dispatch Ready (orders with FG), Vehicles Loading/Transit, Shipped Today, Challan Flow Distribution and the latest slips. "Open Dispatch Bay" leads to the working page.

**Engineering Hub.** Pending Artworks (draft / approval), Cylinder Attention (maintenance / re-chrome), Templates To Finish (not live), Live Templates with active routes, an Approvals Queue with "Review", and Catalog Health (cylinder-ready artworks, templates with a route).

**Work Center Command Deck.** For the WC manager: active work centers, executing and blocked jobs, machines running, released jobs with no machine, output, scrap rate and runtime coverage; risk donuts; escalations with filters; a board per work center with "Open terminal"; machine readiness; execution discipline (downtime, ink remix, cost coverage, unmapped cost); recent floor activity; and a Shift Handoff checklist. It refreshes every 60 seconds.

## How the dashboards connect to the plant flow
1. Sales books an order (Sales dashboard → Create order) and confirms it. Drafts never reach the planner.
2. The planner sees it on the Planner dashboard and works it in the Control Tower.
3. Engineering approves artworks and makes templates LIVE (Engineering Hub shows what is pending).
4. The WC manager runs released jobs (Command Deck → WC terminal), operators log output on the Machine terminal.
5. Packing Yard releases goods; Dispatch prints one slip per order line (Logistics Hub → Dispatch Bay).
6. The owner watches money, output and risk on the Owner dashboard.

## Rules and limits
- Dashboards are read-only except the admin maintenance buttons.
- Numbers come from live feeds; most refresh on open or with "Refresh". The WC deck refreshes every 60 s.
- A role sees only the menu entries it may use; the server refuses data a role may not read.

## Problems and fixes
- **Tiles show "—" or "Unavailable".** The feed failed. Press "Retry" / "Refresh". Other screens keep working.
- **"System health did not respond."** Retry; the rest of the ERP is unaffected.
- **Reports show old numbers.** Admin presses "Clear application cache".
- **Wrong dashboard opens.** You are on another role; switch role from the profile menu.
- **Owner panel empty.** Change the timeframe; "day" is often empty early in the shift.
- **Sales dashboard missing from the Sales sidebar.** It is the Sales landing page; open it from the Orders workspace tab "Sales dashboard".

## सारांश (हिंदी)
# Dashboards (डैशबोर्ड)

login के बाद हर role अपने dashboard पर पहुँचता है। dashboard live आँकड़े और link दिखाता है; असली काम उन पेजों पर होता है जहाँ link ले जाते हैं। डेटा feed fail हो तो dashboard शून्य की जगह "—", "Unavailable" या "paused" संदेश दिखाता है, इसलिए स्क्रीन पर शून्य हमेशा असली शून्य होता है।

## किसके लिए कौन-सा dashboard
- **Admin / Super Admin** → System Admin Console (`/dashboard/admin`)।
- **Owner** → Owner dashboard (`/dashboard/owner`)।
- **Sales** → Sales Command Center (`/dashboard/sales`)।
- **Planner** → Planner Command Center (`/dashboard/planner`)।
- **Work Center Manager** → WC terminal (`/production/work-center`); Command Deck `/dashboard/work-center` पर है।
- **Operator** → Machine terminal (`/production/machine-selector`)। `/dashboard/operator` पुराना पता है, वहीं भेज देता है।
- **Store** → Rolls; Inventory Control Hub `/dashboard/inventory` पर है।
- **Dispatch** → Total Logistics Hub (`/dashboard/logistics`)।
- **Plant Manager** → KPIs। **Watchman** → Gate terminal।
- `/dashboard` की अपनी स्क्रीन नहीं; यह `/` पर भेजता है, जहाँ आपके role का पेज खुलता है।

## स्क्रीनें
**Owner dashboard।** चुने समय (day, week, month, year) का पैसा, उत्पादन, stock और जोखिम: booked order value, gross margin, production output, overdue orders, inventory, scrap, machine utilisation और actual-cost coverage। पैनल: Profit & loss, Six-month financials, Order book health (Draft, Needs planning, Packing ready, Dispatch ready), Top customers, SKU Performance, Stock position, Job status, Material discipline, Ink control, POD Intelligence, Route Reuse Pools, Procurement, Trading, Live floor activity, Shift output & quality और Alerts & risk signals। हर पैनल अपनी report से जुड़ा है।

**System Admin Console।** Active users, error rate, database latency और size, CPU / memory / disk, department sign-off (approved बनाम pending, "Open Governance Console" के साथ), maintenance ("Clear application cache", "Vacuum…" फिर "Run vacuum now") और system event stream।

**Sales Command Center।** 30 दिन का order value, open pipeline, On time in full, overdue orders, Orders today, Drafts to confirm, Ready to ship, Quote conversion, 30 दिन का intake chart (Weight / Orders), Needs attention, Order pipeline, Top customers, Products by value, Recent orders और Most overdue। "Create order" से नया order शुरू होता है।

**Inventory Control Hub।** Bulk stock, rolls on hand, finished goods, open alerts, available बनाम reserved roll, 90 दिन से पुराना stock, stock value, stock aging, stage, location और plant के हिसाब से stock, सबसे बड़ी family और Critical action centre। link: "Create GRN", "Health diagnostics", "All alerts"।

**Total Logistics Hub।** Pending Challans (draft), Dispatch Ready (FG वाले order), Vehicles Loading/Transit, Shipped Today, Challan Flow Distribution और ताज़ा slip। "Open Dispatch Bay" काम वाले पेज पर ले जाता है।

**Engineering Hub।** Pending Artworks (draft / approval), Cylinder Attention (maintenance / re-chrome), Templates To Finish (live नहीं), active route वाले Live Templates, "Review" के साथ Approvals Queue, और Catalog Health (cylinder-ready artwork, route वाले template)।

**Work Center Command Deck।** WC manager के लिए: active work center, चल रहे और रुके job, चलती machine, बिना machine वाले released job, output, scrap rate और runtime coverage; जोखिम के donut chart; filter वाले escalation; हर work center का board, "Open terminal" के साथ; machine readiness; execution discipline (downtime, ink remix, cost coverage, unmapped cost); हाल की floor गतिविधि; और Shift Handoff checklist। हर 60 सेकंड में ताज़ा होता है।

## dashboard और plant का काम कैसे जुड़ते हैं
1. Sales order बुक करता है (Sales dashboard → Create order) और confirm करता है। draft planner तक नहीं पहुँचते।
2. Planner इसे Planner dashboard पर देखता है और Control Tower में काम करता है।
3. Engineering artwork approve करता है और template LIVE करता है (Engineering Hub में बाकी काम दिखता है)।
4. WC manager release हुए job चलाता है (Command Deck → WC terminal), operator Machine terminal पर output दर्ज करते हैं।
5. Packing Yard माल release करता है; Dispatch हर order line की एक slip छापता है (Logistics Hub → Dispatch Bay)।
6. Owner पैसा, उत्पादन और जोखिम Owner dashboard पर देखता है।

## नियम और सीमाएँ
- admin के maintenance बटन छोड़कर dashboard सिर्फ़ देखने के लिए हैं।
- आँकड़े live feed से आते हैं; ज़्यादातर पेज खुलने पर या "Refresh" से ताज़ा होते हैं। WC deck हर 60 s ताज़ा होता है।
- हर role को सिर्फ़ अपने काम के menu दिखते हैं; जो डेटा role नहीं पढ़ सकता, server मना कर देता है।

## समस्याएँ और हल
- **tile में "—" या "Unavailable"।** feed fail हुई। "Retry" / "Refresh" दबाएँ। बाकी स्क्रीन चलती रहती हैं।
- **"System health did not respond."** फिर कोशिश करें; बाकी ERP पर असर नहीं।
- **report पुराने आँकड़े दिखाए।** admin "Clear application cache" दबाए।
- **गलत dashboard खुला।** आप दूसरे role पर हैं; profile menu से role बदलें।
- **Owner पैनल खाली।** timeframe बदलें; shift की शुरुआत में "day" अक्सर खाली होता है।
- **Sales sidebar में Sales dashboard नहीं।** यह Sales का पहला पेज है; Orders workspace के tab "Sales dashboard" से खोलें।

## Every screen (English)

### Redirecting to your dashboard (/)
Screen address: / · Roles: ADMIN, OWNER, SUPER_ADMIN, SALES, PLANNER, WORK_CENTER_MANAGER, OPERATOR, STORE, DISPATCH, PLANT_MANAGER, WATCHMAN · Share link: https://erp.totalpolyprint.com/guide?page=home

The site address itself. It shows a spinner and sends you to your role's home page, or to /login if you are not signed in.

Homes by role: Admin/Super Admin → /dashboard/admin, Owner → /dashboard/owner, Sales → /dashboard/sales, Planner → /dashboard/planner, Work center manager → /production/work-center, Operator → /production/machine-selector, Store → /inventory/rolls, Dispatch → /dashboard/logistics, Plant manager → /analytics/kpis, Watchman → /gate.

**Before you start**
- None.

**Step by step**
1. Open the ERP address; wait for "Redirecting to your dashboard...".
2. Sign in if asked; you then land on your role's home.

**Common problems and fixes**
- "Stuck on "Redirecting to your dashboard..."" — The session is still loading or the network is slow. Reload; if it stays, sign in again on /login.

**If stuck**
1. An unknown role lands on the admin dashboard; ask the admin to set your role.

Related pages: /login, /gate, /dashboard/logistics

### Dashboard (redirect) (/dashboard)
Screen address: /dashboard · Roles: ADMIN, OWNER, SUPER_ADMIN, SALES, PLANNER, WORK_CENTER_MANAGER, OPERATOR, STORE, DISPATCH, PLANT_MANAGER, WATCHMAN · Share link: https://erp.totalpolyprint.com/guide?page=dashboard

This address has no screen of its own. It sends you to the home page "/", which opens the right dashboard for your role.

Old links and bookmarks to /dashboard still work. Each role has its own landing page: Admin and Super Admin go to System Admin Console, Owner to the Owner dashboard, Sales to the Sales dashboard, Planner to the Planner dashboard, Work Center Manager to the WC terminal, Operator to the Machine terminal, Store to Rolls, Dispatch to the Logistics hub, Plant Manager to KPIs and Watchman to the Gate terminal.

**Before you start**
- You must be signed in.

**Step by step**
1. Open /dashboard or an old bookmark.
2. The app sends you to "/" at once.
3. From there your role's home page opens. Use the workspace bar at the top to move to other screens.

**What is on the screen**
- **Landing page**: Decided by your current role. If you hold more than one role, switch role from your profile menu to land on another dashboard.

**Common problems and fixes**
- "You land on a page you did not expect" — The redirect follows your current role. Check the role shown in the top bar and switch it if needed.

**If stuck**
1. Update bookmarks to your role's real page so you skip the redirect.

Related pages: /, /dashboard/owner, /dashboard/admin, /dashboard/sales, /dashboard/planner

### Owner dashboard (/dashboard/owner)
Screen address: /dashboard/owner · Roles: OWNER, SUPER_ADMIN, ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=dashboard-owner

Money, output, stock and risk across every plant, live from sales, production, inventory and costing.

Owner's landing page. Open it to see how the business is doing for a chosen period (Day, Week, Month, Year) and where to look next. Each panel links to its full report: Costing centre, Dispatch Bay, Inventory, Purchase orders, Trading report, Live production and the Reports Hub.

**Before you start**
- Orders, machine logs and costing entered in the ERP.

**Step by step**
1. Pick the period with the Timeframe buttons: day, week, month or year.
2. Read the headline tiles: "Booked order value", "Gross margin", "Production output", "Overdue orders", "Inventory on hand", "Scrap", "Machine utilisation" and "Actual-cost coverage".
3. Check "Profit & loss" (revenue, material, conversion, overhead, gross and net profit) and "Six-month financials". Press "Costing centre" for detail.
4. Check "Order book health" (Draft, Needs planning, Packing ready, Dispatch ready), "Top customers" and "SKU Performance".
5. Check "Stock position", "Job status", "Material discipline" and "Ink control".
6. Read "Alerts & risk signals" last; "All clear" means nothing needs you.
7. Press "Refresh" for fresh numbers or "Full report" for the Reports Hub.

**What is on the screen**
- **Booked order value**: Value of orders booked in the period.
- **Gross margin**: Revenue minus cost of goods, as a share.
- **Actual-cost coverage**: How much of output is costed from actual postings rather than estimates.
- **Material discipline**: Issued vs theoretical material: issue discipline, return efficiency and variance.
- **Ink control**: Ink consumed, returned and remix ratio.
- **POD Intelligence**: Print-on-demand programme: active SKUs, variants, bulk orders and bulk target.
- **Route Reuse Pools**: Roll stock available for reuse: final roll, invariant and upstream pools.
- **Procurement / Trading**: Open and overdue POs, spend this month; trading revenue and tradeable stock value.
- **Live floor activity / Shift output & quality**: Jobs running now and output per shift.

**Common problems and fixes**
- "Data unavailable" — The owner dashboard feed failed. Press "Refresh".
- "Waiting for material postings / Waiting for ink postings" — No issues or returns posted in the period yet.
- "No costed revenue in the last six months" — Costing has not been posted for dispatched orders.

**If stuck**
1. Switch the timeframe if a panel is empty; "day" is often empty early in the morning.

Related pages: /analytics/costing, /analytics/reports, /logistics/dispatch, /inventory, /procurement/purchase-orders, /analytics/reports/trading, /dashboard/planner/control-tower/live-production, /sales/orders

**Not done yet / watch out**
- Profit panels stay empty until costing is posted for dispatched orders.

## हर स्क्रीन (हिंदी)

### Redirecting to your dashboard (आपके डैशबोर्ड पर भेज रहे हैं) (/)
स्क्रीन का पता: / · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, SALES, PLANNER, WORK_CENTER_MANAGER, OPERATOR, STORE, DISPATCH, PLANT_MANAGER, WATCHMAN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=home&lang=hi

साइट का मुख्य पता। स्पिनर दिखाकर आपको आपके रोल के होम पेज पर, या लॉगिन न हो तो /login पर भेजता है।

रोल के अनुसार होम: Admin/Super Admin → /dashboard/admin, Owner → /dashboard/owner, Sales → /dashboard/sales, Planner → /dashboard/planner, Work center manager → /production/work-center, Operator → /production/machine-selector, Store → /inventory/rolls, Dispatch → /dashboard/logistics, Plant manager → /analytics/kpis, Watchman → /gate।

**शुरू करने से पहले**
- कुछ नहीं।

**स्टेप बाय स्टेप**
1. ERP का पता खोलें; "Redirecting to your dashboard..." का इंतज़ार करें।
2. माँगे तो लॉगिन करें; फिर अपने रोल के होम पर पहुँचेंगे।

**आम दिक्कतें और हल**
- ""Redirecting to your dashboard..." पर अटका" — सेशन लोड हो रहा है या नेटवर्क धीमा है। रीलोड करें; फिर भी रहे तो /login पर दोबारा लॉगिन करें।

**अटक गए तो**
1. अनजान रोल एडमिन डैशबोर्ड पर पहुँचता है; एडमिन से अपना रोल सेट करवाएँ।

जुड़े पेज: /login, /gate, /dashboard/logistics

### Dashboard (रीडायरेक्ट) (/dashboard)
स्क्रीन का पता: /dashboard · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, SALES, PLANNER, WORK_CENTER_MANAGER, OPERATOR, STORE, DISPATCH, PLANT_MANAGER, WATCHMAN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=dashboard&lang=hi

इस पते की अपनी कोई स्क्रीन नहीं है। यह आपको होम पेज "/" पर भेजता है, जहाँ आपके role का dashboard खुलता है।

/dashboard के पुराने link और bookmark अब भी चलते हैं। हर role का अपना पहला पेज है: Admin और Super Admin को System Admin Console, Owner को Owner dashboard, Sales को Sales dashboard, Planner को Planner dashboard, Work Center Manager को WC terminal, Operator को Machine terminal, Store को Rolls, Dispatch को Logistics hub, Plant Manager को KPIs और Watchman को Gate terminal मिलता है।

**शुरू करने से पहले**
- आपका login होना चाहिए।

**स्टेप बाय स्टेप**
1. /dashboard या पुराना bookmark खोलें।
2. ऐप तुरंत "/" पर भेज देता है।
3. वहाँ से आपके role का home page खुलता है। दूसरी स्क्रीन के लिए ऊपर की workspace bar इस्तेमाल करें।

**स्क्रीन पर क्या है**
- **पहला पेज (Landing page)**: आपके चालू role से तय होता है। एक से ज़्यादा role हों तो profile menu से role बदलें, दूसरा dashboard खुलेगा।

**आम दिक्कतें और हल**
- "उम्मीद से अलग पेज खुल गया" — रीडायरेक्ट आपके चालू role के हिसाब से होता है। ऊपर bar में role देखें और ज़रूरत हो तो बदलें।

**अटक गए तो**
1. bookmark को अपने role के असली पेज पर बदल लें, ताकि रीडायरेक्ट न हो।

जुड़े पेज: /, /dashboard/owner, /dashboard/admin, /dashboard/sales, /dashboard/planner

### Owner dashboard (/dashboard/owner)
स्क्रीन का पता: /dashboard/owner · भूमिकाएँ: OWNER, SUPER_ADMIN, ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=dashboard-owner&lang=hi

हर plant का पैसा, उत्पादन, stock और जोखिम, sales, production, inventory और costing से live।

Owner का पहला पेज। चुने हुए समय (Day, Week, Month, Year) में कारोबार कैसा चल रहा है और आगे कहाँ देखना है, यह जानने के लिए खोलें। हर पैनल अपनी पूरी report पर ले जाता है: Costing centre, Dispatch Bay, Inventory, Purchase orders, Trading report, Live production और Reports Hub।

**शुरू करने से पहले**
- ERP में order, machine log और costing दर्ज हों।

**स्टेप बाय स्टेप**
1. Timeframe बटन से समय चुनें: day, week, month या year।
2. मुख्य tile पढ़ें: "Booked order value", "Gross margin", "Production output", "Overdue orders", "Inventory on hand", "Scrap", "Machine utilisation" और "Actual-cost coverage"।
3. "Profit & loss" (revenue, material, conversion, overhead, gross और net profit) और "Six-month financials" देखें। विस्तार के लिए "Costing centre" दबाएँ।
4. "Order book health" (Draft, Needs planning, Packing ready, Dispatch ready), "Top customers" और "SKU Performance" देखें।
5. "Stock position", "Job status", "Material discipline" और "Ink control" देखें।
6. आख़िर में "Alerts & risk signals" पढ़ें; "All clear" का मतलब आपकी ज़रूरत नहीं।
7. ताज़ा आँकड़ों के लिए "Refresh" या Reports Hub के लिए "Full report" दबाएँ।

**स्क्रीन पर क्या है**
- **Booked order value**: समय में बुक हुए order की कीमत।
- **Gross margin**: revenue में से माल की लागत घटाकर, प्रतिशत में।
- **Actual-cost coverage**: कितना output असली posting से costed है, अंदाज़े से नहीं।
- **Material discipline**: जारी बनाम सैद्धांतिक material: issue discipline, return efficiency और variance।
- **Ink control**: ink खपत, वापसी और remix ratio।
- **POD Intelligence**: Print-on-demand: active SKU, variant, bulk order और bulk target।
- **Route Reuse Pools**: दोबारा इस्तेमाल के लिए roll stock: final roll, invariant और upstream pool।
- **Procurement / Trading**: खुले और देर वाले PO, इस महीने का खर्च; trading revenue और बिकने लायक stock की कीमत।
- **Live floor activity / Shift output & quality**: अभी चल रहे job और हर shift का output।

**आम दिक्कतें और हल**
- "Data unavailable" — owner dashboard feed fail हुई। "Refresh" दबाएँ।
- "Waiting for material postings / Waiting for ink postings" — इस समय में अभी कोई issue या return post नहीं हुआ।
- "No costed revenue in the last six months" — dispatch हुए order की costing post नहीं हुई।

**अटक गए तो**
1. पैनल खाली हो तो timeframe बदलें; सुबह-सुबह "day" अक्सर खाली रहता है।

जुड़े पेज: /analytics/costing, /analytics/reports, /logistics/dispatch, /inventory, /procurement/purchase-orders, /analytics/reports/trading, /dashboard/planner/control-tower/live-production, /sales/orders

**अभी नहीं होता / ध्यान दें**
- dispatch हुए order की costing post होने तक profit पैनल खाली रहते हैं।
