"use client"

import { useMemo, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Activity,
  AlertTriangle,
  Archive,
  Boxes,
  CalendarDays,
  CheckCircle2,
  Edit3,
  Layers3,
  Package,
  RefreshCw,
  Search,
  ShieldCheck,
  TableProperties,
  Thermometer,
  Warehouse,
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
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ChartSurface } from "@/components/ui-custom/chart-surface"
import { SemanticBadge } from "@/components/ui-custom/semantic-badge"
import { SummaryStatCard } from "@/components/ui-custom/summary-stat-card"
import { factoryService } from "@/services/factory"
import { inventoryService, type GrnHistoryRow, type InventoryBulk, type PackagingStockRow, type PackagingTransactionRow } from "@/services/inventory"
import { masterDataService } from "@/services/master-data"
import { getRollsByVariant, type RollExplorerRow } from "@/services/rolls"
import { cn } from "@/lib/utils"

type WorkspaceTab = "rolls" | "bulk" | "packaging" | "grn"
type InnerTab = "pulse" | "browse"
type ViewMode = "table" | "cards"

const CHART_COLORS = ["#0f766e", "#2563eb", "#7c3aed", "#ea580c", "#dc2626", "#0891b2", "#65a30d", "#475569"]

function num(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatKg(value: number) {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg`
}

function formatQty(value: number, uom = "PCS") {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${uom}`
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value)
}

function ageDays(date?: string | null) {
  if (!date) return 0
  const ts = new Date(date).getTime()
  if (!Number.isFinite(ts)) return 0
  return Math.max(0, Math.floor((Date.now() - ts) / 86400000))
}

function ageBand(date?: string | null) {
  const days = ageDays(date)
  if (days <= 7) return "Fresh"
  if (days <= 30) return "Watch"
  return "Aged"
}

function includesText(values: unknown[], search: string) {
  if (!search) return true
  const q = search.toLowerCase()
  return values.map((value) => String(value || "").toLowerCase()).join(" ").includes(q)
}

function groupSum<T>(rows: T[], keyFn: (row: T) => string, valueFn: (row: T) => number, limit = 8) {
  const bucket = new Map<string, number>()
  for (const row of rows) {
    const key = keyFn(row) || "Unknown"
    bucket.set(key, (bucket.get(key) || 0) + valueFn(row))
  }
  return Array.from(bucket.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit)
}

export function InventoryWorkspaceShell() {
  const router = useRouter()
  const pathname = usePathname() || "/inventory"
  const readonlySearchParams = useSearchParams()
  const searchParams = readonlySearchParams ?? new URLSearchParams()
  const qc = useQueryClient()

  const routeDefaultTab: WorkspaceTab = pathname.includes("/inventory/bulk")
    ? "bulk"
    : pathname.includes("/inventory/packaging")
      ? "packaging"
      : pathname.includes("/inventory/roll-explorer")
        ? "rolls"
        : "rolls"
  const tab = normalizeTab(searchParams.get("tab"), routeDefaultTab)
  const inner = normalizeInner(searchParams.get("view"))
  const mode = normalizeMode(searchParams.get("mode"))
  const search = searchParams.get("q") || ""
  const plant = searchParams.get("plant") || "ALL"
  const location = searchParams.get("location") || "ALL"
  const status = searchParams.get("status") || "ALL"
  const material = searchParams.get("material") || "ALL"
  const category = searchParams.get("category") || "ALL"
  const sourceType = searchParams.get("source_type") || "ALL"
  const age = searchParams.get("age") || "ALL"

  function setParam(updates: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(updates)) {
      if (!value || value === "ALL") next.delete(key)
      else next.set(key, value)
    }
    router.replace(`${pathname}?${next.toString()}`, { scroll: false })
  }

  const { data: plants = [] } = useQuery({ queryKey: ["inventory-workspace-plants"], queryFn: factoryService.getPlants })
  const { data: allLocations = [] } = useQuery({ queryKey: ["inventory-workspace-locations"], queryFn: factoryService.getLocations })
  const { data: packagingMaterials = [] } = useQuery({ queryKey: ["inventory-workspace-packaging-master"], queryFn: masterDataService.getPackaging })

  const rollsQuery = useQuery({
    queryKey: ["inventory-workspace-rolls", plant, status, material, location],
    queryFn: () =>
      getRollsByVariant({
        plant: plant !== "ALL" ? plant : undefined,
        status: status !== "ALL" ? status : "AVAILABLE,RESERVED,IN_PROCESS,SENT_JOBWORK",
        material: material !== "ALL" ? material : undefined,
        location: location !== "ALL" ? location : undefined,
      }),
    enabled: tab === "rolls",
    staleTime: 30000,
  })
  const bulkQuery = useQuery({
    queryKey: ["inventory-workspace-bulk", plant, material],
    queryFn: () => inventoryService.getBulkStock({ plant: plant !== "ALL" ? plant : undefined, material: material !== "ALL" ? material : undefined }),
    enabled: tab === "bulk",
    staleTime: 30000,
  })
  const packagingQuery = useQuery({
    queryKey: ["inventory-workspace-packaging", plant, material, location],
    queryFn: () => inventoryService.getPackagingStock({ plant: plant !== "ALL" ? plant : undefined, material: material !== "ALL" ? material : undefined, location: location !== "ALL" ? location : undefined }),
    enabled: tab === "packaging",
    staleTime: 30000,
  })
  const packagingTxQuery = useQuery({
    queryKey: ["inventory-workspace-packaging-tx", material, location],
    queryFn: () => inventoryService.getPackagingTransactions({ material: material !== "ALL" ? material : undefined, location: location !== "ALL" ? location : undefined }),
    enabled: tab === "packaging",
    staleTime: 30000,
  })
  const grnQuery = useQuery({
    queryKey: ["inventory-workspace-grn", sourceType, search, material, plant, location],
    queryFn: () =>
      inventoryService.getGrnHistory({
        source_type: sourceType !== "ALL" ? sourceType : undefined,
        search: search || undefined,
        material: material !== "ALL" ? material : undefined,
        plant: plant !== "ALL" ? plant : undefined,
        location: location !== "ALL" ? location : undefined,
      }),
    enabled: tab === "grn",
    staleTime: 15000,
  })

  function refreshWorkspace() {
    qc.invalidateQueries({ queryKey: ["inventory-workspace-rolls"] })
    qc.invalidateQueries({ queryKey: ["inventory-workspace-bulk"] })
    qc.invalidateQueries({ queryKey: ["inventory-workspace-packaging"] })
    qc.invalidateQueries({ queryKey: ["inventory-workspace-packaging-tx"] })
    qc.invalidateQueries({ queryKey: ["inventory-workspace-grn"] })
  }

  const rollRows = useMemo(() => {
    const rows = (rollsQuery.data?.families || []).flatMap((family) => family.variants.flatMap((variant) => variant.rolls || []))
    return rows.filter((row) => {
      if (age !== "ALL" && ageBand(row.created_at) !== age) return false
      return includesText([
        row.label_id,
        row.family_display_name,
        row.variant_display_name,
        row.material_name,
        row.grade_name,
        row.location_name,
        row.plant_name,
        row.status,
        row.stage_name,
        row.created_job_number,
      ], search)
    })
  }, [rollsQuery.data, search, age])

  const bulkRows = useMemo(() => {
    return ((bulkQuery.data || []) as InventoryBulk[]).filter((row) => {
      if (category !== "ALL" && String(row.material_category || "").toUpperCase() !== category) return false
      if (location !== "ALL" && String(row.location) !== location) return false
      if (age !== "ALL" && ageBand(row.updated_at) !== age) return false
      return includesText([row.material_name, row.material_code, row.material_category, row.granule_quality_code, row.plant_name, row.location_name], search)
    })
  }, [bulkQuery.data, category, location, search, age])

  const packagingRows = useMemo(() => {
    return ((packagingQuery.data || []) as PackagingStockRow[]).filter((row) => {
      if (category !== "ALL" && String(row.packaging_kind || "").toUpperCase() !== category) return false
      if (age !== "ALL" && ageBand(row.updated_at) !== age) return false
      return includesText([row.material_name, row.material_code, row.packaging_kind, row.plant_name, row.location_name], search)
    })
  }, [packagingQuery.data, category, search, age])

  const packagingTxRows = (packagingTxQuery.data || []) as PackagingTransactionRow[]
  const grnRows = (grnQuery.data || []) as GrnHistoryRow[]

  return (
    <div className="space-y-5 pb-10">
      <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-[11px] font-black uppercase tracking-[0.2em] text-emerald-700">
              <Warehouse className="h-3.5 w-3.5" />
              Inventory Command
            </div>
            <div>
              <h1 className="text-3xl font-black tracking-tight text-slate-950">Unified Inventory Workspace</h1>
              <p className="mt-1 max-w-3xl text-sm font-medium leading-6 text-slate-600">
                One fast surface for roll truth, bulk material pools, packaging stock, and auditable inward corrections.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={refreshWorkspace}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            <Button className="bg-slate-950 hover:bg-slate-800" onClick={() => setParam({ tab: "grn" })}>
              <ShieldCheck className="mr-2 h-4 w-4" />
              GRN History
            </Button>
          </div>
        </div>
      </section>

      <Tabs value={tab} onValueChange={(value) => setParam({ tab: value, view: "pulse" })} className="space-y-4">
        <div className="flex flex-col gap-3 rounded-[20px] border border-slate-200 bg-white p-3 shadow-sm xl:flex-row xl:items-center xl:justify-between">
          <TabsList className="grid h-auto grid-cols-2 gap-1 bg-slate-100 p-1 md:grid-cols-4">
            <TabsTrigger value="rolls" className="gap-2 rounded-xl py-2 font-bold"><Archive className="h-4 w-4" /> Rolls</TabsTrigger>
            <TabsTrigger value="bulk" className="gap-2 rounded-xl py-2 font-bold"><Boxes className="h-4 w-4" /> Bulk</TabsTrigger>
            <TabsTrigger value="packaging" className="gap-2 rounded-xl py-2 font-bold"><Package className="h-4 w-4" /> Packaging</TabsTrigger>
            <TabsTrigger value="grn" className="gap-2 rounded-xl py-2 font-bold"><ShieldCheck className="h-4 w-4" /> GRN History</TabsTrigger>
          </TabsList>
          <InventoryFilterBar
            tab={tab}
            search={search}
            plant={plant}
            location={location}
            status={status}
            material={material}
            category={category}
            sourceType={sourceType}
            age={age}
            plants={plants as any[]}
            locations={allLocations as any[]}
            packagingMaterials={packagingMaterials as any[]}
            onChange={setParam}
          />
        </div>

        <TabsContent value="rolls" className="space-y-4">
          <StockTabHeader inner={inner} mode={mode} onChange={setParam} showCards />
          {inner === "pulse" ? <InventoryPulsePanel kind="rolls" rows={rollRows} loading={rollsQuery.isLoading} /> : <InventoryBrowseTable kind="rolls" rows={rollRows} mode={mode} />}
        </TabsContent>
        <TabsContent value="bulk" className="space-y-4">
          <StockTabHeader inner={inner} mode={mode} onChange={setParam} showCards />
          {inner === "pulse" ? <InventoryPulsePanel kind="bulk" rows={bulkRows} loading={bulkQuery.isLoading} /> : <InventoryBrowseTable kind="bulk" rows={bulkRows} mode={mode} />}
        </TabsContent>
        <TabsContent value="packaging" className="space-y-4">
          <StockTabHeader inner={inner} mode={mode} onChange={setParam} showCards />
          {inner === "pulse" ? (
            <InventoryPulsePanel kind="packaging" rows={packagingRows} txRows={packagingTxRows} loading={packagingQuery.isLoading} packagingMaterials={packagingMaterials as any[]} />
          ) : (
            <InventoryBrowseTable kind="packaging" rows={packagingRows} mode={mode} packagingMaterials={packagingMaterials as any[]} />
          )}
        </TabsContent>
        <TabsContent value="grn">
          <GrnHistoryTab rows={grnRows} loading={grnQuery.isLoading} onChanged={() => {
            grnQuery.refetch()
            qc.invalidateQueries({ queryKey: ["inventory-workspace-bulk"] })
            qc.invalidateQueries({ queryKey: ["inventory-workspace-packaging"] })
            qc.invalidateQueries({ queryKey: ["inventory-workspace-rolls"] })
          }} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function normalizeTab(value: string | null, fallback: WorkspaceTab = "rolls"): WorkspaceTab {
  if (value === "bulk" || value === "packaging" || value === "grn") return value
  return fallback
}

function normalizeInner(value: string | null): InnerTab {
  return value === "browse" ? "browse" : "pulse"
}

function normalizeMode(value: string | null): ViewMode {
  return value === "cards" ? "cards" : "table"
}

export function InventoryFilterBar({
  tab,
  search,
  plant,
  location,
  status,
  material,
  category,
  sourceType,
  age,
  plants,
  locations,
  packagingMaterials,
  onChange,
}: {
  tab: WorkspaceTab
  search: string
  plant: string
  location: string
  status: string
  material: string
  category: string
  sourceType: string
  age: string
  plants: any[]
  locations: any[]
  packagingMaterials: any[]
  onChange: (updates: Record<string, string | null>) => void
}) {
  const activeLocations = locations.filter((row) => plant === "ALL" || String(row.plant) === plant)
  const categoryOptions = tab === "packaging"
    ? ["INNER_POUCH", "GONNY", "TAPE", "SHEET", "BOX", "LABEL", "TAG", "OTHER"]
    : ["GRANULE", "INK", "ADHESIVE", "SOLVENT", "POD", "OTHER"]

  return (
    <div className="flex flex-1 flex-wrap items-center gap-2 xl:justify-end">
      <div className="relative min-w-[240px] flex-1 xl:max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input value={search} onChange={(event) => onChange({ q: event.target.value || null })} className="h-10 rounded-xl pl-9" placeholder="Search material, label, vendor, ref..." />
      </div>
      {tab === "grn" ? (
        <FilterSelect value={sourceType} onChange={(value) => onChange({ source_type: value })} options={["ALL", "ROLL", "BULK", "PACKAGING"]} label="Source" />
      ) : null}
      {tab === "rolls" ? (
        <FilterSelect value={status} onChange={(value) => onChange({ status: value })} options={["ALL", "AVAILABLE", "RESERVED", "IN_PROCESS", "SENT_JOBWORK"]} label="Status" />
      ) : null}
      {tab === "bulk" || tab === "packaging" ? (
        <FilterSelect value={category} onChange={(value) => onChange({ category: value })} options={["ALL", ...categoryOptions]} label={tab === "bulk" ? "Category" : "Kind"} />
      ) : null}
      {tab === "packaging" ? (
        <Select value={material} onValueChange={(value) => onChange({ material: value })}>
          <SelectTrigger className="h-10 w-[180px] rounded-xl"><SelectValue placeholder="SKU" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All SKUs</SelectItem>
            {packagingMaterials.map((row) => <SelectItem key={row.id} value={String(row.id)}>{row.code} - {row.name}</SelectItem>)}
          </SelectContent>
        </Select>
      ) : null}
      <FilterSelect value={age} onChange={(value) => onChange({ age: value })} options={["ALL", "Fresh", "Watch", "Aged"]} label="Age" />
      <Select value={plant} onValueChange={(value) => onChange({ plant: value, location: null })}>
        <SelectTrigger className="h-10 w-[150px] rounded-xl"><SelectValue placeholder="Plant" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">All plants</SelectItem>
          {plants.map((row) => <SelectItem key={row.id} value={String(row.id)}>{row.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={location} onValueChange={(value) => onChange({ location: value })}>
        <SelectTrigger className="h-10 w-[160px] rounded-xl"><SelectValue placeholder="Location" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">All locations</SelectItem>
          {activeLocations.map((row) => <SelectItem key={row.id} value={String(row.id)}>{row.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button variant="outline" className="h-10 rounded-xl" onClick={() => onChange({ q: null, plant: null, location: null, status: null, material: null, category: null, source_type: null, age: null })}>
        Reset
      </Button>
    </div>
  )
}

function FilterSelect({ value, onChange, options, label }: { value: string; onChange: (value: string) => void; options: string[]; label: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-10 w-[145px] rounded-xl"><SelectValue placeholder={label} /></SelectTrigger>
      <SelectContent>
        {options.map((option) => <SelectItem key={option} value={option}>{option === "ALL" ? `All ${label}` : option.replaceAll("_", " ")}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}

function StockTabHeader({ inner, mode, onChange, showCards }: { inner: InnerTab; mode: ViewMode; onChange: (updates: Record<string, string | null>) => void; showCards?: boolean }) {
  return (
    <div className="flex flex-col gap-3 rounded-[18px] border border-slate-200 bg-white p-3 shadow-sm md:flex-row md:items-center md:justify-between">
      <Tabs value={inner} onValueChange={(value) => onChange({ view: value })}>
        <TabsList className="bg-slate-100">
          <TabsTrigger value="pulse" className="gap-2 font-bold"><Activity className="h-4 w-4" /> Pulse</TabsTrigger>
          <TabsTrigger value="browse" className="gap-2 font-bold"><TableProperties className="h-4 w-4" /> Browse</TabsTrigger>
        </TabsList>
      </Tabs>
      {inner === "browse" && showCards ? (
        <Tabs value={mode} onValueChange={(value) => onChange({ mode: value })}>
          <TabsList className="bg-slate-100">
            <TabsTrigger value="table">Table</TabsTrigger>
            <TabsTrigger value="cards">Cards</TabsTrigger>
          </TabsList>
        </Tabs>
      ) : null}
    </div>
  )
}

export function InventoryPulsePanel({ kind, rows, txRows = [], loading, packagingMaterials = [] }: { kind: "rolls" | "bulk" | "packaging"; rows: any[]; txRows?: PackagingTransactionRow[]; loading?: boolean; packagingMaterials?: any[] }) {
  const metrics = useMemo(() => {
    if (kind === "rolls") {
      const totalKg = rows.reduce((sum, row) => sum + num(row.weight_kg), 0)
      const reserved = rows.filter((row) => String(row.status).toUpperCase() === "RESERVED").reduce((sum, row) => sum + num(row.weight_kg), 0)
      return { count: rows.length, totalKg, reserved, value: 0, aged: rows.filter((row) => ageBand(row.created_at) === "Aged").length }
    }
    if (kind === "bulk") {
      const totalKg = rows.reduce((sum, row) => sum + num(row.qty_kg), 0)
      const value = rows.reduce((sum, row) => sum + num(row.qty_kg) * num(row.avg_cost), 0)
      return { count: rows.length, totalKg, reserved: 0, value, aged: rows.filter((row) => ageBand(row.updated_at) === "Aged").length }
    }
    const totalQty = rows.reduce((sum, row) => sum + num(row.qty), 0)
    const value = rows.reduce((sum, row) => sum + num(row.qty) * num(row.avg_cost), 0)
    return { count: rows.length, totalKg: totalQty, reserved: 0, value, aged: rows.filter((row) => ageBand(row.updated_at) === "Aged").length }
  }, [kind, rows])

  const massByMain = useMemo(() => {
    if (kind === "rolls") return groupSum(rows, (row) => row.family_display_name || row.material_name || "Rolls", (row) => num(row.weight_kg))
    if (kind === "bulk") return groupSum(rows, (row) => row.material_category || "OTHER", (row) => num(row.qty_kg))
    return groupSum(rows, (row) => row.packaging_kind || "OTHER", (row) => num(row.qty))
  }, [kind, rows])
  const plantData = useMemo(() => groupSum(rows, (row) => row.plant_name || "Unknown", (row) => kind === "packaging" ? num(row.qty) : kind === "bulk" ? num(row.qty_kg) : num(row.weight_kg)), [kind, rows])
  const ageData = useMemo(() => groupSum(rows, (row) => ageBand(row.created_at || row.updated_at), (row) => kind === "packaging" ? num(row.qty) : kind === "bulk" ? num(row.qty_kg) : num(row.weight_kg), 3), [kind, rows])
  const txData = useMemo(() => groupSum(txRows, (row) => row.type || "OTHER", (row) => Math.abs(num(row.qty))), [txRows])

  if (loading) return <div className="rounded-[24px] border border-slate-200 bg-white p-8 text-sm text-slate-500">Loading inventory pulse...</div>

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <SummaryStatCard label={kind === "rolls" ? "Rolls" : "Stock Nodes"} value={metrics.count} subLabel="Visible rows" icon={Layers3} toneClassName="bg-indigo-50 text-indigo-600" />
        <SummaryStatCard label={kind === "packaging" ? "On Hand Qty" : "On Hand KG"} value={kind === "packaging" ? formatQty(metrics.totalKg) : formatKg(metrics.totalKg)} subLabel="Filtered stock position" icon={Warehouse} toneClassName="bg-emerald-50 text-emerald-600" />
        <SummaryStatCard label="Reserved / Locked" value={kind === "rolls" ? formatKg(metrics.reserved) : "-"} subLabel={kind === "rolls" ? "Reserved roll mass" : "No lock column in v1"} icon={ShieldCheck} toneClassName="bg-amber-50 text-amber-600" />
        <SummaryStatCard label="Visible Value" value={kind === "rolls" ? "-" : formatMoney(metrics.value)} subLabel="Based on avg cost" icon={Package} toneClassName="bg-violet-50 text-violet-600" />
        <SummaryStatCard label="Aged Lines" value={metrics.aged} subLabel="More than 30 days" icon={AlertTriangle} toneClassName="bg-rose-50 text-rose-600" />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard title={kind === "rolls" ? "Variant / Family KG" : kind === "bulk" ? "Category Mass Split" : "Stock By Packaging Kind"} data={massByMain} chart="bar" />
        <ChartCard title="Plant Allocation" data={plantData} chart="donut" />
        <ChartCard title="Freshness Bands" data={ageData} chart="bar" />
        <InventoryHeatmap kind={kind} rows={rows} packagingMaterials={packagingMaterials} />
      </div>
      {kind === "packaging" ? <ChartCard title="Packaging Movement Mix" data={txData} chart="bar" /> : null}
    </div>
  )
}

function ChartCard({ title, data, chart }: { title: string; data: Array<{ name: string; value: number }>; chart: "bar" | "donut" }) {
  return (
    <Card className="rounded-[22px] border-slate-200 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-500">
          <Activity className="h-4 w-4 text-emerald-600" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="h-[300px]">
        {data.length === 0 ? <div className="grid h-full place-items-center text-sm text-slate-400">No data in current filters.</div> : (
          <ChartSurface>
            {({ width, height }) => chart === "bar" ? (
              <BarChart width={width} height={height} data={data} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#64748b" }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#64748b" }} />
                <Tooltip formatter={(value: number | string | undefined) => [Number(value || 0).toLocaleString(), "Qty"]} />
                <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                  {data.map((entry, index) => <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
                </Bar>
              </BarChart>
            ) : (
              <PieChart width={width} height={height}>
                <Pie data={data} dataKey="value" nameKey="name" innerRadius={60} outerRadius={100} paddingAngle={2}>
                  {data.map((entry, index) => <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(value: number | string | undefined) => [Number(value || 0).toLocaleString(), "Qty"]} />
              </PieChart>
            )}
          </ChartSurface>
        )}
      </CardContent>
    </Card>
  )
}

export function InventoryHeatmap({ kind, rows }: { kind: "rolls" | "bulk" | "packaging"; rows: any[]; packagingMaterials?: any[] }) {
  const matrix = useMemo(() => {
    const map = new Map<string, Map<string, number>>()
    for (const row of rows) {
      const label = kind === "rolls" ? (row.family_display_name || row.material_name || "Roll") : (row.material_name || "Material")
      const col = kind === "rolls"
        ? `${Math.round(num(row.width_mm))}mm x ${Math.round(num(row.thickness_micron))}u`
        : kind === "bulk"
          ? String(row.granule_quality_code || row.material_category || "Stock")
          : String(row.packaging_kind || "Packaging")
      const value = kind === "packaging" ? num(row.qty) : kind === "bulk" ? num(row.qty_kg) : num(row.weight_kg)
      if (!map.has(label)) map.set(label, new Map())
      map.get(label)!.set(col, (map.get(label)!.get(col) || 0) + value)
    }
    const cols = Array.from(new Set(Array.from(map.values()).flatMap((inner) => Array.from(inner.keys())))).slice(0, 8)
    const rowEntries = Array.from(map.entries()).slice(0, 8)
    const max = Math.max(1, ...rowEntries.flatMap(([, inner]) => cols.map((col) => inner.get(col) || 0)))
    return { cols, rowEntries, max }
  }, [kind, rows])

  return (
    <Card className="rounded-[22px] border-slate-200 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-500">
          <Thermometer className="h-4 w-4 text-rose-500" />
          Variant Size Heatmap
        </CardTitle>
      </CardHeader>
      <CardContent>
        {matrix.cols.length === 0 ? <div className="grid h-[250px] place-items-center text-sm text-slate-400">No heatmap data.</div> : (
          <div className="overflow-x-auto">
            <div className="min-w-[620px] space-y-2">
              <div className="grid grid-cols-[180px_repeat(8,minmax(80px,1fr))] gap-2 text-[11px] font-black uppercase tracking-[0.12em] text-slate-400">
                <div>Variant</div>
                {matrix.cols.map((col) => <div key={col} className="truncate text-center">{col}</div>)}
              </div>
              {matrix.rowEntries.map(([label, inner]) => (
                <div key={label} className="grid grid-cols-[180px_repeat(8,minmax(80px,1fr))] gap-2">
                  <div className="truncate rounded-lg bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700">{label}</div>
                  {matrix.cols.map((col) => {
                    const value = inner.get(col) || 0
                    const alpha = Math.max(0.08, value / matrix.max)
                    return (
                      <button
                        key={col}
                        type="button"
                        className="rounded-lg px-2 py-2 text-center text-xs font-black text-slate-950 ring-1 ring-emerald-900/5 transition hover:ring-2 hover:ring-emerald-500"
                        style={{ backgroundColor: `rgba(13, 148, 136, ${alpha})` }}
                        title={`${label} ${col}: ${value.toLocaleString()}`}
                      >
                        {value ? value.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "-"}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function InventoryBrowseTable({ kind, rows, mode, packagingMaterials = [] }: { kind: "rolls" | "bulk" | "packaging"; rows: any[]; mode: ViewMode; packagingMaterials?: any[] }) {
  if (mode === "cards") {
    return (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.slice(0, 60).map((row) => <InventoryCard key={row.id} kind={kind} row={row} packagingMaterials={packagingMaterials} />)}
        {rows.length === 0 ? <EmptyBrowse /> : null}
      </div>
    )
  }
  return (
    <Card className="rounded-[22px] border-slate-200 shadow-sm">
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50">
              <TableHead>Item</TableHead>
              <TableHead>Class</TableHead>
              <TableHead>Plant / Location</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead>Age</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.slice(0, 300).map((row) => <InventoryRow key={row.id} kind={kind} row={row} packagingMaterials={packagingMaterials} />)}
            {rows.length === 0 ? <TableRow><TableCell colSpan={6}><EmptyBrowse /></TableCell></TableRow> : null}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function InventoryRow({ kind, row, packagingMaterials }: { kind: "rolls" | "bulk" | "packaging"; row: any; packagingMaterials: any[] }) {
  const material = packagingMaterials.find((item) => String(item.id) === String(row.material))
  const qty = kind === "rolls" ? formatKg(num(row.weight_kg)) : kind === "bulk" ? formatKg(num(row.qty_kg)) : formatQty(num(row.qty), row.base_uom)
  const ageDate = row.created_at || row.updated_at
  return (
    <TableRow>
      <TableCell>
        <div className="font-black text-slate-950">{kind === "rolls" ? row.label_id : row.material_name}</div>
        <div className="text-xs text-slate-500">{kind === "rolls" ? row.variant_display_name || row.material_name : row.material_code}</div>
      </TableCell>
      <TableCell>{kind === "rolls" ? <SemanticBadge kind="jobState" value={row.status} /> : <SemanticBadge kind={kind === "bulk" ? "materialCategory" : "packagingKind"} value={kind === "bulk" ? row.material_category : row.packaging_kind} />}</TableCell>
      <TableCell><div className="font-medium">{row.plant_name || "Unknown"}</div><div className="text-xs text-slate-500">{row.location_name || "No location"}</div></TableCell>
      <TableCell className="text-right font-black">{qty}</TableCell>
      <TableCell><AgePill date={ageDate} /></TableCell>
      <TableCell>{kind === "packaging" ? String(material?.packaging_supply_mode || "PURCHASED").replaceAll("_", " ") : kind === "bulk" ? row.granule_quality_code || "Stock" : row.stage_name}</TableCell>
    </TableRow>
  )
}

function InventoryCard({ kind, row, packagingMaterials }: { kind: "rolls" | "bulk" | "packaging"; row: any; packagingMaterials: any[] }) {
  const material = packagingMaterials.find((item) => String(item.id) === String(row.material))
  const title = kind === "rolls" ? row.label_id : row.material_name
  const qty = kind === "rolls" ? formatKg(num(row.weight_kg)) : kind === "bulk" ? formatKg(num(row.qty_kg)) : formatQty(num(row.qty), row.base_uom)
  return (
    <Card className="rounded-[20px] border-slate-200 shadow-sm">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-black text-slate-950">{title}</div>
            <div className="mt-1 text-xs font-medium text-slate-500">{kind === "rolls" ? row.variant_display_name || row.material_name : row.material_code}</div>
          </div>
          <AgePill date={row.created_at || row.updated_at} />
        </div>
        <div className="text-2xl font-black tracking-tight text-slate-950">{qty}</div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-slate-100 px-2 py-1 font-bold text-slate-600">{row.plant_name || "Unknown"}</span>
          <span className="rounded-full bg-slate-100 px-2 py-1 font-bold text-slate-600">{row.location_name || "No location"}</span>
          {kind === "packaging" ? <span className="rounded-full bg-emerald-50 px-2 py-1 font-bold text-emerald-700">{String(material?.packaging_supply_mode || "PURCHASED").replaceAll("_", " ")}</span> : null}
        </div>
      </CardContent>
    </Card>
  )
}

function AgePill({ date }: { date?: string | null }) {
  const band = ageBand(date)
  return <span className={cn("rounded-full px-2 py-1 text-[11px] font-black", band === "Fresh" ? "bg-emerald-50 text-emerald-700" : band === "Watch" ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700")}>{band} {ageDays(date)}d</span>
}

function EmptyBrowse() {
  return <div className="grid min-h-[180px] place-items-center text-center text-sm font-medium text-slate-500">No rows match the current filters.</div>
}

export function GrnHistoryTab({ rows, loading, onChanged }: { rows: GrnHistoryRow[]; loading?: boolean; onChanged: () => void }) {
  const [selected, setSelected] = useState<GrnHistoryRow | null>(null)

  if (loading) return <div className="rounded-[24px] border border-slate-200 bg-white p-8 text-sm text-slate-500">Loading GRN history...</div>

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <SummaryStatCard label="Inward Rows" value={rows.length} subLabel="Bulk, roll, and packaging" icon={CalendarDays} toneClassName="bg-indigo-50 text-indigo-600" />
        <SummaryStatCard label="Inward KG / Qty" value={rows.reduce((sum, row) => sum + num(row.quantity), 0).toLocaleString(undefined, { maximumFractionDigits: 1 })} subLabel="Current filtered history" icon={Warehouse} toneClassName="bg-emerald-50 text-emerald-600" />
        <SummaryStatCard label="Correction Policy" value="Immutable" subLabel="Edits post audited deltas" icon={ShieldCheck} toneClassName="bg-amber-50 text-amber-600" />
      </div>
      <Card className="rounded-[22px] border-slate-200 shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead>Date</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Material / Ref</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Plant / Location</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={`${row.source_type}-${row.source_id}`}>
                  <TableCell className="whitespace-nowrap text-xs font-bold text-slate-600">{row.created_at ? new Date(row.created_at).toLocaleString() : "-"}</TableCell>
                  <TableCell><SemanticBadge kind="jobState" value={row.source_type} label={row.source_type} /></TableCell>
                  <TableCell>
                    <div className="font-black text-slate-950">{row.label_id || row.material_name || row.material_code}</div>
                    <div className="text-xs text-slate-500">{row.reference || row.batch_no || "No reference"}</div>
                  </TableCell>
                  <TableCell>{row.vendor_name || row.vendor_code || "-"}</TableCell>
                  <TableCell><div className="font-medium">{row.plant_name || "Unknown"}</div><div className="text-xs text-slate-500">{row.location_name || "No location"}</div></TableCell>
                  <TableCell className="text-right font-black">{formatQty(num(row.quantity), row.uom)}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => setSelected(row)}>
                      <Edit3 className="mr-2 h-3.5 w-3.5" />
                      Correct
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 ? <TableRow><TableCell colSpan={7}><EmptyBrowse /></TableCell></TableRow> : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <CorrectionDialog row={selected} onOpenChange={(open) => !open && setSelected(null)} onChanged={onChanged} />
    </div>
  )
}

function CorrectionDialog({ row, onOpenChange, onChanged }: { row: GrnHistoryRow | null; onOpenChange: (open: boolean) => void; onChanged: () => void }) {
  const [quantity, setQuantity] = useState("")
  const [avgCost, setAvgCost] = useState("")
  const [reference, setReference] = useState("")
  const [labelId, setLabelId] = useState("")
  const [batchNo, setBatchNo] = useState("")
  const [reason, setReason] = useState("")

  const mutation = useMutation({
    mutationFn: () => {
      if (!row) throw new Error("No GRN row selected.")
      return inventoryService.correctGrnHistoryRow(row.source_type, row.source_id, {
        reason,
        quantity: quantity.trim() ? Number(quantity) : undefined,
        avg_cost: avgCost.trim() ? Number(avgCost) : undefined,
        reference: reference.trim() || undefined,
        label_id: labelId.trim() || undefined,
        batch_no: batchNo.trim() || undefined,
      })
    },
    onSuccess: () => {
      toast.success("GRN correction posted with audit trail.")
      onOpenChange(false)
      setQuantity("")
      setAvgCost("")
      setReference("")
      setLabelId("")
      setBatchNo("")
      setReason("")
      onChanged()
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error || error?.message || "Correction failed")
    },
  })

  return (
    <Dialog open={Boolean(row)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl rounded-[24px]">
        <DialogHeader>
          <DialogTitle className="text-xl font-black">Correct GRN History Row</DialogTitle>
        </DialogHeader>
        {row ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-900">
              The original GRN remains locked. This action posts a correction entry and stores before/after, delta, user, and reason.
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label>Corrected quantity</Label>
                <Input value={quantity} onChange={(event) => setQuantity(event.target.value)} placeholder={String(row.quantity || 0)} type="number" step="0.001" />
              </div>
              <div>
                <Label>Corrected cost</Label>
                <Input value={avgCost} onChange={(event) => setAvgCost(event.target.value)} placeholder={String(row.avg_cost || 0)} type="number" step="0.01" disabled={row.source_type === "ROLL"} />
              </div>
              <div>
                <Label>Reference</Label>
                <Input value={reference} onChange={(event) => setReference(event.target.value)} placeholder={row.reference || "Reference"} />
              </div>
              {row.source_type === "ROLL" ? (
                <>
                  <div>
                    <Label>Label ID</Label>
                    <Input value={labelId} onChange={(event) => setLabelId(event.target.value)} placeholder={row.label_id || "Label"} />
                  </div>
                  <div>
                    <Label>Batch No</Label>
                    <Input value={batchNo} onChange={(event) => setBatchNo(event.target.value)} placeholder={row.batch_no || "Batch"} />
                  </div>
                </>
              ) : null}
            </div>
            <div>
              <Label>Reason required</Label>
              <Textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain why this inward correction is needed." />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button disabled={!reason.trim() || mutation.isPending} onClick={() => mutation.mutate()} className="bg-slate-950 hover:bg-slate-800">
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Post Correction
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
