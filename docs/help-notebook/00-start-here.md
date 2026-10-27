# TPP ERP help bot — start here / यहाँ से शुरू करें

This notebook holds the complete user guide of the Total Poly Print ERP (flexible packaging plant): every screen,
every step, the rules the plant follows, the usual problems and their fixes, and what the system does not do yet.
Answer in the language of the question (English or Hindi). Quote on-screen labels exactly as written in the guide.
When a user sends a screenshot, match the page by its heading and route, then answer from that page's section.
Always give the shareable guide link of the page (https://erp.totalpolyprint.com/guide?page=<slug>, add &lang=hi for Hindi).

यह नोटबुक Total Poly Print ERP की पूरी यूज़र गाइड है: हर स्क्रीन, हर स्टेप, प्लांट के नियम, आम दिक्कतें और उनके हल,
और जो सिस्टम अभी नहीं करता। सवाल जिस भाषा में हो, जवाब उसी में दें। स्क्रीन के लेबल वैसे ही लिखें जैसे गाइड में हैं।

## How work flows / काम कैसे चलता है
Sales order from placing to dispatch: Pick customer and order facts → Build the lines → Place order → Plan and release → Make on the floor → Pack and release → Dispatch slip and proof of delivery → Track and close

Sales order: डालने से dispatch तक: ग्राहक और order की जानकारी → lines बनाएँ → Place order → Plan और release → floor पर बनाना → Pack और release → Dispatch slip और proof of delivery → Track और बंद

## Plant rules / प्लांट के नियम
- Only inner pouches are taken off stock automatically (at packing). Every other packing item (gonny, sheet/putha, box, tape, label, tag, outer bag, other) is ticked at release and taken off stock by the evening packing count, split over the orders that ticked it.
- सिर्फ inner pouch पैकिंग पर अपने-आप स्टॉक से कटते हैं। बाकी हर पैकिंग आइटम रिलीज़ पर टिक होता है और शाम की गिनती से कटता है, उन ऑर्डरों में बँटकर जिन्होंने टिक किया।
- One dispatch slip per sales-order line (Epson 10 × 6 in). Goods of closed lines ship only after "Send goods of closed lines" is ticked, or move to free stock with a reason.
- हर सेल्स-ऑर्डर लाइन की एक डिस्पैच स्लिप। बंद लाइन का माल "Send goods of closed lines" टिक करने के बाद ही जाता है, या कारण के साथ फ्री स्टॉक में जाता है।
- Rolls are picked within ±20 mm of the needed width; lanes (n-up) decide the run web before slitting.

## Modules in this notebook
- 01 Roles — start page, sidebar and daily routine
- 02 Sales — orders, quotations, customers
- 03 Planner
- 04 Production — machines, jobs, ink
- 05 Dashboards, planner control tower and work-center terminal
- 06 Packing yard and dispatch bay
- 07 Inventory and stores
- 08 Gate — watchman, visitors, inward and outward
- 09 Master data — product masters, packaging, materials
- 10 Engineering — artworks, cylinders, routes, templates
- 11 Factory setup — plants, machines, processes
- 12 Maintenance
- 13 Procurement
- 14 Analytics and reports
- 15 System administration
- 16 Signing in
- 17 Profile
- 18 Help

## Roles / भूमिकाएँ
- **ADMIN** — Administrator Guide / Administrator गाइड: Administrator is responsible for secure, policy-compliant execution in assigned ERP modules. (start page /dashboard/admin)
- **OWNER** — System Owner Guide / System Owner गाइड: System Owner is responsible for secure, policy-compliant execution in assigned ERP modules. (start page /dashboard/owner)
- **SUPER_ADMIN** — Super Administrator Guide / Super Administrator गाइड: Super Administrator is responsible for secure, policy-compliant execution in assigned ERP modules. (start page /dashboard/admin)
- **SALES** — Sales Team Guide / Sales Team गाइड: Sales Team is responsible for secure, policy-compliant execution in assigned ERP modules. (start page /dashboard/sales)
- **PLANNER** — Production Planner Guide / Production Planner गाइड: Production Planner is responsible for secure, policy-compliant execution in assigned ERP modules. (start page /dashboard/planner)
- **WORK_CENTER_MANAGER** — Work Center Manager Guide / Work Center Manager गाइड: Work Center Manager is responsible for secure, policy-compliant execution in assigned ERP modules. (start page /production/work-center)
- **OPERATOR** — Machine Operator Guide / Machine Operator गाइड: Machine Operator is responsible for secure, policy-compliant execution in assigned ERP modules. (start page /production/machine-selector)
- **STORE** — Inventory Store Guide / Inventory Store गाइड: Inventory Store is responsible for secure, policy-compliant execution in assigned ERP modules. (start page /inventory/rolls)
- **DISPATCH** — Logistics/Dispatch Guide / Logistics/Dispatch गाइड: Logistics/Dispatch is responsible for secure, policy-compliant execution in assigned ERP modules. (start page /dashboard/logistics)
- **PLANT_MANAGER** — Plant Manager Guide / Plant Manager गाइड: Plant Manager is responsible for secure, policy-compliant execution in assigned ERP modules. (start page /analytics/kpis)
- **WATCHMAN** — Watchman Gate Guide / चौकीदार गेट गाइड: The watchman logs every vehicle in and out of the assigned gate and checks visitors out when they leave. Visitors record their own entry by scanning the gate QR. Watchman access is limited to the gate terminal. (start page /gate)
- **MAINTENANCE_SUPERVISOR** — Maintenance supervisor / मेंटेनेंस सुपरवाइज़र: Keeps machines running: sees every breakdown and planned job, assigns technicians and closes jobs. (start page /maintenance)
- **MAINTENANCE_TECH** — Maintenance technician / मेंटेनेंस टेक्नीशियन: Works the maintenance jobs given to them and records what was done, parts and time. (start page /maintenance/jobs)
