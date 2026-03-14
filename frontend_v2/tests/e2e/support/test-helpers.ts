import fs from "node:fs"
import path from "node:path"
import { expect, type Page, type TestInfo } from "@playwright/test"

export type Severity = "critical" | "high" | "medium" | "low"

const ROUTE_FAILURE_PATTERNS = [/internal server error/i, /page not found/i]

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

export async function loginViaUi(page: Page, identifier = process.env.UI_E2E_ADMIN_USER || "admin", password = process.env.UI_E2E_ADMIN_PASSWORD || "admin123") {
  await page.goto("/login", { waitUntil: "domcontentloaded" })
  await page.getByTestId("login-client-ready").waitFor({ state: "visible", timeout: 30_000 })
  await page.getByTestId("login-identifier").fill(identifier)
  await page.getByTestId("login-password").fill(password)
  await page.getByTestId("login-submit").click()
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 })
  await page.getByTestId("sidebar-nav").waitFor({ state: "visible", timeout: 30_000 })
}

export async function logoutViaUi(page: Page) {
  await page.getByTestId("profile-menu-trigger").click()
  await page.getByTestId("profile-menu-logout").click()
  await page.waitForURL(/\/login/, { timeout: 30_000 })
}

export async function switchRole(page: Page, roleName: string, landingPath: string) {
  await page.getByTestId("role-switcher-trigger").click()
  const option = page.getByRole("option", { name: roleName })
  await option.waitFor({ state: "visible", timeout: 15_000 })
  await option.click({ noWaitAfter: true })
  await page.waitForURL((url) => url.pathname === landingPath, { timeout: 30_000 })
  await assertHealthyPage(page)
}

export async function assertHealthyPage(page: Page) {
  await page.waitForLoadState("domcontentloaded")
  const body = page.locator("body")
  for (const pattern of ROUTE_FAILURE_PATTERNS) {
    await expect(body).not.toContainText(pattern)
  }
}

export async function collectSidebarRoutes(page: Page) {
  await page.getByTestId("sidebar-nav").waitFor({ state: "visible", timeout: 30_000 })
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

function normalizeApiPath(url: string): string {
  if (!url.startsWith("/api/")) return url
  const [pathName, query] = url.split("?")
  const normalizedPath = pathName.endsWith("/") ? pathName : `${pathName}/`
  return normalizedPath + (query ? `?${query}` : "")
}

function resolveBackendOrigin(page: Page): string {
  const configuredBase = String(process.env.UI_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || "").trim()
  if (/^https?:\/\//i.test(configuredBase)) {
    return configuredBase.replace(/\/+$/, "")
  }

  const fallbackUiBase = String(process.env.UI_BASE_URL || "http://127.0.0.1:3000")
  const current = new URL(page.url() === "about:blank" ? fallbackUiBase : page.url())
  const apiPort = String(process.env.NEXT_PUBLIC_API_PORT || "8000").trim() || "8000"
  return `${current.protocol}//${current.hostname}:${apiPort}`
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
      const response = await fetch(String(url || ""), {
        method: init?.method || "GET",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(init?.headers || {}),
        },
        body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      })
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
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await trigger.click()
      const optionLocator =
        typeof option === "string"
          ? page.getByRole("option", { name: new RegExp(`^${escapeRegex(option)}(?:\\s*\\(|\\s*[•-]|\\s*$)`, "i") }).first()
          : page.getByRole("option", { name: option }).first()
      await optionLocator.waitFor({ state: "visible", timeout: 4_000 })
      await optionLocator.click()
      return
    } catch (error) {
      lastError = error
      if (await matchesTriggerValue()) return
      await page.keyboard.press("Escape").catch(() => undefined)
      await page.waitForTimeout(400)
    }
  }

  if (await matchesTriggerValue()) return
  throw lastError instanceof Error ? lastError : new Error(`Failed to select option for ${testId}`)
}
