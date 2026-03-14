import fs from "node:fs"
import path from "node:path"
import type { Reporter, TestCase, TestResult, FullResult } from "@playwright/test/reporter"

class ReleaseReadinessReporter implements Reporter {
  private outputDir: string
  private failures: Array<Record<string, unknown>> = []
  private counts = { passed: 0, failed: 0, skipped: 0 }
  private suffix = process.env.UI_E2E_REPORT_SUFFIX ? `-${process.env.UI_E2E_REPORT_SUFFIX}` : ""

  constructor(options?: { outputDir?: string }) {
    this.outputDir = options?.outputDir || path.resolve(process.cwd(), "../.runtime/ui-e2e")
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const isFailure = ["failed", "timedOut", "interrupted"].includes(result.status)

    if (result.status === "passed") this.counts.passed += 1
    if (isFailure) this.counts.failed += 1
    if (result.status === "skipped") this.counts.skipped += 1

    if (!isFailure) return

    const annotationMap = new Map(test.annotations.map((annotation) => [annotation.type, annotation.description || ""]))
    const attachments = result.attachments
      .map((attachment) => attachment.path)
      .filter(Boolean)
      .map((attachmentPath) => path.resolve(String(attachmentPath)))

    this.failures.push({
      title: test.title,
      file: test.location.file,
      line: test.location.line,
      module: annotationMap.get("module") || "Uncategorized",
      severity: annotationMap.get("severity") || "high",
      role: annotationMap.get("role") || "ALL",
      feature: annotationMap.get("feature") || "",
      expected: annotationMap.get("expected") || "",
      status: result.status,
      actual: result.error?.message || "Unknown failure",
      attachments,
    })
  }

  onEnd(result: FullResult) {
    fs.mkdirSync(this.outputDir, { recursive: true })
    const summaryPath = path.join(this.outputDir, `release-readiness-summary${this.suffix}.json`)
    const markdownPath = path.join(this.outputDir, `release-readiness-summary${this.suffix}.md`)
    const summary = {
      status: result.status,
      counts: this.counts,
      failures: this.failures,
      generatedAt: new Date().toISOString(),
    }

    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2))

    const grouped = new Map<string, Array<Record<string, unknown>>>()
    for (const failure of this.failures) {
      const moduleName = String(failure.module || "Uncategorized")
      const bucket = grouped.get(moduleName) || []
      bucket.push(failure)
      grouped.set(moduleName, bucket)
    }

    const lines = [
      "# UI E2E Release Readiness Summary",
      "",
      `- Status: ${result.status}`,
      `- Passed: ${this.counts.passed}`,
      `- Failed: ${this.counts.failed}`,
      `- Skipped: ${this.counts.skipped}`,
      "",
    ]

    if (!this.failures.length) {
      lines.push("No failed UI gate scenarios were recorded.")
    } else {
      for (const [moduleName, failures] of grouped.entries()) {
        lines.push(`## ${moduleName}`)
        lines.push("")
        for (const failure of failures) {
          lines.push(`- Severity: ${failure.severity}`)
          lines.push(`- Role: ${failure.role}`)
          lines.push(`- Test: ${failure.title}`)
          if (failure.status) lines.push(`- Result: ${failure.status}`)
          if (failure.expected) lines.push(`- Expected: ${failure.expected}`)
          lines.push(`- Actual: ${failure.actual}`)
          lines.push(`- File: ${failure.file}:${failure.line}`)
          if (Array.isArray(failure.attachments) && failure.attachments.length) {
            lines.push(`- Evidence: ${(failure.attachments as string[]).join(", ")}`)
          }
          lines.push("")
        }
      }
    }

    fs.writeFileSync(markdownPath, lines.join("\n"))
  }
}

export default ReleaseReadinessReporter
