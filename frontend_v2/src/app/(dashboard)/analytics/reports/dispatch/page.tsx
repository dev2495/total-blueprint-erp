"use client"

import { ReportTabPage } from "@/components/analytics/report-tab-page"

export default function DispatchReportPage() {
  return (
    <ReportTabPage
      tab="dispatch"
      title="Dispatch & Logistics"
      description="Dispatch pipeline, customer movement, challan weight, and fulfillment flow on one report surface."
      accent="cyan"
    />
  )
}
