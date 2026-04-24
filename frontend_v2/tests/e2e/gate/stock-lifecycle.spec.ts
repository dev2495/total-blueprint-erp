import { expect } from "@playwright/test"
import { test } from "../support/base"
import { annotate, assertHealthyPage, switchRole } from "../support/test-helpers"

test("stock lifecycle workspace combines opening count close correction and stock card", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Inventory",
    severity: "high",
    role: "STORE",
    feature: "Unified stock lifecycle",
    expected: "Stock lifecycle should be one polished workspace with internal tabs and old pages redirecting into the correct tab.",
  })

  await switchRole(page, "Store", "/inventory/stock-lifecycle", { allowCookieFallback: true })
  await page.goto("/inventory/stock-lifecycle", { waitUntil: "domcontentloaded" })
  await assertHealthyPage(page, { requireAuth: true })
  await expect(page.getByTestId("stock-lifecycle-workspace")).toBeVisible()
  await expect(page.locator("body")).toContainText("Opening Stock")
  await expect(page.locator("body")).toContainText("Sheet - Enter - Validate - Preview - Approve - Post")

  await page.getByTestId("stock-lifecycle-tab-count").click()
  await expect(page).toHaveURL(/tab=count/)
  await expect(page.locator("body")).toContainText("Stock Count Reconciliation")
  await expect(page.locator("body")).toContainText("Load live stock")

  await page.getByTestId("stock-lifecycle-tab-stockcard").click()
  await expect(page).toHaveURL(/tab=stockcard/)
  await expect(page.locator("body")).toContainText("Material Stock Card")
  await expect(page.locator("body")).toContainText("Running Balance")

  await page.getByTestId("stock-lifecycle-tab-yearclose").click()
  await expect(page).toHaveURL(/tab=yearclose/)
  await expect(page.locator("body")).toContainText("Year Close")
  await expect(page.locator("body")).toContainText("Close Checklist")

  await page.getByTestId("stock-lifecycle-tab-correction").click()
  await expect(page).toHaveURL(/tab=correction/)
  await expect(page.locator("body")).toContainText("Financial Year Correction")
  await expect(page.locator("body")).toContainText("Reason / authority")

  await expect(page.getByTestId("sidebar-link-inventory-stock-lifecycle").first()).toBeVisible()
  await expect(page.getByTestId("sidebar-link-inventory-opening-stock")).toHaveCount(0)
  await expect(page.getByTestId("sidebar-link-inventory-stock-count")).toHaveCount(0)
  await expect(page.getByTestId("sidebar-link-inventory-year-close")).toHaveCount(0)
  await expect(page.getByTestId("sidebar-link-inventory-fy-correction")).toHaveCount(0)
  await expect(page.getByTestId("sidebar-link-inventory-stock-card")).toHaveCount(0)
})

test("legacy stock lifecycle routes redirect into the unified workspace", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Inventory",
    severity: "medium",
    role: "STORE",
    feature: "Stock lifecycle compatibility redirects",
    expected: "Existing route links should keep working while landing inside the unified stock lifecycle workspace.",
  })

  await switchRole(page, "Store", "/inventory/stock-lifecycle", { allowCookieFallback: true })

  const redirects: Array<[string, RegExp]> = [
    ["/inventory/opening-stock", /\/inventory\/stock-lifecycle\?tab=opening/],
    ["/inventory/stock-count", /\/inventory\/stock-lifecycle\?tab=count/],
    ["/inventory/stock-card", /\/inventory\/stock-lifecycle\?tab=stockcard/],
    ["/inventory/year-close", /\/inventory\/stock-lifecycle\?tab=yearclose/],
    ["/inventory/fy-correction", /\/inventory\/stock-lifecycle\?tab=correction/],
  ]

  for (const [route, expectedUrl] of redirects) {
    await page.goto(route, { waitUntil: "domcontentloaded" })
    await expect(page).toHaveURL(expectedUrl)
    await expect(page.getByTestId("stock-lifecycle-workspace")).toBeVisible()
  }
})
