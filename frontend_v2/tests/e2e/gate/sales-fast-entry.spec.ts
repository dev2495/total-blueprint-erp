import { expect, test } from "../support/base"
import { annotate, assertHealthyPage, loginViaUi, readRuntimeJson, selectByTestId, switchRole } from "../support/test-helpers"

type SalesSeed = {
  customer_name?: string
  shared_sku_code?: string
  shared_variant_name?: string
  repeat_line_name?: string
}

test("sales batch queue and SKU Catalog expose the new fast-entry lanes", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Sales",
    severity: "critical",
    role: "SALES",
    feature: "Batch queue and SKU Catalog",
    expected:
      "Sales users should be able to reach the new batch queue, stage shared-SKU and repeat orders, and inspect SKU Catalog usage without dead routes or missing controls.",
  })

  const seed = readRuntimeJson<SalesSeed>("sales-seed.json") || {}

  await loginViaUi(page)
  await switchRole(page, "Sales", "/sales/orders", { allowCookieFallback: true })

  await page.goto("/sales/orders/create")
  await assertHealthyPage(page)
  await page.getByTestId("sales-order-batch-workspace").waitFor({ state: "visible", timeout: 30_000 })

  await selectByTestId(page, "sales-batch-customer", new RegExp(seed.customer_name || "UI E2E Sales Customer", "i"))
  await expect(page.getByTestId("sales-batch-lane-repeat")).toBeEnabled()
  await expect(page.getByTestId("sales-batch-lane-custom")).toBeEnabled()

  await selectByTestId(page, "sales-batch-shared-sku", new RegExp(seed.shared_sku_code || "UIE2E-POUCH", "i"))
  await selectByTestId(page, "sales-batch-shared-variant", new RegExp(seed.shared_variant_name || "Mango Pouch 200 x 300", "i"))
  await page.getByTestId("sales-batch-shared-add").click()
  await expect(page.getByTestId("sales-batch-queue-count")).toHaveText("1")

  await page.getByTestId("sales-batch-lane-repeat").click()
  await page.getByTestId("sales-repeat-dialog").waitFor({ state: "visible", timeout: 30_000 })
  await page.getByPlaceholder("Search order no, line name, template, or SKU variant").fill(seed.repeat_line_name || "UI E2E Repeat Pouch")
  await expect(page.locator("body")).toContainText(seed.repeat_line_name || "UI E2E Repeat Pouch")
  await page.getByTestId("sales-repeat-edit-commercial").first().click()
  await expect(page.getByTestId("sales-batch-queue-count")).toHaveText("2")

  await page.getByTestId("sales-batch-lane-custom").click()
  await expect(page.getByTestId("sales-batch-queue-count")).toHaveText("3")
  await expect(page.locator("body")).toContainText("Line Composer")
  await expect(page.locator("body")).toContainText("Technical Truth")
  await expect(page.locator("body")).toContainText(/TPL/i)
  await expect(page.locator("body")).toContainText(/kg/i)
  await expect(page.locator("body")).toContainText(/pcs/i)

  await page.goto("/sales/sku-catalog")
  await assertHealthyPage(page)
  await page.getByTestId("sales-sku-catalog-page").waitFor({ state: "visible", timeout: 30_000 })
  await page.getByTestId("sales-sku-search").fill(seed.shared_sku_code || "UIE2E-POUCH")
  await expect(page.locator("body")).toContainText(seed.shared_sku_code || "UIE2E-POUCH")
  await page.getByTestId("sales-sku-variant-item").first().click()
  await page.getByTestId("sales-sku-usage-history").click()
  await expect(page.getByText(/Variant Usage History/i)).toBeVisible()

  await page.goto("/sales/orders")
  await assertHealthyPage(page)
  await expect(page.getByRole("button", { name: /active orders/i })).toBeVisible()
  await expect(page.getByRole("button", { name: /completed orders/i })).toBeVisible()
})
