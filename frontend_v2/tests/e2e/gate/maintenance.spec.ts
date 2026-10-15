import { expect, test } from "../support/base"
import { annotate, assertHealthyPage, fetchJson, gotoWithServerRetry } from "../support/test-helpers"

// Preventive maintenance loop on one machine: schedule -> due job -> operator
// record -> done; fault report; QR posters; machine and location scan cards.
test("maintenance loop: schedule, due job, record, fault, QR and scan cards", async ({ page }, testInfo) => {
  test.setTimeout(240_000)
  annotate(testInfo, {
    module: "Maintenance",
    severity: "high",
    role: "ADMIN",
    feature: "maintenance-loop",
    expected: "A schedule creates a due job; the record closes with an outcome; faults, QR posters and scan cards render for the signed-in admin.",
  })

  const machines = await fetchJson<any>(page, "/api/factory/machines/?page_size=5")
  expect(machines.status).toBe(200)
  const machineRows: any[] = Array.isArray(machines.data) ? machines.data : machines.data?.results || machines.data?.data || []
  expect(machineRows.length).toBeGreaterThan(0)
  const machine = machineRows[0]
  const tag = `E2E-${Date.now().toString().slice(-6)}`

  // 1. Schedule with the starter checklist, due today.
  await gotoWithServerRetry(page, "/maintenance/schedules", { waitUntil: "domcontentloaded", timeout: 60_000 })
  await assertHealthyPage(page, { requireAuth: false })
  await page.getByTestId("schedules-add").click()
  await page.getByTestId("schedule-machine").click()
  await page.getByRole("option", { name: new RegExp(machine.code) }).first().click()
  await page.getByTestId("schedule-name").fill(`Daily start-up check ${tag}`)
  await page.getByRole("button", { name: /use starter checks/i }).click()
  await page.getByTestId("schedule-save").click()
  await expect(page.locator("body")).toContainText(`Daily start-up check ${tag}`, { timeout: 30_000 })

  // 2. Due jobs are created from the schedule.
  await page.getByTestId("schedules-generate").click()
  await expect(page.locator("body")).toContainText(/Due jobs generated/i, { timeout: 30_000 })

  // 3. Record the check from the jobs list: start, mark every check OK, complete.
  await gotoWithServerRetry(page, "/maintenance/jobs", { waitUntil: "domcontentloaded", timeout: 60_000 })
  await page.getByTestId("maintenance-filter-open").click()
  const row = page.locator('[data-testid^="maintenance-job-row-"]', { hasText: `Daily start-up check ${tag}` }).first()
  await expect(row).toBeVisible({ timeout: 30_000 })
  await row.click()
  await page.getByTestId("maintenance-job-start").click()
  await expect(page.locator("body")).toContainText(/In progress/i, { timeout: 30_000 })
  for (const code of ["OIL", "NOISE", "LEAK", "GUARD"]) {
    await page.getByTestId(`check-ok-${code}`).click()
  }
  await page.getByTestId("maintenance-outcome-completed").click()
  await page.getByTestId("maintenance-job-submit").click()
  await expect(page.locator("body")).toContainText(/Recorded/i, { timeout: 30_000 })

  // 4. Board renders the five numbers.
  await gotoWithServerRetry(page, "/maintenance", { waitUntil: "domcontentloaded", timeout: 60_000 })
  await expect(page.getByTestId("maintenance-stat-due")).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId("maintenance-stat-overdue")).toBeVisible()
  await expect(page.getByTestId("maintenance-stat-faults")).toBeVisible()

  // 5. Report a fault on the machine (machine running: no pause).
  await page.getByTestId("maintenance-report-fault").click()
  await page.getByTestId("fault-machine").click()
  await page.getByRole("option", { name: new RegExp(machine.code) }).first().click()
  await page.getByTestId("fault-title").fill(`Knocking sound ${tag}`)
  await page.getByTestId("fault-submit").click()
  await expect(page.locator("body")).toContainText(/Fault reported/i, { timeout: 30_000 })
  await gotoWithServerRetry(page, "/maintenance/faults", { waitUntil: "domcontentloaded", timeout: 60_000 })
  await expect(page.locator("body")).toContainText(`Knocking sound ${tag}`, { timeout: 30_000 })

  // 6. QR posters render with the machine's own poster.
  await gotoWithServerRetry(page, `/maintenance/qr?machine=${machine.id}`, { waitUntil: "domcontentloaded", timeout: 60_000 })
  await expect(page.getByTestId(`qr-poster-${machine.code}`)).toBeVisible({ timeout: 30_000 })
  const svg = await fetchJson<any>(page, `/api/maintenance/qr/machine/${machine.id}.svg`)
  expect(svg.status).toBe(200)

  // 7. Machine scan card shows the fault just reported and the 30-day report.
  await gotoWithServerRetry(page, `/m/${machine.code}`, { waitUntil: "domcontentloaded", timeout: 60_000 })
  await expect(page.locator("body")).toContainText(machine.code, { timeout: 30_000 })
  await expect(page.locator("body")).toContainText(/Run hours/i)
  await expect(page.getByTestId("scan-faults")).toContainText(`Knocking sound ${tag}`)
  await expect(page.getByTestId("scan-report-fault")).toBeVisible()

  // 8. Location scan card shows what the system says is there.
  const locations = await fetchJson<any>(page, "/api/factory/locations/?page_size=50")
  expect(locations.status).toBe(200)
  const locationRows: any[] = Array.isArray(locations.data) ? locations.data : locations.data?.results || locations.data?.data || []
  const location = locationRows.find((row) => row.is_active !== false) || locationRows[0]
  expect(location).toBeTruthy()
  await gotoWithServerRetry(page, `/loc/${location.code}`, { waitUntil: "domcontentloaded", timeout: 60_000 })
  await expect(page.locator("body")).toContainText(location.code, { timeout: 30_000 })
  await expect(page.getByTestId("loc-bulk")).toBeVisible()
  await expect(page.getByTestId("loc-rolls")).toBeVisible()
  await expect(page.getByTestId("loc-count-toggle")).toBeVisible()
})

test("header scan button opens the scanner for the signed-in account", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Maintenance",
    severity: "medium",
    role: "ADMIN",
    feature: "scan-button",
    expected: "The header scan control opens the QR scanner dialog on desktop and phone widths.",
  })
  await gotoWithServerRetry(page, "/dashboard/admin", { waitUntil: "domcontentloaded", timeout: 60_000 })
  await page.getByTestId("scan-trigger").click()
  await expect(page.getByRole("dialog")).toContainText(/Scan QR/i, { timeout: 15_000 })
  await page.keyboard.press("Escape")
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByTestId("scan-trigger-mobile").click()
  await expect(page.getByRole("dialog")).toContainText(/Scan QR/i, { timeout: 15_000 })
})
