import { test, expect } from "../support/base"
import { annotate, assertHealthyPage, switchRole } from "../support/test-helpers"

test("inventory, logistics, artwork, cylinder, and tooling pages use the upgraded visual shell", async ({ page }, testInfo) => {
  test.slow()
  annotate(testInfo, {
    module: "Operations UX",
    severity: "high",
    role: "ADMIN",
    feature: "Inventory and tooling visual system",
    expected: "Core inventory, logistics, artwork, cylinder, and tooling pages should render readable KPI-first layouts with clear next actions.",
  })

  await page.goto("/inventory/rolls-v36")
  await assertHealthyPage(page)
  await expect(page.locator("body")).toContainText("Roll workspace")
  await expect(page.locator("body")).toContainText("Variant × thickness matrix")
  await expect(page.locator("body")).toContainText("Analytics first")

  await switchRole(page, "Store", "/inventory/rolls-v36", { allowCookieFallback: true })
  await page.goto("/inventory/bulk-v36")
  await assertHealthyPage(page)
  await expect(page.locator("body")).toContainText("Bulk & chemicals")
  await expect(page.locator("body")).not.toContainText("Operations Surface")
  await expect(page.locator("body")).toContainText("Material class · KG")
  await expect(page.locator("body")).toContainText("Plant allocation")

  await page.goto("/inventory/packaging-v36")
  await assertHealthyPage(page)
  await expect(page.locator("body")).toContainText("Packaging materials")
  await expect(page.locator("body")).not.toContainText("Operations Surface")
  await expect(page.locator("body")).toContainText("Mix · by kind")
  await expect(page.locator("body")).toContainText("EOD packing count")

  await page.goto("/inventory/alerts")
  await assertHealthyPage(page)
  await expect(page.locator("body")).toContainText("Alerts Center")
  await expect(page.locator("body")).toContainText("Severity mix")
  await expect(page.locator("body")).toContainText("Alert queue")

  await page.goto("/inventory/movements")
  await assertHealthyPage(page)
  await expect(page.locator("body")).toContainText("Roll Movements")
  await expect(page.locator("body")).toContainText("Movement mix")
  await expect(page.locator("body")).toContainText("Movement ledger")

  await page.goto("/analytics/inventory-history")
  await assertHealthyPage(page)
  await expect(page.locator("body")).toContainText("Inventory Snapshot History")
  await expect(page.locator("body")).toContainText("Inventory snapshot rhythm")
  await expect(page.locator("body")).toContainText("Snapshot ledger")

  await switchRole(page, "Dispatch", "/dashboard/logistics", { allowCookieFallback: true })
  await page.goto("/logistics/packing")
  await assertHealthyPage(page)
  await expect(page.locator("body")).toContainText("Packing Yard")
  await expect(page.locator("body")).toContainText("Pouch in-progress")
  await expect(page.locator("body")).toContainText("Released unpacked")

  await page.goto("/logistics/dispatch")
  await assertHealthyPage(page)
  await expect(page.locator("body")).toContainText("Dispatch Bay")
  await expect(page.locator("body")).toContainText("Trip builder")
  await expect(page.locator("body")).toContainText("Dispatch history")

  await page.goto("/logistics/transit")
  await assertHealthyPage(page)
  await expect(page.locator("body")).toContainText("Transit Tracking")
  await expect(page.locator("body")).toContainText("Outbound lane board")
  await expect(page.locator("body")).toContainText("Telemetry rollout note")

  await switchRole(page, "Engineering", "/engineering/artworks", { allowCookieFallback: true })
  await page.goto("/engineering/artworks")
  await assertHealthyPage(page)
  await expect(page.locator("body")).toContainText("Artwork")

  await page.goto("/engineering/cylinders")
  await assertHealthyPage(page)
  await expect(page.locator("body")).toContainText("Cylinder Catalog")
  await expect(page.locator("body")).toContainText("Production Ready")

  await page.goto("/engineering/tooling")
  await assertHealthyPage(page)
  await expect(page.locator("body")).toContainText("Tool Room")
  await expect(page.locator("body")).toContainText("Tracked Tools")

  await page.goto("/master/packaging")
  await assertHealthyPage(page)
  await expect(page.locator("body")).toContainText("Packaging Master")
  await expect(page.locator("body")).toContainText("Product Master Link")
  await expect(page.locator("body")).toContainText("Unlinked In-House")
})
