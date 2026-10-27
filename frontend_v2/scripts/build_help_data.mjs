// Writes the per-page help files the app loads on demand (public/help/data):
//   index.json          route pattern → slug, module, roles, title (for matching the current page)
//   pages/<slug>.json   one page guide with its decision flow
// The header help button and inline help boxes fetch these instead of bundling every guide.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const content = path.join(appRoot, "src", "help", "content");
const read = (file) => JSON.parse(fs.readFileSync(path.join(content, file), "utf8"));
const pages = read("pages/pages.json");
const flows = read("flows/flows.json");
const outDir = path.join(appRoot, "public", "help", "data");

export function routeSlug(route) {
  const clean = String(route || "/")
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/\[\.\.\.([^\]]+)\]/g, "$1")
    .replace(/\[([^\]]+)\]/g, "$1")
    .replace(/[^a-zA-Z0-9/_-]+/g, "-")
    .replace(/\//g, "-")
    .replace(/-+/g, "-")
    .toLowerCase();
  return clean || "home";
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(path.join(outDir, "pages"), { recursive: true });
const flowById = new Map(flows.map((flow) => [flow.id, flow]));
const index = [];
for (const guide of pages) {
  const slug = routeSlug(guide.routePattern);
  index.push({ slug, route: guide.routePattern, module: guide.module, roles: guide.roles || [], title: guide.title });
  const flow = flowById.get(guide.decisionFlowId) || null;
  fs.writeFileSync(path.join(outDir, "pages", `${slug}.json`), JSON.stringify({ guide, flow }));
}
fs.writeFileSync(path.join(outDir, "index.json"), JSON.stringify(index));
console.log(`Help data written: ${index.length} page guides`);
