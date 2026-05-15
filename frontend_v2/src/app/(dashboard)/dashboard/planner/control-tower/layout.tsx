"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Activity, BarChart3, ClipboardCheck, History, Sparkles } from "lucide-react";

const TABS: Array<{
    key: string;
    label: string;
    href: string;
    icon: typeof Activity;
    eyebrow: string;
}> = [
    { key: "command", label: "Command", href: "/dashboard/planner/control-tower/command", icon: Sparkles, eyebrow: "Tab 1" },
    { key: "plan-queue", label: "Plan Queue", href: "/dashboard/planner/control-tower/plan-queue", icon: ClipboardCheck, eyebrow: "Tab 2" },
    { key: "live-production", label: "Live Production", href: "/dashboard/planner/control-tower/live-production", icon: Activity, eyebrow: "Tab 3" },
    { key: "completed-trace", label: "Completed Trace", href: "/dashboard/planner/control-tower/completed-trace", icon: History, eyebrow: "Tab 4" },
    { key: "stock-intelligence", label: "Stock Intelligence", href: "/dashboard/planner/control-tower/stock-intelligence", icon: BarChart3, eyebrow: "Tab 5" },
];

export default function ControlTowerLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname() || "";
    const router = useRouter();
    const activeKey = TABS.find((t) => pathname.includes(t.key))?.key ?? "command";

    // Keyboard shortcuts 1-5
    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null;
            if (target && /input|textarea|select/i.test(target.tagName)) return;
            if (target && target.isContentEditable) return;
            if (event.metaKey || event.ctrlKey || event.altKey) return;
            const idx = "12345".indexOf(event.key);
            if (idx >= 0) {
                event.preventDefault();
                router.push(TABS[idx].href);
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [router]);

    return (
        <main className="canvas" style={{ minHeight: "100vh", padding: "var(--sp-6) var(--sp-6) var(--sp-12)" }}>
            {/* Tab navigator */}
            <nav
                aria-label="Control Tower tabs"
                style={{
                    display: "inline-flex",
                    flexWrap: "wrap",
                    gap: 4,
                    padding: 6,
                    borderRadius: "var(--r-pill)",
                    background: "var(--surface-glass)",
                    backdropFilter: "blur(10px)",
                    border: "1px solid var(--surface-glass-edge)",
                    boxShadow: "var(--sh-md)",
                    marginBottom: "var(--sp-6)",
                    maxWidth: "100%",
                    overflow: "auto",
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
                            style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 8,
                                padding: "8px 16px",
                                borderRadius: "var(--r-pill)",
                                background: isActive ? "var(--brand-600)" : "transparent",
                                color: isActive ? "var(--text-on-brand)" : "var(--text-2)",
                                fontSize: 13,
                                fontWeight: 600,
                                textDecoration: "none",
                                transition: "all var(--df) var(--eo)",
                                boxShadow: isActive ? "var(--glow-brand)" : "none",
                            }}
                        >
                            <Icon size={14} />
                            <span>{tab.label}</span>
                            <kbd
                                aria-hidden
                                style={{
                                    fontFamily: "var(--f-mono)",
                                    fontSize: 10,
                                    padding: "1px 6px",
                                    borderRadius: 6,
                                    background: isActive ? "rgba(255,255,255,.18)" : "var(--surface-2)",
                                    color: isActive ? "rgba(255,255,255,.9)" : "var(--text-3)",
                                    border: isActive ? "none" : "1px solid var(--border-soft)",
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
