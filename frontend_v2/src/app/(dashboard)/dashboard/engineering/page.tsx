"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Microscope,
  Palette,
  Disc,
  FileText,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import Link from "next/link";
import { StatsGrid } from "@/components/dashboard/stats-grid";
import { api } from "@/lib/api";
import type { Metric } from "@/services/dashboard";

type ApiListResult = {
  rows: Array<Record<string, any>>;
  count: number;
  failed: boolean;
};

type EngineeringDashboardStats = {
  metrics: Metric[];
  approvalItems: Array<{
    id: string;
    kind: string;
    title: string;
    meta: string;
    href: string;
  }>;
  health: {
    artworkReadyPct: number | null;
    artworkReadyText: string;
    routeCoveragePct: number | null;
    routeCoverageText: string;
  };
};

const EMPTY_RESULT: ApiListResult = { rows: [], count: 0, failed: true };

function normalizeRows(payload: unknown): ApiListResult {
  const source = payload as any;
  const rows = Array.isArray(source)
    ? source
    : Array.isArray(source?.results)
      ? source.results
      : Array.isArray(source?.data)
        ? source.data
        : [];
  const count =
    typeof source?.count === "number" && Number.isFinite(source.count)
      ? source.count
      : rows.length;
  return { rows, count, failed: false };
}

async function fetchList(path: string): Promise<ApiListResult> {
  try {
    const { data } = await api.get(path);
    return normalizeRows(data);
  } catch {
    return EMPTY_RESULT;
  }
}

function statusOf(row: Record<string, any>) {
  return String(row.status || row.lifecycle_status || "").toUpperCase();
}

function fmtCount(value: number) {
  return value.toLocaleString("en-IN");
}

function pct(ready: number, total: number) {
  if (!total) return null;
  return Math.round((ready / total) * 100);
}

export default function EngineeringDashboard() {
  const { data: stats } = useQuery({
    queryKey: ["engineering-dashboard-stats"],
    queryFn: async () => {
      const [artworks, cylinders, templates, routeRules] = await Promise.all([
        fetchList("/api/artwork/artworks/?include_versions=0"),
        fetchList("/api/tooling/cylinders/"),
        fetchList("/api/templates/?options=light"),
        fetchList("/api/routing/rules/"),
      ]);

      const pendingArtworks = artworks.rows.filter((row) =>
        ["DRAFT", "PENDING_APPROVAL"].includes(statusOf(row)),
      );
      const cylinderAttention = cylinders.rows.filter((row) =>
        ["MAINTENANCE", "RE_CHROME"].includes(statusOf(row)),
      );
      const templatesToFinish = templates.rows.filter((row) =>
        ["DRAFT", "ENGINEERING", "APPROVED"].includes(statusOf(row)),
      );
      const liveTemplates = templates.rows.filter(
        (row) => statusOf(row) === "LIVE",
      );

      const artworkReady = artworks.rows.filter((row) =>
        Boolean(row.cylinder_ready),
      ).length;
      const templatesWithRoute = templates.rows.filter(
        (row) => row.routing_rule || row.routing_rule_name,
      ).length;
      const activeRoutes = routeRules.rows.filter(
        (row) => row.is_active !== false,
      ).length;

      const approvalItems = [
        ...pendingArtworks.slice(0, 3).map((row) => ({
          id: String(row.id || row.design_code || row.name),
          kind: "Artwork",
          title: String(row.name || row.design_code || "Untitled artwork"),
          meta: `${String(row.design_code || "No design code")} • ${statusOf(row).replaceAll("_", " ") || "Pending"}`,
          href: "/engineering/artworks",
        })),
        ...templatesToFinish.slice(0, 3).map((row) => ({
          id: String(row.id || row.name),
          kind: "Template",
          title: String(row.name || "Untitled template"),
          meta: `${statusOf(row).replaceAll("_", " ") || "Pending"} • ${row.routing_rule_name || "Route not linked"}`,
          href: "/engineering/templates",
        })),
      ].slice(0, 5);

      return {
        metrics: [
          {
            label: "Pending Artworks",
            value: artworks.failed ? "—" : fmtCount(pendingArtworks.length),
            unit: artworks.failed ? "Unavailable" : "draft / approval",
            trend: 0,
          },
          {
            label: "Cylinder Attention",
            value: cylinders.failed ? "—" : fmtCount(cylinderAttention.length),
            unit: cylinders.failed ? "Unavailable" : "maintenance / rechrome",
            trend: 0,
          },
          {
            label: "Templates To Finish",
            value: templates.failed ? "—" : fmtCount(templatesToFinish.length),
            unit: templates.failed ? "Unavailable" : "not live",
            trend: 0,
          },
          {
            label: "Live Templates",
            value: templates.failed ? "—" : fmtCount(liveTemplates.length),
            unit: routeRules.failed
              ? "Routes unavailable"
              : `${fmtCount(activeRoutes)} active routes`,
            trend: 0,
          },
        ],
        approvalItems,
        health: {
          artworkReadyPct: artworks.failed
            ? null
            : pct(artworkReady, artworks.rows.length),
          artworkReadyText: artworks.failed
            ? "Artwork API unavailable"
            : artworks.rows.length
              ? `${fmtCount(artworkReady)} of ${fmtCount(artworks.rows.length)} current artworks cylinder-ready`
              : "No current artwork records",
          routeCoveragePct: templates.failed
            ? null
            : pct(templatesWithRoute, templates.rows.length),
          routeCoverageText: templates.failed
            ? "Template API unavailable"
            : templates.rows.length
              ? `${fmtCount(templatesWithRoute)} of ${fmtCount(templates.rows.length)} templates have a route`
              : "No template records",
        },
      } satisfies EngineeringDashboardStats;
    },
    staleTime: 60_000,
  });

  const approvalItems = stats?.approvalItems ?? [];
  const health = stats?.health;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-content-1 tracking-tight">
            Engineering Hub
          </h1>
          <p className="text-content-3 font-medium">
            Product Design & Master Data Management
          </p>
        </div>
        <div className="flex gap-3">
          <Link href="/engineering/artworks/new">
            <Button className="bg-primary hover:bg-primary">
              <Palette className="mr-2 h-4 w-4" /> New Artwork
            </Button>
          </Link>
          <Link href="/engineering/cylinders/new">
            <Button variant="outline">
              <Disc className="mr-2 h-4 w-4" /> New Cylinder
            </Button>
          </Link>
        </div>
      </div>

      <StatsGrid metrics={stats?.metrics || []} />

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle>Approvals Queue</CardTitle>
            <CardDescription>
              Items awaiting engineering sign-off
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {approvalItems.length ? (
              approvalItems.map((item) => (
                <div
                  key={`${item.kind}-${item.id}`}
                  className="flex items-center justify-between p-3 bg-surface-2 rounded-lg"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="h-8 w-8 shrink-0 rounded-lg bg-info-bg text-primary flex items-center justify-center">
                      <FileText className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-content-1">
                        {item.title}
                      </p>
                      <p className="truncate text-xs text-content-3">
                        {item.kind} • {item.meta}
                      </p>
                    </div>
                  </div>
                  <Link href={item.href}>
                    <Button size="sm" variant="outline" className="h-8">
                      Review
                    </Button>
                  </Link>
                </div>
              ))
            ) : (
              <div className="flex items-center gap-3 rounded-lg border border-success-border bg-success-bg p-4 text-success-fg">
                <CheckCircle2 className="h-5 w-5 shrink-0" />
                <div>
                  <p className="text-sm font-black">No engineering queue</p>
                  <p className="text-xs font-semibold opacity-80">
                    Current artwork and template records have no pending
                    decision items.
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle>Catalog Health</CardTitle>
            <CardDescription>Master data status</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-success-bg rounded-xl border border-success-border">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 className="h-4 w-4 text-success-fg" />
                  <span className="text-xs font-bold text-success-fg uppercase">
                    Artworks
                  </span>
                </div>
                <p className="text-2xl font-black text-content-1">
                  {health?.artworkReadyPct === null ||
                  health?.artworkReadyPct === undefined
                    ? "—"
                    : `${health.artworkReadyPct}%`}
                </p>
                <p className="text-xs text-content-3">
                  {health?.artworkReadyText || "Loading artwork readiness"}
                </p>
              </div>
              <div className="p-4 bg-info-bg rounded-xl border border-info-border">
                <div className="flex items-center gap-2 mb-2">
                  {health?.routeCoveragePct === null ? (
                    <AlertTriangle className="h-4 w-4 text-warning-fg" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                  )}
                  <span className="text-xs font-bold text-primary uppercase">
                    Routes
                  </span>
                </div>
                <p className="text-2xl font-black text-content-1">
                  {health?.routeCoveragePct === null ||
                  health?.routeCoveragePct === undefined
                    ? "—"
                    : `${health.routeCoveragePct}%`}
                </p>
                <p className="text-xs text-content-3">
                  {health?.routeCoverageText || "Loading route coverage"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
