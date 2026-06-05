"use client";

import { ReportTabPage } from "@/components/analytics/report-tab-page";

export default function ProductionReportPage() {
  return (
    <ReportTabPage
      tab="production"
      title="Production Performance"
      description="Daily, weekly, or custom production truth with throughput, yield, process split, and row-level detail."
      accent="indigo"
    />
  );
}
