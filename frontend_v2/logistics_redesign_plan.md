# Implementation Plan

## Goal Description
Redesign the Logistics Landing Page (`dashboard/logistics/page.tsx`) to replace mock data with actionable insights, charts, and KPI cards reflecting real API data. Simultaneously, redesign the Dispatch Bay (`logistics/dispatch/page.tsx`) to improve readability and usability by using lighter colors, cleaner typography, and a simplified layout.

## User Review Required
None beyond standard UI/UX approval.

## Proposed Changes

### dashboard/logistics/page.tsx (Logistics Landing Page)
[MODIFY] `/Users/devarshthakkar/Documents/total_blueprint_erp/frontend_v2/src/app/(dashboard)/dashboard/logistics/page.tsx`
- Remove hardcoded mock data.
- Integrate `logisticsService.getChallans()` and `logisticsService.getSalesOrdersWithFG()` to fetch real data.
- Add dynamic KPI cards computing total pending challans, dispatch-ready orders, vehicles in transit, etc.
- Introduce Recharts to visualize Dispatch Trends (e.g., number of challans generated per day) or fulfillment status.
- Add a "Recent Logistics Activity" feed or table based on the latest challans.
- Use the modern SaaS aesthetic with subtle background colors, shadow-sm, and polished Lucide icons.

### logistics/dispatch/page.tsx (Dispatch Bay)
[MODIFY] `/Users/devarshthakkar/Documents/total_blueprint_erp/frontend_v2/src/app/(dashboard)/logistics/dispatch/page.tsx`
- Convert the dark/indigo heavy themes (e.g., `bg-slate-900 border-white/5` and `bg-slate-950/95`) into cleaner, lighter themes (`bg-white border-slate-200 shadow-sm`).
- Improve font readability by using standard text weights instead of pure `font-black` everywhere.
- Simplify tracking metric cards ("SO Metrics") into a cleaner grid format with distinct but soft indicator colors.
- Maintain existing logic and API calls (Roll Packing, Challan Creation, SO Selection) but rebuild the presentation layer.

## Verification Plan
### Automated Tests
- Build frontend to ensure type safety.
### Manual Verification
- Verify the Logistics Hub loads without errors and displays realistic aggregated metrics from the API.
- Create a test Challan via the redesigned Dispatch Bay to ensure functionality remains intact while UI is improved.
