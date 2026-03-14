# Phase 8C: Sales Enforcement & Governance Feedback

This document outlines the Sales Enforcement logic and the UI/UX enhancements introduced in Phase 8C to ensure transparent Engineering Governance.

## 1. Sales Order Lifecycle

The `SalesOrder.status` now follows a strict governance lifecycle:

| Status | Meaning | Transition Requirement |
| :--- | :--- | :--- |
| **DRAFT** | Initial state where Sales edits the order. | Manual. |
| **ON_HOLD** | Awaiting Engineering approval (Common for CUSTOM orders). | Auto-assigned for CUSTOM orders. |
| **READY** | All templates in the order are LIVE and have Routing assigned. | Automated check. |
| **CONFIRMED** | Order released to Production. | Only possible if state is **READY**. |

## 2. Block Reason Resolver

The `SalesOrderBlockReasonView` (`/api/sales/orders/{id}/block-reasons/`) identifies production blocks. Common reasons include:
- **Template not LIVE**: The product definition is still in DRAFT or APPROVED status.
- **Routing missing**: No manufacturing sequence has been assigned by Engineering.
- **Unauthorized override**: Sales attempted to change a field (e.g., `width`) that is locked by Engineering.
- **Custom Pending**: A custom design is currently in the Engineering Approval Queue.

## 3. UI/UX Enhancements

### Sales Interface
- **Governance Banners**: High-visibility alerts (Red/Blue/Green) explaining the current block status.
- **Status Badges**: Real-time status of templates and routing directly on the order item list.
- **Smart Confirm**: The "Confirm Order" button is disabled whenever production is blocked, with a tooltip explaining exactly why.

### Engineering Interface
- **Sales Impact Indicator**: The Template List now shows how many Sales Orders are currently blocked by a specific blueprint, ensuring Engineering understands the urgency of approvals.

## 4. Known Limitations
- Manual status transitions to `READY` are not yet automated by a background task; they rely on the `block_resolver` check during UI load.
- Physics overrides are currently blocked strictly; "Soft Overrides" with warnings are not yet implemented.
