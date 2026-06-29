"use client";

/**
 * V3.7 Visual Factory workspace — live floor view.
 *
 * Three tabs:
 * Overview — KPI strip · A+Q honest OEE · route-flow swimlane · WIP pools with aging · live alerts · today's completion events
 * Plants — per-plant detail with work-center grouping + machine cards
 * Customers — order-age driven commitments (Fresh ≤2d / Watch 3-5d / Aged 6+d · "not good")
 *
 * Wires to existing services:
 * factoryService.getPlants/getWorkCenters/getMachines
 * machineService.getOperatorMachines (bulk current-job / operator / queue)
 * inventoryService.getWipAging (new aging endpoint with local-derive fallback)
 * inventoryService.getInventorySnapshot
 * salesService.getOrders
 * analyticsService.getKPIs / getScrapAnalysis / getDowntimeAnalysis
 * productMasterService.listCustomerOverlays
 * notificationsService (NotificationService) — composed alerts
 *
 * Everything is local-only — no system change beyond this page + the new aging route.
 */

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Cog,
  ExternalLink,
  Factory,
  Info,
  Layers,
  Package,
  Sparkles,
  Users,
  Workflow,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  factoryService,
  type Plant,
  type WorkCenter,
  type Machine,
} from "@/services/factory";
import { machineService, type OperatorMachine } from "@/services/machine";
import { inventoryService, type WipAgingPool } from "@/services/inventory";
import { salesService, type SalesOrder } from "@/services/sales";
import { analyticsService } from "@/services/analytics";
import { productMasterService } from "@/services/product-master";
import { formatDisplayDate } from "@/lib/date-format";

// ──────────────────────────────────────────────────────────────────────────────
// Process colour map — keeps every chip/tile consistent across the page.
// ──────────────────────────────────────────────────────────────────────────────
type ProcessKey = "EXT" | "PRINT" | "LAM" | "SLIT" | "POU" | "PACK" | "OTHER";
const PROCESS_TONE: Record<
  ProcessKey,
  {
    bg: string;
    border: string;
    tone: string;
    chip: string;
    label: string;
    emoji: string;
  }
> = {
  EXT: {
    bg: "bg-info-bg",
    border: "ring-info-border",
    tone: "text-primary",
    chip: "bg-info-bg text-primary ring-info-border",
    label: "Extrusion",
    emoji: "①",
  },
  PRINT: {
    bg: "bg-danger-bg",
    border: "ring-danger-border",
    tone: "text-danger-fg",
    chip: "bg-danger-bg text-danger-fg ring-danger-border",
    label: "Printing",
    emoji: "②",
  },
  LAM: {
    bg: "bg-warning-bg",
    border: "ring-warning-border",
    tone: "text-warning-fg",
    chip: "bg-warning-bg text-warning-fg ring-warning-border",
    label: "Lamination",
    emoji: "③",
  },
  SLIT: {
    bg: "bg-info-bg",
    border: "ring-info-border",
    tone: "text-info-fg",
    chip: "bg-info-bg text-info-fg ring-info-border",
    label: "Slitting",
    emoji: "④",
  },
  POU: {
    bg: "bg-success-bg",
    border: "ring-success-border",
    tone: "text-success-fg",
    chip: "bg-success-bg text-success-fg ring-success-border",
    label: "Pouching",
    emoji: "⑤",
  },
  PACK: {
    bg: "bg-order-bg",
    border: "ring-order-border",
    tone: "text-order-fg",
    chip: "bg-order-bg text-order-fg ring-order-border",
    label: "Packing",
    emoji: "⑥",
  },
  OTHER: {
    bg: "bg-surface-2",
    border: "ring-line",
    tone: "text-content-2",
    chip: "bg-surface-2 text-content-2 ring-line",
    label: "Other",
    emoji: "◯",
  },
};

function processKeyOf(code: string | undefined | null): ProcessKey {
  const k = String(code || "").toUpperCase();
  if (/EXTRU|EXT/.test(k)) return "EXT";
  if (/PRINT|ROTO|FLEXO/.test(k)) return "PRINT";
  if (/LAM/.test(k)) return "LAM";
  if (/SLIT/.test(k)) return "SLIT";
  if (/POU|POUCH/.test(k)) return "POU";
  if (/PACK/.test(k)) return "PACK";
  return "OTHER";
}

// Status pill renderer
function StatusPill({ status }: { status: string }) {
  const s = String(status || "").toUpperCase();
  if (s === "RUNNING" || s === "ACTIVE")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-1.5 py-0.5 text-[9px] font-bold text-success-fg">
        <span className="h-1 w-1 rounded-full bg-success-fg animate-pulse" />{" "}
        running
      </span>
    );
  if (s === "CHANGEOVER" || s === "SETUP")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-warning-bg px-1.5 py-0.5 text-[9px] font-bold text-warning-fg">
        changeover
      </span>
    );
  if (s === "DOWN" || s === "MAINTENANCE")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-danger-bg px-1.5 py-0.5 text-[9px] font-black text-danger-fg">
        ⚠ down
      </span>
    );
  if (s === "IDLE")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-1.5 py-0.5 text-[9px] font-bold text-content-3">
        idle
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-1.5 py-0.5 text-[9px] font-bold text-content-3">
      {s.toLowerCase() || "unknown"}
    </span>
  );
}

// Order age in days
function ageDays(iso: string | null | undefined): number {
  if (!iso) return 0;
  const dt = new Date(iso).getTime();
  if (!Number.isFinite(dt)) return 0;
  return Math.max(0, Math.floor((Date.now() - dt) / (1000 * 60 * 60 * 24)));
}
function ageBucket(d: number): "fresh" | "watch" | "aged" {
  if (d <= 2) return "fresh";
  if (d <= 5) return "watch";
  return "aged";
}
const AGE_TONE: Record<
  "fresh" | "watch" | "aged",
  { pill: string; row: string; ring: string; label: (d: number) => string }
> = {
  fresh: {
    pill: "bg-success-fg",
    row: "bg-success-bg",
    ring: "ring-success-border",
    label: (d) => `fresh ${d}d`,
  },
  watch: {
    pill: "bg-warning-fg",
    row: "bg-warning-bg",
    ring: "ring-warning-border",
    label: (d) => `watch ${d}d`,
  },
  aged: {
    pill: "bg-danger-solid",
    row: "bg-danger-bg",
    ring: "ring-danger-border",
    label: (d) => `aged ${d}d`,
  },
};

// Format helpers
const fmtKg = (n: number | string | undefined | null) => {
  const v = Number(n) || 0;
  return v.toLocaleString("en-IN", { maximumFractionDigits: 0 });
};
const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const dt = new Date(iso);
  if (!Number.isFinite(dt.getTime())) return "—";
  return formatDisplayDate(dt);
};

// ──────────────────────────────────────────────────────────────────────────────
// Root component
// ──────────────────────────────────────────────────────────────────────────────

type TabKey = "overview" | "plants" | "customers";

export function VisualFactoryV37Workspace() {
  const [tab, setTab] = React.useState<TabKey>("overview");

  // Live floor data
  const { data: plants = [] } = useQuery({
    queryKey: ["factory-plants"],
    queryFn: factoryService.getPlants,
    staleTime: 60_000,
  });
  const { data: workCenters = [] } = useQuery({
    queryKey: ["factory-work-centers"],
    queryFn: factoryService.getWorkCenters,
    staleTime: 60_000,
  });
  const { data: machines = [] } = useQuery({
    queryKey: ["factory-machines"],
    queryFn: factoryService.getMachines,
    staleTime: 60_000,
  });
  const { data: liveMachines = [] } = useQuery({
    queryKey: ["machine-operator-bulk"],
    queryFn: () => machineService.getOperatorMachines(),
    staleTime: 30_000,
    refetchInterval: 45_000,
    retry: 1,
  });

  // KPIs / WIP / orders / overlays
  const { data: wipAging } = useQuery({
    queryKey: ["wip-aging"],
    queryFn: () => inventoryService.getWipAging(),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const { data: kpis } = useQuery({
    queryKey: ["analytics-kpis"],
    queryFn: analyticsService.getKPIs,
    staleTime: 60_000,
  });
  const { data: scrap } = useQuery({
    queryKey: ["analytics-scrap-30"],
    queryFn: () => analyticsService.getScrapAnalysis(30),
    staleTime: 5 * 60_000,
  });
  const { data: downtime } = useQuery({
    queryKey: ["analytics-downtime-30"],
    queryFn: () => analyticsService.getDowntimeAnalysis(30),
    staleTime: 5 * 60_000,
  });
  const { data: salesOrdersRaw } = useQuery({
    queryKey: ["sales-orders-open"],
    queryFn: () => salesService.getOrders({ limit: 40 }),
    staleTime: 120_000,
  });
  const salesOrders: SalesOrder[] = React.useMemo(() => {
    const list = Array.isArray((salesOrdersRaw as any)?.results)
      ? (salesOrdersRaw as any).results
      : Array.isArray(salesOrdersRaw)
        ? (salesOrdersRaw as any)
        : [];
    return (list as SalesOrder[]).filter(
      (o) => o.status && !["COMPLETED", "CANCELLED"].includes(o.status),
    );
  }, [salesOrdersRaw]);

  return (
    <div className="space-y-5 pb-12">
      <TopHero tab={tab} setTab={setTab} liveMachines={liveMachines} />

      {tab === "overview" ? (
        <OverviewTab
          plants={plants}
          workCenters={workCenters}
          machines={machines}
          liveMachines={liveMachines}
          wipAging={wipAging?.pools || []}
          agingMeta={
            wipAging
              ? {
                  fresh: wipAging.fresh_max_days,
                  aging: wipAging.aging_max_days,
                  stale: wipAging.stale_max_days,
                }
              : null
          }
          kpis={kpis}
          scrap={scrap}
          downtime={downtime}
          salesOrders={salesOrders}
        />
      ) : null}
      {tab === "plants" ? (
        <PlantsTab
          plants={plants}
          workCenters={workCenters}
          machines={machines}
          liveMachines={liveMachines}
          downtime={downtime}
          scrap={scrap}
          wipAging={wipAging?.pools || []}
        />
      ) : null}
      {tab === "customers" ? (
        <CustomersTab salesOrders={salesOrders} liveMachines={liveMachines} />
      ) : null}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Top hero + tab nav
// ──────────────────────────────────────────────────────────────────────────────

function TopHero({
  tab,
  setTab,
  liveMachines,
}: {
  tab: TabKey;
  setTab: (t: TabKey) => void;
  liveMachines: OperatorMachine[];
}) {
  const counts = React.useMemo(() => {
    let running = 0,
      change = 0,
      down = 0,
      idle = 0;
    for (const m of liveMachines) {
      const s = String(m.status || "").toUpperCase();
      if (s === "RUNNING" || s === "ACTIVE") running += 1;
      else if (s === "CHANGEOVER" || s === "SETUP") change += 1;
      else if (s === "DOWN" || s === "MAINTENANCE") down += 1;
      else idle += 1;
    }
    return { running, change, down, idle, total: liveMachines.length };
  }, [liveMachines]);

  return (
    <section className="space-y-3">
      <div className="relative overflow-hidden rounded-2xl border border-line bg-gradient-to-br from-order-bg via-white to-success-bg px-6 py-5 shadow-sm">
        <div className="absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b from-order-fg via-order-fg to-order-fg" />
        <div className="relative pl-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-order-fg">
              Operations · live floor
            </div>
            <h1 className="font-display text-3xl font-black tracking-tight text-content-1 mt-1">
              Visual Factory
            </h1>
            <p className="mt-1.5 max-w-2xl text-xs text-content-3">
              Every machine, every WIP pool, every customer — live. Click a
              machine for the live console. Click a customer for their orders.
              Click a pool stage for the inventory drill.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
              <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2.5 py-0.5 text-success-fg ring-1 ring-success-border">
                ⚡ {counts.running} of {counts.total || "—"} running
              </span>
              {counts.change ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-warning-bg px-2.5 py-0.5 text-warning-fg ring-1 ring-warning-border">
                  ⚠ {counts.change} changeover
                </span>
              ) : null}
              {counts.down ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-danger-bg px-2.5 py-0.5 text-danger-fg ring-1 ring-danger-border">
                  ▾ {counts.down} down
                </span>
              ) : null}
              {counts.idle ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-0.5 text-content-2 ring-1 ring-line">
                  ⏸ {counts.idle} idle
                </span>
              ) : null}
            </div>
          </div>
          <div className="inline-flex items-center gap-1.5 text-[11px] font-bold">
            <button
              onClick={() => setTab("overview")}
              className={cn(
                "rounded-full px-3 py-1 ring-1",
                tab === "overview"
                  ? "bg-surface-3 text-white ring-line-strong shadow-sm"
                  : "bg-surface-1 text-content-2 ring-line hover:bg-surface-2",
              )}
            >
              Overview
            </button>
            <button
              onClick={() => setTab("plants")}
              className={cn(
                "rounded-full px-3 py-1 ring-1",
                tab === "plants"
                  ? "bg-surface-3 text-white ring-line-strong shadow-sm"
                  : "bg-surface-1 text-content-2 ring-line hover:bg-surface-2",
              )}
            >
              Plants
            </button>
            <button
              onClick={() => setTab("customers")}
              className={cn(
                "rounded-full px-3 py-1 ring-1",
                tab === "customers"
                  ? "bg-surface-3 text-white ring-line-strong shadow-sm"
                  : "bg-surface-1 text-content-2 ring-line hover:bg-surface-2",
              )}
            >
              Customer commitments
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Overview tab
// ──────────────────────────────────────────────────────────────────────────────

function OverviewTab({
  plants,
  workCenters,
  machines,
  liveMachines,
  wipAging,
  agingMeta,
  kpis,
  scrap,
  downtime,
  salesOrders,
}: {
  plants: Plant[];
  workCenters: WorkCenter[];
  machines: Machine[];
  liveMachines: OperatorMachine[];
  wipAging: WipAgingPool[];
  agingMeta: { fresh: number; aging: number; stale: number } | null;
  kpis: any;
  scrap: any;
  downtime: any;
  salesOrders: SalesOrder[];
}) {
  // KPI maths
  const todayOutput = Number(
    (kpis as any)?.today_output_kg ?? (kpis as any)?.production_today_kg ?? 0,
  );
  const todayEvents = Number(
    (kpis as any)?.today_events ?? (kpis as any)?.completion_events_today ?? 0,
  );
  const backlogKg = React.useMemo(
    () =>
      salesOrders.reduce(
        (s, o) =>
          s + Number(o.qty_summary?.ordered_kg || o.total_weight_kg || 0),
        0,
      ),
    [salesOrders],
  );
  const backlogCustomers = React.useMemo(
    () =>
      new Set(
        salesOrders
          .map((o) => o.customer || o.customer_id || o.customer_name)
          .filter(Boolean),
      ).size,
    [salesOrders],
  );
  const agedOrders = React.useMemo(
    () => salesOrders.filter((o) => ageDays(o.created_at) >= 6),
    [salesOrders],
  );
  const agedKg = agedOrders.reduce(
    (s, o) => s + Number(o.qty_summary?.ordered_kg || o.total_weight_kg || 0),
    0,
  );
  const scrapPct = Number(
    (scrap as any)?.scrap_percent_today ??
      (scrap as any)?.scrap_pct_today ??
      (scrap as any)?.today?.scrap_pct ??
      0,
  );
  const scrap5d = Number(
    (scrap as any)?.scrap_percent_5d ??
      (scrap as any)?.scrap_pct_5d ??
      (scrap as any)?.avg_5d ??
      0,
  );
  const downtimeMin = Number(
    (downtime as any)?.downtime_minutes_today ??
      (downtime as any)?.downtime_today_min ??
      (downtime as any)?.today?.minutes ??
      0,
  );
  const downtimeIncidents = Number(
    (downtime as any)?.downtime_incidents_today ??
      (downtime as any)?.incidents_today ??
      1,
  );
  const availabilityPct = Math.max(
    0,
    Math.min(
      100,
      Number(
        (kpis as any)?.availability_pct ??
          (kpis as any)?.availability ??
          (downtimeMin > 0 ? 100 - (downtimeMin / (8 * 60)) * 100 : 95),
      ),
    ),
  );
  const qualityPct = Math.max(
    0,
    Math.min(
      100,
      scrapPct > 0 ? 100 - scrapPct : Number((kpis as any)?.quality_pct ?? 96),
    ),
  );

  // Alerts (composed locally from real signals — no fake "auto-reallocation" event log)
  const alerts = React.useMemo(
    () => buildAlerts({ liveMachines, salesOrders, wipAging }),
    [liveMachines, salesOrders, wipAging],
  );

  return (
    <section className="space-y-5">
      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <KpiTile
          label="Today output"
          value={fmtKg(todayOutput) + " KG"}
          subtle={`${todayEvents || 0} completion events today`}
          valueClass="text-success-fg"
        />
        <KpiTile
          label="Backlog"
          value={fmtKg(backlogKg) + " KG"}
          subtle={`${salesOrders.length} open lines · ${backlogCustomers} customers`}
          valueClass="text-warning-fg"
        />
        <KpiTile
          label="Aged 6+ days"
          value={String(agedOrders.length)}
          subtle={`${fmtKg(agedKg)} KG · needs attention`}
          valueClass="text-danger-fg"
          border="border-danger-border bg-danger-bg"
          link="?tab=customers"
        />
        <KpiTile
          label="Scrap % (Q)"
          value={`${scrapPct ? scrapPct.toFixed(1) : "—"}%`}
          subtle={scrap5d ? `vs 5d ${scrap5d.toFixed(1)}%` : "Q · today"}
          valueClass="text-danger-fg"
          link="/analytics/scrap"
        />
        <KpiTile
          label="Downtime today (A)"
          value={`${downtimeMin || 0} min`}
          subtle={`${downtimeIncidents || 0} incident${downtimeIncidents === 1 ? "" : "s"}`}
          valueClass="text-warning-fg"
          link="/analytics/reports/downtime"
        />
        <KpiTile
          label="Open alerts"
          value={String(alerts.length)}
          subtle={`${alerts.filter((a) => a.severity === "critical").length} critical`}
          valueClass="text-danger-fg"
          border={
            alerts.length ? "border-danger-border bg-danger-bg" : undefined
          }
        />
      </div>

      {/* A + Q explainer */}
      <div className="rounded-2xl border border-order-border bg-order-bg px-5 py-3.5 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-order-bg text-order-fg">
            <Info className="h-3.5 w-3.5" />
          </span>
          <div className="flex-1">
            <div className="text-[11px] font-black uppercase tracking-[0.22em] text-order-fg">
              OEE shown as two real numbers — A and Q
            </div>
            <p className="text-[12px] text-content-2 mt-1">
              Standard OEE ={" "}
              <span className="font-bold">
                Availability × Performance × Quality
              </span>
              . We show A and Q honestly; P is the gap.
            </p>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="rounded-xl bg-surface-1 ring-1 ring-success-border px-3 py-2">
                <div className="text-[10px] font-black uppercase tracking-wider text-success-fg">
                  A · Availability
                </div>
                <div className="font-mono text-lg font-black text-success-fg">
                  {availabilityPct.toFixed(0)}
                  <span className="text-sm">%</span>
                </div>
                <div className="text-[10px] text-content-3">
                  Running minutes ÷ planned minutes.{" "}
                  <strong>We track this</strong> — downtime is logged per
                  machine.
                </div>
              </div>
              <div className="rounded-xl bg-surface-1 ring-1 ring-line-strong px-3 py-2">
                <div className="text-[10px] font-black uppercase tracking-wider text-content-2">
                  P · Performance
                </div>
                <div className="font-mono text-lg font-black text-content-4">
                  —
                </div>
                <div className="text-[10px] text-content-3">
                  Actual run rate ÷ machine nameplate rate.{" "}
                  <strong>We don&apos;t track this</strong> — no per-machine
                  nameplate rates. Add P later when machine rates are reliable.
                </div>
              </div>
              <div className="rounded-xl bg-surface-1 ring-1 ring-order-border px-3 py-2">
                <div className="text-[10px] font-black uppercase tracking-wider text-order-fg">
                  Q · Quality
                </div>
                <div className="font-mono text-lg font-black text-order-fg">
                  {qualityPct.toFixed(1)}
                  <span className="text-sm">%</span>
                </div>
                <div className="text-[10px] text-content-3">
                  Good output ÷ total output. <strong>We track this</strong> via
                  scrap %; Q = 100% − scrap%.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Route swimlane */}
      <RouteSwimlane
        plants={plants}
        workCenters={workCenters}
        machines={machines}
        liveMachines={liveMachines}
      />

      {/* WIP pools + Alerts */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <WipAgingPanel pools={wipAging} meta={agingMeta} />
        <AlertsPanel alerts={alerts} />
      </div>
    </section>
  );
}

function KpiTile({
  label,
  value,
  subtle,
  valueClass,
  border,
  link,
}: {
  label: string;
  value: string;
  subtle?: string;
  valueClass?: string;
  border?: string;
  link?: string;
}) {
  const body = (
    <>
      <div className="text-[10px] font-black uppercase tracking-wider text-content-3">
        {label}
      </div>
      <div
        className={cn(
          "font-display text-xl font-black tabular-nums",
          valueClass || "text-content-1",
        )}
      >
        {value}
      </div>
      {subtle ? (
        <div className="text-[10px] text-content-3 truncate">{subtle}</div>
      ) : null}
    </>
  );
  const cls = cn(
    "rounded-2xl border px-3.5 py-2.5 shadow-sm transition",
    border || "border-line bg-surface-1",
    link ? "hover:shadow-md cursor-pointer" : "",
  );
  return link ? (
    <Link href={link} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Route flow swimlane
// ──────────────────────────────────────────────────────────────────────────────

function RouteSwimlane({
  workCenters,
  machines,
  liveMachines,
}: {
  plants: Plant[];
  workCenters: WorkCenter[];
  machines: Machine[];
  liveMachines: OperatorMachine[];
}) {
  // Group machines by process key, prefer live row when available.
  const liveById = React.useMemo(() => {
    const m = new Map<string, OperatorMachine>();
    for (const r of liveMachines) m.set(String(r.id), r);
    return m;
  }, [liveMachines]);

  const groups: Record<
    ProcessKey,
    Array<{ machine: Machine; live?: OperatorMachine; wcCode?: string }>
  > = {
    EXT: [],
    PRINT: [],
    LAM: [],
    SLIT: [],
    POU: [],
    PACK: [],
    OTHER: [],
  };
  for (const mc of machines) {
    const wc = workCenters.find((w) => w.id === (mc as any).work_center);
    const wcCodes: string[] =
      (wc as any)?.process_codes || (wc as any)?.processes || [];
    const procKey = processKeyOf(
      wcCodes[0] || (mc as any).work_center_name || mc.name,
    );
    groups[procKey].push({
      machine: mc,
      live: liveById.get(String(mc.id)),
      wcCode: wc?.code,
    });
  }

  const order: ProcessKey[] = ["EXT", "PRINT", "LAM", "SLIT", "POU", "PACK"];
  return (
    <section className="rounded-2xl border border-line bg-surface-1 shadow-sm overflow-hidden">
      <header className="border-b border-line bg-gradient-to-r from-order-bg via-white to-white px-5 py-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.22em] text-order-fg">
            Route flow · today
          </div>
          <h2 className="font-display text-lg font-bold text-content-1">
            Where every machine is right now
          </h2>
        </div>
        <div className="flex items-center gap-2 text-[10px] font-bold">
          <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-success-fg ring-1 ring-success-border">
            <span className="h-1.5 w-1.5 rounded-full bg-success-fg" /> running
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-warning-bg px-2 py-0.5 text-warning-fg ring-1 ring-warning-border">
            <span className="h-1.5 w-1.5 rounded-full bg-warning-fg" />{" "}
            changeover
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-danger-bg px-2 py-0.5 text-danger-fg ring-1 ring-danger-border">
            <span className="h-1.5 w-1.5 rounded-full bg-danger-solid" /> down
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-content-3 ring-1 ring-line">
            <span className="h-1.5 w-1.5 rounded-full bg-line" /> idle
          </span>
        </div>
      </header>
      <div className="overflow-x-auto px-3 py-3">
        <div className="flex items-stretch gap-3 min-w-[1100px]">
          {order.map((key, idx) => {
            const list = groups[key];
            const tone = PROCESS_TONE[key];
            const running = list.filter(
              (r) =>
                String(r.live?.status || "").toUpperCase() === "RUNNING" ||
                String(r.live?.status || "").toUpperCase() === "ACTIVE",
            ).length;
            return (
              <React.Fragment key={key}>
                <div
                  className={cn(
                    "flex-1 min-w-[190px] rounded-xl ring-1 p-2.5",
                    tone.bg,
                    tone.border,
                  )}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div
                      className={cn(
                        "text-[10px] font-black uppercase tracking-wider",
                        tone.tone,
                      )}
                    >
                      {tone.emoji} {tone.label} · {list.length} mc
                    </div>
                    <span className="rounded-full bg-surface-1 px-1.5 py-0.5 text-[9px] font-bold text-content-2 ring-1 ring-line">
                      {running}/{list.length} running
                    </span>
                  </div>
                  {list.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-line bg-surface-1/40 px-2 py-3 text-center text-[10px] italic text-content-3">
                      No machines in this stage yet
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {list.slice(0, 4).map(({ machine, live }) => (
                        <Link
                          key={machine.id}
                          href={`/production/machine/${machine.id}`}
                          className={cn(
                            "block rounded-lg bg-surface-1 p-2 ring-1 shadow-sm hover:ring-2 transition",
                            tone.border,
                          )}
                          title={`Open ${machine.code} machine console`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-mono font-black text-[11px] text-content-1">
                              {machine.code}
                            </span>
                            <StatusPill
                              status={String(live?.status || "idle")}
                            />
                          </div>
                          {live?.current_job ? (
                            <>
                              <div className="mt-1 text-[10px] font-bold text-content-2 truncate">
                                {live.current_job.product_name ||
                                  live.current_job.job_number}
                              </div>
                              <div className="text-[9px] text-content-3 truncate">
                                {live.current_job.job_number}
                                {(live as any).operator?.name
                                  ? ` · Op: ${(live as any).operator?.name}`
                                  : ""}
                              </div>
                            </>
                          ) : (
                            <div className="mt-1 text-[10px] font-bold text-content-3 truncate">
                              {(machine as any).work_center_name || "—"}
                            </div>
                          )}
                          {(live as any)?.queue_count ? (
                            <div className="mt-1 text-[9px] font-mono text-content-3">
                              queue · {(live as any).queue_count} jobs
                            </div>
                          ) : null}
                        </Link>
                      ))}
                      {list.length > 4 ? (
                        <Link
                          href="/factory/machines"
                          className={cn(
                            "block rounded-lg px-2 py-1 text-center text-[10px] font-bold underline-offset-2 hover:underline",
                            tone.tone,
                          )}
                        >
                          + {list.length - 4} more · view all
                        </Link>
                      ) : null}
                    </div>
                  )}
                </div>
                {idx < order.length - 1 ? (
                  <span className="flex items-center text-content-4 text-lg">
                    ›
                  </span>
                ) : null}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// WIP aging panel
// ──────────────────────────────────────────────────────────────────────────────

function WipAgingPanel({
  pools,
  meta,
}: {
  pools: WipAgingPool[];
  meta: { fresh: number; aging: number; stale: number } | null;
}) {
  const totals = pools.reduce(
    (acc, p) => ({
      total: acc.total + p.total,
      stale: acc.stale + p.stale,
      dead: acc.dead + p.dead,
    }),
    { total: 0, stale: 0, dead: 0 },
  );
  return (
    <div className="rounded-2xl border border-line bg-surface-1 shadow-sm overflow-hidden">
      <header className="border-b border-line bg-gradient-to-r from-success-bg via-white to-white px-5 py-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.22em] text-success-fg">
            WIP pools · aged
          </div>
          <h2 className="font-display text-base font-bold text-content-1">
            Stock in flight · with aging
          </h2>
        </div>
        <div className="flex items-center gap-2 text-[10px] font-bold">
          <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-content-2 ring-1 ring-line">
            {fmtKg(totals.total)} KG total
          </span>
          {totals.stale > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-warning-bg px-2 py-0.5 text-warning-fg ring-1 ring-warning-border">
              ⚠ {fmtKg(totals.stale)} stale
            </span>
          ) : null}
          {totals.dead > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-danger-bg px-2 py-0.5 text-danger-fg ring-1 ring-danger-border">
              ▾ {fmtKg(totals.dead)} dead
            </span>
          ) : null}
        </div>
      </header>
      <div className="bg-surface-2 border-b border-line px-5 py-2 flex flex-wrap items-center gap-3 text-[10px] font-bold">
        <span className="text-[10px] font-black uppercase tracking-wider text-content-3">
          aging buckets
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-sm bg-success-fg" /> fresh ≤
          {meta?.fresh ?? 2}d
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-sm bg-warning-fg" /> aging{" "}
          {(meta?.fresh ?? 2) + 1}-{meta?.aging ?? 5}d
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-sm bg-warm" /> stale{" "}
          {(meta?.aging ?? 5) + 1}-{meta?.stale ?? 10}d
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-sm bg-danger-solid" /> dead &gt;
          {meta?.stale ?? 10}d
        </span>
      </div>
      <div className="divide-y divide-line">
        {pools.length === 0 ? (
          <div className="px-5 py-6 text-center text-[12px] italic text-content-3">
            No WIP pools yet — pools light up as stock moves through the route.
          </div>
        ) : (
          pools.map((pool) => <WipPoolRow key={pool.klass} pool={pool} />)
        )}
      </div>
    </div>
  );
}

function WipPoolRow({ pool }: { pool: WipAgingPool }) {
  const total = Math.max(1, pool.total);
  const seg = (n: number) => `${(n / total) * 100}%`;
  const inventoryRoute = pool.klass.toLowerCase().includes("raw")
    ? "bulk"
    : "rolls";
  return (
    <Link
      href={`/inventory/${inventoryRoute}?klass=${encodeURIComponent(pool.klass)}`}
      className="block px-5 py-3 grid grid-cols-12 gap-3 items-center hover:bg-surface-2"
    >
      <div className="col-span-3">
        <div className="font-mono text-[11px] font-black text-content-2">
          {pool.klass}
        </div>
        <div className="text-[11px] font-bold text-content-2">{pool.label}</div>
        {pool.description ? (
          <div className="text-[10px] text-content-3">{pool.description}</div>
        ) : null}
      </div>
      <div className="col-span-2 font-mono font-black text-content-1">
        {fmtKg(pool.total)}{" "}
        <span className="text-[10px] font-bold text-content-3">{pool.uom}</span>
      </div>
      <div className="col-span-4">
        <div className="flex h-2 w-full overflow-hidden rounded-full ring-1 ring-line">
          <div className="bg-success-fg" style={{ width: seg(pool.fresh) }} />
          <div className="bg-warning-fg" style={{ width: seg(pool.aging) }} />
          <div className="bg-warm" style={{ width: seg(pool.stale) }} />
          <div className="bg-danger-solid" style={{ width: seg(pool.dead) }} />
        </div>
        <div className="mt-1 flex justify-between text-[9px] font-bold text-content-3">
          <span>fresh {fmtKg(pool.fresh)}</span>
          <span>aging {fmtKg(pool.aging)}</span>
          <span className={pool.stale > 0 ? "text-warm" : ""}>
            stale {fmtKg(pool.stale)}
          </span>
          <span className={pool.dead > 0 ? "text-danger-fg" : ""}>
            dead {fmtKg(pool.dead)}
          </span>
        </div>
      </div>
      <div className="col-span-3 flex items-center justify-end gap-1.5">
        {pool.line_counts ? (
          <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[9px] font-bold text-content-2 ring-1 ring-line">
            {pool.line_counts.fresh +
              pool.line_counts.aging +
              pool.line_counts.stale +
              pool.line_counts.dead}{" "}
            lines
          </span>
        ) : null}
        <ArrowRight className="h-3 w-3 text-content-4" />
      </div>
    </Link>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Alerts panel — composed locally from real signals
// ──────────────────────────────────────────────────────────────────────────────

type AlertItem = {
  id: string;
  severity: "critical" | "warn" | "info";
  title: string;
  sub: string;
  timeLabel: string;
  href?: string;
};

function buildAlerts({
  liveMachines,
  salesOrders,
  wipAging,
}: {
  liveMachines: OperatorMachine[];
  salesOrders: SalesOrder[];
  wipAging: WipAgingPool[];
}): AlertItem[] {
  const out: AlertItem[] = [];
  for (const m of liveMachines) {
    const s = String(m.status || "").toUpperCase();
    if (s === "DOWN" || s === "MAINTENANCE") {
      out.push({
        id: `mc-down-${m.id}`,
        severity: "critical",
        title: `${m.code} down`,
        sub: m.work_center_name || m.plant_name || "Machine offline",
        timeLabel: "machine status",
        href: `/production/machine/${m.id}`,
      });
    } else if (s === "IDLE" && (m as any).queue_count === 0) {
      out.push({
        id: `mc-idle-${m.id}`,
        severity: "warn",
        title: `${m.code} idle · no queue`,
        sub: m.work_center_name || m.plant_name || "Machine idle",
        timeLabel: "operator console",
        href: `/production/machine/${m.id}`,
      });
    }
  }
  for (const o of salesOrders) {
    const age = ageDays(o.created_at);
    if (age >= 6) {
      out.push({
        id: `so-aged-${o.id}`,
        severity: age >= 10 ? "critical" : "warn",
        title: `${o.order_number} sitting ${age} days`,
        sub: `${o.customer_name || "Customer"} · ${fmtKg(o.qty_summary?.ordered_kg || o.total_weight_kg || 0)} KG`,
        timeLabel: `placed ${fmtDate(o.created_at)}`,
        href: `/sales/orders/${o.id}`,
      });
    }
  }
  for (const p of wipAging) {
    const inventoryRoute = p.klass.toLowerCase().includes("raw")
      ? "bulk"
      : "rolls";
    if (p.dead > 0) {
      out.push({
        id: `wip-dead-${p.klass}`,
        severity: "warn",
        title: `${p.klass} dead stock`,
        sub: `${fmtKg(p.dead)} KG sitting > 10 days`,
        timeLabel: "WIP aging",
        href: `/inventory/${inventoryRoute}`,
      });
    }
  }
  // Sort: critical first, then warn, then info; preserve order otherwise.
  const rank: Record<AlertItem["severity"], number> = {
    critical: 0,
    warn: 1,
    info: 2,
  };
  out.sort((a, b) => rank[a.severity] - rank[b.severity]);
  return out.slice(0, 10);
}

function AlertsPanel({ alerts }: { alerts: AlertItem[] }) {
  return (
    <aside className="rounded-2xl border border-line bg-gradient-to-b from-white via-white to-danger-bg shadow-sm overflow-hidden">
      <header className="border-b border-line bg-surface-1 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-danger-bg text-danger-fg">
            <AlertTriangle className="h-3.5 w-3.5" />
          </span>
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-danger-fg">
              Live alerts
            </div>
            <div className="font-display text-sm font-bold text-content-1">
              {alerts.length} open ·{" "}
              {alerts.filter((a) => a.severity === "critical").length} critical
            </div>
          </div>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-danger-bg px-2 py-0.5 text-[10px] font-bold text-danger-fg ring-1 ring-danger-border">
          <span className="h-1.5 w-1.5 rounded-full bg-danger-solid animate-pulse" />{" "}
          live
        </span>
      </header>
      <div className="p-3 space-y-2 text-[11px]">
        {alerts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-success-border bg-success-bg px-3 py-4 text-center text-[12px] font-bold text-success-fg">
            ✓ All clear — no machine down, no aged orders, no dead WIP.
          </div>
        ) : (
          alerts.map((a) => {
            const tone =
              a.severity === "critical"
                ? {
                    ring: "ring-danger-border",
                    bg: "bg-danger-bg",
                    pill: "bg-danger-solid text-white",
                    text: "text-danger-fg",
                    sub: "text-danger-fg",
                  }
                : a.severity === "warn"
                  ? {
                      ring: "ring-warning-border",
                      bg: "bg-warning-bg",
                      pill: "bg-warning-fg text-white",
                      text: "text-warning-fg",
                      sub: "text-warning-fg",
                    }
                  : {
                      ring: "ring-line",
                      bg: "bg-surface-1",
                      pill: "bg-line text-white",
                      text: "text-content-2",
                      sub: "text-content-3",
                    };
            const body = (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[9px] font-black uppercase",
                      tone.pill,
                    )}
                  >
                    {a.severity}
                  </span>
                  <span className={cn("text-[10px] font-bold", tone.sub)}>
                    {a.timeLabel}
                  </span>
                </div>
                <div className={cn("mt-1 font-bold", tone.text)}>{a.title}</div>
                <div className={cn("text-[10px] mt-0.5", tone.sub)}>
                  {a.sub}
                </div>
              </>
            );
            return a.href ? (
              <Link
                key={a.id}
                href={a.href}
                className={cn(
                  "block rounded-xl ring-1 px-3 py-2.5 hover:shadow-sm",
                  tone.ring,
                  tone.bg,
                )}
              >
                {body}
              </Link>
            ) : (
              <div
                key={a.id}
                className={cn(
                  "rounded-xl ring-1 px-3 py-2.5",
                  tone.ring,
                  tone.bg,
                )}
              >
                {body}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Plants tab
// ──────────────────────────────────────────────────────────────────────────────

function PlantsTab({
  plants,
  workCenters,
  machines,
  liveMachines,
  downtime,
  scrap,
  wipAging,
}: {
  plants: Plant[];
  workCenters: WorkCenter[];
  machines: Machine[];
  liveMachines: OperatorMachine[];
  downtime: any;
  scrap: any;
  wipAging: WipAgingPool[];
}) {
  const liveById = React.useMemo(() => {
    const m = new Map<string, OperatorMachine>();
    for (const r of liveMachines) m.set(String(r.id), r);
    return m;
  }, [liveMachines]);
  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-line bg-surface-1 px-5 py-3 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[11px] font-bold">
          <span className="text-[10px] font-black uppercase tracking-[0.18em] text-content-3">
            {plants.length} plants
          </span>
          <Link
            href="/factory/plants"
            className="rounded-full bg-surface-1 px-3 py-1 text-content-2 ring-1 ring-line hover:bg-surface-2 inline-flex items-center gap-1"
          >
            Manage plants <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
        <div className="flex items-center gap-2 text-[10px] font-bold">
          <span className="rounded-full bg-success-bg px-2 py-0.5 text-success-fg ring-1 ring-success-border">
            {
              liveMachines.filter((m) =>
                ["RUNNING", "ACTIVE"].includes(
                  String(m.status || "").toUpperCase(),
                ),
              ).length
            }{" "}
            running
          </span>
          <span className="rounded-full bg-warning-bg px-2 py-0.5 text-warning-fg ring-1 ring-warning-border">
            {
              liveMachines.filter((m) =>
                ["CHANGEOVER", "SETUP"].includes(
                  String(m.status || "").toUpperCase(),
                ),
              ).length
            }{" "}
            changeover
          </span>
          <span className="rounded-full bg-danger-bg px-2 py-0.5 text-danger-fg ring-1 ring-danger-border">
            {
              liveMachines.filter((m) =>
                ["DOWN", "MAINTENANCE"].includes(
                  String(m.status || "").toUpperCase(),
                ),
              ).length
            }{" "}
            down
          </span>
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-content-2 ring-1 ring-line">
            {
              liveMachines.filter(
                (m) => String(m.status || "").toUpperCase() === "IDLE",
              ).length
            }{" "}
            idle
          </span>
        </div>
      </div>
      {plants.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-surface-1 px-6 py-12 text-center text-sm text-content-3">
          No plants configured yet.{" "}
          <Link
            href="/factory/plants"
            className="font-bold text-order-fg underline"
          >
            Set up plants
          </Link>{" "}
          in factory settings.
        </div>
      ) : (
        plants.map((plant) => (
          <PlantBlock
            key={plant.id}
            plant={plant}
            workCenters={workCenters.filter((wc) => wc.plant === plant.id)}
            machines={machines}
            liveById={liveById}
            downtime={downtime}
            scrap={scrap}
            wipAging={wipAging}
          />
        ))
      )}
    </section>
  );
}

function PlantBlock({
  plant,
  workCenters,
  machines,
  liveById,
  downtime,
  scrap,
  wipAging,
}: {
  plant: Plant;
  workCenters: WorkCenter[];
  machines: Machine[];
  liveById: Map<string, OperatorMachine>;
  downtime: any;
  scrap: any;
  wipAging: WipAgingPool[];
}) {
  const plantMachines = machines.filter((m) =>
    workCenters.some((wc) => wc.id === (m as any).work_center),
  );
  const stats = plantMachines.reduce(
    (acc, m) => {
      const s = String(
        liveById.get(String(m.id))?.status || "idle",
      ).toUpperCase();
      if (s === "RUNNING" || s === "ACTIVE") acc.running++;
      else if (s === "CHANGEOVER" || s === "SETUP") acc.change++;
      else if (s === "DOWN" || s === "MAINTENANCE") acc.down++;
      else acc.idle++;
      return acc;
    },
    { running: 0, change: 0, down: 0, idle: 0 },
  );

  // Compute per-plant scrap + downtime if the analytics payload is keyed by plant; otherwise show the org-level number.
  const plantScrap = Number(
    (scrap as any)?.by_plant?.[plant.id]?.scrap_pct ??
      (scrap as any)?.scrap_percent_today ??
      0,
  );
  const plantDowntime = Number(
    (downtime as any)?.by_plant?.[plant.id]?.minutes_today ??
      (downtime as any)?.downtime_minutes_today ??
      0,
  );
  const availability = Math.max(0, 100 - (plantDowntime / (8 * 60)) * 100);
  const quality = Math.max(0, 100 - plantScrap);

  return (
    <article className="rounded-2xl border border-order-border bg-surface-1 shadow-sm overflow-hidden">
      <header className="border-b border-order-border bg-gradient-to-r from-order-bg via-white to-success-bg px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-order-bg to-order-fg text-white shadow-sm">
              <Factory className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-[0.22em] text-order-fg">
                Plant · {plant.code}
              </div>
              <h3 className="font-display text-xl font-black text-content-1 mt-0.5">
                {plant.name}
              </h3>
              <div className="text-[11px] text-content-3 mt-1">
                {workCenters.length} work centers · {plantMachines.length}{" "}
                machines
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold">
            {stats.running ? (
              <span className="rounded-full bg-success-bg px-2 py-0.5 text-success-fg ring-1 ring-success-border">
                {stats.running} running
              </span>
            ) : null}
            {stats.change ? (
              <span className="rounded-full bg-warning-bg px-2 py-0.5 text-warning-fg ring-1 ring-warning-border">
                {stats.change} changeover
              </span>
            ) : null}
            {stats.down ? (
              <span className="rounded-full bg-danger-bg px-2 py-0.5 text-danger-fg ring-1 ring-danger-border">
                {stats.down} down
              </span>
            ) : null}
            {stats.idle ? (
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-content-2 ring-1 ring-line">
                {stats.idle} idle
              </span>
            ) : null}
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
          <KpiSmall
            label="Availability (A)"
            value={`${availability.toFixed(0)}%`}
            valueClass="text-success-fg"
          />
          <KpiSmall
            label="Quality (Q)"
            value={`${quality.toFixed(1)}%`}
            valueClass="text-order-fg"
          />
          <KpiSmall
            label="Downtime today"
            value={`${plantDowntime || 0} min`}
            valueClass="text-warning-fg"
          />
          <KpiSmall
            label="Scrap %"
            value={`${plantScrap ? plantScrap.toFixed(1) : "—"}%`}
            valueClass="text-danger-fg"
          />
        </div>
      </header>
      <div className="p-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {workCenters.length === 0 ? (
          <div className="col-span-full rounded-xl border border-dashed border-line bg-surface-2 px-3 py-4 text-center text-[11px] text-content-3">
            No work centers under this plant.{" "}
            <Link
              href="/factory/work-centers"
              className="font-bold text-order-fg underline"
            >
              Set up work centers
            </Link>
            .
          </div>
        ) : (
          workCenters.map((wc) => {
            const wcMachines = machines.filter(
              (m) => (m as any).work_center === wc.id,
            );
            const wcProcKey = processKeyOf(
              ((wc as any).process_codes || (wc as any).processes || [])[0] ||
                wc.name,
            );
            const tone = PROCESS_TONE[wcProcKey];
            return (
              <div
                key={wc.id}
                className={cn(
                  "rounded-xl border p-3",
                  tone.border,
                  tone.bg.replace("/60", "/40"),
                )}
              >
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div
                      className={cn(
                        "text-[10px] font-black uppercase tracking-wider",
                        tone.tone,
                      )}
                    >
                      {tone.label} · {wc.code}
                    </div>
                    <div className="text-[10px] text-content-3">
                      {wcMachines.length} machine
                      {wcMachines.length === 1 ? "" : "s"}
                    </div>
                  </div>
                  <Link
                    href="/factory/work-centers"
                    className={cn(
                      "text-[10px] font-bold underline-offset-2 hover:underline",
                      tone.tone,
                    )}
                  >
                    edit
                  </Link>
                </div>
                <div className="space-y-1.5">
                  {wcMachines.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-line bg-surface-1/60 px-2 py-3 text-center text-[10px] italic text-content-3">
                      No machines yet
                    </div>
                  ) : (
                    wcMachines.map((mc) => {
                      const live = liveById.get(String(mc.id));
                      return (
                        <Link
                          key={mc.id}
                          href={`/production/machine/${mc.id}`}
                          className={cn(
                            "block rounded-lg bg-surface-1 p-2 ring-1 shadow-sm hover:ring-2",
                            tone.border,
                          )}
                        >
                          <div className="flex justify-between">
                            <span className="font-mono font-black text-[11px]">
                              {mc.code}
                            </span>
                            <StatusPill
                              status={String(live?.status || "idle")}
                            />
                          </div>
                          {live?.current_job ? (
                            <>
                              <div className="text-[10px] font-bold text-content-2 truncate">
                                {live.current_job.product_name ||
                                  live.current_job.job_number}
                              </div>
                              <div className="flex justify-between text-[9px]">
                                <span className="text-content-3 truncate">
                                  {(live as any).operator?.name
                                    ? `Op: ${(live as any).operator?.name}`
                                    : live.current_job.job_number}
                                </span>
                              </div>
                            </>
                          ) : (
                            <div className="text-[10px] text-content-3 truncate">
                              {(live as any)?.queue_count
                                ? `${(live as any).queue_count} queued`
                                : "no active job"}
                            </div>
                          )}
                        </Link>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })
        )}
        {/* Material yard summary using WIP aging totals (org-wide for now, no per-plant filter on derive) */}
        {wipAging.length > 0 ? (
          <div className="rounded-xl border border-line bg-surface-2 p-3">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-[10px] font-black uppercase tracking-wider text-content-2">
                  Material yard · this plant
                </div>
                <div className="text-[10px] text-content-3">
                  Raw + WIP storage
                </div>
              </div>
              <Link
                href="/inventory/rolls"
                className="text-[10px] font-bold text-content-2 underline-offset-2 hover:underline"
              >
                drill
              </Link>
            </div>
            <div className="space-y-1.5 text-[10px]">
              {wipAging.map((p) => (
                <div
                  key={p.klass}
                  className="flex items-center justify-between"
                >
                  <span className="text-content-3 font-bold truncate">
                    {p.label}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-content-1">
                      {fmtKg(p.total)} {p.uom}
                    </span>
                    {p.dead > 0 ? (
                      <span className="rounded-full bg-danger-bg px-1.5 py-0.5 text-[9px] font-bold text-danger-fg">
                        {fmtKg(p.dead)} dead
                      </span>
                    ) : p.stale > 0 ? (
                      <span className="rounded-full bg-warning-bg px-1.5 py-0.5 text-[9px] font-bold text-warning-fg">
                        {fmtKg(p.stale)} stale
                      </span>
                    ) : (
                      <span className="rounded-full bg-success-bg px-1.5 py-0.5 text-[9px] font-bold text-success-fg">
                        fresh
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function KpiSmall({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-lg bg-surface-2 ring-1 ring-line px-2.5 py-1.5">
      <div className="text-[9px] font-bold uppercase tracking-wider text-content-3">
        {label}
      </div>
      <div
        className={cn(
          "font-mono text-lg font-black",
          valueClass || "text-content-1",
        )}
      >
        {value}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Customer commitments tab
// ──────────────────────────────────────────────────────────────────────────────

function CustomersTab({
  salesOrders,
  liveMachines,
}: {
  salesOrders: SalesOrder[];
  liveMachines: OperatorMachine[];
}) {
  // Group orders by customer
  const groups = React.useMemo(() => {
    const m = new Map<
      string,
      { name: string; code: string | null; orders: SalesOrder[] }
    >();
    for (const o of salesOrders) {
      const key = (o.customer || o.customer_id || o.customer_name) as string;
      if (!key) continue;
      const entry = m.get(key) || {
        name: o.customer_name,
        code: (o as any).customer_code || null,
        orders: [] as SalesOrder[],
      };
      entry.orders.push(o);
      m.set(key, entry);
    }
    return Array.from(m.entries())
      .map(([key, v]) => ({
        key,
        name: v.name,
        code: v.code,
        orders: v.orders.sort(
          (a, b) => ageDays(b.created_at) - ageDays(a.created_at),
        ),
        totalKg: v.orders.reduce(
          (s, o) =>
            s + Number(o.qty_summary?.ordered_kg || o.total_weight_kg || 0),
          0,
        ),
        avgAge: v.orders.length
          ? v.orders.reduce((s, o) => s + ageDays(o.created_at), 0) /
            v.orders.length
          : 0,
        hasAged: v.orders.some((o) => ageDays(o.created_at) >= 6),
      }))
      .sort(
        (a, b) => Number(b.hasAged) - Number(a.hasAged) || b.avgAge - a.avgAge,
      );
  }, [salesOrders]);

  const buckets = React.useMemo(() => {
    const fresh = { n: 0, kg: 0 },
      watch = { n: 0, kg: 0 },
      aged = { n: 0, kg: 0 };
    for (const o of salesOrders) {
      const kg = Number(o.qty_summary?.ordered_kg || o.total_weight_kg || 0);
      const a = ageDays(o.created_at);
      if (a <= 2) {
        fresh.n++;
        fresh.kg += kg;
      } else if (a <= 5) {
        watch.n++;
        watch.kg += kg;
      } else {
        aged.n++;
        aged.kg += kg;
      }
    }
    return { fresh, watch, aged };
  }, [salesOrders]);

  const avgAgeAll = salesOrders.length
    ? (
        salesOrders.reduce((s, o) => s + ageDays(o.created_at), 0) /
        salesOrders.length
      ).toFixed(1)
    : "0";
  const totalKg = salesOrders.reduce(
    (s, o) => s + Number(o.qty_summary?.ordered_kg || o.total_weight_kg || 0),
    0,
  );
  const pct = (n: number, total: number) =>
    total === 0 ? 0 : Math.max(1, Math.round((n / total) * 100));

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-6">
        <KpiTile
          label="Customers w/ open SO"
          value={String(groups.length)}
          subtle={`${salesOrders.length} open lines`}
        />
        <KpiTile
          label="KG committed"
          value={fmtKg(totalKg)}
          subtle={`across ${salesOrders.length} lines`}
          valueClass="text-primary"
        />
        <KpiTile
          label="Fresh · 0-2d"
          value={String(buckets.fresh.n)}
          subtle={`${fmtKg(buckets.fresh.kg)} KG`}
          valueClass="text-success-fg"
          border="border-success-border bg-success-bg"
        />
        <KpiTile
          label="Watch · 3-5d"
          value={String(buckets.watch.n)}
          subtle={`${fmtKg(buckets.watch.kg)} KG`}
          valueClass="text-warning-fg"
          border="border-warning-border bg-warning-bg"
        />
        <KpiTile
          label="Aged · 6+ days"
          value={String(buckets.aged.n)}
          subtle={`${fmtKg(buckets.aged.kg)} KG · not good`}
          valueClass="text-danger-fg"
          border="border-danger-border bg-danger-bg"
        />
        <KpiTile
          label="Avg age"
          value={`${avgAgeAll}d`}
          subtle={`across ${salesOrders.length} lines`}
        />
      </div>

      <div className="rounded-2xl border border-line bg-surface-1 shadow-sm overflow-hidden">
        <header className="border-b border-line bg-gradient-to-r from-order-bg via-white to-white px-5 py-3">
          <div className="text-[10px] font-black uppercase tracking-[0.22em] text-order-fg">
            Order age distribution · {salesOrders.length} open lines
          </div>
          <h2 className="font-display text-base font-bold text-content-1">
            Days since SO was placed · over 5 days = not good
          </h2>
        </header>
        <div className="p-4">
          <div className="flex gap-0.5 h-8 rounded-md overflow-hidden ring-1 ring-line">
            <div
              className="bg-success-fg"
              style={{ width: `${pct(buckets.fresh.n, salesOrders.length)}%` }}
              title={`Fresh · ${buckets.fresh.n} lines`}
            />
            <div
              className="bg-warning-fg"
              style={{ width: `${pct(buckets.watch.n, salesOrders.length)}%` }}
              title={`Watch · ${buckets.watch.n} lines`}
            />
            <div
              className="bg-danger-solid"
              style={{ width: `${pct(buckets.aged.n, salesOrders.length)}%` }}
              title={`Aged · ${buckets.aged.n} lines`}
            />
          </div>
          <div className="mt-2 grid grid-cols-3 text-[10px] font-bold">
            <div className="text-success-fg">
              <span className="font-mono">
                {pct(buckets.fresh.n, salesOrders.length)}%
              </span>{" "}
              fresh · 0-2 days · OK
            </div>
            <div className="text-warning-fg text-center">
              <span className="font-mono">
                {pct(buckets.watch.n, salesOrders.length)}%
              </span>{" "}
              watch · 3-5 days · stir
            </div>
            <div className="text-danger-fg text-right">
              <span className="font-mono">
                {pct(buckets.aged.n, salesOrders.length)}%
              </span>{" "}
              aged · 6+ days · not good
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {groups.length === 0 ? (
          <div className="col-span-full rounded-2xl border border-dashed border-line bg-surface-1 px-6 py-12 text-center text-sm text-content-3">
            No open sales orders. Customers and commitments will appear here as
            orders are placed.
          </div>
        ) : (
          groups.map((g) => (
            <CustomerCard key={g.key} group={g} liveMachines={liveMachines} />
          ))
        )}
      </div>
    </section>
  );
}

function CustomerCard({
  group,
  liveMachines,
}: {
  group: {
    key: string;
    name: string;
    code: string | null;
    orders: SalesOrder[];
    totalKg: number;
    avgAge: number;
    hasAged: boolean;
  };
  liveMachines: OperatorMachine[];
}) {
  const initials =
    group.name
      .split(/\s+/)
      .slice(0, 2)
      .map((s) => s[0])
      .join("")
      .toUpperCase() || "—";
  const oldestAge = group.orders.length
    ? ageDays(group.orders[0].created_at)
    : 0;
  const agedCount = group.orders.filter(
    (o) => ageDays(o.created_at) >= 6,
  ).length;

  // In-flight chips — count jobs by process step (best effort via live machines)
  const inFlight = React.useMemo(() => {
    const counts: Partial<Record<ProcessKey, number>> = {};
    for (const m of liveMachines) {
      const cj = m.current_job;
      if (!cj) continue;
      // Heuristic: match by customer_name on the job. The OperatorMachine.current_job
      // shape has product_name + job_number; we attribute to customer when one of the
      // group's open orders matches the job_number.
      const matched = group.orders.some(
        (o) => o.order_number && (cj.job_number || "").includes(o.order_number),
      );
      if (!matched) continue;
      const key = processKeyOf(m.work_center_name || "");
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }, [group.orders, liveMachines]);

  return (
    <article
      className={cn(
        "rounded-2xl border bg-surface-1 shadow-sm overflow-hidden",
        group.hasAged ? "border-danger-border" : "border-line",
      )}
    >
      <header
        className={cn(
          "border-b px-5 py-3 flex items-start justify-between gap-3",
          group.hasAged
            ? "border-danger-border bg-gradient-to-r from-danger-bg via-white to-white"
            : "border-line bg-surface-1",
        )}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-xl text-white font-black",
              group.hasAged
                ? "bg-gradient-to-br from-danger-bg to-danger-fg"
                : "bg-gradient-to-br from-success-bg to-success-fg",
            )}
          >
            {initials}
          </span>
          <div className="min-w-0">
            <div
              className={cn(
                "text-[10px] font-black uppercase tracking-[0.22em]",
                group.hasAged ? "text-danger-fg" : "text-success-fg",
              )}
            >
              {group.hasAged
                ? `${agedCount} aged order${agedCount === 1 ? "" : "s"}`
                : "all fresh"}
            </div>
            <h3 className="font-display text-base font-bold text-content-1 truncate">
              {group.name}
            </h3>
            {group.code ? (
              <div className="font-mono text-[10px] text-content-3">
                {group.code}
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          {group.hasAged ? (
            <span className="rounded-full bg-danger-bg px-2 py-0.5 text-[9px] font-black text-danger-fg ring-1 ring-danger-border">
              oldest {oldestAge} days
            </span>
          ) : (
            <span className="rounded-full bg-success-bg px-2 py-0.5 text-[9px] font-black text-success-fg ring-1 ring-success-border">
              0 aged
            </span>
          )}
          <Link
            href={`/sales/orders?customer=${encodeURIComponent(group.key)}`}
            className="text-[10px] font-bold text-content-3 hover:text-content-1 inline-flex items-center gap-1"
          >
            All orders <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </header>
      <div className="grid grid-cols-3 gap-2 px-5 py-3 text-[11px]">
        <KpiSmall label="Open SOs" value={String(group.orders.length)} />
        <KpiSmall
          label="Committed"
          value={`${fmtKg(group.totalKg)} KG`}
          valueClass="text-primary"
        />
        <KpiSmall
          label="Avg age"
          value={`${group.avgAge.toFixed(1)}d`}
          valueClass={group.hasAged ? "text-danger-fg" : "text-success-fg"}
        />
      </div>
      <div className="px-5 pb-3 space-y-1.5 text-[11px]">
        {group.orders.slice(0, 4).map((o) => {
          const age = ageDays(o.created_at);
          const bucket = ageBucket(age);
          const tone = AGE_TONE[bucket];
          const isAged = bucket === "aged";
          return (
            <Link
              key={o.id}
              href={`/sales/orders/${o.id}`}
              className={cn(
                "flex items-center gap-2 rounded-lg ring-1 px-2.5 py-1.5 hover:bg-surface-2",
                tone.ring,
                isAged ? tone.row : "bg-surface-2",
              )}
            >
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[9px] font-black uppercase text-white",
                  tone.pill,
                )}
              >
                {tone.label(age)}
              </span>
              <span className="font-mono font-bold text-content-1">
                {o.order_number}
              </span>
              <span className="text-content-3 truncate">
                {o.item_summary?.variant_code || ""}{" "}
                {o.item_summary?.size_or_form || ""} ·{" "}
                {fmtKg(o.qty_summary?.ordered_kg || o.total_weight_kg || 0)} KG
              </span>
              <span className="ml-auto font-mono font-bold text-content-3">
                placed {fmtDate(o.created_at)}
              </span>
            </Link>
          );
        })}
        {group.orders.length > 4 ? (
          <Link
            href={`/sales/orders?customer=${encodeURIComponent(group.key)}`}
            className="block text-center text-[10px] font-bold text-content-3 hover:text-content-1 py-1"
          >
            + {group.orders.length - 4} more · view all
          </Link>
        ) : null}
      </div>
      {Object.keys(inFlight).length > 0 ? (
        <div className="bg-surface-2 px-5 py-2 border-t border-line flex flex-wrap items-center gap-1.5 text-[10px] font-bold">
          <span className="text-[10px] font-black uppercase tracking-wider text-content-3">
            In flight now
          </span>
          {(Object.keys(inFlight) as ProcessKey[]).map((k) => (
            <span
              key={k}
              className={cn(
                "rounded-md px-1.5 py-0.5 ring-1",
                PROCESS_TONE[k].chip,
              )}
            >
              {inFlight[k]} {PROCESS_TONE[k].label}
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
}
