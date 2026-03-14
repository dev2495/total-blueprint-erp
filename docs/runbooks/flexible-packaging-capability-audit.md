# Flexible Packaging Capability Audit

This document is the honest capability map for the current ERP codebase after the final hardening pass.

It is grounded in:

- current production, physics, inventory, planner, WCM, operator, and reporting code
- maintained automated checks
- current industry references for pouch measurement, film yield/density, and common flexible-packaging product families

## Current release gates behind this audit

- `venv_311/bin/python manage.py test --noinput`
- `venv_311/bin/python manage.py run_tagged_acceptance --noinput`
- `venv_311/bin/python scripts/verify_physics_math.py`
- `venv_311/bin/python scripts/verify_fg_semi_match.py`
- `cd frontend_v2 && npm run e2e:ui`

## Supported today

### Roll and semi-finished stock logic

Supported now:

- KG-authoritative roll stock orders
- direct-finished allocation through `FINAL_STOCK`
- semi-finished continuation through `INTERMEDIATE_POOL`
- route stop-step gating
- invariant-signature matching for reusable intermediate rolls
- final-spec matching for direct finished stock
- packaging-only stock isolation through `PACKAGING_STOCK`

Operational meaning:

- a roll completed only up to an intermediate route step can be reused later if the invariant signature matches and the stop step is compatible with the downstream required start step
- a fully finished roll can only satisfy direct finished demand when the full spec signature matches

### Pouch and conversion logic

Supported now:

- pouch orders in `PCS`
- roll orders in `KG`
- multilayer film structure snapshots
- printing snapshots and ink GSM-based calculation
- adhesive/solvent GSM-based chemistry consumption
- POD film contribution for pouch flows
- repeat-order reuse with snapshot/spec-signature protection
- planner artwork-deferred flow
- planner/WCM/operator split for release, step-policy, and execution

### Shop-floor execution and reconciliation

Supported now:

- current-step issue policy overrides at WCM level
- operator actual issue / scrap / return reconciliation
- output caps and partial-fulfilment handling
- dispatch/challan roll lineage
- jobwork, GRN, inter-plant, dispatch, and machine flows in browser coverage

### Reporting and inventory visibility

Supported now:

- official stock-standing PDF summary
- detailed stock workbook attachment
- stock strategy summaries
- process/state roll sections such as printed, laminated, intermediate pool, and in-house FG
- notification routing for operational events even when email is disabled

## Supported after taxonomy/config only

These do not require a new manufacturing engine. They need controlled master data, UI exposure, or stricter validation only.

### Pouch style families

Supported after taxonomy/config only:

- `THREE_SIDE_SEAL`
- `PILLOW`
- `STAND_UP`
- `SIDE_GUSSET`
- `QUAD_SEAL`
- `FLAT_BOTTOM`
- `SPOUT`
- `SHAPED`

Reason:

- the physics engine already derives consumption from geometry, layers, chemistry, and POD inputs
- pouch style is mainly a controlled classification for validation, repeat-order safety, UI readability, and reporting
- the new `pouch_style` field makes that explicit without replacing the actual geometry model

### Variant naming and roll-family grouping

Supported after taxonomy/config only:

- clearer family naming
- process-based stock sections
- provenance filtering
- customer-specific style naming conventions

Reason:

- the stock explorer and report pack already carry enough material, stage, plant, location, and strategy metadata to support this cleanly

## Requires new module or process support

These should not be claimed as already solved.

- specialty converting models that depend on process-specific machine physics not yet represented in routes or execution services
- highly custom pouch geometries requiring non-rectangular area or sealing-loss models beyond the current geometry/addition framework
- advanced print-press estimation models that require press-speed, cylinder wear, ink transfer efficiency, or waste curve simulation instead of the current GSM-area basis
- specialty laminates or post-processing that require new process states, new inventory forms, or new reconciliation types

## Formula alignment used in this audit

The current math model is aligned to standard flexible-packaging weight logic:

- film mass is derived from area x thickness x density
- chemistry and inks are derived from area x GSM
- roll area and roll length are derived from weight, thickness, density, and width
- intermediate-roll reuse ignores downstream pouch geometry but preserves roll-defining invariants such as width, layer structure, density, and print setup

That aligns with common industry references:

- GS1 measurement rules for pouch dimensions and pack measurement context: [GS1 Package and Product Measurement Standard](https://www.gs1.org/standards/gs1-package-and-product-measurement-standard/10)
- film yield and density relationship references: [Pro Pac yield tables](https://www.propac.com/packaging-materials/material-reference-library/yield-tables/), [Cloudflex film density and yield formulas](https://www.cloudflexfilm.com/flexible-film-density-formulas-tables-yield/)
- common commercial flexible-packaging family coverage: [ePac product families](https://epacflexibles.com/products/), [Glenroy stand-up pouch families](https://www.glenroy.com/flexible-packaging/stand-up-pouches/)

## Practical conclusion

For a flexible-packaging company focused on rolls, laminates, printed rolls, semi-finished reusable rolls, and mainstream pouch families, the current ERP is structurally extensible.

That statement is accurate only with these limits:

- mainstream pouch and roll families are supportable now or after taxonomy/config cleanup
- future specialty processes must be added honestly as new modules or route/execution models
- the system should not claim universal support for every flexible-packaging process without adding those missing models first
