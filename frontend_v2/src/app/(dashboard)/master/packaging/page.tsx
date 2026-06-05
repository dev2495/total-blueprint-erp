"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, Factory, Package, PackageOpen, Plus, ShoppingBag } from "lucide-react"

import { masterDataService, type PackagingMaterial } from "@/services/master-data"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { MasterRegistryShell } from "@/components/master/master-registry-shell"
import { SemanticBadge } from "@/components/ui-custom/semantic-badge"

const kinds = ["INNER_POUCH", "GONNY", "SHEET", "TAPE", "LABEL", "TAG", "OTHER"] as const
const supplyModes = ["PURCHASED", "IN_HOUSE", "BOTH"] as const
const uoms = ["PCS", "KG", "METER"] as const

type PackagingKind = typeof kinds[number]
type PackagingSupplyMode = typeof supplyModes[number]
type PackagingUom = typeof uoms[number]

function describeError(err: any) {
  return err?.response?.data?.detail || err?.response?.data?.error || err?.response?.data?.message || err?.message || "Error"
}

function PackagingForm({
  initial,
  onSubmit,
  busy,
}: {
  initial?: PackagingMaterial | null
  onSubmit: (payload: any) => void
  busy: boolean
}) {
  const [code, setCode] = useState(initial?.code || "")
  const [name, setName] = useState(initial?.name || "")
  const [baseUom, setBaseUom] = useState<PackagingUom>((initial?.base_uom as PackagingUom) || "PCS")
  const [kind, setKind] = useState<PackagingKind>((initial?.packaging_kind as PackagingKind) || "INNER_POUCH")
  const [supplyMode, setSupplyMode] = useState<PackagingSupplyMode>((initial?.packaging_supply_mode as PackagingSupplyMode) || "PURCHASED")
  const [perSheet, setPerSheet] = useState(initial?.per_sheet_base_qty ? String(initial.per_sheet_base_qty) : "")
  const [status, setStatus] = useState(initial?.status || "ACTIVE")
  const [brandName, setBrandName] = useState(String(initial?.packaging_defaults_json?.brand_name || ""))
  const [defaultPcsPerPack, setDefaultPcsPerPack] = useState(initial?.packaging_defaults_json?.pcs_per_pack != null ? String(initial.packaging_defaults_json?.pcs_per_pack) : "")
  const [weightPerBaseUnit, setWeightPerBaseUnit] = useState(
    initial?.packaging_defaults_json?.weight_kg_per_base_uom != null
      ? String(initial.packaging_defaults_json?.weight_kg_per_base_uom)
      : "",
  )

  const allowInHouse = ["INNER_POUCH", "SHEET"].includes(kind)
  const supplyModeOptions = allowInHouse ? supplyModes : (["PURCHASED"] as const)
  const usesUnitBasedConsumption = kind !== "TAPE"
  const needsUnitConversion = usesUnitBasedConsumption && baseUom !== "PCS"
  const showUnitWeight = usesUnitBasedConsumption && baseUom === "PCS" && kind !== "SHEET"
  const unitLabel = kind.replaceAll("_", " ").toLowerCase()

  useEffect(() => {
    if (!allowInHouse && supplyMode !== "PURCHASED") {
      setSupplyMode("PURCHASED")
    }
  }, [allowInHouse, supplyMode])

  useEffect(() => {
    if (kind !== "INNER_POUCH") {
      setDefaultPcsPerPack("")
    }
  }, [kind])

  useEffect(() => {
    if (!showUnitWeight) {
      setWeightPerBaseUnit("")
    }
  }, [showUnitWeight])

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        const packagingDefaults = { ...(initial?.packaging_defaults_json || {}) }
        if (brandName) {
          packagingDefaults.brand_name = brandName
        } else {
          delete packagingDefaults.brand_name
        }
        if (defaultPcsPerPack) {
          packagingDefaults.pcs_per_pack = Number(defaultPcsPerPack)
        } else {
          delete packagingDefaults.pcs_per_pack
        }
        if (showUnitWeight && weightPerBaseUnit) {
          packagingDefaults.weight_kg_per_base_uom = Number(weightPerBaseUnit)
        } else {
          delete packagingDefaults.weight_kg_per_base_uom
        }
        onSubmit({
          code,
          name,
          base_uom: baseUom,
          packaging_kind: kind,
          packaging_supply_mode: supplyMode,
          production_template: null,
          packaging_defaults_json: packagingDefaults,
          per_sheet_base_qty: needsUnitConversion && perSheet ? Number(perSheet) : null,
          status,
        })
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Code</Label>
          <Input value={code} onChange={(e) => setCode(e.target.value)} required />
        </div>
        <div>
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label>Kind</Label>
          <Select value={kind} onValueChange={(value) => setKind(value as PackagingKind)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{kinds.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>Supply Mode</Label>
          <Select value={supplyMode} onValueChange={(value) => setSupplyMode(value as PackagingSupplyMode)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{supplyModeOptions.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>Base UOM</Label>
          <Select value={baseUom} onValueChange={(value) => setBaseUom(value as PackagingUom)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{uoms.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>{needsUnitConversion ? `Base Qty per ${unitLabel} (${baseUom})` : "Base Qty per Unit"}</Label>
          {needsUnitConversion ? (
            <>
              <Input
                type="number"
                step="0.000001"
                value={perSheet}
                onChange={(e) => setPerSheet(e.target.value)}
                placeholder={`Enter ${baseUom.toLowerCase()} represented by one ${unitLabel}`}
              />
              <div className="mt-1 text-xs text-slate-500">
                This is the stock conversion rule used when physical count is posted for this packing SKU.
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-content-3">
              {usesUnitBasedConsumption
                ? "Not needed when this packaging stock is already tracked directly in PCS."
                : "This packaging kind is normally consumed directly in its base UOM, so no unit conversion is needed."}
            </div>
          )}
        </div>
        <div>
          <Label>Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ACTIVE">ACTIVE</SelectItem>
              <SelectItem value="INACTIVE">INACTIVE</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {showUnitWeight ? (
        <div>
          <Label>Weight per {unitLabel} (kg)</Label>
          <Input
            type="number"
            step="0.000001"
            value={weightPerBaseUnit}
            onChange={(e) => setWeightPerBaseUnit(e.target.value)}
            placeholder={`Optional tare / gross-weight helper per ${unitLabel}`}
          />
          <div className="mt-1 text-xs text-slate-500">
            Used only for gross-weight breakdown in Packing Yard when this packaging item is stocked and consumed in PCS.
          </div>
        </div>
      ) : null}

      {supplyMode !== "PURCHASED" ? (
        <div className="rounded-xl border border-violet-200 bg-violet-50/60 px-3 py-2 text-xs text-violet-900">
          In-house production is controlled by a linked Product Master variant. Save the catalog row here, then link it from the matching PACKAGING variant if it is not already PM-backed.
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Brand / Pack Label</Label>
          <Input value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="Optional branded pack name" />
        </div>
      </div>

      {kind === "INNER_POUCH" ? (
        <div>
          <Label>Default PCS per Inner Pack</Label>
          <Input type="number" value={defaultPcsPerPack} onChange={(e) => setDefaultPcsPerPack(e.target.value)} placeholder="Optional default for known inner-pack consumption" />
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={busy}>Save</Button>
      </div>
    </form>
  )
}

export default function PackagingMasterPage() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [openCreate, setOpenCreate] = useState(false)
  const [editing, setEditing] = useState<PackagingMaterial | null>(null)
  const [searchQuery, setSearchQuery] = useState("")

  const { data = [], isError, error } = useQuery({ queryKey: ["master-packaging"], queryFn: masterDataService.getPackaging })

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return data
    return data.filter((row: PackagingMaterial) => [
      row.code,
      row.name,
      row.packaging_kind,
      row.packaging_supply_mode,
      row.product_master_link?.master_code,
      row.product_master_link?.variant_code,
    ].map((value) => String(value || "").toLowerCase()).join(" ").includes(q))
  }, [data, searchQuery])

  const stats = useMemo(() => {
    const total = filtered.length
    const purchased = filtered.filter((row) => row.packaging_supply_mode === "PURCHASED").length
    const pmBacked = filtered.filter((row) => !!row.product_master_link).length
    const unlinkedInHouse = filtered.filter((row) => row.packaging_supply_mode !== "PURCHASED" && !row.product_master_link).length
    return { total, purchased, pmBacked, unlinkedInHouse }
  }, [filtered])

  const createMutation = useMutation({
    mutationFn: masterDataService.createPackaging,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["master-packaging"] })
      setOpenCreate(false)
      toast({ title: "Packaging created" })
    },
    onError: (err: any) => toast({ title: "Create failed", description: describeError(err), variant: "destructive" }),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: any }) => masterDataService.updatePackaging(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["master-packaging"] })
      setEditing(null)
      toast({ title: "Packaging updated" })
    },
    onError: (err: any) => toast({ title: "Update failed", description: describeError(err), variant: "destructive" }),
  })

  const deleteMutation = useMutation({
    mutationFn: masterDataService.deletePackaging,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["master-packaging"] })
      toast({ title: "Packaging deleted" })
    },
    onError: (err: any) => toast({ title: "Delete failed", description: describeError(err), variant: "destructive" }),
  })

  return (
    <MasterRegistryShell
      title="Packaging Master"
      description="Control fixed inner pouch/gonny SKUs plus sheet, tape, label, tag, and other EOD-counted packing SKUs."
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      searchPlaceholder="Search packaging code, name, kind, or supply mode"
      actions={
        <div className="flex items-center gap-2">
          {/* In-house production masters live on /master/products with kind=PACKAGING.
              Each variant must be manually linked to one fixed row in this
              catalog for stock + consumption tracking. */}
          <Link
            href="/master/products?kind=PACKAGING"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-violet-200 bg-gradient-to-r from-violet-50 to-fuchsia-50 px-3 text-[11px] font-bold text-violet-700 hover:from-violet-100 hover:to-fuchsia-100 transition"
            title="Create an in-house production master that produces packing SKUs into this catalog"
          >
            <Plus className="h-3.5 w-3.5" /> Build production master
          </Link>
          <Dialog open={openCreate} onOpenChange={setOpenCreate}>
            <DialogTrigger asChild>
              <Button><Plus className="mr-2 h-4 w-4" /> Add Packaging</Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl">
              <DialogHeader><DialogTitle>Create Packaging Material</DialogTitle></DialogHeader>
              <PackagingForm onSubmit={(payload) => createMutation.mutate(payload)} busy={createMutation.isPending} />
            </DialogContent>
          </Dialog>
        </div>
      }
      stats={[
        { label: "Total SKUs", value: stats.total, icon: Package, toneClassName: "bg-blue-50 text-blue-600" },
        { label: "PM-Backed", value: stats.pmBacked, subLabel: "linked variant", icon: PackageOpen, toneClassName: "bg-success-bg text-emerald-600" },
        { label: "Unlinked In-House", value: stats.unlinkedInHouse, subLabel: "needs PM link", icon: Factory, toneClassName: "bg-danger-bg text-rose-600" },
        { label: "Purchased", value: stats.purchased, icon: ShoppingBag, toneClassName: "bg-warning-bg text-amber-600" },
      ]}
      chips={[
        { kind: "packagingKind", value: "INNER_POUCH" },
        { kind: "packagingKind", value: "GONNY" },
        { kind: "packagingKind", value: "SHEET" },
        { kind: "packagingKind", value: "TAPE" },
        { kind: "packagingKind", value: "LABEL" },
      ]}
    >
      {isError ? (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="flex items-start gap-3 p-4 text-sm text-red-700">
            <AlertTriangle className="mt-0.5 h-4 w-4" />
            <span>{describeError(error)}</span>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {filtered.map((row) => {
          const link = row.product_master_link
          const unlinkedInHouse = row.packaging_supply_mode !== "PURCHASED" && !link
          return (
          <Card key={row.id} className="border-0 shadow-sm ring-1 ring-slate-100">
            <CardContent className="space-y-4 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-black tracking-tight text-slate-900">{row.name}</div>
                  <div className="mt-1 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-content-4">{row.code}</div>
                </div>
                <SemanticBadge kind="packagingKind" value={row.packaging_kind} />
              </div>

              <div className="flex flex-wrap gap-2">
                <SemanticBadge kind="jobState" value={row.packaging_supply_mode === "IN_HOUSE" ? "READY" : row.packaging_supply_mode === "BOTH" ? "ASSIGNED" : "PENDING"} label={row.packaging_supply_mode.replaceAll("_", " ")} />
                <SemanticBadge kind="approval" value={row.status === "ACTIVE" ? "APPROVED" : "REJECTED"} label={row.status} />
                <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ring-1 ${
                  link
                    ? "bg-success-bg text-success-fg ring-emerald-200"
                    : unlinkedInHouse
                      ? "bg-danger-bg text-danger-fg ring-rose-200"
                      : "bg-slate-50 text-content-3 ring-slate-200"
                }`}>
                  {link ? "PM-backed" : unlinkedInHouse ? "Needs PM link" : "Catalog row"}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 rounded-2xl bg-slate-50/70 p-4 text-sm">
                <div>
                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-content-4">Base UOM</div>
                <div className="mt-1 font-bold text-slate-900">{row.base_uom}</div>
              </div>
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-content-4">Unit Conversion</div>
                <div className="mt-1 font-bold text-slate-900">
                  {row.base_uom !== "PCS" && row.packaging_kind !== "TAPE" && row.per_sheet_base_qty != null
                    ? `${row.per_sheet_base_qty} ${row.base_uom}/${row.packaging_kind.replaceAll("_", " ").toLowerCase()}`
                    : row.base_uom === "PCS"
                      ? "Tracked directly in PCS"
                      : "N/A"}
                </div>
              </div>
              <div className="col-span-2">
                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-content-4">Product Master Link</div>
                <div className={`mt-1 rounded-xl px-3 py-2 text-sm ${
                  link
                    ? "bg-success-bg text-emerald-900 ring-1 ring-emerald-100"
                    : unlinkedInHouse
                      ? "bg-danger-bg text-rose-900 ring-1 ring-rose-100"
                      : "bg-surface-1 text-slate-700 ring-1 ring-slate-100"
                }`}>
                  {link ? (
                    <>
                      <div className="font-black">{link.master_code} · {link.master_name}</div>
                      <div className="mt-0.5 font-mono text-[11px] font-bold">{link.variant_code}</div>
                    </>
                  ) : unlinkedInHouse ? (
                    <span className="font-bold">In-house row not linked to a Product Master variant</span>
                  ) : (
                    <span>Purchased/manual catalog row</span>
                  )}
                </div>
              </div>
              <div className="col-span-2">
                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-content-4">Default Brand / Pack Config</div>
                <div className="mt-1 text-sm text-slate-700">
                  {row.packaging_defaults_json?.brand_name || "No branded default"}
                  {row.packaging_defaults_json?.pcs_per_pack ? ` • ${row.packaging_defaults_json.pcs_per_pack} pcs/pack` : ""}
                  {row.packaging_defaults_json?.weight_kg_per_base_uom ? ` • ${row.packaging_defaults_json.weight_kg_per_base_uom} kg/${row.base_uom.toLowerCase()}` : ""}
                </div>
              </div>
            </div>

              <div className="flex items-center justify-between gap-3">
                <Button size="sm" variant="outline" onClick={() => setEditing(row)}>Edit</Button>
                <Button size="sm" variant="destructive" onClick={() => deleteMutation.mutate(row.id)}>Delete</Button>
              </div>
            </CardContent>
          </Card>
          )
        })}
      </div>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Edit Packaging Material</DialogTitle></DialogHeader>
          {editing ? (
            <PackagingForm initial={editing} busy={updateMutation.isPending} onSubmit={(payload) => updateMutation.mutate({ id: editing.id, payload })} />
          ) : null}
        </DialogContent>
      </Dialog>
    </MasterRegistryShell>
  )
}
