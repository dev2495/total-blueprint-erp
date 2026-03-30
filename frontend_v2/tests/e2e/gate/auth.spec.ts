import { test, expect } from "../support/base"
import { annotate, assertAuthenticatedShell, loginViaUi, logoutViaUi } from "../support/test-helpers"

test.describe("Auth UI", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("admin login and logout roundtrip", async ({ page }, testInfo) => {
    annotate(testInfo, {
      module: "Auth",
      severity: "critical",
      expected: "Admin can sign in, reach the dashboard shell, and log out back to /login.",
    })

    await loginViaUi(page)
    await assertAuthenticatedShell(page, { requireRoleSwitcher: true })
    await logoutViaUi(page)
    await expect(page.getByTestId("login-form")).toBeVisible()
    await expect(page.getByTestId("login-form")).toHaveAttribute("data-client-ready", "true")
  })
})
