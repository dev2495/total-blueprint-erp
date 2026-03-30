import fs from "node:fs"
import path from "node:path"
import { test, expect } from "../support/base"
import { annotate, assertHealthyPage } from "../support/test-helpers"

function readPlannerGateSeed() {
  const filePath = path.resolve(process.cwd(), "../.runtime/ui-e2e/planner-gate-seed.json")
  if (!fs.existsSync(filePath)) return null
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as {
    order_id?: string
    order_number?: string
    order_name?: string
  }
}

test("planner can resolve a deferred artwork gate from the queue", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Planner",
    severity: "critical",
    feature: "Deferred artwork assignment",
    expected: "Planner should find a queued sales row with artwork gate, assign approved artwork, and clear the artwork blocker.",
  })

  await page.goto("/production/planner")
  await assertHealthyPage(page)
  await page.getByTestId("planner-filter-all").click().catch(() => undefined)
  await expect(page.getByText(/Loading planner truth/i)).toHaveCount(0, { timeout: 30_000 })

  const seed = readPlannerGateSeed()
  let selectedRowKey: string | null = null
  if (seed?.order_id) {
    selectedRowKey = `sales:${seed.order_id}`
    const seededRow = page.getByTestId(`planner-queue-row-${selectedRowKey}`)
    await expect(seededRow).toBeVisible({ timeout: 30_000 })
    await page.getByTestId(`planner-toggle-details-${selectedRowKey}`).click()
    await page.waitForTimeout(300)
  } else if (seed?.order_number) {
    await expect(page.locator("[data-testid^='planner-queue-row-']").first()).toBeVisible({ timeout: 30_000 })
    const seededText = page.getByText(new RegExp(seed.order_number, "i"))
    if (await seededText.count()) {
      const row = seededText.first().locator("xpath=ancestor-or-self::*[@data-testid][starts-with(@data-testid, 'planner-queue-row-')]").first()
      const testId = await row.getAttribute("data-testid")
      selectedRowKey = testId?.replace("planner-queue-row-", "") || null
      if (selectedRowKey) {
        await page.getByTestId(`planner-toggle-details-${selectedRowKey}`).click()
      }
      await page.waitForTimeout(300)
    }
  }

  const rows = page.locator("[data-testid^='planner-queue-row-']")
  await expect(rows.first()).toBeVisible({ timeout: 30_000 })
  const rowCount = await rows.count()
  let gateFound = selectedRowKey
    ? await page.getByTestId(`planner-artwork-gate-${selectedRowKey}`).isVisible().catch(() => false)
    : false

  if (!gateFound) {
    for (let index = 0; index < rowCount; index += 1) {
      const testId = await rows.nth(index).getAttribute("data-testid")
      const rowKey = testId?.replace("planner-queue-row-", "")
      if (!rowKey || rowKey === selectedRowKey) continue
      await page.getByTestId(`planner-toggle-details-${rowKey}`).click()
      await page.waitForTimeout(300)
      if (await page.getByTestId(`planner-artwork-gate-${rowKey}`).isVisible().catch(() => false)) {
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

  const selectedArtwork = await page.getByTestId(`planner-approved-artwork-select-${selectedRowKey}`).click()
    .then(async () => {
      const preferredOption = page.getByRole("option", { name: /UAT-GREEN Deferred Artwork|UI E2E Deferred Artwork/i })
      const option = (await preferredOption.count()) > 0 ? preferredOption.first() : page.getByRole("option").first()
      const optionText = (await option.textContent())?.trim() || ""
      await option.click()
      return optionText
    })
  expect(selectedArtwork).not.toEqual("")
  await expect(page.getByTestId(`planner-assign-artwork-${selectedRowKey}`)).toBeEnabled()
  await page.getByTestId(`planner-assign-artwork-${selectedRowKey}`).click()

  if (selectedRowKey) {
    await page.getByTestId("planner-filter-all").click().catch(() => undefined)
    await page.waitForTimeout(500)
  }

  await expect(page.getByTestId(`planner-artwork-gate-${selectedRowKey}`)).toHaveCount(0, { timeout: 30_000 })
  await expect(page.locator("body")).not.toContainText(/ARTWORK_REQUIRED/)
})
