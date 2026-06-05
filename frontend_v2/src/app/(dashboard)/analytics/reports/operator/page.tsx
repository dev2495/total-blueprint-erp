"use client";

import { ReportTabPage } from "@/components/analytics/report-tab-page";

export default function OperatorReportPage() {
  return (
    <ReportTabPage
      tab="operator"
      title="Operator Performance"
      description="Operator output, efficiency, completion, and scrap contribution in one filterable performance board."
      accent="emerald"
    />
  );
}
