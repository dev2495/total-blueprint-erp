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

  await selectByTestId(page, "packing-sales-order-select", new RegExp(salesOrderNumber, "i"))
  await expect(page.locator("body")).toContainText(salesOrderNumber)
  await expect(page.locator("body")).toContainText(String(proof?.dryfruit?.direct_fg_stock_order?.batch_number || ""))

  const preSummaryResponse = await fetchJson<any>(page, `/api/production/packing/so_summary/?sales_order_id=${salesOrderId}`)
  expect(preSummaryResponse.status).toBe(200)
  const preSummary = preSummaryResponse.data
  const beforeOpenCount = Number(preSummary?.packing_pending?.open_gonnies_count || 0)

  await page.getByTestId(`packing-create-gonny-${batchId}`).click()
  await page.getByTestId("packing-create-gonny-dialog").waitFor({ state: "visible", timeout: 15_000 })
  await page.getByTestId("packing-gonny-qty").fill("100")
  await page.getByTestId("packing-gonny-material").selectOption({ index: 1 })
  await page.getByTestId("packing-gonny-content-mode").selectOption("LOOSE_POUCHES")

  const createResponse = page.waitForResponse((response) => response.url().includes("/api/production/packing/create_gonny/") && response.request().method() === "POST")
  await page.getByTestId("packing-gonny-submit").click()
  expect((await createResponse).status()).toBe(201)
  await expect(page.getByTestId("packing-create-gonny-dialog")).toBeHidden({ timeout: 15_000 })

  const createdSummaryResponse = await fetchJson<any>(page, `/api/production/packing/so_summary/?sales_order_id=${salesOrderId}`)
  expect(createdSummaryResponse.status).toBe(200)
  const createdSummary = createdSummaryResponse.data
  const gonny = (createdSummary?.gonnies || [])
    .filter((row: any) => String(row.status || "").toUpperCase() === "OPEN" && String(row.batch_no || "") === String(proof?.dryfruit?.direct_fg_stock_order?.batch_number || ""))
    .sort((left: any, right: any) => String(right.id || "").localeCompare(String(left.id || "")))[0]
  expect(gonny, "new open gonny should exist after packing creation").toBeTruthy()
  expect(Number(createdSummary?.packing_pending?.open_gonnies_count || 0)).toBeGreaterThanOrEqual(beforeOpenCount + 1)

  const sealButton = page.getByTestId(`packing-seal-gonny-${gonny.id}`)
  for (let pageTurn = 0; pageTurn < 12 && !(await sealButton.isVisible().catch(() => false)); pageTurn += 1) {
    const next = page.getByTestId("packing-gonny-work-page-next")
    if (!(await next.isVisible().catch(() => false)) || !(await next.isEnabled().catch(() => false))) break
    await next.click()
  }
  await sealButton.click()
  await page.getByTestId("packing-seal-gonny-dialog").waitFor({ state: "visible", timeout: 15_000 })
  await page.getByTestId("packing-gonny-seal-weight").fill("1.500")
  const varianceReason = page.getByTestId("packing-gonny-variance-reason")
  if (await varianceReason.isVisible().catch(() => false)) {
    await varianceReason.fill("Scale weight accepted for dryfruit dispatch proof.")
  }
  const sealResponse = page.waitForResponse((response) => response.url().includes(`/api/production/packing/${gonny.id}/seal/`) && response.request().method() === "POST")
  await page.getByTestId("packing-gonny-seal-submit").click()
  expect((await sealResponse).status()).toBe(200)
  await expect(page.getByTestId("packing-seal-gonny-dialog")).toBeHidden({ timeout: 15_000 })

  const releasedSummaryBeforeResponse = await fetchJson<any>(page, `/api/production/packing/so_summary/?sales_order_id=${salesOrderId}`)
  expect(releasedSummaryBeforeResponse.status).toBe(200)
  const releasedSummaryBefore = releasedSummaryBeforeResponse.data
  const sealedGonny = (releasedSummaryBefore?.gonnies || [])
    .filter((row: any) => String(row.status || "").toUpperCase() === "SEALED" && !row.released_to_dispatch)
    .sort((left: any, right: any) => String(right.id || "").localeCompare(String(left.id || "")))[0]
  expect(sealedGonny, "sealed gonny should be awaiting release to dispatch").toBeTruthy()

  const releaseResponse = page.waitForResponse((response) => response.url().includes(`/api/production/packing/${sealedGonny.id}/release/`) && response.request().method() === "POST")
  await page.getByTestId(`packing-release-gonny-${sealedGonny.id}`).click()
  expect((await releaseResponse).status()).toBe(200)

  await page.screenshot({ path: reportPath("dryfruit-packing-yard.png"), fullPage: true })

  await page.goto("/logistics/dispatch", { waitUntil: "domcontentloaded" })
  await page.getByTestId("dispatch-page").waitFor({ state: "visible", timeout: 30_000 })
  await assertHealthyPage(page, { requireAuth: false })

  await selectByTestId(page, "dispatch-sales-order-select", new RegExp(salesOrderNumber, "i"))
  await expect(page.getByTestId(`dispatch-gonny-checkbox-${sealedGonny.id}`)).toBeVisible({ timeout: 15_000 })
  await page.getByTestId(`dispatch-gonny-checkbox-${sealedGonny.id}`).click()
  await page.getByTestId("dispatch-create-trigger").click()
  await page.getByPlaceholder("MH-XX-AB-XXXX").fill("MH14CD5678")
  const challanCreateResponse = page.waitForResponse((response) => response.url().includes("/api/production/challans/create_challan/") && response.request().method() === "POST")
  await page.getByTestId("dispatch-create-submit").click()
  expect((await challanCreateResponse).status()).toBe(201)

  const challansResponse = await fetchJson<any>(page, "/api/production/challans/list_challans/")
  expect(challansResponse.status).toBe(200)
  const challans = unwrapApiList<any>(challansResponse.data)
  const challan = latestDispatchChallan(challans, salesOrderNumber)
  expect(challan).toBeTruthy()

  if (String(challan.status || "").toUpperCase() === "DRAFT") {
    const dispatchResponse = page.waitForResponse((response) => response.url().includes(`/api/production/challans/${challan.id}/dispatch/`) && response.request().method() === "POST")
    await page.getByTestId(`dispatch-send-${challan.id}`).click()
    expect((await dispatchResponse).status()).toBe(200)
  }

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
