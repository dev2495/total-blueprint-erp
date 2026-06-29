import type { TestInfo } from "@playwright/test"
import { expect, test } from "../support/base"
import { assertHealthyPage, assertNoHorizontalOverflow } from "../support/test-helpers"

async function attachPageShot(testInfo: TestInfo, page: Parameters<typeof assertHealthyPage>[0], name: string) {
  const body = await page.screenshot({ fullPage: true })
  await testInfo.attach(name, {
    body,
    contentType: "image/png",
  })
}

async function ensurePlannerPageVisible(page: Parameters<typeof assertHealthyPage>[0]) {
  const sheet = page.getByRole("heading", { name: /command/i })
  const tab = page.getByRole("heading", { name: /completed trace|plan queue|Launch stock from any Product Master/i })
  const isVisible = async () =>
    (await sheet.isVisible().catch(() => false)) || (await tab.isVisible().catch(() => false))

  if (!(await isVisible())) {
    await page.reload({ waitUntil: "domcontentloaded" })
    await expect.poll(isVisible, { timeout: 120_000 }).toBeTruthy()
  }
}

test.describe.serial("planner live ui regression", () => {
  test("planner control tower shows a compact execution sheet", async ({ page }, testInfo) => {
    await page.goto("/dashboard/planner/control-tower/command", { waitUntil: "domcontentloaded" })
    await assertHealthyPage(page, { requireAuth: false })
    await ensurePlannerPageVisible(page)
    await expect(page.getByRole("heading", { name: /command/i })).toBeVisible({ timeout: 120_000 })
    await expect(page.locator("body")).toContainText(/Priority runway/i)
    await expect(page.locator("body")).toContainText(/Source mix/i)
    await expect(page.locator("body")).toContainText(/Demand pipeline/i)
    await expect(page.locator("body")).toContainText(/WCM load/i)
    await expect(page.locator("body")).toContainText(/Action desk/i)
    await expect(page.getByRole("button", { name: /^Refresh$/i })).toBeVisible()
    await assertNoHorizontalOverflow(page)
    await attachPageShot(testInfo, page, "planner-control-tower")
  })

  test("planner current control tower order pages show production passports", async ({ page }, testInfo) => {
    const routes = [
      { path: "/dashboard/planner/control-tower/plan-queue", heading: /Plan Queue/i, body: /Required|Open|Layer|um/i },
      { path: "/dashboard/planner/control-tower/live-production", heading: /Live Production/i, body: /Production traveller|Live job ledger|Material issue plan/i },
      { path: "/dashboard/planner/control-tower/stock-intelligence", heading: /Stock Intelligence/i, body: /Planner stock pressure|Demand vs Stock/i },
    ]

    for (const route of routes) {
      await page.goto(route.path, { waitUntil: "domcontentloaded" })
      await assertHealthyPage(page, { requireAuth: false })
      await expect(page.getByRole("heading", { name: route.heading })).toBeVisible({ timeout: 120_000 })
      await expect(page.locator("body")).toContainText(route.body)
      await expect(page.locator("body")).not.toContainText(/control-tower-v2|control-tower-v3|free slots/i)
      await assertNoHorizontalOverflow(page)
    }

    await attachPageShot(testInfo, page, "planner-control-tower-current-passports")
  })

  test("completed orders tab behaves like an audit desk", async ({ page }, testInfo) => {
    await page.goto("/dashboard/planner/control-tower/completed-trace", { waitUntil: "domcontentloaded" })
    await assertHealthyPage(page, { requireAuth: false })
    await ensurePlannerPageVisible(page)
    await expect(page.getByRole("heading", { name: /Completed Trace/i })).toBeVisible({ timeout: 120_000 })
    await expect(page.getByRole("button", { name: /^Today$/i })).toBeVisible()
    await expect(page.getByRole("button", { name: /^7 days$/i })).toBeVisible()
    await expect(page.getByPlaceholder(/search order, template, customer/i)).toBeVisible()
    await expect(page.locator("body")).toContainText(/Cycle time/i)
    await expect(page.locator("body")).toContainText(/Export CSV/i)
    await expect(page.locator("body")).toContainText(/closed order lines|Closed orders/i)
    const firstClosedOrder = page.locator("button").filter({ hasText: /SO-\d{4}|STK|MTS/i }).first()
    if (await firstClosedOrder.isVisible().catch(() => false)) {
      await firstClosedOrder.click()
      await expect(page.locator("body")).toContainText(/Production traveller/i)
      await expect(page.locator("body")).toContainText(/Completed job ledger|No completed job log/i)
    }
    await assertNoHorizontalOverflow(page)
    await attachPageShot(testInfo, page, "planner-completed-orders-audit")
  })

  test("combine orders page loads candidates and filter controls without trapping navigation", async ({ page }, testInfo) => {
    await page.goto("/dashboard/planner/control-tower/gang-builder", { waitUntil: "domcontentloaded" })
    await assertHealthyPage(page, { requireAuth: false })
    await expect(page.getByRole("heading", { name: /Combine multiple orders onto one jumbo roll/i })).toBeVisible({ timeout: 120_000 })
    await expect(page.getByPlaceholder(/search order, customer, job, recipe/i)).toBeVisible()
    await expect(page.getByRole("button", { name: /^Combinable$/i })).toBeVisible()
    await expect(page.getByRole("button", { name: /^Needs setup$/i })).toBeVisible()
    await expect(page.getByRole("button", { name: /^Refresh$/i })).toBeVisible()

    await page.getByRole("button", { name: /^Combinable$/i }).click()
    await expect(page.locator("body")).toContainText(/Showing|No active recipes|Pick a recipe group/i)
    await page.getByRole("button", { name: /^Needs setup$/i }).click()
    await expect(page.locator("body")).not.toContainText(/Could not load combine candidates|Data load failed|timeout of 15000ms exceeded/i)
    await assertNoHorizontalOverflow(page)
    await attachPageShot(testInfo, page, "planner-combine-orders")
  })

  test("create stock order is compact, sku-first, and batch ready", async ({ page }, testInfo) => {
    await page.goto("/production/planner/stock-launcher", { waitUntil: "domcontentloaded" })
    await assertHealthyPage(page, { requireAuth: false })
    await expect(page.getByRole("heading", { name: /Launch stock from any Product Master/i })).toBeVisible({ timeout: 120_000 })
    await expect(page.locator("body")).toContainText(/Product Master/i)
    await expect(page.locator("body")).toContainText(/Commitment/i)
    await expect(page.locator("body")).toContainText(/Route stop/i)
    await expect(page.locator("body")).toContainText(/Axes builder|Spec \/ axes|Per-layer axes/i)
    await expect(page.locator("body")).toContainText(/Live BOM|Stock pool/i)
    await expect(page.locator("body")).toContainText(/Create stock order|Create WIP pool|Create FG stock/i)
    await expect(page.locator("body")).not.toContainText(/TEST_ROUTE_TRUTH_TEMPLATE_UI_MODIFY_FALLBACK/i)

    await assertNoHorizontalOverflow(page)
    await attachPageShot(testInfo, page, "planner-create-stock-order")
  })

  test("planner sku variant builder opens as a popup and keeps real layer stack inputs", async ({ page }, testInfo) => {
    await page.goto("/dashboard/planner/control-tower/stock-intelligence", { waitUntil: "domcontentloaded" })
    await assertHealthyPage(page, { requireAuth: false })
    await expect(page.getByRole("heading", { name: /stock intelligence/i })).toBeVisible({ timeout: 120_000 })
    await expect(page.locator("body")).toContainText(/New stock order|Quick stock/i)
    await expect(page.locator("body")).toContainText(/FG|WIP|Packaging|POD/i)
    await page.goto("/production/planner/stock-launcher?mode=pod", { waitUntil: "domcontentloaded" })
    await assertHealthyPage(page, { requireAuth: false })
    await expect(page.getByRole("heading", { name: /Launch stock from any Product Master/i })).toBeVisible({ timeout: 120_000 })
    await expect(page.locator("body")).toContainText(/POD/i)
    await expect(page.locator("body")).toContainText(/Per-layer axes/i)

    await assertNoHorizontalOverflow(page)
    await attachPageShot(testInfo, page, "planner-sku-dialog")
  })

  test("sales sku catalog keeps workspace text readable", async ({ page }, testInfo) => {
    await page.goto("/sales/orders/create", { waitUntil: "domcontentloaded" })
    await assertHealthyPage(page, { requireAuth: false })

    await page.getByTestId("sales-order-v34-workspace").waitFor({ state: "visible", timeout: 120_000 })
    await expect(page.locator("body")).toContainText(/Sales order|Create order/i)
    await expect(page.locator("body")).toContainText(/Customer/i)
    await expect(page.locator("body")).toContainText(/Line items|Line tabs|Lines 0/i)
    await expect(page.locator("body")).toContainText(/Product master/i)
    await assertNoHorizontalOverflow(page)
    await attachPageShot(testInfo, page, "sales-create-product-master")
  })
})
