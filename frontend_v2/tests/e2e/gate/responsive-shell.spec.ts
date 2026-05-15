import { test } from "../support/base"
import { annotate, assertHealthyPage, assertNoHorizontalOverflow, getExactStaticAppRoutes, gotoWithServerRetry, loginViaUi } from "../support/test-helpers"

const routes = getExactStaticAppRoutes().filter((route) => route !== "/login")
const ROUTES_PER_BATCH = 8

function chunkRoutes(list: string[], size: number) {
  const chunks: string[][] = []
  for (let index = 0; index < list.length; index += size) {
    chunks.push(list.slice(index, index + size))
  }
  return chunks
}

const viewports = [
  { name: "desktop", width: 1440, height: 1100, requireRoleSwitcher: true },
  { name: "tablet", width: 834, height: 1112, requireRoleSwitcher: false },
  { name: "mobile", width: 390, height: 844, requireRoleSwitcher: false },
] as const

for (const viewport of viewports) {
  const routeBatches = chunkRoutes(routes, ROUTES_PER_BATCH)

  for (const [batchIndex, batchRoutes] of routeBatches.entries()) {
    test(`responsive route sweep (${viewport.name}) batch ${batchIndex + 1}`, async ({ page }, testInfo) => {
      test.setTimeout(Math.max(2 * 60_000, batchRoutes.length * 30_000))
      annotate(testInfo, {
        module: "Responsive Shell",
        severity: "high",
        feature: `${viewport.name}-batch-${batchIndex + 1}`,
        expected: "Protected routes should remain readable, authenticated, and free from page-level horizontal overflow.",
      })

      await page.setViewportSize({ width: viewport.width, height: viewport.height })

      for (const route of batchRoutes) {
        let lastError: unknown = null

        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            await gotoWithServerRetry(page, route, { waitUntil: "domcontentloaded", timeout: 60_000 })
            await assertHealthyPage(page, { requireAuth: true, requireRoleSwitcher: viewport.requireRoleSwitcher })
            await assertNoHorizontalOverflow(page)
            lastError = null
            break
          } catch (error) {
            lastError = error
            if (attempt === 0) {
              await loginViaUi(page, undefined, undefined, { requireRoleSwitcher: viewport.requireRoleSwitcher })
              continue
            }
          }
        }

        if (lastError) {
          throw lastError
        }
      }
    })
  }
}
