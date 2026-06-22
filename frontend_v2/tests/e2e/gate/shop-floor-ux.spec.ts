import { test, expect } from "../support/base"
import { annotate, assertHealthyPage, gotoWithServerRetry, switchRole } from "../support/test-helpers"
import { readMutationSeed } from "../support/mutation-seed"

test("planner, WCM, and operator screens expose simple guided next-step copy", async ({ page }, testInfo) => {
  test.setTimeout(180_000)

  annotate(testInfo, {
    module: "Shop Floor UX",
    severity: "high",
    role: "ADMIN",
    feature: "Plain-language guidance",
    expected: "Planner, WCM, and operator screens should explain the next action clearly without hiding primary workflow decisions.",
  })

  const seed = readMutationSeed()

  await gotoWithServerRetry(page, "/dashboard/admin", { waitUntil: "domcontentloaded" })
  await gotoWithServerRetry(page, "/dashboard/planner/control-tower/command", { waitUntil: "domcontentloaded" })
  await assertHealthyPage(page)
  await expect(page.getByRole("heading", { name: /command/i })).toBeVisible()
  await expect(page.locator("body")).toContainText("Open Plan Queue")
  await expect(page.locator("body")).toContainText("Planning queue")
  await expect(page.locator("body")).toContainText("Source mix")

  await gotoWithServerRetry(page, "/dashboard/planner/control-tower/plan-queue", { waitUntil: "domcontentloaded" })
  await assertHealthyPage(page)
  await expect(page.getByRole("heading", { name: /plan queue/i })).toBeVisible()
  await expect(page.getByPlaceholder(/search order/i)).toBeVisible()
  await expect(page.locator("body")).toContainText("Queue")
  await expect(page.locator("body")).toContainText(/Source path|Source · Release/i)

  await switchRole(page, "Work Center Manager", "/production/work-center")
  await gotoWithServerRetry(page, `/production/work-center/${seed.wcm.work_center_id}`, { waitUntil: "domcontentloaded" })
  await page.getByTestId("wcm-terminal-page").waitFor({ state: "visible", timeout: 60_000 })
  await assertHealthyPage(page)
  await expect(page.locator("body")).toContainText("Work Center Terminal")
  await expect(page.locator("body")).toContainText("Current order")
  await expect(page.locator("body")).toContainText("Machine assignment")
  await expect(page.locator("body")).toContainText("Current-step materials")
  await expect(page.locator("body")).toContainText("Current-step issue")

  await switchRole(page, "Operator", "/production/machine-selector")
  await gotoWithServerRetry(page, `/production/machine/${seed.operator.machine_id}`, { waitUntil: "domcontentloaded" })
  await page.getByTestId("machine-execution-page").waitFor({ state: "visible", timeout: 30_000 })
  await assertHealthyPage(page)
  await expect(page.locator("body")).toContainText("Kiosk focus for operators")
  await expect(page.locator("body")).toContainText("Select job")
  await expect(page.locator("body")).toContainText(/Start \/ resume|Log output|Idle machine/)
  const startButton = page.getByTestId("machine-start-step")
  const logOutputButton = page.getByTestId("machine-log-output")
  if (await startButton.isVisible().catch(() => false)) {
    await expect(startButton).toContainText(/Start|Resume job/)
  } else if (await logOutputButton.isVisible().catch(() => false)) {
    await expect(logOutputButton).toContainText("Log output")
  } else {
    await expect(page.locator("body")).toContainText("No released jobs are waiting here.")
  }
})
