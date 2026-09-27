"use client";

import { ReportTabPage } from "@/components/analytics/report-tab-page";

export default function InventoryLineageReportPage() {
  return (
    <ReportTabPage
      tab="inventory-lineage"
      title="Inventory Lineage"
      description="Trace inventory movement and stage evidence for the selected scope."
      accent="emerald"
    />
  );
}
