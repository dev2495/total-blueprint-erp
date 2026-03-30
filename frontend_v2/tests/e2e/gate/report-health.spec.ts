import { expect, test } from "../support/base"
import { annotate, assertHealthyPage, fetchJson } from "../support/test-helpers"

type RouteHealthCheck = {
  route: string
  api: string
  anchor: RegExp | string
  kind: "object" | "array"
}

const reportRouteChecks: RouteHealthCheck[] = [
  { route: "/analytics/reports/production", api: "/api/analytics/reports/production/", anchor: /Production Performance/i, kind: "object" },
  { route: "/analytics/reports/oee", api: "/api/analytics/reports/oee/", anchor: /OEE Deep Dive/i, kind: "object" },
  { route: "/analytics/reports/downtime", api: "/api/analytics/reports/downtime/", anchor: /Downtime Analysis/i, kind: "object" },
  { route: "/analytics/reports/scrap", api: "/api/analytics/reports/scrap/", anchor: /Scrap & Yield/i, kind: "object" },
  { route: "/analytics/reports/inventory", api: "/api/analytics/reports/inventory/", anchor: /Inventory Health/i, kind: "object" },
  { route: "/analytics/reports/mrp", api: "/api/analytics/reports/mrp/", anchor: /MRP & Consumption Variance/i, kind: "object" },
  { route: "/analytics/reports/sales", api: "/api/analytics/reports/sales/", anchor: /Sales Fulfillment/i, kind: "object" },
  { route: "/analytics/reports/dispatch", api: "/api/analytics/reports/dispatch/", anchor: /Dispatch & Logistics/i, kind: "object" },
  { route: "/analytics/reports/operator", api: "/api/analytics/reports/operator/", anchor: /Operator Performance/i, kind: "object" },
  { route: "/analytics/reports/costing", api: "/api/analytics/reports/costing/", anchor: /Costing & Profitability/i, kind: "object" },
  { route: "/analytics/inventory-health", api: "/api/inventory/health/", anchor: /Inventory Health/i, kind: "object" },
  { route: "/analytics/inventory-history", api: "/api/inventory/snapshots/", anchor: /Inventory Snapshot History/i, kind: "array" },
  { route: "/analytics/capability-matrix", api: "/api/analytics/capability-matrix/", anchor: /Capability Matrix/i, kind: "object" },
]

function hasMeaningfulPayload(payload: unknown, kind: "object" | "array") {
  if (kind === "array") {
    return Array.isArray(payload) && payload.length > 0
  }
  return Boolean(payload) && typeof payload === "object" && Object.keys(payload as Record<string, unknown>).length > 0
}

for (const check of reportRouteChecks) {
  test(`analytics route stays fresh: ${check.route}`, async ({ page }, testInfo) => {
    test.slow()
    annotate(testInfo, {
      module: "Analytics",
      severity: "critical",
      feature: check.route,
      expected: `${check.route} should render authenticated analytics UI and return seeded data from ${check.api}.`,
    })

    const response = await fetchJson(page, check.api)
    expect(response.status).toBe(200)
    expect(hasMeaningfulPayload(response.data, check.kind)).toBeTruthy()

    await page.goto(check.route, { waitUntil: "domcontentloaded" })
    await assertHealthyPage(page, { requireAuth: true, requireRoleSwitcher: true })
    await expect(page.locator("body")).toContainText(check.anchor, { timeout: 30_000 })
  })
}

test("report center shows seeded runs and manual send updates run history", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Analytics",
    severity: "critical",
    feature: "Report delivery freshness",
    expected: "Reports Hub should show seeded report runs, allow a manual send, and refresh run history after dispatch.",
  })

  const beforeProfiles = await fetchJson(page, "/api/analytics/report-distributions/")
  expect(beforeProfiles.status).toBe(200)
  const profiles = Array.isArray((beforeProfiles.data as any)?.profiles) ? (beforeProfiles.data as any).profiles : []
  expect(profiles.length).toBeGreaterThan(0)

  const beforeRunsResponse = await fetchJson(page, "/api/analytics/report-runs/?limit=8")
  expect(beforeRunsResponse.status).toBe(200)
  const beforeRuns = Array.isArray((beforeRunsResponse.data as any)?.runs) ? (beforeRunsResponse.data as any).runs : []
  expect(beforeRuns.length).toBeGreaterThan(0)

  await page.goto("/analytics/reports")
  await assertHealthyPage(page, { requireAuth: true, requireRoleSwitcher: true })
  await expect(page.locator("body")).toContainText(/Reports Hub/i, { timeout: 30_000 })
  await expect(page.locator("body")).toContainText(/Recent report runs/i, { timeout: 30_000 })
  await expect(page.locator("body")).toContainText(/Latest run/i, { timeout: 30_000 })

  await page.getByRole("button", { name: /send daily pack now/i }).first().click()

  let afterRuns = beforeRuns
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const afterRunsResponse = await fetchJson(page, "/api/analytics/report-runs/?limit=8")
    expect(afterRunsResponse.status).toBe(200)
    afterRuns = Array.isArray((afterRunsResponse.data as any)?.runs) ? (afterRunsResponse.data as any).runs : []
    if (
      afterRuns.length > beforeRuns.length ||
      String(afterRuns[0]?.id || "") !== String(beforeRuns[0]?.id || "") ||
      String(afterRuns[0]?.sent_at || "") !== String(beforeRuns[0]?.sent_at || "")
    ) {
      break
    }
    await page.waitForTimeout(1000)
  }

  expect(afterRuns.length).toBeGreaterThan(0)
  expect(String(afterRuns[0]?.id || "")).not.toBe(String(beforeRuns[0]?.id || ""))

  await page.reload({ waitUntil: "domcontentloaded" })
  await assertHealthyPage(page, { requireAuth: true, requireRoleSwitcher: true })
  await expect(page.locator("body")).toContainText(/Recent report runs/i, { timeout: 30_000 })
})
