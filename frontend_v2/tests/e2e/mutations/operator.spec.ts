import { test, expect } from "../support/base"
import { annotate, assertHealthyPage, fetchJson, switchRole, unwrapApiList } from "../support/test-helpers"
import { readMutationSeed, type MutationSeedMetadata } from "../support/mutation-seed"

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
  await switchRole(page, "Operator", "/production/machine-selector", { allowCookieFallback: true })
  await page.goto("/production/machine-selector")
  await page.getByTestId("machine-selector-page").waitFor({ state: "visible", timeout: 30_000 })
  await page.getByTestId(`machine-card-${seed.operator.machine_id}`).click()
  await page.waitForURL(new RegExp(`/production/machine/${seed.operator.machine_id}`), { timeout: 60_000, waitUntil: "domcontentloaded" })
  await page.getByTestId("machine-execution-page").waitFor({ state: "visible", timeout: 60_000 })
  await assertHealthyPage(page)

  const jobCard = page.getByTestId(`machine-job-card-${seed.operator.job_id}`)
  if (await jobCard.isVisible().catch(() => false)) {
    await jobCard.click()
  }

  await expect(page.locator("body")).toContainText(seed.operator.job_number)
  const startButton = page.getByTestId("machine-start-step")
  const stopButton = page.getByTestId("machine-stop-step")

  if (await startButton.isVisible().catch(() => false)) {
    await expect(startButton).toBeEnabled()
    await startButton.click()
  }

  await expect(stopButton).toBeEnabled({ timeout: 20_000 })
  await stopButton.click()
  await expect(startButton).toBeEnabled({ timeout: 20_000 })
  await startButton.click()

  const outputPanel = page.getByTestId("machine-output-panel")
  if (!(await outputPanel.isVisible().catch(() => false))) {
    await page.getByTestId("machine-stage-output").click()
  }
  await outputPanel.waitFor({ state: "visible", timeout: 20_000 })
  await expect(outputPanel).toContainText("Enter only the fields this step needs.")

  const outputPanelText = (await outputPanel.textContent()) || ""
  const pageText = (await page.locator("body").textContent()) || ""
  const maxLogMatch = outputPanelText.match(/MAX THIS LOG\s*([0-9]+(?:\.[0-9]+)?)\s*kg/i)
  const targetMatch =
    pageText.match(/STEP PROGRESS\s*[0-9]+(?:\.[0-9]+)?\s*kg\s*\/\s*([0-9]+(?:\.[0-9]+)?)\s*kg/i) ||
    pageText.match(/TARGET\s*([0-9]+(?:\.[0-9]+)?)\s*kg/i) ||
    outputPanelText.match(/TARGET\s*([0-9]+(?:\.[0-9]+)?)\s*kg/i)
  const maxLogKg = Number(maxLogMatch?.[1] || targetMatch?.[1] || "9")
  const targetKg = Number(targetMatch?.[1] || maxLogKg)
  const scrapKg = targetKg > 1 ? 0.25 : 0
  const outputKg = Math.max(0.001, Math.min(maxLogKg, targetKg) - scrapKg)
  const outputKgText = outputKg.toFixed(3)
  const scrapKgText = scrapKg.toFixed(3)

  const outputWidth = outputPanel.getByTestId("machine-output-width")
  const outputLength = outputPanel.getByTestId("machine-output-length")
  const outputWeight = outputPanel.getByTestId("machine-output-weight")
  const outputPcs = outputPanel.getByTestId("machine-output-pcs")
  const createRowGross = outputPanel.getByTestId("machine-create-row-gross-0")
  const createRowTare = outputPanel.getByTestId("machine-create-row-tare-0")
  const createRowWidth = outputPanel.getByTestId("machine-create-row-width-0")
  const splitRowWidth = outputPanel.getByTestId("machine-split-row-width-0")
  const splitRowWeight = outputPanel.getByTestId("machine-split-row-weight-0")
  const scrapInput = page.getByTestId("machine-scrap-input")

  if (await outputWidth.isVisible().catch(() => false)) {
    await outputWidth.fill("1120")
  }
  if (await outputLength.isVisible().catch(() => false)) {
    await outputLength.fill("0")
  }
  if (await outputWeight.isVisible().catch(() => false)) {
    await outputWeight.fill(outputKgText)
  } else if (await createRowWidth.isVisible().catch(() => false)) {
    if (await createRowGross.isVisible().catch(() => false)) {
      await createRowGross.fill((outputKg + 0.25).toFixed(3))
    }
    if (await createRowTare.isVisible().catch(() => false)) {
      await createRowTare.fill("0.250")
    }
    await createRowWidth.fill("1120")
  } else if (await splitRowWidth.isVisible().catch(() => false)) {
    await splitRowWidth.fill("1120")
    await splitRowWeight.fill(outputKgText)
  } else {
    const visibleInputs = outputPanel.locator("input:visible")
    const visibleCount = await visibleInputs.count()
    if (visibleCount >= 3) {
      const panelText = await outputPanel.textContent()
      if (panelText?.includes("Create new roll rows") || panelText?.includes("Split rows")) {
        await visibleInputs.nth(0).fill("1120")
        await visibleInputs.nth(1).fill(outputKgText)
      } else {
        await visibleInputs.nth(0).fill(outputKgText)
      }
    } else if (visibleCount >= 1) {
      await visibleInputs.first().fill(outputKgText)
    } else {
      throw new Error("No output-entry fields were visible on the machine terminal")
    }
  }
  if (await outputPcs.isVisible().catch(() => false)) {
    await outputPcs.fill("25")
  }
  await scrapInput.scrollIntoViewIfNeeded().catch(() => undefined)
  await expect(scrapInput).toBeVisible({ timeout: 10_000 })
  await scrapInput.fill(scrapKgText)
  const varianceReasonInput = page.getByPlaceholder(/variance reason required/i)
  if (await varianceReasonInput.isVisible().catch(() => false)) {
    await varianceReasonInput.fill("E2E output variance within close tolerance")
  }
  await page.getByTestId("machine-log-output").click()

  await expect(page.getByTestId("machine-finalize-step")).toBeEnabled({ timeout: 20_000 })
  await page.getByTestId("machine-finalize-step").click()

  await page.waitForTimeout(1500)
  const historyResponse = await fetchJson<any>(page, `/api/production/machine/${seed.operator.machine_id}/history/`)
  expect(historyResponse.status).toBe(200)
  const jobs = unwrapApiList<any>(historyResponse.data)
  expect(jobs.some((job) => String(job.job_number || "") === seed.operator.job_number)).toBeTruthy()
})

test("operator terminal renders the printing process-aware execution card", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Operator",
    severity: "high",
    role: "OPERATOR",
    feature: "Machine execution process variants",
    expected: "Printing jobs should open on the same terminal with the MODIFY_EXISTING process-aware controls and sublog actions available.",
  })

  const seed = readMutationSeed() as MutationSeedMetadata & {
    printing_operator?: {
      machine_id: string
      job_id: string
      job_number: string
    }
  }
  test.skip(!seed.printing_operator, "Mutation seed does not include a printing operator job.")

  const printing = seed.printing_operator!
  await page.goto("/dashboard/admin")
  await switchRole(page, "Operator", "/production/machine-selector", { allowCookieFallback: true })
  await page.goto(`/production/machine/${printing.machine_id}`)
  await page.getByTestId("machine-execution-page").waitFor({ state: "visible", timeout: 30_000 })
  await assertHealthyPage(page)

  const jobCard = page.getByTestId(`machine-job-card-${printing.job_id}`)
  if (await jobCard.isVisible().catch(() => false)) {
    await jobCard.click()
  }

  const outputPanel = page.getByTestId("machine-output-panel")
  await expect(page.locator("body")).toContainText(printing.job_number)
  await expect(outputPanel).toContainText("Printing")
  await expect(outputPanel).toContainText("MODIFY_EXISTING")
  await expect(page.getByRole("button", { name: "Consumption", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Quality", exact: true })).toBeVisible()
  await expect(page.locator("body")).toContainText("Current status")
  await expect(page.locator("body")).toContainText("Live route")
  await expect(page.locator("body")).not.toContainText("PROCESS roll_behavior")
  await expect(page.locator("body")).not.toContainText("POST /api/production/machine")
  await expect(page.locator("body")).not.toContainText("Process mode")
})
