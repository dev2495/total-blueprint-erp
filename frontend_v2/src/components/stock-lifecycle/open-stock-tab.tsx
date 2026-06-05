"use client"

import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, Boxes, CheckCircle2, ClipboardList, Download, Loader2, PackageCheck, Plus, Search, Send, Sparkles, Trash2, Upload } from "lucide-react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
import { inventoryService } from "@/services/inventory"
import { recipeService, type RecipeGrade } from "@/services/recipes"
import {
    stockLifecycleService,
    type MasterCatalog,
    type OpeningStockLine,
    type OpeningStockUploadResult,
    type StockLifecycleRow,
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
    rate?: string
    granuleCodeId?: string
}

interface RollDraft {
    id: string
    qty: string
    locationId: string
    labelId?: string
    batchNo?: string
    widthMm?: string
    thicknessMicron?: string
    lengthM?: string
    gradeId?: string
    stockForm: string
    widthBasis: string
    rate?: string
}

const STOCK_FORM_OPTIONS = [
    { value: "OPEN_WEB", label: "Open web", basis: "OPEN_WEB_WIDTH" },
    { value: "LAYFLAT_TUBE", label: "Tube / lay-flat", basis: "LAYFLAT_WIDTH" },
    { value: "FOLDED_WEB", label: "Folded web", basis: "FOLDED_WIDTH" },
]

const WIDTH_BASIS_OPTIONS = [
    { value: "OPEN_WEB_WIDTH", label: "Open-web width" },
    { value: "LAYFLAT_WIDTH", label: "Lay-flat width" },
    { value: "FOLDED_WIDTH", label: "Folded width" },
]

function newRollDraft(): RollDraft {
    return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        qty: "",
        locationId: "",
        stockForm: "OPEN_WEB",
        widthBasis: "OPEN_WEB_WIDTH",
    }
}

function widthBasisForForm(stockForm: string) {
    return STOCK_FORM_OPTIONS.find((item) => item.value === stockForm)?.basis || "OPEN_WEB_WIDTH"
}

function numberValue(value?: string) {
    const parsed = Number(value || 0)
    return Number.isFinite(parsed) ? parsed : 0
}

function fmtQty(value: number, digits = 3) {
    return Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: digits })
}

function normalizedKey(value?: unknown) {
    return String(value ?? "").trim().toLowerCase()
}

function splitQuickLine(line: string) {
    return line
        .split(/\t|,|\|/)
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
}

function defaultLocation(row: StockLifecycleRow, plantLocations: Location[]) {
    return row.locations.find((location) => location.id)?.id || plantLocations[0]?.id || ""
}

function rowKind(row: StockLifecycleRow) {
    if (row.stock_class === "ROLL") return "Physical roll"
    if (row.stock_class === "PACKAGING") return "Packaging"
    if (row.category === "GRANULE") return "Granule code stock"
    return "Bulk stock"
}

function stockFormLabel(value?: string) {
    return STOCK_FORM_OPTIONS.find((item) => item.value === value)?.label || value || "Open web"
}

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
    const [rollDrafts, setRollDrafts] = React.useState<Record<string, RollDraft[]>>({})
    const [quickPaste, setQuickPaste] = React.useState("")
    const [uploadFile, setUploadFile] = React.useState<File | null>(null)
    const [uploadResult, setUploadResult] = React.useState<OpeningStockUploadResult | null>(null)

    const { data: locations = [] } = useQuery({
        queryKey: ["stock-lifecycle", "locations"],
        queryFn: () => factoryService.getLocations(),
    })

    const { data: grades = [] } = useQuery<RecipeGrade[]>({
        queryKey: ["stock-lifecycle", "grades"],
        queryFn: () => recipeService.getGrades(),
    })

    const plantLocations: Location[] = React.useMemo(
        () => locations.filter((location) => String(location.plant) === String(plantId) && location.is_active !== false),
        [locations, plantId],
    )

    const rows = React.useMemo(() => {
        const stockRows = catalog.rows.filter((row) => row.category !== "FILM_FAMILY")
        const filtered = categoryFilter ? stockRows.filter((row) => row.category === categoryFilter) : stockRows
        if (!search.trim()) return filtered
        const q = search.trim().toLowerCase()
        return filtered.filter(
            (row) =>
                row.code.toLowerCase().includes(q) ||
                (row.name || "").toLowerCase().includes(q),
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

    const rollRowsById = React.useMemo(() => {
        const map = new Map<string, StockLifecycleRow>()
        for (const row of rows) {
            if (row.stock_class === "ROLL") map.set(row.id, row)
        }
        return map
    }, [rows])

    const nonRollRowsByLookup = React.useMemo(() => {
        const map = new Map<string, StockLifecycleRow>()
        for (const row of catalog.rows) {
            if (row.stock_class === "ROLL" || row.category === "FILM_FAMILY") continue
            map.set(normalizedKey(row.code), row)
            map.set(normalizedKey(row.name), row)
            map.set(normalizedKey(row.id), row)
        }
        return map
    }, [catalog.rows])

    const locationsByLookup = React.useMemo(() => {
        const map = new Map<string, Location>()
        for (const location of plantLocations) {
            map.set(normalizedKey(location.id), location)
            map.set(normalizedKey(location.code), location)
            map.set(normalizedKey(location.name), location)
        }
        return map
    }, [plantLocations])

    const setDraft = (id: string, patch: Partial<RowDraft>) => {
        setDrafts((prev) => {
            const existing = prev[id] ?? { qty: "", locationId: "" }
            return { ...prev, [id]: { ...existing, ...patch } }
        })
    }

    const rollEntries = React.useCallback(
        (rowId: string) => (rollDrafts[rowId]?.length ? rollDrafts[rowId] : [newRollDraft()]),
        [rollDrafts],
    )

    const setRollDraft = (rowId: string, index: number, patch: Partial<RollDraft>) => {
        setRollDrafts((prev) => {
            const next = prev[rowId]?.length ? [...prev[rowId]] : [newRollDraft()]
            const current = next[index] ?? newRollDraft()
            const patched = { ...current, ...patch }
            if (patch.stockForm) patched.widthBasis = widthBasisForForm(patch.stockForm)
            next[index] = patched
            return { ...prev, [rowId]: next }
        })
    }

    const addRollDraft = (rowId: string) => {
        setRollDrafts((prev) => {
            const current = prev[rowId]?.length ? prev[rowId] : [newRollDraft()]
            return { ...prev, [rowId]: [...current, newRollDraft()] }
        })
    }

    const removeRollDraft = (rowId: string, index: number) => {
        setRollDrafts((prev) => {
            const next = [...(prev[rowId] || [])]
            next.splice(index, 1)
            return { ...prev, [rowId]: next.length ? next : [newRollDraft()] }
        })
    }

    const applyQuickPaste = React.useCallback(() => {
        const lines = quickPaste.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
        if (!lines.length) {
            toast({ title: "Paste rows first", description: "Use code, quantity, location, rate, granule code." })
            return
        }
        const nextDrafts: Record<string, RowDraft> = { ...drafts }
        const misses: string[] = []
        let applied = 0
        for (const line of lines) {
            const [code, qty, locationToken, rate, granuleToken] = splitQuickLine(line)
            if (!code || !qty) continue
            const row = nonRollRowsByLookup.get(normalizedKey(code))
            if (!row) {
                misses.push(code)
                continue
            }
            const location = locationToken ? locationsByLookup.get(normalizedKey(locationToken)) : undefined
            const granule = granuleToken
                ? (row.granule_codes || []).find((item) => normalizedKey(item.id) === normalizedKey(granuleToken) || normalizedKey(item.code) === normalizedKey(granuleToken))
                : undefined
            nextDrafts[row.id] = {
                ...(nextDrafts[row.id] || { qty: "", locationId: "" }),
                qty,
                locationId: location?.id || nextDrafts[row.id]?.locationId || defaultLocation(row, plantLocations),
                rate: rate || nextDrafts[row.id]?.rate,
                granuleCodeId: granule?.id || nextDrafts[row.id]?.granuleCodeId,
            }
            applied += 1
        }
        setDrafts(nextDrafts)
        toast({
            title: `${applied} quick row${applied === 1 ? "" : "s"} applied`,
            description: misses.length ? `Skipped unknown: ${misses.slice(0, 3).join(", ")}` : "Review and post when ready.",
        })
    }, [drafts, locationsByLookup, nonRollRowsByLookup, plantLocations, quickPaste, toast])

    const lineValidation = React.useMemo(() => {
        const errors: string[] = []
        let ready = 0
        let rollLines = 0
        let rawLines = 0
        for (const row of rows) {
            if (row.stock_class === "ROLL") continue
            const draft = drafts[row.id]
            const qty = numberValue(draft?.qty)
            if (qty <= 0) continue
            const locationId = draft?.locationId || defaultLocation(row, plantLocations)
            if (!locationId) errors.push(`${row.code}: location required`)
            if (row.category === "GRANULE" && (row.granule_codes || []).length > 0 && !draft?.granuleCodeId) {
                errors.push(`${row.code}: granule code required`)
            }
            if (locationId && !(row.category === "GRANULE" && (row.granule_codes || []).length > 0 && !draft?.granuleCodeId)) {
                ready += 1
                rawLines += 1
            }
        }
        for (const [rowId, entries] of Object.entries(rollDrafts)) {
            const row = rollRowsById.get(rowId)
            if (!row) continue
            for (const entry of entries) {
                const qty = numberValue(entry.qty)
                if (qty <= 0) continue
                const locationId = entry.locationId || defaultLocation(row, plantLocations)
                const width = numberValue(entry.widthMm)
                const micron = numberValue(entry.thicknessMicron)
                const gradeId = entry.gradeId || row.default_grade_id || ""
                if (!locationId) errors.push(`${row.code}: roll location required`)
                if (width <= 0) errors.push(`${row.code}: roll width required`)
                if (micron <= 0) errors.push(`${row.code}: roll micron required`)
                if (row.is_extrudable && !gradeId) errors.push(`${row.code}: grade required`)
                if (locationId && width > 0 && micron > 0 && (!row.is_extrudable || gradeId)) {
                    ready += 1
                    rollLines += 1
                }
            }
        }
        return { ready, rollLines, rawLines, errors: Array.from(new Set(errors)).slice(0, 5) }
    }, [drafts, plantLocations, rollDrafts, rollRowsById, rows])

    const mutation = useMutation({
        mutationFn: async () => {
            const lines: OpeningStockLine[] = []
            for (const row of rows) {
                if (row.stock_class === "ROLL") continue
                const draft = drafts[row.id]
                const qty = numberValue(draft?.qty)
                if (qty <= 0) continue
                const locationId = draft?.locationId || defaultLocation(row, plantLocations)
                if (!locationId) throw new Error(`${row.code}: select a location.`)
                if (row.category === "GRANULE" && (row.granule_codes || []).length > 0 && !draft?.granuleCodeId) {
                    throw new Error(`${row.code}: select a granule quality code.`)
                }
                lines.push({
                    material: row.id,
                    qty,
                    location: locationId,
                    stock_class: row.stock_class,
                    granule_code: draft?.granuleCodeId || undefined,
                    rate: numberValue(draft?.rate) > 0 ? numberValue(draft?.rate) : undefined,
                })
            }
            for (const [rowId, entries] of Object.entries(rollDrafts)) {
                const row = rollRowsById.get(rowId)
                if (!row) continue
                for (const entry of entries) {
                    const qty = numberValue(entry.qty)
                    if (qty <= 0) continue
                    const locationId = entry.locationId || defaultLocation(row, plantLocations)
                    const gradeId = entry.gradeId || row.default_grade_id || undefined
                    if (!locationId) throw new Error(`${row.code}: select a roll location.`)
                    if (numberValue(entry.widthMm) <= 0 || numberValue(entry.thicknessMicron) <= 0) {
                        throw new Error(`${row.code}: width mm and micron are required for physical roll opening.`)
                    }
                    if (row.is_extrudable && !gradeId) throw new Error(`${row.code}: select a grade.`)
                    lines.push({
                        material: row.id,
                        qty,
                        location: locationId,
                        stock_class: "ROLL",
                        grade_id: gradeId,
                        label_id: entry.labelId || undefined,
                        batch_no: entry.batchNo || undefined,
                        width_mm: numberValue(entry.widthMm),
                        thickness_micron: numberValue(entry.thicknessMicron),
                        length_m: numberValue(entry.lengthM) > 0 ? numberValue(entry.lengthM) : undefined,
                        stock_form: entry.stockForm || "OPEN_WEB",
                        width_basis: entry.widthBasis || widthBasisForForm(entry.stockForm),
                        rate: numberValue(entry.rate) > 0 ? numberValue(entry.rate) : undefined,
                    })
                }
            }
            if (lines.length === 0) {
                throw new Error("Enter at least one opening stock line.")
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
                description: `${result?.rows_committed ?? 0} line${result?.rows_committed === 1 ? "" : "s"} committed.`,
            })
            setDrafts({})
            setRollDrafts({})
            qc.invalidateQueries({ queryKey: ["stock-lifecycle", "catalog"] })
            qc.invalidateQueries({ queryKey: ["stock-lifecycle", "audit-snapshot"] })
            qc.invalidateQueries({ queryKey: ["stock-lifecycle", "inventory-snapshot"] })
            qc.invalidateQueries({ queryKey: ["stock-lifecycle", "closing-preview"] })
        },
        onError: (err: any) => {
            toast({
                title: "Failed to post opening stock",
                description: err?.response?.data?.detail || err?.message || "Please try again.",
                variant: "destructive" as any,
            })
        },
    })

    const uploadMutation = useMutation({
        mutationFn: async ({ commit }: { commit: boolean }) => {
            if (!uploadFile) throw new Error("Choose a CSV or XLSX file first.")
            return stockLifecycleService.uploadOpeningStock(uploadFile, {
                plant_id: plantId,
                financial_year: financialYear,
                cutoff_at: cutoffAt ? new Date(cutoffAt).toISOString() : undefined,
                opening_mode: openingMode,
                reason_code: openingMode === "CUTOVER_OPENING" ? reasonCode : undefined,
                commit,
                dry_run: !commit,
            })
        },
        onSuccess: (result, args) => {
            setUploadResult(result)
            if (args.commit) {
                toast({
                    title: "Opening stock file posted",
                    description: `${result.rows_committed ?? result.rows_valid ?? 0} line${(result.rows_committed ?? result.rows_valid) === 1 ? "" : "s"} committed.`,
                })
                setUploadFile(null)
                qc.invalidateQueries({ queryKey: ["stock-lifecycle", "catalog"] })
                qc.invalidateQueries({ queryKey: ["stock-lifecycle", "audit-snapshot"] })
                qc.invalidateQueries({ queryKey: ["stock-lifecycle", "inventory-snapshot"] })
                qc.invalidateQueries({ queryKey: ["stock-lifecycle", "closing-preview"] })
            } else {
                toast({
                    title: "File validated",
                    description: `${result.rows_valid ?? 0} valid, ${result.rows_invalid ?? 0} issue${result.rows_invalid === 1 ? "" : "s"}.`,
                })
            }
        },
        onError: (err: any) => {
            toast({
                title: "Opening stock file failed",
                description: err?.response?.data?.detail || err?.message || "Please check the file and try again.",
                variant: "destructive" as any,
            })
        },
    })

    if (plantLocations.length === 0) {
        return (
            <div data-testid="open-stock-tab" className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
                This plant has no active inventory locations configured. Add a location before posting opening stock.
            </div>
        )
    }

    return (
        <div data-testid="open-stock-tab" className="flex flex-col gap-5">
            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_280px]">
                <div className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-wrap items-center gap-3">
                        <div className="relative min-w-[260px] flex-1">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <Input
                                data-testid="open-material-search"
                                value={search}
                                onChange={(event) => setSearch(event.target.value)}
                                placeholder="Search physical variant, granule, ink, packaging..."
                                className="h-10 rounded-xl pl-9"
                            />
                        </div>
                        <label className="grid min-w-[220px] gap-1 text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-500">
                            Opening balance as of
                            <Input
                                type="datetime-local"
                                value={cutoffAt}
                                onChange={(event) => setCutoffAt(event.target.value)}
                                className="h-10 rounded-xl text-sm normal-case tracking-normal"
                            />
                        </label>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold text-slate-600">
                        <Badge className="rounded-full bg-slate-950 text-white">{rows.length} stock masters</Badge>
                        <Badge variant="outline" className="rounded-full border-emerald-200 bg-emerald-50 text-emerald-700">
                            Film families hidden from stock entry
                        </Badge>
                        <Badge variant="outline" className="rounded-full border-blue-200 bg-blue-50 text-blue-700">
                            Rolls entered as physical labels
                        </Badge>
                    </div>
                </div>

                <div className="rounded-[20px] border border-slate-200 bg-slate-950 p-4 text-white shadow-sm">
                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-white/60">Post readiness</div>
                    <div className="mt-2 flex items-end justify-between">
                        <div className="font-display text-3xl font-bold">{lineValidation.ready}</div>
                        <div className="text-right text-xs text-white/70">
                            {lineValidation.rollLines} roll labels<br />
                            {lineValidation.rawLines} bulk / packing
                        </div>
                    </div>
                    {lineValidation.errors.length ? (
                        <div className="mt-3 rounded-xl border border-amber-300/30 bg-amber-300/10 p-2 text-[11px] text-amber-100">
                            {lineValidation.errors[0]}
                        </div>
                    ) : lineValidation.ready > 0 ? (
                        <div className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-emerald-200">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Ready to post selected lines
                        </div>
                    ) : (
                        <div className="mt-3 text-xs text-white/55">Enter quantity to build the opening batch.</div>
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

            <div className="grid gap-4 rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
                <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                            <div className="inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-indigo-700">
                                <ClipboardList className="h-4 w-4" />
                                Fast paste
                            </div>
                            <div className="mt-1 font-display text-lg font-bold text-slate-950">Paste opening rows without hunting the table</div>
                        </div>
                        <Badge variant="outline" className="rounded-full border-indigo-200 bg-indigo-50 text-indigo-700">
                            Bulk, granules, inks, packaging
                        </Badge>
                    </div>
                    <Textarea
                        value={quickPaste}
                        onChange={(event) => setQuickPaste(event.target.value)}
                        placeholder={"material_code, qty, location_code, rate, granule_code\nG-LLDPE, 125.5, RM, 80, G4\nPK-SHEET, 42, RM, 1.25"}
                        className="min-h-[118px] rounded-2xl border-slate-200 bg-slate-50 font-mono text-xs"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                        <Button type="button" size="sm" onClick={applyQuickPaste} className="rounded-xl bg-slate-950 text-white hover:bg-slate-800">
                            <ClipboardList className="mr-2 h-4 w-4" />
                            Apply paste
                        </Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => setQuickPaste("")} className="rounded-xl">
                            Clear
                        </Button>
                        <span className="text-xs font-semibold text-slate-500">
                            Format accepts comma, tab, or pipe. Roll labels still use the physical roll section below.
                        </span>
                    </div>
                </div>

                <div className="space-y-3 rounded-[18px] border border-blue-100 bg-blue-50/45 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <div className="inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-blue-700">
                                <Upload className="h-4 w-4" />
                                Bulk upload
                            </div>
                            <div className="mt-1 font-display text-lg font-bold text-slate-950">Validate CSV/XLSX, then post</div>
                            <p className="mt-1 text-xs font-semibold leading-5 text-slate-600">
                                Use material codes, location codes, granule codes, and roll specs. Dry-run catches missing codes before stock moves.
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {(["BULK", "ROLL", "PACKAGING"] as const).map((klass) => (
                                <button
                                    key={klass}
                                    type="button"
                                    onClick={() => window.open(inventoryService.getAuditSampleTemplateUrl({ type: "OPENING_STOCK", stock_class: klass }), "_blank", "noopener,noreferrer")}
                                    className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-white px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-blue-700 hover:bg-blue-50"
                                >
                                    <Download className="h-3 w-3" />
                                    {klass}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                        <Input
                            type="file"
                            accept=".csv,.xlsx,.xlsm"
                            onChange={(event) => {
                                setUploadFile(event.target.files?.[0] || null)
                                setUploadResult(null)
                            }}
                            className="h-10 rounded-xl bg-white text-xs"
                        />
                        <Button
                            type="button"
                            variant="outline"
                            disabled={!uploadFile || uploadMutation.isPending}
                            onClick={() => uploadMutation.mutate({ commit: false })}
                            className="rounded-xl bg-white"
                        >
                            {uploadMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                            Validate
                        </Button>
                        <Button
                            type="button"
                            disabled={!uploadFile || uploadMutation.isPending || (uploadResult?.rows_invalid ?? 0) > 0}
                            onClick={() => uploadMutation.mutate({ commit: true })}
                            className="rounded-xl bg-emerald-600 text-white hover:bg-emerald-500"
                        >
                            {uploadMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                            Post file
                        </Button>
                    </div>
                    {uploadResult ? (
                        <div className="rounded-2xl border border-blue-100 bg-white p-3 text-xs font-semibold text-slate-700">
                            <div className="flex flex-wrap items-center gap-2">
                                <Badge className="rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">{uploadResult.rows_valid ?? uploadResult.rows_committed ?? 0} valid</Badge>
                                <Badge className="rounded-full bg-amber-50 text-amber-700 ring-1 ring-amber-200">{uploadResult.rows_invalid ?? 0} issues</Badge>
                                {uploadResult.summary_by_klass
                                    ? Object.entries(uploadResult.summary_by_klass).map(([klass, count]) => (
                                        <Badge key={klass} variant="outline" className="rounded-full bg-slate-50">{klass}: {count}</Badge>
                                    ))
                                    : null}
                            </div>
                            {uploadResult.errors?.length ? (
                                <div className="mt-2 space-y-1 text-amber-800">
                                    {uploadResult.errors.slice(0, 3).map((error, index) => (
                                        <div key={`${error.row}-${index}`}>Row {error.row || "?"}: {error.message || "Check this row."}</div>
                                    ))}
                                </div>
                            ) : (
                                <div className="mt-2 text-emerald-700">No upload blockers found.</div>
                            )}
                        </div>
                    ) : null}
                </div>
            </div>

            {/* Grouped rows */}
            <div className="space-y-6">
                {Object.entries(grouped).length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center text-sm font-semibold text-slate-500">
                        No stock masters match the current filter.
                    </div>
                ) : (
                    Object.entries(grouped).map(([category, list]) => {
                        const meta =
                            CATEGORY_META.find((item) => item.key === category) || {
                                key: category,
                                label: category,
                                icon: Sparkles,
                                accent: "from-slate-500 to-slate-700",
                            }
                        const Icon = meta.icon
                        const rollList = list.filter((row) => row.stock_class === "ROLL")
                        const nonRollList = list.filter((row) => row.stock_class !== "ROLL")
                        return (
                            <section key={category} className="overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-[0_10px_30px_-24px_rgba(15,23,42,0.35)]">
                                <div className={cn("flex items-center justify-between gap-3 bg-gradient-to-r px-4 py-3 text-white", meta.accent)}>
                                    <div className="flex items-center gap-2">
                                        <Icon className="h-4 w-4" />
                                        <span className="font-display text-sm font-bold">{meta.label}</span>
                                        <Badge className="border-0 bg-white/20 text-white">{list.length}</Badge>
                                    </div>
                                    <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/75">
                                        {rollList.length ? "physical roll entry" : "pooled stock entry"}
                                    </div>
                                </div>

                                {nonRollList.length ? (
                                    <div className="overflow-x-auto">
                                        <table className="w-full min-w-[900px] text-sm">
                                            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                                                <tr>
                                                    <th className="px-4 py-2 text-left">Material</th>
                                                    <th className="px-4 py-2 text-left">Stock identity</th>
                                                    <th className="px-4 py-2 text-right">System</th>
                                                    <th className="px-4 py-2 text-left">Opening qty</th>
                                                    <th className="px-4 py-2 text-left">Rate</th>
                                                    <th className="px-4 py-2 text-left">Location</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100">
                                                {nonRollList.map((row) => {
                                                    const draft = drafts[row.id]
                                                    const needsGranuleCode = row.category === "GRANULE" && (row.granule_codes || []).length > 0
                                                    return (
                                                        <tr key={row.id} data-testid={`open-row-${row.id}`} className="hover:bg-slate-50/70">
                                                            <td className="px-4 py-3">
                                                                <div className="font-mono text-xs font-bold text-indigo-700">{row.code}</div>
                                                                <div className="font-display text-sm font-semibold text-slate-900">{row.name}</div>
                                                                <div className="mt-1 text-[11px] font-semibold text-slate-500">{rowKind(row)}</div>
                                                            </td>
                                                            <td className="px-4 py-3">
                                                                {needsGranuleCode ? (
                                                                    <Select
                                                                        value={draft?.granuleCodeId || "__none__"}
                                                                        onValueChange={(value) => setDraft(row.id, { granuleCodeId: value === "__none__" ? "" : value })}
                                                                    >
                                                                        <SelectTrigger className="h-9 rounded-xl text-xs">
                                                                            <SelectValue placeholder="Select granule code" />
                                                                        </SelectTrigger>
                                                                        <SelectContent>
                                                                            <SelectItem value="__none__">Select granule code</SelectItem>
                                                                            {(row.granule_codes || []).map((code) => (
                                                                                <SelectItem key={code.id} value={code.id}>
                                                                                    {code.code} - {code.name || code.code}
                                                                                </SelectItem>
                                                                            ))}
                                                                        </SelectContent>
                                                                    </Select>
                                                                ) : (
                                                                    <div className="inline-flex h-9 items-center rounded-xl bg-slate-100 px-3 text-xs font-bold text-slate-600">
                                                                        {row.category}
                                                                    </div>
                                                                )}
                                                            </td>
                                                            <td className="px-4 py-3 text-right font-mono text-xs font-semibold text-slate-600">
                                                                {fmtQty(row.system_qty)} {row.base_uom}
                                                            </td>
                                                            <td className="px-4 py-3">
                                                                <Input
                                                                    data-testid={`open-qty-${row.id}`}
                                                                    type="number"
                                                                    inputMode="decimal"
                                                                    min="0"
                                                                    step="0.001"
                                                                    value={draft?.qty || ""}
                                                                    onChange={(event) => setDraft(row.id, { qty: event.target.value })}
                                                                    placeholder={`0.000 ${row.base_uom}`}
                                                                    className="h-9 rounded-xl"
                                                                />
                                                            </td>
                                                            <td className="px-4 py-3">
                                                                <Input
                                                                    type="number"
                                                                    inputMode="decimal"
                                                                    min="0"
                                                                    step="0.01"
                                                                    value={draft?.rate || ""}
                                                                    onChange={(event) => setDraft(row.id, { rate: event.target.value })}
                                                                    placeholder="fallback"
                                                                    className="h-9 rounded-xl"
                                                                />
                                                            </td>
                                                            <td className="px-4 py-3">
                                                                <LocationSelect
                                                                    value={draft?.locationId || ""}
                                                                    locations={plantLocations}
                                                                    placeholder="Select location"
                                                                    onChange={(value) => setDraft(row.id, { locationId: value })}
                                                                />
                                                            </td>
                                                        </tr>
                                                    )
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : null}

                                {rollList.length ? (
                                    <div className="divide-y divide-slate-100">
                                        {rollList.map((row) => (
                                            <div key={row.id} data-testid={`open-roll-row-${row.id}`} className="p-4">
                                                <div className="flex flex-wrap items-start justify-between gap-3">
                                                    <div>
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <Badge className="rounded-full bg-blue-50 text-blue-700 ring-1 ring-blue-200">
                                                                <PackageCheck className="mr-1 h-3 w-3" />
                                                                {row.code}
                                                            </Badge>
                                                            <Badge variant="outline" className="rounded-full">
                                                                {row.is_extrudable ? "Extrudable grade required" : "Purchased / non-extrudable"}
                                                            </Badge>
                                                            <Badge variant="outline" className="rounded-full">
                                                                System {fmtQty(row.system_qty)} KG
                                                            </Badge>
                                                        </div>
                                                        <div className="mt-1 font-display text-base font-bold text-slate-900">{row.name}</div>
                                                        <div className="text-xs font-semibold text-slate-500">
                                                            Enter each physical roll label separately: weight, width, micron, form, location, grade.
                                                        </div>
                                                    </div>
                                                    <Button type="button" variant="outline" size="sm" onClick={() => addRollDraft(row.id)} className="rounded-xl">
                                                        <Plus className="mr-2 h-4 w-4" />
                                                        Add roll
                                                    </Button>
                                                </div>

                                                <div className="mt-3 space-y-3">
                                                    {rollEntries(row.id).map((entry, index) => (
                                                        <div key={entry.id} className="rounded-2xl border border-blue-100 bg-blue-50/35 p-3">
                                                            <div className="mb-2 flex items-center justify-between gap-2">
                                                                <div className="inline-flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.14em] text-blue-800">
                                                                    <Boxes className="h-4 w-4" />
                                                                    Roll {index + 1}
                                                                </div>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => removeRollDraft(row.id, index)}
                                                                    className="rounded-lg p-1 text-slate-400 hover:bg-white hover:text-rose-600"
                                                                    title="Remove roll entry"
                                                                >
                                                                    <Trash2 className="h-4 w-4" />
                                                                </button>
                                                            </div>
                                                            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                                                                <Field label="Label">
                                                                    <Input value={entry.labelId || ""} onChange={(event) => setRollDraft(row.id, index, { labelId: event.target.value })} placeholder="optional / auto" className="h-9 rounded-xl bg-white" />
                                                                </Field>
                                                                <Field label="Weight kg">
                                                                    <Input value={entry.qty || ""} onChange={(event) => setRollDraft(row.id, index, { qty: event.target.value })} type="number" min="0" step="0.001" placeholder="0.000" className="h-9 rounded-xl bg-white" />
                                                                </Field>
                                                                <Field label="Width mm">
                                                                    <Input value={entry.widthMm || ""} onChange={(event) => setRollDraft(row.id, index, { widthMm: event.target.value })} type="number" min="0" step="0.01" placeholder="open / lay-flat width" className="h-9 rounded-xl bg-white" />
                                                                </Field>
                                                                <Field label="Micron">
                                                                    <Input value={entry.thicknessMicron || ""} onChange={(event) => setRollDraft(row.id, index, { thicknessMicron: event.target.value })} type="number" min="0" step="0.01" placeholder="thickness" className="h-9 rounded-xl bg-white" />
                                                                </Field>
                                                                <Field label="Stock form">
                                                                    <Select value={entry.stockForm || "OPEN_WEB"} onValueChange={(value) => setRollDraft(row.id, index, { stockForm: value })}>
                                                                        <SelectTrigger className="h-9 rounded-xl bg-white text-xs">
                                                                            <SelectValue />
                                                                        </SelectTrigger>
                                                                        <SelectContent>
                                                                            {STOCK_FORM_OPTIONS.map((option) => (
                                                                                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                                                            ))}
                                                                        </SelectContent>
                                                                    </Select>
                                                                </Field>
                                                                <Field label="Width basis">
                                                                    <Select value={entry.widthBasis || widthBasisForForm(entry.stockForm)} onValueChange={(value) => setRollDraft(row.id, index, { widthBasis: value })}>
                                                                        <SelectTrigger className="h-9 rounded-xl bg-white text-xs">
                                                                            <SelectValue />
                                                                        </SelectTrigger>
                                                                        <SelectContent>
                                                                            {WIDTH_BASIS_OPTIONS.map((option) => (
                                                                                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                                                            ))}
                                                                        </SelectContent>
                                                                    </Select>
                                                                </Field>
                                                                {row.is_extrudable ? (
                                                                    <Field label="Grade">
                                                                        <Select value={entry.gradeId || row.default_grade_id || "__none__"} onValueChange={(value) => setRollDraft(row.id, index, { gradeId: value === "__none__" ? "" : value })}>
                                                                            <SelectTrigger className="h-9 rounded-xl bg-white text-xs">
                                                                                <SelectValue placeholder={row.default_grade_name || "Select grade"} />
                                                                            </SelectTrigger>
                                                                            <SelectContent>
                                                                                <SelectItem value="__none__">Select grade</SelectItem>
                                                                                {grades.map((grade) => (
                                                                                    <SelectItem key={grade.id} value={grade.id}>{grade.name}</SelectItem>
                                                                                ))}
                                                                            </SelectContent>
                                                                        </Select>
                                                                    </Field>
                                                                ) : null}
                                                                <Field label="Location">
                                                                    <LocationSelect
                                                                        value={entry.locationId || ""}
                                                                        locations={plantLocations}
                                                                        placeholder="Select location"
                                                                        onChange={(value) => setRollDraft(row.id, index, { locationId: value })}
                                                                    />
                                                                </Field>
                                                                <Field label="Length m">
                                                                    <Input value={entry.lengthM || ""} onChange={(event) => setRollDraft(row.id, index, { lengthM: event.target.value })} type="number" min="0" step="0.01" placeholder="optional" className="h-9 rounded-xl bg-white" />
                                                                </Field>
                                                                <Field label="Batch">
                                                                    <Input value={entry.batchNo || ""} onChange={(event) => setRollDraft(row.id, index, { batchNo: event.target.value })} placeholder="lot / invoice batch" className="h-9 rounded-xl bg-white" />
                                                                </Field>
                                                                <Field label="Rate">
                                                                    <Input value={entry.rate || ""} onChange={(event) => setRollDraft(row.id, index, { rate: event.target.value })} type="number" min="0" step="0.01" placeholder="fallback" className="h-9 rounded-xl bg-white" />
                                                                </Field>
                                                            </div>
                                                            <div className="mt-2 text-[11px] font-semibold text-blue-800">
                                                                {stockFormLabel(entry.stockForm)} uses {WIDTH_BASIS_OPTIONS.find((item) => item.value === (entry.widthBasis || widthBasisForForm(entry.stockForm)))?.label || "width basis"}.
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : null}
                            </section>
                        )
                    })
                )}
            </div>

            <div className="sticky bottom-3 z-10 mt-2 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur">
                <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                    <span className="font-display text-lg font-semibold text-slate-950">{lineValidation.ready}</span>
                    <span>opening line{lineValidation.ready === 1 ? "" : "s"} ready</span>
                    {lineValidation.errors.length ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            {lineValidation.errors.length} issue{lineValidation.errors.length === 1 ? "" : "s"}
                        </span>
                    ) : null}
                </div>
                <Button
                    data-testid="open-stock-post"
                    disabled={lineValidation.ready === 0 || lineValidation.errors.length > 0 || mutation.isPending}
                    onClick={() => mutation.mutate()}
                    className="rounded-xl bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 text-white hover:from-indigo-500 hover:via-violet-500 hover:to-fuchsia-500"
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="grid gap-1">
            <span className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-slate-500">{label}</span>
            {children}
        </label>
    )
}

function LocationSelect({
    value,
    locations,
    placeholder,
    onChange,
}: {
    value: string
    locations: Location[]
    placeholder: string
    onChange: (value: string) => void
}) {
    return (
        <Select value={value || "__none__"} onValueChange={(next) => onChange(next === "__none__" ? "" : next)}>
            <SelectTrigger className="h-9 rounded-xl bg-white text-xs">
                <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value="__none__">{placeholder}</SelectItem>
                {locations.map((location) => (
                    <SelectItem key={location.id} value={location.id}>
                        {location.code ? `${location.code} - ${location.name}` : location.name}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    )
}
