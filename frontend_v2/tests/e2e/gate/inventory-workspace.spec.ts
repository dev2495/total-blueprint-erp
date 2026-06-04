import { expect } from "@playwright/test"
import { test } from "../support/base"
import { annotate, assertHealthyPage, switchRole } from "../support/test-helpers"

async function chooseFilter(page: any, testId: string, optionName: RegExp | string) {
  await page.getByTestId(testId).click()
  await page.getByRole("option", { name: optionName, exact: typeof optionName === "string" }).click()
}

async function chooseFirstSpecificFilter(page: any, testId: string) {
  await page.getByTestId(testId).click()
  const options = page.getByRole("option")
  const count = await options.count()
  if (count <= 1) {
    await page.keyboard.press("Escape")
    return false
  }
  await options.nth(1).click()
  return true
}

test("unified inventory workspace renders V36 stock sections and keeps compatibility redirects usable", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Inventory",
    severity: "high",
    role: "STORE",
    feature: "Unified inventory workspace",
    expected: "Store users get one polished inventory workspace with stock tabs, GRN history, both heatmaps, and compatibility redirects.",
  })

  await switchRole(page, "Store", "/inventory", { allowCookieFallback: true })
  await page.goto("/inventory", { waitUntil: "domcontentloaded" })
  await assertHealthyPage(page, { requireAuth: true })
  await expect(page.getByTestId("sidebar-link-inventory").first()).toBeVisible()
  await expect(page.getByTestId("sidebar-link-inventory-grn-v36").first()).toBeHidden()
  await expect(page.locator("body")).toContainText("Stock workspace")
  await expect(page.locator("body")).toContainText("Stock by age")
  await expect(page.locator("body")).toContainText("Stock by class")
  await expect(page.locator("body")).toContainText("Variant × thickness matrix")

  await page.getByRole("button", { name: /Bulk/i }).first().click()
  await expect(page.locator("body")).toContainText("Bulk granules & chemicals")

  await page.getByRole("button", { name: /Packaging/i }).first().click()
  await expect(page.locator("body")).toContainText("Packaging materials")

  await page.goto("/inventory/bulk-v36", { waitUntil: "domcontentloaded" })
  await expect(page).toHaveURL(/\/inventory\/bulk-v36/)
  await page.goto("/inventory/packaging-v36", { waitUntil: "domcontentloaded" })
  await expect(page).toHaveURL(/\/inventory\/packaging-v36/)
  await page.goto("/inventory/rolls-v36", { waitUntil: "domcontentloaded" })
  await expect(page).toHaveURL(/\/inventory\/rolls-v36/)
})

test("inventory workspace filters apply across V36 stock classes", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Inventory",
    severity: "high",
    role: "STORE",
    feature: "Inventory workspace filters",
    expected: "Every visible inventory filter keeps the V36 stock workspace usable without placeholder controls.",
  })

  await switchRole(page, "Store", "/inventory", { allowCookieFallback: true })
  await page.goto("/inventory", { waitUntil: "domcontentloaded" })
  await assertHealthyPage(page, { requireAuth: true })

  await page.goto("/inventory/bulk", { waitUntil: "domcontentloaded" })
  await page.getByRole("button", { name: /^Browse$/i }).click()
  await page.getByTestId("inventory-workspace-search").fill("HDPE")
  await expect(page.locator("body")).toContainText(/Bulk granules|No bulk/)

  await page.goto("/inventory/rolls", { waitUntil: "domcontentloaded" })
  await page.getByRole("button", { name: /^Browse$/i }).click()
  await page.getByTestId("inventory-workspace-search").fill("LD")
  await expect(page.locator("body")).toContainText(/Variant × thickness matrix|No rolls/)

  await page.goto("/inventory/packaging", { waitUntil: "domcontentloaded" })
  await page.getByRole("button", { name: /^Browse$/i }).click()
  await page.getByTestId("inventory-workspace-search").fill("PACK_INNER")
  await expect(page.locator("body")).toContainText(/Packaging materials|No packaging/)

  await page.goto("/inventory?tab=bulk", { waitUntil: "domcontentloaded" })
  await expect(page.locator("body")).toContainText(/Bulk granules|No bulk/)
  await page.goto("/inventory?tab=packaging", { waitUntil: "domcontentloaded" })
  await expect(page.locator("body")).toContainText(/Packaging materials|No packaging/)
})
