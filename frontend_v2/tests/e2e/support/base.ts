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
      const identifier = process.env.UI_E2E_ADMIN_USER || "admin"
      const password = process.env.UI_E2E_ADMIN_PASSWORD || "admin123"
      const backendOrigin = resolveApiOrigin(String(baseURL || "http://127.0.0.1:3000"))
      const requestContext = page.context().request
      const waitForShell = async (timeout = 10_000) => {
        await Promise.any([
          page.getByTestId("sidebar-nav").waitFor({ state: "visible", timeout }),
          page.getByTestId("profile-menu-trigger").waitFor({ state: "visible", timeout }),
          page.getByRole("button", { name: /logout/i }).waitFor({ state: "visible", timeout }),
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
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const csrfResponse = await requestContext.get(`${backendOrigin}/api/users/csrf/`, {
          failOnStatusCode: false,
        })
        const csrfPayload = await csrfResponse.json().catch(() => ({}))
        const requestStateBefore = await requestContext.storageState()
        const cookieToken = requestStateBefore.cookies.find((cookie) => cookie.name === "csrftoken")?.value
        const csrfToken = String(cookieToken || (csrfPayload as any)?.csrfToken || (csrfPayload as any)?.csrf_token || "")

        await requestContext.post(`${backendOrigin}/api/users/token/refresh/`, {
          failOnStatusCode: false,
          headers: {
            "Content-Type": "application/json",
            ...(csrfToken ? { "X-CSRFToken": decodeURIComponent(csrfToken) } : {}),
          },
          data: {},
        }).catch(() => undefined)

        let meResponse = await requestContext.get(`${backendOrigin}/api/users/me/`, {
          failOnStatusCode: false,
        })

        if (!meResponse.ok()) {
          await requestContext.post(`${backendOrigin}/api/users/login/`, {
            failOnStatusCode: false,
            headers: {
              "Content-Type": "application/json",
              ...(csrfToken ? { "X-CSRFToken": decodeURIComponent(csrfToken) } : {}),
            },
            data: { identifier, password },
          })
          meResponse = await requestContext.get(`${backendOrigin}/api/users/me/`, {
            failOnStatusCode: false,
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

        await page.waitForTimeout(Math.min(2_000 * (attempt + 1), 6_000))
      }

      if (!sessionProbe?.ok) {
        throw new Error(`Failed to establish authenticated UI session (${sessionProbe.status}): ${sessionProbe.detail}`)
      }

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
        () => page.getByRole("button", { name: /open erp|sign in|login/i }),
      ])

      await identifierField.fill(identifier)
      await passwordField.fill(password)
      await submitButton.click()
      await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 })
      await clearRoleOverride(page)
      await waitForShell(30_000)
    }

    page.on("pageerror", (error) => {
      issues.push({ type: "pageerror", message: error.stack || error.message })
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
