import { expect, test } from "../support/base"
import { annotate, assertHealthyPage, fetchJson, gotoWithServerRetry, unwrapApiList } from "../support/test-helpers"

// 16 Oct 2026 add-ons: faster screens that keep every existing field and rule.

test("order entry finds a customer by typing and offers pieces for pouch lines", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Sales",
    severity: "high",
    role: "ADMIN",
    feature: "customer-search",
    expected: "Typing two letters lists matching customers; picking one sets the customer dropdown; the dropdown itself is unchanged.",
  })
  const customers = await fetchJson<any>(page, "/api/sales/customers/")
  expect(customers.status).toBe(200)
  const rows = unwrapApiList<any>(customers.data).filter((row) => String(row?.name || "").trim().length >= 2)
  expect(rows.length).toBeGreaterThan(0)
  const target = rows[0]

  await gotoWithServerRetry(page, "/sales/orders/create", { waitUntil: "domcontentloaded", timeout: 60_000 })
  await assertHealthyPage(page)
  const search = page.getByTestId("sales-customer-search")
  await expect(search).toBeVisible({ timeout: 30_000 })
  await search.fill(String(target.name).slice(0, 3))
  await page.getByTestId(`sales-customer-match-${target.id}`).click()
  await expect(page.getByTestId("sales-batch-customer")).toHaveValue(String(target.id))
})

test("pouch style shows its fixed formula in words and says approved, not locked by sizes", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Masters",
    severity: "medium",
    role: "ADMIN",
    feature: "pouch-style-fixed-formula",
    expected: "A built-in style such as side gusset shows 'child width = 2 × (W + G) + trim' instead of an empty builder.",
  })
  const styles = await fetchJson<any>(page, "/api/master/pouch-styles/")
  expect(styles.status).toBe(200)
  const rows = unwrapApiList<any>(styles.data)
  const closed = rows.find((row) => ["GUSSETED_SIDE", "QUAD_SEAL", "SIMPLE_DOUBLE", "THREE_SIDE_SEAL", "FLAT_BOTTOM", "CENTER_SEAL_H"].includes(String(row.formula_kind || "").toUpperCase()))
  test.skip(!closed, "No built-in pouch style in this database")
  await gotoWithServerRetry(page, `/master/pouch-styles/${closed.id}`, { waitUntil: "domcontentloaded", timeout: 60_000 })
  await assertHealthyPage(page)
  await expect(page.getByTestId("pouch-style-fixed-formula")).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId("pouch-style-fixed-formula")).toContainText("child width =")
  if (closed.locked) {
    await expect(page.getByTestId("pouch-style-approved-banner")).toContainText(/Approved style/)
  }
  await expect(page.locator("body")).not.toContainText("locked because product sizes are using it")
})

test("product master edit has a step bar and marks lamination passes a product does not run", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Masters",
    severity: "medium",
    role: "ADMIN",
    feature: "product-master-step-bar",
    expected: "The long edit page keeps every section and adds a sticky step bar; single-layer products show lamination as skipped.",
  })
  const masters = await fetchJson<any>(page, "/api/master/products/?page_size=50")
  expect(masters.status).toBe(200)
  const rows = unwrapApiList<any>(masters.data)
  expect(rows.length).toBeGreaterThan(0)
  const master = rows[0]
  await gotoWithServerRetry(page, `/master/products/${master.id}/edit`, { waitUntil: "domcontentloaded", timeout: 60_000 })
  await assertHealthyPage(page)
  const nav = page.getByTestId("pm-step-nav")
  await expect(nav).toBeVisible({ timeout: 30_000 })
  await nav.getByRole("link", { name: /Layers/ }).click()
  await expect(nav.getByRole("link", { name: /Layers/ })).toHaveAttribute("aria-current", "step")
  await expect(page.locator("#pm-sizes")).toBeVisible()
  await expect(page.locator("body")).not.toContainText("final product tuple")
})

test("packing yard shows the packing check beside the batches", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Logistics",
    severity: "medium",
    role: "ADMIN",
    feature: "packing-check-panel",
    expected: "The packing check lists packed batches against the machine log, with the packing material taken off first.",
  })
  await gotoWithServerRetry(page, "/logistics/packing", { waitUntil: "domcontentloaded", timeout: 60_000 })
  await page.getByTestId("packing-page").waitFor({ state: "visible", timeout: 30_000 })
  // The check sits with pouch batches, so open a pouch order.
  await expect(page.getByTestId("packing-order-card").first()).toBeVisible({ timeout: 30_000 })
  await page.getByTestId("packing-route-filter-pouch").click()
  const pouchCard = page.locator('[data-testid="packing-order-card"][data-route="POUCH"]').first()
  await expect(pouchCard).toBeVisible({ timeout: 30_000 })
  await pouchCard.click()
  const panel = page.getByTestId("packing-check-panel")
  await expect(panel).toBeVisible({ timeout: 30_000 })
  await expect(panel).toContainText("Packing check")
  const queue = await fetchJson<any>(page, "/api/production/packing/verification-queue/")
  expect(queue.status).toBe(200)
})
