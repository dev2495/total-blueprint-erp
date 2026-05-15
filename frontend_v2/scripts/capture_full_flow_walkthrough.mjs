import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appRoot, "..");
const baseUrl = process.env.UI_BASE_URL || "http://127.0.0.1:3001";
const browserChannel = process.env.PLAYWRIGHT_BROWSER_CHANNEL || "chrome";
const storagePath = process.env.UI_E2E_STORAGE_STATE || path.join(repoRoot, ".runtime", "ui-e2e", "storage", "admin.json");
const runTag = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const outDir = process.env.WALKTHROUGH_OUT || path.join(repoRoot, ".runtime", "walkthroughs", `full-flow-${runTag}`);
const screenshotDir = path.join(outDir, "screenshots");
const videoDir = path.join(outDir, "video");
const reportPath = path.join(outDir, "index.html");
const manifestPath = path.join(outDir, "manifest.json");

fs.mkdirSync(screenshotDir, { recursive: true });
fs.mkdirSync(videoDir, { recursive: true });

function readJsonIfExists(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {}
  return {};
}

const mutationSeed = readJsonIfExists(path.join(repoRoot, ".runtime", "ui-e2e", "mutation-seed.json"));
const routeTruth = readJsonIfExists(path.join(repoRoot, ".runtime", "ui-e2e", "acceptance", "wip_route_truth.json"));
const wcmId =
  routeTruth?.ui_jobs?.combine_three_fallback?.work_center_id ||
  mutationSeed?.wcm?.work_center_id ||
  "";
const machineId = mutationSeed?.operator?.machine_id || mutationSeed?.printing_operator?.machine_id || "";

const steps = [
  {
    title: "Admin And Role Shell",
    route: "/dashboard/admin",
    note: "Start from the live admin shell. Role switching and global navigation are available here.",
  },
  {
    title: "Inventory Workspace",
    route: "/inventory",
    note: "Use Inventory Workspace as the landing page for roll, bulk, packaging, add-on, stock health, and movement views.",
  },
  {
    title: "Smart GRN",
    route: "/inventory/grn-v36",
    note: "Receive bulk, rolls, packaging, POD, and purchased add-ons through the adaptive GRN. Roll gross/tare/net stays visible at entry.",
  },
  {
    title: "Rolls Matrix",
    route: "/inventory/rolls-v36",
    note: "Roll inventory remains searchable by role, status, width, thickness, weight, plant, and lifecycle state.",
  },
  {
    title: "Bulk And Ink Stock",
    route: "/inventory/bulk-v36",
    note: "Bulk stock covers granules, inks, adhesives, solvents, chemicals, and purchased add-ons.",
  },
  {
    title: "Packaging Stock",
    route: "/inventory/packaging-v36",
    note: "Packaging inventory shows inner pouches, gunnies, sheets, tape, labels, POD, and other packing masters.",
  },
  {
    title: "Stock Lifecycle",
    route: "/inventory/period",
    note: "Period flow is open, count, variance review, approve, post, close, with opening balance and correction controls.",
  },
  {
    title: "Packing EOD Count",
    route: "/logistics/packing/consumption",
    note: "Packing material daily counts are logged here; inner pouch and gunny remain system-driven while other packing materials use stock snapshot consumption.",
  },
  {
    title: "Product Master List",
    route: "/master/products",
    note: "Product Master is the engineering contract: route template, fixed layer identity, geometry, axes, artworks, packing, POD, add-ons, and overlays.",
  },
  {
    title: "Artwork And Colorways",
    route: "/engineering/artworks",
    note: "Artwork controls print method, colorway, cylinder readiness, customer/global scope, and ink mapping for BOM consumption.",
  },
  {
    title: "Sales Order Create",
    route: "/sales/orders/create",
    note: "Sales creates product-master orders directly; variant tuple, artwork/colorway, customer overlay, POD, packaging, and add-ons resolve from master data.",
  },
  {
    title: "Planner Command",
    route: "/dashboard/planner/control-tower/command",
    note: "Planner sees released sales demand, source facts, artwork blockers, direct FG allocation, WIP match, and fresh route options.",
  },
  {
    title: "Planner Queue",
    route: "/dashboard/planner/control-tower/plan-queue",
    note: "The queue resolves gates before release. Artwork assignment unblocks release when print-enabled orders are waiting.",
  },
  {
    title: "Stock Launcher",
    route: "/production/planner/stock-launcher",
    note: "Planner stock can launch generic WIP/roll, customer/artwork committed stock, packaging stock, and POD stock with invariant matching.",
  },
  {
    title: "Work Center Manager",
    route: wcmId ? `/production/work-center/${wcmId}` : "/production/work-center",
    note: "WCM proves current-step WIP allocation: lineage stays separate from manual fallback, and multi-layer combine requires full slot coverage.",
  },
  {
    title: "Machine Terminal",
    route: machineId ? `/production/machine/${machineId}` : "/production/machine-selector",
    note: "Operator terminal runs the assigned production job, records issue/output, and pushes WIP/FG movement back into inventory.",
  },
  {
    title: "Packing Yard",
    route: "/logistics/packing",
    note: "Packing yard receives finished rolls/pouches, packs and seals gunnies, consumes allowed packing material, and prepares dispatch units.",
  },
  {
    title: "Dispatch",
    route: "/logistics/dispatch",
    note: "Dispatch claims packed rolls/gunnies, creates challans, and preserves source lineage back to sales, stock, WIP, and inventory movement.",
  },
];

async function launchBrowser() {
  if (browserChannel && !["chromium", "bundled", "default"].includes(browserChannel)) {
    try {
      return await chromium.launch({ channel: browserChannel, headless: true });
    } catch (error) {
      console.warn(`WARN: failed to launch ${browserChannel}; falling back to bundled Chromium. ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return chromium.launch({ headless: true });
}

async function ensureShell(page) {
  await page.goto(new URL("/dashboard/admin", baseUrl).toString(), { waitUntil: "domcontentloaded", timeout: 45000 });
  await Promise.race([
    page.getByRole("button", { name: /help/i }).first().waitFor({ state: "visible", timeout: 15000 }),
    page.getByTestId("sidebar-nav").waitFor({ state: "visible", timeout: 15000 }),
    page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15000 }),
  ]).catch(() => undefined);
  if (new URL(page.url()).pathname.startsWith("/login")) {
    throw new Error(`Walkthrough capture is not authenticated. Missing or stale storage state: ${storagePath}`);
  }
}

async function addOverlay(page, index, step) {
  await page.evaluate(
    ({ index, total, title, note }) => {
      document.getElementById("codex-walkthrough-overlay")?.remove();
      const overlay = document.createElement("div");
      overlay.id = "codex-walkthrough-overlay";
      overlay.style.cssText = [
        "position:fixed",
        "left:24px",
        "bottom:24px",
        "z-index:2147483647",
        "max-width:560px",
        "border-radius:18px",
        "padding:18px 20px",
        "background:rgba(15,23,42,0.92)",
        "color:white",
        "box-shadow:0 24px 60px rgba(15,23,42,0.35)",
        "font-family:Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        "pointer-events:none",
      ].join(";");
      overlay.innerHTML = `
        <div style="font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#93c5fd;margin-bottom:7px;">Step ${index + 1} of ${total}</div>
        <div style="font-size:24px;line-height:1.1;font-weight:850;margin-bottom:8px;">${title}</div>
        <div style="font-size:14px;line-height:1.45;color:#e2e8f0;">${note}</div>
      `;
      document.body.appendChild(overlay);
    },
    { index, total: steps.length, title: step.title, note: step.note },
  );
}

async function captureStep(page, step, index) {
  const target = new URL(step.route, baseUrl).toString();
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForLoadState("networkidle", { timeout: 7000 }).catch(() => undefined);
  await page.waitForTimeout(900);
  await addOverlay(page, index, step);
  await page.waitForTimeout(1500);
  const screenshotPath = path.join(screenshotDir, `${String(index + 1).padStart(2, "0")}-${step.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  if (index % 2 === 1) {
    await page.mouse.wheel(0, 520).catch(() => undefined);
    await page.waitForTimeout(900);
  }
  return {
    ...step,
    url: page.url(),
    screenshot: path.relative(outDir, screenshotPath),
  };
}

function writeReport(results, videoPath) {
  const rows = results
    .map(
      (step, index) => `
        <section>
          <div class="step">Step ${index + 1}</div>
          <h2>${step.title}</h2>
          <p>${step.note}</p>
          <p><a href="${step.screenshot}">${step.screenshot}</a> · <code>${step.url}</code></p>
          <img src="${step.screenshot}" alt="${step.title}">
        </section>
      `,
    )
    .join("\n");
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Total Poly Print ERP full flow walkthrough</title>
  <style>
    body { margin: 0; background: #f8fafc; color: #0f172a; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { max-width: 1120px; margin: 0 auto; padding: 36px 24px 72px; }
    header { border-radius: 24px; padding: 28px; color: white; background: linear-gradient(135deg, #1d4ed8, #7c3aed); box-shadow: 0 20px 50px rgba(30, 64, 175, .2); }
    h1 { margin: 0 0 10px; font-size: 34px; line-height: 1.05; }
    h2 { margin: 4px 0 8px; font-size: 24px; }
    p { color: #475569; line-height: 1.55; }
    header p { color: #dbeafe; max-width: 820px; }
    video, img { width: 100%; border-radius: 16px; border: 1px solid #e2e8f0; background: white; box-shadow: 0 12px 36px rgba(15, 23, 42, .08); }
    section { margin-top: 26px; border-radius: 20px; background: white; padding: 22px; border: 1px solid #e2e8f0; box-shadow: 0 12px 30px rgba(15, 23, 42, .05); }
    code { background: #f1f5f9; padding: 2px 6px; border-radius: 7px; }
    a { color: #2563eb; font-weight: 700; text-decoration: none; }
    .step { display: inline-flex; align-items: center; height: 26px; border-radius: 999px; padding: 0 10px; background: #eef2ff; color: #4338ca; font-weight: 800; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Total Poly Print ERP full flow walkthrough</h1>
      <p>Captured from ${baseUrl} on ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}. Use this as the local training artifact for inventory, product master, sales, planner, WCM, machine terminal, packing yard, dispatch, stock lifecycle, and EOD packing stock.</p>
    </header>
    ${videoPath ? `<section><div class="step">Video</div><h2>Recorded walkthrough</h2><p><a href="${path.relative(outDir, videoPath)}">${path.relative(outDir, videoPath)}</a></p><video controls src="${path.relative(outDir, videoPath)}"></video></section>` : ""}
    ${rows}
  </main>
</body>
</html>`;
  fs.writeFileSync(reportPath, html, "utf8");
}

const browser = await launchBrowser();
const context = await browser.newContext({
  storageState: fs.existsSync(storagePath) ? storagePath : undefined,
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } },
});
const page = await context.newPage();
const video = page.video();
const results = [];
let videoPath = null;

try {
  await ensureShell(page);
  for (const [index, step] of steps.entries()) {
    results.push(await captureStep(page, step, index));
  }
} finally {
  await context.close();
  videoPath = await video?.path().catch(() => null);
  await browser.close();
}

writeReport(results, videoPath);
fs.writeFileSync(
  manifestPath,
  JSON.stringify(
    {
      baseUrl,
      generatedAt: new Date().toISOString(),
      outputDir: outDir,
      reportPath,
      videoPath,
      steps: results,
      evidence: {
        acceptanceReport: path.join(repoRoot, ".runtime", "ui-e2e", "acceptance", "e2e_report.md"),
        wipTruth: path.join(repoRoot, ".runtime", "ui-e2e", "acceptance", "wip_route_truth.md"),
        inhousePackaging: path.join(repoRoot, ".runtime", "ui-e2e", "acceptance", "inhouse_packaging_proof.md"),
      },
    },
    null,
    2,
  ),
  "utf8",
);

console.log(`Walkthrough captured: ${reportPath}`);
if (videoPath) console.log(`Video: ${videoPath}`);
