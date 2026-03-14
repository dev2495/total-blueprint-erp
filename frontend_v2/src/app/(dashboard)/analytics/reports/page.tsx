"use client";

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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
    });
    const { data: processes = [] } = useQuery({
        queryKey: ["analytics-reports-processes"],
        queryFn: factoryService.getProcesses,
    });
    const { data: shifts = [] } = useQuery({
        queryKey: ["analytics-reports-shifts", plant],
        queryFn: () => factoryService.getShifts(plant !== "ALL" ? plant : undefined),
    });
    const reportProfilesQuery = useQuery<ReportDistributionProfile[]>({
        queryKey: ["analytics-report-distributions"],
        queryFn: analyticsApi.getReportDistributions,
        retry: (failureCount, error) => getApiErrorStatus(error) !== 403 && failureCount < 3,
    })
    const reportRunsQuery = useQuery<ReportDispatchRun[]>({
        queryKey: ["analytics-report-runs", 8],
        queryFn: () => analyticsApi.getReportRuns(8),
        retry: (failureCount, error) => getApiErrorStatus(error) !== 403 && failureCount < 3,
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
        <div className="min-h-screen bg-slate-50/50 p-6 space-y-6">
            <div className="rounded-3xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-black tracking-tight text-slate-900 flex items-center gap-2">
                            <BarChart3 className="h-7 w-7 text-indigo-600" />
                            Reports Hub
                        </h1>
                        <p className="text-sm text-slate-600 mt-1">
                            Shift-aware production, variance, and ink intelligence analytics with telemetry coverage.
                        </p>
                    </div>
                    <Button variant="outline" onClick={() => reportQuery.refetch()} disabled={reportQuery.isFetching}>
                        <RefreshCw className={`h-4 w-4 mr-2 ${reportQuery.isFetching ? "animate-spin" : ""}`} />
                        Refresh
                    </Button>
                    <Button asChild variant="outline">
                        <Link href="/analytics/capability-matrix">Capability Matrix</Link>
                    </Button>
                </div>
            </div>

            {reportDeliveryAccessDenied ? (
                <Card className="border-slate-200">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-lg font-black text-slate-900">Report Delivery Restricted</CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm text-slate-600">
                        Report pack recipients, dispatch history, and PDF previews are only available to report admins.
                    </CardContent>
                </Card>
            ) : (
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                    <div className="grid gap-4 md:grid-cols-2">
                        {reportProfiles.map((profile) => {
                            const latestRun = reportRuns.find((run) => run.report_code === profile.report_code)
                            return (
                                <Card key={profile.report_code} className="border-slate-200">
                                    <CardHeader className="pb-3">
                                        <CardTitle className="flex items-center gap-2 text-lg font-black text-slate-900">
                                            <Mail className="h-5 w-5 text-indigo-600" />
                                            {profile.label}
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-3">
                                        <div className="grid gap-3 sm:grid-cols-2 text-sm">
                                            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                                                <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">Schedule</div>
                                                <div className="mt-1 font-semibold text-slate-900">
                                                    {String(profile.schedule_hour).padStart(2, "0")}:{String(profile.schedule_minute).padStart(2, "0")}
                                                </div>
                                            </div>
                                            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                                                <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">Recipients</div>
                                                <div className="mt-1 font-semibold text-slate-900">
                                                    {(profile.target_roles || []).length + (profile.extra_recipients || []).length}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600">
                                            <div className="font-black uppercase tracking-wide text-slate-500">Latest run</div>
                                            {latestRun ? (
                                                <div className="mt-2 space-y-1">
                                                    <div>Status: <span className="font-semibold text-slate-900">{latestRun.status}</span></div>
                                                    <div>Report date: {latestRun.report_date}</div>
                                                    <a
                                                        href={analyticsApi.getReportRunPreviewUrl(latestRun.id)}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="font-semibold text-indigo-600 hover:text-indigo-700"
                                                    >
                                                        Preview latest PDF
                                                    </a>
                                                    {latestRun.detail_file_name ? (
                                                        <a
                                                            href={analyticsApi.getReportRunDetailUrl(latestRun.id)}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            className="block font-semibold text-slate-700 hover:text-slate-900"
                                                        >
                                                            Download detail workbook
                                                        </a>
                                                    ) : null}
                                                </div>
                                            ) : (
                                                <div className="mt-2">No run available yet.</div>
                                            )}
                                        </div>
                                        <Button
                                            variant="outline"
                                            onClick={() => manualSendMutation.mutate(profile.report_code)}
                                            disabled={manualSendMutation.isPending}
                                        >
                                            <Send className="mr-2 h-4 w-4" />
                                            Send daily pack now
                                        </Button>
                                    </CardContent>
                                </Card>
                            )
                        })}
                    </div>

                    <Card className="border-slate-200">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-lg font-black text-slate-900">Recent report runs</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {reportRuns.slice(0, 6).map((run) => (
                                <div key={run.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="font-black text-slate-900">{run.report_code.replaceAll("_", " ")}</div>
                                        <Badge variant="outline">{run.status}</Badge>
                                    </div>
                                    <div className="mt-2">Report date: {run.report_date}</div>
                                    <div>Recipients: {run.recipient_count}</div>
                                    <div>Sent: {run.sent_at ? new Date(run.sent_at).toLocaleString() : "—"}</div>
                                    <a
                                        href={analyticsApi.getReportRunPreviewUrl(run.id)}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="mt-2 inline-flex font-semibold text-indigo-600 hover:text-indigo-700"
                                    >
                                        Preview PDF
                                    </a>
                                    {run.detail_file_name ? (
                                        <a
                                            href={analyticsApi.getReportRunDetailUrl(run.id)}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="ml-4 mt-2 inline-flex font-semibold text-slate-700 hover:text-slate-900"
                                        >
                                            Download detail workbook
                                        </a>
                                    ) : null}
                                </div>
                            ))}
                        </CardContent>
                    </Card>
                </div>
            )}

            <Tabs value={tab} onValueChange={(v) => setTab(v as ReportTabId)}>
                <TabsList className="h-auto grid grid-cols-2 md:grid-cols-3 xl:grid-cols-9 gap-1 p-1 bg-white border border-slate-200">
                    {REPORT_TABS.map((item) => {
                        const Icon = item.icon;
                        return (
                            <TabsTrigger
                                key={item.id}
                                value={item.id}
                                className="gap-1.5 py-2 text-[11px] font-bold uppercase tracking-wide"
                            >
                                <Icon className="h-3.5 w-3.5" />
                                {item.label}
                            </TabsTrigger>
                        );
                    })}
                </TabsList>
            </Tabs>

            <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
                <Card className="xl:col-span-3 border-slate-200">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm uppercase tracking-wider text-slate-600 flex items-center gap-2">
                            <Filter className="h-4 w-4" />
                            Filter Rail
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <div className="space-y-1">
                            <Label className="text-xs font-bold text-slate-500">Plant</Label>
                            <Select value={plant} onValueChange={setPlant}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="ALL">All Plants</SelectItem>
                                    {plants.map((p: any) => (
                                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs font-bold text-slate-500">Process</Label>
                            <Select value={processId} onValueChange={setProcessId}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="ALL">All Processes</SelectItem>
                                    {processes.map((p: any) => (
                                        <SelectItem key={p.id} value={p.id}>{p.code} • {p.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs font-bold text-slate-500">Shift</Label>
                            <Select value={shift} onValueChange={setShift}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
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
                        <div className="space-y-1">
                            <Label className="text-xs font-bold text-slate-500">Date From</Label>
                            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs font-bold text-slate-500">Date To</Label>
                            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                        </div>

                        <div className="rounded-xl bg-slate-50 p-3 border border-slate-200 space-y-2">
                            <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Coverage</div>
                            <div className="text-xs text-slate-700 flex items-center justify-between">
                                <span>Execution Logs</span>
                                <span className="font-black">{toValue(coverage.execution_log_coverage)}%</span>
                            </div>
                            <div className="text-xs text-slate-700 flex items-center justify-between">
                                <span>Material Actuals</span>
                                <span className="font-black">{toValue(coverage.material_actual_coverage)}%</span>
                            </div>
                            <div className="text-xs text-slate-700 flex items-center justify-between">
                                <span>Shift Tags</span>
                                <span className="font-black">{toValue(coverage.shift_coverage)}%</span>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <div className="xl:col-span-9 space-y-4">
                    <Card className="border-slate-200">
                        <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                                <SelectedTabIcon className="h-4 w-4 text-indigo-600" />
                                <span className="font-bold text-slate-900">{selectedTab.label}</span>
                                <Badge variant="outline">Live</Badge>
                            </div>
                            <div className="text-xs text-slate-500">
                                Generated: {payload.generated_at ? new Date(payload.generated_at).toLocaleString() : "—"}
                            </div>
                        </CardContent>
                    </Card>

                    {warnings.length > 0 && (
                        <Card className="border-amber-200 bg-amber-50/50">
                            <CardContent className="p-4 space-y-2">
                                {warnings.map((msg, i) => (
                                    <div key={`warn-${i}`} className="text-xs text-amber-800 flex items-start gap-2">
                                        <AlertTriangle className="h-3.5 w-3.5 mt-0.5" />
                                        <span>{msg}</span>
                                    </div>
                                ))}
                            </CardContent>
                        </Card>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                        {summaryEntries.map(([key, value]) => (
                            <Card key={key} className="border-slate-200">
                                <CardContent className="p-4">
                                    <div className="text-[11px] uppercase tracking-wider text-slate-500">{toLabel(key)}</div>
                                    <div className="text-xl font-black text-slate-900 mt-1">{toValue(value)}</div>
                                </CardContent>
                            </Card>
                        ))}
                        {!summaryEntries.length && (
                            <Card>
                                <CardContent className="p-4 text-sm text-slate-500">
                                    {reportQuery.isLoading ? "Loading summary..." : "No summary metrics for selected filters."}
                                </CardContent>
                            </Card>
                        )}
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                        <Card className="xl:col-span-1 border-slate-200">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-base flex items-center gap-2">
                                    <Activity className="h-4 w-4 text-slate-500" />
                                    Series
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-2">
                                {series.length === 0 && <div className="text-sm text-slate-500">No series for this tab.</div>}
                                {series.slice(0, 16).map((row, idx) => (
                                    <div key={`series-${idx}`} className="flex items-center justify-between border rounded-md px-3 py-2 text-sm">
                                        <span className="truncate">{toValue(row.name ?? row.date ?? row.shift_code ?? `Series ${idx + 1}`)}</span>
                                        <span className="font-semibold">{toValue(row.value ?? row.output_kg ?? row.scrap_kg)}</span>
                                    </div>
                                ))}
                            </CardContent>
                        </Card>

                        <Card className="xl:col-span-2 border-slate-200">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-base">Drill Table</CardTitle>
                            </CardHeader>
                            <CardContent>
                                {rows.length === 0 ? (
                                    <div className="text-sm text-slate-500 py-8 text-center">
                                        No rows in this period for current filters.
                                    </div>
                                ) : (
                                    <div className="overflow-auto border rounded-lg">
                                        <table className="w-full text-xs">
                                            <thead className="bg-slate-50">
                                                <tr>
                                                    {columns.map((col) => (
                                                        <th key={col} className="text-left px-3 py-2 font-bold text-slate-600 uppercase tracking-wide">
                                                            {toLabel(col)}
                                                        </th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {rows.slice(0, 120).map((row, rowIndex) => (
                                                    <tr key={`row-${rowIndex}`} className="border-t">
                                                        {columns.map((col) => (
                                                            <td key={`${rowIndex}-${col}`} className="px-3 py-2 text-slate-800">
                                                                {toValue(row[col])}
                                                            </td>
                                                        ))}
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </div>
        </div>
    );
}
