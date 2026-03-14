import { test, expect } from "../support/base"
import { annotate, assertHealthyPage, loginViaUi, selectByTestId, switchRole } from "../support/test-helpers"

test("sales repeat order surfaces inherited values and review guidance before submit", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Sales",
    severity: "high",
    role: "SALES",
    feature: "Repeat order review",
    expected: "Repeat orders should surface inherited fields and review guidance before the order is placed.",
  })

  await loginViaUi(page)
  await switchRole(page, "Sales", "/sales/orders")
  await page.goto("/sales/orders/create")
  await assertHealthyPage(page)

  await selectByTestId(page, "sales-order-mode", /Repeat \(Previous Job\)/i)
  await page.getByTestId("sales-order-repeat-source").click()
  await page.getByRole("option").first().click()

  const review = page.getByTestId("sales-order-repeat-review")
  await review.waitFor({ state: "visible", timeout: 30_000 })
  await expect(review).toContainText(/Previous order details are copied into this draft/i)
  await expect(review).toContainText(/Inherited into this draft/i)
  await expect(review).toContainText(/Review before placing/i)
})
