# Orders • Details • Tracking

## Route
- /orders/[id]/tracking

## Module
- Sales

## Roles
- ADMIN
- OWNER
- SUPER_ADMIN
- SALES


## Summary (EN)
Use this legacy order tracking route to review the same execution status shown in the sales order tracker.

## Summary (HI)
इस legacy order tracking route का उपयोग sales order tracker जैसी execution status समीक्षा के लिए करें।

## Purpose (EN)
This guide keeps the legacy order tracking URL covered for users who open older links or bookmarked order status pages.

## Purpose (HI)
यह guide पुराने links या bookmarked order status pages खोलने वाले users के लिए legacy order tracking URL को cover करती है।

## Prerequisites (EN)
- Open the order from an approved sales order or a known tracking link.
- Confirm the order number and customer before acting on the status.


## Prerequisites (HI)
- Order को approved sales order या known tracking link से खोलें।
- Status पर action लेने से पहले order number और customer confirm करें।


## Key Actions (EN)
- Review planner, production, packing, and dispatch progress for the order.
- Use the linked sales order page for edits or controlled status actions.
- Refresh after downstream updates to confirm the latest execution state.


## Key Actions (HI)
- Order के planner, production, packing, और dispatch progress की समीक्षा करें।
- Edits या controlled status actions के लिए linked sales order page का उपयोग करें।
- Downstream updates के बाद latest execution state confirm करने के लिए refresh करें।


## Field Help
- **Order Status** (EN): Shows the current commercial and execution state of the order.
  - **Order Status** (HI): Order की current commercial और execution state दिखाता है।
- **Execution Progress** (EN): Compares planned, produced, packed, and dispatched quantities where available.
  - **Execution Progress** (HI): जहाँ उपलब्ध हो वहाँ planned, produced, packed, और dispatched quantities compare करता है।

## Decision Flow
- sales-order-flow
1. Create and validate order
   - Outcomes: Valid, Validation error
2. Release to planning
   - Outcomes: Released

## Common Errors
- **EN:** Order not found - The legacy URL may point to an archived or inaccessible order.
  - **HI:** Order not found - Legacy URL archived या inaccessible order की ओर point कर सकता है।
- **EN:** Status looks stale - Downstream planner or production updates may still be syncing.
  - **HI:** Status stale दिख रहा है - Downstream planner या production updates अभी sync हो रहे हो सकते हैं।

## Recovery Steps (EN)
- Refresh the page and reopen the order from Sales Orders if the legacy route fails.
- Use the sales order number to search the order queue or history.


## Recovery Steps (HI)
- Legacy route fail होने पर page refresh करें और Sales Orders से order फिर खोलें।
- Order queue या history में search करने के लिए sales order number का उपयोग करें।


## Related Routes
- /sales/orders
- /sales/orders/[id]/tracking


## Screenshot References
- None

## FAQ References
- faq-access-control
- faq-data-refresh
