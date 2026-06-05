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
import { useDashboardChrome } from "@/components/layout/dashboard-chrome"
import { inventoryService, type Vendor, type Location } from "@/services/inventory"
import { masterDataService, type GranuleQualityCode } from "@/services/master-data"
import { procurementService, type POItem, type PurchaseOrderListItem } from "@/services/procurement"
import { recipeService, type RecipeGrade } from "@/services/recipes"
import { tradingGoodService, tradingGoodReceiptService, type TradingGood } from "@/services/trading-goods"
import { MaterialPicker } from "@/components/inventory/material-picker"

type ClassKind = "BULK" | "ROLL" | "PACKAGING" | "TRADING"
type BulkMaterialFilter = "ALL" | "GRANULE" | "INK" | "ADHESIVE" | "SOLVENT" | "ADDON" | "POD"
type StockForm = "OPEN_WEB" | "LAYFLAT_TUBE" | "FOLDED_WEB"
type WidthBasis = "OPEN_WEB_WIDTH" | "LAYFLAT_WIDTH" | "FOLDED_WIDTH"

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
    stock_form?: StockForm
    width_basis?: WidthBasis
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
    stock_form: "OPEN_WEB",
    width_basis: "OPEN_WEB_WIDTH",
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

const RECEIPT_UOMS = ["KG", "PCS", "METER"] as const
type ReceiptUom = typeof RECEIPT_UOMS[number]

const UOM_ALIASES: Record<string, ReceiptUom> = {
    KG: "KG",
    KGS: "KG",
    KILOGRAM: "KG",
    KILOGRAMS: "KG",
    M: "METER",
    MTR: "METER",
    MTRS: "METER",
    MTS: "METER",
    METRE: "METER",
    METRES: "METER",
    METER: "METER",
    METERS: "METER",
    PC: "PCS",
    PCS: "PCS",
    PIECE: "PCS",
    PIECES: "PCS",
    NOS: "PCS",
    NO: "PCS",
    EACH: "PCS",
    EA: "PCS",
    UNIT: "PCS",
    UNITS: "PCS",
}

function materialCategory(material: any) {
    return String(material?.category || "").trim().toUpperCase()
}

function normalizeUom(uom?: string) {
    const value = String(uom || "").trim().toUpperCase()
    const compact = value.replace(/[\s._-]+/g, "")
    return UOM_ALIASES[compact] || value
}

function isReceiptUom(uom?: string): uom is ReceiptUom {
    return RECEIPT_UOMS.includes(normalizeUom(uom) as ReceiptUom)
}

function defaultUomForReceiptClass(klass: ClassKind, material?: any): ReceiptUom {
    const category = materialCategory(material)
    if (category === "ADDON") {
        const addonUom = normalizeUom(material?.addon_purchase_uom || material?.base_uom)
        return isReceiptUom(addonUom) ? addonUom : "KG"
    }
    const masterUom = normalizeUom(material?.base_uom)
    if (isReceiptUom(masterUom)) return masterUom
    if (klass === "PACKAGING" || klass === "TRADING" || category === "PACKAGING") return "PCS"
    return "KG"
}

function materialBaseUom(material: any, klass: ClassKind) {
    const category = materialCategory(material)
    const raw = category === "ADDON"
        ? material?.addon_purchase_uom || material?.base_uom
        : material?.base_uom || defaultUomForReceiptClass(klass, material)
    const normalized = normalizeUom(raw)
    return isReceiptUom(normalized) ? normalized : defaultUomForReceiptClass(klass, material)
}

function supportedUomsForMaterial(material: any, klass: ClassKind) {
    const base = normalizeUom(materialBaseUom(material, klass))
    return [isReceiptUom(base) ? base : defaultUomForReceiptClass(klass, material)]
}

function resolvedReceiptUom(itemUom: string | undefined, material: any, klass: ClassKind) {
    const supported = supportedUomsForMaterial(material, klass)
    const normalized = normalizeUom(itemUom)
    return supported.includes(normalized as ReceiptUom) ? normalized : supported[0]
}

function isWeightBasedUom(uom?: string) {
    return normalizeUom(uom) === "KG"
}

function safeSelectValue(value: unknown) {
    const text = String(value ?? "").trim()
    if (!text || text === "undefined" || text === "null") return ""
    return text
}

function safeSelectRows<T>(rows: T[], getValue: (row: T) => unknown) {
    return rows.filter((row) => Boolean(safeSelectValue(getValue(row))))
}

function materialPickerItems(materials: any[], klass: ClassKind) {
    return materials
        .map((material) => {
            const code = safeSelectValue(material?.code)
            if (!code) return null
            return {
                id: code,
                code,
                name: String(material?.name || code),
                category: materialCategory(material),
                type: materialBaseUom(material, klass),
            }
        })
        .filter(Boolean) as Array<{ id: string; code: string; name: string; category: string; type: string }>
}

function computeNetFromGrossTare(gross?: string | number, tare?: string | number) {
    const grossValue = Number(gross || 0)
    const tareValue = Number(tare || 0)
    if (!(grossValue > 0) || tareValue < 0 || grossValue < tareValue) return ""
    return String(Number((grossValue - tareValue).toFixed(3)))
}

function stockFormLabel(value?: string) {
    if (value === "LAYFLAT_TUBE") return "Lay-flat tube"
    if (value === "FOLDED_WEB") return "Folded web"
    return "Open web / sheet"
}

function widthBasisForStockForm(stockForm?: string): WidthBasis {
    if (stockForm === "LAYFLAT_TUBE") return "LAYFLAT_WIDTH"
    if (stockForm === "FOLDED_WEB") return "FOLDED_WIDTH"
    return "OPEN_WEB_WIDTH"
}

function isExtrudableFilm(material: any) {
    return materialCategory(material) === "FILM_VARIANT" && (
        material?.is_extrudable === true ||
        String(material?.film_source || material?.source || "").toUpperCase() === "EXTRUSION" ||
        String(material?.supply_mode || "").toUpperCase() === "IN_HOUSE"
    )
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
        stock_form: ((item as any).stock_form as StockForm) || "OPEN_WEB",
        width_basis: ((item as any).width_basis as WidthBasis) || widthBasisForStockForm((item as any).stock_form),
    }
}

function receiptTotalQty(receipt: any, fallback: number) {
    if (receipt?.totals?.qty != null) return Number(receipt.totals.qty) || 0
    if (Array.isArray(receipt?.lines)) return receipt.lines.reduce((sum: number, line: any) => sum + (Number(line.qty_received) || 0), 0)
    return fallback
}

export function GrnSmartV36() {
    const { toast } = useToast()
    const { isPinned } = useDashboardChrome()
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
    const [tradingSummary, setTradingSummary] = React.useState({ qty: 0, uom: "PCS", value: 0, valid: false })

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
    const freightAmount = Number(freight) || 0
    const otherChargesAmount = Number(otherCharges) || 0
    const taxableBase = subtotal + freightAmount + otherChargesAmount
    const gst = taxableBase * (Number(gstPct) / 100)
    const grandTotal = taxableBase + gst

    const totalQty = items.reduce((s, i) => s + lineQty(i), 0)

    const queryError = vendorsQ.error || locationsQ.error || materialsQ.error || gradesQ.error || granuleCodesQ.error || openPurchaseOrdersQ.error || selectedPoQ.error
    const lineComplete = React.useCallback((line: ItemDraft) => {
        const material = (materials as any[]).find((m) => String(m.code) === String(line.material_code))
        if (!line.material_code || lineQty(line) <= 0) return false
        if (klass === "ROLL") {
            if (!line.width_mm || !line.thickness_um) return false
            if (isExtrudableFilm(material) && !line.grade) return false
        }
        return true
    }, [klass, lineQty, materials])
    const valid = !!warehouseId && !!vendorId && items.every(lineComplete) && (sourceType !== "PO" || (!!poId && items.every((i) => i.po_item_id)))

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
        if (next === "TRADING") setSourceType("DIRECT")
        setTradingSummary({ qty: 0, uom: "PCS", value: 0, valid: false })
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
                        stock_form: line.stock_form || "OPEN_WEB",
                        width_basis: line.width_basis || widthBasisForStockForm(line.stock_form),
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
                lines: items.map(({ id, ...rest }) => {
                    const material = materials.find((entry) => String(entry.code) === String(rest.material_code))
                    return {
                        material_code: rest.material_code,
                        grade_id: klass === "ROLL" ? rest.grade || undefined : undefined,
                        granule_code_id: klass === "BULK" ? rest.granule_code_id || undefined : undefined,
                        location_id: rest.location || warehouseId,
                        qty: lineQty(rest),
                        uom: resolvedReceiptUom(rest.uom, material, klass),
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
                        stock_form: klass === "ROLL" ? (rest.stock_form || "OPEN_WEB") : undefined,
                        width_basis: klass === "ROLL" ? (rest.width_basis || widthBasisForStockForm(rest.stock_form)) : undefined,
                    }
                }),
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

    const footerTotalQty = klass === "TRADING" ? tradingSummary.qty : totalQty
    const footerValue = klass === "TRADING" ? tradingSummary.value : grandTotal
    const footerSubtotal = klass === "TRADING" ? tradingSummary.value : subtotal
    const footerGst = klass === "TRADING" ? 0 : gst
    const footerFreightCharges = klass === "TRADING" ? 0 : (freightAmount + otherChargesAmount)
    const footerUom = klass === "ROLL" ? "KG" : klass === "TRADING" ? tradingSummary.uom || "PCS" : items[0]?.uom || "units"
    const footerReady = klass === "TRADING" ? !!vendorId && !!warehouseId && tradingSummary.valid : valid
    const footerLineCount = klass === "TRADING" ? 1 : items.length
    const footerIncompleteCount = klass === "TRADING"
        ? (tradingSummary.valid ? 0 : 1)
        : items.filter((item) => !lineComplete(item)).length
    const footerChecks = [
        { label: "Vendor", ok: !!vendorId },
        { label: "Warehouse", ok: !!warehouseId },
        ...(sourceType === "PO" ? [{ label: "System PO", ok: !!poId }] : []),
        { label: klass === "TRADING" ? "Receipt row" : "Materials", ok: klass === "TRADING" ? tradingSummary.valid : items.every((i) => i.material_code) },
        { label: "Qty", ok: klass === "TRADING" ? tradingSummary.qty > 0 : items.every((i) => lineQty(i) > 0) },
        { label: "Period", ok: true },
    ]

    return (
        <div data-testid="smart-grn" className="w-full max-w-none space-y-4 pb-48">
            {/* Header */}
            <div className="flex items-center justify-between">
                <Link href="/inventory" className="inline-flex items-center gap-1 text-xs font-bold text-content-3 hover:text-blue-700">← Stock workspace</Link>
                <span className="rounded-full bg-success-bg px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-success-fg ring-1 ring-emerald-200">UNIFIED FORM</span>
            </div>
            {queryError && (
                <div className="rounded-2xl border border-danger-border bg-danger-bg px-4 py-3 text-xs text-rose-800">
                    <div className="font-bold">Master data did not load.</div>
                    <div className="mt-0.5">{describeApiError(queryError, "Check backend and retry.")}</div>
                </div>
            )}
            {lastPosted && (
                <div
                    data-testid="smart-grn-confirmation"
                    className="rounded-2xl border border-success-border bg-success-bg px-4 py-3 text-sm text-emerald-900 shadow-sm ring-1 ring-emerald-100"
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
                            className="h-8 rounded-lg border-success-border bg-surface-1 text-xs font-bold text-success-fg hover:bg-emerald-100"
                        >
                            Clear
                        </Button>
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-3">
                        <div className="rounded-lg border border-success-border bg-surface-1 px-2 py-1.5">
                            <div className="font-black uppercase tracking-wider text-emerald-600">PO linkage</div>
                            <div className="font-mono text-content-2">
                                {sourceType === "PO" ? `System PO: ${poId || "—"}` : sourceType === "MANUAL_PO" ? `Manual ref: ${manualPoRef || "—"}` : "Direct receipt"}
                            </div>
                        </div>
                        <div className="rounded-lg border border-success-border bg-surface-1 px-2 py-1.5">
                            <div className="font-black uppercase tracking-wider text-emerald-600">Goods received</div>
                            <div className="font-mono text-content-2">{lastPosted.total_qty.toLocaleString()} {lastPosted.uom}</div>
                        </div>
                        <div className="rounded-lg border border-success-border bg-surface-1 px-2 py-1.5">
                            <div className="font-black uppercase tracking-wider text-emerald-600">Invoice (dedup OK)</div>
                            <div className="font-mono text-content-2">{vendorInvoiceNo || "—"} {vendorInvoiceDate ? `· ${vendorInvoiceDate}` : ""}</div>
                        </div>
                    </div>
                    <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-white">
                        {sourceType === "PO" ? "FULLY MATCHED" : sourceType === "MANUAL_PO" ? "MANUAL PO MATCH" : "NO PO"}
                    </div>
                </div>
            )}

            {/* Hero */}
            <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-600 via-teal-600 to-cyan-600 px-5 py-4 text-white shadow-2xl shadow-emerald-500/20">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.28em] text-white/70">GRN · goods receipt note</div>
                        <h2 className="font-display mt-1 text-2xl font-bold leading-tight">Receive goods at spreadsheet speed</h2>
                        <p className="mt-1 max-w-5xl text-sm text-white/80">One invoice can carry many rolls or materials. Use the full-width grid below; readiness, totals, GST, freight, incomplete rows, and post action stay in the sticky bottom bar.</p>
                    </div>
                </div>
            </section>

            <main className="space-y-5">
                    {/* 1 — Class picker */}
                    <Section idx={1} eyebrow="What are you receiving?" title="Pick the stock class" tone="emerald">
                        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
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
                                            {safeSelectRows(openPurchaseOrders, (po: PurchaseOrderListItem) => po.id).map((po: PurchaseOrderListItem) => (
                                                <SelectItem key={safeSelectValue(po.id)} value={safeSelectValue(po.id)}>
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
                                                <div className="mt-1 font-bold text-warning-fg">No open {klass.toLowerCase()} lines on this PO. Pick another stock class or PO.</div>
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
                                        {safeSelectRows(vendors as Vendor[], (v) => v.id).map((v) => <SelectItem key={safeSelectValue(v.id)} value={safeSelectValue(v.id)}>{v.name}</SelectItem>)}
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
                                        {safeSelectRows(locations as Location[], (l) => l.id).map((l) => <SelectItem key={safeSelectValue(l.id)} value={safeSelectValue(l.id)}>{locationLabel(l)}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </Field>
                        </div>
                    </Section>

                    {klass === "TRADING" && (
                    <Section idx={3} eyebrow="Items received" title="What did you actually receive?" tone="violet" bodyClassName="px-0 py-0">
                            <TradingReceiptPanel
                                vendorId={vendorId}
                                warehouseLocations={locations as Location[]}
                                warehouseId={warehouseId}
                                vendorInvoiceNo={vendorInvoiceNo}
                                vendorInvoiceDate={vendorInvoiceDate}
                                lrVehicle={lrVehicle}
                                onSummaryChange={setTradingSummary}
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
                    <Section idx={3} eyebrow="Items received" title="What did you actually receive?" tone="violet" bodyClassName="px-0 py-0"
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
                                {klass !== "ROLL" && (
                                    <Button size="sm" variant="outline" disabled={sourceType === "PO"} onClick={() => setItems([...items, FRESH_ITEM()])} className="rounded-lg gap-1.5"><Plus className="h-3 w-3" /> Add line</Button>
                                )}
                            </div>
                        }>
                        <div className="space-y-3">
                            {klass === "BULK" && (
                                <div className="px-3 pt-3 sm:px-4">
                                    <BulkMaterialFilterChips
                                        value={bulkMaterialFilter}
                                        onChange={setBulkMaterialFilter}
                                        materials={materials as any[]}
                                    />
                                </div>
                            )}
                            {klass === "ROLL" && rollUploadPreview && (
                                <div className="m-3 rounded-2xl border border-success-border bg-success-bg p-4 text-sm text-emerald-950 shadow-sm sm:m-4">
                                    <div className="flex flex-col gap-3 border-b border-success-border pb-3 sm:flex-row sm:items-center sm:justify-between">
                                        <div>
                                            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-success-fg">Excel validated · review before posting</div>
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
                                                className="rounded-lg border-success-border bg-surface-1 text-emerald-800 hover:bg-emerald-100"
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
                                    <div className="mt-3 overflow-x-auto rounded-xl border border-emerald-100 bg-surface-1">
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
                            {rollReviewRows.length === 0 && klass === "ROLL" && (
                                <RollFastEntryGrid
                                    items={items}
                                    materials={materials as any[]}
                                    locations={locations as Location[]}
                                    grades={(gradesQ.data || []) as RecipeGrade[]}
                                    defaultLocationId={warehouseId}
                                    lockedToPo={sourceType === "PO"}
                                    onChange={setItems}
                                />
                            )}
                            {rollReviewRows.length === 0 && klass !== "ROLL" && (
                                <ReceiptFastEntryGrid
                                    klass={klass}
                                    items={items}
                                    materials={materials as any[]}
                                    locations={locations as Location[]}
                                    granuleCodes={(granuleCodesQ.data || []) as GranuleQualityCode[]}
                                    bulkMaterialFilter={bulkMaterialFilter}
                                    defaultLocationId={warehouseId}
                                    lockedToPo={sourceType === "PO"}
                                    onChange={setItems}
                                />
                            )}
                        </div>
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
                                    <label className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-surface-1 px-3 text-sm shadow-sm cursor-pointer">
                                        <input type="checkbox" checked={coaAttached} onChange={(e) => setCoaAttached(e.target.checked)} className="h-4 w-4 rounded text-emerald-600" />
                                        <span>COA attached</span>
                                    </label>
                                </Field>
                                <Field label="In-house QC">
                                    <label className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-surface-1 px-3 text-sm shadow-sm cursor-pointer">
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
                            <div className="rounded-xl border border-warning-border bg-warning-bg px-3 py-2 text-xs text-amber-900">
                                QC and document details are optional. Open this only when COA, lab values, or inspector notes are needed.
                            </div>
                        )}
                    </Section>
                    )}

                    {/* 5 — Financials */}
                    {klass !== "TRADING" && (
                    <Section idx={5} eyebrow="Financials" title="Costs &amp; taxes" tone="blue">
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                            <Field label="Material subtotal">
                                <div className="flex h-10 items-center justify-end rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-mono shadow-sm">₹{subtotal.toLocaleString()}</div>
                            </Field>
                            <Field label="GST %"><Input value={gstPct} onChange={(e) => setGstPct(e.target.value)} className="h-10 rounded-xl border-slate-200 font-mono shadow-sm" /></Field>
                            <Field label="GST">
                                <div className="flex h-10 items-center justify-end rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-mono shadow-sm">₹{gst.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                            </Field>
                            <Field label="Freight"><Input value={freight} onChange={(e) => setFreight(e.target.value)} className="h-10 rounded-xl border-slate-200 font-mono shadow-sm" /></Field>
                            <Field label="Other charges"><Input value={otherCharges} onChange={(e) => setOtherCharges(e.target.value)} className="h-10 rounded-xl border-slate-200 font-mono shadow-sm" /></Field>
                            <Field label="Taxable base">
                                <div className="flex h-10 items-center justify-end rounded-xl border border-blue-200 bg-blue-50 px-3 text-sm font-mono font-bold text-blue-700 shadow-sm">₹{taxableBase.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                            </Field>
                            <Field label="Grand total">
                                <div className="flex h-10 items-center justify-end rounded-xl border border-success-border bg-success-bg px-3 text-sm font-mono font-bold text-success-fg shadow-sm">₹{grandTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
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

            {/* Sticky footer */}
            <div className={cn("fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 shadow-[0_-18px_50px_rgba(15,23,42,0.12)] backdrop-blur", isPinned ? "lg:left-[304px]" : "lg:left-[86px]")}>
                <div className="mx-auto grid max-w-none gap-2 px-3 py-2 sm:px-5">
                    <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
                        <span className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Live totals</span>
                        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 font-bold uppercase text-slate-700 ring-1 ring-slate-200">{klass}</span>
                        <span className="rounded-full bg-blue-100 px-2.5 py-0.5 font-bold text-blue-700 ring-1 ring-blue-200">{footerLineCount} lines · {footerTotalQty.toLocaleString()} {footerUom}</span>
                        <span className={cn("rounded-full px-2.5 py-0.5 font-bold ring-1", footerIncompleteCount ? "bg-warning-bg text-warning-fg ring-amber-200" : "bg-success-bg text-success-fg ring-emerald-200")}>
                            {footerIncompleteCount ? `${footerIncompleteCount} incomplete` : "all rows valid"}
                        </span>
                        <span className="rounded-full bg-success-bg px-2.5 py-0.5 font-bold text-success-fg ring-1 ring-emerald-200">Sub ₹{footerSubtotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                        {klass !== "TRADING" && <span className="rounded-full bg-violet-50 px-2.5 py-0.5 font-bold text-violet-700 ring-1 ring-violet-200">GST ₹{footerGst.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>}
                        {klass !== "TRADING" && <span className="rounded-full bg-warning-bg px-2.5 py-0.5 font-bold text-warning-fg ring-1 ring-amber-200">Freight/other ₹{footerFreightCharges.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>}
                        <span className="rounded-full bg-[#10233f] px-2.5 py-0.5 font-bold text-white ring-1 ring-blue-900/40">Total ₹{footerValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                    </div>
                    <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-xs">
                            <span className={cn("rounded-full px-2.5 py-0.5 font-black uppercase ring-1 ring-inset", footerReady ? "bg-emerald-100 text-success-fg ring-emerald-200" : "bg-rose-100 text-danger-fg ring-rose-200")}>
                                {footerReady ? "Ready to post" : "Needs info"}
                            </span>
                            {footerChecks.map((check) => (
                                <span
                                    key={check.label}
                                    className={cn(
                                        "rounded-full px-2 py-0.5 text-[10px] font-black ring-1",
                                        check.ok ? "bg-success-bg text-success-fg ring-emerald-200" : "bg-danger-bg text-danger-fg ring-rose-200"
                                    )}
                                >
                                    {check.ok ? "✓" : "×"} {check.label}
                                </span>
                            ))}
                        </div>
                        <div className="flex items-center justify-end gap-2">
                        <Link href="/inventory" className="rounded-xl border border-slate-200 bg-surface-1 px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm">Cancel</Link>
                        <Button variant="outline" className="rounded-xl border-blue-200 bg-blue-50 text-blue-700 shadow-sm">📂 Save draft</Button>
                        {klass === "TRADING" ? (
                            <span className="rounded-xl bg-violet-50 px-3 py-2 text-xs font-bold text-violet-700 ring-1 ring-violet-200">Post from trading row</span>
                        ) : (
                            <Button data-testid="smart-grn-submit" onClick={() => submitMutation.mutate()} disabled={!valid || submitMutation.isPending} className="gap-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 shadow-md">
                                {submitMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                                Submit &amp; post
                                <ArrowRight className="h-4 w-4" />
                            </Button>
                        )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

// ─── Sub-components ───────────────────────────────────────────────

function Section({ idx, eyebrow, title, tone, actions, children, bodyClassName }: { idx: number; eyebrow: string; title: string; tone: "blue" | "violet" | "emerald" | "amber" | "slate"; actions?: React.ReactNode; children: React.ReactNode; bodyClassName?: string }) {
    const TONE = {
        blue: { bar: "border-l-blue-500", bg: "from-blue-50/80", num: "bg-blue-600 ring-blue-700" },
        violet: { bar: "border-l-violet-500", bg: "from-violet-50/80", num: "bg-violet-600 ring-violet-700" },
        emerald: { bar: "border-l-emerald-500", bg: "from-emerald-50/80", num: "bg-emerald-600 ring-emerald-700" },
        amber: { bar: "border-l-amber-500", bg: "from-amber-50/60", num: "bg-amber-500 ring-amber-600" },
        slate: { bar: "border-l-slate-400", bg: "from-slate-50/80", num: "bg-slate-500 ring-slate-600" },
    }[tone]
    return (
        <section className={cn("overflow-hidden rounded-2xl border border-slate-200/60 bg-surface-1 shadow-md ring-1 ring-slate-100/50 border-l-[3px]", TONE.bar)}>
            <header className={cn("flex items-start justify-between gap-3 border-b border-slate-100 bg-gradient-to-r via-white to-white px-5 py-3.5", TONE.bg)}>
                <div className="flex items-start gap-3">
                    <span className={cn("flex h-7 w-7 flex-none items-center justify-center rounded-lg text-white text-xs font-bold shadow-sm ring-1", TONE.num)}>{idx}</span>
                    <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-content-4">{eyebrow}</div>
                        <h2 className="text-[15px] font-bold text-slate-900">{title}</h2>
                    </div>
                </div>
                {actions}
            </header>
            <div className={cn("px-5 py-4", bodyClassName)}>{children}</div>
        </section>
    )
}

function ClassTile({ id, icon, label, desc, active, onClick }: { id: ClassKind; icon: React.ReactNode; label: string; desc: string; active: boolean; onClick: () => void }) {
    return (
        <button data-testid={`smart-grn-class-${id}`} onClick={onClick} className={cn("flex flex-col gap-2 rounded-2xl border px-4 py-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md", active ? "border-emerald-400 bg-gradient-to-br from-emerald-50 to-white ring-2 ring-emerald-200" : "border-slate-200 bg-surface-1")}>
            <div className="flex items-center gap-2">
                <span className={cn("flex h-9 w-9 items-center justify-center rounded-xl shadow-sm ring-1 ring-current/20", active ? "bg-emerald-600 text-white" : "bg-slate-100 text-content-3")}>{icon}</span>
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
        <button onClick={onClick} className={cn("rounded-lg px-3 py-1.5 text-xs font-bold shadow-sm transition", active ? "bg-gradient-to-r from-emerald-600 to-teal-600 text-white" : "bg-surface-1 text-slate-700 ring-1 ring-slate-200")}>{children}</button>
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
                                : "border-violet-200 bg-surface-1 text-violet-700 hover:border-violet-400"
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

function RollFastEntryGrid({
    items,
    materials,
    locations,
    grades,
    defaultLocationId,
    lockedToPo,
    onChange,
}: {
    items: ItemDraft[]
    materials: any[]
    locations: Location[]
    grades: RecipeGrade[]
    defaultLocationId: string
    lockedToPo?: boolean
    onChange: (items: ItemDraft[]) => void
}) {
    const rollMaterials = React.useMemo(() => {
        return materials
            .filter((material) => materialMatchesReceiptClass(material, "ROLL"))
            .sort((a, b) => String(a.code || "").localeCompare(String(b.code || "")))
    }, [materials])

    const totalKg = items.reduce((sum, item) => sum + (Number(item.net_weight_kg || item.qty) || 0), 0)
    const totalValue = items.reduce((sum, item) => sum + ((Number(item.net_weight_kg || item.qty) || 0) * (Number(item.unit_cost) || 0)), 0)
    const incomplete = items.filter((item) => !isRollRowComplete(item, materials)).length

    const patch = React.useCallback((index: number, rowPatch: Partial<ItemDraft>) => {
        onChange(items.map((item, rowIndex) => rowIndex === index ? { ...item, ...rowPatch } : item))
    }, [items, onChange])

    const addRow = React.useCallback((seed?: Partial<ItemDraft>) => {
        onChange([
            ...items,
            {
                ...FRESH_ITEM(),
                ...seed,
                id: `it-${Math.random().toString(36).slice(2, 8)}`,
                po_item_id: undefined,
                net_weight_kg: "",
                gross_weight_kg: "",
                tare_weight_kg: "",
                qty: "",
                location: seed?.location || defaultLocationId || "",
            },
        ])
    }, [defaultLocationId, items, onChange])

    const addRows = React.useCallback((count: number) => {
        const seed = items[items.length - 1] || FRESH_ITEM()
        const clones = Array.from({ length: count }).map((_, cloneIndex) => ({
            ...FRESH_ITEM(),
            material_code: seed.material_code,
            grade: seed.grade,
            uom: seed.uom || "KG",
            unit_cost: seed.unit_cost,
            location: seed.location || defaultLocationId || "",
            width_mm: seed.width_mm,
            thickness_um: seed.thickness_um,
            length_m: seed.length_m,
            core_size_inch: seed.core_size_inch,
            stock_form: seed.stock_form || "OPEN_WEB",
            width_basis: seed.width_basis || widthBasisForStockForm(seed.stock_form),
            id: `bulk-roll-${Date.now()}-${cloneIndex}`,
            qty: "",
            net_weight_kg: "",
            gross_weight_kg: "",
            tare_weight_kg: "",
        }))
        onChange([...items, ...clones])
        window.setTimeout(() => {
            const next = document.querySelector<HTMLInputElement>(`[data-roll-gross-row="${items.length}"]`)
            next?.focus()
            next?.select()
        }, 0)
    }, [defaultLocationId, items, onChange])

    const removeRow = React.useCallback((index: number) => {
        if (items.length <= 1) return
        onChange(items.filter((_, rowIndex) => rowIndex !== index))
    }, [items, onChange])

    const handleMaterialChange = React.useCallback((index: number, code: string) => {
        const selected = rollMaterials.find((m) => String(m.code) === String(code))
        patch(index, {
            material_code: code,
            grade: "",
            uom: resolvedReceiptUom(items[index]?.uom, selected, "ROLL"),
        })
    }, [items, patch, rollMaterials])

    const handleWeightChange = React.useCallback((index: number, value: string) => {
        patch(index, { net_weight_kg: value, qty: value })
    }, [patch])

    const handleGrossTareChange = React.useCallback((index: number, key: "gross_weight_kg" | "tare_weight_kg", value: string) => {
        const current = items[index]
        if (!current) return
        const next = { ...current, [key]: value }
        const gross = Number(next.gross_weight_kg || 0)
        const tare = Number(next.tare_weight_kg || 0)
        const rowPatch: Partial<ItemDraft> = { [key]: value }
        if (gross > 0 && tare >= 0 && gross >= tare) {
            const net = Number((gross - tare).toFixed(3))
            rowPatch.net_weight_kg = String(net)
            rowPatch.qty = String(net)
        }
        patch(index, rowPatch)
    }, [items, patch])

    const handleStockFormChange = React.useCallback((index: number, value: StockForm) => {
        patch(index, { stock_form: value, width_basis: widthBasisForStockForm(value) })
    }, [patch])

    const cloneAfter = React.useCallback((index: number) => {
        const current = items[index]
        if (!current) return
        const seed: Partial<ItemDraft> = {
            material_code: current.material_code,
            grade: current.grade,
            uom: current.uom || "KG",
            unit_cost: current.unit_cost,
            location: current.location || defaultLocationId,
            width_mm: current.width_mm,
            thickness_um: current.thickness_um,
            length_m: current.length_m,
            core_size_inch: current.core_size_inch,
            stock_form: current.stock_form || "OPEN_WEB",
            width_basis: current.width_basis || widthBasisForStockForm(current.stock_form),
        }
        const nextRows = [...items]
        nextRows.splice(index + 1, 0, {
            ...FRESH_ITEM(),
            ...seed,
            id: `it-${Math.random().toString(36).slice(2, 8)}`,
            qty: "",
            net_weight_kg: "",
            gross_weight_kg: "",
            tare_weight_kg: "",
        })
        onChange(nextRows)
        window.setTimeout(() => {
            const next = document.querySelector<HTMLInputElement>(`[data-roll-weight-row="${index + 1}"]`)
            next?.focus()
            next?.select()
        }, 0)
    }, [defaultLocationId, items, onChange])

    const fillDown = React.useCallback((index: number, key: keyof ItemDraft) => {
        const value = items[index]?.[key]
        if (value == null) return
        onChange(items.map((item, rowIndex) => rowIndex > index ? { ...item, [key]: value } : item))
    }, [items, onChange])

    const handlePaste = React.useCallback((event: React.ClipboardEvent<HTMLDivElement>) => {
        const text = event.clipboardData.getData("text")
        if (!text || !text.includes("\n")) return
        const parsedRows = text
            .trim()
            .split(/\r?\n/)
            .map((line) => line.split("\t"))
            .filter((cols) => cols.some((value) => String(value || "").trim()))
        if (!parsedRows.length) return
        event.preventDefault()
        const expanded = parsedRows.map((cols, index) => {
            const material = rollMaterials.find((m) =>
                String(m.code).toUpperCase() === String(cols[0] || "").trim().toUpperCase() ||
                String(m.name || "").toUpperCase() === String(cols[0] || "").trim().toUpperCase()
            )
            const rawStockForm = String(cols[1] || "").trim().toUpperCase().replace(/[\s-]+/g, "_")
            const hasStockFormColumn = ["OPEN_WEB", "SHEET", "LAYFLAT_TUBE", "LAY_FLAT_TUBE", "TUBE", "FOLDED_WEB", "FOLDED"].includes(rawStockForm)
            const stockForm = hasStockFormColumn
                ? (rawStockForm === "SHEET" ? "OPEN_WEB" : rawStockForm === "TUBE" || rawStockForm === "LAY_FLAT_TUBE" ? "LAYFLAT_TUBE" : rawStockForm === "FOLDED" ? "FOLDED_WEB" : rawStockForm) as StockForm
                : "OPEN_WEB"
            const widthCol = hasStockFormColumn ? 2 : 1
            const micronCol = hasStockFormColumn ? 3 : 2
            const grossCol = hasStockFormColumn ? 4 : 3
            const tareCol = hasStockFormColumn ? 5 : 4
            const netCol = hasStockFormColumn ? 6 : 5
            const lengthCol = hasStockFormColumn ? 7 : 6
            const gradeCol = hasStockFormColumn ? 8 : 7
            const locationCol = hasStockFormColumn ? 9 : 8
            const rateCol = hasStockFormColumn ? 10 : 9
            const newGrossTareFormat = cols.length >= (hasStockFormColumn ? 11 : 10)
            const grossValue = newGrossTareFormat ? String(cols[grossCol] || "").trim() : ""
            const tareValue = newGrossTareFormat ? String(cols[tareCol] || "").trim() : ""
            const computedNet = Number(grossValue) > 0 && Number(tareValue) >= 0 && Number(grossValue) >= Number(tareValue)
                ? String(Number((Number(grossValue) - Number(tareValue)).toFixed(3)))
                : ""
            const net = newGrossTareFormat ? String(cols[netCol] || computedNet).trim() : String(cols[grossCol] || "").trim()
            const lengthValue = newGrossTareFormat ? String(cols[lengthCol] || "").trim() : String(cols[hasStockFormColumn ? 5 : 4] || "").trim()
            const gradeValue = newGrossTareFormat ? String(cols[gradeCol] || "").trim() : String(cols[hasStockFormColumn ? 6 : 5] || "").trim()
            const locationValue = newGrossTareFormat ? String(cols[locationCol] || "").trim() : String(cols[hasStockFormColumn ? 7 : 6] || "").trim()
            const rateValue = newGrossTareFormat ? String(cols[rateCol] || "").trim() : String(cols[hasStockFormColumn ? 8 : 7] || "").trim()
            const grade = grades.find((g) =>
                String(g.name || "").toUpperCase() === gradeValue.toUpperCase() ||
                String((g as any).code || "").toUpperCase() === gradeValue.toUpperCase()
            )
            const location = locations.find((loc) =>
                String(loc.code || "").toUpperCase() === locationValue.toUpperCase() ||
                String(loc.name || "").toUpperCase() === locationValue.toUpperCase()
            )
            return {
                ...FRESH_ITEM(),
                id: `paste-${Date.now()}-${index}`,
                material_code: material?.code || String(cols[0] || "").trim(),
                width_mm: String(cols[widthCol] || "").trim(),
                thickness_um: String(cols[micronCol] || "").trim(),
                gross_weight_kg: grossValue,
                tare_weight_kg: tareValue,
                net_weight_kg: net,
                qty: net,
                length_m: lengthValue,
                grade: grade?.id || "",
                location: location?.id || defaultLocationId || "",
                unit_cost: rateValue,
                uom: resolvedReceiptUom(undefined, material, "ROLL"),
                stock_form: stockForm,
                width_basis: widthBasisForStockForm(stockForm),
            } satisfies ItemDraft
        })
        onChange(expanded)
    }, [defaultLocationId, grades, locations, onChange, rollMaterials])

    const handleCellKeyDown = React.useCallback((event: React.KeyboardEvent, index: number, key?: keyof ItemDraft) => {
        if (event.key === "Enter") {
            event.preventDefault()
            cloneAfter(index)
            return
        }
        if (event.altKey && event.key === "ArrowDown" && key) {
            event.preventDefault()
            fillDown(index, key)
        }
    }, [cloneAfter, fillDown])

    return (
        <div className="overflow-hidden rounded-2xl border border-success-border bg-surface-1 shadow-sm" onPaste={handlePaste}>
            <div className="flex flex-col gap-3 border-b border-emerald-100 bg-emerald-50/60 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.22em] text-success-fg">Fast roll entry</div>
                    <div className="mt-1 text-sm font-semibold text-slate-700">
                        Fill row 1, then press Enter in net kg to clone the next roll. Gross minus tare auto-fills net. Paste from Excel: material, stock form, width, micron, gross, tare, net, length, grade, location, rate.
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" variant="outline" size="sm" className="h-8 rounded-lg bg-surface-1" onClick={() => addRow(items[items.length - 1])} disabled={lockedToPo}>
                        <Plus className="mr-1 h-3 w-3" /> Clone row
                    </Button>
                    <Button type="button" variant="outline" size="sm" className="h-8 rounded-lg bg-[#10233f] text-white hover:bg-[#18375f] hover:text-white" onClick={() => addRows(10)} disabled={lockedToPo}>
                        <Plus className="mr-1 h-3 w-3" /> Add 10 rows
                    </Button>
                </div>
            </div>
            <div className="max-h-[64vh] overflow-auto">
                <table className="min-w-[1780px] text-left text-[11px]">
                    <thead className="sticky top-0 z-10 bg-slate-50 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500 shadow-sm">
                        <tr>
                            <th className="w-12 px-2 py-2">#</th>
                            <th className="w-[260px] px-2 py-2">Film variant</th>
                            <th className="w-[150px] px-2 py-2">Stock form</th>
                            <th className="w-[120px] px-2 py-2">Width</th>
                            <th className="w-[110px] px-2 py-2">Micron</th>
                            <th className="w-[120px] px-2 py-2">Gross kg</th>
                            <th className="w-[110px] px-2 py-2">Tare kg</th>
                            <th className="w-[120px] px-2 py-2">Net kg auto</th>
                            <th className="w-[120px] px-2 py-2">Length m</th>
                            <th className="w-[180px] px-2 py-2">Grade</th>
                            <th className="w-[220px] px-2 py-2">Location</th>
                            <th className="w-[120px] px-2 py-2">Rate / kg</th>
                            <th className="w-[80px] px-2 py-2">State</th>
                            <th className="w-12 px-2 py-2"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.map((item, index) => {
                            const material = materials.find((m) => String(m.code) === String(item.material_code))
                            const needsGrade = isExtrudableFilm(material)
                            const complete = isRollRowComplete(item, materials)
                            const locationValue = item.location || defaultLocationId || "__none__"
                            return (
                                <tr key={item.id} className={cn("border-t border-slate-100 align-middle", complete ? "bg-emerald-50/25" : "bg-surface-1")}>
                                    <td className="px-2 py-2 font-mono font-black text-slate-500">{index + 1}</td>
                                    <td className="px-2 py-2">
                                        <MaterialPicker
                                            items={materialPickerItems(rollMaterials, "ROLL")}
                                            value={item.material_code}
                                            onValueChange={(code) => handleMaterialChange(index, code)}
                                            disabled={lockedToPo}
                                            placeholder="Search film variant"
                                            testId={`smart-grn-line-${index}-material`}
                                            className="h-8 rounded-lg font-mono text-[11px]"
                                        />
                                    </td>
                                    <td className="px-2 py-2">
                                        <Select value={item.stock_form || "OPEN_WEB"} onValueChange={(value) => handleStockFormChange(index, value as StockForm)}>
                                            <SelectTrigger className="h-8 rounded-lg border-slate-200 text-[11px]"><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="OPEN_WEB">Open web</SelectItem>
                                                <SelectItem value="LAYFLAT_TUBE">Lay-flat tube</SelectItem>
                                                <SelectItem value="FOLDED_WEB">Folded web</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </td>
                                    <td className="px-2 py-2">
                                        <Input data-testid={`smart-grn-line-${index}-width`} value={item.width_mm || ""} onChange={(e) => patch(index, { width_mm: e.target.value })} onKeyDown={(e) => handleCellKeyDown(e, index, "width_mm")} placeholder={item.stock_form === "LAYFLAT_TUBE" ? "lay-flat" : "open web"} className="h-8 rounded-lg border-slate-200 font-mono text-[11px]" />
                                    </td>
                                    <td className="px-2 py-2">
                                        <Input data-testid={`smart-grn-line-${index}-thickness`} value={item.thickness_um || ""} onChange={(e) => patch(index, { thickness_um: e.target.value })} onKeyDown={(e) => handleCellKeyDown(e, index, "thickness_um")} className="h-8 rounded-lg border-slate-200 font-mono text-[11px]" />
                                    </td>
                                    <td className="px-2 py-2">
                                        <Input data-testid={`smart-grn-line-${index}-gross`} data-roll-gross-row={index} value={item.gross_weight_kg || ""} onChange={(e) => handleGrossTareChange(index, "gross_weight_kg", e.target.value)} onKeyDown={(e) => handleCellKeyDown(e, index, "gross_weight_kg")} className="h-8 rounded-lg border-slate-200 font-mono text-[11px]" />
                                    </td>
                                    <td className="px-2 py-2">
                                        <Input data-testid={`smart-grn-line-${index}-tare`} data-roll-tare-row={index} value={item.tare_weight_kg || ""} onChange={(e) => handleGrossTareChange(index, "tare_weight_kg", e.target.value)} onKeyDown={(e) => handleCellKeyDown(e, index, "tare_weight_kg")} className="h-8 rounded-lg border-slate-200 font-mono text-[11px]" />
                                    </td>
                                    <td className="px-2 py-2">
                                        <Input data-testid={`smart-grn-line-${index}-qty`} data-roll-weight-row={index} data-roll-net-row={index} value={item.net_weight_kg || item.qty || ""} onChange={(e) => handleWeightChange(index, e.target.value)} onKeyDown={(e) => handleCellKeyDown(e, index, "net_weight_kg")} className="h-8 rounded-lg border-success-border bg-emerald-50/40 font-mono text-[11px] font-black" />
                                    </td>
                                    <td className="px-2 py-2">
                                        <Input value={item.length_m || ""} onChange={(e) => patch(index, { length_m: e.target.value })} onKeyDown={(e) => handleCellKeyDown(e, index, "length_m")} className="h-8 rounded-lg border-slate-200 font-mono text-[11px]" />
                                    </td>
                                    <td className="px-2 py-2">
                                        <Select value={item.grade || "__none__"} onValueChange={(value) => patch(index, { grade: value === "__none__" ? "" : value })}>
                                            <SelectTrigger className={cn("h-8 rounded-lg border-slate-200 text-[11px]", needsGrade && !item.grade && "border-amber-300 bg-warning-bg")}>
                                                <SelectValue placeholder={needsGrade ? "Required" : "Optional"} />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="__none__">{needsGrade ? "Pick grade" : "No grade"}</SelectItem>
                                                {safeSelectRows(grades, (grade) => grade.id).map((grade) => <SelectItem key={safeSelectValue(grade.id)} value={safeSelectValue(grade.id)}>{grade.name}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                    </td>
                                    <td className="px-2 py-2">
                                        <Select value={locationValue} onValueChange={(value) => patch(index, { location: value === "__none__" ? "" : value })}>
                                            <SelectTrigger className={cn("h-8 rounded-lg border-slate-200 text-[11px]", item.location && defaultLocationId && item.location !== defaultLocationId && "border-amber-300 bg-warning-bg")}>
                                                <SelectValue placeholder="Header default" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="__none__" disabled>Pick location</SelectItem>
                                                {safeSelectRows(locations, (location) => location.id).map((location) => <SelectItem key={safeSelectValue(location.id)} value={safeSelectValue(location.id)}>{locationLabel(location)}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                    </td>
                                    <td className="px-2 py-2">
                                        <Input data-testid={`smart-grn-line-${index}-unit-cost`} value={item.unit_cost || ""} onChange={(e) => patch(index, { unit_cost: e.target.value })} onKeyDown={(e) => handleCellKeyDown(e, index, "unit_cost")} className="h-8 rounded-lg border-slate-200 font-mono text-[11px]" />
                                    </td>
                                    <td className="px-2 py-2">
                                        <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider", complete ? "bg-emerald-100 text-success-fg" : "bg-amber-100 text-warning-fg")}>
                                            {complete ? "Ready" : "Fill"}
                                        </span>
                                    </td>
                                    <td className="px-2 py-2">
                                        <Button type="button" variant="ghost" size="sm" className="h-8 w-8 rounded-lg p-0 text-rose-600" onClick={() => removeRow(index)} disabled={items.length <= 1 || lockedToPo}>
                                            <X className="h-3.5 w-3.5" />
                                        </Button>
                                    </td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>
            <div className="flex flex-col gap-2 border-t border-slate-100 bg-surface-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-[11px] font-semibold text-content-3">
                    Width follows stock form: open web = full sheet width; tube = lay-flat width. Tube/folded rolls are exact-width allocation only. Gross - tare writes net kg automatically.
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-black">
                    <span className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-content-3">{items.length} rolls</span>
                    <span className="rounded-lg border border-success-border bg-success-bg px-2.5 py-1 text-emerald-800">{totalKg.toLocaleString(undefined, { maximumFractionDigits: 3 })} net kg</span>
                    <span className={cn("rounded-lg border px-2.5 py-1", incomplete ? "border-warning-border bg-warning-bg text-amber-800" : "border-success-border bg-success-bg text-emerald-800")}>{incomplete} incomplete</span>
                </div>
            </div>
        </div>
    )
}

function isRollRowComplete(item: ItemDraft, materials: any[]) {
    const material = materials.find((m) => String(m.code) === String(item.material_code))
    if (!item.material_code || !(Number(item.net_weight_kg || item.qty) > 0)) return false
    if (!(Number(item.width_mm) > 0) || !(Number(item.thickness_um) > 0)) return false
    if (isExtrudableFilm(material) && !item.grade) return false
    return true
}

function FastStat({ label, value, tone }: { label: string; value: string; tone: "slate" | "emerald" | "amber" }) {
    const toneClass = tone === "emerald" ? "border-success-border bg-success-bg text-emerald-800" : tone === "amber" ? "border-warning-border bg-warning-bg text-amber-800" : "border-slate-200 bg-surface-1 text-slate-700"
    return (
        <div className={cn("rounded-lg border px-3 py-1.5", toneClass)}>
            <div className="text-[9px] font-black uppercase tracking-wider opacity-70">{label}</div>
            <div className="font-mono text-sm font-black">{value}</div>
        </div>
    )
}

function ReceiptFastEntryGrid({
    klass,
    items,
    materials,
    locations,
    granuleCodes,
    bulkMaterialFilter,
    defaultLocationId,
    lockedToPo,
    onChange,
}: {
    klass: Exclude<ClassKind, "ROLL">
    items: ItemDraft[]
    materials: any[]
    locations: Location[]
    granuleCodes: GranuleQualityCode[]
    bulkMaterialFilter: BulkMaterialFilter
    defaultLocationId: string
    lockedToPo?: boolean
    onChange: (items: ItemDraft[]) => void
}) {
    const filteredMaterials = React.useMemo(() => {
        return materials
            .filter((material) => materialMatchesReceiptClass(material, klass))
            .filter((material) => klass !== "BULK" || bulkMaterialFilter === "ALL" || materialCategory(material) === bulkMaterialFilter)
            .sort((a, b) => String(a.code || "").localeCompare(String(b.code || "")))
    }, [bulkMaterialFilter, klass, materials])

    const totalQty = items.reduce((sum, item) => sum + (Number(item.qty) || 0), 0)
    const totalValue = items.reduce((sum, item) => sum + ((Number(item.qty) || 0) * (Number(item.unit_cost) || 0)), 0)
    const incomplete = items.filter((item) => !isReceiptRowComplete(item)).length
    const gridTitle = klass === "PACKAGING" ? "Fast packaging entry" : "Fast bulk entry"
    const pasteHint = klass === "PACKAGING"
        ? "Paste from Excel: material, gross, tare, net/qty, location, rate."
        : "Paste from Excel: material, gross, tare, net/qty, granule code, location, rate."

    const patch = React.useCallback((index: number, rowPatch: Partial<ItemDraft>) => {
        onChange(items.map((item, rowIndex) => rowIndex === index ? { ...item, ...rowPatch } : item))
    }, [items, onChange])

    const addRow = React.useCallback((seed?: Partial<ItemDraft>) => {
        onChange([
            ...items,
            {
                ...FRESH_ITEM(),
                ...seed,
                id: `it-${Math.random().toString(36).slice(2, 8)}`,
                po_item_id: undefined,
                qty: "",
                gross_weight_kg: "",
                tare_weight_kg: "",
                location: seed?.location || defaultLocationId || "",
            },
        ])
    }, [defaultLocationId, items, onChange])

    const addRows = React.useCallback((count: number) => {
        const seed = items[items.length - 1] || FRESH_ITEM()
        const clones = Array.from({ length: count }).map((_, cloneIndex) => ({
            ...FRESH_ITEM(),
            id: `bulk-receipt-${Date.now()}-${cloneIndex}`,
            material_code: seed.material_code,
            granule_code_id: seed.granule_code_id,
            uom: seed.uom,
            unit_cost: seed.unit_cost,
            location: seed.location || defaultLocationId || "",
            qty: "",
            gross_weight_kg: "",
            tare_weight_kg: "",
        }))
        onChange([...items, ...clones])
        window.setTimeout(() => {
            const next = document.querySelector<HTMLInputElement>(`[data-receipt-gross-row="${items.length}"], [data-receipt-qty-row="${items.length}"]`)
            next?.focus()
            next?.select()
        }, 0)
    }, [defaultLocationId, items, onChange])

    const removeRow = React.useCallback((index: number) => {
        if (items.length <= 1) return
        onChange(items.filter((_, rowIndex) => rowIndex !== index))
    }, [items, onChange])

    const handleMaterialChange = React.useCallback((index: number, code: string) => {
        const selected = filteredMaterials.find((m) => String(m.code) === String(code))
        const nextUom = resolvedReceiptUom(items[index]?.uom, selected, klass)
        patch(index, {
            material_code: code,
            po_item_id: lockedToPo ? items[index]?.po_item_id : undefined,
            granule_code_id: "",
            grade: "",
            uom: nextUom,
            gross_weight_kg: isWeightBasedUom(nextUom) ? items[index]?.gross_weight_kg || "" : "",
            tare_weight_kg: isWeightBasedUom(nextUom) ? items[index]?.tare_weight_kg || "" : "",
        })
    }, [filteredMaterials, items, klass, lockedToPo, patch])

    const handleQtyChange = React.useCallback((index: number, value: string) => {
        patch(index, { qty: value })
    }, [patch])

    const handleGrossTareChange = React.useCallback((index: number, key: "gross_weight_kg" | "tare_weight_kg", value: string) => {
        const current = items[index]
        if (!current) return
        const selectedMaterial = materials.find((material) => String(material.code) === String(current.material_code))
        const uom = resolvedReceiptUom(current.uom, selectedMaterial, klass)
        const next = { ...current, [key]: value }
        const rowPatch: Partial<ItemDraft> = { [key]: value }
        if (isWeightBasedUom(uom)) {
            const net = computeNetFromGrossTare(next.gross_weight_kg, next.tare_weight_kg)
            if (net) rowPatch.qty = net
        }
        patch(index, rowPatch)
    }, [items, klass, materials, patch])

    const cloneAfter = React.useCallback((index: number) => {
        const current = items[index]
        if (!current) return
        const nextRows = [...items]
        nextRows.splice(index + 1, 0, {
            ...FRESH_ITEM(),
            id: `it-${Math.random().toString(36).slice(2, 8)}`,
            material_code: current.material_code,
            granule_code_id: current.granule_code_id,
            uom: current.uom,
            unit_cost: current.unit_cost,
            location: current.location || defaultLocationId,
            qty: "",
            gross_weight_kg: "",
            tare_weight_kg: "",
        })
        onChange(nextRows)
        window.setTimeout(() => {
            const next = document.querySelector<HTMLInputElement>(`[data-receipt-qty-row="${index + 1}"]`)
            next?.focus()
            next?.select()
        }, 0)
    }, [defaultLocationId, items, onChange])

    const fillDown = React.useCallback((index: number, key: keyof ItemDraft) => {
        const value = items[index]?.[key]
        if (value == null) return
        onChange(items.map((item, rowIndex) => rowIndex > index ? { ...item, [key]: value } : item))
    }, [items, onChange])

    const handleCellKeyDown = React.useCallback((event: React.KeyboardEvent, index: number, key?: keyof ItemDraft) => {
        if (event.key === "Enter") {
            event.preventDefault()
            cloneAfter(index)
            return
        }
        if (event.altKey && event.key === "ArrowDown" && key) {
            event.preventDefault()
            fillDown(index, key)
        }
    }, [cloneAfter, fillDown])

    const handlePaste = React.useCallback((event: React.ClipboardEvent<HTMLDivElement>) => {
        const text = event.clipboardData.getData("text")
        if (!text || !text.includes("\n")) return
        const parsedRows = text
            .trim()
            .split(/\r?\n/)
            .map((line) => line.split("\t"))
            .filter((cols) => cols.some((value) => String(value || "").trim()))
        if (!parsedRows.length) return
        event.preventDefault()
        const expanded = parsedRows.map((cols, index) => {
            const materialValue = String(cols[0] || "").trim()
            const material = filteredMaterials.find((m) =>
                String(m.code || "").toUpperCase() === materialValue.toUpperCase() ||
                String(m.name || "").toUpperCase() === materialValue.toUpperCase()
            )
            const newGrossTareFormat = klass === "BULK" ? cols.length >= 7 : cols.length >= 6
            const grossValue = newGrossTareFormat ? String(cols[1] || "").trim() : ""
            const tareValue = newGrossTareFormat ? String(cols[2] || "").trim() : ""
            const computedNet = computeNetFromGrossTare(grossValue, tareValue)
            const qtyValue = newGrossTareFormat ? String(cols[3] || computedNet).trim() : String(cols[1] || "").trim()
            const codeValue = klass === "BULK" ? String(cols[newGrossTareFormat ? 4 : 2] || "").trim() : ""
            const locationValue = String(cols[klass === "BULK" ? (newGrossTareFormat ? 5 : 3) : (newGrossTareFormat ? 4 : 2)] || "").trim()
            const rateValue = String(cols[klass === "BULK" ? (newGrossTareFormat ? 6 : 4) : (newGrossTareFormat ? 5 : 3)] || "").trim()
            const granuleCode = granuleCodes.find((code) =>
                String(code.code || "").toUpperCase() === codeValue.toUpperCase() &&
                (!material || String(code.granule || "") === String(material.id || "") || String(code.granule_material_code || "") === String(material.code || ""))
            )
            const location = locations.find((loc) =>
                String(loc.code || "").toUpperCase() === locationValue.toUpperCase() ||
                String(loc.name || "").toUpperCase() === locationValue.toUpperCase()
            )
            return {
                ...FRESH_ITEM(),
                id: `paste-${Date.now()}-${index}`,
                material_code: material?.code || materialValue,
                gross_weight_kg: grossValue,
                tare_weight_kg: tareValue,
                qty: qtyValue,
                granule_code_id: granuleCode?.id || "",
                uom: resolvedReceiptUom(undefined, material, klass),
                location: location?.id || defaultLocationId || "",
                unit_cost: rateValue,
            } satisfies ItemDraft
        })
        onChange(expanded)
    }, [defaultLocationId, filteredMaterials, granuleCodes, klass, locations, onChange])

    return (
        <div className="overflow-hidden rounded-2xl border border-violet-200 bg-surface-1 shadow-sm" onPaste={handlePaste}>
            <div className="flex flex-col gap-3 border-b border-violet-100 bg-violet-50/60 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.22em] text-violet-700">{gridTitle}</div>
                    <div className="mt-1 text-sm font-semibold text-slate-700">
                        One row per received item. Weight-based rows auto-calculate net from gross minus tare; METER/PCS rows use direct received quantity.
                    </div>
                    <div className="mt-1 text-[11px] font-semibold text-slate-500">{pasteHint}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" variant="outline" size="sm" className="h-8 rounded-lg bg-surface-1" onClick={() => addRow(items[items.length - 1])} disabled={lockedToPo}>
                        <Plus className="mr-1 h-3 w-3" /> Clone row
                    </Button>
                    <Button type="button" variant="outline" size="sm" className="h-8 rounded-lg bg-[#10233f] text-white hover:bg-[#18375f] hover:text-white" onClick={() => addRows(10)} disabled={lockedToPo}>
                        <Plus className="mr-1 h-3 w-3" /> Add 10 rows
                    </Button>
                </div>
            </div>
            <div className="max-h-[64vh] overflow-auto">
                <table className="min-w-[1520px] text-left text-[11px]">
                    <thead className="sticky top-0 z-10 bg-slate-50 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500 shadow-sm">
                        <tr>
                            <th className="w-12 px-2 py-2">#</th>
                            <th className="w-[340px] px-2 py-2">Material</th>
                            <th className="w-[170px] px-2 py-2">Code / master UOM</th>
                            <th className="w-[115px] px-2 py-2">Gross</th>
                            <th className="w-[105px] px-2 py-2">Tare</th>
                            <th className="w-[130px] px-2 py-2">Net / qty</th>
                            <th className="w-[110px] px-2 py-2">UOM</th>
                            <th className="w-[260px] px-2 py-2">Location</th>
                            <th className="w-[130px] px-2 py-2">Rate</th>
                            <th className="w-[130px] px-2 py-2">Value</th>
                            <th className="w-[90px] px-2 py-2">State</th>
                            <th className="w-12 px-2 py-2"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.map((item, index) => {
                            const selectedMaterial = materials.find((material) => String(material.code) === String(item.material_code))
                            const selectedCategory = materialCategory(selectedMaterial)
                            const showGranuleCode = klass === "BULK" && selectedCategory === "GRANULE"
                            const selectedGranuleCodes = showGranuleCode
                                ? granuleCodes
                                    .filter((code) =>
                                        String(code.granule || "") === String(selectedMaterial?.id || "") ||
                                        String(code.granule_material_code || "") === String(selectedMaterial?.code || "")
                                    )
                                    .sort((a, b) => String(a.code || "").localeCompare(String(b.code || "")))
                                : []
                            const supportedUoms = supportedUomsForMaterial(selectedMaterial, klass)
                            const rowUom = resolvedReceiptUom(item.uom, selectedMaterial, klass)
                            const usesGrossTare = isWeightBasedUom(rowUom)
                            const complete = isReceiptRowComplete(item)
                            const value = (Number(item.qty) || 0) * (Number(item.unit_cost) || 0)
                            const locationValue = item.location || defaultLocationId || "__none__"
                            return (
                                <tr key={item.id} className={cn("border-t border-slate-100 align-middle", complete ? "bg-violet-50/20" : "bg-surface-1")}>
                                    <td className="px-2 py-2 font-mono font-black text-slate-500">{index + 1}</td>
                                    <td className="px-2 py-2">
                                        <MaterialPicker
                                            items={materialPickerItems(filteredMaterials, klass)}
                                            value={item.material_code}
                                            onValueChange={(code) => handleMaterialChange(index, code)}
                                            disabled={lockedToPo}
                                            placeholder={filteredMaterials.length ? "Search material" : "No material for this filter"}
                                            testId={`smart-grn-line-${index}-material`}
                                            className="h-8 rounded-lg font-mono text-[11px]"
                                        />
                                    </td>
                                    <td className="px-2 py-2">
                                        {showGranuleCode ? (
                                            <Select value={item.granule_code_id || "__none__"} onValueChange={(value) => patch(index, { granule_code_id: value === "__none__" ? "" : value })}>
                                                <SelectTrigger data-testid={`smart-grn-line-${index}-granule-code`} className="h-8 rounded-lg border-slate-200 text-[11px]"><SelectValue placeholder="Pick code" /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="__none__">No code</SelectItem>
                                                    {safeSelectRows(selectedGranuleCodes, (code) => code.id).map((code) => <SelectItem key={safeSelectValue(code.id)} value={safeSelectValue(code.id)}>{code.code}</SelectItem>)}
                                                </SelectContent>
                                            </Select>
                                        ) : (
                                            <div className="flex h-8 items-center rounded-lg border border-slate-200 bg-slate-50 px-2 text-[11px] font-bold text-slate-500">
                                                Master UOM · {rowUom}
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-2 py-2">
                                        <Input
                                            data-receipt-gross-row={index}
                                            value={usesGrossTare ? (item.gross_weight_kg || "") : ""}
                                            onChange={(e) => handleGrossTareChange(index, "gross_weight_kg", e.target.value)}
                                            onKeyDown={(e) => handleCellKeyDown(e, index, "gross_weight_kg")}
                                            disabled={!usesGrossTare}
                                            placeholder={usesGrossTare ? "gross" : "—"}
                                            className={cn("h-8 rounded-lg border-slate-200 font-mono text-[11px]", !usesGrossTare && "bg-slate-100 text-content-4")}
                                        />
                                    </td>
                                    <td className="px-2 py-2">
                                        <Input
                                            data-receipt-tare-row={index}
                                            value={usesGrossTare ? (item.tare_weight_kg || "") : ""}
                                            onChange={(e) => handleGrossTareChange(index, "tare_weight_kg", e.target.value)}
                                            onKeyDown={(e) => handleCellKeyDown(e, index, "tare_weight_kg")}
                                            disabled={!usesGrossTare}
                                            placeholder={usesGrossTare ? "tare" : "—"}
                                            className={cn("h-8 rounded-lg border-slate-200 font-mono text-[11px]", !usesGrossTare && "bg-slate-100 text-content-4")}
                                        />
                                    </td>
                                    <td className="px-2 py-2">
                                        <Input data-testid={`smart-grn-line-${index}-qty`} data-receipt-qty-row={index} type="number" value={item.qty} onChange={(e) => handleQtyChange(index, e.target.value)} onKeyDown={(e) => handleCellKeyDown(e, index, "qty")} placeholder={usesGrossTare ? "auto / net" : "qty"} className="h-8 rounded-lg border-success-border bg-emerald-50/30 font-mono text-[11px] font-black" />
                                    </td>
                                    <td className="px-2 py-2">
                                        <Select
                                            value={rowUom}
                                            onValueChange={(value) => patch(index, {
                                                uom: value,
                                                gross_weight_kg: isWeightBasedUom(value) ? item.gross_weight_kg || "" : "",
                                                tare_weight_kg: isWeightBasedUom(value) ? item.tare_weight_kg || "" : "",
                                                qty: isWeightBasedUom(value) ? item.qty : item.qty,
                                            })}
                                            disabled={supportedUoms.length <= 1}
                                        >
                                            <SelectTrigger className="h-8 rounded-lg border-slate-200 bg-slate-50 font-mono text-[11px] font-black text-content-3">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {supportedUoms.map((uom) => <SelectItem key={safeSelectValue(uom)} value={safeSelectValue(uom)}>{uom}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                    </td>
                                    <td className="px-2 py-2">
                                        <Select value={locationValue} onValueChange={(value) => value !== "__none__" && patch(index, { location: value })}>
                                            <SelectTrigger className={cn("h-8 rounded-lg border-slate-200 text-[11px]", item.location && defaultLocationId && item.location !== defaultLocationId && "border-amber-300 bg-warning-bg")}>
                                                <SelectValue placeholder="Header default" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="__none__" disabled>Pick warehouse</SelectItem>
                                                {safeSelectRows(locations, (location) => location.id).map((location) => <SelectItem key={safeSelectValue(location.id)} value={safeSelectValue(location.id)}>{locationLabel(location)}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                    </td>
                                    <td className="px-2 py-2">
                                        <Input data-testid={`smart-grn-line-${index}-unit-cost`} value={item.unit_cost || ""} onChange={(e) => patch(index, { unit_cost: e.target.value })} onKeyDown={(e) => handleCellKeyDown(e, index, "unit_cost")} className="h-8 rounded-lg border-slate-200 font-mono text-[11px]" />
                                    </td>
                                    <td className="px-2 py-2 font-mono font-black text-success-fg">₹{value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                                    <td className="px-2 py-2">
                                        <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider", complete ? "bg-emerald-100 text-success-fg" : "bg-amber-100 text-warning-fg")}>
                                            {complete ? "Ready" : "Fill"}
                                        </span>
                                    </td>
                                    <td className="px-2 py-2">
                                        <Button type="button" variant="ghost" size="sm" className="h-8 w-8 rounded-lg p-0 text-rose-600" onClick={() => removeRow(index)} disabled={items.length <= 1 || lockedToPo}>
                                            <X className="h-3.5 w-3.5" />
                                        </Button>
                                    </td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>
            <div className="flex flex-col gap-2 border-t border-slate-100 bg-surface-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-[11px] font-semibold text-content-3">
                    Header location is the default. The UOM is fixed from the selected master item; KG rows can use gross/tare/net, and METER/PCS rows use direct received quantity.
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-black">
                    <span className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-content-3">{items.length} rows</span>
                    <span className="rounded-lg border border-success-border bg-success-bg px-2.5 py-1 text-emerald-800">{totalQty.toLocaleString(undefined, { maximumFractionDigits: 3 })} qty</span>
                    <span className={cn("rounded-lg border px-2.5 py-1", incomplete ? "border-warning-border bg-warning-bg text-amber-800" : "border-success-border bg-success-bg text-emerald-800")}>{incomplete} incomplete</span>
                </div>
            </div>
        </div>
    )
}

function isReceiptRowComplete(item: ItemDraft) {
    return Boolean(item.material_code) && Number(item.qty) > 0
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
    const supportedUoms = supportedUomsForMaterial(selectedMaterial, klass)
    const selectedUom = resolvedReceiptUom(item.uom, selectedMaterial, klass)
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
        const nextUom = resolvedReceiptUom(item.uom, selected, klass)
        onChange({
            material_code: code,
            po_item_id: lockedToPo ? item.po_item_id : undefined,
            grade: "",
            granule_code_id: "",
            uom: nextUom,
            gross_weight_kg: isWeightBasedUom(nextUom) ? item.gross_weight_kg || "" : "",
            tare_weight_kg: isWeightBasedUom(nextUom) ? item.tare_weight_kg || "" : "",
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
        <div className="rounded-xl border border-slate-200 bg-surface-1 p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
                <span className="rounded-md bg-violet-100 px-2 py-0.5 text-[10px] font-black tracking-wider text-violet-700">Line {index + 1}</span>
                <button onClick={onRemove} className="rounded p-1 text-rose-500 hover:bg-danger-bg"><X className="h-3.5 w-3.5" /></button>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Field label="Material" required>
                    {filteredMaterials.length > 0 ? (
                        <MaterialPicker
                            items={materialPickerItems(filteredMaterials, klass)}
                            value={item.material_code}
                            onValueChange={handleMaterialChange}
                            placeholder={klass === "BULK" ? "Search code, name, type" : "Search material"}
                            disabled={lockedToPo}
                            testId={`smart-grn-line-${index}-material`}
                            className="h-9 rounded-lg border-slate-200 font-mono text-xs shadow-sm"
                        />
                    ) : (
                        <div className="flex h-9 items-center rounded-lg border border-danger-border bg-danger-bg px-3 text-[11px] font-bold text-danger-fg">
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
                                {safeSelectRows(grades, (grade) => grade.id).map((grade) => <SelectItem key={safeSelectValue(grade.id)} value={safeSelectValue(grade.id)}>{grade.name}</SelectItem>)}
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
                                {safeSelectRows(selectedGranuleCodes, (code) => code.id).map((code) => <SelectItem key={safeSelectValue(code.id)} value={safeSelectValue(code.id)}>{code.code}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </Field>
                )}
                <Field label="Qty" required><Input data-testid={`smart-grn-line-${index}-qty`} type="number" value={item.qty} onChange={(e) => onChange({ qty: e.target.value })} className="h-9 rounded-lg border-slate-200 font-mono text-xs shadow-sm" /></Field>
                <Field label="UOM">
                    <Select
                        value={selectedUom}
                        onValueChange={(v) => onChange({
                            uom: v,
                            gross_weight_kg: isWeightBasedUom(v) ? item.gross_weight_kg || "" : "",
                            tare_weight_kg: isWeightBasedUom(v) ? item.tare_weight_kg || "" : "",
                        })}
                        disabled={supportedUoms.length <= 1}
                    >
                        <SelectTrigger data-testid={`smart-grn-line-${index}-uom`} className="h-9 rounded-lg border-slate-200 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            {supportedUoms.map((uom) => <SelectItem key={safeSelectValue(uom)} value={safeSelectValue(uom)}>{uom}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </Field>
                <Field label="Unit cost (₹)"><Input data-testid={`smart-grn-line-${index}-unit-cost`} value={item.unit_cost} onChange={(e) => onChange({ unit_cost: e.target.value })} className="h-9 rounded-lg border-slate-200 font-mono text-xs shadow-sm" /></Field>
                <Field label="Vendor lot ref"><Input value={item.vendor_lot_ref} onChange={(e) => onChange({ vendor_lot_ref: e.target.value })} className="h-9 rounded-lg border-slate-200 font-mono text-xs shadow-sm" /></Field>
                <Field label="Best before"><Input type="date" value={item.best_before} onChange={(e) => onChange({ best_before: e.target.value })} className="h-9 rounded-lg border-slate-200 text-xs shadow-sm" /></Field>
                <Field label="Storage location">
                    <Select value={item.location || "__none__"} onValueChange={(v) => v !== "__none__" && onChange({ location: v })}>
                        <SelectTrigger data-testid={`smart-grn-line-${index}-location`} className="h-9 rounded-lg border-slate-200 text-xs"><SelectValue placeholder="Pick" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="__none__" disabled>Pick warehouse</SelectItem>
                            {safeSelectRows(locations, (l) => l.id).map((l) => <SelectItem key={safeSelectValue(l.id)} value={safeSelectValue(l.id)}>{locationLabel(l)}</SelectItem>)}
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
                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 text-[11px] font-semibold text-content-3">
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
    onSummaryChange,
    onPosted,
}: {
    vendorId: string
    warehouseLocations: Location[]
    warehouseId: string
    vendorInvoiceNo: string
    vendorInvoiceDate: string
    lrVehicle: string
    onSummaryChange: (summary: { qty: number; uom: string; value: number; valid: boolean }) => void
    onPosted: (r: any) => void
}) {
    const { toast } = useToast()
    const [tradingGoodId, setTradingGoodId] = React.useState("")
    const [gross, setGross] = React.useState("")
    const [tare, setTare] = React.useState("")
    const [qty, setQty] = React.useState("")
    const [rate, setRate] = React.useState("")
    const [notes, setNotes] = React.useState("")
    const tradingGoodsQ = useQuery({ queryKey: ["trading-goods", "active"], queryFn: () => tradingGoodService.list({ is_active: true }), staleTime: 60_000 })

    const tradingGoods = (tradingGoodsQ.data || []) as TradingGood[]
    const selected = tradingGoods.find((t) => t.id === tradingGoodId)
    const baseUom = selected?.base_uom || "PCS"
    const usesGrossTare = isWeightBasedUom(baseUom)
    const plantId = React.useMemo(() => {
        if (!warehouseId) return ""
        const loc = (warehouseLocations || []).find((l) => l.id === warehouseId)
        return (loc as any)?.plant || (loc as any)?.plant_id || ""
    }, [warehouseId, warehouseLocations])
    const warehouseLabel = React.useMemo(() => {
        if (!warehouseId) return ""
        const loc = (warehouseLocations || []).find((l) => l.id === warehouseId)
        return loc ? locationLabel(loc) : ""
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
            setGross("")
            setTare("")
            setQty("")
            setRate("")
            setNotes("")
        },
        onError: (err: any) => toast({ title: "Could not post", description: describeApiError(err, "Try again"), variant: "destructive" }),
    })

    const valid = !!tradingGoodId && !!vendorId && !!plantId && Number(qty) > 0 && Number(rate) >= 0
    const value = (Number(qty) || 0) * (Number(rate) || 0)
    const incomplete = valid ? 0 : 1

    const updateGrossTare = React.useCallback((key: "gross" | "tare", value: string) => {
        const nextGross = key === "gross" ? value : gross
        const nextTare = key === "tare" ? value : tare
        if (key === "gross") setGross(value)
        if (key === "tare") setTare(value)
        if (usesGrossTare) {
            const net = computeNetFromGrossTare(nextGross, nextTare)
            if (net) setQty(net)
        }
    }, [gross, tare, usesGrossTare])

    React.useEffect(() => {
        onSummaryChange({
            qty: Number(qty) || 0,
            uom: baseUom,
            value,
            valid,
        })
    }, [baseUom, onSummaryChange, qty, valid, value])

    return (
        <div className="overflow-hidden bg-surface-1 shadow-sm">
            <div className="flex flex-col gap-3 border-b border-violet-100 bg-violet-50/60 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.22em] text-violet-700">Fast trading entry</div>
                    <div className="mt-1 text-sm font-semibold text-slate-700">
                        One row per trading-good receipt. The grid language matches every GRN class; KG rows can use gross/tare/net, PCS and METER rows use direct quantity.
                    </div>
                    <div className="mt-1 text-[11px] font-semibold text-slate-500">Trading goods post through the trading stock ledger, so stock value and average cost stay separate from raw materials.</div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-black">
                    <span className="rounded-lg border border-slate-200 bg-surface-1 px-2.5 py-1 text-content-3">1 row</span>
                    <span className="rounded-lg border border-success-border bg-success-bg px-2.5 py-1 text-emerald-800">{(Number(qty) || 0).toLocaleString(undefined, { maximumFractionDigits: 3 })} {baseUom}</span>
                    <span className={cn("rounded-lg border px-2.5 py-1", incomplete ? "border-warning-border bg-warning-bg text-amber-800" : "border-success-border bg-success-bg text-emerald-800")}>{incomplete} incomplete</span>
                </div>
            </div>
            <div className="overflow-x-auto">
                <table className="min-w-[1520px] text-left text-[11px]">
                    <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                        <tr>
                            <th className="w-12 px-2 py-2">#</th>
                            <th className="w-[360px] px-2 py-2">Trading good</th>
                            <th className="w-[120px] px-2 py-2">Gross</th>
                            <th className="w-[110px] px-2 py-2">Tare</th>
                            <th className="w-[130px] px-2 py-2">Net / qty</th>
                            <th className="w-[110px] px-2 py-2">UOM</th>
                            <th className="w-[260px] px-2 py-2">Location</th>
                            <th className="w-[140px] px-2 py-2">Rate</th>
                            <th className="w-[140px] px-2 py-2">Value</th>
                            <th className="w-[260px] px-2 py-2">Notes</th>
                            <th className="w-[90px] px-2 py-2">State</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr className={cn("border-t border-slate-100 align-middle", valid ? "bg-violet-50/20" : "bg-surface-1")}>
                            <td className="px-2 py-2 font-mono font-black text-slate-500">1</td>
                            <td className="px-2 py-2">
                                <Select value={tradingGoodId} onValueChange={setTradingGoodId}>
                                    <SelectTrigger className="h-8 rounded-lg border-slate-200 text-[11px] shadow-sm">
                                        <SelectValue placeholder={tradingGoodsQ.isLoading ? "Loading..." : "Pick trading good"} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {safeSelectRows(tradingGoods, (t) => t.id).map((t) => (
                                            <SelectItem key={safeSelectValue(t.id)} value={safeSelectValue(t.id)}>{t.code} · {t.name} ({t.base_uom})</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </td>
                            <td className="px-2 py-2">
                                <Input
                                    value={usesGrossTare ? gross : ""}
                                    onChange={(e) => updateGrossTare("gross", e.target.value)}
                                    type="number"
                                    disabled={!usesGrossTare}
                                    placeholder={usesGrossTare ? "gross" : "—"}
                                    className={cn("h-8 rounded-lg border-slate-200 font-mono text-[11px]", !usesGrossTare && "bg-slate-100 text-content-4")}
                                />
                            </td>
                            <td className="px-2 py-2">
                                <Input
                                    value={usesGrossTare ? tare : ""}
                                    onChange={(e) => updateGrossTare("tare", e.target.value)}
                                    type="number"
                                    disabled={!usesGrossTare}
                                    placeholder={usesGrossTare ? "tare" : "—"}
                                    className={cn("h-8 rounded-lg border-slate-200 font-mono text-[11px]", !usesGrossTare && "bg-slate-100 text-content-4")}
                                />
                            </td>
                            <td className="px-2 py-2">
                                <Input value={qty} onChange={(e) => setQty(e.target.value)} type="number" placeholder={usesGrossTare ? "auto / net" : "qty"} className="h-8 rounded-lg border-success-border bg-emerald-50/30 font-mono text-[11px] font-black" />
                            </td>
                            <td className="px-2 py-2">
                                <Input value={baseUom} readOnly className="h-8 rounded-lg border-slate-200 bg-slate-100 font-mono text-[11px] font-black text-content-3" />
                            </td>
                            <td className="px-2 py-2">
                                <Input value={warehouseLabel || "Pick receiving warehouse above"} readOnly className="h-8 rounded-lg border-slate-200 bg-slate-100 text-[11px] font-semibold text-content-3" />
                            </td>
                            <td className="px-2 py-2">
                                <Input value={rate} onChange={(e) => setRate(e.target.value)} type="number" className="h-8 rounded-lg border-slate-200 font-mono text-[11px]" />
                            </td>
                            <td className="px-2 py-2 font-mono font-black text-success-fg">₹{value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                            <td className="px-2 py-2">
                                <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="h-8 min-w-[240px] rounded-lg border-slate-200 text-[11px]" />
                            </td>
                            <td className="px-2 py-2">
                                <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider", valid ? "bg-emerald-100 text-success-fg" : "bg-amber-100 text-warning-fg")}>
                                    {valid ? "Ready" : "Fill"}
                                </span>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <div className="flex flex-col gap-2 border-t border-slate-100 bg-surface-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-[11px] font-semibold text-content-3">
                    Vendor invoice and transport details are taken from the Source section. Plant is inferred from the receiving warehouse.
                </div>
                <div className="flex items-center gap-2">
                    <div className="rounded-lg border border-success-border bg-success-bg px-3 py-1 text-right text-[11px] font-black text-emerald-800">
                        ₹{value.toLocaleString(undefined, { maximumFractionDigits: 0 })} receipt value
                    </div>
                    <Button
                        type="button"
                        disabled={!valid || post.isPending}
                        onClick={() => post.mutate()}
                        className="h-8 rounded-lg bg-violet-700 text-xs text-white hover:bg-violet-800"
                    >
                        {post.isPending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-2 h-3.5 w-3.5" />}
                        Post receipt
                    </Button>
                </div>
            </div>
        </div>
    )
}
