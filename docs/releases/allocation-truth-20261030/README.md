# Allocation truth · 30 Oct 2026

Parent release: `19bb5a1be29e`. One data migration (`production.0078`), no schema change, no environment change.

Three floor reports from live, each confirmed against production data before the fix:

## 1. Release planning offered stock the claim then refused

SO-2026-0731 showed 16 "FG match" rolls; Plan & Release failed with *Roll R-SO-2026-0651-… is already
linked to another sales order*. All 16 belonged to short-closed lines (12 of SO-2026-0651, 4 of
SO-2026-0421). Plant-wide 3,422 available final rolls were held by a line (3,198 closed, 224 open).

Now one rule everywhere:

- The release dialog, the plan queue counts (FG / WIP badges) and the claim offer only free stock, freed
  stock and the line's own units. Units held by any other line are never offered.
- Exact units of a **closed** line are counted on the dialog: *N matching units still belong to closed
  orders SO-…*, with a link to Dispatch Bay → Move to stock (owner rule of 26 Oct: closed-line goods are
  shipped with confirmation or moved to free stock; the planner never takes them silently).
- The claim refuses held units before writing anything and names the holder; a stock order can no longer
  take a sales line's roll.

## 2. Roll → bulk picker hid the exact rolls

SO-2026-0550 (side sealing from BOPP 51 µ, 850 mm): the server returned all 6,368 plant rolls for the
step (roll→bulk skipped the film check), sorted heaviest first and cut to 200 / 400 before the browser's
check; the nine 850 mm BOPP rolls ranked 550–1,238 and never arrived.

- Roll→bulk takes the order's own rolls (laminate, printed web, its remainders) as they are; any other
  stock must match the step spec (film, gauge, grade, form, width) on the server — eligibility,
  allocation, auto-pick and the SQL pre-filter alike.
- Plant stock on roll→bulk steps also needs the planned web ±20 mm without a manual override, like every
  other step; auto-pick never takes a roll outside that window.
- Every capped list orders rolls usable at their width first, then by weight.
- Each roll in the picker lists carries the server's verdict (`contract_ok`, `auto_window_ok`,
  `own_flow`); the browser shows exactly what allocation will accept instead of re-deriving it from a
  differently shaped spec (which also hid laminate rolls after lamination).
- Weight-fed steps read *Required 1+ · up to 24 rolls* and *Assigned N* instead of "24" / "0/24".

## 3. Machines read "Down" with no fault

XL and Mamata (Side Sealing Plant) had 5 open downtime rows, all on COMPLETED jobs. The terminal marked a
machine Down for any open downtime on any job ever assigned to it; finishing a step, skipping and every
cancel path never closed downtime; resume closed only pause rows.

- One machine state for every screen (`apps.factory.serializers._resolve_machine_live_state`): Down when
  the machine itself is stopped by a fault / under maintenance (always wins), Running when a job runs,
  Down when a job still open on it has open downtime, else Idle. It carries `down_reason` and
  `down_kind` (FAULT / MAINTENANCE / DOWNTIME).
- `ProductionJob.save` ends open downtime whenever a job is saved completed or cancelled (any path).
  Resume and start end all open downtime of the job. A hand-logged stop with auto-stop writes one row.
- A faulted / maintenance machine cannot be given new work (server refuses; terminal disables it).
  Downtime on a waiting job only warns ("Waiting · Downtime on SO-…").
- Visual Factory lists stopped machines too and counts Running / Idle / Down from the same state.
- `production.0078` closes the existing open rows on closed jobs with zero length (end = start, note
  added): their real end is unknown and reports already skipped open rows, so no duration is invented.

Tests: `apps/production/tests/test_allocation_truth.py`.
