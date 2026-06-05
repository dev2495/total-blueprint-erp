"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ArrowRightLeft, CheckCircle2, Circle, Loader2, Plus, Truck, PackageCheck, Printer } from "lucide-react"
import { AxiosError } from "axios"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import {
    Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

import { inventoryService, DeliveryChallan } from "@/services/inventory"
import { factoryService, Plant } from "@/services/factory"

export default function InterPlantPage() {
    const { data: challans, isLoading } = useQuery({
        queryKey: ['inter-plant-challans'],
        queryFn: inventoryService.getChallans
    })
    const challanList = Array.isArray(challans) ? challans : []
    const stats = useMemo(() => {
        const draft = challanList.filter((c) => c.status === 'DRAFT').length
        const inTransit = challanList.filter((c) => c.status === 'IN_TRANSIT').length
        const received = challanList.filter((c) => c.status === 'RECEIVED').length
        return {
            total: challanList.length,
            draft,
            inTransit,
            received
        }
    }, [challanList])

    const getStatusBadgeClass = (status: string) => {
        if (status === 'RECEIVED') return "bg-success-bg text-success-fg border-success-border"
        if (status === 'IN_TRANSIT') return "bg-blue-50 text-blue-700 border-blue-200"
        if (status === 'DRAFT') return "bg-warning-bg text-warning-fg border-warning-border"
        return ""
    }

    const drafts = useMemo(() => challanList.filter((c) => c.status === 'DRAFT'), [challanList])
    const inTransit = useMemo(() => challanList.filter((c) => c.status === 'IN_TRANSIT'), [challanList])
    const received = useMemo(() => challanList.filter((c) => c.status === 'RECEIVED'), [challanList])
    const printChallan = (challan: DeliveryChallan) => {
        if (typeof window === "undefined") return
        const win = window.open(`/inter-plant/print/${challan.id}`, "_blank")
        if (!win) {
            toast.error("Popup blocked. Allow popups to print challan.")
            return
        }
    }

    return (
        <div className="space-y-6" data-testid="interplant-page">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Inter-Plant Transfers</h1>
                    <p className="text-muted-foreground">Transfer materials between factory locations.</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button asChild variant="outline">
                        <Link href="/factory/plants">Plant Legal Profiles</Link>
                    </Button>
                    <CreateChallanDialog />
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <Card>
                    <CardHeader className="py-3"><CardTitle className="text-xs uppercase text-slate-500">Total Challans</CardTitle></CardHeader>
                    <CardContent><div className="text-2xl font-black">{stats.total}</div></CardContent>
                </Card>
                <Card>
                    <CardHeader className="py-3"><CardTitle className="text-xs uppercase text-slate-500">Draft</CardTitle></CardHeader>
                    <CardContent><div className="text-2xl font-black text-warning-fg">{stats.draft}</div></CardContent>
                </Card>
                <Card>
                    <CardHeader className="py-3"><CardTitle className="text-xs uppercase text-slate-500">In Transit</CardTitle></CardHeader>
                    <CardContent><div className="text-2xl font-black text-blue-700">{stats.inTransit}</div></CardContent>
                </Card>
                <Card>
                    <CardHeader className="py-3"><CardTitle className="text-xs uppercase text-slate-500">Received</CardTitle></CardHeader>
                    <CardContent><div className="text-2xl font-black text-success-fg">{stats.received}</div></CardContent>
                </Card>
            </div>

            {isLoading ? <div className="flex justify-center"><Loader2 className="animate-spin" /></div> : (
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                    <LifecycleColumn
                        title="Draft"
                        subtitle="Create challan and select dispatch items"
                        icon={<Circle className="h-4 w-4 text-amber-600 fill-amber-600" />}
                        stage="DRAFT"
                        rows={drafts}
                        emptyText="No draft challans."
                        statusClass="border-warning-border bg-amber-50/50"
                        getStatusBadgeClass={getStatusBadgeClass}
                        onPrint={printChallan}
                    />
                    <LifecycleColumn
                        title="In Transit"
                        subtitle="Dispatched and waiting for receipt"
                        icon={<Truck className="h-4 w-4 text-blue-600" />}
                        stage="IN_TRANSIT"
                        rows={inTransit}
                        emptyText="No challans in transit."
                        statusClass="border-blue-200 bg-blue-50/40"
                        getStatusBadgeClass={getStatusBadgeClass}
                        onPrint={printChallan}
                    />
                    <LifecycleColumn
                        title="Received"
                        subtitle="Transfer completed at destination plant"
                        icon={<PackageCheck className="h-4 w-4 text-emerald-600" />}
                        stage="RECEIVED"
                        rows={received}
                        emptyText="No received challans."
                        statusClass="border-success-border bg-emerald-50/40"
                        getStatusBadgeClass={getStatusBadgeClass}
                        onPrint={printChallan}
                    />
                </div>
            )}
        </div>
    )
}

function LifecycleColumn({
    title,
    subtitle,
    icon,
    stage,
    rows,
    emptyText,
    statusClass,
    getStatusBadgeClass,
    onPrint
}: {
    title: string
    subtitle: string
    icon: React.ReactNode
    stage: 'DRAFT' | 'IN_TRANSIT' | 'RECEIVED'
    rows: DeliveryChallan[]
    emptyText: string
    statusClass: string
    getStatusBadgeClass: (status: string) => string
    onPrint: (challan: DeliveryChallan) => void
}) {
    return (
        <Card className={statusClass}>
            <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-black flex items-center gap-2">
                        {icon}
                        {title}
                    </CardTitle>
                    <Badge variant="outline" className="font-bold">{rows.length}</Badge>
                </div>
                <p className="text-xs text-content-3">{subtitle}</p>
            </CardHeader>
            <CardContent className="space-y-3 max-h-[68vh] overflow-y-auto">
                {rows.length === 0 ? (
                    <div className="text-xs text-slate-500 border border-dashed rounded-md p-4 text-center">{emptyText}</div>
                ) : (
                    rows.map((challan) => (
                        <Card key={challan.id} className="border border-slate-200 shadow-none">
                            <CardHeader className="py-3">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="font-mono text-xs font-bold">
                                        {(challan as any).dc_no || `${challan.id.substring(0, 8)}...`}
                                    </div>
                                    <div className="flex items-center gap-1">
                                        {(challan as any).is_system_generated && (
                                            <Badge variant="outline" className="text-[10px] border-blue-200 text-blue-700">
                                                AUTO
                                            </Badge>
                                        )}
                                        <Badge
                                            variant={challan.status === 'RECEIVED' ? "default" : "outline"}
                                            className={getStatusBadgeClass(challan.status)}
                                        >
                                            {challan.status}
                                        </Badge>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent className="pt-0 space-y-3">
                                {(() => {
                                    const summary = challan.transfer_summary
                                    const rollLines = Number(summary?.roll_lines ?? 0)
                                    const bulkLines = Number(summary?.bulk_lines ?? 0)
                                    const outputLines = Number(summary?.output_lines ?? Math.max(rollLines - Number(summary?.remainder_lines ?? 0), 0))
                                    const remainderLines = Number(summary?.remainder_lines ?? 0)
                                    const outputOut = Number(summary?.output_dispatched_kg ?? 0)
                                    const outputIn = Number(summary?.output_received_kg ?? 0)
                                    const remainderOut = Number(summary?.remainder_dispatched_kg ?? 0)
                                    const remainderIn = Number(summary?.remainder_received_kg ?? 0)
                                    const dispatchedTotal = Number(summary?.dispatched_total_kg ?? 0)
                                    const receivedTotal = Number(summary?.received_total_kg ?? 0)

                                    return (
                                        <>
                                <div className="flex items-center gap-2 flex-wrap">
                                    <Badge variant="outline" className="text-[10px]">
                                        ROLL {rollLines}
                                    </Badge>
                                    <Badge variant="outline" className="text-[10px]">
                                        BULK {bulkLines}
                                    </Badge>
                                    <Badge variant="outline" className="text-[10px] border-blue-200 text-blue-700 bg-blue-50">
                                        OUT {outputLines}
                                    </Badge>
                                    <Badge
                                        variant="outline"
                                        className="text-[10px] border-warning-border text-warning-fg bg-warning-bg"
                                        title="Remainder/Balance = unconsumed parent roll returned to reusable stock."
                                    >
                                        REMAINDER {remainderLines}
                                    </Badge>
                                    <Badge variant="secondary" className="text-[10px] bg-slate-100 text-slate-700">
                                        Out {dispatchedTotal.toFixed(3)} kg
                                    </Badge>
                                    <Badge variant="secondary" className="text-[10px] bg-success-bg text-success-fg">
                                        In {receivedTotal.toFixed(3)} kg
                                    </Badge>
                                </div>
                                {(outputLines > 0 || remainderLines > 0) && (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px]">
                                        <div className="rounded-md border border-blue-100 bg-blue-50/50 px-2 py-1.5 text-blue-700">
                                            Output: {outputOut.toFixed(3)} out / {outputIn.toFixed(3)} in kg
                                        </div>
                                        <div className="rounded-md border border-amber-100 bg-amber-50/50 px-2 py-1.5 text-warning-fg">
                                            Remainder: {remainderOut.toFixed(3)} out / {remainderIn.toFixed(3)} in kg
                                        </div>
                                    </div>
                                )}
                                        </>
                                    )
                                })()}
                                <div className="text-xs text-slate-700 flex items-center gap-2">
                                    <span>{challan.from_plant_name}</span>
                                    <ArrowRightLeft className="h-3 w-3 text-content-4" />
                                    <span>{challan.to_plant_name}</span>
                                </div>
                                {(challan.vehicle_no || challan.driver_name || challan.transporter_name) && (
                                    <div className="text-[11px] text-content-3">
                                        Vehicle: {challan.vehicle_no || "—"} | Driver: {challan.driver_name || "—"} | Transporter: {challan.transporter_name || "—"}
                                    </div>
                                )}
                                {Array.isArray(challan.item_preview) && challan.item_preview.length > 0 && (
                                    <div className="rounded-md border border-slate-200 bg-slate-50/70 p-2 space-y-1">
                                        {challan.item_preview.map((line, idx) => (
                                            <div key={`${challan.id}-line-${idx}`} className="text-[11px] text-slate-700 flex items-center justify-between gap-2">
                                                <span className="truncate">
                                                    {line.line_type}
                                                    {line.roll_role ? ` (${line.roll_role})` : ""}
                                                    {' '}• {line.roll_label || line.material_name || "Item"}
                                                </span>
                                                <span className="font-semibold whitespace-nowrap">{Number(line.dispatched_qty_kg || 0).toFixed(3)} kg</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                <div className="grid grid-cols-3 gap-2 text-[10px] text-slate-500">
                                    <div>
                                        <div className="font-semibold uppercase tracking-wide text-content-4">Created</div>
                                        <div>{new Date(challan.created_at || Date.now()).toLocaleString()}</div>
                                    </div>
                                    <div>
                                        <div className="font-semibold uppercase tracking-wide text-content-4">Dispatched</div>
                                        <div>{(challan as any).dispatched_at ? new Date((challan as any).dispatched_at).toLocaleString() : "—"}</div>
                                    </div>
                                    <div>
                                        <div className="font-semibold uppercase tracking-wide text-content-4">Updated</div>
                                        <div>{new Date((challan as any).updated_at || challan.created_at || Date.now()).toLocaleString()}</div>
                                    </div>
                                </div>
                                <div className="flex items-center justify-end gap-2">
                                    <Button variant="outline" size="sm" onClick={() => onPrint(challan)}>
                                        <Printer className="h-3 w-3 mr-1" />
                                        Print
                                    </Button>
                                    {stage === 'DRAFT' && <DispatchChallanDialog challan={challan} />}
                                    {stage === 'IN_TRANSIT' && <ReceiveChallanDialog challan={challan} />}
                                    {stage === 'RECEIVED' && (
                                        <Badge className="bg-emerald-100 text-success-fg border-success-border">Closed</Badge>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    ))
                )}
            </CardContent>
        </Card>
    )
}

function CreateChallanDialog() {
    const [open, setOpen] = useState(false)
    const [fromPlant, setFromPlant] = useState("")
    const [toPlant, setToPlant] = useState("")
    const [transferMode, setTransferMode] = useState<"ROLL" | "BULK">("ROLL")
    const [materialFilter, setMaterialFilter] = useState("ALL")
    const [sourceLocationFilter, setSourceLocationFilter] = useState("")
    const [destinationLocationId, setDestinationLocationId] = useState("")
    const [dispatchNow, setDispatchNow] = useState(true)
    const [selectedRolls, setSelectedRolls] = useState<string[]>([])
    const [bulkQtyByKey, setBulkQtyByKey] = useState<Record<string, string>>({})
    const queryClient = useQueryClient()
    const { data: plants } = useQuery<Plant[]>({ queryKey: ['plants'], queryFn: factoryService.getPlants })
    const { data: sourceLocations } = useQuery({
        queryKey: ['create-challan-source-locations', fromPlant],
        queryFn: () => inventoryService.getLocations(fromPlant),
        enabled: open && Boolean(fromPlant)
    })
    const { data: destinationLocations } = useQuery({
        queryKey: ['create-challan-destination-locations', toPlant],
        queryFn: () => inventoryService.getLocations(toPlant),
        enabled: open && Boolean(toPlant)
    })
    const { data: rolls } = useQuery({
        queryKey: ['create-challan-rolls', fromPlant],
        queryFn: () => inventoryService.getRollStock(fromPlant),
        enabled: open && Boolean(fromPlant) && transferMode === "ROLL"
    })
    const { data: bulkStock } = useQuery({
        queryKey: ['create-challan-bulk', fromPlant],
        queryFn: () => inventoryService.getBulkStock({ plant: fromPlant }),
        enabled: open && Boolean(fromPlant) && transferMode === "BULK"
    })

    const sourceLocationMeta = useMemo(() => {
        const map = new Map<string, { id: string; name: string; code: string }>()
        ;((sourceLocations || []) as any[])
            .filter((l: any) => l.is_active)
            .forEach((l: any) => {
                const id = String(l.id || l.location_id || "")
                if (!id) return
                map.set(id, {
                    id,
                    name: String(l.name || l.location_name || l.code || "Location"),
                    code: String(l.code || "")
                })
            })
        return map
    }, [sourceLocations])
    const destinationLocationOptions = useMemo(
        () => ((destinationLocations || []) as any[]).filter((l: any) => l.is_active && l.type !== 'IN_TRANSIT'),
        [destinationLocations]
    )
    const rawAvailableRolls = ((rolls || []) as any[]).filter((r: any) => r.status === 'AVAILABLE')
    const rawAvailableBulk = ((bulkStock || []) as any[]).filter((b: any) => Number(b.qty_kg || 0) > 0)
    const sourceLocationOptions = useMemo(() => {
        const pool = transferMode === "ROLL" ? rawAvailableRolls : rawAvailableBulk
        const grouped = new Map<string, { id: string; name: string; code: string; qty: number }>()
        pool.forEach((item: any) => {
            const locationId = String(item.location || item.location_id || "")
            if (!locationId) return
            const materialName = String(item.material_name || item.material_code || "")
            if (materialFilter !== "ALL" && materialName !== materialFilter) return
            const qty = transferMode === "ROLL"
                ? Number(item.weight_kg || 0)
                : Number(item.qty_kg || 0)
            if (!Number.isFinite(qty) || qty <= 0) return

            const base = sourceLocationMeta.get(locationId)
            const existing = grouped.get(locationId)
            const nextQty = Number((existing?.qty || 0) + qty)
            grouped.set(locationId, {
                id: locationId,
                name: String(base?.name || item.location_name || item.location || "Location"),
                code: String(base?.code || ""),
                qty: nextQty
            })
        })
        return Array.from(grouped.values()).sort((a, b) => Number(b.qty || 0) - Number(a.qty || 0))
    }, [transferMode, rawAvailableRolls, rawAvailableBulk, materialFilter, sourceLocationMeta])
    const availableRolls = useMemo(() => {
        return rawAvailableRolls.filter((r: any) => {
            const locationId = String(r.location || r.location_id || "")
            const materialName = String(r.material_name || r.material_code || "")
            const locationOk = !sourceLocationFilter || locationId === sourceLocationFilter
            const materialOk = materialFilter === "ALL" || materialName === materialFilter
            return locationOk && materialOk
        })
    }, [rawAvailableRolls, sourceLocationFilter, materialFilter])
    const availableBulk = useMemo(() => {
        return rawAvailableBulk.filter((b: any) => {
            const locationId = String(b.location || b.location_id || "")
            const materialName = String(b.material_name || b.material_code || "")
            const locationOk = !sourceLocationFilter || locationId === sourceLocationFilter
            const materialOk = materialFilter === "ALL" || materialName === materialFilter
            return locationOk && materialOk
        })
    }, [rawAvailableBulk, sourceLocationFilter, materialFilter])
    const materialOptions = useMemo(() => {
        const set = new Set<string>()
        const pool = transferMode === "ROLL" ? rawAvailableRolls : rawAvailableBulk
        pool.forEach((item: any) => {
            const label = String(item.material_name || item.material_code || "").trim()
            if (label) set.add(label)
        })
        return ["ALL", ...Array.from(set).sort((a, b) => a.localeCompare(b))]
    }, [transferMode, rawAvailableBulk, rawAvailableRolls])
    const selectedBulkItems = useMemo(() => {
        return availableBulk
            .map((b: any) => {
                const key = `${String(b.material)}:${String(b.location)}`
                const qty = Number(bulkQtyByKey[key] || 0)
                if (!Number.isFinite(qty) || qty <= 0) return null
                return {
                    material_id: b.material,
                    quantity: qty,
                    location_id: b.location
                }
            })
            .filter(Boolean) as Array<{ material_id: string; quantity: number; location_id: string }>
    }, [availableBulk, bulkQtyByKey])

    const mutation = useMutation({
        mutationFn: async () => {
            if (!fromPlant || !toPlant) throw new Error("Source and destination plants are required.")
            if (fromPlant === toPlant) throw new Error("Source and destination must be different.")
            const created = await inventoryService.createChallan({ from_plant: fromPlant, to_plant: toPlant })
            const challanId = (created as any)?.data?.id || (created as any)?.id
            if (!challanId) throw new Error("Failed to create challan.")
            if (!dispatchNow) return
            if (!destinationLocationId) throw new Error("Select destination location.")
            if (transferMode === "ROLL") {
                if (selectedRolls.length === 0) throw new Error("Select at least one roll for dispatch.")
                await inventoryService.dispatchChallan(challanId, {
                    target_location_id: destinationLocationId,
                    roll_ids: selectedRolls
                })
            } else {
                if (selectedBulkItems.length === 0) throw new Error("Enter quantity for at least one bulk line.")
                await inventoryService.dispatchChallan(challanId, {
                    target_location_id: destinationLocationId,
                    bulk_items: selectedBulkItems
                })
            }
        },
        onSuccess: async () => {
            toast.success(dispatchNow ? "Challan created and dispatched" : "Challan created in draft")
            setOpen(false)
            setFromPlant("")
            setToPlant("")
            setTransferMode("ROLL")
            setDispatchNow(true)
            setSelectedRolls([])
            setBulkQtyByKey({})
            await queryClient.invalidateQueries({ queryKey: ['inter-plant-challans'] })
            await queryClient.refetchQueries({ queryKey: ['inter-plant-challans'], type: 'active' })
        },
        onError: (err: AxiosError<{ detail: string }>) => {
            const msg = (err.response?.data as any)?.error || err.response?.data?.detail || (err as any)?.message || "Create failed"
            toast.error(msg)
        }
    })

    useEffect(() => {
        if (!open) return
        setSelectedRolls([])
        setBulkQtyByKey({})
        setMaterialFilter("ALL")
        setSourceLocationFilter("")
    }, [open, fromPlant, transferMode])

    useEffect(() => {
        if (!open) return
        const rows = Array.isArray(plants) ? plants : []
        if (!rows.length) return
        if (!fromPlant) {
            setFromPlant(String(rows[0].id))
        }
        if (!toPlant) {
            const candidate = rows.find((p: any) => String(p.id) !== String(rows[0].id))
            setToPlant(String((candidate || rows[0]).id))
        }
    }, [open, plants, fromPlant, toPlant])

    useEffect(() => {
        if (!open) return
        if (!fromPlant || !toPlant || String(fromPlant) !== String(toPlant)) return
        const rows = Array.isArray(plants) ? plants : []
        const candidate = rows.find((p: any) => String(p.id) !== String(fromPlant))
        if (candidate) setToPlant(String(candidate.id))
    }, [open, plants, fromPlant, toPlant])

    useEffect(() => {
        if (!open) return
        if (destinationLocationOptions.length === 0) {
            setDestinationLocationId("")
            return
        }
        if (!destinationLocationId || !destinationLocationOptions.some((loc: any) => String(loc.id) === String(destinationLocationId))) {
            setDestinationLocationId(String(destinationLocationOptions[0].id))
        }
    }, [open, destinationLocationOptions, destinationLocationId])

    // Auto-select and keep source location valid for selected material + source plant
    useEffect(() => {
        if (!open) return
        if (!sourceLocationOptions.length) {
            setSourceLocationFilter("")
            return
        }
        if (!sourceLocationFilter || !sourceLocationOptions.some((loc: any) => String(loc.id) === String(sourceLocationFilter))) {
            setSourceLocationFilter(String(sourceLocationOptions[0].id))
        }
    }, [open, sourceLocationOptions, sourceLocationFilter])

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button data-testid="interplant-new-transfer"><Plus className="h-4 w-4 mr-2" /> New Transfer</Button></DialogTrigger>
            <DialogContent className="max-w-3xl">
                <DialogHeader>
                    <DialogTitle>Create Inter-Plant Challan</DialogTitle>
                    <DialogDescription>
                        One flow for DC lifecycle. Pick plants, select material lines, then create draft or dispatch immediately.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                            <label className="text-xs font-semibold text-content-3">Source Plant</label>
                            <Select value={fromPlant} onValueChange={(value) => { setFromPlant(value); setSourceLocationFilter("") }}>
                                <SelectTrigger data-testid="interplant-from-plant"><SelectValue placeholder="Select Source" /></SelectTrigger>
                                <SelectContent>{(plants || []).map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-semibold text-content-3">Destination Plant</label>
                            <Select value={toPlant} onValueChange={setToPlant}>
                                <SelectTrigger data-testid="interplant-to-plant"><SelectValue placeholder="Select Destination" /></SelectTrigger>
                                <SelectContent>{(plants || []).map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                            <label className="text-xs font-semibold text-content-3">Material Type</label>
                            <Select value={transferMode} onValueChange={(v: "ROLL" | "BULK") => setTransferMode(v)}>
                                <SelectTrigger data-testid="interplant-transfer-mode"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="ROLL">Rolls</SelectItem>
                                    <SelectItem value="BULK">Bulk</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex items-end pb-2">
                            <label className="flex items-center gap-2 text-sm">
                                <Checkbox checked={dispatchNow} onCheckedChange={(v) => setDispatchNow(Boolean(v))} />
                                Dispatch immediately after create
                            </label>
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                        <div className="space-y-1">
                            <label className="text-xs font-semibold text-content-3">Material</label>
                            <Select value={materialFilter} onValueChange={(value) => { setMaterialFilter(value); setSourceLocationFilter("") }}>
                                <SelectTrigger data-testid="interplant-material-filter"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {materialOptions.map((label) => (
                                        <SelectItem key={label} value={label}>
                                            {label === "ALL" ? "All Materials" : label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-semibold text-content-3">Source Location</label>
                            <Select value={sourceLocationFilter} onValueChange={setSourceLocationFilter}>
                                <SelectTrigger data-testid="interplant-source-location"><SelectValue placeholder="Select source location" /></SelectTrigger>
                                <SelectContent>
                                    {sourceLocationOptions.map((loc: any) => (
                                        <SelectItem key={String(loc.id)} value={String(loc.id)}>
                                            {loc.name}{loc.code ? ` (${loc.code})` : ""} • {Number(loc.qty || 0).toFixed(3)} kg
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-semibold text-content-3">Destination Location</label>
                            <Select value={destinationLocationId} onValueChange={setDestinationLocationId}>
                                <SelectTrigger data-testid="interplant-destination-location"><SelectValue placeholder="Select destination location" /></SelectTrigger>
                                <SelectContent>
                                    {destinationLocationOptions.map((loc: any) => (
                                        <SelectItem key={String(loc.id)} value={String(loc.id)}>
                                            {loc.name} ({loc.code})
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {destinationLocationId && (
                        <div className="text-xs text-slate-500">
                            Destination location is captured for receiving workflow guidance.
                        </div>
                    )}

                    {transferMode === "ROLL" ? (
                        <Card>
                            <CardHeader className="py-3">
                                <CardTitle className="text-sm">Available Rolls</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-2 max-h-52 overflow-y-auto">
                                {availableRolls.length === 0 && <p className="text-sm text-muted-foreground">No available rolls at selected source plant.</p>}
                                {availableRolls.map((r: any) => {
                                    const checked = selectedRolls.includes(String(r.id))
                                    return (
                                        <div key={r.id} className="flex items-center justify-between border rounded-md px-2 py-2">
                                            <div className="flex items-center gap-2">
                                                <Checkbox
                                                    data-testid={`interplant-create-roll-${r.id}`}
                                                    checked={checked}
                                                    onCheckedChange={(v) => {
                                                        if (v) setSelectedRolls(prev => [...prev, String(r.id)])
                                                        else setSelectedRolls(prev => prev.filter(id => id !== String(r.id)))
                                                    }}
                                                />
                                                <div className="text-sm">
                                                    <div className="font-semibold">{r.label_id}</div>
                                                    <div className="text-xs text-muted-foreground">{r.material_name} • {r.weight_kg} kg • {r.location_name}</div>
                                                </div>
                                            </div>
                                        </div>
                                    )
                                })}
                            </CardContent>
                        </Card>
                    ) : (
                        <Card>
                            <CardHeader className="py-3">
                                <CardTitle className="text-sm">Available Bulk (select qty by location)</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-2 max-h-52 overflow-y-auto">
                                {availableBulk.length === 0 && <p className="text-sm text-muted-foreground">No bulk stock at selected source plant.</p>}
                                {availableBulk.map((b: any) => {
                                    const key = `${String(b.material)}:${String(b.location)}`
                                    return (
                                        <div key={key} className="grid grid-cols-12 gap-2 border rounded-md px-2 py-2 items-center">
                                            <div className="col-span-8">
                                                <div className="text-sm font-semibold">{b.material_name}</div>
                                                <div className="text-xs text-muted-foreground">{b.location_name} • Available {Number(b.qty_kg || 0).toFixed(3)} kg</div>
                                            </div>
                                            <div className="col-span-4">
                                                <Input
                                                    type="number"
                                                    step="0.001"
                                                    min="0"
                                                    max={Number(b.qty_kg || 0)}
                                                    placeholder="Qty kg"
                                                    value={bulkQtyByKey[key] || ""}
                                                    onChange={(e) => setBulkQtyByKey(prev => ({ ...prev, [key]: e.target.value }))}
                                                />
                                            </div>
                                        </div>
                                    )
                                })}
                            </CardContent>
                        </Card>
                    )}

                    <Button
                        data-testid="interplant-create-submit"
                        type="button"
                        className="w-full"
                        disabled={mutation.isPending || !fromPlant || !toPlant || fromPlant === toPlant}
                        onClick={() => mutation.mutate()}
                    >
                        {mutation.isPending ? "Saving..." : (dispatchNow ? "Create + Dispatch" : "Create Draft")}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}

function DispatchChallanDialog({ challan }: { challan: DeliveryChallan }) {
    const [open, setOpen] = useState(false)
    const [selectedRolls, setSelectedRolls] = useState<string[]>([])
    const [bulkQtyByKey, setBulkQtyByKey] = useState<Record<string, string>>({})
    const queryClient = useQueryClient()

    const { data: rolls } = useQuery({
        queryKey: ['rolls', challan.from_plant],
        queryFn: () => inventoryService.getRollStock(challan.from_plant),
        enabled: open
    })
    const { data: bulkStock } = useQuery({
        queryKey: ['bulk-stock', challan.from_plant],
        queryFn: () => inventoryService.getBulkStock({ plant: challan.from_plant }),
        enabled: open
    })

    const mutation = useMutation({
        mutationFn: (payload: { roll_ids: string[]; bulk_items: Array<{ material_id: string; quantity: number; location_id: string }> }) =>
            inventoryService.dispatchChallan(challan.id, payload),
        onSuccess: async () => {
            toast.success("Dispatched")
            setOpen(false)
            setSelectedRolls([])
            setBulkQtyByKey({})
            await queryClient.invalidateQueries({ queryKey: ['inter-plant-challans'] })
            await queryClient.invalidateQueries({ queryKey: ['stock'] })
            await queryClient.refetchQueries({ queryKey: ['inter-plant-challans'], type: 'active' })
        },
        onError: (err: AxiosError<{ detail: string }>) => {
            const msg = (err.response?.data as any)?.error || err.response?.data?.detail || "Dispatch Failed"
            toast.error(msg)
        }
    })

    const availableRolls = (rolls || []).filter((r: any) => r.status === 'AVAILABLE')
    const availableBulk = (bulkStock || []).filter((b: any) => Number(b.qty_kg || 0) > 0)
    const selectedBulkItems = useMemo(() => {
        return availableBulk
            .map((b: any) => {
                const key = `${String(b.material)}:${String(b.location)}`
                const qty = Number(bulkQtyByKey[key] || 0)
                if (!Number.isFinite(qty) || qty <= 0) return null
                return {
                    material_id: b.material,
                    quantity: qty,
                    location_id: b.location
                }
            })
            .filter(Boolean) as Array<{ material_id: string; quantity: number; location_id: string }>
    }, [availableBulk, bulkQtyByKey])

    if (challan.status !== 'DRAFT') return null

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button variant="outline" size="sm" data-testid={`interplant-dispatch-trigger-${challan.id}`}>Dispatch</Button></DialogTrigger>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Dispatch Challan</DialogTitle>
                    <DialogDescription>Select rolls and bulk lines to move into source IN_TRANSIT.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                    <Card>
                        <CardHeader className="py-3">
                            <CardTitle className="text-sm">Roll Lines</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2 max-h-44 overflow-y-auto">
                            {availableRolls.length === 0 && <p className="text-sm text-muted-foreground">No available rolls.</p>}
                            {availableRolls.map((r: any) => {
                                const checked = selectedRolls.includes(r.id)
                                return (
                                    <div key={r.id} className="flex items-center justify-between border rounded-md px-2 py-2">
                                        <div className="flex items-center gap-2">
                                            <Checkbox
                                                data-testid={`interplant-dispatch-roll-${challan.id}-${r.id}`}
                                                checked={checked}
                                                onCheckedChange={(v) => {
                                                    if (v) setSelectedRolls(prev => [...prev, r.id])
                                                    else setSelectedRolls(prev => prev.filter(id => id !== r.id))
                                                }}
                                            />
                                            <div className="text-sm">
                                                <div className="font-semibold">{r.label_id}</div>
                                                <div className="text-xs text-muted-foreground">{r.material_name} • {r.weight_kg} kg</div>
                                            </div>
                                        </div>
                                        <div className="text-xs text-muted-foreground">{r.location_name}</div>
                                    </div>
                                )
                            })}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="py-3">
                            <CardTitle className="text-sm">Bulk Lines</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2 max-h-44 overflow-y-auto">
                            {availableBulk.length === 0 && <p className="text-sm text-muted-foreground">No bulk stock available.</p>}
                            {availableBulk.map((b: any) => {
                                const key = `${String(b.material)}:${String(b.location)}`
                                return (
                                    <div key={key} className="grid grid-cols-12 gap-2 border rounded-md px-2 py-2 items-center">
                                        <div className="col-span-8">
                                            <div className="text-sm font-semibold">{b.material_name}</div>
                                            <div className="text-xs text-muted-foreground">{b.location_name} • Available {Number(b.qty_kg || 0).toFixed(3)} kg</div>
                                        </div>
                                        <div className="col-span-4">
                                            <Input
                                                type="number"
                                                step="0.001"
                                                min="0"
                                                max={Number(b.qty_kg || 0)}
                                                placeholder="Qty kg"
                                                value={bulkQtyByKey[key] || ""}
                                                onChange={(e) => setBulkQtyByKey(prev => ({ ...prev, [key]: e.target.value }))}
                                            />
                                        </div>
                                    </div>
                                )
                            })}
                        </CardContent>
                    </Card>

                    <p className="text-xs text-muted-foreground">
                        Selected: {selectedRolls.length} roll(s), {selectedBulkItems.length} bulk line(s)
                    </p>

                    <Button
                        data-testid={`interplant-dispatch-submit-${challan.id}`}
                        className="w-full"
                        onClick={() => mutation.mutate({ roll_ids: selectedRolls, bulk_items: selectedBulkItems })}
                        disabled={(selectedRolls.length === 0 && selectedBulkItems.length === 0) || mutation.isPending}
                    >
                        Confirm Dispatch
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}

function ReceiveChallanDialog({ challan }: { challan: DeliveryChallan }) {
    const [open, setOpen] = useState(false)
    const queryClient = useQueryClient()

    const { data: locations } = useQuery({
        queryKey: ['locations', challan.to_plant],
        queryFn: () => inventoryService.getLocations(challan.to_plant),
        enabled: open
    })
    const { data: fromLocations } = useQuery({
        queryKey: ['from-locations', challan.from_plant],
        queryFn: () => inventoryService.getLocations(challan.from_plant),
        enabled: open
    })

    const transitLocation = useMemo(
        () => (fromLocations || []).find((l: any) => String(l.code).toUpperCase() === 'IN_TRANSIT'),
        [fromLocations]
    )

    const { data: transitRolls } = useQuery({
        queryKey: ['transit-rolls', challan.id, transitLocation?.id],
        queryFn: () => inventoryService.getRollStock(challan.from_plant, transitLocation!.id),
        enabled: open && Boolean(transitLocation?.id)
    })
    const { data: transitBulk } = useQuery({
        queryKey: ['transit-bulk', challan.id, transitLocation?.id],
        queryFn: () => inventoryService.getBulkStock({ plant: challan.from_plant, location: transitLocation!.id }),
        enabled: open && Boolean(transitLocation?.id)
    })

    const [targetLocation, setTargetLocation] = useState("")
    const [selectedRollIds, setSelectedRollIds] = useState<string[]>([])
    const [bulkQtyByKey, setBulkQtyByKey] = useState<Record<string, string>>({})
    const receiveLocationOptions = useMemo(
        () => ((locations || []) as any[]).filter((l: any) => l.is_active && l.type !== 'IN_TRANSIT'),
        [locations]
    )

    useEffect(() => {
        if (!open) return
        const allRollIds = ((transitRolls || []) as any[])
            .filter((r: any) => r.status === 'AVAILABLE')
            .map((r: any) => String(r.id))
        setSelectedRollIds(allRollIds)
    }, [open, transitRolls])

    useEffect(() => {
        if (!open) return
        if (receiveLocationOptions.length === 0) {
            setTargetLocation("")
            return
        }
        if (!targetLocation || !receiveLocationOptions.some((loc: any) => String(loc.id) === String(targetLocation))) {
            setTargetLocation(String(receiveLocationOptions[0].id))
        }
    }, [open, receiveLocationOptions, targetLocation])

    const selectedBulkItems = useMemo(() => {
        return ((transitBulk || []) as any[])
            .map((b: any) => {
                const key = `${String(b.material)}:${String(b.location)}`
                const qty = Number(bulkQtyByKey[key] || 0)
                if (!Number.isFinite(qty) || qty <= 0) return null
                return { material_id: b.material, quantity: qty }
            })
            .filter(Boolean) as Array<{ material_id: string; quantity: number }>
    }, [transitBulk, bulkQtyByKey])

    const mutation = useMutation({
        mutationFn: () => inventoryService.receiveChallan(challan.id, {
            target_location_id: targetLocation,
            roll_ids: selectedRollIds,
            bulk_items: selectedBulkItems
        }),
        onSuccess: async () => {
            toast.success("Received")
            setOpen(false)
            setSelectedRollIds([])
            setBulkQtyByKey({})
            await queryClient.invalidateQueries({ queryKey: ['inter-plant-challans'] })
            await queryClient.invalidateQueries({ queryKey: ['stock'] })
            await queryClient.refetchQueries({ queryKey: ['inter-plant-challans'], type: 'active' })
        },
        onError: (err: AxiosError<{ detail: string }>) => {
            const msg = (err.response?.data as any)?.error || err.response?.data?.detail || "Receipt Failed"
            toast.error(msg)
        }
    })

    if (challan.status !== 'IN_TRANSIT') return null

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button size="sm" data-testid={`interplant-receive-trigger-${challan.id}`}>Receive</Button></DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Receive at {challan.to_plant_name}</DialogTitle>
                    <DialogDescription>Select destination location and lines to receive.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Target Location</label>
                        <Select value={targetLocation} onValueChange={setTargetLocation}>
                            <SelectTrigger data-testid={`interplant-receive-location-${challan.id}`}><SelectValue placeholder="Select Location" /></SelectTrigger>
                            <SelectContent>
                                {receiveLocationOptions.map((l: any) => (
                                    <SelectItem key={l.id} value={l.id}>{l.name} ({l.code})</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <Card>
                        <CardHeader className="py-3">
                            <CardTitle className="text-sm">Transit Rolls</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2 max-h-40 overflow-y-auto">
                            {!transitLocation && <div className="text-sm text-muted-foreground">Source transit location not found.</div>}
                            {transitLocation && ((transitRolls || []) as any[]).length === 0 && (
                                <div className="text-sm text-muted-foreground">No rolls in transit.</div>
                            )}
                            {((transitRolls || []) as any[]).filter((r: any) => r.status === 'AVAILABLE').map((r: any) => {
                                const checked = selectedRollIds.includes(String(r.id))
                                return (
                                    <div key={r.id} className="flex items-center justify-between border rounded-md px-2 py-2">
                                        <div className="flex items-center gap-2">
                                            <Checkbox
                                                data-testid={`interplant-receive-roll-${challan.id}-${r.id}`}
                                                checked={checked}
                                                onCheckedChange={(v) => {
                                                    if (v) setSelectedRollIds(prev => [...prev, String(r.id)])
                                                    else setSelectedRollIds(prev => prev.filter(id => id !== String(r.id)))
                                                }}
                                            />
                                            <div className="text-sm">
                                                <div className="font-semibold">{r.label_id}</div>
                                                <div className="text-xs text-muted-foreground">{r.material_name} • {r.weight_kg} kg</div>
                                            </div>
                                        </div>
                                    </div>
                                )
                            })}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="py-3">
                            <CardTitle className="text-sm">Transit Bulk</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2 max-h-40 overflow-y-auto">
                            {((transitBulk || []) as any[]).length === 0 && (
                                <div className="text-sm text-muted-foreground">No bulk in transit.</div>
                            )}
                            {((transitBulk || []) as any[]).map((b: any) => {
                                const key = `${String(b.material)}:${String(b.location)}`
                                return (
                                    <div key={key} className="grid grid-cols-12 gap-2 border rounded-md px-2 py-2 items-center">
                                        <div className="col-span-8">
                                            <div className="text-sm font-semibold">{b.material_name}</div>
                                            <div className="text-xs text-muted-foreground">Available {Number(b.qty_kg || 0).toFixed(3)} kg</div>
                                        </div>
                                        <div className="col-span-4">
                                            <Input
                                                type="number"
                                                step="0.001"
                                                min="0"
                                                max={Number(b.qty_kg || 0)}
                                                placeholder="Qty kg"
                                                value={bulkQtyByKey[key] || ""}
                                                onChange={(e) => setBulkQtyByKey(prev => ({ ...prev, [key]: e.target.value }))}
                                            />
                                        </div>
                                    </div>
                                )
                            })}
                        </CardContent>
                    </Card>

                    <Button
                        data-testid={`interplant-receive-submit-${challan.id}`}
                        className="w-full"
                        onClick={() => mutation.mutate()}
                        disabled={!targetLocation || mutation.isPending || (selectedRollIds.length === 0 && selectedBulkItems.length === 0)}
                    >
                        Confirm Receipt
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
