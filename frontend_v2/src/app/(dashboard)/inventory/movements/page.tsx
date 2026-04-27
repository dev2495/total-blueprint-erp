"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { ArrowRight, Calendar, History, MapPin, Package, RefreshCw, Search, Truck, User } from "lucide-react"

import { ChartSurface } from "@/components/ui-custom/chart-surface"
import { SemanticBadge } from "@/components/ui-custom/semantic-badge"
import { SummaryStatCard } from "@/components/ui-custom/summary-stat-card"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { listRollMovements, type RollMovement } from "@/services/rolls"
import { getSemanticMeta, humanizeToken } from "@/lib/visual-semantics"

function formatDate(timestamp: string) {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return timestamp
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export default function RollMovementsPage() {
  const [movements, setMovements] = useState<RollMovement[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")

  useEffect(() => {
    void fetchMovements()
  }, [])

  const fetchMovements = async () => {
    try {
      setLoading(true)
      const data = await listRollMovements()
      setMovements(data)
    } catch (error) {
      console.error("Failed to fetch movements:", error)
    } finally {
      setLoading(false)
    }
  }

  const filteredMovements = useMemo(
    () =>
      movements.filter((movement) =>
        [
          movement.roll_label,
          movement.reason,
          movement.to_location_name,
          movement.from_location_name || "",
          movement.job_no || "",
          movement.moved_by_name || "",
        ]
          .join(" ")
          .toLowerCase()
          .includes(searchQuery.toLowerCase()),
      ),
    [movements, searchQuery],
  )

  const reasonRows = useMemo(() => {
    const counts = new Map<string, number>()
    for (const movement of filteredMovements) {
      const key = movement.reason || "UNKNOWN"
      counts.set(key, (counts.get(key) || 0) + 1)
    }
    return Array.from(counts.entries())
      .map(([reason, count]) => ({ reason, count, color: getSemanticMeta("dispatchStatus", reason, humanizeToken(reason)).chartColor }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 6)
  }, [filteredMovements])

  const newestMove = filteredMovements[0]
  const productionMoves = filteredMovements.filter((movement) => movement.reason === "PRODUCTION").length
  const dispatchMoves = filteredMovements.filter((movement) => movement.reason === "DISPATCH").length
  const movementPlants = new Set(filteredMovements.map((movement) => movement.to_location_name.split(" ")[0]).filter(Boolean))

  if (loading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-40 rounded-[2rem]" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-32 rounded-[1.75rem]" />
          ))}
        </div>
        <Skeleton className="h-[420px] rounded-[2rem]" />
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <section className="relative overflow-hidden rounded-[2rem] border border-white/70 bg-white/85 p-6 shadow-[0_30px_80px_-42px_rgba(15,23,42,0.45)] backdrop-blur-xl">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-r from-blue-500/12 via-cyan-400/10 to-emerald-400/10" />
        <div className="relative z-10 flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50/80 px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-blue-700">
              <History className="h-3.5 w-3.5" />
              Movement Ledger
            </div>
            <div>
              <h1 className="text-3xl font-black tracking-tight text-slate-900">Roll Movements</h1>
              <p className="mt-2 max-w-3xl text-sm font-medium text-slate-500">
                Trace physical location moves across GRN, production, WIP transfer, inter-plant, jobwork, and dispatch without digging through raw transaction tables first.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[280px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Search roll, move reason, location, or job"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="h-12 rounded-2xl border-slate-200 bg-white/90 pl-10 shadow-sm"
              />
            </div>
            <Button variant="outline" className="rounded-xl border-slate-200 bg-white/90 shadow-sm" onClick={fetchMovements}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryStatCard label="Visible moves" value={filteredMovements.length.toLocaleString()} subLabel="Current movement rows in view" icon={History} toneClassName="bg-blue-50 text-blue-700" />
        <SummaryStatCard label="Production moves" value={productionMoves.toLocaleString()} subLabel="Moves posted by production outputs" icon={Package} toneClassName="bg-blue-50 text-blue-700" />
        <SummaryStatCard label="Dispatch moves" value={dispatchMoves.toLocaleString()} subLabel="Movements headed to shipment" icon={Truck} toneClassName="bg-amber-50 text-amber-700" />
        <SummaryStatCard label="Route spread" value={movementPlants.size.toLocaleString()} subLabel={newestMove ? `Latest move at ${formatDate(newestMove.timestamp)}` : "No movement data yet"} icon={MapPin} toneClassName="bg-emerald-50 text-emerald-700" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/85 shadow-[0_24px_70px_-45px_rgba(15,23,42,0.45)] backdrop-blur-xl">
          <CardHeader className="border-b border-slate-100/80 bg-white/70">
            <CardTitle className="text-lg font-black tracking-tight text-slate-900">Movement mix</CardTitle>
            <p className="text-sm text-slate-500">Most common reasons driving roll movement in the current view.</p>
          </CardHeader>
          <CardContent className="p-6">
            <ChartSurface className="min-h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={reasonRows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis dataKey="reason" tickFormatter={(value) => humanizeToken(String(value))} tickLine={false} axisLine={false} tick={{ fill: "#64748B", fontSize: 12 }} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: "#64748B", fontSize: 12 }} />
                  <Tooltip formatter={(value: number | string | undefined) => `${Number(value || 0)} moves`} labelFormatter={(label) => humanizeToken(String(label))} />
                  <Bar dataKey="count" radius={[10, 10, 0, 0]} fill="#4F46E5" />
                </BarChart>
              </ResponsiveContainer>
            </ChartSurface>
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/85 shadow-[0_24px_70px_-45px_rgba(15,23,42,0.45)] backdrop-blur-xl">
          <CardHeader className="border-b border-slate-100/80 bg-white/70">
            <CardTitle className="text-lg font-black tracking-tight text-slate-900">Recent movement cards</CardTitle>
            <p className="text-sm text-slate-500">Latest physical transitions with roll, location, and operator context.</p>
          </CardHeader>
          <CardContent className="space-y-3 p-6">
            {filteredMovements.slice(0, 5).map((movement) => (
              <div key={movement.id} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-bold text-slate-900">{movement.roll_label}</div>
                    <div className="mt-1 flex items-center gap-2 text-xs font-medium text-slate-500">
                      <Calendar className="h-3.5 w-3.5" />
                      {formatDate(movement.timestamp)}
                    </div>
                  </div>
                  <SemanticBadge kind="dispatchStatus" value={movement.reason} label={humanizeToken(movement.reason)} />
                </div>
                <div className="mt-3 flex items-center gap-2 text-sm font-medium text-slate-600">
                  <MapPin className="h-4 w-4 text-slate-400" />
                  <span>{movement.from_location_name || "NEW"}</span>
                  <ArrowRight className="h-4 w-4 text-slate-400" />
                  <span className="font-bold text-slate-900">{movement.to_location_name}</span>
                </div>
                {movement.moved_by_name ? (
                  <div className="mt-2 flex items-center gap-2 text-xs font-medium text-slate-500">
                    <User className="h-3.5 w-3.5" />
                    {movement.moved_by_name}
                  </div>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/85 shadow-[0_24px_70px_-45px_rgba(15,23,42,0.45)] backdrop-blur-xl">
        <CardHeader className="border-b border-slate-100/80 bg-white/70">
          <CardTitle className="text-lg font-black tracking-tight text-slate-900">Movement ledger</CardTitle>
          <p className="text-sm text-slate-500">Audit-first list after the summary view, so store and dispatch teams can still inspect every move exactly.</p>
        </CardHeader>
        <CardContent className="p-0">
          {filteredMovements.length === 0 ? (
            <div className="grid min-h-[240px] place-items-center p-10 text-center text-slate-500">
              No movements found for the current filter.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {filteredMovements.map((movement) => (
                <div key={movement.id} className="flex flex-col gap-4 p-5 transition-colors hover:bg-blue-50/20 xl:flex-row xl:items-center xl:justify-between">
                  <div className="flex items-start gap-4">
                    <div className="rounded-2xl border border-blue-100 bg-blue-50 p-3 text-blue-700">
                      <Package className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-base font-black tracking-tight text-slate-900">{movement.roll_label}</div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm font-medium text-slate-600">
                        <MapPin className="h-4 w-4 text-slate-400" />
                        {movement.from_location_name || "NEW"}
                        <ArrowRight className="h-4 w-4 text-slate-400" />
                        <span className="font-bold text-slate-900">{movement.to_location_name}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <SemanticBadge kind="dispatchStatus" value={movement.reason} label={humanizeToken(movement.reason)} />
                    {movement.job_no ? <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">{movement.job_no}</div> : null}
                    <div className="text-xs font-medium text-slate-500">{formatDate(movement.timestamp)}</div>
                    {movement.moved_by_name ? <div className="text-xs font-medium text-slate-500">by {movement.moved_by_name}</div> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
