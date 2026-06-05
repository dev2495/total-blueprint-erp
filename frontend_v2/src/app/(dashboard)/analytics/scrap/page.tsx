"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Factory,
  RefreshCcw,
  Scissors,
  Trash2,
  Wrench,
} from "lucide-react";

import { analyticsApi } from "@/services/analytics";
import { factoryService } from "@/services/factory";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

function toKg(v: unknown) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n.toFixed(3) : "0.000";
}

export default function ScrapAnalyticsPage() {
  const [plant, setPlant] = useState("ALL");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const { data: plants = [] } = useQuery({
    queryKey: ["scrap-center-plants"],
    queryFn: factoryService.getPlants,
  });

  const filters = useMemo(
    () => ({
      plant: plant !== "ALL" ? plant : undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    }),
    [plant, dateFrom, dateTo],
  );

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["scrap-center", filters],
    queryFn: () => analyticsApi.getScrapCenter(filters),
    refetchInterval: 15000,
  });

  const summary = data?.summary || {
    production_scrap_kg: 0,
    adjustment_scrap_kg: 0,
    total_scrap_kg: 0,
    scrap_rate_percent: 0,
    total_consumed_kg: 0,
    total_output_kg: 0,
  };

  return (
    <div className="p-6 space-y-6 min-h-screen bg-surface-2">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight flex items-center gap-2">
            <Trash2 className="h-7 w-7 text-danger-fg" />
            Scrap Center
          </h1>
          <p className="text-content-3 mt-1">
            Production scrap vs inventory adjustments with machine/process
            drilldowns.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="text-xs text-content-3">Plant</label>
            <Select value={plant} onValueChange={setPlant}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All plants" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All plants</SelectItem>
                {plants.map((p: any) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-content-3">Date From</label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-[160px]"
            />
          </div>
          <div>
            <label className="text-xs text-content-3">Date To</label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-[160px]"
            />
          </div>
          <Button
            variant="outline"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCcw
              className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <KpiCard
          icon={<Scissors className="h-4 w-4 text-danger-fg" />}
          label="Production Scrap"
          value={`${toKg(summary.production_scrap_kg)} kg`}
        />
        <KpiCard
          icon={<Wrench className="h-4 w-4 text-warning-fg" />}
          label="Adjustment Scrap"
          value={`${toKg(summary.adjustment_scrap_kg)} kg`}
        />
        <KpiCard
          icon={<AlertTriangle className="h-4 w-4 text-danger-fg" />}
          label="Total Scrap"
          value={`${toKg(summary.total_scrap_kg)} kg`}
        />
        <KpiCard
          icon={<Factory className="h-4 w-4 text-success-fg" />}
          label="Output"
          value={`${toKg(summary.total_output_kg)} kg`}
        />
        <KpiCard
          icon={<Factory className="h-4 w-4 text-primary" />}
          label="Consumed"
          value={`${toKg(summary.total_consumed_kg)} kg`}
        />
        <KpiCard
          icon={<AlertTriangle className="h-4 w-4 text-warm" />}
          label="Scrap Rate"
          value={`${Number(summary.scrap_rate_percent || 0).toFixed(2)}%`}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <ListCard
          title="By Process"
          rows={(data?.by_process || []).map((row: any) => ({
            key: row.process,
            value: `${toKg(row.scrap_kg)} kg`,
            right: `${row.events} events`,
          }))}
          loading={isLoading}
        />
        <ListCard
          title="By Machine"
          rows={(data?.by_machine || []).map((row: any) => ({
            key: row.machine,
            value: `${toKg(row.scrap_kg)} kg`,
            right: `${row.events} events`,
          }))}
          loading={isLoading}
        />
        <ListCard
          title="By Reason"
          rows={(data?.by_reason || []).map((row: any) => ({
            key: row.reason,
            value: `${toKg(row.scrap_kg)} kg`,
            right: `${row.events} events`,
          }))}
          loading={isLoading}
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent Scrap Events</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-content-3">Loading events…</div>
          ) : (data?.recent_events || []).length === 0 ? (
            <div className="text-sm text-content-3">
              No scrap events for selected filters.
            </div>
          ) : (
            <div className="space-y-2">
              {(data?.recent_events || [])
                .slice(0, 60)
                .map((ev: any, idx: number) => (
                  <div
                    key={`scrap-ev-${idx}`}
                    className="grid grid-cols-1 md:grid-cols-6 gap-2 text-sm border rounded-md p-2"
                  >
                    <div className="md:col-span-2 text-content-3">
                      {ev.timestamp
                        ? new Date(ev.timestamp).toLocaleString()
                        : "—"}
                    </div>
                    <div>
                      <Badge variant="outline">{ev.stream || "—"}</Badge>
                    </div>
                    <div>{ev.reason || ev.event_type || "—"}</div>
                    <div className="font-semibold">
                      {toKg(ev.quantity_kg)} kg
                    </div>
                    <div className="text-content-3 truncate">
                      {ev.job_number ||
                        ev.material_name ||
                        ev.location_name ||
                        "—"}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2">
          {icon}
          <div className="text-xs text-content-3 uppercase tracking-wide">
            {label}
          </div>
        </div>
        <div className="text-xl font-black mt-2">{value}</div>
      </CardContent>
    </Card>
  );
}

function ListCard({
  title,
  rows,
  loading,
}: {
  title: string;
  rows: Array<{ key: string; value: string; right: string }>;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-sm text-content-3">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-content-3">No data</div>
        ) : (
          <div className="space-y-2">
            {rows.slice(0, 12).map((r, idx) => (
              <div
                key={`${title}-${idx}`}
                className="flex items-center justify-between text-sm border rounded-md px-3 py-2"
              >
                <div className="truncate">{r.key}</div>
                <div className="flex items-center gap-3">
                  <span className="font-semibold">{r.value}</span>
                  <span className="text-xs text-content-3">{r.right}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
