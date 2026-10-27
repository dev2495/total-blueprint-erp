# Master data — product masters, packaging, materials

## Overview (English)
# Master Data

Master Data holds the fixed records every order, plan and floor step reads: what we can make (Product Masters), the shapes and width rules behind them (Pouch styles, Web-width policies) and every material and partner (films, granules, recipes, inks, adhesives, add-ons, packaging, POD, trading goods, vendors). Most screens live in the **Products** workspace; **All masters** (`/master`) is a hub with one card per registry and its record count.

## Who uses it
- **ADMIN, OWNER, SUPER_ADMIN**: all master pages. Other people need a personal *master.view* / *master.manage* grant. Master pages do not open for other roles even if the address is typed.
- **PLANNER**: Web-width policies.
- **SALES** never opens masters: the order composer shows only active Product Masters and what they allow.
- **STORE** keeps vendors from Stock → Vendors (`/inventory/vendors`).

## Screens and how they connect
1. **Film families** (base film + density) → **Film variants** (film identity: extrudable, purchasable, sellable) → **Recipes** (granule-family % per variant + grade + thickness range) → **Granules** (families and internal grade codes used at GRN and WCM issue).
2. **Pouch styles**: allowed size fields and the child-width / film-area formula. A style is a draft until "Save + approve + lock"; only approved styles reach Product Master sizes. Editing an approved style makes a new draft version; sizes keep their saved copy until it is approved.
3. **Web-width policies**: allowed lane counts (1–12), how child width becomes parent web, slitting trim and the smallest remainder kept. Scoped globally or to a product kind, master, pouch style, process or machine.
4. **Product Masters** (`/master/products`): kind (Pouch, Roll, Packaging, POD, Other), live route template, layers (film, micron, grade, allowed alternates), printing rule (No printing / artwork optional / artwork required, FLEXO or ROTO), adhesive and solvent GSM, what sales may add, sizes, add-ons, inner pouch and POD. New masters are created inactive; activate after the editor checklist passes.
5. **Packaging**, **POD**, **Add-ons**, **Inks**, **Adhesives & Solvents**, **Trading goods**, **Commercial families**, **Vendors**: the catalogs the masters, store and floor use.

## Main flows
**New pouch product**
1. Make sure the films exist (Film families → Film variants) and, if extruded, a recipe.
2. Make sure an approved pouch style fits the shape.
3. Product Master → "New Product Master": kind, code, name, live route, number of layers → "Create & open workspace".
4. In the editor fill Layers, Printing, Adhesive, What sales can change, Sizes and Add-ons & packing.
5. Sizes: "Add size" or "Excel sheet" → fill → "Bulk upload" → "Review size import" → "Confirm import". Blank codes and labels are made from the size (for example 140X305G40). Inches are worked out from mm.
6. Press "Save master", switch "Master active" on. Sales can now pick it.

**New packing item**
1. Packaging → "Add Packaging". Choose the kind on purpose: there is no default.
2. Inner pouch: never in the release tick list. An in-house inner pouch is taken off stock at the machine's last pouching step when the output is logged; a bought one is booked to the order by the evening packing count. Every other active kind (gonny, sheet/putha, box, outer bag, tape, label, tag, other) is always in the tick list; ticks are marks only, and the evening packing count books the counted use to the orders that ticked it, in whole pieces (if no one ticked it, to that day's orders whose packing plan includes it).
3. Bought inner pouches and all gonnies need the weight of one piece (kg); it goes into each dispatch unit's weight.
4. In-house inner pouches or sheets: create a PACKAGING Product Master ("Build production master"), then "Link to Product Master" on the item card. Only in-house inner pouches are demanded automatically; other in-house items are restocked from the Stock launcher.

**Changing a weight or formula**
- Add-on weight change: every open, unreleased line using it is re-calculated; released lines need "Recalculate from masters" on the WC terminal.
- Recipe revision: needs a reason; open BOMs refresh, released jobs stay frozen.
- Product Master save: open order snapshots refresh.

## Rules and limits
- Product Master code never changes; change the name. Codes must be unique.
- A size code already on the master is refused; edit that row. Removing a size retires it; adding the same code brings it back.
- Size sheet: .xlsx or .csv, at most 5 MB, first row = column names from the template. Nothing is saved until "Save master".
- Recipes cannot be deleted, only disabled; percentages must total 100.00%; one active recipe per variant + grade + thickness range.
- Core POD rows (code POD-…) keep their code and cannot be deleted.
- Only Inner pouch and Sheet packaging may be IN_HOUSE or BOTH.
- Adhesive and solvent are locked to one record each.
- Disabled masters and styles keep history; old orders still open them.

## Problems and fixes
- *Putha (or another item) is not in the release tick list*: Packaging → Edit → set kind Sheet · putha · board (any kind except Inner pouch) and ACTIVE.
- *"Enter the weight of one pouch/gonny in kg"*: enter the piece weight on the packaging item.
- *Product not in the order composer*: the master is inactive or disabled.
- *Pouch style not in the size picker*: it is a draft or disabled; approve or reactivate it.
- *"Size code … is already on this master"*: search the size list and edit that row.
- *"Not a readable Excel file"*: download "Excel sheet" again, keep the header, save as .xlsx.
- *Lane count refused on an order*: add it to the web-width policy that applies.
- *"Total percentage must be 100.00%"*: press "Balance to 100%".
- *In-house inner pouch shows "Needs PM link"*: link it to its packaging Product Master; until then in-house demand cannot be planned.

## सारांश (हिंदी)
# Master Data

Master Data में वे तय रिकॉर्ड हैं जिन्हें हर order, plan और floor step पढ़ता है: हम क्या बना सकते हैं (Product Master), उनके पीछे के आकार और width नियम (Pouch style, Web-width policy), और हर material व partner (film, granule, recipe, ink, adhesive, add-on, packaging, POD, trading goods, vendor)। ज़्यादातर पेज **Products** workspace में हैं; **All masters** (`/master`) एक मुख्य पेज है जिसमें हर रजिस्टर का कार्ड और रिकॉर्ड गिनती है।

## कौन इस्तेमाल करता है
- **ADMIN, OWNER, SUPER_ADMIN**: सभी master पेज। बाकी लोगों को अलग से *master.view* / *master.manage* अधिकार चाहिए। पता टाइप करने पर भी दूसरे रोल के लिए master पेज नहीं खुलते।
- **PLANNER**: Web-width policy।
- **SALES** master नहीं खोलता: order composer सिर्फ active Product Master और उनकी अनुमति वाली चीज़ें दिखाता है।
- **STORE** vendor Stock → Vendors (`/inventory/vendors`) से संभालता है।

## पेज और उनका आपसी संबंध
1. **Film families** (base film + density) → **Film variants** (film की पहचान: घर में बनती, खरीदी जाती, बिकती) → **Recipes** (variant + grade + thickness range के लिए granule family का %) → **Granules** (family और internal grade code, जो GRN और WCM issue पर लगते हैं)।
2. **Pouch styles**: कौन से माप लगेंगे और child-width / film-area formula। "Save + approve + lock" तक style draft रहता है; सिर्फ approved style Product Master sizes में आता है। Approved style बदलने पर नया draft version बनता है; sizes पुरानी copy रखते हैं जब तक नया approve न हो।
3. **Web-width policies**: allowed lanes (1–12), child width से parent web कैसे बनता है, slitting trim और सबसे छोटा रखा जाने वाला बचा हिस्सा। Global या product kind, master, pouch style, process या machine के लिए।
4. **Product Masters** (`/master/products`): kind (Pouch, Roll, Packaging, POD, Other), live route template, layers (film, micron, grade, दूसरी मंज़ूर film), printing नियम (No printing / artwork optional / artwork required, FLEXO या ROTO), adhesive और solvent GSM, sales क्या जोड़ सकता है, sizes, add-on, inner pouch और POD। नया master inactive बनता है; editor की checklist पूरी होने पर active करें।
5. **Packaging**, **POD**, **Add-ons**, **Inks**, **Adhesives & Solvents**, **Trading goods**, **Commercial families**, **Vendors**: वे catalog जिन्हें master, store और floor इस्तेमाल करते हैं।

## मुख्य काम कदम-दर-कदम
**नया pouch product**
1. Film बनी हों (Film families → Film variants), और extrusion हो तो recipe भी।
2. आकार के लिए approved pouch style हो।
3. Product Master → "New Product Master": kind, code, नाम, live route, layers की संख्या → "Create & open workspace"।
4. Editor में Layers, Printing, Adhesive, What sales can change, Sizes और Add-ons & packing भरें।
5. Sizes: "Add size" या "Excel sheet" → भरें → "Bulk upload" → "Review size import" → "Confirm import"। खाली code और label size से बनते हैं (जैसे 140X305G40)। Inch mm से अपने-आप निकलते हैं।
6. "Save master" दबाएँ, "Master active" चालू करें। अब sales इसे चुन सकता है।

**नया packing item**
1. Packaging → "Add Packaging"। Kind सोचकर चुनें: कोई default नहीं है।
2. Inner pouch: release tick list में कभी नहीं आता। घर में बना (in-house) inner pouch मशीन के आखिरी pouching step पर output दर्ज होते ही stock से घटता है; खरीदा हुआ inner pouch शाम की packing count order पर book करती है। बाकी हर active kind (gonny, sheet/putha, box, outer bag, tape, label, tag, other) tick list में हमेशा आता है; tick सिर्फ निशान है, और शाम की packing count गिना हुआ इस्तेमाल tick करने वाले orders में पूरे pieces में बाँटती है (किसी ने tick न किया हो तो उस दिन के उन orders में जिनके packing plan में वह item है)।
3. खरीदे inner pouch और हर gonny के लिए एक piece का वज़न (kg) चाहिए; यह dispatch unit के वज़न में जुड़ता है।
4. घर में बने inner pouch या sheet: PACKAGING Product Master बनाएँ ("Build production master"), फिर item कार्ड पर "Link to Product Master"। सिर्फ घर के inner pouch की demand अपने-आप बनती है; बाकी घर के items Stock launcher से भरे जाते हैं।

**वज़न या formula बदलना**
- Add-on का वज़न बदला: उसे इस्तेमाल करने वाली हर खुली, release न हुई line फिर से गिनी जाती है; release हुई lines के लिए WC terminal पर "Recalculate from masters"।
- Recipe revision: कारण लिखना ज़रूरी; खुले BOM ताज़ा होते हैं, release हुए job पुराने पर रहते हैं।
- Product Master save: खुले orders का snapshot ताज़ा होता है।

## नियम और सीमाएँ
- Product Master code कभी नहीं बदलता; नाम बदलें। Code एक जैसे नहीं हो सकते।
- जो size code master पर पहले से है वह दोबारा नहीं बनता; वही row बदलें। Size हटाने पर retire होता है; वही code फिर जोड़ने पर वापस आता है।
- Size sheet: .xlsx या .csv, ज़्यादा से ज़्यादा 5 MB, पहली row में template के column नाम। "Save master" तक कुछ save नहीं होता।
- Recipe delete नहीं होती, सिर्फ disable; प्रतिशत का जोड़ 100.00% हो; हर variant + grade + thickness range की एक ही active recipe।
- Core POD row (code POD-…) का code नहीं बदलता और delete नहीं होता।
- सिर्फ Inner pouch और Sheet packaging IN_HOUSE या BOTH हो सकते हैं।
- Adhesive और solvent एक-एक रिकॉर्ड पर lock हैं।
- Disabled master और style का इतिहास रहता है; पुराने orders उन्हें खोल सकते हैं।

## समस्याएँ और हल
- *Putha (या कोई item) release tick list में नहीं*: Packaging → Edit → kind Sheet · putha · board (Inner pouch के अलावा कोई भी) और ACTIVE करें।
- *"Enter the weight of one pouch/gonny in kg"*: packaging item पर एक piece का वज़न भरें।
- *Product order composer में नहीं*: master inactive या disabled है।
- *Pouch style size picker में नहीं*: वह draft या disabled है; approve या reactivate करें।
- *"Size code … is already on this master"*: size list में खोजकर वही row बदलें।
- *"Not a readable Excel file"*: "Excel sheet" फिर download करें, header रखें, .xlsx में save करें।
- *Order पर lane count नहीं लेता*: लागू web-width policy में वह lane जोड़ें।
- *"Total percentage must be 100.00%"*: "Balance to 100%" दबाएँ।
- *घर के inner pouch पर "Needs PM link"*: उसे packaging Product Master से जोड़ें; तब तक घर की demand plan नहीं हो सकती।

## Every screen (English)

### Master Data (/master)
Screen address: /master · Roles: ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=master

The hub of all master registries: one card per master (films, inks, adhesives, recipes, granules, customers, vendors, add-ons, packaging, trading goods, POD) with its record count.

Open it when you need to reach a master that is not in your sidebar tab, or to check how many records each master holds. Click a card to open that master. Product masters, pouch styles and web-width policies are not on this hub; open them from the Products workspace tabs.

**Before you start**
- Admin, Owner or Super admin role, or a personal master.view / master.manage grant.

**Step by step**
1. Type in "Search master data registries..." to narrow the cards by name or description.
2. Read the four tiles: "Total masters", "Materials", "Partners" and "Recipes".
3. Check the count badge on each card ("N Records"). "Loading" means the count is still coming; "Access error" means your role cannot read that master.
4. Click a card to open that master page (for example "Packaging" opens /master/packaging, "Customers" opens /sales/customers).

**What is on the screen**
- **Total masters**: Fixed number of registries shown on the hub (13).
- **Materials**: Film families + film variants + inks + adhesives/solvents + granules + trading goods.
- **Partners**: Customers plus vendors.
- **Recipes**: Number of extrusion recipes (formulation masters).
- **Live badge**: Every card shows "Live"; it does not mean each master is complete.

**Common problems and fixes**
- "Access error on the Recipes card" — Your account cannot read recipes. Ask an admin for the master grant.
- "Page does not open / redirects" — Master pages open only for Admin/Owner/Super admin or a master grant, even if you type the address.

**If stuck**
1. Refresh the page if a card stays on "Loading".
2. Use the Products workspace tabs for Product masters, Pouch styles and Web-width policies.

Related pages: /master/commercial-families, /master/film-families, /master/film-variants, /master/inks, /master/adhesives-solvents, /master/recipes, /master/granules, /sales/customers, /master/vendors, /master/add-ons, /master/packaging, /master/trading-goods, /master/pod, /master/products

**Not done yet / watch out**
- The Master Data hub has no cards for Product Masters, Pouch styles or Web-width policies; they are reached only from the Products workspace tabs.
- Every card shows a "Live" badge whatever the state of the master, and "Total masters" is a fixed 13.

### Add-ons & Misc Materials (/master/add-ons)
Screen address: /master/add-ons · Roles: ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=master-add-ons

Master of zippers, spouts, handles, valves and other attachments: how much each weighs per bag and whether the store buys it.

Open it before an order needs a new attachment, or when the weight of an add-on is wrong. Product Masters list the add-ons sales may pick; the order BOM uses the weight set here. Saving a changed weight re-calculates every open, unreleased order line that uses the add-on.

**Before you start**
- Admin/Owner role or master grant.
- Know the real weight of the add-on (grams per piece or per mm of length).

**Step by step**
1. Press "Add Addon".
2. Fill "Addon Code" (e.g. ZIP-25) and "Description".
3. Pick "Consumption Mode": "Per Millimeter", "Per Piece" or "Fixed Weight".
4. Enter the weight in grams. For Per Millimeter also pick "The weight above is given per" 1 mm or 10 mm of applied length.
5. Check the box "Check: one piece on a 280 mm wide bag"; the grams per bag must look right.
6. Set "Purchasable?" Yes if the store inwards it, and pick "Purchase UOM" (KG, PCS, METER).
7. Press "Save". On edit, read the toast: it says how many open lines were refreshed and skipped.

**What is on the screen**
- **Consumption Mode**: Per Millimeter = weight grows with bag width; Per Piece = same grams on every bag; Fixed Weight = one fixed weight.
- **Weight basis (1 mm / 10 mm)**: Only for Per Millimeter. Say whether the grams you typed are for 1 mm or 10 mm of zipper length.
- **Purchasable?**: Yes lets the store inward it as bought stock; its stock unit becomes the Purchase UOM. No keeps stock unit KG.
- **Columns: Code, Name, Mode, Weight (g), Purchasable, Stock UOM**: Table of all add-ons with Edit and Delete per row.

**Common problems and fixes**
- "Saved, but open lines could not be refreshed: …" — The add-on saved but re-calculating open orders failed. Open the order line or ask the planner; released lines need "Recalculate from masters" on the WC terminal.
- "Code is required / Name is required / Value must be positive" — Fill code and description and a weight of 0 or more.

**If stuck**
1. If a released job still shows the old weight, press "Recalculate from masters" on the work-centre terminal.
2. Before Delete, make sure no Product Master still allows this add-on.

Related pages: /master, /master/products, /inventory/addons, /production/work-center

**Not done yet / watch out**
- A changed add-on weight does not reach lines already released to the floor until someone presses "Recalculate from masters" on the WC terminal.

### Adhesives & Solvents (/master/adhesives-solvents)
Screen address: /master/adhesives-solvents · Roles: ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=master-adhesives-solvents

Read-only view of the one fixed adhesive and one fixed solvent master used for lamination.

Open it to check the code of the adhesive or solvent that GRN, issue, BOM and variance use. The chemistry is locked: you cannot add or edit records here. Vendor, location, quantity, cost and reference are entered at GRN.

**Before you start**
- Admin/Owner role or master grant.

**Step by step**
1. Check the tiles "Adhesive" and "Solvent": each should show 1 and its code. "Missing" means that master does not exist.
2. Read the "Locked chemistry policy" card for the two records.
3. Use "Filter chemistry master..." or the top search to find by name, code or status.
4. Set adhesive and solvent GSM per product in the Product Master "Adhesive" section, not here.

**What is on the screen**
- **Type / Code / System Master / Status**: Table columns: ADHESIVE or SOLVENT, its code, name and status.
- **Visible**: How many records match the current search.

**Common problems and fixes**
- "Adhesive or Solvent tile shows "Missing"" — The system record is absent. Lamination BOM cannot take chemistry; ask the system admin to restore it.

**If stuck**
1. To change consumption, edit the GSM on the Product Master, then save it.

Related pages: /master, /master/products, /inventory/grn, /inventory/addons

**Not done yet / watch out**
- The page is read-only: a new adhesive or solvent cannot be added, even when the plant changes supplier grade.

### Commercial Families (/master/commercial-families)
Screen address: /master/commercial-families · Roles: ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=master-commercial-families

Business-friendly family names (for example PET Printed Laminate) used to group and name stock in the stock explorer, planner and reports.

Open it to add or rename a business family, or to set its default form and reporting group. Film families and film variants can link to a business family so stock reads in plain words.

**Before you start**
- Admin/Owner role or master grant.

**Step by step**
1. Press "Add Business Family".
2. Fill "Code" (e.g. PET_PRINTED) and "Business Family Name".
3. Pick "Default Form" (Roll or Pouch) and "Reporting Group" (Film, Printed, Laminated, Semi-FG, FG, Packaging, Other).
4. Leave "Active" on; press "Save".
5. To change one, press "Edit" on its row; to retire it, switch Active off instead of deleting.

**What is on the screen**
- **Active**: Inactive families stay in history but drop from new naming.
- **Roll defaults / Pouch defaults tiles**: How many families default to roll or pouch stock.
- **Reporting Group**: The report bucket the family falls in.

**Common problems and fixes**
- "Create failed / Update failed / Delete failed" — Usually a duplicate code or the family is still linked. Use a new code, or set it Inactive instead of deleting.

**If stuck**
1. Only delete a family when nothing active depends on it (the delete dialog warns about this).

Related pages: /master, /master/film-families, /master/film-variants

### Film Families (/master/film-families)
Screen address: /master/film-families · Roles: ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=master-film-families

Base film materials (LDPE, HDPE, PET…) with their density, which drives weight and yield maths.

Open it to add a new base film or correct its density. Every film variant belongs to one family, so create the family first.

**Before you start**
- Admin/Owner role or master grant.
- Correct density in g/cm³ from the supplier sheet.

**Step by step**
1. Press "Add Family".
2. Fill "Family Name" (e.g. LDPE).
3. Optionally pick a "Business Family" (or "No linked business family").
4. Enter "Density (g/cm³)", e.g. 0.9200.
5. Press "Save".

**What is on the screen**
- **Density (g/cm³)**: Used by the physics layer for weight per area; a wrong value changes every BOM of that film.
- **Avg density tile**: Average density of the families in view.
- **Linked aliases tile**: Families that have a business family attached.

**Common problems and fixes**
- "Delete failed" — Variants still use this family. Move or delete those variants first.

**If stuck**
1. If weights look wrong across orders, check the density here first.

Related pages: /master/film-variants, /master/commercial-families, /master

### Film Variants (/master/film-variants)
Screen address: /master/film-variants · Roles: ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=master-film-variants

Reusable film identities (for example Standard Transparent) under a film family: whether they are made in-house, bought, or sold as trading goods.

Open it to add a film that Product Master layers, recipes and roll inward can pick. Physical grade is not set here; it is chosen on orders, recipes and roll records.

**Before you start**
- The film family exists.

**Step by step**
1. Press "Add Variant".
2. Fill "Variant Code" (e.g. F-101) and "Variant Name".
3. Pick the "Film Family" and, optionally, a "Business Family".
4. Tick "Extrudable" if we make it, "Purchasable" if we buy it.
5. Under "Sales · Trade Orders" tick "Sellable as trading good" and set "Default GST %" if it is resold.
6. Press "Save".

**What is on the screen**
- **Extrudable**: Made in-house; needs a recipe to be planned.
- **Purchasable**: Allows purchase inward. If also extrudable, GRN asks for the physical roll grade.
- **Trade sale column**: "Sellable" or "Production only".

**Common problems and fixes**
- "Delete failed" — The variant is used by layers, recipes or rolls. Keep it; do not delete used films.

**If stuck**
1. If a Product Master layer cannot find a film, check it exists here and is in the right family.

Related pages: /master/film-families, /master/recipes, /master/products, /sales/trade-orders

### Granules (/master/granules)
Screen address: /master/granules · Roles: ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=master-granules

Granule families used in extrusion recipes, and the internal grade codes the store and WCM use under each family.

Open it to add a granule family, or to add the grade codes (for example PPA-703-A) that GRN records and the WCM allocates before machine release.

**Before you start**
- Admin/Owner role or master grant.

**Step by step**
1. Press "Add Granule"; fill "Granule Code" and "Granule Name"; press "Save".
2. On a row, open "Manage internal grade codes".
3. Type one "Internal grade/code", pick "Status", add "Notes" and press "Add code".
4. For many codes open "Paste multiple grade codes", paste one per line or comma separated, press "Add all codes".
5. Edit or delete a code from the table in the same dialog.
6. Tick "Sellable as trading good" with "Default GST %" if the granule is resold.

**What is on the screen**
- **Internal grade/code**: Uppercased; stays inside this granule family. Spaces, hyphens and underscores count as the same code.
- **Granule codes tile**: Number of active code options across families.
- **Trade sale column**: "Sellable" or "Stock use only".

**Common problems and fixes**
- "Equivalent code '…' already exists in this granule family." — Same code with different spacing/hyphens already exists. Use the existing code.
- "Already present in this family: …" — Some pasted codes exist. Remove them from the paste list and retry.
- "The pasted list contains equivalent codes." — Two lines are the same code. Keep one.
- "Add no more than 100 codes at once." — Split the paste into batches of 100.

**If stuck**
1. If WCM cannot find a grade code at input issue, add it here under the right family.
2. Deleting a code keeps history; new inward and issue just stop offering it.

Related pages: /master/recipes, /inventory/grn, /production/work-center

### Printing Inks (/master/inks)
Screen address: /master/inks · Roles: ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=master-inks

Ink master by base (POLY or PET) and colour name, with swatch and mix-ink details.

Open it to add a new ink colour before artwork or the ink floor needs it, or to register a returned floor mix as a mix ink.

**Before you start**
- Admin/Owner role or master grant.

**Step by step**
1. Press "Add Ink".
2. Pick "Base Substrate": POLY (Polyethylene Base) or PET (Polyester Base).
3. Type "Color Name" (saved in capitals) and pick the "Exact Swatch" (#RRGGBB).
4. Optionally add "Internal Description".
5. For a returned mix tick "Mix Ink" and fill "Mix Family" and "Mix Notes".
6. Press "Save Ink". The code is made by the system.

**What is on the screen**
- **Mix Ink**: Returned mix colour that can be issued like normal ink.
- **POLY base / PET base / Mix inks tiles**: Counts by base and mix.

**Common problems and fixes**
- "Ink with this Base Type and Color Name already exists." — Same colour on the same base exists. Use it or change the name.
- "Use a valid #RRGGBB color." — Swatch must be # plus six hex digits, or use "Clear".

**If stuck**
1. Do not delete an ink that artworks use; it removes the colour from pickers.

Related pages: /inventory/ink-floor, /production/ink-control, /engineering/artworks

### Packaging Master (/master/packaging)
Screen address: /master/packaging · Roles: ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=master-packaging

Catalog of every packing item: inner pouches, gonnies, sheets/putha, boxes, outer bags, tape, labels, tags and others, with how each comes off stock.

Open it to add a packing item, fix its kind or weight, or link an in-house inner pouch or sheet to the Product Master that makes it. The kind decides how the packing yard uses the item: inner pouches are never in the release tick list (in-house ones come off stock at the machine's last pouching step, bought ones are booked by the evening packing count); every other active item is always in the tick list and is booked by the evening packing count.

**Before you start**
- Admin/Owner role or master grant.
- For bought inner pouches and gonnies, know the weight of one piece in kg.
- For an in-house item, a PACKAGING Product Master with sizes (use "Build production master").

**Step by step**
1. Press "Add Packaging". The "Create Packaging Material" form opens.
2. Fill "Code" and "Name".
3. Pick "Kind" ("What is this item?"). There is no default; "Save" stays off until a kind is chosen. Read the line under it: it says how the yard uses the item.
4. Pick "Supply Mode": PURCHASED for all kinds; IN_HOUSE or BOTH only for Inner pouch and Sheet · putha · board.
5. Pick "Base UOM" (PCS, KG, METER).
6. For a bought inner pouch or any gonny, enter "Weight of one … (kg)", e.g. 0.012. It goes into each dispatch unit's weight.
7. Set "Status" ACTIVE, optional "Brand / Pack Label" and, for inner pouches, "Pouches per inner pouch (default)". Press "Save".
8. For an in-house inner pouch or sheet, press "Link to Product Master" on its card, pick the master and "Size it is made in", press "Link".

**What is on the screen**
- **Kind**: Inner pouch · Gonny · Sheet · putha · board · Box · carton · Outer bag · packing pouch · Tape · Label · Tag · Other packing item. Only Inner pouch stays out of the release tick list.
- **Weight of one piece**: Only inner pouches and gonnies carry a weight. In-house pouches take it from the BOM of the linked variant; others show "No weight · counted in PCS".
- **Stock · / Restock · lines**: Stock says when the item leaves stock (at the machine for in-house inner pouches, or by the evening packing count). Restock says auto demand, by hand from the Stock launcher, or by purchase.
- **PM-backed / Needs PM link / Catalog row**: Linked to a Product Master variant; in-house but not linked (fix it); or a bought row.
- **Tiles: Total SKUs, PM-Backed, Unlinked In-House, Purchased**: Counts for the items in view. Unlinked In-House should be 0.
- **Pouches per inner pouch (default)**: For inner pouches: how many pouches go in one, used when an order line does not say. Set it so orders and the machine always know how many inner pouches to count.

**Common problems and fixes**
- "Enter the weight of one pouch/gonny in kg; it goes into the dispatch unit weight." — Bought inner pouch or gonny saved without weight. Enter the weight of one piece.
- "<KIND> cannot be IN_HOUSE in this phase." — Only Inner pouch and Sheet may be IN_HOUSE or BOTH. Choose PURCHASED.
- "packaging_kind is required for packaging materials." — Pick a kind before saving.
- "Item is missing from the release tick list" — Its kind is Inner pouch or it is INACTIVE. Edit it, set the right kind (e.g. Sheet · putha · board for Putha) and ACTIVE.
- "Missing. Link it to its packaging Product Master variant" — In-house inner pouch has no BOM weight. Link it to the master that makes it.

**If stuck**
1. If the link dialog says "No active packaging Product Master yet", use "Create one in Product Master", add sizes, activate, then link.
2. Delete has no confirmation; prefer setting INACTIVE for items that were ever used.

Related pages: /master/products, /inventory/packaging, /logistics/packing, /dashboard/planner/control-tower/stock-launcher

**Not done yet / watch out**
- "Delete" on a packaging card deletes at once with no confirmation dialog.
- A bought inner pouch card says it is taken off stock by the evening packing count, while inner pouches are never in the release tick list; only in-house inner pouches are taken at the machine.
- Only Inner pouch and Sheet can be IN_HOUSE or BOTH; boxes, tape and other items cannot be marked as made in-house.

### POD Master (/master/pod)
Screen address: /master/pod · Roles: ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=master-pod

Fixed POD roll SKUs (single or double) with height, thickness, panels and density, and the Product Master variant that makes each one.

Open it to add or correct a POD roll SKU or to link it to its POD Product Master. SKU rows are created only on this page; Product Master variants link here for in-house production and stock tracking.

**Before you start**
- Admin/Owner role or master grant.
- A POD Product Master if it is made in-house.

**Step by step**
1. Press "Add POD Roll".
2. Fill "Code", "Name", "POD Type" (Single/Double) and "Status".
3. Enter "Fixed Height (mm)", "Thickness (micron)", "Panel Count" and "Density (g/cm3)"; all must be above 0.
4. Tick "In-house capable" if we make it; press "Save".
5. On the card press "Link to Product Master", pick the POD master and size, press "Link".
6. Check "POD SKU Variants" on the card shows the variant row.

**What is on the screen**
- **POD Type**: Single or Double film; double defaults to 2 panels.
- **Core POD rows (code starts with POD-)**: Code cannot be changed and there is no Delete button.
- **PM-Linked / Unlinked In-House tiles**: Linked SKUs and in-house SKUs still without a master link.

**Common problems and fixes**
- "Core POD code cannot be changed." — System POD rows keep their code; change only the name or sizes.
- "Core POD materials cannot be deleted." — Set it Inactive instead.
- "Height must be > 0 / Thickness must be > 0 / Panel count must be > 0 / Density must be > 0" — Enter positive numbers.

**If stuck**
1. If in-house POD demand does not plan, check the card is PM-linked.

Related pages: /master/products, /master, /dashboard/planner/control-tower/stock-launcher

### Pouch shapes + formulas (/master/pouch-styles)
Screen address: /master/pouch-styles · Roles: ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=master-pouch-styles

List of pouch styles: allowed size fields, the child stock-width formula and the film-area formula used for BOM, costing and roll allocation.

Open it to find a style, see how many sizes use it, or start a new one. Each Product Master pouch size is bound to an approved style.

**Before you start**
- Admin/Owner role with the master.manage grant.

**Step by step**
1. Search by code, name or formula.
2. Read the chips "Styles", "Locked" and "Used by sizes".
3. Press "Open" on a row to view or edit the style.
4. Press "New pouch style" (or "Build first pouch style" on an empty list) to create one.

**What is on the screen**
- **Columns: Code, Name, Formula, Stock form, Area formula, Slit, Sizes, Status**: Slit shows whether WCM may slit wider rolls; Sizes is how many Product Master sizes use it; a lock badge means approved.

**Common problems and fixes**
- "Style not in the Product Master size picker" — It is a draft or disabled. Open it and press "Save + approve + lock" or "Reactivate".

**If stuck**
1. Only the latest version of each code is listed; older versions stay linked to old sizes.

Related pages: /master/pouch-styles/new, /master/products

### Pouch style editor (/master/pouch-styles/[id])
Screen address: /master/pouch-styles/[id] · Roles: ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=master-pouch-styles-id

Edit one pouch style: its fields, width and area formulas, roll axis, stock form, and approve, disable or reactivate it.

Open it from the Pouch styles list ("Open"). Changing an approved style makes a new draft version; sizes move to it only after approval.

**Before you start**
- Admin/Owner role with the master.manage grant.
- Know the pouch shape: which size fields it needs and how the roll width is worked out.

**Step by step**
1. Fill "Code" (fixed for ever), "Name", optional "Emoji", "Sort order" and "Description".
2. Under "Allowed input fields" keep Width (W) and Height (H) and use "Add a field" for Gusset, Flap reach, Seal overlap, Bottom factor, Stick factor or Direct roll width.
3. Build the "Child-width formula builder": child stock width = sum of (coefficient × field) + trim. "Quick presets" fill common shapes (Pillow / 3-side, Stand-up · K-bottom, Side gusset, Quad seal, Center seal · H-axis, Stick pack…).
4. Set "Roll axis policy" (web from W-side or H-side), "Default stock form", "Stored width means" (Open-web, Lay-flat, Folded) and "Allocator rule" (Slitting allowed / Exact width only).
5. Check the "Live preview": Child stock width, Film area width, Pitch side, Area / pouch.
6. Press "Create draft" / "Save draft", then "Save + approve + lock". Only approved styles appear on Product Master sizes.

**What is on the screen**
- **Approved style · N sizes use it**: Saving real changes creates a new draft (next version). Sizes keep their saved copy until the new draft is approved.
- **Draft style · not selectable yet**: Hidden from Product Master size pickers until approved.
- **Allocator rule**: Slitting allowed lets WCM slit wider parent rolls; Exact width only demands the exact width.
- **Shaped (operator types width)**: For odd shapes: the width is typed on each size instead of a formula.
- **Disable / Reactivate**: Disable hides the style from pickers but keeps history; Reactivate brings it back.

**Common problems and fixes**
- "Disabled pouch styles cannot be approved. Reactivate it first." — Press "Reactivate", then approve.
- "Formula consumes width/height … but the declared roll axis is …" — The formula uses the other side. Change "Roll axis policy" to the side named in the message.
- "Custom AST mode requires a non-empty AST." — Add at least one term to the formula.
- "No changes to save" — The locked style is unchanged; nothing to save.

**If stuck**
1. If a size shows the wrong roll width, open its style here and check the live preview with the same W, H and gusset.
2. Lane-up is not set here; it belongs to the web-width policy and the sales order.

Related pages: /master/pouch-styles, /master/products, /master/web-width-policies

**Not done yet / watch out**
- Editing an approved style does not change existing sizes until the new draft is approved; sizes keep the old version's copy.

### Build a pouch shape (/master/pouch-styles/new)
Screen address: /master/pouch-styles/new · Roles: ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=master-pouch-styles-new

Create a new pouch style as a draft, then approve and lock it so Product Master sizes can use it.

Open it from "New pouch style" when a pouch shape is not in the list yet. After approval the style shows in the size editor of every Product Master.

**Before you start**
- Admin/Owner role with the master.manage grant.
- Know the pouch shape: which size fields it needs and how the roll width is worked out.

**Step by step**
1. Fill "Code" (fixed for ever), "Name", optional "Emoji", "Sort order" and "Description".
2. Under "Allowed input fields" keep Width (W) and Height (H) and use "Add a field" for Gusset, Flap reach, Seal overlap, Bottom factor, Stick factor or Direct roll width.
3. Build the "Child-width formula builder": child stock width = sum of (coefficient × field) + trim. "Quick presets" fill common shapes (Pillow / 3-side, Stand-up · K-bottom, Side gusset, Quad seal, Center seal · H-axis, Stick pack…).
4. Set "Roll axis policy" (web from W-side or H-side), "Default stock form", "Stored width means" (Open-web, Lay-flat, Folded) and "Allocator rule" (Slitting allowed / Exact width only).
5. Check the "Live preview": Child stock width, Film area width, Pitch side, Area / pouch.
6. Press "Create draft" / "Save draft", then "Save + approve + lock". Only approved styles appear on Product Master sizes.

**What is on the screen**
- **Approved style · N sizes use it**: Saving real changes creates a new draft (next version). Sizes keep their saved copy until the new draft is approved.
- **Draft style · not selectable yet**: Hidden from Product Master size pickers until approved.
- **Allocator rule**: Slitting allowed lets WCM slit wider parent rolls; Exact width only demands the exact width.
- **Shaped (operator types width)**: For odd shapes: the width is typed on each size instead of a formula.
- **Disable / Reactivate**: Disable hides the style from pickers but keeps history; Reactivate brings it back.

**Common problems and fixes**
- "Disabled pouch styles cannot be approved. Reactivate it first." — Press "Reactivate", then approve.
- "Formula consumes width/height … but the declared roll axis is …" — The formula uses the other side. Change "Roll axis policy" to the side named in the message.
- "Custom AST mode requires a non-empty AST." — Add at least one term to the formula.
- "No changes to save" — The locked style is unchanged; nothing to save.

**If stuck**
1. If a size shows the wrong roll width, open its style here and check the live preview with the same W, H and gusset.
2. Lane-up is not set here; it belongs to the web-width policy and the sales order.

Related pages: /master/pouch-styles, /master/products, /master/web-width-policies

### Product Master (/master/products)
Screen address: /master/products · Roles: ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=master-products

Catalog of everything we can make: pouch, roll, packaging, POD and other masters, with their route, sizes, layers and variants.

Open it to find a master, create a new one, clone one, or disable/restore one. Sales orders take every line from an active Product Master, and the planner and floor follow its route and BOM. The address ?kind=PACKAGING or ?kind=POD opens the list already filtered.

**Before you start**
- Admin/Owner role with the master.manage grant (Sales picks products in the order composer without opening masters).
- Live route templates, film variants and approved pouch styles exist.

**Step by step**
1. Pick "Active catalog" or "Disabled / audit".
2. Use "Filters": search code or name, "Kind" (All, Pouch, Roll, Packaging, POD, Other), "Reporting group", and "Capabilities" (Catalog-linked axes, Print capable, Has overlays). "Clear all" resets.
3. Read each card's "N/N ready" pill and the checks: route, sizes, layers or variants, SKU links.
4. Press "Open" to see a master, "Clone" to copy it, "Disable" / "Restore" to retire or bring back.
5. Press "New Product Master": pick the "Product kind", fill "Master code", "Reporting group", "Master name", pick the "Live route" (required) and the "Number of layers".
6. Press "Create & open workspace". The master is created inactive; finish films, sizes and policies in the editor, then activate it.
7. Press "Show 60 more" to load more cards.

**What is on the screen**
- **Product kind**: Finished pouch, Roll / film, Packaging (inner pouch or sheet/wrap), POD, Other. Packaging and POD masters are production masters: the stock launcher launches them, sales never picks them.
- **Tiles: Active, Disabled, Variants 90d, Overlays, Print capable, Catalog-linked axes**: Counts across the catalog.
- **Clone (Save as active replacement)**: Copies sizes, axes, packing/POD settings; you can change route and layer stack. The replacement option disables the old master; old orders keep their frozen record.
- **Sizes / Axes / Variants / Overlays or SKU Links**: Number strip at the bottom of each card.

**Common problems and fixes**
- "Product Master code already exists. Try a different code." — Use a new code.
- "Required: pick the route template this master will use" — Pick a live route before "Create & open workspace".
- "A superseded Product Master revision cannot be restored." — It was replaced; use the current replacement or clone a new revision.

**If stuck**
1. A master missing from the order composer is usually inactive or disabled; open it and check "Master active".
2. Disabled masters stay in "Disabled / audit"; old orders still open them.

Related pages: /master/products/[id], /master/products/[id]/edit, /master/packaging, /master/pod, /engineering/templates, /sales/orders/create

### Product Master view (/master/products/[id])
Screen address: /master/products/[id] · Roles: ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=master-products-id

Read-only view of one Product Master in tabs: Overview, Layer template, Variants, Sizes, Customer overlays, Artworks and Audit trail.

Open it to check what a product is made of before quoting or planning, to add a customer overlay, or to start a new variant. Use "Edit" to change the master.

**Before you start**
- Admin/Owner role with the master.manage grant (Sales picks products in the order composer without opening masters).

**Step by step**
1. Read the header: code, name, kind, route, print and size count.
2. Open "Layer template" for each layer's film, micron and grade, plus adhesive and solvent.
3. Open "Sizes" to see every size with web width and inches.
4. Open "Variants" for every shippable configuration; click a cell for the live BOM; press "Create variant" to add one.
5. Open "Customer overlays" and press "Add overlay" to set customer-specific defaults for sales entry (not shown for packaging/POD masters).
6. Use "Edit", "Duplicate" or "Disable" / "Restore" in the header; "Open in Sales create" starts an order with this master.

**What is on the screen**
- **Variants tab**: Axis tuples — every shippable configuration; pivot any two axes.
- **Customer overlays**: Who the overlay is for and what sales auto-picks for that customer; it still uses the master's engineering BOM.
- **Artworks tab**: Approved artworks that match this master's print method and form.
- **Audit trail**: Every change with who, when and the difference.

**Common problems and fixes**
- "Could not load product master." — Wrong link or no access. Go back to the list and open it again.

**If stuck**
1. If the view looks out of date after an edit, refresh the page.

Related pages: /master/products, /master/products/[id]/edit, /master/products/[id]/variants/new, /sales/orders/create

**Not done yet / watch out**
- Packaging and POD masters hide the Customer overlays tab and the "Open in Sales create" link because sales never orders them.

### Product Master editor (/master/products/[id]/edit)
Screen address: /master/products/[id]/edit · Roles: ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=master-products-id-edit

The full editor of one Product Master in three parts: What it is, What is fixed, and What sales choose.

Open it with "Edit" to set the route, layers, printing rules, adhesive, sales permissions, sizes (by hand or from the Excel size sheet), add-ons and packing. Saving refreshes open order snapshots that use the master.

**Before you start**
- Admin/Owner role with the master.manage grant (Sales picks products in the order composer without opening masters).
- Film variants, approved pouch styles, add-ons and packaging items exist.

**Step by step**
1. Use the section list (Basics, Summary, Layers, Printing, Adhesive, What sales can change, Sizes & web width, Add-ons & packing) to jump.
2. Basics: check "Master name", "Product kind", "Live route / template"; for packaging pick the "Packing sub-type" (Inner pouch carrier or Sheet / Roll for packing).
3. Layers: "Add layer", pick the default film, μ thickness and grade; use "+ Add allowed film" for approved alternates.
4. Printing: pick "No printing", "Print capable · artwork OPTIONAL" or "Print compulsory · artwork REQUIRED", and the "Allowed print method" (FLEXO or ROTO).
5. Adhesive: pick the adhesive and solvent and their GSM.
6. Sizes & web width: "Add size", or "Excel sheet" to download the .xlsx, fill it, then "Bulk upload" → "Review size import" → "Confirm import". Blank codes and labels are made from the size ("auto from size").
7. Add-ons & packing: allow inner pouches, POD and add-ons; choose "Default inner pouch" and "Pouches per inner".
8. Check the save checklist (code & name, live route, at least one size and layer, each layer has a film, printing gate) and press "Save master". Nothing in sizes is saved until this press.

**What is on the screen**
- **Master active**: Only active masters show to sales and the planner.
- **Sales ad-hoc permissions (Off / Optional / Required)**: Whether sales may add a new value (for example a new pouch size) inside this master. Off axes stay blocked.
- **Auto-fire in-house stock launcher on shortage**: When on, a short in-house inner pouch or POD raises in-house demand at order confirm.
- **Size code**: Roll: 500 or 500X45; pouch: 140X305 or 140X305G40. Inches are shown beside mm, never typed.
- **Pouch style (per size)**: Each pouch size binds an approved pouch style that gives the roll width.
- **Per-layer roll-width override**: Advanced fallback input roll width for BOM when the order has no size-level override.

**Common problems and fixes**
- "Layer N must select a valid film variant before the Product Master is active." — Pick a film for every layer.
- "Layer N grade is required unless the selected film variant is purchasable-only or grade is a per-layer axis." — Pick a grade for that layer.
- "Size code "680" is already on this master (in use)." — Search the size list for that code and edit that row instead of adding a new one.
- "Enter the size (width and height, or the roll width) and the code is made from it, or type a code." — A size row has no dimensions and no code. Fill the size.
- "This is not a readable Excel file. Save it as .xlsx and upload again. / The first row must be the column names (download the template). / The sheet is larger than 5 MB." — Use the downloaded "Excel sheet" template, keep its header row, save as .xlsx or .csv under 5 MB.
- "Product Master code is an internal immutable identity. Update the name instead." — The code cannot change; change the name.

**If stuck**
1. Imported sizes stay in the draft until "Save master"; if you leave the page they are lost.
2. Removing a size retires it; a new row with the same code brings the retired size back.
3. If an in-house inner pouch shows "No product master is linked to make this pouch", link it on the Packaging master.

Related pages: /master/products/[id], /master/pouch-styles, /master/packaging, /master/pod, /master/add-ons, /master/film-variants, /engineering/templates

**Not done yet / watch out**
- Imported or added sizes are only a draft until "Save master"; leaving the page loses them without a warning in the size sheet flow.

### New variant (/master/products/[id]/variants/new)
Screen address: /master/products/[id]/variants/new · Roles: ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=master-products-id-variants-new

Configure one variant of a Product Master: size and axis values, per-layer thickness, grade and width, add-ons and artwork mode, with a live material breakdown.

Open it from "Create variant" on the master's Variants tab when a stockable or sellable configuration must exist ahead of orders (for example a packaging or POD variant to link to a catalog SKU).

**Before you start**
- Admin/Owner role with the master.manage grant (Sales picks products in the order composer without opening masters).
- The master has sizes and layers saved.

**Step by step**
1. Check "Configuring a variant of" shows the right master.
2. Set the "Required axes" (for example Size); the "Variant code (live)" updates.
3. Check "Per-layer thicknesses · grades · widths"; defaults come from the master.
4. Pick add-ons and the artwork mode if needed.
5. Read "Material breakdown" (per 1,000 kg) and "Stock match preview".
6. Press "Save variant" (or "Save as preset").

**What is on the screen**
- **Variant code (live)**: Built from the axis values; VALID · NEW means it does not exist yet.
- **Pricing reference**: Customer overlay prices for reference only.

**Common problems and fixes**
- "Could not save variant" — A required axis is empty or the tuple already exists. Fill the axes or open the existing variant.

**If stuck**
1. Press "Back to master" to cancel without saving.

Related pages: /master/products/[id], /master/packaging, /master/pod

### Extrusion Recipes (/master/recipes)
Screen address: /master/recipes · Roles: ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=master-recipes

Granule-family formulations for extruded film, one per film variant + grade + thickness range, with revision history.

Open it to create the recipe a new extruded film needs, or to publish a new revision of percentages. Saving refreshes open BOMs and planner queues; released jobs stay on their old formulation.

**Before you start**
- Extrudable film variant, grade (Grade Master) and granule families exist.

**Step by step**
1. Press "Add Recipe".
2. Pick "Film Variant" and "Grade" (add grades with "Grade Master"), and "Min Thickness (μ)" / "Max Thickness (μ)".
3. Under "Family formulation" press "Add family row", pick each "Granule family" and its "Recipe %".
4. Use "Balance to 100%" until the total is 100.00%.
5. Press "Save family recipe". For an edit, write a "Revision reason" and press "Publish revision vN".
6. Read the result card: Open BOMs refreshed, Queues rebuilt, Frozen history, Needs review.

**What is on the screen**
- **Exact recipe contract**: Variant + grade + thickness range; locked after creation.
- **Matching lines / Will refresh / Stay frozen / Released**: Impact of an edit on order lines.
- **Disable**: Stops new orders resolving this contract; history and released jobs stay.

**Common problems and fixes**
- "Total percentage must be 100.00%." — Use "Balance to 100%".
- "An active recipe already exists for … / Thickness range overlaps with active recipe …" — Edit that recipe, or disable it before creating a new range.
- "Recipe identity is locked after creation …" — To change variant, grade or thickness, disable and create a new recipe.
- "Each granule can be used only once in a recipe." — Merge duplicate rows.
- "Recipes are production history and cannot be deleted. Disable the recipe instead." — Use "Disable".

**If stuck**
1. If "Needs review" is above zero, tell the planner: some open lines could not be refreshed.

Related pages: /master/granules, /master/film-variants, /dashboard/planner/control-tower/plan-queue

**Not done yet / watch out**
- A recipe's variant, grade or thickness range cannot be edited; it must be disabled and recreated.

### Items we resell (/master/trading-goods)
Screen address: /master/trading-goods · Roles: ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=master-trading-goods

List of trading goods with stock, sale rate and GST per item.

Open it to find or add an item that is sold through Trade Orders without being made in the plant.

**Before you start**
- Admin/Owner role or master grant.

**Step by step**
1. Search by code, name or HSN.
2. Read the chips Total, Active and Stock units.
3. Click a card to edit it.
4. Press "New trading good" (or "Add first trading good") to create one.

**What is on the screen**
- **Card: Stock, Sale ₹, GST %**: Current stock in base UOM, default sale rate and GST; badge shows active/inactive, trade form and HSN.

**Common problems and fixes**
- "No trading goods yet" — Nothing created; add the first item.

**If stuck**
1. Inactive items still show here but not in trade order pickers.

Related pages: /master/trading-goods/new, /sales/trade-orders, /inventory/adjustments

### Edit trading good (/master/trading-goods/[id])
Screen address: /master/trading-goods/[id] · Roles: ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=master-trading-goods-id

Edit one trading good's identity, pricing defaults and status, and see its stock by plant.

Trading goods are items we resell as they are (ready pouches, ready rolls, packing items, raw material). They have their own stock pool and are sold through Trade Orders. Stock is changed only by Stock Adjustments, not here.

**Before you start**
- Admin/Owner role or master grant.

**Step by step**
1. Fill "Code *" and "Name *" (both required).
2. Pick "Base UOM" (Pieces, Kilograms, Meters, Rolls, Boxes) and "Trade form" (Ready pouch, Ready roll, Packing item, Raw material, Other).
3. Add "HSN code" and "Description".
4. Under "Pricing defaults" set "Default GST %", "Default sale rate (₹)", "Default buy rate (₹)"; they prefill Trade Order lines.
5. Keep "Status" Active (toggle off to retire) and press "Create trading good" / "Save changes".
6. On an existing item read "Stock by plant"; to change stock press "Open Stock Adjustments →".

**What is on the screen**
- **Status (Active)**: Inactive items are hidden from trade order pickers.
- **Stock by plant**: Read-only: Plant, Qty, Avg cost, Updated.

**Common problems and fixes**
- "Missing fields: Code and name are required" — Fill both before saving.
- "Save failed" — Often a duplicate code. Use another code.
- "No stock recorded yet" — Seed opening stock with a Stock Adjustment.

**If stuck**
1. Press "Back to list" to leave without saving.

Related pages: /master/trading-goods, /sales/trade-orders, /inventory/adjustments

**Not done yet / watch out**
- There is no delete for a trading good; retire it by switching Status off. Stock cannot be edited here.

### Add a trading good (/master/trading-goods/new)
Screen address: /master/trading-goods/new · Roles: ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=master-trading-goods-new

Create a new trading good: code, name, unit, trade form, HSN and pricing defaults.

Trading goods are items we resell as they are (ready pouches, ready rolls, packing items, raw material). They have their own stock pool and are sold through Trade Orders. Stock is changed only by Stock Adjustments, not here.

**Before you start**
- Admin/Owner role or master grant.

**Step by step**
1. Fill "Code *" and "Name *" (both required).
2. Pick "Base UOM" (Pieces, Kilograms, Meters, Rolls, Boxes) and "Trade form" (Ready pouch, Ready roll, Packing item, Raw material, Other).
3. Add "HSN code" and "Description".
4. Under "Pricing defaults" set "Default GST %", "Default sale rate (₹)", "Default buy rate (₹)"; they prefill Trade Order lines.
5. Keep "Status" Active (toggle off to retire) and press "Create trading good" / "Save changes".
6. On an existing item read "Stock by plant"; to change stock press "Open Stock Adjustments →".

**What is on the screen**
- **Status (Active)**: Inactive items are hidden from trade order pickers.
- **Stock by plant**: Read-only: Plant, Qty, Avg cost, Updated.

**Common problems and fixes**
- "Missing fields: Code and name are required" — Fill both before saving.
- "Save failed" — Often a duplicate code. Use another code.
- "No stock recorded yet" — Seed opening stock with a Stock Adjustment.

**If stuck**
1. Press "Back to list" to leave without saving.

Related pages: /master/trading-goods, /sales/trade-orders, /inventory/adjustments

### Vendors (/master/vendors)
Screen address: /master/vendors · Roles: ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=master-vendors

Supplier, job-worker and service-provider master used by GRN, purchase orders and job work.

Open it to add or edit a vendor, its tax, contact, addresses, payment terms and job-work rate card. Store staff use the same vendors from Stock → Vendors (/inventory/vendors).

**Before you start**
- Admin/Owner role or master grant.

**Step by step**
1. Press "Add Vendor".
2. Fill "Vendor Code", "Vendor Name", "Type" (Raw Material Supplier, Job Worker, Service Provider, Both (Supplier & JW)) and "Status".
3. Add GST No, PAN No, Contact Person, Email, Phone and "Lead Time (Days)".
4. Fill "Primary Mailing Address"; add branches under "Additional Mailing Details".
5. Set "Credit Period (Days)", "Payment Terms", "Bank Details", TDS/TCS switches.
6. For job workers fill "Jobwork controls" and the "Job-work rate card" (process code, rate ₹, unit per piece/kg/metre/roll).
7. Press "Update Vendor" / save.

**What is on the screen**
- **Status**: Active, Inactive or Blacklisted.
- **QC Required on Return**: Job-work returns stay blocked for QC when on.
- **Job-work rate card**: Agreed labour rate per process excluding GST; new job-work orders use it and bills are checked against it.
- **Tiles: Partners, Active, Jobwork ready, QC required**: Vendor counts by state.

**Common problems and fixes**
- "Name is required / Code is required" — Fill both.
- "This process and unit already has a rate" — Keep one rate per process and unit.
- "Failed to delete" — The vendor is linked to stock or documents. Set it Inactive instead.

**If stuck**
1. Delete cannot be undone; prefer Inactive or Blacklisted.

Related pages: /inventory/vendors, /inventory/grn, /procurement/purchase-orders, /inventory/job-work

**Not done yet / watch out**
- /master/vendors opens only for Admin/Owner; store staff must use /inventory/vendors for the same vendors.

### Lane-up and parent-web rules (/master/web-width-policies)
Screen address: /master/web-width-policies · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANNER · Share link: https://erp.totalpolyprint.com/guide?page=master-web-width-policies

List of web-width policies: allowed lane counts, how child width becomes parent web width, and how WCM treats slit remainders.

Sales-order lines use the effective policy to check lane-up and work out the planned parent width; WCM uses it for remainder keep/scrap. Open it to see which policy is default or to open one.

**Before you start**
- Admin, Owner or Planner role.

**Step by step**
1. Read the chips Policies and Default.
2. Search by code, name or description.
3. Compare the "440 mm sample" column: std width selected or calculated parent.
4. Press "Open" on a row, or "New policy" to add one.

**What is on the screen**
- **Columns: Code, Name, Scope, Lanes, Parent strategy, 440 mm sample, Remainder, Status**: Summary of each policy with a worked example for a 440 mm child.

**Common problems and fixes**
- "No policies match." — Clear the search.
- "No web-width policy configured yet." — Create a Global fallback default policy.

**If stuck**
1. Keep exactly one Default policy as the global fallback.

Related pages: /master/web-width-policies/new, /sales/orders/create, /master/pouch-styles

### Web-width policy (/master/web-width-policies/[id])
Screen address: /master/web-width-policies/[id] · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANNER · Share link: https://erp.totalpolyprint.com/guide?page=master-web-width-policies-id

Edit one lane-up and parent-web policy, preview it, or delete it.

Open it from the policy list. Changes apply to new sales-order line calculations and WCM remainder decisions. "Delete" asks "Delete this policy?" first.

**Before you start**
- Admin, Owner or Planner role.

**Step by step**
1. Fill "Code (unique)", "Name", "Description"; tick "Default policy" only for the plant-wide default.
2. Pick "Scope" (Global fallback, Product kind, Product master, Pouch style, Process, Machine) and its "Scope ref".
3. Tick "Allowed lane counts" (1–12); the sales-order lane picker shows only these.
4. Pick the "Strategy": Calculated width, Nearest standard parent, or Require standard parent; set Min/Max parent width and "Standard parent widths" (e.g. 880, 1320, 1500).
5. Set the "Slitting trim rule": Inter-cut trim, Edge trim and Formula (PER_CUT, PER_LANE, FIXED).
6. Set "Min remainder to keep (mm)" and "Prefer remainders first".
7. Check the "Live preview" with a child width and lane, then press "Create policy" / "Save changes".

**What is on the screen**
- **Strategy**: Calculated keeps exact maths; Nearest standard snaps to the next configured width; Require standard blocks the order if no configured width fits.
- **Min remainder to keep (mm)**: Remainders narrower than this go to scrap.

**Common problems and fixes**
- "Lane count must be between 1 and 12." — Pick lanes 1–12.
- "Scope reference is required for non-global policies." — Pick the Scope ref.
- "Strict standard mode needs at least one parent width." — Add a standard width or change the strategy.
- "Max parent width must be greater than min parent width." — Fix the min/max.

**If stuck**
1. If an order line refuses a lane count, check which policy applies to its product and add the lane here.

Related pages: /master/web-width-policies, /sales/orders/create, /production/work-center

### New web-width policy (/master/web-width-policies/new)
Screen address: /master/web-width-policies/new · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANNER · Share link: https://erp.totalpolyprint.com/guide?page=master-web-width-policies-new

Create a lane-up and parent-web policy for a scope.

Open it from "New policy" when a product kind, master, pouch style, process or machine needs its own lane or parent-width rule.

**Before you start**
- Admin, Owner or Planner role.

**Step by step**
1. Fill "Code (unique)", "Name", "Description"; tick "Default policy" only for the plant-wide default.
2. Pick "Scope" (Global fallback, Product kind, Product master, Pouch style, Process, Machine) and its "Scope ref".
3. Tick "Allowed lane counts" (1–12); the sales-order lane picker shows only these.
4. Pick the "Strategy": Calculated width, Nearest standard parent, or Require standard parent; set Min/Max parent width and "Standard parent widths" (e.g. 880, 1320, 1500).
5. Set the "Slitting trim rule": Inter-cut trim, Edge trim and Formula (PER_CUT, PER_LANE, FIXED).
6. Set "Min remainder to keep (mm)" and "Prefer remainders first".
7. Check the "Live preview" with a child width and lane, then press "Create policy" / "Save changes".

**What is on the screen**
- **Strategy**: Calculated keeps exact maths; Nearest standard snaps to the next configured width; Require standard blocks the order if no configured width fits.
- **Min remainder to keep (mm)**: Remainders narrower than this go to scrap.

**Common problems and fixes**
- "Lane count must be between 1 and 12." — Pick lanes 1–12.
- "Scope reference is required for non-global policies." — Pick the Scope ref.
- "Strict standard mode needs at least one parent width." — Add a standard width or change the strategy.
- "Max parent width must be greater than min parent width." — Fix the min/max.

**If stuck**
1. If an order line refuses a lane count, check which policy applies to its product and add the lane here.

Related pages: /master/web-width-policies, /sales/orders/create, /production/work-center

## हर स्क्रीन (हिंदी)

### Master Data (/master)
स्क्रीन का पता: /master · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=master&lang=hi

सभी मास्टर रजिस्टर का मुख्य पेज: हर मास्टर (film, ink, adhesive, recipe, granule, customer, vendor, add-on, packaging, trading goods, POD) का एक कार्ड, उसके रिकॉर्ड की गिनती के साथ।

जब कोई मास्टर sidebar टैब में न दिखे या देखना हो कि किस मास्टर में कितने रिकॉर्ड हैं, तब यह पेज खोलें। कार्ड पर क्लिक करते ही वह मास्टर खुल जाता है। Product master, pouch style और web-width policy इस पेज पर नहीं हैं; उन्हें Products workspace के टैब से खोलें।

**शुरू करने से पहले**
- Admin, Owner या Super admin रोल, या अलग से दिया गया master.view / master.manage अधिकार।

**स्टेप बाय स्टेप**
1. "Search master data registries..." में नाम या विवरण लिखकर कार्ड छाँटें।
2. ऊपर की चार टाइल देखें: "Total masters", "Materials", "Partners" और "Recipes"।
3. हर कार्ड पर "N Records" देखें। "Loading" का मतलब गिनती आ रही है; "Access error" का मतलब आपका रोल वह मास्टर नहीं पढ़ सकता।
4. कार्ड पर क्लिक करके मास्टर खोलें (जैसे "Packaging" से /master/packaging, "Customers" से /sales/customers)।

**स्क्रीन पर क्या है**
- **Total masters**: इस पेज पर दिखने वाले रजिस्टर की तय संख्या (13)।
- **Materials**: Film family + film variant + ink + adhesive/solvent + granule + trading goods का जोड़।
- **Partners**: Customer और vendor का जोड़।
- **Recipes**: Extrusion recipe (formulation) की संख्या।
- **Live बैज**: हर कार्ड पर "Live" दिखता है; इसका मतलब यह नहीं कि मास्टर पूरा भरा है।

**आम दिक्कतें और हल**
- "Recipes कार्ड पर Access error" — आपका अकाउंट recipe नहीं पढ़ सकता। Admin से master अधिकार माँगें।
- "पेज नहीं खुलता" — Master पेज सिर्फ Admin/Owner/Super admin या master अधिकार वाले के लिए खुलते हैं, पता टाइप करने पर भी।

**अटक गए तो**
1. अगर कार्ड "Loading" पर रुका रहे तो पेज refresh करें।
2. Product master, Pouch style और Web-width policy के लिए Products workspace के टैब इस्तेमाल करें।

जुड़े पेज: /master/commercial-families, /master/film-families, /master/film-variants, /master/inks, /master/adhesives-solvents, /master/recipes, /master/granules, /sales/customers, /master/vendors, /master/add-ons, /master/packaging, /master/trading-goods, /master/pod, /master/products

**अभी नहीं होता / ध्यान दें**
- Master Data पेज पर Product Master, Pouch style और Web-width policy के कार्ड नहीं हैं; ये सिर्फ Products workspace टैब से खुलते हैं।
- हर कार्ड पर "Live" बैज दिखता है चाहे master कैसा भी हो, और "Total masters" हमेशा 13 है।

### Add-ons & Misc Materials (/master/add-ons)
स्क्रीन का पता: /master/add-ons · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=master-add-ons&lang=hi

Zipper, spout, handle, valve जैसे attachment का मास्टर: हर bag में कितना वज़न लगता है और store इसे खरीदता है या नहीं।

जब किसी order में नया attachment लगना हो या add-on का वज़न गलत हो, तब यह पेज खोलें। Product Master में वही add-on चुने जा सकते हैं जो यहाँ हैं; order का BOM यहीं का वज़न लेता है। वज़न बदलकर save करने पर उस add-on वाली हर खुली, release न हुई order line फिर से गिनी जाती है।

**शुरू करने से पहले**
- Admin/Owner रोल या master अधिकार।
- Add-on का असली वज़न पता हो (प्रति piece या प्रति mm लंबाई ग्राम)।

**स्टेप बाय स्टेप**
1. "Add Addon" दबाएँ।
2. "Addon Code" (जैसे ZIP-25) और "Description" भरें।
3. "Consumption Mode" चुनें: "Per Millimeter", "Per Piece" या "Fixed Weight"।
4. वज़न ग्राम में भरें। Per Millimeter में "The weight above is given per" से 1 mm या 10 mm चुनें।
5. "Check: one piece on a 280 mm wide bag" बॉक्स देखें; प्रति bag ग्राम सही लगना चाहिए।
6. अगर store इसे inward करता है तो "Purchasable?" Yes करें और "Purchase UOM" (KG, PCS, METER) चुनें।
7. "Save" दबाएँ। Edit पर toast पढ़ें: कितनी खुली lines refresh हुईं और कितनी skip हुईं।

**स्क्रीन पर क्या है**
- **Consumption Mode**: Per Millimeter = bag की चौड़ाई के साथ वज़न बढ़ता है; Per Piece = हर bag पर एक जैसा ग्राम; Fixed Weight = एक तय वज़न।
- **Weight basis (1 mm / 10 mm)**: सिर्फ Per Millimeter के लिए। आपने जो ग्राम लिखा वह 1 mm का है या 10 mm का।
- **Purchasable?**: Yes से store इसे खरीदा हुआ stock inward कर सकता है; stock unit Purchase UOM बन जाती है। No पर stock unit KG रहती है।
- **Columns: Code, Name, Mode, Weight (g), Purchasable, Stock UOM**: सभी add-on की table, हर row पर Edit और Delete।

**आम दिक्कतें और हल**
- "Saved, but open lines could not be refreshed: …" — Add-on save हो गया पर खुले orders फिर से नहीं गिने गए। Planner को बताएँ; release हो चुकी lines के लिए WC terminal पर "Recalculate from masters" दबाएँ।
- "Code is required / Name is required / Value must be positive" — Code, description और 0 या उससे ज़्यादा वज़न भरें।

**अटक गए तो**
1. अगर release हुए job में पुराना वज़न दिखे, तो work-centre terminal पर "Recalculate from masters" दबाएँ।
2. Delete से पहले देख लें कि कोई Product Master इस add-on को अब भी allow तो नहीं करता।

जुड़े पेज: /master, /master/products, /inventory/addons, /production/work-center

**अभी नहीं होता / ध्यान दें**
- Add-on का बदला वज़न floor पर release हुई lines तक तब तक नहीं पहुँचता जब तक WC terminal पर "Recalculate from masters" न दबाया जाए।

### Adhesives & Solvents (/master/adhesives-solvents)
स्क्रीन का पता: /master/adhesives-solvents · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=master-adhesives-solvents&lang=hi

Lamination के लिए तय एक adhesive और एक solvent मास्टर को देखने का पेज (बदल नहीं सकते)।

GRN, issue, BOM और variance में कौन सा adhesive/solvent code लगता है, यह देखने के लिए खोलें। यह lock है: यहाँ नया रिकॉर्ड जोड़ या बदल नहीं सकते। Vendor, location, मात्रा, cost और reference GRN पर भरे जाते हैं।

**शुरू करने से पहले**
- Admin/Owner रोल या master अधिकार।

**स्टेप बाय स्टेप**
1. "Adhesive" और "Solvent" टाइल देखें: दोनों में 1 और code दिखना चाहिए। "Missing" का मतलब मास्टर नहीं है।
2. "Locked chemistry policy" कार्ड में दोनों रिकॉर्ड देखें।
3. "Filter chemistry master..." या ऊपर search से नाम, code या status से खोजें।
4. हर product का adhesive और solvent GSM Product Master के "Adhesive" section में भरें, यहाँ नहीं।

**स्क्रीन पर क्या है**
- **Type / Code / System Master / Status**: Table के column: ADHESIVE या SOLVENT, code, नाम और status।
- **Visible**: Search से मेल खाने वाले रिकॉर्ड की संख्या।

**आम दिक्कतें और हल**
- "Adhesive या Solvent टाइल पर "Missing"" — System रिकॉर्ड नहीं है। Lamination BOM chemistry नहीं ले पाएगा; system admin से ठीक करवाएँ।

**अटक गए तो**
1. खपत बदलनी हो तो Product Master पर GSM बदलकर save करें।

जुड़े पेज: /master, /master/products, /inventory/grn, /inventory/addons

**अभी नहीं होता / ध्यान दें**
- पेज सिर्फ देखने के लिए है: नया adhesive या solvent नहीं जोड़ सकते, चाहे supplier grade बदल जाए।

### Commercial Families (/master/commercial-families)
स्क्रीन का पता: /master/commercial-families · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=master-commercial-families&lang=hi

Business वाले family नाम (जैसे PET Printed Laminate) जिनसे stock explorer, planner और reports में stock का समूह और नाम बनता है।

नया business family जोड़ने, नाम बदलने या उसका default form और reporting group सेट करने के लिए खोलें। Film family और film variant इससे जुड़ सकते हैं ताकि stock का नाम आसान लगे।

**शुरू करने से पहले**
- Admin/Owner रोल या master अधिकार।

**स्टेप बाय स्टेप**
1. "Add Business Family" दबाएँ।
2. "Code" (जैसे PET_PRINTED) और "Business Family Name" भरें।
3. "Default Form" (Roll या Pouch) और "Reporting Group" (Film, Printed, Laminated, Semi-FG, FG, Packaging, Other) चुनें।
4. "Active" चालू रखें; "Save" दबाएँ।
5. बदलने के लिए row पर "Edit" दबाएँ; हटाने की जगह Active बंद करें।

**स्क्रीन पर क्या है**
- **Active**: Inactive family इतिहास में रहती है पर नए नामों में नहीं आती।
- **Roll defaults / Pouch defaults टाइल**: कितनी family का default roll या pouch है।
- **Reporting Group**: Report में family किस समूह में गिनी जाएगी।

**आम दिक्कतें और हल**
- "Create failed / Update failed / Delete failed" — अक्सर code दोहराया गया है या family अभी जुड़ी है। नया code दें, या delete की जगह Inactive करें।

**अटक गए तो**
1. Family तभी delete करें जब कोई active चीज़ उस पर निर्भर न हो (dialog यही चेतावनी देता है)।

जुड़े पेज: /master, /master/film-families, /master/film-variants

### Film Families (/master/film-families)
स्क्रीन का पता: /master/film-families · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=master-film-families&lang=hi

Base film material (LDPE, HDPE, PET…) और उनकी density, जिससे वज़न और yield का हिसाब बनता है।

नई base film जोड़ने या density ठीक करने के लिए खोलें। हर film variant किसी एक family का होता है, इसलिए पहले family बनाएँ।

**शुरू करने से पहले**
- Admin/Owner रोल या master अधिकार।
- Supplier sheet से सही density (g/cm³)।

**स्टेप बाय स्टेप**
1. "Add Family" दबाएँ।
2. "Family Name" भरें (जैसे LDPE)।
3. चाहें तो "Business Family" चुनें (या "No linked business family")।
4. "Density (g/cm³)" भरें, जैसे 0.9200।
5. "Save" दबाएँ।

**स्क्रीन पर क्या है**
- **Density (g/cm³)**: प्रति area वज़न के हिसाब में लगता है; गलत value से उस film का हर BOM बदल जाता है।
- **Avg density टाइल**: दिख रही family की औसत density।
- **Linked aliases टाइल**: जिन family से business family जुड़ी है।

**आम दिक्कतें और हल**
- "Delete failed" — अभी variants इस family को इस्तेमाल करते हैं। पहले उन्हें बदलें या हटाएँ।

**अटक गए तो**
1. अगर सभी orders में वज़न गलत लगे तो सबसे पहले यहाँ density जाँचें।

जुड़े पेज: /master/film-variants, /master/commercial-families, /master

### Film Variants (/master/film-variants)
स्क्रीन का पता: /master/film-variants · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=master-film-variants&lang=hi

Film family के नीचे दोबारा इस्तेमाल होने वाली film पहचान (जैसे Standard Transparent): घर में बनती है, खरीदी जाती है या trading good के रूप में बिकती है।

ऐसी film जोड़ने के लिए खोलें जिसे Product Master layer, recipe और roll inward में चुना जा सके। Physical grade यहाँ नहीं भरते; वह order, recipe और roll पर चुना जाता है।

**शुरू करने से पहले**
- Film family पहले से बनी हो।

**स्टेप बाय स्टेप**
1. "Add Variant" दबाएँ।
2. "Variant Code" (जैसे F-101) और "Variant Name" भरें।
3. "Film Family" और चाहें तो "Business Family" चुनें।
4. अगर हम बनाते हैं तो "Extrudable", खरीदते हैं तो "Purchasable" टिक करें।
5. अगर दोबारा बेचते हैं तो "Sales · Trade Orders" में "Sellable as trading good" टिक करें और "Default GST %" भरें।
6. "Save" दबाएँ।

**स्क्रीन पर क्या है**
- **Extrudable**: घर में बनती है; plan करने के लिए recipe चाहिए।
- **Purchasable**: खरीद inward चालू करता है। अगर extrudable भी है, तो GRN पर roll grade पूछा जाता है।
- **Trade sale column**: "Sellable" या "Production only"।

**आम दिक्कतें और हल**
- "Delete failed" — Variant layer, recipe या roll में इस्तेमाल है। इसे रहने दें; इस्तेमाल हुई film delete न करें।

**अटक गए तो**
1. अगर Product Master layer में film न मिले तो देखें कि यहाँ बनी है और सही family में है।

जुड़े पेज: /master/film-families, /master/recipes, /master/products, /sales/trade-orders

### Granules (/master/granules)
स्क्रीन का पता: /master/granules · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=master-granules&lang=hi

Extrusion recipe में लगने वाले granule family, और हर family के अंदर store व WCM के internal grade code।

नया granule family जोड़ने के लिए, या ऐसे grade code (जैसे PPA-703-A) जोड़ने के लिए खोलें जो GRN पर लिखे जाते हैं और WCM machine release से पहले allocate करता है।

**शुरू करने से पहले**
- Admin/Owner रोल या master अधिकार।

**स्टेप बाय स्टेप**
1. "Add Granule" दबाएँ; "Granule Code" और "Granule Name" भरें; "Save" दबाएँ।
2. Row पर "Manage internal grade codes" खोलें।
3. एक "Internal grade/code" लिखें, "Status" चुनें, "Notes" लिखें और "Add code" दबाएँ।
4. कई code के लिए "Paste multiple grade codes" खोलें, हर line में एक या comma से अलग करके paste करें, "Add all codes" दबाएँ।
5. उसी dialog की table से code edit या delete करें।
6. अगर granule बेचा जाता है तो "Sellable as trading good" और "Default GST %" भरें।

**स्क्रीन पर क्या है**
- **Internal grade/code**: Capital में बदल जाता है; इसी family के अंदर रहता है। Space, hyphen और underscore एक जैसे माने जाते हैं।
- **Granule codes टाइल**: सभी family में active code की संख्या।
- **Trade sale column**: "Sellable" या "Stock use only"।

**आम दिक्कतें और हल**
- "Equivalent code '…' already exists in this granule family." — वही code अलग space/hyphen के साथ पहले से है। पुराना code इस्तेमाल करें।
- "Already present in this family: …" — Paste किए कुछ code पहले से हैं। उन्हें list से हटाकर फिर से करें।
- "The pasted list contains equivalent codes." — दो lines एक ही code हैं। एक रखें।
- "Add no more than 100 codes at once." — 100-100 के हिस्सों में paste करें।

**अटक गए तो**
1. अगर WCM को input issue पर grade code न मिले तो सही family में यहाँ जोड़ें।
2. Code delete करने पर इतिहास रहता है; बस नए inward और issue में नहीं दिखता।

जुड़े पेज: /master/recipes, /inventory/grn, /production/work-center

### Printing Inks (/master/inks)
स्क्रीन का पता: /master/inks · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=master-inks&lang=hi

Base (POLY या PET) और रंग के नाम से ink मास्टर, swatch और mix ink की जानकारी के साथ।

Artwork या ink floor को ज़रूरत पड़ने से पहले नया ink रंग जोड़ने, या floor से लौटा mix ink दर्ज करने के लिए खोलें।

**शुरू करने से पहले**
- Admin/Owner रोल या master अधिकार।

**स्टेप बाय स्टेप**
1. "Add Ink" दबाएँ।
2. "Base Substrate" चुनें: POLY (Polyethylene Base) या PET (Polyester Base)।
3. "Color Name" लिखें (capital में save होगा) और "Exact Swatch" (#RRGGBB) चुनें।
4. चाहें तो "Internal Description" लिखें।
5. लौटे mix के लिए "Mix Ink" टिक करें और "Mix Family" व "Mix Notes" भरें।
6. "Save Ink" दबाएँ। Code system खुद बनाता है।

**स्क्रीन पर क्या है**
- **Mix Ink**: लौटा हुआ mix रंग जिसे normal ink की तरह issue कर सकते हैं।
- **POLY base / PET base / Mix inks टाइल**: Base और mix के हिसाब से गिनती।

**आम दिक्कतें और हल**
- "Ink with this Base Type and Color Name already exists." — उसी base पर यही रंग पहले से है। वही इस्तेमाल करें या नाम बदलें।
- "Use a valid #RRGGBB color." — Swatch में # और छह hex अंक हों, या "Clear" दबाएँ।

**अटक गए तो**
1. जिस ink को artwork इस्तेमाल करता है उसे delete न करें।

जुड़े पेज: /inventory/ink-floor, /production/ink-control, /engineering/artworks

### Packaging Master (/master/packaging)
स्क्रीन का पता: /master/packaging · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=master-packaging&lang=hi

हर packing item का catalog: inner pouch, gonny, sheet/putha, box, outer bag, tape, label, tag और अन्य, और हर item stock से कैसे घटता है।

नया packing item जोड़ने, उसका kind या वज़न ठीक करने, या घर में बनने वाले inner pouch/sheet को उसे बनाने वाले Product Master से जोड़ने के लिए खोलें। Kind से तय होता है कि packing yard item को कैसे इस्तेमाल करेगा: inner pouch release की tick list में कभी नहीं आता (घर का inner pouch मशीन के आखिरी pouching step पर stock से घटता है, खरीदा हुआ शाम की packing count से book होता है); बाकी हर active item tick list में हमेशा आता है और शाम की packing count से book होता है।

**शुरू करने से पहले**
- Admin/Owner रोल या master अधिकार।
- खरीदे inner pouch और gonny के लिए एक piece का वज़न kg में पता हो।
- घर में बने item के लिए sizes वाला PACKAGING Product Master ("Build production master" से)।

**स्टेप बाय स्टेप**
1. "Add Packaging" दबाएँ। "Create Packaging Material" form खुलेगा।
2. "Code" और "Name" भरें।
3. "Kind" ("What is this item?") चुनें। कोई default नहीं है; kind चुने बिना "Save" बंद रहता है। नीचे की line पढ़ें: yard इस item को कैसे इस्तेमाल करेगा।
4. "Supply Mode" चुनें: सभी kind के लिए PURCHASED; IN_HOUSE या BOTH सिर्फ Inner pouch और Sheet · putha · board के लिए।
5. "Base UOM" (PCS, KG, METER) चुनें।
6. खरीदे inner pouch या किसी भी gonny के लिए "Weight of one … (kg)" भरें, जैसे 0.012। यह हर dispatch unit के वज़न में जुड़ता है।
7. "Status" ACTIVE रखें, चाहें तो "Brand / Pack Label" और inner pouch के लिए "Pouches per inner pouch (default)" भरें। "Save" दबाएँ।
8. घर में बने inner pouch या sheet के कार्ड पर "Link to Product Master" दबाएँ, master और "Size it is made in" चुनें, "Link" दबाएँ।

**स्क्रीन पर क्या है**
- **Kind**: Inner pouch · Gonny · Sheet · putha · board · Box · carton · Outer bag · packing pouch · Tape · Label · Tag · Other packing item। सिर्फ Inner pouch release tick list से बाहर रहता है।
- **Weight of one piece**: सिर्फ inner pouch और gonny का वज़न होता है। घर के pouch का वज़न जुड़े variant के BOM से आता है; बाकी पर "No weight · counted in PCS" दिखता है।
- **Stock · / Restock · lines**: Stock बताता है item कब घटता है (घर के inner pouch machine पर, बाकी शाम की packing count से)। Restock बताता है: अपने-आप demand, Stock launcher से हाथ से, या खरीद से।
- **PM-backed / Needs PM link / Catalog row**: Product Master variant से जुड़ा; घर का पर जुड़ा नहीं (ठीक करें); या खरीदा हुआ row।
- **टाइल: Total SKUs, PM-Backed, Unlinked In-House, Purchased**: दिख रहे items की गिनती। Unlinked In-House 0 होना चाहिए।
- **Pouches per inner pouch (default)**: Inner pouch के लिए: एक में कितने पाउच जाते हैं, जब ऑर्डर लाइन में न लिखा हो तब यही लिया जाता है। इसे भरें ताकि ऑर्डर और मशीन को हमेशा पता रहे कितने inner pouch गिनने हैं।

**आम दिक्कतें और हल**
- "Enter the weight of one pouch/gonny in kg; it goes into the dispatch unit weight." — खरीदा inner pouch या gonny बिना वज़न save किया। एक piece का वज़न भरें।
- "<KIND> cannot be IN_HOUSE in this phase." — सिर्फ Inner pouch और Sheet IN_HOUSE या BOTH हो सकते हैं। PURCHASED चुनें।
- "packaging_kind is required for packaging materials." — Save से पहले kind चुनें।
- "Item release tick list में नहीं दिखता" — उसका kind Inner pouch है या वह INACTIVE है। Edit करके सही kind (जैसे Putha के लिए Sheet · putha · board) और ACTIVE करें।
- "Missing. Link it to its packaging Product Master variant" — घर के inner pouch का BOM वज़न नहीं है। उसे बनाने वाले master से जोड़ें।

**अटक गए तो**
1. अगर link dialog में "No active packaging Product Master yet" आए, तो "Create one in Product Master" से master बनाएँ, sizes जोड़ें, active करें, फिर link करें।
2. Delete पर पुष्टि नहीं पूछी जाती; जो item कभी इस्तेमाल हुआ हो उसे INACTIVE करें।

जुड़े पेज: /master/products, /inventory/packaging, /logistics/packing, /dashboard/planner/control-tower/stock-launcher

**अभी नहीं होता / ध्यान दें**
- Packaging कार्ड पर "Delete" बिना पुष्टि पूछे तुरंत delete कर देता है।
- खरीदे inner pouch के कार्ड पर लिखा है कि वह शाम की packing count से घटेगा, जबकि inner pouch release tick list में कभी नहीं आता; सिर्फ घर के inner pouch machine पर घटते हैं।
- सिर्फ Inner pouch और Sheet IN_HOUSE या BOTH हो सकते हैं; box, tape आदि को घर में बना नहीं दिखा सकते।

### POD Master (/master/pod)
स्क्रीन का पता: /master/pod · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=master-pod&lang=hi

तय POD roll SKU (single या double) — height, thickness, panel और density के साथ, और हर SKU को बनाने वाला Product Master variant।

POD roll SKU जोड़ने, ठीक करने या उसे POD Product Master से जोड़ने के लिए खोलें। SKU सिर्फ इसी पेज से बनते हैं; घर के उत्पादन और stock के लिए Product Master variant यहाँ link होते हैं।

**शुरू करने से पहले**
- Admin/Owner रोल या master अधिकार।
- घर में बनता हो तो POD Product Master।

**स्टेप बाय स्टेप**
1. "Add POD Roll" दबाएँ।
2. "Code", "Name", "POD Type" (Single/Double) और "Status" भरें।
3. "Fixed Height (mm)", "Thickness (micron)", "Panel Count" और "Density (g/cm3)" भरें; सभी 0 से ज़्यादा हों।
4. अगर हम बनाते हैं तो "In-house capable" टिक करें; "Save" दबाएँ।
5. कार्ड पर "Link to Product Master" दबाएँ, POD master और size चुनें, "Link" दबाएँ।
6. कार्ड पर "POD SKU Variants" में variant row दिखे, यह जाँचें।

**स्क्रीन पर क्या है**
- **POD Type**: Single या Double; double में default 2 panel।
- **Core POD rows (code POD- से शुरू)**: Code नहीं बदलता और Delete बटन नहीं होता।
- **PM-Linked / Unlinked In-House टाइल**: जुड़े SKU और बिना master link वाले घर के SKU।

**आम दिक्कतें और हल**
- "Core POD code cannot be changed." — System POD row का code नहीं बदलता; सिर्फ नाम या माप बदलें।
- "Core POD materials cannot be deleted." — इसके बदले Inactive करें।
- "Height must be > 0 / Thickness must be > 0 / Panel count must be > 0 / Density must be > 0" — 0 से बड़े अंक भरें।

**अटक गए तो**
1. अगर घर का POD demand plan नहीं हो रहा, तो देखें कार्ड PM-linked है।

जुड़े पेज: /master/products, /master, /dashboard/planner/control-tower/stock-launcher

### Pouch shapes + formulas (/master/pouch-styles)
स्क्रीन का पता: /master/pouch-styles · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=master-pouch-styles&lang=hi

Pouch style की list: कौन से माप लगते हैं, child stock-width formula और film-area formula जो BOM, costing और roll allocation में लगता है।

कोई style ढूँढने, देखने कि कितने sizes उसे इस्तेमाल करते हैं, या नया शुरू करने के लिए खोलें। Product Master का हर pouch size किसी approved style से जुड़ा होता है।

**शुरू करने से पहले**
- Admin/Owner रोल और master.manage अधिकार।

**स्टेप बाय स्टेप**
1. Code, नाम या formula से search करें।
2. "Styles", "Locked" और "Used by sizes" chips देखें।
3. Style देखने या बदलने के लिए row पर "Open" दबाएँ।
4. नया बनाने के लिए "New pouch style" (खाली list पर "Build first pouch style") दबाएँ।

**स्क्रीन पर क्या है**
- **Columns: Code, Name, Formula, Stock form, Area formula, Slit, Sizes, Status**: Slit बताता है WCM चौड़ा roll slit कर सकता है या नहीं; Sizes = कितने Product Master sizes इसे इस्तेमाल करते हैं; lock बैज = approved।

**आम दिक्कतें और हल**
- "Style Product Master size picker में नहीं" — वह draft या disabled है। खोलकर "Save + approve + lock" या "Reactivate" दबाएँ।

**अटक गए तो**
1. हर code का सिर्फ नया version दिखता है; पुराने version पुराने sizes से जुड़े रहते हैं।

जुड़े पेज: /master/pouch-styles/new, /master/products

### Pouch style editor (/master/pouch-styles/[id])
स्क्रीन का पता: /master/pouch-styles/[id] · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=master-pouch-styles-id&lang=hi

एक pouch style बदलने का पेज: माप, width और area formula, roll axis, stock form, और approve, disable या reactivate करना।

Pouch styles list में "Open" से खोलें। Approved style बदलने पर नया draft version बनता है; sizes approve होने के बाद ही उस पर जाते हैं।

**शुरू करने से पहले**
- Admin/Owner रोल और master.manage अधिकार।
- Pouch का आकार पता हो: कौन से माप चाहिए और roll width कैसे निकलती है।

**स्टेप बाय स्टेप**
1. "Code" (हमेशा के लिए तय), "Name", चाहें तो "Emoji", "Sort order" और "Description" भरें।
2. "Allowed input fields" में Width (W) और Height (H) रखें और "Add a field" से Gusset, Flap reach, Seal overlap, Bottom factor, Stick factor या Direct roll width जोड़ें।
3. "Child-width formula builder" बनाएँ: child stock width = (coefficient × field) का जोड़ + trim। "Quick presets" से आम आकार भरें (Pillow / 3-side, Stand-up · K-bottom, Side gusset, Quad seal, Center seal · H-axis, Stick pack…)।
4. "Roll axis policy" (W-side या H-side से web), "Default stock form", "Stored width means" (Open-web, Lay-flat, Folded) और "Allocator rule" (Slitting allowed / Exact width only) सेट करें।
5. "Live preview" देखें: Child stock width, Film area width, Pitch side, Area / pouch।
6. "Create draft" / "Save draft" दबाएँ, फिर "Save + approve + lock"। सिर्फ approved style ही Product Master sizes में दिखते हैं।

**स्क्रीन पर क्या है**
- **Approved style · N sizes use it**: असली बदलाव save करने पर नया draft (अगला version) बनता है। Sizes अपनी पुरानी copy रखते हैं जब तक नया draft approve न हो।
- **Draft style · not selectable yet**: Approve होने तक Product Master size picker में नहीं दिखता।
- **Allocator rule**: Slitting allowed में WCM चौड़ा parent roll slit कर सकता है; Exact width only में ठीक वही width चाहिए।
- **Shaped (operator types width)**: अजीब आकार के लिए: formula की जगह हर size पर width लिखी जाती है।
- **Disable / Reactivate**: Disable से style picker से छिप जाता है पर इतिहास रहता है; Reactivate से वापस आता है।

**आम दिक्कतें और हल**
- "Disabled pouch styles cannot be approved. Reactivate it first." — "Reactivate" दबाएँ, फिर approve करें।
- "Formula consumes width/height … but the declared roll axis is …" — Formula दूसरी side इस्तेमाल करता है। "Roll axis policy" को message वाली side पर करें।
- "Custom AST mode requires a non-empty AST." — Formula में कम से कम एक term जोड़ें।
- "No changes to save" — Locked style में कोई बदलाव नहीं; save करने को कुछ नहीं।

**अटक गए तो**
1. अगर size पर roll width गलत दिखे, यहाँ उसका style खोलकर वही W, H, gusset डालकर live preview देखें।
2. Lane-up यहाँ सेट नहीं होता; वह web-width policy और sales order का काम है।

जुड़े पेज: /master/pouch-styles, /master/products, /master/web-width-policies

**अभी नहीं होता / ध्यान दें**
- Approved style बदलने से मौजूदा sizes तब तक नहीं बदलते जब तक नया draft approve न हो; sizes पुराने version की copy रखते हैं।

### Build a pouch shape (/master/pouch-styles/new)
स्क्रीन का पता: /master/pouch-styles/new · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=master-pouch-styles-new&lang=hi

नया pouch style draft के रूप में बनाएँ, फिर approve और lock करें ताकि Product Master sizes उसे इस्तेमाल कर सकें।

जब कोई pouch आकार list में न हो तब "New pouch style" से खोलें। Approve होने के बाद style हर Product Master के size editor में दिखता है।

**शुरू करने से पहले**
- Admin/Owner रोल और master.manage अधिकार।
- Pouch का आकार पता हो: कौन से माप चाहिए और roll width कैसे निकलती है।

**स्टेप बाय स्टेप**
1. "Code" (हमेशा के लिए तय), "Name", चाहें तो "Emoji", "Sort order" और "Description" भरें।
2. "Allowed input fields" में Width (W) और Height (H) रखें और "Add a field" से Gusset, Flap reach, Seal overlap, Bottom factor, Stick factor या Direct roll width जोड़ें।
3. "Child-width formula builder" बनाएँ: child stock width = (coefficient × field) का जोड़ + trim। "Quick presets" से आम आकार भरें (Pillow / 3-side, Stand-up · K-bottom, Side gusset, Quad seal, Center seal · H-axis, Stick pack…)।
4. "Roll axis policy" (W-side या H-side से web), "Default stock form", "Stored width means" (Open-web, Lay-flat, Folded) और "Allocator rule" (Slitting allowed / Exact width only) सेट करें।
5. "Live preview" देखें: Child stock width, Film area width, Pitch side, Area / pouch।
6. "Create draft" / "Save draft" दबाएँ, फिर "Save + approve + lock"। सिर्फ approved style ही Product Master sizes में दिखते हैं।

**स्क्रीन पर क्या है**
- **Approved style · N sizes use it**: असली बदलाव save करने पर नया draft (अगला version) बनता है। Sizes अपनी पुरानी copy रखते हैं जब तक नया draft approve न हो।
- **Draft style · not selectable yet**: Approve होने तक Product Master size picker में नहीं दिखता।
- **Allocator rule**: Slitting allowed में WCM चौड़ा parent roll slit कर सकता है; Exact width only में ठीक वही width चाहिए।
- **Shaped (operator types width)**: अजीब आकार के लिए: formula की जगह हर size पर width लिखी जाती है।
- **Disable / Reactivate**: Disable से style picker से छिप जाता है पर इतिहास रहता है; Reactivate से वापस आता है।

**आम दिक्कतें और हल**
- "Disabled pouch styles cannot be approved. Reactivate it first." — "Reactivate" दबाएँ, फिर approve करें।
- "Formula consumes width/height … but the declared roll axis is …" — Formula दूसरी side इस्तेमाल करता है। "Roll axis policy" को message वाली side पर करें।
- "Custom AST mode requires a non-empty AST." — Formula में कम से कम एक term जोड़ें।
- "No changes to save" — Locked style में कोई बदलाव नहीं; save करने को कुछ नहीं।

**अटक गए तो**
1. अगर size पर roll width गलत दिखे, यहाँ उसका style खोलकर वही W, H, gusset डालकर live preview देखें।
2. Lane-up यहाँ सेट नहीं होता; वह web-width policy और sales order का काम है।

जुड़े पेज: /master/pouch-styles, /master/products, /master/web-width-policies

### Product Master (/master/products)
स्क्रीन का पता: /master/products · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=master-products&lang=hi

हम जो कुछ बना सकते हैं उसका catalog: pouch, roll, packaging, POD और other master — route, sizes, layers और variants के साथ।

Master ढूँढने, नया बनाने, clone करने, या disable/restore करने के लिए खोलें। Sales order की हर line किसी active Product Master से बनती है, और planner व floor उसके route और BOM पर चलते हैं। ?kind=PACKAGING या ?kind=POD वाले पते से list पहले से छँटी हुई खुलती है।

**शुरू करने से पहले**
- Admin/Owner रोल और master.manage अधिकार (Sales order composer में product चुनता है, master नहीं खोलता)।
- Live route template, film variant और approved pouch style बने हों।

**स्टेप बाय स्टेप**
1. "Active catalog" या "Disabled / audit" चुनें।
2. "Filters" इस्तेमाल करें: code या नाम search, "Kind" (All, Pouch, Roll, Packaging, POD, Other), "Reporting group", और "Capabilities" (Catalog-linked axes, Print capable, Has overlays)। "Clear all" से सब हटता है।
3. हर कार्ड पर "N/N ready" और जाँच देखें: route, sizes, layers या variants, SKU links।
4. Master देखने के लिए "Open", copy के लिए "Clone", हटाने/वापस लाने के लिए "Disable" / "Restore" दबाएँ।
5. "New Product Master" दबाएँ: "Product kind" चुनें, "Master code", "Reporting group", "Master name" भरें, "Live route" (ज़रूरी) और "Number of layers" चुनें।
6. "Create & open workspace" दबाएँ। Master inactive बनता है; editor में films, sizes और policies पूरी करके active करें।
7. और कार्ड के लिए "Show 60 more" दबाएँ।

**स्क्रीन पर क्या है**
- **Product kind**: Finished pouch, Roll / film, Packaging (inner pouch या sheet/wrap), POD, Other। Packaging और POD production master हैं: stock launcher इन्हें चलाता है, sales नहीं चुनता।
- **टाइल: Active, Disabled, Variants 90d, Overlays, Print capable, Catalog-linked axes**: पूरे catalog की गिनती।
- **Clone (Save as active replacement)**: Sizes, axes, packing/POD settings copy होते हैं; route और layer बदल सकते हैं। Replacement option पुराना master disable करता है; पुराने orders का रिकॉर्ड वैसा ही रहता है।
- **Sizes / Axes / Variants / Overlays या SKU Links**: हर कार्ड के नीचे की गिनती।

**आम दिक्कतें और हल**
- "Product Master code already exists. Try a different code." — नया code दें।
- "Required: pick the route template this master will use" — "Create & open workspace" से पहले live route चुनें।
- "A superseded Product Master revision cannot be restored." — यह बदल दिया गया है; नया replacement इस्तेमाल करें या clone करें।

**अटक गए तो**
1. Order composer में master न दिखे तो अक्सर वह inactive या disabled है; खोलकर "Master active" देखें।
2. Disabled master "Disabled / audit" में रहते हैं; पुराने orders उन्हें खोल सकते हैं।

जुड़े पेज: /master/products/[id], /master/products/[id]/edit, /master/packaging, /master/pod, /engineering/templates, /sales/orders/create

### Product Master view (/master/products/[id])
स्क्रीन का पता: /master/products/[id] · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=master-products-id&lang=hi

एक Product Master को tabs में देखने का पेज: Overview, Layer template, Variants, Sizes, Customer overlays, Artworks और Audit trail।

Quote या plan से पहले product किससे बनता है यह देखने, customer overlay जोड़ने, या नया variant शुरू करने के लिए खोलें। बदलने के लिए "Edit" दबाएँ।

**शुरू करने से पहले**
- Admin/Owner रोल और master.manage अधिकार (Sales order composer में product चुनता है, master नहीं खोलता)।

**स्टेप बाय स्टेप**
1. Header पढ़ें: code, नाम, kind, route, print और size की गिनती।
2. हर layer की film, micron, grade और adhesive/solvent के लिए "Layer template" खोलें।
3. हर size, web width और inch के साथ देखने के लिए "Sizes" खोलें।
4. हर बिकने वाले configuration के लिए "Variants" खोलें; live BOM के लिए cell पर क्लिक करें; नया जोड़ने के लिए "Create variant" दबाएँ।
5. "Customer overlays" खोलकर "Add overlay" से customer के default सेट करें (packaging/POD master पर नहीं दिखता)।
6. Header में "Edit", "Duplicate" या "Disable" / "Restore" इस्तेमाल करें; "Open in Sales create" से इस master का order शुरू होता है।

**स्क्रीन पर क्या है**
- **Variants tab**: हर बिकने वाला configuration; किन्हीं दो axes से table बदल सकते हैं।
- **Customer overlays**: Overlay किस customer के लिए है और उस customer के लिए sales क्या अपने-आप चुनेगा; BOM master का ही रहता है।
- **Artworks tab**: इस master के print method और form से मेल खाने वाले approved artwork।
- **Audit trail**: हर बदलाव — किसने, कब और क्या बदला।

**आम दिक्कतें और हल**
- "Could not load product master." — गलत link या अधिकार नहीं। List पर लौटकर फिर खोलें।

**अटक गए तो**
1. Edit के बाद view पुराना लगे तो पेज refresh करें।

जुड़े पेज: /master/products, /master/products/[id]/edit, /master/products/[id]/variants/new, /sales/orders/create

**अभी नहीं होता / ध्यान दें**
- Packaging और POD master में Customer overlays टैब और "Open in Sales create" नहीं दिखते क्योंकि sales इन्हें order नहीं करता।

### Product Master editor (/master/products/[id]/edit)
स्क्रीन का पता: /master/products/[id]/edit · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=master-products-id-edit&lang=hi

एक Product Master का पूरा editor, तीन हिस्सों में: What it is, What is fixed, और What sales choose।

"Edit" से खोलें और route, layers, printing नियम, adhesive, sales की अनुमति, sizes (हाथ से या Excel size sheet से), add-on और packing सेट करें। Save करने पर इस master वाले खुले orders का snapshot ताज़ा होता है।

**शुरू करने से पहले**
- Admin/Owner रोल और master.manage अधिकार (Sales order composer में product चुनता है, master नहीं खोलता)।
- Film variant, approved pouch style, add-on और packaging item बने हों।

**स्टेप बाय स्टेप**
1. Section list (Basics, Summary, Layers, Printing, Adhesive, What sales can change, Sizes & web width, Add-ons & packing) से सीधे जाएँ।
2. Basics: "Master name", "Product kind", "Live route / template" देखें; packaging में "Packing sub-type" (Inner pouch carrier या Sheet / Roll for packing) चुनें।
3. Layers: "Add layer" दबाएँ, default film, μ thickness और grade चुनें; दूसरी मंज़ूर film के लिए "+ Add allowed film"।
4. Printing: "No printing", "Print capable · artwork OPTIONAL" या "Print compulsory · artwork REQUIRED" चुनें, और "Allowed print method" (FLEXO या ROTO)।
5. Adhesive: adhesive और solvent और उनका GSM चुनें।
6. Sizes & web width: "Add size", या "Excel sheet" से .xlsx download करें, भरें, फिर "Bulk upload" → "Review size import" → "Confirm import"। खाली code और label size से अपने-आप बनते हैं ("auto from size")।
7. Add-ons & packing: inner pouch, POD और add-on allow करें; "Default inner pouch" और "Pouches per inner" चुनें।
8. Save checklist देखें (code & name, live route, कम से कम एक size और layer, हर layer में film, printing gate) और "Save master" दबाएँ। इसे दबाए बिना sizes save नहीं होते।

**स्क्रीन पर क्या है**
- **Master active**: सिर्फ active master sales और planner को दिखते हैं।
- **Sales ad-hoc permissions (Off / Optional / Required)**: Sales इस master में नया value (जैसे नया pouch size) जोड़ सकता है या नहीं। Off वाले axes बंद रहते हैं।
- **Auto-fire in-house stock launcher on shortage**: चालू होने पर, घर के inner pouch या POD की कमी पर order confirm के समय demand बनती है।
- **Size code**: Roll: 500 या 500X45; pouch: 140X305 या 140X305G40। Inch mm के साथ दिखते हैं, लिखे नहीं जाते।
- **Pouch style (हर size पर)**: हर pouch size एक approved pouch style से जुड़ता है जिससे roll width निकलती है।
- **Per-layer roll-width override**: Advanced: जब order में size का override न हो तब BOM के लिए fallback roll width।

**आम दिक्कतें और हल**
- "Layer N must select a valid film variant before the Product Master is active." — हर layer में film चुनें।
- "Layer N grade is required unless …" — उस layer का grade चुनें।
- "Size code "680" is already on this master (in use)." — Size list में वह code खोजें और नई row की जगह वही row बदलें।
- "Enter the size … or type a code." — Size row में न माप है न code। माप भरें।
- "This is not a readable Excel file … / The first row must be the column names … / The sheet is larger than 5 MB." — Download किया "Excel sheet" template इस्तेमाल करें, header row रखें, 5 MB से छोटी .xlsx या .csv save करें।
- "Product Master code is an internal immutable identity …" — Code नहीं बदलता; नाम बदलें।

**अटक गए तो**
1. Import हुए sizes "Save master" तक draft में रहते हैं; पेज छोड़ने पर चले जाते हैं।
2. Size हटाने पर वह retire होता है; उसी code की नई row से वह वापस आ जाता है।
3. अगर घर के inner pouch पर "No product master is linked to make this pouch" दिखे तो Packaging master पर link करें।

जुड़े पेज: /master/products/[id], /master/pouch-styles, /master/packaging, /master/pod, /master/add-ons, /master/film-variants, /engineering/templates

**अभी नहीं होता / ध्यान दें**
- Import या जोड़े गए sizes "Save master" तक सिर्फ draft हैं; पेज छोड़ने पर बिना चेतावनी चले जाते हैं।

### New variant (/master/products/[id]/variants/new)
स्क्रीन का पता: /master/products/[id]/variants/new · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=master-products-id-variants-new&lang=hi

Product Master का एक variant बनाने का पेज: size और axis value, हर layer की thickness, grade और width, add-on और artwork mode, live material breakdown के साथ।

Master के Variants tab पर "Create variant" से खोलें, जब कोई stock या बिकने वाला configuration order से पहले चाहिए (जैसे catalog SKU से जोड़ने के लिए packaging या POD variant)।

**शुरू करने से पहले**
- Admin/Owner रोल और master.manage अधिकार (Sales order composer में product चुनता है, master नहीं खोलता)।
- Master में sizes और layers save हों।

**स्टेप बाय स्टेप**
1. देखें कि "Configuring a variant of" में सही master है।
2. "Required axes" (जैसे Size) भरें; "Variant code (live)" बदलता है।
3. "Per-layer thicknesses · grades · widths" देखें; default master से आते हैं।
4. ज़रूरत हो तो add-on और artwork mode चुनें।
5. "Material breakdown" (प्रति 1,000 kg) और "Stock match preview" पढ़ें।
6. "Save variant" (या "Save as preset") दबाएँ।

**स्क्रीन पर क्या है**
- **Variant code (live)**: Axis value से बनता है; VALID · NEW का मतलब अभी मौजूद नहीं।
- **Pricing reference**: Customer overlay की कीमत, सिर्फ देखने के लिए।

**आम दिक्कतें और हल**
- "Could not save variant" — कोई ज़रूरी axis खाली है या यही variant पहले से है। Axis भरें या पुराना variant खोलें।

**अटक गए तो**
1. बिना save लौटने के लिए "Back to master" दबाएँ।

जुड़े पेज: /master/products/[id], /master/packaging, /master/pod

### Extrusion Recipes (/master/recipes)
स्क्रीन का पता: /master/recipes · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=master-recipes&lang=hi

Extrusion film के लिए granule family का formula, हर film variant + grade + thickness range का एक, revision इतिहास के साथ।

नई extrusion film के लिए recipe बनाने या प्रतिशत का नया revision publish करने के लिए खोलें। Save करने पर खुले BOM और planner queue ताज़ा होते हैं; release हो चुके job पुराने formula पर रहते हैं।

**शुरू करने से पहले**
- Extrudable film variant, grade (Grade Master) और granule family बने हों।

**स्टेप बाय स्टेप**
1. "Add Recipe" दबाएँ।
2. "Film Variant", "Grade" (grade "Grade Master" से जोड़ें), और "Min Thickness (μ)" / "Max Thickness (μ)" चुनें।
3. "Family formulation" में "Add family row" दबाएँ, हर "Granule family" और उसका "Recipe %" भरें।
4. कुल 100.00% होने तक "Balance to 100%" इस्तेमाल करें।
5. "Save family recipe" दबाएँ। Edit में "Revision reason" लिखें और "Publish revision vN" दबाएँ।
6. Result card पढ़ें: Open BOMs refreshed, Queues rebuilt, Frozen history, Needs review।

**स्क्रीन पर क्या है**
- **Exact recipe contract**: Variant + grade + thickness range; बनने के बाद lock।
- **Matching lines / Will refresh / Stay frozen / Released**: Edit का order lines पर असर।
- **Disable**: नए orders में यह contract नहीं लगेगा; इतिहास और released job रहते हैं।

**आम दिक्कतें और हल**
- "Total percentage must be 100.00%." — "Balance to 100%" इस्तेमाल करें।
- "An active recipe already exists … / Thickness range overlaps …" — वही recipe बदलें, या नई range से पहले उसे disable करें।
- "Recipe identity is locked after creation …" — Variant, grade या thickness बदलने के लिए disable करके नई recipe बनाएँ।
- "Each granule can be used only once in a recipe." — दोहराई rows मिलाएँ।
- "Recipes are production history and cannot be deleted …" — "Disable" इस्तेमाल करें।

**अटक गए तो**
1. अगर "Needs review" शून्य से ज़्यादा हो तो planner को बताएँ: कुछ खुली lines ताज़ा नहीं हुईं।

जुड़े पेज: /master/granules, /master/film-variants, /dashboard/planner/control-tower/plan-queue

**अभी नहीं होता / ध्यान दें**
- Recipe का variant, grade या thickness range नहीं बदल सकते; disable करके फिर से बनानी पड़ती है।

### Items we resell (/master/trading-goods)
स्क्रीन का पता: /master/trading-goods · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=master-trading-goods&lang=hi

Trading goods की list, हर item का stock, sale rate और GST।

Plant में बनाए बिना Trade Order से बिकने वाला item ढूँढने या जोड़ने के लिए खोलें।

**शुरू करने से पहले**
- Admin/Owner रोल या master अधिकार।

**स्टेप बाय स्टेप**
1. Code, नाम या HSN से search करें।
2. Total, Active और Stock units chips देखें।
3. Edit के लिए कार्ड पर क्लिक करें।
4. नया बनाने के लिए "New trading good" (या "Add first trading good") दबाएँ।

**स्क्रीन पर क्या है**
- **कार्ड: Stock, Sale ₹, GST %**: Base UOM में stock, default sale rate और GST; बैज में active/inactive, trade form और HSN।

**आम दिक्कतें और हल**
- "No trading goods yet" — कुछ नहीं बना; पहला item जोड़ें।

**अटक गए तो**
1. Inactive item यहाँ दिखते हैं पर trade order picker में नहीं।

जुड़े पेज: /master/trading-goods/new, /sales/trade-orders, /inventory/adjustments

### Trading good बदलें (/master/trading-goods/[id])
स्क्रीन का पता: /master/trading-goods/[id] · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=master-trading-goods-id&lang=hi

एक trading good की पहचान, कीमत के default और status बदलें, और plant-wise stock देखें।

Trading goods वे items हैं जिन्हें हम जैसे हैं वैसे बेचते हैं (ready pouch, ready roll, packing item, raw material)। इनका stock अलग है और ये Trade Orders से बिकते हैं। Stock सिर्फ Stock Adjustment से बदलता है, यहाँ से नहीं।

**शुरू करने से पहले**
- Admin/Owner रोल या master अधिकार।

**स्टेप बाय स्टेप**
1. "Code *" और "Name *" भरें (दोनों ज़रूरी)।
2. "Base UOM" (Pieces, Kilograms, Meters, Rolls, Boxes) और "Trade form" (Ready pouch, Ready roll, Packing item, Raw material, Other) चुनें।
3. "HSN code" और "Description" भरें।
4. "Pricing defaults" में "Default GST %", "Default sale rate (₹)", "Default buy rate (₹)" भरें; ये Trade Order lines में पहले से भरते हैं।
5. "Status" Active रखें (हटाने के लिए बंद करें) और "Create trading good" / "Save changes" दबाएँ।
6. पुराने item पर "Stock by plant" देखें; stock बदलने के लिए "Open Stock Adjustments →" दबाएँ।

**स्क्रीन पर क्या है**
- **Status (Active)**: Inactive item trade order picker में नहीं दिखते।
- **Stock by plant**: सिर्फ देखने के लिए: Plant, Qty, Avg cost, Updated।

**आम दिक्कतें और हल**
- "Missing fields: Code and name are required" — Save से पहले दोनों भरें।
- "Save failed" — अक्सर code दोहराया गया है। दूसरा code दें।
- "No stock recorded yet" — Opening stock Stock Adjustment से डालें।

**अटक गए तो**
1. बिना save लौटने के लिए "Back to list" दबाएँ।

जुड़े पेज: /master/trading-goods, /sales/trade-orders, /inventory/adjustments

**अभी नहीं होता / ध्यान दें**
- Trading good का delete नहीं है; Status बंद करके हटाएँ। Stock यहाँ नहीं बदलता।

### Trading good जोड़ें (/master/trading-goods/new)
स्क्रीन का पता: /master/trading-goods/new · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=master-trading-goods-new&lang=hi

नया trading good बनाएँ: code, नाम, unit, trade form, HSN और कीमत के default।

Trading goods वे items हैं जिन्हें हम जैसे हैं वैसे बेचते हैं (ready pouch, ready roll, packing item, raw material)। इनका stock अलग है और ये Trade Orders से बिकते हैं। Stock सिर्फ Stock Adjustment से बदलता है, यहाँ से नहीं।

**शुरू करने से पहले**
- Admin/Owner रोल या master अधिकार।

**स्टेप बाय स्टेप**
1. "Code *" और "Name *" भरें (दोनों ज़रूरी)।
2. "Base UOM" (Pieces, Kilograms, Meters, Rolls, Boxes) और "Trade form" (Ready pouch, Ready roll, Packing item, Raw material, Other) चुनें।
3. "HSN code" और "Description" भरें।
4. "Pricing defaults" में "Default GST %", "Default sale rate (₹)", "Default buy rate (₹)" भरें; ये Trade Order lines में पहले से भरते हैं।
5. "Status" Active रखें (हटाने के लिए बंद करें) और "Create trading good" / "Save changes" दबाएँ।
6. पुराने item पर "Stock by plant" देखें; stock बदलने के लिए "Open Stock Adjustments →" दबाएँ।

**स्क्रीन पर क्या है**
- **Status (Active)**: Inactive item trade order picker में नहीं दिखते।
- **Stock by plant**: सिर्फ देखने के लिए: Plant, Qty, Avg cost, Updated।

**आम दिक्कतें और हल**
- "Missing fields: Code and name are required" — Save से पहले दोनों भरें।
- "Save failed" — अक्सर code दोहराया गया है। दूसरा code दें।
- "No stock recorded yet" — Opening stock Stock Adjustment से डालें।

**अटक गए तो**
1. बिना save लौटने के लिए "Back to list" दबाएँ।

जुड़े पेज: /master/trading-goods, /sales/trade-orders, /inventory/adjustments

### Vendors (/master/vendors)
स्क्रीन का पता: /master/vendors · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=master-vendors&lang=hi

Supplier, job worker और service provider का मास्टर, जो GRN, purchase order और job work में लगता है।

Vendor जोड़ने या बदलने, उसके tax, contact, पते, payment terms और job-work rate card के लिए खोलें। Store वाले यही vendors Stock → Vendors (/inventory/vendors) से इस्तेमाल करते हैं।

**शुरू करने से पहले**
- Admin/Owner रोल या master अधिकार।

**स्टेप बाय स्टेप**
1. "Add Vendor" दबाएँ।
2. "Vendor Code", "Vendor Name", "Type" (Raw Material Supplier, Job Worker, Service Provider, Both (Supplier & JW)) और "Status" भरें।
3. GST No, PAN No, Contact Person, Email, Phone और "Lead Time (Days)" भरें।
4. "Primary Mailing Address" भरें; branch पते "Additional Mailing Details" में जोड़ें।
5. "Credit Period (Days)", "Payment Terms", "Bank Details", TDS/TCS switch सेट करें।
6. Job worker के लिए "Jobwork controls" और "Job-work rate card" (process code, rate ₹, unit per piece/kg/metre/roll) भरें।
7. "Update Vendor" / save दबाएँ।

**स्क्रीन पर क्या है**
- **Status**: Active, Inactive या Blacklisted।
- **QC Required on Return**: चालू होने पर job-work से लौटा माल QC तक रुका रहता है।
- **Job-work rate card**: हर process की तय मज़दूरी (GST के बिना); नए job-work order इसे लेते हैं और bill इससे जाँचे जाते हैं।
- **टाइल: Partners, Active, Jobwork ready, QC required**: स्थिति के हिसाब से vendor गिनती।

**आम दिक्कतें और हल**
- "Name is required / Code is required" — दोनों भरें।
- "This process and unit already has a rate" — हर process और unit का एक ही rate रखें।
- "Failed to delete" — Vendor stock या documents से जुड़ा है। Inactive करें।

**अटक गए तो**
1. Delete वापस नहीं होता; Inactive या Blacklisted बेहतर है।

जुड़े पेज: /inventory/vendors, /inventory/grn, /procurement/purchase-orders, /inventory/job-work

**अभी नहीं होता / ध्यान दें**
- /master/vendors सिर्फ Admin/Owner के लिए खुलता है; store वाले वही vendors /inventory/vendors से देखते हैं।

### Lane-up and parent-web rules (/master/web-width-policies)
स्क्रीन का पता: /master/web-width-policies · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANNER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=master-web-width-policies&lang=hi

Web-width policy की list: कितने lanes allowed हैं, child width से parent web width कैसे बनती है, और WCM slit के बचे हिस्से का क्या करता है।

Sales order lines इसी policy से lane-up जाँचती हैं और planned parent width निकालती हैं; WCM इससे बचे हिस्से को रखने/scrap का फैसला करता है। Default policy देखने या कोई policy खोलने के लिए यह पेज खोलें।

**शुरू करने से पहले**
- Admin, Owner या Planner रोल।

**स्टेप बाय स्टेप**
1. Policies और Default chips देखें।
2. Code, नाम या विवरण से search करें।
3. "440 mm sample" column देखें: std width selected या calculated parent।
4. Row पर "Open" या नया जोड़ने के लिए "New policy" दबाएँ।

**स्क्रीन पर क्या है**
- **Columns: Code, Name, Scope, Lanes, Parent strategy, 440 mm sample, Remainder, Status**: हर policy का सार, 440 mm child का उदाहरण।

**आम दिक्कतें और हल**
- "No policies match." — Search हटाएँ।
- "No web-width policy configured yet." — Global fallback default policy बनाएँ।

**अटक गए तो**
1. Global fallback के लिए ठीक एक Default policy रखें।

जुड़े पेज: /master/web-width-policies/new, /sales/orders/create, /master/pouch-styles

### Web-width policy (/master/web-width-policies/[id])
स्क्रीन का पता: /master/web-width-policies/[id] · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANNER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=master-web-width-policies-id&lang=hi

एक lane-up और parent-web policy बदलें, preview देखें, या delete करें।

Policy list से खोलें। बदलाव नई sales order line की गणना और WCM के remainder फैसलों पर लगते हैं। "Delete" पहले "Delete this policy?" पूछता है।

**शुरू करने से पहले**
- Admin, Owner या Planner रोल।

**स्टेप बाय स्टेप**
1. "Code (unique)", "Name", "Description" भरें; "Default policy" सिर्फ plant के default के लिए टिक करें।
2. "Scope" (Global fallback, Product kind, Product master, Pouch style, Process, Machine) और "Scope ref" चुनें।
3. "Allowed lane counts" (1–12) टिक करें; sales order का lane picker सिर्फ यही दिखाता है।
4. "Strategy" चुनें: Calculated width, Nearest standard parent, या Require standard parent; Min/Max parent width और "Standard parent widths" (जैसे 880, 1320, 1500) भरें।
5. "Slitting trim rule" भरें: Inter-cut trim, Edge trim और Formula (PER_CUT, PER_LANE, FIXED)।
6. "Min remainder to keep (mm)" और "Prefer remainders first" सेट करें।
7. Child width और lane डालकर "Live preview" देखें, फिर "Create policy" / "Save changes" दबाएँ।

**स्क्रीन पर क्या है**
- **Strategy**: Calculated में सटीक हिसाब; Nearest standard अगली तय width पर जाता है; Require standard में कोई width फिट न हो तो order रुकता है।
- **Min remainder to keep (mm)**: इससे पतला बचा हिस्सा scrap में जाता है।

**आम दिक्कतें और हल**
- "Lane count must be between 1 and 12." — 1–12 lanes चुनें।
- "Scope reference is required for non-global policies." — Scope ref चुनें।
- "Strict standard mode needs at least one parent width." — Standard width जोड़ें या strategy बदलें।
- "Max parent width must be greater than min parent width." — Min/max ठीक करें।

**अटक गए तो**
1. अगर order line कोई lane count न ले, तो देखें कौन सी policy लगती है और यहाँ lane जोड़ें।

जुड़े पेज: /master/web-width-policies, /sales/orders/create, /production/work-center

### नई web-width policy (/master/web-width-policies/new)
स्क्रीन का पता: /master/web-width-policies/new · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANNER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=master-web-width-policies-new&lang=hi

किसी scope के लिए lane-up और parent-web policy बनाएँ।

जब किसी product kind, master, pouch style, process या machine को अलग lane या parent-width नियम चाहिए तब "New policy" से खोलें।

**शुरू करने से पहले**
- Admin, Owner या Planner रोल।

**स्टेप बाय स्टेप**
1. "Code (unique)", "Name", "Description" भरें; "Default policy" सिर्फ plant के default के लिए टिक करें।
2. "Scope" (Global fallback, Product kind, Product master, Pouch style, Process, Machine) और "Scope ref" चुनें।
3. "Allowed lane counts" (1–12) टिक करें; sales order का lane picker सिर्फ यही दिखाता है।
4. "Strategy" चुनें: Calculated width, Nearest standard parent, या Require standard parent; Min/Max parent width और "Standard parent widths" (जैसे 880, 1320, 1500) भरें।
5. "Slitting trim rule" भरें: Inter-cut trim, Edge trim और Formula (PER_CUT, PER_LANE, FIXED)।
6. "Min remainder to keep (mm)" और "Prefer remainders first" सेट करें।
7. Child width और lane डालकर "Live preview" देखें, फिर "Create policy" / "Save changes" दबाएँ।

**स्क्रीन पर क्या है**
- **Strategy**: Calculated में सटीक हिसाब; Nearest standard अगली तय width पर जाता है; Require standard में कोई width फिट न हो तो order रुकता है।
- **Min remainder to keep (mm)**: इससे पतला बचा हिस्सा scrap में जाता है।

**आम दिक्कतें और हल**
- "Lane count must be between 1 and 12." — 1–12 lanes चुनें।
- "Scope reference is required for non-global policies." — Scope ref चुनें।
- "Strict standard mode needs at least one parent width." — Standard width जोड़ें या strategy बदलें।
- "Max parent width must be greater than min parent width." — Min/max ठीक करें।

**अटक गए तो**
1. अगर order line कोई lane count न ले, तो देखें कौन सी policy लगती है और यहाँ lane जोड़ें।

जुड़े पेज: /master/web-width-policies, /sales/orders/create, /production/work-center
