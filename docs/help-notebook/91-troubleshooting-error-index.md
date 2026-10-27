# Troubleshooting: every message and what to do / हर मैसेज और उसका हल
Search this file for the exact text a user sees on screen.

## Sales (redirect) — /sales
- "Page keeps loading or shows "not found"": The order id in the link is wrong or the order was removed. Open the Orders list and search the SO number.
  - हिंदी: "page लोड होता रहता है या "not found" दिखता है": link में order id गलत है या order हटाया गया है। Orders list खोलकर SO number से search करें।

## Customers — /sales/customers
- "Code is required / Name is required": The form will not save without "Identity Code" and "Legal Entity Name". Fill both.
  - हिंदी: "Code is required / Name is required": "Identity Code" और "Legal Entity Name" के बिना form save नहीं होता। दोनों भरें।
- "Invalid email": Email fields (main and in each extra address) must be a real email or left empty.
  - हिंदी: "Invalid email": email वाले खाने (मुख्य और हर अतिरिक्त पते में) सही email हों या खाली छोड़ें।
- ""Error" toast after save or delete": The server refused, often because the code already exists or the customer is used on orders. Change the code, or set Status to Inactive instead of deleting.
  - हिंदी: "save या delete के बाद "Error" toast": server ने मना किया, अक्सर code पहले से मौजूद होने या ग्राहक के orders में इस्तेमाल होने से। code बदलें, या delete के बजाय Status Inactive करें।

## Job names — /sales/job-names
- "Could not load job names. Refresh to try again.": The report call failed (network or server). Refresh the page.
  - हिंदी: "Could not load job names. Refresh to try again.": report लोड नहीं हुई (network या server)। page refresh करें।
- "No job names yet.": No order has a job name. Type one in the composer's "Job name" box when placing orders.
  - हिंदी: "No job names yet.": किसी order में job name नहीं है। order डालते समय composer के "Job name" खाने में नाम लिखें।

## Sales Orders — /sales/orders
- "Cancel icon missing on an order": Sales can cancel only Draft, Confirmed, Planning or Planned orders. Once the planner has released lines, ask the planner to cancel or short-close them.
  - हिंदी: "किसी order पर cancel icon नहीं है": Sales सिर्फ Draft, Confirmed, Planning या Planned orders cancel कर सकता है। planner ने lines release कर दी हों तो planner से cancel या short-close करवाएँ।
- "Could not cancel order — Released orders must be changed from Planner, not Sales.": A line was released while the dialog was open. Use the Planner.
  - हिंदी: "Could not cancel order — Released orders must be changed from Planner, not Sales.": dialog खुला रहते line release हो गई। Planner से करें।
- "Order already has released, executing, paused, or completed production jobs and cannot be cancelled from Sales.": Production has started on the order. Short-close the rest from the Planner.
  - हिंदी: "Order already has released, executing, paused, or completed production jobs and cannot be cancelled from Sales.": order पर production शुरू हो चुका है। बाकी को Planner से short-close करें।
- "Reason is required to cancel sales order lines.": Pick a reason (and a note) before confirming.
  - हिंदी: "Reason is required to cancel sales order lines.": पुष्टि से पहले कारण (और note) चुनें।
- "Select at least one sales order line to cancel.": In line scope, tick at least one line.
  - हिंदी: "Select at least one sales order line to cancel.": line वाले विकल्प में कम से कम एक line पर tick करें।

## Sales order tracker — /sales/orders/[id]
- "Sales order not found": Wrong link or no access. Press "Go back" and open the order from the list.
  - हिंदी: "Sales order not found": गलत link या अनुमति नहीं। "Go back" दबाएँ और list से order खोलें।
- "Order cannot be confirmed from status …": "Confirm commercial" works only on Draft orders; the order has already moved on.
  - हिंदी: "Order cannot be confirmed from status …": "Confirm commercial" सिर्फ Draft order पर चलता है; order आगे बढ़ चुका है।
- "No layer/BOM snapshot on this line.": The line was saved without a frozen BOM. Ask the planner to check the line before release.
  - हिंदी: "No layer/BOM snapshot on this line.": line बिना frozen BOM के save हुई। release से पहले planner से line जाँचवाएँ।

## Customer dispatches — /sales/orders/[id]/dispatches
- "Cannot confirm a dispatch in status …": Only DRAFT can be confirmed.
  - हिंदी: "Cannot confirm a dispatch in status …": सिर्फ DRAFT confirm हो सकता है।
- "Line exceeds dispatchable qty: requested X, dispatchable Y.": Another dispatch already used the qty. Cancel this draft and make a new one with the smaller qty.
  - हिंदी: "Line exceeds dispatchable qty: requested X, dispatchable Y.": किसी और dispatch ने qty ले ली। यह draft cancel करें और कम qty के साथ नया बनाएँ।
- "Line is not ready for dispatch / Line has no completed final output ready to dispatch": Goods are not released from the yard yet, or a partial line has no finished output. Resolve in Planner / Packing Yard first.
  - हिंदी: "Line is not ready for dispatch / Line has no completed final output ready to dispatch": माल अभी yard से release नहीं हुआ, या partial line का तैयार माल नहीं है। पहले Planner / Packing Yard में सुलझाएँ।
- "Cannot cancel a dispatch in status DISPATCHED": A dispatched record cannot be cancelled.
  - हिंदी: "Cannot cancel a dispatch in status DISPATCHED": dispatched record cancel नहीं हो सकता।

## New dispatch — /sales/orders/[id]/dispatches/new
- "Enter qty against at least one line.": All "Dispatch now" boxes are zero. Enter qty on a ready line.
  - हिंदी: "Enter qty against at least one line.": सारे "Dispatch now" खाने शून्य हैं। ready line पर qty भरें।
- "… is not ready for dispatch. Resolve it in Planner first.": The line is not released from packing. Release it in the Packing Yard first.
  - हिंदी: "… is not ready for dispatch. Resolve it in Planner first.": line packing से release नहीं हुई। पहले Packing Yard में release करें।
- "… exceeds dispatchable quantity N.": Lower the qty to the dispatchable figure.
  - हिंदी: "… exceeds dispatchable quantity N.": qty को dispatchable तक कम करें।
- "… has no completed final output ready to dispatch. Re-release or short-close it in Planner.": Partial line with nothing finished; the planner must act.
  - हिंदी: "… has no completed final output ready to dispatch. Re-release or short-close it in Planner.": partial line जिसमें कुछ तैयार नहीं; planner को कदम उठाना होगा।
- "Dispatch quantity must be greater than zero.": Remove the zero or negative qty.
  - हिंदी: "Dispatch quantity must be greater than zero.": शून्य या ऋण qty हटाएँ।

## Order tracking (redirect) — /sales/orders/[id]/tracking
- "Page keeps loading or shows "not found"": The order id in the link is wrong or the order was removed. Open the Orders list and search the SO number.
  - हिंदी: "page लोड होता रहता है या "not found" दिखता है": link में order id गलत है या order हटाया गया है। Orders list खोलकर SO number से search करें।

## New order — /sales/orders/create
- "Packing: set pieces per inner pouch (this inner pouch has no default).": A pouch line has an inner pouch but nobody said how many pouches go in one. Open the line → Packing → "Pieces per inner pouch" and type it, or set a default on the inner pouch in Masters → Packaging. Then the last machine step can count the inner pouches it fills.
  - हिंदी: "Packing: set pieces per inner pouch (this inner pouch has no default).": पाउच लाइन में inner pouch है पर एक inner pouch में कितने पाउच जाते हैं यह नहीं लिखा। लाइन खोलें → Packing → "Pieces per inner pouch" भरें, या Masters → Packaging में उस inner pouch का default भरें। तब आखिरी मशीन स्टेप भरे गए inner pouch गिन सकेगा।
- "Line N: set unit price": Rate is zero. Enter the rate in the row or in "Qty & rate".
  - हिंदी: "Line N: set unit price": rate शून्य है। row में या "Qty & rate" में rate भरें।
- "Line N: pick a size / pick a product master / quantity must be > 0": Open the line with "Fix →" and fill the missing box.
  - हिंदी: "Line N: pick a size / pick a product master / quantity must be > 0": "Fix →" से line खोलें और खाली खाना भरें।
- "Line N: Open the line to confirm print and packing": Added through quick-add. Open the line once, check print and packing, press "Done with this line".
  - हिंदी: "Line N: Open the line to confirm print and packing": quick-add से जुड़ी। line एक बार खोलें, print और packing देखें, "Done with this line" दबाएँ।
- "Artwork: pick an approved artwork.": Printed line without artwork. Choose one, or select "Defer to planner".
  - हिंदी: "Artwork: pick an approved artwork.": printed line बिना artwork। artwork चुनें, या "Defer to planner" चुनें।
- "Artwork: selected artwork does not match the selected print method or SHEET/TUBING form.": Change Roto/Flexo or film form to match, or pick another artwork.
  - हिंदी: "Artwork: selected artwork does not match the selected print method or SHEET/TUBING form.": Roto/Flexo या film form मिलाएँ, या दूसरा artwork चुनें।
- "Packing: pcs per inner pouch must be greater than zero.": Fix or clear the override.
  - हिंदी: "Packing: pcs per inner pouch must be greater than zero.": override ठीक करें या खाली करें।
- "Set a promised dispatch date / Pick a customer / Cart is empty — add at least one line": Fill the order facts or add a line.
  - हिंदी: "Set a promised dispatch date / Pick a customer / Cart is empty — add at least one line": order की जानकारी भरें या line जोड़ें।
- "Product master unavailable": A link pointed to a master that is not order-ready (inactive or old version). Pick a current one.
  - हिंदी: "Product master unavailable": link ऐसे master का था जो order के लिए तैयार नहीं (inactive या पुराना version)। नया वाला चुनें।
- "Could not create order — product_master is invalid, inactive, or not the current version.": The master changed after you added the line. Remove the line and add it again.
  - हिंदी: "Could not create order — product_master is invalid, inactive, or not the current version.": line जोड़ने के बाद master बदला। line हटाकर दोबारा जोड़ें।
- "Could not create order — Item …: approved artwork is required when printing is enabled.": Server check: assign approved artwork or defer to planner.
  - हिंदी: "Could not create order — Item …: approved artwork is required when printing is enabled.": server की जाँच: approved artwork दें या planner पर छोड़ें।

## New order (redirect) — /sales/orders/new
- "Page keeps loading or shows "not found"": The order id in the link is wrong or the order was removed. Open the Orders list and search the SO number.
  - हिंदी: "page लोड होता रहता है या "not found" दिखता है": link में order id गलत है या order हटाया गया है। Orders list खोलकर SO number से search करें।

## Quotations — /sales/quotations
- "Duplicate failed / Bulk expire failed": The server refused for one of the selected quotes (for example already converted). Retry with fewer rows.
  - हिंदी: "Duplicate failed / Bulk expire failed": चुनी quotes में से किसी पर server ने मना किया (जैसे पहले से converted)। कम rows के साथ फिर करें।
- "No quotations match these filters.": Press "Clear filters".
  - हिंदी: "No quotations match these filters.": "Clear filters" दबाएँ।

## Quotation workspace — /sales/quotations/[id]
- "Submission blocked — At least one quote line is required.": Add a line and save before "Submit for approval".
  - हिंदी: "Submission blocked — At least one quote line is required.": "Submit for approval" से पहले line जोड़कर save करें।
- "Every line needs qty > 0 and rate > 0.": Fix quantity and rate on each line.
  - हिंदी: "Every line needs qty > 0 and rate > 0.": हर line की quantity और rate ठीक करें।
- "The quotation submitter cannot approve the same revision.": Another authorised user must approve.
  - हिंदी: "The quotation submitter cannot approve the same revision.": किसी दूसरे अधिकृत user को approve करना होगा।
- "Override entry and approval must be performed by different users.": Cost overrides need a second person to approve.
  - हिंदी: "Override entry and approval must be performed by different users.": cost override के लिए दूसरा व्यक्ति approve करे।
- "Only an unfrozen draft quotation revision can be edited.": After submit the revision is frozen. Use "Duplicate quotation" to make a new draft.
  - हिंदी: "Only an unfrozen draft quotation revision can be edited.": submit के बाद revision freeze हो जाता है। नया draft बनाने के लिए "Duplicate quotation" दबाएँ।
- "Customer acceptance reference is required. / Customer rejection reason is required.": Type the PO / email reference or the reason before "Record outcome".
  - हिंदी: "Customer acceptance reference is required. / Customer rejection reason is required.": "Record outcome" से पहले PO / email reference या कारण लिखें।
- "Only an accepted customer quotation revision can be converted.": Record acceptance first; "Convert to Sales Order" shows only for Accepted.
  - हिंदी: "Only an accepted customer quotation revision can be converted.": पहले acceptance दर्ज करें; "Convert to Sales Order" सिर्फ Accepted पर दिखता है।
- "The exact approved cost build must be frozen before conversion.": Save and approve the Cost Build before converting.
  - हिंदी: "The exact approved cost build must be frozen before conversion.": convert से पहले Cost Build save और approve करें।
- "Approval request expired; clone a fresh revision.": Use "Duplicate quotation" and submit again.
  - हिंदी: "Approval request expired; clone a fresh revision.": "Duplicate quotation" से नई बनाकर फिर submit करें।
- "A converted quotation cannot be cancelled or voided; use the Sales Order cancellation flow.": Cancel the sales order from Sales Orders instead.
  - हिंदी: "A converted quotation cannot be cancelled or voided; use the Sales Order cancellation flow.": इसके बजाय Sales Orders से order cancel करें।

## New quotation — /sales/quotations/new
- "Could not create quotation": Customer not found or no access; pick the customer again.
  - हिंदी: "Could not create quotation": ग्राहक नहीं मिला या अनुमति नहीं; ग्राहक फिर चुनें।
- "No customers in the system yet.": Press "Open Customer Master" and add one.
  - हिंदी: "No customers in the system yet.": "Open Customer Master" दबाकर ग्राहक जोड़ें।
- "Submission blocked — At least one quote line is required.": Add a line and save before "Submit for approval".
  - हिंदी: "Submission blocked — At least one quote line is required.": "Submit for approval" से पहले line जोड़कर save करें।
- "Every line needs qty > 0 and rate > 0.": Fix quantity and rate on each line.
  - हिंदी: "Every line needs qty > 0 and rate > 0.": हर line की quantity और rate ठीक करें।

## Trade Orders — /sales/trade-orders
- "Dispatch stock plant is required for trade orders.": Pick "Dispatch stock plant" in the header.
  - हिंदी: "Dispatch stock plant is required for trade orders.": header में "Dispatch stock plant" चुनें।

## Trade order — /sales/trade-orders/[id]
- "Only ACTIVE trading goods can be used on trade orders. / Only ACTIVE materials flagged sellable can be used on trade orders.": The item was made inactive or not sellable in its master. Pick another or fix the master.
  - हिंदी: "Only ACTIVE trading goods can be used on trade orders. / Only ACTIVE materials flagged sellable can be used on trade orders.": item master में inactive या not sellable है। दूसरा चुनें या master ठीक करवाएँ।
- "Line #N: … — insufficient stock (short X)": The plant does not have enough stock at dispatch. Reduce qty or move stock first.
  - हिंदी: "Line #N: … — insufficient stock (short X)": dispatch के समय plant में stock कम है। qty घटाएँ या पहले stock लाएँ।
- "Only DRAFT trade orders can be edited. / Only CONFIRMED trade orders can be dispatched.": The status has moved on; follow the buttons that are shown.
  - हिंदी: "Only DRAFT trade orders can be edited. / Only CONFIRMED trade orders can be dispatched.": status आगे बढ़ चुका; जो buttons दिख रहे हैं वही इस्तेमाल करें।
- "Cannot cancel order in status …": Dispatched or invoiced orders cannot be cancelled.
  - हिंदी: "Cannot cancel order in status …": dispatched या invoiced order cancel नहीं हो सकता।

## Edit trade order — /sales/trade-orders/[id]/edit
- "Dispatch stock plant is required for trade orders.": Pick "Dispatch stock plant" in the header.
  - हिंदी: "Dispatch stock plant is required for trade orders.": header में "Dispatch stock plant" चुनें।
- "Add at least one line before confirming.": Add an item line.
  - हिंदी: "Add at least one line before confirming.": item line जोड़ें।
- "Trade order line quantity must be greater than zero.": Fix the qty.
  - हिंदी: "Trade order line quantity must be greater than zero.": qty ठीक करें।
- "Only ACTIVE trading goods can be used on trade orders. / Only ACTIVE materials flagged sellable can be used on trade orders.": The item was made inactive or not sellable in its master. Pick another or fix the master.
  - हिंदी: "Only ACTIVE trading goods can be used on trade orders. / Only ACTIVE materials flagged sellable can be used on trade orders.": item master में inactive या not sellable है। दूसरा चुनें या master ठीक करवाएँ।
- "Line #N: … — insufficient stock (short X)": The plant does not have enough stock at dispatch. Reduce qty or move stock first.
  - हिंदी: "Line #N: … — insufficient stock (short X)": dispatch के समय plant में stock कम है। qty घटाएँ या पहले stock लाएँ।
- "Only DRAFT trade orders can be edited. / Only CONFIRMED trade orders can be dispatched.": The status has moved on; follow the buttons that are shown.
  - हिंदी: "Only DRAFT trade orders can be edited. / Only CONFIRMED trade orders can be dispatched.": status आगे बढ़ चुका; जो buttons दिख रहे हैं वही इस्तेमाल करें।

## New trade order — /sales/trade-orders/new
- "Dispatch stock plant is required for trade orders.": Pick "Dispatch stock plant" in the header.
  - हिंदी: "Dispatch stock plant is required for trade orders.": header में "Dispatch stock plant" चुनें।
- "Add at least one line before confirming.": Add an item line.
  - हिंदी: "Add at least one line before confirming.": item line जोड़ें।
- "Trade order line quantity must be greater than zero.": Fix the qty.
  - हिंदी: "Trade order line quantity must be greater than zero.": qty ठीक करें।
- "Only ACTIVE trading goods can be used on trade orders. / Only ACTIVE materials flagged sellable can be used on trade orders.": The item was made inactive or not sellable in its master. Pick another or fix the master.
  - हिंदी: "Only ACTIVE trading goods can be used on trade orders. / Only ACTIVE materials flagged sellable can be used on trade orders.": item master में inactive या not sellable है। दूसरा चुनें या master ठीक करवाएँ।
- "Line #N: … — insufficient stock (short X)": The plant does not have enough stock at dispatch. Reduce qty or move stock first.
  - हिंदी: "Line #N: … — insufficient stock (short X)": dispatch के समय plant में stock कम है। qty घटाएँ या पहले stock लाएँ।
- "Only DRAFT trade orders can be edited. / Only CONFIRMED trade orders can be dispatched.": The status has moved on; follow the buttons that are shown.
  - हिंदी: "Only DRAFT trade orders can be edited. / Only CONFIRMED trade orders can be dispatched.": status आगे बढ़ चुका; जो buttons दिख रहे हैं वही इस्तेमाल करें।
- "No available stock item found for this plant.": The plant has no stock of that item; pick another plant or item.
  - हिंदी: "No available stock item found for this plant.": उस plant में वह माल नहीं; दूसरा plant या item चुनें।

## Orders (old link) — /orders
- "Page keeps loading or shows "not found"": The order id in the link is wrong or the order was removed. Open the Orders list and search the SO number.
  - हिंदी: "page लोड होता रहता है या "not found" दिखता है": link में order id गलत है या order हटाया गया है। Orders list खोलकर SO number से search करें।

## Order (old link) — /orders/[id]
- "Page keeps loading or shows "not found"": The order id in the link is wrong or the order was removed. Open the Orders list and search the SO number.
  - हिंदी: "page लोड होता रहता है या "not found" दिखता है": link में order id गलत है या order हटाया गया है। Orders list खोलकर SO number से search करें।

## Order tracking (old link) — /orders/[id]/tracking
- "Page keeps loading or shows "not found"": The order id in the link is wrong or the order was removed. Open the Orders list and search the SO number.
  - हिंदी: "page लोड होता रहता है या "not found" दिखता है": link में order id गलत है या order हटाया गया है। Orders list खोलकर SO number से search करें।

## Create order (old link) — /orders/create
- "Page keeps loading or shows "not found"": The order id in the link is wrong or the order was removed. Open the Orders list and search the SO number.
  - हिंदी: "page लोड होता रहता है या "not found" दिखता है": link में order id गलत है या order हटाया गया है। Orders list खोलकर SO number से search करें।

## Dashboard (redirect) — /dashboard
- "You land on a page you did not expect": The redirect follows your current role. Check the role shown in the top bar and switch it if needed.
  - हिंदी: "उम्मीद से अलग पेज खुल गया": रीडायरेक्ट आपके चालू role के हिसाब से होता है। ऊपर bar में role देखें और ज़रूरत हो तो बदलें।

## System Admin Console — /dashboard/admin
- "System health did not respond. The rest of the ERP is unaffected.": The health endpoint timed out. Press "Retry". Other screens keep working.
  - हिंदी: "System health did not respond. The rest of the ERP is unaffected.": health endpoint ने समय पर जवाब नहीं दिया। "Retry" दबाएँ। बाकी स्क्रीन चलती रहती हैं।
- "Telemetry stale": Vitals are old. Press "Refresh vitals".
  - हिंदी: "Telemetry stale": आँकड़े पुराने हैं। "Refresh vitals" दबाएँ।
- "Could not clear cache / Vacuum failed": The maintenance call failed; the toast shows the server reason. Try again off-shift or check server logs.
  - हिंदी: "Could not clear cache / Vacuum failed": maintenance call fail हुई; toast में server का कारण दिखता है। shift के बाहर फिर कोशिश करें या server log देखें।

## Engineering Hub — /dashboard/engineering
- "Tile shows "—" and "Unavailable"": That list could not be loaded (for example no permission or a server error). The other tiles still work. Reload the page.
  - हिंदी: "tile में "—" और "Unavailable"": वह सूची load नहीं हुई (जैसे permission नहीं या server error)। बाकी tile चलते हैं। पेज reload करें।
- "No engineering queue": No artwork or template is waiting for a decision. Nothing to do.
  - हिंदी: "No engineering queue": कोई artwork या template फ़ैसले के इंतज़ार में नहीं। कुछ करना नहीं है।

## Inventory Control Hub — /dashboard/inventory
- "No aging data / No stage data / No location data": The report returned nothing for that panel, often because no roll stock is recorded yet or the report is still loading.
  - हिंदी: "No aging data / No stage data / No location data": उस पैनल के लिए report खाली आई; अक्सर roll stock दर्ज नहीं या report अभी load हो रही है।
- "All clear": No unresolved stock alerts.
  - हिंदी: "All clear": कोई खुला stock alert नहीं।

## Total Logistics Hub — /dashboard/logistics
- "Logistics data feed is unavailable. Dispatch KPIs are paused instead of showing fallback zeros.": The slip history or orders feed did not load. Press "Retry". Tiles show "Unavailable" until it loads.
  - हिंदी: "Logistics data feed is unavailable. Dispatch KPIs are paused instead of showing fallback zeros.": slip history या order feed load नहीं हुई। "Retry" दबाएँ। तब तक tile "Unavailable" दिखाते हैं।
- "Challan flow is unavailable until the logistics API syncs again.": Same cause; retry, or work directly in Dispatch Bay.
  - हिंदी: "Challan flow is unavailable until the logistics API syncs again.": कारण वही; retry करें या सीधे Dispatch Bay में काम करें।

## Operator dashboard (redirect) — /dashboard/operator
- "Machine shows no job": The WC manager has not released a job to that machine yet. Ask the WC manager to release it from the WC terminal.
  - हिंदी: "Machine पर कोई job नहीं": WC manager ने उस machine पर अभी job release नहीं किया। WC manager से WC terminal से release करवाएँ।

## Owner dashboard — /dashboard/owner
- "Data unavailable": The owner dashboard feed failed. Press "Refresh".
  - हिंदी: "Data unavailable": owner dashboard feed fail हुई। "Refresh" दबाएँ।
- "Waiting for material postings / Waiting for ink postings": No issues or returns posted in the period yet.
  - हिंदी: "Waiting for material postings / Waiting for ink postings": इस समय में अभी कोई issue या return post नहीं हुआ।
- "No costed revenue in the last six months": Costing has not been posted for dispatched orders.
  - हिंदी: "No costed revenue in the last six months": dispatch हुए order की costing post नहीं हुई।

## Planner Command Center — /dashboard/planner
- "Planner analytics feed is unavailable. This panel is paused instead of showing fallback zeros.": The planner dashboard feed failed. Press "Refresh"; the Control Tower may still work.
  - हिंदी: "Planner analytics feed is unavailable. This panel is paused instead of showing fallback zeros.": planner dashboard feed fail हुई। "Refresh" दबाएँ; Control Tower फिर भी चल सकता है।
- "Planner data feed unavailable": KPI and action cards are paused until the next successful sync.
  - हिंदी: "Planner data feed unavailable": अगले सफल sync तक KPI और action card रुके हैं।

## Planner Control Tower (redirect) — /dashboard/planner/control-tower
- "Number keys change the tab unexpectedly": Keys 1–7 are tab shortcuts when the cursor is not in a field. Click into the search box before typing numbers.
  - हिंदी: "Number key से tab अचानक बदल गया": cursor किसी field में न हो तो 1–7 tab shortcut हैं। नंबर लिखने से पहले search box में click करें।

## Command — /dashboard/planner/control-tower/command
- "Queue is clear": No open queue rows.
  - हिंदी: "Queue is clear": कोई खुली queue row नहीं।
- "No source pools": No positive FG, WIP, invariant, POD or packaging pool rows were returned; the card shows release readiness instead.
  - हिंदी: "No source pools": कोई FG, WIP, invariant, POD या packaging pool नहीं मिला; card उसकी जगह release readiness दिखाता है।
- "Feed failed in the status line": One of the two reads timed out. Press "Refresh"; nothing is lost.
  - हिंदी: "status line में feed fail": दोनों में से एक read समय पर नहीं आई। "Refresh" दबाएँ; कुछ खोया नहीं।

## Completed Trace — /dashboard/planner/control-tower/completed-trace
- "No closed orders": Nothing closed in the chosen window. Pick a wider window.
  - हिंदी: "No closed orders": चुने समय में कुछ बंद नहीं हुआ। बड़ा समय चुनें।

## Combine Orders — /dashboard/planner/control-tower/gang-builder
- "Select at least 2 jobs to commit a gang.": Tick two or more orders.
  - हिंदी: "Select at least 2 jobs to commit a gang.": दो या ज़्यादा order tick करें।
- "Selected jobs must use the same Product Master before they can share one jumbo.": Pick orders from one group only.
  - हिंदी: "Selected jobs must use the same Product Master before they can share one jumbo.": सिर्फ़ एक group से order चुनें।
- "Selected jobs must be at the same route step and process before they can share one jumbo.": One job moved on; refresh and pick again.
  - हिंदी: "Selected jobs must be at the same route step and process before they can share one jumbo.": कोई job आगे बढ़ गया; refresh करके फिर चुनें।
- "Selected jobs need target roll width before they can share one jumbo.": Set the width on the order line, or leave that job out.
  - हिंदी: "Selected jobs need target roll width before they can share one jumbo.": order line पर width भरें, या उस job को छोड़ दें।
- "Some selected jobs are not open or do not exist.": A job started or closed meanwhile. Press "Refresh".
  - हिंदी: "Some selected jobs are not open or do not exist.": इस बीच कोई job शुरू या बंद हो गया। "Refresh" दबाएँ।

## Live Production — /dashboard/planner/control-tower/live-production
- "Print colors can be revised only after Planner release and before completion.": The line is not released yet or is already complete.
  - हिंदी: "Print colors can be revised only after Planner release and before completion.": line अभी release नहीं हुई या पूरी हो चुकी है।
- "Only Planner or an authorised administrator can revise released print colors.": Ask the planner to do it.
  - हिंदी: "Only Planner or an authorised administrator can revise released print colors.": planner से करवाएँ।
- "Cancel is locked because this line is already closed.": Closed lines cannot be cancelled or short-closed again. Goods made for them are handled in Dispatch Bay (ship or move to stock).
  - हिंदी: "Cancel is locked because this line is already closed.": बंद line दोबारा cancel या short-close नहीं होती। उनका बना माल Dispatch Bay में (भेजें या stock में डालें) संभालें।
- "Stock order cancel from Control Hub is not enabled here. Use the stock order lifecycle action.": Short close and cancel here are for sales lines only.
  - हिंदी: "Stock order cancel from Control Hub is not enabled here. Use the stock order lifecycle action.": यहाँ short close और cancel सिर्फ़ sales line के लिए हैं।

## Plan queue — /dashboard/planner/control-tower/plan-queue
- "Artwork assignment is required before release for printing-enabled order.": Press "Assign artwork" first.
  - हिंदी: "Artwork assignment is required before release for printing-enabled order.": पहले "Assign artwork" दबाएँ।
- "Artwork must be APPROVED before assignment.": Ask engineering to approve the artwork on the Artworks page.
  - हिंदी: "Artwork must be APPROVED before assignment.": engineering से Artworks पेज पर artwork approve करवाएँ।
- "Release is blocked until every planner-decided route step has a work center.": Pick a work center under "Route dispatch" for each step.
  - हिंदी: "Release is blocked until every planner-decided route step has a work center.": "Route dispatch" में हर step का work center चुनें।
- "Allocate at least one candidate to proceed": You chose a stock source but entered no kg. Enter kg or switch to Fresh run.
  - हिंदी: "Allocate at least one candidate to proceed": stock source चुना पर kg नहीं भरा। kg भरें या Fresh run चुनें।
- "Plan saved; release pending": The plan was saved but release failed. Press "Retry release"; do not plan again.
  - हिंदी: "Plan saved; release pending": plan save हुआ पर release fail। "Retry release" दबाएँ; दोबारा plan न करें।
- "Plan not confirmed": The connection ended before confirmation. Press "Confirm saved plan" to recover the same plan.
  - हिंदी: "Plan not confirmed": पुष्टि से पहले connection टूटा। वही plan वापस पाने के लिए "Confirm saved plan" दबाएँ।
- "Saved; queue refresh pending": The order was saved but the queue did not reload. Press "Retry saved queue" or "Refresh". Do not submit again.
  - हिंदी: "Saved; queue refresh pending": order save हुआ पर queue reload नहीं हुई। "Retry saved queue" या "Refresh" दबाएँ। दोबारा submit न करें।
- "Line has machine activity. Use short-close for the remaining quantity.": Cancel is allowed only before machine activity. Use "Short close".
  - हिंदी: "Line has machine activity. Use short-close for the remaining quantity.": cancel सिर्फ़ machine गतिविधि से पहले। "Short close" इस्तेमाल करें।
- "Reason required": Short close and cancel need at least 5 characters of reason for the audit trail.
  - हिंदी: "Reason required": short close और cancel के लिए audit के लिए कम से कम 5 अक्षर का कारण चाहिए।
- "Line must be PLANNED before release. Current: …": The line changed (already released or closed). Press "Refresh" and check its state.
  - हिंदी: "Line must be PLANNED before release. Current: …": line बदल गई (पहले से release या बंद)। "Refresh" दबाएँ और हालत देखें।

## Material readiness — /dashboard/planner/control-tower/stock-intelligence
- "Stock intelligence is paused": A feed failed. Press "Retry feeds".
  - हिंदी: "Stock intelligence is paused": कोई feed fail हुई। "Retry feeds" दबाएँ।
- "Quick launch needs a full template + geometry + layer snapshot": This template has no snapshot in the aggregation. Use the full Stock Order Launcher (link in the dialog).
  - हिंदी: "Quick launch needs a full template + geometry + layer snapshot": इस template का snapshot नहीं है। पूरा Stock Order Launcher इस्तेमाल करें (dialog में link)।
- "Stock order failed": The server refused the order; the toast shows the reason (for example "Template must be the current LIVE version for Stock Order creation").
  - हिंदी: "Stock order failed": server ने order मना किया; toast में कारण है (जैसे "Template must be the current LIVE version for Stock Order creation")।

## Launch stock from any Product Master — /dashboard/planner/control-tower/stock-launcher
- "Template must be the current LIVE version for Stock Order creation": Make the template LIVE in Engineering, then retry.
  - हिंदी: "Template must be the current LIVE version for Stock Order creation": Engineering में template LIVE करें, फिर कोशिश करें।
- "Template has no routing rule": Link a route to the template first.
  - हिंदी: "Template has no routing rule": पहले template पर route जोड़ें।
- "Roll stock orders require quantity_uom=KG": Choose KG for roll stock.
  - हिंदी: "Roll stock orders require quantity_uom=KG": roll stock के लिए KG चुनें।
- "committed_customer is required for customer-committed stock": Pick the customer in the Customer lock, or choose Generic pool.
  - हिंदी: "committed_customer is required for customer-committed stock": Customer lock में customer चुनें, या Generic pool लें।
- "committed_artwork is required for artwork-committed stock": Pick the artwork lock.
  - हिंदी: "committed_artwork is required for artwork-committed stock": artwork lock चुनें।
- "Printing enabled but no inks resolved from artwork.": The chosen artwork has no inks; fix the artwork or pick another.
  - हिंदी: "Printing enabled but no inks resolved from artwork.": चुने artwork में ink नहीं; artwork ठीक करें या दूसरा चुनें।

## Sales Command Center — /dashboard/sales
- "Data unavailable": The sales dashboard feed failed; reload the page.
  - हिंदी: "Data unavailable": sales dashboard feed fail हुई; पेज reload करें।
- "No orders in the last 30 days": No orders created in the window.
  - हिंदी: "No orders in the last 30 days": इस समय में कोई order नहीं बना।

## Work Center Command Deck — /dashboard/work-center
- "Execution Command Deck failed to load": WCM telemetry is unavailable or returned an unstamped fallback; KPI cards are paused instead of showing zeros. Press "Retry sync".
  - हिंदी: "Execution Command Deck failed to load": WCM telemetry नहीं मिली; KPI card शून्य दिखाने की जगह रुके हैं। "Retry sync" दबाएँ।
- "No assigned work centers are open for this WCM role.": Use the WCM terminal to select an available floor context, or ask admin to assign work centers.
  - हिंदी: "No assigned work centers are open for this WCM role.": WCM terminal से उपलब्ध floor context चुनें, या admin से work center assign करवाएँ।

## Production (opens Planner Control Tower) — /production
- "You land on a page you cannot use": The Control Tower is for planning roles. A work-centre manager should use the WC terminal; an operator is kept on the machine terminal.
  - हिंदी: "ऐसा पेज खुलता है जो आपके काम का नहीं": Control Tower प्लानिंग रोल के लिए है। Work-centre manager WC terminal खोलें; operator को machine terminal पर ही रखा जाता है।

## Ink Control Desk — /production/ink-control
- "Ink issue source and floor locations must be in the same plant.": Store and floor were picked from different plants. Pick both under the same plant.
  - हिंदी: "स्टोर और फ्लोर लोकेशन अलग प्लांट की हैं": स्टोर और फ्लोर अलग प्लांट से चुने गए। दोनों एक ही प्लांट के चुनें।
- "Ink floor movements accept INK materials only.": The chosen material is not an ink master. Pick an ink.
  - हिंदी: "केवल INK सामग्री चलती है": चुनी सामग्री ink master नहीं है। ink चुनें।
- "Ink floor window … is already posted for this timestamp.": A count already closed this time window, so a movement cannot be back-dated into it. Use a later event time.
  - हिंदी: "इस समय की खिड़की पहले से पोस्ट है": इस समय-खिड़की की गिनती पहले ही पोस्ट हो चुकी है, इसलिए उसमें पुरानी तारीख की मूवमेंट नहीं जा सकती। बाद का event time डालें।
- "Quantity must be positive.": Enter kg above zero. The buttons stay off until plant, floor, ink and quantity are filled.
  - हिंदी: "मात्रा शून्य से ज़्यादा हो": kg शून्य से ज़्यादा लिखें। प्लांट, फ्लोर, ink और मात्रा भरे बिना बटन चालू नहीं होते।
- "Mix ink base type must be POLY or PET. / Mix ink color name is required.": For "Mix Return" choose POLY or PET and type the colour.
  - हिंदी: "मिक्स ink का बेस और रंग चाहिए": "Mix Return" में POLY या PET चुनें और रंग लिखें।
- "Count location does not belong to selected plant.": Re-select the plant, then the floor location from its list.
  - हिंदी: "गिनती की लोकेशन इस प्लांट की नहीं": प्लांट फिर से चुनें, फिर उसी सूची से फ्लोर लोकेशन चुनें।

## Production job — /production/jobs/[id]
- "Job not found": "It may have been removed, or you may not have access to it." The job id is wrong, archived, or outside your work centre.
  - हिंदी: "Job not found": "It may have been removed, or you may not have access to it." job id गलत है, archive हो गया, या आपके work centre से बाहर है।

## Choose your machine — /production/machine-selector
- "No Machines Assigned": "Assign a work center to this manager to unlock its machines." Your account has no machine (operator) or no work centre (WCM). An admin fixes it on System › Users.
  - हिंदी: "No Machines Assigned": "Assign a work center to this manager to unlock its machines." आपके खाते में कोई machine (operator) या work centre (WCM) नहीं दिया गया। Admin इसे System › Users पर ठीक करेगा।
- "Failed to load machines": Network or server problem. Press "Retry".
  - हिंदी: "Failed to load machines": नेटवर्क या सर्वर की समस्या। "Retry" दबाएँ।
- "No machine matched the current search query.": The search or filters hide every card. Press "Clear".
  - हिंदी: "कोई machine नहीं मिली": खोज या फ़िल्टर ने सब कार्ड छिपा दिए। "Clear" दबाएँ।

## Machine Terminal — /production/machine/[machine_id]
- "Output logged. Pieces per inner pouch is not set on this order…": Not an error: the output is saved. The order has no pieces per inner pouch, so no inner pouches were taken at the machine; Packing Yard types the inner packs it fills and the evening count books them. Ask the admin to set "Pouches per inner pouch (default)" on the inner pouch in Masters → Packaging.
  - हिंदी: "Output logged. Pieces per inner pouch is not set on this order…": यह एरर नहीं है: आउटपुट सेव हो गया। ऑर्डर में pieces per inner pouch नहीं है, इसलिए मशीन पर inner pouch नहीं कटे; Packing Yard भरे गए inner packs की गिनती लिखता है और शाम की गिनती उन्हें बुक करती है। एडमिन से Masters → Packaging में inner pouch पर "Pouches per inner pouch (default)" भरवाएँ।
- "… is running JOB-…. Only bulk-to-roll steps (extrusion) run several orders on one machine; pause or finish JOB-… first.": Another order is running on this machine. Pause or complete it first. Only extrusion-type machines (or machines set to "Several orders may run at the same time") run more than one.
  - हिंदी: "machine पर दूसरा job चल रहा है": इस machine पर दूसरा order चल रहा है। पहले उसे Pause या Complete करें। केवल extrusion जैसी machines (या जिन पर "Several orders may run at the same time" सेट है) एक साथ कई चलाती हैं।
- "Machine not assigned. WCM must assign a machine before execution.": The WCM has not released the job to a machine. Ask the WCM to use "Release to machine".
  - हिंदी: "Machine assign नहीं है": WCM ने job किसी machine पर रिलीज़ नहीं किया। WCM से "Release to machine" करवाएँ।
- "Job is not pushed by WCM yet (not EXECUTION_READY).": Preparation is not finished on the WC terminal.
  - हिंदी: "WCM ने job अभी नहीं भेजा": WC terminal पर तैयारी पूरी नहीं हुई।
- "Cannot start job: requirements not satisfied …": Rolls or material are missing for this step. The WCM must reserve rolls or finish the issue.
  - हिंदी: "ज़रूरतें पूरी नहीं": इस step के rolls या सामग्री कम हैं। WCM rolls reserve करे या issue पूरा करे।
- "Wastage is X% of this run (limit Y%). Choose a wastage reason and write why it happened before logging the output.": Trim + scrap is at or above the limit. Choose a reason under "Trim and scrap" and write the note.
  - हिंदी: "वेस्टेज सीमा से ज़्यादा": trim + scrap सीमा के बराबर या ऊपर है। "Trim and scrap" में कारण चुनें और टिप्पणी लिखें।
- "Output exceeds physical cap … / Output (…) exceeds max allowed for this step": You entered more than the loaded rolls can give. Check the weights or load the next roll on the lane.
  - हिंदी: "output सीमा से ज़्यादा": लोड rolls जितना दे सकते हैं उससे ज़्यादा लिखा। वज़न जाँचें या lane पर अगला roll लोड करें।
- "… has … kg left on its loaded rolls … Load the next roll for this lane first.": The tightest lane cannot cover this output. The WCM (or you, while running) adds the next roll.
  - हिंदी: "lane का roll कम है": सबसे कम lane इस output को पूरा नहीं कर सकती। WCM (या चलते समय आप) अगला roll जोड़ें।
- "Job must be EXECUTING to log output.": The job is paused or not started. Press "Resume" or "Start" first.
  - हिंदी: "job चालू होना चाहिए": job रुका है या शुरू नहीं हुआ। पहले "Resume" या "Start" दबाएँ।
- "Output logged as loose pouches: this order has an inner pouch switched on but no packing material…": Not an error: the output is saved as loose pouches and no inner pouches were taken. Ask the planner or admin to set the inner pouch on the order line; do not log the output again.
  - हिंदी: "Output logged as loose pouches: this order has an inner pouch switched on but no packing material…": यह एरर नहीं है: output loose pouches के रूप में सेव हो गया और कोई inner pouch नहीं कटा। planner या admin से order line पर inner pouch सेट करवाएँ; output दोबारा न लिखें।
- "No new output logged since last completion.": Log output before completing again.
  - हिंदी: "पिछली बार के बाद नया output नहीं": दोबारा complete करने से पहले output लिखें।

## Planner (opens Control Tower) — /production/planner
- "Blank page after redirect": Your role cannot open the Control Tower. Ask an admin for a planning role.
  - हिंदी: "रीडायरेक्ट के बाद खाली पेज": आपका रोल Control Tower नहीं खोल सकता। Admin से प्लानिंग रोल माँगें।

## Combine orders — /production/planner/gang-builder
- "Need at least 2 open orders. / Orders must share one Product Master. / Target roll width is missing. / Current step must create roll output for jumbo slitting.": These show on a "setup needed" group. Fix the width or Product Master on the order line, or wait for more orders.
  - हिंदी: "group setup अधूरा": ये "setup needed" group पर दिखते हैं। order line पर चौड़ाई या Product Master ठीक करें, या और orders का इंतज़ार करें।
- "One or more orders has no roll width set — combining is not safe.": A ticked order has no target width. Untick it or fix the line.
  - हिंदी: "चौड़ाई नहीं": टिक किए order की चौड़ाई नहीं। उसे हटाएँ या line ठीक करें।
- "Selected jobs must be at the same route step and process before they can share one jumbo.": The jobs moved to different steps since the page loaded. Press "Refresh".
  - हिंदी: "step अलग है": पेज खुलने के बाद jobs अलग steps पर चले गए। "Refresh" दबाएँ।
- "Some selected jobs are not open or do not exist.": A job was completed or cancelled meanwhile. Refresh and tick again.
  - हिंदी: "job खुला नहीं": इस बीच कोई job पूरा या रद्द हुआ। रिफ्रेश करके फिर टिक करें।

## Factory Heatmap / Capacity — /production/planner/heatmap
- "No work-center capacity rows": No work centre exists yet. Set them up in Factory › Work Centers.
  - हिंदी: "No work-center capacity rows": अभी कोई work centre नहीं। Factory › Work Centers में बनाएँ।

## Stock launcher (moved to Control Tower) — /production/planner/stock-launcher
- "Spinner does not move on": Browser scripts were blocked or the session expired. Reload or sign in again.
  - हिंदी: "spinner चलता रहता है": ब्राउज़र स्क्रिप्ट रुकी या सत्र खत्म हुआ। रीलोड करें या फिर साइन-इन करें।

## Production Planning Board — /production/planning
- "Can only release PLANNED or WAITING jobs. Current state: …": The job already moved on. Refresh the board.
  - हिंदी: "केवल PLANNED या WAITING job रिलीज़ होता है": job आगे बढ़ चुका। board रिफ्रेश करें।
- "The job source changed. Refresh the plan before releasing it.": The planner changed the line; refresh and check again.
  - हिंदी: "job का स्रोत बदला": planner ने line बदली; रिफ्रेश करके फिर देखें।
- "Split quantity must be less than current job quantity. / Only PLANNED jobs can be split.": Enter less than the job quantity, and split only planned jobs.
  - हिंदी: "split नहीं हो सकता": job की मात्रा से कम लिखें, और केवल planned job split करें।
- "Emergency reason is required for EMERGENCY jobwork.": "Detour to Job Work" here sends no reason, so the server refuses it. Send job work from Inventory › Job work instead.
  - हिंदी: "job work के लिए कारण चाहिए": यहाँ "Detour to Job Work" कोई कारण नहीं भेजता, इसलिए सर्वर मना करता है। job work Inventory › Job work से भेजें।
- "Can only resume PAUSED jobs.": The job is not paused. Refresh.
  - हिंदी: "केवल रुका job फिर चलता है": job रुका नहीं है। रिफ्रेश करें।

## Choose your machine group (WC terminal) — /production/work-center
- "No work center matched the current search query.": The search hides all cards, or no work centre is assigned to you. Clear the search; if still empty ask an admin to assign one on System › Users.
  - हिंदी: "कोई work centre नहीं मिला": खोज ने सब छिपा दिया, या आपको कोई work centre नहीं दिया गया। खोज हटाएँ; फिर भी खाली हो तो admin से System › Users पर assign करवाएँ।

## Work Center Terminal — /production/work-center/[id]
- "Selected roll width is outside the planned web ±20 mm. Slit it to the planned web, or use manual override with a reason to allocate it.": The roll is too wide or too narrow. Pick a roll within ±20 mm, a wider one to slit, or use "Policy override" with a reason.
  - हिंदी: "roll की चौड़ाई सीमा से बाहर": roll बहुत चौड़ा या पतला है। ±20 mm वाला roll, slit के लिए चौड़ा roll चुनें, या कारण के साथ "Policy override"।
- "Code split for … must total X kg, got Y kg.": The codes given do not add up to the issued kg. Add or change codes until the total matches.
  - हिंदी: "grade code का जोड़ गलत": दिए कोड का जोड़ issued kg के बराबर नहीं। जोड़ बराबर होने तक कोड जोड़ें या बदलें।
- "… is at another plant. Complete an inter-plant transfer and receipt before release.": Use "Start transfer", then "Confirm received" at this plant.
  - हिंदी: "कोड दूसरे प्लांट में है": "Start transfer" करें, फिर इस प्लांट पर "Confirm received"।
- "Cannot mark ready: requirements not satisfied …": A roll lane, issue or code is still missing. Clear the gate named in the release bar.
  - हिंदी: "रिलीज़ नहीं हो सकता": कोई roll lane, issue या कोड अधूरा है। release bar में बताया गेट साफ़ करें।
- "Machine busy — running JOB-…": The chosen machine runs another order and is not an extrusion-type machine. Pick an idle machine or wait.
  - हिंदी: "Machine busy": चुनी machine दूसरा order चला रही है और extrusion जैसी नहीं है। खाली machine चुनें या इंतज़ार करें।
- "This job is already released to machine execution. Preparation changes are locked.": After release, changes happen only on the machine terminal (or via add/return roll).
  - हिंदी: "तैयारी लॉक है": रिलीज़ के बाद बदलाव केवल machine terminal पर (या roll जोड़ने/लौटाने से) होते हैं।
- "Cannot recalculate this line: …": "Recalculate from masters" is allowed only before any output is logged.
  - हिंदी: "Recalculate नहीं हो सकता": "Recalculate from masters" केवल तब, जब कोई output दर्ज न हुआ हो।
- "Reason required for audit history": Short close and cancel need a reason from the reason master.
  - हिंदी: "कारण ज़रूरी": Short close और cancel के लिए reason master से कारण चाहिए।

## Factory Administration — /factory
- "A card opens a blocked page": Plants, Work Centers, Machines, Locations and Processes are for Admin and Owner. Ask an admin.
  - हिंदी: "कार्ड से पेज नहीं खुलता": Plants, Work Centers, Machines, Locations और Processes Admin और Owner के लिए हैं। Admin से कहें।

## Locations — /factory/locations
- "Code is required / Name is required / Plant is required / Type is required": Fill every field of the form.
  - हिंदी: "ज़रूरी फ़ील्ड खाली": फ़ॉर्म के सब फ़ील्ड भरें।
- "Delete fails with an error toast": The location holds stock or history. Move the stock out, or keep the location.
  - हिंदी: "हटाने पर त्रुटि": लोकेशन में स्टॉक या इतिहास है। स्टॉक हटाएँ, या लोकेशन रहने दें।

## Machines — /factory/machines
- "Machine code '…' already belongs to … in ….": The code is used. Choose another code or press "Open existing machine".
  - हिंदी: "machine कोड पहले से है": कोड इस्तेमाल हो चुका। दूसरा कोड चुनें या "Open existing machine" दबाएँ।
- "Code is required / Name is required / Work Center is required": Fill the fields.
  - हिंदी: "ज़रूरी फ़ील्ड खाली": फ़ील्ड भरें।
- "Machine could not be deleted.": It has jobs or history. Keep it; maintenance marks it DOWN when out of use.
  - हिंदी: "machine हटाई नहीं जा सकी": इस पर jobs या इतिहास है। रहने दें; बंद होने पर मेंटेनेंस DOWN करता है।

## Visual Factory — /factory/overview
- "No machines in this stage yet / No machines yet": No machine is set up for that stage or plant. Use "Set up plants" / "Set up work centers".
  - हिंदी: "कोई machine नहीं": उस stage या प्लांट के लिए machine नहीं बनी। "Set up plants" / "Set up work centers" इस्तेमाल करें।

## Plants — /factory/plants
- "Code is required / Name is required": Fill code and name.
  - हिंदी: "ज़रूरी फ़ील्ड खाली": कोड और नाम भरें।
- "Delete fails with an error toast": The plant still has locations, work centres or stock. Delete is permanent; normally keep the plant.
  - हिंदी: "हटाने पर त्रुटि": plant में अभी locations, work centres या स्टॉक है। हटाना स्थायी है; आम तौर पर plant रहने दें।

## Processes — /factory/processes
- "roll_behavior is immutable after process creation.": Create a new process with the right behaviour instead.
  - हिंदी: "roll behaviour नहीं बदलता": सही behaviour के साथ नया process बनाएँ।
- "System processes cannot be modified. / System processes cannot be deleted.": Built-in processes are locked.
  - हिंदी: "system process नहीं बदलता": built-in processes लॉक हैं।
- "Process is used by existing templates or jobs and cannot be deleted.": Remove it from templates first, or keep it.
  - हिंदी: "process इस्तेमाल में है": पहले templates से हटाएँ, या रहने दें।

## Work Centers — /factory/work-centers
- "Code is required / Name is required / Plant is required": Fill the fields.
  - हिंदी: "ज़रूरी फ़ील्ड खाली": फ़ील्ड भरें।
- "Delete fails with an error toast": The work centre has machines, jobs or route steps. Keep it.
  - हिंदी: "हटाने पर त्रुटि": work centre में machines, jobs या route steps हैं। रहने दें।

## Stock workspace — /inventory
- "Inventory snapshot did not load.": The stock service did not answer. Check the connection and reload; if it repeats, tell the administrator.
  - हिंदी: "Inventory snapshot did not load.": स्टॉक सर्विस ने जवाब नहीं दिया। कनेक्शन देखें और पेज reload करें; बार-बार हो तो administrator को बताएँ।
- "Gate bill card shows "Could not refresh the count"": Only the count failed. Open the queue; it retries itself.
  - हिंदी: "Gate bill कार्ड पर "Could not refresh the count"": सिर्फ़ गिनती नहीं आई। Queue खोलें; वह खुद दोबारा कोशिश करती है।

## Inks · adhesives · solvents — /inventory/addons
- "Could not load add-ons.": The stock snapshot did not load. Reload the page; if it repeats, tell the administrator.
  - हिंदी: "Could not load add-ons.": स्टॉक snapshot नहीं आया। पेज reload करें; बार-बार हो तो administrator को बताएँ।

## Stock Adjustments — /inventory/adjustments
- "No stock adjustments yet": Nothing has been recorded. Press "Create first adjustment".
  - हिंदी: "No stock adjustments yet": अभी कुछ दर्ज नहीं। "Create first adjustment" दबाएँ।

## Stock adjustment — /inventory/adjustments/[id]
- "A stock adjustment needs a second person: someone other than the person who drafted it must post it.": You drafted it. Ask another user with the adjust right (or an Owner/Admin) to post.
  - हिंदी: "A stock adjustment needs a second person: someone other than the person who drafted it must post it.": Draft आपने बनाया है। adjust अधिकार वाले दूसरे user (या Owner/Admin) से post करवाएँ।
- "Line N: adjustment would make stock negative (…)": The minus is more than the stock now at that location. Count again and void/redo with the right quantity.
  - हिंदी: "Line N: adjustment would make stock negative (…)": घटाई गई मात्रा उस location के मौजूदा स्टॉक से ज़्यादा है। दोबारा गिनें और सही मात्रा से void करके नया बनाएँ।
- "Line N: roll … is reserved for a job. Unassign it first.": Remove the roll from the job (planner / job screen) before adjusting it.
  - हिंदी: "Line N: roll … is reserved for a job. Unassign it first.": Adjust करने से पहले roll को job से हटाएँ (planner / job स्क्रीन)।
- "Line N: roll … is …; only an available roll can be adjusted.": Consumed, dispatched, in-transit or job-work rolls are settled by their own flow, not here. A MISSING roll can be added back with a plus.
  - हिंदी: "Line N: roll … is …; only an available roll can be adjusted.": Consumed, dispatched, transit या job-work roll अपने flow से निपटते हैं, यहाँ नहीं। MISSING roll को plus से वापस जोड़ा जा सकता है।
- "Line N: this material is held under several quality codes at this location. Adjust it through a physical count, which records the code.": Use Stock lifecycle → Stock count for this material.
  - हिंदी: "Line N: this material is held under several quality codes at this location. Adjust it through a physical count, which records the code.": इस material के लिए Stock lifecycle → Stock count इस्तेमाल करें।
- "Line N: voiding would make stock negative; the stock has been used since.": The added stock was already consumed. Make a new adjustment for what is really left instead of voiding.
  - हिंदी: "Line N: voiding would make stock negative; the stock has been used since.": जोड़ा गया स्टॉक खर्च हो चुका है। Void की जगह जो सच में बचा है उसके लिए नया adjustment बनाएँ।

## New stock adjustment — /inventory/adjustments/new
- "Save failed / Post failed (red message)": The message names the line and rule, e.g. "BULK adjustments require material and location." or "… is stocked in KG; enter the quantity in KG." Fix that line and save again.
  - हिंदी: "Save failed / Post failed (लाल संदेश)": संदेश लाइन और नियम बताता है, जैसे "BULK adjustments require material and location." या "… is stocked in KG; enter the quantity in KG." वह लाइन ठीक करके फिर सेव करें।
- "… is a virtual location (job work, transit or scrap); its stock is settled by that flow.": Choose a real store location; stock at job worker or in transit is settled by job work / inter-plant.
  - हिंदी: "… is a virtual location (job work, transit or scrap); its stock is settled by that flow.": असली store location चुनें; job worker या transit का स्टॉक job work / inter-plant से निपटता है।
- ""Save" buttons stay grey": Pick a plant and enter a delta on at least one line.
  - हिंदी: ""Save" बटन धूसर रहते हैं": Plant चुनें और कम से कम एक लाइन में delta लिखें।

## Alerts Center — /inventory/alerts
- "No alerts found": Nothing open for this filter. Switch to "All" to see past closes. If you expected alerts, press "Refresh" — a failed load also shows this.
  - हिंदी: "No alerts found": इस filter में कुछ खुला नहीं। पुराने बंद देखने के लिए "All" चुनें। Alert की उम्मीद थी तो "Refresh" दबाएँ — लोड न होने पर भी यही दिखता है।
- "Alert already resolved": Someone closed it first, or the nightly check closed it automatically. Press "Refresh".
  - हिंदी: "Alert already resolved": किसी और ने पहले बंद किया, या रात की जाँच ने खुद बंद कर दिया। "Refresh" दबाएँ।

## Bulk & chemicals — /inventory/bulk
- "Could not load bulk inventory.": The stock snapshot failed. Reload; if it repeats tell the administrator.
  - हिंदी: "Could not load bulk inventory.": स्टॉक snapshot नहीं आया। Reload करें; बार-बार हो तो administrator को बताएँ।
- "No active reservations.": No sales order holds this row; all of it is free.
  - हिंदी: "No active reservations.": कोई sales order इसे नहीं रोक रहा; पूरा खाली है।

## Bulk Transactions — /inventory/bulk-transactions
- "Showing the newest … of … entries": The list is capped. Pick an earlier financial year in the header to see older entries.
  - हिंदी: "Showing the newest … of … entries": सूची सीमित है। पुरानी entries के लिए header में पिछला financial year चुनें।
- "No transactions recorded yet.": No bulk movement in the selected year.
  - हिंदी: "No transactions recorded yet.": चुने साल में कोई bulk आवाजाही नहीं।

## Bills & documents — /inventory/gate-bills
- "Uploading bills needs the documents upload right (Inventory by default).": Ask the Owner/Admin to grant documents upload in the Role matrix.
  - हिंदी: "Uploading bills needs the documents upload right (Inventory by default).": Owner/Admin से Role matrix में documents upload अधिकार माँगें।
- "Upload not confirmed": The network dropped. Press "Send the same upload again" — it never creates a second bill. Discard only if the register does not show it.
  - हिंदी: "Upload not confirmed": नेटवर्क टूटा। "Send the same upload again" दबाएँ — दूसरा बिल नहीं बनेगा। Discard तभी करें जब रजिस्टर में न दिखे।
- "Not added: … is larger than 10 MB / 15 MB": Compress the photo or split the PDF.
  - हिंदी: "Not added: … is larger than 10 MB / 15 MB": फ़ोटो छोटी करें या PDF बाँटें।
- "The register export is limited to … documents. Narrow the dates or filters.": Pick a shorter date range or more filters, then export again.
  - हिंदी: "The register export is limited to … documents. Narrow the dates or filters.": छोटी तारीख़ सीमा या और filter चुनकर फिर export करें।

## Bill / document — /inventory/gate-bills/[id]
- "Someone else saved this document while you were editing.": Another reviewer saved first. Their values are loaded behind your edits; check, then save again or discard yours.
  - हिंदी: "Someone else saved this document while you were editing.": किसी और ने पहले सेव किया। उनके मान आपके बदलाव के पीछे लोड हैं; जाँचें, फिर दोबारा सेव करें या अपने हटाएँ।
- "Save or discard the changed details first, so the next screen uses them.": Press "Save details" before "Open GRN" or the General Receipt button.
  - हिंदी: "Save or discard the changed details first, so the next screen uses them.": "Open GRN" या General Receipt बटन से पहले "Save details" दबाएँ।
- "Only record-only paper can be filed …": Pick a utility, fee, transport or other-expense category, or a note / report document type, before filing.
  - हिंदी: "Only record-only paper can be filed …": File करने से पहले utility, fee, transport या other-expense category, या note / report document type चुनें।
- "A bill with posted receipts cannot be voided. Review its remaining lines.": Receipts are linked; confirm it complete instead, or ask Owner/Admin.
  - हिंदी: "A bill with posted receipts cannot be voided. Review its remaining lines.": Receipt जुड़ी हैं; void की जगह complete करें, या Owner/Admin से पूछें।
- "Same invoice already recorded.": The same vendor bill number is on another document. Void this one as "Duplicate", or give a reason to file/receive it anyway.
  - हिंदी: "Same invoice already recorded.": वही vendor bill नंबर दूसरे document पर है। इसे "Duplicate" से void करें, या फिर भी रखने का कारण लिखें।
- "Posting a GRN needs inventory receiving rights.": An Inventory (Store) user must post the GRN from this bill.
  - हिंदी: "Posting a GRN needs inventory receiving rights.": Inventory (Store) user को इस बिल से GRN post करना होगा।

## Bill viewer (pop-out) — /inventory/gate-bills/[id]/view
- "You cannot open this bill": Bills are for the inventory team; ask an administrator for the documents permission.
  - हिंदी: "You cannot open this bill": बिल inventory टीम के लिए हैं; administrator से documents अनुमति माँगें।
- "This bill link is not valid": Open the bill again from the bill register or the GRN screen.
  - हिंदी: "This bill link is not valid": बिल रजिस्टर या GRN स्क्रीन से बिल फिर खोलें।
- "This bill is no longer available": It belongs to another factory or the link is wrong; reopen it from the register.
  - हिंदी: "This bill is no longer available": दूसरी factory का है या link गलत है; रजिस्टर से फिर खोलें।

## Gate passes — /inventory/gate-passes
- "Gate passes are for the inventory team": Your account has no documents right; ask the administrator.
  - हिंदी: "Gate passes are for the inventory team": आपके खाते में documents अधिकार नहीं; administrator से पूछें।

## Gate pass — /inventory/gate-passes/[id]
- "Only … of line … is still out on …": You entered more than is still out. Enter the remaining quantity or less.
  - हिंदी: "Only … of line … is still out on …": आपने बाहर बची मात्रा से ज़्यादा लिखा। बची मात्रा या कम लिखें।
- "This gate pass was changed by someone else. Reload it and try again.": Reload the page and repeat the action.
  - हिंदी: "This gate pass was changed by someone else. Reload it and try again.": पेज reload करके फिर करें।
- "Set an expected return date of today or later before issuing.": The return date passed while it was a draft; "Edit draft" and set a new date.
  - हिंदी: "Set an expected return date of today or later before issuing.": Draft रहते तारीख़ निकल गई; "Edit draft" से नई तारीख़ डालें।
- "This gate pass is still a draft. Ask the office to issue it before the items leave.": Shown at the gate when a draft is scanned. Press "Issue" here.
  - हिंदी: "This gate pass is still a draft. Ask the office to issue it before the items leave.": Draft scan होने पर गेट पर दिखता है। यहाँ "Issue" दबाएँ।

## New gate pass — /inventory/gate-passes/new
- "A returnable gate pass needs an expected return date.": Fill "Expected back by".
  - हिंदी: "A returnable gate pass needs an expected return date.": "Expected back by" भरें।
- "Choose a vendor or type who the items go to.": Pick a vendor or type the party name.
  - हिंदी: "Choose a vendor or type who the items go to.": Vendor चुनें या party का नाम लिखें।
- "Scrap sale items do not come back. Use a non-returnable gate pass (NRGP).": Switch the type to NRGP.
  - हिंदी: "Scrap sale items do not come back. Use a non-returnable gate pass (NRGP).": Type को NRGP करें।
- "Enter a valid 15-character GSTIN or leave it blank.": Correct the GSTIN or clear it.
  - हिंदी: "Enter a valid 15-character GSTIN or leave it blank.": GSTIN ठीक करें या खाली छोड़ें।
- "Draft saved, but it could not be issued: …": The draft exists; press "Issue" on the next screen after fixing the reason shown.
  - हिंदी: "Draft saved, but it could not be issued: …": Draft बन गया है; बताया कारण ठीक करके अगली स्क्रीन पर "Issue" दबाएँ।

## General receipts — /inventory/general-receipts
- "General receipts are for the Inventory team": No documents view right; ask the administrator.
  - हिंदी: "General receipts are for the Inventory team": Documents देखने का अधिकार नहीं; administrator से पूछें।
- "No general receipts": Nothing for these filters. Clear filters or widen the dates.
  - हिंदी: "No general receipts": इन filter में कुछ नहीं। Filter हटाएँ या तारीख़ बढ़ाएँ।

## General receipt — /inventory/general-receipts/[id]
- "… recorded items coming back on gate pass …, so it cannot be reversed.": Reversing would not undo the return. Correct the gate pass with an owner first and record a fresh receipt if needed.
  - हिंदी: "… recorded items coming back on gate pass …, so it cannot be reversed.": Reverse करने से वापसी नहीं हटेगी। पहले owner के साथ gate pass ठीक करें और ज़रूरत हो तो नई receipt बनाएँ।
- "Only an owner or administrator can reverse a General Receipt.": Ask the Owner/Admin.
  - हिंदी: "Only an owner or administrator can reverse a General Receipt.": Owner/Admin से कहें।
- "General receipt not found": Wrong link or a factory outside your access.
  - हिंदी: "General receipt not found": गलत link या आपकी पहुँच से बाहर की factory।

## New general receipt — /inventory/general-receipts/new
- "Amount must equal quantity × rate = …": Correct the quantity or rate.
  - हिंदी: "Amount must equal quantity × rate = …": Qty या rate ठीक करें।
- "A service receipt needs at least one Service / labour line.": Set one line's type to Service / labour, or switch to Goods.
  - हिंदी: "A service receipt needs at least one Service / labour line.": किसी एक लाइन का type Service / labour करें, या Goods चुनें।
- "A goods receipt needs at least one goods line (not only service or freight).": Add a goods line or switch to Service.
  - हिंदी: "A goods receipt needs at least one goods line (not only service or freight).": Goods लाइन जोड़ें या Service चुनें।
- "Choose the machine (or type the equipment) it was installed on.": Installed lines need a machine or equipment name.
  - हिंदी: "Choose the machine (or type the equipment) it was installed on.": Installed लाइन में machine या equipment का नाम चाहिए।
- "Only … of line … is still out on …": You cannot return more than is still out on the RGP line.
  - हिंदी: "Only … of line … is still out on …": RGP लाइन पर बाहर बची मात्रा से ज़्यादा वापसी नहीं हो सकती।
- "Received time cannot be in the future.": Fix "Received at".
  - हिंदी: "Received time cannot be in the future.": "Received at" ठीक करें।
- "Give a reason to receive a bill whose invoice is already recorded (or void this bill as a duplicate).": Fill the reason in "Same invoice already recorded" or void the bill as duplicate.
  - हिंदी: "Give a reason to receive a bill whose invoice is already recorded (or void this bill as a duplicate).": "Same invoice already recorded" में कारण लिखें या बिल को duplicate void करें।
- "This bill is classified as record-only paper … Change its category before receiving against it.": Go back to the bill and change the category to spares, machinery or service.
  - हिंदी: "This bill is classified as record-only paper … Change its category before receiving against it.": बिल पर लौटकर category spares, machinery या service करें।

## Goods in & out — /inventory/goods-movements
- "Not recorded (after Mark back at gate)": The paper is already received or belongs to another factory's gate. Open the row to check.
  - हिंदी: "Not recorded (Mark back at gate के बाद)": काग़ज़ पहले ही receive हो चुका है या दूसरी factory के गेट का है। Row खोलकर देखें।

## Receive goods (Smart GRN) — /inventory/grn
- "Duplicate vendor invoice '…' for vendor …": This invoice number was already received for this vendor. Check GRN history; correct the old GRN instead of posting again.
  - हिंदी: "Duplicate vendor invoice '…' for vendor …": इस vendor का यह invoice पहले ही लिया जा चुका है। GRN history देखें; दोबारा post करने के बजाय पुरानी GRN सुधारें।
- "Vendor is required before posting GRN.": Pick the vendor in the Source section.
  - हिंदी: "Vendor is required before posting GRN.": Source हिस्से में vendor चुनें।
- "GRN vendor must be RM or BOTH type.": A job-worker or service vendor cannot supply stock. Change the vendor type in Vendors or pick the right vendor.
  - हिंदी: "GRN vendor must be RM or BOTH type.": Job worker या service vendor से stock नहीं आता। Vendors में type बदलें या सही vendor चुनें।
- "Roll gross weight must equal net + tare within 0.05 KG.": Re-weigh or fix gross / tare; leave net to fill itself.
  - हिंदी: "Roll gross weight must equal net + tare within 0.05 KG.": दोबारा तौलें या gross / tare ठीक करें; net को अपने आप भरने दें।
- "Roll label … already exists.": The label is already used by another roll. Leave the label blank so the system numbers it.
  - हिंदी: "Roll label … already exists.": यह label किसी दूसरे roll पर है। Label खाली छोड़ें, सिस्टम नंबर देगा।
- "Grade is required for extrudable film variants.": Pick the grade on that roll line.
  - हिंदी: "Grade is required for extrudable film variants.": उस roll लाइन में grade चुनें।
- "Selected PO has no receivable lines for this stock class.": The PO is fully received or is for another class. Pick another PO or use Direct receipt.
  - हिंदी: "Selected PO has no receivable lines for this stock class.": PO पूरा आ चुका है या दूसरी class का है। दूसरा PO चुनें या Direct receipt करें।
- "Use the receiving grid while a gate bill is linked. Excel posting does not link this bill.": Enter the rolls in the grid (paste works) so the bill gets linked.
  - हिंदी: "Use the receiving grid while a gate bill is linked. Excel posting does not link this bill.": Roll grid में भरें (paste चलता है) ताकि बिल जुड़ जाए।
- "Stock saved; label download needs retry": The GRN is posted. Use "Download all labels" on the saved receipt; do not post again.
  - हिंदी: "Stock saved; label download needs retry": GRN post हो चुकी है। Saved receipt पर "Download all labels" दबाएँ; दोबारा post न करें।
- "Master data did not load.": Vendors, materials or locations could not be fetched. Refresh; if it repeats tell the admin.
  - हिंदी: "Master data did not load.": Vendor, material या location नहीं आ पाए। Refresh करें; बार-बार हो तो admin को बताएँ।

## GRN history & corrections — /inventory/grn-history
- "Reason is required before this correction can post.": Write the reason; it is kept in the audit trail.
  - हिंदी: "Reason is required before this correction can post.": कारण लिखें; यह audit में रहता है।
- "This roll already has genealogy or consumption history. Use stock count / correction instead.": The roll has been used or split. Fix it with a stock count or adjustment.
  - हिंदी: "This roll already has genealogy or consumption history. Use stock count / correction instead.": Roll इस्तेमाल या split हो चुका है। Stock count या adjustment से सुधारें।
- "Consumed or scrapped rolls cannot be corrected from GRN history.": Use the stock count / correction route.
  - हिंदी: "Consumed or scrapped rolls cannot be corrected from GRN history.": Stock count / correction से करें।
- "Corrected roll weight must be greater than zero.": Enter a positive weight; to remove a roll use a stock adjustment.
  - हिंदी: "Corrected roll weight must be greater than zero.": Positive वज़न भरें; roll हटाना हो तो stock adjustment करें।
- "Cannot reduce this trading-good GRN below already dispatched/adjusted stock.": Part of the stock is already gone; reduce only what is still in stock.
  - हिंदी: "Cannot reduce this trading-good GRN below already dispatched/adjusted stock.": कुछ माल जा चुका है; सिर्फ़ बचे माल तक घटाएँ।

## Inter-Plant Transfers — /inventory/inter-plant
- "Source and destination must be different.": Pick two different plants.
  - हिंदी: "Source and destination must be different.": दो अलग plant चुनें।
- "Roll … is not AVAILABLE. / has an active job reservation.": The roll is reserved or in process. Unreserve it on the WC terminal or pick another roll.
  - हिंदी: "Roll … is not AVAILABLE. / has an active job reservation.": Roll reserved है या चल रहा है। WC terminal पर reservation हटाएँ या दूसरा roll चुनें।
- "Roll … is empty or quarantined.": Release the quarantine or choose another roll.
  - हिंदी: "Roll … is empty or quarantined.": Quarantine हटवाएँ या दूसरा roll लें।
- "System location IN_TRANSIT not found for source plant.": Ask the admin to add the IN_TRANSIT location for that plant.
  - हिंदी: "System location IN_TRANSIT not found for source plant.": Admin से उस plant में IN_TRANSIT location बनवाएँ।
- "Challan is not IN_TRANSIT.": It was already received or never dispatched. Refresh the page.
  - हिंदी: "Challan is not IN_TRANSIT.": पहले ही receive हो चुका है या dispatch नहीं हुआ। Page refresh करें।
- "Select at least one pending challan line to receive.": Tick the rolls / bulk that arrived.
  - हिंदी: "Select at least one pending challan line to receive.": जो roll / bulk आया उसे tick करें।
- "Popup blocked. Allow popups to print challan.": Allow pop-ups for the ERP in the browser and press Print again.
  - हिंदी: "Popup blocked. Allow popups to print challan.": Browser में ERP के pop-up चालू करें और फिर Print दबाएँ।

## Inter-plant challan · Preview and Print — /inventory/inter-plant/print/[id]
- "Unable to load PDF preview.": The challan id is wrong or the server failed. Reopen Print from the challan card.
  - हिंदी: "Unable to load PDF preview.": Challan id गलत है या server में दिक्कत। Challan card से Print फिर खोलें।
- "Popup was blocked. Use "Open PDF" and print from the viewer.": Allow pop-ups or use Open PDF.
  - हिंदी: "Popup was blocked. Use "Open PDF" and print from the viewer.": Pop-up चालू करें या Open PDF लें।

## Job work — /inventory/job-work
- "Vendor is not compatible for this jobwork context.": The job worker must be active, of type Job worker/Hybrid, support the process and be mapped to the plant. Fix the vendor master.
  - हिंदी: "Vendor is not compatible for this jobwork context.": Job worker active हो, type Job worker/Hybrid हो, process करता हो और plant से जुड़ा हो। Vendor master ठीक करें।
- "Pick the production job whose route step goes to job work.": A planned route step needs its job.
  - हिंदी: "Pick the production job whose route step goes to job work.": Planned route step के लिए job चुनना ज़रूरी है।
- "Say why this work goes out in an emergency.": Fill "Why is it going out?" for an emergency handoff.
  - हिंदी: "Say why this work goes out in an emergency.": Emergency handoff में "Why is it going out?" भरें।
- "Job … is …; only released, running or paused jobs can go to job work.": Release the job in the planner first.
  - हिंदी: "Job … is …; only released, running or paused jobs can go to job work.": पहले planner में job release करें।
- "This document is not classified as a job-work bill. Change its category in Bills & documents first.": Classify the bill as job work, then reopen.
  - हिंदी: "This document is not classified as a job-work bill. Change its category in Bills & documents first.": बिल को job work में classify करें, फिर खोलें।

## Job-work order — /inventory/job-work/[id]
- "Material balance is off by … kg (…%). Explain the difference to close.": Sent ≠ output + balance + wastage beyond the tolerance. Recheck weights or give the reason.
  - हिंदी: "Material balance is off by … kg (…%). Explain the difference to close.": भेजा ≠ output + balance + wastage, tolerance से ज़्यादा। वज़न फिर जाँचें या कारण लिखें।
- "Enter the HSN code for …": Every challan line prints an HSN code (e.g. 3920 plastic film).
  - हिंदी: "Enter the HSN code for …": हर challan लाइन पर HSN code छपता है (जैसे 3920 plastic film)।
- "…: the balance roll must weigh more than 0 and less than … kg.": For "Partly used" enter a balance below the sent weight; use "Came back unused" for the full roll.
  - हिंदी: "…: the balance roll must weigh more than 0 and less than … kg.": "Partly used" में भेजे वज़न से कम balance भरें; पूरा roll लौटा हो तो "Came back unused"।
- "Finished pieces can only be received against a production job. Link the job.": FG batches belong to a job; receive as rolls/bulk or link the job.
  - हिंदी: "Finished pieces can only be received against a production job. Link the job.": FG batch job का होता है; roll/bulk में लें या job जोड़ें।
- "Explain why the order is closed short (at least 5 characters).": Write a clear reason.
  - हिंदी: "Explain why the order is closed short (at least 5 characters).": साफ़ कारण लिखें।
- "This is the job's last route step. Finished pieces can be packed and dispatched as they come back; close the order when everything is back.": Continue production is not needed on the last step.
  - हिंदी: "This is the job's last route step. Finished pieces can be packed and dispatched as they come back; close the order when everything is back.": आख़िरी step पर Continue production की ज़रूरत नहीं।
- "This bill is from another vendor.": Open the order of the bill's job worker.
  - हिंदी: "This bill is from another vendor.": बिल वाले job worker का order खोलें।

## Inventory / Ledger — /inventory/ledger
- "No matching records": The search or operation filter hides everything, or the row is older than the latest rows loaded. Clear the search or use the stock card.
  - हिंदी: "No matching records": Search या filter से सब छिप गया, या लाइन लोड हुई ताज़ा लाइनों से पुरानी है। Search हटाएँ या stock card देखें।

## Roll Movements — /inventory/movements
- "No movements found for the current filter.": Clear the search. If it stays empty, the list may have failed to load; press Refresh.
  - हिंदी: "No movements found for the current filter.": Search हटाएँ। फिर भी खाली रहे तो list लोड नहीं हुई होगी; Refresh दबाएँ।

## Outward documents — /inventory/outward-documents
- "Outward documents are for the inventory team": Your account lacks the "Match outward gate photos" right; an administrator can grant it in the role matrix. Watchmen record departures on the gate terminal.
  - हिंदी: "Outward documents are for the inventory team": आपके account में "Match outward gate photos" अधिकार नहीं; admin role matrix में दे सकता है। Watchman gate terminal पर departure दर्ज करते हैं।
- "Choose an ordered date range of 366 days or fewer.": Fix Left from / Left to.
  - हिंदी: "Choose an ordered date range of 366 days or fewer.": Left from / Left to ठीक करें।

## Match outward departure — /inventory/outward-documents/[id]
- "Link at least one ERP document before marking the departure matched.": Link a document or add a paper first.
  - हिंदी: "Link at least one ERP document before marking the departure matched.": पहले document link करें या paper जोड़ें।
- "This document is already linked to the departure.": It is already in the list.
  - हिंदी: "This document is already linked to the departure.": यह पहले से सूची में है।
- "This outward record is voided. Refresh the queue.": Someone voided it; go back to the queue.
  - हिंदी: "This outward record is voided. Refresh the queue.": किसी ने void किया; queue पर लौटें।
- "This document belongs to another factory. It cannot be matched at this gate.": Pick the document of the factory the truck left from.
  - हिंदी: "This document belongs to another factory. It cannot be matched at this gate.": जिस factory से गाड़ी निकली उसी का document चुनें।
- "Linked. The same document also left on …": A challan leaving over several trips is flagged, not blocked.
  - हिंदी: "Linked. The same document also left on …": कई trip में जाने वाला challan सिर्फ़ flag होता है, रुकता नहीं।

## Outward photos (pop-out) — /inventory/outward-documents/[id]/view
- "You cannot open these photos": Ask an administrator for the "Match outward gate photos" right.
  - हिंदी: "You cannot open these photos": Admin से "Match outward gate photos" अधिकार माँगें।
- "This link is not valid": Open the photos again from the outward documents queue.
  - हिंदी: "This link is not valid": Outward documents queue से फोटो फिर खोलें।

## Packaging materials — /inventory/packaging
- "Could not load packaging.": Refresh; if it repeats, tell the admin.
  - हिंदी: "Could not load packaging.": Refresh करें; बार-बार हो तो admin को बताएँ।
- "No packaging items match these filters": Clear filters or search.
  - हिंदी: "No packaging items match these filters": Filter या search हटाएँ।

## Roll workspace — /inventory/rolls
- "Could not load roll inventory.": Refresh; if it repeats, tell the admin.
  - हिंदी: "Could not load roll inventory.": Refresh करें; बार-बार हो तो admin को बताएँ।
- "No rolls match these filters.": Clear chips or search.
  - हिंदी: "No rolls match these filters.": Chip या search हटाएँ।

## Stock conversion workspace — /inventory/stock-conversions
- "Only available rolls can be converted.": Unreserve the roll or pick another.
  - हिंदी: "Only available rolls can be converted.": Roll का reservation हटाएँ या दूसरा लें।
- "Requested child widths plus trim exceed parent width.": Reduce child widths or trim.
  - हिंदी: "Requested child widths plus trim exceed parent width.": Child width या trim घटाएँ।
- "Width slitting requires open-web stock. Use tube-opening for tube stock.": Open the tube first, then slit.
  - हिंदी: "Width slitting requires open-web stock. Use tube-opening for tube stock.": पहले tube खोलें, फिर slit करें।
- "Open tube to one sheet requires lay-flat tube stock.": Pick a lay-flat tube roll.
  - हिंदी: "Open tube to one sheet requires lay-flat tube stock.": Lay-flat tube roll चुनें।
- "Unfold requires folded-web stock.": Pick a folded-web roll.
  - हिंदी: "Unfold requires folded-web stock.": Folded-web roll चुनें।

## Count and close — /inventory/stock-lifecycle
- "Row … has …% variance; a reason code and note are required.": Differences of 2% or more need a reason.
  - हिंदी: "Row … has …% variance; a reason code and note are required.": 2% या ज़्यादा फ़र्क पर कारण ज़रूरी।
- "Select a location for … before posting the count.": Pick the location on that row.
  - हिंदी: "Select a location for … before posting the count.": उस लाइन में location चुनें।
- "Enter counted quantity for at least one row. Physical count posts only rows you enter.": Type at least one count.
  - हिंदी: "Enter counted quantity for at least one row. Physical count posts only rows you enter.": कम से कम एक गिनती भरें।
- "Maker and checker must be different users.": A second person approves a sheet you submitted; only an owner may approve their own.
  - हिंदी: "Maker and checker must be different users.": आपकी submit की sheet कोई दूसरा approve करे; अपनी sheet सिर्फ़ owner खुद approve कर सकता है।
- "E-OS-05: opening blocked because … movement(s) already exist for this material/location in …": Stock already moved this year; use a stock count instead of opening stock.
  - हिंदी: "E-OS-05: opening blocked because … movement(s) already exist for this material/location in …": इस साल stock पहले ही हिल चुका है; opening की जगह stock count करें।
- "Open this financial year before closing it.": Press "Open FY" first.
  - हिंदी: "Open this financial year before closing it.": पहले "Open FY" दबाएँ।
- "Close … before starting another open period.": Only one open year at a time.
  - हिंदी: "Close … before starting another open period.": एक समय में एक ही साल खुला रहता है।
- "Close blocked": A blocker is still open; fix it from its page (receive challans, close job work, finish drafts).
  - हिंदी: "Close blocked": कोई blocker बाकी है; उसके पेज से ठीक करें (challan receive, job work close, draft पूरा)।
- "FY correction can only be created for a closed financial year. Use Stock Count for an open year.": Use Stock count while the year is open.
  - हिंदी: "FY correction can only be created for a closed financial year. Use Stock Count for an open year.": साल खुला हो तो Stock count करें।

## Roll Genealogy — /inventory/traceability
- "More than one roll matches. Select the exact ERP ID after checking supplier reference and location.": The supplier number is on several rolls; pick one of the offered rolls.
  - हिंदी: "More than one roll matches. Select the exact ERP ID after checking supplier reference and location.": Supplier नंबर कई roll पर है; दिखाए गए roll में से एक चुनें।
- "Roll not found for provided query": Check the number; try the ERP ID written on the roll.
  - हिंदी: "Roll not found for provided query": नंबर जाँचें; roll पर लिखा ERP ID डालें।

## Vendor master (Inventory) — /inventory/vendors
- "Code is required / Name is required": Fill both before saving.
  - हिंदी: "Code is required / Name is required": Save से पहले दोनों भरें।
- "GRN vendor must be RM or BOTH type.": Shown on Smart GRN when the type is wrong; change it here.
  - हिंदी: "GRN vendor must be RM or BOTH type.": Type गलत हो तो Smart GRN पर आता है; यहाँ बदलें।

## Dispatch, packing, and transit control — /logistics
- "Logistics could not load (retry box)": The dispatch or inter-plant report failed. Press retry; if it repeats, check the connection or tell the admin.
  - हिंदी: "Logistics लोड नहीं हुआ (retry बॉक्स)": डिस्पैच या इंटर-प्लांट रिपोर्ट नहीं आई। retry दबाएँ; बार-बार हो तो नेटवर्क देखें या एडमिन को बताएँ।
- "No challans found for the selected window.": No slip was created in the report period. Slips appear after Create in Dispatch Bay.
  - हिंदी: "No challans found for the selected window.": उस अवधि में कोई स्लिप नहीं बनी। Dispatch Bay में Create करने के बाद ही स्लिप दिखती है।

## Dispatch Bay — /logistics/dispatch
- "Transporter name is required (printed as TRANSPORT NAME).": The Transporter box is empty. Type it or tap a quick choice.
  - हिंदी: "Transporter name is required (printed as TRANSPORT NAME).": Transporter खाली है। नाम लिखें या कोई quick choice दबाएँ।
- "Delivery location missing for SO-…: enter where it goes.": The order has no shipping address. Type a dispatch-only location in the tray.
  - हिंदी: "Delivery location missing for SO-…: enter where it goes.": ऑर्डर पर शिपिंग पता नहीं है। ट्रे में dispatch-only लोकेशन लिखें।
- "Closed lines on the tray: SO-… L2. Confirm shipping the goods already made for them, or move them to stock.": A closed line is loaded without the tick. Tick "Send goods of closed lines", or take the line off and use "Move to stock".
  - हिंदी: "Closed lines on the tray: SO-… L2. Confirm shipping the goods already made for them, or move them to stock.": बंद लाइन बिना टिक के लोड है। "Send goods of closed lines" टिक करें, या लाइन हटाकर "Move to stock" करें।
- "Sales Order SO-… is DRAFT; a challan cannot be created in this order state.": A draft order never dispatches. Ask sales to place the order.
  - हिंदी: "Sales Order SO-… is DRAFT; a challan cannot be created in this order state.": ड्राफ्ट ऑर्डर कभी डिस्पैच नहीं होता। सेल्स से ऑर्डर प्लेस करवाएँ।
- "Gonny … is not released from Packing Yard. / Roll … is not released to Dispatch Bay yet.": The unit was not released. Release it in Packing Yard first.
  - हिंदी: "Gonny … is not released from Packing Yard. / Roll … is not released to Dispatch Bay yet.": यूनिट रिलीज़ नहीं हुई। पहले Packing Yard में रिलीज़ करें।
- "Batch … is on hold at the packing check … A supervisor must accept it with a reason before dispatch.": The packing check found a difference. A supervisor accepts it in Packing Yard → Details → Packing check.
  - हिंदी: "Batch … is on hold at the packing check … A supervisor must accept it with a reason before dispatch.": पैकिंग चेक में अंतर मिला। सुपरवाइज़र Packing Yard → Details → Packing check में कारण देकर स्वीकार करे।
- "Selected dispatch unit is already reserved or dispatched: …": Someone else loaded it on another slip. Press Refresh and load again.
  - हिंदी: "Selected dispatch unit is already reserved or dispatched: …": किसी और ने इसे दूसरी स्लिप पर ले लिया। Refresh करके फिर लोड करें।
- "POD can only be confirmed for a dispatched challan, not DRAFT": Mark the slip dispatched first, then confirm POD.
  - हिंदी: "POD can only be confirmed for a dispatched challan, not DRAFT": पहले स्लिप dispatched करें, फिर POD।
- "Epson print failed": The print job could not be prepared or the PC has no Epson helper. Install "Epson setup" or use "A4 PDF".
  - हिंदी: "Epson print failed": प्रिंट जॉब नहीं बना या PC पर Epson helper नहीं है। "Epson setup" इंस्टॉल करें या "A4 PDF" लें।

## Packing Yard — /logistics/packing
- "Variance reason is required when actual gonny gross weight differs from expected by more than 2%.": The scale weight is more than 2 % off. Re-weigh, or write why (extra packing, wrong count…).
  - हिंदी: "Variance reason is required when actual gonny gross weight differs from expected by more than 2%.": तराज़ू का वज़न 2 % से ज़्यादा अलग है। फिर से तौलें, या कारण लिखें (ज़्यादा पैकिंग, गलत गिनती…)।
- "Insufficient quantity: requested X, available Y": More pouches typed than are left in the batch. Lower the count.
  - हिंदी: "Insufficient quantity: requested X, available Y": बैच में बचे पाउच से ज़्यादा लिखे गए। संख्या कम करें।
- "Gonny … must be SEALED before release to dispatch.": Open gonnies cannot be released. Weigh it in the list to seal it.
  - हिंदी: "Gonny … must be SEALED before release to dispatch.": खुली गोनी रिलीज़ नहीं होती। लिस्ट में तौलकर सील करें।
- "Batch … is on hold at the packing check …": The packing check is outside limits. A production supervisor or manager presses "Accept with reason" in Details → Packing check.
  - हिंदी: "Batch … is on hold at the packing check …": पैकिंग चेक लिमिट से बाहर है। प्रोडक्शन सुपरवाइज़र या मैनेजर Details → Packing check में "Accept with reason" दबाए।
- "Roll … has no packaging lines. Select at least one packing master or release unpacked.": "Packed roll" needs at least one tick. Tick the items used, or choose "Release unpacked roll".
  - हिंदी: "Roll … has no packaging lines. Select at least one packing master or release unpacked.": "Packed roll" के लिए कम से कम एक टिक चाहिए। आइटम टिक करें, या "Release unpacked roll" चुनें।
- "Bulk roll packing requires rolls in the same FG store. Split the action by location.": Rolls ticked together sit in different stores. Release them in two goes.
  - हिंदी: "Bulk roll packing requires rolls in the same FG store. Split the action by location.": एक साथ टिक किए रोल अलग स्टोर में हैं। दो बार में रिलीज़ करें।
- "No gonny packaging masters exist yet. Add one in Masters › Packaging.": No gonny master, or the gonny has no weight. Ask the master-data person to add it.
  - हिंदी: "No gonny packaging masters exist yet. Add one in Masters › Packaging.": गोनी मास्टर नहीं है, या उसका वज़न नहीं भरा। मास्टर डेटा वाले से जुड़वाएँ।
- "N lines released, then stopped": "Release all" stopped at a line with an error; earlier lines are already released. Fix that line and release it again.
  - हिंदी: "N lines released, then stopped": "Release all" एक लाइन पर गलती से रुका; पहले वाली लाइनें रिलीज़ हो चुकी हैं। उस लाइन को ठीक करके फिर रिलीज़ करें।

## Packing audit — /logistics/packing/audit
- "No evening counts in this range": No count was posted in these dates. Widen the dates or post the count on Evening count.
  - हिंदी: "No evening counts in this range": इन तारीखों में कोई गिनती नहीं हुई। तारीख बढ़ाएँ या Evening count पर गिनती पोस्ट करें।
- "The yard ticked N but the count says … used.": Ticks and count disagree; the use was still shared by ticks. Re-check the physical count or ask the yard about missing ticks.
  - हिंदी: "The yard ticked N but the count says … used.": टिक और गिनती मेल नहीं खाते; खपत फिर भी टिक के अनुसार बँटी। असली गिनती दोबारा देखें या यार्ड से छूटे टिक पूछें।
- "No ticks in this range": Nothing was ticked at release in these dates.
  - हिंदी: "No ticks in this range": इन तारीखों में रिलीज़ पर कुछ टिक नहीं हुआ।

## Evening packing count — /logistics/packing/consumption
- "Count failed": The server refused the count (for example "… is not a packaging material."). Read the message, fix the row and post again.
  - हिंदी: "Count failed": सर्वर ने गिनती नहीं ली (जैसे "… is not a packaging material.")। संदेश पढ़ें, लाइन ठीक करें और फिर पोस्ट करें।
- ""Post count" stays disabled": There are no packing items to count at this location (no active packing masters in Masters › Packaging and no packing stock there). It is also off while the list loads, after every count box is cleared, or while a post is running. Normally rows start filled with the book quantity, so the button is on.
  - हिंदी: ""Post count" बंद रहता है": इस लोकेशन पर गिनने को कोई पैकिंग आइटम नहीं है (Masters › Packaging में कोई active पैकिंग मास्टर नहीं और यहाँ कोई पैकिंग स्टॉक नहीं)। लिस्ट लोड होते समय, सारे गिनती के खाने खाली करने पर, या post चलते समय भी बटन बंद रहता है। आम तौर पर लाइनें book मात्रा से भरी आती हैं, इसलिए बटन चालू रहता है।
- "No packing throughput on this date.": Nothing was packed at this location by this time. Use counted here still goes to orders packed elsewhere in the plant that day that ticked the item or have it in their packing plan; only if there are none is it left on no order.
  - हिंदी: "No packing throughput on this date.": इस समय तक इस लोकेशन पर कुछ पैक नहीं हुआ। यहाँ गिनी खपत फिर भी उस दिन प्लांट में कहीं और पैक हुए उन ऑर्डरों पर जाती है जिन्होंने आइटम टिक किया या जिनके packing plan में वो है; ऐसे ऑर्डर न हों तभी किसी ऑर्डर पर नहीं जाती।

## Transit Tracking — /logistics/transit
- "Figures never change": The page is not connected to live data yet. Use Dispatch Bay history or the Dispatch report.
  - हिंदी: "आँकड़े कभी नहीं बदलते": पेज अभी असली डेटा से जुड़ा नहीं है। Dispatch Bay history या Dispatch report देखें।

## Gate register (gate home) — /gate
- "No gate access": The account is not set up for the gate terminal. Ask an admin or owner to give the Watchman role or gate access.
  - हिंदी: "No gate access": अकाउंट गेट टर्मिनल के लिए सेट नहीं है। एडमिन या ओनर से Watchman रोल या गेट एक्सेस माँगें।
- "Gate not assigned": Your account has no plant gate, so the register is locked. An admin or owner assigns the gate in User Management (Gate assignment); then sign in again.
  - हिंदी: "Gate not assigned": आपके अकाउंट को कोई प्लांट गेट नहीं मिला, इसलिए रजिस्टर बंद है। एडमिन या ओनर User Management (Gate assignment) में गेट दें; फिर दोबारा लॉगिन करें।
- "Gate server not reachable": The phone has no internet. Check the connection and try again; nothing has been recorded.
  - हिंदी: "Gate server not reachable": फ़ोन में इंटरनेट नहीं है। नेटवर्क देखकर फिर कोशिश करें; कुछ दर्ज नहीं हुआ।

## Goods coming back in — /gate/arrivals
- "This challan is for <plant>, not this gate.": The inter-plant challan is addressed to another factory. Send the vehicle to the right plant or call the office.
  - हिंदी: "This challan is for <plant>, not this gate.": इंटर-प्लांट चालान दूसरी फ़ैक्टरी के लिए है। गाड़ी सही प्लांट भेजें या ऑफ़िस को फ़ोन करें।
- "Inter-plant challan … is already received here.": It was received before; do not record it again.
  - हिंदी: "Inter-plant challan … is already received here.": पहले ही रिसीव हो चुका है; फिर से दर्ज न करें।
- "Gate pass … is non-returnable: nothing is expected back on it.": Nothing should come back on this pass. Ask the store or office what the goods are.
  - हिंदी: "Gate pass … is non-returnable: nothing is expected back on it.": इस पास पर कुछ वापस नहीं आना था। स्टोर या ऑफ़िस से पूछें माल क्या है।
- "This job-work challan belongs to another factory.": Job-work material returns to the factory that sent it.
  - हिंदी: "This job-work challan belongs to another factory.": जॉब-वर्क का माल उसी फ़ैक्टरी में लौटता है जिसने भेजा था।
- "This gate pass is not in the ERP. / This inter-plant challan is not in the ERP.": The QR is not one of our papers. Use "Take bill photo" for a supplier bill.
  - हिंदी: "This gate pass is not in the ERP. / This inter-plant challan is not in the ERP.": QR हमारा कागज़ नहीं है। सप्लायर बिल हो तो "Take bill photo" इस्तेमाल करें।
- "Gate not assigned": Your account has no plant gate, so the register is locked. An admin or owner assigns the gate in User Management (Gate assignment); then sign in again.
  - हिंदी: "Gate not assigned": आपके अकाउंट को कोई प्लांट गेट नहीं मिला, इसलिए रजिस्टर बंद है। एडमिन या ओनर User Management (Gate assignment) में गेट दें; फिर दोबारा लॉगिन करें।

## Goods at the gate — /gate/goods
- "Type the invoice number from the paper. / Type the vehicle number from the plate.": A required box is empty or too short.
  - हिंदी: "Type the invoice number from the paper. / Type the vehicle number from the plate.": ज़रूरी खाना खाली है या बहुत छोटा है।
- "Choose the customer from the master list.": Pick the party from the list; free text is not allowed.
  - हिंदी: "Choose the customer from the master list.": लिस्ट से पार्टी चुनें; खुद से लिखा नाम नहीं चलता।
- "No ERP document found": Save it anyway with the items you see; it is marked for owner review.
  - हिंदी: "No ERP document found": फिर भी देखे गए आइटम के साथ सेव करें; ये ओनर रिव्यू में जाएगा।
- "This invoice or active visitor is already recorded. Refresh the gate register.": The same invoice was saved before. Check Today's register.
  - हिंदी: "This invoice or active visitor is already recorded. Refresh the gate register.": यही इनवॉइस पहले सेव हो चुका है। Today's register देखें।
- "Gate not assigned": Your account has no plant gate, so the register is locked. An admin or owner assigns the gate in User Management (Gate assignment); then sign in again.
  - हिंदी: "Gate not assigned": आपके अकाउंट को कोई प्लांट गेट नहीं मिला, इसलिए रजिस्टर बंद है। एडमिन या ओनर User Management (Gate assignment) में गेट दें; फिर दोबारा लॉगिन करें।

## Gate history — /gate/history
- "Not available — This page is for administrators and owners.": Watchmen and report delegates cannot open this page. Use the gate terminal or the Gate report.
  - हिंदी: "Not available — This page is for administrators and owners.": वॉचमैन और रिपोर्ट वाले यह पेज नहीं खोल सकते। गेट टर्मिनल या Gate report इस्तेमाल करें।
- "Write why this is being corrected (at least 5 characters).": Corrections need a reason for the audit trail.
  - हिंदी: "Write why this is being corrected (at least 5 characters).": ऑडिट ट्रेल के लिए सुधार का कारण चाहिए।
- "Change at least one field to record a correction.": Nothing was changed.
  - हिंदी: "Change at least one field to record a correction.": कुछ भी नहीं बदला गया।
- "Choose an ordered date range of 366 days or fewer.": The from/to dates are reversed or too far apart.
  - हिंदी: "Choose an ordered date range of 366 days or fewer.": तारीखें उल्टी हैं या बहुत दूर हैं।

## Take bill photo — /gate/inward-bills
- "A bill can have at most 6 pages. Extra photos were not added.": Only six pages fit one bill. Record a second arrival for a very long bill.
  - हिंदी: "A bill can have at most 6 pages. Extra photos were not added.": एक बिल में छह पेज ही आते हैं। बहुत लंबा बिल हो तो दूसरा आगमन दर्ज करें।
- "Not available — Bill photos are recorded by the gate watchman or an administrator/owner.": Your role cannot record bill arrivals.
  - हिंदी: "Not available — Bill photos are recorded by the gate watchman or an administrator/owner.": आपका रोल बिल आगमन दर्ज नहीं कर सकता।
- "Upload stopped / not sure it was saved": Check "Today's arrivals" first. Sending again uses the same upload and cannot record the bill twice.
  - हिंदी: "अपलोड रुका / पता नहीं सेव हुआ या नहीं": पहले "Today's arrivals" देखें। फिर से भेजने पर वही अपलोड जाता है, बिल दो बार दर्ज नहीं होता।
- "Gate not assigned": Your account has no plant gate, so the register is locked. An admin or owner assigns the gate in User Management (Gate assignment); then sign in again.
  - हिंदी: "Gate not assigned": आपके अकाउंट को कोई प्लांट गेट नहीं मिला, इसलिए रजिस्टर बंद है। एडमिन या ओनर User Management (Gate assignment) में गेट दें; फिर दोबारा लॉगिन करें।

## Record outward — /gate/outward
- "This code is not an ERP document code.": The QR is not from our ERP. Remove it; the photos are still enough.
  - हिंदी: "This code is not an ERP document code.": QR हमारे ERP का नहीं है। उसे हटाएँ; फ़ोटो काफ़ी हैं।
- "Could not check now. It is still sent with the photos and checked by the office.": Weak network; you can still record.
  - हिंदी: "Could not check now. It is still sent with the photos and checked by the office.": नेटवर्क कमज़ोर है; फिर भी दर्ज कर सकते हैं।
- "At most 10 codes per departure. / One departure can have at most 6 pages.": Limits per departure. Record a second departure for extra papers.
  - हिंदी: "At most 10 codes per departure. / One departure can have at most 6 pages.": एक रवानगी की सीमा। ज़्यादा कागज़ हों तो दूसरी रवानगी दर्ज करें।
- "Use letters and digits only, for example GJ15AB1234.": Remove spaces and symbols from the vehicle number.
  - हिंदी: "Use letters and digits only, for example GJ15AB1234.": गाड़ी नंबर से स्पेस और चिन्ह हटाएँ।
- "Gate not assigned": Your account has no plant gate, so the register is locked. An admin or owner assigns the gate in User Management (Gate assignment); then sign in again.
  - हिंदी: "Gate not assigned": आपके अकाउंट को कोई प्लांट गेट नहीं मिला, इसलिए रजिस्टर बंद है। एडमिन या ओनर User Management (Gate assignment) में गेट दें; फिर दोबारा लॉगिन करें।

## Visitor QR poster — /gate/qr
- "Not available — This page is for administrators and owners.": Watchmen and report delegates cannot open this page. Use the gate terminal or the Gate report.
  - हिंदी: "Not available — This page is for administrators and owners.": वॉचमैन और रिपोर्ट वाले यह पेज नहीं खोल सकते। गेट टर्मिनल या Gate report इस्तेमाल करें।
- "This gate QR has not been configured.": The plant has no visitor link yet. Open Gate setup for that plant.
  - हिंदी: "This gate QR has not been configured.": प्लांट का विज़िटर लिंक अभी नहीं बना। उस प्लांट के लिए Gate setup खोलें।

## Today's register — /gate/register
- "Could not load today's register. It refreshes automatically.": Network problem; wait or reopen.
  - हिंदी: "Could not load today's register. It refreshes automatically.": नेटवर्क की दिक्कत; रुकें या फिर खोलें।
- "No entries yet today": Nothing saved today in this filter.
  - हिंदी: "No entries yet today": इस फ़िल्टर में आज कुछ सेव नहीं हुआ।
- "Gate not assigned": Your account has no plant gate, so the register is locked. An admin or owner assigns the gate in User Management (Gate assignment); then sign in again.
  - हिंदी: "Gate not assigned": आपके अकाउंट को कोई प्लांट गेट नहीं मिला, इसलिए रजिस्टर बंद है। एडमिन या ओनर User Management (Gate assignment) में गेट दें; फिर दोबारा लॉगिन करें।

## Gate setup — /gate/setup
- "Not available — This page is for administrators and owners.": Watchmen and report delegates cannot open this page. Use the gate terminal or the Gate report.
  - हिंदी: "Not available — This page is for administrators and owners.": वॉचमैन और रिपोर्ट वाले यह पेज नहीं खोल सकते। गेट टर्मिनल या Gate report इस्तेमाल करें।
- "The QR could not be replaced.": The server refused the change; check the reason and try again.
  - हिंदी: "The QR could not be replaced.": सर्वर ने बदलाव नहीं लिया; कारण देखकर फिर कोशिश करें।
- "Could not load the QR link — open the poster to retry.": Network or configuration issue for this plant.
  - हिंदी: "Could not load the QR link — open the poster to retry.": इस प्लांट के लिए नेटवर्क या सेटिंग की दिक्कत।

## Inside now (visitors) — /gate/visitors
- "No visitors inside": Visitors appear as soon as they submit the gate QR form.
  - हिंदी: "No visitors inside": विज़िटर QR फ़ॉर्म भरते ही यहाँ दिखते हैं।
- "This account cannot record visitor exits.": Your role has no gate log right.
  - हिंदी: "This account cannot record visitor exits.": आपके रोल को गेट लॉग का अधिकार नहीं है।
- "Visitors record entry themselves using the factory QR code.": The watchman cannot record entry; ask the visitor to scan the poster.
  - हिंदी: "Visitors record entry themselves using the factory QR code.": वॉचमैन एंट्री नहीं कर सकता; विज़िटर से पोस्टर स्कैन करवाएँ।
- "Gate not assigned": Your account has no plant gate, so the register is locked. An admin or owner assigns the gate in User Management (Gate assignment); then sign in again.
  - हिंदी: "Gate not assigned": आपके अकाउंट को कोई प्लांट गेट नहीं मिला, इसलिए रजिस्टर बंद है। एडमिन या ओनर User Management (Gate assignment) में गेट दें; फिर दोबारा लॉगिन करें।

## Walk-in visitor — /gate/visitors/new
- "Not available — This page is for administrators and owners.": Watchmen and report delegates cannot open this page. Use the gate terminal or the Gate report.
  - हिंदी: "Not available — This page is for administrators and owners.": वॉचमैन और रिपोर्ट वाले यह पेज नहीं खोल सकते। गेट टर्मिनल या Gate report इस्तेमाल करें।
- "Enter a 10-digit mobile number.": The mobile number is incomplete.
  - हिंदी: "Enter a 10-digit mobile number.": मोबाइल नंबर अधूरा है।
- "Aadhaar has 12 digits.": Fix the ID number or choose None.
  - हिंदी: "Aadhaar has 12 digits.": ID नंबर ठीक करें या None चुनें।
- "Consent is needed to record the visit.": Tick the consent box.
  - हिंदी: "Consent is needed to record the visit.": सहमति वाला बॉक्स टिक करें।
- "Optional government ID storage is temporarily unavailable. Please omit the ID number and retry.": Choose None for the ID and send again.
  - हिंदी: "Optional government ID storage is temporarily unavailable. Please omit the ID number and retry.": ID में None चुनें और फिर भेजें।

## Visitor registration (no gate link) — /visit
- "Scan the gate QR code": This link is incomplete; it has no gate code.
  - हिंदी: "Scan the gate QR code": यह लिंक अधूरा है; इसमें गेट कोड नहीं है।

## Register your visit — /visit/[token]
- "Gate link not available — This visitor QR is unavailable. Please ask the watchman.": The QR is old (replaced) or wrong. Scan the poster fixed at the gate, or ask the watchman.
  - हिंदी: "Gate link not available — This visitor QR is unavailable. Please ask the watchman.": QR पुराना (बदला गया) या गलत है। गेट पर लगा पोस्टर स्कैन करें, या वॉचमैन से पूछें।
- "Enter a 10-digit mobile number.": Type your 10-digit Indian mobile number.
  - हिंदी: "Enter a 10-digit mobile number.": अपना 10 अंकों का मोबाइल नंबर लिखें।
- "Consent is needed to record the visit.": Tick the consent box to continue.
  - हिंदी: "Consent is needed to record the visit.": आगे बढ़ने के लिए सहमति वाला बॉक्स टिक करें।
- "Selfie must be 3 MB or smaller. / Use a clear JPEG, PNG or WebP selfie.": Retake the selfie with the in-page camera.
  - हिंदी: "Selfie must be 3 MB or smaller. / Use a clear JPEG, PNG or WebP selfie.": पेज के कैमरे से सेल्फ़ी दोबारा लें।
- "Camera permission was blocked.": Allow the camera in the browser, or use the phone camera app to pick a photo.
  - हिंदी: "Camera permission was blocked.": ब्राउज़र में कैमरा की अनुमति दें, या फ़ोन के कैमरा ऐप से फ़ोटो चुनें।

## Sign in (Welcome back) — /login
- "No active account found with the given credentials.": Wrong username or password, or the account is inactive. Check Caps Lock and spelling; ask the admin if it persists.
  - हिंदी: "No active account found with the given credentials.": यूज़रनेम या पासवर्ड गलत है, या अकाउंट बंद है। Caps Lock और स्पेलिंग देखें; बार-बार हो तो एडमिन से पूछें।
- "Too many failed sign-in attempts for this account. Wait 15 minutes or ask an administrator to reset the password.": 10 wrong tries in 15 minutes lock the account for 15 minutes.
  - हिंदी: "Too many failed sign-in attempts for this account. Wait 15 minutes or ask an administrator to reset the password.": 15 मिनट में 10 गलत कोशिश पर अकाउंट 15 मिनट के लिए लॉक होता है।
- "Server error (500) …": The server had a problem. Try again in a minute; tell the admin if it repeats.
  - हिंदी: "Server error (500) …": सर्वर में दिक्कत है। एक मिनट बाद फिर कोशिश करें; बार-बार हो तो एडमिन को बताएँ।
- "Login succeeded but the user session could not be hydrated.": Sign-in worked but the session did not load. Reload the page and sign in again.
  - हिंदी: "Login succeeded but the user session could not be hydrated.": लॉगिन हुआ पर सेशन लोड नहीं हुआ। पेज रीलोड करके फिर लॉगिन करें।

## System Admin Console sign-in — /admin-login
- "Enter your 6 digit admin code.": The TOTP box has fewer than 6 digits.
  - हिंदी: "Enter your 6 digit admin code.": TOTP में 6 से कम अंक हैं।
- "Invalid admin credentials / No active account found with the given credentials.": Email or password is wrong, or the account is inactive.
  - हिंदी: "Invalid admin credentials / No active account found with the given credentials.": ईमेल या पासवर्ड गलत है, या अकाउंट बंद है।
- "Too many failed sign-in attempts for this account. Wait 15 minutes or ask an administrator to reset the password.": The account is locked for 15 minutes after repeated wrong tries.
  - हिंदी: "Too many failed sign-in attempts for this account. Wait 15 minutes or ask an administrator to reset the password.": बार-बार गलत कोशिश के बाद अकाउंट 15 मिनट के लिए लॉक है।

## Redirecting to your dashboard — /
- "Stuck on "Redirecting to your dashboard..."": The session is still loading or the network is slow. Reload; if it stays, sign in again on /login.
  - हिंदी: ""Redirecting to your dashboard..." पर अटका": सेशन लोड हो रहा है या नेटवर्क धीमा है। रीलोड करें; फिर भी रहे तो /login पर दोबारा लॉगिन करें।

## Location scan — /loc/[code]
- "No location matches code "…".": The sticker is from another factory or was replaced. Ask the store for a new sticker.
  - हिंदी: "No location matches code "…".": स्टिकर दूसरी फ़ैक्टरी का है या बदल दिया गया। स्टोर से नया स्टिकर माँगें।
- "Could not post the count": The adjustment was refused (permission or stale stock). Read the message, refresh and count again.
  - हिंदी: "Could not post the count": एडजस्टमेंट नहीं हुआ (अनुमति या पुराना स्टॉक)। संदेश पढ़ें, रिफ़्रेश करें और फिर गिनें।

## Machine scan — /m/[code]
- "No machine matches code "…". Check the sticker or ask the supervisor.": The sticker is wrong or old.
  - हिंदी: "No machine matches code "…". Check the sticker or ask the supervisor.": स्टिकर गलत या पुराना है।
- "Could not log": The output was refused (above target or issued input, or no running job). Read the message; fix on the terminal.
  - हिंदी: "Could not log": आउटपुट नहीं लिया गया (target या जारी इनपुट से ज़्यादा, या कोई काम नहीं चल रहा)। संदेश पढ़ें; टर्मिनल पर ठीक करें।
- "This machine is not assigned to you": Ask an admin to add the machine to your user.
  - हिंदी: "This machine is not assigned to you": एडमिन से यह मशीन अपने यूज़र में जुड़वाएँ।

## Master Data — /master
- "Access error on the Recipes card": Your account cannot read recipes. Ask an admin for the master grant.
  - हिंदी: "Recipes कार्ड पर Access error": आपका अकाउंट recipe नहीं पढ़ सकता। Admin से master अधिकार माँगें।
- "Page does not open / redirects": Master pages open only for Admin/Owner/Super admin or a master grant, even if you type the address.
  - हिंदी: "पेज नहीं खुलता": Master पेज सिर्फ Admin/Owner/Super admin या master अधिकार वाले के लिए खुलते हैं, पता टाइप करने पर भी।

## Add-ons & Misc Materials — /master/add-ons
- "Saved, but open lines could not be refreshed: …": The add-on saved but re-calculating open orders failed. Open the order line or ask the planner; released lines need "Recalculate from masters" on the WC terminal.
  - हिंदी: "Saved, but open lines could not be refreshed: …": Add-on save हो गया पर खुले orders फिर से नहीं गिने गए। Planner को बताएँ; release हो चुकी lines के लिए WC terminal पर "Recalculate from masters" दबाएँ।
- "Code is required / Name is required / Value must be positive": Fill code and description and a weight of 0 or more.
  - हिंदी: "Code is required / Name is required / Value must be positive": Code, description और 0 या उससे ज़्यादा वज़न भरें।

## Adhesives & Solvents — /master/adhesives-solvents
- "Adhesive or Solvent tile shows "Missing"": The system record is absent. Lamination BOM cannot take chemistry; ask the system admin to restore it.
  - हिंदी: "Adhesive या Solvent टाइल पर "Missing"": System रिकॉर्ड नहीं है। Lamination BOM chemistry नहीं ले पाएगा; system admin से ठीक करवाएँ।

## Commercial Families — /master/commercial-families
- "Create failed / Update failed / Delete failed": Usually a duplicate code or the family is still linked. Use a new code, or set it Inactive instead of deleting.
  - हिंदी: "Create failed / Update failed / Delete failed": अक्सर code दोहराया गया है या family अभी जुड़ी है। नया code दें, या delete की जगह Inactive करें।

## Film Families — /master/film-families
- "Delete failed": Variants still use this family. Move or delete those variants first.
  - हिंदी: "Delete failed": अभी variants इस family को इस्तेमाल करते हैं। पहले उन्हें बदलें या हटाएँ।

## Film Variants — /master/film-variants
- "Delete failed": The variant is used by layers, recipes or rolls. Keep it; do not delete used films.
  - हिंदी: "Delete failed": Variant layer, recipe या roll में इस्तेमाल है। इसे रहने दें; इस्तेमाल हुई film delete न करें।

## Granules — /master/granules
- "Equivalent code '…' already exists in this granule family.": Same code with different spacing/hyphens already exists. Use the existing code.
  - हिंदी: "Equivalent code '…' already exists in this granule family.": वही code अलग space/hyphen के साथ पहले से है। पुराना code इस्तेमाल करें।
- "Already present in this family: …": Some pasted codes exist. Remove them from the paste list and retry.
  - हिंदी: "Already present in this family: …": Paste किए कुछ code पहले से हैं। उन्हें list से हटाकर फिर से करें।
- "The pasted list contains equivalent codes.": Two lines are the same code. Keep one.
  - हिंदी: "The pasted list contains equivalent codes.": दो lines एक ही code हैं। एक रखें।
- "Add no more than 100 codes at once.": Split the paste into batches of 100.
  - हिंदी: "Add no more than 100 codes at once.": 100-100 के हिस्सों में paste करें।

## Printing Inks — /master/inks
- "Ink with this Base Type and Color Name already exists.": Same colour on the same base exists. Use it or change the name.
  - हिंदी: "Ink with this Base Type and Color Name already exists.": उसी base पर यही रंग पहले से है। वही इस्तेमाल करें या नाम बदलें।
- "Use a valid #RRGGBB color.": Swatch must be # plus six hex digits, or use "Clear".
  - हिंदी: "Use a valid #RRGGBB color.": Swatch में # और छह hex अंक हों, या "Clear" दबाएँ।

## Packaging Master — /master/packaging
- "Enter the weight of one pouch/gonny in kg; it goes into the dispatch unit weight.": Bought inner pouch or gonny saved without weight. Enter the weight of one piece.
  - हिंदी: "Enter the weight of one pouch/gonny in kg; it goes into the dispatch unit weight.": खरीदा inner pouch या gonny बिना वज़न save किया। एक piece का वज़न भरें।
- "<KIND> cannot be IN_HOUSE in this phase.": Only Inner pouch and Sheet may be IN_HOUSE or BOTH. Choose PURCHASED.
  - हिंदी: "<KIND> cannot be IN_HOUSE in this phase.": सिर्फ Inner pouch और Sheet IN_HOUSE या BOTH हो सकते हैं। PURCHASED चुनें।
- "packaging_kind is required for packaging materials.": Pick a kind before saving.
  - हिंदी: "packaging_kind is required for packaging materials.": Save से पहले kind चुनें।
- "Item is missing from the release tick list": Its kind is Inner pouch or it is INACTIVE. Edit it, set the right kind (e.g. Sheet · putha · board for Putha) and ACTIVE.
  - हिंदी: "Item release tick list में नहीं दिखता": उसका kind Inner pouch है या वह INACTIVE है। Edit करके सही kind (जैसे Putha के लिए Sheet · putha · board) और ACTIVE करें।
- "Missing. Link it to its packaging Product Master variant": In-house inner pouch has no BOM weight. Link it to the master that makes it.
  - हिंदी: "Missing. Link it to its packaging Product Master variant": घर के inner pouch का BOM वज़न नहीं है। उसे बनाने वाले master से जोड़ें।

## POD Master — /master/pod
- "Core POD code cannot be changed.": System POD rows keep their code; change only the name or sizes.
  - हिंदी: "Core POD code cannot be changed.": System POD row का code नहीं बदलता; सिर्फ नाम या माप बदलें।
- "Core POD materials cannot be deleted.": Set it Inactive instead.
  - हिंदी: "Core POD materials cannot be deleted.": इसके बदले Inactive करें।
- "Height must be > 0 / Thickness must be > 0 / Panel count must be > 0 / Density must be > 0": Enter positive numbers.
  - हिंदी: "Height must be > 0 / Thickness must be > 0 / Panel count must be > 0 / Density must be > 0": 0 से बड़े अंक भरें।

## Pouch shapes + formulas — /master/pouch-styles
- "Style not in the Product Master size picker": It is a draft or disabled. Open it and press "Save + approve + lock" or "Reactivate".
  - हिंदी: "Style Product Master size picker में नहीं": वह draft या disabled है। खोलकर "Save + approve + lock" या "Reactivate" दबाएँ।

## Pouch style editor — /master/pouch-styles/[id]
- "Disabled pouch styles cannot be approved. Reactivate it first.": Press "Reactivate", then approve.
  - हिंदी: "Disabled pouch styles cannot be approved. Reactivate it first.": "Reactivate" दबाएँ, फिर approve करें।
- "Formula consumes width/height … but the declared roll axis is …": The formula uses the other side. Change "Roll axis policy" to the side named in the message.
  - हिंदी: "Formula consumes width/height … but the declared roll axis is …": Formula दूसरी side इस्तेमाल करता है। "Roll axis policy" को message वाली side पर करें।
- "Custom AST mode requires a non-empty AST.": Add at least one term to the formula.
  - हिंदी: "Custom AST mode requires a non-empty AST.": Formula में कम से कम एक term जोड़ें।
- "No changes to save": The locked style is unchanged; nothing to save.
  - हिंदी: "No changes to save": Locked style में कोई बदलाव नहीं; save करने को कुछ नहीं।

## Build a pouch shape — /master/pouch-styles/new
- "Disabled pouch styles cannot be approved. Reactivate it first.": Press "Reactivate", then approve.
  - हिंदी: "Disabled pouch styles cannot be approved. Reactivate it first.": "Reactivate" दबाएँ, फिर approve करें।
- "Formula consumes width/height … but the declared roll axis is …": The formula uses the other side. Change "Roll axis policy" to the side named in the message.
  - हिंदी: "Formula consumes width/height … but the declared roll axis is …": Formula दूसरी side इस्तेमाल करता है। "Roll axis policy" को message वाली side पर करें।
- "Custom AST mode requires a non-empty AST.": Add at least one term to the formula.
  - हिंदी: "Custom AST mode requires a non-empty AST.": Formula में कम से कम एक term जोड़ें।
- "No changes to save": The locked style is unchanged; nothing to save.
  - हिंदी: "No changes to save": Locked style में कोई बदलाव नहीं; save करने को कुछ नहीं।

## Product Master — /master/products
- "Product Master code already exists. Try a different code.": Use a new code.
  - हिंदी: "Product Master code already exists. Try a different code.": नया code दें।
- "Required: pick the route template this master will use": Pick a live route before "Create & open workspace".
  - हिंदी: "Required: pick the route template this master will use": "Create & open workspace" से पहले live route चुनें।
- "A superseded Product Master revision cannot be restored.": It was replaced; use the current replacement or clone a new revision.
  - हिंदी: "A superseded Product Master revision cannot be restored.": यह बदल दिया गया है; नया replacement इस्तेमाल करें या clone करें।

## Product Master view — /master/products/[id]
- "Could not load product master.": Wrong link or no access. Go back to the list and open it again.
  - हिंदी: "Could not load product master.": गलत link या अधिकार नहीं। List पर लौटकर फिर खोलें।

## Product Master editor — /master/products/[id]/edit
- "Layer N must select a valid film variant before the Product Master is active.": Pick a film for every layer.
  - हिंदी: "Layer N must select a valid film variant before the Product Master is active.": हर layer में film चुनें।
- "Layer N grade is required unless the selected film variant is purchasable-only or grade is a per-layer axis.": Pick a grade for that layer.
  - हिंदी: "Layer N grade is required unless …": उस layer का grade चुनें।
- "Size code "680" is already on this master (in use).": Search the size list for that code and edit that row instead of adding a new one.
  - हिंदी: "Size code "680" is already on this master (in use).": Size list में वह code खोजें और नई row की जगह वही row बदलें।
- "Enter the size (width and height, or the roll width) and the code is made from it, or type a code.": A size row has no dimensions and no code. Fill the size.
  - हिंदी: "Enter the size … or type a code.": Size row में न माप है न code। माप भरें।
- "This is not a readable Excel file. Save it as .xlsx and upload again. / The first row must be the column names (download the template). / The sheet is larger than 5 MB.": Use the downloaded "Excel sheet" template, keep its header row, save as .xlsx or .csv under 5 MB.
  - हिंदी: "This is not a readable Excel file … / The first row must be the column names … / The sheet is larger than 5 MB.": Download किया "Excel sheet" template इस्तेमाल करें, header row रखें, 5 MB से छोटी .xlsx या .csv save करें।
- "Product Master code is an internal immutable identity. Update the name instead.": The code cannot change; change the name.
  - हिंदी: "Product Master code is an internal immutable identity …": Code नहीं बदलता; नाम बदलें।

## New variant — /master/products/[id]/variants/new
- "Could not save variant": A required axis is empty or the tuple already exists. Fill the axes or open the existing variant.
  - हिंदी: "Could not save variant": कोई ज़रूरी axis खाली है या यही variant पहले से है। Axis भरें या पुराना variant खोलें।

## Extrusion Recipes — /master/recipes
- "Total percentage must be 100.00%.": Use "Balance to 100%".
  - हिंदी: "Total percentage must be 100.00%.": "Balance to 100%" इस्तेमाल करें।
- "An active recipe already exists for … / Thickness range overlaps with active recipe …": Edit that recipe, or disable it before creating a new range.
  - हिंदी: "An active recipe already exists … / Thickness range overlaps …": वही recipe बदलें, या नई range से पहले उसे disable करें।
- "Recipe identity is locked after creation …": To change variant, grade or thickness, disable and create a new recipe.
  - हिंदी: "Recipe identity is locked after creation …": Variant, grade या thickness बदलने के लिए disable करके नई recipe बनाएँ।
- "Each granule can be used only once in a recipe.": Merge duplicate rows.
  - हिंदी: "Each granule can be used only once in a recipe.": दोहराई rows मिलाएँ।
- "Recipes are production history and cannot be deleted. Disable the recipe instead.": Use "Disable".
  - हिंदी: "Recipes are production history and cannot be deleted …": "Disable" इस्तेमाल करें।

## Items we resell — /master/trading-goods
- "No trading goods yet": Nothing created; add the first item.
  - हिंदी: "No trading goods yet": कुछ नहीं बना; पहला item जोड़ें।

## Edit trading good — /master/trading-goods/[id]
- "Missing fields: Code and name are required": Fill both before saving.
  - हिंदी: "Missing fields: Code and name are required": Save से पहले दोनों भरें।
- "Save failed": Often a duplicate code. Use another code.
  - हिंदी: "Save failed": अक्सर code दोहराया गया है। दूसरा code दें।
- "No stock recorded yet": Seed opening stock with a Stock Adjustment.
  - हिंदी: "No stock recorded yet": Opening stock Stock Adjustment से डालें।

## Add a trading good — /master/trading-goods/new
- "Missing fields: Code and name are required": Fill both before saving.
  - हिंदी: "Missing fields: Code and name are required": Save से पहले दोनों भरें।
- "Save failed": Often a duplicate code. Use another code.
  - हिंदी: "Save failed": अक्सर code दोहराया गया है। दूसरा code दें।
- "No stock recorded yet": Seed opening stock with a Stock Adjustment.
  - हिंदी: "No stock recorded yet": Opening stock Stock Adjustment से डालें।

## Vendors — /master/vendors
- "Name is required / Code is required": Fill both.
  - हिंदी: "Name is required / Code is required": दोनों भरें।
- "This process and unit already has a rate": Keep one rate per process and unit.
  - हिंदी: "This process and unit already has a rate": हर process और unit का एक ही rate रखें।
- "Failed to delete": The vendor is linked to stock or documents. Set it Inactive instead.
  - हिंदी: "Failed to delete": Vendor stock या documents से जुड़ा है। Inactive करें।

## Lane-up and parent-web rules — /master/web-width-policies
- "No policies match.": Clear the search.
  - हिंदी: "No policies match.": Search हटाएँ।
- "No web-width policy configured yet.": Create a Global fallback default policy.
  - हिंदी: "No web-width policy configured yet.": Global fallback default policy बनाएँ।

## Web-width policy — /master/web-width-policies/[id]
- "Lane count must be between 1 and 12.": Pick lanes 1–12.
  - हिंदी: "Lane count must be between 1 and 12.": 1–12 lanes चुनें।
- "Scope reference is required for non-global policies.": Pick the Scope ref.
  - हिंदी: "Scope reference is required for non-global policies.": Scope ref चुनें।
- "Strict standard mode needs at least one parent width.": Add a standard width or change the strategy.
  - हिंदी: "Strict standard mode needs at least one parent width.": Standard width जोड़ें या strategy बदलें।
- "Max parent width must be greater than min parent width.": Fix the min/max.
  - हिंदी: "Max parent width must be greater than min parent width.": Min/max ठीक करें।

## New web-width policy — /master/web-width-policies/new
- "Lane count must be between 1 and 12.": Pick lanes 1–12.
  - हिंदी: "Lane count must be between 1 and 12.": 1–12 lanes चुनें।
- "Scope reference is required for non-global policies.": Pick the Scope ref.
  - हिंदी: "Scope reference is required for non-global policies.": Scope ref चुनें।
- "Strict standard mode needs at least one parent width.": Add a standard width or change the strategy.
  - हिंदी: "Strict standard mode needs at least one parent width.": Standard width जोड़ें या strategy बदलें।
- "Max parent width must be greater than min parent width.": Fix the min/max.
  - हिंदी: "Max parent width must be greater than min parent width.": Min/max ठीक करें।

## Pending Approvals — /engineering/approvals
- "Approval Failed — Templates cannot be approved or published without a Routing Rule.": No route is linked. Open "Review", choose a "Routing rule", press "Save basics" and "Sync route stages", then approve.
  - हिंदी: "Approval Failed — Templates cannot be approved or published without a Routing Rule.": Route नहीं जुड़ा है। "Review" खोलें, "Routing rule" चुनें, "Save basics" और "Sync route stages" दबाएँ, फिर approve करें।
- "Approval Failed — Template must be in ENGINEERING review before approval.": Someone already approved or changed it. Refresh the page; the row will disappear when it is no longer in review.
  - हिंदी: "Approval Failed — Template must be in ENGINEERING review before approval.": किसी ने पहले ही approve या बदल दिया है। पेज refresh करें; review से बाहर होते ही लाइन हट जाएगी।
- "Approval Failed — Step N …: no capable work center is mapped for …": A route stage has no machine/work center that can run its process. Add the capability in Factory setup, or fix dispatch in Template Studio section "4. Template route dispatch".
  - हिंदी: "Approval Failed — Step N …: no capable work center is mapped for …": किसी route stage का process चलाने वाला work center नहीं है। Factory setup में capability जोड़ें, या Template Studio के "4. Template route dispatch" में सुधारें।

## Review: template (Approval Console Retired) — /engineering/approvals/[id]
- "Template Not Found": The id is wrong or the template was deleted. Press "Go back" and open it from Template Studio.
  - हिंदी: "Template Not Found": id गलत है या template हटाया गया है। "Go back" दबाकर Template Studio से खोलें।

## Artwork Library — /engineering/artworks
- "Approval Failed (ARTWORK_APPROVAL_BLOCKED) — Cannot approve artwork without an uploaded file/image asset.": No file attached. Pick a JPG, PNG or PDF, press "Save Draft", then approve.
  - हिंदी: "Approval Failed (ARTWORK_APPROVAL_BLOCKED) — Cannot approve artwork without an uploaded file/image asset.": File नहीं लगी। JPG, PNG या PDF चुनें, "Save Draft" करें, फिर approve करें।
- "Artwork: total ink GSM must be greater than zero.": Enter "Total ink GSM" before approval.
  - हिंदी: "Artwork: total ink GSM must be greater than zero.": Approve से पहले "Total ink GSM" भरें।
- "Artwork: sheet film supports front colors only.": Back colours were set on SHEET film. Use TUBING or remove back colours.
  - हिंदी: "Artwork: sheet film supports front colors only.": SHEET film पर back colour डाले गए। TUBING चुनें या back colour हटाएँ।
- "ROTO approval blocked: finalized front cylinders missing for slots [..].": Some colour slots have no finalized cylinder. Generate or reuse them and press "Finalize this cylinder" in Cylinder Catalog → "Manage Slots".
  - हिंदी: "ROTO approval blocked: finalized front cylinders missing for slots [..].": कुछ colour slot का cylinder finalize नहीं है। Cylinder Catalog → "Manage Slots" में बनाएँ या reuse करें और "Finalize this cylinder" दबाएँ।
- "ROTO approval blocked: cylinder circumference must match artwork repeat for slots [..].": A cylinder's repeat differs from the artwork repeat (0.01 mm tolerance). Fix the spec or use a matching cylinder.
  - हिंदी: "ROTO approval blocked: cylinder circumference must match artwork repeat for slots [..].": किसी cylinder का repeat artwork के repeat से अलग है (0.01 mm छूट)। Spec ठीक करें या मिलता cylinder लगाएँ।
- "Cylinder generation failed — Enter artwork cylinder circumference before generating cylinders.": Fill repeat and length first.
  - हिंदी: "Cylinder generation failed — Enter artwork cylinder circumference before generating cylinders.": पहले repeat और length भरें।
- "Upload a maximum of 3 artwork images. / Only 3 images kept": Only the first 3 files are kept.
  - हिंदी: "Upload a maximum of 3 artwork images. / Only 3 images kept": सिर्फ पहली 3 file रखी जाती हैं।

## Cylinder Catalog — /engineering/cylinders
- "Finalization blocked — Select engraving vendor before finalizing. / Select storage location before finalizing.": Choose both in "2. Finish generated drafts" first.
  - हिंदी: "Finalization blocked — Select engraving vendor before finalizing. / Select storage location before finalizing.": पहले "2. Finish generated drafts" में दोनों चुनें।
- "Enter circumference / repeat before using cylinder slots.": Repeat and length are needed before generate, reuse or finalize.
  - हिंदी: "Enter circumference / repeat before using cylinder slots.": Generate, reuse या finalize से पहले repeat और length चाहिए।
- "Reuse failed — Reusable cylinder circumference must match the artwork repeat (… mm).": Pick a cylinder of the same repeat and length.
  - हिंदी: "Reuse failed — Reusable cylinder circumference must match the artwork repeat (… mm).": उसी repeat और length का cylinder चुनें।
- "Only finalized cylinders can be reused for artwork slots.": A draft cylinder cannot be reused; finalize it on its own artwork first.
  - हिंदी: "Only finalized cylinders can be reused for artwork slots.": Draft cylinder reuse नहीं होता; पहले उसके artwork पर finalize करें।
- "Finalize cylinder blocked: artwork already has a finalized cylinder for FRONT-n.": That slot is already covered. Edit the existing cylinder instead.
  - हिंदी: "Finalize cylinder blocked: artwork already has a finalized cylinder for FRONT-n.": वह slot पहले से भरा है। मौजूदा cylinder बदलें।
- "Storage location must be a TOOLING location.": Only TOOLING-type locations are allowed; create one in location master.
  - हिंदी: "Storage location must be a TOOLING location.": सिर्फ TOOLING type location चलती है; location master में बनाएँ।
- "Requested FRONT-n exceeds artwork color slots.": The artwork has fewer colours. Fix colours on the artwork.
  - हिंदी: "Requested FRONT-n exceeds artwork color slots.": Artwork में colour कम हैं। Artwork पर colour ठीक करें।

## Work-center setup by template (Route dispatch) — /engineering/route-dispatch
- "Allowed work center is not capable for <process>: …": A ticked center cannot run this process. Untick it or add capability in Factory.
  - हिंदी: "Allowed work center is not capable for <process>: …": Tick किया center यह process नहीं चला सकता। Untick करें या Factory में capability जोड़ें।
- "Default work center cannot run <process>.": Choose a capable center as default.
  - हिंदी: "Default work center cannot run <process>.": Default में capable center चुनें।
- "<process> is not planner-optional-capable in Process Master.": Turn on that option in the Process Master first.
  - हिंदी: "<process> is not planner-optional-capable in Process Master.": पहले Process Master में यह विकल्प चालू करें।
- "No work center currently has capability for this process.": Map the process to a machine in Factory setup, then come back.
  - हिंदी: "No work center currently has capability for this process.": Factory setup में process को machine से जोड़ें, फिर लौटें।
- "This template is live and locked.": Press "Edit safely" to create a correction draft.
  - हिंदी: "This template is live and locked.": "Edit safely" दबाकर correction draft बनाएँ।

## Routing Studio — /engineering/routing
- "Routing sequence and graph are locked by current templates or production history.": Steps cannot change once used. Disable the old route/template and create a corrected route and template version.
  - हिंदी: "Routing sequence and graph are locked by current templates or production history.": इस्तेमाल के बाद step नहीं बदलते। पुराना route/template disable करें और सुधरा route व template version बनाएँ।
- "Disable linked templates or create a corrected route first: …": Delete is blocked while current templates use the route. Disable those templates or use "Disable" on the route.
  - हिंदी: "Disable linked templates or create a corrected route first: …": चालू template route इस्तेमाल कर रहे हैं तो delete नहीं होगा। उन template को disable करें या route पर "Disable" करें।
- "Mark the routing rule inactive instead, or move dependent templates to another route first.": Jobs or old templates still refer to it; use "Disable".
  - हिंदी: "Mark the routing rule inactive instead, or move dependent templates to another route first.": Job या पुराने template अभी भी इसे इस्तेमाल करते हैं; "Disable" करें।
- "Unknown Process code(s): … Create or select the Process Master before saving the route.": Create the process in Factory → Processes first.
  - हिंदी: "Unknown Process code(s): … Create or select the Process Master before saving the route.": पहले Factory → Processes में process बनाएँ।
- "Routing or template manage permission is required …": Your role cannot change routes; ask the admin.
  - हिंदी: "Routing or template manage permission is required …": आपका role route नहीं बदल सकता; admin से कहें।

## Template Studio (template registry) — /engineering/templates
- "Create failed — Template name is required.": Type a name before pressing "Create & Open Studio".
  - हिंदी: "Create failed — Template name is required.": "Create & Open Studio" से पहले नाम लिखें।
- "Pouch templates must declare a pouch style.": Choose a "Pouch Style" for POUCH.
  - हिंदी: "Pouch templates must declare a pouch style.": POUCH के लिए "Pouch Style" चुनें।
- "Template registry could not load.": Server or schema problem; refresh, then tell the admin with the message shown.
  - हिंदी: "Template registry could not load.": Server या schema की दिक्कत; refresh करें, फिर दिखा संदेश admin को बताएँ।

## Template Studio · execution rules — /engineering/templates/[id]
- "Sync workflow first. A LIVE template must contain at least one active route step.": Press "Sync route stages" after choosing the route.
  - हिंदी: "Sync workflow first. A LIVE template must contain at least one active route step.": Route चुनने के बाद "Sync route stages" दबाएँ।
- "Cannot change routing on a LIVE template.": Use "Edit safely" to get a correction draft.
  - हिंदी: "Cannot change routing on a LIVE template.": "Edit safely" से correction draft लें।
- "Template must be APPROVED before it can be published LIVE.": Send for review and approve first.
  - हिंदी: "Template must be APPROVED before it can be published LIVE.": पहले review भेजें और approve करें।
- "LIVE templates are read-only. Clone a new version first.": Use "Edit safely".
  - हिंदी: "LIVE templates are read-only. Clone a new version first.": "Edit safely" इस्तेमाल करें।
- "Step N …: choose a default work center or set Planner chooses at release.": More than one capable center and no decision. Fix in section 4.
  - हिंदी: "Step N …: choose a default work center or set Planner chooses at release.": एक से ज़्यादा capable center हैं और फैसला नहीं हुआ। Section 4 में ठीक करें।
- "Step N …: lamination needs two input lanes.": Set Input lanes to 2 in the lamination stage.
  - हिंदी: "Step N …: lamination needs two input lanes.": Lamination stage में Input lanes 2 करें।
- "Routing Rule contains missing Process code(s): … Route steps were not changed.": The route uses a process that no longer exists; fix the route or Process Master.
  - हिंदी: "Routing Rule contains missing Process code(s): … Route steps were not changed.": Route में ऐसा process है जो अब नहीं है; route या Process Master ठीक करें।
- "ADDON category must use CATEGORY_FORMULA. / POD category must use CATEGORY_FORMULA.": For ADDON and POD pick Basis "Master formula" with formula "Addon master" / "POD profile".
  - हिंदी: "ADDON category must use CATEGORY_FORMULA. / POD category must use CATEGORY_FORMULA.": ADDON और POD में Basis "Master formula" और formula "Addon master" / "POD profile" चुनें।

## Tool Room — /engineering/tooling
- "Storage location must belong to the same plant.": Pick a location of the selected plant.
  - हिंदी: "Storage location must belong to the same plant.": चुने plant की location लें।
- "Storage location must be a TOOLING location.": Only TOOLING-type locations are allowed.
  - हिंदी: "Storage location must be a TOOLING location.": सिर्फ TOOLING type location चलती है।

## Maintenance today — /maintenance
- "Could not verify — Only completed work awaiting verification can be verified.": Someone already verified or the job changed; the list refreshes within a minute.
  - हिंदी: "Could not verify — Only completed work awaiting verification can be verified.": किसी ने पहले verify कर दिया या job बदला; सूची एक मिनट में ताज़ा होगी।
- ""Send back" button grey": Write a verification note first.
  - हिंदी: ""Send back" बटन grey": पहले verification note लिखें।

## Machine faults — /maintenance/faults
- "Could not report — You cannot report faults.": Your role lacks maintenance log rights; ask the admin.
  - हिंदी: "Could not report — You cannot report faults.": आपके role को maintenance log अनुमति नहीं; admin से कहें।
- "Only maintenance staff can change repair status.": Operators can report but not repair; ask a technician.
  - हिंदी: "Only maintenance staff can change repair status.": Operator दर्ज कर सकते हैं, repair नहीं; technician से कहें।
- "File is larger than 8 MB. / Only photos (JPEG, PNG, WebP, HEIC) and PDF are accepted.": Use a smaller photo or a PDF.
  - हिंदी: "File is larger than 8 MB. / Only photos (JPEG, PNG, WebP, HEIC) and PDF are accepted.": छोटी photo या PDF लगाएँ।

## Maintenance jobs — /maintenance/jobs
- "Job is DONE; only due work can be started.": The job is already closed.
  - हिंदी: "Job is DONE; only due work can be started.": Job पहले ही बंद है।
- "A reason is required when the work is not completed cleanly.": Write the reason for Issue found / Unable.
  - हिंदी: "A reason is required when the work is not completed cleanly.": Issue found / Unable का कारण लिखें।
- "Only maintenance staff can add jobs by hand.": Ask a supervisor to add it.
  - हिंदी: "Only maintenance staff can add jobs by hand.": Supervisor से जुड़वाएँ।
- "n check(s) marked "Issue". Choose "Issue found" …": Pick "Issue found" so a fault is raised, or correct the check.
  - हिंदी: "n check(s) marked "Issue". Choose "Issue found" …": "Issue found" चुनें ताकि fault बने, या check ठीक करें।

## Maintenance job record — /maintenance/jobs/[id]
- "Job is already DONE.": Someone closed it; reload.
  - हिंदी: "Job is already DONE.": किसी ने बंद कर दिया; reload करें।
- "You cannot start maintenance work.": Your role cannot start this kind of job.
  - हिंदी: "You cannot start maintenance work.": आपका role यह job शुरू नहीं कर सकता।

## Maintenance schedules — /maintenance/schedules
- "Could not save": Check machine, name and first due date; read the message shown.
  - हिंदी: "Could not save": Machine, नाम और first due date जाँचें; दिखा संदेश पढ़ें।

## Analytics and Reports Hub — /analytics
- "Reports Hub could not load live analytics.": The summary request failed. Cards are paused instead of showing zeros. Press "Refresh"; if it stays, tell the admin.
  - हिंदी: "संदेश: "Reports Hub could not load live analytics."": Summary request फेल हुआ। कार्ड शून्य दिखाने के बजाय रोक दिए गए हैं। "Refresh" दबाएँ; फिर भी रहे तो admin को बताएँ।
- "Report catalog data could not be loaded.": The list of reports did not load. Refresh the page.
  - हिंदी: "संदेश: "Report catalog data could not be loaded."": रिपोर्टों की सूची लोड नहीं हुई। पेज refresh करें।
- "Report activity degraded": Report runs or pack settings could not load (often because your role is not admin/owner). Live numbers above still work.
  - हिंदी: "संदेश: "Report activity degraded"": Report runs या pack की सेटिंग लोड नहीं हुई (अक्सर role admin/owner नहीं होने से)। ऊपर के live आँकड़े फिर भी चलते हैं।
- "No execution telemetry is recorded for the current window.": No output was logged on the machines in the period. Ask work centers to log output on the terminal.
  - हिंदी: "संदेश: "No execution telemetry is recorded for the current window."": इस अवधि में मशीनों पर कोई output दर्ज नहीं हुआ। Work center से terminal पर output दर्ज करवाएँ।

## Capability Matrix — /analytics/capability-matrix
- "Capability matrix could not be loaded.": The registry file is missing on the server or the request failed. Ask the admin to check the deployment.
  - हिंदी: "संदेश: "Capability matrix could not be loaded."": Server पर registry फाइल नहीं है या request फेल हुआ। Admin से deployment जँचवाएँ।

## Costing Center — /analytics/costing
- "Locked cost pool months and their lines cannot be changed.": The month is LOCKED. There is no unlock button; ask an admin if a correction is really needed.
  - हिंदी: "संदेश: "Locked cost pool months and their lines cannot be changed."": महीना LOCKED है। Unlock बटन नहीं है; सच में सुधार चाहिए तो admin से बात करें।
- "percentages object is required.": "Allocate from totals" was pressed without any "Alloc %". Enter percentages first.
  - हिंदी: "संदेश: "percentages object is required."": "Alloc %" भरे बिना "Allocate from totals" दबाया। पहले प्रतिशत भरें।
- "A cost pool line cannot be moved to another month.": A group line belongs to one month only. Open the right month and enter it there.
  - हिंदी: "संदेश: "A cost pool line cannot be moved to another month."": Group line एक ही महीने की होती है। सही महीना खोलकर वहीं भरें।
- "Unabsorbed pool is high": Machines in that cost group did not record running hours (jobs not started/stopped on the terminal) or the machine has no cost group.
  - हिंदी: "Unabsorbed pool ज़्यादा है": उस cost group की मशीनों पर चलने के घंटे दर्ज नहीं हुए (terminal पर job start/stop नहीं हुआ) या मशीन पर cost group नहीं है।

## Inventory Health Matrix — /analytics/inventory-health
- "Inventory health feed unavailable": The health request failed. Numbers are paused instead of showing zeros. Press "Retry".
  - हिंदी: "संदेश: "Inventory health feed unavailable"": Health request फेल हुआ। शून्य दिखाने के बजाय आँकड़े रोके गए हैं। "Retry" दबाएँ।
- "Failed to run audit": The audit hit an error on the server. Try again later; tell the admin if it repeats.
  - हिंदी: "संदेश: "Failed to run audit"": Server पर audit में गड़बड़ी हुई। बाद में फिर चलाएँ; बार-बार हो तो admin को बताएँ।
- "Alert already resolved": Someone else closed it. Press "Sync layer".
  - हिंदी: "संदेश: "Alert already resolved"": किसी और ने बंद कर दिया। "Sync layer" दबाएँ।
- "Plant not found": The plant sent with the audit does not exist. Reload the page.
  - हिंदी: "संदेश: "Plant not found"": Audit के साथ भेजा plant मौजूद नहीं। पेज reload करें।

## Inventory Snapshot History — /analytics/inventory-history
- "No snapshots shown": The nightly snapshot has not run yet or failed. Ask the admin to check the scheduled job.
  - हिंदी: "कोई snapshot नहीं दिखता": रात का snapshot अभी नहीं चला या फेल हुआ। Admin से scheduled job जँचवाएँ।

## KPIs (old link) — /analytics/kpi
- "Page not allowed after redirect": Your role lacks the KPIs permission. Ask an admin.
  - हिंदी: "Redirect के बाद पेज की अनुमति नहीं": आपके role को KPIs की अनुमति नहीं। Admin से पूछें।

## Executive Control Center — /analytics/kpis
- "— shown instead of a number": No data for that figure in the timeframe, or the source was unavailable. Try a longer timeframe.
  - हिंदी: "आँकड़े की जगह — दिखता है": उस timeframe में डेटा नहीं या स्रोत उपलब्ध नहीं। लंबा timeframe चुनें।
- "Waiting for material postings": No material issue/consumption is posted against jobs yet.
  - हिंदी: "संदेश: "Waiting for material postings"": Job पर अभी material issue/खपत दर्ज नहीं हुई।

## MRP Center — /analytics/mrp
- "No vendor available — create a vendor master first.": No vendor exists to put on the draft PO. Create a vendor in the vendor master.
  - हिंदी: "संदेश: "No vendor available — create a vendor master first."": Draft PO पर लगाने के लिए कोई vendor नहीं। Vendor master में vendor बनाएँ।
- "No plant available — create a plant master first.": No plant exists. Create one in Factory → Plants.
  - हिंदी: "संदेश: "No plant available — create a plant master first."": कोई plant नहीं। Factory → Plants में बनाएँ।
- "Draft PO is valid only for PURCHASE suggestions.": You tried to buy a produce/transfer suggestion. Use "Open planner" or "Open transfers".
  - हिंदी: "संदेश: "Draft PO is valid only for PURCHASE suggestions."": Produce/transfer सुझाव पर खरीद की कोशिश। "Open planner" या "Open transfers" इस्तेमाल करें।
- "Audit-only MRP run selected": The chosen run is an outlier. Select the latest clean operational run before drafting purchase orders.
  - हिंदी: "संदेश: "Audit-only MRP run selected"": चुना गया run असामान्य है। PO draft से पहले नवीनतम साफ़ run चुनें।
- "No HIGH PURCHASE suggestions pending": Nothing urgent to buy in this run. Run the engine again after new orders.
  - हिंदी: "संदेश: "No HIGH PURCHASE suggestions pending"": इस run में कोई ज़रूरी खरीद नहीं। नए order के बाद engine फिर चलाएँ।
- "MRP failed": The engine stopped with an error; the run is saved as FAILED. Try again; tell the admin if it repeats.
  - हिंदी: "संदेश: "MRP failed"": Engine गड़बड़ी से रुका; run FAILED के रूप में सहेजा गया। फिर चलाएँ; बार-बार हो तो admin को बताएँ।

## Order Profitability (one order line) — /analytics/orders/[id]/costing
- "Sales Order Item not found.": The id in the address is not a sales-order line. Open the line from Order Profitability.
  - हिंदी: "संदेश: "Sales Order Item not found."": पते का id sales order line नहीं है। Order Profitability से line खोलें।
- "Could not calculate cost.": The engine returned nothing for this line. Check that the line has a BOM snapshot and a price.
  - हिंदी: "संदेश: "Could not calculate cost."": इस line के लिए गणना नहीं हुई। देखें line में BOM snapshot और कीमत है।

## Order Profitability — /analytics/orders/costing
- "No matching orders found in the ledger": No cost rows match your filter, or no costs have been calculated yet. Clear the filter or calculate a line.
  - हिंदी: "संदेश: "No matching orders found in the ledger"": Filter से कोई cost row नहीं मिली, या अभी गणना नहीं हुई। Filter हटाएँ या line की गणना करें।

## Process Rates — /analytics/process-rates
- "Creation Failed": The server rejected the new rate (for example a duplicate process/machine pair). Read the message and change the selection.
  - हिंदी: "संदेश: "Creation Failed"": Server ने नई दर नहीं ली (जैसे वही process/machine जोड़ी पहले से)। संदेश पढ़कर चुनाव बदलें।
- "Update Failed": Could not save the new rate. Check the numbers and try again.
  - हिंदी: "संदेश: "Update Failed"": नई दर save नहीं हुई। अंक जाँचकर फिर करें।
- "No process rates configured. The engine will use system defaults.": No rates yet; estimates use ₹800/hour. Add rates with "New Override".
  - हिंदी: "संदेश: "No process rates configured. The engine will use system defaults."": अभी कोई दर नहीं; अनुमान ₹800/घंटा पर। "New Override" से दर जोड़ें।

## Reports Hub — /analytics/reports
- "Report generation failed": The pack could not be generated; the message shows the server reason. Try again or check Report Center.
  - हिंदी: "संदेश: "Report generation failed"": Pack नहीं बना; संदेश में server का कारण है। फिर करें या Report Center देखें।
- "Archive restricted for this role": Pack history is only for report admins. All reports are still available to open and export.
  - हिंदी: "संदेश: "Archive restricted for this role"": Pack इतिहास केवल report admin के लिए। सभी रिपोर्टें फिर भी खुलती और export होती हैं।
- "No daily packs configured": An admin has not set up any pack in Report Center.
  - हिंदी: "संदेश: "No daily packs configured"": Admin ने Report Center में कोई pack नहीं बनाया।

## Costing & Profitability — /analytics/reports/costing
- "This report could not be loaded. Try refreshing.": The server request failed or your role lacks this report. Press "Refresh"; if it repeats, ask an admin for access.
  - हिंदी: "संदेश: "This report could not be loaded. Try refreshing."": Server request फेल हुआ या आपके role को यह रिपोर्ट नहीं मिली। "Refresh" दबाएँ; बार-बार हो तो admin से अनुमति माँगें।
- "No figures for this period": Nothing was recorded for the filters. Widen the period or clear filters.
  - हिंदी: "संदेश: "No figures for this period"": Filter के हिसाब से कुछ दर्ज नहीं। अवधि बढ़ाएँ या filter हटाएँ।
- "No telemetry in selected period.": No job in the period has machine output logs. Ask work centers to log output on the terminal.
  - हिंदी: "संदेश: "No telemetry in selected period."": अवधि के किसी job पर machine output log नहीं। Work center से terminal पर output दर्ज करवाएँ।
- "No shift tags captured in selected telemetry. / No shift schedule configured.": Output logs have no shift code, or the plant has no active shift definitions. Set up shifts in factory settings.
  - हिंदी: "संदेश: "No shift tags captured in selected telemetry. / No shift schedule configured."": Output log पर shift code नहीं, या plant में कोई चालू shift नहीं। Factory setting में shift बनाएँ।

## Dispatch & Logistics — /analytics/reports/dispatch
- "This report could not be loaded. Try refreshing.": The server request failed or your role lacks this report. Press "Refresh"; if it repeats, ask an admin for access.
  - हिंदी: "संदेश: "This report could not be loaded. Try refreshing."": Server request फेल हुआ या आपके role को यह रिपोर्ट नहीं मिली। "Refresh" दबाएँ; बार-बार हो तो admin से अनुमति माँगें।
- "No figures for this period": Nothing was recorded for the filters. Widen the period or clear filters.
  - हिंदी: "संदेश: "No figures for this period"": Filter के हिसाब से कुछ दर्ज नहीं। अवधि बढ़ाएँ या filter हटाएँ।
- "No telemetry in selected period.": No job in the period has machine output logs. Ask work centers to log output on the terminal.
  - हिंदी: "संदेश: "No telemetry in selected period."": अवधि के किसी job पर machine output log नहीं। Work center से terminal पर output दर्ज करवाएँ।
- "No shift tags captured in selected telemetry. / No shift schedule configured.": Output logs have no shift code, or the plant has no active shift definitions. Set up shifts in factory settings.
  - हिंदी: "संदेश: "No shift tags captured in selected telemetry. / No shift schedule configured."": Output log पर shift code नहीं, या plant में कोई चालू shift नहीं। Factory setting में shift बनाएँ।

## Downtime Analysis — /analytics/reports/downtime
- "This report could not be loaded. Try refreshing.": The server request failed or your role lacks this report. Press "Refresh"; if it repeats, ask an admin for access.
  - हिंदी: "संदेश: "This report could not be loaded. Try refreshing."": Server request फेल हुआ या आपके role को यह रिपोर्ट नहीं मिली। "Refresh" दबाएँ; बार-बार हो तो admin से अनुमति माँगें।
- "No figures for this period": Nothing was recorded for the filters. Widen the period or clear filters.
  - हिंदी: "संदेश: "No figures for this period"": Filter के हिसाब से कुछ दर्ज नहीं। अवधि बढ़ाएँ या filter हटाएँ।
- "No telemetry in selected period.": No job in the period has machine output logs. Ask work centers to log output on the terminal.
  - हिंदी: "संदेश: "No telemetry in selected period."": अवधि के किसी job पर machine output log नहीं। Work center से terminal पर output दर्ज करवाएँ।
- "No shift tags captured in selected telemetry. / No shift schedule configured.": Output logs have no shift code, or the plant has no active shift definitions. Set up shifts in factory settings.
  - हिंदी: "संदेश: "No shift tags captured in selected telemetry. / No shift schedule configured."": Output log पर shift code नहीं, या plant में कोई चालू shift नहीं। Factory setting में shift बनाएँ।

## Gate Register — /analytics/reports/gate
- "Gate report not available for this account": Your account lacks gate.reports. Ask an admin or owner to grant the Gate reports pack.
  - हिंदी: "संदेश: "Gate report not available for this account"": आपके account को gate.reports नहीं मिला। Admin या owner से Gate reports pack माँगें।
- "Choose an ordered date range of 366 days or fewer.": The custom range is longer than a year or reversed. Shorten it.
  - हिंदी: "संदेश: "Choose an ordered date range of 366 days or fewer."": Custom अवधि एक साल से लंबी या उल्टी है। छोटी करें।
- "The start date must be on or before the end date.": Fix the From/To dates.
  - हिंदी: "संदेश: "The start date must be on or before the end date."": From/To तारीख ठीक करें।
- "Plant does not exist.": The plant in the link is invalid. Pick a plant from the list.
  - हिंदी: "संदेश: "Plant does not exist."": Link में plant गलत है। सूची से plant चुनें।
- "This report could not be loaded. Try refreshing.": The server request failed or your role lacks this report. Press "Refresh"; if it repeats, ask an admin for access.
  - हिंदी: "संदेश: "This report could not be loaded. Try refreshing."": Server request फेल हुआ या आपके role को यह रिपोर्ट नहीं मिली। "Refresh" दबाएँ; बार-बार हो तो admin से अनुमति माँगें।
- "No figures for this period": Nothing was recorded for the filters. Widen the period or clear filters.
  - हिंदी: "संदेश: "No figures for this period"": Filter के हिसाब से कुछ दर्ज नहीं। अवधि बढ़ाएँ या filter हटाएँ।
- "No telemetry in selected period.": No job in the period has machine output logs. Ask work centers to log output on the terminal.
  - हिंदी: "संदेश: "No telemetry in selected period."": अवधि के किसी job पर machine output log नहीं। Work center से terminal पर output दर्ज करवाएँ।
- "No shift tags captured in selected telemetry. / No shift schedule configured.": Output logs have no shift code, or the plant has no active shift definitions. Set up shifts in factory settings.
  - हिंदी: "संदेश: "No shift tags captured in selected telemetry. / No shift schedule configured."": Output log पर shift code नहीं, या plant में कोई चालू shift नहीं। Factory setting में shift बनाएँ।

## Ink Intelligence — /analytics/reports/ink-intelligence
- "No material actuals captured.": No issue, consumption or return was posted against jobs in the period.
  - हिंदी: "संदेश: "No material actuals captured."": अवधि में job पर कोई issue, खपत या वापसी दर्ज नहीं।
- "This report could not be loaded. Try refreshing.": The server request failed or your role lacks this report. Press "Refresh"; if it repeats, ask an admin for access.
  - हिंदी: "संदेश: "This report could not be loaded. Try refreshing."": Server request फेल हुआ या आपके role को यह रिपोर्ट नहीं मिली। "Refresh" दबाएँ; बार-बार हो तो admin से अनुमति माँगें।
- "No figures for this period": Nothing was recorded for the filters. Widen the period or clear filters.
  - हिंदी: "संदेश: "No figures for this period"": Filter के हिसाब से कुछ दर्ज नहीं। अवधि बढ़ाएँ या filter हटाएँ।
- "No telemetry in selected period.": No job in the period has machine output logs. Ask work centers to log output on the terminal.
  - हिंदी: "संदेश: "No telemetry in selected period."": अवधि के किसी job पर machine output log नहीं। Work center से terminal पर output दर्ज करवाएँ।
- "No shift tags captured in selected telemetry. / No shift schedule configured.": Output logs have no shift code, or the plant has no active shift definitions. Set up shifts in factory settings.
  - हिंदी: "संदेश: "No shift tags captured in selected telemetry. / No shift schedule configured."": Output log पर shift code नहीं, या plant में कोई चालू shift नहीं। Factory setting में shift बनाएँ।

## Inter-Plant Logistics — /analytics/reports/interplant
- "This report could not be loaded. Try refreshing.": The server request failed or your role lacks this report. Press "Refresh"; if it repeats, ask an admin for access.
  - हिंदी: "संदेश: "This report could not be loaded. Try refreshing."": Server request फेल हुआ या आपके role को यह रिपोर्ट नहीं मिली। "Refresh" दबाएँ; बार-बार हो तो admin से अनुमति माँगें।
- "No figures for this period": Nothing was recorded for the filters. Widen the period or clear filters.
  - हिंदी: "संदेश: "No figures for this period"": Filter के हिसाब से कुछ दर्ज नहीं। अवधि बढ़ाएँ या filter हटाएँ।
- "No telemetry in selected period.": No job in the period has machine output logs. Ask work centers to log output on the terminal.
  - हिंदी: "संदेश: "No telemetry in selected period."": अवधि के किसी job पर machine output log नहीं। Work center से terminal पर output दर्ज करवाएँ।
- "No shift tags captured in selected telemetry. / No shift schedule configured.": Output logs have no shift code, or the plant has no active shift definitions. Set up shifts in factory settings.
  - हिंदी: "संदेश: "No shift tags captured in selected telemetry. / No shift schedule configured."": Output log पर shift code नहीं, या plant में कोई चालू shift नहीं। Factory setting में shift बनाएँ।

## Inventory Health — /analytics/reports/inventory
- "This report could not be loaded. Try refreshing.": The server request failed or your role lacks this report. Press "Refresh"; if it repeats, ask an admin for access.
  - हिंदी: "संदेश: "This report could not be loaded. Try refreshing."": Server request फेल हुआ या आपके role को यह रिपोर्ट नहीं मिली। "Refresh" दबाएँ; बार-बार हो तो admin से अनुमति माँगें।
- "No figures for this period": Nothing was recorded for the filters. Widen the period or clear filters.
  - हिंदी: "संदेश: "No figures for this period"": Filter के हिसाब से कुछ दर्ज नहीं। अवधि बढ़ाएँ या filter हटाएँ।
- "No telemetry in selected period.": No job in the period has machine output logs. Ask work centers to log output on the terminal.
  - हिंदी: "संदेश: "No telemetry in selected period."": अवधि के किसी job पर machine output log नहीं। Work center से terminal पर output दर्ज करवाएँ।
- "No shift tags captured in selected telemetry. / No shift schedule configured.": Output logs have no shift code, or the plant has no active shift definitions. Set up shifts in factory settings.
  - हिंदी: "संदेश: "No shift tags captured in selected telemetry. / No shift schedule configured."": Output log पर shift code नहीं, या plant में कोई चालू shift नहीं। Factory setting में shift बनाएँ।

## Inventory Lineage — /analytics/reports/inventory-lineage
- "This report could not be loaded. Try refreshing.": The server request failed or your role lacks this report. Press "Refresh"; if it repeats, ask an admin for access.
  - हिंदी: "संदेश: "This report could not be loaded. Try refreshing."": Server request फेल हुआ या आपके role को यह रिपोर्ट नहीं मिली। "Refresh" दबाएँ; बार-बार हो तो admin से अनुमति माँगें।
- "No figures for this period": Nothing was recorded for the filters. Widen the period or clear filters.
  - हिंदी: "संदेश: "No figures for this period"": Filter के हिसाब से कुछ दर्ज नहीं। अवधि बढ़ाएँ या filter हटाएँ।
- "No telemetry in selected period.": No job in the period has machine output logs. Ask work centers to log output on the terminal.
  - हिंदी: "संदेश: "No telemetry in selected period."": अवधि के किसी job पर machine output log नहीं। Work center से terminal पर output दर्ज करवाएँ।
- "No shift tags captured in selected telemetry. / No shift schedule configured.": Output logs have no shift code, or the plant has no active shift definitions. Set up shifts in factory settings.
  - हिंदी: "संदेश: "No shift tags captured in selected telemetry. / No shift schedule configured."": Output log पर shift code नहीं, या plant में कोई चालू shift नहीं। Factory setting में shift बनाएँ।

## Material Variance — /analytics/reports/material-variance
- "No material actuals captured.": No issue, consumption or return was posted against jobs in the period.
  - हिंदी: "संदेश: "No material actuals captured."": अवधि में job पर कोई issue, खपत या वापसी दर्ज नहीं।
- "This report could not be loaded. Try refreshing.": The server request failed or your role lacks this report. Press "Refresh"; if it repeats, ask an admin for access.
  - हिंदी: "संदेश: "This report could not be loaded. Try refreshing."": Server request फेल हुआ या आपके role को यह रिपोर्ट नहीं मिली। "Refresh" दबाएँ; बार-बार हो तो admin से अनुमति माँगें।
- "No figures for this period": Nothing was recorded for the filters. Widen the period or clear filters.
  - हिंदी: "संदेश: "No figures for this period"": Filter के हिसाब से कुछ दर्ज नहीं। अवधि बढ़ाएँ या filter हटाएँ।
- "No telemetry in selected period.": No job in the period has machine output logs. Ask work centers to log output on the terminal.
  - हिंदी: "संदेश: "No telemetry in selected period."": अवधि के किसी job पर machine output log नहीं। Work center से terminal पर output दर्ज करवाएँ।
- "No shift tags captured in selected telemetry. / No shift schedule configured.": Output logs have no shift code, or the plant has no active shift definitions. Set up shifts in factory settings.
  - हिंदी: "संदेश: "No shift tags captured in selected telemetry. / No shift schedule configured."": Output log पर shift code नहीं, या plant में कोई चालू shift नहीं। Factory setting में shift बनाएँ।

## MRP & Consumption Variance — /analytics/reports/mrp
- "No material actuals captured.": No issue, consumption or return was posted against jobs in the period.
  - हिंदी: "संदेश: "No material actuals captured."": अवधि में job पर कोई issue, खपत या वापसी दर्ज नहीं।
- "This report could not be loaded. Try refreshing.": The server request failed or your role lacks this report. Press "Refresh"; if it repeats, ask an admin for access.
  - हिंदी: "संदेश: "This report could not be loaded. Try refreshing."": Server request फेल हुआ या आपके role को यह रिपोर्ट नहीं मिली। "Refresh" दबाएँ; बार-बार हो तो admin से अनुमति माँगें।
- "No figures for this period": Nothing was recorded for the filters. Widen the period or clear filters.
  - हिंदी: "संदेश: "No figures for this period"": Filter के हिसाब से कुछ दर्ज नहीं। अवधि बढ़ाएँ या filter हटाएँ।
- "No telemetry in selected period.": No job in the period has machine output logs. Ask work centers to log output on the terminal.
  - हिंदी: "संदेश: "No telemetry in selected period."": अवधि के किसी job पर machine output log नहीं। Work center से terminal पर output दर्ज करवाएँ।
- "No shift tags captured in selected telemetry. / No shift schedule configured.": Output logs have no shift code, or the plant has no active shift definitions. Set up shifts in factory settings.
  - हिंदी: "संदेश: "No shift tags captured in selected telemetry. / No shift schedule configured."": Output log पर shift code नहीं, या plant में कोई चालू shift नहीं। Factory setting में shift बनाएँ।

## OEE Deep Dive — /analytics/reports/oee
- "N active machine(s) have no standard rate (kg/h)…": Set the standard rate on those machines in the machine master.
  - हिंदी: "संदेश: "N active machine(s) have no standard rate (kg/h)…"": उन मशीनों के master में standard rate भरें।
- "No machine telemetry found in the selected window.": No output, scrap or downtime on any active machine in the period.
  - हिंदी: "संदेश: "No machine telemetry found in the selected window."": अवधि में किसी चालू मशीन पर output, scrap या downtime नहीं।
- "This report could not be loaded. Try refreshing.": The server request failed or your role lacks this report. Press "Refresh"; if it repeats, ask an admin for access.
  - हिंदी: "संदेश: "This report could not be loaded. Try refreshing."": Server request फेल हुआ या आपके role को यह रिपोर्ट नहीं मिली। "Refresh" दबाएँ; बार-बार हो तो admin से अनुमति माँगें।
- "No figures for this period": Nothing was recorded for the filters. Widen the period or clear filters.
  - हिंदी: "संदेश: "No figures for this period"": Filter के हिसाब से कुछ दर्ज नहीं। अवधि बढ़ाएँ या filter हटाएँ।
- "No telemetry in selected period.": No job in the period has machine output logs. Ask work centers to log output on the terminal.
  - हिंदी: "संदेश: "No telemetry in selected period."": अवधि के किसी job पर machine output log नहीं। Work center से terminal पर output दर्ज करवाएँ।
- "No shift tags captured in selected telemetry. / No shift schedule configured.": Output logs have no shift code, or the plant has no active shift definitions. Set up shifts in factory settings.
  - हिंदी: "संदेश: "No shift tags captured in selected telemetry. / No shift schedule configured."": Output log पर shift code नहीं, या plant में कोई चालू shift नहीं। Factory setting में shift बनाएँ।

## Operator Performance — /analytics/reports/operator
- "This report could not be loaded. Try refreshing.": The server request failed or your role lacks this report. Press "Refresh"; if it repeats, ask an admin for access.
  - हिंदी: "संदेश: "This report could not be loaded. Try refreshing."": Server request फेल हुआ या आपके role को यह रिपोर्ट नहीं मिली। "Refresh" दबाएँ; बार-बार हो तो admin से अनुमति माँगें।
- "No figures for this period": Nothing was recorded for the filters. Widen the period or clear filters.
  - हिंदी: "संदेश: "No figures for this period"": Filter के हिसाब से कुछ दर्ज नहीं। अवधि बढ़ाएँ या filter हटाएँ।
- "No telemetry in selected period.": No job in the period has machine output logs. Ask work centers to log output on the terminal.
  - हिंदी: "संदेश: "No telemetry in selected period."": अवधि के किसी job पर machine output log नहीं। Work center से terminal पर output दर्ज करवाएँ।
- "No shift tags captured in selected telemetry. / No shift schedule configured.": Output logs have no shift code, or the plant has no active shift definitions. Set up shifts in factory settings.
  - हिंदी: "संदेश: "No shift tags captured in selected telemetry. / No shift schedule configured."": Output log पर shift code नहीं, या plant में कोई चालू shift नहीं। Factory setting में shift बनाएँ।

## Production Performance — /analytics/reports/production
- "Jobs exist in the selected window but no execution output was logged.": Jobs were created but nobody logged output. Check the terminals.
  - हिंदी: "संदेश: "Jobs exist in the selected window but no execution output was logged."": Job बने पर किसी ने output दर्ज नहीं किया। Terminal जाँचें।
- "Scrap exceeded good output in the selected production window.": More scrap than good output. Check for wrong entries (KG vs pieces) or a real quality problem.
  - हिंदी: "संदेश: "Scrap exceeded good output in the selected production window."": अच्छे output से ज़्यादा scrap। गलत entry (KG बनाम pieces) या असली quality समस्या जाँचें।
- "N jobs have no reliable KG conversion…": These jobs are in pieces without a unit weight. Add the unit weight on the sales line.
  - हिंदी: "संदेश: "N jobs have no reliable KG conversion…"": ये job pieces में हैं और unit weight नहीं। Sales line पर unit weight जोड़ें।
- "This report could not be loaded. Try refreshing.": The server request failed or your role lacks this report. Press "Refresh"; if it repeats, ask an admin for access.
  - हिंदी: "संदेश: "This report could not be loaded. Try refreshing."": Server request फेल हुआ या आपके role को यह रिपोर्ट नहीं मिली। "Refresh" दबाएँ; बार-बार हो तो admin से अनुमति माँगें।
- "No figures for this period": Nothing was recorded for the filters. Widen the period or clear filters.
  - हिंदी: "संदेश: "No figures for this period"": Filter के हिसाब से कुछ दर्ज नहीं। अवधि बढ़ाएँ या filter हटाएँ।
- "No telemetry in selected period.": No job in the period has machine output logs. Ask work centers to log output on the terminal.
  - हिंदी: "संदेश: "No telemetry in selected period."": अवधि के किसी job पर machine output log नहीं। Work center से terminal पर output दर्ज करवाएँ।
- "No shift tags captured in selected telemetry. / No shift schedule configured.": Output logs have no shift code, or the plant has no active shift definitions. Set up shifts in factory settings.
  - हिंदी: "संदेश: "No shift tags captured in selected telemetry. / No shift schedule configured."": Output log पर shift code नहीं, या plant में कोई चालू shift नहीं। Factory setting में shift बनाएँ।

## Sales Fulfillment — /analytics/reports/sales
- "Completion timing is a proxy, not OTIF…": Standing warning: the on-time figure is approximate until full-quantity and POD policy are set.
  - हिंदी: "संदेश: "Completion timing is a proxy, not OTIF…"": स्थायी चेतावनी: पूरी मात्रा और POD नियम तय होने तक on-time आँकड़ा अनुमान है।
- "This report could not be loaded. Try refreshing.": The server request failed or your role lacks this report. Press "Refresh"; if it repeats, ask an admin for access.
  - हिंदी: "संदेश: "This report could not be loaded. Try refreshing."": Server request फेल हुआ या आपके role को यह रिपोर्ट नहीं मिली। "Refresh" दबाएँ; बार-बार हो तो admin से अनुमति माँगें।
- "No figures for this period": Nothing was recorded for the filters. Widen the period or clear filters.
  - हिंदी: "संदेश: "No figures for this period"": Filter के हिसाब से कुछ दर्ज नहीं। अवधि बढ़ाएँ या filter हटाएँ।
- "No telemetry in selected period.": No job in the period has machine output logs. Ask work centers to log output on the terminal.
  - हिंदी: "संदेश: "No telemetry in selected period."": अवधि के किसी job पर machine output log नहीं। Work center से terminal पर output दर्ज करवाएँ।
- "No shift tags captured in selected telemetry. / No shift schedule configured.": Output logs have no shift code, or the plant has no active shift definitions. Set up shifts in factory settings.
  - हिंदी: "संदेश: "No shift tags captured in selected telemetry. / No shift schedule configured."": Output log पर shift code नहीं, या plant में कोई चालू shift नहीं। Factory setting में shift बनाएँ।

## Scrap & Yield — /analytics/reports/scrap
- "No scrap events were logged for the selected filter window.": No scrap logs in the period. Widen the dates or check that operators log scrap.
  - हिंदी: "संदेश: "No scrap events were logged for the selected filter window."": अवधि में scrap log नहीं। तारीख बढ़ाएँ या देखें operator scrap दर्ज करते हैं।
- "This report could not be loaded. Try refreshing.": The server request failed or your role lacks this report. Press "Refresh"; if it repeats, ask an admin for access.
  - हिंदी: "संदेश: "This report could not be loaded. Try refreshing."": Server request फेल हुआ या आपके role को यह रिपोर्ट नहीं मिली। "Refresh" दबाएँ; बार-बार हो तो admin से अनुमति माँगें।
- "No figures for this period": Nothing was recorded for the filters. Widen the period or clear filters.
  - हिंदी: "संदेश: "No figures for this period"": Filter के हिसाब से कुछ दर्ज नहीं। अवधि बढ़ाएँ या filter हटाएँ।
- "No telemetry in selected period.": No job in the period has machine output logs. Ask work centers to log output on the terminal.
  - हिंदी: "संदेश: "No telemetry in selected period."": अवधि के किसी job पर machine output log नहीं। Work center से terminal पर output दर्ज करवाएँ।
- "No shift tags captured in selected telemetry. / No shift schedule configured.": Output logs have no shift code, or the plant has no active shift definitions. Set up shifts in factory settings.
  - हिंदी: "संदेश: "No shift tags captured in selected telemetry. / No shift schedule configured."": Output log पर shift code नहीं, या plant में कोई चालू shift नहीं। Factory setting में shift बनाएँ।

## Shift Performance — /analytics/reports/shift-performance
- "This report could not be loaded. Try refreshing.": The server request failed or your role lacks this report. Press "Refresh"; if it repeats, ask an admin for access.
  - हिंदी: "संदेश: "This report could not be loaded. Try refreshing."": Server request फेल हुआ या आपके role को यह रिपोर्ट नहीं मिली। "Refresh" दबाएँ; बार-बार हो तो admin से अनुमति माँगें।
- "No figures for this period": Nothing was recorded for the filters. Widen the period or clear filters.
  - हिंदी: "संदेश: "No figures for this period"": Filter के हिसाब से कुछ दर्ज नहीं। अवधि बढ़ाएँ या filter हटाएँ।
- "No telemetry in selected period.": No job in the period has machine output logs. Ask work centers to log output on the terminal.
  - हिंदी: "संदेश: "No telemetry in selected period."": अवधि के किसी job पर machine output log नहीं। Work center से terminal पर output दर्ज करवाएँ।
- "No shift tags captured in selected telemetry. / No shift schedule configured.": Output logs have no shift code, or the plant has no active shift definitions. Set up shifts in factory settings.
  - हिंदी: "संदेश: "No shift tags captured in selected telemetry. / No shift schedule configured."": Output log पर shift code नहीं, या plant में कोई चालू shift नहीं। Factory setting में shift बनाएँ।

## Trading Pulse — /analytics/reports/trading
- "Report forbidden": The trading report needs sales view permission.
  - हिंदी: "रिपोर्ट की अनुमति नहीं": Trading रिपोर्ट के लिए sales देखने की अनुमति चाहिए।

## Scrap Center — /analytics/scrap
- "No scrap rows in this period": Nothing was logged for the plant and dates. Widen the dates.
  - हिंदी: "संदेश: "No scrap rows in this period"": Plant और तारीख में कुछ दर्ज नहीं। तारीख बढ़ाएँ।

## System (opens User Management) — /system
- "Access denied (on the user list)": Your role is not Owner/Admin and you have no rbac.view grant. Ask an Owner to add it in Role matrix or as a user override.
  - हिंदी: "Access denied (यूज़र लिस्ट पर)": आपका रोल Owner/Admin नहीं है और rbac.view अनुमति नहीं है। Owner से Role matrix में या यूज़र override में यह अनुमति जुड़वाएँ।

## Audit Center — /system/audit
- "Audit Center is limited to owner and admin roles.": Your active role is not Owner/Admin/Super Admin. Use "Open Roll Genealogy" for roll history, or ask an Owner.
  - हिंदी: "स्क्रीन पर संदेश: "Audit Center is limited to owner and admin roles."": आपका चालू रोल Owner/Admin/Super Admin नहीं है। Roll का इतिहास देखने के लिए "Open Roll Genealogy" दबाएँ, या Owner से पूछें।
- "No audit events match the current filters.": The range is too short or a stream/actor/severity filter hides the rows. Set Range to "Last 7d" or "All audit", or press "Reset".
  - हिंदी: "स्क्रीन पर संदेश: "No audit events match the current filters."": Range बहुत छोटा है या stream/actor/severity filter rows छुपा रहा है। Range "Last 7d" या "All audit" करें, या "Reset" दबाएँ।
- "Trace shows a warning icon": The text is not a traceable reference. Type the full code exactly (e.g. SO-2026-0123) or open the row and use its reference.
  - हिंदी: "Trace पर चेतावनी का निशान": लिखा गया text trace होने वाला reference नहीं है। पूरा code सही लिखें (जैसे SO-2026-0123) या row खोलकर उसका reference इस्तेमाल करें।

## Company Profile — /system/company-profile
- "Access denied": You lack system.view. Ask an Owner or Admin to grant it.
  - हिंदी: "स्क्रीन पर संदेश: "Access denied"": आपके पास system.view नहीं है। Owner या Admin से दिलवाएँ।
- "Save failed": The server refused a value (message shown under the title) or the network dropped. Fix the field and press "Save changes" again.
  - हिंदी: "स्क्रीन पर संदेश: "Save failed"": सर्वर ने कोई value नहीं मानी (title के नीचे संदेश) या नेटवर्क टूटा। फ़ील्ड ठीक करके फिर "Save changes" दबाएँ।
- "Fields are grey and there is no save bar": You have view but not system.manage. Only view is possible.
  - हिंदी: "फ़ील्ड धूसर हैं और save बार नहीं है": आपके पास देखने की अनुमति है पर system.manage नहीं। सिर्फ़ देख सकते हैं।

## RBAC + Notification Operations (Governance) — /system/governance
- "Event key is required (example: production.fg_ready).": You pressed "Create rule" with an empty event key. Fill it.
  - हिंदी: "स्क्रीन पर संदेश: "Event key is required (example: production.fg_ready)."": Event key खाली रखकर "Create rule" दबाया। उसे भरें।
- "Role, module key, and action key are required.": A signoff needs all three. Pick the role and type the module and action.
  - हिंदी: "स्क्रीन पर संदेश: "Role, module key, and action key are required."": Signoff के लिए तीनों चाहिए। रोल चुनें और module व action लिखें।
- "Only pending requests can be reviewed": The profile request was already approved, rejected or cancelled by the user. Refresh the tab.
  - हिंदी: "स्क्रीन पर संदेश: "Only pending requests can be reviewed"": Profile request पहले ही मंज़ूर, अस्वीकार या यूज़र द्वारा रद्द हो चुकी है। टैब refresh करें।
- "Access denied": Your role is not Owner/Admin/Super Admin.
  - हिंदी: "स्क्रीन पर संदेश: "Access denied"": आपका रोल Owner/Admin/Super Admin नहीं है।

## Scrap & Downtime Reasons — /system/reason-codes
- "Access denied — needs production.manage (OWNER or ADMIN)": Your role cannot manage reasons. Ask an Owner to grant production.manage.
  - हिंदी: "Access denied — production.manage चाहिए (OWNER या ADMIN)": आपका रोल कारण नहीं बदल सकता। Owner से production.manage दिलवाएँ।
- "Could not add reason": Usually the code already exists in this list, or Code/Label is empty. Use another code.
  - हिंदी: "स्क्रीन पर संदेश: "Could not add reason"": आम तौर पर यह code पहले से लिस्ट में है, या Code/Label खाली है। दूसरा code लें।
- "Delete failed": The server refused the delete. Mark the reason Inactive instead.
  - हिंदी: "स्क्रीन पर संदेश: "Delete failed"": सर्वर ने delete नहीं माना। उसकी जगह कारण को Inactive करें।
- "Failed to load reasons": Network or server problem. Press "Refresh".
  - हिंदी: "स्क्रीन पर संदेश: "Failed to load reasons"": नेटवर्क या सर्वर की दिक्कत। "Refresh" दबाएँ।

## Reorder & safety stock policy — /system/reorder-policy
- "Save failed": A value is not a valid number or you lack materials.manage/inventory.manage. Correct it or ask an Owner.
  - हिंदी: "स्क्रीन पर संदेश: "Save failed"": कोई value सही नंबर नहीं है या आपके पास materials.manage/inventory.manage नहीं है। ठीक करें या Owner से पूछें।
- "Scan failed": The scan could not run (server busy or no permission). Try again in a minute.
  - हिंदी: "स्क्रीन पर संदेश: "Scan failed"": Scan नहीं चल सका (सर्वर व्यस्त या अनुमति नहीं)। एक मिनट बाद फिर करें।
- "No materials match the current filter.": Clear the search and category, untick "Only materials without policy".
  - हिंदी: "स्क्रीन पर संदेश: "No materials match the current filter."": Search और category हटाएँ, "Only materials without policy" अनटिक करें।

## Report Center — /system/report-center
- "Report Center Restricted": Only report admins can see archives. Ask an Owner for analytics.view.
  - हिंदी: "स्क्रीन पर संदेश: "Report Center Restricted"": Archive सिर्फ़ report admin देख सकते हैं। Owner से analytics.view माँगें।
- "Could not generate report pack": The pack failed to build (message shows why). Try again later; check System Health if it repeats.
  - हिंदी: "स्क्रीन पर संदेश: "Could not generate report pack"": Pack नहीं बना (संदेश में कारण)। बाद में फिर करें; बार-बार हो तो System Health देखें।
- "No archived report packs yet.": No pack has run in the last 45 days. Turn one Active and press "Generate now".
  - हिंदी: "स्क्रीन पर संदेश: "No archived report packs yet."": पिछले 45 दिन में कोई pack नहीं चला। एक को Active करके "Generate now" दबाएँ।

## Role Matrix — /system/role-matrix
- "System role editing is locked. Enable unlock to modify this role.": You chose OWNER/ADMIN/SUPER_ADMIN. Switch on the unlock first.
  - हिंदी: "स्क्रीन पर संदेश: "System role editing is locked. Enable unlock to modify this role."": आपने OWNER/ADMIN/SUPER_ADMIN चुना है। पहले unlock चालू करें।
- "Save failed": You lack rbac.manage or the server refused a code. Read the message and retry.
  - हिंदी: "स्क्रीन पर संदेश: "Save failed"": आपके पास rbac.manage नहीं है या सर्वर ने कोई code नहीं माना। संदेश पढ़कर फिर करें।
- "No change — preset did not add new permissions": The role already has everything in that preset.
  - हिंदी: "No change — preset ने कुछ नहीं जोड़ा": रोल के पास उस preset की सारी permission पहले से हैं।

## System Settings — Report delivery settings removed — /system/settings
- "Counts show 0": No pack is Active or you lack analytics access. Open the Report Center to check.
  - हिंदी: "गिनती 0 दिखती है": कोई pack Active नहीं है या analytics अनुमति नहीं है। Report Center में जाँचें।

## Shift Timing — Fixed shift windows — /system/shift-timing
- "Shift save failed": Code or name is empty, the code already exists for the plant, or times are invalid. Fix and save again.
  - हिंदी: "स्क्रीन पर संदेश: "Shift save failed"": Code या नाम खाली है, code प्लांट में पहले से है, या समय गलत है। ठीक करके फिर सेव करें।
- "Delete failed": The server refused. Switch the shift to inactive instead.
  - हिंदी: "स्क्रीन पर संदेश: "Delete failed"": सर्वर ने मना किया। उसकी जगह shift को inactive करें।
- "No shifts configured for this plant.": Add at least one shift so logs get a shift.
  - हिंदी: "स्क्रीन पर संदेश: "No shifts configured for this plant."": कम से कम एक shift जोड़ें ताकि log को shift मिले।

## User Management — /system/users
- "Access denied — you need rbac.view to see the user registry.": Ask an Owner to grant rbac.view.
  - हिंदी: "Access denied — user registry देखने के लिए rbac.view चाहिए।": Owner से rbac.view दिलवाएँ।
- "No users match — Try clearing filters.": Clear the search box and click "All".
  - हिंदी: "स्क्रीन पर संदेश: "No users match — Try clearing filters."": Search खाली करें और "All" पर क्लिक करें।

## Edit user — /system/users/[id]
- "Work center required — Work Center Manager users must be assigned to at least one work center.": Tick at least one work centre under "Work-center scope".
  - हिंदी: "स्क्रीन पर संदेश: "Work center required — Work Center Manager users must be assigned to at least one work center."": "Work-center scope" में कम से कम एक work centre टिक करें।
- "Machine required — A Machine Operator must be given at least one machine to run.": Tick at least one machine under "Machines this operator runs".
  - हिंदी: "स्क्रीन पर संदेश: "Machine required — A Machine Operator must be given at least one machine to run."": "Machines this operator runs" में कम से कम एक machine टिक करें।
- "A Machine Operator is given machines, not work centres. Assign machines instead.": Operators get machines; managers get work centres. Clear the work centres.
  - हिंदी: "स्क्रीन पर संदेश: "A Machine Operator is given machines, not work centres. Assign machines instead."": Operator को machine मिलती है, manager को work centre। Work centre हटाएँ।
- "Only an owner can grant owner rights. / Only an owner can change an owner account.": Ask an existing Owner to make this change.
  - हिंदी: "स्क्रीन पर संदेश: "Only an owner can grant owner rights. / Only an owner can change an owner account."": मौजूदा Owner से यह बदलाव करवाएँ।
- "This is the last active owner account; add another owner first.": Make a second user Owner before disabling or demoting this one.
  - हिंदी: "स्क्रीन पर संदेश: "This is the last active owner account; add another owner first."": इसे बंद या नीचे करने से पहले किसी दूसरे यूज़र को Owner बनाएँ।
- "Watchman users cannot be owners. / Watchman permissions are limited to the gate terminal.": A Watchman gets only the gate; remove overrides and the owner flag.
  - हिंदी: "स्क्रीन पर संदेश: "Watchman users cannot be owners. / Watchman permissions are limited to the gate terminal."": Watchman को सिर्फ़ gate मिलता है; override और owner flag हटाएँ।
- "Permission '<code>' is not assignable as user-level override.": That permission can only come from a role. Change it in the Role Matrix.
  - हिंदी: "स्क्रीन पर संदेश: "Permission '<code>' is not assignable as user-level override."": यह permission सिर्फ़ रोल से मिलती है। Role Matrix में बदलें।
- "Reset failed": The new password is too short, too common or only numbers. Use a stronger one.
  - हिंदी: "स्क्रीन पर संदेश: "Reset failed"": नया password बहुत छोटा, बहुत आम या सिर्फ़ अंकों का है। मज़बूत password लें।

## Add user — /system/users/new
- "Password required — Enter an initial password for the new user.": Type an initial password.
  - हिंदी: "स्क्रीन पर संदेश: "Password required — Enter an initial password for the new user."": शुरुआती password लिखें।
- "The initial password must be at least 8 characters. / cannot be only numbers.": Use 8+ characters with letters.
  - हिंदी: "स्क्रीन पर संदेश: "The initial password must be at least 8 characters. / cannot be only numbers."": अक्षरों के साथ 8 या ज़्यादा characters लें।
- "Email is required.": Fill the Email field.
  - हिंदी: "स्क्रीन पर संदेश: "Email is required."": Email भरें।
- "Create failed": Username or email is already used, or a scope rule failed (message shows which). Fix and retry.
  - हिंदी: "स्क्रीन पर संदेश: "Create failed"": Username या email पहले से इस्तेमाल में है, या scope का नियम टूटा (संदेश बताएगा)। ठीक करके फिर करें।
- "Work center required — Work Center Manager users must be assigned to at least one work center.": Tick at least one work centre under "Work-center scope".
  - हिंदी: "स्क्रीन पर संदेश: "Work center required — Work Center Manager users must be assigned to at least one work center."": "Work-center scope" में कम से कम एक work centre टिक करें।
- "Machine required — A Machine Operator must be given at least one machine to run.": Tick at least one machine under "Machines this operator runs".
  - हिंदी: "स्क्रीन पर संदेश: "Machine required — A Machine Operator must be given at least one machine to run."": "Machines this operator runs" में कम से कम एक machine टिक करें।
- "A Machine Operator is given machines, not work centres. Assign machines instead.": Operators get machines; managers get work centres. Clear the work centres.
  - हिंदी: "स्क्रीन पर संदेश: "A Machine Operator is given machines, not work centres. Assign machines instead."": Operator को machine मिलती है, manager को work centre। Work centre हटाएँ।

## Purchase Orders — /procurement/purchase-orders
- "No purchase orders yet.": Create one from MRP or with "New PO".
  - हिंदी: "स्क्रीन पर संदेश: "No purchase orders yet."": MRP से या "New PO" से एक बनाएँ।
- ""New PO" is missing": Plant Manager can view only; creating needs procurement.manage (Store/Owner/Admin).
  - हिंदी: ""New PO" नहीं दिखता": Plant Manager सिर्फ़ देख सकते हैं; बनाने के लिए procurement.manage (Store/Owner/Admin) चाहिए।

## Purchase Order (detail) — /procurement/purchase-orders/[id]
- "Only DRAFT POs can be sent (current: <status>)": The PO was already sent. Nothing to do.
  - हिंदी: "स्क्रीन पर संदेश: "Only DRAFT POs can be sent (current: <status>)"": PO पहले ही भेजा जा चुका है। कुछ करने की ज़रूरत नहीं।
- "Cannot send an empty PO": The draft has no lines.
  - हिंदी: "स्क्रीन पर संदेश: "Cannot send an empty PO"": Draft में कोई लाइन नहीं है।
- "Cannot cancel a <status> PO": Completed or cancelled POs cannot be cancelled.
  - हिंदी: "स्क्रीन पर संदेश: "Cannot cancel a <status> PO"": Completed या cancelled PO रद्द नहीं होते।
- "Items can only be edited while the PO is in DRAFT.": After sending, lines are fixed; close short or cancel and raise a new PO.
  - हिंदी: "स्क्रीन पर संदेश: "Items can only be edited while the PO is in DRAFT."": भेजने के बाद लाइनें तय हैं; close short या cancel करके नया PO बनाएँ।
- "No receipts yet.": Nothing received; press "Receive" to record a GRN.
  - हिंदी: "स्क्रीन पर संदेश: "No receipts yet."": अभी कुछ नहीं आया; GRN के लिए "Receive" दबाएँ।

## Receive against PO (GRN wizard) — /procurement/purchase-orders/[id]/receive
- "Cannot receive against <status> PO": The PO is DRAFT, COMPLETED or CANCELLED. Send it first, or use the right PO.
  - हिंदी: "स्क्रीन पर संदेश: "Cannot receive against <status> PO"": PO DRAFT, COMPLETED या CANCELLED है। पहले भेजें, या सही PO लें।
- "Duplicate vendor invoice '<no>' for vendor <code>.": This invoice was already received. Check the invoice number.
  - हिंदी: "स्क्रीन पर संदेश: "Duplicate vendor invoice '<no>' for vendor <code>."": यह invoice पहले ही receive हो चुका है। Invoice नंबर जाँचें।
- "Line <n>: over-receipt > 5% tolerance (allowed …, attempted …)": You typed more than 5% above the open quantity. Correct the quantity or ask purchase to amend.
  - हिंदी: "स्क्रीन पर संदेश: "Line <n>: over-receipt > 5% tolerance (allowed …, attempted …)"": आपने open मात्रा से 5% से ज़्यादा लिखा। मात्रा ठीक करें या purchase से बदलवाएँ।
- "Line <n> is already closed; cannot receive against it. / no open quantity remains to receive.": That line is closed short or fully received. Set its Receiving to 0.
  - हिंदी: "स्क्रीन पर संदेश: "Line <n> is already closed; cannot receive against it. / no open quantity remains to receive."": वह लाइन close short या पूरी आ चुकी है। उसका Receiving 0 करें।
- "Roll receipt for line <n> needs width_mm and thickness_micron.": Fill Width (mm) and Thk (µm) for the film line.
  - हिंदी: "स्क्रीन पर संदेश: "Roll receipt for line <n> needs width_mm and thickness_micron."": Film लाइन के लिए Width (mm) और Thk (µm) भरें।
- "No InventoryLocation configured for plant <plant>": Ask an admin to create a location for the plant (Factory → Locations).
  - हिंदी: "स्क्रीन पर संदेश: "No InventoryLocation configured for plant <plant>"": Admin से प्लांट की location बनवाएँ (Factory → Locations)।
- "This PO belongs to a different factory than the gate bill.": A bill can be received only at its own plant: pick a PO of that plant or post without the bill.
  - हिंदी: "स्क्रीन पर संदेश: "This PO belongs to a different factory than the gate bill."": बिल सिर्फ़ अपने प्लांट में receive होता है: उस प्लांट का PO लें या बिल के बिना पोस्ट करें।
- "At least one line required": Enter a Receiving quantity on at least one line.
  - हिंदी: "स्क्रीन पर संदेश: "At least one line required"": कम से कम एक लाइन पर Receiving मात्रा भरें।

## New Purchase Order — /procurement/purchase-orders/new
- "Failed to save PO": A required header field or a line value is missing/invalid. The server message names it.
  - हिंदी: "स्क्रीन पर संदेश: "Failed to save PO"": Header का ज़रूरी field या लाइन की value नहीं है/गलत है। सर्वर का संदेश बताएगा।
- "Cannot send an empty PO": A PO with no lines cannot be sent later. Add at least one line.
  - हिंदी: "स्क्रीन पर संदेश: "Cannot send an empty PO"": बिना लाइन वाला PO भेजा नहीं जा सकता। कम से कम एक लाइन जोड़ें।

## My Profile — /profile
- "No changes detected — Update at least one profile field before submitting.": Change a field first.
  - हिंदी: "स्क्रीन पर संदेश: "No changes detected — Update at least one profile field before submitting."": पहले कोई field बदलें।
- "Email required — Email is mandatory for all users.": Do not leave Email blank.
  - हिंदी: "स्क्रीन पर संदेश: "Email required — Email is mandatory for all users."": Email खाली न छोड़ें।
- "Missing fields — Fill current, new, and confirm password.": Fill all three password boxes.
  - हिंदी: "स्क्रीन पर संदेश: "Missing fields — Fill current, new, and confirm password."": तीनों password बॉक्स भरें।
- "Password mismatch": New password and confirmation differ. Type them again.
  - हिंदी: "स्क्रीन पर संदेश: "Password mismatch"": नया password और पुष्टि अलग हैं। फिर से लिखें।
- "Current password is incorrect": Type your present password; if forgotten, ask an admin to reset it in User Management.
  - हिंदी: "स्क्रीन पर संदेश: "Current password is incorrect"": अपना मौजूदा password लिखें; भूल गए हों तो admin से User Management में reset करवाएँ।
- "Only pending requests can be cancelled": The admin already reviewed it.
  - हिंदी: "स्क्रीन पर संदेश: "Only pending requests can be cancelled"": Admin ने पहले ही उसे देख लिया है।

## Help guide (Total Poly Print ERP) — /help
- "This guide was not found.": The link points to a page with no guide. Press "Go to the guide home" and search.
  - हिंदी: "स्क्रीन पर संदेश: "This guide was not found."": लिंक ऐसे पेज का है जिसका गाइड नहीं। "Go to the guide home" दबाकर खोजें।
- "Nothing found. Try another word.": Use a screen name or button label, e.g. "Place order".
  - हिंदी: "स्क्रीन पर संदेश: "Nothing found. Try another word."": स्क्रीन का नाम या बटन का label लिखें, जैसे "Place order"।

## Help for a page (redirect) — /help/pages/[...route]
- "This guide was not found.": The route has no guide or was mistyped.
  - हिंदी: "स्क्रीन पर संदेश: "This guide was not found."": उस route का गाइड नहीं है या पता गलत लिखा है।

## Help for a role (redirect) — /help/roles/[role]
- "This guide was not found.": Unknown role code. Use one of the codes listed.
  - हिंदी: "स्क्रीन पर संदेश: "This guide was not found."": अनजान role code। दी गई लिस्ट का code लें।

## FAQ
- **The machine said "pcs_per_pack must be > 0" at the last step.** Fixed on 27 Oct: a missing pieces per inner pouch no longer stops the output. The machine saves it with the note "Output logged. Pieces per inner pouch is not set on this order…"; no inner pouches are taken at the machine, the Packing Yard types "Inner packs filled" and the evening packing count books them to the order. To stop the note, set "Pouches per inner pouch (default)" on that inner pouch in Masters → Packaging; the order page now asks for it before placing. You still type the pieces count when the machine asks for it.
  - **आखिरी स्टेप पर मशीन ने "pcs_per_pack must be > 0" दिखाया।** 27 Oct को ठीक किया: pieces per inner pouch न होने से अब आउटपुट नहीं रुकता। मशीन आउटपुट सेव करती है और "Output logged. Pieces per inner pouch is not set on this order…" दिखाती है; मशीन पर inner pouch नहीं कटते, Packing Yard "Inner packs filled" भरता है और शाम की packing गिनती उन्हें ऑर्डर पर बुक करती है। यह संदेश बंद करने के लिए Masters → Packaging में उस inner pouch पर "Pouches per inner pouch (default)" भरें; ऑर्डर पेज अब प्लेस करने से पहले यह पूछता है। मशीन pieces की गिनती माँगे तो वह फिर भी लिखनी होगी।
- **A screen or button I need is not there.** Pages show only what your role may use. Ask the admin to add the page to your role or give you a personal permission in System → Users.
  - **मुझे जो स्क्रीन या बटन चाहिए वह नहीं दिख रहा।** पेज सिर्फ वही दिखाते हैं जो आपकी भूमिका में है। एडमिन से System → Users में पेज की अनुमति लें।
- **A packing item (putha, box, tape…) is not in the release tick list.** Only inner pouches are never listed: in-house ones come off stock at the machine's last pouching step, and bought ones are booked by the evening packing count. Open Masters → Packaging: the item must be active and its kind must not be "Inner pouch" (a putha is "Sheet · putha · board").
  - **पैकिंग आइटम (putha, box, tape…) रिलीज़ की टिक लिस्ट में नहीं है।** सिर्फ inner pouch कभी लिस्ट में नहीं आते: घर के inner pouch मशीन के आखिरी pouching स्टेप पर स्टॉक से कटते हैं, और खरीदे हुए शाम की packing गिनती से बुक होते हैं। Masters → Packaging खोलें: आइटम active हो और उसकी kind "Inner pouch" न हो (putha के लिए "Sheet · putha · board")।
- **Why do we tick packing items instead of typing quantities?** The store counts packing material every evening. The counted use is split over the order lines that ticked each item that day (if no one ticked it, over that day's orders whose packing plan includes it), so ticks are enough and the floor is never blocked by stock gaps.
  - **पैकिंग आइटम की मात्रा लिखने की बजाय टिक क्यों करते हैं?** स्टोर हर शाम पैकिंग मटीरियल गिनता है। गिना हुआ इस्तेमाल उन ऑर्डर लाइनों में बँटता है जिन्होंने उस दिन आइटम टिक किया (किसी ने टिक न किया हो तो उस दिन के उन ऑर्डरों में जिनके packing plan में वह आइटम है), इसलिए टिक काफ़ी है और स्टॉक की कमी से फ़्लोर नहीं रुकता।
- **"Place order" stays grey.** Something is still missing. Open "Before you place" under the lines: each item has "Fix →" that opens the line or the field.
  - **"Place order" बटन ग्रे ही रहता है।** कुछ बाकी है। लाइनों के नीचे "Before you place" खोलें: हर आइटम पर "Fix →" है जो लाइन या फ़ील्ड खोल देता है।
- **I closed the order page by mistake. Is my order lost?** No. Drafts save in this browser as you type. Open New order again and press "Resume draft". A draft on another computer is not shared.
  - **गलती से ऑर्डर पेज बंद हो गया। क्या ऑर्डर गया?** नहीं। टाइप करते ही ड्राफ़्ट इसी ब्राउज़र में सेव होता है। New order फिर खोलें और "Resume draft" दबाएँ। दूसरे कंप्यूटर पर ड्राफ़्ट नहीं दिखेगा।
- **The order is closed but goods are still in the yard. What do I do?** Either ship them (load the line and tick "Send goods of closed lines") or press "Move to stock" with a reason; the planner can then use them for another order with the same spec.
  - **ऑर्डर बंद है पर माल यार्ड में है। क्या करें?** या तो भेजें (लाइन लोड करें और "Send goods of closed lines" टिक करें) या कारण के साथ "Move to stock" दबाएँ; प्लानर उन्हें उसी स्पेक के दूसरे ऑर्डर में ले सकता है।
- **How do I reprint a dispatch slip or record proof of delivery?** Dispatch Bay → "Challans & history": search the slip or order number, then print again or open POD. From an order page use "Slips in Dispatch Bay".
  - **डिस्पैच स्लिप दोबारा कैसे प्रिंट करें या डिलीवरी का सबूत कैसे दर्ज करें?** Dispatch Bay → "Challans & history": स्लिप या ऑर्डर नंबर खोजें, फिर दोबारा प्रिंट करें या POD खोलें। ऑर्डर पेज से "Slips in Dispatch Bay" दबाएँ।
- **No roll can be picked for the job.** Rolls must be within ±20 mm of the width the line runs at (after lanes). Ask the store for a roll in that window or the planner to change lanes.
  - **जॉब के लिए कोई रोल नहीं चुन पा रहे।** रोल लाइन की चौड़ाई (lanes के बाद) से ±20 mm के अंदर होना चाहिए। स्टोर से उस विंडो का रोल माँगें या प्लानर से lanes बदलवाएँ।
- **How do I switch the help to Hindi?** Press "हिंदी" at the top of the guide or in the Help panel. Your choice is remembered, and shared links keep their language.
  - **मदद हिंदी में कैसे देखें?** गाइड के ऊपर या Help पैनल में "हिंदी" दबाएँ। आपकी पसंद याद रहती है और शेयर किए लिंक उसी भाषा में खुलते हैं।
- **How do I send a guide page to a colleague?** Press "Share", "WhatsApp" or "Link" on any guide page. The public guide (erp.totalpolyprint.com/guide) opens without signing in.
  - **किसी साथी को गाइड का पेज कैसे भेजें?** किसी भी गाइड पेज पर "Share", "WhatsApp" या "Link" दबाएँ। पब्लिक गाइड (erp.totalpolyprint.com/guide) बिना साइन इन के खुलती है।
- **The numbers look old.** Most floor pages refresh on their own every few seconds; press the refresh button or reload the page. Reports built at night (snapshots, MRP) update the next morning.
  - **नंबर पुराने लग रहे हैं।** ज़्यादातर फ़्लोर पेज कुछ सेकंड में खुद रिफ़्रेश होते हैं; रिफ़्रेश बटन दबाएँ या पेज रीलोड करें। रात में बनने वाली रिपोर्ट (snapshot, MRP) अगली सुबह अपडेट होती हैं।
- **Who can approve or post corrections?** A stock adjustment needs a second person with the adjust right to post it (maker–checker); owners and admins may post their own. A count sheet sent for approval in Count history (Submit → Approve) needs a different approver; an owner may approve their own. "Post physical count" and the evening packing count ("Post count") change stock at once, with no approval.
  - **सुधार कौन अप्रूव या पोस्ट कर सकता है?** स्टॉक एडजस्टमेंट को adjust अधिकार वाला कोई दूसरा व्यक्ति post करता है (maker–checker); मालिक और एडमिन अपना एडजस्टमेंट खुद post कर सकते हैं। Count history में approval के लिए भेजी count sheet (Submit → Approve) कोई दूसरा approve करता है; मालिक अपनी sheet खुद approve कर सकता है। "Post physical count" और शाम की packing गिनती ("Post count") स्टॉक तुरंत बदलते हैं, कोई approval नहीं।
