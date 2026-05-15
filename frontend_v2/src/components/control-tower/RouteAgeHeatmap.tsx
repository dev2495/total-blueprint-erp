"use client";

/**
 * RouteAgeHeatmap — rows × columns heatmap with shaded cells.
 * Used by Command (oldest-WIP age per family × process step) and Stock Intelligence (90-day version).
 *
 * Each cell carries: value (number), tone bucket (auto-derived), tooltip, optional label.
 *
 *   <RouteAgeHeatmap
 *     rows={["LDPE", "HDPE", "PET", ...]}
 *     cols={["Extrude", "Print", "Lam", "Slit", "Cut", "Pack", "Dispatch", "Closed"]}
 *     cells={[[2, 0, 12, 5, 0, 0, 1, 8], ...]}
 *     unit="d"
 *   />
 *
 * Color logic: 0 → muted; 1-3 → cool; 4-7 → neutral; 8-14 → warm; 15+ → hot.
 */

export interface RouteAgeHeatmapProps {
    rows: string[];
    cols: string[];
    cells: (number | null | undefined)[][]; // [row][col]
    unit?: string; // e.g. "d" for days
    title?: string;
    onCellClick?: (rowIdx: number, colIdx: number, value: number | null | undefined) => void;
}

function bucketColor(value: number | null | undefined): { bg: string; fg: string; label: string } {
    if (value === null || value === undefined) return { bg: "var(--surface-2)", fg: "var(--text-4)", label: "no data" };
    const v = Number(value);
    if (!Number.isFinite(v) || v <= 0) return { bg: "var(--surface-2)", fg: "var(--text-4)", label: "empty" };
    if (v <= 3) return { bg: "rgba(14,165,233,.14)", fg: "var(--s-700)", label: "fresh" };
    if (v <= 7) return { bg: "rgba(99,102,241,.14)", fg: "var(--i-700)", label: "settling" };
    if (v <= 14) return { bg: "rgba(245,158,11,.16)", fg: "var(--a-700)", label: "ageing" };
    return { bg: "rgba(244,63,94,.16)", fg: "var(--r-700)", label: "stale" };
}

export function RouteAgeHeatmap({ rows, cols, cells, unit = "d", title, onCellClick }: RouteAgeHeatmapProps) {
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
                    gridTemplateColumns: `minmax(120px, 1.4fr) repeat(${cols.length}, minmax(56px, 1fr))`,
                    gap: 4,
                    minWidth: 120 + cols.length * 60,
                }}
            >
                {/* Header row */}
                <div />
                {cols.map((col) => (
                    <div
                        key={col}
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
                        {col}
                    </div>
                ))}

                {rows.map((row, rIdx) => (
                    <RouteAgeRow
                        key={`${row}-${rIdx}`}
                        row={row}
                        cells={cells[rIdx] || []}
                        cols={cols}
                        unit={unit}
                        onCellClick={onCellClick ? (cIdx, v) => onCellClick(rIdx, cIdx, v) : undefined}
                    />
                ))}
            </div>
        </div>
    );
}

function RouteAgeRow({
    row,
    cells,
    cols,
    unit,
    onCellClick,
}: {
    row: string;
    cells: (number | null | undefined)[];
    cols: string[];
    unit: string;
    onCellClick?: (cIdx: number, v: number | null | undefined) => void;
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
                }}
            >
                {row}
            </div>
            {cols.map((_, cIdx) => {
                const v = cells[cIdx];
                const tone = bucketColor(v);
                const interactive = !!onCellClick;
                return (
                    <button
                        key={cIdx}
                        type="button"
                        disabled={!interactive}
                        onClick={interactive ? () => onCellClick!(cIdx, v) : undefined}
                        style={{
                            background: tone.bg,
                            color: tone.fg,
                            borderRadius: "var(--r-2)",
                            border: "none",
                            padding: "8px 4px",
                            fontFamily: "var(--f-mono)",
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: interactive ? "pointer" : "default",
                            transition: "all var(--df) var(--eo)",
                            textAlign: "center",
                        }}
                        title={`${row} → ${cols[cIdx]} · ${tone.label}${v != null ? ` · ${v}${unit}` : ""}`}
                    >
                        {v == null || !Number.isFinite(Number(v)) || Number(v) <= 0 ? "—" : `${Number(v)}${unit}`}
                    </button>
                );
            })}
        </>
    );
}

export default RouteAgeHeatmap;
