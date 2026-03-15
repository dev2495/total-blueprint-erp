"use client"

import { useEffect, useMemo, useState } from "react"
import { CheckCircle2, Package, PackageOpen, Plus, Scale, ShoppingBag, Sparkles } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useToast } from "@/hooks/use-toast"
import { logisticsService, type FGBatch, type Gonny } from "@/services/logistics"
import { masterDataService } from "@/services/master-data"
import { FactoryPageLayout } from "@/components/factory/FactoryPageLayout"
import { SummaryStatCard } from "@/components/ui-custom/summary-stat-card"
import { SemanticBadge } from "@/components/ui-custom/semantic-badge"

function formatPcs(value: number) {
  return `${value.toLocaleString()} pcs`
}

function formatKg(value: number | null | undefined) {
  return `${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`
}

export default function PackingPage() {
  const { toast } = useToast()
  const [batches, setBatches] = useState<FGBatch[]>([])
  const [gonnies, setGonnies] = useState<Gonny[]>([])
  const [packagingMaterials, setPackagingMaterials] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [selectedBatchId, setSelectedBatchId] = useState<string>("")
  const [qtyPcs, setQtyPcs] = useState<number>(0)
  const [selectedGonnyMaterialId, setSelectedGonnyMaterialId] = useState<string>("")
  const [contentMode, setContentMode] = useState<"LOOSE_POUCHES" | "PRIMARY_PACKS">("LOOSE_POUCHES")
  const [primaryPackCount, setPrimaryPackCount] = useState<number>(0)

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
    } catch {
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
    const defaultMode = String(selectedBatch.default_content_mode || "LOOSE_POUCHES").toUpperCase() === "PRIMARY_PACKS" ? "PRIMARY_PACKS" : "LOOSE_POUCHES"
    setContentMode(defaultMode)
    if (defaultMode !== "PRIMARY_PACKS") setPrimaryPackCount(0)
  }, [selectedBatch])

  useEffect(() => {
    if (!selectedBatch || contentMode !== "PRIMARY_PACKS") return
    if (Number(selectedBatch.pcs_per_pack || 0) > 0 && qtyPcs > 0) {
      setPrimaryPackCount(Math.ceil(qtyPcs / Number(selectedBatch.pcs_per_pack || 0)))
    }
  }, [contentMode, qtyPcs, selectedBatch])

  const gonnySkuOptions = useMemo(() => {
    return packagingMaterials.filter((material) => String(material?.packaging_kind || "").toUpperCase() === "GONNY")
  }, [packagingMaterials])

  const innerPackSkuOptions = useMemo(() => {
    return packagingMaterials.filter((material) => String(material?.packaging_kind || "").toUpperCase() === "INNER_POUCH")
  }, [packagingMaterials])

  const totals = useMemo(() => {
    return gonnies.reduce(
      (acc, row) => {
        acc.totalGonnies += 1
        acc.totalPcs += Number(row.qty_pcs || 0)
        acc.netKg += Number(row.net_product_weight_kg || 0)
        acc.grossKg += Number(row.gross_weight_kg || row.weight_kg || 0)
        if (String(row.content_mode || "LOOSE_POUCHES").toUpperCase() === "PRIMARY_PACKS") acc.primaryPacked += 1
        else acc.loosePacked += 1
        return acc
      },
      { totalGonnies: 0, totalPcs: 0, netKg: 0, grossKg: 0, primaryPacked: 0, loosePacked: 0 },
    )
  }, [gonnies])

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
      setPrimaryPackCount(0)
      await fetchData()
    } catch (error: any) {
      toast({ title: "Error", description: error.response?.data?.error || "Failed to create gonny", variant: "destructive" })
    }
  }

  const handleSealGonny = async () => {
    if (!selectedGonnyId || weightKg <= 0) {
      toast({ title: "Error", description: "Enter gross sealed weight", variant: "destructive" })
      return
    }
    try {
      const result = await logisticsService.sealGonny(
        selectedGonnyId,
        weightKg,
        sealExtras
          .filter((line) => line.material_id && Number(line.qty || 0) > 0)
          .map((line) => ({ material_id: line.material_id, qty: Number(line.qty || 0), uom: line.uom, basis: "PER_GONNY" })),
      )
      toast({ title: "Gonny Sealed", description: result.message })
      setSealDialogOpen(false)
      setSelectedGonnyId("")
      setWeightKg(0)
      setSealExtras([])
      await fetchData()
    } catch (error: any) {
      toast({ title: "Error", description: error.response?.data?.error || "Failed to seal gonny", variant: "destructive" })
    }
  }

  const openSealDialog = (gonnyId: string) => {
    setSelectedGonnyId(gonnyId)
    setWeightKg(0)
    setSealExtras([])
    setSealDialogOpen(true)
  }

  return (
    <FactoryPageLayout
      title="Packing Yard"
      description="Create gonnies, track loose-vs-primary packs, and keep net product weight separate from shipment tare."
      actions={
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4" /> Create Gonny</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Gonny</DialogTitle>
              <DialogDescription>Select the FG batch, gonny SKU, and packing mode.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-3">
              <div className="grid gap-2">
                <Label>FG Batch</Label>
                <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={selectedBatchId} onChange={(event) => setSelectedBatchId(event.target.value)}>
                  <option value="">-- Select batch --</option>
                  {batches.map((batch) => (
                    <option key={batch.id} value={batch.id}>{batch.batch_number} • {batch.customer} • {batch.qty_pcs} pcs available</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label>Pouch Qty (PCS)</Label>
                  <Input type="number" value={qtyPcs || ""} onChange={(event) => setQtyPcs(Number(event.target.value))} />
                </div>
                <div className="grid gap-2">
                  <Label>Gonny SKU</Label>
                  <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={selectedGonnyMaterialId} onChange={(event) => setSelectedGonnyMaterialId(event.target.value)}>
                    <option value="">-- Select gonny --</option>
                    {gonnySkuOptions.map((material: any) => (
                      <option key={material.id} value={String(material.id)}>{material.code} • {material.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Content Mode</Label>
                <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={contentMode} onChange={(event) => setContentMode(event.target.value as "LOOSE_POUCHES" | "PRIMARY_PACKS")}>
                  <option value="LOOSE_POUCHES">Loose pouches directly into gonny</option>
                  <option value="PRIMARY_PACKS">Primary branded packs into gonny</option>
                </select>
              </div>
              {contentMode === "PRIMARY_PACKS" ? (
                <div className="grid gap-2">
                  <Label>Primary Pack Count</Label>
                  <Input type="number" value={primaryPackCount || ""} onChange={(event) => setPrimaryPackCount(Number(event.target.value))} />
                  <div className="text-xs text-slate-500">Inner pack SKUs available: {innerPackSkuOptions.length}. Sales default per pack: {selectedBatch?.pcs_per_pack || 0} pcs.</div>
                </div>
              ) : null}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleCreateGonny}>Create Gonny</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      }
    >
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <SummaryStatCard label="Open Batches" value={batches.length} subLabel="FG ready to pack" icon={PackageOpen} toneClassName="bg-indigo-50 text-indigo-600" />
          <SummaryStatCard label="Gonnies in View" value={totals.totalGonnies} subLabel={`${totals.primaryPacked} primary-pack, ${totals.loosePacked} loose`} icon={ShoppingBag} toneClassName="bg-emerald-50 text-emerald-600" />
          <SummaryStatCard label="Packed Pouches" value={formatPcs(totals.totalPcs)} subLabel="Commercial fulfillment quantity" icon={Sparkles} toneClassName="bg-amber-50 text-amber-600" />
          <SummaryStatCard label="Net Product Weight" value={formatKg(totals.netKg)} subLabel="Product-only weight" icon={Scale} toneClassName="bg-sky-50 text-sky-600" />
          <SummaryStatCard label="Gross Shipment Weight" value={formatKg(totals.grossKg)} subLabel="Net product + tare" icon={Package} toneClassName="bg-violet-50 text-violet-600" />
        </div>

        <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <Card className="border-0 shadow-sm ring-1 ring-slate-100">
            <CardHeader>
              <CardTitle>FG batches waiting for packing</CardTitle>
              <CardDescription>Choose from live FG batches. Packing removes pouch PCS from the batch and creates a gonny trace.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {loading ? (
                <div className="text-sm text-slate-400">Loading batches...</div>
              ) : batches.length === 0 ? (
                <div className="text-sm text-slate-400">No available FG batches to pack.</div>
              ) : batches.map((batch) => (
                <div key={batch.id} className="rounded-2xl border border-slate-100 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-black tracking-tight text-slate-900">{batch.batch_number}</div>
                      <div className="mt-1 text-xs text-slate-500">{batch.customer} • SO {batch.so_number}</div>
                    </div>
                    <SemanticBadge kind="packingMode" value={batch.default_content_mode || "LOOSE_POUCHES"} />
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div className="rounded-xl bg-slate-50 px-3 py-2">
                      <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Available PCS</div>
                      <div className="mt-1 text-lg font-black text-slate-900">{formatPcs(Number(batch.qty_pcs || 0))}</div>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-3 py-2">
                      <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Net Batch Weight</div>
                      <div className="mt-1 text-lg font-black text-slate-900">{formatKg(batch.qty_kg || 0)}</div>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm ring-1 ring-slate-100">
            <CardHeader>
              <CardTitle>Packing units</CardTitle>
              <CardDescription>Each gonny now tracks net product, tare, and gross shipment weight separately.</CardDescription>
            </CardHeader>
            <CardContent className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Gonny</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead>PCS</TableHead>
                    <TableHead>Net / Tare / Gross</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {gonnies.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="py-8 text-center text-slate-400">No gonnies yet.</TableCell></TableRow>
                  ) : gonnies.map((gonny) => {
                    const totalTare = Number(gonny.inner_pack_tare_kg || 0) + Number(gonny.secondary_pack_tare_kg || 0) + Number(gonny.extras_tare_kg || 0)
                    return (
                      <TableRow key={gonny.id}>
                        <TableCell>
                          <div className="font-black tracking-tight text-slate-900">{gonny.label_id}</div>
                          <div className="mt-1 text-xs text-slate-500">Batch {gonny.fg_batch__batch_number || gonny.batch_no || "-"}</div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-2">
                            <SemanticBadge kind="packingMode" value={gonny.content_mode || "LOOSE_POUCHES"} />
                            {gonny.primary_pack_count ? <div className="text-xs text-slate-500">{gonny.primary_pack_count} inner packs</div> : null}
                          </div>
                        </TableCell>
                        <TableCell className="font-black text-slate-900">{formatPcs(Number(gonny.qty_pcs || 0))}</TableCell>
                        <TableCell>
                          <div className="space-y-1 text-xs">
                            <div><span className="font-semibold text-slate-500">Net</span> <span className="font-black text-slate-900">{formatKg(gonny.net_product_weight_kg)}</span></div>
                            <div><span className="font-semibold text-slate-500">Tare</span> <span className="font-black text-amber-700">{formatKg(totalTare)}</span></div>
                            <div><span className="font-semibold text-slate-500">Gross</span> <span className="font-black text-emerald-700">{formatKg(gonny.gross_weight_kg || gonny.weight_kg)}</span></div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <SemanticBadge kind="dispatchStatus" value={gonny.status === "OPEN" ? "DRAFT" : gonny.status === "SEALED" ? "READY" : "DISPATCHED"} label={gonny.status} />
                        </TableCell>
                        <TableCell className="text-right">
                          {gonny.status === "OPEN" ? (
                            <Button size="sm" onClick={() => openSealDialog(gonny.id)}>
                              <CheckCircle2 className="mr-2 h-4 w-4" /> Seal gonny
                            </Button>
                          ) : (
                            <div className="text-xs text-slate-500">Ready for dispatch bay</div>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={sealDialogOpen} onOpenChange={setSealDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Seal Gonny</DialogTitle>
            <DialogDescription>Enter the final gross shipment weight. This must be at least the calculated net product plus tare.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-3">
            <div className="grid gap-2">
              <Label>Gross Sealed Weight (kg)</Label>
              <Input type="number" step="0.001" value={weightKg || ""} onChange={(event) => setWeightKg(Number(event.target.value))} />
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              Optional seal extras such as tape can be added later if required. Current UI focuses on the main gross-weight checkpoint.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSealDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSealGonny}>Seal Gonny</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </FactoryPageLayout>
  )
}
