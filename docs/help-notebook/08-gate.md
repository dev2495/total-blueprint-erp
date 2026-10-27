# Gate — watchman, visitors, inward and outward

## Overview (English)
# Gate: watchman terminal, goods and visitors

The Gate module is the phone app for the factory gate. Watchmen photograph inward bills, record outward papers, record our own papers coming back, and check visitors out. Visitors register themselves with the gate QR. Owners set up gates, read history and correct mistakes with a reason. Every time is server time; nothing is deleted.

## Screens

- **Gate home** (`/gate`): tiles *Take bill photo* (inward), *Outward*, *Visitors inside* / *Overdue >12h*, *Goods coming back*, *Today's register*. Admins and owners also see *Gate oversight*.
- **Take bill photo** (`/gate/inward-bills`): 1–6 photos of a supplier bill; no typing, no stock posted.
- **Record outward** (`/gate/outward`): scan ERP QR codes (up to 10, optional), photograph every paper (up to 6), vehicle number.
- **Goods coming back in** (`/gate/arrivals`): scan the QR of our inter-plant challan, job-work challan or returnable gate pass.
- **Goods at the gate** (`/gate/goods`): chooser; `?direction=OUTWARD` opens the typed outward register (invoice/challan, vehicle, customer, items, ERP check). Typed inward is retired.
- **Today's register** (`/gate/register`): today's typed entries; read-only.
- **Inside now** (`/gate/visitors`): visitors inside; *Check out*.
- **Walk-in visitor** (`/gate/visitors/new`): owner registers a visitor without a phone.
- **Gate history** (`/gate/history`): owner view of goods and visitors with ERP match, corrections and audit trail.
- **Visitor QR poster** (`/gate/qr`) and **Gate setup** (`/gate/setup`): owner set-up.
- **Public visitor form** (`/visit/<code>`): opened from the poster, no login.

Bottom bar: Gate · Goods · Visitors · Today.

## Main flows

**Inward bill.** Supplier vehicle arrives → watchman taps *Take bill photo*, photographs each page, taps *Record arrival*. The store gets an alert and checks the photos against a new or existing GRN in Inventory → Bills & documents. The bill stays pending or partly received until every line is confirmed or resolved with a reason.

**Outward.** Dispatch prints a QR sticker for the slip or Tally bill. At the gate the watchman scans each QR, photographs every paper and notes the vehicle, then taps *Record outward*. Status is *Matched to ERP* or *Office will match*.

**Our paper coming back.** Scan the QR on the inter-plant challan, job-work challan or gate pass → check the card → *Record back at the gate*. The store is told to receive it. Wrong plant, already received or non-returnable passes are refused with a clear message.

**Visitors.** The visitor scans the poster, fills name, mobile, purpose (optional company, ID, selfie), gives consent and taps *Record my entry*: entry is recorded at once. The watchman only checks them out (*Check out*). Visitors inside more than 12 hours show as overdue. An owner can register a walk-in; its entry is stamped later with *Record entry*.

## Rules and limits

- Watchmen must have a plant gate assigned (Users → Gate assignment), or the register is locked (*Gate not assigned*).
- Bills: at most 6 pages. Outward: at most 6 pages and 10 codes.
- Retrying a send never records twice ("already saved — it was not recorded twice").
- Gate entries are not edited by the watchman; the owner corrects them in Gate history with a reason (at least 5 characters). Audit history is append-only.
- Visitor photos are private (owner only). Mobile must be 10 digits; Aadhaar 12 digits; consent required.
- Replacing the visitor QR stops the old link; print the new poster.

## Roles

- **Watchman**: gate terminal only – bill photos, outward, coming back, visitor check-out, today's register.
- **Admin / Owner / Super Admin**: everything, plus setup, QR, history, walk-in, corrections.
- **Report delegates (gate.reports)**: only the sanitised Gate report.
- **Store**: receives bills and returned papers in Inventory.

## Problems and fixes

- *No gate access*: account not set up – ask for the Watchman role or gate access.
- *Gate not assigned*: tick the factory under Gate assignment and sign in again.
- *Gate server not reachable*: no internet; nothing was recorded – retry.
- *Not available* on a page: the page is for another role.
- *This code is not an ERP document code*: remove the code; photos are enough.
- *This challan is for <plant>, not this gate*: wrong factory.
- *This invoice or active visitor is already recorded*: check Today's register.
- *Gate link not available* on a visitor's phone: old or wrong QR – scan the current poster.

## सारांश (हिंदी)
# गेट: वॉचमैन टर्मिनल, माल और विज़िटर

गेट मॉड्यूल फ़ैक्टरी गेट का फ़ोन ऐप है। वॉचमैन इनवर्ड बिल की फ़ोटो लेता है, बाहर जाते कागज़ दर्ज करता है, हमारे अपने लौटते कागज़ दर्ज करता है और विज़िटर को चेक-आउट करता है। विज़िटर गेट QR से खुद रजिस्टर करते हैं। ओनर गेट सेट करते हैं, इतिहास देखते हैं और कारण के साथ गलती सुधारते हैं। हर समय सर्वर का होता है; कुछ मिटता नहीं।

## स्क्रीन

- **Gate home** (`/gate`): टाइल *Take bill photo* (इनवर्ड), *Outward*, *Visitors inside* / *Overdue >12h*, *Goods coming back*, *Today's register*। एडमिन और ओनर को *Gate oversight* भी दिखता है।
- **Take bill photo** (`/gate/inward-bills`): सप्लायर बिल की 1–6 फ़ोटो; टाइपिंग नहीं, स्टॉक नहीं चढ़ता।
- **Record outward** (`/gate/outward`): ERP QR स्कैन (10 तक, वैकल्पिक), हर कागज़ की फ़ोटो (6 तक), गाड़ी नंबर।
- **Goods coming back in** (`/gate/arrivals`): हमारे इंटर-प्लांट चालान, जॉब-वर्क चालान या returnable गेट पास का QR स्कैन।
- **Goods at the gate** (`/gate/goods`): चुनने की स्क्रीन; `?direction=OUTWARD` टाइप वाला outward रजिस्टर खोलता है (इनवॉइस/चालान, गाड़ी, ग्राहक, आइटम, ERP जाँच)। टाइप वाला inward बंद है।
- **Today's register** (`/gate/register`): आज की टाइप एंट्री; सिर्फ़ देखने के लिए।
- **Inside now** (`/gate/visitors`): अंदर के विज़िटर; *Check out*।
- **Walk-in visitor** (`/gate/visitors/new`): बिना फ़ोन वाले विज़िटर को ओनर रजिस्टर करता है।
- **Gate history** (`/gate/history`): ओनर के लिए माल और विज़िटर, ERP मिलान, सुधार और ऑडिट ट्रेल।
- **Visitor QR poster** (`/gate/qr`) और **Gate setup** (`/gate/setup`): ओनर का सेटअप।
- **सार्वजनिक विज़िटर फ़ॉर्म** (`/visit/<code>`): पोस्टर से खुलता है, लॉगिन नहीं।

नीचे की पट्टी: Gate · Goods · Visitors · Today।

## मुख्य काम

**इनवर्ड बिल।** सप्लायर की गाड़ी आती है → वॉचमैन *Take bill photo* दबाता है, हर पेज की फ़ोटो लेता है, *Record arrival* दबाता है। स्टोर को सूचना जाती है और वो Inventory → Bills & documents में फ़ोटो को नए या पुराने GRN से मिलाता है। हर लाइन कन्फ़र्म या कारण से निपटने तक बिल pending या partly received रहता है।

**आउटवर्ड।** डिस्पैच स्लिप या Tally बिल के लिए QR स्टिकर छापता है। गेट पर वॉचमैन हर QR स्कैन करता है, हर कागज़ की फ़ोटो लेता है, गाड़ी नोट करता है, फिर *Record outward* दबाता है। स्टेटस *Matched to ERP* या *Office will match* होता है।

**हमारा कागज़ वापस।** इंटर-प्लांट चालान, जॉब-वर्क चालान या गेट पास का QR स्कैन करें → कार्ड देखें → *Record back at the gate*। स्टोर को रिसीव करने की सूचना जाती है। गलत प्लांट, पहले से रिसीव, या non-returnable पास साफ़ संदेश के साथ मना हो जाते हैं।

**विज़िटर।** विज़िटर पोस्टर स्कैन करता है, नाम, मोबाइल, मकसद (वैकल्पिक कंपनी, ID, सेल्फ़ी) भरता है, सहमति देता है और *Record my entry* दबाता है: एंट्री तुरंत दर्ज होती है। वॉचमैन सिर्फ़ चेक-आउट (*Check out*) करता है। 12 घंटे से ज़्यादा अंदर रहने वाले overdue दिखते हैं। ओनर walk-in रजिस्टर कर सकता है; उसकी एंट्री बाद में *Record entry* से लगती है।

## नियम और सीमाएँ

- वॉचमैन को प्लांट गेट असाइन होना चाहिए (Users → Gate assignment), नहीं तो रजिस्टर बंद रहता है (*Gate not assigned*)।
- बिल: ज़्यादा से ज़्यादा 6 पेज। आउटवर्ड: 6 पेज और 10 कोड।
- दोबारा भेजने पर कभी दो बार दर्ज नहीं होता ("already saved — it was not recorded twice")।
- वॉचमैन गेट एंट्री नहीं बदलता; ओनर Gate history में कारण (कम से कम 5 अक्षर) के साथ सुधारता है। ऑडिट इतिहास सिर्फ़ जुड़ता है।
- विज़िटर की फ़ोटो निजी है (सिर्फ़ ओनर)। मोबाइल 10 अंक; Aadhaar 12 अंक; सहमति ज़रूरी।
- विज़िटर QR बदलने पर पुराना लिंक बंद हो जाता है; नया पोस्टर प्रिंट करें।

## रोल

- **Watchman**: सिर्फ़ गेट टर्मिनल – बिल फ़ोटो, आउटवर्ड, वापसी, विज़िटर चेक-आउट, आज का रजिस्टर।
- **Admin / Owner / Super Admin**: सब कुछ, साथ में सेटअप, QR, इतिहास, walk-in, सुधार।
- **रिपोर्ट वाले (gate.reports)**: सिर्फ़ Gate report।
- **Store**: Inventory में बिल और लौटे कागज़ रिसीव करता है।

## समस्याएँ और हल

- *No gate access*: अकाउंट सेट नहीं – Watchman रोल या गेट एक्सेस माँगें।
- *Gate not assigned*: Gate assignment में फ़ैक्टरी टिक करवाएँ और दोबारा लॉगिन करें।
- *Gate server not reachable*: इंटरनेट नहीं; कुछ दर्ज नहीं हुआ – फिर कोशिश करें।
- पेज पर *Not available*: पेज किसी और रोल का है।
- *This code is not an ERP document code*: कोड हटाएँ; फ़ोटो काफ़ी हैं।
- *This challan is for <plant>, not this gate*: गलत फ़ैक्टरी।
- *This invoice or active visitor is already recorded*: Today's register देखें।
- विज़िटर के फ़ोन पर *Gate link not available*: पुराना या गलत QR – मौजूदा पोस्टर स्कैन करें।

## Every screen (English)

### Gate register (gate home) (/gate)
Screen address: /gate · Roles: WATCHMAN, ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=gate

The watchman's phone home screen: big tiles for goods coming in (bill photo), goods going out, visitors inside, goods coming back, and today's register.

Open it at the start of duty and come back after every entry. Each tile opens one job. Admins and owners also see "Gate oversight" (setup, history, visitor QR, report).

**Before you start**
- Watchman role (or admin/owner) and a plant gate assigned to the account.
- Internet on the phone.

**Step by step**
1. Check the date and "Namaste, <name>" at the top; switch the gate plant from the header if you have more than one.
2. Goods arriving with a bill: tap "Take bill photo" (Record inward).
3. Goods leaving: tap "Outward" (scan QR · photo).
4. Visitor leaving: tap "Visitors inside" and check them out.
5. Our own challan or gate pass coming back: tap "Goods coming back".
6. Use the bottom bar (Gate · Goods · Visitors · Today) to move between sections.

**What is on the screen**
- **Visitors inside / Overdue >12h**: People inside now and those inside more than 12 hours (red, pulsing).
- **Inside longest**: Visitors inside, oldest first, to check out when they leave.
- **Outward tile**: Count of departures recorded today.
- **Gate oversight (Admin · Owner)**: Links to "Gate setup", "Gate history", "Visitor QR", "Gate report".

**Common problems and fixes**
- "No gate access" — The account is not set up for the gate terminal. Ask an admin or owner to give the Watchman role or gate access.
- "Gate not assigned" — Your account has no plant gate, so the register is locked. An admin or owner assigns the gate in User Management (Gate assignment); then sign in again.
- "Gate server not reachable" — The phone has no internet. Check the connection and try again; nothing has been recorded.

**If stuck**
1. Pull down or reopen the page if counts look old; lists refresh every 20 seconds.
2. If a screen says "Not available", tap "Gate home" and use a tile meant for your role.

Related pages: /gate/inward-bills, /gate/outward, /gate/visitors, /gate/arrivals, /gate/register, /gate/setup, /gate/history, /gate/qr, /analytics/reports/gate

**Not done yet / watch out**
- In the main sidebar the gate entries are listed for Admin/Owner only; watchmen reach the gate through their own gate shell and landing page.

### Goods coming back in (/gate/arrivals)
Screen address: /gate/arrivals · Roles: WATCHMAN, ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=gate-arrivals

Record our own paper coming back through the gate by scanning its QR: an inter-plant challan, a job-work challan or a returnable gate pass.

Use it when a vehicle brings back goods we sent out on an ERP paper. After recording, the store is told to receive it (inter-plant receipt, job-work return or gate-pass return). Supplier bills go to "Take bill photo" instead.

**Before you start**
- The paper must carry an ERP QR code and belong to this gate's factory.

**Step by step**
1. Tap "Scan the QR on our paper" and point the camera at the QR.
2. Wait for "Checking the paper…"; the card shows the kind, reference, party and any warning.
3. Type "Vehicle number (if any)", e.g. GJ15AB1234.
4. Tap "Record back at the gate".
5. See "Recorded at hh:mm" and "The store has been told to receive it." Tap "Record another" for the next paper.

**What is on the screen**
- **Kind and reference**: Inter-plant challan, job-work challan or gate pass with its number.
- **Vehicle number**: Optional; letters and digits.
- **Recorded back in (today)**: Papers recorded back at this gate today.

**Common problems and fixes**
- "This challan is for <plant>, not this gate." — The inter-plant challan is addressed to another factory. Send the vehicle to the right plant or call the office.
- "Inter-plant challan … is already received here." — It was received before; do not record it again.
- "Gate pass … is non-returnable: nothing is expected back on it." — Nothing should come back on this pass. Ask the store or office what the goods are.
- "This job-work challan belongs to another factory." — Job-work material returns to the factory that sent it.
- "This gate pass is not in the ERP. / This inter-plant challan is not in the ERP." — The QR is not one of our papers. Use "Take bill photo" for a supplier bill.
- "Gate not assigned" — Your account has no plant gate, so the register is locked. An admin or owner assigns the gate in User Management (Gate assignment); then sign in again.

**If stuck**
1. If the QR will not scan, clean the paper or improve light and tap "Scan a different paper".
2. If a warning says the challan was already recorded once, check "Recorded back in" before recording again.

Related pages: /gate, /inventory/gate-passes, /gate/inward-bills

### Goods at the gate (/gate/goods)
Screen address: /gate/goods · Roles: WATCHMAN, ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=gate-goods

Chooser for goods movements: "Goods coming in" (bill photo), "Goods going out" (QR + photos) and, with ?direction=OUTWARD, the typed outward register.

Open it from the "Goods" tab. ?direction=INWARD opens the bill photo screen (typed inward is retired). ?direction=OUTWARD opens the typed outward register: invoice/challan number, vehicle, customer and items, checked against ERP documents.

**Before you start**
- Gate log right (watchman or admin/owner) and an assigned gate.
- Customer and item masters in the ERP for the typed register.

**Step by step**
1. Pick "Goods coming in" → bill photo, or "Goods going out" → scan QR and photograph the papers.
2. Typed outward register: type "Invoice / challan no." from the paper.
3. Type "Vehicle number" from the plate.
4. Choose the customer from the master list (filled in when an ERP document is found).
5. If an ERP document is found, check its items; tick "Counted something different?" to record what you saw.
6. With no document, add items: product, "Quantity", "Unit", optional "Amount ₹".
7. Add "Invoice date" and "Note for owner" if useful, then tap "Save outward entry".

**What is on the screen**
- **Invoice / challan no.**: Required; typed exactly from the paper.
- **Vehicle number**: Required in the typed register; at least 4 characters.
- **Customer**: From the ERP master; "From ERP document" when matched.
- **ERP check**: "Matched", "Owner review" (no document) or "Mismatch".

**Common problems and fixes**
- "Type the invoice number from the paper. / Type the vehicle number from the plate." — A required box is empty or too short.
- "Choose the customer from the master list." — Pick the party from the list; free text is not allowed.
- "No ERP document found" — Save it anyway with the items you see; it is marked for owner review.
- "This invoice or active visitor is already recorded. Refresh the gate register." — The same invoice was saved before. Check Today's register.
- "Gate not assigned" — Your account has no plant gate, so the register is locked. An admin or owner assigns the gate in User Management (Gate assignment); then sign in again.

**If stuck**
1. If masters do not load ("Could not load the master list"), check the connection and reopen.
2. Mistakes after saving are corrected only by the owner in Gate history.

Related pages: /gate, /gate/inward-bills, /gate/outward, /gate/register, /gate/history

**Not done yet / watch out**
- Typed inward entry is retired; ?direction=INWARD always opens the bill photo screen.

### Gate history (/gate/history)
Screen address: /gate/history · Roles: ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=gate-history

Every gate goods movement and visit, checked against ERP documents. Owners link the right ERP document, correct entries with a reason and read the audit trail.

Use it to clear "Owner review" and "Mismatch" entries, fix a watchman's typing mistake, or look up a visitor. Corrections are append-only: the original and your reason are kept.

**Before you start**
- Admin, Owner or Super Admin account (not a watchman).

**Step by step**
1. Pick the tab "Goods" or "Visitors".
2. Filter by search, plant, from/to date (up to 366 days), direction and ERP state ("Matched", "Owner review", "Mismatch").
3. Open a movement to see party, invoice, ERP doc, items observed at gate, "Gate vs ERP" and the audit trail.
4. To match it, tap "Link ERP doc" (or "Re-link ERP"), pick the document and write why.
5. To fix typing, open the correction, change invoice number, vehicle, date or note, and write "Reason for correction" (at least 5 characters).
6. In "Visitors", filter by status (Legacy pending, Inside, Exited, Cancelled) and open a visitor's private photo.

**What is on the screen**
- **ERP state**: "Matched" = ERP document agrees; "Owner review" = no document linked; "Mismatch" = gate observation differs.
- **Gate vs ERP**: Invoice, date and amount side by side.
- **Audit trail**: Every event with time and actor; nothing is deleted.
- **Visitor source**: "QR" (self-registered) or "Walk-in".

**Common problems and fixes**
- "Not available — This page is for administrators and owners." — Watchmen and report delegates cannot open this page. Use the gate terminal or the Gate report.
- "Write why this is being corrected (at least 5 characters)." — Corrections need a reason for the audit trail.
- "Change at least one field to record a correction." — Nothing was changed.
- "Choose an ordered date range of 366 days or fewer." — The from/to dates are reversed or too far apart.

**If stuck**
1. If a movement will not load, close it and open it again from the list.
2. Inward bills (photo) are reviewed in Inventory → Bills & documents, not here.

Related pages: /gate, /gate/register, /analytics/reports/gate, /inventory/gate-bills

### Take bill photo (/gate/inward-bills)
Screen address: /gate/inward-bills · Roles: WATCHMAN, ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=gate-inward-bills

Record goods coming in by photographing the supplier's bill. Nothing is typed and no stock is posted here.

Use it for every supplier vehicle with a bill. The store gets an alert and checks the photos against a new or existing GRN in Inventory → Bills & documents.

**Before you start**
- Watchman or admin/owner account with an assigned gate.
- Camera permission on the phone.

**Step by step**
1. Tap "Take bill photo". Hold the phone flat over the bill; keep all four edges in the photo.
2. Add one photo per page (up to 6 pages).
3. Check the pages; tap a page to see it full size or retake it.
4. Tap "Record arrival · N pages" and wait for upload.
5. See "Arrival recorded" with server time and reference; the store team has been notified.
6. Check "Today's arrivals" for your bills of today.

**What is on the screen**
- **Bill pages**: 1 to 6 photos of one bill.
- **Status**: Where the bill is in store review (pending, partly received…).
- **Ref**: Reference of the arrival record.

**Common problems and fixes**
- "A bill can have at most 6 pages. Extra photos were not added." — Only six pages fit one bill. Record a second arrival for a very long bill.
- "Not available — Bill photos are recorded by the gate watchman or an administrator/owner." — Your role cannot record bill arrivals.
- "Upload stopped / not sure it was saved" — Check "Today's arrivals" first. Sending again uses the same upload and cannot record the bill twice.
- "Gate not assigned" — Your account has no plant gate, so the register is locked. An admin or owner assigns the gate in User Management (Gate assignment); then sign in again.

**If stuck**
1. If the camera does not open, allow camera permission in the phone settings.
2. "This bill was already saved — it was not recorded twice." means the retry was safe.

Related pages: /gate, /inventory/gate-bills, /gate/goods

### Record outward (/gate/outward)
Screen address: /gate/outward · Roles: WATCHMAN, ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=gate-outward

Record goods leaving: scan the ERP QR on each paper (optional), photograph every paper going with the goods, and note the vehicle.

Use it at the gate for every departure (dispatch slip, invoice, challan, gate pass). Scanned QR codes link the departure to the ERP document; without a QR the office matches it from the photos. The QR sticker is printed in Dispatch Bay.

**Before you start**
- Watchman or admin/owner account with an assigned gate.

**Step by step**
1. Check the factory at the top (it locks once you scan or photograph).
2. Step 1: tap "Scan QR" and scan each paper (up to 10 codes); tap "Scan another QR". If no paper has a QR tap "No QR".
3. Step 2: tap "Photograph paper" for every page (up to 6).
4. Type the vehicle number (or tap a recent vehicle). It is optional but helps the office.
5. Tap "Record outward · N pages".
6. See "Outward recorded": status "Matched to ERP" or "Office will match". Leaving time is fixed by the server.

**What is on the screen**
- **Scanned codes**: Each code shows recognised, "Not recognised" or "Not checked yet" (checked later by the office).
- **Paper pages**: Photos of every paper leaving with the goods.
- **Vehicle number**: Letters and digits only, e.g. GJ15AB1234.
- **Left today**: Departures you recorded today.

**Common problems and fixes**
- "This code is not an ERP document code." — The QR is not from our ERP. Remove it; the photos are still enough.
- "Could not check now. It is still sent with the photos and checked by the office." — Weak network; you can still record.
- "At most 10 codes per departure. / One departure can have at most 6 pages." — Limits per departure. Record a second departure for extra papers.
- "Use letters and digits only, for example GJ15AB1234." — Remove spaces and symbols from the vehicle number.
- "Gate not assigned" — Your account has no plant gate, so the register is locked. An admin or owner assigns the gate in User Management (Gate assignment); then sign in again.

**If stuck**
1. If unsure whether it saved, check "Left today" first; sending again cannot record it twice.
2. Ask dispatch to stick the QR sticker on the slip or Tally bill so the gate can scan it.

Related pages: /gate, /logistics/dispatch, /gate/goods

### Visitor QR poster (/gate/qr)
Screen address: /gate/qr · Roles: ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=gate-qr

Print the A4 poster with the factory gate's own visitor QR. Visitors scan it, fill the form, and their entry is recorded.

Use it when setting up a gate or after replacing the QR in Gate setup. Each plant has its own link.

**Before you start**
- Admin or owner account; the plant exists in the plant master.

**Step by step**
1. Choose the plant.
2. Tick "Centre logo" if you want the logo inside the QR.
3. Press "Print" for the A4 poster, or "SVG" to download the QR image.
4. Fix the poster at the gate at eye level.

**What is on the screen**
- **Poster text**: "Visitor? Scan to register" with steps Scan → Submit → Exit (the watchman checks you out).

**Common problems and fixes**
- "Not available — This page is for administrators and owners." — Watchmen and report delegates cannot open this page. Use the gate terminal or the Gate report.
- "This gate QR has not been configured." — The plant has no visitor link yet. Open Gate setup for that plant.

**If stuck**
1. If the QR does not load, press the retry button on the page.
2. After "Replace QR" in Gate setup, print and fix the new poster; the old one stops working.

Related pages: /gate/setup, /visit/[token], /gate/visitors

### Today's register (/gate/register)
Screen address: /gate/register · Roles: WATCHMAN, ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=gate-register

The paper-style goods register for today at this gate: every inward and outward vehicle saved, with server time.

Use it to check what was recorded today or before re-entering something. Entries cannot be edited here; the owner corrects mistakes with a reason in Gate history.

**Before you start**
- Gate log right and an assigned gate.

**Step by step**
1. Pick "All", "Inward" or "Outward".
2. Read each row: time, invoice, party, vehicle, product, qty, unit, amount and ERP state.
3. Report any mistake to the owner.

**What is on the screen**
- **ERP**: "Matched", "Owner review" or "Mismatch".

**Common problems and fixes**
- "Could not load today's register. It refreshes automatically." — Network problem; wait or reopen.
- "No entries yet today" — Nothing saved today in this filter.
- "Gate not assigned" — Your account has no plant gate, so the register is locked. An admin or owner assigns the gate in User Management (Gate assignment); then sign in again.

**If stuck**
1. Bill-photo arrivals show under "Today's arrivals" on Take bill photo; photo departures under "Left today" on Record outward.

Related pages: /gate, /gate/history, /gate/goods

**Not done yet / watch out**
- Today's register shows typed entries; bill-photo arrivals and photo departures are listed on their own screens ("Today's arrivals", "Left today").

### Gate setup (/gate/setup)
Screen address: /gate/setup · Roles: ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=gate-setup

Step-by-step setup of a factory gate: choose the factory, print its visitor QR, give a watchman this gate, and links for daily use.

Use it once per plant and whenever a new watchman joins or the visitor QR is misused. Gates follow the plant master.

**Before you start**
- Admin or owner account; plants exist in Plants (plant master).

**Step by step**
1. Step 1 "Choose the factory".
2. Step 2: check the "Visitor link" and press "Open & print QR poster".
3. Step 3 "Give a watchman this gate": in Users set the role to Watchman and tick this factory under Gate assignment ("Users" or "New user").
4. Step 4 "Daily use": links to gate terminal, inward bill, inventory bill queue, visitors, register, history, report and daily report pack.
5. If a photo of the QR is misused, open "Replace visitor QR", write a reason and press "Replace QR"; then print the new poster.

**What is on the screen**
- **Visitor link**: The public URL inside the QR for this plant.
- **Replace visitor QR**: Issues a new QR; the old link stops working. Reason goes to the gate audit trail.
- **How an inward bill reaches stock**: Watchman captures the bill → inventory checks it against a GRN → stays pending or partly received until every line is confirmed or resolved with a reason.

**Common problems and fixes**
- "Not available — This page is for administrators and owners." — Watchmen and report delegates cannot open this page. Use the gate terminal or the Gate report.
- "The QR could not be replaced." — The server refused the change; check the reason and try again.
- "Could not load the QR link — open the poster to retry." — Network or configuration issue for this plant.

**If stuck**
1. A watchman who sees "Gate not assigned" needs this factory ticked under Gate assignment and must sign in again.
2. To add or rename a factory, edit it in Plants; its gate and QR come with it.

Related pages: /gate/qr, /factory/plants, /system/users, /system/users/new, /inventory/gate-bills, /analytics/reports/gate, /system/report-center

### Inside now (visitors) (/gate/visitors)
Screen address: /gate/visitors · Roles: WATCHMAN, ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=gate-visitors

The list of visitors inside the factory. Visitors record their own entry by QR; the watchman checks them out when they leave.

Keep it open at the gate. When a visitor leaves, find the card and press "Check out". Admins and owners also see "Legacy pending registrations" to record or remove.

**Before you start**
- Visitor QR poster fixed at the gate; gate log right and an assigned gate.

**Step by step**
1. Search by name, mobile or company if the list is long.
2. Match the face with the visitor photo on the card.
3. Press "Check out" and confirm "Check out visitor?".
4. See "Checked out at hh:mm" (server time).
5. Owner only: for a legacy pending card press "Record entry" if they came in, or "Remove" with a reason (Visitor left, Entry declined, Duplicate / mistaken registration, Visit cancelled).

**What is on the screen**
- **Inside since / time inside**: Entry time and how long they have been inside.
- **Overdue**: Inside more than 12 hours.

**Common problems and fixes**
- "No visitors inside" — Visitors appear as soon as they submit the gate QR form.
- "This account cannot record visitor exits." — Your role has no gate log right.
- "Visitors record entry themselves using the factory QR code." — The watchman cannot record entry; ask the visitor to scan the poster.
- "Gate not assigned" — Your account has no plant gate, so the register is locked. An admin or owner assigns the gate in User Management (Gate assignment); then sign in again.

**If stuck**
1. A visitor without a smartphone: an owner can register them on "Walk-in visitor".
2. If check-out failed, retry; the same action cannot be recorded twice.

Related pages: /gate, /gate/visitors/new, /gate/qr, /gate/history

**Not done yet / watch out**
- Watchmen cannot record a visitor's entry; a visitor without a smartphone needs an owner to register a walk-in.

### Walk-in visitor (/gate/visitors/new)
Screen address: /gate/visitors/new · Roles: ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=gate-visitors-new

Owner-only form to register a visitor who cannot use the QR (no smartphone). Entry is stamped later with "Record entry".

Normal visitors use the gate QR themselves; watchmen only confirm exit. Use this page as the exception.

**Before you start**
- Admin or owner account and an active gate plant.

**Step by step**
1. Fill "Visitor name" and "Mobile number" (10 digits).
2. Choose "Purpose" (Meeting, Delivery, Collection, Service / maintenance, Interview, Official visit, Other).
3. Optional: "Company", "Government ID" (None, Aadhaar, PAN, Other) and "Visitor photo".
4. Tick consent and press "Register visitor".
5. When they actually come in, open "Visitor queue" and press "Record entry" on their card.

**What is on the screen**
- **Government ID**: Optional. Aadhaar must be 12 digits.
- **Consent**: Required: the visitor agrees to the details and photo being recorded for gate security.

**Common problems and fixes**
- "Not available — This page is for administrators and owners." — Watchmen and report delegates cannot open this page. Use the gate terminal or the Gate report.
- "Enter a 10-digit mobile number." — The mobile number is incomplete.
- "Aadhaar has 12 digits." — Fix the ID number or choose None.
- "Consent is needed to record the visit." — Tick the consent box.
- "Optional government ID storage is temporarily unavailable. Please omit the ID number and retry." — Choose None for the ID and send again.

**If stuck**
1. Press "Another walk-in" for the next person.

Related pages: /gate/visitors, /gate/history

### Visitor registration (no gate link) (/visit)
Screen address: /visit · Roles: - · Share link: https://erp.totalpolyprint.com/guide?page=visit

Public page reached without a gate code. It only says "Scan the gate QR code": the link is incomplete.

A visitor lands here if they typed the address by hand or the QR was cut. The real form opens only from the gate poster QR (/visit/<code>).

**Before you start**
- None; no login.

**Step by step**
1. Rescan the QR code on the poster at the factory gate.
2. If there is no poster, ask the watchman for the correct gate QR.

**Common problems and fixes**
- "Scan the gate QR code" — This link is incomplete; it has no gate code.

**If stuck**
1. Use the phone camera on the poster; do not type the address.

Related pages: /visit/[token], /gate/qr

### Register your visit (/visit/[token])
Screen address: /visit/[token] · Roles: - · Share link: https://erp.totalpolyprint.com/guide?page=visit-token

Public visitor form opened from the gate QR poster. The visitor fills it on their own phone and their entry is recorded at once.

Every visitor uses it on arrival. No login. The watchman sees them under "Visitors inside" and checks them out when they leave.

**Before you start**
- A valid gate QR (the poster at the gate). Internet on the visitor's phone.

**Step by step**
1. Scan the QR on the gate poster; the page shows the company and "<plant> · Visitor gate".
2. Fill "Your name" and "Mobile number".
3. Choose "Purpose" (e.g. Meeting, Delivery, Collection, Service / maintenance, Interview, Official visit, Other).
4. Optional: "Company", "Government ID" and a "Selfie" (helps the watchman recognise you).
5. Tick the consent box and press "Record my entry".
6. Show the "Entry recorded" screen (reference and entry time) to the watchman.

**What is on the screen**
- **Purpose**: Required; the reason for the visit.
- **Government ID**: Optional: None, Aadhaar (12 digits), PAN or Other.
- **Reference / Entry time**: Shown after saving; keep the screen open for the watchman.

**Common problems and fixes**
- "Gate link not available — This visitor QR is unavailable. Please ask the watchman." — The QR is old (replaced) or wrong. Scan the poster fixed at the gate, or ask the watchman.
- "Enter a 10-digit mobile number." — Type your 10-digit Indian mobile number.
- "Consent is needed to record the visit." — Tick the consent box to continue.
- "Selfie must be 3 MB or smaller. / Use a clear JPEG, PNG or WebP selfie." — Retake the selfie with the in-page camera.
- "Camera permission was blocked." — Allow the camera in the browser, or use the phone camera app to pick a photo.

**If stuck**
1. If sending fails, press the button again: a retry cannot create a second registration.
2. "This registration was already recorded — no duplicate was created." means you are already in.

Related pages: /gate/visitors, /gate/qr

## हर स्क्रीन (हिंदी)

### Gate register (गेट होम) (/gate)
स्क्रीन का पता: /gate · भूमिकाएँ: WATCHMAN, ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=gate&lang=hi

वॉचमैन के फ़ोन की होम स्क्रीन: अंदर आने वाले माल (बिल फ़ोटो), बाहर जाने वाले माल, अंदर बैठे विज़िटर, वापस आने वाले माल और आज के रजिस्टर की बड़ी टाइलें।

ड्यूटी की शुरुआत में खोलें और हर एंट्री के बाद यहीं लौटें। हर टाइल एक काम खोलती है। एडमिन और ओनर को "Gate oversight" (setup, history, visitor QR, report) भी दिखता है।

**शुरू करने से पहले**
- Watchman रोल (या एडमिन/ओनर) और अकाउंट पर प्लांट गेट असाइन हो।
- फ़ोन में इंटरनेट।

**स्टेप बाय स्टेप**
1. ऊपर तारीख और "Namaste, <नाम>" देखें; एक से ज़्यादा प्लांट हों तो हेडर से गेट प्लांट बदलें।
2. बिल के साथ माल आए: "Take bill photo" (Record inward) दबाएँ।
3. माल बाहर जाए: "Outward" (scan QR · photo) दबाएँ।
4. विज़िटर जा रहा हो: "Visitors inside" दबाकर चेक-आउट करें।
5. हमारा अपना चालान या गेट पास वापस आए: "Goods coming back" दबाएँ।
6. नीचे की पट्टी (Gate · Goods · Visitors · Today) से सेक्शन बदलें।

**स्क्रीन पर क्या है**
- **Visitors inside / Overdue >12h**: अभी अंदर लोग और जो 12 घंटे से ज़्यादा अंदर हैं (लाल, चमकता)।
- **Inside longest**: अंदर के विज़िटर, सबसे पुराने पहले; जाते समय चेक-आउट करें।
- **Outward टाइल**: आज दर्ज हुई रवानगी की गिनती।
- **Gate oversight (Admin · Owner)**: "Gate setup", "Gate history", "Visitor QR", "Gate report" के लिंक।

**आम दिक्कतें और हल**
- "No gate access" — अकाउंट गेट टर्मिनल के लिए सेट नहीं है। एडमिन या ओनर से Watchman रोल या गेट एक्सेस माँगें।
- "Gate not assigned" — आपके अकाउंट को कोई प्लांट गेट नहीं मिला, इसलिए रजिस्टर बंद है। एडमिन या ओनर User Management (Gate assignment) में गेट दें; फिर दोबारा लॉगिन करें।
- "Gate server not reachable" — फ़ोन में इंटरनेट नहीं है। नेटवर्क देखकर फिर कोशिश करें; कुछ दर्ज नहीं हुआ।

**अटक गए तो**
1. गिनती पुरानी लगे तो पेज फिर से खोलें; लिस्ट हर 20 सेकंड में रिफ़्रेश होती है।
2. "Not available" दिखे तो "Gate home" दबाएँ और अपने रोल वाली टाइल इस्तेमाल करें।

जुड़े पेज: /gate/inward-bills, /gate/outward, /gate/visitors, /gate/arrivals, /gate/register, /gate/setup, /gate/history, /gate/qr, /analytics/reports/gate

**अभी नहीं होता / ध्यान दें**
- मुख्य साइडबार में गेट की एंट्री सिर्फ़ Admin/Owner के लिए हैं; वॉचमैन अपने गेट शेल और लैंडिंग पेज से गेट पहुँचते हैं।

### Goods coming back in (हमारा माल वापस) (/gate/arrivals)
स्क्रीन का पता: /gate/arrivals · भूमिकाएँ: WATCHMAN, ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=gate-arrivals&lang=hi

हमारा अपना कागज़ वापस आने पर उसका QR स्कैन करके गेट पर दर्ज करें: इंटर-प्लांट चालान, जॉब-वर्क चालान या returnable गेट पास।

जब कोई गाड़ी वो माल लौटाए जो हमने ERP कागज़ पर भेजा था। दर्ज करने के बाद स्टोर को रिसीव करने की सूचना जाती है (इंटर-प्लांट रसीद, जॉब-वर्क वापसी या गेट-पास वापसी)। सप्लायर का बिल हो तो "Take bill photo" इस्तेमाल करें।

**शुरू करने से पहले**
- कागज़ पर ERP QR हो और वो इसी गेट की फ़ैक्टरी का हो।

**स्टेप बाय स्टेप**
1. "Scan the QR on our paper" दबाएँ और कैमरा QR पर रखें।
2. "Checking the paper…" के बाद कार्ड पर प्रकार, रेफ़रेंस, पार्टी और कोई चेतावनी दिखेगी।
3. "Vehicle number (if any)" लिखें, जैसे GJ15AB1234।
4. "Record back at the gate" दबाएँ।
5. "Recorded at hh:mm" और "The store has been told to receive it." देखें। अगले कागज़ के लिए "Record another" दबाएँ।

**स्क्रीन पर क्या है**
- **प्रकार और रेफ़रेंस**: इंटर-प्लांट चालान, जॉब-वर्क चालान या गेट पास, नंबर के साथ।
- **Vehicle number**: वैकल्पिक; अक्षर और अंक।
- **Recorded back in (आज)**: आज इस गेट पर वापस दर्ज हुए कागज़।

**आम दिक्कतें और हल**
- "This challan is for <plant>, not this gate." — इंटर-प्लांट चालान दूसरी फ़ैक्टरी के लिए है। गाड़ी सही प्लांट भेजें या ऑफ़िस को फ़ोन करें।
- "Inter-plant challan … is already received here." — पहले ही रिसीव हो चुका है; फिर से दर्ज न करें।
- "Gate pass … is non-returnable: nothing is expected back on it." — इस पास पर कुछ वापस नहीं आना था। स्टोर या ऑफ़िस से पूछें माल क्या है।
- "This job-work challan belongs to another factory." — जॉब-वर्क का माल उसी फ़ैक्टरी में लौटता है जिसने भेजा था।
- "This gate pass is not in the ERP. / This inter-plant challan is not in the ERP." — QR हमारा कागज़ नहीं है। सप्लायर बिल हो तो "Take bill photo" इस्तेमाल करें।
- "Gate not assigned" — आपके अकाउंट को कोई प्लांट गेट नहीं मिला, इसलिए रजिस्टर बंद है। एडमिन या ओनर User Management (Gate assignment) में गेट दें; फिर दोबारा लॉगिन करें।

**अटक गए तो**
1. QR स्कैन न हो तो कागज़ साफ़ करें या रोशनी बढ़ाएँ और "Scan a different paper" दबाएँ।
2. चेतावनी कहे कि चालान एक बार दर्ज हो चुका है तो दोबारा दर्ज करने से पहले "Recorded back in" देखें।

जुड़े पेज: /gate, /inventory/gate-passes, /gate/inward-bills

### Goods at the gate (गेट पर माल) (/gate/goods)
स्क्रीन का पता: /gate/goods · भूमिकाएँ: WATCHMAN, ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=gate-goods&lang=hi

माल की आवाजाही चुनने की स्क्रीन: "Goods coming in" (बिल फ़ोटो), "Goods going out" (QR + फ़ोटो), और ?direction=OUTWARD पर टाइप वाला outward रजिस्टर।

"Goods" टैब से खोलें। ?direction=INWARD बिल फ़ोटो स्क्रीन खोलता है (टाइप वाला inward बंद है)। ?direction=OUTWARD टाइप वाला outward रजिस्टर खोलता है: इनवॉइस/चालान नंबर, गाड़ी, ग्राहक और आइटम, ERP दस्तावेज़ से मिलाए जाते हैं।

**शुरू करने से पहले**
- गेट लॉग का अधिकार (वॉचमैन या एडमिन/ओनर) और असाइन गेट।
- टाइप रजिस्टर के लिए ERP में ग्राहक और आइटम मास्टर।

**स्टेप बाय स्टेप**
1. "Goods coming in" → बिल फ़ोटो, या "Goods going out" → QR स्कैन और कागज़ों की फ़ोटो चुनें।
2. टाइप outward रजिस्टर: कागज़ से "Invoice / challan no." लिखें।
3. प्लेट से "Vehicle number" लिखें।
4. मास्टर लिस्ट से ग्राहक चुनें (ERP दस्तावेज़ मिले तो अपने-आप भरता है)।
5. ERP दस्तावेज़ मिले तो उसके आइटम देखें; जो देखा वो अलग हो तो "Counted something different?" टिक करें।
6. दस्तावेज़ न हो तो आइटम जोड़ें: प्रोडक्ट, "Quantity", "Unit", वैकल्पिक "Amount ₹"।
7. ज़रूरत हो तो "Invoice date" और "Note for owner" भरें, फिर "Save outward entry" दबाएँ।

**स्क्रीन पर क्या है**
- **Invoice / challan no.**: ज़रूरी; कागज़ से हूबहू लिखें।
- **Vehicle number**: टाइप रजिस्टर में ज़रूरी; कम से कम 4 अक्षर।
- **Customer**: ERP मास्टर से; मिलान होने पर "From ERP document"।
- **ERP check**: "Matched", "Owner review" (दस्तावेज़ नहीं) या "Mismatch"।

**आम दिक्कतें और हल**
- "Type the invoice number from the paper. / Type the vehicle number from the plate." — ज़रूरी खाना खाली है या बहुत छोटा है।
- "Choose the customer from the master list." — लिस्ट से पार्टी चुनें; खुद से लिखा नाम नहीं चलता।
- "No ERP document found" — फिर भी देखे गए आइटम के साथ सेव करें; ये ओनर रिव्यू में जाएगा।
- "This invoice or active visitor is already recorded. Refresh the gate register." — यही इनवॉइस पहले सेव हो चुका है। Today's register देखें।
- "Gate not assigned" — आपके अकाउंट को कोई प्लांट गेट नहीं मिला, इसलिए रजिस्टर बंद है। एडमिन या ओनर User Management (Gate assignment) में गेट दें; फिर दोबारा लॉगिन करें।

**अटक गए तो**
1. मास्टर लोड न हों ("Could not load the master list") तो नेटवर्क देखकर फिर खोलें।
2. सेव के बाद की गलती सिर्फ़ ओनर Gate history में सुधारता है।

जुड़े पेज: /gate, /gate/inward-bills, /gate/outward, /gate/register, /gate/history

**अभी नहीं होता / ध्यान दें**
- टाइप वाला inward बंद है; ?direction=INWARD हमेशा बिल फ़ोटो स्क्रीन खोलता है।

### Gate history (गेट इतिहास) (/gate/history)
स्क्रीन का पता: /gate/history · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=gate-history&lang=hi

गेट की हर माल आवाजाही और हर विज़िट, ERP दस्तावेज़ से जाँची हुई। ओनर सही ERP दस्तावेज़ जोड़ते हैं, कारण के साथ एंट्री सुधारते हैं और ऑडिट ट्रेल देखते हैं।

"Owner review" और "Mismatch" एंट्री साफ़ करने, वॉचमैन की टाइपिंग गलती सुधारने या किसी विज़िटर को ढूँढने के लिए। सुधार सिर्फ़ जुड़ते हैं: असली एंट्री और आपका कारण दोनों रहते हैं।

**शुरू करने से पहले**
- Admin, Owner या Super Admin अकाउंट (वॉचमैन नहीं)।

**स्टेप बाय स्टेप**
1. टैब "Goods" या "Visitors" चुनें।
2. search, प्लांट, तारीख से/तक (366 दिन तक), दिशा और ERP स्टेट ("Matched", "Owner review", "Mismatch") से फ़िल्टर करें।
3. कोई एंट्री खोलें: पार्टी, इनवॉइस, ERP doc, गेट पर देखे आइटम, "Gate vs ERP" और ऑडिट ट्रेल।
4. मिलान के लिए "Link ERP doc" (या "Re-link ERP") दबाएँ, दस्तावेज़ चुनें और कारण लिखें।
5. टाइपिंग सुधारने के लिए correction खोलें, इनवॉइस नंबर, गाड़ी, तारीख या नोट बदलें, और "Reason for correction" लिखें (कम से कम 5 अक्षर)।
6. "Visitors" में स्टेटस (Legacy pending, Inside, Exited, Cancelled) से फ़िल्टर करें और विज़िटर की निजी फ़ोटो खोलें।

**स्क्रीन पर क्या है**
- **ERP state**: "Matched" = ERP दस्तावेज़ मेल खाता है; "Owner review" = कोई दस्तावेज़ नहीं जुड़ा; "Mismatch" = गेट पर देखा अलग है।
- **Gate vs ERP**: इनवॉइस, तारीख और रकम आमने-सामने।
- **Audit trail**: हर घटना समय और व्यक्ति के साथ; कुछ मिटता नहीं।
- **Visitor source**: "QR" (खुद रजिस्टर) या "Walk-in"।

**आम दिक्कतें और हल**
- "Not available — This page is for administrators and owners." — वॉचमैन और रिपोर्ट वाले यह पेज नहीं खोल सकते। गेट टर्मिनल या Gate report इस्तेमाल करें।
- "Write why this is being corrected (at least 5 characters)." — ऑडिट ट्रेल के लिए सुधार का कारण चाहिए।
- "Change at least one field to record a correction." — कुछ भी नहीं बदला गया।
- "Choose an ordered date range of 366 days or fewer." — तारीखें उल्टी हैं या बहुत दूर हैं।

**अटक गए तो**
1. कोई एंट्री न खुले तो बंद करके लिस्ट से फिर खोलें।
2. इनवर्ड बिल (फ़ोटो) Inventory → Bills & documents में देखे जाते हैं, यहाँ नहीं।

जुड़े पेज: /gate, /gate/register, /analytics/reports/gate, /inventory/gate-bills

### Take bill photo (बिल की फ़ोटो) (/gate/inward-bills)
स्क्रीन का पता: /gate/inward-bills · भूमिकाएँ: WATCHMAN, ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=gate-inward-bills&lang=hi

सप्लायर के बिल की फ़ोटो लेकर अंदर आए माल को दर्ज करें। कुछ टाइप नहीं करना और यहाँ स्टॉक नहीं चढ़ता।

हर सप्लायर गाड़ी के बिल के लिए। स्टोर को सूचना जाती है और वो Inventory → Bills & documents में फ़ोटो को नए या पुराने GRN से मिलाता है।

**शुरू करने से पहले**
- असाइन गेट वाला वॉचमैन या एडमिन/ओनर अकाउंट।
- फ़ोन पर कैमरा की अनुमति।

**स्टेप बाय स्टेप**
1. "Take bill photo" दबाएँ। फ़ोन बिल के ऊपर सीधा रखें; चारों किनारे फ़ोटो में आएँ।
2. हर पेज की एक फ़ोटो लें (6 पेज तक)।
3. पेज देखें; बड़ा देखने या दोबारा लेने के लिए पेज पर टैप करें।
4. "Record arrival · N pages" दबाएँ और अपलोड होने दें।
5. "Arrival recorded" समय और रेफ़रेंस के साथ दिखेगा; स्टोर को सूचना चली गई।
6. आज के अपने बिल "Today's arrivals" में देखें।

**स्क्रीन पर क्या है**
- **Bill pages**: एक बिल की 1 से 6 फ़ोटो।
- **Status**: स्टोर रिव्यू में बिल कहाँ है (pending, partly received…)।
- **Ref**: आगमन रिकॉर्ड का रेफ़रेंस।

**आम दिक्कतें और हल**
- "A bill can have at most 6 pages. Extra photos were not added." — एक बिल में छह पेज ही आते हैं। बहुत लंबा बिल हो तो दूसरा आगमन दर्ज करें।
- "Not available — Bill photos are recorded by the gate watchman or an administrator/owner." — आपका रोल बिल आगमन दर्ज नहीं कर सकता।
- "अपलोड रुका / पता नहीं सेव हुआ या नहीं" — पहले "Today's arrivals" देखें। फिर से भेजने पर वही अपलोड जाता है, बिल दो बार दर्ज नहीं होता।
- "Gate not assigned" — आपके अकाउंट को कोई प्लांट गेट नहीं मिला, इसलिए रजिस्टर बंद है। एडमिन या ओनर User Management (Gate assignment) में गेट दें; फिर दोबारा लॉगिन करें।

**अटक गए तो**
1. कैमरा न खुले तो फ़ोन सेटिंग में कैमरा की अनुमति दें।
2. "This bill was already saved — it was not recorded twice." का मतलब दोबारा भेजना सुरक्षित रहा।

जुड़े पेज: /gate, /inventory/gate-bills, /gate/goods

### Record outward (बाहर जाता माल) (/gate/outward)
स्क्रीन का पता: /gate/outward · भूमिकाएँ: WATCHMAN, ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=gate-outward&lang=hi

बाहर जाते माल को दर्ज करें: हर कागज़ का ERP QR स्कैन करें (वैकल्पिक), माल के साथ जाने वाले हर कागज़ की फ़ोटो लें, और गाड़ी नोट करें।

हर रवानगी पर (डिस्पैच स्लिप, इनवॉइस, चालान, गेट पास)। स्कैन किया QR रवानगी को ERP दस्तावेज़ से जोड़ता है; QR न हो तो ऑफ़िस फ़ोटो से मिलाता है। QR स्टिकर Dispatch Bay में छपता है।

**शुरू करने से पहले**
- असाइन गेट वाला वॉचमैन या एडमिन/ओनर अकाउंट।

**स्टेप बाय स्टेप**
1. ऊपर फ़ैक्टरी देखें (स्कैन या फ़ोटो के बाद बदल नहीं सकते)।
2. स्टेप 1: "Scan QR" दबाएँ और हर कागज़ स्कैन करें (10 कोड तक); "Scan another QR" दबाएँ। किसी कागज़ पर QR न हो तो "No QR" दबाएँ।
3. स्टेप 2: हर पेज के लिए "Photograph paper" दबाएँ (6 तक)।
4. गाड़ी नंबर लिखें (या हाल की गाड़ी दबाएँ)। वैकल्पिक है पर ऑफ़िस को मदद मिलती है।
5. "Record outward · N pages" दबाएँ।
6. "Outward recorded" देखें: स्टेटस "Matched to ERP" या "Office will match"। निकलने का समय सर्वर तय करता है।

**स्क्रीन पर क्या है**
- **स्कैन किए कोड**: हर कोड पर recognised, "Not recognised" या "Not checked yet" (बाद में ऑफ़िस जाँचेगा)।
- **Paper pages**: माल के साथ जाने वाले हर कागज़ की फ़ोटो।
- **Vehicle number**: सिर्फ़ अक्षर और अंक, जैसे GJ15AB1234।
- **Left today**: आज आपने दर्ज की रवानगी।

**आम दिक्कतें और हल**
- "This code is not an ERP document code." — QR हमारे ERP का नहीं है। उसे हटाएँ; फ़ोटो काफ़ी हैं।
- "Could not check now. It is still sent with the photos and checked by the office." — नेटवर्क कमज़ोर है; फिर भी दर्ज कर सकते हैं।
- "At most 10 codes per departure. / One departure can have at most 6 pages." — एक रवानगी की सीमा। ज़्यादा कागज़ हों तो दूसरी रवानगी दर्ज करें।
- "Use letters and digits only, for example GJ15AB1234." — गाड़ी नंबर से स्पेस और चिन्ह हटाएँ।
- "Gate not assigned" — आपके अकाउंट को कोई प्लांट गेट नहीं मिला, इसलिए रजिस्टर बंद है। एडमिन या ओनर User Management (Gate assignment) में गेट दें; फिर दोबारा लॉगिन करें।

**अटक गए तो**
1. सेव हुआ या नहीं पता न हो तो पहले "Left today" देखें; दोबारा भेजने से दो बार दर्ज नहीं होगा।
2. डिस्पैच से कहें कि स्लिप या Tally बिल पर QR स्टिकर लगाएँ ताकि गेट स्कैन कर सके।

जुड़े पेज: /gate, /logistics/dispatch, /gate/goods

### Visitor QR poster (विज़िटर QR पोस्टर) (/gate/qr)
स्क्रीन का पता: /gate/qr · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=gate-qr&lang=hi

फ़ैक्टरी गेट के अपने विज़िटर QR वाला A4 पोस्टर प्रिंट करें। विज़िटर स्कैन करके फ़ॉर्म भरते हैं और उनकी एंट्री दर्ज हो जाती है।

गेट सेट करते समय या Gate setup में QR बदलने के बाद। हर प्लांट का अपना लिंक है।

**शुरू करने से पहले**
- एडमिन या ओनर अकाउंट; प्लांट, प्लांट मास्टर में हो।

**स्टेप बाय स्टेप**
1. प्लांट चुनें।
2. QR के बीच लोगो चाहिए तो "Centre logo" टिक करें।
3. A4 पोस्टर के लिए "Print" दबाएँ, या QR इमेज के लिए "SVG"।
4. पोस्टर गेट पर आँख की ऊँचाई पर लगाएँ।

**स्क्रीन पर क्या है**
- **पोस्टर का टेक्स्ट**: "Visitor? Scan to register" और कदम Scan → Submit → Exit (वॉचमैन चेक-आउट करता है)।

**आम दिक्कतें और हल**
- "Not available — This page is for administrators and owners." — वॉचमैन और रिपोर्ट वाले यह पेज नहीं खोल सकते। गेट टर्मिनल या Gate report इस्तेमाल करें।
- "This gate QR has not been configured." — प्लांट का विज़िटर लिंक अभी नहीं बना। उस प्लांट के लिए Gate setup खोलें।

**अटक गए तो**
1. QR लोड न हो तो पेज पर retry दबाएँ।
2. Gate setup में "Replace QR" के बाद नया पोस्टर प्रिंट करके लगाएँ; पुराना काम नहीं करेगा।

जुड़े पेज: /gate/setup, /visit/[token], /gate/visitors

### Today's register (आज का रजिस्टर) (/gate/register)
स्क्रीन का पता: /gate/register · भूमिकाएँ: WATCHMAN, ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=gate-register&lang=hi

इस गेट का आज का कागज़ जैसा माल रजिस्टर: सेव हुई हर अंदर और बाहर की गाड़ी, सर्वर समय के साथ।

आज क्या दर्ज हुआ जाँचने या कुछ दोबारा दर्ज करने से पहले देखें। यहाँ एंट्री बदली नहीं जाती; ओनर Gate history में कारण के साथ सुधारता है।

**शुरू करने से पहले**
- गेट लॉग का अधिकार और असाइन गेट।

**स्टेप बाय स्टेप**
1. "All", "Inward" या "Outward" चुनें।
2. हर पंक्ति पढ़ें: समय, इनवॉइस, पार्टी, गाड़ी, प्रोडक्ट, मात्रा, यूनिट, रकम और ERP स्टेट।
3. कोई गलती हो तो ओनर को बताएँ।

**स्क्रीन पर क्या है**
- **ERP**: "Matched", "Owner review" या "Mismatch"।

**आम दिक्कतें और हल**
- "Could not load today's register. It refreshes automatically." — नेटवर्क की दिक्कत; रुकें या फिर खोलें।
- "No entries yet today" — इस फ़िल्टर में आज कुछ सेव नहीं हुआ।
- "Gate not assigned" — आपके अकाउंट को कोई प्लांट गेट नहीं मिला, इसलिए रजिस्टर बंद है। एडमिन या ओनर User Management (Gate assignment) में गेट दें; फिर दोबारा लॉगिन करें।

**अटक गए तो**
1. बिल-फ़ोटो आगमन "Take bill photo" के "Today's arrivals" में और फ़ोटो रवानगी "Record outward" के "Left today" में दिखती है।

जुड़े पेज: /gate, /gate/history, /gate/goods

**अभी नहीं होता / ध्यान दें**
- Today's register में टाइप एंट्री दिखती हैं; बिल-फ़ोटो आगमन और फ़ोटो रवानगी अपनी स्क्रीन पर ("Today's arrivals", "Left today") दिखते हैं।

### Gate setup (गेट सेटअप) (/gate/setup)
स्क्रीन का पता: /gate/setup · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=gate-setup&lang=hi

फ़ैक्टरी गेट का कदम-दर-कदम सेटअप: फ़ैक्टरी चुनें, उसका विज़िटर QR प्रिंट करें, वॉचमैन को यह गेट दें, और रोज़ के काम के लिंक।

हर प्लांट के लिए एक बार, और जब नया वॉचमैन आए या विज़िटर QR का गलत इस्तेमाल हो। गेट प्लांट मास्टर के अनुसार चलते हैं।

**शुरू करने से पहले**
- एडमिन या ओनर अकाउंट; Plants (प्लांट मास्टर) में प्लांट हों।

**स्टेप बाय स्टेप**
1. स्टेप 1 "Choose the factory"।
2. स्टेप 2: "Visitor link" देखें और "Open & print QR poster" दबाएँ।
3. स्टेप 3 "Give a watchman this gate": Users में रोल Watchman करें और Gate assignment में यह फ़ैक्टरी टिक करें ("Users" या "New user")।
4. स्टेप 4 "Daily use": गेट टर्मिनल, इनवर्ड बिल, इन्वेंटरी बिल कतार, विज़िटर, रजिस्टर, इतिहास, रिपोर्ट और डेली रिपोर्ट पैक के लिंक।
5. QR की फ़ोटो का गलत इस्तेमाल हो तो "Replace visitor QR" खोलें, कारण लिखें और "Replace QR" दबाएँ; फिर नया पोस्टर प्रिंट करें।

**स्क्रीन पर क्या है**
- **Visitor link**: इस प्लांट के QR में छिपा सार्वजनिक लिंक।
- **Replace visitor QR**: नया QR जारी करता है; पुराना लिंक बंद हो जाता है। कारण गेट ऑडिट ट्रेल में जाता है।
- **How an inward bill reaches stock**: वॉचमैन बिल लेता है → इन्वेंटरी GRN से मिलाती है → हर लाइन कन्फ़र्म या कारण से निपटने तक pending या partly received रहता है।

**आम दिक्कतें और हल**
- "Not available — This page is for administrators and owners." — वॉचमैन और रिपोर्ट वाले यह पेज नहीं खोल सकते। गेट टर्मिनल या Gate report इस्तेमाल करें।
- "The QR could not be replaced." — सर्वर ने बदलाव नहीं लिया; कारण देखकर फिर कोशिश करें।
- "Could not load the QR link — open the poster to retry." — इस प्लांट के लिए नेटवर्क या सेटिंग की दिक्कत।

**अटक गए तो**
1. जिस वॉचमैन को "Gate not assigned" दिखे, उसके लिए Gate assignment में फ़ैक्टरी टिक करें और वो दोबारा लॉगिन करे।
2. फ़ैक्टरी जोड़ने या नाम बदलने के लिए Plants में बदलें; गेट और QR साथ आते हैं।

जुड़े पेज: /gate/qr, /factory/plants, /system/users, /system/users/new, /inventory/gate-bills, /analytics/reports/gate, /system/report-center

### Inside now (अंदर के विज़िटर) (/gate/visitors)
स्क्रीन का पता: /gate/visitors · भूमिकाएँ: WATCHMAN, ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=gate-visitors&lang=hi

फ़ैक्टरी के अंदर मौजूद विज़िटर की लिस्ट। विज़िटर QR से खुद एंट्री करते हैं; जाते समय वॉचमैन उन्हें चेक-आउट करता है।

गेट पर खुला रखें। विज़िटर जाए तो उसका कार्ड ढूँढकर "Check out" दबाएँ। एडमिन और ओनर को "Legacy pending registrations" भी दिखते हैं, जिन्हें दर्ज या हटा सकते हैं।

**शुरू करने से पहले**
- गेट पर विज़िटर QR पोस्टर लगा हो; गेट लॉग का अधिकार और असाइन गेट।

**स्टेप बाय स्टेप**
1. लिस्ट लंबी हो तो नाम, मोबाइल या कंपनी से खोजें।
2. कार्ड पर लगी फ़ोटो से चेहरा मिलाएँ।
3. "Check out" दबाएँ और "Check out visitor?" कन्फ़र्म करें।
4. "Checked out at hh:mm" (सर्वर समय) देखें।
5. सिर्फ़ ओनर: legacy pending कार्ड पर आए हों तो "Record entry", नहीं तो कारण के साथ "Remove" (Visitor left, Entry declined, Duplicate / mistaken registration, Visit cancelled)।

**स्क्रीन पर क्या है**
- **Inside since / अंदर का समय**: एंट्री का समय और कितनी देर से अंदर हैं।
- **Overdue**: 12 घंटे से ज़्यादा अंदर।

**आम दिक्कतें और हल**
- "No visitors inside" — विज़िटर QR फ़ॉर्म भरते ही यहाँ दिखते हैं।
- "This account cannot record visitor exits." — आपके रोल को गेट लॉग का अधिकार नहीं है।
- "Visitors record entry themselves using the factory QR code." — वॉचमैन एंट्री नहीं कर सकता; विज़िटर से पोस्टर स्कैन करवाएँ।
- "Gate not assigned" — आपके अकाउंट को कोई प्लांट गेट नहीं मिला, इसलिए रजिस्टर बंद है। एडमिन या ओनर User Management (Gate assignment) में गेट दें; फिर दोबारा लॉगिन करें।

**अटक गए तो**
1. जिसके पास स्मार्टफ़ोन न हो: ओनर "Walk-in visitor" पर रजिस्टर कर सकता है।
2. चेक-आउट न हो तो फिर दबाएँ; एक काम दो बार दर्ज नहीं होता।

जुड़े पेज: /gate, /gate/visitors/new, /gate/qr, /gate/history

**अभी नहीं होता / ध्यान दें**
- वॉचमैन विज़िटर की एंट्री दर्ज नहीं कर सकता; बिना स्मार्टफ़ोन वाले विज़िटर के लिए ओनर को walk-in रजिस्टर करना पड़ता है।

### Walk-in visitor (बिना QR वाला विज़िटर) (/gate/visitors/new)
स्क्रीन का पता: /gate/visitors/new · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=gate-visitors-new&lang=hi

सिर्फ़ ओनर के लिए फ़ॉर्म, उस विज़िटर को रजिस्टर करने के लिए जो QR इस्तेमाल नहीं कर सकता (स्मार्टफ़ोन नहीं)। एंट्री बाद में "Record entry" से लगती है।

आम विज़िटर गेट QR खुद इस्तेमाल करते हैं; वॉचमैन सिर्फ़ बाहर जाना कन्फ़र्म करता है। यह पेज सिर्फ़ अपवाद के लिए।

**शुरू करने से पहले**
- एडमिन या ओनर अकाउंट और active गेट प्लांट।

**स्टेप बाय स्टेप**
1. "Visitor name" और "Mobile number" (10 अंक) भरें।
2. "Purpose" चुनें (Meeting, Delivery, Collection, Service / maintenance, Interview, Official visit, Other)।
3. वैकल्पिक: "Company", "Government ID" (None, Aadhaar, PAN, Other) और "Visitor photo"।
4. सहमति टिक करें और "Register visitor" दबाएँ।
5. जब वो सच में अंदर आएँ, "Visitor queue" खोलकर उनके कार्ड पर "Record entry" दबाएँ।

**स्क्रीन पर क्या है**
- **Government ID**: वैकल्पिक। Aadhaar 12 अंक का हो।
- **Consent (सहमति)**: ज़रूरी: विज़िटर गेट सुरक्षा के लिए जानकारी और फ़ोटो दर्ज करने की सहमति दे।

**आम दिक्कतें और हल**
- "Not available — This page is for administrators and owners." — वॉचमैन और रिपोर्ट वाले यह पेज नहीं खोल सकते। गेट टर्मिनल या Gate report इस्तेमाल करें।
- "Enter a 10-digit mobile number." — मोबाइल नंबर अधूरा है।
- "Aadhaar has 12 digits." — ID नंबर ठीक करें या None चुनें।
- "Consent is needed to record the visit." — सहमति वाला बॉक्स टिक करें।
- "Optional government ID storage is temporarily unavailable. Please omit the ID number and retry." — ID में None चुनें और फिर भेजें।

**अटक गए तो**
1. अगले व्यक्ति के लिए "Another walk-in" दबाएँ।

जुड़े पेज: /gate/visitors, /gate/history

### विज़िटर रजिस्ट्रेशन (गेट लिंक नहीं) (/visit)
स्क्रीन का पता: /visit · भूमिकाएँ: - · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=visit&lang=hi

बिना गेट कोड के खुलने वाला सार्वजनिक पेज। इसमें सिर्फ़ "Scan the gate QR code" लिखा आता है: लिंक अधूरा है।

विज़िटर यहाँ तब आता है जब उसने पता हाथ से लिखा हो या QR कटा हो। असली फ़ॉर्म सिर्फ़ गेट पोस्टर के QR (/visit/<code>) से खुलता है।

**शुरू करने से पहले**
- कुछ नहीं; लॉगिन नहीं चाहिए।

**स्टेप बाय स्टेप**
1. फ़ैक्टरी गेट पर लगे पोस्टर का QR दोबारा स्कैन करें।
2. पोस्टर न हो तो वॉचमैन से सही गेट QR माँगें।

**आम दिक्कतें और हल**
- "Scan the gate QR code" — यह लिंक अधूरा है; इसमें गेट कोड नहीं है।

**अटक गए तो**
1. पोस्टर पर फ़ोन का कैमरा इस्तेमाल करें; पता हाथ से न लिखें।

जुड़े पेज: /visit/[token], /gate/qr

### Register your visit (अपनी विज़िट दर्ज करें) (/visit/[token])
स्क्रीन का पता: /visit/[token] · भूमिकाएँ: - · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=visit-token&lang=hi

गेट QR पोस्टर से खुलने वाला सार्वजनिक विज़िटर फ़ॉर्म। विज़िटर अपने फ़ोन पर भरता है और उसकी एंट्री तुरंत दर्ज हो जाती है।

हर विज़िटर आते समय भरता है। लॉगिन नहीं। वॉचमैन उन्हें "Visitors inside" में देखता है और जाते समय चेक-आउट करता है।

**शुरू करने से पहले**
- सही गेट QR (गेट का पोस्टर)। विज़िटर के फ़ोन में इंटरनेट।

**स्टेप बाय स्टेप**
1. गेट पोस्टर का QR स्कैन करें; पेज पर कंपनी और "<plant> · Visitor gate" दिखेगा।
2. "Your name" और "Mobile number" भरें।
3. "Purpose" चुनें (जैसे Meeting, Delivery, Collection, Service / maintenance, Interview, Official visit, Other)।
4. वैकल्पिक: "Company", "Government ID" और "Selfie" (वॉचमैन को पहचानने में मदद)।
5. सहमति टिक करें और "Record my entry" दबाएँ।
6. "Entry recorded" स्क्रीन (रेफ़रेंस और एंट्री समय) वॉचमैन को दिखाएँ।

**स्क्रीन पर क्या है**
- **Purpose**: ज़रूरी; विज़िट का कारण।
- **Government ID**: वैकल्पिक: None, Aadhaar (12 अंक), PAN या Other।
- **Reference / Entry time**: सेव के बाद दिखता है; वॉचमैन के लिए स्क्रीन खुली रखें।

**आम दिक्कतें और हल**
- "Gate link not available — This visitor QR is unavailable. Please ask the watchman." — QR पुराना (बदला गया) या गलत है। गेट पर लगा पोस्टर स्कैन करें, या वॉचमैन से पूछें।
- "Enter a 10-digit mobile number." — अपना 10 अंकों का मोबाइल नंबर लिखें।
- "Consent is needed to record the visit." — आगे बढ़ने के लिए सहमति वाला बॉक्स टिक करें।
- "Selfie must be 3 MB or smaller. / Use a clear JPEG, PNG or WebP selfie." — पेज के कैमरे से सेल्फ़ी दोबारा लें।
- "Camera permission was blocked." — ब्राउज़र में कैमरा की अनुमति दें, या फ़ोन के कैमरा ऐप से फ़ोटो चुनें।

**अटक गए तो**
1. भेजना फ़ेल हो तो बटन फिर दबाएँ: दोबारा भेजने से दूसरा रजिस्ट्रेशन नहीं बनता।
2. "This registration was already recorded — no duplicate was created." का मतलब आप पहले से दर्ज हैं।

जुड़े पेज: /gate/visitors, /gate/qr
