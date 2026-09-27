import { test, expect } from "../support/base"
import { readRuntimeJson, switchRole } from "../support/test-helpers"

test("tiered roll filters retain selected rolls and send the same complete selection", async ({ page }) => {
  const proof = readRuntimeJson<any>("acceptance/wip_route_truth.json")
  const job = proof.ui_jobs.modify_fallback
  const candidates = [
    { roll_id: "filter-exact", label_id: "FILTER-EXACT", tier: "EXACT", weight_kg: 4, width_mm: 500, thickness_micron: 50, material_name: "Filter fixture", created_at: new Date().toISOString() },
    { roll_id: "filter-remainder", label_id: "FILTER-REMAINDER", tier: "REMAINDER_POOL", weight_kg: 3, width_mm: 500, thickness_micron: 50, material_name: "Filter fixture", created_at: new Date().toISOString() },
  ]
  await page.route(`**/api/production/jobs/${job.job_id}/tiered-rolls{,/,?*}`, async route => {
    await route.fulfill({ json: { candidates, target_width_mm: 500, remaining_qty_kg: 7 } })
  })
  let submitted: any = null
  await page.route(`**/api/production/jobs/${job.job_id}/allocate-with-slit-batch{,/,?*}`, async route => {
    submitted = route.request().postDataJSON()
    await route.fulfill({ json: { picks_count: 2, total_qty_allocated_kg: 7, child_rolls: [], remainder_rolls: [], assigned_jobs: [] } })
  })
  await page.goto("/dashboard/admin")
  await switchRole(page, "Work Center Manager", `/production/work-center/${job.work_center_id}`)
  await page.getByTestId(`wcm-assignment-row-${job.assignment_id}`).click()
  await page.getByRole("button", { name: "Pick with tiers" }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("button").filter({ hasText: "FILTER-EXACT" }).click()
  await dialog.getByRole("button").filter({ hasText: "FILTER-REMAINDER" }).click()
  await dialog.getByRole("button", { name: /Hide remainders/i }).click()
  await expect(dialog.getByRole("status")).toContainText("1 selected roll(s) are hidden")
  await expect(dialog.getByRole("button", { name: /Allocate 2 rolls/i })).toBeEnabled()
  await dialog.getByRole("button", { name: /Allocate 2 rolls/i }).click()
  await expect.poll(() => submitted?.picks?.map((pick: any) => pick.roll_id).sort()).toEqual(["filter-exact", "filter-remainder"])
})
