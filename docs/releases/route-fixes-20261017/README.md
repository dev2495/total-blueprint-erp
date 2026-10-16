# Release: parallel-route and laminate fixes found by the full PET + LD walkthrough (17 Oct 2026)

**How found:** `apps/production/tests/test_pet_ld_walkthrough.py` drives the live stand-up pouch route
(EXT ∥ PRT → Lam → Slt → Pch → pack → check → challan) with a real BOM, real order confirmation,
real consumption and real step targets, and asserts the WIP pool at every step. Six gaps showed up
on the way; each is fixed here, each is additive, and linear routes behave exactly as before
(their only root is step 0, so every new rule collapses to the old one).

## Fixes

1. **Extrusion made the wrong film.** A roll-making (CREATE_NEW) step took layer 1 of the BOM as its
   output film. On EXT ∥ PRT routes with PET first, extrusion produced "PET 12 µ" rolls. Now the step
   makes its branch's layer (branch key, else the extruded/producer layer; `_job_output_layer_snapshot`).
2. **Printing could not take purchased PET.** The printing root sits at template index 1, so raw stock
   was refused ("requires a lineage output roll") and the WCM was offered the LD rolls from extrusion
   instead. A route root is now step 0 for input gating (`_input_gate_step_index`), in the compatibility
   check, SQL pre-filter, WIP pool, eligible rolls, auto-pick, output logging and step targets.
3. **Branch target specs.** A root branch job's target specs cover only its own layer
   (`_job_branch_layer_indexes`): printing asks for the PET web, extrusion for the LD web.
4. **Slitting and pouching after lamination saw no rolls.** Downstream steps asked for per-layer film
   specs (12 µ PET, 50 µ LD) so a 62 µ laminate never matched. Steps after a combine now carry one
   laminate spec (summed gauge, min width, `LAMINATED_WIP`); the match accepts the laminate and rolls
   cut from it (slit children keep `is_laminate` / `structure`).
5. **Slitting step target was one film.** The laminate roll carries the PET code, so the "variant match"
   target used the PET mass (255 kg) and refused a 285 kg entry. Steps after lamination target the full
   laminate film mass (`V2_LAMINATE_FILM_SUM`).
6. **Slitting child width.** `target_child_width` returned the input web width (980) instead of the order's
   child target (490); it now reads the order geometry first (`target_child_width_mm` / `child_target_width_mm`).
7. **Purchased layer invisible at lamination.** Found by the route-family walkthroughs: on PRT → Lam → Slt → Pch
   (bought LD, no extrusion) and on the 3-ply first pass (bought met-PET), the WIP pool and the picker looked
   beyond lineage only when the lineage roll *count* was short. Two printed rolls satisfied "two lanes", so the
   bought layer's stock rolls were never offered. Both now check lane slots: when lineage leaves a lane empty,
   that lane's stock rolls are discovered (`_match_rolls_to_lane_slots … unmatched_target_slots`).
8. **Two-pass lamination target.** The lamination roll target summed every BOM film on every pass, so pass 1 of a
   3-ply route (PET + met-PET) carried the LD layer's mass too and the met-PET lane asked for far more than it
   needed. A pass now sums layers 1..pass+1 only (`V2_COMBINE_FILM_SUM`); single-pass routes are unchanged.
9. **Second lamination pass refused the first pass's laminate.** The spec builder treated any combine step as
   "no prior lamination", so pass 2 asked for three single films and rejected the 24 µ laminate. Pass 2 now
   specs the earlier laminate (layers 1..pass, summed gauge) plus the next BOM layer; the pool, picker and
   assign-time physical check all use the same specs.

Also: adhesive/solvent lines fall back to the lamination (chemical) step and are operator-confirmed
(`AUTO_ESTIMATED_CONFIRM`) when a template does not map them; printing-enabled lines without a product
master get the same substrate/colour defaults at confirm as master lines.

## Verified by the walkthrough (numbers from the report)

100,000 stand-up pouches 160×230, PET 12 µ printed + milky LD 50 µ (70/30 LDPE/LLDPE), 2.5 g/m² adhesive, 1.5 g/m² ink.
Unit 10.147 g → 1,014.7 kg; films 953.9 kg, adhesive 38.0, ink 22.8. Confirm: 2 lanes, planned parent 989 mm.
Targets: EXT 698.7 (LD), PRT 255.2 (PET), Lam/Slt 991.9 (films + adhesive), Pch 1,014.7 kg = 100,000 pcs.
EXT: 6 rolls × 116.46 kg, granules 490.5 + 210.2 kg incl. 2 kg start-up. PRT: 4 × 66.8 kg in → 4 × 64.8 kg out, 8 kg scrap.
Lam WIP pool before allocation: all 4 PET + 6 LD rolls; shares PET 0.274 / LD 0.689 / adhesive 0.037; 3 laminate rolls 304.4 kg, 62 µ.
Slt WIP pool: the 3 laminates; 6 children × 151.7 kg @ 490 mm; 3 kg trim; balance stays on parent.
Pch WIP pool: the 6 children; 3 × 29,000 pcs counted first; 870 inner pouches consumed; 26 kg left on the last child.
Packing: 9 gonnies marked for the evening count; 3 packing checks VERIFIED (0% variance); challan created.

## Route families also walked (apps/production/tests/test_route_family_walkthroughs.py)

- Purchased 2-ply printed: PRT → Lam → Slt → Pch (bought LD loaded raw at lamination).
- 3-ply printed: EXT ∥ PRT → Lam → Lam → Slt → Pch (bought met-PET at pass 1, extruded LD at pass 2; 84 µ laminate).
- Purchased 2-ply plain: Lam → Slt → Pch (both films from stock at the route root).
- Courier bag: EXT → side seal (roll → bulk, pieces).
Each asserts the WIP pool at every step, lane mode at lamination, laminate flag and gauge, child width, FG batch.

## Open findings (decision needed, not changed)

- Ink is not a job requirement row by design (ink floor sessions book it); step targets after printing therefore
  exclude ink mass (2.2% here). Keep, or add ink to the printed-roll target.
- Step-0 roll→bulk accepts any film in the plant (see perf release notes).
