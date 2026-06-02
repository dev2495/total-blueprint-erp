"use client"

import * as React from "react"
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
    { value: "ALL", label: "All", description: "Every stock class" },
    { value: "RAW", label: "Bulk", description: "Granules, inks, adhesives" },
    { value: "ROLL", label: "Rolls", description: "Physical roll rows" },
    { value: "PACKING", label: "Packing", description: "Packaging and add-ons" },
]

interface CountTabProps {
    plantId: string
    catalog: MasterCatalog
    categoryFilter: string | null
}

interface CountDraft {
    counted: string
    reason: string
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
            } satisfies CountRow
        })
}

export function CountTab({ plantId, catalog, categoryFilter }: CountTabProps) {
    const qc = useQueryClient()
    const { toast } = useToast()
    const [search, setSearch] = React.useState("")
    const [scope, setScope] = React.useState<CountScope>("ALL")
    const [drafts, setDrafts] = React.useState<Record<string, CountDraft>>({})

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
        if (categoryFilter) filtered = filtered.filter((row) => row.category === String(categoryFilter).toUpperCase())
        if (search.trim()) {
            const q = search.trim().toLowerCase()
            filtered = filtered.filter(
                (row) =>
                    row.code.toLowerCase().includes(q) ||
                    row.name.toLowerCase().includes(q) ||
                    row.locationName.toLowerCase().includes(q) ||
                    (row.labelId || "").toLowerCase().includes(q),
            )
        }
        return filtered
    }, [allRows, categoryFilter, scope, search])

    const setDraft = (rowKey: string, patch: Partial<CountDraft>) => {
        setDrafts((prev) => {
            const existing: CountDraft = prev[rowKey] ?? { counted: "", reason: "" }
            return { ...prev, [rowKey]: { ...existing, ...patch } }
        })
    }

    const selectedLocation = React.useCallback(
        (row: CountRow, draft?: CountDraft) => draft?.locationId || row.locationId || "",
        [],
    )

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
                if (!draft.reason.trim()) {
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
                    if (variance >= VARIANCE_THRESHOLD && !draft.reason.trim()) {
                        throw new Error(`Row ${row.code} has ${variance.toFixed(1)}% variance; a reason is required.`)
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
                    }
                })
                .filter(Boolean) as Array<Record<string, unknown>>

            if (lines.length === 0) {
                throw new Error("Enter counted quantity for at least one row. Physical count posts only rows you enter.")
            }

            const batch: any = await stockLifecycleService.createCountBatch({
                type: "PHYSICAL_COUNT",
                plant: plantId,
                cutoff_at: new Date().toISOString(),
                notes: `Stock Lifecycle ${scope === "ALL" ? "partial" : SCOPE_OPTIONS.find((item) => item.value === scope)?.label.toLowerCase()} physical count`,
                _v36_workflow: {
                    scope: scope === "ALL" ? "PARTIAL" : scope,
                    name: "Stock Lifecycle physical count",
                    klass_filter: scope === "ALL" ? [] : [scope],
                },
                lines,
            })
            const batchId = batch?.id || batch?.batch_id
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
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <Input
                            data-testid="count-material-search"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Search material, roll label, location..."
                            className="pl-9"
                        />
                    </div>
                    <div className="flex flex-wrap gap-1 rounded-2xl border border-slate-200 bg-white p-1">
                        {SCOPE_OPTIONS.map((option) => (
                            <button
                                key={option.value}
                                type="button"
                                onClick={() => setScope(option.value)}
                                className={cn(
                                    "h-8 rounded-xl px-3 text-xs font-extrabold transition",
                                    scope === option.value
                                        ? "bg-slate-950 text-white"
                                        : "text-slate-600 hover:bg-slate-100",
                                )}
                                title={option.description}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                    <div className="text-xs font-semibold text-slate-500">
                        {rows.length} row{rows.length === 1 ? "" : "s"} in scope
                    </div>
                </div>

                <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 px-4 py-3 text-xs font-semibold text-emerald-900">
                    Physical count is partial by design: only rows with a counted quantity are posted. Use the scope buttons for bulk-only, roll-only, or packing/add-on EOD counts.
                </div>

                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_8px_30px_-20px_rgba(15,23,42,0.18)]">
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
                                const reasonRequired = isOver && !(draft?.reason || "").trim()

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
                                            <div className="truncate text-slate-800">{row.name}</div>
                                            <div className="mt-1 flex flex-wrap gap-1 text-[11px] text-slate-500">
                                                <Badge variant="outline" className="h-5 rounded-full border-slate-200 bg-slate-50 px-2 text-[10px]">
                                                    {row.category || "STOCK"}
                                                </Badge>
                                                <Badge variant="outline" className="h-5 rounded-full border-slate-200 bg-slate-50 px-2 text-[10px]">
                                                    {row.stock_class}
                                                </Badge>
                                                {row.batchNo ? <span className="font-mono">{row.batchNo}</span> : null}
                                            </div>
                                        </div>
                                        <div>
                                            {row.locationLocked ? (
                                                <div className="flex min-h-8 items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-2 text-xs font-semibold text-slate-700">
                                                    <MapPin className="h-3.5 w-3.5 text-slate-400" />
                                                    <span className="truncate">{row.locationName}</span>
                                                </div>
                                            ) : (
                                                <Select
                                                    value={draft?.locationId || "__none__"}
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
                                            {locationMissing ? <p className="mt-1 text-[11px] font-semibold text-rose-700">Location required</p> : null}
                                        </div>
                                        <div className="text-right font-mono text-xs text-slate-600 lg:pt-1.5">
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
                                                variance == null && "text-slate-400",
                                                isExact && "text-emerald-700",
                                                variance != null && !isExact && !isOver && "text-amber-700",
                                                isOver && "font-semibold text-rose-700",
                                            )}
                                        >
                                            {variance == null ? "-" : `${variance >= 0 ? "+" : ""}${variance.toFixed(2)}%`}
                                        </div>
                                        <div>
                                            <Textarea
                                                data-testid={`count-reason-${row.rowKey}`}
                                                value={draft?.reason || ""}
                                                onChange={(event) => setDraft(row.rowKey, { reason: event.target.value })}
                                                disabled={!isOver}
                                                placeholder={isOver ? "Required: explain variance" : "-"}
                                                className={cn(
                                                    "min-h-[34px] text-xs",
                                                    reasonRequired && "border-rose-400 ring-1 ring-rose-200",
                                                )}
                                                rows={1}
                                            />
                                            {reasonRequired ? (
                                                <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-rose-700">
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
                        Count scope
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
                                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
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
                            <dt className="text-slate-600">Ready to post</dt>
                            <dd className="font-display text-base font-semibold text-emerald-700">{stats.ready}</dd>
                        </div>
                        <div className="flex items-center justify-between">
                            <dt className="text-slate-600">Over {VARIANCE_THRESHOLD}% threshold</dt>
                            <dd className="font-display text-base font-semibold text-amber-700">{stats.overThreshold}</dd>
                        </div>
                        <div className="flex items-center justify-between">
                            <dt className="text-slate-600">Missing reason</dt>
                            <dd className={cn("font-display text-base font-semibold", stats.missingReason > 0 ? "text-rose-700" : "text-slate-400")}>
                                {stats.missingReason}
                            </dd>
                        </div>
                        <div className="flex items-center justify-between">
                            <dt className="text-slate-600">Missing location</dt>
                            <dd className={cn("font-display text-base font-semibold", stats.missingLocation > 0 ? "text-rose-700" : "text-slate-400")}>
                                {stats.missingLocation}
                            </dd>
                        </div>
                    </dl>
                    {stats.blocked > 0 ? (
                        <div className="mt-3 flex items-start gap-2 rounded-xl bg-rose-50 p-3 text-xs text-rose-700">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                            Fix missing reasons or locations before posting.
                        </div>
                    ) : stats.ready > 0 ? (
                        <div className="mt-3 flex items-start gap-2 rounded-xl bg-emerald-50 p-3 text-xs text-emerald-800">
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
                        EOD packing counts, roll checks, and bulk counts all post PHYSICAL_COUNT audit batches here. Posted counts also refresh the inventory snapshot trend.
                    </p>
                </div>
            </aside>
        </div>
    )
}
