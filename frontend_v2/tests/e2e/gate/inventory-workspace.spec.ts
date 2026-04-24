import { expect } from "@playwright/test"
import { test } from "../support/base"
import { annotate, assertHealthyPage, switchRole } from "../support/test-helpers"

async function chooseFilter(page: any, testId: string, optionName: RegExp | string) {
  await page.getByTestId(testId).click()
  await page.getByRole("option", { name: optionName, exact: typeof optionName === "string" }).click()
}

test("unified inventory workspace renders tabs, redirects old stock routes, and keeps heatmap drilldowns usable", async ({ page }, testInfo) => {
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
  await expect(page.locator("body")).toContainText("Roll Explorer")
  await expect(page.locator("body")).toContainText("Freshness Bands")
  await expect(page.locator("body")).toContainText("Age Heatmap")
  await expect(page.locator("body")).toContainText("Size / Variant Matrix")

  await page.getByRole("tab", { name: /Bulk Inventory/i }).click()
  await expect(page).toHaveURL(/tab=bulk/)
  await expect(page.locator("body")).toContainText("Bulk Inventory")
  await expect(page.locator("body")).toContainText("Category Mass Split")

  await page.getByRole("tab", { name: /Packaging Stock/i }).click()
  await expect(page).toHaveURL(/tab=packaging/)
  await expect(page.locator("body")).toContainText("Packaging Stock")
  await expect(page.locator("body")).toContainText("Packaging Movement Mix")

  await page.getByRole("tab", { name: /GRN History/i }).click()
  await expect(page).toHaveURL(/tab=grn/)
  await expect(page.locator("body")).toContainText("GRN History")
  await expect(page.locator("body")).toContainText("Correction Policy")

  await page.goto("/inventory/bulk", { waitUntil: "domcontentloaded" })
  await expect(page).toHaveURL(/\/inventory\?tab=bulk/)
  await page.goto("/inventory/packaging", { waitUntil: "domcontentloaded" })
  await expect(page).toHaveURL(/\/inventory\?tab=packaging/)
  await page.goto("/inventory/roll-explorer", { waitUntil: "domcontentloaded" })
  await expect(page).toHaveURL(/\/inventory\?tab=rolls/)
})

test("inventory workspace filters are URL driven and applied across stock and GRN tabs", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Inventory",
    severity: "high",
    role: "STORE",
    feature: "Inventory workspace filters",
    expected: "Every visible inventory filter updates URL state and keeps Pulse, Browse, and GRN history usable without placeholder controls.",
  })

  await switchRole(page, "Store", "/inventory", { allowCookieFallback: true })
  await page.goto("/inventory", { waitUntil: "domcontentloaded" })
  await assertHealthyPage(page, { requireAuth: true })

  await chooseFilter(page, "inventory-filter-status", "Available")
  await expect(page).toHaveURL(/status=AVAILABLE/)
  await chooseFilter(page, "inventory-filter-weight", "0-100 kg")
  await expect(page).toHaveURL(/weight=0-100/)
  await chooseFilter(page, "inventory-filter-print", "Printed")
  await expect(page).toHaveURL(/print=PRINTED/)
  await page.getByRole("tab", { name: /Browse/i }).click()
  await expect(page).toHaveURL(/view=browse/)
  await expect(page.locator("body")).toContainText(/No rows match|Visible rows|Item/)

  await page.getByRole("tab", { name: /Pulse/i }).click()
  await expect(page.locator("body")).toContainText("Size / Variant Matrix")
  const rollHeatmapCell = page.getByTestId("inventory-size-heatmap-cell-rolls").first()
  if (await rollHeatmapCell.count()) {
    await rollHeatmapCell.click()
    await expect(page).toHaveURL(/view=browse/)
  }

  await page.getByRole("tab", { name: /Bulk Inventory/i }).click()
  await chooseFilter(page, "inventory-filter-availability", "Available")
  await expect(page).toHaveURL(/availability=AVAILABLE/)
  await chooseFilter(page, "inventory-filter-value", "0-10k")
  await expect(page).toHaveURL(/value=0-10000/)
  await page.getByRole("tab", { name: /Browse/i }).click()
  await expect(page.locator("body")).toContainText(/No rows match|Item|Stock Nodes/)

  await page.getByRole("tab", { name: /Packaging Stock/i }).click()
  await chooseFilter(page, "inventory-filter-transaction", "Inward")
  await expect(page).toHaveURL(/transaction_type=INWARD/)
  await chooseFilter(page, "inventory-filter-stock-range", "1-500")
  await expect(page).toHaveURL(/stock_range=1-500/)
  await page.getByRole("tab", { name: /Browse/i }).click()
  await expect(page.locator("body")).toContainText(/No rows match|Item|Stock Nodes/)

  await page.getByRole("tab", { name: /GRN History/i }).click()
  await chooseFilter(page, "inventory-filter-source", "Bulk GRN")
  await expect(page).toHaveURL(/source_type=BULK/)
  await page.getByTestId("inventory-filter-vendor").fill("V")
  await expect(page).toHaveURL(/vendor=V/)
  await page.getByTestId("inventory-filter-reference").fill("GRN")
  await expect(page).toHaveURL(/reference=GRN/)
  await page.getByTestId("inventory-filter-date-from").fill("2026-01-01")
  await expect(page).toHaveURL(/date_from=2026-01-01/)
  await expect(page.locator("body")).toContainText("Correction Policy")
})
