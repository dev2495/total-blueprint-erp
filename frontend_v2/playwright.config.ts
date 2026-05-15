import path from "node:path"
import { defineConfig } from "@playwright/test"

const runtimeRoot = path.resolve(__dirname, "../.runtime/ui-e2e")
const reportSuffix = process.env.UI_E2E_REPORT_SUFFIX ? `-${process.env.UI_E2E_REPORT_SUFFIX}` : ""
const browserChannel = process.env.PLAYWRIGHT_BROWSER_CHANNEL
const disableVideo = process.env.PLAYWRIGHT_DISABLE_VIDEO === "1"
const sharedUse = {
  baseURL: process.env.UI_BASE_URL || "http://127.0.0.1:3000",
  headless: true,
  browserName: "chromium" as const,
  ...(browserChannel ? { channel: browserChannel } : {}),
  trace: "retain-on-failure" as const,
  screenshot: "only-on-failure" as const,
  video: disableVideo ? ("off" as const) : ("retain-on-failure" as const),
  actionTimeout: 15_000,
  navigationTimeout: 30_000,
  ignoreHTTPSErrors: true,
  storageState: path.join(runtimeRoot, "storage", "admin.json"),
}

export default defineConfig({
  testDir: path.join(__dirname, "tests", "e2e"),
  outputDir: path.join(runtimeRoot, "test-results"),
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: Number(process.env.UI_E2E_WORKERS || 1),
  timeout: 90_000,
  expect: {
    timeout: 12_000,
  },
  globalSetup: path.join(__dirname, "tests", "e2e", "global-setup.ts"),
  reporter: [
    ["list"],
    ["json", { outputFile: path.join(runtimeRoot, `playwright-results${reportSuffix}.json`) }],
    ["html", { outputFolder: path.join(runtimeRoot, `html-report${reportSuffix}`), open: "never" }],
    [path.join(__dirname, "tests", "e2e", "reporters", "release-readiness-reporter.ts"), { outputDir: runtimeRoot }],
  ],
  use: sharedUse,
  projects: [
    {
      name: "gate",
      testMatch: /gate\/.*\.spec\.ts/,
      use: sharedUse,
    },
    {
      name: "mutations",
      testMatch: /mutations\/.*\.spec\.ts/,
      use: sharedUse,
      timeout: 120_000,
    },
    {
      name: "observations",
      testMatch: /observation\/.*\.spec\.ts/,
      use: sharedUse,
    },
  ],
})
