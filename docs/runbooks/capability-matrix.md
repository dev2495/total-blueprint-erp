# Capability Matrix

Source of truth: [`capability-registry.json`](/Users/devarshthakkar/Documents/total_blueprint_erp/docs/runbooks/capability-registry.json)

## What this matrix is for
This matrix draws a hard line between:

1. what the ERP already supports now
2. what can be added by naming, taxonomy, and reporting configuration only
3. what needs new manufacturing logic, new formulas, or a new module

That prevents two common mistakes:

1. claiming a new product family is supported when only the name is supported
2. forcing a real physical process change into a taxonomy field

## Reading rule
- `SUPPORTED_NOW`: the current ERP already has the physical behavior and reconciliation needed
- `CONFIG_ONLY`: the physical behavior already exists; you only need controlled masters, taxonomy, naming, or reporting setup
- `NEW_LOGIC_REQUIRED`: the new product/process changes the physical model, execution flow, reconciliation, or inventory object type

## Why the matrix matters
The stock explorer, planner source pools, stock-standing report, and workbook now all sit on top of the same business-family and inventory-variant model.

That means:

1. business users get readable family-first stock views
2. planner still matches on physical eligibility, not just family name
3. future growth can be separated cleanly into taxonomy work versus real engineering work

## Operational rule
If a request changes only:

- business naming
- family aliases
- pouch style classification
- report grouping
- visibility grouping

then it should land in `CONFIG_ONLY`.

If a request changes:

- route execution behavior
- machine/operator states
- formula logic
- reconciliation logic
- the inventory object model

then it belongs in `NEW_LOGIC_REQUIRED`.

