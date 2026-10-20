import { expect, test } from "../support/base"
import { annotate, assertHealthyPage, switchRole } from "../support/test-helpers"

test("sales creates orders without seeing product masters", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Sales",
    severity: "critical",
    role: "SALES",
    feature: "Sales create; masters are admin/owner screens",
    expected:
      "Sales users reach the order composer and the orders list; product masters, routes and processes are not part of their role and do not open.",
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

  // Product masters are kept by admin/owner (or a master-data grant); Sales is told plainly.
  await page.goto("/master/products")
  await expect(page.getByTestId("page-no-access")).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId("page-no-access")).toContainText("This page is not part of your role")

  await page.goto("/sales/orders")
  await assertHealthyPage(page)
  await expect(page.locator("body")).toContainText("Sales Orders")
  // "New order" is both a workspace tab and the page's own button; check the page button.
  await expect(page.getByTestId("sales-orders-list-page").getByRole("link", { name: /New order/i })).toBeVisible()
  await expect(page.getByTestId("sales-orders-list-page").getByRole("link", { name: /^Product master$/i })).toHaveCount(0)
})
