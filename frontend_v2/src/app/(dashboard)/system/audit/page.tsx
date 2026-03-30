"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  FileSearch,
  Loader2,
  LogIn,
  ScanSearch,
  ShieldCheck,
  Waypoints,
} from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { PremiumHero, PremiumMetricCard, PremiumMetricStrip, PremiumPageShell, PremiumSection } from "@/components/ui-custom/premium-page-shell";
import { analyticsApi } from "@/services/analytics";
import { NotificationService } from "@/services/notifications";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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

const LOG_FILTERS = [
  { value: "all", label: "All proof" },
  { value: "users", label: "Login & user" },
  { value: "system", label: "System audit" },
  { value: "dispatch", label: "Dispatch" },
  { value: "reports", label: "Reports" },
];

function formatStamp(value?: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function toneForStatus(status?: string) {
  const normalized = String(status || "").toUpperCase();
  if (normalized === "SUCCEEDED") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (normalized === "SKIPPED_EMAIL") return "border-sky-200 bg-sky-50 text-sky-700";
  if (normalized === "FAILED") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-slate-200 bg-slate-100 text-slate-600";
}

function toneForAuditAction(action?: string) {
  const normalized = String(action || "").toUpperCase();
  if (normalized.includes("LOGIN")) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (normalized === "DENIED") return "border-amber-200 bg-amber-50 text-amber-700";
  if (normalized.includes("ROLE")) return "border-indigo-200 bg-indigo-50 text-indigo-700";
  return "border-slate-200 bg-slate-100 text-slate-600";
}

export default function AuditCenterPage() {
  const { effectiveRole, user } = useAuth();
  const roleCode = String(effectiveRole || user?.role_info?.code || "").toUpperCase();
  const canAccess = ["ADMIN", "OWNER", "SUPER_ADMIN"].includes(roleCode);

  const [query, setQuery] = useState("");
  const [logType, setLogType] = useState("all");
  const deferredQuery = useDeferredValue(query.trim());

  const logsQuery = useQuery({
    queryKey: ["audit-operational-logs", logType],
    queryFn: () => analyticsApi.getOperationalLogs({ type: logType, limit: 60 }),
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
    queryFn: () => analyticsApi.getReportRuns(16, 30),
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
    () =>
      logs.filter((row) => {
        const eventType = String(row.event_type || "").toUpperCase();
        return eventType === "USER_LOGIN" || eventType === "USER_LOGOUT";
      }),
    [logs],
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
                <ScanSearch className="mr-2 h-4 w-4" />
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
        description="Search one reference and follow proof across login activity, role overrides, order flow, dispatch evidence, genealogy, and report generation from a single admin surface."
        className="border-slate-200 bg-[linear-gradient(135deg,#ffffff_0%,#eef5ff_42%,#dbeafe_100%)] text-slate-950 shadow-[0_34px_88px_-54px_rgba(15,23,42,0.22)]"
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

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_420px]">
        <PremiumSection
          title="Guided search"
          description="Search any quotation, sales order, stock order, job, challan, or roll label and jump into the correct proof chain."
        >
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
                <div className="space-y-2">
                  <Label>Reference search</Label>
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="SO02938, QT00167, STK-..., PBK-..., DC..., roll label..."
                  />
                </div>
                <Card className="rounded-[1.5rem] border-slate-200 bg-slate-50/80 shadow-none">
                  <CardContent className="flex h-full items-center gap-3 p-4 text-sm text-slate-600">
                    <FileSearch className="h-5 w-5 text-indigo-600" />
                    Search stays inside the current audit and trace endpoints.
                  </CardContent>
                </Card>
              </div>

              <div className="rounded-[1.6rem] border border-slate-200 bg-slate-50/70 p-4">
                {deferredQuery.length <= 1 ? (
                  <div className="text-sm text-slate-500">Enter at least 2 characters to load trace proof.</div>
                ) : traceQuery.isLoading ? (
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Searching cross-module trace...
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
                        <div className="mt-2 text-2xl font-black text-slate-950">
                          {traceQuery.data.entity.reference}
                        </div>
                        <div className="mt-1 text-sm text-slate-600">
                          {traceQuery.data.entity.subtitle || traceQuery.data.entity.title}
                        </div>
                      </div>
                      {traceQuery.data.entity.status ? (
                        <Badge className="rounded-full border border-slate-200 bg-white text-slate-700">
                          {traceQuery.data.entity.status}
                        </Badge>
                      ) : null}
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Matched by</div>
                        <div className="mt-2 text-sm font-bold text-slate-900">
                          {traceQuery.data.matched_by?.replaceAll("_", " ") || "Reference"}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Timeline events</div>
                        <div className="mt-2 text-sm font-bold text-slate-900">{traceQuery.data.timeline?.length || 0}</div>
                      </div>
                    </div>

                    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Summary</div>
                        <div className="mt-3 space-y-2 text-sm text-slate-700">
                          {Object.entries(traceQuery.data.summary || {}).slice(0, 6).map(([key, value]) => (
                            <div key={key} className="flex items-start justify-between gap-4">
                              <span className="font-semibold text-slate-500">{key.replaceAll("_", " ")}</span>
                              <span className="text-right font-semibold text-slate-900">{String(value ?? "—")}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Related proof</div>
                        <div className="mt-3 space-y-2 text-sm">
                          {(traceQuery.data.related || []).slice(0, 6).map((item, index) => (
                            <Link
                              key={`${item.reference || item.label || index}`}
                              href={String(item.href || "/system/audit")}
                              className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700 transition hover:border-slate-300 hover:bg-white"
                            >
                              <span className="font-semibold">{String(item.label || item.reference || item.type || "Related proof")}</span>
                              <ArrowRight className="h-4 w-4 text-slate-400" />
                            </Link>
                          ))}
                          {!(traceQuery.data.related || []).length ? (
                            <div className="rounded-xl border border-dashed border-slate-200 px-3 py-5 text-center text-slate-500">
                              No linked proof records were returned for this reference.
                            </div>
                          ) : null}
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
              <Card className="rounded-[1.5rem] border-slate-200 bg-white/92">
                <CardContent className="space-y-3 p-5">
                  <div className="flex items-center gap-2 text-slate-900">
                    <LogIn className="h-4 w-4 text-emerald-600" />
                    <div className="text-sm font-black">Login visibility</div>
                  </div>
                  <p className="text-sm leading-6 text-slate-600">
                    Login entries and role changes come from the real operational log feed, not a static audit placeholder.
                  </p>
                </CardContent>
              </Card>
              <Card className="rounded-[1.5rem] border-slate-200 bg-white/92">
                <CardContent className="space-y-3 p-5">
                  <div className="flex items-center gap-2 text-slate-900">
                    <ShieldCheck className="h-4 w-4 text-indigo-600" />
                    <div className="text-sm font-black">Cross-module proof</div>
                  </div>
                  <p className="text-sm leading-6 text-slate-600">
                    Audit stays the enterprise bridge. Genealogy remains in inventory, while dispatch, permissions, reports, and timeline evidence stay here.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </PremiumSection>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
          <PremiumSection
            title="Operational timeline and login activity"
            description="Recent system, dispatch, user, and reporting events with quick jumps into the correct proof route."
            actions={(
              <Select value={logType} onValueChange={setLogType}>
                <SelectTrigger className="w-[180px] bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOG_FILTERS.map((filter) => (
                    <SelectItem key={filter.value} value={filter.value}>
                      {filter.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          >
            <ScrollArea className="h-[calc(100vh-24rem)] min-h-[420px] pr-4">
              <div className="space-y-3">
                {logsQuery.isLoading ? (
                  <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading operational proof...
                  </div>
                ) : null}
                {logs.map((row, index) => (
                  <Link
                    key={`${String(row.event_type || "event")}-${String(row.reference || index)}-${index}`}
                    href={row.href || "/system/audit"}
                    className="block rounded-[1.4rem] border border-slate-200 bg-slate-50/70 p-4 transition hover:border-slate-300 hover:bg-white"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-black text-slate-900">{row.desc || "Audit event"}</div>
                        <div className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">
                          {String(row.type || "proof")} · {String(row.event_type || "event").replaceAll("_", " ")}
                        </div>
                      </div>
                      <Badge className={`rounded-full ${toneForAuditAction(row.event_type)}`}>
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
                {!logsQuery.isLoading && !logs.length ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-500">
                    No operational log rows matched the current filter.
                  </div>
                ) : null}
              </div>
            </ScrollArea>
          </PremiumSection>

          <div className="space-y-6">
            <PremiumSection
              title="Permission and role audit"
              description="Role overrides, denials, and governance changes captured from the admin audit feed."
            >
              <ScrollArea className="h-[calc(50vh-2rem)] min-h-[280px] pr-4">
                <div className="space-y-3">
                  {permissionRows.slice(0, 18).map((row) => (
                    <div key={row.id} className="rounded-[1.35rem] border border-slate-200 bg-slate-50/70 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-black text-slate-900">{String(row.action || "AUDIT").replaceAll("_", " ")}</div>
                          <div className="mt-1 text-xs text-slate-500">
                            {row.method} · {row.path || "Path unavailable"}
                          </div>
                        </div>
                        <Badge className={`rounded-full ${toneForAuditAction(row.action)}`}>{row.effective_role || "—"}</Badge>
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
            </PremiumSection>

            <PremiumSection
              title="Report-run archive proof"
              description="Latest PDF and archive history from the audited daily report pipeline."
            >
              <ScrollArea className="h-[calc(50vh-2rem)] min-h-[280px] pr-4">
                <div className="space-y-3">
                  {reportRuns.slice(0, 12).map((run) => (
                    <div key={run.id} className="rounded-[1.35rem] border border-slate-200 bg-slate-50/70 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-black text-slate-900">{String(run.report_code || "report").replaceAll("_", " ")}</div>
                          <div className="mt-1 text-xs text-slate-500">Report date {run.report_date}</div>
                        </div>
                        <Badge className={`rounded-full ${toneForStatus(run.status)}`}>{run.status}</Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                        <span>{run.recipient_count} recipients</span>
                        {run.sent_at ? <span>{formatStamp(run.sent_at)}</span> : null}
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
            </PremiumSection>
          </div>
        </div>
      </div>
    </PremiumPageShell>
  );
}
