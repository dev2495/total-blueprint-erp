import fs from "node:fs"
import path from "node:path"

import { test, expect } from "../support/base"
import { annotate, assertHealthyPage, fetchJson, loginViaUi, switchRole } from "../support/test-helpers"

type UiProofJob = {
  job_id: string
  job_number: string
  assignment_id: string
  work_center_id: string
  fallback_roll_label: string
  fallback_roll_id: string
  lineage_roll_labels?: string[]
  lineage_roll_ids?: string[]
  required_rolls?: number
  lineage_roll_count: number
  fallback_roll_count: number
}

type WipRouteTruthProof = {
  ui_jobs?: {
    modify_fallback?: UiProofJob
    combine_three_fallback?: UiProofJob
  }
}

function readRouteProof(): WipRouteTruthProof {
  const candidates = [
    path.resolve(process.cwd(), "../.runtime/ui-e2e/acceptance/wip_route_truth.json"),
    path.resolve(process.cwd(), "../.runtime/acceptance/wip_route_truth.json"),
  ]
    .filter((candidate) => fs.existsSync(candidate))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)

  const proofPath = candidates[0]
  if (!proofPath) {
    throw new Error("WIP route truth artifact missing in both .runtime/ui-e2e/acceptance and .runtime/acceptance")
  }
  return JSON.parse(fs.readFileSync(proofPath, "utf8")) as WipRouteTruthProof
}

async function openWcmJob(page: Page, workCenterId: string, assignmentId: string, jobNumber: string) {
  await page.goto(`/production/work-center/${workCenterId}`)
  await page.getByTestId("wcm-terminal-page").waitFor({ state: "visible", timeout: 30_000 })
  await assertHealthyPage(page)
  await expect(page.getByTestId(`wcm-assignment-row-${assignmentId}`)).toBeVisible()
  await page.getByTestId(`wcm-assignment-row-${assignmentId}`).click()
  await expect(page.locator("body")).toContainText(jobNumber)
}

async function clearAssignedRolls(page: Page) {
  const assignedRolls = page.locator("[data-testid^='wcm-assigned-roll-']")
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const count = await assignedRolls.count()
    if (count === 0) break
    await assignedRolls.first().getByRole("button").click()
    await page.waitForTimeout(300)
  }
  await expect(assignedRolls).toHaveCount(0, { timeout: 15_000 })
}

test("WCM separates lineage from manual fallback and enforces three-slot combine coverage", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "WIP Route Truth",
    severity: "critical",
    role: "WORK_CENTER_MANAGER",
    feature: "Lineage vs fallback assignment truth",
    expected:
      "WCM should keep true lineage separate from compatible fallback, allow manual fallback assignment, and require all three slot-matched rolls before a three-layer combine is considered fully assigned.",
  })

  const proof = readRouteProof()
  const modifyFallback = proof.ui_jobs?.modify_fallback
  const combineFallback = proof.ui_jobs?.combine_three_fallback
  expect(modifyFallback).toBeTruthy()
  expect(combineFallback).toBeTruthy()

  await loginViaUi(page)
  await switchRole(page, "Work Center Manager", `/production/work-center/${modifyFallback!.work_center_id}`)

  const modifyQueue = await fetchJson<any>(page, `/api/production/wc/${modifyFallback!.work_center_id}/queue/`)
  expect(modifyQueue.status).toBe(200)
  expect(JSON.stringify(modifyQueue.data)).toContain(modifyFallback!.assignment_id)

  await openWcmJob(page, modifyFallback!.work_center_id, modifyFallback!.assignment_id, modifyFallback!.job_number)
  await clearAssignedRolls(page)
  await expect(page.locator("body")).toContainText("True WIP")
  await expect(page.locator("body")).toContainText("Fallback")
  await expect(page.locator("body")).toContainText("Slot Coverage")
  await expect(page.locator("body")).toContainText("Fallback is manual only")
  await expect(page.locator("body")).toContainText("Missing lineage 1")

  await page.getByRole("button", { name: /allocate rolls/i }).first().click()
  const allocationDialog = page.getByTestId("wcm-allocation-dialog")
  await expect(allocationDialog).toContainText("Resource Discovery & Allocation")
  await expect(allocationDialog).toContainText(modifyFallback!.fallback_roll_label)
  await expect(allocationDialog).toContainText("Manual assignment only")

  await allocationDialog.getByTestId(`wcm-local-roll-select-${modifyFallback!.fallback_roll_id}`).click()
  await allocationDialog.getByRole("button", { name: /finalize allocation/i }).click()
  await expect(page.getByTestId(`wcm-assigned-roll-${modifyFallback!.fallback_roll_id}`)).toBeVisible()
  await expect(page.locator("body")).toContainText(modifyFallback!.fallback_roll_label)
  await expect(page.locator("body")).toContainText("1/1")

  await page.getByTestId(`wcm-assigned-roll-${modifyFallback!.fallback_roll_id}`).getByRole("button").click()
  await expect(page.locator("body")).toContainText("No rolls assigned")

  const combineQueue = await fetchJson<any>(page, `/api/production/wc/${combineFallback!.work_center_id}/queue/`)
  expect(combineQueue.status).toBe(200)
  expect(JSON.stringify(combineQueue.data)).toContain(combineFallback!.assignment_id)

  await openWcmJob(page, combineFallback!.work_center_id, combineFallback!.assignment_id, combineFallback!.job_number)
  await clearAssignedRolls(page)
  await expect(page.locator("body")).toContainText("Fallback is manual only")
  await expect(page.locator("body")).toContainText("Missing lineage 1")

  await page.getByRole("button", { name: /allocate rolls/i }).first().click()
  const combineDialog = page.getByTestId("wcm-allocation-dialog")
  await expect(combineDialog).toContainText("Required")
  await expect(combineDialog).toContainText(String(combineFallback!.required_rolls || 3))
  await expect(combineDialog).toContainText("Slot Coverage")

  for (const rollId of combineFallback!.lineage_roll_ids || []) {
    await combineDialog.getByTestId(`wcm-local-roll-select-${rollId}`).click()
  }
  await combineDialog.getByRole("button", { name: /finalize allocation/i }).click()
  await expect(page.locator("body")).toContainText("Reserved2/3")
  await expect(page.locator("body")).toContainText("Missing assignment 1")
  await expect(page.getByTestId(`wcm-assigned-roll-${combineFallback!.fallback_roll_id}`)).toHaveCount(0)

  await page.getByRole("button", { name: /allocate rolls/i }).first().click()
  const combineFallbackDialog = page.getByTestId("wcm-allocation-dialog")
  await expect(combineFallbackDialog).toContainText("Fallback")
  await combineFallbackDialog.getByTestId(`wcm-local-roll-select-${combineFallback!.fallback_roll_id}`).click()
  await combineFallbackDialog.getByRole("button", { name: /finalize allocation/i }).click()
  await expect(page.getByTestId(`wcm-assigned-roll-${combineFallback!.fallback_roll_id}`)).toBeVisible()
  await expect(page.locator("body")).toContainText("3/3")
  await expect(page.locator("body")).toContainText(combineFallback!.fallback_roll_label)
})
import type { Page } from "@playwright/test"
