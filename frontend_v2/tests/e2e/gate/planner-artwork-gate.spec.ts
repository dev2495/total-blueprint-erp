import fs from "node:fs"
import path from "node:path"
import { test, expect } from "../support/base"
import { annotate, assertHealthyPage } from "../support/test-helpers"

function readPlannerGateSeed() {
  const filePath = path.resolve(process.cwd(), "../.runtime/ui-e2e/planner-gate-seed.json")
  if (!fs.existsSync(filePath)) return null
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as {
    order_number?: string
    order_name?: string
  }
}

async function selectFirstPlannerArtwork(page: import("@playwright/test").Page) {
  await page.getByTestId("planner-approved-artwork-select").click()
  const preferredOption = page.getByRole("option", { name: /UI E2E Deferred Artwork/i })
  const option = (await preferredOption.count()) > 0 ? preferredOption.first() : page.getByRole("option").first()
  const optionText = (await option.textContent())?.trim() || ""
  await option.click()
  return optionText
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

  const seed = readPlannerGateSeed()
  if (seed?.order_number) {
    await page.getByRole("button", { name: new RegExp(seed.order_number, "i") }).click()
    await page.waitForTimeout(300)
  }

  const rows = page.locator("[data-testid^='planner-queue-row-']")
  const rowCount = await rows.count()
  let gateFound = await page.getByTestId("planner-artwork-gate").isVisible().catch(() => false)

  if (!gateFound) {
    for (let index = 0; index < rowCount; index += 1) {
      await rows.nth(index).click()
      await page.waitForTimeout(300)
      if (await page.getByTestId("planner-artwork-gate").isVisible().catch(() => false)) {
        gateFound = true
        break
      }
    }
  }

  expect(gateFound, "No planner artwork gate row was visible in the seeded queue.").toBeTruthy()
  await expect(page.getByTestId("planner-artwork-gate")).toBeVisible()

  const selectedArtwork = await selectFirstPlannerArtwork(page)
  expect(selectedArtwork).not.toEqual("")
  await expect(page.getByTestId("planner-assign-artwork")).toBeEnabled()
  await page.getByTestId("planner-assign-artwork").click()

  await expect(page.getByTestId("planner-artwork-gate")).toBeHidden({ timeout: 30_000 })
  await expect(page.locator("body")).not.toContainText(/ARTWORK_REQUIRED/)
})
