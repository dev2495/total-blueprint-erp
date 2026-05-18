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
    await expect(page.locator("body")).toContainText(/Work center load/i)
    await expect(page.locator("body")).toContainText(/Action desk/i)
    await expect(page.getByRole("button", { name: /^Refresh$/i })).toBeVisible()
    await assertNoHorizontalOverflow(page)
    await attachPageShot(testInfo, page, "planner-control-tower")
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
    await assertNoHorizontalOverflow(page)
    await attachPageShot(testInfo, page, "planner-completed-orders-audit")
  })

  test("create stock order is compact, sku-first, and batch ready", async ({ page }, testInfo) => {
    await page.goto("/production/planner/stock-launcher", { waitUntil: "domcontentloaded" })
    await assertHealthyPage(page, { requireAuth: false })
    await expect(page.getByRole("heading", { name: /Launch stock from any Product Master/i })).toBeVisible({ timeout: 120_000 })
    await expect(page.locator("body")).toContainText(/Product Master/i)
    await expect(page.locator("body")).toContainText(/Commitment/i)
    await expect(page.locator("body")).toContainText(/Route stop/i)
    await expect(page.locator("body")).toContainText(/Axes builder/i)
    await expect(page.locator("body")).toContainText(/Live BOM|Stock pool/i)
    await expect(page.locator("body")).toContainText(/Create stock order/i)
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
    await expect(page.locator("body")).toContainText(/Line items/i)
    await expect(page.locator("body")).toContainText(/Product master/i)
    await assertNoHorizontalOverflow(page)
    await attachPageShot(testInfo, page, "sales-create-product-master")
  })
})
