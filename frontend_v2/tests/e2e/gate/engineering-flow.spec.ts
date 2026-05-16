import path from "node:path"
import { test, expect } from "../support/base"
import { annotate, assertHealthyPage } from "../support/test-helpers"

async function selectRadixOption(page: import("@playwright/test").Page, triggerTestId: string, optionText: string) {
  await page.getByTestId(triggerTestId).click()
  await page.getByRole("option", { name: optionText }).click()
}

async function selectFirstRadixOption(page: import("@playwright/test").Page, triggerTestId: string) {
  await page.getByTestId(triggerTestId).click()
  const options = page.getByRole("option")
  await expect(options.nth(1)).toBeVisible({ timeout: 30_000 })
  await options.nth(1).click()
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
  const reuseArtworkCode = `${artworkCode}-REUSE`
  const reuseArtworkName = `UI E2E Reuse ${stamp}`
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
  await page.getByTestId("artwork-ink-gsm-total").fill("1.2")
  await page.getByTestId("artwork-cylinder-circumference").fill("420")
  await page.getByTestId("artwork-cylinder-length").fill("540")
  await page.getByTestId("artwork-save-draft").click()

  await expect(page.getByTestId("artwork-dialog")).toBeHidden({ timeout: 30_000 })
  await page.getByPlaceholder(/Search design code, artwork name, print type, or status/i).fill(artworkCode)
  await page.locator("button").filter({ hasText: artworkCode }).first().click()
  await page.getByTestId("artwork-dialog").waitFor({ state: "visible" })
  const cylinderActions = page.getByTestId("artwork-cylinder-color-actions")
  const generateButton = page.getByTestId("artwork-generate-cylinder-FRONT-1")
  await expect(generateButton).toBeVisible({ timeout: 30_000 })
  await Promise.all([
    page.waitForResponse((response) => response.url().includes("/generate-cylinders") && response.status() === 200, { timeout: 30_000 }),
    generateButton.click(),
  ])
  await expect(page.getByTestId("artwork-approval-blockers")).toContainText(/Missing finalized|Finalize technical data/i, { timeout: 30_000 })
  await expect(page.getByTestId("artwork-approve")).toBeDisabled()
  await expect(page.getByTestId("artwork-cylinder-color-actions")).toContainText(/finish generated drafts in cylinder catalog/i)
  await expect(page.getByTestId("artwork-finalize-generated-cylinders")).toHaveCount(0)
  await page.getByRole("button", { name: /cancel/i }).click()

  await page.goto("/engineering/cylinders")
  await assertHealthyPage(page)
  await page.getByPlaceholder(/Search cylinder code, artwork, color, lifecycle, or storage/i).fill(artworkName)
  await expect(page.locator("body")).toContainText(artworkName, { timeout: 30_000 })
  await page.getByRole("button", { name: /manage slots/i }).first().click()
  await page.getByTestId("cylinder-artwork-group-dialog").waitFor({ state: "visible", timeout: 30_000 })
  await expect(page.getByTestId("cylinder-artwork-group-dialog")).toContainText(/cylinder map/i)
  await expect(page.getByTestId("cylinder-slot-FRONT-1")).toContainText(/draft generated/i)
  await expect(page.getByTestId("cylinder-slot-FRONT-1")).toContainText(/reuse is filtered by 420 × 540 mm/i)
  await expect(page.getByTestId("cylinder-finalize-slot-FRONT-1")).toBeVisible()
  await selectFirstRadixOption(page, "cylinder-finalize-vendor")
  await selectFirstRadixOption(page, "cylinder-finalize-location")
  await Promise.all([
    page.waitForResponse((response) => response.url().includes("/api/tooling/cylinders/") && response.status() === 200, { timeout: 30_000 }),
    page.getByTestId("cylinder-finalize-slot-FRONT-1").click(),
  ])
  await expect(page.getByTestId("cylinder-slot-FRONT-1")).toContainText(/slot complete/i, { timeout: 30_000 })
  await page.keyboard.press("Escape")

  await page.goto("/engineering/artworks")
  await assertHealthyPage(page)
  await page.getByPlaceholder(/Search design code, artwork name, print type, or status/i).fill(artworkCode)
  await page.locator("button").filter({ hasText: artworkCode }).first().click()
  await page.getByTestId("artwork-dialog").waitFor({ state: "visible" })
  await expect(page.getByTestId("artwork-approval-blockers")).toHaveCount(0)
  await expect(page.getByTestId("artwork-approve")).toBeEnabled()
  await Promise.all([
    page.waitForResponse((response) => response.url().includes("/approve/") && response.status() === 200, { timeout: 30_000 }),
    page.getByTestId("artwork-approve").click(),
  ])
  await expect(page.getByTestId("artwork-dialog")).toBeHidden({ timeout: 30_000 })

  await page.goto("/engineering/artworks")
  await assertHealthyPage(page)
  await page.getByTestId("artwork-upload-button").click()
  await page.getByTestId("artwork-dialog").waitFor({ state: "visible" })
  await page.getByTestId("artwork-design-code").fill(reuseArtworkCode)
  await page.getByTestId("artwork-name").fill(reuseArtworkName)
  await selectRadixOption(page, "artwork-print-type", "ROTO")
  await page.getByTestId("artwork-image-input").setInputFiles(sampleImage)
  await page.getByTestId("artwork-add-front-color").click()
  await page.getByTestId("artwork-add-front-color").click()
  await page.getByTestId("artwork-ink-gsm-total").fill("1.2")
  await page.getByTestId("artwork-cylinder-circumference").fill("420")
  await page.getByTestId("artwork-cylinder-length").fill("540")
  await page.getByTestId("artwork-save-draft").click()

  await expect(page.getByTestId("artwork-dialog")).toBeHidden({ timeout: 30_000 })
  await page.getByPlaceholder(/Search design code, artwork name, print type, or status/i).fill(reuseArtworkCode)
  await page.locator("button").filter({ hasText: reuseArtworkCode }).first().click()
  await page.getByTestId("artwork-dialog").waitFor({ state: "visible" })
  await Promise.all([
    page.waitForResponse((response) => response.url().includes("/generate-cylinders") && response.status() === 200, { timeout: 30_000 }),
    page.getByTestId("artwork-generate-cylinder-FRONT-2").click(),
  ])
  await expect(page.getByTestId("artwork-cylinder-color-actions")).toContainText(/finish generated drafts in cylinder catalog/i)
  await page.getByRole("button", { name: /cancel/i }).click()

  await page.goto("/engineering/cylinders")
  await assertHealthyPage(page)
  await page.getByPlaceholder(/Search cylinder code, artwork, color, lifecycle, or storage/i).fill(reuseArtworkName)
  await expect(page.locator("body")).toContainText(reuseArtworkName, { timeout: 30_000 })
  await page.getByRole("button", { name: /manage slots/i }).first().click()
  await page.getByTestId("cylinder-artwork-group-dialog").waitFor({ state: "visible", timeout: 30_000 })
  await expect(page.getByTestId("cylinder-slot-FRONT-1")).toContainText(/empty slot/i)
  await expect(page.getByTestId("cylinder-slot-FRONT-2")).toContainText(/draft generated/i)
  await page.getByTestId("cylinder-reuse-FRONT-1").click()
  await expect(page.getByRole("option").nth(1)).toContainText(/420×540|420 × 540/i, { timeout: 30_000 })
  await page.getByRole("option").nth(1).click()
  await Promise.all([
    page.waitForResponse((response) => response.url().includes("/api/tooling/cylinder-slot-assignments/") && response.status() === 201, { timeout: 30_000 }),
    page.getByTestId("cylinder-use-slot-FRONT-1").click(),
  ])
  await expect(page.getByTestId("cylinder-slot-FRONT-1")).toContainText(/slot complete/i, { timeout: 30_000 })
  await selectFirstRadixOption(page, "cylinder-finalize-vendor")
  await selectFirstRadixOption(page, "cylinder-finalize-location")
  await Promise.all([
    page.waitForResponse((response) => response.url().includes("/api/tooling/cylinders/") && response.status() === 200, { timeout: 30_000 }),
    page.getByTestId("cylinder-finalize-slot-FRONT-2").click(),
  ])
  await expect(page.getByTestId("cylinder-slot-FRONT-2")).toContainText(/slot complete/i, { timeout: 30_000 })
  await page.keyboard.press("Escape")

  await page.goto("/engineering/artworks")
  await assertHealthyPage(page)
  await page.getByPlaceholder(/Search design code, artwork name, print type, or status/i).fill(reuseArtworkCode)
  await page.locator("button").filter({ hasText: reuseArtworkCode }).first().click()
  await page.getByTestId("artwork-dialog").waitFor({ state: "visible" })
  await expect(page.getByTestId("artwork-approval-blockers")).toHaveCount(0)
  await expect(page.getByTestId("artwork-approve")).toBeEnabled()
  await Promise.all([
    page.waitForResponse((response) => response.url().includes("/approve/") && response.status() === 200, { timeout: 30_000 }),
    page.getByTestId("artwork-approve").click(),
  ])
  await expect(page.getByTestId("artwork-dialog")).toBeHidden({ timeout: 30_000 })
})

test("artwork dialog blocks cylinder generation until print colors are assigned", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Engineering",
    severity: "high",
    feature: "Artwork color readiness",
    expected: "Users should see the missing-color blocker before generating cylinders or attempting approval.",
  })

  const stamp = Date.now()
  const sampleImage = path.resolve(process.cwd(), "tests/e2e/fixtures/artwork-sample.png")

  await page.goto("/engineering/artworks")
  await assertHealthyPage(page)
  await page.getByTestId("artwork-upload-button").click()
  await page.getByTestId("artwork-dialog").waitFor({ state: "visible" })
  await page.getByTestId("artwork-design-code").fill(`UIE2E-NOCOLOR-${String(stamp).slice(-6)}`)
  await page.getByTestId("artwork-name").fill(`UI E2E Missing Color ${stamp}`)
  await selectRadixOption(page, "artwork-print-type", "ROTO")
  await page.getByTestId("artwork-image-input").setInputFiles(sampleImage)

  await expect(page.getByTestId("artwork-approval-blockers")).toContainText(/at least one front(?: or back)? print color/i)
  await expect(page.getByTestId("artwork-roto-checklist")).toContainText(/BLOCK: At least one print color assigned/i)
  await expect(page.getByTestId("artwork-cylinder-color-actions")).toContainText(/Add print colors before generating cylinders/i)
})
