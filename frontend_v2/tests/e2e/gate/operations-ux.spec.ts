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

  await page.goto("/inventory/roll-explorer")
  await assertHealthyPage(page)
  await expect(page.locator("body")).toContainText("Family Contribution")
  await expect(page.locator("body")).toContainText("Stage Mix")
  await expect(page.locator("body")).toContainText("Source Mix")

  await switchRole(page, "Store", "/inventory/roll-explorer")
  await page.goto("/inventory/bulk")
  await assertHealthyPage(page)
  await expect(page.locator("body")).toContainText("Bulk Inventory")
  await expect(page.locator("body")).not.toContainText("Operations Surface")
  await expect(page.locator("body")).toContainText("Category Mass Split")
  await expect(page.locator("body")).toContainText("Plant Allocation")

  await page.goto("/inventory/packaging")
  await assertHealthyPage(page)
  await expect(page.locator("body")).toContainText("Packaging Inventory")
  await expect(page.locator("body")).not.toContainText("Operations Surface")
  await expect(page.locator("body")).toContainText("Stock by Packaging Kind")
  await expect(page.locator("body")).toContainText("Movement Mix")

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

  await switchRole(page, "Dispatch", "/dashboard/logistics")
  await page.goto("/logistics/packing")
  await assertHealthyPage(page)
  await expect(page.locator("body")).toContainText("Net Product Weight")
  await expect(page.locator("body")).toContainText("Gross Shipment Weight")

  await page.goto("/logistics/dispatch")
  await assertHealthyPage(page)
  await expect(page.locator("body")).toContainText("Dispatch Bay")
  await expect(page.locator("body")).toContainText("Target Sales Order")
  await expect(page.locator("body")).toContainText("Dispatch Ledger")

  await page.goto("/logistics/transit")
  await assertHealthyPage(page)
  await expect(page.locator("body")).toContainText("Transit Tracking")
  await expect(page.locator("body")).toContainText("Outbound lane board")
  await expect(page.locator("body")).toContainText("Telemetry rollout note")

  await switchRole(page, "Engineering", "/engineering/artworks")
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
  await expect(page.locator("body")).toContainText("Linked Production Template")
})
