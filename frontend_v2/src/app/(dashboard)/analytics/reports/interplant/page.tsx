"use client";

import { ReportTabPage } from "@/components/analytics/report-tab-page";

export default function InterplantReportPage() {
  return (
    <ReportTabPage
      tab="interplant"
      title="Inter-Plant Logistics"
      description="Transit truth across challans, output rolls, remainder rolls, and receiving status with audit-ready drilldown."
      accent="cyan"
    />
  );
}
