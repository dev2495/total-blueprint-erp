// WCAG 2.1 AA audit of key screens: axe-core rules (wcag2a/aa, wcag21a/aa), keyboard focus
// visibility on the first focusable elements, and touch-target sizes.
// Usage: node tests/sweep/a11y-audit.mjs <outJson> <idsJson>
import fs from "node:fs"
import { createRequire } from "node:module"
import { chromium } from "playwright"
import { adminPass, adminUser } from "./local-creds.mjs"

const require = createRequire(import.meta.url)
const axeSource = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8")
const BASE = process.env.SWEEP_BASE || "http://127.0.0.1:3401"
const [outFile, idsFile] = process.argv.slice(2)
const ids = JSON.parse(fs.readFileSync(idsFile, "utf8"))
const o = ids.orders
const pages = [
  ["login", "/login", false],
  ["orders list", "/sales/orders"],
  ["order composer", "/sales/orders/create"],
  ["order detail", `/sales/orders/${o["SO-2026-0018"]}`],
  ["product master edit", `/master/products/${ids.pm}/edit`],
  ["stock launcher", "/dashboard/planner/control-tower/stock-launcher"],
  ["plan queue", "/dashboard/planner/control-tower/plan-queue"],
  ["live production", "/dashboard/planner/control-tower/live-production"],
  ["completed trace", "/dashboard/planner/control-tower/completed-trace"],
  ["material readiness", "/dashboard/planner/control-tower/stock-intelligence"],
  ["POD master", "/master/pod"],
  ["job names", "/sales/job-names"],
  ["packaging master", "/master/packaging"],
  ["WC terminal", `/production/work-center/${ids.wc}`],
  ["machine screen", `/production/machine/${ids.machine}`],
  ["packing yard", "/logistics/packing"],
  ["inventory hub", "/dashboard/inventory"],
]

const browser = await chromium.launch()
const loginCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const lp = await loginCtx.newPage()
await lp.goto(`${BASE}/login`)
await lp.locator('[data-testid="login-form"][data-client-ready="true"]').waitFor({ timeout: 30000 })
await lp.getByTestId("login-identifier").fill(adminUser)
await lp.getByTestId("login-password").fill(adminPass())
await lp.getByTestId("login-submit").click()
await lp.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 })
const state = await loginCtx.storageState()
await loginCtx.close()

const results = []
for (const [name, route, authed = true] of pages) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...(authed ? { storageState: state } : {}) })
  const page = await ctx.newPage()
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 45000 })
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(800)
  await page.addScriptTag({ content: axeSource })
  const axe = await page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const res = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }, resultTypes: ["violations"] })
    return res.violations.map((v) => ({
      id: v.id, impact: v.impact, help: v.help, count: v.nodes.length,
      samples: v.nodes.slice(0, 4).map((n) => ({ target: n.target.join(" "), html: n.html.slice(0, 160), summary: (n.failureSummary || "").slice(0, 220) })),
    }))
  })
  // Keyboard: tab through the first 25 focusable elements and check a visible focus indicator.
  await page.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {})
  const focus = []
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press("Tab")
    const info = await page.evaluate(() => {
      const el = document.activeElement
      if (!el || el === document.body) return null
      const cs = getComputedStyle(el)
      const visible = (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== "none")
      const label = (el.getAttribute("aria-label") || el.innerText || el.getAttribute("placeholder") || el.getAttribute("title") || "").trim().slice(0, 40)
      return { tag: el.tagName.toLowerCase(), label, visible }
    })
    if (info) focus.push(info)
  }
  const targets = await page.evaluate(() => {
    const small24 = [], small44 = []
    for (const el of document.querySelectorAll("button, a[href], [role='button'], input[type='checkbox'], input[type='radio']")) {
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height) continue
      const cs = getComputedStyle(el)
      if (cs.visibility === "hidden" || cs.display === "none") continue
      const label = (el.getAttribute("aria-label") || el.innerText || el.getAttribute("title") || "").trim().slice(0, 30)
      if (r.width < 24 || r.height < 24) small24.push(`${el.tagName.toLowerCase()} "${label}" ${Math.round(r.width)}x${Math.round(r.height)}`)
      else if (r.width < 44 || r.height < 44) small44.push(label)
    }
    return { below24: small24.length, below24Samples: small24.slice(0, 8), below44: small44.length }
  })
  results.push({ name, route, axe, focus, targets })
  const noFocus = focus.filter((f) => !f.visible)
  console.log(`\n== ${name} (${route}) axe violations: ${axe.reduce((s, v) => s + v.count, 0)} in ${axe.length} rules | focus visible ${focus.length - noFocus.length}/${focus.length} | targets <24px: ${targets.below24}, <44px: ${targets.below44}`)
  for (const v of axe) console.log(`   [${v.impact}] ${v.id} ×${v.count}: ${v.help} :: ${v.samples[0]?.target} ${v.samples[0]?.summary?.replace(/\s+/g, " ").slice(0, 160)}`)
  if (noFocus.length) console.log(`   no visible focus: ${noFocus.slice(0, 6).map((f) => `${f.tag}"${f.label}"`).join(", ")}`)
  if (targets.below24) console.log(`   small targets: ${targets.below24Samples.slice(0, 5).join(" | ")}`)
  await ctx.close()
}
await browser.close()
fs.writeFileSync(outFile, JSON.stringify(results, null, 1))
