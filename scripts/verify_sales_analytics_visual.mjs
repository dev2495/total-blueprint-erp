import fs from "node:fs/promises"
import path from "node:path"
import playwrightPkg from "/Users/devarshthakkar/Documents/total_blueprint_erp/frontend_v2/node_modules/playwright/index.js"

const { chromium } = playwrightPkg

const repoRoot = "/Users/devarshthakkar/Documents/total_blueprint_erp"
const runtimeRoot = path.join(repoRoot, ".runtime/ui-e2e")
const BASE_URL = process.env.UI_E2E_BASE_URL || "http://127.0.0.1:3000"
const API_URL = process.env.UI_E2E_API_URL || "http://127.0.0.1:8000"
const USER = process.env.UI_E2E_ADMIN_USER || "admin"
const PASSWORD = process.env.UI_E2E_ADMIN_PASSWORD || "admin123"

async function ensureDir() {
  await fs.mkdir(runtimeRoot, { recursive: true })
}

function runtimePath(name) {
  return path.join(runtimeRoot, name)
}

async function login(page) {
  const requestContext = page.context().request
  const csrfResponse = await requestContext.get(`${API_URL}/api/users/csrf/`, { failOnStatusCode: false })
  const csrfPayload = await csrfResponse.json().catch(() => ({}))
  const storageBefore = await requestContext.storageState()
  const cookieToken = storageBefore.cookies.find((cookie) => cookie.name === "csrftoken")?.value
  const csrfToken = decodeURIComponent(cookieToken || csrfPayload.csrfToken || csrfPayload.csrf_token || "")

  await requestContext.post(`${API_URL}/api/users/login/`, {
    failOnStatusCode: false,
    headers: {
      "Content-Type": "application/json",
      ...(csrfToken ? { "X-CSRFToken": csrfToken } : {}),
    },
    data: { identifier: USER, password: PASSWORD },
  })

  const meResponse = await requestContext.get(`${API_URL}/api/users/me/`, { failOnStatusCode: false })
  if (!meResponse.ok()) {
    throw new Error(`Failed to establish authenticated session (${meResponse.status()})`)
  }

  const storageState = await requestContext.storageState()
  if (storageState.cookies.length) {
    await page.context().addCookies(storageState.cookies)
  }
}

async function openSelect(page, textPattern) {
  const trigger = page.locator('button[role="combobox"]').filter({ hasText: textPattern }).first()
  await trigger.waitFor({ state: "visible", timeout: 15_000 })
  await trigger.click()
}

async function chooseOption(page, optionText) {
  const option = page.locator('[role="option"], [data-radix-collection-item]').filter({ hasText: new RegExp(`^${optionText}$`, "i") }).first()
  await option.waitFor({ state: "visible", timeout: 15_000 })
  await option.click()
}

async function visibleStatuses(page) {
  return page.locator("span").evaluateAll((nodes) =>
    nodes
      .map((node) => (node.textContent || "").trim().toUpperCase())
      .filter((text) => ["COMPLETED", "CANCELLED", "PACKING_READY", "DISPATCH_READY", "RELEASED", "PLANNING_REQUIRED"].includes(text)),
  )
}

async function main() {
  await ensureDir()
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })

  try {
    await login(page)

    await page.goto(`${BASE_URL}/sales/orders`, { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined)
    await page.getByRole("button", { name: /Completed Orders/i }).click()
    await page.getByText(/Completed order audit/i).waitFor({ state: "visible", timeout: 15_000 })

    await page.getByPlaceholder(/Search completed order/i).fill("SO")
    await openSelect(page, /All statuses/i)
    await chooseOption(page, "Cancelled")
    await page.waitForTimeout(600)

    const statuses = await visibleStatuses(page)
    const visibleRowCount = await page.locator("tbody tr").count()
    if (!statuses.length || statuses.some((value) => value !== "CANCELLED")) {
      throw new Error(`Completed filter did not constrain statuses to CANCELLED. Saw: ${statuses.join(", ") || "none"}`)
    }
    if (visibleRowCount < 1) {
      throw new Error("Completed filter removed every visible row unexpectedly.")
    }
    await page.screenshot({ path: runtimePath("live-sales-orders-completed-filters.png"), fullPage: true })

    await page.goto(`${BASE_URL}/analytics`, { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined)
    await page.getByText(/Analytics and Reports Hub/i).waitFor({ state: "visible", timeout: 15_000 })
    await page.getByText(/Operational KPI Pulse/i).waitFor({ state: "visible", timeout: 15_000 })
    await page.screenshot({ path: runtimePath("live-analytics-hub.png"), fullPage: true })

    await page.goto(`${BASE_URL}/analytics/reports/oee`, { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined)
    await page.getByText(/Average OEE/i).waitFor({ state: "visible", timeout: 15_000 })
    const oeeBody = await page.locator("body").innerText()
    if (/No categorical split available yet\./i.test(oeeBody)) {
      throw new Error("OEE report still rendered an empty categorical split placeholder.")
    }
    await page.screenshot({ path: runtimePath("live-oee-report.png"), fullPage: true })

    await page.goto(`${BASE_URL}/dashboard/sales`, { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined)
    await page.getByText(/Sales Command Center/i).waitFor({ state: "visible", timeout: 15_000 })
    await page.screenshot({ path: runtimePath("live-sales-dashboard-compact.png"), fullPage: true })

    await fs.writeFile(
      runtimePath("live-sales-analytics-visual-proof.json"),
      JSON.stringify(
        {
          generated_at: new Date().toISOString(),
          sales_orders: {
            completed_filter_status: "CANCELLED",
            visible_statuses: statuses,
            visible_rows: visibleRowCount,
          },
          analytics_hub: {
            route: "/analytics",
            pulse_panel: true,
          },
          oee_report: {
            route: "/analytics/reports/oee",
            average_oee_visible: true,
            empty_snapshot_placeholder: false,
          },
          sales_dashboard: {
            route: "/dashboard/sales",
            compact_layout_visible: true,
          },
        },
        null,
        2,
      ),
      "utf8",
    )
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error))
  process.exit(1)
})
