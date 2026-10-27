import { expect, test } from "../support/base"
import { annotate, assertHealthyPage } from "../support/test-helpers"

test("help guide opens for everyone, switches to Hindi, searches and shows a page guide", async ({ browser, baseURL }, testInfo) => {
  annotate(testInfo, {
    module: "Help",
    severity: "high",
    role: "PUBLIC",
    feature: "Shareable help guide",
    expected: "/guide opens without signing in, has English and Hindi, finds screens by search and shows the steps of a page.",
  })
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
  const page = await context.newPage()
  await page.goto("/guide")
  await expect(page).toHaveURL(/\/guide/)
  await expect(page.getByTestId("guide-root")).toBeVisible({ timeout: 30_000 })
  await expect(page.locator("body")).toContainText("Every screen and every job")
  await expect(page.getByTestId("guide-module-sales")).toBeVisible()

  await page.getByTestId("guide-language").getByRole("link", { name: "हिंदी" }).click()
  await expect(page).toHaveURL(/lang=hi/)
  await expect(page.locator("body")).toContainText("हर स्क्रीन, हर काम")

  await page.getByTestId("guide-search").fill("dispatch")
  await expect(page.getByRole("option").first()).toBeVisible()

  await page.goto("/guide?page=sales-orders-create")
  await expect(page.getByTestId("guide-page-view")).toBeVisible()
  await expect(page.getByTestId("guide-page-view")).toContainText("/sales/orders/create")
  await expect(page.getByTestId("guide-share")).toBeVisible()
  await context.close()
})

test("help inside the ERP shows the same guide and the header Help loads the page's guide", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Help",
    severity: "medium",
    role: "ADMIN",
    feature: "In-app help and context help",
    expected: "/help shows the guide in the app frame; the header Help button opens the guide of the current page.",
  })
  await page.goto("/help?page=logistics-dispatch")
  await assertHealthyPage(page)
  await expect(page.getByTestId("guide-page-view")).toContainText("/logistics/dispatch", { timeout: 30_000 })

  await page.goto("/sales/orders")
  await assertHealthyPage(page)
  // The header renders a desktop and a compact Help button; use the one on screen.
  await page.locator('[data-testid="context-help-open"]:visible').first().click()
  await expect(page.getByRole("dialog")).toContainText(/Open full guide/i, { timeout: 15_000 })
  await expect(page.getByRole("tab", { name: /Steps/i })).toBeVisible({ timeout: 15_000 })
})
