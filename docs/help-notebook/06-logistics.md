# Packing yard and dispatch bay

## Overview (English)
# Logistics: Packing Yard, evening count, Dispatch Bay

Logistics turns what the machines made into weighed dispatch units, loads them on vehicles with one slip per order line, and records proof of delivery. It also books packing material to orders through the evening count.

## Screens and how they connect

- **Packing Yard** (`/logistics/packing`): order cards with their ready lines. Tabs *Queue · ready to pack*, *In progress* (open and sealed gonnies) and *History* (released lines). Work arrives from machine terminals as pouch batches or rolls.
- **Pack window** (opened by *Pack selected* or a line's *Pack* / *Release* button): one tab per line, five steps, release.
- **Evening packing count** (`/logistics/packing/consumption`): end-of-day count of packing stock.
- **Packing audit** (`/logistics/packing/audit`): what packing each order used; views *Evening counts*, *Inner pouches · at packing*, *Ticks at release*.
- **Dispatch Bay** (`/logistics/dispatch`): tabs *Ready to dispatch* (board + loading tray), *This load* (slips just created) and *Challans & history*.
- **Logistics overview** (`/logistics`): read-only tiles, trend and latest challans.
- **Transit** (`/logistics/transit`): placeholder with fixed sample figures; not live.

Flow: machine output → Packing Yard (pack, weigh, seal, tick, release) → Dispatch Bay (load, create slips, print, mark dispatched) → gate records the departure → POD in Dispatch Bay → order can close. In the evening the packing count books the real use of packing material.

## Packing pouches (step by step)

1. Tick ready lines on one or more order cards (for example SO-2026-0123 L1 and L2 for ABC Foods) and press *Pack selected · N*.
2. Step 1 – confirm the machine figures and tick *Figures checked*. The machine's logged output is the product net.
3. Step 2 – the order decides how pouches arrive: *Inner packs* (packs of N pouches in an inner pouch) or *Loose pouches*. The yard cannot change it.
4. Step 3 – enter inner packs or pouches for this gonny (*Suggest split* evens them out), choose *Gonny type · tare*, put the gonny on the scale and type *Weighed gross kg*. *Add gonny · sealed* seals it at once; with no gross it is added open and must be weighed later. Expected gross = product net + inner pouches + gonny tare. More than 2 % off needs a variance reason.
5. Step 4 – tick every packing item used. No quantities.
6. Step 5 – *Release L1 · N gonnies* (or *Release all N lines*). Only sealed gonnies go; open gonnies stay until weighed. If pouches remain, the button says *short* and the rest stay in the batch.

## Releasing rolls

Tick the rolls (*Select all open*), choose *Packed roll · sheet / wrap* or *Release unpacked roll*. A packed roll needs at least one tick (the order's roll packing list comes pre-ticked). Rolls carry no packing weight; weights come from the roll label. Each roll is its own dispatch unit.

## The packing material rule

- **Inner pouches** are never in the tick list, and the Packing Yard never takes them off stock. In-house inner pouches come off stock at the machine's last pouching step when the output is logged. Bought inner pouches are marked by the machine and booked to the order by the evening count. If the order has no pieces per inner pouch, the pack window asks *Inner packs filled*: type the packs in each gonny and the evening count books them.
- **Every other active packing item** (gonny, sheet, putha, box, tape, label, tag, outer bag, other) is always in the tick list, on roll and pouch releases alike. A tick is a mark, not a quantity; many items can be ticked per release.
- The **evening count** takes these items (and bought inner pouches) off stock. Each row starts at the book quantity; rows left at the book figure do not change stock, and "Post count" posts at once with no approval. The counted use is shared over the order lines that ticked or marked the item that day, in whole pieces (one gonny goes to one line); if no one did, over that day's packed order lines whose packing plan includes the item. Only when there are none does the use stay on no order. An item counts once per unit even if marked twice on that unit.
- If an item is missing from the list, it is inactive or set as *Inner pouch* in Masters › Packaging (e.g. Putha must be *Sheet · putha · board*).

## Dispatch Bay (step by step)

1. On *Ready to dispatch*, tick a line to load all its ready units, or open *Units* for a part load.
2. In the *Loading tray* fill *Transporter* (required; quick choices *Own vehicle*, *Customer pickup*, *Courier*). Vehicle no., driver, phone, LR no., E-way bill and internal note are optional.
3. Check the *Delivery location* per order (order address or a dispatch-only override).
4. Press *Create N slips*: one slip per order line, never mixed; a line at two plants gets two slips; all or none are created.
5. On *This load* print (*Print N slips*, *A4 PDF*, QR sticker) and press *Mark dispatched · close*.
6. Later, in *Challans & history* → *Awaiting POD*, press *Confirm POD*.

The slip prints on the Epson FX-2175II, 10 × 6 in, 96 columns, NLQ. Vehicle, driver, LR and job name are saved but not printed on the slip.

## Goods of a closed line or order

When a line is short-closed, completed or cancelled (or the order is completed or cancelled) while goods made for it are still in the yard, they can either:
- **ship**: load them and tick *Send goods of closed lines*; the server refuses without it. POD never reopens a closed order; or
- **move to free stock**: *Move to stock* (Packing Yard or Dispatch Bay) with a reason of at least 3 characters. Rolls, sealed gonnies and unpacked batches leave the order; the planner can claim them for any order with the same specification. Units of an open line, units on a draft slip and dispatched units cannot move. A draft order never dispatches.

## Who does what

- **Dispatch**: packs, releases, loads, prints slips, marks dispatched, confirms POD.
- **Store / Plant manager**: evening count, audit, packing materials.
- **Production supervisor or manager**: accepts a batch held at the packing check.
- **Admin / Owner**: everything above, plus masters.
- **Planner**: claims goods moved to free stock.

## Problems and fixes

- *Line not in the queue*: no machine output yet, or already released (see History).
- *Release button grey*: no sealed gonny yet – weigh the open ones; or a roll release in *Packed* mode with nothing ticked.
- *Variance reason is required…*: the scale is more than 2 % from expected – re-weigh or write why.
- *Batch … is on hold at the packing check*: a supervisor accepts it with a reason in Details → Packing check.
- *Transporter name is required*: fill the transporter.
- *Closed lines on the tray…*: tick *Send goods of closed lines* or move the goods to stock.
- *Selected dispatch unit is already reserved or dispatched*: refresh; someone loaded it on another slip.
- *Count and ticks differ*: compare on Packing audit; the use is still shared by ticks.
- The Transit page is not live; use Dispatch Bay history.

## सारांश (हिंदी)
# लॉजिस्टिक्स: पैकिंग यार्ड, शाम की गिनती, डिस्पैच बे

लॉजिस्टिक्स मशीन के बने माल को तौली हुई डिस्पैच यूनिट में बदलता है, हर ऑर्डर लाइन की अलग स्लिप के साथ गाड़ी पर लोड करता है, और डिलीवरी का सबूत (POD) दर्ज करता है। शाम की गिनती से पैकिंग मटेरियल ऑर्डरों पर बुक होता है।

## स्क्रीन और उनका जुड़ाव

- **Packing Yard** (`/logistics/packing`): ऑर्डर कार्ड और उनकी तैयार लाइनें। टैब *Queue · ready to pack*, *In progress* (खुली और सील गोनी) और *History* (रिलीज़ लाइनें)। काम मशीन टर्मिनल से पाउच बैच या रोल के रूप में आता है।
- **पैक विंडो** (*Pack selected* या लाइन के *Pack* / *Release* बटन से): हर लाइन का अलग टैब, पाँच स्टेप, फिर रिलीज़।
- **Evening packing count** (`/logistics/packing/consumption`): दिन के अंत में पैकिंग स्टॉक की गिनती।
- **Packing audit** (`/logistics/packing/audit`): हर ऑर्डर में कितनी पैकिंग लगी; व्यू *Evening counts*, *Inner pouches · at packing*, *Ticks at release*।
- **Dispatch Bay** (`/logistics/dispatch`): टैब *Ready to dispatch* (बोर्ड + लोडिंग ट्रे), *This load* (अभी बनी स्लिप) और *Challans & history*।
- **Logistics overview** (`/logistics`): सिर्फ़ देखने के लिए टाइल, ट्रेंड और हाल के चालान।
- **Transit** (`/logistics/transit`): नमूना आँकड़ों वाला अस्थायी पेज; असली डेटा नहीं।

क्रम: मशीन आउटपुट → Packing Yard (पैक, तौल, सील, टिक, रिलीज़) → Dispatch Bay (लोड, स्लिप बनाना, प्रिंट, dispatched) → गेट पर रवानगी दर्ज → Dispatch Bay में POD → ऑर्डर बंद हो सकता है। शाम को पैकिंग गिनती असली खपत बुक करती है।

## पाउच पैक करना (कदम-दर-कदम)

1. एक या ज़्यादा ऑर्डर कार्ड पर तैयार लाइनें टिक करें (जैसे ABC Foods का SO-2026-0123 L1 और L2) और *Pack selected · N* दबाएँ।
2. स्टेप 1 – मशीन के आँकड़े देखें और *Figures checked* टिक करें। मशीन में दर्ज आउटपुट ही प्रोडक्ट नेट है।
3. स्टेप 2 – पाउच कैसे आएँगे ये ऑर्डर तय करता है: *Inner packs* (inner pouch में N पाउच का पैक) या *Loose pouches*। यार्ड इसे बदल नहीं सकता।
4. स्टेप 3 – इस गोनी के inner packs या पाउच लिखें (*Suggest split* बराबर बाँटता है), *Gonny type · tare* चुनें, गोनी तराज़ू पर रखें और *Weighed gross kg* लिखें। *Add gonny · sealed* तुरंत सील करता है; ग्रॉस न लिखें तो गोनी खुली जुड़ती है और बाद में तौलनी होती है। Expected gross = प्रोडक्ट नेट + inner pouches + गोनी का वज़न। 2 % से ज़्यादा फ़र्क पर कारण लिखना ज़रूरी है।
5. स्टेप 4 – इस्तेमाल हुआ हर पैकिंग आइटम टिक करें। मात्रा नहीं लिखनी।
6. स्टेप 5 – *Release L1 · N gonnies* (या *Release all N lines*)। सिर्फ़ सील गोनी जाती हैं; खुली गोनी तौलने तक रुकती हैं। पाउच बचें तो बटन पर *short* आता है और बाकी बैच में रहते हैं।

## रोल रिलीज़ करना

रोल टिक करें (*Select all open*), *Packed roll · sheet / wrap* या *Release unpacked roll* चुनें। Packed roll में कम से कम एक टिक चाहिए (ऑर्डर की रोल पैकिंग लिस्ट पहले से टिक आती है)। रोल पर पैकिंग का वज़न नहीं जुड़ता; वज़न रोल लेबल से आता है। हर रोल अलग डिस्पैच यूनिट है।

## पैकिंग मटेरियल का नियम

- **Inner pouch** टिक लिस्ट में कभी नहीं आता, और Packing Yard इसे स्टॉक से नहीं घटाता। घर में बने (in-house) inner pouch मशीन के आखिरी pouching स्टेप पर आउटपुट दर्ज होते ही स्टॉक से घटते हैं। खरीदे हुए inner pouch पर मशीन निशान लगाती है और शाम की गिनती उन्हें ऑर्डर पर बुक करती है। ऑर्डर में pieces per inner pouch न हो तो पैक विंडो *Inner packs filled* पूछती है: हर गोनी के पैक लिखें, शाम की गिनती उन्हें बुक करती है।
- **बाकी हर active पैकिंग आइटम** (गोनी, शीट, पुठा, बॉक्स, टेप, लेबल, टैग, बाहरी बैग, अन्य) रोल और पाउच दोनों रिलीज़ पर हमेशा टिक लिस्ट में आता है। टिक सिर्फ़ निशान है, मात्रा नहीं; एक रिलीज़ पर कई आइटम टिक हो सकते हैं।
- **शाम की गिनती** इन आइटम (और खरीदे हुए inner pouch) को स्टॉक से घटाती है। हर लाइन में पहले से book मात्रा भरी आती है; book पर छोड़ी लाइनों से स्टॉक नहीं बदलता, और "Post count" बिना approval तुरंत post होता है। गिनी गई खपत उस दिन जिन ऑर्डर लाइनों ने आइटम टिक किया (या जिन पर निशान लगा) उनमें पूरे पीस में बँटती है (एक गोनी एक ही लाइन पर); किसी ने टिक न किया हो तो उस दिन पैक हुई उन ऑर्डर लाइनों में जिनके packing plan में वह आइटम है। ऐसी लाइन भी न हो तभी खपत किसी ऑर्डर पर नहीं जाती। एक यूनिट पर दो बार निशान हो तो भी एक बार गिना जाता है।
- कोई आइटम लिस्ट में न दिखे तो वो Masters › Packaging में inactive है या *Inner pouch* सेट है (जैसे Putha को *Sheet · putha · board* करना है)।

## डिस्पैच बे (कदम-दर-कदम)

1. *Ready to dispatch* में लाइन टिक करें तो उसकी सारी तैयार यूनिट लोड होंगी; आधा लोड हो तो *Units* खोलें।
2. *Loading tray* में *Transporter* भरें (ज़रूरी; जल्दी के विकल्प *Own vehicle*, *Customer pickup*, *Courier*)। गाड़ी नंबर, ड्राइवर, फ़ोन, LR no., E-way bill और अंदरूनी नोट वैकल्पिक हैं।
3. हर ऑर्डर की *Delivery location* देखें (ऑर्डर का पता या सिर्फ़ इस डिस्पैच के लिए बदला पता)।
4. *Create N slips* दबाएँ: हर ऑर्डर लाइन की एक स्लिप, कभी मिलाकर नहीं; दो प्लांट पर पड़ी लाइन की दो स्लिप; या तो सब बनती हैं या एक भी नहीं।
5. *This load* पर प्रिंट करें (*Print N slips*, *A4 PDF*, QR स्टिकर) और *Mark dispatched · close* दबाएँ।
6. बाद में *Challans & history* → *Awaiting POD* में *Confirm POD* दबाएँ।

स्लिप Epson FX-2175II पर 10 × 6 इंच, 96 कॉलम, NLQ में छपती है। गाड़ी, ड्राइवर, LR और job name सेव होते हैं पर स्लिप पर नहीं छपते।

## बंद लाइन या ऑर्डर का माल

जब कोई लाइन short-close, complete या cancel हो (या पूरा ऑर्डर complete/cancel) और उसका बना माल यार्ड में हो, तो वो:
- **भेजा जा सकता है**: लोड करें और *Send goods of closed lines* टिक करें; बिना टिक सर्वर मना करता है। POD से बंद ऑर्डर दोबारा नहीं खुलता; या
- **फ़्री स्टॉक में जा सकता है**: *Move to stock* (Packing Yard या Dispatch Bay) कम से कम 3 अक्षर के कारण के साथ। रोल, सील गोनी और बिना पैक बैच ऑर्डर से हट जाते हैं; प्लानर उन्हें उसी स्पेसिफ़िकेशन वाले किसी ऑर्डर पर ले सकता है। खुली लाइन की यूनिट, ड्राफ्ट स्लिप पर पड़ी यूनिट और भेजी जा चुकी यूनिट नहीं हटतीं। ड्राफ्ट ऑर्डर कभी डिस्पैच नहीं होता।

## कौन क्या करता है

- **Dispatch**: पैक, रिलीज़, लोड, स्लिप प्रिंट, dispatched, POD।
- **Store / Plant manager**: शाम की गिनती, ऑडिट, पैकिंग मटेरियल।
- **प्रोडक्शन सुपरवाइज़र या मैनेजर**: पैकिंग चेक पर रुके बैच को स्वीकार करता है।
- **Admin / Owner**: ऊपर का सब, और मास्टर।
- **Planner**: फ़्री स्टॉक में गया माल लेता है।

## समस्याएँ और हल

- *लाइन कतार में नहीं*: मशीन आउटपुट अभी नहीं, या पहले ही रिलीज़ (History देखें)।
- *रिलीज़ बटन ग्रे*: अभी कोई सील गोनी नहीं – खुली गोनी तौलें; या *Packed* रोल रिलीज़ में कुछ टिक नहीं।
- *Variance reason is required…*: तराज़ू expected से 2 % से ज़्यादा अलग – दोबारा तौलें या कारण लिखें।
- *Batch … is on hold at the packing check*: सुपरवाइज़र Details → Packing check में कारण देकर स्वीकार करे।
- *Transporter name is required*: ट्रांसपोर्टर भरें।
- *Closed lines on the tray…*: *Send goods of closed lines* टिक करें या माल स्टॉक में भेजें।
- *Selected dispatch unit is already reserved or dispatched*: रिफ़्रेश करें; किसी और ने दूसरी स्लिप पर ले लिया।
- *गिनती और टिक अलग*: Packing audit पर मिलाएँ; खपत फिर भी टिक के हिसाब से बँटती है।
- Transit पेज असली नहीं है; Dispatch Bay history देखें।

## Every screen (English)

### Total Logistics Hub (/dashboard/logistics)
Screen address: /dashboard/logistics · Roles: ADMIN, OWNER, SUPER_ADMIN, DISPATCH · Share link: https://erp.totalpolyprint.com/guide?page=dashboard-logistics

Dispatch staff's landing page: counts of draft challans, orders with finished goods, vehicles in transit and trucks shipped today, plus the latest slips.

Open it at the start of a shift to see the dispatch load, then press "Open Dispatch Bay" to build loads, print slips and mark dispatch. Counts come from the same paged slip history as Dispatch Bay.

**Before you start**
- Lines released from the Packing Yard; slips created in Dispatch Bay.

**Step by step**
1. Read the four tiles: "Pending Challans" (drafts), "Dispatch Ready" (orders with FG), "Vehicles Loading/Transit" and "Shipped Today".
2. Check "Challan Flow Distribution" for slips by state.
3. Scan "Latest Validated DCs" in the Execution Ledger.
4. Press "Open Dispatch Bay" to load, print and dispatch.

**What is on the screen**
- **Pending Challans**: Draft slips not yet dispatched.
- **Dispatch Ready**: Sales orders that have finished goods waiting.
- **Vehicles Loading/Transit**: Slips dispatched and not yet delivered.
- **Shipped Today**: Slips dispatched today.

**Common problems and fixes**
- "Logistics data feed is unavailable. Dispatch KPIs are paused instead of showing fallback zeros." — The slip history or orders feed did not load. Press "Retry". Tiles show "Unavailable" until it loads.
- "Challan flow is unavailable until the logistics API syncs again." — Same cause; retry, or work directly in Dispatch Bay.

**If stuck**
1. If counts look wrong, open Dispatch Bay "Challans & history" which shows the exact slips.

Related pages: /logistics/dispatch, /logistics/packing, /logistics/transit

**Not done yet / watch out**
- The Logistics hub has no sidebar entry of its own; the Dispatch Bay tab is highlighted when it is open.

### Dispatch, packing, and transit control (/logistics)
Screen address: /logistics · Roles: ADMIN, OWNER, SUPER_ADMIN, DISPATCH · Share link: https://erp.totalpolyprint.com/guide?page=logistics

A read-only overview of dispatch: draft and dispatched challans, inter-plant challans on the road, dispatch weight trend, top customers and the latest challans.

Open it at the start or end of a shift to see how much went out and what is still waiting. Nothing is changed here; for real work press "Open Dispatch Bay". Figures come from the dispatch report and the inter-plant report.

**Before you start**
- Your role must have the Logistics area (Admin, Owner, Dispatch or an inventory permission).
- Challans exist only after slips are created in Dispatch Bay.

**Step by step**
1. Read the four tiles: "Draft challans", "In transit", "Dispatched challans", "Dispatch weight".
2. Check "Dispatch weight trend" for the daily kg shipped.
3. Check "Top dispatch customers" to see who took the most weight.
4. Scan "Latest challans" (number, customer, status, vehicle) and "Inter-plant live lanes" (from → to plant, kg).
5. Press "Open Dispatch Bay" to load and send goods, or "Open Transit Board" for the transit page.

**What is on the screen**
- **Draft challans**: Slips created but not yet marked dispatched.
- **In transit**: Inter-plant challans still on the road (not yet received at the other plant).
- **Dispatched challans**: Customer challans already marked dispatched.
- **Dispatch weight**: Total kg shipped in the report window.
- **Inter-plant live lanes**: Up to five inter-plant challans with from/to plant, status and dispatched kg.

**Common problems and fixes**
- "Logistics could not load (retry box)" — The dispatch or inter-plant report failed. Press retry; if it repeats, check the connection or tell the admin.
- "No challans found for the selected window." — No slip was created in the report period. Slips appear after Create in Dispatch Bay.

**If stuck**
1. Reload the page if tiles show "..." for long.
2. For any action (print, dispatch, POD) go to Dispatch Bay; this page has no buttons that change data.

Related pages: /logistics/dispatch, /logistics/transit, /logistics/packing, /analytics/reports/dispatch

**Not done yet / watch out**
- "Open Transit Board" leads to the placeholder Transit page, not a live board.

### Dispatch Bay (/logistics/dispatch)
Screen address: /logistics/dispatch · Roles: ADMIN, OWNER, SUPER_ADMIN, DISPATCH · Share link: https://erp.totalpolyprint.com/guide?page=logistics-dispatch

Load released rolls and gonnies onto a vehicle, create one dispatch slip per order line, print it on the Epson 10 × 6 in form, mark it dispatched and later confirm proof of delivery (POD).

Use it when Packing Yard has released units. Only released units appear here. Three tabs: "Ready to dispatch" (board and loading tray), "This load" (slips just created) and "Challans & history". After POD the order can close.

**Before you start**
- Units must be released from Packing Yard (sealed gonnies or released rolls).
- The sales order must not be a draft; a cancelled or completed order or closed line needs the closed-lines tick.
- A delivery address on the order, or a dispatch-only location typed in the tray.
- For Epson printing on a Windows PC, install "Epson setup" once.

**Step by step**
1. On "Ready to dispatch", find the order (search, "Unit type", "Queue status", customer, sort or "Jump to order…").
2. Tick a line to load all its ready units, or open "Units" and tick single rolls/gonnies for a part load.
3. In "Loading tray" fill "Transporter" (required; or tap "Own vehicle", "Customer pickup", "Courier"). "Vehicle no.", driver, LR no., E-way bill and note are optional.
4. Check "Delivery location" for each order; if a closed line is on the tray tick "Send goods of closed lines".
5. Press "Create N slips". All slips of the tray are created together or none.
6. On "This load" check the slip text and press "Print N slips" (or "Print this slip", "A4 PDF", QR sticker).
7. When the vehicle leaves press "Mark dispatched · close".
8. Later, in "Challans & history" → "Awaiting POD", press "Confirm POD", add receiver / reference / notes and confirm.

**What is on the screen**
- **Units ready**: Released gonnies and rolls waiting in the bay.
- **Weight ready**: Gross kg of ready units, with net product kg below.
- **Orders ready**: Orders with ready units, customers count and how many are still in packing.
- **Vehicles today / Slips today**: Vehicles and slips of today; slips split into dispatched and draft.
- **Awaiting POD**: Dispatched challans without proof of delivery. Opens the history tab.
- **Line balance (ordered / dispatched / on this load / remaining)**: Per line; a closed line shows "Order completed" or "Line short-closed" with ordered, closed, made and waiting quantities.
- **Transporter ***: Required. Printed as TRANSPORT NAME on every slip.
- **Vehicle no.**: Optional. Saved on the challan; not printed on the slip today.
- **Delivery location ***: Taken from the order address; you can override it for these slips only.
- **Internal note**: Not printed on the slip.
- **Packing slip / A4 PDF (Units)**: Per-unit manifest of selected or visible units, on Epson or as A4 PDF.
- **History status tabs**: "Drafts", "Awaiting POD", "Delivered", "Cancelled"; date Today / 7 days / All; customer; search by challan, customer, SO, job or vehicle.

**Common problems and fixes**
- "Transporter name is required (printed as TRANSPORT NAME)." — The Transporter box is empty. Type it or tap a quick choice.
- "Delivery location missing for SO-…: enter where it goes." — The order has no shipping address. Type a dispatch-only location in the tray.
- "Closed lines on the tray: SO-… L2. Confirm shipping the goods already made for them, or move them to stock." — A closed line is loaded without the tick. Tick "Send goods of closed lines", or take the line off and use "Move to stock".
- "Sales Order SO-… is DRAFT; a challan cannot be created in this order state." — A draft order never dispatches. Ask sales to place the order.
- "Gonny … is not released from Packing Yard. / Roll … is not released to Dispatch Bay yet." — The unit was not released. Release it in Packing Yard first.
- "Batch … is on hold at the packing check … A supervisor must accept it with a reason before dispatch." — The packing check found a difference. A supervisor accepts it in Packing Yard → Details → Packing check.
- "Selected dispatch unit is already reserved or dispatched: …" — Someone else loaded it on another slip. Press Refresh and load again.
- "POD can only be confirmed for a dispatched challan, not DRAFT" — Mark the slip dispatched first, then confirm POD.
- "Epson print failed" — The print job could not be prepared or the PC has no Epson helper. Install "Epson setup" or use "A4 PDF".

**If stuck**
1. Press Refresh (top) if a unit you expect is missing; it auto-refreshes every 30 s.
2. If "No orders to ship", the units are still in Packing Yard: release them there.
3. To send goods of a closed line to free stock instead, press "Move to stock" on that line.
4. A draft slip from earlier is in "Challans & history" → "Drafts"; press "Dispatch" there (a closed line asks "Line closed · send the goods anyway?").
5. From an order page, the link /logistics/dispatch?history=SO-… opens that order's slips.

Related pages: /logistics/packing, /logistics, /sales/orders, /gate/outward

**Not done yet / watch out**
- Vehicle, driver, LR number and job name are saved on the challan but not printed on the Epson slip.
- A draft slip cannot be cancelled from Dispatch Bay, and there is no per-slip print log.
- "Mark dispatched anyway" lets a load be dispatched before all its slips are printed.

### Packing Yard (/logistics/packing)
Screen address: /logistics/packing · Roles: ADMIN, OWNER, SUPER_ADMIN, DISPATCH, STORE, PLANT_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=logistics-packing

Turn produced pouch batches and rolls into weighed dispatch units: pack pouches into gonnies, weigh and seal them, tick the packing items used, and release each line to Dispatch Bay as its own slip.

Open it when machines have logged output for an order. Work comes from the machine terminals (batches and rolls); released units go to Dispatch Bay. Tabs: "Queue · ready to pack", "In progress" (open and sealed gonnies) and "History" (released lines).

**Before you start**
- Machine output logged against an order line (batch for pouches, roll for rolls).
- Gonny packaging masters with their weight in Masters › Packaging; other packing items active there.
- The order's packing plan (inner packs or loose pouches, pouches per pack, inner pouch, gonny).

**Step by step**
1. In "Queue · ready to pack" use "Packing route" (All / Pouch / Roll / Release), search, customer, sort or "Jump to order…".
2. Tick the ready lines (one or many orders; "All N ready lines" ticks an order), then press "Pack selected · N". Or press "Pack" / "Release" / "Pack & release" on one line.
3. Pouch line, step 1: check the machine figures and tick "Figures checked". Step 2 shows how pouches arrive (the order's choice: "Inner packs" or "Loose pouches").
4. Step 3: enter inner packs or pouches in this gonny ("Suggest split" helps), pick "Gonny type · tare", put it on the scale and type "Weighed gross kg". Press "Add gonny · sealed" (or leave gross empty for "Add gonny · open" and weigh it later in the list).
5. If the scale differs from expected by more than 2 %, write a variance reason.
6. Step 4: tick every packing item used (gonny, sheet, putha, box, tape, label, tag, outer bag…). No quantities; inner pouches are not listed.
7. Step 5: press "Release L1 · N gonnies" ("· short" if pouches stay for later). With several tabs ready press "Release all N lines".
8. Roll line: tick the rolls ("Select all open"), choose "Packed roll · sheet / wrap" or "Release unpacked roll", tick the items used, then release.
9. Check "History" (Today / 7 days / All) for who released what, every gonny with weights, the items ticked and the slip.

**What is on the screen**
- **Lines ready to pack**: Lines with batches or rolls waiting; sub-line shows batches, rolls and pcs.
- **Weight ready**: Net kg still to pack: pouches and rolls.
- **Packed today**: Gonnies packed since midnight, plus rolls released.
- **Open / sealed**: Open gonnies to weigh and sealed gonnies to release. Opens "In progress".
- **Released today**: Units released to Dispatch Bay today with net and gross kg. Opens History.
- **Variance alerts**: Held packing checks plus gonnies more than ±2 % off the expected gross.
- **Expected gross**: Product net (machine log) + inner pouches + gonny tare.
- **Line row (L1…)**: Size, layers, pcs or kg, g per pouch, inner packs or loose, machine, ready since, location.
- **Ready slip**: Prints the material ready slip; enabled once the order has released units.
- **Details**: Tabs "Units & batches", "Packing check", "Order & links".
- **Closed line notice + Move to stock**: Goods of a short-closed, completed or cancelled line: release them to ship, or "Move to stock" with a reason.
- **Inner packs filled**: Shown when the order has no pieces per inner pouch: type how many inner packs went into this gonny. They are booked to the order by the evening count.

**Common problems and fixes**
- "Variance reason is required when actual gonny gross weight differs from expected by more than 2%." — The scale weight is more than 2 % off. Re-weigh, or write why (extra packing, wrong count…).
- "Insufficient quantity: requested X, available Y" — More pouches typed than are left in the batch. Lower the count.
- "Gonny … must be SEALED before release to dispatch." — Open gonnies cannot be released. Weigh it in the list to seal it.
- "Batch … is on hold at the packing check …" — The packing check is outside limits. A production supervisor or manager presses "Accept with reason" in Details → Packing check.
- "Roll … has no packaging lines. Select at least one packing master or release unpacked." — "Packed roll" needs at least one tick. Tick the items used, or choose "Release unpacked roll".
- "Bulk roll packing requires rolls in the same FG store. Split the action by location." — Rolls ticked together sit in different stores. Release them in two goes.
- "No gonny packaging masters exist yet. Add one in Masters › Packaging." — No gonny master, or the gonny has no weight. Ask the master-data person to add it.
- "N lines released, then stopped" — "Release all" stopped at a line with an error; earlier lines are already released. Fix that line and release it again.

**If stuck**
1. Press Refresh if a line looks stale; the board refreshes every 30 s.
2. A gonny added open waits in "In progress": press "Weigh", enter the gross and seal.
3. If a tick is missing from the list (e.g. Putha), the item is inactive or set as Inner pouch in Masters › Packaging; ask to fix its kind.
4. Goods of a closed line: release them to ship, or press "Move to stock" with a reason.
5. Use "Audit this order" in the card footer to see the packing material booked to the order.

Related pages: /logistics/dispatch, /logistics/packing/audit, /logistics/packing/consumption, /dashboard/planner/control-tower/completed-trace, /dashboard/planner/control-tower/plan-queue, /master/packaging

**Not done yet / watch out**
- The yard cannot switch a line between inner packs and loose pouches; the order's choice is used.
- A pouch line can be released with no packing item ticked, while a packed roll release refuses without at least one tick.
- The 25 Oct note said gonny is not ticked on pouch releases; since 27 Oct every active non-inner-pouch item, gonny included, is always in the tick list.
- The "Variance alerts" tile opens the In progress tab but does not filter to the units that are off.

### Packing audit (/logistics/packing/audit)
Screen address: /logistics/packing/audit · Roles: ADMIN, OWNER, SUPER_ADMIN, DISPATCH, STORE, PLANT_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=logistics-packing-audit

Shows what packing material each order used: in-house inner pouches taken at the machine when output was logged (view "Inner pouches · at packing"), items ticked at release, and how each evening count shared the real use over order lines.

Open it to check packing cost per order, to find ticks still waiting for a count, or when a count does not match the ticks. Opened from Packing Yard ("Audit" or "Audit this order").

**Before you start**
- Releases with ticks in Packing Yard and at least one posted evening count for the count view.

**Step by step**
1. Pick the view: "Evening counts", "Inner pouches · at packing" or "Ticks at release".
2. Set the dates, customer, packing material, or type an order number (e.g. SO-2026-0123).
3. In "Evening counts" read each material: book → counted → used, the ticks, and the share each order line took.
4. Look for the warning "The yard ticked N but the count says … used" and check the count or the ticks.
5. Use "Waiting for a count" to see ticks made after the last count.
6. Press "Export CSV" to download the current view.

**What is on the screen**
- **Evening counts**: Number of counts in the date range.
- **Booked by counts**: Rows booked to orders by counts, with order count.
- **Inner pouches at packing**: In-house inner pouches taken off stock at the machine's last pouching step when output was logged. Bought inner pouches are not here; the evening counts take them.
- **Ticks at release**: Marks only; no stock effect until the count.
- **Waiting for a count**: Ticked after the last count.
- **Tick mismatches**: Materials where ticks differ from what was counted used.
- **Book / Counted / Used**: System stock before the count, physical count, and the difference used.
- **Not on any order**: Use counted when no order line that day ticked or marked the item and no order packed that day has it in its packing plan.
- **Found … more than the book**: Count was above the book; the extra was added back to stock.
- **Weight summary**: "Our product", "Dispatch weight (gross)", "Packing in the dispatch weight", "In-house inner pouches taken".

**Common problems and fixes**
- "No evening counts in this range" — No count was posted in these dates. Widen the dates or post the count on Evening count.
- "The yard ticked N but the count says … used." — Ticks and count disagree; the use was still shared by ticks. Re-check the physical count or ask the yard about missing ticks.
- "No ticks in this range" — Nothing was ticked at release in these dates.

**If stuck**
1. Clear the order number and customer filters if the list is empty.
2. The customer filter applies to the lists, not to the count cards.
3. Shares before 26 Oct 2026 can be fractional; later counts share pieces in whole pieces.

Related pages: /logistics/packing, /logistics/packing/consumption, /master/packaging

**Not done yet / watch out**
- The customer filter applies to the lists only, not to the evening count cards.
- When ticks and the count disagree the use is still shared by ticks; the page warns but offers no way to fix the split.

### Evening packing count (/logistics/packing/consumption)
Screen address: /logistics/packing/consumption · Roles: ADMIN, OWNER, SUPER_ADMIN, DISPATCH, STORE, PLANT_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=logistics-packing-consumption

End-of-day physical count of packing stock at a location. Each row starts at the book quantity; the difference you enter comes off stock at once (no approval) and is booked to the order lines that ticked or marked each item that day, or else to that day's orders whose packing plan includes it.

Do it every evening after the last release. Gonny, sheet, putha, box, tape, label, tag, outer bag and other items are only ticked at release, and bought inner pouches are only marked at the machine; this count is what takes them off stock, so count bought inner pouches too. The same count is on Stock Lifecycle → count (PACKING).

**Before you start**
- Packing masters active in Masters › Packaging and stock at the count location.
- The day's releases done with ticks in Packing Yard.

**Step by step**
1. Pick the count location ("Pick count location"); a packing or FG location is chosen by default.
2. Check the count date and time; change it if you count late. Press "Refresh".
3. Every row starts filled with the book quantity. Type the counted closing quantity only where it differs; rows left at the book figure do not change stock ("Copy book qty" puts the book figures back).
4. Check the "Delta" column: negative = used, positive = found extra.
5. See "Same-day allocation pool" for the orders that will share the use.
6. Add a note if needed and press "Post count". It changes stock at once; there is no approval step.

**What is on the screen**
- **Packing SKUs**: All active packaging masters at the location.
- **Book stock**: Current system balance.
- **Same-day orders**: Order lines eligible to share today's use.
- **Entered delta**: Sum of differences typed (positive excess / negative consume).
- **Closing qty**: What you physically counted, in the material's unit. It starts at the book quantity.
- **Note**: Shift note, missing bundle, count correction…

**Common problems and fixes**
- "Count failed" — The server refused the count (for example "… is not a packaging material."). Read the message, fix the row and post again.
- ""Post count" stays disabled" — There are no packing items to count at this location (no active packing masters in Masters › Packaging and no packing stock there). It is also off while the list loads, after every count box is cleared, or while a post is running. Normally rows start filled with the book quantity, so the button is on.
- "No packing throughput on this date." — Nothing was packed at this location by this time. Use counted here still goes to orders packed elsewhere in the plant that day that ticked the item or have it in their packing plan; only if there are none is it left on no order.

**If stuck**
1. Count at the same location where the yard keeps packing stock.
2. If a share looks wrong, open Packing audit → Evening counts and compare ticks with the count.
3. Each item counts once per unit even if it was ticked twice on that unit.

Related pages: /logistics/packing, /logistics/packing/audit, /inventory/stock-lifecycle

**Not done yet / watch out**
- Counts booked before 26 Oct 2026 keep fractional shares; only later counts share whole pieces.
- Inner pouches of a batch logged after that day's evening count was posted (e.g. night shift before midnight) are not marked in any count; their use is shared by packing plan on the next count or shows as not on any order.

### Transit Tracking (/logistics/transit)
Screen address: /logistics/transit · Roles: ADMIN, OWNER, SUPER_ADMIN, DISPATCH · Share link: https://erp.totalpolyprint.com/guide?page=logistics-transit

A placeholder transit screen. The tiles and the "Outbound lane board" show fixed sample figures, not live shipments; there is no GPS.

Do not use it for decisions. For real shipment status use Dispatch Bay ("Challans & history") or the Dispatch report; inter-plant challans on the road show on the Logistics overview.

**Before you start**
- None.

**Step by step**
1. Read the note "Telemetry rollout note": dispatch challans remain the source of truth.
2. Press "Open Dispatch Bay" for slips, dispatch and POD.
3. Press "Open Dispatch Report" for dispatch figures by date and customer.

**What is on the screen**
- **In active transit / Destinations live / Average transit time / Delivered today**: Fixed sample numbers; they do not change with real data.
- **Outbound lane board**: Three sample lanes (made-up customers); not your shipments.

**Common problems and fixes**
- "Figures never change" — The page is not connected to live data yet. Use Dispatch Bay history or the Dispatch report.

**If stuck**
1. For a vehicle's status, search the challan in Dispatch Bay → "Challans & history".

Related pages: /logistics/dispatch, /analytics/reports/dispatch, /logistics

**Not done yet / watch out**
- The Transit page shows fixed sample figures and three made-up lanes; it is not connected to any shipment data.

### Customer dispatches (/sales/orders/[id]/dispatches)
Screen address: /sales/orders/[id]/dispatches · Roles: SALES, OWNER, ADMIN, SUPER_ADMIN, DISPATCH · Share link: https://erp.totalpolyprint.com/guide?page=sales-orders-id-dispatches

The list of customer dispatch records raised against one sales order, with confirm, cancel, QR sticker and line details.

Use it to see what has been shipped on this order and to confirm draft dispatches. Each confirmed dispatch uses up open qty on the order lines; when every line is fully dispatched the order turns COMPLETED. Day-to-day slips are made in Dispatch Bay; an order shipped on Dispatch Bay slips completes only when proof of delivery (POD) is confirmed for every line.

**Before you start**
- Lines must be packing-ready or dispatch-ready (released from the Packing Yard).

**Step by step**
1. Check the tiles "Total dispatches", "Confirmed / shipped", "Drafts in progress".
2. In "Dispatch ledger" press "Details" on a row to see plant, driver, invoice and each order line with quantity.
3. For a DRAFT row press "Confirm" to book it, or "Cancel" to drop it.
4. Print the gate QR sticker with the QR button (stick it on the Tally bill or slip; the gate scans it).
5. Press "New dispatch" to raise another one.

**What is on the screen**
- **Status**: DRAFT (saved, not booked), CONFIRMED (qty booked against lines), DISPATCHED, CANCELLED.
- **Dispatch date · lines · Vehicle · LR**: Header facts typed when the dispatch was made.
- **Order line / Quantity / Notes**: Inside "Details": how much of each line went in this dispatch.

**Common problems and fixes**
- "Cannot confirm a dispatch in status …" — Only DRAFT can be confirmed.
- "Line exceeds dispatchable qty: requested X, dispatchable Y." — Another dispatch already used the qty. Cancel this draft and make a new one with the smaller qty.
- "Line is not ready for dispatch / Line has no completed final output ready to dispatch" — Goods are not released from the yard yet, or a partial line has no finished output. Resolve in Planner / Packing Yard first.
- "Cannot cancel a dispatch in status DISPATCHED" — A dispatched record cannot be cancelled.

**If stuck**
1. Empty ledger ("No dispatches yet."): slips made in Dispatch Bay are listed there, not always here; open Dispatch Bay history for this SO.
2. Press "Back to order" to return to the tracker.

Related pages: /sales/orders/[id], /sales/orders/[id]/dispatches/new, /logistics/dispatch

**Not done yet / watch out**
- The ledger shows Cancel only for DRAFT dispatches, although the server also allows cancelling a CONFIRMED dispatch, and there is no "mark dispatched" button even though the server supports it.
- Customer dispatch records here are separate from Dispatch Bay slips; slips made in Dispatch Bay may not appear in this ledger, which can confuse users looking for what was shipped.

### New dispatch (/sales/orders/[id]/dispatches/new)
Screen address: /sales/orders/[id]/dispatches/new · Roles: SALES, OWNER, ADMIN, SUPER_ADMIN, DISPATCH · Share link: https://erp.totalpolyprint.com/guide?page=sales-orders-id-dispatches-new

Form to raise a customer dispatch record for one sales order: header (date, vehicle, driver, LR, invoice, notes) and quantity per line.

Use it when goods of this order leave and you need a dispatch record against the order lines. Each row pre-fills only the qty dispatchable now; for partial final output the unproduced balance stays with the Planner.

**Before you start**
- At least one line packing-ready / dispatch-ready, or a partial line with finished output.

**Step by step**
1. Check "Dispatch date" (today by default).
2. Fill "Vehicle no", "Driver", "LR no", "Customer invoice" and "Notes" (optional but recommended).
3. In "Lines", check "Dispatch now" for each line; lower it for a part load. Lines not ready are locked.
4. Watch "Total qty" at the top.
5. Press "Save draft" to keep it as DRAFT, or "Save & confirm" to book it now.

**What is on the screen**
- **Ordered / Already shipped / Open**: Line qty, qty already dispatched, and what is left.
- **Dispatchable**: What may go now (finished and released). Dispatch now cannot be more.
- **Final output: dispatch X now · planner replan Y**: Partial line: X can ship, Y stays for the planner to re-release or short-close.
- **UoM**: Line unit, KG or PCS.

**Common problems and fixes**
- "Enter qty against at least one line." — All "Dispatch now" boxes are zero. Enter qty on a ready line.
- "… is not ready for dispatch. Resolve it in Planner first." — The line is not released from packing. Release it in the Packing Yard first.
- "… exceeds dispatchable quantity N." — Lower the qty to the dispatchable figure.
- "… has no completed final output ready to dispatch. Re-release or short-close it in Planner." — Partial line with nothing finished; the planner must act.
- "Dispatch quantity must be greater than zero." — Remove the zero or negative qty.

**If stuck**
1. All inputs locked: no line is ready yet; check the order tracker's spine (Yard station).
2. Draft saved by mistake: open the ledger and press "Cancel" on it.

Related pages: /sales/orders/[id]/dispatches, /sales/orders/[id], /logistics/dispatch, /logistics/packing

**Not done yet / watch out**
- This form does not offer the "Send goods of closed lines" confirmation or the closed-line handling that Dispatch Bay has.

## हर स्क्रीन (हिंदी)

### Total Logistics Hub (/dashboard/logistics)
स्क्रीन का पता: /dashboard/logistics · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, DISPATCH · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=dashboard-logistics&lang=hi

Dispatch staff का पहला पेज: draft challan, finished goods वाले order, रास्ते में गाड़ियाँ और आज भेजे truck की गिनती, साथ में ताज़ा slip।

shift की शुरुआत में dispatch का काम देखने के लिए खोलें, फिर load बनाने, slip छापने और dispatch mark करने के लिए "Open Dispatch Bay" दबाएँ। गिनती उसी slip history से आती है जो Dispatch Bay में है।

**शुरू करने से पहले**
- Packing Yard से line release हुई हों; Dispatch Bay में slip बनी हों।

**स्टेप बाय स्टेप**
1. चार tile पढ़ें: "Pending Challans" (draft), "Dispatch Ready" (FG वाले order), "Vehicles Loading/Transit" और "Shipped Today"।
2. "Challan Flow Distribution" में state के हिसाब से slip देखें।
3. Execution Ledger में "Latest Validated DCs" देखें।
4. load, print और dispatch के लिए "Open Dispatch Bay" दबाएँ।

**स्क्रीन पर क्या है**
- **Pending Challans**: draft slip जो अभी dispatch नहीं हुईं।
- **Dispatch Ready**: वे sales order जिनका finished goods तैयार है।
- **Vehicles Loading/Transit**: dispatch हुई slip जिनकी delivery अभी बाकी है।
- **Shipped Today**: आज dispatch हुई slip।

**आम दिक्कतें और हल**
- "Logistics data feed is unavailable. Dispatch KPIs are paused instead of showing fallback zeros." — slip history या order feed load नहीं हुई। "Retry" दबाएँ। तब तक tile "Unavailable" दिखाते हैं।
- "Challan flow is unavailable until the logistics API syncs again." — कारण वही; retry करें या सीधे Dispatch Bay में काम करें।

**अटक गए तो**
1. गिनती गलत लगे तो Dispatch Bay का "Challans & history" खोलें, वहाँ हर slip दिखती है।

जुड़े पेज: /logistics/dispatch, /logistics/packing, /logistics/transit

**अभी नहीं होता / ध्यान दें**
- Logistics hub का sidebar में अपना entry नहीं; खुलने पर Dispatch Bay tab चमकता है।

### डिस्पैच, पैकिंग और ट्रांज़िट कंट्रोल (/logistics)
स्क्रीन का पता: /logistics · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, DISPATCH · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=logistics&lang=hi

डिस्पैच का केवल देखने वाला सार: ड्राफ्ट और भेजे गए चालान, रास्ते में चल रहे इंटर-प्लांट चालान, डिस्पैच वज़न का ट्रेंड, बड़े ग्राहक और हाल के चालान।

शिफ्ट की शुरुआत या अंत में खोलें, ताकि पता चले कितना माल गया और कितना बाकी है। यहाँ कुछ बदला नहीं जाता; असली काम के लिए "Open Dispatch Bay" दबाएँ। आँकड़े डिस्पैच रिपोर्ट और इंटर-प्लांट रिपोर्ट से आते हैं।

**शुरू करने से पहले**
- आपके रोल को Logistics एरिया मिला हो (Admin, Owner, Dispatch या इन्वेंटरी अनुमति)।
- चालान तभी दिखते हैं जब Dispatch Bay में स्लिप बन चुकी हों।

**स्टेप बाय स्टेप**
1. चार टाइल पढ़ें: "Draft challans", "In transit", "Dispatched challans", "Dispatch weight"।
2. "Dispatch weight trend" में हर दिन भेजा गया kg देखें।
3. "Top dispatch customers" में देखें किस ग्राहक को सबसे ज़्यादा वज़न गया।
4. "Latest challans" (नंबर, ग्राहक, स्टेटस, गाड़ी) और "Inter-plant live lanes" (किस प्लांट से किस प्लांट, kg) देखें।
5. माल लोड करके भेजने के लिए "Open Dispatch Bay" दबाएँ, या ट्रांज़िट पेज के लिए "Open Transit Board"।

**स्क्रीन पर क्या है**
- **Draft challans**: स्लिप बनी है पर अभी "dispatched" नहीं की गई।
- **In transit**: इंटर-प्लांट चालान जो अभी रास्ते में हैं, दूसरे प्लांट पर रिसीव नहीं हुए।
- **Dispatched challans**: ग्राहक के चालान जो dispatched हो चुके हैं।
- **Dispatch weight**: रिपोर्ट की अवधि में भेजा गया कुल kg।
- **Inter-plant live lanes**: पाँच तक इंटर-प्लांट चालान: किस प्लांट से किस प्लांट, स्टेटस और भेजा गया kg।

**आम दिक्कतें और हल**
- "Logistics लोड नहीं हुआ (retry बॉक्स)" — डिस्पैच या इंटर-प्लांट रिपोर्ट नहीं आई। retry दबाएँ; बार-बार हो तो नेटवर्क देखें या एडमिन को बताएँ।
- "No challans found for the selected window." — उस अवधि में कोई स्लिप नहीं बनी। Dispatch Bay में Create करने के बाद ही स्लिप दिखती है।

**अटक गए तो**
1. टाइल पर देर तक "..." दिखे तो पेज रीलोड करें।
2. कोई भी काम (प्रिंट, डिस्पैच, POD) Dispatch Bay में करें; इस पेज से डेटा नहीं बदलता।

जुड़े पेज: /logistics/dispatch, /logistics/transit, /logistics/packing, /analytics/reports/dispatch

**अभी नहीं होता / ध्यान दें**
- "Open Transit Board" असली बोर्ड नहीं, अस्थायी Transit पेज खोलता है।

### Dispatch Bay (डिस्पैच बे) (/logistics/dispatch)
स्क्रीन का पता: /logistics/dispatch · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, DISPATCH · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=logistics-dispatch&lang=hi

रिलीज़ हुए रोल और गोनी गाड़ी पर लोड करें, हर ऑर्डर लाइन की अलग डिस्पैच स्लिप बनाएँ, Epson 10 × 6 इंच फ़ॉर्म पर प्रिंट करें, dispatched मार्क करें और बाद में डिलीवरी का सबूत (POD) कन्फ़र्म करें।

जब Packing Yard यूनिट रिलीज़ कर दे तब खोलें। यहाँ सिर्फ़ रिलीज़ यूनिट दिखती हैं। तीन टैब: "Ready to dispatch" (बोर्ड और लोडिंग ट्रे), "This load" (अभी बनी स्लिप) और "Challans & history"। POD के बाद ऑर्डर बंद हो सकता है।

**शुरू करने से पहले**
- यूनिट Packing Yard से रिलीज़ हों (सील गोनी या रिलीज़ रोल)।
- सेल्स ऑर्डर ड्राफ्ट न हो; कैंसल/कम्प्लीट ऑर्डर या बंद लाइन के लिए closed-lines टिक चाहिए।
- ऑर्डर पर डिलीवरी पता हो, या ट्रे में dispatch-only लोकेशन लिखी जाए।
- Windows PC पर Epson प्रिंट के लिए एक बार "Epson setup" इंस्टॉल करें।

**स्टेप बाय स्टेप**
1. "Ready to dispatch" पर ऑर्डर ढूँढें (search, "Unit type", "Queue status", ग्राहक, sort या "Jump to order…")।
2. लाइन टिक करें तो उसकी सारी तैयार यूनिट लोड होंगी; आधा लोड करना हो तो "Units" खोलकर एक-एक रोल/गोनी टिक करें।
3. "Loading tray" में "Transporter" भरें (ज़रूरी; या "Own vehicle", "Customer pickup", "Courier" दबाएँ)। "Vehicle no.", ड्राइवर, LR no., E-way bill और नोट वैकल्पिक हैं।
4. हर ऑर्डर की "Delivery location" देखें; बंद लाइन ट्रे पर हो तो "Send goods of closed lines" टिक करें।
5. "Create N slips" दबाएँ। ट्रे की सारी स्लिप एक साथ बनती हैं, या एक भी नहीं।
6. "This load" पर स्लिप का टेक्स्ट देखें और "Print N slips" दबाएँ (या "Print this slip", "A4 PDF", QR स्टिकर)।
7. गाड़ी निकलते ही "Mark dispatched · close" दबाएँ।
8. बाद में "Challans & history" → "Awaiting POD" में "Confirm POD" दबाएँ, रिसीवर/रेफ़रेंस/नोट भरें और कन्फ़र्म करें।

**स्क्रीन पर क्या है**
- **Units ready**: बे में इंतज़ार कर रहे रिलीज़ गोनी और रोल।
- **Weight ready**: तैयार यूनिट का ग्रॉस kg, नीचे नेट प्रोडक्ट kg।
- **Orders ready**: जिन ऑर्डर की यूनिट तैयार हैं, ग्राहकों की गिनती और कितने अभी पैकिंग में हैं।
- **Vehicles today / Slips today**: आज की गाड़ियाँ और स्लिप; स्लिप dispatched और draft में बँटी।
- **Awaiting POD**: dispatched चालान जिनका POD नहीं हुआ। history टैब खोलता है।
- **लाइन बैलेंस (ordered / dispatched / on this load / remaining)**: हर लाइन के लिए; बंद लाइन पर "Order completed" या "Line short-closed" और ordered, closed, बना हुआ व बाकी मात्रा दिखती है।
- **Transporter ***: ज़रूरी। हर स्लिप पर TRANSPORT NAME में छपता है।
- **Vehicle no.**: वैकल्पिक। चालान में सेव होता है; अभी स्लिप पर नहीं छपता।
- **Delivery location ***: ऑर्डर के पते से आती है; सिर्फ़ इन स्लिप के लिए बदल सकते हैं।
- **Internal note**: स्लिप पर नहीं छपता।
- **Packing slip / A4 PDF (Units)**: चुनी या दिख रही यूनिट की सूची, Epson पर या A4 PDF में।
- **History स्टेटस टैब**: "Drafts", "Awaiting POD", "Delivered", "Cancelled"; तारीख Today / 7 days / All; ग्राहक; चालान, ग्राहक, SO, job या गाड़ी से search।

**आम दिक्कतें और हल**
- "Transporter name is required (printed as TRANSPORT NAME)." — Transporter खाली है। नाम लिखें या कोई quick choice दबाएँ।
- "Delivery location missing for SO-…: enter where it goes." — ऑर्डर पर शिपिंग पता नहीं है। ट्रे में dispatch-only लोकेशन लिखें।
- "Closed lines on the tray: SO-… L2. Confirm shipping the goods already made for them, or move them to stock." — बंद लाइन बिना टिक के लोड है। "Send goods of closed lines" टिक करें, या लाइन हटाकर "Move to stock" करें।
- "Sales Order SO-… is DRAFT; a challan cannot be created in this order state." — ड्राफ्ट ऑर्डर कभी डिस्पैच नहीं होता। सेल्स से ऑर्डर प्लेस करवाएँ।
- "Gonny … is not released from Packing Yard. / Roll … is not released to Dispatch Bay yet." — यूनिट रिलीज़ नहीं हुई। पहले Packing Yard में रिलीज़ करें।
- "Batch … is on hold at the packing check … A supervisor must accept it with a reason before dispatch." — पैकिंग चेक में अंतर मिला। सुपरवाइज़र Packing Yard → Details → Packing check में कारण देकर स्वीकार करे।
- "Selected dispatch unit is already reserved or dispatched: …" — किसी और ने इसे दूसरी स्लिप पर ले लिया। Refresh करके फिर लोड करें।
- "POD can only be confirmed for a dispatched challan, not DRAFT" — पहले स्लिप dispatched करें, फिर POD।
- "Epson print failed" — प्रिंट जॉब नहीं बना या PC पर Epson helper नहीं है। "Epson setup" इंस्टॉल करें या "A4 PDF" लें।

**अटक गए तो**
1. जो यूनिट दिखनी चाहिए वो न दिखे तो ऊपर Refresh दबाएँ; हर 30 सेकंड में अपने-आप रिफ़्रेश होता है।
2. "No orders to ship" दिखे तो यूनिट अभी Packing Yard में हैं: वहाँ रिलीज़ करें।
3. बंद लाइन का माल फ़्री स्टॉक में भेजना हो तो उस लाइन पर "Move to stock" दबाएँ।
4. पुरानी ड्राफ्ट स्लिप "Challans & history" → "Drafts" में है; वहाँ "Dispatch" दबाएँ (बंद लाइन पर "Line closed · send the goods anyway?" पूछेगा)।
5. ऑर्डर पेज से /logistics/dispatch?history=SO-… लिंक उस ऑर्डर की स्लिप खोलता है।

जुड़े पेज: /logistics/packing, /logistics, /sales/orders, /gate/outward

**अभी नहीं होता / ध्यान दें**
- गाड़ी, ड्राइवर, LR नंबर और job name चालान में सेव होते हैं पर Epson स्लिप पर नहीं छपते।
- Dispatch Bay से ड्राफ्ट स्लिप कैंसल नहीं हो सकती, और हर स्लिप का प्रिंट लॉग नहीं है।
- "Mark dispatched anyway" से सारी स्लिप छपे बिना भी लोड dispatched हो सकता है।

### Packing Yard (पैकिंग यार्ड) (/logistics/packing)
स्क्रीन का पता: /logistics/packing · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, DISPATCH, STORE, PLANT_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=logistics-packing&lang=hi

बने हुए पाउच बैच और रोल को तौली हुई डिस्पैच यूनिट में बदलें: पाउच गोनी में भरें, तौलकर सील करें, इस्तेमाल हुए पैकिंग आइटम टिक करें, और हर लाइन को अलग स्लिप के लिए Dispatch Bay में रिलीज़ करें।

जब मशीन किसी ऑर्डर का आउटपुट दर्ज कर दे तब खोलें। काम मशीन टर्मिनल से आता है (बैच और रोल); रिलीज़ यूनिट Dispatch Bay में जाती हैं। टैब: "Queue · ready to pack", "In progress" (खुली और सील गोनी) और "History" (रिलीज़ लाइनें)।

**शुरू करने से पहले**
- ऑर्डर लाइन पर मशीन आउटपुट दर्ज हो (पाउच के लिए बैच, रोल के लिए रोल)।
- Masters › Packaging में गोनी मास्टर उनके वज़न के साथ; बाकी पैकिंग आइटम वहाँ active हों।
- ऑर्डर का पैकिंग प्लान (inner packs या loose pouches, एक पैक में कितने पाउच, inner pouch, गोनी)।

**स्टेप बाय स्टेप**
1. "Queue · ready to pack" में "Packing route" (All / Pouch / Roll / Release), search, ग्राहक, sort या "Jump to order…" से ऑर्डर ढूँढें।
2. तैयार लाइनें टिक करें (एक या कई ऑर्डर; "All N ready lines" पूरा ऑर्डर टिक करता है), फिर "Pack selected · N" दबाएँ। या एक लाइन पर "Pack" / "Release" / "Pack & release" दबाएँ।
3. पाउच लाइन, स्टेप 1: मशीन के आँकड़े देखें और "Figures checked" टिक करें। स्टेप 2 बताता है पाउच कैसे आते हैं (ऑर्डर के अनुसार: "Inner packs" या "Loose pouches")।
4. स्टेप 3: इस गोनी के inner packs या पाउच भरें ("Suggest split" मदद करता है), "Gonny type · tare" चुनें, तराज़ू पर रखकर "Weighed gross kg" लिखें। "Add gonny · sealed" दबाएँ (या gross खाली छोड़कर "Add gonny · open" और बाद में लिस्ट में तौलें)।
5. तराज़ू का वज़न expected से 2 % से ज़्यादा अलग हो तो variance का कारण लिखें।
6. स्टेप 4: इस्तेमाल हुआ हर पैकिंग आइटम टिक करें (गोनी, शीट, पुठा, बॉक्स, टेप, लेबल, टैग, बाहरी बैग…)। मात्रा नहीं; inner pouch लिस्ट में नहीं आता।
7. स्टेप 5: "Release L1 · N gonnies" दबाएँ (कुछ पाउच बाद के लिए बचें तो "· short")। कई टैब तैयार हों तो "Release all N lines"।
8. रोल लाइन: रोल टिक करें ("Select all open"), "Packed roll · sheet / wrap" या "Release unpacked roll" चुनें, इस्तेमाल हुए आइटम टिक करें, फिर रिलीज़ करें।
9. "History" (Today / 7 days / All) में देखें किसने क्या रिलीज़ किया, हर गोनी का वज़न, टिक आइटम और स्लिप।

**स्क्रीन पर क्या है**
- **Lines ready to pack**: जिन लाइनों के बैच या रोल बाकी हैं; नीचे बैच, रोल और pcs।
- **Weight ready**: अभी पैक होने वाला नेट kg: पाउच और रोल।
- **Packed today**: आधी रात से पैक हुई गोनी, साथ में रिलीज़ रोल।
- **Open / sealed**: तौलने वाली खुली गोनी और रिलीज़ होने वाली सील गोनी। "In progress" खोलता है।
- **Released today**: आज Dispatch Bay में रिलीज़ यूनिट, नेट और ग्रॉस kg के साथ। History खोलता है।
- **Variance alerts**: रुके हुए पैकिंग चेक और वो गोनी जिनका ग्रॉस expected से ±2 % से ज़्यादा अलग है।
- **Expected gross**: प्रोडक्ट नेट (मशीन लॉग) + inner pouches + गोनी का वज़न।
- **लाइन (L1…)**: साइज़, लेयर, pcs या kg, एक पाउच का ग्राम, inner packs या loose, मशीन, कब से तैयार, लोकेशन।
- **Ready slip**: मटेरियल रेडी स्लिप प्रिंट करता है; रिलीज़ यूनिट होने पर ही चालू।
- **Details**: टैब "Units & batches", "Packing check", "Order & links"।
- **बंद लाइन नोटिस + Move to stock**: short-closed, completed या cancelled लाइन का माल: भेजने के लिए रिलीज़ करें, या कारण देकर "Move to stock"।
- **Inner packs filled**: जब ऑर्डर में pieces per inner pouch नहीं होता तब दिखता है: इस gonny में कितने inner pack गए, लिखें। शाम की गिनती इन्हें ऑर्डर पर बुक करती है।

**आम दिक्कतें और हल**
- "Variance reason is required when actual gonny gross weight differs from expected by more than 2%." — तराज़ू का वज़न 2 % से ज़्यादा अलग है। फिर से तौलें, या कारण लिखें (ज़्यादा पैकिंग, गलत गिनती…)।
- "Insufficient quantity: requested X, available Y" — बैच में बचे पाउच से ज़्यादा लिखे गए। संख्या कम करें।
- "Gonny … must be SEALED before release to dispatch." — खुली गोनी रिलीज़ नहीं होती। लिस्ट में तौलकर सील करें।
- "Batch … is on hold at the packing check …" — पैकिंग चेक लिमिट से बाहर है। प्रोडक्शन सुपरवाइज़र या मैनेजर Details → Packing check में "Accept with reason" दबाए।
- "Roll … has no packaging lines. Select at least one packing master or release unpacked." — "Packed roll" के लिए कम से कम एक टिक चाहिए। आइटम टिक करें, या "Release unpacked roll" चुनें।
- "Bulk roll packing requires rolls in the same FG store. Split the action by location." — एक साथ टिक किए रोल अलग स्टोर में हैं। दो बार में रिलीज़ करें।
- "No gonny packaging masters exist yet. Add one in Masters › Packaging." — गोनी मास्टर नहीं है, या उसका वज़न नहीं भरा। मास्टर डेटा वाले से जुड़वाएँ।
- "N lines released, then stopped" — "Release all" एक लाइन पर गलती से रुका; पहले वाली लाइनें रिलीज़ हो चुकी हैं। उस लाइन को ठीक करके फिर रिलीज़ करें।

**अटक गए तो**
1. लाइन पुरानी लगे तो Refresh दबाएँ; बोर्ड हर 30 सेकंड में रिफ़्रेश होता है।
2. खुली जोड़ी गई गोनी "In progress" में रहती है: "Weigh" दबाएँ, ग्रॉस लिखें और सील करें।
3. लिस्ट में कोई आइटम न दिखे (जैसे Putha), तो वो Masters › Packaging में inactive है या Inner pouch सेट है; उसका kind ठीक करवाएँ।
4. बंद लाइन का माल: भेजने के लिए रिलीज़ करें, या कारण देकर "Move to stock" दबाएँ।
5. ऑर्डर पर बुक हुआ पैकिंग मटेरियल देखने के लिए कार्ड के नीचे "Audit this order" दबाएँ।

जुड़े पेज: /logistics/dispatch, /logistics/packing/audit, /logistics/packing/consumption, /dashboard/planner/control-tower/completed-trace, /dashboard/planner/control-tower/plan-queue, /master/packaging

**अभी नहीं होता / ध्यान दें**
- यार्ड किसी लाइन को inner packs और loose pouches के बीच बदल नहीं सकता; ऑर्डर का चुनाव ही चलता है।
- पाउच लाइन बिना किसी पैकिंग टिक के रिलीज़ हो सकती है, जबकि packed रोल रिलीज़ बिना एक टिक के मना हो जाती है।
- 25 Oct के नोट में लिखा था कि पाउच रिलीज़ पर गोनी टिक नहीं होती; 27 Oct से inner pouch छोड़कर हर active आइटम, गोनी समेत, हमेशा टिक लिस्ट में है।
- "Variance alerts" टाइल In progress टैब खोलती है पर सिर्फ़ गड़बड़ यूनिट नहीं छाँटती।

### Packing audit (पैकिंग ऑडिट) (/logistics/packing/audit)
स्क्रीन का पता: /logistics/packing/audit · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, DISPATCH, STORE, PLANT_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=logistics-packing-audit&lang=hi

हर ऑर्डर में कितना पैकिंग मटेरियल लगा: आउटपुट दर्ज होते समय मशीन पर कटे घर के (in-house) inner pouch (व्यू "Inner pouches · at packing"), रिलीज़ पर टिक किए आइटम, और हर शाम की गिनती ने असली खपत को ऑर्डर लाइनों में कैसे बाँटा।

हर ऑर्डर का पैकिंग खर्च जाँचने, गिनती का इंतज़ार कर रहे टिक ढूँढने, या जब गिनती और टिक मेल न खाएँ तब खोलें। Packing Yard से ("Audit" या "Audit this order") खुलता है।

**शुरू करने से पहले**
- Packing Yard में टिक वाली रिलीज़, और count व्यू के लिए कम से कम एक पोस्ट की गई शाम की गिनती।

**स्टेप बाय स्टेप**
1. व्यू चुनें: "Evening counts", "Inner pouches · at packing" या "Ticks at release"।
2. तारीख, ग्राहक, पैकिंग मटेरियल चुनें, या ऑर्डर नंबर लिखें (जैसे SO-2026-0123)।
3. "Evening counts" में हर मटेरियल देखें: book → counted → used, टिक, और हर ऑर्डर लाइन का हिस्सा।
4. चेतावनी "The yard ticked N but the count says … used" देखें और गिनती या टिक जाँचें।
5. "Waiting for a count" से आख़िरी गिनती के बाद के टिक देखें।
6. मौजूदा व्यू डाउनलोड करने के लिए "Export CSV" दबाएँ।

**स्क्रीन पर क्या है**
- **Evening counts**: तारीख की अवधि में कितनी गिनतियाँ हुईं।
- **Booked by counts**: गिनती से ऑर्डर पर बुक हुई पंक्तियाँ, ऑर्डर की गिनती के साथ।
- **Inner pouches at packing**: मशीन के आखिरी pouching step पर output दर्ज होते समय stock से कटे घर के (in-house) inner pouch। खरीदे हुए inner pouch यहाँ नहीं; उन्हें शाम की गिनती काटती है।
- **Ticks at release**: सिर्फ़ निशान; गिनती तक स्टॉक पर असर नहीं।
- **Waiting for a count**: आख़िरी गिनती के बाद टिक हुए।
- **Tick mismatches**: जहाँ टिक और गिनी गई खपत अलग है।
- **Book / Counted / Used**: गिनती से पहले सिस्टम स्टॉक, असली गिनती, और खपत का अंतर।
- **Not on any order**: वह खपत जब उस दिन किसी ऑर्डर लाइन ने आइटम टिक नहीं किया (न उस पर निशान लगा) और उस दिन पैक हुए किसी ऑर्डर के packing plan में भी वह आइटम नहीं था।
- **Found … more than the book**: गिनती book से ज़्यादा निकली; अतिरिक्त स्टॉक में वापस जुड़ा।
- **Weight summary**: "Our product", "Dispatch weight (gross)", "Packing in the dispatch weight", "In-house inner pouches taken"।

**आम दिक्कतें और हल**
- "No evening counts in this range" — इन तारीखों में कोई गिनती नहीं हुई। तारीख बढ़ाएँ या Evening count पर गिनती पोस्ट करें।
- "The yard ticked N but the count says … used." — टिक और गिनती मेल नहीं खाते; खपत फिर भी टिक के अनुसार बँटी। असली गिनती दोबारा देखें या यार्ड से छूटे टिक पूछें।
- "No ticks in this range" — इन तारीखों में रिलीज़ पर कुछ टिक नहीं हुआ।

**अटक गए तो**
1. लिस्ट खाली हो तो ऑर्डर नंबर और ग्राहक फ़िल्टर हटाएँ।
2. ग्राहक फ़िल्टर सिर्फ़ लिस्ट पर लगता है, गिनती कार्ड पर नहीं।
3. 26 Oct 2026 से पहले के हिस्से दशमलव में हो सकते हैं; बाद की गिनती में पीस पूरे-पूरे बँटते हैं।

जुड़े पेज: /logistics/packing, /logistics/packing/consumption, /master/packaging

**अभी नहीं होता / ध्यान दें**
- ग्राहक फ़िल्टर सिर्फ़ लिस्ट पर लगता है, शाम की गिनती के कार्ड पर नहीं।
- टिक और गिनती अलग हों तो भी खपत टिक के हिसाब से बँटती है; पेज चेतावनी देता है पर बँटवारा सुधारने का रास्ता नहीं।

### Evening packing count (शाम की पैकिंग गिनती) (/logistics/packing/consumption)
स्क्रीन का पता: /logistics/packing/consumption · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, DISPATCH, STORE, PLANT_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=logistics-packing-consumption&lang=hi

दिन के अंत में किसी लोकेशन पर पैकिंग स्टॉक की असली गिनती। हर लाइन book मात्रा से शुरू होती है; आपका लिखा अंतर तुरंत (बिना approval) स्टॉक से घटता है और उस दिन जिन ऑर्डर लाइनों ने वो आइटम टिक किया या जिन पर निशान लगा उन पर बुक होता है, वरना उस दिन के उन ऑर्डरों पर जिनके packing plan में वो आइटम है।

हर शाम आख़िरी रिलीज़ के बाद करें। गोनी, शीट, पुठा, बॉक्स, टेप, लेबल, टैग, बाहरी बैग आदि रिलीज़ पर सिर्फ़ टिक होते हैं, और खरीदे हुए inner pouch पर मशीन सिर्फ़ निशान लगाती है; यही गिनती उन्हें स्टॉक से घटाती है, इसलिए खरीदे हुए inner pouch भी गिनें। यही गिनती Stock Lifecycle → count (PACKING) में भी है।

**शुरू करने से पहले**
- Masters › Packaging में पैकिंग मास्टर active हों और गिनती वाली लोकेशन पर स्टॉक हो।
- दिन की रिलीज़ Packing Yard में टिक के साथ हो चुकी हों।

**स्टेप बाय स्टेप**
1. गिनती की लोकेशन चुनें ("Pick count location"); पैकिंग या FG लोकेशन पहले से चुनी आती है।
2. गिनती की तारीख और समय देखें; देर से गिन रहे हों तो बदलें। "Refresh" दबाएँ।
3. हर लाइन में पहले से book मात्रा भरी आती है। गिनी हुई बंद मात्रा सिर्फ़ वहीं लिखें जहाँ फ़र्क हो; book पर छोड़ी लाइनों से स्टॉक नहीं बदलता ("Copy book qty" book के आँकड़े फिर से भर देता है)।
4. "Delta" कॉलम देखें: माइनस = खपत, प्लस = ज़्यादा मिला।
5. "Same-day allocation pool" में वो ऑर्डर देखें जिनमें खपत बँटेगी।
6. ज़रूरत हो तो नोट लिखें और "Post count" दबाएँ। स्टॉक तुरंत बदलता है; कोई approval नहीं होता।

**स्क्रीन पर क्या है**
- **Packing SKUs**: लोकेशन पर सारे active पैकिंग मास्टर।
- **Book stock**: अभी का सिस्टम बैलेंस।
- **Same-day orders**: आज की खपत बाँटने लायक ऑर्डर लाइनें।
- **Entered delta**: लिखे गए अंतर का जोड़ (प्लस = ज़्यादा / माइनस = खपत)।
- **Closing qty**: आपने असल में जितना गिना, मटेरियल की यूनिट में। शुरू में book मात्रा भरी आती है।
- **Note**: शिफ्ट नोट, गायब बंडल, गिनती सुधार…

**आम दिक्कतें और हल**
- "Count failed" — सर्वर ने गिनती नहीं ली (जैसे "… is not a packaging material.")। संदेश पढ़ें, लाइन ठीक करें और फिर पोस्ट करें।
- ""Post count" बंद रहता है" — इस लोकेशन पर गिनने को कोई पैकिंग आइटम नहीं है (Masters › Packaging में कोई active पैकिंग मास्टर नहीं और यहाँ कोई पैकिंग स्टॉक नहीं)। लिस्ट लोड होते समय, सारे गिनती के खाने खाली करने पर, या post चलते समय भी बटन बंद रहता है। आम तौर पर लाइनें book मात्रा से भरी आती हैं, इसलिए बटन चालू रहता है।
- "No packing throughput on this date." — इस समय तक इस लोकेशन पर कुछ पैक नहीं हुआ। यहाँ गिनी खपत फिर भी उस दिन प्लांट में कहीं और पैक हुए उन ऑर्डरों पर जाती है जिन्होंने आइटम टिक किया या जिनके packing plan में वो है; ऐसे ऑर्डर न हों तभी किसी ऑर्डर पर नहीं जाती।

**अटक गए तो**
1. उसी लोकेशन पर गिनें जहाँ यार्ड पैकिंग स्टॉक रखता है।
2. हिस्सा गलत लगे तो Packing audit → Evening counts में टिक और गिनती मिलाएँ।
3. एक यूनिट पर कोई आइटम दो बार टिक हो तब भी एक ही बार गिना जाता है।

जुड़े पेज: /logistics/packing, /logistics/packing/audit, /inventory/stock-lifecycle

**अभी नहीं होता / ध्यान दें**
- 26 Oct 2026 से पहले की गिनतियों में हिस्से दशमलव में रहते हैं; बाद की गिनती ही पूरे पीस बाँटती है।
- जिस बैच का आउटपुट उस दिन की शाम की गिनती पोस्ट होने के बाद दर्ज हुआ (जैसे आधी रात से पहले की नाइट शिफ्ट), उसके inner pouch किसी गिनती में मार्क नहीं होते; उनका इस्तेमाल अगली गिनती में पैकिंग प्लान से बँटता है या किसी ऑर्डर पर नहीं जाता।

### Transit Tracking (ट्रांज़िट) (/logistics/transit)
स्क्रीन का पता: /logistics/transit · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, DISPATCH · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=logistics-transit&lang=hi

ट्रांज़िट का अस्थायी पेज। टाइल और "Outbound lane board" में तय नमूना आँकड़े हैं, असली शिपमेंट नहीं; GPS नहीं है।

इससे फ़ैसले न लें। असली स्टेटस के लिए Dispatch Bay ("Challans & history") या Dispatch report देखें; रास्ते में इंटर-प्लांट चालान Logistics overview पर दिखते हैं।

**शुरू करने से पहले**
- कुछ नहीं।

**स्टेप बाय स्टेप**
1. "Telemetry rollout note" पढ़ें: डिस्पैच चालान ही सही जानकारी हैं।
2. स्लिप, डिस्पैच और POD के लिए "Open Dispatch Bay" दबाएँ।
3. तारीख और ग्राहक के हिसाब से आँकड़ों के लिए "Open Dispatch Report" दबाएँ।

**स्क्रीन पर क्या है**
- **In active transit / Destinations live / Average transit time / Delivered today**: तय नमूना संख्या; असली डेटा से नहीं बदलती।
- **Outbound lane board**: तीन नमूना लेन (काल्पनिक ग्राहक); आपके शिपमेंट नहीं।

**आम दिक्कतें और हल**
- "आँकड़े कभी नहीं बदलते" — पेज अभी असली डेटा से जुड़ा नहीं है। Dispatch Bay history या Dispatch report देखें।

**अटक गए तो**
1. किसी गाड़ी का स्टेटस जानने के लिए Dispatch Bay → "Challans & history" में चालान खोजें।

जुड़े पेज: /logistics/dispatch, /analytics/reports/dispatch, /logistics

**अभी नहीं होता / ध्यान दें**
- Transit पेज पर तय नमूना आँकड़े और तीन काल्पनिक लेन हैं; यह किसी शिपमेंट डेटा से जुड़ा नहीं है।

### Customer dispatches (/sales/orders/[id]/dispatches)
स्क्रीन का पता: /sales/orders/[id]/dispatches · भूमिकाएँ: SALES, OWNER, ADMIN, SUPER_ADMIN, DISPATCH · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=sales-orders-id-dispatches&lang=hi

एक sales order पर बने customer dispatch records की list, confirm, cancel, QR sticker और line details के साथ।

इस order पर क्या भेजा गया यह देखने और draft dispatch confirm करने के लिए। हर confirm हुआ dispatch order lines की open qty घटाता है; सारी lines पूरी dispatch होने पर order COMPLETED हो जाता है। रोज़ की slips Dispatch Bay में बनती हैं; Dispatch Bay की slips से गया order हर line का proof of delivery (POD) confirm होने पर ही COMPLETED होता है।

**शुरू करने से पहले**
- lines packing-ready या dispatch-ready होनी चाहिए (Packing Yard से release)।

**स्टेप बाय स्टेप**
1. tiles देखें: "Total dispatches", "Confirmed / shipped", "Drafts in progress"।
2. "Dispatch ledger" में row पर "Details" दबाकर plant, driver, invoice और हर order line की quantity देखें।
3. DRAFT row पर बुक करने के लिए "Confirm" या हटाने के लिए "Cancel" दबाएँ।
4. QR button से gate QR sticker छापें (Tally bill या slip पर चिपकाएँ; gate इसे scan करता है)।
5. नया dispatch बनाने के लिए "New dispatch" दबाएँ।

**स्क्रीन पर क्या है**
- **Status**: DRAFT (save, बुक नहीं), CONFIRMED (lines पर qty बुक), DISPATCHED, CANCELLED।
- **Dispatch date · lines · Vehicle · LR**: dispatch बनाते समय भरी जानकारी।
- **Order line / Quantity / Notes**: "Details" के अंदर: इस dispatch में हर line से कितना गया।

**आम दिक्कतें और हल**
- "Cannot confirm a dispatch in status …" — सिर्फ DRAFT confirm हो सकता है।
- "Line exceeds dispatchable qty: requested X, dispatchable Y." — किसी और dispatch ने qty ले ली। यह draft cancel करें और कम qty के साथ नया बनाएँ।
- "Line is not ready for dispatch / Line has no completed final output ready to dispatch" — माल अभी yard से release नहीं हुआ, या partial line का तैयार माल नहीं है। पहले Planner / Packing Yard में सुलझाएँ।
- "Cannot cancel a dispatch in status DISPATCHED" — dispatched record cancel नहीं हो सकता।

**अटक गए तो**
1. ledger खाली ("No dispatches yet."): Dispatch Bay में बनी slips वहीं दिखती हैं, हमेशा यहाँ नहीं; इस SO के लिए Dispatch Bay history खोलें।
2. tracker पर लौटने के लिए "Back to order" दबाएँ।

जुड़े पेज: /sales/orders/[id], /sales/orders/[id]/dispatches/new, /logistics/dispatch

**अभी नहीं होता / ध्यान दें**
- ledger में Cancel सिर्फ DRAFT dispatch पर दिखता है जबकि server CONFIRMED dispatch भी cancel होने देता है, और server में सुविधा होते हुए भी "mark dispatched" button नहीं है।
- यहाँ के customer dispatch records Dispatch Bay की slips से अलग हैं; Dispatch Bay में बनी slips इस ledger में शायद न दिखें, जिससे भेजे गए माल को ढूँढने में भ्रम हो सकता है।

### New dispatch (/sales/orders/[id]/dispatches/new)
स्क्रीन का पता: /sales/orders/[id]/dispatches/new · भूमिकाएँ: SALES, OWNER, ADMIN, SUPER_ADMIN, DISPATCH · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=sales-orders-id-dispatches-new&lang=hi

एक sales order के लिए customer dispatch record बनाने का form: header (तारीख, गाड़ी, driver, LR, invoice, notes) और हर line की quantity।

जब इस order का माल जाए और order lines पर dispatch record चाहिए, तब इस्तेमाल करें। हर row में सिर्फ अभी भेजी जा सकने वाली qty पहले से भरी होती है; partial output में बाकी बचा planner के पास रहता है।

**शुरू करने से पहले**
- कम से कम एक line packing-ready / dispatch-ready हो, या partial line का तैयार माल हो।

**स्टेप बाय स्टेप**
1. "Dispatch date" देखें (default आज)।
2. "Vehicle no", "Driver", "LR no", "Customer invoice" और "Notes" भरें (ज़रूरी नहीं पर अच्छा है)।
3. "Lines" में हर line का "Dispatch now" देखें; आंशिक माल हो तो कम करें। जो lines ready नहीं वे बंद रहती हैं।
4. ऊपर "Total qty" देखें।
5. DRAFT रखने के लिए "Save draft", या अभी बुक करने के लिए "Save & confirm" दबाएँ।

**स्क्रीन पर क्या है**
- **Ordered / Already shipped / Open**: line की qty, पहले भेजी गई qty, और बाकी।
- **Dispatchable**: अभी कितना जा सकता है (तैयार और release)। Dispatch now इससे ज़्यादा नहीं हो सकता।
- **Final output: dispatch X now · planner replan Y**: partial line: X जा सकता है, Y planner के पास दोबारा release या short-close के लिए रहता है।
- **UoM**: line की unit, KG या PCS।

**आम दिक्कतें और हल**
- "Enter qty against at least one line." — सारे "Dispatch now" खाने शून्य हैं। ready line पर qty भरें।
- "… is not ready for dispatch. Resolve it in Planner first." — line packing से release नहीं हुई। पहले Packing Yard में release करें।
- "… exceeds dispatchable quantity N." — qty को dispatchable तक कम करें।
- "… has no completed final output ready to dispatch. Re-release or short-close it in Planner." — partial line जिसमें कुछ तैयार नहीं; planner को कदम उठाना होगा।
- "Dispatch quantity must be greater than zero." — शून्य या ऋण qty हटाएँ।

**अटक गए तो**
1. सारे खाने बंद: अभी कोई line ready नहीं; order tracker की spine (Yard station) देखें।
2. गलती से draft save हुआ: ledger खोलें और उस पर "Cancel" दबाएँ।

जुड़े पेज: /sales/orders/[id]/dispatches, /sales/orders/[id], /logistics/dispatch, /logistics/packing

**अभी नहीं होता / ध्यान दें**
- इस form में Dispatch Bay वाली "Send goods of closed lines" पुष्टि या बंद line की सुविधा नहीं है।
