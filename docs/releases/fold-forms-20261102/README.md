# Folding: roll styles, each step's own form, pouch styles linked to the fold · 2 Nov 2026

Three releases on the same day, parent `e112c0fdf0cd`:

| Release | Commit | Migration | What |
|---|---|---|---|
| 1 | `3a81ead7fe1c` | materials.0055 (pouch_styles.style_for) | fold rule, roll styles, each step's own stock form, fold output on the floor, chips, one Pouch / Roll styles page |
| 2 | `d5d7ebe25e7c` | none | pouch style formula read as the open web before the fold, flap from a formula field, preset roll styles, `fold_setup --apply-links` |
| 3 | `2fe6b9383817` | none | the named flap field wins over an empty flap tape; `--apply-links` refreshes linked sizes |

Backups before each cutover: f1923224, 8f49dc14, aef38f16 (restore drill PASS each time). Restart windows 54 / 58 / 56 s.

## The rule

open web = 2W + flap + seal + trim. W is the folded / lay-flat width that is stocked and sold. Folded and tube film count
both walls plus flap and seal; trim is edge scrap.

## How it fits together

- **Roll forms**: OPEN_WEB, FOLDED_WEB, LAYFLAT_TUBE on rolls, sizes and order lines; the fold (flap, seal, trim) travels in
  `geometry_config.fold` (size), `geometry_snapshot.fold` (order line) and `meta_json.fold` (roll).
- **Styles**: `PouchStyleMaster.style_for` = POUCH (formula) or ROLL (form + fold only). A style's
  `stock_form_options[FORM]` holds `flap_mm`, `seal_mm`, `trim_mm`, and for pouch styles `formula_basis`
  (OPEN_WEB = the formula gives the open web before the fold) and `flap_field` (the formula input that is the flap).
- **Fold steps** are any process that takes open web, can output a form it does not take in, and does not PRESERVE the
  form. `StockFormResolver.for_job_step` gives each route step its own input / output contract: open web up to and
  including the fold step, the line's form after it; run widths widen to the open web before the fold.
- **Fold output**: `ExecutionService._form_change_output` sets the output width and flap from the rule; a typed width is
  kept only when it is a real fold of the roll; too narrow is refused.

## Applied on live

`manage.py fold_setup --apply-styles --apply-sizes --apply-process --process-code Fold "Sheet Seal"` then `--apply-links`:

- Fold and Sheet Seal: MODIFY_EXISTING, in [OPEN_WEB], out [OPEN_WEB, FOLDED_WEB, LAYFLAT_TUBE], TARGET_DECIDES.
- 6 roll sizes whose Roll form never reached their stock form (1 active BOPP Folding Sheet, 5 retired LD tubing).
- 7 roll styles: ROLL-OPEN, ROLL-FOLDED, ROLL-JFOLD-20/30/40, ROLL-TUBE, ROLL-TUBE-SEAL-8.
- SIDE-SEALING-ON-FOLD v3 and v5 (linked copies, formula = open web, flap = each size's "Flap"); 44 sizes of BOPP FLEXO
  PRINTING (33) and COURIER BAG FLEXO PRINT (11) linked. Open web and kg targets unchanged on every size (checked);
  e.g. courier 10X12-2FT: open 660 -> Folded 305 + 50 flap. Order lines placed earlier keep their snapshots.

## Open for the business

- Seal and fold trim on SIDE-SEALING-ON-FOLD are 0; set them once on that style, then run `fold_setup --apply-links`
  to refresh the linked sizes.
- 2 linked sizes have no "Flap" value (flap 0).

## Guide

`roll-styles-guide.html` (English + Hindi): roll forms, new roll sizes, styles, pouches on folded film, admin setup for
new folding routes, worked examples, calculator.
