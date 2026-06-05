"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, CheckCircle2, Layers3, Loader2, MapPin, PackageCheck, Save, Search } from "lucide-react"

import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { factoryService, type Location } from "@/services/factory"
import {
    stockLifecycleService,
    type MasterCatalog,
    type StockLifecycleRow,
} from "@/services/stock-lifecycle"

const VARIANCE_THRESHOLD = 2 // percent

type CountScope = "ALL" | "RAW" | "ROLL" | "PACKING"

const SCOPE_OPTIONS: Array<{ value: CountScope; label: string; description: string }> = [
    { value: "ALL", label: "All", description: "Plant-wide partial count" },
    { value: "RAW", label: "Bulk", description: "Granules, inks, adhesives" },
    { value: "ROLL", label: "Rolls", description: "Roll labels and WIP" },
    { value: "PACKING", label: "Packing", description: "Packing and add-ons" },
]

const ALL_LOCATIONS = "__all_locations__"
const ALL_ROLL_FORMS = "__all_roll_forms__"
const ALL_GRANULE_CODES = "__all_granule_codes__"

const STOCK_FORM_LABELS: Record<string, string> = {
    OPEN_WEB: "Open web / sheet",
    LAYFLAT_TUBE: "Lay-flat tube",
    FOLDED_WEB: "Folded web",
}

const COUNT_REASON_CODES = [
    { value: "BOOK_TO_PHYSICAL_VARIANCE", label: "Book vs physical" },
    { value: "MISPLACED_STOCK", label: "Found / misplaced" },
    { value: "DAMAGE_OR_SCRAP", label: "Damage / scrap" },
    { value: "DATA_ENTRY_CORRECTION", label: "Data entry" },
    { value: "OTHER", label: "Other" },
]

function datetimeLocalValue(date = new Date()) {
    const offset = date.getTimezoneOffset()
    const local = new Date(date.getTime() - offset * 60_000)
    return local.toISOString().slice(0, 16)
}

interface CountTabProps {
    plantId: string
    catalog: MasterCatalog
    categoryFilter: string | null
}

interface CountDraft {
    counted: string
    reason: string
    reasonCode?: string
    locationId?: string
}

interface CountRow {
    rowKey: string
    materialId: string
    code: string
    name: string
    category: string
    stock_class: "BULK" | "ROLL" | "PACKAGING"
    reportingScope: CountScope
    base_uom: string
    system_qty: number
    locationId: string | null
    locationName: string
    locationLocked: boolean
    labelId?: string
    batchNo?: string
    grade?: string | null
    widthMm?: number | null
    thicknessMicron?: number | null
    lengthM?: number | null
    isFg?: boolean
    status?: string
    rate?: number | null
    granuleCodeId?: string | null
    granuleCodeLabel?: string | null
    stockForm?: string
    widthBasis?: string
}

function rowCategory(row: Record<string, any>) {
    return String(row.category || row.material_category || "").toUpperCase()
}

function reportingScopeFor(stockClass: string, category: string): CountScope {
    if (stockClass === "ROLL") return "ROLL"
    if (stockClass === "PACKAGING" || category === "ADDON" || category === "PACKAGING") return "PACKING"
    return "RAW"
}

function stockClassFor(row: Record<string, any>): "BULK" | "ROLL" | "PACKAGING" {
    const stockClass = String(row.stock_class || "").toUpperCase()
    if (stockClass === "ROLL" || stockClass === "PACKAGING") return stockClass
    return "BULK"
}

function computeVariance(system: number, counted: number) {
    if (system === 0 && counted === 0) return 0
    if (system === 0) return 100
    return ((counted - system) / system) * 100
}

function formatQty(value: number) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 3 })
}

function normalizeScope(value: string | null | undefined): CountScope {
    const normalized = String(value || "").toUpperCase()
    if (normalized === "BULK") return "RAW"
    if (normalized === "PACKAGING") return "PACKING"
    if (normalized === "RAW" || normalized === "ROLL" || normalized === "PACKING" || normalized === "ALL") {
        return normalized as CountScope
    }
    return "ALL"
}

function stockClassFiltersForScope(scope: CountScope) {
    if (scope === "RAW") return ["BULK"]
    if (scope === "ROLL") return ["ROLL"]
    if (scope === "PACKING") return ["PACKAGING"]
    return []
}

function snapshotCountRows(snapshotRows: Array<Record<string, any>>): CountRow[] {
    return snapshotRows
        .map((row, index) => {
            const stockClass = stockClassFor(row)
            const category = rowCategory(row)
            const materialId = String(row.material || row.material_id || "")
            const locationId = row.location ? String(row.location) : null
            const labelId = row.label_id ? String(row.label_id) : undefined
            const qty = Number(row.qty ?? row.quantity ?? row.qty_kg ?? row.weight_kg ?? 0) || 0
            if (!materialId || qty <= 0) return null
            return {
                rowKey: [
                    stockClass,
                    materialId,
                    locationId || "none",
                    row.granule_code || "",
                    row.stock_form || "",
                    labelId || "",
                    index,
                ].join(":"),
                materialId,
                code: stockClass === "ROLL" ? labelId || row.material_code || "ROLL" : row.material_code || row.code || "-",
                name: row.material_name || row.name || "Stock item",
                category,
                stock_class: stockClass,
                reportingScope: reportingScopeFor(stockClass, category),
                base_uom: row.uom || row.base_uom || (stockClass === "PACKAGING" ? "PCS" : "KG"),
                system_qty: qty,
                locationId,
                locationName: row.location_name || "No location",
                locationLocked: Boolean(locationId),
                labelId,
                batchNo: row.batch_no || undefined,
                grade: row.grade || undefined,
                widthMm: row.width_mm == null ? null : Number(row.width_mm),
                thicknessMicron: row.thickness_micron == null ? null : Number(row.thickness_micron),
                lengthM: row.length_m == null ? null : Number(row.length_m),
                isFg: Boolean(row.is_fg),
                status: row.status || undefined,
                rate: row.rate == null ? null : Number(row.rate),
                granuleCodeId: row.granule_code ? String(row.granule_code) : null,
                granuleCodeLabel: row.granule_code_label || null,
                stockForm: row.stock_form || "",
                widthBasis: row.width_basis || "",
            } satisfies CountRow
        })
        .filter(Boolean) as CountRow[]
}

function foundStockMasterRows(catalogRows: StockLifecycleRow[], represented: Set<string>): CountRow[] {
    return catalogRows
        .filter((row) => row.stock_class !== "ROLL")
        .map((row) => {
            const category = String(row.category || "").toUpperCase()
            const stockClass = row.stock_class === "PACKAGING" ? "PACKAGING" : "BULK"
            const hasSystemRow = represented.has(`${stockClass}:${row.id}`)
            return {
                rowKey: `${stockClass}:${row.id}:found`,
                materialId: row.id,
                code: hasSystemRow ? `${row.code}-FOUND` : row.code,
                name: row.name,
                category,
                stock_class: stockClass,
                reportingScope: reportingScopeFor(stockClass, category),
                base_uom: row.base_uom || (stockClass === "PACKAGING" ? "PCS" : "KG"),
                system_qty: 0,
                locationId: null,
                locationName: hasSystemRow ? "Found at another location" : "Select location",
                locationLocked: false,
                rate: null,
                granuleCodeId: null,
                granuleCodeLabel: null,
                stockForm: "",
                widthBasis: "",
            } satisfies CountRow
        })
}

export function CountTab({ plantId, catalog, categoryFilter }: CountTabProps) {
    const qc = useQueryClient()
    const { toast } = useToast()
    const searchParams = useSearchParams()
    const [search, setSearch] = React.useState("")
    const [scope, setScope] = React.useState<CountScope>("ALL")
    const [locationFilter, setLocationFilter] = React.useState(ALL_LOCATIONS)
    const [rollFormFilter, setRollFormFilter] = React.useState(ALL_ROLL_FORMS)
    const [granuleCodeFilter, setGranuleCodeFilter] = React.useState(ALL_GRANULE_CODES)
    const [drafts, setDrafts] = React.useState<Record<string, CountDraft>>({})
    const [countedAsOf, setCountedAsOf] = React.useState(datetimeLocalValue())
    const [countPolicy, setCountPolicy] = React.useState("SOFT_FREEZE")

    React.useEffect(() => {
        const requestedScope = searchParams?.get("scope")
        if (requestedScope) setScope(normalizeScope(requestedScope))
        const requestedLocation = searchParams?.get("location")
        if (requestedLocation) setLocationFilter(requestedLocation)
        const requestedRollForm = searchParams?.get("roll_form")
        if (requestedRollForm) setRollFormFilter(requestedRollForm)
        const requestedGranuleCode = searchParams?.get("granule_code")
        if (requestedGranuleCode) setGranuleCodeFilter(requestedGranuleCode)
    }, [searchParams])

    const { data: snapshot } = useQuery({
        queryKey: ["stock-lifecycle", "count-snapshot", plantId],
        queryFn: () => stockLifecycleService.getSnapshot(plantId),
        enabled: Boolean(plantId),
        staleTime: 20_000,
    })

    const { data: locations = [] } = useQuery({
        queryKey: ["stock-lifecycle", "count-locations"],
        queryFn: () => factoryService.getLocations(),
        staleTime: 60_000,
    })

    const plantLocations = React.useMemo(
        () => (locations as Location[]).filter((location) => String(location.plant) === String(plantId) && location.is_active !== false),
        [locations, plantId],
    )

    const allRows = React.useMemo(() => {
        const stockRows = Array.isArray((snapshot as any)?.rows) ? ((snapshot as any).rows as Array<Record<string, any>>) : []
        const rows = snapshotCountRows(stockRows)
        const represented = new Set(rows.map((row) => `${row.stock_class}:${row.materialId}`))
        return [...rows, ...foundStockMasterRows(catalog.rows, represented)]
    }, [catalog.rows, snapshot])

    const rows = React.useMemo(() => {
        let filtered = allRows
        if (scope !== "ALL") filtered = filtered.filter((row) => row.reportingScope === scope)
        if (rollFormFilter !== ALL_ROLL_FORMS) {
            filtered = filtered.filter((row) => row.stock_class === "ROLL" && row.stockForm === rollFormFilter)
        }
        if (granuleCodeFilter !== ALL_GRANULE_CODES) {
            filtered = filtered.filter((row) => row.stock_class === "BULK" && row.granuleCodeId === granuleCodeFilter)
        }
        if (locationFilter !== ALL_LOCATIONS) {
            filtered = filtered.filter((row) => !row.locationId || row.locationId === locationFilter)
        }
        if (categoryFilter) filtered = filtered.filter((row) => row.category === String(categoryFilter).toUpperCase())
        if (search.trim()) {
            const q = search.trim().toLowerCase()
            filtered = filtered.filter(
                (row) =>
                    row.code.toLowerCase().includes(q) ||
                    row.name.toLowerCase().includes(q) ||
                    row.locationName.toLowerCase().includes(q) ||
                    (row.labelId || "").toLowerCase().includes(q) ||
                    (row.granuleCodeLabel || "").toLowerCase().includes(q) ||
                    (row.stockForm || "").toLowerCase().includes(q),
            )
        }
        return filtered
    }, [allRows, categoryFilter, granuleCodeFilter, locationFilter, rollFormFilter, scope, search])

    const rollFormOptions = React.useMemo(() => {
        const forms = new Set<string>()
        for (const row of allRows) {
            if (row.stock_class === "ROLL" && row.stockForm) forms.add(row.stockForm)
        }
        return Array.from(forms).sort()
    }, [allRows])

    const granuleCodeOptions = React.useMemo(() => {
        const map = new Map<string, string>()
        for (const row of allRows) {
            if (row.stock_class === "BULK" && row.granuleCodeId) {
                map.set(row.granuleCodeId, row.granuleCodeLabel || row.code)
            }
        }
        return Array.from(map, ([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label))
    }, [allRows])

    const setDraft = (rowKey: string, patch: Partial<CountDraft>) => {
        setDrafts((prev) => {
            const existing: CountDraft = prev[rowKey] ?? { counted: "", reason: "" }
            return { ...prev, [rowKey]: { ...existing, ...patch } }
        })
    }

    const selectedLocation = React.useCallback(
        (row: CountRow, draft?: CountDraft) => draft?.locationId || row.locationId || (locationFilter !== ALL_LOCATIONS ? locationFilter : ""),
        [locationFilter],
    )

    const selectedLocationName = React.useMemo(() => {
        if (locationFilter === ALL_LOCATIONS) return ""
        return plantLocations.find((location) => location.id === locationFilter)?.name || "Selected location"
    }, [locationFilter, plantLocations])

    const countMode = React.useMemo(() => {
        const scopeLabel = SCOPE_OPTIONS.find((item) => item.value === scope)?.label || "All"
        const locationLabel = selectedLocationName || "all locations"
        const rollFormLabel = rollFormFilter !== ALL_ROLL_FORMS ? STOCK_FORM_LABELS[rollFormFilter] || rollFormFilter.replace(/_/g, " ") : ""
        const granuleLabel = granuleCodeFilter !== ALL_GRANULE_CODES ? granuleCodeOptions.find((item) => item.id === granuleCodeFilter)?.label || "selected granule code" : ""
        const narrowed = [rollFormLabel, granuleLabel].filter(Boolean).join(" · ")
        const mode =
            locationFilter !== ALL_LOCATIONS
                ? `${scopeLabel} · ${locationLabel}${narrowed ? ` · ${narrowed}` : ""}`
                : scope === "ALL"
                    ? `Plant-wide partial count${narrowed ? ` · ${narrowed}` : ""}`
                    : `${scopeLabel} partial count${narrowed ? ` · ${narrowed}` : ""}`
        return { scopeLabel, locationLabel, mode, rollFormLabel, granuleLabel }
    }, [granuleCodeFilter, granuleCodeOptions, locationFilter, rollFormFilter, scope, selectedLocationName])

    const stats = React.useMemo(() => {
        let overThreshold = 0
        let ready = 0
        let missingReason = 0
        let missingLocation = 0
        for (const row of rows) {
            const draft = drafts[row.rowKey]
            if (!draft || draft.counted === "") continue
            const counted = Number(draft.counted)
            if (Number.isNaN(counted)) continue
            const variance = Math.abs(computeVariance(row.system_qty, counted))
            const hasLocation = Boolean(selectedLocation(row, draft))
            if (!hasLocation) {
                missingLocation += 1
                continue
            }
            if (variance >= VARIANCE_THRESHOLD) {
                overThreshold += 1
                if (!draft.reason.trim() || !draft.reasonCode) {
                    missingReason += 1
                } else {
                    ready += 1
                }
            } else {
                ready += 1
            }
        }
        return { overThreshold, ready, missingReason, missingLocation, blocked: missingReason + missingLocation }
    }, [drafts, rows, selectedLocation])

    const mutation = useMutation({
        mutationFn: async () => {
            const lines = rows
                .map((row) => {
                    const draft = drafts[row.rowKey]
                    if (!draft || draft.counted === "") return null
                    const counted = Number(draft.counted)
                    if (Number.isNaN(counted)) return null
                    const variance = Math.abs(computeVariance(row.system_qty, counted))
                    if (variance >= VARIANCE_THRESHOLD && (!draft.reason.trim() || !draft.reasonCode)) {
                        throw new Error(`Row ${row.code} has ${variance.toFixed(1)}% variance; a reason code and note are required.`)
                    }
                    const locationId = selectedLocation(row, draft)
                    if (!locationId) {
                        throw new Error(`Select a location for ${row.code} before posting the count.`)
                    }
                    return {
                        stock_class: row.stock_class,
                        material: row.materialId,
                        location: locationId,
                        quantity: row.system_qty,
                        counted_qty: counted,
                        uom: row.base_uom,
                        notes: draft.reason || "",
                        label_id: row.labelId || "",
                        batch_no: row.batchNo || "",
                        grade: row.grade || null,
                        width_mm: row.widthMm || undefined,
                        thickness_micron: row.thicknessMicron || undefined,
                        length_m: row.lengthM || undefined,
                        is_fg: row.isFg || false,
                        status: row.status || "AVAILABLE",
                        rate: row.rate || undefined,
                        granule_code: row.granuleCodeId || undefined,
                        stock_form: row.stockForm || undefined,
                        width_basis: row.widthBasis || undefined,
                        count_reason_code: draft.reasonCode || "",
                        count_reason_note: draft.reason || "",
                        counted_at: countedAsOf ? new Date(countedAsOf).toISOString() : new Date().toISOString(),
                        entry_at: new Date().toISOString(),
                    }
                })
                .filter(Boolean) as Array<Record<string, unknown>>

            if (lines.length === 0) {
                throw new Error("Enter counted quantity for at least one row. Physical count posts only rows you enter.")
            }

            const scopeLabel = countMode.scopeLabel
            const locationLabel = countMode.locationLabel
            const searchLabel = search.trim() ? ` · item filter: ${search.trim()}` : ""
            const rollFormLabel = countMode.rollFormLabel ? ` · ${countMode.rollFormLabel}` : ""
            const granuleLabel = countMode.granuleLabel ? ` · granule code ${countMode.granuleLabel}` : ""
            const batchLabel = `${locationFilter !== ALL_LOCATIONS ? "Location" : "Plant"} ${scopeLabel}${rollFormLabel}${granuleLabel} physical count`

            const batch: any = await stockLifecycleService.createCountBatch({
                type: "PHYSICAL_COUNT",
                plant: plantId,
                cutoff_at: countedAsOf ? new Date(countedAsOf).toISOString() : new Date().toISOString(),
                notes: `${batchLabel} · ${locationLabel}${searchLabel} · ${lines.length} counted row${lines.length === 1 ? "" : "s"}`,
                _v36_workflow: {
                    scope: locationFilter !== ALL_LOCATIONS ? "LOCATION_PARTIAL" : scope === "ALL" ? "PLANT_PARTIAL" : `${scope}_PARTIAL`,
                    name: batchLabel,
                    label: `${batchLabel} · ${locationLabel}`,
                    count_policy: countPolicy,
                    counted_as_of: countedAsOf ? new Date(countedAsOf).toISOString() : new Date().toISOString(),
                    entry_at: new Date().toISOString(),
                    klass_filter: stockClassFiltersForScope(scope),
                    filters: {
                        plant_id: plantId,
                        location_id: locationFilter === ALL_LOCATIONS ? "" : locationFilter,
                        location_name: locationFilter === ALL_LOCATIONS ? "" : locationLabel,
                        item_search: search.trim(),
                        category: categoryFilter || "",
                        roll_stock_form: rollFormFilter === ALL_ROLL_FORMS ? "" : rollFormFilter,
                        roll_stock_form_label: countMode.rollFormLabel,
                        granule_code_id: granuleCodeFilter === ALL_GRANULE_CODES ? "" : granuleCodeFilter,
                        granule_code_label: countMode.granuleLabel,
                    },
                    counted_rows: lines.length,
                },
                lines,
            })
            const batchId = batch?.id || batch?.batch_id || batch?.data?.id || batch?.data?.batch_id
            if (batchId) {
                await stockLifecycleService.postBatch(batchId)
            }
            try {
                await stockLifecycleService.createInventorySnapshot(plantId)
            } catch {
                // The posted audit batch is the source of truth; trend snapshots are best-effort.
            }
            return { batch, rows: lines.length }
        },
        onSuccess: (result) => {
            toast({
                title: "Physical count posted",
                description: `${result.rows} row${result.rows === 1 ? "" : "s"} committed; snapshot refreshed.`,
            })
            setDrafts({})
            qc.invalidateQueries({ queryKey: ["stock-lifecycle", "catalog"] })
            qc.invalidateQueries({ queryKey: ["stock-lifecycle", "count-snapshot"] })
            qc.invalidateQueries({ queryKey: ["stock-lifecycle", "audit-snapshot"] })
            qc.invalidateQueries({ queryKey: ["stock-lifecycle", "inventory-snapshot"] })
            qc.invalidateQueries({ queryKey: ["stock-lifecycle", "inventory-trend"] })
            qc.invalidateQueries({ queryKey: ["stock-lifecycle", "audit-batches"] })
            qc.invalidateQueries({ queryKey: ["stock-lifecycle", "closing-preview"] })
        },
        onError: (err: any) => {
            toast({
                title: "Failed to post physical count",
                description: err?.response?.data?.detail || err?.response?.data?.error || err?.message || "Please try again.",
                variant: "destructive" as any,
            })
        },
    })

    return (
        <div data-testid="stock-count-tab" className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-3">
                    <div className="relative min-w-[240px] flex-1">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-4" />
                        <Input
                            data-testid="count-material-search"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Search material, roll label, location..."
                            className="pl-9"
                        />
                    </div>
                    <div className="flex flex-wrap gap-1 rounded-2xl border border-slate-200 bg-surface-1 p-1">
                        {SCOPE_OPTIONS.map((option) => (
                            <button
                                key={option.value}
                                type="button"
                                onClick={() => setScope(option.value)}
                                className={cn(
                                    "h-8 rounded-xl px-3 text-xs font-extrabold transition",
                                    scope === option.value
                                        ? "bg-slate-950 text-white"
                                        : "text-content-3 hover:bg-slate-100",
                                )}
                                title={option.description}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                    <Select value={locationFilter} onValueChange={setLocationFilter}>
                        <SelectTrigger data-testid="count-location-filter" className="h-10 rounded-xl border-slate-200 bg-surface-1 text-xs font-bold sm:w-[240px]">
                            <SelectValue placeholder="All locations" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ALL_LOCATIONS}>All plant locations</SelectItem>
                            {plantLocations.map((location) => (
                                <SelectItem key={location.id} value={location.id}>
                                    {location.code ? `${location.code} - ${location.name}` : location.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Select value={rollFormFilter} onValueChange={setRollFormFilter}>
                        <SelectTrigger data-testid="count-roll-form-filter" className="h-10 rounded-xl border-slate-200 bg-surface-1 text-xs font-bold sm:w-[210px]">
                            <SelectValue placeholder="All roll forms" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ALL_ROLL_FORMS}>All roll forms</SelectItem>
                            {rollFormOptions.map((form) => (
                                <SelectItem key={form} value={form}>
                                    {STOCK_FORM_LABELS[form] || form.replace(/_/g, " ")}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Select value={granuleCodeFilter} onValueChange={setGranuleCodeFilter}>
                        <SelectTrigger data-testid="count-granule-code-filter" className="h-10 rounded-xl border-slate-200 bg-surface-1 text-xs font-bold sm:w-[230px]">
                            <SelectValue placeholder="All granule codes" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ALL_GRANULE_CODES}>All granule inward codes</SelectItem>
                            {granuleCodeOptions.map((code) => (
                                <SelectItem key={code.id} value={code.id}>
                                    {code.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <div className="text-xs font-semibold text-slate-500">
                        {rows.length} row{rows.length === 1 ? "" : "s"} in scope
                    </div>
                </div>

                <div className="grid gap-2 md:grid-cols-4">
                    <div className="rounded-2xl border border-slate-200 bg-surface-1 px-4 py-3">
                        <div className="text-[10px] font-extrabold uppercase tracking-[0.13em] text-slate-500">Posting label</div>
                        <div className="mt-1 text-sm font-extrabold text-slate-950">{countMode.mode}</div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-surface-1 px-4 py-3">
                        <div className="text-[10px] font-extrabold uppercase tracking-[0.13em] text-slate-500">Count boundary</div>
                        <div className="mt-1 text-sm font-extrabold text-slate-950">
                            {locationFilter === ALL_LOCATIONS ? "Plant" : "Location"} + selected rows{countMode.rollFormLabel ? " + roll form" : ""}{countMode.granuleLabel ? " + granule code" : ""}
                        </div>
                    </div>
                    <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 px-4 py-3">
                        <div className="text-[10px] font-extrabold uppercase tracking-[0.13em] text-success-fg">Posting rule</div>
                        <div className="mt-1 text-sm font-extrabold text-emerald-950">Only entered quantities post</div>
                    </div>
                    <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 px-4 py-3">
                        <div className="text-[10px] font-extrabold uppercase tracking-[0.13em] text-indigo-700">Count effective</div>
                        <Input
                            type="datetime-local"
                            value={countedAsOf}
                            onChange={(event) => setCountedAsOf(event.target.value)}
                            className="mt-1 h-8 rounded-xl bg-surface-1 text-xs font-bold"
                        />
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-surface-1 px-4 py-3 md:col-span-4">
                        <div className="grid gap-2 md:grid-cols-[220px_minmax(0,1fr)]">
                            <Select value={countPolicy} onValueChange={setCountPolicy}>
                                <SelectTrigger className="h-9 rounded-xl text-xs font-bold">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="SOFT_FREEZE">Soft freeze · allow reviewed movement</SelectItem>
                                    <SelectItem value="HARD_FREEZE">Hard freeze · no movement until post</SelectItem>
                                    <SelectItem value="SPOT_COUNT">Spot count · selected rows only</SelectItem>
                                </SelectContent>
                            </Select>
                            <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs font-semibold text-content-3">
                                System quantity is loaded live; count cutoff and policy are stored with the audit batch so later reconciliation can separate count time from posting time.
                            </div>
                        </div>
                    </div>
                </div>

                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-surface-1 shadow-[0_8px_30px_-20px_rgba(15,23,42,0.18)]">
                    <div className="hidden grid-cols-[132px_minmax(0,1fr)_170px_105px_120px_105px_minmax(0,1fr)] gap-3 bg-slate-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 lg:grid">
                        <div>Code</div>
                        <div>Material</div>
                        <div>Location</div>
                        <div className="text-right">System</div>
                        <div>Counted</div>
                        <div className="text-right">Variance %</div>
                        <div>Reason</div>
                    </div>
                    <div className="divide-y divide-slate-100">
                        {rows.length === 0 ? (
                            <div className="p-10 text-center text-sm text-slate-500">
                                No count rows match the current scope.
                            </div>
                        ) : (
                            rows.map((row) => {
                                const draft = drafts[row.rowKey]
                                const counted = draft?.counted === "" || draft?.counted == null ? null : Number(draft.counted)
                                const variance = counted == null ? null : computeVariance(row.system_qty, counted)
                                const absVariance = variance == null ? 0 : Math.abs(variance)
                                const isOver = variance != null && absVariance >= VARIANCE_THRESHOLD
                                const isExact = variance != null && absVariance === 0
                                const locationMissing = Boolean(draft?.counted) && !selectedLocation(row, draft)
                                const reasonRequired = isOver && (!(draft?.reason || "").trim() || !draft?.reasonCode)

                                return (
                                    <div
                                        key={row.rowKey}
                                        data-testid={`count-row-${row.rowKey}`}
                                        className={cn(
                                            "grid gap-2 px-4 py-3 text-sm lg:grid-cols-[132px_minmax(0,1fr)_170px_105px_120px_105px_minmax(0,1fr)] lg:items-start lg:gap-3",
                                            (reasonRequired || locationMissing) && "bg-rose-50/40",
                                        )}
                                    >
                                        <div className="min-w-0">
                                            <div className="truncate font-mono text-xs text-slate-700">{row.code}</div>
                                            {row.labelId ? <div className="mt-1 text-[10px] font-bold text-violet-600">roll label</div> : null}
                                        </div>
                                        <div className="min-w-0">
                                            <div className="truncate text-content-2">{row.name}</div>
                                            <div className="mt-1 flex flex-wrap gap-1 text-[11px] text-slate-500">
                                                <Badge variant="outline" className="h-5 rounded-full border-slate-200 bg-slate-50 px-2 text-[10px]">
                                                    {row.category || "STOCK"}
                                                </Badge>
                                                <Badge variant="outline" className="h-5 rounded-full border-slate-200 bg-slate-50 px-2 text-[10px]">
                                                    {row.stock_class}
                                                </Badge>
                                                {row.granuleCodeLabel ? (
                                                    <Badge variant="outline" className="h-5 rounded-full border-warning-border bg-warning-bg px-2 text-[10px] text-amber-800">
                                                        code {row.granuleCodeLabel}
                                                    </Badge>
                                                ) : null}
                                                {row.stockForm ? (
                                                    <Badge variant="outline" className="h-5 rounded-full border-blue-200 bg-blue-50 px-2 text-[10px] text-blue-800">
                                                        {STOCK_FORM_LABELS[row.stockForm] || row.stockForm.replace(/_/g, " ")}
                                                    </Badge>
                                                ) : null}
                                                {row.status && row.stock_class === "ROLL" ? (
                                                    <Badge variant="outline" className="h-5 rounded-full border-success-border bg-success-bg px-2 text-[10px] text-emerald-800">
                                                        {row.isFg ? "FG" : "WIP"} · {row.status.replace(/_/g, " ")}
                                                    </Badge>
                                                ) : null}
                                                {row.batchNo ? <span className="font-mono">{row.batchNo}</span> : null}
                                            </div>
                                        </div>
                                        <div>
                                            {row.locationLocked ? (
                                                <div className="flex min-h-8 items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-2 text-xs font-semibold text-slate-700">
                                                    <MapPin className="h-3.5 w-3.5 text-content-4" />
                                                    <span className="truncate">{row.locationName}</span>
                                                </div>
                                            ) : (
                                                <Select
                                                    value={draft?.locationId || (locationFilter !== ALL_LOCATIONS ? locationFilter : "__none__")}
                                                    onValueChange={(value) => setDraft(row.rowKey, { locationId: value === "__none__" ? "" : value })}
                                                >
                                                    <SelectTrigger className={cn("h-8 rounded-xl text-xs", locationMissing && "border-rose-400 ring-1 ring-rose-200")}>
                                                        <SelectValue placeholder="Select location" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="__none__">Select location</SelectItem>
                                                        {plantLocations.map((location) => (
                                                            <SelectItem key={location.id} value={location.id}>
                                                                {location.code ? `${location.code} - ${location.name}` : location.name}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            )}
                                            {locationMissing ? <p className="mt-1 text-[11px] font-semibold text-danger-fg">Location required</p> : null}
                                        </div>
                                        <div className="text-right font-mono text-xs text-content-3 lg:pt-1.5">
                                            {formatQty(row.system_qty)} {row.base_uom}
                                        </div>
                                        <Input
                                            data-testid={`count-counted-${row.rowKey}`}
                                            type="number"
                                            inputMode="decimal"
                                            min="0"
                                            step="0.001"
                                            value={draft?.counted || ""}
                                            onChange={(event) => setDraft(row.rowKey, { counted: event.target.value })}
                                            placeholder="0.000"
                                            className="h-8"
                                        />
                                        <div
                                            className={cn(
                                                "text-right font-mono text-xs lg:pt-1.5",
                                                variance == null && "text-content-4",
                                                isExact && "text-success-fg",
                                                variance != null && !isExact && !isOver && "text-warning-fg",
                                                isOver && "font-semibold text-danger-fg",
                                            )}
                                        >
                                            {variance == null ? "-" : `${variance >= 0 ? "+" : ""}${variance.toFixed(2)}%`}
                                        </div>
                                        <div>
                                            {isOver ? (
                                                <Select
                                                    value={draft?.reasonCode || ""}
                                                    onValueChange={(value) => setDraft(row.rowKey, { reasonCode: value })}
                                                >
                                                    <SelectTrigger className={cn("mb-1 h-8 rounded-xl bg-surface-1 text-xs", reasonRequired && !draft?.reasonCode && "border-rose-400 ring-1 ring-rose-200")}>
                                                        <SelectValue placeholder="Reason code" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {COUNT_REASON_CODES.map((code) => (
                                                            <SelectItem key={code.value} value={code.value}>{code.label}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            ) : null}
                                            <Textarea
                                                data-testid={`count-reason-${row.rowKey}`}
                                                value={draft?.reason || ""}
                                                onChange={(event) => setDraft(row.rowKey, { reason: event.target.value })}
                                                disabled={!isOver}
                                                placeholder={isOver ? "Required note" : "-"}
                                                className={cn(
                                                    "min-h-[34px] text-xs",
                                                    reasonRequired && "border-rose-400 ring-1 ring-rose-200",
                                                )}
                                                rows={1}
                                            />
                                            {reasonRequired ? (
                                                <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-danger-fg">
                                                    <AlertTriangle className="h-3 w-3" />
                                                    Reason required
                                                </p>
                                            ) : null}
                                        </div>
                                    </div>
                                )
                            })
                        )}
                    </div>
                </div>
            </div>

            <aside className="space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-4 shadow-sm">
                    <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wide text-slate-500">
                        <Layers3 className="h-4 w-4" />
                        Count mode
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                        {SCOPE_OPTIONS.map((option) => (
                            <button
                                key={option.value}
                                type="button"
                                onClick={() => setScope(option.value)}
                                className={cn(
                                    "rounded-xl border px-3 py-2 text-left transition",
                                    scope === option.value
                                        ? "border-indigo-300 bg-indigo-50 text-indigo-800"
                                        : "border-slate-200 bg-surface-1 text-content-3 hover:border-line-strong",
                                )}
                            >
                                <span className="block text-xs font-extrabold">{option.label}</span>
                                <span className="mt-0.5 block text-[10px] font-semibold opacity-75">{option.description}</span>
                            </button>
                        ))}
                    </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-4 shadow-sm">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Variance summary</div>
                    <dl className="mt-3 space-y-2 text-sm">
                        <div className="flex items-center justify-between">
                            <dt className="text-content-3">Ready to post</dt>
                            <dd className="font-display text-base font-semibold text-success-fg">{stats.ready}</dd>
                        </div>
                        <div className="flex items-center justify-between">
                            <dt className="text-content-3">Over {VARIANCE_THRESHOLD}% threshold</dt>
                            <dd className="font-display text-base font-semibold text-warning-fg">{stats.overThreshold}</dd>
                        </div>
                        <div className="flex items-center justify-between">
                            <dt className="text-content-3">Missing reason</dt>
                            <dd className={cn("font-display text-base font-semibold", stats.missingReason > 0 ? "text-danger-fg" : "text-content-4")}>
                                {stats.missingReason}
                            </dd>
                        </div>
                        <div className="flex items-center justify-between">
                            <dt className="text-content-3">Missing location</dt>
                            <dd className={cn("font-display text-base font-semibold", stats.missingLocation > 0 ? "text-danger-fg" : "text-content-4")}>
                                {stats.missingLocation}
                            </dd>
                        </div>
                    </dl>
                    {stats.blocked > 0 ? (
                        <div className="mt-3 flex items-start gap-2 rounded-xl bg-danger-bg p-3 text-xs text-danger-fg">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                            Fix missing reasons or locations before posting.
                        </div>
                    ) : stats.ready > 0 ? (
                        <div className="mt-3 flex items-start gap-2 rounded-xl bg-success-bg p-3 text-xs text-emerald-800">
                            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                            Ready to post this partial count.
                        </div>
                    ) : (
                        <div className="mt-3 text-xs text-slate-500">
                            Enter counted quantities to build a batch.
                        </div>
                    )}
                    <Button
                        data-testid="count-post-batch"
                        className="mt-4 w-full bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 text-white hover:from-indigo-500 hover:via-violet-500 hover:to-fuchsia-500"
                        disabled={stats.ready === 0 || stats.blocked > 0 || mutation.isPending}
                        onClick={() => mutation.mutate()}
                    >
                        {mutation.isPending ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                            <Save className="mr-2 h-4 w-4" />
                        )}
                        Post physical count
                    </Button>
                </div>

                <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4 text-xs text-indigo-800">
                    <div className="flex items-center gap-2 font-semibold text-indigo-900">
                        <PackageCheck className="h-4 w-4" />
                        One stock-cycle truth
                    </div>
                    <p className="mt-1">
                        Use plant-wide, location, class, item, roll-form, or granule-code counts. The posted audit sheet keeps that label in snapshots and history.
                    </p>
                </div>
            </aside>
        </div>
    )
}
