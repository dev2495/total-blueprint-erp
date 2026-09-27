"use client";

import * as React from "react";
import { Check, ChevronLeft, ChevronRight, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

export const clean = (value: unknown) => String(value ?? "").trim();
const isBlank = (value: unknown) => {
  const text = clean(value);
  return !text || text === "-" || text === "—";
};

export const num = (value: unknown, digits = 1) =>
  Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: digits });

export const kgText = (value: unknown, digits = 2) =>
  `${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: digits > 1 ? 2 : 0, maximumFractionDigits: digits })} kg`;

export const apiError = (error: any) =>
  error?.response?.data?.error || error?.response?.data?.detail || error?.message || "Request failed.";

/** Split "PET-12 · 12µ + PE-40 · 40µ" into readable layer parts. */
export function parseLayers(layersLabel: unknown): { material: string; micron: string }[] {
  const text = clean(layersLabel);
  if (!text || /^\d+\s*layers?$/i.test(text)) return [];
  return text
    .split(/\s+\+\s+|\s+\/\s+/)
    .map((part) => {
      const [material, micron] = part.split(/\s+·\s+/);
      return { material: clean(material), micron: clean(micron) };
    })
    .filter((part) => part.material);
}

export function micronText(thickness: unknown) {
  const text = clean(thickness).replace(/\s*microns?$/i, "").replace(/µ$/, "");
  if (isBlank(text)) return "";
  return `${text.split("+").map((part) => part.trim()).join(" + ")} µ`;
}

/** Compact display id for long roll / gonny labels. */
export function compactUnitLabel(value: unknown, kind: "ROLL" | "GONNY" | "CTN") {
  const raw = clean(value);
  if (!raw) return kind;
  if (raw.length <= 18) return raw;
  const terminal = raw.match(/(?:^|-)(\d{2,5})(?:-(?:NEW|MOD|SPL|COMB|REM))?$/i);
  if (terminal) {
    const suffix = terminal[1].replace(/^0+(?=\d)/, "");
    return kind === "ROLL" ? `RDU-${suffix}` : `GNY-${suffix}`;
  }
  const token = raw.replace(/[^A-Z0-9]+/gi, "").slice(-7);
  return `${kind}-${token || raw.slice(-7)}`;
}

export const compactLocation = (value: unknown) =>
  clean(value)
    .replace(/\bFinished\s+Goods\s+Store\b/i, "FG store")
    .replace(/\bDispatch\s+Plant\b/i, "Dispatch")
    .replace(/\s+/g, " ")
    .trim();

/** Stable key for grouping units by sales-order line. */
export function lineScopeKey(row: any, fallback: string) {
  const explicit = clean(row?.sales_order_item_id);
  if (explicit) return explicit;
  const semantic = [
    clean(row?.product_code),
    clean(row?.product_name || row?.material__name || row?.template_name),
    clean(row?.size_label || row?.width_mm),
    clean(row?.thickness_label),
    clean(row?.grade_label),
  ]
    .filter(Boolean)
    .join("|");
  return semantic || fallback;
}

export const lineScopeName = (row: any, fallback: string) =>
  clean(row?.line_label || row?.sales_order_line_label || row?.display_label || row?.product_name || row?.material__name || row?.template_name) ||
  fallback;

export function lineScopeSpec(row: any) {
  return (
    [
      clean(row?.size_label || (row?.width_mm ? `${row.width_mm} mm` : "")),
      micronText(row?.thickness_label),
      isBlank(row?.grade_label) ? "" : clean(row?.grade_label),
    ]
      .filter(Boolean)
      .join(" · ") || "Order line"
  );
}

export const productionBatchText = (row: any) => clean(row?.production_batch_number || row?.batch_number || row?.batch_no);

export function routeNodeText(row: any) {
  const route = row?.route_node || {};
  const node = clean(route?.route_node_label || route?.label || route?.name || row?.route_node_id || route?.route_node_id || route?.id);
  const branch = clean(row?.route_branch_key || route?.route_branch_key || route?.branch_key);
  return [node, branch && branch !== node ? branch : ""].filter(Boolean).join(" · ");
}

/* ------------------------------------------------------------------ */
/* Pills & chips                                                       */
/* ------------------------------------------------------------------ */

export type Tone = "neutral" | "info" | "good" | "warn" | "bad" | "accent";

const toneClass: Record<Tone, string> = {
  neutral: "border-line bg-surface-2 text-content-2",
  info: "border-info-border bg-info-bg text-info-fg",
  good: "border-success-border bg-success-bg text-success-fg",
  warn: "border-warning-border bg-warning-bg text-warning-fg",
  bad: "border-danger-border bg-danger-bg text-danger-fg",
  accent: "border-order-border bg-order-bg text-order-fg",
};

const dotClass: Record<Tone, string> = {
  neutral: "bg-content-4",
  info: "bg-info-fg",
  good: "bg-success-fg",
  warn: "bg-warning-fg",
  bad: "bg-danger-fg",
  accent: "bg-order-fg",
};

export function Pill({ children, tone = "neutral", dot, className, title }: { children: React.ReactNode; tone?: Tone; dot?: boolean; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4",
        toneClass[tone],
        className,
      )}
    >
      {dot ? <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotClass[tone])} aria-hidden /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

export type UnitStage = "WAITING" | "OPEN" | "SEALED" | "RELEASED" | "READY" | "SELECTED";

const stageMeta: Record<UnitStage, { label: string; tone: Tone }> = {
  WAITING: { label: "To pack", tone: "warn" },
  OPEN: { label: "Open · weigh", tone: "info" },
  SEALED: { label: "Sealed · release", tone: "accent" },
  RELEASED: { label: "In Dispatch Bay", tone: "good" },
  READY: { label: "Ready to ship", tone: "good" },
  SELECTED: { label: "On this challan", tone: "info" },
};

export function StagePill({ stage }: { stage: UnitStage }) {
  const meta = stageMeta[stage];
  return (
    <Pill tone={meta.tone} dot>
      {meta.label}
    </Pill>
  );
}

export function KindBadge({ kind }: { kind: "ROLL" | "GONNY" | "CTN" | "BATCH" }) {
  const label = kind === "BATCH" ? "Batch" : kind === "ROLL" ? "Roll" : kind === "CTN" ? "Carton" : "Gonny";
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-md px-1.5 text-[10.5px] font-semibold uppercase tracking-[0.04em]",
        kind === "ROLL" ? "bg-info-bg text-info-fg" : kind === "BATCH" ? "bg-warning-bg text-warning-fg" : "bg-order-bg text-order-fg",
      )}
    >
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Manifest table cells                                                */
/* ------------------------------------------------------------------ */

/** Unit identity: display id, full label on hover, type and location. */
export function UnitCell({ label, kind, location, sub }: { label: unknown; kind: "ROLL" | "GONNY" | "CTN" | "BATCH"; location?: unknown; sub?: React.ReactNode }) {
  // Always show the full label: compacted ids collided for long labels
  // (e.g. every roll of an order rendered as the same short code).
  const raw = clean(label);
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        <KindBadge kind={kind} />
      </div>
      <div title={raw} className="mt-1 break-all font-mono text-[11.5px] font-semibold leading-snug text-content-1">
        {raw || "—"}
      </div>
      {sub ? <div className="mt-0.5 truncate text-[11px] text-content-3">{sub}</div> : null}
      {!isBlank(location) ? (
        <div title={clean(location)} className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-content-4">
          <MapPin className="h-3 w-3 shrink-0" aria-hidden />
          <span className="truncate">{compactLocation(location)}</span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Full product detail for a physical unit: product, code, size, every layer
 * with its micron, total thickness, grade, and production batch / route.
 */
export function ProductSpecCell({ row, fallbackName, unitLabel }: { row: any; fallbackName: string; unitLabel?: unknown }) {
  const layers = parseLayers(row?.layers_label);
  const size = clean(row?.size_label) || (row?.width_mm ? `${num(row.width_mm, 0)} mm` : "");
  const thickness = micronText(row?.thickness_label);
  const grade = isBlank(row?.grade_label) ? "" : clean(row?.grade_label);
  const rawBatch = productionBatchText(row);
  // A roll's batch number is often its own label; don't repeat it.
  const batch = rawBatch && rawBatch !== clean(unitLabel) && rawBatch !== clean(row?.label_id) && rawBatch !== clean(row?.dispatch_unit_no) ? rawBatch : "";
  const route = routeNodeText(row);
  const code = isBlank(row?.product_code) ? "" : clean(row?.product_code);
  const name = clean(row?.product_name || row?.material__name || row?.template_name) || fallbackName;
  const template = clean(row?.template_name);
  return (
    <div className="min-w-0 space-y-1.5">
      <div>
        <div className="text-[13px] font-semibold leading-snug text-content-1">{name}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-content-3">
          {code ? <span className="font-mono">{code}</span> : null}
          {template && template !== name ? <span>{template}</span> : null}
          {row?.source_stock_order_no ? <span>Stock claim · {clean(row.source_stock_order_no)}</span> : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {size ? (
          <span className="inline-flex h-6 items-center rounded-md bg-content-1 px-2 font-mono text-[11.5px] font-semibold text-surface-1">{size}</span>
        ) : null}
        {thickness ? (
          <span className="inline-flex h-6 items-center rounded-md border border-line bg-surface-2 px-2 font-mono text-[11.5px] font-medium text-content-1">{thickness}</span>
        ) : null}
        {grade ? (
          <span className="inline-flex h-6 items-center rounded-md border border-warning-border bg-warning-bg px-2 text-[11.5px] font-medium text-warning-fg">{grade}</span>
        ) : null}
      </div>
      {layers.length ? (
        <div className="flex flex-wrap items-center gap-1" aria-label="Layer stack">
          {layers.map((layer, index) => (
            <span
              key={`${layer.material}-${index}`}
              className="inline-flex items-center gap-1 rounded-md border border-line bg-surface-1 px-1.5 py-0.5 text-[11px] text-content-2"
            >
              <span className="grid h-3.5 w-3.5 place-items-center rounded-[4px] bg-surface-2 text-[9px] font-semibold text-content-3">{index + 1}</span>
              <span className="max-w-[160px] truncate">{layer.material}</span>
              {layer.micron ? <span className="font-mono text-content-4">{layer.micron}</span> : null}
            </span>
          ))}
        </div>
      ) : null}
      {batch || route ? (
        <div className="flex flex-wrap items-center gap-1 text-[11px] text-content-3">
          {batch ? <span className="rounded bg-info-bg px-1.5 py-0.5 font-mono text-info-fg">{batch}</span> : null}
          {route ? <span className="rounded bg-surface-2 px-1.5 py-0.5">{route}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

export const titleCase = (value: unknown) =>
  clean(value)
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b([a-z])/g, (match) => match.toUpperCase());

/** Right-aligned weight figure with unit. */
export function Weight({ value, muted, estimate }: { value: unknown; muted?: boolean; estimate?: boolean }) {
  const n = Number(value || 0);
  return (
    <span className={cn("whitespace-nowrap text-[12.5px] tabular-nums", muted ? "text-content-3" : "font-semibold text-content-1")}>
      {n ? num(n, 2) : "—"}
      {n ? <span className="ml-0.5 text-[10.5px] font-normal text-content-4">kg</span> : null}
      {estimate && n ? <span className="ml-1 text-[10px] font-normal text-content-4">exp</span> : null}
    </span>
  );
}

/** Net / tare / gross stacked in one compact, aligned cell. */
export function WeightStack({
  net,
  tare,
  gross,
  grossEstimate,
  note,
}: {
  net: unknown;
  tare: unknown;
  gross: unknown;
  grossEstimate?: boolean;
  note?: React.ReactNode;
}) {
  const row = (label: string, value: unknown, strong?: boolean, estimate?: boolean) => (
    <div className="flex items-baseline justify-end gap-2">
      <span className="text-[10.5px] text-content-4">{label}</span>
      <span className={cn("min-w-[64px] text-right text-[12.5px] tabular-nums", strong ? "font-semibold text-content-1" : "text-content-2")}>
        {Number(value || 0) ? num(value, 2) : "—"}
        {Number(value || 0) ? <span className="ml-0.5 text-[10.5px] font-normal text-content-4">{estimate ? "kg exp" : "kg"}</span> : null}
      </span>
    </div>
  );
  return (
    <div className="space-y-0.5">
      {row("Net", net)}
      {row("Tare", tare)}
      {row("Gross", gross, true, grossEstimate)}
      {note ? <div className="pt-0.5 text-right text-[11px]">{note}</div> : null}
    </div>
  );
}

export function SelectBox({ checked, onChange, label, disabled, testId, index }: { checked: boolean; onChange: () => void; label: string; disabled?: boolean; testId?: string; index?: number }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      data-testid={testId}
      disabled={disabled}
      onClick={onChange}
      className={cn(
        "grid h-6 w-6 place-items-center rounded-md border text-[10.5px] font-semibold transition-[background-color,border-color,transform] duration-150 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40",
        checked ? "border-primary bg-primary text-white" : "border-line-strong bg-surface-1 text-content-4 hover:border-primary",
      )}
    >
      {checked ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : index !== undefined ? index : null}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Layout pieces                                                       */
/* ------------------------------------------------------------------ */

/** Manifest table shell: sticky header, consistent density and hover. */
export function ManifestTable({ children, minWidth = 980, label, className }: { children: React.ReactNode; minWidth?: number; label: string; className?: string }) {
  return (
    <div
      className={cn("overflow-auto overscroll-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}
      tabIndex={0}
      role="region"
      aria-label={label}
    >
      <table className="erp-manifest w-full border-separate border-spacing-0 text-left text-[12.5px]" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

export function Th({ children, align = "left", className }: { children?: React.ReactNode; align?: "left" | "right" | "center"; className?: string }) {
  return (
    <th
      scope="col"
      className={cn(
        "sticky top-0 z-[1] border-b border-line bg-surface-2/95 px-3 py-2.5 text-[11px] font-medium text-content-3 backdrop-blur",
        align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({ children, align = "left", className }: { children?: React.ReactNode; align?: "left" | "right" | "center"; className?: string }) {
  return (
    <td
      className={cn(
        "border-b border-line px-3 py-3 align-top",
        align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left",
        className,
      )}
    >
      {children}
    </td>
  );
}

export function Pager({ page, pageCount, onPageChange, testId }: { page: number; pageCount: number; onPageChange: (page: number) => void; testId: string }) {
  if (pageCount <= 1) return null;
  const pages = Array.from({ length: pageCount }, (_, i) => i + 1).filter(
    (p) => p === 1 || p === pageCount || Math.abs(p - page) <= 1,
  );
  return (
    <nav className="flex items-center gap-1" aria-label="Pagination">
      <button
        type="button"
        data-testid={`${testId}-prev`}
        disabled={page <= 1}
        onClick={() => onPageChange(Math.max(1, page - 1))}
        className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-surface-1 text-content-2 transition hover:bg-surface-2 disabled:opacity-40"
        aria-label="Previous page"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      {pages.map((item, index) => (
        <React.Fragment key={item}>
          {index > 0 && item - pages[index - 1] > 1 ? <span className="px-1 text-content-4">…</span> : null}
          <button
            type="button"
            data-testid={`${testId}-${item}`}
            onClick={() => onPageChange(item)}
            aria-current={item === page ? "page" : undefined}
            className={cn(
              "h-8 min-w-8 rounded-lg px-2 text-[12px] font-medium tabular-nums transition",
              item === page ? "bg-content-1 text-surface-1" : "text-content-2 hover:bg-surface-2",
            )}
          >
            {item}
          </button>
        </React.Fragment>
      ))}
      <button
        type="button"
        data-testid={`${testId}-next`}
        disabled={page >= pageCount}
        onClick={() => onPageChange(Math.min(pageCount, page + 1))}
        className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-surface-1 text-content-2 transition hover:bg-surface-2 disabled:opacity-40"
        aria-label="Next page"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </nav>
  );
}

/** Pill-group filter (keeps each option a real button with its own test id). */
export function FilterGroup<T extends string>({
  value,
  onChange,
  options,
  testIdPrefix,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: React.ReactNode; count?: number }[];
  testIdPrefix: string;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex items-center rounded-xl border border-line bg-surface-2 p-0.5">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            data-testid={`${testIdPrefix}-${option.value.toLowerCase()}`}
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-[10px] px-2.5 text-[12.5px] font-medium transition-[background-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active ? "bg-surface-1 text-content-1 shadow-[var(--shadow-sm)]" : "text-content-3 hover:text-content-1",
            )}
          >
            {option.label}
            {option.count !== undefined ? (
              <span className={cn("rounded-md px-1 text-[11px] tabular-nums", active ? "bg-surface-2 text-content-2" : "text-content-4")}>{option.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export const toolbarSelectClass =
  "h-9 rounded-xl border border-line bg-surface-1 pl-3 pr-8 text-[12.5px] font-medium text-content-1 shadow-[var(--shadow-sm)] transition hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** A metric in the selected-order header. */
export function OrderMetric({ label, value, sub, tone }: { label: React.ReactNode; value: React.ReactNode; sub?: React.ReactNode; tone?: Tone }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface-1 px-3.5 py-2.5">
      <div className="truncate text-[11px] font-medium text-content-3">{label}</div>
      <div className={cn("mt-1 truncate text-[17px] font-semibold tracking-[-0.02em] tabular-nums", tone === "good" ? "text-success-fg" : tone === "warn" ? "text-warning-fg" : tone === "bad" ? "text-danger-fg" : "text-content-1")}>
        {value}
      </div>
      {sub ? <div className="mt-0.5 truncate text-[11px] text-content-3">{sub}</div> : null}
    </div>
  );
}

/** Circular progress used in order headers. */
export function ProgressRing({ value, size = 52, label }: { value: number; size?: number; label?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={label ?? `${pct}% complete`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border-soft)" strokeWidth={5} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={pct >= 100 ? "var(--viz-good)" : "var(--viz-1)"}
          strokeWidth={5}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (pct / 100) * c}
          style={{ transition: "stroke-dashoffset 600ms cubic-bezier(0.22,1,0.36,1)" }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-[12px] font-semibold tabular-nums text-content-1">{pct}%</div>
    </div>
  );
}

/** Floating bulk-action bar anchored to the bottom of the workspace. */
export function ActionBar({ children, visible = true, className }: { children: React.ReactNode; visible?: boolean; className?: string }) {
  return (
    <div
      className={cn(
        "sticky bottom-3 z-20 transition-[opacity,transform] duration-200 ease-out",
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0",
        className,
      )}
    >
      <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface-1/90 p-3 shadow-[var(--shadow-lg)] backdrop-blur-xl backdrop-saturate-150 md:flex-row md:items-center md:justify-between">
        {children}
      </div>
    </div>
  );
}
