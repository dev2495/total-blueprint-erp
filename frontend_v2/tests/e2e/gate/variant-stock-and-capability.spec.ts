import { test, expect } from "../support/base"
import { annotate, assertHealthyPage, fetchJson } from "../support/test-helpers"

test("roll explorer defaults to a business-friendly by-variant stock view", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Variant Stock",
    severity: "high",
    role: "STORE",
    feature: "Family to variant roll intelligence",
    expected: "The explorer should default to a family-first variant view and show readable stock naming without flattening everything into stage rows.",
  })

  await page.goto("/inventory/roll-explorer")
  await assertHealthyPage(page)
  await expect(page.getByRole("tab", { name: /by variant/i })).toHaveAttribute("data-state", "active")
  await expect(page.locator("body")).toContainText("Business Family")

  const response = await fetchJson<{ families: Array<{ family_display_name: string }> }>(page, "/api/inventory/rolls/by-variant/")
  expect(response.status).toBe(200)
  expect(response.data.families.length).toBeGreaterThan(0)
  await expect(page.locator("body")).toContainText(response.data.families[0].family_display_name)
})

test("capability matrix explains config-only vs code-required boundaries", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Capability Matrix",
    severity: "medium",
    role: "ADMIN",
    feature: "Honest extensibility boundary",
    expected: "The matrix should be readable in the ERP and clearly separate supported, config-only, and new-logic-required capabilities.",
  })

  await page.goto("/analytics/capability-matrix")
  await assertHealthyPage(page)

  const response = await fetchJson<{
    version: string
    sections: Array<{ label: string }>
  }>(page, "/api/analytics/capability-matrix/")
  expect(response.status).toBe(200)
  const labels = response.data.sections.map((section) => section.label.toLowerCase())
  expect(labels.some((label) => label.includes("supported"))).toBeTruthy()
  expect(labels.some((label) => label.includes("config"))).toBeTruthy()
  expect(labels.some((label) => label.includes("new physical logic"))).toBeTruthy()

  await expect(page.locator("body")).toContainText("What this ERP can support today, by config, or only with new logic")
  await expect(page.locator("body")).toContainText(/supported today/i)
  await expect(page.locator("body")).toContainText(/needs new physical logic/i)
})
