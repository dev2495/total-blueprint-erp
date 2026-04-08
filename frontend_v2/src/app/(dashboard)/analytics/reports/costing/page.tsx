"use client"

import { ReportTabPage } from "@/components/analytics/report-tab-page"

export default function CostingReportPage() {
  return (
    <ReportTabPage
      tab="costing"
      title="Costing & Profitability"
      description="Production cost, margin, overhead, and customer profitability made readable for daily review."
      accent="amber"
    />
  )
}
