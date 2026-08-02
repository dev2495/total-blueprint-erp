import { expect, test } from "../support/base"
import {
  annotate,
  assertHealthyPage,
  assertNoHorizontalOverflow,
  collectSidebarRoutes,
  fetchJson,
  switchRole,
} from "../support/test-helpers"

function formatMaybeCurrency(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(numeric)) return "—"
  if (numeric >= 10_000_000) return `₹${(numeric / 10_000_000).toFixed(2)} Cr`
  if (numeric >= 100_000) return `₹${(numeric / 100_000).toFixed(1)} L`
  if (numeric >= 1_000) return `₹${(numeric / 1_000).toFixed(1)}K`
  return `₹${numeric.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
}

test("owner dashboard renders seeded executive telemetry", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Analytics",
    severity: "critical",
    role: "OWNER",
    feature: "Owner command deck",
    expected: "Owner dashboard should render seeded revenue, SKU, POD, and audit-aware telemetry instead of placeholder emptiness.",
  })

  const response = await fetchJson(page, "/api/analytics/control-tower/?timeframe=month")
  expect(response.status).toBe(200)
  const payload = response.data as any
  const metrics = Array.isArray(payload?.metrics) ? payload.metrics : []
  const revenue = Number(metrics.find((metric: any) => metric?.id === "revenue")?.value || 0)
  const skuPerformance = Array.isArray(payload?.sku_performance) ? payload.sku_performance : []
  const podKpis = payload?.pod_kpis || {}

  expect(revenue).toBeGreaterThan(0)
  expect(skuPerformance.length).toBeGreaterThan(0)
  expect(Number(podKpis.active_pod_variants || 0)).toBeGreaterThan(0)

  await page.goto("/dashboard/owner", { waitUntil: "domcontentloaded" })
  await assertHealthyPage(page, { requireAuth: true, requireRoleSwitcher: true })
  await assertNoHorizontalOverflow(page)

  const body = page.locator("body")
  await expect(body).toContainText(/Owner Command Deck/i)
  await expect(body).not.toContainText(/No executive telemetry seeded yet/i)
  await expect(body).toContainText(formatMaybeCurrency(revenue))
  await expect(body).toContainText(/SKU Performance/i)
  await expect(body).toContainText(/POD Intelligence/i)
  await expect(body).toContainText(/Route Reuse Pools/i)
})

test("planner dashboard renders seeded planning telemetry and action surfaces", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Analytics",
    severity: "critical",
    role: "PLANNER",
    feature: "Planner command center",
    expected: "Planner dashboard should render seeded queue, capacity, source-pool, and recent-activity telemetry instead of blank sections.",
  })

  const response = await fetchJson(page, "/api/analytics/planner-dashboard/")
  expect(response.status).toBe(200)
  const payload = response.data as any
  const queue = Number(payload?.queue_kpis?.planning_queue || 0)
  const jobDistribution = Array.isArray(payload?.job_distribution) ? payload.job_distribution : []
  const workCenters = Array.isArray(payload?.wc_capacity) ? payload.wc_capacity : []
  const recent = Array.isArray(payload?.recent_activity) ? payload.recent_activity : []

  expect(queue).toBeGreaterThan(0)
  expect(jobDistribution.length).toBeGreaterThan(0)
  expect(workCenters.length).toBeGreaterThan(0)
  expect(recent.length).toBeGreaterThan(0)

  await page.goto("/dashboard/planner", { waitUntil: "domcontentloaded" })
  await assertHealthyPage(page, { requireAuth: true, requireRoleSwitcher: true })
  await assertNoHorizontalOverflow(page)

  const body = page.locator("body")
  await expect(body).toContainText(/Planner Command Center/i)
  await expect(body).not.toContainText(/No planner telemetry seeded yet/i)
  await expect(body).not.toContainText(/^No jobs$/i)
  await expect(body).not.toContainText(/No work centers/i)
  await expect(body).toContainText(/Final Roll Pool/i)
  await expect(body).toContainText(/Invariant Pool/i)
  await expect(body).toContainText(/Upstream Pool/i)
  await expect(body).toContainText(/Immediate Actions/i)
})

test("wcm command deck renders seeded execution telemetry", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Operations",
    severity: "critical",
    role: "WORK_CENTER_MANAGER",
    feature: "WCM command deck",
    expected: "WCM dashboard should render shift, machine, blocker, and recent floor telemetry with action-oriented cards.",
  })

  const response = await fetchJson(page, "/api/analytics/wcm-dashboard/")
  expect(response.status).toBe(200)
  const payload = response.data as any
  const activeWorkCenters = Number(payload?.hero?.active_work_centers || 0)
  const clusters = Array.isArray(payload?.machine_clusters) ? payload.machine_clusters : []
  const recent = Array.isArray(payload?.recent_activity) ? payload.recent_activity : []

  expect(activeWorkCenters).toBeGreaterThan(0)
  expect(clusters.length).toBeGreaterThan(0)
  expect(recent.length).toBeGreaterThan(0)

  await page.goto("/dashboard/work-center", { waitUntil: "domcontentloaded" })
  await assertHealthyPage(page, { requireAuth: true, requireRoleSwitcher: true })
  await assertNoHorizontalOverflow(page)

  const body = page.locator("body")
  await expect(body).toContainText(/Execution Command Deck/i)
  await expect(body).toContainText(/Work Center Command Deck/i)
  await expect(body).not.toContainText(/No WCM telemetry is available yet/i)
  await expect(body).toContainText(/Assigned Work-Center Escalations/i)
  await expect(body).toContainText(/Execution Discipline/i)
  await expect(body).toContainText(/Recent Floor Activity/i)
  await expect(body).toContainText(/Assigned Work Center Board/i)
})

test("audit center stays admin-only while inventory keeps genealogy access", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Administration",
    severity: "critical",
    feature: "Audit center split",
    expected: "Enterprise audit should be admin-only while inventory retains genealogy access and roll trace entrypoints.",
  })

  await page.goto("/system/audit", { waitUntil: "domcontentloaded" })
  await assertHealthyPage(page, { requireAuth: true, requireRoleSwitcher: true })
  await expect(page.locator("body")).toContainText(/Audit Center/i)
  await expect(page.locator("body")).toContainText(/Guided search/i)

  const adminRoutes = await collectSidebarRoutes(page)
  expect(adminRoutes).toContain("/system/audit")

  await switchRole(page, "Store", "/inventory/rolls-v36", { allowCookieFallback: true })

  const storeRoutes = await collectSidebarRoutes(page)
  expect(storeRoutes).not.toContain("/system/audit")
  expect(storeRoutes).toContain("/inventory/traceability")

  await page.goto("/system/audit", { waitUntil: "domcontentloaded" })
  await expect(page.locator("body")).toContainText(/Audit Center is limited to owner and admin roles/i)

  await page.goto("/inventory/traceability", { waitUntil: "domcontentloaded" })
  await assertHealthyPage(page, { requireAuth: true })
  await expect(page.locator("body")).toContainText(/Roll Genealogy/i)
  await expect(page.locator("body")).toContainText(/Trace roll|Back to stock/i)
  await expect(page.locator("body")).not.toContainText(/Audit Center/i)
})
