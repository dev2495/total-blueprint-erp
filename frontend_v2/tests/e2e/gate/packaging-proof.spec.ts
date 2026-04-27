import fs from "node:fs"
import path from "node:path"

import { test, expect } from "../support/base"
import { annotate, assertHealthyPage, fetchJson, unwrapApiList } from "../support/test-helpers"

type InhousePackagingProof = {
  skus: Array<{ code: string; base_uom: string }>
  stock: {
    after_consumption: {
      inner_pouch_pcs: number
      sheet_kg: number
    }
  }
  pouch_breakdown: {
    challan_no: string
    gonnies: Array<{
      label: string
      content_mode: string
      primary_pack_count?: number | null
      net_product_weight_kg: number
      gross_weight_kg: number
    }>
  }
}

function readAcceptanceProof(): InhousePackagingProof {
  const repoRoots = Array.from(
    new Set(
      [
        path.resolve(process.cwd(), ".."),
        path.resolve(__dirname, "../../../.."),
        process.env.REPO_ROOT,
      ].filter(Boolean) as string[],
    ),
  )
  const candidates = [
    ...repoRoots.map((repoRoot) => path.resolve(repoRoot, ".runtime/final-go-live-acceptance/inhouse_packaging_proof.json")),
    ...repoRoots.map((repoRoot) => path.resolve(repoRoot, ".runtime/ui-e2e/acceptance/inhouse_packaging_proof.json")),
    ...repoRoots.map((repoRoot) => path.resolve(repoRoot, ".runtime/acceptance/inhouse_packaging_proof.json")),
  ]
    .filter((candidate) => fs.existsSync(candidate))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)

  const proofPath = candidates[0]
  if (!proofPath) {
    throw new Error(`Acceptance proof missing. Checked repo roots: ${repoRoots.join(", ")}`)
  }
  return JSON.parse(fs.readFileSync(proofPath, "utf8")) as InhousePackagingProof
}

function formatQty(value: number, uom: string) {
  return `${value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3 })} ${uom}`
}

function formatKg(value: number) {
  return `${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`
}

test("produced in-house packaging is visible across packaging inventory, packing yard, and dispatch UI", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Packaging Proof",
    severity: "critical",
    role: "ADMIN",
    feature: "In-house packaging proof visibility",
    expected: "Produced inner-pack and sheet stock should be visible in packaging inventory, pouch packing should show the proof gonnies with net/gross values, and dispatch should expose the generated challan row and print action.",
  })

  const proof = readAcceptanceProof()
  const innerSku = proof.skus.find((row) => row.code === "PACK_INNER_100_INHOUSE")
  const sheetSku = proof.skus.find((row) => row.code === "PACK_ROLL_SHEET_INHOUSE")
  expect(innerSku).toBeTruthy()
  expect(sheetSku).toBeTruthy()

  await page.goto("/inventory/packaging", { waitUntil: "domcontentloaded" })
  await assertHealthyPage(page)

  const packagingSearch = page.getByPlaceholder(/Search packaging material, code, kind, plant, or location/i).first()
  const packagingPage = page.locator("body")

  await packagingSearch.fill(String(innerSku?.code || "PACK_INNER_100_INHOUSE"))
  await expect(packagingPage).toContainText(String(innerSku?.code || "PACK_INNER_100_INHOUSE"))
  await expect(packagingPage).toContainText(formatQty(proof.stock.after_consumption.inner_pouch_pcs, "PCS"))

  await packagingSearch.fill(String(sheetSku?.code || "PACK_ROLL_SHEET_INHOUSE"))
  await expect(packagingPage).toContainText(String(sheetSku?.code || "PACK_ROLL_SHEET_INHOUSE"))
  await expect(packagingPage).toContainText(formatQty(proof.stock.after_consumption.sheet_kg, "KG"))

  await page.goto("/logistics/packing", { waitUntil: "domcontentloaded" })
  await assertHealthyPage(page)

  const primaryPackGonny = proof.pouch_breakdown.gonnies.find((row) => row.content_mode === "PRIMARY_PACKS")
  const looseGonny = proof.pouch_breakdown.gonnies.find((row) => row.content_mode === "LOOSE_POUCHES")
  expect(primaryPackGonny).toBeTruthy()
  expect(looseGonny).toBeTruthy()

  const challansResponse = await fetchJson<any>(page, "/api/production/challans/list_challans/")
  expect(challansResponse.status).toBe(200)
  const challans = unwrapApiList<any>(challansResponse.data)
  const proofChallan = challans.find((row) => String(row.dc_no || "") === proof.pouch_breakdown.challan_no)
  expect(proofChallan).toBeTruthy()

  const salesOrderLabel = String(proofChallan?.so_number || proofChallan?.sales_order_number || "")
  if (salesOrderLabel) {
    await page.getByRole("button", { name: new RegExp(salesOrderLabel, "i") }).first().click()
  }

  await expect(page.locator("body")).toContainText(String(primaryPackGonny?.label || ""))
  await expect(page.locator("body")).toContainText(String(looseGonny?.label || ""))
  await expect(page.locator("body")).toContainText(formatKg(Number(primaryPackGonny?.net_product_weight_kg || 0)))
  await expect(page.locator("body")).toContainText(formatKg(Number(primaryPackGonny?.gross_weight_kg || 0)))
  if (primaryPackGonny?.primary_pack_count) {
    await expect(page.locator("body")).toContainText(`${primaryPackGonny.primary_pack_count} inner packs`)
  }

  await page.goto("/logistics/dispatch", { waitUntil: "domcontentloaded" })
  await assertHealthyPage(page)

  await expect(page.getByTestId(`dispatch-challan-row-${proofChallan.id}`)).toBeVisible()
  await expect(page.getByTestId(`dispatch-print-${proofChallan.id}`)).toBeVisible()
  await expect(page.locator("body")).toContainText(proof.pouch_breakdown.challan_no)
})
