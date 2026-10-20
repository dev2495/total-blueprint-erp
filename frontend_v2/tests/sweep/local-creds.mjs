// Local test-account credentials for the sweep scripts, read from the git-ignored
// .runtime/local-test-accounts.env at the repo root (or SWEEP_USER / SWEEP_PASS /
// LOCAL_ROLE_USERS_PASSWORD in the environment). No password lives in the repository.
import fs from "node:fs"

const file = new URL("../../../.runtime/local-test-accounts.env", import.meta.url)
const values = {}
try {
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/)
    if (m) values[m[1]] = m[2]
  }
} catch {
  // fall back to the environment
}

function need(name, value) {
  if (!value) throw new Error(`${name} is not set: add it to .runtime/local-test-accounts.env or the environment.`)
  return value
}

export const adminUser = process.env.SWEEP_USER || values.ADMIN_USERNAME || "admin"
export const adminPass = () => need("ADMIN_PASSWORD", process.env.SWEEP_PASS || values.ADMIN_PASSWORD)
export const rolePass = () => need("ROLE_USERS_PASSWORD", process.env.LOCAL_ROLE_USERS_PASSWORD || values.ROLE_USERS_PASSWORD)
