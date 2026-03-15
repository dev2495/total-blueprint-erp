import { expect, test } from "../support/base"
import {
  annotate,
  assertHealthyPage,
  fetchBinaryMeta,
  fetchJson,
  loginViaUi,
  readRuntimeJson,
  selectByTestId,
  switchRole,
  unwrapApiList,
} from "../support/test-helpers"

type QuotationSeed = {
  customer_name?: string
  plant_name?: string
}

test("sales can build, save, and export a quotation from the quotations workspace", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Sales",
    severity: "high",
    role: "SALES",
    feature: "Quotation workspace",
    expected: "Sales users should be able to save a quotation from the UI and download its PDF without runtime failures.",
  })

  const seed = readRuntimeJson<QuotationSeed>("quotation-seed.json") || {}

  await loginViaUi(page)
  await switchRole(page, "Sales", "/sales/orders")
  await page.goto("/sales/quotations")
  await assertHealthyPage(page)

  await page.getByTestId("quotation-workspace").waitFor({ state: "visible", timeout: 30_000 })
  await selectByTestId(page, "quotation-customer", new RegExp(seed.customer_name || "UI E2E Quote Customer", "i"))
  await selectByTestId(page, "quotation-plant", new RegExp(seed.plant_name || "UI E2E Quote Plant", "i"))

  await page.getByTestId("quotation-line-0-tab-pricing").click()
  await page.getByTestId("quotation-line-0-manual-unit-price").fill("7.50")
  await page.getByTestId("quotation-save").click()

  const quoteNumber = page.getByTestId("quotation-number")
  await expect(quoteNumber).toHaveText(/QT\d+/, { timeout: 30_000 })
  await expect(page.getByTestId("quotation-open-pdf")).toBeVisible()

  const savedQuoteNumber = ((await quoteNumber.textContent()) || "").trim()
  const listResponse = await fetchJson(page, "/api/sales/quotations/")
  expect(listResponse.status).toBe(200)
  const rows = unwrapApiList<any>(listResponse.data)
  const saved = rows.find((row) => row.quote_number === savedQuoteNumber)

  expect(saved).toBeTruthy()
  expect(saved.customer_name).toBe(seed.customer_name || "UI E2E Quote Customer")
  expect(Number(saved.totals_snapshot?.grand_total || 0)).toBeGreaterThan(0)

  const pdfMeta = await fetchBinaryMeta(page, `/api/sales/quotations/${saved.id}/pdf/`)
  expect(pdfMeta.status).toBe(200)
  expect(pdfMeta.contentType).toContain("application/pdf")
  expect(pdfMeta.byteLength).toBeGreaterThan(1000)
})
