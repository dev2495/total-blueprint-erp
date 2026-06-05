"use client";

/**
 * V3.6 Pulse view — shared analytics dashboard for each class workspace.
 *
 * Inputs: derived KPI numbers + breakdown maps from any class workspace.
 * Outputs: rich KPI strip (with sparklines + deltas), donut + horizontal bars
 * + ageing + locations + secondary stats.
 *
 * Polished but readable: soft tonal accents, no garish gradients on body
 * elements; reserved for hero / KPI tile only.
 */

import * as React from "react";
import {
  Activity,
  BarChart3,
  Boxes,
  Clock,
  MapPin,
  Sparkles,
  TrendingUp,
} from "lucide-react";

import { cn } from "@/lib/utils";

// ─── Types ─────────────────────────────────────────────────────────

export interface PulseKpi {
  label: string;
  value: string;
  sub?: string;
  icon?: React.ReactNode;
  tone?: "default" | "good" | "warn" | "bad";
  trend?: number[]; // sparkline series (last N points)
  delta?: { v: string; positive: boolean };
}

export interface PulseBreakdownEntry {
  label: string;
  value: number;
  color?: string;
}

export interface PulseAgeing {
  fresh: number;
  aged: number;
  old: number;
}

export interface PulseStat {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "good" | "warn" | "bad";
}

export interface PulseMatrix {
  title: string;
  subtitle?: string;
  rowLabel: string;
  colLabel: string;
  rows: string[];
  cols: string[];
  cells: Record<string, Record<string, number>>;
  unit?: string;
}

interface PulseViewProps {
  kpis: PulseKpi[];
  primaryBreakdown: {
    title: string;
    entries: PulseBreakdownEntry[];
    unit?: string;
  };
  secondaryBreakdown?: {
    title: string;
    entries: PulseBreakdownEntry[];
    unit?: string;
  };
  ageing?: PulseAgeing;
  locationBreakdown?: PulseBreakdownEntry[];
  statRow?: PulseStat[];
  matrix?: PulseMatrix;
  topList?: {
    title: string;
    subtitle?: string;
    rows: Array<{
      label: string;
      sub?: string;
      value: string;
      tone?: "default" | "good" | "warn" | "bad";
    }>;
  };
  extra?: React.ReactNode;
}

const SOFT_COLORS = [
  "#6366f1", // indigo-500
  "#14b8a6", // teal-500
  "#f59e0b", // amber-500
  "#ec4899", // pink-500
  "#10b981", // emerald-500
  "#0ea5e9", // sky-500
  "#a855f7", // purple-500
  "#f43f5e", // rose-500
  "#84cc16", // lime-500
  "#64748b", // slate-500
];

function fmt(n: number, max = 0): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: max,
  }).format(n);
}

// ─── Main ─────────────────────────────────────────────────────────

export function PulseViewV36({
  kpis,
  primaryBreakdown,
  secondaryBreakdown,
  ageing,
  locationBreakdown,
  statRow,
  matrix,
  topList,
  extra,
}: PulseViewProps) {
  return (
    <div className="space-y-4">
      {/* KPI strip — richer, with sparklines and deltas */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {kpis.map((k, i) => (
          <PulseKpiTile key={i} {...k} />
        ))}
      </div>

      {/* Optional secondary stat strip — denser micro-metrics */}
      {statRow && statRow.length > 0 && (
        <div className="rounded-2xl border border-line bg-surface-1 px-4 py-3 shadow-sm">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {statRow.map((s, i) => (
              <MicroStat key={i} {...s} />
            ))}
          </div>
        </div>
      )}

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <PulseCard
          title={primaryBreakdown.title}
          subtitle="Top 10 by share"
          icon={<BarChart3 className="h-4 w-4 text-order-fg" />}
          action={
            <TotalChip
              total={primaryBreakdown.entries.reduce((s, e) => s + e.value, 0)}
              unit={primaryBreakdown.unit || ""}
            />
          }
        >
          <HorizontalBars
            entries={primaryBreakdown.entries.slice(0, 10)}
            unit={primaryBreakdown.unit || ""}
          />
        </PulseCard>

        {secondaryBreakdown && (
          <PulseCard
            title={secondaryBreakdown.title}
            subtitle="Distribution"
            icon={<Activity className="h-4 w-4 text-success-fg" />}
            action={
              <TotalChip
                total={secondaryBreakdown.entries.reduce(
                  (s, e) => s + e.value,
                  0,
                )}
                unit={secondaryBreakdown.unit || ""}
              />
            }
          >
            <Donut
              entries={secondaryBreakdown.entries}
              unit={secondaryBreakdown.unit || ""}
            />
          </PulseCard>
        )}

        {ageing && (
          <PulseCard
            title="Ageing"
            subtitle="Days since last movement"
            icon={<Clock className="h-4 w-4 text-warning-fg" />}
          >
            <AgeingChart ageing={ageing} />
          </PulseCard>
        )}
      </div>

      {locationBreakdown && locationBreakdown.length > 0 && (
        <PulseCard
          title="Location split"
          subtitle="On-hand by warehouse / yard"
          icon={<MapPin className="h-4 w-4 text-danger-fg" />}
          action={
            <TotalChip
              total={locationBreakdown.reduce((s, e) => s + e.value, 0)}
              unit=""
            />
          }
        >
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
            {locationBreakdown.slice(0, 16).map((b, i) => (
              <LocationTile
                key={i}
                entry={b}
                idx={i}
                max={Math.max(...locationBreakdown.map((x) => x.value), 1)}
              />
            ))}
          </div>
        </PulseCard>
      )}

      {(matrix || topList) && (
        <div
          className={cn(
            "grid grid-cols-1 gap-4",
            matrix && topList ? "xl:grid-cols-2" : "",
          )}
        >
          {matrix && <PulseMatrixCard matrix={matrix} />}
          {topList && <PulseTopList {...topList} />}
        </div>
      )}

      {extra}
    </div>
  );
}

// ─── Matrix card (e.g. variant × thickness, material × location) ──

function PulseMatrixCard({ matrix }: { matrix: PulseMatrix }) {
  if (matrix.rows.length === 0 || matrix.cols.length === 0) {
    return (
      <PulseCard
        title={matrix.title}
        subtitle={matrix.subtitle}
        icon={<Boxes className="h-4 w-4 text-order-fg" />}
      >
        <div className="text-xs text-content-4 italic">No matrix data yet.</div>
      </PulseCard>
    );
  }
  let maxCell = 0;
  for (const r of matrix.rows)
    for (const c of matrix.cols) {
      const v = matrix.cells[r]?.[c] || 0;
      if (v > maxCell) maxCell = v;
    }
  const intensity = (v: number): string => {
    if (v <= 0) return "bg-surface-2 text-content-4";
    const ratio = v / Math.max(maxCell, 1);
    if (ratio < 0.15)
      return "bg-order-bg text-order-fg ring-1 ring-order-border";
    if (ratio < 0.4)
      return "bg-order-bg text-order-fg ring-1 ring-order-border";
    if (ratio < 0.7)
      return "bg-order-bg text-order-fg ring-1 ring-order-border";
    return "bg-order-fg text-white shadow-sm";
  };
  const showRows = matrix.rows.slice(0, 12);
  const showCols = matrix.cols.slice(0, 10);
  return (
    <PulseCard
      title={matrix.title}
      subtitle={
        matrix.subtitle ||
        `${matrix.rows.length} ${matrix.rowLabel} × ${matrix.cols.length} ${matrix.colLabel}`
      }
      icon={<Boxes className="h-4 w-4 text-order-fg" />}
      action={
        <TotalChip
          total={Object.values(matrix.cells).reduce(
            (s, row) => s + Object.values(row).reduce((a, b) => a + b, 0),
            0,
          )}
          unit={matrix.unit || ""}
        />
      }
    >
      <div className="overflow-x-auto">
        <table className="min-w-full text-[11px]">
          <thead>
            <tr className="text-content-3">
              <th className="sticky left-0 bg-surface-1 pr-2 py-1 text-left font-bold uppercase tracking-wider text-[9px]">
                {matrix.rowLabel} \\ {matrix.colLabel}
              </th>
              {showCols.map((c) => (
                <th
                  key={c}
                  className="px-1.5 py-1 text-center font-mono font-bold text-[10px]"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {showRows.map((row) => (
              <tr key={row}>
                <td
                  className="sticky left-0 bg-surface-1 pr-2 py-0.5 text-[10px] font-medium text-content-2 truncate max-w-[160px]"
                  title={row}
                >
                  {row}
                </td>
                {showCols.map((col) => {
                  const v = matrix.cells[row]?.[col] || 0;
                  return (
                    <td key={col} className="px-0.5 py-0.5 text-center">
                      <span
                        className={cn(
                          "inline-flex h-6 w-12 items-center justify-center rounded-md font-mono font-bold tabular-nums text-[10px]",
                          intensity(v),
                        )}
                        title={`${row} × ${col} · ${fmt(v, 0)} ${matrix.unit || ""}`}
                      >
                        {v > 0 ? fmt(v, 0) : "—"}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {(matrix.rows.length > 12 || matrix.cols.length > 10) && (
          <div className="mt-2 text-[10px] text-content-4">
            Showing {showRows.length}/{matrix.rows.length} {matrix.rowLabel} ×{" "}
            {showCols.length}/{matrix.cols.length} {matrix.colLabel}
          </div>
        )}
      </div>
    </PulseCard>
  );
}

function PulseTopList({
  title,
  subtitle,
  rows,
}: {
  title: string;
  subtitle?: string;
  rows: Array<{
    label: string;
    sub?: string;
    value: string;
    tone?: "default" | "good" | "warn" | "bad";
  }>;
}) {
  if (rows.length === 0) {
    return (
      <PulseCard
        title={title}
        subtitle={subtitle}
        icon={<TrendingUp className="h-4 w-4 text-success-fg" />}
      >
        <div className="text-xs text-content-4 italic">No data yet.</div>
      </PulseCard>
    );
  }
  return (
    <PulseCard
      title={title}
      subtitle={subtitle}
      icon={<TrendingUp className="h-4 w-4 text-success-fg" />}
    >
      <div className="divide-y divide-line">
        {rows.map((r, i) => {
          const TONE = {
            default: "text-content-1",
            good: "text-success-fg",
            warn: "text-warning-fg",
            bad: "text-danger-fg",
          }[r.tone || "default"];
          return (
            <div
              key={i}
              className="flex items-center justify-between gap-2 py-2"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="inline-flex h-5 w-5 flex-none items-center justify-center rounded-full bg-surface-2 text-[10px] font-bold text-content-3 tabular-nums">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <div
                    className="text-xs font-bold text-content-2 truncate"
                    title={r.label}
                  >
                    {r.label}
                  </div>
                  {r.sub && (
                    <div className="text-[10px] text-content-3 truncate">
                      {r.sub}
                    </div>
                  )}
                </div>
              </div>
              <div
                className={cn(
                  "font-mono text-sm font-black tabular-nums flex-none",
                  TONE,
                )}
              >
                {r.value}
              </div>
            </div>
          );
        })}
      </div>
    </PulseCard>
  );
}

// ─── KPI Tile (rich + perf-friendly: no gradient overlay) ────────

function PulseKpiTile({
  label,
  value,
  sub,
  icon,
  tone = "default",
  trend,
  delta,
}: PulseKpi) {
  const TONE = {
    default: {
      stripe: "bg-order-fg",
      icon: "bg-order-bg text-order-fg",
      spark: "#6366f1",
    },
    good: {
      stripe: "bg-success-fg",
      icon: "bg-success-bg text-success-fg",
      spark: "#10b981",
    },
    warn: {
      stripe: "bg-warning-fg",
      icon: "bg-warning-bg text-warning-fg",
      spark: "#f59e0b",
    },
    bad: {
      stripe: "bg-danger-fg",
      icon: "bg-danger-bg text-danger-fg",
      spark: "#f43f5e",
    },
  }[tone];
  return (
    <div className="relative rounded-2xl border border-line bg-surface-1 p-3.5 shadow-sm">
      <div
        className={cn(
          "absolute left-0 top-0 bottom-0 w-1 rounded-l-2xl",
          TONE.stripe,
        )}
      />
      <div className="flex items-start justify-between gap-2 pl-1">
        <div className="text-[10px] font-black uppercase tracking-[0.16em] text-content-3 truncate">
          {label}
        </div>
        {icon && (
          <span
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-lg flex-none",
              TONE.icon,
            )}
          >
            {icon}
          </span>
        )}
      </div>
      <div className="mt-1.5 flex items-baseline gap-1.5 pl-1">
        <span className="font-display text-2xl font-black text-content-1 tabular-nums">
          {value}
        </span>
        {delta && (
          <span
            className={cn(
              "rounded px-1 py-0.5 text-[9px] font-black",
              delta.positive
                ? "bg-success-bg text-success-fg"
                : "bg-danger-bg text-danger-fg",
            )}
          >
            {delta.positive ? "▲" : "▼"} {delta.v}
          </span>
        )}
      </div>
      {sub && (
        <div className="mt-0.5 text-[10px] text-content-3 truncate pl-1">
          {sub}
        </div>
      )}
      {trend && trend.length > 1 && (
        <div className="mt-2 -mx-1">
          <MiniSparkline data={trend} color={TONE.spark} />
        </div>
      )}
    </div>
  );
}

function MiniSparkline({ data, color }: { data: number[]; color: string }) {
  const w = 120;
  const h = 24;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = Math.max(max - min, 1);
  const stepX = w / Math.max(data.length - 1, 1);
  const path = data
    .map((y, i) => {
      const x = i * stepX;
      const ny = h - ((y - min) / range) * (h - 4) - 2;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${ny.toFixed(1)}`;
    })
    .join(" ");
  const fill = `${path} L ${w} ${h} L 0 ${h} Z`;
  const id = `spark-${color.replace("#", "")}`;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="w-full"
      preserveAspectRatio="none"
      height="22"
    >
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fill} fill={`url(#${id})`} />
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ─── Micro Stat (dense secondary metric) ──────────────────────────

function MicroStat({ label, value, sub, tone = "default" }: PulseStat) {
  const TONE = {
    default: "text-content-1",
    good: "text-success-fg",
    warn: "text-warning-fg",
    bad: "text-danger-fg",
  }[tone];
  return (
    <div className="border-l-2 border-line pl-3">
      <div className="text-[9px] font-black uppercase tracking-wider text-content-3">
        {label}
      </div>
      <div
        className={cn("font-display text-base font-black tabular-nums", TONE)}
      >
        {value}
      </div>
      {sub && <div className="text-[10px] text-content-3 truncate">{sub}</div>}
    </div>
  );
}

// ─── Pulse Card shell ─────────────────────────────────────────────

function PulseCard({
  title,
  subtitle,
  icon,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      className="rounded-2xl border border-line bg-surface-1 shadow-sm"
      style={{ contentVisibility: "auto", containIntrinsicSize: "1px 320px" }}
    >
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          {icon}
          <div>
            <h3 className="font-display text-sm font-bold text-content-1">
              {title}
            </h3>
            {subtitle && (
              <div className="text-[10px] text-content-3">{subtitle}</div>
            )}
          </div>
        </div>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function TotalChip({ total, unit }: { total: number; unit: string }) {
  if (!Number.isFinite(total) || total <= 0) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-0.5 text-[10px] font-bold text-content-2">
      Σ <span className="font-mono">{fmt(total, 0)}</span> {unit}
    </span>
  );
}

// ─── Horizontal bars (richer with values right-aligned + colour swatch) ──

function HorizontalBars({
  entries,
  unit,
}: {
  entries: PulseBreakdownEntry[];
  unit: string;
}) {
  if (entries.length === 0)
    return <div className="text-xs text-content-4 italic">No data yet.</div>;
  const max = Math.max(...entries.map((e) => e.value), 1);
  const total = entries.reduce((s, e) => s + e.value, 0) || 1;
  return (
    <div className="space-y-2.5">
      {entries.map((e, i) => {
        const pct = (e.value / max) * 100;
        const sharePct = (e.value / total) * 100;
        const color = e.color || SOFT_COLORS[i % SOFT_COLORS.length];
        return (
          <div key={i}>
            <div className="flex items-center justify-between text-[11px]">
              <span
                className="flex items-center gap-1.5 font-bold text-content-2 truncate max-w-[55%]"
                title={e.label}
              >
                <span
                  className="inline-block h-2 w-2 rounded-sm flex-none"
                  style={{ backgroundColor: color }}
                />
                {e.label}
              </span>
              <span className="flex items-center gap-2">
                <span className="font-mono text-content-2 tabular-nums">
                  {fmt(e.value, 0)} {unit}
                </span>
                <span className="font-mono text-[9px] font-bold text-content-4 tabular-nums w-9 text-right">
                  {sharePct.toFixed(1)}%
                </span>
              </span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-surface-2 overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(pct, 1)}%`,
                  backgroundColor: color,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Donut (with cleaner legend) ──────────────────────────────────

function Donut({
  entries,
  unit,
}: {
  entries: PulseBreakdownEntry[];
  unit: string;
}) {
  if (entries.length === 0)
    return <div className="text-xs text-content-4 italic">No data yet.</div>;
  const total = entries.reduce((s, e) => s + e.value, 0) || 1;
  const r = 38;
  const C = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 110 110" width="120" height="120">
        <circle
          cx="55"
          cy="55"
          r={r}
          fill="none"
          stroke="#f1f5f9"
          strokeWidth="14"
        />
        {entries.map((e, i) => {
          const color = e.color || SOFT_COLORS[i % SOFT_COLORS.length];
          const len = (e.value / total) * C;
          const off = -acc;
          acc += len;
          return (
            <circle
              key={i}
              cx="55"
              cy="55"
              r={r}
              fill="none"
              stroke={color}
              strokeWidth="14"
              strokeDasharray={`${len} ${C - len}`}
              strokeDashoffset={off}
              transform="rotate(-90 55 55)"
              strokeLinecap="butt"
            />
          );
        })}
        <text
          x="55"
          y="51"
          textAnchor="middle"
          className="fill-content-1"
          style={{ fontSize: 14, fontWeight: 800 }}
        >
          {fmt(total, 0)}
        </text>
        <text
          x="55"
          y="64"
          textAnchor="middle"
          className="fill-content-3"
          style={{ fontSize: 8, fontWeight: 700, letterSpacing: 1.2 }}
        >
          TOTAL {unit}
        </text>
      </svg>
      <div className="flex-1 space-y-1.5 text-[11px] max-h-32 overflow-y-auto">
        {entries.map((e, i) => {
          const color = e.color || SOFT_COLORS[i % SOFT_COLORS.length];
          const pct = (e.value / total) * 100;
          return (
            <div key={i} className="flex items-center gap-2">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm flex-none"
                style={{ backgroundColor: color }}
              />
              <span
                className="flex-1 font-semibold text-content-2 truncate"
                title={e.label}
              >
                {e.label}
              </span>
              <span className="font-mono text-content-2 tabular-nums">
                {fmt(e.value, 0)}
              </span>
              <span className="font-mono font-bold text-content-3 w-9 text-right tabular-nums">
                {pct.toFixed(0)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Ageing card (richer) ─────────────────────────────────────────

function AgeingChart({ ageing }: { ageing: PulseAgeing }) {
  const total = ageing.fresh + ageing.aged + ageing.old;
  if (total === 0)
    return <div className="text-xs text-content-4 italic">No items yet.</div>;
  const f = (ageing.fresh / total) * 100;
  const a = (ageing.aged / total) * 100;
  const o = (ageing.old / total) * 100;
  return (
    <div className="space-y-3">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full ring-1 ring-line">
        <div
          className="bg-success-fg"
          style={{ width: `${f}%` }}
          title={`Fresh ${f.toFixed(0)}%`}
        />
        <div
          className="bg-warning-fg"
          style={{ width: `${a}%` }}
          title={`Aged ${a.toFixed(0)}%`}
        />
        <div
          className="bg-danger-fg"
          style={{ width: `${o}%` }}
          title={`Old ${o.toFixed(0)}%`}
        />
      </div>
      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <AgeBucket color="emerald" label="≤30 d" n={ageing.fresh} pct={f} />
        <AgeBucket color="amber" label="31–90 d" n={ageing.aged} pct={a} />
        <AgeBucket color="rose" label="90+ d" n={ageing.old} pct={o} />
      </div>
      <div className="rounded-lg bg-surface-2 px-3 py-2 text-[10px] text-content-3 ring-1 ring-line">
        <span className="font-bold text-content-1">{total}</span> items in
        window · <span className="font-bold text-danger-fg">{ageing.old}</span>{" "}
        need attention
      </div>
    </div>
  );
}

function AgeBucket({
  color,
  label,
  n,
  pct,
}: {
  color: "emerald" | "amber" | "rose";
  label: string;
  n: number;
  pct: number;
}) {
  const TONE = {
    emerald: "bg-success-bg ring-success-border text-success-fg",
    amber: "bg-warning-bg ring-warning-border text-warning-fg",
    rose: "bg-danger-bg ring-danger-border text-danger-fg",
  }[color];
  return (
    <div className={cn("rounded-lg px-2 py-1.5 ring-1", TONE)}>
      <div className="text-[9px] font-black uppercase tracking-wider opacity-70">
        {label}
      </div>
      <div className="font-mono text-sm font-bold tabular-nums">{fmt(n)}</div>
      <div className="text-[9px] opacity-60 tabular-nums">
        {pct.toFixed(0)}%
      </div>
    </div>
  );
}

// ─── Location tile (with mini bar) ────────────────────────────────

function LocationTile({
  entry,
  idx,
  max,
}: {
  entry: PulseBreakdownEntry;
  idx: number;
  max: number;
}) {
  const color = entry.color || SOFT_COLORS[idx % SOFT_COLORS.length];
  const pct = (entry.value / Math.max(max, 1)) * 100;
  return (
    <div className="rounded-xl border border-line bg-surface-2 p-2.5">
      <div className="flex items-center gap-1.5 text-[10px] font-bold text-content-3 uppercase tracking-wider">
        <span
          className="inline-block h-2 w-2 rounded-sm"
          style={{ backgroundColor: color }}
        />
        <span className="truncate" title={entry.label}>
          {entry.label}
        </span>
      </div>
      <div className="mt-1 font-mono text-sm font-bold text-content-1 tabular-nums">
        {fmt(entry.value, 0)}
      </div>
      <div className="mt-1 h-1 rounded-full bg-surface-2 overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.max(pct, 2)}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

// ─── Class tab bar (shared across inventory pages) ────────────────

export interface ClassTab {
  id: string;
  label: string;
  icon?: string;
  href: string;
  badge?: string | number;
}

export function ClassTabBar({
  tabs,
  activeId,
}: {
  tabs: ClassTab[];
  activeId: string;
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface-1 p-1.5 shadow-sm overflow-x-auto">
      <div className="inline-flex gap-1 min-w-max">
        {tabs.map((t) => {
          const active = t.id === activeId;
          return (
            <a
              key={t.id}
              href={t.href}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold",
                active
                  ? "bg-surface-3 text-white shadow-sm"
                  : "text-content-3 hover:bg-surface-2 hover:text-content-1",
              )}
            >
              {t.icon && (
                <span className="text-base leading-none">{t.icon}</span>
              )}
              {t.label}
              {typeof t.badge !== "undefined" && (
                <span
                  className={cn(
                    "ml-1 rounded-full px-1.5 py-0.5 text-[9px] font-black",
                    active
                      ? "bg-surface-1/20 text-white"
                      : "bg-surface-2 text-content-3",
                  )}
                >
                  {t.badge}
                </span>
              )}
            </a>
          );
        })}
      </div>
    </div>
  );
}

export const INVENTORY_CLASS_TABS: ClassTab[] = [
  { id: "summary", label: "Summary", icon: "🏠", href: "/inventory" },
  { id: "rolls", label: "Roll Explorer", icon: "🌀", href: "/inventory/rolls" },
  { id: "bulk", label: "Bulk Inventory", icon: "🧪", href: "/inventory/bulk" },
  {
    id: "packaging",
    label: "Packaging",
    icon: "📦",
    href: "/inventory/packaging",
  },
  {
    id: "addons",
    label: "Inks · Adhesives",
    icon: "🎨",
    href: "/inventory/addons",
  },
  {
    id: "grn",
    label: "GRN History",
    icon: "📥",
    href: "/inventory/grn-history",
  },
  {
    id: "period",
    label: "Stock Lifecycle",
    icon: "📅",
    href: "/inventory/stock-lifecycle",
  },
  {
    id: "trace",
    label: "Roll Genealogy",
    icon: "🌳",
    href: "/inventory/traceability",
  },
  {
    id: "transfers",
    label: "Inter-Plant",
    icon: "🚚",
    href: "/inventory/inter-plant",
  },
];

// ─── Pulse / Browse mode toggle ──────────────────────────────────

export function ModeToggle({
  mode,
  onChange,
}: {
  mode: "pulse" | "browse";
  onChange: (m: "pulse" | "browse") => void;
}) {
  return (
    <div className="inline-flex rounded-xl bg-surface-2 p-0.5 shadow-inner">
      <button
        onClick={() => onChange("pulse")}
        className={cn(
          "inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-[11px] font-bold",
          mode === "pulse"
            ? "bg-surface-1 text-success-fg shadow-sm ring-1 ring-success-border"
            : "text-content-3 hover:text-content-1",
        )}
      >
        <Activity className="h-3.5 w-3.5" /> Pulse
      </button>
      <button
        onClick={() => onChange("browse")}
        className={cn(
          "inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-[11px] font-bold",
          mode === "browse"
            ? "bg-surface-1 text-content-1 shadow-sm ring-1 ring-line"
            : "text-content-3 hover:text-content-1",
        )}
      >
        <Boxes className="h-3.5 w-3.5" /> Browse
      </button>
    </div>
  );
}

// ─── Subtle Hero (for inventory home) ─────────────────────────────

export function SubtleHero({
  eyebrow,
  title,
  subtitle,
  chips,
  actions,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  chips?: {
    icon?: React.ReactNode;
    label: string;
    value: string;
    tone?: "default" | "good" | "warn";
  }[];
  actions?: React.ReactNode;
}) {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-line bg-gradient-to-br from-white via-surface-2 to-order-bg px-5 py-4 shadow-sm">
      <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-order-fg via-order-fg to-order-fg" />
      <div className="flex flex-wrap items-start justify-between gap-3 pl-2">
        <div className="min-w-0">
          <div className="text-[10px] font-black uppercase tracking-[0.22em] text-order-fg">
            {eyebrow}
          </div>
          <h1 className="font-display text-2xl font-black text-content-1 mt-0.5 tracking-tight">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-1 text-xs text-content-3 max-w-2xl">{subtitle}</p>
          )}
          {chips && chips.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {chips.map((c, i) => {
                const TONE = {
                  default: "bg-surface-1 text-content-2 ring-line",
                  good: "bg-success-bg text-success-fg ring-success-border",
                  warn: "bg-warning-bg text-warning-fg ring-warning-border",
                }[c.tone || "default"];
                return (
                  <span
                    key={i}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold ring-1",
                      TONE,
                    )}
                  >
                    {c.icon}
                    <span>{c.label}</span>
                    <span className="font-mono tabular-nums">{c.value}</span>
                  </span>
                );
              })}
            </div>
          )}
        </div>
        {actions && (
          <div className="flex items-center gap-2 flex-none">{actions}</div>
        )}
      </div>
    </section>
  );
}
