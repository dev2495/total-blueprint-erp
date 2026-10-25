import { test, expect } from "../support/base"
import type { Locator, Page } from "@playwright/test"
import { annotate, assertHealthyPage, fetchBinaryMeta, fetchJson, selectByTestId, unwrapApiList } from "../support/test-helpers"
import { readMutationSeed } from "../support/mutation-seed"

// The packing yard lists order cards (with their lines) six to a page.
const PACKING_PAGE_SIZE = 6

/** Opens the pack window for every ready line of the selected order and shows the tab holding `rollId`. */
const openPackTabWithRoll = async (page: Page, rollId: string) => {
  // After "Jump to order" the queue shows only that order: tick its ready lines and pack them.
  const lineBoxes = page.locator('[data-testid="packing-order-card"]').first().locator('[data-testid^="packing-line-select-"]')
  await expect(lineBoxes.first()).toBeVisible({ timeout: 15_000 })
  for (let index = 0; index < (await lineBoxes.count()); index += 1) await lineBoxes.nth(index).check()
  await page.getByTestId("packing-pack-selected").click()
  await page.getByTestId("packing-pack-dialog").waitFor({ state: "visible", timeout: 15_000 })
  const rollBox = page.getByTestId(`packing-roll-select-${rollId}`)
  for (let tab = 1; tab <= 12 && !(await rollBox.isVisible().catch(() => false)); tab += 1) {
    const tabButton = page.getByTestId(`packing-pack-tab-${tab}`)
    if (await tabButton.isVisible().catch(() => false)) await tabButton.click()
  }
  await expect(rollBox).toBeVisible({ timeout: 15_000 })
  return rollBox
}

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
  const packingRollCount = await chipTotal(page.getByTestId("packing-filter-route-roll"))
  const packingPouchCount = await chipTotal(page.getByTestId("packing-filter-route-pouch"))
  expect(packingAll).toBeGreaterThan(0)
  expect(packingRollCount).toBeGreaterThan(0)
  expect(packingPouchCount).toBeGreaterThan(0)

  await page.getByTestId("packing-filter-route-roll").click()
  await expect(page.getByTestId("packing-queue-total")).toContainText(`of ${packingRollCount} jobs`)
  await expect(packingCards).toHaveCount(Math.min(packingRollCount, PACKING_PAGE_SIZE))
  await expect(page.locator('[data-testid="packing-order-card"][data-route="ROLL"]')).toHaveCount(Math.min(packingRollCount, PACKING_PAGE_SIZE))

  await page.getByTestId("packing-filter-clear").click()
  await expect(packingCards).toHaveCount(packingAll)
  await page.getByTestId("packing-filter-route-pouch").click()
  await expect(page.getByTestId("packing-queue-total")).toContainText(`of ${packingPouchCount} jobs`)
  await expect(packingCards).toHaveCount(Math.min(packingPouchCount, PACKING_PAGE_SIZE))
  await expect(page.locator('[data-testid="packing-order-card"][data-route="POUCH"]')).toHaveCount(Math.min(packingPouchCount, PACKING_PAGE_SIZE))

  await page.getByTestId("packing-filter-clear").click()
  const packingCustomer = await packingCards.first().getAttribute("data-customer")
  expect(packingCustomer).toBeTruthy()
  await page.getByTestId("packing-filter-customer").selectOption(String(packingCustomer))
  await expect(page.locator(`[data-testid="packing-order-card"][data-customer="${packingCustomer}"]`)).toHaveCount(await packingCards.count())
  await page.getByTestId("packing-filter-sort").selectOption("SO_ASC")
  await expect(page.getByTestId("packing-filter-sort")).toHaveValue("SO_ASC")

  // Dispatch only contains released FG. Release one test roll through the
  // existing Packing Yard flow so these filters exercise a real queue row.
  const seed = readMutationSeed()
  const targetRollId = String(seed.dispatch.roll_ids?.[0] || seed.dispatch.roll_id)
  await selectByTestId(page, "packing-sales-order-select", new RegExp(seed.dispatch.sales_order_number, "i"))
  const targetRollBox = await openPackTabWithRoll(page, targetRollId)
  // Release only the target roll: clear the default selection, tick it, release it unpacked.
  if ((await targetRollBox.getAttribute("aria-checked")) === "true") await page.getByTestId("packing-roll-select-all").click()
  if ((await targetRollBox.getAttribute("aria-checked")) !== "true") await targetRollBox.click()
  await expect(targetRollBox).toHaveAttribute("aria-checked", "true")
  await page.getByTestId("packing-roll-release-mode-UNPACKED").click()
  const releaseForQueueResponse = page.waitForResponse((response) => response.url().includes("/api/production/packing/release-roll/") && response.request().method() === "POST")
  await page.getByTestId("packing-roll-submit").click()
  expect([200, 201]).toContain((await releaseForQueueResponse).status())
  await page.getByTestId("packing-pack-close").click()
  await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 })

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
  await openPackTabWithRoll(page, String(rollIds[0]))
  for (const rollId of rollIds) {
    await expect(page.getByTestId(`packing-roll-select-${rollId}`)).toHaveAttribute("aria-checked", "true")
  }
  // Packed when the order has a roll packing list (its items come ticked); otherwise release unpacked.
  await page.getByTestId("packing-roll-release-mode-PACKED").click()
  if (!(await page.getByTestId("packing-roll-submit").isEnabled().catch(() => false))) {
    await page.getByTestId("packing-roll-release-mode-UNPACKED").click()
    await expect(page.locator("body")).toContainText(/Release unpacked roll/i)
  }
  await expect(page.getByTestId("packing-roll-submit")).toContainText(`Release ${rollIds.length} roll`)
  const releaseResponse = page.waitForResponse((response) => response.url().includes(rollIds.length > 1 ? "/api/production/packing/bulk-release-rolls/" : "/api/production/packing/release-roll/") && response.request().method() === "POST")
  await page.getByTestId("packing-roll-submit").click()
  expect([200, 201]).toContain((await releaseResponse).status())
  await page.getByTestId("packing-pack-close").click()
  await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 })

  await page.goto("/logistics/dispatch", { waitUntil: "domcontentloaded" })
  await page.getByTestId("dispatch-page").waitFor({ state: "visible", timeout: 30_000 })
  await assertHealthyPage(page, { requireAuth: false })

  // Jump to the order and load every ready line onto the tray (one slip per line).
  await selectByTestId(page, "dispatch-sales-order-select", new RegExp(seed.dispatch.sales_order_number, "i"))
  const orderCard = page.locator('[data-testid="dispatch-order-card"]').first()
  const lineChecks = orderCard.locator('[data-testid^="dispatch-line-check-"]')
  await expect(lineChecks.first()).toBeVisible({ timeout: 15_000 })
  for (let index = 0; index < (await lineChecks.count()); index += 1) await lineChecks.nth(index).check()
  const trayPanel = page.getByTestId("dispatch-tray")
  await expect(trayPanel).toContainText(`${rollIds.length} roll`)
  const vehicleInput = page.getByPlaceholder("MH-XX-AB-XXXX")
  await expect(vehicleInput).toBeVisible()
  await vehicleInput.fill("MH12AB1234")
  await page.getByPlaceholder("Transporter or company vehicle").fill("UAT E2E Transport")
  await page.getByPlaceholder("City, destination or delivery address").first().fill("UAT E2E Delivery Location")
  const createResponse = page.waitForResponse((response) => response.url().includes("/api/production/challans/create-slips/") && response.request().method() === "POST")
  await page.getByTestId("dispatch-create-submit").click()
  const createdResponse = await createResponse
  expect(createdResponse.status()).toBe(201)
  const createdSlips = (await createdResponse.json()).slips as Array<{ id: string; vehicle_no: string }>
  // Rolls of one order line go on exactly one slip.
  expect(createdSlips).toHaveLength(1)
  expect(createdSlips[0].vehicle_no).toBe("MH12AB1234")
  const challanId = String(createdSlips[0].id || "")
  expect(challanId).toBeTruthy()

  await page.waitForTimeout(1500)
  const challansResponse = await fetchJson<any>(page, "/api/production/challans/list_challans/")
  expect(challansResponse.status).toBe(200)
  const challans = unwrapApiList<any>(challansResponse.data)
  const challan = challans.find((row) => String(row.id) === challanId)
  expect(challan).toBeTruthy()
  const initialStatus = String(challan?.status || "").toUpperCase()
  expect(["DRAFT", "DISPATCHED"]).toContain(initialStatus)

  // The created slip shows the exact text the Epson prints.
  await expect(page.getByTestId("dispatch-slip-text")).toContainText(String(challan?.dc_no || ""), { timeout: 15_000 })
  if (initialStatus === "DRAFT") {
    const sendResponse = page.waitForResponse((response) => response.url().includes(`/api/production/challans/${challanId}/dispatch/`) && response.request().method() === "POST")
    await page.getByTestId("dispatch-mark-dispatched").click()
    expect((await sendResponse).status()).toBe(200)
  }
  await expect(page.getByTestId("dispatch-next-load")).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(1000)
  const dispatchedResponse = await fetchJson<any>(page, "/api/production/challans/list_challans/")
  const dispatched = unwrapApiList<any>(dispatchedResponse.data).find((row) => String(row.id) === challanId)
  expect(String(dispatched?.status || "").toUpperCase()).toBe("DISPATCHED")

  // History is paged on the server: find this slip by its challan number.
  await page.getByTestId("dispatch-history-search").fill(String(challan?.dc_no || ""))
  const deliverButton = page.getByTestId(`dispatch-deliver-history-${challanId}`)
  await expect(deliverButton).toBeVisible({ timeout: 15_000 })
  await deliverButton.click()
  await expect(page.getByRole("dialog")).toContainText("Confirm proof of delivery")
  await page.getByLabel("Received by").fill("UAT E2E Receiver")
  await page.getByLabel("POD reference").fill(`POD-${challanId.slice(0, 8)}`)
  const deliverResponse = page.waitForResponse((response) => response.url().includes(`/api/production/challans/${challanId}/confirm-pod/`) && response.request().method() === "POST")
  await page.getByTestId("dispatch-confirm-pod-submit").click()
  const podConfirmation = await deliverResponse
  expect(podConfirmation.status()).toBe(200)
  expect((await podConfirmation.json()).order_closed).toBe(true)
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
