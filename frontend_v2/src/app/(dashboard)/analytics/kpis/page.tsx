"use client";

import { ExecutiveDeck } from "@/components/dashboard/executive-deck";

/** Company-wide KPIs: the same live executive deck, under an analytics title. */
export default function KpiDashboardPage() {
  return <ExecutiveDeck eyebrow="Analytics · KPIs" title="Executive Control Center" testId="kpi-dashboard" />;
}
