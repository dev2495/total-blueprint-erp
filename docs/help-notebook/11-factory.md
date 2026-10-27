# Factory setup — plants, machines, processes

## Overview (English)
# Factory module (factory set-up)

The Factory module describes the physical factory: plants, stock locations, processes, work centres and machines. Everything on the floor — rolls, WC terminals, machine terminals, QR posters, costing — hangs on these masters.

## Screens

- **/factory** — "Factory Administration". Counts of plants, work centres, machines and locations, and cards to each set-up screen.
- **/factory/overview** — "Visual Factory". Live floor: machines by route stage, WIP pools with ageing, customer commitments, output, scrap, downtime, alerts.
- **/factory/plants** — plants with legal profile (legal name, GSTIN, address, phone, email, authorised signatory, designation), default cost group and "Include In Official Reports".
- **/factory/locations** — stock locations per plant. Types: Warehouse, Raw Materials, Quality Control, WIP Area, Finished Goods, Dispatch Area. System locations cannot be deleted.
- **/factory/processes** — process physics: input/output form (Bulk, Roll, None), roll behaviour (Create New, Modify Existing, Multi Input Combine, Split), allowed stock forms (open web, lay-flat tube, folded web), output stock-form mode, and route skip capability.
- **/factory/work-centers** — machine groups per plant with their processes and default cost group.
- **/factory/machines** — machines per work centre, cost group override, "Orders running at the same time", QR code.

## Set-up order

1. **Plants** — create the plant, fill the legal profile (it prints on slips and challans) and the default cost group.
2. **Locations** — create store, WIP, finished goods and dispatch locations, plus floor locations for ink.
3. **Processes** — define each process. Choose the roll behaviour carefully: it cannot change after creation.
4. **Work centres** — create e.g. "Printing" under the plant and tick its processes.
5. **Machines** — create e.g. "PRN-01" under the work centre. Leave "Orders running at the same time" on "By step type (default)" unless the owner says otherwise.
6. **Users** — on System › Users assign work centres to work-centre managers and machines to operators.
7. **QR posters** — print from the machine row or Maintenance › Machine QR; scanning opens the machine card.

## Rules and limits

- Machine codes must be unique across the factory ("Machine code '…' already belongs to … in …").
- Cost group precedence: machine override → work centre default → plant default.
- Whether a step's output is WIP or finished goods is decided by its position in the route, not by the process.
- Process stock forms are used by the machine screens and roll picker to filter, warn and block rolls.
- "Planner can make optional" and "WCM can skip after previous output" are only process-level ceilings; each route step still has its own setting.
- System processes cannot be edited or deleted; a process used by templates or jobs cannot be deleted.
- Delete is permanent. Masters with stock, jobs or history cannot be deleted; keep them.
- Machine status (ACTIVE / DOWN) is driven by maintenance faults and repairs, not by this page. Only ACTIVE machines appear on the machine selector.

## Visual Factory

The head shows how many machines run, are in changeover, down or idle. Tabs: Overview, Plants, Customer commitments. OEE is shown as two real numbers, Availability (A) and Quality (Q); Performance is not tracked. Open orders are bucketed Fresh 0-2 days, Watch 3-5 days, Aged 6+ days. Clicking a machine opens its live console.

## Who does what

- **ADMIN / OWNER / SUPER_ADMIN**: create and change plants, locations, processes, work centres and machines.
- **PLANNER, PLANT_MANAGER, WORK_CENTER_MANAGER**: open Factory Administration and Visual Factory; the set-up screens stay closed unless they have a factory permission.
- **OPERATOR**: no factory screens.

## Problems and fixes

- **A machine is missing on the machine selector** — it is not ACTIVE, is in another work centre, or is not assigned to the operator.
- **A work centre is missing on the WC terminal list** — assign it to the manager on System › Users.
- **"roll_behavior is immutable after process creation."** — create a new process instead.
- **Delete fails** — the record is in use; keep it or move the stock first.
- **Wrong company details on a slip** — fix the plant legal profile.
- **Visual Factory shows "No machines yet"** — set up work centres and machines for that plant.

## सारांश (हिंदी)
# Factory मॉड्यूल (फ़ैक्टरी सेट-अप)

Factory मॉड्यूल physical factory बताता है: plants, स्टॉक लोकेशन, processes, work centres और machines। फ्लोर पर सब कुछ — rolls, WC terminal, machine terminal, QR पोस्टर, costing — इन्हीं masters पर टिका है।

## स्क्रीन

- **/factory** — "Factory Administration"। plants, work centres, machines और locations की गिनती, और हर सेट-अप स्क्रीन के कार्ड।
- **/factory/overview** — "Visual Factory"। लाइव फ्लोर: route stage के अनुसार machines, ageing के साथ WIP pools, customer commitments, output, scrap, downtime, alerts।
- **/factory/plants** — plants, legal profile (legal name, GSTIN, पता, फ़ोन, ईमेल, authorised signatory, designation), default cost group और "Include In Official Reports" के साथ।
- **/factory/locations** — हर प्लांट की स्टॉक लोकेशन। प्रकार: Warehouse, Raw Materials, Quality Control, WIP Area, Finished Goods, Dispatch Area। System लोकेशन हटाई नहीं जा सकती।
- **/factory/processes** — process की physics: input/output form (Bulk, Roll, None), roll behaviour (Create New, Modify Existing, Multi Input Combine, Split), allowed stock forms (open web, lay-flat tube, folded web), output stock-form mode, और route में छोड़ने की क्षमता।
- **/factory/work-centers** — हर प्लांट के machine groups, उनके processes और default cost group।
- **/factory/machines** — हर work centre की machines, cost group override, "Orders running at the same time", QR कोड।

## सेट-अप का क्रम

1. **Plants** — प्लांट बनाएँ, legal profile भरें (यह slip और challan पर छपती है) और default cost group।
2. **Locations** — स्टोर, WIP, finished goods और dispatch लोकेशन बनाएँ, और ink के लिए फ्लोर लोकेशन।
3. **Processes** — हर process बताएँ। roll behaviour ध्यान से चुनें: बनाने के बाद नहीं बदलता।
4. **Work centres** — प्लांट में जैसे "Printing" बनाएँ और उसके processes टिक करें।
5. **Machines** — work centre में जैसे "PRN-01" बनाएँ। मालिक न कहे तो "Orders running at the same time" को "By step type (default)" पर रहने दें।
6. **Users** — System › Users पर work-centre managers को work centres और operators को machines दें।
7. **QR पोस्टर** — machine की पंक्ति या Maintenance › Machine QR से प्रिंट करें; स्कैन करने पर machine का कार्ड खुलता है।

## नियम और सीमाएँ

- Machine कोड पूरी फ़ैक्टरी में अलग हो ("Machine code '…' already belongs to … in …")।
- Cost group का क्रम: machine override → work centre default → plant default।
- Step का output WIP है या finished goods, यह route में उसकी जगह से तय होता है, process से नहीं।
- Process के stock forms से machine screens और roll picker rolls छाँटते, चेतावनी देते और रोकते हैं।
- "Planner can make optional" और "WCM can skip after previous output" केवल process स्तर की सीमा हैं; हर route step की अपनी सेटिंग भी होती है।
- System processes बदले या हटाए नहीं जा सकते; templates या jobs में इस्तेमाल हुआ process हटाया नहीं जा सकता।
- हटाना स्थायी है। जिन masters में स्टॉक, jobs या इतिहास है वे नहीं हटते; उन्हें रहने दें।
- Machine की स्थिति (ACTIVE / DOWN) मेंटेनेंस के fault और repair से बदलती है, इस पेज से नहीं। machine selector पर केवल ACTIVE machines आती हैं।

## Visual Factory

हेडर बताता है कितनी machines चल रही हैं, changeover में हैं, DOWN हैं या खाली हैं। टैब: Overview, Plants, Customer commitments। OEE दो असली नंबरों में दिखता है, Availability (A) और Quality (Q); Performance ट्रैक नहीं होता। खुले orders Fresh 0-2 days, Watch 3-5 days, Aged 6+ days में बँटते हैं। machine पर क्लिक करने से उसका लाइव console खुलता है।

## कौन क्या करता है

- **ADMIN / OWNER / SUPER_ADMIN**: plants, locations, processes, work centres और machines बनाना और बदलना।
- **PLANNER, PLANT_MANAGER, WORK_CENTER_MANAGER**: Factory Administration और Visual Factory खोल सकते हैं; सेट-अप स्क्रीन factory अनुमति के बिना नहीं खुलतीं।
- **OPERATOR**: कोई factory स्क्रीन नहीं।

## समस्याएँ और समाधान

- **Machine selector पर machine नहीं दिखती** — वह ACTIVE नहीं, दूसरे work centre में है, या operator को नहीं दी गई।
- **WC terminal सूची में work centre नहीं** — System › Users पर manager को assign करें।
- **"roll_behavior is immutable after process creation."** — नया process बनाएँ।
- **हटाना नहीं होता** — record इस्तेमाल में है; रहने दें या पहले स्टॉक हटाएँ।
- **Slip पर गलत कंपनी विवरण** — plant की legal profile ठीक करें।
- **Visual Factory में "No machines yet"** — उस प्लांट के work centres और machines बनाएँ।

## Every screen (English)

### Factory Administration (/factory)
Screen address: /factory · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANNER, PLANT_MANAGER, WORK_CENTER_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=factory

A start page for factory set-up: counts of plants, work centres, machines and locations, and links to each set-up screen.

Open it to reach the masters that describe the physical factory. The set-up screens (Plants, Work Centers, Machines, Locations, Processes) open only for Admin and Owner (or a factory permission); Visual Overview opens for planning and floor managers too.

**Before you start**
- Signed in with a role other than Operator.

**Step by step**
1. Read the tiles "Plants", "Work Centers", "Machines", "Locations".
2. Click a card: "Visual Overview", "Plants", "Work Centers", "Machines", "Locations" or "Processes".
3. Set up in this order: Plants → Locations → Processes → Work Centers → Machines.
4. Finally assign work centres and machines to people on System › Users.

**What is on the screen**
- **Plants / Work Centers / Machines / Locations**: How many of each exist. Shows "..." while loading.

**Common problems and fixes**
- "A card opens a blocked page" — Plants, Work Centers, Machines, Locations and Processes are for Admin and Owner. Ask an admin.

**If stuck**
1. If the counts stay 0 after loading, the factory is not set up yet; start with Plants.

Related pages: /factory/overview, /factory/plants, /factory/work-centers, /factory/machines, /factory/locations, /factory/processes

**Not done yet / watch out**
- The landing page shows cards for Plants, Work Centers, Machines, Locations and Processes to every role, but those pages open only for Admin and Owner.

### Locations (/factory/locations)
Screen address: /factory/locations · Roles: ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=factory-locations

Create, edit and delete stock locations (warehouse, raw material, QC, WIP, finished goods, dispatch) inside a plant.

Every roll, bulk lot and packed unit sits at a location. Set them up before receiving stock. Store and floor locations are also used by the ink desk, the WC terminal and the packing yard.

**Before you start**
- The plant exists (Factory › Plants).

**Step by step**
1. Press "Create Location".
2. Pick "Plant", type "Location Code" and "Location Name", choose "Location Type".
3. Save; the toast "Location created." confirms.
4. Find a location with "Search locations...", "Filter by plant" and "Filter by type".
5. Use the pencil to edit ("Edit Location") or the bin to delete; confirm in "Are you absolutely sure?".

**What is on the screen**
- **Location Type**: Warehouse, Raw Materials, Quality Control, WIP Area, Finished Goods, Dispatch Area.
- **System**: Locations the ERP needs (for example in-transit). They cannot be deleted.
- **Status**: Active or inactive.

**Common problems and fixes**
- "Code is required / Name is required / Plant is required / Type is required" — Fill every field of the form.
- "Delete fails with an error toast" — The location holds stock or history. Move the stock out, or keep the location.

**If stuck**
1. Delete is permanent; prefer renaming a wrong location.
2. For QR posters of locations use Maintenance › Machine QR.

Related pages: /factory/plants, /inventory/rolls, /maintenance/qr, /production/ink-control

**Not done yet / watch out**
- There is no QR action on this page although location QR codes exist; posters are printed from Maintenance › Machine QR.

### Machines (/factory/machines)
Screen address: /factory/machines · Roles: ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=factory-machines

The machine master: create machines under a work centre, set the cost group, and choose whether a machine may run several orders at once. Print a QR code per machine.

Machines are what the WC terminal assigns jobs to and what operators run. Set them up after work centres. Operators are assigned to machines on System › Users.

**Before you start**
- Work centre exists (Factory › Work Centers).

**Step by step**
1. Press "Create Machine".
2. Pick "Work Center", type "Machine Code" and "Machine Name".
3. Optionally set "Machine Cost Group Override" (else "Use work center default").
4. Choose "Orders running at the same time": "By step type (default)", "Several orders may run at the same time" or "One order at a time".
5. Save; "Machine created." confirms.
6. Use the QR button ("QR code: scan on the floor to open this machine") to print its poster.

**What is on the screen**
- **Machine Code**: Must be unique across the factory; it is printed on the QR poster and shown as UID on the machine selector.
- **Orders running at the same time**: Default: bulk → roll steps (extrusion) may run several orders, others one at a time. Checked at Start and Resume.
- **Machine Cost Group Override**: For costing: machine group wins over the work centre, which wins over the plant default.

**Common problems and fixes**
- "Machine code '…' already belongs to … in …." — The code is used. Choose another code or press "Open existing machine".
- "Code is required / Name is required / Work Center is required" — Fill the fields.
- "Machine could not be deleted." — It has jobs or history. Keep it; maintenance marks it DOWN when out of use.

**If stuck**
1. A machine missing on the machine selector: check it is ACTIVE and in the right work centre, and assigned to the operator.

Related pages: /factory/work-centers, /production/machine-selector, /maintenance/qr, /system/users

**Not done yet / watch out**
- Machine status (ACTIVE / DOWN) cannot be set here; it changes only through maintenance faults and repairs.

### Visual Factory (/factory/overview)
Screen address: /factory/overview · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANNER, WORK_CENTER_MANAGER, PLANT_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=factory-overview

A live picture of the floor: every machine by route stage, WIP pools with ageing, customer commitments, today's output, scrap, downtime and alerts.

Open it to see at a glance which machines run, which are idle or down, where WIP is ageing and which customers wait. Click a machine for its live console, a customer for their orders, a pool stage for the inventory drill.

**Before you start**
- Plants, work centres and machines set up.

**Step by step**
1. Read the head: "N of M running", changeover, down and idle counts.
2. Switch tabs: "Overview", "Plants", "Customer commitments".
3. In "Route flow · today" see each machine under its stage; click one to open its console.
4. In "WIP pools · aged" check stock in flight by age bucket.
5. In "Customer commitments" read open SOs by Fresh 0-2d, Watch 3-5d, Aged 6+ days.

**What is on the screen**
- **A · Availability / Q · Quality**: OEE is shown as two real numbers. Performance (P) is not tracked.
- **Today output / Aged 6+ days / Scrap % (Q) / Downtime today (A) / Open alerts**: Day figures for the floor.
- **Machine offline / Machine idle**: State of a machine card; "Op:" names the operator, "queued" the waiting jobs.

**Common problems and fixes**
- "No machines in this stage yet / No machines yet" — No machine is set up for that stage or plant. Use "Set up plants" / "Set up work centers".

**If stuck**
1. Reload if figures look old; the page reads live data on load.

Related pages: /production/machine/[machine_id], /factory/plants, /factory/work-centers, /dashboard/planner/control-tower/live-production

### Plants (/factory/plants)
Screen address: /factory/plants · Roles: ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=factory-plants

Create and edit plants (factory sites) with their legal profile, default cost group and whether they appear in official reports.

A plant is the top of the factory tree: locations, work centres and machines sit under it. The legal profile (name, GSTIN, address, signatory) prints on documents such as dispatch slips and challans.

**Before you start**
- Admin or Owner role.

**Step by step**
1. Press "Create Plant".
2. Type "Plant Code" and "Plant Name"; pick "Default Cost Group".
3. Tick "Include In Official Reports" if this plant belongs in the official daily stock and production reports.
4. Fill the legal profile: "Legal Name", "GSTIN", "Address", "Phone", "Email", "Authorized Signatory", "Designation".
5. Save; "Plant created." confirms. Edit later with "Edit Plant".

**What is on the screen**
- **Legal Profile Configured / Pending**: Badge on the plant card showing whether the legal details are filled.
- **Default Cost Group**: Fallback group used only when work center, machine, and template-step assignments do not override it.
- **Locations / W/C / Machines**: Counts under the plant.

**Common problems and fixes**
- "Code is required / Name is required" — Fill code and name.
- "Delete fails with an error toast" — The plant still has locations, work centres or stock. Delete is permanent; normally keep the plant.

**If stuck**
1. If a slip prints the wrong company details, correct the legal profile here.

Related pages: /factory/locations, /factory/work-centers, /system/company-profile

**Not done yet / watch out**
- Deleting a plant is a permanent hard delete with only a generic error when it is in use; there is no deactivate option.

### Processes (/factory/processes)
Screen address: /factory/processes · Roles: ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=factory-processes

Define each manufacturing process by its physics: input and output form (bulk, roll, none), roll behaviour, allowed stock forms and whether a route step may be skipped.

Processes are used by work centres and route templates. Whether output is WIP or finished goods is decided by the route position, not here. Quantities and consumption come from templates and BOMs.

**Before you start**
- Admin or Owner role. Know the machine physics of the step (e.g. extrusion makes rolls from granules).

**Step by step**
1. Press "Create Process".
2. In "Basic Information" type "Process Code", "Process Name" and "Description".
3. In "IO Configuration" pick "Input Form" and "Output Form" (Bulk, Roll, None).
4. Pick "Roll Behavior": Create New, Modify Existing, Multi Input Combine or Split. It cannot change later.
5. Set "Stock-form capability": allowed input and output forms (open web, lay-flat tube, folded web) and "Output stock-form mode".
6. Under "Route behavior capability" tick "Planner can make optional" and/or "WCM can skip after previous output" if allowed.
7. Save; "Process created." confirms.

**What is on the screen**
- **Output stock-form mode**: Preserve input (printing, lamination), Target decides (pouch/order), Operator decides (extrusion), Converts form.
- **REVIEW STOCK FORMS**: Badge on processes whose stock-form capability is not reviewed yet; machine screens use these forms to filter, warn and block rolls.
- **PLANNER OPTIONAL / WCM SKIPPABLE**: Process-level ceiling only; each route step still has its own setting.

**Common problems and fixes**
- "roll_behavior is immutable after process creation." — Create a new process with the right behaviour instead.
- "System processes cannot be modified. / System processes cannot be deleted." — Built-in processes are locked.
- "Process is used by existing templates or jobs and cannot be deleted." — Remove it from templates first, or keep it.

**If stuck**
1. If a WC terminal refuses a roll's stock form, check the allowed input forms of the step's process here.

Related pages: /factory/work-centers, /engineering/templates, /engineering/routing, /engineering/route-dispatch

**Not done yet / watch out**
- Roll behaviour cannot be changed after creation, so a wrong choice needs a new process and re-mapping of templates.

### Work Centers (/factory/work-centers)
Screen address: /factory/work-centers · Roles: ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=factory-work-centers

Create and edit work centres (machine groups) inside a plant, with their processes and default cost group.

A work centre groups machines that do the same kind of work (for example printing). Route steps go to work centres; the WC terminal and the machine selector are built from them. Assign a work-centre manager on System › Users.

**Before you start**
- Plant exists; processes defined (Factory › Processes).

**Step by step**
1. Press "Create Work Center".
2. Pick "Plant", type "Work Center Code" and "Work Center Name".
3. Pick "Default Cost Group" (or "No default group").
4. Tick the "Operational Processes" this work centre can do.
5. Save; "Work Center created." confirms. Filter by plant with "All Plants" and search "Search work centers...".

**What is on the screen**
- **Processes**: "No specific processes" when none ticked.
- **Cost Group**: "Plant default" / "Inherited from plant" when empty; used when machines do not override.

**Common problems and fixes**
- "Code is required / Name is required / Plant is required" — Fill the fields.
- "Delete fails with an error toast" — The work centre has machines, jobs or route steps. Keep it.

**If stuck**
1. A work centre missing on the WC terminal list: assign it to the manager on System › Users.

Related pages: /factory/machines, /factory/processes, /production/work-center, /system/users

## हर स्क्रीन (हिंदी)

### Factory Administration (/factory)
स्क्रीन का पता: /factory · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANNER, PLANT_MANAGER, WORK_CENTER_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=factory&lang=hi

फ़ैक्टरी सेट-अप का शुरुआती पेज: plants, work centres, machines और locations की गिनती, और हर सेट-अप स्क्रीन के लिंक।

physical factory बताने वाले masters तक पहुँचने के लिए खोलें। सेट-अप स्क्रीन (Plants, Work Centers, Machines, Locations, Processes) केवल Admin और Owner (या factory अनुमति) के लिए खुलती हैं; Visual Overview planning और floor managers के लिए भी।

**शुरू करने से पहले**
- Operator के अलावा किसी रोल से साइन-इन।

**स्टेप बाय स्टेप**
1. "Plants", "Work Centers", "Machines", "Locations" टाइल पढ़ें।
2. कार्ड दबाएँ: "Visual Overview", "Plants", "Work Centers", "Machines", "Locations" या "Processes"।
3. इस क्रम में सेट-अप करें: Plants → Locations → Processes → Work Centers → Machines।
4. आखिर में System › Users पर लोगों को work centres और machines दें।

**स्क्रीन पर क्या है**
- **Plants / Work Centers / Machines / Locations**: हर एक की संख्या। लोड होते समय "..." दिखता है।

**आम दिक्कतें और हल**
- "कार्ड से पेज नहीं खुलता" — Plants, Work Centers, Machines, Locations और Processes Admin और Owner के लिए हैं। Admin से कहें।

**अटक गए तो**
1. लोड के बाद भी गिनती 0 रहे तो फ़ैक्टरी सेट-अप नहीं हुई; Plants से शुरू करें।

जुड़े पेज: /factory/overview, /factory/plants, /factory/work-centers, /factory/machines, /factory/locations, /factory/processes

**अभी नहीं होता / ध्यान दें**
- Landing पेज हर रोल को Plants, Work Centers, Machines, Locations और Processes के कार्ड दिखाता है, पर वे पेज केवल Admin और Owner के लिए खुलते हैं।

### Locations (/factory/locations)
स्क्रीन का पता: /factory/locations · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=factory-locations&lang=hi

प्लांट के अंदर स्टॉक लोकेशन (warehouse, raw material, QC, WIP, finished goods, dispatch) बनाना, बदलना और हटाना।

हर roll, bulk lot और पैक unit किसी लोकेशन पर होता है। स्टॉक आने से पहले इन्हें बनाएँ। स्टोर और फ्लोर लोकेशन ink desk, WC terminal और packing yard भी इस्तेमाल करते हैं।

**शुरू करने से पहले**
- प्लांट बना हो (Factory › Plants)।

**स्टेप बाय स्टेप**
1. "Create Location" दबाएँ।
2. "Plant" चुनें, "Location Code" और "Location Name" लिखें, "Location Type" चुनें।
3. सेव करें; "Location created." संदेश पुष्टि करता है।
4. "Search locations...", "Filter by plant" और "Filter by type" से लोकेशन खोजें।
5. एडिट के लिए पेंसिल ("Edit Location") या हटाने के लिए डिब्बा; "Are you absolutely sure?" में पुष्टि करें।

**स्क्रीन पर क्या है**
- **Location Type**: Warehouse, Raw Materials, Quality Control, WIP Area, Finished Goods, Dispatch Area।
- **System**: ERP के लिए ज़रूरी लोकेशन (जैसे in-transit)। इन्हें हटाया नहीं जा सकता।
- **Status**: Active या inactive।

**आम दिक्कतें और हल**
- "ज़रूरी फ़ील्ड खाली" — फ़ॉर्म के सब फ़ील्ड भरें।
- "हटाने पर त्रुटि" — लोकेशन में स्टॉक या इतिहास है। स्टॉक हटाएँ, या लोकेशन रहने दें।

**अटक गए तो**
1. हटाना स्थायी है; गलत लोकेशन का नाम बदलना बेहतर है।
2. लोकेशन के QR पोस्टर के लिए Maintenance › Machine QR खोलें।

जुड़े पेज: /factory/plants, /inventory/rolls, /maintenance/qr, /production/ink-control

**अभी नहीं होता / ध्यान दें**
- लोकेशन के QR कोड मौजूद हैं पर इस पेज पर QR का बटन नहीं; पोस्टर Maintenance › Machine QR से छपते हैं।

### Machines (/factory/machines)
स्क्रीन का पता: /factory/machines · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=factory-machines&lang=hi

machine master: work centre के अंदर machines बनाएँ, cost group सेट करें, और तय करें कि machine एक साथ कई orders चला सकती है या नहीं। हर machine का QR कोड प्रिंट करें।

WC terminal jobs को machines पर ही लगाता है और operator उन्हें चलाते हैं। work centres के बाद बनाएँ। Operators को machines System › Users पर दी जाती हैं।

**शुरू करने से पहले**
- work centre बना हो (Factory › Work Centers)।

**स्टेप बाय स्टेप**
1. "Create Machine" दबाएँ।
2. "Work Center" चुनें, "Machine Code" और "Machine Name" लिखें।
3. चाहें तो "Machine Cost Group Override" सेट करें (वरना "Use work center default")।
4. "Orders running at the same time" चुनें: "By step type (default)", "Several orders may run at the same time" या "One order at a time"।
5. सेव करें; "Machine created." पुष्टि करता है।
6. पोस्टर प्रिंट करने के लिए QR बटन ("QR code: scan on the floor to open this machine") दबाएँ।

**स्क्रीन पर क्या है**
- **Machine Code**: पूरी फ़ैक्टरी में अलग होना चाहिए; QR पोस्टर पर छपता है और machine selector पर UID दिखता है।
- **Orders running at the same time**: Default: bulk → roll steps (extrusion) कई orders चला सकते हैं, बाकी एक समय में एक। Start और Resume पर जाँचा जाता है।
- **Machine Cost Group Override**: costing के लिए: machine का group work centre से ऊपर, और work centre का plant default से ऊपर।

**आम दिक्कतें और हल**
- "machine कोड पहले से है" — कोड इस्तेमाल हो चुका। दूसरा कोड चुनें या "Open existing machine" दबाएँ।
- "ज़रूरी फ़ील्ड खाली" — फ़ील्ड भरें।
- "machine हटाई नहीं जा सकी" — इस पर jobs या इतिहास है। रहने दें; बंद होने पर मेंटेनेंस DOWN करता है।

**अटक गए तो**
1. machine selector पर machine न दिखे: देखें ACTIVE है, सही work centre में है, और operator को दी गई है।

जुड़े पेज: /factory/work-centers, /production/machine-selector, /maintenance/qr, /system/users

**अभी नहीं होता / ध्यान दें**
- Machine की स्थिति (ACTIVE / DOWN) यहाँ सेट नहीं होती; केवल मेंटेनेंस के fault और repair से बदलती है।

### Visual Factory (/factory/overview)
स्क्रीन का पता: /factory/overview · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANNER, WORK_CENTER_MANAGER, PLANT_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=factory-overview&lang=hi

फ्लोर की लाइव तस्वीर: route stage के अनुसार हर machine, ageing के साथ WIP pools, customer commitments, आज का output, scrap, downtime और alerts।

एक नज़र में देखें कौन-सी machines चल रही हैं, कौन खाली या DOWN हैं, WIP कहाँ पुराना हो रहा है और कौन-से customer इंतज़ार में हैं। machine पर क्लिक करें तो लाइव console, customer पर उसके orders, pool stage पर inventory drill।

**शुरू करने से पहले**
- Plants, work centres और machines बने हों।

**स्टेप बाय स्टेप**
1. हेडर पढ़ें: "N of M running", changeover, down और idle गिनती।
2. टैब बदलें: "Overview", "Plants", "Customer commitments"।
3. "Route flow · today" में हर machine उसके stage में देखें; console के लिए क्लिक करें।
4. "WIP pools · aged" में उम्र के हिसाब से चलता स्टॉक देखें।
5. "Customer commitments" में खुले SO देखें: Fresh 0-2d, Watch 3-5d, Aged 6+ days।

**स्क्रीन पर क्या है**
- **A · Availability / Q · Quality**: OEE दो असली नंबरों में दिखता है। Performance (P) ट्रैक नहीं होता।
- **Today output / Aged 6+ days / Scrap % (Q) / Downtime today (A) / Open alerts**: फ्लोर के दिन के आँकड़े।
- **Machine offline / Machine idle**: machine कार्ड की स्थिति; "Op:" operator का नाम, "queued" इंतज़ार वाले jobs।

**आम दिक्कतें और हल**
- "कोई machine नहीं" — उस stage या प्लांट के लिए machine नहीं बनी। "Set up plants" / "Set up work centers" इस्तेमाल करें।

**अटक गए तो**
1. आँकड़े पुराने लगें तो रीलोड करें।

जुड़े पेज: /production/machine/[machine_id], /factory/plants, /factory/work-centers, /dashboard/planner/control-tower/live-production

### Plants (/factory/plants)
स्क्रीन का पता: /factory/plants · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=factory-plants&lang=hi

plants (फ़ैक्टरी साइट) बनाना और बदलना, उनकी legal profile, default cost group और official reports में दिखें या नहीं।

plant फ़ैक्टरी पेड़ का सबसे ऊपर का हिस्सा है: locations, work centres और machines इसके नीचे आते हैं। legal profile (नाम, GSTIN, पता, signatory) dispatch slip और challan जैसे दस्तावेज़ों पर छपती है।

**शुरू करने से पहले**
- Admin या Owner रोल।

**स्टेप बाय स्टेप**
1. "Create Plant" दबाएँ।
2. "Plant Code" और "Plant Name" लिखें; "Default Cost Group" चुनें।
3. अगर यह plant official daily stock और production reports में हो, तो "Include In Official Reports" टिक करें।
4. legal profile भरें: "Legal Name", "GSTIN", "Address", "Phone", "Email", "Authorized Signatory", "Designation"।
5. सेव करें; "Plant created." पुष्टि करता है। बाद में "Edit Plant" से बदलें।

**स्क्रीन पर क्या है**
- **Legal Profile Configured / Pending**: plant कार्ड पर बैज, legal details भरी हैं या नहीं।
- **Default Cost Group**: fallback group, केवल तब जब work centre, machine और template-step इसे न बदलें।
- **Locations / W/C / Machines**: plant के नीचे की गिनती।

**आम दिक्कतें और हल**
- "ज़रूरी फ़ील्ड खाली" — कोड और नाम भरें।
- "हटाने पर त्रुटि" — plant में अभी locations, work centres या स्टॉक है। हटाना स्थायी है; आम तौर पर plant रहने दें।

**अटक गए तो**
1. slip पर गलत कंपनी विवरण छपे तो यहाँ legal profile ठीक करें।

जुड़े पेज: /factory/locations, /factory/work-centers, /system/company-profile

**अभी नहीं होता / ध्यान दें**
- Plant हटाना स्थायी है और इस्तेमाल में हो तो केवल सामान्य त्रुटि आती है; बंद (deactivate) करने का विकल्प नहीं।

### Processes (/factory/processes)
स्क्रीन का पता: /factory/processes · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=factory-processes&lang=hi

हर manufacturing process को उसकी physics से बताएँ: input और output form (bulk, roll, none), roll behaviour, allowed stock forms और route step छोड़ा जा सकता है या नहीं।

Processes को work centres और route templates इस्तेमाल करते हैं। output WIP है या finished goods यह route में जगह से तय होता है, यहाँ से नहीं। मात्रा और खपत templates और BOM से आती है।

**शुरू करने से पहले**
- Admin या Owner रोल। step की physics पता हो (जैसे extrusion granule से roll बनाता है)।

**स्टेप बाय स्टेप**
1. "Create Process" दबाएँ।
2. "Basic Information" में "Process Code", "Process Name" और "Description" लिखें।
3. "IO Configuration" में "Input Form" और "Output Form" चुनें (Bulk, Roll, None)।
4. "Roll Behavior" चुनें: Create New, Modify Existing, Multi Input Combine या Split। बाद में नहीं बदल सकता।
5. "Stock-form capability" सेट करें: allowed input और output forms (open web, lay-flat tube, folded web) और "Output stock-form mode"।
6. "Route behavior capability" में अनुमति हो तो "Planner can make optional" और/या "WCM can skip after previous output" टिक करें।
7. सेव करें; "Process created." पुष्टि करता है।

**स्क्रीन पर क्या है**
- **Output stock-form mode**: Preserve input (printing, lamination), Target decides (pouch/order), Operator decides (extrusion), Converts form।
- **REVIEW STOCK FORMS**: जिन processes की stock-form capability जाँची नहीं गई उन पर बैज; machine screens इन forms से rolls छाँटते, चेतावनी देते और रोकते हैं।
- **PLANNER OPTIONAL / WCM SKIPPABLE**: केवल process स्तर की सीमा; हर route step की अपनी सेटिंग फिर भी होती है।

**आम दिक्कतें और हल**
- "roll behaviour नहीं बदलता" — सही behaviour के साथ नया process बनाएँ।
- "system process नहीं बदलता" — built-in processes लॉक हैं।
- "process इस्तेमाल में है" — पहले templates से हटाएँ, या रहने दें।

**अटक गए तो**
1. WC terminal किसी roll का stock form मना करे तो यहाँ step के process के allowed input forms देखें।

जुड़े पेज: /factory/work-centers, /engineering/templates, /engineering/routing, /engineering/route-dispatch

**अभी नहीं होता / ध्यान दें**
- Roll behaviour बनाने के बाद नहीं बदलता, इसलिए गलत चुनाव पर नया process और templates की फिर से mapping चाहिए।

### Work Centers (/factory/work-centers)
स्क्रीन का पता: /factory/work-centers · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=factory-work-centers&lang=hi

प्लांट के अंदर work centres (machine groups) बनाना और बदलना, उनके processes और default cost group के साथ।

work centre एक जैसा काम करने वाली machines का समूह है (जैसे printing)। route steps work centres पर जाते हैं; WC terminal और machine selector इन्हीं से बनते हैं। work-centre manager को System › Users पर assign करें।

**शुरू करने से पहले**
- plant बना हो; processes बने हों (Factory › Processes)।

**स्टेप बाय स्टेप**
1. "Create Work Center" दबाएँ।
2. "Plant" चुनें, "Work Center Code" और "Work Center Name" लिखें।
3. "Default Cost Group" चुनें (या "No default group")।
4. "Operational Processes" में वे processes टिक करें जो यह work centre कर सकता है।
5. सेव करें; "Work Center created." पुष्टि करता है। "All Plants" से प्लांट फ़िल्टर और "Search work centers..." से खोजें।

**स्क्रीन पर क्या है**
- **Processes**: कुछ टिक न हो तो "No specific processes"।
- **Cost Group**: खाली हो तो "Plant default" / "Inherited from plant"; तब लागू जब machines इसे न बदलें।

**आम दिक्कतें और हल**
- "ज़रूरी फ़ील्ड खाली" — फ़ील्ड भरें।
- "हटाने पर त्रुटि" — work centre में machines, jobs या route steps हैं। रहने दें।

**अटक गए तो**
1. WC terminal सूची में work centre न दिखे: System › Users पर manager को assign करें।

जुड़े पेज: /factory/machines, /factory/processes, /production/work-center, /system/users
