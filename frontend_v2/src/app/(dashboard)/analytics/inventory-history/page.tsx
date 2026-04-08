"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { Camera, Layers, ShieldAlert, Warehouse } from "lucide-react"

import { ReportLayout } from "@/components/analytics/report-layout"
import { ChartSurface } from "@/components/ui-custom/chart-surface"
import { SummaryStatCard } from "@/components/ui-custom/summary-stat-card"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { SemanticBadge } from "@/components/ui-custom/semantic-badge"
import { observabilityApi, type InventorySnapshot } from "@/services/observability"

function formatKg(value: number) {
  return `${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  })} kg`
}

function formatCompactDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })
}

function formatFullDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export default function InventoryHistoryPage() {
  const [snapshots, setSnapshots] = useState<InventorySnapshot[]>([])
  const [loading, setLoading] = useState(true)

  const loadSnapshots = async () => {
    try {
      setLoading(true)
      const data = await observabilityApi.getSnapshots(undefined, { limit: 180, days: 180 })
      setSnapshots(data)
    } catch (error) {
      console.error("Failed to load snapshots:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadSnapshots()
  }, [])

  const orderedSnapshots = useMemo(
    () => [...snapshots].sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime()),
    [snapshots],
  )

  const latestSnapshots = useMemo(() => {
    const latestByPlant = new Map<string, InventorySnapshot>()
    for (const snapshot of [...snapshots].sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())) {
      if (!latestByPlant.has(snapshot.plant)) {
        latestByPlant.set(snapshot.plant, snapshot)
      }
    }
    return Array.from(latestByPlant.values())
  }, [snapshots])

  const latest = orderedSnapshots[orderedSnapshots.length - 1]
  const previous = orderedSnapshots[orderedSnapshots.length - 2]

  const trendRows = orderedSnapshots.map((snapshot) => ({
    label: formatCompactDate(snapshot.created_at),
    bulk: snapshot.total_bulk_kg,
    roll: snapshot.total_roll_kg,
    fg: snapshot.total_fg_kg,
    wip: snapshot.total_wip_kg,
    reserved: snapshot.reserved_roll_kg,
  }))

  const plantRows = latestSnapshots.map((snapshot) => ({
    plant: snapshot.plant_code || snapshot.plant_name,
    total: Number(snapshot.total_bulk_kg || 0) + Number(snapshot.total_roll_kg || 0),
    wip: snapshot.total_wip_kg,
    reserved: snapshot.reserved_roll_kg,
  }))

  const totalStockKg = latest ? Number(latest.total_bulk_kg || 0) + Number(latest.total_roll_kg || 0) : 0
  const previousStockKg = previous ? Number(previous.total_bulk_kg || 0) + Number(previous.total_roll_kg || 0) : 0
  const stockDeltaPct = previousStockKg > 0 ? ((totalStockKg - previousStockKg) / previousStockKg) * 100 : 0
  const wipSharePct = totalStockKg > 0 && latest ? (Number(latest.total_wip_kg || 0) / totalStockKg) * 100 : 0
  const reserveSharePct = totalStockKg > 0 && latest ? (Number(latest.reserved_roll_kg || 0) / totalStockKg) * 100 : 0

  if (loading) {
    return (
      <ReportLayout
        title="Inventory Snapshot History"
        description="Track the inventory estate over time, keep Inventory snapshot rhythm visible from the top of the page, surface the Snapshot ledger immediately for audit review, and spot which plants are carrying the most stock pressure."
      >
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-32 rounded-[1.75rem]" />
            ))}
          </div>
          <div className="grid gap-6 xl:grid-cols-[1.7fr_1fr]">
            <Skeleton className="h-[420px] rounded-[2rem]" />
            <Skeleton className="h-[420px] rounded-[2rem]" />
          </div>
          <Skeleton className="h-[360px] rounded-[2rem]" />
        </div>
      </ReportLayout>
    )
  }

  return (
    <ReportLayout
      title="Inventory Snapshot History"
      description="Track the inventory estate over time, keep Inventory snapshot rhythm visible from the top of the page, surface the Snapshot ledger immediately for audit review, and spot which plants are carrying the most stock pressure."
      onRefresh={loadSnapshots}
      actions={
        latest ? (
          <div className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 shadow-sm">
            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Latest capture</div>
            <div className="mt-1 text-sm font-semibold text-slate-700">{formatFullDate(latest.created_at)}</div>
          </div>
        ) : undefined
      }
    >
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SummaryStatCard
            label="Captured snapshots"
            value={snapshots.length.toLocaleString()}
            subLabel={`${latestSnapshots.length} plants represented in the latest cycle`}
            icon={Camera}
            toneClassName="bg-indigo-50 text-indigo-700"
          />
          <SummaryStatCard
            label="Latest stock estate"
            value={formatKg(totalStockKg)}
            subLabel={`${stockDeltaPct >= 0 ? "+" : ""}${stockDeltaPct.toFixed(1)}% vs previous snapshot`}
            icon={Warehouse}
            toneClassName="bg-emerald-50 text-emerald-700"
          />
          <SummaryStatCard
            label="WIP share"
            value={`${wipSharePct.toFixed(1)}%`}
            subLabel={latest ? `${formatKg(latest.total_wip_kg)} still in process` : "No WIP yet"}
            icon={Layers}
            toneClassName="bg-amber-50 text-amber-700"
          />
          <SummaryStatCard
            label="Reserved load"
            value={`${reserveSharePct.toFixed(1)}%`}
            subLabel={latest ? `${formatKg(latest.reserved_roll_kg)} reserved rolls` : "No reserve load"}
            icon={ShieldAlert}
            toneClassName="bg-rose-50 text-rose-700"
          />
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.7fr_1fr]">
          <Card className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/85 shadow-[0_24px_70px_-45px_rgba(15,23,42,0.45)] backdrop-blur-xl">
            <CardHeader className="border-b border-slate-100/80 bg-white/70">
              <CardTitle className="text-lg font-black tracking-tight text-slate-900">Inventory snapshot rhythm</CardTitle>
              <p className="text-sm text-slate-500">Bulk, roll, FG, and WIP stock across the captured history window.</p>
            </CardHeader>
            <CardContent className="p-6">
              <ChartSurface className="min-h-[340px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trendRows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="bulkGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#4F46E5" stopOpacity={0.22} />
                        <stop offset="95%" stopColor="#4F46E5" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="rollGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#0891B2" stopOpacity={0.16} />
                        <stop offset="95%" stopColor="#0891B2" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "#64748B", fontSize: 12 }} />
                    <YAxis tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} tickLine={false} axisLine={false} tick={{ fill: "#64748B", fontSize: 12 }} />
                    <Tooltip formatter={(value: number | string | undefined) => formatKg(Number(value || 0))} />
                    <Area type="monotone" dataKey="bulk" stroke="#4F46E5" strokeWidth={2.4} fill="url(#bulkGradient)" />
                    <Area type="monotone" dataKey="roll" stroke="#0891B2" strokeWidth={2.2} fill="url(#rollGradient)" />
                    <Area type="monotone" dataKey="fg" stroke="#10B981" strokeWidth={2} fillOpacity={0} />
                    <Area type="monotone" dataKey="wip" stroke="#F59E0B" strokeWidth={2} fillOpacity={0} />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartSurface>
            </CardContent>
          </Card>

          <Card className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/85 shadow-[0_24px_70px_-45px_rgba(15,23,42,0.45)] backdrop-blur-xl">
            <CardHeader className="border-b border-slate-100/80 bg-white/70">
              <CardTitle className="text-lg font-black tracking-tight text-slate-900">Latest plant load</CardTitle>
              <p className="text-sm text-slate-500">Latest stock snapshot by plant so planner and store teams can see where weight is concentrated.</p>
            </CardHeader>
            <CardContent className="space-y-4 p-6">
              <ChartSurface className="min-h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={plantRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                    <XAxis dataKey="plant" tickLine={false} axisLine={false} tick={{ fill: "#64748B", fontSize: 12 }} />
                    <YAxis tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} tickLine={false} axisLine={false} tick={{ fill: "#64748B", fontSize: 12 }} />
                    <Tooltip formatter={(value: number | string | undefined) => formatKg(Number(value || 0))} />
                    <Bar dataKey="total" fill="#4F46E5" radius={[8, 8, 0, 0]} />
                    <Bar dataKey="wip" fill="#F59E0B" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartSurface>
              <div className="space-y-3">
                {latestSnapshots.slice(0, 4).map((snapshot) => (
                  <div key={snapshot.id} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-bold text-slate-800">{snapshot.plant_name}</div>
                        <div className="mt-1 text-xs text-slate-500">{formatFullDate(snapshot.created_at)}</div>
                      </div>
                      <SemanticBadge kind="severity" value={Number(snapshot.reserved_roll_kg || 0) > 0 ? "MEDIUM" : "LOW"} label={Number(snapshot.reserved_roll_kg || 0) > 0 ? "Reserve load" : "Clear reserve"} />
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-xs font-semibold text-slate-600">
                      <div className="rounded-xl bg-white px-3 py-2">Bulk<br /><span className="text-sm font-black text-slate-900">{formatKg(snapshot.total_bulk_kg)}</span></div>
                      <div className="rounded-xl bg-white px-3 py-2">Rolls<br /><span className="text-sm font-black text-slate-900">{formatKg(snapshot.total_roll_kg)}</span></div>
                      <div className="rounded-xl bg-white px-3 py-2">WIP<br /><span className="text-sm font-black text-slate-900">{formatKg(snapshot.total_wip_kg)}</span></div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/85 shadow-[0_24px_70px_-45px_rgba(15,23,42,0.45)] backdrop-blur-xl">
          <CardHeader className="border-b border-slate-100/80 bg-white/70">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle className="text-lg font-black tracking-tight text-slate-900">Snapshot ledger</CardTitle>
                <p className="text-sm text-slate-500">Latest snapshots first, with plant, reserve load, scrap, and FG/WIP balance.</p>
              </div>
              <Button variant="outline" size="sm" onClick={loadSnapshots} className="rounded-xl border-slate-200 bg-white/90 shadow-sm">
                Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 p-6">
            {snapshots.length === 0 ? (
              <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/70 p-10 text-center text-sm text-slate-500">
                No snapshots have been captured yet.
              </div>
            ) : (
              [...snapshots]
                .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
                .map((snapshot) => (
                  <div key={snapshot.id} className="rounded-[1.5rem] border border-slate-200 bg-slate-50/70 p-4">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                      <div>
                        <div className="text-base font-black tracking-tight text-slate-900">{snapshot.plant_name}</div>
                        <div className="mt-1 text-xs font-medium text-slate-500">{formatFullDate(snapshot.created_at)}</div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <SemanticBadge kind="severity" value={Number(snapshot.total_wip_kg || 0) > 0 ? "MEDIUM" : "LOW"} label={`WIP ${formatKg(snapshot.total_wip_kg)}`} />
                        <SemanticBadge kind="severity" value={Number(snapshot.reserved_roll_kg || 0) > 0 ? "MEDIUM" : "LOW"} label={`Reserved ${formatKg(snapshot.reserved_roll_kg)}`} />
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-5">
                      <MetricTile label="Bulk" value={formatKg(snapshot.total_bulk_kg)} />
                      <MetricTile label="Rolls" value={formatKg(snapshot.total_roll_kg)} />
                      <MetricTile label="FG" value={formatKg(snapshot.total_fg_kg)} />
                      <MetricTile label="WIP" value={formatKg(snapshot.total_wip_kg)} />
                      <MetricTile label="Scrap" value={formatKg(snapshot.scrap_kg)} />
                    </div>
                  </div>
                ))
            )}
          </CardContent>
        </Card>
      </div>
    </ReportLayout>
  )
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white px-3 py-3 shadow-sm">
      <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">{label}</div>
      <div className="mt-2 text-sm font-black text-slate-900">{value}</div>
    </div>
  )
}
