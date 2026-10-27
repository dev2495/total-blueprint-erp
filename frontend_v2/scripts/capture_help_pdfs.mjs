// Saves the illustrated help guide as PDFs for the NotebookLM help bot (docs/help-notebook-pdf):
// one PDF per module (English, then Hindi), each with the module overview and every screen with its
// screenshot. One file per module keeps the pack under NotebookLM's 50-source limit.
// The two languages are joined with pypdf from the repo venv (venv/bin/python).
// Run against a running build: GUIDE_URL=http://127.0.0.1:3401 node scripts/capture_help_pdfs.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";
import { chromium } from "playwright";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.resolve(appRoot, "..", "docs", "help-notebook-pdf");
const base = process.env.GUIDE_URL || "http://127.0.0.1:3000";
const pages = JSON.parse(fs.readFileSync(path.join(appRoot, "src/help/content/pages/pages.json"), "utf8"));
const order = ["Sales", "Planner", "Production", "Dashboard", "Logistics", "Inventory", "Gate", "Master Data", "Engineering", "Factory", "Maintenance", "Procurement", "Analytics", "System"];
const present = new Set(pages.map((p) => p.module));
const modules = order.filter((m) => present.has(m));
const slug = (m) => m.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
let index = 0;
for (const module of modules) {
  index += 1;
  for (const lang of ["en", "hi"]) {
    await page.goto(`${base}/guide?module=${slug(module)}&print=1${lang === "hi" ? "&lang=hi" : ""}`, { waitUntil: "networkidle" });
    await page.evaluate(async () => {
      for (const img of Array.from(document.images)) {
        img.loading = "eager";
        if (!img.complete) await new Promise((resolve) => { img.onload = img.onerror = resolve; });
      }
    });
    const file = path.join(outDir, `part-${slug(module)}-${lang}.pdf`);
    await page.pdf({ path: file, format: "A4", printBackground: true, margin: { top: "12mm", bottom: "12mm", left: "10mm", right: "10mm" } });
  }
  const parts = ["en", "hi"].map((lang) => path.join(outDir, `part-${slug(module)}-${lang}.pdf`));
  const file = path.join(outDir, `${String(index).padStart(2, "0")}-${slug(module)}-illustrated.pdf`);
  execFileSync(path.resolve(appRoot, "..", "venv", "bin", "python"), [
    "-c",
    "import sys, pypdf\nw = pypdf.PdfWriter()\nfor p in sys.argv[2:]: w.append(p)\nw.write(sys.argv[1])",
    file,
    ...parts,
  ]);
  parts.forEach((part) => fs.rmSync(part));
  console.log(path.basename(file), Math.round(fs.statSync(file).size / 1024), "KB");
}
await browser.close();
