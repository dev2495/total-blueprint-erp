# Production — machines, jobs, ink

## Overview (English)
# Production module (floor execution)

The Production module is where released order lines are actually made. It covers the **WC terminal** (work-centre manager), the **Machine terminal** (operator), the **Ink Control Desk**, and the read-only **Production job** summary. Planning screens (plan queue, combine orders, launch stock) are in the Planner module.

## Screens and how they connect

- **/production/work-center** — "Choose your machine group". A work-centre manager (WCM) sees only the work centres assigned to them. The last one used is remembered.
- **/production/work-center/[id]** — "Work Center Terminal". The queue of order lines at this work centre, and a job pane to prepare and release each job.
- **/production/machine-selector** — "Choose your machine". The operator's home. An operator sees only the machines assigned to them; with one machine the terminal opens straight away.
- **/production/machine/[machine_id]** — "Machine Terminal". Start, log output, pause, complete.
- **/production/ink-control** — "Ink Control Desk". Issue, return and count ink on the floor; reconcile with artwork theory.
- **/production/jobs/[id]** — read-only job summary with links to the terminals and trace.

## Main flow: from planner release to machine output

1. The planner releases an order line to its route in the Control Tower plan queue. Jobs are created for the route steps.
2. The line appears in the queue of the first work centre, e.g. ABC Foods, SO-2026-0123, printing.
3. The WCM opens the job. The job pane shows: **Order · what it is** (ordered, produced, remaining, the "what is to be made" plate), **Machine**, **Rolls by lane**, **Input issue**, and **Release · readiness**.
4. The WCM taps the machine. A machine already running another order is refused unless it may run several orders (extrusion by default).
5. The WCM assigns rolls with the roll picker: scan or type the roll ID, or pick from the list. A roll within **±20 mm** of the planned web is used as it is; a wider roll is slit; a roll more than 20 mm narrower is refused. Before slitting, a multi-lane line runs its planned parent web (lanes × child width + trim).
6. In Input issue only **rolls and granule grade codes** are entered by hand. Every other material shows "Auto · step mapping" and is issued at its planned quantity. A granule can be split over several grade codes; release waits until every issued kg has a code.
7. When the gates M (machine), R (rolls), I (issue) and C (cylinders/artwork) are clear, the WCM presses **Release to machine**.
8. The operator opens the machine terminal, picks the job in the Queue rail and presses **Start**.
9. The operator logs output: roll rows (gross, core tare, width, length), pieces on pouching, or split child rolls on slitting; plus trim and scrap. Then **Log output**.
10. When the step is done the operator presses **Complete**. If output is short of the target the button reads **Force complete** and a variance reason is needed.
11. The next route step can now run on what was logged. Parallel steps (e.g. extrusion and printing feeding lamination) may run at the same time. Finished pouches go to the Packing Yard; finished rolls go to packing and dispatch.

## Rules and limits

- One order per machine at a time, except bulk-to-roll steps (extrusion) or machines set to allow several orders. Start and Resume both check this.
- Wastage: if trim + scrap is at or above the company limit (Company profile, default 5%), a wastage reason and a note are required.
- Output is capped by the rolls loaded; on lamination the tightest lane sets the cap. A lane may run up to 5% short of its share; past that the operator or WCM must load the next roll.
- A part-used roll leaves a job only through **Return balance** (back to stock with the same label; a lower weighed balance is booked as scrap) or **Roll finished** (core end booked as scrap). An untouched roll can simply be taken off.
- Pause always asks a reason bucket (Machine breakdown, Maintenance, Material shortage, Manpower shortage, Power failure, Other) and writes a downtime record. "Other" needs a note.
- At the last pouching step, logging the output takes in-house inner pouches off stock (by count, or by weight for inner pouches stocked in KG). Bought inner pouches are only marked here; they and every other packing item are booked by the evening packing count. The inner pouch setup never stops an output: with no pieces per inner pouch the output is still saved, the Packing Yard enters "Inner packs filled" and the evening count books them.
- After release, preparation on the WC terminal is locked. "Recalculate from masters" works only before any output is logged.

## Ink control

Ink is not a job requirement. It is issued from the store to a floor location, returned or returned as mix (POLY or PET base), and counted on the floor by time. Actual use = opening count + issued − returned − closing count. The Reconcile tab spreads that use over the jobs printed in the window and compares it with the artwork GSM theory.

## Who does what

- **WORK_CENTER_MANAGER**: WC terminal — machine, rolls, granule codes, release, add next roll, close short, cancel. Also the machine terminal.
- **OPERATOR**: machine terminal only — start, log output, pause, complete, return or finish a roll.
- **PLANNER / PLANT_MANAGER**: may view floor screens, ink control, job summaries.
- **ADMIN / OWNER / SUPER_ADMIN**: everything.

## Problems and fixes

- **"No Machines Assigned"** — the account has no machine or work centre. An admin assigns one on System › Users.
- **Start is off** — input rolls are not reserved. Ask the WCM.
- **"Machine not assigned. WCM must assign a machine before execution."** — the job was not released to a machine.
- **"… is running JOB-…"** — pause or finish the other order first.
- **Wastage reason required** — choose a reason under Trim and scrap and write why.
- **"Load the next roll for this lane first."** — a lane is short; add the next roll.
- **"Selected roll width is outside the planned web ±20 mm …"** — pick another roll, slit a wider one, or use the override with a reason.
- **"Code split for … must total …"** — grade codes must add up to the issued kg.
- **Yellow "Output logged · one thing left for the store"** — the output is saved; the store or the evening count settles the stock note.

## सारांश (हिंदी)
# Production मॉड्यूल (फ्लोर पर उत्पादन)

Production मॉड्यूल में रिलीज़ हुई order lines असल में बनती हैं। इसमें **WC terminal** (work-centre manager), **Machine terminal** (operator), **Ink Control Desk**, और केवल देखने वाला **Production job** सार है। प्लानिंग की स्क्रीन (plan queue, combine orders, launch stock) Planner मॉड्यूल में हैं।

## स्क्रीन और उनका आपसी संबंध

- **/production/work-center** — "Choose your machine group"। WCM को केवल उसे दिए गए work centres दिखते हैं। पिछली बार वाला याद रहता है।
- **/production/work-center/[id]** — "Work Center Terminal"। इस work centre की order lines की कतार, और हर job तैयार करके रिलीज़ करने का पैनल।
- **/production/machine-selector** — "Choose your machine"। Operator का होम। Operator को केवल उसकी machines दिखती हैं; एक ही machine हो तो terminal सीधे खुलता है।
- **/production/machine/[machine_id]** — "Machine Terminal"। Start, output लिखना, pause, complete।
- **/production/ink-control** — "Ink Control Desk"। फ्लोर पर ink देना, वापस लेना, गिनना; artwork theory से मिलान।
- **/production/jobs/[id]** — job का सार, terminals और trace के लिंक के साथ।

## मुख्य क्रम: planner की रिलीज़ से machine के output तक

1. Planner, Control Tower के plan queue में order line को route पर रिलीज़ करता है। route steps के jobs बनते हैं।
2. Line पहले work centre की कतार में आती है, जैसे ABC Foods, SO-2026-0123, printing।
3. WCM job खोलता है। पैनल में: **Order · what it is** (ordered, produced, remaining, "what is to be made" प्लेट), **Machine**, **Rolls by lane**, **Input issue**, और **Release · readiness**।
4. WCM machine चुनता है। जो machine दूसरा order चला रही है वह मना होती है, जब तक उसे कई orders की अनुमति न हो (default में extrusion)।
5. WCM roll picker से rolls लगाता है: roll ID स्कैन करें या लिखें, या सूची से चुनें। planned web से **±20 mm** के भीतर का roll वैसे ही चलता है; चौड़ा roll slit होता है; 20 mm से ज़्यादा पतला roll मना है। slitting से पहले, कई lane वाली line planned parent web चलाती है (lanes × child चौड़ाई + trim)।
6. Input issue में केवल **rolls और granule के grade code** हाथ से भरते हैं। बाकी हर सामग्री "Auto · step mapping" दिखाती है और योजना की मात्रा पर issue होती है। एक granule कई grade code में बँट सकता है; हर issued kg को कोड मिलने तक रिलीज़ रुकती है।
7. गेट M (machine), R (rolls), I (issue) और C (cylinders/artwork) साफ़ हों तो WCM **Release to machine** दबाता है।
8. Operator machine terminal खोलता है, Queue में job चुनता है और **Start** दबाता है।
9. Operator output लिखता है: roll की पंक्तियाँ (gross, core tare, चौड़ाई, लंबाई), pouching में pieces, या slitting में child rolls; साथ में trim और scrap। फिर **Log output**।
10. Step पूरा होने पर **Complete** दबाता है। output लक्ष्य से कम हो तो बटन **Force complete** बनता है और कारण लिखना पड़ता है।
11. अब अगला route step दर्ज output पर चल सकता है। समानांतर steps (जैसे extrusion और printing, जो lamination को माल देते हैं) एक साथ चल सकते हैं। तैयार pouches Packing Yard जाते हैं; तैयार rolls packing और dispatch पर।

## नियम और सीमाएँ

- एक machine पर एक समय में एक order, सिवाय bulk-to-roll steps (extrusion) या जिन machines को कई orders की अनुमति है। Start और Resume दोनों पर यह जाँच होती है।
- वेस्टेज: trim + scrap कंपनी सीमा (Company profile, default 5%) के बराबर या ऊपर हो तो कारण और टिप्पणी ज़रूरी।
- Output लोड rolls से सीमित है; lamination में सबसे कम lane सीमा तय करती है। एक lane अपने हिस्से से 5% तक कम चल सकती है; उससे ज़्यादा हो तो अगला roll लोड करना होगा।
- आधा इस्तेमाल हुआ roll job से केवल **Return balance** (उसी लेबल के साथ स्टॉक में वापस; कम वज़न scrap बुक होता है) या **Roll finished** (core का बचा हिस्सा scrap) से निकलता है। बिना छुआ roll सीधे हटाया जा सकता है।
- Pause हमेशा कारण माँगता है (Machine breakdown, Maintenance, Material shortage, Manpower shortage, Power failure, Other) और downtime दर्ज करता है। "Other" में टिप्पणी ज़रूरी।
- आखिरी pouching step पर output दर्ज करते ही घर में बने (in-house) inner pouch स्टॉक से कटते हैं (गिनती से, या KG में रखे inner pouch वज़न से)। खरीदे हुए inner pouch यहाँ सिर्फ़ mark होते हैं; वे और बाकी हर packing सामान शाम की packing गिनती से बुक होते हैं। Inner pouch की setup से output कभी नहीं रुकता: pieces per inner pouch न हो तो भी output सेव होता है, Packing Yard "Inner packs filled" भरता है और शाम की गिनती उन्हें बुक करती है।
- रिलीज़ के बाद WC terminal पर तैयारी लॉक हो जाती है। "Recalculate from masters" केवल तब चलता है जब कोई output दर्ज न हुआ हो।

## Ink control

Ink job की requirement नहीं है। यह स्टोर से फ्लोर लोकेशन पर issue होती है, वापस या मिक्स (POLY या PET बेस) के रूप में लौटती है, और फ्लोर पर समय के साथ गिनी जाती है। असली खपत = शुरुआती गिनती + issue − वापसी − आखिरी गिनती। "Reconcile" टैब इसे उस समय छपे jobs पर बाँटता है और artwork GSM theory से मिलाता है।

## कौन क्या करता है

- **WORK_CENTER_MANAGER**: WC terminal — machine, rolls, granule codes, रिलीज़, अगला roll, close short, cancel। Machine terminal भी।
- **OPERATOR**: केवल machine terminal — start, output, pause, complete, roll वापस या खत्म।
- **PLANNER / PLANT_MANAGER**: फ्लोर स्क्रीन, ink control और job सार देख सकते हैं।
- **ADMIN / OWNER / SUPER_ADMIN**: सब कुछ।

## समस्याएँ और समाधान

- **"No Machines Assigned"** — खाते में machine या work centre नहीं। Admin System › Users पर assign करे।
- **Start बंद है** — input rolls reserve नहीं। WCM से कहें।
- **"Machine not assigned. WCM must assign a machine before execution."** — job किसी machine पर रिलीज़ नहीं हुआ।
- **"… is running JOB-…"** — पहले दूसरे order को pause या पूरा करें।
- **वेस्टेज कारण ज़रूरी** — Trim and scrap में कारण चुनें और लिखें क्यों।
- **"Load the next roll for this lane first."** — lane कम है; अगला roll जोड़ें।
- **"Selected roll width is outside the planned web ±20 mm …"** — दूसरा roll चुनें, चौड़े को slit करें, या कारण के साथ override।
- **"Code split for … must total …"** — grade codes का जोड़ issued kg के बराबर हो।
- **पीला "Output logged · one thing left for the store"** — output सेव है; स्टोर या शाम की गिनती स्टॉक नोट ठीक करेगी।

## Every screen (English)

### Operator dashboard (redirect) (/dashboard/operator)
Screen address: /dashboard/operator · Roles: OPERATOR, WORK_CENTER_MANAGER, ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=dashboard-operator

Old address kept for old links. It sends you straight to the Machine terminal (/production/machine-selector).

Operators work only on the Machine terminal: pick the machine, start the released job, log output and close. This page itself has nothing to do.

**Before you start**
- A job released to the machine by the WC terminal.

**Step by step**
1. Open /dashboard/operator or an old bookmark.
2. You land on the Machine terminal. Pick your machine there.

**What is on the screen**
- **Redirect target**: /production/machine-selector, the Machine terminal.

**Common problems and fixes**
- "Machine shows no job" — The WC manager has not released a job to that machine yet. Ask the WC manager to release it from the WC terminal.

**If stuck**
1. Bookmark /production/machine-selector directly.

Related pages: /production/machine-selector, /production/work-center, /dashboard/work-center

### Work Center Command Deck (/dashboard/work-center)
Screen address: /dashboard/work-center · Roles: WORK_CENTER_MANAGER, ADMIN, OWNER, SUPER_ADMIN · Share link: https://erp.totalpolyprint.com/guide?page=dashboard-work-center

Live WCM control for machine assignment, operator coverage, roll and ink handoff, blockers, downtime, output, scrap and shift takeover.

The WC manager's overview across assigned work centers. Open it at shift start or takeover to see blocked jobs, released jobs without a machine, idle machines and discipline (scrap, downtime, ink remix). The real work (picking rolls, issuing input, releasing jobs to machines) is done in the WC terminal, opened from "Open WCM Terminal" or "Open terminal" on a work-center row.

**Before you start**
- Work centers with machines set up; jobs released by the planner.

**Step by step**
1. Read the tiles: "Active Work Centers", "Executing Jobs", "Blocked Jobs", "Machines Running", "No Machine", "Output", "Scrap Rate", "Runtime Coverage".
2. Check "Workload & Risk Overview": "Jobs in Queue" (High risk, Medium risk, Low / ready) and "Machine State Mix". Click a slice to open the matching screen.
3. In "Assigned Work-Center Escalations" filter All actions, High priority, Blocked jobs, Machine assignment or Operator coverage, or search by job, blocker, machine or operator; press the action to go there.
4. In "Assigned Work Center Board" read Run, Pend, Block and OEE avg per work center and press "Open terminal".
5. Check "Machine Readiness" and "Execution Discipline" (Downtime, Ink Remix, Cost Coverage, Unmapped Cost, Shift Output).
6. Before takeover go through "Shift Handoff": Machine assignment, Operator coverage, Roll and material issue, Maintenance risk.
7. The page refreshes every 60 s; press "Retry sync" if it failed.

**What is on the screen**
- **No Machine**: Released jobs not yet assigned to a machine. Assign them in the WC terminal.
- **Blocked Jobs**: Jobs on hold or with a blocker; the hint gives the number of WCM actions.
- **Runtime Coverage**: Share of time machines ran; hint shows downtime minutes.
- **Scrap Rate**: Scrap against output in scope.
- **OEE avg**: Average overall equipment effectiveness of the work center.
- **Ink Remix**: Ink remixed vs issued; hint shows material variance.
- **Unmapped Cost**: Cost groups not mapped; fix in costing set-up.

**Common problems and fixes**
- "Execution Command Deck failed to load" — WCM telemetry is unavailable or returned an unstamped fallback; KPI cards are paused instead of showing zeros. Press "Retry sync".
- "No assigned work centers are open for this WCM role." — Use the WCM terminal to select an available floor context, or ask admin to assign work centers.

**If stuck**
1. For any job problem open the WC terminal of that work center; its Stalled tab lists stuck jobs.
2. "Manage work centers" opens the factory set-up for work centers.

Related pages: /production/work-center, /production/machine-selector, /factory/work-centers, /factory/machines, /inventory/rolls, /analytics/reports

**Not done yet / watch out**
- The Command Deck only shows and links; jobs, rolls and machine assignment are handled in the WC terminal.

### Machine scan (/m/[code])
Screen address: /m/[code] · Roles: ADMIN, OWNER, SUPER_ADMIN, WORK_CENTER_MANAGER, OPERATOR, PLANT_MANAGER, MAINTENANCE_TECH, MAINTENANCE_SUPERVISOR · Share link: https://erp.totalpolyprint.com/guide?page=m-code

Opens a machine from its QR sticker: status, running order with a quick output log, checks due, maintenance work, open faults, queue and recent history.

Operators scan to log output or report a fault; maintenance staff scan to see checks and jobs. The full work (rolls, returns, scrap, splits) stays on the machine terminal.

**Before you start**
- A machine QR sticker; your role may use machines or maintenance (operators only see machines assigned to them).

**Step by step**
1. Scan the sticker on the machine; check the status line (Active, DOWN · awaiting repair, Under maintenance).
2. Under "Running now" see target, produced and remaining.
3. In "Quick log output" type kg (and pcs if needed) and press "Log". For roll-making steps use the machine terminal instead.
4. To raise a breakdown press "Report fault · खराबी".
5. Open "Checks due" or "Maintenance work" items to do them.
6. Press "Terminal" for the full machine terminal.

**What is on the screen**
- **Run hours · 30 d / Downtime h · 30 d / Breakdowns · 30 d**: Last 30 days of the machine.
- **Queued orders**: Jobs waiting on this machine.
- **Quick log output**: Same rules as the terminal: capped by the step target and the issued input.

**Common problems and fixes**
- "No machine matches code "…". Check the sticker or ask the supervisor." — The sticker is wrong or old.
- "Could not log" — The output was refused (above target or issued input, or no running job). Read the message; fix on the terminal.
- "This machine is not assigned to you" — Ask an admin to add the machine to your user.

**If stuck**
1. If the page looks old, it refreshes by itself; or reload.
2. Returns, scrap and roll splits are done on the machine terminal.

Related pages: /production/machine-selector, /maintenance, /maintenance/jobs

**Not done yet / watch out**
- Quick log takes only kg and pcs; roll-making steps, returns, scrap and splits must use the machine terminal.

### Ink Control Desk (/production/ink-control)
Screen address: /production/ink-control · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANNER, WORK_CENTER_MANAGER, PLANT_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=production-ink-control

Issue ink from the store to a floor location, take returns and mixed-ink returns, count the ink on the floor by time, and compare what was really used with the artwork GSM theory.

Ink is not a job requirement row. It is booked by floor movements and counts: issue to the floor, return what is left, then count. Actual use for a window = opening count + issued − returned − closing count. The Reconcile tab spreads that actual over the jobs that printed in the window and shows the variance against theory.

**Before you start**
- Plant with a store location and a floor location (Factory › Locations).
- Ink masters (Master › Inks) and ink stock received in the store.
- Shift timing set up, so the entry shift is found from the time.

**Step by step**
1. Pick "Plant", then "Store" and "Floor" locations at the top. The shift badge fills itself from the time.
2. Open "Shift Desk". Choose the mode: "Issue", "Return" or "Mix Return".
3. Search and pick the ink under "Select ink", enter "Quantity kg" and check "Event time".
4. Press "Issue ink" (or "Return ink" / "Return as mix"). For a mix return also choose "Returned mix base" (POLY or PET) and the "Returned mix color".
5. At the count time open "Ink stock count snapshot": choose "Count scope" (selected floor or all floor locations), set "Physical count time", type "Counted kg" per ink.
6. Press "Post count". "Reset to system" puts the system figures back if you typed wrongly before posting.
7. Open "Reconcile", set "Analysis from" / "Analysis to" and read "Theory vs actual allocation" per order/job.
8. Check "Recent Movements" and "Posted Counts" to confirm what was saved.

**What is on the screen**
- **Floor stock**: Ink lots now lying on the floor locations of the plant.
- **Issued in window**: Kg issued to the floor in the analysis window, with the number of issue movements.
- **Actual consumed**: Real use from counts and movements, with the theory kg and "% vs theory". "No theory baseline" means no printed job with artwork GSM fell in the window.
- **Artwork theory / Theory kg / Actual kg / Variance %**: Per order/job: ink expected from the artwork GSM, ink allocated from the actual, and the difference.
- **Entry shift / Auto shift**: The shift is resolved from the event time. "No matching shift window" means the time is outside every shift set up.
- **Returned mix base / color**: Mixed leftover ink is returned as a new ink master of base POLY or PET with the colour name you give.
- **Count scope**: "Selected floor location" counts one place; "All floor locations in plant" posts one count for every floor location shown.

**Common problems and fixes**
- "Ink issue source and floor locations must be in the same plant." — Store and floor were picked from different plants. Pick both under the same plant.
- "Ink floor movements accept INK materials only." — The chosen material is not an ink master. Pick an ink.
- "Ink floor window … is already posted for this timestamp." — A count already closed this time window, so a movement cannot be back-dated into it. Use a later event time.
- "Quantity must be positive." — Enter kg above zero. The buttons stay off until plant, floor, ink and quantity are filled.
- "Mix ink base type must be POLY or PET. / Mix ink color name is required." — For "Mix Return" choose POLY or PET and type the colour.
- "Count location does not belong to selected plant." — Re-select the plant, then the floor location from its list.

**If stuck**
1. Press the refresh button; the toast "Ink control data refreshed." confirms fresh data.
2. If variance looks wrong, check that an opening and a closing count exist in the window ("Opening count" / "Closing count" in the reconciliation box).
3. A wrong issue is corrected with a matching "Return", not by editing.
4. Use "Open Stock Lifecycle" to see the full stock history of an ink.

Related pages: /inventory/ink-floor, /inventory/stock-lifecycle, /master/inks, /factory/locations, /system/shift-timing

**Not done yet / watch out**
- The Store and Floor dropdowns list every location of the plant, not only store or floor types, and ink issues do not gate machine release ("No execution gate").

### Production job (/production/jobs/[id])
Screen address: /production/jobs/[id] · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANNER, PLANT_MANAGER, WORK_CENTER_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=production-jobs-id

A read-only summary of one production job: state, planned / produced / remaining quantity, where it runs and its layer stack.

Activity feeds, trace results and audit entries link here. Use it to see where a job stands and jump to its machine terminal, WC terminal, trace or plan queue. Nothing is posted from this page.

**Before you start**
- The job exists and your role may read production jobs.

**Step by step**
1. Open the job from a feed, trace or audit link.
2. Read the header: job number, product and customer, the state chip, order number and priority.
3. Check "Planned", "Produced" (with % of plan), "Remaining" and "Process".
4. In "Where it runs" read work centre, machine, operator, batch and order line.
5. Press "Machine terminal" to open the machine screen, or "Trace" for the job in Completed trace.
6. Use "Work-centre terminal" or "Order in plan queue" to go to those screens.

**What is on the screen**
- **Planned / Produced / Remaining**: Quantities in the job unit (kg or pcs). "Produced" also shows the % of plan; the total weight in kg shows under Planned when known.
- **Process**: The process code of the step this job runs (for example printing or lamination).
- **Progress**: Produced ÷ planned, capped at 100%.
- **Input → output**: Stock form taken in and given out, e.g. ROLL → ROLL or ROLL → BULK.
- **Specification**: Layer list with material, micron and grade, plus ink colours. "No layer stack recorded" when the job carries no layers.

**Common problems and fixes**
- "Job not found" — "It may have been removed, or you may not have access to it." The job id is wrong, archived, or outside your work centre.

**If stuck**
1. Reopen the job from the plan queue or Completed trace instead of an old link.
2. The "Machine terminal" button shows only when a machine is assigned; assign one on the WC terminal.

Related pages: /production/machine/[machine_id], /production/work-center/[id], /dashboard/planner/control-tower/completed-trace, /dashboard/planner/control-tower/plan-queue

**Not done yet / watch out**
- The job summary is read-only and operators cannot open it; there is no way to pause, edit or reassign the job from here.

### Choose your machine (/production/machine-selector)
Screen address: /production/machine-selector · Roles: ADMIN, OWNER, SUPER_ADMIN, WORK_CENTER_MANAGER, OPERATOR · Share link: https://erp.totalpolyprint.com/guide?page=production-machine-selector

Shows the machines you may run as cards. Tap one to open its machine terminal.

This is the operator's home page. An operator sees only the machines assigned to them on the Users page; a work-centre manager sees the machines of their work centres; Admin and Owner see every active machine. If only one machine is allowed, the page opens its terminal at once.

**Before you start**
- Machine created under a work centre and set ACTIVE (Factory › Machines).
- For an operator: the machine assigned to the user on System › Users. For a WCM: the work centre assigned.

**Step by step**
1. Open "Machine terminal" in the Floor menu (operators land here after sign-in).
2. Type in "Search machine, code, work center, or plant..." or use the state, work-center and plant filters.
3. The card marked "Last Used" is your last terminal and sorts first; machines running a job come next.
4. Read the card: "Active Execution" with job number and product, or "Idle Terminal"; "Pending Jobs" shows the queue count.
5. Press "Enter Terminal" (or the card, or Enter / Space on it).
6. Use "Clear" to remove all filters.

**What is on the screen**
- **Active machines / Running now / Jobs waiting / Machine groups**: Counts for the machines you can see: active, running a job, total queued jobs, and number of work centres.
- **Status filter**: "All states", "Active", "Running job", "Idle".
- **UID**: The machine code, the same code printed on its QR poster.
- **Pending Jobs · Queue**: Jobs released to this machine and waiting.

**Common problems and fixes**
- "No Machines Assigned" — "Assign a work center to this manager to unlock its machines." Your account has no machine (operator) or no work centre (WCM). An admin fixes it on System › Users.
- "Failed to load machines" — Network or server problem. Press "Retry".
- "No machine matched the current search query." — The search or filters hide every card. Press "Clear".

**If stuck**
1. A machine that is DOWN for maintenance is not listed; ask maintenance to resolve the fault.
2. Scan the machine QR poster with the phone to open its card directly.
3. The list refreshes by itself every 45 seconds; reload the page if a new assignment does not show.

Related pages: /production/machine/[machine_id], /production/work-center, /maintenance/qr, /system/users

**Not done yet / watch out**
- The server returns only ACTIVE machines, so the "Active" filter changes nothing and machines that are DOWN are not shown at all.
- Planners and plant managers see only machines of work centres assigned to them; with none assigned they get "No Machines Assigned" even though the floor screens are open to them.

### Machine Terminal (/production/machine/[machine_id])
Screen address: /production/machine/[machine_id] · Roles: ADMIN, OWNER, SUPER_ADMIN, WORK_CENTER_MANAGER, OPERATOR · Share link: https://erp.totalpolyprint.com/guide?page=production-machine-machine_id

The operator's screen for one machine: pick a released job, Start, log output (rolls, pieces, trim and scrap), Pause with a reason, and Complete the step.

Jobs reach this screen only after the work-centre manager releases them to this machine on the WC terminal with rolls and material issued. Every output you log moves the order forward: the next route step can run on it, pouches go to the Packing Yard, rolls go to the next step or to dispatch.

**Before you start**
- Job released to this machine on the WC terminal ("Release to machine"), with input rolls reserved.
- Machine assigned to your account (operator) or your work centre (WCM).
- Scrap reasons and downtime reasons set up in System › Reason codes.

**Step by step**
1. Pick the job in the "Queue" rail on the left (search "Search SO, customer, final output").
2. Check the plate "what is to be made" and the focus strip "Target · लक्ष्य", "Done · बन गया", "Left · बाकी".
3. Press "Start" (or "Resume" after a pause). It stays off until the input rolls are reserved.
4. Under "Output logging" enter the output: roll rows (Gross kg, Tare kg, Width mm, Length m) for roll steps, "Good output PCS" for pouching, or split child rolls for slitting.
5. Fill "Trim" and "Scrap" if any. Above the wastage limit choose a reason and write why.
6. Press "Log output". Watch "Can log now (max) · अभी अधिकतम" — the button is off above that cap.
7. To stop, press "Pause", pick the reason bucket and code, add a note, then "Pause machine · रोकें".
8. When the step is done press "Complete". If output is short of the target, the button reads "Force complete" and needs a variance reason (at least 5 characters).
9. For a part-used roll use "Return balance" or "Roll finished" in "Rolls by lane".

**What is on the screen**
- **Target · Produced · Remaining · Yield**: Step figures in the unit the operator counts (pieces on pouching, kg on roll steps). "Target comes from · लक्ष्य कैसे बना" explains the target (film + ink + chemicals + add-ons per piece × pieces).
- **Can log now (max) / Finish within**: The most you can log now (limited by the rolls loaded and the tightest lane) and the range to finish the step.
- **Output goes to · माल कहाँ जाएगा**: Where the output stock lands (next step WIP or finished goods location).
- **Roll rows: Gross / Tare / Net / Width / Length**: One row per output roll. Net = gross − core tare. Use "Fast roll output entry" to create several rows with a default core tare.
- **Good output PCS / Output KG**: On pouching, pieces lead; kg is worked out from the unit weight. The template decides if PCS is required.
- **Trim and scrap · optional**: Enter either, both, or none. At or above the company wastage limit (Company profile, default 5%) a reason and a note are required.
- **Rolls by lane**: Rolls loaded on each layer lane, running / queued / part-used, with loaded kg against kg still needed.
- **Remainder location**: Where the uncut input balance goes back as a remainder roll.
- **Other logs**: "Log scrap", "Log downtime" (can auto-stop the step), "Log material consumption" and "Quality readings".
- **Machine history**: Closed and forced jobs of this machine with produced quantity and variance; filter "Normal" / "Forced variance".

**Common problems and fixes**
- "Output logged. Pieces per inner pouch is not set on this order…" — Not an error: the output is saved. The order has no pieces per inner pouch, so no inner pouches were taken at the machine; Packing Yard types the inner packs it fills and the evening count books them. Ask the admin to set "Pouches per inner pouch (default)" on the inner pouch in Masters → Packaging.
- "… is running JOB-…. Only bulk-to-roll steps (extrusion) run several orders on one machine; pause or finish JOB-… first." — Another order is running on this machine. Pause or complete it first. Only extrusion-type machines (or machines set to "Several orders may run at the same time") run more than one.
- "Machine not assigned. WCM must assign a machine before execution." — The WCM has not released the job to a machine. Ask the WCM to use "Release to machine".
- "Job is not pushed by WCM yet (not EXECUTION_READY)." — Preparation is not finished on the WC terminal.
- "Cannot start job: requirements not satisfied …" — Rolls or material are missing for this step. The WCM must reserve rolls or finish the issue.
- "Wastage is X% of this run (limit Y%). Choose a wastage reason and write why it happened before logging the output." — Trim + scrap is at or above the limit. Choose a reason under "Trim and scrap" and write the note.
- "Output exceeds physical cap … / Output (…) exceeds max allowed for this step" — You entered more than the loaded rolls can give. Check the weights or load the next roll on the lane.
- "… has … kg left on its loaded rolls … Load the next roll for this lane first." — The tightest lane cannot cover this output. The WCM (or you, while running) adds the next roll.
- "Job must be EXECUTING to log output." — The job is paused or not started. Press "Resume" or "Start" first.
- "Output logged as loose pouches: this order has an inner pouch switched on but no packing material…" — Not an error: the output is saved as loose pouches and no inner pouches were taken. Ask the planner or admin to set the inner pouch on the order line; do not log the output again.
- "No new output logged since last completion." — Log output before completing again.

**If stuck**
1. If "Stale Ns" shows in the header, the screen lost sync; it refreshes every 15 seconds or reload the page.
2. The yellow toast "Output logged · one thing left for the store" means output is saved but stock (e.g. in-house inner pouches) could not be fully booked; the evening count settles it.
3. A machine breakdown: pause with "Machine breakdown" or report a fault in Maintenance; the machine goes DOWN until repaired.
4. Wrong roll on the job: ask the WCM; an untouched roll can be taken off, a part-used one only through "Return balance".

Related pages: /production/machine-selector, /production/work-center/[id], /logistics/packing, /maintenance/faults, /system/reason-codes

**Not done yet / watch out**
- "Force complete" needs a reason of at least 5 characters but the page does not say the minimum length.
- On a stock order with no pieces per inner pouch anywhere, the machine logs the output but takes no inner pouches; the evening count shows their use as not on any order until a default is set on the inner pouch.

### Choose your machine group (WC terminal) (/production/work-center)
Screen address: /production/work-center · Roles: ADMIN, OWNER, SUPER_ADMIN, WORK_CENTER_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=production-work-center

Lists the work centres you manage. Open one to reach its WC terminal.

This is the work-centre manager's home. A WCM sees only the work centres assigned to them; Admin, Owner, Planner and Plant manager see all. The last one you opened is remembered.

**Before you start**
- Work centre created (Factory › Work Centers) and assigned to the user (System › Users).

**Step by step**
1. Open "WC terminal" in the Floor menu.
2. Press the top card "Resume last WCM terminal" (or "Open first available WCM terminal").
3. Or search "Search work center by name or code..." and press "Open terminal" on a card.
4. The terminal opens at /production/work-center/<id>; the card you opened becomes "Last Used" next time.

**What is on the screen**
- **Last Used**: The work centre you opened last on this browser.
- **Station Protocol**: The work centre code.

**Common problems and fixes**
- "No work center matched the current search query." — The search hides all cards, or no work centre is assigned to you. Clear the search; if still empty ask an admin to assign one on System › Users.

**If stuck**
1. Reload the page if it stays on "Accessing Station Topology...".

Related pages: /production/work-center/[id], /production/machine-selector, /dashboard/work-center

**Not done yet / watch out**
- When no work centre is assigned the page shows "No work center matched the current search query." instead of saying that none is assigned.

### Work Center Terminal (/production/work-center/[id])
Screen address: /production/work-center/[id] · Roles: ADMIN, OWNER, SUPER_ADMIN, WORK_CENTER_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=production-work-center-id

The work-centre manager's screen: see the queue of order lines at this work centre, pick the machine, assign rolls, give granule grade codes, and release the job to the machine. Also close short, cancel, and review history.

Lines arrive here after the planner releases them to the route. When every gate is clear the WCM presses "Release to machine"; the job then appears on that machine terminal for the operator. While it runs the WCM can add the next roll, return a balance or finish a roll.

**Before you start**
- Line released by the planner to a route that passes this work centre.
- Machines of this work centre set up and ACTIVE.
- Rolls and coded granule stock in this plant (or a transfer from another plant).
- For print steps: artwork and cylinders attached.

**Step by step**
1. In the queue panel pick a job. Use tabs "Queue", "Running / ready", "Stalled", "History", the search and filters.
2. Read "Order · what it is": ordered, produced, remaining, the plate "what is to be made" and step figures.
3. In "Machine" tap the machine that will run it ("Idle · ready", "Running …", "Down · not available").
4. In "Rolls by lane" open the roll picker: scan or type the roll ID, or pick from the list. "EXACT MATCH" is used as it is; "WIDER · SLIT REQUIRED" is slit; rolls more than 20 mm narrower are refused.
5. In "Input issue" open each granule and give its grade codes ("Add grade codes"); every other material shows "Auto · step mapping" and needs nothing.
6. Check the release checklist: Rolls allocated, Machine assigned, Cylinders & artwork, issue done.
7. Press "Release to machine" in the release bar (or "Queue on machine" when the machine is busy with an extrusion-type job).
8. While running, use "Add next roll", "Return balance" or "Roll finished" in the lanes.
9. Use ⋯ "More job actions" for "Short close step", "Cancel job" or "Recalculate from masters".

**What is on the screen**
- **Running / ready · Waiting · Queue · No machine**: Figure chips in the head; tap one to switch the view. "No machine" lines need a machine first.
- **M R I C gates**: On each queue row: M = machine assigned, R = rolls allocated (skipped for bulk input), I = issue recorded, C = cylinders/artwork ready (skipped when not a print step).
- **Queue status chips**: "All", "WC Ready", "Assigned", "No machine".
- **Sort**: Priority highest/lowest first, SO date oldest first, Customer (A→Z), Machine (A→Z).
- **Rolls by lane**: Each layer lane with loaded kg against kg still needed. "No roll yet: …" names empty lanes; "Still short for the full order: …" is a note, not a block.
- **Roll match labels**: EXACT MATCH, WIDER · SLIT REQUIRED, TRUE WIP, PURCHASED FALLBACK, COMPATIBLE FALLBACK. Material, gauge, width, stock form and grade must all match.
- **Planned web**: Before slitting, a multi-lane line runs its planned parent web (lanes × child + trim). Rolls within ±20 mm of it are used as they are.
- **Issue policy · template rules**: Closed by default. "Override" changes one row ("Fixed extra kg" or "Minimum issue kg") and needs "Reason for override"; "Use template" goes back.
- **Granule grade codes**: Tap a code to take the balance from it (capped at its free stock) or give a part kg; one granule can be split over several codes. Release waits until every issued kg has a code.
- **History**: "WCM audit and production history": status, Material issue, Short close; Today / Last 7 days / Last 30 days / All history; newest 300 shown.

**Common problems and fixes**
- "Selected roll width is outside the planned web ±20 mm. Slit it to the planned web, or use manual override with a reason to allocate it." — The roll is too wide or too narrow. Pick a roll within ±20 mm, a wider one to slit, or use "Policy override" with a reason.
- "Code split for … must total X kg, got Y kg." — The codes given do not add up to the issued kg. Add or change codes until the total matches.
- "… is at another plant. Complete an inter-plant transfer and receipt before release." — Use "Start transfer", then "Confirm received" at this plant.
- "Cannot mark ready: requirements not satisfied …" — A roll lane, issue or code is still missing. Clear the gate named in the release bar.
- "Machine busy — running JOB-…" — The chosen machine runs another order and is not an extrusion-type machine. Pick an idle machine or wait.
- "This job is already released to machine execution. Preparation changes are locked." — After release, changes happen only on the machine terminal (or via add/return roll).
- "Cannot recalculate this line: …" — "Recalculate from masters" is allowed only before any output is logged.
- "Reason required for audit history" — Short close and cancel need a reason from the reason master.

**If stuck**
1. If "Failed to load work-center queue" shows, reload; "Access denied" means this work centre is not assigned to you.
2. "No roll satisfies the current-step contract": check plant, width, grade and quarantine; use "View Other Plants & Request Transfer" to bring rolls with a delivery challan.
3. A job stuck long shows in "Stalled"; open it and clear the blocker shown in its head.
4. The queue refreshes every 30 s ("Auto-refresh 30 s").

Related pages: /production/work-center, /production/machine/[machine_id], /dashboard/planner/control-tower/plan-queue, /inventory/rolls, /inventory/traceability, /production/planner/gang-builder

**Not done yet / watch out**
- History shows only the newest 300 jobs; older ones need search or narrower dates.

## हर स्क्रीन (हिंदी)

### Operator dashboard (रीडायरेक्ट) (/dashboard/operator)
स्क्रीन का पता: /dashboard/operator · भूमिकाएँ: OPERATOR, WORK_CENTER_MANAGER, ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=dashboard-operator&lang=hi

पुराने link के लिए रखा पता। यह सीधे Machine terminal (/production/machine-selector) पर भेजता है।

Operator सिर्फ़ Machine terminal पर काम करते हैं: machine चुनें, release हुआ job शुरू करें, output दर्ज करें और close करें। इस पेज पर खुद कुछ नहीं है।

**शुरू करने से पहले**
- WC terminal से machine पर job release हुआ हो।

**स्टेप बाय स्टेप**
1. /dashboard/operator या पुराना bookmark खोलें।
2. Machine terminal खुलता है। वहाँ अपनी machine चुनें।

**स्क्रीन पर क्या है**
- **कहाँ भेजता है**: /production/machine-selector, यानी Machine terminal।

**आम दिक्कतें और हल**
- "Machine पर कोई job नहीं" — WC manager ने उस machine पर अभी job release नहीं किया। WC manager से WC terminal से release करवाएँ।

**अटक गए तो**
1. सीधे /production/machine-selector bookmark करें।

जुड़े पेज: /production/machine-selector, /production/work-center, /dashboard/work-center

### Work Center Command Deck (/dashboard/work-center)
स्क्रीन का पता: /dashboard/work-center · भूमिकाएँ: WORK_CENTER_MANAGER, ADMIN, OWNER, SUPER_ADMIN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=dashboard-work-center&lang=hi

machine assignment, operator coverage, roll और ink handoff, blocker, downtime, output, scrap और shift takeover का live WCM नियंत्रण।

सौंपे गए work center का WC manager वाला नज़ारा। shift शुरू या takeover पर खोलें: blocked job, बिना machine वाले released job, खाली machine और discipline (scrap, downtime, ink remix) देखें। असली काम (roll चुनना, input issue, machine पर job release) WC terminal में होता है, जो "Open WCM Terminal" या work center row के "Open terminal" से खुलता है।

**शुरू करने से पहले**
- machine वाले work center बने हों; planner ने job release किए हों।

**स्टेप बाय स्टेप**
1. tile पढ़ें: "Active Work Centers", "Executing Jobs", "Blocked Jobs", "Machines Running", "No Machine", "Output", "Scrap Rate", "Runtime Coverage"।
2. "Workload & Risk Overview" देखें: "Jobs in Queue" (High risk, Medium risk, Low / ready) और "Machine State Mix"। मिलती स्क्रीन खोलने के लिए हिस्से पर click करें।
3. "Assigned Work-Center Escalations" में All actions, High priority, Blocked jobs, Machine assignment या Operator coverage से filter करें, या job, blocker, machine, operator से खोजें; action दबाकर वहाँ जाएँ।
4. "Assigned Work Center Board" में हर work center का Run, Pend, Block और OEE avg पढ़ें और "Open terminal" दबाएँ।
5. "Machine Readiness" और "Execution Discipline" (Downtime, Ink Remix, Cost Coverage, Unmapped Cost, Shift Output) देखें।
6. takeover से पहले "Shift Handoff" देखें: Machine assignment, Operator coverage, Roll and material issue, Maintenance risk।
7. पेज हर 60 s ताज़ा होता है; fail हो तो "Retry sync" दबाएँ।

**स्क्रीन पर क्या है**
- **No Machine**: release हुए job जिन्हें अभी machine नहीं मिली। WC terminal में assign करें।
- **Blocked Jobs**: hold या blocker वाले job; नीचे WCM action की गिनती।
- **Runtime Coverage**: machine कितने समय चली; नीचे downtime मिनट।
- **Scrap Rate**: output के मुकाबले scrap।
- **OEE avg**: work center की औसत OEE।
- **Ink Remix**: issue के मुकाबले remix ink; नीचे material variance।
- **Unmapped Cost**: map न हुए cost group; costing set-up में ठीक करें।

**आम दिक्कतें और हल**
- "Execution Command Deck failed to load" — WCM telemetry नहीं मिली; KPI card शून्य दिखाने की जगह रुके हैं। "Retry sync" दबाएँ।
- "No assigned work centers are open for this WCM role." — WCM terminal से उपलब्ध floor context चुनें, या admin से work center assign करवाएँ।

**अटक गए तो**
1. किसी job की समस्या के लिए उस work center का WC terminal खोलें; उसका Stalled tab अटके job दिखाता है।
2. "Manage work centers" work center का factory set-up खोलता है।

जुड़े पेज: /production/work-center, /production/machine-selector, /factory/work-centers, /factory/machines, /inventory/rolls, /analytics/reports

**अभी नहीं होता / ध्यान दें**
- Command Deck सिर्फ़ दिखाता और link देता है; job, roll और machine assignment WC terminal में होते हैं।

### Machine scan (मशीन स्कैन) (/m/[code])
स्क्रीन का पता: /m/[code] · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, WORK_CENTER_MANAGER, OPERATOR, PLANT_MANAGER, MAINTENANCE_TECH, MAINTENANCE_SUPERVISOR · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=m-code&lang=hi

QR स्टिकर से मशीन खोलता है: स्टेटस, चल रहा ऑर्डर और जल्दी आउटपुट लिखना, आज की जाँच, मेंटेनेंस काम, खुली खराबी, कतार और हाल का इतिहास।

ऑपरेटर आउटपुट लिखने या खराबी बताने के लिए स्कैन करते हैं; मेंटेनेंस वाले जाँच और काम देखने के लिए। पूरा काम (रोल, रिटर्न, स्क्रैप, स्प्लिट) मशीन टर्मिनल पर ही होता है।

**शुरू करने से पहले**
- मशीन का QR स्टिकर; आपके रोल को मशीन या मेंटेनेंस की अनुमति हो (ऑपरेटर को सिर्फ़ अपनी मशीनें दिखती हैं)।

**स्टेप बाय स्टेप**
1. मशीन का स्टिकर स्कैन करें; स्टेटस देखें (Active, DOWN · awaiting repair, Under maintenance)।
2. "Running now" में target, produced और remaining देखें।
3. "Quick log output" में kg (और ज़रूरत हो तो pcs) लिखें और "Log" दबाएँ। रोल बनाने वाले स्टेप के लिए मशीन टर्मिनल इस्तेमाल करें।
4. खराबी दर्ज करने के लिए "Report fault · खराबी" दबाएँ।
5. करने के लिए "Checks due" या "Maintenance work" खोलें।
6. पूरे मशीन टर्मिनल के लिए "Terminal" दबाएँ।

**स्क्रीन पर क्या है**
- **Run hours · 30 d / Downtime h · 30 d / Breakdowns · 30 d**: मशीन के पिछले 30 दिन।
- **Queued orders**: इस मशीन पर इंतज़ार कर रहे काम।
- **Quick log output**: टर्मिनल जैसे ही नियम: स्टेप के target और जारी इनपुट तक सीमित।

**आम दिक्कतें और हल**
- "No machine matches code "…". Check the sticker or ask the supervisor." — स्टिकर गलत या पुराना है।
- "Could not log" — आउटपुट नहीं लिया गया (target या जारी इनपुट से ज़्यादा, या कोई काम नहीं चल रहा)। संदेश पढ़ें; टर्मिनल पर ठीक करें।
- "This machine is not assigned to you" — एडमिन से यह मशीन अपने यूज़र में जुड़वाएँ।

**अटक गए तो**
1. पेज पुराना लगे तो अपने-आप रिफ़्रेश होता है; या रीलोड करें।
2. रिटर्न, स्क्रैप और रोल स्प्लिट मशीन टर्मिनल पर करें।

जुड़े पेज: /production/machine-selector, /maintenance, /maintenance/jobs

**अभी नहीं होता / ध्यान दें**
- Quick log में सिर्फ़ kg और pcs; रोल बनाने वाले स्टेप, रिटर्न, स्क्रैप और स्प्लिट मशीन टर्मिनल पर ही होते हैं।

### Ink Control Desk (/production/ink-control)
स्क्रीन का पता: /production/ink-control · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANNER, WORK_CENTER_MANAGER, PLANT_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=production-ink-control&lang=hi

स्टोर से फ्लोर लोकेशन पर ink देना, बची ink और मिक्स ink वापस लेना, फ्लोर पर पड़ी ink को समय के साथ गिनना, और असली खपत को artwork GSM के हिसाब (theory) से मिलाना।

Ink job की requirement लाइन नहीं है। यह फ्लोर मूवमेंट और गिनती से बुक होती है: फ्लोर पर issue करें, बची हुई वापस करें, फिर गिनती करें। किसी समय-खिड़की की असली खपत = शुरुआती गिनती + issue − वापसी − आखिरी गिनती। "Reconcile" टैब यह खपत उस समय छपे jobs पर बाँटता है और theory से अंतर दिखाता है।

**शुरू करने से पहले**
- प्लांट में एक स्टोर लोकेशन और एक फ्लोर लोकेशन होनी चाहिए (Factory › Locations)।
- Ink master (Master › Inks) बने हों और स्टोर में ink का स्टॉक आया हो।
- Shift timing सेट हो, ताकि समय से शिफ्ट अपने आप मिल जाए।

**स्टेप बाय स्टेप**
1. ऊपर "Plant" चुनें, फिर "Store" और "Floor" लोकेशन चुनें। शिफ्ट बैज समय से अपने आप भर जाता है।
2. "Shift Desk" खोलें। मोड चुनें: "Issue", "Return" या "Mix Return"।
3. "Select ink" में ink खोजें और चुनें, "Quantity kg" भरें और "Event time" जाँचें।
4. "Issue ink" दबाएँ (या "Return ink" / "Return as mix")। मिक्स वापसी में "Returned mix base" (POLY या PET) और "Returned mix color" भी चुनें।
5. गिनती के समय "Ink stock count snapshot" खोलें: "Count scope" चुनें (चुनी फ्लोर लोकेशन या प्लांट की सभी फ्लोर लोकेशन), "Physical count time" डालें, हर ink का "Counted kg" लिखें।
6. "Post count" दबाएँ। पोस्ट से पहले गलती हो तो "Reset to system" से सिस्टम के आँकड़े वापस आ जाते हैं।
7. "Reconcile" खोलें, "Analysis from" / "Analysis to" सेट करें और हर order/job का "Theory vs actual allocation" देखें।
8. जो सेव हुआ उसे "Recent Movements" और "Posted Counts" में जाँचें।

**स्क्रीन पर क्या है**
- **Floor stock**: अभी प्लांट की फ्लोर लोकेशन पर पड़ी ink के lot।
- **Issued in window**: चुनी समय-खिड़की में फ्लोर पर दी गई kg और issue मूवमेंट की गिनती।
- **Actual consumed**: गिनती और मूवमेंट से निकली असली खपत, साथ में theory kg और "% vs theory"। "No theory baseline" का मतलब इस समय में artwork GSM वाला कोई छपा job नहीं मिला।
- **Artwork theory / Theory kg / Actual kg / Variance %**: हर order/job पर: artwork GSM से अपेक्षित ink, असली खपत में से उसका हिस्सा, और अंतर।
- **Entry shift / Auto shift**: शिफ्ट event time से तय होती है। "No matching shift window" का मतलब समय किसी भी शिफ्ट में नहीं आता।
- **Returned mix base / color**: बची हुई मिक्स ink POLY या PET बेस और आपके दिए रंग-नाम के साथ नए ink master के रूप में वापस जाती है।
- **Count scope**: "Selected floor location" एक जगह गिनती है; "All floor locations in plant" दिख रही हर फ्लोर लोकेशन की गिनती एक साथ पोस्ट करता है।

**आम दिक्कतें और हल**
- "स्टोर और फ्लोर लोकेशन अलग प्लांट की हैं" — स्टोर और फ्लोर अलग प्लांट से चुने गए। दोनों एक ही प्लांट के चुनें।
- "केवल INK सामग्री चलती है" — चुनी सामग्री ink master नहीं है। ink चुनें।
- "इस समय की खिड़की पहले से पोस्ट है" — इस समय-खिड़की की गिनती पहले ही पोस्ट हो चुकी है, इसलिए उसमें पुरानी तारीख की मूवमेंट नहीं जा सकती। बाद का event time डालें।
- "मात्रा शून्य से ज़्यादा हो" — kg शून्य से ज़्यादा लिखें। प्लांट, फ्लोर, ink और मात्रा भरे बिना बटन चालू नहीं होते।
- "मिक्स ink का बेस और रंग चाहिए" — "Mix Return" में POLY या PET चुनें और रंग लिखें।
- "गिनती की लोकेशन इस प्लांट की नहीं" — प्लांट फिर से चुनें, फिर उसी सूची से फ्लोर लोकेशन चुनें।

**अटक गए तो**
1. रिफ्रेश बटन दबाएँ; "Ink control data refreshed." संदेश से पता चलता है कि नया डेटा आ गया।
2. अंतर गलत लगे तो देखें कि समय-खिड़की में शुरुआती और आखिरी गिनती दोनों हैं ("Opening count" / "Closing count")।
3. गलत issue को एडिट नहीं, उतनी ही "Return" करके ठीक करें।
4. किसी ink का पूरा स्टॉक इतिहास देखने के लिए "Open Stock Lifecycle" दबाएँ।

जुड़े पेज: /inventory/ink-floor, /inventory/stock-lifecycle, /master/inks, /factory/locations, /system/shift-timing

**अभी नहीं होता / ध्यान दें**
- Store और Floor सूची में प्लांट की हर लोकेशन आती है, केवल स्टोर या फ्लोर प्रकार नहीं, और ink issue machine रिलीज़ को नहीं रोकता ("No execution gate")।

### Production job (/production/jobs/[id])
स्क्रीन का पता: /production/jobs/[id] · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANNER, PLANT_MANAGER, WORK_CENTER_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=production-jobs-id&lang=hi

एक production job का केवल देखने वाला सार: स्थिति, योजना / बना / बाकी मात्रा, कहाँ चल रहा है और उसकी लेयर।

Activity feed, trace और audit से यहाँ लिंक आते हैं। इससे देखें कि job कहाँ है और उसके machine terminal, WC terminal, trace या plan queue पर जाएँ। इस पेज से कुछ पोस्ट नहीं होता।

**शुरू करने से पहले**
- job मौजूद हो और आपके रोल को production job देखने की अनुमति हो।

**स्टेप बाय स्टेप**
1. job को feed, trace या audit लिंक से खोलें।
2. हेडर पढ़ें: job नंबर, product और customer, स्थिति चिप, order नंबर और priority।
3. "Planned", "Produced" (योजना का %), "Remaining" और "Process" देखें।
4. "Where it runs" में work centre, machine, operator, batch और order line देखें।
5. machine स्क्रीन के लिए "Machine terminal" दबाएँ, या Completed trace में job देखने के लिए "Trace"।
6. उन स्क्रीन पर जाने के लिए "Work-centre terminal" या "Order in plan queue" दबाएँ।

**स्क्रीन पर क्या है**
- **Planned / Produced / Remaining**: job की इकाई (kg या pcs) में मात्रा। "Produced" के नीचे योजना का % दिखता है; कुल kg पता हो तो Planned के नीचे दिखता है।
- **Process**: इस job का step किस process का है (जैसे printing या lamination)।
- **Progress**: बना ÷ योजना, अधिकतम 100%।
- **Input → output**: लिया और दिया गया stock form, जैसे ROLL → ROLL या ROLL → BULK।
- **Specification**: लेयर की सूची: सामग्री, माइक्रोन और ग्रेड, साथ में ink रंग। job में लेयर न हों तो "No layer stack recorded"।

**आम दिक्कतें और हल**
- "Job not found" — "It may have been removed, or you may not have access to it." job id गलत है, archive हो गया, या आपके work centre से बाहर है।

**अटक गए तो**
1. पुराने लिंक की जगह plan queue या Completed trace से job फिर खोलें।
2. "Machine terminal" बटन तभी दिखता है जब machine लगी हो; WC terminal पर machine लगाएँ।

जुड़े पेज: /production/machine/[machine_id], /production/work-center/[id], /dashboard/planner/control-tower/completed-trace, /dashboard/planner/control-tower/plan-queue

**अभी नहीं होता / ध्यान दें**
- job सार केवल देखने के लिए है और operator इसे नहीं खोल सकते; यहाँ से job रोकना, बदलना या दोबारा लगाना संभव नहीं।

### अपनी machine चुनें (/production/machine-selector)
स्क्रीन का पता: /production/machine-selector · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, WORK_CENTER_MANAGER, OPERATOR · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=production-machine-selector&lang=hi

जिन machines पर आप काम कर सकते हैं वे कार्ड में दिखती हैं। किसी पर टैप करके उसका machine terminal खोलें।

यह operator का होम पेज है। Operator को केवल Users पेज पर उसे दी गई machines दिखती हैं; work-centre manager को अपने work centre की machines; Admin और Owner को हर active machine। अगर एक ही machine मिली हो तो पेज सीधे उसका terminal खोल देता है।

**शुरू करने से पहले**
- machine किसी work centre में बनी हो और ACTIVE हो (Factory › Machines)।
- Operator के लिए: System › Users पर machine दी गई हो। WCM के लिए: work centre दिया गया हो।

**स्टेप बाय स्टेप**
1. Floor मेनू में "Machine terminal" खोलें (operator साइन-इन के बाद यहीं आते हैं)।
2. "Search machine, code, work center, or plant..." में लिखें या state, work center और plant फ़िल्टर लगाएँ।
3. "Last Used" वाला कार्ड आपका पिछला terminal है और सबसे ऊपर आता है; फिर चल रहे job वाली machines।
4. कार्ड पढ़ें: "Active Execution" में job नंबर और product, या "Idle Terminal"; "Pending Jobs" में कतार की गिनती।
5. "Enter Terminal" दबाएँ (या कार्ड पर टैप करें, या उस पर Enter / Space)।
6. सभी फ़िल्टर हटाने के लिए "Clear" दबाएँ।

**स्क्रीन पर क्या है**
- **Active machines / Running now / Jobs waiting / Machine groups**: आपको दिख रही machines की गिनती: active, job चला रही, कुल कतार के jobs, और work centre की संख्या।
- **Status filter**: "All states", "Active", "Running job", "Idle"।
- **UID**: machine का कोड, वही जो उसके QR पोस्टर पर छपा है।
- **Pending Jobs · Queue**: इस machine पर रिलीज़ होकर इंतज़ार कर रहे jobs।

**आम दिक्कतें और हल**
- "No Machines Assigned" — "Assign a work center to this manager to unlock its machines." आपके खाते में कोई machine (operator) या work centre (WCM) नहीं दिया गया। Admin इसे System › Users पर ठीक करेगा।
- "Failed to load machines" — नेटवर्क या सर्वर की समस्या। "Retry" दबाएँ।
- "कोई machine नहीं मिली" — खोज या फ़िल्टर ने सब कार्ड छिपा दिए। "Clear" दबाएँ।

**अटक गए तो**
1. मेंटेनेंस के लिए DOWN machine सूची में नहीं आती; मेंटेनेंस से fault ठीक करवाएँ।
2. machine का QR पोस्टर फ़ोन से स्कैन करें, उसका कार्ड सीधे खुल जाएगा।
3. सूची हर 45 सेकंड में खुद रिफ्रेश होती है; नया assignment न दिखे तो पेज रीलोड करें।

जुड़े पेज: /production/machine/[machine_id], /production/work-center, /maintenance/qr, /system/users

**अभी नहीं होता / ध्यान दें**
- सर्वर केवल ACTIVE machines भेजता है, इसलिए "Active" फ़िल्टर से कुछ नहीं बदलता और DOWN machines बिल्कुल नहीं दिखतीं।
- Planner और plant manager को केवल उन्हें दिए work centres की machines दिखती हैं; कोई न दिया हो तो फ्लोर स्क्रीन खुली होने पर भी "No Machines Assigned" आता है।

### Machine Terminal (/production/machine/[machine_id])
स्क्रीन का पता: /production/machine/[machine_id] · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, WORK_CENTER_MANAGER, OPERATOR · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=production-machine-machine_id&lang=hi

एक machine के लिए operator की स्क्रीन: रिलीज़ job चुनें, "Start" करें, output लिखें (roll, pieces, trim और scrap), कारण के साथ "Pause" करें, और step "Complete" करें।

Job यहाँ तभी आता है जब work-centre manager उसे WC terminal पर roll और सामग्री issue करके इस machine पर रिलीज़ करता है। आप जो output लिखते हैं उससे order आगे बढ़ता है: अगला route step उस पर चल सकता है, pouches Packing Yard जाते हैं, rolls अगले step या dispatch पर जाते हैं।

**शुरू करने से पहले**
- WC terminal पर job इस machine पर रिलीज़ हो ("Release to machine"), और input rolls reserve हों।
- machine आपके खाते (operator) या आपके work centre (WCM) को दी गई हो।
- Scrap और downtime के कारण System › Reason codes में बने हों।

**स्टेप बाय स्टेप**
1. बाईं ओर "Queue" में job चुनें ("Search SO, customer, final output" से खोजें)।
2. "what is to be made" प्लेट और ऊपर की पट्टी "Target · लक्ष्य", "Done · बन गया", "Left · बाकी" देखें।
3. "Start" दबाएँ (रुकने के बाद "Resume")। input rolls reserve होने तक यह बंद रहता है।
4. "Output logging" में output लिखें: roll step में roll की पंक्तियाँ (Gross kg, Tare kg, Width mm, Length m), pouching में "Good output PCS", slitting में child rolls।
5. Trim और Scrap हो तो भरें। वेस्टेज सीमा से ऊपर हो तो कारण चुनें और लिखें क्यों हुआ।
6. "Log output" दबाएँ। "Can log now (max) · अभी अधिकतम" देखें — उससे ज़्यादा पर बटन बंद रहता है।
7. रोकने के लिए "Pause" दबाएँ, कारण का समूह और कोड चुनें, टिप्पणी लिखें, फिर "Pause machine · रोकें"।
8. step पूरा हो तो "Complete" दबाएँ। अगर output लक्ष्य से कम है तो बटन "Force complete" बनता है और कम से कम 5 अक्षर का कारण चाहिए।
9. आधे इस्तेमाल हुए roll के लिए "Rolls by lane" में "Return balance" या "Roll finished" दबाएँ।

**स्क्रीन पर क्या है**
- **Target · Produced · Remaining · Yield**: step के आँकड़े उसी इकाई में जिसमें operator गिनता है (pouching में pieces, roll step में kg)। "Target comes from · लक्ष्य कैसे बना" बताता है लक्ष्य कैसे बना।
- **Can log now (max) / Finish within**: अभी अधिकतम कितना लिख सकते हैं (लोड rolls और सबसे कम lane से तय) और step किस सीमा में पूरा करें।
- **Output goes to · माल कहाँ जाएगा**: output का स्टॉक कहाँ जाएगा (अगले step का WIP या finished goods लोकेशन)।
- **Roll rows: Gross / Tare / Net / Width / Length**: हर output roll की एक पंक्ति। Net = gross − core tare। कई पंक्तियाँ एक साथ बनाने के लिए "Fast roll output entry" और default core tare।
- **Good output PCS / Output KG**: pouching में pieces मुख्य हैं; kg यूनिट वज़न से निकलता है। template तय करता है कि PCS ज़रूरी है या नहीं।
- **Trim and scrap · optional**: एक, दोनों या कोई नहीं। कंपनी की वेस्टेज सीमा (Company profile, default 5%) के बराबर या ऊपर हो तो कारण और टिप्पणी ज़रूरी है।
- **Rolls by lane**: हर लेयर lane पर लोड rolls — running / queued / part-used — और लोड kg बनाम बाकी ज़रूरी kg।
- **Remainder location**: बिना कटा input बैलेंस remainder roll बनकर कहाँ लौटेगा।
- **Other logs**: "Log scrap", "Log downtime" (step अपने आप रोक सकता है), "Log material consumption" और "Quality readings"।
- **Machine history**: इस machine के बंद और force किए jobs, बनी मात्रा और अंतर के साथ; "Normal" / "Forced variance" फ़िल्टर।

**आम दिक्कतें और हल**
- "Output logged. Pieces per inner pouch is not set on this order…" — यह एरर नहीं है: आउटपुट सेव हो गया। ऑर्डर में pieces per inner pouch नहीं है, इसलिए मशीन पर inner pouch नहीं कटे; Packing Yard भरे गए inner packs की गिनती लिखता है और शाम की गिनती उन्हें बुक करती है। एडमिन से Masters → Packaging में inner pouch पर "Pouches per inner pouch (default)" भरवाएँ।
- "machine पर दूसरा job चल रहा है" — इस machine पर दूसरा order चल रहा है। पहले उसे Pause या Complete करें। केवल extrusion जैसी machines (या जिन पर "Several orders may run at the same time" सेट है) एक साथ कई चलाती हैं।
- "Machine assign नहीं है" — WCM ने job किसी machine पर रिलीज़ नहीं किया। WCM से "Release to machine" करवाएँ।
- "WCM ने job अभी नहीं भेजा" — WC terminal पर तैयारी पूरी नहीं हुई।
- "ज़रूरतें पूरी नहीं" — इस step के rolls या सामग्री कम हैं। WCM rolls reserve करे या issue पूरा करे।
- "वेस्टेज सीमा से ज़्यादा" — trim + scrap सीमा के बराबर या ऊपर है। "Trim and scrap" में कारण चुनें और टिप्पणी लिखें।
- "output सीमा से ज़्यादा" — लोड rolls जितना दे सकते हैं उससे ज़्यादा लिखा। वज़न जाँचें या lane पर अगला roll लोड करें।
- "lane का roll कम है" — सबसे कम lane इस output को पूरा नहीं कर सकती। WCM (या चलते समय आप) अगला roll जोड़ें।
- "job चालू होना चाहिए" — job रुका है या शुरू नहीं हुआ। पहले "Resume" या "Start" दबाएँ।
- "Output logged as loose pouches: this order has an inner pouch switched on but no packing material…" — यह एरर नहीं है: output loose pouches के रूप में सेव हो गया और कोई inner pouch नहीं कटा। planner या admin से order line पर inner pouch सेट करवाएँ; output दोबारा न लिखें।
- "पिछली बार के बाद नया output नहीं" — दोबारा complete करने से पहले output लिखें।

**अटक गए तो**
1. हेडर में "Stale Ns" दिखे तो स्क्रीन का सिंक छूट गया; यह हर 15 सेकंड में रिफ्रेश होती है, या पेज रीलोड करें।
2. पीला संदेश "Output logged · one thing left for the store" का मतलब output सेव हुआ, पर स्टॉक (जैसे in-house inner pouches) पूरा बुक नहीं हो सका; शाम की गिनती इसे ठीक करेगी।
3. machine खराब हो: "Machine breakdown" से pause करें या Maintenance में fault दर्ज करें; ठीक होने तक machine DOWN रहती है।
4. job पर गलत roll: WCM से कहें; बिना छुआ roll हटाया जा सकता है, आधा इस्तेमाल हुआ केवल "Return balance" से।

जुड़े पेज: /production/machine-selector, /production/work-center/[id], /logistics/packing, /maintenance/faults, /system/reason-codes

**अभी नहीं होता / ध्यान दें**
- "Force complete" के लिए कम से कम 5 अक्षर का कारण चाहिए, पर पेज यह न्यूनतम लंबाई नहीं बताता।
- स्टॉक ऑर्डर में कहीं भी pieces per inner pouch न हो तो मशीन आउटपुट दर्ज कर लेती है पर inner pouch नहीं काटती; inner pouch पर default भरने तक शाम की गिनती में उनका इस्तेमाल किसी ऑर्डर पर नहीं जाता।

### अपना machine group चुनें (WC terminal) (/production/work-center)
स्क्रीन का पता: /production/work-center · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, WORK_CENTER_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=production-work-center&lang=hi

आपके work centres की सूची। किसी एक को खोलकर उसका WC terminal खोलें।

यह work-centre manager का होम है। WCM को केवल उसे दिए गए work centres दिखते हैं; Admin, Owner, Planner और Plant manager को सभी। पिछली बार खोला गया याद रहता है।

**शुरू करने से पहले**
- work centre बना हो (Factory › Work Centers) और user को दिया गया हो (System › Users)।

**स्टेप बाय स्टेप**
1. Floor मेनू में "WC terminal" खोलें।
2. ऊपर का कार्ड "Resume last WCM terminal" (या "Open first available WCM terminal") दबाएँ।
3. या "Search work center by name or code..." में खोजें और कार्ड पर "Open terminal" दबाएँ।
4. terminal /production/work-center/<id> पर खुलता है; जो कार्ड खोला वह अगली बार "Last Used" दिखेगा।

**स्क्रीन पर क्या है**
- **Last Used**: इस ब्राउज़र पर पिछली बार खोला गया work centre।
- **Station Protocol**: work centre का कोड।

**आम दिक्कतें और हल**
- "कोई work centre नहीं मिला" — खोज ने सब छिपा दिया, या आपको कोई work centre नहीं दिया गया। खोज हटाएँ; फिर भी खाली हो तो admin से System › Users पर assign करवाएँ।

**अटक गए तो**
1. "Accessing Station Topology..." पर अटके तो पेज रीलोड करें।

जुड़े पेज: /production/work-center/[id], /production/machine-selector, /dashboard/work-center

**अभी नहीं होता / ध्यान दें**
- कोई work centre न दिया हो तो पेज यह नहीं बताता, बल्कि "No work center matched the current search query." दिखाता है।

### Work Center Terminal (/production/work-center/[id])
स्क्रीन का पता: /production/work-center/[id] · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, WORK_CENTER_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=production-work-center-id&lang=hi

work-centre manager की स्क्रीन: इस work centre पर order lines की कतार देखें, machine चुनें, rolls assign करें, granule के grade code दें, और job को machine पर रिलीज़ करें। साथ ही close short, cancel और history।

planner के route पर रिलीज़ करने के बाद lines यहाँ आती हैं। सब गेट साफ़ होने पर WCM "Release to machine" दबाता है; तब job उस machine terminal पर operator को दिखता है। चलते समय WCM अगला roll जोड़ सकता है, बैलेंस वापस कर सकता है या roll खत्म कर सकता है।

**शुरू करने से पहले**
- planner ने line को ऐसे route पर रिलीज़ किया हो जो इस work centre से गुज़रता है।
- इस work centre की machines बनी और ACTIVE हों।
- इस प्लांट में rolls और कोड वाला granule स्टॉक हो (या दूसरे प्लांट से transfer)।
- print step के लिए: artwork और cylinders लगे हों।

**स्टेप बाय स्टेप**
1. queue पैनल में job चुनें। "Queue", "Running / ready", "Stalled", "History" टैब, खोज और फ़िल्टर इस्तेमाल करें।
2. "Order · what it is" पढ़ें: ordered, produced, remaining, "what is to be made" प्लेट और step के आँकड़े।
3. "Machine" में वह machine टैप करें जो चलाएगी ("Idle · ready", "Running …", "Down · not available")।
4. "Rolls by lane" में roll picker खोलें: roll ID स्कैन करें या लिखें, या सूची से चुनें। "EXACT MATCH" वैसे ही चलता है; "WIDER · SLIT REQUIRED" slit होता है; 20 mm से ज़्यादा पतले roll मना हैं।
5. "Input issue" में हर granule खोलें और उसके grade code दें ("Add grade codes"); बाकी हर सामग्री "Auto · step mapping" दिखाती है, उसमें कुछ नहीं करना।
6. release checklist देखें: Rolls allocated, Machine assigned, Cylinders & artwork, issue पूरा।
7. release bar में "Release to machine" दबाएँ (या machine extrusion जैसे job में व्यस्त हो तो "Queue on machine")।
8. चलते समय lanes में "Add next roll", "Return balance" या "Roll finished" इस्तेमाल करें।
9. ⋯ "More job actions" से "Short close step", "Cancel job" या "Recalculate from masters"।

**स्क्रीन पर क्या है**
- **Running / ready · Waiting · Queue · No machine**: हेडर की गिनती वाली चिप; टैप करने से view बदलता है। "No machine" lines को पहले machine चाहिए।
- **M R I C gates**: हर queue row पर: M = machine लगी, R = rolls allocated (bulk input में नहीं), I = issue दर्ज, C = cylinders/artwork तैयार (print step न हो तो नहीं)।
- **Queue status chips**: "All", "WC Ready", "Assigned", "No machine"।
- **Sort**: Priority ऊँची/नीची पहले, SO date पुरानी पहले, Customer (A→Z), Machine (A→Z)।
- **Rolls by lane**: हर लेयर lane, लोड kg बनाम बाकी ज़रूरी kg। "No roll yet: …" खाली lanes बताता है; "Still short for the full order: …" केवल सूचना है, रोक नहीं।
- **Roll match labels**: EXACT MATCH, WIDER · SLIT REQUIRED, TRUE WIP, PURCHASED FALLBACK, COMPATIBLE FALLBACK। सामग्री, gauge, चौड़ाई, stock form और grade सब मिलने चाहिए।
- **Planned web**: slitting से पहले, कई lane वाली line अपना planned parent web चलाती है (lanes × child + trim)। उससे ±20 mm के भीतर के rolls वैसे ही चलते हैं।
- **Issue policy · template rules**: शुरू में बंद। "Override" एक row बदलता है ("Fixed extra kg" या "Minimum issue kg") और "Reason for override" चाहिए; "Use template" वापस लाता है।
- **Granule grade codes**: कोड टैप करें तो बैलेंस उसी से लिया जाता है (उसके free stock तक), या हिस्से का kg दें; एक granule कई कोड में बँट सकता है। हर issued kg को कोड मिलने तक रिलीज़ रुकी रहती है।
- **History**: "WCM audit and production history": status, Material issue, Short close; Today / Last 7 days / Last 30 days / All history; नए 300 दिखते हैं।

**आम दिक्कतें और हल**
- "roll की चौड़ाई सीमा से बाहर" — roll बहुत चौड़ा या पतला है। ±20 mm वाला roll, slit के लिए चौड़ा roll चुनें, या कारण के साथ "Policy override"।
- "grade code का जोड़ गलत" — दिए कोड का जोड़ issued kg के बराबर नहीं। जोड़ बराबर होने तक कोड जोड़ें या बदलें।
- "कोड दूसरे प्लांट में है" — "Start transfer" करें, फिर इस प्लांट पर "Confirm received"।
- "रिलीज़ नहीं हो सकता" — कोई roll lane, issue या कोड अधूरा है। release bar में बताया गेट साफ़ करें।
- "Machine busy" — चुनी machine दूसरा order चला रही है और extrusion जैसी नहीं है। खाली machine चुनें या इंतज़ार करें।
- "तैयारी लॉक है" — रिलीज़ के बाद बदलाव केवल machine terminal पर (या roll जोड़ने/लौटाने से) होते हैं।
- "Recalculate नहीं हो सकता" — "Recalculate from masters" केवल तब, जब कोई output दर्ज न हुआ हो।
- "कारण ज़रूरी" — Short close और cancel के लिए reason master से कारण चाहिए।

**अटक गए तो**
1. "Failed to load work-center queue" दिखे तो रीलोड करें; "Access denied" मतलब यह work centre आपको नहीं दिया गया।
2. "No roll satisfies the current-step contract": प्लांट, चौड़ाई, grade और quarantine देखें; delivery challan से rolls लाने के लिए "View Other Plants & Request Transfer"।
3. देर से अटका job "Stalled" में दिखता है; उसे खोलें और हेडर में बताई रुकावट हटाएँ।
4. कतार हर 30 सेकंड में रिफ्रेश होती है ("Auto-refresh 30 s")।

जुड़े पेज: /production/work-center, /production/machine/[machine_id], /dashboard/planner/control-tower/plan-queue, /inventory/rolls, /inventory/traceability, /production/planner/gang-builder

**अभी नहीं होता / ध्यान दें**
- History में केवल नए 300 jobs दिखते हैं; पुराने के लिए खोज या छोटी तारीख़ चाहिए।
