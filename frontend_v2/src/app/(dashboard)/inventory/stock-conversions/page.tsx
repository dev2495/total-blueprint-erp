"use client"

import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowRight, CheckCircle2, Layers, Repeat, Scissors, Search, SplitSquareHorizontal, UnfoldVertical } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { inventoryService, Roll, StockFormOperation } from "@/services/inventory"

const STOCK_FORM_LABEL: Record<string, string> = {
    OPEN_WEB: "Open web",
    LAYFLAT_TUBE: "Lay-flat tube",
    FOLDED_WEB: "Folded web",
}

const FALLBACK_OPERATIONS: StockFormOperation[] = [
    { code: "SLIT_OPEN_WEB", label: "Slit open-web jumbo", from_stock_form: "OPEN_WEB", to_stock_form: "OPEN_WEB", requires_child_widths: true },
    { code: "OPEN_TUBE_ONE_WEB", label: "Open tube to one sheet", from_stock_form: "LAYFLAT_TUBE", to_stock_form: "OPEN_WEB" },
    { code: "OPEN_TUBE_TWO_WEBS", label: "Open tube to two sheets", from_stock_form: "LAYFLAT_TUBE", to_stock_form: "OPEN_WEB" },
    { code: "FOLD_OPEN_WEB", label: "Fold open web", from_stock_form: "OPEN_WEB", to_stock_form: "FOLDED_WEB" },
    { code: "UNFOLD_FOLDED_WEB", label: "Unfold to open web", from_stock_form: "FOLDED_WEB", to_stock_form: "OPEN_WEB" },
]

function stockFormLabel(value?: string) {
    const key = String(value || "OPEN_WEB").toUpperCase()
    return STOCK_FORM_LABEL[key] || key.replace(/_/g, " ")
}

function operationIcon(code: string) {
    if (code === "SLIT_OPEN_WEB") return <Scissors className="h-5 w-5" />
    if (code === "OPEN_TUBE_ONE_WEB" || code === "OPEN_TUBE_TWO_WEBS") return <UnfoldVertical className="h-5 w-5" />
    if (code === "FOLD_OPEN_WEB") return <SplitSquareHorizontal className="h-5 w-5" />
    return <Repeat className="h-5 w-5" />
}

function numberOrZero(value: unknown) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
}

function parseWidths(raw: string) {
    return raw
        .split(/[\s,]+/)
        .map((part) => Number(part.trim()))
        .filter((value) => Number.isFinite(value) && value > 0)
}

function fmt(value: number, digits = 2) {
    if (!Number.isFinite(value)) return "-"
    return value.toLocaleString("en-IN", { maximumFractionDigits: digits })
}

function PreviewRows({ roll, operation, childWidths, trimMm }: { roll?: Roll | null; operation?: StockFormOperation; childWidths: number[]; trimMm: number }) {
    const preview = useMemo(() => {
        if (!roll || !operation) return { rows: [] as Array<Record<string, any>>, errors: [] as string[], scrapWidth: 0, scrapKg: 0, remainder: null as any }
        const parentWidth = numberOrZero(roll.width_mm)
        const parentWeight = numberOrZero(roll.weight_kg)
        const kgPerMm = parentWidth > 0 ? parentWeight / parentWidth : 0
        const rows: Array<Record<string, any>> = []
        const errors: string[] = []
        let scrapWidth = 0
        let scrapKg = 0
        let remainder: Record<string, any> | null = null

        if (parentWidth <= 0 || parentWeight <= 0) errors.push("Parent roll needs positive width and weight.")

        switch (operation.code) {
            case "OPEN_TUBE_ONE_WEB":
                rows.push({ label: "Opened web", width: parentWidth * 2, weight: parentWeight, form: "OPEN_WEB" })
                break
            case "OPEN_TUBE_TWO_WEBS":
                rows.push({ label: "Sheet 1", width: parentWidth, weight: parentWeight / 2, form: "OPEN_WEB" })
                rows.push({ label: "Sheet 2", width: parentWidth, weight: parentWeight / 2, form: "OPEN_WEB" })
                break
            case "FOLD_OPEN_WEB":
                rows.push({ label: "Folded web", width: parentWidth / 2, weight: parentWeight, form: "FOLDED_WEB" })
                break
            case "UNFOLD_FOLDED_WEB":
                rows.push({ label: "Open web", width: parentWidth * 2, weight: parentWeight, form: "OPEN_WEB" })
                break
            case "SLIT_OPEN_WEB": {
                if (!childWidths.length) errors.push("Enter at least one child width.")
                const consumedWidth = childWidths.reduce((sum, width) => sum + width, 0) + trimMm * childWidths.length
                if (consumedWidth > parentWidth) errors.push("Child widths plus trim exceed parent width.")
                childWidths.forEach((width, index) => rows.push({ label: `Child ${index + 1}`, width, weight: width * kgPerMm, form: "OPEN_WEB" }))
                const remWidth = Math.max(0, parentWidth - consumedWidth)
                if (remWidth > 0) remainder = { label: "Remainder", width: remWidth, weight: remWidth * kgPerMm, form: "OPEN_WEB" }
                scrapWidth = Math.max(0, trimMm * childWidths.length)
                scrapKg = scrapWidth * kgPerMm
                break
            }
            default:
                errors.push("Unsupported operation.")
        }

        return { rows, errors, scrapWidth, scrapKg, remainder }
    }, [roll, operation, childWidths, trimMm])

    if (!roll || !operation) {
        return <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">Pick an operation and roll to preview the physical children.</div>
    }

    return (
        <div className="space-y-3">
            {preview.errors.length ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">
                    {preview.errors.join(" ")}
                </div>
            ) : null}
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <div className="grid grid-cols-[1.2fr_1fr_1fr_1fr] gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3 text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">
                    <div>Output</div>
                    <div>Stock form</div>
                    <div>Width</div>
                    <div>Weight</div>
                </div>
                {preview.rows.map((row) => (
                    <div key={`${row.label}-${row.width}`} className="grid grid-cols-[1.2fr_1fr_1fr_1fr] gap-3 border-b border-slate-100 px-4 py-3 text-sm last:border-b-0">
                        <div className="font-bold text-slate-900">{row.label}</div>
                        <div><Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">{stockFormLabel(row.form)}</Badge></div>
                        <div className="font-mono font-bold">{fmt(row.width)} mm</div>
                        <div className="font-mono font-bold">{fmt(row.weight, 3)} kg</div>
                    </div>
                ))}
                {preview.remainder ? (
                    <div className="grid grid-cols-[1.2fr_1fr_1fr_1fr] gap-3 border-t border-amber-100 bg-amber-50 px-4 py-3 text-sm">
                        <div className="font-bold text-amber-900">{preview.remainder.label}</div>
                        <div><Badge variant="outline" className="border-amber-200 bg-white text-amber-700">{stockFormLabel(preview.remainder.form)}</Badge></div>
                        <div className="font-mono font-bold">{fmt(preview.remainder.width)} mm</div>
                        <div className="font-mono font-bold">{fmt(preview.remainder.weight, 3)} kg</div>
                    </div>
                ) : null}
            </div>
            <div className="flex flex-wrap gap-2 text-xs font-bold text-slate-600">
                <Badge variant="secondary">Parent {fmt(numberOrZero(roll.width_mm))} mm · {fmt(numberOrZero(roll.weight_kg), 3)} kg</Badge>
                <Badge variant="secondary">Scrap {fmt(preview.scrapWidth)} mm · {fmt(preview.scrapKg, 3)} kg</Badge>
            </div>
        </div>
    )
}

export default function StockConversionsPage() {
    const { toast } = useToast()
    const queryClient = useQueryClient()
    const [operationCode, setOperationCode] = useState("SLIT_OPEN_WEB")
    const [selectedRollId, setSelectedRollId] = useState("")
    const [search, setSearch] = useState("")
    const [childWidthsRaw, setChildWidthsRaw] = useState("500, 500")
    const [trimMm, setTrimMm] = useState("0")
    const [reason, setReason] = useState("")

    const operationsQuery = useQuery({
        queryKey: ["inventory-stock-form-operations"],
        queryFn: inventoryService.getStockFormOperations,
    })
    const operations = operationsQuery.data?.length ? operationsQuery.data : FALLBACK_OPERATIONS
    const activeOperation = operations.find((operation) => operation.code === operationCode) || operations[0]

    const rollsQuery = useQuery({
        queryKey: ["inventory-stock-conversion-rolls"],
        queryFn: () => inventoryService.getRolls({ status: "AVAILABLE" }),
    })

    const rolls = rollsQuery.data || []
    const compatibleRolls = useMemo(() => {
        const needle = search.trim().toLowerCase()
        return rolls
            .filter((roll) => String(roll.stock_form || "OPEN_WEB").toUpperCase() === String(activeOperation?.from_stock_form || "OPEN_WEB").toUpperCase())
            .filter((roll) => {
                if (!needle) return true
                return [roll.label_id, roll.material_name, roll.material_code, roll.grade_name, roll.location_name, roll.plant_name]
                    .some((part) => String(part || "").toLowerCase().includes(needle))
            })
            .slice(0, 80)
    }, [rolls, activeOperation, search])

    const selectedRoll = compatibleRolls.find((roll) => roll.id === selectedRollId) || rolls.find((roll) => roll.id === selectedRollId) || null
    const childWidths = useMemo(() => parseWidths(childWidthsRaw), [childWidthsRaw])
    const parsedTrim = numberOrZero(trimMm)

    const convertMutation = useMutation({
        mutationFn: () => inventoryService.convertStockForm(selectedRollId, {
            operation: activeOperation.code,
            child_widths_mm: activeOperation.requires_child_widths ? childWidths : [],
            trim_mm: parsedTrim,
            reason,
        }),
        onSuccess: (result) => {
            toast({
                title: "Stock conversion posted",
                description: `${result.parent_label_id} created ${result.children.length}${result.remainder ? " + remainder" : ""} roll rows.`,
            })
            setSelectedRollId("")
            queryClient.invalidateQueries({ queryKey: ["inventory-stock-conversion-rolls"] })
            queryClient.invalidateQueries({ queryKey: ["inventory-rolls"] })
        },
        onError: (error: any) => {
            const detail = error?.response?.data?.error || error?.response?.data?.detail || error?.message || "Could not post conversion."
            toast({ title: "Conversion failed", description: detail, variant: "destructive" })
        },
    })

    const canSubmit = Boolean(selectedRollId && activeOperation && !convertMutation.isPending && (!activeOperation.requires_child_widths || childWidths.length > 0))

    return (
        <div className="min-h-screen bg-gradient-to-b from-slate-50/90 via-white to-slate-50/60 px-4 py-4 sm:px-6">
            <div className="mx-auto flex max-w-[1800px] flex-col gap-5">
                <section className="rounded-[2rem] bg-gradient-to-r from-slate-950 via-blue-950 to-indigo-900 px-8 py-8 text-white shadow-xl">
                    <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                        <div>
                            <div className="mb-3 text-xs font-black uppercase tracking-[0.32em] text-blue-200">Inventory · Stock Forms</div>
                            <h1 className="font-serif text-4xl font-black leading-tight">Stock conversion workspace</h1>
                            <p className="mt-3 max-w-3xl text-sm text-blue-100">
                                Convert physical roll form without changing route templates: slit open-web jumbos, open tube to sheet, split tube into two webs, fold sheet, or unfold folded stock. Every post preserves weight and roll genealogy.
                            </p>
                        </div>
                        <div className="grid grid-cols-3 gap-3 text-sm">
                            <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3">
                                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-blue-200">Available</div>
                                <div className="mt-1 text-2xl font-black">{rolls.length}</div>
                            </div>
                            <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3">
                                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-blue-200">Compatible</div>
                                <div className="mt-1 text-2xl font-black">{compatibleRolls.length}</div>
                            </div>
                            <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3">
                                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-blue-200">Mode</div>
                                <div className="mt-1 text-sm font-black">{stockFormLabel(activeOperation?.from_stock_form)}</div>
                            </div>
                        </div>
                    </div>
                </section>

                <section className="grid gap-4 xl:grid-cols-[360px_1fr]">
                    <Card className="rounded-3xl border-slate-200 shadow-sm">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-lg">
                                <Repeat className="h-5 w-5 text-blue-600" /> Operation
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {operations.map((operation) => {
                                const active = operation.code === activeOperation?.code
                                return (
                                    <button
                                        key={operation.code}
                                        type="button"
                                        onClick={() => {
                                            setOperationCode(operation.code)
                                            setSelectedRollId("")
                                        }}
                                        className={`w-full rounded-2xl border p-4 text-left transition ${active ? "border-blue-400 bg-blue-50 shadow-sm" : "border-slate-200 bg-white hover:border-blue-200 hover:bg-slate-50"}`}
                                    >
                                        <div className="flex items-start gap-3">
                                            <div className={`rounded-xl p-2 ${active ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}>{operationIcon(operation.code)}</div>
                                            <div className="min-w-0">
                                                <div className="font-black text-slate-900">{operation.label}</div>
                                                <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-slate-500">
                                                    <Badge variant="outline">{stockFormLabel(operation.from_stock_form)}</Badge>
                                                    <ArrowRight className="h-3 w-3" />
                                                    <Badge variant="outline">{stockFormLabel(operation.to_stock_form)}</Badge>
                                                </div>
                                            </div>
                                        </div>
                                    </button>
                                )
                            })}
                        </CardContent>
                    </Card>

                    <div className="grid gap-4 2xl:grid-cols-[1.1fr_0.9fr]">
                        <Card className="rounded-3xl border-slate-200 shadow-sm">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2 text-lg">
                                    <Layers className="h-5 w-5 text-emerald-600" /> Pick parent roll
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="relative">
                                    <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                                    <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search roll, material, grade, location…" className="h-11 rounded-2xl pl-9" />
                                </div>
                                <div className="max-h-[540px] overflow-auto rounded-2xl border border-slate-200">
                                    <div className="grid grid-cols-[1.2fr_1fr_0.8fr_0.8fr_1fr] gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3 text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">
                                        <div>Roll</div>
                                        <div>Form</div>
                                        <div>Width</div>
                                        <div>Weight</div>
                                        <div>Location</div>
                                    </div>
                                    {compatibleRolls.map((roll) => {
                                        const active = selectedRollId === roll.id
                                        return (
                                            <button
                                                key={roll.id}
                                                type="button"
                                                onClick={() => setSelectedRollId(roll.id)}
                                                className={`grid w-full grid-cols-[1.2fr_1fr_0.8fr_0.8fr_1fr] gap-3 border-b border-slate-100 px-4 py-3 text-left text-sm last:border-b-0 ${active ? "bg-emerald-50" : "bg-white hover:bg-slate-50"}`}
                                            >
                                                <div>
                                                    <div className="font-black text-slate-900">{roll.label_id}</div>
                                                    <div className="text-xs text-slate-500">{roll.material_code} · {roll.thickness_micron || "-"} µ {roll.grade_name ? `· ${roll.grade_name}` : ""}</div>
                                                </div>
                                                <div><Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">{stockFormLabel(roll.stock_form)}</Badge></div>
                                                <div className="font-mono font-black">{fmt(numberOrZero(roll.width_mm))} mm</div>
                                                <div className="font-mono font-black">{fmt(numberOrZero(roll.weight_kg), 3)} kg</div>
                                                <div className="text-xs font-semibold text-slate-600">{roll.location_name || roll.plant_name || "-"}</div>
                                            </button>
                                        )
                                    })}
                                    {!compatibleRolls.length ? (
                                        <div className="p-8 text-center text-sm text-slate-500">No available {stockFormLabel(activeOperation?.from_stock_form)} rolls match this filter.</div>
                                    ) : null}
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="rounded-3xl border-slate-200 shadow-sm">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2 text-lg">
                                    <CheckCircle2 className="h-5 w-5 text-emerald-600" /> Preview and post
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {activeOperation?.requires_child_widths ? (
                                    <div className="grid gap-3 sm:grid-cols-[1fr_150px]">
                                        <div>
                                            <Label className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">Child widths (mm)</Label>
                                            <Input value={childWidthsRaw} onChange={(event) => setChildWidthsRaw(event.target.value)} placeholder="500, 500, 300" className="mt-1 h-11 rounded-2xl font-mono" />
                                        </div>
                                        <div>
                                            <Label className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">Trim per child</Label>
                                            <Input value={trimMm} onChange={(event) => setTrimMm(event.target.value)} className="mt-1 h-11 rounded-2xl font-mono" />
                                        </div>
                                    </div>
                                ) : null}
                                <div>
                                    <Label className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">Reason / operator note</Label>
                                    <Textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Example: Open tube for side-seal job; slit jumbo for exact WCM pick." className="mt-1 min-h-[84px] rounded-2xl" />
                                </div>
                                <PreviewRows roll={selectedRoll} operation={activeOperation} childWidths={childWidths} trimMm={parsedTrim} />
                                <Button disabled={!canSubmit} onClick={() => convertMutation.mutate()} className="h-12 w-full rounded-2xl bg-emerald-600 font-black hover:bg-emerald-700">
                                    {convertMutation.isPending ? "Posting…" : "Post conversion"}
                                </Button>
                            </CardContent>
                        </Card>
                    </div>
                </section>
            </div>
        </div>
    )
}
