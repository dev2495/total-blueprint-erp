"use client"

import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Search, Sparkles, Send, Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { factoryService, type Location } from "@/services/factory"
import { recipeService, type RecipeGrade } from "@/services/recipes"
import {
    stockLifecycleService,
    type MasterCatalog,
    type StockLifecycleRow,
    type OpeningStockLine,
} from "@/services/stock-lifecycle"

import { CATEGORY_META } from "./workspace"

interface OpenStockTabProps {
    plantId: string
    catalog: MasterCatalog
    categoryFilter: string | null
}

interface RowDraft {
    qty: string
    locationId: string
    granuleCodeId?: string
    labelId?: string
    batchNo?: string
    widthMm?: string
    thicknessMicron?: string
    lengthM?: string
    stockForm?: string
    widthBasis?: string
    gradeId?: string
}

const STOCK_FORM_OPTIONS = [
    { value: "OPEN_WEB", label: "Open web / sheet", basis: "OPEN_WEB_WIDTH" },
    { value: "LAYFLAT_TUBE", label: "Lay-flat tube", basis: "LAYFLAT_WIDTH" },
    { value: "FOLDED_WEB", label: "Folded web", basis: "FOLDED_WIDTH" },
]

function currentFinancialYear() {
    const now = new Date()
    const start = now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1
    return `${start}-${start + 1}`
}

function datetimeLocalValue(date = new Date()) {
    const offset = date.getTimezoneOffset()
    const local = new Date(date.getTime() - offset * 60_000)
    return local.toISOString().slice(0, 16)
}

export function OpenStockTab({ plantId, catalog, categoryFilter }: OpenStockTabProps) {
    const qc = useQueryClient()
    const { toast } = useToast()
    const [search, setSearch] = React.useState("")
    const [drafts, setDrafts] = React.useState<Record<string, RowDraft>>({})
    const [openingMode, setOpeningMode] = React.useState<"CUTOVER_OPENING" | "TRUE_OPENING">("CUTOVER_OPENING")
    const [cutoffAt, setCutoffAt] = React.useState(datetimeLocalValue(new Date("2026-06-01T00:00:00")))
    const [financialYear, setFinancialYear] = React.useState(currentFinancialYear())
    const [reasonCode, setReasonCode] = React.useState("JUNE_CUTOVER")

    const { data: locations = [] } = useQuery({
        queryKey: ["stock-lifecycle", "locations"],
        queryFn: () => factoryService.getLocations(),
    })

    const { data: grades = [] } = useQuery<RecipeGrade[]>({
        queryKey: ["stock-lifecycle", "grades"],
        queryFn: () => recipeService.getGrades(),
    })

    const plantLocations: Location[] = React.useMemo(
        () => locations.filter((l) => l.plant === plantId),
        [locations, plantId]
    )

    const rows = React.useMemo(() => {
        const filtered = categoryFilter
            ? catalog.rows.filter((r) => r.category === categoryFilter)
            : catalog.rows
        if (!search.trim()) return filtered
        const q = search.trim().toLowerCase()
        return filtered.filter(
            (r) =>
                r.code.toLowerCase().includes(q) ||
                (r.name || "").toLowerCase().includes(q)
        )
    }, [catalog.rows, categoryFilter, search])

    const grouped = React.useMemo(() => {
        const map: Record<string, StockLifecycleRow[]> = {}
        for (const row of rows) {
            map[row.category] = map[row.category] || []
            map[row.category].push(row)
        }
        return map
    }, [rows])

    const readyCount = React.useMemo(
        () =>
            rows.filter((row) => {
                const d = drafts[row.id]
                if (!d || !d.qty || Number(d.qty) <= 0) return false
                if (row.category === "GRANULE" && (row.granule_codes?.length || 0) > 0 && !d.granuleCodeId) return false
                if (row.stock_class !== "ROLL") return true
                const hasRollGeometry = Number(d.widthMm || 0) > 0 && Number(d.thicknessMicron || 0) > 0
                const hasRequiredGrade = !row.is_extrudable || Boolean(d.gradeId || row.default_grade_id)
                return hasRollGeometry && hasRequiredGrade
            }).length,
        [drafts, rows]
    )

    const setDraft = (id: string, patch: Partial<RowDraft>) => {
        setDrafts((prev) => {
            const existing: RowDraft = prev[id] ?? { qty: "", locationId: "" }
            return { ...prev, [id]: { ...existing, ...patch } }
        })
    }

    const mutation = useMutation({
        mutationFn: async () => {
            const lines = rows
                .map((row) => {
                    const d = drafts[row.id]
                    if (!d || !d.qty || Number(d.qty) <= 0) return null
                    const locationId =
                        d.locationId ||
                        row.locations.find((l) => l.id)?.id ||
                        plantLocations[0]?.id
                    if (!locationId) return null
                    if (row.stock_class === "ROLL" && (Number(d.widthMm || 0) <= 0 || Number(d.thicknessMicron || 0) <= 0)) {
                        throw new Error(`Roll opening for ${row.code} requires width mm and micron.`)
                    }
                    const gradeId = d.gradeId || row.default_grade_id || undefined
                    if (row.stock_class === "ROLL" && row.is_extrudable && !gradeId) {
                        throw new Error(`Roll opening for ${row.code} requires a recipe grade.`)
                    }
                    if (row.category === "GRANULE" && (row.granule_codes?.length || 0) > 0 && !d.granuleCodeId) {
                        throw new Error(`Select a granule code for ${row.code}.`)
                    }
                    const stockForm = d.stockForm || "OPEN_WEB"
                    const widthBasis = d.widthBasis || STOCK_FORM_OPTIONS.find((item) => item.value === stockForm)?.basis || ""
                    return {
                        material: row.id,
                        qty: Number(d.qty),
                        location: locationId,
                        stock_class: row.stock_class,
                        granule_code: row.stock_class === "BULK" ? d.granuleCodeId || undefined : undefined,
                        grade_id: row.stock_class === "ROLL" ? gradeId : undefined,
                        label_id: row.stock_class === "ROLL" ? d.labelId || undefined : undefined,
                        batch_no: row.stock_class === "ROLL" ? d.batchNo || undefined : undefined,
                        width_mm: row.stock_class === "ROLL" ? Number(d.widthMm || 0) || undefined : undefined,
                        thickness_micron: row.stock_class === "ROLL" ? Number(d.thicknessMicron || 0) || undefined : undefined,
                        length_m: row.stock_class === "ROLL" ? Number(d.lengthM || 0) || undefined : undefined,
                        stock_form: row.stock_class === "ROLL" ? stockForm : undefined,
                        width_basis: row.stock_class === "ROLL" ? widthBasis : undefined,
                    }
                })
                .filter(Boolean) as OpeningStockLine[]

            if (lines.length === 0) {
                throw new Error("No rows to submit. Enter at least one opening qty.")
            }

            return stockLifecycleService.postOpeningStock({
                plant_id: plantId,
                financial_year: financialYear,
                cutoff_at: cutoffAt ? new Date(cutoffAt).toISOString() : undefined,
                counted_as_of: cutoffAt ? new Date(cutoffAt).toISOString() : undefined,
                opening_mode: openingMode,
                cutover: openingMode === "CUTOVER_OPENING",
                reason_code: openingMode === "CUTOVER_OPENING" ? reasonCode : undefined,
                lines,
                notes: openingMode === "CUTOVER_OPENING"
                    ? "Stock Lifecycle workspace June cutover opening entry"
                    : "Stock Lifecycle workspace true FY opening entry",
            })
        },
        onSuccess: (result: any) => {
            toast({
                title: "Opening stock posted",
                description: `${result?.rows_committed ?? 0} lines committed.`,
            })
            setDrafts({})
            qc.invalidateQueries({ queryKey: ["stock-lifecycle", "catalog"] })
        },
        onError: (err: any) => {
            toast({
                title: "Failed to post opening stock",
                description:
                    err?.response?.data?.detail || err?.message || "Please try again.",
                variant: "destructive" as any,
            })
        },
    })

    if (plantLocations.length === 0) {
        return (
            <div data-testid="open-stock-tab" className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
                This plant has no inventory locations configured. Add at least one location before posting opening stock.
            </div>
        )
    }

    return (
        <div data-testid="open-stock-tab" className="flex flex-col gap-5">
            {/* Top bar */}
            <div className="flex flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-[240px]">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                        data-testid="open-material-search"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search by code or name…"
                        className="pl-9"
                    />
                </div>
                <div className="text-xs text-slate-500">
                    Showing <span className="font-semibold text-slate-700">{rows.length}</span> materials
                    {categoryFilter && (
                        <>
                            {" "}
                            in <Badge variant="outline" className="ml-1">{categoryFilter}</Badge>
                        </>
                    )}
                </div>
            </div>

            <div className="grid gap-3 rounded-2xl border border-indigo-100 bg-indigo-50/50 p-3 md:grid-cols-[190px_180px_220px_minmax(0,1fr)]">
                <Select value={openingMode} onValueChange={(value) => setOpeningMode(value as "CUTOVER_OPENING" | "TRUE_OPENING")}>
                    <SelectTrigger className="h-10 rounded-xl bg-white text-xs font-bold">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="CUTOVER_OPENING">June cutover add-on</SelectItem>
                        <SelectItem value="TRUE_OPENING">True FY opening</SelectItem>
                    </SelectContent>
                </Select>
                <Input
                    value={financialYear}
                    onChange={(event) => setFinancialYear(event.target.value)}
                    className="h-10 rounded-xl bg-white text-xs font-bold"
                    placeholder="2026-2027"
                />
                <Input
                    type="datetime-local"
                    value={cutoffAt}
                    onChange={(event) => setCutoffAt(event.target.value)}
                    className="h-10 rounded-xl bg-white text-xs font-bold"
                />
                <Input
                    value={reasonCode}
                    onChange={(event) => setReasonCode(event.target.value.toUpperCase())}
                    disabled={openingMode !== "CUTOVER_OPENING"}
                    className="h-10 rounded-xl bg-white text-xs font-bold"
                    placeholder="Reason code"
                />
                <div className="md:col-span-4 rounded-xl border border-indigo-100 bg-white px-3 py-2 text-xs font-semibold text-indigo-900">
                    {openingMode === "CUTOVER_OPENING"
                        ? "Cutover adds physical stock counted at the selected date/time on top of existing June movements. Use this for one-time June setup after GRN/production activity already exists."
                        : "True opening sets FY opening balances and remains blocked if movements already exist for the material/location in the selected FY."}
                </div>
            </div>

            {/* Grouped rows */}
            <div className="space-y-6">
                {Object.entries(grouped).length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-10 text-center text-sm text-slate-500">
                        No materials match the current filter.
                    </div>
                ) : (
                    Object.entries(grouped).map(([category, list]) => {
                        const meta =
                            CATEGORY_META.find((c) => c.key === category) || {
                                key: category,
                                label: category,
                                icon: Sparkles,
                                accent: "from-slate-400 to-slate-600",
                            }
                        const Icon = meta.icon
                        return (
                            <div
                                key={category}
                                className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_8px_30px_-20px_rgba(15,23,42,0.18)]"
                            >
                                <div className={cn(
                                    "flex items-center justify-between gap-3 px-4 py-3",
                                    "bg-gradient-to-r text-white",
                                    meta.accent
                                )}>
                                    <div className="flex items-center gap-2">
                                        <Icon className="h-4 w-4" />
                                        <span className="font-display text-sm font-semibold">
                                            {meta.label}
                                        </span>
                                        <Badge className="ml-1 bg-white/20 text-white border-0">
                                            {list.length}
                                        </Badge>
                                    </div>
                                </div>

                                {/* Desktop grid */}
                                <div className="hidden divide-y divide-slate-100 md:block">
                                    <div className="grid grid-cols-[120px_minmax(0,1fr)_90px_90px_120px_minmax(0,1fr)] gap-3 bg-slate-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                        <div>Code</div>
                                        <div>Name</div>
                                        <div>UoM</div>
                                        <div className="text-right">System</div>
                                        <div>Opening qty</div>
                                        <div>Location</div>
                                    </div>
                                    {list.map((row) => {
                                        const d = drafts[row.id]
                                        const isRoll = row.stock_class === "ROLL"
                                        const selectedGradeId = d?.gradeId || row.default_grade_id || ""
                                        return (
                                            <div key={row.id} data-testid={`open-row-${row.id}`} className="px-4 py-2 text-sm hover:bg-indigo-50/30">
                                                <div
                                                    className="grid grid-cols-[120px_minmax(0,1fr)_90px_90px_120px_minmax(0,1fr)] items-center gap-3"
                                                >
                                                    <div className="font-mono text-xs text-slate-700">{row.code}</div>
                                                    <div className="truncate text-slate-800">{row.name}</div>
                                                    <div className="text-xs text-slate-500">{row.base_uom}</div>
                                                    <div className="text-right font-mono text-xs text-slate-600">
                                                        {row.system_qty.toLocaleString(undefined, { maximumFractionDigits: 3 })}
                                                    </div>
                                                    <Input
                                                        data-testid={`open-qty-${row.id}`}
                                                        type="number"
                                                        inputMode="decimal"
                                                        min="0"
                                                        step="0.001"
                                                        value={d?.qty || ""}
                                                        onChange={(e) => setDraft(row.id, { qty: e.target.value })}
                                                        placeholder="0.000"
                                                        className="h-8"
                                                    />
                                                    <Select
                                                        value={d?.locationId || ""}
                                                        onValueChange={(v) => setDraft(row.id, { locationId: v })}
                                                    >
                                                        <SelectTrigger data-testid={`open-location-${row.id}`} className="h-8">
                                                            <SelectValue placeholder="Select location" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {plantLocations.map((loc) => (
                                                                <SelectItem key={loc.id} value={loc.id}>
                                                                    {loc.code} · {loc.name}
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                {isRoll && d?.qty ? (
                                                    <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg border border-blue-100 bg-blue-50/50 p-2 xl:grid-cols-5">
                                                        <Input
                                                            value={d?.widthMm || ""}
                                                            onChange={(e) => setDraft(row.id, { widthMm: e.target.value })}
                                                            type="number"
                                                            min="0"
                                                            step="0.01"
                                                            placeholder="Width mm"
                                                            className="h-8 bg-white text-xs"
                                                        />
                                                        <Input
                                                            value={d?.thicknessMicron || ""}
                                                            onChange={(e) => setDraft(row.id, { thicknessMicron: e.target.value })}
                                                            type="number"
                                                            min="0"
                                                            step="0.001"
                                                            placeholder="Micron"
                                                            className="h-8 bg-white text-xs"
                                                        />
                                                        {row.is_extrudable ? (
                                                            <Select
                                                                value={selectedGradeId}
                                                                onValueChange={(v) => setDraft(row.id, { gradeId: v })}
                                                            >
                                                                <SelectTrigger className="h-8 bg-white text-xs">
                                                                    <SelectValue placeholder={row.default_grade_name || "Grade"} />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    {grades.map((grade) => (
                                                                        <SelectItem key={grade.id} value={grade.id}>
                                                                            {grade.name}
                                                                        </SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>
                                                        ) : null}
                                                        <Input
                                                            value={d?.labelId || ""}
                                                            onChange={(e) => setDraft(row.id, { labelId: e.target.value })}
                                                            placeholder="Label optional"
                                                            className="h-8 bg-white text-xs"
                                                        />
                                                        <Input
                                                            value={d?.batchNo || ""}
                                                            onChange={(e) => setDraft(row.id, { batchNo: e.target.value })}
                                                            placeholder="Batch optional"
                                                            className="h-8 bg-white text-xs"
                                                        />
                                                        <Input
                                                            value={d?.lengthM || ""}
                                                            onChange={(e) => setDraft(row.id, { lengthM: e.target.value })}
                                                            type="number"
                                                            min="0"
                                                            step="0.01"
                                                            placeholder="Length m"
                                                            className="h-8 bg-white text-xs"
                                                        />
                                                        <Select
                                                            value={d?.stockForm || "OPEN_WEB"}
                                                            onValueChange={(value) => {
                                                                const option = STOCK_FORM_OPTIONS.find((item) => item.value === value)
                                                                setDraft(row.id, { stockForm: value, widthBasis: option?.basis || "" })
                                                            }}
                                                        >
                                                            <SelectTrigger className="h-8 bg-white text-xs">
                                                                <SelectValue placeholder="Roll form" />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                {STOCK_FORM_OPTIONS.map((option) => (
                                                                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                ) : null}
                                                {row.category === "GRANULE" && (row.granule_codes?.length || 0) > 0 && d?.qty ? (
                                                    <div className="mt-2 rounded-lg border border-amber-100 bg-amber-50/60 p-2">
                                                        <Select
                                                            value={d?.granuleCodeId || ""}
                                                            onValueChange={(value) => setDraft(row.id, { granuleCodeId: value })}
                                                        >
                                                            <SelectTrigger className="h-8 bg-white text-xs">
                                                                <SelectValue placeholder="Granule inward code" />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                {row.granule_codes?.map((code) => (
                                                                    <SelectItem key={code.id} value={code.id}>{code.label || code.code}</SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                ) : null}
                                            </div>
                                        )
                                    })}
                                </div>

                                {/* Mobile cards */}
                                <div className="divide-y divide-slate-100 md:hidden">
                                    {list.map((row) => {
                                        const d = drafts[row.id]
                                        const isRoll = row.stock_class === "ROLL"
                                        const selectedGradeId = d?.gradeId || row.default_grade_id || ""
                                        return (
                                            <div key={row.id} className="space-y-2 px-4 py-3">
                                                <div className="flex items-center justify-between">
                                                    <div>
                                                        <div className="font-mono text-xs text-slate-600">{row.code}</div>
                                                        <div className="text-sm font-medium text-slate-800">{row.name}</div>
                                                    </div>
                                                    <div className="text-right text-xs text-slate-500">
                                                        Sys: {row.system_qty.toFixed(2)} {row.base_uom}
                                                    </div>
                                                </div>
                                                <div className="grid grid-cols-2 gap-2">
                                                    <Input
                                                        data-testid={`open-qty-mobile-${row.id}`}
                                                        type="number"
                                                        inputMode="decimal"
                                                        min="0"
                                                        step="0.001"
                                                        value={d?.qty || ""}
                                                        onChange={(e) => setDraft(row.id, { qty: e.target.value })}
                                                        placeholder="Opening qty"
                                                        className="h-9"
                                                    />
                                                    <Select
                                                        value={d?.locationId || ""}
                                                        onValueChange={(v) => setDraft(row.id, { locationId: v })}
                                                    >
                                                        <SelectTrigger data-testid={`open-location-mobile-${row.id}`} className="h-9">
                                                            <SelectValue placeholder="Location" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {plantLocations.map((loc) => (
                                                                <SelectItem key={loc.id} value={loc.id}>
                                                                    {loc.code} · {loc.name}
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                {isRoll && d?.qty ? (
                                                    <div className="grid grid-cols-2 gap-2 rounded-lg border border-blue-100 bg-blue-50/50 p-2">
                                                        <Input
                                                            type="number"
                                                            min="0"
                                                            step="0.01"
                                                            value={d?.widthMm || ""}
                                                            onChange={(e) => setDraft(row.id, { widthMm: e.target.value })}
                                                            placeholder="Width mm"
                                                            className="h-9 bg-white"
                                                        />
                                                        <Input
                                                            type="number"
                                                            min="0"
                                                            step="0.001"
                                                            value={d?.thicknessMicron || ""}
                                                            onChange={(e) => setDraft(row.id, { thicknessMicron: e.target.value })}
                                                            placeholder="Micron"
                                                            className="h-9 bg-white"
                                                        />
                                                        {row.is_extrudable ? (
                                                            <Select
                                                                value={selectedGradeId}
                                                                onValueChange={(v) => setDraft(row.id, { gradeId: v })}
                                                            >
                                                                <SelectTrigger className="h-9 bg-white">
                                                                    <SelectValue placeholder={row.default_grade_name || "Grade"} />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    {grades.map((grade) => (
                                                                        <SelectItem key={grade.id} value={grade.id}>
                                                                            {grade.name}
                                                                        </SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>
                                                        ) : null}
                                                        <Input
                                                            value={d?.labelId || ""}
                                                            onChange={(e) => setDraft(row.id, { labelId: e.target.value })}
                                                            placeholder="Label optional"
                                                            className="h-9 bg-white"
                                                        />
                                                        <Input
                                                            value={d?.batchNo || ""}
                                                            onChange={(e) => setDraft(row.id, { batchNo: e.target.value })}
                                                            placeholder="Batch optional"
                                                            className="h-9 bg-white"
                                                        />
                                                        <Input
                                                            value={d?.lengthM || ""}
                                                            onChange={(e) => setDraft(row.id, { lengthM: e.target.value })}
                                                            type="number"
                                                            min="0"
                                                            step="0.01"
                                                            placeholder="Length m"
                                                            className="h-9 bg-white"
                                                        />
                                                        <Select
                                                            value={d?.stockForm || "OPEN_WEB"}
                                                            onValueChange={(value) => {
                                                                const option = STOCK_FORM_OPTIONS.find((item) => item.value === value)
                                                                setDraft(row.id, { stockForm: value, widthBasis: option?.basis || "" })
                                                            }}
                                                        >
                                                            <SelectTrigger className="h-9 bg-white">
                                                                <SelectValue placeholder="Roll form" />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                {STOCK_FORM_OPTIONS.map((option) => (
                                                                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                ) : null}
                                                {row.category === "GRANULE" && (row.granule_codes?.length || 0) > 0 && d?.qty ? (
                                                    <Select
                                                        value={d?.granuleCodeId || ""}
                                                        onValueChange={(value) => setDraft(row.id, { granuleCodeId: value })}
                                                    >
                                                        <SelectTrigger className="h-9 bg-white">
                                                            <SelectValue placeholder="Granule inward code" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {row.granule_codes?.map((code) => (
                                                                <SelectItem key={code.id} value={code.id}>{code.label || code.code}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                ) : null}
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        )
                    })
                )}
            </div>

            {/* Sticky action bar */}
            <div className="sticky bottom-3 z-10 mt-2 flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/90 p-3 shadow-lg backdrop-blur">
                <div className="text-sm text-slate-600">
                    <span className="font-display text-lg font-semibold text-slate-900">{readyCount}</span>{" "}
                    rows ready to post
                </div>
                <Button
                    data-testid="open-stock-post"
                    disabled={readyCount === 0 || mutation.isPending}
                    onClick={() => mutation.mutate()}
                    className="bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 text-white hover:from-indigo-500 hover:via-violet-500 hover:to-fuchsia-500"
                >
                    {mutation.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                        <Send className="mr-2 h-4 w-4" />
                    )}
                    {openingMode === "CUTOVER_OPENING" ? "Post Cutover Stock" : "Post Opening Stock"}
                </Button>
            </div>
        </div>
    )
}
