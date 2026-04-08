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
  const sheet = page.getByTestId("planner-operating-sheet")
  const tab = page.getByRole("tab", { name: /completed orders/i })
  const isVisible = async () =>
    (await sheet.isVisible().catch(() => false)) || (await tab.isVisible().catch(() => false))

  if (!(await isVisible())) {
    await page.reload({ waitUntil: "domcontentloaded" })
    await expect.poll(isVisible, { timeout: 120_000 }).toBeTruthy()
  }
}

test.describe.serial("planner live ui regression", () => {
  test("planner control tower shows a compact execution sheet", async ({ page }, testInfo) => {
    await page.goto("/production/planner", { waitUntil: "domcontentloaded" })
    await assertHealthyPage(page, { requireAuth: false })
    await ensurePlannerPageVisible(page)
    await expect(page.getByText(/loading planner queue/i)).not.toBeVisible({ timeout: 120_000 })
    await page.getByTestId("planner-operating-sheet").waitFor({ state: "visible", timeout: 120_000 })

    await expect(page.getByRole("heading", { name: /planner operating desk/i })).toBeVisible()
    await expect(page.getByTestId("planner-operating-sheet")).toContainText(/suggested action/i)
    await expect(page.getByTestId("planner-operating-sheet")).toContainText(/available inventory/i)
    await expect(page.getByTestId("planner-operating-sheet")).toContainText(/sales order details/i)
    await expect(page.getByTestId("planner-operating-sheet")).toContainText(/customer/i)
    await expect(page.getByTestId("planner-operating-sheet")).toContainText(/demand/i)
    await expect(page.getByTestId("planner-operating-sheet")).toContainText(/geometry/i)
    await expect(page.getByTestId("planner-operating-sheet")).toContainText(/layers/i)
    await expect(page.getByTestId("planner-operating-sheet")).toContainText(/printing/i)
    await expect(page.getByTestId("planner-operating-sheet")).toContainText(/add-ons/i)
    await expect(page.getByTestId("planner-operating-sheet")).toContainText(/packaging/i)
    await expect(page.getByTestId("planner-operating-sheet")).toContainText(/\bpod\b/i)
    await expect(page.getByTestId("planner-operating-sheet")).toContainText(/next step/i)
    await expect(page.getByTestId("planner-operating-sheet")).toContainText(/stock snapshot/i)
    await expect(page.getByRole("button", { name: /^Route\b/i })).toBeVisible()
    await expect(page.getByRole("button", { name: /^Material\b/i })).toBeVisible()
    await expect(page.getByTestId("planner-release-rail")).toBeVisible()
    await assertNoHorizontalOverflow(page)
    await attachPageShot(testInfo, page, "planner-control-tower")
  })

  test("completed orders tab behaves like an audit desk", async ({ page }, testInfo) => {
    await page.goto("/production/planner", { waitUntil: "domcontentloaded" })
    await assertHealthyPage(page, { requireAuth: false })
    await ensurePlannerPageVisible(page)
    await page.getByTestId("planner-operating-sheet").waitFor({ state: "visible", timeout: 120_000 })

    await page.getByRole("tab", { name: /completed orders/i }).click()
    await expect(page.getByRole("button", { name: /^Today$/i })).toBeVisible()
    await expect(page.getByRole("button", { name: /^7 days$/i })).toBeVisible()
    await expect(page.getByPlaceholder(/search order, customer, template, job/i)).toBeVisible()
    await expect(page.getByRole("columnheader", { name: /source used/i })).toBeVisible()
    await expect(page.getByRole("columnheader", { name: /completed on/i })).toBeVisible()
    await assertNoHorizontalOverflow(page)
    await attachPageShot(testInfo, page, "planner-completed-orders-audit")
  })

  test("create stock order is compact, sku-first, and batch ready", async ({ page }, testInfo) => {
    await page.goto("/production/planner/stock-orders/create", { waitUntil: "domcontentloaded" })
    await assertHealthyPage(page, { requireAuth: false })
    await expect(page.getByRole("heading", { name: /create stock orders/i })).toBeVisible({ timeout: 120_000 })

    await expect(page.getByText(/sales sku gives the approved commercial spec/i)).toBeVisible()
    await expect(page.getByRole("button", { name: /^POD$/i })).toBeDisabled()
    await expect(page.getByRole("button", { name: /^PKG$/i })).toBeDisabled()
    await expect(page.getByText(/release cart/i)).toBeVisible()
    await expect(page.getByRole("combobox", { name: "Sales SKU", exact: true })).toBeVisible()
    await expect(page.getByRole("combobox", { name: "Sales SKU variant", exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: /^POD$/i })).toHaveAttribute("title", /sales variant with POD linkage/i)
    await expect(page.getByRole("button", { name: /^PKG$/i })).toHaveAttribute("title", /sales variant with packaging linkage/i)

    await page.goto("/production/planner/stock-orders/create?source=planner", { waitUntil: "domcontentloaded" })
    await assertHealthyPage(page, { requireAuth: false })
    await expect(page.getByText(/sku family/i)).toBeVisible()
    await expect(page.getByText(/planner preset already owns route span/i)).toBeVisible()
    await page.getByRole("button", { name: /^POD$/i }).click({ force: true })
    await expect(page.getByText(/release cart/i)).toBeVisible()

    await page.goto("/production/planner/stock-orders/create?source=custom", { waitUntil: "domcontentloaded" })
    await assertHealthyPage(page, { requireAuth: false })
    await expect(page.getByRole("combobox", { name: "Template", exact: true })).toBeVisible()
    await expect(page.getByText(/custom is the full manual path/i)).toBeVisible()
    await expect(page.getByText(/width \(mm\)|roll width \(mm\)/i)).toBeVisible()
    await expect(page.locator("body")).not.toContainText(/TEST_ROUTE_TRUTH_TEMPLATE_UI_MODIFY_FALLBACK/i)

    await assertNoHorizontalOverflow(page)
    await attachPageShot(testInfo, page, "planner-create-stock-order")
  })

  test("planner sku variant builder opens as a popup and keeps real layer stack inputs", async ({ page }, testInfo) => {
    await page.goto("/production/planner/sku-catalog", { waitUntil: "domcontentloaded" })
    await assertHealthyPage(page, { requireAuth: false })
    await expect(page.getByRole("heading", { name: /planner sku studio/i })).toBeVisible({ timeout: 120_000 })

    await page.getByRole("button", { name: /new variant/i }).first().click()
    await expect(page.getByTestId("planner-variant-builder")).toBeVisible()
    await expect(page.getByTestId("planner-variant-builder")).toContainText(/output type/i)
    await expect(page.getByTestId("planner-variant-builder")).toContainText(/material structure/i)
    await expect(page.getByRole("button", { name: /add layer/i })).toBeVisible()

    await page.getByRole("combobox").nth(0).click()
    await page.getByRole("option", { name: /^POD$/i }).click()
    await expect(page.getByTestId("planner-variant-builder")).toContainText(/real layer stack|consuming film structure/i)

    await assertNoHorizontalOverflow(page)
    await attachPageShot(testInfo, page, "planner-sku-dialog")
  })

  test("sales sku catalog keeps workspace text readable", async ({ page }, testInfo) => {
    await page.goto("/sales/sku-catalog", { waitUntil: "domcontentloaded" })
    await assertHealthyPage(page, { requireAuth: false })

    await expect(page.getByRole("heading", { name: /sales sku studio/i })).toBeVisible()
    await expect(page.getByText(/selected sku workspace/i)).toBeVisible()
    await expect(page.getByText(/orderable variant lane/i)).toBeVisible()
    await assertNoHorizontalOverflow(page)
    await attachPageShot(testInfo, page, "sales-sku-catalog")
  })
})
