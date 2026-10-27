# Engineering — artworks, cylinders, routes, templates

## Overview (English)
# Engineering module

Engineering decides **how a product is made** before sales or the planner use it. It owns four things: print artwork, print cylinders and tools, routes (the order of processes), and templates (the full make-recipe for a product type). Everything here is set up once and reused by many orders.

## Screens and how they connect
- **Artwork Library** (/engineering/artworks) — upload the design file, list front/back colours, enter total ink GSM, and approve. For ROTO print, generate one cylinder per colour slot.
- **Cylinder Catalog** (/engineering/cylinders) — finish generated draft cylinders (vendor, storage location, status) or reuse an existing cylinder of the same repeat and length.
- **Tool Room** (/engineering/tooling) — register of anilox, sleeves, dies, sealing jaws, shafts and other tools with rack/slot and service date.
- **Routing Studio** (/engineering/routing) — the process steps in order, steps that run together (parallel) and joins.
- **Template Studio** (/engineering/templates and /engineering/templates/[id]) — ties a product type (POUCH or ROLL) to a route, batch and lot rules, stage material rules, roll handling, lamination lanes and work-center dispatch, then takes it LIVE.
- **Pending Approvals** (/engineering/approvals) — templates waiting in ENGINEERING review.
- **Route dispatch** (/engineering/route-dispatch) — audit of every template step's allowed work centers, default and release rule.

The flow is: Process Master → Routing Studio → Template Studio → (review, approve, publish LIVE) → Product Master uses the template → Sales order → Planner release. Artwork and cylinders feed the printing step and the ink theory.

## Main flows
**New artwork (FLEXO / DIGITAL)**
1. Artwork Library → "Upload Artwork".
2. Fill Code (e.g. ART-101), Name, file(s), Print Type, Film Type (SHEET = front only, TUBING = front and back).
3. Add colours, enter "Total ink GSM", "Save Draft".
4. Reopen and press "Approve" when "Approval Blockers" is empty.

**New ROTO artwork**
1. As above, plus "Circumference / repeat (mm)" and "Cylinder length (mm)".
2. Press "Generate FRONT 1", "Generate FRONT 2" … for each colour.
3. Cylinder Catalog → "Manage Slots": pick vendor and storage location, press "Finalize this cylinder" per slot; or reuse a matching cylinder with "Use".
4. Back in Artwork Library press "Approve".

**New route**: Routing Studio → "New Route" → name → "Add Step" for each process → mark parallel steps "+ Runs together" → "Save Routing Rule".

**New template**
1. Templates → "New Template" → name, FG Type, Pouch Style → "Create & Open Studio".
2. Section 1: choose routing rule, "Save basics", "Sync route stages".
3. Section 2: batch size, lot prefix, release switches → "Save template execution".
4. Section 4: per stage allowed centers, release rule, default center → "Save dispatch setup".
5. Section 5: map material categories (GRANULE, ADHESIVE, SOLVENT, ADDON, POD) to stages.
6. Section 6: "Send for review" → "Approve" → "Publish LIVE".

**Changing a LIVE template**: press "Edit safely". A correction draft opens; existing orders and jobs stay on the old version. Publish the draft to replace the live one for future orders.

## Rules and limits
- Only APPROVED artwork is valid for production. Editing an approved or in-use artwork creates a new version; old orders keep the old one.
- Maximum 3 artwork files (JPG, PNG, PDF). Ink GSM must be above zero.
- ROTO approval needs a finalized cylinder for every front (and back) slot, with matching repeat and length (0.01 mm tolerance), vendor and TOOLING storage location.
- A route used by a current template or production history cannot change its steps; disable it and make a corrected one.
- A template needs a routing rule and synced stages to be approved or published. Publishing is blocked by missing capability, invalid defaults, or a step with several centers and no decision.
- Only the current LIVE template version appears in sales, planner and Product Master selectors. "Disable" hides a template while keeping history.
- Ink theory comes from artwork GSM, not from template material mapping.

## Who does what
- **Admin / Owner / Super Admin**: everything, including disabling and deleting.
- **Plant Manager / Planner**: view engineering; users with templates.manage or routing.manage can edit templates and routes.
- **Work Center Manager**: can view templates.

## Problems and fixes
- *"Approve" is grey on artwork*: read "Approval Blockers"; usually missing file, ink GSM or finalized cylinders.
- *"Routing sequence and graph are locked…"*: the route is in use. Disable it and create a new route and template version.
- *"Templates cannot be approved or published without a Routing Rule."*: choose a route, Save basics, Sync route stages.
- *"no capable work center is mapped for …"*: add machine capability for the process in Factory setup.
- *Template not in the registry*: the registry lists LIVE and disabled only; drafts are reached from Pending Approvals or the creation link.
- *Reuse list empty in Cylinder Catalog*: no finalized cylinder has the same repeat × length; generate a new one.

## सारांश (हिंदी)
# इंजीनियरिंग module

इंजीनियरिंग तय करता है कि **product कैसे बनेगा**, sales या planner के इस्तेमाल से पहले। इसके चार काम हैं: print artwork, print cylinder और tool, route (process का क्रम), और template (किसी product type को बनाने का पूरा तरीका)। यह सब एक बार सेट होता है और बहुत से order में काम आता है।

## स्क्रीन और उनका जुड़ाव
- **Artwork Library** (/engineering/artworks) — design file upload करें, front/back colour लिखें, कुल ink GSM भरें और approve करें। ROTO print में हर colour slot का cylinder यहीं बनता है।
- **Cylinder Catalog** (/engineering/cylinders) — बने draft cylinder को पूरा करें (vendor, storage location, status) या उसी repeat और length का पुराना cylinder लगाएँ।
- **Tool Room** (/engineering/tooling) — anilox, sleeve, die, sealing jaw, shaft आदि की सूची, rack/slot और service तारीख के साथ।
- **Routing Studio** (/engineering/routing) — process का क्रम, साथ चलने वाले step (parallel) और join।
- **Template Studio** (/engineering/templates और /engineering/templates/[id]) — product type (POUCH या ROLL) को route, batch और lot rule, stage material rule, roll handling, lamination lane और work-center dispatch से जोड़ता है, फिर LIVE करता है।
- **Pending Approvals** (/engineering/approvals) — ENGINEERING review में रुके template।
- **Route dispatch** (/engineering/route-dispatch) — हर template step के allowed work center, default और release rule की जाँच।

क्रम: Process Master → Routing Studio → Template Studio → (review, approve, publish LIVE) → Product Master template इस्तेमाल करता है → Sales order → Planner release। Artwork और cylinder printing step और ink theory में काम आते हैं।

## मुख्य काम
**नया artwork (FLEXO / DIGITAL)**
1. Artwork Library → "Upload Artwork"।
2. Code (जैसे ART-101), Name, file, Print Type, Film Type (SHEET = सिर्फ front, TUBING = front और back) भरें।
3. Colour जोड़ें, "Total ink GSM" भरें, "Save Draft"।
4. फिर खोलें, "Approval Blockers" खाली हो तो "Approve"।

**नया ROTO artwork**
1. ऊपर जैसा, साथ में "Circumference / repeat (mm)" और "Cylinder length (mm)"।
2. हर colour के लिए "Generate FRONT 1", "Generate FRONT 2" … दबाएँ।
3. Cylinder Catalog → "Manage Slots": vendor और storage location चुनें, हर slot पर "Finalize this cylinder"; या मिलता cylinder "Use" से लगाएँ।
4. Artwork Library में लौटकर "Approve"।

**नया route**: Routing Studio → "New Route" → नाम → हर process के लिए "Add Step" → साथ चलने वाले step को "+ Runs together" करें → "Save Routing Rule"।

**नया template**
1. Templates → "New Template" → नाम, FG Type, Pouch Style → "Create & Open Studio"।
2. Section 1: routing rule चुनें, "Save basics", "Sync route stages"।
3. Section 2: batch size, lot prefix, release switch → "Save template execution"।
4. Section 4: हर stage के allowed center, release rule, default center → "Save dispatch setup"।
5. Section 5: material category (GRANULE, ADHESIVE, SOLVENT, ADDON, POD) को stage से जोड़ें।
6. Section 6: "Send for review" → "Approve" → "Publish LIVE"।

**LIVE template बदलना**: "Edit safely" दबाएँ। Correction draft खुलता है; पुराने order और job पुराने version पर रहते हैं। Draft publish करने पर आगे के order नए version से चलेंगे।

## नियम और सीमाएँ
- Production में सिर्फ APPROVED artwork चलता है। Approved या इस्तेमाल हो रहे artwork को बदलने पर नया version बनता है; पुराने order पुराना रखते हैं।
- ज़्यादा से ज़्यादा 3 artwork file (JPG, PNG, PDF)। Ink GSM 0 से ज़्यादा होना चाहिए।
- ROTO approve के लिए हर front (और back) slot का finalize cylinder चाहिए — repeat और length मिलें (0.01 mm छूट), vendor और TOOLING storage location हो।
- जो route चालू template या production history में लगा है, उसके step नहीं बदलते; उसे disable करके सुधरा route बनाएँ।
- Template approve या publish के लिए routing rule और sync stage ज़रूरी हैं। Capability न हो, default गलत हो, या कई center वाले step का फैसला न हो तो publish रुकता है।
- Sales, planner और Product Master में सिर्फ चालू LIVE template दिखता है। "Disable" template को छिपाता है पर history रखता है।
- Ink theory artwork GSM से आती है, template material mapping से नहीं।

## कौन क्या करता है
- **Admin / Owner / Super Admin**: सब कुछ, disable और delete भी।
- **Plant Manager / Planner**: इंजीनियरिंग देख सकते हैं; templates.manage या routing.manage अनुमति वाले template और route बदल सकते हैं।
- **Work Center Manager**: template देख सकते हैं।

## समस्या और हल
- *Artwork पर "Approve" grey*: "Approval Blockers" पढ़ें; अक्सर file, ink GSM या finalize cylinder बाकी होता है।
- *"Routing sequence and graph are locked…"*: route इस्तेमाल में है। Disable करें और नया route व template version बनाएँ।
- *"Templates cannot be approved or published without a Routing Rule."*: route चुनें, Save basics, Sync route stages।
- *"no capable work center is mapped for …"*: Factory setup में उस process की machine capability जोड़ें।
- *Template सूची में नहीं दिखता*: सूची में सिर्फ LIVE और disabled आते हैं; draft Pending Approvals या बनाने वाले link से खुलता है।
- *Cylinder Catalog में reuse सूची खाली*: उसी repeat × length का finalize cylinder नहीं है; नया बनाएँ।

## Every screen (English)

### Engineering Hub (/dashboard/engineering)
Screen address: /dashboard/engineering · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANNER · Share link: https://erp.totalpolyprint.com/guide?page=dashboard-engineering

A short view of engineering work: artworks waiting for approval, cylinders in maintenance or re-chrome, templates not yet live, and route coverage.

Open it to see what blocks new jobs from engineering's side. Artwork must be APPROVED before the planner can assign it, and only LIVE templates with a route can be planned. Each item links to the Artworks, Cylinders or Templates page where the work is actually done.

**Before you start**
- Artwork, cylinder and template records exist.

**Step by step**
1. Read the four tiles: "Pending Artworks" (draft / approval), "Cylinder Attention" (maintenance / rechrome), "Templates To Finish" (not live) and "Live Templates" (with active routes).
2. In "Approvals Queue" press "Review" on an item to open its artwork or template.
3. Check "Catalog Health": share of current artworks that are cylinder-ready and share of templates that have a route.
4. Press "New Artwork" or "New Cylinder" to go to the Artworks or Cylinders list and add the record there.

**What is on the screen**
- **Pending Artworks**: Artworks in DRAFT or PENDING_APPROVAL. These cannot be assigned to orders yet.
- **Cylinder Attention**: Cylinders in MAINTENANCE or RE_CHROME status.
- **Templates To Finish**: Templates in DRAFT, ENGINEERING or APPROVED, not yet LIVE.
- **Live Templates**: LIVE templates; the note shows how many active routes exist.
- **Approvals Queue**: Up to a few pending artworks and unfinished templates, with design code, status and linked route.
- **Catalog Health**: Artworks: share cylinder-ready. Routes: share of templates with a routing rule.

**Common problems and fixes**
- "Tile shows "—" and "Unavailable"" — That list could not be loaded (for example no permission or a server error). The other tiles still work. Reload the page.
- "No engineering queue" — No artwork or template is waiting for a decision. Nothing to do.

**If stuck**
1. Approve the artwork on the Artworks page, then the planner can assign it from Plan queue.
2. Make a template LIVE with a route on the Templates page before orders can be planned on it.

Related pages: /engineering/artworks, /engineering/cylinders, /engineering/templates, /engineering/routing, /dashboard/planner/control-tower/plan-queue

**Not done yet / watch out**
- "New Artwork" and "New Cylinder" only open the Artworks and Cylinders lists; they do not open a create form.
- The Engineering Hub has no sidebar entry; it is reached only by address or the Products workspace.

### Engineering (/engineering)
Screen address: /engineering · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, PLANNER · Share link: https://erp.totalpolyprint.com/guide?page=engineering

This address has no screen of its own. It opens the Artwork Library (/engineering/artworks) straight away.

Use it as a short link into engineering. Templates, routes and dispatch are under the Products workspace tabs "Templates", "Routing studio" and "Route dispatch"; print items under "Artworks", "Cylinders" and "Tool room".

**Before you start**
- Engineering view permission (Admin, Owner, Plant Manager or Planner).

**Step by step**
1. Open /engineering — you land on "Artwork Library".
2. Use the Products workspace tabs to go to "Templates", "Routing studio", "Route dispatch", "Cylinders" or "Tool room".

**If stuck**
1. If the artwork page does not open, your role may not have engineering view rights; ask the admin.

Related pages: /engineering/artworks, /engineering/templates, /engineering/routing, /engineering/cylinders

### Pending Approvals (/engineering/approvals)
Screen address: /engineering/approvals · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, PLANNER · Share link: https://erp.totalpolyprint.com/guide?page=engineering-approvals

A review queue of templates that are in ENGINEERING review. Each row shows the template, its route and an "Approve" button.

Open it when a template has been sent for review from Template Studio ("Send for review"). Approve it here or press "Review" to check it in Template Studio. After approval the template still has to be published with "Publish LIVE" in Template Studio before sales and the planner can use it.

**Before you start**
- Template status ENGINEERING (sent for review from Template Studio).
- A routing rule linked and route stages synced, else approval is blocked.

**Step by step**
1. Read the "Review Queue". Use "Search pending..." to find a template by name.
2. Check "Route & Integrity": "Route Bound" means a route is linked; "No Routing Rule" in red means it is not.
3. Press "Review" to open the template in Template Studio and check stages, dispatch and materials.
4. Press "Approve" (shows "Signing..." while saving). The toast "Approved" confirms it.
5. Open the template in Template Studio and press "Publish LIVE" to make it usable.

**What is on the screen**
- **Product Snapshot**: Template name, FG type (POUCH or ROLL), linked route name (or "Unassigned") and the first 8 characters of the template id.
- **Route & Integrity**: "Route Bound" / "Routing Info" when a route is linked; "No Route" / "No Routing Rule" when not. Material mapping and roll policy are kept in Template Studio, not here.
- **Decision**: "Review" opens Template Studio; "Approve" moves the template from ENGINEERING to APPROVED.

**Common problems and fixes**
- "Approval Failed — Templates cannot be approved or published without a Routing Rule." — No route is linked. Open "Review", choose a "Routing rule", press "Save basics" and "Sync route stages", then approve.
- "Approval Failed — Template must be in ENGINEERING review before approval." — Someone already approved or changed it. Refresh the page; the row will disappear when it is no longer in review.
- "Approval Failed — Step N …: no capable work center is mapped for …" — A route stage has no machine/work center that can run its process. Add the capability in Factory setup, or fix dispatch in Template Studio section "4. Template route dispatch".

**If stuck**
1. If "No pending approvals" shows but you expect a template, it is still in DRAFT; open it in Template Studio and press "Send for review".
2. Approving does not make it LIVE. Use "Publish LIVE" in Template Studio.

Related pages: /engineering/templates, /engineering/templates/[id], /engineering/approvals/[id]

**Not done yet / watch out**
- APPROVED templates waiting for "Publish LIVE" are not listed anywhere as a queue.

### Review: template (Approval Console Retired) (/engineering/approvals/[id])
Screen address: /engineering/approvals/[id] · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, PLANNER · Share link: https://erp.totalpolyprint.com/guide?page=engineering-approvals-id

An old review screen. It now only says "Approval Console Retired" and gives a button "Open Template Studio".

Old links still lead here. Technical approval is no longer separate; templates now hold only route, step category mapping and roll policy. Continue the work in Template Studio.

**Before you start**
- A valid template id in the address.

**Step by step**
1. Read the card "Approval Console Retired".
2. Press "Open Template Studio" to continue on /engineering/templates/[id].
3. Use the back arrow to return to where you came from.

**What is on the screen**
- **Header "Review: <name>"**: Shows the template name and its FG type.

**Common problems and fixes**
- "Template Not Found" — The id is wrong or the template was deleted. Press "Go back" and open it from Template Studio.

**If stuck**
1. Always approve from Pending Approvals or from Template Studio, not from this page.

Related pages: /engineering/templates/[id], /engineering/approvals

**Not done yet / watch out**
- The old approval detail page is retired and only links to Template Studio; old links still lead here.

### Artwork Library (/engineering/artworks)
Screen address: /engineering/artworks · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, PLANNER · Share link: https://erp.totalpolyprint.com/guide?page=engineering-artworks

Gallery of print artworks with thumbnails, front/back colours, print type, film type, ink GSM and cylinder readiness. Upload, revise and approve artworks here.

Open it when a new design comes in or a design changes. Only APPROVED artwork is valid for production. For ROTO print, cylinders for each colour slot are generated here and finished in the Cylinder Catalog before approval.

**Before you start**
- The production file: JPG, PNG or PDF (max 3 files).
- Colour list per side and total ink GSM.
- For ROTO: cylinder repeat (circumference) and length; engraving vendors and TOOLING storage locations in masters.

**Step by step**
1. Press "Upload Artwork" (or click a card to revise it).
2. Fill "Code" (e.g. ART-101) and "Name". Pick files under "Artwork Images (max 3)".
3. Choose "Print Type" (FLEXO, ROTO, DIGITAL) and "Film Type" (SHEET = front only, TUBING = front and back).
4. Add colours with "Add Front Color" / "Add Back Color". Counts are set automatically.
5. Enter "Total ink GSM".
6. ROTO only: enter "Circumference / repeat (mm)" and "Cylinder length (mm)", then press "Generate FRONT 1", "Generate FRONT 2" … for each colour slot.
7. Press "Save Draft". For ROTO, finish the generated drafts in Cylinder Catalog (vendor, location, Finalize).
8. Reopen the card. When "Approval Blockers" is empty, press "Approve". The toast "Artwork Approved" confirms it.

**What is on the screen**
- **Total Assets / Approved / Pending / Cylinder Ready**: Counts for the artworks shown after search. "Cylinder Ready" = every colour slot has a finalized cylinder.
- **Search**: Matches design code, artwork name, print type, film type or status.
- **Card badges**: Status (APPROVED, PENDING APPROVAL, …) and "Cylinder mapped" or "Mapping pending".
- **Front / Back**: Number of colours per side, e.g. F4 / B1.
- **Print / Film**: Print type and film type (SHEET or TUBING).
- **Color Identity**: First 6 colour names of the artwork.
- **Ink GSM**: Total ink laydown for the whole artwork; used for the theory BOM. Must be more than 0 to approve.
- **Cylinder specs**: ROTO only. One repeat and one length for the artwork. Reusing a cylinder needs both to match.
- **ROTO Readiness Checklist**: PASS/BLOCK lines: file uploaded, colours, ink GSM, repeat, length, colour counts, finalized front/back slots, technical details.
- **Cylinder generation by color**: One button per colour slot. A covered slot shows "Covered" and cannot make another cylinder.
- **Revise Artwork**: Editing an approved or in-use artwork saves a NEW draft version (badge "NEW DRAFT"); old orders keep the old version.

**Common problems and fixes**
- "Approval Failed (ARTWORK_APPROVAL_BLOCKED) — Cannot approve artwork without an uploaded file/image asset." — No file attached. Pick a JPG, PNG or PDF, press "Save Draft", then approve.
- "Artwork: total ink GSM must be greater than zero." — Enter "Total ink GSM" before approval.
- "Artwork: sheet film supports front colors only." — Back colours were set on SHEET film. Use TUBING or remove back colours.
- "ROTO approval blocked: finalized front cylinders missing for slots [..]." — Some colour slots have no finalized cylinder. Generate or reuse them and press "Finalize this cylinder" in Cylinder Catalog → "Manage Slots".
- "ROTO approval blocked: cylinder circumference must match artwork repeat for slots [..]." — A cylinder's repeat differs from the artwork repeat (0.01 mm tolerance). Fix the spec or use a matching cylinder.
- "Cylinder generation failed — Enter artwork cylinder circumference before generating cylinders." — Fill repeat and length first.
- "Upload a maximum of 3 artwork images. / Only 3 images kept" — Only the first 3 files are kept.

**If stuck**
1. If the "Approve" button is grey, read the red "Approval Blockers" list and fix each line.
2. If a thumbnail shows only an icon, the image could not load; open the card and re-upload under "Replace artwork assets".
3. Use the refresh icon ("Force Refresh") in the dialog if cylinder status looks old.

Related pages: /engineering/cylinders, /master/products, /engineering/tooling

**Not done yet / watch out**
- The artwork gallery has no filter by status or print type other than free-text search, and no delete or retire action.

### Cylinder Catalog (/engineering/cylinders)
Screen address: /engineering/cylinders · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, PLANNER · Share link: https://erp.totalpolyprint.com/guide?page=engineering-cylinders

ROTO print cylinders grouped by artwork. Each artwork card shows its colour slots, how many are covered, draft and ready counts, and reused cylinders.

Open it after generating draft cylinders on an artwork, or to reuse an existing cylinder for a new design. Each slot must have a finalized cylinder (vendor + storage location) before the ROTO artwork can be approved.

**Before you start**
- Artwork saved with colours, repeat and length.
- Vendors in master data and storage locations of type TOOLING.

**Step by step**
1. Search the artwork (code, name, colour, cylinder code) and press "Manage Slots" on its card.
2. In "1. Artwork cylinder spec" check "Circumference / repeat" and "Cylinder length".
3. For an empty slot either press "Generate new for this color", or pick from "Reuse matching cylinder" and press "Use".
4. In "2. Finish generated drafts" select engraving vendor, storage location and status (ACTIVE / MAINTENANCE / SCRAP); diameter and cell depth if known.
5. On each draft slot press "Finalize this cylinder". The slot turns "Ready" and shows "Slot complete".
6. Go back to Artwork Library and press "Approve" on the artwork.
7. To change one cylinder later, press "Edit cylinder" (or "New Cylinder" for a loose one) and press "Update" / "Create".

**What is on the screen**
- **Total Cylinders / Draft / Production Ready / Service Focus**: Slot counts for shown artworks; Service Focus = cylinders in MAINTENANCE or RE_CHROME.
- **x/y covered**: Slots with any cylinder out of all colour slots.
- **Empty Slots / Ready / Draft / Reuse**: Reuse = slots using a cylinder that belongs to another artwork.
- **Slot status**: "Empty slot", "Draft generated", "Ready" or "Reused ready".
- **Matching reuse pool**: Finalized, active cylinders with vendor and location whose repeat and length match within 0.01 mm. Vendor can be any.
- **Lifecycle Mode / Lifecycle Status / Operational Status**: In the cylinder dialog: DRAFT or PRODUCTION; final status ACTIVE, MAINTENANCE or SCRAP.
- **Side / Side Slot #**: FRONT or BACK and the colour position. Cannot be more than the artwork's colour count for that side.

**Common problems and fixes**
- "Finalization blocked — Select engraving vendor before finalizing. / Select storage location before finalizing." — Choose both in "2. Finish generated drafts" first.
- "Enter circumference / repeat before using cylinder slots." — Repeat and length are needed before generate, reuse or finalize.
- "Reuse failed — Reusable cylinder circumference must match the artwork repeat (… mm)." — Pick a cylinder of the same repeat and length.
- "Only finalized cylinders can be reused for artwork slots." — A draft cylinder cannot be reused; finalize it on its own artwork first.
- "Finalize cylinder blocked: artwork already has a finalized cylinder for FRONT-n." — That slot is already covered. Edit the existing cylinder instead.
- "Storage location must be a TOOLING location." — Only TOOLING-type locations are allowed; create one in location master.
- "Requested FRONT-n exceeds artwork color slots." — The artwork has fewer colours. Fix colours on the artwork.

**If stuck**
1. If "Finalize this cylinder" is grey, vendor or location or repeat/length is missing.
2. If the reuse list is empty, no finalized cylinder has the same repeat × length; generate a new one.

Related pages: /engineering/artworks, /engineering/tooling

**Not done yet / watch out**
- Cylinder status MAINTENANCE/RE_CHROME is counted as "Service Focus" but is not connected to the Maintenance module.

### Work-center setup by template (Route dispatch) (/engineering/route-dispatch)
Screen address: /engineering/route-dispatch · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, PLANNER · Share link: https://erp.totalpolyprint.com/guide?page=engineering-route-dispatch

Audit of every template route step: which work centers may run it, the default center and the release rule. Shows steps that need setup.

Use it to find steps the planner cannot release (no capability, no default, invalid center). New templates and correction drafts are best set in Template Studio section "4. Template route dispatch"; this page is an audit and legacy backfill view. Live templates are locked here — use "Edit safely".

**Before you start**
- Templates with synced route steps.
- Machines/work centers with process capability set in Factory.

**Step by step**
1. Read the tiles "Templates", "Route steps", "Need setup", "No capability".
2. Filter with "Search template, process, or route step...", the status list (e.g. "Needs decision", "No capability") and the process list. "Clear filters" resets.
3. Optionally press "Backfill missing steps" to auto-fill steps that have only one possible center.
4. For a LIVE template press "Edit safely" — a correction draft opens in Template Studio.
5. For a draft template: tick allowed centers (or "Allow all"), pick "Default work center", choose "Release rule".
6. Set "Planner optional" or "WCM skip after output" if the process allows it.
7. Press "Save step". The toast "Route step saved" confirms it.

**What is on the screen**
- **Step status**: "Ready", "Auto ready", "Planner chooses", "Choose center", "No capability", "Invalid allowed", "Invalid default".
- **Allowed centers**: Capable centers ticked for this step. All ticked = every capable center is allowed.
- **Default work center**: Center used at release when the rule is "Always use default".
- **Release rule**: "Auto when only one", "Always use default", or "Planner chooses at release".
- **Planner optional**: Shows a skip choice when the planner releases or replans. Only if the Process Master allows it.
- **WCM skip after output**: Lets the work-center manager skip this step for one produced batch after prior output.
- **Edit safely / Disable**: Edit safely creates a correction draft of a LIVE template. Disable hides the template from all live selectors (asks to confirm).

**Common problems and fixes**
- "Allowed work center is not capable for <process>: …" — A ticked center cannot run this process. Untick it or add capability in Factory.
- "Default work center cannot run <process>." — Choose a capable center as default.
- "<process> is not planner-optional-capable in Process Master." — Turn on that option in the Process Master first.
- "No work center currently has capability for this process." — Map the process to a machine in Factory setup, then come back.
- "This template is live and locked." — Press "Edit safely" to create a correction draft.

**If stuck**
1. "Save step" shows "Saved" and stays grey until you change something.
2. If "Route dispatch setup could not be loaded." appears, refresh; if it repeats tell the admin.

Related pages: /engineering/templates/[id], /engineering/templates, /factory/processes

**Not done yet / watch out**
- Dispatch can be edited both here and in Template Studio section 4; the studio says this page is only an audit and legacy backfill view.
- "Backfill missing steps" runs immediately without a dry-run preview or confirmation.

### Routing Studio (/engineering/routing)
Screen address: /engineering/routing · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, PLANNER · Share link: https://erp.totalpolyprint.com/guide?page=engineering-routing

Defines how production moves: the ordered process steps, steps that run together (parallel + branches) and joins. Nothing about batches or materials.

Create a route before building a template. A template picks one route. Once a route is used by a current template or by production history, its steps are locked; disable it and make a new one instead.

**Before you start**
- Processes in the Process Master (Factory → Processes).
- Routing or template manage permission to create, edit, disable or delete.

**Step by step**
1. Press "New Route".
2. Enter "Route Name" (e.g. Standard 3-Layer PE) and "Description".
3. In "1. Route steps" press "Add Step" and select each process in order; use the arrows to move.
4. In the flow builder, for a step that runs at the same time as the one before, press "↓ Starts after previous" so it turns "+ Runs together".
5. Check the preview: Stage 1, Stage 2 … with "+ parallel" rows. The next stage waits for every process in a parallel row.
6. Set "Interplant Logistics?" if the route moves between plants; keep "Active Status" on.
7. Press "Save Routing Rule". Toast "Routing Rule created."
8. Use the ⋯ menu on a card for "Edit", "Disable" or "Delete".

**What is on the screen**
- **Active / Disabled / All**: Filter buttons with counts.
- **Search routing rules**: Search by route, process or description.
- **Card badges**: "Inactive", "Interplant", stage count, "n + branches" or "straight flow", "flow only".
- **Runs together / Starts after previous**: Puts a step in the same stage as the one before (parallel) or in the next stage.
- **Interplant Logistics?**: Marks routes that need movement between plants.
- **Active Status**: Off = hidden from new template selectors.

**Common problems and fixes**
- "Routing sequence and graph are locked by current templates or production history." — Steps cannot change once used. Disable the old route/template and create a corrected route and template version.
- "Disable linked templates or create a corrected route first: …" — Delete is blocked while current templates use the route. Disable those templates or use "Disable" on the route.
- "Mark the routing rule inactive instead, or move dependent templates to another route first." — Jobs or old templates still refer to it; use "Disable".
- "Unknown Process code(s): … Create or select the Process Master before saving the route." — Create the process in Factory → Processes first.
- "Routing or template manage permission is required …" — Your role cannot change routes; ask the admin.

**If stuck**
1. If "No routing rules in this view." shows, switch to "All" or clear the search.
2. Batch size, lot prefix and release rules are not here; set them in Template Studio.

Related pages: /engineering/templates, /engineering/templates/[id], /factory/processes

**Not done yet / watch out**
- A route in use cannot be edited; the only path is disable and create a new route plus new template versions.

### Template Studio (template registry) (/engineering/templates)
Screen address: /engineering/templates · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, PLANNER, WORK_CENTER_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=engineering-templates

List of route templates (LIVE or Disabled) with type, business family and status. Create a new template and open it in the studio.

A template ties a product type (POUCH or ROLL) to a route, stage material rules, roll handling and batch rules. Only the current LIVE version can be chosen in sales, planner and Product Master. Work starts here, continues in Template Studio, and ends with "Publish LIVE".

**Before you start**
- A routing rule (Routing Studio).
- Templates manage permission to create or clean drafts.

**Step by step**
1. Press "New Template".
2. In "Create Route Template" enter "Template Name" (e.g. Pouch Route) and choose "FG Type" POUCH or ROLL.
3. For POUCH choose "Pouch Style" (Three Side Seal, Pillow, Stand Up, Side Gusset, Quad Seal, Flat Bottom, Spout, Shaped).
4. Optionally choose "Business Family" and "Routing Rule".
5. Press "Create & Open Studio" — the new draft opens in Template Studio.
6. To open an existing one, search by name or id and press "Studio".
7. Use "Clean drafts" to delete unused draft/review templates (asks to confirm).

**What is on the screen**
- **Total / Live / Disabled / Routes**: Counts of templates and routing rules.
- **Live / Disabled filter**: Shows LIVE templates or disabled (OBSOLETE) ones.
- **Template**: Name, short id and linked route ("not linked" if none).
- **Type / Business Family / Status**: POUCH or ROLL; family alias; Draft, Engineering, Approved, Live, Disabled or Correction draft.
- **Template Schema Warning**: Shown when the server's template tables are out of date; tell the admin.

**Common problems and fixes**
- "Create failed — Template name is required." — Type a name before pressing "Create & Open Studio".
- "Pouch templates must declare a pouch style." — Choose a "Pouch Style" for POUCH.
- "Template registry could not load." — Server or schema problem; refresh, then tell the admin with the message shown.

**If stuck**
1. Drafts are not listed here. Find a draft through Pending Approvals or by the link you were sent, or create a new one.
2. Only the first matches are shown; narrow with search if the list says "Showing first …".

Related pages: /engineering/templates/[id], /engineering/routing, /engineering/approvals, /master/products

**Not done yet / watch out**
- The template registry only lists LIVE and disabled templates; DRAFT, ENGINEERING and APPROVED templates do not appear, so a draft can only be reached from Pending Approvals, a saved link or the create dialog.

### Template Studio · execution rules (/engineering/templates/[id])
Screen address: /engineering/templates/[id] · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, PLANNER · Share link: https://erp.totalpolyprint.com/guide?page=engineering-templates-id

Builds one template: route binding, batch and lot rules, route stages and lamination lanes, work-center dispatch, step material rules, then review and make LIVE.

Open it from the registry, from Pending Approvals or right after creating a template. The lifecycle is DRAFT → ENGINEERING → APPROVED → LIVE → OBSOLETE. LIVE templates are locked; "Edit safely" opens a correction draft, and existing orders and jobs stay on the old version until the draft is published.

**Before you start**
- A routing rule with valid processes.
- Work centers with capability for every route process.
- Material categories in masters (GRANULE, ADHESIVE, SOLVENT, ADDON, POD).

**Step by step**
1. "1. Basics and route binding": choose "Routing rule" and "Business family", press "Save basics", then "Sync route stages".
2. "2. Batch and lot execution": fill "Batch size KG", "Batch size PCS", "Lot prefix" and the release switches; press "Save template execution".
3. "3. Route stages": check each stage and lamination Lane A / Lane B.
4. "4. Template route dispatch": per stage set allowed centers, "Release rule", "Default work center", optional "Dispatch note"; press "Save dispatch setup".
5. "5. Step material rules": map each material category to a stage and set Basis, Formula, Issue, Value and Close.
6. Check "Template readiness" and "Review gate"; fix every "Fix:" line.
7. "6. Review and make live": press "Send for review", then "Approve", then "Publish LIVE" (the button label changes with status).
8. To change a LIVE template press "Edit safely"; to copy press "Duplicate" / "Create working copy"; to retire press "Disable" (confirm).

**What is on the screen**
- **Template readiness**: Percent of stages with material policy, pills "Basics saved", route, stage count, "Ready for live" / "Review needed".
- **Lifecycle**: DRAFT (Editable), ENGINEERING (Peer checks rules), APPROVED (Locked for publish), LIVE (Used by planner), OBSOLETE (Retired).
- **Batch size KG / PCS, Lot prefix**: Default batch size for new releases and the lot number prefix (AUTO if empty).
- **Auto create batches**: Create live production batches when the planner releases the line.
- **Allow partial movement**: Part of a batch can move on while the balance stays open.
- **Release + branches together**: Starts parallel branches without a second manual release.
- **Match all before next stage**: A join stage waits until every input branch is complete.
- **Release rule**: "Auto when one center", "Use selected default", "Planner chooses at release".
- **Planner may skip at release / WCM may skip after previous output**: Optional-step switches, only when the Process Master allows.
- **Output handling (Thickness, Output capture)**: Thickness: Inherit input, Sum inputs, Fixed, Template default. Capture: Process default, Single roll, Multi roll, Split grid, Discrete only, Bulk KG + PCS, Bulk KG only. Width comes from order size.
- **Material mapping: Basis / Issue / Close**: Basis: Snapshot GSM, Master formula, Fixed KG, Fixed PCS. Issue: No uplift, percent over theory, Fixed extra kg, Minimum issue kg. Close: Auto from output, Estimate + confirm, Operator required. Ink theory comes from artwork GSM.

**Common problems and fixes**
- "Sync workflow first. A LIVE template must contain at least one active route step." — Press "Sync route stages" after choosing the route.
- "Cannot change routing on a LIVE template." — Use "Edit safely" to get a correction draft.
- "Template must be APPROVED before it can be published LIVE." — Send for review and approve first.
- "LIVE templates are read-only. Clone a new version first." — Use "Edit safely".
- "Step N …: choose a default work center or set Planner chooses at release." — More than one capable center and no decision. Fix in section 4.
- "Step N …: lamination needs two input lanes." — Set Input lanes to 2 in the lamination stage.
- "Routing Rule contains missing Process code(s): … Route steps were not changed." — The route uses a process that no longer exists; fix the route or Process Master.
- "ADDON category must use CATEGORY_FORMULA. / POD category must use CATEGORY_FORMULA." — For ADDON and POD pick Basis "Master formula" with formula "Addon master" / "POD profile".

**If stuck**
1. All inputs grey and "Live / locked"? Press "Edit safely".
2. "No route stages yet"? Choose a routing rule, "Save basics", then "Sync route stages".
3. A correction draft replaces the live template only after "Publish LIVE"; old orders keep the original.

Related pages: /engineering/templates, /engineering/routing, /engineering/route-dispatch, /engineering/approvals, /master/products

### Tool Room (/engineering/tooling)
Screen address: /engineering/tooling · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, PLANNER · Share link: https://erp.totalpolyprint.com/guide?page=engineering-tooling

Register of plant tools other than cylinders: anilox, sleeves, cutting dies, sealing jaws, core shafts, mounting adapters and others, with rack/slot, vendor and service due date.

Use it to know where a tool is kept and when it needs service. It is a register only; it does not block production.

**Before you start**
- Plant set up; a TOOLING storage location for the tool room (optional).

**Step by step**
1. Press "Add Tool".
2. In "Create Tool Asset" pick "Plant" and "Asset Type", fill "Code" and "Name", choose "Status".
3. Fill "Rack" (e.g. Rack-A) and "Slot" (e.g. S-04), "Storage Location" and "Vendor".
4. Set "Service Due" date and "Notes"; press "Save".
5. Use "Edit" on a card to update; "Delete" removes it.

**What is on the screen**
- **Tracked Tools / Ready / Service Due / Retired**: Counts by status.
- **Asset Type**: ANILOX, SLEEVE, CUTTING_DIE, SEALING_JAW, CORE_SHAFT, MOUNTING_ADAPTER, TOOLING_OTHER.
- **Status**: READY, IN_USE, SERVICE_DUE, MAINTENANCE, RETIRED.
- **Storage / Rack / Slot**: Where the tool sits.
- **Service Due**: Next service date (reminder only).

**Common problems and fixes**
- "Storage location must belong to the same plant." — Pick a location of the selected plant.
- "Storage location must be a TOOLING location." — Only TOOLING-type locations are allowed.

**If stuck**
1. "Delete" has no confirmation; prefer status RETIRED to keep history.

Related pages: /engineering/cylinders, /maintenance/schedules

**Not done yet / watch out**
- "Delete" on a tool asset has no confirmation prompt.
- Tool "Service Due" dates do not create maintenance jobs or reminders; Tool Room and Maintenance schedules are not linked.

## हर स्क्रीन (हिंदी)

### Engineering Hub (/dashboard/engineering)
स्क्रीन का पता: /dashboard/engineering · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANNER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=dashboard-engineering&lang=hi

engineering के काम का छोटा नज़ारा: approval के इंतज़ार में artwork, maintenance या re-chrome में cylinder, जो template अभी live नहीं हैं, और route coverage।

engineering की तरफ़ से नए job किस वजह से रुके हैं, यह देखने के लिए खोलें। planner artwork तभी लगा सकता है जब वह APPROVED हो, और सिर्फ़ route वाले LIVE template ही plan होते हैं। हर item Artworks, Cylinders या Templates पेज पर ले जाता है, जहाँ असली काम होता है।

**शुरू करने से पहले**
- artwork, cylinder और template के record मौजूद हों।

**स्टेप बाय स्टेप**
1. चार tile पढ़ें: "Pending Artworks" (draft / approval), "Cylinder Attention" (maintenance / rechrome), "Templates To Finish" (live नहीं) और "Live Templates" (active route के साथ)।
2. "Approvals Queue" में किसी item पर "Review" दबाकर उसका artwork या template खोलें।
3. "Catalog Health" देखें: कितने artwork cylinder-ready हैं और कितने template का route है।
4. "New Artwork" या "New Cylinder" दबाकर Artworks या Cylinders सूची पर जाएँ और वहीं record जोड़ें।

**स्क्रीन पर क्या है**
- **Pending Artworks**: DRAFT या PENDING_APPROVAL वाले artwork। ये अभी order पर नहीं लग सकते।
- **Cylinder Attention**: MAINTENANCE या RE_CHROME status वाले cylinder।
- **Templates To Finish**: DRAFT, ENGINEERING या APPROVED template, जो अभी LIVE नहीं।
- **Live Templates**: LIVE template; नीचे लिखा है कितने active route हैं।
- **Approvals Queue**: कुछ pending artwork और अधूरे template, design code, status और जुड़े route के साथ।
- **Catalog Health**: Artworks: कितने cylinder-ready। Routes: कितने template पर routing rule है।

**आम दिक्कतें और हल**
- "tile में "—" और "Unavailable"" — वह सूची load नहीं हुई (जैसे permission नहीं या server error)। बाकी tile चलते हैं। पेज reload करें।
- "No engineering queue" — कोई artwork या template फ़ैसले के इंतज़ार में नहीं। कुछ करना नहीं है।

**अटक गए तो**
1. Artworks पेज पर artwork approve करें, फिर planner Plan queue से उसे लगा सकता है।
2. Templates पेज पर template को route के साथ LIVE करें, तभी उस पर order plan होंगे।

जुड़े पेज: /engineering/artworks, /engineering/cylinders, /engineering/templates, /engineering/routing, /dashboard/planner/control-tower/plan-queue

**अभी नहीं होता / ध्यान दें**
- "New Artwork" और "New Cylinder" सिर्फ़ Artworks और Cylinders सूची खोलते हैं; बनाने का form नहीं खोलते।
- Engineering Hub का sidebar entry नहीं; सिर्फ़ पते से या Products workspace से खुलता है।

### इंजीनियरिंग (/engineering)
स्क्रीन का पता: /engineering · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, PLANNER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=engineering&lang=hi

इस पते की अपनी कोई स्क्रीन नहीं है। यह सीधे Artwork Library (/engineering/artworks) खोल देता है।

इसे इंजीनियरिंग का छोटा रास्ता समझें। Template, route और dispatch, Products workspace के "Templates", "Routing studio" और "Route dispatch" tab में हैं; print का काम "Artworks", "Cylinders" और "Tool room" में है।

**शुरू करने से पहले**
- इंजीनियरिंग देखने की अनुमति (Admin, Owner, Plant Manager या Planner)।

**स्टेप बाय स्टेप**
1. /engineering खोलें — आप "Artwork Library" पर पहुँच जाएँगे।
2. Products workspace के tab से "Templates", "Routing studio", "Route dispatch", "Cylinders" या "Tool room" पर जाएँ।

**अटक गए तो**
1. अगर artwork पेज नहीं खुलता तो आपके role को engineering देखने की अनुमति नहीं है; admin से पूछें।

जुड़े पेज: /engineering/artworks, /engineering/templates, /engineering/routing, /engineering/cylinders

### बाकी Approvals (/engineering/approvals)
स्क्रीन का पता: /engineering/approvals · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, PLANNER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=engineering-approvals&lang=hi

ENGINEERING review में पड़े templates की सूची। हर लाइन में template, उसका route और "Approve" बटन है।

जब Template Studio से कोई template "Send for review" किया गया हो तब यह पेज खोलें। यहीं "Approve" करें या "Review" दबाकर Template Studio में देखें। Approve के बाद भी template को Template Studio में "Publish LIVE" करना पड़ता है, तभी sales और planner उसे इस्तेमाल कर सकते हैं।

**शुरू करने से पहले**
- Template का status ENGINEERING हो (Template Studio से review के लिए भेजा गया)।
- Routing rule जुड़ा हो और route stages sync हों, वरना approval रुक जाएगा।

**स्टेप बाय स्टेप**
1. "Review Queue" देखें। नाम से ढूँढने के लिए "Search pending..." में लिखें।
2. "Route & Integrity" देखें: "Route Bound" मतलब route जुड़ा है; लाल "No Routing Rule" मतलब नहीं जुड़ा।
3. "Review" दबाएँ — template Template Studio में खुलेगा, वहाँ stages, dispatch और material देखें।
4. "Approve" दबाएँ (save होते समय "Signing..." दिखेगा)। "Approved" संदेश आने पर काम पूरा।
5. फिर Template Studio में template खोलकर "Publish LIVE" दबाएँ ताकि वह इस्तेमाल हो सके।

**स्क्रीन पर क्या है**
- **Product Snapshot**: Template का नाम, FG type (POUCH या ROLL), जुड़े route का नाम (या "Unassigned") और template id के पहले 8 अक्षर।
- **Route & Integrity**: Route जुड़ा हो तो "Route Bound" / "Routing Info"; न हो तो "No Route" / "No Routing Rule"। Material mapping और roll policy Template Studio में रहती है, यहाँ नहीं।
- **Decision**: "Review" Template Studio खोलता है; "Approve" template को ENGINEERING से APPROVED करता है।

**आम दिक्कतें और हल**
- "Approval Failed — Templates cannot be approved or published without a Routing Rule." — Route नहीं जुड़ा है। "Review" खोलें, "Routing rule" चुनें, "Save basics" और "Sync route stages" दबाएँ, फिर approve करें।
- "Approval Failed — Template must be in ENGINEERING review before approval." — किसी ने पहले ही approve या बदल दिया है। पेज refresh करें; review से बाहर होते ही लाइन हट जाएगी।
- "Approval Failed — Step N …: no capable work center is mapped for …" — किसी route stage का process चलाने वाला work center नहीं है। Factory setup में capability जोड़ें, या Template Studio के "4. Template route dispatch" में सुधारें।

**अटक गए तो**
1. "No pending approvals" दिखे पर template आना चाहिए था, तो वह अभी DRAFT में है; Template Studio में खोलकर "Send for review" दबाएँ।
2. Approve करने से template LIVE नहीं होता। Template Studio में "Publish LIVE" दबाएँ।

जुड़े पेज: /engineering/templates, /engineering/templates/[id], /engineering/approvals/[id]

**अभी नहीं होता / ध्यान दें**
- "Publish LIVE" के इंतज़ार में पड़े APPROVED template की कोई अलग सूची नहीं है।

### Review: template (Approval Console बंद) (/engineering/approvals/[id])
स्क्रीन का पता: /engineering/approvals/[id] · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, PLANNER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=engineering-approvals-id&lang=hi

पुरानी review स्क्रीन। अब यह सिर्फ "Approval Console Retired" दिखाती है और "Open Template Studio" बटन देती है।

पुराने link अब भी यहाँ आते हैं। अलग technical approval अब नहीं होता; template में अब सिर्फ route, step category mapping और roll policy रहती है। काम Template Studio में करें।

**शुरू करने से पहले**
- पते में सही template id हो।

**स्टेप बाय स्टेप**
1. "Approval Console Retired" कार्ड पढ़ें।
2. "Open Template Studio" दबाकर /engineering/templates/[id] पर काम जारी रखें।
3. वापस जाने के लिए back arrow दबाएँ।

**स्क्रीन पर क्या है**
- **Header "Review: <name>"**: Template का नाम और FG type दिखाता है।

**आम दिक्कतें और हल**
- "Template Not Found" — id गलत है या template हटाया गया है। "Go back" दबाकर Template Studio से खोलें।

**अटक गए तो**
1. Approve हमेशा Pending Approvals या Template Studio से करें, इस पेज से नहीं।

जुड़े पेज: /engineering/templates/[id], /engineering/approvals

**अभी नहीं होता / ध्यान दें**
- पुराना approval पेज बंद है और सिर्फ Template Studio का link देता है; पुराने link अब भी यहीं आते हैं।

### Artwork Library (/engineering/artworks)
स्क्रीन का पता: /engineering/artworks · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, PLANNER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=engineering-artworks&lang=hi

Print artwork की gallery — thumbnail, front/back colour, print type, film type, ink GSM और cylinder की तैयारी। यहीं artwork upload, बदलाव और approve होता है।

नया design आए या design बदले तब यह पेज खोलें। Production में सिर्फ APPROVED artwork चलता है। ROTO print में हर colour slot का cylinder यहीं बनता है और approve से पहले Cylinder Catalog में पूरा किया जाता है।

**शुरू करने से पहले**
- Production file: JPG, PNG या PDF (ज़्यादा से ज़्यादा 3)।
- हर side की colour list और कुल ink GSM।
- ROTO के लिए: cylinder repeat (circumference) और length; masters में engraving vendor और TOOLING storage location।

**स्टेप बाय स्टेप**
1. "Upload Artwork" दबाएँ (या बदलने के लिए कार्ड पर click करें)।
2. "Code" (जैसे ART-101) और "Name" भरें। "Artwork Images (max 3)" में file चुनें।
3. "Print Type" (FLEXO, ROTO, DIGITAL) और "Film Type" (SHEET = सिर्फ front, TUBING = front और back) चुनें।
4. "Add Front Color" / "Add Back Color" से colour जोड़ें। गिनती अपने आप बनती है।
5. "Total ink GSM" भरें।
6. सिर्फ ROTO: "Circumference / repeat (mm)" और "Cylinder length (mm)" भरें, फिर हर colour slot के लिए "Generate FRONT 1", "Generate FRONT 2" … दबाएँ।
7. "Save Draft" दबाएँ। ROTO में बने draft cylinder को Cylinder Catalog में पूरा करें (vendor, location, Finalize)।
8. कार्ड फिर खोलें। "Approval Blockers" खाली हो तो "Approve" दबाएँ। "Artwork Approved" संदेश आने पर पूरा।

**स्क्रीन पर क्या है**
- **Total Assets / Approved / Pending / Cylinder Ready**: Search के बाद दिख रहे artwork की गिनती। "Cylinder Ready" = हर colour slot का cylinder finalize है।
- **Search**: Design code, नाम, print type, film type या status से ढूँढता है।
- **कार्ड के badge**: Status (APPROVED, PENDING APPROVAL, …) और "Cylinder mapped" या "Mapping pending"।
- **Front / Back**: हर side के colour, जैसे F4 / B1।
- **Print / Film**: Print type और film type (SHEET या TUBING)।
- **Color Identity**: Artwork के पहले 6 colour के नाम।
- **Ink GSM**: पूरे artwork का कुल ink laydown; theory BOM में लगता है। Approve के लिए 0 से ज़्यादा होना चाहिए।
- **Cylinder specs**: सिर्फ ROTO। पूरे artwork के लिए एक repeat और एक length। पुराना cylinder तभी लगेगा जब दोनों मिलें।
- **ROTO Readiness Checklist**: PASS/BLOCK लाइनें: file, colour, ink GSM, repeat, length, colour गिनती, finalize front/back slot, technical details।
- **Cylinder generation by color**: हर colour slot का एक बटन। जो slot भर चुका वह "Covered" दिखाता है, दूसरा cylinder नहीं बनता।
- **Revise Artwork**: Approved या इस्तेमाल हो रहे artwork को बदलने पर नया draft version बनता है (badge "NEW DRAFT"); पुराने order पुराना version रखते हैं।

**आम दिक्कतें और हल**
- "Approval Failed (ARTWORK_APPROVAL_BLOCKED) — Cannot approve artwork without an uploaded file/image asset." — File नहीं लगी। JPG, PNG या PDF चुनें, "Save Draft" करें, फिर approve करें।
- "Artwork: total ink GSM must be greater than zero." — Approve से पहले "Total ink GSM" भरें।
- "Artwork: sheet film supports front colors only." — SHEET film पर back colour डाले गए। TUBING चुनें या back colour हटाएँ।
- "ROTO approval blocked: finalized front cylinders missing for slots [..]." — कुछ colour slot का cylinder finalize नहीं है। Cylinder Catalog → "Manage Slots" में बनाएँ या reuse करें और "Finalize this cylinder" दबाएँ।
- "ROTO approval blocked: cylinder circumference must match artwork repeat for slots [..]." — किसी cylinder का repeat artwork के repeat से अलग है (0.01 mm छूट)। Spec ठीक करें या मिलता cylinder लगाएँ।
- "Cylinder generation failed — Enter artwork cylinder circumference before generating cylinders." — पहले repeat और length भरें।
- "Upload a maximum of 3 artwork images. / Only 3 images kept" — सिर्फ पहली 3 file रखी जाती हैं।

**अटक गए तो**
1. "Approve" बटन grey हो तो लाल "Approval Blockers" सूची पढ़ें और हर लाइन ठीक करें।
2. Thumbnail में सिर्फ icon दिखे तो image नहीं खुली; कार्ड खोलकर "Replace artwork assets" से फिर upload करें।
3. Cylinder की स्थिति पुरानी लगे तो dialog में refresh icon ("Force Refresh") दबाएँ।

जुड़े पेज: /engineering/cylinders, /master/products, /engineering/tooling

**अभी नहीं होता / ध्यान दें**
- Artwork gallery में status या print type का filter नहीं (सिर्फ search), और delete या retire का विकल्प नहीं।

### Cylinder Catalog (/engineering/cylinders)
स्क्रीन का पता: /engineering/cylinders · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, PLANNER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=engineering-cylinders&lang=hi

ROTO print cylinder, artwork के हिसाब से। हर artwork कार्ड में colour slot, कितने भरे, draft और ready गिनती, और reuse वाले cylinder दिखते हैं।

Artwork पर draft cylinder बनाने के बाद, या नए design में पुराना cylinder लगाने के लिए यह पेज खोलें। ROTO artwork approve होने से पहले हर slot का cylinder finalize (vendor + storage location) होना चाहिए।

**शुरू करने से पहले**
- Artwork colour, repeat और length के साथ save हो।
- Master में vendor और TOOLING type की storage location।

**स्टेप बाय स्टेप**
1. Artwork ढूँढें (code, नाम, colour, cylinder code) और कार्ड पर "Manage Slots" दबाएँ।
2. "1. Artwork cylinder spec" में "Circumference / repeat" और "Cylinder length" जाँचें।
3. खाली slot के लिए "Generate new for this color" दबाएँ, या "Reuse matching cylinder" से चुनकर "Use" दबाएँ।
4. "2. Finish generated drafts" में engraving vendor, storage location और status (ACTIVE / MAINTENANCE / SCRAP) चुनें; diameter और cell depth पता हो तो भरें।
5. हर draft slot पर "Finalize this cylinder" दबाएँ। Slot "Ready" होकर "Slot complete" दिखाएगा।
6. Artwork Library में जाकर artwork पर "Approve" दबाएँ।
7. बाद में किसी cylinder को बदलने के लिए "Edit cylinder" (या अलग cylinder के लिए "New Cylinder") दबाकर "Update" / "Create" करें।

**स्क्रीन पर क्या है**
- **Total Cylinders / Draft / Production Ready / Service Focus**: दिख रहे artwork के slot की गिनती; Service Focus = MAINTENANCE या RE_CHROME वाले cylinder।
- **x/y covered**: कुल colour slot में से कितनों पर cylinder लगा है।
- **Empty Slots / Ready / Draft / Reuse**: Reuse = वे slot जो दूसरे artwork का cylinder इस्तेमाल करते हैं।
- **Slot की स्थिति**: "Empty slot", "Draft generated", "Ready" या "Reused ready"।
- **Matching reuse pool**: Finalize, active cylinder जिनमें vendor और location हो और repeat व length 0.01 mm के अंदर मिलें। Vendor कोई भी हो सकता है।
- **Lifecycle Mode / Lifecycle Status / Operational Status**: Cylinder dialog में: DRAFT या PRODUCTION; अंतिम status ACTIVE, MAINTENANCE या SCRAP।
- **Side / Side Slot #**: FRONT या BACK और colour की जगह। उस side के colour की गिनती से ज़्यादा नहीं हो सकता।

**आम दिक्कतें और हल**
- "Finalization blocked — Select engraving vendor before finalizing. / Select storage location before finalizing." — पहले "2. Finish generated drafts" में दोनों चुनें।
- "Enter circumference / repeat before using cylinder slots." — Generate, reuse या finalize से पहले repeat और length चाहिए।
- "Reuse failed — Reusable cylinder circumference must match the artwork repeat (… mm)." — उसी repeat और length का cylinder चुनें।
- "Only finalized cylinders can be reused for artwork slots." — Draft cylinder reuse नहीं होता; पहले उसके artwork पर finalize करें।
- "Finalize cylinder blocked: artwork already has a finalized cylinder for FRONT-n." — वह slot पहले से भरा है। मौजूदा cylinder बदलें।
- "Storage location must be a TOOLING location." — सिर्फ TOOLING type location चलती है; location master में बनाएँ।
- "Requested FRONT-n exceeds artwork color slots." — Artwork में colour कम हैं। Artwork पर colour ठीक करें।

**अटक गए तो**
1. "Finalize this cylinder" grey हो तो vendor, location या repeat/length नहीं भरा।
2. Reuse सूची खाली हो तो उसी repeat × length का कोई finalize cylinder नहीं है; नया बनाएँ।

जुड़े पेज: /engineering/artworks, /engineering/tooling

**अभी नहीं होता / ध्यान दें**
- Cylinder का MAINTENANCE/RE_CHROME status "Service Focus" में गिना जाता है पर Maintenance module से जुड़ा नहीं है।

### Template के हिसाब से Work-center setup (Route dispatch) (/engineering/route-dispatch)
स्क्रीन का पता: /engineering/route-dispatch · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, PLANNER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=engineering-route-dispatch&lang=hi

हर template के route step की जाँच: कौन से work center चला सकते हैं, default center और release rule। जिन step में setup बाकी है वे दिखते हैं।

इससे वे step ढूँढें जिन्हें planner release नहीं कर सकता (capability नहीं, default नहीं, गलत center)। नए template और correction draft Template Studio के "4. Template route dispatch" में सेट करना बेहतर है; यह पेज जाँच और पुराना backfill के लिए है। LIVE template यहाँ lock हैं — "Edit safely" इस्तेमाल करें।

**शुरू करने से पहले**
- Route steps sync वाले template।
- Factory में process capability वाले machine/work center।

**स्टेप बाय स्टेप**
1. "Templates", "Route steps", "Need setup", "No capability" tile देखें।
2. "Search template, process, or route step...", status सूची (जैसे "Needs decision", "No capability") और process सूची से छाँटें। "Clear filters" से हटाएँ।
3. चाहें तो "Backfill missing steps" दबाएँ — जिन step का एक ही center है वे अपने आप भर जाएँगे।
4. LIVE template के लिए "Edit safely" दबाएँ — Template Studio में correction draft खुलेगा।
5. Draft template में: allowed center tick करें (या "Allow all"), "Default work center" चुनें, "Release rule" चुनें।
6. Process अनुमति दे तो "Planner optional" या "WCM skip after output" चालू करें।
7. "Save step" दबाएँ। "Route step saved" संदेश आने पर पूरा।

**स्क्रीन पर क्या है**
- **Step की स्थिति**: "Ready", "Auto ready", "Planner chooses", "Choose center", "No capability", "Invalid allowed", "Invalid default"।
- **Allowed centers**: इस step के लिए tick किए capable center। सब tick = हर capable center चलेगा।
- **Default work center**: Rule "Always use default" होने पर release में यही center लगेगा।
- **Release rule**: "Auto when only one", "Always use default" या "Planner chooses at release"।
- **Planner optional**: Planner release या replan करते समय skip का विकल्प दिखता है। सिर्फ जब Process Master अनुमति दे।
- **WCM skip after output**: पिछले output के बाद WCM एक batch के लिए यह step skip कर सकता है।
- **Edit safely / Disable**: Edit safely LIVE template का correction draft बनाता है। Disable template को सब selector से छिपा देता है (पुष्टि माँगता है)।

**आम दिक्कतें और हल**
- "Allowed work center is not capable for <process>: …" — Tick किया center यह process नहीं चला सकता। Untick करें या Factory में capability जोड़ें।
- "Default work center cannot run <process>." — Default में capable center चुनें।
- "<process> is not planner-optional-capable in Process Master." — पहले Process Master में यह विकल्प चालू करें।
- "No work center currently has capability for this process." — Factory setup में process को machine से जोड़ें, फिर लौटें।
- "This template is live and locked." — "Edit safely" दबाकर correction draft बनाएँ।

**अटक गए तो**
1. कुछ बदले बिना "Save step" grey रहकर "Saved" दिखाता है।
2. "Route dispatch setup could not be loaded." दिखे तो refresh करें; बार-बार हो तो admin को बताएँ।

जुड़े पेज: /engineering/templates/[id], /engineering/templates, /factory/processes

**अभी नहीं होता / ध्यान दें**
- Dispatch यहाँ और Template Studio section 4 दोनों जगह बदल सकता है; studio कहता है यह पेज सिर्फ जाँच और पुराना backfill है।
- "Backfill missing steps" बिना preview या पुष्टि के तुरंत चल जाता है।

### Routing Studio (/engineering/routing)
स्क्रीन का पता: /engineering/routing · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, PLANNER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=engineering-routing&lang=hi

Production कैसे चलेगा यह तय करता है: process steps का क्रम, साथ चलने वाले step (parallel + branch) और join। Batch या material यहाँ नहीं।

Template बनाने से पहले route बनाएँ। Template एक route चुनता है। Route किसी चालू template या production history में लग जाए तो उसके step lock हो जाते हैं; तब उसे disable करके नया route बनाएँ।

**शुरू करने से पहले**
- Process Master में process (Factory → Processes)।
- बनाने, बदलने, disable या delete के लिए routing या template manage अनुमति।

**स्टेप बाय स्टेप**
1. "New Route" दबाएँ।
2. "Route Name" (जैसे Standard 3-Layer PE) और "Description" भरें।
3. "1. Route steps" में "Add Step" दबाकर हर process क्रम से चुनें; arrow से ऊपर-नीचे करें।
4. Flow builder में जो step पिछले के साथ चलता है, उस पर "↓ Starts after previous" दबाएँ ताकि वह "+ Runs together" बने।
5. Preview देखें: Stage 1, Stage 2 … और "+ parallel" वाली लाइनें। अगला stage parallel लाइन के हर process का इंतज़ार करता है।
6. Route plant के बीच जाए तो "Interplant Logistics?" चालू करें; "Active Status" चालू रखें।
7. "Save Routing Rule" दबाएँ। "Routing Rule created." संदेश आएगा।
8. कार्ड के ⋯ menu से "Edit", "Disable" या "Delete" करें।

**स्क्रीन पर क्या है**
- **Active / Disabled / All**: गिनती के साथ filter बटन।
- **Search routing rules**: Route, process या description से ढूँढें।
- **कार्ड के badge**: "Inactive", "Interplant", stage गिनती, "n + branches" या "straight flow", "flow only"।
- **Runs together / Starts after previous**: Step को पिछले वाले के साथ उसी stage (parallel) में या अगले stage में रखता है।
- **Interplant Logistics?**: Plant के बीच movement वाले route पर निशान।
- **Active Status**: बंद = नए template के चुनाव में नहीं दिखेगा।

**आम दिक्कतें और हल**
- "Routing sequence and graph are locked by current templates or production history." — इस्तेमाल के बाद step नहीं बदलते। पुराना route/template disable करें और सुधरा route व template version बनाएँ।
- "Disable linked templates or create a corrected route first: …" — चालू template route इस्तेमाल कर रहे हैं तो delete नहीं होगा। उन template को disable करें या route पर "Disable" करें।
- "Mark the routing rule inactive instead, or move dependent templates to another route first." — Job या पुराने template अभी भी इसे इस्तेमाल करते हैं; "Disable" करें।
- "Unknown Process code(s): … Create or select the Process Master before saving the route." — पहले Factory → Processes में process बनाएँ।
- "Routing or template manage permission is required …" — आपका role route नहीं बदल सकता; admin से कहें।

**अटक गए तो**
1. "No routing rules in this view." दिखे तो "All" चुनें या search हटाएँ।
2. Batch size, lot prefix और release rule यहाँ नहीं; Template Studio में सेट करें।

जुड़े पेज: /engineering/templates, /engineering/templates/[id], /factory/processes

**अभी नहीं होता / ध्यान दें**
- इस्तेमाल में लगा route नहीं बदलता; तरीका सिर्फ disable करके नया route और नए template version बनाना है।

### Template Studio (template सूची) (/engineering/templates)
स्क्रीन का पता: /engineering/templates · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, PLANNER, WORK_CENTER_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=engineering-templates&lang=hi

Route template की सूची (LIVE या Disabled) — type, business family और status के साथ। नया template बनाएँ और studio में खोलें।

Template एक product type (POUCH या ROLL) को route, stage material rule, roll handling और batch rule से जोड़ता है। Sales, planner और Product Master में सिर्फ चालू LIVE version चुना जा सकता है। काम यहाँ शुरू होता है, Template Studio में चलता है और "Publish LIVE" से पूरा होता है।

**शुरू करने से पहले**
- Routing rule (Routing Studio)।
- Template बनाने या draft साफ करने के लिए templates manage अनुमति।

**स्टेप बाय स्टेप**
1. "New Template" दबाएँ।
2. "Create Route Template" में "Template Name" (जैसे Pouch Route) भरें और "FG Type" POUCH या ROLL चुनें।
3. POUCH में "Pouch Style" चुनें (Three Side Seal, Pillow, Stand Up, Side Gusset, Quad Seal, Flat Bottom, Spout, Shaped)।
4. चाहें तो "Business Family" और "Routing Rule" चुनें।
5. "Create & Open Studio" दबाएँ — नया draft Template Studio में खुलेगा।
6. पुराना खोलने के लिए नाम या id से ढूँढें और "Studio" दबाएँ।
7. "Clean drafts" से बेकार draft/review template हटाएँ (पुष्टि माँगता है)।

**स्क्रीन पर क्या है**
- **Total / Live / Disabled / Routes**: Template और routing rule की गिनती।
- **Live / Disabled filter**: LIVE या disabled (OBSOLETE) template दिखाता है।
- **Template**: नाम, छोटा id और जुड़ा route (न हो तो "not linked")।
- **Type / Business Family / Status**: POUCH या ROLL; family; Draft, Engineering, Approved, Live, Disabled या Correction draft।
- **Template Schema Warning**: Server की template table पुरानी हों तब दिखता है; admin को बताएँ।

**आम दिक्कतें और हल**
- "Create failed — Template name is required." — "Create & Open Studio" से पहले नाम लिखें।
- "Pouch templates must declare a pouch style." — POUCH के लिए "Pouch Style" चुनें।
- "Template registry could not load." — Server या schema की दिक्कत; refresh करें, फिर दिखा संदेश admin को बताएँ।

**अटक गए तो**
1. Draft यहाँ नहीं दिखते। Draft Pending Approvals से या भेजे link से खोलें, या नया बनाएँ।
2. सिर्फ पहले कुछ दिखते हैं; "Showing first …" लिखा हो तो search से छोटा करें।

जुड़े पेज: /engineering/templates/[id], /engineering/routing, /engineering/approvals, /master/products

**अभी नहीं होता / ध्यान दें**
- Template सूची में सिर्फ LIVE और disabled दिखते हैं; DRAFT, ENGINEERING और APPROVED नहीं दिखते, इसलिए draft सिर्फ Pending Approvals, सेव link या बनाने वाले dialog से खुलता है।

### Template Studio · execution rules (/engineering/templates/[id])
स्क्रीन का पता: /engineering/templates/[id] · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, PLANNER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=engineering-templates-id&lang=hi

एक template पूरा बनाता है: route जोड़ना, batch और lot rule, route stage और lamination lane, work-center dispatch, step material rule, फिर review और LIVE।

इसे सूची से, Pending Approvals से या template बनाते ही खोलें। Lifecycle: DRAFT → ENGINEERING → APPROVED → LIVE → OBSOLETE। LIVE template lock होते हैं; "Edit safely" correction draft खोलता है और पुराने order व job draft publish होने तक पुराने version पर रहते हैं।

**शुरू करने से पहले**
- सही process वाला routing rule।
- हर route process के लिए capable work center।
- Masters में material category (GRANULE, ADHESIVE, SOLVENT, ADDON, POD)।

**स्टेप बाय स्टेप**
1. "1. Basics and route binding": "Routing rule" और "Business family" चुनें, "Save basics" दबाएँ, फिर "Sync route stages"।
2. "2. Batch and lot execution": "Batch size KG", "Batch size PCS", "Lot prefix" और release switch भरें; "Save template execution" दबाएँ।
3. "3. Route stages": हर stage और lamination Lane A / Lane B जाँचें।
4. "4. Template route dispatch": हर stage के allowed center, "Release rule", "Default work center", चाहें तो "Dispatch note"; "Save dispatch setup" दबाएँ।
5. "5. Step material rules": हर material category को stage से जोड़ें और Basis, Formula, Issue, Value, Close सेट करें।
6. "Template readiness" और "Review gate" देखें; हर "Fix:" लाइन ठीक करें।
7. "6. Review and make live": "Send for review", फिर "Approve", फिर "Publish LIVE" दबाएँ (बटन का नाम status के साथ बदलता है)।
8. LIVE template बदलने के लिए "Edit safely"; copy के लिए "Duplicate" / "Create working copy"; बंद करने के लिए "Disable" (पुष्टि करें)।

**स्क्रीन पर क्या है**
- **Template readiness**: Material policy वाले stage का प्रतिशत, और "Basics saved", route, stage गिनती, "Ready for live" / "Review needed"।
- **Lifecycle**: DRAFT (बदल सकते), ENGINEERING (जाँच), APPROVED (publish के लिए lock), LIVE (planner इस्तेमाल करता), OBSOLETE (बंद)।
- **Batch size KG / PCS, Lot prefix**: नए release का default batch size और lot number prefix (खाली हो तो AUTO)।
- **Auto create batches**: Planner line release करे तब production batch अपने आप बनें।
- **Allow partial movement**: Batch का कुछ हिस्सा आगे जा सकता है, बाकी खुला रहता है।
- **Release + branches together**: Parallel branch बिना दोबारा release के साथ शुरू होते हैं।
- **Match all before next stage**: Join stage तब तक रुकता है जब तक हर input branch पूरा न हो।
- **Release rule**: "Auto when one center", "Use selected default", "Planner chooses at release"।
- **Planner may skip at release / WCM may skip after previous output**: Step छोड़ने के switch, सिर्फ जब Process Master अनुमति दे।
- **Output handling (Thickness, Output capture)**: Thickness: Inherit input, Sum inputs, Fixed, Template default। Capture: Process default, Single roll, Multi roll, Split grid, Discrete only, Bulk KG + PCS, Bulk KG only। Width order size से आती है।
- **Material mapping: Basis / Issue / Close**: Basis: Snapshot GSM, Master formula, Fixed KG, Fixed PCS। Issue: No uplift, theory से प्रतिशत ज़्यादा, Fixed extra kg, Minimum issue kg। Close: Auto from output, Estimate + confirm, Operator required। Ink theory artwork GSM से आती है।

**आम दिक्कतें और हल**
- "Sync workflow first. A LIVE template must contain at least one active route step." — Route चुनने के बाद "Sync route stages" दबाएँ।
- "Cannot change routing on a LIVE template." — "Edit safely" से correction draft लें।
- "Template must be APPROVED before it can be published LIVE." — पहले review भेजें और approve करें।
- "LIVE templates are read-only. Clone a new version first." — "Edit safely" इस्तेमाल करें।
- "Step N …: choose a default work center or set Planner chooses at release." — एक से ज़्यादा capable center हैं और फैसला नहीं हुआ। Section 4 में ठीक करें।
- "Step N …: lamination needs two input lanes." — Lamination stage में Input lanes 2 करें।
- "Routing Rule contains missing Process code(s): … Route steps were not changed." — Route में ऐसा process है जो अब नहीं है; route या Process Master ठीक करें।
- "ADDON category must use CATEGORY_FORMULA. / POD category must use CATEGORY_FORMULA." — ADDON और POD में Basis "Master formula" और formula "Addon master" / "POD profile" चुनें।

**अटक गए तो**
1. सब field grey और "Live / locked"? "Edit safely" दबाएँ।
2. "No route stages yet"? Routing rule चुनें, "Save basics", फिर "Sync route stages"।
3. Correction draft "Publish LIVE" के बाद ही LIVE template की जगह लेता है; पुराने order पुराना रखते हैं।

जुड़े पेज: /engineering/templates, /engineering/routing, /engineering/route-dispatch, /engineering/approvals, /master/products

### Tool Room (/engineering/tooling)
स्क्रीन का पता: /engineering/tooling · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, PLANNER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=engineering-tooling&lang=hi

Cylinder के अलावा plant के tool की सूची: anilox, sleeve, cutting die, sealing jaw, core shaft, mounting adapter आदि — rack/slot, vendor और service की तारीख के साथ।

Tool कहाँ रखा है और service कब है, यह जानने के लिए। यह सिर्फ सूची है; production को नहीं रोकती।

**शुरू करने से पहले**
- Plant बना हो; tool room के लिए TOOLING storage location (वैकल्पिक)।

**स्टेप बाय स्टेप**
1. "Add Tool" दबाएँ।
2. "Create Tool Asset" में "Plant" और "Asset Type" चुनें, "Code" और "Name" भरें, "Status" चुनें।
3. "Rack" (जैसे Rack-A), "Slot" (जैसे S-04), "Storage Location" और "Vendor" भरें।
4. "Service Due" तारीख और "Notes" भरें; "Save" दबाएँ।
5. बदलने के लिए कार्ड पर "Edit"; "Delete" से हटाएँ।

**स्क्रीन पर क्या है**
- **Tracked Tools / Ready / Service Due / Retired**: Status के हिसाब से गिनती।
- **Asset Type**: ANILOX, SLEEVE, CUTTING_DIE, SEALING_JAW, CORE_SHAFT, MOUNTING_ADAPTER, TOOLING_OTHER।
- **Status**: READY, IN_USE, SERVICE_DUE, MAINTENANCE, RETIRED।
- **Storage / Rack / Slot**: Tool कहाँ रखा है।
- **Service Due**: अगली service की तारीख (सिर्फ याद के लिए)।

**आम दिक्कतें और हल**
- "Storage location must belong to the same plant." — चुने plant की location लें।
- "Storage location must be a TOOLING location." — सिर्फ TOOLING type location चलती है।

**अटक गए तो**
1. "Delete" पुष्टि नहीं माँगता; history रखने के लिए status RETIRED करें।

जुड़े पेज: /engineering/cylinders, /maintenance/schedules

**अभी नहीं होता / ध्यान दें**
- Tool asset पर "Delete" पुष्टि नहीं माँगता।
- Tool की "Service Due" तारीख से maintenance job या याद नहीं बनती; Tool Room और Maintenance schedule जुड़े नहीं हैं।
