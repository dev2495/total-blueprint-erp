import { test, expect } from "../support/base"
import { annotate, assertHealthyPage, fetchJson, switchRole, unwrapApiList } from "../support/test-helpers"
import { readMutationSeed } from "../support/mutation-seed"

test("operator can start, pause, resume, log output with scrap, and finalize a seeded machine job", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Operator",
    severity: "critical",
    role: "OPERATOR",
    feature: "Machine execution mutations",
    expected: "Operator should be able to run the seeded machine job through start, pause/resume, output logging, and final completion without runtime errors.",
  })

  const seed = readMutationSeed()

  await page.goto("/dashboard/admin")
  await switchRole(page, "Operator", "/production/machine-selector")
  await page.goto("/production/machine-selector")
  await page.getByTestId("machine-selector-page").waitFor({ state: "visible", timeout: 30_000 })
  await page.getByTestId(`machine-card-${seed.operator.machine_id}`).click()
  await page.waitForURL(new RegExp(`/production/machine/${seed.operator.machine_id}`), { timeout: 30_000 })
  await page.getByTestId("machine-execution-page").waitFor({ state: "visible", timeout: 30_000 })
  await assertHealthyPage(page)

  const jobCard = page.getByTestId(`machine-job-card-${seed.operator.job_id}`)
  if (await jobCard.isVisible().catch(() => false)) {
    await jobCard.click()
  }

  await expect(page.locator("body")).toContainText(seed.operator.job_number)
  await expect(page.getByTestId("machine-start-step")).toBeEnabled()
  await page.getByTestId("machine-start-step").click()

  await expect(page.getByTestId("machine-stop-step")).toBeEnabled({ timeout: 20_000 })
  await page.getByTestId("machine-stop-step").click()
  await expect(page.getByTestId("machine-start-step")).toBeEnabled({ timeout: 20_000 })
  await page.getByTestId("machine-start-step").click()

  if (await page.getByTestId("machine-output-width").isVisible().catch(() => false)) {
    await page.getByTestId("machine-output-width").fill("1120")
  }
  if (await page.getByTestId("machine-output-length").isVisible().catch(() => false)) {
    await page.getByTestId("machine-output-length").fill("0")
  }
  await page.getByTestId("machine-output-weight").fill("8.750")
  await page.getByTestId("machine-scrap-input").fill("0.250")
  await page.getByTestId("machine-log-output").click()

  await expect(page.getByTestId("machine-finalize-step")).toBeEnabled({ timeout: 20_000 })
  await page.getByTestId("machine-finalize-step").click()

  await page.waitForTimeout(1500)
  const historyResponse = await fetchJson<any>(page, `/api/production/machine/${seed.operator.machine_id}/history/`)
  expect(historyResponse.status).toBe(200)
  const jobs = unwrapApiList<any>(historyResponse.data)
  expect(jobs.some((job) => String(job.job_number || "") === seed.operator.job_number)).toBeTruthy()
})
