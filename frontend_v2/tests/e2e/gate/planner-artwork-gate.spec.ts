import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { test, expect } from "../support/base"
import { annotate, assertHealthyPage } from "../support/test-helpers"

function readPlannerGateSeed() {
  const repoRoot = resolveRepoRoot()
  const filePath = path.resolve(repoRoot, ".runtime/ui-e2e/planner-gate-seed.json")
  if (!fs.existsSync(filePath)) return null
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as {
    order_id?: string
    order_number?: string
    order_name?: string
  }
}

function resolveRepoRoot() {
  const candidates = [
    process.env.REPO_ROOT,
    path.resolve(process.cwd(), ".."),
    path.resolve(__dirname, "../../../.."),
  ].filter(Boolean) as string[]
  const repoRoot = candidates.find((candidate) => fs.existsSync(path.resolve(candidate, "scripts/seed_ui_e2e_planner_gate.py")))
  if (!repoRoot) {
    throw new Error(`Planner gate repo root missing. Tried: ${candidates.join(", ")}`)
  }
  return repoRoot
}

function reseedPlannerGate() {
  const repoRoot = resolveRepoRoot()
  const pythonCandidates = [
    process.env.UI_E2E_PYTHON,
    process.env.BACKEND_PYTHON,
    "/tmp/tberp_backend_venv/bin/python",
    path.resolve(repoRoot, "../../../venv/bin/python"),
    path.resolve(repoRoot, "venv_311/bin/python"),
    path.resolve(repoRoot, ".venv/bin/python"),
  ].filter(Boolean) as string[]
  const python = pythonCandidates.find((candidate) => fs.existsSync(candidate))
  if (!python) {
    throw new Error(`No backend Python runtime found for planner gate seed. Tried: ${pythonCandidates.join(", ")}`)
  }
  execFileSync(python, [path.resolve(repoRoot, "scripts/seed_ui_e2e_planner_gate.py")], {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
  })
}

async function rowHasActiveArtworkGate(page: any, rowKey: string) {
  const select = page.getByTestId(`planner-approved-artwork-select-${rowKey}`)
  if (await select.count()) return true
  const assignButton = page.getByTestId(`planner-assign-artwork-${rowKey}`)
  if (await assignButton.count()) return true
  const pickerButton = page.getByTestId(`planner-open-artwork-picker-${rowKey}`)
  if (await pickerButton.count()) return true
  return false
}

test("planner can resolve a deferred artwork gate from the queue", async ({ page }, testInfo) => {
  reseedPlannerGate()

  annotate(testInfo, {
    module: "Planner",
    severity: "critical",
    feature: "Deferred artwork assignment",
    expected: "Planner should find a queued sales row with artwork gate, assign approved artwork, and clear the artwork blocker.",
  })

  await page.goto("/dashboard/planner/control-tower/plan-queue")
  await assertHealthyPage(page)
  await page.getByTestId("planner-filter-all").click().catch(() => undefined)
  await expect(page.getByText(/Loading planner truth/i)).toHaveCount(0, { timeout: 30_000 })

  const seed = readPlannerGateSeed()
  const queueSearch = page.getByPlaceholder(/search order/i).first()
  if (seed?.order_number) {
    await queueSearch.fill(seed.order_number)
    await page.waitForTimeout(300)
  }
  let selectedRowKey: string | null = null
  if (seed?.order_id) {
    selectedRowKey = `sales:${seed.order_id}`
    const seededRow = page.getByTestId(`planner-queue-row-${selectedRowKey}`)
    if (await seededRow.count()) {
      await seededRow.scrollIntoViewIfNeeded().catch(() => undefined)
      if (await seededRow.isVisible().catch(() => false)) {
        await seededRow.click()
        await page.waitForTimeout(300)
      } else {
        selectedRowKey = null
      }
    } else {
      selectedRowKey = null
    }
  } else if (seed?.order_number) {
    await expect(page.locator("[data-testid^='planner-queue-row-']").first()).toBeVisible({ timeout: 30_000 })
    const seededText = page.getByText(new RegExp(seed.order_number, "i"))
    if (await seededText.count()) {
      const row = seededText.first().locator("xpath=ancestor-or-self::*[@data-testid][starts-with(@data-testid, 'planner-queue-row-')]").first()
      const testId = await row.getAttribute("data-testid")
      selectedRowKey = testId?.replace("planner-queue-row-", "") || null
      if (selectedRowKey) {
        await page.getByTestId(`planner-queue-row-${selectedRowKey}`).click()
      }
      await page.waitForTimeout(300)
    }
  }

  let rows = page.locator("[data-testid^='planner-queue-row-']")
  if ((await rows.count()) === 0) {
    await queueSearch.fill("")
    await page.waitForTimeout(250)
    await page.getByTestId("planner-filter-artwork_gate").click().catch(() => undefined)
    await page.waitForTimeout(400)
    rows = page.locator("[data-testid^='planner-queue-row-']")
  }
  await expect(rows.first()).toBeVisible({ timeout: 30_000 })
  const rowCount = await rows.count()
  let gateFound = selectedRowKey
    ? await rowHasActiveArtworkGate(page, selectedRowKey)
    : false

  if (!gateFound) {
    for (let index = 0; index < rowCount; index += 1) {
      const testId = await rows.nth(index).getAttribute("data-testid")
      const rowKey = testId?.replace("planner-queue-row-", "")
      if (!rowKey || rowKey === selectedRowKey) continue
      await rows.nth(index).click()
      await page.waitForTimeout(300)
      if (await rowHasActiveArtworkGate(page, rowKey)) {
        selectedRowKey = rowKey
        gateFound = true
        break
      }
    }
  }

  expect(gateFound, "No planner artwork gate row was visible in the seeded queue.").toBeTruthy()
  expect(selectedRowKey).not.toBeNull()
  if (!selectedRowKey) {
    throw new Error("Planner artwork gate row key was not resolved.")
  }
  await expect(page.getByTestId(`planner-artwork-gate-${selectedRowKey}`)).toBeVisible()
  await expect(page.getByTestId(`planner-open-artwork-picker-${selectedRowKey}`)).toBeVisible()
  await page.getByTestId(`planner-open-artwork-picker-${selectedRowKey}`).click()
  const artworkDialog = page.getByTestId("planner-artwork-picker-dialog")
  await expect(artworkDialog).toBeVisible()
  const preferredArtwork = artworkDialog
    .locator("[data-artwork-code*='UI-E2E-FLEXO-GATE'], [data-artwork-code*='UAT-GREEN']")
    .first()
  const artworkOption = (await preferredArtwork.count()) > 0
    ? preferredArtwork
    : artworkDialog.locator("[data-testid^='planner-artwork-option-']").first()
  const selectedArtwork = (await artworkOption.textContent())?.trim() || ""
  await artworkOption.click()
  expect(selectedArtwork).not.toEqual("")
  await expect(page.getByTestId("planner-confirm-artwork-assign")).toBeEnabled()
  await page.getByTestId("planner-confirm-artwork-assign").click()

  if (selectedRowKey) {
    await page.getByTestId("planner-filter-all").click().catch(() => undefined)
    await page.waitForTimeout(500)
  }

  await expect(page.getByTestId("planner-artwork-picker-dialog")).toHaveCount(0, { timeout: 30_000 })
  await expect(page.locator("body")).not.toContainText(/Pick an artwork before releasing/i)
  await expect(page.locator("body")).not.toContainText(/ARTWORK_REQUIRED/)
})
