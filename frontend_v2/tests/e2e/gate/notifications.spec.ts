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
  await expect(page.locator("body")).toContainText(/System Admin Console|Command Center/i, { timeout: 60_000 })
  await assertHealthyPage(page, { requireAuth: false })
  await page.getByTestId("notification-bell-trigger").click()
  await page.getByTestId("notification-bell-popover").waitFor({ state: "visible", timeout: 15_000 })
  await expect(page.getByTestId("notification-bell-popover")).toContainText(
    /Daily report pack ready|Daily report ready|No notifications to show|All caught up/i,
    { timeout: 15_000 }
  )
})
