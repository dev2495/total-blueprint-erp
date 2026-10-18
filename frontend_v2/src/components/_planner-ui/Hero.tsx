import { ReactNode } from "react";
import { Card } from "./Card";
import { KPI } from "./KPI";

type HeroVariant = "brand" | "admin";

interface HeroKPI {
  eyebrow: string;
  value: ReactNode;
  sub?: string;
  accent?: "default" | "success" | "warn" | "danger" | "info";
}

interface HeroProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  variant?: HeroVariant;
  actions?: ReactNode;          // a flexbox row of buttons
  kpis?: HeroKPI[];             // rendered as quiet tiles inside the hero
  className?: string;
}

const ACCENT_NUM: Record<NonNullable<HeroKPI["accent"]>, string> = {
  default: "var(--text-1)",
  success: "var(--success-fg)",
  warn: "var(--warning-fg)",
  danger: "var(--danger-fg)",
  info: "var(--info-fg)",
};

/**
 * Hero — the always-on page header. Exactly ONE per page.
 *
 * <Hero
 *    eyebrow="Owner dashboard"
 *    title="Good evening, Devarsh"
 *    subtitle="Tuesday, 27 Apr · 4 plants online"
 *    actions={<><Button variant="ghost">Today ▾</Button><Button>Export →</Button></>}
 *    kpis={[
 *      { eyebrow: "Sales pipeline", value: "₹84.2L", sub: "128 active orders" },
 *      { eyebrow: "On-time", value: "94%", sub: "42 shipped this wk", accent: "success" },
 *    ]}
 * />
 *
 * Both variants render the same calm white header card; "admin" is kept for
 * the admin pages' API and reads identically.
 *
 * The page title MUST live inside <Hero title=>, never raw <h1>.
 */
export function Hero({
  eyebrow,
  title,
  subtitle,
  variant = "brand",
  actions,
  kpis,
  className = "",
}: HeroProps) {
  return (
    <Card variant={variant === "admin" ? "hero-admin" : "hero"} className={`mb-5 ${className}`}>
      <div style={{ position: "relative" }}>
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            {eyebrow && (
              <div className="t-eyebrow" style={{ color: "var(--text-3)", textTransform: "none", letterSpacing: 0, fontWeight: 500, fontSize: 12.5 }}>
                {eyebrow}
              </div>
            )}
            <h1 className="t-display-md" style={{ color: "var(--text-1)", marginTop: 4 }}>
              {title}
            </h1>
            {subtitle && (
              <p style={{ color: "var(--text-3)", fontSize: 13.5, lineHeight: 1.5, marginTop: 6, maxWidth: 560 }}>
                {subtitle}
              </p>
            )}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>

        {kpis && kpis.length > 0 && (
          <div
            className={`grid gap-2 mt-4`}
            style={{
              gridTemplateColumns: `repeat(auto-fit, minmax(${kpis.length >= 7 ? "140px" : "160px"}, 1fr))`,
            }}
          >
            {kpis.map((k, i) => (
              <div key={i} className="ds-glass">
                <div className="ds-glass-eyebrow">{k.eyebrow}</div>
                <div
                  className="ds-glass-num"
                  style={{ color: ACCENT_NUM[k.accent ?? "default"] }}
                >
                  {k.value}
                </div>
                {k.sub && (
                  <div className="ds-glass-sub" style={{ color: "var(--text-3)" }}>
                    {k.sub}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

export default Hero;
