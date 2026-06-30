"use client";

import type React from "react";
import { Bookmark, Search, SlidersHorizontal, X } from "lucide-react";

type DockTone = "brand" | "success" | "warning" | "danger" | "info" | "neutral";

const TONE: Record<DockTone, { fg: string; bg: string; border: string; glow: string }> = {
    brand: { fg: "var(--br-700)", bg: "var(--br-50)", border: "var(--br-200)", glow: "rgba(37,99,235,.14)" },
    success: { fg: "var(--e-700)", bg: "rgba(16,185,129,.09)", border: "rgba(16,185,129,.22)", glow: "rgba(16,185,129,.14)" },
    warning: { fg: "var(--a-700)", bg: "rgba(245,158,11,.09)", border: "rgba(245,158,11,.24)", glow: "rgba(245,158,11,.14)" },
    danger: { fg: "var(--r-700)", bg: "rgba(244,63,94,.09)", border: "rgba(244,63,94,.24)", glow: "rgba(244,63,94,.14)" },
    info: { fg: "var(--s-700)", bg: "rgba(14,165,233,.09)", border: "rgba(14,165,233,.22)", glow: "rgba(14,165,233,.14)" },
    neutral: { fg: "var(--text-2)", bg: "var(--surface-2)", border: "var(--border-soft)", glow: "rgba(100,116,139,.10)" },
};

export function PlannerFilterDock({
    title,
    subtitle,
    icon,
    activeCount = 0,
    resultText,
    statusText,
    onClear,
    children,
    savedViews,
    actions,
}: {
    title: string;
    subtitle?: string;
    icon?: React.ReactNode;
    activeCount?: number;
    resultText?: string;
    statusText?: string;
    onClear?: () => void;
    children: React.ReactNode;
    savedViews?: React.ReactNode;
    actions?: React.ReactNode;
}) {
    return (
        <section className="ct-filter-dock" aria-label={`${title} filters`}>
            <style>{`
                .ct-filter-dock {
                    border: 1px solid rgba(148,163,184,.22);
                    border-radius: var(--r-5);
                    background:
                        linear-gradient(135deg, rgba(255,255,255,.94) 0%, rgba(248,251,255,.96) 56%, rgba(239,246,255,.88) 100%);
                    box-shadow: 0 18px 48px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.86);
                    overflow: hidden;
                    transform: translateZ(0);
                }
                .ct-filter-dock__top {
                    display: grid;
                    grid-template-columns: minmax(0, 1fr) auto;
                    gap: 16px;
                    align-items: center;
                    padding: 14px 18px 12px;
                    border-bottom: 1px solid rgba(148,163,184,.18);
                }
                .ct-filter-dock__title {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    min-width: 0;
                }
                .ct-filter-dock__icon {
                    width: 34px;
                    height: 34px;
                    border-radius: 12px;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    color: var(--br-700);
                    background: rgba(37,99,235,.10);
                    border: 1px solid rgba(37,99,235,.18);
                    flex: 0 0 auto;
                }
                .ct-filter-dock__name {
                    font-size: 13px;
                    font-weight: 900;
                    color: var(--text-1);
                    letter-spacing: .01em;
                    line-height: 1.2;
                }
                .ct-filter-dock__sub {
                    margin-top: 2px;
                    font-size: 11px;
                    color: var(--text-3);
                    line-height: 1.35;
                }
                .ct-filter-dock__meta {
                    display: flex;
                    align-items: center;
                    justify-content: flex-end;
                    gap: 8px;
                    flex-wrap: wrap;
                }
                .ct-filter-dock__body {
                    padding: 14px 18px;
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                }
                .ct-filter-dock__grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(min(100%, 245px), 1fr));
                    gap: 10px;
                }
                .ct-filter-dock__saved {
                    padding: 10px 18px 14px;
                    border-top: 1px solid rgba(148,163,184,.16);
                    background: rgba(255,255,255,.52);
                }
                .ct-filter-clear {
                    min-height: 26px;
                    border: 1px solid rgba(244,63,94,.22);
                    background: rgba(244,63,94,.08);
                    color: var(--r-700);
                    border-radius: var(--r-pill);
                    padding: 4px 10px;
                    font-size: 11px;
                    font-weight: 850;
                    display: inline-flex;
                    align-items: center;
                    gap: 5px;
                    cursor: pointer;
                }
                @media (max-width: 720px) {
                    .ct-filter-dock__top {
                        grid-template-columns: minmax(0, 1fr);
                        padding: 12px;
                    }
                    .ct-filter-dock__body {
                        padding: 12px;
                    }
                    .ct-filter-dock__saved {
                        padding: 10px 12px 12px;
                    }
                    .ct-filter-dock__meta {
                        justify-content: flex-start;
                    }
                }
            `}</style>
            <div className="ct-filter-dock__top">
                <div className="ct-filter-dock__title">
                    <span className="ct-filter-dock__icon">{icon || <SlidersHorizontal size={17} />}</span>
                    <div style={{ minWidth: 0 }}>
                        <div className="ct-filter-dock__name">{title}</div>
                        {subtitle && <div className="ct-filter-dock__sub">{subtitle}</div>}
                    </div>
                </div>
                <div className="ct-filter-dock__meta">
                    {resultText && <FilterBadge label={resultText} tone="brand" />}
                    <FilterBadge label={`${activeCount} active`} tone={activeCount > 0 ? "warning" : "neutral"} />
                    {statusText && <FilterBadge label={statusText} tone="info" />}
                    {actions}
                    {activeCount > 0 && onClear && (
                        <button type="button" onClick={onClear} className="ct-filter-clear">
                            <X size={12} />
                            Clear
                        </button>
                    )}
                </div>
            </div>
            <div className="ct-filter-dock__body">{children}</div>
            {savedViews && (
                <div className="ct-filter-dock__saved">
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                        <Bookmark size={13} color="var(--text-4)" />
                        <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-4)" }}>
                            Saved views
                        </span>
                    </div>
                    {savedViews}
                </div>
            )}
        </section>
    );
}

export function FilterBadge({ label, tone = "neutral" }: { label: string; tone?: DockTone }) {
    const t = TONE[tone];
    return (
        <span
            style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                minHeight: 26,
                padding: "4px 10px",
                borderRadius: "var(--r-pill)",
                border: `1px solid ${t.border}`,
                background: t.bg,
                color: t.fg,
                fontSize: 11,
                fontWeight: 850,
                whiteSpace: "nowrap",
            }}
        >
            {label}
        </span>
    );
}

export function FilterGroup({
    label,
    icon,
    tone = "neutral",
    children,
}: {
    label: string;
    icon?: React.ReactNode;
    tone?: DockTone;
    children: React.ReactNode;
}) {
    const t = TONE[tone];
    return (
        <div
            style={{
                padding: 12,
                borderRadius: "var(--r-4)",
                border: `1px solid ${t.border}`,
                background: `linear-gradient(180deg, ${t.bg}, rgba(255,255,255,.72))`,
                boxShadow: `inset 0 1px 0 rgba(255,255,255,.8), 0 10px 26px ${t.glow}`,
                minWidth: 0,
            }}
        >
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 9 }}>
                {icon && <span style={{ color: t.fg, display: "inline-flex" }}>{icon}</span>}
                <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: ".08em", textTransform: "uppercase", color: t.fg }}>
                    {label}
                </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>{children}</div>
        </div>
    );
}

export function FilterChip({
    label,
    count,
    active,
    onClick,
    tone = "brand",
}: {
    label: string;
    count?: number | string;
    active: boolean;
    onClick: () => void;
    tone?: DockTone;
}) {
    const t = TONE[tone];
    return (
        <button
            type="button"
            onClick={onClick}
            style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 11px",
                borderRadius: "var(--r-pill)",
                border: `1px solid ${active ? t.border : "var(--border-soft)"}`,
                background: active ? t.bg : "rgba(255,255,255,.78)",
                color: active ? t.fg : "var(--text-2)",
                fontSize: 11,
                fontWeight: 850,
                cursor: "pointer",
                whiteSpace: "nowrap",
                boxShadow: active ? `0 0 0 3px ${t.glow}` : "none",
                transition: "transform var(--df) var(--eo), box-shadow var(--df) var(--eo), background var(--df) var(--eo)",
            }}
        >
            <span>{label}</span>
            {count !== undefined && (
                <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: active ? t.fg : "var(--text-4)" }}>
                    {count}
                </span>
            )}
        </button>
    );
}

export function FilterSearch({
    value,
    onChange,
    placeholder,
}: {
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
}) {
    return (
        <div style={{ position: "relative", minWidth: 0 }}>
            <Search size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-4)" }} />
            <input
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder={placeholder}
                style={{
                    width: "100%",
                    minHeight: 38,
                    padding: "9px 12px 9px 34px",
                    border: "1px solid rgba(148,163,184,.28)",
                    borderRadius: "var(--r-pill)",
                    background: "rgba(255,255,255,.86)",
                    boxShadow: "inset 0 1px 0 rgba(255,255,255,.9)",
                    color: "var(--text-1)",
                    fontSize: 13,
                    fontFamily: "var(--f-ui)",
                    outline: "none",
                }}
            />
        </div>
    );
}

export function FilterSelect({
    label,
    value,
    options,
    onChange,
}: {
    label: string;
    value: string;
    options: [string, string][];
    onChange: (value: string) => void;
}) {
    return (
        <label style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
            <span style={{ fontSize: 9, fontWeight: 850, textTransform: "uppercase", letterSpacing: ".07em", color: "var(--text-4)" }}>
                {label}
            </span>
            <select
                value={value}
                onChange={(event) => onChange(event.target.value)}
                style={{
                    width: "100%",
                    minHeight: 34,
                    padding: "7px 10px",
                    fontSize: 12,
                    fontFamily: "var(--f-ui)",
                    color: "var(--text-1)",
                    background: "rgba(255,255,255,.86)",
                    border: "1px solid rgba(148,163,184,.28)",
                    borderRadius: "var(--r-2)",
                    outline: "none",
                    cursor: "pointer",
                }}
            >
                {options.map(([optionValue, optionLabel]) => (
                    <option key={optionValue} value={optionValue}>{optionLabel}</option>
                ))}
            </select>
        </label>
    );
}

export function ChipRow({ children }: { children: React.ReactNode }) {
    return <div style={{ display: "flex", flexWrap: "wrap", gap: 6, minWidth: 0 }}>{children}</div>;
}
