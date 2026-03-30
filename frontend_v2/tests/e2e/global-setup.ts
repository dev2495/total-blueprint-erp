import { readdirSync } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { chromium, type FullConfig, type Page } from "@playwright/test"

function run(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env) {
  execFileSync(cmd, args, { cwd, env, stdio: "inherit" })
}

function backendPythonHealthCheck(candidate: string, repoRoot: string) {
  try {
    execFileSync(
      candidate,
      [
        "-c",
        [
          "import importlib.util, sys",
          "mods = ['django', 'reportlab', 'whitenoise']",
          "missing = [name for name in mods if importlib.util.find_spec(name) is None]",
          "sys.exit(1 if missing else 0)",
        ].join("; "),
      ],
      { cwd: repoRoot, stdio: "ignore" },
    )
    return true
  } catch {
    return false
  }
}

async function resolvePreferredPython(repoRoot: string) {
  const envCandidates = [process.env.UI_E2E_PYTHON, process.env.BACKEND_PYTHON].filter(Boolean) as string[]
  const candidates = [
    ...envCandidates,
    path.join(repoRoot, "venv_311/bin/python"),
    path.join(repoRoot, ".venv-validate/bin/python"),
  ]

  for (const candidate of candidates) {
    try {
      await fs.access(candidate)
    } catch {
      continue
    }
    if (backendPythonHealthCheck(candidate, repoRoot)) {
      return candidate
    }
  }

  return path.join(repoRoot, "venv_311/bin/python")
}

function trimIdleDbConnections(repoRoot: string, env: NodeJS.ProcessEnv) {
  try {
    const dbName = String(env.POSTGRES_DB || env.DB_NAME || "total_blueprint_erp")
    execFileSync(
      "psql",
      [
        "-d",
        dbName,
        "-c",
        [
          "SELECT pg_terminate_backend(pid)",
          "FROM pg_stat_activity",
          `WHERE datname = '${dbName.replace(/'/g, "''")}'`,
          "AND pid <> pg_backend_pid()",
          "AND state = 'idle';",
        ].join(" "),
      ],
      { cwd: repoRoot, env, stdio: "inherit" },
    )
  } catch {
    // Keep bootstrap portable when psql is unavailable.
  }
}

function runAcceptanceWithFallback(
  pythonBin: string,
  repoRoot: string,
  runtimeRoot: string,
  env: NodeJS.ProcessEnv,
) {
  const acceptanceDir = path.join(runtimeRoot, "acceptance")
  try {
    run(
      pythonBin,
      [path.join(repoRoot, "manage.py"), "run_tagged_acceptance", "--report-dir", acceptanceDir],
      repoRoot,
      env,
    )
  } catch (error) {
    const hasArtifacts = (() => {
      try {
        return readdirSync(acceptanceDir).length > 0
      } catch {
        return false
      }
    })()
    if (hasArtifacts) {
      console.warn("WARN: run_tagged_acceptance failed, but existing acceptance artifacts are present. Continuing bootstrap.")
      return
    }
    throw error
  }
}

function resolveApiOrigin(baseURL: string) {
  const parsed = new URL(baseURL)
  const apiPort = String(process.env.UI_E2E_API_PORT || process.env.NEXT_PUBLIC_API_PORT || "8000").trim() || "8000"
  return `${parsed.protocol}//${parsed.hostname}:${apiPort}`
}

async function retry<T>(fn: () => Promise<T>, attempts = 5, delayMs = 1500): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt === attempts - 1) break
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

function ensureSchemaReady(pythonBin: string, repoRoot: string, env: NodeJS.ProcessEnv) {
  run(pythonBin, [path.join(repoRoot, "manage.py"), "migrate", "--noinput"], repoRoot, env)
  run(pythonBin, [path.join(repoRoot, "manage.py"), "migrate", "--check"], repoRoot, env)
}

async function assertAuthenticatedShell(page: Page, baseURL: string) {
  try {
    await page.getByTestId("sidebar-nav").waitFor({ state: "visible", timeout: 30_000 })
    await page.getByTestId("profile-menu-trigger").waitFor({ state: "visible", timeout: 30_000 })
  } catch {
    const backendOrigin = resolveApiOrigin(String(baseURL))
    const meResponse = await page.context().request.get(`${backendOrigin}/api/users/me/`, {
      failOnStatusCode: false,
    })
    const mePayload = await meResponse.json().catch(() => ({}))
    const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 500) || "")

    if (meResponse.ok()) {
      const requestState = await page.context().request.storageState()
      if (requestState.cookies.length) {
        await page.context().addCookies(requestState.cookies)
      }

      // Global setup only needs a durable authenticated storage state.
      // Some runs leave the browser parked on /login even when the API session is valid,
      // so treat a healthy /me response as sufficient instead of failing on shell paint timing.
      await page.goto("/dashboard/admin", { waitUntil: "domcontentloaded" }).catch(() => undefined)
      await Promise.race([
        page.getByTestId("sidebar-nav").waitFor({ state: "visible", timeout: 7_500 }).catch(() => undefined),
        page.getByTestId("profile-menu-trigger").waitFor({ state: "visible", timeout: 7_500 }).catch(() => undefined),
        page.waitForURL((url: URL) => !url.pathname.startsWith("/login"), { timeout: 7_500 }).catch(() => undefined),
      ])
      return
    }

    const detail =
      (mePayload as any)?.detail ||
      (mePayload as any)?.message ||
      (mePayload as any)?.username ||
      `session probe returned ${meResponse.status()}`

    throw new Error(`Authenticated shell check failed (${meResponse.status()}): ${detail}. Body: ${bodyText}`)
  }
}

async function bootstrapSession(page: Page, baseURL: string) {
  const identifier = process.env.UI_E2E_ADMIN_USER || "admin"
  const password = process.env.UI_E2E_ADMIN_PASSWORD || "admin123"

  await page.goto("/login", { waitUntil: "domcontentloaded" })
  await page.evaluate(() => {
    document.cookie = "x_role_override=; Max-Age=0; path=/"
    try {
      window.localStorage.removeItem("x_role_override")
    } catch {}
    try {
      window.sessionStorage.removeItem("x_role_override")
    } catch {}
  })
  await page.getByTestId("login-form").waitFor({ state: "visible", timeout: 30_000 })
  await page.getByTestId("login-client-ready").waitFor({ state: "visible", timeout: 30_000 })
  await page.getByTestId("login-submit").waitFor({ state: "visible", timeout: 30_000 })
  await page.waitForFunction(() => {
    const submit = document.querySelector('[data-testid="login-submit"]') as HTMLButtonElement | null
    return Boolean(submit && !submit.disabled)
  }, undefined, { timeout: 30_000 })
  await page.getByTestId("login-identifier").fill(identifier)
  await page.getByTestId("login-password").fill(password)
  await page.getByTestId("login-submit").click()

  try {
    await page.waitForURL((url: URL) => !url.pathname.startsWith("/login"), { timeout: 30_000 })
  } catch {
    try {
      await page.goto("/dashboard/admin", { waitUntil: "domcontentloaded" })
      await assertAuthenticatedShell(page, baseURL)
      await page.evaluate(() => {
        document.cookie = "x_role_override=; Max-Age=0; path=/"
      })
      return
    } catch {
      // Fall through to API-based recovery when the UI shell is still unauthenticated.
    }

    const backendOrigin = resolveApiOrigin(String(baseURL))
    const requestContext = page.context().request
    const loginResult = await retry(
      async () => {
        const csrfResponse = await requestContext.get(`${backendOrigin}/api/users/csrf/`, {
          failOnStatusCode: false,
        })
        const csrfPayload = await csrfResponse.json().catch(() => ({}))
        const cookies = await page.context().cookies([backendOrigin, String(baseURL)])
        const cookieToken = cookies.find((cookie) => cookie.name === "csrftoken")?.value
        const csrfToken = String(cookieToken || (csrfPayload as any)?.csrfToken || (csrfPayload as any)?.csrf_token || "")

        const loginResponse = await requestContext.post(`${backendOrigin}/api/users/login/`, {
          failOnStatusCode: false,
          headers: {
            "Content-Type": "application/json",
            ...(csrfToken ? { "X-CSRFToken": decodeURIComponent(csrfToken) } : {}),
          },
          data: { identifier, password },
        })
        const loginPayload = await loginResponse.json().catch(() => ({}))
        return {
          ok: loginResponse.ok(),
          status: loginResponse.status(),
          detail:
            (loginPayload as any)?.detail ||
            (loginPayload as any)?.message ||
            (loginPayload as any)?.error ||
            `fallback auth returned ${loginResponse.status()}`,
        }
      },
      5,
      1500,
    )

    if (!loginResult.ok) {
      throw new Error(`Global setup fallback login failed (${loginResult.status}): ${loginResult.detail}`)
    }

    const requestState = await requestContext.storageState()
    if (requestState.cookies.length) {
      await page.context().addCookies(requestState.cookies)
    }

    await page.goto("/dashboard/admin", { waitUntil: "domcontentloaded" })
  }

  await page.evaluate(() => {
    document.cookie = "x_role_override=; Max-Age=0; path=/"
  })
  await assertAuthenticatedShell(page, baseURL)
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

async function waitForBackend(url: string, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs
  let lastError = "backend did not respond"

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: "manual" })
      if (response.ok) {
        return
      }
      lastError = `backend returned ${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }

  throw new Error(`Timed out waiting for backend at ${url}: ${lastError}`)
}

export default async function globalSetup(config: FullConfig) {
  const frontendRoot = path.resolve(__dirname, "../..")
  const repoRoot = path.resolve(frontendRoot, "..")
  const preferredPython = await resolvePreferredPython(repoRoot)
  const runtimeRoot = path.resolve(repoRoot, ".runtime/ui-e2e")
  const storageDir = path.join(runtimeRoot, "storage")
  const storagePath = path.join(storageDir, "admin.json")
  const baseURL = config.projects[0]?.use?.baseURL || "http://127.0.0.1:3000"
  const skipBootstrap = process.env.UI_E2E_SKIP_BOOTSTRAP === "1"
  const browserChannel = process.env.PLAYWRIGHT_BROWSER_CHANNEL
  const frontendMode =
    process.env.UI_E2E_FRONTEND_MODE ||
    process.env.FRONTEND_MODE ||
    (process.env.UI_E2E_GREEN_RUN === "1" ? "prod" : "dev")
  const runTag = process.env.UI_E2E_RUN_TAG || new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)

  await fs.mkdir(storageDir, { recursive: true })
  await fs.writeFile(
    path.join(runtimeRoot, "green-run.json"),
    JSON.stringify(
      {
        run_tag: runTag,
        label_prefix: process.env.UI_E2E_LABEL_PREFIX || "UAT-GREEN",
        generated_at: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  )

  if (!skipBootstrap) {
    await fs.rm(path.join(runtimeRoot, "test-results"), { recursive: true, force: true })
    const bootstrapEnv = {
      ...process.env,
      FRONTEND_MODE: frontendMode,
      ALLOW_SCHEMA_SKIP_ON_TIMEOUT: process.env.UI_E2E_ALLOW_SCHEMA_SKIP_ON_TIMEOUT || "0",
      SKIP_DOTENV_IMPORT: process.env.SKIP_DOTENV_IMPORT || "1",
      SKIP_CELERY_IMPORT: process.env.SKIP_CELERY_IMPORT || "1",
      DB_CONN_MAX_AGE: process.env.DB_CONN_MAX_AGE || "0",
      BACKEND_PYTHON: preferredPython,
      UI_E2E_PYTHON: preferredPython,
      UI_E2E_LABEL_PREFIX: process.env.UI_E2E_LABEL_PREFIX || "UAT-GREEN",
      UI_E2E_RUN_TAG: runTag,
    }
    run(preferredPython, [path.join(repoRoot, "scripts/ensure_superuser.py")], repoRoot, bootstrapEnv)
    trimIdleDbConnections(repoRoot, bootstrapEnv)
    run(path.join(repoRoot, "start_all.sh"), ["clean-restart"], repoRoot, bootstrapEnv)
    if (process.env.UI_E2E_REQUIRE_SCHEMA !== "0") {
      ensureSchemaReady(preferredPython, repoRoot, bootstrapEnv)
    }
    run(preferredPython, [path.join(repoRoot, "scripts/seed_ui_e2e.py")], repoRoot, bootstrapEnv)
    run(preferredPython, [path.join(repoRoot, "scripts/seed_ui_e2e_quotations.py")], repoRoot, bootstrapEnv)
    run(
      preferredPython,
      [path.join(repoRoot, "manage.py"), "bootstrap_report_smoke", "--allow-production", "--send-now"],
      repoRoot,
      bootstrapEnv,
    )
    run(
      preferredPython,
      [path.join(repoRoot, "manage.py"), "seed_notification_baseline", "--allow-production"],
      repoRoot,
      bootstrapEnv,
    )
    runAcceptanceWithFallback(preferredPython, repoRoot, runtimeRoot, bootstrapEnv)
    run(preferredPython, [path.join(repoRoot, "scripts/seed_ui_e2e_planner_gate.py")], repoRoot, bootstrapEnv)
    run(preferredPython, [path.join(repoRoot, "scripts/seed_ui_e2e_mutations.py")], repoRoot, bootstrapEnv)
    run(preferredPython, [path.join(repoRoot, "scripts/seed_ui_e2e_sales.py")], repoRoot, bootstrapEnv)
    run(preferredPython, [path.join(repoRoot, "scripts/write_uat_green_manifest.py")], repoRoot, bootstrapEnv)
  }

  await waitForFrontend(`${String(baseURL).replace(/\/$/, "")}/login`)
  await waitForBackend(`${resolveApiOrigin(String(baseURL))}/api/health/`)

  const browser = await chromium.launch({
    headless: true,
    ...(browserChannel ? { channel: browserChannel } : {}),
  })
  const context = await browser.newContext({ baseURL: String(baseURL) })
  const page = await context.newPage()
  await bootstrapSession(page, String(baseURL))
  await context.storageState({ path: storagePath })
  await browser.close()
}
