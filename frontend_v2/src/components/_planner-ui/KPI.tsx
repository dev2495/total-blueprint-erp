import { ReactNode } from "react";

type KPIAccent = "default" | "success" | "warn" | "danger" | "info";

interface KPIProps {
  eyebrow: string;
  value: ReactNode;       // e.g. "₹84.2L" or <>94<small>%</small></>
  sub?: string;
  accent?: KPIAccent;
  className?: string;
}

/**
 * KPI tile — the workhorse of every dashboard.
 *
 * <KPI eyebrow="Sales pipeline" value="₹84.2L" sub="128 active orders" />
 * <KPI eyebrow="Overdue" value="5" sub=">2d past due" accent="warn" />
 *
 * `value` is a ReactNode so you can pass <>94<small>%</small></> for unit suffix styling.
 * The number renders in Fraunces serif automatically.
 */
export function KPI({ eyebrow, value, sub, accent = "default", className = "" }: KPIProps) {
  const accentClass = accent !== "default" ? `k-${accent}` : "";
  return (
    <div className={`ds-kpi ${accentClass} ${className}`.trim()}>
      <div className="ds-kpi-eyebrow">{eyebrow}</div>
      <div className="ds-kpi-num">{value}</div>
      {sub && <div className="ds-kpi-sub">{sub}</div>}
    </div>
  );
}

export default KPI;
