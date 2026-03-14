# Production Execution Foundation

This document explains the core execution logic for the factory.

## WC -> Machine -> Operator Flow

1. **Job Queuing**: Jobs are created for each step of a `RoutingRule`. They start in `QUEUED` status and are visible in the Work Center queue.
2. **Assignment**: A Work Center Manager assigns a `QUEUED` job to a specific `Machine`. The status changes to `ASSIGNED`.
3. **Execution**: An Operator starts the job on the machine. Status changes to `RUNNING`.
4. **Completion**: Upon finishing the task, the operator marks it as `COMPLETED`. This triggers the creation of the next job in the sequence or moves the material to the `FG` location.

## Route-Driven Job Creation

Each `TemplateBlueprint` defines a `RoutingRule`. The `RoutingRule` contains an ordered list of `Process` codes.
The system automatically generates `ProductionJob` records for each step, ensuring that step `N` consumption depends on step `N-1` output.
