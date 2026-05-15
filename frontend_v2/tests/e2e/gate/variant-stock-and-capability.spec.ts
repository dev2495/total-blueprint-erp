import { test, expect } from "../support/base"
import { annotate, assertHealthyPage, loginViaUi, switchRole } from "../support/test-helpers"

test("rolls workspace defaults to a business-friendly by-variant stock view", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Variant Stock",
    severity: "high",
    role: "STORE",
    feature: "Family to variant roll intelligence",
    expected: "The rolls workspace should default to a family-first variant view and show readable stock naming without flattening everything into stage rows.",
  })

  await loginViaUi(page)
  await switchRole(page, "Store", "/inventory/rolls-v36")
  await page.goto("/inventory/rolls-v36")
  await assertHealthyPage(page)
  await expect(page.getByRole("heading", { name: /roll workspace/i })).toBeVisible()
  await expect(page.locator("body")).toContainText(/Variant × thickness/i)
  const rollSnapshotResponsePromise = page.waitForResponse(
    (response) => response.url().includes("/api/inventory/snapshot/") && response.request().method() === "GET",
  )
  await page.reload({ waitUntil: "domcontentloaded" })
  const rollSnapshotResponse = await rollSnapshotResponsePromise
  expect(rollSnapshotResponse.status()).toBe(200)
  await expect(page.locator("body")).toContainText("Variant / family")
  await expect(page.locator("body")).toContainText(/Top variants by KG/i)
  await expect(page.locator("body")).toContainText(/kg/i)
})

test("capability matrix explains config-only vs code-required boundaries", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Capability Matrix",
    severity: "medium",
    role: "ADMIN",
    feature: "Honest extensibility boundary",
    expected: "The matrix should be readable in the ERP and clearly separate supported, config-only, and new-logic-required capabilities.",
  })

  await loginViaUi(page)
  await switchRole(page, "Admin", "/dashboard/admin")
  const capabilityResponsePromise = page.waitForResponse(
    (response) => response.url().includes("/api/analytics/capability-matrix/") && response.request().method() === "GET",
  )
  await page.goto("/analytics/capability-matrix")
  await assertHealthyPage(page)
  const capabilityResponse = await capabilityResponsePromise
  expect(capabilityResponse.status()).toBe(200)
  const capabilityPayload = (await capabilityResponse.json()) as {
    version: string
    sections: Array<{ label: string }>
  }
  const labels = capabilityPayload.sections.map((section) => section.label.toLowerCase())
  expect(labels.some((label) => label.includes("supported"))).toBeTruthy()
  expect(labels.some((label) => label.includes("config"))).toBeTruthy()
  expect(labels.some((label) => label.includes("new physical logic"))).toBeTruthy()

  await expect(page.locator("body")).toContainText("What this ERP can support today, by config, or only with new logic")
  await expect(page.locator("body")).toContainText(/supported today/i)
  await expect(page.locator("body")).toContainText(/needs new physical logic/i)
})
