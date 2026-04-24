"use client"

import { ChangeEvent, ReactNode, useEffect, useMemo, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  CheckCircle2,
  BookOpenCheck,
  ClipboardList,
  Download,
  FileSpreadsheet,
  History,
  Layers3,
  LockKeyhole,
  PackageCheck,
  Plus,
  RefreshCw,
  RotateCcw,
  Scale,
  Search,
  ShieldCheck,
  Table2,
  Upload,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/lib/api"
import { factoryService } from "@/services/factory"
import { inventoryService, type InventoryAuditLine, type StockCardPayload } from "@/services/inventory"
import { masterDataService } from "@/services/master-data"
import { recipeService } from "@/services/recipes"

type LifecycleTab = "opening" | "count" | "stockcard" | "yearclose" | "correction" | "help"
type AuditMode = "OPENING_STOCK" | "PHYSICAL_COUNT" | "FY_CORRECTION"
type StockClass = "BULK" | "ROLL" | "PACKAGING"

const TAB_CONFIG: Array<{
  id: LifecycleTab
  label: string
  sub: string
  icon: any
}> = [
  { id: "opening", label: "Opening Stock", sub: "Start FY balances", icon: Scale },
  { id: "count", label: "Stock Count", sub: "Physical vs system", icon: ClipboardList },
  { id: "stockcard", label: "Stock Card", sub: "Running ledger", icon: Table2 },
  { id: "yearclose", label: "Year Close", sub: "Seal and roll forward", icon: LockKeyhole },
  { id: "correction", label: "FY Correction", sub: "Approved post-close fix", icon: RotateCcw },
  { id: "help", label: "Help & Flow", sub: "Rules and diagrams", icon: BookOpenCheck },
]

const CLASS_OPTIONS: Array<{ value: StockClass; label: string }> = [
  { value: "BULK", label: "Bulk" },
  { value: "ROLL", label: "Rolls" },
  { value: "PACKAGING", label: "Packaging" },
]

function currentFy() {
  const now = new Date()
  const year = now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1
  return `${year}-${year + 1}`
}

function previousFy() {
  const [start] = currentFy().split("-").map(Number)
  return `${start - 1}-${start}`
}

function financialYearEndIso(financialYear: string) {
  const [start] = String(financialYear || currentFy()).split("-").map(Number)
  return new Date(Date.UTC(start + 1, 2, 31, 18, 29, 59)).toISOString()
}

function modeFor(tab: LifecycleTab): AuditMode {
  if (tab === "count") return "PHYSICAL_COUNT"
  if (tab === "correction") return "FY_CORRECTION"
  return "OPENING_STOCK"
}

function errText(error: any) {
  const data = error?.response?.data
  if (!data) return error?.message || "Request failed"
  if (typeof data.detail === "string") return data.detail
  if (Array.isArray(data.detail)) return data.detail.join(", ")
  return JSON.stringify(data.detail || data)
}

function toNumber(value: any) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function money(value: any) {
  const number = Number(value || 0)
  if (!Number.isFinite(number)) return "Rs 0"
  return `Rs ${number.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
}

function qty(value: any, suffix = "") {
  const number = Number(value || 0)
  return `${number.toLocaleString("en-IN", { maximumFractionDigits: 2 })}${suffix ? ` ${suffix}` : ""}`
}

function parseCsv(text: string) {
  const [headerLine, ...lines] = text.trim().split(/\r?\n/)
  if (!headerLine) return []
  const headers = headerLine.split(",").map((h) => h.trim())
  return lines
    .map((line) => line.split(",").map((cell) => cell.trim()))
    .filter((cells) => cells.length > 1)
    .map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])))
}

async function downloadBlob(url: string, payload: any, fileName: string) {
  const response = await api.post(url, payload, { responseType: "blob" })
  const blobUrl = URL.createObjectURL(response.data)
  const anchor = document.createElement("a")
  anchor.href = blobUrl
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(blobUrl)
}

export function StockLifecycleWorkspace() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const rawTab = (searchParams?.get("tab") || "opening").toLowerCase()
  const activeTab = (TAB_CONFIG.some((tab) => tab.id === rawTab) ? rawTab : "opening") as LifecycleTab

  function setTab(tab: LifecycleTab) {
    const next = new URLSearchParams(searchParams?.toString() || "")
    next.set("tab", tab)
    router.replace(`${pathname}?${next.toString()}`, { scroll: false })
  }

  return (
    <div data-testid="stock-lifecycle-workspace" className="mx-auto max-w-[1520px] space-y-5 pb-10">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-800 text-sm font-black text-white">T</div>
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">Total Poly Print ERP</div>
            <div className="text-sm font-black text-slate-950">Stock Lifecycle</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 text-xs font-bold">
          <span className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-3 py-2 text-amber-200">
            <LockKeyhole className="h-3.5 w-3.5" />
            Closed years are correction-only
          </span>
          <span className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-700">{currentFy()} - Open</span>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[260px_1fr]">
        <aside className="space-y-3">
          <Card className="rounded-[18px] border-slate-200 bg-white p-3 shadow-sm">
            <div className="px-2 pb-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Stock Lifecycle</div>
            <div className="space-y-1.5">
              {TAB_CONFIG.map((tab) => {
                const Icon = tab.icon
                const active = tab.id === activeTab
                return (
                  <button
                    key={tab.id}
                    type="button"
                    data-testid={`stock-lifecycle-tab-${tab.id}`}
                    onClick={() => setTab(tab.id)}
                    className={`flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition ${
                      active
                        ? "border-blue-700 bg-gradient-to-br from-blue-700 to-indigo-900 text-white shadow-[0_14px_28px_-18px_rgba(29,78,216,0.7)]"
                        : "border-transparent text-slate-700 hover:border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${active ? "bg-white/15 text-white" : "bg-blue-50 text-blue-700"}`}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <span>
                      <span className="block text-sm font-black">{tab.label}</span>
                      <span className={`block text-xs ${active ? "text-white/75" : "text-slate-500"}`}>{tab.sub}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </Card>

          <div className="rounded-[18px] border border-amber-200 bg-gradient-to-b from-amber-50 to-orange-50 p-4 text-xs leading-5 text-amber-900">
            <div className="mb-1 flex items-center gap-2 font-black">
              <ShieldCheck className="h-4 w-4" />
              One lifecycle pattern
            </div>
            Sheet - Enter - Validate - Preview - Approve - Post. Opening, counts, close, correction, and stock cards now live in one workspace.
          </div>
        </aside>

        <main className="min-w-0">
          {activeTab === "yearclose" ? (
            <YearClosePanel />
          ) : activeTab === "stockcard" ? (
            <StockCardPanel />
          ) : activeTab === "help" ? (
            <LifecycleHelpPanel />
          ) : (
            <SheetLifecyclePanel mode={modeFor(activeTab)} />
          )}
        </main>
      </div>
    </div>
  )
}

function Hero({
  eyebrow,
  title,
  copy,
  actions,
  metrics,
}: {
  eyebrow: string
  title: string
  copy: string
  actions?: ReactNode
  metrics: Array<{ label: string; value: string; sub: string }>
}) {
  return (
    <section className="relative overflow-hidden rounded-[24px] bg-[radial-gradient(800px_400px_at_85%_0%,rgba(59,130,246,0.35),transparent_60%),radial-gradient(600px_300px_at_10%_100%,rgba(139,92,246,0.35),transparent_65%),linear-gradient(135deg,#0f172a_0%,#1d4ed8_55%,#312e81_100%)] p-6 text-white shadow-[0_28px_90px_-46px_rgba(15,23,42,0.65)]">
      <div className="pointer-events-none absolute inset-0 opacity-60 [background:linear-gradient(90deg,rgba(255,255,255,0.07)_1px,transparent_1px)_0_0/42px_100%,linear-gradient(0deg,rgba(255,255,255,0.06)_1px,transparent_1px)_0_0/100%_42px]" />
      <div className="relative flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.22em] text-white/60">{eyebrow}</div>
          <h1 className="mt-1 text-3xl font-black tracking-tight sm:text-4xl">{title}</h1>
          <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-white/75">{copy}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      </div>
      <div className="relative mt-5 grid gap-3 md:grid-cols-5">
        {metrics.map((metric) => (
          <div key={metric.label} className="rounded-[14px] border border-white/15 bg-white/[0.08] p-4 backdrop-blur">
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-white/60">{metric.label}</div>
            <div className="mt-2 text-2xl font-black leading-none">{metric.value}</div>
            <div className="mt-2 text-xs font-semibold text-white/65">{metric.sub}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

function Stepper({ status, hasPreview }: { status?: string; hasPreview?: boolean }) {
  const steps = ["Sheet", "Enter", "Validate", "Preview", "Approve", "Post"]
  const current = status === "POSTED" ? 6 : status === "APPROVED" ? 5 : status === "SUBMITTED" ? 4 : hasPreview ? 4 : 2
  return (
    <Card className="rounded-[18px] border-slate-200 bg-white shadow-sm">
      <CardContent className="flex flex-wrap items-center gap-2 p-4">
        {steps.map((step, index) => {
          const number = index + 1
          const done = number < current || status === "POSTED"
          const active = number === current && status !== "POSTED"
          return (
            <div key={step} className="flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-2 rounded-[10px] border px-3 py-2 text-xs font-black ${
                  done
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : active
                      ? "border-blue-700 bg-blue-700 text-white shadow-[0_8px_18px_-10px_rgba(29,78,216,0.8)]"
                      : "border-slate-200 bg-slate-50 text-slate-400"
                }`}
              >
                <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${done ? "bg-emerald-700 text-white" : active ? "bg-white text-blue-700" : "bg-slate-200 text-slate-500"}`}>
                  {done ? "✓" : number}
                </span>
                {step}
              </span>
              {number < steps.length ? <span className={`h-0.5 w-4 ${done ? "bg-emerald-200" : "bg-slate-200"}`} /> : null}
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

function SheetLifecyclePanel({ mode }: { mode: AuditMode }) {
  const queryClient = useQueryClient()
  const [stockClass, setStockClass] = useState<StockClass>("BULK")
  const [financialYear, setFinancialYear] = useState(mode === "FY_CORRECTION" ? previousFy() : currentFy())
  const [selectedPlant, setSelectedPlant] = useState("")
  const [selectedBatchId, setSelectedBatchId] = useState("")
  const [notes, setNotes] = useState("")
  const [line, setLine] = useState<Record<string, any>>({ uom: "KG", status: "AVAILABLE" })
  const [lineSearch, setLineSearch] = useState("")
  const [preview, setPreview] = useState<any>(null)

  const copy = {
    OPENING_STOCK: {
      tab: "Opening",
      title: `Opening Stock - FY ${financialYear}`,
      copy: "Declare the start-of-year balance for bulk, rolls, and packaging. Opening posts as OPENING_BALANCE and does not pollute purchase GRN reports.",
      create: "New opening sheet",
      qtyLabel: "Opening qty",
      submit: "Submit opening",
      post: "Post opening",
      empty: "No opening rows yet. Create a sheet, add rows, validate, preview, approve, and post.",
    },
    PHYSICAL_COUNT: {
      tab: "Stock Count",
      title: "Stock Count Reconciliation",
      copy: "Freeze live system stock, enter the floor count, preview shortage or excess, then post only the variance with audit trail.",
      create: "New count sheet",
      qtyLabel: "Counted qty",
      submit: "Submit count",
      post: "Post variance",
      empty: "No count rows yet. Create a sheet and load live stock, or add focused count rows manually.",
    },
    FY_CORRECTION: {
      tab: "FY Correction",
      title: "Financial Year Correction",
      copy: "Use this only for approved corrections after period close. The reason is mandatory and the correction remains visible in Audit Center and Stock Card.",
      create: "New correction",
      qtyLabel: "Corrected qty",
      submit: "Submit correction",
      post: "Post correction",
      empty: "No correction rows yet. Add only the affected material/location rows and write the authority in notes.",
    },
  }[mode]

  const { data: plants = [] } = useQuery({ queryKey: ["factory-plants"], queryFn: factoryService.getPlants })
  const { data: locations = [] } = useQuery({ queryKey: ["factory-locations"], queryFn: factoryService.getLocations })
  const { data: materials = [] } = useQuery({ queryKey: ["master-library"], queryFn: () => masterDataService.getLibrary() })
  const { data: grades = [] } = useQuery({ queryKey: ["recipe-grades"], queryFn: () => recipeService.getGrades() })
  const { data: granuleCodes = [] } = useQuery({ queryKey: ["granule-codes"], queryFn: () => masterDataService.getGranuleCodes({ status: "ACTIVE" }) })

  useEffect(() => {
    if (!selectedPlant && plants.length) setSelectedPlant(String((plants as any[])[0].id))
  }, [plants, selectedPlant])

  const { data: batches = [], isFetching } = useQuery({
    queryKey: ["inventory-audit-batches", mode, financialYear, selectedPlant],
    queryFn: () =>
      inventoryService.getAuditBatches({
        type: mode,
        financial_year: financialYear,
        plant: selectedPlant || undefined,
      }),
  })

  const currentBatch = useMemo(() => {
    return batches.find((batch) => batch.id === selectedBatchId) || batches.find((batch) => ["DRAFT", "SUBMITTED", "APPROVED"].includes(batch.status)) || batches[0]
  }, [batches, selectedBatchId])

  useEffect(() => {
    setPreview(null)
  }, [currentBatch?.id, mode])

  const filteredMaterials = useMemo(() => {
    const rows = materials as any[]
    if (stockClass === "ROLL") return rows.filter((m) => String(m.category || "").toUpperCase() === "FILM_VARIANT")
    if (stockClass === "PACKAGING") return rows.filter((m) => String(m.category || "").toUpperCase() === "PACKAGING")
    return rows.filter((m) => ["GRANULE", "INK", "SOLVENT", "ADHESIVE"].includes(String(m.category || "").toUpperCase()))
  }, [materials, stockClass])

  const selectedMaterial = filteredMaterials.find((m: any) => String(m.id) === String(line.material))
  const plantLocations = selectedPlant ? (locations as any[]).filter((loc) => String(loc.plant) === String(selectedPlant)) : (locations as any[])
  const visibleLines = useMemo(() => {
    const q = lineSearch.trim().toLowerCase()
    const rows = currentBatch?.lines || []
    if (!q) return rows
    return rows.filter((row) =>
      [row.stock_class, row.material_code, row.material_name, row.location_name, row.label_id, row.row_errors?.join(" ")]
        .map((value) => String(value || "").toLowerCase())
        .join(" ")
        .includes(q),
    )
  }, [currentBatch?.lines, lineSearch])

  const createBatch = useMutation({
    mutationFn: () =>
      inventoryService.createAuditBatch({
        type: mode,
        plant: selectedPlant,
        financial_year: financialYear,
        cutoff_at: mode === "FY_CORRECTION" ? financialYearEndIso(financialYear) : new Date().toISOString(),
        notes,
      }),
    onSuccess: (batch) => {
      setSelectedBatchId(batch.id)
      toast.success(`${copy.tab} sheet created`)
      queryClient.invalidateQueries({ queryKey: ["inventory-audit-batches"] })
    },
    onError: (error) => toast.error("Sheet was not created", { description: errText(error) }),
  })

  const importLines = useMutation({
    mutationFn: ({ batchId, lines }: { batchId: string; lines: any[] }) => inventoryService.importAuditLines(batchId, { lines }),
    onSuccess: (batch) => {
      setSelectedBatchId(batch.id)
      setLine({ uom: "KG", status: "AVAILABLE" })
      toast.success("Line added")
      queryClient.invalidateQueries({ queryKey: ["inventory-audit-batches"] })
    },
    onError: (error) => toast.error("Line was not added", { description: errText(error) }),
  })

  const uploadFile = useMutation({
    mutationFn: ({ batchId, file }: { batchId: string; file: File }) => inventoryService.importAuditLinesFile(batchId, file, stockClass),
    onSuccess: (batch) => {
      setSelectedBatchId(batch.id)
      toast.success("File imported")
      queryClient.invalidateQueries({ queryKey: ["inventory-audit-batches"] })
    },
    onError: (error) => toast.error("File import failed", { description: errText(error) }),
  })

  const validateBatch = useMutation({
    mutationFn: (batchId: string) => inventoryService.validateAuditBatch(batchId),
    onSuccess: (batch) => {
      toast[batch.validation?.ok ? "success" : "error"](batch.validation?.ok ? "Validation is green" : "Validation found blockers")
      queryClient.invalidateQueries({ queryKey: ["inventory-audit-batches"] })
    },
    onError: (error) => toast.error("Validation failed", { description: errText(error) }),
  })

  const previewBatch = useMutation({
    mutationFn: (batchId: string) => inventoryService.previewAuditBatch(batchId),
    onSuccess: (payload) => {
      setPreview(payload)
      toast[payload.ok ? "success" : "error"](payload.ok ? "Preview ready" : "Preview has blockers")
      queryClient.invalidateQueries({ queryKey: ["inventory-audit-batches"] })
    },
    onError: (error) => toast.error("Preview failed", { description: errText(error) }),
  })

  const transitionBatch = useMutation({
    mutationFn: ({ action, batchId }: { action: "submit" | "approve" | "post" | "cancel"; batchId: string }) => {
      if (action === "submit") return inventoryService.submitAuditBatch(batchId)
      if (action === "approve") return inventoryService.approveAuditBatch(batchId)
      if (action === "cancel") return inventoryService.cancelAuditBatch(batchId, "Cancelled from Stock Lifecycle workspace")
      return inventoryService.postAuditBatch(batchId)
    },
    onSuccess: (batch, variables) => {
      toast.success(`Sheet ${variables.action} complete`)
      setSelectedBatchId(batch.id)
      queryClient.invalidateQueries({ queryKey: ["inventory-audit-batches"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-stock-card"] })
      queryClient.invalidateQueries({ queryKey: ["bulk-stock"] })
      queryClient.invalidateQueries({ queryKey: ["packaging-stock"] })
    },
    onError: (error) => toast.error("Workflow action failed", { description: errText(error) }),
  })

  const preloadLiveStock = useMutation({
    mutationFn: (batchId: string) =>
      inventoryService.loadAuditBatchFromSystemStock(batchId, {
        stock_class: stockClass,
        location: line.location || undefined,
        material: line.material || undefined,
        replace_existing: true,
      }),
    onSuccess: (batch) => {
      setSelectedBatchId(batch.id)
      toast.success("Live stock loaded")
      queryClient.invalidateQueries({ queryKey: ["inventory-audit-batches"] })
    },
    onError: (error) => toast.error("Live stock was not loaded", { description: errText(error) }),
  })

  function addManualLine() {
    if (!currentBatch?.id) {
      toast.error("Create or select a sheet first")
      return
    }
    const payload = {
      ...line,
      stock_class: stockClass,
      material: line.material,
      location: line.location,
      uom: line.uom || (selectedMaterial as any)?.base_uom || "KG",
      opening_qty: mode === "OPENING_STOCK" ? toNumber(line.quantity) : 0,
      counted_qty: mode !== "OPENING_STOCK" ? toNumber(line.quantity) : undefined,
      quantity: toNumber(line.quantity),
      width_mm: line.width_mm ? toNumber(line.width_mm) : undefined,
      thickness_micron: line.thickness_micron ? toNumber(line.thickness_micron) : undefined,
      length_m: line.length_m ? toNumber(line.length_m) : undefined,
      rate: line.rate === "" || line.rate == null ? undefined : toNumber(line.rate),
    }
    importLines.mutate({ batchId: currentBatch.id, lines: [payload] })
  }

  async function onCsvFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file || !currentBatch?.id) return
    if (file.name.toLowerCase().endsWith(".csv")) {
      const text = await file.text()
      const rows = parseCsv(text).map((row) => ({ ...row, stock_class: row.stock_class || stockClass }))
      importLines.mutate({ batchId: currentBatch.id, lines: rows })
    } else {
      uploadFile.mutate({ batchId: currentBatch.id, file })
    }
    event.target.value = ""
  }

  function openSample() {
    window.open(inventoryService.getAuditSampleTemplateUrl({ type: mode, stock_class: stockClass }), "_blank", "noopener,noreferrer")
  }

  function exportSheet() {
    if (!currentBatch?.id) return
    window.open(inventoryService.getAuditBatchExportUrl(currentBatch.id), "_blank", "noopener,noreferrer")
  }

  const summary = currentBatch?.summary_json || {}
  const canEdit = !currentBatch || currentBatch.status === "DRAFT"
  const workflow = (summary.workflow || {}) as Record<string, any>

  return (
    <div className="space-y-5">
      <Hero
        eyebrow={`Stock Lifecycle - ${copy.tab}`}
        title={copy.title}
        copy={copy.copy}
        actions={
          <>
            <Button className="rounded-full bg-white text-slate-950 hover:bg-blue-50" disabled={!selectedPlant || createBatch.isPending} onClick={() => createBatch.mutate()}>
              <Plus className="mr-2 h-4 w-4" />
              {copy.create}
            </Button>
            <Button variant="outline" className="rounded-full border-white/25 bg-white/10 text-white hover:bg-white/20" onClick={openSample}>
              <Download className="mr-2 h-4 w-4" />
              CSV template
            </Button>
          </>
        }
        metrics={[
          { label: "Sheet", value: currentBatch?.batch_no || "None", sub: currentBatch?.status || "Create draft" },
          { label: "Lines", value: qty(summary.lines || currentBatch?.line_count || 0), sub: `${summary.errors || 0} blockers` },
          { label: "Bulk kg", value: qty(summary.bulk_kg || 0), sub: "Visible draft impact" },
          { label: "Roll kg", value: qty(summary.roll_kg || 0), sub: "Serialized labels" },
          { label: "Value", value: money(summary.value || 0), sub: `${summary.missing_rates || 0} missing rates` },
        ]}
      />

      <Stepper status={currentBatch?.status} hasPreview={Boolean(preview)} />

      <div className="grid gap-5 2xl:grid-cols-[380px_1fr]">
        <Card className="rounded-[18px] border-slate-200 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg font-black">
              <PackageCheck className="h-5 w-5 text-blue-700" />
              Sheet Control
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Financial year">
              <Input data-testid="stock-lifecycle-financial-year" value={financialYear} onChange={(event) => setFinancialYear(event.target.value)} />
            </Field>
            <Field label="Plant">
              <Select value={selectedPlant || "__none__"} onValueChange={(value) => setSelectedPlant(value === "__none__" ? "" : value)}>
                <SelectTrigger><SelectValue placeholder="Select plant" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Select plant</SelectItem>
                  {(plants as any[]).map((plant) => <SelectItem key={plant.id} value={String(plant.id)}>{plant.code ? `${plant.code} - ${plant.name}` : plant.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Working sheet">
              <Select value={currentBatch?.id || "__none__"} onValueChange={(value) => setSelectedBatchId(value === "__none__" ? "" : value)}>
                <SelectTrigger><SelectValue placeholder={isFetching ? "Loading..." : "No sheet"} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No sheet selected</SelectItem>
                  {batches.map((batch) => (
                    <SelectItem key={batch.id} value={batch.id}>{batch.batch_no} - {batch.status}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={mode === "FY_CORRECTION" ? "Reason / authority" : "Notes"}>
              <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={mode === "FY_CORRECTION" ? "Required: what changed, why, who approved, source document" : "Physical count reference, import file, or operator note"} />
            </Field>

            {currentBatch ? (
              <div className="rounded-[14px] border border-slate-200 bg-slate-50 p-4 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="font-black text-slate-950">{currentBatch.batch_no}</div>
                    <div className="text-xs font-semibold text-slate-500">{currentBatch.status} - {currentBatch.line_count || currentBatch.lines?.length || 0} lines</div>
                  </div>
                  <StatusBadge status={currentBatch.status} />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
                  <div>Maker: <b>{workflow.submitted_by_name || currentBatch.created_by_name || "-"}</b></div>
                  <div>Checker: <b>{workflow.approved_by_name || "-"}</b></div>
                </div>
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" disabled={!currentBatch} onClick={exportSheet}><Download className="mr-2 h-4 w-4" />Export</Button>
              <Button variant="outline" disabled={!currentBatch || !canEdit} onClick={() => currentBatch && transitionBatch.mutate({ action: "cancel", batchId: currentBatch.id })}>Cancel</Button>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-[18px] border-slate-200 bg-white shadow-sm">
          <CardHeader>
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <CardTitle className="flex items-center gap-2 text-lg font-black">
                <FileSpreadsheet className="h-5 w-5 text-emerald-700" />
                Sheet Lines
              </CardTitle>
              <Tabs value={stockClass} onValueChange={(value) => setStockClass(value as StockClass)}>
                <TabsList className="grid w-full grid-cols-3 rounded-xl bg-slate-100 xl:w-[360px]">
                  {CLASS_OPTIONS.map((option) => <TabsTrigger key={option.value} value={option.value}>{option.label}</TabsTrigger>)}
                </TabsList>
              </Tabs>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 lg:grid-cols-4">
              <Field label="Material" className="lg:col-span-2">
                <Select value={line.material || "__none__"} onValueChange={(value) => setLine((prev) => ({ ...prev, material: value === "__none__" ? "" : value }))}>
                  <SelectTrigger><SelectValue placeholder="Select material" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Select material</SelectItem>
                    {filteredMaterials.map((material: any) => <SelectItem key={material.id} value={String(material.id)}>{material.code} - {material.name || material.code}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Location">
                <Select value={line.location || "__none__"} onValueChange={(value) => setLine((prev) => ({ ...prev, location: value === "__none__" ? "" : value }))}>
                  <SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Select location</SelectItem>
                    {plantLocations.map((location: any) => <SelectItem key={location.id} value={String(location.id)}>{location.code ? `${location.code} - ${location.name}` : location.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={copy.qtyLabel}>
                <Input type="number" value={line.quantity || ""} onChange={(event) => setLine((prev) => ({ ...prev, quantity: event.target.value }))} />
              </Field>
              <Field label="UOM">
                <Input value={line.uom || (selectedMaterial as any)?.base_uom || "KG"} onChange={(event) => setLine((prev) => ({ ...prev, uom: event.target.value }))} />
              </Field>
              <Field label="Rate">
                <Input type="number" value={line.rate || ""} onChange={(event) => setLine((prev) => ({ ...prev, rate: event.target.value }))} />
              </Field>
              {stockClass === "BULK" && String(selectedMaterial?.category || "").toUpperCase() === "GRANULE" ? (
                <Field label="Granule code">
                  <Select value={line.granule_code || "__none__"} onValueChange={(value) => setLine((prev) => ({ ...prev, granule_code: value === "__none__" ? "" : value }))}>
                    <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">No code</SelectItem>
                      {(granuleCodes as any[]).filter((code) => String(code.granule) === String(line.material)).map((code) => <SelectItem key={code.id} value={String(code.id)}>{code.code}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              ) : null}
              {stockClass === "ROLL" ? (
                <>
                  <Field label="Label ID"><Input value={line.label_id || ""} onChange={(event) => setLine((prev) => ({ ...prev, label_id: event.target.value }))} /></Field>
                  <Field label="Batch no"><Input value={line.batch_no || ""} onChange={(event) => setLine((prev) => ({ ...prev, batch_no: event.target.value }))} /></Field>
                  <Field label="Grade">
                    <Select value={line.grade || "__none__"} onValueChange={(value) => setLine((prev) => ({ ...prev, grade: value === "__none__" ? "" : value }))}>
                      <SelectTrigger><SelectValue placeholder="Grade" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">No grade</SelectItem>
                        {(grades as any[]).map((grade) => <SelectItem key={grade.id} value={String(grade.id)}>{grade.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Width mm"><Input type="number" value={line.width_mm || ""} onChange={(event) => setLine((prev) => ({ ...prev, width_mm: event.target.value }))} /></Field>
                  <Field label="Thickness"><Input type="number" value={line.thickness_micron || ""} onChange={(event) => setLine((prev) => ({ ...prev, thickness_micron: event.target.value }))} /></Field>
                  <Field label="Length m"><Input type="number" value={line.length_m || ""} onChange={(event) => setLine((prev) => ({ ...prev, length_m: event.target.value }))} /></Field>
                </>
              ) : null}
            </div>

            <div className="flex flex-col gap-3 rounded-[16px] border border-slate-200 bg-slate-50 p-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="text-sm font-semibold text-slate-600">Import the exact template, paste a focused line, or load live system stock for count and correction.</div>
              <div className="flex flex-wrap gap-2">
                <Input className="max-w-[220px] bg-white" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={!canEdit || !currentBatch} onChange={onCsvFile} />
                {mode !== "OPENING_STOCK" ? (
                  <Button variant="outline" disabled={!canEdit || !currentBatch || preloadLiveStock.isPending} onClick={() => currentBatch && preloadLiveStock.mutate(currentBatch.id)}>
                    <Scale className="mr-2 h-4 w-4" />
                    Load live stock
                  </Button>
                ) : null}
                <Button variant="outline" onClick={openSample}><Upload className="mr-2 h-4 w-4" />Template</Button>
                <Button disabled={!canEdit || !currentBatch || !line.material || !line.location} onClick={addManualLine}><Plus className="mr-2 h-4 w-4" />Add line</Button>
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input className="pl-9" value={lineSearch} onChange={(event) => setLineSearch(event.target.value)} placeholder="Search material, location, label, validation..." />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" disabled={!currentBatch || validateBatch.isPending} onClick={() => currentBatch && validateBatch.mutate(currentBatch.id)}><RefreshCw className="mr-2 h-4 w-4" />Validate</Button>
                <Button variant="outline" disabled={!currentBatch || previewBatch.isPending} onClick={() => currentBatch && previewBatch.mutate(currentBatch.id)}><History className="mr-2 h-4 w-4" />Preview</Button>
                <Button disabled={!currentBatch || currentBatch.status !== "DRAFT"} onClick={() => currentBatch && transitionBatch.mutate({ action: "submit", batchId: currentBatch.id })}>{copy.submit}</Button>
                <Button disabled={!currentBatch || currentBatch.status !== "SUBMITTED"} onClick={() => currentBatch && transitionBatch.mutate({ action: "approve", batchId: currentBatch.id })}>Approve</Button>
                <Button className="bg-emerald-700 hover:bg-emerald-800" disabled={!currentBatch || currentBatch.status !== "APPROVED"} onClick={() => currentBatch && transitionBatch.mutate({ action: "post", batchId: currentBatch.id })}><CheckCircle2 className="mr-2 h-4 w-4" />{copy.post}</Button>
              </div>
            </div>

            {preview ? <PreviewPanel preview={preview} /> : null}

            <LineTable lines={visibleLines} empty={copy.empty} mode={mode} />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`grid gap-1.5 ${className}`}>
      <Label className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">{label}</Label>
      {children}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "POSTED" || status === "LOCKED"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : status === "APPROVED"
        ? "border-blue-200 bg-blue-50 text-blue-700"
        : status === "SUBMITTED"
          ? "border-amber-200 bg-amber-50 text-amber-700"
          : status === "CANCELLED" || status === "VOID"
            ? "border-rose-200 bg-rose-50 text-rose-700"
            : "border-slate-200 bg-slate-50 text-slate-600"
  return <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${tone}`}>{status}</span>
}

function PreviewPanel({ preview }: { preview: any }) {
  return (
    <div className={`rounded-[16px] border p-4 ${preview.ok ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className={`text-sm font-black ${preview.ok ? "text-emerald-950" : "text-rose-950"}`}>
            {preview.ok ? "Preview is green" : "Preview has blockers"}
          </div>
          <div className={`mt-1 text-sm ${preview.ok ? "text-emerald-800" : "text-rose-800"}`}>
            This post will write {preview.transaction_count || 0} transaction(s). Impact: {qty(preview.impact?.bulk_kg || 0, "kg bulk")}, {qty(preview.impact?.roll_kg || 0, "kg rolls")}, {qty(preview.impact?.packaging_qty || 0, "packaging")}, {money(preview.impact?.value || 0)}.
          </div>
        </div>
        <Badge className={preview.ok ? "bg-emerald-700" : "bg-rose-700"}>{preview.ok ? "Ready for approval" : `${preview.blockers?.length || 0} blockers`}</Badge>
      </div>
      {preview.blockers?.length ? (
        <div className="mt-3 space-y-2">
          {preview.blockers.slice(0, 4).map((blocker: any) => (
            <div key={blocker.line_id || JSON.stringify(blocker)} className="rounded-xl border border-rose-200 bg-white/70 p-3 text-xs font-semibold text-rose-800">
              {(blocker.errors || []).join("; ")}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function LineTable({ lines, empty, mode }: { lines: InventoryAuditLine[]; empty: string; mode: AuditMode }) {
  return (
    <div className="overflow-x-auto rounded-[16px] border border-slate-200">
      <table className="min-w-[980px] w-full text-left text-sm">
        <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">
          <tr>
            <th className="px-4 py-3">Class</th>
            <th className="px-4 py-3">Material</th>
            <th className="px-4 py-3">Location</th>
            <th className="px-4 py-3 text-right">System</th>
            <th className="px-4 py-3 text-right">{mode === "OPENING_STOCK" ? "Opening" : "Entered"}</th>
            <th className="px-4 py-3 text-right">Variance</th>
            <th className="px-4 py-3 text-right">Value</th>
            <th className="px-4 py-3">Validation</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((row) => (
            <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50">
              <td className="px-4 py-3 font-black text-slate-800">{row.stock_class}</td>
              <td className="px-4 py-3">
                <div className="font-black text-slate-950">{row.material_code}</div>
                <div className="text-xs font-semibold text-slate-500">{row.material_name}{row.label_id ? ` - ${row.label_id}` : ""}</div>
              </td>
              <td className="px-4 py-3 font-semibold text-slate-700">{row.location_name}</td>
              <td className="px-4 py-3 text-right tabular-nums">{qty(row.system_qty)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{qty(mode === "OPENING_STOCK" ? row.opening_qty : row.counted_qty || 0)}</td>
              <td className={`px-4 py-3 text-right font-black tabular-nums ${Number(row.variance_qty || 0) < 0 ? "text-rose-700" : Number(row.variance_qty || 0) > 0 ? "text-emerald-700" : "text-slate-500"}`}>{qty(row.variance_qty)}</td>
              <td className="px-4 py-3 text-right font-black tabular-nums">{money(row.value)}</td>
              <td className="px-4 py-3">
                {row.row_errors?.length ? (
                  <Badge variant="destructive" className="max-w-[320px] whitespace-normal">{row.row_errors.join("; ")}</Badge>
                ) : (
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-black text-emerald-700">OK</span>
                )}
              </td>
            </tr>
          ))}
          {!lines.length ? (
            <tr><td colSpan={8} className="px-4 py-12 text-center text-sm font-semibold text-slate-500">{empty}</td></tr>
          ) : null}
        </tbody>
      </table>
    </div>
  )
}

function YearClosePanel() {
  const queryClient = useQueryClient()
  const [financialYear, setFinancialYear] = useState(currentFy())
  const [selectedPlant, setSelectedPlant] = useState("")
  const { data: plants = [] } = useQuery({ queryKey: ["factory-plants"], queryFn: factoryService.getPlants })
  const { data: periods = [] } = useQuery({ queryKey: ["inventory-audit-periods"], queryFn: inventoryService.getAuditPeriods })

  useEffect(() => {
    if (!selectedPlant && plants.length) setSelectedPlant(String((plants as any[])[0].id))
  }, [plants, selectedPlant])

  const period = periods.find((row) => row.financial_year === financialYear) || periods[0]
  const { data: preview, isFetching } = useQuery({
    queryKey: ["inventory-closing-preview", selectedPlant, financialYear],
    queryFn: () => inventoryService.getClosingPreview({ plant: selectedPlant || undefined, financial_year: financialYear }),
  })
  const startPeriod = useMutation({
    mutationFn: () => inventoryService.startAuditPeriod({ financial_year: financialYear }),
    onSuccess: () => {
      toast.success("Financial period opened")
      queryClient.invalidateQueries({ queryKey: ["inventory-audit-periods"] })
    },
    onError: (error) => toast.error("Period was not started", { description: errText(error) }),
  })
  const beginClose = useMutation({
    mutationFn: () => inventoryService.beginPeriodClose(period!.id),
    onSuccess: () => {
      toast.success("Close precheck started")
      queryClient.invalidateQueries({ queryKey: ["inventory-audit-periods"] })
    },
    onError: (error) => toast.error("Close precheck failed", { description: errText(error) }),
  })
  const closePeriod = useMutation({
    mutationFn: () => inventoryService.closePeriod(period!.id, { plant: selectedPlant }),
    onSuccess: () => {
      toast.success("Financial year closed and opening roll-forward generated")
      queryClient.invalidateQueries({ queryKey: ["inventory-audit-periods"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-closing-preview"] })
    },
    onError: (error) => toast.error("FY close blocked", { description: errText(error) }),
  })

  async function exportPreview() {
    try {
      await downloadBlob(inventoryService.getClosingPreviewExportUrl(), { plant: selectedPlant, financial_year: financialYear }, `fy-close-${financialYear}.xlsx`)
      toast.success("Closing preview exported")
    } catch (error) {
      toast.error("Closing preview export failed", { description: errText(error) })
    }
  }

  const checks = [
    { code: "snapshot", label: "Closing stock snapshot is generated", ok: Boolean(preview?.rows?.length) },
    { code: "bulk", label: "Bulk, roll, and packaging totals available", ok: Boolean(preview?.totals?.rows || 0) },
    { code: "blockers", label: "No close blockers for selected plant", ok: !preview?.blockers?.length },
    { code: "period", label: "Financial period is open or in close", ok: Boolean(period && period.status !== "CLOSED") },
  ]

  return (
    <div className="space-y-5">
      <Hero
        eyebrow="Stock Lifecycle - Year Close"
        title={`Year Close - ${financialYear}`}
        copy="Run the close checklist, snapshot stock, lock the year, and generate next-year opening balances from the approved closing state."
        actions={
          <>
            <Button className="rounded-full bg-white text-slate-950 hover:bg-blue-50" disabled={startPeriod.isPending} onClick={() => startPeriod.mutate()}>Open period</Button>
            <Button variant="outline" className="rounded-full border-white/25 bg-white/10 text-white hover:bg-white/20" onClick={exportPreview}><Download className="mr-2 h-4 w-4" />Export preview</Button>
          </>
        }
        metrics={[
          { label: "Status", value: period?.status || "None", sub: period?.financial_year || "Start period" },
          { label: "Bulk kg", value: qty(preview?.totals?.bulk_kg || 0), sub: "Closing snapshot" },
          { label: "Roll kg", value: qty(preview?.totals?.roll_kg || 0), sub: "Serialized stock" },
          { label: "Packaging", value: qty(preview?.totals?.packaging_qty || 0), sub: "Base UOM" },
          { label: "Blockers", value: qty(preview?.blockers?.length || 0), sub: "Must be zero" },
        ]}
      />

      <Card className="rounded-[18px] border-slate-200 bg-white shadow-sm">
        <CardContent className="grid gap-3 p-4 lg:grid-cols-[220px_260px_1fr_auto_auto] lg:items-end">
          <Field label="Financial year"><Input value={financialYear} onChange={(event) => setFinancialYear(event.target.value)} /></Field>
          <Field label="Plant">
            <Select value={selectedPlant || "__none__"} onValueChange={(value) => setSelectedPlant(value === "__none__" ? "" : value)}>
              <SelectTrigger><SelectValue placeholder="Select plant" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Select plant</SelectItem>
                {(plants as any[]).map((plant) => <SelectItem key={plant.id} value={String(plant.id)}>{plant.code ? `${plant.code} - ${plant.name}` : plant.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <div className="rounded-[14px] border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-600">
            {isFetching ? "Refreshing close preview..." : `Rows: ${preview?.totals?.rows || 0} - Value: ${money(preview?.totals?.value || 0)}`}
          </div>
          <Button variant="outline" disabled={!period || beginClose.isPending} onClick={() => beginClose.mutate()}><RefreshCw className="mr-2 h-4 w-4" />Begin close</Button>
          <Button className="bg-slate-950 hover:bg-slate-800" disabled={!period || !selectedPlant || closePeriod.isPending || Boolean(preview?.blockers?.length)} onClick={() => closePeriod.mutate()}><LockKeyhole className="mr-2 h-4 w-4" />Execute close</Button>
        </CardContent>
      </Card>

      <section className="grid gap-5 xl:grid-cols-[1fr_420px]">
        <Card className="rounded-[18px] border-slate-200 bg-white shadow-sm">
          <CardHeader><CardTitle className="text-lg font-black">Closing Stock Snapshot</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="min-w-[860px] w-full text-sm">
              <thead className="bg-slate-50 text-left text-[10px] font-black uppercase tracking-[0.14em] text-slate-500"><tr><th className="px-4 py-3">Class</th><th>Material</th><th>Location</th><th className="text-right">Qty</th><th>UOM</th></tr></thead>
              <tbody>
                {(preview?.rows || []).slice(0, 180).map((row: any, index: number) => (
                  <tr key={`${row.stock_class}-${row.material}-${index}`} className="border-t border-slate-100"><td className="px-4 py-3 font-black">{row.stock_class}</td><td>{row.material_code} - {row.material_name}</td><td>{row.location_name}</td><td className="text-right font-black">{qty(row.qty)}</td><td>{row.uom}</td></tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
        <Card className="rounded-[18px] border-slate-200 bg-white shadow-sm">
          <CardHeader><CardTitle className="text-lg font-black">Close Checklist</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {checks.map((check) => <CheckRow key={check.code} ok={check.ok} label={check.label} />)}
            {preview?.blockers?.length ? (
              <div className="space-y-2 pt-2">
                {preview.blockers.map((blocker: any) => (
                  <div key={blocker.code} className="rounded-[14px] border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                    <div className="font-black">{blocker.label}</div>
                    <div>{blocker.count} open item(s)</div>
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </section>
    </div>
  )
}

function CheckRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className={`flex items-center gap-3 rounded-[14px] border p-3 ${ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
      <span className={`flex h-7 w-7 items-center justify-center rounded-full ${ok ? "bg-emerald-700 text-white" : "bg-amber-600 text-white"}`}>{ok ? "✓" : "!"}</span>
      <span className="text-sm font-black">{label}</span>
    </div>
  )
}

function LifecycleHelpPanel() {
  const formulas = [
    { label: "Opening Stock", math: "opening_qty sets the balance", note: "It is absolute, not plus/minus. Existing opening rows are audit anchors." },
    { label: "Stock Count", math: "variance = counted_qty - system_qty", note: "Positive variance posts COUNT_EXCESS. Negative variance posts COUNT_SHORT." },
    { label: "Stock Card", math: "balance = previous_balance + in_qty - out_qty", note: "FY close snapshots are skipped because they are proof rows, not stock movement." },
    { label: "FY Correction", math: "corrected_close = current_system + delta", note: "A closed-year correction also updates next FY opening so the two years reconcile." },
  ]
  const flow = [
    "Create sheet with FY, plant, notes, and class.",
    "Enter rows manually, import CSV/XLSX, or load live system stock.",
    "Validate material, location, quantity, roll size, duplicate labels, and FY rules.",
    "Preview kg/value impact before any stock moves.",
    "Submit and approve with maker-checker separation.",
    "Post transactions, write audit events, refresh Stock Card and stock pools.",
  ]
  const auditRules = [
    "Opening stock is blocked after any same-FY non-opening movement for that material/location.",
    "Posted and locked batches are immutable; use Stock Count or FY Correction instead of editing history.",
    "FY Correction is allowed only for a closed financial year and requires a written reason.",
    "Every create, submit, approve, cancel, post, and correction roll-forward sync mirrors to the audit console.",
  ]

  return (
    <div className="space-y-5">
      <Hero
        eyebrow="Stock Lifecycle - Help"
        title="Lifecycle Help & Flow"
        copy="A daily operator guide for opening stock, physical count, stock card reconciliation, year close, and closed-year corrections. The rules below match the backend posting logic."
        actions={<Button className="rounded-full bg-white text-slate-950 hover:bg-blue-50" onClick={() => window.print()}><Download className="mr-2 h-4 w-4" />Print guide</Button>}
        metrics={[
          { label: "Pattern", value: "6 steps", sub: "Sheet to post" },
          { label: "Approval", value: "Maker", sub: "Checker required" },
          { label: "Ledger", value: "Running", sub: "FY bounded" },
          { label: "Audit", value: "Every action", sub: "Reason and actor" },
          { label: "Close", value: "Atomic", sub: "No partial close" },
        ]}
      />

      <section className="grid gap-5 xl:grid-cols-[1.08fr_0.92fr]">
        <Card className="overflow-hidden rounded-[18px] border-slate-200 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg font-black">
              <BookOpenCheck className="h-5 w-5 text-blue-700" />
              End-to-end flow diagram
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="overflow-hidden rounded-[18px] border border-slate-200 bg-slate-50">
              <img src="/help/stock-lifecycle-flow.svg" alt="Stock lifecycle flow diagram" className="h-auto w-full" />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {flow.map((item, index) => (
                <div key={item} className="flex gap-3 rounded-[14px] border border-slate-200 bg-white p-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-700 text-xs font-black text-white">{index + 1}</span>
                  <div className="text-sm font-semibold leading-5 text-slate-700">{item}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-[18px] border-slate-200 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg font-black">
              <Scale className="h-5 w-5 text-emerald-700" />
              Math rules used by the backend
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {formulas.map((formula) => (
              <div key={formula.label} className="rounded-[14px] border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">{formula.label}</div>
                <div className="mt-1 font-mono text-sm font-black text-slate-950">{formula.math}</div>
                <div className="mt-2 text-sm font-semibold leading-5 text-slate-600">{formula.note}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <Card className="rounded-[18px] border-slate-200 bg-white shadow-sm">
          <CardHeader><CardTitle className="text-lg font-black">Audit guardrails</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {auditRules.map((rule) => (
              <div key={rule} className="flex gap-3 rounded-[14px] border border-amber-200 bg-amber-50 p-3 text-sm font-semibold leading-5 text-amber-900">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                {rule}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="rounded-[18px] border-slate-200 bg-white shadow-sm">
          <CardHeader><CardTitle className="text-lg font-black">What users do every day</CardTitle></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {[
              ["Opening", "Use once at FY start or migration. Enter absolute balances and post only after approval."],
              ["Count", "Load live stock, enter physical count, preview shortage/excess, approve, and post variance."],
              ["Stock Card", "Filter by FY, material, plant, and location to see source, in, out, balance, rate, and value."],
              ["Year Close", "Preview closing stock, clear blockers, execute close, and generate next FY opening rows."],
              ["Correction", "For closed years only. State why, approve separately, post delta, and sync next opening."],
              ["Help", "Keep this guide open during training, month-end count, and yearly close rehearsal."],
            ].map(([title, text]) => (
              <div key={title} className="rounded-[14px] border border-slate-200 bg-white p-4 shadow-sm">
                <div className="text-sm font-black text-slate-950">{title}</div>
                <div className="mt-2 text-sm font-semibold leading-5 text-slate-600">{text}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>
    </div>
  )
}

function StockCardPanel() {
  const [filters, setFilters] = useState<Record<string, string>>({ financial_year: currentFy() })
  const { data: plants = [] } = useQuery({ queryKey: ["factory-plants"], queryFn: factoryService.getPlants })
  const { data: locations = [] } = useQuery({ queryKey: ["factory-locations"], queryFn: factoryService.getLocations })
  const { data: materials = [] } = useQuery({ queryKey: ["master-library"], queryFn: () => masterDataService.getLibrary() })
  const normalizedFilters = useMemo(
    () => Object.fromEntries(Object.entries(filters).filter(([, value]) => value && value !== "__all__")),
    [filters],
  )
  const { data: stockCard, isFetching } = useQuery<StockCardPayload>({
    queryKey: ["inventory-stock-card", normalizedFilters],
    queryFn: () => inventoryService.getStockCard(normalizedFilters),
  })

  async function exportLedger() {
    try {
      await downloadBlob(inventoryService.getStockCardExportUrl(), normalizedFilters, "stock-card.xlsx")
      toast.success("Stock card exported")
    } catch (error) {
      toast.error("Stock card export failed", { description: errText(error) })
    }
  }

  const rows = stockCard?.rows || []
  return (
    <div className="space-y-5">
      <Hero
        eyebrow="Stock Lifecycle - Stock Card"
        title="Material Stock Card"
        copy="Running balance ledger for any material, plant, and location. Every source row is traceable back to GRN, count, opening, correction, roll movement, or packaging transaction."
        actions={<Button className="rounded-full bg-white text-slate-950 hover:bg-blue-50" onClick={exportLedger}><Download className="mr-2 h-4 w-4" />Export ledger</Button>}
        metrics={[
          { label: "Opening", value: qty(stockCard?.opening_qty || 0), sub: "Opening balance rows" },
          { label: "Movement", value: qty(stockCard?.movement_qty || 0), sub: "Inward minus outward" },
          { label: "Closing", value: qty(stockCard?.closing_qty || 0), sub: "Running balance" },
          { label: "Rows", value: qty(rows.length), sub: isFetching ? "Refreshing" : "Trace rows" },
          { label: "Value", value: money(rows.at(-1)?.value || 0), sub: "Last balance value" },
        ]}
      />

      <Card className="rounded-[18px] border-slate-200 bg-white shadow-sm">
        <CardContent className="grid gap-3 p-4 lg:grid-cols-6">
          <Input data-testid="stock-card-financial-year" value={filters.financial_year || currentFy()} onChange={(event) => setFilters((prev) => ({ ...prev, financial_year: event.target.value }))} placeholder="FY 2026-2027" />
          <Select value={filters.material || "__all__"} onValueChange={(value) => setFilters((prev) => ({ ...prev, material: value }))}>
            <SelectTrigger><SelectValue placeholder="Material" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All materials</SelectItem>
              {(materials as any[]).map((m) => <SelectItem key={m.id} value={String(m.id)}>{m.code} - {m.name || m.code}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filters.plant || "__all__"} onValueChange={(value) => setFilters((prev) => ({ ...prev, plant: value, location: "__all__" }))}>
            <SelectTrigger><SelectValue placeholder="Plant" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All plants</SelectItem>
              {(plants as any[]).map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.code ? `${p.code} - ${p.name}` : p.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filters.location || "__all__"} onValueChange={(value) => setFilters((prev) => ({ ...prev, location: value }))}>
            <SelectTrigger><SelectValue placeholder="Location" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All locations</SelectItem>
              {(locations as any[])
                .filter((l) => !filters.plant || filters.plant === "__all__" || String(l.plant) === String(filters.plant))
                .map((l) => <SelectItem key={l.id} value={String(l.id)}>{l.code ? `${l.code} - ${l.name}` : l.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={filters.from || ""} onChange={(event) => setFilters((prev) => ({ ...prev, from: event.target.value }))} />
          <Input type="date" value={filters.to || ""} onChange={(event) => setFilters((prev) => ({ ...prev, to: event.target.value }))} />
        </CardContent>
      </Card>

      <Card className="rounded-[18px] border-slate-200 bg-white shadow-sm">
        <CardHeader><CardTitle className="flex items-center gap-2 text-lg font-black"><Layers3 className="h-5 w-5 text-blue-700" />Running Balance {isFetching ? "refreshing..." : ""}</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="min-w-[1080px] w-full text-sm">
            <thead className="bg-slate-50 text-left text-[10px] font-black uppercase tracking-[0.14em] text-slate-500"><tr><th className="px-4 py-3">Date</th><th>Source</th><th>Reference</th><th>Material</th><th>Location</th><th className="text-right">In</th><th className="text-right">Out</th><th className="text-right">Balance</th><th className="text-right">Value</th></tr></thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${row.reference}-${index}`} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 text-xs font-semibold text-slate-600">{new Date(row.at).toLocaleString()}</td>
                  <td className="font-black text-slate-900">{row.source}</td>
                  <td className="font-mono text-xs font-bold text-blue-700">{row.reference}</td>
                  <td>{row.material_code} - {row.material_name}</td>
                  <td>{row.location_name}</td>
                  <td className="text-right font-black text-emerald-700">{row.in_qty ? qty(row.in_qty) : "-"}</td>
                  <td className="text-right font-black text-rose-700">{row.out_qty ? qty(row.out_qty) : "-"}</td>
                  <td className="text-right font-black">{qty(row.balance_qty ?? row.qty)}</td>
                  <td className="text-right font-black">{row.value == null ? "-" : money(row.value)}</td>
                </tr>
              ))}
              {!rows.length ? <tr><td colSpan={9} className="px-4 py-12 text-center text-sm font-semibold text-slate-500">No ledger rows match the selected filters.</td></tr> : null}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
