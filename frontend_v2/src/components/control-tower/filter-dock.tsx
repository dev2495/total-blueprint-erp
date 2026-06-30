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

function toneVars(tone: DockTone): React.CSSProperties {
    const t = TONE[tone];
    return {
        "--ct-tone-fg": t.fg,
        "--ct-tone-bg": t.bg,
        "--ct-tone-border": t.border,
        "--ct-tone-glow": t.glow,
    } as React.CSSProperties;
}

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
                    isolation: isolate;
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
                .ct-filter-group {
                    min-width: 0;
                    padding: 12px;
                    border-radius: var(--r-4);
                    border: 1px solid var(--ct-tone-border);
                    background: linear-gradient(180deg, var(--ct-tone-bg), rgba(255,255,255,.72));
                    box-shadow: inset 0 1px 0 rgba(255,255,255,.8), 0 10px 26px var(--ct-tone-glow);
                }
                .ct-filter-chip {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    padding: 6px 11px;
                    border-radius: var(--r-pill);
                    border: 1px solid var(--border-soft);
                    background: rgba(255,255,255,.84);
                    color: var(--text-2);
                    font-size: 11px;
                    font-weight: 850;
                    cursor: pointer;
                    white-space: nowrap;
                    box-shadow: none;
                    transition: transform var(--df) var(--eo), box-shadow var(--df) var(--eo), background var(--df) var(--eo), border-color var(--df) var(--eo);
                }
                .ct-filter-chip:hover {
                    transform: translateY(-1px);
                    border-color: var(--ct-tone-border);
                }
                .ct-filter-chip[data-active="true"] {
                    border-color: var(--ct-tone-border);
                    background: var(--ct-tone-bg);
                    color: var(--ct-tone-fg);
                    box-shadow: 0 0 0 3px var(--ct-tone-glow);
                }
                .ct-filter-chip__count {
                    font-family: var(--f-mono);
                    font-size: 10px;
                    color: var(--text-4);
                }
                .ct-filter-chip[data-active="true"] .ct-filter-chip__count {
                    color: var(--ct-tone-fg);
                }
                .ct-filter-field {
                    width: 100%;
                    min-height: 38px;
                    padding: 9px 12px 9px 34px;
                    border: 1px solid rgba(148,163,184,.28);
                    border-radius: var(--r-pill);
                    background: rgba(255,255,255,.9);
                    box-shadow: inset 0 1px 0 rgba(255,255,255,.9);
                    color: var(--text-1);
                    font-size: 13px;
                    font-family: var(--f-ui);
                    outline: none;
                }
                .ct-filter-select {
                    width: 100%;
                    min-height: 34px;
                    padding: 7px 10px;
                    font-size: 12px;
                    font-family: var(--f-ui);
                    color: var(--text-1);
                    background: rgba(255,255,255,.9);
                    border: 1px solid rgba(148,163,184,.28);
                    border-radius: var(--r-2);
                    outline: none;
                    cursor: pointer;
                }
                .dark .ct-filter-dock {
                    border-color: rgba(148,163,184,.24);
                    background:
                        linear-gradient(135deg, rgba(15,23,42,.98) 0%, rgba(16,24,39,.98) 50%, rgba(20,32,51,.94) 100%);
                    box-shadow: 0 22px 58px rgba(0,0,0,.34), inset 0 1px 0 rgba(255,255,255,.08);
                }
                .dark .ct-filter-dock__top {
                    border-bottom-color: rgba(148,163,184,.18);
                }
                .dark .ct-filter-dock__icon {
                    color: var(--br-700);
                    background: rgba(143,184,255,.16);
                    border-color: rgba(143,184,255,.28);
                }
                .dark .ct-filter-dock__saved {
                    border-top-color: rgba(148,163,184,.18);
                    background: rgba(8,13,25,.42);
                }
                .dark .ct-filter-group {
                    background: linear-gradient(180deg, color-mix(in srgb, var(--ct-tone-bg) 72%, var(--surface-2)), rgba(15,23,42,.76));
                    box-shadow: inset 0 1px 0 rgba(255,255,255,.07), 0 14px 34px rgba(0,0,0,.18);
                }
                .dark .ct-filter-chip {
                    background: rgba(16,24,39,.88);
                    border-color: rgba(148,163,184,.34);
                    color: var(--text-2);
                }
                .dark .ct-filter-chip[data-active="true"] {
                    background: color-mix(in srgb, var(--ct-tone-bg) 76%, rgba(16,24,39,.86));
                    color: var(--ct-tone-fg);
                }
                .dark .ct-filter-field,
                .dark .ct-filter-select {
                    background: rgba(15,23,42,.96);
                    border-color: rgba(148,163,184,.34);
                    box-shadow: inset 0 1px 0 rgba(255,255,255,.06);
                    color: var(--text-1);
                }
                .dark .ct-filter-field::placeholder {
                    color: var(--text-4);
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
            className="ct-filter-group"
            style={toneVars(tone)}
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
    return (
        <button
            type="button"
            onClick={onClick}
            data-active={active ? "true" : undefined}
            className="ct-filter-chip"
            style={toneVars(tone)}
        >
            <span>{label}</span>
            {count !== undefined && (
                <span className="ct-filter-chip__count">
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
                className="ct-filter-field"
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
                className="ct-filter-select"
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
