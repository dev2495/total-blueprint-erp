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
  kpis?: HeroKPI[];             // rendered as glass tiles inside the hero
  className?: string;
}

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
 * Use variant="admin" for the navy admin door. Default is the standard blue brand gradient.
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
              <div className="t-eyebrow" style={{ color: "rgba(255,255,255,.65)" }}>
                {eyebrow}
              </div>
            )}
            <h1 className="t-display-md" style={{ color: "#fff", marginTop: 4 }}>
              {title}
            </h1>
            {subtitle && (
              <p style={{ color: "rgba(255,255,255,.78)", fontSize: 14, marginTop: 8, maxWidth: 560 }}>
                {subtitle}
              </p>
            )}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>

        {kpis && kpis.length > 0 && (
          <div
            className={`grid gap-3 mt-5`}
            style={{
              gridTemplateColumns: `repeat(auto-fit, minmax(${kpis.length >= 7 ? "140px" : "160px"}, 1fr))`,
            }}
          >
            {kpis.map((k, i) => (
              <div key={i} className="ds-glass">
                <div className="ds-glass-eyebrow">{k.eyebrow}</div>
                <div
                  className="ds-glass-num"
                  style={{
                    color:
                      k.accent === "success" ? "#a7f3d0"
                      : k.accent === "warn"  ? "#fde68a"
                      : k.accent === "danger" ? "#fecaca"
                      : "#fff",
                  }}
                >
                  {k.value}
                </div>
                {k.sub && (
                  <div
                    className="ds-glass-sub"
                    style={{
                      color:
                        k.accent === "success" ? "#a7f3d0"
                        : k.accent === "warn"  ? "#fde68a"
                        : k.accent === "danger" ? "#fecaca"
                        : "rgba(255,255,255,.7)",
                    }}
                  >
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
