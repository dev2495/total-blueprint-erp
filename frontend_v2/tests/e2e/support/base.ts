import { expect, test as base } from "@playwright/test"
import { clearRoleOverride } from "./test-helpers"

type RuntimeIssue = {
  type: "pageerror" | "response"
  message: string
}

function resolveApiOrigin(baseURL: string) {
  const parsed = new URL(baseURL)
  const apiPort = String(process.env.UI_E2E_API_PORT || process.env.NEXT_PUBLIC_API_PORT || "8000").trim() || "8000"
  return `${parsed.protocol}//${parsed.hostname}:${apiPort}`
}

export const test = base.extend<{ autoAuth: boolean }>({
  autoAuth: [true, { option: true }],
  page: async ({ page, baseURL, autoAuth }, use, testInfo) => {
    const issues: RuntimeIssue[] = []
    const ensureAuthenticatedSession = async () => {
      if (testInfo.timeout < 150_000) {
        testInfo.setTimeout(150_000)
      }
      const identifier = process.env.UI_E2E_ADMIN_USER || "admin"
      const password = process.env.UI_E2E_ADMIN_PASSWORD || "admin123"
      const backendOrigin = resolveApiOrigin(String(baseURL || "http://127.0.0.1:3000"))
      const requestContext = page.context().request
      const authRequestTimeout = 25_000
      const authAttempts = 5
      const authRetryDelay = async (attempt: number) => {
        await page.waitForTimeout(Math.min(2_000 * (attempt + 1), 8_000))
      }
      const describeAuthError = (error: unknown) => (error instanceof Error ? error.message : String(error))
      const waitForShell = async (timeout = 10_000) => {
        await Promise.any([
          page.getByTestId("sidebar-nav").waitFor({ state: "visible", timeout }),
          page.getByTestId("profile-menu-trigger").waitFor({ state: "visible", timeout }),
          page.getByRole("button", { name: /logout/i }).waitFor({ state: "visible", timeout }),
          page.getByRole("navigation").first().waitFor({ state: "visible", timeout }),
          page.getByRole("complementary").first().waitFor({ state: "visible", timeout }),
          page.getByRole("button", { name: /help/i }).first().waitFor({ state: "visible", timeout }),
          page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout }),
        ])
      }
      const resolveVisibleLocator = async (candidates: Array<() => ReturnType<typeof page.locator>>) => {
        for (const candidate of candidates) {
          const locator = candidate()
          if (await locator.first().isVisible().catch(() => false)) {
            return locator.first()
          }
        }
        return candidates[0]().first()
      }

      await page.goto("/login", { waitUntil: "domcontentloaded" })
      await clearRoleOverride(page)
      let sessionProbe: { ok: boolean; status: number; detail: string } | undefined
      for (let attempt = 0; attempt < authAttempts; attempt += 1) {
        try {
          const csrfResponse = await requestContext.get(`${backendOrigin}/api/users/csrf/`, {
            failOnStatusCode: false,
            timeout: authRequestTimeout,
          })
          const csrfPayload = await csrfResponse.json().catch(() => ({}))
          const requestStateBefore = await requestContext.storageState()
          const cookieToken = requestStateBefore.cookies.find((cookie) => cookie.name === "csrftoken")?.value
          const csrfToken = String(cookieToken || (csrfPayload as any)?.csrfToken || (csrfPayload as any)?.csrf_token || "")

          await requestContext.post(`${backendOrigin}/api/users/token/refresh/`, {
            failOnStatusCode: false,
            timeout: authRequestTimeout,
            headers: {
              "Content-Type": "application/json",
              ...(csrfToken ? { "X-CSRFToken": decodeURIComponent(csrfToken) } : {}),
            },
            data: {},
          }).catch(() => undefined)

          let meResponse = await requestContext.get(`${backendOrigin}/api/users/me/`, {
            failOnStatusCode: false,
            timeout: authRequestTimeout,
          })

          if (!meResponse.ok()) {
            await requestContext.post(`${backendOrigin}/api/users/login/`, {
              failOnStatusCode: false,
              timeout: authRequestTimeout,
              headers: {
                "Content-Type": "application/json",
                ...(csrfToken ? { "X-CSRFToken": decodeURIComponent(csrfToken) } : {}),
              },
              data: { identifier, password },
            })
            meResponse = await requestContext.get(`${backendOrigin}/api/users/me/`, {
              failOnStatusCode: false,
              timeout: authRequestTimeout,
            })
          }

          const mePayload = await meResponse.json().catch(() => ({}))
          sessionProbe = {
            ok: meResponse.ok(),
            status: meResponse.status(),
            detail:
              (mePayload as any)?.detail ||
              (mePayload as any)?.message ||
              (mePayload as any)?.username ||
              `session probe returned ${meResponse.status()}`,
          }

          if (sessionProbe.ok || sessionProbe.status !== 429) {
            break
          }
        } catch (error) {
          sessionProbe = {
            ok: false,
            status: 0,
            detail: `auth probe attempt ${attempt + 1} failed: ${describeAuthError(error)}`,
          }
        }

        if (attempt === authAttempts - 1) {
          break
        }

        await authRetryDelay(attempt)
      }

      if (sessionProbe?.ok) {
        const requestState = await requestContext.storageState()
        if (requestState.cookies.length) {
          await page.context().addCookies(requestState.cookies)
        }
        await page.goto("/dashboard/admin", { waitUntil: "domcontentloaded" })
        await clearRoleOverride(page)
        try {
          await waitForShell(7_500)
          return
        } catch {
          // Some runs keep the browser on /login even after the API session is valid.
          // Fall back to the real UI login flow to restore the client auth shell.
        }
      }

      await page.goto("/login", { waitUntil: "domcontentloaded" })
      const identifierField = await resolveVisibleLocator([
        () => page.getByTestId("login-identifier"),
        () => page.getByLabel(/email|identifier/i),
        () => page.locator('input[type="email"]'),
        () => page.locator('input[name="identifier"]'),
      ])
      const passwordField = await resolveVisibleLocator([
        () => page.getByTestId("login-password"),
        () => page.getByLabel(/password/i),
        () => page.locator('input[type="password"]'),
      ])
      const submitButton = await resolveVisibleLocator([
        () => page.getByTestId("login-submit"),
        () => page.getByRole("button", { name: /enter workspace|open erp|sign in|login/i }),
      ])

      await identifierField.fill(identifier)
      await passwordField.fill(password)
      await submitButton.click()
      try {
        await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 })
      } catch {
        const loginResult = await page.evaluate(
          async ({ backendOrigin, identifier, password }) => {
            const csrfResponse = await fetch(`${backendOrigin}/api/users/csrf/`, {
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
            const loginResponse = await fetch(`${backendOrigin}/api/users/login/`, {
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
          { backendOrigin, identifier, password },
        )
        if (!loginResult.ok) {
          throw new Error(`Fallback login failed (${loginResult.status}): ${loginResult.detail}`)
        }
        await page.goto("/dashboard/admin", { waitUntil: "domcontentloaded" })
      }
      await clearRoleOverride(page)
      await waitForShell(30_000)
    }

    page.on("pageerror", (error) => {
      const detail = error.stack || error.message
      issues.push({ type: "pageerror", message: `${page.url()}: ${detail}` })
    })

    page.on("response", (response) => {
      const url = response.url()
      if (baseURL && !url.startsWith(String(baseURL))) return
      if (response.status() >= 500) {
        issues.push({ type: "response", message: `${response.status()} ${url}` })
      }
    })

    if (autoAuth) {
      await ensureAuthenticatedSession()
    }
    await use(page)

    if (issues.length) {
      await testInfo.attach("runtime-issues", {
        body: issues.map((issue) => `${issue.type}: ${issue.message}`).join("\n"),
        contentType: "text/plain",
      })
    }
    expect(issues, issues.map((issue) => `${issue.type}: ${issue.message}`).join("\n") || "unexpected runtime issues").toEqual([])
  },
})

export { expect }
