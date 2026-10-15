import type { Locator, Page } from "@playwright/test"

import { test, expect } from "../support/base"
import { annotate, assertHealthyPage, fetchJson, selectByTestId, switchRole, unwrapApiList } from "../support/test-helpers"
import { readMutationSeed } from "../support/mutation-seed"

/** Choose the <option> of a native select whose text contains `text`. */
async function selectOptionContaining(select: Locator, text: string | RegExp) {
  const options = select.locator("option")
  const count = await options.count()
  for (let index = 0; index < count; index += 1) {
    const option = options.nth(index)
    const label = (await option.textContent()) || ""
    const matches = typeof text === "string" ? label.includes(text) : text.test(label)
    if (matches) {
      const value = await option.getAttribute("value")
      if (value) {
        await select.selectOption(value)
        return value
      }
    }
  }
  throw new Error(`No option containing ${String(text)}`)
}

async function waitForPost(page: Page, path: string) {
  return page.waitForResponse((response) => response.url().includes(path) && response.request().method() === "POST", { timeout: 60_000 })
}

test("store can create, dispatch, and receive a planned-step jobwork order", async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  annotate(testInfo, {
    module: "Jobwork",
    severity: "critical",
    role: "STORE",
    feature: "Jobwork outbound and return lifecycle",
    expected: "Store should be able to create a planned-step jobwork order, dispatch the seeded roll, and receive the processed roll back with technical specs and grade.",
  })

  const seed = readMutationSeed()
  const returnLabel = `UIE2E-JW-${Date.now()}`

  await page.goto("/dashboard/admin")
  await switchRole(page, "Store", "/inventory/rolls-v36")
  await page.goto("/inventory/job-work")
  await page.getByTestId("jobwork-page").waitFor({ state: "visible", timeout: 30_000 })
  await assertHealthyPage(page)

  // 1. Create: planned route step for the seeded job, seeded job worker.
  await page.getByTestId("jobwork-new-order").click()
  await selectByTestId(page, "jobwork-create-plant", new RegExp(seed.jobwork.plant_name, "i"))
  await page.getByRole("radio", { name: /Planned route step/i }).check()
  await page.getByLabel("Search jobs").fill(seed.jobwork.production_job_number)
  await expect(page.locator("#jw-job option", { hasText: seed.jobwork.production_job_number })).toHaveCount(1, { timeout: 20_000 })
  await selectOptionContaining(page.locator("#jw-job"), seed.jobwork.production_job_number)
  const vendorSelect = page.locator("#jw-vendor")
  await expect(vendorSelect).toBeEnabled({ timeout: 20_000 })
  await expect(vendorSelect.locator(`option[value="${seed.jobwork.vendor_id}"]`)).toHaveCount(1, { timeout: 20_000 })
  await vendorSelect.selectOption(seed.jobwork.vendor_id)
  if (await page.locator("#jw-qty").isVisible().catch(() => false)) {
    if (!(await page.locator("#jw-qty").inputValue())) await page.locator("#jw-qty").fill("4")
  }
  if (await page.locator("#jw-date").isVisible().catch(() => false)) {
    if (!(await page.locator("#jw-date").inputValue())) {
      const due = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10)
      await page.locator("#jw-date").fill(due)
    }
  }
  await page.locator("#jw-notes").fill("UI E2E planned-step jobwork mutation")
  const createResponse = waitForPost(page, "/api/inventory/job-work/")
  await page.getByTestId("jobwork-create-submit").click()
  const created = await createResponse
  expect(created.status(), await created.text()).toBe(201)
  const createdBody = await created.json()
  const orderId = String(createdBody?.order?.id || "")
  expect(orderId).toBeTruthy()
  await page.waitForURL(new RegExp(`/inventory/job-work/${orderId}`), { timeout: 30_000 })
  await page.getByTestId("jobwork-detail").waitFor({ state: "visible", timeout: 30_000 })

  // 2. Dispatch the seeded roll on a challan.
  await page.getByTestId("jobwork-dispatch").click()
  const rollCheckbox = page.getByRole("checkbox", { name: `Send ${seed.jobwork.source_roll_label}` })
  if (!(await rollCheckbox.isVisible().catch(() => false))) {
    await page.getByLabel("Which rolls").selectOption("plant")
  }
  await expect(rollCheckbox).toBeVisible({ timeout: 20_000 })
  await rollCheckbox.check()
  // Rule 45 challans print the value of goods sent; the store declares it per roll.
  const valueInput = page.getByLabel(`Value of ${seed.jobwork.source_roll_label}`)
  if (await valueInput.isVisible().catch(() => false)) {
    if (!(await valueInput.inputValue())) await valueInput.fill("500")
  }
  const vehicleInput = page.getByPlaceholder("DD03U9802")
  if (await vehicleInput.isVisible().catch(() => false)) await vehicleInput.fill("DD03U9802")
  const dispatchResponse = waitForPost(page, `/api/inventory/job-work/${orderId}/dispatch/`)
  await page.getByTestId("jobwork-dispatch-submit").click()
  const dispatched = await dispatchResponse
  expect(dispatched.status(), await dispatched.text()).toBeLessThan(300)

  // 3. Receive the processed roll back: input used up, one output roll with specs and grade.
  await expect(page.getByTestId("jobwork-receive")).toBeVisible({ timeout: 30_000 })
  await page.getByTestId("jobwork-receive").click()
  const panel = page.getByTestId("jobwork-receive-panel")
  await panel.waitFor({ state: "visible", timeout: 30_000 })
  await panel.getByLabel(`What happened to ${seed.jobwork.source_roll_label}`).selectOption("PROCESSED")
  const docInput = panel.locator("#jwr-doc")
  if (await docInput.isVisible().catch(() => false)) await docInput.fill(`JW/E2E/${Date.now().toString().slice(-5)}`)
  let rollsFieldset = panel.locator("fieldset", { has: page.locator("legend", { hasText: "Output rolls" }) })
  if (!(await rollsFieldset.isVisible().catch(() => false))) {
    await panel.getByRole("button", { name: /Output rolls/i }).click()
    rollsFieldset = panel.locator("fieldset", { has: page.locator("legend", { hasText: "Output rolls" }) })
  }
  await expect(rollsFieldset).toBeVisible({ timeout: 15_000 })
  const filmSelect = rollsFieldset.locator("select").first()
  await expect(filmSelect.locator(`option[value="${seed.jobwork.return_material_id}"]`)).toHaveCount(1, { timeout: 20_000 })
  await filmSelect.selectOption(seed.jobwork.return_material_id)
  const rollInputs = rollsFieldset.locator("input")
  // Mass balance: what came back must account for what was sent (3 % tolerance).
  const sentKg = Number(seed.jobwork.source_roll_weight_kg || 8.25)
  await rollInputs.nth(0).fill((sentKg * 0.99).toFixed(3))
  await rollInputs.nth(1).fill("900")
  await rollInputs.nth(2).fill("40")
  await rollsFieldset.getByLabel("Roll 1 location").selectOption(seed.jobwork.receive_location_id)
  const gradeSelect = rollsFieldset.locator("select", { has: page.locator("option", { hasText: "Choose grade" }) })
  if (await gradeSelect.isVisible().catch(() => false)) {
    await gradeSelect.selectOption(seed.jobwork.return_grade_id)
  }
  await rollInputs.last().fill(returnLabel)
  const receiveResponse = waitForPost(page, `/api/inventory/job-work/${orderId}/returns/`)
  await panel.getByTestId("jobwork-receive-submit").click()
  const received = await receiveResponse
  expect(received.status(), await received.text()).toBeLessThan(300)

  // 4. The order shows the return and the new roll sits at the receiving location.
  await expect
    .poll(async () => {
      const detail = await fetchJson<any>(page, `/api/inventory/job-work/${orderId}/`)
      return String(detail.data?.status || detail.data?.order?.status || "").toUpperCase()
    }, { timeout: 30_000 })
    .toMatch(/PARTIAL|RECEIVED|RETURNED|CLOSED|COMPLETED/)
  const rollsResponse = await fetchJson<any>(page, `/api/inventory/rolls/?plant=${seed.jobwork.plant_id}&location=${seed.jobwork.receive_location_id}`)
  expect(rollsResponse.status).toBe(200)
  const rolls = unwrapApiList<any>(rollsResponse.data)
  expect(rolls.some((row) => String(row.label_id || "") === returnLabel)).toBeTruthy()
})
