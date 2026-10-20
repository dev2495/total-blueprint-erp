// Local UI sweep: visit every sidebar route plus real detail pages as the local admin, at desktop and
// phone width, and record what a person would notice: errors, failing calls, sideways scroll, raw
// "undefined"/"NaN" text and clipped text. Usage: node tests/sweep/ui-sweep.mjs <outDir> <idsJson>
import fs from "node:fs"
import path from "node:path"
import { chromium } from "playwright"

const BASE = process.env.SWEEP_BASE || "http://127.0.0.1:3401"
const [outDir, idsFile] = process.argv.slice(2)
const ids = JSON.parse(fs.readFileSync(idsFile, "utf8"))
fs.mkdirSync(outDir, { recursive: true })

const nav = fs.readFileSync(new URL("../../src/lib/sidebar-nav.ts", import.meta.url), "utf8") + fs.readFileSync(new URL("../../src/lib/workspaces.ts", import.meta.url), "utf8")
const staticRoutes = [...new Set([...nav.matchAll(/href: "([^"]+)"/g)].map((m) => m[1]))].filter((r) => !r.startsWith("/gate")).sort()
const o = ids.orders
const detailRoutes = [
  `/sales/orders/${o["SO-2026-0030"]}`, `/sales/orders/${o["SO-2026-0018"]}`, `/sales/orders/${o["SO-2026-0017"]}`, `/sales/orders/${o["SO-2026-0029"]}`,
  `/sales/orders/${o["SO-2026-0030"]}/tracking`, `/sales/orders/${o["SO-2026-0022"]}/dispatches`,
  `/production/work-center/${ids.wc}`, `/production/work-center/${ids.wc_lam}`, `/production/machine/${ids.machine}`, `/production/jobs/${ids.job}`,
  `/master/products/${ids.pm}`, `/master/products/${ids.pm}/edit`, `/sales/quotations/new`, `/sales/orders/create`,
]
const only = process.env.SWEEP_ONLY ? new RegExp(process.env.SWEEP_ONLY) : null
const routes = [...staticRoutes, ...detailRoutes].filter((r) => !only || only.test(r))
const widths = (process.env.SWEEP_WIDTHS || "1440,390").split(",").map(Number)

const browser = await chromium.launch()
const login = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const lp = await login.newPage()
await lp.goto(`${BASE}/login`)
await lp.locator('[data-testid="login-form"][data-client-ready="true"]').waitFor({ timeout: 30000 })
await lp.getByTestId("login-identifier").fill(process.env.SWEEP_USER || "admin")
await lp.getByTestId("login-password").fill(process.env.SWEEP_PASS || "admin123")
await lp.getByTestId("login-submit").click()
await lp.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 })
const state = await login.storageState()
await login.close()

const results = []
for (const width of widths) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 768 ? 844 : 900 }, storageState: state })
  for (const route of routes) {
    const page = await ctx.newPage()
    const issues = { console: [], pageErrors: [], badCalls: [] }
    page.on("console", (m) => { if (m.type() === "error") issues.console.push(m.text().slice(0, 240)) })
    page.on("pageerror", (e) => issues.pageErrors.push(String(e.message || e).slice(0, 240)))
    page.on("response", (r) => {
      const u = r.url()
      if (r.status() >= 400) issues.badCalls.push(`${r.status()} ${r.request().method()} ${u.replace(/^https?:\/\/[^/]+/, "").slice(0, 140)}`)
    })
    const started = Date.now()
    let status = 0
    try {
      const resp = await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 45000 })
      status = resp ? resp.status() : 0
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {})
      await page.waitForTimeout(600)
    } catch (e) {
      issues.pageErrors.push(`navigation: ${String(e.message || e).slice(0, 200)}`)
    }
    const metrics = await page.evaluate(() => {
      const body = document.body ? document.body.innerText : ""
      const raw = []
      for (const re of [/\bundefined\b/g, /\bNaN\b/g, /\[object Object\]/g, /\bnull (kg|pcs|mm|µ)\b/gi, /Infinity/g]) {
        const m = body.match(re)
        if (m) raw.push(`${re.source}×${m.length}`)
      }
      const docW = document.documentElement.scrollWidth
      const clipped = []
      for (const el of document.querySelectorAll("body *")) {
        const cs = getComputedStyle(el)
        if (cs.display === "none" || cs.visibility === "hidden" || !el.childNodes.length) continue
        const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 2)
        if (!hasText) continue
        const clipX = el.scrollWidth > el.clientWidth + 2 && cs.overflowX === "visible" && cs.textOverflow !== "ellipsis" && el.clientWidth > 0
        if (clipX) {
          const r = el.getBoundingClientRect()
          if (r.width > 0 && r.height > 0) clipped.push(`${el.tagName.toLowerCase()} "${el.textContent.trim().slice(0, 40)}" ${el.scrollWidth}>${el.clientWidth}`)
        }
      }
      const h1 = document.querySelector("h1")
      const notFound = /404|not found|page could not be found/i.test(document.title + " " + (h1 ? h1.innerText : ""))
      return { raw, overflowX: docW - window.innerWidth, clipped: clipped.slice(0, 8), clippedCount: clipped.length, h1: h1 ? h1.innerText.slice(0, 80) : "", notFound, url: location.pathname }
    })
    const slug = `${width}${route.replace(/[^a-z0-9]+/gi, "_")}`.slice(0, 120)
    if (width >= 1024 || process.env.SWEEP_MOBILE_SHOTS) await page.screenshot({ path: path.join(outDir, `${slug}.png`), fullPage: false }).catch(() => {})
    results.push({ width, route, status, ms: Date.now() - started, ...metrics, ...issues })
    await page.close()
  }
  await ctx.close()
}
await browser.close()
fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify(results, null, 1))
const bad = results.filter((r) => r.pageErrors.length || r.badCalls.length || r.console.length || r.raw.length || r.overflowX > 1 || r.notFound || r.status >= 400)
console.log(`swept ${results.length} page views; ${bad.length} with findings`)
for (const r of bad) {
  console.log(`\n[${r.width}] ${r.route} -> ${r.url} (${r.status}, ${r.ms}ms) h1="${r.h1}"`)
  if (r.notFound) console.log("   NOT FOUND")
  if (r.overflowX > 1) console.log(`   sideways scroll +${r.overflowX}px`)
  if (r.raw.length) console.log(`   raw text: ${r.raw.join(", ")}`)
  for (const x of r.pageErrors) console.log(`   page error: ${x}`)
  for (const x of [...new Set(r.badCalls)].slice(0, 6)) console.log(`   api: ${x}`)
  for (const x of [...new Set(r.console)].slice(0, 4)) console.log(`   console: ${x}`)
}
const clippedPages = results.filter((r) => r.clippedCount > 0).sort((a, b) => b.clippedCount - a.clippedCount)
console.log(`\nclipped text on ${clippedPages.length} page views (top 15):`)
for (const r of clippedPages.slice(0, 15)) console.log(`  [${r.width}] ${r.route}: ${r.clippedCount} · ${r.clipped.slice(0, 3).join(" | ")}`)
