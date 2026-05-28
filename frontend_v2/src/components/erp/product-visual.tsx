"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

interface ProductVisualLayer {
    role: string
    film_variant_code: string
    thickness_micron: number
    grade?: string
}

interface ProductVisualProps {
    kind: "POUCH" | "ROLL" | "BULK" | "PACKAGING" | "POD" | "OTHER"
    width_mm?: number
    height_mm?: number
    gusset_mm?: number
    roll_width_mm?: number
    layers?: ProductVisualLayer[]
    addons?: string[]
    title?: string
    subtitle?: string
    className?: string
    /** Render compact, suitable for list cards. */
    compact?: boolean
}

/**
 * Stylised illustration of the finished good plus a per-layer cross-section.
 * The cross-section is drawn proportionally to thickness so users instantly
 * see which layer dominates the stack.
 */
export function ProductVisual({
    kind,
    width_mm,
    height_mm,
    gusset_mm,
    roll_width_mm,
    layers = [],
    addons = [],
    title,
    subtitle,
    className,
    compact = false,
}: ProductVisualProps) {
    const totalThickness = layers.reduce((sum, l) => sum + (l.thickness_micron || 0), 0) || 1
    return (
        <div
            className={cn(
                "relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-blue-50/40 p-4 ring-1 ring-slate-100",
                className
            )}
        >
            <div className={cn("flex items-stretch gap-4", compact ? "min-h-[120px]" : "min-h-[180px]")}>
                <div
                    className={cn(
                        "relative flex flex-1 items-end justify-center rounded-xl bg-white/70 ring-1 ring-slate-100",
                        compact ? "min-h-[120px]" : "min-h-[180px]"
                    )}
                >
                    {kind === "POUCH" ? (
                        <Pouch width_mm={width_mm} height_mm={height_mm} gusset_mm={gusset_mm} addons={addons} compact={compact} />
                    ) : kind === "ROLL" || kind === "PACKAGING" ? (
                        <Roll width_mm={roll_width_mm || width_mm} compact={compact} />
                    ) : kind === "POD" ? (
                        <Roll width_mm={roll_width_mm || width_mm} accent="violet" compact={compact} />
                    ) : (
                        <Generic compact={compact} />
                    )}
                    {(title || subtitle) && (
                        <div className="absolute left-3 top-3 right-3 flex items-start justify-between">
                            <div>
                                {title ? (
                                    <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">
                                        {title}
                                    </div>
                                ) : null}
                                {subtitle ? <div className="text-xs font-medium text-slate-700">{subtitle}</div> : null}
                            </div>
                            <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 ring-1 ring-slate-200">
                                {kind}
                            </span>
                        </div>
                    )}
                </div>

                {layers.length > 0 ? (
                    <div className={cn("flex flex-col gap-1.5", compact ? "w-32" : "w-40")}>
                        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                            Layer stack
                        </div>
                        <div className="flex flex-1 flex-col gap-0.5 rounded-xl bg-white p-2 ring-1 ring-slate-100">
                            {layers.map((l, i) => {
                                const pct = ((l.thickness_micron || 0) / totalThickness) * 100
                                return (
                                    <div
                                        key={`${l.role}-${i}`}
                                        className="flex flex-1 items-center gap-2 rounded-md ring-1 ring-inset"
                                        style={{
                                            background: layerColor(l.role, i, "bg"),
                                            color: layerColor(l.role, i, "fg"),
                                            borderColor: layerColor(l.role, i, "ring"),
                                            minHeight: 18,
                                            flexBasis: `${Math.max(pct, 8)}%`,
                                            paddingInline: 8,
                                        }}
                                    >
                                        <span className="text-[10px] font-bold uppercase tracking-wider">
                                            L{i + 1}
                                        </span>
                                        <span className="truncate text-[11px] font-semibold">
                                            {l.film_variant_code}
                                        </span>
                                        <span className="ml-auto text-[10px] font-bold">
                                            {l.thickness_micron}μ
                                        </span>
                                    </div>
                                )
                            })}
                        </div>
                        <div className="text-[10px] font-semibold text-slate-500">
                            Total {totalThickness}μ
                        </div>
                    </div>
                ) : null}
            </div>
            {addons.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                    {addons.map((a) => (
                        <span
                            key={a}
                            className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-violet-700 ring-1 ring-violet-100"
                        >
                            {a}
                        </span>
                    ))}
                </div>
            ) : null}
        </div>
    )
}

function Pouch({
    width_mm = 140,
    height_mm = 210,
    gusset_mm = 35,
    addons = [],
    compact,
}: {
    width_mm?: number
    height_mm?: number
    gusset_mm?: number
    addons?: string[]
    compact?: boolean
}) {
    const ratio = (width_mm || 1) / (height_mm || 1)
    const drawW = compact ? 70 : 100
    const drawH = drawW / ratio
    const zip = addons.includes("ZIPPER") || addons.includes("Zipper")
    return (
        <svg
            viewBox={`-20 -20 ${drawW + 40} ${drawH + 60}`}
            width="100%"
            height="100%"
            preserveAspectRatio="xMidYMax meet"
            className="text-slate-700"
        >
            <defs>
                <linearGradient id="pg" x1="0" x2="1" y1="0" y2="1">
                    <stop offset="0%" stopColor="#dbeafe" />
                    <stop offset="100%" stopColor="#c7d2fe" />
                </linearGradient>
            </defs>
            {/* Pouch body */}
            <path
                d={`M0 ${drawH} L0 8 Q0 0 8 0 L${drawW - 8} 0 Q${drawW} 0 ${drawW} 8 L${drawW} ${drawH} Z`}
                fill="url(#pg)"
                stroke="#6366f1"
                strokeWidth="1.5"
            />
            {/* Heat seal */}
            <line x1="0" x2={drawW} y1={drawH - 8} y2={drawH - 8} stroke="#a5b4fc" strokeDasharray="2 2" />
            {/* Zipper */}
            {zip ? (
                <g>
                    <line x1="6" x2={drawW - 6} y1="14" y2="14" stroke="#0ea5e9" strokeWidth="2" />
                    <circle cx={drawW - 12} cy="14" r="2" fill="#0ea5e9" />
                </g>
            ) : null}
            {/* Dimension labels */}
            <g fontFamily="ui-sans-serif" fontSize="6" fill="#475569">
                <text x={drawW / 2} y={drawH + 18} textAnchor="middle" fontWeight="700">
                    {width_mm} mm
                </text>
                <text
                    x={-12}
                    y={drawH / 2}
                    textAnchor="middle"
                    fontWeight="700"
                    transform={`rotate(-90,-12,${drawH / 2})`}
                >
                    {height_mm} mm
                </text>
                {gusset_mm ? (
                    <text x={drawW + 14} y={drawH - 4} textAnchor="middle" fontWeight="700">
                        ⌐{gusset_mm}
                    </text>
                ) : null}
            </g>
        </svg>
    )
}

function Roll({
    width_mm = 1050,
    accent = "blue",
    compact,
}: {
    width_mm?: number
    accent?: "blue" | "violet"
    compact?: boolean
}) {
    const drawW = compact ? 110 : 150
    const drawH = compact ? 60 : 80
    const stroke = accent === "violet" ? "#7c3aed" : "#2563eb"
    const fill = accent === "violet" ? "#ede9fe" : "#dbeafe"
    return (
        <svg viewBox={`-15 -15 ${drawW + 30} ${drawH + 40}`} width="100%" height="100%" preserveAspectRatio="xMidYMax meet">
            <ellipse cx="14" cy={drawH / 2} rx="14" ry={drawH / 2} fill={fill} stroke={stroke} strokeWidth="1.5" />
            <rect x="14" y="0" width={drawW - 28} height={drawH} fill={fill} stroke={stroke} strokeWidth="1.5" />
            <ellipse cx={drawW - 14} cy={drawH / 2} rx="14" ry={drawH / 2} fill="white" stroke={stroke} strokeWidth="1.5" />
            <line x1="14" x2={drawW - 14} y1="6" y2="6" stroke={stroke} strokeOpacity={0.3} />
            <line x1="14" x2={drawW - 14} y1={drawH - 6} y2={drawH - 6} stroke={stroke} strokeOpacity={0.3} />
            <text x={drawW / 2} y={drawH + 18} textAnchor="middle" fontSize="6" fontWeight="700" fill="#475569">
                {width_mm} mm width
            </text>
        </svg>
    )
}

function Generic({ compact }: { compact?: boolean }) {
    return (
        <div className={cn("flex flex-col items-center gap-1 text-slate-500", compact ? "py-3" : "py-6")}>
            <div className="h-12 w-12 rounded-2xl bg-slate-100 ring-1 ring-slate-200" />
            <div className="text-[10px] font-bold uppercase tracking-wider">Composite</div>
        </div>
    )
}

const PALETTE = [
    { bg: "#eff6ff", fg: "#1e3a8a", ring: "#bfdbfe" },
    { bg: "#fef3c7", fg: "#78350f", ring: "#fde68a" },
    { bg: "#fae8ff", fg: "#581c87", ring: "#f5d0fe" },
    { bg: "#dcfce7", fg: "#14532d", ring: "#bbf7d0" },
    { bg: "#ffe4e6", fg: "#881337", ring: "#fecdd3" },
    { bg: "#cffafe", fg: "#155e75", ring: "#a5f3fc" },
]
function layerColor(role: string, i: number, kind: "bg" | "fg" | "ring"): string {
    const sealantIdx = role.includes("seal") ? 1 : -1
    const idx = sealantIdx >= 0 && i === sealantIdx ? 1 : i % PALETTE.length
    return PALETTE[idx][kind]
}
