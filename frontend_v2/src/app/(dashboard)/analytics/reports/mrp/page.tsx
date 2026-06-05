"use client";

import { ReportTabPage } from "@/components/analytics/report-tab-page";

export default function MrpReportPage() {
  return (
    <ReportTabPage
      tab="mrp"
      title="MRP & Consumption Variance"
      description="Theory vs required vs issue vs actual consumption, with material and job variance clearly surfaced."
      accent="amber"
    />
  );
}
