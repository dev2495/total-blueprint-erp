import { test } from "../support/base"
import { annotate, assertHealthyPage, getExactStaticAppRoutes, gotoWithServerRetry } from "../support/test-helpers"

const excludedRoutes = new Set(["/login"])
// The gate app (/gate/*) and the public visitor page (/visit) have their own shell
// without the dashboard sidebar or role switcher; they are covered by the gate specs.
const isOwnShellRoute = (route: string) => route === "/gate" || route.startsWith("/gate/") || route === "/visit" || route.startsWith("/visit/")
const routes = getExactStaticAppRoutes().filter((route) => !excludedRoutes.has(route) && !isOwnShellRoute(route))

for (const route of routes) {
  test(`static route loads: ${route}`, async ({ page }, testInfo) => {
    annotate(testInfo, {
      module: "Screen Completeness",
      severity: "high",
      feature: route,
      expected: `${route} should render a stable page shell without 404/500 content.`,
    })

    await gotoWithServerRetry(page, route, { waitUntil: "domcontentloaded", timeout: 45_000 })
    await assertHealthyPage(page, { requireAuth: true, requireRoleSwitcher: true })
  })
}
