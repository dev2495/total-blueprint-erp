# Packing Consumption + Navigation Update - 2026-05-10

## Scope completed

- Sidebar grouping now keeps Inventory Workspace as the parent for Rolls, Bulk, Packaging, Inks/Adhesives, and Smart GRN only.
- Period & Audit, Mobile Count, Inventory Health, Roll Genealogy, Job Work, and Inter-Plant are direct rail pages so collapsed mode shows their own icons.
- Logistics now contains Packing Yard, Packing EOD Count, and Dispatch Bay.
- Added `/logistics/packing/consumption` for daily/evening count of non-auto packing SKUs.
- Packing Yard roll release no longer asks the operator to enter per-order sheet/wrap/tape quantities.
- Roll packing release now checks the allowed packing list from the sales/product packing snapshot and defers actual stock issue to the evening count.
- Evening count posts stock shortages for sheet, tape, label, tag, box/carton, outer bag, and other manual-count packing SKUs, then allocates them only to same-day packing orders whose sales line allowed that material.
- Gonny creation now falls back to `final_outer_pack` when older `secondary_gonny` snapshot data is not present.

## Flow decision

Inner pouch remains recipe/math driven from the sales/product packing setup. Gonny is posted by the Packing Yard event because every created/sealed gonny is already counted.

Roll wrap, sheet, tape, label, tag, box/carton, outer bag, and other packing material usage is not keyed manually per order in Packing Yard. Packing Yard only confirms that an order/roll went through the allowed packing path. The packing team then posts the evening physical closing stock for those manual-count SKUs. The system computes the difference from book stock and allocates the shortage across same-day packed orders using only allowed material mappings.

This keeps operator entry fast while preserving stock audit and order linkage.

## Verification run

- `manage.py check`: OK
- `npm run typecheck`: OK
- `npm run lint`: OK, existing Next font warning only
- `npm run nav:validate`: OK
- `start_all.sh`: OK
- `start_all.sh verify`: OK
- Browser route `/logistics/packing/consumption`: loaded on port 3001 with zero console errors
- Browser master route `/master/packaging`: loaded on port 3001 with zero console errors
- Backend service snapshot after auto-kind exclusion: `{'materials': 2, 'throughput_orders': 2, 'book_qty': 45.5}` with kinds `['SHEET', 'TAPE']`
- HTTP route probe `/logistics/packing/consumption`: 200
- Backend health `/api/health/`: OK

## Local master data added

The following packaging master SKUs were added locally so the master has countable packing items beyond inner pouch/gonny:

- `PACK_LABEL_STD` - Label - PCS
- `PACK_TAG_STD` - Tag - PCS
- `PACK_BOX_STD` - Box/carton - PCS
- `PACK_OUTER_BAG_STD` - Outer bag - PCS

## Known remaining gate

`npm run help:validate` is not green because of pre-existing inventory help coverage issues unrelated to this packing-count page:

- Missing PageGuides for older inventory routes such as `/inventory/bulk-v36`, `/inventory/rolls-v36`, `/inventory/stock-lifecycle`, and others.
- Existing main/critical help screenshot coverage gaps for `/inventory/period` and `/inventory/traceability-v36`.

The new `/logistics/packing/consumption` route has a PageGuide and is not the source of that help-validation failure.

## Live URLs

- Local: `http://127.0.0.1:3001/login`
- LAN: `http://192.168.0.229:3001/login`
