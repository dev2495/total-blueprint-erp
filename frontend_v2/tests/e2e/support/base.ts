import { expect, test as base } from "@playwright/test"

type RuntimeIssue = {
  type: "pageerror" | "response"
  message: string
}

export const test = base.extend({
  page: async ({ page, baseURL }, use, testInfo) => {
    const issues: RuntimeIssue[] = []

    page.on("pageerror", (error) => {
      issues.push({ type: "pageerror", message: error.message })
    })

    page.on("response", (response) => {
      const url = response.url()
      if (baseURL && !url.startsWith(String(baseURL))) return
      if (response.status() >= 500) {
        issues.push({ type: "response", message: `${response.status()} ${url}` })
      }
    })

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
