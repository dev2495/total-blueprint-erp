# Release: roll lanes, packing check and faster office screens (16 Oct 2026)

- **Base:** live `0bf34e1ede7c` (floor logic + maintenance + QR scan, 15 Oct 2026).
- **Branch:** `codex/roll-flow-ui-20261016`.
- **Why:** the 16 Oct review ran the client's lamination case (6 PET rolls + 4 milky LD rolls) on a test copy and found that the WCM could give a laminate step only one roll per layer, that a roll-fed step after the first could take only one output entry per allocation, that rolls were used in allocation order rather than by layer share, and that pouching with two or more rolls refused part entries. Decision report: https://claude.ai/artifact/FsudJmXZE3NJa1cMuixAb6. Not in this release: the QR roll flow (being refined).
- **Rule for every screen change:** add-on only. No existing field, rule or check was removed; screens were reordered, reworded, given defaults and shortcuts.

## Roll lanes (backend contract)

| Step type | Mode | What changed |
|---|---|---|
| Plain roll to bulk/pieces (pouching, side seal, bottom seal) | MASS, one lane | Part entries work with any number of rolls; the running roll gives first; untouched rolls stay reserved. |
| Printing / modify, slitting, roll-fed create | MASS, one lane | Rolls queue one after another (was "exactly one"). Each output row the machine sends becomes its own output roll. Slitting keeps the unslit balance on the parent. |
| Lamination in lane-group mode | LANES, one lane per layer slot | Any number of rolls per layer. Each entry takes each lane's share of the output by g/m² (micron × density, ink on the printed layer, this pass's adhesive as the rest). The tightest lane caps the output. Film gauge is never exactly the plan, so a lane may run up to 5% (min 0.25 kg) short of its share on an entry: it gives what it has, the other lanes cover the gap, and the output roll records it in `lane_share_adjusted`. Past that the lane is named in the refusal and the WCM loads its next roll. Weighing the balance on return corrects any drift. |
| Strict combine (not lane groups) and legacy roll-to-roll NONE with several layers | COUNT | Unchanged. |

- **In place, same label:** a part-used roll keeps its id and label with less weight left. Nothing is re-labelled as a leftover (REM) roll on the lane flow. A roll taken to zero is CONSUMED and its reservation FULFILLED. Every use is recorded in `RollConsumption` with the balance left on the same roll.
- **Running job:** the WCM can add the next roll to a released or running job (MASS/LANES). An untouched roll can be taken off; a part-used roll leaves only through **Return balance** (back to stock, same label; a weighed balance below the system figure is booked as scrap) or **Roll finished** (core end booked as scrap). Machine screen and WCM terminal both offer it. Job completion returns any roll still on the job to stock with its label (rolls marked IN_PROCESS included).
- **Mass cap:** stock or other orders' rolls cannot be locked to a job whose remaining need is already covered (remaining need + close tolerance). The order's own WIP rolls are always allowed.
- **Laminate identity:** laminate output rolls carry `is_laminate`, `structure_label` (for example "PET 12 printed 12 µ / Milky LD 50 50 µ") and the per-lane structure in their metadata; the material link is unchanged so downstream slitting and pouching still match.
- **Step targets on roll products:** where a step target is "the mass loaded on the job" (roll-product lamination, first-step printing/slitting), loaded mass is now what the job used plus what is still on its rolls, so the target no longer shrinks with each entry.
- **Pouching pieces:** on piece jobs the progress leads with the pieces counted at the machine; the kg-based count is shown beside it as a check.

## Packing check (new, additive)

- New table `packing_verifications` (one per finished-goods batch). Net packed = scale gross − inner packs − gonny/carton − tape/tags, as already stored on each sealed pack.
- **Close check:** pieces and net kg are compared with what the machine logged. Within `PACKING_VERIFY_PCS_PCT` and `PACKING_VERIFY_KG_PCT` (default 2% each, env) the batch is VERIFIED: unpacked pieces are booked as packing loss on the pouching job and finished stock follows the packed figures. Outside the limits the batch is HELD.
- **Held batches** cannot be released to dispatch or put on a challan until a production supervisor/manager accepts with a reason (rejects, count error, machine over-logged, scale checked, other + note).
- Optional sample: weigh 100 pouches once for the real weight per pouch.
- Machine logging is unchanged; batches never checked keep working as before.
- **Only batches made after go-live are checked.** The start is the moment migration 0077 is applied on the server (override with `PACKING_VERIFY_START_DATE`, a date or date-time). Older batches are not listed and cannot be closed, so their unpacked balance is never booked as loss.

## Packing material: base rule and fixes

Base rule (from the owner): **only inner pouches are consumed automatically** (one per N pouches at pouching, with in-house demand when short). Gonnies, cartons, extras and in-house packing rolls/sheets are **marked at packing and taken off stock by the evening packing count**.

- **Gonny now follows the rule.** Creating a gonny marks it on the unit (`packaging_marks`, `MARKED_FOR_COUNT`) instead of consuming one from stock, so the packing yard is never blocked by missing gonny stock in the ERP. `PACKING_GONNY_AUTO_CONSUME=true` (env, default off) restores the old consume-on-create.
- **Evening count books to the orders that used it.** A count shortfall is shared over the same day's orders that *marked* that material (gonny, seal extras, release extras, roll-pack lines), by marked quantity; orders whose packing plan merely allows it are the fallback. When nothing was packed at the stock's own location (store vs FG store), the whole plant's packing is used instead of leaving the shortfall unassigned.
- **Inner pouch draw across the plant.** Pouching takes inner pouches from the output location first, then any other location of the plant (one CONSUME row per location, `drawn_from_location_id` in meta). A real shortage names what the plant has, per location.
- **Code-only inner pouch on an order** (older lines) is resolved from the packaging master at pouching and when the order snapshot is built (id, name, supply mode, pcs per pack from the master default).
- **Unused inner pouches go back.** When the packing check closes (verified or accepted), inner pouches consumed at the machine but not used in packed units return to stock for that order (ADJUST row, `basis=INNER_PACK_RETURN`, at the consumption cost and location). The packing check dialog shows "taken at the machine · used in packs · back to stock". The order's packaging history lists returns and every marked item.
- **In-house demand nets other orders.** For the inner pouch, free stock = plant stock + in-house stock orders still to produce − inner pouches still needed by other open orders; what this line already consumed is not planned again.
- **Product master switch is honoured.** "Auto-demand" off on a master's packaging (or POD) axis now stops in-house demand at order confirm (the master preview already showed that). A missing flag means on, as before; the screens now show it as on.
- **Product master inner pouch.** Choose the default inner pouch from the allowed list and the pouches per inner; the box shows made here / bought / both and the product master that makes it (or a warning when an in-house pouch has none, since demand cannot be planned). The default can no longer be switched on without a material and moves to an allowed pouch when its SKU is removed from the list.

## Screens

- **WCM terminal:** rolls by lane with loaded vs still-needed kilos, running and queued rolls, "Add next roll" while running, Return balance / Roll finished, remove untouched rolls. The roll banner no longer says "covered" while a lane is short: it says "Ready to start: every layer has a roll" and names each lane still short for the full order (not blocking), and when a lane has no roll it names that lane after "Assign N more roll(s) before release".
- **Machine screen:** the same lane view (operator can return or finish a roll), output limit from the tightest lane, counted pieces strip on pouching.
- **Packing yard:** Packing check panel and dialog. A notice at the top lists batches on hold across all orders, each one tap from its order (the queue rows now carry `sales_order_id`). Closing a check while pieces of the batch are still unpacked shows a warning first: pieces not packed by then count as short.
- **Order entry:** customer search (type 2 letters) with the last five customers one tap away, above the unchanged dropdown; "Pouches: use pieces" hint on pouch lines in KG; the material list files in-house film as film, greys it as "made here · not added", and leaves it out of the subtotal (the 1,000 kg order no longer shows 1,575.7 kg). The saved BOM was already correct; planning lines now also carry each film's source.
- **Pouch style:** built-in styles show their fixed formula in words ("child width = 2 × (W + G) + 10") instead of an empty builder, with "Edit as terms" to switch; the banner says "Approved style · N sizes use it" (it wrongly said "locked because sizes use it" when none did).
- **Product master:** sticky step bar over the long edit page; plainer section titles and wording; numbering no longer skips 7; lamination passes a product will not run are shown as skipped on edit and detail; Disable is quiet next to Open; breadcrumb names Product / Pouch style instead of "Terminal". Lane-up, child web width, override, stock form, width basis and allocator fields are untouched.

## Migrations

- `production.0077_packing_check_and_roll_return`: creates `packing_verifications`; adds the RETURN_ROLL choice to the WCM audit action (no DB change). Additive.

## Verification

- Backend: `apps/production/tests/test_roll_lane_flow.py` (lamination 6 + 4 rolls into two lanes; repeated entries by share keeping labels; adding the next roll while running and the short-lane refusal; a 4.6% gauge gap on the last LD roll covered by the PET lane and recorded; return balance and part-used guard; pouching 300 + 700 kg part entries with counted pieces; printing queue and one output roll per row; slitting balance on parent; job completion returns rolls; mass cap vs own WIP) and `test_packing_verification.py` (verify + shortfall booking, hold blocks dispatch until accepted, sample weight and open-pack guard). `test_inner_pouch_flow.py` (inner pouches drawn from the packing store, code-only line resolved, unused pouch returned at the check, gonny marked not consumed, evening count books the gonny to the order across locations, shortage message, demand netting across orders, master auto-demand switch, snapshot fill-in). Older tests that asserted the leftover-roll behaviour or "exactly one roll" for printing/slitting were updated to the agreed contract.
- E2E: `tests/e2e/gate/floor-flow-additions.spec.ts` (customer search, fixed pouch formula, product master step bar, packing check panel); `wip-route-proof.spec.ts` updated to the lane labels.
