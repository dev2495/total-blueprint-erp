import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

const frontendRoot = process.cwd()
const runtimeRoot = path.resolve(frontendRoot, "../.runtime/ui-e2e")
const summaryName = "release-readiness-summary-artwork-domain.json"
const summaryPath = path.join(runtimeRoot, summaryName)
const proofJsonPath = path.join(runtimeRoot, "artwork-domain-proof.json")
const proofMdPath = path.join(runtimeRoot, "artwork-domain-proof.md")

const specFiles = [
  "tests/e2e/gate/engineering-flow.spec.ts",
  "tests/e2e/gate/planner-artwork-gate.spec.ts",
]

fs.mkdirSync(runtimeRoot, { recursive: true })

const result = spawnSync(
  path.join(frontendRoot, "scripts", "with-supported-node.sh"),
  ["playwright", "test", "--project=gate", ...specFiles],
  {
    cwd: frontendRoot,
    stdio: "inherit",
    env: { ...process.env, UI_E2E_REPORT_SUFFIX: "artwork-domain" },
  },
)

let summary = {
  status: "failed",
  counts: { passed: 0, failed: 0, skipped: 0 },
  failures: [],
}
if (fs.existsSync(summaryPath)) {
  summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"))
}

const payload = {
  domain: "artwork-cylinder-ink",
  status: summary.status,
  counts: summary.counts || { passed: 0, failed: 0, skipped: 0 },
  specFiles,
  failures: summary.failures || [],
  generatedAt: new Date().toISOString(),
}

fs.writeFileSync(proofJsonPath, JSON.stringify(payload, null, 2))

const lines = [
  "# Artwork Domain Browser Proof",
  "",
  `- Status: ${payload.status}`,
  `- Passed: ${payload.counts.passed || 0}`,
  `- Failed: ${payload.counts.failed || 0}`,
  `- Skipped: ${payload.counts.skipped || 0}`,
  "",
  "## Specs",
  ...specFiles.map((file) => `- ${file}`),
  "",
]

if (!payload.failures.length) {
  lines.push("No browser signoff failures were recorded.")
} else {
  lines.push("## Failures", "")
  for (const failure of payload.failures) {
    lines.push(`- ${failure.title || "Unknown test"}: ${failure.actual || "Unknown failure"}`)
  }
}

fs.writeFileSync(proofMdPath, lines.join("\n"))

process.exit(typeof result.status === "number" ? result.status : 1)
