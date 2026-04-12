"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, ArrowRight, CheckCircle2, Package, PackageOpen, Scale, Send, ShoppingBag, Truck, X } from "lucide-react"

import { FactoryPageLayout } from "@/components/factory/FactoryPageLayout"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SummaryStatCard } from "@/components/ui-custom/summary-stat-card"
import { SemanticBadge } from "@/components/ui-custom/semantic-badge"
import { useToast } from "@/hooks/use-toast"
import { logisticsService, type SOPackingSummary } from "@/services/logistics"
import { inventoryService, type PackagingStockRow } from "@/services/inventory"
import { masterDataService } from "@/services/master-data"

function formatKg(value: number | null | undefined) {
  return `${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`
}

function formatPcs(value: number | null | undefined) {
  return `${Number(value || 0).toLocaleString()} pcs`
}

type ReleaseMode = "PACKED" | "UNPACKED"
type PackLineDraft = { material_id: string; qty: number; uom?: string; basis?: string }

function collapsePackLines(lines: PackLineDraft[]) {
  const grouped = new Map<string, PackLineDraft>()
  for (const line of lines) {
    const materialId = String(line.material_id || "").trim()
    const qty = Number(line.qty || 0)
    if (!materialId || qty <= 0) continue
    const uom = String(line.uom || "PCS").toUpperCase()
    const basis = String(line.basis || "PER_ROLL").toUpperCase()
    const key = `${materialId}::${uom}::${basis}`
    const existing = grouped.get(key)
    if (existing) {
      existing.qty = Number(existing.qty || 0) + qty
      continue
    }
    grouped.set(key, { material_id: materialId, qty, uom, basis })
  }
  return Array.from(grouped.values())
}

export default function PackingPage() {
  const { toast } = useToast()
  const [orders, setOrders] = useState<Array<{ id: string; order_number: string; customer_name: string; status: string }>>([])
  const [summary, setSummary] = useState<SOPackingSummary | null>(null)
  const [selectedSOId, setSelectedSOId] = useState<string>("")
  const [packagingMaterials, setPackagingMaterials] = useState<any[]>([])
  const [gonnyStocks, setGonnyStocks] = useState<PackagingStockRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingSummary, setLoadingSummary] = useState(false)

  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [selectedBatchId, setSelectedBatchId] = useState<string>("")
  const [qtyPcs, setQtyPcs] = useState<number>(0)
  const [selectedGonnyMaterialId, setSelectedGonnyMaterialId] = useState<string>("")
  const [contentMode, setContentMode] = useState<"LOOSE_POUCHES" | "PRIMARY_PACKS">("LOOSE_POUCHES")
  const [primaryPackCount, setPrimaryPackCount] = useState<number>(0)

  const [sealDialogOpen, setSealDialogOpen] = useState(false)
  const [selectedGonnyId, setSelectedGonnyId] = useState<string>("")
  const [weightKg, setWeightKg] = useState<number>(0)
  const [sealExtras, setSealExtras] = useState<PackLineDraft[]>([])
  const [sealExtraStocks, setSealExtraStocks] = useState<PackagingStockRow[]>([])

  const [rollDialogOpen, setRollDialogOpen] = useState(false)
  const [selectedRoll, setSelectedRoll] = useState<any | null>(null)
  const [releaseMode, setReleaseMode] = useState<ReleaseMode>("PACKED")
  const [packLines, setPackLines] = useState<PackLineDraft[]>([])

  const fetchBaseData = async () => {
    try {
      setLoading(true)
      const [packingOrders, packagingData] = await Promise.all([
        logisticsService.getPackingOrders(),
        masterDataService.getPackaging(),
      ])
      setOrders(packingOrders)
      setPackagingMaterials(Array.isArray(packagingData) ? packagingData : [])
    } catch {
      toast({ title: "Error", description: "Failed to load packing yard data", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  const fetchSummary = async (salesOrderId: string) => {
    if (!salesOrderId) {
      setSummary(null)
      return
    }
    try {
      setLoadingSummary(true)
      const data = await logisticsService.getSOPackingSummary(salesOrderId)
      setSummary(data)
    } catch (error: any) {
      toast({ title: "Error", description: error.response?.data?.error || "Failed to load packing summary", variant: "destructive" })
      setSummary(null)
    } finally {
      setLoadingSummary(false)
    }
  }

  useEffect(() => {
    fetchBaseData()
  }, [])

  useEffect(() => {
    if (selectedSOId) {
      fetchSummary(selectedSOId)
    } else {
      setSummary(null)
    }
  }, [selectedSOId])

  const selectedBatch = useMemo(
    () => summary?.batches.find((batch) => batch.id === selectedBatchId) || null,
    [summary, selectedBatchId],
  )
  const selectedGonny = useMemo(
    () => summary?.gonnies.find((gonny) => gonny.id === selectedGonnyId) || null,
    [summary, selectedGonnyId],
  )
  const packagingMaterialById = useMemo(
    () => new Map((packagingMaterials || []).map((material) => [String(material.id), material])),
    [packagingMaterials],
  )

  useEffect(() => {
    let active = true
    const locationId = selectedBatch?.location?.id
    if (!locationId) {
      setGonnyStocks([])
      return () => {
        active = false
      }
    }
    inventoryService
      .getPackagingStock({ location: locationId })
      .then((rows) => {
        if (!active) return
        setGonnyStocks(
          rows.filter((row) => String(row.packaging_kind || "").toUpperCase() === "GONNY" && Number(row.qty || 0) > 0),
        )
      })
      .catch(() => {
        if (!active) return
        setGonnyStocks([])
      })
    return () => {
      active = false
    }
  }, [selectedBatch?.location?.id])

  useEffect(() => {
    let active = true
    const locationId = selectedGonny?.location?.id
    if (!sealDialogOpen || !locationId) {
      setSealExtraStocks([])
      return () => {
        active = false
      }
    }
    inventoryService
      .getPackagingStock({ location: locationId })
      .then((rows) => {
        if (!active) return
        setSealExtraStocks(
          rows.filter((row) => {
            const kind = String(row.packaging_kind || "").toUpperCase()
            return Number(row.qty || 0) > 0 && !["GONNY", "INNER_POUCH", "SHEET"].includes(kind)
          }),
        )
      })
      .catch(() => {
        if (!active) return
        setSealExtraStocks([])
      })
    return () => {
      active = false
    }
  }, [sealDialogOpen, selectedGonny?.location?.id])

  useEffect(() => {
    if (!selectedBatch) {
      setContentMode("LOOSE_POUCHES")
      setPrimaryPackCount(0)
      return
    }
    const defaultMode = String((selectedBatch as any).default_content_mode || "LOOSE_POUCHES").toUpperCase() === "PRIMARY_PACKS"
      ? "PRIMARY_PACKS"
      : "LOOSE_POUCHES"
    setContentMode(defaultMode)
    if (defaultMode !== "PRIMARY_PACKS") {
      setPrimaryPackCount(0)
    }
  }, [selectedBatch])

  useEffect(() => {
    if (!selectedBatch || contentMode !== "PRIMARY_PACKS") return
    const pcsPerPack = Number((selectedBatch as any).pcs_per_pack || 0)
    if (pcsPerPack > 0 && qtyPcs > 0) {
      setPrimaryPackCount(Math.ceil(qtyPcs / pcsPerPack))
    }
  }, [selectedBatch, contentMode, qtyPcs])

  const gonnySkuOptions = useMemo(
    () =>
      gonnyStocks.map((row) => ({
        id: row.material,
        code: row.material_code,
        name: row.material_name,
        qty: Number(row.qty || 0),
        baseUom: row.base_uom,
      })),
    [gonnyStocks],
  )

  useEffect(() => {
    if (!gonnySkuOptions.length) {
      setSelectedGonnyMaterialId("")
      return
    }
    if (!gonnySkuOptions.some((material) => material.id === selectedGonnyMaterialId)) {
      setSelectedGonnyMaterialId(gonnySkuOptions[0].id)
    }
  }, [gonnySkuOptions, selectedGonnyMaterialId])

  const totals = useMemo(() => {
    const rows = summary?.gonnies || []
    return rows.reduce(
      (acc, row) => {
        acc.totalPcs += Number(row.qty_pcs || 0)
        acc.netKg += Number(row.net_product_weight_kg || 0)
        acc.grossKg += Number(row.gross_weight_kg || row.weight_kg || 0)
        return acc
      },
      { totalPcs: 0, netKg: 0, grossKg: 0 },
    )
  }, [summary])

  const sealExtraOptions = useMemo(
    () =>
      sealExtraStocks.map((row) => ({
        material_id: String(row.material || ""),
        label: `${row.material_code} · ${row.material_name}`,
        available: `${Number(row.qty || 0).toLocaleString(undefined, { maximumFractionDigits: 3 })} ${String(row.base_uom || "").toUpperCase()}`,
        uom: String(row.base_uom || "PCS").toUpperCase(),
      })),
    [sealExtraStocks],
  )

  const refreshAll = async () => {
    await fetchBaseData()
    if (selectedSOId) {
      await fetchSummary(selectedSOId)
    }
  }

  const openCreateDialog = (batchId: string) => {
    setSelectedBatchId(batchId)
    setQtyPcs(0)
    setSelectedGonnyMaterialId("")
    setCreateDialogOpen(true)
  }

  const handleCreateGonny = async () => {
    if (!selectedBatchId || qtyPcs <= 0 || !selectedGonnyMaterialId) {
      toast({ title: "Error", description: "Select a batch, quantity, and gonny material", variant: "destructive" })
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
      toast({ title: "Packing Unit Created", description: result.message })
      setCreateDialogOpen(false)
      setSelectedBatchId("")
      setQtyPcs(0)
      setSelectedGonnyMaterialId("")
      setPrimaryPackCount(0)
      await refreshAll()
    } catch (error: any) {
      toast({ title: "Error", description: error.response?.data?.error || "Failed to create gonny", variant: "destructive" })
    }
  }

  const openSealDialog = (gonnyId: string) => {
    setSelectedGonnyId(gonnyId)
    setWeightKg(0)
    setSealExtras([])
    setSealDialogOpen(true)
  }

  const handleSealGonny = async () => {
    if (!selectedGonnyId || weightKg <= 0) {
      toast({ title: "Error", description: "Enter a gross sealed weight", variant: "destructive" })
      return
    }
    try {
      const extras = collapsePackLines(
        sealExtras.map((line) => ({
          material_id: String(line.material_id || "").trim(),
          qty: Number(line.qty || 0),
          uom: String(line.uom || "PCS").toUpperCase(),
          basis: "PER_GONNY",
        })),
      )
      const result = await logisticsService.sealGonny(selectedGonnyId, weightKg, extras)
      toast({ title: "Gonny Sealed", description: result.message })
      setSealDialogOpen(false)
      setSelectedGonnyId("")
      setWeightKg(0)
      setSealExtras([])
      await refreshAll()
    } catch (error: any) {
      toast({ title: "Error", description: error.response?.data?.error || "Failed to seal gonny", variant: "destructive" })
    }
  }

  const handleReleaseGonny = async (gonnyId: string) => {
    try {
      const result = await logisticsService.releaseGonny(gonnyId)
      toast({ title: "Sent To Dispatch", description: result.message })
      await refreshAll()
    } catch (error: any) {
      toast({ title: "Error", description: error.response?.data?.error || "Failed to release gonny", variant: "destructive" })
    }
  }

  const openRollDialog = (roll: any) => {
    setSelectedRoll(roll)
    const snapshotLines = Array.isArray(roll.default_pack_lines) ? (roll.default_pack_lines as Array<{ material_id?: string; qty?: number; uom?: string; basis?: string }>) : []
    const defaultLines =
      snapshotLines.length > 0
        ? snapshotLines.reduce((acc: PackLineDraft[], line) => {
            const materialId = String(line.material_id || "").trim()
            if (!materialId || acc.some((row) => row.material_id === materialId)) return acc
            const material = packagingMaterialById.get(materialId)
            acc.push({
              material_id: materialId,
              qty: Number(line.qty || 0),
              uom: String(line.uom || material?.base_uom || "PCS").toUpperCase(),
              basis: String(line.basis || "PER_ROLL").toUpperCase(),
            })
            return acc
          }, [])
        : []
    const inferredMode = String(roll.release_mode || "").toUpperCase() === "UNPACKED" ? "UNPACKED" : "PACKED"
    setReleaseMode(defaultLines.length > 0 ? inferredMode : "UNPACKED")
    setPackLines(defaultLines)
    setRollDialogOpen(true)
  }

  const handleReleaseRoll = async () => {
    if (!selectedRoll) return
    try {
      if (releaseMode === "PACKED" && !selectedRoll.roll_pack_enabled) {
        toast({
          title: "Packing snapshot required",
          description: "This roll has no allowed packing materials in the sales/SKU snapshot. Update the order packaging or release it unpacked.",
          variant: "destructive",
        })
        return
      }
      const lines =
        releaseMode === "PACKED"
          ? collapsePackLines(packLines.filter((line) => line.material_id && Number(line.qty || 0) > 0))
          : []
      if (releaseMode === "PACKED" && lines.length === 0) {
        toast({ title: "Pack lines required", description: "Add at least one roll packing line or choose unpacked release.", variant: "destructive" })
        return
      }
      const result = await logisticsService.releaseRoll(selectedRoll.id, releaseMode, lines)
      toast({ title: "Roll Sent To Dispatch", description: result.message })
      setRollDialogOpen(false)
      setSelectedRoll(null)
      await refreshAll()
    } catch (error: any) {
      toast({ title: "Error", description: error.response?.data?.error || "Failed to release roll", variant: "destructive" })
    }
  }

  return (
    <FactoryPageLayout
      title="Packing Yard"
      description="Convert finished production into physical dispatch units. Pouch batches become gonnies here, rolls are prepared here, and only released units appear in Dispatch Bay."
      actions={
        <Button asChild variant="outline">
          <Link href="/logistics/dispatch">
            Open Dispatch Bay <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      }
    >
      <div className="space-y-6" data-testid="packing-page">
        <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)] 2xl:grid-cols-[320px_minmax(0,1fr)]">
          <Card className="border-0 shadow-sm ring-1 ring-slate-100">
            <CardHeader>
              <CardTitle>Sales order handoff</CardTitle>
              <CardDescription>Completed production reaches Packing Yard first. Choose the order you want to pack or release.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Sales order</Label>
                <Select value={selectedSOId} onValueChange={setSelectedSOId}>
                  <SelectTrigger className="h-11" data-testid="packing-sales-order-select">
                    <SelectValue placeholder={orders.length === 0 ? "Nothing in packing yard" : "Select sales order"} />
                  </SelectTrigger>
                  <SelectContent>
                    {orders.map((order) => (
                      <SelectItem key={order.id} value={order.id}>
                        {order.order_number} · {order.customer_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {summary ? (
                <div className="space-y-3 rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-black text-slate-900">{summary.sales_order.order_number}</div>
                      <div className="text-xs text-slate-500">{summary.sales_order.customer_name}</div>
                    </div>
                    <SemanticBadge kind="dispatchStatus" value={summary.sales_order.status || "PACKING_READY"} />
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-xl bg-white px-3 py-2">
                      <div className="font-black uppercase tracking-[0.16em] text-slate-400">Pending batches</div>
                      <div className="mt-1 font-black text-slate-900">{formatPcs(summary.packing_pending.batches_pcs)}</div>
                    </div>
                    <div className="rounded-xl bg-white px-3 py-2">
                      <div className="font-black uppercase tracking-[0.16em] text-slate-400">Ready for dispatch</div>
                      <div className="mt-1 font-black text-emerald-700">{summary.ready_for_dispatch.gonnies_count + summary.ready_for_dispatch.rolls_count} units</div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-400">
                  {loading ? "Loading order queue..." : "Select a sales order to open the packing desk."}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
            <SummaryStatCard compact label="Pending Batches" value={summary?.packing_pending.batches_count ?? 0} subLabel={summary ? formatPcs(summary.packing_pending.batches_pcs) : "0 pcs"} icon={PackageOpen} toneClassName="bg-amber-50 text-amber-700" />
            <SummaryStatCard compact label="Open Gonnies" value={summary?.packing_pending.open_gonnies_count ?? 0} subLabel="Need sealing" icon={ShoppingBag} toneClassName="bg-sky-50 text-sky-700" />
            <SummaryStatCard compact label="Ready Gonnies" value={summary?.ready_for_dispatch.gonnies_count ?? 0} subLabel={summary ? formatPcs(summary.ready_for_dispatch.gonnies_pcs) : "0 pcs"} icon={CheckCircle2} toneClassName="bg-emerald-50 text-emerald-700" />
            <SummaryStatCard compact label="Ready Rolls" value={summary?.ready_for_dispatch.rolls_count ?? 0} subLabel={summary ? formatKg(summary.ready_for_dispatch.rolls_kg) : "0.00 kg"} icon={Package} toneClassName="bg-indigo-50 text-indigo-700" />
            <SummaryStatCard compact label="Net Product Weight" value={summary ? formatKg(summary.ready_for_dispatch.gonnies_net_kg + summary.ready_for_dispatch.rolls_kg) : "0.00 kg"} subLabel="Dispatch-ready product" icon={Scale} toneClassName="bg-slate-100 text-slate-700" />
            <SummaryStatCard compact label="Gross Shipment Weight" value={summary ? formatKg(summary.ready_for_dispatch.gonnies_gross_kg + summary.ready_for_dispatch.rolls_kg) : "0.00 kg"} subLabel="Handed to dispatch" icon={Scale} toneClassName="bg-violet-50 text-violet-700" />
          </div>
        </div>

        {loadingSummary && selectedSOId ? (
          <div className="rounded-2xl border border-slate-100 bg-white px-4 py-8 text-center text-sm text-slate-400">Loading packing summary...</div>
        ) : null}

        {summary ? (
          <>
            <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
              <Card className="border-0 shadow-sm ring-1 ring-slate-100">
                <CardHeader>
                  <CardTitle>Roll handoff lane</CardTitle>
                  <CardDescription>Prepare each finished roll in Packing Yard. Packed or unpacked release is chosen here, not in Dispatch Bay.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {summary.rolls.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-400">
                      No finished rolls for this order.
                    </div>
                  ) : summary.rolls.map((roll) => (
                    <div key={roll.id} className="rounded-2xl border border-slate-100 bg-white p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="font-black tracking-tight text-slate-900">{roll.label_id}</div>
                          <div className="mt-1 text-xs text-slate-500">{roll.batch_no || "No batch"} · {formatKg(roll.weight_kg)}</div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <SemanticBadge kind="dispatchStatus" value={roll.released_to_dispatch ? "READY" : "DRAFT"} label={roll.released_to_dispatch ? "Ready in dispatch" : "In packing yard"} />
                          <span
                            className={
                              roll.release_mode === "PACKED"
                                ? "inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-700"
                                : "inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700"
                            }
                          >
                            {roll.release_mode === "PACKED" ? "Packed roll" : "Unpacked roll"}
                          </span>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold">{roll.width_mm} mm</span>
                        {roll.packed_for_dispatch ? <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700">Packing recorded</span> : <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold">No pack record yet</span>}
                      </div>
                      <div className="mt-4 flex justify-end">
                        {roll.released_to_dispatch ? (
                          <div className="text-xs font-semibold text-emerald-700">Released to Dispatch Bay</div>
                        ) : (
                          <Button size="sm" data-testid={`packing-roll-release-${roll.id}`} onClick={() => openRollDialog(roll)}>
                            <Send className="mr-2 h-4 w-4" /> Prepare & send
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className="border-0 shadow-sm ring-1 ring-slate-100">
                <CardHeader>
                  <CardTitle>Pouch batches waiting for gonnies</CardTitle>
                  <CardDescription>Loose pouches or inner packs both start from the finished batch. Create as many gonnies as needed for the order.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {summary.batches.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-400">
                      No unfinished pouch batches remain in the yard.
                    </div>
                  ) : summary.batches.map((batch) => (
                    <div key={batch.id} className="rounded-2xl border border-slate-100 bg-white p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="font-black tracking-tight text-slate-900">{batch.batch_number}</div>
                          <div className="mt-1 text-xs text-slate-500">{batch.template_name || "Unknown template"} · {formatPcs(batch.qty_pcs)} · {formatKg(batch.qty_kg)}</div>
                        </div>
                        <SemanticBadge kind="packingMode" value={(batch as any).default_content_mode || "LOOSE_POUCHES"} />
                      </div>
                      <div className="mt-4 flex justify-end">
                        <Button size="sm" data-testid={`packing-create-gonny-${batch.id}`} onClick={() => openCreateDialog(batch.id)}>
                          <ShoppingBag className="mr-2 h-4 w-4" /> Create gonny
                        </Button>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>

            <Card className="border-0 shadow-sm ring-1 ring-slate-100">
              <CardHeader>
                <CardTitle>Gonnies in packing yard</CardTitle>
                <CardDescription>Loose pouch and primary-pack gonnies stay here until sealed and explicitly sent to Dispatch Bay.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {summary.gonnies.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-400">
                    No gonnies created yet for this order.
                  </div>
                ) : summary.gonnies.map((gonny) => {
                  const totalTare = Number(gonny.inner_pack_tare_kg || 0) + Number(gonny.secondary_pack_tare_kg || 0) + Number(gonny.extras_tare_kg || 0)
                  return (
                    <div key={gonny.id} className="rounded-2xl border border-slate-100 bg-white p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="font-black tracking-tight text-slate-900">{gonny.label_id}</div>
                          <div className="mt-1 text-xs text-slate-500">
                            Batch {gonny.batch_no || "-"} · {formatPcs(gonny.qty_pcs)} · {gonny.content_mode === "PRIMARY_PACKS" ? `${gonny.primary_pack_count || 0} inner packs` : "Loose pouches"}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <SemanticBadge kind="packingMode" value={gonny.content_mode || "LOOSE_POUCHES"} />
                          <SemanticBadge kind="dispatchStatus" value={gonny.released_to_dispatch ? "READY" : gonny.status === "SEALED" ? "IN_REVIEW" : "DRAFT"} label={gonny.released_to_dispatch ? "Ready in dispatch" : gonny.status} />
                        </div>
                      </div>

                      <div className="mt-3 grid gap-3 md:grid-cols-3">
                        <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs">
                          <div className="font-black uppercase tracking-[0.16em] text-slate-400">Net</div>
                          <div className="mt-1 font-black text-slate-900">{formatKg(gonny.net_product_weight_kg)}</div>
                        </div>
                        <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs">
                          <div className="font-black uppercase tracking-[0.16em] text-slate-400">Tare</div>
                          <div className="mt-1 font-black text-amber-700">{formatKg(totalTare)}</div>
                        </div>
                        <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs">
                          <div className="font-black uppercase tracking-[0.16em] text-slate-400">Gross</div>
                          <div className="mt-1 font-black text-emerald-700">{formatKg(gonny.gross_weight_kg || gonny.weight_kg)}</div>
                        </div>
                      </div>

                      <div className="mt-4 flex justify-end gap-2">
                        {gonny.status === "OPEN" ? (
                          <Button size="sm" data-testid={`packing-seal-gonny-${gonny.id}`} onClick={() => openSealDialog(gonny.id)}>
                            <CheckCircle2 className="mr-2 h-4 w-4" /> Seal gonny
                          </Button>
                        ) : gonny.released_to_dispatch ? (
                          <div className="text-xs font-semibold text-emerald-700">Released to Dispatch Bay</div>
                        ) : (
                          <Button size="sm" data-testid={`packing-release-gonny-${gonny.id}`} onClick={() => handleReleaseGonny(gonny.id)}>
                            <Send className="mr-2 h-4 w-4" /> Send to dispatch
                          </Button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </CardContent>
            </Card>
          </>
        ) : null}
      </div>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent data-testid="packing-create-gonny-dialog">
          <DialogHeader>
            <DialogTitle>Create gonny</DialogTitle>
            <DialogDescription>Choose pouch quantity, gonny SKU, and whether this gonny holds loose pouches or inner packs.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-3">
            <div className="grid gap-2">
              <Label>Batch</Label>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                {selectedBatch ? `${selectedBatch.batch_number} · ${formatPcs(selectedBatch.qty_pcs)} available` : "Select a batch from the order lane"}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Pouch Qty (PCS)</Label>
                <Input data-testid="packing-gonny-qty" type="number" value={qtyPcs || ""} onChange={(event) => setQtyPcs(Number(event.target.value))} />
              </div>
              <div className="grid gap-2">
                <Label>Gonny SKU</Label>
                <select data-testid="packing-gonny-material" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={selectedGonnyMaterialId} onChange={(event) => setSelectedGonnyMaterialId(event.target.value)}>
                  <option value="">-- Select gonny --</option>
                  {gonnySkuOptions.map((material) => (
                    <option key={material.id} value={String(material.id)}>{material.code} · {material.name} · {material.qty} {material.baseUom}</option>
                  ))}
                </select>
                <div className="text-xs text-slate-500">
                  {gonnySkuOptions.length
                    ? "Only gonny materials with stock at this batch location are shown."
                    : "No gonny stock is available at this batch location yet."}
                </div>
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Content Mode</Label>
              <select data-testid="packing-gonny-content-mode" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={contentMode} onChange={(event) => setContentMode(event.target.value as "LOOSE_POUCHES" | "PRIMARY_PACKS")}>
                <option value="LOOSE_POUCHES">Loose pouches into gonny</option>
                <option value="PRIMARY_PACKS">Inner packs into gonny</option>
              </select>
            </div>
            {contentMode === "PRIMARY_PACKS" ? (
              <div className="grid gap-2">
                <Label>Primary Pack Count</Label>
                <Input data-testid="packing-gonny-primary-pack-count" type="number" value={primaryPackCount || ""} onChange={(event) => setPrimaryPackCount(Number(event.target.value))} />
                <div className="text-xs text-slate-500">Default pcs per pack: {Number((selectedBatch as any)?.pcs_per_pack || 0) || "not set"}</div>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
            <Button data-testid="packing-gonny-submit" onClick={handleCreateGonny}>Create gonny</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={sealDialogOpen} onOpenChange={setSealDialogOpen}>
        <DialogContent data-testid="packing-seal-gonny-dialog">
          <DialogHeader>
            <DialogTitle>Seal gonny</DialogTitle>
            <DialogDescription>Enter the final gross shipment weight after the packing unit is physically sealed.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-3">
            <div className="grid gap-2">
              <Label>Gross sealed weight (kg)</Label>
              <Input data-testid="packing-gonny-seal-weight" type="number" step="0.001" value={weightKg || ""} onChange={(event) => setWeightKg(Number(event.target.value))} />
            </div>
            <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-600">
              Gross weight must cover net product weight, inner-pack tare, gonny tare, and any seal extras such as tape or labels.
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label>Seal extras</Label>
                  <div className="text-xs text-slate-500">Optional per-gonny materials consumed during sealing.</div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSealExtras((prev) => [...prev, { material_id: "", qty: 0, uom: "PCS", basis: "PER_GONNY" }])}
                  disabled={sealExtraOptions.length === 0}
                >
                  Add extra
                </Button>
              </div>
              {sealExtraOptions.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-400">
                  No extra packaging stock is available at this gonny location.
                </div>
              ) : sealExtras.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-400">
                  No seal extras selected. Use this only when tape, labels, or similar items are actually consumed.
                </div>
              ) : (
                sealExtras.map((line, index) => (
                  <div key={`seal-extra-${index}`} className="grid gap-3 rounded-2xl border border-slate-100 bg-white p-3 md:grid-cols-[minmax(0,1fr)_120px_56px]">
                    <div className="space-y-1">
                      <select
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        value={line.material_id || ""}
                        onChange={(event) => {
                          const next = [...sealExtras]
                          const selectedOption = sealExtraOptions.find((option) => option.material_id === event.target.value)
                          next[index] = {
                            ...next[index],
                            material_id: event.target.value,
                            uom: selectedOption?.uom || "PCS",
                            basis: "PER_GONNY",
                          }
                          setSealExtras(next)
                        }}
                      >
                        <option value="">Select extra material</option>
                        {sealExtraOptions.map((option) => (
                          <option key={option.material_id} value={option.material_id}>
                            {option.label} · {option.available}
                          </option>
                        ))}
                      </select>
                      <div className="text-[11px] text-slate-500">
                        {sealExtraOptions.find((option) => option.material_id === line.material_id)?.available || "Choose stocked material"}
                      </div>
                    </div>
                    <Input
                      type="number"
                      step="0.001"
                      value={line.qty || ""}
                      onChange={(event) => {
                        const next = [...sealExtras]
                        next[index] = { ...next[index], qty: Number(event.target.value || 0) }
                        setSealExtras(next)
                      }}
                      placeholder="Qty"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setSealExtras((prev) => prev.filter((_, rowIndex) => rowIndex !== index))}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSealDialogOpen(false)}>Cancel</Button>
            <Button data-testid="packing-gonny-seal-submit" onClick={handleSealGonny}>Seal gonny</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rollDialogOpen} onOpenChange={setRollDialogOpen}>
        <DialogContent className="max-w-2xl" data-testid="packing-roll-dialog">
          <DialogHeader>
            <DialogTitle>Prepare roll for dispatch</DialogTitle>
            <DialogDescription>Choose whether this roll is handed over as a packed roll or as an unpacked finished roll.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-3">
            <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm">
              <div className="font-black text-slate-900">{selectedRoll?.label_id || "Roll"}</div>
              <div className="mt-1 text-xs text-slate-500">{formatKg(selectedRoll?.weight_kg || 0)} · {selectedRoll?.width_mm || 0} mm</div>
            </div>

            <div className="grid gap-2">
              <Label>Release mode</Label>
              <select data-testid="packing-roll-release-mode" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={releaseMode} onChange={(event) => setReleaseMode(event.target.value as ReleaseMode)}>
                <option value="PACKED">Packed roll</option>
                <option value="UNPACKED">Unpacked roll</option>
              </select>
            </div>

            {releaseMode === "PACKED" ? (
              <div className="space-y-3">
                <div className="text-xs font-semibold text-slate-500">Only materials allowed in the sales / SKU packing snapshot can be consumed here.</div>
                {packLines.length === 0 ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <div>
                        No roll packing materials are configured for this roll. Update the sales or planner packaging snapshot, or release the roll unpacked.
                      </div>
                    </div>
                  </div>
                ) : (
                  packLines.map((line, idx) => {
                    const material = packagingMaterialById.get(String(line.material_id || ""))
                    return (
                      <div key={`${line.material_id}-${idx}`} className="grid gap-3 rounded-2xl border border-slate-100 bg-white p-3 md:grid-cols-[minmax(0,1fr)_140px]">
                        <div className="space-y-1">
                          <div className="font-semibold text-slate-900">{material ? `${material.code} · ${material.name}` : line.material_id}</div>
                          <div className="text-[11px] text-slate-500">
                            {String(line.basis || "PER_ROLL").toUpperCase()} · {String(line.uom || material?.base_uom || "PCS").toUpperCase()}
                          </div>
                        </div>
                        <Input
                          data-testid={`packing-roll-qty-${idx}`}
                          type="number"
                          step="0.001"
                          value={line.qty || ""}
                          onChange={(e) => {
                            const next = [...packLines]
                            next[idx] = { ...next[idx], qty: Number(e.target.value || 0) }
                            setPackLines(next)
                          }}
                          placeholder="Actual qty"
                        />
                      </div>
                    )
                  })
                )}
              </div>
            ) : (
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                This roll will be released as an unpacked finished roll. No packaging stock will be consumed in Packing Yard.
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRollDialogOpen(false)}>Cancel</Button>
            <Button data-testid="packing-roll-submit" onClick={handleReleaseRoll}>Send to dispatch</Button>
        </DialogFooter>
      </DialogContent>
      </Dialog>
    </FactoryPageLayout>
  )
}
