"use client";

import { ReportTabPage } from "@/components/analytics/report-tab-page";
import { useAuth } from "@/components/auth-provider";
import { canViewGateReports } from "@/components/gate/gate-access";

export default function GateReportPage() {
  const { user, effectiveRole } = useAuth();
  // Admin/Owner (actual role or flag, any non-watchman preview) or an explicit
  // gate.reports grant; the API enforces the same rule.
  if (user && !canViewGateReports(user, effectiveRole)) {
    return (
      <div className="mx-auto mt-10 max-w-[480px] rounded-3xl border border-line bg-surface-1 p-6 text-center">
        <h1 className="text-lg font-semibold text-content-1">Gate report not available for this account</h1>
        <p className="mt-2 text-sm text-content-3">
          Administrators and owners have the Gate report by default. Other users need the Gate reports pack (gate.reports) granted by an
          administrator or owner in User Management. Watchman accounts use the gate terminal only.
        </p>
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
