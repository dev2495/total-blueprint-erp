# Maintenance

## Overview (English)
# Maintenance module

Maintenance keeps machines running. It plans routine checks and services, records the work done on each job, takes fault reports from the floor, tracks repairs until the machine is back, and reports compliance and downtime. Floor staff use it mostly on a phone by scanning the QR stuck on the machine.

## Screens and how they connect
- **Maintenance today** (/maintenance) — the board: Due today, Overdue, Open faults, Awaiting repair (machines down), Awaiting verification. Refreshes every minute. "Report a fault" and "All jobs" buttons.
- **Maintenance jobs** (/maintenance/jobs) — every job with filters Mine, Open, Overdue, To verify, Done, All. Technicians see "My maintenance jobs". Supervisors can "Add job".
- **Job record** (/maintenance/jobs/[id]) — one job full page; the phone lands here from a machine scan. Has "Edit history".
- **Machine faults** (/maintenance/faults) — report, assign, repair, resolve, close faults.
- **Machine history** (/maintenance/machines/[id]) — timeline of jobs, faults and downtime for one machine.
- **Maintenance schedules** (/maintenance/schedules) — planned checks per machine with checklists.
- **QR codes** (/maintenance/qr) — print posters for machines and stock locations.
- **Maintenance reports** (/maintenance/reports) — compliance, downtime, recurring faults, spares and time, workload.

## Main flows
**Planned maintenance**
1. Supervisor creates a schedule: machine, kind (Operator check or Technician service), interval (days, weeks, months or running hours), due rule, first due date, checklist.
2. Every morning at 05:30 due jobs are created ("Create due jobs now" does it at once).
3. The operator or technician opens the job, presses "Start", answers each check OK / Issue / Can't check, enters readings, spares (note only), time, photos and a note.
4. Outcome: "Completed", "Issue found" (raises a fault) or "Unable" (reason needed).
5. If the job needs verification, it goes to "Awaiting verification"; the supervisor presses "Verified" or "Send back" with a note.

**Breakdown**
1. Anyone with the right presses "Report a fault", picks the machine, writes what is wrong, picks severity, ticks "Machine has stopped" if down. The running production step is paused as a breakdown and maintenance is notified.
2. Supervisor opens the fault and presses "Assign and create repair job". HIGH and CRITICAL repairs need verification.
3. Technician marks "In repair", fixes it, writes what was done and presses "Resolved". If no other stopped fault remains, the machine goes back to ACTIVE.
4. Supervisor presses "Close fault" (or "Dismiss" for a false report).

## Rules and limits
- Fixed-calendar schedules keep their dates even when work is late; interval schedules count from the last completion.
- A reading outside min–max marks that check as Issue automatically.
- "Completed" needs every check answered; "Issue found" and "Unable" need a reason.
- Spares are notes only (item, qty, ₹ cost); they do not issue stock.
- Photos: JPEG, PNG, WebP, HEIC or PDF, up to 8 MB.
- Resolve and dismiss need a note. Only maintenance staff change repair status.
- Critical schedules are always verified.

## Who does what
- **Operator**: sees the board and faults, reports faults, does operator checks.
- **Maintenance Tech**: board, jobs and faults; starts and completes jobs, marks repairs.
- **Maintenance Supervisor / Plant Manager**: everything above plus schedules, assignment, verification, QR codes and reports.
- **Work Center Manager**: board view and fault reporting.

## Problems and fixes
- *"Save record" is grey*: answer every check or write a reason.
- *"Send back" is grey*: write a verification note.
- *"You cannot report faults."*: your role has no maintenance log right; ask the admin.
- *"Only maintenance staff can add jobs by hand."*: ask a supervisor.
- *Due job missing*: check the schedule is active and the first due date; press "Create due jobs now".
- *Machine still DOWN after repair*: another open fault on the same machine says it is stopped; resolve that too.

## सारांश (हिंदी)
# Maintenance (रखरखाव) module

Maintenance machine को चालू रखता है। यह रोज़ के check और service की योजना बनाता है, हर job का काम दर्ज करता है, floor से खराबी लेता है, machine ठीक होने तक repair पर नज़र रखता है, और compliance व downtime की रिपोर्ट देता है। Floor के लोग इसे ज़्यादातर phone पर machine पर लगे QR को scan करके चलाते हैं।

## स्क्रीन और उनका जुड़ाव
- **Maintenance today** (/maintenance) — board: Due today, Overdue, Open faults, Awaiting repair (बंद machine), Awaiting verification। हर मिनट ताज़ा। "Report a fault" और "All jobs" बटन।
- **Maintenance jobs** (/maintenance/jobs) — सभी job, filter Mine, Open, Overdue, To verify, Done, All। Technician को "My maintenance jobs" दिखता है। Supervisor "Add job" कर सकते हैं।
- **Job record** (/maintenance/jobs/[id]) — एक job का पूरा पेज; machine scan करने पर phone यहीं आता है। इसमें "Edit history" है।
- **Machine faults** (/maintenance/faults) — खराबी दर्ज, assign, repair, resolve, close।
- **Machine history** (/maintenance/machines/[id]) — एक machine के job, खराबी और downtime की timeline।
- **Maintenance schedules** (/maintenance/schedules) — हर machine के planned check, checklist के साथ।
- **QR codes** (/maintenance/qr) — machine और stock location के poster print करें।
- **Maintenance reports** (/maintenance/reports) — compliance, downtime, बार-बार की खराबी, पुर्ज़े और समय, काम का बोझ।

## मुख्य काम
**Planned maintenance**
1. Supervisor schedule बनाता है: machine, kind (Operator check या Technician service), अंतराल (दिन, हफ्ते, महीने या running hours), due rule, first due date, checklist।
2. हर सुबह 05:30 पर due job बनते हैं ("Create due jobs now" से तुरंत)।
3. Operator या technician job खोलकर "Start" दबाता है, हर check पर OK / Issue / Can't check चुनता है, reading, पुर्ज़े (सिर्फ note), समय, photo और note भरता है।
4. नतीजा: "Completed", "Issue found" (fault बनता है) या "Unable" (कारण ज़रूरी)।
5. Verification वाला job "Awaiting verification" में जाता है; supervisor "Verified" या note के साथ "Send back" दबाता है।

**Breakdown**
1. अनुमति वाला कोई भी "Report a fault" दबाता है, machine चुनता है, खराबी लिखता है, severity चुनता है, machine बंद हो तो "Machine has stopped" tick करता है। चल रहा production step breakdown बनकर रुक जाता है और maintenance को सूचना जाती है।
2. Supervisor fault खोलकर "Assign and create repair job" दबाता है। HIGH और CRITICAL repair की जाँच ज़रूरी है।
3. Technician "In repair" करता है, ठीक करके क्या किया लिखता है और "Resolved" दबाता है। उस machine पर कोई और बंद-machine वाली खराबी न हो तो machine फिर ACTIVE हो जाती है।
4. Supervisor "Close fault" दबाता है (गलत रिपोर्ट पर "Dismiss")।

## नियम और सीमाएँ
- Fixed-calendar schedule काम late होने पर भी तारीख नहीं बदलता; interval schedule आखिरी काम से गिनता है।
- Reading min–max से बाहर हो तो check अपने आप Issue हो जाता है।
- "Completed" के लिए हर check का जवाब चाहिए; "Issue found" और "Unable" में कारण चाहिए।
- पुर्ज़े सिर्फ note हैं (item, मात्रा, ₹ लागत); stock से नहीं घटते।
- Photo: JPEG, PNG, WebP, HEIC या PDF, 8 MB तक।
- Resolve और dismiss के लिए note ज़रूरी। Repair status सिर्फ maintenance staff बदलते हैं।
- Critical schedule हमेशा verify होता है।

## कौन क्या करता है
- **Operator**: board और खराबी देखता है, खराबी दर्ज करता है, operator check करता है।
- **Maintenance Tech**: board, job और खराबी; job शुरू और पूरा करता है, repair दर्ज करता है।
- **Maintenance Supervisor / Plant Manager**: ऊपर का सब, साथ में schedule, assign, verify, QR code और रिपोर्ट।
- **Work Center Manager**: board देखना और खराबी दर्ज करना।

## समस्या और हल
- *"Save record" grey*: हर check का जवाब दें या कारण लिखें।
- *"Send back" grey*: verification note लिखें।
- *"You cannot report faults."*: आपके role को maintenance log अनुमति नहीं; admin से कहें।
- *"Only maintenance staff can add jobs by hand."*: supervisor से कहें।
- *Due job नहीं आया*: देखें schedule चालू है और first due date सही है; "Create due jobs now" दबाएँ।
- *Repair के बाद भी machine DOWN*: उसी machine की कोई और खुली खराबी में machine बंद लिखा है; उसे भी resolve करें।

## Every screen (English)

### Maintenance today (/maintenance)
Screen address: /maintenance · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, MAINTENANCE_SUPERVISOR, MAINTENANCE_TECH, WORK_CENTER_MANAGER, OPERATOR · Share link: https://erp.totalpolyprint.com/guide?page=maintenance

The maintenance board: five numbers (Due today, Overdue, Open faults, Awaiting repair, Awaiting verification) and the list behind each. Refreshes every minute.

Start the shift here. See what is due, what is late, which machines are down, and sign off finished work. Report a fault from any machine.

**Before you start**
- Machines in Factory; maintenance schedules for due jobs.
- Verify needs maintenance manage rights (supervisor / plant manager).

**Step by step**
1. Pick the plant, or keep "All plants".
2. Tap a number tile to see its list.
3. Tap a job to open its record and work on it.
4. In "Awaiting verification", tap a job, read checks, and press "Verified" — or write a note and press "Send back".
5. Press "Report a fault" to raise a breakdown.
6. Press "All jobs" for the full job list.

**What is on the screen**
- **Due today**: Jobs planned for today.
- **Overdue**: Open jobs whose planned date has passed.
- **Open faults**: Faults not yet resolved; red when the machine is stopped. "Open" link goes to the fault.
- **Awaiting repair**: Machines down; "History" opens the machine history.
- **Awaiting verification**: Completed jobs waiting for supervisor sign-off.
- **Verification note**: Required when pressing "Send back".

**Common problems and fixes**
- "Could not verify — Only completed work awaiting verification can be verified." — Someone already verified or the job changed; the list refreshes within a minute.
- ""Send back" button grey" — Write a verification note first.

**If stuck**
1. Without manage rights, tapping a waiting job opens the record instead of the verify box.
2. Numbers show "–" while loading; wait or refresh.

Related pages: /maintenance/jobs, /maintenance/faults, /maintenance/machines/[id], /maintenance/schedules

**Not done yet / watch out**
- Non-supervisors tapping a job in "Awaiting verification" get the job record, not a verify option, with no message why.

### Machine faults (/maintenance/faults)
Screen address: /maintenance/faults · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, MAINTENANCE_SUPERVISOR, MAINTENANCE_TECH, OPERATOR · Share link: https://erp.totalpolyprint.com/guide?page=maintenance-faults

All machine faults reported from the floor. Assigning a fault creates the repair job; resolving brings a stopped machine back to active.

Operators report here; supervisors assign; technicians mark "In repair" and "Resolved"; supervisors close.

**Before you start**
- Fault reporting right (maintenance log/work/manage).

**Step by step**
1. Press "Report a fault", choose "Machine", write "What is wrong?", details, severity LOW/MEDIUM/HIGH/CRITICAL.
2. Tick "Machine has stopped" if it is down, then press "Report". The running step is paused as a breakdown.
3. Supervisor: tap the fault, choose "Assign to", press "Assign and create repair job".
4. Add photos with the photo button; "Open repair job" opens the job.
5. Technician: press "In repair"; when fixed write "What was done" and press "Resolved".
6. Supervisor: press "Close fault" on a resolved fault, or "Dismiss" (with note) for a false report.

**What is on the screen**
- **Open / Machine stopped / Showing**: Open faults, open faults with machine stopped, and rows in the list.
- **Open / All**: Filter: only OPEN/ASSIGNED/IN_REPAIR, or every fault.
- **Status**: Open, Assigned, In repair, Resolved, Closed, Dismissed.
- **Severity**: LOW, MEDIUM, HIGH, CRITICAL. HIGH and CRITICAL repair jobs need verification.
- **Resolution note**: Required to resolve or dismiss.

**Common problems and fixes**
- "Could not report — You cannot report faults." — Your role lacks maintenance log rights; ask the admin.
- "Only maintenance staff can change repair status." — Operators can report but not repair; ask a technician.
- "File is larger than 8 MB. / Only photos (JPEG, PNG, WebP, HEIC) and PDF are accepted." — Use a smaller photo or a PDF.

**If stuck**
1. "Report" stays grey until a machine and a title are filled.
2. If a repair job already exists, assigning does not create a second one.

Related pages: /maintenance, /maintenance/jobs, /maintenance/machines/[id]

**Not done yet / watch out**
- The fault list has no machine or severity filter; only Open/All.

### Maintenance jobs (/maintenance/jobs)
Screen address: /maintenance/jobs · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, MAINTENANCE_SUPERVISOR, MAINTENANCE_TECH · Share link: https://erp.totalpolyprint.com/guide?page=maintenance-jobs

All maintenance jobs (scheduled checks, technician services, repair jobs). Technicians see "My maintenance jobs" by default.

Tap a job to record the work: checks, readings, spares used, time and outcome. Supervisors can add one-off jobs.

**Before you start**
- maintenance work or manage rights.

**Step by step**
1. Pick a filter: "Mine", "Open", "Overdue", "To verify", "Done", "All"; and a machine.
2. Tap a job; press "Start".
3. Answer each check: "OK", "Issue" or "Can't check"; type readings.
4. Add spares ("Add spare"), "Time taken", photos ("Add photo") and a note.
5. Choose outcome "Completed", "Issue found" or "Unable" (reason needed for the last two).
6. Press "Save record" or "Submit for verification".
7. Supervisor: "Add job" → machine, "What needs doing", date, kind, notes, "Needs supervisor verification" → "Add".

**What is on the screen**
- **In this list / Open / Overdue**: Counts for the current filter.
- **Job status**: Due, In progress, Done, Awaiting verification, Verified, Issue found, Could not complete, Cancelled; red "overdue" tag.
- **Kind**: "Technician service" or "Operator check".
- **Reading**: Out of the min–max range sets the check to Issue automatically.
- **Spares used (note only)**: Item, qty and ₹ cost; a note only — no stock is issued.

**Common problems and fixes**
- "Job is DONE; only due work can be started." — The job is already closed.
- "A reason is required when the work is not completed cleanly." — Write the reason for Issue found / Unable.
- "Only maintenance staff can add jobs by hand." — Ask a supervisor to add it.
- "n check(s) marked "Issue". Choose "Issue found" …" — Pick "Issue found" so a fault is raised, or correct the check.

**If stuck**
1. "Save record" stays grey until all checks are answered (for Completed) or a reason is written.

Related pages: /maintenance, /maintenance/jobs/[id], /maintenance/faults, /maintenance/schedules

**Not done yet / watch out**
- Spares used on a job are notes only and do not issue stock from inventory.

### Maintenance job record (/maintenance/jobs/[id])
Screen address: /maintenance/jobs/[id] · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, MAINTENANCE_SUPERVISOR, MAINTENANCE_TECH, OPERATOR · Share link: https://erp.totalpolyprint.com/guide?page=maintenance-jobs-id

Full-page record of one maintenance job; the phone lands here after scanning a machine QR. Same record as the job dialog, plus "Edit history".

Work the job on the floor and close it with an outcome. Closed jobs show read only.

**Before you start**
- A job id (from a list, link or QR scan).

**Step by step**
1. Press "Start".
2. Answer "Checks" with "OK" / "Issue" / "Can't check"; enter readings.
3. Fill spares, "Time taken", "Add photo", "Note".
4. Choose "Completed", "Issue found" (fault name, severity, "Machine has stopped") or "Unable".
5. Press "Save record" / "Submit for verification".
6. "Machine card" opens the machine's scan card.

**What is on the screen**
- **Edit history**: Time, person and action for every change.
- **Machine has stopped**: With "Issue found": the running production step is paused as a breakdown.
- **Status line**: "Waiting for a supervisor to verify.", "Verified …" or "Closed." when not editable.

**Common problems and fixes**
- "Job is already DONE." — Someone closed it; reload.
- "You cannot start maintenance work." — Your role cannot start this kind of job.

**If stuck**
1. If the title stays "Loading…" or "Job", the id is wrong; open from the jobs list.

Related pages: /maintenance/jobs, /maintenance/machines/[id], /maintenance

### Machine history (/maintenance/machines/[id])
Screen address: /maintenance/machines/[id] · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, MAINTENANCE_SUPERVISOR, MAINTENANCE_TECH, WORK_CENTER_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=maintenance-machines-id

Everything done on one machine in date order: jobs, faults and downtime, with totals.

Open it from "History" on the board to see a machine's record before a repair or a decision.

**Before you start**
- A machine id.

**Step by step**
1. Read tiles "Jobs", "Faults", "Downtime events", "Spares noted".
2. Scroll the "Timeline"; tap a job title to open it.
3. Press "Machine card" for the scan card.

**What is on the screen**
- **Spares noted**: ₹ total of spares noted on jobs.
- **DOWNTIME rows**: Reason, hours, job number; "from terminal pause" when logged by a pause.

**If stuck**
1. Empty timeline means nothing has been logged for this machine yet.

Related pages: /maintenance, /maintenance/jobs/[id], /maintenance/faults

### QR codes for machines and locations (/maintenance/qr)
Screen address: /maintenance/qr · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, MAINTENANCE_SUPERVISOR · Share link: https://erp.totalpolyprint.com/guide?page=maintenance-qr

Printable QR posters for every machine and stock location.

Print, laminate and stick one on each machine and location. Anyone signed in scans it from the ERP header and lands on that machine or location with the panels for their role.

**Before you start**
- Machines and locations in Factory setup.

**Step by step**
1. Choose the plant.
2. Tap "Machines", "Locations" or "All".
3. Press "Print N posters", or "Print just this one" on a single poster.
4. "← Show all" returns to the full list.

**What is on the screen**
- **Machines / Locations / All**: Counts and filter.

**If stuck**
1. If a poster is missing, check that the machine or location exists in the chosen plant.

Related pages: /maintenance, /maintenance/schedules

### Maintenance reports (/maintenance/reports)
Screen address: /maintenance/reports · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, MAINTENANCE_SUPERVISOR · Share link: https://erp.totalpolyprint.com/guide?page=maintenance-reports

Compliance per month, breakdowns and downtime, recurring faults (90 days), spares and time, and technician workload.

Review maintenance performance weekly or monthly and find machines that keep failing.

**Before you start**
- Closed jobs and downtime logs.

**Step by step**
1. Choose the plant.
2. Read "Done on time", "Scheduled jobs closed", "Breakdowns", "Breakdown hours".
3. Switch tabs: "Compliance", "Breakdowns & downtime", "Recurring faults", "Spares & time", "Technician workload".

**What is on the screen**
- **Compliance**: Month, Scheduled, On time, Late, Missed, Open, On-time %.
- **Breakdowns & downtime**: From the production downtime log: breakdowns, breakdown h, maintenance h, other stops h, events.
- **Recurring faults**: Fault, times, stopped machine, last.
- **Technician workload**: Person, open, overdue, done (30 d), avg hours to close.

**If stuck**
1. Empty tables mean nothing in the period (e.g. "No downtime recorded in the period.").

Related pages: /maintenance, /maintenance/machines/[id]

**Not done yet / watch out**
- Reports cannot be exported or printed and the period is fixed (e.g. 90 days, 3 months, 30 days).

### Maintenance schedules (/maintenance/schedules)
Screen address: /maintenance/schedules · Roles: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, MAINTENANCE_SUPERVISOR · Share link: https://erp.totalpolyprint.com/guide?page=maintenance-schedules

Planned maintenance per machine: daily, weekly, monthly or running-hour intervals with a checklist. Due jobs are created every morning at 05:30.

Set up once per machine. Fixed-calendar schedules never drift when work is late; interval schedules count from the last completion.

**Before you start**
- Machines in Factory; maintenance manage rights.

**Step by step**
1. Press "New schedule" (or tap an existing row).
2. Pick "Machine" and kind: "Operator check (short, on the machine)" or "Technician service (detailed job)".
3. Enter name (e.g. Daily start-up check) and Hindi name.
4. Set interval ("Every N days/weeks/months/running hours") and N; choose the due rule; set "First due date".
5. Choose responsible person or "Anyone in the role"; tick "Critical (always verified)", "Supervisor verifies", "Needs a production stop"; set "Est. minutes".
6. Build the checklist: "Use starter checks" or "Add check" (OK / Issue or Reading with unit, min, max).
7. Press "Save". Use "Create due jobs now" to generate today's jobs immediately; "Switch off" stops a schedule.

**What is on the screen**
- **Due rule**: "Fixed calendar (late work does not move the next date)" or "Interval after the last completion".
- **Row summary**: Kind, interval, rule, next due, last done, number of checks.
- **Starter checks**: Oil level, Unusual noise or vibration, Leaks, Safety guards in place.

**Common problems and fixes**
- "Could not save" — Check machine, name and first due date; read the message shown.

**If stuck**
1. "Save" is grey until machine, name and first due date are filled.
2. If a due job did not appear, press "Create due jobs now".

Related pages: /maintenance, /maintenance/jobs, /maintenance/qr

**Not done yet / watch out**
- Schedules can only be switched off, not deleted, and there is no copy-to-other-machines action.

## हर स्क्रीन (हिंदी)

### आज का रखरखाव (Maintenance today) (/maintenance)
स्क्रीन का पता: /maintenance · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, MAINTENANCE_SUPERVISOR, MAINTENANCE_TECH, WORK_CENTER_MANAGER, OPERATOR · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=maintenance&lang=hi

Maintenance board: पाँच गिनती (Due today, Overdue, Open faults, Awaiting repair, Awaiting verification) और हर गिनती के पीछे की सूची। हर मिनट अपने आप ताज़ा होता है।

Shift की शुरुआत यहीं से करें। क्या due है, क्या late है, कौन सी machine बंद है देखें, और पूरा काम sign off करें। किसी भी machine की खराबी यहीं से दर्ज करें।

**शुरू करने से पहले**
- Factory में machine; due job के लिए maintenance schedule।
- Verify के लिए maintenance manage अनुमति (supervisor / plant manager)।

**स्टेप बाय स्टेप**
1. Plant चुनें, या "All plants" रखें।
2. सूची देखने के लिए गिनती वाले tile पर tap करें।
3. Job पर tap करके record खोलें और काम दर्ज करें।
4. "Awaiting verification" में job पर tap करें, checks पढ़ें, और "Verified" दबाएँ — या note लिखकर "Send back" दबाएँ।
5. खराबी दर्ज करने के लिए "Report a fault" दबाएँ।
6. पूरी job सूची के लिए "All jobs" दबाएँ।

**स्क्रीन पर क्या है**
- **Due today**: आज के planned job।
- **Overdue**: खुले job जिनकी planned तारीख निकल गई।
- **Open faults**: जो खराबी अभी ठीक नहीं हुई; machine बंद हो तो लाल। "Open" link fault पर ले जाता है।
- **Awaiting repair**: बंद machine; "History" machine का इतिहास खोलता है।
- **Awaiting verification**: पूरे job जिनकी supervisor जाँच बाकी है।
- **Verification note**: "Send back" दबाने पर ज़रूरी।

**आम दिक्कतें और हल**
- "Could not verify — Only completed work awaiting verification can be verified." — किसी ने पहले verify कर दिया या job बदला; सूची एक मिनट में ताज़ा होगी।
- ""Send back" बटन grey" — पहले verification note लिखें।

**अटक गए तो**
1. Manage अनुमति के बिना waiting job पर tap करने से verify box नहीं, record खुलता है।
2. Load होते समय "–" दिखता है; रुकें या refresh करें।

जुड़े पेज: /maintenance/jobs, /maintenance/faults, /maintenance/machines/[id], /maintenance/schedules

**अभी नहीं होता / ध्यान दें**
- Supervisor के अलावा कोई "Awaiting verification" के job पर tap करे तो verify नहीं, record खुलता है, और कारण नहीं बताया जाता।

### Machine faults (मशीन की खराबी) (/maintenance/faults)
स्क्रीन का पता: /maintenance/faults · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, MAINTENANCE_SUPERVISOR, MAINTENANCE_TECH, OPERATOR · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=maintenance-faults&lang=hi

Floor से दर्ज सभी machine खराबी। Fault assign करने पर repair job बनता है; resolve करने पर बंद machine फिर active हो जाती है।

Operator यहाँ दर्ज करते हैं; supervisor assign करते हैं; technician "In repair" और "Resolved" करते हैं; supervisor close करते हैं।

**शुरू करने से पहले**
- खराबी दर्ज करने की अनुमति (maintenance log/work/manage)।

**स्टेप बाय स्टेप**
1. "Report a fault" दबाएँ, "Machine" चुनें, "What is wrong?" लिखें, details और severity LOW/MEDIUM/HIGH/CRITICAL।
2. Machine बंद हो तो "Machine has stopped" tick करें, फिर "Report" दबाएँ। चल रहा step breakdown के रूप में रुक जाता है।
3. Supervisor: fault पर tap करें, "Assign to" चुनें, "Assign and create repair job" दबाएँ।
4. Photo बटन से photo जोड़ें; "Open repair job" से job खोलें।
5. Technician: "In repair" दबाएँ; ठीक होने पर "What was done" लिखकर "Resolved" दबाएँ।
6. Supervisor: resolved fault पर "Close fault" दबाएँ, या गलत रिपोर्ट पर (note के साथ) "Dismiss"।

**स्क्रीन पर क्या है**
- **Open / Machine stopped / Showing**: खुली खराबी, बंद machine वाली खुली खराबी, और सूची की लाइनें।
- **Open / All**: Filter: सिर्फ OPEN/ASSIGNED/IN_REPAIR, या सब।
- **Status**: Open, Assigned, In repair, Resolved, Closed, Dismissed।
- **Severity**: LOW, MEDIUM, HIGH, CRITICAL। HIGH और CRITICAL के repair job की जाँच ज़रूरी।
- **Resolution note**: Resolve या dismiss के लिए ज़रूरी।

**आम दिक्कतें और हल**
- "Could not report — You cannot report faults." — आपके role को maintenance log अनुमति नहीं; admin से कहें।
- "Only maintenance staff can change repair status." — Operator दर्ज कर सकते हैं, repair नहीं; technician से कहें।
- "File is larger than 8 MB. / Only photos (JPEG, PNG, WebP, HEIC) and PDF are accepted." — छोटी photo या PDF लगाएँ।

**अटक गए तो**
1. Machine और title भरे बिना "Report" grey रहता है।
2. Repair job पहले से हो तो assign करने पर दूसरा नहीं बनता।

जुड़े पेज: /maintenance, /maintenance/jobs, /maintenance/machines/[id]

**अभी नहीं होता / ध्यान दें**
- Fault सूची में machine या severity filter नहीं; सिर्फ Open/All।

### Maintenance jobs (/maintenance/jobs)
स्क्रीन का पता: /maintenance/jobs · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, MAINTENANCE_SUPERVISOR, MAINTENANCE_TECH · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=maintenance-jobs&lang=hi

सभी maintenance job (schedule वाले check, technician service, repair job)। Technician को पहले "My maintenance jobs" दिखता है।

Job पर tap करके काम दर्ज करें: checks, reading, लगे पुर्ज़े, समय और नतीजा। Supervisor अलग से job जोड़ सकते हैं।

**शुरू करने से पहले**
- maintenance work या manage अनुमति।

**स्टेप बाय स्टेप**
1. Filter चुनें: "Mine", "Open", "Overdue", "To verify", "Done", "All"; और machine।
2. Job पर tap करें; "Start" दबाएँ।
3. हर check का जवाब: "OK", "Issue" या "Can't check"; reading भरें।
4. पुर्ज़े ("Add spare"), "Time taken", photo ("Add photo") और note भरें।
5. नतीजा चुनें: "Completed", "Issue found" या "Unable" (आखिरी दो में कारण ज़रूरी)।
6. "Save record" या "Submit for verification" दबाएँ।
7. Supervisor: "Add job" → machine, "What needs doing", तारीख, kind, notes, "Needs supervisor verification" → "Add"।

**स्क्रीन पर क्या है**
- **In this list / Open / Overdue**: चुने filter की गिनती।
- **Job status**: Due, In progress, Done, Awaiting verification, Verified, Issue found, Could not complete, Cancelled; लाल "overdue" निशान।
- **Kind**: "Technician service" या "Operator check"।
- **Reading**: min–max से बाहर हो तो check अपने आप Issue हो जाता है।
- **Spares used (note only)**: पुर्ज़ा, मात्रा और ₹ लागत; सिर्फ note — stock से नहीं घटता।

**आम दिक्कतें और हल**
- "Job is DONE; only due work can be started." — Job पहले ही बंद है।
- "A reason is required when the work is not completed cleanly." — Issue found / Unable का कारण लिखें।
- "Only maintenance staff can add jobs by hand." — Supervisor से जुड़वाएँ।
- "n check(s) marked "Issue". Choose "Issue found" …" — "Issue found" चुनें ताकि fault बने, या check ठीक करें।

**अटक गए तो**
1. Completed में सब check का जवाब या बाकी में कारण लिखे बिना "Save record" grey रहता है।

जुड़े पेज: /maintenance, /maintenance/jobs/[id], /maintenance/faults, /maintenance/schedules

**अभी नहीं होता / ध्यान दें**
- Job में लगे पुर्ज़े सिर्फ note हैं, inventory stock से नहीं घटते।

### Maintenance job record (/maintenance/jobs/[id])
स्क्रीन का पता: /maintenance/jobs/[id] · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, MAINTENANCE_SUPERVISOR, MAINTENANCE_TECH, OPERATOR · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=maintenance-jobs-id&lang=hi

एक maintenance job का पूरा पेज; machine QR scan करने पर phone यहीं आता है। Job dialog जैसा ही record, साथ में "Edit history"।

Floor पर job का काम करें और नतीजे के साथ बंद करें। बंद job सिर्फ पढ़ने के लिए दिखता है।

**शुरू करने से पहले**
- Job id (सूची, link या QR scan से)।

**स्टेप बाय स्टेप**
1. "Start" दबाएँ।
2. "Checks" में "OK" / "Issue" / "Can't check" चुनें; reading भरें।
3. पुर्ज़े, "Time taken", "Add photo", "Note" भरें।
4. "Completed", "Issue found" (fault का नाम, severity, "Machine has stopped") या "Unable" चुनें।
5. "Save record" / "Submit for verification" दबाएँ।
6. "Machine card" machine का scan card खोलता है।

**स्क्रीन पर क्या है**
- **Edit history**: हर बदलाव का समय, व्यक्ति और काम।
- **Machine has stopped**: "Issue found" के साथ: चल रहा production step breakdown बनकर रुकता है।
- **Status line**: बदल नहीं सकते तब "Waiting for a supervisor to verify.", "Verified …" या "Closed."।

**आम दिक्कतें और हल**
- "Job is already DONE." — किसी ने बंद कर दिया; reload करें।
- "You cannot start maintenance work." — आपका role यह job शुरू नहीं कर सकता।

**अटक गए तो**
1. Title "Loading…" या "Job" ही रहे तो id गलत है; jobs सूची से खोलें।

जुड़े पेज: /maintenance/jobs, /maintenance/machines/[id], /maintenance

### Machine history (मशीन का इतिहास) (/maintenance/machines/[id])
स्क्रीन का पता: /maintenance/machines/[id] · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, MAINTENANCE_SUPERVISOR, MAINTENANCE_TECH, WORK_CENTER_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=maintenance-machines-id&lang=hi

एक machine पर हुआ सब कुछ तारीख के क्रम में: job, खराबी और downtime, कुल के साथ।

Repair या फैसले से पहले machine का रिकॉर्ड देखने के लिए board के "History" से खोलें।

**शुरू करने से पहले**
- Machine id।

**स्टेप बाय स्टेप**
1. "Jobs", "Faults", "Downtime events", "Spares noted" tile पढ़ें।
2. "Timeline" देखें; job के नाम पर tap करके खोलें।
3. Scan card के लिए "Machine card" दबाएँ।

**स्क्रीन पर क्या है**
- **Spares noted**: Job में लिखे पुर्ज़ों का कुल ₹।
- **DOWNTIME पंक्तियाँ**: कारण, घंटे, job number; pause से आए तो "from terminal pause"।

**अटक गए तो**
1. Timeline खाली है तो इस machine पर अभी कुछ दर्ज नहीं।

जुड़े पेज: /maintenance, /maintenance/jobs/[id], /maintenance/faults

### Machine और location के QR code (/maintenance/qr)
स्क्रीन का पता: /maintenance/qr · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, MAINTENANCE_SUPERVISOR · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=maintenance-qr&lang=hi

हर machine और stock location के print होने वाले QR poster।

Print करें, laminate करें और हर machine व location पर लगाएँ। Login किया कोई भी व्यक्ति ERP header से scan करके उस machine या location पर अपने role के panel के साथ पहुँचता है।

**शुरू करने से पहले**
- Factory setup में machine और location।

**स्टेप बाय स्टेप**
1. Plant चुनें।
2. "Machines", "Locations" या "All" पर tap करें।
3. "Print N posters" दबाएँ, या एक poster पर "Print just this one"।
4. "← Show all" से पूरी सूची पर लौटें।

**स्क्रीन पर क्या है**
- **Machines / Locations / All**: गिनती और filter।

**अटक गए तो**
1. Poster न दिखे तो देखें कि machine या location उस plant में बनी है।

जुड़े पेज: /maintenance, /maintenance/schedules

### Maintenance reports (/maintenance/reports)
स्क्रीन का पता: /maintenance/reports · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, MAINTENANCE_SUPERVISOR · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=maintenance-reports&lang=hi

महीने के हिसाब से compliance, breakdown और downtime, बार-बार की खराबी (90 दिन), पुर्ज़े और समय, और technician का काम।

हफ्ते या महीने में maintenance का प्रदर्शन देखें और बार-बार खराब होने वाली machine पहचानें।

**शुरू करने से पहले**
- बंद job और downtime log।

**स्टेप बाय स्टेप**
1. Plant चुनें।
2. "Done on time", "Scheduled jobs closed", "Breakdowns", "Breakdown hours" पढ़ें।
3. Tab बदलें: "Compliance", "Breakdowns & downtime", "Recurring faults", "Spares & time", "Technician workload"।

**स्क्रीन पर क्या है**
- **Compliance**: Month, Scheduled, On time, Late, Missed, Open, On-time %।
- **Breakdowns & downtime**: Production downtime log से: breakdowns, breakdown h, maintenance h, other stops h, events।
- **Recurring faults**: Fault, कितनी बार, machine रुकी, आखिरी बार।
- **Technician workload**: व्यक्ति, open, overdue, done (30 d), बंद करने में औसत घंटे।

**अटक गए तो**
1. Table खाली = उस अवधि में कुछ नहीं (जैसे "No downtime recorded in the period.")।

जुड़े पेज: /maintenance, /maintenance/machines/[id]

**अभी नहीं होता / ध्यान दें**
- रिपोर्ट export या print नहीं होती और अवधि तय है (जैसे 90 दिन, 3 महीने, 30 दिन)।

### Maintenance schedules (/maintenance/schedules)
स्क्रीन का पता: /maintenance/schedules · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, PLANT_MANAGER, MAINTENANCE_SUPERVISOR · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=maintenance-schedules&lang=hi

हर machine का planned maintenance: रोज़, हफ्ते, महीने या running-hour के अंतराल पर checklist के साथ। Due job हर सुबह 05:30 पर बनते हैं।

हर machine के लिए एक बार सेट करें। Fixed-calendar schedule late होने पर भी नहीं खिसकता; interval schedule आखिरी काम से गिनता है।

**शुरू करने से पहले**
- Factory में machine; maintenance manage अनुमति।

**स्टेप बाय स्टेप**
1. "New schedule" दबाएँ (या मौजूदा लाइन पर tap करें)।
2. "Machine" और kind चुनें: "Operator check (short, on the machine)" या "Technician service (detailed job)"।
3. नाम (जैसे Daily start-up check) और Hindi नाम भरें।
4. अंतराल ("Every N days/weeks/months/running hours") और N; due rule; "First due date" भरें।
5. ज़िम्मेदार व्यक्ति या "Anyone in the role" चुनें; "Critical (always verified)", "Supervisor verifies", "Needs a production stop" tick करें; "Est. minutes" भरें।
6. Checklist बनाएँ: "Use starter checks" या "Add check" (OK / Issue या Reading — unit, min, max)।
7. "Save" दबाएँ। आज के job तुरंत बनाने के लिए "Create due jobs now"; schedule बंद करने के लिए "Switch off"।

**स्क्रीन पर क्या है**
- **Due rule**: "Fixed calendar (late work does not move the next date)" या "Interval after the last completion"।
- **Row summary**: Kind, अंतराल, rule, अगली due, आखिरी काम, checks की गिनती।
- **Starter checks**: Oil level, Unusual noise or vibration, Leaks, Safety guards in place।

**आम दिक्कतें और हल**
- "Could not save" — Machine, नाम और first due date जाँचें; दिखा संदेश पढ़ें।

**अटक गए तो**
1. Machine, नाम और first due date भरे बिना "Save" grey रहता है।
2. Due job न दिखे तो "Create due jobs now" दबाएँ।

जुड़े पेज: /maintenance, /maintenance/jobs, /maintenance/qr

**अभी नहीं होता / ध्यान दें**
- Schedule सिर्फ बंद हो सकता है, delete नहीं, और दूसरी machine पर copy करने का विकल्प नहीं।
