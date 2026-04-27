import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

const frontendRoot = process.cwd()
const runtimeRoot = path.resolve(frontendRoot, "../.runtime/ui-e2e")
const observationDir = path.join(frontendRoot, "tests", "e2e", "observation")
const mutationDir = path.join(frontendRoot, "tests", "e2e", "mutations")
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm"

fs.mkdirSync(runtimeRoot, { recursive: true })

function hasObservationSpecs() {
  if (!fs.existsSync(observationDir)) return false
  return fs.readdirSync(observationDir).some((file) => file.endsWith(".spec.ts"))
}

function hasMutationSpecs() {
  if (!fs.existsSync(mutationDir)) return false
  return fs.readdirSync(mutationDir).some((file) => file.endsWith(".spec.ts"))
}

function runScript(scriptName, extraEnv = {}) {
  const result = spawnSync(npmBin, ["run", scriptName], {
    cwd: frontendRoot,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  })
  return typeof result.status === "number" ? result.status : 1
}

const sharedPlaywrightEnv = process.env.UI_E2E_SKIP_BOOTSTRAP === "1" ? { UI_E2E_SKIP_BOOTSTRAP: "1" } : {}

function readJsonIfPresent(fileName) {
  const filePath = path.join(runtimeRoot, fileName)
  if (!fs.existsSync(filePath)) return null
  return JSON.parse(fs.readFileSync(filePath, "utf8"))
}

function writeAggregateSummary(summaries, exitCodes) {
  const summaryPath = path.join(runtimeRoot, "release-readiness-summary.json")
  const markdownPath = path.join(runtimeRoot, "release-readiness-summary.md")
  const combined = summaries.filter(Boolean)
  const counts = combined.reduce(
    (acc, summary) => {
      acc.passed += Number(summary.counts?.passed || 0)
      acc.failed += Number(summary.counts?.failed || 0)
      acc.skipped += Number(summary.counts?.skipped || 0)
      return acc
    },
    { passed: 0, failed: 0, skipped: 0 },
  )
  const failures = combined.flatMap((summary) => summary.failures || [])
  const status =
    exitCodes.gateExitCode === 0 &&
    (exitCodes.mutationsExitCode ?? 0) === 0 &&
    failures.length === 0
      ? "passed"
      : "failed"
  const payload = {
    status,
    counts,
    failures,
    gateExitCode: exitCodes.gateExitCode,
    mutationsExitCode: exitCodes.mutationsExitCode,
    observationsExitCode: exitCodes.observationsExitCode,
    generatedAt: new Date().toISOString(),
    projectSummaries: combined.map((summary) => ({
      status: summary.status,
      counts: summary.counts,
    })),
  }

  fs.writeFileSync(summaryPath, JSON.stringify(payload, null, 2))

  const lines = [
    "# UI E2E Release Readiness Summary",
    "",
    `- Status: ${status}`,
    `- Gate Exit Code: ${exitCodes.gateExitCode}`,
    `- Mutations Exit Code: ${exitCodes.mutationsExitCode ?? "not-run"}`,
    `- Observations Exit Code: ${exitCodes.observationsExitCode ?? "not-run"}`,
    `- Passed: ${counts.passed}`,
    `- Failed: ${counts.failed}`,
    `- Skipped: ${counts.skipped}`,
    "",
  ]

  if (!failures.length) {
    lines.push("No failed UI gate scenarios were recorded.")
  } else {
    for (const failure of failures) {
      lines.push(`## ${failure.module || "Uncategorized"}`)
      lines.push("")
      lines.push(`- Severity: ${failure.severity || "high"}`)
      lines.push(`- Role: ${failure.role || "ALL"}`)
      lines.push(`- Test: ${failure.title || "Unknown test"}`)
      if (failure.expected) lines.push(`- Expected: ${failure.expected}`)
      lines.push(`- Actual: ${failure.actual || "Unknown failure"}`)
      lines.push(`- File: ${failure.file || "unknown"}:${failure.line || 0}`)
      if (Array.isArray(failure.attachments) && failure.attachments.length) {
        lines.push(`- Evidence: ${failure.attachments.join(", ")}`)
      }
      lines.push("")
    }
  }

  fs.writeFileSync(markdownPath, lines.join("\n"))
}

const gateExitCode = runScript("e2e:ui:gate", sharedPlaywrightEnv)
let mutationsExitCode = null
if (hasMutationSpecs()) {
  mutationsExitCode = runScript("e2e:ui:mutations", { ...sharedPlaywrightEnv, UI_E2E_SKIP_BOOTSTRAP: "1" })
}
let observationsExitCode = null
if (hasObservationSpecs()) {
  observationsExitCode = runScript("e2e:ui:observations", { ...sharedPlaywrightEnv, UI_E2E_SKIP_BOOTSTRAP: "1" })
}

fs.writeFileSync(
  path.join(runtimeRoot, "runner-summary.json"),
  JSON.stringify(
    {
      gateExitCode,
      mutationsExitCode,
      observationsExitCode,
      completedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
)

writeAggregateSummary(
  [
    readJsonIfPresent("release-readiness-summary-gate.json"),
    readJsonIfPresent("release-readiness-summary-mutations.json"),
    readJsonIfPresent("release-readiness-summary-observations.json"),
  ],
  { gateExitCode, mutationsExitCode, observationsExitCode },
)

process.exit(gateExitCode || mutationsExitCode || observationsExitCode || 0)
