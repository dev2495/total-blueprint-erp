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
  await switchRole(page, "Sales", "/sales/orders")
  await page.goto("/sales/orders/create")
  await assertHealthyPage(page)
  await page.getByTestId("sales-order-batch-workspace").waitFor({ state: "visible", timeout: 30_000 })

  await selectByTestId(page, "sales-batch-customer", new RegExp(seed.customer_name || "UI E2E Sales Customer", "i"))
  if (seed.customer_id) {
    const repeatResponse = await fetchJson<any[]>(page, `/api/sales/orders/repeat-lines/?customer_id=${seed.customer_id}`)
    expect(repeatResponse.status).toBe(200)
    expect(Array.isArray(repeatResponse.data)).toBeTruthy()
    expect(
      repeatResponse.data.some((candidate) => String(candidate?.line_name || "").includes(seed.repeat_line_name || "UI E2E Repeat Pouch")),
    ).toBeTruthy()
  }
  await page.getByTestId("sales-batch-lane-repeat").click()

  const repeatDialog = page.getByTestId("sales-repeat-dialog")
  await repeatDialog.waitFor({ state: "visible", timeout: 30_000 })
  await page.getByPlaceholder("Search order no, line name, template, or SKU variant").fill(seed.repeat_line_name || "UI E2E Repeat Pouch")
  await expect(page.getByTestId("sales-repeat-loading")).toHaveCount(0, { timeout: 30_000 })

  await expect(repeatDialog).toContainText(seed.repeat_line_name || "UI E2E Repeat Pouch")
  await expect(repeatDialog).toContainText(/Repeat Exact/i)
  await expect(repeatDialog).toContainText(/Repeat & Edit Commercial/i)
  await expect(repeatDialog).toContainText(/Convert to Custom Detailed/i)
  await expect(repeatDialog).toContainText(/POD/i)
  await expect(repeatDialog).toContainText(/layer\(s\)/i)
  await expect(repeatDialog).toContainText(/\/ PCS|\/ KG/i)
})
