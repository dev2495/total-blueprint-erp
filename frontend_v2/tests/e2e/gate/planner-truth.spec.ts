import { test, expect } from "../support/base"
import { annotate, assertHealthyPage } from "../support/test-helpers"

test("planner shows sales-first facts and truthful source labels", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Planner",
    severity: "high",
    role: "ADMIN",
    feature: "Planner source semantics",
    expected: "Planner should show sales-first facts, not a fake partial shortfall, and should not call upstream stock WIP.",
  })

  await page.goto("/production/planner")
  await assertHealthyPage(page)
  await expect(page.locator("body")).not.toContainText("Continue from compatible WIP before scheduling fresh conversion.")

  const queueRows = page.locator("[data-testid^='planner-queue-row-']")
  if (await queueRows.count()) {
    await queueRows.first().click()
    await expect(page.locator("body")).toContainText("Source path")
    await expect(page.locator("body")).toContainText("Layers")
    await expect(page.locator("body")).toContainText("Geometry")
    await expect(page.locator("body")).toContainText("Route span")
  }
})
