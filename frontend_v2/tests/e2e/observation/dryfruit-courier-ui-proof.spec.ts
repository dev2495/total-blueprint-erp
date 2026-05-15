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

  const salesCatalogApi = await fetchJson<any>(page, `/api/sales/sku-catalog/?search=${encodeURIComponent(proof.dryfruit.sku_code)}`)
  expect(salesCatalogApi.status).toBe(200)
  expect(JSON.stringify(salesCatalogApi.data)).toContain(proof.dryfruit.sku_code)
  expect(JSON.stringify(salesCatalogApi.data)).toContain(proof.dryfruit.template_name)

  const plannerCatalogApi = await fetchJson<any>(page, `/api/production/planner/sku-catalog/?search=${encodeURIComponent(proof.dryfruit.planner_invariant_sku.sku_code)}`)
  expect(plannerCatalogApi.status).toBe(200)
  expect(JSON.stringify(plannerCatalogApi.data)).toContain(proof.dryfruit.planner_invariant_sku.sku_code)
  expect(JSON.stringify(plannerCatalogApi.data)).toContain(proof.dryfruit.planner_invariant_sku.variant_code)

  await page.goto("/sales/orders/create", { waitUntil: "domcontentloaded" })
  await assertHealthyPage(page)
  await page.getByTestId("sales-order-v34-workspace").waitFor({ state: "visible", timeout: 30_000 })
  await assertNoHorizontalOverflow(page)
  await expect(page.locator("body")).toContainText(/Sales order|Create order/i)
  await expect(page.locator("body")).toContainText(/Product master/i)

  await page.goto("/production/planner/stock-launcher", { waitUntil: "domcontentloaded" })
  await assertHealthyPage(page)
  await assertNoHorizontalOverflow(page)
  await expect(page.getByRole("heading", { name: /planner stock launcher/i })).toBeVisible({ timeout: 30_000 })
  await expect(page.locator("body")).toContainText(/Product Master/i)
  await expect(page.locator("body")).toContainText(/Live BOM|Stock pool/i)
  await expect(page.locator("body")).toContainText(/Route start/i)
  await expect(page.locator("body")).toContainText(/Route stop/i)
  await expect(page.locator("body")).toContainText(/kg/i)
  await expect(page.locator("body")).toContainText(/pcs/i)

  const plannerApi = await fetchJson<any>(page, "/api/production/planner/control-hub/")
  expect(plannerApi.status).toBe(200)
  expect(Array.isArray(plannerApi.data?.orders)).toBe(true)

  await page.goto("/dashboard/planner/control-tower/plan-queue", { waitUntil: "domcontentloaded" })
  await assertHealthyPage(page)
  await assertNoHorizontalOverflow(page)
  await expect(page.getByRole("heading", { name: /Plan Queue/i })).toBeVisible({ timeout: 30_000 })
  expect(JSON.stringify(plannerApi.data)).toContain(proof.dryfruit.sales_orders.wip.sales_order_number)
  expect(JSON.stringify(plannerApi.data)).toContain(proof.dryfruit.sales_orders.fresh.sales_order_number)

  await page.goto(`/production/machine/${proof.machine_history.machine_id}`, { waitUntil: "domcontentloaded" })
  await assertHealthyPage(page)
  await page.getByTestId("machine-execution-page").waitFor({ state: "visible", timeout: 30_000 })
  await page.getByRole("button", { name: /Past Jobs|History/i }).click()
  await expect(page.locator("body")).toContainText(/Machine History/i)
  await expect(page.locator("body")).toContainText(String(proof.machine_history.summary.jobs_completed))
  await expect(page.locator("body")).toContainText(proof.machine_history.summary.produced_kg.toFixed(2))
  await expect(page.locator("body")).toContainText(proof.machine_history.completed_job_number)

  const historyApi = await fetchJson<any>(page, `/api/production/machine/${proof.machine_history.machine_id}/history/?status=ALL`)
  expect(historyApi.status).toBe(200)
  expect(Number(historyApi.data?.summary?.jobs_completed || 0)).toBe(proof.machine_history.summary.jobs_completed)
  expect(Number(historyApi.data?.summary?.produced_kg || 0)).toBe(proof.machine_history.summary.produced_kg)
})
