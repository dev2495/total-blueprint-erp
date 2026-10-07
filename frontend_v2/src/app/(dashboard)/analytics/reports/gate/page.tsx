"use client";

import { ReportTabPage } from "@/components/analytics/report-tab-page";
import { useAuth } from "@/components/auth-provider";
import { canViewGateReports } from "@/components/gate/gate-access";

export default function GateReportPage() {
  const { user, effectiveRole } = useAuth();
  // Owner or an explicit gate.reports grant only; the API enforces the same rule.
  if (user && !canViewGateReports(user, effectiveRole)) {
    return (
      <div className="mx-auto mt-10 max-w-[480px] rounded-3xl border border-line bg-surface-1 p-6 text-center">
        <h1 className="text-lg font-semibold text-content-1">Gate report not assigned</h1>
        <p className="mt-2 text-sm text-content-3">Ask the owner to grant the Gate reports pack (gate.reports) to your account.</p>
      </div>
    );
  }
  return (
    <ReportTabPage
      tab="gate"
      title="Gate Register"
      description="Inward and outward vehicles from the watchman register, checked against ERP documents. Visitor figures are counts only — no personal details."
      accent="sky"
    />
  );
}
