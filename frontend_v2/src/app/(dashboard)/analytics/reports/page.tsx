"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowUpRight,
  Boxes,
  Clock3,
  Coins,
  DoorOpen,
  Droplets,
  Factory,
  FileText,
  Gauge,
  GitBranch,
  Layers,
  PackageSearch,
  Send,
  ShoppingCart,
  Sparkles,
  Timer,
  Trash2,
  Truck,
  UserCheck,
  Warehouse,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { getApiErrorStatus } from "@/lib/api";
import {
  analyticsApi,
  type ReportDispatchRun,
  type ReportDistributionProfile,
} from "@/services/analytics";
import {
  HeroStat,
  HeroStats,
  PageHero,
  Panel,
  PanelEmpty,
  heroButtonClass,
} from "@/components/premium";
import { Pill } from "@/components/logistics/yard-ui";
import { useAuth } from "@/components/auth-provider";
import { canViewGateReports, isGateMaster } from "@/components/gate/gate-access";

type ReportCard = {
  href: string;
  title: string;
  copy: string;
  icon: React.ComponentType<{ className?: string }>;
};

const LIBRARY: { domain: string; description: string; reports: ReportCard[] }[] = [
  {
    domain: "Production",
    description: "Output, efficiency and lost time on the floor",
    reports: [
      { href: "/analytics/reports/production", title: "Production Performance", copy: "Output, yield and job completion by process, machine and shift", icon: Factory },
      { href: "/analytics/reports/oee", title: "OEE Deep Dive", copy: "Availability × performance × quality for every running machine", icon: Gauge },
      { href: "/analytics/reports/downtime", title: "Downtime Analysis", copy: "Pareto of stoppage reasons, MTTR and worst machines", icon: Timer },
      { href: "/analytics/reports/shift-performance", title: "Shift Performance", copy: "Output, scrap and downtime compared shift by shift", icon: Clock3 },
      { href: "/analytics/reports/operator", title: "Operator Performance", copy: "Leaderboard of output, efficiency and scrap by operator", icon: UserCheck },
    ],
  },
  {
    domain: "Quality & materials",
    description: "Where material and ink go, and what is wasted",
    reports: [
      { href: "/analytics/reports/scrap", title: "Scrap & Yield", copy: "Scrap cost, reasons, jobs and processes driving waste", icon: Trash2 },
      { href: "/analytics/reports/material-variance", title: "Material Variance", copy: "Theoretical vs issued vs consumed, by material and job", icon: Layers },
      { href: "/analytics/reports/mrp", title: "MRP & Consumption Variance", copy: "Planning accuracy, waste factor and material flow", icon: GitBranch },
      { href: "/analytics/reports/ink-intelligence", title: "Ink Intelligence", copy: "Ink issue discipline and returns by colour family", icon: Droplets },
    ],
  },
  {
    domain: "Sales & logistics",
    description: "From order book to proof of delivery",
    reports: [
      { href: "/analytics/reports/sales", title: "Sales Fulfillment", copy: "Order value, OTIF, pipeline, top customers and overdue orders", icon: ShoppingCart },
      { href: "/analytics/reports/dispatch", title: "Dispatch & Logistics", copy: "Challans, shipped weight and customer mix", icon: Truck },
      { href: "/analytics/reports/interplant", title: "Inter-Plant Logistics", copy: "Transfers dispatched, received and in transit between plants", icon: Activity },
      { href: "/analytics/reports/trading", title: "Trading Pulse", copy: "Trading goods revenue, margin and slow movers", icon: Sparkles },
    ],
  },
  {
    domain: "Inventory & finance",
    description: "Stock health, lineage and profitability",
    reports: [
      { href: "/analytics/reports/inventory", title: "Inventory Health", copy: "Stock by stage, family and location with aging bands", icon: Warehouse },
      { href: "/analytics/reports/inventory-lineage", title: "Inventory Lineage", copy: "Trace stock families back through stages and plants", icon: PackageSearch },
      { href: "/analytics/reports/costing", title: "Costing & Profitability", copy: "Cost split, margin by customer and cost per kg", icon: Coins },
    ],
  },
];

/** Gate report: Admin/Owner (full) or an explicit gate.reports grant (sanitized). Never inferred from "*". */
const GATE_REPORT: ReportCard = {
  href: "/analytics/reports/gate",
  title: "Gate Register",
  copy: "Inward/outward entries, ERP match status and visitor counts",
  icon: DoorOpen,
};
/** Daily pack configuration/generation is Admin/Owner only. */
const GATE_PACK: ReportCard = {
  href: "/system/report-center",
  title: "Gate Register Daily pack",
  copy: "Turn on, generate and archive the daily gate pack",
  icon: Send,
};

const formatDateTime = (value?: string | null) => {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};

const runTone = (status?: string) => {
  const s = String(status || "").toUpperCase();
  if (s === "SUCCEEDED" || s === "SENT") return "good" as const;
  if (s === "FAILED") return "bad" as const;
  return "info" as const;
};

const LEGACY_TABS = new Set([
  "production", "oee", "downtime", "scrap", "inventory", "interplant", "mrp", "sales", "dispatch", "operator",
  "costing", "material-variance", "ink-intelligence", "inventory-lineage", "shift-performance", "trading",
]);

function ReportsHubContent() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, effectiveRole } = useAuth();
  const showGate = Boolean(user) && canViewGateReports(user, effectiveRole);
  const gateMaster = Boolean(user) && isGateMaster(user, effectiveRole);
  const library = useMemo(() => {
    if (!showGate) return LIBRARY;
    return [
      ...LIBRARY,
      {
        domain: "Gate & Visitors",
        description: "Vehicles in and out of the gate, checked against ERP documents",
        reports: gateMaster ? [GATE_REPORT, GATE_PACK] : [GATE_REPORT],
      },
    ];
  }, [showGate, gateMaster]);

  // Older links used /analytics/reports?tab=<report>; send them to the report page.
  useEffect(() => {
    const tab = searchParams?.get("tab");
    if (tab && LEGACY_TABS.has(tab)) {
      const params = new URLSearchParams(searchParams?.toString());
      params.delete("tab");
      const query = params.toString();
      router.replace(`/analytics/reports/${tab}${query ? `?${query}` : ""}`);
    }
  }, [router, searchParams]);

  const profilesQuery = useQuery<ReportDistributionProfile[]>({
    queryKey: ["analytics-report-distributions"],
    queryFn: analyticsApi.getReportDistributions,
    retry: (count, error) => getApiErrorStatus(error) !== 403 && count < 2,
    staleTime: 600_000,
    // 403 is an expected role outcome here and is rendered as "Restricted".
    meta: { suppressGlobalError: true },
  });
  const runsQuery = useQuery<ReportDispatchRun[]>({
    queryKey: ["analytics-report-runs", 8],
    queryFn: () => analyticsApi.getReportRuns(8),
    retry: (count, error) => getApiErrorStatus(error) !== 403 && count < 2,
    staleTime: 120_000,
    meta: { suppressGlobalError: true },
  });

  const profiles = profilesQuery.data ?? [];
  const runs = runsQuery.data ?? [];
  const latestRun = runs[0] ?? null;
  // Two separate permissions: pack configuration/generation (profiles) and
  // read-only archive access (runs). A gate.reports delegate gets 403 on the
  // first but may still read sanitized gate run PDFs/CSVs.
  const configRestricted = getApiErrorStatus(profilesQuery.error) === 403;
  const archiveRestricted = getApiErrorStatus(runsQuery.error) === 403;
  const reportCount = useMemo(() => library.reduce((sum, group) => sum + group.reports.length, 0), [library]);

  const sendMutation = useMutation({
    mutationFn: (reportCode: string) => analyticsApi.sendReportDistribution(reportCode),
    onSuccess: () => {
      toast({ title: "Report generated", description: "The daily pack was archived and owner/admin were notified in-app." });
      queryClient.invalidateQueries({ queryKey: ["analytics-report-runs"] });
    },
    onError: (error: any) =>
      toast({
        variant: "destructive",
        title: "Report generation failed",
        description: error?.response?.data?.detail || error?.message || "Send failed.",
      }),
  });

  return (
    <div className="mx-auto max-w-[1600px] space-y-4" data-testid="reports-hub-page">
      <PageHero
        eyebrow="Analytics"
        icon={<FileText />}
        title="Reports Hub"
        description="Every operational report in one place. Open a report for KPIs against targets, trends, insights and exportable detail."
        actions={
          latestRun ? (
            <a href={analyticsApi.getReportRunPreviewUrl(latestRun.id)} target="_blank" rel="noreferrer" className={heroButtonClass("primary")}>
              <FileText /> Latest daily pack
            </a>
          ) : null
        }
      >
        <HeroStats columns={4}>
          <HeroStat label="Reports" value={reportCount} hint={`across ${library.length} domains`} />
          <HeroStat
            label="Daily packs"
            value={configRestricted ? "Restricted" : profilesQuery.isPending ? "—" : profiles.length}
            hint="scheduled distributions"
          />
          <HeroStat
            label="Recent runs"
            value={archiveRestricted ? "Restricted" : runsQuery.isPending ? "—" : runs.length}
            hint="archived report packs"
          />
          <HeroStat
            label="Last generated"
            tone={latestRun ? (runTone(latestRun.status) === "good" ? "good" : "warn") : undefined}
            value={latestRun ? formatDateTime(latestRun.sent_at || latestRun.report_date) : "—"}
            hint={latestRun ? String(latestRun.report_code || "").replaceAll("_", " ").toLowerCase() : "no runs yet"}
          />
        </HeroStats>
      </PageHero>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          {library.map((group) => (
            <section key={group.domain} className="space-y-2.5">
              <div className="flex items-baseline justify-between px-1">
                <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-content-1">{group.domain}</h2>
                <span className="text-[12px] text-content-3">{group.description}</span>
              </div>
              <div className="erp-stagger grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                {group.reports.map((report) => {
                  const Icon = report.icon;
                  return (
                    <Link
                      key={report.href}
                      href={report.href}
                      className="group relative flex min-h-[112px] flex-col rounded-2xl border border-line bg-surface-1 p-4 shadow-[var(--shadow-sm)] transition-[transform,box-shadow,border-color] duration-150 hover:-translate-y-px hover:border-line-strong hover:shadow-[var(--shadow-md)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span className="grid h-9 w-9 place-items-center rounded-xl bg-surface-2 text-content-1 ring-1 ring-line transition group-hover:bg-content-1 group-hover:text-surface-1">
                          <Icon className="h-4 w-4" />
                        </span>
                        <ArrowUpRight className="h-4 w-4 text-content-4 transition group-hover:text-content-1" />
                      </div>
                      <div className="mt-3 text-[13.5px] font-semibold text-content-1">{report.title}</div>
                      <div className="mt-0.5 text-[12px] leading-relaxed text-content-3">{report.copy}</div>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        <aside className="space-y-4">
          {configRestricted && archiveRestricted ? (
            <Panel title="Report archive" description="Generation history and PDF previews are limited to report admins.">
              <PanelEmpty icon={<Boxes />} title="Archive restricted for this role">
                Every report above is still available to open and export.
              </PanelEmpty>
            </Panel>
          ) : (
            <>
              {configRestricted ? null : (
              <Panel icon={<Send />} title="Report generation" description="Archive a daily pack now and notify owner/admin in-app.">
                {profilesQuery.isPending ? (
                  <div className="space-y-2">
                    {Array.from({ length: 2 }).map((_, i) => (
                      <div key={i} className="erp-skeleton h-24 rounded-xl" />
                    ))}
                  </div>
                ) : profiles.length ? (
                  <ul className="space-y-2.5">
                    {profiles.map((profile) => {
                      const run = runs.find((r) => r.report_code === profile.report_code);
                      return (
                        <li key={profile.report_code} className="rounded-xl border border-line bg-surface-2/60 p-3.5">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-[13px] font-semibold text-content-1">{profile.label}</div>
                              <div className="mt-0.5 text-[11.5px] text-content-3">
                                To {(profile.target_roles || []).map((r: string) => r.toLowerCase().replaceAll("_", " ")).join(", ") || "owner, admin"}
                              </div>
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => sendMutation.mutate(profile.report_code)}
                              disabled={sendMutation.isPending}
                            >
                              <Send className="mr-1.5 h-3.5 w-3.5" />
                              Generate daily pack
                            </Button>
                          </div>
                          <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-line pt-2.5 text-[11.5px] text-content-3">
                            <span className="font-medium text-content-2">Latest run</span>
                            {run ? (
                              <span className="flex items-center gap-2">
                                <Pill tone={runTone(run.status)} dot>
                                  {String(run.status || "").toLowerCase()}
                                </Pill>
                                {run.report_date}
                              </span>
                            ) : (
                              <span>No run yet</span>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <PanelEmpty title="No daily packs configured" />
                )}
              </Panel>
              )}

              {archiveRestricted ? null : (
              <Panel
                icon={<FileText />}
                title="Recent report runs"
                description={configRestricted ? "Read-only archive of the packs you are allowed to see." : "Archived packs with PDF preview and detail workbook."}
              >
                {runsQuery.isPending ? (
                  <div className="space-y-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="erp-skeleton h-16 rounded-xl" />
                    ))}
                  </div>
                ) : runs.length ? (
                  <ul className="divide-y divide-line">
                    {runs.slice(0, 8).map((run) => (
                      <li key={run.id} className="py-3 first:pt-0 last:pb-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-[13px] font-medium capitalize text-content-1">
                            {String(run.report_code || "").replaceAll("_", " ").toLowerCase()}
                          </span>
                          <Pill tone={runTone(run.status)} dot>
                            {String(run.status || "").toLowerCase()}
                          </Pill>
                        </div>
                        <div className="mt-0.5 text-[11.5px] text-content-3">
                          For {run.report_date} · generated {formatDateTime(run.sent_at)}
                        </div>
                        <div className="mt-1.5 flex gap-3 text-[12px] font-medium">
                          <a href={analyticsApi.getReportRunPreviewUrl(run.id)} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                            Preview PDF
                          </a>
                          {run.detail_file_name ? (
                            <a href={analyticsApi.getReportRunDetailUrl(run.id)} target="_blank" rel="noreferrer" className="text-content-2 hover:underline">
                              Detail workbook
                            </a>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <PanelEmpty title="No report runs yet">
                    {configRestricted ? "Archived packs you can read will appear here." : "Generate a daily pack to start the archive."}
                  </PanelEmpty>
                )}
              </Panel>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

export default function ReportsHubPage() {
  return (
    <Suspense fallback={<div className="erp-skeleton h-[420px] rounded-[22px]" />}>
      <ReportsHubContent />
    </Suspense>
  );
}
