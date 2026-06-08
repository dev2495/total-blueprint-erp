"use client";

/**
 * V3.6 Roll Genealogy Workspace
 *
 * Single-page roll lifecycle viewer with hero, search, KPI strip, full lineage
 * tree, vertical timeline, weight-flow sankey-style chart, and ancestor chain.
 */

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Boxes,
  ChevronRight,
  CornerDownRight,
  Factory,
  GitBranch,
  GitCommit,
  History,
  Layers,
  MapPin,
  Search,
  Sparkles,
  TrendingDown,
  Weight,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GradientHero } from "@/components/erp/gradient-hero";
import { cn } from "@/lib/utils";
import {
  observabilityApi,
  type RollTraceResponse,
  type GenealogyNode,
} from "@/services/observability";
import { listRolls, type Roll } from "@/services/rolls";
import { ClassTabBar, INVENTORY_CLASS_TABS } from "./pulse-view";
import { formatDisplayDateTime } from "@/lib/date-format";

function fmtKg(n: any, d = 2): string {
  const v = Number(n);
  return Number.isFinite(v) ? `${v.toFixed(d)} kg` : "—";
}
function fmtDate(s?: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  return formatDisplayDateTime(d);
}
function countNodes(node?: GenealogyNode): number {
  if (!node) return 0;
  return (
    1 +
    (Array.isArray(node.children)
      ? node.children.reduce((n, c) => n + countNodes(c as GenealogyNode), 0)
      : 0)
  );
}

function statusTone(status?: string | null) {
  const k = String(status || "").toUpperCase();
  if (k === "AVAILABLE")
    return "bg-success-bg text-success-fg ring-success-border";
  if (k === "RESERVED" || k === "IN_PROCESS")
    return "bg-warning-bg text-warning-fg ring-warning-border";
  if (k === "CONSUMED") return "bg-line text-content-2 ring-line-strong";
  return "bg-surface-2 text-content-2 ring-line";
}

function roleTone(role?: string | null) {
  const k = String(role || "").toUpperCase();
  if (k === "REMAINDER")
    return "bg-warning-bg text-warning-fg ring-warning-border";
  if (k === "OUTPUT" || k === "SPLIT_OUTPUT")
    return "bg-info-bg text-primary ring-info-border";
  if (k === "FG") return "bg-success-bg text-success-fg ring-success-border";
  return "bg-order-bg text-order-fg ring-order-border";
}

export function TraceabilityV36() {
  const [query, setQuery] = React.useState("");
  const [errorText, setErrorText] = React.useState("");
  const [result, setResult] = React.useState<RollTraceResponse | null>(null);

  const rollsQuery = useQuery({
    queryKey: ["traceability-roll-options-v36"],
    queryFn: () => listRolls(),
    staleTime: 60_000,
  });
  const rollOptions = React.useMemo(() => {
    const rows = Array.isArray(rollsQuery.data) ? rollsQuery.data : [];
    return rows
      .slice()
      .sort((a: Roll, b: Roll) => {
        const at = new Date(a.created_at || "").getTime();
        const bt = new Date(b.created_at || "").getTime();
        return (Number.isFinite(bt) ? bt : 0) - (Number.isFinite(at) ? at : 0);
      })
      .slice(0, 50);
  }, [rollsQuery.data]);

  const traceMutation = useMutation({
    mutationFn: (q: string) => observabilityApi.getRollTrace(q),
    onSuccess: (data) => {
      setResult(data);
      setErrorText("");
    },
    onError: (err: any) => {
      setResult(null);
      setErrorText(err?.response?.data?.error || "Unable to trace this roll.");
    },
  });

  const r = result?.roll;
  const g = result?.genealogy;
  const timeline = g?.timeline || [];
  const ancestors = g?.ancestors || [];
  const trees = g?.trees || [];
  const totalNodes = trees.reduce(
    (n, t) => n + countNodes(t as GenealogyNode),
    0,
  );
  const childrenCount = Math.max(0, totalNodes - trees.length);

  // Weight flow stats
  const flow = React.useMemo(() => {
    if (!r) return { current: 0, original: 0, consumed: 0, yield: 0 };
    const current = Number(r.weight_kg || 0);
    const original = Number(r.original_weight_kg || current);
    const consumed = Math.max(0, original - current);
    const yieldPct =
      original > 0 ? Math.round((current / original) * 100) : 100;
    return { current, original, consumed, yield: yieldPct };
  }, [r]);

  return (
    <div className="space-y-4 pb-12">
      <ClassTabBar tabs={INVENTORY_CLASS_TABS} activeId="trace" />
      <GradientHero
        eyebrow="Inventory · V3.6 · traceability"
        title="Roll genealogy &amp; lifecycle"
        subtitle="Every kilogram tells a story. Trace any roll back to GRN and forward to finished pouches."
        palette="blue"
        chips={[
          {
            icon: <GitBranch className="h-3.5 w-3.5" />,
            label: "Trees",
            value: `${trees.length}`,
            tone: "ok",
          },
          {
            icon: <CornerDownRight className="h-3.5 w-3.5" />,
            label: "Lineage",
            value: `${childrenCount}`,
            tone: "violet",
          },
          {
            icon: <History className="h-3.5 w-3.5" />,
            label: "Events",
            value: `${timeline.length}`,
            tone: "ok",
          },
        ]}
        actions={
          <Link
            href="/inventory"
            className="inline-flex items-center gap-1.5 rounded-xl bg-surface-1/15 px-4 py-1.5 text-xs font-bold text-white ring-1 ring-surface-1/30 hover:bg-surface-1/25"
          >
            <Layers className="h-3.5 w-3.5" /> Back to stock
          </Link>
        }
      />

      {/* Search bar */}
      <section className="rounded-2xl border border-line bg-surface-1 p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[280px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-4" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && query.trim())
                  traceMutation.mutate(query.trim());
              }}
              placeholder="Roll label (TPP/RM/2026/0001) or UUID…"
              className="h-12 rounded-xl pl-10 font-mono text-sm"
            />
          </div>
          <select
            className="h-12 rounded-xl border border-line bg-surface-1 px-3 text-sm font-mono"
            value=""
            onChange={(e) => {
              if (!e.target.value) return;
              setQuery(e.target.value);
              traceMutation.mutate(e.target.value);
            }}
          >
            <option value="">Recent rolls…</option>
            {rollOptions.map((roll: any) => (
              <option key={roll.id} value={roll.id}>
                {roll.label_id} · {Number(roll.weight_kg || 0).toFixed(2)}kg
              </option>
            ))}
          </select>
          <Button
            className="h-12 rounded-xl bg-primary px-5 text-sm font-bold text-white hover:bg-primary"
            disabled={traceMutation.isPending || !query.trim()}
            onClick={() => traceMutation.mutate(query.trim())}
          >
            {traceMutation.isPending ? "Tracing…" : "Trace roll →"}
          </Button>
          {result?.matched_by && (
            <span className="rounded-md bg-info-bg px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-primary ring-1 ring-info-border">
              Matched · {result.matched_by.replace("_", " ")}
            </span>
          )}
        </div>
        {errorText && (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-danger-bg px-3 py-2 text-xs font-bold text-danger-fg ring-1 ring-danger-border">
            <AlertTriangle className="h-3.5 w-3.5" /> {errorText}
          </div>
        )}
      </section>

      {!r && !traceMutation.isPending && <EmptyState />}

      {r && g && (
        <>
          {/* KPI strip */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Kpi
              tone="blue"
              icon="⚖️"
              label="Current weight"
              value={fmtKg(r.weight_kg)}
            />
            <Kpi
              tone="violet"
              icon="📦"
              label="Original weight"
              value={fmtKg(r.original_weight_kg)}
            />
            <Kpi
              tone="emerald"
              icon="🌳"
              label="Lineage children"
              value={`${childrenCount}`}
            />
            <Kpi
              tone="amber"
              icon="🕒"
              label="Timeline events"
              value={`${timeline.length}`}
            />
            <Kpi tone="rose" icon="🎯" label="Yield" value={`${flow.yield}%`} />
          </div>

          {/* Header card */}
          <section className="rounded-2xl border border-line bg-surface-1 shadow-sm">
            <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line bg-gradient-to-r from-info-bg via-white to-white px-5 py-4">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-primary">
                  Roll header
                </div>
                <h2 className="font-display text-lg font-bold text-content-1">
                  {r.label_id}
                </h2>
                <div className="mt-0.5 text-xs text-content-3">
                  {r.material_name || "—"} · {r.grade_name || "no grade"}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1",
                    roleTone(r.roll_role),
                  )}
                >
                  {r.roll_role || "ROLL"}
                </span>
                <span
                  className={cn(
                    "rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1",
                    statusTone(r.status),
                  )}
                >
                  {r.status || "—"}
                </span>
                {r.job_number && (
                  <span className="rounded-md bg-surface-2 px-2 py-0.5 font-mono text-[10px] font-bold text-content-2 ring-1 ring-line">
                    JOB · {r.job_number}
                  </span>
                )}
              </div>
            </header>
            <div className="grid grid-cols-2 gap-2 p-4 md:grid-cols-4">
              <Field label="Stage" value={r.stage_name || "—"} />
              <Field
                label="Plant"
                value={r.plant_name || "—"}
                icon={<Factory className="h-3.5 w-3.5 text-primary" />}
              />
              <Field
                label="Location"
                value={r.location_name || "—"}
                icon={<MapPin className="h-3.5 w-3.5 text-primary" />}
              />
              <Field
                label="Width × thickness"
                value={`${Number(r.width_mm || 0)}mm × ${Number(r.thickness_micron || 0)}μ`}
              />
              <Field label="Created" value={fmtDate(r.created_at)} />
              <Field label="Material code" value={r.material_code || "—"} />
            </div>

            {/* Weight flow visualisation */}
            <div className="border-t border-line px-5 py-4">
              <div className="flex items-center gap-2 mb-2">
                <Weight className="h-4 w-4 text-primary" />
                <span className="text-[10px] font-black uppercase tracking-[0.22em] text-content-3">
                  Weight flow · original → consumed → current
                </span>
              </div>
              <WeightFlow
                current={flow.current}
                consumed={flow.consumed}
                original={Math.max(flow.original, 1)}
              />
              <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                <div className="rounded-lg bg-info-bg px-2.5 py-1.5 ring-1 ring-info-border">
                  <div className="text-[9px] font-black uppercase text-primary">
                    Current
                  </div>
                  <div className="font-mono font-bold text-primary">
                    {fmtKg(flow.current)}
                  </div>
                </div>
                <div className="rounded-lg bg-danger-bg px-2.5 py-1.5 ring-1 ring-danger-border">
                  <div className="text-[9px] font-black uppercase text-danger-fg">
                    Consumed
                  </div>
                  <div className="font-mono font-bold text-danger-fg">
                    {fmtKg(flow.consumed)}
                  </div>
                </div>
                <div className="rounded-lg bg-order-bg px-2.5 py-1.5 ring-1 ring-order-border">
                  <div className="text-[9px] font-black uppercase text-order-fg">
                    Original
                  </div>
                  <div className="font-mono font-bold text-order-fg">
                    {fmtKg(flow.original)}
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Ancestors */}
          {ancestors.length > 0 && (
            <section className="rounded-2xl border border-line bg-surface-1 shadow-sm">
              <header className="border-b border-line bg-gradient-to-r from-order-bg via-white to-white px-5 py-3">
                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-order-fg">
                  Ancestor chain · oldest → this roll
                </div>
                <h3 className="font-display text-base font-bold text-content-1">
                  Where did this come from
                </h3>
              </header>
              <div className="overflow-x-auto p-4">
                <div className="flex items-center gap-2 min-w-max">
                  {ancestors.map((a, i) => (
                    <React.Fragment key={a.id}>
                      <div className="rounded-xl border border-order-border bg-order-bg px-3 py-2 min-w-[150px]">
                        <div className="font-mono text-xs font-bold text-order-fg">
                          {a.label_id}
                        </div>
                        <div className="text-[10px] text-order-fg font-bold uppercase">
                          Stage {a.stage_index}
                        </div>
                        <div className="font-mono text-[10px] text-content-3">
                          {Number(a.weight_kg).toFixed(2)} kg
                        </div>
                      </div>
                      {i < ancestors.length - 1 && (
                        <ArrowRight className="h-4 w-4 flex-none text-order-fg" />
                      )}
                    </React.Fragment>
                  ))}
                  <ArrowRight className="h-4 w-4 flex-none text-info-fg" />
                  <div className="rounded-xl border-2 border-primary bg-info-bg px-3 py-2 min-w-[150px] shadow-sm ring-2 ring-info-border">
                    <div className="font-mono text-xs font-bold text-primary">
                      {r.label_id}
                    </div>
                    <div className="text-[10px] text-primary font-bold uppercase">
                      This roll
                    </div>
                    <div className="font-mono text-[10px] text-content-3">
                      {Number(r.weight_kg || 0).toFixed(2)} kg
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Two-pane: Tree + Timeline */}
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <section className="rounded-2xl border border-line bg-surface-1 shadow-sm">
              <header className="border-b border-line bg-gradient-to-r from-info-bg via-white to-white px-5 py-3">
                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-primary">
                  Genealogy tree · this roll → children
                </div>
                <h3 className="font-display text-base font-bold text-content-1">
                  Lineage downstream
                </h3>
              </header>
              <div className="max-h-[640px] overflow-auto p-4 space-y-3">
                {trees.length === 0 ? (
                  <div className="text-xs text-content-3 italic">
                    No descendants yet.
                  </div>
                ) : (
                  trees.map((t) => (
                    <Node key={t.id} node={t as GenealogyNode} />
                  ))
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-line bg-surface-1 shadow-sm">
              <header className="border-b border-line bg-gradient-to-r from-success-bg via-white to-white px-5 py-3">
                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-success-fg">
                  Timeline · movement &amp; consumption
                </div>
                <h3 className="font-display text-base font-bold text-content-1">
                  {timeline.length} events
                </h3>
              </header>
              <div className="max-h-[640px] overflow-auto p-4">
                {timeline.length === 0 ? (
                  <div className="text-xs text-content-3 italic">
                    No timeline events recorded.
                  </div>
                ) : (
                  <ol className="relative ml-3 border-l-2 border-success-border">
                    {timeline.map((evt: any, i: number) => (
                      <li key={i} className="mb-4 ml-4">
                        <span
                          className={cn(
                            "absolute -left-[7px] mt-1 h-3 w-3 rounded-full ring-4 ring-surface-1",
                            evt.type === "MOVEMENT"
                              ? "bg-primary"
                              : "bg-danger-solid",
                          )}
                        />
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <span
                            className={cn(
                              "rounded-md px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider ring-1",
                              evt.type === "MOVEMENT"
                                ? "bg-info-bg text-primary ring-info-border"
                                : "bg-danger-bg text-danger-fg ring-danger-border",
                            )}
                          >
                            {evt.type}
                          </span>
                          <span className="font-mono text-[10px] text-content-3">
                            {fmtDate(evt.timestamp)}
                          </span>
                        </div>
                        {evt.type === "MOVEMENT" ? (
                          <div className="text-sm font-bold text-content-2">
                            {evt.from || "NEW"} → {evt.to || "—"}
                          </div>
                        ) : (
                          <div className="text-sm font-bold text-content-2">
                            Consumed {fmtKg(evt.consumed_kg)}
                          </div>
                        )}
                        {evt.reason && (
                          <div className="text-xs text-content-3 mt-0.5">
                            {evt.reason}
                          </div>
                        )}
                        {evt.job && (
                          <div className="text-[10px] font-bold text-primary mt-0.5">
                            Job · {evt.job}
                          </div>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </section>
          </div>

          {/* Recent physical movements */}
          <section className="rounded-2xl border border-line bg-surface-1 shadow-sm">
            <header className="flex items-center justify-between border-b border-line bg-gradient-to-r from-warning-bg via-white to-white px-5 py-3">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-warning-fg">
                  Physical movements
                </div>
                <h3 className="font-display text-base font-bold text-content-1">
                  Recent log
                </h3>
              </div>
              <Activity className="h-4 w-4 text-warning-fg" />
            </header>
            <div className="grid grid-cols-1 gap-2 p-4 md:grid-cols-2">
              {(result?.recent_movements || []).length === 0 ? (
                <div className="col-span-full text-xs text-content-3 italic">
                  No physical movements yet.
                </div>
              ) : (
                (result?.recent_movements || []).map((m, i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-line bg-surface-2 px-3 py-2"
                  >
                    <div className="text-[10px] font-bold text-content-3">
                      {fmtDate(m.timestamp)}
                    </div>
                    <div className="mt-1 text-sm font-bold text-content-2">
                      {m.from_location_name || "NEW"} →{" "}
                      {m.to_location_name || "—"}
                    </div>
                    <div className="mt-0.5 text-[11px] text-content-3">
                      {m.reason || "—"}
                      {m.reason_note ? ` · ${m.reason_note}` : ""}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Kpi({
  tone,
  icon,
  label,
  value,
}: {
  tone: "blue" | "violet" | "amber" | "emerald" | "rose";
  icon: string;
  label: string;
  value: string;
}) {
  const TONE = {
    blue: "from-primary to-order-fg",
    violet: "from-order-fg to-order-fg",
    amber: "from-warning-fg to-warm",
    emerald: "from-success-fg to-info-fg",
    rose: "from-danger-solid to-danger-solid",
  }[tone];
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl bg-gradient-to-br p-4 text-white shadow-lg ring-1 ring-surface-1/10",
        TONE,
      )}
    >
      <div className="flex items-start justify-between">
        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-white/80">
          {label}
        </div>
        <span className="text-lg">{icon}</span>
      </div>
      <div className="mt-2 font-display text-2xl font-black">{value}</div>
    </div>
  );
}

function Field({
  label,
  value,
  icon,
}: {
  label: string;
  value: any;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg bg-surface-2 px-3 py-2 ring-1 ring-line">
      <div className="text-[9px] font-black uppercase tracking-wider text-content-3">
        {label}
      </div>
      <div className="mt-0.5 flex items-center gap-1 text-sm font-bold text-content-2 truncate">
        {icon}
        {value || "—"}
      </div>
    </div>
  );
}

function WeightFlow({
  current,
  consumed,
  original,
}: {
  current: number;
  consumed: number;
  original: number;
}) {
  const c = Math.round((current / original) * 100);
  const k = Math.round((consumed / original) * 100);
  return (
    <div className="flex h-8 w-full overflow-hidden rounded-lg ring-1 ring-line bg-surface-2">
      <div
        className="flex items-center justify-center bg-primary text-[10px] font-bold text-white"
        style={{ width: `${c}%` }}
      >
        {c}%
      </div>
      <div
        className="flex items-center justify-center bg-danger-fg text-[10px] font-bold text-white"
        style={{ width: `${k}%` }}
      >
        {k > 5 ? `${k}% consumed` : ""}
      </div>
    </div>
  );
}

function Node({
  node,
  isChild = false,
  isLast = false,
}: {
  node: GenealogyNode;
  isChild?: boolean;
  isLast?: boolean;
}) {
  const hasKids = Array.isArray(node.children) && node.children.length > 0;
  return (
    <div className="relative">
      {isChild && (
        <div
          className="absolute border-l-2 border-b-2 border-line-strong rounded-bl-xl"
          style={{ left: -16, top: -16, width: 16, height: 40 }}
        />
      )}
      {isChild && !isLast && (
        <div
          className="absolute border-l-2 border-line-strong"
          style={{ left: -16, top: 24, bottom: -16 }}
        />
      )}
      <div
        className={cn(
          "relative z-10 rounded-2xl border bg-surface-1 px-3 py-2 shadow-sm hover:shadow-md",
          !isChild
            ? "border-info-border ring-2 ring-info-border"
            : "border-line",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 min-w-0">
            <span
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full flex-none",
                !isChild
                  ? "bg-info-bg text-primary"
                  : "bg-surface-2 text-content-3",
              )}
            >
              {!isChild ? (
                <GitCommit className="h-3.5 w-3.5" />
              ) : (
                <CornerDownRight className="h-3.5 w-3.5" />
              )}
            </span>
            <div className="min-w-0">
              <div className="font-mono text-xs font-bold text-content-1 truncate flex items-center gap-2">
                {node.label_id}
                {node.job_number && (
                  <span className="rounded-sm bg-info-bg px-1 text-[9px] font-bold text-primary ring-1 ring-info-border">
                    JOB · {node.job_number}
                  </span>
                )}
              </div>
              <div className="text-[10px] text-content-3">
                {node.material_name || "—"} ·{" "}
                {node.stage_name || `stage ${node.stage_index ?? "—"}`}
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 flex-none">
            <span
              className={cn(
                "rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase ring-1",
                roleTone((node as any).roll_role),
              )}
            >
              {(node as any).roll_role || "ROLL"}
            </span>
            <span
              className={cn(
                "rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase ring-1",
                statusTone(node.status),
              )}
            >
              {node.status || "—"}
            </span>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-4 gap-1.5 rounded-lg bg-surface-2 p-2 text-[10px]">
          <div>
            <div className="font-black text-content-4">ORIG</div>
            <div className="font-mono font-bold text-content-2">
              {fmtKg(node.original_weight_kg, 1)}
            </div>
          </div>
          <div>
            <div className="font-black text-content-4">NOW</div>
            <div className="font-mono font-bold text-content-2">
              {fmtKg(node.weight_kg, 1)}
            </div>
          </div>
          <div>
            <div className="font-black text-content-4">SIZE</div>
            <div className="font-mono text-content-2">
              {Number(node.width_mm || 0)}×{Number(node.thickness_micron || 0)}
            </div>
          </div>
          <div>
            <div className="font-black text-content-4">LOC</div>
            <div className="font-mono text-content-2 truncate">
              {node.location || "—"}
            </div>
          </div>
        </div>
      </div>
      {hasKids && (
        <div className="relative mt-3 pl-8">
          {node.children.map((c, i) => (
            <Node
              key={c.id}
              node={c as GenealogyNode}
              isChild
              isLast={i === node.children.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border-2 border-dashed border-line bg-surface-1 p-12 text-center">
      <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-full bg-info-bg text-primary">
        <GitBranch className="h-7 w-7" />
      </div>
      <div className="mt-4 font-display text-lg font-bold text-content-1">
        Trace any roll back to its origin
      </div>
      <div className="mt-1 text-sm text-content-3">
        Search a roll label or pick from recent rolls. We will surface the full
        tree, ancestor chain, weight flow, and movement timeline.
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-[11px]">
        <span className="rounded-full bg-surface-2 px-2.5 py-0.5 font-bold text-content-2 ring-1 ring-line">
          Origin GRN
        </span>
        <span className="rounded-full bg-info-bg px-2.5 py-0.5 font-bold text-primary ring-1 ring-info-border">
          Children
        </span>
        <span className="rounded-full bg-order-bg px-2.5 py-0.5 font-bold text-order-fg ring-1 ring-order-border">
          Ancestors
        </span>
        <span className="rounded-full bg-success-bg px-2.5 py-0.5 font-bold text-success-fg ring-1 ring-success-border">
          Timeline
        </span>
        <span className="rounded-full bg-warning-bg px-2.5 py-0.5 font-bold text-warning-fg ring-1 ring-warning-border">
          Movements
        </span>
      </div>
    </div>
  );
}
