import { existsSync } from "node:fs"
import { mkdir, readdir, unlink } from "node:fs/promises"
import path from "node:path"
import { chromium } from "@playwright/test"

const frontendRoot = process.cwd()
const repoRoot = path.resolve(frontendRoot, "..")
const baseUrl = process.env.UI_BASE_URL || "http://127.0.0.1:3001"
const storageState = path.join(repoRoot, ".runtime", "ui-e2e", "storage", "admin.json")
const outputDir = path.join(repoRoot, "docs", "user-guides", "artifacts", "stock-lifecycle-guide-images")

if (!existsSync(storageState)) {
  throw new Error(`Missing auth storage state: ${storageState}`)
}

await mkdir(outputDir, { recursive: true })
for (const file of await readdir(outputDir).catch(() => [])) {
  if (file.endsWith(".png")) {
    await unlink(path.join(outputDir, file)).catch(() => undefined)
  }
}

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  storageState,
  viewport: { width: 1440, height: 1080 },
  deviceScaleFactor: 1,
})
const page = await context.newPage()
const adminUser = process.env.UI_E2E_ADMIN_USER || "admin"
const adminPassword = process.env.UI_E2E_ADMIN_PASSWORD || "admin123"

async function loginIfNeeded(route) {
  if (!page.url().includes("/login")) return

  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" })
  const result = await page.evaluate(
    async ({ adminUser, adminPassword }) => {
      const csrfResponse = await fetch("/api/users/csrf/", { method: "GET", credentials: "include" })
      const csrfPayload = await csrfResponse.json().catch(() => ({}))
      const cookieToken = document.cookie
        .split(";")
        .map((value) => value.trim())
        .find((value) => value.startsWith("csrftoken="))
        ?.split("=")[1]
      const csrfToken = String(cookieToken || csrfPayload.csrfToken || csrfPayload.csrf_token || "")

      const loginResponse = await fetch("/api/users/login/", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "X-CSRFToken": decodeURIComponent(csrfToken) } : {}),
        },
        body: JSON.stringify({ identifier: adminUser, password: adminPassword }),
      })
      const loginPayload = await loginResponse.json().catch(() => ({}))
      if (!loginResponse.ok) {
        return {
          ok: false,
          detail: loginPayload.detail || loginPayload.message || loginPayload.error || `login returned ${loginResponse.status}`,
        }
      }

      document.cookie = "x_role_override=ADMIN; path=/; SameSite=Lax"
      const meResponse = await fetch("/api/users/me/", { method: "GET", credentials: "include" })
      return {
        ok: meResponse.ok,
        detail: meResponse.ok ? "" : `session probe returned ${meResponse.status}`,
      }
    },
    { adminUser, adminPassword },
  )

  if (!result.ok) {
    throw new Error(`Screenshot login failed: ${result.detail}`)
  }
  await context.storageState({ path: storageState })
  await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded" })
}

async function clearGuideOverlays() {
  await page.evaluate(() => {
    document.querySelectorAll("[data-guide-overlay='true']").forEach((node) => node.remove())
  })
}

async function addCallouts(definitions) {
  const callouts = []
  for (const definition of definitions) {
    const locator = definition.locator.first()
    const visible = await locator.isVisible().catch(() => false)
    if (!visible) continue
    const box = await locator.boundingBox().catch(() => null)
    if (!box) continue
    callouts.push({
      label: definition.label,
      x: Math.max(8, box.x - 5),
      y: Math.max(8, box.y - 5),
      w: box.width + 10,
      h: box.height + 10,
      anchor: definition.anchor || "top",
    })
  }

  await page.evaluate((items) => {
    const root = document.createElement("div")
    root.setAttribute("data-guide-overlay", "true")
    root.style.position = "fixed"
    root.style.inset = "0"
    root.style.pointerEvents = "none"
    root.style.zIndex = "2147483647"
    root.style.fontFamily = "Inter, Arial, sans-serif"

    for (const item of items) {
      const outline = document.createElement("div")
      outline.style.position = "absolute"
      outline.style.left = `${item.x}px`
      outline.style.top = `${item.y}px`
      outline.style.width = `${item.w}px`
      outline.style.height = `${item.h}px`
      outline.style.border = "3px solid #ef4444"
      outline.style.borderRadius = "12px"
      outline.style.boxShadow = "0 0 0 9999px rgba(15,23,42,0.03)"
      outline.style.background = "rgba(239,68,68,0.04)"

      const label = document.createElement("div")
      label.textContent = item.label
      label.style.position = "absolute"
      label.style.left = `${item.x}px`
      label.style.maxWidth = "280px"
      label.style.padding = "7px 10px"
      label.style.borderRadius = "999px"
      label.style.background = "#0f172a"
      label.style.color = "#fff"
      label.style.fontSize = "12px"
      label.style.fontWeight = "900"
      label.style.letterSpacing = "0.02em"
      label.style.boxShadow = "0 12px 30px rgba(15,23,42,0.25)"

      const top = item.anchor === "bottom" ? item.y + item.h + 6 : item.y - 35
      label.style.top = `${Math.max(8, Math.min(window.innerHeight - 40, top))}px`

      root.appendChild(outline)
      root.appendChild(label)
    }

    document.body.appendChild(root)
  }, callouts)
}

async function screenshot(name, route, waitTestId, definitions, options = {}) {
  await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded" })
  if (waitTestId) {
    let ready = false
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await Promise.race([
        page.getByTestId(waitTestId).waitFor({ state: "visible", timeout: 10_000 }).then(() => "ready"),
        page.waitForURL((url) => url.pathname.startsWith("/login"), { timeout: 10_000 }).then(() => "login"),
      ]).catch(() => "timeout")

      if (result === "ready") {
        ready = true
        break
      }
      if (result === "login" || page.url().includes("/login")) {
        await loginIfNeeded(route)
        continue
      }
      await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined)
    }
    if (!ready) {
      throw new Error(`Timed out waiting for ${waitTestId} on ${route}; current URL is ${page.url()}`)
    }
  }
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined)
  await page.waitForTimeout(900)
  if (options.scrollY) {
    await page.evaluate((scrollY) => window.scrollTo({ top: scrollY, left: 0, behavior: "instant" }), options.scrollY)
    await page.waitForTimeout(500)
  }
  await clearGuideOverlays()
  await addCallouts(definitions)
  await page.screenshot({ path: path.join(outputDir, `${name}.png`), fullPage: false })
  await clearGuideOverlays()
}

await screenshot("01-overview", "/inventory/stock-lifecycle?tab=overview", "stock-lifecycle-cockpit", [
  { locator: page.getByTestId("stock-lifecycle-tab-count"), label: "Open Physical count for daily/partial counts" },
  { locator: page.getByTestId("stock-lifecycle-plant-select"), label: "Pick the plant before reviewing stock" },
  { locator: page.getByRole("button", { name: /Export/i }), label: "Export view" },
  { locator: page.getByText(/Movement this period/i), label: "Use movement proof for opening + in - out = closing", anchor: "bottom" },
])

await screenshot("02-physical-count", "/inventory/stock-lifecycle?tab=count&scope=PACKING", "stock-count-tab", [
  { locator: page.getByTestId("count-material-search"), label: "Search material, label, location, or code" },
  { locator: page.getByTestId("count-location-filter"), label: "Location count filter" },
  { locator: page.getByTestId("count-roll-form-filter"), label: "Roll form filter" },
  { locator: page.getByTestId("count-granule-code-filter"), label: "Granule code filter" },
  { locator: page.getByTestId("count-post-batch"), label: "Post only valid ready rows", anchor: "bottom" },
])

await screenshot("03-month-history", "/inventory/stock-lifecycle?tab=snapshots", "stock-lifecycle-cockpit", [
  { locator: page.getByText(/Monthly close tracker/i), label: "Monthly close tracker: count/snapshot status" },
  { locator: page.getByRole("button", { name: /Capture month-end snapshot/i }), label: "Capture current month snapshot", anchor: "bottom" },
  { locator: page.getByText(/Audit sheet history/i), label: "Posted and draft audit sheets live here" },
])

await screenshot("04-stock-card-drill", "/inventory/stock-lifecycle?tab=snapshots", "stock-lifecycle-cockpit", [
  { locator: page.getByText(/Audit sheet history/i), label: "Audit sheet list: posted and draft batches" },
  { locator: page.getByText(/Stock card drill/i), label: "Stock card drill: ledger proof" },
  { locator: page.getByPlaceholder(/Search material/i), label: "Search a material before drilldown" },
  { locator: page.getByText(/Opening/i).last(), label: "Opening + movement = closing", anchor: "bottom" },
], { scrollY: 520 })

await screenshot("05-fy-close", "/inventory/stock-lifecycle?tab=close", "close-stock-tab", [
  { locator: page.getByTestId("close-fy-input"), label: "Annual FY to close" },
  { locator: page.getByText(/Close blockers/i), label: "Resolve blockers before annual close" },
])

await screenshot("06-fy-close-action", "/inventory/stock-lifecycle?tab=close", "close-stock-tab", [
  { locator: page.getByText(/Opening \+ Ins/i), label: "Review closing math before locking FY" },
  { locator: page.getByTestId("period-close"), label: "Close Financial Year only after blockers are clear", anchor: "top" },
], { scrollY: 360 })

await screenshot("07-packing-eod", "/logistics/packing/consumption", "packing-consumption-page", [
  { locator: page.getByRole("link", { name: /Packing Yard/i }), label: "Back to packing yard" },
  { locator: page.getByTestId("packing-count-date"), label: "Count date for EOD posting" },
  { locator: page.getByTestId("packing-count-copy-book"), label: "Copy book qty when physical equals system" },
  { locator: page.getByTestId("packing-count-submit"), label: "Post count into the same stock-cycle truth", anchor: "bottom" },
  { locator: page.getByText(/Posting rule/i), label: "Short = consumption, excess = adjustment" },
])

await context.close()
await browser.close()

console.log(`Guide screenshots written: ${outputDir}`)
