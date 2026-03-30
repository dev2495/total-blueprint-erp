import { test, expect } from "../support/base"
import { annotate, assertHealthyPage } from "../support/test-helpers"

test("seeded notifications are visible in the shell inbox without crashing the page", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Notifications",
    severity: "high",
    role: "ADMIN",
    feature: "Seeded inbox visibility",
    expected: "The shell should show seeded unread notifications and the bell should open without runtime errors.",
  })

  await page.goto("/dashboard/admin")
  await assertHealthyPage(page)
  await page.getByTestId("notification-bell-trigger").click()
  await page.getByTestId("notification-bell-popover").waitFor({ state: "visible", timeout: 15_000 })
  await expect(page.locator("[data-testid^='notification-item-']").first()).toBeVisible()
  await expect(page.locator("body")).toContainText(/Daily reports generated without email|Report generated without email/)
})
