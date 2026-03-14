import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");

const pages = JSON.parse(fs.readFileSync(path.join(appRoot, "src/help/content/pages/pages.json"), "utf8"));
const roles = JSON.parse(fs.readFileSync(path.join(appRoot, "src/help/content/roles/roles.json"), "utf8"));
const flows = JSON.parse(fs.readFileSync(path.join(appRoot, "src/help/content/flows/flows.json"), "utf8"));
const routeRegistrySource = fs.readFileSync(path.join(appRoot, "src/help/route-registry.ts"), "utf8");

const flowIds = new Set(flows.map((flow) => flow.id));
const pagePatterns = new Set(pages.map((page) => page.routePattern));

function walk(dirPath, matcher, output = []) {
  if (!fs.existsSync(dirPath)) return output;
  for (const item of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, item.name);
    if (item.isDirectory()) {
      walk(fullPath, matcher, output);
      continue;
    }
    if (matcher(fullPath)) {
      output.push(fullPath);
    }
  }
  return output;
}

function routeFromPageFile(filePath) {
  const rel = filePath
    .replace(path.join(appRoot, "src", "app", "(dashboard)"), "")
    .replace(/\\/g, "/")
    .replace(/\/page\.tsx$/, "");
  return rel || "/";
}

function hasLocalizedText(value) {
  return Boolean(value)
    && typeof value === "object"
    && typeof value.en === "string"
    && typeof value.hi === "string"
    && value.en.trim().length > 0
    && value.hi.trim().length > 0;
}

function assertLocalizedDeep(value, trace, failures) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertLocalizedDeep(entry, `${trace}[${index}]`, failures));
    return;
  }

  if (!value || typeof value !== "object") return;

  if (Object.prototype.hasOwnProperty.call(value, "en") || Object.prototype.hasOwnProperty.call(value, "hi")) {
    if (!hasLocalizedText(value)) {
      failures.push(`Missing localized text keys at ${trace}`);
    }
    return;
  }

  Object.entries(value).forEach(([key, entry]) => {
    assertLocalizedDeep(entry, `${trace}.${key}`, failures);
  });
}

function screenshotExists(screenshotKey) {
  const candidates = [".svg", ".png", ".jpg", ".jpeg", ".webp"];
  return candidates.some((ext) => fs.existsSync(path.join(appRoot, "public", "help", "screenshots", `${screenshotKey}${ext}`)));
}

function parseRouteSet(name) {
  const block = routeRegistrySource.match(new RegExp(`${name}\\s*=\\s*new Set<string>\\(\\[([\\s\\S]*?)\\]\\)`));
  if (!block) return [];
  return [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

const failures = [];

const dashboardPages = walk(
  path.join(appRoot, "src", "app", "(dashboard)"),
  (filePath) => filePath.endsWith(path.join("page.tsx")),
).map(routeFromPageFile);

for (const route of dashboardPages) {
  if (!pagePatterns.has(route)) {
    failures.push(`No PageGuide found for route: ${route}`);
  }
}

if (pages.length !== dashboardPages.length) {
  failures.push(`Page guide count (${pages.length}) does not match dashboard routes (${dashboardPages.length}).`);
}

for (const page of pages) {
  assertLocalizedDeep(page, `PageGuide(${page.routePattern})`, failures);
  if (!flowIds.has(page.decisionFlowId)) {
    failures.push(`PageGuide ${page.routePattern} references missing flow ${page.decisionFlowId}`);
  }

  for (const screenshotKey of page.screenshotKeys || []) {
    if (!screenshotExists(screenshotKey)) {
      failures.push(`Missing screenshot asset for key ${screenshotKey}`);
    }
  }
}

const rolesFile = fs.readFileSync(path.join(appRoot, "src", "lib", "roles.ts"), "utf8");
const landingBlockMatch = rolesFile.match(/ROLE_LANDING_PAGES:\s*Record<string,\s*string>\s*=\s*\{([\s\S]*?)\};/);
const roleCodes = new Set();

if (landingBlockMatch) {
  for (const match of landingBlockMatch[1].matchAll(/'([A-Z_]+)'\s*:/g)) {
    roleCodes.add(match[1]);
  }
}

for (const code of roleCodes) {
  const exists = roles.some((role) => String(role.roleCode || "").toUpperCase() === code);
  if (!exists) {
    failures.push(`Missing RoleGuide for ${code}`);
  }
}

const uiFiles = walk(path.join(appRoot, "src"), (filePath) => filePath.endsWith(".tsx") || filePath.endsWith(".ts"));
const literalHelpRoutes = new Set();

for (const filePath of uiFiles) {
  const source = fs.readFileSync(filePath, "utf8");
  for (const match of source.matchAll(/helpRoute=\"([^\"]+)\"/g)) {
    literalHelpRoutes.add(match[1]);
  }
}

for (const route of literalHelpRoutes) {
  if (!pagePatterns.has(route)) {
    failures.push(`helpRoute literal points to unknown route: ${route}`);
  }
}

for (const roleGuide of roles) {
  assertLocalizedDeep(roleGuide, `RoleGuide(${roleGuide.roleCode})`, failures);
  for (const screenshotKey of roleGuide.screenshotKeys || []) {
    if (!screenshotExists(screenshotKey)) {
      failures.push(`Missing role screenshot asset for key ${screenshotKey}`);
    }
  }
}

const screenshotRequiredRoutes = new Set([
  ...parseRouteSet("MAIN_NAV_ROUTES"),
  ...parseRouteSet("INLINE_HELP_CRITICAL_PATTERNS"),
]);

for (const route of screenshotRequiredRoutes) {
  const guide = pages.find((page) => page.routePattern === route);
  if (!guide) {
    failures.push(`Screenshot coverage route missing PageGuide: ${route}`);
    continue;
  }
  if (!guide.screenshotKeys || guide.screenshotKeys.length === 0) {
    failures.push(`Main/critical route is missing screenshot keys: ${route}`);
  }
}

if (failures.length > 0) {
  console.error("Help coverage validation failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Help coverage validation passed.");
console.log(`Routes: ${dashboardPages.length}, PageGuides: ${pages.length}, RoleGuides: ${roles.length}, Flows: ${flows.length}`);
