import { test, expect } from "../support/base"
import { annotate, assertHealthyPage, fetchBinaryMeta, fetchJson, selectByTestId, switchRole, unwrapApiList } from "../support/test-helpers"
import { readMutationSeed } from "../support/mutation-seed"

function findInterplantChallan(rows: any[], rollLabel: string) {
  return rows.find((row) =>
    Array.isArray(row?.item_preview) && row.item_preview.some((item: any) => String(item.roll_label || "") === rollLabel),
  )
}

test("store can create, dispatch, receive, and print an inter-plant challan for a seeded roll", async ({ page }, testInfo) => {
  annotate(testInfo, {
    module: "Inter-Plant",
    severity: "critical",
    role: "STORE",
    feature: "Inter-plant challan lifecycle",
    expected: "Store should be able to move a seeded roll across plants through create, dispatch, receive, and PDF print without losing state integrity.",
  })

  const seed = readMutationSeed()

  await page.goto("/dashboard/admin")
  await switchRole(page, "Store", "/inventory/roll-explorer")
  await page.goto("/inventory/inter-plant")
  await page.getByTestId("interplant-page").waitFor({ state: "visible", timeout: 30_000 })
  await assertHealthyPage(page)

  await page.getByTestId("interplant-new-transfer").click()
  await selectByTestId(page, "interplant-from-plant", seed.interplant.from_plant_name)
  await selectByTestId(page, "interplant-to-plant", seed.interplant.to_plant_name)
  await selectByTestId(page, "interplant-transfer-mode", /rolls/i)
  await selectByTestId(page, "interplant-source-location", /warehouse/i)
  await selectByTestId(page, "interplant-destination-location", seed.interplant.destination_location_name)
  await page.getByTestId(`interplant-create-roll-${seed.interplant.roll_id}`).click()
  await page.getByTestId("interplant-create-submit").click()

  await page.waitForTimeout(1000)
  const createdResponse = await fetchJson<any>(page, "/api/inventory/inter-plant/")
  expect(createdResponse.status).toBe(200)
  const challans = unwrapApiList<any>(createdResponse.data)
  const challan = findInterplantChallan(challans, seed.interplant.roll_label)
  expect(challan).toBeTruthy()
  const initialStatus = String(challan?.status || "").toUpperCase()
  expect(["DRAFT", "IN_TRANSIT"]).toContain(initialStatus)

  if (initialStatus === "DRAFT") {
    await page.getByTestId(`interplant-dispatch-trigger-${challan.id}`).click()
    await page.getByTestId(`interplant-dispatch-roll-${challan.id}-${seed.interplant.roll_id}`).click()
    await page.getByTestId(`interplant-dispatch-submit-${challan.id}`).click()
  }

  await page.waitForTimeout(1000)
  await page.getByTestId(`interplant-receive-trigger-${challan.id}`).click()
  await selectByTestId(page, `interplant-receive-location-${challan.id}`, seed.interplant.destination_location_name)
  await page.getByTestId(`interplant-receive-submit-${challan.id}`).click()

  await page.waitForTimeout(1000)
  const receivedResponse = await fetchJson<any>(page, "/api/inventory/inter-plant/")
  expect(receivedResponse.status).toBe(200)
  const receivedChallan = findInterplantChallan(unwrapApiList<any>(receivedResponse.data), seed.interplant.roll_label)
  expect(String(receivedChallan?.status || "").toUpperCase()).toBe("RECEIVED")

  const pdf = await fetchBinaryMeta(page, `/api/inventory/inter-plant/${challan.id}/print-pdf/`)
  expect(pdf.status).toBe(200)
  expect(pdf.contentType).toContain("application/pdf")
  expect(pdf.byteLength).toBeGreaterThan(1000)
})
