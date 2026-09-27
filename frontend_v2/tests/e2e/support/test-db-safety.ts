/** Guard per-test fixture writers when an already-running API is reused. */
export function assertLocalUiE2ETestDatabase(seedName: string) {
  if (process.env.UI_E2E_SKIP_BOOTSTRAP !== "1") return

  const host = String(process.env.DB_HOST || "").trim().toLowerCase()
  const name = String(process.env.DB_NAME || "").trim()
  const port = String(process.env.DB_PORT || "").trim()
  const localHosts = new Set(["127.0.0.1", "localhost", "::1"])

  if (!localHosts.has(host) || !port || !/(?:test|e2e)/i.test(name)) {
    throw new Error(
      `${seedName} refused to write fixtures while UI_E2E_SKIP_BOOTSTRAP=1. ` +
        "Pass explicit DB_HOST, DB_PORT, and a test/e2e DB_NAME so the fixture writer targets the same local database as the API.",
    )
  }
}
