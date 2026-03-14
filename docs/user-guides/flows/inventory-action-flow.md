# Inventory Action Flow

## Nodes
## 1. Scan stock state
- HI: स्टॉक स्थिति स्कैन
- Outcomes:
  - Healthy -> Continue monitoring and cycle counts.
  - Mismatch

## 2. Reconcile movement
- HI: मूवमेंट मिलान
- Outcomes:
  - Reconciled -> Post adjustment with audit reason.
  - Not reconciled -> Escalate to store/admin control tower.
