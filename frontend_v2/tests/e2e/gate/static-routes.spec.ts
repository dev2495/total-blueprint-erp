import { test } from "../support/base"
import { annotate, assertHealthyPage, getExactStaticAppRoutes } from "../support/test-helpers"

const excludedRoutes = new Set(["/login"])
const routes = getExactStaticAppRoutes().filter((route) => !excludedRoutes.has(route))

for (const route of routes) {
  test(`static route loads: ${route}`, async ({ page }, testInfo) => {
    annotate(testInfo, {
      module: "Screen Completeness",
      severity: "high",
      feature: route,
      expected: `${route} should render a stable page shell without 404/500 content.`,
    })

    await page.goto(route)
    await assertHealthyPage(page)
  })
}
