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

  await page.goto("/dashboard/planner/control-tower/plan-queue")
  await assertHealthyPage(page)
  await expect(page.locator("body")).not.toContainText("Continue from compatible WIP before scheduling fresh conversion.")

  const queueRows = page.locator("[data-testid^='planner-queue-row-']")
  if (await queueRows.count()) {
    await queueRows.first().click()
    // The queue passport shows the sourcing decision (FG / WIP / stock), the production route and the release checklist.
    await expect(page.locator("body")).toContainText(/Sourcing/i)
    await expect(page.locator("body")).toContainText(/Production route/i)
    await expect(page.locator("body")).toContainText(/Release checklist/i)
    await expect(page.locator("body")).toContainText("Route span")
  }
})
