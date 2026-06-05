"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Droplets,
  Factory,
  Filter,
  Gauge,
  Layers,
  Package,
  RefreshCw,
  Scale,
  Send,
  ShoppingCart,
  Timer,
  Truck,
} from "lucide-react";

import {
  analyticsApi,
  type ReportDispatchRun,
  type ReportDistributionProfile,
  type ReportTabResponse,
} from "@/services/analytics";
import { factoryService } from "@/services/factory";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PremiumHero,
  PremiumMetricCard,
  PremiumMetricStrip,
  PremiumPageShell,
  PremiumSection,
} from "@/components/ui-custom/premium-page-shell";
import { getApiErrorStatus } from "@/lib/api";

type ReportTabId =
  | "production"
  | "oee"
  | "scrap"
  | "interplant"
  | "material-variance"
  | "ink-intelligence"
  | "sales"
  | "inventory-lineage"
  | "mrp"
  | "shift-performance";

const REPORT_TABS: Array<{ id: ReportTabId; label: string; icon: any }> = [
  { id: "production", label: "Production", icon: Factory },
  { id: "oee", label: "OEE", icon: Gauge },
  { id: "scrap", label: "Scrap", icon: AlertTriangle },
  { id: "interplant", label: "Inter-Plant", icon: Truck },
  { id: "material-variance", label: "Material Variance", icon: Scale },
  { id: "ink-intelligence", label: "Ink Intelligence", icon: Droplets },
  { id: "sales", label: "Sales Fulfillment", icon: ShoppingCart },
  { id: "inventory-lineage", label: "Inventory Lineage", icon: Package },
  { id: "mrp", label: "MRP", icon: Layers },
  { id: "shift-performance", label: "Shift Performance", icon: Timer },
];

function toLabel(key: string) {
  return String(key || "")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function toValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "—";
    return value.toLocaleString(undefined, { maximumFractionDigits: 3 });
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

export default function ReportsHubPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [tab, setTab] = useState<ReportTabId>("production");
  const [plant, setPlant] = useState("ALL");
  const [processId, setProcessId] = useState("ALL");
  const [shift, setShift] = useState("ALL");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const { data: plants = [] } = useQuery({
    queryKey: ["analytics-reports-plants"],
    queryFn: factoryService.getPlants,
    staleTime: 300_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
  const { data: processes = [] } = useQuery({
    queryKey: ["analytics-reports-processes"],
    queryFn: factoryService.getProcesses,
    staleTime: 300_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
  const { data: shifts = [] } = useQuery({
    queryKey: ["analytics-reports-shifts", plant],
    queryFn: () =>
      factoryService.getShifts(plant !== "ALL" ? plant : undefined),
    staleTime: 120_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  const reportProfilesQuery = useQuery<ReportDistributionProfile[]>({
    queryKey: ["analytics-report-distributions"],
    queryFn: analyticsApi.getReportDistributions,
    retry: (failureCount, error) =>
      getApiErrorStatus(error) !== 403 && failureCount < 3,
    staleTime: 600_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    placeholderData: (previous) => previous,
  });

  const reportRunsQuery = useQuery<ReportDispatchRun[]>({
    queryKey: ["analytics-report-runs", 8],
    queryFn: () => analyticsApi.getReportRuns(8),
    retry: (failureCount, error) =>
      getApiErrorStatus(error) !== 403 && failureCount < 3,
    staleTime: 300_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    placeholderData: (previous) => previous,
  });

  const filters = useMemo(
    () => ({
      plant: plant !== "ALL" ? plant : undefined,
      process: processId !== "ALL" ? processId : undefined,
      shift: shift !== "ALL" ? shift : undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    }),
    [plant, processId, shift, dateFrom, dateTo],
  );

  const reportQuery = useQuery<ReportTabResponse>({
    queryKey: ["analytics-report-tab", tab, filters],
    queryFn: () => analyticsApi.getReportTab(tab, filters),
    staleTime: 300_000,
    refetchInterval: 120_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    placeholderData: (previous) => previous,
  });

  const payload: ReportTabResponse = reportQuery.data ?? {
    tab,
    summary: {},
    series: [],
    rows: [],
    warnings: [],
    coverage: {},
  };

  const summary = payload.summary ?? payload.kpis ?? {};
  const summaryEntries = Object.entries(summary).slice(0, 6);
  const meaningfulSummaryEntries = summaryEntries.filter(
    ([, value]) => value !== null && value !== undefined && value !== "",
  );
  const series = Array.isArray(payload.series) ? payload.series : [];
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const coverage = payload.coverage || {};
  const warnings = payload.warnings || [];
  const reportProfiles = reportProfilesQuery.data ?? [];
  const reportRuns = reportRunsQuery.data ?? [];
  const selectedTab =
    REPORT_TABS.find((item) => item.id === tab) || REPORT_TABS[0];
  const SelectedTabIcon = selectedTab.icon;
  const latestRun = reportRuns[0] ?? null;
  const seriesLeaders = useMemo(() => {
    return series
      .slice(0, 6)
      .map((row, index) => ({
        key: `${row.name || row.date || row.shift_code || index}`,
        label: toValue(
          row.name ?? row.date ?? row.shift_code ?? `Series ${index + 1}`,
        ),
        sublabel: toValue(
          row.process_name ??
            row.machine_name ??
            row.category ??
            selectedTab.label,
        ),
        value: Number(row.value ?? row.output_kg ?? row.scrap_kg ?? 0),
      }))
      .filter((row) => Number.isFinite(row.value));
  }, [selectedTab.label, series]);
  const leaderMax = useMemo(
    () => Math.max(...seriesLeaders.map((row) => row.value), 1),
    [seriesLeaders],
  );
  const headlineMetrics = useMemo(
    () =>
      meaningfulSummaryEntries.length
        ? meaningfulSummaryEntries
            .slice(0, 4)
            .map(([key, value]) => ({
              key,
              label: toLabel(key),
              value: toValue(value),
            }))
        : [
            {
              key: "profiles",
              label: "Report Packs",
              value: reportProfiles.length || "Restricted",
            },
            { key: "runs", label: "Recent Runs", value: reportRuns.length },
            { key: "rows", label: "Active Rows", value: rows.length },
            { key: "signals", label: "Signal Lines", value: series.length },
          ],
    [
      rows.length,
      series.length,
      meaningfulSummaryEntries,
      reportProfiles.length,
      reportRuns.length,
    ],
  );

  const reportDeliveryAccessDenied =
    getApiErrorStatus(reportProfilesQuery.error) === 403 ||
    getApiErrorStatus(reportRunsQuery.error) === 403;

  const manualSendMutation = useMutation({
    mutationFn: async (reportCode: string) =>
      analyticsApi.sendReportDistribution(reportCode),
    onSuccess: () => {
      toast({
        title: "Report generated",
        description:
          "Daily pack was archived and owner/admin were notified in-app.",
      });
      queryClient.invalidateQueries({ queryKey: ["analytics-report-runs"] });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Manual report send failed",
        description:
          error?.response?.data?.detail || error?.message || "Send failed.",
      });
    },
  });

  return (
    <PremiumPageShell dataTestId="reports-hub-page">
      <PremiumHero
        eyebrow="Analytics"
        title="Reports Hub"
        description="Fast summary first, active report detail second, and direct jumps into archive or PDF proof without a heavy full-page wait."
        className="border-line bg-[linear-gradient(135deg,#0f172a_0%,#1e3a8a_54%,#3b82f6_100%)]"
        actions={
          <>
            <Button
              variant="outline"
              className="border-surface-1/20 bg-surface-1/10 text-white hover:bg-surface-1/15 hover:text-white"
              onClick={() => reportQuery.refetch()}
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${reportQuery.isFetching ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
            <Button
              asChild
              variant="outline"
              className="border-surface-1/20 bg-surface-1/10 text-white hover:bg-surface-1/15 hover:text-white"
            >
              <Link href="/analytics/capability-matrix">Capability Matrix</Link>
            </Button>
            <Button
              asChild
              variant="outline"
              className="border-surface-1/20 bg-surface-1/10 text-white hover:bg-surface-1/15 hover:text-white"
            >
              <Link href="/system/report-center">Open Report Center</Link>
            </Button>
          </>
        }
        metrics={
          <PremiumMetricStrip className="xl:grid-cols-4">
            <PremiumMetricCard
              label="Active tab"
              value={selectedTab.label}
              tone="dark"
              valueClassName="text-lg sm:text-xl xl:text-[1.35rem]"
            />
            <PremiumMetricCard
              label="Report packs"
              value={reportProfiles.length || "Restricted"}
              tone="dark"
            />
            <PremiumMetricCard
              label="Recent report runs"
              value={reportRuns.length}
              tone="dark"
            />
            <PremiumMetricCard
              label="Execution log coverage"
              value={`${toValue(coverage.execution_log_coverage)}%`}
              tone="dark"
              hint={
                rows.length
                  ? `${rows.length} active rows`
                  : "Awaiting current-tab rows"
              }
            />
          </PremiumMetricStrip>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[260px_minmax(0,1fr)_360px]">
        <PremiumSection
          title="Filter Rail"
          description="Keep one active lens without turning the analytics surface into a spreadsheet."
          actions={<Filter className="h-4 w-4 text-content-4" />}
          className="xl:sticky xl:top-6 xl:self-start"
        >
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs font-bold text-content-3">Plant</Label>
              <Select value={plant} onValueChange={setPlant}>
                <SelectTrigger className="bg-surface-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Plants</SelectItem>
                  {plants.map((plantRow: any) => (
                    <SelectItem key={plantRow.id} value={plantRow.id}>
                      {plantRow.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-bold text-content-3">
                Process
              </Label>
              <Select value={processId} onValueChange={setProcessId}>
                <SelectTrigger className="bg-surface-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Processes</SelectItem>
                  {processes.map((processRow: any) => (
                    <SelectItem key={processRow.id} value={processRow.id}>
                      {processRow.code} • {processRow.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-bold text-content-3">Shift</Label>
              <Select value={shift} onValueChange={setShift}>
                <SelectTrigger className="bg-surface-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Shifts</SelectItem>
                  {shifts.map((shiftRow: any) => (
                    <SelectItem
                      key={shiftRow.id}
                      value={String(shiftRow.code || "").toUpperCase()}
                    >
                      {String(shiftRow.code || "").toUpperCase()} •{" "}
                      {shiftRow.name || "Shift"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-3">
              <div className="space-y-2">
                <Label className="text-xs font-bold text-content-3">
                  Date From
                </Label>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(event) => setDateFrom(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-bold text-content-3">
                  Date To
                </Label>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(event) => setDateTo(event.target.value)}
                />
              </div>
            </div>
            <div className="rounded-[1.4rem] border border-line bg-surface-2 p-4">
              <div className="text-[11px] font-black uppercase tracking-[0.18em] text-content-3">
                Coverage
              </div>
              <div className="mt-3 space-y-2 text-sm">
                <div className="flex items-center justify-between text-content-3">
                  <span>Execution Logs</span>
                  <span className="font-black text-content-1">
                    {toValue(coverage.execution_log_coverage)}%
                  </span>
                </div>
                <div className="flex items-center justify-between text-content-3">
                  <span>Material Actuals</span>
                  <span className="font-black text-content-1">
                    {toValue(coverage.material_actual_coverage)}%
                  </span>
                </div>
                <div className="flex items-center justify-between text-content-3">
                  <span>Shift Tags</span>
                  <span className="font-black text-content-1">
                    {toValue(coverage.shift_coverage)}%
                  </span>
                </div>
              </div>
            </div>
          </div>
        </PremiumSection>

        <div className="min-w-0 space-y-6">
          <PremiumSection
            title="Reporting overview"
            description="Keep the summary stable, make the active report tab do the heavy lifting, and jump into the exact report route from here."
            actions={
              <div className="flex items-center gap-2 text-xs text-content-3">
                <SelectedTabIcon className="h-4 w-4 text-primary" />
                <span>
                  {payload.generated_at
                    ? `Generated ${new Date(payload.generated_at).toLocaleString()}`
                    : "Awaiting first run"}
                </span>
                <Badge variant="outline">Live</Badge>
              </div>
            }
          >
            <div className="space-y-5">
              <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-9">
                {REPORT_TABS.map((item) => {
                  const Icon = item.icon;
                  const active = tab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setTab(item.id)}
                      className={`flex items-center justify-center gap-2 rounded-2xl border px-3 py-3 text-xs font-black uppercase tracking-[0.14em] transition ${
                        active
                          ? "border-info-border bg-info-bg text-primary"
                          : "border-line bg-surface-1 text-content-3 hover:border-line-strong"
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {item.label}
                    </button>
                  );
                })}
              </div>

              {warnings.length > 0 ? (
                <div className="rounded-[1.5rem] border border-warning-border bg-warning-bg p-4">
                  <div className="space-y-2">
                    {warnings.map((message, index) => (
                      <div
                        key={`${message}-${index}`}
                        className="flex items-start gap-2 text-sm text-warning-fg"
                      >
                        <AlertTriangle className="mt-0.5 h-4 w-4" />
                        <span>{message}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <PremiumMetricStrip className="xl:grid-cols-4">
                {headlineMetrics.map((metric) => (
                  <PremiumMetricCard
                    key={metric.key}
                    label={metric.label}
                    value={metric.value}
                    valueClassName="text-base sm:text-lg xl:text-[1.2rem]"
                  />
                ))}
              </PremiumMetricStrip>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(300px,0.95fr)]">
                <div className="space-y-4">
                  <div className="rounded-[1.6rem] border border-line bg-surface-2 p-4">
                    <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-content-3">
                      <Activity className="h-4 w-4 text-primary" />
                      Live Reporting Signals
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      {meaningfulSummaryEntries
                        .slice(0, 4)
                        .map(([key, value]) => (
                          <div
                            key={`signal-${key}`}
                            className="rounded-2xl border border-line bg-surface-1 p-3"
                          >
                            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-content-3">
                              {toLabel(key)}
                            </div>
                            <div className="mt-2 text-xl font-black text-content-1">
                              {toValue(value)}
                            </div>
                          </div>
                        ))}
                      {!meaningfulSummaryEntries.length ? (
                        <div className="rounded-2xl border border-dashed border-line px-4 py-10 text-center text-sm text-content-3 sm:col-span-2">
                          Current tab has no summary metrics yet, so the hub is
                          falling back to recent-run and coverage proof instead.
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="rounded-[1.6rem] border border-line bg-surface-2 p-4">
                    <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-content-3">
                      <BarChart3 className="h-4 w-4 text-content-2" />
                      Signal bars
                    </div>
                    <div className="mt-4 space-y-3">
                      {seriesLeaders.length ? (
                        seriesLeaders.map((row) => (
                          <div
                            key={row.key}
                            className="rounded-2xl border border-line bg-surface-1 p-3"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-black text-content-1">
                                  {row.label}
                                </div>
                                <div className="mt-1 truncate text-xs text-content-3">
                                  {row.sublabel}
                                </div>
                              </div>
                              <div className="text-sm font-black text-content-1">
                                {toValue(row.value)}
                              </div>
                            </div>
                            <div className="mt-3 h-2 rounded-full bg-surface-2">
                              <div
                                className="h-full rounded-full bg-[linear-gradient(90deg,#2563eb_0%,#60a5fa_55%,#22c55e_100%)]"
                                style={{
                                  width: `${Math.max((row.value / leaderMax) * 100, 8)}%`,
                                }}
                              />
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-2xl border border-dashed border-line px-4 py-10 text-center text-sm text-content-3">
                          Signal bars will appear as soon as the active report
                          returns chart rows.
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-[1.6rem] border border-line bg-surface-2 p-4">
                    <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-content-3">
                      <Factory className="h-4 w-4 text-content-2" />
                      Throughput Leaders
                    </div>
                    <ScrollArea className="mt-4 h-[300px] pr-3">
                      <div className="space-y-3">
                        {series.length ? (
                          series.slice(0, 18).map((row, index) => (
                            <div
                              key={`${row.name || row.date || index}-${index}`}
                              className="rounded-2xl border border-line bg-surface-1 p-3"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-black text-content-1">
                                    {toValue(
                                      row.name ??
                                        row.date ??
                                        row.shift_code ??
                                        `Series ${index + 1}`,
                                    )}
                                  </div>
                                  <div className="mt-1 text-xs text-content-3">
                                    {toValue(
                                      row.process_name ??
                                        row.machine_name ??
                                        row.category ??
                                        selectedTab.label,
                                    )}
                                  </div>
                                </div>
                                <div className="text-sm font-black text-content-1">
                                  {toValue(
                                    row.value ?? row.output_kg ?? row.scrap_kg,
                                  )}
                                </div>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="rounded-2xl border border-dashed border-line px-4 py-10 text-center text-sm text-content-3">
                            No execution telemetry has been seeded yet. The
                            green runner injects controlled telemetry so this
                            section fills on the next full release pass.
                          </div>
                        )}
                      </div>
                    </ScrollArea>
                  </div>
                </div>

                <div className="rounded-[1.6rem] border border-line bg-surface-2 p-4">
                  <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-content-3">
                    <Activity className="h-4 w-4 text-primary" />
                    Active report workspace
                  </div>
                  <ScrollArea className="mt-4 h-[520px] pr-3">
                    <div className="space-y-3">
                      {rows.length ? (
                        rows.slice(0, 36).map((row, index) => (
                          <div
                            key={`row-${index}`}
                            className="rounded-2xl border border-line bg-surface-1 p-4"
                          >
                            <div className="grid gap-3 sm:grid-cols-2">
                              {Object.entries(row)
                                .slice(0, 6)
                                .map(([key, value]) => (
                                  <div key={`${index}-${key}`}>
                                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-content-3">
                                      {toLabel(key)}
                                    </div>
                                    <div className="mt-1 text-sm font-semibold text-content-1">
                                      {toValue(value)}
                                    </div>
                                  </div>
                                ))}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-2xl border border-dashed border-line px-4 py-12 text-center text-sm text-content-3">
                          No rows in this period for the current filters.
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                </div>
              </div>
            </div>
          </PremiumSection>
        </div>

        <div className="space-y-6 xl:sticky xl:top-6 xl:self-start">
          <PremiumSection
            title="Quick report access"
            description="Jump straight into the latest proof path without scanning the whole hub."
            actions={<SelectedTabIcon className="h-4 w-4 text-content-4" />}
          >
            <div className="space-y-3">
              <Link
                href="/system/report-center"
                className="flex items-center justify-between rounded-[1.35rem] border border-line bg-surface-2 px-4 py-3 text-sm font-semibold text-content-2 transition hover:border-line-strong hover:bg-surface-1"
              >
                <span>Open report archive</span>
                <RefreshCw className="h-4 w-4 text-content-4" />
              </Link>
              <Link
                href={`/analytics/reports/${tab}`}
                className="flex items-center justify-between rounded-[1.35rem] border border-line bg-surface-2 px-4 py-3 text-sm font-semibold text-content-2 transition hover:border-line-strong hover:bg-surface-1"
              >
                <span>Open current report route</span>
                <BarChart3 className="h-4 w-4 text-content-4" />
              </Link>
              {latestRun ? (
                <a
                  href={analyticsApi.getReportRunPreviewUrl(latestRun.id)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between rounded-[1.35rem] border border-line bg-surface-2 px-4 py-3 text-sm font-semibold text-content-2 transition hover:border-line-strong hover:bg-surface-1"
                >
                  <span>Preview latest PDF</span>
                  <Send className="h-4 w-4 text-content-4" />
                </a>
              ) : null}
            </div>
          </PremiumSection>
          {reportDeliveryAccessDenied ? (
            <PremiumSection
              title="Report Archive Restricted"
              description="Report generation history and PDF previews are only available to report admins."
            >
              <div className="text-sm text-content-3">
                Analytics tabs remain available, but the archive rail is hidden
                for this role.
              </div>
            </PremiumSection>
          ) : (
            <>
              <PremiumSection
                title="Report generation"
                description="Owner/admin archive generation controls and latest run proof without leaving the hub."
                actions={<Send className="h-4 w-4 text-content-4" />}
              >
                <ScrollArea className="h-[320px] pr-3">
                  <div className="space-y-3">
                    {reportProfiles.map((profile) => {
                      const latestRun = reportRuns.find(
                        (run) => run.report_code === profile.report_code,
                      );
                      return (
                        <div
                          key={profile.report_code}
                          className="rounded-[1.35rem] border border-line bg-surface-2 p-4"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-sm font-black text-content-1">
                                {profile.label}
                              </div>
                              <div className="mt-1 text-xs text-content-3">
                                Owner/Admin inbox notice ·{" "}
                                {(profile.target_roles || []).join(" · ") ||
                                  "OWNER · ADMIN"}
                              </div>
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                manualSendMutation.mutate(profile.report_code)
                              }
                              disabled={manualSendMutation.isPending}
                            >
                              <Send className="mr-2 h-3.5 w-3.5" />
                              Generate daily pack
                            </Button>
                          </div>
                          <div className="mt-3 rounded-xl border border-line bg-surface-1 px-3 py-3 text-xs text-content-3">
                            <div className="font-black uppercase tracking-wide text-content-3">
                              Latest run
                            </div>
                            {latestRun ? (
                              <div className="mt-2 space-y-1">
                                <div>
                                  Status:{" "}
                                  <span className="font-semibold text-content-1">
                                    {latestRun.status}
                                  </span>
                                </div>
                                <div>Report date: {latestRun.report_date}</div>
                              </div>
                            ) : (
                              <div className="mt-2">No run available yet.</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </PremiumSection>

              <PremiumSection
                title="Recent report runs"
                description="Archive history and direct preview links."
                actions={<Send className="h-4 w-4 text-content-4" />}
              >
                <ScrollArea className="h-[320px] pr-3">
                  <div className="space-y-3">
                    {reportRuns.slice(0, 8).map((run) => (
                      <div
                        key={run.id}
                        className="rounded-[1.35rem] border border-line bg-surface-2 p-4 text-xs text-content-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="font-black text-content-1">
                            {run.report_code.replaceAll("_", " ")}
                          </div>
                          <Badge variant="outline">{run.status}</Badge>
                        </div>
                        <div className="mt-2">
                          Report date: {run.report_date}
                        </div>
                        <div>
                          Audience:{" "}
                          {(run.recipients || []).join(" · ") ||
                            "OWNER · ADMIN"}
                        </div>
                        <div>
                          Generated:{" "}
                          {run.sent_at
                            ? new Date(run.sent_at).toLocaleString()
                            : "—"}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-3">
                          <a
                            href={analyticsApi.getReportRunPreviewUrl(run.id)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex font-semibold text-primary hover:text-primary"
                          >
                            Preview PDF
                          </a>
                          {run.detail_file_name ? (
                            <a
                              href={analyticsApi.getReportRunDetailUrl(run.id)}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex font-semibold text-content-2 hover:text-content-1"
                            >
                              Download detail workbook
                            </a>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </PremiumSection>
            </>
          )}
        </div>
      </div>
    </PremiumPageShell>
  );
}
