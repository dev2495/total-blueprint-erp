# Inventory Movement & Hybrid Rolls

## Roll + Quantity Hybrid Model

The factory handles two types of materials:
1. **Rolls**: Tracked individually with `InventoryRoll`. Used for Film (Extrusion, Printing, Lamination, Slitting).
2. **Quantity (Bulk)**: Tracked in aggregate via `InventoryStock`. Used for Granules, Inks, Adhesives, and Solvents.

## Movement Logic

- **Extrusion**: Consumes `Quantity` (Granules) -> Produces `Roll`.
- **Printing/Lamination/Slitting**: Consumes `Roll` -> Produces `Roll`.
- **Pouching**: Consumes `Roll` -> Produces `Quantity` (Pieces).

## Chemical Consumption

Chemicals (Ink, Solvent, Adhesive) are tracked via `InventoryLedger` with the `ISSUE` transaction type. No FIFO or roll-level tracking is enforced for these items to simplify floor operations while maintaining ledger accuracy.
