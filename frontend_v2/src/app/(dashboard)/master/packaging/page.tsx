"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, Plus, Package } from "lucide-react"

import { masterDataService, PackagingMaterial } from "@/services/master-data"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"

const kinds = ["INNER_POUCH", "GONNY", "TAPE", "SHEET", "FILM", "BOX", "LABEL", "TAG", "OTHER"] as const
const supplyModes = ["PURCHASED", "IN_HOUSE", "BOTH"] as const
const uoms = ["PCS", "KG", "METER"] as const

type PackagingKind = typeof kinds[number]
type PackagingSupplyMode = typeof supplyModes[number]
type PackagingUom = typeof uoms[number]

function describeError(err: any) {
  return (
    err?.response?.data?.detail ||
    err?.response?.data?.error ||
    err?.response?.data?.message ||
    err?.message ||
    "Error"
  )
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
          per_sheet_base_qty: perSheet ? Number(perSheet) : null,
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

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Base UOM</Label>
          <Select value={baseUom} onValueChange={(value) => setBaseUom(value as PackagingUom)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{uoms.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>Kind</Label>
          <Select value={kind} onValueChange={(value) => setKind(value as PackagingKind)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{kinds.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Supply Mode</Label>
          <Select value={supplyMode} onValueChange={(value) => setSupplyMode(value as PackagingSupplyMode)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{supplyModes.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>Per Sheet Base Qty (optional)</Label>
          <Input type="number" step="0.000001" value={perSheet} onChange={(e) => setPerSheet(e.target.value)} />
        </div>
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

  const { data = [], isError, error } = useQuery({
    queryKey: ["master-packaging"],
    queryFn: masterDataService.getPackaging,
  })

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
    <div className="p-6 lg:p-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
          <Package className="h-6 w-6 text-indigo-600" /> Packaging Master
        </h1>
        <Dialog open={openCreate} onOpenChange={setOpenCreate}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" /> Add Packaging</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create Packaging Material</DialogTitle></DialogHeader>
            <PackagingForm onSubmit={(payload) => createMutation.mutate(payload)} busy={createMutation.isPending} />
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Packaging SKUs</CardTitle>
        </CardHeader>
        <CardContent className="overflow-auto">
          {isError && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5" />
              <span>{describeError(error)}</span>
            </div>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2">Code</th>
                <th className="py-2">Name</th>
                <th className="py-2">Kind</th>
                <th className="py-2">Supply</th>
                <th className="py-2">UOM</th>
                <th className="py-2">Status</th>
                <th className="py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row: PackagingMaterial) => (
                <tr key={row.id} className="border-b">
                  <td className="py-2 font-mono">{row.code}</td>
                  <td className="py-2">{row.name}</td>
                  <td className="py-2">{row.packaging_kind}</td>
                  <td className="py-2">{row.packaging_supply_mode}</td>
                  <td className="py-2">{row.base_uom}</td>
                  <td className="py-2">{row.status}</td>
                  <td className="py-2 text-right space-x-2">
                    <Button size="sm" variant="outline" onClick={() => setEditing(row)}>Edit</Button>
                    <Button size="sm" variant="destructive" onClick={() => deleteMutation.mutate(row.id)}>Delete</Button>
                  </td>
                </tr>
              ))}
              {data.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">No packaging materials yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Packaging Material</DialogTitle></DialogHeader>
          {editing && (
            <PackagingForm
              initial={editing}
              busy={updateMutation.isPending}
              onSubmit={(payload) => updateMutation.mutate({ id: editing.id, payload })}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
