const { chromium } = require("playwright");

const BASE_URL = process.env.UI_E2E_BASE_URL || "http://127.0.0.1:3000";
const API_URL = process.env.UI_E2E_API_URL || "http://127.0.0.1:8000";
const USER = process.env.UI_E2E_ADMIN_USER || "admin";
const PASSWORD = process.env.UI_E2E_ADMIN_PASSWORD || "admin123";

const routeChecks = [
  { route: "/analytics/reports", anchor: /Reports Hub/i },
  { route: "/analytics/reports/production", api: "/api/analytics/reports/production/", anchor: /Production Performance/i, kind: "object" },
  { route: "/analytics/reports/oee", api: "/api/analytics/reports/oee/", anchor: /OEE Deep Dive/i, kind: "object" },
  { route: "/analytics/reports/downtime", api: "/api/analytics/reports/downtime/", anchor: /Downtime Analysis/i, kind: "object" },
  { route: "/analytics/reports/scrap", api: "/api/analytics/reports/scrap/", anchor: /Scrap & Yield/i, kind: "object" },
  { route: "/analytics/reports/inventory", api: "/api/analytics/reports/inventory/", anchor: /Inventory Health/i, kind: "object" },
  { route: "/analytics/reports/interplant", api: "/api/analytics/reports/interplant/", anchor: /Inter-Plant Logistics/i, kind: "object" },
  { route: "/analytics/reports/mrp", api: "/api/analytics/reports/mrp/", anchor: /MRP & Consumption Variance/i, kind: "object" },
  { route: "/analytics/reports/sales", api: "/api/analytics/reports/sales/", anchor: /Sales Fulfillment/i, kind: "object" },
  { route: "/analytics/reports/dispatch", api: "/api/analytics/reports/dispatch/", anchor: /Dispatch & Logistics/i, kind: "object" },
  { route: "/analytics/reports/operator", api: "/api/analytics/reports/operator/", anchor: /Operator Performance/i, kind: "object" },
  { route: "/analytics/reports/costing", api: "/api/analytics/reports/costing/", anchor: /Costing & Profitability/i, kind: "object" },
  { route: "/analytics/inventory-health", api: "/api/inventory/health/", anchor: /Inventory Health/i, kind: "object" },
  { route: "/analytics/inventory-history", api: "/api/inventory/snapshots/?limit=180&days=180", anchor: /Inventory Snapshot History/i, kind: "array" },
  { route: "/analytics/capability-matrix", api: "/api/analytics/capability-matrix/", anchor: /Capability Matrix/i, kind: "object" },
  { route: "/analytics/mrp", anchor: /MRP Center/i },
];

function ensurePayload(data, kind) {
  if (!kind) return;
  if (kind === "array" && (!Array.isArray(data) || data.length === 0)) {
    throw new Error("Expected non-empty array payload");
  }
  if (kind === "object" && (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).length === 0)) {
    throw new Error("Expected non-empty object payload");
  }
}

async function login(page) {
  const resolveVisibleLocator = async (candidates) => {
    for (const candidate of candidates) {
      const locator = candidate();
      if (await locator.first().isVisible().catch(() => false)) {
        return locator.first();
      }
    }
    return candidates[0]().first();
  };

  const requestContext = page.context().request;
  const csrfResponse = await requestContext.get(`${API_URL}/api/users/csrf/`, { failOnStatusCode: false });
  const csrfPayload = await csrfResponse.json().catch(() => ({}));
  const storageBefore = await requestContext.storageState();
  const cookieToken = storageBefore.cookies.find((cookie) => cookie.name === "csrftoken")?.value;
  const csrfToken = decodeURIComponent(cookieToken || csrfPayload.csrfToken || csrfPayload.csrf_token || "");

  await requestContext.post(`${API_URL}/api/users/login/`, {
    failOnStatusCode: false,
    headers: {
      "Content-Type": "application/json",
      ...(csrfToken ? { "X-CSRFToken": csrfToken } : {}),
    },
    data: { identifier: USER, password: PASSWORD },
  });

  const meResponse = await requestContext.get(`${API_URL}/api/users/me/`, { failOnStatusCode: false });
  if (!meResponse.ok()) {
    const body = await meResponse.text();
    throw new Error(`Failed to establish authenticated session (${meResponse.status()}): ${body}`);
  }

  const storageState = await requestContext.storageState();
  if (storageState.cookies.length) {
    await page.context().addCookies(storageState.cookies);
  }

  await page.goto(`${BASE_URL}/dashboard/admin`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2_000);
  if (!page.url().includes("/login")) {
    return;
  }
  try {
    await page.waitForSelector('[data-testid="sidebar-nav"], [data-testid="profile-menu-trigger"], button:has-text("Logout")', { timeout: 7_500 });
    return;
  } catch {
    await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
    const identifierField = await resolveVisibleLocator([
      () => page.getByTestId("login-identifier"),
      () => page.getByLabel(/email|identifier/i),
      () => page.locator('input[type="email"]'),
      () => page.locator('input[name="identifier"]'),
    ]);
    const passwordField = await resolveVisibleLocator([
      () => page.getByTestId("login-password"),
      () => page.getByLabel(/password/i),
      () => page.locator('input[type="password"]'),
    ]);
    const submitButton = await resolveVisibleLocator([
      () => page.getByTestId("login-submit"),
      () => page.getByRole("button", { name: /open erp|sign in|login/i }),
    ]);

    await identifierField.fill(USER);
    await passwordField.fill(PASSWORD);
    await submitButton.waitFor({ state: "visible", timeout: 15_000 });
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 }),
      submitButton.click(),
    ]);
    await page.waitForSelector('[data-testid="sidebar-nav"], [data-testid="profile-menu-trigger"], button:has-text("Logout")', { timeout: 30_000 });
  }
}

async function verifyNotificationTray(page) {
  await page.goto(`${BASE_URL}/dashboard/admin`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="notification-bell-trigger"]', { timeout: 30_000 });
  await page.click('[data-testid="notification-bell-trigger"]');
  await page.waitForSelector('[data-testid="notification-bell-popover"]', { timeout: 15_000 });

  const popover = page.locator('[data-testid="notification-bell-popover"]').first();
  const item = page.locator("[data-testid^='notification-item-']").first();
  await item.waitFor({ state: "visible", timeout: 15_000 });

  const trayInfo = await popover.evaluate((node) => {
    const style = window.getComputedStyle(node);
    return {
      overflowY: style.overflowY,
      maxHeight: style.maxHeight,
    };
  });
  if (!["auto", "scroll"].includes(trayInfo.overflowY)) {
    throw new Error(`Notification tray overflow is not scrollable (${trayInfo.overflowY})`);
  }

  await item.click();
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const request = page.context().request;
  const runtimeIssues = [];

  page.on("pageerror", (error) => {
    runtimeIssues.push(`pageerror: ${error.message}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      runtimeIssues.push(`console:${message.type()}: ${message.text()}`);
    }
  });
  page.on("response", (response) => {
    const url = response.url();
    if (url.startsWith(BASE_URL) && response.status() >= 400) {
      runtimeIssues.push(`response:${response.status()}: ${url}`);
    }
  });

  try {
    console.log(`Logging into ${BASE_URL} as ${USER}`);
    await login(page);

    for (const check of routeChecks) {
      if (check.api) {
        const response = await request.get(`${BASE_URL}${check.api}`, { failOnStatusCode: false });
        if (response.status() !== 200) {
          throw new Error(`${check.api} returned ${response.status()}`);
        }
        const data = await response.json().catch(() => null);
        ensurePayload(data, check.kind);
      }

      await page.goto(`${BASE_URL}${check.route}`, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
      const text = await page.locator("body").innerText();
      if (!check.anchor.test(text)) {
        throw new Error(`${check.route} did not render expected anchor ${check.anchor}. URL=${page.url()} BODY=${text.slice(0, 400)} ISSUES=${runtimeIssues.join(" | ")}`);
      }
      console.log(`OK ${check.route}`);
    }

    await verifyNotificationTray(page);
    if (runtimeIssues.length) {
      throw new Error(`Runtime issues detected: ${runtimeIssues.join(" | ")}`);
    }
    console.log("OK notification tray");
    console.log("Analytics runtime verification passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
