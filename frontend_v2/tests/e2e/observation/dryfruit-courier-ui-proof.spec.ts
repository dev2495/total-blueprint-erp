import { test, expect } from "../support/base"
import {
  annotate,
  assertHealthyPage,
  assertNoHorizontalOverflow,
  attachJson,
  fetchJson,
  readRuntimeJson,
} from "../support/test-helpers"

type CourierProof = {
  dryfruit: {
    sku_code: string
    template_name: string
    planner_invariant_sku: {
      sku_code: string
      variant_code: string
    }
    sales_orders: {
      wip: { sales_order_number: string }
      fg: { sales_order_number: string }
      fresh: { sales_order_number: string }
    }
  }
  packaging: {
    planner_sku_code: string
    variant_code: string
    remaining_qty: number
    uom: string
  }
  pod: {
    planner_sku_code: string
    variant_code: string
    remaining_qty_kg: number
  }
  machine_history: {
    machine_id: string
    completed_job_number: string
    summary: {
      jobs_completed: number
      produced_kg: number
    }
  }
}

function expectProof(): CourierProof {
  const proof = readRuntimeJson<CourierProof>("dryfruit-courier-ui-proof.json")
  expect(proof, "dryfruit-courier-ui-proof.json must exist before UI observation runs").toBeTruthy()
  return proof as CourierProof
}

test("dry-fruit courier route, invariant continuation, pod, packaging, and machine history stay truthful in UI", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Observations",
    severity: "high",
    role: "ADMIN",
    feature: "Courier dry-fruit planner proof",
    expected: "Planner, SKU, launcher, and machine pages should surface the courier-route dry-fruit proof cleanly with no UI regressions.",
  })

  const proof = expectProof()
  await attachJson(page, testInfo, "dryfruit-courier-ui-proof", proof)

  await page.goto("/sales/sku-catalog", { waitUntil: "domcontentloaded" })
  await assertHealthyPage(page)
  await page.getByTestId("sales-sku-catalog-page").waitFor({ state: "visible", timeout: 30_000 })
  await assertNoHorizontalOverflow(page)
  await page.getByTestId("sales-sku-search").fill(proof.dryfruit.sku_code)
  await expect(page.locator("body")).toContainText(proof.dryfruit.sku_code)
  await expect(page.locator("body")).toContainText(proof.dryfruit.template_name)

  await page.goto("/production/planner/sku-catalog", { waitUntil: "domcontentloaded" })
  await assertHealthyPage(page)
  await page.getByTestId("planner-sku-catalog-page").waitFor({ state: "visible", timeout: 30_000 })
  await assertNoHorizontalOverflow(page)

  const plannerSearch = page.getByPlaceholder(/Search family, preset, template/i)

  await plannerSearch.fill(proof.dryfruit.planner_invariant_sku.sku_code)
  await expect(page.locator("body")).toContainText(proof.dryfruit.planner_invariant_sku.sku_code)
  await page.getByRole("button", { name: new RegExp(proof.dryfruit.planner_invariant_sku.sku_code, "i") }).first().click()
  await expect(page.locator("body")).toContainText(proof.dryfruit.planner_invariant_sku.variant_code)
  await expect(page.locator("body")).toContainText(/Invariant Roll/i)

  await plannerSearch.fill(proof.packaging.planner_sku_code)
  await expect(page.locator("body")).toContainText(proof.packaging.planner_sku_code)
  await page.getByRole("button", { name: new RegExp(proof.packaging.planner_sku_code, "i") }).first().click()
  await expect(page.locator("body")).toContainText(proof.packaging.variant_code)
  await expect(page.locator("body")).toContainText(/Packaging/i)
  await expect(page.locator("body")).toContainText(/2 layers/i)

  await plannerSearch.fill(proof.pod.planner_sku_code)
  await expect(page.locator("body")).toContainText(proof.pod.planner_sku_code)
  await page.getByRole("button", { name: new RegExp(proof.pod.planner_sku_code, "i") }).first().click()
  await expect(page.locator("body")).toContainText(proof.pod.variant_code)
  await expect(page.locator("body")).toContainText(/POD/i)
  await expect(page.locator("body")).toContainText(/1 layer/i)
  await page.getByRole("button", { name: /^Edit$/i }).click()
  const plannerDialog = page.getByRole("dialog")
  await expect(plannerDialog).toContainText(/Edit Planner Variant/i)
  await expect(plannerDialog).toContainText(/Material structure/i)
  await plannerDialog.getByRole("button", { name: /^Close$/i }).first().click()

  await page.goto("/production/planner/stock-orders/create", { waitUntil: "domcontentloaded" })
  await assertHealthyPage(page)
  await page.getByTestId("planner-stock-launch-studio").waitFor({ state: "visible", timeout: 30_000 })
  await assertNoHorizontalOverflow(page)
  await expect(page.getByRole("heading", { name: /create stock orders/i })).toBeVisible()
  await expect(page.locator("body")).toContainText(/Sales SKU gives the approved commercial spec/i)
  await page.getByRole("combobox", { name: "Sales SKU", exact: true }).click()
  await page.getByRole("option", { name: new RegExp(proof.dryfruit.sku_code, "i") }).click()
  await page.getByRole("combobox", { name: "Sales SKU variant", exact: true }).click()
  await page.getByRole("option", { name: /DRYFRUIT-200X200/i }).click()
  await expect(page.locator("body")).toContainText(proof.dryfruit.template_name)
  await expect(page.locator("body")).toContainText(/Route start/i)
  await expect(page.locator("body")).toContainText(/Route stop/i)
  await expect(page.locator("body")).toContainText(/kg/i)
  await expect(page.locator("body")).toContainText(/pcs/i)

  const plannerApi = await fetchJson<any>(page, "/api/production/planner/control-hub/")
  expect(plannerApi.status).toBe(200)
  expect(Array.isArray(plannerApi.data?.orders)).toBe(true)

  await page.goto("/production/planner", { waitUntil: "domcontentloaded" })
  await assertHealthyPage(page)
  await page.getByTestId("planner-control-tower-page").waitFor({ state: "visible", timeout: 30_000 })
  await page.getByTestId("planner-status-ribbon").waitFor({ state: "visible", timeout: 30_000 })
  await assertNoHorizontalOverflow(page)
  await expect(page.locator("body")).toContainText(/Planner Operating Desk/i)
  await page.getByRole("tab", { name: /In Production/i }).click()
  await expect(page.locator("body")).toContainText(proof.dryfruit.sales_orders.wip.sales_order_number)
  await expect(page.locator("body")).toContainText(proof.dryfruit.sales_orders.fresh.sales_order_number)

  await page.goto(`/production/machine/${proof.machine_history.machine_id}`, { waitUntil: "domcontentloaded" })
  await assertHealthyPage(page)
  await page.getByTestId("machine-execution-page").waitFor({ state: "visible", timeout: 30_000 })
  await page.getByRole("tab", { name: /Past Jobs/i }).click()
  await expect(page.locator("body")).toContainText(/Machine History/i)
  await expect(page.locator("body")).toContainText(String(proof.machine_history.summary.jobs_completed))
  await expect(page.locator("body")).toContainText(proof.machine_history.summary.produced_kg.toFixed(2))
  await expect(page.locator("body")).toContainText(proof.machine_history.completed_job_number)

  const historyApi = await fetchJson<any>(page, `/api/production/machine/${proof.machine_history.machine_id}/history/?status=ALL`)
  expect(historyApi.status).toBe(200)
  expect(Number(historyApi.data?.summary?.jobs_completed || 0)).toBe(proof.machine_history.summary.jobs_completed)
  expect(Number(historyApi.data?.summary?.produced_kg || 0)).toBe(proof.machine_history.summary.produced_kg)
})
