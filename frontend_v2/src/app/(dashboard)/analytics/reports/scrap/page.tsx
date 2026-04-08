"use client"

import { ReportTabPage } from "@/components/analytics/report-tab-page"

export default function ScrapReportPage() {
  return (
    <ReportTabPage
      tab="scrap"
      title="Scrap & Yield"
      description="Waste, yield, reasons, operator impact, and cost-of-quality signals with richer drilldown."
      accent="rose"
    />
  )
}
