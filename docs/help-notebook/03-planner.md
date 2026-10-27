# Planner

## Overview (English)
# Planner and the Control Tower

The planner turns confirmed sales-order lines into released production jobs, decides where material comes from, and watches the lines until they close. The planner lands on the **Planner Command Center** (`/dashboard/planner`) and works in the **Control Tower**, which has seven tabs. Keys **1–7** switch tabs when the cursor is not in a field.

| Key | Tab | Route | What it is for |
|---|---|---|---|
| 1 | Command | `/dashboard/planner/control-tower/command` | What to act on now: top 5 at-risk orders, source mix, demand, job states, WC load, action desk, output, recent movement |
| 2 | Plan Queue | `.../plan-queue` | One row per order line: gates, artwork, source choice, release, short-close, cancel |
| 3 | Live Production | `.../live-production` | Released and running lines, machines now, today's timeline, replan, color revision |
| 4 | Completed Trace | `.../completed-trace` | Closed lines, cycle time, on-time, stock claims, trace gaps, CSV export |
| 5 | Material readiness | `.../stock-intelligence` | Stock vs demand per template, quick stock launch, packaging and POD in-house |
| 6 | Combine Orders | `.../gang-builder` | Put several roll-output jobs of one Product Master on one jumbo |
| 7 | Launch Stock | `.../stock-launcher` | Make-to-stock orders on any product master |

## Main flow: releasing a sales line
1. Sales confirms the order (drafts never appear in the queue).
2. In **Plan Queue**, find the line (chips All, Ready, Blocked, Artwork, Overdue, Aged 30d+, New ≤3d; search; Filters; sort Newest / Due first / Largest) and click it.
3. Read the four gates: **S** Spec math, **M** Material (recipe/BOM), **A** Artwork, **R** Route. Each gate shows only its own check. An artwork-only line is amber "Artwork pending", not "Blocked". Material is red only when the recipe/BOM is not production-ready.
4. If printing: press "Assign artwork" and pick an APPROVED artwork (filtered by product master, size, print type and sheet/tube form).
5. Press "Plan & Release" (or "Choose source & release" when finished goods or WIP match). Pick the source: **FG match** (ship from finished stock), **Carry WIP**, **Invariant stock**, **Input stock** (pre-selected for WCM at the first roll-input step) or **Fresh run**. Enter "KG to allocate" or press MAX.
6. Under "Route dispatch" choose a work center for each planner-decided step; optionally skip an optional route step.
7. Keep "Release immediately after planning" ticked and press "Plan & Release", or untick for "Plan only". The toast says "Order planned & released".
8. Jobs appear in the WC terminal; follow them in Live Production; closed lines move to Completed Trace.

## Rolls and web width
- A roll is used as it is within **±20 mm** of the planned web. Wider rolls are slit, or allocated by manual override with a reason. Narrower than −20 mm is refused.
- Before a slitting step, a multi-lane (n-up) line runs its planned parent web (lanes × child + trim). Example: a 3-up 230 mm line on a 700 mm web accepts 680–720 mm rolls at printing.
- The spec card shows **Stock web**, e.g. "Open web · 655 mm roll · slit allowed".

## Short-close and cancel
- **Cancel line**: only before any machine, material or scrap activity. After that the server says "Line has machine activity. Use short-close for the remaining quantity."
- **Short close**: keeps what was produced and closes only the remaining quantity.
- Both need a reason of at least 5 characters; it is kept in the audit trail.
- Goods already made for a closed line stay in the yard. Dispatch Bay either ships them (after ticking "Send goods of closed lines") or moves them to free stock with a reason; the planner can then use them as FG match for any order of the same spec.
- **Replan**: when the final step made less than the target, dispatch can ship what was made and the balance waits in the queue for re-release or short-close.

## Print color revision
After release and before completion, "Revise colors only" changes ink names (with a reason). Artwork, route, dimensions, print method and color counts stay locked. WCM and the machine show old and new colors.

## Stock: Material readiness and Launch Stock
- Material readiness marks templates SHORT, TIGHT, COVERED, OVERSTOCK or STOCK READY. "Build & release" opens a quick launcher (quantity in KG, "Send straight to production").
- Launch Stock: pick a product master, commitment (Generic pool, Customer, Artwork, Customer + art), where the route stops (finished stock or WIP pool), size and layers, quantity; press "Validate pool", clear blockers, then create. Stock orders skip the release gate and the artwork gate; the first job is released at once.

## Combine Orders
Only jobs with the same Product Master, film stack, step and process, at a roll-output step and with a target width, can be combined. Tick 2 or more and press "Combine". Slitting happens at the WC terminal, one slit child per job, 5 mm trimmed at each cut.

## Roles
Planner, Plant Manager, Owner, Admin and Super Admin can open the Control Tower. Only the Planner or an authorised administrator can revise released print colors.

## Problems and fixes
- **"Artwork assignment is required before release for printing-enabled order."** Assign artwork first.
- **"Artwork must be APPROVED before assignment."** Engineering must approve it.
- **"Release is blocked until every planner-decided route step has a work center."** Fill Route dispatch.
- **"Plan saved; release pending."** Press "Retry release"; do not plan again.
- **"Plan not confirmed."** Press "Confirm saved plan"; the same plan is recovered.
- **"Saved; queue refresh pending."** Press "Retry saved queue" or "Refresh"; do not submit again.
- **"An earlier plan needs confirmation."** Resume it from the banner.
- **Red Material gate.** Fix the recipe/BOM on the product master.
- **Combine refused.** The message names the mismatch (Product Master, step, width, roll output).
- **Stock launch refused: "Template must be the current LIVE revision for Stock Order creation".** Make the template LIVE.

# Planner module — production-side screens

The main planner work is in the **Planner Control Tower** (/dashboard/planner/control-tower/...): Command, Plan queue, Live production, Completed trace, Material readiness, Combine orders and Launch stock. This document covers the production-side planner addresses and how they fit.

## Screens

- **/production** and **/production/planner** — old addresses. Both forward to the Control Tower "Command" tab. The "Jobs" tab of the Floor workspace also points to /production.
- **/production/planner/stock-launcher** — old address of the stock launcher; forwards to the Control Tower "Launch stock" tab and keeps the link query.
- **/production/planner/gang-builder** — "Combine orders". The same screen is the Control Tower "Combine orders" tab.
- **/production/planner/heatmap** — "Factory Heatmap / Capacity". Load per work centre.
- **/production/planning** — "Production Planning Board". An older board of jobs by state.

## Flow: combine orders onto one jumbo roll

1. Several orders of one Product Master and film recipe are released and wait at the same roll-making step (printing, lamination, slitting). Example: three ABC Foods lines, 230, 240 and 250 mm wide.
2. Open Combine orders. Groups are formed by Product Master + recipe + route step. A group is "combinable" only when it has at least 2 open orders, one Product Master, target widths on every order and a roll-output step.
3. Pick the group, tick 2 or more orders. The slit preview shows one block per order and the jumbo width: sum of widths + 5 mm trimmed at each cut (here 730 mm).
4. Press "Combine N orders". The orders get one gang batch id.
5. At the WC terminal the roll picker creates one slit child per order from one jumbo.

## Flow: check capacity before releasing

1. Open the heatmap. Each tile is a work centre. Load = running jobs ÷ machines × 100.
2. Red tiles (over 85%) are at risk; "Critical Contention" suggests holding new releases there.
3. "Optimal Slot" names the lightest work centre; route work there only if the template permits.
4. Release from the plan queue; follow running jobs in Live production.

## Planning board

The planning board lists jobs under Planned, Released, In Progress (running and paused) and Completed. It can release a planned job, split a planned job ("New Job Quantity (Split Off)"; the rest stays), change the priority number (lower runs first), put a released job on hold, and resume a paused job. Normal line release with stock and route checks is in the plan queue.

## Rules and limits

- Release in the plan queue waits for four gates: Spec, Material, Artwork, Route.
- Only PLANNED or WAITING jobs can be released; only PLANNED jobs can be split; split quantity must be less than the job quantity.
- Combining needs the same Product Master, the same step, roll output and a target width on every order.
- Rolls are allocated within ±20 mm of the planned web; lanes (n-up) decide the run web before slitting.
- Goods of a closed line can be moved to free stock with a reason; the planner can then claim them for another order of the same specification.

## Who does what

- **PLANNER**: combine orders, read capacity, use the planning board, release lines in the plan queue.
- **PLANT_MANAGER**: same views; checks load and holds.
- **ADMIN / OWNER / SUPER_ADMIN**: everything.
- **WORK_CENTER_MANAGER** makes the slits for combined orders on the WC terminal.

## Problems and fixes

- **No combinable groups** — orders differ in Product Master, recipe, step or width. Fix the line width or wait for more orders.
- **"Selected jobs must be at the same route step and process …"** — jobs moved on; press Refresh.
- **Heatmap shows 0% everywhere** — no job is running, or the work centres have no machines.
- **"Can only release PLANNED or WAITING jobs."** — the job already moved on; refresh.
- **"Emergency reason is required for EMERGENCY jobwork."** — "Detour to Job Work" on the planning board sends no reason; use Inventory › Job work.
- **Old link opens the Control Tower** — that is expected; update the bookmark.

## सारांश (हिंदी)
# Planner और Control Tower

planner confirm हुई sales order line को release हुए production job में बदलता है, तय करता है कि material कहाँ से आएगा, और line बंद होने तक उस पर नज़र रखता है। planner का पहला पेज **Planner Command Center** (`/dashboard/planner`) है और काम **Control Tower** में होता है, जिसमें सात tab हैं। cursor किसी field में न हो तो **1–7** key से tab बदलते हैं।

| Key | Tab | Route | किसलिए |
|---|---|---|---|
| 1 | Command | `/dashboard/planner/control-tower/command` | अभी क्या करना है: सबसे जोखिम वाले 5 order, source mix, demand, job की हालत, WC load, action desk, output, हाल की हलचल |
| 2 | Plan Queue | `.../plan-queue` | हर order line की एक row: gate, artwork, source, release, short-close, cancel |
| 3 | Live Production | `.../live-production` | release और चल रही line, machines now, आज की timeline, replan, color बदलाव |
| 4 | Completed Trace | `.../completed-trace` | बंद line, cycle time, समय पर, stock claim, trace की कमी, CSV export |
| 5 | Material readiness | `.../stock-intelligence` | हर template का stock बनाम demand, quick stock launch, packaging और POD |
| 6 | Combine Orders | `.../gang-builder` | एक Product Master के कई roll-output job एक jumbo पर |
| 7 | Launch Stock | `.../stock-launcher` | किसी भी product master पर stock के लिए order |

## मुख्य काम: sales line release करना
1. Sales order confirm करता है (draft queue में नहीं आते)।
2. **Plan Queue** में line खोजें (chip All, Ready, Blocked, Artwork, Overdue, Aged 30d+, New ≤3d; search; Filters; sort Newest / Due first / Largest) और click करें।
3. चार gate पढ़ें: **S** spec का हिसाब, **M** Material (recipe/BOM), **A** Artwork, **R** Route। हर gate सिर्फ़ अपनी जाँच दिखाता है। सिर्फ़ artwork बाकी हो तो पीला "Artwork pending", "Blocked" नहीं। Material तभी लाल जब recipe/BOM production-ready न हो।
4. print हो तो: "Assign artwork" दबाएँ और APPROVED artwork चुनें (product master, size, print type और sheet/tube form से छँटा हुआ)।
5. "Plan & Release" दबाएँ (FG या WIP मिले तो "Choose source & release")। source चुनें: **FG match** (finished stock से भेजें), **Carry WIP**, **Invariant stock**, **Input stock** (पहले roll-input step पर WCM के लिए पहले से चुना) या **Fresh run**। "KG to allocate" भरें या MAX दबाएँ।
6. "Route dispatch" में planner वाले हर step का work center चुनें; चाहें तो optional step छोड़ें।
7. "Release immediately after planning" ticked रखें और "Plan & Release" दबाएँ, या untick करके "Plan only"। toast में "Order planned & released" आता है।
8. job WC terminal पर दिखते हैं; Live Production में उनका पीछा करें; बंद line Completed Trace में जाती है।

## Roll और web width
- planned web से **±20 mm** के अंदर वाला roll सीधे इस्तेमाल होता है। ज़्यादा चौड़ा roll slit होता है, या कारण के साथ manual override से लगता है। −20 mm से पतला roll मना है।
- slitting step से पहले, कई lane (n-up) वाली line अपने planned parent web (lanes × child + trim) पर चलती है। उदाहरण: 700 mm web पर 3-up 230 mm line, printing पर 680–720 mm roll लेती है।
- spec card पर **Stock web** दिखता है, जैसे "Open web · 655 mm roll · slit allowed"।

## Short-close और cancel
- **Cancel line**: सिर्फ़ किसी भी machine, material या scrap गतिविधि से पहले। उसके बाद server कहता है "Line has machine activity. Use short-close for the remaining quantity."
- **Short close**: जो बना वह रहता है, सिर्फ़ बची मात्रा बंद होती है।
- दोनों के लिए कम से कम 5 अक्षर का कारण चाहिए; वह audit में रहता है।
- बंद line का पहले से बना माल yard में रहता है। Dispatch Bay उसे या तो भेजता है ("Send goods of closed lines" tick करने के बाद) या कारण के साथ free stock में डालता है; फिर planner उसे उसी spec के किसी भी order के लिए FG match की तरह ले सकता है।
- **Replan**: आख़िरी step ने target से कम बनाया, तो जो बना वह dispatch हो सकता है और बाकी re-release या short-close के लिए queue में रहता है।

## Print color बदलना
release के बाद और पूरा होने से पहले, "Revise colors only" से ink के नाम (कारण के साथ) बदलते हैं। artwork, route, माप, print method और color की गिनती लॉक रहती है। WCM और machine पुराने और नए color दोनों दिखाते हैं।

## Stock: Material readiness और Launch Stock
- Material readiness template पर SHORT, TIGHT, COVERED, OVERSTOCK या STOCK READY लिखता है। "Build & release" quick launcher खोलता है (KG में मात्रा, "Send straight to production")।
- Launch Stock: product master चुनें, commitment (Generic pool, Customer, Artwork, Customer + art), route कहाँ रुके (finished stock या WIP pool), size और layer, मात्रा; "Validate pool" दबाएँ, blocker हटाएँ, फिर बनाएँ। stock order release gate और artwork gate नहीं देखता; पहला job तुरंत release होता है।

## Combine Orders
सिर्फ़ एक ही Product Master, film stack, step और process वाले, roll-output step पर खड़े और target width वाले job जुड़ते हैं। 2 या ज़्यादा tick करें और "Combine" दबाएँ। slitting WC terminal पर होती है, हर job का एक slit child, हर cut पर 5 mm trim।

## Roles
Planner, Plant Manager, Owner, Admin और Super Admin Control Tower खोल सकते हैं। release हुए print color सिर्फ़ Planner या अधिकृत administrator बदल सकता है।

## समस्याएँ और हल
- **"Artwork assignment is required before release for printing-enabled order."** पहले artwork लगाएँ।
- **"Artwork must be APPROVED before assignment."** Engineering approve करे।
- **"Release is blocked until every planner-decided route step has a work center."** Route dispatch भरें।
- **"Plan saved; release pending."** "Retry release" दबाएँ; दोबारा plan न करें।
- **"Plan not confirmed."** "Confirm saved plan" दबाएँ; वही plan वापस मिलता है।
- **"Saved; queue refresh pending."** "Retry saved queue" या "Refresh" दबाएँ; दोबारा submit न करें।
- **"An earlier plan needs confirmation."** banner से Resume करें।
- **Material gate लाल।** product master पर recipe/BOM ठीक करें।
- **Combine मना।** संदेश बताता है क्या मेल नहीं खाता (Product Master, step, width, roll output)।
- **Stock launch मना: "Template must be the current LIVE revision for Stock Order creation"।** template LIVE करें।

# Planner मॉड्यूल — production की तरफ़ की स्क्रीन

Planner का मुख्य काम **Planner Control Tower** (/dashboard/planner/control-tower/...) में होता है: Command, Plan queue, Live production, Completed trace, Material readiness, Combine orders और Launch stock। यह दस्तावेज़ production की तरफ़ के planner पते और उनका संबंध बताता है।

## स्क्रीन

- **/production** और **/production/planner** — पुराने पते। दोनों Control Tower के "Command" टैब पर भेजते हैं। Floor workspace का "Jobs" टैब भी /production पर जाता है।
- **/production/planner/stock-launcher** — stock launcher का पुराना पता; Control Tower के "Launch stock" टैब पर भेजता है, लिंक की query साथ रहती है।
- **/production/planner/gang-builder** — "Combine orders"। यही स्क्रीन Control Tower का "Combine orders" टैब है।
- **/production/planner/heatmap** — "Factory Heatmap / Capacity"। हर work centre का लोड।
- **/production/planning** — "Production Planning Board"। स्थिति के अनुसार jobs का पुराना board।

## क्रम: कई orders को एक jumbo roll पर जोड़ना

1. एक ही Product Master और film recipe के कई orders रिलीज़ होकर एक ही roll बनाने वाले step (printing, lamination, slitting) पर रुके हैं। जैसे ABC Foods की तीन lines, 230, 240 और 250 mm चौड़ी।
2. Combine orders खोलें। Groups Product Master + recipe + route step से बनते हैं। Group तभी "combinable" है जब उसमें कम से कम 2 खुले orders हों, एक Product Master हो, हर order की target चौड़ाई हो और step roll बनाता हो।
3. Group चुनें, 2 या ज़्यादा orders टिक करें। slit preview हर order का एक ब्लॉक और jumbo की चौड़ाई दिखाता है: चौड़ाइयों का जोड़ + हर कट पर 5 mm (यहाँ 730 mm)।
4. "Combine N orders" दबाएँ। orders को एक gang batch id मिलता है।
5. WC terminal पर roll picker एक jumbo से हर order का एक slit child बनाता है।

## क्रम: रिलीज़ से पहले क्षमता देखना

1. Heatmap खोलें। हर टाइल एक work centre है। लोड = चल रहे jobs ÷ machines × 100।
2. लाल टाइल (85% से ऊपर) जोखिम में हैं; "Critical Contention" वहाँ नई रिलीज़ रोकने को कहता है।
3. "Optimal Slot" सबसे खाली work centre बताता है; template अनुमति दे तभी वहाँ काम भेजें।
4. रिलीज़ plan queue से करें; चल रहे jobs Live production में देखें।

## Planning board

Planning board jobs को Planned, Released, In Progress (चल रहे और रुके) और Completed में दिखाता है। इससे planned job रिलीज़ कर सकते हैं, planned job split कर सकते हैं ("New Job Quantity (Split Off)"; बाकी मूल job पर रहता है), priority नंबर बदल सकते हैं (छोटा पहले चलता है), released job को hold कर सकते हैं, और रुके job को resume कर सकते हैं। स्टॉक और route जाँच के साथ line की सामान्य रिलीज़ plan queue में होती है।

## नियम और सीमाएँ

- Plan queue में रिलीज़ चार गेट का इंतज़ार करती है: Spec, Material, Artwork, Route।
- केवल PLANNED या WAITING job रिलीज़ होते हैं; केवल PLANNED job split होते हैं; split मात्रा job की मात्रा से कम हो।
- जोड़ने के लिए एक Product Master, एक step, roll output और हर order की target चौड़ाई चाहिए।
- Rolls planned web से ±20 mm के भीतर लगते हैं; slitting से पहले lanes (n-up) run web तय करती हैं।
- बंद line का माल कारण के साथ free stock में जा सकता है; फिर planner उसे उसी specification के दूसरे order के लिए claim कर सकता है।

## कौन क्या करता है

- **PLANNER**: orders जोड़ना, क्षमता देखना, planning board, plan queue में रिलीज़।
- **PLANT_MANAGER**: वही views; लोड और hold देखता है।
- **ADMIN / OWNER / SUPER_ADMIN**: सब कुछ।
- **WORK_CENTER_MANAGER** जोड़े गए orders के slit WC terminal पर करता है।

## समस्याएँ और समाधान

- **कोई combinable group नहीं** — orders का Product Master, recipe, step या चौड़ाई अलग है। line की चौड़ाई ठीक करें या और orders का इंतज़ार करें।
- **"Selected jobs must be at the same route step and process …"** — jobs आगे बढ़ गए; Refresh दबाएँ।
- **Heatmap हर जगह 0%** — कोई job नहीं चल रहा, या work centres में machines नहीं।
- **"Can only release PLANNED or WAITING jobs."** — job आगे बढ़ चुका; रिफ्रेश करें।
- **"Emergency reason is required for EMERGENCY jobwork."** — planning board का "Detour to Job Work" कारण नहीं भेजता; Inventory › Job work इस्तेमाल करें।
- **पुराना लिंक Control Tower खोलता है** — यह सही है; बुकमार्क बदलें।

## Every screen (English)

### Planner Command Center (/dashboard/planner)
Screen address: /dashboard/planner · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANNER, PLANT_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=dashboard-planner

Planner's landing page: queue health, release readiness, stock pools, work-center load, demand and recent planner activity on one screen.

Open it first thing to see pressure: overdue and due-today lines, blocked rows and coverage. Then go to the Control Tower to act. This page only shows numbers and links; release, artwork and stock decisions happen in the Control Tower and Stock launcher.

**Before you start**
- Confirmed sales orders and LIVE templates.

**Step by step**
1. Read the top tiles: "Planning queue", "Ready / released", "Blocked rows", "Required demand", "Allocatable stock" and "Coverage", plus "Overdue" and "Due today".
2. Read "Immediate actions" (what needs planner attention now).
3. Check "Work center load" for capacity pressure and "Demand" for upcoming sales pull (Order, Customer, Template, Pending, Due).
4. Check "Source path" (Final Roll Pool, Invariant Pool, Upstream Pool) and "Costing coverage" (Actual, Hybrid, Estimated).
5. Under "Quick actions" press "Open" (Planner control tower), "Launch" (Stock launcher) or "Configure" (Product Master).
6. Press "Refresh" for fresh numbers.

**What is on the screen**
- **Planning queue**: Rows waiting for planner action.
- **Ready / released**: Rows already releasable.
- **Blocked rows**: Queue rows with blockers or on hold.
- **Required demand**: Queue weight still to satisfy, in kg.
- **Allocatable stock**: Inventory the planner can use right now.
- **Release readiness**: Queue state split: ready, queued, blocked.
- **Recent planner activity**: Latest released and planned jobs.

**Common problems and fixes**
- "Planner analytics feed is unavailable. This panel is paused instead of showing fallback zeros." — The planner dashboard feed failed. Press "Refresh"; the Control Tower may still work.
- "Planner data feed unavailable" — KPI and action cards are paused until the next successful sync.

**If stuck**
1. If numbers do not move after a release, press "Refresh" or open Plan Queue, which reads the live queue.

Related pages: /dashboard/planner/control-tower/command, /dashboard/planner/control-tower/plan-queue, /production/planner/stock-launcher, /master/products

### Planner Control Tower (redirect) (/dashboard/planner/control-tower)
Screen address: /dashboard/planner/control-tower · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANNER, PLANT_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=dashboard-planner-control-tower

Opens the Control Tower on its first tab, Command.

The Control Tower is the planner's working area. The Control Tower has seven tabs; keys 1–7 jump between them (when you are not typing in a field): 1 Command, 2 Plan Queue, 3 Live Production, 4 Completed Trace, 5 Material readiness, 6 Combine Orders, 7 Launch Stock.

**Before you start**
- Planner, Plant Manager, Owner or Admin role.

**Step by step**
1. Open "Planner Control Tower" from the sidebar or Plan workspace.
2. You land on Command. Use the workspace bar or keys 1–7 to change tab.

**What is on the screen**
- **Keys 1–7**: Jump to tab 1 to 7. Ignored while typing in an input.

**Common problems and fixes**
- "Number keys change the tab unexpectedly" — Keys 1–7 are tab shortcuts when the cursor is not in a field. Click into the search box before typing numbers.

**If stuck**
1. Bookmark the tab you use most, for example Plan Queue.

Related pages: /dashboard/planner/control-tower/command, /dashboard/planner/control-tower/plan-queue

**Not done yet / watch out**
- Keys 1–7 change tab whenever the cursor is outside a field, which can surprise users who type numbers by mistake.

### Command (/dashboard/planner/control-tower/command)
Screen address: /dashboard/planner/control-tower/command · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANNER, PLANT_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=dashboard-planner-control-tower-command

Tab 1 of the Control Tower: what to act on right now, across the queue, source pools, WCM handoff, blockers and demand.

Open it to decide the next move. It reads the planner dashboard and the order queues and shows the top 5 at-risk orders, stock pools, demand, job states, work-center load, alerts, output and recent movement. Each card links to the tab where you act (Plan Queue, Material readiness, Live Production, Stock launcher).

**Before you start**
- Confirmed sales order lines in the planner queue.

**Step by step**
1. Check the feed status line for "Command metrics" and "Order queues"; press "Refresh" if either failed.
2. Read "Top 5 at-risk orders": due label (overdue, due today, due in N days) and the four gates Math, Artwork, Material, Route. Press "Open Plan Queue →" to act.
3. Read "Source Mix" (stock pool composition, Coverage, Allocatable vs Required) and "Release readiness" (Ready, Queued, Blocked, Artwork). Press "New stock order" or "Drill" (Material readiness).
4. Check "Top pending sales demand", "State distribution" and "Where released jobs are waiting".
5. Read "Action desk": Today's blockers, Next releases, WCM handoff and Live alerts.
6. Check "Production rhythm" (Days tracked, Peak day, Avg/day) and "Latest job movement"; press "Live production →" for the floor.

**What is on the screen**
- **Gates Math / Artwork / Material / Route**: Release checks for each line. All four must pass before release.
- **Coverage**: Allocatable stock against required kg.
- **Where released jobs are waiting**: Pending and running jobs per work center.
- **Total queued / Total jobs / Live handoff**: Planning queue size, all jobs, and active jobs handed to WCM.

**Common problems and fixes**
- "Queue is clear" — No open queue rows.
- "No source pools" — No positive FG, WIP, invariant, POD or packaging pool rows were returned; the card shows release readiness instead.
- "Feed failed in the status line" — One of the two reads timed out. Press "Refresh"; nothing is lost.

**If stuck**
1. Cards appear only after both feeds load; if the page stays empty, press "Refresh".

Related pages: /dashboard/planner/control-tower/plan-queue, /dashboard/planner/control-tower/stock-intelligence, /dashboard/planner/control-tower/live-production, /dashboard/planner/control-tower/completed-trace, /production/planner/stock-launcher

### Completed Trace (/dashboard/planner/control-tower/completed-trace)
Screen address: /dashboard/planner/control-tower/completed-trace · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANNER, PLANT_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=dashboard-planner-control-tower-completed-trace

Closed lines with cycle time, on-time delivery, throughput and an expandable per-order route trace and BOM.

Tab 4. Open it to review what finished: how long lines took, which were late, which closed by stock claim, short-close or WCM posting, and where the trace has gaps. Export the window to CSV for review.

**Before you start**
- Lines closed by completion, stock claim or short-close.

**Step by step**
1. Pick the window: Today, 7 days, 30 days or 90 days (default 90).
2. Read the KPIs: "Closed lines", "Demand closed", "On-time", "Cycle time", "Stock claims", "Short close", "Trace gaps".
3. Filter by audit state (All audit, WCM posted, Stock claim, Short close, Trace gap), source path or customer; search by order, customer, product, size or layer.
4. Expand an order to see Customer, Placed, Closed, Delivery, Status, Spec hash and the route with Planned / Posted / Open per step.
5. Use the charts: "Orders closed per day", "By KG shipped", "By order count".
6. Press "Export CSV" to download the filtered list.

**What is on the screen**
- **On-time**: Share of closed lines delivered by the due date (On time vs Late).
- **Cycle time**: Days from order placed to closed.
- **Stock claims**: Lines closed from stock or packing claim instead of a fresh run.
- **Trace gaps**: Closed lines whose route postings are incomplete; check them with WCM.
- **Spec hash**: Fingerprint of the line's specification, used to match stock.

**Common problems and fixes**
- "No closed orders" — Nothing closed in the chosen window. Pick a wider window.

**If stuck**
1. If a line you expect is missing, widen the window to 90 days and clear filters.

Related pages: /dashboard/planner/control-tower/live-production, /sales/orders, /logistics/dispatch

**Not done yet / watch out**
- Export CSV downloads only the filtered window, not the full history.

### Combine Orders (/dashboard/planner/control-tower/gang-builder)
Screen address: /dashboard/planner/control-tower/gang-builder · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANNER, PLANT_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=dashboard-planner-control-tower-gang-builder

Combine multiple orders onto one jumbo roll. Only same Product Master orders at the same live route step can be combined.

Tab 6. Use it to save setups and trim: released roll-output jobs that share Product Master, film recipe, step and target width are grouped. You tick 2 or more and press Combine; at the work-center terminal the roll picker then makes one slit child per selected job. This page only plans; slitting happens at the WC terminal.

**Before you start**
- At least two released roll-output jobs of the same Product Master, recipe and step, each with a target roll width.

**Step by step**
1. Read the tiles: "PM step groups", "Jumbo-ready orders", "Ready film", "Need setup". Filter by step ("All steps") or search.
2. Pick a recipe group on the left ("Jumbo-ready groups").
3. Tick 2 or more orders. Check the "Slit layout preview" (one slit per order, 5 mm trimmed at each cut).
4. Press "Combine". The toast shows how many orders were combined and the batch id.
5. Use "Clear ticks" to start again. The WC manager slits at the work-centre terminal.

**What is on the screen**
- **Same PM**: Product Master, film stack, step and process must match.
- **Roll output**: Only roll-output jobs with a target width can join a jumbo batch.
- **WCM slit**: The machine roll picker creates one slit child per selected job.
- **generic stock / no roll width set**: Row tags: a stock (not customer) job, or a job missing its width, which blocks combining.

**Common problems and fixes**
- "Select at least 2 jobs to commit a gang." — Tick two or more orders.
- "Selected jobs must use the same Product Master before they can share one jumbo." — Pick orders from one group only.
- "Selected jobs must be at the same route step and process before they can share one jumbo." — One job moved on; refresh and pick again.
- "Selected jobs need target roll width before they can share one jumbo." — Set the width on the order line, or leave that job out.
- "Some selected jobs are not open or do not exist." — A job started or closed meanwhile. Press "Refresh".

**If stuck**
1. No groups ("No combinable route groups yet"): jobs must be released and share PM, recipe, step and width.

Related pages: /production/planner/gang-builder, /production/work-center, /dashboard/planner/control-tower/plan-queue

**Not done yet / watch out**
- Combining only plans the jumbo; nothing is slit until the WC terminal does it, and a combine cannot be undone from this page.

### Live Production (/dashboard/planner/control-tower/live-production)
Screen address: /dashboard/planner/control-tower/live-production · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANNER, PLANT_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=dashboard-planner-control-tower-live-production

Released lines, WCM handoff, running jobs, partial replan and the route-wise trace of everything now on the floor.

Tab 3. Open it after release to follow lines through the work centers: which machine runs what since when, what waits, what is paused and what needs a replan. From an order you can open its passport, revise print colors, short-close or cancel.

**Before you start**
- Lines released from Plan Queue.

**Step by step**
1. Read the KPIs: "Posted on live lines", "Open on live lines", "Lines by state" (Running, Released, Waiting, Replan), "Needs attention", "Machines busy", "Paused", "Next job released".
2. Check "Machines now" (each machine's current job and since when; refreshes every 30 s) and "Today on the machines" (each job from start to close; scroll sideways).
3. Filter with All live, Running, Released, Waiting / paused, Replan or Blockers, and by "Route path"; search by order, customer, product or route.
4. Open an order card to see its "Order passport" and job cards (RUNNING, REPLAN, RELEASED, WCM HANDOFF, WAITING).
5. To change ink names after release, press "Revise colors", fill the NEW colors and a reason, and confirm.
6. Use "Short close" or "Cancel line" with a reason of at least 5 characters; read the Cancel rule and Short-close rule pills first.
7. Check "Release blockers" and "Output rhythm" (30-day posted kg).

**What is on the screen**
- **Machines now**: From the job board; current job per machine and how long it has run.
- **Replan**: The final step made less than the target; dispatch can ship what was made, the balance waits in the queue for re-release or short-close.
- **Cancel rule**: Cancel is allowed until machine, material or scrap activity exists; the server refuses after that.
- **Short-close rule**: Keeps posted production and closes only the unresolved remaining quantity.
- **WCM machine close**: WCM's close records actual output, scrap and variance. Planner short-close is only for the sales-line balance after that.

**Common problems and fixes**
- "Print colors can be revised only after Planner release and before completion." — The line is not released yet or is already complete.
- "Only Planner or an authorised administrator can revise released print colors." — Ask the planner to do it.
- "Cancel is locked because this line is already closed." — Closed lines cannot be cancelled or short-closed again. Goods made for them are handled in Dispatch Bay (ship or move to stock).
- "Stock order cancel from Control Hub is not enabled here. Use the stock order lifecycle action." — Short close and cancel here are for sales lines only.

**If stuck**
1. If a job seems stuck, open the WC terminal for that work center; the Stalled tab there lists it.
2. Press "Refresh" if the machine strip looks old.

Related pages: /production/work-center, /production/machine-selector, /dashboard/planner/control-tower/plan-queue, /dashboard/planner/control-tower/completed-trace, /logistics/packing

**Not done yet / watch out**
- Short close and cancel here work only for sales lines; stock orders must use their own lifecycle action.

### Plan queue (/dashboard/planner/control-tower/plan-queue)
Screen address: /dashboard/planner/control-tower/plan-queue · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANNER, PLANT_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=dashboard-planner-control-tower-plan-queue

Release what is ready, clear what is blocked. One row per sales-order line; pick a row for its full spec, sourcing and release.

Tab 2 of the Control Tower and the planner's main desk. Confirmed order lines arrive here. For each line you check four gates (Spec, Material, Artwork, Route), assign artwork if needed, choose the source (finished stock, WIP, invariant or input stock, or a fresh run), pick work centers for planner-decided steps and press "Plan & Release". Released jobs go to the WC terminal. You can also short-close or cancel a line here.

**Before you start**
- Sales order confirmed (drafts do not appear).
- Product master line with a LIVE template, a route and a production-ready recipe/BOM.
- For printed lines: an APPROVED artwork for that master, size and print type.

**Step by step**
1. Use the KPI tiles or chips to cut the queue: "Ready to release", "Blocked", "Artwork pending", "Overdue"; chips All, Ready, Blocked, Artwork, Overdue, Aged 30d+, New ≤3d. Search by order, customer, product or template; press "Filters" for the filter dock.
2. Sort by Newest, Due first or Largest, then click a row. The detail opens beside the queue.
3. Read the row: job name (JOB), product, demand in kg and pcs, gates S M A R, route steps (dashed steps are already covered by WIP or stock), state badge and due date.
4. If "Artwork required" shows, press "Assign artwork", search by design code or name, pick an approved artwork and confirm.
5. Check the "Release checklist" (Math validates, Material plan, Route span) and any "Blockers" list.
6. Press "Plan & Release" (or "Choose source & release" when finished goods or WIP match). In the dialog pick the source: FG match, Carry WIP, Invariant stock, Input stock or Fresh run; enter "KG to allocate" or press MAX.
7. Under "Route dispatch" choose a work center for every planner-decided step. Under "Optional route steps" skip a step only if this run should jump it.
8. Keep "Release immediately after planning" ticked to hand the line to WCM now (button "Plan & Release"), or untick for "Plan only". Press the button and wait for "Order planned & released".
9. To stop a line: press "Short close" (keeps what was produced, closes the rest) or "Cancel line" (only before machine activity), type a reason of at least 5 characters and confirm.

**What is on the screen**
- **Ready to release**: Lines whose math is valid, artwork is set and no blocker remains. Click to filter.
- **Blocked**: Split into Recipe / spec, Artwork only, Replan and Stock check.
- **Queue weight**: Required kg of the lines in view.
- **Gate S (Spec)**: Spec and quantity math. Red: "Spec or quantity math is invalid" — fix the line on the sales order or product master.
- **Gate M (Material)**: Red only when the recipe/BOM is not production-ready. Amber when the stock lookup failed or the material plan has no lines.
- **Gate A (Artwork)**: Amber "Artwork pending" until an approved artwork is assigned; skipped when the line has no print.
- **Gate R (Route)**: Route span from start step to last step; amber for a balance replan or unresolved span.
- **State badge**: Ready to release (FG match / WIP continue / Fresh run), Artwork pending, Blocked · recipe, Planning required, Replan, Check stock or Row error, with the reason.
- **Stock web (What is to be made)**: Shows the web the line runs on, e.g. "Open web · 655 mm roll · slit allowed". Rolls within ±20 mm of the planned web are used as they are.
- **Release immediately after planning**: Ticked: plan and release in one go. Unticked: plan only, release later.
- **Revise colors only**: After release and before completion, change print color names with a reason; artwork, route and color counts stay locked.

**Common problems and fixes**
- "Artwork assignment is required before release for printing-enabled order." — Press "Assign artwork" first.
- "Artwork must be APPROVED before assignment." — Ask engineering to approve the artwork on the Artworks page.
- "Release is blocked until every planner-decided route step has a work center." — Pick a work center under "Route dispatch" for each step.
- "Allocate at least one candidate to proceed" — You chose a stock source but entered no kg. Enter kg or switch to Fresh run.
- "Plan saved; release pending" — The plan was saved but release failed. Press "Retry release"; do not plan again.
- "Plan not confirmed" — The connection ended before confirmation. Press "Confirm saved plan" to recover the same plan.
- "Saved; queue refresh pending" — The order was saved but the queue did not reload. Press "Retry saved queue" or "Refresh". Do not submit again.
- "Line has machine activity. Use short-close for the remaining quantity." — Cancel is allowed only before machine activity. Use "Short close".
- "Reason required" — Short close and cancel need at least 5 characters of reason for the audit trail.
- "Line must be PLANNED before release. Current: …" — The line changed (already released or closed). Press "Refresh" and check its state.

**If stuck**
1. If a banner says "An earlier plan needs confirmation", use Resume; it checks the saved result and finishes the release.
2. If "Could not load the current line detail. Actions are paused.", press "Retry detail".
3. Red Material gate: fix the recipe/BOM on the product master, then refresh.
4. Line missing: check the order is confirmed, not draft, and clear filters (chip "All").

Related pages: /sales/orders, /engineering/artworks, /master/products, /production/work-center, /dashboard/planner/control-tower/live-production, /dashboard/planner/control-tower/stock-intelligence

### Material readiness (/dashboard/planner/control-tower/stock-intelligence)
Screen address: /dashboard/planner/control-tower/stock-intelligence · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANNER, PLANT_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=dashboard-planner-control-tower-stock-intelligence

Which demand is short, by how much, and the one thing to do next: stock vs demand per template, packaging and POD in-house work, aged stock.

Tab 5. Open it when deciding whether to build stock. Templates are marked SHORT, TIGHT, COVERED, OVERSTOCK or STOCK READY. For a short template you can launch a stock order right here ("Build & release") or go to Plan Queue ("Plan").

**Before you start**
- LIVE templates with demand or stock.

**Step by step**
1. Read the KPIs: "Templates short", "Tight", "Coverage", "Templates by cover", "FG ready to ship", "In-house packing & POD".
2. In "Critical · build now" see kg short per template; press "Build & release" to open the Quick stock launcher.
3. In the Quick stock launcher enter "Quantity to build" (KG). Keep "Send straight to production" ticked to release the first job at once, then submit.
4. Use "Order specs that need stock decisions" and "Demand vs Stock" (Stock, Demand, Deficit or Surplus per template); search by template.
5. Check the funnel Demand → Plannable → Releaseable → Released → Completed.
6. Use "Packaging in-house" ("New packaging", "Launch one") and "POD bulk stock" ("New POD") for in-house stock.
7. Review "Stock without matching demand" and "Jobs stalled ≥ 3 days".

**What is on the screen**
- **SHORT / TIGHT / COVERED / OVERSTOCK / STOCK READY**: Cover status of a template: stock against open demand.
- **LINK MASTER**: Shown when a row has no product master link; quick launch needs a full template, geometry and layer snapshot.
- **Send straight to production**: Stock launcher orders bypass the release gate: the first job is released immediately and there is no artwork gate.
- **Stock without matching demand**: Idle stock no open order can use; offer it to sales or plan it.

**Common problems and fixes**
- "Stock intelligence is paused" — A feed failed. Press "Retry feeds".
- "Quick launch needs a full template + geometry + layer snapshot" — This template has no snapshot in the aggregation. Use the full Stock Order Launcher (link in the dialog).
- "Stock order failed" — The server refused the order; the toast shows the reason (for example "Template must be the current LIVE revision for Stock Order creation").

**If stuck**
1. Use "New stock order" for the full launcher when quick launch is not possible.

Related pages: /production/planner/stock-launcher, /dashboard/planner/control-tower/stock-launcher, /dashboard/planner/control-tower/plan-queue, /master/products

**Not done yet / watch out**
- Quick launch does not work for templates without a full geometry and layer snapshot; the full launcher must be used.
- Stock launched from here bypasses the release and artwork gates, unlike sales lines in Plan Queue.

### Launch stock from any Product Master (/dashboard/planner/control-tower/stock-launcher)
Screen address: /dashboard/planner/control-tower/stock-launcher · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANNER, PLANT_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=dashboard-planner-control-tower-stock-launcher

Create an in-house stock order (make-to-stock) on a product master: finished stock, a WIP pool, packaging or POD bulk, with the same spec rules as a sales order.

Tab 7. Use it when Material readiness shows a shortage or when you want ready stock for fast orders. The order runs the same route, floor and packing as a customer order. Manual launches create and release the production order directly, with no artwork gate. Later, sales lines with the same spec can claim the stock from Plan Queue.

**Before you start**
- An active product master with a LIVE template and route.
- Sizes and layer options on the master; for packaging or POD a linked catalog SKU.

**Step by step**
1. "What to build": filter All, Pouch, Roll, Packaging or POD, search by code or name and pick one product master.
2. "Commitment": choose Generic pool (any order may use it), Customer, Artwork or Customer + art, and fill the lock.
3. "Build up to": tap where the route stops — Finished stock or a WIP pool.
4. "Spec / axes": pick the size and per-layer options; check Width match and Stock form.
5. "Quantity": enter Target qty and UOM (rolls use KG).
6. Press "Validate pool" and clear every item under "Launch blockers".
7. Press the launch button ("Create stock order -> production", "Create WIP pool -> production", "Create packaging order -> production" or "Create POD bulk stock"). Wait for "Stock order created".

**What is on the screen**
- **Commitment**: Controls reuse: Generic pool, Customer (held for one buyer), Artwork (printed for one artwork), Customer + art (exact match only).
- **Build up to**: Route stop. Full route gives finished stock; an earlier stop parks a WIP roll pool.
- **Interim WIP roll width**: Width of the parked WIP roll. Sales demand can resume from it when the required width is the same or lower and the size allows slitting.
- **Matching demand**: Open sales lines that could pull from this pool: Eligible orders, Exact width, Slit allowed, Wrong lock.
- **Launch blockers**: Checks: Product master, Template & route stop, Commitment safety, Axes complete, Stock math + BOM. The button stays off until all pass.
- **Catalog SKU link**: For packaging or POD masters: the SKU stores and packing will receive.

**Common problems and fixes**
- "Template must be the current LIVE revision for Stock Order creation" — Make the template LIVE in Engineering, then retry.
- "Template has no routing rule" — Link a route to the template first.
- "Roll stock orders require quantity_uom=KG" — Choose KG for roll stock.
- "committed_customer is required for customer-committed stock" — Pick the customer in the Customer lock, or choose Generic pool.
- "committed_artwork is required for artwork-committed stock" — Pick the artwork lock.
- "Printing enabled but no inks resolved from artwork." — The chosen artwork has no inks; fix the artwork or pick another.

**If stuck**
1. If the launch button stays grey, read "Launch blockers" and press "Validate pool" again after each fix.

Related pages: /production/planner/stock-launcher, /dashboard/planner/control-tower/stock-intelligence, /dashboard/planner/control-tower/plan-queue, /master/products

**Not done yet / watch out**
- There is no quotation exit on the stock launcher; a price request on the same spec must be made on the Quotations page.
- Matching demand counts can show as not computed for a validation; the order still creates.

### Production (opens Planner Control Tower) (/production)
Screen address: /production · Roles: ADMIN, OWNER, PLANNER, WORK_CENTER_MANAGER, PLANT_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=production

This address has no screen of its own. It sends you straight to the Planner Control Tower, tab "Command".

Old links, bookmarks and the "Jobs" tab of the Floor workspace still point to /production. The planning work now lives in the Control Tower (Command, Plan queue, Live production, Completed trace, Material readiness, Combine orders, Launch stock), so this address forwards there.

**Before you start**
- A role that may open the Control Tower (Planner, Plant manager, Admin, Owner).

**Step by step**
1. Open /production or press the "Jobs" tab in the Floor workspace.
2. The page forwards at once to /dashboard/planner/control-tower/command.
3. To see one job, open it from the plan queue, Live production or Completed trace; its summary opens at /production/jobs/<id>.
4. For floor work use "WC terminal" (/production/work-center) or "Machine terminal" (/production/machine-selector).

**What is on the screen**
- **Redirect target**: Always /dashboard/planner/control-tower/command. Nothing is saved or changed on the way.

**Common problems and fixes**
- "You land on a page you cannot use" — The Control Tower is for planning roles. A work-centre manager should use the WC terminal; an operator is kept on the machine terminal.

**If stuck**
1. If the redirect loops or shows a blank page, open /dashboard/planner/control-tower/command directly.
2. Update old bookmarks to the Control Tower tab you actually use.

Related pages: /dashboard/planner/control-tower/command, /dashboard/planner/control-tower/plan-queue, /production/work-center, /production/machine-selector

**Not done yet / watch out**
- The Floor workspace tab "Jobs" points to /production, which only redirects to the Control Tower Command tab, so there is no list of production jobs behind it.

### Planner (opens Control Tower) (/production/planner)
Screen address: /production/planner · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANNER, PLANT_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=production-planner

The old planner address. It forwards to the Planner Control Tower, tab "Command".

The planner moved into the Control Tower. Releasing lines, claiming stock, combining orders and launching stock are all done there.

**Before you start**
- A planning role (Planner, Plant manager, Admin, Owner).

**Step by step**
1. Open /production/planner; it forwards to /dashboard/planner/control-tower/command.
2. Use "Plan queue" to release lines to the route.
3. Use "Combine orders" or "Launch stock" for those jobs.

**What is on the screen**
- **Redirect target**: /dashboard/planner/control-tower/command.

**Common problems and fixes**
- "Blank page after redirect" — Your role cannot open the Control Tower. Ask an admin for a planning role.

**If stuck**
1. Open the Control Tower from the Plan workspace directly and update your bookmark.

Related pages: /dashboard/planner/control-tower/command, /dashboard/planner/control-tower/plan-queue, /dashboard/planner

### Combine orders (/production/planner/gang-builder)
Screen address: /production/planner/gang-builder · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANNER, PLANT_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=production-planner-gang-builder

Combine two or more released orders of the same Product Master at the same roll-output step, so they run on one jumbo roll and are slit apart at the machine.

Open it when several small orders of one film recipe are waiting at printing, lamination or slitting. The same screen is the "Combine orders" tab of the Control Tower. After you combine, the WC terminal roll picker creates one slit child per order.

**Before you start**
- Jobs released and open (PLANNED, WAITING, RELEASED or QUEUED) at a step that makes rolls.
- Each job has a target roll width and a Product Master.

**Step by step**
1. Use search ("Search order, customer, Product Master, job, step..."), "All" / "Combinable" / "Needs setup" and the step list to narrow the groups.
2. Pick a group in "Jumbo-ready groups". A green "N orders · combinable" badge means it can be combined.
3. In "Pick orders to combine" tick 2 or more orders.
4. Check "Slit layout preview": one block per order, the jumbo width (sum of widths + 5 mm per cut) and kg.
5. Press "Combine N orders". The toast shows the batch id: "they'll slit together at the machine".
6. Tell the WCM; the slits are made at the work-centre terminal. "Clear ticks" removes your selection.

**What is on the screen**
- **PM step groups / Jumbo-ready orders / Ready film / Need setup**: Number of Product Master + step groups, orders in combinable groups, their kg, and groups blocked by setup.
- **Group line**: Product Master, step name and number, output form, widths, target kg and the first blocking reason.
- **#abc123**: Recipe fingerprint (internal) — same number means same film stack.
- **Order row**: SO number, customer, "generic stock" badge, width ("no roll width set" if missing), kg, job and state.

**Common problems and fixes**
- "Need at least 2 open orders. / Orders must share one Product Master. / Target roll width is missing. / Current step must create roll output for jumbo slitting." — These show on a "setup needed" group. Fix the width or Product Master on the order line, or wait for more orders.
- "One or more orders has no roll width set — combining is not safe." — A ticked order has no target width. Untick it or fix the line.
- "Selected jobs must be at the same route step and process before they can share one jumbo." — The jobs moved to different steps since the page loaded. Press "Refresh".
- "Some selected jobs are not open or do not exist." — A job was completed or cancelled meanwhile. Refresh and tick again.

**If stuck**
1. Press "Refresh"; the list also reloads every 45 seconds.
2. If no group appears ("No combinable route groups yet"), the jobs differ in Product Master, recipe, step or width.

Related pages: /dashboard/planner/control-tower/gang-builder, /dashboard/planner/control-tower/plan-queue, /production/work-center

**Not done yet / watch out**
- The jumbo width in the preview assumes a fixed 5 mm trim per cut, and only the first 60 groups from 160 scanned jobs are loaded.

### Factory Heatmap / Capacity (/production/planner/heatmap)
Screen address: /production/planner/heatmap · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANNER, PLANT_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=production-planner-heatmap

A tile per work centre coloured by load (running jobs ÷ machines), with alerts for the busiest and the lightest work centre.

Open it before releasing more work to see where machines are free. It is read-only; release work from the plan queue.

**Before you start**
- Work centres with machines set up in Factory.

**Step by step**
1. Read the four tiles: "Work centers", "Running now", "At-risk load", "Average load".
2. In "Work Center Matrix" hover a tile to see machines ("Total Units") and running jobs ("Active Load").
3. Read "System Alerts": "Critical Contention" names a work centre above 85%; "Optimal Slot" names the lightest one.
4. Press "Open live production" to see the running jobs, or "Refresh".

**What is on the screen**
- **Tile colour**: White = 60% or less (IDLE), blue = over 60% (ACTIVE), red = over 85% (CRITICAL).
- **Utilization %**: Running jobs ÷ machines in the work centre × 100. It is not based on hours or queued kg.
- **Capacity Health Matrix**: Average load, active centres (with a running job) out of all, and high-load centres.

**Common problems and fixes**
- "No work-center capacity rows" — No work centre exists yet. Set them up in Factory › Work Centers.

**If stuck**
1. Press "Refresh" for fresh figures; the page does not refresh by itself.
2. A work centre with no machines always shows 0%; add machines in Factory › Machines.

Related pages: /dashboard/planner/control-tower/live-production, /dashboard/planner/control-tower/stock-intelligence, /factory/work-centers

**Not done yet / watch out**
- Utilisation is running jobs divided by machines, not hours or queued load, so a work centre with a long queue but nothing running shows 0%.
- Tiles show "WC-" plus the long internal id instead of the work centre code, the tooltip "Role" always reads "Work center", and the page is not in any menu.
- "Back to Control Tower" opens the Material readiness tab, not Command.

### Stock launcher (moved to Control Tower) (/production/planner/stock-launcher)
Screen address: /production/planner/stock-launcher · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANNER, PLANT_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=production-planner-stock-launcher

Old address of the stock launcher. It shows "Opening the stock launcher in the Control Tower..." and forwards to the Control Tower tab "Launch stock", keeping any query in the link.

The stock launcher (making product stock without a customer order) now lives at /dashboard/planner/control-tower/stock-launcher. Old links still work through this page.

**Before you start**
- A planning role.

**Step by step**
1. Open the old link; wait for the forward.
2. Launch the stock run in the Control Tower "Launch stock" tab.

**What is on the screen**
- **Redirect target**: /dashboard/planner/control-tower/stock-launcher with the same query string.

**Common problems and fixes**
- "Spinner does not move on" — Browser scripts were blocked or the session expired. Reload or sign in again.

**If stuck**
1. Open /dashboard/planner/control-tower/stock-launcher directly.

Related pages: /dashboard/planner/control-tower/stock-launcher, /dashboard/planner/control-tower/command

### Production Planning Board (/production/planning)
Screen address: /production/planning · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANNER, PLANT_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=production-planning

An older job board that lists production jobs by state (Planned, Released, In Progress, Completed) with Release, Split, Hold, Resume and priority actions.

Use it to look at jobs regardless of work centre, split a planned job or change its priority number. Normal release of order lines is done in the Control Tower plan queue; machine release is done on the WC terminal.

**Before you start**
- Jobs created by the planner release.

**Step by step**
1. Pick a tab: "Planned", "Released", "In Progress" (running and paused) or "Completed".
2. On a planned job press "Release" to release it.
3. To split, press the split icon, enter "New Job Quantity (Split Off)" and press "Confirm Split". The rest stays on the original job.
4. Press the "#priority" button, enter "Numeric Priority (Lower is Higher)" and "Save Priority".
5. On a released job "Hold" flags it on hold; on a paused job "Resume" restarts it.
6. Use "Previous" / "Next" to page and "Refresh" to reload.

**What is on the screen**
- **Job ID**: Job number with "SO:" order number below.
- **Product / Template**: Product name and customer.
- **Priority**: A number; lower runs first.
- **State**: Planned, Released, Running, Paused, Completed or Waiting.

**Common problems and fixes**
- "Can only release PLANNED or WAITING jobs. Current state: …" — The job already moved on. Refresh the board.
- "The job source changed. Refresh the plan before releasing it." — The planner changed the line; refresh and check again.
- "Split quantity must be less than current job quantity. / Only PLANNED jobs can be split." — Enter less than the job quantity, and split only planned jobs.
- "Emergency reason is required for EMERGENCY jobwork." — "Detour to Job Work" here sends no reason, so the server refuses it. Send job work from Inventory › Job work instead.
- "Can only resume PAUSED jobs." — The job is not paused. Refresh.

**If stuck**
1. Press "Refresh" or "Retry" after "Could not load production jobs.".
2. For release with stock and route checks use the plan queue in the Control Tower.

Related pages: /dashboard/planner/control-tower/plan-queue, /production/work-center, /inventory/job-work, /dashboard/planner

**Not done yet / watch out**
- The "Cancel Job" menu item has no action; it does nothing when pressed.
- "Detour to Job Work" sends no reason, so the server always refuses it with "Emergency reason is required for EMERGENCY jobwork."
- Tab badges count only the jobs loaded for the open tab and page; other tabs show 0 until opened.
- "Hold" flips a hold flag without asking a reason; the job stays under Released and the button still reads "Hold", so there is no visible unhold.

## हर स्क्रीन (हिंदी)

### Planner Command Center (/dashboard/planner)
स्क्रीन का पता: /dashboard/planner · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANNER, PLANT_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=dashboard-planner&lang=hi

Planner का पहला पेज: queue की हालत, release की तैयारी, stock pool, work center का load, demand और हाल की planner गतिविधि एक स्क्रीन पर।

दिन की शुरुआत में दबाव देखने के लिए खोलें: overdue और आज due line, blocked row और coverage। फिर काम करने के लिए Control Tower जाएँ। यह पेज सिर्फ़ आँकड़े और link दिखाता है; release, artwork और stock के फ़ैसले Control Tower और Stock launcher में होते हैं।

**शुरू करने से पहले**
- confirm हुए sales order और LIVE template।

**स्टेप बाय स्टेप**
1. ऊपर के tile पढ़ें: "Planning queue", "Ready / released", "Blocked rows", "Required demand", "Allocatable stock" और "Coverage", साथ में "Overdue" और "Due today"।
2. "Immediate actions" पढ़ें (अभी planner का ध्यान किस पर चाहिए)।
3. capacity के दबाव के लिए "Work center load" और आने वाली demand के लिए "Demand" (Order, Customer, Template, Pending, Due) देखें।
4. "Source path" (Final Roll Pool, Invariant Pool, Upstream Pool) और "Costing coverage" (Actual, Hybrid, Estimated) देखें।
5. "Quick actions" में "Open" (Planner control tower), "Launch" (Stock launcher) या "Configure" (Product Master) दबाएँ।
6. ताज़ा आँकड़ों के लिए "Refresh" दबाएँ।

**स्क्रीन पर क्या है**
- **Planning queue**: planner के काम के इंतज़ार में row।
- **Ready / released**: जो row release के लिए तैयार हैं।
- **Blocked rows**: blocker या hold वाली row।
- **Required demand**: जो वज़न अभी पूरा करना है, kg में।
- **Allocatable stock**: stock जो planner अभी इस्तेमाल कर सकता है।
- **Release readiness**: queue की हालत: ready, queued, blocked।
- **Recent planner activity**: हाल में release और plan हुए job।

**आम दिक्कतें और हल**
- "Planner analytics feed is unavailable. This panel is paused instead of showing fallback zeros." — planner dashboard feed fail हुई। "Refresh" दबाएँ; Control Tower फिर भी चल सकता है।
- "Planner data feed unavailable" — अगले सफल sync तक KPI और action card रुके हैं।

**अटक गए तो**
1. release के बाद आँकड़े न बदलें तो "Refresh" दबाएँ या Plan Queue खोलें, जो live queue पढ़ता है।

जुड़े पेज: /dashboard/planner/control-tower/command, /dashboard/planner/control-tower/plan-queue, /production/planner/stock-launcher, /master/products

### Planner Control Tower (रीडायरेक्ट) (/dashboard/planner/control-tower)
स्क्रीन का पता: /dashboard/planner/control-tower · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANNER, PLANT_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=dashboard-planner-control-tower&lang=hi

Control Tower को पहले tab, Command, पर खोलता है।

Control Tower planner का काम करने की जगह है। Control Tower में सात tab हैं; किसी field में type न कर रहे हों तो 1–7 key से tab बदलें: 1 Command, 2 Plan Queue, 3 Live Production, 4 Completed Trace, 5 Material readiness, 6 Combine Orders, 7 Launch Stock।

**शुरू करने से पहले**
- Planner, Plant Manager, Owner या Admin role।

**स्टेप बाय स्टेप**
1. sidebar या Plan workspace से "Planner Control Tower" खोलें।
2. Command खुलता है। tab बदलने के लिए workspace bar या 1–7 key इस्तेमाल करें।

**स्क्रीन पर क्या है**
- **1–7 key**: tab 1 से 7 पर जाएँ। input में type करते समय काम नहीं करते।

**आम दिक्कतें और हल**
- "Number key से tab अचानक बदल गया" — cursor किसी field में न हो तो 1–7 tab shortcut हैं। नंबर लिखने से पहले search box में click करें।

**अटक गए तो**
1. जो tab सबसे ज़्यादा इस्तेमाल करते हैं, जैसे Plan Queue, उसे bookmark करें।

जुड़े पेज: /dashboard/planner/control-tower/command, /dashboard/planner/control-tower/plan-queue

**अभी नहीं होता / ध्यान दें**
- cursor field के बाहर हो तो 1–7 key tab बदल देती हैं, गलती से नंबर दबाने पर tab बदल सकता है।

### Command (/dashboard/planner/control-tower/command)
स्क्रीन का पता: /dashboard/planner/control-tower/command · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANNER, PLANT_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=dashboard-planner-control-tower-command&lang=hi

Control Tower का tab 1: अभी किस पर काम करना है, queue, stock pool, WCM handoff, blocker और demand के हिसाब से।

अगला कदम तय करने के लिए खोलें। यह planner dashboard और order queue पढ़कर सबसे जोखिम वाले 5 order, stock pool, demand, job की हालत, work center load, alert, output और हाल की हलचल दिखाता है। हर card उस tab पर ले जाता है जहाँ काम होता है (Plan Queue, Material readiness, Live Production, Stock launcher)।

**शुरू करने से पहले**
- planner queue में confirm हुई sales order line।

**स्टेप बाय स्टेप**
1. "Command metrics" और "Order queues" की feed status देखें; कोई fail हो तो "Refresh" दबाएँ।
2. "Top 5 at-risk orders" पढ़ें: due label (overdue, due today, due in N days) और चार gate Math, Artwork, Material, Route। काम के लिए "Open Plan Queue →" दबाएँ।
3. "Source Mix" (stock pool, Coverage, Allocatable बनाम Required) और "Release readiness" (Ready, Queued, Blocked, Artwork) पढ़ें। "New stock order" या "Drill" (Material readiness) दबाएँ।
4. "Top pending sales demand", "State distribution" और "Where released jobs are waiting" देखें।
5. "Action desk" पढ़ें: Today's blockers, Next releases, WCM handoff और Live alerts।
6. "Production rhythm" (Days tracked, Peak day, Avg/day) और "Latest job movement" देखें; floor के लिए "Live production →" दबाएँ।

**स्क्रीन पर क्या है**
- **Gates Math / Artwork / Material / Route**: हर line की release जाँच। release से पहले चारों पास होने चाहिए।
- **Coverage**: ज़रूरी kg के मुकाबले उपलब्ध stock।
- **Where released jobs are waiting**: हर work center पर pending और चल रहे job।
- **Total queued / Total jobs / Live handoff**: planning queue, कुल job, और WCM को दिए चालू job।

**आम दिक्कतें और हल**
- "Queue is clear" — कोई खुली queue row नहीं।
- "No source pools" — कोई FG, WIP, invariant, POD या packaging pool नहीं मिला; card उसकी जगह release readiness दिखाता है।
- "status line में feed fail" — दोनों में से एक read समय पर नहीं आई। "Refresh" दबाएँ; कुछ खोया नहीं।

**अटक गए तो**
1. दोनों feed load होने पर ही card दिखते हैं; पेज खाली रहे तो "Refresh" दबाएँ।

जुड़े पेज: /dashboard/planner/control-tower/plan-queue, /dashboard/planner/control-tower/stock-intelligence, /dashboard/planner/control-tower/live-production, /dashboard/planner/control-tower/completed-trace, /production/planner/stock-launcher

### Completed Trace (/dashboard/planner/control-tower/completed-trace)
स्क्रीन का पता: /dashboard/planner/control-tower/completed-trace · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANNER, PLANT_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=dashboard-planner-control-tower-completed-trace&lang=hi

बंद line का cycle time, समय पर delivery, throughput, और हर order का खुलने वाला route trace और BOM।

Tab 4। जो पूरा हुआ उसकी समीक्षा के लिए खोलें: line ने कितना समय लिया, कौन देर से, कौन stock claim, short-close या WCM posting से बंद हुई, और trace में कहाँ कमी है। समीक्षा के लिए CSV export करें।

**शुरू करने से पहले**
- completion, stock claim या short-close से बंद हुई line।

**स्टेप बाय स्टेप**
1. समय चुनें: Today, 7 days, 30 days या 90 days (default 90)।
2. KPI पढ़ें: "Closed lines", "Demand closed", "On-time", "Cycle time", "Stock claims", "Short close", "Trace gaps"।
3. audit state (All audit, WCM posted, Stock claim, Short close, Trace gap), source path या customer से filter करें; order, customer, product, size या layer से search करें।
4. order खोलकर Customer, Placed, Closed, Delivery, Status, Spec hash और हर step का Planned / Posted / Open देखें।
5. chart देखें: "Orders closed per day", "By KG shipped", "By order count"।
6. छँटी सूची download करने के लिए "Export CSV" दबाएँ।

**स्क्रीन पर क्या है**
- **On-time**: due date तक पहुँची बंद line का हिस्सा (On time बनाम Late)।
- **Cycle time**: order से बंद होने तक के दिन।
- **Stock claims**: fresh run की जगह stock या packing claim से बंद line।
- **Trace gaps**: बंद line जिनकी route posting अधूरी है; WCM के साथ जाँचें।
- **Spec hash**: line की spec की पहचान, stock मिलाने में काम आती है।

**आम दिक्कतें और हल**
- "No closed orders" — चुने समय में कुछ बंद नहीं हुआ। बड़ा समय चुनें।

**अटक गए तो**
1. कोई line न दिखे तो 90 दिन चुनें और filter हटाएँ।

जुड़े पेज: /dashboard/planner/control-tower/live-production, /sales/orders, /logistics/dispatch

**अभी नहीं होता / ध्यान दें**
- Export CSV सिर्फ़ छँटा हुआ समय download करता है, पूरा इतिहास नहीं।

### Combine Orders (/dashboard/planner/control-tower/gang-builder)
स्क्रीन का पता: /dashboard/planner/control-tower/gang-builder · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANNER, PLANT_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=dashboard-planner-control-tower-gang-builder&lang=hi

कई order को एक jumbo roll पर जोड़ें। सिर्फ़ एक ही Product Master के, एक ही live route step पर खड़े order जुड़ सकते हैं।

Tab 6। setup और trim बचाने के लिए: release हुए roll-output job जिनका Product Master, film recipe, step और target width एक है, एक group में आते हैं। 2 या ज़्यादा tick करें और Combine दबाएँ; फिर WC terminal पर roll picker हर चुने job के लिए एक slit child बनाता है। यह पेज सिर्फ़ plan करता है; slitting WC terminal पर होती है।

**शुरू करने से पहले**
- एक ही Product Master, recipe और step के कम से कम दो release हुए roll-output job, हर एक की target roll width के साथ।

**स्टेप बाय स्टेप**
1. tile पढ़ें: "PM step groups", "Jumbo-ready orders", "Ready film", "Need setup"। step ("All steps") से filter या search करें।
2. बाईं ओर recipe group चुनें ("Jumbo-ready groups")।
3. 2 या ज़्यादा order tick करें। "Slit layout preview" देखें (हर order एक slit, हर cut पर 5 mm trim)।
4. "Combine" दबाएँ। toast में जुड़े order की गिनती और batch id दिखती है।
5. फिर से शुरू करने के लिए "Clear ticks"। WC manager work-centre terminal पर slit करता है।

**स्क्रीन पर क्या है**
- **Same PM**: Product Master, film stack, step और process एक जैसे हों।
- **Roll output**: सिर्फ़ target width वाले roll-output job jumbo batch में आते हैं।
- **WCM slit**: machine roll picker हर चुने job के लिए एक slit child बनाता है।
- **generic stock / no roll width set**: row tag: stock (customer नहीं) job, या width के बिना job, जो combine रोकता है।

**आम दिक्कतें और हल**
- "Select at least 2 jobs to commit a gang." — दो या ज़्यादा order tick करें।
- "Selected jobs must use the same Product Master before they can share one jumbo." — सिर्फ़ एक group से order चुनें।
- "Selected jobs must be at the same route step and process before they can share one jumbo." — कोई job आगे बढ़ गया; refresh करके फिर चुनें।
- "Selected jobs need target roll width before they can share one jumbo." — order line पर width भरें, या उस job को छोड़ दें।
- "Some selected jobs are not open or do not exist." — इस बीच कोई job शुरू या बंद हो गया। "Refresh" दबाएँ।

**अटक गए तो**
1. कोई group नहीं ("No combinable route groups yet"): job release हों और PM, recipe, step, width एक हों।

जुड़े पेज: /production/planner/gang-builder, /production/work-center, /dashboard/planner/control-tower/plan-queue

**अभी नहीं होता / ध्यान दें**
- Combine सिर्फ़ jumbo plan करता है; slitting WC terminal पर होती है, और इस पेज से combine वापस नहीं होता।

### Live Production (/dashboard/planner/control-tower/live-production)
स्क्रीन का पता: /dashboard/planner/control-tower/live-production · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANNER, PLANT_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=dashboard-planner-control-tower-live-production&lang=hi

release हुई line, WCM handoff, चल रहे job, partial replan और floor पर चल रहे हर काम का route के हिसाब से trace।

Tab 3। release के बाद line को work center में आगे बढ़ते देखने के लिए खोलें: कौन-सी machine क्या और कब से चला रही है, क्या इंतज़ार में है, क्या रुका है और किसे replan चाहिए। order से उसका passport खोल सकते हैं, print color बदल सकते हैं, short-close या cancel कर सकते हैं।

**शुरू करने से पहले**
- Plan Queue से release हुई line।

**स्टेप बाय स्टेप**
1. KPI पढ़ें: "Posted on live lines", "Open on live lines", "Lines by state" (Running, Released, Waiting, Replan), "Needs attention", "Machines busy", "Paused", "Next job released"।
2. "Machines now" (हर machine का चालू job और कब से; हर 30 s ताज़ा) और "Today on the machines" (हर job start से close तक; बगल में scroll करें) देखें।
3. All live, Running, Released, Waiting / paused, Replan या Blockers से, और "Route path" से filter करें; order, customer, product या route से search करें।
4. order card खोलकर "Order passport" और job card (RUNNING, REPLAN, RELEASED, WCM HANDOFF, WAITING) देखें।
5. release के बाद ink के नाम बदलने के लिए "Revise colors" दबाएँ, NEW color और कारण भरें, पक्का करें।
6. कम से कम 5 अक्षर के कारण के साथ "Short close" या "Cancel line" इस्तेमाल करें; पहले Cancel rule और Short-close rule pill पढ़ें।
7. "Release blockers" और "Output rhythm" (30 दिन का posted kg) देखें।

**स्क्रीन पर क्या है**
- **Machines now**: job board से; हर machine का चालू job और कितनी देर से।
- **Replan**: आख़िरी step ने target से कम बनाया; जो बना वह dispatch हो सकता है, बाकी re-release या short-close के लिए queue में।
- **Cancel rule**: machine, material या scrap गतिविधि होने तक cancel हो सकता है; उसके बाद server मना करता है।
- **Short-close rule**: post हुआ उत्पादन रहता है, सिर्फ़ बची मात्रा बंद होती है।
- **WCM machine close**: WCM का close असली output, scrap और variance दर्ज करता है। planner short-close उसके बाद sales line के बचे हिस्से के लिए है।

**आम दिक्कतें और हल**
- "Print colors can be revised only after Planner release and before completion." — line अभी release नहीं हुई या पूरी हो चुकी है।
- "Only Planner or an authorised administrator can revise released print colors." — planner से करवाएँ।
- "Cancel is locked because this line is already closed." — बंद line दोबारा cancel या short-close नहीं होती। उनका बना माल Dispatch Bay में (भेजें या stock में डालें) संभालें।
- "Stock order cancel from Control Hub is not enabled here. Use the stock order lifecycle action." — यहाँ short close और cancel सिर्फ़ sales line के लिए हैं।

**अटक गए तो**
1. job अटका लगे तो उस work center का WC terminal खोलें; वहाँ Stalled tab में दिखता है।
2. machine पट्टी पुरानी लगे तो "Refresh" दबाएँ।

जुड़े पेज: /production/work-center, /production/machine-selector, /dashboard/planner/control-tower/plan-queue, /dashboard/planner/control-tower/completed-trace, /logistics/packing

**अभी नहीं होता / ध्यान दें**
- यहाँ short close और cancel सिर्फ़ sales line के लिए हैं; stock order का अपना lifecycle action है।

### Plan queue (/dashboard/planner/control-tower/plan-queue)
स्क्रीन का पता: /dashboard/planner/control-tower/plan-queue · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANNER, PLANT_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=dashboard-planner-control-tower-plan-queue&lang=hi

जो तैयार है उसे release करें, जो रुका है उसे साफ़ करें। हर sales order line की एक row; पूरी spec, sourcing और release के लिए row चुनें।

Control Tower का tab 2 और planner की मुख्य मेज़। confirm हुई order line यहाँ आती हैं। हर line के चार gate (Spec, Material, Artwork, Route) जाँचें, ज़रूरत हो तो artwork लगाएँ, source चुनें (finished stock, WIP, invariant या input stock, या fresh run), planner वाले step के लिए work center चुनें और "Plan & Release" दबाएँ। release हुए job WC terminal पर जाते हैं। यहाँ line को short-close या cancel भी कर सकते हैं।

**शुरू करने से पहले**
- sales order confirm हो (draft नहीं दिखते)।
- product master line जिसका LIVE template, route और production-ready recipe/BOM हो।
- print वाली line के लिए: उस master, size और print type का APPROVED artwork।

**स्टेप बाय स्टेप**
1. KPI tile या chip से queue छाँटें: "Ready to release", "Blocked", "Artwork pending", "Overdue"; chip All, Ready, Blocked, Artwork, Overdue, Aged 30d+, New ≤3d। order, customer, product या template से search करें; filter dock के लिए "Filters" दबाएँ।
2. Newest, Due first या Largest से sort करें, फिर row पर click करें। detail queue के बगल में खुलती है।
3. row पढ़ें: job name (JOB), product, kg और pcs में demand, gate S M A R, route step (dashed step पहले से WIP या stock से पूरे), state badge और due date।
4. "Artwork required" दिखे तो "Assign artwork" दबाएँ, design code या नाम से खोजें, approved artwork चुनें और पक्का करें।
5. "Release checklist" (Math validates, Material plan, Route span) और "Blockers" सूची देखें।
6. "Plan & Release" दबाएँ (FG या WIP मिलने पर "Choose source & release")। dialog में source चुनें: FG match, Carry WIP, Invariant stock, Input stock या Fresh run; "KG to allocate" भरें या MAX दबाएँ।
7. "Route dispatch" में planner वाले हर step का work center चुनें। "Optional route steps" में step तभी छोड़ें जब यह run उसे छोड़नी हो।
8. line को अभी WCM को देने के लिए "Release immediately after planning" ticked रखें (बटन "Plan & Release"), या untick करके "Plan only"। बटन दबाएँ और "Order planned & released" का इंतज़ार करें।
9. line रोकने के लिए: "Short close" (बना हुआ माल रहता है, बाकी बंद) या "Cancel line" (सिर्फ़ machine गतिविधि से पहले) दबाएँ, कम से कम 5 अक्षर का कारण लिखें और पक्का करें।

**स्क्रीन पर क्या है**
- **Ready to release**: जिन line का math सही, artwork लगा और कोई blocker नहीं। click करके filter करें।
- **Blocked**: Recipe / spec, Artwork only, Replan और Stock check में बँटा।
- **Queue weight**: दिख रही line का ज़रूरी kg।
- **Gate S (Spec)**: spec और मात्रा का हिसाब। लाल: "Spec or quantity math is invalid" — sales order या product master पर line ठीक करें।
- **Gate M (Material)**: लाल सिर्फ़ तब जब recipe/BOM production-ready नहीं। stock lookup fail या material plan में line न हों तो पीला।
- **Gate A (Artwork)**: approved artwork लगने तक पीला "Artwork pending"; बिना print की line में skip।
- **Gate R (Route)**: start step से last step तक route; balance replan या अनसुलझे span पर पीला।
- **State badge**: Ready to release (FG match / WIP continue / Fresh run), Artwork pending, Blocked · recipe, Planning required, Replan, Check stock या Row error, कारण के साथ।
- **Stock web (What is to be made)**: line किस web पर चलेगी, जैसे "Open web · 655 mm roll · slit allowed"। planned web के ±20 mm वाले roll सीधे इस्तेमाल होते हैं।
- **Release immediately after planning**: tick: plan और release एक साथ। untick: सिर्फ़ plan, release बाद में।
- **Revise colors only**: release के बाद और पूरा होने से पहले, कारण के साथ print color के नाम बदलें; artwork, route और color की गिनती लॉक रहती है।

**आम दिक्कतें और हल**
- "Artwork assignment is required before release for printing-enabled order." — पहले "Assign artwork" दबाएँ।
- "Artwork must be APPROVED before assignment." — engineering से Artworks पेज पर artwork approve करवाएँ।
- "Release is blocked until every planner-decided route step has a work center." — "Route dispatch" में हर step का work center चुनें।
- "Allocate at least one candidate to proceed" — stock source चुना पर kg नहीं भरा। kg भरें या Fresh run चुनें।
- "Plan saved; release pending" — plan save हुआ पर release fail। "Retry release" दबाएँ; दोबारा plan न करें।
- "Plan not confirmed" — पुष्टि से पहले connection टूटा। वही plan वापस पाने के लिए "Confirm saved plan" दबाएँ।
- "Saved; queue refresh pending" — order save हुआ पर queue reload नहीं हुई। "Retry saved queue" या "Refresh" दबाएँ। दोबारा submit न करें।
- "Line has machine activity. Use short-close for the remaining quantity." — cancel सिर्फ़ machine गतिविधि से पहले। "Short close" इस्तेमाल करें।
- "Reason required" — short close और cancel के लिए audit के लिए कम से कम 5 अक्षर का कारण चाहिए।
- "Line must be PLANNED before release. Current: …" — line बदल गई (पहले से release या बंद)। "Refresh" दबाएँ और हालत देखें।

**अटक गए तो**
1. "An earlier plan needs confirmation" दिखे तो Resume दबाएँ; यह saved नतीजा जाँचकर release पूरा करता है।
2. "Could not load the current line detail. Actions are paused." दिखे तो "Retry detail" दबाएँ।
3. Material gate लाल: product master पर recipe/BOM ठीक करें, फिर refresh।
4. line नहीं दिख रही: देखें order confirm है, draft नहीं, और filter हटाएँ (chip "All")।

जुड़े पेज: /sales/orders, /engineering/artworks, /master/products, /production/work-center, /dashboard/planner/control-tower/live-production, /dashboard/planner/control-tower/stock-intelligence

### Material readiness (/dashboard/planner/control-tower/stock-intelligence)
स्क्रीन का पता: /dashboard/planner/control-tower/stock-intelligence · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANNER, PLANT_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=dashboard-planner-control-tower-stock-intelligence&lang=hi

कौन-सी demand कम पड़ रही है, कितनी, और अगला एक काम: हर template का stock बनाम demand, packaging और POD का in-house काम, पुराना stock।

Tab 5। stock बनाना है या नहीं, यह तय करते समय खोलें। template पर SHORT, TIGHT, COVERED, OVERSTOCK या STOCK READY लिखा होता है। कम वाले template के लिए यहीं से stock order launch करें ("Build & release") या Plan Queue जाएँ ("Plan")।

**शुरू करने से पहले**
- demand या stock वाले LIVE template।

**स्टेप बाय स्टेप**
1. KPI पढ़ें: "Templates short", "Tight", "Coverage", "Templates by cover", "FG ready to ship", "In-house packing & POD"।
2. "Critical · build now" में हर template का कम kg देखें; Quick stock launcher खोलने के लिए "Build & release" दबाएँ।
3. Quick stock launcher में "Quantity to build" (KG) भरें। पहला job तुरंत release करने के लिए "Send straight to production" ticked रखें, फिर submit करें।
4. "Order specs that need stock decisions" और "Demand vs Stock" (हर template का Stock, Demand, Deficit या Surplus) देखें; template से search करें।
5. funnel Demand → Plannable → Releaseable → Released → Completed देखें।
6. in-house stock के लिए "Packaging in-house" ("New packaging", "Launch one") और "POD bulk stock" ("New POD") इस्तेमाल करें।
7. "Stock without matching demand" और "Jobs stalled ≥ 3 days" देखें।

**स्क्रीन पर क्या है**
- **SHORT / TIGHT / COVERED / OVERSTOCK / STOCK READY**: template की हालत: खुली demand के मुकाबले stock।
- **LINK MASTER**: जब row का product master link न हो; quick launch के लिए पूरा template, geometry और layer snapshot चाहिए।
- **Send straight to production**: stock launcher order release gate नहीं देखते: पहला job तुरंत release होता है और artwork gate नहीं होता।
- **Stock without matching demand**: बेकार पड़ा stock जिसे कोई खुला order नहीं ले सकता; sales को बताएँ या plan करें।

**आम दिक्कतें और हल**
- "Stock intelligence is paused" — कोई feed fail हुई। "Retry feeds" दबाएँ।
- "Quick launch needs a full template + geometry + layer snapshot" — इस template का snapshot नहीं है। पूरा Stock Order Launcher इस्तेमाल करें (dialog में link)।
- "Stock order failed" — server ने order मना किया; toast में कारण है (जैसे "Template must be the current LIVE revision for Stock Order creation")।

**अटक गए तो**
1. quick launch न हो सके तो पूरे launcher के लिए "New stock order" दबाएँ।

जुड़े पेज: /production/planner/stock-launcher, /dashboard/planner/control-tower/stock-launcher, /dashboard/planner/control-tower/plan-queue, /master/products

**अभी नहीं होता / ध्यान दें**
- पूरे geometry और layer snapshot के बिना template पर quick launch नहीं चलता; पूरा launcher चाहिए।
- यहाँ से launch हुआ stock release और artwork gate नहीं देखता, Plan Queue की sales line के उलट।

### Launch stock from any Product Master (/dashboard/planner/control-tower/stock-launcher)
स्क्रीन का पता: /dashboard/planner/control-tower/stock-launcher · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANNER, PLANT_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=dashboard-planner-control-tower-stock-launcher&lang=hi

product master पर in-house stock order (stock के लिए बनाना) बनाएँ: finished stock, WIP pool, packaging या POD bulk, sales order जैसे ही spec नियमों के साथ।

Tab 7। जब Material readiness कमी दिखाए या जल्दी वाले order के लिए stock तैयार रखना हो। यह order customer order जैसे ही route, floor और packing से गुज़रता है। हाथ से launch करने पर production order सीधे बनता और release होता है, artwork gate नहीं। बाद में उसी spec वाली sales line Plan Queue से यह stock ले सकती है।

**शुरू करने से पहले**
- LIVE template और route वाला active product master।
- master पर size और layer विकल्प; packaging या POD के लिए जुड़ा catalog SKU।

**स्टेप बाय स्टेप**
1. "What to build": All, Pouch, Roll, Packaging या POD से filter करें, code या नाम से खोजें और एक product master चुनें।
2. "Commitment": Generic pool (कोई भी order ले सकता है), Customer, Artwork या Customer + art चुनें और lock भरें।
3. "Build up to": route कहाँ रुके वहाँ tap करें — Finished stock या WIP pool।
4. "Spec / axes": size और हर layer के विकल्प चुनें; Width match और Stock form देखें।
5. "Quantity": Target qty और UOM भरें (roll के लिए KG)।
6. "Validate pool" दबाएँ और "Launch blockers" की हर चीज़ ठीक करें।
7. launch बटन दबाएँ ("Create stock order -> production", "Create WIP pool -> production", "Create packaging order -> production" या "Create POD bulk stock")। "Stock order created" का इंतज़ार करें।

**स्क्रीन पर क्या है**
- **Commitment**: दोबारा इस्तेमाल तय करता है: Generic pool, Customer (एक खरीदार के लिए), Artwork (एक artwork के लिए छपा), Customer + art (सिर्फ़ exact match)।
- **Build up to**: route कहाँ रुके। पूरा route = finished stock; पहले रुकना = WIP roll pool।
- **Interim WIP roll width**: रुके WIP roll की width। ज़रूरी width बराबर या कम हो और size slitting allow करे तो sales demand इससे आगे बढ़ सकती है।
- **Matching demand**: खुली sales line जो इस pool से ले सकती हैं: Eligible orders, Exact width, Slit allowed, Wrong lock।
- **Launch blockers**: जाँच: Product master, Template & route stop, Commitment safety, Axes complete, Stock math + BOM। सब पास होने तक बटन बंद।
- **Catalog SKU link**: packaging या POD master के लिए: store और packing को कौन-सा SKU मिलेगा।

**आम दिक्कतें और हल**
- "Template must be the current LIVE revision for Stock Order creation" — Engineering में template LIVE करें, फिर कोशिश करें।
- "Template has no routing rule" — पहले template पर route जोड़ें।
- "Roll stock orders require quantity_uom=KG" — roll stock के लिए KG चुनें।
- "committed_customer is required for customer-committed stock" — Customer lock में customer चुनें, या Generic pool लें।
- "committed_artwork is required for artwork-committed stock" — artwork lock चुनें।
- "Printing enabled but no inks resolved from artwork." — चुने artwork में ink नहीं; artwork ठीक करें या दूसरा चुनें।

**अटक गए तो**
1. launch बटन grey रहे तो "Launch blockers" पढ़ें और हर सुधार के बाद फिर "Validate pool" दबाएँ।

जुड़े पेज: /production/planner/stock-launcher, /dashboard/planner/control-tower/stock-intelligence, /dashboard/planner/control-tower/plan-queue, /master/products

**अभी नहीं होता / ध्यान दें**
- stock launcher में quotation का रास्ता नहीं; उसी spec का भाव Quotations पेज पर बनाना होता है।
- validation में matching demand की गिनती "not computed" दिख सकती है; order फिर भी बनता है।

### Production (Planner Control Tower खुलता है) (/production)
स्क्रीन का पता: /production · भूमिकाएँ: ADMIN, OWNER, PLANNER, WORK_CENTER_MANAGER, PLANT_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=production&lang=hi

इस पते की अपनी कोई स्क्रीन नहीं है। यह आपको सीधे Planner Control Tower के "Command" टैब पर ले जाता है।

पुराने लिंक, बुकमार्क और Floor workspace का "Jobs" टैब अभी भी /production पर जाते हैं। प्लानिंग का काम अब Control Tower में होता है (Command, Plan queue, Live production, Completed trace, Material readiness, Combine orders, Launch stock), इसलिए यह पता वहीं भेज देता है।

**शुरू करने से पहले**
- ऐसा रोल जो Control Tower खोल सकता है (Planner, Plant manager, Admin, Owner)।

**स्टेप बाय स्टेप**
1. /production खोलें या Floor workspace में "Jobs" टैब दबाएँ।
2. पेज तुरंत /dashboard/planner/control-tower/command पर चला जाता है।
3. किसी एक job को देखने के लिए उसे plan queue, Live production या Completed trace से खोलें; उसका सार /production/jobs/<id> पर खुलता है।
4. फ्लोर के काम के लिए "WC terminal" (/production/work-center) या "Machine terminal" (/production/machine-selector) खोलें।

**स्क्रीन पर क्या है**
- **कहाँ जाता है**: हमेशा /dashboard/planner/control-tower/command। रास्ते में कुछ सेव या बदला नहीं जाता।

**आम दिक्कतें और हल**
- "ऐसा पेज खुलता है जो आपके काम का नहीं" — Control Tower प्लानिंग रोल के लिए है। Work-centre manager WC terminal खोलें; operator को machine terminal पर ही रखा जाता है।

**अटक गए तो**
1. अगर पेज घूमता रहे या खाली दिखे, तो सीधे /dashboard/planner/control-tower/command खोलें।
2. पुराने बुकमार्क को उस Control Tower टैब पर बदल दें जो आप सच में इस्तेमाल करते हैं।

जुड़े पेज: /dashboard/planner/control-tower/command, /dashboard/planner/control-tower/plan-queue, /production/work-center, /production/machine-selector

**अभी नहीं होता / ध्यान दें**
- Floor workspace का "Jobs" टैब /production पर जाता है, जो केवल Control Tower Command पर भेजता है, इसलिए वहाँ jobs की कोई सूची नहीं है।

### Planner (Control Tower खुलता है) (/production/planner)
स्क्रीन का पता: /production/planner · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANNER, PLANT_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=production-planner&lang=hi

पुराना planner पता। यह Planner Control Tower के "Command" टैब पर भेज देता है।

Planner अब Control Tower में है। लाइन रिलीज़ करना, स्टॉक claim करना, orders जोड़ना और स्टॉक लॉन्च करना सब वहीं होता है।

**शुरू करने से पहले**
- प्लानिंग रोल (Planner, Plant manager, Admin, Owner)।

**स्टेप बाय स्टेप**
1. /production/planner खोलें; यह /dashboard/planner/control-tower/command पर जाता है।
2. लाइन को route पर रिलीज़ करने के लिए "Plan queue" खोलें।
3. उन कामों के लिए "Combine orders" या "Launch stock" खोलें।

**स्क्रीन पर क्या है**
- **कहाँ जाता है**: /dashboard/planner/control-tower/command।

**आम दिक्कतें और हल**
- "रीडायरेक्ट के बाद खाली पेज" — आपका रोल Control Tower नहीं खोल सकता। Admin से प्लानिंग रोल माँगें।

**अटक गए तो**
1. Plan workspace से सीधे Control Tower खोलें और बुकमार्क बदलें।

जुड़े पेज: /dashboard/planner/control-tower/command, /dashboard/planner/control-tower/plan-queue, /dashboard/planner

### Combine orders (orders जोड़ें) (/production/planner/gang-builder)
स्क्रीन का पता: /production/planner/gang-builder · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANNER, PLANT_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=production-planner-gang-builder&lang=hi

एक ही Product Master के, एक ही roll-output step पर खड़े दो या ज़्यादा orders को जोड़ें, ताकि वे एक jumbo roll पर चलें और machine पर slit होकर अलग हों।

जब एक ही film recipe के कई छोटे orders printing, lamination या slitting पर इंतज़ार कर रहे हों तब खोलें। यही स्क्रीन Control Tower का "Combine orders" टैब है। जोड़ने के बाद WC terminal का roll picker हर order के लिए एक slit child बनाता है।

**शुरू करने से पहले**
- jobs रिलीज़ और खुले हों (PLANNED, WAITING, RELEASED या QUEUED) और step roll बनाता हो।
- हर job की target roll width और Product Master हो।

**स्टेप बाय स्टेप**
1. खोज ("Search order, customer, Product Master, job, step..."), "All" / "Combinable" / "Needs setup" और step सूची से groups छाँटें।
2. "Jumbo-ready groups" में group चुनें। हरा "N orders · combinable" बैज मतलब जोड़ सकते हैं।
3. "Pick orders to combine" में 2 या ज़्यादा orders टिक करें।
4. "Slit layout preview" देखें: हर order का एक ब्लॉक, jumbo की चौड़ाई (चौड़ाइयों का जोड़ + हर कट पर 5 mm) और kg।
5. "Combine N orders" दबाएँ। संदेश में batch id आता है: "they'll slit together at the machine"।
6. WCM को बताएँ; slit WC terminal पर होते हैं। "Clear ticks" से चुनाव हटता है।

**स्क्रीन पर क्या है**
- **PM step groups / Jumbo-ready orders / Ready film / Need setup**: Product Master + step groups की संख्या, जोड़ने लायक groups के orders, उनका kg, और setup में अटके groups।
- **Group line**: Product Master, step का नाम और नंबर, output form, चौड़ाइयाँ, target kg और पहला रोकने वाला कारण।
- **#abc123**: Recipe की पहचान (अंदरूनी) — एक ही नंबर मतलब एक ही film stack।
- **Order row**: SO नंबर, customer, "generic stock" बैज, चौड़ाई (न हो तो "no roll width set"), kg, job और स्थिति।

**आम दिक्कतें और हल**
- "group setup अधूरा" — ये "setup needed" group पर दिखते हैं। order line पर चौड़ाई या Product Master ठीक करें, या और orders का इंतज़ार करें।
- "चौड़ाई नहीं" — टिक किए order की चौड़ाई नहीं। उसे हटाएँ या line ठीक करें।
- "step अलग है" — पेज खुलने के बाद jobs अलग steps पर चले गए। "Refresh" दबाएँ।
- "job खुला नहीं" — इस बीच कोई job पूरा या रद्द हुआ। रिफ्रेश करके फिर टिक करें।

**अटक गए तो**
1. "Refresh" दबाएँ; सूची हर 45 सेकंड में भी रीलोड होती है।
2. कोई group न दिखे ("No combinable route groups yet") तो jobs का Product Master, recipe, step या चौड़ाई अलग है।

जुड़े पेज: /dashboard/planner/control-tower/gang-builder, /dashboard/planner/control-tower/plan-queue, /production/work-center

**अभी नहीं होता / ध्यान दें**
- preview में jumbo चौड़ाई हर कट पर तय 5 mm trim मानती है, और 160 देखे गए jobs में से केवल पहले 60 groups लोड होते हैं।

### Factory Heatmap / Capacity (/production/planner/heatmap)
स्क्रीन का पता: /production/planner/heatmap · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANNER, PLANT_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=production-planner-heatmap&lang=hi

हर work centre की एक टाइल, लोड (चल रहे jobs ÷ machines) के हिसाब से रंगी हुई, और सबसे व्यस्त व सबसे खाली work centre के अलर्ट।

और काम रिलीज़ करने से पहले देखें कि machines कहाँ खाली हैं। यह केवल देखने के लिए है; रिलीज़ plan queue से करें।

**शुरू करने से पहले**
- Factory में machines के साथ work centres बने हों।

**स्टेप बाय स्टेप**
1. चार टाइल पढ़ें: "Work centers", "Running now", "At-risk load", "Average load"।
2. "Work Center Matrix" में टाइल पर माउस रखें: machines ("Total Units") और चल रहे jobs ("Active Load")।
3. "System Alerts" पढ़ें: "Critical Contention" 85% से ऊपर वाला work centre बताता है; "Optimal Slot" सबसे खाली।
4. चल रहे jobs के लिए "Open live production" दबाएँ, या "Refresh"।

**स्क्रीन पर क्या है**
- **टाइल का रंग**: सफ़ेद = 60% या कम (IDLE), नीला = 60% से ऊपर (ACTIVE), लाल = 85% से ऊपर (CRITICAL)।
- **Utilization %**: work centre में चल रहे jobs ÷ machines × 100। यह घंटे या कतार के kg पर आधारित नहीं।
- **Capacity Health Matrix**: औसत लोड, active centres (जिनमें job चल रहा) कुल में से, और ज़्यादा लोड वाले centres।

**आम दिक्कतें और हल**
- "No work-center capacity rows" — अभी कोई work centre नहीं। Factory › Work Centers में बनाएँ।

**अटक गए तो**
1. नए आँकड़ों के लिए "Refresh" दबाएँ; पेज खुद रिफ्रेश नहीं होता।
2. बिना machine वाला work centre हमेशा 0% दिखाता है; Factory › Machines में machines जोड़ें।

जुड़े पेज: /dashboard/planner/control-tower/live-production, /dashboard/planner/control-tower/stock-intelligence, /factory/work-centers

**अभी नहीं होता / ध्यान दें**
- Utilisation चल रहे jobs ÷ machines है, घंटे या कतार नहीं, इसलिए लंबी कतार पर भी कुछ न चले तो 0% दिखता है।
- टाइल पर work centre कोड की जगह "WC-" और लंबा अंदरूनी id दिखता है, tooltip का "Role" हमेशा "Work center" होता है, और पेज किसी मेनू में नहीं है।
- "Back to Control Tower" Command नहीं, Material readiness टैब खोलता है।

### Stock launcher (Control Tower में चला गया) (/production/planner/stock-launcher)
स्क्रीन का पता: /production/planner/stock-launcher · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANNER, PLANT_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=production-planner-stock-launcher&lang=hi

stock launcher का पुराना पता। यह "Opening the stock launcher in the Control Tower..." दिखाता है और Control Tower के "Launch stock" टैब पर भेज देता है, लिंक की query साथ रहती है।

stock launcher (बिना customer order के product stock बनाना) अब /dashboard/planner/control-tower/stock-launcher पर है। पुराने लिंक इसी पेज से काम करते हैं।

**शुरू करने से पहले**
- प्लानिंग रोल।

**स्टेप बाय स्टेप**
1. पुराना लिंक खोलें; आगे भेजे जाने का इंतज़ार करें।
2. Control Tower के "Launch stock" टैब में stock run लॉन्च करें।

**स्क्रीन पर क्या है**
- **कहाँ जाता है**: वही query के साथ /dashboard/planner/control-tower/stock-launcher।

**आम दिक्कतें और हल**
- "spinner चलता रहता है" — ब्राउज़र स्क्रिप्ट रुकी या सत्र खत्म हुआ। रीलोड करें या फिर साइन-इन करें।

**अटक गए तो**
1. सीधे /dashboard/planner/control-tower/stock-launcher खोलें।

जुड़े पेज: /dashboard/planner/control-tower/stock-launcher, /dashboard/planner/control-tower/command

### Production Planning Board (/production/planning)
स्क्रीन का पता: /production/planning · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANNER, PLANT_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=production-planning&lang=hi

पुराना job board जो jobs को स्थिति के अनुसार दिखाता है (Planned, Released, In Progress, Completed), साथ में Release, Split, Hold, Resume और priority के काम।

इसे work centre से अलग jobs देखने, planned job को split करने या priority नंबर बदलने के लिए इस्तेमाल करें। order line की सामान्य रिलीज़ Control Tower के plan queue में और machine रिलीज़ WC terminal पर होती है।

**शुरू करने से पहले**
- planner की रिलीज़ से jobs बने हों।

**स्टेप बाय स्टेप**
1. टैब चुनें: "Planned", "Released", "In Progress" (चल रहे और रुके) या "Completed"।
2. planned job पर "Release" दबाएँ।
3. split करने के लिए split आइकन दबाएँ, "New Job Quantity (Split Off)" लिखें और "Confirm Split" दबाएँ। बाकी मूल job पर रहता है।
4. "#priority" बटन दबाएँ, "Numeric Priority (Lower is Higher)" लिखें और "Save Priority" दबाएँ।
5. released job पर "Hold" उसे होल्ड पर रखता है; paused job पर "Resume" फिर चालू करता है।
6. पन्ने बदलने के लिए "Previous" / "Next" और रीलोड के लिए "Refresh"।

**स्क्रीन पर क्या है**
- **Job ID**: job नंबर, नीचे "SO:" order नंबर।
- **Product / Template**: product का नाम और customer।
- **Priority**: एक नंबर; छोटा पहले चलता है।
- **State**: Planned, Released, Running, Paused, Completed या Waiting।

**आम दिक्कतें और हल**
- "केवल PLANNED या WAITING job रिलीज़ होता है" — job आगे बढ़ चुका। board रिफ्रेश करें।
- "job का स्रोत बदला" — planner ने line बदली; रिफ्रेश करके फिर देखें।
- "split नहीं हो सकता" — job की मात्रा से कम लिखें, और केवल planned job split करें।
- "job work के लिए कारण चाहिए" — यहाँ "Detour to Job Work" कोई कारण नहीं भेजता, इसलिए सर्वर मना करता है। job work Inventory › Job work से भेजें।
- "केवल रुका job फिर चलता है" — job रुका नहीं है। रिफ्रेश करें।

**अटक गए तो**
1. "Could not load production jobs." के बाद "Refresh" या "Retry" दबाएँ।
2. स्टॉक और route जाँच के साथ रिलीज़ के लिए Control Tower का plan queue इस्तेमाल करें।

जुड़े पेज: /dashboard/planner/control-tower/plan-queue, /production/work-center, /inventory/job-work, /dashboard/planner

**अभी नहीं होता / ध्यान दें**
- "Cancel Job" मेनू आइटम पर कोई काम नहीं जुड़ा; दबाने पर कुछ नहीं होता।
- "Detour to Job Work" कोई कारण नहीं भेजता, इसलिए सर्वर हमेशा "Emergency reason is required for EMERGENCY jobwork." से मना करता है।
- टैब के बैज केवल खुले टैब और पन्ने के jobs गिनते हैं; बाकी टैब खोलने तक 0 दिखाते हैं।
- "Hold" बिना कारण पूछे hold का निशान बदलता है; job Released में ही रहता है और बटन "Hold" ही दिखाता है, इसलिए unhold दिखाई नहीं देता।
