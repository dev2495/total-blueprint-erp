import { test, expect } from "../support/base"
import { annotate, assertHealthyPage, fetchBinaryMeta, fetchJson, selectByTestId, unwrapApiList } from "../support/test-helpers"
import { readMutationSeed } from "../support/mutation-seed"

function latestDispatchChallan(rows: any[], salesOrderNumber: string) {
  return rows
    .filter((row) => String(row.so_number || "") === salesOrderNumber)
    .sort((left, right) => new Date(String(right.dispatch_date || right.created_at || 0)).getTime() - new Date(String(left.dispatch_date || left.created_at || 0)).getTime())[0]
}

test("packing yard can release a roll to dispatch, then dispatch can create challan, dispatch it, and print the list", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Dispatch",
    severity: "critical",
    role: "DISPATCH",
    feature: "Dispatch challan lifecycle",
    expected: "Packing Yard should release the seeded FG roll to Dispatch Bay first, then Dispatch should create a delivery challan, release it, and generate a printable PDF.",
  })

  const seed = readMutationSeed({ refresh: true })

  await page.goto("/logistics/packing", { waitUntil: "domcontentloaded" })
  await page.getByTestId("packing-page").waitFor({ state: "visible", timeout: 30_000 })
  await assertHealthyPage(page, { requireAuth: false })

  await selectByTestId(page, "packing-sales-order-select", new RegExp(seed.dispatch.sales_order_number, "i"))
  await page.getByTestId(`packing-roll-release-${seed.dispatch.roll_id}`).click()
  await page.getByTestId("packing-roll-dialog").waitFor({ state: "visible", timeout: 15_000 })
  await page.getByTestId("packing-roll-release-mode").selectOption("PACKED")
  await page.getByTestId("packing-roll-material-0").fill(seed.dispatch.packaging_material_id)
  await page.getByTestId("packing-roll-qty-0").fill(String(seed.dispatch.packaging_qty))
  const releaseResponse = page.waitForResponse((response) => response.url().includes("/api/production/packing/release-roll/") && response.request().method() === "POST")
  await page.getByTestId("packing-roll-submit").click()
  expect([200, 201]).toContain((await releaseResponse).status())
  await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 })

  await page.goto("/logistics/dispatch", { waitUntil: "domcontentloaded" })
  await page.getByTestId("dispatch-page").waitFor({ state: "visible", timeout: 30_000 })
  await assertHealthyPage(page, { requireAuth: false })

  await selectByTestId(page, "dispatch-sales-order-select", new RegExp(seed.dispatch.sales_order_number, "i"))
  await expect(page.getByTestId(`dispatch-roll-checkbox-${seed.dispatch.roll_id}`)).toBeVisible({ timeout: 15_000 })

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
  const initialStatus = String(challan?.status || "").toUpperCase()
  expect(["DRAFT", "DISPATCHED"]).toContain(initialStatus)

  if (initialStatus === "DRAFT") {
    const sendResponse = page.waitForResponse((response) => response.url().includes(`/api/production/challans/${challan.id}/dispatch/`) && response.request().method() === "POST")
    await page.getByTestId(`dispatch-send-${challan.id}`).click()
    expect((await sendResponse).status()).toBe(200)
  }
  await page.waitForTimeout(1000)
  const dispatchedResponse = await fetchJson<any>(page, "/api/production/challans/list_challans/")
  const dispatched = latestDispatchChallan(unwrapApiList<any>(dispatchedResponse.data), seed.dispatch.sales_order_number)
  expect(String(dispatched?.status || "").toUpperCase()).toBe("DISPATCHED")

  const pdf = await fetchBinaryMeta(page, `/api/production/challans/${challan.id}/print-list/`)
  expect(pdf.status).toBe(200)
  expect(pdf.contentType).toContain("application/pdf")
  expect(pdf.byteLength).toBeGreaterThan(1000)
})
