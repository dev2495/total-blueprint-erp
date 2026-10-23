"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
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
    label: "Material readiness",
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
  const activeKey =
    TABS.find((t) => pathname.includes(t.key))?.key ?? "command";

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

  // The workspace bar above every page already lists these seven tabs (filtered by role),
  // so this layout only keeps the 1-7 keyboard shortcuts and the page surface.
  return (
    <main
      className="canvas erp-production-surface"
      style={{
        minHeight: "100vh",
        padding: "0 0 var(--sp-12)",
      }}
      data-active-tab={activeKey}
    >
      {children}
    </main>
  );
}
