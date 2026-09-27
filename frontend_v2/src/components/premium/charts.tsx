"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";
export { Sparkline } from "./sparkline";

import { VIZ, compactNumber, vizColor, type SeriesDef } from "./viz";
export { VIZ, compactNumber, vizColor };
export type { SeriesDef };

const axisTick = { fill: "var(--viz-muted)", fontSize: 11 };

function ChartTooltip({
  active,
  payload,
  label,
  valueFormat,
  labelFormat,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | string; color?: string; dataKey?: string | number; payload?: Record<string, unknown> }>;
  label?: string | number;
  valueFormat?: (value: number, key?: string) => string;
  labelFormat?: (label: string) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="min-w-[150px] rounded-xl border border-line bg-surface-1/95 px-3 py-2.5 text-[12px] shadow-[var(--shadow-lg)] backdrop-blur-md">
      {label !== undefined && label !== "" ? (
        <div className="mb-1.5 font-medium text-content-1">{labelFormat ? labelFormat(String(label)) : label}</div>
      ) : null}
      <div className="space-y-1">
        {payload.map((item) => (
          <div key={String(item.dataKey ?? item.name)} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-content-3">
              <span className="h-2 w-2 rounded-full" style={{ background: item.color }} aria-hidden />
              {item.name}
            </span>
            <span className="font-medium text-content-1 tabular-nums">
              {typeof item.value === "number"
                ? valueFormat
                  ? valueFormat(item.value, String(item.dataKey))
                  : item.value.toLocaleString("en-IN", { maximumFractionDigits: 2 })
                : item.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ChartLegend({ series, className }: { series: SeriesDef[]; className?: string }) {
  if (series.length < 2) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-content-3", className)}>
      {series.map((s, i) => (
        <span key={s.key} className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: s.color ?? vizColor(i) }} aria-hidden />
          {s.label}
        </span>
      ))}
    </div>
  );
}

/** Change over time: 2px lines with a faint area, crosshair tooltip. */
export function TrendArea<T extends Record<string, unknown>>({
  data,
  xKey,
  series,
  height = 240,
  valueFormat,
  xFormat,
  stacked,
  className,
}: {
  data: T[];
  xKey: keyof T & string;
  series: SeriesDef[];
  height?: number;
  valueFormat?: (value: number, key?: string) => string;
  xFormat?: (value: string) => string;
  stacked?: boolean;
  className?: string;
}) {
  const gradientId = React.useId().replace(/:/g, "");
  return (
    <div className={cn("w-full", className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <defs>
            {series.map((s, i) => (
              <linearGradient key={s.key} id={`${gradientId}-${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color ?? vizColor(i)} stopOpacity={0.22} />
                <stop offset="100%" stopColor={s.color ?? vizColor(i)} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid vertical={false} stroke="var(--viz-grid)" strokeDasharray="0" />
          <XAxis
            dataKey={xKey}
            tickLine={false}
            axisLine={{ stroke: "var(--viz-axis)" }}
            tick={axisTick}
            tickFormatter={xFormat}
            minTickGap={24}
            tickMargin={8}
          />
          <YAxis tickLine={false} axisLine={false} tick={axisTick} tickFormatter={(v: number) => compactNumber(v)} width={48} />
          <Tooltip
            cursor={{ stroke: "var(--viz-axis)", strokeWidth: 1 }}
            content={<ChartTooltip valueFormat={valueFormat} labelFormat={xFormat} />}
          />
          {series.map((s, i) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stackId={stacked ? "a" : undefined}
              stroke={s.color ?? vizColor(i)}
              strokeWidth={2}
              fill={`url(#${gradientId}-${i})`}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface-1)" }}
              dot={false}
              isAnimationActive
              animationDuration={600}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Magnitude by category (vertical). Rounded data-ends, 2px gaps. */
export function Bars<T extends Record<string, unknown>>({
  data,
  xKey,
  series,
  height = 240,
  valueFormat,
  xFormat,
  stacked,
  className,
  colorByIndex,
}: {
  data: T[];
  xKey: keyof T & string;
  series: SeriesDef[];
  height?: number;
  valueFormat?: (value: number, key?: string) => string;
  xFormat?: (value: string) => string;
  stacked?: boolean;
  className?: string;
  /** Single series only: colour each bar by its entity (category) index. */
  colorByIndex?: boolean;
}) {
  return (
    <div className={cn("w-full", className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
          <XAxis
            dataKey={xKey}
            tickLine={false}
            axisLine={{ stroke: "var(--viz-axis)" }}
            tick={axisTick}
            tickFormatter={xFormat}
            interval="preserveStartEnd"
            minTickGap={16}
            tickMargin={8}
          />
          <YAxis tickLine={false} axisLine={false} tick={axisTick} tickFormatter={(v: number) => compactNumber(v)} width={48} />
          <Tooltip cursor={{ fill: "var(--viz-grid)", opacity: 0.6 }} content={<ChartTooltip valueFormat={valueFormat} labelFormat={xFormat} />} />
          {series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              stackId={stacked ? "a" : undefined}
              fill={s.color ?? vizColor(i)}
              radius={stacked ? (i === series.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]) : [4, 4, 0, 0]}
              stroke="var(--surface-1)"
              strokeWidth={stacked ? 1 : 0}
              maxBarSize={36}
              animationDuration={600}
            >
              {colorByIndex && series.length === 1
                ? data.map((_, index) => <Cell key={index} fill={vizColor(index)} />)
                : null}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Part-to-whole with a centre headline. Keep to ≤ 6 slices; fold the rest. */
export function Donut({
  data,
  height = 200,
  centerLabel,
  centerValue,
  valueFormat,
  className,
}: {
  data: { name: string; value: number; color?: string }[];
  height?: number;
  centerLabel?: React.ReactNode;
  centerValue?: React.ReactNode;
  valueFormat?: (value: number) => string;
  className?: string;
}) {
  const clean = data.filter((d) => d.value > 0);
  return (
    <div className={cn("relative w-full", className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip content={<ChartTooltip valueFormat={valueFormat ? (v) => valueFormat(v) : undefined} />} />
          <Pie
            data={clean}
            dataKey="value"
            nameKey="name"
            innerRadius="68%"
            outerRadius="92%"
            paddingAngle={clean.length > 1 ? 1.5 : 0}
            stroke="var(--surface-1)"
            strokeWidth={2}
            cornerRadius={4}
            animationDuration={650}
          >
            {clean.map((d, i) => (
              <Cell key={d.name} fill={d.color ?? vizColor(data.indexOf(d) >= 0 ? data.indexOf(d) : i)} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      {centerValue !== undefined ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-[20px] font-semibold tracking-[-0.03em] text-content-1 tabular-nums">{centerValue}</div>
          {centerLabel ? <div className="mt-0.5 text-[11px] text-content-3">{centerLabel}</div> : null}
        </div>
      ) : null}
    </div>
  );
}



export { RankedBars, CompositionBar } from "./bars";
