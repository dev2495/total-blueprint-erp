import { test, expect } from "../support/base"
import { annotate, assertHealthyPage, fetchJson, unwrapApiList } from "../support/test-helpers"

test("machine master create flow saves when cost group inherits from work center", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Masters",
    severity: "critical",
    feature: "Machine CRUD",
    expected: "An admin should be able to create a machine while leaving the machine cost group on the inherited default.",
  })

  const stamp = Date.now()
  const machineCode = `UIE2E-MC-${String(stamp).slice(-6)}`
  const machineName = `UI E2E Machine ${stamp}`

  const workCentersResponse = await fetchJson<any>(page, "/api/factory/work-centers/")
  expect(workCentersResponse.status).toBe(200)
  const workCenters = unwrapApiList<any>(workCentersResponse.data)
  const workCenter = workCenters[0]
  expect(workCenter).toBeTruthy()

  await page.goto("/factory/machines", { waitUntil: "domcontentloaded" })
  await assertHealthyPage(page)
  await page.getByRole("button", { name: /add machine/i }).click()
  await page.getByRole("dialog").waitFor({ state: "visible", timeout: 30_000 })

  await page.getByLabel("Work Center").click()
  await page.getByRole("option", { name: new RegExp(String(workCenter.name), "i") }).first().click()
  await page.getByLabel("Machine Code").fill(machineCode)
  await page.getByLabel("Machine Name").fill(machineName)
  await page.getByRole("button", { name: /^Save$/i }).click()

  await expect(page.getByRole("dialog")).toBeHidden({ timeout: 30_000 })
  await page.getByPlaceholder(/search machines/i).fill(machineCode)
  await expect(page.locator("body")).toContainText(machineCode, { timeout: 30_000 })
  await expect(page.locator("body")).toContainText(machineName, { timeout: 30_000 })
})
