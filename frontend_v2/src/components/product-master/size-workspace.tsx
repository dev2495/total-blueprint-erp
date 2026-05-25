"use client"

import * as React from "react"
import {
    AlertTriangle,
    CheckCircle2,
    Download,
    FileSpreadsheet,
    Plus,
    Search,
    Trash2,
    Upload,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useToast } from "@/hooks/use-toast"
import { computeProductGeometry, resolveProductOutputKind } from "@/lib/product-geometry"
import { cn } from "@/lib/utils"
import type { ProductKind, ProductMasterSize } from "@/services/product-master"
import { SizeGeometryEditor } from "@/components/product-master/size-geometry-editor"

type OutputKind = "POUCH" | "ROLL" | "OTHER"
type BulkAction = "create" | "update"

interface ProductSizeWorkspaceProps {
    rows: ProductMasterSize[]
    productId: string
    kind: ProductKind | string
    packagingKind?: string | null
    fixedFgType?: string | null
    onAdd: () => void
    onPatch: (index: number, patch: Partial<ProductMasterSize>) => void
    onRemove: (index: number) => void
    onBulkApply: (rows: ProductMasterSize[]) => void
}

interface ReviewRow {
    id: string
    action: BulkAction
    row: ProductMasterSize
    errors: string[]
}

const COMMON_UOMS = ["KG", "PCS", "METER"] as const
const POUCH_TEMPLATE_HEADERS = [
    "code",
    "label",
    "width_mm",
    "height_mm",
    "pouch_style_master",
    "pouch_style",
    "gusset_mm",
    "flap_tape_mm",
    "trim_loss_mm",
    "trim_apply_to",
    "faces",
    "roll_width_mm",
    "child_target_width_mm",
    "child_target_override",
    "standard_qty",
    "qty_uom",
    "active",
    "sort_order",
    "notes",
]
const ROLL_TEMPLATE_HEADERS = [
    "code",
    "label",
    "width_mm",
    "roll_form",
    "trim_loss_mm",
    "trim_apply_to",
    "roll_width_mm",
    "thickness_micron",
    "standard_qty",
    "qty_uom",
    "active",
    "sort_order",
    "notes",
]

export function ProductSizeWorkspace({
    rows,
    productId,
    kind,
    packagingKind,
    fixedFgType,
    onAdd,
    onPatch,
    onRemove,
    onBulkApply,
}: ProductSizeWorkspaceProps) {
    const { toast } = useToast()
    const fileInputRef = React.useRef<HTMLInputElement | null>(null)
    const [selectedIndex, setSelectedIndex] = React.useState(0)
    const [search, setSearch] = React.useState("")
    const [reviewRows, setReviewRows] = React.useState<ReviewRow[]>([])
    const [reviewOpen, setReviewOpen] = React.useState(false)
    const outputKind = resolveProductOutputKind(kind, packagingKind, fixedFgType)
    const normalizedOutput = outputKind === "POUCH" || outputKind === "ROLL" ? outputKind : "OTHER"

    React.useEffect(() => {
        if (!rows.length) {
            setSelectedIndex(0)
            return
        }
        setSelectedIndex((index) => Math.min(Math.max(index, 0), rows.length - 1))
    }, [rows.length])

    const selectedRow = rows[selectedIndex] || null
    const visibleRows = React.useMemo(() => {
        const needle = search.trim().toLowerCase()
        return rows
            .map((row, index) => ({ row, index }))
            .filter(({ row }) => {
                if (!needle) return true
                return [row.code, row.label, row.notes, row.roll_form, row.pouch_style]
                    .map((value) => String(value || "").toLowerCase())
                    .some((value) => value.includes(needle))
            })
    }, [rows, search])

    function handleAdd() {
        setSelectedIndex(rows.length)
        onAdd()
    }

    function handleRemove(index: number) {
        onRemove(index)
        setSelectedIndex((current) => {
            if (current > index) return current - 1
            if (current === index) return Math.max(0, current - 1)
            return current
        })
    }

    function downloadTemplate() {
        const headers = templateHeaders(normalizedOutput)
        const sample = sampleRow(normalizedOutput, rows.length + 1)
        const csv = toCsv([headers, headers.map((header) => sample[header] ?? "")])
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement("a")
        anchor.href = url
        anchor.download = `product-master-${normalizedOutput.toLowerCase()}-sizes-template.csv`
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
        URL.revokeObjectURL(url)
        toast({
            title: "Template downloaded",
            description: "Open it in Excel, add one row per size, then upload the CSV for review.",
        })
    }

    async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0]
        event.target.value = ""
        if (!file) return
        if (!file.name.toLowerCase().endsWith(".csv")) {
            toast({
                title: "Upload CSV exported from Excel",
                description: "This bulk editor validates CSV files so every row can be reviewed before import.",
                variant: "destructive",
            })
            return
        }
        try {
            const parsed = parseCsv(await file.text())
            if (!parsed.length) {
                toast({ title: "No rows found", description: "The uploaded file has headers but no size rows.", variant: "destructive" })
                return
            }
            const next = parsed.map((raw, index) => {
                const row = rowFromCsv(raw, normalizedOutput, productId, rows.length + index + 1)
                const action: BulkAction = rows.some((existing) => sameCode(existing.code, row.code)) ? "update" : "create"
                return {
                    id: `review-${Date.now()}-${index}`,
                    action,
                    row,
                    errors: validateRow(row, normalizedOutput),
                }
            })
            setReviewRows(withDuplicateErrors(next, normalizedOutput))
            setReviewOpen(true)
            toast({ title: "Bulk file loaded", description: `${next.length} rows ready for review.` })
        } catch (error: any) {
            toast({
                title: "Could not read file",
                description: error?.message || "Check the CSV and upload again.",
                variant: "destructive",
            })
        }
    }

    function patchReviewRow(index: number, patch: Partial<ProductMasterSize>) {
        setReviewRows((current) => {
            const next = current.map((item, itemIndex) => {
                if (itemIndex !== index) return item
                const row = { ...item.row, ...patch }
                const action: BulkAction = rows.some((existing) => sameCode(existing.code, row.code)) ? "update" : "create"
                return { ...item, row, action }
            })
            return withDuplicateErrors(next, normalizedOutput)
        })
    }

    function confirmBulkImport() {
        const invalidCount = reviewRows.reduce((total, item) => total + item.errors.length, 0)
        if (invalidCount) {
            toast({
                title: "Fix validation first",
                description: `${invalidCount} issue${invalidCount === 1 ? "" : "s"} still need attention.`,
                variant: "destructive",
            })
            return
        }
        const merged = mergeRows(rows, reviewRows.map((item) => item.row))
        onBulkApply(merged)
        setSelectedIndex(Math.max(0, rows.length ? selectedIndex : 0))
        setReviewOpen(false)
        setReviewRows([])
        toast({
            title: "Sizes imported into draft",
            description: `${merged.length} size rows are now in the editor. Save the master to publish them.`,
        })
    }

    return (
        <div className="space-y-4" data-testid="product-size-workspace" data-output-kind={normalizedOutput}>
            <div className="flex flex-col gap-3 rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50 via-white to-teal-50/40 p-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-start gap-3">
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-600 text-white shadow-sm">
                        <FileSpreadsheet className="h-4 w-4" />
                    </span>
                    <div>
                        <div className="text-sm font-black text-slate-950">Compact size workspace</div>
                        <div className="mt-0.5 text-xs leading-5 text-slate-600">
                            Left side stays one line per size. Pick a row to edit the full {normalizedOutput.toLowerCase()} geometry on the right.
                        </div>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" size="sm" variant="outline" className="rounded-xl" onClick={downloadTemplate}>
                        <Download className="mr-1.5 h-3.5 w-3.5" />
                        Template
                    </Button>
                    <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleUpload} />
                    <Button type="button" size="sm" variant="outline" className="rounded-xl" onClick={() => fileInputRef.current?.click()}>
                        <Upload className="mr-1.5 h-3.5 w-3.5" />
                        Bulk upload
                    </Button>
                    <Button type="button" size="sm" className="rounded-xl bg-emerald-700 hover:bg-emerald-800" onClick={handleAdd}>
                        <Plus className="mr-1.5 h-3.5 w-3.5" />
                        Add size
                    </Button>
                </div>
            </div>

            {rows.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/40 p-6 text-center text-sm text-slate-500">
                    No sizes yet. Add one size manually or import a template file.
                </div>
            ) : (
                <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(360px,0.9fr)_minmax(0,1.35fr)]">
                    <div className="min-w-0 rounded-2xl border border-slate-200 bg-white shadow-sm">
                        <div className="border-b border-slate-100 p-3">
                            <div className="flex items-center justify-between gap-2">
                                <div>
                                    <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Size rows</div>
                                    <div className="text-sm font-bold text-slate-950">{rows.length} total - {rows.filter((row) => row.active !== false).length} active</div>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleAdd}
                                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-dashed border-emerald-300 bg-emerald-50 px-2.5 text-[11px] font-bold text-emerald-800 hover:bg-emerald-100"
                                >
                                    <Plus className="h-3.5 w-3.5" />
                                    New
                                </button>
                            </div>
                            <div className="relative mt-3">
                                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                                <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search code, label, notes..." className="h-9 rounded-xl pl-8 text-xs" />
                            </div>
                        </div>

                        <ScrollArea className="h-[520px]">
                            <div className="min-w-[720px]">
                                <Table>
                                    <TableHeader className="sticky top-0 z-10 bg-slate-50">
                                        <TableRow>
                                            <TableHead className="w-[180px] text-[10px] uppercase tracking-widest">Code</TableHead>
                                            <TableHead className="text-[10px] uppercase tracking-widest">Size</TableHead>
                                            <TableHead className="text-[10px] uppercase tracking-widest">Web</TableHead>
                                            <TableHead className="text-[10px] uppercase tracking-widest">UOM</TableHead>
                                            <TableHead className="text-[10px] uppercase tracking-widest">State</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {visibleRows.map(({ row, index }) => {
                                            const selected = index === selectedIndex
                                            const geometry = computeProductGeometry(row, normalizedOutput)
                                            return (
                                                <TableRow
                                                    key={row.id || `${row.code}-${index}`}
                                                    data-testid={`size-row-${index}`}
                                                    onClick={() => setSelectedIndex(index)}
                                                    className={cn(
                                                        "cursor-pointer transition hover:bg-emerald-50/60",
                                                        selected && "bg-emerald-50 ring-1 ring-inset ring-emerald-300",
                                                    )}
                                                >
                                                    <TableCell className="align-top">
                                                        <div className="font-mono text-xs font-black text-slate-950">{row.code || `SZ-${index + 1}`}</div>
                                                        <div className="mt-0.5 truncate text-[11px] text-slate-500">{row.label || "No label"}</div>
                                                    </TableCell>
                                                    <TableCell className="align-top">
                                                        <div className="font-mono text-xs font-bold text-slate-900">{sizeCopy(row, normalizedOutput)}</div>
                                                        <div className="mt-0.5 text-[10px] text-slate-500">{summaryCopy(row, normalizedOutput)}</div>
                                                    </TableCell>
                                                    <TableCell className="align-top">
                                                        <div className="font-mono text-xs font-black text-emerald-800">{webWidthCopy(row, normalizedOutput, geometry)}</div>
                                                        <div className="mt-0.5 text-[10px] text-slate-500">{row.child_target_override ? "override" : "auto/default"}</div>
                                                    </TableCell>
                                                    <TableCell className="align-top">
                                                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-700">{row.qty_uom || "KG"}</span>
                                                    </TableCell>
                                                    <TableCell className="align-top">
                                                        <span className={cn(
                                                            "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ring-1",
                                                            row.active === false
                                                                ? "bg-rose-50 text-rose-700 ring-rose-200"
                                                                : "bg-emerald-50 text-emerald-700 ring-emerald-200",
                                                        )}>
                                                            {row.active === false ? "Inactive" : "Active"}
                                                        </span>
                                                    </TableCell>
                                                </TableRow>
                                            )
                                        })}
                                        {visibleRows.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={5} className="py-8 text-center text-xs font-medium text-slate-500">
                                                    No sizes match this search.
                                                </TableCell>
                                            </TableRow>
                                        ) : null}
                                    </TableBody>
                                </Table>
                            </div>
                        </ScrollArea>
                    </div>

                    <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm xl:sticky xl:top-4 xl:self-start">
                        {selectedRow ? (
                            <>
                                <div className="mb-3 flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3">
                                    <div>
                                        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-700">Selected size</div>
                                        <div className="mt-0.5 font-display text-lg font-black text-slate-950">{selectedRow.code || `Size ${selectedIndex + 1}`}</div>
                                        <div className="text-xs text-slate-500">{selectedRow.label || "No label yet"}</div>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <div className="flex h-9 items-center gap-2 rounded-full bg-slate-50 px-3 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
                                            <Switch checked={selectedRow.active !== false} onCheckedChange={(v) => onPatch(selectedIndex, { active: v })} />
                                            {selectedRow.active === false ? "Inactive" : "Active"}
                                        </div>
                                        <button type="button" onClick={() => handleRemove(selectedIndex)} className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-rose-600 hover:bg-rose-50">
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>
                                </div>
                                <SizeGeometryEditor
                                    row={selectedRow}
                                    kind={kind}
                                    packagingKind={packagingKind ?? null}
                                    fixedFgType={fixedFgType ?? null}
                                    onPatch={(patch) => onPatch(selectedIndex, patch)}
                                />
                            </>
                        ) : (
                            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
                                Pick a row from the table to edit.
                            </div>
                        )}
                    </div>
                </div>
            )}

            <BulkReviewDialog
                open={reviewOpen}
                rows={reviewRows}
                outputKind={normalizedOutput}
                onOpenChange={setReviewOpen}
                onPatchRow={patchReviewRow}
                onRemoveRow={(index) => setReviewRows((current) => withDuplicateErrors(current.filter((_, itemIndex) => itemIndex !== index), normalizedOutput))}
                onConfirm={confirmBulkImport}
            />
        </div>
    )
}

function BulkReviewDialog({
    open,
    rows,
    outputKind,
    onOpenChange,
    onPatchRow,
    onRemoveRow,
    onConfirm,
}: {
    open: boolean
    rows: ReviewRow[]
    outputKind: OutputKind
    onOpenChange: (open: boolean) => void
    onPatchRow: (index: number, patch: Partial<ProductMasterSize>) => void
    onRemoveRow: (index: number) => void
    onConfirm: () => void
}) {
    const invalidRows = rows.filter((item) => item.errors.length)
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[88vh] max-w-[min(1180px,calc(100vw-2rem))] overflow-hidden p-0">
                <DialogHeader className="border-b border-slate-100 px-5 py-4">
                    <DialogTitle className="flex items-center gap-2 text-lg font-black">
                        <FileSpreadsheet className="h-5 w-5 text-emerald-700" />
                        Review size import
                    </DialogTitle>
                    <DialogDescription>
                        Edit rows here before import. Nothing is saved to the backend until the Product Master is saved.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-3 border-b border-slate-100 bg-slate-50 px-5 py-3 text-xs sm:grid-cols-3">
                    <ReviewStat label="Rows" value={rows.length} tone="slate" />
                    <ReviewStat label="New" value={rows.filter((item) => item.action === "create").length} tone="emerald" />
                    <ReviewStat label="Issues" value={invalidRows.length} tone={invalidRows.length ? "rose" : "emerald"} />
                </div>
                <ScrollArea className="h-[52vh]">
                    <div className="min-w-[1120px] p-4">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-[86px]">Action</TableHead>
                                    <TableHead className="w-[150px]">Code</TableHead>
                                    <TableHead className="w-[190px]">Label</TableHead>
                                    <TableHead className="w-[120px]">{outputKind === "ROLL" ? "Roll width" : "Width"}</TableHead>
                                    {outputKind === "POUCH" ? <TableHead className="w-[120px]">Height</TableHead> : null}
                                    {outputKind === "POUCH" ? <TableHead className="w-[120px]">Gusset</TableHead> : null}
                                    {outputKind === "ROLL" ? <TableHead className="w-[130px]">Roll form</TableHead> : null}
                                    <TableHead className="w-[120px]">Std qty</TableHead>
                                    <TableHead className="w-[110px]">UOM</TableHead>
                                    <TableHead className="w-[150px]">Status</TableHead>
                                    <TableHead className="w-[60px]"></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {rows.map((item, index) => (
                                    <TableRow key={item.id} className={item.errors.length ? "bg-rose-50/40" : ""}>
                                        <TableCell>
                                            <span className={cn(
                                                "rounded-full px-2 py-0.5 text-[10px] font-black uppercase ring-1",
                                                item.action === "update"
                                                    ? "bg-blue-50 text-blue-700 ring-blue-200"
                                                    : "bg-emerald-50 text-emerald-700 ring-emerald-200",
                                            )}>{item.action}</span>
                                        </TableCell>
                                        <TableCell>
                                            <Input className="h-8 font-mono text-xs" value={item.row.code || ""} onChange={(event) => onPatchRow(index, { code: event.target.value.toUpperCase() })} />
                                        </TableCell>
                                        <TableCell>
                                            <Input className="h-8 text-xs" value={item.row.label || ""} onChange={(event) => onPatchRow(index, { label: event.target.value })} />
                                        </TableCell>
                                        <TableCell>
                                            <Input type="number" step="any" className="h-8 text-right font-mono text-xs" value={numericValue(item.row.width_mm)} onChange={(event) => onPatchRow(index, { width_mm: numberOrNull(event.target.value) as any })} />
                                        </TableCell>
                                        {outputKind === "POUCH" ? (
                                            <TableCell>
                                                <Input type="number" step="any" className="h-8 text-right font-mono text-xs" value={numericValue(item.row.height_mm)} onChange={(event) => onPatchRow(index, { height_mm: numberOrNull(event.target.value) as any })} />
                                            </TableCell>
                                        ) : null}
                                        {outputKind === "POUCH" ? (
                                            <TableCell>
                                                <Input type="number" step="any" className="h-8 text-right font-mono text-xs" value={numericValue(item.row.gusset_mm)} onChange={(event) => onPatchRow(index, { gusset_mm: numberOrNull(event.target.value) as any })} />
                                            </TableCell>
                                        ) : null}
                                        {outputKind === "ROLL" ? (
                                            <TableCell>
                                                <Select value={String(item.row.roll_form || "FLAT").toUpperCase()} onValueChange={(value) => onPatchRow(index, { roll_form: value })}>
                                                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="FLAT">FLAT</SelectItem>
                                                        <SelectItem value="FOLDED">FOLDED</SelectItem>
                                                        <SelectItem value="TUBING">TUBING</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </TableCell>
                                        ) : null}
                                        <TableCell>
                                            <Input type="number" step="any" className="h-8 text-right font-mono text-xs" value={numericValue(item.row.standard_qty)} onChange={(event) => onPatchRow(index, { standard_qty: numberOrNull(event.target.value) as any })} />
                                        </TableCell>
                                        <TableCell>
                                            <Select value={String(item.row.qty_uom || "KG").toUpperCase()} onValueChange={(value) => onPatchRow(index, { qty_uom: value as any })}>
                                                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                                <SelectContent>{COMMON_UOMS.map((uom) => <SelectItem key={uom} value={uom}>{uom}</SelectItem>)}</SelectContent>
                                            </Select>
                                        </TableCell>
                                        <TableCell>
                                            {item.errors.length ? (
                                                <div className="flex items-start gap-1.5 text-[10px] font-semibold leading-4 text-rose-700">
                                                    <AlertTriangle className="mt-0.5 h-3 w-3 flex-none" />
                                                    <span>{item.errors.join(", ")}</span>
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-1.5 text-[10px] font-black uppercase text-emerald-700">
                                                    <CheckCircle2 className="h-3 w-3" /> Ready
                                                </div>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <button type="button" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-rose-600 hover:bg-rose-100" onClick={() => onRemoveRow(index)}>
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {rows.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={10} className="py-8 text-center text-sm text-slate-500">
                                            No rows left to import.
                                        </TableCell>
                                    </TableRow>
                                ) : null}
                            </TableBody>
                        </Table>
                    </div>
                </ScrollArea>
                <DialogFooter className="border-t border-slate-100 px-5 py-4">
                    <Button type="button" variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button type="button" className="rounded-xl bg-emerald-700 hover:bg-emerald-800" disabled={!rows.length || invalidRows.length > 0} onClick={onConfirm}>
                        Confirm import
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

function ReviewStat({ label, value, tone }: { label: string; value: number; tone: "slate" | "emerald" | "rose" }) {
    return (
        <div className={cn(
            "rounded-xl px-3 py-2 ring-1",
            tone === "slate" && "bg-white text-slate-800 ring-slate-200",
            tone === "emerald" && "bg-emerald-50 text-emerald-800 ring-emerald-200",
            tone === "rose" && "bg-rose-50 text-rose-800 ring-rose-200",
        )}>
            <div className="text-[10px] font-black uppercase tracking-widest opacity-70">{label}</div>
            <div className="font-mono text-lg font-black">{value}</div>
        </div>
    )
}

function templateHeaders(outputKind: OutputKind) {
    return outputKind === "ROLL" ? ROLL_TEMPLATE_HEADERS : POUCH_TEMPLATE_HEADERS
}

function sampleRow(outputKind: OutputKind, order: number): Record<string, string | number | boolean> {
    if (outputKind === "ROLL") {
        return {
            code: `ROLL-${order}`,
            label: "500mm roll",
            width_mm: 500,
            roll_form: "FLAT",
            trim_loss_mm: 0,
            trim_apply_to: "NONE",
            roll_width_mm: "",
            thickness_micron: "",
            standard_qty: "",
            qty_uom: "KG",
            active: true,
            sort_order: order,
            notes: "",
        }
    }
    return {
        code: `SZ-${order}`,
        label: "250 x 350",
        width_mm: 250,
        height_mm: 350,
        pouch_style_master: "",
        pouch_style: "PILLOW",
        gusset_mm: 0,
        flap_tape_mm: 0,
        trim_loss_mm: 10,
        trim_apply_to: "WIDTH",
        faces: 2,
        roll_width_mm: "",
        child_target_width_mm: "",
        child_target_override: false,
        standard_qty: "",
        qty_uom: "KG",
        active: true,
        sort_order: order,
        notes: "",
    }
}

function rowFromCsv(raw: Record<string, string>, outputKind: OutputKind, productId: string, order: number): ProductMasterSize {
    const base = sampleRow(outputKind, order)
    const value = (key: string) => raw[key] ?? raw[key.toUpperCase()] ?? raw[key.replaceAll("_", " ")] ?? ""
    const defaulted = (key: string, fallback: unknown) => {
        const current = value(key)
        return current === "" || current === null || current === undefined ? fallback : current
    }
    const row: ProductMasterSize = {
        id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        product_master: productId,
        code: String(value("code")).trim().toUpperCase(),
        label: String(value("label")).trim(),
        width_mm: numberOrZero(value("width_mm")),
        height_mm: outputKind === "ROLL" ? 0 : numberOrZero(value("height_mm")),
        gusset_mm: outputKind === "ROLL" ? 0 : numberOrZero(defaulted("gusset_mm", base.gusset_mm)),
        roll_width_mm: numberOrNull(value("roll_width_mm")) as any,
        thickness_micron: numberOrNull(value("thickness_micron")) as any,
        standard_qty: numberOrNull(value("standard_qty")) as any,
        qty_uom: String(defaulted("qty_uom", base.qty_uom || "KG")).trim().toUpperCase() as any,
        pouch_style: outputKind === "ROLL" ? "" : String(defaulted("pouch_style", base.pouch_style || "PILLOW")).trim().toUpperCase(),
        pouch_style_master: outputKind === "ROLL" ? null : String(value("pouch_style_master") || "").trim() || null,
        pouch_style_version: outputKind === "ROLL" ? 0 : 1,
        roll_form: outputKind === "ROLL" ? String(defaulted("roll_form", base.roll_form || "FLAT")).trim().toUpperCase() : "",
        faces: outputKind === "ROLL" ? 1 : numberOrZero(defaulted("faces", base.faces || 2)),
        trim_loss_mm: numberOrZero(defaulted("trim_loss_mm", base.trim_loss_mm)),
        trim_apply_to: normalizeImpact(defaulted("trim_apply_to", base.trim_apply_to)),
        flap_tape_mm: outputKind === "ROLL" ? 0 : numberOrZero(defaulted("flap_tape_mm", base.flap_tape_mm)),
        gusset_apply_to: outputKind === "ROLL" ? "NONE" : normalizeImpact(defaulted("gusset_apply_to", "HEIGHT")),
        gusset_factor: outputKind === "ROLL" ? 0 : numberOrZero(defaulted("gusset_factor", 1)),
        child_target_width_mm: outputKind === "ROLL" ? null : numberOrNull(value("child_target_width_mm")) as any,
        child_target_override: outputKind === "ROLL" ? false : boolValue(value("child_target_override")),
        adjustments: [],
        multipliers: { faces: outputKind === "ROLL" ? 1 : numberOrZero(defaulted("faces", base.faces || 2)) },
        geometry_config: outputKind === "ROLL"
            ? {
                  roll_form: String(defaulted("roll_form", base.roll_form || "FLAT")).trim().toUpperCase(),
                  trim_loss_mm: numberOrZero(defaulted("trim_loss_mm", base.trim_loss_mm)),
                  trim_apply_to: normalizeImpact(defaulted("trim_apply_to", base.trim_apply_to)),
                  adjustments: [],
                  multipliers: { faces: 1 },
              }
            : {
                  pouch_style: String(defaulted("pouch_style", base.pouch_style || "PILLOW")).trim().toUpperCase(),
                  trim_loss_mm: numberOrZero(defaulted("trim_loss_mm", base.trim_loss_mm)),
                  trim_apply_to: normalizeImpact(defaulted("trim_apply_to", base.trim_apply_to)),
                  flap_tape_mm: numberOrZero(defaulted("flap_tape_mm", base.flap_tape_mm)),
                  gusset_apply_to: normalizeImpact(defaulted("gusset_apply_to", "HEIGHT")),
                  gusset_factor: numberOrZero(defaulted("gusset_factor", 1)),
                  adjustments: [],
                  multipliers: { faces: numberOrZero(defaulted("faces", base.faces || 2)) },
              },
        notes: String(value("notes") || "").trim(),
        active: value("active") === "" ? true : boolValue(value("active")),
        sort_order: numberOrZero(defaulted("sort_order", order)),
    }
    return row
}

function validateRow(row: ProductMasterSize, outputKind: OutputKind): string[] {
    const errors: string[] = []
    if (!String(row.code || "").trim()) errors.push("code required")
    if (!String(row.label || "").trim()) errors.push("label required")
    if (Number(row.width_mm || 0) <= 0) errors.push(outputKind === "ROLL" ? "roll width required" : "width required")
    if (outputKind === "POUCH" && Number(row.height_mm || 0) <= 0) errors.push("height required")
    if (!COMMON_UOMS.includes(String(row.qty_uom || "KG").toUpperCase() as any)) errors.push("bad uom")
    if (outputKind === "ROLL" && !["FLAT", "FOLDED", "TUBING"].includes(String(row.roll_form || "").toUpperCase())) errors.push("bad roll form")
    return errors
}

function withDuplicateErrors(rows: ReviewRow[], outputKind: OutputKind) {
    const counts = new Map<string, number>()
    for (const item of rows) {
        const key = String(item.row.code || "").trim().toUpperCase()
        if (!key) continue
        counts.set(key, (counts.get(key) || 0) + 1)
    }
    return rows.map((item) => {
        const base = validateRow(item.row, outputKind)
        const key = String(item.row.code || "").trim().toUpperCase()
        if (key && (counts.get(key) || 0) > 1) base.push("duplicate code in upload")
        return { ...item, errors: base }
    })
}

function mergeRows(existing: ProductMasterSize[], incoming: ProductMasterSize[]) {
    const next = [...existing]
    for (const row of incoming) {
        const index = next.findIndex((existingRow) => sameCode(existingRow.code, row.code))
        if (index >= 0) {
            next[index] = { ...next[index], ...row, id: next[index].id, product_master: next[index].product_master }
        } else {
            next.push(row)
        }
    }
    return next.map((row, index) => ({ ...row, sort_order: row.sort_order || index + 1 }))
}

function parseCsv(text: string): Record<string, string>[] {
    const rows: string[][] = []
    let field = ""
    let row: string[] = []
    let quoted = false
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index]
        const next = text[index + 1]
        if (quoted) {
            if (char === '"' && next === '"') {
                field += '"'
                index += 1
            } else if (char === '"') {
                quoted = false
            } else {
                field += char
            }
            continue
        }
        if (char === '"') {
            quoted = true
            continue
        }
        if (char === ",") {
            row.push(field.trim())
            field = ""
            continue
        }
        if (char === "\n") {
            row.push(field.trim())
            rows.push(row)
            row = []
            field = ""
            continue
        }
        if (char !== "\r") field += char
    }
    if (field || row.length) {
        row.push(field.trim())
        rows.push(row)
    }
    const [headersRaw, ...dataRows] = rows.filter((cells) => cells.some((cell) => cell !== ""))
    if (!headersRaw) return []
    const headers = headersRaw.map((header) => header.trim())
    return dataRows
        .filter((cells) => cells.some((cell) => cell !== ""))
        .map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])))
}

function toCsv(rows: Array<Array<string | number | boolean>>) {
    return rows
        .map((row) => row.map((cell) => {
            const value = String(cell ?? "")
            return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
        }).join(","))
        .join("\n")
}

function sameCode(a: unknown, b: unknown) {
    return String(a || "").trim().toUpperCase() === String(b || "").trim().toUpperCase()
}

function numberOrZero(value: unknown) {
    const number = Number(value)
    return Number.isFinite(number) ? number : 0
}

function numberOrNull(value: unknown) {
    if (value === "" || value === null || value === undefined) return null
    const number = Number(value)
    return Number.isFinite(number) ? number : null
}

function numericValue(value: unknown) {
    if (value === "" || value === null || value === undefined) return ""
    const number = Number(value)
    return Number.isFinite(number) ? String(number) : ""
}

function boolValue(value: unknown) {
    const text = String(value || "").trim().toLowerCase()
    if (!text) return false
    return ["1", "true", "yes", "y", "active"].includes(text)
}

function normalizeImpact(value: unknown) {
    const text = String(value || "WIDTH").trim().toUpperCase()
    return ["WIDTH", "HEIGHT", "BOTH", "NONE"].includes(text) ? text as any : "WIDTH"
}

function sizeCopy(row: ProductMasterSize, outputKind: OutputKind) {
    if (outputKind === "ROLL") return `${Number(row.width_mm || 0).toLocaleString()} mm`
    return `${Number(row.width_mm || 0).toLocaleString()} x ${Number(row.height_mm || 0).toLocaleString()}`
}

function summaryCopy(row: ProductMasterSize, outputKind: OutputKind) {
    if (outputKind === "ROLL") return `${String(row.roll_form || "FLAT").replaceAll("_", " ")} roll`
    const style = row.pouch_style_master ? "style master" : String(row.pouch_style || "manual").replaceAll("_", " ")
    return `${style}${Number(row.gusset_mm || 0) > 0 ? ` - G ${row.gusset_mm}` : ""}`
}

function webWidthCopy(row: ProductMasterSize, outputKind: OutputKind, geometry: ReturnType<typeof computeProductGeometry>) {
    if (outputKind === "ROLL") return `${Number(row.width_mm || 0).toLocaleString()} mm`
    const child = Number(row.child_target_width_mm || 0)
    const width = child > 0 ? child : geometry.fallbackRollWidthMm
    return width > 0 ? `${Number(width.toFixed(2)).toLocaleString()} mm` : "-"
}
