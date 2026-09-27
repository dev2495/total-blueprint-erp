"use client";

import { ReportTabPage } from "@/components/analytics/report-tab-page";

export default function ShiftPerformanceReportPage() {
  return (
    <ReportTabPage
      tab="shift-performance"
      title="Shift Performance"
      description="Compare shift output and execution coverage for the selected scope."
      accent="indigo"
    />
  );
}
