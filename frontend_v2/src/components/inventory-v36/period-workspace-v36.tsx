"use client"

/**
 * V3.6 Stock Lifecycle / Period Management workspace.
 *
 * Current stock lifecycle workspace with:
 *   - Year-end mode banner (auto-shows when within 60 days of 31-March)
 *   - 12-month FY ribbon (closed / open / future / year-end)
 *   - 4-step ribbon (audit → variance → approve → close)
 *   - Audit batches list (full-count + quick-count entry points)
 *   - Variance review side panel
 *   - Day-0 wizard panel
 *   - Audit history table
 *
 * All data via inventoryService (real backend, mock fallback).
 */

import * as React from "react"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
    AlertTriangle,
    ArrowRight,
    CheckCircle2,
    Clock,
    Database,
    FileText,
    Lock,
    Smartphone,
    Sparkles,
    Upload,
    Workflow,
    Loader2,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { GradientHero } from "@/components/erp-v3/gradient-hero"
import { useToast } from "@/hooks/use-toast"
import { describeApiError } from "@/lib/api"
import { cn } from "@/lib/utils"
import { inventoryService } from "@/services/inventory"
import { MaterialPicker } from "@/components/inventory/material-picker"
import { masterDataService, type Material } from "@/services/master-data"
import { ClassTabBar, INVENTORY_CLASS_TABS } from "./pulse-view-v36"

// ─── Helpers ───────────────────────────────────────────────────────

function fyMonths(): { label: string; index: number }[] {
    return [
        { label: "Apr", index: 4 }, { label: "May", index: 5 }, { label: "Jun", index: 6 },
        { label: "Jul", index: 7 }, { label: "Aug", index: 8 }, { label: "Sep", index: 9 },
        { label: "Oct", index: 10 }, { label: "Nov", index: 11 }, { label: "Dec", index: 12 },
        { label: "Jan", index: 1 }, { label: "Feb", index: 2 }, { label: "Mar", index: 3 },
    ]
}

function currentFiscalYear(today: Date): { startYear: number; endYear: number; label: string } {
    const m = today.getMonth() + 1
    const y = today.getFullYear()
    const startYear = m >= 4 ? y : y - 1
    const endYear = startYear + 1
    return { startYear, endYear, label: `FY ${startYear}-${String(endYear).slice(-2)}` }
}

function daysToYearEnd(today: Date): number {
    const fy = currentFiscalYear(today)
    const end = new Date(fy.endYear, 2, 31) // Mar 31 (month 2 zero-indexed)
    return Math.max(0, Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)))
}

function materialCategory(material: Material | any) {
    return String(material?.category || "").trim().toUpperCase()
}

function materialUom(material: Material | any, fallback = "KG") {
    if (materialCategory(material) === "ADDON") {
        return String(material?.addon_purchase_uom || material?.base_uom || fallback).toUpperCase()
    }
    return String(material?.base_uom || fallback).toUpperCase()
}

function materialMatchesStockClass(material: Material | any, stockClass: "BULK" | "ROLL" | "PACKAGING") {
    const category = materialCategory(material)
    const active = !material?.status || String(material.status).toUpperCase() === "ACTIVE"
    if (!active || !String(material?.code || "").trim()) return false
    if (stockClass === "ROLL") return category === "FILM_VARIANT"
    if (stockClass === "PACKAGING") return category === "PACKAGING"
    if (category === "ADDON") return material?.addon_is_purchased === true
    return ["GRANULE", "INK", "ADHESIVE", "SOLVENT", "POD"].includes(category)
}

function countLineLabel(row: Record<string, any>) {
    const material = row.materialCode || row.material_code || "Material"
    const location = row.locationCode || row.location_name || row.locationName || "Location"
    const qty = Number(row.systemQty ?? row.qty ?? 0).toLocaleString()
    return `${row.ref_type || row.stock_class || "STOCK"} · ${material} · ${location} · ${qty} ${row.uom || ""}`.trim()
}

// ─── Component ───────────────────────────────────────────────────

export function PeriodWorkspaceV36() {
    const { toast } = useToast()
    const queryClient = useQueryClient()
    const today = new Date()
    const fy = currentFiscalYear(today)
    const daysToYE = daysToYearEnd(today)
    const yearEndMode = daysToYE <= 60

    const { data: periods = [], error: periodsError } = useQuery({
        queryKey: ["audit-periods"],
        queryFn: () => inventoryService.getAuditPeriods(),
        staleTime: 30_000,
    })

    const { data: batches = [], isLoading: batchesLoading, error: batchesError } = useQuery({
        queryKey: ["audit-batches"],
        queryFn: () => inventoryService.getAuditBatches(),
        staleTime: 30_000,
    })

    const { data: locations = [], error: locationsError } = useQuery({
        queryKey: ["inventory-locations"],
        queryFn: () => inventoryService.getLocations(),
        staleTime: 60_000,
    })

    const { data: materials = [], error: materialsError } = useQuery({
        queryKey: ["material-library"],
        queryFn: () => masterDataService.getLibrary(),
        staleTime: 60_000,
    })

    const [selectedPeriodId, setSelectedPeriodId] = React.useState("")
    const [selectedPlantId, setSelectedPlantId] = React.useState("")
    const [selectedBatchId, setSelectedBatchId] = React.useState("")
    const [openingStockClass, setOpeningStockClass] = React.useState<"BULK" | "ROLL" | "PACKAGING">("BULK")
    const [openingMaterialCode, setOpeningMaterialCode] = React.useState("")
    const [openingMaterialId, setOpeningMaterialId] = React.useState("")
    const [openingLocationCode, setOpeningLocationCode] = React.useState("")
    const [openingQty, setOpeningQty] = React.useState("")
    const [openingUom, setOpeningUom] = React.useState("KG")
    const [openingLabelId, setOpeningLabelId] = React.useState("")
    const [openingBatchNo, setOpeningBatchNo] = React.useState("")
    const [openingWidthMm, setOpeningWidthMm] = React.useState("")
    const [openingThicknessMicron, setOpeningThicknessMicron] = React.useState("")
    const [openingLengthM, setOpeningLengthM] = React.useState("")
    const [countStockClass, setCountStockClass] = React.useState<"ALL" | "BULK" | "ROLL" | "PACKAGING">("ALL")
    const [countSearch, setCountSearch] = React.useState("")
    const [countLineId, setCountLineId] = React.useState("")
    const [countedQty, setCountedQty] = React.useState("")
    const [correctionPeriodId, setCorrectionPeriodId] = React.useState("")
    const [correctionRowKey, setCorrectionRowKey] = React.useState("")
    const [correctionQty, setCorrectionQty] = React.useState("")
    const [correctionNotes, setCorrectionNotes] = React.useState("FY correction after approved stock recount.")

    const activeBatches = (batches as any[]).filter((b) => !["POSTED", "LOCKED", "CANCELLED", "VOID"].includes(String(b.status || "")))
    const closedBatches = (batches as any[]).filter((b) => ["POSTED", "CLOSED"].includes(String(b.status || "")))

    const currentPeriod = (periods as any[]).find((p) => p.status === "OPEN") || (periods as any[])[0]
    const selectedPeriod = (periods as any[]).find((p) => String(p.id) === selectedPeriodId) || currentPeriod
    const closedPeriods = (periods as any[]).filter((p) => String(p.status || "").toUpperCase() === "CLOSED")
    const selectedCorrectionPeriod = (periods as any[]).find((p) => String(p.id) === correctionPeriodId) || closedPeriods[0]
    const queryError = periodsError || batchesError || locationsError || materialsError

    const plantOptions = React.useMemo(() => {
        const map = new Map<string, { id: string; name: string; code: string }>()
        for (const location of locations as any[]) {
            const id = String(location.plant || location.plant_id || "")
            if (!id || map.has(id)) continue
            map.set(id, { id, name: String(location.plant_name || location.plant_code || "Plant"), code: String(location.plant_code || "") })
        }
        for (const batch of batches as any[]) {
            const id = String(batch.plant || "")
            if (!id || map.has(id)) continue
            map.set(id, { id, name: String(batch.plant_name || batch.plant_code || "Plant"), code: String(batch.plant_code || "") })
        }
        return Array.from(map.values())
    }, [batches, locations])

    const plantLocations = React.useMemo(
        () => (locations as any[]).filter((location) => String(location.plant || location.plant_id || "") === String(selectedPlantId)),
        [locations, selectedPlantId],
    )

    const openingMaterials = React.useMemo(
        () => (materials as Material[])
            .filter((material) => materialMatchesStockClass(material, openingStockClass))
            .sort((a, b) => String(a.code || "").localeCompare(String(b.code || ""))),
        [materials, openingStockClass],
    )
    const selectedOpeningMaterial = React.useMemo(
        () => openingMaterials.find((material) => String(material.id) === String(openingMaterialId)),
        [openingMaterialId, openingMaterials],
    )

    const firstPeriodId = String(currentPeriod?.id || (periods as any[])[0]?.id || "")
    const firstPlantId = plantOptions[0]?.id || ""
    const firstLocationCode = plantLocations[0]?.id || ""
    const firstClosedPeriodId = String(closedPeriods[0]?.id || "")
    const selectedOpeningLocation = plantLocations.find((location: any) => String(location.id) === String(openingLocationCode))

    React.useEffect(() => {
        if (firstPeriodId && !selectedPeriodId) setSelectedPeriodId(firstPeriodId)
    }, [firstPeriodId, selectedPeriodId])

    React.useEffect(() => {
        if (firstPlantId && !selectedPlantId) setSelectedPlantId(firstPlantId)
    }, [firstPlantId, selectedPlantId])

    React.useEffect(() => {
        if (firstLocationCode && !openingLocationCode) setOpeningLocationCode(firstLocationCode)
    }, [firstLocationCode, openingLocationCode])

    React.useEffect(() => {
        if (openingMaterialId && !selectedOpeningMaterial) {
            setOpeningMaterialId("")
            setOpeningMaterialCode("")
        }
    }, [openingMaterialId, selectedOpeningMaterial])

    React.useEffect(() => {
        if (firstClosedPeriodId && !correctionPeriodId) setCorrectionPeriodId(firstClosedPeriodId)
    }, [firstClosedPeriodId, correctionPeriodId])

    const { data: stockSnapshot } = useQuery({
        queryKey: ["audit-stock-snapshot", selectedPlantId],
        queryFn: () => inventoryService.getStockSnapshot({ plant: selectedPlantId }),
        enabled: Boolean(selectedPlantId),
        staleTime: 30_000,
    })

    const snapshotRows = stockSnapshot?.rows || []
    const stockRowKey = React.useCallback((row: Record<string, any>) => {
        return [
            row.stock_class,
            row.material,
            row.location,
            row.label_id || "",
            row.batch_no || "",
            row.granule_code || "",
            row.grade || "",
        ].join(":")
    }, [])
    const selectedCorrectionRow = snapshotRows.find((row) => stockRowKey(row) === correctionRowKey) || snapshotRows[0]
    const firstSnapshotKey = snapshotRows[0] ? stockRowKey(snapshotRows[0]) : ""

    React.useEffect(() => {
        if (firstSnapshotKey && !correctionRowKey) setCorrectionRowKey(firstSnapshotKey)
    }, [firstSnapshotKey, correctionRowKey])

    React.useEffect(() => {
        if (selectedCorrectionRow && !correctionQty) setCorrectionQty(String(selectedCorrectionRow.qty ?? ""))
    }, [selectedCorrectionRow, correctionQty])

    const workflowBatch = (batches as any[]).find((b) => String(b.id) === selectedBatchId) || activeBatches[0] || (batches as any[])[0]
    const firstBatchId = String(workflowBatch?.id || "")

    const { data: batchItems = [], isLoading: batchItemsLoading, error: batchItemsError } = useQuery({
        queryKey: ["audit-batch-items", workflowBatch?.id],
        queryFn: () => inventoryService.getAuditBatchItems(String(workflowBatch?.id || "")),
        enabled: Boolean(workflowBatch?.id),
        staleTime: 15_000,
    })

    const filteredCountItems = React.useMemo(() => {
        const q = countSearch.trim().toLowerCase()
        return (batchItems as any[]).filter((row) => {
            const klass = String(row.ref_type || row.stock_class || row.materialKind || "").toUpperCase()
            if (countStockClass !== "ALL" && klass !== countStockClass) return false
            if (!q) return true
            return [
                row.materialCode,
                row.material_code,
                row.locationCode,
                row.location_name,
                row.label,
                row.uom,
            ].some((value) => String(value || "").toLowerCase().includes(q))
        })
    }, [batchItems, countSearch, countStockClass])
    const selectedCountLine = filteredCountItems.find((row: any) => String(row.id) === String(countLineId)) || filteredCountItems[0]
    const firstCountLineId = String(selectedCountLine?.id || "")

    React.useEffect(() => {
        if (firstBatchId && !selectedBatchId) setSelectedBatchId(firstBatchId)
    }, [firstBatchId, selectedBatchId])

    React.useEffect(() => {
        if (firstCountLineId && !countLineId) setCountLineId(firstCountLineId)
        if (countLineId && !filteredCountItems.some((row: any) => String(row.id) === String(countLineId))) {
            setCountLineId(firstCountLineId)
        }
    }, [countLineId, filteredCountItems, firstCountLineId])

    React.useEffect(() => {
        if (selectedCountLine) {
            setCountedQty(String(selectedCountLine.countedQty ?? selectedCountLine.systemQty ?? ""))
        }
    }, [selectedCountLine?.id])

    const startFyMutation = useMutation({
        mutationFn: () => inventoryService.startAuditPeriod({ financial_year: `${fy.startYear}-${String(fy.endYear).slice(-2)}` }),
        onSuccess: (period: any) => {
            queryClient.invalidateQueries({ queryKey: ["audit-periods"] })
            toast({ title: "Fiscal year opened", description: `${period?.financial_year || fy.label} is now OPEN. You can start batches.` })
        },
        onError: (err) => toast({ title: "Could not start FY", description: describeApiError(err, "Try again."), variant: "destructive" }),
    })

    const createBatchMutation = useMutation({
        mutationFn: async (scope: "FULL" | "CHUNKED" | "OPENING") => {
            const batch: any = await inventoryService.createAuditBatch({
                period_id: selectedPeriod?.id,
                plant: selectedPlantId || firstPlantId,
                financial_year: selectedPeriod?.financial_year,
                scope,
                name: scope === "FULL" ? "Full stock count" : scope === "OPENING" ? "Opening stock count" : "Quick stock count",
                notes: scope === "OPENING" ? "V3.6 opening stock wizard floor walk" : `V3.6 ${scope.toLowerCase()} stock count`,
            } as any)
            await inventoryService.startAuditBatch(batch.id)
            await inventoryService.loadAuditBatchFromSystemStock(batch.id, { replace_existing: true })
            return inventoryService.getAuditBatch(batch.id)
        },
        onSuccess: (batch: any) => {
            if (batch?.id) setSelectedBatchId(String(batch.id))
            queryClient.invalidateQueries({ queryKey: ["audit-batches"] })
            queryClient.invalidateQueries({ queryKey: ["audit-batches-active"] })
            queryClient.invalidateQueries({ queryKey: ["audit-batch-items"] })
            toast({ title: "Audit batch created", description: `${batch.code || batch.batch_no || "Batch"} is ready for counting.` })
        },
        onError: (err) => toast({ title: "Could not create audit batch", description: describeApiError(err, "Try again."), variant: "destructive" }),
    })

    const openPreviewMutation = useMutation({
        mutationFn: () => inventoryService.getClosingPreview({ financial_year: selectedPeriod?.financial_year, plant: selectedPlantId || undefined }),
        onSuccess: (preview) => {
            const blockerCount = (preview.blockers || []).reduce((sum, row) => sum + Number(row.count || 0), 0)
            toast({ title: "Closing preview ready", description: blockerCount ? `${blockerCount} blocker(s) need review before close.` : "No period blockers found in the preview." })
        },
        onError: (err) => toast({ title: "Could not load closing preview", description: describeApiError(err, "Try again."), variant: "destructive" }),
    })

    const periodActionMutation = useMutation({
        mutationFn: async (action: "BEGIN_CLOSE" | "CLOSE") => {
            if (!selectedPeriod?.id) throw new Error("Pick a period first.")
            if (action === "BEGIN_CLOSE") return inventoryService.beginPeriodClose(selectedPeriod.id)
            if (!selectedPlantId) throw new Error("Pick a plant first.")
            return inventoryService.closePeriod(selectedPeriod.id, { plant: selectedPlantId })
        },
        onSuccess: (period: any) => {
            queryClient.invalidateQueries({ queryKey: ["audit-periods"] })
            queryClient.invalidateQueries({ queryKey: ["audit-batches"] })
            queryClient.invalidateQueries({ queryKey: ["audit-stock-snapshot"] })
            toast({ title: "Period updated", description: `${period.financial_year || "Period"} is now ${period.status || "updated"}.` })
        },
        onError: (err) => toast({ title: "Period action blocked", description: describeApiError(err, "Resolve blockers and retry."), variant: "destructive" }),
    })

    const batchActionMutation = useMutation({
        mutationFn: async (action: "VALIDATE" | "SUBMIT" | "APPROVE" | "POST") => {
            if (!workflowBatch?.id) throw new Error("Pick an audit batch first.")
            if (action === "VALIDATE") return inventoryService.validateAuditBatch(workflowBatch.id)
            if (action === "SUBMIT") return inventoryService.submitAuditBatch(workflowBatch.id)
            if (action === "APPROVE") return inventoryService.approveAuditBatch(workflowBatch.id)
            return inventoryService.postAuditBatch(workflowBatch.id)
        },
        onSuccess: (batch: any) => {
            queryClient.invalidateQueries({ queryKey: ["audit-batches"] })
            queryClient.invalidateQueries({ queryKey: ["audit-batch-items"] })
            queryClient.invalidateQueries({ queryKey: ["audit-stock-snapshot"] })
            toast({ title: "Audit batch updated", description: `${batch.code || batch.batch_no || "Batch"} is now ${batch.status || "updated"}.` })
        },
        onError: (err) => toast({ title: "Audit batch action blocked", description: describeApiError(err, "Resolve blockers and retry."), variant: "destructive" }),
    })

    const loadBatchStockMutation = useMutation({
        mutationFn: async () => {
            if (!workflowBatch?.id) throw new Error("Pick an audit batch first.")
            return inventoryService.loadAuditBatchFromSystemStock(workflowBatch.id, {
                stock_class: countStockClass === "ALL" ? undefined : countStockClass,
                replace_existing: true,
            })
        },
        onSuccess: (batch: any) => {
            queryClient.invalidateQueries({ queryKey: ["audit-batches"] })
            queryClient.invalidateQueries({ queryKey: ["audit-batch-items"] })
            toast({ title: "Stock loaded into count", description: `${batch.code || batch.batch_no || "Batch"} now has live stock rows ready for physical counts.` })
        },
        onError: (err) => toast({ title: "Could not load stock rows", description: describeApiError(err, "Try again."), variant: "destructive" }),
    })

    const countLineMutation = useMutation({
        mutationFn: () => {
            if (!workflowBatch?.id) throw new Error("Pick an audit batch first.")
            if (!selectedCountLine?.id) throw new Error("Load or pick a stock row first.")
            if (!countedQty.trim()) throw new Error("Enter counted quantity.")
            return inventoryService.submitAuditCountLine(workflowBatch.id, {
                ref_id: selectedCountLine.id,
                ref_type: selectedCountLine.ref_type || selectedCountLine.stock_class || selectedCountLine.materialKind,
                counted_qty: countedQty,
                system_qty: selectedCountLine.systemQty,
                reason_note: "Period workspace count entry",
                device_id: "period-workspace",
            })
        },
        onSuccess: (result: any) => {
            queryClient.invalidateQueries({ queryKey: ["audit-batches"] })
            queryClient.invalidateQueries({ queryKey: ["audit-batch-items"] })
            toast({
                title: result?.flagged ? "Count saved with variance" : "Count saved",
                description: result?.flagged ? `Variance ${Number(result.variance_pct || 0).toFixed(2)}% flagged for review.` : "Physical quantity updated on the selected audit line.",
            })
        },
        onError: (err) => toast({ title: "Count line blocked", description: describeApiError(err, "Check batch status and quantity."), variant: "destructive" }),
    })

    const openingManualMutation = useMutation({
        mutationFn: () => {
            if (!selectedPlantId) throw new Error("Pick a plant first.")
            if (!openingMaterialId.trim() && !openingMaterialCode.trim()) throw new Error("Pick material.")
            if (!openingLocationCode.trim()) throw new Error("Enter location code.")
            if (!openingQty.trim()) throw new Error("Enter opening quantity.")
            return inventoryService.postOpeningStockManual({
                plant: selectedPlantId,
                financial_year: selectedPeriod?.financial_year,
                notes: "V3.6 opening balance manual entry",
                lines: [
                    {
                        stock_class: openingStockClass,
                        material: openingMaterialId || undefined,
                        material_code: openingMaterialCode.trim(),
                        location_id: openingLocationCode.trim(),
                        location_code: selectedOpeningLocation?.code || "",
                        location_name: selectedOpeningLocation?.name || selectedOpeningLocation?.location_name || "",
                        qty: openingQty,
                        uom: openingUom,
                        label_id: openingLabelId.trim(),
                        batch_no: openingBatchNo.trim(),
                        width_mm: openingWidthMm,
                        thickness_micron: openingThicknessMicron,
                        length_m: openingLengthM,
                    },
                ],
            })
        },
        onSuccess: (result) => {
            setOpeningQty("")
            setOpeningLabelId("")
            setOpeningBatchNo("")
            queryClient.invalidateQueries({ queryKey: ["audit-batches"] })
            queryClient.invalidateQueries({ queryKey: ["audit-stock-snapshot"] })
            toast({ title: "Opening balance posted", description: `${result.rows_committed} row(s) committed through ${result.batch_id}.` })
        },
        onError: (err) => toast({ title: "Opening balance blocked", description: describeApiError(err, "Check material/location and retry."), variant: "destructive" }),
    })

    const correctionMutation = useMutation({
        mutationFn: async () => {
            if (!selectedCorrectionPeriod?.financial_year) throw new Error("No closed financial year is available for correction.")
            if (!selectedPlantId) throw new Error("Pick a plant first.")
            if (!selectedCorrectionRow) throw new Error("Pick a stock row first.")
            if (!correctionQty.trim()) throw new Error("Enter corrected quantity.")
            const batch: any = await inventoryService.createAuditBatch({
                type: "FY_CORRECTION",
                plant: selectedPlantId,
                financial_year: selectedCorrectionPeriod.financial_year,
                notes: correctionNotes.trim() || "FY correction after approved stock recount.",
            } as any)
            await inventoryService.importAuditLines(batch.id, {
                lines: [
                    {
                        stock_class: selectedCorrectionRow.stock_class,
                        material: selectedCorrectionRow.material,
                        granule_code: selectedCorrectionRow.granule_code || "",
                        grade: selectedCorrectionRow.grade || "",
                        location: selectedCorrectionRow.location,
                        counted_qty: correctionQty,
                        uom: selectedCorrectionRow.uom || "KG",
                        rate: selectedCorrectionRow.rate || "",
                        label_id: selectedCorrectionRow.label_id || "",
                        batch_no: selectedCorrectionRow.batch_no || "",
                        width_mm: selectedCorrectionRow.width_mm || "",
                        thickness_micron: selectedCorrectionRow.thickness_micron || "",
                        length_m: selectedCorrectionRow.length_m || "",
                        is_fg: selectedCorrectionRow.is_fg || false,
                        stage_index: selectedCorrectionRow.stage_index || 0,
                        status: selectedCorrectionRow.status || "AVAILABLE",
                        packaging_kind: selectedCorrectionRow.packaging_kind || "",
                        base_uom: selectedCorrectionRow.base_uom || selectedCorrectionRow.uom || "",
                    },
                ],
            })
            await inventoryService.submitAuditBatch(batch.id)
            await inventoryService.approveAuditBatch(batch.id)
            return inventoryService.postAuditBatch(batch.id)
        },
        onSuccess: (batch: any) => {
            queryClient.invalidateQueries({ queryKey: ["audit-batches"] })
            queryClient.invalidateQueries({ queryKey: ["audit-periods"] })
            queryClient.invalidateQueries({ queryKey: ["audit-stock-snapshot"] })
            toast({ title: "FY correction posted", description: `${batch.code || batch.batch_no || "Correction"} posted with next-opening sync.` })
        },
        onError: (err) => toast({ title: "FY correction blocked", description: describeApiError(err, "Close the year first and retry."), variant: "destructive" }),
    })

    const hasOpenPeriod = Boolean((periods as any[]).find((p) => String(p.status || "").toUpperCase() === "OPEN"))

    return (
        <div data-testid="stock-lifecycle-workspace" className="space-y-4 pb-24">
            <ClassTabBar tabs={INVENTORY_CLASS_TABS} activeId="period" />

            <GradientHero
                eyebrow="Inventory · Period management"
                title="Stock lifecycle"
                subtitle="One flow for monthly · ad-hoc · year-end. Same 4 steps, different scope. Day-0 wizard for go-live."
                palette="indigo"
                chips={[
                    { icon: <Database className="h-3.5 w-3.5" />, label: "FY", value: fy.label, tone: "ok" },
                    { icon: <Clock className="h-3.5 w-3.5" />, label: "Days to YE", value: `${daysToYE}`, tone: yearEndMode ? "warn" : "ok" },
                    { icon: <Workflow className="h-3.5 w-3.5" />, label: "Audit batches", value: `${batches.length}` },
                    { icon: <Sparkles className="h-3.5 w-3.5" />, label: "Active", value: `${activeBatches.length}`, tone: activeBatches.length ? "warn" : "ok" },
                ]}
                actions={
                    <div className="flex items-center gap-2">
                        <Link href="/inventory/count" className="inline-flex items-center gap-1.5 rounded-xl bg-white/15 px-3 py-1.5 text-xs font-bold text-white ring-1 ring-white/30 hover:bg-white/25">
                            <Smartphone className="h-3.5 w-3.5" /> Mobile count
                        </Link>
                        <button
                            onClick={() => createBatchMutation.mutate("CHUNKED")}
                            disabled={createBatchMutation.isPending}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-1.5 text-xs font-bold text-amber-700 shadow-md hover:bg-amber-50 disabled:opacity-60"
                        >
                            {createBatchMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                            + New audit batch
                        </button>
                    </div>
                }
            />
            {queryError && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800">
                    <div className="flex items-center gap-2 font-bold"><AlertTriangle className="h-4 w-4" /> Period data did not load.</div>
                    <div className="mt-0.5">{describeApiError(queryError, "Check backend and retry.")}</div>
                </div>
            )}

            {/* Start FY banner — shows when no OPEN period exists */}
            {!hasOpenPeriod && !queryError && (
                <div className="overflow-hidden rounded-2xl border-2 border-dashed border-indigo-300 bg-gradient-to-br from-indigo-50 via-white to-violet-50 p-5 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <span className="flex h-12 w-12 flex-none items-center justify-center rounded-2xl bg-indigo-600 text-2xl text-white shadow-md">🚀</span>
                            <div>
                                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-indigo-700">No open period yet</div>
                                <div className="font-display text-lg font-bold text-slate-900">Start {fy.label}</div>
                                <div className="text-xs text-slate-600">
                                    Today is {today.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })} — open the fiscal year to begin posting opening stock and GRNs.
                                </div>
                            </div>
                        </div>
                        <button
                            onClick={() => startFyMutation.mutate()}
                            disabled={startFyMutation.isPending}
                            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white shadow-md hover:bg-indigo-700 disabled:opacity-60"
                        >
                            {startFyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                            {startFyMutation.isPending ? "Opening…" : `Open ${fy.label}`}
                        </button>
                    </div>
                </div>
            )}

            {/* Year-end banner */}
            {yearEndMode && (
                <div className="overflow-hidden rounded-2xl bg-gradient-to-r from-rose-600 via-orange-500 to-amber-500 p-4 text-white shadow-lg">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                            <span className="text-2xl">⏰</span>
                            <div>
                                <div className="text-[10px] font-black uppercase tracking-[0.28em] text-white/80">Year-end mode active</div>
                                <div className="font-display text-lg font-bold">{fy.label} closes in {daysToYE} days · 31 March {fy.endYear}</div>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 text-[11px] font-bold">
                            <span className="rounded-full bg-white/20 px-2.5 py-0.5 ring-1 ring-white/30">Mar 25: Start full audit</span>
                            <span className="rounded-full bg-white/20 px-2.5 py-0.5 ring-1 ring-white/30">Mar 31: Owner sign-off</span>
                            <span className="rounded-full bg-white/20 px-2.5 py-0.5 ring-1 ring-white/30">Apr 1: New FY opens</span>
                        </div>
                    </div>
                </div>
            )}

            {/* Current period strip */}
            <section className="overflow-hidden rounded-2xl border border-slate-200/60 bg-white shadow-md ring-1 ring-slate-100/50">
                <div className="grid grid-cols-1 gap-0 lg:grid-cols-[260px_1fr]">
                    <div className="border-b border-slate-200/60 bg-gradient-to-br from-blue-50/70 via-white to-violet-50/40 p-5 lg:border-b-0 lg:border-r">
                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Current period</div>
                        <div className="font-display mt-1 text-3xl font-bold text-slate-900">
                            {today.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                            {today.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short", year: "numeric" })}
                            {currentPeriod ? ` · ${currentPeriod.financial_year || fy.label}` : ` · ${fy.label}`}
                        </div>
                        <div className="mt-3 flex items-center gap-2">
                            <span className={cn(
                                "rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider ring-1",
                                hasOpenPeriod ? "bg-emerald-100 text-emerald-800 ring-emerald-200" : "bg-amber-100 text-amber-800 ring-amber-200",
                            )}>
                                {hasOpenPeriod ? "● OPEN" : "● NO OPEN PERIOD"}
                            </span>
                            <span className="text-[10px] text-slate-500">monthly cadence (any time)</span>
                        </div>
                    </div>
                    <div className="p-5">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">FY timeline</div>
                                <div className="text-sm font-bold text-slate-900">{fy.label} · variance threshold 2% · close anytime</div>
                            </div>
                            <Button
                                size="sm"
                                variant="outline"
                                disabled={openPreviewMutation.isPending || !currentPeriod}
                                onClick={() => openPreviewMutation.mutate()}
                                className="rounded-lg gap-1.5 border-blue-200 bg-blue-50 text-blue-700"
                            >
                                {openPreviewMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />} Closing preview
                            </Button>
                        </div>
                        <div className="mt-4">
                            <div className="grid grid-cols-12 gap-1">
                                {fyMonths().map((m, i) => {
                                    // Compute current month index inside the FY (Apr=0..Mar=11) from today.
                                    const todayMonth = today.getMonth() + 1 // 1..12
                                    const currentIdx = todayMonth >= 4 ? todayMonth - 4 : todayMonth + 8
                                    const status = i < currentIdx ? "closed" : i === currentIdx ? "open" : i === 11 ? "ye" : "future"
                                    return <PeriodCell key={m.label} label={m.label} status={status} />
                                })}
                            </div>
                            <div className="mt-2 flex items-center justify-end gap-2 text-[10px] text-slate-500">
                                <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded bg-slate-200" /> closed</span>
                                <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded bg-blue-500" /> open</span>
                                <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded bg-slate-100" /> future</span>
                                <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded bg-rose-500" /> year-end</span>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* 4-Step Ribbon */}
            <section className="overflow-hidden rounded-2xl border border-amber-200/60 bg-white shadow-md ring-1 ring-amber-100/50 border-l-[3px] border-l-amber-500">
                <header className="border-b border-slate-100 bg-gradient-to-r from-amber-50/60 via-white to-white px-5 py-4">
                    <div className="flex items-start gap-3">
                        <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-amber-500 text-white text-base shadow-sm ring-1 ring-amber-600">📅</span>
                        <div>
                            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-700">Period close · 4 steps</div>
                            <h2 className="font-display text-lg font-bold text-slate-900">Audit → Variance → Approve → Close</h2>
                            <p className="mt-0.5 text-xs text-slate-500">Same flow for monthly, ad-hoc, and year-end. Step gating enforced.</p>
                        </div>
                    </div>
                </header>
                <div className="grid grid-cols-1 gap-2 px-5 py-5 sm:grid-cols-4">
                    <RibbonStep idx={1} label="Audit count" sub="floor walks · imports · counts" status={activeBatches.length > 0 ? "active" : closedBatches.length > 0 ? "done" : "pending"} detail={`${batches.length} total`} />
                    <RibbonStep idx={2} label="Variance review" sub="auto-flag |Δ| > 2%" status="pending" detail="awaiting variance" />
                    <RibbonStep idx={3} label="Approve" sub="post adjustments" status="pending" detail="plant manager" />
                    <RibbonStep idx={4} label="Close period" sub="freeze · open next" status="pending" detail="any time · last action" />
                </div>
            </section>

            {/* Real lifecycle actions */}
            <section data-testid="period-action-center" className="overflow-hidden rounded-2xl border border-emerald-200/70 bg-white shadow-md ring-1 ring-emerald-100/60 border-l-[3px] border-l-emerald-500">
                <header className="border-b border-slate-100 bg-gradient-to-r from-emerald-50/70 via-white to-white px-5 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                            <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-emerald-600 text-white text-base shadow-sm ring-1 ring-emerald-700">✓</span>
                            <div>
                                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-emerald-700">Live backend controls</div>
                                <h2 className="font-display text-lg font-bold text-slate-900">Open → Count → Approve → Post → Close</h2>
                                <p className="mt-0.5 text-xs text-slate-500">These buttons call the real audit and period endpoints. No old stock-lifecycle route is required.</p>
                            </div>
                        </div>
                        <div className="grid w-full gap-2 sm:w-auto sm:grid-cols-2">
                            <select
                                data-testid="period-select"
                                value={selectedPeriod?.id || ""}
                                onChange={(event) => setSelectedPeriodId(event.target.value)}
                                className="h-10 min-w-[180px] rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 shadow-sm outline-none focus:border-emerald-400"
                            >
                                {(periods as any[]).map((period: any) => (
                                    <option key={period.id} value={period.id}>{period.financial_year} · {period.status}</option>
                                ))}
                            </select>
                            <select
                                data-testid="period-plant-select"
                                value={selectedPlantId}
                                onChange={(event) => setSelectedPlantId(event.target.value)}
                                className="h-10 min-w-[180px] rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 shadow-sm outline-none focus:border-emerald-400"
                            >
                                {plantOptions.length === 0 ? <option value="">No plant</option> : null}
                                {plantOptions.map((plant) => (
                                    <option key={plant.id} value={plant.id}>{plant.code ? `${plant.code} · ` : ""}{plant.name}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </header>
                <div className="grid grid-cols-1 gap-3 p-5 xl:grid-cols-[1.15fr_1fr_1fr]">
                    <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50/70 via-white to-blue-50/40 p-4 xl:col-span-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-700">Count entry desk</div>
                                <div className="mt-1 text-sm font-bold text-slate-900">Pick a loaded stock row, enter physical count, save variance</div>
                                <p className="mt-1 text-[11px] leading-snug text-slate-600">Use this for desktop floor-count updates. The mobile count page still works for scanning.</p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                {(["ALL", "BULK", "ROLL", "PACKAGING"] as const).map((klass) => (
                                    <button
                                        key={klass}
                                        type="button"
                                        onClick={() => setCountStockClass(klass)}
                                        className={cn(
                                            "rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wider",
                                            countStockClass === klass ? "border-emerald-500 bg-emerald-600 text-white shadow-sm" : "border-emerald-200 bg-white text-emerald-700 hover:border-emerald-400"
                                        )}
                                    >
                                        {klass === "ALL" ? "All stock" : klass}
                                    </button>
                                ))}
                            </div>
                        </div>
                        {batchItemsError && (
                            <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-800">
                                {describeApiError(batchItemsError, "Could not load audit count lines.")}
                            </div>
                        )}
                        <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-[1fr_1.4fr_140px_auto]">
                            <input
                                data-testid="period-count-search"
                                value={countSearch}
                                onChange={(event) => setCountSearch(event.target.value)}
                                placeholder="Search material, location, label"
                                className="h-10 rounded-xl border border-emerald-200 bg-white px-3 text-xs font-bold outline-none focus:border-emerald-500"
                            />
                            <select
                                data-testid="period-count-line-select"
                                value={selectedCountLine?.id || ""}
                                onChange={(event) => setCountLineId(event.target.value)}
                                className="h-10 rounded-xl border border-emerald-200 bg-white px-3 text-xs font-bold text-slate-700 outline-none focus:border-emerald-500"
                            >
                                {batchItemsLoading ? <option value="">Loading stock rows...</option> : null}
                                {!batchItemsLoading && filteredCountItems.length === 0 ? <option value="">No rows loaded. Use Load plant stock.</option> : null}
                                {filteredCountItems.slice(0, 200).map((row: any) => (
                                    <option key={row.id} value={row.id}>{countLineLabel(row)}</option>
                                ))}
                            </select>
                            <input
                                data-testid="period-counted-qty"
                                value={countedQty}
                                onChange={(event) => setCountedQty(event.target.value)}
                                placeholder="Counted qty"
                                className="h-10 rounded-xl border border-emerald-200 bg-white px-3 text-xs font-bold outline-none focus:border-emerald-500"
                            />
                            <Button
                                data-testid="period-count-save"
                                size="sm"
                                disabled={!workflowBatch || workflowBatch.status !== "DRAFT" || !selectedCountLine || countLineMutation.isPending}
                                onClick={() => countLineMutation.mutate()}
                                className="h-10 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700"
                            >
                                {countLineMutation.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                                Save count
                            </Button>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                            <span>
                                Loaded rows: <b className="text-slate-800">{batchItems.length}</b>
                                {selectedCountLine ? <> · System: <b className="text-slate-800">{Number(selectedCountLine.systemQty ?? 0).toLocaleString()} {selectedCountLine.uom || ""}</b></> : null}
                            </span>
                            <div className="flex flex-wrap items-center gap-2">
                                <Button size="sm" variant="outline" disabled={createBatchMutation.isPending} onClick={() => createBatchMutation.mutate("CHUNKED")} className="h-8 rounded-lg border-emerald-200 bg-white text-emerald-700">+ New quick count</Button>
                                <Button data-testid="period-load-stock" size="sm" variant="outline" disabled={!workflowBatch || workflowBatch.status !== "DRAFT" || loadBatchStockMutation.isPending} onClick={() => loadBatchStockMutation.mutate()} className="h-8 rounded-lg border-blue-200 bg-white text-blue-700">
                                    {loadBatchStockMutation.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                                    Load plant stock
                                </Button>
                            </div>
                        </div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Batch workflow</div>
                                <div className="mt-1 text-sm font-bold text-slate-900">Submit, approve, and post counts</div>
                            </div>
                            <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-slate-600 ring-1 ring-slate-200">{workflowBatch?.status || "NO BATCH"}</span>
                        </div>
                        <select
                            data-testid="period-batch-select"
                            value={workflowBatch?.id || ""}
                            onChange={(event) => setSelectedBatchId(event.target.value)}
                            className="mt-3 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 outline-none focus:border-emerald-400"
                        >
                            {(batches as any[]).length === 0 ? <option value="">No audit batch</option> : null}
                            {(batches as any[]).slice(0, 30).map((batch: any) => (
                                <option key={batch.id} value={batch.id}>{batch.code || batch.batch_no} · {batch.type} · {batch.status}</option>
                            ))}
                        </select>
                        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                            <Button data-testid="period-batch-validate" size="sm" variant="outline" disabled={!workflowBatch || batchActionMutation.isPending} onClick={() => batchActionMutation.mutate("VALIDATE")} className="rounded-lg">Validate</Button>
                            <Button data-testid="period-batch-submit" size="sm" variant="outline" disabled={!workflowBatch || workflowBatch.status !== "DRAFT" || batchActionMutation.isPending} onClick={() => batchActionMutation.mutate("SUBMIT")} className="rounded-lg">Submit</Button>
                            <Button data-testid="period-batch-approve" size="sm" variant="outline" disabled={!workflowBatch || workflowBatch.status !== "SUBMITTED" || batchActionMutation.isPending} onClick={() => batchActionMutation.mutate("APPROVE")} className="rounded-lg">Approve</Button>
                            <Button data-testid="period-batch-post" size="sm" disabled={!workflowBatch || !["DRAFT", "APPROVED"].includes(String(workflowBatch.status || "")) || batchActionMutation.isPending} onClick={() => batchActionMutation.mutate("POST")} className="rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">Post</Button>
                        </div>
                        <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500">
                            <span>Lines: <b className="text-slate-800">{workflowBatch?.line_count || 0}</b></span>
                            <Link href={workflowBatch?.id ? `/inventory/count?batch=${workflowBatch.id}` : "/inventory/count"} className="font-bold text-blue-700 hover:underline">Open mobile count</Link>
                        </div>
                    </div>

                    <div className="rounded-2xl border border-blue-200 bg-blue-50/40 p-4">
                        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-700">Period close</div>
                        <div className="mt-1 text-sm font-bold text-slate-900">{selectedPeriod?.financial_year || "Pick period"} · {selectedPeriod?.status || "—"}</div>
                        <p className="mt-1 min-h-[32px] text-[11px] leading-snug text-slate-600">Close checks negative stock, draft counts, open jobwork, and inter-plant blockers before it freezes closing and opens next FY.</p>
                        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                            <Button size="sm" variant="outline" disabled={openPreviewMutation.isPending || !selectedPeriod} onClick={() => openPreviewMutation.mutate()} className="rounded-lg border-blue-200 bg-white text-blue-700">Preview</Button>
                            <Button data-testid="period-begin-close" size="sm" variant="outline" disabled={periodActionMutation.isPending || !selectedPeriod || selectedPeriod.status === "CLOSED"} onClick={() => periodActionMutation.mutate("BEGIN_CLOSE")} className="rounded-lg border-amber-200 bg-white text-amber-700">Begin close</Button>
                            <Button data-testid="period-close" size="sm" disabled={periodActionMutation.isPending || !selectedPeriod || !selectedPlantId || selectedPeriod.status === "CLOSED"} onClick={() => periodActionMutation.mutate("CLOSE")} className="rounded-lg bg-blue-600 text-white hover:bg-blue-700">Close</Button>
                        </div>
                    </div>

                    <div className="rounded-2xl border border-orange-200 bg-orange-50/40 p-4">
                        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-700">FY correction</div>
                        <div className="mt-1 text-sm font-bold text-slate-900">{selectedCorrectionPeriod?.financial_year || "No closed FY yet"}</div>
                        <p className="mt-1 min-h-[32px] text-[11px] leading-snug text-slate-600">Corrections are locked to closed financial years and sync the next opening balance after approval.</p>
                        <select
                            data-testid="correction-period-select"
                            value={selectedCorrectionPeriod?.id || ""}
                            onChange={(event) => setCorrectionPeriodId(event.target.value)}
                            className="mt-3 h-9 w-full rounded-lg border border-orange-200 bg-white px-2 text-xs font-bold text-slate-700 outline-none focus:border-orange-400"
                        >
                            {closedPeriods.length === 0 ? <option value="">No closed year</option> : null}
                            {closedPeriods.map((period: any) => (
                                <option key={period.id} value={period.id}>{period.financial_year}</option>
                            ))}
                        </select>
                        <select
                            data-testid="correction-row-select"
                            value={selectedCorrectionRow ? stockRowKey(selectedCorrectionRow) : ""}
                            onChange={(event) => setCorrectionRowKey(event.target.value)}
                            className="mt-2 h-9 w-full rounded-lg border border-orange-200 bg-white px-2 text-xs font-bold text-slate-700 outline-none focus:border-orange-400"
                        >
                            {snapshotRows.length === 0 ? <option value="">No stock row</option> : null}
                            {snapshotRows.slice(0, 100).map((row) => (
                                <option key={stockRowKey(row)} value={stockRowKey(row)}>{row.stock_class} · {row.material_code} · {row.location_name} · {Number(row.qty || 0).toLocaleString()}</option>
                            ))}
                        </select>
                        <div className="mt-2 grid grid-cols-[1fr_1.3fr] gap-2">
                            <input data-testid="correction-counted-qty" value={correctionQty} onChange={(event) => setCorrectionQty(event.target.value)} placeholder="Correct qty" className="h-9 rounded-lg border border-orange-200 bg-white px-2 text-xs font-bold outline-none focus:border-orange-400" />
                            <input data-testid="correction-notes" value={correctionNotes} onChange={(event) => setCorrectionNotes(event.target.value)} placeholder="Reason" className="h-9 rounded-lg border border-orange-200 bg-white px-2 text-xs font-bold outline-none focus:border-orange-400" />
                        </div>
                        <Button data-testid="fy-correction-post" size="sm" disabled={correctionMutation.isPending || !selectedCorrectionPeriod || !selectedCorrectionRow} onClick={() => correctionMutation.mutate()} className="mt-2 w-full rounded-lg bg-orange-600 text-white hover:bg-orange-700">
                            {correctionMutation.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                            Create + approve + post
                        </Button>
                    </div>
                </div>
            </section>

            {/* Audit batches list */}
            <section className="overflow-hidden rounded-2xl border border-violet-200/60 bg-white shadow-md ring-1 ring-violet-100/50 border-l-[3px] border-l-violet-500">
                <header className="flex items-start justify-between gap-3 border-b border-slate-100 bg-gradient-to-r from-violet-50/80 via-white to-white px-5 py-4">
                    <div className="flex items-start gap-3">
                        <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-violet-600 text-white text-base shadow-sm ring-1 ring-violet-700">🧾</span>
                        <div>
                            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-violet-700">Audit batches · {batches.length}</div>
                            <h2 className="font-display text-lg font-bold text-slate-900">Stock counts</h2>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button size="sm" variant="outline" disabled={createBatchMutation.isPending} onClick={() => createBatchMutation.mutate("FULL")} className="rounded-lg border-violet-200 bg-violet-50 text-violet-700">+ Full count (all)</Button>
                        <Button size="sm" variant="outline" disabled={createBatchMutation.isPending} onClick={() => createBatchMutation.mutate("CHUNKED")} className="rounded-lg border-blue-200 bg-blue-50 text-blue-700">+ Quick count (chunk)</Button>
                    </div>
                </header>
                {batchesLoading ? (
                    <div className="px-5 py-8 text-center text-sm text-slate-500">Loading audit batches…</div>
                ) : batches.length === 0 ? (
                    <div className="px-5 py-12 text-center">
                        <Database className="mx-auto h-8 w-8 text-slate-300" />
                        <div className="mt-3 text-sm font-bold text-slate-900">No audit batches yet</div>
                        <p className="mt-1 text-xs text-slate-500">Run a count to keep the system in sync with the floor.</p>
                        <Button disabled={createBatchMutation.isPending} onClick={() => createBatchMutation.mutate("CHUNKED")} className="mt-4 gap-1.5 rounded-xl">
                            {createBatchMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                            + New audit batch
                        </Button>
                    </div>
                ) : (
                    <div className="divide-y divide-slate-100">
                        {(batches as any[]).slice(0, 8).map((b: any) => (
                            <BatchRow key={b.id} batch={b} />
                        ))}
                    </div>
                )}
            </section>

            {/* Day-0 wizard */}
            <section className="overflow-hidden rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50/40 via-white to-violet-50/40 shadow-md">
                <div className="grid grid-cols-1 gap-0 lg:grid-cols-[1fr_300px]">
                    <div className="p-5">
                        <div className="flex items-center gap-2">
                            <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-white">DAY 0 · GO-LIVE</span>
                            <span className="text-[10px] text-slate-500">multi-plant rollout</span>
                        </div>
                        <h3 className="font-display mt-2 text-xl font-bold text-slate-900">Opening stock wizard</h3>
                        <p className="mt-1 text-sm text-slate-600 leading-relaxed">For initial implementation: enter every (material, location) on hand once. Three modes: bulk CSV import, manual entry by location, or mobile floor walk. Production paused until 100% complete; then system goes live.</p>
                        <div className="mt-3 grid grid-cols-3 gap-2">
                            <ModeCard icon={<Upload className="h-4 w-4" />} label="Bulk CSV" desc="upload · validate · post" />
                            <ModeCard icon={<FileText className="h-4 w-4" />} label="Manual entry" desc="location-by-location" />
                            <Link href="/inventory/count" className="block">
                                <ModeCard icon={<Smartphone className="h-4 w-4" />} label="Mobile count" desc="floor walk · scan" />
                            </Link>
                        </div>
                        <div data-testid="opening-manual-panel" className="mt-4 rounded-2xl border border-blue-200 bg-white/80 p-4">
                            <div className="grid grid-cols-1 gap-2 md:grid-cols-[150px_1.5fr_1fr_120px_110px]">
                                <select
                                    data-testid="opening-stock-class"
                                    value={openingStockClass}
                                    onChange={(event) => {
                                        const next = event.target.value as "BULK" | "ROLL" | "PACKAGING"
                                        setOpeningStockClass(next)
                                        setOpeningMaterialId("")
                                        setOpeningMaterialCode("")
                                        setOpeningUom(next === "PACKAGING" ? "PCS" : "KG")
                                    }}
                                    className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 outline-none focus:border-blue-400"
                                >
                                    <option value="BULK">Bulk</option>
                                    <option value="ROLL">Roll</option>
                                    <option value="PACKAGING">Packaging</option>
                                </select>
                                <MaterialPicker
                                    items={openingMaterials.map((material) => ({
                                        id: String(material.id),
                                        code: String(material.code),
                                        name: String(material.name || material.code),
                                        category: materialCategory(material),
                                        type: materialUom(material, openingStockClass === "PACKAGING" ? "PCS" : "KG"),
                                    }))}
                                    value={openingMaterialId}
                                    onValueChange={(value) => {
                                        const material = openingMaterials.find((m) => String(m.id) === String(value))
                                        setOpeningMaterialId(value)
                                        setOpeningMaterialCode(String(material?.code || ""))
                                        setOpeningUom(materialUom(material, openingStockClass === "PACKAGING" ? "PCS" : "KG"))
                                    }}
                                    placeholder={openingMaterials.length ? "Search material code or name" : "No active material"}
                                    testId="opening-material-code"
                                    disabled={openingMaterials.length === 0}
                                    className="h-10 rounded-xl border-slate-200 text-xs shadow-sm"
                                />
                                <select data-testid="opening-location-code" value={openingLocationCode} onChange={(event) => setOpeningLocationCode(event.target.value)} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 outline-none focus:border-blue-400">
                                    <option value="">Location</option>
                                    {plantLocations.map((location: any) => (
                                        <option key={String(location.id)} value={String(location.id)}>
                                            {location.code || location.location_code || "LOC"} · {location.name || location.location_name || "Location"}
                                        </option>
                                    ))}
                                </select>
                                <input data-testid="opening-qty" value={openingQty} onChange={(event) => setOpeningQty(event.target.value)} placeholder="Qty" className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold outline-none focus:border-blue-400" />
                                <select data-testid="opening-uom" value={openingUom} onChange={(event) => setOpeningUom(event.target.value)} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 outline-none focus:border-blue-400">
                                    <option value="KG">KG</option>
                                    <option value="PCS">PCS</option>
                                    <option value="METER">METER</option>
                                </select>
                            </div>
                            <div className="mt-2 text-[10px] font-semibold text-slate-500">
                                {openingMaterials.length} active {openingStockClass.toLowerCase()} materials available. Purchased add-ons appear under Bulk only when Add-ons Master marks them purchased.
                            </div>
                            {openingStockClass === "ROLL" && (
                                <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-5">
                                    <input data-testid="opening-label-id" value={openingLabelId} onChange={(event) => setOpeningLabelId(event.target.value)} placeholder="Roll label optional" className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold outline-none focus:border-blue-400" />
                                    <input data-testid="opening-batch-no" value={openingBatchNo} onChange={(event) => setOpeningBatchNo(event.target.value)} placeholder="Batch/lot optional" className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold outline-none focus:border-blue-400" />
                                    <input data-testid="opening-width-mm" value={openingWidthMm} onChange={(event) => setOpeningWidthMm(event.target.value)} placeholder="Width mm" className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold outline-none focus:border-blue-400" />
                                    <input data-testid="opening-thickness-micron" value={openingThicknessMicron} onChange={(event) => setOpeningThicknessMicron(event.target.value)} placeholder="Thickness micron" className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold outline-none focus:border-blue-400" />
                                    <input data-testid="opening-length-m" value={openingLengthM} onChange={(event) => setOpeningLengthM(event.target.value)} placeholder="Length m optional" className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold outline-none focus:border-blue-400" />
                                </div>
                            )}
                            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                                <span>Manual opening posts directly as an audited opening batch.</span>
                                <Button data-testid="opening-post-manual" disabled={openingManualMutation.isPending || !selectedPlantId || !openingMaterialId || !openingQty} onClick={() => openingManualMutation.mutate()} size="sm" className="rounded-xl bg-blue-600 text-white hover:bg-blue-700">
                                    {openingManualMutation.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                                    Post opening row
                                </Button>
                            </div>
                        </div>
                    </div>
                    <div className="border-t border-blue-200/60 bg-white/60 p-5 lg:border-t-0 lg:border-l">
                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-blue-700">Completion</div>
                        <div className="font-display mt-1 text-3xl font-bold text-slate-900">{snapshotRows.length}</div>
                        <div className="mt-1 text-[11px] text-slate-500">current stock rows in selected plant.</div>
                        <div className="mt-3 rounded-xl border border-blue-100 bg-white px-3 py-2 text-[11px] text-slate-600">
                            CSV upload remains on the backend endpoint. Manual rows and mobile count are now connected here so Day-0 opening can be tested without old pages.
                        </div>
                        <Button disabled={createBatchMutation.isPending} onClick={() => createBatchMutation.mutate("OPENING")} className="mt-3 w-full gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md">
                            {createBatchMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "▶"}
                            Start wizard
                        </Button>
                    </div>
                </div>
            </section>

            {/* History */}
            <section className="overflow-hidden rounded-2xl border border-slate-200/60 bg-white shadow-md ring-1 ring-slate-100/50">
                <header className="flex items-start gap-3 border-b border-slate-100 bg-gradient-to-r from-slate-50 via-white to-white px-5 py-4">
                    <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-slate-600 text-white text-base shadow-sm ring-1 ring-slate-700">🗂</span>
                    <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Audit history</div>
                        <h2 className="font-display text-lg font-bold text-slate-900">Past audits &amp; closes</h2>
                    </div>
                </header>
                {closedBatches.length === 0 ? (
                    <div className="px-5 py-8 text-center text-sm text-slate-500 italic">No closed audits yet.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full text-xs">
                            <thead className="bg-slate-50/60 text-slate-500">
                                <tr>
                                    <th className="px-3 py-2 text-left font-bold uppercase tracking-wider">Batch</th>
                                    <th className="px-3 py-2 text-left font-bold uppercase tracking-wider">Period</th>
                                    <th className="px-3 py-2 text-right font-bold uppercase tracking-wider">Lines</th>
                                    <th className="px-3 py-2 text-right font-bold uppercase tracking-wider">Variances</th>
                                    <th className="px-3 py-2 text-left font-bold uppercase tracking-wider">Posted by</th>
                                    <th className="px-3 py-2 text-left font-bold uppercase tracking-wider">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {closedBatches.slice(0, 10).map((b: any) => (
                                    <tr key={b.id} className="hover:bg-slate-50">
                                        <td className="px-3 py-2 mono font-bold text-blue-700">{b.code || b.id}</td>
                                        <td className="px-3 py-2 text-slate-600">{b.period_label || "—"}</td>
                                        <td className="px-3 py-2 text-right">{b.line_count || 0}</td>
                                        <td className="px-3 py-2 text-right">{b.variance_count || 0}</td>
                                        <td className="px-3 py-2 text-xs">{b.posted_by_name || "—"}</td>
                                        <td className="px-3 py-2"><span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-emerald-700 ring-1 ring-emerald-200">🔒 {b.status}</span></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>
        </div>
    )
}

// ─── Sub-components ───────────────────────────────────────────────

function PeriodCell({ label, status }: { label: string; status: "closed" | "open" | "future" | "ye" }) {
    const TONE = {
        closed: "bg-slate-100 text-slate-500 ring-slate-200",
        open: "bg-blue-600 text-white shadow-md ring-blue-700 ring-2",
        future: "bg-white text-slate-400 ring-slate-200",
        ye: "bg-gradient-to-br from-rose-500 to-orange-500 text-white shadow-md ring-rose-600",
    }[status]
    return (
        <div className={cn("flex flex-col items-center gap-0.5 rounded-lg ring-1 ring-inset px-2 py-1.5 text-center", TONE)}>
            <span className="text-[9px] font-black uppercase tracking-wider">{label}</span>
            {status === "open" && <span className="text-[9px]">●</span>}
            {status === "closed" && <span className="text-[9px]">✓</span>}
            {status === "ye" && <span className="text-[9px]">YE</span>}
        </div>
    )
}

function RibbonStep({ idx, label, sub, status, detail }: { idx: number; label: string; sub: string; status: "done" | "active" | "pending"; detail: string }) {
    const TONE = {
        done: "border-emerald-400 bg-gradient-to-br from-emerald-50 to-white ring-emerald-200",
        active: "border-amber-400 bg-gradient-to-br from-amber-50 to-white ring-amber-200 ring-2 shadow-md",
        pending: "border-slate-200 bg-white",
    }[status]
    const ICON_BG = { done: "bg-emerald-600 text-white", active: "bg-amber-500 text-white", pending: "bg-slate-200 text-slate-500" }[status]
    const ICON = { done: "✓", active: "⚡", pending: "○" }[status]
    return (
        <div className={cn("rounded-2xl border px-4 py-3 ring-1 hover:shadow-md", TONE)}>
            <div className="flex items-start justify-between">
                <span className={cn("flex h-8 w-8 items-center justify-center rounded-xl text-sm font-black shadow-sm", ICON_BG)}>{ICON}</span>
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Step {idx}</span>
            </div>
            <div className="mt-2 text-sm font-bold text-slate-900">{label}</div>
            <div className="text-[10px] text-slate-500 leading-snug">{sub}</div>
            <div className={cn("mt-2 text-[11px] font-bold", status === "active" ? "text-amber-700" : status === "done" ? "text-emerald-700" : "text-slate-500")}>{detail}</div>
        </div>
    )
}

function BatchRow({ batch }: { batch: any }) {
    const status = String(batch.status || "DRAFT")
    const TONE: Record<string, string> = {
        DRAFT: "bg-slate-50 text-slate-700 ring-slate-200",
        SUBMITTED: "bg-blue-50 text-blue-700 ring-blue-200",
        VALIDATED: "bg-violet-50 text-violet-700 ring-violet-200",
        APPROVED: "bg-amber-50 text-amber-700 ring-amber-200",
        POSTED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
        VOIDED: "bg-rose-50 text-rose-700 ring-rose-200",
    }
    return (
        <div className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-violet-50/30 cursor-pointer">
            <div className="flex items-center gap-3 min-w-0">
                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-violet-50 text-violet-700 text-base ring-1 ring-violet-200">🧾</span>
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-blue-700">{batch.code || batch.id}</span>
                        <span className={cn("rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ring-1 ring-inset", TONE[status] || TONE.DRAFT)}>{status}</span>
                    </div>
                    <div className="text-sm font-bold text-slate-900 truncate">{batch.name || batch.scope || "(unnamed batch)"}</div>
                    <div className="text-[11px] text-slate-500">{batch.period_label || "—"}</div>
                </div>
            </div>
            <div className="flex flex-none items-center gap-3">
                <div className="text-right"><div className="text-[10px] font-black uppercase tracking-wider text-slate-500">Lines</div><div className="font-mono text-xs font-bold text-slate-900">{batch.line_count || 0}</div></div>
                <div className="text-right"><div className="text-[10px] font-black uppercase tracking-wider text-slate-500">Variances</div><div className={cn("font-mono text-xs font-bold", batch.variance_count > 0 ? "text-amber-700" : "text-slate-700")}>{batch.variance_count || 0}</div></div>
                <Link href={`/inventory/count?batch=${batch.id}`}>
                    <Button size="sm" variant="outline" className="rounded-lg gap-1">Open <ArrowRight className="h-3 w-3" /></Button>
                </Link>
            </div>
        </div>
    )
}

function ModeCard({ icon, label, desc }: { icon: React.ReactNode; label: string; desc: string }) {
    return (
        <div className="rounded-xl border border-blue-200 bg-white px-3 py-2.5 text-left shadow-sm hover:shadow-md hover:bg-blue-50/40 cursor-pointer">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-100 text-blue-700">{icon}</div>
            <div className="mt-1.5 text-xs font-bold text-slate-900">{label}</div>
            <div className="text-[10px] text-slate-500">{desc}</div>
        </div>
    )
}
