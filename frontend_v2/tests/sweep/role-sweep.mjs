// Role sweep on the local stack: sign in as each demo.<role> account (seed_local_role_users),
// open every screen in that role's menu and a list of screens the role must not reach, and
// report refused API calls, page errors and pages that should (or should not) be blocked.
// Usage: node tests/sweep/role-sweep.mjs <outJson> [<idsJson>]
import fs from "node:fs"
import { chromium } from "playwright"
import { rolePass } from "./local-creds.mjs"

const BASE = process.env.SWEEP_BASE || "http://127.0.0.1:3401"
const PASSWORD = rolePass()
const [outFile, idsFile] = process.argv.slice(2)
const ids = idsFile ? JSON.parse(fs.readFileSync(idsFile, "utf8")) : {}
const anyOrder = ids.orders ? Object.values(ids.orders)[0] : null

// Screens each role must NOT open (typed address or old bookmark).
const BLOCKED = {
  SALES: ["/master/products", ids.pm ? `/master/products/${ids.pm}/edit` : null, "/engineering/routing", "/engineering/templates", "/factory/processes", "/system/users"],
  PLANNER: ["/master/products", "/engineering/routing", "/system/users", "/factory/machines"],
  "WORK-CENTER-MANAGER": ["/master/products", "/engineering/artworks", "/system/users", "/factory/work-centers"],
  OPERATOR: ["/sales/orders", "/production/work-center", ids.wc ? `/production/work-center/${ids.wc}` : null, "/dashboard/planner/control-tower/plan-queue", "/inventory/rolls", "/master/products"],
  STORE: ["/master/products", "/engineering/routing", "/system/users"],
  DISPATCH: ["/master/products", "/engineering/routing", "/system/users"],
  "PLANT-MANAGER": ["/master/products", "/engineering/routing", "/system/users"],
}
// Cross-module screens a role may open through a link.
const EXTRA_OK = {
  SALES: anyOrder ? [`/sales/orders/${anyOrder}`, "/sales/orders/create"] : ["/sales/orders/create"],
  OPERATOR: ["/production/machine-selector"],
}

const browser = await chromium.launch()
const report = []
for (const role of Object.keys(BLOCKED)) {
  const username = `demo.${role.toLowerCase()}`
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const issues = []
  let current = ""
  page.on("response", (r) => {
    const u = new URL(r.url())
    if (u.pathname.startsWith("/api/") && r.status() >= 400 && !u.pathname.includes("/token/refresh")) {
      issues.push({ page: current, call: `${r.status()} ${r.request().method()} ${u.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, "<id>")}` })
    }
  })
  page.on("pageerror", (e) => issues.push({ page: current, error: String(e.message || e).slice(0, 200) }))
  await page.goto(`${BASE}/login`)
  await page.locator('[data-testid="login-form"][data-client-ready="true"]').waitFor({ timeout: 30000 })
  await page.getByTestId("login-identifier").fill(username)
  await page.getByTestId("login-password").fill(PASSWORD)
  await page.getByTestId("login-submit").click()
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 })
  await page.waitForLoadState("networkidle").catch(() => {})
  const landing = new URL(page.url()).pathname
  // Every screen the menus offer: sidebar (all screens) and the workspace tabs.
  const menu = await page.evaluate(() => {
    const hrefs = new Set()
    for (const a of document.querySelectorAll('[data-testid="sidebar-all-screens"] a[href], [data-testid="sidebar-workspaces"] a[href], [data-testid="workspace-bar"] a[href]')) {
      const h = a.getAttribute("href") || ""
      if (h.startsWith("/") && !h.startsWith("/gate")) hrefs.add(h.split("?")[0])
    }
    return [...hrefs].sort()
  })
  const visits = []
  for (const route of [...new Set([...menu, ...(EXTRA_OK[role] || [])])]) {
    current = route
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {})
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {})
    await page.waitForTimeout(500)
    const blocked = await page.getByTestId("page-no-access").isVisible().catch(() => false)
    visits.push({ route, expect: "open", blocked, final: new URL(page.url()).pathname })
  }
  for (const route of BLOCKED[role].filter(Boolean)) {
    current = route
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {})
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {})
    await page.waitForTimeout(500)
    const blocked = await page.getByTestId("page-no-access").isVisible().catch(() => false)
    visits.push({ route, expect: "blocked", blocked, final: new URL(page.url()).pathname })
  }
  report.push({ role, username, landing, menu, visits, issues })
  const wrong = visits.filter((v) => (v.expect === "open") === v.blocked)
  const refused = issues.filter((i) => i.call && visits.some((v) => v.route === i.page && v.expect === "open"))
  console.log(`\n== ${role}: landing ${landing}, ${menu.length} menu screens, ${wrong.length} wrong, ${refused.length} refused calls on allowed screens, ${issues.filter((i) => i.error).length} page errors`)
  for (const v of wrong) console.log(`   WRONG ${v.expect === "open" ? "blocked" : "opened"}: ${v.route}`)
  for (const i of refused.slice(0, 12)) console.log(`   refused on ${i.page}: ${i.call}`)
  for (const i of issues.filter((x) => x.error).slice(0, 6)) console.log(`   page error on ${i.page}: ${i.error}`)
  await ctx.close()
}
await browser.close()
fs.writeFileSync(outFile, JSON.stringify(report, null, 1))
