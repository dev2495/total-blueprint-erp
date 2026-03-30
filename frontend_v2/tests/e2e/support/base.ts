import { expect, test as base } from "@playwright/test"
import { clearRoleOverride } from "./test-helpers"

type RuntimeIssue = {
  type: "pageerror" | "response"
  message: string
}

export const test = base.extend({
  page: async ({ page, baseURL }, use, testInfo) => {
    const issues: RuntimeIssue[] = []
    const ensureAuthenticatedSession = async () => {
      const identifier = process.env.UI_E2E_ADMIN_USER || "admin"
      const password = process.env.UI_E2E_ADMIN_PASSWORD || "admin123"
      const waitForShell = async (timeout = 10_000) => {
        await page.getByTestId("sidebar-nav").waitFor({ state: "visible", timeout })
        await page.getByTestId("profile-menu-trigger").waitFor({ state: "visible", timeout })
      }

      await page.goto("/login", { waitUntil: "domcontentloaded" })
      await clearRoleOverride(page)
      let sessionProbe: { ok: boolean; status: number; detail: string } | undefined
      for (let attempt = 0; attempt < 5; attempt += 1) {
        sessionProbe = await page.evaluate(
          async ({ identifier, password }) => {
          const withJson = async (responsePromise: Promise<Response>) => {
            const response = await responsePromise
            const payload = await response.json().catch(() => ({}))
            return { response, payload }
          }

          const { payload: csrfPayload } = await withJson(
            fetch("/api/users/csrf/", {
              method: "GET",
              credentials: "include",
            }),
          )
          const cookieToken = document.cookie
            .split(";")
            .map((value) => value.trim())
            .find((value) => value.startsWith("csrftoken="))
            ?.split("=")[1]
          const csrfToken = String(cookieToken || csrfPayload?.csrfToken || csrfPayload?.csrf_token || "")

          await fetch("/api/users/token/refresh/", {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
              ...(csrfToken ? { "X-CSRFToken": decodeURIComponent(csrfToken) } : {}),
            },
            body: "{}",
          }).catch(() => undefined)

          let meResponse = await fetch("/api/users/me/", {
            method: "GET",
            credentials: "include",
          }).catch(() => null)

          if (!meResponse?.ok) {
            await withJson(
              fetch("/api/users/login/", {
                method: "POST",
                credentials: "include",
                headers: {
                  "Content-Type": "application/json",
                  ...(csrfToken ? { "X-CSRFToken": decodeURIComponent(csrfToken) } : {}),
                },
                body: JSON.stringify({ identifier, password }),
              }),
            )
            meResponse = await fetch("/api/users/me/", {
              method: "GET",
              credentials: "include",
            }).catch(() => null)
          }

          if (!meResponse) {
            return { ok: false, status: 0, detail: "me request did not complete" }
          }
          const mePayload = await meResponse.json().catch(() => ({}))
          return {
            ok: meResponse.ok,
            status: meResponse.status,
            detail:
              mePayload?.detail ||
              mePayload?.message ||
              mePayload?.username ||
              `session probe returned ${meResponse.status}`,
          }
          },
          { identifier, password },
        )

        if (sessionProbe.ok || sessionProbe.status !== 429) {
          break
        }

        await page.waitForTimeout(Math.min(2_000 * (attempt + 1), 6_000))
      }

      if (!sessionProbe?.ok) {
        throw new Error(`Failed to establish authenticated UI session (${sessionProbe.status}): ${sessionProbe.detail}`)
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

      await page.getByTestId("login-form").waitFor({ state: "visible", timeout: 15_000 })
      await page.getByTestId("login-identifier").fill(identifier)
      await page.getByTestId("login-password").fill(password)
      await page.getByTestId("login-submit").click()
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

    await ensureAuthenticatedSession()
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
