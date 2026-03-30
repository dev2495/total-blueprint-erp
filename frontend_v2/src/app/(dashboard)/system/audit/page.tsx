"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
    ArrowRight,
    FileSearch,
    Loader2,
    LogIn,
    ShieldCheck,
    Waypoints,
    Workflow,
    FileStack,
} from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import {
    PremiumHero,
    PremiumMetricCard,
    PremiumMetricStrip,
    PremiumPageShell,
    PremiumSection,
} from "@/components/ui-custom/premium-page-shell";
import { analyticsApi } from "@/services/analytics";
import { NotificationService } from "@/services/notifications";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";

type AuditMode = "trace" | "sessions" | "permissions" | "reports";

const AUDIT_MODES: Array<{ id: AuditMode; label: string }> = [
    { id: "trace", label: "Operational flow audit" },
    { id: "sessions", label: "Login and session audit" },
    { id: "permissions", label: "Permission and role override audit" },
    { id: "reports", label: "Report-run and archive audit" },
];

function formatStamp(value?: string | null) {
    if (!value) return "—";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleString();
}

function pillTone(value?: string | null) {
    const normalized = String(value || "").toUpperCase();
    if (normalized.includes("LOGIN") || normalized === "SUCCEEDED") return "border-emerald-200 bg-emerald-50 text-emerald-700";
    if (normalized.includes("ROLE") || normalized.includes("OVERRIDE")) return "border-indigo-200 bg-indigo-50 text-indigo-700";
    if (normalized.includes("FAILED") || normalized === "DENIED") return "border-rose-200 bg-rose-50 text-rose-700";
    if (normalized.includes("SKIPPED")) return "border-sky-200 bg-sky-50 text-sky-700";
    return "border-slate-200 bg-slate-100 text-slate-600";
}

export default function AuditCenterPage() {
    const { effectiveRole, user } = useAuth();
    const roleCode = String(effectiveRole || user?.role_info?.code || "").toUpperCase();
    const canAccess = ["ADMIN", "OWNER", "SUPER_ADMIN"].includes(roleCode);

    const [query, setQuery] = useState("");
    const [mode, setMode] = useState<AuditMode>("trace");
    const deferredQuery = useDeferredValue(query.trim());

    const logsQuery = useQuery({
        queryKey: ["audit-operational-logs", "all"],
        queryFn: () => analyticsApi.getOperationalLogs({ type: "all", limit: 80 }),
        enabled: canAccess,
        staleTime: 60_000,
        refetchInterval: 60_000,
    });

    const permissionAuditQuery = useQuery({
        queryKey: ["audit-permission-log"],
        queryFn: NotificationService.getPermissionAudit,
        enabled: canAccess,
        staleTime: 60_000,
        refetchInterval: 60_000,
    });

    const reportRunsQuery = useQuery({
        queryKey: ["audit-report-runs"],
        queryFn: () => analyticsApi.getReportRuns(20, 30),
        enabled: canAccess,
        staleTime: 60_000,
        refetchInterval: 60_000,
    });

    const traceQuery = useQuery({
        queryKey: ["audit-trace-lookup", deferredQuery],
        queryFn: () => analyticsApi.traceLookup(deferredQuery),
        enabled: canAccess && deferredQuery.length > 1,
        retry: false,
        staleTime: 30_000,
    });

    const logs = Array.isArray(logsQuery.data) ? logsQuery.data : [];
    const permissionRows = Array.isArray(permissionAuditQuery.data) ? permissionAuditQuery.data : [];
    const reportRuns = Array.isArray(reportRunsQuery.data) ? reportRunsQuery.data : [];

    const loginRows = useMemo(
        () => logs.filter((row) => {
            const eventType = String(row.event_type || "").toUpperCase();
            return eventType === "USER_LOGIN" || eventType === "USER_LOGOUT";
        }),
        [logs],
    );
    const operationalRows = useMemo(
        () => logs.filter((row) => !["USER_LOGIN", "USER_LOGOUT"].includes(String(row.event_type || "").toUpperCase())),
        [logs],
    );
    const modeCounts = useMemo(
        () => ({
            trace: operationalRows.length,
            sessions: loginRows.length,
            permissions: permissionRows.length,
            reports: reportRuns.length,
        }),
        [operationalRows.length, loginRows.length, permissionRows.length, reportRuns.length]
    );

    if (!canAccess) {
        return (
            <div className="space-y-6">
                <section className="rounded-[28px] border border-amber-200 bg-amber-50/90 p-8 shadow-sm">
                    <Badge className="rounded-full border border-amber-200 bg-white text-[11px] font-black uppercase tracking-[0.26em] text-amber-700">
                        Audit Access
                    </Badge>
                    <h1 className="mt-4 text-3xl font-black tracking-tight text-slate-950">Audit Center</h1>
                    <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-slate-700">
                        Audit Center is limited to owner and admin roles. Store and operational roles should use Roll Genealogy,
                        inventory history, and route-specific timelines instead of the enterprise audit console.
                    </p>
                    <div className="mt-6 flex flex-wrap gap-3">
                        <Link href="/inventory/traceability">
                            <Button className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800">
                                <Waypoints className="mr-2 h-4 w-4" />
                                Open Roll Genealogy
                            </Button>
                        </Link>
                        <Link href="/inventory/roll-explorer">
                            <Button variant="outline" className="rounded-2xl">
                                <FileSearch className="mr-2 h-4 w-4" />
                                Open Roll Explorer
                            </Button>
                        </Link>
                    </div>
                </section>
            </div>
        );
    }

    return (
        <PremiumPageShell dataTestId="audit-center-page">
            <PremiumHero
                eyebrow="Administration"
                title="Audit Center"
                description="One enterprise proof console for login/session evidence, permission overrides, operational flow truth, and report-run/archive audit."
                className="border-slate-200 bg-[linear-gradient(135deg,#ffffff_0%,#eef5ff_40%,#dbeafe_100%)] text-slate-950 shadow-[0_34px_88px_-54px_rgba(15,23,42,0.22)]"
                actions={(
                    <>
                        <Button asChild variant="outline" className="border-slate-200 bg-white/90 text-slate-700 hover:bg-slate-50">
                            <Link href="/inventory/traceability">Roll Genealogy</Link>
                        </Button>
                        <Button asChild className="bg-slate-950 text-white hover:bg-slate-800">
                            <Link href="/system/report-center">Report Center</Link>
                        </Button>
                    </>
                )}
                metrics={(
                    <PremiumMetricStrip className="xl:grid-cols-4">
                        <PremiumMetricCard label="Operational logs" value={logs.length} />
                        <PremiumMetricCard label="Login entries" value={loginRows.length} />
                        <PremiumMetricCard label="Permission audit" value={permissionRows.length} />
                        <PremiumMetricCard label="Report runs" value={reportRuns.length} />
                    </PremiumMetricStrip>
                )}
            />

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.08fr)_380px]">
                <PremiumSection
                    title="Guided search"
                    description="Search one reference and follow order, dispatch, permission, login, and reporting proof without jumping across modules."
                >
                    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_260px]">
                        <div className="space-y-4">
                            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
                                <div className="space-y-2">
                                    <Label>Reference search</Label>
                                    <Input
                                        value={query}
                                        onChange={(event) => setQuery(event.target.value)}
                                        placeholder="SO02938, QT00167, challan, roll label, PBK, DC..."
                                    />
                                </div>
                                <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 px-4 py-4 text-sm text-slate-600">
                                    Search stays inside the current audit and trace endpoints.
                                </div>
                            </div>

                            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                                {AUDIT_MODES.map((item) => (
                                    <button
                                        key={item.id}
                                        type="button"
                                        onClick={() => setMode(item.id)}
                                        className={`rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition ${
                                            mode === item.id
                                                ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                                                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                                        }`}
                                    >
                                        <div>{item.label}</div>
                                        <div className="mt-1 text-[11px] font-black tracking-normal text-slate-400">
                                            {modeCounts[item.id]} records
                                        </div>
                                    </button>
                                ))}
                            </div>

                            <div className="rounded-[1.6rem] border border-slate-200 bg-slate-50/70 p-4">
                                {deferredQuery.length <= 1 ? (
                                    <div className="space-y-4">
                                        <div className="text-sm text-slate-500">
                                            Enter at least 2 characters to load trace proof. Until then, keep the latest enterprise evidence visible by audit lane.
                                        </div>
                                        <div className="grid gap-3 lg:grid-cols-2">
                                            <div className="rounded-[1.4rem] border border-slate-200 bg-white p-4">
                                                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Latest session proof</div>
                                                <div className="mt-2 text-sm font-black text-slate-900">
                                                    {loginRows[0]?.desc || "No login event captured yet."}
                                                </div>
                                                <div className="mt-2 text-xs text-slate-500">
                                                    {loginRows[0]?.date ? formatStamp(loginRows[0].date) : "Login audit stays live as soon as a session event lands."}
                                                </div>
                                            </div>
                                            <div className="rounded-[1.4rem] border border-slate-200 bg-white p-4">
                                                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Latest permission event</div>
                                                <div className="mt-2 text-sm font-black text-slate-900">
                                                    {permissionRows[0] ? String(permissionRows[0].action || "ROLE_OVERRIDE").replaceAll("_", " ") : "No permission event captured yet."}
                                                </div>
                                                <div className="mt-2 text-xs text-slate-500">
                                                    {permissionRows[0]?.created_at ? formatStamp(permissionRows[0].created_at) : "Role override and denial proof appears here first."}
                                                </div>
                                            </div>
                                            <div className="rounded-[1.4rem] border border-slate-200 bg-white p-4">
                                                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Latest operational trail</div>
                                                <div className="mt-2 text-sm font-black text-slate-900">
                                                    {operationalRows[0]?.desc || "No operational audit event captured yet."}
                                                </div>
                                                <div className="mt-2 text-xs text-slate-500">
                                                    {operationalRows[0]?.date ? formatStamp(operationalRows[0].date) : "Order, dispatch, inter-plant, and jobwork proof appears here."}
                                                </div>
                                            </div>
                                            <div className="rounded-[1.4rem] border border-slate-200 bg-white p-4">
                                                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Latest report-run proof</div>
                                                <div className="mt-2 text-sm font-black text-slate-900">
                                                    {reportRuns[0]?.report_code ? String(reportRuns[0].report_code).replaceAll("_", " ") : "No report run captured yet."}
                                                </div>
                                                <div className="mt-2 text-xs text-slate-500">
                                                    {reportRuns[0]?.sent_at ? formatStamp(reportRuns[0].sent_at) : "PDF archive and manual-send proof appears here."}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ) : traceQuery.isLoading ? (
                                    <div className="flex items-center gap-2 text-sm text-slate-500">
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        Searching cross-module proof...
                                    </div>
                                ) : traceQuery.isError ? (
                                    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                                        {(traceQuery.error as any)?.response?.data?.error || (traceQuery.error as Error)?.message || "No trace record found."}
                                    </div>
                                ) : traceQuery.data?.entity ? (
                                    <div className="space-y-4">
                                        <div className="flex flex-wrap items-start justify-between gap-3">
                                            <div>
                                                <div className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">
                                                    {traceQuery.data.entity.type.replaceAll("_", " ")}
                                                </div>
                                                <div className="mt-2 text-2xl font-black text-slate-950">{traceQuery.data.entity.reference}</div>
                                                <div className="mt-1 text-sm text-slate-600">
                                                    {traceQuery.data.entity.subtitle || traceQuery.data.entity.title}
                                                </div>
                                            </div>
                                            {traceQuery.data.entity.status ? <Badge variant="outline">{traceQuery.data.entity.status}</Badge> : null}
                                        </div>

                                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                                            {Object.entries(traceQuery.data.summary || {}).slice(0, 4).map(([key, value]) => (
                                                <div key={key} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                                                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">{key.replaceAll("_", " ")}</div>
                                                    <div className="mt-2 text-sm font-bold text-slate-900">{String(value ?? "—")}</div>
                                                </div>
                                            ))}
                                        </div>

                                        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                                            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                                                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Timeline proof</div>
                                                <div className="mt-3 space-y-2">
                                                    {(traceQuery.data.timeline || []).slice(0, 6).map((item: any, index: number) => (
                                                        <div key={`${item.reference || item.event_type || index}-${index}`} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                                                            <div className="font-semibold text-slate-900">{item.label || item.event_type || "Event"}</div>
                                                            <div className="mt-1 text-xs text-slate-500">{item.description || item.reference || "Trace proof"}</div>
                                                        </div>
                                                    ))}
                                                    {!(traceQuery.data.timeline || []).length ? (
                                                        <div className="rounded-xl border border-dashed border-slate-200 px-3 py-5 text-center text-slate-500">
                                                            No timeline entries returned for this query.
                                                        </div>
                                                    ) : null}
                                                </div>
                                            </div>
                                            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                                                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Related proof routes</div>
                                                <div className="mt-3 space-y-2 text-sm">
                                                    {(traceQuery.data.related || []).slice(0, 8).map((item, index) => (
                                                        <Link
                                                            key={`${item.reference || item.label || index}`}
                                                            href={String(item.href || "/system/audit")}
                                                            className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700 transition hover:border-slate-300 hover:bg-white"
                                                        >
                                                            <span className="font-semibold">{String(item.label || item.reference || item.type || "Related proof")}</span>
                                                            <ArrowRight className="h-4 w-4 text-slate-400" />
                                                        </Link>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="text-sm text-slate-500">No trace record found for the current query.</div>
                                )}
                            </div>
                        </div>

                        <div className="space-y-4 xl:sticky xl:top-6 xl:self-start">
                            {[
                                {
                                    icon: <LogIn className="h-4 w-4 text-emerald-600" />,
                                    title: "Login visibility",
                                    description: "Login attempts and session proof stay first-class, not hidden in generic operational logs.",
                                    value: `${loginRows.length} visible entries`,
                                },
                                {
                                    icon: <ShieldCheck className="h-4 w-4 text-indigo-600" />,
                                    title: "Permission audit",
                                    description: "Role overrides, denials, and effective-role changes stay in one explicit governance lane.",
                                    value: `${permissionRows.length} governance events`,
                                },
                                {
                                    icon: <FileStack className="h-4 w-4 text-slate-700" />,
                                    title: "Report archive proof",
                                    description: "Archive history, PDF preview, and manual-send evidence stay in the same admin proof console.",
                                    value: `${reportRuns.length} recent report runs`,
                                },
                                {
                                    icon: <Workflow className="h-4 w-4 text-sky-700" />,
                                    title: "Operational flow proof",
                                    description: "Dispatch, jobwork, inter-plant, and route proof stay attached to the same reference trail.",
                                    value: `${operationalRows.length} cross-module logs`,
                                },
                            ].map((card) => (
                                <div key={card.title} className="rounded-[1.5rem] border border-slate-200 bg-white/92 p-5 shadow-sm">
                                    <div className="flex items-center gap-2 text-slate-900">
                                        {card.icon}
                                        <div className="text-sm font-black">{card.title}</div>
                                    </div>
                                    <p className="mt-3 text-sm leading-6 text-slate-600">{card.description}</p>
                                    <div className="mt-3 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">{card.value}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                </PremiumSection>

                <PremiumSection
                    title={AUDIT_MODES.find((item) => item.id === mode)?.label || "Audit"}
                    description="Switch the proof mode without losing the current search context."
                    actions={mode === "trace" ? <Workflow className="h-4 w-4 text-slate-400" /> : null}
                >
                    {mode === "trace" ? (
                        <ScrollArea className="h-[calc(100vh-27rem)] min-h-[420px] pr-4">
                            <div className="space-y-3">
                                {logsQuery.isLoading ? (
                                    <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        Loading operational proof...
                                    </div>
                                ) : null}
                                {operationalRows.map((row, index) => (
                                    <Link
                                        key={`${String(row.event_type || "event")}-${String(row.reference || index)}-${index}`}
                                        href={row.href || "/system/audit"}
                                        className="block rounded-[1.4rem] border border-slate-200 bg-slate-50/70 p-4 transition hover:border-slate-300 hover:bg-white"
                                    >
                                        <div className="flex flex-wrap items-start justify-between gap-3">
                                            <div>
                                                <div className="text-sm font-black text-slate-900">{row.desc || "Operational event"}</div>
                                                <div className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">
                                                    {String(row.type || "proof")} · {String(row.event_type || "event").replaceAll("_", " ")}
                                                </div>
                                            </div>
                                            <Badge className={`rounded-full ${pillTone(row.event_type)}`}>
                                                {row.val || row.reference || String(row.event_type || "event")}
                                            </Badge>
                                        </div>
                                        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                                            <span>{formatStamp(row.date)}</span>
                                            {row.user ? <span>User {row.user}</span> : null}
                                            {row.reference ? <span>{row.reference}</span> : null}
                                        </div>
                                    </Link>
                                ))}
                                {!logsQuery.isLoading && !operationalRows.length ? (
                                    <div className="grid gap-3 lg:grid-cols-3">
                                        <div className="rounded-[1.4rem] border border-slate-200 bg-slate-50/70 p-4">
                                            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Login and session audit</div>
                                            <div className="mt-2 text-sm font-black text-slate-900">
                                                {loginRows[0]?.desc || "Recent login proof appears here first."}
                                            </div>
                                            <div className="mt-2 text-xs text-slate-500">
                                                {loginRows[0]?.date ? formatStamp(loginRows[0].date) : "Switch to Login and session audit to review live entries."}
                                            </div>
                                        </div>
                                        <div className="rounded-[1.4rem] border border-slate-200 bg-slate-50/70 p-4">
                                            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Permission and role override audit</div>
                                            <div className="mt-2 text-sm font-black text-slate-900">
                                                {permissionRows[0] ? String(permissionRows[0].action || "ROLE_OVERRIDE").replaceAll("_", " ") : "Recent role and permission proof appears here."}
                                            </div>
                                            <div className="mt-2 text-xs text-slate-500">
                                                {permissionRows[0]?.created_at ? formatStamp(permissionRows[0].created_at) : "Switch to Permission and role override audit for the detailed feed."}
                                            </div>
                                        </div>
                                        <div className="rounded-[1.4rem] border border-slate-200 bg-slate-50/70 p-4">
                                            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Report-run and archive audit</div>
                                            <div className="mt-2 text-sm font-black text-slate-900">
                                                {reportRuns[0]?.report_code ? String(reportRuns[0].report_code).replaceAll("_", " ") : "Recent report proof appears here."}
                                            </div>
                                            <div className="mt-2 text-xs text-slate-500">
                                                {reportRuns[0]?.sent_at ? formatStamp(reportRuns[0].sent_at) : "Switch to Report-run and archive audit for PDF and manual-send proof."}
                                            </div>
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                        </ScrollArea>
                    ) : null}

                    {mode === "sessions" ? (
                        <ScrollArea className="h-[calc(100vh-27rem)] min-h-[420px] pr-4">
                            <div className="space-y-3">
                                {loginRows.map((row, index) => (
                                    <div key={`${row.reference || row.user || index}-${index}`} className="rounded-[1.4rem] border border-slate-200 bg-slate-50/70 p-4">
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <div className="text-sm font-black text-slate-900">{row.desc || "Login event"}</div>
                                                <div className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">
                                                    {String(row.event_type || "USER_LOGIN").replaceAll("_", " ")}
                                                </div>
                                            </div>
                                            <Badge className={`rounded-full ${pillTone(row.event_type)}`}>{row.user || "User"}</Badge>
                                        </div>
                                        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                                            <span>{formatStamp(row.date)}</span>
                                            {row.reference ? <span>{row.reference}</span> : null}
                                        </div>
                                    </div>
                                ))}
                                {!loginRows.length ? (
                                    <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-500">
                                        No login or logout records are visible yet.
                                    </div>
                                ) : null}
                            </div>
                        </ScrollArea>
                    ) : null}

                    {mode === "permissions" ? (
                        <ScrollArea className="h-[calc(100vh-27rem)] min-h-[420px] pr-4">
                            <div className="space-y-3">
                                {permissionRows.slice(0, 24).map((row) => (
                                    <div key={row.id} className="rounded-[1.35rem] border border-slate-200 bg-slate-50/70 p-4">
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <div className="text-sm font-black text-slate-900">{String(row.action || "AUDIT").replaceAll("_", " ")}</div>
                                                <div className="mt-1 text-xs text-slate-500">{row.method} · {row.path || "Path unavailable"}</div>
                                            </div>
                                            <Badge className={`rounded-full ${pillTone(row.action)}`}>{row.effective_role || "—"}</Badge>
                                        </div>
                                        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                                            <span>{formatStamp(row.created_at)}</span>
                                            {row.user ? <span>User {row.user}</span> : null}
                                            {row.required_permission ? <span>{row.required_permission}</span> : null}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </ScrollArea>
                    ) : null}

                    {mode === "reports" ? (
                        <ScrollArea className="h-[calc(100vh-27rem)] min-h-[420px] pr-4">
                            <div className="space-y-3">
                                {reportRuns.slice(0, 16).map((run) => (
                                    <div key={run.id} className="rounded-[1.35rem] border border-slate-200 bg-slate-50/70 p-4">
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <div className="text-sm font-black text-slate-900">{String(run.report_code || "report").replaceAll("_", " ")}</div>
                                                <div className="mt-1 text-xs text-slate-500">Report date {run.report_date}</div>
                                            </div>
                                            <Badge className={`rounded-full ${pillTone(run.status)}`}>{run.status}</Badge>
                                        </div>
                                        <div className="mt-3 grid gap-3 sm:grid-cols-3 text-xs text-slate-500">
                                            <div>{run.recipient_count} recipients</div>
                                            <div>{run.triggered_manually ? "Manual dispatch" : "Scheduled dispatch"}</div>
                                            <div>{run.sent_at ? formatStamp(run.sent_at) : "Not sent yet"}</div>
                                        </div>
                                        <div className="mt-3 flex flex-wrap gap-2">
                                            <a
                                                href={analyticsApi.getReportRunPreviewUrl(run.id)}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:border-slate-300"
                                            >
                                                Preview PDF
                                            </a>
                                            <a
                                                href={analyticsApi.getReportRunPdfDownloadUrl(run.id)}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:border-slate-300"
                                            >
                                                Download PDF
                                            </a>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </ScrollArea>
                    ) : null}
                </PremiumSection>
            </div>
        </PremiumPageShell>
    );
}
