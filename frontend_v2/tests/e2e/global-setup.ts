import fs from "node:fs/promises"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { chromium, type FullConfig } from "@playwright/test"

function run(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env) {
  execFileSync(cmd, args, { cwd, env, stdio: "inherit" })
}

async function waitForFrontend(url: string, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs
  let lastError = "frontend did not respond"

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: "manual" })
      if (response.status >= 200 && response.status < 500) {
        return
      }
      lastError = `frontend returned ${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }

  throw new Error(`Timed out waiting for frontend at ${url}: ${lastError}`)
}

export default async function globalSetup(config: FullConfig) {
  const frontendRoot = path.resolve(__dirname, "../..")
  const repoRoot = path.resolve(frontendRoot, "..")
  const runtimeRoot = path.resolve(repoRoot, ".runtime/ui-e2e")
  const storageDir = path.join(runtimeRoot, "storage")
  const storagePath = path.join(storageDir, "admin.json")
  const baseURL = config.projects[0]?.use?.baseURL || "http://127.0.0.1:3000"
  const skipBootstrap = process.env.UI_E2E_SKIP_BOOTSTRAP === "1"
  const browserChannel = process.env.PLAYWRIGHT_BROWSER_CHANNEL
  const frontendMode = process.env.UI_E2E_FRONTEND_MODE || process.env.FRONTEND_MODE || "dev"

  await fs.mkdir(storageDir, { recursive: true })

  if (!skipBootstrap) {
    await fs.rm(path.join(runtimeRoot, "test-results"), { recursive: true, force: true })
    run(path.join(repoRoot, "venv_311/bin/python"), [path.join(repoRoot, "scripts/ensure_superuser.py")], repoRoot)
      run(path.join(repoRoot, "start_all.sh"), ["clean-restart"], repoRoot, {
        ...process.env,
        FRONTEND_MODE: frontendMode,
      })
    run(path.join(repoRoot, "venv_311/bin/python"), [path.join(repoRoot, "scripts/seed_ui_e2e.py")], repoRoot)
    run(path.join(repoRoot, "venv_311/bin/python"), [path.join(repoRoot, "scripts/seed_ui_e2e_quotations.py")], repoRoot)
    run(path.join(repoRoot, "venv_311/bin/python"), [path.join(repoRoot, "manage.py"), "seed_notification_baseline"], repoRoot)
    run(
      path.join(repoRoot, "venv_311/bin/python"),
      [path.join(repoRoot, "manage.py"), "run_tagged_acceptance", "--report-dir", path.join(runtimeRoot, "acceptance")],
      repoRoot,
    )
    run(path.join(repoRoot, "venv_311/bin/python"), [path.join(repoRoot, "scripts/seed_ui_e2e_planner_gate.py")], repoRoot)
    run(path.join(repoRoot, "venv_311/bin/python"), [path.join(repoRoot, "scripts/seed_ui_e2e_mutations.py")], repoRoot)
  }

  await waitForFrontend(`${String(baseURL).replace(/\/$/, "")}/login`)

  const browser = await chromium.launch({
    headless: true,
    ...(browserChannel ? { channel: browserChannel } : {}),
  })
  const context = await browser.newContext({ baseURL: String(baseURL) })
  const page = await context.newPage()
  await page.goto("/login", { waitUntil: "domcontentloaded" })
  await page.getByTestId("login-client-ready").waitFor({ state: "visible", timeout: 30_000 })
  await page.getByTestId("login-identifier").fill(process.env.UI_E2E_ADMIN_USER || "admin")
  await page.getByTestId("login-password").fill(process.env.UI_E2E_ADMIN_PASSWORD || "admin123")
  await page.getByTestId("login-submit").click()
  try {
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 })
  } catch {
    await page.goto("/dashboard/admin", { waitUntil: "domcontentloaded" })
  }
  await page.getByTestId("sidebar-nav").waitFor({ state: "visible", timeout: 30_000 })
  await context.storageState({ path: storagePath })
  await browser.close()
}
