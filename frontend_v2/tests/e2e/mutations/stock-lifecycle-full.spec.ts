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

test("stock lifecycle runs opening, inward, physical count, and FY close on the canonical cockpit", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Inventory / Stock Lifecycle",
    severity: "critical",
    role: "STORE",
    feature: "Opening balance, Smart GRN, physical count, financial year close",
    expected: "The canonical stock lifecycle cockpit should mutate real inventory through audited backend endpoints without falling back to retired stock pages.",
  })

  refreshStockLifecycleSeed()
  const seed = readSeed()

  await page.goto("/inventory/stock-lifecycle?tab=open")
  await page.getByTestId("stock-lifecycle-cockpit").waitFor({ state: "visible", timeout: 30_000 })
  await assertHealthyPage(page)
  await selectByTestId(page, "stock-lifecycle-plant-select", new RegExp(seed.plant_name, "i"))
  await page.getByTestId("open-stock-tab").waitFor({ state: "visible", timeout: 30_000 })

  await page.getByTestId("open-material-search").fill(seed.material_code)
  await expect(page.getByTestId(`open-row-${seed.material_id}`)).toBeVisible({ timeout: 30_000 })
  await selectByTestId(page, `open-location-${seed.material_id}`, new RegExp(seed.location_name, "i"))
  await page.getByTestId(`open-qty-${seed.material_id}`).fill("55")
  const openingResponse = page.waitForResponse((response) => response.url().includes("/api/inventory/opening-stock/manual/") && response.request().method() === "POST")
  await page.getByTestId("open-stock-post").click()
  expect([200, 201]).toContain((await openingResponse).status())
  await expect.poll(() => stockQty(page, seed), { timeout: 15_000 }).toBe(55)

  await page.goto("/inventory/grn")
  await page.getByTestId("smart-grn").waitFor({ state: "visible", timeout: 30_000 })
  await assertHealthyPage(page)
  await page.getByTestId("smart-grn-class-BULK").click()
  await page.getByRole("button", { name: /Direct receipt/i }).click()
  await selectByTestId(page, "smart-grn-vendor", new RegExp(seed.vendor_name, "i"))
  await selectByTestId(page, "smart-grn-warehouse", `${seed.plant_name} · ${seed.location_code} · ${seed.location_name}`)
  await selectByTestId(page, "smart-grn-line-0-material", new RegExp(seed.material_code, "i"))
  await page.getByTestId("smart-grn-line-0-qty").fill("5.5")
  await page.getByTestId("smart-grn-line-0-unit-cost").fill("100")
  const grnResponse = page.waitForResponse((response) => response.url().includes("/api/inventory/grn/create/") && response.request().method() === "POST")
  await page.getByTestId("smart-grn-submit").click()
  expect((await grnResponse).status()).toBe(201)
  await expect.poll(() => stockQty(page, seed), { timeout: 15_000 }).toBeCloseTo(60.5, 3)

  await page.goto("/inventory/stock-lifecycle?tab=count")
  await page.getByTestId("stock-lifecycle-cockpit").waitFor({ state: "visible", timeout: 30_000 })
  await selectByTestId(page, "stock-lifecycle-plant-select", new RegExp(seed.plant_name, "i"))
  await page.getByTestId("stock-count-tab").waitFor({ state: "visible", timeout: 30_000 })
  await page.getByTestId("count-material-search").fill(seed.material_code)
  const countRow = page.locator(`[data-testid^="count-row-BULK:${seed.material_id}:${seed.location_id}:"]`).first()
  await expect(countRow).toBeVisible({ timeout: 30_000 })
  await countRow.locator(`[data-testid^="count-counted-BULK:${seed.material_id}:${seed.location_id}:"]`).fill("60")
  const countCreateResponse = page.waitForResponse((response) => response.url().endsWith("/api/inventory/audit/batches/") && response.request().method() === "POST")
  const countPostResponse = page.waitForResponse((response) => response.url().includes("/api/inventory/audit/batches/") && response.url().includes("/post/") && response.request().method() === "POST")
  await page.getByTestId("count-post-batch").click()
  expect([200, 201]).toContain((await countCreateResponse).status())
  expect((await countPostResponse).status()).toBe(200)
  await expect.poll(() => stockQty(page, seed), { timeout: 15_000 }).toBe(60)

  await page.goto("/inventory/stock-lifecycle?tab=close")
  await page.getByTestId("stock-lifecycle-cockpit").waitFor({ state: "visible", timeout: 30_000 })
  await selectByTestId(page, "stock-lifecycle-plant-select", new RegExp(seed.plant_name, "i"))
  await page.getByTestId("close-stock-tab").waitFor({ state: "visible", timeout: 30_000 })
  await page.getByTestId("close-fy-input").fill(seed.close_financial_year)
  await expect(page.getByTestId("period-close")).toBeEnabled({ timeout: 15_000 })
  const closeResponse = page.waitForResponse((response) => response.url().includes(`/api/inventory/audit/periods/${seed.close_period_id}/close/`) && response.request().method() === "POST")
  await page.getByTestId("period-close").click()
  await page.getByTestId("period-close-confirm").click()
  expect((await closeResponse).status()).toBe(200)

  const transactions = await fetchJson<any>(page, `/api/inventory/bulk-transactions/?material=${seed.material_id}`)
  expect(transactions.status).toBe(200)
  const movementTypes = unwrapApiList<any>(transactions.data).map((row) => String(row.type))
  expect(movementTypes).toEqual(expect.arrayContaining(["OPENING_BALANCE", "INWARD", "COUNT_SHORT"]))
})
