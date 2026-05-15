"use client";

/**
 * HealthBar — 4-segment runway bar.
 * Used in Command's Priority Runway and (Phase 1) Plan Queue order list.
 *
 * Segments are in semantic order: math → artwork → material → route.
 * Each segment is "ok" (green) | "warn" (amber) | "blocked" (red) | "skip" (muted).
 *
 *  <HealthBar segments={[
 *    { key: "math", state: "ok", label: "Math" },
 *    { key: "artwork", state: "warn", label: "Artwork" },
 *    { key: "material", state: "ok", label: "Material" },
 *    { key: "route", state: "blocked", label: "Route" },
 *  ]} />
 */

export type HealthSegmentState = "ok" | "warn" | "blocked" | "skip";

export interface HealthSegment {
    key: string;
    state: HealthSegmentState;
    label?: string;
    detail?: string;
}

const STATE_TO_COLOR: Record<HealthSegmentState, string> = {
    ok: "var(--success)",
    warn: "var(--warning)",
    blocked: "var(--danger)",
    skip: "var(--border-strong)",
};

const STATE_TO_GLOW: Record<HealthSegmentState, string> = {
    ok: "var(--glow-emerald)",
    warn: "0 0 0 1px rgba(245,158,11,.18), 0 6px 14px -8px rgba(245,158,11,.30)",
    blocked: "0 0 0 1px rgba(244,63,94,.18), 0 6px 14px -8px rgba(244,63,94,.30)",
    skip: "none",
};

interface HealthBarProps {
    segments: HealthSegment[];
    height?: number;
    showLabels?: boolean;
}

export function HealthBar({ segments, height = 8, showLabels = false }: HealthBarProps) {
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div
                role="img"
                aria-label={`Health: ${segments.map((s) => `${s.label || s.key} ${s.state}`).join(", ")}`}
                style={{
                    display: "flex",
                    gap: 3,
                    alignItems: "stretch",
                    height,
                    borderRadius: 999,
                    overflow: "hidden",
                    background: "var(--surface-2)",
                    padding: 2,
                }}
            >
                {segments.map((seg) => (
                    <div
                        key={seg.key}
                        title={seg.detail || seg.label || seg.key}
                        style={{
                            flex: 1,
                            background: STATE_TO_COLOR[seg.state],
                            boxShadow: STATE_TO_GLOW[seg.state],
                            borderRadius: 999,
                            transition: "all var(--df) var(--eo)",
                        }}
                    />
                ))}
            </div>
            {showLabels && (
                <div style={{ display: "flex", gap: 3 }}>
                    {segments.map((seg) => (
                        <div
                            key={seg.key}
                            style={{
                                flex: 1,
                                fontSize: 9,
                                fontWeight: 600,
                                textTransform: "uppercase",
                                letterSpacing: ".04em",
                                color: "var(--text-3)",
                                textAlign: "center",
                            }}
                        >
                            {seg.label || seg.key}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default HealthBar;
