import { expect, type Page } from "@playwright/test"
import { test } from "../support/base"
import { annotate, assertHealthyPage, switchRole } from "../support/test-helpers"

async function expectNoPageOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const documentElement = document.documentElement
    const body = document.body
    return {
      viewport: documentElement.clientWidth,
      documentScrollWidth: documentElement.scrollWidth,
      bodyScrollWidth: body.scrollWidth,
      offenders: Array.from(document.querySelectorAll("body *"))
        .map((element) => {
          const rect = element.getBoundingClientRect()
          return {
            tag: element.tagName,
            className: element.getAttribute("class") || "",
            right: Math.round(rect.right),
            left: Math.round(rect.left),
            width: Math.round(rect.width),
          }
        })
        .filter((item) => item.right > documentElement.clientWidth + 2 && item.width > 0)
        .slice(0, 8),
    }
  })
  expect(overflow.documentScrollWidth, JSON.stringify(overflow, null, 2)).toBeLessThanOrEqual(overflow.viewport + 2)
  expect(overflow.bodyScrollWidth, JSON.stringify(overflow, null, 2)).toBeLessThanOrEqual(overflow.viewport + 2)
}

test("stock lifecycle workspace combines period close audit count and opening wizard", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Inventory",
    severity: "high",
    role: "STORE",
    feature: "V36 period workspace",
    expected: "Stock lifecycle should be one polished V36 period workspace with audit batches, close preview, and opening stock entry points.",
  })

  await switchRole(page, "Store", "/inventory/period", { allowCookieFallback: true })
  await page.goto("/inventory/period", { waitUntil: "domcontentloaded" })
  await assertHealthyPage(page, { requireAuth: true })
  await expect(page.getByTestId("stock-lifecycle-workspace")).toBeVisible()
  await expectNoPageOverflow(page)
  await expect(page.locator("body")).toContainText(/Stock Lifecycle/i)
  await expect(page.locator("body")).toContainText("FY timeline")
  await expect(page.locator("body")).toContainText("Audit → Variance → Approve → Close")
  await expect(page.locator("body")).toContainText("Count entry desk")
  await expect(page.locator("body")).toContainText("Stock counts")
  await expect(page.locator("body")).toContainText("Opening stock wizard")
  await expect(page.locator("body")).toContainText("Past audits & closes")

  await page.goto("/help?route=%2Finventory%2Fperiod", { waitUntil: "domcontentloaded" })
  await assertHealthyPage(page, { requireAuth: true })
  await expectNoPageOverflow(page)
  await expect(page.locator("body")).toContainText("Period & Audit")
  await expect(page.locator("body")).toContainText(/Stock Lifecycle/i)

  await page.goto("/inventory/period", { waitUntil: "domcontentloaded" })
  const inventoryWorkspaceIcon = page.getByTestId("sidebar-link-inventory").first()
  await expect(inventoryWorkspaceIcon).toBeVisible()
  await expect(page.locator("main").getByRole("link", { name: /Stock Lifecycle/i })).toBeVisible()
  await expect(page.getByTestId("sidebar-link-inventory-stock-lifecycle")).toHaveCount(0)
  await expect(page.getByTestId("sidebar-link-inventory-opening-stock")).toHaveCount(0)
  await expect(page.getByTestId("sidebar-link-inventory-stock-count")).toHaveCount(0)
  await expect(page.getByTestId("sidebar-link-inventory-year-close")).toHaveCount(0)
  await expect(page.getByTestId("sidebar-link-inventory-fy-correction")).toHaveCount(0)
  await expect(page.getByTestId("sidebar-link-inventory-stock-card")).toHaveCount(0)
})

test("stock lifecycle canonical tabs load inside the unified workspace", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Inventory",
    severity: "medium",
    role: "STORE",
    feature: "Stock lifecycle canonical tabs",
    expected: "Current stock lifecycle tabs should load directly inside the unified workspace without legacy route wrappers.",
  })

  await switchRole(page, "Store", "/inventory/period", { allowCookieFallback: true })

  const tabs = [
    "/inventory/period",
    "/inventory/period?tab=opening",
    "/inventory/period?tab=count",
    "/inventory/period?tab=stockcard",
    "/inventory/period?tab=yearclose",
    "/inventory/period?tab=correction",
  ]

  for (const route of tabs) {
    await page.goto(route, { waitUntil: "domcontentloaded" })
    await expect(page).toHaveURL(new RegExp(route.replace("?", "\\?")))
    await expect(page.getByTestId("stock-lifecycle-workspace")).toBeVisible()
  }
})
