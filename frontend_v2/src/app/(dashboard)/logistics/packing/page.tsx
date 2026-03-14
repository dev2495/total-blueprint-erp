"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { logisticsService, FGBatch, Gonny } from "@/services/logistics"
import { masterDataService } from "@/services/master-data"
import { useToast } from "@/hooks/use-toast"
import { Package, Plus, CheckCircle } from "lucide-react"

export default function PackingPage() {
    const { toast } = useToast()
    const [batches, setBatches] = useState<FGBatch[]>([])
    const [gonnies, setGonnies] = useState<Gonny[]>([])
    const [packagingMaterials, setPackagingMaterials] = useState<any[]>([])
    const [loading, setLoading] = useState(true)

    // Create Gonny Dialog State
    const [createDialogOpen, setCreateDialogOpen] = useState(false)
    const [selectedBatchId, setSelectedBatchId] = useState<string>("")
    const [qtyPcs, setQtyPcs] = useState<number>(0)
    const [selectedGonnyMaterialId, setSelectedGonnyMaterialId] = useState<string>("")
    const [contentMode, setContentMode] = useState<"LOOSE_POUCHES" | "PRIMARY_PACKS">("LOOSE_POUCHES")
    const [primaryPackCount, setPrimaryPackCount] = useState<number>(0)

    // Seal Gonny Dialog State
    const [sealDialogOpen, setSealDialogOpen] = useState(false)
    const [selectedGonnyId, setSelectedGonnyId] = useState<string>("")
    const [weightKg, setWeightKg] = useState<number>(0)
    const [sealExtras, setSealExtras] = useState<Array<{ material_id: string; qty: number; uom: "PCS" | "KG" | "METER"; basis: "PER_GONNY" }>>([])

    const fetchData = async () => {
        try {
            setLoading(true)
            const [batchData, gonnyData, packagingData] = await Promise.all([
                logisticsService.getAvailableBatches(),
                logisticsService.getGonnies(),
                masterDataService.getPackaging(),
            ])
            setBatches(batchData)
            setGonnies(gonnyData)
            setPackagingMaterials(Array.isArray(packagingData) ? packagingData : [])
        } catch (error) {
            toast({ title: "Error", description: "Failed to load packing data", variant: "destructive" })
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchData()
    }, [])

    const selectedBatch = batches.find((batch) => batch.id === selectedBatchId) || null

    useEffect(() => {
        if (!selectedBatch) {
            setContentMode("LOOSE_POUCHES")
            setPrimaryPackCount(0)
            return
        }

        const defaultMode = String(selectedBatch.default_content_mode || "LOOSE_POUCHES").toUpperCase() === "PRIMARY_PACKS"
            ? "PRIMARY_PACKS"
            : "LOOSE_POUCHES"
        setContentMode(defaultMode)
        if (defaultMode !== "PRIMARY_PACKS") {
            setPrimaryPackCount(0)
        }
    }, [selectedBatchId, selectedBatch])

    useEffect(() => {
        if (!selectedBatch || contentMode !== "PRIMARY_PACKS") {
            return
        }
        if (Number(selectedBatch.pcs_per_pack || 0) > 0 && qtyPcs > 0) {
            setPrimaryPackCount(Math.ceil(qtyPcs / Number(selectedBatch.pcs_per_pack || 0)))
            return
        }
        setPrimaryPackCount(0)
    }, [contentMode, qtyPcs, selectedBatch])

    const handleCreateGonny = async () => {
        if (!selectedBatchId || qtyPcs <= 0 || !selectedGonnyMaterialId) {
            toast({ title: "Error", description: "Select a batch, gonny material, and quantity", variant: "destructive" })
            return
        }

        try {
            const result = await logisticsService.createGonny({
                fgBatchId: selectedBatchId,
                qtyPcs,
                gonnyMaterialId: selectedGonnyMaterialId,
                contentMode,
                primaryPackCount: contentMode === "PRIMARY_PACKS" && primaryPackCount > 0 ? primaryPackCount : undefined,
            })
            toast({ title: "Gonny Created", description: result.message })
            setCreateDialogOpen(false)
            setSelectedBatchId("")
            setQtyPcs(0)
            setSelectedGonnyMaterialId("")
            setContentMode("LOOSE_POUCHES")
            setPrimaryPackCount(0)
            fetchData()
        } catch (error: any) {
            toast({ title: "Error", description: error.response?.data?.error || "Failed to create gonny", variant: "destructive" })
        }
    }

    const handleSealGonny = async () => {
        if (!selectedGonnyId || weightKg <= 0) {
            toast({ title: "Error", description: "Enter weight", variant: "destructive" })
            return
        }

        try {
            const result = await logisticsService.sealGonny(
                selectedGonnyId,
                weightKg,
                sealExtras
                    .filter((line) => line.material_id && Number(line.qty || 0) > 0)
                    .map((line) => ({
                        material_id: line.material_id,
                        qty: Number(line.qty || 0),
                        uom: line.uom,
                        basis: "PER_GONNY",
                    }))
            )
            toast({ title: "Gonny Sealed", description: result.message })
            setSealDialogOpen(false)
            setSelectedGonnyId("")
            setWeightKg(0)
            setSealExtras([])
            fetchData()
        } catch (error: any) {
            toast({ title: "Error", description: error.response?.data?.error || "Failed to seal gonny", variant: "destructive" })
        }
    }

    const openSealDialog = (gonnyId: string) => {
        setSelectedGonnyId(gonnyId)
        setSealExtras([])
        setSealDialogOpen(true)
    }

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'OPEN': return <Badge variant="outline">Open</Badge>
            case 'SEALED': return <Badge className="bg-green-600">Sealed</Badge>
            case 'DISPATCHED': return <Badge className="bg-blue-600">Dispatched</Badge>
            default: return <Badge variant="secondary">{status}</Badge>
        }
    }

    if (loading) {
        return <div className="p-6">Loading...</div>
    }

    return (
        <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold">Packing (Gonny Creation)</h1>
                    <p className="text-muted-foreground">Pack finished goods into gonnies for dispatch</p>
                </div>

                <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
                    <DialogTrigger asChild>
                        <Button><Plus className="mr-2 h-4 w-4" /> Create Gonny</Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Create Gonny</DialogTitle>
                            <DialogDescription>Pack pieces from an FG batch into a new gonny</DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-4 py-4">
                            <div className="grid gap-2">
                                <Label>Select FG Batch</Label>
                                <select
                                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                    value={selectedBatchId}
                                    onChange={(e) => setSelectedBatchId(e.target.value)}
                                >
                                    <option value="">-- Select Batch --</option>
                                    {batches.map((batch) => (
                                        <option key={batch.id} value={batch.id}>
                                            {batch.batch_number} | {batch.so_number} ({batch.customer}) | {batch.qty_pcs} PCS available
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="grid gap-2">
                                <Label>Quantity (PCS)</Label>
                                <Input
                                    type="number"
                                    value={qtyPcs || ""}
                                    onChange={(e) => setQtyPcs(Number(e.target.value))}
                                    placeholder="Enter pieces to pack"
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label>Gonny Material</Label>
                                <select
                                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                    value={selectedGonnyMaterialId}
                                    onChange={(e) => setSelectedGonnyMaterialId(e.target.value)}
                                >
                                    <option value="">-- Select Gonny SKU --</option>
                                    {packagingMaterials
                                        .filter((material) => String(material?.packaging_kind || "").toUpperCase() === "GONNY")
                                        .map((material) => (
                                            <option key={material.id} value={String(material.id)}>
                                                {material.code} - {material.name}
                                            </option>
                                        ))}
                                </select>
                            </div>
                            <div className="grid gap-2">
                                <Label>Content Mode</Label>
                                <select
                                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                    value={contentMode}
                                    onChange={(e) => setContentMode(e.target.value as "LOOSE_POUCHES" | "PRIMARY_PACKS")}
                                >
                                    <option value="LOOSE_POUCHES">Loose Pouches</option>
                                    <option value="PRIMARY_PACKS">Primary Packed Pouches</option>
                                </select>
                                {selectedBatch?.primary_pack_enabled ? (
                                    <div className="text-xs text-muted-foreground">
                                        Sales default expects primary packs at {selectedBatch.pcs_per_pack || 0} PCS per pack.
                                    </div>
                                ) : (
                                    <div className="text-xs text-muted-foreground">
                                        This batch has no sales-stage primary pack default. Loose pouch mode is standard.
                                    </div>
                                )}
                            </div>
                            {contentMode === "PRIMARY_PACKS" && (
                                <div className="grid gap-2">
                                    <Label>Primary Pack Count</Label>
                                    <Input
                                        type="number"
                                        value={primaryPackCount || ""}
                                        onChange={(e) => setPrimaryPackCount(Number(e.target.value))}
                                        placeholder="How many primary packs are inside this gonny"
                                    />
                                </div>
                            )}
                            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                                `qty_pcs` is always the underlying FG pouch count removed from the batch.
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
                            <Button onClick={handleCreateGonny}>Create Gonny</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Available FG Batches */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Package className="h-5 w-5" />
                            Available FG Batches
                        </CardTitle>
                        <CardDescription>Batches available for packing</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Batch</TableHead>
                                    <TableHead>Sales Order</TableHead>
                                    <TableHead>Customer</TableHead>
                                    <TableHead>Product</TableHead>
                                    <TableHead>Quantity (PCS)</TableHead>
                                    <TableHead>Location</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {batches.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={6} className="text-center text-muted-foreground">
                                            No batches available
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    batches.map((batch) => (
                                        <TableRow key={batch.id}>
                                            <TableCell className="font-mono">{batch.batch_number}</TableCell>
                                            <TableCell>{batch.so_number}</TableCell>
                                            <TableCell>{batch.customer}</TableCell>
                                            <TableCell>{batch.product}</TableCell>
                                            <TableCell>
                                                <div className="flex flex-col">
                                                    <span>{batch.remaining} / {batch.original_qty}</span>
                                                    <span className="text-xs text-muted-foreground">Available / Total</span>
                                                </div>
                                            </TableCell>
                                            <TableCell>{batch.location__name}</TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>

                {/* Gonnies */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <CheckCircle className="h-5 w-5" />
                            Gonnies (Packing Units)
                        </CardTitle>
                        <CardDescription>Created gonnies - seal before dispatch</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Label</TableHead>
                                    <TableHead>Content</TableHead>
                                    <TableHead>Qty</TableHead>
                                    <TableHead>Weight</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Action</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {gonnies.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={6} className="text-center text-muted-foreground">
                                            No gonnies created yet
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    gonnies.map((gonny) => (
                                        <TableRow key={gonny.id}>
                                            <TableCell className="font-mono text-xs">{gonny.label_id}</TableCell>
                                            <TableCell>
                                                <div className="flex flex-col gap-1">
                                                    <Badge variant="outline" className="w-fit">
                                                        {gonny.content_mode === "PRIMARY_PACKS" ? "Primary Packs" : "Loose Pouches"}
                                                    </Badge>
                                                    {gonny.content_mode === "PRIMARY_PACKS" && Number(gonny.primary_pack_count || 0) > 0 && (
                                                        <span className="text-xs text-muted-foreground">{gonny.primary_pack_count} packs</span>
                                                    )}
                                                </div>
                                            </TableCell>
                                            <TableCell>{gonny.qty_pcs} PCS</TableCell>
                                            <TableCell>{gonny.weight_kg ? `${gonny.weight_kg} KG` : '-'}</TableCell>
                                            <TableCell>{getStatusBadge(gonny.status)}</TableCell>
                                            <TableCell>
                                                {gonny.status === 'OPEN' && (
                                                    <Button size="sm" variant="outline" onClick={() => openSealDialog(gonny.id)}>
                                                        Seal
                                                    </Button>
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </div>

            {/* Seal Dialog */}
            <Dialog open={sealDialogOpen} onOpenChange={setSealDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Seal Gonny</DialogTitle>
                        <DialogDescription>Enter the final weight after packing</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label>Weight (KG)</Label>
                            <Input
                                type="number"
                                step="0.01"
                                value={weightKg || ""}
                                onChange={(e) => setWeightKg(Number(e.target.value))}
                                placeholder="Enter weight in KG"
                            />
                        </div>
                        <div className="grid gap-2">
                            <div className="flex items-center justify-between">
                                <Label>Seal Extras (optional)</Label>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setSealExtras((prev) => [...prev, { material_id: "", qty: 1, uom: "PCS", basis: "PER_GONNY" }])}
                                >
                                    Add Extra
                                </Button>
                            </div>
                            {sealExtras.length === 0 ? (
                                <div className="text-xs text-muted-foreground">No extra packaging lines added.</div>
                            ) : (
                                <div className="space-y-2">
                                    {sealExtras.map((line, idx) => (
                                        <div key={`seal-extra-${idx}`} className="grid grid-cols-1 md:grid-cols-5 gap-2">
                                            <select
                                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm md:col-span-2"
                                                value={line.material_id}
                                                onChange={(e) => setSealExtras((prev) => prev.map((it, i) => i === idx ? { ...it, material_id: e.target.value } : it))}
                                            >
                                                <option value="">-- Select Extra SKU --</option>
                                                {packagingMaterials.map((material) => (
                                                    <option key={material.id} value={String(material.id)}>
                                                        {material.code} - {material.name}
                                                    </option>
                                                ))}
                                            </select>
                                            <Input
                                                type="number"
                                                value={line.qty || ""}
                                                onChange={(e) => setSealExtras((prev) => prev.map((it, i) => i === idx ? { ...it, qty: Number(e.target.value) } : it))}
                                                placeholder="Qty"
                                            />
                                            <select
                                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                                value={line.uom}
                                                onChange={(e) => setSealExtras((prev) => prev.map((it, i) => i === idx ? { ...it, uom: e.target.value as "PCS" | "KG" | "METER" } : it))}
                                            >
                                                <option value="PCS">PCS</option>
                                                <option value="KG">KG</option>
                                                <option value="METER">METER</option>
                                            </select>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => setSealExtras((prev) => prev.filter((_, i) => i !== idx))}
                                            >
                                                Remove
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setSealDialogOpen(false)}>Cancel</Button>
                        <Button onClick={handleSealGonny}>Seal Gonny</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
