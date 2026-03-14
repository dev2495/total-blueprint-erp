# Dashboard Response Flow

## Nodes
## 1. Identify Alert Severity
- HI: अलर्ट गंभीरता पहचानें
- Outcomes:
  - Critical
  - Operational

## 2. Execute Assigned Action
- HI: निर्धारित कार्रवाई करें
- Outcomes:
  - Resolved -> Log closure notes and continue queue.
  - Blocked

## 3. Escalate with Evidence
- HI: प्रमाण सहित एस्केलेट करें
- Outcomes:
  - Escalated -> Share route, payload, and timestamp in escalation note.
