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
    Box,
    Database,
    Settings,
    Layers,
    Search
} from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { PremiumPageShell } from "@/components/ui-custom/premium-page-shell";
import { analyticsApi } from "@/services/analytics";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import styles from "./audit.module.css";
import { cn } from "@/lib/utils";

type AuditMode = "trace" | "production" | "inventory" | "master_data" | "system_config" | "permissions" | "sessions" | "reports";

const AUDIT_MODES: Array<{ id: AuditMode; label: string; styleClass: string; icon: any }> = [
    { id: "trace", label: "Operational Flow", styleClass: styles.trace, icon: Workflow },
    { id: "production", label: "Production Runs", styleClass: styles.production, icon: Layers },
    { id: "inventory", label: "Inventory Movement", styleClass: styles.inventory, icon: Box },
    { id: "master_data", label: "Master Data", styleClass: styles.masterData, icon: Database },
    { id: "system_config", label: "System Config", styleClass: styles.systemConfig, icon: Settings },
    { id: "permissions", label: "Permissions", styleClass: styles.permissions, icon: ShieldCheck },
    { id: "sessions", label: "Session & Login", styleClass: styles.sessions, icon: LogIn },
    { id: "reports", label: "Report Archives", styleClass: styles.reports, icon: FileStack },
];

function formatStamp(value?: string | null) {
    if (!value) return "—";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleString();
}

function pillTone(value?: string | null) {
    const normalized = String(value || "").toUpperCase();
    if (normalized.includes("LOGIN") || normalized === "SUCCEEDED") return styles.pillSuccess;
    if (normalized.includes("ROLE") || normalized.includes("OVERRIDE")) return styles.pillWarning;
    if (normalized.includes("FAILED") || normalized === "DENIED" || normalized.includes("SCRAP")) return styles.pillDanger;
    return styles.pillNeutral;
}

export default function AuditCenterPage() {
    const { effectiveRole, user } = useAuth();
    const roleCode = String(effectiveRole || user?.role_info?.code || "").toUpperCase();
    const canAccess = ["ADMIN", "OWNER", "SUPER_ADMIN"].includes(roleCode);

    const [query, setQuery] = useState("");
    const [mode, setMode] = useState<AuditMode>("trace");
    const deferredQuery = useDeferredValue(query.trim());

    const auditConsoleQuery = useQuery({
        queryKey: ["audit-console"],
        queryFn: analyticsApi.getAuditConsole,
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

    const auditConsole = auditConsoleQuery.data;
    
    // Fallback empty arrays
    const loginRows = useMemo(() => Array.isArray(auditConsole?.modes?.sessions?.items) ? auditConsole.modes.sessions.items : [], [auditConsole]);
    const permissionRows = useMemo(() => Array.isArray(auditConsole?.modes?.permissions?.items) ? auditConsole.modes.permissions.items : [], [auditConsole]);
    const operationalRows = useMemo(() => Array.isArray(auditConsole?.modes?.operations?.items) ? auditConsole.modes.operations.items : [], [auditConsole]);
    const reportRuns = useMemo(() => Array.isArray(auditConsole?.modes?.reports?.items) ? auditConsole.modes.reports.items : [], [auditConsole]);
    const inventoryRows = useMemo(() => Array.isArray(auditConsole?.modes?.inventory?.items) ? auditConsole.modes.inventory.items : [], [auditConsole]);
    const productionRows = useMemo(() => Array.isArray(auditConsole?.modes?.production?.items) ? auditConsole.modes.production.items : [], [auditConsole]);
    const masterDataRows = useMemo(() => Array.isArray(auditConsole?.modes?.master_data?.items) ? auditConsole.modes.master_data.items : [], [auditConsole]);
    const systemConfigRows = useMemo(() => Array.isArray(auditConsole?.modes?.system_config?.items) ? auditConsole.modes.system_config.items : [], [auditConsole]);

    const modeCounts = useMemo(
        () => ({
            trace: Number(auditConsole?.counts?.operational_logs ?? operationalRows.length),
            sessions: Number(auditConsole?.counts?.login_entries ?? loginRows.length),
            permissions: Number(auditConsole?.counts?.permission_audit ?? permissionRows.length),
            reports: Number(auditConsole?.counts?.report_runs ?? reportRuns.length),
            inventory: Number(auditConsole?.counts?.inventory_audit ?? inventoryRows.length),
            production: Number(auditConsole?.counts?.production_audit ?? productionRows.length),
            master_data: Number(auditConsole?.counts?.master_data_audit ?? masterDataRows.length),
            system_config: Number(auditConsole?.counts?.system_config_audit ?? systemConfigRows.length),
        }),
        [auditConsole, operationalRows, loginRows, permissionRows, reportRuns, inventoryRows, productionRows, masterDataRows, systemConfigRows]
    );

    if (!canAccess) {
        return (
            <div className="space-y-6 max-w-2xl">
                <section className="rounded-[28px] border border-amber-200 bg-amber-50/90 p-8 shadow-sm">
                    <Badge className="rounded-full border border-amber-200 bg-white text-[11px] font-black uppercase tracking-[0.26em] text-amber-700">
                        Audit Access
                    </Badge>
                    <h1 className="mt-4 text-3xl font-black tracking-tight text-slate-950">Audit Center</h1>
                    <p className="mt-3 text-sm font-semibold leading-6 text-slate-700">
                        Audit Center is limited to owner and admin roles. Use Roll Genealogy,
                        inventory history, and route-specific timelines instead of the enterprise audit console.
                    </p>
                    <div className="mt-6 flex flex-wrap gap-3">
                        <Link href="/inventory/traceability">
                            <Button className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800">
                                <Waypoints className="mr-2 h-4 w-4" />
                                Open Roll Genealogy
                            </Button>
                        </Link>
                    </div>
                </section>
            </div>
        );
    }
    
    // Select the current rows based on active mode
    const getCurrentRows = () => {
        switch(mode) {
            case "sessions": return loginRows;
            case "permissions": return permissionRows;
            case "reports": return reportRuns;
            case "inventory": return inventoryRows;
            case "production": return productionRows;
            case "master_data": return masterDataRows;
            case "system_config": return systemConfigRows;
            default: return operationalRows;
        }
    };
    
    const currentRows = getCurrentRows();
    const currentModeMeta = AUDIT_MODES.find(m => m.id === mode);

    return (
        <PremiumPageShell dataTestId="audit-center-page">
            <div className={styles.auditContainer}>
                {/* Hero Section */}
                <div className={styles.heroCard}>
                    <div className="flex flex-col md:flex-row gap-6 justify-between items-start md:items-end">
                        <div>
                            <div className="text-[11px] font-black uppercase tracking-[0.22em] text-white/50 mb-3">Enterprise Governance</div>
                            <h1 className="text-4xl font-black text-white">Audit Center</h1>
                            <p className="mt-3 text-sm font-medium text-white/70 max-w-2xl leading-relaxed">
                                Live operational evidence, system logs, master data changes, and session proof.<br/> 
                                Full traceability across 8 distinct factory streams without leaving the console.
                            </p>
                        </div>
                        <div className="flex gap-3">
                            <Button asChild variant="outline" className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white rounded-xl">
                                <Link href="/inventory/traceability">Genealogy</Link>
                            </Button>
                            <Button asChild className="bg-white text-slate-900 hover:bg-slate-100 rounded-xl">
                                <Link href="/system/report-center">Report Center</Link>
                            </Button>
                        </div>
                    </div>
                    
                    <div className={styles.metricStrip}>
                        <div className={styles.metricCard}>
                            <div className={styles.metricLabel}>Total Events</div>
                            <div className={styles.metricValue}>
                                {Object.values(modeCounts).reduce((a, b) => a + b, 0).toLocaleString()}
                            </div>
                        </div>
                        <div className={styles.metricCard}>
                            <div className={styles.metricLabel}>Active Streams</div>
                            <div className={styles.metricValue}>8</div>
                        </div>
                        <div className={styles.metricCard}>
                            <div className={styles.metricLabel}>Data Source</div>
                            <div className={styles.metricValue}>Live</div>
                        </div>
                        <div className={styles.metricCard}>
                            <div className={styles.metricLabel}>Trace Latency</div>
                            <div className={styles.metricValue}>{'<'} 1s</div>
                        </div>
                    </div>
                </div>

                {/* Audit Modes Grid */}
                <div className={styles.lanesGrid}>
                    {AUDIT_MODES.map((item) => {
                        const active = mode === item.id;
                        const Icon = item.icon;
                        return (
                            <button
                                key={item.id}
                                type="button"
                                onClick={() => setMode(item.id)}
                                className={cn(styles.laneCard, item.styleClass, active && styles.active)}
                            >
                                <div className="flex items-center gap-2 mb-3">
                                    <Icon className={cn("h-4 w-4", active ? "text-slate-900" : "text-slate-500")} />
                                    <div className={styles.laneLabel}>Stream Mode</div>
                                </div>
                                <div className={styles.laneTitle}>{item.label}</div>
                                <div className={styles.laneValue}>
                                    {modeCounts[item.id].toLocaleString()} events linked
                                </div>
                            </button>
                        );
                    })}
                </div>

                {/* Split Workspace */}
                <div className={styles.workspaceGrid}>
                    
                    {/* Left: Stream Feed / Search Results */}
                    <div className="space-y-4">
                        <div className={styles.sectionPanel}>
                            <div className={styles.sectionHeader}>
                                <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">Evidence Console</div>
                                <h3 className={styles.sectionTitle}>{currentModeMeta?.label}</h3>
                                <div className={styles.sectionDesc}>
                                    Viewing {currentRows.length} recent visible entries in this stream constraint.
                                </div>
                            </div>
                            
                            <ScrollArea className="h-[calc(100vh-28rem)] min-h-[500px] pr-4">
                                <div className="space-y-3 pb-6">
                                    {auditConsoleQuery.isLoading && (
                                        <div className="flex items-center gap-2 p-5 text-sm text-slate-500">
                                            <Loader2 className="h-4 w-4 animate-spin" /> Fetching stream...
                                        </div>
                                    )}
                                    
                                    {!auditConsoleQuery.isLoading && currentRows.length === 0 && (
                                        <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
                                            No events captured in this stream yet.
                                        </div>
                                    )}

                                    {currentRows.map((row: any, i: number) => {
                                        // Standardize row variables as much as possible since different arrays have different shapes
                                        const title = row.desc || row.label || row.action || String(row.report_code || "Event");
                                        const subtitle = row.event_type || row.method || (row.report_date ? `Reported ${row.report_date}` : null);
                                        const timestamp = row.date || row.created_at || row.timestamp;
                                        const tagText = row.val || row.status || row.reference || row.user || "LOGGED";
                                        const link = row.href || (row.id ? `/system/audit?id=${row.id}` : "#");

                                        return (
                                            <div key={`${row.id || i}`} className={styles.timelineCard}>
                                                <div className={styles.timelineCardHeader}>
                                                    <div>
                                                        <div className={styles.timelineTitle}>{String(title).replaceAll("_", " ")}</div>
                                                        {subtitle && <div className={styles.timelineSub}>{String(subtitle).replaceAll("_", " ")}</div>}
                                                    </div>
                                                    <span className={cn(styles.timelinePill, pillTone(tagText))}>
                                                        {tagText}
                                                    </span>
                                                </div>
                                                <div className={styles.timelineMeta}>
                                                    <div>{formatStamp(timestamp)}</div>
                                                    {row.user && <div>User: {row.user}</div>}
                                                    {row.reference && <div>Ref: {row.reference}</div>}
                                                    {row.required_permission && <div>Missing Perm: {row.required_permission}</div>}
                                                    {row.path && <div>Path: {row.path}</div>}
                                                </div>
                                                
                                                {/* Reports Extra Links */}
                                                {mode === "reports" && row.id && (
                                                    <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                                                       <a href={analyticsApi.getReportRunPreviewUrl(row.id)} target="_blank" rel="noreferrer" className="text-xs font-bold text-indigo-600 hover:text-indigo-800">Preview PDF</a>
                                                       <span className="text-slate-300">|</span>
                                                       <a href={analyticsApi.getReportRunPdfDownloadUrl(row.id)} target="_blank" rel="noreferrer" className="text-xs font-bold text-indigo-600 hover:text-indigo-800">Download</a>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </ScrollArea>
                        </div>
                    </div>

                    {/* Right: Trace Lookup panel */}
                    <div className="space-y-4">
                        <div className={styles.sectionPanel}>
                            <div className={styles.sectionHeader}>
                                <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">Guided search</div>
                                <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">Cross-Module Target</div>
                                <h3 className={styles.sectionTitle}>Deep Trace</h3>
                                <div className={styles.sectionDesc}>Follow one reference across all connected streams.</div>
                            </div>
                            
                            <div className="space-y-4">
                                <div className="space-y-2 relative">
                                    <Label>Reference Number</Label>
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-slate-400">
                                            <Search className="h-4 w-4" />
                                        </div>
                                        <Input
                                            value={query}
                                            onChange={(e) => setQuery(e.target.value)}
                                            placeholder="SO02938, PBK-RM, challan..."
                                            className="pl-10 h-11 bg-white border-slate-200"
                                        />
                                    </div>
                                </div>
                                
                                {deferredQuery.length > 1 ? (
                                    <div className="mt-6 rounded-2xl bg-slate-50 border border-slate-200 p-4">
                                        {traceQuery.isLoading ? (
                                            <div className="flex gap-2 text-sm text-slate-500 items-center">
                                                <Loader2 className="h-4 w-4 animate-spin"/> Tracking reference...
                                            </div>
                                        ) : traceQuery.isError ? (
                                            <div className="text-sm text-amber-700 bg-amber-50 p-3 rounded-xl border border-amber-200">
                                                No reference matched across ERP databases.
                                            </div>
                                        ) : traceQuery.data?.entity ? (
                                            <div className="space-y-4">
                                                <div className="border-b border-slate-200 pb-3">
                                                    <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                                                       {String(traceQuery.data.entity.type).replaceAll("_", " ")}
                                                    </div>
                                                    <div className="font-bold text-lg text-slate-900 mt-1">{traceQuery.data.entity.reference}</div>
                                                    {traceQuery.data.entity.subtitle && (
                                                        <div className="text-xs text-slate-500 mt-0.5">{traceQuery.data.entity.subtitle}</div>
                                                    )}
                                                </div>
                                                
                                                {traceQuery.data.summary && (
                                                    <div className="grid grid-cols-2 gap-2 text-xs">
                                                        {Object.entries(traceQuery.data.summary).slice(0, 4).map(([k, v]) => (
                                                            <div key={k} className="bg-white rounded-lg p-2 border border-slate-200">
                                                                <div className="text-slate-500 capitalize">{k.replace(/_/g, " ")}</div>
                                                                <div className="font-bold text-slate-900 mt-1">{String(v ?? "-")}</div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                                
                                                <div className="space-y-2 mt-4 pt-4 border-t border-slate-200">
                                                    <div className="text-xs font-bold text-slate-900 mb-2">Attached Trace Proof</div>
                                                    {(traceQuery.data.timeline || []).slice(0, 5).map((item: any, i: number) => (
                                                        <div key={i} className="flex gap-3 text-xs">
                                                            <div className="w-2 h-2 rounded-full bg-indigo-500 mt-1 shrink-0"/>
                                                            <div>
                                                                <div className="font-bold text-slate-700">{item.label || item.event_type}</div>
                                                                <div className="text-slate-500">{item.description || item.reference}</div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="text-sm text-slate-500">No trace record found.</div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-slate-500 text-sm">
                                        Enter 2+ characters to scan full database vectors.
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </PremiumPageShell>
    );
}
