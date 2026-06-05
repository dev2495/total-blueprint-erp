"use client";

import { ReportTabPage } from "@/components/analytics/report-tab-page";

export default function SalesReportPage() {
  return (
    <ReportTabPage
      tab="sales"
      title="Sales Fulfillment"
      description="Backlog, OTIF, pipeline, customers, and SKU demand truth with dense report-grade visibility."
      accent="indigo"
    />
  );
}
