"use client"

import { ReportTabPage } from "@/components/analytics/report-tab-page"

export default function OeeReportPage() {
  return (
    <ReportTabPage
      tab="oee"
      title="OEE Deep Dive"
      description="Availability, performance, quality, machine spread, and trend detail in one operator-ready surface."
      accent="emerald"
    />
  )
}
