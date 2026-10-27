// Builds the NotebookLM source pack for the TPP ERP help bot from the same content the guide shows.
// Output: docs/help-notebook/*.md (+ SOURCES.md listing what to upload, in order).
// Run: node scripts/generate_help_notebook.mjs   (after the help content changes)
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(appRoot, "..");
const content = path.join(appRoot, "src", "help", "content");
const read = (file, fallback = []) => {
  const full = path.join(content, file);
  return fs.existsSync(full) ? JSON.parse(fs.readFileSync(full, "utf8")) : fallback;
};
const pages = read("pages/pages.json");
const roles = read("roles/roles.json");
const flows = read("flows/flows.json");
const faq = read("faq.json");
const processes = read("processes.json");
const modules = read("modules.json");
const gaps = read("gaps.json");
const outDir = path.join(repoRoot, "docs", "help-notebook");
const PUBLIC_GUIDE = "https://erp.totalpolyprint.com/guide";

const LEGACY = new Set(["/inventory/addons-v36", "/inventory/bulk-v36", "/inventory/grn-history-v36", "/inventory/grn-v36", "/inventory/inter-plant-v36", "/inventory/packaging-v36", "/inventory/rolls-v36", "/inventory/traceability-v36"]);
const MODULE_ORDER = ["Roles", "Sales", "Planner", "Production", "Dashboard", "Logistics", "Inventory", "Gate", "Master Data", "Engineering", "Factory", "Maintenance", "Procurement", "Analytics", "System", "Access", "Profile", "Help Center"];
const MODULE_TITLES = {
  Roles: "Roles — start page, sidebar and daily routine",
  Sales: "Sales — orders, quotations, customers",
  Planner: "Planner",
  Production: "Production — machines, jobs, ink",
  Dashboard: "Dashboards, planner control tower and work-center terminal",
  Logistics: "Packing yard and dispatch bay",
  Inventory: "Inventory and stores",
  Gate: "Gate — watchman, visitors, inward and outward",
  "Master Data": "Master data — product masters, packaging, materials",
  Engineering: "Engineering — artworks, cylinders, routes, templates",
  Factory: "Factory setup — plants, machines, processes",
  Maintenance: "Maintenance",
  Procurement: "Procurement",
  Analytics: "Analytics and reports",
  System: "System administration",
  Access: "Signing in",
  Profile: "Profile",
  "Help Center": "Help",
};

const slug = (route) =>
  String(route || "/").replace(/^\/+|\/+$/g, "").replace(/\[\.\.\.([^\]]+)\]/g, "$1").replace(/\[([^\]]+)\]/g, "$1").replace(/[^a-zA-Z0-9/_-]+/g, "-").replace(/\//g, "-").replace(/-+/g, "-").toLowerCase() || "home";
const moduleSlug = (m) => String(m).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const L = (text, lang) => (text && typeof text === "object" ? text[lang] || text.en : String(text || ""));
const list = (items, lang, numbered = false) => (items || []).map((item, i) => `${numbered ? `${i + 1}.` : "-"} ${L(item, lang)}`).join("\n");

function pageSection(guide, lang) {
  const hi = lang === "hi";
  const out = [];
  out.push(`### ${L(guide.title, lang)} (${guide.routePattern})`);
  out.push(`${hi ? "स्क्रीन का पता" : "Screen address"}: ${guide.routePattern} · ${hi ? "भूमिकाएँ" : "Roles"}: ${(guide.roles || []).join(", ") || "-"} · ${hi ? "शेयर लिंक" : "Share link"}: ${PUBLIC_GUIDE}?page=${slug(guide.routePattern)}${hi ? "&lang=hi" : ""}`);
  out.push("");
  out.push(L(guide.summary, lang));
  out.push("");
  out.push(L(guide.purpose, lang));
  if (guide.prerequisites?.length) out.push("", `**${hi ? "शुरू करने से पहले" : "Before you start"}**`, list(guide.prerequisites, lang));
  if (guide.keyActions?.length) out.push("", `**${hi ? "स्टेप बाय स्टेप" : "Step by step"}**`, list(guide.keyActions, lang, true));
  if (guide.fieldHelp?.length) out.push("", `**${hi ? "स्क्रीन पर क्या है" : "What is on the screen"}**`, guide.fieldHelp.map((f) => `- **${L(f.field, lang)}**: ${L(f.help, lang)}`).join("\n"));
  if (guide.commonErrors?.length) out.push("", `**${hi ? "आम दिक्कतें और हल" : "Common problems and fixes"}**`, guide.commonErrors.map((e) => `- "${L(e.error, lang)}" — ${L(e.reason, lang)}`).join("\n"));
  if (guide.recoverySteps?.length) out.push("", `**${hi ? "अटक गए तो" : "If stuck"}**`, list(guide.recoverySteps, lang, true));
  if (guide.relatedRoutes?.length) out.push("", `${hi ? "जुड़े पेज" : "Related pages"}: ${guide.relatedRoutes.join(", ")}`);
  const pageGaps = gaps.filter((g) => g.route === guide.routePattern);
  if (pageGaps.length) out.push("", `**${hi ? "अभी नहीं होता / ध्यान दें" : "Not done yet / watch out"}**`, pageGaps.map((g) => `- ${L(g, lang)}`).join("\n"));
  return out.join("\n");
}

function write(name, body) {
  fs.writeFileSync(path.join(outDir, name), `${body.trim()}\n`);
  return name;
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const files = [];
const readable = pages.filter((p) => !LEGACY.has(p.routePattern));
const present = [...new Set([...readable.map((p) => p.module), ...modules.map((d) => d.module)])];
const ordered = [...MODULE_ORDER.filter((m) => present.includes(m)), ...present.filter((m) => !MODULE_ORDER.includes(m)).sort()];

// 00 — start here
files.push(
  write(
    "00-start-here.md",
    `# TPP ERP help bot — start here / यहाँ से शुरू करें

This notebook holds the complete user guide of the Total Poly Print ERP (flexible packaging plant): every screen,
every step, the rules the plant follows, the usual problems and their fixes, and what the system does not do yet.
Answer in the language of the question (English or Hindi). Quote on-screen labels exactly as written in the guide.
When a user sends a screenshot, match the page by its heading and route, then answer from that page's section.
Always give the shareable guide link of the page (${PUBLIC_GUIDE}?page=<slug>, add &lang=hi for Hindi).

यह नोटबुक Total Poly Print ERP की पूरी यूज़र गाइड है: हर स्क्रीन, हर स्टेप, प्लांट के नियम, आम दिक्कतें और उनके हल,
और जो सिस्टम अभी नहीं करता। सवाल जिस भाषा में हो, जवाब उसी में दें। स्क्रीन के लेबल वैसे ही लिखें जैसे गाइड में हैं।

## How work flows / काम कैसे चलता है
${processes.length ? processes.slice(0, 1).map((p) => `${L(p.title, "en")}: ${p.steps.map((s) => L(s.title, "en")).join(" → ")}\n\n${L(p.title, "hi")}: ${p.steps.map((s) => L(s.title, "hi")).join(" → ")}`).join("\n") : "Sales order → Planner → Work centers and machines → Packing yard → Dispatch bay → Proof of delivery."}

## Plant rules / प्लांट के नियम
- Only inner pouches are taken off stock automatically (at packing). Every other packing item (gonny, sheet/putha, box, tape, label, tag, outer bag, other) is ticked at release and taken off stock by the evening packing count, split over the orders that ticked it.
- सिर्फ inner pouch पैकिंग पर अपने-आप स्टॉक से कटते हैं। बाकी हर पैकिंग आइटम रिलीज़ पर टिक होता है और शाम की गिनती से कटता है, उन ऑर्डरों में बँटकर जिन्होंने टिक किया।
- One dispatch slip per sales-order line (Epson 10 × 6 in). Goods of closed lines ship only after "Send goods of closed lines" is ticked, or move to free stock with a reason.
- हर सेल्स-ऑर्डर लाइन की एक डिस्पैच स्लिप। बंद लाइन का माल "Send goods of closed lines" टिक करने के बाद ही जाता है, या कारण के साथ फ्री स्टॉक में जाता है।
- Rolls are picked within ±20 mm of the needed width; lanes (n-up) decide the run web before slitting.

## Modules in this notebook
${ordered.map((m, i) => `- ${String(i + 1).padStart(2, "0")} ${MODULE_TITLES[m] || m}`).join("\n")}

## Roles / भूमिकाएँ
${roles.map((r) => `- **${r.roleCode}** — ${L(r.title, "en")} / ${L(r.title, "hi")}: ${L(r.overview, "en")} (start page ${r.landingPage})`).join("\n")}
`,
  ),
);

// One file per module: overview + every page, English then Hindi.
ordered.forEach((module, index) => {
  const doc = modules.find((d) => d.module === module || d.slug === moduleSlug(module));
  const guides = readable.filter((p) => p.module === module).sort((a, b) => a.routePattern.localeCompare(b.routePattern));
  const parts = [`# ${MODULE_TITLES[module] || module}`];
  if (doc) parts.push("", "## Overview (English)", doc.en, "", "## सारांश (हिंदी)", doc.hi);
  parts.push("", "## Every screen (English)", ...guides.map((g) => `\n${pageSection(g, "en")}`));
  parts.push("", "## हर स्क्रीन (हिंदी)", ...guides.map((g) => `\n${pageSection(g, "hi")}`));
  files.push(write(`${String(index + 1).padStart(2, "0")}-${moduleSlug(module)}.md`, parts.join("\n")));
});

// Processes and decision flows
const flowText = (flow, lang) =>
  [`### ${L(flow.title, lang)}`, ...flow.nodes.map((n) => `- ${L(n.title, lang)}\n${n.outcomes.map((o) => `  - ${L(o.label, lang)} → ${o.nextId ? flow.nodes.find((x) => x.id === o.nextId)?.title?.[lang] || o.nextId : L(o.resolution, lang)}`).join("\n")}`)].join("\n");
files.push(
  write(
    "90-processes-and-decision-flows.md",
    [
      "# Processes and decision flows / प्रक्रियाएँ और निर्णय फ़्लो",
      "## Processes (who does what, on which screen)",
      ...processes.map((p) => `\n### ${L(p.title, "en")}\n${L(p.summary, "en")}\n\n${p.steps.map((s, i) => `${i + 1}. **${L(s.title, "en")}** — ${s.role}${s.route ? ` on ${s.route}` : ""}. ${L(s.detail, "en")}`).join("\n")}`),
      "\n## प्रक्रियाएँ",
      ...processes.map((p) => `\n### ${L(p.title, "hi")}\n${L(p.summary, "hi")}\n\n${p.steps.map((s, i) => `${i + 1}. **${L(s.title, "hi")}** — ${s.role}${s.route ? ` (${s.route})` : ""}। ${L(s.detail, "hi")}`).join("\n")}`),
      "\n## Decision flows",
      ...flows.map((f) => flowText(f, "en")),
      "\n## निर्णय फ़्लो",
      ...flows.map((f) => flowText(f, "hi")),
    ].join("\n"),
  ),
);

// Troubleshooting: every error message in one place, searchable by the text the user sees.
files.push(
  write(
    "91-troubleshooting-error-index.md",
    [
      "# Troubleshooting: every message and what to do / हर मैसेज और उसका हल",
      "Search this file for the exact text a user sees on screen.",
      ...readable
        .filter((g) => g.commonErrors?.length)
        .map((g) => `\n## ${L(g.title, "en")} — ${g.routePattern}\n${g.commonErrors.map((e) => `- "${L(e.error, "en")}": ${L(e.reason, "en")}\n  - हिंदी: "${L(e.error, "hi")}": ${L(e.reason, "hi")}`).join("\n")}`),
      "\n## FAQ",
      ...faq.map((f) => `- **${L(f.question, "en")}** ${L(f.answer, "en")}\n  - **${L(f.question, "hi")}** ${L(f.answer, "hi")}`),
    ].join("\n"),
  ),
);

// Known gaps
files.push(
  write(
    "92-known-gaps-what-is-missing.md",
    [
      "# What the system does not do yet / सिस्टम अभी क्या नहीं करता",
      "Use this when a user asks why something is missing or not possible. Say so plainly and give the workaround if there is one.",
      ...[...new Set(gaps.map((g) => g.route))].map((route) => {
        const items = gaps.filter((g) => g.route === route);
        const guide = readable.find((p) => p.routePattern === route);
        return `\n## ${guide ? L(guide.title, "en") : route} (${route})\n${items.map((g) => `- ${L(g, "en")}\n  - ${L(g, "hi")}`).join("\n")}`;
      }),
    ].join("\n"),
  ),
);

// Roles
files.push(
  write(
    "93-roles-daily-work.md",
    [
      "# Roles and daily work / भूमिकाएँ और रोज़ का काम",
      ...roles.map((r) =>
        [
          `\n## ${r.roleCode} — ${L(r.title, "en")} / ${L(r.title, "hi")}`,
          `Start page: ${r.landingPage}`,
          L(r.overview, "en"),
          L(r.overview, "hi"),
          "\n**Responsibilities / ज़िम्मेदारियाँ**",
          (r.responsibilities || []).map((x) => `- ${L(x, "en")} / ${L(x, "hi")}`).join("\n"),
          "\n**Daily checklist / रोज़ की चेकलिस्ट**",
          (r.dailyChecklist || []).map((x) => `- ${L(x, "en")} / ${L(x, "hi")}`).join("\n"),
          "\n**Core work / मुख्य काम**",
          (r.coreWorkflows || []).map((x) => `- ${L(x, "en")} / ${L(x, "hi")}`).join("\n"),
          "\n**Who to go to / किससे बात करें**",
          (r.escalationPaths || []).map((x) => `- ${L(x, "en")} / ${L(x, "hi")}`).join("\n"),
          ...(r.faqs || []).map((f) => `- Q: ${L(f.q, "en")} A: ${L(f.a, "en")}\n  - प्र: ${L(f.q, "hi")} उ: ${L(f.a, "hi")}`),
        ].join("\n"),
      ),
    ].join("\n"),
  ),
);

// What's new: the release notes, newest first.
const releasesDir = path.join(repoRoot, "docs", "releases");
const releases = fs
  .readdirSync(releasesDir)
  .filter((d) => fs.existsSync(path.join(releasesDir, d, "README.md")) && /20\d{6}/.test(d))
  .sort((a, b) => (b.match(/20\d{6}/)[0] + b).localeCompare(a.match(/20\d{6}/)[0] + a))
  .slice(0, 20);
// Users need what changed on their screens, not how it was deployed: drop deploy/ops sections and any
// line about servers, secrets, containers or migrations.
const OPS_HEADING = /(deploy|rollback|roll back|activat|server|cutover|go-live|go live|operations|ops\b|backup|restore|migration|verification|checklist|runbook|infra|release steps|how it was released)/i;
const OPS_LINE = /(\/opt\/|app\.env|secrets|docker|compose|gunicorn|celery|sha-?256|symlink|ssh\b|scp\b|nohup|\.sh\b|restart window|image tag|rollback|migrate|migration|\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b)/i;
function userFacingNotes(markdown) {
  const out = [];
  let skip = false;
  for (const line of markdown.split("\n")) {
    const heading = /^(#{2,4})\s+(.*)$/.exec(line);
    if (heading) skip = OPS_HEADING.test(heading[2]);
    if (skip || OPS_LINE.test(line)) continue;
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}
files.push(
  write(
    "94-whats-new-release-notes.md",
    [
      "# What changed, newest first (release notes)",
      "These describe the latest behaviour; when they conflict with older text, the newest wins.",
      ...releases.map((d) => `\n---\n\n${userFacingNotes(fs.readFileSync(path.join(releasesDir, d, "README.md"), "utf8")).replace(/^# /m, "## ")}`),
    ].join("\n"),
  ),
);

// The list of sources to upload.
const illustrated = fs.existsSync(path.join(outDir, "..", "help-notebook-pdf")) ? fs.readdirSync(path.join(outDir, "..", "help-notebook-pdf")).filter((f) => f.endsWith(".pdf")) : [];
write(
  "SOURCES.md",
  `# NotebookLM sources for the TPP ERP help bot

Upload these files from \`docs/help-notebook/\` (text, the bot's knowledge) and \`docs/help-notebook-pdf/\` (illustrated
guides with screenshots and flow charts, so the bot can match screenshots users send). Add the public guide as a
website source too: ${PUBLIC_GUIDE}

| # | File | What it covers |
|---|------|----------------|
${files.map((f, i) => `| ${i + 1} | docs/help-notebook/${f} | ${f.startsWith("00") ? "Start here: how work flows, plant rules, modules, roles" : f.startsWith("90") ? "Process charts and decision flows" : f.startsWith("91") ? "Every on-screen error message and its fix" : f.startsWith("92") ? "What is missing / not possible yet" : f.startsWith("93") ? "Roles and daily routines" : f.startsWith("94") ? "Release notes, newest first" : "Module overview + every screen, English and Hindi"} |`).join("\n")}
${illustrated.map((f, i) => `| ${files.length + i + 1} | docs/help-notebook-pdf/${f} | Illustrated guide (screenshots, charts) |`).join("\n")}
| ${files.length + illustrated.length + 1} | ${PUBLIC_GUIDE} (website) | The live guide; also ${PUBLIC_GUIDE}?lang=hi |

Total: ${files.length + illustrated.length + 1} sources (NotebookLM allows 50 per notebook on the free plan).
Paste \`BOT-INSTRUCTIONS.txt\` into the notebook's Instructions (settings); do not upload it as a source.
Regenerate after any help change: \`node frontend_v2/scripts/generate_help_notebook.mjs\` and
\`node frontend_v2/scripts/capture_help_pdfs.mjs\`.
`,
);
// The notebook's own instructions (paste into NotebookLM / Gemini notebook settings; not a source).
fs.copyFileSync(path.join(appRoot, "scripts", "help-bot-instructions.txt"), path.join(outDir, "BOT-INSTRUCTIONS.txt"));
console.log(`Notebook sources written: ${files.length} markdown files in docs/help-notebook`);
