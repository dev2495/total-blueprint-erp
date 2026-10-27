# Inventory and stores

## Overview (English)
# Inventory — stock views, corrections and documents (part A)

This part of the Inventory module covers the stock overview screens, stock corrections and alerts, and the paper that comes in or goes out of the factory gate that is not production stock: bills, general receipts, gate passes and the goods in & out register. Rolls, packaging, GRN, ledger, stock lifecycle, job work and inter-plant are covered in the other Inventory guide.

## Screens and how they connect
- **Stock workspace** (`/inventory`): home page. Tiles for bulk, active rolls and packaging; launcher tiles to Roll workspace, Stock conversion, Bulk & chemicals, Packaging, POD stock, Inks · adhesives · solvents, Roll genealogy and Inter-plant; a roll matrix (variant × thickness), bulk and packaging sections with drawers showing reservations. The top card "Gate bills waiting for inventory" links to Bills & documents.
- **Bulk & chemicals** (`/inventory/bulk`) and **Inks · adhesives · solvents** (`/inventory/addons`): filterable bulk stock with Pulse and Browse modes, saved views, export and a drawer with sales reservations and a "Stock card" link.
- **Bulk Transactions** (`/inventory/bulk-transactions`): read-only log of every bulk movement (Inward, Consumption, Transfer, Adjustment).
- **Stock Adjustments** (`/inventory/adjustments`, `/new`, `/[id]`): controlled corrections with maker-checker.
- **Alerts Center** (`/inventory/alerts`): stock problems found by the nightly check.
- **Count at rack** (`/inventory/count`): old link; it opens Stock lifecycle → Stock count.
- **Bills & documents** (`/inventory/gate-bills`, `/[id]`, `/[id]/view`): every incoming bill, classified and finished.
- **General receipts** (`/inventory/general-receipts`, `/new`, `/[id]`): non-stock receipts and machine history.
- **Gate passes** (`/inventory/gate-passes`, `/new`, `/[id]`): RGP / NRGP.
- **Goods in & out** (`/inventory/goods-movements`): one register of inter-plant, job work and gate passes by stage.

## Main flows
**1. A bill arrives.** The watchman photographs it at the gate (or the office presses "Upload bill"). It lands in the Inbox under "Needs classifying". Store opens it, chooses Document type and Category, types vendor, bill number, date and amounts, and presses "Save details". The Next step depends on the category: Stock items → "Open GRN" (stock goes up); Job work → "Receive job work"; Spares, Machinery, Service → "Create general receipt" (no stock); Utility, Professional / statutory fee, Other expense → "File as record"; Transport → "Attach to the stock bill" or file. A bill with some receipts stays "Partly received" until someone presses "Confirm all lines received". Duplicate bills (same vendor, bill number and financial year) are flagged; void them as "Duplicate".

**2. A general receipt.** From the bill, choose Goods or Service, add lines (Qty × Rate = Amount, GST %), say what happened (kept in store, installed, used) and the machine. Tick "This receipt completes the bill" only when every line is covered. Owner/Admin can reverse a receipt with a reason; it is never deleted.

**3. A part goes out for repair.** Create a gate pass (RGP, purpose Repair, expected back date, items, machine). "Save and issue" gives the number; print it. The watchman scans the QR and the pass shows "Out of factory". When it returns with a bill, record a General Receipt and tick "Came back on a returnable gate pass (RGP)"; without a bill use "Receive back". If it will not return, "Short-close" with a reason. NRGP (scrap sale, sample, return to supplier) closes when it leaves.

**4. A stock correction.** Draft a New stock adjustment: plant, reason, lines with a plus or minus delta in the item's stock unit. "Save Draft". A second person with the adjust right opens it and presses "Post" — stock and ledger change. A wrong posted adjustment is voided; voiding posts inverse lines.

**5. Alerts.** The nightly check raises alerts (negative stock, ledger mismatch, weight mismatch, orphan roll, stuck WIP, low stock). Fix the cause with a count or adjustment, then "Resolve" with a note. Mismatch alerts close themselves the night after the cause is fixed.

## Rules and limits
- Only stock bills (GRN) and job-work receipts change inventory. General receipts, gate passes, filed bills and "Mark back at gate" never move stock.
- Stock adjustments need two people unless the poster is Owner or Admin. Quantities are in the item's base unit; rolls in KG. A roll can be adjusted only when AVAILABLE (or MISSING with a plus) and not reserved for a job. Job-work, transit and scrap locations cannot be adjusted. A material held under several quality codes at one location must be corrected through a physical count.
- Office uploads: up to 20 files / 20 pages, photo 10 MB, PDF 15 MB, JPEG/PNG/WebP/PDF.
- A returnable gate pass needs an expected return date not in the past; scrap sale is NRGP only.
- A General Receipt that brought gate-pass items back cannot be reversed.
- Every save on bills, receipts and passes is retry-safe: pressing the same button again after a network drop never records twice.

## Who does what
- **STORE**: classifies bills, posts GRNs, records general receipts, raises gate passes, drafts and posts adjustments (as second person), resolves alerts.
- **OWNER / ADMIN / SUPER_ADMIN**: everything, plus reopening filed or voided bills, reversing general receipts, self-posting adjustments and seeing document storage.
- **PLANNER, WORK_CENTER_MANAGER**: view stock workspaces, alerts and transactions.
- **PLANT_MANAGER**: stock views, adjustments, alerts, goods in & out.
- **DISPATCH**: Goods in & out.
- **WATCHMAN**: photographs bills and scans gate-pass QR at the gate; never sees these office screens.

## Problems and fixes
- *"A stock adjustment needs a second person…"*: you drafted it; another user must post. After "Save & Post" fails this way, the draft already exists — do not press again.
- *"…would make stock negative"*: the minus is more than the stock; recount.
- *"Someone else saved this document…"*: reload values, check, save again.
- *Bill cannot be filed*: choose a record-only category first.
- *Bill cannot be voided*: receipts are linked; confirm it complete instead.
- *"Only … is still out on …"*: you entered more than is still out on the RGP line.
- *Upload not confirmed*: press "Send the same upload again".
- *Alerts page empty but problems expected*: press "Refresh"; load errors are not shown.

# Inventory — receiving, moving, counting and closing stock (part B)

This part of the Inventory module covers how stock **comes in** (Smart GRN and its history), how it **moves and changes form** (roll workspace, stock conversion, roll movements, inter-plant transfers, job work), how it is **traced** (roll genealogy, ledger), how departures are **matched to papers** (outward documents), and how stock is **counted and closed** (Count and close: opening stock, stock count, evening packing count, month end, year end). Vendors and the packaging stock view also sit here. Bulk, inks and other stock screens are described in the other Inventory guide.

## Screens and how they connect

- **Receive goods (Smart GRN)** `/inventory/grn` — one form per supplier invoice. Pick the stock class (Bulk material, Film roll, Packaging, Trading goods), the source (Against system PO, Manual vendor PO ref, Direct receipt), vendor, invoice and receiving warehouse, enter the lines and press **Submit & post** (Ctrl/⌘+Enter). Rolls use a fast grid: each new line starts as a copy of the one above, so only weights change; gross − tare fills net. Large lots can be pasted from Excel or uploaded with the live template. When a gate bill exists, open it from Bills & documents so the bill sits beside the form and is linked in the same save.
- **GRN history & corrections** `/inventory/grn-history` — every inward row with filters and CSV export. A wrong row is fixed with **Correct**: the original stays locked and a correction entry stores before, after, delta, user and reason. Closed-year rows are read-only.
- **Roll workspace** `/inventory/rolls` — the store home page: film board (Free, Reserved, On machine, Away), variant × thickness matrix, table and cards, with filters for status, role, form, plant, location, age and size. Roll detail links to lineage, stock card and labels.
- **Stock conversion** `/inventory/stock-conversions` — slit an open-web jumbo, open a tube to one or two sheets, fold or unfold. Weight is kept and the parent → child genealogy is recorded.
- **Roll movements** `/inventory/movements` and **Ledger** `/inventory/ledger` — read-only lists of recent roll moves and of bulk transactions plus roll moves.
- **Roll genealogy** `/inventory/traceability` — scan or type a roll's ERP ID or supplier number and see its tree, timeline and physical moves.
- **Inter-plant transfers** `/inventory/inter-plant` — challan per transfer: Draft → In Transit → Received, with a printable PDF and QR gate sticker (`/inventory/inter-plant/print/[id]`).
- **Job work** `/inventory/job-work` and `/inventory/job-work/[id]` — orders to outside job workers, Rule 45 challans with QR, returns with a material-balance check, bill linking, continue production with a part return, close or close short.
- **Outward documents** `/inventory/outward-documents` — the watchman's departure photos waiting to be matched to ERP challans, invoices or gate passes; the match screen and a pop-out photo window for a second monitor.
- **Packaging materials** `/inventory/packaging` — stock of inner pouches, gonny, cartons, tape, sheet, labels, tags and POD sleeves, with today's evening-count figures.
- **Count and close** `/inventory/stock-lifecycle` — Overview, Opening stock, Stock count (with the evening packing count), Month end, Year end. The old `/inventory/period` opens its Year end tab; the old `/inventory/ink-floor` opens Ink control.
- **Vendors** `/inventory/vendors` — suppliers, job workers and service providers. Status, job-work processes, plants and rate cards are edited in Master data → Vendors.

## Main flows

**Receiving a supplier delivery.** 1) The watchman photographs the bill at the gate; 2) the store classifies it in Bills & documents and opens Receive; 3) Smart GRN opens with the bill beside it; 4) the store enters what was actually received and posts; 5) rolls appear in the roll workspace as Available, bulk and packaging in their stock views; 6) a mistake is corrected in GRN history, never by posting a second GRN.

**Sending work to a job worker.** 1) Create the order (Planned route step, or Emergency handoff with a reason); 2) Send material issues a numbered challan with a QR, which the gate scans; 3) when goods return, Receive: mark each sent roll used up, came back unused or partly used, enter output and wastage, and check the material balance; 4) if production must start with a part return, Continue production with what's back completes the route step; 5) Close when nothing is left (or Close short with a reason). Overdue alerts start after "Expected back by"; material held 300+ days is flagged for GST ITC-04.

**Moving stock between plants.** Create the inter-plant challan, dispatch it (stock sits in the source plant's IN_TRANSIT), print it with the QR sticker, and receive it at the destination into a target location. Open challans block the year-end close.

**Evening packing count.** In-house inner pouches leave stock at the machine's last pouching step when the output is logged; the Packing Yard never takes inner pouches off stock. Bought inner pouches are only marked by the machine, and every other packing item (gonny, sheet/putha, box, tape, label, tag, outer bag, other) is only ticked at release — no quantity. In the evening the store opens Count and close → Stock count → Evening packing count and picks the location. Each row starts filled with the book quantity; change only the items whose count differs and press Post count. It posts at once, with no approval, and rows left at the book figure do not change stock. The shortfall is booked to the orders that ticked or marked that item that day, shared in whole pieces; if no one did, to that day's orders whose packing plan includes the item, and only when there are none does it stay on no order. An excess is posted as count excess. Packing audit shows each count with book → counted → used and each order's share.

**Stock count and close.** Stock count is one count for any day: month end, a period or a spot check. Choose the scope and count mode, enter what is on the floor, give a reason for every difference of 2% or more and press Post physical count. Month end takes the month's snapshot and proof (reporting only). Year end checks the blockers, locks the year, generates next year's opening and archives the year's finished records.

## Rules and limits

- Only active vendors of type Raw Material or Hybrid can supply a GRN; the same invoice number cannot be received twice for one vendor.
- GRNs into virtual locations are refused; the plant comes from the receiving warehouse.
- Roll gross must equal net + tare within 0.05 kg; extrudable film needs a grade.
- Rolls are never edited directly: weight, status and location change only through receipts, production, dispatch, job work, moves, conversions and adjustments.
- Only Available rolls can be converted or sent to another plant; reserved rolls must be released first.
- Job-work returns are never received on Smart GRN.
- Matching outward papers never moves stock or marks delivery.
- Closed financial years cannot change; corrections in a closed year need an FY correction.
- A count sheet sent for approval (Submit → Approve in Count history) needs a different checker; only an owner may approve their own. "Post physical count" and the evening packing count post at once, with no approval.

## Who does what

- **STORE:** GRN, corrections, conversions, inter-plant challans, job work, outward matching, counts, evening packing count.
- **PLANNER:** looks at rolls, job work and history; creates job-work orders for planned steps.
- **WORK_CENTER_MANAGER:** rolls, conversions, inter-plant, genealogy.
- **PLANT_MANAGER:** counts, ledger, vendors, Count and close.
- **OWNER / ADMIN:** everything, including approving counts, voiding outward records, settling old job-work rolls and closing the year.

## Problems and fixes

- *"Duplicate vendor invoice"* — the invoice was already received; check GRN history and correct the old GRN.
- *"GRN vendor must be RM or BOTH type"* — fix the vendor type.
- *A roll is missing from a picker* — it is reserved, quarantined, in process or at another plant; trace it in Roll genealogy.
- *"Material balance is off"* on job work — recheck the weights or write the reason.
- *Year end will not close* — read the blockers: receive in-transit challans, close job-work orders, post or cancel draft sheets, fix negative bulk stock, resolve critical alerts.
- *Packing stock looks wrong* — compare Packing audit → Evening counts before adjusting; count again rather than adjusting by hand.
- *A save timed out* — on job work, press the same button again (retries are recognised); on Smart GRN, check GRN history first.

Example: the store receives invoice ACM/INV/2026-0098 from ABC Polymers for 12 rolls of 1050 mm, 50 micron film against PO-2026-0042, then sends 4 of them to a job worker for lamination on JWO-2026-0007 for SO-2026-0123.

## सारांश (हिंदी)
# Inventory — स्टॉक व्यू, सुधार और काग़ज़ात (भाग A)

Inventory module का यह हिस्सा स्टॉक देखने वाली स्क्रीन, स्टॉक सुधार और alert, और गेट से आने-जाने वाले वे काग़ज़ बताता है जो production स्टॉक नहीं हैं: बिल, general receipt, gate pass और goods in & out रजिस्टर। Roll, packaging, GRN, ledger, stock lifecycle, job work और inter-plant दूसरी Inventory गाइड में हैं।

## स्क्रीन और उनका आपसी जुड़ाव
- **Stock workspace** (`/inventory`): मुख्य पेज। Bulk, active rolls और packaging की टाइल; Roll workspace, Stock conversion, Bulk & chemicals, Packaging, POD stock, Inks · adhesives · solvents, Roll genealogy और Inter-plant की टाइल; roll matrix (variant × thickness), bulk और packaging हिस्से जिनके drawer में reservation दिखते हैं। ऊपर "Gate bills waiting for inventory" कार्ड Bills & documents खोलता है।
- **Bulk & chemicals** (`/inventory/bulk`) और **Inks · adhesives · solvents** (`/inventory/addons`): bulk स्टॉक, Pulse और Browse mode, saved view, export, और drawer में sales reservation व "Stock card"।
- **Bulk Transactions** (`/inventory/bulk-transactions`): हर bulk आवाजाही का लॉग (Inward, Consumption, Transfer, Adjustment)।
- **Stock Adjustments** (`/inventory/adjustments`, `/new`, `/[id]`): दो-व्यक्ति (maker-checker) वाला स्टॉक सुधार।
- **Alerts Center** (`/inventory/alerts`): रात की जाँच में मिली गड़बड़ियाँ।
- **Count at rack** (`/inventory/count`): पुराना link; Stock lifecycle → Stock count खोलता है।
- **Bills & documents** (`/inventory/gate-bills`, `/[id]`, `/[id]/view`): हर आने वाला बिल, classify करके पूरा करना।
- **General receipts** (`/inventory/general-receipts`, `/new`, `/[id]`): non-stock रसीद और machine history।
- **Gate passes** (`/inventory/gate-passes`, `/new`, `/[id]`): RGP / NRGP।
- **Goods in & out** (`/inventory/goods-movements`): inter-plant, job work और gate pass का stage के हिसाब से एक रजिस्टर।

## मुख्य काम, कदम दर कदम
**1. बिल आता है।** Watchman गेट पर फ़ोटो लेता है (या ऑफ़िस "Upload bill" दबाता है)। बिल Inbox में "Needs classifying" में आता है। Store उसे खोलकर Document type और Category चुनता है, vendor, bill नंबर, तारीख़ और रकम भरता है और "Save details" दबाता है। अगला कदम category पर निर्भर है: Stock items → "Open GRN" (स्टॉक बढ़ता है); Job work → "Receive job work"; Spares, Machinery, Service → "Create general receipt" (स्टॉक नहीं); Utility, Professional / statutory fee, Other expense → "File as record"; Transport → "Attach to the stock bill" या file। कुछ receipt लगने पर बिल "Partly received" रहता है, जब तक कोई "Confirm all lines received" न दबाए। एक ही vendor, bill नंबर और साल वाले बिल duplicate दिखते हैं; उन्हें "Duplicate" से void करें।

**2. General receipt।** बिल से Goods या Service चुनें, लाइनें जोड़ें (Qty × Rate = Amount, GST %), क्या हुआ (store में रखा, लगाया, इस्तेमाल किया) और मशीन चुनें। "This receipt completes the bill" तभी टिक करें जब हर लाइन पूरी हो। Owner/Admin कारण देकर receipt reverse कर सकते हैं; वह delete नहीं होती।

**3. पुर्ज़ा मरम्मत के लिए बाहर।** Gate pass बनाएँ (RGP, purpose Repair, लौटने की तारीख़, सामान, मशीन)। "Save and issue" से नंबर मिलता है; print करें। Watchman QR scan करता है और pass "Out of factory" हो जाता है। बिल के साथ लौटे तो General Receipt बनाकर "Came back on a returnable gate pass (RGP)" टिक करें; बिना बिल लौटे तो "Receive back"। नहीं लौटेगा तो कारण के साथ "Short-close"। NRGP (scrap sale, sample, supplier को वापसी) गेट से निकलते ही बंद होता है।

**4. स्टॉक सुधार।** New stock adjustment में plant, reason और लाइनें (item की unit में plus या minus) डालकर "Save Draft" करें। adjust अधिकार वाला दूसरा व्यक्ति उसे खोलकर "Post" दबाता है — स्टॉक और ledger बदलते हैं। गलत posted adjustment को void करें; void उल्टी लाइनें लगाता है।

**5. Alert।** रात की जाँच alert बनाती है (negative stock, ledger mismatch, weight mismatch, orphan roll, stuck WIP, low stock)। गिनती या adjustment से कारण ठीक करें, फिर नोट के साथ "Resolve"। Mismatch वाले alert कारण ठीक होने के अगले दिन खुद बंद हो जाते हैं।

## नियम और सीमाएँ
- सिर्फ़ stock बिल (GRN) और job-work receipt से inventory बदलती है। General receipt, gate pass, file हुए बिल और "Mark back at gate" से स्टॉक नहीं बदलता।
- Stock adjustment में दो लोग चाहिए, जब तक post करने वाला Owner या Admin न हो। मात्रा item की base unit में; roll KG में। Roll तभी adjust होता है जब AVAILABLE हो (या MISSING पर plus) और किसी job के लिए reserved न हो। Job-work, transit और scrap location adjust नहीं होती। एक location पर कई quality code वाला material physical count से ही ठीक होता है।
- ऑफ़िस upload: 20 file / 20 पेज तक, फ़ोटो 10 MB, PDF 15 MB, JPEG/PNG/WebP/PDF।
- Returnable gate pass में लौटने की तारीख़ ज़रूरी, पिछली नहीं; scrap sale सिर्फ़ NRGP में।
- जिस General Receipt से gate-pass का सामान लौटा, वह reverse नहीं होती।
- बिल, receipt और pass की हर सेव दोबारा भेजने पर सुरक्षित है: नेटवर्क टूटने के बाद वही बटन फिर दबाने से दो बार दर्ज नहीं होता।

## कौन क्या करता है
- **STORE**: बिल classify, GRN post, general receipt, gate pass, adjustment का draft और (दूसरे व्यक्ति के रूप में) post, alert resolve।
- **OWNER / ADMIN / SUPER_ADMIN**: सब कुछ, साथ में file/void बिल फिर खोलना, general receipt reverse, अपना adjustment खुद post करना और document storage देखना।
- **PLANNER, WORK_CENTER_MANAGER**: स्टॉक workspace, alert और transaction देखना।
- **PLANT_MANAGER**: स्टॉक view, adjustment, alert, goods in & out।
- **DISPATCH**: Goods in & out।
- **WATCHMAN**: गेट पर बिल की फ़ोटो और gate-pass QR scan; ये ऑफ़िस स्क्रीन नहीं देखता।

## समस्याएँ और हल
- *"A stock adjustment needs a second person…"*: draft आपने बनाया है; दूसरा user post करे। "Save & Post" ऐसे fail हो तो draft बन चुका है — दोबारा न दबाएँ।
- *"…would make stock negative"*: घटाई मात्रा स्टॉक से ज़्यादा है; फिर गिनें।
- *"Someone else saved this document…"*: नए मान देखें, जाँचें, फिर सेव करें।
- *बिल file नहीं होता*: पहले record-only category चुनें।
- *बिल void नहीं होता*: receipt जुड़ी हैं; complete करें।
- *"Only … is still out on …"*: RGP लाइन पर बाहर बची मात्रा से ज़्यादा लिखा।
- *Upload not confirmed*: "Send the same upload again" दबाएँ।
- *Alerts पेज खाली पर गड़बड़ी की उम्मीद*: "Refresh" दबाएँ; लोड की गलती स्क्रीन पर नहीं दिखती।

# Inventory — माल लेना, हिलाना, गिनना और साल बंद करना (भाग B)

Inventory module का यह हिस्सा बताता है कि माल **कैसे आता है** (Smart GRN और उसकी history), **कैसे हिलता और रूप बदलता है** (roll workspace, stock conversion, roll movements, inter-plant, job work), **कैसे ढूँढा जाता है** (roll genealogy, ledger), गाड़ी के निकलने को **काग़ज़ से कैसे मिलाते हैं** (outward documents), और माल **कैसे गिना और बंद होता है** (Count and close: opening stock, stock count, evening packing count, month end, year end)। Vendors और packaging stock भी यहीं हैं। Bulk, ink आदि की स्क्रीन दूसरे Inventory guide में हैं।

## स्क्रीन और उनका आपसी संबंध

- **Receive goods (Smart GRN)** `/inventory/grn` — सप्लायर के हर बिल का एक फ़ॉर्म। Stock class (Bulk material, Film roll, Packaging, Trading goods), source (Against system PO, Manual vendor PO ref, Direct receipt), vendor, invoice और receiving warehouse चुनें, लाइनें भरें और **Submit & post** (Ctrl/⌘+Enter) दबाएँ। Roll के लिए fast grid: हर नई लाइन ऊपर वाली की copy बनकर आती है, सिर्फ़ वज़न बदलें; gross − tare से net भरता है। बड़े lot Excel से paste या live template से upload करें। Gate bill हो तो Bills & documents से खोलें, बिल बगल में दिखेगा और उसी save में जुड़ेगा।
- **GRN history & corrections** `/inventory/grn-history` — हर inward लाइन, filter और CSV के साथ। गलत लाइन **Correct** से सुधरती है: असली GRN नहीं बदलती, सुधार की entry में पहले, बाद, फ़र्क, user और कारण रहता है। बंद साल की लाइन सिर्फ़ पढ़ी जा सकती है।
- **Roll workspace** `/inventory/rolls` — store का मुख्य पेज: film board (Free, Reserved, On machine, Away), variant × thickness matrix, table और card; status, role, form, plant, location, उम्र और size के filter। Roll detail से lineage, stock card और label।
- **Stock conversion** `/inventory/stock-conversions` — open-web jumbo slit करना, tube खोलकर एक या दो sheet, fold या unfold। वज़न वही रहता है और parent → child वंशावली दर्ज होती है।
- **Roll movements** `/inventory/movements` और **Ledger** `/inventory/ledger` — हाल के roll move और bulk लेन-देन की सिर्फ़ देखने वाली सूची।
- **Roll genealogy** `/inventory/traceability` — roll का ERP ID या supplier नंबर scan करें या लिखें, पेड़, timeline और move देखें।
- **Inter-plant transfers** `/inventory/inter-plant` — हर transfer का challan: Draft → In Transit → Received, print होने वाला PDF और QR gate sticker (`/inventory/inter-plant/print/[id]`)।
- **Job work** `/inventory/job-work` और `/inventory/job-work/[id]` — बाहर के job worker के order, QR वाले Rule 45 challan, material balance जाँच के साथ वापसी, बिल जोड़ना, आंशिक वापसी पर production आगे बढ़ाना, close या close short।
- **Outward documents** `/inventory/outward-documents` — watchman के departure फोटो जिन्हें ERP challan, invoice या gate pass से मिलाना है; match screen और दूसरी screen के लिए pop-out फोटो window।
- **Packaging materials** `/inventory/packaging` — inner pouch, gonny, carton, tape, sheet, label, tag और POD sleeve का stock, आज के evening count के आँकड़ों के साथ।
- **Count and close** `/inventory/stock-lifecycle` — Overview, Opening stock, Stock count (evening packing count सहित), Month end, Year end। पुराना `/inventory/period` इसका Year end tab खोलता है; पुराना `/inventory/ink-floor` Ink control खोलता है।
- **Vendors** `/inventory/vendors` — supplier, job worker और service provider। Status, job-work process, plant और rate card Master data → Vendors में बदलते हैं।

## मुख्य काम, कदम दर कदम

**सप्लायर का माल लेना।** 1) Watchman gate पर बिल का फोटो लेता है; 2) store Bills & documents में उसे classify करके Receive खोलता है; 3) Smart GRN बिल के साथ खुलता है; 4) store जो असल में आया वह भरकर post करता है; 5) roll, roll workspace में Available दिखते हैं, bulk और packaging अपनी स्क्रीन में; 6) गलती GRN history में सुधारें, दूसरी GRN कभी नहीं।

**Job worker को काम भेजना।** 1) Order बनाएँ (Planned route step, या कारण के साथ Emergency handoff); 2) Send material से QR वाला challan बनता है, gate उसे scan करता है; 3) माल लौटे तो Receive: हर roll को used up, came back unused या partly used करें, output और wastage भरें, material balance जाँचें; 4) आंशिक माल से production शुरू करना हो तो Continue production with what's back से route step पूरा होता है; 5) कुछ बाकी न हो तो Close (या कारण के साथ Close short)। "Expected back by" के बाद overdue alert; 300+ दिन रुका माल GST ITC-04 के लिए flag होता है।

**Plant से plant माल।** Inter-plant challan बनाएँ, dispatch करें (माल source plant के IN_TRANSIT में), QR sticker के साथ print करें, destination पर target location में receive करें। खुले challan साल बंद होने से रोकते हैं।

**Evening packing count।** घर में बने (in-house) inner pouch मशीन के आखिरी pouching step पर output दर्ज होते ही stock से कटते हैं; Packing Yard inner pouch को stock से कभी नहीं काटता। खरीदे हुए inner pouch पर मशीन सिर्फ़ निशान लगाती है, और बाकी हर packing item (gonny, sheet/putha, box, tape, label, tag, outer bag, other) release पर सिर्फ़ tick होता है — मात्रा नहीं। शाम को store Count and close → Stock count → Evening packing count खोलता है और location चुनता है। हर लाइन में पहले से book मात्रा भरी आती है; सिर्फ़ उन items की गिनती बदलें जो अलग निकलें, फिर Post count दबाएँ। यह बिना approval तुरंत post होता है; book पर छोड़ी लाइनों से stock नहीं बदलता। कमी उस दिन item tick करने वाले (या जिन पर निशान लगा) order पर पूरे pieces में बँटती है; किसी ने tick न किया हो तो उस दिन के उन orders में जिनके packing plan में वह item है, और ऐसे order भी न हों तभी किसी order पर नहीं जाती। ज़्यादा मिले तो count excess। Packing audit में हर count का book → counted → used और हर order का हिस्सा दिखता है।

**Stock count और बंदी।** Stock count किसी भी दिन की एक गिनती है: month end, कोई period या spot check। Scope और count mode चुनें, floor पर जो है वह भरें, 2% या ज़्यादा फ़र्क पर कारण दें और Post physical count दबाएँ। Month end महीने का snapshot और proof लेता है (सिर्फ़ report)। Year end blockers जाँचता है, साल lock करता है, अगले साल की opening बनाता है और साल के पूरे हुए record archive में भेजता है।

## नियम और सीमाएँ

- GRN सिर्फ़ active Raw Material या Hybrid vendor से; एक vendor का एक invoice नंबर दो बार नहीं।
- Virtual location में GRN नहीं; plant receiving warehouse से तय होता है।
- Roll का gross, net + tare के 0.05 kg के अंदर हो; extrudable film पर grade ज़रूरी।
- Roll सीधे नहीं बदला जाता: वज़न, status और location सिर्फ़ receipt, production, dispatch, job work, move, conversion और adjustment से बदलते हैं।
- सिर्फ़ Available roll का conversion या दूसरे plant में भेजना; reserved roll पहले छुड़ाएँ।
- Job worker की वापसी Smart GRN पर कभी नहीं।
- Outward काग़ज़ मिलाने से stock नहीं हिलता और delivery नहीं होती।
- बंद financial year नहीं बदलता; उसके लिए FY correction चाहिए।
- Approval के लिए भेजी count sheet (Count history में Submit → Approve) कोई दूसरा व्यक्ति approve करता है; अपनी sheet सिर्फ़ owner खुद approve कर सकता है। "Post physical count" और शाम की packing गिनती तुरंत post होती हैं, कोई approval नहीं।

## कौन क्या करता है

- **STORE:** GRN, सुधार, conversion, inter-plant challan, job work, outward matching, count, evening packing count।
- **PLANNER:** roll, job work और history देखता है; planned step के लिए job-work order बनाता है।
- **WORK_CENTER_MANAGER:** roll, conversion, inter-plant, genealogy।
- **PLANT_MANAGER:** count, ledger, vendors, Count and close।
- **OWNER / ADMIN:** सब कुछ, count approve करना, outward record void करना, पुराने job-work roll निपटाना और साल बंद करना भी।

## समस्याएँ और हल

- *"Duplicate vendor invoice"* — invoice पहले ही लिया जा चुका; GRN history देखें और पुरानी GRN सुधारें।
- *"GRN vendor must be RM or BOTH type"* — vendor का type ठीक करें।
- *Picker में roll नहीं दिखता* — reserved, quarantine, process में या दूसरे plant में है; Roll genealogy में देखें।
- *Job work पर "Material balance is off"* — वज़न फिर जाँचें या कारण लिखें।
- *Year end बंद नहीं होता* — blockers पढ़ें: in-transit challan receive करें, job-work order close करें, draft sheet post या cancel करें, negative bulk stock ठीक करें, critical alert हल करें।
- *Packing stock गलत लगे* — adjust से पहले Packing audit → Evening counts देखें; हाथ से adjust करने की जगह फिर गिनें।
- *Save time out हुआ* — job work पर वही बटन फिर दबाएँ (दोहराना पहचाना जाता है); Smart GRN पर पहले GRN history देखें।

उदाहरण: store, PO-2026-0042 पर ABC Polymers का invoice ACM/INV/2026-0098 लेता है — 1050 mm, 50 micron film के 12 roll — फिर उनमें से 4 roll SO-2026-0123 के लिए JWO-2026-0007 पर lamination को job worker के पास भेजता है।

## Every screen (English)

### Inventory Health Matrix (/analytics/inventory-health)
Screen address: /analytics/inventory-health · Roles: ADMIN, OWNER, SUPER_ADMIN, STORE, PLANNER, WORK_CENTER_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=analytics-inventory-health

Live stock totals (bulk, free rolls, finished goods, reserved rolls) and open stock-integrity alerts, with a button to run a fresh audit and resolve alerts.

Open when stock numbers look wrong, before a stock count, or daily as the store check. The audit compares stock balances with their transaction ledgers, checks rolls and finds WIP stuck too long.

**Before you start**
- Stock is posted through GRN, issue, roll movements and adjustments.
- Role needs inventory view permission.

**Step by step**
1. Read the four tiles: "Bulk Base Mass", "WIP Availability", "Finished Goods", "Locked Reserves".
2. Check "System Integrity" score and the alert counts "Critical Anomalies", "High Priority", "Total Outstanding".
3. Press "Run smart audit" to run the reconciliation now.
4. Go through "Active Diagnostic Log" from the top (critical/high first).
5. Fix the cause in Inventory (adjustment, count, roll movement), then press "Resolve Event" on the alert.
6. In "Resolve Anomaly Trace" write the reason in the note and press "Mark Matrix Resolved" (it stays disabled until a note is typed).
7. Press "Sync layer" to reload the numbers.

**What is on the screen**
- **Bulk Base Mass**: Total bulk stock (granules, chemicals, etc.) in KG and the number of active SKUs.
- **WIP Availability**: KG and count of free (available) rolls.
- **Finished Goods**: KG and count of finished-goods rolls.
- **Locked Reserves**: KG and count of rolls reserved for jobs.
- **System Integrity**: Score = 100 − 5 × critical − 2 × high − 0.5 × other open alerts (never below 0). Green above 80, amber above 50, red otherwise.
- **Alert severity**: CRITICAL and HIGH need action first.

**Common problems and fixes**
- "Inventory health feed unavailable" — The health request failed. Numbers are paused instead of showing zeros. Press "Retry".
- "Failed to run audit" — The audit hit an error on the server. Try again later; tell the admin if it repeats.
- "Alert already resolved" — Someone else closed it. Press "Sync layer".
- "Plant not found" — The plant sent with the audit does not exist. Reload the page.

**If stuck**
1. Never resolve an alert without fixing the stock first; resolving only closes the message.
2. For bulk mismatches use Adjustments or a rack count; for roll problems use Roll movements or Roll genealogy.

Related pages: /inventory/alerts, /inventory/adjustments, /inventory/count, /inventory/traceability, /analytics/inventory-history

**Not done yet / watch out**
- The page has no plant filter; tiles and alerts cover every plant together.
- The tile named "WIP Availability" actually shows free (available) rolls, not work in progress.

### Inventory Snapshot History (/analytics/inventory-history)
Screen address: /analytics/inventory-history · Roles: ADMIN, OWNER, SUPER_ADMIN, STORE, PLANNER, PLANT_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=analytics-inventory-history

Shows stock over time from the nightly snapshots: bulk, rolls, finished goods, WIP, reserved rolls and scrap per plant.

Use it to see if stock is growing or shrinking, which plant carries the most weight, and how much is stuck in WIP or reserved. Each snapshot is the close of a business day (taken at 23:45 IST).

**Before you start**
- The nightly snapshot job must be running; history starts from the first snapshot.

**Step by step**
1. Read the four tiles: "Captured snapshots", "Latest stock estate", "WIP share", "Reserved load".
2. Look at "Inventory snapshot rhythm" for the bulk, roll, FG and WIP lines over time.
3. Look at "Latest plant load" to compare plants.
4. Scroll to "Snapshot ledger" for each snapshot row; press "Refresh" to reload.

**What is on the screen**
- **Captured snapshots**: Number of snapshots loaded (last 180 days, up to 180 rows) and plants in the latest cycle.
- **Latest stock estate**: Total stock KG in the latest snapshot of each plant, with % change against the previous snapshot.
- **WIP share**: WIP KG ÷ total stock KG × 100.
- **Reserved load**: Reserved roll KG ÷ total stock KG × 100. Plant cards show "Reserve load" or "Clear reserve".
- **Bulk / Rolls / FG / WIP / Scrap**: Stock buckets stored in each snapshot, in KG.

**Common problems and fixes**
- "No snapshots shown" — The nightly snapshot has not run yet or failed. Ask the admin to check the scheduled job.

**If stuck**
1. Press "Refresh".
2. For today's live numbers use Inventory Health Matrix; history only changes after the 23:45 snapshot.

Related pages: /analytics/inventory-health, /analytics/reports/inventory, /inventory/ledger

**Not done yet / watch out**
- There is no date-range or plant filter; the page always loads the last 180 days for all plants.

### Inventory Control Hub (/dashboard/inventory)
Screen address: /dashboard/inventory · Roles: ADMIN, OWNER, SUPER_ADMIN, STORE, PLANNER, PLANT_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=dashboard-inventory

What is on hand, where it sits, how old it is and what needs attention, across every plant.

Store and planner open it to judge stock before planning or buying: free vs reserved rolls, aged stock over 90 days, stock by stage, location and plant, and unresolved stock alerts. Real work (GRN, moving, counting) happens on the Stock pages it links to.

**Before you start**
- Stock received through GRN; locations and plants set up.

**Step by step**
1. Read the hero figures: "Bulk stock", "Rolls on hand", "Finished goods" and "Open alerts".
2. Check "Available rolls" (free to plan) against "Reserved rolls" (held for orders).
3. Look at "Aged stock (90d+)" and the "Stock aging" panel; plan old rolls first.
4. Use "By stage", "By location" and "By plant" to see where roll stock sits.
5. Work through "Critical action centre", most severe alert first; press "All alerts" for the full list.
6. Press "Create GRN" to receive material, or "Health diagnostics" for the deeper inventory health report.

**What is on the screen**
- **Available rolls**: Roll weight free for the planner to allocate; the hint gives the count.
- **Reserved rolls**: Roll weight held for orders, and its share of all roll stock.
- **Aged stock (90d+)**: Stock older than 90 days.
- **Rated stock value**: Value of stock at its rates.
- **Stock aging**: Roll weight by age band.
- **Alert mix**: Unresolved alerts by type.
- **Largest stock families**: Weight on hand and the oldest item age per family.

**Common problems and fixes**
- "No aging data / No stage data / No location data" — The report returned nothing for that panel, often because no roll stock is recorded yet or the report is still loading.
- "All clear" — No unresolved stock alerts.

**If stuck**
1. Reload the page if panels stay empty; each panel loads separately.
2. Open the alert on Alerts and fix the cause (count, adjust, move) on the matching Stock page.

Related pages: /inventory/rolls, /inventory/grn, /inventory/alerts, /analytics/inventory-health, /analytics/reports/inventory

### Stock workspace (/inventory)
Screen address: /inventory · Roles: ADMIN, OWNER, STORE, PLANNER, WORK_CENTER_MANAGER, PLANT_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=inventory

The inventory home page: how much bulk, roll, packaging and POD stock we hold, where it sits, how old it is and how much is held for sales orders.

Open it to get a quick picture of stock before planning, purchasing or a count, and to jump into the focused workspaces (Rolls, Bulk, Packaging, Inks · adhesives, Stock conversion, Roll genealogy, Inter-plant). Stock arrives here from GRNs and production; it leaves through consumption, packing and dispatch.

**Before you start**
- Material masters, plants and store locations must exist; stock appears only after GRNs, opening stock or production outputs are posted.
- Your role needs inventory view rights. The "Gate bills waiting for inventory" card shows only to bill reviewers.

**Step by step**
1. Check the card "Gate bills waiting for inventory" at the top; the number is bills still open. Click it to open Bills & documents.
2. Read the three tiles: "Bulk granules & chemicals", "Active rolls" (count and KG) and "Packaging materials" (packing rows and POD rows).
3. Under "Dedicated workspaces" click a tile (Roll workspace, Stock conversion, Bulk & chemicals, Packaging, POD stock, Inks · adhesives · solvents, Roll genealogy, Inter-plant) for full filters.
4. In the left "Filters" rail type in the search ("Material · roll # · code…"), pick the class (All, Bulk, Rolls, Packaging, POD), a location and an age bucket (≤30 d, 31–90, 90+ d).
5. In "Variant × thickness matrix" click a cell to see the rolls of that variant and thickness.
6. Click a bulk or packaging row to open its drawer: On hand, Reserved, Available, vendor, last GRN, expiry and the sales orders holding it.
7. Press "Receive stock" to open Smart GRN, or "Period" / "Period: open · close →" (footer) to go to the stock lifecycle (counts and month close).

**What is on the screen**
- **Bulk granules & chemicals**: Total bulk stock across stock rows, shown per unit (KG, METER, PCS) when units differ.
- **Active rolls**: Number of rolls in stock and their total KG; the matrix below breaks them down.
- **Packaging materials**: Inner pouches, gonny, cartons, sheets, tape and other packing stock. POD rows are counted separately.
- **POD stock**: Pre-positioned POD sleeves and POD film only. Packing materials stay in the packaging section.
- **Age bucket**: ≤30 d fresh, 31–90 ageing, 90+ d old stock, counted from receipt.
- **Reserved / Available**: Reserved is held for sales orders (SO holds visible to sales); Available = On hand − Reserved.
- **Filtered stock footer**: Shows bulk reserved and free quantity for the current filter.

**Common problems and fixes**
- "Inventory snapshot did not load." — The stock service did not answer. Check the connection and reload; if it repeats, tell the administrator.
- "Gate bill card shows "Could not refresh the count"" — Only the count failed. Open the queue; it retries itself.

**If stuck**
1. If a number looks wrong, open the focused workspace (Bulk, Rolls, Packaging) and check the row, then the Stock ledger.
2. Clear all filters with the reset in the Filters rail if a section looks empty.

Related pages: /inventory/gate-bills, /inventory/grn, /inventory/rolls, /inventory/bulk, /inventory/packaging, /inventory/addons, /inventory/stock-conversions, /inventory/traceability, /inventory/inter-plant, /inventory/stock-lifecycle

**Not done yet / watch out**
- The footer "Filtered stock" shows only bulk reserved / free, not rolls or packaging.

### Inks · adhesives · solvents (/inventory/addons)
Screen address: /inventory/addons · Roles: ADMIN, OWNER, STORE, PLANNER, WORK_CENTER_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=inventory-addons

Stock of process consumables that go with the rolls: inks (with colour swatches), adhesives, solvents and chemicals.

Open it before a printing or lamination run, or before ordering, to see how much ink, adhesive or solvent each plant and location holds and which items are low. Stock comes in through GRN ("Receive add-ons") and goes out when work centers consume it.

**Before you start**
- Ink, adhesive and solvent materials must be in the material master and received by GRN.

**Step by step**
1. Choose "Pulse" for the summary (items, inks, adhesives, solvents, critical, family mix) or "Browse" for cards / table.
2. In Browse pick a saved view: "All add-ons", "Inks", "Adhesives", "Solvents" or "Low stock".
3. Narrow with the filters: Family, Health (Healthy, Low, Critical), Plant, Location and Material code.
4. Click a row or card to open its drawer: On hand, Reserved, Available, Lot #, Vendor, Plant, Location, Color, Expiry and sales reservations.
5. To keep a filter set, press "Save current", type a "View name" and press "Save".
6. Press "Receive add-ons" to post a GRN, or "← Summary" to go back to the stock workspace.

**What is on the screen**
- **Family**: INK, ADHESIVE, SOLVENT, CHEMICAL or OTHER, worked out from the material class, code or name.
- **Health**: Healthy, Low or Critical, comparing on-hand with the item's reorder point (50 in its own unit when none is set).
- **On hand / Reserved / Available**: Available = On hand − Reserved, in the item's stock unit.
- **Colour swatch**: Inks show a colour square guessed from the colour or material name.

**Common problems and fixes**
- "Could not load add-ons." — The stock snapshot did not load. Reload the page; if it repeats, tell the administrator.

**If stuck**
1. If an ink shows under "Other", its class or code does not say INK/PIGMENT/COLOR; use the search or the Bulk workspace.

Related pages: /inventory, /inventory/bulk, /inventory/grn, /inventory/ink-floor

**Not done yet / watch out**
- Family (ink, adhesive, solvent) is guessed from the material class, code or name, and Health uses a default reorder point of 50 when none is set, so some items can land in "Other" or show a misleading health.

### Stock Adjustments (/inventory/adjustments)
Screen address: /inventory/adjustments · Roles: ADMIN, OWNER, STORE, PLANT_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=inventory-adjustments

The list of every stock correction (damage, write-off, found stock, count correction, reclassification) for bulk, rolls, packaging and trading goods, with its status.

Open it to start a correction or to post one that a colleague drafted. A posted adjustment changes stock and writes the ledger; it is undone only by voiding.

**Before you start**
- You need the inventory.adjust right (Store, Owner, Admin, Plant manager by default).

**Step by step**
1. Read the chips at the top: Draft, Posted and Voided counts.
2. Filter with the buttons "All", "Draft", "Posted", "Voided".
3. Click a card (code ADJ-YYYY-NNNN, plant, reason, Lines, Net Δ, Created) to open it.
4. Press "New Adjustment" (or "Create first adjustment" when the list is empty) to start one.

**What is on the screen**
- **Status**: draft = saved, stock not changed; posted = stock changed; voided = cancelled (a posted one is reversed by an inverse correction).
- **Net Δ**: Sum of all line quantities (+ adds, − removes). Lines may be in different units.

**Common problems and fixes**
- "No stock adjustments yet" — Nothing has been recorded. Press "Create first adjustment".

**If stuck**
1. A draft that waits too long: ask a second person with the adjust right to open it and press "Post".

Related pages: /inventory/adjustments/new, /inventory/adjustments/[id], /inventory/stock-lifecycle, /inventory/ledger, /inventory/alerts

**Not done yet / watch out**
- The list has only status buttons — no search, plant or date filter — and no way to delete an unwanted draft.

### Stock adjustment (/inventory/adjustments/[id])
Screen address: /inventory/adjustments/[id] · Roles: ADMIN, OWNER, STORE, PLANT_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=inventory-adjustments-id

One stock adjustment with its lines (before, change, after and ₹ value), who created and posted it, and the Post and Void buttons.

Open it to check a draft and post it (second person), or to void a wrong adjustment. Posting applies every line to its stock pool and writes the ledger row (bulk/packaging ADJUST, roll movement ADJUSTMENT).

**Before you start**
- Maker-checker: the person who drafted it cannot post it unless they are Owner or Admin.

**Step by step**
1. Check the header: code, plant, reason, created by and posted by.
2. Check each line: Class, Item, Location, Before, Δ, After, Value ₹. Lines are read-only.
3. If you are the second person, press "Post", then "Post adjustment" in the box. If you drafted it you see "Waiting for a second person to post this adjustment."
4. To cancel, press "Void", then "Void adjustment". A posted adjustment gets inverse lines that restore stock; a draft is just marked voided.
5. Press "Back" to return to the list.

**What is on the screen**
- **Before / Δ / After**: Stock of that pool before posting, the change, and the result.
- **Value ₹**: Money value of the change at the item's rate.
- **Class**: BULK, ROLL, PACKAGING or TRADING_GOOD.

**Common problems and fixes**
- "A stock adjustment needs a second person: someone other than the person who drafted it must post it." — You drafted it. Ask another user with the adjust right (or an Owner/Admin) to post.
- "Line N: adjustment would make stock negative (…)" — The minus is more than the stock now at that location. Count again and void/redo with the right quantity.
- "Line N: roll … is reserved for a job. Unassign it first." — Remove the roll from the job (planner / job screen) before adjusting it.
- "Line N: roll … is …; only an available roll can be adjusted." — Consumed, dispatched, in-transit or job-work rolls are settled by their own flow, not here. A MISSING roll can be added back with a plus.
- "Line N: this material is held under several quality codes at this location. Adjust it through a physical count, which records the code." — Use Stock lifecycle → Stock count for this material.
- "Line N: voiding would make stock negative; the stock has been used since." — The added stock was already consumed. Make a new adjustment for what is really left instead of voiding.

**If stuck**
1. A wrong draft cannot be edited here: void it and create a new one.

Related pages: /inventory/adjustments, /inventory/adjustments/new, /inventory/ledger

**Not done yet / watch out**
- Draft lines cannot be edited or removed on screen (the server allows it); a wrong draft must be voided and recreated.

### New stock adjustment (/inventory/adjustments/new)
Screen address: /inventory/adjustments/new · Roles: ADMIN, OWNER, STORE, PLANT_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=inventory-adjustments-new

Form to correct stock: one plant and reason, then one line per stock pool with a plus or minus quantity.

Use it when stock on the screen does not match the floor: damage, write-off, stock found, count correction or reclassification. Save it as a draft; a second person posts it.

**Before you start**
- inventory.adjust right; plant and store locations set up; the material, roll or trading good must exist.
- For a full physical count use Stock lifecycle → Stock count instead.

**Step by step**
1. In "Header" pick the "Plant", the "Reason" (Damaged / spoiled, Write-off, Found / unaccounted, Count correction, Reclassification, Other) and optional "Notes".
2. In each line choose "Stock class": Bulk (granules / chemicals), Roll, Packaging or Trading Good.
3. Pick the "Material" (or "Trading good"); for Roll also pick the "Roll", for Bulk and Packaging pick the "Location".
4. Enter "Delta qty": +10 to add, -5 to remove. "UOM" is fixed to the item's stock unit (rolls in KG).
5. Press "Add line" for more items; "Remove" deletes a line.
6. Press "Save Draft". The draft opens; a second person posts it from there.
7. Owner/Admin may press "Save & Post" to save and post in one step.

**What is on the screen**
- **Reason**: Applies to all lines; shown in the list and audit.
- **Delta qty**: Change, not the new total. Cannot be zero.
- **Location**: Needed for Bulk and Packaging; only locations of the chosen plant. Job-work, transit and scrap locations are refused.
- **Preview**: Before → After for a roll line once the roll is picked.
- **Line notes**: Optional note for that line.

**Common problems and fixes**
- "Save failed / Post failed (red message)" — The message names the line and rule, e.g. "BULK adjustments require material and location." or "… is stocked in KG; enter the quantity in KG." Fix that line and save again.
- "… is a virtual location (job work, transit or scrap); its stock is settled by that flow." — Choose a real store location; stock at job worker or in transit is settled by job work / inter-plant.
- ""Save" buttons stay grey" — Pick a plant and enter a delta on at least one line.

**If stuck**
1. If "Save & Post" shows "Post failed" with the second-person message, the draft is already saved: open Stock Adjustments, do not press again (it would make a second draft).

Related pages: /inventory/adjustments, /inventory/adjustments/[id], /inventory/stock-lifecycle

**Not done yet / watch out**
- "Save & Post" first saves the draft and then posts it; for a non-owner who drafted it the post is refused (second-person rule), the page stays on the form with "Post failed", and pressing again creates a second draft.
- The Before → After preview works only for roll lines; bulk, packaging and trading-good lines always show "Pick a roll or material to preview qty".

### Alerts Center (/inventory/alerts)
Screen address: /inventory/alerts · Roles: ADMIN, OWNER, STORE, PLANNER, PLANT_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=inventory-alerts

List of stock problems found by the nightly stock check (negative stock, low stock, ledger mismatch, weight mismatch, orphan or stuck rolls) with severity and a Resolve button.

Open it daily to see which plants or materials carry an open problem, fix the cause (count, adjustment, roll correction) and close the alert with a note.

**Before you start**
- Alerts are raised by the nightly reconciliation (or "Run audit" on Inventory health). Inventory view right is enough to resolve.

**Step by step**
1. Pick "Open" (default), "Resolved" or "All"; press "Refresh" to reload.
2. Type in "Search alert, material, roll, or plant".
3. Read the tiles: Open alerts, Critical now, Resolved in view, Current filter; and the "Severity mix" and "Top alert families" charts.
4. In "Alert queue" read the message, material, roll and plant of each alert.
5. Fix the cause first (stock count, stock adjustment, roll fix).
6. Press "Resolve", write the "Resolution note" and press "Mark resolved".

**What is on the screen**
- **Severity**: CRITICAL, HIGH, MEDIUM, LOW. Critical and high need action first.
- **Type**: Negative Stock, Low Stock, Orphan Roll, Missing Parent, Missing Child, Stuck WIP, Cost Mismatch, Weight Mismatch, Transaction Mismatch.
- **Needs action / Resolved**: Resolved alerts show who closed them, when and the note.

**Common problems and fixes**
- "No alerts found" — Nothing open for this filter. Switch to "All" to see past closes. If you expected alerts, press "Refresh" — a failed load also shows this.
- "Alert already resolved" — Someone closed it first, or the nightly check closed it automatically. Press "Refresh".

**If stuck**
1. Mismatch alerts (TXN_MISMATCH, NEGATIVE_STOCK, WEIGHT_MISMATCH, ORPHAN_ROLL, STUCK_WIP) keep one alert per problem and close themselves the night after the cause is fixed.
2. If Resolve seems to do nothing, press "Refresh" and try again; the error is not shown on screen.

Related pages: /inventory/adjustments/new, /inventory/stock-lifecycle, /inventory/ledger, /analytics/inventory-health

**Not done yet / watch out**
- Load and resolve failures are only logged, not shown; a failed load looks like "No alerts found".
- There is no "Run audit" button here (it is on Inventory health), and no link from an alert to the material, roll or adjustment screen.

### Bulk & chemicals (/inventory/bulk)
Screen address: /inventory/bulk · Roles: ADMIN, OWNER, STORE, PLANNER, WORK_CENTER_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=inventory-bulk

Every bulk stock row — granules, resins, inks, adhesives, solvents, chemicals — by material code, plant, location and class, with reservations.

Open it to find where a granule or chemical sits, how much is free after sales holds, and to export the bulk list. Stock comes in by GRN ("Receive bulk") and goes out by consumption and adjustments.

**Before you start**
- Materials in the master and stock received by GRN or opening stock.

**Step by step**
1. Choose "Pulse" (KPIs and breakdowns) or "Browse" (full table / grid).
2. Pick a saved view: "All bulk" or "Has reservation"; "Save current" stores your own.
3. Search (material, lot, vendor, location) and use the rail: Material code / family, Ink / color shade, Material class, Plant, Location.
4. Tick "Show only reserved rows" or "Purchased add-ons only" if needed.
5. Click a row for its drawer (Code, Grade, Vendor, UOM, Plant, Location, Expiry, Age, Sales reservations), then "Stock card" for its month movements.
6. Press "Export" to download the bulk list; change rows per page (25–500) at the bottom.

**What is on the screen**
- **Material class**: Granules / resin, Inks / pigment, Adhesives, Solvents, Chemicals, Other.
- **ADDON badge**: Only purchased add-ons from the Add-on Master get it; normal inks, adhesives and solvents stay plain bulk.
- **Code**: Quality code row; one material may sit under several codes at one location.
- **Reserved / Available**: Reserved = held for sales orders; Available = On hand − Reserved.

**Common problems and fixes**
- "Could not load bulk inventory." — The stock snapshot failed. Reload; if it repeats tell the administrator.
- "No active reservations." — No sales order holds this row; all of it is free.

**If stuck**
1. If a row seems missing, clear the filter chips ("Clear all") and check the plant and location selectors.

Related pages: /inventory, /inventory/addons, /inventory/grn, /inventory/stock-lifecycle, /inventory/bulk-transactions

### Bulk Transactions (/inventory/bulk-transactions)
Screen address: /inventory/bulk-transactions · Roles: ADMIN, OWNER, STORE, PLANNER, PLANT_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=inventory-bulk-transactions

Read-only log of every bulk (pooled) material movement: inward, consumption, transfer and adjustment, newest first.

Open it to trace why a bulk balance changed: which GRN, job or adjustment moved it and when.

**Before you start**
- Inventory view right. Movements come from GRNs, production consumption, transfers and adjustments.

**Step by step**
1. Read "Recent Activity" (50 per page).
2. Check Type: Inward, Consumption, Transfer, Adjustment.
3. Read Material, Location, Quantity (+ in, − out, with unit) and Reference (Job number or the document reference).
4. Use the pager at the bottom for older rows; for even older ones pick an earlier financial year in the header.

**What is on the screen**
- **Reference**: "Job …" when a production job consumed it; otherwise the document reference or "System Auto".
- **Quantity**: Signed amount in the stock unit (KG 2 decimals, METER 1, PCS whole).

**Common problems and fixes**
- "Showing the newest … of … entries" — The list is capped. Pick an earlier financial year in the header to see older entries.
- "No transactions recorded yet." — No bulk movement in the selected year.

**If stuck**
1. For one material's running balance use the Stock card (Bulk drawer → "Stock card") or the Stock ledger.

Related pages: /inventory/bulk, /inventory/ledger, /inventory/adjustments

**Not done yet / watch out**
- No search, type, material, location or date filter and no export; only paging and the financial year in the header.

### Count at rack (moved) (/inventory/count)
Screen address: /inventory/count · Roles: ADMIN, OWNER, STORE, PLANNER, PLANT_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=inventory-count

Old address for stock counting. It opens Stock lifecycle on the "Stock count" tab.

Counting now lives in one place, "Count and close": stock counts on any day, month end or a period, plus the evening packing count. Old links and the "Count at rack" tab still land there.

**Before you start**
- Stock lifecycle rights (inventory audit view or manage).

**Step by step**
1. Open the link; you land on Stock lifecycle → "Stock count".
2. Choose "Stock count · any day, month end or period" or the packing count, and follow that tab.
3. Update your bookmark to /inventory/stock-lifecycle?tab=count.

**If stuck**
1. If you see an access message after the redirect, ask the administrator for stock lifecycle rights.

Related pages: /inventory/stock-lifecycle, /logistics/packing/consumption

**Not done yet / watch out**
- The Stock tab bar still lists "Count at rack" pointing at this retired route, which only redirects to Stock lifecycle.

### Bills & documents (/inventory/gate-bills)
Screen address: /inventory/gate-bills · Roles: STORE, ADMIN, SUPER_ADMIN, OWNER · Share link: https://erp.totalpolyprint.com/guide?page=inventory-gate-bills

One register for every bill the factory receives — photographed at the gate or uploaded at the office (photos or PDF) — with an inbox, search, filed records, follow-ups and reports.

Work through the Inbox so every paper ends the right way: stock goes to a GRN, job work to its order, spares / machinery / services to a General Receipt, utilities, fees, transport and notes are filed. Only stock posts inventory.

**Before you start**
- Bills & documents rights: Inventory (STORE) has them by default; Owner and Admin always. Other roles or people need documents rights given in the Role matrix or User overrides. A watchman never sees this screen.
- Gate photos come from the watchman's gate terminal; "Upload bill" needs the documents upload right.

**Step by step**
1. Read the counts in the header: need classifying, waiting for receipt, partly received.
2. In "Inbox" pick a stage chip: "Needs classifying", "Waiting for receipt" or "Partly received"; pick the factory if needed. The list refreshes by itself.
3. Click a document row to open it and do its next step (shown in blue on the row, e.g. "Classify it", "Post GRN", "File it").
4. For a bill that came by post or email press "Upload bill": choose the factory, add photos or PDFs, order the pages, optionally "Add bill details now (optional)", then "Upload N files".
5. Use "All documents" or "Filed" to search by invoice no., party, vendor or bill ref with filters (status, category, source, factory, vendor, dates, order) and "Export CSV".
6. In "Non-stock follow-ups" (manage right) press "General receipt" on each old non-stock void to record what it delivered.
7. Open "Reports" for status, ageing, amounts by category, top vendors, General Receipt spend and top machines; Owner/Admin also see "Document storage".

**What is on the screen**
- **Stage**: Waiting for receipt, Partly received, Received, Filed, Voided (plus "Ready to file" for record-only paper).
- **Source**: Gate photo = watchman photographed it on arrival; Office upload = added later, does not claim a gate arrival.
- **Waiting time**: Right-hand number: how long an open bill has waited since arrival.
- **Upload limits**: Up to 20 files and 20 pages per document; photo up to 10 MB, PDF up to 15 MB; JPEG, PNG, WebP or PDF (convert HEIC to JPEG).
- **Possible duplicates**: Same vendor + bill no. + financial year already recorded.

**Common problems and fixes**
- "Uploading bills needs the documents upload right (Inventory by default)." — Ask the Owner/Admin to grant documents upload in the Role matrix.
- "Upload not confirmed" — The network dropped. Press "Send the same upload again" — it never creates a second bill. Discard only if the register does not show it.
- "Not added: … is larger than 10 MB / 15 MB" — Compress the photo or split the PDF.
- "The register export is limited to … documents. Narrow the dates or filters." — Pick a shorter date range or more filters, then export again.

**If stuck**
1. If a save says it is not confirmed (network drop), press the same button again (it now reads "Send same request again" or similar). The system knows the retry and never records twice.
2. If counts say "Counts could not refresh", the last counts are shown; reload the page.

Related pages: /inventory/gate-bills/[id], /inventory/grn, /inventory/general-receipts, /inventory/general-receipts/new, /inventory/job-work, /gate

**Not done yet / watch out**
- The inbox refresh tooltip says every 5 seconds, but the list actually refreshes about every 15 seconds.

### Bill / document (/inventory/gate-bills/[id])
Screen address: /inventory/gate-bills/[id] · Roles: STORE, ADMIN, SUPER_ADMIN, OWNER · Share link: https://erp.totalpolyprint.com/guide?page=inventory-gate-bills-id

One bill: its pages stay beside the form while you type its details, choose the category and take the next step (GRN, job work, General Receipt, file or attach).

Open it from the Inbox to finish one paper without retyping. Saving the details never receives or posts anything; stock changes only when a GRN is posted from here.

**Before you start**
- Bills & documents rights: Inventory (STORE) has them by default; Owner and Admin always. Other roles or people need documents rights given in the Role matrix or User overrides. A watchman never sees this screen.
- Classifying, filing and voiding need the documents manage right; posting a GRN or job-work receipt needs inventory receiving rights.

**Step by step**
1. Keep the bill readable: "Dock beside the form", "Float over the form", "Open in another window" or "Hide the bill (Alt+B)". On a phone it is a bottom sheet.
2. In "What is this paper?" choose the "Document type" and the "Category — decides the next step".
3. Pick the vendor or type the party, then "Bill / invoice number", "Bill date", "Taxable (₹)", "Tax (₹)", "Total (₹)" (use "Set total = taxable + tax" if offered), due date, valid-until and "Shipped to" if needed.
4. Press "Save details".
5. In "Next step" press the button for the category: "Open GRN" (stock), "Receive job work", "Create general receipt" (spares, machinery, service), "Attach to the stock bill" (transport) or "File as record".
6. If a GRN was already posted before the photo was reviewed, use "Match an existing receipt" and tick it to close if it covers every line.
7. When the bill shows "Partly received" and every line is in, press "Confirm all lines received", give a reason and "Close bill as received".
8. Use "More actions" for "Attach to another bill…", "File as record…", "Detach from main bill…", "Reopen…" (Owner/Admin) or "Void…".

**What is on the screen**
- **Category**: Stock items (GRN); Job work; Spares and parts / Machinery and equipment / Service / repair → General Receipt; Utility, Professional / statutory fee, Other expense → file; Transport / freight → attach to the stock bill or file.
- **Document type**: Tax invoice, Delivery challan, Transport LR / consignment note, Debit note, Credit note, Service report, Utility bill, Other document.
- **Payment due date**: Optional; reminder from 3 days before.
- **Valid until (licence / AMC)**: Optional; renewal reminders at 60, 30 and 7 days.
- **Shipped to**: When the bill is addressed to this factory but goods went to another; receipts may then be recorded there.
- **Receipts linked / Timeline**: GRNs and receipts against the bill (reversed ones stay for history) and every event on it.
- **Shortcuts**: Alt+B show/hide, Alt+←/→ page, Alt+= / − zoom, Alt+0 fit width, Alt+R rotate; work while typing.

**Common problems and fixes**
- "Someone else saved this document while you were editing." — Another reviewer saved first. Their values are loaded behind your edits; check, then save again or discard yours.
- "Save or discard the changed details first, so the next screen uses them." — Press "Save details" before "Open GRN" or the General Receipt button.
- "Only record-only paper can be filed …" — Pick a utility, fee, transport or other-expense category, or a note / report document type, before filing.
- "A bill with posted receipts cannot be voided. Review its remaining lines." — Receipts are linked; confirm it complete instead, or ask Owner/Admin.
- "Same invoice already recorded." — The same vendor bill number is on another document. Void this one as "Duplicate", or give a reason to file/receive it anyway.
- "Posting a GRN needs inventory receiving rights." — An Inventory (Store) user must post the GRN from this bill.

**If stuck**
1. If a save says it is not confirmed (network drop), press the same button again (it now reads "Send same request again" or similar). The system knows the retry and never records twice.
2. If "Live refresh failed" shows, press "Retry"; the last loaded state is on screen.
3. A filed or voided bill was wrong: Owner/Admin uses "More actions" → "Reopen…" with a reason.

Related pages: /inventory/gate-bills, /inventory/gate-bills/[id]/view, /inventory/grn, /inventory/job-work, /inventory/general-receipts/new

### Bill viewer (pop-out) (/inventory/gate-bills/[id]/view)
Screen address: /inventory/gate-bills/[id]/view · Roles: STORE, ADMIN, SUPER_ADMIN, OWNER · Share link: https://erp.totalpolyprint.com/guide?page=inventory-gate-bills-id-view

Shows one bill alone in its own window, ideal for a second monitor, while the form stays in the main window.

Opened by "Open in another window" on the bill, GRN or General Receipt screen. Page, zoom, rotation and pinned area follow the form window.

**Before you start**
- Bills & documents rights: Inventory (STORE) has them by default; Owner and Admin always. Other roles or people need documents rights given in the Role matrix or User overrides. A watchman never sees this screen.

**Step by step**
1. On the form screen press "Open in another window"; drag the new window to the second monitor.
2. Check the chip: "Follows the form window" means it is linked; "Form window not open" means it is not.
3. Drag to move the page, Ctrl/⌘ + scroll or pinch to zoom, double-click to zoom in, Shift-drag to pin the part you are copying.
4. Alt + ←/→ changes the page, Alt+= / − zooms, Alt+0 fits width, Alt+R rotates — even while typing in the form.
5. Press "Close window" (or "Bring back" in the form) to dock the bill beside the form again.

**What is on the screen**
- **Save rotation for everyone**: Rotation is only for you unless you press this; the stored image is never changed.

**Common problems and fixes**
- "You cannot open this bill" — Bills are for the inventory team; ask an administrator for the documents permission.
- "This bill link is not valid" — Open the bill again from the bill register or the GRN screen.
- "This bill is no longer available" — It belongs to another factory or the link is wrong; reopen it from the register.

**If stuck**
1. If pages stop following the form, close this window and press "Open in another window" again.

Related pages: /inventory/gate-bills/[id], /inventory/grn, /inventory/general-receipts/new

### Gate passes (/inventory/gate-passes)
Screen address: /inventory/gate-passes · Roles: STORE, ADMIN, SUPER_ADMIN, OWNER · Share link: https://erp.totalpolyprint.com/guide?page=inventory-gate-passes

Numbered returnable (RGP) and non-returnable (NRGP) gate passes for machine parts, tools and equipment leaving the factory. Gate passes never move stock.

Open it to see what is outside the factory, with whom and when it must come back, and to raise a new pass. The watchman scans the printed QR when items leave; returns close the pass.

**Before you start**
- Bills & documents rights: Inventory (STORE) has them by default; Owner and Admin always. Other roles or people need documents rights given in the Role matrix or User overrides. A watchman never sees this screen.
- Raising, issuing and closing passes needs the gate pass right (gatepass.manage).

**Step by step**
1. Read the header counts: open and overdue.
2. Pick a tab: "Open", "Overdue", "Returned / closed", "Drafts", "All".
3. Search by number, party, item, serial or vehicle; filter by Factory, Type, Vendor and Machine.
4. Click a pass to open it (issue, print, receive back, short-close).
5. Press "New gate pass" to raise one.

**What is on the screen**
- **Type**: Returnable (RGP): repair, calibration, fabrication, trial or loan, open until all items return or short-closed. Non-returnable (NRGP): scrap sale, sample or return to supplier, closes when it leaves the gate.
- **Status**: Draft, Issued · waiting at gate, Out of factory, Partly returned, Returned, Closed, Short-closed, Cancelled; Overdue N days in red.
- **Lines back / due back**: For an RGP that is out: how many lines are back and the expected return date.

**Common problems and fixes**
- "Gate passes are for the inventory team" — Your account has no documents right; ask the administrator.

**If stuck**
1. If the list looks old, it refreshes every 30 seconds; switch tabs or reload.

Related pages: /inventory/gate-passes/new, /inventory/gate-passes/[id], /inventory/general-receipts, /inventory/goods-movements, /gate

### Gate pass (/inventory/gate-passes/[id])
Screen address: /inventory/gate-passes/[id] · Roles: STORE, ADMIN, SUPER_ADMIN, OWNER · Share link: https://erp.totalpolyprint.com/guide?page=inventory-gate-passes-id

One gate pass with its details, items (qty, back, still out), returns, gate exit photos and history, plus Issue, Print, Receive back, Short-close and Cancel.

Use it to issue a draft, print it for the gate, and track it until every returnable item is back or the pass is short-closed.

**Before you start**
- Bills & documents rights: Inventory (STORE) has them by default; Owner and Admin always. Other roles or people need documents rights given in the Role matrix or User overrides. A watchman never sees this screen.
- The gate pass right (gatepass.manage) for any change.

**Step by step**
1. For a draft: press "Edit draft" if needed, then "Issue" to get the number.
2. Press "Print PDF" ("Preview PDF" for a draft) and send the paper with the items.
3. If the items leave on another paper, use the QR label button and stick the label on that paper; the gate scans it.
4. When the watchman scans it, the status becomes "Out of factory".
5. When items return with a vendor bill, record a General Receipt against the bill and tick "Came back on a returnable gate pass (RGP)".
6. When items return without a bill, press "Receive back", enter the quantity per line and a reason.
7. If the rest will not come back, press "Short-close" with a reason; to stop an unused pass press "Cancel pass".

**What is on the screen**
- **Still out**: Quantity of each line not yet returned.
- **Returns**: Every return recorded once and never edited, with linked General Receipt lines.
- **Gate exit photos**: Outward photos the gate linked by QR scan or office match.
- **Details**: Party, address, GSTIN, purpose, expected back, carried by, vehicle, issued, left the gate, closed, approx. value, notes.

**Common problems and fixes**
- "Only … of line … is still out on …" — You entered more than is still out. Enter the remaining quantity or less.
- "This gate pass was changed by someone else. Reload it and try again." — Reload the page and repeat the action.
- "Set an expected return date of today or later before issuing." — The return date passed while it was a draft; "Edit draft" and set a new date.
- "This gate pass is still a draft. Ask the office to issue it before the items leave." — Shown at the gate when a draft is scanned. Press "Issue" here.

**If stuck**
1. If a save says it is not confirmed (network drop), press the same button again (it now reads "Send same request again" or similar). The system knows the retry and never records twice.
2. A General Receipt that brought items back cannot be reversed; correct the pass with an owner first.

Related pages: /inventory/gate-passes, /inventory/general-receipts/new, /inventory/goods-movements, /gate

### New gate pass (/inventory/gate-passes/new)
Screen address: /inventory/gate-passes/new · Roles: STORE, ADMIN, SUPER_ADMIN, OWNER · Share link: https://erp.totalpolyprint.com/guide?page=inventory-gate-passes-new

Form to raise an RGP (items come back) or NRGP (items do not come back). It is saved as a draft first, then issued to get its number and QR.

Use it whenever a part, tool or equipment (not stock) leaves the factory. Stock to another plant uses Inter-plant, material to a job worker uses Job work, goods to a customer use the Dispatch bay.

**Before you start**
- Gate pass right (gatepass.manage); factories and machines set up; vendor in the master or the party name.

**Step by step**
1. Under "Type of gate pass" choose Returnable (RGP) or Non-returnable (NRGP).
2. In "Where the items go" pick "Factory (items leave from)" and "Purpose".
3. Pick the "Vendor" or fill "Or party name (not in vendor list)", "Address" and optional "GSTIN".
4. For an RGP set "Expected back by"; add "Carried by", "Vehicle" and printed notes if useful.
5. Under "Items" add one line per item: Description, Qty, Unit, Machine (optional), Equipment, Serial no., Approx. value ₹, Remarks.
6. Press "Save as draft", or "Save and issue" to get the number at once. Then print it on the next screen.

**What is on the screen**
- **Purpose**: Repair, calibration, fabrication, trial, loan for RGP; scrap sale, sample, return to supplier for NRGP. Scrap sale is not allowed on an RGP.
- **Machine**: Link the machine when the part belongs to one, so its machine history shows the trip.
- **Expected back by**: Required for RGP; cannot be in the past. After it passes the pass shows Overdue.

**Common problems and fixes**
- "A returnable gate pass needs an expected return date." — Fill "Expected back by".
- "Choose a vendor or type who the items go to." — Pick a vendor or type the party name.
- "Scrap sale items do not come back. Use a non-returnable gate pass (NRGP)." — Switch the type to NRGP.
- "Enter a valid 15-character GSTIN or leave it blank." — Correct the GSTIN or clear it.
- "Draft saved, but it could not be issued: …" — The draft exists; press "Issue" on the next screen after fixing the reason shown.

**If stuck**
1. If a save says it is not confirmed (network drop), press the same button again (it now reads "Send same request again" or similar). The system knows the retry and never records twice.

Related pages: /inventory/gate-passes, /inventory/gate-passes/[id], /inventory/goods-movements

**Not done yet / watch out**
- "Save and issue" saves the draft even when issuing fails; the user lands on the draft and must press "Issue" again.

### General receipts (/inventory/general-receipts)
Screen address: /inventory/general-receipts · Roles: STORE, ADMIN, SUPER_ADMIN, OWNER · Share link: https://erp.totalpolyprint.com/guide?page=inventory-general-receipts

Register of spares, machinery, tools, services and charges: what came in or what work was done, who confirmed it, when, and on which machine. These never change stock.

Open it to find a past non-stock purchase or to see a machine's full history of spares, service visits and gate-pass trips.

**Before you start**
- Bills & documents rights: Inventory (STORE) has them by default; Owner and Admin always. Other roles or people need documents rights given in the Role matrix or User overrides. A watchman never sees this screen.

**Step by step**
1. On "Receipts" search GR no., party, invoice, item or serial.
2. Filter by type (Goods / Services), line type, status (Posted / Reversed), factory and dates.
3. Click a receipt to open, print or (Owner/Admin) reverse it.
4. On "Machine history" choose the factory and machine to see every spare, service and gate-pass movement, newest first.
5. Press "New general receipt" (documents manage right) to record one without a bill; normally start it from the bill.

**What is on the screen**
- **Amount**: Total including GST on the right of each row.
- **Line type**: Spares and parts, Machinery / equipment, Tools, General consumable, Safety items, Electrical, Civil / building, Office / admin, Service / labour, Freight / other charge.
- **Machine history**: Receipt lines (reversed ones struck through) and "Left on gate pass" / "Came back on gate pass" events.

**Common problems and fixes**
- "General receipts are for the Inventory team" — No documents view right; ask the administrator.
- "No general receipts" — Nothing for these filters. Clear filters or widen the dates.

**If stuck**
1. A receipt is missing from a machine's history: open it and check the line has that machine chosen.

Related pages: /inventory/general-receipts/new, /inventory/general-receipts/[id], /inventory/gate-bills, /inventory/gate-passes

### General receipt (/inventory/general-receipts/[id])
Screen address: /inventory/general-receipts/[id] · Roles: STORE, ADMIN, SUPER_ADMIN, OWNER · Share link: https://erp.totalpolyprint.com/guide?page=inventory-general-receipts-id

A read-only, printable general receipt with its lines, GST, machine and gate-pass links and its bill.

Proof of what was received or what work was done. Mistakes are corrected only by reversal; nothing is deleted.

**Before you start**
- Bills & documents rights: Inventory (STORE) has them by default; Owner and Admin always. Other roles or people need documents rights given in the Role matrix or User overrides. A watchman never sees this screen.

**Step by step**
1. Check the header: number, factory, Posted / Reversed, "No stock posted".
2. Check Party, Bill / invoice, Bill in register, Received by (or Work confirmed by), Received at, Recorded by and PO / work order.
3. Check lines: Description, Type, Qty, Rate, Amount, GST, Machine / equipment, What happened; totals Before GST, GST, Total.
4. Press "Print" for the file copy (signature lines are printed).
5. Owner/Admin: press "Reverse…", write a reason (5–500 characters) and "Reverse receipt".

**What is on the screen**
- **Bill in register**: Link to the bill; "Not linked yet" if made without one; notes when it follows up an old non-stock void.
- **What happened**: Kept in store, Installed / fitted, Used immediately, Not applicable.

**Common problems and fixes**
- "… recorded items coming back on gate pass …, so it cannot be reversed." — Reversing would not undo the return. Correct the gate pass with an owner first and record a fresh receipt if needed.
- "Only an owner or administrator can reverse a General Receipt." — Ask the Owner/Admin.
- "General receipt not found" — Wrong link or a factory outside your access.

**If stuck**
1. After a reversal the bill goes back to waiting (or partly received); record a new receipt from the bill.
2. If a save says it is not confirmed (network drop), press the same button again (it now reads "Send same request again" or similar). The system knows the retry and never records twice.

Related pages: /inventory/general-receipts, /inventory/gate-bills/[id], /inventory/gate-passes/[id]

### New general receipt (/inventory/general-receipts/new)
Screen address: /inventory/general-receipts/new · Roles: STORE, ADMIN, SUPER_ADMIN, OWNER · Share link: https://erp.totalpolyprint.com/guide?page=inventory-general-receipts-new

Record goods received or service work done against a bill, with the bill beside the form. It never touches production stock.

Opened from a classified bill ("Create general receipt"), from a non-stock follow-up, or empty. It records what arrived, who received or confirmed it, where it went and on which machine, and can close returnable gate-pass lines.

**Before you start**
- Bills & documents rights: Inventory (STORE) has them by default; Owner and Admin always. Other roles or people need documents rights given in the Role matrix or User overrides. A watchman never sees this screen.
- Recording needs the documents manage right. The bill must be classified as spares, machinery or service and still open.

**Step by step**
1. Under "What came in?" choose "Goods" or "Service / work done".
2. Check the factory, vendor or party, "Bill / invoice number" and "Bill date" (filled from the bill).
3. Set "Received by" / "Work confirmed by" and "Received at"; add PO / work order reference and a note if any.
4. In "Lines" fill Description (suggestions from past receipts), Type, Qty, Unit, Rate (₹), GST % — Amount = Qty × Rate.
5. Choose "What happened" and the "Machine" (or "Equipment (if not a listed machine)"); add serial and remarks.
6. If the item came back on an RGP, tick "Came back on a returnable gate pass (RGP)", choose the line and the returned quantity.
7. Press "Add line" for more. Tick "This receipt completes the bill" only if every bill line is covered.
8. Press "Save general receipt" (or "Save receipt & complete bill"), then "Open receipt".

**What is on the screen**
- **Type (line)**: Line category, e.g. Spares and parts, Tools, Service / labour, Freight / other charge.
- **Unit**: NOS, PCS, SET, PAIR, KG, LTR, MTR, BOX, ROLL, JOB, HRS, VISIT, LOT.
- **GST %**: 0, 5, 12, 18, 28 or 40.
- **What happened**: Kept in store, Installed / fitted (machine or equipment required), Used immediately, Not applicable (services).
- **Totals**: Before GST, GST and Total at the bottom.

**Common problems and fixes**
- "Amount must equal quantity × rate = …" — Correct the quantity or rate.
- "A service receipt needs at least one Service / labour line." — Set one line's type to Service / labour, or switch to Goods.
- "A goods receipt needs at least one goods line (not only service or freight)." — Add a goods line or switch to Service.
- "Choose the machine (or type the equipment) it was installed on." — Installed lines need a machine or equipment name.
- "Only … of line … is still out on …" — You cannot return more than is still out on the RGP line.
- "Received time cannot be in the future." — Fix "Received at".
- "Give a reason to receive a bill whose invoice is already recorded (or void this bill as a duplicate)." — Fill the reason in "Same invoice already recorded" or void the bill as duplicate.
- "This bill is classified as record-only paper … Change its category before receiving against it." — Go back to the bill and change the category to spares, machinery or service.

**If stuck**
1. If a save says it is not confirmed (network drop), press the same button again (it now reads "Send same request again" or similar). The system knows the retry and never records twice.
2. "I checked — it was not saved, unlock the form" only after checking General receipts does not show it.

Related pages: /inventory/general-receipts, /inventory/gate-bills/[id], /inventory/gate-passes, /inventory/general-receipts/[id]

**Not done yet / watch out**
- If the open gate-pass endpoint is missing the RGP box says gate passes are not available and the pass must be closed later from its own page.

### Goods in & out (/inventory/goods-movements)
Screen address: /inventory/goods-movements · Roles: ADMIN, OWNER, SUPER_ADMIN, STORE, PLANNER, PLANT_MANAGER, DISPATCH · Share link: https://erp.totalpolyprint.com/guide?page=inventory-goods-movements

One list of everything of ours outside a factory gate and what is due back: inter-plant transfers, job work, returnable and non-returnable gate passes.

See at a glance what is outside, what is back at a gate waiting for the store, what paper is made but not left, and what is late. Each paper keeps its own screen; open the row to work on it.

**Before you start**
- Inventory view right. "New movement" needs inventory manage or the gate pass right.

**Step by step**
1. Pick a stage: "Outside", "Back at gate", "Prepared" or "Done" (each shows a count).
2. Search number, party, vehicle or job; use the chips All, Inter-plant, Job work, Returnable, Non-returnable.
3. Press "Late" to see returns past due and loads in transit too long.
4. Press "Open" (or "Receive" for rows back at the gate) to work on the paper in its own screen.
5. If the watchman could not scan the paper, use "Mark back at gate" on the row; the store is told to receive it. Nothing moves in stock.
6. "New movement" asks "What is leaving?": another factory (Inter-plant challan), a job worker (job-work order and challan), a part that comes back (RGP), something that does not (NRGP), or goods to a customer (Dispatch bay).

**What is on the screen**
- **Stage**: Outside = in transit, at a job worker or out on a pass; Back at gate = arrived, store still to receive; Prepared = paper made, goods not left; Done = received, returned or closed.
- **Left / (no gate scan)**: When it left; "no gate scan" means the gate did not record it.
- **Due back / Late**: Expected return date; a red Late tag when past due (hover for the note).
- **route step / from production**: Rows created automatically by a job route step or production.

**Common problems and fixes**
- "Not recorded (after Mark back at gate)" — The paper is already received or belongs to another factory's gate. Open the row to check.

**If stuck**
1. If a save says it is not confirmed (network drop), press the same button again (it now reads "Send same request again" or similar). The system knows the retry and never records twice.
2. If the list looks old, reload before acting on it.

Related pages: /inventory/inter-plant, /inventory/job-work, /inventory/gate-passes, /inventory/gate-passes/new, /inventory/outward-documents, /logistics/dispatch

**Not done yet / watch out**
- "Mark back at gate" only notifies the store; it does not receive the goods or move stock, so the row stays "Back at gate" until the paper is received on its own screen.

### Receive goods (Smart GRN) (/inventory/grn)
Screen address: /inventory/grn · Roles: ADMIN, OWNER, STORE · Share link: https://erp.totalpolyprint.com/guide?page=inventory-grn

One form to receive a supplier invoice into stock: film rolls, bulk material, packaging or trading goods. Totals, GST, freight and the post button stay in the bar at the bottom.

Open it when goods arrive at the store against a purchase order, a vendor's own PO reference or no PO. Posting creates the rolls / stock rows and the ledger entries. If the bill was first photographed at the gate, open it from Bills & documents so the bill sits beside the form and gets linked in the same save. Job-work returns are not received here (use Job work → Receive) and inter-plant receipts are received in Inter-plant.

**Before you start**
- Vendor exists, is active and is of type Raw Material (RM) or Hybrid (BOTH).
- Material masters exist: film variants for rolls, bulk categories (granule, ink, adhesive, solvent, POD, purchased add-on) and packaging items.
- A receiving warehouse (store location) of the right plant; virtual locations are refused.
- For 'Against system PO' the PO must be sent / acknowledged / partly received and still have open quantity for this stock class.
- Inventory manage or purchase receipt rights.

**Step by step**
1. 1. Pick the stock class: "Bulk material", "Film roll", "Packaging" or "Trading goods".
2. 2. Under "Where is this coming from?" choose "Against system PO", "Manual vendor PO ref" or "Direct receipt", then fill vendor, "Vendor invoice #", "Vendor invoice date", "LR / vehicle / driver" and "Receiving warehouse".
3. 3. Under "What did you actually receive?" fill the first line. For rolls use the fast roll grid: film variant, stock form, width, micron, gross, tare (net fills itself), length, grade, location, rate. Enter on the last field starts the next roll as a copy, so only weights change.
4. 4. Many rolls at once: paste rows from Excel into the grid, or use "Live template" then "Upload Excel"; check the "Excel validated · review before posting" list.
5. 5. Open "QC checks & documents" only when a COA, lab values (density, MFI, moisture) or inspector notes are needed.
6. 6. Check "Costs & taxes": material subtotal, GST, freight, other charges, grand total.
7. 7. When the bottom bar shows "Ready to post" (all chips ✓), press "Submit & post" (Ctrl/⌘+Enter). Trading goods post with "Post from trading row".
8. 8. The green "Posted GRN-…" box confirms the quantity and movements; download roll labels there if needed. The form resets for the next receipt.

**What is on the screen**
- **Stock class**: Decides the grid: rolls (one row per physical roll), bulk/packaging (one row per material and location) or a trading-good row.
- **Source type**: Against system PO locks lines to the PO's open lines; Manual vendor PO ref only stores the vendor's reference; Direct receipt has no PO.
- **Vendor invoice #**: Checked for duplicates per vendor; the same invoice number cannot be received twice for one vendor.
- **Receiving warehouse**: The plant is taken from this warehouse. With a gate bill linked, only the bill's factory locations are offered.
- **Supplier roll number**: Optional number printed on the supplier's roll; it is the physical identity used to find the roll later.
- **Stock form**: Open web / sheet, Lay-flat tube or Folded web. Width is read as open width, lay-flat width or folded width accordingly.
- **Gross kg / Tare kg / Net kg auto**: Net = gross − tare. Gross must equal net + tare within 0.05 kg.
- **Grade**: Required for extrudable film variants.
- **Granule code**: Quality / inward code of a granule; must be active and belong to that granule.
- **Download 4 × 2 inch roll labels after saving inward (optional)**: Tick to get roll labels right after posting. Labels are optional; a roll can be identified by supplier number or handwritten ERP ID and location.
- **Bottom bar chips**: Vendor, Warehouse, System PO (when against PO), Materials, Qty, Period. Each must show ✓ before posting.
- **Grid keys**: Enter next field · Enter on last field = new line (copy) · Shift+Enter back · ↑ ↓ same field other line · Alt+↓ copy down · Alt+⌫ remove line · Ctrl/⌘+Enter receive.

**Common problems and fixes**
- "Duplicate vendor invoice '…' for vendor …" — This invoice number was already received for this vendor. Check GRN history; correct the old GRN instead of posting again.
- "Vendor is required before posting GRN." — Pick the vendor in the Source section.
- "GRN vendor must be RM or BOTH type." — A job-worker or service vendor cannot supply stock. Change the vendor type in Vendors or pick the right vendor.
- "Roll gross weight must equal net + tare within 0.05 KG." — Re-weigh or fix gross / tare; leave net to fill itself.
- "Roll label … already exists." — The label is already used by another roll. Leave the label blank so the system numbers it.
- "Grade is required for extrudable film variants." — Pick the grade on that roll line.
- "Selected PO has no receivable lines for this stock class." — The PO is fully received or is for another class. Pick another PO or use Direct receipt.
- "Use the receiving grid while a gate bill is linked. Excel posting does not link this bill." — Enter the rolls in the grid (paste works) so the bill gets linked.
- "Stock saved; label download needs retry" — The GRN is posted. Use "Download all labels" on the saved receipt; do not post again.
- "Master data did not load." — Vendors, materials or locations could not be fetched. Refresh; if it repeats tell the admin.

**If stuck**
1. If posting times out, check GRN history for the invoice before pressing again.
2. A wrong quantity, rate or roll spec after posting is fixed with "Correct" in GRN history, not with a new GRN.
3. If a material or vendor is missing from the pickers, ask the admin to add or activate the master.

Related pages: /inventory/grn-history, /inventory/gate-bills, /procurement/purchase-orders, /inventory/rolls, /inventory/bulk, /inventory/packaging, /inventory/job-work, /inventory/inter-plant

**Not done yet / watch out**
- The "Save draft" button at the bottom of Smart GRN has no action; a half-entered receipt cannot be saved and is lost on leaving the page.
- Excel roll upload cannot be used while a gate bill is linked; the rolls must be entered or pasted in the grid.
- After a timed-out post there is no on-page duplicate check for bulk lines other than the vendor-invoice check; the user must look in GRN history.

### GRN history & corrections (/inventory/grn-history)
Screen address: /inventory/grn-history · Roles: ADMIN, OWNER, STORE, PLANNER · Share link: https://erp.totalpolyprint.com/guide?page=inventory-grn-history

Every inward GRN row — roll, bulk, packaging and trading — with filters, totals and audited corrections until the financial year closes.

Use it to find what came in (by source, time window, plant, vendor or search), export it, and correct a posted GRN row. The original GRN stays locked; a correction posts a separate entry with before, after, delta, user and reason.

**Before you start**
- GRNs posted from Smart GRN.
- Correcting needs inventory manage rights and an open financial year.

**Step by step**
1. 1. Pick "Source" (All, Roll, Bulk, Packaging, Trading) and "Time window" (Today, 7 days, 30 days, This FY, All time) in the left rail; add plant / vendor filters or search.
2. 2. Read the tiles: inward rows, total qty, roll / bulk / packaging GRNs, top vendors.
3. 3. Use Export for a CSV of the history.
4. 4. On a wrong row press "Correct" to open "Correct GRN row".
5. 5. Enter the corrected quantity / unit rate, or for rolls the label, batch, width, micron, length or roll form; optionally move plant / location.
6. 6. Choose "Reason code · required" and write "Reason · required", then press "Post correction".

**What is on the screen**
- **Effective qty / Effective unit rate**: The value after all earlier corrections; the row shows "corrected effective" when changed.
- **Year-closed**: Rows of a closed financial year are read-only.
- **Reason code**: Quantity mismatch, Rate mismatch, Roll identity/spec correction, Other approved correction.
- **Corrected plant / location**: "Keep current plant" / "Keep current location" unless the goods were booked to the wrong place.
- **Saved views**: Save a filter set by name and pin it.

**Common problems and fixes**
- "Reason is required before this correction can post." — Write the reason; it is kept in the audit trail.
- "This roll already has genealogy or consumption history. Use stock count / correction instead." — The roll has been used or split. Fix it with a stock count or adjustment.
- "Consumed or scrapped rolls cannot be corrected from GRN history." — Use the stock count / correction route.
- "Corrected roll weight must be greater than zero." — Enter a positive weight; to remove a roll use a stock adjustment.
- "Cannot reduce this trading-good GRN below already dispatched/adjusted stock." — Part of the stock is already gone; reduce only what is still in stock.

**If stuck**
1. No rows? Widen the time window to "All time" and clear the chips.
2. A year-closed row needs an FY correction from Count and close → Year end; ask the owner.

Related pages: /inventory/grn, /inventory/stock-lifecycle, /inventory/traceability

### Ink floor (moved to Ink control) (/inventory/ink-floor)
Screen address: /inventory/ink-floor · Roles: ADMIN, OWNER, STORE, PLANNER, WORK_CENTER_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=inventory-ink-floor

This old address opens Ink control (/production/ink-control). Ink issue, return and floor counts are done there.

The ink floor screen was merged into Ink control so inks are issued, returned and counted in one place. The Floor menu link "Ink floor" still points here and forwards you.

**Before you start**
- Rights to open Ink control.

**Step by step**
1. 1. Open "Ink floor" from the Floor menu or this address.
2. 2. You land on Ink control; do the issue, return or count there.
3. 3. The ink floor count proof for a date is also shown under Count and close → Stock count.
4. 4. Update any bookmark to /production/ink-control.

**If stuck**
1. If the redirect shows an access message, you lack Ink control rights; ask the admin.

Related pages: /production/ink-control, /inventory/stock-lifecycle

**Not done yet / watch out**
- The Floor menu still lists "Ink floor" although the page only redirects to Ink control.

### Inter-Plant Transfers (/inventory/inter-plant)
Screen address: /inventory/inter-plant · Roles: ADMIN, OWNER, STORE, PLANNER, WORK_CENTER_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=inventory-inter-plant

Move rolls and bulk stock from one plant to another on a delivery challan: draft, dispatch (stock goes to the source plant's IN_TRANSIT), then receive at the destination.

Use it whenever material physically goes between plants. A roll cannot be moved to another plant any other way. Open challans block the financial-year close, so receive every in-transit challan.

**Before you start**
- Both plants exist; plant legal profiles (GST, address) are set under "Plant Legal Profiles".
- Rolls are AVAILABLE, not empty, not quarantined and not reserved for a job.
- The source plant has its IN_TRANSIT system location.
- Inventory or production rights.

**Step by step**
1. 1. Press "New Transfer" → "Create Inter-Plant Challan".
2. 2. Pick "Source Plant", "Destination Plant" and "Material Type" (Rolls or Bulk), then the source and destination locations.
3. 3. Tick rolls under "Available Rolls" or enter "Qty kg" for bulk lines.
4. 4. Leave "Dispatch immediately after create" on to send now, or off to keep a draft.
5. 5. A draft card in the "Draft" column: press "Dispatch", pick lines, "Confirm Dispatch".
6. 6. Press "Print" for the challan PDF and QR sticker; the challan travels with the truck.
7. 7. At the destination, on the "In Transit" card press "Receive", choose "Target Location", tick "Transit Rolls" / "Transit Bulk" and press "Confirm Receipt".

**What is on the screen**
- **Total Challans / Draft / In Transit / Received**: Counts of challans in each stage; the three columns below list them.
- **AUTO**: Marks a challan created automatically by the system.
- **Remainder**: Unconsumed parent roll returned to reusable stock, shown as out / back.
- **Destination Location**: Captured at create as guidance; the real place is chosen at receipt as Target Location.

**Common problems and fixes**
- "Source and destination must be different." — Pick two different plants.
- "Roll … is not AVAILABLE. / has an active job reservation." — The roll is reserved or in process. Unreserve it on the WC terminal or pick another roll.
- "Roll … is empty or quarantined." — Release the quarantine or choose another roll.
- "System location IN_TRANSIT not found for source plant." — Ask the admin to add the IN_TRANSIT location for that plant.
- "Challan is not IN_TRANSIT." — It was already received or never dispatched. Refresh the page.
- "Select at least one pending challan line to receive." — Tick the rolls / bulk that arrived.
- "Popup blocked. Allow popups to print challan." — Allow pop-ups for the ERP in the browser and press Print again.

**If stuck**
1. If a dispatch save timed out, refresh before trying again; the transfer key stops a double send.
2. A roll missing from "Available Rolls" is reserved, quarantined or at another plant; check it in Roll genealogy.

Related pages: /inventory/inter-plant/print/[id], /factory/plants, /inventory/rolls, /inventory/traceability, /inventory/stock-lifecycle

**Not done yet / watch out**
- The page has no cancel for a draft challan and no search or date filter on the Draft / In Transit / Received columns.
- The destination location chosen at create is only guidance; the real location is picked again at receipt.

### Inter-plant challan · Preview and Print (/inventory/inter-plant/print/[id])
Screen address: /inventory/inter-plant/print/[id] · Roles: ADMIN, OWNER, STORE, PLANNER, WORK_CENTER_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=inventory-inter-plant-print-id

PDF preview of one inter-plant delivery challan with Open PDF, Print and the QR gate sticker.

Opens in a new tab from the Print button on an inter-plant challan. Print the challan to send with the truck and the QR sticker the gate scans at departure.

**Before you start**
- The challan exists (opened from Inter-Plant Transfers).

**Step by step**
1. 1. Wait for the preview to load.
2. 2. Press "Print"; if the browser blocks the pop-up, press "Open PDF" and print from the viewer.
3. 3. Print the QR gate sticker (choose copies) and stick it on the challan or load.
4. 4. Close the tab; the challan stays in its column on Inter-Plant Transfers.

**What is on the screen**
- **Challan ID**: Internal id of the challan shown under the heading.
- **QR gate sticker**: 4 × 2 inch label the watchman scans so the departure matches itself.

**Common problems and fixes**
- "Unable to load PDF preview." — The challan id is wrong or the server failed. Reopen Print from the challan card.
- "Popup was blocked. Use "Open PDF" and print from the viewer." — Allow pop-ups or use Open PDF.

**If stuck**
1. Close the tab and press Print on the challan again.

Related pages: /inventory/inter-plant, /inventory/outward-documents

### Job work (/inventory/job-work)
Screen address: /inventory/job-work · Roles: ADMIN, OWNER, SUPER_ADMIN, STORE, PLANNER · Share link: https://erp.totalpolyprint.com/guide?page=inventory-job-work

Material sent to outside job workers: orders, Rule 45 challans, returns, balances, overdue items, reports and bill linking.

Create an order when a route step goes out (Planned route step) or in-house capacity is short (Emergency handoff), then track what is still at each job worker and keep the GST ITC-04 one-year limit. Opened from a job-work bill (?bill=), it shows the vendor's open orders and returns without a bill.

**Before you start**
- Job worker vendor: active, type Job Worker or Hybrid, supports the process and mapped to the plant.
- For a planned step, a released / running / paused production job.
- Inventory manage rights to create, send, receive and close; others can only view.

**Step by step**
1. 1. Pick a view: "Open", "At vendor", "Overdue", "Closed", "Reports" (Owner also sees "Before upgrade").
2. 2. Filter by plant and job worker or "Search JWO, challan, return, job no. or vendor".
3. 3. Press "New job-work order": choose "Planned route step" or "Emergency handoff", the production job, process, job worker, expected output and quantity, "Expected back by", "Agreed labour rate (₹, before GST)" and "Balance tolerance %".
4. 4. Open the order to send material, receive returns and close it.
5. 5. Reports: "Material at job workers" by age and "Yield and wastage by job worker" for a period.
6. 6. From a bill: pick the open order the material belongs to, or under "Already received — link this bill" tick the returns the bill charges for and press Link.

**What is on the screen**
- **Status**: Draft · At job worker · Partly returned · All returned (ready to close) · Closed · Cancelled.
- **ITC-04 badge**: Material at the job worker for 300+ days; GST allows one year.
- **Production continued**: The route step was completed with what came back; the rest is still expected.
- **Expected back by**: Overdue alerts start after this date.
- **Balance tolerance %**: Unexplained difference allowed between material sent and material accounted for.
- **Expected output**: Finished pieces, Rolls or Bulk material. Finished pieces need a production job.

**Common problems and fixes**
- "Vendor is not compatible for this jobwork context." — The job worker must be active, of type Job worker/Hybrid, support the process and be mapped to the plant. Fix the vendor master.
- "Pick the production job whose route step goes to job work." — A planned route step needs its job.
- "Say why this work goes out in an emergency." — Fill "Why is it going out?" for an emergency handoff.
- "Job … is …; only released, running or paused jobs can go to job work." — Release the job in the planner first.
- "This document is not classified as a job-work bill. Change its category in Bills & documents first." — Classify the bill as job work, then reopen.

**If stuck**
1. If a save times out, press the same button again — the retry is recognised and never records twice. Use "Start over with my edits" to send a fresh request.
2. Owner: rolls the old screen left at a job worker are settled under "Before upgrade".

Related pages: /inventory/job-work/[id], /inventory/gate-bills, /inventory/outward-documents, /inventory/vendors, /logistics/packing

**Not done yet / watch out**
- Job-work rate cards are saved from the order form, not from the Vendors page in Inventory.

### Job-work order (/inventory/job-work/[id])
Screen address: /inventory/job-work/[id] · Roles: ADMIN, OWNER, SUPER_ADMIN, STORE, PLANNER · Share link: https://erp.totalpolyprint.com/guide?page=inventory-job-work-id

One job-work order: what was sent, challans, returns, the balance at the job worker, bill link and timeline.

Send material on a Rule 45 challan, receive what comes back so finished goods, balance rolls and wastage are all accounted for, let production continue with a part return, then close the order (which completes the planned route step).

**Before you start**
- The order exists (created on Job work).
- Rolls / bulk available at the sending plant; HSN code for each material.
- Rolls from before the upgrade must be reconciled first (Owner).

**Step by step**
1. 1. Press "Send material": tick rolls ("Roll label, material or job"), add bulk if needed, fill "HSN code", "Purpose on the challan", "Vehicle number", then "Issue challan". Print it; the gate scans its QR when the truck leaves.
2. 2. When goods return press "Receive": enter "Received on", the job worker's challan no. and date.
3. 3. Under "Sent material" mark each roll "Used up", "Came back unused" or "Partly used" (enter the balance kg), or "Mark all used up".
4. 4. Under "What came back" enter finished pieces (pieces, boxes / bags, weight, store at, inner packs), output rolls or bulk, and wastage.
5. 5. Check "Material balance": settled = output + balance back + wastage within the tolerance, or fill "Why does the balance not match?". If the bill is beside the form, fill billed quantity / rate; it links in the same save. Press "Save return".
6. 6. Part back and production must start: "Continue production with what's back" completes the route step now; later returns go to that step. Not offered on a job's last step.
7. 7. When nothing is left, press "Close" → "Close order". If something will never come back, "Close short" → "Close short and write off" with a reason. A draft with nothing sent: "Cancel draft".

**What is on the screen**
- **At the job worker / Sent / Output / Balance back / Wastage / Unexplained / Written off**: The order's material meter in kg.
- **Challans**: Each dispatch issues a job-work delivery challan (GST Rule 45) with a QR; "Not scanned at gate" until the watchman scans it.
- **Inner packs**: If the order packs pieces in inner packs, choose "Packed in our inner packs" or "Packed in the job worker's own inner packs". With our packs, in-house inner pouches come off stock now, as at the machine's last pouching step, and bought ones are booked by the evening packing count. The job worker's own packs take nothing from our stock.
- **Bill complete**: Tick when nothing more will be received against this bill.
- **Timeline**: Every send, return, link, release and close with who and when.

**Common problems and fixes**
- "Material balance is off by … kg (…%). Explain the difference to close." — Sent ≠ output + balance + wastage beyond the tolerance. Recheck weights or give the reason.
- "Enter the HSN code for …" — Every challan line prints an HSN code (e.g. 3920 plastic film).
- "…: the balance roll must weigh more than 0 and less than … kg." — For "Partly used" enter a balance below the sent weight; use "Came back unused" for the full roll.
- "Finished pieces can only be received against a production job. Link the job." — FG batches belong to a job; receive as rolls/bulk or link the job.
- "Explain why the order is closed short (at least 5 characters)." — Write a clear reason.
- "This is the job's last route step. Finished pieces can be packed and dispatched as they come back; close the order when everything is back." — Continue production is not needed on the last step.
- "This bill is from another vendor." — Open the order of the bill's job worker.

**If stuck**
1. If a save times out, press the same button again ("Retry save"); it never records twice.
2. Closing never deducts the step's inks, adhesive or packs from factory stock: job-worker material is recorded as vendor-supplied.

Related pages: /inventory/job-work, /inventory/gate-bills, /logistics/packing, /inventory/traceability

### Inventory / Ledger (/inventory/ledger)
Screen address: /inventory/ledger · Roles: ADMIN, OWNER, STORE, PLANNER, PLANT_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=inventory-ledger

A combined list of the latest bulk transactions and roll movements: time, operation, item / batch, location, quantity and reference.

Use it for a quick look at recent stock movements of any kind. For a full item history with opening and closing balance use the stock card under Count and close → Month end; for one roll use Roll genealogy.

**Before you start**
- Inventory view rights.

**Step by step**
1. 1. Choose the operation: "All Operations", "Inward (GRN)", "Outward (Dispatch)", "Receive", "Consumption" or "Transfer".
2. 2. Type in "Search ledger..." (material, reference or roll label).
3. 3. Read the tiles "Total Transactions", "Inward Flow", "Outward Flow".
4. 4. Page through the "Transaction Log" (50 rows a page).

**What is on the screen**
- **Operation**: GRN (inward), DISPATCH, RECEIVE, CONSUMPTION, TRANSFER, ADJUST.
- **Quantity**: Shown with + for GRN and Receive and − for every other type.
- **Reference**: GRN, challan, job or adjustment number that created the row.

**Common problems and fixes**
- "No matching records" — The search or operation filter hides everything, or the row is older than the latest rows loaded. Clear the search or use the stock card.

**If stuck**
1. For older history or exact balances open Count and close → Month end → stock card drill.

Related pages: /inventory/stock-lifecycle, /inventory/movements, /inventory/traceability, /inventory/grn-history

**Not done yet / watch out**
- The "30-Day History" button does nothing.
- The ledger loads only the latest 500 bulk transactions and 500 roll movements, has no date filter and no ADJUST option in the operation filter.
- Quantities are shown with a minus sign for every type except GRN and Receive, so a positive adjustment or transfer-in looks like an outflow.

### Roll Movements (/inventory/movements)
Screen address: /inventory/movements · Roles: ADMIN, OWNER, STORE, PLANNER, WORK_CENTER_MANAGER, PLANT_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=inventory-movements

Every physical move of a roll from one location to another — GRN, production, WIP transfer, inter-plant, job work and dispatch — with reason, job and who moved it.

Open it to answer "where did this roll go and why" for many rolls at once. This page only reads; moves are made by GRN, the terminals, inter-plant challans, job work and dispatch.

**Before you start**
- Inventory view rights.

**Step by step**
1. 1. Type in "Search roll, move reason, location, or job".
2. 2. Read the tiles: "Visible moves", "Production moves", "Dispatch moves", "Route spread".
3. 3. "Movement mix" shows the most common reasons; "Recent movement cards" the latest moves.
4. 4. Check each row in "Movement ledger": roll, from → to (NEW for a fresh roll), reason, job, time, by.
5. 5. Press "Refresh" to reload.

**What is on the screen**
- **Reason**: Why the roll moved, e.g. GRN, PRODUCTION, DISPATCH, inter-plant, job work.
- **Route spread**: Number of plants seen in the moves and the time of the latest move.

**Common problems and fixes**
- "No movements found for the current filter." — Clear the search. If it stays empty, the list may have failed to load; press Refresh.

**If stuck**
1. For one roll's full story use Roll genealogy.

Related pages: /inventory/traceability, /inventory/rolls, /inventory/inter-plant, /inventory/ledger

**Not done yet / watch out**
- If the movement list fails to load the page just shows "No movements found" with no error; there is no date or reason filter besides free search.

### Outward documents (/inventory/outward-documents)
Screen address: /inventory/outward-documents · Roles: ADMIN, OWNER, SUPER_ADMIN, STORE · Share link: https://erp.totalpolyprint.com/guide?page=inventory-outward-documents

Papers the watchman photographed as goods left the gate, to match with the ERP challan, invoice or gate pass they belong to.

Make sure every departure is matched to the ERP document it carried. QR-printed ERP papers match themselves; the rest wait in "Pending match", oldest first. Matching never moves stock or marks delivery.

**Before you start**
- The "Match outward gate photos" right (Inventory, Admin, Owner by default).
- The watchman recorded the departure on the gate terminal.

**Step by step**
1. 1. Pick a tab: "Pending match", "Discrepancy", "Matched" or "All".
2. 2. Filter by "Factory", "ERP link" (Has an ERP link / No ERP link yet), "Left from" / "Left to", or search "Vehicle, DC / invoice no. or party".
3. 3. Open a departure to link documents, mark it matched or note a discrepancy.
4. 4. Use "Previous page" / "Next page" to move through long lists; work the oldest first.

**What is on the screen**
- **No ERP document linked**: The photo has no link yet; open it to match.
- **Discrepancy**: A difference was noted and needs follow-up.
- **All**: Every outward photo record, including voided ones.

**Common problems and fixes**
- "Outward documents are for the inventory team" — Your account lacks the "Match outward gate photos" right; an administrator can grant it in the role matrix. Watchmen record departures on the gate terminal.
- "Choose an ordered date range of 366 days or fewer." — Fix Left from / Left to.

**If stuck**
1. If the list looks stale, wait for "Updating…" to finish or reload the page.

Related pages: /inventory/outward-documents/[id], /inventory/gate-passes, /logistics/dispatch, /gate

### Match outward departure (/inventory/outward-documents/[id])
Screen address: /inventory/outward-documents/[id] · Roles: ADMIN, OWNER, SUPER_ADMIN, STORE · Share link: https://erp.totalpolyprint.com/guide?page=inventory-outward-documents-id

The gate photos of one departure beside the matching panel: link the ERP documents that left on the truck, then mark it matched or note a discrepancy.

Confirm what left the factory on this truck. One truck may carry several documents. Matching never moves stock or marks delivery.

**Before you start**
- "Match outward gate photos" right.

**Step by step**
1. 1. Look at the photos (zoom, rotate, pin, or pop them out to a second screen).
2. 2. Under "Find the ERP document" search by number, party or vehicle, optionally pick "Document type", and link the match.
3. 3. Or use "Link by QR code": scan with a desk scanner or paste the QR text.
4. 4. A paper not in the ERP (supplier return note, courier receipt): "Paper not in the ERP" → number, party, what it is → "Add paper".
5. 5. Press "Mark matched", or write the difference and "Save discrepancy".
6. 6. Wrong link: "Remove" with a reason. Owner/Admin: "Void record" for a duplicate or mistaken photo.

**What is on the screen**
- **Documents on this departure**: What the office confirmed left on this truck.
- **Scanned at the gate**: Every code the watchman scanned, including codes not recognised.
- **History**: Every change with who did it and why; kept permanently.

**Common problems and fixes**
- "Link at least one ERP document before marking the departure matched." — Link a document or add a paper first.
- "This document is already linked to the departure." — It is already in the list.
- "This outward record is voided. Refresh the queue." — Someone voided it; go back to the queue.
- "This document belongs to another factory. It cannot be matched at this gate." — Pick the document of the factory the truck left from.
- "Linked. The same document also left on …" — A challan leaving over several trips is flagged, not blocked.

**If stuck**
1. "This outward record is not available": open it again from the queue.
2. Removing a link reopens a gate pass that left only on this record.

Related pages: /inventory/outward-documents, /inventory/outward-documents/[id]/view, /inventory/gate-passes, /logistics/dispatch

**Not done yet / watch out**
- Matching an outward record does not mark the slip delivered; proof of delivery stays a separate step in Dispatch Bay.

### Outward photos (pop-out) (/inventory/outward-documents/[id]/view)
Screen address: /inventory/outward-documents/[id]/view · Roles: ADMIN, OWNER, SUPER_ADMIN, STORE · Share link: https://erp.totalpolyprint.com/guide?page=inventory-outward-documents-id-view

The outward photos of one departure in their own window, for a second monitor.

Opened with the pop-out mode of the photo viewer on the matching screen. Page, zoom, rotation and pin follow the matching screen, so you can read the paper large while linking documents on the main screen.

**Before you start**
- "Match outward gate photos" right.

**Step by step**
1. 1. On the matching screen switch the viewer to pop-out.
2. 2. Drag the new window to the second monitor.
3. 3. Keep matching on the main screen; the pop-out follows.
4. 4. Close the pop-out window when the departure is matched.

**Common problems and fixes**
- "You cannot open these photos" — Ask an administrator for the "Match outward gate photos" right.
- "This link is not valid" — Open the photos again from the outward documents queue.

**If stuck**
1. Close the pop-out and open it again from the matching screen.

Related pages: /inventory/outward-documents/[id], /inventory/outward-documents

### Packaging materials (/inventory/packaging)
Screen address: /inventory/packaging · Roles: ADMIN, OWNER, STORE, PLANNER, WORK_CENTER_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=inventory-packaging

Stock of inner pouches, gonny, cartons, tape, sheet, labels, tags and POD sleeves by kind, plant and location, with health, sales-order holds and today's evening count figures.

Check what packing material is on hand and what needs reorder. Remember the rule: in-house inner pouches leave stock at the machine's last pouching step when the output is logged; bought inner pouches and every other item are taken off stock by the evening packing count (other items are ticked at release; inner pouches never are). Receive packing items with Smart GRN.

**Before you start**
- Packaging masters (kind, pcs / pack, UOM, reorder point).

**Step by step**
1. 1. Filter by kind (Inner pouch, Gunny, Carton / box, Tape, Sheet, Label, Tag, POD sleeve, Other), plant, location, supply mode (Purchased, In-house, Both) and health.
2. 2. Read the tiles: SKU rows, total pieces, available, low stock, stock-outs.
3. 3. Open a row ("View") for specs and "SO holds" (active reservations).
4. 4. Check the "EOD packing count" box for today; press "Open EOD count" to go to the evening count.
5. 5. Press "Receive packaging" to open Smart GRN.

**What is on the screen**
- **Health**: Empty at 0; Low below the reorder point; Healthy otherwise (reorder point 50 if not set).
- **Reserved**: Pieces held for sales orders.
- **Consumed today / Mapped orders**: What the evening count booked today and to how many orders.
- **Unassigned count short**: Count shortfall not shared to any order; should stay 0.

**Common problems and fixes**
- "Could not load packaging." — Refresh; if it repeats, tell the admin.
- "No packaging items match these filters" — Clear filters or search.

**If stuck**
1. Stock looks wrong after packing? Check the evening count in Packing audit before adjusting.

Related pages: /inventory/grn, /logistics/packing/consumption, /logistics/packing/audit, /inventory/stock-lifecycle, /logistics/packing

**Not done yet / watch out**
- The EOD box text says gunny is consumed by sealed count, but the current rule is that gonny is only ticked at release and taken off stock by the evening count.
- Packaging items are spelt "Gunny" here and "gonny" in the Packing Yard.

### Period (opens Year end) (/inventory/period)
Screen address: /inventory/period · Roles: ADMIN, OWNER, STORE, PLANNER, PLANT_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=inventory-period

This old address opens Count and close on the Year end tab (/inventory/stock-lifecycle?tab=close).

Period close moved into Count and close so counts, month end and year end sit together. The Stock menu link "Period" forwards you there.

**Before you start**
- Stock lifecycle rights.

**Step by step**
1. 1. Open "Period" from the Stock menu.
2. 2. You land on Year end: clear blockers, then "Close Financial Year".
3. 3. Month snapshots and the stock card are on the Month end tab.
4. 4. Update any bookmark to /inventory/stock-lifecycle?tab=close.

**If stuck**
1. Use the Count and close tabs directly.

Related pages: /inventory/stock-lifecycle

**Not done yet / watch out**
- The Stock menu still lists "Period" although it only opens the Year end tab of Count and close.

### Roll workspace (/inventory/rolls)
Screen address: /inventory/rolls · Roles: ADMIN, OWNER, STORE, PLANNER, WORK_CENTER_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=inventory-rolls

All rolls by film and width first: a film board, a variant × thickness matrix, a table and cards, every roll filterable by family, status, role, form, plant, location, age and size.

The store's home page. Find a free roll of the right film and width, see what is reserved or on a machine, spot old stock, and open a roll's detail, lineage or stock card. Rolls are never edited here: weight, status and location change only through GRN, production, dispatch, job work, moves and adjustments.

**Before you start**
- Rolls received through Smart GRN, opening stock or production.

**Step by step**
1. 1. Pick the view: films (default), matrix, table or cards.
2. 2. Filter in the left rail: variant / film code, status (Available, Reserved, In process, Consumed, Quarantine), role (Base / new, Output, Remainder, Split output, Finished), stock form, plant, location, age (≤30 d, 31–90, 90+ d) and size.
3. 3. On the film board each roll ring is coloured Free, Reserved, On machine or Away; tap a roll for its detail.
4. 4. In the matrix, tap a cell to see the individual rolls of that variant and thickness.
5. 5. In "Roll detail" use "Trace lineage" (Roll genealogy) or "Stock card"; labels can be (re)printed in 4 × 2 inch.
6. 6. "Receive rolls" opens Smart GRN; quick actions "Trace" and "Move →" (inter-plant).

**What is on the screen**
- **On hand KG / Available / Reserved**: Total roll weight, free weight and weight reserved for jobs.
- **Aged 90+**: Rolls older than 90 days; use them first.
- **Open web / Tubes / Folded**: Roll counts by stock form.
- **Remainders**: Balance pieces of parent rolls returned to stock after slitting or part use.
- **Reservation %**: Share of on-hand kg already reserved.
- **Reserved for**: The job holding the roll (in Roll detail).

**Common problems and fixes**
- "Could not load roll inventory." — Refresh; if it repeats, tell the admin.
- "No rolls match these filters." — Clear chips or search.

**If stuck**
1. A roll you can see on the floor is missing: search its supplier number in Roll genealogy, then count it in Count and close → Stock count.

Related pages: /inventory/grn, /inventory/traceability, /inventory/inter-plant, /inventory/stock-conversions, /inventory/movements, /inventory/stock-lifecycle

**Not done yet / watch out**
- The quick action "Move →" opens Inter-plant; there is no same-plant location move on this page.

### Stock conversion workspace (/inventory/stock-conversions)
Screen address: /inventory/stock-conversions · Roles: ADMIN, OWNER, STORE, PLANNER, WORK_CENTER_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=inventory-stock-conversions

Change a roll's physical form without a route: slit an open-web jumbo, open a tube into one or two sheets, fold a web or unfold it. Weight and genealogy are kept.

Use it when the store must prepare a roll for a job, e.g. open a tube for a side-seal job or slit a jumbo to the exact width the WC terminal needs. The parent is used up and children (plus any remainder) become new rolls.

**Before you start**
- The parent roll is AVAILABLE.
- Inventory or production rights.

**Step by step**
1. 1. Pick the operation: "Slit open-web jumbo", "Open tube to one sheet", "Open tube to two sheets", "Fold open web" or "Unfold to open web".
2. 2. Under "Pick parent roll" search roll, material, grade or location; only compatible rolls are offered.
3. 3. For slitting enter "Child widths (mm)" like 500, 500, 300 and "Trim per child".
4. 4. Check the preview: each output's form, width and weight, and the remainder.
5. 5. Write "Reason / operator note" and press "Post conversion".

**What is on the screen**
- **Open tube to one sheet**: One sheet of twice the lay-flat width, same weight.
- **Open tube to two sheets**: Two sheets of the lay-flat width, half the weight each.
- **Fold / Unfold**: Fold halves the width; unfold doubles it; weight unchanged.
- **Child widths / Trim per child**: Weight is shared by width. Children + trim must not exceed the parent width; any width left becomes a Remainder roll; trim is scrap.

**Common problems and fixes**
- "Only available rolls can be converted." — Unreserve the roll or pick another.
- "Requested child widths plus trim exceed parent width." — Reduce child widths or trim.
- "Width slitting requires open-web stock. Use tube-opening for tube stock." — Open the tube first, then slit.
- "Open tube to one sheet requires lay-flat tube stock." — Pick a lay-flat tube roll.
- "Unfold requires folded-web stock." — Pick a folded-web roll.

**If stuck**
1. A wrong conversion cannot be undone here; count the children and correct through Count and close or an adjustment.

Related pages: /inventory/rolls, /inventory/traceability, /production/work-center

**Not done yet / watch out**
- A posted conversion cannot be reversed on this page; there is no history list of past conversions here.

### Count and close (/inventory/stock-lifecycle)
Screen address: /inventory/stock-lifecycle · Roles: ADMIN, OWNER, STORE, PLANNER, PLANT_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=inventory-stock-lifecycle

Opening stock, stock counts on any day, the evening packing count, month end and year end, for one plant and financial year.

All stock-cycle work in one place. Work left to right: Overview, Opening stock, Stock count, Month end, Year end. Closed financial years cannot change; adjustments belong only in an open year.

**Before you start**
- Plant and financial year picked at the top; the year must be opened ("Open FY") before counts and close.
- Active locations in the plant.
- Inventory audit or manage rights.

**Step by step**
1. 1. Overview: stock value by class, ageing (0-30, 31-90, 90+ days), valuation trend, opening → in → consumed → dispatch → adjust → closing, top movers, dead stock.
2. 2. Opening stock: enter quantities, paste rows ("Apply paste") or upload CSV/XLSX (validate, then "Post file"); rolls are entered one physical roll at a time; press "Post Opening Stock" (or "Post Cutover Stock").
3. 3. Stock count → "Stock count · any day, month end or period": choose scope (All, Bulk, Rolls, Packing), location, roll form or granule code and count mode (soft freeze, hard freeze, spot count); enter counted quantities; give a reason for each difference of 2% or more; press "Post physical count".
4. 4. Stock count → "Evening packing count": pick the location and date. Rows start filled with the book quantity; change only the items whose count differs (rows left at the book figure do not change stock), add a note, press "Post count". It posts at once with no approval. The difference is booked to the orders that ticked each item that day, or else to that day's orders whose packing plan includes it.
5. 5. Count history: open a sheet to Validate, Submit, Approve and Post drafts, or Cancel; the evening packing proof and ink floor proof for a date are here too.
6. 6. Month end: lock months in the monthly close tracker, take the month-end snapshot, "View month proof", and drill any material's stock card to its source document.
7. 7. Year end: clear the "Annual close blockers", press "Close Financial Year" and confirm "Close FY". The year locks, next year's opening is generated and the year's finished records move to the archive (pick the year in the header to see them).

**What is on the screen**
- **Counts waiting**: Draft / submitted sheets still to finish; shown on the Stock count tab.
- **Count mode**: Soft freeze · allow reviewed movement; Hard freeze · no movement until post; Spot count · selected rows only.
- **System / Counted / Variance % / Reason**: Only rows you enter post. Reasons: Book vs physical, Found / misplaced, Damage / scrap, Data entry, Other.
- **Book / Closing qty / Delta (packing count)**: Delta = closing − book: negative is consumption shared to the day's orders (whole pieces), positive is count excess.
- **Same-day allocation pool**: Orders that packed or ticked items on the count date.
- **Annual close blockers**: Negative bulk stock, open inter-plant challans, open job-work orders, unresolved critical inventory alerts, draft audit sheets.
- **Monthly snapshot**: Reporting proof only; it does not lock the year.

**Common problems and fixes**
- "Row … has …% variance; a reason code and note are required." — Differences of 2% or more need a reason.
- "Select a location for … before posting the count." — Pick the location on that row.
- "Enter counted quantity for at least one row. Physical count posts only rows you enter." — Type at least one count.
- "Maker and checker must be different users." — A second person approves a sheet you submitted; only an owner may approve their own.
- "E-OS-05: opening blocked because … movement(s) already exist for this material/location in …" — Stock already moved this year; use a stock count instead of opening stock.
- "Open this financial year before closing it." — Press "Open FY" first.
- "Close … before starting another open period." — Only one open year at a time.
- "Close blocked" — A blocker is still open; fix it from its page (receive challans, close job work, finish drafts).
- "FY correction can only be created for a closed financial year. Use Stock Count for an open year." — Use Stock count while the year is open.

**If stuck**
1. "Select a plant…" messages: pick the plant at the top first.
2. A draft sheet blocking close: open it in Count history and Post or Cancel it.
3. Wrong packing count: check Packing audit → Evening counts before posting another count.

Related pages: /inventory/period, /logistics/packing/consumption, /logistics/packing/audit, /production/ink-control, /inventory/inter-plant, /inventory/job-work, /inventory/alerts, /inventory/count

**Not done yet / watch out**
- "Post physical count" creates and posts the count sheet in one step, so the Submit → Approve (maker-checker) path applies only to sheets left as drafts in Count history.
- Opening stock drafts are saved only in this browser (Save draft / Load draft), not on the server.

### Roll Genealogy (/inventory/traceability)
Screen address: /inventory/traceability · Roles: ADMIN, OWNER, STORE, PLANNER, WORK_CENTER_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=inventory-traceability

Genealogy, movement trail and current stage for any roll: scan its QR or enter the ERP ID or supplier roll number.

Answer "where did this roll come from and what became of it": the parent and child tree, every movement and consumption, and recent physical moves. Used for customer complaints, quality holds and missing rolls.

**Before you start**
- Inventory view rights.

**Step by step**
1. 1. Scan the QR or type in "Scan QR, or enter ERP ID / supplier roll number" and press Enter or "Trace Roll".
2. 2. Or pick from "Select roll from latest 200".
3. 3. If several rolls match, pick the right one from the buttons by checking location and weight.
4. 4. Read the tiles (Current Weight, Original Weight, Lineage Children, Timeline Events, Current Stage), then "Genealogy Tree", "Movement & Consumption Timeline" and "Recent Physical Movements".
5. 5. Reprint the roll label from the roll card if needed.

**What is on the screen**
- **Match**: How the roll was found: id, exact label or a unique reference.
- **Genealogy Tree**: Parents and children from slitting, splitting, lamination and conversion.
- **Role / Status**: Base, output, remainder, split output or finished; available, reserved, in process, consumed, quarantine.

**Common problems and fixes**
- "More than one roll matches. Select the exact ERP ID after checking supplier reference and location." — The supplier number is on several rolls; pick one of the offered rolls.
- "Roll not found for provided query" — Check the number; try the ERP ID written on the roll.

**If stuck**
1. Open a roll straight from the Roll workspace with "Trace lineage".

Related pages: /inventory/rolls, /inventory/movements, /inventory/stock-conversions, /inventory/grn-history

**Not done yet / watch out**
- The roll picker offers only the latest 200 rolls, and "Open Roll Explorer" goes to /inventory?tab=rolls instead of the Roll workspace.

### Vendor master (Inventory) (/inventory/vendors)
Screen address: /inventory/vendors · Roles: ADMIN, OWNER, STORE, PLANT_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=inventory-vendors

List of suppliers, job workers and service providers with code, name, type, GST no., payment terms and address; add, edit or delete a vendor.

Keep the vendors Smart GRN, purchase orders and job work pick from. The type decides use: Raw Material and Hybrid can supply GRNs; Job Worker and Hybrid can take job work.

**Before you start**
- Inventory or procurement rights.

**Step by step**
1. 1. Read the tiles: Total Partners, Material Suppliers, Job Workers, Service Providers.
2. 2. Search in "Search partners...".
3. 3. Press "Onboard Entity": fill Code, Name, Type, GST No, Payment Terms, Lead Time (Days), Address; press "Save Entity".
4. 4. Edit a row to open "Edit Vendor Profile".
5. 5. Delete only a vendor created by mistake ("Revoke Partnership?" → "Delete Entity").

**What is on the screen**
- **Type**: Raw Material (RM), Job Worker (JOBWORK), Service Provider (SERVICE), Hybrid (BOTH).
- **Code / Name**: Both required; code like VEND-001.
- **GST No**: Printed on challans and used for bill checks.

**Common problems and fixes**
- "Code is required / Name is required" — Fill both before saving.
- "GRN vendor must be RM or BOTH type." — Shown on Smart GRN when the type is wrong; change it here.

**If stuck**
1. A vendor that stopped supplying should be set Inactive in Master data → Vendors (/master/vendors) rather than deleted, so history keeps its name. Job-work processes, plants and rate cards are also edited there.

Related pages: /master/vendors, /inventory/grn, /inventory/job-work, /procurement/purchase-orders

**Not done yet / watch out**
- Delete removes the vendor outright; vendor status (Active / Inactive), job-work processes, plants and rate cards can only be set in Master data → Vendors.

### Location scan (/loc/[code])
Screen address: /loc/[code] · Roles: ADMIN, OWNER, SUPER_ADMIN, STORE, PLANNER, WORK_CENTER_MANAGER, DISPATCH, PLANT_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=loc-code

Opens a stock location from its QR sticker: what the system says is there (bulk material, rolls by material, packed units) and a phone count that posts the differences.

Scan the sticker on a rack or bay to check it or to count it. A posted count becomes a stock adjustment with reason "count correction".

**Before you start**
- A location QR sticker; your role may view stock (Store, Dispatch, Planner…).

**Step by step**
1. Scan the location sticker; the header shows code, name, plant and type.
2. Read the tiles: "Rolls", "Bulk lines", "Packed units", "Differences".
3. To count, press "Count stock · गिनती".
4. Under "Bulk material" type the counted quantity for each line.
5. Under "Rolls by material" tick any roll that is NOT here.
6. Add a note if needed and press "Post count · दर्ज करें".

**What is on the screen**
- **Find material or roll**: Search inside this location.
- **Differences**: Lines where your count differs from the system.
- **Roll tick (not here)**: Only AVAILABLE rolls can be ticked; reserved or in-process rolls cannot be written off from the phone.

**Common problems and fixes**
- "No location matches code "…"." — The sticker is from another factory or was replaced. Ask the store for a new sticker.
- "Could not post the count" — The adjustment was refused (permission or stale stock). Read the message, refresh and count again.

**If stuck**
1. Posted counts appear under Stock adjustments with this location.
2. Press "Stop counting" to leave count mode without posting.

Related pages: /inventory/adjustments, /factory/locations, /inventory/rolls

**Not done yet / watch out**
- Reserved or in-process rolls cannot be written off from the phone count.

## हर स्क्रीन (हिंदी)

### Inventory Health Matrix (स्टॉक जाँच) (/analytics/inventory-health)
स्क्रीन का पता: /analytics/inventory-health · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, STORE, PLANNER, WORK_CENTER_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=analytics-inventory-health&lang=hi

Live stock का कुल (bulk, free roll, finished goods, reserved roll) और खुले stock गड़बड़ी alert; नया audit चलाने और alert बंद करने का बटन।

जब stock गलत लगे, गिनती से पहले, या रोज़ store जाँच में खोलें। Audit stock balance को ledger से मिलाता है, roll जाँचता है और लंबे समय से अटका WIP ढूँढता है।

**शुरू करने से पहले**
- Stock GRN, issue, roll movement और adjustment से दर्ज होता हो।
- Role को inventory देखने की अनुमति चाहिए।

**स्टेप बाय स्टेप**
1. चार tiles पढ़ें: "Bulk Base Mass", "WIP Availability", "Finished Goods", "Locked Reserves"।
2. "System Integrity" score और alert गिनती "Critical Anomalies", "High Priority", "Total Outstanding" देखें।
3. अभी मिलान चलाने के लिए "Run smart audit" दबाएँ।
4. "Active Diagnostic Log" ऊपर से देखें (पहले critical/high)।
5. कारण Inventory में ठीक करें (adjustment, गिनती, roll movement), फिर alert पर "Resolve Event" दबाएँ।
6. "Resolve Anomaly Trace" में कारण लिखें और "Mark Matrix Resolved" दबाएँ (नोट लिखे बिना बटन बंद रहता है)।
7. आँकड़े दोबारा लाने के लिए "Sync layer" दबाएँ।

**स्क्रीन पर क्या है**
- **स्क्रीन पर: "Bulk Base Mass"**: कुल bulk stock (granule, chemical आदि) KG में और चालू SKU की संख्या।
- **स्क्रीन पर: "WIP Availability"**: Free (available) roll का KG और गिनती।
- **स्क्रीन पर: "Finished Goods"**: Finished goods roll का KG और गिनती।
- **स्क्रीन पर: "Locked Reserves"**: Job के लिए reserved roll का KG और गिनती।
- **स्क्रीन पर: "System Integrity"**: Score = 100 − 5 × critical − 2 × high − 0.5 × बाकी खुले alert (0 से नीचे नहीं)। 80 से ऊपर हरा, 50 से ऊपर पीला, नहीं तो लाल।
- **स्क्रीन पर: "Alert severity"**: CRITICAL और HIGH पर पहले काम करें।

**आम दिक्कतें और हल**
- "संदेश: "Inventory health feed unavailable"" — Health request फेल हुआ। शून्य दिखाने के बजाय आँकड़े रोके गए हैं। "Retry" दबाएँ।
- "संदेश: "Failed to run audit"" — Server पर audit में गड़बड़ी हुई। बाद में फिर चलाएँ; बार-बार हो तो admin को बताएँ।
- "संदेश: "Alert already resolved"" — किसी और ने बंद कर दिया। "Sync layer" दबाएँ।
- "संदेश: "Plant not found"" — Audit के साथ भेजा plant मौजूद नहीं। पेज reload करें।

**अटक गए तो**
1. पहले stock ठीक किए बिना alert बंद न करें; resolve सिर्फ संदेश बंद करता है।
2. Bulk mismatch के लिए Adjustments या rack count; roll की समस्या के लिए Roll movements या Roll genealogy।

जुड़े पेज: /inventory/alerts, /inventory/adjustments, /inventory/count, /inventory/traceability, /analytics/inventory-history

**अभी नहीं होता / ध्यान दें**
- पेज पर plant filter नहीं है; tiles और alerts सभी plants के एक साथ हैं।
- "WIP Availability" नाम की tile असल में free (available) roll दिखाती है, WIP नहीं।

### Inventory Snapshot History (स्टॉक इतिहास) (/analytics/inventory-history)
स्क्रीन का पता: /analytics/inventory-history · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, STORE, PLANNER, PLANT_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=analytics-inventory-history&lang=hi

रात के snapshot से समय के साथ stock दिखाता है: हर plant का bulk, roll, finished goods, WIP, reserved roll और scrap।

देखें stock बढ़ रहा है या घट रहा है, किस plant में सबसे ज़्यादा वज़न है, और कितना WIP या reserved में अटका है। हर snapshot दिन का close है (रात 23:45 IST)।

**शुरू करने से पहले**
- रात का snapshot job चलता हो; इतिहास पहले snapshot से शुरू होता है।

**स्टेप बाय स्टेप**
1. चार tiles पढ़ें: "Captured snapshots", "Latest stock estate", "WIP share", "Reserved load"।
2. "Inventory snapshot rhythm" में समय के साथ bulk, roll, FG और WIP की लाइनें देखें।
3. Plants की तुलना के लिए "Latest plant load" देखें।
4. हर snapshot की पंक्ति के लिए "Snapshot ledger" तक जाएँ; दोबारा लाने के लिए "Refresh" दबाएँ।

**स्क्रीन पर क्या है**
- **स्क्रीन पर: "Captured snapshots"**: लोड हुए snapshot (पिछले 180 दिन, अधिकतम 180) और नवीनतम चक्र में plants।
- **स्क्रीन पर: "Latest stock estate"**: हर plant के नवीनतम snapshot का कुल stock KG, पिछले snapshot से % बदलाव के साथ।
- **स्क्रीन पर: "WIP share"**: WIP KG ÷ कुल stock KG × 100।
- **स्क्रीन पर: "Reserved load"**: Reserved roll KG ÷ कुल stock KG × 100। Plant कार्ड पर "Reserve load" या "Clear reserve" दिखता है।
- **स्क्रीन पर: "Bulk / Rolls / FG / WIP / Scrap"**: हर snapshot में दर्ज stock के हिस्से, KG में।

**आम दिक्कतें और हल**
- "कोई snapshot नहीं दिखता" — रात का snapshot अभी नहीं चला या फेल हुआ। Admin से scheduled job जँचवाएँ।

**अटक गए तो**
1. "Refresh" दबाएँ।
2. आज के live आँकड़ों के लिए Inventory Health Matrix देखें; इतिहास 23:45 के snapshot के बाद ही बदलता है।

जुड़े पेज: /analytics/inventory-health, /analytics/reports/inventory, /inventory/ledger

**अभी नहीं होता / ध्यान दें**
- तारीख या plant filter नहीं है; पेज हमेशा सभी plants के पिछले 180 दिन लाता है।

### Inventory Control Hub (/dashboard/inventory)
स्क्रीन का पता: /dashboard/inventory · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, STORE, PLANNER, PLANT_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=dashboard-inventory&lang=hi

हर plant में क्या stock है, कहाँ रखा है, कितना पुराना है और किस पर ध्यान चाहिए।

Store और planner इसे plan करने या खरीदने से पहले stock समझने के लिए खोलते हैं: free बनाम reserved roll, 90 दिन से पुराना stock, stage, location और plant के हिसाब से stock, और खुले stock alert। असली काम (GRN, movement, गिनती) जुड़े हुए Stock पेजों पर होता है।

**शुरू करने से पहले**
- GRN से stock आया हो; location और plant बने हों।

**स्टेप बाय स्टेप**
1. ऊपर के आँकड़े पढ़ें: "Bulk stock", "Rolls on hand", "Finished goods" और "Open alerts"।
2. "Available rolls" (plan के लिए free) को "Reserved rolls" (order के लिए रुके) से मिलाएँ।
3. "Aged stock (90d+)" और "Stock aging" पैनल देखें; पुराने roll पहले plan करें।
4. "By stage", "By location" और "By plant" से देखें roll stock कहाँ है।
5. "Critical action centre" में सबसे गंभीर alert से शुरू करें; पूरी सूची के लिए "All alerts" दबाएँ।
6. माल लेने के लिए "Create GRN", या गहरी जाँच के लिए "Health diagnostics" दबाएँ।

**स्क्रीन पर क्या है**
- **Available rolls**: planner के लिए free roll वज़न; नीचे गिनती लिखी है।
- **Reserved rolls**: order के लिए रुका roll वज़न और कुल में उसका हिस्सा।
- **Aged stock (90d+)**: 90 दिन से पुराना stock।
- **Rated stock value**: rate के हिसाब से stock की कीमत।
- **Stock aging**: उम्र के हिसाब से roll वज़न।
- **Alert mix**: खुले alert, प्रकार के हिसाब से।
- **Largest stock families**: हर family का वज़न और सबसे पुराने item की उम्र।

**आम दिक्कतें और हल**
- "No aging data / No stage data / No location data" — उस पैनल के लिए report खाली आई; अक्सर roll stock दर्ज नहीं या report अभी load हो रही है।
- "All clear" — कोई खुला stock alert नहीं।

**अटक गए तो**
1. पैनल खाली रहें तो पेज reload करें; हर पैनल अलग load होता है।
2. Alerts पर alert खोलें और कारण (गिनती, adjustment, movement) उसी Stock पेज पर ठीक करें।

जुड़े पेज: /inventory/rolls, /inventory/grn, /inventory/alerts, /analytics/inventory-health, /analytics/reports/inventory

### Stock workspace (/inventory)
स्क्रीन का पता: /inventory · भूमिकाएँ: ADMIN, OWNER, STORE, PLANNER, WORK_CENTER_MANAGER, PLANT_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=inventory&lang=hi

Inventory का मुख्य पेज: हमारे पास कितना bulk, roll, packaging और POD स्टॉक है, कहाँ रखा है, कितना पुराना है और कितना sales order के लिए रोका गया है।

प्लानिंग, खरीद या गिनती से पहले स्टॉक की झलक देखने के लिए यह पेज खोलें, और यहीं से अलग workspace (Rolls, Bulk, Packaging, Inks · adhesives, Stock conversion, Roll genealogy, Inter-plant) में जाएँ। स्टॉक GRN और production से आता है; खपत, packing और dispatch से घटता है।

**शुरू करने से पहले**
- Material master, plant और store location बने होने चाहिए; स्टॉक तभी दिखेगा जब GRN, opening stock या production output पोस्ट हो चुके हों।
- आपके role को inventory देखने का अधिकार चाहिए। "Gate bills waiting for inventory" कार्ड सिर्फ़ बिल देखने वालों को दिखता है।

**स्टेप बाय स्टेप**
1. ऊपर "Gate bills waiting for inventory" कार्ड देखें; नंबर अभी खुले बिलों का है। क्लिक करके Bills & documents खोलें।
2. तीन टाइल पढ़ें: "Bulk granules & chemicals", "Active rolls" (गिनती और KG) और "Packaging materials" (packing rows और POD rows)।
3. "Dedicated workspaces" में कोई टाइल (Roll workspace, Stock conversion, Bulk & chemicals, Packaging, POD stock, Inks · adhesives · solvents, Roll genealogy, Inter-plant) दबाएँ, वहाँ पूरे filter मिलते हैं।
4. बाईं "Filters" पट्टी में search ("Material · roll # · code…") लिखें, class (All, Bulk, Rolls, Packaging, POD), location और उम्र (≤30 d, 31–90, 90+ d) चुनें।
5. "Variant × thickness matrix" में किसी खाने पर क्लिक करें, उस variant और thickness के roll दिखेंगे।
6. किसी bulk या packaging row पर क्लिक करें: On hand, Reserved, Available, vendor, last GRN, expiry और उसे रोकने वाले sales order दिखेंगे।
7. "Receive stock" दबाकर Smart GRN खोलें, या "Period" / नीचे "Period: open · close →" से stock lifecycle (गिनती और month close) पर जाएँ।

**स्क्रीन पर क्या है**
- **Bulk granules & chemicals**: सभी bulk stock rows का कुल, अलग unit (KG, METER, PCS) हों तो हर unit अलग दिखती है।
- **Active rolls**: स्टॉक में roll की गिनती और कुल KG; नीचे matrix में बँटवारा दिखता है।
- **Packaging materials**: Inner pouch, gonny, carton, sheet, tape और बाकी packing स्टॉक। POD rows अलग गिनी जाती हैं।
- **POD stock**: सिर्फ़ पहले से रखे POD sleeve और POD film। Packing सामान packaging हिस्से में ही रहता है।
- **उम्र (Age)**: ≤30 d नया, 31–90 पुराना होता, 90+ d बहुत पुराना स्टॉक, रसीद की तारीख़ से।
- **Reserved / Available**: Reserved = sales order के लिए रोका गया (sales को दिखता है); Available = On hand − Reserved।
- **नीचे Filtered stock पट्टी**: मौजूदा filter में bulk का reserved और free मात्रा दिखाती है।

**आम दिक्कतें और हल**
- "Inventory snapshot did not load." — स्टॉक सर्विस ने जवाब नहीं दिया। कनेक्शन देखें और पेज reload करें; बार-बार हो तो administrator को बताएँ।
- "Gate bill कार्ड पर "Could not refresh the count"" — सिर्फ़ गिनती नहीं आई। Queue खोलें; वह खुद दोबारा कोशिश करती है।

**अटक गए तो**
1. कोई नंबर गलत लगे तो उसका workspace (Bulk, Rolls, Packaging) खोलकर row देखें, फिर Stock ledger जाँचें।
2. कोई हिस्सा खाली लगे तो Filters पट्टी से सारे filter हटाएँ।

जुड़े पेज: /inventory/gate-bills, /inventory/grn, /inventory/rolls, /inventory/bulk, /inventory/packaging, /inventory/addons, /inventory/stock-conversions, /inventory/traceability, /inventory/inter-plant, /inventory/stock-lifecycle

**अभी नहीं होता / ध्यान दें**
- नीचे "Filtered stock" सिर्फ़ bulk का reserved / free दिखाता है, roll या packaging का नहीं।

### Inks · adhesives · solvents (/inventory/addons)
स्क्रीन का पता: /inventory/addons · भूमिकाएँ: ADMIN, OWNER, STORE, PLANNER, WORK_CENTER_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=inventory-addons&lang=hi

Roll के साथ लगने वाले process सामान का स्टॉक: ink (रंग के नमूने के साथ), adhesive, solvent और chemical।

Printing या lamination शुरू करने से पहले, या ऑर्डर देने से पहले खोलें: हर plant और location में कितनी ink, adhesive या solvent है और कौन सा कम है। स्टॉक GRN ("Receive add-ons") से आता है और work center की खपत से घटता है।

**शुरू करने से पहले**
- Ink, adhesive और solvent material master में होने चाहिए और GRN से आए हों।

**स्टेप बाय स्टेप**
1. सारांश के लिए "Pulse" (items, inks, adhesives, solvents, critical, family mix) या कार्ड/टेबल के लिए "Browse" चुनें।
2. Browse में saved view चुनें: "All add-ons", "Inks", "Adhesives", "Solvents" या "Low stock"।
3. Filter लगाएँ: Family, Health (Healthy, Low, Critical), Plant, Location और Material code।
4. Row या कार्ड पर क्लिक करें: On hand, Reserved, Available, Lot #, Vendor, Plant, Location, Color, Expiry और sales reservation दिखेंगे।
5. Filter याद रखने के लिए "Save current" दबाएँ, "View name" लिखें और "Save" दबाएँ।
6. GRN के लिए "Receive add-ons", वापस जाने के लिए "← Summary" दबाएँ।

**स्क्रीन पर क्या है**
- **Family**: INK, ADHESIVE, SOLVENT, CHEMICAL या OTHER — material class, code या नाम से तय होता है।
- **Health**: Healthy, Low या Critical — on-hand को reorder point से मिलाकर (reorder point न हो तो उसकी unit में 50)।
- **On hand / Reserved / Available**: Available = On hand − Reserved, item की अपनी unit में।
- **रंग का नमूना**: Ink के आगे रंग का छोटा खाना, रंग या material के नाम से।

**आम दिक्कतें और हल**
- "Could not load add-ons." — स्टॉक snapshot नहीं आया। पेज reload करें; बार-बार हो तो administrator को बताएँ।

**अटक गए तो**
1. अगर कोई ink "Other" में दिखे तो उसके class या code में INK/PIGMENT/COLOR नहीं है; search या Bulk workspace से ढूँढें।

जुड़े पेज: /inventory, /inventory/bulk, /inventory/grn, /inventory/ink-floor

**अभी नहीं होता / ध्यान दें**
- Family (ink, adhesive, solvent) material class, code या नाम से अंदाज़ा लगाकर तय होती है, और reorder point न हो तो Health 50 मानकर निकलती है, इसलिए कुछ item "Other" में या गलत health के साथ दिख सकते हैं।

### Stock Adjustments (/inventory/adjustments)
स्क्रीन का पता: /inventory/adjustments · भूमिकाएँ: ADMIN, OWNER, STORE, PLANT_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=inventory-adjustments&lang=hi

हर स्टॉक सुधार (damage, write-off, मिला हुआ स्टॉक, count correction, reclassification) की सूची — bulk, roll, packaging और trading goods — उसकी स्थिति के साथ।

नया सुधार शुरू करने या किसी साथी के बनाए draft को post करने के लिए खोलें। Post होने पर स्टॉक और ledger बदलते हैं; वापस सिर्फ़ Void से होता है।

**शुरू करने से पहले**
- आपके पास inventory.adjust अधिकार चाहिए (Store, Owner, Admin, Plant manager के पास होता है)।

**स्टेप बाय स्टेप**
1. ऊपर chips पढ़ें: Draft, Posted और Voided की गिनती।
2. "All", "Draft", "Posted", "Voided" बटन से छाँटें।
3. कार्ड (code ADJ-YYYY-NNNN, plant, reason, Lines, Net Δ, Created) पर क्लिक करके खोलें।
4. नया बनाने के लिए "New Adjustment" (सूची खाली हो तो "Create first adjustment") दबाएँ।

**स्क्रीन पर क्या है**
- **Status**: draft = सेव, स्टॉक नहीं बदला; posted = स्टॉक बदला; voided = रद्द (posted को उल्टा सुधार लगाकर वापस किया जाता है)।
- **Net Δ**: सारी लाइनों की मात्रा का जोड़ (+ बढ़ाता, − घटाता)। लाइनें अलग unit की हो सकती हैं।

**आम दिक्कतें और हल**
- "No stock adjustments yet" — अभी कुछ दर्ज नहीं। "Create first adjustment" दबाएँ।

**अटक गए तो**
1. Draft लंबे समय से पड़ा है: adjust अधिकार वाले दूसरे व्यक्ति से खुलवाकर "Post" करवाएँ।

जुड़े पेज: /inventory/adjustments/new, /inventory/adjustments/[id], /inventory/stock-lifecycle, /inventory/ledger, /inventory/alerts

**अभी नहीं होता / ध्यान दें**
- सूची में सिर्फ़ status बटन हैं — search, plant या तारीख़ filter नहीं — और बेकार draft हटाने का तरीका नहीं।

### Stock adjustment (/inventory/adjustments/[id])
स्क्रीन का पता: /inventory/adjustments/[id] · भूमिकाएँ: ADMIN, OWNER, STORE, PLANT_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=inventory-adjustments-id&lang=hi

एक स्टॉक adjustment — उसकी लाइनें (पहले, बदलाव, बाद में और ₹ मूल्य), किसने बनाया और post किया, साथ में Post और Void बटन।

Draft जाँचकर post करने (दूसरा व्यक्ति) या गलत adjustment को void करने के लिए खोलें। Post करने पर हर लाइन अपने स्टॉक में लगती है और ledger row बनती है (bulk/packaging ADJUST, roll movement ADJUSTMENT)।

**शुरू करने से पहले**
- Maker-checker: जिसने draft बनाया वह post नहीं कर सकता, जब तक वह Owner या Admin न हो।

**स्टेप बाय स्टेप**
1. ऊपर देखें: code, plant, reason, किसने बनाया और किसने post किया।
2. हर लाइन देखें: Class, Item, Location, Before, Δ, After, Value ₹। लाइनें बदली नहीं जा सकतीं।
3. अगर आप दूसरे व्यक्ति हैं तो "Post" दबाएँ, फिर बॉक्स में "Post adjustment"। अगर draft आपने बनाया है तो "Waiting for a second person to post this adjustment." दिखेगा।
4. रद्द करने के लिए "Void" और फिर "Void adjustment" दबाएँ। Posted adjustment पर उल्टी लाइनें लगकर स्टॉक वापस आता है; draft सिर्फ़ voided हो जाता है।
5. सूची पर लौटने के लिए "Back" दबाएँ।

**स्क्रीन पर क्या है**
- **Before / Δ / After**: Post से पहले उस स्टॉक की मात्रा, बदलाव और नतीजा।
- **Value ₹**: Item के rate पर बदलाव का ₹ मूल्य।
- **Class**: BULK, ROLL, PACKAGING या TRADING_GOOD।

**आम दिक्कतें और हल**
- "A stock adjustment needs a second person: someone other than the person who drafted it must post it." — Draft आपने बनाया है। adjust अधिकार वाले दूसरे user (या Owner/Admin) से post करवाएँ।
- "Line N: adjustment would make stock negative (…)" — घटाई गई मात्रा उस location के मौजूदा स्टॉक से ज़्यादा है। दोबारा गिनें और सही मात्रा से void करके नया बनाएँ।
- "Line N: roll … is reserved for a job. Unassign it first." — Adjust करने से पहले roll को job से हटाएँ (planner / job स्क्रीन)।
- "Line N: roll … is …; only an available roll can be adjusted." — Consumed, dispatched, transit या job-work roll अपने flow से निपटते हैं, यहाँ नहीं। MISSING roll को plus से वापस जोड़ा जा सकता है।
- "Line N: this material is held under several quality codes at this location. Adjust it through a physical count, which records the code." — इस material के लिए Stock lifecycle → Stock count इस्तेमाल करें।
- "Line N: voiding would make stock negative; the stock has been used since." — जोड़ा गया स्टॉक खर्च हो चुका है। Void की जगह जो सच में बचा है उसके लिए नया adjustment बनाएँ।

**अटक गए तो**
1. गलत draft यहाँ बदला नहीं जा सकता: उसे void करके नया बनाएँ।

जुड़े पेज: /inventory/adjustments, /inventory/adjustments/new, /inventory/ledger

**अभी नहीं होता / ध्यान दें**
- Draft की लाइनें स्क्रीन पर बदली या हटाई नहीं जा सकतीं (server अनुमति देता है); गलत draft को void करके नया बनाना पड़ता है।

### New stock adjustment (/inventory/adjustments/new)
स्क्रीन का पता: /inventory/adjustments/new · भूमिकाएँ: ADMIN, OWNER, STORE, PLANT_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=inventory-adjustments-new&lang=hi

स्टॉक ठीक करने का फ़ॉर्म: एक plant और reason, फिर हर स्टॉक के लिए एक लाइन, plus या minus मात्रा के साथ।

जब स्क्रीन का स्टॉक फ़र्श से मेल न खाए तब इस्तेमाल करें: damage, write-off, मिला स्टॉक, count correction या reclassification। Draft सेव करें; दूसरा व्यक्ति post करेगा।

**शुरू करने से पहले**
- inventory.adjust अधिकार; plant और location बने हों; material, roll या trading good मौजूद हो।
- पूरी physical गिनती के लिए Stock lifecycle → Stock count इस्तेमाल करें।

**स्टेप बाय स्टेप**
1. "Header" में "Plant", "Reason" (Damaged / spoiled, Write-off, Found / unaccounted, Count correction, Reclassification, Other) और चाहें तो "Notes" चुनें।
2. हर लाइन में "Stock class" चुनें: Bulk (granules / chemicals), Roll, Packaging या Trading Good।
3. "Material" (या "Trading good") चुनें; Roll के लिए "Roll" भी, Bulk और Packaging के लिए "Location" चुनें।
4. "Delta qty" लिखें: बढ़ाने के लिए +10, घटाने के लिए -5। "UOM" item की अपनी unit है (roll KG में)।
5. और item के लिए "Add line"; लाइन हटाने के लिए "Remove"।
6. "Save Draft" दबाएँ। Draft खुलेगा; दूसरा व्यक्ति वहीं से post करेगा।
7. Owner/Admin "Save & Post" से एक बार में सेव और post कर सकते हैं।

**स्क्रीन पर क्या है**
- **Reason**: सभी लाइनों पर लागू; सूची और audit में दिखता है।
- **Delta qty**: बदलाव लिखें, नया कुल नहीं। शून्य नहीं हो सकता।
- **Location**: Bulk और Packaging के लिए ज़रूरी; सिर्फ़ चुने plant की location। Job-work, transit और scrap location नहीं चलती।
- **Preview**: Roll चुनने पर Before → After दिखता है।
- **Line notes**: उस लाइन का वैकल्पिक नोट।

**आम दिक्कतें और हल**
- "Save failed / Post failed (लाल संदेश)" — संदेश लाइन और नियम बताता है, जैसे "BULK adjustments require material and location." या "… is stocked in KG; enter the quantity in KG." वह लाइन ठीक करके फिर सेव करें।
- "… is a virtual location (job work, transit or scrap); its stock is settled by that flow." — असली store location चुनें; job worker या transit का स्टॉक job work / inter-plant से निपटता है।
- ""Save" बटन धूसर रहते हैं" — Plant चुनें और कम से कम एक लाइन में delta लिखें।

**अटक गए तो**
1. अगर "Save & Post" पर second-person वाला "Post failed" आए तो draft सेव हो चुका है: Stock Adjustments खोलें, दोबारा न दबाएँ (दूसरा draft बन जाएगा)।

जुड़े पेज: /inventory/adjustments, /inventory/adjustments/[id], /inventory/stock-lifecycle

**अभी नहीं होता / ध्यान दें**
- "Save & Post" पहले draft सेव करता है फिर post; जिसने draft बनाया वह Owner/Admin न हो तो post मना होता है (दूसरे व्यक्ति का नियम), पेज फ़ॉर्म पर ही "Post failed" दिखाता है, और दोबारा दबाने से दूसरा draft बन जाता है।
- Before → After preview सिर्फ़ roll लाइनों पर चलता है; bulk, packaging और trading-good लाइनों पर हमेशा "Pick a roll or material to preview qty" दिखता है।

### Alerts Center (/inventory/alerts)
स्क्रीन का पता: /inventory/alerts · भूमिकाएँ: ADMIN, OWNER, STORE, PLANNER, PLANT_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=inventory-alerts&lang=hi

रात की स्टॉक जाँच में मिली गड़बड़ियों की सूची (negative stock, low stock, ledger mismatch, weight mismatch, orphan या अटके roll) — severity और Resolve बटन के साथ।

रोज़ खोलें: किस plant या material में गड़बड़ी खुली है, कारण ठीक करें (गिनती, adjustment, roll सुधार) और नोट लिखकर alert बंद करें।

**शुरू करने से पहले**
- Alert रात की reconciliation से (या Inventory health पर "Run audit" से) बनते हैं। Resolve करने के लिए inventory देखने का अधिकार काफ़ी है।

**स्टेप बाय स्टेप**
1. "Open" (पहले से चुना), "Resolved" या "All" चुनें; reload के लिए "Refresh"।
2. "Search alert, material, roll, or plant" में लिखें।
3. टाइल पढ़ें: Open alerts, Critical now, Resolved in view, Current filter; और "Severity mix" व "Top alert families" चार्ट।
4. "Alert queue" में हर alert का संदेश, material, roll और plant पढ़ें।
5. पहले कारण ठीक करें (stock count, stock adjustment, roll सुधार)।
6. "Resolve" दबाएँ, "Resolution note" लिखें और "Mark resolved" दबाएँ।

**स्क्रीन पर क्या है**
- **Severity**: CRITICAL, HIGH, MEDIUM, LOW। Critical और high पहले देखें।
- **Type**: Negative Stock, Low Stock, Orphan Roll, Missing Parent, Missing Child, Stuck WIP, Cost Mismatch, Weight Mismatch, Transaction Mismatch।
- **Needs action / Resolved**: Resolved alert में किसने, कब बंद किया और नोट दिखता है।

**आम दिक्कतें और हल**
- "No alerts found" — इस filter में कुछ खुला नहीं। पुराने बंद देखने के लिए "All" चुनें। Alert की उम्मीद थी तो "Refresh" दबाएँ — लोड न होने पर भी यही दिखता है।
- "Alert already resolved" — किसी और ने पहले बंद किया, या रात की जाँच ने खुद बंद कर दिया। "Refresh" दबाएँ।

**अटक गए तो**
1. Mismatch alert (TXN_MISMATCH, NEGATIVE_STOCK, WEIGHT_MISMATCH, ORPHAN_ROLL, STUCK_WIP) हर गड़बड़ी के लिए एक ही रहते हैं और कारण ठीक होने के अगले दिन खुद बंद हो जाते हैं।
2. Resolve से कुछ न हो तो "Refresh" दबाकर फिर कोशिश करें; गलती स्क्रीन पर नहीं दिखती।

जुड़े पेज: /inventory/adjustments/new, /inventory/stock-lifecycle, /inventory/ledger, /analytics/inventory-health

**अभी नहीं होता / ध्यान दें**
- लोड और resolve की गलती सिर्फ़ log होती है, दिखती नहीं; लोड fail होने पर भी "No alerts found" दिखता है।
- यहाँ "Run audit" बटन नहीं (वह Inventory health पर है), और alert से material, roll या adjustment स्क्रीन का link नहीं।

### Bulk & chemicals (/inventory/bulk)
स्क्रीन का पता: /inventory/bulk · भूमिकाएँ: ADMIN, OWNER, STORE, PLANNER, WORK_CENTER_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=inventory-bulk&lang=hi

हर bulk स्टॉक row — granules, resin, ink, adhesive, solvent, chemical — material code, plant, location और class के हिसाब से, reservation के साथ।

कोई granule या chemical कहाँ रखा है, sales hold के बाद कितना खाली है, यह देखने और bulk सूची export करने के लिए खोलें। स्टॉक GRN ("Receive bulk") से आता है, खपत और adjustment से घटता है।

**शुरू करने से पहले**
- Material master में हों और स्टॉक GRN या opening stock से आया हो।

**स्टेप बाय स्टेप**
1. "Pulse" (KPI और बँटवारा) या "Browse" (पूरी टेबल / ग्रिड) चुनें।
2. Saved view चुनें: "All bulk" या "Has reservation"; अपना view "Save current" से रखें।
3. Search (material, lot, vendor, location) करें और पट्टी में: Material code / family, Ink / color shade, Material class, Plant, Location।
4. ज़रूरत हो तो "Show only reserved rows" या "Purchased add-ons only" टिक करें।
5. Row पर क्लिक करें (Code, Grade, Vendor, UOM, Plant, Location, Expiry, Age, Sales reservations), फिर महीने की आवाजाही के लिए "Stock card"।
6. Bulk सूची के लिए "Export" दबाएँ; नीचे प्रति पेज rows (25–500) बदलें।

**स्क्रीन पर क्या है**
- **Material class**: Granules / resin, Inks / pigment, Adhesives, Solvents, Chemicals, Other।
- **ADDON निशान**: सिर्फ़ Add-on Master के खरीदे add-on पर लगता है; सामान्य ink, adhesive, solvent साधारण bulk ही रहते हैं।
- **Code**: Quality code; एक material एक location पर कई code में हो सकता है।
- **Reserved / Available**: Reserved = sales order के लिए रोका; Available = On hand − Reserved।

**आम दिक्कतें और हल**
- "Could not load bulk inventory." — स्टॉक snapshot नहीं आया। Reload करें; बार-बार हो तो administrator को बताएँ।
- "No active reservations." — कोई sales order इसे नहीं रोक रहा; पूरा खाली है।

**अटक गए तो**
1. कोई row न दिखे तो filter chips हटाएँ ("Clear all") और plant व location देखें।

जुड़े पेज: /inventory, /inventory/addons, /inventory/grn, /inventory/stock-lifecycle, /inventory/bulk-transactions

### Bulk Transactions (/inventory/bulk-transactions)
स्क्रीन का पता: /inventory/bulk-transactions · भूमिकाएँ: ADMIN, OWNER, STORE, PLANNER, PLANT_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=inventory-bulk-transactions&lang=hi

हर bulk (pooled) material की आवाजाही का केवल-पढ़ने वाला लॉग: inward, consumption, transfer और adjustment, नया सबसे ऊपर।

किसी bulk बैलेंस के बदलने का कारण देखने के लिए खोलें: किस GRN, job या adjustment से और कब।

**शुरू करने से पहले**
- Inventory देखने का अधिकार। आवाजाही GRN, production खपत, transfer और adjustment से आती है।

**स्टेप बाय स्टेप**
1. "Recent Activity" पढ़ें (हर पेज पर 50)।
2. Type देखें: Inward, Consumption, Transfer, Adjustment।
3. Material, Location, Quantity (+ आया, − गया, unit के साथ) और Reference (Job नंबर या document) पढ़ें।
4. पुरानी rows के लिए नीचे pager; और पुरानी के लिए header में पिछला financial year चुनें।

**स्क्रीन पर क्या है**
- **Reference**: Production job ने खर्च किया तो "Job …"; वरना document reference या "System Auto"।
- **Quantity**: Unit में + या − मात्रा (KG 2 दशमलव, METER 1, PCS पूरे)।

**आम दिक्कतें और हल**
- "Showing the newest … of … entries" — सूची सीमित है। पुरानी entries के लिए header में पिछला financial year चुनें।
- "No transactions recorded yet." — चुने साल में कोई bulk आवाजाही नहीं।

**अटक गए तो**
1. किसी एक material का चलता बैलेंस Stock card (Bulk drawer → "Stock card") या Stock ledger में देखें।

जुड़े पेज: /inventory/bulk, /inventory/ledger, /inventory/adjustments

**अभी नहीं होता / ध्यान दें**
- कोई search, type, material, location या तारीख़ filter और export नहीं; सिर्फ़ paging और header का financial year।

### Count at rack (हट गया) (/inventory/count)
स्क्रीन का पता: /inventory/count · भूमिकाएँ: ADMIN, OWNER, STORE, PLANNER, PLANT_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=inventory-count&lang=hi

स्टॉक गिनती का पुराना पता। यह Stock lifecycle का "Stock count" टैब खोलता है।

गिनती अब एक जगह है, "Count and close": किसी भी दिन, month end या period की stock count, और evening packing count। पुराने link और "Count at rack" टैब वहीं पहुँचाते हैं।

**शुरू करने से पहले**
- Stock lifecycle का अधिकार (inventory audit view या manage)।

**स्टेप बाय स्टेप**
1. Link खोलें; आप Stock lifecycle → "Stock count" पर पहुँचेंगे।
2. "Stock count · any day, month end or period" या packing count चुनें और उस टैब के कदम करें।
3. अपना bookmark /inventory/stock-lifecycle?tab=count कर लें।

**अटक गए तो**
1. Redirect के बाद access संदेश आए तो administrator से stock lifecycle अधिकार माँगें।

जुड़े पेज: /inventory/stock-lifecycle, /logistics/packing/consumption

**अभी नहीं होता / ध्यान दें**
- Stock टैब पट्टी में अब भी "Count at rack" इसी पुराने route पर जाता है, जो सिर्फ़ Stock lifecycle पर भेजता है।

### Bills & documents (/inventory/gate-bills)
स्क्रीन का पता: /inventory/gate-bills · भूमिकाएँ: STORE, ADMIN, SUPER_ADMIN, OWNER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=inventory-gate-bills&lang=hi

फैक्ट्री को मिलने वाले हर बिल का एक रजिस्टर — गेट पर फ़ोटो या ऑफ़िस में अपलोड (फ़ोटो या PDF) — inbox, search, filed records, follow-ups और reports के साथ।

Inbox से हर काग़ज़ को सही अंत तक पहुँचाएँ: stock का GRN, job work का उसका order, spares / machinery / service की General Receipt, utility, fee, transport और notes file होते हैं। सिर्फ़ stock से inventory बदलती है।

**शुरू करने से पहले**
- Bills & documents के अधिकार: Inventory (STORE) के पास पहले से होते हैं, Owner और Admin के पास हमेशा। किसी और role या व्यक्ति को Role matrix या User overrides में documents अधिकार देने पड़ते हैं। Watchman को यह स्क्रीन कभी नहीं दिखती।
- गेट की फ़ोटो watchman के gate terminal से आती हैं; "Upload bill" के लिए documents upload अधिकार चाहिए।

**स्टेप बाय स्टेप**
1. Header की गिनती पढ़ें: need classifying, waiting for receipt, partly received।
2. "Inbox" में chip चुनें: "Needs classifying", "Waiting for receipt" या "Partly received"; ज़रूरत हो तो factory चुनें। सूची खुद refresh होती है।
3. Row पर क्लिक करके खोलें और अगला कदम करें (row पर नीला लिखा होता है, जैसे "Classify it", "Post GRN", "File it")।
4. डाक या ईमेल से आए बिल के लिए "Upload bill": factory चुनें, फ़ोटो या PDF जोड़ें, पेज क्रम लगाएँ, चाहें तो "Add bill details now (optional)", फिर "Upload N files"।
5. "All documents" या "Filed" में invoice no., party, vendor या bill ref से खोजें, filter (status, category, source, factory, vendor, dates, order) लगाएँ और "Export CSV" करें।
6. "Non-stock follow-ups" (manage अधिकार) में हर पुराने non-stock void पर "General receipt" दबाकर दर्ज करें कि उसमें क्या आया।
7. "Reports" में status, ageing, category के हिसाब से रकम, top vendors, General Receipt खर्च और top machines देखें; Owner/Admin को "Document storage" भी दिखता है।

**स्क्रीन पर क्या है**
- **Stage**: Waiting for receipt, Partly received, Received, Filed, Voided (record-only काग़ज़ के लिए "Ready to file")।
- **Source**: Gate photo = आते समय watchman ने फ़ोटो ली; Office upload = बाद में जोड़ा, गेट आगमन नहीं माना जाता।
- **इंतज़ार का समय**: दाईं ओर का नंबर: खुला बिल आने के बाद से कितनी देर से रुका है।
- **Upload सीमा**: एक document में 20 file और 20 पेज तक; फ़ोटो 10 MB, PDF 15 MB तक; JPEG, PNG, WebP या PDF (HEIC को JPEG बनाएँ)।
- **Possible duplicates**: वही vendor + bill no. + financial year पहले से दर्ज है।

**आम दिक्कतें और हल**
- "Uploading bills needs the documents upload right (Inventory by default)." — Owner/Admin से Role matrix में documents upload अधिकार माँगें।
- "Upload not confirmed" — नेटवर्क टूटा। "Send the same upload again" दबाएँ — दूसरा बिल नहीं बनेगा। Discard तभी करें जब रजिस्टर में न दिखे।
- "Not added: … is larger than 10 MB / 15 MB" — फ़ोटो छोटी करें या PDF बाँटें।
- "The register export is limited to … documents. Narrow the dates or filters." — छोटी तारीख़ सीमा या और filter चुनकर फिर export करें।

**अटक गए तो**
1. अगर सेव "not confirmed" दिखाए (नेटवर्क टूटा), तो वही बटन दोबारा दबाएँ (अब उस पर "Send same request again" जैसा लिखा होगा)। सिस्टम दोबारा भेजा गया request पहचानता है और दो बार दर्ज नहीं करता।
2. "Counts could not refresh" दिखे तो पिछली गिनती दिख रही है; पेज reload करें।

जुड़े पेज: /inventory/gate-bills/[id], /inventory/grn, /inventory/general-receipts, /inventory/general-receipts/new, /inventory/job-work, /gate

**अभी नहीं होता / ध्यान दें**
- Inbox refresh का tooltip 5 सेकंड कहता है, पर सूची असल में लगभग हर 15 सेकंड में refresh होती है।

### Bill / document (/inventory/gate-bills/[id])
स्क्रीन का पता: /inventory/gate-bills/[id] · भूमिकाएँ: STORE, ADMIN, SUPER_ADMIN, OWNER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=inventory-gate-bills-id&lang=hi

एक बिल: उसके पेज फ़ॉर्म के बगल में रहते हैं, आप विवरण भरते हैं, category चुनते हैं और अगला कदम लेते हैं (GRN, job work, General Receipt, file या attach)।

Inbox से खोलकर एक काग़ज़ बिना दोबारा टाइप किए पूरा करें। विवरण सेव करने से कुछ receive या post नहीं होता; स्टॉक तभी बदलता है जब यहाँ से GRN post हो।

**शुरू करने से पहले**
- Bills & documents के अधिकार: Inventory (STORE) के पास पहले से होते हैं, Owner और Admin के पास हमेशा। किसी और role या व्यक्ति को Role matrix या User overrides में documents अधिकार देने पड़ते हैं। Watchman को यह स्क्रीन कभी नहीं दिखती।
- Classify, file और void के लिए documents manage अधिकार; GRN या job-work receipt के लिए inventory receiving अधिकार चाहिए।

**स्टेप बाय स्टेप**
1. बिल पढ़ने लायक रखें: "Dock beside the form", "Float over the form", "Open in another window" या "Hide the bill (Alt+B)"। फ़ोन पर नीचे sheet आती है।
2. "What is this paper?" में "Document type" और "Category — decides the next step" चुनें।
3. Vendor चुनें या party लिखें, फिर "Bill / invoice number", "Bill date", "Taxable (₹)", "Tax (₹)", "Total (₹)" ("Set total = taxable + tax" दिखे तो दबाएँ), due date, valid-until और ज़रूरत हो तो "Shipped to"।
4. "Save details" दबाएँ।
5. "Next step" में category का बटन दबाएँ: "Open GRN" (stock), "Receive job work", "Create general receipt" (spares, machinery, service), "Attach to the stock bill" (transport) या "File as record"।
6. अगर फ़ोटो देखने से पहले GRN post हो गया था तो "Match an existing receipt" से जोड़ें, और सब लाइनें पूरी हों तो close वाला टिक लगाएँ।
7. बिल "Partly received" हो और सब लाइनें आ गई हों तो "Confirm all lines received" दबाएँ, कारण लिखें और "Close bill as received"।
8. "More actions" में "Attach to another bill…", "File as record…", "Detach from main bill…", "Reopen…" (Owner/Admin) या "Void…"।

**स्क्रीन पर क्या है**
- **Category**: Stock items (GRN); Job work; Spares and parts / Machinery and equipment / Service / repair → General Receipt; Utility, Professional / statutory fee, Other expense → file; Transport / freight → stock बिल से जोड़ें या file करें।
- **Document type**: Tax invoice, Delivery challan, Transport LR / consignment note, Debit note, Credit note, Service report, Utility bill, Other document।
- **Payment due date**: वैकल्पिक; 3 दिन पहले से याद दिलाता है।
- **Valid until (licence / AMC)**: वैकल्पिक; 60, 30 और 7 दिन पहले renewal की याद।
- **Shipped to**: बिल इस factory के नाम है पर माल दूसरी में गया; तब receipt वहाँ दर्ज हो सकती है।
- **Receipts linked / Timeline**: बिल पर लगे GRN और receipt (reversed भी इतिहास में रहते हैं) और उसकी हर घटना।
- **Shortcuts**: Alt+B दिखाएँ/छिपाएँ, Alt+←/→ पेज, Alt+= / − zoom, Alt+0 fit width, Alt+R घुमाएँ; टाइप करते हुए भी चलते हैं।

**आम दिक्कतें और हल**
- "Someone else saved this document while you were editing." — किसी और ने पहले सेव किया। उनके मान आपके बदलाव के पीछे लोड हैं; जाँचें, फिर दोबारा सेव करें या अपने हटाएँ।
- "Save or discard the changed details first, so the next screen uses them." — "Open GRN" या General Receipt बटन से पहले "Save details" दबाएँ।
- "Only record-only paper can be filed …" — File करने से पहले utility, fee, transport या other-expense category, या note / report document type चुनें।
- "A bill with posted receipts cannot be voided. Review its remaining lines." — Receipt जुड़ी हैं; void की जगह complete करें, या Owner/Admin से पूछें।
- "Same invoice already recorded." — वही vendor bill नंबर दूसरे document पर है। इसे "Duplicate" से void करें, या फिर भी रखने का कारण लिखें।
- "Posting a GRN needs inventory receiving rights." — Inventory (Store) user को इस बिल से GRN post करना होगा।

**अटक गए तो**
1. अगर सेव "not confirmed" दिखाए (नेटवर्क टूटा), तो वही बटन दोबारा दबाएँ (अब उस पर "Send same request again" जैसा लिखा होगा)। सिस्टम दोबारा भेजा गया request पहचानता है और दो बार दर्ज नहीं करता।
2. "Live refresh failed" दिखे तो "Retry" दबाएँ; स्क्रीन पर आख़िरी लोड हुई स्थिति है।
3. File या void गलत हुआ: Owner/Admin "More actions" → "Reopen…" से कारण लिखकर खोलें।

जुड़े पेज: /inventory/gate-bills, /inventory/gate-bills/[id]/view, /inventory/grn, /inventory/job-work, /inventory/general-receipts/new

### Bill viewer (pop-out) (/inventory/gate-bills/[id]/view)
स्क्रीन का पता: /inventory/gate-bills/[id]/view · भूमिकाएँ: STORE, ADMIN, SUPER_ADMIN, OWNER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=inventory-gate-bills-id-view&lang=hi

एक बिल को अलग विंडो में दिखाता है — दूसरे monitor के लिए अच्छा — जबकि फ़ॉर्म मुख्य विंडो में रहता है।

बिल, GRN या General Receipt स्क्रीन पर "Open in another window" से खुलता है। पेज, zoom, घुमाव और pin किया हिस्सा फ़ॉर्म वाली विंडो के साथ चलते हैं।

**शुरू करने से पहले**
- Bills & documents के अधिकार: Inventory (STORE) के पास पहले से होते हैं, Owner और Admin के पास हमेशा। किसी और role या व्यक्ति को Role matrix या User overrides में documents अधिकार देने पड़ते हैं। Watchman को यह स्क्रीन कभी नहीं दिखती।

**स्टेप बाय स्टेप**
1. फ़ॉर्म स्क्रीन पर "Open in another window" दबाएँ; नई विंडो दूसरे monitor पर ले जाएँ।
2. Chip देखें: "Follows the form window" = जुड़ा है; "Form window not open" = नहीं जुड़ा।
3. पेज खिसकाने के लिए drag, zoom के लिए Ctrl/⌘ + scroll या pinch, double-click से zoom in, जो हिस्सा कॉपी कर रहे हैं उसे Shift-drag से pin करें।
4. Alt + ←/→ पेज बदलता है, Alt+= / − zoom, Alt+0 fit width, Alt+R घुमाता है — फ़ॉर्म में टाइप करते हुए भी।
5. बिल वापस फ़ॉर्म के बगल में लाने के लिए "Close window" (या फ़ॉर्म में "Bring back") दबाएँ।

**स्क्रीन पर क्या है**
- **Save rotation for everyone**: घुमाव सिर्फ़ आपके लिए है जब तक यह न दबाएँ; असली image कभी नहीं बदलती।

**आम दिक्कतें और हल**
- "You cannot open this bill" — बिल inventory टीम के लिए हैं; administrator से documents अनुमति माँगें।
- "This bill link is not valid" — बिल रजिस्टर या GRN स्क्रीन से बिल फिर खोलें।
- "This bill is no longer available" — दूसरी factory का है या link गलत है; रजिस्टर से फिर खोलें।

**अटक गए तो**
1. पेज फ़ॉर्म के साथ न चलें तो यह विंडो बंद करके फिर "Open in another window" दबाएँ।

जुड़े पेज: /inventory/gate-bills/[id], /inventory/grn, /inventory/general-receipts/new

### Gate passes (/inventory/gate-passes)
स्क्रीन का पता: /inventory/gate-passes · भूमिकाएँ: STORE, ADMIN, SUPER_ADMIN, OWNER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=inventory-gate-passes&lang=hi

फैक्ट्री से बाहर जाने वाले मशीन पुर्ज़े, औज़ार और उपकरण के लिए नंबर वाले returnable (RGP) और non-returnable (NRGP) gate pass। Gate pass से स्टॉक नहीं बदलता।

क्या बाहर है, किसके पास है और कब लौटना है यह देखने और नया pass बनाने के लिए खोलें। सामान निकलते समय watchman छपा QR scan करता है; वापसी से pass बंद होता है।

**शुरू करने से पहले**
- Bills & documents के अधिकार: Inventory (STORE) के पास पहले से होते हैं, Owner और Admin के पास हमेशा। किसी और role या व्यक्ति को Role matrix या User overrides में documents अधिकार देने पड़ते हैं। Watchman को यह स्क्रीन कभी नहीं दिखती।
- Pass बनाने, issue और बंद करने के लिए gate pass अधिकार (gatepass.manage) चाहिए।

**स्टेप बाय स्टेप**
1. Header की गिनती पढ़ें: open और overdue।
2. टैब चुनें: "Open", "Overdue", "Returned / closed", "Drafts", "All"।
3. Number, party, item, serial या vehicle से खोजें; Factory, Type, Vendor और Machine से छाँटें।
4. Pass पर क्लिक करके खोलें (issue, print, receive back, short-close)।
5. नया बनाने के लिए "New gate pass" दबाएँ।

**स्क्रीन पर क्या है**
- **Type**: Returnable (RGP): repair, calibration, fabrication, trial या loan; सब सामान लौटने या short-close तक खुला। Non-returnable (NRGP): scrap sale, sample या supplier को वापसी; गेट से निकलते ही बंद।
- **Status**: Draft, Issued · waiting at gate, Out of factory, Partly returned, Returned, Closed, Short-closed, Cancelled; लाल में Overdue N days।
- **Lines back / due back**: बाहर गए RGP के लिए: कितनी लाइनें लौटीं और लौटने की तारीख़।

**आम दिक्कतें और हल**
- "Gate passes are for the inventory team" — आपके खाते में documents अधिकार नहीं; administrator से पूछें।

**अटक गए तो**
1. सूची पुरानी लगे तो वह हर 30 सेकंड में refresh होती है; टैब बदलें या reload करें।

जुड़े पेज: /inventory/gate-passes/new, /inventory/gate-passes/[id], /inventory/general-receipts, /inventory/goods-movements, /gate

### Gate pass (/inventory/gate-passes/[id])
स्क्रीन का पता: /inventory/gate-passes/[id] · भूमिकाएँ: STORE, ADMIN, SUPER_ADMIN, OWNER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=inventory-gate-passes-id&lang=hi

एक gate pass — विवरण, सामान (qty, back, still out), वापसी, गेट से निकलने की फ़ोटो और इतिहास, साथ में Issue, Print, Receive back, Short-close और Cancel।

Draft issue करने, गेट के लिए print करने और हर returnable सामान लौटने या short-close होने तक नज़र रखने के लिए।

**शुरू करने से पहले**
- Bills & documents के अधिकार: Inventory (STORE) के पास पहले से होते हैं, Owner और Admin के पास हमेशा। किसी और role या व्यक्ति को Role matrix या User overrides में documents अधिकार देने पड़ते हैं। Watchman को यह स्क्रीन कभी नहीं दिखती।
- कोई भी बदलाव करने के लिए gate pass अधिकार (gatepass.manage)।

**स्टेप बाय स्टेप**
1. Draft हो तो: ज़रूरत पर "Edit draft", फिर नंबर पाने के लिए "Issue" दबाएँ।
2. "Print PDF" (draft पर "Preview PDF") दबाएँ और काग़ज़ सामान के साथ भेजें।
3. अगर सामान दूसरे काग़ज़ पर जाता है तो QR label बटन से label छापकर उस काग़ज़ पर लगाएँ; गेट उसे scan करेगा।
4. Watchman के scan करने पर status "Out of factory" हो जाता है।
5. सामान vendor बिल के साथ लौटे तो बिल पर General Receipt बनाएँ और "Came back on a returnable gate pass (RGP)" टिक करें।
6. बिना बिल लौटे तो "Receive back" दबाएँ, हर लाइन की मात्रा और कारण लिखें।
7. बाकी सामान नहीं लौटेगा तो कारण के साथ "Short-close"; न इस्तेमाल हुए pass को रोकने के लिए "Cancel pass"।

**स्क्रीन पर क्या है**
- **Still out**: हर लाइन की अभी तक न लौटी मात्रा।
- **Returns**: हर वापसी एक बार दर्ज, कभी बदली नहीं जाती, जुड़ी General Receipt लाइनों के साथ।
- **Gate exit photos**: गेट द्वारा QR scan या office match से जोड़ी गई बाहर जाने की फ़ोटो।
- **Details**: Party, address, GSTIN, purpose, expected back, carried by, vehicle, issued, left the gate, closed, approx. value, notes।

**आम दिक्कतें और हल**
- "Only … of line … is still out on …" — आपने बाहर बची मात्रा से ज़्यादा लिखा। बची मात्रा या कम लिखें।
- "This gate pass was changed by someone else. Reload it and try again." — पेज reload करके फिर करें।
- "Set an expected return date of today or later before issuing." — Draft रहते तारीख़ निकल गई; "Edit draft" से नई तारीख़ डालें।
- "This gate pass is still a draft. Ask the office to issue it before the items leave." — Draft scan होने पर गेट पर दिखता है। यहाँ "Issue" दबाएँ।

**अटक गए तो**
1. अगर सेव "not confirmed" दिखाए (नेटवर्क टूटा), तो वही बटन दोबारा दबाएँ (अब उस पर "Send same request again" जैसा लिखा होगा)। सिस्टम दोबारा भेजा गया request पहचानता है और दो बार दर्ज नहीं करता।
2. जिस General Receipt से सामान लौटा वह reverse नहीं होती; पहले owner के साथ pass ठीक करें।

जुड़े पेज: /inventory/gate-passes, /inventory/general-receipts/new, /inventory/goods-movements, /gate

### New gate pass (/inventory/gate-passes/new)
स्क्रीन का पता: /inventory/gate-passes/new · भूमिकाएँ: STORE, ADMIN, SUPER_ADMIN, OWNER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=inventory-gate-passes-new&lang=hi

RGP (सामान लौटेगा) या NRGP (नहीं लौटेगा) बनाने का फ़ॉर्म। पहले draft सेव होता है, फिर issue करने पर नंबर और QR मिलता है।

जब भी कोई पुर्ज़ा, औज़ार या उपकरण (स्टॉक नहीं) बाहर जाए तब इस्तेमाल करें। दूसरी plant को स्टॉक Inter-plant से, job worker को material Job work से, ग्राहक को माल Dispatch bay से जाता है।

**शुरू करने से पहले**
- Gate pass अधिकार (gatepass.manage); factory और machine बने हों; vendor master में हो या party का नाम।

**स्टेप बाय स्टेप**
1. "Type of gate pass" में Returnable (RGP) या Non-returnable (NRGP) चुनें।
2. "Where the items go" में "Factory (items leave from)" और "Purpose" चुनें।
3. "Vendor" चुनें या "Or party name (not in vendor list)", "Address" और वैकल्पिक "GSTIN" भरें।
4. RGP के लिए "Expected back by" डालें; ज़रूरत हो तो "Carried by", "Vehicle" और छपने वाले notes।
5. "Items" में हर सामान की एक लाइन: Description, Qty, Unit, Machine (वैकल्पिक), Equipment, Serial no., Approx. value ₹, Remarks।
6. "Save as draft" या तुरंत नंबर के लिए "Save and issue" दबाएँ। फिर अगली स्क्रीन पर print करें।

**स्क्रीन पर क्या है**
- **Purpose**: RGP: repair, calibration, fabrication, trial, loan; NRGP: scrap sale, sample, supplier को वापसी। RGP पर scrap sale नहीं।
- **Machine**: पुर्ज़ा किसी मशीन का हो तो मशीन जोड़ें, ताकि machine history में दिखे।
- **Expected back by**: RGP के लिए ज़रूरी; पिछली तारीख़ नहीं। निकलने पर pass Overdue दिखता है।

**आम दिक्कतें और हल**
- "A returnable gate pass needs an expected return date." — "Expected back by" भरें।
- "Choose a vendor or type who the items go to." — Vendor चुनें या party का नाम लिखें।
- "Scrap sale items do not come back. Use a non-returnable gate pass (NRGP)." — Type को NRGP करें।
- "Enter a valid 15-character GSTIN or leave it blank." — GSTIN ठीक करें या खाली छोड़ें।
- "Draft saved, but it could not be issued: …" — Draft बन गया है; बताया कारण ठीक करके अगली स्क्रीन पर "Issue" दबाएँ।

**अटक गए तो**
1. अगर सेव "not confirmed" दिखाए (नेटवर्क टूटा), तो वही बटन दोबारा दबाएँ (अब उस पर "Send same request again" जैसा लिखा होगा)। सिस्टम दोबारा भेजा गया request पहचानता है और दो बार दर्ज नहीं करता।

जुड़े पेज: /inventory/gate-passes, /inventory/gate-passes/[id], /inventory/goods-movements

**अभी नहीं होता / ध्यान दें**
- Issue fail होने पर भी "Save and issue" draft सेव कर देता है; user draft पर पहुँचता है और फिर "Issue" दबाना पड़ता है।

### General receipts (/inventory/general-receipts)
स्क्रीन का पता: /inventory/general-receipts · भूमिकाएँ: STORE, ADMIN, SUPER_ADMIN, OWNER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=inventory-general-receipts&lang=hi

Spares, machinery, औज़ार, service और charges का रजिस्टर: क्या आया या क्या काम हुआ, किसने पुष्टि की, कब और किस मशीन पर। इनसे स्टॉक नहीं बदलता।

पुरानी non-stock खरीद ढूँढने या किसी मशीन के spares, service और gate-pass आने-जाने का पूरा इतिहास देखने के लिए खोलें।

**शुरू करने से पहले**
- Bills & documents के अधिकार: Inventory (STORE) के पास पहले से होते हैं, Owner और Admin के पास हमेशा। किसी और role या व्यक्ति को Role matrix या User overrides में documents अधिकार देने पड़ते हैं। Watchman को यह स्क्रीन कभी नहीं दिखती।

**स्टेप बाय स्टेप**
1. "Receipts" में GR no., party, invoice, item या serial से खोजें।
2. Type (Goods / Services), line type, status (Posted / Reversed), factory और तारीख़ से छाँटें।
3. Receipt पर क्लिक करके खोलें, print करें या (Owner/Admin) reverse करें।
4. "Machine history" में factory और machine चुनें; हर spare, service और gate-pass आवाजाही, नई पहले।
5. बिना बिल के दर्ज करने के लिए "New general receipt" (documents manage अधिकार); सामान्यतः बिल से शुरू करें।

**स्क्रीन पर क्या है**
- **Amount**: हर row के दाईं ओर GST सहित कुल।
- **Line type**: Spares and parts, Machinery / equipment, Tools, General consumable, Safety items, Electrical, Civil / building, Office / admin, Service / labour, Freight / other charge।
- **Machine history**: Receipt लाइनें (reversed कटी हुई) और "Left on gate pass" / "Came back on gate pass" घटनाएँ।

**आम दिक्कतें और हल**
- "General receipts are for the Inventory team" — Documents देखने का अधिकार नहीं; administrator से पूछें।
- "No general receipts" — इन filter में कुछ नहीं। Filter हटाएँ या तारीख़ बढ़ाएँ।

**अटक गए तो**
1. मशीन के इतिहास में receipt नहीं: receipt खोलकर देखें लाइन में वह मशीन चुनी है या नहीं।

जुड़े पेज: /inventory/general-receipts/new, /inventory/general-receipts/[id], /inventory/gate-bills, /inventory/gate-passes

### General receipt (/inventory/general-receipts/[id])
स्क्रीन का पता: /inventory/general-receipts/[id] · भूमिकाएँ: STORE, ADMIN, SUPER_ADMIN, OWNER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=inventory-general-receipts-id&lang=hi

केवल-पढ़ने वाली, print होने वाली general receipt — लाइनें, GST, machine और gate-pass link और उसका बिल।

क्या आया या क्या काम हुआ इसका सबूत। गलती सिर्फ़ reverse से ठीक होती है; कुछ delete नहीं होता।

**शुरू करने से पहले**
- Bills & documents के अधिकार: Inventory (STORE) के पास पहले से होते हैं, Owner और Admin के पास हमेशा। किसी और role या व्यक्ति को Role matrix या User overrides में documents अधिकार देने पड़ते हैं। Watchman को यह स्क्रीन कभी नहीं दिखती।

**स्टेप बाय स्टेप**
1. ऊपर देखें: नंबर, factory, Posted / Reversed, "No stock posted"।
2. Party, Bill / invoice, Bill in register, Received by (या Work confirmed by), Received at, Recorded by और PO / work order देखें।
3. लाइनें देखें: Description, Type, Qty, Rate, Amount, GST, Machine / equipment, What happened; कुल Before GST, GST, Total।
4. फ़ाइल के लिए "Print" दबाएँ (हस्ताक्षर की लाइनें छपती हैं)।
5. Owner/Admin: "Reverse…" दबाएँ, कारण (5–500 अक्षर) लिखें और "Reverse receipt"।

**स्क्रीन पर क्या है**
- **Bill in register**: बिल का link; बिना बिल बनी हो तो "Not linked yet"; पुराने non-stock void का follow-up हो तो लिखा होता है।
- **What happened**: Kept in store, Installed / fitted, Used immediately, Not applicable।

**आम दिक्कतें और हल**
- "… recorded items coming back on gate pass …, so it cannot be reversed." — Reverse करने से वापसी नहीं हटेगी। पहले owner के साथ gate pass ठीक करें और ज़रूरत हो तो नई receipt बनाएँ।
- "Only an owner or administrator can reverse a General Receipt." — Owner/Admin से कहें।
- "General receipt not found" — गलत link या आपकी पहुँच से बाहर की factory।

**अटक गए तो**
1. Reverse के बाद बिल फिर waiting (या partly received) हो जाता है; बिल से नई receipt बनाएँ।
2. अगर सेव "not confirmed" दिखाए (नेटवर्क टूटा), तो वही बटन दोबारा दबाएँ (अब उस पर "Send same request again" जैसा लिखा होगा)। सिस्टम दोबारा भेजा गया request पहचानता है और दो बार दर्ज नहीं करता।

जुड़े पेज: /inventory/general-receipts, /inventory/gate-bills/[id], /inventory/gate-passes/[id]

### New general receipt (/inventory/general-receipts/new)
स्क्रीन का पता: /inventory/general-receipts/new · भूमिकाएँ: STORE, ADMIN, SUPER_ADMIN, OWNER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=inventory-general-receipts-new&lang=hi

बिल को बगल में रखकर आया माल या हुआ service काम दर्ज करें। इससे production स्टॉक नहीं बदलता।

Classified बिल ("Create general receipt"), non-stock follow-up या खाली खुलता है। क्या आया, किसने लिया या पुष्टि की, कहाँ गया और किस मशीन पर — यह दर्ज करता है, और returnable gate-pass लाइनें बंद कर सकता है।

**शुरू करने से पहले**
- Bills & documents के अधिकार: Inventory (STORE) के पास पहले से होते हैं, Owner और Admin के पास हमेशा। किसी और role या व्यक्ति को Role matrix या User overrides में documents अधिकार देने पड़ते हैं। Watchman को यह स्क्रीन कभी नहीं दिखती।
- दर्ज करने के लिए documents manage अधिकार चाहिए। बिल spares, machinery या service में classified और खुला होना चाहिए।

**स्टेप बाय स्टेप**
1. "What came in?" में "Goods" या "Service / work done" चुनें।
2. Factory, vendor या party, "Bill / invoice number" और "Bill date" जाँचें (बिल से भरे आते हैं)।
3. "Received by" / "Work confirmed by" और "Received at" डालें; PO / work order reference और note हो तो लिखें।
4. "Lines" में Description (पुरानी receipts से सुझाव), Type, Qty, Unit, Rate (₹), GST % भरें — Amount = Qty × Rate।
5. "What happened" और "Machine" (या "Equipment (if not a listed machine)") चुनें; serial और remarks जोड़ें।
6. सामान RGP पर लौटा हो तो "Came back on a returnable gate pass (RGP)" टिक करें, लाइन और लौटी मात्रा चुनें।
7. और लाइन के लिए "Add line"। "This receipt completes the bill" तभी टिक करें जब बिल की हर लाइन पूरी हो।
8. "Save general receipt" (या "Save receipt & complete bill") दबाएँ, फिर "Open receipt"।

**स्क्रीन पर क्या है**
- **Type (लाइन)**: लाइन की श्रेणी, जैसे Spares and parts, Tools, Service / labour, Freight / other charge।
- **Unit**: NOS, PCS, SET, PAIR, KG, LTR, MTR, BOX, ROLL, JOB, HRS, VISIT, LOT।
- **GST %**: 0, 5, 12, 18, 28 या 40।
- **What happened**: Kept in store, Installed / fitted (machine या equipment ज़रूरी), Used immediately, Not applicable (service)।
- **Totals**: नीचे Before GST, GST और Total।

**आम दिक्कतें और हल**
- "Amount must equal quantity × rate = …" — Qty या rate ठीक करें।
- "A service receipt needs at least one Service / labour line." — किसी एक लाइन का type Service / labour करें, या Goods चुनें।
- "A goods receipt needs at least one goods line (not only service or freight)." — Goods लाइन जोड़ें या Service चुनें।
- "Choose the machine (or type the equipment) it was installed on." — Installed लाइन में machine या equipment का नाम चाहिए।
- "Only … of line … is still out on …" — RGP लाइन पर बाहर बची मात्रा से ज़्यादा वापसी नहीं हो सकती।
- "Received time cannot be in the future." — "Received at" ठीक करें।
- "Give a reason to receive a bill whose invoice is already recorded (or void this bill as a duplicate)." — "Same invoice already recorded" में कारण लिखें या बिल को duplicate void करें।
- "This bill is classified as record-only paper … Change its category before receiving against it." — बिल पर लौटकर category spares, machinery या service करें।

**अटक गए तो**
1. अगर सेव "not confirmed" दिखाए (नेटवर्क टूटा), तो वही बटन दोबारा दबाएँ (अब उस पर "Send same request again" जैसा लिखा होगा)। सिस्टम दोबारा भेजा गया request पहचानता है और दो बार दर्ज नहीं करता।
2. "I checked — it was not saved, unlock the form" तभी दबाएँ जब General receipts में यह न दिखे।

जुड़े पेज: /inventory/general-receipts, /inventory/gate-bills/[id], /inventory/gate-passes, /inventory/general-receipts/[id]

**अभी नहीं होता / ध्यान दें**
- Open gate-pass endpoint न हो तो RGP बॉक्स कहता है gate pass उपलब्ध नहीं, और pass बाद में उसके पेज से बंद करना पड़ता है।

### Goods in & out (/inventory/goods-movements)
स्क्रीन का पता: /inventory/goods-movements · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, STORE, PLANNER, PLANT_MANAGER, DISPATCH · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=inventory-goods-movements&lang=hi

फैक्ट्री गेट के बाहर गया हमारा हर माल और जो लौटना है, एक सूची में: inter-plant transfer, job work, returnable और non-returnable gate pass।

एक नज़र में देखें: क्या बाहर है, क्या गेट पर लौटकर store का इंतज़ार कर रहा है, कौन सा काग़ज़ बना पर माल नहीं निकला, और क्या देर से है। हर काग़ज़ की अपनी स्क्रीन है; row खोलकर काम करें।

**शुरू करने से पहले**
- Inventory देखने का अधिकार। "New movement" के लिए inventory manage या gate pass अधिकार।

**स्टेप बाय स्टेप**
1. Stage चुनें: "Outside", "Back at gate", "Prepared" या "Done" (हर एक पर गिनती)।
2. Number, party, vehicle या job खोजें; chips All, Inter-plant, Job work, Returnable, Non-returnable।
3. तय तारीख़ से देर वाली वापसी और लंबे समय रास्ते में माल देखने के लिए "Late" दबाएँ।
4. काग़ज़ उसकी स्क्रीन पर खोलने के लिए "Open" (गेट पर लौटे row के लिए "Receive") दबाएँ।
5. Watchman काग़ज़ scan न कर पाया हो तो row पर "Mark back at gate" दबाएँ; store को receive करने की सूचना जाती है। स्टॉक नहीं बदलता।
6. "New movement" पूछता है "What is leaving?": दूसरी factory (Inter-plant challan), job worker (job-work order और challan), लौटने वाला पुर्ज़ा (RGP), न लौटने वाला (NRGP), या ग्राहक को माल (Dispatch bay)।

**स्क्रीन पर क्या है**
- **Stage**: Outside = रास्ते में, job worker के पास या pass पर बाहर; Back at gate = पहुँचा, store को receive करना है; Prepared = काग़ज़ बना, माल नहीं निकला; Done = received, returned या closed।
- **Left / (no gate scan)**: कब निकला; "no gate scan" = गेट ने दर्ज नहीं किया।
- **Due back / Late**: लौटने की तारीख़; देर होने पर लाल Late (नोट के लिए माउस रखें)।
- **route step / from production**: Job route step या production से अपने-आप बनी rows।

**आम दिक्कतें और हल**
- "Not recorded (Mark back at gate के बाद)" — काग़ज़ पहले ही receive हो चुका है या दूसरी factory के गेट का है। Row खोलकर देखें।

**अटक गए तो**
1. अगर सेव "not confirmed" दिखाए (नेटवर्क टूटा), तो वही बटन दोबारा दबाएँ (अब उस पर "Send same request again" जैसा लिखा होगा)। सिस्टम दोबारा भेजा गया request पहचानता है और दो बार दर्ज नहीं करता।
2. सूची पुरानी लगे तो काम से पहले reload करें।

जुड़े पेज: /inventory/inter-plant, /inventory/job-work, /inventory/gate-passes, /inventory/gate-passes/new, /inventory/outward-documents, /logistics/dispatch

**अभी नहीं होता / ध्यान दें**
- "Mark back at gate" सिर्फ़ store को सूचना देता है; माल receive या स्टॉक नहीं बदलता, इसलिए row तब तक "Back at gate" रहती है जब तक काग़ज़ अपनी स्क्रीन पर receive न हो।

### माल प्राप्त करें (Smart GRN) (/inventory/grn)
स्क्रीन का पता: /inventory/grn · भूमिकाएँ: ADMIN, OWNER, STORE · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=inventory-grn&lang=hi

सप्लायर के एक बिल का माल स्टॉक में लेने का एक ही फ़ॉर्म: film roll, bulk माल, packaging या trading goods। Total, GST, freight और post बटन नीचे की पट्टी में रहते हैं।

जब स्टोर में माल PO, vendor के PO नंबर या बिना PO के आए, तब यह पेज खोलें। Post करते ही roll / stock की लाइन और ledger entry बनती है। अगर बिल gate पर फोटो हुआ था, तो उसे Bills & documents से खोलें — बिल फ़ॉर्म के बगल में दिखेगा और उसी save में जुड़ जाएगा। Job worker से लौटा माल यहाँ नहीं लिया जाता (Job work → Receive), और दूसरे plant से आया माल Inter-plant में लिया जाता है।

**शुरू करने से पहले**
- Vendor बना हो, active हो और उसका type Raw Material (RM) या Hybrid (BOTH) हो।
- Material master बने हों: roll के लिए film variant, bulk (granule, ink, adhesive, solvent, POD, purchased add-on) और packaging item।
- सही plant का receiving warehouse (store location) हो; virtual location नहीं चलती।
- 'Against system PO' के लिए PO sent / acknowledged / partly received हो और इस stock class की बाकी मात्रा बची हो।
- Inventory manage या purchase receipt का अधिकार।

**स्टेप बाय स्टेप**
1. 1. Stock class चुनें: "Bulk material", "Film roll", "Packaging" या "Trading goods"।
2. 2. "Where is this coming from?" में "Against system PO", "Manual vendor PO ref" या "Direct receipt" चुनें, फिर vendor, "Vendor invoice #", "Vendor invoice date", "LR / vehicle / driver" और "Receiving warehouse" भरें।
3. 3. "What did you actually receive?" में पहली लाइन भरें। Roll के लिए fast grid: film variant, stock form, width, micron, gross, tare (net अपने आप), length, grade, location, rate। आख़िरी खाने पर Enter दबाने से अगला roll उसी की copy बनकर आता है, सिर्फ़ वज़न बदलें।
4. 4. बहुत सारे roll हों तो Excel से rows paste करें, या "Live template" लेकर "Upload Excel" करें; "Excel validated · review before posting" वाली सूची जाँचें।
5. 5. "QC checks & documents" तभी खोलें जब COA, lab values (density, MFI, moisture) या inspector की नोट चाहिए।
6. 6. "Costs & taxes" जाँचें: material subtotal, GST, freight, other charges, grand total।
7. 7. नीचे की पट्टी में "Ready to post" (सभी chip ✓) दिखे तो "Submit & post" दबाएँ (Ctrl/⌘+Enter)। Trading goods "Post from trading row" से post होते हैं।
8. 8. हरा "Posted GRN-…" बॉक्स मात्रा और movements दिखाता है; ज़रूरत हो तो वहीं से roll label लें। फ़ॉर्म अगली रसीद के लिए खाली हो जाता है।

**स्क्रीन पर क्या है**
- **Stock class**: इससे grid तय होता है: roll (हर असली roll की एक लाइन), bulk/packaging (हर material और location की एक लाइन) या trading की लाइन।
- **Source type**: Against system PO में लाइनें PO की बाकी लाइनों से बँध जाती हैं; Manual vendor PO ref में सिर्फ़ vendor का नंबर रहता है; Direct receipt में PO नहीं।
- **Vendor invoice #**: हर vendor के लिए duplicate जाँच होती है; एक vendor का एक invoice नंबर दो बार नहीं लिया जा सकता।
- **Receiving warehouse**: Plant इसी warehouse से तय होता है। Gate bill जुड़ा हो तो सिर्फ़ उसी factory की location मिलती हैं।
- **Supplier roll number**: Supplier के roll पर छपा नंबर (वैकल्पिक); बाद में roll ढूँढने के लिए यही पहचान है।
- **Stock form**: Open web / sheet, Lay-flat tube या Folded web। उसी हिसाब से width open, lay-flat या folded मानी जाती है।
- **Gross kg / Tare kg / Net kg auto**: Net = gross − tare। Gross, net + tare के 0.05 kg के अंदर होना चाहिए।
- **Grade**: Extrudable film variant के लिए ज़रूरी।
- **Granule code**: Granule का quality / inward code; active हो और उसी granule का हो।
- **Download 4 × 2 inch roll labels after saving inward (optional)**: Post के तुरंत बाद roll label चाहिए तो tick करें। Label ज़रूरी नहीं; roll को supplier नंबर या हाथ से लिखे ERP ID और location से पहचाना जा सकता है।
- **नीचे के chip**: Vendor, Warehouse, System PO (PO वाली रसीद में), Materials, Qty, Period। Post से पहले सब पर ✓ होना चाहिए।
- **Grid की keys**: Enter अगला खाना · आख़िरी खाने पर Enter = नई लाइन (copy) · Shift+Enter पीछे · ↑ ↓ दूसरी लाइन का वही खाना · Alt+↓ नीचे copy · Alt+⌫ लाइन हटाएँ · Ctrl/⌘+Enter receive।

**आम दिक्कतें और हल**
- "Duplicate vendor invoice '…' for vendor …" — इस vendor का यह invoice पहले ही लिया जा चुका है। GRN history देखें; दोबारा post करने के बजाय पुरानी GRN सुधारें।
- "Vendor is required before posting GRN." — Source हिस्से में vendor चुनें।
- "GRN vendor must be RM or BOTH type." — Job worker या service vendor से stock नहीं आता। Vendors में type बदलें या सही vendor चुनें।
- "Roll gross weight must equal net + tare within 0.05 KG." — दोबारा तौलें या gross / tare ठीक करें; net को अपने आप भरने दें।
- "Roll label … already exists." — यह label किसी दूसरे roll पर है। Label खाली छोड़ें, सिस्टम नंबर देगा।
- "Grade is required for extrudable film variants." — उस roll लाइन में grade चुनें।
- "Selected PO has no receivable lines for this stock class." — PO पूरा आ चुका है या दूसरी class का है। दूसरा PO चुनें या Direct receipt करें।
- "Use the receiving grid while a gate bill is linked. Excel posting does not link this bill." — Roll grid में भरें (paste चलता है) ताकि बिल जुड़ जाए।
- "Stock saved; label download needs retry" — GRN post हो चुकी है। Saved receipt पर "Download all labels" दबाएँ; दोबारा post न करें।
- "Master data did not load." — Vendor, material या location नहीं आ पाए। Refresh करें; बार-बार हो तो admin को बताएँ।

**अटक गए तो**
1. Post करते समय time out हो तो दोबारा दबाने से पहले GRN history में invoice देखें।
2. Post के बाद गलत मात्रा, rate या roll spec को GRN history के "Correct" से सुधारें, नई GRN से नहीं।
3. Picker में material या vendor न दिखे तो admin से master बनवाएँ या active करवाएँ।

जुड़े पेज: /inventory/grn-history, /inventory/gate-bills, /procurement/purchase-orders, /inventory/rolls, /inventory/bulk, /inventory/packaging, /inventory/job-work, /inventory/inter-plant

**अभी नहीं होता / ध्यान दें**
- Smart GRN के नीचे का "Save draft" बटन कुछ नहीं करता; अधूरी रसीद save नहीं होती और पेज छोड़ने पर चली जाती है।
- Gate bill जुड़ा हो तो Excel roll upload नहीं चलता; roll grid में भरने या paste करने पड़ते हैं।
- Post time out होने पर vendor-invoice जाँच के अलावा पेज पर दोहराव की जाँच नहीं; user को GRN history देखनी पड़ती है।

### GRN history और सुधार (/inventory/grn-history)
स्क्रीन का पता: /inventory/grn-history · भूमिकाएँ: ADMIN, OWNER, STORE, PLANNER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=inventory-grn-history&lang=hi

हर inward GRN लाइन — roll, bulk, packaging और trading — filter, total और audit वाले सुधार के साथ, जब तक financial year बंद न हो।

यहाँ देखें कि क्या माल आया (source, समय, plant, vendor या search से), CSV निकालें, और post हुई GRN लाइन सुधारें। असली GRN बदलती नहीं; सुधार एक अलग entry बनाता है जिसमें पहले, बाद, फ़र्क, user और कारण रहता है।

**शुरू करने से पहले**
- Smart GRN से post हुई GRN।
- सुधार के लिए inventory manage अधिकार और खुला financial year चाहिए।

**स्टेप बाय स्टेप**
1. 1. बाएँ rail में "Source" (All, Roll, Bulk, Packaging, Trading) और "Time window" (Today, 7 days, 30 days, This FY, All time) चुनें; plant / vendor filter या search लगाएँ।
2. 2. ऊपर के tile देखें: inward rows, total qty, roll / bulk / packaging GRN, top vendors।
3. 3. CSV के लिए Export दबाएँ।
4. 4. गलत लाइन पर "Correct" दबाकर "Correct GRN row" खोलें।
5. 5. सही मात्रा / unit rate भरें, या roll के लिए label, batch, width, micron, length या roll form; चाहें तो plant / location बदलें।
6. 6. "Reason code · required" चुनें, "Reason · required" लिखें, फिर "Post correction" दबाएँ।

**स्क्रीन पर क्या है**
- **Effective qty / Effective unit rate**: पहले हुए सभी सुधारों के बाद की मात्रा/rate; बदली हो तो "corrected effective" दिखता है।
- **Year-closed**: बंद financial year की लाइनें सिर्फ़ पढ़ने के लिए हैं।
- **Reason code**: Quantity mismatch, Rate mismatch, Roll identity/spec correction, Other approved correction।
- **Corrected plant / location**: माल गलत जगह चढ़ा हो तभी बदलें, वरना "Keep current plant" / "Keep current location" रहने दें।
- **Saved views**: Filter का सेट नाम से save और pin करें।

**आम दिक्कतें और हल**
- "Reason is required before this correction can post." — कारण लिखें; यह audit में रहता है।
- "This roll already has genealogy or consumption history. Use stock count / correction instead." — Roll इस्तेमाल या split हो चुका है। Stock count या adjustment से सुधारें।
- "Consumed or scrapped rolls cannot be corrected from GRN history." — Stock count / correction से करें।
- "Corrected roll weight must be greater than zero." — Positive वज़न भरें; roll हटाना हो तो stock adjustment करें।
- "Cannot reduce this trading-good GRN below already dispatched/adjusted stock." — कुछ माल जा चुका है; सिर्फ़ बचे माल तक घटाएँ।

**अटक गए तो**
1. कोई लाइन नहीं? Time window "All time" करें और chip हटाएँ।
2. बंद साल की लाइन के लिए Count and close → Year end से FY correction चाहिए; owner से पूछें।

जुड़े पेज: /inventory/grn, /inventory/stock-lifecycle, /inventory/traceability

### Ink floor (अब Ink control में) (/inventory/ink-floor)
स्क्रीन का पता: /inventory/ink-floor · भूमिकाएँ: ADMIN, OWNER, STORE, PLANNER, WORK_CENTER_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=inventory-ink-floor&lang=hi

यह पुराना पता Ink control (/production/ink-control) खोलता है। Ink issue, return और floor count वहीं होते हैं।

Ink floor स्क्रीन Ink control में मिला दी गई है ताकि ink का issue, return और count एक जगह हो। Floor menu का "Ink floor" लिंक अभी भी यहीं आता है और आगे भेज देता है।

**शुरू करने से पहले**
- Ink control खोलने का अधिकार।

**स्टेप बाय स्टेप**
1. 1. Floor menu से "Ink floor" या यह पता खोलें।
2. 2. आप Ink control पर पहुँचेंगे; issue, return या count वहीं करें।
3. 3. किसी तारीख़ का ink floor count proof Count and close → Stock count में भी दिखता है।
4. 4. अपना bookmark /production/ink-control पर बदल लें।

**अटक गए तो**
1. Redirect पर access का संदेश आए तो Ink control का अधिकार नहीं है; admin से कहें।

जुड़े पेज: /production/ink-control, /inventory/stock-lifecycle

**अभी नहीं होता / ध्यान दें**
- Floor menu में अभी भी "Ink floor" है जबकि पेज सिर्फ़ Ink control पर भेजता है।

### Inter-Plant Transfers (plant से plant माल) (/inventory/inter-plant)
स्क्रीन का पता: /inventory/inter-plant · भूमिकाएँ: ADMIN, OWNER, STORE, PLANNER, WORK_CENTER_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=inventory-inter-plant&lang=hi

एक plant से दूसरे plant में roll और bulk माल delivery challan पर भेजें: draft, dispatch (माल source plant के IN_TRANSIT में जाता है), फिर destination पर receive।

जब भी माल plant से plant जाए, यही पेज इस्तेमाल करें। Roll को दूसरे plant में किसी और तरीके से नहीं ले जा सकते। खुले challan financial year close रोकते हैं, इसलिए हर in-transit challan receive करें।

**शुरू करने से पहले**
- दोनों plant बने हों; "Plant Legal Profiles" में GST, पता भरा हो।
- Roll AVAILABLE हों, खाली न हों, quarantine में न हों और किसी job के लिए reserved न हों।
- Source plant में IN_TRANSIT system location हो।
- Inventory या production का अधिकार।

**स्टेप बाय स्टेप**
1. 1. "New Transfer" दबाएँ → "Create Inter-Plant Challan"।
2. 2. "Source Plant", "Destination Plant" और "Material Type" (Rolls या Bulk) चुनें, फिर source और destination location।
3. 3. "Available Rolls" में roll tick करें या bulk लाइन में "Qty kg" भरें।
4. 4. अभी भेजना है तो "Dispatch immediately after create" चालू रखें, नहीं तो draft बनेगा।
5. 5. "Draft" कॉलम के card पर "Dispatch" दबाएँ, लाइन चुनें, "Confirm Dispatch"।
6. 6. Challan PDF और QR sticker के लिए "Print" दबाएँ; challan गाड़ी के साथ जाता है।
7. 7. Destination पर "In Transit" card पर "Receive" दबाएँ, "Target Location" चुनें, "Transit Rolls" / "Transit Bulk" tick करें और "Confirm Receipt" दबाएँ।

**स्क्रीन पर क्या है**
- **Total Challans / Draft / In Transit / Received**: हर stage के challan की गिनती; नीचे तीन कॉलम में सूची।
- **AUTO**: सिस्टम से अपने आप बना challan।
- **Remainder**: Parent roll का बचा हिस्सा जो फिर से इस्तेमाल के stock में लौटा, out / back में दिखता है।
- **Destination Location**: Create पर सिर्फ़ मार्गदर्शन के लिए; असली जगह receive पर Target Location में चुनी जाती है।

**आम दिक्कतें और हल**
- "Source and destination must be different." — दो अलग plant चुनें।
- "Roll … is not AVAILABLE. / has an active job reservation." — Roll reserved है या चल रहा है। WC terminal पर reservation हटाएँ या दूसरा roll चुनें।
- "Roll … is empty or quarantined." — Quarantine हटवाएँ या दूसरा roll लें।
- "System location IN_TRANSIT not found for source plant." — Admin से उस plant में IN_TRANSIT location बनवाएँ।
- "Challan is not IN_TRANSIT." — पहले ही receive हो चुका है या dispatch नहीं हुआ। Page refresh करें।
- "Select at least one pending challan line to receive." — जो roll / bulk आया उसे tick करें।
- "Popup blocked. Allow popups to print challan." — Browser में ERP के pop-up चालू करें और फिर Print दबाएँ।

**अटक गए तो**
1. Dispatch save time out हो तो दोबारा से पहले refresh करें; transfer key दोहरा भेजना रोकता है।
2. "Available Rolls" में roll न दिखे तो वह reserved, quarantine या दूसरे plant में है; Roll genealogy में देखें।

जुड़े पेज: /inventory/inter-plant/print/[id], /factory/plants, /inventory/rolls, /inventory/traceability, /inventory/stock-lifecycle

**अभी नहीं होता / ध्यान दें**
- Draft challan cancel करने का तरीका नहीं, और Draft / In Transit / Received कॉलम में search या तारीख़ filter नहीं।
- Create पर चुनी destination location सिर्फ़ मार्गदर्शन है; असली location receive पर फिर चुननी पड़ती है।

### Inter-plant challan का preview और print (/inventory/inter-plant/print/[id])
स्क्रीन का पता: /inventory/inter-plant/print/[id] · भूमिकाएँ: ADMIN, OWNER, STORE, PLANNER, WORK_CENTER_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=inventory-inter-plant-print-id&lang=hi

एक inter-plant delivery challan का PDF preview, साथ में Open PDF, Print और QR gate sticker।

Inter-plant challan के Print बटन से नए tab में खुलता है। Challan गाड़ी के साथ भेजने के लिए print करें और QR sticker भी, जिसे gate पर scan किया जाता है।

**शुरू करने से पहले**
- Challan बना हो (Inter-Plant Transfers से खोला गया)।

**स्टेप बाय स्टेप**
1. 1. Preview आने दें।
2. 2. "Print" दबाएँ; browser pop-up रोके तो "Open PDF" दबाकर viewer से print करें।
3. 3. QR gate sticker print करें (copies चुनें) और challan या माल पर लगाएँ।
4. 4. Tab बंद करें; challan Inter-Plant Transfers में अपने कॉलम में रहता है।

**स्क्रीन पर क्या है**
- **Challan ID**: Heading के नीचे challan का internal id।
- **QR gate sticker**: 4 × 2 inch label, जिसे watchman scan करता है ताकि departure अपने आप match हो।

**आम दिक्कतें और हल**
- "Unable to load PDF preview." — Challan id गलत है या server में दिक्कत। Challan card से Print फिर खोलें।
- "Popup was blocked. Use "Open PDF" and print from the viewer." — Pop-up चालू करें या Open PDF लें।

**अटक गए तो**
1. Tab बंद करें और challan पर फिर Print दबाएँ।

जुड़े पेज: /inventory/inter-plant, /inventory/outward-documents

### Job work (बाहर काम) (/inventory/job-work)
स्क्रीन का पता: /inventory/job-work · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, STORE, PLANNER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=inventory-job-work&lang=hi

बाहर के job worker को भेजा माल: order, Rule 45 challan, वापसी, बाकी माल, overdue, report और बिल जोड़ना।

जब route का कोई step बाहर जाता है (Planned route step) या अंदर क्षमता कम है (Emergency handoff), तब order बनाएँ; फिर देखें कि किस job worker के पास क्या बचा है और GST ITC-04 की एक साल की सीमा का ध्यान रखें। Job-work बिल (?bill=) से खुलने पर उस vendor के खुले order और बिना बिल वाली वापसी दिखती है।

**शुरू करने से पहले**
- Job worker vendor: active, type Job Worker या Hybrid, वह process करता हो और plant से जुड़ा हो।
- Planned step के लिए released / running / paused production job।
- Order बनाने, भेजने, receive और close करने के लिए inventory manage अधिकार; बाकी सिर्फ़ देख सकते हैं।

**स्टेप बाय स्टेप**
1. 1. View चुनें: "Open", "At vendor", "Overdue", "Closed", "Reports" (Owner को "Before upgrade" भी)।
2. 2. Plant और job worker से filter करें या "Search JWO, challan, return, job no. or vendor"।
3. 3. "New job-work order" दबाएँ: "Planned route step" या "Emergency handoff", production job, process, job worker, expected output और मात्रा, "Expected back by", "Agreed labour rate (₹, before GST)" और "Balance tolerance %" भरें।
4. 4. Order खोलकर माल भेजें, वापसी लें और close करें।
5. 5. Reports: उम्र के हिसाब से "Material at job workers" और किसी अवधि का "Yield and wastage by job worker"।
6. 6. बिल से आए हों: माल जिस खुले order का है उसे चुनें, या "Already received — link this bill" में बिल वाली वापसी tick करके Link दबाएँ।

**स्क्रीन पर क्या है**
- **Status**: Draft · At job worker · Partly returned · All returned (close के लिए तैयार) · Closed · Cancelled।
- **ITC-04 badge**: माल 300+ दिन से job worker के पास है; GST एक साल देता है।
- **Production continued**: जो वापस आया उससे route step पूरा किया गया; बाकी अभी आना है।
- **Expected back by**: इस तारीख़ के बाद overdue alert शुरू।
- **Balance tolerance %**: भेजे गए और हिसाब में आए माल के बीच बिना कारण कितना फ़र्क चल सकता है।
- **Expected output**: Finished pieces, Rolls या Bulk material। Finished pieces के लिए production job ज़रूरी।

**आम दिक्कतें और हल**
- "Vendor is not compatible for this jobwork context." — Job worker active हो, type Job worker/Hybrid हो, process करता हो और plant से जुड़ा हो। Vendor master ठीक करें।
- "Pick the production job whose route step goes to job work." — Planned route step के लिए job चुनना ज़रूरी है।
- "Say why this work goes out in an emergency." — Emergency handoff में "Why is it going out?" भरें।
- "Job … is …; only released, running or paused jobs can go to job work." — पहले planner में job release करें।
- "This document is not classified as a job-work bill. Change its category in Bills & documents first." — बिल को job work में classify करें, फिर खोलें।

**अटक गए तो**
1. Save time out हो तो वही बटन फिर दबाएँ — दोहराना पहचाना जाता है, दो बार दर्ज नहीं होता। नया request भेजना हो तो "Start over with my edits"।
2. Owner: पुरानी स्क्रीन से job worker के पास अटके roll "Before upgrade" में निपटाएँ।

जुड़े पेज: /inventory/job-work/[id], /inventory/gate-bills, /inventory/outward-documents, /inventory/vendors, /logistics/packing

**अभी नहीं होता / ध्यान दें**
- Job-work rate card order फ़ॉर्म से save होते हैं, Inventory के Vendors पेज से नहीं।

### एक job-work order का पूरा हाल (/inventory/job-work/[id])
स्क्रीन का पता: /inventory/job-work/[id] · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, STORE, PLANNER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=inventory-job-work-id&lang=hi

एक job-work order: क्या भेजा, challan, वापसी, job worker के पास बचा माल, बिल और timeline।

Rule 45 challan पर माल भेजें, जो वापस आए उसे receive करें ताकि finished माल, बचे roll और wastage सब हिसाब में आएँ, आंशिक वापसी से production आगे बढ़ाएँ, फिर order close करें (इससे planned route step पूरा होता है)।

**शुरू करने से पहले**
- Order बना हो (Job work पेज से)।
- भेजने वाले plant में roll / bulk उपलब्ध; हर material का HSN code।
- Upgrade से पहले के roll पहले reconcile हों (Owner)।

**स्टेप बाय स्टेप**
1. 1. "Send material" दबाएँ: roll tick करें ("Roll label, material or job"), ज़रूरत हो तो bulk जोड़ें, "HSN code", "Purpose on the challan", "Vehicle number" भरें, फिर "Issue challan"। Print करें; गाड़ी निकलते समय gate QR scan करता है।
2. 2. माल लौटे तो "Receive" दबाएँ: "Received on", job worker का challan नंबर और तारीख़ भरें।
3. 3. "Sent material" में हर roll को "Used up", "Came back unused" या "Partly used" (बचा kg भरें) करें, या "Mark all used up"।
4. 4. "What came back" में finished pieces (pieces, boxes / bags, weight, store at, inner packs), output roll या bulk, और wastage भरें।
5. 5. "Material balance" देखें: settled = output + balance back + wastage, tolerance के अंदर; नहीं तो "Why does the balance not match?" भरें। बिल साथ खुला हो तो billed quantity / rate भरें; उसी save में जुड़ता है। "Save return" दबाएँ।
6. 6. आंशिक माल आया और production शुरू करना है: "Continue production with what's back" से route step अभी पूरा होता है; बाद की वापसी उसी step में जाती है। Job के आख़िरी step पर यह नहीं मिलता।
7. 7. कुछ बाकी न हो तो "Close" → "Close order"। कुछ कभी नहीं लौटेगा तो कारण देकर "Close short" → "Close short and write off"। कुछ न भेजा गया draft: "Cancel draft"।

**स्क्रीन पर क्या है**
- **At the job worker / Sent / Output / Balance back / Wastage / Unexplained / Written off**: Order का kg में माल हिसाब।
- **Challans**: हर भेजने पर QR वाला job-work delivery challan (GST Rule 45) बनता है; watchman के scan तक "Not scanned at gate" दिखता है।
- **Inner packs**: Order में inner pack हो तो "Packed in our inner packs" या "Packed in the job worker's own inner packs" चुनें। हमारे pack हों तो घर के (in-house) inner pouch अभी stock से कटते हैं, जैसे मशीन के आखिरी pouching step पर, और खरीदे हुए शाम की packing गिनती से बुक होते हैं। Job worker के अपने pack हों तो हमारे stock से कुछ नहीं कटता।
- **Bill complete**: इस बिल पर आगे कुछ नहीं आएगा तो tick करें।
- **Timeline**: हर send, return, link, release और close — किसने, कब।

**आम दिक्कतें और हल**
- "Material balance is off by … kg (…%). Explain the difference to close." — भेजा ≠ output + balance + wastage, tolerance से ज़्यादा। वज़न फिर जाँचें या कारण लिखें।
- "Enter the HSN code for …" — हर challan लाइन पर HSN code छपता है (जैसे 3920 plastic film)।
- "…: the balance roll must weigh more than 0 and less than … kg." — "Partly used" में भेजे वज़न से कम balance भरें; पूरा roll लौटा हो तो "Came back unused"।
- "Finished pieces can only be received against a production job. Link the job." — FG batch job का होता है; roll/bulk में लें या job जोड़ें।
- "Explain why the order is closed short (at least 5 characters)." — साफ़ कारण लिखें।
- "This is the job's last route step. Finished pieces can be packed and dispatched as they come back; close the order when everything is back." — आख़िरी step पर Continue production की ज़रूरत नहीं।
- "This bill is from another vendor." — बिल वाले job worker का order खोलें।

**अटक गए तो**
1. Save time out हो तो वही बटन ("Retry save") फिर दबाएँ; दो बार दर्ज नहीं होता।
2. Close करने से step की ink, adhesive या pack factory stock से नहीं कटते: job worker का माल vendor-supplied दर्ज होता है।

जुड़े पेज: /inventory/job-work, /inventory/gate-bills, /logistics/packing, /inventory/traceability

### Inventory / Ledger (stock बही) (/inventory/ledger)
स्क्रीन का पता: /inventory/ledger · भूमिकाएँ: ADMIN, OWNER, STORE, PLANNER, PLANT_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=inventory-ledger&lang=hi

Bulk लेन-देन और roll movement की ताज़ा मिली-जुली सूची: समय, operation, item / batch, location, मात्रा और reference।

किसी भी तरह के हाल के stock movement को जल्दी देखने के लिए। किसी item का पूरा हिसाब opening-closing के साथ Count and close → Month end के stock card में देखें; एक roll के लिए Roll genealogy।

**शुरू करने से पहले**
- Inventory view अधिकार।

**स्टेप बाय स्टेप**
1. 1. Operation चुनें: "All Operations", "Inward (GRN)", "Outward (Dispatch)", "Receive", "Consumption" या "Transfer"।
2. 2. "Search ledger..." में material, reference या roll label लिखें।
3. 3. "Total Transactions", "Inward Flow", "Outward Flow" tile देखें।
4. 4. "Transaction Log" में पन्ने बदलें (हर पन्ने पर 50 लाइन)।

**स्क्रीन पर क्या है**
- **Operation**: GRN (inward), DISPATCH, RECEIVE, CONSUMPTION, TRANSFER, ADJUST।
- **Quantity**: GRN और Receive पर +, बाकी सब पर − दिखता है।
- **Reference**: जिस GRN, challan, job या adjustment से लाइन बनी।

**आम दिक्कतें और हल**
- "No matching records" — Search या filter से सब छिप गया, या लाइन लोड हुई ताज़ा लाइनों से पुरानी है। Search हटाएँ या stock card देखें।

**अटक गए तो**
1. पुराने हिसाब या सही balance के लिए Count and close → Month end → stock card drill खोलें।

जुड़े पेज: /inventory/stock-lifecycle, /inventory/movements, /inventory/traceability, /inventory/grn-history

**अभी नहीं होता / ध्यान दें**
- "30-Day History" बटन कुछ नहीं करता।
- Ledger सिर्फ़ ताज़ा 500 bulk लेन-देन और 500 roll move लाता है, तारीख़ filter नहीं, और operation filter में ADJUST नहीं।
- GRN और Receive छोड़कर हर type पर minus दिखता है, इसलिए बढ़ाने वाला adjustment या transfer-in भी बाहर जाता दिखता है।

### Roll Movements (roll की आवाजाही) (/inventory/movements)
स्क्रीन का पता: /inventory/movements · भूमिकाएँ: ADMIN, OWNER, STORE, PLANNER, WORK_CENTER_MANAGER, PLANT_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=inventory-movements&lang=hi

Roll का एक location से दूसरी location तक हर असली move — GRN, production, WIP transfer, inter-plant, job work और dispatch — कारण, job और किसने किया, के साथ।

बहुत से roll के लिए "यह roll कहाँ गया और क्यों" देखने के लिए। यह पेज सिर्फ़ दिखाता है; move GRN, terminal, inter-plant challan, job work और dispatch से होते हैं।

**शुरू करने से पहले**
- Inventory view अधिकार।

**स्टेप बाय स्टेप**
1. 1. "Search roll, move reason, location, or job" में लिखें।
2. 2. Tile देखें: "Visible moves", "Production moves", "Dispatch moves", "Route spread"।
3. 3. "Movement mix" में सबसे आम कारण; "Recent movement cards" में ताज़ा move।
4. 4. "Movement ledger" की हर लाइन देखें: roll, from → to (नए roll पर NEW), reason, job, समय, किसने।
5. 5. दोबारा लोड करने के लिए "Refresh"।

**स्क्रीन पर क्या है**
- **Reason**: Roll क्यों हिला, जैसे GRN, PRODUCTION, DISPATCH, inter-plant, job work।
- **Route spread**: Move में दिखे plant की गिनती और आख़िरी move का समय।

**आम दिक्कतें और हल**
- "No movements found for the current filter." — Search हटाएँ। फिर भी खाली रहे तो list लोड नहीं हुई होगी; Refresh दबाएँ।

**अटक गए तो**
1. एक roll की पूरी कहानी के लिए Roll genealogy।

जुड़े पेज: /inventory/traceability, /inventory/rolls, /inventory/inter-plant, /inventory/ledger

**अभी नहीं होता / ध्यान दें**
- Movement list लोड न हो तो पेज बिना error के "No movements found" दिखाता है; free search के अलावा तारीख़ या कारण filter नहीं।

### Outward documents (बाहर गए काग़ज़) (/inventory/outward-documents)
स्क्रीन का पता: /inventory/outward-documents · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, STORE · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=inventory-outward-documents&lang=hi

माल gate से निकलते समय watchman ने जो काग़ज़ फोटो किए, उन्हें ERP के challan, invoice या gate pass से मिलाने के लिए।

हर गाड़ी के निकलने को उसके ERP document से मिलाना। QR वाले ERP काग़ज़ अपने आप match होते हैं; बाकी "Pending match" में पुराने पहले। Match करने से stock नहीं हिलता और delivery नहीं होती।

**शुरू करने से पहले**
- "Match outward gate photos" अधिकार (default में Inventory, Admin, Owner)।
- Watchman ने gate terminal पर departure दर्ज किया हो।

**स्टेप बाय स्टेप**
1. 1. Tab चुनें: "Pending match", "Discrepancy", "Matched" या "All"।
2. 2. "Factory", "ERP link" (Has an ERP link / No ERP link yet), "Left from" / "Left to" से filter करें, या "Vehicle, DC / invoice no. or party" खोजें।
3. 3. Departure खोलकर document जोड़ें, matched करें या discrepancy लिखें।
4. 4. लंबी सूची में "Previous page" / "Next page" से चलें; पुराने पहले निपटाएँ।

**स्क्रीन पर क्या है**
- **No ERP document linked**: फोटो से अभी कोई link नहीं; खोलकर match करें।
- **Discrepancy**: फ़र्क दर्ज हुआ है, follow-up चाहिए।
- **All**: हर outward फोटो record, void वाले भी।

**आम दिक्कतें और हल**
- "Outward documents are for the inventory team" — आपके account में "Match outward gate photos" अधिकार नहीं; admin role matrix में दे सकता है। Watchman gate terminal पर departure दर्ज करते हैं।
- "Choose an ordered date range of 366 days or fewer." — Left from / Left to ठीक करें।

**अटक गए तो**
1. List पुरानी लगे तो "Updating…" खत्म होने दें या page reload करें।

जुड़े पेज: /inventory/outward-documents/[id], /inventory/gate-passes, /logistics/dispatch, /gate

### Outward departure match करें (/inventory/outward-documents/[id])
स्क्रीन का पता: /inventory/outward-documents/[id] · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, STORE · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=inventory-outward-documents-id&lang=hi

एक departure के gate फोटो और उसके बगल में matching panel: गाड़ी में गए ERP document जोड़ें, फिर matched करें या discrepancy लिखें।

पक्का करें कि इस गाड़ी में factory से क्या गया। एक गाड़ी में कई document हो सकते हैं। Match से stock नहीं हिलता और delivery नहीं होती।

**शुरू करने से पहले**
- "Match outward gate photos" अधिकार।

**स्टेप बाय स्टेप**
1. 1. फोटो देखें (zoom, rotate, pin, या दूसरी screen पर pop-out)।
2. 2. "Find the ERP document" में नंबर, party या गाड़ी से खोजें, चाहें तो "Document type" चुनें, और link करें।
3. 3. या "Link by QR code": desk scanner से scan करें या QR text paste करें।
4. 4. ERP में न हो ऐसा काग़ज़ (supplier return note, courier रसीद): "Paper not in the ERP" → नंबर, party, क्या है → "Add paper"।
5. 5. "Mark matched" दबाएँ, या फ़र्क लिखकर "Save discrepancy"।
6. 6. गलत link: कारण देकर "Remove"। Owner/Admin: duplicate या गलत फोटो के लिए "Void record"।

**स्क्रीन पर क्या है**
- **Documents on this departure**: Office ने जो पक्का किया कि इस गाड़ी में गया।
- **Scanned at the gate**: Watchman के scan किए सभी code, न पहचाने गए भी।
- **History**: हर बदलाव — किसने, क्यों; हमेशा रहता है।

**आम दिक्कतें और हल**
- "Link at least one ERP document before marking the departure matched." — पहले document link करें या paper जोड़ें।
- "This document is already linked to the departure." — यह पहले से सूची में है।
- "This outward record is voided. Refresh the queue." — किसी ने void किया; queue पर लौटें।
- "This document belongs to another factory. It cannot be matched at this gate." — जिस factory से गाड़ी निकली उसी का document चुनें।
- "Linked. The same document also left on …" — कई trip में जाने वाला challan सिर्फ़ flag होता है, रुकता नहीं।

**अटक गए तो**
1. "This outward record is not available": queue से फिर खोलें।
2. Link हटाने पर सिर्फ़ इसी record पर गया gate pass फिर 'issued' हो जाता है।

जुड़े पेज: /inventory/outward-documents, /inventory/outward-documents/[id]/view, /inventory/gate-passes, /logistics/dispatch

**अभी नहीं होता / ध्यान दें**
- Outward record match करने से slip delivered नहीं होती; proof of delivery Dispatch Bay में अलग कदम है।

### Outward फोटो (pop-out) (/inventory/outward-documents/[id]/view)
स्क्रीन का पता: /inventory/outward-documents/[id]/view · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, STORE · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=inventory-outward-documents-id-view&lang=hi

एक departure के outward फोटो अलग window में, दूसरी screen के लिए।

Matching screen पर photo viewer के pop-out mode से खुलता है। Page, zoom, rotation और pin matching screen के साथ चलते हैं, ताकि काग़ज़ बड़ा पढ़ते हुए मुख्य screen पर document जोड़ सकें।

**शुरू करने से पहले**
- "Match outward gate photos" अधिकार।

**स्टेप बाय स्टेप**
1. 1. Matching screen पर viewer को pop-out करें।
2. 2. नई window दूसरी screen पर ले जाएँ।
3. 3. मुख्य screen पर matching करते रहें; pop-out साथ चलता है।
4. 4. Departure match होने पर pop-out window बंद करें।

**आम दिक्कतें और हल**
- "You cannot open these photos" — Admin से "Match outward gate photos" अधिकार माँगें।
- "This link is not valid" — Outward documents queue से फोटो फिर खोलें।

**अटक गए तो**
1. Pop-out बंद करके matching screen से फिर खोलें।

जुड़े पेज: /inventory/outward-documents/[id], /inventory/outward-documents

### Packaging materials (packing का सामान) (/inventory/packaging)
स्क्रीन का पता: /inventory/packaging · भूमिकाएँ: ADMIN, OWNER, STORE, PLANNER, WORK_CENTER_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=inventory-packaging&lang=hi

Inner pouch, gonny, carton, tape, sheet, label, tag और POD sleeve का stock — kind, plant और location के हिसाब से, health, sales-order hold और आज के evening count के आँकड़ों के साथ।

देखें कि packing का कितना सामान है और क्या मँगाना है। नियम याद रखें: घर के (in-house) inner pouch मशीन के आखिरी pouching step पर output दर्ज होते ही stock से कटते हैं; खरीदे हुए inner pouch और बाकी हर item evening packing count से कटते हैं (बाकी item release पर tick होते हैं; inner pouch कभी नहीं)। Packing का सामान Smart GRN से लें।

**शुरू करने से पहले**
- Packaging master (kind, pcs / pack, UOM, reorder point)।

**स्टेप बाय स्टेप**
1. 1. Kind (Inner pouch, Gunny, Carton / box, Tape, Sheet, Label, Tag, POD sleeve, Other), plant, location, supply mode (Purchased, In-house, Both) और health से filter करें।
2. 2. Tile देखें: SKU rows, total pieces, available, low stock, stock-outs।
3. 3. लाइन खोलें ("View") — specs और "SO holds" (active reservation)।
4. 4. आज का "EOD packing count" बॉक्स देखें; evening count के लिए "Open EOD count" दबाएँ।
5. 5. Smart GRN खोलने के लिए "Receive packaging"।

**स्क्रीन पर क्या है**
- **Health**: 0 पर Empty; reorder point से कम पर Low; बाकी Healthy (reorder point न हो तो 50)।
- **Reserved**: Sales order के लिए रोके गए pieces।
- **Consumed today / Mapped orders**: आज evening count ने कितना काटा और कितने order पर।
- **Unassigned count short**: Count की कमी जो किसी order पर नहीं बँटी; 0 रहनी चाहिए।

**आम दिक्कतें और हल**
- "Could not load packaging." — Refresh करें; बार-बार हो तो admin को बताएँ।
- "No packaging items match these filters" — Filter या search हटाएँ।

**अटक गए तो**
1. Packing के बाद stock गलत लगे? Adjust से पहले Packing audit में evening count देखें।

जुड़े पेज: /inventory/grn, /logistics/packing/consumption, /logistics/packing/audit, /inventory/stock-lifecycle, /logistics/packing

**अभी नहीं होता / ध्यान दें**
- EOD बॉक्स में लिखा है कि gunny sealed count से कटता है, जबकि अभी का नियम है कि gonny release पर सिर्फ़ tick होता है और evening count से कटता है।
- यहाँ "Gunny" लिखा है और Packing Yard में "gonny"।

### Period (Year end खोलता है) (/inventory/period)
स्क्रीन का पता: /inventory/period · भूमिकाएँ: ADMIN, OWNER, STORE, PLANNER, PLANT_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=inventory-period&lang=hi

यह पुराना पता Count and close का Year end tab खोलता है (/inventory/stock-lifecycle?tab=close)।

Period close अब Count and close में है ताकि count, month end और year end एक साथ रहें। Stock menu का "Period" लिंक वहीं भेजता है।

**शुरू करने से पहले**
- Stock lifecycle अधिकार।

**स्टेप बाय स्टेप**
1. 1. Stock menu से "Period" खोलें।
2. 2. Year end पर पहुँचेंगे: blockers हटाएँ, फिर "Close Financial Year"।
3. 3. Month snapshot और stock card Month end tab पर हैं।
4. 4. अपना bookmark /inventory/stock-lifecycle?tab=close पर बदल लें।

**अटक गए तो**
1. सीधे Count and close के tab इस्तेमाल करें।

जुड़े पेज: /inventory/stock-lifecycle

**अभी नहीं होता / ध्यान दें**
- Stock menu में अभी भी "Period" है जबकि यह सिर्फ़ Count and close का Year end tab खोलता है।

### Roll workspace (roll का बोर्ड) (/inventory/rolls)
स्क्रीन का पता: /inventory/rolls · भूमिकाएँ: ADMIN, OWNER, STORE, PLANNER, WORK_CENTER_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=inventory-rolls&lang=hi

सभी roll पहले film और width के हिसाब से: film board, variant × thickness matrix, table और card; हर roll को family, status, role, form, plant, location, उम्र और size से filter करें।

Store का मुख्य पेज। सही film और width का खाली roll ढूँढें, देखें कौन reserved है या machine पर है, पुराना stock पहचानें, और roll का detail, lineage या stock card खोलें। यहाँ roll बदलता नहीं: वज़न, status और location सिर्फ़ GRN, production, dispatch, job work, move और adjustment से बदलते हैं।

**शुरू करने से पहले**
- Roll Smart GRN, opening stock या production से आए हों।

**स्टेप बाय स्टेप**
1. 1. View चुनें: films (default), matrix, table या cards।
2. 2. बाएँ rail में filter: variant / film code, status (Available, Reserved, In process, Consumed, Quarantine), role (Base / new, Output, Remainder, Split output, Finished), stock form, plant, location, उम्र (≤30 d, 31–90, 90+ d) और size।
3. 3. Film board पर हर roll का घेरा Free, Reserved, On machine या Away रंग में; detail के लिए roll पर tap करें।
4. 4. Matrix में cell पर tap करके उस variant और thickness के roll देखें।
5. 5. "Roll detail" में "Trace lineage" (Roll genealogy) या "Stock card"; label 4 × 2 inch में फिर print हो सकता है।
6. 6. "Receive rolls" Smart GRN खोलता है; quick action "Trace" और "Move →" (inter-plant)।

**स्क्रीन पर क्या है**
- **On hand KG / Available / Reserved**: कुल roll वज़न, खाली वज़न और job के लिए reserved वज़न।
- **Aged 90+**: 90 दिन से पुराने roll; पहले इन्हें इस्तेमाल करें।
- **Open web / Tubes / Folded**: Stock form के हिसाब से roll गिनती।
- **Remainders**: Slitting या आंशिक उपयोग के बाद लौटे parent roll के बचे हिस्से।
- **Reservation %**: कुल kg का कितना हिस्सा पहले से reserved।
- **Reserved for**: Roll किस job के लिए रुका है (Roll detail में)।

**आम दिक्कतें और हल**
- "Could not load roll inventory." — Refresh करें; बार-बार हो तो admin को बताएँ।
- "No rolls match these filters." — Chip या search हटाएँ।

**अटक गए तो**
1. Floor पर दिखता roll यहाँ नहीं: Roll genealogy में supplier नंबर खोजें, फिर Count and close → Stock count में गिनें।

जुड़े पेज: /inventory/grn, /inventory/traceability, /inventory/inter-plant, /inventory/stock-conversions, /inventory/movements, /inventory/stock-lifecycle

**अभी नहीं होता / ध्यान दें**
- Quick action "Move →" Inter-plant खोलता है; इस पेज पर उसी plant में location बदलने का तरीका नहीं।

### Stock conversion (roll का रूप बदलना) (/inventory/stock-conversions)
स्क्रीन का पता: /inventory/stock-conversions · भूमिकाएँ: ADMIN, OWNER, STORE, PLANNER, WORK_CENTER_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=inventory-stock-conversions&lang=hi

Route के बिना roll का रूप बदलें: open-web jumbo slit करें, tube खोलकर एक या दो sheet बनाएँ, web fold या unfold करें। वज़न और genealogy बने रहते हैं।

जब store को job के लिए roll तैयार करना हो, जैसे side-seal job के लिए tube खोलना या WC terminal की सही width के लिए jumbo slit करना। Parent खत्म होता है और children (और बचा हिस्सा) नए roll बनते हैं।

**शुरू करने से पहले**
- Parent roll AVAILABLE हो।
- Inventory या production अधिकार।

**स्टेप बाय स्टेप**
1. 1. Operation चुनें: "Slit open-web jumbo", "Open tube to one sheet", "Open tube to two sheets", "Fold open web" या "Unfold to open web"।
2. 2. "Pick parent roll" में roll, material, grade या location खोजें; सिर्फ़ मेल खाते roll मिलते हैं।
3. 3. Slitting में "Child widths (mm)" जैसे 500, 500, 300 और "Trim per child" भरें।
4. 4. Preview देखें: हर output का form, width, वज़न और remainder।
5. 5. "Reason / operator note" लिखें और "Post conversion" दबाएँ।

**स्क्रीन पर क्या है**
- **Open tube to one sheet**: Lay-flat width से दोगुनी एक sheet, वही वज़न।
- **Open tube to two sheets**: Lay-flat width की दो sheet, हर एक आधा वज़न।
- **Fold / Unfold**: Fold से width आधी; unfold से दोगुनी; वज़न वही।
- **Child widths / Trim per child**: वज़न width के हिसाब से बँटता है। Children + trim parent width से ज़्यादा न हो; बची width Remainder roll बनती है; trim scrap है।

**आम दिक्कतें और हल**
- "Only available rolls can be converted." — Roll का reservation हटाएँ या दूसरा लें।
- "Requested child widths plus trim exceed parent width." — Child width या trim घटाएँ।
- "Width slitting requires open-web stock. Use tube-opening for tube stock." — पहले tube खोलें, फिर slit करें।
- "Open tube to one sheet requires lay-flat tube stock." — Lay-flat tube roll चुनें।
- "Unfold requires folded-web stock." — Folded-web roll चुनें।

**अटक गए तो**
1. गलत conversion यहाँ वापस नहीं होता; children गिनकर Count and close या adjustment से सुधारें।

जुड़े पेज: /inventory/rolls, /inventory/traceability, /production/work-center

**अभी नहीं होता / ध्यान दें**
- Post हुआ conversion इस पेज पर वापस नहीं होता; पुराने conversion की सूची यहाँ नहीं।

### Count and close (गिनती और बंदी) (/inventory/stock-lifecycle)
स्क्रीन का पता: /inventory/stock-lifecycle · भूमिकाएँ: ADMIN, OWNER, STORE, PLANNER, PLANT_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=inventory-stock-lifecycle&lang=hi

एक plant और financial year के लिए opening stock, किसी भी दिन की stock count, evening packing count, month end और year end।

Stock cycle का सारा काम एक जगह। बाएँ से दाएँ चलें: Overview, Opening stock, Stock count, Month end, Year end। बंद financial year नहीं बदलता; adjustment सिर्फ़ खुले साल में।

**शुरू करने से पहले**
- ऊपर plant और financial year चुना हो; count और close से पहले साल "Open FY" से खुला हो।
- Plant में active location।
- Inventory audit या manage अधिकार।

**स्टेप बाय स्टेप**
1. 1. Overview: class के हिसाब से stock value, ageing (0-30, 31-90, 90+ दिन), valuation trend, opening → in → consumed → dispatch → adjust → closing, top movers, dead stock।
2. 2. Opening stock: मात्रा भरें, rows paste करें ("Apply paste") या CSV/XLSX upload (validate, फिर "Post file"); roll एक-एक असली roll भरें; "Post Opening Stock" (या "Post Cutover Stock") दबाएँ।
3. 3. Stock count → "Stock count · any day, month end or period": scope (All, Bulk, Rolls, Packing), location, roll form या granule code और count mode (soft freeze, hard freeze, spot count) चुनें; गिनी मात्रा भरें; 2% या ज़्यादा फ़र्क पर कारण दें; "Post physical count" दबाएँ।
4. 4. Stock count → "Evening packing count": location और तारीख़ चुनें। लाइनें पहले से book मात्रा से भरी आती हैं; सिर्फ़ उन items की गिनती बदलें जो अलग निकलें (book पर छोड़ी लाइन से stock नहीं बदलता), नोट लिखें, "Post count" दबाएँ। यह बिना approval तुरंत post होता है। फ़र्क उस दिन item tick करने वाले order पर चढ़ता है, वरना उस दिन के उन orders पर जिनके packing plan में वह item है।
5. 5. Count history: sheet खोलकर draft को Validate, Submit, Approve और Post करें, या Cancel; किसी तारीख़ का evening packing proof और ink floor proof भी यहीं।
6. 6. Month end: monthly close tracker में महीने lock करें, month-end snapshot लें, "View month proof", और किसी material का stock card source document तक खोलें।
7. 7. Year end: "Annual close blockers" हटाएँ, "Close Financial Year" दबाएँ और "Close FY" पक्का करें। साल lock होता है, अगले साल की opening बनती है और साल के पूरे हुए record archive में जाते हैं (header में साल चुनकर देखें)।

**स्क्रीन पर क्या है**
- **Counts waiting**: अधूरी draft / submitted sheet; Stock count tab पर दिखती हैं।
- **Count mode**: Soft freeze · जाँची हुई आवाजाही चलती है; Hard freeze · post तक कोई आवाजाही नहीं; Spot count · सिर्फ़ चुनी लाइनें।
- **System / Counted / Variance % / Reason**: सिर्फ़ भरी लाइनें post होती हैं। कारण: Book vs physical, Found / misplaced, Damage / scrap, Data entry, Other।
- **Book / Closing qty / Delta (packing count)**: Delta = closing − book: minus हो तो उस दिन के order पर खपत (पूरे pieces में) बँटती है, plus हो तो count excess।
- **Same-day allocation pool**: जिन order ने count की तारीख़ पर pack किया या item tick किए।
- **Annual close blockers**: Negative bulk stock, खुले inter-plant challan, खुले job-work order, unresolved critical alert, draft audit sheet।
- **Monthly snapshot**: सिर्फ़ report का proof; साल lock नहीं करता।

**आम दिक्कतें और हल**
- "Row … has …% variance; a reason code and note are required." — 2% या ज़्यादा फ़र्क पर कारण ज़रूरी।
- "Select a location for … before posting the count." — उस लाइन में location चुनें।
- "Enter counted quantity for at least one row. Physical count posts only rows you enter." — कम से कम एक गिनती भरें।
- "Maker and checker must be different users." — आपकी submit की sheet कोई दूसरा approve करे; अपनी sheet सिर्फ़ owner खुद approve कर सकता है।
- "E-OS-05: opening blocked because … movement(s) already exist for this material/location in …" — इस साल stock पहले ही हिल चुका है; opening की जगह stock count करें।
- "Open this financial year before closing it." — पहले "Open FY" दबाएँ।
- "Close … before starting another open period." — एक समय में एक ही साल खुला रहता है।
- "Close blocked" — कोई blocker बाकी है; उसके पेज से ठीक करें (challan receive, job work close, draft पूरा)।
- "FY correction can only be created for a closed financial year. Use Stock Count for an open year." — साल खुला हो तो Stock count करें।

**अटक गए तो**
1. "Select a plant…" संदेश: पहले ऊपर plant चुनें।
2. Close रोकने वाली draft sheet: Count history में खोलकर Post या Cancel करें।
3. गलत packing count: दूसरी count से पहले Packing audit → Evening counts देखें।

जुड़े पेज: /inventory/period, /logistics/packing/consumption, /logistics/packing/audit, /production/ink-control, /inventory/inter-plant, /inventory/job-work, /inventory/alerts, /inventory/count

**अभी नहीं होता / ध्यान दें**
- "Post physical count" count sheet एक ही बार में बनाकर post कर देता है, इसलिए Submit → Approve (maker-checker) सिर्फ़ Count history में छोड़ी draft sheet पर लागू होता है।
- Opening stock का draft सिर्फ़ इसी browser में save होता है (Save draft / Load draft), server पर नहीं।

### Roll Genealogy (roll की वंशावली) (/inventory/traceability)
स्क्रीन का पता: /inventory/traceability · भूमिकाएँ: ADMIN, OWNER, STORE, PLANNER, WORK_CENTER_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=inventory-traceability&lang=hi

किसी भी roll की वंशावली, आवाजाही और अभी की stage: QR scan करें या ERP ID या supplier roll नंबर लिखें।

"यह roll कहाँ से आया और इसका क्या हुआ" का जवाब: parent-child पेड़, हर movement और consumption, और हाल के असली move। Customer complaint, quality hold और गुम roll के लिए।

**शुरू करने से पहले**
- Inventory view अधिकार।

**स्टेप बाय स्टेप**
1. 1. QR scan करें या "Scan QR, or enter ERP ID / supplier roll number" में लिखकर Enter या "Trace Roll" दबाएँ।
2. 2. या "Select roll from latest 200" से चुनें।
3. 3. कई roll मिलें तो location और वज़न देखकर बटन से सही चुनें।
4. 4. Tile पढ़ें (Current Weight, Original Weight, Lineage Children, Timeline Events, Current Stage), फिर "Genealogy Tree", "Movement & Consumption Timeline" और "Recent Physical Movements"।
5. 5. ज़रूरत हो तो roll card से label फिर print करें।

**स्क्रीन पर क्या है**
- **Match**: Roll कैसे मिला: id, exact label या unique reference।
- **Genealogy Tree**: Slitting, split, lamination और conversion से बने parent और child।
- **Role / Status**: Base, output, remainder, split output या finished; available, reserved, in process, consumed, quarantine।

**आम दिक्कतें और हल**
- "More than one roll matches. Select the exact ERP ID after checking supplier reference and location." — Supplier नंबर कई roll पर है; दिखाए गए roll में से एक चुनें।
- "Roll not found for provided query" — नंबर जाँचें; roll पर लिखा ERP ID डालें।

**अटक गए तो**
1. Roll workspace से "Trace lineage" से सीधे roll खोलें।

जुड़े पेज: /inventory/rolls, /inventory/movements, /inventory/stock-conversions, /inventory/grn-history

**अभी नहीं होता / ध्यान दें**
- Roll picker में सिर्फ़ ताज़ा 200 roll हैं, और "Open Roll Explorer" Roll workspace की जगह /inventory?tab=rolls खोलता है।

### Vendor की सूची (Inventory) (/inventory/vendors)
स्क्रीन का पता: /inventory/vendors · भूमिकाएँ: ADMIN, OWNER, STORE, PLANT_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=inventory-vendors&lang=hi

Supplier, job worker और service provider की सूची — code, name, type, GST no., payment terms और address के साथ; vendor जोड़ें, बदलें या हटाएँ।

Smart GRN, purchase order और job work जिन vendor को चुनते हैं, उन्हें यहाँ रखें। Type से उपयोग तय होता है: Raw Material और Hybrid से GRN; Job Worker और Hybrid को job work।

**शुरू करने से पहले**
- Inventory या procurement अधिकार।

**स्टेप बाय स्टेप**
1. 1. Tile देखें: Total Partners, Material Suppliers, Job Workers, Service Providers।
2. 2. "Search partners..." में खोजें।
3. 3. "Onboard Entity" दबाएँ: Code, Name, Type, GST No, Payment Terms, Lead Time (Days), Address भरें; "Save Entity"।
4. 4. लाइन edit करके "Edit Vendor Profile" खोलें।
5. 5. सिर्फ़ गलती से बना vendor हटाएँ ("Revoke Partnership?" → "Delete Entity")।

**स्क्रीन पर क्या है**
- **Type**: Raw Material (RM), Job Worker (JOBWORK), Service Provider (SERVICE), Hybrid (BOTH)।
- **Code / Name**: दोनों ज़रूरी; code जैसे VEND-001।
- **GST No**: Challan पर छपता है और बिल जाँच में काम आता है।

**आम दिक्कतें और हल**
- "Code is required / Name is required" — Save से पहले दोनों भरें।
- "GRN vendor must be RM or BOTH type." — Type गलत हो तो Smart GRN पर आता है; यहाँ बदलें।

**अटक गए तो**
1. जो vendor अब माल नहीं देता उसे हटाने की जगह vendor master में inactive करें, ताकि पुराने record में नाम रहे।

जुड़े पेज: /master/vendors, /inventory/grn, /inventory/job-work, /procurement/purchase-orders

**अभी नहीं होता / ध्यान दें**
- Delete vendor को सीधे हटा देता है; vendor status (Active / Inactive), job-work process, plant और rate card सिर्फ़ Master data → Vendors में बदलते हैं।

### Location scan (लोकेशन स्कैन) (/loc/[code])
स्क्रीन का पता: /loc/[code] · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, STORE, PLANNER, WORK_CENTER_MANAGER, DISPATCH, PLANT_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=loc-code&lang=hi

QR स्टिकर से स्टॉक लोकेशन खोलता है: सिस्टम के अनुसार वहाँ क्या है (बल्क मटेरियल, मटेरियल के हिसाब से रोल, पैक यूनिट) और फ़ोन से गिनती जो अंतर पोस्ट करती है।

रैक या बे का स्टिकर स्कैन करके जाँचें या गिनें। पोस्ट की गई गिनती "count correction" कारण वाला स्टॉक एडजस्टमेंट बनती है।

**शुरू करने से पहले**
- लोकेशन का QR स्टिकर; आपके रोल को स्टॉक देखने की अनुमति हो (Store, Dispatch, Planner…)।

**स्टेप बाय स्टेप**
1. लोकेशन स्टिकर स्कैन करें; हेडर में कोड, नाम, प्लांट और प्रकार दिखेगा।
2. टाइल पढ़ें: "Rolls", "Bulk lines", "Packed units", "Differences"।
3. गिनती के लिए "Count stock · गिनती" दबाएँ।
4. "Bulk material" में हर लाइन की गिनी मात्रा लिखें।
5. "Rolls by material" में जो रोल यहाँ नहीं है उसे टिक करें।
6. ज़रूरत हो तो नोट लिखें और "Post count · दर्ज करें" दबाएँ।

**स्क्रीन पर क्या है**
- **Find material or roll**: इसी लोकेशन में खोजें।
- **Differences**: जहाँ आपकी गिनती सिस्टम से अलग है।
- **रोल टिक (यहाँ नहीं)**: सिर्फ़ AVAILABLE रोल टिक होते हैं; reserved या चल रहे रोल फ़ोन से नहीं हटाए जा सकते।

**आम दिक्कतें और हल**
- "No location matches code "…"." — स्टिकर दूसरी फ़ैक्टरी का है या बदल दिया गया। स्टोर से नया स्टिकर माँगें।
- "Could not post the count" — एडजस्टमेंट नहीं हुआ (अनुमति या पुराना स्टॉक)। संदेश पढ़ें, रिफ़्रेश करें और फिर गिनें।

**अटक गए तो**
1. पोस्ट की गई गिनती Stock adjustments में इस लोकेशन के साथ दिखती है।
2. बिना पोस्ट किए गिनती छोड़ने के लिए "Stop counting" दबाएँ।

जुड़े पेज: /inventory/adjustments, /factory/locations, /inventory/rolls

**अभी नहीं होता / ध्यान दें**
- Reserved या चल रहे रोल फ़ोन की गिनती से नहीं हटाए जा सकते।
