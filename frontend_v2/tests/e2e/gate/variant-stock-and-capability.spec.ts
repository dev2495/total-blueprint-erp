import { test, expect } from "../support/base"
import { annotate, assertHealthyPage, loginViaUi, switchRole } from "../support/test-helpers"

test("roll explorer defaults to a business-friendly by-variant stock view", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Variant Stock",
    severity: "high",
    role: "STORE",
    feature: "Family to variant roll intelligence",
    expected: "The explorer should default to a family-first variant view and show readable stock naming without flattening everything into stage rows.",
  })

  await loginViaUi(page)
  await switchRole(page, "Store", "/inventory/roll-explorer")
  await page.goto("/inventory/roll-explorer")
  await assertHealthyPage(page)
  await expect(page.getByRole("tab", { name: /by variant/i })).toHaveAttribute("data-state", "active")
  await expect(page.locator("body")).toContainText("Business Family")
  const variantResponsePromise = page.waitForResponse(
    (response) => response.url().includes("/api/inventory/rolls/by-variant/") && response.request().method() === "GET",
  )
  await page.reload({ waitUntil: "domcontentloaded" })
  const variantResponse = await variantResponsePromise
  expect(variantResponse.status()).toBe(200)
  await expect(page.locator("body")).toContainText("Family Contribution")
  await expect(page.locator("body")).toContainText(/usable sizes/i)
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
