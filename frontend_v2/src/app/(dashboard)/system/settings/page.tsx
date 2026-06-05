"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BellRing, RefreshCw, Settings2 } from "lucide-react";

import { analyticsApi } from "@/services/analytics";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function SettingsPage() {
  const profilesQuery = useQuery({
    queryKey: ["report-center-distributions-lite"],
    queryFn: analyticsApi.getReportDistributions,
    staleTime: 60_000,
  });
  const runsQuery = useQuery({
    queryKey: ["report-center-runs-lite"],
    queryFn: () => analyticsApi.getReportRuns(8, 30),
    staleTime: 60_000,
  });

  const profiles = profilesQuery.data ?? [];
  const runs = runsQuery.data ?? [];
  const activeCount = profiles.filter((profile) => profile.active).length;
  const successfulRuns = runs.filter(
    (run) => run.status === "SUCCEEDED",
  ).length;

  return (
    <div className="min-h-screen space-y-6 bg-surface-2 p-6">
      <section className="rounded-[2rem] border border-line bg-surface-1 px-6 py-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-line bg-surface-2 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-content-3">
              <Settings2 className="h-3.5 w-3.5" />
              System Settings
            </div>
            <h1 className="mt-3 text-3xl font-black tracking-tight text-content-1">
              Report delivery settings removed
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-content-3">
              Daily report email and schedule configuration is intentionally
              removed. Reports now generate into archive and notify owner/admin
              in-app.
            </p>
          </div>
          <Button
            asChild
            className="rounded-full bg-surface-3 text-white hover:bg-line"
          >
            <Link href="/system/report-center">
              Open Report Center
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Active daily packs" value={String(activeCount)} />
        <StatCard label="Successful archives" value={String(successfulRuns)} />
        <StatCard label="Inbox audience" value="OWNER · ADMIN" />
      </div>

      <Card className="border-line">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg font-black text-content-1">
            <BellRing className="h-5 w-5 text-primary" />
            New report model
          </CardTitle>
          <CardDescription>
            Use the report center for activation and manual generation. Use the
            notification tray for visibility when daily packs are created.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            onClick={() => {
              profilesQuery.refetch();
              runsQuery.refetch();
            }}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh status
          </Button>
          <Button asChild variant="outline">
            <Link href="/analytics">Open Reports Hub</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/system/report-center">Open archive controls</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="border-line">
      <CardContent className="p-5">
        <div className="text-[11px] font-black uppercase tracking-[0.16em] text-content-3">
          {label}
        </div>
        <div className="mt-2 text-3xl font-black text-content-1">{value}</div>
      </CardContent>
    </Card>
  );
}
