import fs from "node:fs"
import path from "node:path"

import { expect, test } from "../support/base"
import { annotate, assertHealthyPage, fetchBinaryMeta, fetchJson, readRuntimeJson, selectByTestId, unwrapApiList, writeRuntimeJson } from "../support/test-helpers"

type DryfruitProof = {
  dryfruit: {
    sales_orders: {
      fg: {
        sales_order_id: string
        sales_order_number: string
      }
    }
    direct_fg_stock_order: {
      batch_id: string
      batch_number: string
    }
  }
}

function reportPath(fileName: string) {
  return path.resolve(process.cwd(), "../.runtime/ui-e2e", fileName)
}

function latestDispatchChallan(rows: any[], salesOrderNumber: string) {
  return rows
    .filter((row) => String(row.so_number || row.sales_order_number || "") === salesOrderNumber)
    .sort((left, right) => new Date(String(right.dispatch_date || right.created_at || 0)).getTime() - new Date(String(left.dispatch_date || left.created_at || 0)).getTime())[0]
}

test("direct FG pouch batch can move from packing yard to dispatch bay through gonny flow", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Dispatch",
    severity: "critical",
    role: "DISPATCH",
    feature: "Direct FG pouch dispatch bridge",
    expected: "A direct-FG claimed pouch order should appear in Packing Yard as a batch, allow gonny creation/seal/release, then appear in Dispatch Bay for challan and PDF generation.",
  })

  const proof = readRuntimeJson<DryfruitProof>("dryfruit-courier-ui-proof.json")
  expect(proof?.dryfruit?.sales_orders?.fg?.sales_order_id).toBeTruthy()
  expect(proof?.dryfruit?.sales_orders?.fg?.sales_order_number).toBeTruthy()
  expect(proof?.dryfruit?.direct_fg_stock_order?.batch_id).toBeTruthy()

  const salesOrderId = String(proof?.dryfruit?.sales_orders?.fg?.sales_order_id || "")
  const salesOrderNumber = String(proof?.dryfruit?.sales_orders?.fg?.sales_order_number || "")
  const batchId = String(proof?.dryfruit?.direct_fg_stock_order?.batch_id || "")

  await page.goto("/logistics/packing", { waitUntil: "domcontentloaded" })
  await page.getByTestId("packing-page").waitFor({ state: "visible", timeout: 30_000 })
  await assertHealthyPage(page, { requireAuth: false })

  const batchNumber = String(proof?.dryfruit?.direct_fg_stock_order?.batch_number || "")
  // Jump to the order: the queue narrows to its card, with one row per ready line.
  await selectByTestId(page, "packing-sales-order-select", new RegExp(salesOrderNumber, "i"))
  const orderCard = page.locator(`[data-testid="packing-order-card"][data-order-id="${salesOrderId}"]`)
  await expect(orderCard).toBeVisible({ timeout: 15_000 })
  await expect(orderCard.locator('[data-testid^="packing-line-row-"]').first()).toBeVisible({ timeout: 15_000 })

  const preSummaryResponse = await fetchJson<any>(page, `/api/production/packing/so_summary/?sales_order_id=${salesOrderId}`)
  expect(preSummaryResponse.status).toBe(200)
  const preSummary = preSummaryResponse.data
  const beforeOpenCount = Number(preSummary?.packing_pending?.open_gonnies_count || 0)

  // Tick every line that is ready and pack them in one window; the batch sits on one line's tab.
  const lineBoxes = orderCard.locator('[data-testid^="packing-line-select-"]')
  for (let index = 0; index < (await lineBoxes.count()); index += 1) await lineBoxes.nth(index).check()
  await page.getByTestId("packing-pack-selected").click()
  const packDialog = page.getByTestId("packing-pack-dialog")
  await packDialog.waitFor({ state: "visible", timeout: 15_000 })
  const batchButton = page.getByTestId(`packing-pack-batch-${batchId}`)
  for (let tab = 1; tab <= 12 && !(await batchButton.isVisible().catch(() => false)); tab += 1) {
    const tabButton = page.getByTestId(`packing-pack-tab-${tab}`)
    if (await tabButton.isVisible().catch(() => false)) await tabButton.click()
  }
  await expect(batchButton).toBeVisible({ timeout: 15_000 })
  await expect(packDialog).toContainText(batchNumber)
  await batchButton.click()
  // The order decides inner packs or loose; the yard only enters how many go in this gonny.
  if (await page.getByTestId("packing-gonny-inner").isVisible().catch(() => false)) {
    await page.getByTestId("packing-gonny-inner").fill("1")
  } else {
    await page.getByTestId("packing-gonny-qty").fill("100")
  }
  await expect(page.getByTestId("packing-gonny-weight-preview")).toBeVisible()
  await page.getByTestId("packing-gonny-material").selectOption({ index: 1 })

  const createResponse = page.waitForResponse((response) => response.url().includes("/api/production/packing/create_gonny/") && response.request().method() === "POST")
  await page.getByTestId("packing-gonny-submit").click()
  expect((await createResponse).status()).toBe(201)

  const createdSummaryResponse = await fetchJson<any>(page, `/api/production/packing/so_summary/?sales_order_id=${salesOrderId}`)
  expect(createdSummaryResponse.status).toBe(200)
  const createdSummary = createdSummaryResponse.data
  const gonny = (createdSummary?.gonnies || [])
    .filter((row: any) => String(row.status || "").toUpperCase() === "OPEN" && String(row.batch_no || "") === String(proof?.dryfruit?.direct_fg_stock_order?.batch_number || ""))
    .sort((left: any, right: any) => String(right.id || "").localeCompare(String(left.id || "")))[0]
  expect(gonny, "new open gonny should exist after packing creation").toBeTruthy()
  expect(Number(createdSummary?.packing_pending?.open_gonnies_count || 0)).toBeGreaterThanOrEqual(beforeOpenCount + 1)

  // Packing a gonny goes straight on to weighing it, on the same row of the pack window.
  const grossInput = page.getByTestId(`packing-gonny-gross-${gonny.id}`)
  await expect(grossInput).toBeVisible({ timeout: 15_000 })
  await grossInput.fill("1.500")
  const varianceReason = page.getByTestId(`packing-gonny-reason-${gonny.id}`)
  if (await varianceReason.isVisible().catch(() => false)) {
    await varianceReason.fill("Scale weight accepted for dryfruit dispatch proof.")
  }
  const sealResponse = page.waitForResponse((response) => response.url().includes(`/api/production/packing/${gonny.id}/seal/`) && response.request().method() === "POST")
  await page.getByTestId(`packing-gonny-seal-${gonny.id}`).click()
  expect((await sealResponse).status()).toBe(200)
  await expect(page.getByTestId(`packing-gonny-row-${gonny.id}`)).toHaveAttribute("data-stage", "SEALED", { timeout: 15_000 })

  const releasedSummaryBeforeResponse = await fetchJson<any>(page, `/api/production/packing/so_summary/?sales_order_id=${salesOrderId}`)
  expect(releasedSummaryBeforeResponse.status).toBe(200)
  const releasedSummaryBefore = releasedSummaryBeforeResponse.data
  const sealedGonny = (releasedSummaryBefore?.gonnies || [])
    .filter((row: any) => String(row.status || "").toUpperCase() === "SEALED" && !row.released_to_dispatch)
    .sort((left: any, right: any) => String(right.id || "").localeCompare(String(left.id || "")))[0]
  expect(sealedGonny, "sealed gonny should be awaiting release to dispatch").toBeTruthy()

  // Packing items are ticks only; the release sends every sealed gonny of the line.
  const releaseResponse = page.waitForResponse((response) => response.url().includes(`/api/production/packing/${sealedGonny.id}/release/`) && response.request().method() === "POST")
  await page.getByTestId("packing-gonny-release-submit").click()
  expect((await releaseResponse).status()).toBe(200)
  await expect(page.getByTestId(`packing-gonny-row-${sealedGonny.id}`)).toHaveAttribute("data-stage", "RELEASED", { timeout: 15_000 })
  await page.getByTestId("packing-pack-close").click()
  await expect(packDialog).toBeHidden({ timeout: 15_000 })

  await page.screenshot({ path: reportPath("dryfruit-packing-yard.png"), fullPage: true })

  await page.goto("/logistics/dispatch", { waitUntil: "domcontentloaded" })
  await page.getByTestId("dispatch-page").waitFor({ state: "visible", timeout: 30_000 })
  await assertHealthyPage(page, { requireAuth: false })

  await selectByTestId(page, "dispatch-sales-order-select", new RegExp(salesOrderNumber, "i"))
  // Open the order's unit lists and load just this gonny onto the tray.
  const unitToggles = page.locator(`[data-testid^="dispatch-units-toggle-${salesOrderId}-"]`)
  await expect(unitToggles.first()).toBeVisible({ timeout: 15_000 })
  for (let index = 0; index < (await unitToggles.count()); index += 1) await unitToggles.nth(index).click()
  await expect(page.getByTestId(`dispatch-gonny-checkbox-${sealedGonny.id}`)).toBeVisible({ timeout: 15_000 })
  await page.getByTestId(`dispatch-gonny-checkbox-${sealedGonny.id}`).check()
  await expect(page.getByTestId("dispatch-tray")).toContainText("1 gonny")
  // Vehicle is optional; the slip is created and dispatched without one.
  await page.getByPlaceholder("Transporter or company vehicle").fill("UAT Dryfruit Transport")
  await page.getByPlaceholder("City, destination or delivery address").first().fill("UAT Dryfruit Dispatch Location")
  const slipsResponsePromise = page.waitForResponse((response) => response.url().includes("/api/production/challans/create-slips/") && response.request().method() === "POST")
  await page.getByTestId("dispatch-create-submit").click()
  const slipsResponse = await slipsResponsePromise
  expect(slipsResponse.status()).toBe(201)
  const slips = (await slipsResponse.json()).slips as Array<{ id: string; dc_no: string; status: string; vehicle_no: string }>
  expect(slips).toHaveLength(1)
  expect(slips[0].vehicle_no).toBe("")

  const challansResponse = await fetchJson<any>(page, "/api/production/challans/list_challans/")
  expect(challansResponse.status).toBe(200)
  const challans = unwrapApiList<any>(challansResponse.data)
  const challan = challans.find((row) => String(row.id) === slips[0].id) || latestDispatchChallan(challans, salesOrderNumber)
  expect(challan).toBeTruthy()

  if (String(challan.status || "").toUpperCase() === "DRAFT") {
    const dispatchResponse = page.waitForResponse((response) => response.url().includes(`/api/production/challans/${challan.id}/dispatch/`) && response.request().method() === "POST")
    await page.getByTestId("dispatch-mark-dispatched").click()
    expect((await dispatchResponse).status()).toBe(200)
  }
  await expect(page.getByTestId("dispatch-next-load")).toBeVisible({ timeout: 15_000 })

  const pdf = await fetchBinaryMeta(page, `/api/production/challans/${challan.id}/print-list/`)
  expect(pdf.status).toBe(200)
  expect(pdf.contentType).toContain("application/pdf")
  expect(pdf.byteLength).toBeGreaterThan(1000)

  await page.screenshot({ path: reportPath("dryfruit-dispatch-bay.png"), fullPage: true })

  writeRuntimeJson("dryfruit-pouch-dispatch-proof.json", {
    sales_order_id: salesOrderId,
    sales_order_number: salesOrderNumber,
    batch_id: batchId,
    gonny_id: sealedGonny.id,
    challan_id: challan.id,
    challan_no: challan.dc_no,
    pdf_status: pdf.status,
    pdf_bytes: pdf.byteLength,
    screenshots: {
      packing: reportPath("dryfruit-packing-yard.png"),
      dispatch: reportPath("dryfruit-dispatch-bay.png"),
    },
  })

  expect(fs.existsSync(reportPath("dryfruit-packing-yard.png"))).toBeTruthy()
  expect(fs.existsSync(reportPath("dryfruit-dispatch-bay.png"))).toBeTruthy()
})
