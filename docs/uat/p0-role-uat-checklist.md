# P0 UAT Checklist (Role-wise)

## Pre-check
- staging deployed from `main`
- migrations applied
- worker + beat healthy
- latest anonymized data refresh completed

## Core lane: Sales -> Dispatch
1. `SALES`
   - create sales order
   - confirm order
   - verify planner notification event emitted
2. `PLANNER`
   - receives planning required notification
   - releases job
   - verifies work-center manager notification
3. `WORK_CENTER_MANAGER`
   - sees released job in allowed modules only
   - updates machine readiness state
4. `OPERATOR`
   - sees assigned execution queue only
   - marks production completion
5. `STORE`
   - receives FG/inventory notifications
   - performs material movement visibility checks
6. `DISPATCH`
   - receives dispatch-ready notification
   - completes dispatch handoff

## RBAC assertions
- unmapped/forbidden modules return 403
- deny events appear in permission audit
- role override blocked in prod profile

## Ops assertions
- backup run-now API works
- restore drill run-now API records status
- `/api/health/live/` and `/api/health/ready/` return expected contracts

## Signoff
- each department signs module/action visibility
- unresolved signoff rows = 0 before production go-live
