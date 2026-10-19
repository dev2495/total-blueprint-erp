import { expect, test } from "../support/base"
import { annotate, assertHealthyPage, switchRole } from "../support/test-helpers"

test("sales create page and Product Master expose the new product-master lanes", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Sales",
    severity: "critical",
    role: "SALES",
    feature: "Sales create and Product Master",
    expected:
      "Sales users should be able to reach the new sales create surface and inspect Product Master usage without dead routes or missing controls.",
  })

  await switchRole(page, "Sales", "/sales/orders", { allowCookieFallback: true })

  await page.goto("/sales/orders/create")
  await assertHealthyPage(page)
  await expect(page.locator("body")).toContainText(/Sales\s*.\s*New order/i)
  await expect(page.locator("body")).toContainText(/Bill to\s*.\s*customer/i)
  await expect(page.locator("body")).toContainText(/Ship to/i)
  await expect(page.locator("body")).toContainText(/No lines yet/i)
  await expect(page.getByTestId("sales-create-submit")).toBeVisible()
  await expect(page.getByRole("button", { name: /Place order/i })).toBeVisible()

  await page.goto("/master/products")
  await assertHealthyPage(page)
  await expect(page.locator("body")).toContainText(/Product Master|Products/i)
  await expect(page.locator("body")).toContainText(/Pouch|Roll|Master/i)

  await page.goto("/sales/orders")
  await assertHealthyPage(page)
  await expect(page.locator("body")).toContainText("Sales Orders")
  await expect(page.getByRole("link", { name: /New order/i })).toBeVisible()
  await expect(page.getByRole("link", { name: /Product Master/i }).first()).toBeVisible()
})
