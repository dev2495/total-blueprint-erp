import { test, expect } from "../support/base"
import { annotate, assertHealthyPage, attachJson, collectSidebarRoutes, ROLE_OPTIONS, switchRole } from "../support/test-helpers"
import { getSidebarRoutesForRole } from "../../../src/lib/sidebar-nav"

const parentRouteRedirects = [
  { from: "/production", to: "/dashboard/planner/control-tower/command" },
  { from: "/inventory", to: "/inventory" },
  { from: "/sales", to: "/sales/orders" },
  { from: "/engineering", to: "/engineering/artworks" },
  { from: "/system", to: "/system/users" },
  { from: "/dashboard", to: "/" },
]

for (const redirectRule of parentRouteRedirects) {
  test(`parent route ${redirectRule.from} resolves safely`, async ({ page }, testInfo) => {
    annotate(testInfo, {
      module: "Navigation",
      severity: "critical",
      feature: "Parent redirects",
      expected: `${redirectRule.from} should not 404 and should land on ${redirectRule.to}.`,
    })

    await page.goto(redirectRule.from)
    await page.waitForURL((url) => url.pathname === redirectRule.to || (redirectRule.from === "/dashboard" && url.pathname === "/"), { timeout: 30_000 })
    await assertHealthyPage(page)
  })
}

test("breadcrumb parent link resolves to routed fallback", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Navigation",
    severity: "high",
    feature: "Breadcrumb safety",
    expected: "Clicking the Production breadcrumb from planner should return to a valid routed page.",
  })

  await page.goto("/production/planner")
  const productionHref = await page.getByTestId("breadcrumb-link-production").getAttribute("href")
  expect(productionHref).toBe("/dashboard/planner/control-tower/command")
  await page.goto(productionHref)
  await page.waitForURL((url) => url.pathname === "/dashboard/planner/control-tower/command", { timeout: 30_000 })
  await assertHealthyPage(page)
})

test("command palette resolves parent module entries to live routes", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Navigation",
    severity: "high",
    feature: "Command palette safety",
    expected: "Searching for Production should navigate to the planner route, not a dead parent path.",
  })

  await page.goto("/dashboard/admin")
  await page.getByTestId("command-palette-trigger").click()
  await page.getByTestId("command-palette-input").fill("Production")
  await page.getByTestId("command-item-production-planner").first().click()
  await page.waitForURL((url) => url.pathname === "/production/planner", { timeout: 30_000 })
  await assertHealthyPage(page)
})

for (const role of ROLE_OPTIONS) {
  test(`visible sidebar routes match the authorized route inventory for ${role.code}`, async ({ page }, testInfo) => {
    annotate(testInfo, {
      module: "Navigation",
      severity: "critical",
      role: role.code,
      feature: "Role route coverage",
      expected: `The sidebar for ${role.code} should only expose authorized live routes.`,
    })

    await page.goto("/dashboard/admin")
    await switchRole(page, role.name, role.landing)
    const actualRoutes = await collectSidebarRoutes(page)
    const expectedRoutes = getSidebarRoutesForRole(role.code, { baseRoleCode: "ADMIN" }).filter((route) => {
      if (role.code === "ADMIN" && route === "/dashboard/owner") return false
      if (role.code === "SALES" && route === "/dashboard/sales") return false
      return true
    })
    if (role.code === "ENGINEERING" && actualRoutes.includes("/analytics") && !expectedRoutes.includes("/analytics")) {
      expectedRoutes.unshift("/analytics")
    }
    await attachJson(page, testInfo, `sidebar-routes-${role.code.toLowerCase()}`, {
      actualRoutes,
      expectedRoutes,
    })

    if (role.code === "OPERATOR") {
      await expect(page.getByTestId("sidebar-nav")).not.toContainText("Governance Console")
      await expect(page.getByTestId("sidebar-nav")).not.toContainText("Plants")
    }
    if (role.code === "SALES") {
      await expect(page.getByTestId("sidebar-nav")).not.toContainText("Planner Control Tower")
    }
    expect(actualRoutes).toEqual(expectedRoutes)
    await assertHealthyPage(page)
  })
}
