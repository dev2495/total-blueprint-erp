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
  customer_name?: string
}

test("sales Product Master proof flows from create to production handoff", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Sales",
    severity: "critical",
    role: "SALES",
    feature: "Product Master sales proof",
    expected:
      "A final-model Product Master order should be orderable from Sales Create, visible in the sales queue, and handed off to production without relying on removed SKU catalog pages.",
  })

  const seed = readRuntimeJson<SalesSeed>("sales-seed.json") || {}
  const runTag = `${Date.now()}`
  const orderName = `Product Master Sales ${runTag}`

  await switchRole(page, "Sales", "/sales/orders", { allowCookieFallback: true })
  await page.goto("/sales/orders/create")
  await assertHealthyPage(page)
  await page.getByTestId("sales-order-v34-workspace").waitFor({ state: "visible", timeout: 30_000 })
  await selectByTestId(page, "sales-batch-customer", new RegExp(seed.customer_name || "UAT-GREEN Sales Customer", "i"))
  await page.getByPlaceholder(/ABC May order/i).fill(orderName)

  const quickStartCard = page.locator("[data-testid^='sales-quick-start-card-']").first()
  if (await quickStartCard.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await quickStartCard.click()
  } else {
    await page.getByRole("button", { name: /^Add line$/i }).first().click()
    await page.getByPlaceholder(/Search product master code or name/i).fill("")
    await page.locator("[data-testid^='sales-master-option-']").first().click()
  }
  const firstSize = page.locator("[data-testid^='sales-size-option-']").first()
  if (await firstSize.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await firstSize.click()
  }
  await page.getByLabel(/Unit price/i).first().fill("12.75")
  await expect(page.getByTestId("sales-create-submit")).toBeEnabled({ timeout: 30_000 })

  const createResponse = page.waitForResponse((response) => response.url().includes("/api/sales/orders/") && response.request().method() === "POST")
  await page.getByTestId("sales-create-submit").click()
  const createdResponse = await createResponse
  expect([200, 201]).toContain(createdResponse.status())
  const createdPayload = await createdResponse.json()
  expect(String(createdPayload.order_number || "")).toMatch(/^SO(?:-\d{4})?-\d+$/)

  const orders = unwrapApiList<any>((await fetchJson(page, "/api/sales/orders/")).data)
  const createdOrder = orders.find((row) => String(row.order_name || "") === orderName)
  expect(createdOrder).toBeTruthy()
  expect(["PLANNING_REQUIRED", "PLANNED", "RELEASED", "PACKING_READY", "DISPATCH_READY", "COMPLETED"]).toContain(String(createdOrder.status || ""))

  await page.goto("/sales/orders")
  await assertHealthyPage(page)
  await expect(page.locator("body")).toContainText(createdOrder.order_number)
  await expect(page.locator("body")).toContainText(orderName)
  await expect(page.locator("body")).toContainText("Remaining")

  await page.goto(`/sales/orders/${createdOrder.id}/tracking`)
  await assertHealthyPage(page)
  await expect(page.locator("body")).toContainText(createdOrder.order_number)
  await expect(page.locator("body")).toContainText(/fulfillment truth/i)
  await expect(page.getByRole("tab", { name: /jobs/i })).toBeVisible()
  await expect(page.locator("body")).toContainText(/work center|no active jobs/i)

  const plannerPayload = await fetchJson<any>(page, "/api/production/planner/control-hub/")
  expect(plannerPayload.status).toBe(200)
  expect(JSON.stringify(plannerPayload.data)).toContain(createdOrder.order_number)

  writeRuntimeJson("sales-courier-pod-proof.json", {
    run_tag: runTag,
    source: "product-master",
    sales_order_id: createdOrder.id,
    sales_order_number: createdOrder.order_number,
  })
})
