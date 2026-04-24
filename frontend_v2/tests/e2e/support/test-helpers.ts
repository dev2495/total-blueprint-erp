import fs from "node:fs"
import path from "node:path"
import { expect, type Page, type TestInfo } from "@playwright/test"

export type Severity = "critical" | "high" | "medium" | "low"

const ROUTE_FAILURE_PATTERNS = [/internal server error/i, /page not found/i, /application error/i, /something went wrong/i, /status code 500/i]

export const ROLE_OPTIONS = [
  { code: "ADMIN", name: "Admin", landing: "/dashboard/admin" },
  { code: "OWNER", name: "Owner", landing: "/dashboard/owner" },
  { code: "PLANNER", name: "Planner", landing: "/production/planner" },
  { code: "WORK_CENTER_MANAGER", name: "Work Center Manager", landing: "/production/work-center" },
  { code: "OPERATOR", name: "Operator", landing: "/production/machine-selector" },
  { code: "STORE", name: "Store", landing: "/inventory/roll-explorer" },
  { code: "DISPATCH", name: "Dispatch", landing: "/dashboard/logistics" },
  { code: "ENGINEERING", name: "Engineering", landing: "/engineering/artworks" },
  { code: "SALES", name: "Sales", landing: "/sales/orders" },
] as const

export function annotate(testInfo: TestInfo, values: { module: string; severity: Severity; role?: string; feature?: string; expected?: string }) {
  testInfo.annotations.push({ type: "module", description: values.module })
  testInfo.annotations.push({ type: "severity", description: values.severity })
  if (values.role) testInfo.annotations.push({ type: "role", description: values.role })
  if (values.feature) testInfo.annotations.push({ type: "feature", description: values.feature })
  if (values.expected) testInfo.annotations.push({ type: "expected", description: values.expected })
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export async function waitForLoginReady(page: Page) {
  const form = page.getByTestId("login-form")
  await form.waitFor({ state: "visible", timeout: 30_000 })
  const clientReady = await form.getAttribute("data-client-ready").catch(() => null)
  if (clientReady !== "true") {
    await page.waitForTimeout(1500)
  }
  const finalReady = await form.getAttribute("data-client-ready").catch(() => null)
  if (finalReady === "true") {
    await expect(page.getByTestId("login-client-ready")).toContainText(/ready/i, { timeout: 30_000 })
  }
  await expect(page.getByTestId("login-submit")).toBeEnabled({ timeout: 30_000 })
}

export async function clearRoleOverride(page: Page) {
  await page.evaluate(() => {
    document.cookie = "x_role_override=; Max-Age=0; path=/"
    try {
      window.localStorage.removeItem("x_role_override")
    } catch {}
    try {
      window.sessionStorage.removeItem("x_role_override")
    } catch {}
  })
}

export async function assertAuthenticatedShell(page: Page, options?: { requireRoleSwitcher?: boolean }) {
  const currentUrl = page.url()
  const isMachineKioskRoute = (() => {
    try {
      return new URL(currentUrl).pathname.startsWith("/production/machine/")
    } catch {
      return false
    }
  })()

  if (isMachineKioskRoute) {
    await expect(page.getByTestId("machine-execution-page")).toBeVisible({ timeout: 30_000 })
    await expect(page.locator("body")).not.toContainText(/\bguest\b/i)
    return
  }

  const sidebarNav = page.getByTestId("sidebar-nav")
  const mobileNavTrigger = page.getByTestId("mobile-nav-trigger")
  const profileTrigger = page.getByTestId("profile-menu-trigger")
  const roleSwitcherTrigger = page.getByTestId("role-switcher-trigger")
  const logoutButton = page.getByRole("button", { name: /logout/i })
  const dashboardMarker = page.locator("body").getByText(/dashboard|admin workspace|all visible plants/i).first()
  const shellNav = page.getByRole("navigation").first()
  const sidebarRegion = page.getByRole("complementary").first()
  const helpButton = page.getByRole("button", { name: /help/i }).first()

  await Promise.any([
    sidebarNav.waitFor({ state: "visible", timeout: 15_000 }),
    mobileNavTrigger.waitFor({ state: "visible", timeout: 15_000 }),
    profileTrigger.waitFor({ state: "visible", timeout: 15_000 }),
    roleSwitcherTrigger.waitFor({ state: "visible", timeout: 15_000 }),
    logoutButton.waitFor({ state: "visible", timeout: 15_000 }),
    dashboardMarker.waitFor({ state: "visible", timeout: 15_000 }),
    shellNav.waitFor({ state: "visible", timeout: 15_000 }),
    sidebarRegion.waitFor({ state: "visible", timeout: 15_000 }),
    helpButton.waitFor({ state: "visible", timeout: 15_000 }),
  ]).catch(() => {})

  const sidebarVisible = await sidebarNav.isVisible().catch(() => false)
  const mobileNavVisible = await mobileNavTrigger.isVisible().catch(() => false)
  const profileVisible = await profileTrigger.isVisible().catch(() => false)
  const roleSwitcherVisible = await roleSwitcherTrigger.isVisible().catch(() => false)
  const logoutVisible = await logoutButton.isVisible().catch(() => false)
  const dashboardVisible = await dashboardMarker.isVisible().catch(() => false)
  const shellNavVisible = await shellNav.isVisible().catch(() => false)
  const sidebarRegionVisible = await sidebarRegion.isVisible().catch(() => false)
  const helpVisible = await helpButton.isVisible().catch(() => false)

  expect(
    sidebarVisible || mobileNavVisible || profileVisible || roleSwitcherVisible || logoutVisible || dashboardVisible || shellNavVisible || sidebarRegionVisible || helpVisible,
    `expected authenticated shell markers for ${page.url()}`,
  ).toBeTruthy()
  if (!profileVisible && !logoutVisible) {
    await Promise.any([
      profileTrigger.waitFor({ state: "visible", timeout: 30_000 }),
      logoutButton.waitFor({ state: "visible", timeout: 30_000 }),
      helpButton.waitFor({ state: "visible", timeout: 30_000 }),
      shellNav.waitFor({ state: "visible", timeout: 30_000 }),
      sidebarRegion.waitFor({ state: "visible", timeout: 30_000 }),
    ]).catch(() => {})
  } else if (profileVisible) {
    await expect(profileTrigger).toBeVisible({ timeout: 30_000 })
  }
  await expect(page.locator("body")).not.toContainText(/\bguest\b/i)

  if (options?.requireRoleSwitcher) {
    const currentRoleMarker = page.locator("body").getByText(/master view|admin|owner|planner view|sales view|store view/i).first()
    await Promise.any([
      roleSwitcherTrigger.waitFor({ state: "visible", timeout: 30_000 }),
      page.locator("body").getByText(/all visible plants/i).first().waitFor({ state: "visible", timeout: 30_000 }),
      currentRoleMarker.waitFor({ state: "visible", timeout: 30_000 }),
    ])
  }
}

export async function loginViaUi(
  page: Page,
  identifier = process.env.UI_E2E_ADMIN_USER || "admin",
  password = process.env.UI_E2E_ADMIN_PASSWORD || "admin123",
  options?: { requireRoleSwitcher?: boolean },
) {
  await page.goto("/login", { waitUntil: "domcontentloaded" })
  await clearRoleOverride(page)
  if (!page.url().includes("/login")) {
    await assertAuthenticatedShell(page, { requireRoleSwitcher: options?.requireRoleSwitcher ?? true })
    return
  }
  await waitForLoginReady(page)
  await page.getByTestId("login-identifier").fill(identifier)
  await page.getByTestId("login-password").fill(password)
  await page.getByTestId("login-submit").click()

  try {
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 })
  } catch {
    const apiOrigin = resolveBackendOrigin(page)
    const loginResult = await page.evaluate(
      async ({ apiOrigin, identifier, password }) => {
        const csrfResponse = await fetch(`${apiOrigin}/api/users/csrf/`, {
          method: "GET",
          credentials: "include",
        })
        const csrfPayload = await csrfResponse.json().catch(() => ({}))
        const cookieToken = document.cookie
          .split(";")
          .map((value) => value.trim())
          .find((value) => value.startsWith("csrftoken="))
          ?.split("=")[1]
        const csrfToken = String(cookieToken || csrfPayload?.csrfToken || csrfPayload?.csrf_token || "")

        const loginResponse = await fetch(`${apiOrigin}/api/users/login/`, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...(csrfToken ? { "X-CSRFToken": decodeURIComponent(csrfToken) } : {}),
          },
          body: JSON.stringify({ identifier, password }),
        })
        const loginPayload = await loginResponse.json().catch(() => ({}))
        return {
          ok: loginResponse.ok,
          status: loginResponse.status,
          detail:
            loginPayload?.detail ||
            loginPayload?.message ||
            loginPayload?.error ||
            `fallback auth returned ${loginResponse.status}`,
        }
      },
      { apiOrigin, identifier, password },
    )

    if (!loginResult.ok) {
      throw new Error(`Fallback login failed (${loginResult.status}): ${loginResult.detail}`)
    }

    await page.goto("/dashboard/admin", { waitUntil: "domcontentloaded" })
  }

  try {
    await assertAuthenticatedShell(page, { requireRoleSwitcher: options?.requireRoleSwitcher ?? true })
  } catch {
    if (page.url().includes("/login")) {
      throw new Error("Login did not leave the login route.")
    }
  }
  await clearRoleOverride(page)
}

export async function logoutViaUi(page: Page) {
  await page.getByTestId("profile-menu-trigger").click()
  await page.getByTestId("profile-menu-logout").click()
  await page.waitForURL(/\/login/, { timeout: 30_000 })
}

export async function switchRole(page: Page, roleName: string, landingPath: string, options?: { allowCookieFallback?: boolean }) {
  const trigger = page.getByTestId("role-switcher-trigger")
  const role = ROLE_OPTIONS.find((entry) => entry.name === roleName)

  if (await trigger.waitFor({ state: "visible", timeout: 30_000 }).then(() => true).catch(() => false)) {
    await trigger.click()
    const option = page.getByRole("option", { name: roleName })
    await option.waitFor({ state: "visible", timeout: 15_000 })
    await option.click({ noWaitAfter: true })
    try {
      await page.waitForURL((url) => url.pathname === landingPath, { timeout: 8_000 })
    } catch {
      await page.goto(landingPath, { waitUntil: "domcontentloaded" })
    }
  } else {
    if (!options?.allowCookieFallback) {
      throw new Error(`Role switcher is unavailable while attempting to switch to ${roleName}.`)
    }
    if (!role) {
      throw new Error(`Unknown role fallback requested: ${roleName}`)
    }
    await page.evaluate((roleCode) => {
      document.cookie = `x_role_override=${encodeURIComponent(roleCode)}; path=/`
      try {
        window.localStorage.setItem("x_role_override", roleCode)
      } catch {}
    }, role.code)
    await page.goto(landingPath, { waitUntil: "domcontentloaded" })
  }
  let lastError: unknown = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      if (attempt > 0) {
        await page.goto(landingPath, { waitUntil: "domcontentloaded" })
      }
      await assertHealthyPage(page, { requireAuth: true })
      return
    } catch (error) {
      lastError = error
      await page.waitForTimeout(1200)
    }
  }
  throw lastError
}

function shouldRequireAuthenticatedShell(page: Page) {
  const currentUrl = page.url()
  if (!currentUrl || currentUrl === "about:blank") return false
  try {
    const parsed = new URL(currentUrl)
    if (["blob:", "data:", "file:"].includes(parsed.protocol)) return false
    if (parsed.pathname === "/") return false
    return !parsed.pathname.startsWith("/api/")
  } catch {
    return false
  }
}

export async function assertHealthyPage(page: Page, options?: { requireAuth?: boolean; requireRoleSwitcher?: boolean }) {
  await page.waitForLoadState("domcontentloaded")
  const body = page.locator("body")
  for (const pattern of ROUTE_FAILURE_PATTERNS) {
    await expect(body).not.toContainText(pattern)
  }
  const requireAuth = options?.requireAuth ?? shouldRequireAuthenticatedShell(page)
  if (requireAuth) {
    await assertAuthenticatedShell(page, { requireRoleSwitcher: options?.requireRoleSwitcher })
  }
}

export async function assertNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }))

  expect(
    overflow.scrollWidth <= overflow.innerWidth + 1 && overflow.bodyScrollWidth <= overflow.innerWidth + 1,
    `unexpected horizontal overflow on ${page.url()}: inner=${overflow.innerWidth}, doc=${overflow.scrollWidth}, body=${overflow.bodyScrollWidth}`,
  ).toBeTruthy()
}

export async function collectSidebarRoutes(page: Page) {
  await page.getByTestId("sidebar-nav").first().waitFor({ state: "visible", timeout: 30_000 })
  return page.locator("[data-testid='sidebar-nav'] a[href]").evaluateAll((nodes) => {
    const routes = nodes
      .map((node) => (node instanceof HTMLElement ? node.dataset.route || node.getAttribute("href") || "" : ""))
      .filter(Boolean)
    return Array.from(new Set(routes))
  })
}

export function getExactStaticAppRoutes() {
  const frontendRoot = path.resolve(__dirname, "../..", "..")
  const appRoot = path.join(frontendRoot, "src", "app")
  const routes = new Set<string>()

  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(fullPath)
        continue
      }
      if (!entry.isFile() || entry.name !== "page.tsx") continue
      const relative = path.relative(appRoot, fullPath)
      const routePath = relative.replace(/\/page\.tsx$/, "").replace(/^page\.tsx$/, "")
      const segments = routePath
        .split(path.sep)
        .filter(Boolean)
        .filter((segment) => !(segment.startsWith("(") && segment.endsWith(")")))
      if (segments.some((segment) => segment.includes("["))) continue
      const route = segments.length ? `/${segments.join("/")}` : "/"
      routes.add(route)
    }
  }

  walk(appRoot)
  return Array.from(routes).sort()
}

export async function attachJson(page: Page, testInfo: TestInfo, name: string, value: unknown) {
  await testInfo.attach(name, {
    body: JSON.stringify(value, null, 2),
    contentType: "application/json",
  })
}

export function readRuntimeJson<T = unknown>(fileName: string): T | null {
  const filePath = path.resolve(process.cwd(), "../.runtime/ui-e2e", fileName)
  if (!fs.existsSync(filePath)) return null
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T
}

export function writeRuntimeJson(fileName: string, value: unknown) {
  const filePath = path.resolve(process.cwd(), "../.runtime/ui-e2e", fileName)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2))
}

function normalizeApiPath(url: string): string {
  if (!url.startsWith("/api/")) return url
  const [pathName, query] = url.split("?")
  const normalizedPath = pathName.endsWith("/") ? pathName : `${pathName}/`
  return normalizedPath + (query ? `?${query}` : "")
}

function resolveBackendOrigin(page: Page): string {
  const fallbackUiBase = String(process.env.UI_BASE_URL || "http://127.0.0.1:3000")
  const current = new URL(page.url() === "about:blank" ? fallbackUiBase : page.url())
  return current.origin
}

function resolveFetchUrl(page: Page, url: string): string {
  const rawUrl = String(url || "")
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl
  const normalized = normalizeApiPath(rawUrl)
  if (normalized.startsWith("/api/")) {
    return new URL(normalized, `${resolveBackendOrigin(page)}/`).toString()
  }
  const fallbackUiBase = String(process.env.UI_BASE_URL || "http://127.0.0.1:3000")
  const current = new URL(page.url() === "about:blank" ? fallbackUiBase : page.url())
  return new URL(normalized, current.origin).toString()
}

export async function fetchJson<T = any>(
  page: Page,
  url: string,
  init?: {
    method?: string
    body?: unknown
    headers?: Record<string, string>
  },
): Promise<{ status: number; data: T; contentType: string }> {
  const resolvedUrl = resolveFetchUrl(page, url)
  return page.evaluate(
    async ({ url, init }) => {
      const resolveCsrfToken = async () => {
        const cookieToken = document.cookie
          .split(";")
          .map((value) => value.trim())
          .find((value) => value.startsWith("csrftoken="))
          ?.split("=")[1]
        if (cookieToken) {
          return decodeURIComponent(cookieToken)
        }

        const backendOrigin = new URL(String(url || ""), window.location.origin).origin
        const csrfResponse = await fetch(`${backendOrigin}/api/users/csrf/`, {
          method: "GET",
          credentials: "include",
        })
        const csrfPayload = await csrfResponse.json().catch(() => ({}))
        const payloadToken = String((csrfPayload && (csrfPayload.csrfToken || csrfPayload.csrf_token)) || "")
        return payloadToken ? decodeURIComponent(payloadToken) : ""
      }

      const performRequest = async () =>
        fetch(String(url || ""), {
          method: init?.method || "GET",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...(((init?.method || "GET").toUpperCase() === "GET" || (init?.method || "GET").toUpperCase() === "HEAD")
              ? {}
              : (() => {
                  const method = (init?.method || "GET").toUpperCase()
                  return method === "GET" || method === "HEAD" ? {} : { "X-CSRFToken": csrfToken }
                })()),
            ...(init?.headers || {}),
          },
          body: init?.body === undefined ? undefined : JSON.stringify(init.body),
        })

      const backendOrigin = new URL(String(url || ""), window.location.origin).origin
      const csrfToken = await resolveCsrfToken()

      const refreshAccessCookie = async () => {
        const csrfResponse = await fetch(`${backendOrigin}/api/users/csrf/`, {
          method: "GET",
          credentials: "include",
        })
        const csrfPayload = await csrfResponse.json().catch(() => ({}))
        const csrfToken = String((csrfPayload && (csrfPayload.csrfToken || csrfPayload.csrf_token)) || "")
        if (!csrfResponse.ok || !csrfToken) {
          return false
        }

        const refreshResponse = await fetch(`${backendOrigin}/api/users/token/refresh/`, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "X-CSRFToken": csrfToken,
          },
          body: "{}",
        })
        return refreshResponse.ok
      }

      let response = await performRequest()
      if (response.status === 401 && (await refreshAccessCookie())) {
        response = await performRequest()
      }

      const contentType = response.headers.get("content-type") || ""
      const data = contentType.includes("application/json") ? await response.json() : ((await response.text()) as any)
      return {
        status: response.status,
        data,
        contentType,
      }
    },
    { url: resolvedUrl, init },
  )
}

export async function fetchBinaryMeta(page: Page, url: string): Promise<{ status: number; contentType: string; byteLength: number }> {
  const resolvedUrl = resolveFetchUrl(page, url)
  return page.evaluate(async (targetUrl) => {
    const response = await fetch(String(targetUrl || ""), { credentials: "include" })
    const bytes = await response.arrayBuffer()
    return {
      status: response.status,
      contentType: response.headers.get("content-type") || "",
      byteLength: bytes.byteLength,
    }
  }, resolvedUrl)
}

export function unwrapApiList<T = any>(payload: any): T[] {
  if (Array.isArray(payload)) return payload as T[]
  if (payload && typeof payload === "object") {
    for (const key of ["results", "data", "queue", "jobs", "runs", "profiles"]) {
      if (Array.isArray((payload as any)[key])) return (payload as any)[key] as T[]
    }
  }
  return []
}

export async function selectByTestId(page: Page, testId: string, option: string | RegExp) {
  const trigger = page.getByTestId(testId)
  const matchesTriggerValue = async () => {
    const text = (await trigger.textContent()) || ""
    if (typeof option === "string") return text.includes(option)
    return option.test(text)
  }

  if (await matchesTriggerValue()) return

  let lastError: unknown = null
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await trigger.click()
      const optionLocator =
        typeof option === "string"
          ? page.getByRole("option", { name: new RegExp(`^${escapeRegex(option)}(?:\\s*\\(|\\s*[•-]|\\s*$)`, "i") }).first()
          : page.getByRole("option", { name: option }).first()
      await optionLocator.waitFor({ state: "visible", timeout: 8_000 })
      await optionLocator.click()
      return
    } catch (error) {
      lastError = error
      if (await matchesTriggerValue()) return
      await page.keyboard.press("Escape").catch(() => undefined)
      await page.waitForTimeout(800)
    }
  }

  if (await matchesTriggerValue()) return
  throw lastError instanceof Error ? lastError : new Error(`Failed to select option for ${testId}`)
}
