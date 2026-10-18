"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  BarChart3,
  ClipboardCheck,
  History,
  Sparkles,
  Combine,
  Rocket,
} from "lucide-react";

const TABS: Array<{
  key: string;
  label: string;
  href: string;
  icon: typeof Activity;
  eyebrow: string;
}> = [
  {
    key: "command",
    label: "Command",
    href: "/dashboard/planner/control-tower/command",
    icon: Sparkles,
    eyebrow: "Tab 1",
  },
  {
    key: "plan-queue",
    label: "Plan Queue",
    href: "/dashboard/planner/control-tower/plan-queue",
    icon: ClipboardCheck,
    eyebrow: "Tab 2",
  },
  {
    key: "live-production",
    label: "Live Production",
    href: "/dashboard/planner/control-tower/live-production",
    icon: Activity,
    eyebrow: "Tab 3",
  },
  {
    key: "completed-trace",
    label: "Completed Trace",
    href: "/dashboard/planner/control-tower/completed-trace",
    icon: History,
    eyebrow: "Tab 4",
  },
  {
    key: "stock-intelligence",
    label: "Stock Intelligence",
    href: "/dashboard/planner/control-tower/stock-intelligence",
    icon: BarChart3,
    eyebrow: "Tab 5",
  },
  {
    key: "gang-builder",
    label: "Combine Orders",
    href: "/dashboard/planner/control-tower/gang-builder",
    icon: Combine,
    eyebrow: "Tab 6",
  },
  {
    key: "stock-launcher",
    label: "Launch Stock",
    href: "/dashboard/planner/control-tower/stock-launcher",
    icon: Rocket,
    eyebrow: "Tab 7",
  },
];

export default function ControlTowerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname() || "";
  const router = useRouter();
  const tabNavRef = useRef<HTMLElement>(null);
  const activeKey =
    TABS.find((t) => pathname.includes(t.key))?.key ?? "command";

  useEffect(() => {
    tabNavRef.current
      ?.querySelector<HTMLElement>('a[aria-current="page"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeKey]);

  // Keyboard shortcuts 1-7
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /input|textarea|select/i.test(target.tagName)) return;
      if (target && target.isContentEditable) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const idx = "1234567".indexOf(event.key);
      if (idx >= 0) {
        event.preventDefault();
        router.push(TABS[idx].href);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [router]);

  return (
    <main
      className="canvas erp-production-surface"
      style={{
        minHeight: "100vh",
        padding: "var(--sp-6) var(--sp-6) var(--sp-12)",
      }}
    >
      {/* Tab navigator */}
      <nav
        ref={tabNavRef}
        aria-label="Control Tower tabs"
        style={{
          display: "inline-flex",
          flexWrap: "nowrap",
          gap: 2,
          padding: 4,
          borderRadius: "var(--r-3)",
          background: "var(--surface-2)",
          border: "1px solid var(--border-soft)",
          marginBottom: "var(--sp-6)",
          maxWidth: "100%",
          overflowX: "auto",
          scrollPaddingInline: 4,
        }}
      >
        {TABS.map((tab) => {
          const isActive = tab.key === activeKey;
          const Icon = tab.icon;
          return (
            <Link
              key={tab.key}
              href={tab.href}
              aria-current={isActive ? "page" : undefined}
              onFocus={(event) => {
                event.currentTarget.scrollIntoView({
                  block: "nearest",
                  inline: "nearest",
                });
              }}
              style={{
                display: "inline-flex",
                flexShrink: 0,
                alignItems: "center",
                gap: 8,
                minHeight: 36,
                padding: "6px 14px",
                borderRadius: 8,
                background: isActive ? "var(--surface-1)" : "transparent",
                color: isActive ? "var(--text-1)" : "var(--text-3)",
                fontSize: 13,
                fontWeight: 500,
                textDecoration: "none",
                whiteSpace: "nowrap",
                transition:
                  "background-color var(--df) var(--eo), color var(--df) var(--eo), box-shadow var(--df) var(--eo)",
                boxShadow: isActive ? "var(--sh-sm)" : "none",
              }}
            >
              <Icon size={14} />
              <span>{tab.label}</span>
              <kbd
                aria-hidden
                style={{
                  fontFamily: "var(--f-mono)",
                  fontSize: 11,
                  padding: "1px 6px",
                  borderRadius: 5,
                  background: isActive ? "var(--surface-2)" : "transparent",
                  color: "var(--text-3)",
                  border: "1px solid var(--border-soft)",
                }}
              >
                {TABS.indexOf(tab) + 1}
              </kbd>
            </Link>
          );
        })}
      </nav>

      {children}
    </main>
  );
}
