import path from "node:path"
import { test, expect } from "../support/base"
import { annotate, assertHealthyPage } from "../support/test-helpers"

async function selectRadixOption(page: import("@playwright/test").Page, triggerTestId: string, optionText: string) {
  await page.getByTestId(triggerTestId).click()
  await page.getByRole("option", { name: optionText }).click()
}

test("roto artwork stays blocked until cylinders are finalized", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Engineering",
    severity: "critical",
    feature: "Artwork/Cylinder gate",
    expected: "ROTO artwork approval remains blocked after draft generation until cylinder technical finalization is complete.",
  })

  const stamp = Date.now()
  const artworkCode = `UIE2E-ART-${String(stamp).slice(-6)}`
  const artworkName = `UI E2E Artwork ${stamp}`
  const sampleImage = path.resolve(process.cwd(), "tests/e2e/fixtures/artwork-sample.png")

  await page.goto("/engineering/artworks")
  await assertHealthyPage(page)
  await page.getByTestId("artwork-upload-button").click()
  await page.getByTestId("artwork-dialog").waitFor({ state: "visible" })
  await page.getByTestId("artwork-design-code").fill(artworkCode)
  await page.getByTestId("artwork-name").fill(artworkName)
  await selectRadixOption(page, "artwork-print-type", "ROTO")
  await page.getByTestId("artwork-image-input").setInputFiles(sampleImage)
  await page.getByTestId("artwork-add-front-color").click()
  await page.getByTestId("artwork-save-draft").click()

  await expect(page.getByTestId("artwork-dialog")).toBeHidden({ timeout: 30_000 })
  await page.getByPlaceholder("Search artwork...").fill(artworkCode)
  await page.getByRole("row", { name: new RegExp(artworkCode) }).click()
  await page.getByTestId("artwork-dialog").waitFor({ state: "visible" })
  await page.getByTestId("artwork-generate-cylinders").click()
  await expect(page.getByTestId("artwork-approval-blockers")).toContainText(/Missing finalized|Finalize technical data/i, { timeout: 30_000 })
  await expect(page.getByTestId("artwork-approve")).toBeDisabled()
  await page.getByRole("button", { name: /cancel/i }).click()

  await page.goto("/engineering/cylinders")
  await assertHealthyPage(page)
  await page.getByTestId("cylinders-search").fill(artworkName)
  const row = page.getByRole("row", { name: new RegExp(artworkName) }).first()
  await row.locator("button").first().click()
  await page.getByTestId("cylinder-dialog").waitFor({ state: "visible" })
  await selectRadixOption(page, "cylinder-lifecycle-mode", "PRODUCTION")
  await page.getByTestId("cylinder-submit").click()
  await expect(page.getByTestId("cylinder-finalization-checklist")).toContainText(/Cell Depth|Vendor/i)
  await expect(page.getByTestId("cylinder-dialog")).toBeVisible()
})
