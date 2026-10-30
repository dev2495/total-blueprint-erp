# Partial runs and balance jobs · 30 Oct 2026

Parent release: `f698df63ae70`. No migration, no environment change.

## 1. Release blocked with the roll already allocated

SO-2026-0550-f8dd-B01-1 (side sealing, 180 kg): one 264 kg roll allocated, release still read
*Material block: Roll shortage: 1 more roll(s) required*. On live the server already cleared the job
(MASS step: one roll with weight is enough, 264 kg on it).

- The WC terminal took the "material blocked" flag from the job detail fetched before the roll was
  added. Allocating, removing, returning or auto-picking rolls refreshed the queue list but never that
  detail, so the old flag stayed until a reload.
- The flag also used its own roll count, and blocked on add-on shortages that release does not block.

Now:

- One roll gate (`ExecutionService.roll_readiness`) for the satisfaction status, the queue flag and
  release: MASS needs one roll with weight (a short load is a partial run), LANES one roll per lane,
  COUNT the fixed number. The queue flag skips inks and, unless `ADDON_SHORTAGE_BLOCKS` is on, add-ons.
- Every roll change refreshes the open job's detail; once the job's satisfaction status is loaded,
  the live roll and bulk checks decide and the queue flag no longer gates release.

Over-allocation stays allowed: the leftover on a roll is returned at the end of the run (Return
balance on the terminal, same label; anything still loaded at close is released back to stock).

## 2. Partial runs: the balance goes back to the queue

Before: a step closed short (force reason) left every later step at the full quantity (SO-2026-0669
printing closed at 0, its next step still asked for 30,000 pcs) and the unmade part went nowhere
until the last step pushed the line to the planner's Partial re-plan.

Now, when a sales-line step closes short beyond the close tolerance and "Send the balance back to the
queue" is ticked (default, machine terminal and WC short close):

- later steps of the same batch are cut to what this step made (`quantity_reduced` on the job, tag
  "Cut to …"); a later step that receives nothing is retired;
- a balance batch of the same line (`ProductionBatch.source = MACHINE_OUTPUT`, `parent_batch` = the
  source batch) gets a job for this step and every later step, sized to the unmade part. Its first job
  is released to the same work centre: back in the WC queue with the tag "Balance · qty"; the rest wait;
- the source batch plans only what it made; the line does not go to Partial re-plan while a balance
  is queued;
- cut-down and balance jobs run their own quantity at the last step (`meta_json.quantity_basis = JOB`).

The WC queue has a **Partial** filter (balance jobs and cut-down steps). Unticking the choice keeps the
old behaviour. Stock orders keep the old behaviour (no batch scope).

## 3. Planner continuations ran the first batch's full quantity

`JobService.create_jobs_for_so_item` reused the line's existing batches and took each batch's planned
quantity, ignoring the override. Partial re-plan, continue-from-WIP and fresh-balance releases would
have re-run the full first batch. A continuation now gets a batch of its own for exactly its quantity
(`BatchExecutionService.create_continuation_batch`, source `REPLAN`); none had run on live yet.

## 4. Roll picker and WIP pool

- Picker filter choices come only from rolls the step accepts, numbers sort as numbers, and filters
  reset each time the picker opens (a width chosen for one job used to hide the next job's rolls).
- The footer shows kilos selected against what the step still needs.
- Rolls made by the step before that sit at another plant or in transit are named on the terminal
  ("receive the inter-plant challan to use them here") instead of the WIP pool just looking empty.

## 5. Packing Yard

Roll lines show the rolls' own thickness ("roll 50 µ") on the line and on every roll in the release
list (with width), so the add-on task is clear.

Tests: `apps/production/tests/test_partial_balance.py`.
