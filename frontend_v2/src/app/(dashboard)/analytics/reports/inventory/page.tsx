"use client"

import { ReportTabPage } from "@/components/analytics/report-tab-page"

export default function InventoryReportPage() {
  return (
    <ReportTabPage
      tab="inventory"
      title="Inventory Health"
      description="Aging, stage mix, material concentration, and location spread with date and plant filters."
      accent="cyan"
    />
  )
}
