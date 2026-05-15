import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appRoot, "..");
const docsRoot = path.join(repoRoot, "docs", "user-guides");

const pages = JSON.parse(fs.readFileSync(path.join(appRoot, "src/help/content/pages/pages.json"), "utf8"));
const roles = JSON.parse(fs.readFileSync(path.join(appRoot, "src/help/content/roles/roles.json"), "utf8"));
const flows = JSON.parse(fs.readFileSync(path.join(appRoot, "src/help/content/flows/flows.json"), "utf8"));
const faq = JSON.parse(fs.readFileSync(path.join(appRoot, "src/help/content/faq.json"), "utf8"));
const screenshotDir = path.join(appRoot, "public", "help", "screenshots");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function rmDir(dirPath) {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}

function slugFromRoute(route) {
  return route.replace(/^\//, "").replace(/\//g, "-").replace(/\[/g, "").replace(/\]/g, "") || "root";
}

function localize(text, locale = "en") {
  if (!text) return "";
  if (typeof text === "string") return text;
  return text[locale] || text.en || "";
}

function bullet(items, locale = "en") {
  if (!items || items.length === 0) return "- None\n";
  return items.map((item) => `- ${localize(item, locale)}`).join("\n") + "\n";
}

function write(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content.trim() + "\n");
}

function screenshotFileForKey(key) {
  const candidates = [".png", ".webp", ".jpg", ".jpeg", ".svg"];
  for (const ext of candidates) {
    const filename = `${key}${ext}`;
    if (fs.existsSync(path.join(screenshotDir, filename))) {
      return filename;
    }
  }
  return `${key}.svg`;
}

function screenshotMarkdown(basePrefix, key) {
  const filename = screenshotFileForKey(key);
  return `- ![${key}](${basePrefix}/${filename})`;
}

rmDir(docsRoot);
ensureDir(docsRoot);
ensureDir(path.join(docsRoot, "roles"));
ensureDir(path.join(docsRoot, "pages"));
ensureDir(path.join(docsRoot, "flows"));

for (const role of roles) {
  const roleScreenshots =
    (role.screenshotKeys || [])
      .map((key) => screenshotMarkdown("../../../frontend_v2/public/help/screenshots", key))
      .join("\n") || "- None";

  const content = `
# ${localize(role.title, "en")}

## Overview (EN)
${localize(role.overview, "en")}

## Overview (HI)
${localize(role.overview, "hi")}

## Landing Page
- ${role.landingPage}

## Responsibilities (EN)
${bullet(role.responsibilities, "en")}

## Responsibilities (HI)
${bullet(role.responsibilities, "hi")}

## Daily Checklist (EN)
${bullet(role.dailyChecklist, "en")}

## Daily Checklist (HI)
${bullet(role.dailyChecklist, "hi")}

## Core Workflows (EN)
${bullet(role.coreWorkflows, "en")}

## Core Workflows (HI)
${bullet(role.coreWorkflows, "hi")}

## Escalation Paths (EN)
${bullet(role.escalationPaths, "en")}

## Escalation Paths (HI)
${bullet(role.escalationPaths, "hi")}

## FAQ
${(role.faqs || [])
  .map(
    (item, idx) =>
      `${idx + 1}. **Q (EN):** ${localize(item.q, "en")}\n   - **A (EN):** ${localize(item.a, "en")}\n   - **Q (HI):** ${localize(item.q, "hi")}\n   - **A (HI):** ${localize(item.a, "hi")}`,
  )
  .join("\n")}

## Screenshot References
${roleScreenshots}
`;

  write(path.join(docsRoot, "roles", `${role.roleCode.toLowerCase()}.md`), content);
}

const flowById = new Map(flows.map((flow) => [flow.id, flow]));

for (const page of pages) {
  const flow = flowById.get(page.decisionFlowId);
  const slug = slugFromRoute(page.routePattern);
  const screenshots =
    (page.screenshotKeys || [])
      .map((key) => screenshotMarkdown("../../../frontend_v2/public/help/screenshots", key))
      .join("\n") || "- None";

  const content = `
# ${localize(page.title, "en")}

## Route
- ${page.routePattern}

## Module
- ${page.module}

## Roles
${bullet((page.roles || []).map((role) => ({ en: role, hi: role })), "en")}

## Summary (EN)
${localize(page.summary, "en")}

## Summary (HI)
${localize(page.summary, "hi")}

## Purpose (EN)
${localize(page.purpose, "en")}

## Purpose (HI)
${localize(page.purpose, "hi")}

## Prerequisites (EN)
${bullet(page.prerequisites, "en")}

## Prerequisites (HI)
${bullet(page.prerequisites, "hi")}

## Key Actions (EN)
${bullet(page.keyActions, "en")}

## Key Actions (HI)
${bullet(page.keyActions, "hi")}

## Field Help
${(page.fieldHelp || [])
  .map(
    (entry) =>
      `- **${localize(entry.field, "en")}** (EN): ${localize(entry.help, "en")}\n  - **${localize(entry.field, "hi")}** (HI): ${localize(entry.help, "hi")}`,
  )
  .join("\n")}

## Decision Flow
- ${page.decisionFlowId}
${
  flow
    ? (flow.nodes || [])
        .map(
          (node, index) =>
            `${index + 1}. ${localize(node.title, "en")}\n   - Outcomes: ${(node.outcomes || []).map((outcome) => localize(outcome.label, "en")).join(", ")}`,
        )
        .join("\n")
    : "- Not available"
}

## Common Errors
${(page.commonErrors || [])
  .map(
    (entry) =>
      `- **EN:** ${localize(entry.error, "en")} - ${localize(entry.reason, "en")}\n  - **HI:** ${localize(entry.error, "hi")} - ${localize(entry.reason, "hi")}`,
  )
  .join("\n")}

## Recovery Steps (EN)
${bullet(page.recoverySteps, "en")}

## Recovery Steps (HI)
${bullet(page.recoverySteps, "hi")}

## Related Routes
${bullet((page.relatedRoutes || []).map((route) => ({ en: route, hi: route })), "en")}

## Screenshot References
${screenshots}

## FAQ References
${bullet((page.faqRefs || []).map((id) => ({ en: id, hi: id })), "en")}
`;

  write(path.join(docsRoot, "pages", `${slug}.md`), content);
}

for (const flow of flows) {
  const content = `
# ${localize(flow.title, "en")}

## Nodes
${(flow.nodes || [])
  .map(
    (node, idx) =>
      `## ${idx + 1}. ${localize(node.title, "en")}\n- HI: ${localize(node.title, "hi")}\n- Outcomes:\n${(node.outcomes || [])
        .map((outcome) => `  - ${localize(outcome.label, "en")}${outcome.resolution ? ` -> ${localize(outcome.resolution, "en")}` : ""}`)
        .join("\n")}`,
  )
  .join("\n\n")}
`;
  write(path.join(docsRoot, "flows", `${flow.id}.md`), content);
}

const faqContent = `
# Global FAQ

${faq
  .map(
    (item, idx) =>
      `## ${idx + 1}. ${localize(item.question, "en")}\n- HI: ${localize(item.question, "hi")}\n- EN Answer: ${localize(item.answer, "en")}\n- HI Answer: ${localize(item.answer, "hi")}`,
  )
  .join("\n\n")}
`;
write(path.join(docsRoot, "faq.md"), faqContent);

const troubleshooting = `
# Troubleshooting

## Permission / Visibility Issues
- Confirm effective role and role override context.
- Validate role matrix assignment in /system/role-matrix.
- Validate governance signoff status in /system/governance.

## Validation Failures
- Verify mandatory fields and reference data exist.
- Re-open the record from list page and retry.
- Review inline Help section for route-specific field rules.

## Data Mismatch
- Validate upstream transaction closure.
- Review traceability and audit timelines.
- Escalate with route, payload, timestamp, and role context.

## Performance / Refresh Concerns
- Refresh page before critical submit.
- Use command palette to navigate to source records quickly.
- If stale data persists, report backend health with admin dashboard screenshot.
`;
write(path.join(docsRoot, "troubleshooting.md"), troubleshooting);

const readme = `
# User Guide Suite

Generated from frontend help content.

## Scope
- Roles covered: ${roles.length}
- Page guides: ${pages.length}
- Decision flows: ${flows.length}
- FAQ entries: ${faq.length}

## Structure
- Role guides: ./roles
- Page guides: ./pages
- Decision flows: ./flows
- FAQ: ./faq.md
- Troubleshooting: ./troubleshooting.md

## Generation
Run from frontend workspace:

\`npm run help:docs\`
`;
write(path.join(docsRoot, "README.md"), readme);

console.log(`Generated docs in ${docsRoot}`);
console.log(`Roles: ${roles.length}, Pages: ${pages.length}, Flows: ${flows.length}, FAQ: ${faq.length}`);
