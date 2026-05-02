import { expect, test } from "../support/base"
import {
  annotate,
  assertHealthyPage,
  fetchJson,
  readRuntimeJson,
  selectByTestId,
  switchRole,
  unwrapApiList,
  writeRuntimeJson,
} from "../support/test-helpers"

type SalesSeed = {
  run_tag?: string
  customer_id?: string
  customer_name?: string
  pouch_template_name?: string
  shared_sku_code?: string
  shared_variant_name?: string
  repeat_line_name?: string
}

test("sales can create a SKU header and submit queued singles as separate sales orders", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Sales",
    severity: "critical",
    role: "SALES",
    feature: "SKU Catalog and batch singles",
    expected:
      "Sales should be able to create a new shared SKU header and submit queued fast-entry cards as distinct sales orders, not one clubbed order.",
  })

  const seed = readRuntimeJson<SalesSeed>("sales-seed.json") || {}
  const runTag = String(seed.run_tag || process.env.UI_E2E_RUN_TAG || Date.now())
  const newSkuCode = `UAT-GREEN-NEW-${runTag}`
  const sharedOrderName = `UAT-GREEN Shared SKU ${runTag}`
  const repeatOrderName = `UAT-GREEN Repeat ${runTag}`

  await switchRole(page, "Sales", "/sales/orders", { allowCookieFallback: true })

  await page.goto("/sales/sku-catalog")
  await assertHealthyPage(page)
  await page.getByTestId("sales-sku-catalog-page").waitFor({ state: "visible", timeout: 30_000 })
  await page.getByTestId("sales-sku-create").click()
  await page.getByTestId("sales-sku-dialog").waitFor({ state: "visible", timeout: 30_000 })
  await page.getByTestId("sales-sku-dialog-code").fill(newSkuCode)
  await page.getByTestId("sales-sku-dialog-name").fill(`UAT-GREEN New SKU ${runTag}`)
  await selectByTestId(page, "sales-sku-dialog-template", new RegExp(seed.pouch_template_name || "UAT-GREEN Sales Pouch Template", "i"))
  await page.getByTestId("sales-sku-dialog-save").click()
  await expect(page.locator("body")).toContainText(newSkuCode, { timeout: 30_000 })

  await page.goto("/sales/orders/create")
  await assertHealthyPage(page)
  await page.getByTestId("sales-order-batch-workspace").waitFor({ state: "visible", timeout: 30_000 })
  await selectByTestId(page, "sales-batch-customer", new RegExp(seed.customer_name || "UI E2E Sales Customer", "i"))

  const beforeOrders = unwrapApiList<any>((await fetchJson(page, "/api/sales/orders/")).data)

  await selectByTestId(page, "sales-batch-shared-sku", new RegExp(seed.shared_sku_code || "UAT-GREEN-MANGO", "i"))
  await selectByTestId(page, "sales-batch-shared-variant", new RegExp(seed.shared_variant_name || "UAT-GREEN Mango Pouch 200 x 300", "i"))
  await page.getByTestId("sales-batch-shared-add").click()

  await page.getByTestId("sales-batch-lane-repeat").click()
  await page.getByTestId("sales-repeat-dialog").waitFor({ state: "visible", timeout: 30_000 })
  await page.getByPlaceholder("Search order no, line name, template, or SKU variant").fill(seed.repeat_line_name || "UAT-GREEN Repeat Pouch")
  await expect(page.locator("body")).toContainText(seed.repeat_line_name || "UAT-GREEN Repeat Pouch")
  await page.getByTestId("sales-repeat-edit-commercial").first().click()

  await page.getByTestId("sales-batch-order-name").fill(repeatOrderName)
  await page.getByTestId("sales-batch-unit-price").fill("8.75")
  await page.getByTestId("sales-batch-queue-card").nth(1).click()
  await page.getByTestId("sales-batch-order-name").fill(sharedOrderName)
  await page.getByTestId("sales-batch-unit-price").fill("9.25")

  await expect(page.getByTestId("sales-batch-queue-count")).toHaveText("2")
  await page.getByTestId("sales-batch-submit").click()

  await expect(page.getByTestId("sales-submit-success")).toContainText(/entry screen is ready/i, { timeout: 30_000 })
  await expect(page.getByTestId("sales-batch-queue-count")).toHaveText("0")
  await expect(page.getByTestId("sales-batch-empty-state")).toBeVisible({ timeout: 30_000 })

  const afterOrders = unwrapApiList<any>((await fetchJson(page, "/api/sales/orders/")).data)
  expect(afterOrders.length).toBe(beforeOrders.length + 2)

  const newOrderNumbers = afterOrders
    .map((row) => String(row.order_number || ""))
    .filter((orderNumber) => !beforeOrders.some((row) => String(row.order_number || "") === orderNumber))

  expect(newOrderNumbers).toHaveLength(2)
  expect(new Set(newOrderNumbers).size).toBe(2)

  writeRuntimeJson("sales-batch-results.json", {
    run_tag: runTag,
    created_order_numbers: newOrderNumbers,
    created_orders: afterOrders
      .filter((row) => newOrderNumbers.includes(String(row.order_number || "")))
      .map((row) => ({
        id: String(row.id || ""),
        order_number: String(row.order_number || ""),
        order_name: String(row.order_name || ""),
        customer_name: String(row.customer_name || ""),
      })),
  })
})
