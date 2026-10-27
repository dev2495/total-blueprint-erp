# Roles — start page, sidebar and daily routine

## Overview (English)
# Roles: start page, sidebar workspaces and daily routine

Every account has one base role. The role decides the **start page** after sign-in and which **workspaces** appear at the top of the sidebar. The sidebar shows up to seven workspaces in the order of the order spine – **Products → Orders → Plan → Floor → Stock → Yard & Dispatch → Reports & admin** – and the workspace bar on top of each page shows the tabs of the workspace you are in. A workspace appears only if at least one of its screens is allowed for you, and only allowed tabs are shown. Personal overrides given in User Management add screens on top of the role. Below the workspaces, "All screens" (folded by default) lists every old sidebar entry you may open. The lists below are the defaults with no personal overrides.

## OWNER
- **Start page:** Owner dashboard (/dashboard/owner).
- **Workspaces:** all seven with every tab – Products (masters, routes, artwork, cylinders, tooling, films, granules, recipes, inks, adhesives, packaging, POD…), Orders, Plan, Floor (WC terminal, Machine terminal, Command deck, maintenance…), Stock (incl. Purchase orders, Smart GRN, Adjustments), Yard & Dispatch (incl. Gate terminal, Gate register, Visitors, Gate setup), Reports & admin (Owner dashboard, KPIs, Costing, Reports hub, Report center, Audit, Users, Role matrix, Governance, Company profile, Reorder policy, Reason codes, Settings, Plants, Locations, Work centres, Machines, Shift timing, Help). The owner flag bypasses all permission checks.
- **Daily routine:** read the Owner dashboard and the bell (daily report packs); check KPIs and Costing; approve profile requests in Governance; look at Audit for HIGH/CRITICAL signals; decide on short-closed and closed-line goods; give or remove access in Users / Role matrix.

## ADMIN
- **Start page:** System health (/dashboard/admin).
- **Workspaces:** same seven as Owner, but Reports & admin opens on KPIs and has no Owner dashboard tab.
- **Daily routine:** check System health (disk, services, backups warning); add or change users, reset passwords; keep masters, factory set-up, shift timing and reason codes correct; review Audit; keep the Report Center packs running.

## SUPER_ADMIN
- **Start page:** System health (/dashboard/admin).
- **Workspaces:** same as Owner, including the Owner dashboard. Used for technical support, not daily plant work.

## SALES
- **Start page:** Sales dashboard (/dashboard/sales).
- **Workspaces:** Orders (Orders, New order, Job names, Quotations, Customers, Trade orders, Sales dashboard) and Reports & admin (Trading report, Help). Sales picks products inside the order composer and does not see Product masters.
- **Daily routine:** enter new sales orders and quotations; follow each order's tracker; answer customers on dispatch dates; manage trade orders; check the trading report.

## PLANNER
- **Start page:** Planner dashboard (/dashboard/planner).
- **Workspaces:** Products (Web-width policies, Route dispatch), Plan (Command, Plan queue, Live production, Completed trace, Material readiness, Combine orders, Launch stock, MRP, Ink control, Planner dashboard), Floor (Visual factory, Ink floor, Job work, Jobs), Stock (rolls, bulk, packaging, inks, movements, ledger, genealogy, alerts, history… – no Smart GRN, no Adjustments), Yard & Dispatch (In transit, Goods in & out), Reports & admin (Capability matrix, Help).
- **Daily routine:** work the Plan queue; release lines to the route and claim stock (rolls by width window ±20 mm, lanes decide the run web); combine orders; launch stock jobs; watch Live production; check Material readiness and MRP for shortages; claim free stock moved from closed lines.

## WORK_CENTER_MANAGER
- **Start page:** WC terminal (/production/work-center).
- **Workspaces:** Plan (Plan queue, Live production, Completed trace, Material readiness, Combine orders, Ink control), Floor (WC terminal, Machine terminal, Command deck, Visual factory, Ink floor, Jobs), Stock (rolls, bulk, packaging, inks, conversion, roll movements, inter-plant, count, genealogy, period, inventory health). Only the work centres assigned in User Management are shown.
- **Daily routine:** open the WC terminal at shift start; release jobs to machines; watch the command deck for stuck or late jobs; check operators' output logs and scrap; issue and return material; hand over open jobs to the next shift.

## OPERATOR (Machine Operator)
- **Start page:** Machine terminal (/production/machine-selector).
- **Workspaces:** Floor → Machine terminal only. An operator can also open maintenance screens, My Profile and Help; every other address is blocked. Only the machines ticked in User Management are shown; scanning a machine QR (/m/<code>) opens its terminal.
- **Daily routine:** pick your machine; start the released job; log outputs (rolls/quantity, trim and scrap – a scrap reason is needed when waste reaches the limit in Company Profile); log downtime with a reason; report a fault; finish or hand over the job at shift end.

## STORE
- **Start page:** Rolls (/inventory/rolls).
- **Workspaces:** Floor (Ink floor, Job work), Stock (Rolls, Bulk, Packaging, Inks · adhesives, Smart GRN, Bills & documents, General receipts, Purchase orders, Vendors, conversion, movements, goods in & out, inter-plant, Adjustments, Count at rack, Ledger, genealogy, lifecycle, Alerts, Period, history, reports, Inventory dashboard), Yard & Dispatch (In transit, Goods in & out, Outward documents, Gate passes). Bills & documents rights are Store's by default.
- **Daily routine:** review gate bills that arrived; post GRNs against POs (Receive) or Smart GRN; raise POs for low-stock alerts; issue rolls and material to the floor; do rack counts and adjustments; handle job work and gate passes; check the stock ledger.

## DISPATCH
- **Start page:** Logistics dashboard (/dashboard/logistics).
- **Workspaces:** Stock (Goods in & out, Count at rack, Period) and Yard & Dispatch (Packing yard, Evening count, Packing audit, Dispatch bay, In transit, Goods in & out).
- **Daily routine:** in the Packing yard pack pouches into gonnies (inner pouches are not ticked: in-house ones already came off stock at the machine, bought ones are booked by the evening count), seal and release, tick the other packing items used as marks; release rolls to dispatch; in the Dispatch bay print one slip per sales-order line on the Epson 10×6 slip, mark dispatched and record proof of delivery; ship closed-line goods only after ticking "Send goods of closed lines"; in the evening enter the packing count so gonny, carton, tape, bought inner pouches and other items come off stock.

## PLANT_MANAGER
- **Start page:** KPIs (/analytics/kpis).
- **Workspaces:** Plan (Command, Plan queue, Live production, Completed trace, Material readiness, Combine orders, Launch stock, Ink control, Planner dashboard), Floor (Visual factory, Ink floor, Jobs, Maintenance, Faults, Schedules, Machine QR, Maintenance reports), Stock (opens on Purchase orders; Vendors, movements, goods in & out, Adjustments, count, ledger, lifecycle, alerts, period, history, reports, dashboard), Yard & Dispatch (In transit, Goods in & out), Reports & admin (KPIs, Reports hub, Capability matrix, Trading report, Help).
- **Daily routine:** read KPIs and shift performance; check the Plan queue and Live production for delays; follow machine faults and maintenance; watch stock alerts and open POs; review scrap and downtime reports.

## WATCHMAN
- **Start page:** Gate terminal (/gate), a separate gate screen without the office sidebar. No workspaces; office pages, overrides and the owner flag never apply. Only the plants ticked under "Gate assignment" can be logged.
- **Daily routine:** check the right plant is shown; log visitors in and out (overdue visitors first); log goods and vendor bills at arrival; check outward goods and gate passes against vehicles; check out everyone before shift end.

## Maintenance roles
MAINTENANCE_TECH starts on Maintenance jobs (/maintenance/jobs) and sees Floor → Ink floor, Maintenance, Faults. MAINTENANCE_SUPERVISOR starts on the Maintenance board (/maintenance) and also sees Schedules, Machine QR and Maintenance reports.

## Problems and fixes
- *A screen is missing from my sidebar*: open "All screens"; if it is not there either, your role does not include it – ask an Owner/Admin to add it in Role matrix or as a personal override, then sign in again.
- *I land on the wrong start page*: the base role is wrong; an admin changes it in User Management.
- *An operator or WCM sees no machines*: machines (operator) or work centres (WCM) are not assigned in the user editor.

## सारांश (हिंदी)
# रोल: शुरुआती पेज, sidebar workspace और रोज़ का काम

हर खाते का एक base role होता है। रोल तय करता है कि login के बाद **शुरुआती पेज** कौन-सा होगा और sidebar के ऊपर कौन-से **workspace** दिखेंगे। Sidebar में order spine के क्रम में ज़्यादा से ज़्यादा सात workspace दिखते हैं – **Products → Orders → Plan → Floor → Stock → Yard & Dispatch → Reports & admin** – और हर पेज के ऊपर workspace bar उस workspace के टैब दिखाता है जिसमें आप हैं। Workspace तभी दिखता है जब उसकी कम से कम एक स्क्रीन आपके लिए खुली हो, और सिर्फ़ खुले टैब दिखते हैं। User Management में दिए personal override रोल के ऊपर और स्क्रीन जोड़ते हैं। Workspace के नीचे "All screens" (default में बंद) में वे सभी पुरानी sidebar entries हैं जो आप खोल सकते हैं। नीचे की लिस्ट बिना override वाले default हैं।

## OWNER
- **शुरुआती पेज:** Owner dashboard (/dashboard/owner)।
- **Workspace:** सातों, हर टैब के साथ – Products (master, route, artwork, cylinder, tooling, film, granule, recipe, ink, adhesive, packaging, POD…), Orders, Plan, Floor (WC terminal, Machine terminal, Command deck, maintenance…), Stock (Purchase orders, Smart GRN, Adjustments सहित), Yard & Dispatch (Gate terminal, Gate register, Visitors, Gate setup सहित), Reports & admin (Owner dashboard, KPIs, Costing, Reports hub, Report center, Audit, Users, Role matrix, Governance, Company profile, Reorder policy, Reason codes, Settings, Plants, Locations, Work centres, Machines, Shift timing, Help)। Owner flag सारी permission जाँच छोड़ देता है।
- **रोज़ का काम:** Owner dashboard और bell (daily report pack) देखें; KPIs और Costing जाँचें; Governance में profile request मंज़ूर करें; Audit में HIGH/CRITICAL संकेत देखें; short-close और बंद लाइन के माल पर फ़ैसला लें; Users / Role matrix में पहुँच दें या हटाएँ।

## ADMIN
- **शुरुआती पेज:** System health (/dashboard/admin)।
- **Workspace:** Owner जैसे सातों, पर Reports & admin, KPIs पर खुलता है और उसमें Owner dashboard टैब नहीं है।
- **रोज़ का काम:** System health (disk, service, backup चेतावनी) देखें; यूज़र जोड़ें/बदलें, password reset करें; master, factory set-up, shift timing और reason code सही रखें; Audit देखें; Report Center के pack चालू रखें।

## SUPER_ADMIN
- **शुरुआती पेज:** System health (/dashboard/admin)।
- **Workspace:** Owner जैसे, Owner dashboard सहित। तकनीकी सहायता के लिए, रोज़ के प्लांट काम के लिए नहीं।

## SALES
- **शुरुआती पेज:** Sales dashboard (/dashboard/sales)।
- **Workspace:** Orders (Orders, New order, Job names, Quotations, Customers, Trade orders, Sales dashboard) और Reports & admin (Trading report, Help)। Sales, order composer में product चुनता है; Product master उसे नहीं दिखते।
- **रोज़ का काम:** नए sales order और quotation बनाएँ; हर order का tracker देखें; ग्राहक को dispatch की तारीख बताएँ; trade order संभालें; trading report देखें।

## PLANNER
- **शुरुआती पेज:** Planner dashboard (/dashboard/planner)।
- **Workspace:** Products (Web-width policies, Route dispatch), Plan (Command, Plan queue, Live production, Completed trace, Material readiness, Combine orders, Launch stock, MRP, Ink control, Planner dashboard), Floor (Visual factory, Ink floor, Job work, Jobs), Stock (roll, bulk, packaging, ink, movement, ledger, genealogy, alert, history… – Smart GRN और Adjustments नहीं), Yard & Dispatch (In transit, Goods in & out), Reports & admin (Capability matrix, Help)।
- **रोज़ का काम:** Plan queue पर काम करें; लाइनें route पर release करें और stock claim करें (roll की width window ±20 mm, lanes से run web तय होता है); order combine करें; stock job launch करें; Live production देखें; कमी के लिए Material readiness और MRP देखें; बंद लाइनों से free stock में आया माल claim करें।

## WORK_CENTER_MANAGER
- **शुरुआती पेज:** WC terminal (/production/work-center)।
- **Workspace:** Plan (Plan queue, Live production, Completed trace, Material readiness, Combine orders, Ink control), Floor (WC terminal, Machine terminal, Command deck, Visual factory, Ink floor, Jobs), Stock (roll, bulk, packaging, ink, conversion, roll movement, inter-plant, count, genealogy, period, inventory health)। सिर्फ़ User Management में दिए गए work centre दिखते हैं।
- **रोज़ का काम:** shift शुरू होते ही WC terminal खोलें; job machine पर release करें; command deck पर अटके या देर वाले job देखें; operator के output log और scrap जाँचें; material issue और return करें; अगली shift को खुले job सौंपें।

## OPERATOR (Machine Operator)
- **शुरुआती पेज:** Machine terminal (/production/machine-selector)।
- **Workspace:** सिर्फ़ Floor → Machine terminal। Operator maintenance स्क्रीन, My Profile और Help भी खोल सकता है; बाकी हर पता बंद है। सिर्फ़ User Management में टिक की गई machines दिखती हैं; machine का QR (/m/<code>) scan करने से उसका terminal खुलता है।
- **रोज़ का काम:** अपनी machine चुनें; release हुआ job शुरू करें; output लिखें (roll/मात्रा, trim और scrap – waste, Company Profile की limit तक पहुँचे तो scrap reason ज़रूरी); downtime कारण के साथ लिखें; fault बताएँ; shift खत्म होने पर job पूरा करें या सौंपें।

## STORE
- **शुरुआती पेज:** Rolls (/inventory/rolls)।
- **Workspace:** Floor (Ink floor, Job work), Stock (Rolls, Bulk, Packaging, Inks · adhesives, Smart GRN, Bills & documents, General receipts, Purchase orders, Vendors, conversion, movement, goods in & out, inter-plant, Adjustments, Count at rack, Ledger, genealogy, lifecycle, Alerts, Period, history, report, Inventory dashboard), Yard & Dispatch (In transit, Goods in & out, Outward documents, Gate passes)। Bills & documents के अधिकार default में Store के पास हैं।
- **रोज़ का काम:** gate पर आए बिल देखें; PO पर GRN (Receive) या Smart GRN पोस्ट करें; low-stock alert के लिए PO बनाएँ; floor को roll और material issue करें; rack count और adjustment करें; job work और gate pass संभालें; stock ledger देखें।

## DISPATCH
- **शुरुआती पेज:** Logistics dashboard (/dashboard/logistics)।
- **Workspace:** Stock (Goods in & out, Count at rack, Period) और Yard & Dispatch (Packing yard, Evening count, Packing audit, Dispatch bay, In transit, Goods in & out)।
- **रोज़ का काम:** Packing yard में pouch को gonny में pack करें (inner pouch tick नहीं होते: घर के inner pouch मशीन पर ही stock से घट चुके हैं, खरीदे हुए शाम की गिनती से बुक होते हैं), seal करके release करें, इस्तेमाल हुए बाकी packing सामान को mark के रूप में टिक करें; roll को dispatch के लिए release करें; Dispatch bay में हर sales-order लाइन की एक slip Epson 10×6 पर छापें, dispatched mark करें और proof of delivery लें; बंद लाइन का माल सिर्फ़ "Send goods of closed lines" टिक करने के बाद भेजें; शाम को packing count भरें ताकि gonny, carton, tape, खरीदे हुए inner pouch और बाकी सामान stock से घटे।

## PLANT_MANAGER
- **शुरुआती पेज:** KPIs (/analytics/kpis)।
- **Workspace:** Plan (Command, Plan queue, Live production, Completed trace, Material readiness, Combine orders, Launch stock, Ink control, Planner dashboard), Floor (Visual factory, Ink floor, Jobs, Maintenance, Faults, Schedules, Machine QR, Maintenance reports), Stock (Purchase orders पर खुलता है; Vendors, movement, goods in & out, Adjustments, count, ledger, lifecycle, alert, period, history, report, dashboard), Yard & Dispatch (In transit, Goods in & out), Reports & admin (KPIs, Reports hub, Capability matrix, Trading report, Help)।
- **रोज़ का काम:** KPIs और shift performance पढ़ें; देरी के लिए Plan queue और Live production देखें; machine fault और maintenance पर नज़र रखें; stock alert और खुले PO देखें; scrap और downtime रिपोर्ट देखें।

## WATCHMAN
- **शुरुआती पेज:** Gate terminal (/gate), office sidebar के बिना अलग gate स्क्रीन। कोई workspace नहीं; office पेज, override और owner flag कभी लागू नहीं होते। सिर्फ़ "Gate assignment" में टिक किए प्लांट पर entry हो सकती है।
- **रोज़ का काम:** सही प्लांट दिख रहा है यह देखें; visitor अंदर-बाहर दर्ज करें (देर वाले visitor पहले); आने पर माल और vendor बिल दर्ज करें; बाहर जाने वाले माल और gate pass को गाड़ी से मिलाएँ; shift खत्म होने से पहले सबको check out करें।

## Maintenance रोल
MAINTENANCE_TECH, Maintenance jobs (/maintenance/jobs) पर शुरू होता है और Floor → Ink floor, Maintenance, Faults देखता है। MAINTENANCE_SUPERVISOR, Maintenance board (/maintenance) पर शुरू होता है और Schedules, Machine QR और Maintenance reports भी देखता है।

## दिक्कतें और हल
- *मेरी sidebar में कोई स्क्रीन नहीं है*: "All screens" खोलें; वहाँ भी न हो तो आपके रोल में नहीं है – Owner/Admin से Role matrix में या personal override में जुड़वाएँ, फिर दोबारा login करें।
- *गलत शुरुआती पेज खुलता है*: base role गलत है; admin, User Management में बदले।
- *Operator या WCM को कोई machine नहीं दिखती*: user editor में machine (operator) या work centre (WCM) नहीं दिए गए।

## Every screen (English)

## हर स्क्रीन (हिंदी)
