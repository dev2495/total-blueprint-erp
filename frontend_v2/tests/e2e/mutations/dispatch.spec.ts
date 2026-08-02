import { test, expect } from "../support/base"
import type { Locator } from "@playwright/test"
import { annotate, assertHealthyPage, fetchBinaryMeta, fetchJson, selectByTestId, unwrapApiList } from "../support/test-helpers"
import { readMutationSeed } from "../support/mutation-seed"

const QUEUE_PAGE_SIZE = 8

const chipTotal = async (locator: Locator) => {
  const text = await locator.innerText()
  const matches = text.match(/\d+/g) || []
  return Number(matches[matches.length - 1] || 0)
}

test("packing and dispatch queue filters change the live queues instead of acting as static chips", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Logistics",
    severity: "high",
    role: "DISPATCH",
    feature: "Packing and dispatch filters",
    expected: "Route, unit, status, customer, sort, and clear controls should be wired to the visible queue cards.",
  })

  readMutationSeed({ refresh: true })

  await page.goto("/logistics/packing", { waitUntil: "domcontentloaded" })
  await page.getByTestId("packing-page").waitFor({ state: "visible", timeout: 30_000 })
  await assertHealthyPage(page, { requireAuth: false })
  await expect(page.getByTestId("packing-order-card").first()).toBeVisible({ timeout: 30_000 })

  const packingCards = page.getByTestId("packing-order-card")
  const packingAll = await packingCards.count()
  const packingRollCount = await chipTotal(page.getByTestId("packing-route-filter-roll"))
  const packingPouchCount = await chipTotal(page.getByTestId("packing-route-filter-pouch"))
  expect(packingAll).toBeGreaterThan(0)
  expect(packingRollCount).toBeGreaterThan(0)
  expect(packingPouchCount).toBeGreaterThan(0)

  await page.getByTestId("packing-route-filter-roll").click()
  await expect(page.getByTestId("packing-queue-total")).toContainText(`of ${packingRollCount} jobs`)
  await expect(packingCards).toHaveCount(Math.min(packingRollCount, QUEUE_PAGE_SIZE))
  await expect(page.locator('[data-testid="packing-order-card"][data-route="ROLL"]')).toHaveCount(Math.min(packingRollCount, QUEUE_PAGE_SIZE))

  await page.getByTestId("packing-filter-clear").click()
  await expect(packingCards).toHaveCount(packingAll)
  await page.getByTestId("packing-filter-route-pouch").click()
  await expect(page.getByTestId("packing-queue-total")).toContainText(`of ${packingPouchCount} jobs`)
  await expect(packingCards).toHaveCount(Math.min(packingPouchCount, QUEUE_PAGE_SIZE))
  await expect(page.locator('[data-testid="packing-order-card"][data-route="POUCH"]')).toHaveCount(Math.min(packingPouchCount, QUEUE_PAGE_SIZE))

  const packingStatus = await packingCards.first().getAttribute("data-status")
  expect(packingStatus).toBeTruthy()
  await page.getByTestId(`packing-filter-status-${String(packingStatus).toLowerCase()}`).click()
  await expect(page.locator(`[data-testid="packing-order-card"][data-status="${packingStatus}"]`)).toHaveCount(await packingCards.count())

  await page.getByTestId("packing-filter-clear").click()
  const packingCustomer = await packingCards.first().getAttribute("data-customer")
  expect(packingCustomer).toBeTruthy()
  await page.getByTestId("packing-filter-customer").selectOption(String(packingCustomer))
  await expect(page.locator(`[data-testid="packing-order-card"][data-customer="${packingCustomer}"]`)).toHaveCount(await packingCards.count())
  await page.getByTestId("packing-filter-sort").selectOption("SO_ASC")
  await expect(page.getByTestId("packing-filter-sort")).toHaveValue("SO_ASC")

  await page.goto("/logistics/dispatch", { waitUntil: "domcontentloaded" })
  await page.getByTestId("dispatch-page").waitFor({ state: "visible", timeout: 30_000 })
  await assertHealthyPage(page, { requireAuth: false })
  await expect(page.getByTestId("dispatch-order-card").first()).toBeVisible({ timeout: 30_000 })

  const dispatchCards = page.getByTestId("dispatch-order-card")
  const dispatchAll = await dispatchCards.count()
  const dispatchRollCount = await page.locator('[data-testid="dispatch-order-card"][data-unit-roll="true"]').count()
  const dispatchCtnCount = await page.locator('[data-testid="dispatch-order-card"][data-unit-ctn="true"]').count()
  expect(dispatchAll).toBeGreaterThan(0)
  expect(dispatchRollCount).toBeGreaterThan(0)

  await page.getByTestId("dispatch-filter-unit-roll").click()
  await expect(page.locator('[data-testid="dispatch-order-card"][data-unit-roll="true"]')).toHaveCount(await dispatchCards.count())
  await expect(page.getByTestId("dispatch-queue-total")).toContainText("orders")

  if (dispatchCtnCount > 0) {
    await page.getByTestId("dispatch-filter-unit-ctn").click()
    await expect(page.locator('[data-testid="dispatch-order-card"][data-unit-ctn="true"]')).toHaveCount(await dispatchCards.count())
    await expect(page.getByTestId("dispatch-queue-total")).toContainText("orders")
  }

  await page.getByTestId("dispatch-filter-clear").click()
  await expect(dispatchCards).toHaveCount(dispatchAll)
  const dispatchStatus = await dispatchCards.first().getAttribute("data-status")
  expect(dispatchStatus).toBeTruthy()
  await page.getByTestId(`dispatch-filter-status-${String(dispatchStatus).toLowerCase()}`).click()
  await expect(page.locator(`[data-testid="dispatch-order-card"][data-status="${dispatchStatus}"]`)).toHaveCount(await dispatchCards.count())

  await page.getByTestId("dispatch-filter-clear").click()
  const dispatchCustomer = await dispatchCards.first().getAttribute("data-customer")
  expect(dispatchCustomer).toBeTruthy()
  await page.getByTestId("dispatch-filter-customer").selectOption(String(dispatchCustomer))
  await expect(page.locator(`[data-testid="dispatch-order-card"][data-customer="${dispatchCustomer}"]`)).toHaveCount(await dispatchCards.count())
  await page.getByTestId("dispatch-filter-sort").selectOption("GROSS_DESC")
  await expect(page.getByTestId("dispatch-filter-sort")).toHaveValue("GROSS_DESC")
})

test("packing yard can release a roll to dispatch, then dispatch can create challan, dispatch it, and print the list", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Dispatch",
    severity: "critical",
    role: "DISPATCH",
    feature: "Dispatch challan lifecycle",
    expected: "Packing Yard should release the seeded FG roll to Dispatch Bay first, then Dispatch should create a delivery challan, release it, and generate a printable PDF.",
  })

  const seed = readMutationSeed({ refresh: true })
  const rollIds = Array.isArray(seed.dispatch.roll_ids) && seed.dispatch.roll_ids.length ? seed.dispatch.roll_ids : [seed.dispatch.roll_id]

  await page.goto("/logistics/packing", { waitUntil: "domcontentloaded" })
  await page.getByTestId("packing-page").waitFor({ state: "visible", timeout: 30_000 })
  await assertHealthyPage(page, { requireAuth: false })

  await selectByTestId(page, "packing-sales-order-select", new RegExp(seed.dispatch.sales_order_number, "i"))
  await page.getByRole("button", { name: /ROLL_PACK\s+Packed roll/i }).click()
  if (rollIds.length > 1) {
    await expect(page.getByTestId("packing-roll-work-total")).toContainText(/rolls/i)
    await page.getByTestId("packing-roll-select-all").click()
    await page.getByTestId("packing-roll-bulk-release").click()
  } else {
    await page.getByTestId(`packing-roll-release-${seed.dispatch.roll_id}`).click()
  }
  await page.getByTestId("packing-roll-dialog").waitFor({ state: "visible", timeout: 15_000 })
  await page.getByTestId("packing-roll-release-mode").selectOption("PACKED")
  const allowedMaterial = page.getByTestId("packing-roll-allowed-material-0")
  if (await allowedMaterial.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await expect(allowedMaterial).toBeVisible()
  } else {
    await page.getByTestId("packing-roll-release-mode").selectOption("UNPACKED")
    await expect(page.locator("body")).toContainText(/Release unpacked roll/i)
  }
  const releaseResponse = page.waitForResponse((response) => response.url().includes(rollIds.length > 1 ? "/api/production/packing/bulk-release-rolls/" : "/api/production/packing/release-roll/") && response.request().method() === "POST")
  await page.getByTestId("packing-roll-submit").click()
  expect([200, 201]).toContain((await releaseResponse).status())
  await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 })

  await page.goto("/logistics/dispatch", { waitUntil: "domcontentloaded" })
  await page.getByTestId("dispatch-page").waitFor({ state: "visible", timeout: 30_000 })
  await assertHealthyPage(page, { requireAuth: false })

  await selectByTestId(page, "dispatch-sales-order-select", new RegExp(seed.dispatch.sales_order_number, "i"))
  await expect(page.getByTestId(`dispatch-roll-checkbox-${rollIds[0]}`)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId("dispatch-manifest-total")).toContainText(/units/i)
  await page.getByTestId("dispatch-select-all-units").click()
  await page.getByTestId("dispatch-create-trigger").click()
  const vehicleInput = page.getByPlaceholder("MH-XX-AB-XXXX")
  if (await vehicleInput.isVisible().catch(() => false)) {
    await vehicleInput.fill("MH12AB1234")
  }
  const createResponse = page.waitForResponse((response) => response.url().includes("/api/production/challans/create_challan/") && response.request().method() === "POST")
  await page.getByTestId("dispatch-create-submit").click()
  const createdResponse = await createResponse
  expect(createdResponse.status()).toBe(201)
  const createdChallan = await createdResponse.json()
  const challanId = String(createdChallan.id || "")
  expect(challanId).toBeTruthy()

  await page.waitForTimeout(1500)
  const challansResponse = await fetchJson<any>(page, "/api/production/challans/list_challans/")
  expect(challansResponse.status).toBe(200)
  const challans = unwrapApiList<any>(challansResponse.data)
  const challan = challans.find((row) => String(row.id) === challanId)
  expect(challan).toBeTruthy()
  const initialStatus = String(challan?.status || "").toUpperCase()
  expect(["DRAFT", "DISPATCHED"]).toContain(initialStatus)

  if (initialStatus === "DRAFT") {
    const sendResponse = page.waitForResponse((response) => response.url().includes(`/api/production/challans/${challanId}/dispatch/`) && response.request().method() === "POST")
    await page.getByTestId(`dispatch-send-${challanId}`).click()
    expect((await sendResponse).status()).toBe(200)
  }
  await page.waitForTimeout(1000)
  const dispatchedResponse = await fetchJson<any>(page, "/api/production/challans/list_challans/")
  const dispatched = unwrapApiList<any>(dispatchedResponse.data).find((row) => String(row.id) === challanId)
  expect(String(dispatched?.status || "").toUpperCase()).toBe("DISPATCHED")

  const deliverButton = page.getByTestId(`dispatch-deliver-history-${challanId}`)
  await expect(deliverButton).toBeVisible({ timeout: 15_000 })
  const deliverResponse = page.waitForResponse((response) => response.url().includes(`/api/production/challans/${challanId}/update_status/`) && response.request().method() === "POST")
  await deliverButton.click()
  expect((await deliverResponse).status()).toBe(200)
  await page.waitForTimeout(1000)
  const deliveredResponse = await fetchJson<any>(page, "/api/production/challans/list_challans/")
  const delivered = unwrapApiList<any>(deliveredResponse.data).find((row) => String(row.id) === challanId)
  expect(String(delivered?.status || "").toUpperCase()).toBe("DELIVERED")

  const pdf = await fetchBinaryMeta(page, `/api/production/challans/${challanId}/print-list/`)
  expect(pdf.status).toBe(200)
  expect(pdf.contentType).toContain("application/pdf")
  expect(pdf.byteLength).toBeGreaterThan(1000)

  const epsonJob = await fetchBinaryMeta(
    page,
    `/api/production/challans/${challanId}/print-list/?print_format=tpp`,
  )
  expect(epsonJob.status).toBe(200)
  expect(epsonJob.contentType).toContain("application/vnd.totalpolyprint.epson-raw")
  expect(epsonJob.byteLength).toBeGreaterThan(250)
})
