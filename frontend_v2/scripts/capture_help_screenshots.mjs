import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appRoot, "..");
const screenshotDir = path.join(appRoot, "public", "help", "screenshots");
const reportPath = path.join(repoRoot, ".runtime", "help-screenshots-report.json");

const pages = JSON.parse(fs.readFileSync(path.join(appRoot, "src", "help", "content", "pages", "pages.json"), "utf8"));
const routeRegistrySource = fs.readFileSync(path.join(appRoot, "src", "help", "route-registry.ts"), "utf8");

function parseRouteSet(name) {
  const block = routeRegistrySource.match(new RegExp(`${name}\\s*=\\s*new Set<string>\\(\\[([\\s\\S]*?)\\]\\)`));
  if (!block) return [];
  return [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

function screenshotKeyForPage(page) {
  const keys = page?.screenshotKeys || [];
  return keys.find((key) => key.includes("overview")) || keys[0] || null;
}

function isConcreteRoute(route) {
  return route && route.startsWith("/") && !route.includes("[") && !route.includes("...");
}

const baseUrl = process.env.UI_BASE_URL || "http://127.0.0.1:3001";
const storagePath = process.env.UI_E2E_STORAGE_STATE || path.join(repoRoot, ".runtime", "ui-e2e", "storage", "help-screenshots-admin.json");
const browserChannel = process.env.PLAYWRIGHT_BROWSER_CHANNEL || "chrome";
const identifier = process.env.UI_E2E_ADMIN_USER || "admin";
const password = process.env.UI_E2E_ADMIN_PASSWORD || "admin123";
const backendOrigin = resolveApiOrigin(baseUrl);
const requestedRoutes = String(process.env.HELP_SCREENSHOT_ROUTES || "")
  .split(",")
  .map((route) => route.trim())
  .filter(Boolean);
const routes = Array.from(new Set(requestedRoutes.length ? requestedRoutes : [
  ...parseRouteSet("MAIN_NAV_ROUTES"),
  ...parseRouteSet("INLINE_HELP_CRITICAL_PATTERNS"),
])).filter(isConcreteRoute);

fs.mkdirSync(screenshotDir, { recursive: true });
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.mkdirSync(path.dirname(storagePath), { recursive: true });

function resolveApiOrigin(url) {
  const parsed = new URL(url);
  const apiPort = String(process.env.UI_E2E_API_PORT || process.env.NEXT_PUBLIC_API_PORT || "8000").trim() || "8000";
  return `${parsed.protocol}//${parsed.hostname}:${apiPort}`;
}

async function clearRoleOverride(page) {
  await page.evaluate(() => {
    document.cookie = "x_role_override=; Max-Age=0; path=/";
    try {
      window.localStorage.removeItem("x_role_override");
    } catch {}
    try {
      window.sessionStorage.removeItem("x_role_override");
    } catch {}
  }).catch(() => undefined);
}

async function waitForAuthenticatedShell(page, timeout = 15000) {
  await Promise.any([
    page.getByTestId("sidebar-nav").waitFor({ state: "visible", timeout }),
    page.getByTestId("profile-menu-trigger").waitFor({ state: "visible", timeout }),
    page.getByRole("button", { name: /help/i }).first().waitFor({ state: "visible", timeout }),
    page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout }),
  ]);
}

async function apiLogin(page) {
  const requestContext = page.context().request;
  const csrfResponse = await requestContext.get(`${backendOrigin}/api/users/csrf/`, {
    failOnStatusCode: false,
  });
  const csrfPayload = await csrfResponse.json().catch(() => ({}));
  const requestStateBefore = await requestContext.storageState();
  const cookieToken = requestStateBefore.cookies.find((cookie) => cookie.name === "csrftoken")?.value;
  const csrfToken = String(cookieToken || csrfPayload?.csrfToken || csrfPayload?.csrf_token || "");

  await requestContext.post(`${backendOrigin}/api/users/token/refresh/`, {
    failOnStatusCode: false,
    headers: {
      "Content-Type": "application/json",
      ...(csrfToken ? { "X-CSRFToken": decodeURIComponent(csrfToken) } : {}),
    },
    data: {},
  }).catch(() => undefined);

  let meResponse = await requestContext.get(`${backendOrigin}/api/users/me/`, {
    failOnStatusCode: false,
  });

  if (!meResponse.ok()) {
    await requestContext.post(`${backendOrigin}/api/users/login/`, {
      failOnStatusCode: false,
      headers: {
        "Content-Type": "application/json",
        ...(csrfToken ? { "X-CSRFToken": decodeURIComponent(csrfToken) } : {}),
      },
      data: { identifier, password },
    });
    meResponse = await requestContext.get(`${backendOrigin}/api/users/me/`, {
      failOnStatusCode: false,
    });
  }

  if (!meResponse.ok()) {
    const payload = await meResponse.json().catch(() => ({}));
    return {
      ok: false,
      detail: payload?.detail || payload?.message || `session probe returned ${meResponse.status()}`,
    };
  }

  const requestState = await requestContext.storageState();
  if (requestState.cookies.length) {
    await page.context().addCookies(requestState.cookies);
  }
  return { ok: true, detail: "authenticated" };
}

async function uiLogin(page) {
  await page.goto(new URL("/login", baseUrl).toString(), { waitUntil: "domcontentloaded" });
  await clearRoleOverride(page);
  await page.getByTestId("login-identifier").fill(identifier);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30000 });
}

async function ensureAuthenticated(page) {
  await page.goto(new URL("/login", baseUrl).toString(), { waitUntil: "domcontentloaded" });
  await clearRoleOverride(page);

  const apiResult = await apiLogin(page);
  if (apiResult.ok) {
    await page.goto(new URL("/dashboard/admin", baseUrl).toString(), { waitUntil: "domcontentloaded" });
    await clearRoleOverride(page);
    try {
      await waitForAuthenticatedShell(page, 10000);
      await page.context().storageState({ path: storagePath });
      return;
    } catch {
      // Fall through to the visible login flow if the browser shell did not hydrate.
    }
  }

  await uiLogin(page);
  await page.goto(new URL("/dashboard/admin", baseUrl).toString(), { waitUntil: "domcontentloaded" });
  await clearRoleOverride(page);
  await waitForAuthenticatedShell(page, 15000);
  await page.context().storageState({ path: storagePath });
}

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

const browser = await launchBrowser();
const context = await browser.newContext({
  storageState: fs.existsSync(storagePath) ? storagePath : undefined,
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
const results = [];

await ensureAuthenticated(page);

for (const route of routes) {
  const guide = pages.find((entry) => entry.routePattern === route);
  const key = screenshotKeyForPage(guide);
  if (!guide || !key) {
    results.push({ route, status: "skipped", reason: "missing guide or screenshot key" });
    continue;
  }

  const target = new URL(route, baseUrl).toString();
  const filePath = path.join(screenshotDir, `${key}.png`);
  try {
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
    const title = await page.title();
    const currentUrl = page.url();
    const blocked = new URL(currentUrl).pathname.startsWith("/login");
    await page.screenshot({ path: filePath, fullPage: false });
    results.push({
      route,
      key,
      file: path.relative(appRoot, filePath),
      status: blocked ? "login" : "captured",
      title,
      url: currentUrl,
    });
  } catch (error) {
    results.push({
      route,
      key,
      file: path.relative(appRoot, filePath),
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

await browser.close();

fs.writeFileSync(reportPath, JSON.stringify({
  generated_at: new Date().toISOString(),
  baseUrl,
  browserChannel,
  storagePath,
  results,
}, null, 2));

const captured = results.filter((item) => item.status === "captured").length;
const failed = results.filter((item) => item.status === "failed").length;
const login = results.filter((item) => item.status === "login").length;
console.log(`Captured ${captured} help screenshot(s), ${login} login redirect(s), ${failed} failed. Report: ${reportPath}`);

if (failed > 0 || login > 0) {
  process.exitCode = 1;
}
