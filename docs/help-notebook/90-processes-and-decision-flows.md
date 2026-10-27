# Processes and decision flows / प्रक्रियाएँ और निर्णय फ़्लो
## Processes (who does what, on which screen)

### Sales order from placing to dispatch
How a customer order moves from the composer through planning, the floor and the yard to a dispatched slip and a completed order.

1. **Pick customer and order facts** — SALES on /sales/orders/create. Answer "Who is this order for?", set Ship to, Promised dispatch, Job name, Ship address and Note for dispatch.
2. **Build the lines** — SALES on /sales/orders/create. Quick-add or open the line editor: size, layers, qty & rate, print & artwork, packing.
3. **Place order** — SALES on /sales/orders/create. Clear "Before you place" and press "Place order" (⌘↵). The order enters the planning queue.
4. **Plan and release** — PLANNER on /dashboard/planner/control-tower/plan-queue. Planner picks the plant, claims stock and releases each line to the route.
5. **Make on the floor** — WORK_CENTER_MANAGER on /production/work-center. Work centres release jobs to machines; operators log outputs.
6. **Pack and release** — DISPATCH on /logistics/packing. Rolls are released; pouches packed in gonnies with inner pouches, sealed and released. Other packing items are ticked.
7. **Dispatch slip and proof of delivery** — DISPATCH on /logistics/dispatch. One slip per order line, mark dispatched, then record proof of delivery.
8. **Track and close** — SALES on /sales/orders/[id]. The tracker shows ready, dispatched and open kg; the order completes when proof of delivery (POD) is confirmed for every line, not when it is dispatched.

### Quotation to sales order
Price an enquiry, get approval, send the frozen PDF, record the customer's answer and convert.

1. **Start quotation** — SALES on /sales/quotations/new. Pick the customer and press "Start quotation".
2. **Lines and Cost Build** — SALES on /sales/quotations/[id]. Add Catalog or Ad-hoc pouch lines, save, then "Save Cost Build".
3. **Submit for approval** — SALES on /sales/quotations/[id]. The revision and Cost Build freeze.
4. **Approve** — OWNER on /sales/quotations/[id]. A different authorised user approves each pending gate or rejects with a reason.
5. **Send to customer** — SALES on /sales/quotations/[id]. "Send frozen revision" emails the PDF with delivery evidence.
6. **Record outcome** — SALES on /sales/quotations/[id]. "Record acceptance" with PO/email reference, or "Record rejection" with reason.
7. **Convert to Sales Order** — SALES on /sales/orders/[id]. Accepted quote becomes CONVERTED and a new SO goes to planning.

### Cancelling a sales order
Sales cancels before release; after release the planner cancels or short-closes.

1. **Find the order** — SALES on /sales/orders. Search the SO number; the cancel icon shows only for Draft, Confirmed, Planning or Planned.
2. **Choose scope and reason** — SALES on /sales/orders. "Full order" or selected lines; reason and note are required.
3. **Released lines** — PLANNER on /dashboard/planner/control-tower/command. Planner cancels or short-closes released lines with a reason.
4. **Goods already made** — DISPATCH on /logistics/dispatch. Ship after ticking "Send goods of closed lines", or "Move to stock" with a reason.

### Trade order from stock
Resell granules, film or trading goods without production.

1. **Create** — SALES on /sales/trade-orders/new. Pick customer and dispatch stock plant, add lines from available stock.
2. **Confirm** — SALES on /sales/trade-orders/[id]. "Confirm order" (or "Save & confirm").
3. **Dispatch** — SALES on /sales/trade-orders/[id]. "Dispatch" → "Yes, dispatch" consumes stock at the plant; cannot be undone.

### Sales line from planning to release
How a confirmed order line is checked, sourced and released to the floor from the Control Tower.

1. **Confirm the order** — SALES on /dashboard/sales. Drafts to confirm are listed on the Sales dashboard; only confirmed orders reach the planner.
2. **Spot the risk** — PLANNER on /dashboard/planner/control-tower/command. Top 5 at-risk orders and the action desk show what to do first.
3. **Check gates** — PLANNER on /dashboard/planner/control-tower/plan-queue. Open the line; read S M A R gates and the release checklist.
4. **Approve artwork if missing** — ADMIN on /engineering/artworks. Only APPROVED artwork can be assigned.
5. **Assign artwork** — PLANNER on /dashboard/planner/control-tower/plan-queue. Press "Assign artwork" and pick the approved design.
6. **Choose source and release** — PLANNER on /dashboard/planner/control-tower/plan-queue. FG match, Carry WIP, Invariant, Input stock or Fresh run; pick work centers; press "Plan & Release".
7. **Run the jobs** — WORK_CENTER_MANAGER on /production/work-center. WC terminal picks rolls (±20 mm of planned web), issues input and releases jobs to machines.
8. **Follow on the floor** — PLANNER on /dashboard/planner/control-tower/live-production. Machines now, replan and blockers.
9. **Review the close** — PLANNER on /dashboard/planner/control-tower/completed-trace. Cycle time, on-time and trace gaps.

### Make-to-stock from a shortage
Find short templates, launch a stock order, and let sales lines claim the stock.

1. **Find the shortage** — PLANNER on /dashboard/planner/control-tower/stock-intelligence. Templates marked SHORT or TIGHT with kg short.
2. **Quick launch** — PLANNER on /dashboard/planner/control-tower/stock-intelligence. "Build & release" with quantity in KG; first job released at once.
3. **Full launch** — PLANNER on /dashboard/planner/control-tower/stock-launcher. Pick master, commitment, route stop, size, layers and quantity; "Validate pool"; create.
4. **Produce** — WORK_CENTER_MANAGER on /production/work-center. Runs like any order; no artwork gate.
5. **Claim for a sales line** — PLANNER on /dashboard/planner/control-tower/plan-queue. A line with the same spec shows FG match or Carry WIP in "Choose source & release".

### Combine orders on one jumbo
Group released roll-output jobs of one Product Master and slit them at the WC terminal.

1. **Release the lines** — PLANNER on /dashboard/planner/control-tower/plan-queue. Each line needs a target roll width.
2. **Pick a group and tick orders** — PLANNER on /dashboard/planner/control-tower/gang-builder. Same PM, recipe, step; 2 or more orders.
3. **Combine** — PLANNER on /dashboard/planner/control-tower/gang-builder. Press "Combine"; a batch id is created.
4. **Slit at the machine** — WORK_CENTER_MANAGER on /production/work-center. Roll picker makes one slit child per job.

### Short-close or cancel a line
Stop a sales line from the planner side and handle what was already made.

1. **Open the line** — PLANNER on /dashboard/planner/control-tower/plan-queue. Or from Live Production for released lines.
2. **Choose the action** — PLANNER on /dashboard/planner/control-tower/live-production. Cancel only before machine activity; otherwise Short close.
3. **Give a reason** — PLANNER on /dashboard/planner/control-tower/plan-queue. At least 5 characters; kept in the audit trail.
4. **Ship or move goods** — DISPATCH on /logistics/dispatch. Tick "Send goods of closed lines" to ship, or "Move to stock" with a reason.

### From WC release to machine output
How a released order line is prepared on the WC terminal, run on the machine and handed to the next step.

1. **Planner releases the line** — PLANNER on /dashboard/planner/control-tower/plan-queue. Spec, Material, Artwork and Route gates clear; jobs are created for the route steps.
2. **WCM opens the job** — WORK_CENTER_MANAGER on /production/work-center/[id]. Pick the line in the queue and read the order plate and step figures.
3. **Pick machine and rolls** — WORK_CENTER_MANAGER on /production/work-center/[id]. Tap an idle machine; assign rolls within ±20 mm of the planned web or wider rolls to slit.
4. **Give granule grade codes** — WORK_CENTER_MANAGER on /production/work-center/[id]. Only rolls and granule codes are entered; other materials go by step mapping.
5. **Release to machine** — WORK_CENTER_MANAGER on /production/work-center/[id]. When M, R, I and C gates are clear press Release to machine.
6. **Operator starts** — OPERATOR on /production/machine/[machine_id]. Pick the job in the Queue and press Start.
7. **Log output** — OPERATOR on /production/machine/[machine_id]. Enter rolls or pieces, trim and scrap; a reason is needed at or above the wastage limit.
8. **Complete the step** — OPERATOR on /production/machine/[machine_id]. Press Complete, or Force complete with a reason if short; the next step runs on the logged output.
9. **Goods move on** — DISPATCH on /logistics/packing. Pouches are packed in the Packing Yard; rolls are released to dispatch.

### Ink issue, count and reconcile
Ink is issued to the floor, counted by time and reconciled against artwork GSM theory.

1. **Issue ink to floor** — WORK_CENTER_MANAGER on /production/ink-control. Shift Desk, mode Issue: pick ink, kg, event time, Issue ink.
2. **Return leftovers** — WORK_CENTER_MANAGER on /production/ink-control. Return ink, or Return as mix with POLY/PET base and colour.
3. **Count the floor** — WORK_CENTER_MANAGER on /production/ink-control. Ink stock count snapshot: counted kg per ink, Post count.
4. **Reconcile** — PLANNER on /production/ink-control. Reconcile tab: actual vs theory per order/job for the window.

### Set up the factory
Masters to create before production can run.

1. **Create the plant** — ADMIN on /factory/plants. Code, name, legal profile, default cost group.
2. **Create locations** — ADMIN on /factory/locations. Store, WIP, finished goods, dispatch and floor locations.
3. **Define processes** — ADMIN on /factory/processes. Input/output form, roll behaviour (fixed after creation), stock forms.
4. **Create work centres** — ADMIN on /factory/work-centers. Group machines by process under the plant.
5. **Create machines** — ADMIN on /factory/machines. Unique code, work centre, orders-at-once policy, QR poster.
6. **Assign people** — ADMIN on /system/users. Work centres to WCMs, machines to operators.

### Inward bill to receipt or filing
Every bill photographed at the gate or uploaded at the office is classified and finished by a GRN, job-work receipt, General Receipt or filing.

1. **Photograph the bill** — WATCHMAN on /gate. The watchman photographs the bill when goods arrive; office staff can use "Upload bill" instead.
2. **Pick it from the Inbox** — STORE on /inventory/gate-bills. Open the bill under "Needs classifying".
3. **Classify and save details** — STORE on /inventory/gate-bills/[id]. Choose Document type and Category, type vendor, bill number, date and amounts, press "Save details".
4. **Post GRN for stock** — STORE on /inventory/grn. Stock items: "Open GRN" and post; stock goes up and the receipt links to the bill.
5. **General Receipt for non-stock** — STORE on /inventory/general-receipts/new. Spares, machinery or service: "Create general receipt"; no stock moves.
6. **File record-only paper** — STORE on /inventory/gate-bills/[id]. Utility, fee, other expense: "File as record"; transport LR: "Attach to the stock bill".
7. **Confirm all lines received** — STORE on /inventory/gate-bills/[id]. When a bill is "Partly received" and all lines are in, "Confirm all lines received".

### Returnable gate pass (RGP) cycle
A part or tool leaves on a numbered RGP, is scanned out at the gate, and the pass closes when every item returns or it is short-closed.

1. **Raise the pass** — STORE on /inventory/gate-passes/new. Choose Returnable (RGP), purpose, party, expected back date and items; "Save and issue".
2. **Print and hand over** — STORE on /inventory/gate-passes/[id]. "Print PDF" and send it with the items (or stick the QR label on another paper).
3. **Scan out at the gate** — WATCHMAN on /gate. The watchman scans the QR; status becomes "Out of factory".
4. **Watch overdue** — STORE on /inventory/goods-movements. Outside and Late in Goods in & out, or the Overdue tab of Gate passes.
5. **Record the return** — STORE on /inventory/general-receipts/new. With a vendor bill: General Receipt with "Came back on a returnable gate pass (RGP)"; without a bill: "Receive back" on the pass.
6. **Close or short-close** — STORE on /inventory/gate-passes/[id]. The pass closes when everything is back; otherwise "Short-close" with a reason.

### Stock adjustment with a second person
A stock difference is drafted by one person and posted by another; posting writes stock and ledger, voiding reverses it.

1. **Find the difference** — STORE on /inventory/alerts. An alert, a count or a floor check shows stock does not match.
2. **Draft the adjustment** — STORE on /inventory/adjustments/new. Plant, reason, lines with + or − delta in the stock unit; "Save Draft".
3. **Second person posts** — STORE on /inventory/adjustments/[id]. Another user with the adjust right (or Owner/Admin) presses "Post" → "Post adjustment".
4. **Check the ledger** — STORE on /inventory/bulk-transactions. The ADJUST row appears in Bulk Transactions / ledger.
5. **Void if wrong** — OWNER on /inventory/adjustments/[id]. "Void" posts inverse lines; refused if the stock was used since.

### Inventory alert triage
The nightly stock check raises alerts; the store fixes the cause and resolves them with a note.

1. **Nightly check raises alerts** — ADMIN on /analytics/inventory-health. The reconciliation runs every night (or "Run audit" on Inventory health) and keeps one open alert per problem.
2. **Review open alerts** — STORE on /inventory/alerts. Filter "Open", start with Critical and High.
3. **Fix the cause** — STORE on /inventory/stock-lifecycle. Count the stock or draft an adjustment for the gap.
4. **Resolve with a note** — STORE on /inventory/alerts. "Resolve" → "Resolution note" → "Mark resolved"; mismatch alerts also close themselves the next night.

### Supplier goods receipt (GRN)
From the gate photo of a supplier bill to stock on the roll / bulk / packaging views, with corrections in GRN history.

1. **Gate photo** — WATCHMAN on /gate. Photograph the bill when the truck arrives.
2. **Classify bill** — STORE on /inventory/gate-bills. Classify the bill as stock and open Receive.
3. **Post Smart GRN** — STORE on /inventory/grn. Pick class and source, enter the lines, press Submit & post.
4. **Check stock** — STORE on /inventory/rolls. Check the new rolls are Available; print labels if wanted.
5. **Correct if needed** — STORE on /inventory/grn-history. Fix a wrong quantity, rate or roll spec with Correct and a reason.

### Job work cycle
Send material to an outside job worker on a Rule 45 challan, receive it back with a material balance, link the bill and close.

1. **Create order** — PLANNER on /inventory/job-work. Create the order: planned route step or emergency handoff, job worker, expected output, rate, return date.
2. **Send on challan** — STORE on /inventory/job-work/[id]. Send material: pick rolls / bulk, HSN, vehicle; issue and print the challan.
3. **Gate scan** — WATCHMAN on /gate. Scan the challan QR as the truck leaves.
4. **Receive return** — STORE on /inventory/job-work/[id]. Receive: settle each sent roll, enter output and wastage, match the balance, link the bill.
5. **Continue production** — STORE on /inventory/job-work/[id]. Optionally continue production with a part return.
6. **Close order** — STORE on /inventory/job-work/[id]. Close when nothing is left, or close short with a reason.

### Inter-plant transfer
Move rolls or bulk between plants on a delivery challan through IN_TRANSIT.

1. **Create challan** — STORE on /inventory/inter-plant. New Transfer: plants, material type, lines; create draft or dispatch now.
2. **Print** — STORE on /inventory/inter-plant/print/[id]. Print the challan PDF and QR gate sticker.
3. **Gate scan** — WATCHMAN on /gate. Scan the QR at departure.
4. **Receive** — STORE on /inventory/inter-plant. At the destination: Receive into a target location, Confirm Receipt.

### Evening packing count
Packing items ticked at release, and bought inner pouches, are taken off stock by the evening count and shared to the orders that used them.

1. **Tick at release** — DISPATCH on /logistics/packing. Pack and release; tick the packing items used on each unit (inner pouches are never ticked: in-house ones were taken at the machine, bought ones are booked by this count).
2. **Count and post** — STORE on /inventory/stock-lifecycle. Stock count → Evening packing count: pick location; rows start at the book quantity, so change only the counts that differ; Post count (posts at once, no approval).
3. **Review audit** — OWNER on /logistics/packing/audit. Check book → counted → used and each order line's share.
4. **Restock** — STORE on /inventory/packaging. Check packaging stock and reorder low items through Smart GRN.

### Stock count, month end and year end
Count stock on any day, take month-end proof, clear blockers and close the financial year.

1. **Open year** — OWNER on /inventory/stock-lifecycle. Open the financial year (Open FY) and post opening stock.
2. **Count** — STORE on /inventory/stock-lifecycle. Stock count: enter counted quantities with reasons, Post physical count.
3. **Month end** — PLANT_MANAGER on /inventory/stock-lifecycle. Month end: lock the month, take the snapshot, view month proof.
4. **Clear blockers** — STORE on /inventory/inter-plant. Clear blockers: receive in-transit challans, close job work, finish draft sheets.
5. **Close year** — OWNER on /inventory/stock-lifecycle. Year end: Close Financial Year; next year's opening is generated and the year archived.

### Outward document matching
Every truck leaving is photographed at the gate and matched by the office to the ERP documents it carried.

1. **Record departure** — WATCHMAN on /gate. Scan QR papers and photograph the pages as the truck leaves.
2. **Open queue** — STORE on /inventory/outward-documents. Open Pending match, oldest first.
3. **Link documents** — STORE on /inventory/outward-documents/[id]. Link the ERP documents (search or QR), or add a paper not in the ERP.
4. **Finish** — STORE on /inventory/outward-documents/[id]. Mark matched or save a discrepancy.

### Pack pouches into gonnies and release
From a machine batch to sealed gonnies in Dispatch Bay, with packing items ticked for the evening count.

1. **Log output at the machine** — OPERATOR on /production/machine-selector. The pouching machine logs the batch for the order line; for an inner-pack order, in-house inner pouches are taken off stock here (bought ones are marked for the evening count).
2. **Pick lines in the yard** — DISPATCH on /logistics/packing. Tick ready lines and press "Pack selected".
3. **Confirm figures** — DISPATCH on /logistics/packing. Tick "Figures checked"; the order decides inner packs or loose.
4. **Build and weigh gonnies** — DISPATCH on /logistics/packing. Enter packs/pouches, gonny type and scale gross; seal. Over 2 % needs a reason.
5. **Tick packing items** — DISPATCH on /logistics/packing. Tick gonny, box, tape, label… used. No quantities.
6. **Release to Dispatch Bay** — DISPATCH on /logistics/packing. Release sealed gonnies; each line becomes its own slip in Dispatch Bay.
7. **Accept a held check (if any)** — WORK_CENTER_MANAGER on /logistics/packing. A supervisor accepts a batch held at the packing check with a reason.

### Release rolls to dispatch
Finished rolls released packed (sheet / wrap, with ticks) or unpacked.

1. **Roll logged at the machine** — OPERATOR on /production/machine-selector. The last step logs each finished roll with its label weights.
2. **Open the roll line** — DISPATCH on /logistics/packing. Press "Release" or "Pack & release" on the line.
3. **Choose rolls and mode** — DISPATCH on /logistics/packing. Tick rolls; choose "Packed roll · sheet / wrap" or "Release unpacked roll".
4. **Tick items and release** — DISPATCH on /logistics/packing. Packed mode needs at least one tick. Each roll is one dispatch unit.

### Load, slip, dispatch and POD
Released units leave the factory on one slip per order line and close with proof of delivery.

1. **Load the tray** — DISPATCH on /logistics/dispatch. Tick lines or units on "Ready to dispatch".
2. **Transport and delivery** — DISPATCH on /logistics/dispatch. Transporter required; vehicle optional; delivery location per order.
3. **Create slips** — DISPATCH on /logistics/dispatch. "Create N slips": one per order line, all or none.
4. **Print and mark dispatched** — DISPATCH on /logistics/dispatch. Print on the Epson 10 × 6 in form (or A4 PDF), stick the QR sticker, "Mark dispatched · close".
5. **Record at the gate** — WATCHMAN on /gate/outward. Watchman scans the QR, photographs the papers, notes the vehicle.
6. **Confirm POD** — DISPATCH on /logistics/dispatch. In "Awaiting POD" press "Confirm POD"; the order may close.

### Goods of a closed line: ship or move to stock
Goods made for a short-closed, completed or cancelled line either ship with a confirmation or go to free stock with a reason.

1. **Line closes** — SALES on /sales/orders. Sales short-closes, completes or cancels the line or order while goods are in the yard.
2. **See the closed mark** — DISPATCH on /logistics/dispatch. Packing Yard and Dispatch Bay mark the line ("Order completed" / "Line short-closed").
3. **Ship: tick the confirmation** — DISPATCH on /logistics/dispatch. Load and tick "Send goods of closed lines" before Create and dispatch.
4. **Or move to stock** — DISPATCH on /logistics/packing. "Move to stock": pick units, give a reason (3+ characters).
5. **Planner claims it** — PLANNER on /dashboard/planner. "Use finished stock" offers them to any order with the same specification.

### Inward bill at the gate
Supplier goods recorded by bill photo, then received by the store against a GRN.

1. **Photograph the bill** — WATCHMAN on /gate/inward-bills. 1–6 pages, "Record arrival".
2. **Store is alerted** — STORE on /inventory/gate-bills. Store reviews the photos in Bills & documents.
3. **Match or create GRN** — STORE on /inventory/gate-bills. Confirm every line or resolve with a reason.

### Outward papers and our papers coming back
Departures are recorded with QR and photos; returning inter-plant, job-work and gate-pass papers are scanned back in.

1. **Print QR sticker** — DISPATCH on /logistics/dispatch. Stick it on the slip or Tally bill.
2. **Record outward** — WATCHMAN on /gate/outward. Scan QR codes, photograph papers, vehicle, "Record outward".
3. **Office matches** — OWNER on /gate/history. Departures without a QR are matched from the photos.
4. **Paper comes back** — WATCHMAN on /gate/arrivals. Scan the QR on the challan or gate pass, "Record back at the gate".
5. **Store receives** — STORE on /inventory/gate-passes. Store records the receipt or return.

### Visitor entry and exit
Visitors self-register by QR; the watchman checks them out.

1. **Poster at the gate** — OWNER on /gate/qr. Print and fix the plant's visitor QR poster.
2. **Visitor registers** — WATCHMAN on /visit/[token]. Visitor fills the form and taps "Record my entry"; entry is recorded.
3. **Shows inside** — WATCHMAN on /gate/visitors. The visitor appears under "Inside now".
4. **Check out** — WATCHMAN on /gate/visitors. On leaving press "Check out".
5. **Owner review** — OWNER on /gate/history. Visitor history with photos; overdue >12 h flagged.

### Set up a new Product Master
From films and pouch style to an active master that sales can order.

1. **Check films** — ADMIN on /master/film-variants. The film variant for each layer exists under its family; extruded films have a recipe.
2. **Approve the pouch style** — ADMIN on /master/pouch-styles/[id]. Build the formula, check the live preview, press "Save + approve + lock".
3. **Create the master** — ADMIN on /master/products. "New Product Master": kind, code, name, live route, layers → "Create & open workspace".
4. **Fill the editor** — ADMIN on /master/products/[id]/edit. Layers, Printing, Adhesive, sales permissions, add-ons and packing.
5. **Add sizes** — ADMIN on /master/products/[id]/edit. "Add size" or "Excel sheet" → "Bulk upload" → "Confirm import".
6. **Save and activate** — ADMIN on /master/products/[id]/edit. Pass the checklist, "Save master" with "Master active" on.
7. **Sales orders it** — SALES on /sales/orders/create. The master now shows in the order composer.

### Add a packing item
Create a packaging item so the yard can use it and the evening count can book it.

1. **Create the item** — ADMIN on /master/packaging. "Add Packaging", choose the kind on purpose (no default), supply mode, UOM.
2. **Enter piece weight** — ADMIN on /master/packaging. Bought inner pouches and gonnies need the kg of one piece.
3. **Link in-house items** — ADMIN on /master/packaging. "Link to Product Master" for in-house inner pouch or sheet.
4. **Tick at release** — DISPATCH on /logistics/packing. Every active item except inner pouch is in the release tick list.
5. **Evening count** — STORE on /logistics/packing/audit. The counted use is shared over the orders that ticked it, in whole pieces; if no one ticked it, over that day's orders whose packing plan includes it.

### Revise an extrusion recipe
Publish new granule percentages without disturbing released jobs.

1. **Open the recipe** — ADMIN on /master/recipes. Edit the row; identity (variant, grade, thickness) is locked.
2. **Change percentages** — ADMIN on /master/recipes. Total must be 100.00%; use "Balance to 100%".
3. **Publish** — ADMIN on /master/recipes. Write a revision reason, press "Publish revision vN".
4. **Check impact** — PLANNER on /dashboard/planner/control-tower/plan-queue. Open BOMs and queues refresh; "Needs review" lines need a look.

### Artwork to approved print
Upload a design, prepare cylinders for ROTO, and approve it for production.

1. **Upload artwork** — ADMIN on /engineering/artworks. "Upload Artwork": code, name, files, print type, film type, colours, ink GSM, "Save Draft".
2. **Generate cylinders (ROTO)** — ADMIN on /engineering/artworks. Enter repeat and length; press "Generate FRONT n" per colour.
3. **Finalize or reuse cylinders** — ADMIN on /engineering/cylinders. "Manage Slots": vendor, location, "Finalize this cylinder", or reuse with "Use".
4. **Approve artwork** — ADMIN on /engineering/artworks. When "Approval Blockers" is empty press "Approve".
5. **Use in product and order** — SALES on /master/products. Approved artwork is chosen on the product/order line.

### Route and template to LIVE
Build a route, build a template on it, review, approve and publish LIVE so sales and planner can use it.

1. **Create route** — ADMIN on /engineering/routing. "New Route", add steps, mark parallel steps, "Save Routing Rule".
2. **Create template** — ADMIN on /engineering/templates. "New Template" → "Create & Open Studio".
3. **Bind route and sync** — ADMIN on /engineering/templates/[id]. Choose routing rule, "Save basics", "Sync route stages".
4. **Batch, dispatch and materials** — ADMIN on /engineering/templates/[id]. Save template execution, dispatch setup per stage, material mapping.
5. **Send for review** — ADMIN on /engineering/templates/[id]. "Send for review" moves it to ENGINEERING.
6. **Approve** — PLANT_MANAGER on /engineering/approvals. "Approve" in the review queue or studio.
7. **Publish LIVE** — ADMIN on /engineering/templates/[id]. "Publish LIVE"; now selectable in Product Master, sales and planner.
8. **Planner releases** — PLANNER on /dashboard/planner/control-tower/plan-queue. Release uses the template's dispatch and batch rules.

### Correcting a LIVE template
Change a live template safely without touching existing orders.

1. **Edit safely** — ADMIN on /engineering/templates/[id]. Press "Edit safely"; a correction draft opens.
2. **Make changes** — ADMIN on /engineering/templates/[id]. Edit dispatch, batch or material rules in the draft.
3. **Review and approve** — PLANT_MANAGER on /engineering/approvals. Send for review and approve.
4. **Publish** — ADMIN on /engineering/templates/[id]. "Publish LIVE" replaces the live revision for future orders; old orders keep the original.

### Planned maintenance
From schedule to verified job.

1. **Create schedule** — MAINTENANCE_SUPERVISOR on /maintenance/schedules. Machine, kind, interval, due rule, first due date, checklist, "Save".
2. **Due job created** — MAINTENANCE_SUPERVISOR on /maintenance. Automatically at 05:30, or "Create due jobs now".
3. **Do the job** — MAINTENANCE_TECH on /maintenance/jobs/[id]. "Start", checks, readings, spares, time, outcome, "Save record".
4. **Verify** — MAINTENANCE_SUPERVISOR on /maintenance. "Verified" or "Send back" with a note.

### Machine breakdown to repair
Report a fault, assign, repair, resolve and close.

1. **Report fault** — OPERATOR on /maintenance/faults. "Report a fault"; tick "Machine has stopped" if down — running step pauses.
2. **Assign** — MAINTENANCE_SUPERVISOR on /maintenance/faults. "Assign and create repair job".
3. **Repair** — MAINTENANCE_TECH on /maintenance/faults. "In repair", then note and "Resolved"; machine returns to ACTIVE.
4. **Close** — MAINTENANCE_SUPERVISOR on /maintenance/faults. "Close fault".
5. **Review history** — PLANT_MANAGER on /maintenance/reports. Recurring faults and downtime reports.

### Monthly cost close and order profitability
Plant costs for the month are entered, spread over running hours and locked, so every job and order gets actual conversion and overhead cost.

1. **Set cost groups and process rates** — ADMIN on /analytics/process-rates. Create cost groups in Costing Center and hourly process rates used for estimates.
2. **Run jobs on the terminal** — OPERATOR on /production/work-center. Start, pause and complete jobs so running hours are recorded per cost group.
3. **Post material issues** — STORE on /inventory/ledger. Issue and return material against jobs so material cost is actual.
4. **Enter plant-month totals** — OWNER on /analytics/costing. Create or reopen the plant month, enter electricity, labour, overhead, maintenance, service burden, and allocate or edit group lines.
5. **Review and lock** — OWNER on /analytics/costing. Check close health and margin leakage, press "Mark reviewed", then "Lock month".
6. **Check profitability** — OWNER on /analytics/orders/costing. Open loss-making lines and press "Refresh Deep-Dive"; review the Costing & Profitability report.

### Material shortage to purchase order
Confirmed orders create material demand; MRP nets it against stock and drafts purchase orders for shortages.

1. **Confirm the sales order** — SALES on /sales/orders/create. Lines carry a frozen BOM snapshot that MRP reads.
2. **Run MRP** — PLANNER on /analytics/mrp. Runs nightly at 02:00 IST or press "Run planning engine".
3. **Review material gaps** — PLANNER on /analytics/mrp. Check shortage per material and priority (HIGH at 500 or more).
4. **Draft purchase orders** — PLANNER on /analytics/mrp. Press "Create PO" or "Draft all HIGH"; produce and transfer go to planner and inter-plant.
5. **Complete and send the PO** — ADMIN on /procurement/purchase-orders. Check vendor, price and quantity on the draft PO.
6. **Receive goods** — STORE on /inventory/grn. After GRN the stock counts as supply in the next MRP run.

### Production performance review
Floor logs become output, yield, OEE and downtime reports that drive action on machines and jobs.

1. **Log output, scrap and pauses** — OPERATOR on /production/work-center. Every pause writes a downtime record with a reason.
2. **Check the hub** — PLANT_MANAGER on /analytics. Look for red or "Pending" cards.
3. **Open the report** — PLANT_MANAGER on /analytics/reports/production. Production, OEE, Downtime and Scrap & Yield show where loss happens.
4. **Act** — PLANNER on /production/planner. Use "Turn this report into action" links to fix waiting jobs or machine setup.

### Stock integrity check
The audit compares stock balances with ledgers and finds stuck WIP; store fixes the stock and closes alerts with a note.

1. **Run audit** — STORE on /analytics/inventory-health. Press "Run smart audit".
2. **Fix stock** — STORE on /inventory/adjustments. Correct with an adjustment, rack count or roll movement.
3. **Resolve alert** — STORE on /analytics/inventory-health. Press "Resolve Event", write the reason, press "Mark Matrix Resolved".
4. **Watch the trend** — PLANNER on /analytics/inventory-history. Nightly snapshots at 23:45 IST show stock, WIP and reserves over time.

### Daily report pack
Choose which daily packs are archived, generate one, and fetch it later.

1. **Switch packs on** — OWNER on /system/report-center. Set packs Active and press "Save active packs".
2. **Pack is generated** — ADMIN on /system/report-center. The daily cycle (or "Generate now") writes the PDF and workbook to the archive and notifies Owner/Admin in the bell.
3. **Read or download** — OWNER on /system/report-center. Use "Preview", "Download PDF" or "Detail workbook" on the archive shelf (45 days).
4. **Trace later** — OWNER on /system/audit. The Report Archives stream records every generated pack.

### Give a new staff member access
From a new joiner to a working sign-in with the right role, scope and password.

1. **Add the user** — ADMIN on /system/users/new. Press "Add user", fill Username, Email, initial password (8+ characters, not only numbers).
2. **Choose role and scope** — ADMIN on /system/users/new. Pick the Base role; tick work centres for a WCM, machines for an operator, gate plants for a watchman. Press "Create user".
3. **Adjust role defaults if needed** — OWNER on /system/role-matrix. If a whole role needs a page, tick it and press "Save Matrix".
4. **Give one-off access** — ADMIN on /system/users/[id]. Add Extra access overrides only for that person and press "Save changes".
5. **First sign-in and own password** — OPERATOR on /profile. The person signs in, lands on the role's start page and changes the password on Security → "Update Password".
6. **Check in the audit** — OWNER on /system/audit. Permissions and Session & Login streams show the change and the first sign-in.

### Approve a profile change
A user asks to change name, email or phone; an admin approves or rejects it.

1. **Submit the request** — SALES on /profile. Change the fields under "Profile Update Request" and press "Submit For Approval".
2. **Review** — ADMIN on /system/governance. Open "Profile Approvals", read Requested changes, add a note, press "Approve" or "Reject".
3. **See the result** — SALES on /profile. The Requests tab shows the new status; approved values now apply.

### Purchase order to stock (GRN)
From a low-stock alert to a posted GRN that adds material to inventory.

1. **Spot the shortage** — STORE on /system/reorder-policy. Materials below reorder or safety stock raise alerts (scan daily at 06:00 or "Run reorder scan").
2. **Raise the PO** — STORE on /procurement/purchase-orders/new. Pick vendor and plant, add lines with Qty, Rate, GST %, press "Save PO" (DRAFT).
3. **Send to vendor** — STORE on /procurement/purchase-orders/[id]. Press "Send" and "PDF" to share the order.
4. **Truck arrives at the gate** — WATCHMAN on /gate. The watchman logs the arrival and the vendor bill.
5. **Receive and post GRN** — STORE on /procurement/purchase-orders/[id]/receive. Fill Vehicle & Invoice, Line Quantities (width/thickness for film), Quality & Post, press "Post GRN".
6. **Close the PO** — STORE on /procurement/purchase-orders/[id]. Fully received becomes COMPLETED; otherwise "Close Short" with a reason.

## प्रक्रियाएँ

### Sales order: डालने से dispatch तक
ग्राहक का order composer से planning, floor और yard होते हुए dispatch slip और पूरे order तक कैसे जाता है।

1. **ग्राहक और order की जानकारी** — SALES (/sales/orders/create)। "Who is this order for?" का जवाब दें, Ship to, Promised dispatch, Job name, Ship address और Note for dispatch भरें।
2. **lines बनाएँ** — SALES (/sales/orders/create)। quick-add या line editor: size, layers, qty & rate, print & artwork, packing।
3. **Place order** — SALES (/sales/orders/create)। "Before you place" साफ़ करें और "Place order" (⌘↵) दबाएँ। order planning queue में जाता है।
4. **Plan और release** — PLANNER (/dashboard/planner/control-tower/plan-queue)। planner plant चुनता है, stock claim करता है और हर line route पर release करता है।
5. **floor पर बनाना** — WORK_CENTER_MANAGER (/production/work-center)। work centre jobs machines पर देते हैं; operators output दर्ज करते हैं।
6. **Pack और release** — DISPATCH (/logistics/packing)। rolls release होते हैं; pouches inner pouch के साथ gonny में pack, seal और release। बाकी packing सामान tick होता है।
7. **Dispatch slip और proof of delivery** — DISPATCH (/logistics/dispatch)। हर order line की एक slip, dispatch mark करें, फिर proof of delivery दर्ज करें।
8. **Track और बंद** — SALES (/sales/orders/[id])। tracker ready, dispatched और open kg दिखाता है; हर line का proof of delivery (POD) confirm होने पर order पूरा होता है, सिर्फ़ dispatch होने पर नहीं।

### Quotation से sales order
enquiry का भाव, approval, frozen PDF भेजना, ग्राहक का जवाब दर्ज करना और convert।

1. **Quotation शुरू** — SALES (/sales/quotations/new)। ग्राहक चुनें और "Start quotation" दबाएँ।
2. **Lines और Cost Build** — SALES (/sales/quotations/[id])। Catalog या Ad-hoc pouch lines जोड़ें, save करें, फिर "Save Cost Build"।
3. **Approval के लिए भेजें** — SALES (/sales/quotations/[id])। revision और Cost Build freeze हो जाते हैं।
4. **Approve** — OWNER (/sales/quotations/[id])। दूसरा अधिकृत user हर pending gate approve करता है या कारण के साथ reject।
5. **ग्राहक को भेजें** — SALES (/sales/quotations/[id])। "Send frozen revision" PDF email करता है, सबूत के साथ।
6. **जवाब दर्ज करें** — SALES (/sales/quotations/[id])। PO/email reference के साथ "Record acceptance", या कारण के साथ "Record rejection"।
7. **Sales Order में convert** — SALES (/sales/orders/[id])। Accepted quote CONVERTED होती है और नया SO planning में जाता है।

### Sales order cancel करना
release से पहले Sales cancel करता है; release के बाद planner cancel या short-close करता है।

1. **order ढूँढें** — SALES (/sales/orders)। SO number खोजें; cancel icon सिर्फ Draft, Confirmed, Planning या Planned पर दिखता है।
2. **दायरा और कारण** — SALES (/sales/orders)। "Full order" या चुनी lines; कारण और note ज़रूरी।
3. **Release हुई lines** — PLANNER (/dashboard/planner/control-tower/command)। planner release हुई lines कारण के साथ cancel या short-close करता है।
4. **पहले से बना माल** — DISPATCH (/logistics/dispatch)। "Send goods of closed lines" tick करके भेजें, या कारण के साथ "Move to stock"।

### Stock से trade order
बिना production के granules, film या trading goods बेचना।

1. **बनाएँ** — SALES (/sales/trade-orders/new)। ग्राहक और dispatch stock plant चुनें, उपलब्ध stock से lines जोड़ें।
2. **Confirm** — SALES (/sales/trade-orders/[id])। "Confirm order" (या "Save & confirm")।
3. **Dispatch** — SALES (/sales/trade-orders/[id])। "Dispatch" → "Yes, dispatch" plant से stock घटाता है; वापस नहीं होता।

### Sales line: planning से release तक
confirm हुई order line Control Tower से कैसे जाँची, source तय और floor पर release होती है।

1. **order confirm करें** — SALES (/dashboard/sales)। Drafts to confirm Sales dashboard पर दिखते हैं; सिर्फ़ confirm order planner तक पहुँचते हैं।
2. **जोखिम देखें** — PLANNER (/dashboard/planner/control-tower/command)। Top 5 at-risk orders और action desk बताते हैं पहले क्या करना है।
3. **gate जाँचें** — PLANNER (/dashboard/planner/control-tower/plan-queue)। line खोलें; S M A R gate और release checklist पढ़ें।
4. **artwork approve करें** — ADMIN (/engineering/artworks)। सिर्फ़ APPROVED artwork लग सकता है।
5. **artwork लगाएँ** — PLANNER (/dashboard/planner/control-tower/plan-queue)। "Assign artwork" दबाएँ और approved design चुनें।
6. **source चुनें और release करें** — PLANNER (/dashboard/planner/control-tower/plan-queue)। FG match, Carry WIP, Invariant, Input stock या Fresh run; work center चुनें; "Plan & Release" दबाएँ।
7. **job चलाएँ** — WORK_CENTER_MANAGER (/production/work-center)। WC terminal roll चुनता है (planned web के ±20 mm), input issue करता है और machine पर job release करता है।
8. **floor पर नज़र** — PLANNER (/dashboard/planner/control-tower/live-production)। Machines now, replan और blocker।
9. **बंद होने की समीक्षा** — PLANNER (/dashboard/planner/control-tower/completed-trace)। cycle time, समय पर और trace की कमी।

### कमी देखकर stock बनाना
कम template खोजें, stock order launch करें, और sales line को वह stock लेने दें।

1. **कमी खोजें** — PLANNER (/dashboard/planner/control-tower/stock-intelligence)। SHORT या TIGHT template, कम kg के साथ।
2. **जल्दी launch** — PLANNER (/dashboard/planner/control-tower/stock-intelligence)। "Build & release" KG मात्रा के साथ; पहला job तुरंत release।
3. **पूरा launch** — PLANNER (/dashboard/planner/control-tower/stock-launcher)। master, commitment, route stop, size, layer और मात्रा चुनें; "Validate pool"; बनाएँ।
4. **उत्पादन** — WORK_CENTER_MANAGER (/production/work-center)। किसी भी order की तरह चलता है; artwork gate नहीं।
5. **sales line के लिए लें** — PLANNER (/dashboard/planner/control-tower/plan-queue)। उसी spec की line में "Choose source & release" में FG match या Carry WIP दिखता है।

### एक jumbo पर order जोड़ना
एक Product Master के release हुए roll-output job जोड़ें और WC terminal पर slit करें।

1. **line release करें** — PLANNER (/dashboard/planner/control-tower/plan-queue)। हर line की target roll width हो।
2. **group चुनें, order tick करें** — PLANNER (/dashboard/planner/control-tower/gang-builder)। एक PM, recipe, step; 2 या ज़्यादा order।
3. **"Combine" दबाएँ** — PLANNER (/dashboard/planner/control-tower/gang-builder)। "Combine" दबाएँ; batch id बनता है।
4. **machine पर slit** — WORK_CENTER_MANAGER (/production/work-center)। roll picker हर job का एक slit child बनाता है।

### line short-close या cancel करना
planner की तरफ़ से sales line रोकें और बने माल को संभालें।

1. **line खोलें** — PLANNER (/dashboard/planner/control-tower/plan-queue)। या release हुई line के लिए Live Production से।
2. **कदम चुनें** — PLANNER (/dashboard/planner/control-tower/live-production)। machine गतिविधि से पहले ही cancel; वरना Short close।
3. **कारण लिखें** — PLANNER (/dashboard/planner/control-tower/plan-queue)। कम से कम 5 अक्षर; audit में रहता है।
4. **माल भेजें या stock में डालें** — DISPATCH (/logistics/dispatch)। भेजने के लिए "Send goods of closed lines" tick करें, या कारण के साथ "Move to stock"।

### WC रिलीज़ से machine output तक
रिलीज़ हुई order line WC terminal पर कैसे तैयार होती है, machine पर चलती है और अगले step को जाती है।

1. **Planner line रिलीज़ करता है** — PLANNER (/dashboard/planner/control-tower/plan-queue)। Spec, Material, Artwork और Route गेट साफ़; route steps के jobs बनते हैं।
2. **WCM job खोलता है** — WORK_CENTER_MANAGER (/production/work-center/[id])। कतार में line चुनें, order प्लेट और step के आँकड़े पढ़ें।
3. **machine और rolls चुनें** — WORK_CENTER_MANAGER (/production/work-center/[id])। खाली machine टैप करें; planned web से ±20 mm वाले rolls या slit के लिए चौड़े rolls लगाएँ।
4. **granule grade code दें** — WORK_CENTER_MANAGER (/production/work-center/[id])। केवल rolls और granule codes भरते हैं; बाकी सामग्री step mapping से जाती है।
5. **Release to machine** — WORK_CENTER_MANAGER (/production/work-center/[id])। M, R, I और C गेट साफ़ होने पर Release to machine दबाएँ।
6. **Operator शुरू करता है** — OPERATOR (/production/machine/[machine_id])। Queue में job चुनें और Start दबाएँ।
7. **Output लिखें** — OPERATOR (/production/machine/[machine_id])। rolls या pieces, trim और scrap लिखें; वेस्टेज सीमा पर या ऊपर कारण ज़रूरी।
8. **step पूरा करें** — OPERATOR (/production/machine/[machine_id])। Complete दबाएँ, कम हो तो कारण के साथ Force complete; अगला step दर्ज output पर चलता है।
9. **माल आगे जाता है** — DISPATCH (/logistics/packing)। Pouches Packing Yard में पैक होते हैं; rolls dispatch को रिलीज़ होते हैं।

### Ink issue, गिनती और मिलान
Ink फ्लोर पर दी जाती है, समय से गिनी जाती है और artwork GSM theory से मिलाई जाती है।

1. **फ्लोर पर ink दें** — WORK_CENTER_MANAGER (/production/ink-control)। Shift Desk, Issue मोड: ink, kg, event time चुनें, Issue ink।
2. **बची ink लौटाएँ** — WORK_CENTER_MANAGER (/production/ink-control)। Return ink, या POLY/PET बेस और रंग के साथ Return as mix।
3. **फ्लोर की गिनती** — WORK_CENTER_MANAGER (/production/ink-control)। Ink stock count snapshot: हर ink का counted kg, Post count।
4. **मिलान** — PLANNER (/production/ink-control)। Reconcile टैब: समय-खिड़की में हर order/job का असली बनाम theory।

### फ़ैक्टरी सेट-अप
उत्पादन से पहले बनाए जाने वाले masters।

1. **plant बनाएँ** — ADMIN (/factory/plants)। कोड, नाम, legal profile, default cost group।
2. **locations बनाएँ** — ADMIN (/factory/locations)। स्टोर, WIP, finished goods, dispatch और फ्लोर लोकेशन।
3. **processes बताएँ** — ADMIN (/factory/processes)। Input/output form, roll behaviour (बाद में नहीं बदलता), stock forms।
4. **work centres बनाएँ** — ADMIN (/factory/work-centers)। प्लांट में process के अनुसार machine groups।
5. **machines बनाएँ** — ADMIN (/factory/machines)। अलग कोड, work centre, एक साथ orders की नीति, QR पोस्टर।
6. **लोगों को assign करें** — ADMIN (/system/users)। WCM को work centres, operators को machines।

### आने वाला बिल: रसीद या फ़ाइल तक
गेट पर फ़ोटो लिया या ऑफ़िस में अपलोड हर बिल classify होकर GRN, job-work receipt, General Receipt या file से पूरा होता है।

1. **बिल की फ़ोटो** — WATCHMAN (/gate)। माल आने पर watchman बिल की फ़ोटो लेता है; ऑफ़िस "Upload bill" से भी जोड़ सकता है।
2. **Inbox से उठाएँ** — STORE (/inventory/gate-bills)। "Needs classifying" में बिल खोलें।
3. **Classify करके सेव** — STORE (/inventory/gate-bills/[id])। Document type और Category चुनें, vendor, bill नंबर, तारीख़, रकम भरें, "Save details" दबाएँ।
4. **Stock का GRN** — STORE (/inventory/grn)। Stock items: "Open GRN" से post करें; स्टॉक बढ़ता है और receipt बिल से जुड़ती है।
5. **Non-stock के लिए General Receipt** — STORE (/inventory/general-receipts/new)। Spares, machinery या service: "Create general receipt"; स्टॉक नहीं बदलता।
6. **Record वाले काग़ज़ file** — STORE (/inventory/gate-bills/[id])। Utility, fee, other expense: "File as record"; transport LR: "Attach to the stock bill"।
7. **सब लाइनें पूरी** — STORE (/inventory/gate-bills/[id])। बिल "Partly received" हो और सब आ गया हो तो "Confirm all lines received"।

### Returnable gate pass (RGP) का चक्र
पुर्ज़ा या औज़ार नंबर वाले RGP पर निकलता है, गेट पर scan होता है, और सब लौटने या short-close होने पर pass बंद होता है।

1. **Pass बनाएँ** — STORE (/inventory/gate-passes/new)। Returnable (RGP), purpose, party, लौटने की तारीख़ और सामान चुनें; "Save and issue"।
2. **Print करके दें** — STORE (/inventory/gate-passes/[id])। "Print PDF" करके सामान के साथ भेजें (या दूसरे काग़ज़ पर QR label लगाएँ)।
3. **गेट पर scan** — WATCHMAN (/gate)। Watchman QR scan करता है; status "Out of factory" होता है।
4. **देरी पर नज़र** — STORE (/inventory/goods-movements)। Goods in & out में Outside और Late, या Gate passes का Overdue टैब।
5. **वापसी दर्ज** — STORE (/inventory/general-receipts/new)। Vendor बिल के साथ: General Receipt में "Came back on a returnable gate pass (RGP)"; बिना बिल: pass पर "Receive back"।
6. **बंद या short-close** — STORE (/inventory/gate-passes/[id])। सब लौटने पर pass बंद; नहीं तो कारण के साथ "Short-close"।

### दो-व्यक्ति वाला स्टॉक सुधार
स्टॉक का अंतर एक व्यक्ति draft करता है और दूसरा post; post से स्टॉक और ledger बदलते हैं, void से वापस।

1. **अंतर पहचानें** — STORE (/inventory/alerts)। Alert, गिनती या फ़र्श की जाँच से पता चलता है कि स्टॉक मेल नहीं खाता।
2. **Draft बनाएँ** — STORE (/inventory/adjustments/new)। Plant, reason, unit में + या − delta वाली लाइनें; "Save Draft"।
3. **दूसरा व्यक्ति post करे** — STORE (/inventory/adjustments/[id])। adjust अधिकार वाला दूसरा user (या Owner/Admin) "Post" → "Post adjustment" दबाता है।
4. **Ledger जाँचें** — STORE (/inventory/bulk-transactions)। Bulk Transactions / ledger में ADJUST row दिखती है।
5. **गलत हो तो void** — OWNER (/inventory/adjustments/[id])। "Void" उल्टी लाइनें लगाता है; स्टॉक खर्च हो चुका हो तो मना।

### Inventory alert का निपटारा
रात की स्टॉक जाँच alert बनाती है; store कारण ठीक करके नोट के साथ resolve करता है।

1. **रात की जाँच** — ADMIN (/analytics/inventory-health)। Reconciliation हर रात चलती है (या Inventory health पर "Run audit") और हर गड़बड़ी का एक alert रखती है।
2. **खुले alert देखें** — STORE (/inventory/alerts)। "Open" चुनें, Critical और High से शुरू करें।
3. **कारण ठीक करें** — STORE (/inventory/stock-lifecycle)। स्टॉक गिनें या अंतर के लिए adjustment बनाएँ।
4. **नोट के साथ resolve** — STORE (/inventory/alerts)। "Resolve" → "Resolution note" → "Mark resolved"; mismatch alert अगली रात खुद भी बंद होते हैं।

### सप्लायर का माल लेना (GRN)
सप्लायर बिल के gate फोटो से roll / bulk / packaging stock तक, सुधार GRN history में।

1. **Gate फोटो** — WATCHMAN (/gate)। गाड़ी आने पर बिल का फोटो लें।
2. **बिल classify करें** — STORE (/inventory/gate-bills)। बिल को stock में classify करें और Receive खोलें।
3. **Smart GRN post करें** — STORE (/inventory/grn)। Class और source चुनें, लाइनें भरें, Submit & post दबाएँ।
4. **Stock देखें** — STORE (/inventory/rolls)। नए roll Available हैं, देखें; चाहें तो label print करें।
5. **ज़रूरत हो तो सुधारें** — STORE (/inventory/grn-history)। गलत मात्रा, rate या roll spec को कारण के साथ Correct करें।

### Job work का पूरा चक्र
Rule 45 challan पर बाहर job worker को माल भेजना, material balance के साथ वापस लेना, बिल जोड़ना और close करना।

1. **Order बनाएँ** — PLANNER (/inventory/job-work)। Order बनाएँ: planned route step या emergency handoff, job worker, expected output, rate, वापसी तारीख़।
2. **Challan पर भेजें** — STORE (/inventory/job-work/[id])। Send material: roll / bulk, HSN, गाड़ी चुनें; challan बनाकर print करें।
3. **Gate पर scan** — WATCHMAN (/gate)। गाड़ी निकलते समय challan का QR scan करें।
4. **वापसी लें** — STORE (/inventory/job-work/[id])। Receive: हर भेजा roll निपटाएँ, output और wastage भरें, balance मिलाएँ, बिल जोड़ें।
5. **Production आगे बढ़ाएँ** — STORE (/inventory/job-work/[id])। चाहें तो आंशिक वापसी से production आगे बढ़ाएँ।
6. **Order close करें** — STORE (/inventory/job-work/[id])। कुछ बाकी न हो तो Close, या कारण के साथ Close short।

### Plant से plant transfer
Delivery challan पर IN_TRANSIT से होकर roll या bulk को plant से plant भेजना।

1. **Challan बनाएँ** — STORE (/inventory/inter-plant)। New Transfer: plant, material type, लाइनें; draft बनाएँ या अभी dispatch करें।
2. **Print निकालें** — STORE (/inventory/inter-plant/print/[id])। Challan PDF और QR gate sticker print करें।
3. **Gate पर scan** — WATCHMAN (/gate)। निकलते समय QR scan करें।
4. **माल लें** — STORE (/inventory/inter-plant)। Destination पर: target location में Receive, Confirm Receipt।

### शाम की packing गिनती
Release पर tick हुए packing item और खरीदे हुए inner pouch शाम की गिनती से stock से कटते हैं और इस्तेमाल करने वाले order पर बँटते हैं।

1. **Release पर tick** — DISPATCH (/logistics/packing)। Pack और release करें; हर unit पर इस्तेमाल हुए packing item tick करें (inner pouch कभी tick नहीं होता: घर का inner pouch मशीन पर कट चुका, खरीदा हुआ इसी गिनती से बुक होता है)।
2. **गिनें और post करें** — STORE (/inventory/stock-lifecycle)। Stock count → Evening packing count: location चुनें; लाइनें book मात्रा से भरी आती हैं, सिर्फ़ अलग निकली गिनती बदलें; Post count (तुरंत post, कोई approval नहीं)।
3. **Audit देखें** — OWNER (/logistics/packing/audit)। Book → counted → used और हर order line का हिस्सा देखें।
4. **फिर से भरें** — STORE (/inventory/packaging)। Packaging stock देखें और कम item Smart GRN से मँगाएँ।

### Stock count, month end और year end
किसी भी दिन stock गिनें, month-end proof लें, blockers हटाएँ और financial year बंद करें।

1. **साल खोलें** — OWNER (/inventory/stock-lifecycle)। Financial year खोलें (Open FY) और opening stock post करें।
2. **गिनती** — STORE (/inventory/stock-lifecycle)। Stock count: कारण के साथ गिनी मात्रा भरें, Post physical count।
3. **महीने की बंदी** — PLANT_MANAGER (/inventory/stock-lifecycle)। Month end: महीना lock करें, snapshot लें, month proof देखें।
4. **Blockers हटाएँ** — STORE (/inventory/inter-plant)। Blockers हटाएँ: in-transit challan receive, job work close, draft sheet पूरी।
5. **साल बंद करें** — OWNER (/inventory/stock-lifecycle)। Year end: Close Financial Year; अगले साल की opening बनती है और साल archive होता है।

### Outward काग़ज़ मिलाना
निकलने वाली हर गाड़ी का gate पर फोटो होता है और office उसे साथ गए ERP document से मिलाता है।

1. **Departure दर्ज करें** — WATCHMAN (/gate)। गाड़ी निकलते समय QR काग़ज़ scan करें और पन्नों का फोटो लें।
2. **Queue खोलें** — STORE (/inventory/outward-documents)। Pending match खोलें, पुराने पहले।
3. **Document जोड़ें** — STORE (/inventory/outward-documents/[id])। ERP document जोड़ें (search या QR), या ERP से बाहर का काग़ज़ जोड़ें।
4. **पूरा करें** — STORE (/inventory/outward-documents/[id])। Matched करें या discrepancy save करें।

### पाउच गोनी में पैक करके रिलीज़ करना
मशीन बैच से Dispatch Bay में सील गोनी तक, शाम की गिनती के लिए पैकिंग आइटम टिक के साथ।

1. **मशीन पर आउटपुट दर्ज** — OPERATOR (/production/machine-selector)। पाउचिंग मशीन ऑर्डर लाइन का बैच दर्ज करती है; inner-pack ऑर्डर में घर के (in-house) inner pouch यहीं स्टॉक से कटते हैं (खरीदे हुए शाम की गिनती के लिए mark होते हैं)।
2. **यार्ड में लाइनें चुनें** — DISPATCH (/logistics/packing)। तैयार लाइनें टिक करें और "Pack selected" दबाएँ।
3. **आँकड़े कन्फ़र्म** — DISPATCH (/logistics/packing)। "Figures checked" टिक करें; inner packs या loose ऑर्डर तय करता है।
4. **गोनी बनाएँ और तौलें** — DISPATCH (/logistics/packing)। पैक/पाउच, गोनी प्रकार और तराज़ू का ग्रॉस लिखें; सील करें। 2 % से ज़्यादा पर कारण।
5. **पैकिंग आइटम टिक** — DISPATCH (/logistics/packing)। इस्तेमाल हुए गोनी, बॉक्स, टेप, लेबल… टिक करें। मात्रा नहीं।
6. **Dispatch Bay में रिलीज़** — DISPATCH (/logistics/packing)। सील गोनी रिलीज़ करें; हर लाइन Dispatch Bay में अपनी अलग स्लिप बनती है।
7. **रुका चेक स्वीकार (अगर हो)** — WORK_CENTER_MANAGER (/logistics/packing)। सुपरवाइज़र पैकिंग चेक पर रुके बैच को कारण के साथ स्वीकार करता है।

### रोल डिस्पैच के लिए रिलीज़
तैयार रोल packed (शीट / रैप, टिक के साथ) या unpacked रिलीज़।

1. **मशीन पर रोल दर्ज** — OPERATOR (/production/machine-selector)। आख़िरी स्टेप हर तैयार रोल उसके लेबल वज़न के साथ दर्ज करता है।
2. **रोल लाइन खोलें** — DISPATCH (/logistics/packing)। लाइन पर "Release" या "Pack & release" दबाएँ।
3. **रोल और तरीका चुनें** — DISPATCH (/logistics/packing)। रोल टिक करें; "Packed roll · sheet / wrap" या "Release unpacked roll" चुनें।
4. **आइटम टिक करके रिलीज़** — DISPATCH (/logistics/packing)। Packed में कम से कम एक टिक ज़रूरी। हर रोल एक डिस्पैच यूनिट।

### लोड, स्लिप, डिस्पैच और POD
रिलीज़ यूनिट हर ऑर्डर लाइन की एक स्लिप पर निकलती हैं और POD से पूरी होती हैं।

1. **ट्रे लोड करें** — DISPATCH (/logistics/dispatch)। "Ready to dispatch" पर लाइन या यूनिट टिक करें।
2. **ट्रांसपोर्ट और डिलीवरी** — DISPATCH (/logistics/dispatch)। ट्रांसपोर्टर ज़रूरी; गाड़ी वैकल्पिक; हर ऑर्डर की डिलीवरी लोकेशन।
3. **स्लिप बनाएँ** — DISPATCH (/logistics/dispatch)। "Create N slips": हर ऑर्डर लाइन की एक, सब या कोई नहीं।
4. **प्रिंट और dispatched** — DISPATCH (/logistics/dispatch)। Epson 10 × 6 इंच पर प्रिंट (या A4 PDF), QR स्टिकर लगाएँ, "Mark dispatched · close"।
5. **गेट पर दर्ज** — WATCHMAN (/gate/outward)। वॉचमैन QR स्कैन करता है, कागज़ की फ़ोटो लेता है, गाड़ी नोट करता है।
6. **POD कन्फ़र्म** — DISPATCH (/logistics/dispatch)। "Awaiting POD" में "Confirm POD" दबाएँ; ऑर्डर बंद हो सकता है।

### बंद लाइन का माल: भेजें या स्टॉक में
short-closed, completed या cancelled लाइन का बना माल या तो पुष्टि के साथ भेजा जाता है या कारण के साथ फ़्री स्टॉक में जाता है।

1. **लाइन बंद होती है** — SALES (/sales/orders)। सेल्स लाइन या ऑर्डर बंद करता है जबकि माल यार्ड में है।
2. **बंद का निशान देखें** — DISPATCH (/logistics/dispatch)। Packing Yard और Dispatch Bay लाइन पर निशान दिखाते हैं ("Order completed" / "Line short-closed")।
3. **भेजें: पुष्टि टिक** — DISPATCH (/logistics/dispatch)। लोड करें और Create व dispatch से पहले "Send goods of closed lines" टिक करें।
4. **या स्टॉक में भेजें** — DISPATCH (/logistics/packing)। "Move to stock": यूनिट चुनें, कारण दें (3+ अक्षर)।
5. **प्लानर लेता है** — PLANNER (/dashboard/planner)। "Use finished stock" उन्हें उसी स्पेसिफ़िकेशन वाले किसी भी ऑर्डर को देता है।

### गेट पर इनवर्ड बिल
सप्लायर का माल बिल फ़ोटो से दर्ज, फिर स्टोर GRN से रिसीव करता है।

1. **बिल की फ़ोटो** — WATCHMAN (/gate/inward-bills)। 1–6 पेज, "Record arrival"।
2. **स्टोर को सूचना** — STORE (/inventory/gate-bills)। स्टोर Bills & documents में फ़ोटो देखता है।
3. **GRN मिलाएँ या बनाएँ** — STORE (/inventory/gate-bills)। हर लाइन कन्फ़र्म करें या कारण से निपटाएँ।

### बाहर जाते कागज़ और लौटते कागज़
रवानगी QR और फ़ोटो से दर्ज; लौटते इंटर-प्लांट, जॉब-वर्क और गेट-पास कागज़ स्कैन करके वापस दर्ज।

1. **QR स्टिकर छापें** — DISPATCH (/logistics/dispatch)। स्लिप या Tally बिल पर लगाएँ।
2. **आउटवर्ड दर्ज** — WATCHMAN (/gate/outward)। QR स्कैन, कागज़ की फ़ोटो, गाड़ी, "Record outward"।
3. **ऑफ़िस मिलाता है** — OWNER (/gate/history)। बिना QR की रवानगी फ़ोटो से मिलाई जाती है।
4. **कागज़ वापस आता है** — WATCHMAN (/gate/arrivals)। चालान या गेट पास का QR स्कैन, "Record back at the gate"।
5. **स्टोर रिसीव करता है** — STORE (/inventory/gate-passes)। स्टोर रसीद या वापसी दर्ज करता है।

### विज़िटर का आना-जाना
विज़िटर QR से खुद रजिस्टर करते हैं; वॉचमैन चेक-आउट करता है।

1. **गेट पर पोस्टर** — OWNER (/gate/qr)। प्लांट का विज़िटर QR पोस्टर प्रिंट करके लगाएँ।
2. **विज़िटर रजिस्टर करता है** — WATCHMAN (/visit/[token])। विज़िटर फ़ॉर्म भरकर "Record my entry" दबाता है; एंट्री दर्ज।
3. **अंदर दिखता है** — WATCHMAN (/gate/visitors)। विज़िटर "Inside now" में दिखता है।
4. **चेक-आउट** — WATCHMAN (/gate/visitors)। जाते समय "Check out" दबाएँ।
5. **ओनर रिव्यू** — OWNER (/gate/history)। फ़ोटो के साथ विज़िटर इतिहास; 12 घंटे से ज़्यादा वाले चिह्नित।

### नया Product Master बनाना
Film और pouch style से लेकर active master तक, जिसे sales order कर सके।

1. **Film जाँचें** — ADMIN (/master/film-variants)। हर layer की film variant अपनी family में बनी हो; extrusion film की recipe हो।
2. **Pouch style approve करें** — ADMIN (/master/pouch-styles/[id])। Formula बनाएँ, live preview देखें, "Save + approve + lock" दबाएँ।
3. **Master बनाएँ** — ADMIN (/master/products)। "New Product Master": kind, code, नाम, live route, layers → "Create & open workspace"।
4. **Editor भरें** — ADMIN (/master/products/[id]/edit)। Layers, Printing, Adhesive, sales की अनुमति, add-on और packing।
5. **Sizes जोड़ें** — ADMIN (/master/products/[id]/edit)। "Add size" या "Excel sheet" → "Bulk upload" → "Confirm import"।
6. **Save और active करें** — ADMIN (/master/products/[id]/edit)। Checklist पूरी करें, "Master active" चालू रखकर "Save master"।
7. **Sales order करता है** — SALES (/sales/orders/create)। अब master order composer में दिखता है।

### Packing item जोड़ना
Packaging item बनाएँ ताकि yard उसे इस्तेमाल करे और शाम की count उसे book करे।

1. **Item बनाएँ** — ADMIN (/master/packaging)। "Add Packaging", kind सोचकर चुनें (default नहीं), supply mode, UOM।
2. **Piece वज़न भरें** — ADMIN (/master/packaging)। खरीदे inner pouch और gonny के लिए एक piece का kg।
3. **घर के items जोड़ें** — ADMIN (/master/packaging)। घर के inner pouch या sheet के लिए "Link to Product Master"।
4. **Release पर tick** — DISPATCH (/logistics/packing)। Inner pouch छोड़कर हर active item release tick list में है।
5. **शाम की count** — STORE (/logistics/packing/audit)। गिना हुआ इस्तेमाल tick करने वाले orders में पूरे pieces में बँटता है; किसी ने tick न किया हो तो उस दिन के उन orders में जिनके packing plan में वह item है।

### Extrusion recipe बदलना
Release हुए job को छेड़े बिना नए granule प्रतिशत publish करना।

1. **Recipe खोलें** — ADMIN (/master/recipes)। Row edit करें; पहचान (variant, grade, thickness) lock है।
2. **प्रतिशत बदलें** — ADMIN (/master/recipes)। जोड़ 100.00% हो; "Balance to 100%"।
3. **Publish करें** — ADMIN (/master/recipes)। Revision reason लिखें, "Publish revision vN" दबाएँ।
4. **असर देखें** — PLANNER (/dashboard/planner/control-tower/plan-queue)। खुले BOM और queue ताज़ा होते हैं; "Needs review" lines देखें।

### Artwork से approved print तक
Design upload करें, ROTO के लिए cylinder तैयार करें, और production के लिए approve करें।

1. **Artwork upload** — ADMIN (/engineering/artworks)। "Upload Artwork": code, नाम, file, print type, film type, colour, ink GSM, "Save Draft"।
2. **Cylinder बनाएँ (ROTO)** — ADMIN (/engineering/artworks)। Repeat और length भरें; हर colour पर "Generate FRONT n"।
3. **Cylinder finalize या reuse** — ADMIN (/engineering/cylinders)। "Manage Slots": vendor, location, "Finalize this cylinder", या "Use" से reuse।
4. **Artwork approve** — ADMIN (/engineering/artworks)। "Approval Blockers" खाली हो तो "Approve"।
5. **Product और order में इस्तेमाल** — SALES (/master/products)। Approved artwork product/order line पर चुना जाता है।

### Route और template को LIVE करना
Route बनाएँ, उस पर template बनाएँ, review, approve और publish LIVE करें ताकि sales और planner इस्तेमाल करें।

1. **Route बनाएँ** — ADMIN (/engineering/routing)। "New Route", step जोड़ें, parallel चिह्नित करें, "Save Routing Rule"।
2. **Template बनाएँ** — ADMIN (/engineering/templates)। "New Template" → "Create & Open Studio"।
3. **Route जोड़ें और sync** — ADMIN (/engineering/templates/[id])। Routing rule चुनें, "Save basics", "Sync route stages"।
4. **Batch, dispatch और material** — ADMIN (/engineering/templates/[id])। Template execution, हर stage का dispatch setup, material mapping save करें।
5. **Review भेजें** — ADMIN (/engineering/templates/[id])। "Send for review" से ENGINEERING में जाता है।
6. **Approve** — PLANT_MANAGER (/engineering/approvals)। Review सूची या studio में "Approve"।
7. **Publish LIVE** — ADMIN (/engineering/templates/[id])। "Publish LIVE"; अब Product Master, sales और planner में चुना जा सकता है।
8. **Planner release** — PLANNER (/dashboard/planner/control-tower/plan-queue)। Release में template के dispatch और batch rule लगते हैं।

### LIVE template में सुधार
पुराने order को छुए बिना live template सुरक्षित बदलें।

1. **Edit safely** — ADMIN (/engineering/templates/[id])। "Edit safely" दबाएँ; correction draft खुलता है।
2. **बदलाव करें** — ADMIN (/engineering/templates/[id])। Draft में dispatch, batch या material rule बदलें।
3. **Review और approve** — PLANT_MANAGER (/engineering/approvals)। Review भेजें और approve करें।
4. **Publish** — ADMIN (/engineering/templates/[id])। "Publish LIVE" आगे के order के लिए live revision बदलता है; पुराने order पुराना रखते हैं।

### Planned maintenance
Schedule से verified job तक।

1. **Schedule बनाएँ** — MAINTENANCE_SUPERVISOR (/maintenance/schedules)। Machine, kind, अंतराल, due rule, first due date, checklist, "Save"।
2. **Due job बनता है** — MAINTENANCE_SUPERVISOR (/maintenance)। 05:30 पर अपने आप, या "Create due jobs now"।
3. **Job करें** — MAINTENANCE_TECH (/maintenance/jobs/[id])। "Start", checks, reading, पुर्ज़े, समय, नतीजा, "Save record"।
4. **Verify** — MAINTENANCE_SUPERVISOR (/maintenance)। "Verified" या note के साथ "Send back"।

### Machine breakdown से repair तक
खराबी दर्ज, assign, repair, resolve और close।

1. **खराबी दर्ज** — OPERATOR (/maintenance/faults)। "Report a fault"; बंद हो तो "Machine has stopped" — चलता step रुकता है।
2. **Assign** — MAINTENANCE_SUPERVISOR (/maintenance/faults)। "Assign and create repair job"।
3. **Repair** — MAINTENANCE_TECH (/maintenance/faults)। "In repair", फिर note और "Resolved"; machine फिर ACTIVE।
4. **Close** — MAINTENANCE_SUPERVISOR (/maintenance/faults)। "Close fault"।
5. **History देखें** — PLANT_MANAGER (/maintenance/reports)। बार-बार की खराबी और downtime रिपोर्ट।

### महीने का cost close और order मुनाफ़ा
महीने का plant खर्च भरा जाता है, चलने के घंटों पर बाँटा जाता है और lock होता है, ताकि हर job और order को असली conversion और overhead लागत मिले।

1. **Cost group और process rate सेट करें** — ADMIN (/analytics/process-rates)। Costing Center में cost group और अनुमान के लिए प्रति घंटा process rate बनाएँ।
2. **Terminal पर job चलाएँ** — OPERATOR (/production/work-center)। Job start, pause और complete करें ताकि हर cost group के चलने के घंटे दर्ज हों।
3. **Material issue दर्ज करें** — STORE (/inventory/ledger)। Job पर material issue और वापसी करें ताकि material लागत असली हो।
4. **Plant-month totals भरें** — OWNER (/analytics/costing)। Plant month बनाएँ, बिजली, labour, overhead, maintenance, service burden भरें, और group lines allocate या भरें।
5. **Review और lock** — OWNER (/analytics/costing)। Close health और margin leakage देखें, "Mark reviewed" फिर "Lock month" दबाएँ।
6. **मुनाफ़ा देखें** — OWNER (/analytics/orders/costing)। घाटे वाली lines खोलें और "Refresh Deep-Dive" दबाएँ; Costing & Profitability रिपोर्ट देखें।

### Material की कमी से purchase order तक
पक्के order से material की माँग बनती है; MRP उसे stock से मिलाकर कमी के लिए purchase order का draft बनाता है।

1. **Sales order पक्का करें** — SALES (/sales/orders/create)। Lines में frozen BOM snapshot होता है जिसे MRP पढ़ता है।
2. **MRP चलाएँ** — PLANNER (/analytics/mrp)। रात 02:00 IST पर चलता है या "Run planning engine" दबाएँ।
3. **Material gaps देखें** — PLANNER (/analytics/mrp)। हर material की कमी और priority देखें (500 या ज़्यादा पर HIGH)।
4. **Purchase order का draft** — PLANNER (/analytics/mrp)। "Create PO" या "Draft all HIGH" दबाएँ; produce और transfer planner और inter-plant पर जाते हैं।
5. **PO पूरा करके भेजें** — ADMIN (/procurement/purchase-orders)। Draft PO पर vendor, दाम और मात्रा जाँचें।
6. **माल प्राप्त करें** — STORE (/inventory/grn)। GRN के बाद अगले MRP run में stock supply में गिना जाता है।

### उत्पादन प्रदर्शन की समीक्षा
Floor के log से output, yield, OEE और downtime रिपोर्ट बनती हैं, जिनसे मशीन और job पर काम होता है।

1. **Output, scrap और pause दर्ज करें** — OPERATOR (/production/work-center)। हर pause कारण के साथ downtime record बनाता है।
2. **Hub देखें** — PLANT_MANAGER (/analytics)। लाल या "Pending" कार्ड देखें।
3. **रिपोर्ट खोलें** — PLANT_MANAGER (/analytics/reports/production)। Production, OEE, Downtime और Scrap & Yield दिखाते हैं नुकसान कहाँ है।
4. **कार्रवाई** — PLANNER (/production/planner)। "Turn this report into action" link से रुके job या मशीन setup ठीक करें।

### Stock गड़बड़ी जाँच
Audit stock balance को ledger से मिलाता है और अटका WIP ढूँढता है; store stock ठीक करके नोट के साथ alert बंद करता है।

1. **Audit चलाएँ** — STORE (/analytics/inventory-health)। "Run smart audit" दबाएँ।
2. **Stock ठीक करें** — STORE (/inventory/adjustments)। Adjustment, rack count या roll movement से सुधारें।
3. **Alert बंद करें** — STORE (/analytics/inventory-health)। "Resolve Event" दबाएँ, कारण लिखें, "Mark Matrix Resolved" दबाएँ।
4. **ट्रेंड देखें** — PLANNER (/analytics/inventory-history)। रात 23:45 IST के snapshot समय के साथ stock, WIP और reserve दिखाते हैं।

### रोज़ का report pack
कौन-से daily pack archive हों यह चुनना, एक बनाना, और बाद में निकालना।

1. **Pack चालू करें** — OWNER (/system/report-center)। Pack को Active करें और "Save active packs" दबाएँ।
2. **Pack बनता है** — ADMIN (/system/report-center)। Daily cycle (या "Generate now") PDF और workbook archive में लिखता है और Owner/Admin को bell में बताता है।
3. **पढ़ें या डाउनलोड करें** — OWNER (/system/report-center)। Archive shelf (45 दिन) पर "Preview", "Download PDF" या "Detail workbook" दबाएँ।
4. **बाद में जाँच** — OWNER (/system/audit)। Report Archives stream हर बने pack को दर्ज करती है।

### नए कर्मचारी को पहुँच देना
नए कर्मचारी से लेकर सही रोल, scope और password वाले चालू login तक।

1. **यूज़र जोड़ें** — ADMIN (/system/users/new)। "Add user" दबाएँ, Username, Email, शुरुआती password (8+ अक्षर, सिर्फ़ अंक नहीं) भरें।
2. **रोल और scope चुनें** — ADMIN (/system/users/new)। Base role चुनें; WCM के लिए work centre, operator के लिए machine, watchman के लिए gate प्लांट टिक करें। "Create user" दबाएँ।
3. **ज़रूरत हो तो रोल default बदलें** — OWNER (/system/role-matrix)। अगर पूरे रोल को कोई पेज चाहिए तो टिक करके "Save Matrix" दबाएँ।
4. **एक व्यक्ति को अतिरिक्त पहुँच** — ADMIN (/system/users/[id])। सिर्फ़ उस व्यक्ति के लिए Extra access overrides जोड़ें और "Save changes" दबाएँ।
5. **पहला login और अपना password** — OPERATOR (/profile)। व्यक्ति login करता है, रोल के शुरुआती पेज पर पहुँचता है और Security → "Update Password" से password बदलता है।
6. **Audit में जाँच** — OWNER (/system/audit)। Permissions और Session & Login stream में बदलाव और पहला login दिखता है।

### Profile बदलाव की मंज़ूरी
यूज़र नाम, email या phone बदलने को कहता है; admin मंज़ूर या अस्वीकार करता है।

1. **Request भेजें** — SALES (/profile)। "Profile Update Request" में field बदलें और "Submit For Approval" दबाएँ।
2. **Review करें** — ADMIN (/system/governance)। "Profile Approvals" खोलें, Requested changes पढ़ें, note लिखें, "Approve" या "Reject" दबाएँ।
3. **नतीजा देखें** — SALES (/profile)। Requests टैब पर नई स्थिति दिखती है; मंज़ूर values लागू हो जाती हैं।

### Purchase order से stock तक (GRN)
Low-stock alert से लेकर पोस्ट हुए GRN तक जो material inventory में जोड़ता है।

1. **कमी पहचानें** — STORE (/system/reorder-policy)। Reorder या safety stock से नीचे वाले material पर alert बनता है (रोज़ 06:00 पर scan या "Run reorder scan")।
2. **PO बनाएँ** — STORE (/procurement/purchase-orders/new)। Vendor और प्लांट चुनें, Qty, Rate, GST % वाली लाइनें जोड़ें, "Save PO" दबाएँ (DRAFT)।
3. **Vendor को भेजें** — STORE (/procurement/purchase-orders/[id])। "Send" दबाएँ और order भेजने के लिए "PDF" लें।
4. **Gate पर ट्रक आता है** — WATCHMAN (/gate)। Watchman आगमन और vendor बिल दर्ज करता है।
5. **माल लें और GRN पोस्ट करें** — STORE (/procurement/purchase-orders/[id]/receive)। Vehicle & Invoice, Line Quantities (film के लिए width/thickness), Quality & Post भरें, "Post GRN" दबाएँ।
6. **PO बंद करें** — STORE (/procurement/purchase-orders/[id])। पूरा आने पर COMPLETED; वरना कारण के साथ "Close Short"।

## Decision flows
### Dashboard Response Flow
- Identify Alert Severity
  - Critical → Escalate with Evidence
  - Operational → Execute Assigned Action
- Execute Assigned Action
  - Resolved → Log closure notes and continue queue.
  - Blocked → Escalate with Evidence
- Escalate with Evidence
  - Escalated → Share route, payload, and timestamp in escalation note.
### System Governance Flow
- Validate policy scope
  - Valid → Approve with notes
  - Invalid → Reject with action items
- Approve with notes
  - Done → Revalidate role visibility and notify stakeholders.
- Reject with action items
  - Returned → Return to requester with mandatory fixes.
### Factory Configuration Flow
- Check dependency chain
  - Dependencies ready → Save and verify mappings
  - Missing masters → Complete master setup before config save.
- Save and verify mappings
  - Verified → Run smoke check in downstream execution screen.
### Master Data Change Flow
- Draft change
  - Review needed → Validate downstream impact
  - Urgent → Validate downstream impact
- Validate downstream impact
  - Approve → Publish and communicate effective date.
  - Reject → Return with correction checklist.
### Production Execution Flow
- Queue and assign
  - Assigned → Execute and monitor
  - Capacity issue → Re-plan or move to alternate center.
- Execute and monitor
  - Completed → Close job and verify roll/FG postings.
  - Variance → Capture reason and initiate approval.
### Analytics Decision Flow
- Identify variance
  - Within threshold → Track trend, no immediate action required.
  - Outlier → Investigate root cause
- Investigate root cause
  - Actionable → Create corrective task and owner assignment.
### Stock Lifecycle Flow
- Choose the correct tab
  - Starting balance or migration → Use Opening Stock.
  - Physical count difference in open FY → Use Stock Count.
  - Closed FY approved correction → Use FY Correction.
  - Need to inspect movement history → Read the Stock Card
- Enter rows and preview impact
  - Preview matches physical proof → Submit, approve, and post
  - Preview is wrong → Fix FY, plant, material, location, UOM, quantity, or rate before submit.
- Submit, approve, and post
  - Approved by checker → Post and verify Stock Card balance, WAC, value, and audit trail.
  - Approval blocked → Resolve validation errors, add source proof, or ask a different approver.
- Read the Stock Card
  - Balance is correct → Export if needed and continue operations.
  - Balance is not correct → Enter rows and preview impact
### Inventory Action Flow
- Scan stock state
  - Healthy → Continue monitoring and cycle counts.
  - Mismatch → Reconcile movement
- Reconcile movement
  - Reconciled → Post adjustment with audit reason.
  - Not reconciled → Escalate to store/admin control tower.
### Dispatch: load, slip, send, proof
- Are the units in "Ready to dispatch"?
  - Yes → Tick the lines (or units) onto the loading tray and fill the transporter
  - No → Only units released by Packing Yard appear. Release them there first.
- Tick the lines (or units) onto the loading tray and fill the transporter
  - Closed line on the tray → Tick "Send goods of closed lines" to ship them, or remove them and use "Move to stock".
  - Ready → Create slips: one per order line; print on the Epson
- Create slips: one per order line; print on the Epson
  - Printed → "Mark dispatched" when the vehicle leaves
- "Mark dispatched" when the vehicle leaves
  - Delivered → Record proof of delivery in "Challans & history"; the order closes when every line is delivered.
### Engineering Approval Flow
- Draft technical definition
  - Ready for review → Approve with signoff
  - Incomplete → Complete artwork/cylinder/routing dependencies.
- Approve with signoff
  - Approved → Publish template to operational teams.
### Order Tracking Decision Flow
- Review lifecycle stage
  - Production → Focus active/completed jobs and variance events.
  - Dispatch → Review challans, transit links, and final proof.
### Profile and Security Flow
- Select profile update type
  - Profile fields → Submit and wait for admin approval.
  - Password → Use current password verification and update immediately.
### Inward bill receiving
- Check every bill page against the delivery
  - Stock goods → Does an accepted receipt already exist at this factory?
  - Duplicate, service or cancelled bill → Explain why this paperwork needs no stock receipt
- Does an accepted receipt already exist at this factory?
  - Yes → Match the existing receipt explicitly. Stock is not posted again.
  - No → Create a normal GRN. Keep the bill partial until every required receipt is recorded, then confirm all lines received.
- Explain why this paperwork needs no stock receipt
  - Record reason → Choose the correct resolution code and add an explanation. A bill with linked receipts cannot be voided.
### Bill & document flow
- What is this paper?
  - Stock items → Open GRN from the bill; stock posts through the normal GRN.
  - Job work return → Receive job work on its order; finished goods, balance rolls and wastage are reconciled.
  - Spares, machinery or service → Create a General Receipt; no stock changes.
  - Utility, fee, transport, note → Record-only paper
- Record-only paper
  - Belongs to another bill → Attach it to that bill.
  - Stands alone → File it with bill number, date and amount.
### Outward & gate pass flow
- Is the item stock sold or transferred?
  - Yes → Dispatch/transfer in the ERP prints a QR paper; the gate scans it and the departure matches itself.
  - No — part, tool or equipment → Will it come back?
- Will it come back?
  - Yes → Issue an RGP with the return date; close it with a General Receipt or Receive back.
  - No → Issue an NRGP; it closes when the gate records it.
### Placing a sales order
- Is the customer picked?
  - Yes → Does every line show Ready?
  - No → Type two letters in "Who is this order for?" or pick from the full list. A new customer is added in Sales → Customers.
- Does every line show Ready?
  - Yes → Is the promised dispatch date set?
  - No: a status like Needs rate → Open "Before you place" and press "Fix →": it opens the line or the field. Lines marked "Check the line" must be opened once.
- Is the promised dispatch date set?
  - Yes → Place the order
  - No → Set it in the order row; it starts a week ahead.
- Place the order
  - Placed → The order goes to the planner's queue. Use "Open order" or "Open in planner" on the summary.
  - Error on save → Read the message: usually a master changed or a size is no longer allowed. Fix the line and press "Place order" again; the draft is kept.
### Planning and releasing a line
- Are the line's gates green (Spec, Material, Artwork, Route)?
  - Yes → Is finished or free stock available for it?
  - Artwork pending → Assign an approved artwork (Engineering → Artworks) or keep it deferred; printing cannot start without it.
  - Material short → Check rolls in the width window (±20 mm) or raise a purchase/stock order.
- Is finished or free stock available for it?
  - Yes → Claim the stock (rolls, batches or whole gonnies freed from closed orders) instead of producing.
  - No → Release to the route
- Release to the route
  - Released → Jobs appear on the first work center's terminal.
### Running a job at a work center
- Is the job in the WC queue?
  - Yes → Pick the machine and inputs (rolls, ink, granules)
  - No → The planner has not released it, or the previous step is not finished.
- Pick the machine and inputs (rolls, ink, granules)
  - Done → "Release to machine"
  - No roll fits → Rolls must be within the width window; ask the planner or store.
- "Release to machine"
  - Released → The operator sees it on the machine screen and logs outputs.
### Packing and release to dispatch
- Roll order or pouch order?
  - Rolls → Tick the rolls in this release
  - Pouches → Pack batches into gonnies with inner pouches, then seal with gross weight
- Tick the rolls in this release
  - Done → Tick every packing item used (gonny, sheet/putha, box, tape…)
- Pack batches into gonnies with inner pouches, then seal with gross weight
  - Sealed → Tick every packing item used (gonny, sheet/putha, box, tape…)
  - Held at packing check → A batch whose count differs too much is held; the supervisor clears it on the packing check.
- Tick every packing item used (gonny, sheet/putha, box, tape…)
  - Ticked → Release to Dispatch Bay
  - Item not in the list → Only inner pouches are never listed. Otherwise the item is inactive or set as Inner pouch in Masters → Packaging: change its kind.
- Release to Dispatch Bay
  - Released → Units appear in Dispatch Bay → Ready to dispatch. Ticks are booked by the evening count.
### Evening packing count
- Count every packing item left in the store
  - Entered → Is the counted stock lower than the book?
- Is the counted stock lower than the book?
  - Yes → The difference is the day's use. It is split over the order lines that ticked or marked the item that day (pieces in whole pieces) and booked to them.
  - No one ticked it → The use is shared over that day's packed orders whose packing plan includes the item (first at this location, then plant-wide). It stays on no order only when there are none; then check with packing who used it and tick it next time.
  - Counted more than the book → Excess: check receipts not entered (GRN) before posting.
### Goods made for a closed line
- Line or order is short-closed, completed or cancelled but goods are in the yard
  - Send to the customer → Load it and tick "Send goods of closed lines"
  - Keep as stock → "Move to stock" with a reason
- Load it and tick "Send goods of closed lines"
  - Done → Create and dispatch the slip as usual; POD never reopens the closed line.
- "Move to stock" with a reason
  - Moved → Units leave the order and Dispatch Bay; the planner can claim them for any order with the same spec.
### Visitor at the gate
- Is the visitor registered?
  - Yes (QR or link) → Check in, then check out when leaving
  - No → Watchman adds them in Gate → Visitors → New with photo, or shares the visit link.
- Check in, then check out when leaving
  - Done → The visit shows in the gate register and history.
### Machine breakdown and maintenance
- Raise a breakdown or request from the machine or Maintenance
  - Raised → Technician works and records parts and time
- Technician works and records parts and time
  - Fixed → Close it; downtime shows in the downtime report.
  - Waiting for parts → Keep it open and note the part; the machine stays marked down.
### Quotation to order
- Build the quotation lines like an order
  - Sent → Did the customer accept?
- Did the customer accept?
  - Yes → Convert it to a sales order; lines carry over.
  - No or revised → Revise and resend, or mark it lost with a reason.
### Buying material
- Is the material short for planned work?
  - Yes → Raise the purchase, receive at the gate, then GRN in stores
- Raise the purchase, receive at the gate, then GRN in stores
  - Received → Stock is available to the planner once the GRN is posted.
### Signing in
- Can you sign in?
  - Yes → You land on your role's start page.
  - Wrong password or locked → Ask the admin to reset it in System → Users. Never share passwords.
  - Page not part of your role → Ask the admin to change your role or grant the page.

## निर्णय फ़्लो
### डैशबोर्ड प्रतिक्रिया प्रवाह
- अलर्ट गंभीरता पहचानें
  - गंभीर → प्रमाण सहित एस्केलेट करें
  - संचालनात्मक → निर्धारित कार्रवाई करें
- निर्धारित कार्रवाई करें
  - समाधान → क्लोज़र नोट्स दर्ज करें और कतार जारी रखें।
  - अवरोधित → प्रमाण सहित एस्केलेट करें
- प्रमाण सहित एस्केलेट करें
  - एस्केलेटेड → एस्केलेशन नोट में route, payload और timestamp साझा करें।
### सिस्टम गवर्नेंस प्रवाह
- नीति स्कोप सत्यापित करें
  - वैध → नोट्स के साथ अनुमोदन
  - अवैध → कार्य बिंदुओं के साथ अस्वीकृत
- नोट्स के साथ अनुमोदन
  - पूर्ण → रोल दृश्यता पुनः सत्यापित करें और हितधारकों को सूचित करें।
- कार्य बिंदुओं के साथ अस्वीकृत
  - वापस किया → अनिवार्य सुधारों सहित अनुरोधकर्ता को लौटाएँ।
### फैक्टरी कॉन्फ़िगरेशन प्रवाह
- निर्भरता श्रृंखला जांचें
  - निर्भरता तैयार → सेव और मैपिंग सत्यापित
  - मास्टर अनुपलब्ध → कॉन्फ़िग सेव से पहले मास्टर सेटअप पूरा करें।
- सेव और मैपिंग सत्यापित
  - सत्यापित → डाउनस्ट्रीम निष्पादन स्क्रीन में स्मोक चेक चलाएँ।
### मास्टर डेटा परिवर्तन प्रवाह
- ड्राफ्ट परिवर्तन
  - समीक्षा आवश्यक → डाउनस्ट्रीम प्रभाव सत्यापित
  - तत्काल → डाउनस्ट्रीम प्रभाव सत्यापित
- डाउनस्ट्रीम प्रभाव सत्यापित
  - अनुमोदित → प्रकाशित करें और प्रभावी तिथि संप्रेषित करें।
  - अस्वीकृत → सुधार चेकलिस्ट के साथ वापस करें।
### उत्पादन निष्पादन प्रवाह
- कतार और असाइन
  - असाइन → निष्पादन और मॉनिटर
  - क्षमता समस्या → री-प्लान करें या वैकल्पिक केंद्र में स्थानांतरित करें।
- निष्पादन और मॉनिटर
  - पूर्ण → जॉब बंद करें और रोल/FG पोस्टिंग सत्यापित करें।
  - वैरिएंस → कारण दर्ज करें और अनुमोदन प्रारंभ करें।
### एनालिटिक्स निर्णय प्रवाह
- वैरिएंस पहचानें
  - सीमा के भीतर → ट्रेंड ट्रैक करें, तत्काल कार्रवाई आवश्यक नहीं।
  - आउटलायर → मूल कारण जांच
- मूल कारण जांच
  - कार्यान्वित → सुधारात्मक कार्य और मालिक असाइनमेंट बनाएं।
### Stock Lifecycle Flow
- सही tab चुनें
  - Starting balance या migration → Opening Stock use करें।
  - Open FY में physical count difference → Stock Count use करें।
  - Closed FY approved correction → FY Correction use करें।
  - Movement history inspect करनी है → Stock Card पढ़ें
- Rows enter करें और impact preview करें
  - Preview physical proof से match करता है → Submit, approve और post करें
  - Preview गलत है → Submit से पहले FY, plant, material, location, UOM, quantity या rate fix करें।
- Submit, approve और post करें
  - Checker ने approve किया → Post करें और Stock Card balance, WAC, value और audit trail verify करें।
  - Approval blocked है → Validation errors resolve करें, source proof add करें, या अलग approver से approve कराएं।
- Stock Card पढ़ें
  - Balance correct है → जरूरत हो तो export करें और operations continue करें।
  - Balance correct नहीं है → Rows enter करें और impact preview करें
### इन्वेंट्री कार्रवाई प्रवाह
- स्टॉक स्थिति स्कैन
  - स्वस्थ → निगरानी और साइकिल काउंट जारी रखें।
  - मिसमैच → मूवमेंट मिलान
- मूवमेंट मिलान
  - मिलान → ऑडिट कारण के साथ समायोजन पोस्ट करें।
  - मिलान नहीं → स्टोर/एडमिन कंट्रोल टॉवर को एस्केलेट करें।
### डिस्पैच: लोड, स्लिप, भेजना, सबूत
- क्या यूनिट "Ready to dispatch" में हैं?
  - हाँ → लाइनें (या यूनिट) लोडिंग ट्रे पर टिक करें और ट्रांसपोर्टर भरें
  - नहीं → सिर्फ Packing Yard से रिलीज़ हुए यूनिट दिखते हैं। पहले वहाँ रिलीज़ करें।
- लाइनें (या यूनिट) लोडिंग ट्रे पर टिक करें और ट्रांसपोर्टर भरें
  - ट्रे पर बंद लाइन → भेजने के लिए "Send goods of closed lines" टिक करें, या हटाकर "Move to stock" करें।
  - तैयार → स्लिप बनाएँ: हर ऑर्डर लाइन की एक; Epson पर प्रिंट करें
- स्लिप बनाएँ: हर ऑर्डर लाइन की एक; Epson पर प्रिंट करें
  - प्रिंट हुई → गाड़ी निकलने पर "Mark dispatched"
- गाड़ी निकलने पर "Mark dispatched"
  - डिलीवर हुआ → "Challans & history" में डिलीवरी का सबूत दर्ज करें; हर लाइन डिलीवर होने पर ऑर्डर बंद होता है।
### इंजीनियरिंग अनुमोदन प्रवाह
- तकनीकी परिभाषा ड्राफ्ट
  - समीक्षा हेतु तैयार → साइनऑफ सहित अनुमोदन
  - अपूर्ण → आर्टवर्क/सिलेंडर/रूटिंग निर्भरताएँ पूरी करें।
- साइनऑफ सहित अनुमोदन
  - अनुमोदित → टेम्पलेट को संचालन टीमों के लिए प्रकाशित करें।
### ऑर्डर ट्रैकिंग निर्णय प्रवाह
- लाइफसायकल चरण समीक्षा
  - उत्पादन → सक्रिय/पूर्ण जॉब और वैरिएंस इवेंट पर ध्यान दें।
  - डिस्पैच → चालान, ट्रांजिट लिंक और अंतिम प्रमाण की समीक्षा करें।
### प्रोफाइल और सुरक्षा प्रवाह
- प्रोफाइल अपडेट प्रकार चुनें
  - प्रोफाइल फ़ील्ड → सबमिट करें और एडमिन अनुमोदन की प्रतीक्षा करें।
  - पासवर्ड → वर्तमान पासवर्ड सत्यापन के साथ तुरंत अपडेट करें।
### इनवर्ड बिल प्राप्ति
- हर बिल पृष्ठ को डिलीवरी से जाँचें
  - स्टॉक माल → क्या इसी फैक्ट्री पर स्वीकार रसीद पहले से है?
  - डुप्लिकेट, सेवा या रद्द बिल → समझाएं कि इस कागज़ की स्टॉक रसीद क्यों नहीं चाहिए
- क्या इसी फैक्ट्री पर स्वीकार रसीद पहले से है?
  - हाँ → मौजूदा रसीद स्पष्ट रूप से मिलाएँ. स्टॉक दोबारा नहीं बढ़ता.
  - नहीं → सामान्य GRN बनाएं. सभी आवश्यक रसीद दर्ज होने तक बिल आंशिक रखें, फिर सभी लाइन प्राप्त होने की पुष्टि करें.
- समझाएं कि इस कागज़ की स्टॉक रसीद क्यों नहीं चाहिए
  - कारण दर्ज करें → सही समाधान कोड चुनें और कारण दें. जुड़ी रसीद वाला बिल रद्द नहीं हो सकता.
### बिल व दस्तावेज़ प्रवाह
- यह कागज़ क्या है?
  - स्टॉक सामान → बिल से GRN खोलें; स्टॉक सामान्य GRN से दर्ज होता है.
  - जॉब वर्क वापसी → उसके ऑर्डर पर जॉब वर्क प्राप्त करें; तैयार माल, बचे रोल और वेस्टेज का मिलान होता है.
  - स्पेयर्स, मशीनरी या सर्विस → जनरल रसीद बनाएं; स्टॉक नहीं बदलता.
  - बिजली, फ़ीस, ट्रांसपोर्ट, नोट → केवल रिकॉर्ड कागज़
- केवल रिकॉर्ड कागज़
  - किसी अन्य बिल का हिस्सा → उसे उस बिल से संलग्न करें.
  - अलग कागज़ → बिल नंबर, तारीख और राशि के साथ फ़ाइल करें.
### बाहर जाना व गेट पास प्रवाह
- क्या सामान बेचा या ट्रांसफ़र किया स्टॉक है?
  - हाँ → ERP में डिस्पैच/ट्रांसफ़र QR कागज़ छापता है; गेट उसे स्कैन करता है और रवानगी स्वयं मिल जाती है.
  - नहीं — पुर्ज़ा, औज़ार या उपकरण → क्या यह वापस आएगा?
- क्या यह वापस आएगा?
  - हाँ → वापसी तारीख के साथ RGP जारी करें; जनरल रसीद या Receive back से बंद करें.
  - नहीं → NRGP जारी करें; गेट द्वारा दर्ज होते ही बंद हो जाता है.
### सेल्स ऑर्डर बनाना
- क्या कस्टमर चुना गया है?
  - हाँ → क्या हर लाइन Ready दिखा रही है?
  - नहीं → "Who is this order for?" में दो अक्षर लिखें या पूरी लिस्ट से चुनें। नया कस्टमर Sales → Customers में जोड़ें।
- क्या हर लाइन Ready दिखा रही है?
  - हाँ → क्या Promised dispatch तारीख भरी है?
  - नहीं: Needs rate जैसा स्टेटस → "Before you place" खोलें और "Fix →" दबाएँ: लाइन या फ़ील्ड खुल जाएगा। "Check the line" वाली लाइन एक बार खोलनी ज़रूरी है।
- क्या Promised dispatch तारीख भरी है?
  - हाँ → ऑर्डर प्लेस करें
  - नहीं → ऑर्डर वाली पंक्ति में भरें; यह एक हफ़्ता आगे से शुरू होती है।
- ऑर्डर प्लेस करें
  - प्लेस हो गया → ऑर्डर प्लानर की कतार में चला जाता है। सारांश पर "Open order" या "Open in planner" दबाएँ।
  - सेव पर एरर → मैसेज पढ़ें: अक्सर मास्टर बदला होता है या साइज़ अब allowed नहीं। लाइन ठीक करके फिर "Place order" दबाएँ; ड्राफ़्ट सुरक्षित रहता है।
### लाइन प्लान करके रिलीज़ करना
- क्या लाइन के gates हरे हैं (Spec, Material, Artwork, Route)?
  - हाँ → क्या इसके लिए तैयार या फ्री स्टॉक है?
  - आर्टवर्क बाकी → Approved artwork लगाएँ (Engineering → Artworks); इसके बिना प्रिंटिंग शुरू नहीं होगी।
  - मटीरियल कम → ±20 mm विंडो में रोल देखें या खरीद/स्टॉक ऑर्डर बनाएँ।
- क्या इसके लिए तैयार या फ्री स्टॉक है?
  - हाँ → बनाने की बजाय स्टॉक claim करें (रोल, बैच या बंद ऑर्डर से फ्री हुए पूरे gonny)।
  - नहीं → रूट पर रिलीज़ करें
- रूट पर रिलीज़ करें
  - रिलीज़ हुआ → जॉब पहले वर्क-सेंटर के टर्मिनल पर दिखते हैं।
### वर्क-सेंटर पर जॉब चलाना
- क्या जॉब WC की कतार में है?
  - हाँ → मशीन और इनपुट चुनें (रोल, इंक, ग्रेन्यूल)
  - नहीं → प्लानर ने रिलीज़ नहीं किया या पिछला स्टेप पूरा नहीं हुआ।
- मशीन और इनपुट चुनें (रोल, इंक, ग्रेन्यूल)
  - हो गया → "Release to machine"
  - कोई रोल फिट नहीं → रोल चौड़ाई विंडो में होने चाहिए; प्लानर या स्टोर से पूछें।
- "Release to machine"
  - रिलीज़ → ऑपरेटर मशीन स्क्रीन पर देखकर आउटपुट दर्ज करता है।
### पैकिंग और डिस्पैच के लिए रिलीज़
- रोल ऑर्डर या पाउच ऑर्डर?
  - रोल → इस रिलीज़ के रोल टिक करें
  - पाउच → बैच को inner pouch के साथ gonny में पैक करें, फिर gross weight से सील करें
- इस रिलीज़ के रोल टिक करें
  - हो गया → इस्तेमाल हुए हर पैकिंग आइटम को टिक करें (gonny, sheet/putha, box, tape…)
- बैच को inner pouch के साथ gonny में पैक करें, फिर gross weight से सील करें
  - सील हुआ → इस्तेमाल हुए हर पैकिंग आइटम को टिक करें (gonny, sheet/putha, box, tape…)
  - पैकिंग चेक पर होल्ड → जिस बैच की गिनती बहुत अलग है वह होल्ड होता है; सुपरवाइज़र पैकिंग चेक पर क्लियर करता है।
- इस्तेमाल हुए हर पैकिंग आइटम को टिक करें (gonny, sheet/putha, box, tape…)
  - टिक किया → Dispatch Bay को रिलीज़
  - आइटम लिस्ट में नहीं → सिर्फ inner pouch लिस्ट में नहीं आते। वरना आइटम inactive है या Masters → Packaging में Inner pouch kind में है: kind बदलें।
- Dispatch Bay को रिलीज़
  - रिलीज़ → यूनिट Dispatch Bay → Ready to dispatch में दिखते हैं। टिक शाम की गिनती में बुक होते हैं।
### शाम की पैकिंग गिनती
- स्टोर में बचे हर पैकिंग आइटम को गिनें
  - भर दिया → क्या गिना हुआ स्टॉक बुक से कम है?
- क्या गिना हुआ स्टॉक बुक से कम है?
  - हाँ → अंतर दिन का इस्तेमाल है। यह उन ऑर्डर लाइनों में बँटता है जिन्होंने उस दिन वह आइटम टिक किया या जिन पर उसका निशान लगा (पीस पूरे-पूरे) और उन पर बुक होता है।
  - किसी ने टिक नहीं किया → इस्तेमाल उस दिन पैक हुए उन ऑर्डरों में बँटता है जिनके packing plan में वह आइटम है (पहले इस लोकेशन पर, फिर पूरे प्लांट में)। ऐसे ऑर्डर न हों तभी यह किसी ऑर्डर पर नहीं जाता; तब पैकिंग से पूछें और अगली बार टिक करवाएँ।
  - बुक से ज़्यादा गिना → ज़्यादा: पोस्ट करने से पहले न दर्ज हुई रसीद (GRN) जाँचें।
### बंद लाइन के लिए बना माल
- लाइन/ऑर्डर short-close, complete या cancel है पर माल यार्ड में है
  - कस्टमर को भेजें → लोड करें और "Send goods of closed lines" टिक करें
  - स्टॉक में रखें → कारण के साथ "Move to stock"
- लोड करें और "Send goods of closed lines" टिक करें
  - हो गया → स्लिप हमेशा की तरह बनाकर डिस्पैच करें; POD बंद लाइन को दोबारा नहीं खोलता।
- कारण के साथ "Move to stock"
  - हो गया → यूनिट ऑर्डर और Dispatch Bay से हट जाते हैं; प्लानर इन्हें उसी स्पेक के किसी भी ऑर्डर के लिए claim कर सकता है।
### गेट पर विज़िटर
- क्या विज़िटर रजिस्टर है?
  - हाँ (QR या लिंक) → अंदर आते समय check in, जाते समय check out
  - नहीं → चौकीदार Gate → Visitors → New में फ़ोटो के साथ जोड़े या विज़िट लिंक भेजे।
- अंदर आते समय check in, जाते समय check out
  - हो गया → विज़िट गेट रजिस्टर और हिस्ट्री में दिखती है।
### मशीन ब्रेकडाउन और मेंटेनेंस
- मशीन या Maintenance से ब्रेकडाउन/रिक्वेस्ट बनाएँ
  - बन गया → टेक्नीशियन काम करके पार्ट्स और समय दर्ज करे
- टेक्नीशियन काम करके पार्ट्स और समय दर्ज करे
  - ठीक हुआ → बंद करें; डाउनटाइम रिपोर्ट में दिखता है।
  - पार्ट्स का इंतज़ार → खुला रखें और पार्ट लिखें; मशीन down दिखेगी।
### कोटेशन से ऑर्डर
- ऑर्डर की तरह कोटेशन लाइनें बनाएँ
  - भेज दिया → क्या कस्टमर ने माना?
- क्या कस्टमर ने माना?
  - हाँ → इसे सेल्स ऑर्डर में बदलें; लाइनें साथ आती हैं।
  - नहीं या बदलाव → बदलकर फिर भेजें या कारण के साथ lost करें।
### मटीरियल खरीदना
- क्या प्लान किए काम के लिए मटीरियल कम है?
  - हाँ → खरीद बनाएँ, गेट पर रिसीव करें, फिर स्टोर में GRN
- खरीद बनाएँ, गेट पर रिसीव करें, फिर स्टोर में GRN
  - आ गया → GRN पोस्ट होते ही स्टॉक प्लानर को मिलता है।
### साइन इन
- क्या साइन इन हो रहा है?
  - हाँ → आप अपनी भूमिका के शुरुआती पेज पर पहुँचते हैं।
  - गलत पासवर्ड या लॉक → एडमिन से System → Users में रीसेट करवाएँ। पासवर्ड किसी को न बताएँ।
  - पेज आपकी भूमिका में नहीं → एडमिन से भूमिका बदलवाएँ या पेज की अनुमति लें।
