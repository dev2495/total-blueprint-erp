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

test("stock lifecycle cockpit exposes the mockup tabs and analytics shell", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Inventory",
    severity: "high",
    role: "STORE",
    feature: "Stock lifecycle cockpit",
    expected: "The canonical stock lifecycle route should render the five-tab cockpit with overview analytics, snapshots, stock card drill, and no page overflow.",
  })

  await switchRole(page, "Store", "/inventory/stock-lifecycle", { allowCookieFallback: true })
  await page.goto("/inventory/stock-lifecycle", { waitUntil: "domcontentloaded" })
  await assertHealthyPage(page, { requireAuth: true })
  await expect(page.getByTestId("stock-lifecycle-cockpit")).toBeVisible()
  await expectNoPageOverflow(page)

  await expect(page.locator("body")).toContainText("Stock Lifecycle · Inventory Control Cockpit")
  await expect(page.locator("body")).toContainText("Open · Count · Close")
  await expect(page.getByRole("button", { name: /Overview/i })).toBeVisible()
  await expect(page.getByRole("button", { name: /Open stock/i })).toBeVisible()
  await expect(page.getByRole("button", { name: /Physical count/i })).toBeVisible()
  await expect(page.getByRole("button", { name: /FY close/i })).toBeVisible()
  await expect(page.getByRole("button", { name: /Month close & history/i })).toBeVisible()
  await expect(page.locator("body")).toContainText("Value by class")
  await expect(page.locator("body")).toContainText("Movement this period")
  await expect(page.locator("body")).toContainText("Dead stock")

  await page.getByRole("button", { name: /Month close & history/i }).click()
  await expect(page.locator("body")).toContainText("Monthly close tracker")
  await expect(page.locator("body")).toContainText("Stock card drill")
  await expectNoPageOverflow(page)

  await page.getByRole("button", { name: /Open stock/i }).click()
  await expect(page.locator("body")).toContainText("Live backend workflow")
  await page.getByRole("button", { name: /Physical count/i }).click()
  await expect(page.locator("body")).toContainText("Physical count")
  await page.getByRole("button", { name: /FY close/i }).click()
  await expect(page.locator("body")).toContainText("FY close")
})

test("legacy stock lifecycle routes redirect into the canonical cockpit", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Inventory",
    severity: "medium",
    role: "STORE",
    feature: "Stock lifecycle canonical routing",
    expected: "Deprecated inventory period and count routes should redirect into /inventory/stock-lifecycle with the equivalent cockpit tab.",
  })

  await switchRole(page, "Store", "/inventory/stock-lifecycle", { allowCookieFallback: true })

  await page.goto("/inventory/period", { waitUntil: "domcontentloaded" })
  await expect(page).toHaveURL(/\/inventory\/stock-lifecycle\?tab=close$/)
  await expect(page.getByTestId("stock-lifecycle-cockpit")).toBeVisible()
  await expect(page.locator("body")).toContainText("FY close")

  await page.goto("/inventory/count", { waitUntil: "domcontentloaded" })
  await expect(page).toHaveURL(/\/inventory\/stock-lifecycle\?tab=count$/)
  await expect(page.getByTestId("stock-lifecycle-cockpit")).toBeVisible()
  await expect(page.locator("body")).toContainText("Physical count")
})
