"use client"

import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, Factory, Package, PackageOpen, Plus, ShoppingBag, Ticket } from "lucide-react"

import { masterDataService, type PackagingMaterial } from "@/services/master-data"
import { templateService, type TemplateBlueprint } from "@/services/templates"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { MasterRegistryShell } from "@/components/master/master-registry-shell"
import { SemanticBadge } from "@/components/ui-custom/semantic-badge"

const kinds = ["INNER_POUCH", "GONNY", "TAPE", "SHEET", "BOX", "LABEL", "TAG", "OTHER"] as const
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
  templates,
  onSubmit,
  busy,
}: {
  initial?: PackagingMaterial | null
  templates: TemplateBlueprint[]
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
  const [productionTemplate, setProductionTemplate] = useState(initial?.production_template || "__NONE__")
  const [brandName, setBrandName] = useState(String(initial?.packaging_defaults_json?.brand_name || ""))
  const [defaultPcsPerPack, setDefaultPcsPerPack] = useState(initial?.packaging_defaults_json?.pcs_per_pack != null ? String(initial.packaging_defaults_json?.pcs_per_pack) : "")

  const allowInHouse = ["INNER_POUCH", "SHEET"].includes(kind)
  const needsSheetConversion = kind === "SHEET" && baseUom !== "PCS"
  const visibleTemplates = templates.filter((template) => {
    if (kind === "INNER_POUCH") return template.fg_type === "POUCH"
    return true
  })

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit({
          code,
          name,
          base_uom: baseUom,
          packaging_kind: kind,
          packaging_supply_mode: supplyMode,
          production_template: supplyMode === "PURCHASED" || productionTemplate === "__NONE__" ? null : productionTemplate,
          packaging_defaults_json: {
            brand_name: brandName || undefined,
            pcs_per_pack: defaultPcsPerPack ? Number(defaultPcsPerPack) : undefined,
          },
          per_sheet_base_qty: needsSheetConversion && perSheet ? Number(perSheet) : null,
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
            <SelectContent>{supplyModes.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
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
          <Label>{kind === "SHEET" ? `Base Qty per Sheet (${baseUom})` : "Sheet Conversion"}</Label>
          {kind === "SHEET" ? (
            <>
              <Input
                type="number"
                step="0.000001"
                value={perSheet}
                onChange={(e) => setPerSheet(e.target.value)}
                placeholder={needsSheetConversion ? `Enter ${baseUom.toLowerCase()} represented by one sheet` : "Not needed when base UOM is PCS"}
                disabled={!needsSheetConversion}
              />
              <div className="mt-1 text-xs text-slate-500">
                {needsSheetConversion
                  ? "This is the stock conversion rule used later when actual sheet consumption is entered in Packing Yard."
                  : "PCS-based sheet stock does not need a conversion factor."}
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
              Conversion is only needed for sheet stock that is stored in KG or meter and consumed in pieces.
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

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Linked Production Template</Label>
          <Select value={productionTemplate || "__NONE__"} onValueChange={setProductionTemplate}>
            <SelectTrigger><SelectValue placeholder="No template" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__NONE__">No template</SelectItem>
              {visibleTemplates.map((template) => (
                <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="mt-1 text-xs text-slate-500">
            {allowInHouse
              ? "This packaging SKU owns its production template. Planner stock orders only choose this SKU and the qty to make."
              : "This kind is purchased-only in this phase."}
          </div>
        </div>
        <div>
          <Label>Brand / Pack Label</Label>
          <Input value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="Optional branded pack name" />
        </div>
      </div>

      <div>
        <Label>Default PCS per Inner Pack</Label>
        <Input type="number" value={defaultPcsPerPack} onChange={(e) => setDefaultPcsPerPack(e.target.value)} placeholder="Optional default for known inner-pack consumption" />
      </div>

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
  const { data: templates = [] } = useQuery({ queryKey: ["template-options"], queryFn: () => templateService.getTemplates() })

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return data
    return data.filter((row: PackagingMaterial) => [row.code, row.name, row.packaging_kind, row.packaging_supply_mode].map((value) => String(value || "").toLowerCase()).join(" ").includes(q))
  }, [data, searchQuery])

  const stats = useMemo(() => {
    const total = filtered.length
    const inHouse = filtered.filter((row) => row.packaging_supply_mode === "IN_HOUSE").length
    const both = filtered.filter((row) => row.packaging_supply_mode === "BOTH").length
    const purchased = filtered.filter((row) => row.packaging_supply_mode === "PURCHASED").length
    return { total, inHouse, both, purchased }
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
      description="Control purchased versus in-house packaging SKUs, sheet conversion math, and linked production templates."
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      searchPlaceholder="Search packaging code, name, kind, or supply mode"
      actions={
        <Dialog open={openCreate} onOpenChange={setOpenCreate}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4" /> Add Packaging</Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl">
            <DialogHeader><DialogTitle>Create Packaging Material</DialogTitle></DialogHeader>
            <PackagingForm templates={templates} onSubmit={(payload) => createMutation.mutate(payload)} busy={createMutation.isPending} />
          </DialogContent>
        </Dialog>
      }
      stats={[
        { label: "Total SKUs", value: stats.total, icon: Package, toneClassName: "bg-indigo-50 text-indigo-600" },
        { label: "Purchased", value: stats.purchased, icon: ShoppingBag, toneClassName: "bg-amber-50 text-amber-600" },
        { label: "In-House", value: stats.inHouse, icon: Factory, toneClassName: "bg-emerald-50 text-emerald-600" },
        { label: "Dual Supply", value: stats.both, icon: PackageOpen, toneClassName: "bg-violet-50 text-violet-600" },
      ]}
      chips={[
        { kind: "packagingKind", value: "INNER_POUCH" },
        { kind: "packagingKind", value: "GONNY" },
        { kind: "packagingKind", value: "SHEET" },
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
        {filtered.map((row) => (
          <Card key={row.id} className="border-0 shadow-sm ring-1 ring-slate-100">
            <CardContent className="space-y-4 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-black tracking-tight text-slate-900">{row.name}</div>
                  <div className="mt-1 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">{row.code}</div>
                </div>
                <SemanticBadge kind="packagingKind" value={row.packaging_kind} />
              </div>

              <div className="flex flex-wrap gap-2">
                <SemanticBadge kind="jobState" value={row.packaging_supply_mode === "IN_HOUSE" ? "READY" : row.packaging_supply_mode === "BOTH" ? "ASSIGNED" : "PENDING"} label={row.packaging_supply_mode.replaceAll("_", " ")} />
                <SemanticBadge kind="approval" value={row.status === "ACTIVE" ? "APPROVED" : "REJECTED"} label={row.status} />
              </div>

              <div className="grid grid-cols-2 gap-3 rounded-2xl bg-slate-50/70 p-4 text-sm">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Base UOM</div>
                  <div className="mt-1 font-bold text-slate-900">{row.base_uom}</div>
                </div>
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Sheet Conversion</div>
                  <div className="mt-1 font-bold text-slate-900">
                    {row.packaging_kind === "SHEET" && row.base_uom !== "PCS" && row.per_sheet_base_qty != null
                      ? `${row.per_sheet_base_qty} ${row.base_uom}/sheet`
                      : row.packaging_kind === "SHEET"
                        ? "No conversion needed"
                        : "N/A"}
                  </div>
                </div>
                <div className="col-span-2">
                  <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Linked Production Template</div>
                  <div className="mt-1 font-bold text-slate-900">{row.production_template_name || "Purchased-only / no template"}</div>
                </div>
                <div className="col-span-2">
                  <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Default Brand / Pack Config</div>
                  <div className="mt-1 text-sm text-slate-700">{row.packaging_defaults_json?.brand_name || "No branded default"}{row.packaging_defaults_json?.pcs_per_pack ? ` • ${row.packaging_defaults_json.pcs_per_pack} pcs/pack` : ""}</div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <Button size="sm" variant="outline" onClick={() => setEditing(row)}>Edit</Button>
                <Button size="sm" variant="destructive" onClick={() => deleteMutation.mutate(row.id)}>Delete</Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Edit Packaging Material</DialogTitle></DialogHeader>
          {editing ? (
            <PackagingForm initial={editing} templates={templates} busy={updateMutation.isPending} onSubmit={(payload) => updateMutation.mutate({ id: editing.id, payload })} />
          ) : null}
        </DialogContent>
      </Dialog>
    </MasterRegistryShell>
  )
}
