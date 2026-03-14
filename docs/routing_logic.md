# Routing Logic & Job Sequence

## Ordered Execution

A `RoutingRule` defines the sequence of operations for a product. It uses an `ordered_processes` JSON field containing process codes.

## Job Generation

1. **Step-by-Step Creation**: For each process in the `ordered_processes` list, a `ProductionJob` is created.
2. **Indexing**: Each job is assigned a `routing_step_index` (0-based) to track its position in the overall route.
3. **Data Inheritance**: 
    - `input_mode` and `output_mode` are derived based on the process type (e.g., EXTRUSION is Qty -> Roll).
    - `from_location` and `to_location` are assigned based on the step (e.g., Step 0 consumes from RM, Step N produces to FG).

## Job Visibility

`ProductionJob` properties expose the job's position (e.g., "2 / 6") to allow floor managers and sales teams to see progress at a glance without complex lookups.
