import { test, expect } from "../support/base"
import { annotate, assertHealthyPage, fetchJson, switchRole, unwrapApiList } from "../support/test-helpers"
import { readMutationSeed } from "../support/mutation-seed"

test("wcm can assign a machine and push a queued job into execution-ready state", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "WCM",
    severity: "critical",
    role: "WORK_CENTER_MANAGER",
    feature: "Queue to machine execution handoff",
    expected: "Work-center manager should be able to assign a machine and push the seeded job to operator execution without bypassing queue controls.",
  })

  const seed = readMutationSeed()

  await page.goto("/dashboard/admin", { waitUntil: "domcontentloaded" })
  await switchRole(page, "Work Center Manager", "/production/work-center")
  await page.goto(`/production/work-center/${seed.wcm.work_center_id}`, { waitUntil: "domcontentloaded" })
  await page.getByTestId("wcm-terminal-page").waitFor({ state: "visible", timeout: 30_000 })
  await assertHealthyPage(page)

  await page.getByTestId(`wcm-assignment-row-${seed.wcm.assignment_id}`).click()
  await page.getByTestId("wcm-machine-select").click()
  const seededMachine = page.getByRole("option", { name: new RegExp(seed.wcm.machine_code || seed.wcm.machine_id, "i") }).first()
  if (await seededMachine.isVisible().catch(() => false)) {
    await seededMachine.click()
  } else {
    await page.getByRole("option").first().click()
  }
  const releaseButton = page.getByTestId("wcm-assign-release")
  await expect(releaseButton).toBeEnabled({ timeout: 20_000 })
  await expect(releaseButton).toContainText(/Assign \+ release/i, { timeout: 20_000 })
  const readyResponse = page.waitForResponse((response) => response.url().includes("/api/production/wc-allocation/ready/") && response.request().method() === "POST")
  await releaseButton.click()
  expect((await readyResponse).status()).toBe(200)

  await expect(page).toHaveURL(new RegExp(`/production/work-center/${seed.wcm.work_center_id}`))
  await expect
    .poll(async () => {
      const queueResponse = await fetchJson<any>(page, `/api/production/wc/${seed.wcm.work_center_id}/queue/`)
      expect(queueResponse.status).toBe(200)
      const historyResponse = await fetchJson<any>(page, `/api/production/wc/${seed.wcm.work_center_id}/history/`)
      expect(historyResponse.status).toBe(200)
      const assignments = [...unwrapApiList<any>(queueResponse.data), ...unwrapApiList<any>(historyResponse.data)]
      const assignment = assignments.find((row) => String(row.id) === seed.wcm.assignment_id)
      return {
        status: String(assignment?.status || "").toUpperCase(),
        machine: String(assignment?.assigned_machine || ""),
      }
    }, { timeout: 30_000 })
    .toEqual({ status: "EXECUTION_READY", machine: seed.wcm.machine_id })
  await page.reload({ waitUntil: "domcontentloaded" })
  await page.getByTestId("wcm-terminal-page").waitFor({ state: "visible", timeout: 30_000 })
  await expect(page.locator("body")).toContainText(/Running \/ ready/i, { timeout: 30_000 })
})
