"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { ArrowRight, CheckCircle2, FileText, Package, Printer, Send, Truck } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SummaryStatCard } from "@/components/ui-custom/summary-stat-card"
import { SemanticBadge } from "@/components/ui-custom/semantic-badge"
import { useToast } from "@/hooks/use-toast"
import { logisticsService, type DeliveryChallan, type SODispatchSummary } from "@/services/logistics"

function formatKg(value: number | null | undefined) {
  return `${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`
}

function formatPcs(value: number | null | undefined) {
  return `${Number(value || 0).toLocaleString()} pcs`
}

export default function DispatchPage() {
  const { toast } = useToast()
  const [salesOrders, setSalesOrders] = useState<Array<{ id: string; order_number: string; customer_name: string; status: string }>>([])
  const [selectedSOId, setSelectedSOId] = useState<string>("")
  const [summary, setSummary] = useState<SODispatchSummary | null>(null)
  const [challans, setChallans] = useState<DeliveryChallan[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingSummary, setLoadingSummary] = useState(false)

  const [selectedRolls, setSelectedRolls] = useState<Set<string>>(new Set())
  const [selectedGonnies, setSelectedGonnies] = useState<Set<string>>(new Set())

  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [vehicleNo, setVehicleNo] = useState("")
  const [driverName, setDriverName] = useState("")
  const [driverPhone, setDriverPhone] = useState("")

  const fetchData = async () => {
    try {
      setLoading(true)
      const [soData, challanData] = await Promise.all([
        logisticsService.getSalesOrdersWithFG(),
        logisticsService.getChallans(),
      ])
      setSalesOrders(soData)
      setChallans(challanData)
    } catch {
      toast({ title: "Error", description: "Failed to load dispatch bay", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  const fetchSummary = async (soId: string) => {
    if (!soId) {
      setSummary(null)
      return
    }
    try {
      setLoadingSummary(true)
      const data = await logisticsService.getSODispatchableItems(soId)
      setSummary(data)
      setSelectedRolls(new Set())
      setSelectedGonnies(new Set())
    } catch (error: any) {
      toast({ title: "Error", description: error.response?.data?.error || "Failed to load dispatch summary", variant: "destructive" })
      setSummary(null)
    } finally {
      setLoadingSummary(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  useEffect(() => {
    if (selectedSOId) {
      fetchSummary(selectedSOId)
    } else {
      setSummary(null)
    }
  }, [selectedSOId])

  const selectedCount = selectedRolls.size + selectedGonnies.size

  const readyGrossKg = useMemo(() => {
    if (!summary) return 0
    return Number(summary.available_for_dispatch.rolls_kg || 0) + Number(summary.available_for_dispatch.gonnies_gross_kg || 0)
  }, [summary])

  const toggleRoll = (rollId: string) => {
    const next = new Set(selectedRolls)
    if (next.has(rollId)) next.delete(rollId)
    else next.add(rollId)
    setSelectedRolls(next)
  }

  const toggleGonny = (gonnyId: string) => {
    const next = new Set(selectedGonnies)
    if (next.has(gonnyId)) next.delete(gonnyId)
    else next.add(gonnyId)
    setSelectedGonnies(next)
  }

  const handleCreateChallan = async () => {
    if (!summary) return
    if (selectedRolls.size === 0 && selectedGonnies.size === 0) {
      toast({ title: "Error", description: "Select at least one unit for the challan", variant: "destructive" })
      return
    }

    let plantId = ""
    if (selectedRolls.size > 0) {
      const first = summary.rolls.find((row) => row.id === Array.from(selectedRolls)[0])
      plantId = first?.location.plant_id || ""
    } else if (selectedGonnies.size > 0) {
      const first = summary.gonnies.find((row) => row.id === Array.from(selectedGonnies)[0])
      plantId = first?.location.plant_id || ""
    }

    try {
      const result = await logisticsService.createChallan({
        customer_name: summary.sales_order.customer_name,
        plant_id: plantId,
        sales_order_id: summary.sales_order.id,
        vehicle_no: vehicleNo,
        driver_name: driverName,
        driver_phone: driverPhone,
        roll_ids: Array.from(selectedRolls),
        gonny_ids: Array.from(selectedGonnies),
      })
      toast({ title: "Challan Created", description: result.message })
      setCreateDialogOpen(false)
      setVehicleNo("")
      setDriverName("")
      setDriverPhone("")
      await fetchData()
      if (selectedSOId) await fetchSummary(selectedSOId)
    } catch (error: any) {
      toast({ title: "Error", description: error.response?.data?.error || "Failed to create challan", variant: "destructive" })
    }
  }

  const handleDispatch = async (challanId: string) => {
    try {
      const result = await logisticsService.dispatchChallan(challanId)
      toast({ title: "Dispatched", description: result.message })
      await fetchData()
      if (selectedSOId) await fetchSummary(selectedSOId)
    } catch (error: any) {
      toast({ title: "Error", description: error.response?.data?.error || "Failed to dispatch challan", variant: "destructive" })
    }
  }

  const handlePrintList = (challanId: string) => {
    if (typeof window === "undefined") return
    window.open(logisticsService.getChallanPrintUrl(challanId), "_blank", "noopener,noreferrer")
  }

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center bg-slate-50/50">
        <div className="text-center text-sm font-medium text-slate-400">Loading dispatch bay...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen space-y-8 p-6 lg:p-8" data-testid="dispatch-page">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-indigo-600">
            <Truck className="h-4 w-4" strokeWidth={1.75} /> Dispatch terminal
          </div>
          <h1 className="text-3xl font-black tracking-tight text-slate-900">Dispatch Bay</h1>
          <p className="text-sm text-slate-500">
            Only units explicitly released from Packing Yard appear here. Select a sales order, choose ready units, create challan, print, and dispatch.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/logistics/packing">
            Open Packing Yard <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)] 2xl:grid-cols-[320px_minmax(0,1fr)]">
        <Card className="border-0 shadow-sm ring-1 ring-slate-100">
          <CardHeader>
            <CardTitle>Target Sales Order</CardTitle>
            <CardDescription>Orders appear here only after at least one roll or gonny is sent from Packing Yard.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Sales order</Label>
              <Select value={selectedSOId} onValueChange={setSelectedSOId}>
                <SelectTrigger data-testid="dispatch-sales-order-select" className="h-11">
                  <SelectValue placeholder={salesOrders.length === 0 ? "Nothing released to dispatch" : "Select a sales order"} />
                </SelectTrigger>
                <SelectContent>
                  {salesOrders.map((order) => (
                    <SelectItem key={order.id} value={order.id}>
                      {order.order_number} · {order.customer_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {!selectedSOId ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-400">
                {salesOrders.length === 0 ? "Nothing released from Packing Yard yet." : "Select an order to open dispatch selection."}
              </div>
            ) : summary ? (
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-black text-slate-900">{summary.sales_order.order_number}</div>
                    <div className="text-xs text-slate-500">{summary.sales_order.customer_name}</div>
                  </div>
                  <SemanticBadge kind="dispatchStatus" value={summary.sales_order.status || "DISPATCH_READY"} />
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
          <SummaryStatCard compact label="Ready Rolls" value={summary?.available_for_dispatch.rolls_count ?? 0} subLabel={summary ? formatKg(summary.available_for_dispatch.rolls_kg) : "0.00 kg"} icon={Package} toneClassName="bg-indigo-50 text-indigo-700" />
          <SummaryStatCard compact label="Ready Gonnies" value={summary?.available_for_dispatch.gonnies_count ?? 0} subLabel={summary ? formatPcs(summary.available_for_dispatch.gonnies_pcs) : "0 pcs"} icon={CheckCircle2} toneClassName="bg-emerald-50 text-emerald-700" />
          <SummaryStatCard compact label="Gross Dispatch Weight" value={formatKg(readyGrossKg)} subLabel="Ready physical shipment" icon={Truck} toneClassName="bg-violet-50 text-violet-700" />
          <SummaryStatCard compact label="Pending in Packing" value={(summary?.packing_pending?.unpacked_batch_count || 0) + (summary?.packing_pending?.open_gonnies_count || 0) + (summary?.packing_pending?.unreleased_rolls_count || 0) + (summary?.packing_pending?.unreleased_sealed_gonnies_count || 0)} subLabel="Still in Packing Yard" icon={FileText} toneClassName="bg-amber-50 text-amber-700" />
          <SummaryStatCard compact label="Selected Units" value={selectedCount} subLabel={summary?.sales_order.customer_name || "Nothing selected"} icon={Send} toneClassName="bg-slate-100 text-slate-700" />
        </div>
      </div>

      {loadingSummary && selectedSOId ? (
        <div className="rounded-2xl border border-slate-100 bg-white px-4 py-8 text-center text-sm text-slate-400">Loading released units...</div>
      ) : null}

      {summary ? (
        <>
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Card className="border-0 shadow-sm ring-1 ring-slate-100">
              <CardHeader>
                <CardTitle>Released rolls</CardTitle>
                <CardDescription>These rolls already passed through Packing Yard and are ready to place on the challan.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {summary.rolls.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-400">
                    No rolls are ready in Dispatch Bay for this order.
                  </div>
                ) : summary.rolls.map((roll) => (
                  <div key={roll.id} className="rounded-2xl border border-slate-100 bg-white p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="font-black tracking-tight text-slate-900">{roll.label_id}</div>
                        <div className="mt-1 text-xs text-slate-500">{roll.batch_no || "No batch"} · {formatKg(roll.weight_kg)}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={
                            roll.release_mode === "PACKED"
                              ? "inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-700"
                              : "inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700"
                          }
                        >
                          {roll.release_mode === "PACKED" ? "Packed roll" : "Unpacked roll"}
                        </span>
                        <Checkbox data-testid={`dispatch-roll-checkbox-${roll.id}`} checked={selectedRolls.has(roll.id)} onCheckedChange={() => toggleRoll(roll.id)} />
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm ring-1 ring-slate-100">
              <CardHeader>
                <CardTitle>Released gonnies</CardTitle>
                <CardDescription>Loose pouch gonnies and inner-pack gonnies that were sealed and handed over from Packing Yard.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {summary.gonnies.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-400">
                    No gonnies are ready in Dispatch Bay for this order.
                  </div>
                ) : summary.gonnies.map((gonny) => (
                  <div key={gonny.id} className="rounded-2xl border border-slate-100 bg-white p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="font-black tracking-tight text-slate-900">{gonny.label_id}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {gonny.content_mode === "PRIMARY_PACKS" ? `${gonny.primary_pack_count || 0} packs` : "Loose pouches"} · {formatPcs(gonny.qty_pcs)}
                        </div>
                      </div>
                      <Checkbox data-testid={`dispatch-gonny-checkbox-${gonny.id}`} checked={selectedGonnies.has(gonny.id)} onCheckedChange={() => toggleGonny(gonny.id)} />
                    </div>
                    <div className="mt-3 grid gap-2 md:grid-cols-2 text-xs">
                      <div className="rounded-xl bg-slate-50 px-3 py-2">
                        <div className="font-black uppercase tracking-[0.16em] text-slate-400">Net</div>
                        <div className="mt-1 font-black text-slate-900">{formatKg(gonny.net_product_weight_kg)}</div>
                      </div>
                      <div className="rounded-xl bg-slate-50 px-3 py-2">
                        <div className="font-black uppercase tracking-[0.16em] text-slate-400">Gross</div>
                        <div className="mt-1 font-black text-emerald-700">{formatKg(gonny.gross_weight_kg || gonny.weight_kg)}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <div className="sticky bottom-6 z-30 mx-auto w-full max-w-5xl px-4">
            <div className="rounded-[1.75rem] border border-slate-200 bg-white/95 p-4 shadow-[0_8px_30px_rgb(0,0,0,0.06)] backdrop-blur">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-6">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Selected units</div>
                    <div className="mt-1 text-2xl font-black text-slate-900">{selectedCount}</div>
                  </div>
                  <div className="h-10 w-px bg-slate-200" />
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Dispatch target</div>
                    <div className="mt-1 text-sm font-semibold text-slate-700">{summary.sales_order.customer_name}</div>
                  </div>
                </div>

                <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
                  <DialogTrigger asChild>
                    <Button size="lg" data-testid="dispatch-create-trigger" disabled={selectedCount === 0}>
                      Create Dispatch <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle>Finalize challan</DialogTitle>
                      <DialogDescription>
                        Confirm vehicle and driver details, then create the dispatch challan for the selected released units.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-3">
                      <div className="grid gap-2">
                        <Label>Vehicle No.</Label>
                        <Input value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} placeholder="MH-XX-AB-XXXX" />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="grid gap-2">
                          <Label>Driver Name</Label>
                          <Input value={driverName} onChange={(e) => setDriverName(e.target.value)} placeholder="Driver name" />
                        </div>
                        <div className="grid gap-2">
                          <Label>Driver Phone</Label>
                          <Input value={driverPhone} onChange={(e) => setDriverPhone(e.target.value)} placeholder="+91..." />
                        </div>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
                      <Button data-testid="dispatch-create-submit" onClick={handleCreateChallan}>Create challan</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </div>
          </div>
        </>
      ) : (
        <Card className="border-0 shadow-sm ring-1 ring-slate-100">
          <CardContent className="py-16 text-center text-sm text-slate-400">
            Select a released sales order to build dispatch paperwork.
          </CardContent>
        </Card>
      )}

      <Card className="border-0 shadow-sm ring-1 ring-slate-100">
        <CardHeader>
          <CardTitle>Dispatch Ledger</CardTitle>
          <CardDescription>Created challans, printable PDFs, and final dispatch releases.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {challans.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-400">
              No challans created yet.
            </div>
          ) : challans.map((challan) => (
            <div key={challan.id} data-testid={`dispatch-challan-row-${challan.id}`} className="rounded-2xl border border-slate-100 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-mono text-sm font-black text-slate-900">{challan.dc_no}</div>
                  <div className="mt-1 text-xs text-slate-500">{challan.customer_name} · {challan.vehicle_no || "Vehicle pending"}</div>
                </div>
                <div className="flex items-center gap-2">
                  <SemanticBadge kind="dispatchStatus" value={challan.status} />
                  <Button size="sm" variant="ghost" data-testid={`dispatch-print-${challan.id}`} onClick={() => handlePrintList(challan.id)}>
                    <Printer className="mr-2 h-4 w-4" /> Print
                  </Button>
                  {challan.status === "DRAFT" ? (
                    <Button size="sm" data-testid={`dispatch-send-${challan.id}`} onClick={() => handleDispatch(challan.id)}>
                      <Send className="mr-2 h-4 w-4" /> Release
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
