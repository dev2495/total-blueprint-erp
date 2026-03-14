import { test, expect } from "../support/base"
import { annotate, ROLE_OPTIONS, switchRole } from "../support/test-helpers"

test("role shell surfaces remain visually mounted after role switches", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Observations",
    severity: "low",
    feature: "Shell consistency",
    expected: "Role switching should preserve the common shell elements without visual teardown.",
  })

  await page.goto("/dashboard/admin")
  for (const role of ROLE_OPTIONS.slice(0, 4)) {
    await switchRole(page, role.name, role.landing)
    await expect(page.getByTestId("sidebar-nav")).toBeVisible()
    await expect(page.getByTestId("command-palette-trigger")).toBeVisible()
  }
})
