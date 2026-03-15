"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  ArrowUpDown,
  Box,
  Boxes,
  Factory,
  Package,
  PieChart as PieChartIcon,
  RefreshCw,
  Search,
  ShoppingBag,
  Sparkles,
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
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { ChartSurface } from "@/components/ui-custom/chart-surface"
import { SummaryStatCard } from "@/components/ui-custom/summary-stat-card"
import { SemanticBadge } from "@/components/ui-custom/semantic-badge"
import { inventoryService } from "@/services/inventory"
import { masterDataService } from "@/services/master-data"
import { factoryService } from "@/services/factory"

const COLORS = ["#1d4ed8", "#0f766e", "#7c3aed", "#ea580c", "#dc2626", "#0891b2", "#65a30d"]

function formatQty(value: number, uom?: string) {
  return `${value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3 })} ${uom || "PCS"}`
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value)
}

export default function PackagingInventoryPage() {
  const [materialId, setMaterialId] = useState<string>("__ALL_MATERIALS__")
  const [locationId, setLocationId] = useState<string>("__ALL_LOCATIONS__")
  const [typeFilter, setTypeFilter] = useState<string>("__ALL_TYPES__")
  const [searchQuery, setSearchQuery] = useState("")

  const { data: materials = [] } = useQuery({ queryKey: ["master-packaging"], queryFn: masterDataService.getPackaging })
  const { data: locations = [] } = useQuery({ queryKey: ["factory-locations"], queryFn: factoryService.getLocations })

  const stockQuery = useQuery({
    queryKey: ["packaging-stock", materialId, locationId],
    queryFn: () =>
      inventoryService.getPackagingStock({
        material: materialId === "__ALL_MATERIALS__" ? undefined : materialId,
        location: locationId === "__ALL_LOCATIONS__" ? undefined : locationId,
      }),
  })

  const txQuery = useQuery({
    queryKey: ["packaging-transactions", materialId, locationId, typeFilter],
    queryFn: () =>
      inventoryService.getPackagingTransactions({
        material: materialId === "__ALL_MATERIALS__" ? undefined : materialId,
        location: locationId === "__ALL_LOCATIONS__" ? undefined : locationId,
        type: typeFilter === "__ALL_TYPES__" ? undefined : typeFilter,
      }),
  })

  const stockRows = Array.isArray(stockQuery.data) ? stockQuery.data : []
  const transactionRows = Array.isArray(txQuery.data) ? txQuery.data : []

  const materialMap = useMemo(() => {
    const map = new Map<string, any>()
    for (const row of materials) map.set(String(row.id), row)
    return map
  }, [materials])

  const filteredStock = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return stockRows
    return stockRows.filter((row: any) => {
      const blob = [row.material_name, row.material_code, row.packaging_kind, row.plant_name, row.location_name]
        .map((value) => String(value || "").toLowerCase())
        .join(" ")
      return blob.includes(q)
    })
  }, [stockRows, searchQuery])

  const kpis = useMemo(() => {
    let stockValue = 0
    let stockOnHand = 0
    let inHouseStock = 0
    let purchasedStock = 0
    for (const row of filteredStock) {
      const qty = Number(row.qty || 0)
      stockOnHand += qty
      stockValue += qty * Number(row.avg_cost || 0)
      const material = materialMap.get(String(row.material))
      const supply = String(material?.packaging_supply_mode || "PURCHASED").toUpperCase()
      if (supply === "IN_HOUSE" || supply === "BOTH") inHouseStock += qty
      if (supply === "PURCHASED" || supply === "BOTH") purchasedStock += qty
    }

    let pendingConsumption = 0
    let producedRecent = 0
    for (const tx of transactionRows) {
      const qty = Math.abs(Number(tx.qty || 0))
      if (String(tx.type || "").toUpperCase() === "CONSUME") pendingConsumption += qty
      if (String(tx.type || "").toUpperCase() === "PRODUCE") producedRecent += qty
    }

    return { stockOnHand, stockValue, inHouseStock, purchasedStock, pendingConsumption, producedRecent }
  }, [filteredStock, transactionRows, materialMap])

  const kindData = useMemo(() => {
    const bucket = new Map<string, number>()
    for (const row of filteredStock) {
      const key = String(row.packaging_kind || "OTHER")
      bucket.set(key, (bucket.get(key) || 0) + Number(row.qty || 0))
    }
    return Array.from(bucket.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  }, [filteredStock])

  const plantData = useMemo(() => {
    const bucket = new Map<string, number>()
    for (const row of filteredStock) {
      const key = String(row.plant_name || "Unknown")
      bucket.set(key, (bucket.get(key) || 0) + Number(row.qty || 0))
    }
    return Array.from(bucket.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  }, [filteredStock])

  const txTypeData = useMemo(() => {
    const bucket = new Map<string, number>()
    for (const row of transactionRows) {
      const key = String(row.type || "OTHER")
      bucket.set(key, (bucket.get(key) || 0) + Math.abs(Number(row.qty || 0)))
    }
    return Array.from(bucket.entries()).map(([name, value]) => ({ name, value }))
  }, [transactionRows])

  const stockHighlights = useMemo(() => {
    return filteredStock.slice().sort((a: any, b: any) => Number(b.qty || 0) - Number(a.qty || 0)).slice(0, 5)
  }, [filteredStock])

  return (
    <FactoryPageLayout
      title="Packaging Inventory"
      description="Visual stock and movement control for inner packs, sheets, film, and purchased dispatch consumables."
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      searchPlaceholder="Search packaging material, code, kind, plant, or location"
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link href="/master/packaging">Manage Packaging SKUs</Link>
          </Button>
          <Button variant="outline" onClick={() => { stockQuery.refetch(); txQuery.refetch(); }}>
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        <Card className="border-0 shadow-sm ring-1 ring-slate-100">
          <CardContent className="grid gap-3 p-4 md:grid-cols-4">
            <div>
              <div className="mb-1 text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">Material</div>
              <Select value={materialId} onValueChange={setMaterialId}>
                <SelectTrigger><SelectValue placeholder="All materials" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__ALL_MATERIALS__">All materials</SelectItem>
                  {materials.map((row: any) => (
                    <SelectItem key={row.id} value={String(row.id)}>{row.code} • {row.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <div className="mb-1 text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">Location</div>
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger><SelectValue placeholder="All locations" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__ALL_LOCATIONS__">All locations</SelectItem>
                  {locations.map((row: any) => (
                    <SelectItem key={row.id} value={String(row.id)}>{row.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <div className="mb-1 text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">Tx Type</div>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger><SelectValue placeholder="All types" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__ALL_TYPES__">All types</SelectItem>
                  {['INWARD', 'CONSUME', 'TRANSFER', 'ADJUST', 'PRODUCE'].map((row) => (
                    <SelectItem key={row} value={row}>{row}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <div className="mb-1 text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">Quick Search</div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input className="pl-9" placeholder="Material, kind, plant..." value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} />
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <SummaryStatCard label="Stock On Hand" value={formatQty(kpis.stockOnHand)} subLabel="Across visible packaging SKUs" icon={Package} toneClassName="bg-indigo-50 text-indigo-600" />
          <SummaryStatCard label="In-House Pack" value={formatQty(kpis.inHouseStock)} subLabel="Produced through packaging stock orders" icon={Factory} toneClassName="bg-emerald-50 text-emerald-600" />
          <SummaryStatCard label="Purchased Pack" value={formatQty(kpis.purchasedStock)} subLabel="Vendor-fed dispatch consumables" icon={ShoppingBag} toneClassName="bg-amber-50 text-amber-600" />
          <SummaryStatCard label="Recent Produce" value={formatQty(kpis.producedRecent)} subLabel="Latest visible production transactions" icon={Sparkles} toneClassName="bg-violet-50 text-violet-600" />
          <SummaryStatCard label="Visible Value" value={formatCurrency(kpis.stockValue)} subLabel={`${transactionRows.length} transactions in focus`} icon={Box} toneClassName="bg-rose-50 text-rose-600" />
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <Card className="border-0 shadow-sm ring-1 ring-slate-100">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.18em] text-slate-500">
                <Package className="h-4 w-4 text-indigo-500" /> Stock by Packaging Kind
              </CardTitle>
            </CardHeader>
            <CardContent className="h-[320px]">
              {stockQuery.isLoading ? (
                <div className="grid h-full place-items-center text-sm text-slate-400">Loading kind mix...</div>
              ) : kindData.length === 0 ? (
                <div className="grid h-full place-items-center text-sm text-slate-400">No packaging stock in current filters.</div>
              ) : (
                <ChartSurface>
                  {({ width, height }) => (
                    <BarChart width={width} height={height} data={kindData} margin={{ top: 12, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#64748b" }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#64748b" }} />
                      <Tooltip formatter={(value: number | string | undefined) => [formatQty(Number(value || 0)), "Qty"]} />
                      <Bar dataKey="value" radius={[10, 10, 0, 0]}>
                        {kindData.map((entry, index) => <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />)}
                      </Bar>
                    </BarChart>
                  )}
                </ChartSurface>
              )}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm ring-1 ring-slate-100">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.18em] text-slate-500">
                <PieChartIcon className="h-4 w-4 text-emerald-500" /> Plant Split
              </CardTitle>
            </CardHeader>
            <CardContent className="h-[320px]">
              {stockQuery.isLoading ? (
                <div className="grid h-full place-items-center text-sm text-slate-400">Loading plant split...</div>
              ) : plantData.length === 0 ? (
                <div className="grid h-full place-items-center text-sm text-slate-400">No visible plant split.</div>
              ) : (
                <ChartSurface>
                  {({ width, height }) => (
                    <PieChart width={width} height={height}>
                      <Pie data={plantData} dataKey="value" nameKey="name" innerRadius={70} outerRadius={104} paddingAngle={4}>
                        {plantData.map((entry, index) => <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(value: number | string | undefined) => [formatQty(Number(value || 0)), "Qty"]} />
                    </PieChart>
                  )}
                </ChartSurface>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
          <Card className="border-0 shadow-sm ring-1 ring-slate-100">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.18em] text-slate-500">
                <ArrowUpDown className="h-4 w-4 text-violet-500" /> Movement Mix
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {txTypeData.length === 0 ? (
                <div className="text-sm text-slate-400">No packaging movement rows available.</div>
              ) : txTypeData.map((row) => (
                <div key={row.name} className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <SemanticBadge kind="approval" value={row.name === "PRODUCE" ? "APPROVED" : row.name === "CONSUME" ? "PENDING" : "INFO"} label={row.name.replaceAll("_", " ")} />
                    <div className="text-lg font-black tracking-tight text-slate-900">{formatQty(row.value)}</div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm ring-1 ring-slate-100">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.18em] text-slate-500">
                <Boxes className="h-4 w-4 text-amber-500" /> Largest Packaging Positions
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {stockHighlights.length === 0 ? (
                <div className="text-sm text-slate-400">No packaging stock rows available.</div>
              ) : stockHighlights.map((row: any) => {
                const material = materialMap.get(String(row.material))
                return (
                  <div key={row.id} className="rounded-2xl border border-slate-100 bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-black tracking-tight text-slate-900">{row.material_name}</div>
                        <div className="mt-1 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">{row.material_code}</div>
                      </div>
                      <SemanticBadge kind="packagingKind" value={row.packaging_kind} />
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <SemanticBadge kind="jobState" value={material?.packaging_supply_mode === "IN_HOUSE" ? "READY" : material?.packaging_supply_mode === "BOTH" ? "ASSIGNED" : "PENDING"} label={String(material?.packaging_supply_mode || "PURCHASED").replaceAll("_", " ")} />
                      <SemanticBadge kind="severity" value="INFO" label={`${row.plant_name} • ${row.location_name}`} />
                    </div>
                    <div className="mt-3 flex items-end justify-between gap-3">
                      <div className="text-xl font-black tracking-tight text-slate-900">{formatQty(Number(row.qty || 0), row.base_uom)}</div>
                      <div className="text-sm font-semibold text-emerald-700">{formatCurrency(Number(row.qty || 0) * Number(row.avg_cost || 0))}</div>
                    </div>
                  </div>
                )
              })}
            </CardContent>
          </Card>
        </div>

        <Card className="border-0 shadow-sm ring-1 ring-slate-100">
          <CardHeader className="border-b border-slate-100 pb-4">
            <CardTitle className="text-sm font-black uppercase tracking-[0.18em] text-slate-500">Stock Ledger</CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-slate-50/60 text-left text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">
                <tr>
                  <th className="px-5 py-3">Material</th>
                  <th className="px-5 py-3">Kind / Supply</th>
                  <th className="px-5 py-3">Plant / Location</th>
                  <th className="px-5 py-3 text-right">Qty</th>
                  <th className="px-5 py-3 text-right">Value</th>
                  <th className="px-5 py-3 text-right">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {stockQuery.isLoading ? (
                  Array.from({ length: 6 }).map((_, index) => (
                    <tr key={index}><td className="px-5 py-4" colSpan={6}><Skeleton className="h-10 w-full" /></td></tr>
                  ))
                ) : filteredStock.length === 0 ? (
                  <tr><td colSpan={6} className="px-5 py-10 text-center text-slate-400">No packaging stock found in the current view.</td></tr>
                ) : filteredStock.map((row: any) => {
                  const material = materialMap.get(String(row.material))
                  return (
                    <tr key={row.id} className="hover:bg-slate-50/60">
                      <td className="px-5 py-4">
                        <div className="font-black tracking-tight text-slate-900">{row.material_name}</div>
                        <div className="mt-1 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">{row.material_code}</div>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex flex-wrap gap-2">
                          <SemanticBadge kind="packagingKind" value={row.packaging_kind} />
                          <SemanticBadge kind="jobState" value={material?.packaging_supply_mode === "IN_HOUSE" ? "READY" : material?.packaging_supply_mode === "BOTH" ? "ASSIGNED" : "PENDING"} label={String(material?.packaging_supply_mode || "PURCHASED").replaceAll("_", " ")} />
                        </div>
                      </td>
                      <td className="px-5 py-4 text-slate-600">
                        <div className="font-semibold text-slate-800">{row.plant_name}</div>
                        <div className="text-xs text-slate-500">{row.location_name}</div>
                      </td>
                      <td className="px-5 py-4 text-right font-black tracking-tight text-slate-900">{formatQty(Number(row.qty || 0), row.base_uom)}</td>
                      <td className="px-5 py-4 text-right font-black text-emerald-700">{formatCurrency(Number(row.qty || 0) * Number(row.avg_cost || 0))}</td>
                      <td className="px-5 py-4 text-right text-xs text-slate-500">{new Date(row.updated_at).toLocaleString()}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm ring-1 ring-slate-100">
          <CardHeader className="border-b border-slate-100 pb-4">
            <CardTitle className="text-sm font-black uppercase tracking-[0.18em] text-slate-500">Recent Movements</CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-auto">
            <table className="w-full min-w-[1180px] text-sm">
              <thead className="bg-slate-50/60 text-left text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">
                <tr>
                  <th className="px-5 py-3">Time</th>
                  <th className="px-5 py-3">Type</th>
                  <th className="px-5 py-3">Material</th>
                  <th className="px-5 py-3">Location</th>
                  <th className="px-5 py-3 text-right">Signed Qty</th>
                  <th className="px-5 py-3">Reference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {txQuery.isLoading ? (
                  Array.from({ length: 6 }).map((_, index) => (
                    <tr key={index}><td className="px-5 py-4" colSpan={6}><Skeleton className="h-10 w-full" /></td></tr>
                  ))
                ) : transactionRows.length === 0 ? (
                  <tr><td colSpan={6} className="px-5 py-10 text-center text-slate-400">No packaging transactions found.</td></tr>
                ) : transactionRows.slice(0, 120).map((tx: any) => (
                  <tr key={tx.id} className="hover:bg-slate-50/60">
                    <td className="px-5 py-4 text-xs text-slate-500">{new Date(tx.created_at).toLocaleString()}</td>
                    <td className="px-5 py-4"><SemanticBadge kind="approval" value={String(tx.type || "").toUpperCase() === "PRODUCE" ? "APPROVED" : String(tx.type || "").toUpperCase() === "CONSUME" ? "PENDING" : "INFO"} label={String(tx.type || "").replaceAll("_", " ")} /></td>
                    <td className="px-5 py-4">
                      <div className="font-black tracking-tight text-slate-900">{tx.material_name}</div>
                      <div className="mt-1 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">{tx.material_code}</div>
                    </td>
                    <td className="px-5 py-4 text-slate-600">{tx.location_name || "-"}</td>
                    <td className="px-5 py-4 text-right font-black tracking-tight text-slate-900">{formatQty(Number(tx.qty || 0), tx.base_uom)}</td>
                    <td className="px-5 py-4 text-xs text-slate-500">{tx.reference || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </FactoryPageLayout>
  )
}
