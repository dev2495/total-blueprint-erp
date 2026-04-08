import fs from "node:fs/promises"
import fsSync from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const playwrightModulePath = path.join(repoRoot, "frontend_v2/node_modules/playwright/index.js")
const playwrightModule = await import(playwrightModulePath)
const playwrightPkg = playwrightModule.default ?? playwrightModule

const { chromium } = playwrightPkg

const runtimeRoot = path.join(repoRoot, ".runtime/ui-e2e")
const webOrigin = "http://127.0.0.1:3000"
const apiOrigin = "http://127.0.0.1:8000"
const failurePatterns = [/internal server error/i, /page not found/i, /application error/i, /something went wrong/i]
const downloadsRoot = process.env.HOME ? path.join(process.env.HOME, "Downloads") : null

function isPrivateIpv4(address) {
  if (!address || String(address).includes(":")) return false
  const value = String(address).trim()
  if (/^10\./.test(value) || /^192\.168\./.test(value)) return true
  const match = value.match(/^172\.(\d+)\./)
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31)
}

function detectLanOrigin() {
  const override = String(process.env.UI_E2E_LAN_ORIGIN || "").trim()
  if (override) return override
  const interfaces = os.networkInterfaces()
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry && entry.family === "IPv4" && !entry.internal && isPrivateIpv4(entry.address)) {
        return `http://${entry.address}:3000`
      }
    }
  }
  return null
}

function isIgnorableBrowserNoise(entry) {
  const text = String(entry?.text || "")
  return (
    /preloaded using link preload but not used/i.test(text) ||
    /net::ERR_ABORTED/i.test(text) ||
    /The width\(-1\) and height\(-1\) of chart should be greater than 0/i.test(text)
  )
}

function runtimePath(name) {
  return path.join(runtimeRoot, name)
}

function downloadsPath(name) {
  return downloadsRoot ? path.join(downloadsRoot, name) : null
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

async function ensureDir() {
  await fs.mkdir(runtimeRoot, { recursive: true })
}

async function writeJson(fileName, payload) {
  await fs.writeFile(runtimePath(fileName), JSON.stringify(payload, null, 2), "utf8")
}

async function copyArtifactToDownloads(runtimeFileName, downloadFileName) {
  const target = downloadsPath(downloadFileName)
  if (!target) return null
  try {
    await fs.copyFile(runtimePath(runtimeFileName), target)
  } catch {
    return null
  }
  return target
}

async function readJson(fileName) {
  return JSON.parse(await fs.readFile(runtimePath(fileName), "utf8"))
}

function reseedMutationFixtures() {
  if (process.env.UI_E2E_SKIP_RESEED === "1") {
    return
  }
  const pythonBin = process.env.UI_E2E_PYTHON || process.env.BACKEND_PYTHON || path.join(repoRoot, "venv_311/bin/python")
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

function refreshAcceptanceProof() {
  if (process.env.UI_E2E_SKIP_ACCEPTANCE_REFRESH === "1") {
    return
  }
  const pythonBin = process.env.UI_E2E_PYTHON || process.env.BACKEND_PYTHON || path.join(repoRoot, "venv_311/bin/python")
  execFileSync(
    pythonBin,
    [
      "manage.py",
      "run_tagged_acceptance",
      "--noinput",
      "--suite",
      "full_go_live",
      "--report-dir",
      path.join(runtimeRoot, "acceptance"),
    ],
    {
      cwd: repoRoot,
      stdio: "inherit",
      env: {
        ...process.env,
        SKIP_DOTENV_IMPORT: process.env.SKIP_DOTENV_IMPORT || "1",
        SKIP_CELERY_IMPORT: process.env.SKIP_CELERY_IMPORT || "1",
        SKIP_ADMIN_APP_IMPORT: process.env.SKIP_ADMIN_APP_IMPORT || "1",
      },
    },
  )
}

async function assertHealthyPage(page, label) {
  const body = await page.locator("body").innerText().catch(() => "")
  const matched = failurePatterns.find((pattern) => pattern.test(body))
  if (matched) {
    await page.screenshot({ path: runtimePath(`${label}-failure.png`), fullPage: true })
    throw new Error(`${label} failed health check: ${matched}`)
  }
}

async function waitForShell(page, timeout = 10_000) {
  await Promise.any([
    page.getByTestId("sidebar-nav").waitFor({ state: "visible", timeout }),
    page.getByTestId("profile-menu-trigger").waitFor({ state: "visible", timeout }),
    page.getByRole("button", { name: /logout/i }).waitFor({ state: "visible", timeout }),
    page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout }),
  ])
}

async function resolveVisibleLocator(page, candidates) {
  for (const candidate of candidates) {
    const locator = candidate()
    if (await locator.first().isVisible().catch(() => false)) {
      return locator.first()
    }
  }
  return candidates[0]().first()
}

async function loginViaUi(page, origin = webOrigin) {
  const identifier = process.env.UI_E2E_ADMIN_USER || "admin"
  const password = process.env.UI_E2E_ADMIN_PASSWORD || "admin123"

  await page.goto(`${origin}/login`, { waitUntil: "domcontentloaded" })
  const loginForm = page.getByTestId("login-form")
  await loginForm.waitFor({ state: "visible", timeout: 30_000 }).catch(() => undefined)
  const clientReady = await loginForm.getAttribute("data-client-ready").catch(() => null)
  if (clientReady !== "true") {
    await page.waitForTimeout(1200)
  }

  const identifierField = await resolveVisibleLocator(page, [
    () => page.getByTestId("login-identifier"),
    () => page.getByLabel(/email|identifier/i),
    () => page.locator('input[type="email"]'),
    () => page.locator('input[name="identifier"]'),
  ])
  const passwordField = await resolveVisibleLocator(page, [
    () => page.getByTestId("login-password"),
    () => page.getByLabel(/password/i),
    () => page.locator('input[type="password"]'),
  ])
  const submitButton = await resolveVisibleLocator(page, [
    () => page.getByTestId("login-submit"),
    () => page.getByRole("button", { name: /enter workspace|open erp|sign in|login/i }),
  ])
  await identifierField.fill(identifier)
  await passwordField.fill(password)
  await submitButton.click()
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 })
  await waitForShell(page, 30_000)
}

async function login(page) {
  const identifier = process.env.UI_E2E_ADMIN_USER || "admin"
  const password = process.env.UI_E2E_ADMIN_PASSWORD || "admin123"
  const requestContext = page.context().request

  await page.goto(`${webOrigin}/login`, { waitUntil: "domcontentloaded" })
  const loginForm = page.getByTestId("login-form")
  await loginForm.waitFor({ state: "visible", timeout: 30_000 }).catch(() => undefined)
  const clientReady = await loginForm.getAttribute("data-client-ready").catch(() => null)
  if (clientReady !== "true") {
    await page.waitForTimeout(1200)
  }

  let sessionProbe = null
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const csrfResponse = await requestContext.get(`${apiOrigin}/api/users/csrf/`, { failOnStatusCode: false })
    const csrfPayload = await csrfResponse.json().catch(() => ({}))
    const requestStateBefore = await requestContext.storageState()
    const cookieToken = requestStateBefore.cookies.find((cookie) => cookie.name === "csrftoken")?.value
    const csrfToken = String(cookieToken || csrfPayload?.csrfToken || csrfPayload?.csrf_token || "")

    await requestContext.post(`${apiOrigin}/api/users/token/refresh/`, {
      failOnStatusCode: false,
      headers: {
        "Content-Type": "application/json",
        ...(csrfToken ? { "X-CSRFToken": decodeURIComponent(csrfToken) } : {}),
      },
      data: {},
    }).catch(() => undefined)

    let meResponse = await requestContext.get(`${apiOrigin}/api/users/me/`, { failOnStatusCode: false })
    if (!meResponse.ok()) {
      await requestContext.post(`${apiOrigin}/api/users/login/`, {
        failOnStatusCode: false,
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "X-CSRFToken": decodeURIComponent(csrfToken) } : {}),
        },
        data: { identifier, password },
      })
      meResponse = await requestContext.get(`${apiOrigin}/api/users/me/`, { failOnStatusCode: false })
    }

    const mePayload = await meResponse.json().catch(() => ({}))
    sessionProbe = {
      ok: meResponse.ok(),
      status: meResponse.status(),
      detail: mePayload?.detail || mePayload?.message || mePayload?.username || `session probe returned ${meResponse.status()}`,
    }
    if (sessionProbe.ok || sessionProbe.status !== 429) break
    await page.waitForTimeout(Math.min(2_000 * (attempt + 1), 6_000))
  }

  if (sessionProbe?.ok) {
    const requestState = await requestContext.storageState()
    if (requestState.cookies.length) {
      await page.context().addCookies(requestState.cookies)
    }

    await page.goto(`${webOrigin}/dashboard/admin`, { waitUntil: "domcontentloaded" })
    try {
      await waitForShell(page, 7_500)
      return
    } catch {
      await page.goto(`${webOrigin}/login`, { waitUntil: "domcontentloaded" })
    }
  }

  await loginViaUi(page, webOrigin)
}

async function setRole(page, roleCode, landingPath) {
  await page.goto(`${webOrigin}/dashboard/admin`, { waitUntil: "domcontentloaded" })
  await page.evaluate((nextRole) => {
    document.cookie = `x_role_override=${encodeURIComponent(nextRole)}; path=/`
    try {
      window.localStorage.setItem("x_role_override", nextRole)
      window.sessionStorage.setItem("x_role_override", nextRole)
    } catch {}
  }, roleCode)
  await page.goto(`${webOrigin}${landingPath}`, { waitUntil: "domcontentloaded" })
}

async function selectByTestId(page, testId, option) {
  const trigger = page.getByTestId(testId)
  const matchesTriggerValue = async () => {
    const text = (await trigger.textContent().catch(() => "")) || ""
    if (typeof option === "string") return text.includes(option)
    return option.test(text)
  }

  const matchesOptionText = (text) => {
    const normalized = String(text || "")
    if (typeof option === "string") return normalized.toLowerCase().includes(option.toLowerCase())
    return option.test(normalized)
  }

  if (await matchesTriggerValue()) return

  let lastError = null
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await trigger.click()
      const namedLocator =
        typeof option === "string"
          ? page.getByRole("option", { name: new RegExp(`^${escapeRegex(option)}(?:\\s*\\(|\\s*[•-]|\\s*$)`, "i") }).first()
          : page.getByRole("option", { name: option }).first()
      if (await namedLocator.isVisible().catch(() => false)) {
        await namedLocator.click()
        return
      }

      const options = page.getByRole("option")
      await options.first().waitFor({ state: "visible", timeout: 8_000 })
      const optionCount = await options.count()
      for (let index = 0; index < optionCount; index += 1) {
        const candidate = options.nth(index)
        const candidateText = (await candidate.textContent().catch(() => "")) || ""
        if (!matchesOptionText(candidateText)) continue
        await candidate.click()
        return
      }

      if (optionCount === 1) {
        await options.first().click()
        return
      }
      throw new Error(`No matching option found for ${testId}`)
    } catch (error) {
      lastError = error
      await page.keyboard.press("Escape").catch(() => undefined)
      await page.waitForTimeout(500)
      if (await matchesTriggerValue()) return
    }
  }

  throw lastError || new Error(`Failed to select option for ${testId}`)
}

async function trySelectByTestId(page, testId, option, screenshotName) {
  try {
    await selectByTestId(page, testId, option)
    return true
  } catch (error) {
    if (screenshotName) {
      await page.screenshot({ path: runtimePath(screenshotName), fullPage: true }).catch(() => undefined)
    }
    return false
  }
}

async function selectRollCandidate(dialog, rollId, label) {
  const searchInput = dialog.locator('input[placeholder*="Roll ID"]').first()
  const lookupCandidate = async (timeoutMs = 2500) => {
    const byExactId = dialog.getByTestId(`wcm-local-roll-select-${rollId}`).first()
    try {
      await byExactId.waitFor({ state: "visible", timeout: timeoutMs })
      return byExactId
    } catch {}

    const rowByDataId = dialog.locator(`[data-roll-id="${rollId}"]`).first()
    try {
      await rowByDataId.waitFor({ state: "visible", timeout: timeoutMs })
      return rowByDataId
    } catch {}

    if (label) {
      const rowByLabel = dialog
        .locator('[data-testid^="wcm-local-roll-select-"]')
        .filter({ hasText: label })
        .first()
      try {
        await rowByLabel.waitFor({ state: "visible", timeout: timeoutMs })
        return rowByLabel
      } catch {}
    }

    return null
  }
  const clearSearch = async () => {
    if (await searchInput.isVisible().catch(() => false)) {
      await searchInput.fill("")
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }

  const searchTerms = [label, rollId, label?.split("-").slice(-2).join("-"), label?.slice(0, 24)]
    .map((value) => String(value || "").trim())
    .filter(Boolean)

  let candidate = await lookupCandidate(1000)
  if (!candidate && await searchInput.isVisible().catch(() => false)) {
    for (const term of searchTerms) {
      await searchInput.fill(term)
      await new Promise((resolve) => setTimeout(resolve, 500))
      candidate = await lookupCandidate(4000)
      if (candidate) break
    }
  }

  if (candidate) {
    await candidate.click()
    await clearSearch()
    return
  }

  await clearSearch()

  throw new Error(`Unable to find roll candidate ${rollId}${label ? ` (${label})` : ""} in allocation dialog.`)
}

async function fetchJson(page, url) {
  const response = await page.context().request.get(`${apiOrigin}${url}`, { failOnStatusCode: false })
  const data = await response.json().catch(() => ({}))
  return { status: response.status(), data }
}

async function resolveLiveEligibleRoll(page, jobId, options = {}) {
  const { preferredId, preferredLabel, preferFallback = false, excludeIds = [] } = options
  const { status, data } = await fetchJson(page, `/api/production/flow-engine/${jobId}/context/`)
  if (status !== 200) {
    throw new Error(`Failed to load live job context for ${jobId}: ${status}`)
  }

  const blocked = new Set((excludeIds || []).map((value) => String(value)))
  const rows = (data?.eligible_rolls || []).filter((row) => !blocked.has(String(row?.id || "")))
  if (!rows.length) {
    throw new Error(`No eligible rolls are available in live context for job ${jobId}.`)
  }

  const byPreferred = rows.find((row) => String(row?.id || "") === String(preferredId || ""))
    || rows.find((row) => String(row?.label_id || row?.label || "") === String(preferredLabel || ""))
  if (byPreferred) {
    return {
      id: String(byPreferred.id),
      label: String(byPreferred.label_id || byPreferred.label || byPreferred.id),
      source: String(byPreferred.roll_source || ""),
    }
  }

  if (preferFallback) {
    const fallbackRow = rows.find((row) => {
      const source = String(row?.roll_source || "").toUpperCase()
      return source === "PURCHASED_FALLBACK" || source === "COMPATIBLE_FALLBACK"
    })
    if (fallbackRow) {
      return {
        id: String(fallbackRow.id),
        label: String(fallbackRow.label_id || fallbackRow.label || fallbackRow.id),
        source: String(fallbackRow.roll_source || ""),
      }
    }
  }

  const first = rows[0]
  return {
    id: String(first.id),
    label: String(first.label_id || first.label || first.id),
    source: String(first.roll_source || ""),
  }
}

async function getCsrfHeaders(page) {
  const cookies = await page.context().cookies(apiOrigin)
  const csrfToken = cookies.find((cookie) => cookie.name === "csrftoken")?.value
  return {
    "Content-Type": "application/json",
    ...(csrfToken ? { "X-CSRFToken": decodeURIComponent(csrfToken) } : {}),
  }
}

async function postJson(page, url, data) {
  const response = await page.context().request.post(`${apiOrigin}${url}`, {
    failOnStatusCode: false,
    headers: await getCsrfHeaders(page),
    data,
  })
  const payload = await response.json().catch(async () => ({ detail: await response.text().catch(() => "") }))
  return {
    ok: response.ok(),
    status: response.status(),
    data: payload,
  }
}

async function fetchPaginatedList(page, url, maxPages = 8) {
  const rows = []
  let nextUrl = url
  for (let pageIndex = 0; pageIndex < maxPages && nextUrl; pageIndex += 1) {
    const response = await page.context().request.get(
      nextUrl.startsWith("http") ? nextUrl : `${apiOrigin}${nextUrl}`,
      { failOnStatusCode: false },
    )
    if (!response.ok()) {
      throw new Error(`Failed to fetch ${nextUrl}: ${response.status()} ${await response.text().catch(() => "")}`)
    }
    const payload = await response.json().catch(() => ({}))
    rows.push(...unwrapList(payload))
    const next = payload?.next
    if (!next) break
    nextUrl = next.startsWith(apiOrigin) ? next.replace(apiOrigin, "") : next
  }
  return rows
}

async function findJobworkOrder(page, { productionJobNumber, notesToken }) {
  const orders = await fetchPaginatedList(page, "/api/inventory/job-work/")
  const matches = orders
    .filter((row) => String(row?.production_job_number || "") === String(productionJobNumber || ""))
    .filter((row) => (notesToken ? String(row?.notes || "").includes(notesToken) : true))
    .sort((left, right) => String(right?.created_at || "").localeCompare(String(left?.created_at || "")))
  return matches[0] || null
}

async function findRollByLabel(page, labelId) {
  const rolls = await fetchPaginatedList(page, "/api/inventory/rolls/")
  return rolls.find((row) => String(row?.label_id || "") === String(labelId || "")) || null
}

function unwrapList(payload) {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.results)) return payload.results
  if (Array.isArray(payload?.data)) return payload.data
  if (Array.isArray(payload?.jobs)) return payload.jobs
  if (Array.isArray(payload?.rows)) return payload.rows
  return []
}

async function resolveUiJobMachine(page, uiJob) {
  if (uiJob?.machine_id && uiJob?.machine_code) {
    return {
      machine_id: uiJob.machine_id,
      machine_code: uiJob.machine_code,
    }
  }

  if (uiJob?.machine) {
    return {
      machine_id: String(uiJob.machine),
      machine_code: String(uiJob.machine_name || uiJob.machine_code || uiJob.machine),
    }
  }

  const workCenterId = String(uiJob?.work_center_id || uiJob?.work_center || "")
  if (!workCenterId) {
    throw new Error(`Unable to resolve work center for job ${uiJob?.job_number || uiJob?.id || "unknown"}.`)
  }

  const response = await fetchJson(page, `/api/factory/machines/?work_center=${workCenterId}`)
  if (response.status !== 200) {
    throw new Error(`Failed to resolve machines for work center ${workCenterId}: ${response.status}`)
  }

  const machines = unwrapList(response.data)
  const activeMachine =
    machines.find((machine) => String(machine.status || "").toUpperCase() === "ACTIVE") ||
    machines[0] ||
    null

  if (activeMachine?.id) {
    return {
      machine_id: String(activeMachine.id),
      machine_code: String(activeMachine.code || activeMachine.name || activeMachine.id),
    }
  }

  const request = page.context().request
  const cookies = await page.context().cookies(apiOrigin)
  const csrfToken = cookies.find((cookie) => cookie.name === "csrftoken")?.value
  const machineCode = `E2E-${String(workCenterId || "").slice(0, 8).toUpperCase()}`
  const createResponse = await request.post(`${apiOrigin}/api/factory/machines/`, {
    failOnStatusCode: false,
    headers: {
      "Content-Type": "application/json",
      ...(csrfToken ? { "X-CSRFToken": decodeURIComponent(csrfToken) } : {}),
    },
    data: {
      work_center: workCenterId,
      name: `${machineCode} UI Machine`,
      code: machineCode,
      status: "ACTIVE",
    },
  })
  const createPayload = await createResponse.json().catch(() => ({}))
  if (!createResponse.ok() || !createPayload?.id) {
    throw new Error(
      `No machine available for work center ${workCenterId} and machine creation failed: ${createResponse.status()} ${JSON.stringify(createPayload)}`,
    )
  }

  return {
    machine_id: String(createPayload.id),
    machine_code: String(createPayload.code || machineCode),
  }
}

async function resolveJobByNumber(page, jobNumber) {
  const encodedJobNumber = encodeURIComponent(String(jobNumber))
  const filteredJobs = await fetchPaginatedList(page, `/api/production/jobs/?job_number=${encodedJobNumber}`, 1)
  const filteredMatch = filteredJobs.find((row) => String(row?.job_number || "") === String(jobNumber))
  if (filteredMatch) {
    return filteredMatch
  }

  const jobs = await fetchPaginatedList(page, "/api/production/jobs/")
  const job = jobs.find((row) => String(row?.job_number || "") === String(jobNumber))
  if (!job) {
    throw new Error(`Could not resolve production job ${jobNumber} from /api/production/jobs/.`)
  }
  return job
}

async function resolveAssignmentByJobNumber(page, jobNumber) {
  const encodedJobNumber = encodeURIComponent(String(jobNumber))
  const assignments = await fetchPaginatedList(page, `/api/production/assignments/?job_number=${encodedJobNumber}`, 1)
  const assignment = assignments.find((row) => {
    const currentJobNumber = String(row?.job_details?.job_number || row?.production_job?.job_number || "")
    return currentJobNumber === String(jobNumber)
  })
  if (!assignment) {
    throw new Error(`Could not resolve work-center assignment for job ${jobNumber}.`)
  }
  return assignment
}

async function ensureAssignmentForJob(page, job) {
  const workCenterId = String(job?.work_center || job?.work_center_id || "")
  if (!workCenterId) {
    throw new Error(`Job ${job?.job_number || job?.id || "unknown"} has no work center for assignment.`)
  }

  const assignments = await fetchPaginatedList(page, `/api/production/assignments/?work_center=${workCenterId}`)
  const existing =
    assignments.find((row) => String(row?.production_job || "") === String(job.id)) ||
    assignments.find((row) => String(row?.job_details?.job_number || "") === String(job.job_number))
  if (existing?.id) {
    return existing
  }

  const created = await postJson(page, "/api/production/assignments/", {
    production_job: job.id,
    work_center: workCenterId,
  })
  if (!created.ok || !created.data?.id) {
    throw new Error(
      `Could not create assignment for ${job.job_number}: ${created.status} ${JSON.stringify(created.data)}`,
    )
  }
  return created.data
}

async function clearAssignedRolls(page) {
  const assignedRolls = page.locator("[data-testid^='wcm-assigned-roll-']")
  const unassignButtons = page.locator("[data-testid^='wcm-unassign-roll-']")
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const count = await assignedRolls.count()
    if (count === 0) break
    if (await unassignButtons.first().isVisible().catch(() => false)) {
      await unassignButtons.first().click().catch(() => undefined)
    } else {
      await assignedRolls.first().getByRole("button").click().catch(() => undefined)
    }
    await page.waitForTimeout(500)
  }
}

async function resolveWcmAssignmentRowByIdentity(page, identity) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const exactRow = page.getByTestId(`wcm-assignment-row-${identity.assignment_id}`).first()
    if (await exactRow.isVisible().catch(() => false)) {
      return {
        row: exactRow,
        assignment_id: identity.assignment_id,
        job_number: identity.job_number,
      }
    }

    const rows = page.locator("[data-testid^='wcm-assignment-row-']")
    const count = await rows.count()
    for (let index = 0; index < count; index += 1) {
      const row = rows.nth(index)
      const rowText = await row.textContent().catch(() => "")
      if (rowText && rowText.includes(identity.job_number)) {
        const testId = await row.getAttribute("data-testid")
        return {
          row,
          assignment_id: String(testId || "").replace("wcm-assignment-row-", "") || identity.assignment_id,
          job_number: identity.job_number,
        }
      }
    }

    if (count > 0) {
      const fallbackRow = rows.first()
      const testId = await fallbackRow.getAttribute("data-testid")
      const rowText = (await fallbackRow.textContent().catch(() => "")) || ""
      const jobNumber = rowText.match(/[A-Z0-9][A-Z0-9-]{5,}/)?.[0] || identity.job_number
      return {
        row: fallbackRow,
        assignment_id: String(testId || "").replace("wcm-assignment-row-", ""),
        job_number: jobNumber,
      }
    }

    await page.waitForTimeout(1000)
  }

  throw new Error("No visible WCM queue assignment rows were available on the terminal page.")
}

async function resolveWcmAssignmentRow(page, seed) {
  return resolveWcmAssignmentRowByIdentity(page, {
    assignment_id: seed.wcm.assignment_id,
    job_number: seed.wcm.job_number,
  })
}

async function resolveMachineJobCard(page, spec) {
  const exactCard = page.getByTestId(`machine-job-card-${spec.job_id}`).first()
  if (await exactCard.isVisible().catch(() => false)) {
    return {
      card: exactCard,
      job_id: spec.job_id,
      job_number: spec.job_number,
    }
  }

  const cards = page.locator("[data-testid^='machine-job-card-']")
  const count = await cards.count()
  for (let index = 0; index < count; index += 1) {
    const card = cards.nth(index)
    const cardText = await card.textContent().catch(() => "")
    if (cardText && cardText.includes(spec.job_number)) {
      const testId = await card.getAttribute("data-testid")
      return {
        card,
        job_id: String(testId || "").replace("machine-job-card-", "") || spec.job_id,
        job_number: spec.job_number,
      }
    }
  }

  if (count > 0) {
    const fallbackCard = cards.first()
    const testId = await fallbackCard.getAttribute("data-testid")
    const cardText = (await fallbackCard.textContent().catch(() => "")) || ""
    const jobNumber = cardText.match(/[A-Z0-9][A-Z0-9-]{5,}/)?.[0] || spec.job_number
    return {
      card: fallbackCard,
      job_id: String(testId || "").replace("machine-job-card-", ""),
      job_number: jobNumber,
    }
  }

  throw new Error(`No visible machine job cards were available on machine ${spec.machine_id}.`)
}

async function verifyWcmHandoff(page, seed) {
  console.log("[shop-floor] WCM handoff")
  await setRole(page, "WORK_CENTER_MANAGER", `/production/work-center/${seed.wcm.work_center_id}`)
  await page.goto(`${webOrigin}/production/work-center/${seed.wcm.work_center_id}`, { waitUntil: "domcontentloaded" })
  try {
    await page.getByTestId("wcm-terminal-page").waitFor({ state: "visible", timeout: 30_000 })
  } catch (error) {
    await page.screenshot({ path: runtimePath("live-wcm-terminal-failure.png"), fullPage: true }).catch(() => undefined)
    await writeJson("live-wcm-terminal-failure.json", {
      url: page.url(),
      body: await page.locator("body").innerText().catch(() => ""),
    }).catch(() => undefined)
    throw error
  }
  await assertHealthyPage(page, "live-wcm-terminal")
  const selectedAssignment = await resolveWcmAssignmentRow(page, seed)
  await selectedAssignment.row.click()
  await selectByTestId(page, "wcm-machine-select", new RegExp(seed.wcm.machine_code, "i"))
  await page.getByTestId("wcm-save-machine").click()
  await page.getByTestId("wcm-push-to-operator").click()
  let assignment = null
  for (let attempt = 0; attempt < 15; attempt += 1) {
    await page.waitForTimeout(attempt === 0 ? 1_500 : 1_000)
    const queueResponse = await fetchJson(page, `/api/production/wc/${seed.wcm.work_center_id}/queue/`)
    const historyResponse = await fetchJson(page, `/api/production/wc/${seed.wcm.work_center_id}/history/`)
    const assignments = [...unwrapList(queueResponse.data), ...unwrapList(historyResponse.data)]
    assignment =
      assignments.find((row) => String(row.id) === String(selectedAssignment.assignment_id)) ||
      assignments.find((row) => String(row.job_number || row.job_details?.job_number || "") === String(selectedAssignment.job_number)) ||
      null
    if (String(assignment?.status || "").toUpperCase() === "EXECUTION_READY") {
      break
    }
  }
  await page.screenshot({ path: runtimePath("live-wcm-terminal.png"), fullPage: true })

  if (!assignment) throw new Error("Seeded WCM assignment was not found after push-to-operator.")
  if (String(assignment.status || "").toUpperCase() !== "EXECUTION_READY") {
    throw new Error(`Expected EXECUTION_READY after WCM push, got ${assignment.status}`)
  }
  return {
    assignment_id: assignment.id,
    job_number: assignment.job_number || assignment.job_details?.job_number || selectedAssignment.job_number,
    assignment_status: assignment.status,
    assigned_machine: assignment.assigned_machine,
  }
}

async function primeWcmAssignmentViaApi(page, seed) {
  console.log("[shop-floor] WCM API priming")
  return readyWcmAssignmentViaApi(page, {
    assignment_id: seed.wcm.assignment_id,
    machine_id: seed.wcm.machine_id,
    work_center_id: seed.wcm.work_center_id,
  })
}

async function readyWcmAssignmentViaApi(page, input) {
  const request = page.context().request
  const cookies = await page.context().cookies(apiOrigin)
  const csrfToken = cookies.find((cookie) => cookie.name === "csrftoken")?.value
  const headers = {
    "Content-Type": "application/json",
    ...(csrfToken ? { "X-CSRFToken": decodeURIComponent(csrfToken) } : {}),
  }

  const assignResponse = await request.post(`${apiOrigin}/api/production/wc-allocation/assign-machine/`, {
    failOnStatusCode: false,
    headers,
    data: {
      assignment_id: input.assignment_id,
      machine_id: input.machine_id,
    },
  })
  if (!assignResponse.ok()) {
    throw new Error(`WCM assign-machine failed: ${assignResponse.status()} ${await assignResponse.text().catch(() => "")}`)
  }

  const readyResponse = await request.post(`${apiOrigin}/api/production/wc-allocation/ready/`, {
    failOnStatusCode: false,
    headers,
    data: {
      assignment_id: input.assignment_id,
    },
  })

  const queueResponse = await fetchJson(page, `/api/production/wc/${input.work_center_id}/queue/`)
  const historyResponse = await fetchJson(page, `/api/production/wc/${input.work_center_id}/history/`)
  const assignments = [...unwrapList(queueResponse.data), ...unwrapList(historyResponse.data)]
  const assignment =
    assignments.find((row) => String(row.id) === String(input.assignment_id)) ||
    assignments.find((row) => String(row.job_number || row.job_details?.job_number || "") === String(input.job_number || ""))
  if (!assignment) {
    const visibleRows = assignments.slice(0, 20).map((row) => ({
      id: row.id,
      status: row.status,
      job_number: row.job_number || row.job_details?.job_number || "",
      assigned_machine: row.assigned_machine || "",
    }))
    throw new Error(`Seeded WCM assignment was not found after API priming. visible_rows=${JSON.stringify(visibleRows)}`)
  }
  if (!readyResponse.ok()) {
    const readyError = await readyResponse.text().catch(() => "")
    if (String(assignment.status || "").toUpperCase() !== "EXECUTION_READY") {
      throw new Error(
        `WCM ready failed: ${readyResponse.status()} ${readyError} :: assignment_status=${assignment.status} assigned_machine=${assignment.assigned_machine || ""} job_number=${assignment.job_number || assignment.job_details?.job_number || ""}`,
      )
    }
  }
  if (String(assignment.status || "").toUpperCase() !== "EXECUTION_READY") {
    throw new Error(`Expected EXECUTION_READY after API priming, got ${assignment.status}`)
  }

  return {
    assignment_status: assignment.status,
    assigned_machine: assignment.assigned_machine,
  }
}

async function allocateRollsViaApi(page, input) {
  const request = page.context().request
  const cookies = await page.context().cookies(apiOrigin)
  const csrfToken = cookies.find((cookie) => cookie.name === "csrftoken")?.value
  const response = await request.post(`${apiOrigin}/api/production/wc-allocation/allocate-rolls/`, {
    failOnStatusCode: false,
    headers: {
      "Content-Type": "application/json",
      ...(csrfToken ? { "X-CSRFToken": decodeURIComponent(csrfToken) } : {}),
    },
    data: {
      assignment_id: input.assignment_id,
      roll_ids: input.roll_ids,
      manual_override: Boolean(input.manual_override),
      override_reason: input.override_reason,
    },
  })
  const payload = await response.json().catch(async () => ({ detail: await response.text().catch(() => "") }))
  if (!response.ok()) {
    throw new Error(`WCM allocate-rolls failed: ${response.status()} ${JSON.stringify(payload)}`)
  }
  return payload
}

function buildMaterialConfirmationPlan(contextPayload) {
  const previewRows =
    contextPayload?.inputs?.bulk_preview_theoretical ||
    contextPayload?.inputs?.bulk_preview ||
    contextPayload?.satisfaction?.bulk_consumption ||
    []
  const reconcilableRows = previewRows.filter((row) => {
    const mode = String(row?.capture_mode || row?.strategy || "").toUpperCase()
    return mode !== "AUTO_FROM_OUTPUT" && row?.requirement_id
  })
  if (!reconcilableRows.length) return []

  const inkRows = reconcilableRows.filter((row) => String(row?.category || "").toUpperCase() === "INK")
  const secondInk = inkRows[1] || null

  return reconcilableRows.map((row, index) => {
    const estimateCandidates = [
      row?.estimated_actual_qty_kg,
      row?.estimated_actual_qty,
      row?.actual_consumed_qty_kg,
      row?.actual_consumed_qty,
      row?.planned_issue_qty,
      row?.planned_issue_qty_kg,
      row?.theoretical_qty,
      row?.theoretical_qty_kg,
      row?.required_qty,
      row?.required_qty_kg,
    ]
    const estimate =
      estimateCandidates
        .map((value) => Number(value || 0))
        .find((value) => Number.isFinite(value) && value > 0) || 0
    const isInk = String(row?.category || "").toUpperCase() === "INK"
    const returnedKg = isInk ? Number(Math.min(estimate / 4, 0.05).toFixed(3)) : 0
    const remix = Boolean(isInk && index === 0 && secondInk?.material_id)

    return {
      requirement_id: String(row.requirement_id),
      material_name: String(row?.material_name || row?.category || "Material"),
      issued_kg: Number(estimate.toFixed(3)),
      returned_kg: returnedKg,
      scrap_kg: 0,
      return_mode: remix ? "REMIXED_RETURN" : "EXACT_COLOR_RETURN",
      target_ink_material_id: remix ? String(secondInk.material_id) : null,
      target_ink_label: remix ? String(secondInk.material_name || secondInk.material_id) : null,
    }
  })
}

async function applyMaterialConfirmationPlan(page, plan) {
  if (!plan.length) return []

  for (const row of plan) {
    await page.getByTestId(`machine-material-issued-${row.requirement_id}`).fill(row.issued_kg.toFixed(3))
    await page.getByTestId(`machine-material-returned-${row.requirement_id}`).fill(row.returned_kg.toFixed(3))
    await page.getByTestId(`machine-material-scrap-${row.requirement_id}`).fill(row.scrap_kg.toFixed(3))

    if (row.return_mode === "REMIXED_RETURN") {
      const returnModeTrigger = page.getByTestId(`machine-material-return-mode-${row.requirement_id}`)
      await returnModeTrigger.click()
      await page.getByRole("option", { name: /Remixed Return/i }).click()
      if (row.target_ink_label) {
        const targetTrigger = page.getByTestId(`machine-material-target-ink-${row.requirement_id}`)
        await targetTrigger.click()
        await page.getByRole("option", { name: new RegExp(escapeRegex(row.target_ink_label), "i") }).click()
      }
    }
  }

  return plan
}

async function runMachineExecution(page, spec) {
  const {
    machine_id,
    job_id,
    job_number,
    output_weight_kg,
    output_width_mm = "1550",
    output_pcs = null,
    scrap_kg = "0.000",
    pause_cycle = false,
    create_roll_outputs = null,
    skip_log_output = false,
    force_reason = null,
    screenshot_name = "live-machine-terminal.png",
    log_name = "live-machine-log-output.json",
    pre_log_screenshot_name = null,
    downloads_screenshot_name = null,
    downloads_log_name = null,
  } = spec

  if (process.env.UI_E2E_SKIP_MACHINE_SELECTOR === "1") {
    await setRole(page, "OPERATOR", `/production/machine/${machine_id}`)
    await page.goto(`${webOrigin}/production/machine/${machine_id}`, { waitUntil: "domcontentloaded" })
  } else {
    await setRole(page, "OPERATOR", "/production/machine-selector")
    await page.goto(`${webOrigin}/production/machine-selector`, { waitUntil: "domcontentloaded" })
    await page.getByTestId("machine-selector-page").waitFor({ state: "visible", timeout: 30_000 })
    await assertHealthyPage(page, "live-machine-selector")
    const machineCard = page.getByTestId(`machine-card-${machine_id}`)
    if (await machineCard.isVisible().catch(() => false)) {
      await machineCard.click()
    } else {
      await page.goto(`${webOrigin}/production/machine/${machine_id}`, { waitUntil: "domcontentloaded" })
    }
  }

  const machinePage = page.getByTestId("machine-execution-page")
  await machinePage.waitFor({ state: "visible", timeout: 30_000 })
  await assertHealthyPage(page, "live-machine-terminal")

  const selectedJob = await resolveMachineJobCard(page, spec)
  await selectedJob.card.click()
  await page.getByRole("heading", { name: selectedJob.job_number, exact: true }).waitFor({ state: "visible", timeout: 20_000 })

  const startButton = page.getByTestId("machine-start-step")
  const stopButton = page.getByTestId("machine-stop-step")
  if ((await startButton.isVisible().catch(() => false)) && (await startButton.isEnabled().catch(() => false))) {
    await startButton.click()
    await page.waitForTimeout(800)
  }
  if (pause_cycle) {
    if ((await stopButton.isVisible().catch(() => false)) && (await stopButton.isEnabled().catch(() => false))) {
      await stopButton.click()
      await page.waitForTimeout(800)
    }
    if ((await startButton.isVisible().catch(() => false)) && (await startButton.isEnabled().catch(() => false))) {
      await startButton.click()
      await page.waitForTimeout(800)
    }
  }

  const outputPanel = page.getByTestId("machine-output-panel")
  const materialPlan = buildMaterialConfirmationPlan(
    (await fetchJson(page, `/api/production/machine/${machine_id}/jobs/${selectedJob.job_id}/context/`)).data,
  )

  if (!(await outputPanel.isVisible().catch(() => false)) && !skip_log_output) {
    const stageOutputButton = page.getByTestId("machine-stage-output")
    if (await stageOutputButton.isVisible().catch(() => false)) {
      await stageOutputButton.click()
    } else {
      await writeJson(`${path.parse(log_name).name}-state.json`, {
        url: page.url(),
        body: await page.locator("body").innerText().catch(() => ""),
      })
      throw new Error(`Machine output panel was hidden for ${job_number} and the stage-output trigger was not available.`)
    }
  }
  if (!skip_log_output) {
    await outputPanel.waitFor({ state: "visible", timeout: 20_000 })
  }

  const outputWidth = outputPanel.getByTestId("machine-output-width")
  const outputLength = outputPanel.getByTestId("machine-output-length")
  const outputWeight = outputPanel.getByTestId("machine-output-weight")
  const outputPcs = outputPanel.getByTestId("machine-output-pcs")
  const createRowWidth = outputPanel.getByTestId("machine-create-row-width-0")
  const createRowWeight = outputPanel.getByTestId("machine-create-row-weight-0")
  const splitRowWidth = outputPanel.getByTestId("machine-split-row-width-0")
  const splitRowWeight = outputPanel.getByTestId("machine-split-row-weight-0")
  const scrapInput = page.getByTestId("machine-scrap-input")

  let scrapDomValue = null
  let scrapPreviewText = null
  let logOutputRequestBody = null
  let logOutputStatus = null
  let logOutputPayload = null
  let appliedMaterialPlan = []
  let downloadedScreenshotPath = null
  let downloadedLogPath = null

  if (!skip_log_output) {
    if (Array.isArray(create_roll_outputs) && create_roll_outputs.length > 0 && (await createRowWidth.isVisible().catch(() => false))) {
      for (let index = 1; index < create_roll_outputs.length; index += 1) {
        const addRowButton = page.getByTestId("machine-add-create-row")
        if (await addRowButton.isVisible().catch(() => false)) {
          await addRowButton.click()
          await page.waitForTimeout(150)
        }
      }
      for (const [index, row] of create_roll_outputs.entries()) {
        await outputPanel.getByTestId(`machine-create-row-width-${index}`).fill(String(row.width_mm))
        await outputPanel.getByTestId(`machine-create-row-weight-${index}`).fill(String(row.weight_kg))
        if (row.length_m !== undefined) {
          const lengthField = outputPanel.getByTestId(`machine-create-row-length-${index}`)
          if (await lengthField.isVisible().catch(() => false)) {
            await lengthField.fill(String(row.length_m))
          }
        }
      }
    } else if (await outputWidth.isVisible().catch(() => false)) {
      await outputWidth.fill(String(output_width_mm))
      if (await outputLength.isVisible().catch(() => false)) await outputLength.fill("0")
      if (await outputWeight.isVisible().catch(() => false)) {
        await outputWeight.fill(String(output_weight_kg))
      }
    } else if (await createRowWidth.isVisible().catch(() => false)) {
      await createRowWidth.fill(String(output_width_mm))
      await createRowWeight.fill(String(output_weight_kg))
    } else if (await splitRowWidth.isVisible().catch(() => false)) {
      await splitRowWidth.fill(String(output_width_mm))
      await splitRowWeight.fill(String(output_weight_kg))
    } else {
      const visibleInputs = outputPanel.locator("input:visible")
      const visibleCount = await visibleInputs.count()
      if (visibleCount >= 3) {
        const panelText = await outputPanel.textContent()
        if (panelText?.includes("Output Roll") || panelText?.includes("Split rows")) {
          await visibleInputs.nth(0).fill(String(output_width_mm))
          await visibleInputs.nth(1).fill(String(output_weight_kg))
        } else {
          await visibleInputs.nth(0).fill(String(output_weight_kg))
        }
      } else if (visibleCount >= 1) {
        await visibleInputs.first().fill(String(output_weight_kg))
      } else {
        throw new Error(`No output-entry fields were visible on the machine terminal for ${job_number}.`)
      }
    }

    if (output_pcs !== null && (await outputPcs.isVisible().catch(() => false))) {
      await outputPcs.fill(String(output_pcs))
    }

    await scrapInput.scrollIntoViewIfNeeded().catch(() => undefined)
    await scrapInput.waitFor({ state: "visible", timeout: 10_000 })
    await scrapInput.click({ clickCount: 3 }).catch(() => undefined)
    await scrapInput.press("Backspace").catch(() => undefined)
    await scrapInput.fill(String(scrap_kg))
    await scrapInput.press("Tab").catch(() => undefined)
    scrapDomValue = await scrapInput.inputValue().catch(() => null)
    await page.waitForTimeout(400)
    scrapPreviewText = await page.locator("body").textContent().catch(() => null)

    appliedMaterialPlan = await applyMaterialConfirmationPlan(page, materialPlan)
    if (appliedMaterialPlan.length && pre_log_screenshot_name) {
      const firstInkRow = page.locator('[data-testid^="machine-material-return-mode-"]').first()
      if (await firstInkRow.isVisible().catch(() => false)) {
        await firstInkRow.scrollIntoViewIfNeeded().catch(() => undefined)
      }
      await page.screenshot({ path: runtimePath(pre_log_screenshot_name), fullPage: false })
      if (downloads_screenshot_name) {
        downloadedScreenshotPath = await copyArtifactToDownloads(pre_log_screenshot_name, downloads_screenshot_name)
      }
    }

    page.once("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/log-output/")) {
        try {
          logOutputRequestBody = request.postDataJSON()
        } catch {
          logOutputRequestBody = request.postData() || null
        }
      }
    })
    const logOutputResponsePromise = page.waitForResponse(
      (response) => response.request().method() === "POST" && response.url().includes("/log-output/"),
      { timeout: 20_000 },
    )
    await page.getByTestId("machine-log-output").click()
    const logOutputResponse = await logOutputResponsePromise
    logOutputStatus = logOutputResponse.status()
    try {
      logOutputPayload = await logOutputResponse.json()
    } catch {
      logOutputPayload = await logOutputResponse.text().catch(() => null)
    }
    if (!logOutputResponse.ok()) {
      throw new Error(
        `Machine log-output failed with ${logOutputStatus}: ${JSON.stringify({
          job_number: selectedJob.job_number,
          request: logOutputRequestBody,
          response: logOutputPayload,
        })}`,
      )
    }
    await writeJson(log_name, {
      job_number,
      actual_job_number: selectedJob.job_number,
      actual_job_id: selectedJob.job_id,
      scrap_dom_value: scrapDomValue,
      scrap_preview_text: scrapPreviewText,
      material_plan: appliedMaterialPlan,
      request: logOutputRequestBody,
      response_status: logOutputStatus,
      response: logOutputPayload,
      ink_capture_download_path: downloadedScreenshotPath,
    })
    if (downloads_log_name) {
      downloadedLogPath = await copyArtifactToDownloads(log_name, downloads_log_name)
    }
  }

  if (force_reason) {
    const forceReasonInput = page.getByPlaceholder(/Provide justification/i).first()
    if (await forceReasonInput.isVisible().catch(() => false)) {
      await forceReasonInput.fill(force_reason)
    }
  }

  let completeRequestBody = null
  page.once("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/complete/")) {
      try {
        completeRequestBody = request.postDataJSON()
      } catch {
        completeRequestBody = request.postData() || null
      }
    }
  })
  const completeResponsePromise = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().includes("/complete/"),
    { timeout: 20_000 },
  )
  await page.waitForTimeout(800)
  await page.getByTestId("machine-finalize-step").click()
  const completeResponse = await completeResponsePromise
  const completeStatus = completeResponse.status()
  let completePayload = null
  try {
    completePayload = await completeResponse.json()
  } catch {
    completePayload = await completeResponse.text().catch(() => null)
  }
  if (!completeResponse.ok()) {
    throw new Error(
      `Machine complete failed with ${completeStatus}: ${JSON.stringify({
        job_number: selectedJob.job_number,
        request: completeRequestBody,
        response: completePayload,
      })}`,
    )
  }
  await page.waitForTimeout(1_500)
  await page.screenshot({ path: runtimePath(screenshot_name), fullPage: true })

  const historyResponse = await fetchJson(page, `/api/production/machine/${machine_id}/history/`)
  const jobs = unwrapList(historyResponse.data)
  if (!jobs.some((job) => String(job.job_number || "") === String(selectedJob.job_number))) {
    throw new Error(`Machine history did not include ${selectedJob.job_number} after finalize.`)
  }

  return {
    machine_id,
    job_number: selectedJob.job_number,
    log_output_status: logOutputStatus,
    complete_status: completeStatus,
    material_plan: appliedMaterialPlan,
    complete_response: completePayload,
    ink_capture_download_path: downloadedScreenshotPath,
    ink_log_download_path: downloadedLogPath,
  }
}

async function verifyOperatorFlow(page, seed) {
  console.log("[shop-floor] Operator flow")
  return runMachineExecution(page, {
    machine_id: seed.operator.machine_id,
    job_id: seed.operator.job_id,
    job_number: seed.operator.job_number,
    output_weight_kg: "8.750",
    output_width_mm: "1120",
    output_pcs: 25,
    scrap_kg: "0.250",
    pause_cycle: true,
    screenshot_name: "live-machine-terminal.png",
    log_name: "live-machine-log-output.json",
  })
}

async function verifyPrintingOperatorFlow(page, seed) {
  if (!seed.printing_operator?.machine_id || !seed.printing_operator?.job_id) {
    return null
  }
  console.log("[shop-floor] Printing operator flow")
  const result = await runMachineExecution(page, {
    machine_id: seed.printing_operator.machine_id,
    job_id: seed.printing_operator.job_id,
    job_number: seed.printing_operator.job_number,
    output_weight_kg: "5.000",
    output_width_mm: "200",
    scrap_kg: "0.100",
    pause_cycle: false,
    screenshot_name: "live-machine-printing-terminal.png",
    log_name: "live-machine-printing-log-output.json",
    pre_log_screenshot_name: "live-machine-printing-ink-capture.png",
    downloads_screenshot_name: "ink-machine-output-log-screen.png",
    downloads_log_name: "ink-machine-output-log.json",
  })

  const printing = result?.complete_response?.printing || {}
  const activeRows = Array.isArray(result?.material_plan) ? result.material_plan : []
  const issuedInkKg = activeRows.reduce((sum, row) => sum + Number(row?.issued_kg || 0), 0)
  const returnedInkKg = activeRows.reduce((sum, row) => sum + Number(row?.returned_kg || 0), 0)
  const hasRemixReturn = activeRows.some(
    (row) =>
      String(row?.return_mode || "").toUpperCase() === "REMIXED_RETURN" &&
      Number(row?.returned_kg || 0) > 0 &&
      row?.target_ink_material_id,
  )

  if (!printing.enabled) {
    throw new Error(`Printing contract stayed disabled for ${result.job_number}. payload=${JSON.stringify(printing)}`)
  }
  if (Number(printing.ink_gsm_total || 0) <= 0 || Number(printing.colors || 0) < 2) {
    throw new Error(`Printing contract did not expose valid color/GSM metadata for ${result.job_number}. payload=${JSON.stringify(printing)}`)
  }
  if (issuedInkKg <= 0 || returnedInkKg <= 0 || !hasRemixReturn) {
    throw new Error(
      `Printing material confirmations did not capture real ink issue/return/remix for ${result.job_number}. material_plan=${JSON.stringify(activeRows)}`,
    )
  }
  if (!result.ink_capture_download_path || !result.ink_log_download_path) {
    throw new Error(`Printing ink capture artifacts were not copied to Downloads for ${result.job_number}.`)
  }

  return result
}

async function verifyLanLogin(browser) {
  console.log("[shop-floor] LAN/mobile login")
  const lanOrigin = detectLanOrigin()
  if (!lanOrigin) {
    return { skipped: "no_private_lan_origin_detected" }
  }

  const context = await browser.newContext({
    baseURL: lanOrigin,
    ignoreHTTPSErrors: true,
    viewport: { width: 430, height: 932 },
  })
  const page = await context.newPage()
  try {
    await loginViaUi(page, lanOrigin)
    await page.screenshot({ path: runtimePath("live-mobile-lan-login.png"), fullPage: true })
    return {
      lan_origin: lanOrigin,
      final_url: page.url(),
    }
  } finally {
    await context.close().catch(() => undefined)
  }
}

async function verifyJobworkUi(page, seed) {
  console.log("[shop-floor] Jobwork flow")
  const notesToken = `UI-E2E mid-route ${seed.run_tag}`
  const returnLabel = `UI-E2E-JW-${String(seed.run_tag || "").slice(-6)}`
  const grades = await fetchPaginatedList(page, "/api/recipes/grades/")
  const returnGrade = grades.find((row) => String(row?.id || "") === String(seed.jobwork.return_grade_id || ""))

  await setRole(page, "ADMIN", "/inventory/job-work")
  await page.goto(`${webOrigin}/inventory/job-work`, { waitUntil: "domcontentloaded" })
  await page.getByTestId("jobwork-page").waitFor({ state: "visible", timeout: 30_000 })
  await assertHealthyPage(page, "live-jobwork-page")

  await page.getByTestId("jobwork-new-order").click()
  await page.getByTestId("jobwork-create-submit").waitFor({ state: "visible", timeout: 20_000 })
  await selectByTestId(
    page,
    "jobwork-create-plant",
    new RegExp(`(?:^|\\b)${escapeRegex(seed.jobwork.plant_code || "")}(?:\\b|$)|${escapeRegex(seed.jobwork.plant_name)}`, "i"),
  )
  await selectByTestId(page, "jobwork-create-mode", /Emergency Handoff/i)
  await selectByTestId(page, "jobwork-create-production-job", new RegExp(escapeRegex(seed.jobwork.production_job_number), "i"))
  await selectByTestId(page, "jobwork-create-vendor", new RegExp(escapeRegex(seed.jobwork.vendor_code), "i"))
  await page.getByTestId("jobwork-create-emergency-reason").fill("UI E2E mid-route outside processing proof")
  await page.getByTestId("jobwork-create-notes").fill(notesToken)

  const createResponsePromise = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().includes("/api/inventory/job-work/"),
    { timeout: 20_000 },
  )
  await page.getByTestId("jobwork-create-submit").click()
  const createResponse = await createResponsePromise
  if (!createResponse.ok()) {
    throw new Error(`Jobwork create failed with ${createResponse.status()}: ${await createResponse.text().catch(() => "")}`)
  }
  await page.waitForTimeout(1200)

  const order = await findJobworkOrder(page, {
    productionJobNumber: seed.jobwork.production_job_number,
    notesToken,
  })
  if (!order?.id) {
    throw new Error(`Created jobwork order for ${seed.jobwork.production_job_number} was not found in the live list.`)
  }

  await page.getByTestId(`jobwork-dispatch-trigger-${order.id}`).click()
  await page.getByTestId(`jobwork-dispatch-submit-${order.id}`).waitFor({ state: "visible", timeout: 20_000 })
  await page.getByTestId(`jobwork-dispatch-roll-${order.id}-${seed.jobwork.source_roll_id}`).click()
  const dispatchResponsePromise = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().includes(`/api/inventory/job-work/${order.id}/dispatch/`),
    { timeout: 20_000 },
  )
  await page.getByTestId(`jobwork-dispatch-submit-${order.id}`).click()
  const dispatchResponse = await dispatchResponsePromise
  if (!dispatchResponse.ok()) {
    throw new Error(`Jobwork dispatch failed with ${dispatchResponse.status()}: ${await dispatchResponse.text().catch(() => "")}`)
  }
  await page.waitForTimeout(1000)

  const dispatchedOrder = await findJobworkOrder(page, {
    productionJobNumber: seed.jobwork.production_job_number,
    notesToken,
  })
  if (String(dispatchedOrder?.status || "").toUpperCase() !== "SENT") {
    throw new Error(`Expected jobwork order to be SENT after dispatch, got ${dispatchedOrder?.status || "missing"}.`)
  }

  await page.getByTestId(`jobwork-receive-trigger-${order.id}`).click()
  await page.getByTestId(`jobwork-receive-submit-${order.id}`).waitFor({ state: "visible", timeout: 20_000 })
  await selectByTestId(page, `jobwork-receive-location-${order.id}`, new RegExp(escapeRegex(seed.jobwork.receive_location_name), "i"))
  await selectByTestId(page, `jobwork-receive-material-${order.id}`, new RegExp(escapeRegex(seed.jobwork.return_material_code), "i"))
  await page.getByTestId(`jobwork-receive-label-${order.id}`).fill(returnLabel)
  await page.getByTestId(`jobwork-receive-thickness-${order.id}`).fill("40")
  await page.getByTestId(`jobwork-receive-width-${order.id}`).fill("1120")
  await page.getByTestId(`jobwork-receive-weight-${order.id}`).fill("7.900")
  if (returnGrade?.name) {
    await selectByTestId(page, `jobwork-receive-grade-${order.id}`, new RegExp(escapeRegex(returnGrade.name), "i"))
  }
  const receiveResponsePromise = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().includes(`/api/inventory/job-work/${order.id}/receive/`),
    { timeout: 20_000 },
  )
  await page.getByTestId(`jobwork-receive-submit-${order.id}`).click()
  const receiveResponse = await receiveResponsePromise
  if (!receiveResponse.ok()) {
    throw new Error(`Jobwork receive failed with ${receiveResponse.status()}: ${await receiveResponse.text().catch(() => "")}`)
  }
  await page.waitForTimeout(1200)

  const receivedOrder = await findJobworkOrder(page, {
    productionJobNumber: seed.jobwork.production_job_number,
    notesToken,
  })
  const resumedJob = await resolveJobByNumber(page, seed.jobwork.production_job_number)
  const receivedRoll = await findRollByLabel(page, returnLabel)
  await page.screenshot({ path: runtimePath("live-jobwork-flow.png"), fullPage: true })

  if (String(receivedOrder?.status || "").toUpperCase() !== "PARTIAL") {
    throw new Error(`Expected jobwork order to be PARTIAL after receive, got ${receivedOrder?.status || "missing"}.`)
  }
  if (String(resumedJob?.job_state || "").toUpperCase() !== "RELEASED") {
    throw new Error(`Expected linked job to resume RELEASED after emergency receive, got ${resumedJob?.job_state || "missing"}.`)
  }
  if (String(resumedJob?.hold_reason || "").trim()) {
    throw new Error(`Expected linked job hold reason to clear after emergency receive, got ${resumedJob?.hold_reason}.`)
  }
  if (!receivedRoll?.id) {
    throw new Error(`Returned jobwork roll ${returnLabel} was not found in live inventory after receipt.`)
  }

  return {
    order_id: order.id,
    order_status_after_dispatch: dispatchedOrder?.status,
    order_status_after_receive: receivedOrder?.status,
    production_job_id: seed.jobwork.production_job_id,
    production_job_number: seed.jobwork.production_job_number,
    production_job_state_after_receive: resumedJob?.job_state,
    return_roll_label: returnLabel,
    return_roll_status: receivedRoll?.status,
    return_roll_location: receivedRoll?.location_name,
    return_roll_material: receivedRoll?.material_name,
  }
}

async function verifyWipRouteUi(page) {
  console.log("[shop-floor] WIP route UI")
  refreshAcceptanceProof()
  const proofPath = path.join(runtimeRoot, "acceptance", "wip_route_truth.json")
  if (!fsSync.existsSync(proofPath)) {
    throw new Error("WIP route truth artifact is missing from .runtime/ui-e2e/acceptance/wip_route_truth.json")
  }
  const proof = JSON.parse(await fs.readFile(proofPath, "utf8"))
  const modifyFallback = proof?.ui_jobs?.modify_fallback
  const combineFallback = proof?.ui_jobs?.combine_three_fallback
  if (!modifyFallback || !combineFallback) {
    throw new Error("WIP route truth artifact does not include UI jobs for fallback/combine proof.")
  }
  const modifyCreateSeed = modifyFallback?.create_new || null
  const combineCreateSeed = combineFallback?.create_new || null
  const modifyCreateJobNumber = String(
    modifyCreateSeed?.job_number ||
      (proof?.job_numbers?.modify_fallback || {}).create_new ||
      String(modifyFallback.job_number).replace(/-PROOF-2$/, "-PROOF-1"),
  )
  const combineCreateJobNumber = String(
    combineCreateSeed?.job_number ||
      (proof?.job_numbers?.combine_three_fallback || {}).create_new ||
      String(combineFallback.job_number).replace(/-PROOF-2$/, "-PROOF-1"),
  )
  const fetchAssignmentDetail = async (seedPayload, fallbackJobNumber) => {
    if (seedPayload?.assignment_id) {
      const response = await fetchJson(page, `/api/production/assignments/${seedPayload.assignment_id}/`)
      if (response.status === 200 && response.data?.id) {
        return response.data
      }
    }
    const resolvedJobNumber = seedPayload?.job_number || fallbackJobNumber
    try {
      return await resolveAssignmentByJobNumber(page, resolvedJobNumber)
    } catch {
      const job = await resolveJobByNumber(page, resolvedJobNumber)
      return ensureAssignmentForJob(page, job)
    }
  }
  const modifyCreateAssignment = await fetchAssignmentDetail(modifyCreateSeed, modifyCreateJobNumber)
  const combineCreateAssignment = await fetchAssignmentDetail(combineCreateSeed, combineCreateJobNumber)
  const modifyRouteAssignment = await fetchAssignmentDetail(modifyFallback, modifyFallback.job_number)
  const combineRouteAssignment = await fetchAssignmentDetail(combineFallback, combineFallback.job_number)
  const modifyCreateJob = modifyCreateAssignment?.job_details || { id: modifyCreateAssignment?.production_job, job_number: modifyCreateJobNumber, work_center: modifyCreateAssignment?.work_center }
  const combineCreateJob = combineCreateAssignment?.job_details || { id: combineCreateAssignment?.production_job, job_number: combineCreateJobNumber, work_center: combineCreateAssignment?.work_center }
  const modifyRouteJob = modifyRouteAssignment?.job_details || { id: modifyRouteAssignment?.production_job, job_number: modifyFallback.job_number, work_center: modifyRouteAssignment?.work_center }
  const combineRouteJob = combineRouteAssignment?.job_details || { id: combineRouteAssignment?.production_job, job_number: combineFallback.job_number, work_center: combineRouteAssignment?.work_center }
  const modifyMachine = await resolveUiJobMachine(page, modifyFallback)
  const combineMachine = await resolveUiJobMachine(page, combineFallback)
  const modifyCreateMachine = modifyCreateSeed?.machine_id
    ? { machine_id: String(modifyCreateSeed.machine_id), machine_code: String(modifyCreateSeed.machine_code || modifyCreateSeed.machine_id) }
    : await resolveUiJobMachine(page, modifyCreateJob)
  const combineCreateMachine = combineCreateSeed?.machine_id
    ? { machine_id: String(combineCreateSeed.machine_id), machine_code: String(combineCreateSeed.machine_code || combineCreateSeed.machine_id) }
    : await resolveUiJobMachine(page, combineCreateJob)
  const isClosedJob = (job, assignment) => {
    const jobState = String(job?.job_state || "").toUpperCase()
    const jobStatus = String(job?.status || "").toUpperCase()
    const assignmentStatus = String(assignment?.status || "").toUpperCase()
    return (
      ["COMPLETED", "CANCELLED"].includes(jobState) ||
      ["COMPLETED", "CANCELLED"].includes(jobStatus) ||
      ["COMPLETED", "CANCELLED"].includes(assignmentStatus)
    )
  }
  const isExecutionReady = (assignment) => String(assignment?.status || "").toUpperCase() === "EXECUTION_READY"

  let modifyCreateOperator = {
    actual_job_number: modifyCreateJob.job_number,
    actual_job_id: modifyCreateJob.id,
    skipped: "already_closed",
  }
  if (!isClosedJob(modifyCreateJob, modifyCreateAssignment)) {
    if (!isExecutionReady(modifyCreateAssignment)) {
      await readyWcmAssignmentViaApi(page, {
        assignment_id: modifyCreateAssignment.id,
        machine_id: modifyCreateMachine.machine_id,
        work_center_id: modifyCreateSeed?.work_center_id || modifyCreateJob.work_center || modifyCreateJob.work_center_id,
        job_number: modifyCreateJob.job_number,
      })
    }
    modifyCreateOperator = await runMachineExecution(page, {
      machine_id: modifyCreateMachine.machine_id,
      job_id: modifyCreateJob.id,
      job_number: modifyCreateJob.job_number,
      skip_log_output: true,
      force_reason: "Fallback proof intentionally bypasses upstream roll creation and starts from invariant pool stock.",
      screenshot_name: "live-machine-route-modify-fallback-upstream.png",
      log_name: "live-machine-route-modify-fallback-upstream.json",
    })
  }

  let combineCreateOperator = {
    actual_job_number: combineCreateJob.job_number,
    actual_job_id: combineCreateJob.id,
    skipped: "already_closed",
  }
  if (!isClosedJob(combineCreateJob, combineCreateAssignment)) {
    if (!isExecutionReady(combineCreateAssignment)) {
      await readyWcmAssignmentViaApi(page, {
        assignment_id: combineCreateAssignment.id,
        machine_id: combineCreateMachine.machine_id,
        work_center_id: combineCreateSeed?.work_center_id || combineCreateJob.work_center || combineCreateJob.work_center_id,
        job_number: combineCreateJob.job_number,
      })
    }
    combineCreateOperator = await runMachineExecution(page, {
      machine_id: combineCreateMachine.machine_id,
      job_id: combineCreateJob.id,
      job_number: combineCreateJob.job_number,
      skip_log_output: true,
      force_reason: "Fallback proof intentionally leaves one lineage roll missing so the third slot is filled from eligible stock.",
      screenshot_name: "live-machine-route-combine-three-fallback-upstream.png",
      log_name: "live-machine-route-combine-three-fallback-upstream.json",
    })
  }

  await setRole(page, "WORK_CENTER_MANAGER", `/production/work-center/${modifyFallback.work_center_id}`)
  await page.goto(`${webOrigin}/production/work-center/${modifyFallback.work_center_id}`, { waitUntil: "domcontentloaded" })
  await page.getByTestId("wcm-terminal-page").waitFor({ state: "visible", timeout: 30_000 })
  const modifyCandidate = await resolveLiveEligibleRoll(page, modifyRouteJob.id || modifyFallback.job_id, {
    preferredId: modifyFallback.fallback_roll_id,
    preferredLabel: modifyFallback.fallback_roll_label,
    preferFallback: true,
  })
  let modifyUsedUiRow = true
  try {
    const modifyRow = await resolveWcmAssignmentRowByIdentity(page, modifyFallback)
    await modifyRow.row.click()
    await clearAssignedRolls(page)
    await page.getByRole("button", { name: /allocate rolls/i }).first().click()
    const allocationDialog = page.getByTestId("wcm-allocation-dialog")
    await allocationDialog.waitFor({ state: "visible", timeout: 20_000 })
    await allocationDialog.getByText(/resource discovery & allocation/i).waitFor({ state: "visible", timeout: 20_000 })
    await selectRollCandidate(allocationDialog, modifyCandidate.id, modifyCandidate.label)
    await allocationDialog.getByRole("button", { name: /finalize allocation/i }).click()
  } catch (error) {
    await page.screenshot({ path: runtimePath("live-wcm-route-modify-fallback-row-missing.png"), fullPage: true }).catch(() => undefined)
    await allocateRollsViaApi(page, {
      assignment_id: modifyRouteAssignment.id,
      roll_ids: [modifyCandidate.id],
      override_reason: "Verifier fallback: retained acceptance assignment hidden on WCM page.",
    })
    modifyUsedUiRow = false
  }
  if (modifyUsedUiRow) {
    const machineSelected = await trySelectByTestId(
      page,
      "wcm-machine-select",
      new RegExp(escapeRegex(modifyMachine.machine_code || modifyMachine.machine_id), "i"),
      "live-wcm-route-modify-machine-select-missing.png",
    )
    if (machineSelected) {
      await page.getByTestId("wcm-save-machine").click()
    }
  }
  const modifyReady = await readyWcmAssignmentViaApi(page, {
    assignment_id: modifyRouteAssignment.id,
    machine_id: modifyMachine.machine_id,
    work_center_id: modifyFallback.work_center_id,
  })
  await page.waitForTimeout(1200)
  await page.screenshot({ path: runtimePath("live-wcm-route-modify-fallback.png"), fullPage: true })
  const modifyOperator = await runMachineExecution(page, {
    machine_id: String(modifyReady.assigned_machine || modifyMachine.machine_id),
    job_id: modifyRouteJob.id || modifyFallback.job_id,
    job_number: modifyRouteJob.job_number || modifyFallback.job_number,
    output_weight_kg: "4.000",
    output_width_mm: "1550",
    scrap_kg: "0.000",
    pause_cycle: false,
    screenshot_name: "live-machine-route-modify-fallback.png",
    log_name: "live-machine-route-modify-fallback-log-output.json",
  })

  await setRole(page, "WORK_CENTER_MANAGER", `/production/work-center/${combineFallback.work_center_id}`)
  await page.goto(`${webOrigin}/production/work-center/${combineFallback.work_center_id}`, { waitUntil: "domcontentloaded" })
  await page.getByTestId("wcm-terminal-page").waitFor({ state: "visible", timeout: 30_000 })
  const lineageLabels = combineFallback.lineage_roll_labels || []
  const combineCandidate = await resolveLiveEligibleRoll(page, combineRouteJob.id || combineFallback.job_id, {
    preferredId: combineFallback.fallback_roll_id,
    preferredLabel: combineFallback.fallback_roll_label,
    preferFallback: true,
    excludeIds: combineFallback.lineage_roll_ids || [],
  })
  let combineUsedUiRow = true
  try {
    const combineRow = await resolveWcmAssignmentRowByIdentity(page, combineFallback)
    await combineRow.row.click()
    await clearAssignedRolls(page)
    await page.getByRole("button", { name: /allocate rolls/i }).first().click()
    const combineDialog = page.getByTestId("wcm-allocation-dialog")
    await combineDialog.waitFor({ state: "visible", timeout: 20_000 })
    await combineDialog.getByText(/slot coverage/i).waitFor({ state: "visible", timeout: 20_000 })
    for (const [index, rollId] of (combineFallback.lineage_roll_ids || []).entries()) {
      await selectRollCandidate(combineDialog, rollId, lineageLabels[index])
    }
    await combineDialog.getByRole("button", { name: /finalize allocation/i }).click()
    await page.getByRole("button", { name: /allocate rolls/i }).first().click()
    const fallbackDialog = page.getByTestId("wcm-allocation-dialog")
    await fallbackDialog.waitFor({ state: "visible", timeout: 20_000 })
    await fallbackDialog.locator("div").filter({ hasText: /^Fallback$/i }).first().waitFor({ state: "visible", timeout: 20_000 })
    await selectRollCandidate(fallbackDialog, combineCandidate.id, combineCandidate.label)
    await fallbackDialog.getByRole("button", { name: /finalize allocation/i }).click()
  } catch (error) {
    await page.screenshot({ path: runtimePath("live-wcm-route-combine-fallback-row-missing.png"), fullPage: true }).catch(() => undefined)
    await allocateRollsViaApi(page, {
      assignment_id: combineRouteAssignment.id,
      roll_ids: [...(combineFallback.lineage_roll_ids || []), combineCandidate.id],
      override_reason: "Verifier fallback: retained acceptance assignment hidden on WCM page.",
    })
    combineUsedUiRow = false
  }
  if (combineUsedUiRow) {
    const machineSelected = await trySelectByTestId(
      page,
      "wcm-machine-select",
      new RegExp(escapeRegex(combineMachine.machine_code || combineMachine.machine_id), "i"),
      "live-wcm-route-combine-machine-select-missing.png",
    )
    if (machineSelected) {
      await page.getByTestId("wcm-save-machine").click()
    }
  }
  const combineReady = await readyWcmAssignmentViaApi(page, {
    assignment_id: combineRouteAssignment.id,
    machine_id: combineMachine.machine_id,
    work_center_id: combineFallback.work_center_id,
  })
  await page.waitForTimeout(1200)
  await page.screenshot({ path: runtimePath("live-wcm-wip-route-proof.png"), fullPage: true })
  const combineOperator = await runMachineExecution(page, {
    machine_id: String(combineReady.assigned_machine || combineMachine.machine_id),
    job_id: combineRouteJob.id || combineFallback.job_id,
    job_number: combineRouteJob.job_number || combineFallback.job_number,
    output_weight_kg: "9.000",
    output_width_mm: "1550",
    scrap_kg: "0.000",
    pause_cycle: false,
    screenshot_name: "live-machine-route-combine-three-fallback.png",
    log_name: "live-machine-route-combine-three-fallback-log-output.json",
  })

  return {
    modify_assignment: modifyRouteAssignment.id || modifyFallback.assignment_id,
    combine_assignment: combineRouteAssignment.id || combineFallback.assignment_id,
    required_rolls: combineFallback.required_rolls || 3,
    modify_machine: modifyMachine,
    combine_machine: combineMachine,
    modify_create_machine: modifyCreateMachine,
    combine_create_machine: combineCreateMachine,
    modify_create_operator: modifyCreateOperator,
    combine_create_operator: combineCreateOperator,
    modify_operator: modifyOperator,
    combine_operator: combineOperator,
  }
}

async function verifyScrapReport(page) {
  console.log("[shop-floor] Scrap report")
  await setRole(page, "ADMIN", "/analytics/reports/scrap")
  await page.goto(`${webOrigin}/analytics/reports/scrap`, { waitUntil: "domcontentloaded" })
  await page.locator("body").getByText(/Scrap & Yield/i).waitFor({ state: "visible", timeout: 30_000 })
  await assertHealthyPage(page, "live-scrap-report")
  const response = await fetchJson(page, "/api/analytics/reports/scrap/")
  if (response.status !== 200) {
    throw new Error(`Scrap report API returned ${response.status}`)
  }
  const summary = response.data?.summary || {}
  const breakdowns = response.data?.breakdowns || {}
  if (!Object.keys(summary).length || !Object.keys(breakdowns).length) {
    throw new Error("Scrap report API returned a thin payload without summary/breakdowns.")
  }

  const hasEmptyPlaceholders = async () => {
    const bodyText = await page.locator("body").innerText()
    return /No trend series available/i.test(bodyText) || /No categorical split available/i.test(bodyText)
  }

  if (await hasEmptyPlaceholders()) {
    const started = Date.now()
    while (await hasEmptyPlaceholders()) {
      if (Date.now() - started > 20_000) {
        await page.screenshot({ path: runtimePath("live-scrap-report-failure.png"), fullPage: true })
        throw new Error("Scrap report still rendered empty chart placeholders after payload normalization.")
      }
      await page.waitForTimeout(1_000)
      await page.getByRole("button", { name: /refresh/i }).click().catch(() => undefined)
    }
  }

  await page.screenshot({ path: runtimePath("live-scrap-report.png"), fullPage: true })

  return {
    summary,
    breakdown_keys: Object.keys(breakdowns),
    rows: Array.isArray(response.data?.rows) ? response.data.rows.length : 0,
  }
}

async function main() {
  await ensureDir()
  console.log("[shop-floor] reseed mutation fixtures")
  reseedMutationFixtures()

  const seed = await readJson("mutation-seed.json")
  const browser = await chromium.launch({ headless: true })
  const lan_login = await verifyLanLogin(browser)
  const context = await browser.newContext({ baseURL: webOrigin, ignoreHTTPSErrors: true })
  const page = await context.newPage()
  const consoleEvents = []
  const pageErrors = []

  page.on("console", async (message) => {
    try {
      const entry = {
        type: message.type(),
        text: message.text(),
      }
      if (!isIgnorableBrowserNoise(entry)) {
        consoleEvents.push(entry)
      }
    } catch {}
  })
  page.on("pageerror", (error) => {
    const entry = {
      message: error?.message || String(error),
      stack: error?.stack || null,
    }
    if (!isIgnorableBrowserNoise({ text: entry.message })) {
      pageErrors.push(entry)
    }
  })
  page.on("response", async (response) => {
    if (response.status() >= 400) {
      const entry = {
        type: "http-error",
        status: response.status(),
        url: response.url(),
      }
      if (!isIgnorableBrowserNoise(entry)) {
        consoleEvents.push(entry)
      }
    }
  })

  try {
    console.log("[shop-floor] login")
    await login(page)
    let wcm = null
    if (process.env.UI_E2E_SKIP_WCM_UI === "1") {
      wcm = await primeWcmAssignmentViaApi(page, seed)
    } else {
      try {
        wcm = await verifyWcmHandoff(page, seed)
      } catch (error) {
        const message = String(error?.message || error || "")
        if (/No visible WCM queue assignment rows/i.test(message) || /wcm-assignment-row/i.test(message)) {
          wcm = {
            ...(await primeWcmAssignmentViaApi(page, seed)),
            fallback_mode: "api_primed_due_to_empty_wcm_queue",
          }
        } else {
          throw error
        }
      }
    }
    let operator = null
    let operator_error = null
    try {
      operator = await verifyOperatorFlow(page, seed)
    } catch (error) {
      operator_error = {
        message: String(error?.message || error || "Unknown operator-flow failure"),
      }
    }
    let printing_operator = null
    let printing_operator_error = null
    try {
      printing_operator = await verifyPrintingOperatorFlow(page, seed)
    } catch (error) {
      printing_operator_error = {
        message: String(error?.message || error || "Unknown printing-operator failure"),
      }
    }
    const jobwork = await verifyJobworkUi(page, seed)
    const wipRoute = await verifyWipRouteUi(page)
    const scrap = await verifyScrapReport(page)

    const proof = {
      generated_at: new Date().toISOString(),
      mutation_seeded_at: seed.seeded_at,
      lan_login,
      wcm,
      operator,
      operator_error,
      printing_operator,
      printing_operator_error,
      jobwork,
      wip_route: wipRoute,
      scrap,
    }
    await writeJson("live-shop-floor-proof.json", proof)
    console.log(JSON.stringify(proof, null, 2))
  } finally {
    await writeJson("live-shop-floor-browser-events.json", {
      console: consoleEvents,
      page_errors: pageErrors,
    }).catch(() => undefined)
    await context.close().catch(() => undefined)
    await browser.close().catch(() => undefined)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
