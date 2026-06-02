# Stock Lifecycle Operator Guide

Route: `/inventory/stock-lifecycle`

Stock Lifecycle is the one inventory control cockpit for opening stock, physical counts, monthly stock proof, stock-card ledger proof, and annual FY close. It does not replace GRN, WCM issue, production output, dispatch, or packing execution. Those flows create stock movement. Stock Lifecycle proves and corrects the live balance.

## Tabs

| Tab | Use it for | Rule |
| --- | --- | --- |
| Overview | Live value, class split, ageing, movement waterfall, dead stock, and stock-card summary. | Read-only analytics. |
| Open stock | First migration or first FY opening stock. | Blocked after real movements exist for the material/location/FY. |
| Physical count | Plant, location, item, bulk, roll, packing, roll-form, or granule-code counts. | Only rows with entered counted qty post. |
| FY close | Annual Indian financial-year lock and next FY opening generation. | Not monthly close. |
| Month close & history | Monthly snapshot, posted count sheets, action blockers, and stock-card drill. | Monthly snapshot does not lock the FY. |

## Daily Physical Count Flow

1. Select the plant.
2. Open `Physical count`.
3. Choose `All`, `Bulk`, `Rolls`, or `Packing`.
4. Narrow further by location, roll form, granule inward code, category, item search, or roll label.
5. Enter counted quantity only for rows physically checked.
6. Add a reason when variance is 2 percent or above.
7. Post physical count.
8. Review `Month close & history` and `Stock card drill`.

Blank rows are ignored. A partial count of one SKU does not turn every other SKU into zero.

## Real Flows

| Flow | Correct use | Proof after posting |
| --- | --- | --- |
| Raw-store granule count | Scope `Bulk`, choose location, choose granule inward code, enter counted kg. | Bulk `COUNT_SHORT` or `COUNT_EXCESS`; other granule codes remain untouched. |
| Roll/WIP count | Scope `Rolls`, optionally choose roll form, enter physical roll label counts. | Audit line stores label, material, width, thickness, grade, stock form, WIP/FG, and status. |
| Packing EOD count | Scope `Packing`, choose packing yard, enter closing qty for counted packing SKUs. | Packaging transaction posts; sheet appears in same Stock Lifecycle history. |
| Month-end close | Post required count sheets, then capture month-end snapshot in `Month close & history`. | Monthly tracker marks count/snapshot for that month. FY stays open. |
| Annual FY close | Clear blockers and close from `FY close`. | Locked FY close batch plus next FY opening batch. |

## Month Close Versus FY Close

Month close is reporting proof. It captures current month-end stock trend and links posted count sheets. It does not lock stock posting.

FY close is the annual lock. It uses the live closing snapshot, requires no close blockers, creates a locked FY close batch, and creates the next FY opening batch.

Typical FY close blockers:

- Draft audit batches.
- Open inter-plant challans.
- Open jobwork orders.
- Negative stock.
- Critical unresolved inventory alerts.

## Stock Forms And Code-Level Counts

Bulk stock can be counted by material, location, and granule quality code. Use the code filter when inward code matters for issue control or reporting.

Roll stock is physical. Count by label. The row includes physical stock form (`OPEN_WEB`, `LAYFLAT_TUBE`, `FOLDED_WEB`), width basis, width, thickness, grade, WIP/FG, and status.

Packaging stock is pooled by packaging material, plant, location, and base UOM. Packing EOD counts should use the same Physical count tab or the Packing EOD shortcut that links back to the same Stock Lifecycle scope.

## Snapshot And History

`Month close & history` has three proof layers:

- Monthly close tracker: count sheets and current-month snapshot status.
- Audit sheet history: opening, physical count, correction, and close batches with labels and scope metadata.
- Stock card drill: Opening + Movement = Closing ledger proof for a selected material and FY.

The older inventory trend snapshot table is bulk/roll oriented. Packaging proof is still real through packaging transactions and posted audit batches; use audit history and stock-card proof for packaging review.

## Training Artifacts

- SVG flow example: `docs/user-guides/artifacts/stock-lifecycle-flow-example.svg`
- PDF operator guide: `docs/user-guides/artifacts/stock-lifecycle-operator-guide.pdf`
- UI screenshot callouts: `docs/user-guides/artifacts/stock-lifecycle-guide-images/`
- Local proof output: `docs/user-guides/artifacts/stock-lifecycle-local-proof.md`

Regenerate the UI screenshots from the local stack:

```bash
cd frontend_v2
UI_BASE_URL=http://127.0.0.1:3001 node scripts/capture-stock-lifecycle-guide-screenshots.mjs
```

Regenerate the SVG and PDF after screenshots are current:

```bash
'/Users/devarshthakkar/local_repos/erp total/venv/bin/python' scripts/generate_stock_lifecycle_training_artifacts.py
```

Run the rollback-safe local proof:

```bash
'/Users/devarshthakkar/local_repos/erp total/venv/bin/python' scripts/prove_stock_lifecycle_local_flow.py
```
