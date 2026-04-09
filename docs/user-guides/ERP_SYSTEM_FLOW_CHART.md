# Total Poly Print ERP - End-to-End System Flow

Use this chart to explain the live ERP to new users. It shows the normal path from secure login through commercial order, planning, shop-floor execution, packing, dispatch, reporting, and governance.

```mermaid
flowchart TD
  Login["Secure login<br/>Role selected / override header audited"] --> Landing["Role landing dashboard<br/>Admin / Owner / Sales / Planner / Store / WCM / Operator / Packing / Dispatch"]
  Landing --> Master["Master data setup<br/>Customers, vendors, plants, work centers, machines, films, inks, add-ons, packaging, POD stock"]
  Landing --> Sales["Sales order placement<br/>Customer demand, SKU/product truth, KG/PCS, printing ink colors, add-ons, pouch/roll/stock order intent"]
  Master --> Engineering["Engineering control<br/>Artwork, cylinders, route template, step policy, material/ink/add-on mapping"]
  Sales --> Engineering
  Engineering --> Planner["Planner control tower<br/>Choose direct FG / WIP invariant / make fresh / stock replenishment / POD packing; validate route, target qty, material policy"]
  Planner --> StoreIssue["Store + inventory issue<br/>Bulk stock, roll stock, ink, adhesives/solvents, packaging, assigned rolls, inter-plant challan when location differs"]
  StoreIssue --> WCM["WCM command deck<br/>Release step to work center, route proof, material feed, WIP pool input, issue rule verification"]
  WCM --> Machine["Machine terminal<br/>Pick released job, start, capture actual output, scrap, returns, ink/material consumption, output roll/pouch/bulk log"]
  Machine --> OutputDecision{"Step output type"}
  OutputDecision --> BulkRoll["Bulk to roll<br/>One or many output rolls logged; consumed bulk + ink/material actuals"]
  OutputDecision --> RollRoll["Roll to roll<br/>Input roll(s) processed; output roll(s), scrap KG, returned balance, ink/material actuals"]
  OutputDecision --> MultiRoll["Multi roll input to output<br/>Selected WIP/stock rolls consumed; output roll goes to WIP pool or FG"]
  OutputDecision --> Pouch["Pouch conversion<br/>Loose pouch PCS/KG or inner-packed pouch bundle per sales-order packing rule"]
  OutputDecision --> BulkBulk["Bulk to bulk<br/>Bulk batch consumption/output when route/policy requires it"]
  Machine --> Jobwork{"Need outside process?"}
  Jobwork -->|"yes"| JobworkOut["Job-work dispatch<br/>Send selected WIP/material outside, record challan, receive back, continue same route"]
  JobworkOut --> WCM
  Jobwork -->|"no"| NextStep{"Route complete?"}
  BulkRoll --> NextStep
  RollRoll --> NextStep
  MultiRoll --> NextStep
  Pouch --> NextStep
  BulkBulk --> NextStep
  NextStep -->|"no"| WipPool["WIP roll / pouch / bulk pool<br/>Next step input visible only after upstream step completion"]
  WipPool --> WCM
  NextStep -->|"yes"| Packing["Packing Yard<br/>Finished rolls or pouch batches; loose-to-gunny / inner-pack-to-gunny; gunny tare/gross/net and PCS math"]
  Packing --> Dispatch["Dispatch Bay<br/>Only units released by Packing Yard; select released units, create dispatch/challan, print and hand off"]
  Dispatch --> Reports["Analytics + Reports Hub<br/>Sales, production, OEE, MRP, scrap, interplant, costing, inventory, KPI, report activity"]
  Machine --> Reports
  StoreIssue --> Reports
  Dispatch --> Notifications["Notifications + audits<br/>Role-targeted in-app/email, permission audit logs, profile change approvals"]
  Reports --> Backups["Production operations<br/>Render health checks, PostgreSQL/Redis, Celery worker/beat, scheduled daily backup/report tasks"]
  Notifications --> Governance["System governance<br/>Users, base role, extra overrides, work-center/machine assignments, role matrix, role signoff"]
  Governance --> Login
```

## Operational Rule Of Thumb

- Sales owns the customer promise: KG, PCS, product truth, print/ink requirement, pouch/roll/packing requirement.
- Engineering owns repeatable manufacture: artwork, cylinder, route, step policy, material and ink mapping.
- Planner owns release choice: direct FG, WIP/invariant, make fresh, jobwork continuation, replenishment, and target/remaining pressure.
- Store owns material truth: issue, receipt, inter-plant transfer, GRN, bulk inventory, roll inventory, ink/material stock.
- WCM owns step readiness: queue release, material feed policy, WIP input selection, machine assignment, current-step handoff.
- Operator/Machine terminal owns actuals: output logs, roll/pouch/bulk/batch truth, ink/material consumption, scrap, returns, close.
- Packing Yard owns physical dispatch units before dispatch: loose pouches, inner packs, gunnies, roll handoff, tare/gross/net/PCS.
- Dispatch Bay owns shipment handoff: only packing-released units appear; challan/dispatch/print/complete happens there.
- Reports/analytics read from live operational records; if a report has zeros, verify upstream execution actuals and issue/consumption logs first.
- Governance controls access with one base role plus explicit extra overrides; overrides should be rare and visible.
