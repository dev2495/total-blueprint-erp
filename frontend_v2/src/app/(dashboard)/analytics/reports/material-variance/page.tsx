"use client";

import { ReportTabPage } from "@/components/analytics/report-tab-page";

export default function MaterialVarianceReportPage() {
  return (
    <ReportTabPage
      tab="material-variance"
      title="Material Variance"
      description="Compare planned requirements with issued and recorded material usage for the selected scope."
      accent="amber"
    />
  );
}
