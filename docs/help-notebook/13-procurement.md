# Procurement

## Overview (English)
# Procurement (Purchase Orders and receiving)

Procurement is how the plant buys raw material and consumables from vendors and brings them into stock. It has four screens, all in the **Stock** workspace under the tab **Purchase orders**: the list (/procurement/purchase-orders), the new PO form (/procurement/purchase-orders/new), the PO detail (/procurement/purchase-orders/<id>) and the receiving wizard (/procurement/purchase-orders/<id>/receive). Receiving posts a GRN and adds the material to inventory (film arrives as rolls; other materials go into their own stock).

## Who uses it
- **STORE** – raises POs, sends them, receives goods, closes short. Store lands on Rolls (/inventory/rolls) and finds Purchase orders in the Stock workspace.
- **PLANT_MANAGER** – views POs and progress (procurement.view); cannot create unless given procurement.manage. For a Plant Manager the Stock workspace opens on Purchase orders.
- **OWNER / ADMIN / SUPER_ADMIN** – everything.
- Others need a procurement grant.

## Where demand comes from
Low-stock alerts from the Reorder Policy (below reorder or below safety stock), the MRP centre and the planner's Material readiness show what is short. The buyer then raises a PO. There is no automatic PO creation; the buyer decides.

## Statuses
DRAFT → SENT → ACK (vendor acknowledged) → PARTIAL (some received) → COMPLETED (all received or remaining lines closed short). CANCELLED is a dead end. Lines can only be edited while the PO is DRAFT.

## Main flow step by step
1. **List** – tiles Total POs, Open, Overdue · filtered, MTD PO commitments · filtered (INR). Filter by status chip (All, Draft, Sent, Ack, Partial, Completed, Cancelled) or "Search PO code…". Press "New PO".
2. **New PO** – choose Vendor, Plant, Order Date, Expected Delivery, Payment Terms, Freight Terms. In Line Items choose the material type (Film Family, Film Variant, Granule, Ink, Adhesive, Solvent, Packaging, POD, Add-on), search and click a suggestion, then enter Qty, Rate and GST %. Check Subtotal and Grand Total. Press "Save PO" – the PO is a DRAFT.
3. **Send** – on the PO detail press "Send". Only a DRAFT with at least one line can be sent. Press "PDF" to print or mail the PO; it uses the Company Profile letterhead.
4. **Receive** – when the truck arrives press "Receive" (shown for SENT, ACK, PARTIAL). The GRN wizard has three steps: "Vehicle & Invoice" (Vehicle No, Driver, LR No, Vendor Invoice No, Invoice Date), "Line Quantities" (Receiving and Rate per line; Width (mm) and Thk (µm) for film rolls), "Quality & Post" (Quality Status Pending/Approved/Rejected, Notes). Press "Post GRN".
5. **Gate bill link** – when the watchman has logged the vendor's bill at the gate, the store opens the receipt from the bill (Bills & documents) so the address carries ?inward_bill_id=…; the GRN is then linked to that bill in the same step. A bill can only be received at its own plant.
6. **Close short / Cancel** – if the vendor will not send the rest press "Close Short" and give a reason; to stop a PO that was never fulfilled press "Cancel" with a reason.

## Rules and limits
- Over-receipt is allowed up to 5% of the ordered quantity per line; more is refused.
- The same vendor invoice number cannot be received twice for one vendor.
- A closed line, or a line with nothing open, cannot be received.
- Film lines need width and thickness so the rolls get the right size.
- The plant must have an inventory location.
- Quality status is recorded on the GRN for the record.

## Problems and fixes
- *"Receive" is not shown*: the PO is still DRAFT – press "Send" first; or it is COMPLETED/CANCELLED.
- *"Duplicate vendor invoice"*: this invoice was already posted; check the number on the paper.
- *"over-receipt > 5% tolerance"*: correct the quantity or ask the buyer to amend through a new PO.
- *"Roll receipt … needs width_mm and thickness_micron"*: fill Width (mm) and Thk (µm).
- *"No InventoryLocation configured for plant"*: an admin must add a location under Factory → Locations.
- *"This PO belongs to a different factory than the gate bill"*: choose a PO of the bill's plant.
- *Wrong GRN already posted*: correct stock through Stock adjustments; there is no GRN undo here.
- *Old PO not in the list*: set the financial-year picker to "All years".

## सारांश (हिंदी)
# Procurement (Purchase Order और माल लेना)

Procurement से प्लांट vendor से raw material और दूसरा सामान खरीदता है और stock में लाता है। इसकी चार स्क्रीन हैं, सभी **Stock** workspace के **Purchase orders** टैब में: लिस्ट (/procurement/purchase-orders), नया PO फ़ॉर्म (/procurement/purchase-orders/new), PO का विवरण (/procurement/purchase-orders/<id>) और माल लेने का wizard (/procurement/purchase-orders/<id>/receive)। Receive करने पर GRN पोस्ट होता है और material inventory में जुड़ता है (film, roll के रूप में आती है; बाकी material अपने-अपने stock में)।

## कौन इस्तेमाल करता है
- **STORE** – PO बनाता है, भेजता है, माल लेता है, close short करता है। Store, Rolls (/inventory/rolls) पर पहुँचता है और Stock workspace में Purchase orders पाता है।
- **PLANT_MANAGER** – PO और प्रगति देखता है (procurement.view); procurement.manage के बिना नया नहीं बना सकता। Plant Manager के लिए Stock workspace, Purchase orders पर ही खुलता है।
- **OWNER / ADMIN / SUPER_ADMIN** – सब कुछ।
- बाकी को procurement की अनुमति चाहिए।

## ज़रूरत कहाँ से आती है
Reorder Policy के low-stock alert (reorder या safety stock से नीचे), MRP centre और planner की Material readiness बताते हैं कि क्या कम है। फिर खरीदार PO बनाता है। PO अपने-आप नहीं बनता; खरीदार तय करता है।

## Status
DRAFT → SENT → ACK (vendor ने माना) → PARTIAL (कुछ आया) → COMPLETED (सब आया या बाकी लाइनें close short)। CANCELLED के बाद कुछ नहीं होता। लाइनें सिर्फ़ DRAFT में बदली जा सकती हैं।

## मुख्य काम, स्टेप बाय स्टेप
1. **लिस्ट** – tile: Total POs, Open, Overdue · filtered, MTD PO commitments · filtered (INR)। Status chip (All, Draft, Sent, Ack, Partial, Completed, Cancelled) या "Search PO code…" से छाँटें। "New PO" दबाएँ।
2. **नया PO** – Vendor, Plant, Order Date, Expected Delivery, Payment Terms, Freight Terms चुनें। Line Items में material का प्रकार (Film Family, Film Variant, Granule, Ink, Adhesive, Solvent, Packaging, POD, Add-on) चुनें, खोजें और suggestion पर क्लिक करें, फिर Qty, Rate और GST % भरें। Subtotal और Grand Total देखें। "Save PO" दबाएँ – PO DRAFT बनता है।
3. **Send** – PO विवरण पर "Send" दबाएँ। सिर्फ़ कम से कम एक लाइन वाला DRAFT ही भेजा जा सकता है। PO छापने या भेजने के लिए "PDF" दबाएँ; इसमें Company Profile का letterhead आता है।
4. **Receive** – ट्रक आने पर "Receive" दबाएँ (SENT, ACK, PARTIAL पर दिखता है)। GRN wizard में तीन स्टेप: "Vehicle & Invoice" (Vehicle No, Driver, LR No, Vendor Invoice No, Invoice Date), "Line Quantities" (हर लाइन पर Receiving और Rate; film roll के लिए Width (mm) और Thk (µm)), "Quality & Post" (Quality Status Pending/Approved/Rejected, Notes)। "Post GRN" दबाएँ।
5. **Gate bill से जोड़ना** – जब watchman ने gate पर vendor का बिल दर्ज किया हो, store बिल (Bills & documents) से receipt खोलता है ताकि पते में ?inward_bill_id=… आए; GRN उसी स्टेप में बिल से जुड़ जाता है। बिल सिर्फ़ अपने प्लांट में ही receive होता है।
6. **Close short / Cancel** – vendor बाकी माल नहीं भेजेगा तो "Close Short" दबाकर कारण दें; जो PO पूरा ही नहीं हुआ उसे रोकने के लिए कारण के साथ "Cancel" दबाएँ।

## नियम और सीमाएँ
- हर लाइन पर मँगाई मात्रा से 5% तक ज़्यादा माल लिया जा सकता है; उससे ज़्यादा मना है।
- एक vendor का एक ही invoice नंबर दो बार receive नहीं हो सकता।
- बंद लाइन, या जिस लाइन पर कुछ बाकी नहीं, उस पर receive नहीं होता।
- Film लाइन के लिए width और thickness चाहिए ताकि roll सही नाप के बनें।
- प्लांट की inventory location बनी होनी चाहिए।
- Quality status रिकॉर्ड के लिए GRN पर दर्ज होता है।

## दिक्कतें और हल
- *"Receive" नहीं दिखता*: PO अभी DRAFT है – पहले "Send" दबाएँ; या वह COMPLETED/CANCELLED है।
- *"Duplicate vendor invoice"*: यह invoice पहले पोस्ट हो चुका है; कागज़ पर नंबर जाँचें।
- *"over-receipt > 5% tolerance"*: मात्रा ठीक करें या खरीदार से नया PO बनवाएँ।
- *"Roll receipt … needs width_mm and thickness_micron"*: Width (mm) और Thk (µm) भरें।
- *"No InventoryLocation configured for plant"*: admin, Factory → Locations में location बनाए।
- *"This PO belongs to a different factory than the gate bill"*: बिल के प्लांट का PO चुनें।
- *गलत GRN पोस्ट हो गया*: Stock adjustments से stock ठीक करें; यहाँ GRN वापस लेने का बटन नहीं है।
- *पुराना PO लिस्ट में नहीं*: financial-year picker में "All years" चुनें।

## Every screen (English)

### Purchase Orders (/procurement/purchase-orders)
Screen address: /procurement/purchase-orders · Roles: ADMIN, OWNER, SUPER_ADMIN, STORE, PLANT_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=procurement-purchase-orders

All purchase orders to vendors with status, value, expected date and how much has been received.

Open it to see what is on order, chase overdue deliveries and start receiving. Demand comes from low-stock alerts, MRP and the planner's material readiness; receipts posted here add stock to inventory.

**Before you start**
- Store, Plant Manager, Owner or Admin (procurement.view). Creating needs procurement.manage.
- Vendors exist (Stock → Vendors).

**Step by step**
1. Read the tiles: "Total POs", "Open", "Overdue · filtered", "MTD PO commitments · filtered (INR)".
2. Filter by status chip: All, Draft, Sent, Ack, Partial, Completed, Cancelled.
3. Search with "Search PO code…".
4. Click a row to open the PO.
5. Press "New PO" to raise a new order.

**What is on the screen**
- **PO #**: Purchase order code.
- **Vendor / Plant**: Supplier and the plant that receives the goods.
- **Status**: DRAFT → SENT → (ACK) → PARTIAL → COMPLETED, or CANCELLED.
- **Expected**: Expected delivery date; past it with goods still open counts as overdue.
- **Lines / Progress**: Number of lines and share already received.
- **Grand Total**: Value including GST.

**Common problems and fixes**
- "No purchase orders yet." — Create one from MRP or with "New PO".
- ""New PO" is missing" — Plant Manager can view only; creating needs procurement.manage (Store/Owner/Admin).

**If stuck**
1. Pick "All" and clear the search if a PO is not found.
2. The financial-year picker in the header may hide older POs; choose "All years".

Related pages: /procurement/purchase-orders/new, /procurement/purchase-orders/[id], /inventory/vendors, /system/reorder-policy, /analytics/mrp, /inventory/gate-bills

**Not done yet / watch out**
- Plant Manager sees purchase orders but cannot create or receive them without an extra procurement.manage grant.

### Purchase Order (detail) (/procurement/purchase-orders/[id])
Screen address: /procurement/purchase-orders/[id] · Roles: ADMIN, OWNER, SUPER_ADMIN, STORE, PLANT_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=procurement-purchase-orders-id

One PO: header, status, lines with ordered/received/open quantity, receipts (GRNs), status timeline and notes, with Send, Receive, Close Short, Cancel and PDF.

Open it to send a draft to the vendor, receive goods, close a short delivery, cancel, or print the PO.

**Before you start**
- procurement.view to see; procurement.manage to act.

**Step by step**
1. Check the header: vendor, plant, order date, expected date and status badge.
2. Press "PDF" to download the PO document (uses the Company Profile).
3. On a DRAFT press "Send"; status becomes SENT.
4. When goods arrive (SENT, ACK or PARTIAL) press "Receive" to open the GRN wizard.
5. If the vendor will not send the rest, press "Close Short" and give the reason (default "Vendor short delivery").
6. To cancel, press "Cancel" and type the reason (not possible once COMPLETED or CANCELLED).
7. Use the tabs "Lines", "Receipts", "Timeline", "Notes".

**What is on the screen**
- **Lines: Material, Ordered, Received, Open, Rate, Total, Progress**: Per line how much is ordered, received and still open. "Closed Short: <reason>" shows on closed lines.
- **Receipts: GRN #, Invoice, Vehicle, Quality**: Every GRN posted against this PO.
- **Timeline**: Status history (sent, received, closed…).

**Common problems and fixes**
- "Only DRAFT POs can be sent (current: <status>)" — The PO was already sent. Nothing to do.
- "Cannot send an empty PO" — The draft has no lines.
- "Cannot cancel a <status> PO" — Completed or cancelled POs cannot be cancelled.
- "Items can only be edited while the PO is in DRAFT." — After sending, lines are fixed; close short or cancel and raise a new PO.
- "No receipts yet." — Nothing received; press "Receive" to record a GRN.

**If stuck**
1. "Receive" is hidden on DRAFT: press "Send" first.
2. If the PO goes to PARTIAL, the open quantity can be received later with another GRN.

Related pages: /procurement/purchase-orders, /procurement/purchase-orders/[id]/receive, /inventory/grn-history, /inventory/gate-bills

**Not done yet / watch out**
- There is no button to record the vendor's acknowledgement (ACK) although the status exists and the API supports it.
- A DRAFT PO cannot be edited from the screen; the detail page has no edit button although the backend allows editing lines in DRAFT.
- Close Short and Cancel ask for the reason in a plain browser prompt with no confirmation step.

### Receive against PO (GRN wizard) (/procurement/purchase-orders/[id]/receive)
Screen address: /procurement/purchase-orders/[id]/receive · Roles: ADMIN, OWNER, SUPER_ADMIN, STORE · Share link: https://erp.totalpolyprint.com/guide?page=procurement-purchase-orders-id-receive

A three-step wizard to post a GRN against a PO: vehicle and invoice, line quantities, quality and post. Posting adds the stock.

Open it from "Receive" on a PO when the truck is unloaded, or from a gate bill (?inward_bill_id=…) so the receipt is linked to that bill in one step.

**Before you start**
- PO status SENT, ACK or PARTIAL.
- An inventory location is set up for the PO's plant.
- procurement.manage / inventory rights (Store, Owner, Admin).

**Step by step**
1. Step "Vehicle & Invoice": fill "Vehicle No" (e.g. GJ-15-AB-9999), "Driver", "LR No", "Vendor Invoice No", "Invoice Date". Press "Next".
2. Step "Line Quantities": for each line see Open and type Receiving and Rate; for film rolls also "Width (mm)" and "Thk (µm)". Press "Next".
3. Step "Quality & Post": choose "Quality Status" (Pending, Approved, Rejected) and add Notes.
4. Press "Post GRN". You see "GRN <code> posted" and return to the PO.
5. With a gate bill, "Open bill" opens that bill; the banner shows the bill context.

**What is on the screen**
- **Vehicle No / Driver / LR No**: Transport details of this delivery.
- **Vendor Invoice No / Invoice Date**: The same invoice number cannot be used twice for one vendor.
- **Open / Receiving**: Open = still due on the line; Receiving = what came now. Up to 5% over the ordered quantity is allowed.
- **Width (mm) / Thk (µm)**: Needed for roll materials so the rolls are created with the right size.
- **Quality Status**: Recorded on the GRN: Pending, Approved or Rejected.

**Common problems and fixes**
- "Cannot receive against <status> PO" — The PO is DRAFT, COMPLETED or CANCELLED. Send it first, or use the right PO.
- "Duplicate vendor invoice '<no>' for vendor <code>." — This invoice was already received. Check the invoice number.
- "Line <n>: over-receipt > 5% tolerance (allowed …, attempted …)" — You typed more than 5% above the open quantity. Correct the quantity or ask purchase to amend.
- "Line <n> is already closed; cannot receive against it. / no open quantity remains to receive." — That line is closed short or fully received. Set its Receiving to 0.
- "Roll receipt for line <n> needs width_mm and thickness_micron." — Fill Width (mm) and Thk (µm) for the film line.
- "No InventoryLocation configured for plant <plant>" — Ask an admin to create a location for the plant (Factory → Locations).
- "This PO belongs to a different factory than the gate bill." — A bill can be received only at its own plant: pick a PO of that plant or post without the bill.
- "At least one line required" — Enter a Receiving quantity on at least one line.

**If stuck**
1. Use "Back" in the wizard to correct an earlier step; nothing is saved until "Post GRN".
2. A wrong GRN after posting needs a stock adjustment; ask Store/Owner.

Related pages: /procurement/purchase-orders/[id], /inventory/gate-bills, /inventory/grn-history, /inventory/rolls, /inventory/adjustments

**Not done yet / watch out**
- Quality Status Rejected is only recorded on the GRN; the received quantity is still posted, so a rejected lot needs a separate stock action.
- A posted GRN cannot be reversed from this screen; mistakes are corrected through stock adjustments.

### New Purchase Order (/procurement/purchase-orders/new)
Screen address: /procurement/purchase-orders/new · Roles: ADMIN, OWNER, SUPER_ADMIN, STORE · Share link: https://erp.totalpolyprint.com/guide?page=procurement-purchase-orders-new

Create a draft PO: vendor, plant, dates, terms and material lines with quantity, rate and GST.

Open it when material must be bought. Save first; then send it to the vendor from the PO detail page.

**Before you start**
- procurement.manage (Store, Owner, Admin).
- Vendor, plant and the material masters exist.

**Step by step**
1. Pick "Vendor" and "Plant"; set "Order Date" and "Expected Delivery".
2. Fill "Payment Terms" and "Freight Terms".
3. Under "Line Items" pick the material type (Film Family, Film Variant, Granule, Ink, Adhesive, Solvent, Packaging, POD, Add-on), type in "Search material…" and click it in "Suggestions".
4. For each line enter Qty, Rate and GST %; check the Line Total. Remove a wrong line with "Remove line".
5. Add "Notes" if needed; check Subtotal and Grand Total.
6. Press "Save PO". You see "PO <code> saved" and the PO is DRAFT.

**What is on the screen**
- **Vendor / Plant**: Supplier and receiving plant. A gate bill can be received only at its own plant.
- **Order Date / Expected Delivery**: Expected date drives the overdue count.
- **Material type and search**: Chooses which master the line comes from.
- **Qty / UOM / Rate / GST %**: Ordered quantity in the material's unit, price per unit and tax.
- **Line Total / Subtotal / Grand Total**: Calculated amounts; Grand Total includes GST.

**Common problems and fixes**
- "Failed to save PO" — A required header field or a line value is missing/invalid. The server message names it.
- "Cannot send an empty PO" — A PO with no lines cannot be sent later. Add at least one line.

**If stuck**
1. If a material is not in Suggestions, check its type and that it exists in the master.
2. Press "Cancel" to leave without saving.

Related pages: /procurement/purchase-orders, /procurement/purchase-orders/[id], /inventory/vendors, /system/company-profile

## हर स्क्रीन (हिंदी)

### Purchase Orders (खरीद ऑर्डर) (/procurement/purchase-orders)
स्क्रीन का पता: /procurement/purchase-orders · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, STORE, PLANT_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=procurement-purchase-orders&lang=hi

Vendor को दिए गए सभी purchase order: status, कीमत, अपेक्षित तारीख और कितना माल आ चुका।

क्या-क्या order पर है, देर वाली delivery का पीछा करने और माल लेने के लिए खोलें। ज़रूरत low-stock alert, MRP और planner की material readiness से आती है; यहाँ से पोस्ट हुई receipt inventory में stock जोड़ती है।

**शुरू करने से पहले**
- Store, Plant Manager, Owner या Admin (procurement.view)। नया बनाने के लिए procurement.manage।
- Vendor बने हों (Stock → Vendors)।

**स्टेप बाय स्टेप**
1. Tile पढ़ें: "Total POs", "Open", "Overdue · filtered", "MTD PO commitments · filtered (INR)"।
2. Status chip से छाँटें: All, Draft, Sent, Ack, Partial, Completed, Cancelled।
3. "Search PO code…" से खोजें।
4. PO खोलने के लिए row पर क्लिक करें।
5. नया order बनाने के लिए "New PO" दबाएँ।

**स्क्रीन पर क्या है**
- **"PO #" वाला हिस्सा**: Purchase order का code।
- **"Vendor / Plant" वाला हिस्सा**: सप्लायर और माल लेने वाला प्लांट।
- **"Status" वाला हिस्सा**: DRAFT → SENT → (ACK) → PARTIAL → COMPLETED, या CANCELLED।
- **"Expected" वाला हिस्सा**: अपेक्षित delivery तारीख; इसके बाद भी माल बाकी हो तो overdue।
- **"Lines / Progress" वाला हिस्सा**: लाइनों की गिनती और कितना हिस्सा आ चुका।
- **"Grand Total" वाला हिस्सा**: GST सहित कुल कीमत।

**आम दिक्कतें और हल**
- "स्क्रीन पर संदेश: "No purchase orders yet."" — MRP से या "New PO" से एक बनाएँ।
- ""New PO" नहीं दिखता" — Plant Manager सिर्फ़ देख सकते हैं; बनाने के लिए procurement.manage (Store/Owner/Admin) चाहिए।

**अटक गए तो**
1. PO न मिले तो "All" चुनें और search खाली करें।
2. Header का financial-year picker पुराने PO छुपा सकता है; "All years" चुनें।

जुड़े पेज: /procurement/purchase-orders/new, /procurement/purchase-orders/[id], /inventory/vendors, /system/reorder-policy, /analytics/mrp, /inventory/gate-bills

**अभी नहीं होता / ध्यान दें**
- Plant Manager purchase order देख सकता है पर procurement.manage अनुमति के बिना बना या receive नहीं कर सकता।

### Purchase Order (विवरण) (/procurement/purchase-orders/[id])
स्क्रीन का पता: /procurement/purchase-orders/[id] · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, STORE, PLANT_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=procurement-purchase-orders-id&lang=hi

एक PO: header, status, ordered/received/open मात्रा वाली लाइनें, receipts (GRN), status timeline और notes; साथ में Send, Receive, Close Short, Cancel और PDF।

Draft को vendor को भेजने, माल लेने, कम delivery पर PO बंद करने, रद्द करने या PO छापने के लिए खोलें।

**शुरू करने से पहले**
- देखने के लिए procurement.view; कार्रवाई के लिए procurement.manage।

**स्टेप बाय स्टेप**
1. Header देखें: vendor, प्लांट, order तारीख, अपेक्षित तारीख और status badge।
2. PO दस्तावेज़ के लिए "PDF" दबाएँ (Company Profile की जानकारी के साथ)।
3. DRAFT पर "Send" दबाएँ; status SENT हो जाता है।
4. माल आने पर (SENT, ACK या PARTIAL) GRN wizard खोलने के लिए "Receive" दबाएँ।
5. अगर vendor बाकी माल नहीं भेजेगा तो "Close Short" दबाएँ और कारण लिखें (default "Vendor short delivery")।
6. रद्द करने के लिए "Cancel" दबाएँ और कारण लिखें (COMPLETED या CANCELLED के बाद संभव नहीं)।
7. टैब "Lines", "Receipts", "Timeline", "Notes" इस्तेमाल करें।

**स्क्रीन पर क्या है**
- **"Lines: Material, Ordered, Received, Open, Rate, Total, Progress" वाला हिस्सा**: हर लाइन में कितना मँगाया, आया और बाकी है। बंद लाइन पर "Closed Short: <reason>" दिखता है।
- **"Receipts: GRN #, Invoice, Vehicle, Quality" वाला हिस्सा**: इस PO पर पोस्ट हुई हर GRN।
- **"Timeline" वाला हिस्सा**: Status का इतिहास (sent, received, closed…)।

**आम दिक्कतें और हल**
- "स्क्रीन पर संदेश: "Only DRAFT POs can be sent (current: <status>)"" — PO पहले ही भेजा जा चुका है। कुछ करने की ज़रूरत नहीं।
- "स्क्रीन पर संदेश: "Cannot send an empty PO"" — Draft में कोई लाइन नहीं है।
- "स्क्रीन पर संदेश: "Cannot cancel a <status> PO"" — Completed या cancelled PO रद्द नहीं होते।
- "स्क्रीन पर संदेश: "Items can only be edited while the PO is in DRAFT."" — भेजने के बाद लाइनें तय हैं; close short या cancel करके नया PO बनाएँ।
- "स्क्रीन पर संदेश: "No receipts yet."" — अभी कुछ नहीं आया; GRN के लिए "Receive" दबाएँ।

**अटक गए तो**
1. DRAFT पर "Receive" नहीं दिखता: पहले "Send" दबाएँ।
2. PO PARTIAL हो जाए तो बाकी मात्रा बाद में दूसरी GRN से ली जा सकती है।

जुड़े पेज: /procurement/purchase-orders, /procurement/purchase-orders/[id]/receive, /inventory/grn-history, /inventory/gate-bills

**अभी नहीं होता / ध्यान दें**
- Vendor की स्वीकृति (ACK) दर्ज करने का बटन नहीं है, जबकि status मौजूद है और API इसे सपोर्ट करती है।
- DRAFT PO को स्क्रीन से बदला नहीं जा सकता; detail पेज पर edit बटन नहीं है जबकि backend DRAFT में लाइनें बदलने देता है।
- Close Short और Cancel कारण एक साधारण browser prompt में पूछते हैं, अलग पुष्टि का स्टेप नहीं है।

### PO पर माल लें (GRN wizard) (/procurement/purchase-orders/[id]/receive)
स्क्रीन का पता: /procurement/purchase-orders/[id]/receive · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, STORE · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=procurement-purchase-orders-id-receive&lang=hi

PO पर GRN पोस्ट करने का तीन स्टेप का wizard: vehicle और invoice, लाइन की मात्रा, quality और post। Post करते ही stock जुड़ता है।

जब ट्रक उतर जाए तब PO पर "Receive" से खोलें, या gate bill से (?inward_bill_id=…) ताकि receipt उसी बिल से एक बार में जुड़ जाए।

**शुरू करने से पहले**
- PO का status SENT, ACK या PARTIAL।
- PO के प्लांट के लिए inventory location बनी हो।
- procurement.manage / inventory अधिकार (Store, Owner, Admin)।

**स्टेप बाय स्टेप**
1. स्टेप "Vehicle & Invoice": "Vehicle No" (जैसे GJ-15-AB-9999), "Driver", "LR No", "Vendor Invoice No", "Invoice Date" भरें। "Next" दबाएँ।
2. स्टेप "Line Quantities": हर लाइन में Open देखें और Receiving व Rate भरें; film roll के लिए "Width (mm)" और "Thk (µm)" भी। "Next" दबाएँ।
3. स्टेप "Quality & Post": "Quality Status" (Pending, Approved, Rejected) चुनें और Notes लिखें।
4. "Post GRN" दबाएँ। "GRN <code> posted" दिखेगा और आप PO पर लौटेंगे।
5. Gate bill के साथ, "Open bill" वह बिल खोलता है; ऊपर banner बिल की जानकारी दिखाता है।

**स्क्रीन पर क्या है**
- **"Vehicle No / Driver / LR No" वाला हिस्सा**: इस delivery के transport की जानकारी।
- **"Vendor Invoice No / Invoice Date" वाला हिस्सा**: एक vendor के लिए एक invoice नंबर दो बार नहीं चल सकता।
- **"Open / Receiving" वाला हिस्सा**: Open = लाइन पर बाकी; Receiving = अभी आया। मँगाई मात्रा से 5% तक ज़्यादा चल सकता है।
- **"Width (mm) / Thk (µm)" वाला हिस्सा**: Roll material के लिए ज़रूरी ताकि roll सही नाप से बनें।
- **"Quality Status" वाला हिस्सा**: GRN पर दर्ज: Pending, Approved या Rejected।

**आम दिक्कतें और हल**
- "स्क्रीन पर संदेश: "Cannot receive against <status> PO"" — PO DRAFT, COMPLETED या CANCELLED है। पहले भेजें, या सही PO लें।
- "स्क्रीन पर संदेश: "Duplicate vendor invoice '<no>' for vendor <code>."" — यह invoice पहले ही receive हो चुका है। Invoice नंबर जाँचें।
- "स्क्रीन पर संदेश: "Line <n>: over-receipt > 5% tolerance (allowed …, attempted …)"" — आपने open मात्रा से 5% से ज़्यादा लिखा। मात्रा ठीक करें या purchase से बदलवाएँ।
- "स्क्रीन पर संदेश: "Line <n> is already closed; cannot receive against it. / no open quantity remains to receive."" — वह लाइन close short या पूरी आ चुकी है। उसका Receiving 0 करें।
- "स्क्रीन पर संदेश: "Roll receipt for line <n> needs width_mm and thickness_micron."" — Film लाइन के लिए Width (mm) और Thk (µm) भरें।
- "स्क्रीन पर संदेश: "No InventoryLocation configured for plant <plant>"" — Admin से प्लांट की location बनवाएँ (Factory → Locations)।
- "स्क्रीन पर संदेश: "This PO belongs to a different factory than the gate bill."" — बिल सिर्फ़ अपने प्लांट में receive होता है: उस प्लांट का PO लें या बिल के बिना पोस्ट करें।
- "स्क्रीन पर संदेश: "At least one line required"" — कम से कम एक लाइन पर Receiving मात्रा भरें।

**अटक गए तो**
1. पिछला स्टेप ठीक करने के लिए wizard में "Back" दबाएँ; "Post GRN" तक कुछ सेव नहीं होता।
2. पोस्ट होने के बाद गलत GRN के लिए stock adjustment चाहिए; Store/Owner से पूछें।

जुड़े पेज: /procurement/purchase-orders/[id], /inventory/gate-bills, /inventory/grn-history, /inventory/rolls, /inventory/adjustments

**अभी नहीं होता / ध्यान दें**
- Quality Status Rejected सिर्फ़ GRN पर दर्ज होता है; मिली मात्रा फिर भी पोस्ट होती है, इसलिए rejected माल के लिए अलग stock कार्रवाई चाहिए।
- पोस्ट हुआ GRN इस स्क्रीन से वापस नहीं होता; गलती stock adjustment से ठीक होती है।

### नया Purchase Order (/procurement/purchase-orders/new)
स्क्रीन का पता: /procurement/purchase-orders/new · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, STORE · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=procurement-purchase-orders-new&lang=hi

Draft PO बनाएँ: vendor, प्लांट, तारीखें, terms और material लाइनें — मात्रा, rate और GST के साथ।

जब material खरीदना हो तब खोलें। पहले Save करें; फिर PO detail पेज से vendor को भेजें।

**शुरू करने से पहले**
- procurement.manage (Store, Owner, Admin)।
- Vendor, प्लांट और material master बने हों।

**स्टेप बाय स्टेप**
1. "Vendor" और "Plant" चुनें; "Order Date" और "Expected Delivery" भरें।
2. "Payment Terms" और "Freight Terms" भरें।
3. "Line Items" में material का प्रकार (Film Family, Film Variant, Granule, Ink, Adhesive, Solvent, Packaging, POD, Add-on) चुनें, "Search material…" में लिखें और "Suggestions" में उस पर क्लिक करें।
4. हर लाइन में Qty, Rate और GST % भरें; Line Total देखें। गलत लाइन "Remove line" से हटाएँ।
5. ज़रूरत हो तो "Notes" लिखें; Subtotal और Grand Total देखें।
6. "Save PO" दबाएँ। "PO <code> saved" दिखेगा और PO DRAFT में होगा।

**स्क्रीन पर क्या है**
- **"Vendor / Plant" वाला हिस्सा**: सप्लायर और माल लेने वाला प्लांट। Gate bill सिर्फ़ अपने ही प्लांट में receive हो सकता है।
- **"Order Date / Expected Delivery" वाला हिस्सा**: अपेक्षित तारीख से overdue गिना जाता है।
- **Material type और search**: तय करता है कि लाइन किस master से आएगी।
- **"Qty / UOM / Rate / GST %" वाला हिस्सा**: Material की इकाई में मँगाई मात्रा, प्रति इकाई कीमत और टैक्स।
- **"Line Total / Subtotal / Grand Total" वाला हिस्सा**: गणना की गई रकम; Grand Total में GST शामिल।

**आम दिक्कतें और हल**
- "स्क्रीन पर संदेश: "Failed to save PO"" — Header का ज़रूरी field या लाइन की value नहीं है/गलत है। सर्वर का संदेश बताएगा।
- "स्क्रीन पर संदेश: "Cannot send an empty PO"" — बिना लाइन वाला PO भेजा नहीं जा सकता। कम से कम एक लाइन जोड़ें।

**अटक गए तो**
1. Material Suggestions में न आए तो उसका प्रकार और master में होना जाँचें।
2. बिना सेव किए निकलने के लिए "Cancel" दबाएँ।

जुड़े पेज: /procurement/purchase-orders, /procurement/purchase-orders/[id], /inventory/vendors, /system/company-profile
