import fs from "node:fs/promises"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const playwrightModulePath = path.join(repoRoot, "frontend_v2/node_modules/playwright/index.js")
const playwrightModule = await import(playwrightModulePath)
const playwrightPkg = playwrightModule.default ?? playwrightModule

const { chromium } = playwrightPkg

const root = path.join(repoRoot, ".runtime/ui-e2e")
const webOrigin = "http://127.0.0.1:3000"
const apiOrigin = "http://127.0.0.1:8000"
const failurePatterns = [/internal server error/i, /page not found/i, /application error/i, /something went wrong/i]

function runtimePath(name) {
  return path.join(root, name)
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function isIgnorableBrowserNoise(entry) {
  const text = String(entry?.text || "").toLowerCase()
  const url = String(entry?.url || "").toLowerCase()
  if (text.includes("net::err_aborted")) return true
  if (text.includes("preloaded using link preload but not used")) return true
  if (text.includes("width(-1) and height(-1)")) return true
  if (url.includes("/_next/static/") && text.includes("net::err_aborted")) return true
  if (url.includes("/_rsc=") && text.includes("net::err_aborted")) return true
  return false
}

async function ensureDir() {
  await fs.mkdir(root, { recursive: true })
}

async function readJson(fileName) {
  return JSON.parse(await fs.readFile(runtimePath(fileName), "utf8"))
}

async function writeJson(fileName, payload) {
  await fs.writeFile(runtimePath(fileName), JSON.stringify(payload, null, 2), "utf8")
}

async function fileExists(fileName) {
  try {
    await fs.access(runtimePath(fileName))
    return true
  } catch {
    return false
  }
}

function reseedMutationFixtures() {
  const pythonBin = process.env.UI_E2E_PYTHON || process.env.BACKEND_PYTHON || path.join(repoRoot, "venv_311/bin/python")
  console.log("[live-proof] reseed mutation fixtures")
  execFileSync(pythonBin, [path.join(repoRoot, "scripts/seed_ui_e2e_mutations.py")], {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      SKIP_DOTENV_IMPORT: process.env.SKIP_DOTENV_IMPORT || "1",
      SKIP_CELERY_IMPORT: process.env.SKIP_CELERY_IMPORT || "1",
      SKIP_ADMIN_APP_IMPORT: process.env.SKIP_ADMIN_APP_IMPORT || "1",
    },
  })
}

function ensureDryfruitPlannerProof() {
  const pythonBin = process.env.UI_E2E_PYTHON || process.env.BACKEND_PYTHON || path.join(repoRoot, "venv_311/bin/python")
  console.log("[live-proof] generate dryfruit planner proof")
  execFileSync(pythonBin, [path.join(repoRoot, "scripts/run_dryfruit_courier_ui_proof.py")], {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      SKIP_DOTENV_IMPORT: process.env.SKIP_DOTENV_IMPORT || "1",
      SKIP_CELERY_IMPORT: process.env.SKIP_CELERY_IMPORT || "1",
      SKIP_ADMIN_APP_IMPORT: process.env.SKIP_ADMIN_APP_IMPORT || "1",
      UI_E2E_RUNTIME_DIR: root,
    },
  })
}

async function selectByTestId(page, testId, option) {
  const trigger = page.getByTestId(testId)
  const matchesTriggerValue = async () => {
    const text = (await trigger.textContent().catch(() => "")) || ""
    if (typeof option === "string") return text.includes(option)
    return option.test(text)
  }

  if (await matchesTriggerValue()) return

  let lastError = null
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await trigger.click()
      const optionLocator =
        typeof option === "string"
          ? page.getByRole("option", { name: new RegExp(`^${escapeRegex(option)}(?:\\s*\\(|\\s*[•-]|\\s*$)`, "i") }).first()
          : page.getByRole("option", { name: option }).first()
      await optionLocator.waitFor({ state: "visible", timeout: 8000 })
      await optionLocator.click()
      return
    } catch (error) {
      lastError = error
      if (await matchesTriggerValue()) return
      await page.keyboard.press("Escape").catch(() => undefined)
      await page.waitForTimeout(800)
    }
  }

  if (await matchesTriggerValue()) return
  throw lastError || new Error(`Failed to select option for ${testId}`)
}

async function assertHealthyPage(page, label) {
  const body = await page.locator("body").innerText().catch(() => "")
  const matched = failurePatterns.find((pattern) => pattern.test(body))
  if (matched) {
    await page.screenshot({ path: runtimePath(`${label}-failure.png`), fullPage: true })
    throw new Error(`${label} failed health check: ${matched}`)
  }
}

async function login(page) {
  const identifier = process.env.UI_E2E_ADMIN_USER || "admin"
  const password = process.env.UI_E2E_ADMIN_PASSWORD || "admin123"
  const requestContext = page.context().request
  const waitForShell = async (timeout = 10_000) => {
    await Promise.any([
      page.getByTestId("sidebar-nav").waitFor({ state: "visible", timeout }),
      page.getByTestId("profile-menu-trigger").waitFor({ state: "visible", timeout }),
      page.getByRole("button", { name: /logout/i }).waitFor({ state: "visible", timeout }),
      page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout }),
    ])
  }
  const resolveVisibleLocator = async (candidates) => {
    for (const candidate of candidates) {
      const locator = candidate()
      if (await locator.first().isVisible().catch(() => false)) {
        return locator.first()
      }
    }
    return candidates[0]().first()
  }

  console.log("[live-proof] open login")
  await page.goto(`${webOrigin}/login`, { waitUntil: "domcontentloaded" })
  try {
    const form = page.getByTestId("login-form")
    await form.waitFor({ state: "visible", timeout: 30000 })
    await page.waitForTimeout(1200)

    let sessionProbe = null
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const csrfResponse = await requestContext.get(`${apiOrigin}/api/users/csrf/`, {
        failOnStatusCode: false,
      })
      const csrfPayload = await csrfResponse.json().catch(() => ({}))
      const requestStateBefore = await requestContext.storageState()
      const cookieToken = requestStateBefore.cookies.find((cookie) => cookie.name === "csrftoken")?.value
      const csrfToken = String(cookieToken || csrfPayload?.csrfToken || csrfPayload?.csrf_token || "")

      await requestContext
        .post(`${apiOrigin}/api/users/token/refresh/`, {
          failOnStatusCode: false,
          headers: {
            "Content-Type": "application/json",
            ...(csrfToken ? { "X-CSRFToken": decodeURIComponent(csrfToken) } : {}),
          },
          data: {},
        })
        .catch(() => undefined)

      let meResponse = await requestContext.get(`${apiOrigin}/api/users/me/`, {
        failOnStatusCode: false,
      })

      if (!meResponse.ok()) {
        await requestContext.post(`${apiOrigin}/api/users/login/`, {
          failOnStatusCode: false,
          headers: {
            "Content-Type": "application/json",
            ...(csrfToken ? { "X-CSRFToken": decodeURIComponent(csrfToken) } : {}),
          },
          data: { identifier, password },
        })
        meResponse = await requestContext.get(`${apiOrigin}/api/users/me/`, {
          failOnStatusCode: false,
        })
      }

      const mePayload = await meResponse.json().catch(() => ({}))
      sessionProbe = {
        ok: meResponse.ok(),
        status: meResponse.status(),
        detail:
          mePayload?.detail ||
          mePayload?.message ||
          mePayload?.username ||
          `session probe returned ${meResponse.status()}`,
      }

      if (sessionProbe.ok || sessionProbe.status !== 429) {
        break
      }

      await page.waitForTimeout(Math.min(2_000 * (attempt + 1), 6_000))
    }

    if (!sessionProbe?.ok) {
      throw new Error(`Failed to establish authenticated UI session (${sessionProbe.status}): ${sessionProbe.detail}`)
    }

    const requestState = await requestContext.storageState()
    if (requestState.cookies.length) {
      await page.context().addCookies(requestState.cookies)
    }

    await page.goto(`${webOrigin}/dashboard/admin`, { waitUntil: "domcontentloaded" })
    try {
      await waitForShell(7_500)
      console.log("[live-proof] api-backed session ok", page.url())
      return
    } catch {
      console.log("[live-proof] api-backed session still on shell, falling back to UI login")
    }

    await page.goto(`${webOrigin}/login`, { waitUntil: "domcontentloaded" })
    const identifierField = await resolveVisibleLocator([
      () => page.getByTestId("login-identifier"),
      () => page.getByLabel(/email|identifier/i),
      () => page.locator('input[type="email"]'),
      () => page.locator('input[name="identifier"]'),
    ])
    const passwordField = await resolveVisibleLocator([
      () => page.getByTestId("login-password"),
      () => page.getByLabel(/password/i),
      () => page.locator('input[type="password"]'),
    ])
    const submitButton = await resolveVisibleLocator([
      () => page.getByTestId("login-submit"),
      () => page.getByRole("button", { name: /enter workspace|open erp|sign in|login/i }),
    ])

    console.log("[live-proof] submit ui login")
    await identifierField.fill(identifier)
    await passwordField.fill(password)
    await submitButton.click()
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 })
    await waitForShell(30_000)
    console.log("[live-proof] login redirect ok", page.url())
    return
  } catch {
    await page.screenshot({ path: runtimePath("live-proof-login-timeout.png"), fullPage: true })
    throw new Error("Live proof login/bootstrap failed.")
  }
}

async function ensurePlannerPageVisible(page) {
  const sheet = page.getByTestId("planner-operating-sheet")
  const tab = page.getByRole("tab", { name: /completed orders/i })
  const isVisible = async () =>
    (await sheet.isVisible().catch(() => false)) || (await tab.isVisible().catch(() => false))

  if (!(await isVisible())) {
    console.log("[live-proof] planner not visible, reloading")
    await page.reload({ waitUntil: "domcontentloaded" })
    const started = Date.now()
    while (!(await isVisible())) {
      if (Date.now() - started > 120000) {
        await page.screenshot({ path: runtimePath("live-proof-planner-timeout.png"), fullPage: true })
        const body = await page.locator("body").innerText().catch(() => "")
        await fs.writeFile(runtimePath("live-proof-planner-timeout.txt"), body, "utf8")
        throw new Error("Planner control tower did not render in time.")
      }
      await page.waitForTimeout(1000)
    }
  }
  console.log("[live-proof] planner visible")
}

async function fetchJson(requestContext, url, timeoutMs = 30_000) {
  const response = await requestContext.get(url, { failOnStatusCode: false, timeout: timeoutMs })
  const data = await response.json().catch(() => ({}))
  return { status: response.status(), data }
}

async function fetchBinaryMeta(requestContext, url) {
  const response = await requestContext.get(url, { failOnStatusCode: false })
  const buffer = await response.body()
  return {
    status: response.status(),
    contentType: response.headers()["content-type"] || "",
    byteLength: buffer.length,
  }
}

function unwrapApiList(payload) {
  if (Array.isArray(payload)) return payload
  if (payload && typeof payload === "object") {
    for (const key of ["results", "data", "queue", "jobs", "runs", "profiles"]) {
      if (Array.isArray(payload[key])) return payload[key]
    }
  }
  return []
}

async function waitForCondition(check, label, timeoutMs = 90_000, intervalMs = 800) {
  const started = Date.now()
  let lastError = null
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await check()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw lastError || new Error(`Timed out waiting for ${label}`)
}

async function locatorTexts(locator) {
  const count = await locator.count()
  const values = []
  for (let index = 0; index < count; index += 1) {
    values.push((((await locator.nth(index).textContent()) || "").trim()))
  }
  return values.filter(Boolean)
}

function latestDispatchChallan(rows, salesOrderNumber) {
  return rows
    .filter((row) => String(row.so_number || row.sales_order_number || "") === salesOrderNumber)
    .sort((left, right) => new Date(String(right.dispatch_date || right.created_at || 0)).getTime() - new Date(String(left.dispatch_date || left.created_at || 0)).getTime())[0]
}

async function waitForResponseOrThrow(page, predicate, action, errorMessage) {
  const responsePromise = page.waitForResponse(predicate, { timeout: 30_000 })
  await action()
  try {
    return await responsePromise
  } catch (error) {
    throw new Error(errorMessage || String(error))
  }
}

async function waitForTextGone(page, text, timeout = 30_000) {
  await page.getByText(text).waitFor({ state: "hidden", timeout }).catch(() => undefined)
}

async function main() {
  console.log("[live-proof] start")
  await ensureDir()
  reseedMutationFixtures()
  const needsDryfruitProof = !(await fileExists("dryfruit-courier-ui-proof.json")) || !(await fileExists("sales-seed.json"))
  if (needsDryfruitProof) {
    ensureDryfruitPlannerProof()
  }
  const proof = await readJson("dryfruit-courier-ui-proof.json")
  const mutationSeed = await readJson("mutation-seed.json")
  const salesSeed = await readJson("sales-seed.json")
  const salesOrderId = String(proof?.dryfruit?.sales_orders?.fg?.sales_order_id || "")
  const salesOrderNumber = String(proof?.dryfruit?.sales_orders?.fg?.sales_order_number || "")
  const batchId = String(proof?.dryfruit?.direct_fg_stock_order?.batch_id || "")
  const batchNumber = String(proof?.dryfruit?.direct_fg_stock_order?.batch_number || "")
  const rollSalesOrderId = String(mutationSeed?.dispatch?.sales_order_id || "")
  const rollSalesOrderNumber = String(mutationSeed?.dispatch?.sales_order_number || "")
  const rollId = String(mutationSeed?.dispatch?.roll_id || "")
  const rollLabel = String(mutationSeed?.dispatch?.roll_label || "")
  const rollPackagingMaterialId = String(mutationSeed?.dispatch?.packaging_material_id || "")
  const rollPackagingQty = Number(mutationSeed?.dispatch?.packaging_qty || 0)
  const sharedSkuCode = String(salesSeed?.shared_sku_code || proof?.dryfruit?.sku_code || "")
  const sharedVariantName = String(salesSeed?.shared_variant_name || "")
  const salesCustomerName = String(salesSeed?.customer_name || "UAT-GREEN Sales Customer")
  const repeatLineName = String(salesSeed?.repeat_line_name || "UAT-GREEN Repeat Pouch")
  if (!salesOrderId || !salesOrderNumber || !batchId) {
    throw new Error("Dry-fruit proof artifact is missing FG sales order or batch data.")
  }
  if (!rollSalesOrderId || !rollSalesOrderNumber || !rollId) {
    throw new Error("Mutation seed is missing roll dispatch proof data.")
  }
  if (!sharedSkuCode || !sharedVariantName) {
    throw new Error("Sales seed is missing shared SKU data for live UI proof.")
  }

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  const requestContext = page.context().request
  const runtimeIssues = []

  page.on("console", (message) => {
    const type = message.type()
    if (["error", "warning"].includes(type)) {
      const entry = { kind: "console", type, text: message.text() }
      if (isIgnorableBrowserNoise(entry)) return
      runtimeIssues.push(entry)
      console.log(`[live-proof][console:${type}] ${message.text()}`)
    }
  })
  page.on("pageerror", (error) => {
    const entry = { kind: "pageerror", text: error?.stack || error?.message || String(error) }
    if (isIgnorableBrowserNoise(entry)) return
    runtimeIssues.push(entry)
    console.log(`[live-proof][pageerror] ${entry.text}`)
  })
  page.on("requestfailed", (request) => {
    const failure = request.failure()
    const entry = {
      kind: "requestfailed",
      url: request.url(),
      text: failure?.errorText || "request failed",
    }
    if (isIgnorableBrowserNoise(entry)) return
    runtimeIssues.push(entry)
    console.log(`[live-proof][requestfailed] ${request.url()} :: ${entry.text}`)
  })
  page.on("response", async (response) => {
    if (response.status() < 400) return
    const request = response.request()
    const entry = {
      kind: "response",
      status: response.status(),
      method: request.method(),
      url: response.url(),
    }
    runtimeIssues.push(entry)
    console.log(`[live-proof][response:${response.status()}] ${request.method()} ${response.url()}`)
  })

  try {
    await login(page)

    const controlHubProbe = await fetchJson(
      requestContext,
      `${apiOrigin}/api/production/planner/control-hub/?planning_limit=18&active_limit=24&history_limit=120&history_days=30`,
      120_000,
    )
    console.log("[live-proof] control-hub probe", controlHubProbe.status)
    await writeJson("live-proof-control-hub-probe.json", controlHubProbe)

    console.log("[live-proof] goto planner")
    await page.goto(`${webOrigin}/production/planner`, { waitUntil: "domcontentloaded" })
    await assertHealthyPage(page, "planner")
    await ensurePlannerPageVisible(page)
    await page.getByTestId("planner-operating-sheet").waitFor({ state: "visible", timeout: 30000 })
    await page.locator("body").getByText(/suggested action/i).first().waitFor({ state: "visible", timeout: 30000 })
    await page.screenshot({ path: runtimePath("live-planner-control-tower.png"), fullPage: true })

    console.log("[live-proof] completed orders")
    await page.getByRole("tab", { name: /completed orders/i }).click()
    await page.getByRole("button", { name: /^30 days$/i }).waitFor({ state: "visible", timeout: 30000 })
    await page.locator("table tbody tr").first().waitFor({ state: "visible", timeout: 30000 })
    const expandButton = page.getByRole("button", { name: /show jobs/i }).first()
    if (await expandButton.isVisible().catch(() => false)) {
      await expandButton.click().catch(() => undefined)
      await page.locator("body").getByText(/completed jobs/i).first().waitFor({ state: "visible", timeout: 15000 }).catch(() => undefined)
    }
    await page.screenshot({ path: runtimePath("live-planner-completed-orders.png"), fullPage: true })

    console.log("[live-proof] stock launcher")
    await page.goto(`${webOrigin}/production/planner/stock-launcher`, { waitUntil: "domcontentloaded" })
    await assertHealthyPage(page, "stock-launcher")
    await page.getByRole("heading", { name: /stock launcher|create stock orders/i }).waitFor({ state: "visible", timeout: 30000 })
    await page.getByTestId("planner-stock-launch-studio").waitFor({ state: "visible", timeout: 30000 })

    console.log("[live-proof] stock launcher dryfruit fg")
    await selectByTestId(page, "planner-stock-sales-sku", new RegExp(sharedSkuCode, "i"))
    await selectByTestId(page, "planner-stock-sales-variant", new RegExp(sharedVariantName, "i"))
    await page.getByTestId("planner-stock-qty").fill("250")
    await page.getByTestId("planner-stock-add-to-cart").click()

    console.log("[live-proof] stock launcher dryfruit invariant")
    await page.getByTestId("planner-stock-output-invariant").click()
    await page.getByTestId("planner-stock-qty").fill("250")
    await page.getByTestId("planner-stock-add-to-cart").click()

    console.log("[live-proof] stock launcher packaging preset")
    await page.getByTestId("planner-stock-lane-planner").click()
    await page.getByTestId("planner-stock-output-packaging").click()
    await selectByTestId(page, "planner-stock-planner-family", new RegExp(String(proof?.packaging?.planner_sku_code || "PLN-PACK-900X1400"), "i"))
    await selectByTestId(page, "planner-stock-planner-preset", new RegExp(String(proof?.packaging?.variant_code || "PACK-PCH-900X1400-NP"), "i"))
    await page.getByTestId("planner-stock-qty").fill("120")
    await page.getByTestId("planner-stock-add-to-cart").click()

    console.log("[live-proof] stock launcher pod preset")
    await page.getByTestId("planner-stock-output-pod").click()
    await selectByTestId(page, "planner-stock-planner-family", new RegExp(String(proof?.pod?.planner_sku_code || "PLN-POD-1L"), "i"))
    await selectByTestId(page, "planner-stock-planner-preset", new RegExp(String(proof?.pod?.variant_code || "POD-1L-SLIT-STOCK"), "i"))
    await page.getByTestId("planner-stock-qty").fill("80")
    await page.getByTestId("planner-stock-add-to-cart").click()

    await page.getByTestId("planner-stock-release-all").click()
    let stockLauncherOrderNumbers
    try {
      stockLauncherOrderNumbers = await waitForCondition(
        async () => {
          const values = await locatorTexts(page.locator("[data-testid^='planner-stock-cart-line-order-']"))
          return values.length >= 4 ? values : null
        },
        "stock launcher releases",
        120_000,
      )
    } catch (error) {
      const cartSnapshot = await locatorTexts(page.locator("[data-testid^='planner-stock-cart-line-']"))
      await writeJson("stock-launcher-timeout.json", {
        error: String(error?.message || error),
        cart_snapshot: cartSnapshot,
        runtime_issues: runtimeIssues,
      })
      throw error
    }
    await page.screenshot({ path: runtimePath("live-stock-launcher.png"), fullPage: true })

    console.log("[live-proof] sales create order")
    await page.goto(`${webOrigin}/sales/orders/create`, { waitUntil: "domcontentloaded" })
    await assertHealthyPage(page, "sales-orders-create")
    await page.getByTestId("sales-order-batch-workspace").waitFor({ state: "visible", timeout: 30000 })
    await selectByTestId(page, "sales-batch-customer", new RegExp(salesCustomerName, "i"))
    const beforeOrders = unwrapApiList((await fetchJson(requestContext, `${apiOrigin}/api/sales/orders/`)).data)
    const salesRunTag = `${Date.now()}`
    const sharedOrderName = `UAT-GREEN Shared SKU ${salesRunTag}`
    const repeatOrderName = `UAT-GREEN Repeat ${salesRunTag}`
    await selectByTestId(page, "sales-batch-shared-sku", new RegExp(sharedSkuCode, "i"))
    await selectByTestId(page, "sales-batch-shared-variant", new RegExp(sharedVariantName, "i"))
    await page.getByTestId("sales-batch-shared-add").click()
    await page.getByTestId("sales-batch-lane-repeat").click()
    await page.getByTestId("sales-repeat-dialog").waitFor({ state: "visible", timeout: 30000 })
    await page.getByPlaceholder("Search order no, line name, template, or SKU variant").fill(repeatLineName)
    await page.getByTestId("sales-repeat-edit-commercial").first().click()
    await page.getByTestId("sales-batch-order-name").fill(repeatOrderName)
    await page.getByTestId("sales-batch-unit-price").fill("8.75")
    await page.getByTestId("sales-batch-queue-card").nth(1).click()
    await page.getByTestId("sales-batch-order-name").fill(sharedOrderName)
    await page.getByTestId("sales-batch-unit-price").fill("9.25")
    await page.screenshot({ path: runtimePath("live-sales-orders-create.png"), fullPage: true })
    await page.getByTestId("sales-batch-submit").click()
    await page.locator("body").getByText(/Created\s+SO\d+/i).first().waitFor({ state: "visible", timeout: 30_000 })

    const afterOrders = unwrapApiList((await fetchJson(requestContext, `${apiOrigin}/api/sales/orders/`)).data)
    const salesBatchNewOrders = afterOrders
      .map((row) => String(row.order_number || ""))
      .filter((orderNumber) => !beforeOrders.some((row) => String(row.order_number || "") === orderNumber))
    await writeJson("sales-batch-results.json", {
      run_tag: salesRunTag,
      created_order_numbers: salesBatchNewOrders,
      created_orders: afterOrders
        .filter((row) => salesBatchNewOrders.includes(String(row.order_number || "")))
        .map((row) => ({
          id: String(row.id || ""),
          order_number: String(row.order_number || ""),
          order_name: String(row.order_name || ""),
          customer_name: String(row.customer_name || ""),
        })),
    })
    await writeJson("stock-launcher-results.json", {
      created_order_numbers: stockLauncherOrderNumbers,
      shared_sales_sku: sharedSkuCode,
      shared_sales_variant: sharedVariantName,
      packaging_planner_sku: String(proof?.packaging?.planner_sku_code || ""),
      pod_planner_sku: String(proof?.pod?.planner_sku_code || ""),
    })

    console.log("[live-proof] sales orders list")
    await page.goto(`${webOrigin}/sales/orders`, { waitUntil: "domcontentloaded" })
    await assertHealthyPage(page, "sales-orders-list")
    await page.getByTestId("sales-orders-list-page").waitFor({ state: "visible", timeout: 30000 })
    for (const orderNumber of salesBatchNewOrders) {
      await page.locator("body").getByText(orderNumber).first().waitFor({ state: "visible", timeout: 30000 })
    }
    await page.screenshot({ path: runtimePath("live-sales-orders-list.png"), fullPage: true })

    console.log("[live-proof] sales tracking")
    const trackedOrder = afterOrders.find((row) => salesBatchNewOrders.includes(String(row.order_number || ""))) || null
    const trackingOrderId = String(trackedOrder?.id || salesOrderId)
    const trackingOrderNumber = String(trackedOrder?.order_number || salesOrderNumber)
    await page.goto(`${webOrigin}/sales/orders/${trackingOrderId}/tracking`, { waitUntil: "domcontentloaded" })
    await assertHealthyPage(page, "sales-order-tracking")
    await page.getByTestId("sales-order-tracking-page").waitFor({ state: "visible", timeout: 30000 })
    await page.locator("body").getByText(trackingOrderNumber).waitFor({ state: "visible", timeout: 30000 })
    await page.screenshot({ path: runtimePath("live-sales-order-tracking.png"), fullPage: true })

    console.log("[live-proof] packing yard")
    await page.goto(`${webOrigin}/logistics/packing`, { waitUntil: "domcontentloaded" })
    await assertHealthyPage(page, "packing-yard")
    await page.getByTestId("packing-page").waitFor({ state: "visible", timeout: 30000 })
    await selectByTestId(page, "packing-sales-order-select", new RegExp(salesOrderNumber, "i"))
    await waitForTextGone(page, "Loading packing summary...")
    await page.locator("body").getByText(batchNumber).first().waitFor({ state: "visible", timeout: 30000 })
    await page.screenshot({ path: runtimePath("live-packing-yard-before-release.png"), fullPage: true })

    const preSummary = await fetchJson(requestContext, `${apiOrigin}/api/production/packing/so_summary/?sales_order_id=${salesOrderId}`)
    if (preSummary.status !== 200) throw new Error(`Packing summary failed (${preSummary.status})`)

    console.log("[live-proof] create gonny")
    await page.getByTestId(`packing-create-gonny-${batchId}`).click()
    await page.getByTestId("packing-create-gonny-dialog").waitFor({ state: "visible", timeout: 15000 })
    await page.getByTestId("packing-gonny-qty").fill("100")
    await page.getByTestId("packing-gonny-material").selectOption({ index: 1 })
    await page.getByTestId("packing-gonny-content-mode").selectOption("LOOSE_POUCHES")
    await page.getByTestId("packing-gonny-submit").click()
    await page.getByTestId("packing-create-gonny-dialog").waitFor({ state: "hidden", timeout: 15000 })

    const createdSummary = await fetchJson(requestContext, `${apiOrigin}/api/production/packing/so_summary/?sales_order_id=${salesOrderId}`)
    if (createdSummary.status !== 200) throw new Error(`Packing summary after create failed (${createdSummary.status})`)
    const gonny = (createdSummary.data?.gonnies || [])
      .filter((row) => String(row.status || "").toUpperCase() === "OPEN" && String(row.batch_no || "") === batchNumber)
      .sort((left, right) => String(right.id || "").localeCompare(String(left.id || "")))[0]
    if (!gonny?.id) throw new Error("Open gonny was not created for the FG pouch batch.")

    console.log("[live-proof] seal gonny", gonny.id)
    await page.getByTestId(`packing-seal-gonny-${gonny.id}`).click()
    await page.getByTestId("packing-seal-gonny-dialog").waitFor({ state: "visible", timeout: 15000 })
    await page.getByTestId("packing-gonny-seal-weight").fill("1.500")
    await page.getByTestId("packing-gonny-seal-submit").click()
    await page.getByTestId("packing-seal-gonny-dialog").waitFor({ state: "hidden", timeout: 15000 })

    const releasedSummaryBefore = await fetchJson(requestContext, `${apiOrigin}/api/production/packing/so_summary/?sales_order_id=${salesOrderId}`)
    if (releasedSummaryBefore.status !== 200) throw new Error(`Packing summary after seal failed (${releasedSummaryBefore.status})`)
    const sealedGonny = (releasedSummaryBefore.data?.gonnies || [])
      .filter((row) => String(row.status || "").toUpperCase() === "SEALED" && !row.released_to_dispatch)
      .sort((left, right) => String(right.id || "").localeCompare(String(left.id || "")))[0]
    if (!sealedGonny?.id) throw new Error("Sealed gonny awaiting dispatch release was not found.")

    console.log("[live-proof] release gonny", sealedGonny.id)
    await page.getByTestId(`packing-release-gonny-${sealedGonny.id}`).click()
    await waitForTextGone(page, "Loading packing summary...")
    await page.screenshot({ path: runtimePath("live-packing-yard-after-release.png"), fullPage: true })

    console.log("[live-proof] dispatch bay")
    await page.goto(`${webOrigin}/logistics/dispatch`, { waitUntil: "domcontentloaded" })
    await assertHealthyPage(page, "dispatch-bay")
    await page.getByTestId("dispatch-page").waitFor({ state: "visible", timeout: 30000 })
    await selectByTestId(page, "dispatch-sales-order-select", new RegExp(salesOrderNumber, "i"))
    await waitForTextGone(page, "Loading released units...")
    console.log("[live-proof] create challan")
    await page.getByTestId(`dispatch-gonny-checkbox-${sealedGonny.id}`).waitFor({ state: "visible", timeout: 30000 })
    await page.getByTestId(`dispatch-gonny-checkbox-${sealedGonny.id}`).click()
    await page.getByTestId("dispatch-create-trigger").waitFor({ state: "visible", timeout: 15000 })
    await page.getByTestId("dispatch-create-trigger").click()
    await page.getByTestId("dispatch-create-submit").waitFor({ state: "visible", timeout: 15000 })
    await page.getByPlaceholder("MH-XX-AB-XXXX").fill("MH14CD5678")
    const pouchCreateResponse = await waitForResponseOrThrow(
      page,
      (response) => response.url().includes("/api/production/challans/create_challan/") && response.request().method() === "POST",
      () => page.getByTestId("dispatch-create-submit").click(),
      "Dispatch create challan request did not fire for dry-fruit pouch order.",
    )
    if (pouchCreateResponse.status() !== 201) {
      throw new Error(`Dry-fruit pouch challan creation failed with status ${pouchCreateResponse.status()}.`)
    }

    const challansResponse = await fetchJson(requestContext, `${apiOrigin}/api/production/challans/list_challans/`)
    if (challansResponse.status !== 200) throw new Error(`Challan list failed (${challansResponse.status})`)
    const challan = latestDispatchChallan(unwrapApiList(challansResponse.data), salesOrderNumber)
    if (!challan?.id) throw new Error("No challan was created for the dry-fruit sales order.")

    if (String(challan.status || "").toUpperCase() === "DRAFT") {
      console.log("[live-proof] release challan", challan.id)
      await page.getByTestId(`dispatch-send-${challan.id}`).click()
    }

    await page.screenshot({ path: runtimePath("live-dispatch-bay.png"), fullPage: true })

    const pdf = await fetchBinaryMeta(requestContext, `${apiOrigin}/api/production/challans/${challan.id}/print-list/`)
    if (pdf.status !== 200 || !pdf.contentType.includes("application/pdf") || pdf.byteLength <= 1000) {
      throw new Error(`Dispatch PDF proof failed (${pdf.status}, ${pdf.contentType}, ${pdf.byteLength} bytes)`)
    }

    console.log("[live-proof] packing yard roll flow")
    await page.goto(`${webOrigin}/logistics/packing`, { waitUntil: "domcontentloaded" })
    await assertHealthyPage(page, "packing-yard-roll")
    await page.getByTestId("packing-page").waitFor({ state: "visible", timeout: 30000 })
    await selectByTestId(page, "packing-sales-order-select", new RegExp(rollSalesOrderNumber, "i"))
    await waitForTextGone(page, "Loading packing summary...")
    await page.getByTestId(`packing-roll-release-${rollId}`).waitFor({ state: "visible", timeout: 30000 })
    await page.screenshot({ path: runtimePath("live-roll-packing-yard-before-release.png"), fullPage: true })

    await page.getByTestId(`packing-roll-release-${rollId}`).click()
    await page.getByTestId("packing-roll-dialog").waitFor({ state: "visible", timeout: 15000 })
    await page.getByTestId("packing-roll-release-mode").selectOption("PACKED")
    await page.getByTestId("packing-roll-material-0").fill(rollPackagingMaterialId)
    await page.getByTestId("packing-roll-qty-0").fill(String(rollPackagingQty))
    const rollReleaseResponse = await waitForResponseOrThrow(
      page,
      (response) => response.url().includes("/api/production/packing/release-roll/") && response.request().method() === "POST",
      () => page.getByTestId("packing-roll-submit").click(),
      "Packing-yard roll release request did not fire.",
    )
    if (![200, 201].includes(rollReleaseResponse.status())) {
      throw new Error(`Roll release to dispatch failed with status ${rollReleaseResponse.status()}.`)
    }
    await waitForTextGone(page, "Loading packing summary...")
    await page.screenshot({ path: runtimePath("live-roll-packing-yard-after-release.png"), fullPage: true })

    console.log("[live-proof] dispatch bay roll flow")
    await page.goto(`${webOrigin}/logistics/dispatch`, { waitUntil: "domcontentloaded" })
    await assertHealthyPage(page, "dispatch-bay-roll")
    await page.getByTestId("dispatch-page").waitFor({ state: "visible", timeout: 30000 })
    await selectByTestId(page, "dispatch-sales-order-select", new RegExp(rollSalesOrderNumber, "i"))
    await waitForTextGone(page, "Loading released units...")
    await page.getByTestId(`dispatch-roll-checkbox-${rollId}`).waitFor({ state: "visible", timeout: 30000 })
    await page.getByTestId(`dispatch-roll-checkbox-${rollId}`).click()
    await page.getByTestId("dispatch-create-trigger").click()
    await page.getByTestId("dispatch-create-submit").waitFor({ state: "visible", timeout: 15000 })
    await page.getByPlaceholder("MH-XX-AB-XXXX").fill("MH12AB1234")
    const rollCreateResponse = await waitForResponseOrThrow(
      page,
      (response) => response.url().includes("/api/production/challans/create_challan/") && response.request().method() === "POST",
      () => page.getByTestId("dispatch-create-submit").click(),
      "Dispatch create challan request did not fire for roll order.",
    )
    if (rollCreateResponse.status() !== 201) {
      throw new Error(`Roll challan creation failed with status ${rollCreateResponse.status()}.`)
    }

    const rollChallansResponse = await fetchJson(requestContext, `${apiOrigin}/api/production/challans/list_challans/`)
    if (rollChallansResponse.status !== 200) throw new Error(`Roll challan list failed (${rollChallansResponse.status})`)
    const rollChallan = latestDispatchChallan(unwrapApiList(rollChallansResponse.data), rollSalesOrderNumber)
    if (!rollChallan?.id) throw new Error("No challan was created for the roll dispatch sales order.")

    if (String(rollChallan.status || "").toUpperCase() === "DRAFT") {
      const rollDispatchResponse = await waitForResponseOrThrow(
        page,
        (response) => response.url().includes(`/api/production/challans/${rollChallan.id}/dispatch/`) && response.request().method() === "POST",
        () => page.getByTestId(`dispatch-send-${rollChallan.id}`).click(),
        "Dispatch release request did not fire for roll challan.",
      )
      if (rollDispatchResponse.status() !== 200) {
        throw new Error(`Roll challan dispatch failed with status ${rollDispatchResponse.status()}.`)
      }
    }

    await page.screenshot({ path: runtimePath("live-roll-dispatch-bay.png"), fullPage: true })
    const rollPdf = await fetchBinaryMeta(requestContext, `${apiOrigin}/api/production/challans/${rollChallan.id}/print-list/`)
    if (rollPdf.status !== 200 || !rollPdf.contentType.includes("application/pdf") || rollPdf.byteLength <= 1000) {
      throw new Error(`Roll dispatch PDF proof failed (${rollPdf.status}, ${rollPdf.contentType}, ${rollPdf.byteLength} bytes)`)
    }

    await writeJson("live-planner-dispatch-proof.json", {
      generated_at: new Date().toISOString(),
      dryfruit_pouch_flow: {
        sales_order_number: salesOrderNumber,
        fg_batch_number: batchNumber,
        gonny_id: sealedGonny.id,
        challan_id: challan.id,
        challan_no: challan.dc_no,
      },
      roll_flow: {
        sales_order_number: rollSalesOrderNumber,
        roll_id: rollId,
        roll_label: rollLabel,
        challan_id: rollChallan.id,
        challan_no: rollChallan.dc_no,
      },
      stock_launcher_flow: {
        shared_sales_sku: sharedSkuCode,
        shared_sales_variant: sharedVariantName,
        created_order_numbers: stockLauncherOrderNumbers,
      },
      sales_batch_flow: {
        customer_name: salesCustomerName,
        created_order_numbers: salesBatchNewOrders,
      },
      screenshots: {
        planner: runtimePath("live-planner-control-tower.png"),
        completed_orders: runtimePath("live-planner-completed-orders.png"),
        stock_launcher: runtimePath("live-stock-launcher.png"),
        sales_orders_create: runtimePath("live-sales-orders-create.png"),
        sales_orders_list: runtimePath("live-sales-orders-list.png"),
        sales_tracking: runtimePath("live-sales-order-tracking.png"),
        packing_before: runtimePath("live-packing-yard-before-release.png"),
        packing_after: runtimePath("live-packing-yard-after-release.png"),
        dispatch: runtimePath("live-dispatch-bay.png"),
        roll_packing_before: runtimePath("live-roll-packing-yard-before-release.png"),
        roll_packing_after: runtimePath("live-roll-packing-yard-after-release.png"),
        roll_dispatch: runtimePath("live-roll-dispatch-bay.png"),
      },
      dispatch_pdfs: {
        pouch: {
          status: pdf.status,
          content_type: pdf.contentType,
          byte_length: pdf.byteLength,
        },
        roll: {
          status: rollPdf.status,
          content_type: rollPdf.contentType,
          byte_length: rollPdf.byteLength,
        },
      },
      runtime_issues: runtimeIssues,
    })
    console.log("[live-proof] done")
  } finally {
    if (runtimeIssues.length) {
      await writeJson("live-proof-runtime-issues.json", runtimeIssues)
    }
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
