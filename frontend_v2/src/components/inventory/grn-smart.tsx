"use client"

/**
 * V3.6 Smart GRN — single-page unified receipt form.
 *
 * Replaces /inventory/grn (which was 3 separate sub-tabs for bulk / roll / packaging).
 * One form, all fields preserved, adapts visibility based on selected class.
 *
 * Class picker → Source → Items → Quality → Financials → Notes → Submit.
 *
 * Backend wiring: posts to the unified V3.6 GRN endpoint and keeps the class-specific
 * controls in one fast form.
 */

import * as React from "react"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
    AlertTriangle,
    ArrowRight,
    Boxes,
    ChevronDown,
    CheckCircle2,
    Download,
    Layers,
    Loader2,
    Package,
    Plus,
    Save,
    Upload,
    X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { describeApiError } from "@/lib/api"
import { cn } from "@/lib/utils"
import { inventoryService, type Vendor, type Location } from "@/services/inventory"
import { masterDataService, type GranuleQualityCode } from "@/services/master-data"
import { procurementService, type POItem, type PurchaseOrderListItem } from "@/services/procurement"
import { recipeService, type RecipeGrade } from "@/services/recipes"
import { tradingGoodService, tradingGoodReceiptService, type TradingGood } from "@/services/trading-goods"
import { MaterialPicker } from "@/components/inventory/material-picker"

type ClassKind = "BULK" | "ROLL" | "PACKAGING" | "TRADING"
type BulkMaterialFilter = "ALL" | "GRANULE" | "INK" | "ADHESIVE" | "SOLVENT" | "ADDON" | "POD"

interface ItemDraft {
    id: string
    po_item_id?: string
    material_code: string
    grade: string
    granule_code_id: string
    qty: string
    uom: string
    vendor_lot_ref: string
    unit_cost: string
    best_before: string
    location: string
    // roll-only
    net_weight_kg?: string
    gross_weight_kg?: string
    tare_weight_kg?: string
    length_m?: string
    width_mm?: string
    thickness_um?: string
    core_size_inch?: string
}
interface PostedReceipt {
    grn_no: string
    klass: ClassKind
    total_qty: number
    uom: string
    movement_count: number
}

interface RollReviewRow {
    excel_row?: number | string
    supplier_roll_no?: string
    label_id?: string
    material_code?: string
    material_name?: string
    batch_no?: string
    gross_weight_kg?: string | number
    tare_weight_kg?: string | number
    net_weight_kg?: string | number
    width_mm?: string | number
    thickness_micron?: string | number
    length_m?: string | number
    grade_id?: string
    grade?: string
    unit_cost?: string | number
    mfg_date?: string
    best_before?: string
    qc_status?: string
    location_id?: string
    location_code?: string
    location_name?: string
    plant_code?: string
    remarks?: string
}

const FRESH_ITEM = (): ItemDraft => ({
    id: `it-${Math.random().toString(36).slice(2, 8)}`,
    material_code: "",
    grade: "",
    granule_code_id: "",
    qty: "",
    uom: "KG",
    vendor_lot_ref: "",
    unit_cost: "",
    best_before: "",
    location: "",
})

function locationLabel(location: Location) {
    return [location.plant_name, location.code, location.name].filter(Boolean).join(" · ")
}

const BULK_FILTERS: Array<{ id: BulkMaterialFilter; label: string }> = [
    { id: "ALL", label: "All bulk" },
    { id: "GRANULE", label: "Granules" },
    { id: "INK", label: "Inks" },
    { id: "ADHESIVE", label: "Adhesives" },
    { id: "SOLVENT", label: "Solvents" },
    { id: "ADDON", label: "Purchased add-ons" },
    { id: "POD", label: "POD" },
]

function materialCategory(material: any) {
    return String(material?.category || "").trim().toUpperCase()
}

function materialBaseUom(material: any, klass: ClassKind) {
    const category = materialCategory(material)
    if (category === "ADDON") return String(material?.addon_purchase_uom || material?.base_uom || "KG").toUpperCase()
    if (category === "PACKAGING") return String(material?.base_uom || "PCS").toUpperCase()
    return String(material?.base_uom || (klass === "PACKAGING" ? "PCS" : "KG")).toUpperCase()
}

function isActiveMaterial(material: any) {
    return String(material?.code || "").trim() && (!material?.status || String(material.status).toUpperCase() === "ACTIVE")
}

function isPurchasedAddon(material: any) {
    if (materialCategory(material) !== "ADDON") return true
    if (Object.prototype.hasOwnProperty.call(material || {}, "addon_is_purchased")) {
        return material?.addon_is_purchased === true
    }
    return ["KG", "PCS", "METER"].includes(String(material?.addon_purchase_uom || material?.base_uom || "").toUpperCase())
}

function materialMatchesReceiptClass(material: any, klass: ClassKind) {
    const category = materialCategory(material)
    if (!isActiveMaterial(material)) return false
    if (klass === "ROLL") return category === "FILM_VARIANT"
    if (klass === "PACKAGING") return category === "PACKAGING"
    return ["GRANULE", "INK", "ADHESIVE", "SOLVENT", "POD", "ADDON"].includes(category) && isPurchasedAddon(material)
}

function poItemMatchesReceiptClass(item: POItem, klass: ClassKind) {
    const category = String(item.material_category || "").toUpperCase()
    if (klass === "ROLL") return ["FILM_VARIANT", "POD"].includes(category)
    if (klass === "PACKAGING") return category === "PACKAGING"
    if (klass === "TRADING") return false
    return ["GRANULE", "INK", "ADHESIVE", "SOLVENT", "ADDON", "FILM_FAMILY"].includes(category)
}

function poItemToDraft(item: POItem, locationId: string): ItemDraft {
    const openQty = Number(item.qty_open ?? 0)
    const qty = openQty > 0 ? openQty : Math.max(0, Number(item.qty_ordered || 0) - Number(item.qty_received || 0))
    return {
        ...FRESH_ITEM(),
        id: `po-${item.id || Math.random().toString(36).slice(2, 8)}`,
        po_item_id: item.id,
        material_code: item.material_code || "",
        qty: qty ? String(qty) : "",
        uom: String(item.uom || "KG").toUpperCase(),
        unit_cost: item.rate_per_uom != null ? String(item.rate_per_uom) : "",
        location: locationId,
        width_mm: item.expected_width_mm != null ? String(item.expected_width_mm) : "",
        thickness_um: item.expected_thickness_micron != null ? String(item.expected_thickness_micron) : "",
        net_weight_kg: String(item.uom || "").toUpperCase() === "KG" && qty ? String(qty) : "",
    }
}

function receiptTotalQty(receipt: any, fallback: number) {
    if (receipt?.totals?.qty != null) return Number(receipt.totals.qty) || 0
    if (Array.isArray(receipt?.lines)) return receipt.lines.reduce((sum: number, line: any) => sum + (Number(line.qty_received) || 0), 0)
    return fallback
}

export function GrnSmartV36() {
    const { toast } = useToast()
    const queryClient = useQueryClient()
    const rollUploadInputRef = React.useRef<HTMLInputElement | null>(null)

    const [klass, setKlass] = React.useState<ClassKind>("BULK")
    const [sourceType, setSourceType] = React.useState<"PO" | "DIRECT" | "INTERPLANT" | "JOBWORK" | "MANUAL_PO">("PO")
    const [poId, setPoId] = React.useState("")
    const [manualPoRef, setManualPoRef] = React.useState("")
    const [vendorId, setVendorId] = React.useState("")
    const [vendorInvoiceNo, setVendorInvoiceNo] = React.useState("")
    const [vendorInvoiceDate, setVendorInvoiceDate] = React.useState("")
    const [lrVehicle, setLrVehicle] = React.useState("")
    const [warehouseId, setWarehouseId] = React.useState("")
    const [receiptDate, setReceiptDate] = React.useState(new Date().toISOString().slice(0, 10))
    const [items, setItems] = React.useState<ItemDraft[]>([FRESH_ITEM()])
    const [bulkMaterialFilter, setBulkMaterialFilter] = React.useState<BulkMaterialFilter>("ALL")
    const [coaAttached, setCoaAttached] = React.useState(true)
    const [showQualityDetails, setShowQualityDetails] = React.useState(false)
    const [qcRequired, setQcRequired] = React.useState(false)
    const [density, setDensity] = React.useState("")
    const [mfi, setMfi] = React.useState("")
    const [moisture, setMoisture] = React.useState("")
    const [qcInspector, setQcInspector] = React.useState("")
    const [freight, setFreight] = React.useState("0")
    const [otherCharges, setOtherCharges] = React.useState("0")
    const [gstPct, setGstPct] = React.useState("18")
    const [remarks, setRemarks] = React.useState("")
    const [lastPosted, setLastPosted] = React.useState<PostedReceipt | null>(null)
    const [rollUploadPreview, setRollUploadPreview] = React.useState<{ rows: number; qty: number; value: number; vendorName?: string; vendorCode?: string; invoiceNo?: string; invoiceDate?: string } | null>(null)
    const [rollReviewRows, setRollReviewRows] = React.useState<RollReviewRow[]>([])

    const vendorsQ = useQuery({ queryKey: ["vendors"], queryFn: () => inventoryService.getVendors(), staleTime: 60_000 })
    const locationsQ = useQuery({ queryKey: ["locations"], queryFn: () => inventoryService.getLocations(), staleTime: 60_000 })
    const materialsQ = useQuery({ queryKey: ["material-library"], queryFn: () => masterDataService.getLibrary(), staleTime: 60_000 })
    const gradesQ = useQuery({ queryKey: ["recipe-grades"], queryFn: () => recipeService.getGrades(), staleTime: 60_000 })
    const granuleCodesQ = useQuery({ queryKey: ["granule-codes", "active"], queryFn: () => masterDataService.getGranuleCodes({ status: "ACTIVE" }), staleTime: 60_000 })
    const openPurchaseOrdersQ = useQuery({
        queryKey: ["procurement-open-pos-for-grn"],
        queryFn: () => procurementService.listOpenForReceipt(),
        enabled: sourceType === "PO" && klass !== "TRADING",
        staleTime: 30_000,
    })
    const selectedPoQ = useQuery({
        queryKey: ["procurement-po-for-grn", poId],
        queryFn: () => procurementService.get(poId),
        enabled: sourceType === "PO" && Boolean(poId),
        staleTime: 15_000,
    })
    const vendors = vendorsQ.data || []
    const locations = locationsQ.data || []
    const materials = materialsQ.data || []
    const openPurchaseOrders = openPurchaseOrdersQ.data || []
    const selectedPo = selectedPoQ.data || null

    const lineQty = React.useCallback((line: Pick<ItemDraft, "qty" | "net_weight_kg">) => Number(klass === "ROLL" ? (line.net_weight_kg || line.qty) : line.qty) || 0, [klass])
    const subtotal = items.reduce((s, i) => s + lineQty(i) * (Number(i.unit_cost) || 0), 0)
    const gst = subtotal * (Number(gstPct) / 100)
    const grandTotal = subtotal + gst + (Number(freight) || 0) + (Number(otherCharges) || 0)

    const totalQty = items.reduce((s, i) => s + lineQty(i), 0)

    const queryError = vendorsQ.error || locationsQ.error || materialsQ.error || gradesQ.error || granuleCodesQ.error || openPurchaseOrdersQ.error || selectedPoQ.error
    const valid = !!warehouseId && !!vendorId && items.every((i) => i.material_code && lineQty(i) > 0) && (sourceType !== "PO" || (!!poId && items.every((i) => i.po_item_id)))

    React.useEffect(() => {
        if (sourceType !== "PO" || !selectedPo) return
        setVendorId(selectedPo.vendor || "")
        const samePlantLocation = locations.find((loc: any) => String(loc.plant) === String(selectedPo.plant))
        if (!warehouseId && samePlantLocation?.id) setWarehouseId(samePlantLocation.id)
        const lineLocation = warehouseId || samePlantLocation?.id || ""
        const poLines = (selectedPo.items || []).filter((line) => Number(line.qty_open || 0) > 0 && poItemMatchesReceiptClass(line, klass))
        setItems(poLines.length ? poLines.map((line) => poItemToDraft(line, lineLocation)) : [FRESH_ITEM()])
    }, [klass, locations, selectedPo, sourceType, warehouseId])

    const handleClassChange = React.useCallback((next: ClassKind) => {
        setKlass(next)
        setItems([FRESH_ITEM()])
        if (next !== "BULK") setBulkMaterialFilter("ALL")
        setLastPosted(null)
    }, [])

    const handleSourceTypeChange = React.useCallback((next: "PO" | "DIRECT" | "INTERPLANT" | "JOBWORK" | "MANUAL_PO") => {
        setSourceType(next)
        setLastPosted(null)
        if (next !== "PO") setPoId("")
        if (next !== "MANUAL_PO") setManualPoRef("")
        if (next !== "PO") setItems([FRESH_ITEM()])
    }, [])

    const resetDraftAfterPost = React.useCallback(() => {
        setSourceType("PO")
        setPoId("")
        setManualPoRef("")
        setVendorId("")
        setVendorInvoiceNo("")
        setVendorInvoiceDate("")
        setLrVehicle("")
        setWarehouseId("")
        setReceiptDate(new Date().toISOString().slice(0, 10))
        setItems([FRESH_ITEM()])
        setCoaAttached(true)
        setShowQualityDetails(false)
        setQcRequired(false)
        setDensity("")
        setMfi("")
        setMoisture("")
        setQcInspector("")
        setFreight("0")
        setOtherCharges("0")
        setGstPct("18")
        setRemarks("")
    }, [])

    const submitMutation = useMutation({
        mutationFn: async () => {
            if (sourceType === "PO") {
                if (!poId) throw new Error("Pick a system purchase order.")
                const poLines = items
                    .filter((line) => line.po_item_id && lineQty(line) > 0)
                    .map((line) => ({
                        po_item_id: line.po_item_id as string,
                        qty_received: lineQty(line),
                        rate: Number(line.unit_cost) || undefined,
                        notes: line.vendor_lot_ref || "",
                        width_mm: line.width_mm ? Number(line.width_mm) : undefined,
                        thickness_micron: line.thickness_um ? Number(line.thickness_um) : undefined,
                    }))
                if (!poLines.length) throw new Error("Selected PO has no receivable lines for this stock class.")
                return procurementService.createReceipt({
                    purchase_order: poId,
                    location_id: warehouseId,
                    vendor_invoice_no: vendorInvoiceNo,
                    vendor_invoice_date: vendorInvoiceDate || null,
                    vehicle_no: lrVehicle,
                    lr_no: lrVehicle,
                    notes: remarks,
                    quality_status: "PENDING",
                    lines: poLines,
                })
            }
            const basePayload: any = {
                klass,
                source_type: sourceType,
                source_ref: sourceType === "MANUAL_PO" ? manualPoRef : "",
                manual_po_ref: sourceType === "MANUAL_PO" ? manualPoRef : "",
                vendor_id: vendorId,
                vendor_invoice_no: vendorInvoiceNo,
                vendor_invoice_date: vendorInvoiceDate,
                reference_po_id: undefined,
                lr_vehicle: lrVehicle,
                transport: { vehicle_no: lrVehicle },
                warehouse_id: warehouseId,
                store_location_id: warehouseId,
                receipt_date: receiptDate,
                coa_attached: coaAttached,
                qc_required: qcRequired,
                qc_density: density,
                qc_mfi: mfi,
                qc_moisture: moisture,
                qc_inspector: qcInspector,
                freight: Number(freight) || 0,
                other_charges: Number(otherCharges) || 0,
                gst_percent: Number(gstPct) || 0,
                remarks,
                lines: items.map(({ id, ...rest }) => ({
                    material_code: rest.material_code,
                    grade_id: klass === "ROLL" ? rest.grade || undefined : undefined,
                    granule_code_id: klass === "BULK" ? rest.granule_code_id || undefined : undefined,
                    location_id: rest.location || warehouseId,
                    qty: lineQty(rest),
                    uom: rest.uom,
                    rate_per_uom: Number(rest.unit_cost) || 0,
                    rate_per_kg: Number(rest.unit_cost) || 0,
                    vendor_lot_ref: rest.vendor_lot_ref,
                    expiry_date: rest.best_before || undefined,
                    net_weight_kg: klass === "ROLL" ? lineQty(rest) || undefined : undefined,
                    gross_weight_kg: rest.gross_weight_kg ? Number(rest.gross_weight_kg) : undefined,
                    tare_weight_kg: rest.tare_weight_kg ? Number(rest.tare_weight_kg) : undefined,
                    length_m: rest.length_m ? Number(rest.length_m) : undefined,
                    width_mm: rest.width_mm ? Number(rest.width_mm) : undefined,
                    thickness_um: rest.thickness_um ? Number(rest.thickness_um) : undefined,
                    core_size_inch: rest.core_size_inch ? Number(rest.core_size_inch) : undefined,
                })),
            }
            return inventoryService.createUnifiedGRN(basePayload)
        },
        onSuccess: (receipt: any) => {
            const posted: PostedReceipt = {
                grn_no: String(receipt?.grn_no || receipt?.code || "GRN posted"),
                klass,
                total_qty: receiptTotalQty(receipt, totalQty),
                uom: items[0]?.uom || "units",
                movement_count: Array.isArray(receipt?.stock_movements) ? receipt.stock_movements.length : Array.isArray(receipt?.lines) ? receipt.lines.length : items.length,
            }
            queryClient.invalidateQueries({ queryKey: ["inventory-snapshot"] })
            queryClient.invalidateQueries({ queryKey: ["inventory-bulk"] })
            queryClient.invalidateQueries({ queryKey: ["inventory-rolls"] })
            queryClient.invalidateQueries({ queryKey: ["inventory-packaging"] })
            queryClient.invalidateQueries({ queryKey: ["grn-history"] })
            queryClient.invalidateQueries({ queryKey: ["procurement-open-pos-for-grn"] })
            queryClient.invalidateQueries({ queryKey: ["procurement-po-for-grn"] })
            queryClient.invalidateQueries({ queryKey: ["purchase-orders"] })
            setLastPosted(posted)
            resetDraftAfterPost()
            toast({ title: "GRN posted", description: `${posted.grn_no} · ${posted.total_qty} ${posted.uom} added to ledger` })
        },
        onError: (err: any) => toast({ title: "Could not post GRN", description: describeApiError(err, "Try again"), variant: "destructive" }),
    })

    const uploadRollsMutation = useMutation({
        mutationFn: ({ file, dryRun }: { file: File; dryRun: boolean }) => inventoryService.uploadRollGrnExcel(file, {
            vendor_id: vendorId || undefined,
            warehouse_id: warehouseId || undefined,
            vendor_invoice_no: vendorInvoiceNo || undefined,
            vendor_invoice_date: vendorInvoiceDate || undefined,
            dry_run: dryRun,
        }),
        onSuccess: (receipt: any) => {
            if (receipt?.dry_run) {
                setRollUploadPreview({
                    rows: Number(receipt?.rows || 0) || 0,
                    qty: Number(receipt?.totals?.qty || 0) || 0,
                    value: Number(receipt?.totals?.value || 0) || 0,
                    vendorName: receipt?.vendor?.name,
                    vendorCode: receipt?.vendor?.code,
                    invoiceNo: receipt?.vendor_invoice_no,
                    invoiceDate: receipt?.vendor_invoice_date,
                })
                setRollReviewRows(Array.isArray(receipt?.review_rows) ? receipt.review_rows : [])
                toast({
                    title: "Excel validated",
                    description: `${Number(receipt?.rows || 0)} rolls · ${Number(receipt?.totals?.qty || 0).toLocaleString()} KG ready for review`,
                })
                return
            }
            const posted: PostedReceipt = {
                grn_no: String(receipt?.grn_no || "GRN posted"),
                klass: "ROLL",
                total_qty: Number(receipt?.totals?.qty ?? 0) || 0,
                uom: "KG",
                movement_count: Number(receipt?.rows || (Array.isArray(receipt?.stock_movements) ? receipt.stock_movements.length : 0)) || 0,
            }
            queryClient.invalidateQueries({ queryKey: ["inventory-snapshot"] })
            queryClient.invalidateQueries({ queryKey: ["inventory-rolls"] })
            queryClient.invalidateQueries({ queryKey: ["grn-history"] })
            setKlass("ROLL")
            setLastPosted(posted)
            setRollUploadPreview(null)
            setRollReviewRows([])
            toast({ title: "Roll GRN uploaded", description: `${posted.grn_no} · ${posted.movement_count} rolls · ${posted.total_qty.toLocaleString()} KG` })
        },
        onError: (err: any) => {
            const details = err?.response?.data?.errors
            const first = Array.isArray(details) && details.length ? `Row ${details[0]?.row || "?"}: ${details[0]?.error || ""}` : ""
            toast({
                title: "Excel upload failed",
                description: first || describeApiError(err, "Fix the sheet and upload again"),
                variant: "destructive",
            })
        },
        onSettled: () => {
            if (rollUploadInputRef.current) rollUploadInputRef.current.value = ""
        },
    })

    const downloadRollTemplateMutation = useMutation({
        mutationFn: () => inventoryService.downloadRollGrnTemplate(),
        onSuccess: (blob) => {
            const url = window.URL.createObjectURL(blob)
            const link = document.createElement("a")
            link.href = url
            link.download = "grn_live_roll_upload_template.xlsx"
            document.body.appendChild(link)
            link.click()
            link.remove()
            window.URL.revokeObjectURL(url)
            toast({ title: "Template downloaded", description: "Dropdowns came from the current master database." })
        },
        onError: (err: any) => toast({
            title: "Could not download template",
            description: describeApiError(err, "Try again"),
            variant: "destructive",
        }),
    })

    const postRollReviewMutation = useMutation({
        mutationFn: () => inventoryService.postRollGrnReview({
            vendor_id: vendorId || undefined,
            vendor: rollUploadPreview?.vendorCode || undefined,
            warehouse_id: warehouseId || undefined,
            vendor_invoice_no: vendorInvoiceNo || rollUploadPreview?.invoiceNo || undefined,
            vendor_invoice_date: vendorInvoiceDate || rollUploadPreview?.invoiceDate || undefined,
            review_rows: rollReviewRows,
        }),
        onSuccess: (receipt: any) => {
            const posted: PostedReceipt = {
                grn_no: String(receipt?.grn_no || "GRN posted"),
                klass: "ROLL",
                total_qty: Number(receipt?.totals?.qty ?? 0) || 0,
                uom: "KG",
                movement_count: Number(receipt?.rows || (Array.isArray(receipt?.stock_movements) ? receipt.stock_movements.length : 0)) || 0,
            }
            queryClient.invalidateQueries({ queryKey: ["inventory-snapshot"] })
            queryClient.invalidateQueries({ queryKey: ["inventory-rolls"] })
            queryClient.invalidateQueries({ queryKey: ["grn-history"] })
            setKlass("ROLL")
            setLastPosted(posted)
            setRollUploadPreview(null)
            setRollReviewRows([])
            toast({ title: "Roll GRN posted", description: `${posted.grn_no} · ${posted.movement_count} rolls · ${posted.total_qty.toLocaleString()} KG` })
        },
        onError: (err: any) => {
            const details = err?.response?.data?.errors
            const first = Array.isArray(details) && details.length ? `Row ${details[0]?.row || "?"}: ${details[0]?.error || ""}` : ""
            toast({
                title: "Review posting failed",
                description: first || describeApiError(err, "Fix the review rows and post again"),
                variant: "destructive",
            })
        },
    })

    const updateRollReviewRow = React.useCallback((index: number, patch: Partial<RollReviewRow>) => {
        setRollReviewRows((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row))
    }, [])

    const removeRollReviewRow = React.useCallback((index: number) => {
        setRollReviewRows((rows) => rows.filter((_, rowIndex) => rowIndex !== index))
    }, [])

    const validateRollUploadFile = React.useCallback((file: File) => {
        setRollUploadPreview(null)
        setRollReviewRows([])
        uploadRollsMutation.mutate({ file, dryRun: true })
    }, [uploadRollsMutation])

    return (
        <div data-testid="smart-grn" className="space-y-5 pb-24">
            {/* Header */}
            <div className="flex items-center justify-between">
                <Link href="/inventory" className="inline-flex items-center gap-1 text-xs font-bold text-slate-600 hover:text-blue-700">← Stock workspace</Link>
                <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-emerald-700 ring-1 ring-emerald-200">UNIFIED FORM</span>
            </div>
            {queryError && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800">
                    <div className="font-bold">Master data did not load.</div>
                    <div className="mt-0.5">{describeApiError(queryError, "Check backend and retry.")}</div>
                </div>
            )}
            {lastPosted && (
                <div
                    data-testid="smart-grn-confirmation"
                    className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 shadow-sm ring-1 ring-emerald-100"
                >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-start gap-2">
                            <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-emerald-600" />
                            <div>
                                <div className="font-bold">Posted {lastPosted.grn_no}</div>
                                <div className="mt-0.5 text-xs text-emerald-800">
                                    {lastPosted.klass} inward saved · {lastPosted.total_qty.toLocaleString()} {lastPosted.uom} · {lastPosted.movement_count} stock movement{lastPosted.movement_count === 1 ? "" : "s"}. The form below is reset for the next receipt.
                                </div>
                            </div>
                        </div>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setLastPosted(null)}
                            className="h-8 rounded-lg border-emerald-200 bg-white text-xs font-bold text-emerald-700 hover:bg-emerald-100"
                        >
                            Clear
                        </Button>
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-3">
                        <div className="rounded-lg border border-emerald-200 bg-white px-2 py-1.5">
                            <div className="font-black uppercase tracking-wider text-emerald-600">PO linkage</div>
                            <div className="font-mono text-slate-800">
                                {sourceType === "PO" ? `System PO: ${poId || "—"}` : sourceType === "MANUAL_PO" ? `Manual ref: ${manualPoRef || "—"}` : "Direct receipt"}
                            </div>
                        </div>
                        <div className="rounded-lg border border-emerald-200 bg-white px-2 py-1.5">
                            <div className="font-black uppercase tracking-wider text-emerald-600">Goods received</div>
                            <div className="font-mono text-slate-800">{lastPosted.total_qty.toLocaleString()} {lastPosted.uom}</div>
                        </div>
                        <div className="rounded-lg border border-emerald-200 bg-white px-2 py-1.5">
                            <div className="font-black uppercase tracking-wider text-emerald-600">Invoice (dedup OK)</div>
                            <div className="font-mono text-slate-800">{vendorInvoiceNo || "—"} {vendorInvoiceDate ? `· ${vendorInvoiceDate}` : ""}</div>
                        </div>
                    </div>
                    <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-white">
                        {sourceType === "PO" ? "FULLY MATCHED" : sourceType === "MANUAL_PO" ? "MANUAL PO MATCH" : "NO PO"}
                    </div>
                </div>
            )}

            {/* Hero */}
            <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-600 via-teal-600 to-cyan-600 p-6 text-white shadow-2xl shadow-emerald-500/20">
                <div className="text-[10px] font-black uppercase tracking-[0.28em] text-white/70">GRN · goods receipt note</div>
                <h2 className="font-display mt-1 text-3xl font-bold leading-tight">One form. Smart per class.</h2>
                <p className="mt-1 text-sm text-white/80 max-w-2xl">Pick class → fill source → add items → QC → financials → submit. All fields preserved, just unified.</p>
            </section>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
                <main className="space-y-5">
                    {/* 1 — Class picker */}
                    <Section idx={1} eyebrow="What are you receiving?" title="Pick the stock class" tone="emerald">
                        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                            <ClassTile id="BULK" icon={<Boxes className="h-5 w-5" />} label="Bulk material" desc="Granules · masterbatch · adhesive · ink · solvent" active={klass === "BULK"} onClick={() => handleClassChange("BULK")} />
                            <ClassTile id="ROLL" icon={<Layers className="h-5 w-5" />} label="Film roll" desc="Pre-printed · laminated · slit · sheet" active={klass === "ROLL"} onClick={() => handleClassChange("ROLL")} />
                            <ClassTile id="PACKAGING" icon={<Package className="h-5 w-5" />} label="Packaging" desc="Inner pouches · gunny · carton · tape · POD" active={klass === "PACKAGING"} onClick={() => handleClassChange("PACKAGING")} />
                            <ClassTile id="TRADING" icon={<Package className="h-5 w-5" />} label="Trading goods" desc="Ready pouches · resold rolls · outsourced items" active={klass === "TRADING"} onClick={() => handleClassChange("TRADING")} />
                        </div>
                    </Section>

                    {/* 2 — Source */}
                    <Section idx={2} eyebrow="Source" title="Where is this coming from?" tone="blue">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <Field label="Source type">
                                <div className="flex flex-wrap gap-2">
                                    {(["PO", "MANUAL_PO", "DIRECT", "JOBWORK"] as const).map((t) => (
                                        <Toggle key={t} active={sourceType === t} onClick={() => handleSourceTypeChange(t)}>
                                            {t === "PO" ? "Against system PO" : t === "MANUAL_PO" ? "Manual vendor PO ref" : t === "DIRECT" ? "Direct receipt" : "Job work return"}
                                        </Toggle>
                                    ))}
                                </div>
                                <Link href="/inventory/inter-plant" className="mt-2 inline-flex text-[11px] font-bold text-blue-700 hover:text-blue-900">
                                    Inter-plant receipts are handled in Inter-Plant Flows.
                                </Link>
                            </Field>
                            <Field label="Receipt date" required>
                                <Input type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} className="h-10 rounded-xl border-slate-200 shadow-sm" />
                            </Field>
                            {sourceType === "PO" && (
                                <Field label="System purchase order" col2>
                                    <Select value={poId} onValueChange={(value) => {
                                        setPoId(value)
                                        setLastPosted(null)
                                    }}>
                                        <SelectTrigger data-testid="smart-grn-system-po" className="h-10 rounded-xl border-slate-200 font-mono shadow-sm">
                                            <SelectValue placeholder={openPurchaseOrdersQ.isLoading ? "Loading open purchase orders..." : "Pick open PO waiting to receive"} />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {openPurchaseOrders.map((po: PurchaseOrderListItem) => (
                                                <SelectItem key={po.id} value={po.id}>
                                                    {po.code} · {po.vendor_name || "Vendor"} · open {(Number(po.open_qty_total ?? po.qty_ordered_total - po.qty_received_total) || 0).toLocaleString()} units
                                                </SelectItem>
                                            ))}
                                            {!openPurchaseOrdersQ.isLoading && openPurchaseOrders.length === 0 && (
                                                <SelectItem value="__none__" disabled>No sent/ack/partial PO has open quantity</SelectItem>
                                            )}
                                        </SelectContent>
                                    </Select>
                                    {selectedPo && (
                                        <div className="mt-2 rounded-xl border border-blue-100 bg-blue-50/70 px-3 py-2 text-[11px] text-blue-950">
                                            <div className="font-bold">{selectedPo.code} · {selectedPo.vendor_name || "Vendor"} · {selectedPo.status}</div>
                                            <div className="mt-0.5">
                                                {(selectedPo.items || []).filter((line) => Number(line.qty_open || 0) > 0).length} open lines · {Number(selectedPo.open_qty_total || 0).toLocaleString()} total open qty
                                            </div>
                                            {(selectedPo.items || []).filter((line) => Number(line.qty_open || 0) > 0 && poItemMatchesReceiptClass(line, klass)).length === 0 && (
                                                <div className="mt-1 font-bold text-amber-700">No open {klass.toLowerCase()} lines on this PO. Pick another stock class or PO.</div>
                                            )}
                                        </div>
                                    )}
                                </Field>
                            )}
                            {sourceType === "MANUAL_PO" && (
                                <Field label="Manual vendor PO ref" col2>
                                    <Input value={manualPoRef} onChange={(e) => setManualPoRef(e.target.value)} placeholder="VEND-PO-2025-0042" className="h-10 rounded-xl border-slate-200 font-mono shadow-sm" />
                                </Field>
                            )}
                            <Field label="Vendor">
                                <Select value={vendorId} onValueChange={setVendorId} disabled={sourceType === "PO"}>
                                    <SelectTrigger data-testid="smart-grn-vendor" className="h-10 rounded-xl border-slate-200 shadow-sm"><SelectValue placeholder="Pick vendor" /></SelectTrigger>
                                    <SelectContent>
                                        {(vendors as Vendor[]).map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </Field>
                            <Field label="Vendor invoice #">
                                <Input value={vendorInvoiceNo} onChange={(e) => setVendorInvoiceNo(e.target.value)} placeholder="ACM/INV/2025-0098" className="h-10 rounded-xl border-slate-200 font-mono shadow-sm" />
                            </Field>
                            <Field label="Vendor invoice date">
                                <Input type="date" value={vendorInvoiceDate} onChange={(e) => setVendorInvoiceDate(e.target.value)} className="h-10 rounded-xl border-slate-200 shadow-sm" />
                            </Field>
                            <Field label="LR / vehicle / driver">
                                <Input value={lrVehicle} onChange={(e) => setLrVehicle(e.target.value)} placeholder="LR-MH04-AB-1234 · Suresh K." className="h-10 rounded-xl border-slate-200 font-mono shadow-sm" />
                            </Field>
                            <Field label="Receiving warehouse" required col2>
                                <Select value={warehouseId} onValueChange={setWarehouseId}>
                                    <SelectTrigger data-testid="smart-grn-warehouse" className="h-10 rounded-xl border-slate-200 shadow-sm"><SelectValue placeholder="Pick warehouse" /></SelectTrigger>
                                    <SelectContent>
                                        {(locations as Location[]).map((l) => <SelectItem key={l.id} value={l.id}>{locationLabel(l)}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </Field>
                        </div>
                    </Section>

                    {klass === "TRADING" && (
                        <Section idx={3} eyebrow="Trading good" title="Trading-good direct receipt" tone="violet">
                            <TradingReceiptPanel
                                vendorId={vendorId}
                                warehouseLocations={locations as Location[]}
                                warehouseId={warehouseId}
                                vendorInvoiceNo={vendorInvoiceNo}
                                vendorInvoiceDate={vendorInvoiceDate}
                                lrVehicle={lrVehicle}
                                onPosted={(receipt) => {
                                    queryClient.invalidateQueries({ queryKey: ["inventory-snapshot"] })
                                    queryClient.invalidateQueries({ queryKey: ["trading-goods"] })
                                    queryClient.invalidateQueries({ queryKey: ["grn-history"] })
                                    setLastPosted({
                                        grn_no: receipt.code,
                                        klass: "TRADING",
                                        total_qty: Number(receipt.qty_received) || 0,
                                        uom: receipt.base_uom || "PCS",
                                        movement_count: 1,
                                    })
                                    resetDraftAfterPost()
                                }}
                            />
                        </Section>
                    )}
                    {/* 3 — Items */}
                    {klass !== "TRADING" && (
                    <Section idx={3} eyebrow="Items received" title="What did you actually receive?" tone="violet"
                        actions={
                            <div className="flex flex-wrap justify-end gap-2">
                                {klass === "ROLL" && (
                                    <>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            type="button"
                                            disabled={downloadRollTemplateMutation.isPending}
                                            onClick={() => downloadRollTemplateMutation.mutate()}
                                            className="rounded-lg gap-1.5"
                                        >
                                            {downloadRollTemplateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                                            Live template
                                        </Button>
                                        <input
                                            ref={rollUploadInputRef}
                                            type="file"
                                            accept=".xlsx"
                                            className="hidden"
                                            onChange={(event) => {
                                                const file = event.target.files?.[0]
                                                if (file) validateRollUploadFile(file)
                                            }}
                                        />
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            type="button"
                                            disabled={uploadRollsMutation.isPending}
                                            onClick={() => rollUploadInputRef.current?.click()}
                                            className="rounded-lg gap-1.5"
                                        >
                                            {uploadRollsMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                                            Upload Excel
                                        </Button>
                                    </>
                                )}
                                <Button size="sm" variant="outline" disabled={sourceType === "PO"} onClick={() => setItems([...items, FRESH_ITEM()])} className="rounded-lg gap-1.5"><Plus className="h-3 w-3" /> Add line</Button>
                            </div>
                        }>
                        <div className="space-y-3">
                            {klass === "BULK" && (
                                <BulkMaterialFilterChips
                                    value={bulkMaterialFilter}
                                    onChange={setBulkMaterialFilter}
                                    materials={materials as any[]}
                                />
                            )}
                            {klass === "ROLL" && rollUploadPreview && (
                                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950 shadow-sm">
                                    <div className="flex flex-col gap-3 border-b border-emerald-200 pb-3 sm:flex-row sm:items-center sm:justify-between">
                                        <div>
                                            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-emerald-700">Excel validated · review before posting</div>
                                            <div className="mt-1 font-bold">
                                                {rollUploadPreview.rows.toLocaleString()} rolls · {rollUploadPreview.qty.toLocaleString()} KG
                                                {rollUploadPreview.vendorName ? ` · ${rollUploadPreview.vendorName}` : ""}
                                            </div>
                                            <div className="mt-0.5 text-xs text-emerald-800">Edit any row below. Posting creates stock only from this reviewed list.</div>
                                        </div>
                                        <div className="flex gap-2">
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                className="rounded-lg border-emerald-200 bg-white text-emerald-800 hover:bg-emerald-100"
                                                onClick={() => {
                                                    setRollUploadPreview(null)
                                                    setRollReviewRows([])
                                                }}
                                            >
                                                Cancel
                                            </Button>
                                            <Button
                                                type="button"
                                                size="sm"
                                                disabled={!rollReviewRows.length || postRollReviewMutation.isPending}
                                                onClick={() => postRollReviewMutation.mutate()}
                                                className="rounded-lg bg-emerald-700 text-white hover:bg-emerald-800"
                                            >
                                                {postRollReviewMutation.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <CheckCircle2 className="mr-1 h-3 w-3" />}
                                                Post GRN
                                            </Button>
                                        </div>
                                    </div>
                                    <div className="mt-3 overflow-x-auto rounded-xl border border-emerald-100 bg-white">
                                        <table className="min-w-[1500px] text-left text-[11px]">
                                            <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                                                <tr>
                                                    {["Row", "ERP label", "Supplier roll", "Variant code", "Variant name", "Lot", "Gross", "Tare", "Net", "Width", "Micron", "Location", "Cost", "QC", "Remarks", ""].map((head) => (
                                                        <th key={head} className="px-2 py-2">{head}</th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {rollReviewRows.map((row, index) => (
                                                    <tr key={`${row.excel_row || index}-${index}`} className="border-t border-slate-100 align-top">
                                                        <td className="px-2 py-2 font-mono text-slate-500">{row.excel_row || index + 1}</td>
                                                        <td className="px-2 py-2"><Input value={String(row.label_id || "")} onChange={(e) => updateRollReviewRow(index, { label_id: e.target.value })} className="h-8 min-w-[130px] rounded-lg font-mono text-xs" /></td>
                                                        <td className="px-2 py-2"><Input value={String(row.supplier_roll_no || "")} onChange={(e) => updateRollReviewRow(index, { supplier_roll_no: e.target.value })} className="h-8 min-w-[130px] rounded-lg font-mono text-xs" /></td>
                                                        <td className="px-2 py-2"><Input value={String(row.material_code || "")} onChange={(e) => updateRollReviewRow(index, { material_code: e.target.value })} className="h-8 min-w-[180px] rounded-lg font-mono text-xs" /></td>
                                                        <td className="px-2 py-2"><Input value={String(row.material_name || "")} onChange={(e) => updateRollReviewRow(index, { material_name: e.target.value })} className="h-8 min-w-[260px] rounded-lg text-xs" /></td>
                                                        <td className="px-2 py-2"><Input value={String(row.batch_no || "")} onChange={(e) => updateRollReviewRow(index, { batch_no: e.target.value })} className="h-8 min-w-[130px] rounded-lg font-mono text-xs" /></td>
                                                        <td className="px-2 py-2"><Input value={String(row.gross_weight_kg ?? "")} onChange={(e) => updateRollReviewRow(index, { gross_weight_kg: e.target.value })} className="h-8 w-24 rounded-lg font-mono text-xs" /></td>
                                                        <td className="px-2 py-2"><Input value={String(row.tare_weight_kg ?? "")} onChange={(e) => updateRollReviewRow(index, { tare_weight_kg: e.target.value })} className="h-8 w-24 rounded-lg font-mono text-xs" /></td>
                                                        <td className="px-2 py-2"><Input value={String(row.net_weight_kg ?? "")} onChange={(e) => updateRollReviewRow(index, { net_weight_kg: e.target.value })} className="h-8 w-24 rounded-lg font-mono text-xs" /></td>
                                                        <td className="px-2 py-2"><Input value={String(row.width_mm ?? "")} onChange={(e) => updateRollReviewRow(index, { width_mm: e.target.value })} className="h-8 w-24 rounded-lg font-mono text-xs" /></td>
                                                        <td className="px-2 py-2"><Input value={String(row.thickness_micron ?? "")} onChange={(e) => updateRollReviewRow(index, { thickness_micron: e.target.value })} className="h-8 w-24 rounded-lg font-mono text-xs" /></td>
                                                        <td className="px-2 py-2"><Input value={String(row.location_code || "")} onChange={(e) => updateRollReviewRow(index, { location_code: e.target.value })} title={row.location_name || ""} className="h-8 min-w-[130px] rounded-lg font-mono text-xs" /></td>
                                                        <td className="px-2 py-2"><Input value={String(row.unit_cost ?? "")} onChange={(e) => updateRollReviewRow(index, { unit_cost: e.target.value })} className="h-8 w-24 rounded-lg font-mono text-xs" /></td>
                                                        <td className="px-2 py-2"><Input value={String(row.qc_status || "PENDING")} onChange={(e) => updateRollReviewRow(index, { qc_status: e.target.value })} className="h-8 w-28 rounded-lg text-xs" /></td>
                                                        <td className="px-2 py-2"><Input value={String(row.remarks || "")} onChange={(e) => updateRollReviewRow(index, { remarks: e.target.value })} className="h-8 min-w-[200px] rounded-lg text-xs" /></td>
                                                        <td className="px-2 py-2">
                                                            <Button type="button" variant="ghost" size="sm" className="h-8 w-8 rounded-lg p-0 text-rose-600" onClick={() => removeRollReviewRow(index)}>
                                                                <X className="h-3.5 w-3.5" />
                                                            </Button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                            {rollReviewRows.length === 0 && items.map((it, idx) => (
                                <ItemEditor
                                    key={it.id}
                                    item={it}
                                    index={idx}
                                    klass={klass}
                                    bulkMaterialFilter={bulkMaterialFilter}
                                    materials={materials as any[]}
                                    locations={locations as Location[]}
                                    grades={(gradesQ.data || []) as RecipeGrade[]}
                                    granuleCodes={(granuleCodesQ.data || []) as GranuleQualityCode[]}
                                    lockedToPo={sourceType === "PO"}
                                    onChange={(patch) => setItems(items.map((i) => i.id === it.id ? { ...i, ...patch } : i))}
                                    onRemove={() => setItems(items.length > 1 ? items.filter((i) => i.id !== it.id) : items)}
                                />
                            ))}
                        </div>
                        {items.length > 0 && (
                            <div className="mt-3 flex items-center justify-end gap-3 text-xs">
                                <span className="text-slate-500">Total qty:</span>
                                <span className="font-mono font-bold text-slate-900">{totalQty.toLocaleString()}</span>
                                <span className="text-slate-500">·</span>
                                <span className="text-slate-500">Subtotal:</span>
                                <span className="font-mono font-bold text-emerald-700">₹{subtotal.toLocaleString()}</span>
                            </div>
                        )}
                    </Section>
                    )}

                    {/* 4 — Quality */}
                    {klass !== "TRADING" && (
                    <Section idx={4} eyebrow="Quality" title="QC checks & documents" tone="amber"
                        actions={
                            <Button type="button" variant="ghost" size="sm" onClick={() => setShowQualityDetails((v) => !v)} className="h-8 rounded-lg text-xs">
                                Optional details <ChevronDown className={cn("ml-1 h-3.5 w-3.5 transition", showQualityDetails && "rotate-180")} />
                            </Button>
                        }>
                        {showQualityDetails ? (
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <Field label="Vendor COA">
                                    <label className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm cursor-pointer">
                                        <input type="checkbox" checked={coaAttached} onChange={(e) => setCoaAttached(e.target.checked)} className="h-4 w-4 rounded text-emerald-600" />
                                        <span>COA attached</span>
                                    </label>
                                </Field>
                                <Field label="In-house QC">
                                    <label className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm cursor-pointer">
                                        <input type="checkbox" checked={qcRequired} onChange={(e) => setQcRequired(e.target.checked)} className="h-4 w-4 rounded text-amber-600" />
                                        <span>In-house QC required</span>
                                    </label>
                                </Field>
                                <Field label="Density"><Input value={density} onChange={(e) => setDensity(e.target.value)} className="h-10 rounded-xl border-slate-200 font-mono shadow-sm" /></Field>
                                <Field label="MFI"><Input value={mfi} onChange={(e) => setMfi(e.target.value)} className="h-10 rounded-xl border-slate-200 font-mono shadow-sm" /></Field>
                                <Field label="Moisture %"><Input value={moisture} onChange={(e) => setMoisture(e.target.value)} className="h-10 rounded-xl border-slate-200 font-mono shadow-sm" /></Field>
                                <Field label="QC inspector"><Input value={qcInspector} onChange={(e) => setQcInspector(e.target.value)} className="h-10 rounded-xl border-slate-200 shadow-sm" /></Field>
                            </div>
                        ) : (
                            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                                QC and document details are optional. Open this only when COA, lab values, or inspector notes are needed.
                            </div>
                        )}
                    </Section>
                    )}

                    {/* 5 — Financials */}
                    {klass !== "TRADING" && (
                    <Section idx={5} eyebrow="Financials" title="Costs &amp; taxes" tone="blue">
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                            <Field label="Subtotal">
                                <div className="flex h-10 items-center justify-end rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-mono shadow-sm">₹{subtotal.toLocaleString()}</div>
                            </Field>
                            <Field label="GST %"><Input value={gstPct} onChange={(e) => setGstPct(e.target.value)} className="h-10 rounded-xl border-slate-200 font-mono shadow-sm" /></Field>
                            <Field label="GST">
                                <div className="flex h-10 items-center justify-end rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-mono shadow-sm">₹{gst.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                            </Field>
                            <Field label="Freight"><Input value={freight} onChange={(e) => setFreight(e.target.value)} className="h-10 rounded-xl border-slate-200 font-mono shadow-sm" /></Field>
                            <Field label="Other charges"><Input value={otherCharges} onChange={(e) => setOtherCharges(e.target.value)} className="h-10 rounded-xl border-slate-200 font-mono shadow-sm" /></Field>
                            <Field label="Grand total">
                                <div className="flex h-10 items-center justify-end rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-sm font-mono font-bold text-emerald-700 shadow-sm">₹{grandTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                            </Field>
                        </div>
                    </Section>
                    )}

                    {/* 6 — Notes */}
                    {klass !== "TRADING" && (
                    <Section idx={6} eyebrow="Notes" title="Remarks (optional)" tone="slate">
                        <Textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Any extra notes…" className="rounded-xl border-slate-200 shadow-sm" />
                    </Section>
                    )}
                </main>

                {/* RIGHT RAIL */}
                <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
                    <div className="overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-md ring-1 ring-emerald-100">
                        <div className="bg-gradient-to-br from-emerald-600 via-teal-600 to-cyan-600 px-4 py-3 text-white">
                            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-white/80">Live preview</div>
                            <div className="font-display text-base font-bold">GRN to be posted</div>
                        </div>
                        <div className="px-4 py-3 grid grid-cols-2 gap-2 text-[11px]">
                            <Stat label="Class" value={klass} />
                            <Stat label="Lines" value={String(items.length)} />
                            <Stat label="Total qty" value={`${totalQty.toLocaleString()} ${items[0]?.uom || "—"}`} mono />
                            <Stat label="Value" value={`₹${grandTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} mono accent />
                        </div>
                    </div>

                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4 shadow-sm">
                        <div className="flex items-start gap-2">
                            <div className={cn("flex h-7 w-7 items-center justify-center rounded-full text-white text-xs", valid ? "bg-emerald-600" : "bg-rose-500")}>
                                {valid ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                            </div>
                            <div>
                                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-emerald-700">{valid ? "Ready to post" : "Not ready"}</div>
                                <ul className="mt-1 space-y-0.5 text-[11px] text-emerald-900">
                                    <li className={vendorId ? "" : "text-rose-700"}>{vendorId ? "✓" : "✗"} Vendor selected</li>
                                    <li className={warehouseId ? "" : "text-rose-700"}>{warehouseId ? "✓" : "✗"} Warehouse selected</li>
                                    {sourceType === "PO" && <li className={poId ? "" : "text-rose-700"}>{poId ? "✓" : "✗"} System PO selected</li>}
                                    <li className={items.every((i) => i.material_code) ? "" : "text-rose-700"}>{items.every((i) => i.material_code) ? "✓" : "✗"} All items have material</li>
                                    <li className={items.every((i) => lineQty(i) > 0) ? "" : "text-rose-700"}>{items.every((i) => lineQty(i) > 0) ? "✓" : "✗"} All items have qty &gt; 0</li>
                                    <li>✓ Period open</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                </aside>
            </div>

            {/* Sticky footer */}
            <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur lg:left-[var(--sidebar-width,16rem)]">
                <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center justify-between gap-3 px-6 py-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">GRN draft</span>
                        <span className={cn("rounded-full px-2.5 py-0.5 font-bold ring-1 ring-inset", valid ? "bg-emerald-100 text-emerald-700 ring-emerald-200" : "bg-rose-100 text-rose-700 ring-rose-200")}>
                            {valid ? "VALID" : "INCOMPLETE"}
                        </span>
                        <span className="rounded-full bg-blue-100 px-2.5 py-0.5 font-bold text-blue-700 ring-1 ring-blue-200">{items.length} LINES · {totalQty.toLocaleString()}</span>
                        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 font-bold text-amber-700 ring-1 ring-amber-200">₹{grandTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <Link href="/inventory" className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm">Cancel</Link>
                        <Button variant="outline" className="rounded-xl border-blue-200 bg-blue-50 text-blue-700 shadow-sm">📂 Save draft</Button>
                        <Button data-testid="smart-grn-submit" onClick={() => submitMutation.mutate()} disabled={!valid || submitMutation.isPending} className="gap-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 shadow-md">
                            {submitMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                            Submit &amp; post
                            <ArrowRight className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    )
}

// ─── Sub-components ───────────────────────────────────────────────

function Section({ idx, eyebrow, title, tone, actions, children }: { idx: number; eyebrow: string; title: string; tone: "blue" | "violet" | "emerald" | "amber" | "slate"; actions?: React.ReactNode; children: React.ReactNode }) {
    const TONE = {
        blue: { bar: "border-l-blue-500", bg: "from-blue-50/80", num: "bg-blue-600 ring-blue-700" },
        violet: { bar: "border-l-violet-500", bg: "from-violet-50/80", num: "bg-violet-600 ring-violet-700" },
        emerald: { bar: "border-l-emerald-500", bg: "from-emerald-50/80", num: "bg-emerald-600 ring-emerald-700" },
        amber: { bar: "border-l-amber-500", bg: "from-amber-50/60", num: "bg-amber-500 ring-amber-600" },
        slate: { bar: "border-l-slate-400", bg: "from-slate-50/80", num: "bg-slate-500 ring-slate-600" },
    }[tone]
    return (
        <section className={cn("overflow-hidden rounded-2xl border border-slate-200/60 bg-white shadow-md ring-1 ring-slate-100/50 border-l-[3px]", TONE.bar)}>
            <header className={cn("flex items-start justify-between gap-3 border-b border-slate-100 bg-gradient-to-r via-white to-white px-5 py-3.5", TONE.bg)}>
                <div className="flex items-start gap-3">
                    <span className={cn("flex h-7 w-7 flex-none items-center justify-center rounded-lg text-white text-xs font-bold shadow-sm ring-1", TONE.num)}>{idx}</span>
                    <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">{eyebrow}</div>
                        <h2 className="text-[15px] font-bold text-slate-900">{title}</h2>
                    </div>
                </div>
                {actions}
            </header>
            <div className="px-5 py-4">{children}</div>
        </section>
    )
}

function ClassTile({ id, icon, label, desc, active, onClick }: { id: ClassKind; icon: React.ReactNode; label: string; desc: string; active: boolean; onClick: () => void }) {
    return (
        <button data-testid={`smart-grn-class-${id}`} onClick={onClick} className={cn("flex flex-col gap-2 rounded-2xl border px-4 py-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md", active ? "border-emerald-400 bg-gradient-to-br from-emerald-50 to-white ring-2 ring-emerald-200" : "border-slate-200 bg-white")}>
            <div className="flex items-center gap-2">
                <span className={cn("flex h-9 w-9 items-center justify-center rounded-xl shadow-sm ring-1 ring-current/20", active ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600")}>{icon}</span>
                <span className="text-sm font-bold text-slate-900">{label}</span>
            </div>
            <div className="text-[11px] leading-snug text-slate-500">{desc}</div>
        </button>
    )
}

function Field({ label, required, col2, children }: { label: string; required?: boolean; col2?: boolean; children: React.ReactNode }) {
    return (
        <div className={col2 ? "sm:col-span-2" : ""}>
            <Label className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">{label}{required && <span className="text-rose-600"> *</span>}</Label>
            <div className="mt-1">{children}</div>
        </div>
    )
}

function Toggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
        <button onClick={onClick} className={cn("rounded-lg px-3 py-1.5 text-xs font-bold shadow-sm transition", active ? "bg-gradient-to-r from-emerald-600 to-teal-600 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200")}>{children}</button>
    )
}

function Stat({ label, value, mono, accent }: { label: string; value: string; mono?: boolean; accent?: boolean }) {
    return (
        <div className="rounded-lg bg-slate-50 px-2 py-1.5">
            <div className="text-[9px] font-black uppercase text-slate-500">{label}</div>
            <div className={cn("font-bold", mono && "font-mono", accent ? "text-emerald-700" : "text-slate-900")}>{value}</div>
        </div>
    )
}

function BulkMaterialFilterChips({ value, onChange, materials }: { value: BulkMaterialFilter; onChange: (value: BulkMaterialFilter) => void; materials: any[] }) {
    const counts = React.useMemo(() => {
        const next: Record<BulkMaterialFilter, number> = { ALL: 0, GRANULE: 0, INK: 0, ADHESIVE: 0, SOLVENT: 0, ADDON: 0, POD: 0 }
        for (const material of materials) {
            if (!materialMatchesReceiptClass(material, "BULK")) continue
            const category = materialCategory(material) as BulkMaterialFilter
            next.ALL += 1
            if (category in next) next[category] += 1
        }
        return next
    }, [materials])

    return (
        <div className="rounded-xl border border-violet-100 bg-violet-50/50 px-3 py-2">
            <div className="mb-2 text-[10px] font-black uppercase tracking-[0.22em] text-violet-700">Material type filter</div>
            <div className="flex flex-wrap gap-2">
                {BULK_FILTERS.map((filter) => (
                    <button
                        key={filter.id}
                        type="button"
                        data-testid={`smart-grn-filter-${filter.id.toLowerCase()}`}
                        onClick={() => onChange(filter.id)}
                        className={cn(
                            "rounded-full border px-3 py-1 text-[11px] font-black transition",
                            value === filter.id
                                ? "border-violet-500 bg-violet-600 text-white shadow-sm"
                                : "border-violet-200 bg-white text-violet-700 hover:border-violet-400"
                        )}
                    >
                        {filter.label}
                        <span className={cn("ml-1.5 font-mono text-[10px]", value === filter.id ? "text-white/80" : "text-violet-500")}>
                            {counts[filter.id] || 0}
                        </span>
                    </button>
                ))}
            </div>
        </div>
    )
}

function ItemEditor({ item, index, klass, bulkMaterialFilter, materials, locations, grades, granuleCodes, lockedToPo, onChange, onRemove }: { item: ItemDraft; index: number; klass: ClassKind; bulkMaterialFilter: BulkMaterialFilter; materials: any[]; locations: Location[]; grades: RecipeGrade[]; granuleCodes: GranuleQualityCode[]; lockedToPo?: boolean; onChange: (patch: Partial<ItemDraft>) => void; onRemove: () => void }) {
    const filteredMaterials = React.useMemo(() => {
        return materials
            .filter((material) => materialMatchesReceiptClass(material, klass))
            .filter((material) => klass !== "BULK" || bulkMaterialFilter === "ALL" || materialCategory(material) === bulkMaterialFilter)
            .sort((a, b) => String(a.code || "").localeCompare(String(b.code || "")))
    }, [bulkMaterialFilter, klass, materials])

    const selectedMaterial = React.useMemo(
        () => materials.find((material) => String(material.code) === String(item.material_code)),
        [item.material_code, materials]
    )
    const selectedCategory = materialCategory(selectedMaterial)
    const showRollGrade = klass === "ROLL" && selectedCategory === "FILM_VARIANT"
    const showGranuleCode = klass === "BULK" && selectedCategory === "GRANULE"
    const selectedGranuleCodes = React.useMemo(() => {
        if (!selectedMaterial) return []
        return granuleCodes
            .filter((code) =>
                String(code.granule || "") === String(selectedMaterial.id || "") ||
                String(code.granule_material_code || "") === String(selectedMaterial.code || "")
            )
            .sort((a, b) => String(a.code || "").localeCompare(String(b.code || "")))
    }, [granuleCodes, selectedMaterial])

    const handleMaterialChange = (code: string) => {
        const selected = filteredMaterials.find((m) => String(m.code) === code)
        onChange({
            material_code: code,
            po_item_id: lockedToPo ? item.po_item_id : undefined,
            grade: "",
            granule_code_id: "",
            uom: materialBaseUom(selected, klass),
        })
    }
    const patchWeight = (patch: Partial<ItemDraft>) => {
        const next = { ...item, ...patch }
        const gross = Number(next.gross_weight_kg || 0)
        const tare = Number(next.tare_weight_kg || 0)
        if (klass === "ROLL" && gross > 0 && tare >= 0 && gross >= tare) {
            const net = Number((gross - tare).toFixed(3))
            onChange({ ...patch, net_weight_kg: String(net), qty: String(net) })
            return
        }
        onChange(patch)
    }

    return (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
                <span className="rounded-md bg-violet-100 px-2 py-0.5 text-[10px] font-black tracking-wider text-violet-700">Line {index + 1}</span>
                <button onClick={onRemove} className="rounded p-1 text-rose-500 hover:bg-rose-50"><X className="h-3.5 w-3.5" /></button>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Field label="Material" required>
                    {filteredMaterials.length > 0 ? (
                        <MaterialPicker
                            items={filteredMaterials.map((material) => ({
                                id: String(material.code),
                                code: String(material.code),
                                name: String(material.name || material.code),
                                category: materialCategory(material),
                                type: materialBaseUom(material, klass),
                            }))}
                            value={item.material_code}
                            onValueChange={handleMaterialChange}
                            placeholder={klass === "BULK" ? "Search code, name, type" : "Search material"}
                            disabled={lockedToPo}
                            testId={`smart-grn-line-${index}-material`}
                            className="h-9 rounded-lg border-slate-200 font-mono text-xs shadow-sm"
                        />
                    ) : (
                        <div className="flex h-9 items-center rounded-lg border border-rose-200 bg-rose-50 px-3 text-[11px] font-bold text-rose-700">
                            No active {klass.toLowerCase()} material found for this filter.
                        </div>
                    )}
                </Field>
                {showRollGrade && (
                    <Field label="Film grade">
                        <Select value={item.grade || "__none__"} onValueChange={(value) => onChange({ grade: value === "__none__" ? "" : value })}>
                            <SelectTrigger className="h-9 rounded-lg border-slate-200 text-xs shadow-sm"><SelectValue placeholder="Grade if required" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="__none__">No grade</SelectItem>
                                {grades.map((grade) => <SelectItem key={grade.id} value={grade.id}>{grade.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </Field>
                )}
                {showGranuleCode && (
                    <Field label="Granule code">
                        <Select value={item.granule_code_id || "__none__"} onValueChange={(value) => onChange({ granule_code_id: value === "__none__" ? "" : value })}>
                            <SelectTrigger data-testid={`smart-grn-line-${index}-granule-code`} className="h-9 rounded-lg border-slate-200 text-xs shadow-sm"><SelectValue placeholder="Pick code" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="__none__">No code</SelectItem>
                                {selectedGranuleCodes.map((code) => <SelectItem key={code.id} value={code.id}>{code.code}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </Field>
                )}
                <Field label="Qty" required><Input data-testid={`smart-grn-line-${index}-qty`} type="number" value={item.qty} onChange={(e) => onChange({ qty: e.target.value })} className="h-9 rounded-lg border-slate-200 font-mono text-xs shadow-sm" /></Field>
                <Field label="UOM">
                    <Select value={item.uom} onValueChange={(v) => onChange({ uom: v })}>
                        <SelectTrigger data-testid={`smart-grn-line-${index}-uom`} className="h-9 rounded-lg border-slate-200 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="KG">KG</SelectItem><SelectItem value="PCS">PCS</SelectItem>
                            <SelectItem value="METER">METER</SelectItem><SelectItem value="ROLL">ROLL</SelectItem>
                            <SelectItem value="LITER">LITER</SelectItem>
                        </SelectContent>
                    </Select>
                </Field>
                <Field label="Unit cost (₹)"><Input data-testid={`smart-grn-line-${index}-unit-cost`} value={item.unit_cost} onChange={(e) => onChange({ unit_cost: e.target.value })} className="h-9 rounded-lg border-slate-200 font-mono text-xs shadow-sm" /></Field>
                <Field label="Vendor lot ref"><Input value={item.vendor_lot_ref} onChange={(e) => onChange({ vendor_lot_ref: e.target.value })} className="h-9 rounded-lg border-slate-200 font-mono text-xs shadow-sm" /></Field>
                <Field label="Best before"><Input type="date" value={item.best_before} onChange={(e) => onChange({ best_before: e.target.value })} className="h-9 rounded-lg border-slate-200 text-xs shadow-sm" /></Field>
                <Field label="Storage location">
                    <Select value={item.location} onValueChange={(v) => onChange({ location: v })}>
                        <SelectTrigger data-testid={`smart-grn-line-${index}-location`} className="h-9 rounded-lg border-slate-200 text-xs"><SelectValue placeholder="Pick" /></SelectTrigger>
                        <SelectContent>
                            {locations.map((l) => <SelectItem key={l.id} value={l.id}>{locationLabel(l)}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </Field>
            </div>

            {klass === "ROLL" && (
                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/40 p-3">
                    <div className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-2">Roll-specific fields</div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <Field label="Gross (KG)"><Input data-testid={`smart-grn-line-${index}-gross`} value={item.gross_weight_kg || ""} onChange={(e) => patchWeight({ gross_weight_kg: e.target.value })} className="h-8 rounded-md border-slate-200 font-mono text-[11px]" /></Field>
                        <Field label="Tare (KG)"><Input data-testid={`smart-grn-line-${index}-tare`} value={item.tare_weight_kg || ""} onChange={(e) => patchWeight({ tare_weight_kg: e.target.value })} className="h-8 rounded-md border-slate-200 font-mono text-[11px]" /></Field>
                        <Field label="Net auto (KG)"><Input data-testid={`smart-grn-line-${index}-net`} value={item.net_weight_kg || ""} readOnly className="h-8 rounded-md border-slate-200 bg-slate-100 font-mono text-[11px]" /></Field>
                        <Field label="Length (m)"><Input value={item.length_m || ""} onChange={(e) => onChange({ length_m: e.target.value })} className="h-8 rounded-md border-slate-200 font-mono text-[11px]" /></Field>
                        <Field label="Width (mm)"><Input data-testid={`smart-grn-line-${index}-width`} value={item.width_mm || ""} onChange={(e) => onChange({ width_mm: e.target.value })} className="h-8 rounded-md border-slate-200 font-mono text-[11px]" placeholder="1050" /></Field>
                        <Field label="Thickness (μ)"><Input data-testid={`smart-grn-line-${index}-thickness`} value={item.thickness_um || ""} onChange={(e) => onChange({ thickness_um: e.target.value })} className="h-8 rounded-md border-slate-200 font-mono text-[11px]" /></Field>
                    </div>
                </div>
            )}

            {klass === "PACKAGING" && selectedMaterial && (
                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 text-[11px] font-semibold text-slate-600">
                    Packaging kind, supply mode, and pack defaults are taken from Packaging Master for <span className="font-mono font-black text-slate-900">{selectedMaterial.code}</span>. GRN only records received quantity, UOM, cost, location, and vendor trace.
                </div>
            )}
        </div>
    )
}


function TradingReceiptPanel({
    vendorId,
    warehouseLocations,
    warehouseId,
    vendorInvoiceNo,
    vendorInvoiceDate,
    lrVehicle,
    onPosted,
}: {
    vendorId: string
    warehouseLocations: Location[]
    warehouseId: string
    vendorInvoiceNo: string
    vendorInvoiceDate: string
    lrVehicle: string
    onPosted: (r: any) => void
}) {
    const { toast } = useToast()
    const [tradingGoodId, setTradingGoodId] = React.useState("")
    const [qty, setQty] = React.useState("")
    const [rate, setRate] = React.useState("")
    const [notes, setNotes] = React.useState("")
    const tradingGoodsQ = useQuery({ queryKey: ["trading-goods", "active"], queryFn: () => tradingGoodService.list({ is_active: true }), staleTime: 60_000 })

    const tradingGoods = (tradingGoodsQ.data || []) as TradingGood[]
    const selected = tradingGoods.find((t) => t.id === tradingGoodId)
    const baseUom = selected?.base_uom || "PCS"
    const plantId = React.useMemo(() => {
        if (!warehouseId) return ""
        const loc = (warehouseLocations || []).find((l) => l.id === warehouseId)
        return (loc as any)?.plant || (loc as any)?.plant_id || ""
    }, [warehouseId, warehouseLocations])

    const post = useMutation({
        mutationFn: () => tradingGoodReceiptService.create({
            trading_good: tradingGoodId,
            vendor: vendorId,
            plant: plantId,
            qty: Number(qty) || 0,
            rate: Number(rate) || 0,
            vendor_invoice_no: vendorInvoiceNo,
            vendor_invoice_date: vendorInvoiceDate || undefined,
            lr_no: lrVehicle,
            notes,
        }),
        onSuccess: (receipt) => {
            toast({ title: "Trading-good receipt posted", description: `${receipt.code} · ${receipt.qty_received} ${receipt.base_uom || ""}` })
            onPosted(receipt)
            setTradingGoodId("")
            setQty("")
            setRate("")
            setNotes("")
        },
        onError: (err: any) => toast({ title: "Could not post", description: describeApiError(err, "Try again"), variant: "destructive" }),
    })

    const valid = !!tradingGoodId && !!vendorId && !!plantId && Number(qty) > 0 && Number(rate) >= 0

    return (
        <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                    <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Trading good</Label>
                    <Select value={tradingGoodId} onValueChange={setTradingGoodId}>
                        <SelectTrigger className="mt-1 h-10 rounded-xl border-slate-200 shadow-sm">
                            <SelectValue placeholder={tradingGoodsQ.isLoading ? "Loading..." : "Pick trading good"} />
                        </SelectTrigger>
                        <SelectContent>
                            {tradingGoods.map((t) => (
                                <SelectItem key={t.id} value={t.id}>{t.code} · {t.name} ({t.base_uom})</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div>
                    <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Qty ({baseUom})</Label>
                    <Input value={qty} onChange={(e) => setQty(e.target.value)} type="number" className="mt-1 h-10 rounded-xl border-slate-200 font-mono shadow-sm" />
                </div>
                <div>
                    <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Rate per {baseUom}</Label>
                    <Input value={rate} onChange={(e) => setRate(e.target.value)} type="number" className="mt-1 h-10 rounded-xl border-slate-200 font-mono shadow-sm" />
                </div>
                <div className="sm:col-span-2">
                    <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Notes</Label>
                    <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1 rounded-xl border-slate-200 shadow-sm" />
                </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                Vendor invoice and transport details are taken from the Source section. Plant is inferred from the receiving warehouse.
            </div>
            <div className="flex justify-end">
                <Button
                    type="button"
                    disabled={!valid || post.isPending}
                    onClick={() => post.mutate()}
                    className="rounded-xl bg-violet-700 text-white hover:bg-violet-800"
                >
                    {post.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Post trading-good receipt
                </Button>
            </div>
        </div>
    )
}
