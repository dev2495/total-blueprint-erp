import { expect, test } from "../support/base"
import { annotate, assertHealthyPage, fetchJson, assertNoHorizontalOverflow } from "../support/test-helpers"

type RouteCheck = {
  route: string
  anchor: RegExp
  api?: string
  kind?: "object" | "array"
}

const checks: RouteCheck[] = [
  { route: "/analytics/reports", anchor: /Reports Hub/i },
  { route: "/analytics/reports/production", api: "/api/analytics/reports/production/", anchor: /Production Performance/i, kind: "object" },
  { route: "/analytics/reports/oee", api: "/api/analytics/reports/oee/", anchor: /OEE Deep Dive/i, kind: "object" },
  { route: "/analytics/reports/downtime", api: "/api/analytics/reports/downtime/", anchor: /Downtime Analysis/i, kind: "object" },
  { route: "/analytics/reports/scrap", api: "/api/analytics/reports/scrap/", anchor: /Scrap & Yield/i, kind: "object" },
  { route: "/analytics/reports/inventory", api: "/api/analytics/reports/inventory/", anchor: /Inventory Health/i, kind: "object" },
  { route: "/analytics/reports/interplant", api: "/api/analytics/reports/interplant/", anchor: /Inter-Plant Logistics/i, kind: "object" },
  { route: "/analytics/reports/mrp", api: "/api/analytics/reports/mrp/", anchor: /MRP & Consumption Variance/i, kind: "object" },
  { route: "/analytics/reports/sales", api: "/api/analytics/reports/sales/", anchor: /Sales Fulfillment/i, kind: "object" },
  { route: "/analytics/reports/dispatch", api: "/api/analytics/reports/dispatch/", anchor: /Dispatch & Logistics/i, kind: "object" },
  { route: "/analytics/reports/operator", api: "/api/analytics/reports/operator/", anchor: /Operator Performance/i, kind: "object" },
  { route: "/analytics/reports/costing", api: "/api/analytics/reports/costing/", anchor: /Costing & Profitability/i, kind: "object" },
  { route: "/analytics/inventory-health", api: "/api/inventory/health/", anchor: /Inventory Health/i, kind: "object" },
  { route: "/analytics/inventory-history", api: "/api/inventory/snapshots/?limit=180&days=180", anchor: /Inventory Snapshot History/i, kind: "array" },
  { route: "/analytics/capability-matrix", api: "/api/analytics/capability-matrix/", anchor: /Capability Matrix/i, kind: "object" },
  { route: "/analytics/mrp", anchor: /MRP Center/i },
]

function hasMeaningfulPayload(payload: unknown, kind?: "object" | "array") {
  if (!kind) return true
  if (kind === "array") return Array.isArray(payload) && payload.length > 0
  return Boolean(payload) && typeof payload === "object" && !Array.isArray(payload) && Object.keys(payload as Record<string, unknown>).length > 0
}

test("analytics runtime surfaces stay live, data-rich, and interactive", async ({ page }, testInfo) => {
  test.slow()
  annotate(testInfo, {
    module: "Analytics",
    severity: "critical",
    role: "ADMIN",
    feature: "Reports hub + notification + MRP runtime",
    expected: "Reports hub, inventory history, MRP Center, report routes, and the notification tray should all load from authenticated runtime truth without crashing.",
  })

  for (const check of checks) {
    if (check.api) {
      const response = await fetchJson(page, check.api)
      expect(response.status, `${check.api} should return 200`).toBe(200)
      expect(hasMeaningfulPayload(response.data, check.kind), `${check.api} should return meaningful payload`).toBeTruthy()
    }

    await page.goto(check.route, { waitUntil: "domcontentloaded", timeout: 60_000 })
    await expect(page.locator("body")).toContainText(check.anchor, { timeout: 60_000 })
    await assertHealthyPage(page, { requireAuth: false })
    await assertNoHorizontalOverflow(page)
  }

  await page.goto("/dashboard/admin", { waitUntil: "domcontentloaded", timeout: 60_000 })
  await expect(page.locator("body")).toContainText(/System Admin Console|Command Center/i, { timeout: 60_000 })
  await assertHealthyPage(page, { requireAuth: false })
  await page.getByTestId("notification-bell-trigger").click()
  await page.getByTestId("notification-bell-popover").waitFor({ state: "visible", timeout: 15_000 })
  await expect(page.getByTestId("notification-bell-popover")).toContainText(
    /Daily report pack ready|Daily report ready|No notifications to show|All caught up/i,
    { timeout: 15_000 }
  )
  await expect(page.getByTestId("notification-bell-popover")).toHaveCSS("overflow-y", /auto|scroll/)
})
