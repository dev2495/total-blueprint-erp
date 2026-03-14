import { test, expect } from "../support/base"
import { annotate, assertHealthyPage, fetchJson, selectByTestId, switchRole, unwrapApiList } from "../support/test-helpers"
import { readMutationSeed } from "../support/mutation-seed"

async function pickMaterial(page: import("@playwright/test").Page, testId: string, materialCode: string) {
  await page.getByTestId(testId).click()
  await page.getByPlaceholder("Search by code or name..").fill(materialCode)
  await page.getByText(new RegExp(materialCode, "i")).first().click()
}

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
  await switchRole(page, "Store", "/inventory/roll-explorer")
  await page.goto("/inventory/grn")
  await page.getByTestId("grn-page").waitFor({ state: "visible", timeout: 30_000 })
  await assertHealthyPage(page)

  const before = await fetchJson<any>(page, `/api/inventory/stock/bulk/?plant=${seed.grn.plant_id}&location=${seed.grn.bulk_location_id}`)
  const beforeRows = unwrapApiList<any>(before.data)
  const beforeQty = bulkQty(beforeRows, seed.grn.bulk_material_id, seed.grn.bulk_location_id)

  await selectByTestId(page, "bulk-grn-plant", new RegExp(seed.grn.plant_name, "i"))
  await selectByTestId(page, "bulk-grn-location", new RegExp(seed.grn.bulk_location_name, "i"))
  await page.getByTestId("bulk-grn-vendor").click()
  await page.getByRole("option").first().click()
  await pickMaterial(page, "bulk-grn-material", seed.grn.bulk_material_code)
  await page.getByTestId("bulk-grn-quantity").fill("25.250")
  const bulkSubmit = page.waitForResponse((response) => response.url().includes("/api/inventory/grn/bulk/") && response.request().method() === "POST")
  await page.getByTestId("bulk-grn-submit").click()
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
  const label = `${seed.grn.roll_label_prefix}-${Date.now()}`

  await page.goto("/dashboard/admin")
  await switchRole(page, "Store", "/inventory/roll-explorer")
  await page.goto("/inventory/grn")
  await page.getByTestId("grn-page").waitFor({ state: "visible", timeout: 30_000 })
  await assertHealthyPage(page)

  await page.getByTestId("grn-tab-roll").click()
  await selectByTestId(page, "roll-grn-plant", new RegExp(seed.grn.plant_name, "i"))
  await selectByTestId(page, "roll-grn-location", new RegExp(seed.grn.roll_location_name, "i"))
  await page.getByTestId("roll-grn-vendor").click()
  await page.getByRole("option").first().click()
  await pickMaterial(page, "roll-grn-material", seed.grn.roll_material_code)
  await page.getByTestId("roll-grn-label-0").fill(label)
  await page.getByTestId("roll-grn-thickness-0").fill("12")
  await page.getByTestId("roll-grn-width-0").fill("760")
  await page.getByTestId("roll-grn-weight-0").fill("3.250")
  const rollSubmit = page.waitForResponse((response) => response.url().includes("/api/inventory/grn/roll/") && response.request().method() === "POST")
  await page.getByTestId("roll-grn-submit").click()
  expect((await rollSubmit).status()).toBe(201)

  await page.waitForTimeout(1500)
  let created: any | undefined
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const rollsResponse = await fetchJson<any>(page, `/api/inventory/stock/rolls/?plant=${seed.grn.plant_id}&location=${seed.grn.roll_location_id}`)
    const rolls = unwrapApiList<any>(rollsResponse.data)
    created = rolls.find((row) => String(row.label_id || "") === label)
    if (created) break
    await page.waitForTimeout(500)
  }
  expect(created).toBeTruthy()
})
