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
  writeRuntimeJson,
} from "../support/test-helpers"

type QuotationSeed = {
  run_tag?: string
  customer_name?: string
  plant_name?: string
  template_name?: string
  film_family_name?: string
  film_variant_name?: string
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
  const runTag = String(seed.run_tag || process.env.UI_E2E_RUN_TAG || Date.now())

  await loginViaUi(page)
  await switchRole(page, "Sales", "/sales/orders", { allowCookieFallback: true })
  await page.goto("/sales/quotations")
  await assertHealthyPage(page)

  await page.getByTestId("quotation-workspace").waitFor({ state: "visible", timeout: 30_000 })
  await selectByTestId(page, "quotation-customer", new RegExp(seed.customer_name || "UAT-GREEN Quote Customer", "i"))
  await selectByTestId(page, "quotation-plant", new RegExp(seed.plant_name || "UAT-GREEN Quote Plant", "i"))
  await selectByTestId(page, "quotation-line-0-template", new RegExp(seed.template_name || "UAT-GREEN Quote Pouch", "i"))
  await page.getByTestId("quotation-line-0-tab-materials").click()
  await selectByTestId(page, "quotation-line-0-layer-0-family", new RegExp(seed.film_family_name || "UAT-GREEN Quote PE Film", "i"))
  await selectByTestId(page, "quotation-line-0-layer-0-variant", new RegExp(seed.film_variant_name || "UAT-GREEN Quote PE Film 50u", "i"))
  await page.getByTestId("quotation-line-0-tab-spec").click()
  await page.getByTestId("quotation-line-0-qty").fill("1500")

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
  expect(saved.customer_name).toBe(seed.customer_name || "UAT-GREEN Quote Customer")
  expect(Number(saved.totals_snapshot?.grand_total || 0)).toBeGreaterThan(0)

  const pdfMeta = await fetchBinaryMeta(page, `/api/sales/quotations/${saved.id}/pdf/`)
  expect(pdfMeta.status).toBe(200)
  expect(pdfMeta.contentType).toContain("application/pdf")
  expect(pdfMeta.byteLength).toBeGreaterThan(1000)

  const popupPromise = page.waitForEvent("popup").catch(() => null)
  const convertResponse = page.waitForResponse(
    (response) => response.url().includes(`/api/sales/quotations/${saved.id}/convert-to-order/`) && response.request().method() === "POST",
  )
  await page.getByTestId("quotation-convert-order").click()

  const conversion = await convertResponse
  expect(conversion.status()).toBe(200)
  const conversionPayload = await conversion.json()
  expect(String(conversionPayload.sales_order_number || "")).toMatch(/^SO\d+/)

  const popup = await popupPromise
  if (popup) {
    await popup.waitForLoadState("domcontentloaded")
    await assertHealthyPage(popup)
    await popup.close().catch(() => {})
  }

  const refreshedQuote = await fetchJson(page, `/api/sales/quotations/${saved.id}/`)
  expect(refreshedQuote.status).toBe(200)
  expect(String((refreshedQuote.data as any)?.status || "")).toBe("CONVERTED")
  expect(String((refreshedQuote.data as any)?.converted_sales_order_number || "")).toBe(String(conversionPayload.sales_order_number || ""))

  const ordersResponse = await fetchJson(page, "/api/sales/orders/")
  expect(ordersResponse.status).toBe(200)
  const convertedOrder = unwrapApiList<any>(ordersResponse.data).find(
    (row) => String(row.order_number || "") === String(conversionPayload.sales_order_number || ""),
  )
  expect(convertedOrder).toBeTruthy()
  expect(String(convertedOrder.customer_name || "")).toBe(seed.customer_name || "UAT-GREEN Quote Customer")

  writeRuntimeJson("quotation-results.json", {
    run_tag: runTag,
    quote_id: String(saved.id || ""),
    quote_number: savedQuoteNumber,
    converted_sales_order_number: String(conversionPayload.sales_order_number || ""),
  })
})
