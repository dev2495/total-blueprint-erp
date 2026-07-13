import { test, expect } from "../support/base"
import { annotate, assertHealthyPage, fetchJson, loginViaUi, readRuntimeJson, selectByTestId, switchRole } from "../support/test-helpers"

type SalesSeed = {
  customer_id?: string
  customer_name?: string
  repeat_line_name?: string
}

test("sales repeat order lane surfaces inherited values and clear next actions before staging", async ({ page }, testInfo) => {
  test.slow()
  annotate(testInfo, {
    module: "Sales",
    severity: "high",
    role: "SALES",
    feature: "Repeat order review",
    expected: "Repeat-order candidates should show inherited commercial and technical facts before the user stages the next single order.",
  })

  const seed = readRuntimeJson<SalesSeed>("sales-seed.json") || {}

  await loginViaUi(page)
  await switchRole(page, "Sales", "/sales/orders", { allowCookieFallback: true })
  await page.goto("/sales/orders/create")
  await assertHealthyPage(page)
  await page.getByTestId("sales-order-v34-workspace").waitFor({ state: "visible", timeout: 30_000 })

  await selectByTestId(page, "sales-batch-customer", new RegExp(seed.customer_name || "UI E2E Sales Customer", "i"))
  if (seed.customer_id) {
    const repeatResponse = await fetchJson<any[]>(page, `/api/sales/orders/repeat-lines/?customer_id=${seed.customer_id}`)
    expect(repeatResponse.status).toBe(200)
    expect(Array.isArray(repeatResponse.data)).toBeTruthy()
    expect(
      repeatResponse.data.some((candidate) => String(candidate?.line_name || "").includes(seed.repeat_line_name || "UI E2E Repeat Pouch")),
    ).toBeTruthy()
  }
  const quickStart = page.getByTestId("sales-quick-start-band")
  if (!(await quickStart.isVisible().catch(() => false))) {
    await page.getByTestId("sales-quick-start-toggle").click()
  }
  await quickStart.waitFor({ state: "visible", timeout: 30_000 })
  await expect(quickStart).toContainText(/Quick Start/i)
  if (await page.locator("[data-testid^='sales-quick-start-card-']").first().isVisible().catch(() => false)) {
    await expect(quickStart).toContainText(/Last order|Customer default/i)
    const firstQuickStartCard = page.locator("[data-testid^='sales-quick-start-card-']").first()
    await expect(firstQuickStartCard).toContainText(/\+ Add to cart/i)
    await firstQuickStartCard.click()
    await expect(page.locator("body")).toContainText(/cart/i)
    await expect(page.locator("body")).not.toContainText(/cart empty/i)
    return
  }

  await expect(page.getByTestId("sales-quick-start-empty")).toContainText(/no overlays or recent activity/i)
})
