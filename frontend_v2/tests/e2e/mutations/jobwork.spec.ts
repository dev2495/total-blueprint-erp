import { test, expect } from "../support/base"
import { annotate, assertHealthyPage, fetchJson, selectByTestId, switchRole, unwrapApiList } from "../support/test-helpers"
import { readMutationSeed } from "../support/mutation-seed"

function latestOrderForJob(rows: any[], jobNumber: string) {
  return rows
    .filter((row) => String(row.production_job_number || "") === jobNumber)
    .sort((left, right) => new Date(String(right.created_at || 0)).getTime() - new Date(String(left.created_at || 0)).getTime())[0]
}

test("store can create, dispatch, and receive a planned-step jobwork order", async ({ page }, testInfo) => {
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

  await page.getByTestId("jobwork-new-order").click()
  await selectByTestId(page, "jobwork-create-plant", new RegExp(seed.jobwork.plant_name, "i"))
  await selectByTestId(page, "jobwork-create-mode", /planned route step/i)
  await page.getByTestId("jobwork-create-production-job").click()
  await page.getByRole("option", { name: new RegExp(seed.jobwork.production_job_number, "i") }).click()
  await page.getByTestId("jobwork-create-vendor").click()
  await page.getByRole("option").first().click()
  await page.getByTestId("jobwork-create-notes").fill("UI E2E planned-step jobwork mutation")
  const createResponse = page.waitForResponse((response) => response.url().includes("/api/inventory/job-work/") && response.request().method() === "POST")
  await page.getByTestId("jobwork-create-submit").click()
  const created = await createResponse
  expect(created.status()).toBe(201)
  const createdOrder = await created.json()
  const orderId = String(createdOrder?.id || "")
  expect(orderId).toBeTruthy()

  await page.waitForTimeout(1000)
  const createdResponse = await fetchJson<any>(page, "/api/inventory/job-work/")
  expect(createdResponse.status).toBe(200)
  const orders = unwrapApiList<any>(createdResponse.data)
  const order = orders.find((row) => String(row.id) === orderId) || latestOrderForJob(orders, seed.jobwork.production_job_number)
  expect(order).toBeTruthy()

  await page.getByTestId(`jobwork-dispatch-trigger-${order.id}`).click()
  await page.getByTestId(`jobwork-dispatch-roll-${order.id}-${seed.jobwork.source_roll_id}`).click()
  await page.getByTestId(`jobwork-dispatch-submit-${order.id}`).click()

  await page.waitForTimeout(1000)
  await page.getByTestId(`jobwork-receive-trigger-${order.id}`).click()
  await selectByTestId(page, `jobwork-receive-location-${order.id}`, new RegExp(seed.jobwork.receive_location_name, "i"))
  await page.getByTestId(`jobwork-receive-material-${order.id}`).click()
  await page.getByRole("option", { name: new RegExp(seed.jobwork.return_material_code, "i") }).first().click()
  await page.getByTestId(`jobwork-receive-label-${order.id}`).fill(returnLabel)
  await page.getByTestId(`jobwork-receive-thickness-${order.id}`).fill("40")
  await page.getByTestId(`jobwork-receive-width-${order.id}`).fill("900")
  await page.getByTestId(`jobwork-receive-weight-${order.id}`).fill("4.100")
  await page.getByTestId(`jobwork-receive-grade-${order.id}`).click()
  await page.getByRole("option", { name: /gp/i }).click()
  await page.getByTestId(`jobwork-receive-submit-${order.id}`).click()

  await page.waitForTimeout(1000)
  const receivedResponse = await fetchJson<any>(page, "/api/inventory/job-work/")
  expect(receivedResponse.status).toBe(200)
  const receivedOrder =
    unwrapApiList<any>(receivedResponse.data).find((row) => String(row.id) === orderId) ||
    latestOrderForJob(unwrapApiList<any>(receivedResponse.data), seed.jobwork.production_job_number)
  expect(String(receivedOrder?.status || "").toUpperCase()).toBe("PARTIAL")

  const rollsResponse = await fetchJson<any>(page, `/api/inventory/rolls/?plant=${seed.jobwork.plant_id}&location=${seed.jobwork.receive_location_id}`)
  const rolls = unwrapApiList<any>(rollsResponse.data)
  expect(rolls.some((row) => String(row.label_id || "") === returnLabel)).toBeTruthy()
})
