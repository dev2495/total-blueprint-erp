import { test, expect } from "../support/base"
import { annotate, loginViaUi, logoutViaUi } from "../support/test-helpers"

test.describe("Auth UI", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("admin login and logout roundtrip", async ({ page }, testInfo) => {
    annotate(testInfo, {
      module: "Auth",
      severity: "critical",
      expected: "Admin can sign in, reach the dashboard shell, and log out back to /login.",
    })

    await loginViaUi(page)
    await expect(page.getByTestId("sidebar-nav")).toBeVisible()
    await logoutViaUi(page)
    await expect(page.getByTestId("login-form")).toBeVisible()
  })
})
