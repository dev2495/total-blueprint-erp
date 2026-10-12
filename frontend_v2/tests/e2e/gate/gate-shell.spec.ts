import { expect, test } from "../support/base"
import { annotate, assertNoHorizontalOverflow, gotoWithServerRetry } from "../support/test-helpers"

// The gate app has its own shell (dark top bar, bottom tab bar on phones) and no
// dashboard sidebar or role switcher, so it is checked here instead of in the
// generic protected-route sweeps.
const GATE_ROUTES = ["/gate", "/gate/outward", "/gate/visitors", "/gate/register", "/gate/history", "/gate/inward-bills", "/gate/qr"]

const viewports = [
  { name: "desktop", width: 1366, height: 768 },
  { name: "mobile", width: 390, height: 844 },
] as const

for (const viewport of viewports) {
  test(`gate app shell renders every gate route (${viewport.name})`, async ({ page }, testInfo) => {
    test.setTimeout(GATE_ROUTES.length * 30_000)
    annotate(testInfo, {
      module: "Gate",
      severity: "high",
      feature: `gate-shell-${viewport.name}`,
      expected: "Each gate route should render the gate shell for a signed-in account, with no horizontal overflow and no guest state.",
    })
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    for (const route of GATE_ROUTES) {
      await gotoWithServerRetry(page, route, { waitUntil: "domcontentloaded", timeout: 60_000 })
      await expect(page.getByRole("link", { name: /Gate home/i })).toBeVisible({ timeout: 30_000 })
      await expect(page.locator("body")).not.toContainText(/\bguest\b/i)
      await expect(page.locator("body")).not.toContainText(/Application error|Something went wrong/i)
      await assertNoHorizontalOverflow(page)
    }
  })
}

test("public visitor page loads without a sign-in", async ({ browser }, testInfo) => {
  annotate(testInfo, {
    module: "Gate",
    severity: "medium",
    feature: "visitor-public-page",
    expected: "The visitor self-registration page should render for a signed-out visitor without errors.",
  })
  const context = await browser.newContext({ storageState: undefined })
  const page = await context.newPage()
  try {
    await page.goto("/visit", { waitUntil: "domcontentloaded" })
    await expect(page.locator("body")).not.toContainText(/Application error|Something went wrong/i)
    await assertNoHorizontalOverflow(page)
  } finally {
    await context.close()
  }
})
