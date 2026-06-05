"use client";

import { ReportTabPage } from "@/components/analytics/report-tab-page";

export default function InventoryReportPage() {
  return (
    <ReportTabPage
      tab="inventory"
      title="Inventory Health"
      description="Family, variant, stage, aging, and roll-level stock posture with date and plant filters."
      accent="cyan"
    />
  );
}
