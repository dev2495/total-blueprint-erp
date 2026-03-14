import { test, expect } from "../support/base"
import { annotate, assertHealthyPage, fetchBinaryMeta, fetchJson, selectByTestId, switchRole, unwrapApiList } from "../support/test-helpers"
import { readMutationSeed } from "../support/mutation-seed"

function latestDispatchChallan(rows: any[], salesOrderNumber: string) {
  return rows
    .filter((row) => String(row.so_number || "") === salesOrderNumber)
    .sort((left, right) => new Date(String(right.dispatch_date || right.created_at || 0)).getTime() - new Date(String(left.dispatch_date || left.created_at || 0)).getTime())[0]
}

test("dispatch can pack a roll, create a challan, dispatch it, and print the list", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Dispatch",
    severity: "critical",
    role: "DISPATCH",
    feature: "Dispatch challan lifecycle",
    expected: "Dispatch should be able to pack the seeded FG roll, create a delivery challan, release it, and generate a printable PDF.",
  })

  const seed = readMutationSeed()

  await page.goto("/dashboard/admin")
  await switchRole(page, "Dispatch", "/dashboard/logistics")
  await page.goto("/logistics/dispatch")
  await page.getByTestId("dispatch-page").waitFor({ state: "visible", timeout: 30_000 })
  await assertHealthyPage(page)

  await selectByTestId(page, "dispatch-sales-order-select", new RegExp(seed.dispatch.sales_order_number, "i"))
  await page.getByTestId(`dispatch-pack-trigger-${seed.dispatch.roll_id}`).click()
  if (await page.getByText(/no packing lines configured/i).isVisible().catch(() => false)) {
    await page.getByRole("button", { name: /add row/i }).click()
  }
  await page.getByTestId("dispatch-pack-material-0").fill(seed.dispatch.packaging_material_id)
  await page.getByTestId("dispatch-pack-qty-0").fill(String(seed.dispatch.packaging_qty))
  const packResponse = page.waitForResponse((response) => response.url().includes("/api/production/challans/pack_roll/") && response.request().method() === "POST")
  await page.getByTestId("dispatch-pack-save").click()
  expect((await packResponse).status()).toBe(201)
  await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 })
  await expect(page.getByTestId(`dispatch-roll-checkbox-${seed.dispatch.roll_id}`)).toBeEnabled({ timeout: 15_000 })

  await page.getByTestId(`dispatch-roll-checkbox-${seed.dispatch.roll_id}`).click()
  await page.getByTestId("dispatch-create-trigger").click()
  const vehicleInput = page.getByPlaceholder("MH-XX-AB-XXXX")
  if (await vehicleInput.isVisible().catch(() => false)) {
    await vehicleInput.fill("MH12AB1234")
  }
  const createResponse = page.waitForResponse((response) => response.url().includes("/api/production/challans/create_challan/") && response.request().method() === "POST")
  await page.getByTestId("dispatch-create-submit").click()
  expect((await createResponse).status()).toBe(201)

  await page.waitForTimeout(1500)
  const challansResponse = await fetchJson<any>(page, "/api/production/challans/list_challans/")
  expect(challansResponse.status).toBe(200)
  const challans = unwrapApiList<any>(challansResponse.data)
  const challan = latestDispatchChallan(challans, seed.dispatch.sales_order_number)
  expect(challan).toBeTruthy()
  expect(String(challan?.status || "").toUpperCase()).toBe("DRAFT")

  const sendResponse = page.waitForResponse((response) => response.url().includes(`/api/production/challans/${challan.id}/dispatch/`) && response.request().method() === "POST")
  await page.getByTestId(`dispatch-send-${challan.id}`).click()
  expect((await sendResponse).status()).toBe(200)
  await page.waitForTimeout(1000)
  const dispatchedResponse = await fetchJson<any>(page, "/api/production/challans/list_challans/")
  const dispatched = latestDispatchChallan(unwrapApiList<any>(dispatchedResponse.data), seed.dispatch.sales_order_number)
  expect(String(dispatched?.status || "").toUpperCase()).toBe("DISPATCHED")

  const pdf = await fetchBinaryMeta(page, `/api/production/challans/${challan.id}/print-list/`)
  expect(pdf.status).toBe(200)
  expect(pdf.contentType).toContain("application/pdf")
  expect(pdf.byteLength).toBeGreaterThan(1000)
})
