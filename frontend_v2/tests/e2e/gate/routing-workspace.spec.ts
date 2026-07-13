import { expect } from "@playwright/test"
import { test } from "../support/base"
import { annotate, assertHealthyPage } from "../support/test-helpers"

test("routing studio remains responsive with a large route catalog", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Engineering",
    severity: "high",
    role: "ADMIN",
    feature: "Routing catalog scale",
    expected: "The route catalog renders a bounded first page and keeps every route searchable without freezing the shell.",
  })

  await page.goto("/engineering/routing", { waitUntil: "domcontentloaded" })
  await assertHealthyPage(page, { requireAuth: true, requireRoleSwitcher: true })

  const cards = page.getByTestId("routing-rule-card")
  await expect(cards.first()).toBeVisible()
  expect(await cards.count()).toBeLessThanOrEqual(24)
  await expect(page.getByTestId("routing-rule-visible-count")).toContainText(/Showing \d+ of \d+/)

  const firstRouteName = (await cards.first().getByTestId("routing-rule-name").textContent())?.trim()
  expect(firstRouteName).toBeTruthy()
  await page.getByTestId("routing-rule-search").fill(String(firstRouteName))
  await expect(cards.first()).toContainText(String(firstRouteName))
  expect(await cards.count()).toBeLessThanOrEqual(24)
})
