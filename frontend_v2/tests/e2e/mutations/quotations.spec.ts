import { expect, test } from "../support/base"
import {
  annotate,
  assertHealthyPage,
  fetchBinaryMeta,
  fetchJson,
  loginViaUi,
  readRuntimeJson,
  switchRole,
  unwrapApiList,
  writeRuntimeJson,
} from "../support/test-helpers"

type QuotationSeed = {
  run_tag?: string
  customer_name?: string
  plant_name?: string
  product_master_code?: string
  product_master_name?: string
  size_label?: string
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
  await page.goto("/sales/quotations/new")
  await assertHealthyPage(page)

  const customerName = seed.customer_name || "UAT-GREEN Quote Customer"
  const customerSearch = page.getByPlaceholder(/Search customer by name or code/i)
  await customerSearch.fill(customerName)
  await page.getByRole("button", { name: new RegExp(customerName, "i") }).first().click()

  const createResponse = page.waitForResponse(
    (response) => response.url().includes("/api/sales/quotations/") && response.request().method() === "POST",
  )
  await page.getByRole("button", { name: /Start quotation/i }).click()
  const created = await createResponse
  expect(created.status()).toBe(201)
  const createdPayload = await created.json()
  await page.waitForURL(new RegExp(`/sales/quotations/${createdPayload.id}`), { timeout: 30_000 })
  await assertHealthyPage(page)

  await page.getByRole("button", { name: /Catalog line/i }).click()
  await page.getByRole("button", { name: /Pick product master/i }).click()
  const masterSearch = page.getByPlaceholder(/Search by code or name/i)
  const productMasterCode = seed.product_master_code || "UAT-GREEN-QPM"
  const masterSearchResponse = page.waitForResponse(
    (response) => response.url().includes("/api/master/products") && response.url().includes(`q=${encodeURIComponent(productMasterCode)}`),
  )
  await masterSearch.fill(productMasterCode)
  expect((await masterSearchResponse).status()).toBe(200)
  await expect(page.getByTitle("Select current Product Master")).toHaveCount(1)
  await expect(
    page.getByRole("button", {
      name: new RegExp(seed.product_master_name || seed.product_master_code || "Quote Product Master", "i"),
    }),
  ).toBeAttached()
  await masterSearch.press("Enter")
  await page
    .getByRole("button", { name: new RegExp(seed.size_label || "Quote 140 x 220", "i") })
    .click()

  await page.getByLabel(/^Quantity$/i).fill("1500")
  await page.getByLabel(/^Rate ₹$/i).fill("750")
  const saveResponse = page.waitForResponse(
    (response) => response.url().includes(`/api/sales/quotations/${createdPayload.id}/bulk-update-items/`) && response.request().method() === "POST",
  )
  await page.getByRole("button", { name: /Save line/i }).click()
  expect((await saveResponse).status()).toBe(200)

  const savedResponse = await fetchJson<any>(page, `/api/sales/quotations/${createdPayload.id}/`)
  expect(savedResponse.status).toBe(200)
  const saved = savedResponse.data
  const savedQuoteNumber = String(saved.quote_number || "")
  expect(savedQuoteNumber).toMatch(/^QT\d+$/)
  expect(saved.customer_name).toBe(customerName)
  expect(Number(saved.totals_snapshot?.grand_total || 0)).toBeGreaterThan(0)
  expect(String(saved.items?.[0]?.spec_snapshot?.product_master_id || "")).toBeTruthy()
  expect(String(saved.items?.[0]?.spec_snapshot?.size_id || "")).toBeTruthy()

  const pdfMeta = await fetchBinaryMeta(page, `/api/sales/quotations/${saved.id}/pdf/`)
  expect(pdfMeta.status).toBe(200)
  expect(pdfMeta.contentType).toContain("application/pdf")
  expect(pdfMeta.byteLength).toBeGreaterThan(1000)

  const approveResponse = page.waitForResponse(
    (response) => response.url().includes(`/api/sales/quotations/${saved.id}/approve/`) && response.request().method() === "POST",
  )
  const approveButton = page.getByRole("button", { name: /^Approve$/i })
  await expect(approveButton).toBeEnabled({ timeout: 30_000 })
  await approveButton.click()
  expect((await approveResponse).status()).toBe(200)

  const convertResponse = page.waitForResponse(
    (response) => response.url().includes(`/api/sales/quotations/${saved.id}/convert-to-order/`) && response.request().method() === "POST",
  )
  await page.getByRole("button", { name: /Convert to Sales Order/i }).first().click()
  await page.getByRole("dialog").getByRole("button", { name: /^Convert$/i }).click()

  const conversion = await convertResponse
  expect(conversion.status()).toBe(200)
  const conversionPayload = await conversion.json()
  expect(String(conversionPayload.sales_order_number || "")).toMatch(/^SO(?:-\d{4})?-\d+$/)

  await page.waitForURL(new RegExp(`/sales/orders/${conversionPayload.sales_order_id}`), { timeout: 30_000 })
  await assertHealthyPage(page)

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
  expect(String(convertedOrder.customer_name || "")).toBe(customerName)

  writeRuntimeJson("quotation-results.json", {
    run_tag: runTag,
    quote_id: String(saved.id || ""),
    quote_number: savedQuoteNumber,
    converted_sales_order_number: String(conversionPayload.sales_order_number || ""),
  })
})
