import { test, expect } from "../support/base"
import { annotate, assertHealthyPage, switchRole } from "../support/test-helpers"
import { readMutationSeed } from "../support/mutation-seed"

test("planner, WCM, and operator screens expose simple guided next-step copy", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Shop Floor UX",
    severity: "high",
    role: "ADMIN",
    feature: "Plain-language guidance",
    expected: "Planner, WCM, and operator screens should explain the next action clearly without hiding primary workflow decisions.",
  })

  const seed = readMutationSeed()

  await page.goto("/dashboard/admin")
  await page.goto("/production/planner")
  await assertHealthyPage(page)
  await expect(page.getByRole("tab", { name: /completed orders/i })).toBeVisible()
  await expect(page.locator("body")).toContainText("Material policy handoff")
  await expect(page.locator("body")).toContainText("Planner checks the material plan here")

  await switchRole(page, "Work Center Manager", "/production/work-center")
  await page.goto(`/production/work-center/${seed.wcm.work_center_id}`)
  await page.getByTestId("wcm-terminal-page").waitFor({ state: "visible", timeout: 30_000 })
  await assertHealthyPage(page)
  await expect(page.locator("body")).toContainText("1. Pick the job from the left queue.")
  await expect(page.locator("body")).toContainText("2. Check step requirements and material rule.")

  await switchRole(page, "Operator", "/production/machine-selector")
  await page.goto(`/production/machine/${seed.operator.machine_id}`)
  await page.getByTestId("machine-execution-page").waitFor({ state: "visible", timeout: 30_000 })
  await assertHealthyPage(page)
  await expect(page.locator("body")).toContainText("Next action now")
  await expect(page.getByTestId("machine-start-step")).toContainText("Start Job")
  await expect(page.getByTestId("machine-stop-step")).toContainText("Pause Job")
  await expect(page.getByTestId("machine-finalize-step")).toContainText("Finalize Step")
})
