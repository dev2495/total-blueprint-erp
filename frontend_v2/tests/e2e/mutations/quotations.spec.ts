import { assertLocalUiE2ETestDatabase } from "../support/test-db-safety"
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
  approver_username?: string
  approver_password?: string
  run_tag?: string
  customer_name?: string
  plant_id?: string
  plant_name?: string
  product_master_code?: string
  product_master_name?: string
  size_label?: string
}

test("sales can build, save, and export a quotation from the quotations workspace", async ({ page }, testInfo) => {
  assertLocalUiE2ETestDatabase("Quotation lifecycle")
  if (process.env.UI_E2E_LOCAL_SMTP_SINK !== "1") throw new Error("Quotation lifecycle requires an API configured with an isolated local SMTP sink; external delivery is forbidden.")
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

  // The current new-quotation card intentionally starts with customer only;
  // plant assignment is a governed backend field used for source costing. Set
  // the isolated fixture plant before exercising the visible editable header
  // fields and the real submit/approval lifecycle.
  if (seed.plant_id) {
    const plantResponse = await fetchJson(page, `/api/sales/quotations/${createdPayload.id}/`, {
      method: "PATCH",
      body: { plant: seed.plant_id },
    })
    expect(plantResponse.status).toBe(200)
    await page.reload({ waitUntil: "domcontentloaded" })
    await assertHealthyPage(page)
  }

  await page.getByLabel("Contact name *").fill("UAT E2E Contact")
  await page.getByLabel("Contact email *").fill("uat-e2e-quote@example.com")
  await page.getByLabel("Valid until *").fill("2099-12-31")
  await page.getByLabel("Payment terms *").fill("UAT E2E only; no payment is due")
  await page.getByLabel("Delivery terms *").fill("UAT E2E only; no delivery is scheduled")
  await page.getByLabel("Bill-to address *").fill("UAT E2E fixture address")
  await page.getByLabel("Ship-to address *").fill("UAT E2E fixture address")
  await page.getByPlaceholder(/Custom terms/i).fill("UAT E2E fixture quotation terms; not a customer offer.")

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
  const savedLineResponse = await saveResponse
  const saveFailureBody = savedLineResponse.ok() ? "" : await savedLineResponse.text()
  expect(savedLineResponse.status(), `Quotation line save response: ${saveFailureBody}`).toBe(200)

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

  // Exercise the existing commercial gate with an explicit, expiring fixture
  // assumption. This never changes inventory valuation or bypasses approval.
  await page.getByRole("button", { name: /1\. Direct conversion/i }).click()
  await page.getByLabel(/Conversion cost rate$/i).fill("35")
  const costSection = page.locator("section").filter({ has: page.getByRole("button", { name: /^Save Cost Build$/i }) })
  await costSection.getByPlaceholder("Reason", { exact: true }).fill("Isolated E2E conversion assumption; not a customer offer")
  await costSection.locator('input[type="datetime-local"]').fill("2099-12-31T12:00")
  const costResponse = page.waitForResponse(
    (response) => response.url().includes(`/api/sales/quotations/${saved.id}/cost-build/`) && response.request().method() === "POST",
  )
  await page.getByRole("button", { name: /^Save Cost Build$/i }).click()
  const costSaved = await costResponse
  const costPayload = await costSaved.json()
  expect(costSaved.status(), JSON.stringify(costPayload)).toBe(200)
  expect(costPayload.readiness?.pending_override_count).toBe(1)
  // The existing backend requires segregation even for superusers.
  expect(seed.approver_username).toBeTruthy()
  expect(seed.approver_password).toBeTruthy()
  await page.context().clearCookies()
  await loginViaUi(page, seed.approver_username!, seed.approver_password!, { requireRoleSwitcher: false })
  await page.goto(`/sales/quotations/${saved.id}`)
  await page.getByLabel("Cost override approval reason").fill("Isolated fixture: independently checked conversion evidence")
  const overrideResponse = page.waitForResponse(
    (response) => response.url().includes(`/api/sales/quotations/${saved.id}/approve-cost-overrides/`) && response.request().method() === "POST",
  )
  await page.getByRole("button", { name: /^Approve cost overrides$/i }).click()
  expect((await overrideResponse).status()).toBe(200)

  const submitResponse = page.waitForResponse(
    (response) => response.url().includes(`/api/sales/quotations/${saved.id}/submit-for-approval/`) && response.request().method() === "POST",
  )
  await page.getByRole("button", { name: /Submit for approval/i }).click()
  expect((await submitResponse).status()).toBe(200)

  // The submitter also cannot approve the same frozen revision.
  await page.context().clearCookies()
  await loginViaUi(page)
  await page.goto(`/sales/quotations/${saved.id}`)
  for (const gate of ["commercial", "finance"]) {
    const approveButton = page.getByRole("button", { name: new RegExp(`Approve ${gate}`, "i") })
    await expect(approveButton).toBeEnabled({ timeout: 30_000 })
    const approveResponse = page.waitForResponse(
      (response) => response.url().includes(`/api/sales/quotations/${saved.id}/approve/`) && response.request().method() === "POST",
    )
    await approveButton.click()
    const approved = await approveResponse
    expect(approved.status(), await approved.text()).toBe(200)
  }

  // Deliver only to the isolated SMTP sink configured for this local test API.
  // The real service still creates immutable release evidence before acceptance.
  await page.getByRole("button", { name: /^Send frozen revision$/i }).click()
  const sendResponse = page.waitForResponse(
    (response) => response.url().includes(`/api/sales/quotations/${saved.id}/send/`) && response.request().method() === "POST",
  )
  await page.getByRole("dialog").getByRole("button", { name: /^Send$/i }).click()
  const delivery = await sendResponse
  expect(delivery.status(), await delivery.text()).toBe(200)
  await page.getByRole("button", { name: /^Record acceptance$/i }).click()
  await page.getByPlaceholder("PO / email / acceptance reference").fill(`ISOLATED-E2E-${runTag}`)
  const acceptanceResponse = page.waitForResponse(
    (response) => response.url().includes(`/api/sales/quotations/${saved.id}/client-outcome/`) && response.request().method() === "POST",
  )
  await page.getByRole("button", { name: /^Record outcome$/i }).click()
  expect((await acceptanceResponse).status()).toBe(200)

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
