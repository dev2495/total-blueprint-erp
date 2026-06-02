import { existsSync } from "node:fs"
import { mkdir, rename } from "node:fs/promises"
import path from "node:path"
import { chromium } from "@playwright/test"

const frontendRoot = process.cwd()
const repoRoot = path.resolve(frontendRoot, "..")
const baseUrl = process.env.UI_BASE_URL || "http://127.0.0.1:3001"
const storageState = path.join(repoRoot, ".runtime", "ui-e2e", "storage", "admin.json")
const artifactDir = path.join(repoRoot, "docs", "user-guides", "artifacts")
const videoDir = path.join(repoRoot, ".runtime", "stock-lifecycle-demo-video")
const output = path.join(artifactDir, "stock-lifecycle-local-demo.webm")

if (!existsSync(storageState)) {
  throw new Error(`Missing auth storage state: ${storageState}`)
}

await mkdir(videoDir, { recursive: true })
await mkdir(artifactDir, { recursive: true })

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  storageState,
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } },
})
const page = await context.newPage()

async function clickTab(testId) {
  const tab = page.getByTestId(testId)
  await tab.scrollIntoViewIfNeeded()
  await tab.click()
  await page.waitForTimeout(900)
}

await page.goto(`${baseUrl}/inventory/stock-lifecycle`, { waitUntil: "domcontentloaded" })
await page.getByTestId("stock-lifecycle-cockpit").waitFor({ state: "visible", timeout: 20000 })
await page.waitForTimeout(900)
await clickTab("stock-lifecycle-tab-count")
await clickTab("stock-lifecycle-tab-snapshots")
await clickTab("stock-lifecycle-tab-close")
await clickTab("stock-lifecycle-tab-overview")

const video = page.video()
await context.close()
await browser.close()

if (!video) {
  throw new Error("Playwright did not create a video artifact.")
}

const source = await video.path()
await rename(source, output)
console.log(`Demo video written: ${output}`)
