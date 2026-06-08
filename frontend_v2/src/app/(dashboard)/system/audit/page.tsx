"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Box,
  CheckCircle2,
  ChevronDown,
  Clock,
  Copy,
  Database,
  Download,
  FileJson,
  FileSearch,
  FileStack,
  GitBranch,
  Layers,
  ListFilter,
  Loader2,
  Lock,
  LogIn,
  Pause,
  Play,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Table2,
  Waypoints,
  Workflow,
  type LucideIcon,
} from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { PremiumPageShell } from "@/components/ui-custom/premium-page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  analyticsApi,
  type AuditLedgerEvent,
  type TraceLookupPayload,
} from "@/services/analytics";
import { cn } from "@/lib/utils";
import styles from "./audit.module.css";
import { formatDisplayDate, formatDisplayDateTime } from "@/lib/date-format";

type AuditMode =
  | "trace"
  | "production"
  | "inventory"
  | "master_data"
  | "system_config"
  | "permissions"
  | "sessions"
  | "reports";
type ConsoleModeKey =
  | "operations"
  | "production"
  | "inventory"
  | "master_data"
  | "system_config"
  | "permissions"
  | "sessions"
  | "reports";
type ViewMode = "timeline" | "table" | "diff";
type DateRange = "1h" | "today" | "24h" | "7d" | "30d" | "all";
type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

type StreamMeta = {
  id: AuditMode;
  modeKey: ConsoleModeKey;
  label: string;
  short: string;
  color: string;
  chipClass: string;
  icon: LucideIcon;
};

type AuditEvent = {
  id: string;
  source: string;
  sourceId: string;
  stream: AuditMode;
  streamLabel: string;
  color: string;
  action: string;
  actor: string;
  role: string;
  entityType: string;
  reference: string;
  summary: string;
  timestamp: string | null;
  severity: Severity;
  value: string;
  method: string;
  path: string;
  ip: string;
  href: string;
  traceableReference: string;
  traceSupported: boolean;
  raw: Record<string, unknown>;
  details: Record<string, unknown>;
};

const STREAMS: StreamMeta[] = [
  {
    id: "trace",
    modeKey: "operations",
    label: "Operational Flow",
    short: "Trace",
    color: "#3b82f6",
    chipClass: styles.chipBlue,
    icon: Workflow,
  },
  {
    id: "production",
    modeKey: "production",
    label: "Production Runs",
    short: "Produce",
    color: "#10b981",
    chipClass: styles.chipGreen,
    icon: Layers,
  },
  {
    id: "inventory",
    modeKey: "inventory",
    label: "Inventory Movement",
    short: "Move",
    color: "#f59e0b",
    chipClass: styles.chipAmber,
    icon: Box,
  },
  {
    id: "master_data",
    modeKey: "master_data",
    label: "Master Data",
    short: "Edit",
    color: "#60a5fa",
    chipClass: styles.chipPurple,
    icon: Database,
  },
  {
    id: "sessions",
    modeKey: "sessions",
    label: "Session & Login",
    short: "Auth",
    color: "#14b8a6",
    chipClass: styles.chipTeal,
    icon: LogIn,
  },
  {
    id: "permissions",
    modeKey: "permissions",
    label: "Permissions",
    short: "Access",
    color: "#ef4444",
    chipClass: styles.chipRed,
    icon: ShieldCheck,
  },
  {
    id: "reports",
    modeKey: "reports",
    label: "Report Archives",
    short: "Report",
    color: "#ec4899",
    chipClass: styles.chipPink,
    icon: FileStack,
  },
  {
    id: "system_config",
    modeKey: "system_config",
    label: "System Config",
    short: "Config",
    color: "#64748b",
    chipClass: styles.chipSlate,
    icon: Settings,
  },
];

const RANGE_OPTIONS: Array<{ value: DateRange; label: string }> = [
  { value: "1h", label: "Last hour" },
  { value: "today", label: "Today" },
  { value: "24h", label: "Last 24h" },
  { value: "7d", label: "Last 7d" },
  { value: "30d", label: "This month" },
  { value: "all", label: "All audit" },
];

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const ACTION_COLORS = [
  "#2563eb",
  "#10b981",
  "#f59e0b",
  "#60a5fa",
  "#14b8a6",
  "#ef4444",
  "#ec4899",
  "#64748b",
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown, fallback = ""): string {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function parseTimestamp(value: unknown): Date | null {
  const raw = asString(value);
  if (!raw) return null;
  const parsed = new Date(raw.includes("T") ? raw : raw.replace(" ", "T"));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function timestampText(value: string | null, compact = false) {
  const parsed = parseTimestamp(value);
  if (!parsed) return value || "-";
  return compact
    ? parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : formatDisplayDateTime(parsed);
}

function relativeTime(value: string | null) {
  const parsed = parseTimestamp(value);
  if (!parsed) return "time unknown";
  const diff = Date.now() - parsed.getTime();
  const minutes = Math.round(Math.abs(diff) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function auditWindowLabel(value: unknown) {
  const row = asRecord(value);
  const range = asString(row.range, "24h");
  const from = parseTimestamp(row.date_from);
  const to = parseTimestamp(row.date_to);
  if (from && to) return `${range} · ${timestampText(from.toISOString())} to ${timestampText(to.toISOString())}`;
  if (from) return `${range} · from ${timestampText(from.toISOString())}`;
  if (to) return `${range} · until ${timestampText(to.toISOString())}`;
  return `${range} range`;
}

function inferSeverity(
  action: string,
  row: Record<string, unknown>,
  stream: AuditMode,
): Severity {
  const haystack =
    `${action} ${asString(row.status)} ${asString(row.value)} ${asString(row.val)} ${asString(row.desc)} ${asString(row.label)}`.toUpperCase();
  if (
    haystack.includes("DENIED") ||
    haystack.includes("FAILED") ||
    haystack.includes("CRITICAL") ||
    haystack.includes("MISMATCH")
  )
    return "CRITICAL";
  if (
    haystack.includes("ROLE") ||
    haystack.includes("OVERRIDE") ||
    haystack.includes("VOID") ||
    haystack.includes("SCRAP")
  )
    return "HIGH";
  if (
    haystack.includes("WARNING") ||
    haystack.includes("PENDING") ||
    haystack.includes("ADJUST") ||
    stream === "master_data"
  )
    return "MEDIUM";
  return "LOW";
}

function normalizeAction(value: unknown) {
  return asString(value, "EVENT").replaceAll(" ", "_").toUpperCase();
}

function normalizeEvent(
  stream: StreamMeta,
  row: Record<string, unknown>,
  index: number,
): AuditEvent {
  const meta = asRecord(row.meta);
  const details = { ...asRecord(meta.details), ...asRecord(row.details) };
  const action = normalizeAction(
    row.action ?? row.event_type ?? row.status ?? row.type ?? row.report_code,
  );
  const timestamp = asString(
    row.created_at ??
      row.timestamp ??
      row.date ??
      row.sent_at ??
      row.report_date,
    "",
  );
  const actor = asString(
    row.user ?? row.triggered_by ?? row.created_by,
    "system",
  );
  const role = asString(
    row.effective_role ?? meta.effective_role ?? row.role,
    actor === "system" ? "system" : "operator",
  ).toLowerCase();
  const reference = asString(
    row.reference ?? row.entity_id ?? row.report_code ?? row.id,
    "",
  );
  const entityType = asString(
    row.entity_type ??
      row.type ??
      (stream.id === "reports" ? "REPORT_RUN" : stream.label),
    stream.label,
  ).replaceAll("_", " ");
  const value = asString(
    row.value ??
      row.val ??
      row.status ??
      row.required_permission ??
      row.report_code,
    "LOGGED",
  );
  const reportSummary = row.report_code
    ? `Report ${asString(row.report_code)} ${asString(row.status, "logged").toLowerCase()}`
    : "";
  const summary = asString(
    row.desc ?? row.label ?? row.message ?? reportSummary,
    `${actor} ${action.toLowerCase().replaceAll("_", " ")}`,
  );

  return {
    id: asString(row.id, `${stream.id}-${index}`),
    source: asString(row.source, stream.id),
    sourceId: asString(row.source_id ?? row.entity_id ?? row.id, ""),
    stream: stream.id,
    streamLabel: stream.label,
    color: stream.color,
    action,
    actor,
    role,
    entityType,
    reference,
    summary,
    timestamp: timestamp || null,
    severity: inferSeverity(action, row, stream.id),
    value,
    method: asString(row.method ?? meta.method, ""),
    path: asString(row.path ?? meta.path, ""),
    ip: asString(row.ip ?? details.ip ?? details.client_ip, ""),
    href: asString(row.href, "/system/audit"),
    traceableReference: asString(row.traceable_reference ?? reference, ""),
    traceSupported: Boolean(row.trace_supported ?? reference),
    raw: row,
    details,
  };
}

function normalizeLedgerEvent(row: AuditLedgerEvent): AuditEvent {
  const stream = streamMeta((row.stream as AuditMode) || "trace");
  return {
    id: row.id,
    source: row.source,
    sourceId: row.source_id,
    stream: stream.id,
    streamLabel: row.stream_label || stream.label,
    color: stream.color,
    action: normalizeAction(row.action),
    actor: asString(row.actor, "system"),
    role: asString(row.role, "system").toLowerCase(),
    entityType: asString(row.entity_type, "Audit log").replaceAll("_", " "),
    reference: asString(row.reference, row.source_id),
    summary: asString(row.summary, row.action),
    timestamp: row.timestamp || null,
    severity: (row.severity as Severity) || "LOW",
    value: asString(row.value, "LOGGED"),
    method: asString(row.method, ""),
    path: asString(row.path, ""),
    ip: asString(row.ip, ""),
    href: asString(row.href, "/system/audit"),
    traceableReference: asString(row.traceable_reference, row.reference),
    traceSupported: Boolean(row.trace_supported),
    raw: row as unknown as Record<string, unknown>,
    details: asRecord(row.details),
  };
}

function traceLookupCandidate(value: string) {
  const text = value.trim();
  if (text.length < 2) return "";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) {
    return text;
  }
  if (/^(SO|QT|STK|PBK|JOB|ROLL|FG|DC)[-_A-Z0-9]*/i.test(text)) {
    return text;
  }
  if (/^[A-Z][A-Z0-9]+(_[A-Z0-9]+)+$/.test(text)) {
    return text;
  }
  if (/^permission:[0-9a-f-]{36}$/i.test(text)) {
    return text;
  }
  return "";
}

function streamMeta(id: AuditMode) {
  return STREAMS.find((item) => item.id === id) || STREAMS[0];
}

function severityClass(severity: Severity) {
  if (severity === "CRITICAL") return styles.sevCritical;
  if (severity === "HIGH") return styles.sevHigh;
  if (severity === "MEDIUM") return styles.sevMedium;
  return styles.sevLow;
}

function cssVar(style: Record<string, string>): CSSProperties {
  return style as CSSProperties;
}

function initials(name: string) {
  const clean = name.replace(/[^a-z0-9 _.-]/gi, " ").trim();
  if (!clean) return "SY";
  return clean
    .split(/[.\s_-]+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
}

function dateBucket(value: string | null) {
  const parsed = parseTimestamp(value);
  if (!parsed) return "Undated";
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (parsed.toDateString() === today.toDateString()) return "Today";
  if (parsed.toDateString() === yesterday.toDateString()) return "Yesterday";
  return formatDisplayDate(parsed);
}

function csvEscape(value: unknown) {
  return `"${asString(value).replaceAll('"', '""')}"`;
}

export default function AuditCenterPage() {
  const { effectiveRole, user } = useAuth();
  const roleCode = String(
    effectiveRole || user?.role_info?.code || "",
  ).toUpperCase();
  const canAccess = ["ADMIN", "OWNER", "SUPER_ADMIN"].includes(roleCode);
  const router = useRouter();
  const pathname = usePathname() || "/system/audit";
  const searchParams = useSearchParams();

  const [query, setQuery] = useState(() => searchParams?.get("q") || "");
  const [activeStream, setActiveStream] = useState<AuditMode | "all">(
    () => (searchParams?.get("stream") as AuditMode | "all") || "all",
  );
  const [range, setRange] = useState<DateRange>(
    () => (searchParams?.get("range") as DateRange) || "24h",
  );
  const [actor, setActor] = useState(() => searchParams?.get("actor") || "ALL");
  const [severity, setSeverity] = useState<Severity | "ALL">(
    () => (searchParams?.get("severity") as Severity | "ALL") || "ALL",
  );
  const [view, setView] = useState<ViewMode>(
    () => (searchParams?.get("view") as ViewMode) || "timeline",
  );
  const [page, setPage] = useState(() =>
    Math.max(1, Number(searchParams?.get("page") || 1) || 1),
  );
  const [liveTail, setLiveTail] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);
  const deferredQuery = useDeferredValue(query.trim());
  const ledgerLimit = 100;

  useEffect(() => {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (activeStream !== "all") params.set("stream", activeStream);
    if (range !== "24h") params.set("range", range);
    if (actor !== "ALL") params.set("actor", actor);
    if (severity !== "ALL") params.set("severity", severity);
    if (view !== "timeline") params.set("view", view);
    if (page > 1) params.set("page", String(page));
    const next = params.toString();
    router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
  }, [activeStream, actor, page, pathname, query, range, router, severity, view]);

  useEffect(() => {
    setPage(1);
    setSelectedEvent(null);
  }, [activeStream, actor, deferredQuery, range, severity]);

  useEffect(() => {
    setSelectedEvent(null);
  }, [page]);

  const auditLedgerQuery = useQuery({
    queryKey: [
      "audit-ledger",
      deferredQuery,
      activeStream,
      range,
      actor,
      severity,
      page,
      ledgerLimit,
    ],
    queryFn: () =>
      analyticsApi.getAuditLedger({
        q: deferredQuery,
        stream: activeStream,
        range,
        actor,
        severity,
        page,
        limit: ledgerLimit,
      }),
    enabled: canAccess,
    staleTime: 30_000,
    refetchInterval: liveTail ? 15_000 : false,
  });

  const ledgerEvents = auditLedgerQuery.data?.events || [];
  const ledgerSummary = auditLedgerQuery.data?.summary;
  const traceTarget = selectedEvent?.traceableReference || traceLookupCandidate(deferredQuery);

  const traceQuery = useQuery({
    queryKey: ["audit-trace-lookup", traceTarget],
    queryFn: () => analyticsApi.traceLookup(traceTarget),
    enabled: canAccess && traceTarget.length > 1,
    retry: false,
    staleTime: 30_000,
  });

  const events = useMemo(() => {
    return ledgerEvents.map(normalizeLedgerEvent).sort(
      (left, right) =>
        (parseTimestamp(right.timestamp)?.getTime() || 0) -
        (parseTimestamp(left.timestamp)?.getTime() || 0),
    );
  }, [ledgerEvents]);

  const actorOptions = useMemo(
    () =>
      Array.isArray(ledgerSummary?.actors)
        ? ledgerSummary.actors.map((item) => item.actor).filter(Boolean)
        : [],
    [ledgerSummary?.actors],
  );

  const visibleEvents = events;

  const focusEvent = selectedEvent || visibleEvents[0] || null;
  const traceLookupError = Boolean(traceQuery.data?.error);
  const computedPageCount = Math.max(
    1,
    Math.ceil(Number(ledgerSummary?.filtered_count || 0) / ledgerLimit),
  );
  const pageCount = Math.max(1, Number(ledgerSummary?.page_count || computedPageCount));
  const hasNextPage = Boolean(ledgerSummary?.has_more ?? page < pageCount);
  const sourceWindow = auditWindowLabel(ledgerSummary?.source_window);
  const severityCounts = useMemo(
    () =>
      ({
        LOW: Number(ledgerSummary?.counts_by_severity?.LOW || 0),
        MEDIUM: Number(ledgerSummary?.counts_by_severity?.MEDIUM || 0),
        HIGH: Number(ledgerSummary?.counts_by_severity?.HIGH || 0),
        CRITICAL: Number(ledgerSummary?.counts_by_severity?.CRITICAL || 0),
      }),
    [ledgerSummary?.counts_by_severity],
  );

  const actorStats = useMemo(() => {
    const actors = Array.isArray(ledgerSummary?.actors)
      ? ledgerSummary.actors
      : [];
    return actors.slice(0, 7).map((item) => ({
      actor: item.actor,
      role: "audit",
      count: Number(item.count || 0),
    }));
  }, [ledgerSummary?.actors]);

  const actionStats = useMemo(() => {
    const map = new Map<string, number>();
    visibleEvents.forEach((event) =>
      map.set(event.action, (map.get(event.action) || 0) + 1),
    );
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 7)
      .map(([action, count], index) => ({
        action,
        count,
        color: ACTION_COLORS[index % ACTION_COLORS.length],
      }));
  }, [visibleEvents]);

  const grouped = useMemo(
    () =>
      visibleEvents.reduce<Array<{ label: string; rows: AuditEvent[] }>>(
        (acc, event) => {
          const label = dateBucket(event.timestamp);
          const existing = acc.find((item) => item.label === label);
          if (existing) existing.rows.push(event);
          else acc.push({ label, rows: [event] });
          return acc;
        },
        [],
      ),
    [visibleEvents],
  );

  const exportCsv = () => {
    const header = [
      "timestamp",
      "stream",
      "severity",
      "action",
      "actor",
      "role",
      "entity",
      "reference",
      "summary",
      "method",
      "path",
      "ip",
    ];
    const lines = [header.join(",")].concat(
      visibleEvents.map((event) =>
        [
          event.timestamp,
          event.streamLabel,
          event.severity,
          event.action,
          event.actor,
          event.role,
          event.entityType,
          event.reference,
          event.summary,
          event.method,
          event.path,
          event.ip,
        ]
          .map(csvEscape)
          .join(","),
      ),
    );
    const blob = new Blob([lines.join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `audit-events-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (!canAccess) {
    return (
      <div className="max-w-2xl space-y-6">
        <section className="rounded-[28px] border border-warning-border bg-warning-bg p-8 shadow-sm">
          <Badge className="rounded-full border border-warning-border bg-surface-1 text-[11px] font-black uppercase tracking-[0.26em] text-warning-fg">
            Audit Access
          </Badge>
          <h1 className="mt-4 text-3xl font-black tracking-tight text-content-1">
            Audit Center
          </h1>
          <p className="mt-3 text-sm font-semibold leading-6 text-content-2">
            Audit Center is limited to owner and admin roles. Use Roll
            Genealogy, inventory history, and route-specific timelines instead
            of the enterprise audit console.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/inventory/traceability">
              <Button className="rounded-2xl bg-surface-3 text-white hover:bg-line">
                <Waypoints className="mr-2 h-4 w-4" />
                Open Roll Genealogy
              </Button>
            </Link>
          </div>
        </section>
      </div>
    );
  }

  const lastSynced = auditLedgerQuery.data?.generated_at
    ? relativeTime(auditLedgerQuery.data.generated_at)
    : "loading";
  const totalEvents = Number(ledgerSummary?.filtered_count || 0);

  return (
    <PremiumPageShell dataTestId="audit-center-page">
      <div className={styles.auditContainer}>
        <section className={styles.heroCard}>
          <div className={styles.heroChrome} />
          <div className={styles.heroContent}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-black uppercase tracking-[0.24em] text-white/60">
                    System · Audit
                  </span>
                  <span className={cn(styles.chip, styles.chipLive)}>
                    <span
                      className={liveTail ? styles.liveDot : styles.pauseDot}
                    />
                    {liveTail ? "Live" : "Paused"}
                  </span>
                  <span className={cn(styles.chip, styles.chipDark)}>
                    <Lock className="h-3 w-3" />
                    Tamper-aware business evidence
                  </span>
                </div>
                <h1 className="text-4xl font-black tracking-tight text-white">
                  Audit Center
                </h1>
                <p className="mt-2 max-w-3xl text-sm font-medium leading-6 text-white/72">
                  Search the live audit ledger by action, user, reference,
                  route, material, permission, or backend evidence text. Open a
                  row to inspect captured payloads without losing the search.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  onClick={exportCsv}
                  className={styles.heroButton}
                >
                  <Download className="h-3.5 w-3.5" />
                  Export CSV
                </Button>
                <Button asChild className={styles.heroButton}>
                  <Link href="/system/report-center">
                    <FileStack className="h-3.5 w-3.5" />
                    Reports
                  </Link>
                </Button>
              </div>
            </div>
            <div className={styles.metricStrip}>
              <HeroMetric
                label="Events Found"
                value={totalEvents.toLocaleString()}
                sub={`${visibleEvents.length.toLocaleString()} shown on page ${page}`}
              />
              <HeroMetric
                label="Actors In Scope"
                value={actorStats.length.toLocaleString()}
                sub="Users, services, system jobs"
              />
              <HeroMetric
                label="High Signals"
                value={(
                  severityCounts.HIGH + severityCounts.CRITICAL
                ).toLocaleString()}
                sub="Permission, mismatch, failure, override"
                alert={severityCounts.CRITICAL > 0}
              />
              <HeroMetric
                label="Streams Connected"
                value={String(STREAMS.length)}
                sub="All current audit endpoints"
              />
              <HeroMetric
                label="Freshness"
                value={auditLedgerQuery.isFetching ? "Syncing" : "Green"}
                sub={`Last response ${lastSynced}`}
                success={!auditLedgerQuery.isFetching}
              />
            </div>
          </div>
        </section>

        <section className={styles.commandBar}>
          <div className={styles.guidedLine}>
            <span className={styles.eyebrow}>Guided search</span>
            <span>
              Backend-backed ledger search. Row clicks inspect evidence; Trace
              resolves supported references and audit actions.
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[300px] flex-1">
              <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-primary" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="SO04282, ROLL-..., JOB-..., report code, user, route, permission..."
                className={styles.traceInput}
                data-testid="audit-trace-search"
              />
              <span
                className={cn(
                  styles.traceBadge,
                  traceQuery.data?.entity && styles.traceBadgeOk,
                )}
              >
                {traceQuery.isLoading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : traceQuery.data?.entity ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : traceLookupError ? (
                  <AlertTriangle className="h-3 w-3" />
                ) : (
                  <FileSearch className="h-3 w-3" />
                )}
                {traceQuery.data?.entity ? "Trace ready" : "Trace"}
              </span>
            </div>
            <FilterPill
              label="Stream"
              value={activeStream}
              onChange={(value) => setActiveStream(value as AuditMode | "all")}
              options={[
                { value: "all", label: "All streams" },
                ...STREAMS.map((stream) => ({
                  value: stream.id,
                  label: stream.label,
                })),
              ]}
            />
            <FilterPill
              label="Range"
              value={range}
              onChange={(value) => setRange(value as DateRange)}
              options={RANGE_OPTIONS}
            />
            <FilterPill
              label="Actor"
              value={actor}
              onChange={setActor}
              options={[
                { value: "ALL", label: "All actors" },
                ...actorOptions.map((item) => ({ value: item, label: item })),
              ]}
            />
            <FilterPill
              label="Severity"
              value={severity}
              onChange={(value) => setSeverity(value as Severity | "ALL")}
              options={[
                { value: "ALL", label: "All severity" },
                ...(["LOW", "MEDIUM", "HIGH", "CRITICAL"] as Severity[]).map(
                  (item) => ({ value: item, label: item }),
                ),
              ]}
            />
            <Button
              type="button"
              onClick={() => setLiveTail((current) => !current)}
              className={cn(
                styles.pillButton,
                liveTail && styles.pillButtonActive,
              )}
            >
              {liveTail ? (
                <Play className="h-3.5 w-3.5" />
              ) : (
                <Pause className="h-3.5 w-3.5" />
              )}
              15s tail
            </Button>
            <Button
              type="button"
              onClick={() => {
                setQuery("");
                setActiveStream("all");
                setRange("24h");
                setActor("ALL");
                setSeverity("ALL");
                setView("timeline");
                setPage(1);
                setSelectedEvent(null);
              }}
              className={styles.pillButton}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Reset
            </Button>
          </div>
        </section>

        <section className={styles.lanesGrid}>
          {STREAMS.map((stream) => {
            const streamRows = events.filter(
              (event) => event.stream === stream.id,
            );
            const streamCount = Number(
              ledgerSummary?.counts_by_stream?.[stream.id] || 0,
            );
            const active = activeStream === "all" || activeStream === stream.id;
            const Icon = stream.icon;
            return (
              <button
                key={stream.id}
                type="button"
                className={cn(styles.streamCard, active && styles.streamActive)}
                style={cssVar({ "--stream-color": stream.color })}
                onClick={() =>
                  setActiveStream(
                    activeStream === stream.id ? "all" : stream.id,
                  )
                }
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className={styles.eyebrow}>{stream.label}</div>
                    <div className="mt-1 text-2xl font-black text-content-1">
                      {streamCount.toLocaleString()}
                    </div>
                    <div className="mt-1 text-[11px] font-semibold text-content-3">
                      {streamRows[0]
                        ? `${relativeTime(streamRows[0].timestamp)} · ${streamRows[0].actor}`
                        : streamCount
                          ? "Use this stream to load matching rows"
                          : "No events in current filters"}
                    </div>
                  </div>
                  <span className={cn(styles.chip, stream.chipClass)}>
                    <Icon className="h-3 w-3" />
                    {stream.short}
                  </span>
                </div>
                <Sparkline events={streamRows} color={stream.color} />
              </button>
            );
          })}
        </section>

        <section className={styles.visualGrid}>
          <ActivityHeatmap events={visibleEvents} />
          <ActorBoard actors={actorStats} onActor={setActor} />
          <ActionMix
            actions={actionStats}
            total={visibleEvents.length}
            onAction={(action) => setQuery(action)}
          />
          <SignalPanel
            counts={severityCounts}
            onSeverity={(next) => setSeverity(next)}
          />
        </section>

        <section className={styles.workspaceGrid}>
          <div className={styles.consolePanel}>
            <div className={styles.consoleTabs}>
              <ConsoleTab
                icon={Clock}
                label="Timeline"
                value="timeline"
                active={view === "timeline"}
                onClick={setView}
                count={visibleEvents.length}
              />
              <ConsoleTab
                icon={Table2}
                label="Table"
                value="table"
                active={view === "table"}
                onClick={setView}
              />
              <ConsoleTab
                icon={FileJson}
                label="Diff / Raw"
                value="diff"
                active={view === "diff"}
                onClick={setView}
              />
              <div className="flex-1" />
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-black uppercase tracking-[0.12em] text-content-3">
                <span>
                  Page {page.toLocaleString()} of {pageCount.toLocaleString()}
                </span>
                {sourceWindow ? (
                  <span className={cn(styles.chip, styles.chipSlate)}>
                    {sourceWindow}
                  </span>
                ) : null}
              </div>
              <Button
                type="button"
                disabled={page <= 1 || auditLedgerQuery.isFetching}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                className={styles.pillButton}
              >
                Prev
              </Button>
              <Button
                type="button"
                disabled={!hasNextPage || auditLedgerQuery.isFetching}
                onClick={() => setPage((current) => current + 1)}
                className={styles.pillButton}
              >
                Next
              </Button>
              <span className={cn(styles.chip, styles.chipSlate)}>
                Newest first
              </span>
            </div>
            {view === "timeline" ? (
              <TimelineView
                groups={grouped}
                onOpen={(event) => {
                  setSelectedEvent(event);
                  setView("diff");
                }}
              />
            ) : null}
            {view === "table" ? (
              <TableView
                events={visibleEvents}
                onOpen={(event) => {
                  setSelectedEvent(event);
                  setView("diff");
                }}
              />
            ) : null}
            {view === "diff" ? <DiffView event={focusEvent} /> : null}
          </div>

          <InvestigationPanel
            event={focusEvent}
            trace={traceQuery.data?.entity ? traceQuery.data : null}
            traceLoading={traceQuery.isLoading}
            traceError={traceLookupError}
            query={traceTarget || deferredQuery}
            onTrace={(reference) => setQuery(reference)}
          />
        </section>
      </div>
    </PremiumPageShell>
  );
}

function HeroMetric({
  label,
  value,
  sub,
  alert = false,
  success = false,
}: {
  label: string;
  value: string;
  sub: string;
  alert?: boolean;
  success?: boolean;
}) {
  return (
    <div className={styles.metricCard}>
      <div className={styles.metricLabel}>{label}</div>
      <div
        className={cn(
          styles.metricValue,
          alert && "text-danger-border",
          success && "text-success-border",
        )}
      >
        {value}
      </div>
      <div className={styles.metricSub}>{sub}</div>
    </div>
  );
}

function FilterPill({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label
      className={cn(
        styles.filterPill,
        value !== "ALL" && value !== "all" && styles.filterPillActive,
      )}
    >
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={styles.filterSelect}
        aria-label={label}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown className="h-3.5 w-3.5 opacity-70" />
    </label>
  );
}

function Sparkline({ events, color }: { events: AuditEvent[]; color: string }) {
  const points = useMemo(() => {
    const buckets = Array.from({ length: 12 }, () => 0);
    const now = Date.now();
    events.forEach((event) => {
      const parsed = parseTimestamp(event.timestamp);
      if (!parsed) return;
      const diffHours = Math.floor((now - parsed.getTime()) / 3_600_000);
      if (diffHours >= 0 && diffHours < 12) buckets[11 - diffHours] += 1;
    });
    const max = Math.max(...buckets, 1);
    return buckets
      .map((count, index) => `${index * (120 / 11)},${22 - (count / max) * 18}`)
      .join(" ");
  }, [events]);
  return (
    <svg
      viewBox="0 0 120 24"
      className="mt-4 h-7 w-full"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ActivityHeatmap({ events }: { events: AuditEvent[] }) {
  const heat = useMemo(() => {
    const grid = Array.from({ length: 7 }, () =>
      Array.from({ length: 24 }, () => 0),
    );
    events.forEach((event) => {
      const parsed = parseTimestamp(event.timestamp);
      if (!parsed) return;
      const day = (parsed.getDay() + 6) % 7;
      grid[day][parsed.getHours()] += 1;
    });
    return { grid, max: Math.max(...grid.flat(), 1) };
  }, [events]);
  const colorFor = (value: number) => {
    if (!value) return "#eef2ff";
    const ratio = value / heat.max;
    if (ratio >= 0.75) return "#0b1f55";
    if (ratio >= 0.5) return "#2563eb";
    if (ratio >= 0.25) return "#818cf8";
    return "#c7d2fe";
  };
  return (
    <div className={cn(styles.card, styles.heatmapCard)}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className={styles.eyebrow}>Activity heatmap</div>
          <div className="mt-1 text-sm font-black text-content-1">
            7 day x 24 hour audit density
          </div>
        </div>
        <span className={cn(styles.chip, styles.chipBlue)}>
          <Activity className="h-3 w-3" />
          {events.length.toLocaleString()} events
        </span>
      </div>
      <div className="flex gap-1.5">
        <div className="grid gap-1 pt-5 text-[10px] font-bold text-content-3">
          {DAY_LABELS.map((day) => (
            <span key={day} className="h-3.5">
              {day}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className={styles.hourGrid}>
            {Array.from({ length: 24 }, (_, hour) => (
              <span key={hour}>
                {hour % 4 === 0 ? String(hour).padStart(2, "0") : ""}
              </span>
            ))}
          </div>
          <div className={styles.heatGrid}>
            {heat.grid.flatMap((row, day) =>
              row.map((value, hour) => (
                <span
                  key={`${day}-${hour}`}
                  className={styles.heatCell}
                  style={{ background: colorFor(value) }}
                  title={`${DAY_LABELS[day]} ${hour}:00 · ${value} events`}
                />
              )),
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ActorBoard({
  actors,
  onActor,
}: {
  actors: Array<{ actor: string; role: string; count: number }>;
  onActor: (actor: string) => void;
}) {
  const max = Math.max(...actors.map((item) => item.count), 1);
  return (
    <div className={cn(styles.card, styles.actorCard)}>
      <div className={styles.eyebrow}>Actor leaderboard</div>
      <div className="mb-3 mt-1 text-sm font-black text-content-1">
        Who changed the system
      </div>
      <div className="space-y-2">
        {actors.map((item, index) => (
          <button
            key={item.actor}
            type="button"
            className={styles.actorRow}
            onClick={() => onActor(item.actor)}
          >
            <span
              className={cn(
                styles.avatar,
                styles[`avatar${(index % 6) + 1}` as keyof typeof styles],
              )}
            >
              {initials(item.actor)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-black text-content-1">
                {item.actor}
              </span>
              <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-surface-2">
                <span
                  className="block h-full rounded-full bg-primary"
                  style={{ width: `${Math.max(8, (item.count / max) * 100)}%` }}
                />
              </span>
            </span>
            <span className={cn(styles.chip, styles.chipSlate)}>
              {item.count}
            </span>
          </button>
        ))}
        {!actors.length ? (
          <EmptyTiny label="No actor activity in current filters." />
        ) : null}
      </div>
    </div>
  );
}

function ActionMix({
  actions,
  total,
  onAction,
}: {
  actions: Array<{ action: string; count: number; color: string }>;
  total: number;
  onAction: (action: string) => void;
}) {
  return (
    <div className={cn(styles.card, styles.actionCard)}>
      <div className={styles.eyebrow}>Action mix</div>
      <div className="mb-3 mt-1 text-sm font-black text-content-1">
        Top actions
      </div>
      <div className="space-y-2">
        {actions.map((item) => (
          <button
            key={item.action}
            type="button"
            onClick={() => onAction(item.action)}
            className={styles.actionRow}
          >
            <span
              className="h-2.5 w-2.5 rounded-sm"
              style={{ background: item.color }}
            />
            <span className="min-w-0 flex-1 truncate">
              {item.action.replaceAll("_", " ")}
            </span>
            <span className="font-black">
              {total ? Math.round((item.count / total) * 100) : 0}%
            </span>
          </button>
        ))}
        {!actions.length ? (
          <EmptyTiny label="No action mix in current filters." />
        ) : null}
      </div>
    </div>
  );
}

function SignalPanel({
  counts,
  onSeverity,
}: {
  counts: Record<Severity, number>;
  onSeverity: (severity: Severity) => void;
}) {
  const total =
    Object.values(counts).reduce((sum, value) => sum + value, 0) || 1;
  return (
    <div className={cn(styles.card, styles.signalCard)}>
      <div className={styles.eyebrow}>Signal health</div>
      <div className="mb-3 mt-1 text-sm font-black text-content-1">
        Severity spread
      </div>
      <div className={styles.severityBar}>
        {(["LOW", "MEDIUM", "HIGH", "CRITICAL"] as Severity[]).map((item) => (
          <button
            key={item}
            type="button"
            className={styles[`bar${item}` as keyof typeof styles]}
            style={{ width: `${Math.max(8, (counts[item] / total) * 100)}%` }}
            onClick={() => onSeverity(item)}
          >
            {counts[item]}
          </button>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {(["LOW", "MEDIUM", "HIGH", "CRITICAL"] as Severity[]).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onSeverity(item)}
            className={cn(styles.chip, severityClass(item), "justify-center")}
          >
            {item}: {counts[item]}
          </button>
        ))}
      </div>
    </div>
  );
}

function ConsoleTab({
  icon: Icon,
  label,
  value,
  active,
  onClick,
  count,
}: {
  icon: LucideIcon;
  label: string;
  value: ViewMode;
  active: boolean;
  onClick: (value: ViewMode) => void;
  count?: number;
}) {
  return (
    <button
      type="button"
      className={cn(styles.tabButton, active && styles.tabButtonActive)}
      onClick={() => onClick(value)}
    >
      <Icon className="h-4 w-4" />
      {label}
      {typeof count === "number" ? (
        <span className="text-[10px] opacity-70">{count.toLocaleString()}</span>
      ) : null}
    </button>
  );
}

function TimelineView({
  groups,
  onOpen,
}: {
  groups: Array<{ label: string; rows: AuditEvent[] }>;
  onOpen: (event: AuditEvent) => void;
}) {
  if (!groups.length)
    return <EmptyConsole label="No audit events match the current filters." />;
  return (
    <ScrollArea className="max-h-[780px]">
      <div className="space-y-6 p-5">
        {groups.map((group) => (
          <div key={group.label}>
            <div className={styles.groupHeader}>
              <span>{group.label}</span>
              <span className={cn(styles.chip, styles.chipSlate)}>
                {group.rows.length} events
              </span>
              <span />
            </div>
            <div className={styles.timelineRail}>
              {group.rows.slice(0, 140).map((event) => {
                const stream = streamMeta(event.stream);
                return (
                  <button
                    key={event.id}
                    type="button"
                    className={styles.eventCard}
                    style={{ borderLeftColor: event.color }}
                    onClick={() => onOpen(event)}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn(styles.chip, stream.chipClass)}>
                        {stream.short}
                      </span>
                      <span
                        className={cn(
                          styles.chip,
                          severityClass(event.severity),
                        )}
                      >
                        {event.severity}
                      </span>
                      <span className="font-mono text-[11px] text-content-3">
                        {timestampText(event.timestamp, true)}
                      </span>
                    </div>
                    <div className="mt-2 text-left text-sm font-bold text-content-1">
                      {event.summary}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-3 text-left text-[11px] font-medium text-content-3">
                      <span>
                        {event.actor} · {event.role}
                      </span>
                      {event.reference ? (
                        <span>Ref {event.reference}</span>
                      ) : null}
                      {event.path ? (
                        <span>
                          {event.method || "GET"} {event.path}
                        </span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

function TableView({
  events,
  onOpen,
}: {
  events: AuditEvent[];
  onOpen: (event: AuditEvent) => void;
}) {
  if (!events.length)
    return <EmptyConsole label="No table rows match the current filters." />;
  return (
    <div className="max-h-[780px] overflow-auto">
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Time</th>
            <th>Stream</th>
            <th>Action</th>
            <th>Actor</th>
            <th>Entity</th>
            <th>Summary</th>
            <th>Signal</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {events.slice(0, 320).map((event) => {
            const stream = streamMeta(event.stream);
            return (
              <tr key={event.id} onClick={() => onOpen(event)}>
                <td className="font-mono text-[11px]">
                  {timestampText(event.timestamp)}
                </td>
                <td>
                  <span className={cn(styles.chip, stream.chipClass)}>
                    {stream.short}
                  </span>
                </td>
                <td className="font-bold">
                  {event.action.replaceAll("_", " ")}
                </td>
                <td>{event.actor}</td>
                <td>{event.reference || event.entityType}</td>
                <td className="max-w-[28rem] truncate">{event.summary}</td>
                <td>
                  <span
                    className={cn(styles.chip, severityClass(event.severity))}
                  >
                    {event.severity}
                  </span>
                </td>
                <td>
                  <ArrowRight className="h-4 w-4 text-content-4" />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DiffView({ event }: { event: AuditEvent | null }) {
  const before = asRecord(
    event?.details.before ?? event?.details.before_json ?? event?.raw.before,
  );
  const after = asRecord(
    event?.details.after ?? event?.details.after_json ?? event?.raw.after,
  );
  const hasDiff =
    Object.keys(before).length > 0 || Object.keys(after).length > 0;
  const left = hasDiff ? before : asRecord(event?.details);
  const right = hasDiff ? after : asRecord(event?.raw);
  const keys = Array.from(
    new Set([...Object.keys(left), ...Object.keys(right)]),
  ).slice(0, 24);
  return (
    <div className="p-5">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className={cn(styles.chip, styles.chipPurple)}>
          {event?.action || "Select event"}
        </span>
        <span className="text-sm font-black text-content-1">
          {event?.reference || event?.entityType || "No event selected"}
        </span>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <DiffPane
          title={hasDiff ? "Before" : "Captured details"}
          rows={left}
          keys={keys}
          side="before"
          hasDiff={hasDiff}
        />
        <DiffPane
          title={hasDiff ? "After" : "Raw audit payload"}
          rows={right}
          keys={keys}
          side="after"
          hasDiff={hasDiff}
        />
      </div>
    </div>
  );
}

function DiffPane({
  title,
  rows,
  keys,
  side,
  hasDiff,
}: {
  title: string;
  rows: Record<string, unknown>;
  keys: string[];
  side: "before" | "after";
  hasDiff: boolean;
}) {
  return (
    <div>
      <div className={styles.eyebrow}>{title}</div>
      <pre className={styles.diffBox}>
        {`{
${
  keys.length
    ? keys
        .map((key) => {
          const marker = hasDiff ? (side === "before" ? "-" : "+") : " ";
          return `${marker} "${key}": ${JSON.stringify(rows[key] ?? null)}`;
        })
        .join("\n")
    : ' "empty": true'
}
}`}
      </pre>
    </div>
  );
}

function InvestigationPanel({
  event,
  trace,
  traceLoading,
  traceError,
  query,
  onTrace,
}: {
  event: AuditEvent | null;
  trace: TraceLookupPayload | null;
  traceLoading: boolean;
  traceError: boolean;
  query: string;
  onTrace: (reference: string) => void;
}) {
  const entity = trace?.entity;
  const summary = asRecord(trace?.summary);
  const timeline = Array.isArray(trace?.timeline) ? trace.timeline : [];
  const related = Array.isArray(trace?.related) ? trace.related : [];
  return (
    <aside className={styles.investigationPanel}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className={styles.eyebrow}>Investigation</div>
          <h2 className="mt-1 text-xl font-black text-content-1">
            {entity?.reference || event?.reference || event?.id || "Live trace"}
          </h2>
          <p className="mt-1 text-xs font-semibold leading-5 text-content-3">
            {entity?.title ||
              event?.summary ||
              "Open a row or search a reference to inspect proof."}
          </p>
        </div>
        <Button
          type="button"
          className={styles.pillButton}
          onClick={() =>
            navigator.clipboard?.writeText(
              entity?.reference || event?.reference || "",
            )
          }
        >
          <Copy className="h-3 w-3" />
          Copy
        </Button>
      </div>

      <div className={styles.traceStatusCard}>
        {traceLoading ? (
          <span>
            <Loader2 className="h-4 w-4 animate-spin" />
            Tracing {query}
          </span>
        ) : trace ? (
          <span>
            <CheckCircle2 className="h-4 w-4" />
            Trace record found
          </span>
        ) : traceError ? (
          <span>
            <AlertTriangle className="h-4 w-4" />
            No trace match returned
          </span>
        ) : (
          <span>
            <FileSearch className="h-4 w-4" />
            Search or open a row
          </span>
        )}
      </div>

      <div className={styles.card}>
        <div className={styles.eyebrow}>Summary</div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          {Object.entries(summary)
            .slice(0, 6)
            .map(([key, value]) => (
              <div key={key} className={styles.summaryCell}>
                <span>{key.replaceAll("_", " ")}</span>
                <b>{asString(value, "-")}</b>
              </div>
            ))}
          {!Object.keys(summary).length && event ? (
            <>
              <div className={styles.summaryCell}>
                <span>Actor</span>
                <b>{event.actor}</b>
              </div>
              <div className={styles.summaryCell}>
                <span>Severity</span>
                <b>{event.severity}</b>
              </div>
              <div className={styles.summaryCell}>
                <span>When</span>
                <b>{timestampText(event.timestamp)}</b>
              </div>
              <div className={styles.summaryCell}>
                <span>Stream</span>
                <b>{event.streamLabel}</b>
              </div>
            </>
          ) : null}
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.eyebrow}>Trace proof</div>
        <div className="mt-3 space-y-3">
          {timeline.slice(0, 8).map((item, index) => {
            const row = asRecord(item);
            const ref = asString(
              row.reference ?? row.entity_id ?? row.label,
              "",
            );
            return (
              <button
                key={index}
                type="button"
                onClick={() => ref && onTrace(ref)}
                className="flex w-full gap-3 text-left text-xs"
              >
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
                <span>
                  <b className="block text-content-2">
                    {asString(
                      row.label ?? row.event_type ?? row.action,
                      "Event",
                    )}
                  </b>
                  <span className="text-content-3">
                    {asString(
                      row.message ?? row.description ?? row.reference,
                      "Trace row",
                    )}
                  </span>
                </span>
              </button>
            );
          })}
          {!timeline.length ? (
            <EmptyTiny
              label={event?.summary || "No trace timeline selected."}
            />
          ) : null}
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.eyebrow}>Related entities</div>
        <div className="mt-3 flex flex-wrap gap-2">
          {related.slice(0, 10).map((item, index) => {
            const row = asRecord(item);
            const ref = asString(row.reference ?? row.label ?? row.id, "");
            return (
              <button
                key={`${ref}-${index}`}
                type="button"
                onClick={() => ref && onTrace(ref)}
                className={styles.smallPill}
              >
                {ref || "Related"}
              </button>
            );
          })}
          {!related.length ? (
            <span className="text-xs font-medium text-content-3">
              No related entities returned yet.
            </span>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

function EmptyConsole({ label }: { label: string }) {
  return (
    <div className="grid min-h-[360px] place-items-center p-8 text-center">
      <div>
        <FileSearch className="mx-auto h-8 w-8 text-content-4" />
        <div className="mt-3 text-sm font-black text-content-2">{label}</div>
        <div className="mt-1 text-xs font-medium text-content-3">
          Change filters, enable all streams, or search a reference.
        </div>
      </div>
    </div>
  );
}

function EmptyTiny({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-surface-2 p-3 text-xs font-medium text-content-3">
      {label}
    </div>
  );
}
