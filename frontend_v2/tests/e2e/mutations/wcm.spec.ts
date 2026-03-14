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

  await page.goto("/dashboard/admin")
  await switchRole(page, "Work Center Manager", "/production/work-center")
  await page.goto(`/production/work-center/${seed.wcm.work_center_id}`)
  await page.getByTestId("wcm-terminal-page").waitFor({ state: "visible", timeout: 30_000 })
  await assertHealthyPage(page)

  await page.getByTestId(`wcm-assignment-row-${seed.wcm.assignment_id}`).click()
  await page.getByTestId("wcm-machine-select").click()
  await page.getByRole("option").first().click()
  await page.getByTestId("wcm-save-machine").click()
  await expect(page.getByTestId("wcm-push-to-operator")).toBeEnabled({ timeout: 20_000 })
  await page.getByTestId("wcm-push-to-operator").click()

  await page.waitForTimeout(1500)
  const queueResponse = await fetchJson<any>(page, `/api/production/wc/${seed.wcm.work_center_id}/queue/`)
  expect(queueResponse.status).toBe(200)
  const historyResponse = await fetchJson<any>(page, `/api/production/wc/${seed.wcm.work_center_id}/history/`)
  expect(historyResponse.status).toBe(200)
  const assignments = [...unwrapApiList<any>(queueResponse.data), ...unwrapApiList<any>(historyResponse.data)]
  const assignment = assignments.find((row) => String(row.id) === seed.wcm.assignment_id)
  expect(assignment).toBeTruthy()
  expect(String(assignment?.status || "").toUpperCase()).toBe("EXECUTION_READY")
  expect(String(assignment?.assigned_machine || "")).toBe(seed.wcm.machine_id)
})
