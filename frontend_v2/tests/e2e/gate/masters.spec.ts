import { test, expect } from "../support/base"
import { annotate, assertHealthyPage } from "../support/test-helpers"

test("plant master create flow saves and refreshes in UI", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Masters",
    severity: "critical",
    feature: "Plant CRUD",
    expected: "An admin should be able to create a plant from the plant master dialog and see it in the list.",
  })

  const stamp = Date.now()
  const plantCode = `UIE2E-${String(stamp).slice(-6)}`
  const plantName = `UI E2E Plant ${stamp}`

  await page.goto("/factory/plants")
  await assertHealthyPage(page)
  await page.getByTestId("plants-add-button").click()
  await page.getByTestId("plants-dialog").waitFor({ state: "visible" })

  await page.getByLabel("Plant Code").fill(plantCode)
  await page.getByLabel("Plant Name").fill(plantName)
  await page.getByLabel("Legal Name").fill(`${plantName} Legal`)
  await page.getByLabel("GSTIN").fill(`24ABCDE${String(stamp).slice(-5)}F1Z5`)
  await page.getByLabel("Address").fill("UI E2E legal address")
  await page.getByLabel("Phone").fill("9999999999")
  await page.getByLabel("Email").fill("uie2e@example.com")
  await page.getByLabel("Authorized Signatory").fill("UI E2E")
  await page.getByLabel("Designation").fill("Owner")
  await page.getByTestId("plants-save").click()

  await expect(page.getByTestId("plants-dialog")).toBeHidden({ timeout: 30_000 })
  await expect(page.getByText(plantName)).toBeVisible({ timeout: 30_000 })
})
