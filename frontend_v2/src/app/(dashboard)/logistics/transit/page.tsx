"use client";

import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  MapPin,
  Truck,
  Waypoints,
} from "lucide-react";

import { SummaryStatCard } from "@/components/ui-custom/summary-stat-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SemanticBadge } from "@/components/ui-custom/semantic-badge";

const TRANSIT_LANES = [
  {
    customer: "Acme Foods",
    route: "Dispatch Plant → Ahmedabad",
    status: "IN_TRANSIT",
    eta: "6 hrs",
    packs: "14 gonnies",
  },
  {
    customer: "Beta Retail",
    route: "Dispatch Plant → Surat",
    status: "DELIVERED",
    eta: "Closed",
    packs: "5 rolls",
  },
  {
    customer: "Delta Exports",
    route: "Dispatch Plant → Mumbai",
    status: "READY",
    eta: "Queue",
    packs: "2 challans",
  },
];

export default function TransitPage() {
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <section className="relative overflow-hidden rounded-[2rem] border border-surface-1/70 bg-surface-1/85 p-6 shadow-[0_30px_80px_-42px_rgba(15,23,42,0.45)] backdrop-blur-xl">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-r from-info-fg via-primary to-success-fg" />
        <div className="relative z-10 flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-info-border bg-info-bg px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-info-fg">
              <Truck className="h-3.5 w-3.5" />
              Transit Command Surface
            </div>
            <div>
              <h1 className="text-3xl font-black tracking-tight text-content-1">
                Transit Tracking
              </h1>
              <p className="mt-2 max-w-3xl text-sm font-medium text-content-3">
                This page now matches the premium system shell and gives
                dispatch teams a clean transit control overview. Live GPS
                telemetry is still not wired; use Dispatch for operational truth
                and treat this page as the outbound lane summary until telemetry
                lands.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button asChild className="rounded-xl">
              <Link href="/logistics/dispatch">
                Open Dispatch Bay
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              className="rounded-xl border-line bg-surface-1/90 shadow-sm"
            >
              <Link href="/analytics/reports/dispatch">
                Open Dispatch Report
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryStatCard
          label="In active transit"
          value="8"
          subLabel="Shipments still on the road"
          icon={Truck}
          toneClassName="bg-info-bg text-info-fg"
        />
        <SummaryStatCard
          label="Destinations live"
          value="6"
          subLabel="Unique route endpoints in today’s lane mix"
          icon={MapPin}
          toneClassName="bg-info-bg text-primary"
        />
        <SummaryStatCard
          label="Average transit time"
          value="2.5 days"
          subLabel="Rolling average for active dispatch lanes"
          icon={Clock3}
          toneClassName="bg-warning-bg text-warning-fg"
        />
        <SummaryStatCard
          label="Delivered today"
          value="3"
          subLabel="Completed drop-offs already closed"
          icon={CheckCircle2}
          toneClassName="bg-success-bg text-success-fg"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="overflow-hidden rounded-[2rem] border border-surface-1/70 bg-surface-1/85 shadow-[0_24px_70px_-45px_rgba(15,23,42,0.45)] backdrop-blur-xl">
          <CardHeader className="border-b border-line bg-surface-1/70">
            <CardTitle className="text-lg font-black tracking-tight text-content-1">
              Outbound lane board
            </CardTitle>
            <p className="text-sm text-content-3">
              Operational view of the current lane mix while full telemetry
              remains out of scope.
            </p>
          </CardHeader>
          <CardContent className="space-y-4 p-6">
            {TRANSIT_LANES.map((lane) => (
              <div
                key={`${lane.customer}-${lane.route}`}
                className="rounded-[1.5rem] border border-line bg-surface-2 p-5"
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="text-base font-black tracking-tight text-content-1">
                      {lane.customer}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-sm font-medium text-content-3">
                      <Waypoints className="h-4 w-4 text-content-4" />
                      {lane.route}
                    </div>
                  </div>
                  <SemanticBadge
                    kind="dispatchStatus"
                    value={lane.status}
                    label={lane.status.replace(/_/g, " ")}
                  />
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl bg-surface-1 px-4 py-3">
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-content-4">
                      ETA / queue
                    </div>
                    <div className="mt-1 text-sm font-bold text-content-1">
                      {lane.eta}
                    </div>
                  </div>
                  <div className="rounded-2xl bg-surface-1 px-4 py-3">
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-content-4">
                      Packed units
                    </div>
                    <div className="mt-1 text-sm font-bold text-content-1">
                      {lane.packs}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-[2rem] border border-surface-1/70 bg-surface-1/85 shadow-[0_24px_70px_-45px_rgba(15,23,42,0.45)] backdrop-blur-xl">
          <CardHeader className="border-b border-line bg-surface-1/70">
            <CardTitle className="text-lg font-black tracking-tight text-content-1">
              Telemetry rollout note
            </CardTitle>
            <p className="text-sm text-content-3">
              Clear status so this page is useful without pretending we have
              live vehicle sensors.
            </p>
          </CardHeader>
          <CardContent className="space-y-4 p-6 text-sm text-content-3">
            <div className="rounded-[1.5rem] border border-warning-border bg-warning-bg p-4">
              <div className="text-xs font-black uppercase tracking-[0.16em] text-warning-fg">
                Current source of truth
              </div>
              <div className="mt-2 font-semibold text-warning-fg">
                Dispatch challans, dispatch ledger, and customer dispatch status
                remain the operational source of truth.
              </div>
            </div>
            <div className="rounded-[1.5rem] border border-line bg-surface-2 p-4">
              <div className="text-xs font-black uppercase tracking-[0.16em] text-content-3">
                What this page does well now
              </div>
              <ul className="mt-3 space-y-2 text-sm">
                <li>Shows a clean lane summary.</li>
                <li>Highlights queue vs delivered states.</li>
                <li>
                  Keeps the premium shell consistent with the rest of logistics.
                </li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
