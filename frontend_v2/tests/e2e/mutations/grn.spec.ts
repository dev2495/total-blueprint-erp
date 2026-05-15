import { test, expect } from "../support/base"
import { annotate, assertHealthyPage, fetchJson, selectByTestId, switchRole, unwrapApiList } from "../support/test-helpers"
import { readMutationSeed } from "../support/mutation-seed"

function bulkQty(rows: any[], materialId: string, locationId: string) {
  return rows
    .filter((row) => String(row.material_id || row.material || "") === materialId && String(row.location_id || row.location || "") === locationId)
    .reduce((sum, row) => sum + Number(row.qty_kg || row.quantity || 0), 0)
}

test("store can inward bulk stock through GRN and update inventory ledger state", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Store / GRN",
    severity: "critical",
    role: "STORE",
    feature: "Bulk GRN mutation",
    expected: "Bulk GRN should create stock for the selected plant/location/material and make the new total visible through the stock API.",
  })

  const seed = readMutationSeed()

  await page.goto("/dashboard/admin")
  await switchRole(page, "Store", "/inventory/rolls-v36", { allowCookieFallback: true })
  await page.goto("/inventory/grn-v36")
  await page.getByTestId("smart-grn-v36").waitFor({ state: "visible", timeout: 30_000 })
  await assertHealthyPage(page)

  const before = await fetchJson<any>(page, `/api/inventory/stock/bulk/?plant=${seed.grn.plant_id}&location=${seed.grn.bulk_location_id}`)
  const beforeRows = unwrapApiList<any>(before.data)
  const beforeQty = bulkQty(beforeRows, seed.grn.bulk_material_id, seed.grn.bulk_location_id)

  await page.getByTestId("smart-grn-class-BULK").click()
  await page.getByTestId("smart-grn-vendor").click()
  await page.getByRole("option").first().click()
  await selectByTestId(page, "smart-grn-warehouse", new RegExp(seed.grn.bulk_location_name, "i"))
  await selectByTestId(page, "smart-grn-line-0-material", new RegExp(seed.grn.bulk_material_code, "i"))
  await page.getByTestId("smart-grn-line-0-granule-code").click()
  await page.getByRole("option").first().click()
  await page.getByTestId("smart-grn-line-0-qty").fill("25.250")
  const bulkSubmit = page.waitForResponse((response) => response.url().includes("/api/inventory/grn/create/") && response.request().method() === "POST")
  await page.getByTestId("smart-grn-submit").click()
  expect((await bulkSubmit).status()).toBe(201)

  await page.waitForTimeout(1000)
  const after = await fetchJson<any>(page, `/api/inventory/stock/bulk/?plant=${seed.grn.plant_id}&location=${seed.grn.bulk_location_id}`)
  const afterRows = unwrapApiList<any>(after.data)
  const afterQty = bulkQty(afterRows, seed.grn.bulk_material_id, seed.grn.bulk_location_id)
  expect(afterQty).toBeGreaterThan(beforeQty)
})

test("store can inward roll stock through GRN and create a traceable new roll", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Store / GRN",
    severity: "critical",
    role: "STORE",
    feature: "Roll GRN mutation",
    expected: "Roll GRN should create a new physical roll record with the submitted label, dimensions, and plant/location placement.",
  })

  const seed = readMutationSeed()
  await page.goto("/dashboard/admin")
  await switchRole(page, "Store", "/inventory/rolls-v36", { allowCookieFallback: true })
  await page.goto("/inventory/grn-v36")
  await page.getByTestId("smart-grn-v36").waitFor({ state: "visible", timeout: 30_000 })
  await assertHealthyPage(page)

  await page.getByTestId("smart-grn-class-ROLL").click()
  await page.getByTestId("smart-grn-vendor").click()
  await page.getByRole("option").first().click()
  await selectByTestId(page, "smart-grn-warehouse", new RegExp(seed.grn.roll_location_name, "i"))
  await selectByTestId(page, "smart-grn-line-0-material", new RegExp(seed.grn.roll_material_code, "i"))
  await page.getByTestId("smart-grn-line-0-thickness").fill("12")
  await page.getByTestId("smart-grn-line-0-width").fill("760")
  await page.getByTestId("smart-grn-line-0-gross").fill("3.500")
  await page.getByTestId("smart-grn-line-0-tare").fill("0.250")
  const rollSubmit = page.waitForResponse((response) => response.url().includes("/api/inventory/grn/create/") && response.request().method() === "POST")
  await page.getByTestId("smart-grn-submit").click()
  const rollSubmitResponse = await rollSubmit
  expect(rollSubmitResponse.status()).toBe(201)
  const rollSubmitPayload = await rollSubmitResponse.json()
  const createdRef = (rollSubmitPayload.stock_movements || []).find((row: any) => String(row.type || "").toUpperCase() === "ROLL")
  expect(createdRef?.id).toBeTruthy()

  const rollDetailResponse = await fetchJson<any>(page, `/api/inventory/rolls/${createdRef.id}/`)
  expect(rollDetailResponse.status).toBe(200)
  const created = rollDetailResponse.data
  expect(created).toBeTruthy()
  expect(Math.abs(Number(created.net_weight_kg || created.weight_kg || 0) - 3.25)).toBeLessThan(0.001)
})
