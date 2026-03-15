"use client"

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  BarChart3,
  Boxes,
  Coins,
  Database,
  Landmark,
  Layers3,
  MapPin,
  Package,
  Scale,
  Search,
} from "lucide-react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { FactoryPageLayout } from "@/components/factory/FactoryPageLayout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { ChartSurface } from "@/components/ui-custom/chart-surface"
import { SummaryStatCard } from "@/components/ui-custom/summary-stat-card"
import { SemanticBadge } from "@/components/ui-custom/semantic-badge"
import { inventoryService, type InventoryBulk } from "@/services/inventory"

const CHART_COLORS = ["#0f766e", "#1d4ed8", "#7c3aed", "#ea580c", "#dc2626", "#0891b2"]

function formatKg(value: number) {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1, minimumFractionDigits: 1 })} kg`
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value)
}

export default function BulkInventoryPage() {
  const [searchQuery, setSearchQuery] = useState("")

  const { data: bulkStock = [], isLoading } = useQuery({
    queryKey: ["bulk-stock"],
    queryFn: () => inventoryService.getBulkStock(),
  })

  const filteredStock = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return bulkStock
    return bulkStock.filter((item) => {
      const blob = [item.material_name, item.material_code, item.material_category, item.plant_name, item.location_name]
        .map((value) => String(value || "").toLowerCase())
        .join(" ")
      return blob.includes(q)
    })
  }, [bulkStock, searchQuery])

  const totals = useMemo(() => {
    return filteredStock.reduce(
      (acc, item) => {
        const qty = Number(item.qty_kg || 0)
        const avgCost = Number(item.avg_cost || 0)
        acc.weightKg += qty
        acc.value += qty * avgCost
        acc.nodes += 1
        acc.plants.add(item.plant_name || "Unknown")
        return acc
      },
      { weightKg: 0, value: 0, nodes: 0, plants: new Set<string>() },
    )
  }, [filteredStock])

  const categoryData = useMemo(() => {
    const bucket = new Map<string, { name: string; value: number }>()
    for (const row of filteredStock) {
      const key = String(row.material_category || "OTHER").toUpperCase()
      const current = bucket.get(key) || { name: key.replaceAll("_", " "), value: 0 }
      current.value += Number(row.qty_kg || 0)
      bucket.set(key, current)
    }
    return Array.from(bucket.values()).sort((a, b) => b.value - a.value)
  }, [filteredStock])

  const plantData = useMemo(() => {
    const bucket = new Map<string, { name: string; value: number }>()
    for (const row of filteredStock) {
      const key = String(row.plant_name || "Unknown")
      const current = bucket.get(key) || { name: key, value: 0 }
      current.value += Number(row.qty_kg || 0)
      bucket.set(key, current)
    }
    return Array.from(bucket.values()).sort((a, b) => b.value - a.value).slice(0, 6)
  }, [filteredStock])

  const locationData = useMemo(() => {
    const bucket = new Map<string, { name: string; value: number }>()
    for (const row of filteredStock) {
      const key = `${row.plant_name || "Unknown"} • ${row.location_name || "No location"}`
      const current = bucket.get(key) || { name: key, value: 0 }
      current.value += Number(row.qty_kg || 0)
      bucket.set(key, current)
    }
    return Array.from(bucket.values()).sort((a, b) => b.value - a.value).slice(0, 8)
  }, [filteredStock])

  const ageBands = useMemo(() => {
    const now = Date.now()
    const bands = {
      Fresh: 0,
      Watch: 0,
      Aged: 0,
    }
    for (const row of filteredStock) {
      const updatedAt = new Date(row.updated_at).getTime()
      const days = Number.isFinite(updatedAt) ? (now - updatedAt) / (1000 * 60 * 60 * 24) : 0
      const qty = Number(row.qty_kg || 0)
      if (days <= 7) bands.Fresh += qty
      else if (days <= 30) bands.Watch += qty
      else bands.Aged += qty
    }
    return Object.entries(bands).map(([name, value]) => ({ name, value }))
  }, [filteredStock])

  const heroHighlights = useMemo(() => {
    return filteredStock
      .slice()
      .sort((a, b) => Number(b.qty_kg || 0) - Number(a.qty_kg || 0))
      .slice(0, 4)
  }, [filteredStock])

  return (
    <FactoryPageLayout
      title="Bulk Inventory"
      description="Visual control room for pooled raw materials, value, freshness, and plant allocation."
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      searchPlaceholder="Search material, code, category, plant, or location"
    >
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SummaryStatCard
            label="Material Nodes"
            value={totals.nodes}
            subLabel={`${totals.plants.size} plants in current view`}
            icon={Database}
            toneClassName="bg-indigo-50 text-indigo-600"
          />
          <SummaryStatCard
            label="Stock On Hand"
            value={formatKg(totals.weightKg)}
            subLabel="Actual pooled material mass"
            icon={Scale}
            toneClassName="bg-emerald-50 text-emerald-600"
          />
          <SummaryStatCard
            label="Inventory Value"
            value={formatCurrency(totals.value)}
            subLabel="Weighted by moving average cost"
            icon={Coins}
            toneClassName="bg-amber-50 text-amber-600"
          />
          <SummaryStatCard
            label="Coverage Mix"
            value={`${categoryData.length} categories`}
            subLabel={categoryData[0] ? `${categoryData[0].name} is the largest bucket` : "No category distribution yet"}
            icon={Layers3}
            toneClassName="bg-violet-50 text-violet-600"
          />
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
          <Card className="border-0 shadow-sm ring-1 ring-slate-100">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.18em] text-slate-500">
                <BarChart3 className="h-4 w-4 text-indigo-500" /> Category Mass Split
              </CardTitle>
            </CardHeader>
            <CardContent className="h-[320px]">
              {isLoading ? (
                <div className="grid h-full place-items-center text-sm text-slate-400">Loading category mix...</div>
              ) : categoryData.length === 0 ? (
                <div className="grid h-full place-items-center text-sm text-slate-400">No stock in the current filter set.</div>
              ) : (
                <ChartSurface>
                  {({ width, height }) => (
                      <BarChart width={width} height={height} data={categoryData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} tickFormatter={(value) => `${Math.round(Number(value || 0))}`} />
                        <Tooltip formatter={(value: number | string | undefined) => [formatKg(Number(value || 0)), "Mass"]} />
                        <Bar dataKey="value" radius={[10, 10, 0, 0]}>
                          {categoryData.map((entry, index) => (
                            <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    )
                  }
                </ChartSurface>
              )}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm ring-1 ring-slate-100">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.18em] text-slate-500">
                <MapPin className="h-4 w-4 text-emerald-500" /> Plant Allocation
              </CardTitle>
            </CardHeader>
            <CardContent className="h-[320px]">
              {isLoading ? (
                <div className="grid h-full place-items-center text-sm text-slate-400">Loading plant mix...</div>
              ) : plantData.length === 0 ? (
                <div className="grid h-full place-items-center text-sm text-slate-400">No plant allocation data.</div>
              ) : (
                <ChartSurface>
                  {({ width, height }) => (
                    <PieChart width={width} height={height}>
                      <Pie data={plantData} dataKey="value" nameKey="name" innerRadius={70} outerRadius={105} paddingAngle={4}>
                        {plantData.map((entry, index) => (
                          <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value: number | string | undefined) => [formatKg(Number(value || 0)), "Mass"]} />
                    </PieChart>
                  )}
                </ChartSurface>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1fr_1fr_1fr]">
          <Card className="border-0 shadow-sm ring-1 ring-slate-100">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.18em] text-slate-500">
                <Landmark className="h-4 w-4 text-sky-500" /> Top Storage Nodes
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {locationData.length === 0 ? (
                <div className="text-sm text-slate-400">No location split available.</div>
              ) : locationData.map((item, index) => (
                <div key={item.name} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 text-sm font-bold text-slate-800">{item.name}</div>
                    <SemanticBadge kind="severity" value={index === 0 ? "LOW" : "INFO"} label={formatKg(item.value)} />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm ring-1 ring-slate-100">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.18em] text-slate-500">
                <Boxes className="h-4 w-4 text-violet-500" /> Freshness Bands
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {ageBands.map((band, index) => (
                <div key={band.name} className="rounded-2xl border border-slate-100 bg-white p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">{band.name}</div>
                      <div className="mt-1 text-lg font-black tracking-tight text-slate-900">{formatKg(band.value)}</div>
                    </div>
                    <div className="h-12 w-12 rounded-2xl" style={{ backgroundColor: `${CHART_COLORS[index % CHART_COLORS.length]}22` }} />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm ring-1 ring-slate-100">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.18em] text-slate-500">
                <Package className="h-4 w-4 text-amber-500" /> Largest Material Positions
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {heroHighlights.length === 0 ? (
                <div className="text-sm text-slate-400">No material positions found.</div>
              ) : heroHighlights.map((row) => (
                <div key={row.id} className="rounded-2xl border border-slate-100 bg-white p-4">
                  <div className="text-sm font-black tracking-tight text-slate-900">{row.material_name}</div>
                  <div className="mt-1 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">{row.material_code}</div>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <SemanticBadge kind="materialCategory" value={row.material_category} />
                    <div className="text-right">
                      <div className="text-lg font-black tracking-tight text-slate-900">{formatKg(Number(row.qty_kg || 0))}</div>
                      <div className="text-xs text-slate-500">{row.plant_name} • {row.location_name}</div>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <Card className="border-0 shadow-sm ring-1 ring-slate-100">
          <CardHeader className="border-b border-slate-100 pb-4">
            <CardTitle className="flex items-center justify-between gap-3 text-sm font-black uppercase tracking-[0.18em] text-slate-500">
              <span className="flex items-center gap-2"><Search className="h-4 w-4 text-indigo-500" /> Bulk Ledger</span>
              <span className="text-[11px] text-slate-400">Material identity, plant node, quantity, cost, and last refresh.</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-auto">
            <table className="min-w-[1080px] w-full text-sm">
              <thead className="bg-slate-50/70 text-left text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">
                <tr>
                  <th className="px-5 py-3">Material</th>
                  <th className="px-5 py-3">Category</th>
                  <th className="px-5 py-3">Plant / Location</th>
                  <th className="px-5 py-3 text-right">Quantity</th>
                  <th className="px-5 py-3 text-right">Moving Avg Cost</th>
                  <th className="px-5 py-3 text-right">Inventory Value</th>
                  <th className="px-5 py-3 text-right">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {isLoading ? (
                  Array.from({ length: 6 }).map((_, index) => (
                    <tr key={index}>
                      <td className="px-5 py-4" colSpan={7}><Skeleton className="h-10 w-full" /></td>
                    </tr>
                  ))
                ) : filteredStock.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-10 text-center text-slate-400">No bulk material matches the current search.</td>
                  </tr>
                ) : (
                  filteredStock.map((row: InventoryBulk) => {
                    const qty = Number(row.qty_kg || 0)
                    const avgCost = Number(row.avg_cost || 0)
                    return (
                      <tr key={row.id} className="hover:bg-slate-50/60">
                        <td className="px-5 py-4">
                          <div className="font-black tracking-tight text-slate-900">{row.material_name}</div>
                          <div className="mt-1 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">{row.material_code}</div>
                        </td>
                        <td className="px-5 py-4"><SemanticBadge kind="materialCategory" value={row.material_category} /></td>
                        <td className="px-5 py-4 text-slate-600">
                          <div className="font-semibold text-slate-800">{row.plant_name}</div>
                          <div className="text-xs text-slate-500">{row.location_name}</div>
                        </td>
                        <td className="px-5 py-4 text-right font-black tracking-tight text-slate-900">{formatKg(qty)}</td>
                        <td className="px-5 py-4 text-right font-semibold text-slate-700">{formatCurrency(avgCost)}</td>
                        <td className="px-5 py-4 text-right font-black text-emerald-700">{formatCurrency(qty * avgCost)}</td>
                        <td className="px-5 py-4 text-right text-xs text-slate-500">{new Date(row.updated_at).toLocaleString()}</td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </FactoryPageLayout>
  )
}
