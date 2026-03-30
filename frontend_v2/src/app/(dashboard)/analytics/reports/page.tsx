"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
    Activity,
    AlertTriangle,
    Droplets,
    Factory,
    Filter,
    Gauge,
    Layers,
    Mail,
    Package,
    RefreshCw,
    Scale,
    Send,
    ShoppingCart,
    Timer,
} from "lucide-react";
import Link from "next/link";

import { analyticsApi, type ReportDispatchRun, type ReportDistributionProfile, type ReportTabResponse } from "@/services/analytics";
import { factoryService } from "@/services/factory";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
        .replace(/\b\w/g, (m) => m.toUpperCase());
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

function extractColumns(rows: Array<Record<string, any>>): string[] {
    if (!rows.length) return [];
    const preferred = [
        "job_number",
        "order_number",
        "material_name",
        "color_family",
        "process_name",
        "machine_name",
        "shift_code",
        "status",
        "theoretical_qty",
        "planned_issue_qty",
        "actual_issued_qty",
        "actual_consumed_qty",
        "variance_qty",
        "output_kg",
        "scrap_kg",
        "date",
    ];
    const keys = Object.keys(rows[0]);
    return [...preferred.filter((k) => keys.includes(k)), ...keys.filter((k) => !preferred.includes(k))].slice(0, 12);
}

function formatSchedule(profile: ReportDistributionProfile) {
    return `${String(profile.schedule_hour).padStart(2, "0")}:${String(profile.schedule_minute).padStart(2, "0")}`;
}

export default function ReportsHubPage() {
    const queryClient = useQueryClient()
    const { toast } = useToast()
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
    });
    const { data: processes = [] } = useQuery({
        queryKey: ["analytics-reports-processes"],
        queryFn: factoryService.getProcesses,
        staleTime: 300_000,
        refetchOnWindowFocus: false,
    });
    const { data: shifts = [] } = useQuery({
        queryKey: ["analytics-reports-shifts", plant],
        queryFn: () => factoryService.getShifts(plant !== "ALL" ? plant : undefined),
        staleTime: 120_000,
        refetchOnWindowFocus: false,
    });
    const reportProfilesQuery = useQuery<ReportDistributionProfile[]>({
        queryKey: ["analytics-report-distributions"],
        queryFn: analyticsApi.getReportDistributions,
        retry: (failureCount, error) => getApiErrorStatus(error) !== 403 && failureCount < 3,
        staleTime: 120_000,
        refetchOnWindowFocus: false,
    })
    const reportRunsQuery = useQuery<ReportDispatchRun[]>({
        queryKey: ["analytics-report-runs", 8],
        queryFn: () => analyticsApi.getReportRuns(8),
        retry: (failureCount, error) => getApiErrorStatus(error) !== 403 && failureCount < 3,
        staleTime: 60_000,
        refetchOnWindowFocus: false,
    })
    const reportProfiles = reportProfilesQuery.data ?? []
    const reportRuns = reportRunsQuery.data ?? []
    const reportDeliveryAccessDenied =
        getApiErrorStatus(reportProfilesQuery.error) === 403 || getApiErrorStatus(reportRunsQuery.error) === 403

    const filters = useMemo(
        () => ({
            plant: plant !== "ALL" ? plant : undefined,
            process: processId !== "ALL" ? processId : undefined,
            shift: shift !== "ALL" ? shift : undefined,
            date_from: dateFrom || undefined,
            date_to: dateTo || undefined,
        }),
        [plant, processId, shift, dateFrom, dateTo]
    );

    const reportQuery = useQuery<ReportTabResponse>({
        queryKey: ["analytics-report-tab", tab, filters],
        queryFn: () => analyticsApi.getReportTab(tab, filters),
        refetchInterval: 30000,
        staleTime: 60_000,
        refetchOnWindowFocus: false,
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
    const rows = (Array.isArray(payload.rows) ? payload.rows : []) as Array<Record<string, any>>;
    const series = (Array.isArray(payload.series) ? payload.series : []) as Array<Record<string, any>>;
    const columns = useMemo(() => extractColumns(rows), [rows]);
    const warnings = payload.warnings || [];
    const coverage = payload.coverage || {};

    const summaryEntries = Object.entries(summary).slice(0, 8);
    const selectedTab = REPORT_TABS.find((x) => x.id === tab) || REPORT_TABS[0];
    const SelectedTabIcon = selectedTab.icon;
    const manualSendMutation = useMutation({
        mutationFn: async (reportCode: string) => analyticsApi.sendReportDistribution(reportCode),
        onSuccess: () => {
            toast({ title: "Report sent", description: "Daily PDF pack was generated and dispatched." })
            queryClient.invalidateQueries({ queryKey: ["analytics-report-runs"] })
        },
        onError: (error: any) => {
            toast({
                variant: "destructive",
                title: "Manual report send failed",
                description: error?.response?.data?.detail || error?.message || "Send failed.",
            })
        },
    })

    return (
        <PremiumPageShell dataTestId="reports-hub-page">
            <PremiumHero
                eyebrow="Analytics"
                title="Reports Hub"
                description="Shift-aware production, variance, lineage, and report-delivery telemetry in one lighter analytics workspace."
                className="border-slate-200 bg-[linear-gradient(135deg,#ffffff_0%,#eef5ff_45%,#ecfeff_100%)] text-slate-950 shadow-[0_34px_88px_-54px_rgba(15,23,42,0.22)]"
                actions={(
                    <>
                        <Button variant="outline" onClick={() => reportQuery.refetch()} disabled={reportQuery.isPending}>
                            <RefreshCw className={`mr-2 h-4 w-4 ${reportQuery.isFetching ? "animate-spin" : ""}`} />
                            Refresh
                        </Button>
                        <Button asChild variant="outline">
                            <Link href="/analytics/capability-matrix">Capability Matrix</Link>
                        </Button>
                    </>
                )}
                metrics={(
                    <PremiumMetricStrip className="xl:grid-cols-4">
                        <PremiumMetricCard label="Active tab" value={selectedTab.label} valueClassName="text-lg sm:text-xl xl:text-[1.35rem]" />
                        <PremiumMetricCard label="Report packs" value={reportProfiles.length || "Restricted"} valueClassName="text-lg sm:text-xl xl:text-[1.35rem]" />
                        <PremiumMetricCard label="Recent report runs" value={reportRuns.length} />
                        <PremiumMetricCard label="Execution log coverage" value={`${toValue(coverage.execution_log_coverage)}%`} valueClassName="text-lg sm:text-xl xl:text-[1.35rem]" />
                    </PremiumMetricStrip>
                )}
            />

            <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)_360px]">
                <PremiumSection
                    title="Filter Rail"
                    description="Keep one active analytics lens without turning the page into a spreadsheet."
                    actions={<Filter className="h-4 w-4 text-slate-400" />}
                    className="xl:sticky xl:top-6 xl:self-start"
                >
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label className="text-xs font-bold text-slate-500">Plant</Label>
                            <Select value={plant} onValueChange={setPlant}>
                                <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="ALL">All Plants</SelectItem>
                                    {plants.map((p: any) => (
                                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label className="text-xs font-bold text-slate-500">Process</Label>
                            <Select value={processId} onValueChange={setProcessId}>
                                <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="ALL">All Processes</SelectItem>
                                    {processes.map((p: any) => (
                                        <SelectItem key={p.id} value={p.id}>{p.code} • {p.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label className="text-xs font-bold text-slate-500">Shift</Label>
                            <Select value={shift} onValueChange={setShift}>
                                <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="ALL">All Shifts</SelectItem>
                                    {shifts.map((s: any) => (
                                        <SelectItem key={s.id} value={String(s.code || "").toUpperCase()}>
                                            {String(s.code || "").toUpperCase()} • {s.name || "Shift"}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                            <div className="space-y-2">
                                <Label className="text-xs font-bold text-slate-500">Date From</Label>
                                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                            </div>
                            <div className="space-y-2">
                                <Label className="text-xs font-bold text-slate-500">Date To</Label>
                                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                            </div>
                        </div>

                        <div className="rounded-[1.4rem] border border-slate-200 bg-slate-50/80 p-4">
                            <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Coverage</div>
                            <div className="mt-3 space-y-2 text-sm">
                                <div className="flex items-center justify-between text-slate-600">
                                    <span>Execution Logs</span>
                                    <span className="font-black text-slate-900">{toValue(coverage.execution_log_coverage)}%</span>
                                </div>
                                <div className="flex items-center justify-between text-slate-600">
                                    <span>Material Actuals</span>
                                    <span className="font-black text-slate-900">{toValue(coverage.material_actual_coverage)}%</span>
                                </div>
                                <div className="flex items-center justify-between text-slate-600">
                                    <span>Shift Tags</span>
                                    <span className="font-black text-slate-900">{toValue(coverage.shift_coverage)}%</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </PremiumSection>

                <div className="min-w-0 space-y-6">
                    <PremiumSection
                        title={selectedTab.label}
                        description="Only the active tab loads its heavy drill payload. Existing data stays visible while the next refresh is happening."
                        actions={(
                            <div className="flex items-center gap-2 text-xs text-slate-500">
                                <SelectedTabIcon className="h-4 w-4 text-indigo-600" />
                                <span>{payload.generated_at ? `Generated ${new Date(payload.generated_at).toLocaleString()}` : "Awaiting first run"}</span>
                                <Badge variant="outline">Live</Badge>
                            </div>
                        )}
                    >
                        <div className="space-y-4">
                            <Tabs value={tab} onValueChange={(v) => setTab(v as ReportTabId)}>
                                <TabsList className="grid h-auto grid-cols-2 gap-1 rounded-2xl border border-slate-200 bg-white p-1 md:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-9">
                                    {REPORT_TABS.map((item) => {
                                        const Icon = item.icon;
                                        return (
                                            <TabsTrigger
                                                key={item.id}
                                                value={item.id}
                                                className="gap-1.5 rounded-xl py-2 text-[11px] font-bold uppercase tracking-wide"
                                            >
                                                <Icon className="h-3.5 w-3.5" />
                                                {item.label}
                                            </TabsTrigger>
                                        );
                                    })}
                                </TabsList>
                            </Tabs>

                            {warnings.length > 0 && (
                                <Card className="border-amber-200 bg-amber-50/60 shadow-none">
                                    <CardContent className="space-y-2 p-4">
                                        {warnings.map((msg, i) => (
                                            <div key={`warn-${i}`} className="flex items-start gap-2 text-xs text-amber-800">
                                                <AlertTriangle className="mt-0.5 h-3.5 w-3.5" />
                                                <span>{msg}</span>
                                            </div>
                                        ))}
                                    </CardContent>
                                </Card>
                            )}

                            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                                {summaryEntries.map(([key, value]) => (
                                    <Card key={key} className="border-slate-200 shadow-none">
                                        <CardContent className="p-4">
                                            <div className="text-[11px] uppercase tracking-wider text-slate-500">{toLabel(key)}</div>
                                            <div className="mt-1 text-xl font-black text-slate-900">{toValue(value)}</div>
                                        </CardContent>
                                    </Card>
                                ))}
                                {!summaryEntries.length && (
                                    <Card className="border-slate-200 shadow-none sm:col-span-2 xl:col-span-4">
                                        <CardContent className="p-4 text-sm text-slate-500">
                                            {reportQuery.isPending ? "Loading summary..." : "No summary metrics for selected filters."}
                                        </CardContent>
                                    </Card>
                                )}
                            </div>

                            <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
                                <Card className="border-slate-200 shadow-none">
                                    <CardHeader className="pb-2">
                                        <CardTitle className="flex items-center gap-2 text-base">
                                            <Activity className="h-4 w-4 text-slate-500" />
                                            Series
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <ScrollArea className="h-[420px] pr-3">
                                            <div className="space-y-2">
                                                {series.length === 0 && <div className="text-sm text-slate-500">No series for this tab.</div>}
                                                {series.slice(0, 24).map((row, idx) => (
                                                    <div key={`series-${idx}`} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-sm">
                                                        <span className="truncate text-slate-700">{toValue(row.name ?? row.date ?? row.shift_code ?? `Series ${idx + 1}`)}</span>
                                                        <span className="font-semibold text-slate-900">{toValue(row.value ?? row.output_kg ?? row.scrap_kg)}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </ScrollArea>
                                    </CardContent>
                                </Card>

                                <Card className="border-slate-200 shadow-none">
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-base">Drill Table</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        {rows.length === 0 ? (
                                            <div className="py-12 text-center text-sm text-slate-500">
                                                No rows in this period for current filters.
                                            </div>
                                        ) : (
                                            <ScrollArea className="h-[420px] rounded-xl border border-slate-200">
                                                <table className="w-full text-xs">
                                                    <thead className="bg-slate-50">
                                                        <tr>
                                                            {columns.map((col) => (
                                                                <th key={col} className="px-3 py-2 text-left font-bold uppercase tracking-wide text-slate-600">
                                                                    {toLabel(col)}
                                                                </th>
                                                            ))}
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {rows.slice(0, 120).map((row, rowIndex) => (
                                                            <tr key={`row-${rowIndex}`} className="border-t border-slate-100">
                                                                {columns.map((col) => (
                                                                    <td key={`${rowIndex}-${col}`} className="px-3 py-2 text-slate-800">
                                                                        {toValue(row[col])}
                                                                    </td>
                                                                ))}
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </ScrollArea>
                                        )}
                                    </CardContent>
                                </Card>
                            </div>
                        </div>
                    </PremiumSection>
                </div>

                <div className="space-y-6 xl:sticky xl:top-6 xl:self-start">
                    {reportDeliveryAccessDenied ? (
                        <PremiumSection title="Report Delivery Restricted" description="Report pack recipients, dispatch history, and PDF previews are only available to report admins.">
                            <div className="text-sm text-slate-600">Analytics tabs remain available, but the delivery rail is hidden for this role.</div>
                        </PremiumSection>
                    ) : (
                        <>
                            <PremiumSection
                                title="Report delivery"
                                description="Daily pack schedules and manual-send controls stay visible without dominating the page."
                                actions={<Mail className="h-4 w-4 text-slate-400" />}
                            >
                                <ScrollArea className="h-[360px] pr-3">
                                    <div className="space-y-3">
                                        {reportProfiles.map((profile) => {
                                            const latestRun = reportRuns.find((run) => run.report_code === profile.report_code)
                                            return (
                                                <div key={profile.report_code} className="rounded-[1.35rem] border border-slate-200 bg-slate-50/70 p-4">
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div>
                                                            <div className="text-sm font-black text-slate-900">{profile.label}</div>
                                                            <div className="mt-1 text-xs text-slate-500">
                                                                {formatSchedule(profile)} · {(profile.target_roles || []).length + (profile.extra_recipients || []).length} recipients
                                                            </div>
                                                        </div>
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() => manualSendMutation.mutate(profile.report_code)}
                                                            disabled={manualSendMutation.isPending}
                                                        >
                                                            <Send className="mr-2 h-3.5 w-3.5" />
                                                            Send daily pack now
                                                        </Button>
                                                    </div>
                                                    <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-xs text-slate-600">
                                                        <div className="font-black uppercase tracking-wide text-slate-500">Latest run</div>
                                                        {latestRun ? (
                                                            <div className="mt-2 space-y-1">
                                                                <div>Status: <span className="font-semibold text-slate-900">{latestRun.status}</span></div>
                                                                <div>Report date: {latestRun.report_date}</div>
                                                            </div>
                                                        ) : (
                                                            <div className="mt-2">No run available yet.</div>
                                                        )}
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>
                                </ScrollArea>
                            </PremiumSection>

                            <PremiumSection
                                title="Recent report runs"
                                description="Latest archive history and preview links."
                                actions={<Send className="h-4 w-4 text-slate-400" />}
                            >
                                <ScrollArea className="h-[300px] pr-3">
                                    <div className="space-y-3">
                                        {reportRuns.slice(0, 8).map((run) => (
                                            <div key={run.id} className="rounded-[1.35rem] border border-slate-200 bg-slate-50/70 p-4 text-xs text-slate-600">
                                                <div className="flex items-start justify-between gap-2">
                                                    <div className="font-black text-slate-900">{run.report_code.replaceAll("_", " ")}</div>
                                                    <Badge variant="outline">{run.status}</Badge>
                                                </div>
                                                <div className="mt-2">Report date: {run.report_date}</div>
                                                <div>Recipients: {run.recipient_count}</div>
                                                <div>Sent: {run.sent_at ? new Date(run.sent_at).toLocaleString() : "—"}</div>
                                                <div className="mt-3 flex flex-wrap gap-3">
                                                    <a
                                                        href={analyticsApi.getReportRunPreviewUrl(run.id)}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="inline-flex font-semibold text-indigo-600 hover:text-indigo-700"
                                                    >
                                                        Preview PDF
                                                    </a>
                                                    {run.detail_file_name ? (
                                                        <a
                                                            href={analyticsApi.getReportRunDetailUrl(run.id)}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            className="inline-flex font-semibold text-slate-700 hover:text-slate-900"
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
