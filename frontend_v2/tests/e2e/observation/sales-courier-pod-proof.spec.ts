import { expect, test } from "../support/base"
import {
  annotate,
  assertHealthyPage,
  fetchJson,
  loginViaUi,
  readRuntimeJson,
  selectByTestId,
  switchRole,
  unwrapApiList,
  writeRuntimeJson,
} from "../support/test-helpers"

type SalesSeed = {
  customer_name?: string
}

function safeNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

test("sales courier bag 2 POD proof flows from catalog to create to production handoff", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Sales",
    severity: "critical",
    role: "SALES",
    feature: "Courier bag 2 POD proof",
    expected:
      "A new 3-layer POD-enabled sales SKU variant should be visible in catalog, orderable from fast-entry UI, visible in the sales queue, and confirmable into production without losing technical truth.",
  })

  const seed = readRuntimeJson<SalesSeed>("sales-seed.json") || {}
  const runTag = `${Date.now()}`
  const skuCode = `COURIER-BAG-2-${runTag}`
  const variantCode = `CB2-3L-POD-${runTag}`
  const variantName = `Courier Bag 2 POD ${runTag}`
  const orderName = `Courier Bag 2 Sales ${runTag}`

  await loginViaUi(page)
  await switchRole(page, "Sales", "/sales/orders", { allowCookieFallback: true })

  const templates = unwrapApiList<any>((await fetchJson(page, "/api/templates/?status=LIVE")).data)
  const template = templates.find((row) => /courier bags/i.test(String(row.name || "")))
  expect(template).toBeTruthy()

  const filmFamilies = unwrapApiList<any>((await fetchJson(page, "/api/master/film-families/")).data)
  const filmVariants = unwrapApiList<any>((await fetchJson(page, "/api/master/film-variants/")).data)
  const packagingMaterials = unwrapApiList<any>((await fetchJson(page, "/api/master/packaging/")).data)
  const podVariants = unwrapApiList<any>((await fetchJson(page, "/api/master/pod-sku-variants/?active=true")).data)

  const petFamily = filmFamilies.find((row) => /UAT-GREEN-PET/i.test(String(row.code || ""))) || filmFamilies[0]
  const peFamily = filmFamilies.find((row) => /UAT-GREEN-PE/i.test(String(row.code || ""))) || filmFamilies[1] || filmFamilies[0]
  const petVariant = filmVariants.find((row) => /UAT-GREEN-PET-12/i.test(String(row.code || ""))) || filmVariants.find((row) => String(row.parent_family?.id || row.parent_family || "") === String(petFamily?.id || ""))
  const peVariant = filmVariants.find((row) => /UAT-GREEN-PE-40/i.test(String(row.code || ""))) || filmVariants.find((row) => String(row.parent_family?.id || row.parent_family || "") === String(peFamily?.id || ""))
  const podVariant = podVariants.find((row) => /POD/i.test(String(row.code || row.name || ""))) || podVariants[0]
  expect(petFamily && peFamily && petVariant && peVariant && podVariant).toBeTruthy()

  const skuCreate = await fetchJson<any>(page, "/api/sales/sku-catalog/", {
    method: "POST",
    body: {
      code: skuCode,
      name: `Courier Bag 2 ${runTag}`,
      template: template.id,
      default_line_name: "Courier Bag 2",
      active: true,
    },
  })
  expect(skuCreate.status).toBe(201)

  const variantCreate = await fetchJson<any>(page, "/api/sales/sku-variants/", {
    method: "POST",
    body: {
      sku: skuCreate.data.id,
      code: variantCode,
      name: variantName,
      active: true,
      finished_good_type: "POUCH",
      geometry_snapshot: {
        base: { width_mm: 260, height_mm: 360 },
        adjustments: [],
        multipliers: { faces: 1 },
      },
      layer_snapshot: [
        { family_id: String(petFamily.id), variant_id: String(petVariant.id), thickness_micron: 12, roll_width_mm: 305 },
        { family_id: String(petFamily.id), variant_id: String(petVariant.id), thickness_micron: 12, roll_width_mm: 305 },
        { family_id: String(peFamily.id), variant_id: String(peVariant.id), thickness_micron: 40, roll_width_mm: 305 },
      ],
      printing_snapshot: {
        enabled: true,
        type: "ROTO",
        substrate_mode: "SHEET",
        front_colors_count: 4,
        back_colors_count: 1,
        ink_gsm_total: 1.8,
        artwork_id: "",
        defer_artwork_to_planner: true,
        chemicals: {
          adhesive_gsm: 2.1,
          solvent_gsm: 0.4,
        },
      },
      chemicals_snapshot: {
        adhesive_gsm: 2.1,
        solvent_gsm: 0.4,
      },
      addons_snapshot: [],
      packaging_snapshot: {
        primary_inner_pack: packagingMaterials[0]
          ? {
              enabled: true,
              material_id: String(packagingMaterials[0].id),
              pcs_per_pack: 25,
            }
          : {
              enabled: false,
              material_id: "",
              pcs_per_pack: 100,
            },
        pod: {
          enabled: true,
          pod_profile_id: String(podVariant.material || ""),
          pod_sku_variant_id: String(podVariant.id),
          pod_sku_code: String(podVariant.code || ""),
          pod_sku_name: String(podVariant.name || ""),
        },
        roll_dispatch_pack: {
          enabled: false,
          lines: [],
        },
      },
    },
  })
  expect(variantCreate.status).toBe(201)

  await page.goto("/sales/sku-catalog")
  await assertHealthyPage(page)
  await page.getByTestId("sales-sku-catalog-page").waitFor({ state: "visible", timeout: 30_000 })
  await page.getByTestId("sales-sku-search").fill(skuCode)
  await expect(page.locator("body")).toContainText(skuCode)
  await expect(page.locator("body")).toContainText(variantName)
  await expect(page.locator("body")).toContainText("POD enabled")
  await expect(page.locator("body")).toContainText("3 layer(s)")

  await page.goto("/sales/orders/create")
  await assertHealthyPage(page)
  await page.getByTestId("sales-order-batch-workspace").waitFor({ state: "visible", timeout: 30_000 })
  await selectByTestId(page, "sales-batch-customer", new RegExp(seed.customer_name || "UAT-GREEN Sales Customer", "i"))
  await selectByTestId(page, "sales-batch-shared-sku", new RegExp(skuCode, "i"))
  await selectByTestId(page, "sales-batch-shared-variant", new RegExp(variantName, "i"))
  await page.getByTestId("sales-batch-shared-add").click()
  await expect(page.getByTestId("sales-batch-queue-count")).toHaveText("1")
  await page.getByTestId("sales-batch-order-name").fill(orderName)
  await page.getByTestId("sales-batch-unit-price").fill("12.75")
  await page.getByTestId("sales-batch-submit").click()
  await expect(page.locator("body")).toContainText(/Created SO\d+/i, { timeout: 30_000 })

  const orders = unwrapApiList<any>((await fetchJson(page, "/api/sales/orders/")).data)
  const createdOrder = orders.find((row) => String(row.order_name || "") === orderName)
  expect(createdOrder).toBeTruthy()
  expect(String(createdOrder.item_summary?.variant_code || "")).toContain(variantCode)
  expect(safeNumber(createdOrder.item_summary?.layer_count)).toBe(3)
  expect(Boolean(createdOrder.item_summary?.pod_enabled)).toBeTruthy()
  expect(["PLANNING_REQUIRED", "PLANNED", "RELEASED", "PACKING_READY", "DISPATCH_READY", "COMPLETED"]).toContain(String(createdOrder.status || ""))

  await page.goto("/sales/orders")
  await assertHealthyPage(page)
  await expect(page.locator("body")).toContainText(createdOrder.order_number)
  await expect(page.locator("body")).toContainText(variantCode)
  await expect(page.locator("body")).toContainText("TPL")
  await expect(page.locator("body")).toContainText("UAT-GREEN-PET-12")
  await expect(page.locator("body")).toContainText("UAT-GREEN-PE-40")
  await expect(page.locator("body")).toContainText("POD")
  await expect(page.locator("body")).toContainText("Remaining")
  await expect(page.getByRole("button", { name: /completed orders/i })).toBeVisible()

  await page.goto(`/sales/orders/${createdOrder.id}/tracking`)
  await assertHealthyPage(page)
  await expect(page.locator("body")).toContainText(createdOrder.order_number)
  await expect(page.locator("body")).toContainText(/fulfillment truth/i)
  await expect(page.getByRole("tab", { name: /jobs/i })).toBeVisible()
  await expect(page.locator("body")).toContainText(/work center|no active jobs/i)

  const plannerPayload = await fetchJson<any>(page, "/api/production/planner/control-hub/")
  expect(plannerPayload.status).toBe(200)
  expect(JSON.stringify(plannerPayload.data)).toContain(createdOrder.order_number)

  writeRuntimeJson("sales-courier-pod-proof.json", {
    run_tag: runTag,
    sku_code: skuCode,
    variant_code: variantCode,
    sales_order_id: createdOrder.id,
    sales_order_number: createdOrder.order_number,
  })
})
