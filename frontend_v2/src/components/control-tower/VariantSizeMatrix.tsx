"use client";

/**
 * VariantSizeMatrix — clickable grid of variant codes × size buckets.
 * Used by Command (open-order distribution) and Stock Intelligence (Phase 3 — match drilldown).
 *
 * Each cell shows a count and (optionally) a unit-amount in tooltip. Clicks bubble up.
 *
 *   <VariantSizeMatrix
 *     rowLabels={["LDPE-NAT", "PET-12", "BOPP-20", ...]}
 *     colLabels={["≤200", "201-400", "401-600", "601-800", "801-1000", "1001+"]}
 *     cells={[[3, 0, 1, 0, 0, 0], [2, 4, 1, 0, 0, 0], ...]}
 *     onClick={(row, col, v) => …}
 *   />
 */

export interface VariantSizeMatrixProps {
    rowLabels: string[];
    colLabels: string[];
    cells: (number | null | undefined)[][];
    title?: string;
    onClick?: (rowIdx: number, colIdx: number, value: number | null | undefined) => void;
}

function valueColor(v: number | null | undefined): { bg: string; fg: string; ring: string } {
    if (v == null || !Number.isFinite(Number(v)) || Number(v) <= 0) {
        return { bg: "var(--surface-2)", fg: "var(--text-4)", ring: "transparent" };
    }
    const n = Number(v);
    if (n >= 10) return { bg: "rgba(124,58,237,.18)", fg: "var(--v-700)", ring: "rgba(124,58,237,.36)" };
    if (n >= 5) return { bg: "rgba(99,102,241,.16)", fg: "var(--i-700)", ring: "rgba(99,102,241,.30)" };
    if (n >= 2) return { bg: "rgba(37,99,235,.12)", fg: "var(--br-700)", ring: "rgba(37,99,235,.22)" };
    return { bg: "rgba(14,165,233,.10)", fg: "var(--s-700)", ring: "rgba(14,165,233,.18)" };
}

export function VariantSizeMatrix({ rowLabels, colLabels, cells, title, onClick }: VariantSizeMatrixProps) {
    return (
        <div style={{ width: "100%", overflowX: "auto" }}>
            {title && (
                <div
                    style={{
                        fontSize: 11,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: ".06em",
                        color: "var(--text-3)",
                        marginBottom: 8,
                    }}
                >
                    {title}
                </div>
            )}
            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: `minmax(140px, 1.4fr) repeat(${colLabels.length}, minmax(60px, 1fr))`,
                    gap: 4,
                    minWidth: 140 + colLabels.length * 64,
                }}
            >
                <div />
                {colLabels.map((c) => (
                    <div
                        key={c}
                        style={{
                            fontSize: 10,
                            fontWeight: 700,
                            textTransform: "uppercase",
                            letterSpacing: ".05em",
                            color: "var(--text-3)",
                            textAlign: "center",
                            padding: "4px 2px",
                        }}
                    >
                        {c}
                    </div>
                ))}
                {rowLabels.map((row, rIdx) => (
                    <VariantRow
                        key={`${row}-${rIdx}`}
                        row={row}
                        cells={cells[rIdx] || []}
                        cols={colLabels}
                        onClick={onClick ? (cIdx, v) => onClick(rIdx, cIdx, v) : undefined}
                    />
                ))}
            </div>
        </div>
    );
}

function VariantRow({
    row,
    cells,
    cols,
    onClick,
}: {
    row: string;
    cells: (number | null | undefined)[];
    cols: string[];
    onClick?: (cIdx: number, v: number | null | undefined) => void;
}) {
    return (
        <>
            <div
                style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--text-2)",
                    padding: "8px 10px",
                    background: "var(--surface-2)",
                    borderRadius: "var(--r-2)",
                    display: "flex",
                    alignItems: "center",
                    fontFamily: "var(--f-mono)",
                }}
            >
                {row}
            </div>
            {cols.map((c, cIdx) => {
                const v = cells[cIdx];
                const tone = valueColor(v);
                const clickable = !!onClick && v != null && Number(v) > 0;
                return (
                    <button
                        key={cIdx}
                        type="button"
                        disabled={!clickable}
                        onClick={clickable ? () => onClick!(cIdx, v) : undefined}
                        style={{
                            background: tone.bg,
                            color: tone.fg,
                            borderRadius: "var(--r-2)",
                            border: `1px solid ${tone.ring}`,
                            padding: "10px 4px",
                            fontFamily: "var(--f-mono)",
                            fontSize: 13,
                            fontWeight: 700,
                            cursor: clickable ? "pointer" : "default",
                            opacity: clickable ? 1 : 0.85,
                            textAlign: "center",
                            transition: "all var(--df) var(--eo)",
                        }}
                        title={`${row} · ${c}${v != null ? ` · ${v} open` : ""}`}
                    >
                        {v == null || !Number.isFinite(Number(v)) || Number(v) <= 0 ? "·" : Number(v)}
                    </button>
                );
            })}
        </>
    );
}

export default VariantSizeMatrix;
