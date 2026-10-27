# Sales — orders, quotations, customers

## Overview (English)
# Sales module

Sales is where customer demand enters the plant. A sales clerk takes the customer's order, builds each line from the Product Master, and places it. The order then goes to the planner, who picks the plant and releases each line to the route. From there work centres make the goods, the Packing Yard packs and releases them, and Dispatch Bay ships them. Sales watches the whole journey from one order tracker.

## Screens and how they connect

- **Sales Orders** (`/sales/orders`) – the home page of Sales. Every open order by age and stage. Orders older than 5 days show in red. Filters (status, age, customer, master, Advanced), saved views (kept in this browser), CSV export and cancel before release.
- **New order** (`/sales/orders/create`) – the order composer. Customer → order facts → lines → *Place order*.
- **Sales order tracker** (`/sales/orders/[id]`) – one page per order: spine (Master · Quote · Order · Plan · Floor · Yard · Dispatch), fulfilment figures, line route progress, technical sheet and BOM, documents and material audit.
- **Customer dispatches** (`/sales/orders/[id]/dispatches`, `/new`) – dispatch records against the order lines. Daily slips (one per line, Epson 10×6 in) are made in **Dispatch Bay** (`/logistics/dispatch`); the tracker links to them.
- **Job names** (`/sales/job-names`) – orders grouped by the job name typed in the composer, with ordered, dispatched, open kg and on-time %.
- **Quotations** (`/sales/quotations`, `/new`, `/[id]`) – price an enquiry, cost it, get approval, send the frozen PDF, record the customer's answer and convert to a sales order.
- **Customers** (`/sales/customers`) – customer master: code, name, GST, contacts, addresses, credit terms.
- **Trade Orders** (`/sales/trade-orders`) – resale from stock without production (granules, film, trading goods).
- Old links (`/sales`, `/orders`, `/orders/[id]`, `/orders/create`, `/sales/orders/new`, `.../tracking`) only redirect.

## Main flow: placing an order

1. Open **New order**. Answer *Who is this order for?* (type two letters, arrows + Enter). A draft left in this browser is offered: *Resume draft* or *Start fresh*.
2. Fill the order facts row: Ship to, Promised dispatch (default 7 days ahead, shows "in N days"), Job name (optional, e.g. "ABC May order"), Ship address (blank = saved address) and Note for dispatch (prints on the slip). Plant stays *Auto · planner*.
3. Add lines. In the quick-add row type the product code or name (⌘K), then size, qty, unit (pouches default to pcs) and rate, and press Enter. A product that prints or packs into pouches is added as *Check the line* and must be opened once.
4. Open a line (Enter or *Add line*, Alt N) for the full editor: Product, Size, Layers, Qty & rate, Print & artwork, Packing, Add-ons, More options (lane, trim, wastage). Alt ←/→ moves between lines.
5. Artwork: *Pick approved artwork*, *Use customer overlay* or *Defer to planner*. Deferred artwork lets the order be placed, but print release is blocked until approved artwork is assigned.
6. Open *Before you place* and use *Fix →* on each item. When all is clear press **Place order** (⌘↵).
7. The summary shows the SO number (for example SO-2026-0123), lines, quantity, value and promised date, with *Open order*, *Open in planner*, *New order for …* and *New order*.

## Quotation flow

Draft → Submit for approval (revision and Cost Build freeze) → an approver who is not the submitter approves each gate → Send frozen revision by email (contact email required) → Record acceptance (PO/email reference) or rejection (reason), or Mark expired → Convert to Sales Order (Accepted only). A converted quote cannot be cancelled; cancel the sales order instead. To change a frozen quote, use *Duplicate quotation*.

## After placing

- The planner releases lines; the order tracker's spine moves Plan → Floor.
- Inner pouches are never ticked in the Packing Yard. In-house inner pouches come off stock at the machine's last pouching step when the output is logged; bought inner pouches are booked to the order by the evening packing count. Gonny, sheet/putha, box, tape, label, tag, outer bag and other items are ticked at release as marks and booked by the evening packing count, which splits the use over the orders that ticked them in whole pieces (if no one ticked an item, over that day's orders whose packing plan includes it).
- Dispatch Bay makes one slip per sales-order line, marks it dispatched and records proof of delivery. The order becomes COMPLETED only when proof of delivery (POD) is confirmed for every line; marking a slip dispatched does not complete it.
- Goods of a closed line or order (short-closed, completed, cancelled) can ship only after ticking *Send goods of closed lines*, or be moved to free stock with a reason.

## Rules and limits

- Sales can cancel an order only before planner release (Draft, Confirmed, Planning, Planned). Released lines are cancelled or short-closed in the Planner.
- Every line needs a product master, a size, qty > 0 and a rate > 0. Printed lines need approved artwork matching the print method (Roto/Flexo) and sheet/tubing form, unless deferred.
- Drafts autosave only in the browser where they were typed.
- Promised dispatch is required. The plant is never picked by Sales.
- Trade orders consume stock at the chosen plant when dispatched; this cannot be undone.

## Roles

- **SALES**: customers, quotations, orders, job names, trade orders, tracking.
- **OWNER / ADMIN / SUPER_ADMIN**: everything Sales does plus product masters.
- **PLANNER**: receives placed orders in the plan queue; cancels or short-closes released lines.
- **DISPATCH**: Dispatch Bay slips; may view customer dispatch records.
- Quotation approval needs a second authorised user.

## Problems and fixes

- *Place order is grey*: open the warning pill or *Before you place*; fix each line ("Needs rate", "Needs artwork", "Check the line").
- *Product master unavailable*: the master is inactive or an old version. Remove the line and add the current master.
- *Draft lost*: drafts live in one browser; reopen New order on the same PC and press *Resume draft*.
- *Cannot cancel the order*: it is released; ask the planner to short-close.
- *Dispatch refused – not ready*: release the goods in the Packing Yard first; partial lines ship only finished output.
- *Quote cannot be approved by me*: the submitter cannot approve their own revision.
- *Customer missing in the composer*: add it in Customers and refresh.

## सारांश (हिंदी)
# Sales module

Sales वह जगह है जहाँ ग्राहक की माँग plant में आती है। sales clerk ग्राहक का order लेता है, Product Master से हर line बनाता है और order डालता है। फिर order planner के पास जाता है, जो plant चुनता है और हर line route पर release करता है। उसके बाद work centre माल बनाते हैं, Packing Yard pack करके release करता है, और Dispatch Bay माल भेजता है। Sales पूरा सफर एक order tracker पर देखता है।

## Screens और उनका आपसी जुड़ाव

- **Sales Orders** (`/sales/orders`) – Sales का मुख्य page। हर खुला order उम्र और stage के हिसाब से। 5 दिन से पुराने orders लाल में। filter (status, उम्र, ग्राहक, master, Advanced), saved views (इसी browser में), CSV export और release से पहले cancel।
- **New order** (`/sales/orders/create`) – order composer। ग्राहक → order की जानकारी → lines → *Place order*।
- **Sales order tracker** (`/sales/orders/[id]`) – हर order का एक page: spine (Master · Quote · Order · Plan · Floor · Yard · Dispatch), कितना बना/गया, line का route, technical sheet और BOM, documents और material audit।
- **Customer dispatches** (`/sales/orders/[id]/dispatches`, `/new`) – order lines पर dispatch record। रोज़ की slips (हर line की एक, Epson 10×6 inch) **Dispatch Bay** (`/logistics/dispatch`) में बनती हैं; tracker से वहाँ link है।
- **Job names** (`/sales/job-names`) – composer में लिखे job name के हिसाब से orders, ordered, dispatched, open kg और समय पर पूरे होने के % के साथ।
- **Quotations** (`/sales/quotations`, `/new`, `/[id]`) – enquiry का भाव, costing, approval, frozen PDF भेजना, ग्राहक का जवाब दर्ज करना और sales order में convert।
- **Customers** (`/sales/customers`) – ग्राहक master: code, नाम, GST, contact, पते, credit शर्तें।
- **Trade Orders** (`/sales/trade-orders`) – बिना production के stock से बिक्री (granules, film, trading goods)।
- पुराने links (`/sales`, `/orders`, `/orders/[id]`, `/orders/create`, `/sales/orders/new`, `.../tracking`) सिर्फ आगे भेजते हैं।

## मुख्य काम: order डालना

1. **New order** खोलें। *Who is this order for?* का जवाब दें (दो अक्षर लिखें, तीर और Enter)। इस browser में छूटा draft हो तो *Resume draft* या *Start fresh* चुनें।
2. order facts वाली row भरें: Ship to, Promised dispatch (default 7 दिन बाद, "in N days" दिखता है), Job name (ज़रूरी नहीं, जैसे "ABC May order"), Ship address (खाली = saved पता) और Note for dispatch (slip पर छपता है)। Plant *Auto · planner* ही रहता है।
3. lines जोड़ें। quick-add row में product का code या नाम (⌘K), फिर size, qty, unit (pouch default pcs) और rate भरकर Enter दबाएँ। जो product print होता है या pouch में pack होता है वह *Check the line* के साथ जुड़ता है और उसे एक बार खोलना ज़रूरी है।
4. पूरा editor के लिए line खोलें (Enter या *Add line*, Alt N): Product, Size, Layers, Qty & rate, Print & artwork, Packing, Add-ons, More options (lane, trim, wastage)। Alt ←/→ से lines बदलें।
5. Artwork: *Pick approved artwork*, *Use customer overlay* या *Defer to planner*। planner पर छोड़ने से order डल जाता है, पर approved artwork मिलने तक print release रुका रहता है।
6. *Before you place* खोलें और हर कमी पर *Fix →* दबाएँ। सब ठीक होने पर **Place order** (⌘↵) दबाएँ।
7. सारांश में SO number (जैसे SO-2026-0123), lines, मात्रा, कीमत और वादे की तारीख दिखती है, साथ में *Open order*, *Open in planner*, *New order for …* और *New order*।

## Quotation का क्रम

Draft → Submit for approval (revision और Cost Build freeze) → submit करने वाले से अलग approver हर gate approve करता है → Send frozen revision email से (contact email ज़रूरी) → Record acceptance (PO/email reference) या rejection (कारण), या Mark expired → Convert to Sales Order (सिर्फ Accepted)। convert हुई quote cancel नहीं होती; उसकी जगह sales order cancel करें। freeze quote बदलनी हो तो *Duplicate quotation* करें।

## Order डालने के बाद

- planner lines release करता है; tracker की spine Plan → Floor पर बढ़ती है।
- Packing Yard में inner pouch कभी tick नहीं होते। घर में बने (in-house) inner pouch मशीन के आखिरी pouching step पर output दर्ज होते ही stock से घटते हैं; खरीदे हुए inner pouch शाम की packing गिनती order पर बुक करती है। gonny, sheet/putha, box, tape, label, tag, outer bag और बाकी सामान release पर सिर्फ tick (निशान) होते हैं और शाम की packing गिनती में बुक होते हैं, जो इस्तेमाल को tick करने वाले orders में पूरे नग के हिसाब से बाँटती है (किसी ने tick न किया हो तो उस दिन के उन orders में जिनके packing plan में वह item है)।
- Dispatch Bay हर sales-order line की एक slip बनाता है, dispatch mark करता है और proof of delivery दर्ज करता है। हर line का proof of delivery (POD) confirm होने पर ही order COMPLETED होता है; slip को dispatched mark करने से order पूरा नहीं होता।
- बंद line या order (short-closed, completed, cancelled) का माल सिर्फ *Send goods of closed lines* tick करने के बाद जा सकता है, या कारण के साथ free stock में डाला जा सकता है।

## नियम और सीमाएँ

- Sales सिर्फ planner release से पहले order cancel कर सकता है (Draft, Confirmed, Planning, Planned)। release हुई lines Planner में cancel या short-close होती हैं।
- हर line में product master, size, qty > 0 और rate > 0 चाहिए। printed line को print तरीके (Roto/Flexo) और sheet/tubing form से मेल खाता approved artwork चाहिए, जब तक planner पर न छोड़ा हो।
- draft सिर्फ उसी browser में save होता है जहाँ लिखा गया।
- Promised dispatch ज़रूरी है। plant Sales कभी नहीं चुनता।
- trade order dispatch होने पर चुने plant से stock घटता है; यह वापस नहीं होता।

## Roles

- **SALES**: customers, quotations, orders, job names, trade orders, tracking।
- **OWNER / ADMIN / SUPER_ADMIN**: Sales का सब काम और product masters।
- **PLANNER**: डाले गए orders plan queue में लेता है; release हुई lines cancel या short-close करता है।
- **DISPATCH**: Dispatch Bay की slips; customer dispatch record देख सकता है।
- quotation approval के लिए दूसरा अधिकृत user चाहिए।

## समस्याएँ और हल

- *Place order grey है*: चेतावनी pill या *Before you place* खोलें; हर line ठीक करें ("Needs rate", "Needs artwork", "Check the line")।
- *Product master unavailable*: master inactive है या पुराना version। line हटाकर नया master जोड़ें।
- *Draft खो गया*: draft एक ही browser में रहता है; उसी PC पर New order खोलकर *Resume draft* दबाएँ।
- *Order cancel नहीं हो रहा*: order release हो चुका; planner से short-close करवाएँ।
- *Dispatch मना – not ready*: पहले Packing Yard में माल release करें; partial line में सिर्फ तैयार माल जाता है।
- *मैं quote approve नहीं कर पा रहा*: submit करने वाला अपनी revision approve नहीं कर सकता।
- *Composer में ग्राहक नहीं*: Customers में जोड़ें और page refresh करें।

## Every screen (English)

### Sales Command Center (/dashboard/sales)
Screen address: /dashboard/sales · Roles: SALES, ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=dashboard-sales

Order intake, pipeline, delivery promise and customer mix, calculated live from sales orders.

Sales staff's landing page. Open it to see drafts that still need confirming, overdue orders, what is ready to ship and how intake is trending. Press "Create order" to book a new order or "View orders" for the full list.

**Before you start**
- Customers and product masters exist; orders booked.

**Step by step**
1. Read the hero: "Order value · 30 days", "Open pipeline", "On time in full" (against target) and "Overdue orders".
2. Click "Drafts to confirm" to open the orders list and confirm drafts; drafts never reach the planner.
3. Check "Ready to ship" (orders in Dispatch Bay) and "Quote conversion".
4. Read "Needs attention" (work waiting on the sales desk) and "Most overdue".
5. Switch "Order intake · last 30 days" between Weight and Orders.
6. Open an order from "Recent orders" (Order, Customer, Weight, Status, Created).
7. Press "Create order" to start a new sales order.

**What is on the screen**
- **Open pipeline**: Weight of open orders; hint gives the count.
- **On time in full**: Share of completed orders delivered on time and in full; green at or above target.
- **Overdue orders**: Orders past promised delivery.
- **Drafts to confirm**: Orders saved as draft, waiting for confirmation.
- **Order pipeline**: Open orders by stage.
- **Top customers / Products by value · 30 days**: Customers by ordered weight; products by value.
- **Monthly target progress**: Shown only when a monthly sales target is set.

**Common problems and fixes**
- "Data unavailable" — The sales dashboard feed failed; reload the page.
- "No orders in the last 30 days" — No orders created in the window.

**If stuck**
1. Use "Fulfillment report" for a detailed sales report.

Related pages: /sales/orders, /sales/orders/create, /sales/quotations, /logistics/dispatch, /analytics/reports/sales

**Not done yet / watch out**
- The sidebar hides "Sales Dashboard" for the SALES role even though it is that role's landing page; it is reachable from the Orders workspace tab.

### Orders (old link) (/orders)
Screen address: /orders · Roles: SALES, OWNER, ADMIN, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=orders

This is an old or short address. It opens /sales/orders straight away.

The old /orders address opens Sales Orders.

**Before you start**
- Your role must be allowed to open the target page.

**Step by step**
1. Open the link or bookmark. The browser moves to /sales/orders by itself.
2. Update your bookmark to /sales/orders so the extra hop is skipped.

**Common problems and fixes**
- "Page keeps loading or shows "not found"" — The order id in the link is wrong or the order was removed. Open the Orders list and search the SO number.

**If stuck**
1. Open "Orders" from the Sales menu and find the order there.

Related pages: /sales/orders

### Order (old link) (/orders/[id])
Screen address: /orders/[id] · Roles: SALES, OWNER, ADMIN, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=orders-id

This is an old or short address. It opens /sales/orders/[id] straight away.

Old order links open the same order in the sales order tracker.

**Before you start**
- Your role must be allowed to open the target page.

**Step by step**
1. Open the link or bookmark. The browser moves to /sales/orders/[id] by itself.
2. Update your bookmark to /sales/orders/[id] so the extra hop is skipped.

**Common problems and fixes**
- "Page keeps loading or shows "not found"" — The order id in the link is wrong or the order was removed. Open the Orders list and search the SO number.

**If stuck**
1. Open "Orders" from the Sales menu and find the order there.

Related pages: /sales/orders/[id]

### Order tracking (old link) (/orders/[id]/tracking)
Screen address: /orders/[id]/tracking · Roles: SALES, OWNER, ADMIN, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=orders-id-tracking

This is an old or short address. It opens /sales/orders/[id] straight away.

Old tracking links go to /sales/orders/[id]/tracking, which then opens the unified order tracker at /sales/orders/[id].

**Before you start**
- Your role must be allowed to open the target page.

**Step by step**
1. Open the link or bookmark. The browser moves to /sales/orders/[id] by itself.
2. Update your bookmark to /sales/orders/[id] so the extra hop is skipped.

**Common problems and fixes**
- "Page keeps loading or shows "not found"" — The order id in the link is wrong or the order was removed. Open the Orders list and search the SO number.

**If stuck**
1. Open "Orders" from the Sales menu and find the order there.

Related pages: /sales/orders/[id], /sales/orders/[id]/tracking

### Create order (old link) (/orders/create)
Screen address: /orders/create · Roles: SALES, OWNER, ADMIN, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=orders-create

This is an old or short address. It opens /sales/orders/create straight away.

The old create address opens the order composer.

**Before you start**
- Your role must be allowed to open the target page.

**Step by step**
1. Open the link or bookmark. The browser moves to /sales/orders/create by itself.
2. Update your bookmark to /sales/orders/create so the extra hop is skipped.

**Common problems and fixes**
- "Page keeps loading or shows "not found"" — The order id in the link is wrong or the order was removed. Open the Orders list and search the SO number.

**If stuck**
1. Open "Orders" from the Sales menu and find the order there.

Related pages: /sales/orders/create

### Sales (redirect) (/sales)
Screen address: /sales · Roles: SALES, OWNER, ADMIN, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=sales

This is an old or short address. It opens /sales/orders straight away.

The Sales home is the order list. Opening /sales sends you to Sales Orders, where every open order is listed by age and stage.

**Before you start**
- Your role must be allowed to open the target page.

**Step by step**
1. Open the link or bookmark. The browser moves to /sales/orders by itself.
2. Update your bookmark to /sales/orders so the extra hop is skipped.

**Common problems and fixes**
- "Page keeps loading or shows "not found"" — The order id in the link is wrong or the order was removed. Open the Orders list and search the SO number.

**If stuck**
1. Open "Orders" from the Sales menu and find the order there.

Related pages: /sales/orders, /sales/orders/create, /dashboard/sales

### Customers (/sales/customers)
Screen address: /sales/customers · Roles: SALES, OWNER, ADMIN, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=sales-customers

The customer master: code, legal name, GST, contacts, billing and extra addresses, credit terms and status. Orders, quotations and dispatch slips read from here.

Open it before the first order for a new customer, or when a customer's address, GST, contact or credit terms change. The saved address becomes the default ship address in the order composer and prints on dispatch slips.

**Before you start**
- Permission to manage sales (sales.manage). Read-only sales users do not see this page in the menu.

**Step by step**
1. Press "Register New Account" to open the "Account Registration" form.
2. Fill "Identity Code" (e.g. CUST-001) and "Legal Entity Name". Both are required.
3. Add contact person, email, phone, "Tax Protocol ID (GST)" and "PAN No.".
4. Fill the "Primary Mailing Address" block (Mailing Name, Primary Address, State, Country, Pincode).
5. Press "Add Address" for each extra delivery point (label such as "Surat DC", address, contact, phone).
6. Set "Credit Period (Days)", "Credit Limit", TDS/TCS switches and "Status" (Active / Inactive).
7. Press "Commit Master Data" to save. To change a customer later, use the edit icon on its row ("Modify Account Topology").

**What is on the screen**
- **Identity Code**: Short unique customer code. Shown in the composer next to the name and in exports.
- **Legal Entity Name**: The customer name used on orders, quotations and slips.
- **Under Group**: Accounts group, e.g. Sundry Debtors.
- **Tax Protocol ID (GST) / PAN No.**: GST number shows in the composer header line as "GST …".
- **Primary Address**: The billing address. When no separate shipping address is saved, the composer uses it as the ship address.
- **Additional Addresses**: Extra delivery points with their own contact. Empty rows are dropped on save.
- **Credit Period (Days) / Credit Limit**: Credit days show in the composer as "N d credit" and in the quotation customer panel. The ERP does not block orders on credit.
- **TDS Deductable / TCS Deductable**: Switch on if tax is deducted / collected for this customer ledger.
- **Status**: Active or Inactive. Keep old customers Inactive instead of deleting them.
- **Table columns**: Client Code, Corporate Entity, Tax Identity, Account Status, Credit Exposure, Address Book, plus edit and delete icons. The search box filters by name.

**Common problems and fixes**
- "Code is required / Name is required" — The form will not save without "Identity Code" and "Legal Entity Name". Fill both.
- "Invalid email" — Email fields (main and in each extra address) must be a real email or left empty.
- ""Error" toast after save or delete" — The server refused, often because the code already exists or the customer is used on orders. Change the code, or set Status to Inactive instead of deleting.

**If stuck**
1. If a new customer is missing in the order composer, refresh the composer page; the customer list is cached for about a minute.
2. To undo half-typed changes in the form, press "Reset".
3. Delete asks for confirmation ("Protocol Purge Warning" → "Execute Purge"); press "Abort Operation" to back out.

Related pages: /sales/orders/create, /sales/quotations/new, /sales/orders

**Not done yet / watch out**
- The customer form has no separate shipping-address field; the composer falls back to the billing address, and extra addresses are not offered as ship-to choices in the composer.
- The page uses unusual labels ("Legal Entity Name", "Commit Master Data", "Execute Purge") and the delete wording does not say whether a customer with orders can be removed.

### Job names (/sales/job-names)
Screen address: /sales/job-names · Roles: SALES, OWNER, ADMIN, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=sales-job-names

Orders grouped by the job name typed when the order was placed, with ordered, dispatched and open kg and the on-time rate.

Use it to answer "how much of the ABC May job is still open?" or to find all orders of one job. Click a job name to open the order list filtered by it.

**Before you start**
- Orders placed with a "Job name" in the order composer. Orders without one are counted as unnamed.

**Step by step**
1. Read the tiles: "Job names", "Orders with a job name" (%), "Ordered", "Dispatched", "Open".
2. Type in "Search job name or customer" to narrow the table.
3. Pick "Sort": Open kg, Ordered kg, Orders or Last ordered.
4. Click a job name to open Sales Orders filtered by that name.
5. Press "New order" to start an order (type the job name there).

**What is on the screen**
- **Job name**: The name typed in the composer, with the number of lines under it.
- **Orders**: Orders with this name; "N open" counts those not completed or cancelled.
- **Customers**: Customers who used this job name.
- **Ordered**: Total kg (and pcs) ordered. Cancelled lines are left out.
- **Dispatched / Open kg**: Dispatched bar against ordered; Open kg = ordered minus dispatched.
- **On time**: Share of completed orders finished on or before their promised date. "—" means none completed yet.
- **Last order**: Date of the newest order with this name.

**Common problems and fixes**
- "Could not load job names. Refresh to try again." — The report call failed (network or server). Refresh the page.
- "No job names yet." — No order has a job name. Type one in the composer's "Job name" box when placing orders.

**If stuck**
1. A job is missing: check the exact spelling used on the order; names are grouped as typed.
2. Old orders that only had an automatic name like "Order 2026-05-01" are not shown as job names.

Related pages: /sales/orders, /sales/orders/create

**Not done yet / watch out**
- Job names are grouped exactly as typed, so spelling differences create separate rows; there is no way to rename or merge them.

### Sales Orders (/sales/orders)
Screen address: /sales/orders · Roles: SALES, OWNER, ADMIN, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=sales-orders

Every open sales order by age and stage, with filters, saved views, CSV export and cancel before planner release.

Start the day here: find orders waiting for planning, orders older than 5 days (shown in red) and what is ready or dispatched. Open an order to see its tracker, or start a new one.

**Before you start**
- Orders placed from the order composer or converted from a quotation.

**Step by step**
1. Read the tiles: "Open", "Awaiting planning", "Aged 6+ days", "Created today", "Value in flight", "Avg age".
2. Search "Search SO #, customer, product master, variant…" or click a status pill (Planning, Planned, Released, Packing, Dispatch) or age pill (Fresh 0-2d, Watch 3-5d, Aged 6+d).
3. Narrow further with "Any customer", "Any master" and "Advanced" (product type POUCH/ROLL/POD/PACKAGING, size, pouch style).
4. Switch the table tab: "Order queue", "History" or "Cancelled".
5. Click a row or its open icon ("Open order tracker") to open the order.
6. To keep a filter set, save it as a view (you are asked "Name this saved view"). Views are kept in this browser.
7. Tick rows and use "Export" for a CSV, or press "Export · N" for all visible rows.
8. To cancel, press the cancel icon on a row, pick "Full order" or selected lines, choose a reason, add a note and confirm.
9. Press "New order" to open the order composer.

**What is on the screen**
- **Customer · Order #**: Customer name and SO number; job name shows beside the number when set.
- **Product · size · layers**: Product master, size in mm, layer chips, print colours (F/B) and artwork thumbnail.
- **Placed · age**: Order date and age in days. 6+ days is red.
- **Qty · progress**: Ordered qty with a bar of ready, dispatched, WIP and open kg per line ("Line-wise fulfillment").
- **Status pills**: Planning = waiting for planner; Planned; Released = on the floor; Packing; Dispatch.
- **Flow filter**: "All flow", "Ready" (finished goods waiting), "Dispatched".
- **Cancel reasons**: Customer cancelled, Spec error, Credit hold, Duplicate, Other.
- **Showing the N newest of M open orders**: Only the newest orders are loaded; search to reach older ones.

**Common problems and fixes**
- "Cancel icon missing on an order" — Sales can cancel only Draft, Confirmed, Planning or Planned orders. Once the planner has released lines, ask the planner to cancel or short-close them.
- "Could not cancel order — Released orders must be changed from Planner, not Sales." — A line was released while the dialog was open. Use the Planner.
- "Order already has released, executing, paused, or completed production jobs and cannot be cancelled from Sales." — Production has started on the order. Short-close the rest from the Planner.
- "Reason is required to cancel sales order lines." — Pick a reason (and a note) before confirming.
- "Select at least one sales order line to cancel." — In line scope, tick at least one line.

**If stuck**
1. An order is not in the list: clear filters ("Reset"), check the "History" and "Cancelled" tabs, then search the SO number.
2. Saved views disappeared: they live only in this browser; save them again.

Related pages: /sales/orders/create, /sales/orders/[id], /sales/job-names, /master/products, /dashboard/planner/control-tower/plan-queue

**Not done yet / watch out**
- Saved views are stored per browser, not per user account, so they do not follow a user to another PC.
- The list loads only the newest open orders; older ones are reached only by searching.

### Sales order tracker (/sales/orders/[id])
Screen address: /sales/orders/[id] · Roles: SALES, OWNER, ADMIN, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=sales-orders-id

One page per order: lines, live route progress, technical spec and BOM, documents, dispatch slips and a material audit with timeline.

Open it when a customer asks "where is my order?" or before promising a date. It shows how much is ready, dispatched, in WIP and still open, and where each line is on the floor.

**Before you start**
- A placed sales order (from the composer or a converted quotation).

**Step by step**
1. Read the spine at the top: Master → Quote → Order → Plan → Floor → Yard → Dispatch. Each station shows its state and opens the matching page.
2. Check the header: SO number, job name, status, "Placed" and "Due" dates, line chips and the "Fulfillment truth" % complete.
3. If the order is still Draft, press "Confirm commercial".
4. Open "Commercial head" to see bill to, ship to, payment/delivery terms and the client note ("note prints on slip").
5. Tab "Line items + live route": per line ordered / ready / WIP / dispatched / open / scrap and each route step.
6. Tab "Technical + BOM": size, layers, print, packing and the frozen BOM rows of each line.
7. Tab "Documents": "Dispatch ledger", "New dispatch", and "Slips in Dispatch Bay · reprint, proof of delivery".
8. Tab "Material audit + timeline": target, output, WIP, consumed, scrap, mass gap and every event.

**What is on the screen**
- **Ordered / Ready (FG) / Dispatched / WIP / Scrap / Open**: Order totals in kg. Ready = made but not dispatched; WIP = active route work only; Open = target − ready − dispatched − WIP.
- **% complete**: (Ready + dispatched) ÷ ordered.
- **Status badge**: Order status, e.g. Planning, Released, Packing, Dispatch, Completed.
- **Commercial head**: Bill to, Ship to, Payment terms, Delivery terms, Client note.
- **Line technical facts**: Width, height, gusset or roll web in mm (with inches), unit weight, pcs/kg, inner pack, pcs/pack, POD.
- **Order mass balance**: Ordered target → Final output + Ready FG + Dispatched + Live WIP + Open gap.
- **refreshing**: Tracking data reloads every minute.

**Common problems and fixes**
- "Sales order not found" — Wrong link or no access. Press "Go back" and open the order from the list.
- "Order cannot be confirmed from status …" — "Confirm commercial" works only on Draft orders; the order has already moved on.
- "No layer/BOM snapshot on this line." — The line was saved without a frozen BOM. Ask the planner to check the line before release.

**If stuck**
1. Numbers look old: wait for the refresh or reload the page.
2. To cancel or short-close a released line, go to the Planner; this page has no cancel button.
3. To reprint a slip or record proof of delivery, use the Dispatch Bay link in "Documents".

Related pages: /sales/orders, /sales/orders/[id]/dispatches, /sales/orders/[id]/dispatches/new, /logistics/dispatch, /logistics/packing, /dashboard/planner/control-tower/command, /production/work-center

**Not done yet / watch out**
- The order tracker has no edit, cancel or short-close button; cancel is only on the Sales Orders list (before release) and short-close only in the Planner.
- A placed order's lines, rates or dates cannot be edited from Sales; there is no amend-order screen.

### Order tracking (redirect) (/sales/orders/[id]/tracking)
Screen address: /sales/orders/[id]/tracking · Roles: SALES, OWNER, ADMIN, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=sales-orders-id-tracking

This is an old or short address. It opens /sales/orders/[id] straight away.

Tracking used to be a separate page. It is now part of the single order tracker, so this address shows "Opening unified order tracker..." and moves to the order page.

**Before you start**
- Your role must be allowed to open the target page.

**Step by step**
1. Open the link or bookmark. The browser moves to /sales/orders/[id] by itself.
2. Update your bookmark to /sales/orders/[id] so the extra hop is skipped.

**Common problems and fixes**
- "Page keeps loading or shows "not found"" — The order id in the link is wrong or the order was removed. Open the Orders list and search the SO number.

**If stuck**
1. Open "Orders" from the Sales menu and find the order there.

Related pages: /sales/orders/[id], /sales/orders

### New order (/sales/orders/create)
Screen address: /sales/orders/create · Roles: SALES, OWNER, ADMIN, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=sales-orders-create

The sales order composer: pick the customer, set order facts, add lines from the Product Master (size, layers, print, packing, qty, rate) and place the order to the planner.

Open it whenever a customer gives an order. When placed, the order goes to the planning queue; the planner picks the plant and releases each line. Drafts autosave in this browser.

**Before you start**
- Customer exists in Customers (active).
- An order-ready Product Master with saved sizes; for printed items an approved artwork (or choose "Defer to planner").
- Permission to create orders (page.sales.order_create).

**Step by step**
1. Answer "Who is this order for?": type 2 letters, use ↑/↓ and Enter, click a "Recent" customer, or pick from the full list. If offered, choose "Resume draft" or "Start fresh".
2. In the order facts row set "Ship to", "Promised dispatch", "Job name" (optional), "Ship address" and "Note for dispatch". "Plant" stays "Auto · planner".
3. Add lines in the quick-add row: product (⌘K) → size → qty → unit → rate → Enter. Or press "Editor" / Shift+Enter, or "Add line" (Alt N) for the full editor. "Quick Start" cards repeat the last order or saved items.
4. Open a line (Enter on the row) and work through the steps: Product, Size, Layers, "Qty & rate", "Print & artwork", "Packing", "Add-ons", "More options". Press "Done with this line" or "Save & add another".
5. Check each row's status ("Ready" or the first missing thing, e.g. "Needs rate", "Needs artwork", "Check the line").
6. Open "Before you place" and press "Fix →" on each item until it says "all clear".
7. Press "Place order" (⌘↵). The button works only when every line is ready.
8. On "Sales order sent to planner" use "Open order", "Open in planner", "New order for …" or "New order".

**What is on the screen**
- **Customer**: Bill-to customer. Click it to change. The line under it shows code, GST, credit days and "price basis kg by default".
- **Ship to**: "Same as customer" or another customer receiving the goods.
- **Promised dispatch**: Date promised to the customer, shown with "in N days". Defaults to 7 days ahead. Required.
- **Plant**: "Auto · planner" — picked when the order is planned.
- **Job name**: Optional name like "ABC May order"; shows beside the SO number everywhere and groups orders on Job names.
- **Ship address**: Blank means the saved address (shown as "Saved · …"). Type to override for this order only.
- **Note for dispatch**: Client note, e.g. delivery time; shown on the order page and printed on the dispatch slip.
- **Lines table**: Product · line label, Size (mm with inches), Layers · gauge, Print (Roto/Flexo, colours, "artwork later" or "Plain"), Qty, Rate, Value, Status. Totals row: lines, kg + pcs, ₹.
- **Row keys**: Enter opens, D duplicates, Alt ↑/↓ moves, Delete removes (Undo in the toast).
- **Quick-add unit**: Pouch products start in pcs, others in kg. The rate is per that unit.
- **Check the line**: A printed or pouch product added from quick-add must be opened once to confirm print and packing.
- **Print & artwork**: Roto or Flexo, film form, and artwork mode: "Pick approved artwork", "Use customer overlay" or "Defer to planner" (planner must assign before print release; cylinders checked only for ROTO).
- **Packing**: Inner pouch, "Pieces per inner pouch" (override) and "Packing note". Inner pouches are never ticked at packing: in-house ones come off stock at the machine's last pouching step, bought ones by the evening packing count.
- **More options**: Lane, add-ons and wastage: production lane (n-up), trim, wastage / issue policy with a reason.
- **Draft saved hh:mm**: The draft autosaves in this browser while you type. Placing the order clears it.
- **Make for stock / Save as quotation**: Side exits: open the planner's stock launcher, or a new quotation for this customer.

**Common problems and fixes**
- "Packing: set pieces per inner pouch (this inner pouch has no default)." — A pouch line has an inner pouch but nobody said how many pouches go in one. Open the line → Packing → "Pieces per inner pouch" and type it, or set a default on the inner pouch in Masters → Packaging. Then the last machine step can count the inner pouches it fills.
- "Line N: set unit price" — Rate is zero. Enter the rate in the row or in "Qty & rate".
- "Line N: pick a size / pick a product master / quantity must be > 0" — Open the line with "Fix →" and fill the missing box.
- "Line N: Open the line to confirm print and packing" — Added through quick-add. Open the line once, check print and packing, press "Done with this line".
- "Artwork: pick an approved artwork." — Printed line without artwork. Choose one, or select "Defer to planner".
- "Artwork: selected artwork does not match the selected print method or SHEET/TUBING form." — Change Roto/Flexo or film form to match, or pick another artwork.
- "Packing: pcs per inner pouch must be greater than zero." — Fix or clear the override.
- "Set a promised dispatch date / Pick a customer / Cart is empty — add at least one line" — Fill the order facts or add a line.
- "Product master unavailable" — A link pointed to a master that is not order-ready (inactive or old version). Pick a current one.
- "Could not create order — product_master is invalid, inactive, or not the current version." — The master changed after you added the line. Remove the line and add it again.
- "Could not create order — Item …: approved artwork is required when printing is enabled." — Server check: assign approved artwork or defer to planner.

**If stuck**
1. Lost work after closing the tab: reopen New order and press "Resume draft" (same browser only).
2. "Place order" stays grey: click the warning pill in the place bar to see what is left.
3. Wrong line removed: press "Undo" in the toast right away.
4. Customer not in the list: add it in Customers, then refresh this page.

Related pages: /sales/orders, /sales/orders/[id], /sales/quotations/new, /sales/customers, /sales/job-names, /dashboard/planner/control-tower/plan-queue, /dashboard/planner/control-tower/stock-launcher

**Not done yet / watch out**
- "Save as quotation" only opens a new quotation for the same customer; the lines typed in the composer are not carried into the quotation.
- Drafts are saved only in the browser's local storage, so a draft started on one PC cannot be resumed on another, and only one draft is kept at a time.
- The composer shows credit days but does not warn or block when a customer is over its credit limit.

### New order (redirect) (/sales/orders/new)
Screen address: /sales/orders/new · Roles: SALES, OWNER, ADMIN, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=sales-orders-new

This is an old or short address. It opens /sales/orders/create straight away.

Old links to /sales/orders/new open the order composer. Any extra settings in the link (such as customer or product master) are carried over.

**Before you start**
- Your role must be allowed to open the target page.

**Step by step**
1. Open the link or bookmark. The browser moves to /sales/orders/create by itself.
2. Update your bookmark to /sales/orders/create so the extra hop is skipped.

**Common problems and fixes**
- "Page keeps loading or shows "not found"" — The order id in the link is wrong or the order was removed. Open the Orders list and search the SO number.

**If stuck**
1. Open "Orders" from the Sales menu and find the order there.

Related pages: /sales/orders/create

### Quotations (/sales/quotations)
Screen address: /sales/quotations · Roles: SALES, OWNER, ADMIN, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=sales-quotations

List of all quotations with status, date and search filters, bulk duplicate and bulk expire, and PDF preview.

Open it to follow up quotes: which are waiting approval, sent, accepted or expired. Open a quote to work on it, or start a new one. An accepted quote is converted to a sales order from its page.

**Before you start**
- Permission sales.manage.

**Step by step**
1. Search "Search by QT number or customer…".
2. Filter by status pill (Draft, Pending approval, Sent, Approved, Accepted, Rejected, Expired, Cancelled, Void, Converted) and "Date" (All time, This month, Last month).
3. Click a row to open the quotation; the eye icon ("Preview PDF") opens the PDF.
4. Tick rows and press "Duplicate" or "Mark expired"; "Clear" removes the selection.
5. Press "New Quotation" to start one.

**What is on the screen**
- **Status**: Draft → Pending approval → Approved → Sent → Accepted/Rejected/Expired → Converted. Cancelled and Void are closed.
- **Valid until · Updated**: Quote validity date and last change.
- **Total**: Grand total of the quote in ₹.

**Common problems and fixes**
- "Duplicate failed / Bulk expire failed" — The server refused for one of the selected quotes (for example already converted). Retry with fewer rows.
- "No quotations match these filters." — Press "Clear filters".

**If stuck**
1. List failed to load: press "Retry".

Related pages: /sales/quotations/new, /sales/quotations/[id], /sales/orders/create

### Quotation workspace (/sales/quotations/[id])
Screen address: /sales/quotations/[id] · Roles: SALES, OWNER, ADMIN, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=sales-quotations-id

One quotation: client context, quote lines, Cost Build, commercials, approval, sending, customer outcome and conversion to a sales order.

Use it to price an enquiry, get it approved, send the frozen PDF and, once the customer accepts, convert it into a sales order for planning.

**Before you start**
- Customer in Customers; current Base Product Master (and LIVE template) for each line; an approver who is not the submitter.

**Step by step**
1. Fill "Client and enquiry context" (contact, email, validity, terms, addresses).
2. Add lines with "Catalog line" (ready product/size) or "Ad-hoc pouch" (quote-only build from a Base Product Master); press "Save line".
3. Open Cost Build, check sources and conversion cost, press "Save Cost Build".
4. Set commercials and terms, then press "Save draft".
5. Press "Submit for approval" — the revision and Cost Build freeze.
6. An approver (not the submitter) presses "Approve …" for each pending gate, or rejects with a reason.
7. When Approved, press "Send frozen revision" → "Send to customer" (needs contact email). Preview, download, print or share the PDF from the header icons.
8. After the customer replies press "Record acceptance" (PO / email reference) or "Record rejection" (reason), or "Mark expired".
9. On an Accepted quote press "Convert to Sales Order" → "Convert". The quote becomes CONVERTED and a new SO goes to planning.

**What is on the screen**
- **Customer / Plant / Currency / Status / Valid until**: Quote header facts shown in the top strip.
- **Client and enquiry context**: Enquiry / RFQ reference, Contact name*, Contact email*, Contact phone, Valid until*, Requested delivery, Place of supply, Payment terms*, Delivery terms*, Bill-to address*, Ship-to address*. Editable only in Draft ("Frozen revision" after).
- **Quote Lines**: "Catalog line" = a ready product/size; "Ad-hoc pouch" = a quote-only configuration built on a Base Product Master. Each line shows Pouch GSM, Weight / pc, Rate ₹/kg, Line total.
- **Cost Build**: Quote-level costing: raw materials (master/FIFO baseline vs quote assumption), Conversion Cost, pricing method; shows Target price, RM cost, Total cost, Contribution, Markup, Gross margin. Press "Save Cost Build".
- **Commercials**: Freight included toggle, other charges (tooling, samples, dies), Subtotal, Discount, Taxable, GST %, Grand total, "Terms preset" and custom terms.
- **Customer panel**: Credit limit, credit days, last order. Outstanding shows "AR not yet wired".
- **Lifecycle**: Created, Sent, Approved, outcome and "Converted → SO…".

**Common problems and fixes**
- "Submission blocked — At least one quote line is required." — Add a line and save before "Submit for approval".
- "Every line needs qty > 0 and rate > 0." — Fix quantity and rate on each line.
- "The quotation submitter cannot approve the same revision." — Another authorised user must approve.
- "Override entry and approval must be performed by different users." — Cost overrides need a second person to approve.
- "Only an unfrozen draft quotation revision can be edited." — After submit the revision is frozen. Use "Duplicate quotation" to make a new draft.
- "Customer acceptance reference is required. / Customer rejection reason is required." — Type the PO / email reference or the reason before "Record outcome".
- "Only an accepted customer quotation revision can be converted." — Record acceptance first; "Convert to Sales Order" shows only for Accepted.
- "The exact approved cost build must be frozen before conversion." — Save and approve the Cost Build before converting.
- "Approval request expired; clone a fresh revision." — Use "Duplicate quotation" and submit again.
- "A converted quotation cannot be cancelled or voided; use the Sales Order cancellation flow." — Cancel the sales order from Sales Orders instead.

**If stuck**
1. Unsure what is next: read the status card (e.g. "Draft ready — Complete Cost Build and submit this revision for approval.").
2. Need to change a frozen quote: "Duplicate quotation" makes a new draft revision.
3. Unsaved changes banner: press "Save draft" before leaving.
4. "Quotation not found.": press "Back to list".

Related pages: /sales/quotations, /sales/orders/[id], /sales/orders, /sales/customers

**Not done yet / watch out**
- The customer panel shows Outstanding as "AR not yet wired", so receivables are not visible while quoting.

### New quotation (/sales/quotations/new)
Screen address: /sales/quotations/new · Roles: SALES, OWNER, ADMIN, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=sales-quotations-new

Start a quotation: pick the customer, then the full quotation workspace opens.

Open it when a customer asks for a price. It is also reached from the order composer ("Save as quotation" or the QT switch), which passes the customer along.

**Before you start**
- Customer exists in Customers.

**Step by step**
1. Under "Start a new quotation", search "Search customer by name or code…" or pick from "Or pick from recent customers".
2. Press "Start quotation".
3. Fill "Client and enquiry context" (contact, email, validity, terms, addresses).
4. Add lines with "Catalog line" (ready product/size) or "Ad-hoc pouch" (quote-only build from a Base Product Master); press "Save line".
5. Open Cost Build, check sources and conversion cost, press "Save Cost Build".
6. Set commercials and terms, then press "Save draft".
7. Press "Submit for approval" — the revision and Cost Build freeze.

**What is on the screen**
- **Customer**: Required to begin; their pricing rules and credit profile load.
- **Client and enquiry context**: Enquiry / RFQ reference, Contact name*, Contact email*, Contact phone, Valid until*, Requested delivery, Place of supply, Payment terms*, Delivery terms*, Bill-to address*, Ship-to address*. Editable only in Draft ("Frozen revision" after).
- **Quote Lines**: "Catalog line" = a ready product/size; "Ad-hoc pouch" = a quote-only configuration built on a Base Product Master. Each line shows Pouch GSM, Weight / pc, Rate ₹/kg, Line total.
- **Cost Build**: Quote-level costing: raw materials (master/FIFO baseline vs quote assumption), Conversion Cost, pricing method; shows Target price, RM cost, Total cost, Contribution, Markup, Gross margin. Press "Save Cost Build".

**Common problems and fixes**
- "Could not create quotation" — Customer not found or no access; pick the customer again.
- "No customers in the system yet." — Press "Open Customer Master" and add one.
- "Submission blocked — At least one quote line is required." — Add a line and save before "Submit for approval".
- "Every line needs qty > 0 and rate > 0." — Fix quantity and rate on each line.

**If stuck**
1. Lines typed in the order composer do not come across; add them again here.
2. Press "Cancel" to leave without creating a quote.

Related pages: /sales/quotations, /sales/quotations/[id], /sales/customers, /sales/orders/create

### Trade Orders (/sales/trade-orders)
Screen address: /sales/trade-orders · Roles: SALES, OWNER, ADMIN, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=sales-trade-orders

Resale orders from stock with no production: granules, film variants and trading goods go straight from the warehouse to dispatch.

Use it when a customer buys material you already hold, not a printed/converted product. Track drafts, confirmed and dispatched trade orders.

**Before you start**
- Active trading goods or sellable inventory materials with stock in a plant.

**Step by step**
1. Read the tiles Draft, Confirmed, Dispatched.
2. Search "Search code, customer or invoice…" and filter by All, Draft, Confirmed, Dispatched, Invoiced, Cancelled.
3. Click an order to open it.
4. Press "New trade order" to create one.

**What is on the screen**
- **Status**: Draft → Confirmed → Dispatched (stock consumed) → Invoiced; or Cancelled.
- **Grand total**: Order value with GST.

**Common problems and fixes**
- "Dispatch stock plant is required for trade orders." — Pick "Dispatch stock plant" in the header.

**If stuck**
1. Order not visible: clear the status filter and search by code.

Related pages: /sales/trade-orders/new, /sales/trade-orders/[id], /master/trading-goods

### Trade order (/sales/trade-orders/[id])
Screen address: /sales/trade-orders/[id] · Roles: SALES, OWNER, ADMIN, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=sales-trade-orders-id

One trade order: line items, totals, notes and the workflow buttons (Edit, Confirm order, Dispatch, Cancel order).

Open it to confirm a draft, dispatch a confirmed order (this takes stock off at the order's plant) or cancel it.

**Before you start**
- A saved trade order.

**Step by step**
1. Check "Line items" (Item, Qty, UOM, Rate, GST %, Total) and "Totals".
2. While Draft, press "Edit" to change lines.
3. Press "Confirm order" (Draft only).
4. When goods leave, press "Dispatch" → "Yes, dispatch". Stock is consumed and this cannot be undone.
5. To drop a Draft or Confirmed order press "Cancel order".

**What is on the screen**
- **Line: item, Qty, UOM, Rate (₹), GST %**: Item search shows only goods with stock in the plant; "Available N" is the stock; description can be overridden.
- **Totals**: Lines, Subtotal, GST, Grand total (live).

**Common problems and fixes**
- "Only ACTIVE trading goods can be used on trade orders. / Only ACTIVE materials flagged sellable can be used on trade orders." — The item was made inactive or not sellable in its master. Pick another or fix the master.
- "Line #N: … — insufficient stock (short X)" — The plant does not have enough stock at dispatch. Reduce qty or move stock first.
- "Only DRAFT trade orders can be edited. / Only CONFIRMED trade orders can be dispatched." — The status has moved on; follow the buttons that are shown.
- "Cannot cancel order in status …" — Dispatched or invoiced orders cannot be cancelled.

**If stuck**
1. Dispatch failed for stock: check stock at the plant, then try again, or cancel and re-create with another plant.

Related pages: /sales/trade-orders, /sales/trade-orders/[id]/edit

**Not done yet / watch out**
- There is no button to move a dispatched trade order to Invoiced, although the list filters by Invoiced.

### Edit trade order (/sales/trade-orders/[id]/edit)
Screen address: /sales/trade-orders/[id]/edit · Roles: SALES, OWNER, ADMIN, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=sales-trade-orders-id-edit

The trade order form opened on an existing Draft order to change header or lines.

Use it to fix a draft before confirming. Only Draft orders can be edited.

**Before you start**
- The order is in Draft.

**Step by step**
1. Change "Customer *", "Dispatch stock plant *", "Order date" or "Notes" if needed.
2. Edit lines: item, Qty (not above "Available"), UOM, Rate (₹), GST %; add or remove lines.
3. Press "Save draft", or "Save & confirm" to confirm at once.

**What is on the screen**
- **Customer ***: Who buys the goods.
- **Dispatch stock plant ***: Controls which items show and where stock is taken from.
- **Order date / Notes**: Date of the order and an internal note.
- **Line: item, Qty, UOM, Rate (₹), GST %**: Item search shows only goods with stock in the plant; "Available N" is the stock; description can be overridden.
- **Totals**: Lines, Subtotal, GST, Grand total (live).

**Common problems and fixes**
- "Dispatch stock plant is required for trade orders." — Pick "Dispatch stock plant" in the header.
- "Add at least one line before confirming." — Add an item line.
- "Trade order line quantity must be greater than zero." — Fix the qty.
- "Only ACTIVE trading goods can be used on trade orders. / Only ACTIVE materials flagged sellable can be used on trade orders." — The item was made inactive or not sellable in its master. Pick another or fix the master.
- "Line #N: … — insufficient stock (short X)" — The plant does not have enough stock at dispatch. Reduce qty or move stock first.
- "Only DRAFT trade orders can be edited. / Only CONFIRMED trade orders can be dispatched." — The status has moved on; follow the buttons that are shown.

**If stuck**
1. Page stays on "Loading…": the order id is wrong; go back to Trade Orders.
2. Press "Cancel" to leave without saving.

Related pages: /sales/trade-orders/[id], /sales/trade-orders

### New trade order (/sales/trade-orders/new)
Screen address: /sales/trade-orders/new · Roles: SALES, OWNER, ADMIN, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=sales-trade-orders-new

Create a resale order from stock. Lines can mix trading goods and sellable inventory materials.

Use it for granules, film or trading goods sold as they are. Pick the plant first; only items with stock there show.

**Before you start**
- Customer in Customers; active trading goods or sellable materials with stock in the chosen plant.

**Step by step**
1. Pick "Customer *" and "Dispatch stock plant *".
2. Set "Order date" and optional "Notes".
3. Press "Add first line", search "Search code, name, form, stock type…", pick the item.
4. Enter Qty (see "Available"), UOM, Rate (₹) and GST %.
5. Check "Totals", then press "Save draft" or "Save & confirm".

**What is on the screen**
- **Customer ***: Who buys the goods.
- **Dispatch stock plant ***: Controls which items show and where stock is taken from.
- **Order date / Notes**: Date of the order and an internal note.
- **Line: item, Qty, UOM, Rate (₹), GST %**: Item search shows only goods with stock in the plant; "Available N" is the stock; description can be overridden.
- **Totals**: Lines, Subtotal, GST, Grand total (live).

**Common problems and fixes**
- "Dispatch stock plant is required for trade orders." — Pick "Dispatch stock plant" in the header.
- "Add at least one line before confirming." — Add an item line.
- "Trade order line quantity must be greater than zero." — Fix the qty.
- "Only ACTIVE trading goods can be used on trade orders. / Only ACTIVE materials flagged sellable can be used on trade orders." — The item was made inactive or not sellable in its master. Pick another or fix the master.
- "Line #N: … — insufficient stock (short X)" — The plant does not have enough stock at dispatch. Reduce qty or move stock first.
- "Only DRAFT trade orders can be edited. / Only CONFIRMED trade orders can be dispatched." — The status has moved on; follow the buttons that are shown.
- "No available stock item found for this plant." — The plant has no stock of that item; pick another plant or item.

**If stuck**
1. Item picker empty: pick the plant first.

Related pages: /sales/trade-orders, /sales/trade-orders/[id], /master/trading-goods

## हर स्क्रीन (हिंदी)

### Sales Command Center (/dashboard/sales)
स्क्रीन का पता: /dashboard/sales · भूमिकाएँ: SALES, ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=dashboard-sales&lang=hi

order की आमद, pipeline, delivery का वादा और customer mix, sales order से live।

Sales staff का पहला पेज। confirm करने बाकी draft, देर वाले order, भेजने को तैयार माल और order की आमद देखने के लिए खोलें। नया order बुक करने के लिए "Create order" या पूरी सूची के लिए "View orders" दबाएँ।

**शुरू करने से पहले**
- customer और product master बने हों; order बुक हों।

**स्टेप बाय स्टेप**
1. ऊपर पढ़ें: "Order value · 30 days", "Open pipeline", "On time in full" (target के मुकाबले) और "Overdue orders"।
2. "Drafts to confirm" पर click करके orders list खोलें और draft confirm करें; draft planner तक नहीं पहुँचते।
3. "Ready to ship" (Dispatch Bay में order) और "Quote conversion" देखें।
4. "Needs attention" (sales desk पर रुका काम) और "Most overdue" पढ़ें।
5. "Order intake · last 30 days" को Weight और Orders के बीच बदलें।
6. "Recent orders" (Order, Customer, Weight, Status, Created) से order खोलें।
7. नया sales order शुरू करने के लिए "Create order" दबाएँ।

**स्क्रीन पर क्या है**
- **Open pipeline**: खुले order का वज़न; नीचे गिनती।
- **On time in full**: पूरे order में से समय पर और पूरा पहुँचे order; target या उससे ऊपर हरा।
- **Overdue orders**: वादा की तारीख़ निकल चुके order।
- **Drafts to confirm**: draft में रखे order, confirm के इंतज़ार में।
- **Order pipeline**: stage के हिसाब से खुले order।
- **Top customers / Products by value · 30 days**: order वज़न से customer; कीमत से product।
- **Monthly target progress**: सिर्फ़ तब दिखता है जब मासिक sales target तय हो।

**आम दिक्कतें और हल**
- "Data unavailable" — sales dashboard feed fail हुई; पेज reload करें।
- "No orders in the last 30 days" — इस समय में कोई order नहीं बना।

**अटक गए तो**
1. विस्तृत sales report के लिए "Fulfillment report" इस्तेमाल करें।

जुड़े पेज: /sales/orders, /sales/orders/create, /sales/quotations, /logistics/dispatch, /analytics/reports/sales

**अभी नहीं होता / ध्यान दें**
- SALES role के sidebar में "Sales Dashboard" छिपा है, जबकि वही उनका पहला पेज है; यह Orders workspace tab से खुलता है।

### Orders (पुराना link) (/orders)
स्क्रीन का पता: /orders · भूमिकाएँ: SALES, OWNER, ADMIN, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=orders&lang=hi

यह पुराना या छोटा पता है। यह सीधे /sales/orders खोल देता है।

पुराना /orders पता Sales Orders खोलता है।

**शुरू करने से पहले**
- आपके role को आगे वाला page खोलने की अनुमति होनी चाहिए।

**स्टेप बाय स्टेप**
1. link या bookmark खोलें। browser अपने-आप /sales/orders पर चला जाता है।
2. अपना bookmark /sales/orders पर बदल लें, ताकि बीच का कदम न लगे।

**आम दिक्कतें और हल**
- "page लोड होता रहता है या "not found" दिखता है" — link में order id गलत है या order हटाया गया है। Orders list खोलकर SO number से search करें।

**अटक गए तो**
1. Sales menu से "Orders" खोलें और वहाँ order ढूँढें।

जुड़े पेज: /sales/orders

### Order (पुराना link) (/orders/[id])
स्क्रीन का पता: /orders/[id] · भूमिकाएँ: SALES, OWNER, ADMIN, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=orders-id&lang=hi

यह पुराना या छोटा पता है। यह सीधे /sales/orders/[id] खोल देता है।

पुराने order links वही order sales order tracker में खोलते हैं।

**शुरू करने से पहले**
- आपके role को आगे वाला page खोलने की अनुमति होनी चाहिए।

**स्टेप बाय स्टेप**
1. link या bookmark खोलें। browser अपने-आप /sales/orders/[id] पर चला जाता है।
2. अपना bookmark /sales/orders/[id] पर बदल लें, ताकि बीच का कदम न लगे।

**आम दिक्कतें और हल**
- "page लोड होता रहता है या "not found" दिखता है" — link में order id गलत है या order हटाया गया है। Orders list खोलकर SO number से search करें।

**अटक गए तो**
1. Sales menu से "Orders" खोलें और वहाँ order ढूँढें।

जुड़े पेज: /sales/orders/[id]

### Order tracking (पुराना link) (/orders/[id]/tracking)
स्क्रीन का पता: /orders/[id]/tracking · भूमिकाएँ: SALES, OWNER, ADMIN, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=orders-id-tracking&lang=hi

यह पुराना या छोटा पता है। यह सीधे /sales/orders/[id] खोल देता है।

पुराने tracking links /sales/orders/[id]/tracking पर जाते हैं, जो फिर /sales/orders/[id] पर एक ही order tracker खोलता है।

**शुरू करने से पहले**
- आपके role को आगे वाला page खोलने की अनुमति होनी चाहिए।

**स्टेप बाय स्टेप**
1. link या bookmark खोलें। browser अपने-आप /sales/orders/[id] पर चला जाता है।
2. अपना bookmark /sales/orders/[id] पर बदल लें, ताकि बीच का कदम न लगे।

**आम दिक्कतें और हल**
- "page लोड होता रहता है या "not found" दिखता है" — link में order id गलत है या order हटाया गया है। Orders list खोलकर SO number से search करें।

**अटक गए तो**
1. Sales menu से "Orders" खोलें और वहाँ order ढूँढें।

जुड़े पेज: /sales/orders/[id], /sales/orders/[id]/tracking

### Create order (पुराना link) (/orders/create)
स्क्रीन का पता: /orders/create · भूमिकाएँ: SALES, OWNER, ADMIN, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=orders-create&lang=hi

यह पुराना या छोटा पता है। यह सीधे /sales/orders/create खोल देता है।

पुराना create पता order composer खोलता है।

**शुरू करने से पहले**
- आपके role को आगे वाला page खोलने की अनुमति होनी चाहिए।

**स्टेप बाय स्टेप**
1. link या bookmark खोलें। browser अपने-आप /sales/orders/create पर चला जाता है।
2. अपना bookmark /sales/orders/create पर बदल लें, ताकि बीच का कदम न लगे।

**आम दिक्कतें और हल**
- "page लोड होता रहता है या "not found" दिखता है" — link में order id गलत है या order हटाया गया है। Orders list खोलकर SO number से search करें।

**अटक गए तो**
1. Sales menu से "Orders" खोलें और वहाँ order ढूँढें।

जुड़े पेज: /sales/orders/create

### Sales (redirect) (/sales)
स्क्रीन का पता: /sales · भूमिकाएँ: SALES, OWNER, ADMIN, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=sales&lang=hi

यह पुराना या छोटा पता है। यह सीधे /sales/orders खोल देता है।

Sales का मुख्य page order list है। /sales खोलने पर आप Sales Orders पर पहुँचते हैं, जहाँ हर खुला order उम्र और stage के हिसाब से दिखता है।

**शुरू करने से पहले**
- आपके role को आगे वाला page खोलने की अनुमति होनी चाहिए।

**स्टेप बाय स्टेप**
1. link या bookmark खोलें। browser अपने-आप /sales/orders पर चला जाता है।
2. अपना bookmark /sales/orders पर बदल लें, ताकि बीच का कदम न लगे।

**आम दिक्कतें और हल**
- "page लोड होता रहता है या "not found" दिखता है" — link में order id गलत है या order हटाया गया है। Orders list खोलकर SO number से search करें।

**अटक गए तो**
1. Sales menu से "Orders" खोलें और वहाँ order ढूँढें।

जुड़े पेज: /sales/orders, /sales/orders/create, /dashboard/sales

### Customers (ग्राहक) (/sales/customers)
स्क्रीन का पता: /sales/customers · भूमिकाएँ: SALES, OWNER, ADMIN, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=sales-customers&lang=hi

ग्राहकों की master list: code, नाम, GST, contact, पता, अतिरिक्त पते, credit की शर्तें और status। Order, quotation और dispatch slip यहीं से जानकारी लेते हैं।

नए ग्राहक का पहला order डालने से पहले, या जब ग्राहक का पता, GST, contact या credit शर्त बदले, यह page खोलें। यहाँ save किया पता order composer में default ship address बनता है और dispatch slip पर छपता है।

**शुरू करने से पहले**
- sales.manage की अनुमति चाहिए। सिर्फ देखने वाले sales users को यह page menu में नहीं दिखता।

**स्टेप बाय स्टेप**
1. "Register New Account" दबाएँ, "Account Registration" form खुलेगा।
2. "Identity Code" (जैसे CUST-001) और "Legal Entity Name" भरें। दोनों ज़रूरी हैं।
3. contact person, email, phone, "Tax Protocol ID (GST)" और "PAN No." भरें।
4. "Primary Mailing Address" वाला हिस्सा भरें (Mailing Name, Primary Address, State, Country, Pincode)।
5. हर अतिरिक्त delivery जगह के लिए "Add Address" दबाएँ (label जैसे "Surat DC", पता, contact, phone)।
6. "Credit Period (Days)", "Credit Limit", TDS/TCS switch और "Status" (Active / Inactive) सेट करें।
7. save करने के लिए "Commit Master Data" दबाएँ। बाद में बदलाव के लिए row पर edit icon दबाएँ ("Modify Account Topology")।

**स्क्रीन पर क्या है**
- **Identity Code**: ग्राहक का छोटा unique code। composer में नाम के साथ और export में दिखता है।
- **Legal Entity Name**: order, quotation और slip पर यही नाम छपता है।
- **Under Group**: accounts group, जैसे Sundry Debtors।
- **Tax Protocol ID (GST) / PAN No.**: GST number composer में ग्राहक के नीचे "GST …" के रूप में दिखता है।
- **Primary Address**: यह billing पता है। अलग shipping पता न हो तो composer इसी को ship address मानता है।
- **Additional Addresses**: अतिरिक्त delivery पते, अपने contact के साथ। खाली rows save पर हट जाती हैं।
- **Credit Period (Days) / Credit Limit**: credit days composer में "N d credit" के रूप में और quotation के customer panel में दिखते हैं। ERP credit के आधार पर order नहीं रोकता।
- **TDS Deductable / TCS Deductable**: अगर इस ग्राहक के ledger पर tax कटता / वसूला जाता है तो switch चालू करें।
- **Status**: Active या Inactive। पुराने ग्राहक को delete करने के बजाय Inactive रखें।
- **Table की columns**: Client Code, Corporate Entity, Tax Identity, Account Status, Credit Exposure, Address Book, साथ में edit और delete icon। search box नाम से छाँटता है।

**आम दिक्कतें और हल**
- "Code is required / Name is required" — "Identity Code" और "Legal Entity Name" के बिना form save नहीं होता। दोनों भरें।
- "Invalid email" — email वाले खाने (मुख्य और हर अतिरिक्त पते में) सही email हों या खाली छोड़ें।
- "save या delete के बाद "Error" toast" — server ने मना किया, अक्सर code पहले से मौजूद होने या ग्राहक के orders में इस्तेमाल होने से। code बदलें, या delete के बजाय Status Inactive करें।

**अटक गए तो**
1. अगर नया ग्राहक composer में नहीं दिख रहा, composer page refresh करें; ग्राहक list करीब एक मिनट cache रहती है।
2. form में अधूरे बदलाव हटाने के लिए "Reset" दबाएँ।
3. delete से पहले पुष्टि माँगी जाती है ("Protocol Purge Warning" → "Execute Purge"); रुकने के लिए "Abort Operation" दबाएँ।

जुड़े पेज: /sales/orders/create, /sales/quotations/new, /sales/orders

**अभी नहीं होता / ध्यान दें**
- customer form में अलग shipping पते का खाना नहीं है; composer billing पता लेता है, और अतिरिक्त पते composer में ship-to विकल्प के रूप में नहीं आते।
- page पर अजीब labels हैं ("Legal Entity Name", "Commit Master Data", "Execute Purge") और delete के संदेश में नहीं बताया कि orders वाला ग्राहक हट सकता है या नहीं।

### Job names (/sales/job-names)
स्क्रीन का पता: /sales/job-names · भूमिकाएँ: SALES, OWNER, ADMIN, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=sales-job-names&lang=hi

order डालते समय लिखे गए job name के हिसाब से orders का समूह, साथ में ordered, dispatched और open kg और समय पर पूरे होने का %।

जब पूछना हो कि "ABC May job का कितना माल बाकी है?" या एक job के सारे orders ढूँढने हों, तब इसे खोलें। job name पर click करने से उसी नाम से छँटी order list खुलती है।

**शुरू करने से पहले**
- order composer में "Job name" के साथ डाले गए orders। बिना नाम वाले orders unnamed गिने जाते हैं।

**स्टेप बाय स्टेप**
1. ऊपर के tiles देखें: "Job names", "Orders with a job name" (%), "Ordered", "Dispatched", "Open"।
2. "Search job name or customer" में लिखकर table छोटी करें।
3. "Sort" चुनें: Open kg, Ordered kg, Orders या Last ordered।
4. job name पर click करें, उसी नाम से छँटे Sales Orders खुलेंगे।
5. नया order शुरू करने के लिए "New order" दबाएँ (वहाँ job name लिखें)।

**स्क्रीन पर क्या है**
- **Job name**: composer में लिखा नाम, नीचे lines की गिनती।
- **Orders**: इस नाम वाले orders; "N open" वे हैं जो completed या cancelled नहीं।
- **Customers**: जिन ग्राहकों के orders में यह नाम है।
- **Ordered**: कुल ordered kg (और pcs)। cancelled lines नहीं गिनी जातीं।
- **Dispatched / Open kg**: ordered के सामने dispatched की पट्टी; Open kg = ordered माइनस dispatched।
- **On time**: पूरे हुए orders में से कितने % वादे की तारीख तक पूरे हुए। "—" मतलब अभी कोई पूरा नहीं।
- **Last order**: इस नाम के सबसे नए order की तारीख।

**आम दिक्कतें और हल**
- "Could not load job names. Refresh to try again." — report लोड नहीं हुई (network या server)। page refresh करें।
- "No job names yet." — किसी order में job name नहीं है। order डालते समय composer के "Job name" खाने में नाम लिखें।

**अटक गए तो**
1. कोई job नहीं दिख रहा: order में लिखी सही spelling देखें; नाम जैसे लिखे गए वैसे ही समूह बनते हैं।
2. पुराने orders जिनमें सिर्फ अपने-आप बना नाम जैसे "Order 2026-05-01" था, job name में नहीं दिखते।

जुड़े पेज: /sales/orders, /sales/orders/create

**अभी नहीं होता / ध्यान दें**
- job names जैसे लिखे वैसे ही समूह बनते हैं, इसलिए spelling फर्क से अलग rows बनती हैं; नाम बदलने या जोड़ने का तरीका नहीं है।

### Sales Orders (/sales/orders)
स्क्रीन का पता: /sales/orders · भूमिकाएँ: SALES, OWNER, ADMIN, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=sales-orders&lang=hi

हर खुला sales order उम्र और stage के हिसाब से; filter, saved view, CSV export और planner release से पहले cancel की सुविधा।

दिन की शुरुआत यहीं से करें: planning के इंतज़ार वाले orders, 5 दिन से पुराने orders (लाल रंग में) और क्या ready या dispatch हुआ, यह देखें। order खोलकर उसका tracker देखें या नया order बनाएँ।

**शुरू करने से पहले**
- order composer से डाले गए या quotation से convert हुए orders।

**स्टेप बाय स्टेप**
1. tiles देखें: "Open", "Awaiting planning", "Aged 6+ days", "Created today", "Value in flight", "Avg age"।
2. "Search SO #, customer, product master, variant…" में खोजें या status pill (Planning, Planned, Released, Packing, Dispatch) या उम्र pill (Fresh 0-2d, Watch 3-5d, Aged 6+d) दबाएँ।
3. "Any customer", "Any master" और "Advanced" (product type POUCH/ROLL/POD/PACKAGING, size, pouch style) से और छाँटें।
4. table का tab बदलें: "Order queue", "History" या "Cancelled"।
5. order खोलने के लिए row या उसका open icon ("Open order tracker") दबाएँ।
6. filter बचाने के लिए उसे view के रूप में save करें ("Name this saved view" पूछा जाएगा)। views इसी browser में रहते हैं।
7. rows पर tick करके "Export" से CSV लें, या सारी दिखती rows के लिए "Export · N" दबाएँ।
8. cancel करने के लिए row पर cancel icon दबाएँ, "Full order" या चुनी lines चुनें, कारण चुनें, note लिखें और पुष्टि करें।
9. order composer खोलने के लिए "New order" दबाएँ।

**स्क्रीन पर क्या है**
- **Customer · Order #**: ग्राहक का नाम और SO number; job name हो तो number के पास दिखता है।
- **Product · size · layers**: product master, mm में size, layer chips, print रंग (F/B) और artwork का छोटा चित्र।
- **Placed · age**: order की तारीख और दिनों में उम्र। 6+ दिन लाल।
- **Qty · progress**: ordered qty और हर line के ready, dispatched, WIP और open kg की पट्टी ("Line-wise fulfillment")।
- **Status pills**: Planning = planner के इंतज़ार में; Planned; Released = floor पर; Packing; Dispatch।
- **Flow filter**: "All flow", "Ready" (तैयार माल रखा है), "Dispatched"।
- **Cancel के कारण**: Customer cancelled, Spec error, Credit hold, Duplicate, Other।
- **Showing the N newest of M open orders**: सिर्फ नए orders लोड होते हैं; पुराने orders के लिए search करें।

**आम दिक्कतें और हल**
- "किसी order पर cancel icon नहीं है" — Sales सिर्फ Draft, Confirmed, Planning या Planned orders cancel कर सकता है। planner ने lines release कर दी हों तो planner से cancel या short-close करवाएँ।
- "Could not cancel order — Released orders must be changed from Planner, not Sales." — dialog खुला रहते line release हो गई। Planner से करें।
- "Order already has released, executing, paused, or completed production jobs and cannot be cancelled from Sales." — order पर production शुरू हो चुका है। बाकी को Planner से short-close करें।
- "Reason is required to cancel sales order lines." — पुष्टि से पहले कारण (और note) चुनें।
- "Select at least one sales order line to cancel." — line वाले विकल्प में कम से कम एक line पर tick करें।

**अटक गए तो**
1. order list में नहीं: filters हटाएँ ("Reset"), "History" और "Cancelled" tab देखें, फिर SO number search करें।
2. saved views गायब: वे सिर्फ इसी browser में रहते हैं; दोबारा save करें।

जुड़े पेज: /sales/orders/create, /sales/orders/[id], /sales/job-names, /master/products, /dashboard/planner/control-tower/plan-queue

**अभी नहीं होता / ध्यान दें**
- saved views browser में रहते हैं, user account में नहीं, इसलिए दूसरे PC पर नहीं मिलते।
- list में सिर्फ नए खुले orders लोड होते हैं; पुराने orders सिर्फ search से मिलते हैं।

### Sales order tracker (/sales/orders/[id])
स्क्रीन का पता: /sales/orders/[id] · भूमिकाएँ: SALES, OWNER, ADMIN, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=sales-orders-id&lang=hi

हर order का एक page: lines, route पर चल रहा काम, technical spec और BOM, documents, dispatch slips और material audit व timeline।

जब ग्राहक पूछे "मेरा order कहाँ है?" या तारीख बताने से पहले, यह page खोलें। इसमें दिखता है कितना ready है, कितना dispatch हुआ, कितना WIP में है और कितना बाकी, और हर line floor पर कहाँ है।

**शुरू करने से पहले**
- डाला गया sales order (composer से या convert हुई quotation से)।

**स्टेप बाय स्टेप**
1. ऊपर की spine देखें: Master → Quote → Order → Plan → Floor → Yard → Dispatch। हर station अपनी स्थिति दिखाता है और उससे जुड़ा page खोलता है।
2. header देखें: SO number, job name, status, "Placed" और "Due" तारीख, line chips और "Fulfillment truth" में % complete।
3. अगर order अभी Draft है तो "Confirm commercial" दबाएँ।
4. "Commercial head" खोलकर bill to, ship to, payment/delivery terms और client note ("note prints on slip") देखें।
5. Tab "Line items + live route": हर line का ordered / ready / WIP / dispatched / open / scrap और हर route step।
6. Tab "Technical + BOM": हर line का size, layers, print, packing और frozen BOM rows।
7. Tab "Documents": "Dispatch ledger", "New dispatch" और "Slips in Dispatch Bay · reprint, proof of delivery"।
8. Tab "Material audit + timeline": target, output, WIP, consumed, scrap, mass gap और हर घटना।

**स्क्रीन पर क्या है**
- **Ordered / Ready (FG) / Dispatched / WIP / Scrap / Open**: order का कुल kg। Ready = बना पर dispatch नहीं; WIP = सिर्फ चल रहा route काम; Open = target − ready − dispatched − WIP।
- **% complete**: (Ready + dispatched) ÷ ordered।
- **Status badge**: order की स्थिति, जैसे Planning, Released, Packing, Dispatch, Completed।
- **Commercial head**: Bill to, Ship to, Payment terms, Delivery terms, Client note।
- **Line technical facts**: width, height, gusset या roll web mm में (inch भी), unit weight, pcs/kg, inner pack, pcs/pack, POD।
- **Order mass balance**: Ordered target → Final output + Ready FG + Dispatched + Live WIP + Open gap।
- **refreshing**: tracking हर मिनट अपने-आप ताज़ा होता है।

**आम दिक्कतें और हल**
- "Sales order not found" — गलत link या अनुमति नहीं। "Go back" दबाएँ और list से order खोलें।
- "Order cannot be confirmed from status …" — "Confirm commercial" सिर्फ Draft order पर चलता है; order आगे बढ़ चुका है।
- "No layer/BOM snapshot on this line." — line बिना frozen BOM के save हुई। release से पहले planner से line जाँचवाएँ।

**अटक गए तो**
1. आँकड़े पुराने लगें: refresh का इंतज़ार करें या page reload करें।
2. release हुई line cancel या short-close करनी हो तो Planner पर जाएँ; इस page पर cancel button नहीं है।
3. slip दोबारा छापने या proof of delivery के लिए "Documents" में Dispatch Bay link इस्तेमाल करें।

जुड़े पेज: /sales/orders, /sales/orders/[id]/dispatches, /sales/orders/[id]/dispatches/new, /logistics/dispatch, /logistics/packing, /dashboard/planner/control-tower/command, /production/work-center

**अभी नहीं होता / ध्यान दें**
- order tracker पर edit, cancel या short-close का button नहीं है; cancel सिर्फ Sales Orders list में (release से पहले) और short-close सिर्फ Planner में है।
- डाले गए order की lines, rate या तारीख Sales से नहीं बदल सकते; order बदलने का कोई screen नहीं है।

### Order tracking (redirect) (/sales/orders/[id]/tracking)
स्क्रीन का पता: /sales/orders/[id]/tracking · भूमिकाएँ: SALES, OWNER, ADMIN, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=sales-orders-id-tracking&lang=hi

यह पुराना या छोटा पता है। यह सीधे /sales/orders/[id] खोल देता है।

पहले tracking अलग page था। अब यह एक ही order tracker में है, इसलिए यह पता "Opening unified order tracker..." दिखाकर order page पर ले जाता है।

**शुरू करने से पहले**
- आपके role को आगे वाला page खोलने की अनुमति होनी चाहिए।

**स्टेप बाय स्टेप**
1. link या bookmark खोलें। browser अपने-आप /sales/orders/[id] पर चला जाता है।
2. अपना bookmark /sales/orders/[id] पर बदल लें, ताकि बीच का कदम न लगे।

**आम दिक्कतें और हल**
- "page लोड होता रहता है या "not found" दिखता है" — link में order id गलत है या order हटाया गया है। Orders list खोलकर SO number से search करें।

**अटक गए तो**
1. Sales menu से "Orders" खोलें और वहाँ order ढूँढें।

जुड़े पेज: /sales/orders/[id], /sales/orders

### New order (नया order) (/sales/orders/create)
स्क्रीन का पता: /sales/orders/create · भूमिकाएँ: SALES, OWNER, ADMIN, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=sales-orders-create&lang=hi

sales order composer: ग्राहक चुनें, order की जानकारी भरें, Product Master से lines जोड़ें (size, layers, print, packing, qty, rate) और order planner को भेजें।

जब भी ग्राहक order दे, यह page खोलें। order डालते ही वह planning queue में जाता है; planner plant चुनता है और हर line release करता है। draft इसी browser में अपने-आप save होता है।

**शुरू करने से पहले**
- ग्राहक Customers में मौजूद हो (active)।
- order के लिए तैयार Product Master, saved sizes के साथ; printed item के लिए approved artwork (या "Defer to planner" चुनें)।
- order बनाने की अनुमति (page.sales.order_create)।

**स्टेप बाय स्टेप**
1. "Who is this order for?" का जवाब दें: 2 अक्षर लिखें, ↑/↓ और Enter से चुनें, "Recent" ग्राहक दबाएँ, या पूरी list से चुनें। पुराना draft दिखे तो "Resume draft" या "Start fresh" चुनें।
2. order facts वाली row में "Ship to", "Promised dispatch", "Job name" (ज़रूरी नहीं), "Ship address" और "Note for dispatch" भरें। "Plant" "Auto · planner" ही रहता है।
3. quick-add row में line जोड़ें: product (⌘K) → size → qty → unit → rate → Enter। पूरा editor चाहिए तो "Editor" / Shift+Enter, या "Add line" (Alt N) दबाएँ। "Quick Start" cards से पिछला order या saved items दोहराएँ।
4. line खोलें (row पर Enter) और steps भरें: Product, Size, Layers, "Qty & rate", "Print & artwork", "Packing", "Add-ons", "More options"। फिर "Done with this line" या "Save & add another" दबाएँ।
5. हर row का status देखें ("Ready" या पहली कमी, जैसे "Needs rate", "Needs artwork", "Check the line")।
6. "Before you place" खोलें और हर कमी पर "Fix →" दबाएँ, जब तक "all clear" न दिखे।
7. "Place order" (⌘↵) दबाएँ। सारी lines तैयार होने पर ही button चालू होता है।
8. "Sales order sent to planner" दिखने पर "Open order", "Open in planner", "New order for …" या "New order" चुनें।

**स्क्रीन पर क्या है**
- **Customer**: bill-to ग्राहक। बदलने के लिए click करें। नीचे code, GST, credit days और "price basis kg by default" दिखता है।
- **Ship to**: "Same as customer" या माल लेने वाला कोई दूसरा ग्राहक।
- **Promised dispatch**: ग्राहक को बताई तारीख, "in N days" के साथ। default 7 दिन बाद। ज़रूरी।
- **Plant**: "Auto · planner" — planning के समय चुना जाता है।
- **Job name**: ज़रूरी नहीं, जैसे "ABC May order"; हर जगह SO number के पास दिखता है और Job names page पर orders को समूह में रखता है।
- **Ship address**: खाली = saved पता ("Saved · …" दिखता है)। सिर्फ इस order के लिए बदलना हो तो लिखें।
- **Note for dispatch**: ग्राहक की बात, जैसे delivery का समय; order page पर दिखती है और dispatch slip पर छपती है।
- **Lines table**: Product · line label, Size (mm और inch), Layers · gauge, Print (Roto/Flexo, रंग, "artwork later" या "Plain"), Qty, Rate, Value, Status। totals row: lines, kg + pcs, ₹।
- **Row keys**: Enter खोलता है, D duplicate, Alt ↑/↓ ऊपर-नीचे, Delete हटाता है (toast में Undo)।
- **Quick-add unit**: pouch product pcs में, बाकी kg में शुरू होते हैं। rate उसी unit के हिसाब से।
- **Check the line**: quick-add से जोड़ा printed या pouch product एक बार खोलकर print और packing पक्का करना होता है।
- **Print & artwork**: Roto या Flexo, film form, और artwork तरीका: "Pick approved artwork", "Use customer overlay" या "Defer to planner" (print release से पहले planner को artwork देना होगा; cylinder सिर्फ ROTO पर जाँचा जाता है)।
- **Packing**: inner pouch, "Pieces per inner pouch" (बदलाव) और "Packing note"। Inner pouch packing पर tick नहीं होते: घर के inner pouch मशीन के आखिरी pouching step पर stock से घटते हैं, खरीदे हुए शाम की packing गिनती से।
- **More options**: lane, add-ons और wastage: production lane (n-up), trim, wastage / issue policy कारण के साथ।
- **Draft saved hh:mm**: लिखते समय draft इसी browser में save होता है। order डालने पर हट जाता है।
- **Make for stock / Save as quotation**: दूसरे रास्ते: planner का stock launcher, या इस ग्राहक के लिए नई quotation।

**आम दिक्कतें और हल**
- "Packing: set pieces per inner pouch (this inner pouch has no default)." — पाउच लाइन में inner pouch है पर एक inner pouch में कितने पाउच जाते हैं यह नहीं लिखा। लाइन खोलें → Packing → "Pieces per inner pouch" भरें, या Masters → Packaging में उस inner pouch का default भरें। तब आखिरी मशीन स्टेप भरे गए inner pouch गिन सकेगा।
- "Line N: set unit price" — rate शून्य है। row में या "Qty & rate" में rate भरें।
- "Line N: pick a size / pick a product master / quantity must be > 0" — "Fix →" से line खोलें और खाली खाना भरें।
- "Line N: Open the line to confirm print and packing" — quick-add से जुड़ी। line एक बार खोलें, print और packing देखें, "Done with this line" दबाएँ।
- "Artwork: pick an approved artwork." — printed line बिना artwork। artwork चुनें, या "Defer to planner" चुनें।
- "Artwork: selected artwork does not match the selected print method or SHEET/TUBING form." — Roto/Flexo या film form मिलाएँ, या दूसरा artwork चुनें।
- "Packing: pcs per inner pouch must be greater than zero." — override ठीक करें या खाली करें।
- "Set a promised dispatch date / Pick a customer / Cart is empty — add at least one line" — order की जानकारी भरें या line जोड़ें।
- "Product master unavailable" — link ऐसे master का था जो order के लिए तैयार नहीं (inactive या पुराना version)। नया वाला चुनें।
- "Could not create order — product_master is invalid, inactive, or not the current version." — line जोड़ने के बाद master बदला। line हटाकर दोबारा जोड़ें।
- "Could not create order — Item …: approved artwork is required when printing is enabled." — server की जाँच: approved artwork दें या planner पर छोड़ें।

**अटक गए तो**
1. tab बंद होने से काम खोया: New order फिर खोलें और "Resume draft" दबाएँ (सिर्फ उसी browser में)।
2. "Place order" grey रहे: place bar में चेतावनी pill दबाकर बाकी कमी देखें।
3. गलत line हट गई: toast में तुरंत "Undo" दबाएँ।
4. ग्राहक list में नहीं: Customers में जोड़ें, फिर यह page refresh करें।

जुड़े पेज: /sales/orders, /sales/orders/[id], /sales/quotations/new, /sales/customers, /sales/job-names, /dashboard/planner/control-tower/plan-queue, /dashboard/planner/control-tower/stock-launcher

**अभी नहीं होता / ध्यान दें**
- "Save as quotation" सिर्फ उसी ग्राहक के लिए नई quotation खोलता है; composer में भरी lines quotation में नहीं जातीं।
- draft सिर्फ browser की local storage में save होता है, इसलिए एक PC पर शुरू draft दूसरे PC पर नहीं खुलता, और एक समय में एक ही draft रहता है।
- composer credit days दिखाता है पर credit limit पार होने पर न चेतावनी देता है न रोकता है।

### New order (redirect) (/sales/orders/new)
स्क्रीन का पता: /sales/orders/new · भूमिकाएँ: SALES, OWNER, ADMIN, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=sales-orders-new&lang=hi

यह पुराना या छोटा पता है। यह सीधे /sales/orders/create खोल देता है।

/sales/orders/new वाले पुराने links order composer खोलते हैं। link में दी जानकारी (जैसे customer या product master) साथ चली जाती है।

**शुरू करने से पहले**
- आपके role को आगे वाला page खोलने की अनुमति होनी चाहिए।

**स्टेप बाय स्टेप**
1. link या bookmark खोलें। browser अपने-आप /sales/orders/create पर चला जाता है।
2. अपना bookmark /sales/orders/create पर बदल लें, ताकि बीच का कदम न लगे।

**आम दिक्कतें और हल**
- "page लोड होता रहता है या "not found" दिखता है" — link में order id गलत है या order हटाया गया है। Orders list खोलकर SO number से search करें।

**अटक गए तो**
1. Sales menu से "Orders" खोलें और वहाँ order ढूँढें।

जुड़े पेज: /sales/orders/create

### Quotations (/sales/quotations)
स्क्रीन का पता: /sales/quotations · भूमिकाएँ: SALES, OWNER, ADMIN, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=sales-quotations&lang=hi

सभी quotations की list: status, तारीख और search filter, एक साथ duplicate या expire, और PDF preview।

quotes की follow-up के लिए खोलें: कौन approval में है, भेजी गई, accept हुई या expire। quote खोलकर उस पर काम करें, या नई बनाएँ। accept हुई quote उसके page से sales order में convert होती है।

**शुरू करने से पहले**
- sales.manage की अनुमति।

**स्टेप बाय स्टेप**
1. "Search by QT number or customer…" में खोजें।
2. status pill (Draft, Pending approval, Sent, Approved, Accepted, Rejected, Expired, Cancelled, Void, Converted) और "Date" (All time, This month, Last month) से छाँटें।
3. quotation खोलने के लिए row दबाएँ; eye icon ("Preview PDF") PDF खोलता है।
4. rows पर tick करके "Duplicate" या "Mark expired" दबाएँ; "Clear" selection हटाता है।
5. नई quote के लिए "New Quotation" दबाएँ।

**स्क्रीन पर क्या है**
- **Status**: Draft → Pending approval → Approved → Sent → Accepted/Rejected/Expired → Converted। Cancelled और Void बंद हैं।
- **Valid until · Updated**: quote की वैधता तारीख और आखिरी बदलाव।
- **Total**: quote का कुल ₹।

**आम दिक्कतें और हल**
- "Duplicate failed / Bulk expire failed" — चुनी quotes में से किसी पर server ने मना किया (जैसे पहले से converted)। कम rows के साथ फिर करें।
- "No quotations match these filters." — "Clear filters" दबाएँ।

**अटक गए तो**
1. list लोड नहीं हुई: "Retry" दबाएँ।

जुड़े पेज: /sales/quotations/new, /sales/quotations/[id], /sales/orders/create

### Quotation workspace (/sales/quotations/[id])
स्क्रीन का पता: /sales/quotations/[id] · भूमिकाएँ: SALES, OWNER, ADMIN, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=sales-quotations-id&lang=hi

एक quotation: ग्राहक की जानकारी, quote lines, Cost Build, commercials, approval, भेजना, ग्राहक का जवाब और sales order में convert।

enquiry का भाव बनाने, approve करवाने, frozen PDF भेजने और ग्राहक के accept करने पर planning के लिए sales order बनाने में इस्तेमाल करें।

**शुरू करने से पहले**
- ग्राहक Customers में; हर line के लिए current Base Product Master (और LIVE template); submit करने वाले से अलग approver।

**स्टेप बाय स्टेप**
1. "Client and enquiry context" भरें (contact, email, validity, terms, पते)।
2. "Catalog line" (तैयार product/size) या "Ad-hoc pouch" (Base Product Master से सिर्फ इस quote की बनावट) से lines जोड़ें; "Save line" दबाएँ।
3. Cost Build खोलें, sources और conversion cost देखें, "Save Cost Build" दबाएँ।
4. commercials और शर्तें भरें, फिर "Save draft" दबाएँ।
5. "Submit for approval" दबाएँ — revision और Cost Build freeze हो जाते हैं।
6. approver (submit करने वाला नहीं) हर pending gate पर "Approve …" दबाता है, या कारण के साथ reject करता है।
7. Approved होने पर "Send frozen revision" → "Send to customer" दबाएँ (contact email चाहिए)। header icons से PDF देखें, download, print या share करें।
8. ग्राहक के जवाब के बाद "Record acceptance" (PO / email reference) या "Record rejection" (कारण), या "Mark expired" दबाएँ।
9. Accepted quote पर "Convert to Sales Order" → "Convert" दबाएँ। quote CONVERTED हो जाती है और नया SO planning में जाता है।

**स्क्रीन पर क्या है**
- **Customer / Plant / Currency / Status / Valid until**: ऊपर की पट्टी में quote की मुख्य जानकारी।
- **Client and enquiry context**: Enquiry / RFQ reference, Contact name*, Contact email*, Contact phone, Valid until*, Requested delivery, Place of supply, Payment terms*, Delivery terms*, Bill-to address*, Ship-to address*। सिर्फ Draft में बदल सकते हैं (उसके बाद "Frozen revision")।
- **Quote Lines**: "Catalog line" = तैयार product/size; "Ad-hoc pouch" = Base Product Master पर बनी सिर्फ इस quote की configuration। हर line में Pouch GSM, Weight / pc, Rate ₹/kg, Line total दिखता है।
- **Cost Build**: quote स्तर की costing: raw material (master/FIFO baseline बनाम quote अनुमान), Conversion Cost, pricing method; Target price, RM cost, Total cost, Contribution, Markup, Gross margin दिखाता है। "Save Cost Build" दबाएँ।
- **Commercials**: freight शामिल toggle, अन्य charges (tooling, samples, dies), Subtotal, Discount, Taxable, GST %, Grand total, "Terms preset" और अपनी शर्तें।
- **Customer panel**: Credit limit, credit days, last order। Outstanding में "AR not yet wired" दिखता है।
- **Lifecycle**: Created, Sent, Approved, नतीजा और "Converted → SO…"।

**आम दिक्कतें और हल**
- "Submission blocked — At least one quote line is required." — "Submit for approval" से पहले line जोड़कर save करें।
- "Every line needs qty > 0 and rate > 0." — हर line की quantity और rate ठीक करें।
- "The quotation submitter cannot approve the same revision." — किसी दूसरे अधिकृत user को approve करना होगा।
- "Override entry and approval must be performed by different users." — cost override के लिए दूसरा व्यक्ति approve करे।
- "Only an unfrozen draft quotation revision can be edited." — submit के बाद revision freeze हो जाता है। नया draft बनाने के लिए "Duplicate quotation" दबाएँ।
- "Customer acceptance reference is required. / Customer rejection reason is required." — "Record outcome" से पहले PO / email reference या कारण लिखें।
- "Only an accepted customer quotation revision can be converted." — पहले acceptance दर्ज करें; "Convert to Sales Order" सिर्फ Accepted पर दिखता है।
- "The exact approved cost build must be frozen before conversion." — convert से पहले Cost Build save और approve करें।
- "Approval request expired; clone a fresh revision." — "Duplicate quotation" से नई बनाकर फिर submit करें।
- "A converted quotation cannot be cancelled or voided; use the Sales Order cancellation flow." — इसके बजाय Sales Orders से order cancel करें।

**अटक गए तो**
1. आगे क्या करना है पता न हो: status card पढ़ें (जैसे "Draft ready — Complete Cost Build and submit this revision for approval.")।
2. freeze quote बदलनी हो: "Duplicate quotation" नया draft बनाता है।
3. "Unsaved changes" दिखे: जाने से पहले "Save draft" दबाएँ।
4. "Quotation not found.": "Back to list" दबाएँ।

जुड़े पेज: /sales/quotations, /sales/orders/[id], /sales/orders, /sales/customers

**अभी नहीं होता / ध्यान दें**
- customer panel में Outstanding "AR not yet wired" दिखाता है, इसलिए quote बनाते समय बकाया नहीं दिखता।

### New quotation (/sales/quotations/new)
स्क्रीन का पता: /sales/quotations/new · भूमिकाएँ: SALES, OWNER, ADMIN, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=sales-quotations-new&lang=hi

quotation शुरू करें: ग्राहक चुनें, फिर पूरा quotation workspace खुलता है।

जब ग्राहक भाव माँगे तब खोलें। order composer के "Save as quotation" या QT switch से भी यहाँ आते हैं, ग्राहक साथ आता है।

**शुरू करने से पहले**
- ग्राहक Customers में हो।

**स्टेप बाय स्टेप**
1. "Start a new quotation" में "Search customer by name or code…" से खोजें या "Or pick from recent customers" से चुनें।
2. "Start quotation" दबाएँ।
3. "Client and enquiry context" भरें (contact, email, validity, terms, पते)।
4. "Catalog line" (तैयार product/size) या "Ad-hoc pouch" (Base Product Master से सिर्फ इस quote की बनावट) से lines जोड़ें; "Save line" दबाएँ।
5. Cost Build खोलें, sources और conversion cost देखें, "Save Cost Build" दबाएँ।
6. commercials और शर्तें भरें, फिर "Save draft" दबाएँ।
7. "Submit for approval" दबाएँ — revision और Cost Build freeze हो जाते हैं।

**स्क्रीन पर क्या है**
- **Customer**: शुरू करने के लिए ज़रूरी; उनके भाव नियम और credit जानकारी आती है।
- **Client and enquiry context**: Enquiry / RFQ reference, Contact name*, Contact email*, Contact phone, Valid until*, Requested delivery, Place of supply, Payment terms*, Delivery terms*, Bill-to address*, Ship-to address*। सिर्फ Draft में बदल सकते हैं (उसके बाद "Frozen revision")।
- **Quote Lines**: "Catalog line" = तैयार product/size; "Ad-hoc pouch" = Base Product Master पर बनी सिर्फ इस quote की configuration। हर line में Pouch GSM, Weight / pc, Rate ₹/kg, Line total दिखता है।
- **Cost Build**: quote स्तर की costing: raw material (master/FIFO baseline बनाम quote अनुमान), Conversion Cost, pricing method; Target price, RM cost, Total cost, Contribution, Markup, Gross margin दिखाता है। "Save Cost Build" दबाएँ।

**आम दिक्कतें और हल**
- "Could not create quotation" — ग्राहक नहीं मिला या अनुमति नहीं; ग्राहक फिर चुनें।
- "No customers in the system yet." — "Open Customer Master" दबाकर ग्राहक जोड़ें।
- "Submission blocked — At least one quote line is required." — "Submit for approval" से पहले line जोड़कर save करें।
- "Every line needs qty > 0 and rate > 0." — हर line की quantity और rate ठीक करें।

**अटक गए तो**
1. order composer में भरी lines यहाँ नहीं आतीं; यहाँ फिर से जोड़ें।
2. quote बनाए बिना निकलने के लिए "Cancel" दबाएँ।

जुड़े पेज: /sales/quotations, /sales/quotations/[id], /sales/customers, /sales/orders/create

### Trade Orders (/sales/trade-orders)
स्क्रीन का पता: /sales/trade-orders · भूमिकाएँ: SALES, OWNER, ADMIN, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=sales-trade-orders&lang=hi

बिना production के stock से बिक्री के orders: granules, film variants और trading goods सीधे godown से dispatch।

जब ग्राहक ऐसा माल ले जो पहले से stock में है (printed/बना product नहीं), तब इस्तेमाल करें। draft, confirmed और dispatched trade orders देखें।

**शुरू करने से पहले**
- active trading goods या sellable inventory materials, किसी plant में stock के साथ।

**स्टेप बाय स्टेप**
1. Draft, Confirmed, Dispatched tiles देखें।
2. "Search code, customer or invoice…" से खोजें और All, Draft, Confirmed, Dispatched, Invoiced, Cancelled से छाँटें।
3. order खोलने के लिए उस पर click करें।
4. नया बनाने के लिए "New trade order" दबाएँ।

**स्क्रीन पर क्या है**
- **Status**: Draft → Confirmed → Dispatched (stock घटा) → Invoiced; या Cancelled।
- **Grand total**: GST के साथ order की कीमत।

**आम दिक्कतें और हल**
- "Dispatch stock plant is required for trade orders." — header में "Dispatch stock plant" चुनें।

**अटक गए तो**
1. order नहीं दिख रहा: status filter हटाएँ और code से खोजें।

जुड़े पेज: /sales/trade-orders/new, /sales/trade-orders/[id], /master/trading-goods

### Trade order (/sales/trade-orders/[id])
स्क्रीन का पता: /sales/trade-orders/[id] · भूमिकाएँ: SALES, OWNER, ADMIN, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=sales-trade-orders-id&lang=hi

एक trade order: line items, totals, notes और काम के buttons (Edit, Confirm order, Dispatch, Cancel order)।

draft confirm करने, confirmed order dispatch करने (इससे order के plant से stock घटता है) या cancel करने के लिए खोलें।

**शुरू करने से पहले**
- save हुआ trade order।

**स्टेप बाय स्टेप**
1. "Line items" (Item, Qty, UOM, Rate, GST %, Total) और "Totals" देखें।
2. Draft रहते lines बदलने के लिए "Edit" दबाएँ।
3. "Confirm order" दबाएँ (सिर्फ Draft)।
4. माल जाने पर "Dispatch" → "Yes, dispatch" दबाएँ। stock घटता है और यह वापस नहीं होता।
5. Draft या Confirmed order हटाने के लिए "Cancel order" दबाएँ।

**स्क्रीन पर क्या है**
- **Line: item, Qty, UOM, Rate (₹), GST %**: item search में सिर्फ उस plant में stock वाला माल दिखता है; "Available N" stock है; description बदल सकते हैं।
- **Totals**: Lines, Subtotal, GST, Grand total (तुरंत)।

**आम दिक्कतें और हल**
- "Only ACTIVE trading goods can be used on trade orders. / Only ACTIVE materials flagged sellable can be used on trade orders." — item master में inactive या not sellable है। दूसरा चुनें या master ठीक करवाएँ।
- "Line #N: … — insufficient stock (short X)" — dispatch के समय plant में stock कम है। qty घटाएँ या पहले stock लाएँ।
- "Only DRAFT trade orders can be edited. / Only CONFIRMED trade orders can be dispatched." — status आगे बढ़ चुका; जो buttons दिख रहे हैं वही इस्तेमाल करें।
- "Cannot cancel order in status …" — dispatched या invoiced order cancel नहीं हो सकता।

**अटक गए तो**
1. stock के कारण dispatch fail: plant का stock देखें और फिर करें, या cancel करके दूसरे plant से नया बनाएँ।

जुड़े पेज: /sales/trade-orders, /sales/trade-orders/[id]/edit

**अभी नहीं होता / ध्यान दें**
- dispatched trade order को Invoiced करने का button नहीं है, जबकि list में Invoiced filter है।

### Edit trade order (/sales/trade-orders/[id]/edit)
स्क्रीन का पता: /sales/trade-orders/[id]/edit · भूमिकाएँ: SALES, OWNER, ADMIN, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=sales-trade-orders-id-edit&lang=hi

मौजूदा Draft trade order का header या lines बदलने के लिए वही form।

confirm करने से पहले draft ठीक करने के लिए। सिर्फ Draft orders बदले जा सकते हैं।

**शुरू करने से पहले**
- order Draft में हो।

**स्टेप बाय स्टेप**
1. ज़रूरत हो तो "Customer *", "Dispatch stock plant *", "Order date" या "Notes" बदलें।
2. lines बदलें: item, Qty ("Available" से ज़्यादा नहीं), UOM, Rate (₹), GST %; lines जोड़ें या हटाएँ।
3. "Save draft" दबाएँ, या तुरंत confirm के लिए "Save & confirm"।

**स्क्रीन पर क्या है**
- **Customer ***: माल खरीदने वाला।
- **Dispatch stock plant ***: कौन से items दिखें और stock कहाँ से घटे, यह तय करता है।
- **Order date / Notes**: order की तारीख और अंदरूनी note।
- **Line: item, Qty, UOM, Rate (₹), GST %**: item search में सिर्फ उस plant में stock वाला माल दिखता है; "Available N" stock है; description बदल सकते हैं।
- **Totals**: Lines, Subtotal, GST, Grand total (तुरंत)।

**आम दिक्कतें और हल**
- "Dispatch stock plant is required for trade orders." — header में "Dispatch stock plant" चुनें।
- "Add at least one line before confirming." — item line जोड़ें।
- "Trade order line quantity must be greater than zero." — qty ठीक करें।
- "Only ACTIVE trading goods can be used on trade orders. / Only ACTIVE materials flagged sellable can be used on trade orders." — item master में inactive या not sellable है। दूसरा चुनें या master ठीक करवाएँ।
- "Line #N: … — insufficient stock (short X)" — dispatch के समय plant में stock कम है। qty घटाएँ या पहले stock लाएँ।
- "Only DRAFT trade orders can be edited. / Only CONFIRMED trade orders can be dispatched." — status आगे बढ़ चुका; जो buttons दिख रहे हैं वही इस्तेमाल करें।

**अटक गए तो**
1. page "Loading…" पर अटका: order id गलत है; Trade Orders पर लौटें।
2. बिना save किए निकलने के लिए "Cancel" दबाएँ।

जुड़े पेज: /sales/trade-orders/[id], /sales/trade-orders

### New trade order (/sales/trade-orders/new)
स्क्रीन का पता: /sales/trade-orders/new · भूमिकाएँ: SALES, OWNER, ADMIN, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=sales-trade-orders-new&lang=hi

stock से बिक्री का order बनाएँ। lines में trading goods और sellable inventory materials दोनों हो सकते हैं।

granules, film या trading goods जैसे-के-तैसे बेचने के लिए। पहले plant चुनें; वहाँ stock वाले items ही दिखेंगे।

**शुरू करने से पहले**
- ग्राहक Customers में; चुने plant में stock वाले active trading goods या sellable materials।

**स्टेप बाय स्टेप**
1. "Customer *" और "Dispatch stock plant *" चुनें।
2. "Order date" और चाहें तो "Notes" भरें।
3. "Add first line" दबाएँ, "Search code, name, form, stock type…" में खोजें, item चुनें।
4. Qty ("Available" देखें), UOM, Rate (₹) और GST % भरें।
5. "Totals" देखें, फिर "Save draft" या "Save & confirm" दबाएँ।

**स्क्रीन पर क्या है**
- **Customer ***: माल खरीदने वाला।
- **Dispatch stock plant ***: कौन से items दिखें और stock कहाँ से घटे, यह तय करता है।
- **Order date / Notes**: order की तारीख और अंदरूनी note।
- **Line: item, Qty, UOM, Rate (₹), GST %**: item search में सिर्फ उस plant में stock वाला माल दिखता है; "Available N" stock है; description बदल सकते हैं।
- **Totals**: Lines, Subtotal, GST, Grand total (तुरंत)।

**आम दिक्कतें और हल**
- "Dispatch stock plant is required for trade orders." — header में "Dispatch stock plant" चुनें।
- "Add at least one line before confirming." — item line जोड़ें।
- "Trade order line quantity must be greater than zero." — qty ठीक करें।
- "Only ACTIVE trading goods can be used on trade orders. / Only ACTIVE materials flagged sellable can be used on trade orders." — item master में inactive या not sellable है। दूसरा चुनें या master ठीक करवाएँ।
- "Line #N: … — insufficient stock (short X)" — dispatch के समय plant में stock कम है। qty घटाएँ या पहले stock लाएँ।
- "Only DRAFT trade orders can be edited. / Only CONFIRMED trade orders can be dispatched." — status आगे बढ़ चुका; जो buttons दिख रहे हैं वही इस्तेमाल करें।
- "No available stock item found for this plant." — उस plant में वह माल नहीं; दूसरा plant या item चुनें।

**अटक गए तो**
1. item list खाली: पहले plant चुनें।

जुड़े पेज: /sales/trade-orders, /sales/trade-orders/[id], /master/trading-goods
