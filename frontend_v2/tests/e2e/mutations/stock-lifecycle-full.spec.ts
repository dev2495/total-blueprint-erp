import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import { test, expect } from "../support/base"
import { annotate, assertHealthyPage, fetchJson, readRuntimeJson, selectByTestId, unwrapApiList } from "../support/test-helpers"

interface StockLifecycleSeed {
  plant_id: string
  plant_name: string
  location_id: string
  location_code: string
  location_name: string
  material_id: string
  material_code: string
  vendor_name: string
  current_period_id: string
  close_period_id: string
  close_financial_year: string
}

function resolveRepoRoot() {
  const cwd = process.cwd()
  return cwd.endsWith(`${path.sep}frontend_v2`) ? path.resolve(cwd, "..") : cwd
}

function resolvePython(repoRoot: string) {
  const candidates = [
    process.env.UI_E2E_PYTHON,
    process.env.BACKEND_PYTHON,
    path.join(repoRoot, "venv_311/bin/python"),
    path.join(repoRoot, ".venv-validate/bin/python"),
    path.join(repoRoot, "venv/bin/python"),
  ].filter(Boolean) as string[]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return candidates[candidates.length - 1]
}

function refreshStockLifecycleSeed() {
  const repoRoot = resolveRepoRoot()
  execFileSync(resolvePython(repoRoot), [path.join(repoRoot, "scripts/seed_ui_e2e_stock_lifecycle.py")], {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      SKIP_DOTENV_IMPORT: process.env.SKIP_DOTENV_IMPORT || "1",
      SKIP_CELERY_IMPORT: process.env.SKIP_CELERY_IMPORT || "1",
    },
  })
}

function readSeed() {
  const seed = readRuntimeJson<StockLifecycleSeed>("stock-lifecycle-seed.json")
  if (!seed) throw new Error("Missing stock-lifecycle-seed.json runtime metadata.")
  return seed
}

async function stockQty(page: import("@playwright/test").Page, seed: StockLifecycleSeed) {
  const snapshot = await fetchJson<any>(page, `/api/inventory/audit/stock-snapshot/?plant=${seed.plant_id}`)
  expect(snapshot.status).toBe(200)
  const row = (snapshot.data.rows || []).find((item: any) => String(item.material || "") === seed.material_id && String(item.location || "") === seed.location_id)
  return Number(row?.qty || 0)
}

async function selectNative(page: import("@playwright/test").Page, testId: string, value: string) {
  const control = page.getByTestId(testId)
  await control.waitFor({ state: "visible", timeout: 30_000 })
  await control.selectOption(value)
}

test("stock lifecycle runs opening, inward, count, post, close, and FY correction on the V36 UI", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Inventory / Stock Lifecycle",
    severity: "critical",
    role: "STORE",
    feature: "Opening balance, Smart GRN, stock count, close, correction",
    expected: "The V36 surfaces should mutate real inventory through audited backend endpoints without falling back to old routes.",
  })

  refreshStockLifecycleSeed()
  const seed = readSeed()

  await page.goto("/inventory/period")
  await page.getByTestId("stock-lifecycle-workspace").waitFor({ state: "visible", timeout: 30_000 })
  await assertHealthyPage(page)
  await selectNative(page, "period-plant-select", seed.plant_id)
  await selectNative(page, "period-select", seed.current_period_id)

  await selectByTestId(page, "opening-material-code", new RegExp(seed.material_code, "i"))
  await selectNative(page, "opening-location-code", seed.location_id)
  await page.getByTestId("opening-qty").fill("55")
  const openingResponse = page.waitForResponse((response) => response.url().includes("/api/inventory/opening-stock/manual/") && response.request().method() === "POST")
  await page.getByTestId("opening-post-manual").click()
  expect((await openingResponse).status()).toBe(201)
  await expect.poll(() => stockQty(page, seed), { timeout: 15_000 }).toBe(55)

  await page.goto("/inventory/grn-v36")
  await page.getByTestId("smart-grn-v36").waitFor({ state: "visible", timeout: 30_000 })
  await assertHealthyPage(page)
  await page.getByTestId("smart-grn-class-BULK").click()
  await selectByTestId(page, "smart-grn-vendor", new RegExp(seed.vendor_name, "i"))
  await selectByTestId(page, "smart-grn-warehouse", `${seed.plant_name} · ${seed.location_code} · ${seed.location_name}`)
  await selectByTestId(page, "smart-grn-line-0-material", new RegExp(seed.material_code, "i"))
  await page.getByTestId("smart-grn-line-0-qty").fill("5.5")
  await page.getByTestId("smart-grn-line-0-unit-cost").fill("100")
  const grnResponse = page.waitForResponse((response) => response.url().includes("/api/inventory/grn/create/") && response.request().method() === "POST")
  await page.getByTestId("smart-grn-submit").click()
  expect((await grnResponse).status()).toBe(201)
  await expect.poll(() => stockQty(page, seed), { timeout: 15_000 }).toBeCloseTo(60.5, 3)

  await page.goto("/inventory/period")
  await page.getByTestId("stock-lifecycle-workspace").waitFor({ state: "visible", timeout: 30_000 })
  await selectNative(page, "period-plant-select", seed.plant_id)
  await selectNative(page, "period-select", seed.current_period_id)
  const countCreateResponse = page.waitForResponse((response) => response.url().endsWith("/api/inventory/audit/batches/") && response.request().method() === "POST")
  await page.getByRole("button", { name: /\+ Quick count \(chunk\)/i }).click()
  const createdBatch = await (await countCreateResponse).json()
  await expect.poll(async () => {
    const batch = await fetchJson<any>(page, `/api/inventory/audit/batches/${createdBatch.id}/`)
    return Number(batch.data.line_count || 0)
  }, { timeout: 20_000 }).toBeGreaterThan(0)

  await page.goto(`/inventory/count?batch=${createdBatch.id}`)
  await page.getByTestId("mobile-count-v36").waitFor({ state: "visible", timeout: 30_000 })
  await page.getByTestId(`count-location-${seed.location_code}`).click()
  await expect(page.getByTestId("count-current-row")).toContainText(seed.material_code, { timeout: 30_000 })
  for (const key of ["6", "0"]) {
    await page.getByTestId(`count-key-${key}`).click()
  }
  const lineResponse = page.waitForResponse((response) => response.url().includes("/submit-line/") && response.request().method() === "POST")
  await page.getByTestId("count-save-next").click()
  expect((await lineResponse).status()).toBe(200)

  await page.goto(`/inventory/count?batch=${createdBatch.id}`)
  await page.getByTestId("mobile-count-v36").waitFor({ state: "visible", timeout: 30_000 })
  const finalizeResponse = page.waitForResponse((response) => response.url().includes("/finalize/") && response.request().method() === "POST")
  await page.getByTestId("count-submit-batch").click()
  expect((await finalizeResponse).status()).toBe(200)

  await page.goto("/inventory/period")
  await page.getByTestId("stock-lifecycle-workspace").waitFor({ state: "visible", timeout: 30_000 })
  await selectNative(page, "period-plant-select", seed.plant_id)
  await selectNative(page, "period-batch-select", createdBatch.id)
  const approveResponse = page.waitForResponse((response) => response.url().includes(`/api/inventory/audit/batches/${createdBatch.id}/approve/`) && response.request().method() === "POST")
  await page.getByTestId("period-batch-approve").click()
  expect((await approveResponse).status()).toBe(200)
  await expect(page.getByTestId("period-batch-post")).toBeEnabled({ timeout: 15_000 })
  const postResponse = page.waitForResponse((response) => response.url().includes(`/api/inventory/audit/batches/${createdBatch.id}/post/`) && response.request().method() === "POST")
  await page.getByTestId("period-batch-post").click()
  expect((await postResponse).status()).toBe(200)
  await expect.poll(() => stockQty(page, seed), { timeout: 15_000 }).toBe(60)

  await selectNative(page, "period-select", seed.close_period_id)
  await selectNative(page, "period-plant-select", seed.plant_id)
  const closeResponse = page.waitForResponse((response) => response.url().includes(`/api/inventory/audit/periods/${seed.close_period_id}/close/`) && response.request().method() === "POST")
  await page.getByTestId("period-close").click()
  expect((await closeResponse).status()).toBe(200)
  await expect(page.getByTestId("correction-period-select")).toContainText(seed.close_financial_year, { timeout: 15_000 })

  await selectNative(page, "correction-period-select", seed.close_period_id)
  await page.getByTestId("correction-counted-qty").fill("59")
  const correctionPostResponse = page.waitForResponse((response) => response.url().includes("/api/inventory/audit/batches/") && response.url().includes("/post/") && response.request().method() === "POST")
  await page.getByTestId("fy-correction-post").click()
  expect((await correctionPostResponse).status()).toBe(200)
  await expect.poll(() => stockQty(page, seed), { timeout: 15_000 }).toBe(59)

  const transactions = await fetchJson<any>(page, `/api/inventory/bulk-transactions/?material=${seed.material_id}`)
  expect(transactions.status).toBe(200)
  const movementTypes = unwrapApiList<any>(transactions.data).map((row) => String(row.type))
  expect(movementTypes).toEqual(expect.arrayContaining(["OPENING_BALANCE", "INWARD", "COUNT_SHORT", "FY_CORRECTION"]))
})
