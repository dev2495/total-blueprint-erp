import { expect } from "@playwright/test"
import { test } from "../support/base"
import { annotate, assertHealthyPage, switchRole } from "../support/test-helpers"

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
