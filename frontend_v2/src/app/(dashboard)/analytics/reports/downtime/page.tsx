"use client";

import { ReportTabPage } from "@/components/analytics/report-tab-page";

export default function DowntimeReportPage() {
  return (
    <ReportTabPage
      tab="downtime"
      title="Downtime Analysis"
      description="Time-loss truth with daily, weekly, and custom filters across plant, process, and shift."
      accent="amber"
    />
  );
}
