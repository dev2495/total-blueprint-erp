# Inter-Plant Transfers (Delivery Challan)

## Multi-Plant Architecture

Each `Plant` is an independent entity with its own set of `InventoryLocation` records.

## Transfer Workflow

1. **Routing Requirement**: If a `RoutingRule` requires a process that exists in a different plant, an inter-plant transfer is triggered.
2. **Delivery Challan (DC)**: A `DeliveryChallan` record is created in `DRAFT` status.
3. **Approval**: Once approved, the status moves to `IN_TRANSIT`. The material moves from the source location to the virtual `IN_TRANSIT` location of the source plant.
4. **Receipt**: Upon arrival at the destination plant, the DC is marked as `RECEIVED`. The material moves from `IN_TRANSIT` to the destination's `RM` or `WIP` location.

Ledger entries are only recorded upon `APPROVED` (Out) and `RECEIVED` (In) status changes.
