# What the system does not do yet / सिस्टम अभी क्या नहीं करता
Use this when a user asks why something is missing or not possible. Say so plainly and give the workaround if there is one.

## New order (/sales/orders/create)
- "Save as quotation" only opens a new quotation for the same customer; the lines typed in the composer are not carried into the quotation.
  - "Save as quotation" सिर्फ उसी ग्राहक के लिए नई quotation खोलता है; composer में भरी lines quotation में नहीं जातीं।
- Drafts are saved only in the browser's local storage, so a draft started on one PC cannot be resumed on another, and only one draft is kept at a time.
  - draft सिर्फ browser की local storage में save होता है, इसलिए एक PC पर शुरू draft दूसरे PC पर नहीं खुलता, और एक समय में एक ही draft रहता है।
- The composer shows credit days but does not warn or block when a customer is over its credit limit.
  - composer credit days दिखाता है पर credit limit पार होने पर न चेतावनी देता है न रोकता है।

## Sales order tracker (/sales/orders/[id])
- The order tracker has no edit, cancel or short-close button; cancel is only on the Sales Orders list (before release) and short-close only in the Planner.
  - order tracker पर edit, cancel या short-close का button नहीं है; cancel सिर्फ Sales Orders list में (release से पहले) और short-close सिर्फ Planner में है।
- A placed order's lines, rates or dates cannot be edited from Sales; there is no amend-order screen.
  - डाले गए order की lines, rate या तारीख Sales से नहीं बदल सकते; order बदलने का कोई screen नहीं है।

## Customer dispatches (/sales/orders/[id]/dispatches)
- The ledger shows Cancel only for DRAFT dispatches, although the server also allows cancelling a CONFIRMED dispatch, and there is no "mark dispatched" button even though the server supports it.
  - ledger में Cancel सिर्फ DRAFT dispatch पर दिखता है जबकि server CONFIRMED dispatch भी cancel होने देता है, और server में सुविधा होते हुए भी "mark dispatched" button नहीं है।
- Customer dispatch records here are separate from Dispatch Bay slips; slips made in Dispatch Bay may not appear in this ledger, which can confuse users looking for what was shipped.
  - यहाँ के customer dispatch records Dispatch Bay की slips से अलग हैं; Dispatch Bay में बनी slips इस ledger में शायद न दिखें, जिससे भेजे गए माल को ढूँढने में भ्रम हो सकता है।

## New dispatch (/sales/orders/[id]/dispatches/new)
- This form does not offer the "Send goods of closed lines" confirmation or the closed-line handling that Dispatch Bay has.
  - इस form में Dispatch Bay वाली "Send goods of closed lines" पुष्टि या बंद line की सुविधा नहीं है।

## Sales Orders (/sales/orders)
- Saved views are stored per browser, not per user account, so they do not follow a user to another PC.
  - saved views browser में रहते हैं, user account में नहीं, इसलिए दूसरे PC पर नहीं मिलते।
- The list loads only the newest open orders; older ones are reached only by searching.
  - list में सिर्फ नए खुले orders लोड होते हैं; पुराने orders सिर्फ search से मिलते हैं।

## Customers (/sales/customers)
- The customer form has no separate shipping-address field; the composer falls back to the billing address, and extra addresses are not offered as ship-to choices in the composer.
  - customer form में अलग shipping पते का खाना नहीं है; composer billing पता लेता है, और अतिरिक्त पते composer में ship-to विकल्प के रूप में नहीं आते।
- The page uses unusual labels ("Legal Entity Name", "Commit Master Data", "Execute Purge") and the delete wording does not say whether a customer with orders can be removed.
  - page पर अजीब labels हैं ("Legal Entity Name", "Commit Master Data", "Execute Purge") और delete के संदेश में नहीं बताया कि orders वाला ग्राहक हट सकता है या नहीं।

## Quotation workspace (/sales/quotations/[id])
- The customer panel shows Outstanding as "AR not yet wired", so receivables are not visible while quoting.
  - customer panel में Outstanding "AR not yet wired" दिखाता है, इसलिए quote बनाते समय बकाया नहीं दिखता।

## Job names (/sales/job-names)
- Job names are grouped exactly as typed, so spelling differences create separate rows; there is no way to rename or merge them.
  - job names जैसे लिखे वैसे ही समूह बनते हैं, इसलिए spelling फर्क से अलग rows बनती हैं; नाम बदलने या जोड़ने का तरीका नहीं है।

## Trade order (/sales/trade-orders/[id])
- There is no button to move a dispatched trade order to Invoiced, although the list filters by Invoiced.
  - dispatched trade order को Invoiced करने का button नहीं है, जबकि list में Invoiced filter है।

## Sales Command Center (/dashboard/sales)
- The sidebar hides "Sales Dashboard" for the SALES role even though it is that role's landing page; it is reachable from the Orders workspace tab.
  - SALES role के sidebar में "Sales Dashboard" छिपा है, जबकि वही उनका पहला पेज है; यह Orders workspace tab से खुलता है।

## Total Logistics Hub (/dashboard/logistics)
- The Logistics hub has no sidebar entry of its own; the Dispatch Bay tab is highlighted when it is open.
  - Logistics hub का sidebar में अपना entry नहीं; खुलने पर Dispatch Bay tab चमकता है।

## Engineering Hub (/dashboard/engineering)
- "New Artwork" and "New Cylinder" only open the Artworks and Cylinders lists; they do not open a create form.
  - "New Artwork" और "New Cylinder" सिर्फ़ Artworks और Cylinders सूची खोलते हैं; बनाने का form नहीं खोलते।
- The Engineering Hub has no sidebar entry; it is reached only by address or the Products workspace.
  - Engineering Hub का sidebar entry नहीं; सिर्फ़ पते से या Products workspace से खुलता है।

## Launch stock from any Product Master (/dashboard/planner/control-tower/stock-launcher)
- There is no quotation exit on the stock launcher; a price request on the same spec must be made on the Quotations page.
  - stock launcher में quotation का रास्ता नहीं; उसी spec का भाव Quotations पेज पर बनाना होता है।
- Matching demand counts can show as not computed for a validation; the order still creates.
  - validation में matching demand की गिनती "not computed" दिख सकती है; order फिर भी बनता है।

## Live Production (/dashboard/planner/control-tower/live-production)
- Short close and cancel here work only for sales lines; stock orders must use their own lifecycle action.
  - यहाँ short close और cancel सिर्फ़ sales line के लिए हैं; stock order का अपना lifecycle action है।

## Material readiness (/dashboard/planner/control-tower/stock-intelligence)
- Quick launch does not work for templates without a full geometry and layer snapshot; the full launcher must be used.
  - पूरे geometry और layer snapshot के बिना template पर quick launch नहीं चलता; पूरा launcher चाहिए।
- Stock launched from here bypasses the release and artwork gates, unlike sales lines in Plan Queue.
  - यहाँ से launch हुआ stock release और artwork gate नहीं देखता, Plan Queue की sales line के उलट।

## Combine Orders (/dashboard/planner/control-tower/gang-builder)
- Combining only plans the jumbo; nothing is slit until the WC terminal does it, and a combine cannot be undone from this page.
  - Combine सिर्फ़ jumbo plan करता है; slitting WC terminal पर होती है, और इस पेज से combine वापस नहीं होता।

## Planner Control Tower (redirect) (/dashboard/planner/control-tower)
- Keys 1–7 change tab whenever the cursor is outside a field, which can surprise users who type numbers by mistake.
  - cursor field के बाहर हो तो 1–7 key tab बदल देती हैं, गलती से नंबर दबाने पर tab बदल सकता है।

## Work Center Command Deck (/dashboard/work-center)
- The Command Deck only shows and links; jobs, rolls and machine assignment are handled in the WC terminal.
  - Command Deck सिर्फ़ दिखाता और link देता है; job, roll और machine assignment WC terminal में होते हैं।

## Owner dashboard (/dashboard/owner)
- Profit panels stay empty until costing is posted for dispatched orders.
  - dispatch हुए order की costing post होने तक profit पैनल खाली रहते हैं।

## Completed Trace (/dashboard/planner/control-tower/completed-trace)
- Export CSV downloads only the filtered window, not the full history.
  - Export CSV सिर्फ़ छँटा हुआ समय download करता है, पूरा इतिहास नहीं।

## Production (opens Planner Control Tower) (/production)
- The Floor workspace tab "Jobs" points to /production, which only redirects to the Control Tower Command tab, so there is no list of production jobs behind it.
  - Floor workspace का "Jobs" टैब /production पर जाता है, जो केवल Control Tower Command पर भेजता है, इसलिए वहाँ jobs की कोई सूची नहीं है।

## Choose your machine (/production/machine-selector)
- The server returns only ACTIVE machines, so the "Active" filter changes nothing and machines that are DOWN are not shown at all.
  - सर्वर केवल ACTIVE machines भेजता है, इसलिए "Active" फ़िल्टर से कुछ नहीं बदलता और DOWN machines बिल्कुल नहीं दिखतीं।
- Planners and plant managers see only machines of work centres assigned to them; with none assigned they get "No Machines Assigned" even though the floor screens are open to them.
  - Planner और plant manager को केवल उन्हें दिए work centres की machines दिखती हैं; कोई न दिया हो तो फ्लोर स्क्रीन खुली होने पर भी "No Machines Assigned" आता है।

## Choose your machine group (WC terminal) (/production/work-center)
- When no work centre is assigned the page shows "No work center matched the current search query." instead of saying that none is assigned.
  - कोई work centre न दिया हो तो पेज यह नहीं बताता, बल्कि "No work center matched the current search query." दिखाता है।

## Production Planning Board (/production/planning)
- The "Cancel Job" menu item has no action; it does nothing when pressed.
  - "Cancel Job" मेनू आइटम पर कोई काम नहीं जुड़ा; दबाने पर कुछ नहीं होता।
- "Detour to Job Work" sends no reason, so the server always refuses it with "Emergency reason is required for EMERGENCY jobwork."
  - "Detour to Job Work" कोई कारण नहीं भेजता, इसलिए सर्वर हमेशा "Emergency reason is required for EMERGENCY jobwork." से मना करता है।
- Tab badges count only the jobs loaded for the open tab and page; other tabs show 0 until opened.
  - टैब के बैज केवल खुले टैब और पन्ने के jobs गिनते हैं; बाकी टैब खोलने तक 0 दिखाते हैं।
- "Hold" flips a hold flag without asking a reason; the job stays under Released and the button still reads "Hold", so there is no visible unhold.
  - "Hold" बिना कारण पूछे hold का निशान बदलता है; job Released में ही रहता है और बटन "Hold" ही दिखाता है, इसलिए unhold दिखाई नहीं देता।

## Factory Heatmap / Capacity (/production/planner/heatmap)
- Utilisation is running jobs divided by machines, not hours or queued load, so a work centre with a long queue but nothing running shows 0%.
  - Utilisation चल रहे jobs ÷ machines है, घंटे या कतार नहीं, इसलिए लंबी कतार पर भी कुछ न चले तो 0% दिखता है।
- Tiles show "WC-" plus the long internal id instead of the work centre code, the tooltip "Role" always reads "Work center", and the page is not in any menu.
  - टाइल पर work centre कोड की जगह "WC-" और लंबा अंदरूनी id दिखता है, tooltip का "Role" हमेशा "Work center" होता है, और पेज किसी मेनू में नहीं है।
- "Back to Control Tower" opens the Material readiness tab, not Command.
  - "Back to Control Tower" Command नहीं, Material readiness टैब खोलता है।

## Combine orders (/production/planner/gang-builder)
- The jumbo width in the preview assumes a fixed 5 mm trim per cut, and only the first 60 groups from 160 scanned jobs are loaded.
  - preview में jumbo चौड़ाई हर कट पर तय 5 mm trim मानती है, और 160 देखे गए jobs में से केवल पहले 60 groups लोड होते हैं।

## Production job (/production/jobs/[id])
- The job summary is read-only and operators cannot open it; there is no way to pause, edit or reassign the job from here.
  - job सार केवल देखने के लिए है और operator इसे नहीं खोल सकते; यहाँ से job रोकना, बदलना या दोबारा लगाना संभव नहीं।

## Ink Control Desk (/production/ink-control)
- The Store and Floor dropdowns list every location of the plant, not only store or floor types, and ink issues do not gate machine release ("No execution gate").
  - Store और Floor सूची में प्लांट की हर लोकेशन आती है, केवल स्टोर या फ्लोर प्रकार नहीं, और ink issue machine रिलीज़ को नहीं रोकता ("No execution gate")।

## Machine Terminal (/production/machine/[machine_id])
- "Force complete" needs a reason of at least 5 characters but the page does not say the minimum length.
  - "Force complete" के लिए कम से कम 5 अक्षर का कारण चाहिए, पर पेज यह न्यूनतम लंबाई नहीं बताता।
- On a stock order with no pieces per inner pouch anywhere, the machine logs the output but takes no inner pouches; the evening count shows their use as not on any order until a default is set on the inner pouch.
  - स्टॉक ऑर्डर में कहीं भी pieces per inner pouch न हो तो मशीन आउटपुट दर्ज कर लेती है पर inner pouch नहीं काटती; inner pouch पर default भरने तक शाम की गिनती में उनका इस्तेमाल किसी ऑर्डर पर नहीं जाता।

## Work Center Terminal (/production/work-center/[id])
- History shows only the newest 300 jobs; older ones need search or narrower dates.
  - History में केवल नए 300 jobs दिखते हैं; पुराने के लिए खोज या छोटी तारीख़ चाहिए।

## Factory Administration (/factory)
- The landing page shows cards for Plants, Work Centers, Machines, Locations and Processes to every role, but those pages open only for Admin and Owner.
  - Landing पेज हर रोल को Plants, Work Centers, Machines, Locations और Processes के कार्ड दिखाता है, पर वे पेज केवल Admin और Owner के लिए खुलते हैं।

## Locations (/factory/locations)
- There is no QR action on this page although location QR codes exist; posters are printed from Maintenance › Machine QR.
  - लोकेशन के QR कोड मौजूद हैं पर इस पेज पर QR का बटन नहीं; पोस्टर Maintenance › Machine QR से छपते हैं।

## Machines (/factory/machines)
- Machine status (ACTIVE / DOWN) cannot be set here; it changes only through maintenance faults and repairs.
  - Machine की स्थिति (ACTIVE / DOWN) यहाँ सेट नहीं होती; केवल मेंटेनेंस के fault और repair से बदलती है।

## Plants (/factory/plants)
- Deleting a plant is a permanent hard delete with only a generic error when it is in use; there is no deactivate option.
  - Plant हटाना स्थायी है और इस्तेमाल में हो तो केवल सामान्य त्रुटि आती है; बंद (deactivate) करने का विकल्प नहीं।

## Processes (/factory/processes)
- Roll behaviour cannot be changed after creation, so a wrong choice needs a new process and re-mapping of templates.
  - Roll behaviour बनाने के बाद नहीं बदलता, इसलिए गलत चुनाव पर नया process और templates की फिर से mapping चाहिए।

## New stock adjustment (/inventory/adjustments/new)
- "Save & Post" first saves the draft and then posts it; for a non-owner who drafted it the post is refused (second-person rule), the page stays on the form with "Post failed", and pressing again creates a second draft.
  - "Save & Post" पहले draft सेव करता है फिर post; जिसने draft बनाया वह Owner/Admin न हो तो post मना होता है (दूसरे व्यक्ति का नियम), पेज फ़ॉर्म पर ही "Post failed" दिखाता है, और दोबारा दबाने से दूसरा draft बन जाता है।
- The Before → After preview works only for roll lines; bulk, packaging and trading-good lines always show "Pick a roll or material to preview qty".
  - Before → After preview सिर्फ़ roll लाइनों पर चलता है; bulk, packaging और trading-good लाइनों पर हमेशा "Pick a roll or material to preview qty" दिखता है।

## Stock adjustment (/inventory/adjustments/[id])
- Draft lines cannot be edited or removed on screen (the server allows it); a wrong draft must be voided and recreated.
  - Draft की लाइनें स्क्रीन पर बदली या हटाई नहीं जा सकतीं (server अनुमति देता है); गलत draft को void करके नया बनाना पड़ता है।

## Stock Adjustments (/inventory/adjustments)
- The list has only status buttons — no search, plant or date filter — and no way to delete an unwanted draft.
  - सूची में सिर्फ़ status बटन हैं — search, plant या तारीख़ filter नहीं — और बेकार draft हटाने का तरीका नहीं।

## Alerts Center (/inventory/alerts)
- Load and resolve failures are only logged, not shown; a failed load looks like "No alerts found".
  - लोड और resolve की गलती सिर्फ़ log होती है, दिखती नहीं; लोड fail होने पर भी "No alerts found" दिखता है।
- There is no "Run audit" button here (it is on Inventory health), and no link from an alert to the material, roll or adjustment screen.
  - यहाँ "Run audit" बटन नहीं (वह Inventory health पर है), और alert से material, roll या adjustment स्क्रीन का link नहीं।

## Bulk Transactions (/inventory/bulk-transactions)
- No search, type, material, location or date filter and no export; only paging and the financial year in the header.
  - कोई search, type, material, location या तारीख़ filter और export नहीं; सिर्फ़ paging और header का financial year।

## Inks · adhesives · solvents (/inventory/addons)
- Family (ink, adhesive, solvent) is guessed from the material class, code or name, and Health uses a default reorder point of 50 when none is set, so some items can land in "Other" or show a misleading health.
  - Family (ink, adhesive, solvent) material class, code या नाम से अंदाज़ा लगाकर तय होती है, और reorder point न हो तो Health 50 मानकर निकलती है, इसलिए कुछ item "Other" में या गलत health के साथ दिख सकते हैं।

## Stock workspace (/inventory)
- The footer "Filtered stock" shows only bulk reserved / free, not rolls or packaging.
  - नीचे "Filtered stock" सिर्फ़ bulk का reserved / free दिखाता है, roll या packaging का नहीं।

## Count at rack (moved) (/inventory/count)
- The Stock tab bar still lists "Count at rack" pointing at this retired route, which only redirects to Stock lifecycle.
  - Stock टैब पट्टी में अब भी "Count at rack" इसी पुराने route पर जाता है, जो सिर्फ़ Stock lifecycle पर भेजता है।

## Bills & documents (/inventory/gate-bills)
- The inbox refresh tooltip says every 5 seconds, but the list actually refreshes about every 15 seconds.
  - Inbox refresh का tooltip 5 सेकंड कहता है, पर सूची असल में लगभग हर 15 सेकंड में refresh होती है।

## New general receipt (/inventory/general-receipts/new)
- If the open gate-pass endpoint is missing the RGP box says gate passes are not available and the pass must be closed later from its own page.
  - Open gate-pass endpoint न हो तो RGP बॉक्स कहता है gate pass उपलब्ध नहीं, और pass बाद में उसके पेज से बंद करना पड़ता है।

## New gate pass (/inventory/gate-passes/new)
- "Save and issue" saves the draft even when issuing fails; the user lands on the draft and must press "Issue" again.
  - Issue fail होने पर भी "Save and issue" draft सेव कर देता है; user draft पर पहुँचता है और फिर "Issue" दबाना पड़ता है।

## Goods in & out (/inventory/goods-movements)
- "Mark back at gate" only notifies the store; it does not receive the goods or move stock, so the row stays "Back at gate" until the paper is received on its own screen.
  - "Mark back at gate" सिर्फ़ store को सूचना देता है; माल receive या स्टॉक नहीं बदलता, इसलिए row तब तक "Back at gate" रहती है जब तक काग़ज़ अपनी स्क्रीन पर receive न हो।

## Receive goods (Smart GRN) (/inventory/grn)
- The "Save draft" button at the bottom of Smart GRN has no action; a half-entered receipt cannot be saved and is lost on leaving the page.
  - Smart GRN के नीचे का "Save draft" बटन कुछ नहीं करता; अधूरी रसीद save नहीं होती और पेज छोड़ने पर चली जाती है।
- Excel roll upload cannot be used while a gate bill is linked; the rolls must be entered or pasted in the grid.
  - Gate bill जुड़ा हो तो Excel roll upload नहीं चलता; roll grid में भरने या paste करने पड़ते हैं।
- After a timed-out post there is no on-page duplicate check for bulk lines other than the vendor-invoice check; the user must look in GRN history.
  - Post time out होने पर vendor-invoice जाँच के अलावा पेज पर दोहराव की जाँच नहीं; user को GRN history देखनी पड़ती है।

## Inventory / Ledger (/inventory/ledger)
- The "30-Day History" button does nothing.
  - "30-Day History" बटन कुछ नहीं करता।
- The ledger loads only the latest 500 bulk transactions and 500 roll movements, has no date filter and no ADJUST option in the operation filter.
  - Ledger सिर्फ़ ताज़ा 500 bulk लेन-देन और 500 roll move लाता है, तारीख़ filter नहीं, और operation filter में ADJUST नहीं।
- Quantities are shown with a minus sign for every type except GRN and Receive, so a positive adjustment or transfer-in looks like an outflow.
  - GRN और Receive छोड़कर हर type पर minus दिखता है, इसलिए बढ़ाने वाला adjustment या transfer-in भी बाहर जाता दिखता है।

## Roll Movements (/inventory/movements)
- If the movement list fails to load the page just shows "No movements found" with no error; there is no date or reason filter besides free search.
  - Movement list लोड न हो तो पेज बिना error के "No movements found" दिखाता है; free search के अलावा तारीख़ या कारण filter नहीं।

## Packaging materials (/inventory/packaging)
- The EOD box text says gunny is consumed by sealed count, but the current rule is that gonny is only ticked at release and taken off stock by the evening count.
  - EOD बॉक्स में लिखा है कि gunny sealed count से कटता है, जबकि अभी का नियम है कि gonny release पर सिर्फ़ tick होता है और evening count से कटता है।
- Packaging items are spelt "Gunny" here and "gonny" in the Packing Yard.
  - यहाँ "Gunny" लिखा है और Packing Yard में "gonny"।

## Roll workspace (/inventory/rolls)
- The quick action "Move →" opens Inter-plant; there is no same-plant location move on this page.
  - Quick action "Move →" Inter-plant खोलता है; इस पेज पर उसी plant में location बदलने का तरीका नहीं।

## Roll Genealogy (/inventory/traceability)
- The roll picker offers only the latest 200 rolls, and "Open Roll Explorer" goes to /inventory?tab=rolls instead of the Roll workspace.
  - Roll picker में सिर्फ़ ताज़ा 200 roll हैं, और "Open Roll Explorer" Roll workspace की जगह /inventory?tab=rolls खोलता है।

## Inter-Plant Transfers (/inventory/inter-plant)
- The page has no cancel for a draft challan and no search or date filter on the Draft / In Transit / Received columns.
  - Draft challan cancel करने का तरीका नहीं, और Draft / In Transit / Received कॉलम में search या तारीख़ filter नहीं।
- The destination location chosen at create is only guidance; the real location is picked again at receipt.
  - Create पर चुनी destination location सिर्फ़ मार्गदर्शन है; असली location receive पर फिर चुननी पड़ती है।

## Stock conversion workspace (/inventory/stock-conversions)
- A posted conversion cannot be reversed on this page; there is no history list of past conversions here.
  - Post हुआ conversion इस पेज पर वापस नहीं होता; पुराने conversion की सूची यहाँ नहीं।

## Count and close (/inventory/stock-lifecycle)
- "Post physical count" creates and posts the count sheet in one step, so the Submit → Approve (maker-checker) path applies only to sheets left as drafts in Count history.
  - "Post physical count" count sheet एक ही बार में बनाकर post कर देता है, इसलिए Submit → Approve (maker-checker) सिर्फ़ Count history में छोड़ी draft sheet पर लागू होता है।
- Opening stock drafts are saved only in this browser (Save draft / Load draft), not on the server.
  - Opening stock का draft सिर्फ़ इसी browser में save होता है (Save draft / Load draft), server पर नहीं।

## Vendor master (Inventory) (/inventory/vendors)
- Delete removes the vendor outright; vendor status (Active / Inactive), job-work processes, plants and rate cards can only be set in Master data → Vendors.
  - Delete vendor को सीधे हटा देता है; vendor status (Active / Inactive), job-work process, plant और rate card सिर्फ़ Master data → Vendors में बदलते हैं।

## Job work (/inventory/job-work)
- Job-work rate cards are saved from the order form, not from the Vendors page in Inventory.
  - Job-work rate card order फ़ॉर्म से save होते हैं, Inventory के Vendors पेज से नहीं।

## Match outward departure (/inventory/outward-documents/[id])
- Matching an outward record does not mark the slip delivered; proof of delivery stays a separate step in Dispatch Bay.
  - Outward record match करने से slip delivered नहीं होती; proof of delivery Dispatch Bay में अलग कदम है।

## Ink floor (moved to Ink control) (/inventory/ink-floor)
- The Floor menu still lists "Ink floor" although the page only redirects to Ink control.
  - Floor menu में अभी भी "Ink floor" है जबकि पेज सिर्फ़ Ink control पर भेजता है।

## Period (opens Year end) (/inventory/period)
- The Stock menu still lists "Period" although it only opens the Year end tab of Count and close.
  - Stock menu में अभी भी "Period" है जबकि यह सिर्फ़ Count and close का Year end tab खोलता है।

## Transit Tracking (/logistics/transit)
- The Transit page shows fixed sample figures and three made-up lanes; it is not connected to any shipment data.
  - Transit पेज पर तय नमूना आँकड़े और तीन काल्पनिक लेन हैं; यह किसी शिपमेंट डेटा से जुड़ा नहीं है।

## Dispatch, packing, and transit control (/logistics)
- "Open Transit Board" leads to the placeholder Transit page, not a live board.
  - "Open Transit Board" असली बोर्ड नहीं, अस्थायी Transit पेज खोलता है।

## Dispatch Bay (/logistics/dispatch)
- Vehicle, driver, LR number and job name are saved on the challan but not printed on the Epson slip.
  - गाड़ी, ड्राइवर, LR नंबर और job name चालान में सेव होते हैं पर Epson स्लिप पर नहीं छपते।
- A draft slip cannot be cancelled from Dispatch Bay, and there is no per-slip print log.
  - Dispatch Bay से ड्राफ्ट स्लिप कैंसल नहीं हो सकती, और हर स्लिप का प्रिंट लॉग नहीं है।
- "Mark dispatched anyway" lets a load be dispatched before all its slips are printed.
  - "Mark dispatched anyway" से सारी स्लिप छपे बिना भी लोड dispatched हो सकता है।

## Packing Yard (/logistics/packing)
- The yard cannot switch a line between inner packs and loose pouches; the order's choice is used.
  - यार्ड किसी लाइन को inner packs और loose pouches के बीच बदल नहीं सकता; ऑर्डर का चुनाव ही चलता है।
- A pouch line can be released with no packing item ticked, while a packed roll release refuses without at least one tick.
  - पाउच लाइन बिना किसी पैकिंग टिक के रिलीज़ हो सकती है, जबकि packed रोल रिलीज़ बिना एक टिक के मना हो जाती है।
- The 25 Oct note said gonny is not ticked on pouch releases; since 27 Oct every active non-inner-pouch item, gonny included, is always in the tick list.
  - 25 Oct के नोट में लिखा था कि पाउच रिलीज़ पर गोनी टिक नहीं होती; 27 Oct से inner pouch छोड़कर हर active आइटम, गोनी समेत, हमेशा टिक लिस्ट में है।
- The "Variance alerts" tile opens the In progress tab but does not filter to the units that are off.
  - "Variance alerts" टाइल In progress टैब खोलती है पर सिर्फ़ गड़बड़ यूनिट नहीं छाँटती।

## Packing audit (/logistics/packing/audit)
- The customer filter applies to the lists only, not to the evening count cards.
  - ग्राहक फ़िल्टर सिर्फ़ लिस्ट पर लगता है, शाम की गिनती के कार्ड पर नहीं।
- When ticks and the count disagree the use is still shared by ticks; the page warns but offers no way to fix the split.
  - टिक और गिनती अलग हों तो भी खपत टिक के हिसाब से बँटती है; पेज चेतावनी देता है पर बँटवारा सुधारने का रास्ता नहीं।

## Evening packing count (/logistics/packing/consumption)
- Counts booked before 26 Oct 2026 keep fractional shares; only later counts share whole pieces.
  - 26 Oct 2026 से पहले की गिनतियों में हिस्से दशमलव में रहते हैं; बाद की गिनती ही पूरे पीस बाँटती है।
- Inner pouches of a batch logged after that day's evening count was posted (e.g. night shift before midnight) are not marked in any count; their use is shared by packing plan on the next count or shows as not on any order.
  - जिस बैच का आउटपुट उस दिन की शाम की गिनती पोस्ट होने के बाद दर्ज हुआ (जैसे आधी रात से पहले की नाइट शिफ्ट), उसके inner pouch किसी गिनती में मार्क नहीं होते; उनका इस्तेमाल अगली गिनती में पैकिंग प्लान से बँटता है या किसी ऑर्डर पर नहीं जाता।

## System Admin Console sign-in (/admin-login)
- The admin sign-in asks for a 6-digit TOTP code but only the email and password are sent to the server; the code is not checked.
  - एडमिन लॉगिन 6 अंकों का TOTP माँगता है पर सर्वर को सिर्फ़ ईमेल और पासवर्ड जाता है; कोड जाँचा नहीं जाता।

## Sign in (Welcome back) (/login)
- There is no self-service password reset; users must ask an administrator.
  - खुद से पासवर्ड रीसेट नहीं होता; यूज़र को एडमिन से कहना पड़ता है।

## Goods at the gate (/gate/goods)
- Typed inward entry is retired; ?direction=INWARD always opens the bill photo screen.
  - टाइप वाला inward बंद है; ?direction=INWARD हमेशा बिल फ़ोटो स्क्रीन खोलता है।

## Today's register (/gate/register)
- Today's register shows typed entries; bill-photo arrivals and photo departures are listed on their own screens ("Today's arrivals", "Left today").
  - Today's register में टाइप एंट्री दिखती हैं; बिल-फ़ोटो आगमन और फ़ोटो रवानगी अपनी स्क्रीन पर ("Today's arrivals", "Left today") दिखते हैं।

## Inside now (visitors) (/gate/visitors)
- Watchmen cannot record a visitor's entry; a visitor without a smartphone needs an owner to register a walk-in.
  - वॉचमैन विज़िटर की एंट्री दर्ज नहीं कर सकता; बिना स्मार्टफ़ोन वाले विज़िटर के लिए ओनर को walk-in रजिस्टर करना पड़ता है।

## Gate register (gate home) (/gate)
- In the main sidebar the gate entries are listed for Admin/Owner only; watchmen reach the gate through their own gate shell and landing page.
  - मुख्य साइडबार में गेट की एंट्री सिर्फ़ Admin/Owner के लिए हैं; वॉचमैन अपने गेट शेल और लैंडिंग पेज से गेट पहुँचते हैं।

## Location scan (/loc/[code])
- Reserved or in-process rolls cannot be written off from the phone count.
  - Reserved या चल रहे रोल फ़ोन की गिनती से नहीं हटाए जा सकते।

## Machine scan (/m/[code])
- Quick log takes only kg and pcs; roll-making steps, returns, scrap and splits must use the machine terminal.
  - Quick log में सिर्फ़ kg और pcs; रोल बनाने वाले स्टेप, रिटर्न, स्क्रैप और स्प्लिट मशीन टर्मिनल पर ही होते हैं।

## Master Data (/master)
- The Master Data hub has no cards for Product Masters, Pouch styles or Web-width policies; they are reached only from the Products workspace tabs.
  - Master Data पेज पर Product Master, Pouch style और Web-width policy के कार्ड नहीं हैं; ये सिर्फ Products workspace टैब से खुलते हैं।
- Every card shows a "Live" badge whatever the state of the master, and "Total masters" is a fixed 13.
  - हर कार्ड पर "Live" बैज दिखता है चाहे master कैसा भी हो, और "Total masters" हमेशा 13 है।

## Packaging Master (/master/packaging)
- "Delete" on a packaging card deletes at once with no confirmation dialog.
  - Packaging कार्ड पर "Delete" बिना पुष्टि पूछे तुरंत delete कर देता है।
- A bought inner pouch card says it is taken off stock by the evening packing count, while inner pouches are never in the release tick list; only in-house inner pouches are taken at the machine.
  - खरीदे inner pouch के कार्ड पर लिखा है कि वह शाम की packing count से घटेगा, जबकि inner pouch release tick list में कभी नहीं आता; सिर्फ घर के inner pouch machine पर घटते हैं।
- Only Inner pouch and Sheet can be IN_HOUSE or BOTH; boxes, tape and other items cannot be marked as made in-house.
  - सिर्फ Inner pouch और Sheet IN_HOUSE या BOTH हो सकते हैं; box, tape आदि को घर में बना नहीं दिखा सकते।

## Adhesives & Solvents (/master/adhesives-solvents)
- The page is read-only: a new adhesive or solvent cannot be added, even when the plant changes supplier grade.
  - पेज सिर्फ देखने के लिए है: नया adhesive या solvent नहीं जोड़ सकते, चाहे supplier grade बदल जाए।

## Vendors (/master/vendors)
- /master/vendors opens only for Admin/Owner; store staff must use /inventory/vendors for the same vendors.
  - /master/vendors सिर्फ Admin/Owner के लिए खुलता है; store वाले वही vendors /inventory/vendors से देखते हैं।

## Edit trading good (/master/trading-goods/[id])
- There is no delete for a trading good; retire it by switching Status off. Stock cannot be edited here.
  - Trading good का delete नहीं है; Status बंद करके हटाएँ। Stock यहाँ नहीं बदलता।

## Product Master editor (/master/products/[id]/edit)
- Imported or added sizes are only a draft until "Save master"; leaving the page loses them without a warning in the size sheet flow.
  - Import या जोड़े गए sizes "Save master" तक सिर्फ draft हैं; पेज छोड़ने पर बिना चेतावनी चले जाते हैं।

## Product Master view (/master/products/[id])
- Packaging and POD masters hide the Customer overlays tab and the "Open in Sales create" link because sales never orders them.
  - Packaging और POD master में Customer overlays टैब और "Open in Sales create" नहीं दिखते क्योंकि sales इन्हें order नहीं करता।

## Pouch style editor (/master/pouch-styles/[id])
- Editing an approved style does not change existing sizes until the new draft is approved; sizes keep the old revision's copy.
  - Approved style बदलने से मौजूदा sizes तब तक नहीं बदलते जब तक नया draft approve न हो; sizes पुराने revision की copy रखते हैं।

## Add-ons & Misc Materials (/master/add-ons)
- A changed add-on weight does not reach lines already released to the floor until someone presses "Recalculate from masters" on the WC terminal.
  - Add-on का बदला वज़न floor पर release हुई lines तक तब तक नहीं पहुँचता जब तक WC terminal पर "Recalculate from masters" न दबाया जाए।

## Extrusion Recipes (/master/recipes)
- A recipe's variant, grade or thickness range cannot be edited; it must be disabled and recreated.
  - Recipe का variant, grade या thickness range नहीं बदल सकते; disable करके फिर से बनानी पड़ती है।

## Template Studio (template registry) (/engineering/templates)
- The template registry only lists LIVE and disabled templates; DRAFT, ENGINEERING and APPROVED templates do not appear, so a draft can only be reached from Pending Approvals, a saved link or the create dialog.
  - Template सूची में सिर्फ LIVE और disabled दिखते हैं; DRAFT, ENGINEERING और APPROVED नहीं दिखते, इसलिए draft सिर्फ Pending Approvals, सेव link या बनाने वाले dialog से खुलता है।

## Pending Approvals (/engineering/approvals)
- APPROVED templates waiting for "Publish LIVE" are not listed anywhere as a queue.
  - "Publish LIVE" के इंतज़ार में पड़े APPROVED template की कोई अलग सूची नहीं है।

## Review: template (Approval Console Retired) (/engineering/approvals/[id])
- The old approval detail page is retired and only links to Template Studio; old links still lead here.
  - पुराना approval पेज बंद है और सिर्फ Template Studio का link देता है; पुराने link अब भी यहीं आते हैं।

## Work-center setup by template (Route dispatch) (/engineering/route-dispatch)
- Dispatch can be edited both here and in Template Studio section 4; the studio says this page is only an audit and legacy backfill view.
  - Dispatch यहाँ और Template Studio section 4 दोनों जगह बदल सकता है; studio कहता है यह पेज सिर्फ जाँच और पुराना backfill है।
- "Backfill missing steps" runs immediately without a dry-run preview or confirmation.
  - "Backfill missing steps" बिना preview या पुष्टि के तुरंत चल जाता है।

## Tool Room (/engineering/tooling)
- "Delete" on a tool asset has no confirmation prompt.
  - Tool asset पर "Delete" पुष्टि नहीं माँगता।
- Tool "Service Due" dates do not create maintenance jobs or reminders; Tool Room and Maintenance schedules are not linked.
  - Tool की "Service Due" तारीख से maintenance job या याद नहीं बनती; Tool Room और Maintenance schedule जुड़े नहीं हैं।

## Artwork Library (/engineering/artworks)
- The artwork gallery has no filter by status or print type other than free-text search, and no delete or retire action.
  - Artwork gallery में status या print type का filter नहीं (सिर्फ search), और delete या retire का विकल्प नहीं।

## Cylinder Catalog (/engineering/cylinders)
- Cylinder status MAINTENANCE/RE_CHROME is counted as "Service Focus" but is not connected to the Maintenance module.
  - Cylinder का MAINTENANCE/RE_CHROME status "Service Focus" में गिना जाता है पर Maintenance module से जुड़ा नहीं है।

## Routing Studio (/engineering/routing)
- A route in use cannot be edited; the only path is disable and create a new route plus new template revisions.
  - इस्तेमाल में लगा route नहीं बदलता; तरीका सिर्फ disable करके नया route और नए template revision बनाना है।

## Maintenance jobs (/maintenance/jobs)
- Spares used on a job are notes only and do not issue stock from inventory.
  - Job में लगे पुर्ज़े सिर्फ note हैं, inventory stock से नहीं घटते।

## Maintenance schedules (/maintenance/schedules)
- Schedules can only be switched off, not deleted, and there is no copy-to-other-machines action.
  - Schedule सिर्फ बंद हो सकता है, delete नहीं, और दूसरी machine पर copy करने का विकल्प नहीं।

## Machine faults (/maintenance/faults)
- The fault list has no machine or severity filter; only Open/All.
  - Fault सूची में machine या severity filter नहीं; सिर्फ Open/All।

## Maintenance reports (/maintenance/reports)
- Reports cannot be exported or printed and the period is fixed (e.g. 90 days, 3 months, 30 days).
  - रिपोर्ट export या print नहीं होती और अवधि तय है (जैसे 90 दिन, 3 महीने, 30 दिन)।

## Maintenance today (/maintenance)
- Non-supervisors tapping a job in "Awaiting verification" get the job record, not a verify option, with no message why.
  - Supervisor के अलावा कोई "Awaiting verification" के job पर tap करे तो verify नहीं, record खुलता है, और कारण नहीं बताया जाता।

## Analytics and Reports Hub (/analytics)
- The OEE card on the hub is a quick estimate (7-day availability × quality) and will not match the OEE Deep Dive report, which also uses machine standard rates.
  - Hub का OEE कार्ड जल्दी वाला अनुमान है (7 दिन availability × quality), यह OEE Deep Dive रिपोर्ट से मेल नहीं खाएगा क्योंकि वहाँ मशीन का standard rate भी लगता है।
- The hub has no date or plant filter on screen; it always shows fixed windows (today/7 days/30 days).
  - Hub पर तारीख या plant का कोई filter नहीं है; यह हमेशा तय अवधि (आज/7 दिन/30 दिन) दिखाता है।
- There are two hub pages: /analytics (Analytics and Reports Hub) and /analytics/reports (Reports Hub); both list reports and daily packs, which can confuse users.
  - दो hub पेज हैं: /analytics और /analytics/reports; दोनों में रिपोर्ट और daily pack हैं, इससे भ्रम हो सकता है।

## Capability Matrix (/analytics/capability-matrix)
- The list is a static file; it is not edited from the ERP and can go out of date after new releases.
  - सूची एक स्थिर फाइल है; ERP से बदली नहीं जाती और नए release के बाद पुरानी हो सकती है।
- Section colours (green/amber/red) do not show because the registry has no status codes, so all sections look the same.
  - Registry में status code नहीं हैं, इसलिए हरा/पीला/लाल रंग नहीं दिखता और सभी भाग एक जैसे दिखते हैं।

## Costing Center (/analytics/costing)
- "Lock month" works even if the month was never marked reviewed, and there is no confirmation or unlock button.
  - "Lock month" बिना review के भी चल जाता है, और न कोई पुष्टि पूछी जाती है न unlock बटन है।
- The delete (bin) button on a cost group deletes without asking for confirmation.
  - Cost group का delete (कूड़ेदान) बटन बिना पुष्टि पूछे delete कर देता है।
- Month totals and group lines are separate saves; changing totals in Direct mode does not update the group lines automatically.
  - Month totals और group lines अलग-अलग save होते हैं; Direct mode में totals बदलने से group lines अपने आप नहीं बदलतीं।

## Inventory Health Matrix (/analytics/inventory-health)
- The page has no plant filter; tiles and alerts cover every plant together.
  - पेज पर plant filter नहीं है; tiles और alerts सभी plants के एक साथ हैं।
- The tile named "WIP Availability" actually shows free (available) rolls, not work in progress.
  - "WIP Availability" नाम की tile असल में free (available) roll दिखाती है, WIP नहीं।

## Inventory Snapshot History (/analytics/inventory-history)
- There is no date-range or plant filter; the page always loads the last 180 days for all plants.
  - तारीख या plant filter नहीं है; पेज हमेशा सभी plants के पिछले 180 दिन लाता है।

## Executive Control Center (/analytics/kpis)
- There is no plant filter; every figure is company-wide.
  - Plant filter नहीं है; हर आँकड़ा पूरी कंपनी का है।

## MRP Center (/analytics/mrp)
- Open purchase orders and goods in transit are not counted as supply, so the same shortage keeps appearing until the GRN is posted.
  - खुले purchase order और रास्ते में माल supply में नहीं गिने जाते, इसलिए GRN होने तक वही कमी दिखती रहती है।
- "Run planning engine" always runs for all plants; there is no plant choice on the page, so Transfer suggestions only come from plant-specific runs.
  - "Run planning engine" हमेशा सभी plants के लिए चलता है; पेज पर plant चुनने का विकल्प नहीं, इसलिए Transfer सुझाव केवल plant-वार run से आते हैं।
- Draft POs pick the vendor from the last receipt of that material, or the first active vendor by name, so vendor and price must be checked on the PO.
  - Draft PO में vendor उस material की आखिरी receipt से, या नाम से पहला चालू vendor लिया जाता है; PO पर vendor और दाम ज़रूर जाँचें।
- Available stock does not subtract rolls or bulk already reserved for other jobs except rolls not in AVAILABLE status.
  - उपलब्ध stock में दूसरी job के लिए रखी चीज़ें नहीं घटतीं, सिवाय उन roll के जो AVAILABLE status में नहीं हैं।

## Order Profitability (one order line) (/analytics/orders/[id]/costing)
- The "Material Components" and "Process Routing Costs" panels are placeholders; no material-wise or step-wise breakdown is shown.
  - "Material Components" और "Process Routing Costs" पैनल खाली नमूने हैं; material-वार या step-वार ब्योरा नहीं दिखता।
- The page does not show the costing mode (Actual/Hybrid/Estimated) or coverage %, so a fully estimated cost looks the same as an actual one.
  - पेज costing mode (Actual/Hybrid/Estimated) या coverage % नहीं दिखाता, इसलिए पूरा अनुमान और असली cost एक जैसे दिखते हैं।
- "Back to Center" goes to the Costing Center, not back to the Order Profitability list.
  - "Back to Center" Costing Center पर ले जाता है, Order Profitability सूची पर नहीं।

## Order Profitability (/analytics/orders/costing)
- The "Export" and filter buttons do nothing yet.
  - "Export" और filter बटन अभी कुछ नहीं करते।
- Lines that were never calculated do not appear; there is no button to calculate all lines from this list.
  - जिन lines की गणना नहीं हुई वे नहीं दिखतीं; इस सूची से सभी lines की गणना करने का बटन नहीं है।

## Process Rates (/analytics/process-rates)
- The cost estimate looks up the rate by process only, so a machine-specific override is not used by the estimate.
  - अनुमान दर केवल process से ढूँढता है, इसलिए मशीन-वार override अनुमान में इस्तेमाल नहीं होता।
- The 150 KG per hour speed used in the estimate is fixed in code and cannot be set per process or machine.
  - अनुमान में 150 KG/घंटा की गति code में तय है; process या मशीन के हिसाब से नहीं बदल सकते।
- There is no delete button for a rate row.
  - किसी दर की पंक्ति हटाने का बटन नहीं है।

## Reports Hub (/analytics/reports)
- "Generate daily pack" has no confirmation and can be pressed repeatedly, creating extra archived runs.
  - "Generate daily pack" बिना पुष्टि के बार-बार दबाया जा सकता है, जिससे फालतू run बनते हैं।

## Scrap Center (/analytics/scrap)
- Output and scrap here add raw quantities without unit conversion, so the scrap rate can differ from the Scrap & Yield report, which converts pieces to KG.
  - यहाँ output और scrap बिना unit बदले जोड़े जाते हैं, इसलिए scrap rate, Scrap & Yield रिपोर्ट (जो pieces को KG में बदलती है) से अलग हो सकता है।
- Roll adjustment scrap counts at most 500 roll movements in the period.
  - Roll adjustment scrap में अवधि के अधिकतम 500 roll movement ही गिने जाते हैं।

## Trading Pulse (/analytics/reports/trading)
- Margin uses today's average cost, not the cost at the time of sale, so past margins change when costs change.
  - Margin आज की औसत cost से निकलता है, बिक्री के समय की cost से नहीं, इसलिए cost बदलने पर पुराना margin भी बदल जाता है।

## Production Performance (/analytics/reports/production)
- The Process filter is shown on all report pages but the server ignores it, so choosing a process does not change the numbers.
  - Process filter सभी रिपोर्ट पेज पर दिखता है पर server उसे नहीं मानता, इसलिए process चुनने से आँकड़े नहीं बदलते।
- Job completion and job counts use jobs created in the period, while output uses logs in the period, so a long job can count output in one period and completion in another.
  - Job completion और गिनती अवधि में बने job से है, जबकि output अवधि के log से; लंबा job output एक अवधि में और completion दूसरी में गिन सकता है।

## OEE Deep Dive (/analytics/reports/oee)
- Availability uses 24-hour calendar days, not planned shift hours, so plants that run one shift will always show low availability and OEE.
  - Availability 24 घंटे के कैलेंडर दिन से है, planned shift घंटों से नहीं; एक shift चलाने वाले plant में availability और OEE हमेशा कम दिखेगा।

## Shift Performance (/analytics/reports/shift-performance)
- Shift output and scrap add raw logged quantities without converting pieces to KG.
  - Shift output और scrap में दर्ज मात्रा सीधे जुड़ती है, pieces को KG में नहीं बदला जाता।

## Operator Performance (/analytics/reports/operator)
- "Efficiency" is really a yield (good ÷ good + scrap), not output per hour, and only the top 20 operators by output are listed.
  - "Efficiency" असल में yield है (अच्छा ÷ अच्छा + scrap), प्रति घंटा output नहीं; और केवल output से top 20 operator दिखते हैं।
- Output is credited to the job's assigned operator, not to whoever actually logged the output.
  - Output job पर लगे operator के नाम जाता है, उसके नहीं जिसने असल में output दर्ज किया।

## Scrap & Yield (/analytics/reports/scrap)
- Cost of scrap uses one average rate across all material snapshots, not the rate of the material that was scrapped.
  - Scrap की लागत सभी material snapshot की एक औसत दर से है, scrap हुए material की दर से नहीं।

## Inventory Health (/analytics/reports/inventory)
- Stock figures ignore the date filter (they are always current), bulk stock ignores the plant filter, and the roll query has no status filter, so consumed or scrapped rolls may be included in totals.
  - Stock आँकड़े तारीख filter नहीं मानते (हमेशा अभी के), bulk stock plant filter नहीं मानता, और roll में status filter नहीं है, इसलिए consumed या scrapped roll भी कुल में आ सकते हैं।

## Inventory Lineage (/analytics/reports/inventory-lineage)
- Inventory Lineage returns exactly the same data as Inventory Health; there is no stage-to-stage lineage view on this page.
  - Inventory Lineage बिल्कुल Inventory Health जैसा डेटा देता है; इस पेज पर stage-से-stage वंश नहीं दिखता।

## MRP & Consumption Variance (/analytics/reports/mrp)
- This report shows consumption variance, not the MRP shortage plan; the name can make users expect shortages here.
  - यह रिपोर्ट खपत का अंतर दिखाती है, MRP कमी योजना नहीं; नाम से लोग यहाँ कमी देखने की उम्मीद कर सकते हैं।

## Material Variance (/analytics/reports/material-variance)
- Material Variance and MRP & Consumption Variance show the same numbers.
  - Material Variance और MRP & Consumption Variance एक ही आँकड़े दिखाते हैं।

## Ink Intelligence (/analytics/reports/ink-intelligence)
- Colour family is guessed from the ink name; inks not named with cyan/magenta/yellow/black/white fall into CUSTOM.
  - Colour family ink के नाम से अंदाज़ा लगाई जाती है; जिन ink के नाम में cyan/magenta/yellow/black/white नहीं, वे CUSTOM में जाती हैं।

## Sales Fulfillment (/analytics/reports/sales)
- The on-time figure is a proxy, not OTIF: it does not check delivered quantity or proof of delivery, and short-closed orders that are not COMPLETED still count as open.
  - On-time आँकड़ा अनुमान है, OTIF नहीं: delivered मात्रा या POD नहीं जाँचता, और short-closed order जो COMPLETED नहीं हैं वे खुले गिने जाते हैं।

## Dispatch & Logistics (/analytics/reports/dispatch)
- Shift and process filters have no effect on this report.
  - Shift और process filter का इस रिपोर्ट पर कोई असर नहीं।

## Costing & Profitability (/analytics/reports/costing)
- Only the date filter applies; plant, process and shift filters do not change costing figures.
  - केवल तारीख filter लागू होता है; plant, process और shift filter से costing आँकड़े नहीं बदलते।
- Margin % is a simple average of order margins, not total margin ÷ total revenue, so small orders weigh as much as big ones.
  - Margin % order margin का साधारण औसत है, कुल margin ÷ कुल revenue नहीं; छोटे order का भार बड़े जितना।

## Inter-Plant Logistics (/analytics/reports/interplant)
- Shift and process filters have no effect on this report.
  - Shift और process filter का इस रिपोर्ट पर कोई असर नहीं।

## Downtime Analysis (/analytics/reports/downtime)
- Downtime is linked to a machine through its job, so stoppages logged without a job are not shown.
  - Downtime मशीन से job के ज़रिए जुड़ता है, इसलिए बिना job के दर्ज रुकावट नहीं दिखती।

## Gate Register (/analytics/reports/gate)
- Visitor figures are counts only; names and details are deliberately not shown.
  - Visitor आँकड़े केवल गिनती हैं; नाम और ब्योरा जानबूझकर नहीं दिखाए जाते।

## System (opens User Management) (/system)
- /system has no overview page of its own; it always jumps to User Management.
  - /system का अपना कोई overview पेज नहीं है; यह हमेशा User Management पर जाता है।

## Audit Center (/system/audit)
- Export CSV saves only the rows of the current page (up to 100), not the whole filtered result.
  - Export CSV सिर्फ़ इस पेज की rows (100 तक) सेव करता है, पूरा filter किया नतीजा नहीं।
- Audit Center checks the role (Owner/Admin/Super Admin) on screen, so a user given rbac.view through an override still sees the access message.
  - Audit Center स्क्रीन पर रोल (Owner/Admin/Super Admin) जाँचता है, इसलिए override से rbac.view पाया यूज़र भी access संदेश ही देखता है।

## RBAC + Notification Operations (Governance) (/system/governance)
- The governance console checks only the role, so an rbac.view override does not open it.
  - Governance console सिर्फ़ रोल जाँचता है, इसलिए rbac.view override से यह नहीं खुलता।

## System Settings — Report delivery settings removed (/system/settings)
- The Settings page has no settings left; it only explains that report email schedules were removed and links to the Report Center.
  - Settings पेज पर अब कोई setting नहीं है; यह सिर्फ़ बताता है कि report email schedule हटाए गए और Report Center का लिंक देता है।

## Report Center (/system/report-center)
- Report packs cannot be emailed or scheduled per pack; they only go to the archive and the Owner/Admin bell.
  - Report pack email या अलग-अलग schedule नहीं हो सकते; वे सिर्फ़ archive और Owner/Admin bell में जाते हैं।

## User Management (/system/users)
- There is no delete for users; leavers must be switched to inactive.
  - यूज़र delete करने का विकल्प नहीं है; छोड़ने वालों को inactive करना होता है।

## Edit user (/system/users/[id])
- Password reset sets a password the admin types; there is no reset-by-email link.
  - Password reset में admin खुद password लिखता है; email से reset लिंक नहीं है।

## Shift Timing — Fixed shift windows (/system/shift-timing)
- Changing a shift window does not re-assign shifts of logs already recorded.
  - Shift का समय बदलने से पहले दर्ज log की shift नहीं बदलती।

## Reorder & safety stock policy (/system/reorder-policy)
- A low-stock alert does not create a purchase order; the buyer must raise the PO by hand.
  - Low-stock alert से purchase order अपने-आप नहीं बनता; खरीदार को PO खुद बनाना होता है।

## Purchase Order (detail) (/procurement/purchase-orders/[id])
- There is no button to record the vendor's acknowledgement (ACK) although the status exists and the API supports it.
  - Vendor की स्वीकृति (ACK) दर्ज करने का बटन नहीं है, जबकि status मौजूद है और API इसे सपोर्ट करती है।
- A DRAFT PO cannot be edited from the screen; the detail page has no edit button although the backend allows editing lines in DRAFT.
  - DRAFT PO को स्क्रीन से बदला नहीं जा सकता; detail पेज पर edit बटन नहीं है जबकि backend DRAFT में लाइनें बदलने देता है।
- Close Short and Cancel ask for the reason in a plain browser prompt with no confirmation step.
  - Close Short और Cancel कारण एक साधारण browser prompt में पूछते हैं, अलग पुष्टि का स्टेप नहीं है।

## Receive against PO (GRN wizard) (/procurement/purchase-orders/[id]/receive)
- Quality Status Rejected is only recorded on the GRN; the received quantity is still posted, so a rejected lot needs a separate stock action.
  - Quality Status Rejected सिर्फ़ GRN पर दर्ज होता है; मिली मात्रा फिर भी पोस्ट होती है, इसलिए rejected माल के लिए अलग stock कार्रवाई चाहिए।
- A posted GRN cannot be reversed from this screen; mistakes are corrected through stock adjustments.
  - पोस्ट हुआ GRN इस स्क्रीन से वापस नहीं होता; गलती stock adjustment से ठीक होती है।

## Purchase Orders (/procurement/purchase-orders)
- Plant Manager sees purchase orders but cannot create or receive them without an extra procurement.manage grant.
  - Plant Manager purchase order देख सकता है पर procurement.manage अनुमति के बिना बना या receive नहीं कर सकता।

## My Profile (/profile)
- Users cannot change their own role, machines or work centres here; only an admin can.
  - यूज़र यहाँ अपना रोल, machine या work centre नहीं बदल सकते; सिर्फ़ admin बदल सकता है।

## Help guide (Total Poly Print ERP) (/help)
- If a screen has no guide yet, Context Help shows only "No guide is available for this page."
  - किसी स्क्रीन का गाइड न हो तो Context Help में सिर्फ़ "No guide is available for this page." दिखता है।
