import { expect, test } from "../support/base"
import {
  annotate,
  assertHealthyPage,
  fetchJson,
  readRuntimeJson,
  selectByTestId,
  switchRole,
  writeRuntimeJson,
} from "../support/test-helpers"

type SalesSeed = {
  run_tag?: string
  customer_name?: string
  product_master_code?: string
}

test("sales can create a Product Master order and send it straight to planner", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Sales",
    severity: "critical",
    role: "SALES",
    feature: "Product Master order creation",
    expected:
      "Sales should create final-model Product Master orders from Quick Start or manual PM selection and submit them directly to the planner queue without the removed SKU catalog path.",
  })

  const seed = readRuntimeJson<SalesSeed>("sales-seed.json") || {}
  const runTag = String(seed.run_tag || process.env.UI_E2E_RUN_TAG || Date.now())
  const orderName = `UAT-GREEN Product Master Order ${runTag}`

  await switchRole(page, "Sales", "/sales/orders", { allowCookieFallback: true })
  await page.goto("/sales/orders/create")
  await page.getByTestId("sales-order-v34-workspace").waitFor({ state: "visible", timeout: 30_000 })
  await assertHealthyPage(page)
  await selectByTestId(page, "sales-batch-customer", new RegExp(seed.customer_name || "UAT-GREEN Sales Customer", "i"))
  await page.getByPlaceholder(/ABC May order/i).fill(orderName)

  await page.getByRole("button", { name: /^Add line$/i }).first().click()
  const productMasterCode = seed.product_master_code || "PM-UAT-GREEN-DRYFRUIT"
  await page.getByPlaceholder(/Search product master code or name/i).fill(productMasterCode)
  await page.getByTestId(`sales-master-option-${productMasterCode}`).click()

  const sizeSelect = page.getByLabel(/^Size$/i).first()
  await expect(sizeSelect).toBeVisible({ timeout: 10_000 })
  if (!(await sizeSelect.inputValue())) {
    await sizeSelect.selectOption({ index: 1 })
  }

  const unitPrice = page.getByLabel(/Unit price/i).first()
  if (!(await unitPrice.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: /Edit|Expand line 1/i }).first().click()
  }
  await page.getByLabel(/Unit price/i).first().fill("9.25")
  await expect(page.getByTestId("sales-create-submit")).toBeEnabled({ timeout: 30_000 })

  const createResponse = page.waitForResponse((response) => response.url().includes("/api/sales/orders/") && response.request().method() === "POST")
  await page.getByTestId("sales-create-submit").click()
  const createdResponse = await createResponse
  expect([200, 201]).toContain(createdResponse.status())
  const createdPayload = await createdResponse.json()
  expect(String(createdPayload.order_number || "")).toMatch(/^SO(?:-\d{4})?-\d+$/)

  const createdDetail = await fetchJson<any>(page, `/api/sales/orders/${createdPayload.id}/`)
  expect(createdDetail.status).toBe(200)
  const created = createdDetail.data
  expect(created).toBeTruthy()
  expect(String(created.order_number || "")).toBe(String(createdPayload.order_number || ""))
  expect(String(created.order_name || "")).toBe(orderName)

  writeRuntimeJson("sales-product-master-results.json", {
    run_tag: runTag,
    created_order_number: String(createdPayload.order_number || ""),
    created_order_id: String(createdPayload.id || created?.id || ""),
    order_name: orderName,
  })
})
