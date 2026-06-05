"use client"

import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, Trash2, Wrench, MapPin, Factory, Search } from "lucide-react"

import { MasterRegistryShell } from "@/components/master/master-registry-shell"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { engineeringService, type ToolAsset } from "@/services/engineering"
import { factoryService } from "@/services/factory"
import { masterDataService } from "@/services/master-data"
import { SemanticBadge } from "@/components/ui-custom/semantic-badge"

const assetTypes = ["ANILOX", "SLEEVE", "CUTTING_DIE", "SEALING_JAW", "CORE_SHAFT", "MOUNTING_ADAPTER", "TOOLING_OTHER"] as const
const statuses = ["READY", "IN_USE", "SERVICE_DUE", "MAINTENANCE", "RETIRED"] as const

function ToolAssetForm({ initial, plants, locations, vendors, onSubmit, busy }: any) {
  const [plant, setPlant] = useState(initial?.plant || "")
  const [assetType, setAssetType] = useState(initial?.asset_type || "ANILOX")
  const [code, setCode] = useState(initial?.code || "")
  const [name, setName] = useState(initial?.name || "")
  const [status, setStatus] = useState(initial?.status || "READY")
  const [storageLocation, setStorageLocation] = useState(initial?.storage_location || "__NONE__")
  const [rackCode, setRackCode] = useState(initial?.rack_code || "")
  const [slotCode, setSlotCode] = useState(initial?.slot_code || "")
  const [vendor, setVendor] = useState(initial?.vendor || "__NONE__")
  const [serviceDueAt, setServiceDueAt] = useState(initial?.service_due_at || "")
  const [notes, setNotes] = useState(initial?.notes || "")

  const filteredLocations = locations.filter((row: any) => (!plant || row.plant === plant) && String(row.type || "").toUpperCase() === "TOOLING")

  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); onSubmit({ plant, asset_type: assetType, code, name, status, storage_location: storageLocation === "__NONE__" ? null : storageLocation, rack_code: rackCode, slot_code: slotCode, vendor: vendor === "__NONE__" ? null : vendor, service_due_at: serviceDueAt || null, notes }) }}>
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Plant</Label><Select value={plant} onValueChange={setPlant}><SelectTrigger><SelectValue placeholder="Select plant" /></SelectTrigger><SelectContent>{plants.map((row: any) => <SelectItem key={row.id} value={row.id}>{row.name}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Asset Type</Label><Select value={assetType} onValueChange={setAssetType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{assetTypes.map((row) => <SelectItem key={row} value={row}>{row}</SelectItem>)}</SelectContent></Select></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Code</Label><Input value={code} onChange={(e) => setCode(e.target.value)} required /></div>
        <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} required /></div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div><Label>Status</Label><Select value={status} onValueChange={setStatus}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{statuses.map((row) => <SelectItem key={row} value={row}>{row}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Rack</Label><Input value={rackCode} onChange={(e) => setRackCode(e.target.value)} placeholder="Rack-A" /></div>
        <div><Label>Slot</Label><Input value={slotCode} onChange={(e) => setSlotCode(e.target.value)} placeholder="S-04" /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Storage Location</Label><Select value={storageLocation} onValueChange={setStorageLocation}><SelectTrigger><SelectValue placeholder="Tool room" /></SelectTrigger><SelectContent><SelectItem value="__NONE__">No tooling room assigned</SelectItem>{filteredLocations.map((row: any) => <SelectItem key={row.id} value={row.id}>{row.name}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Vendor</Label><Select value={vendor} onValueChange={setVendor}><SelectTrigger><SelectValue placeholder="Optional vendor" /></SelectTrigger><SelectContent><SelectItem value="__NONE__">No vendor</SelectItem>{vendors.map((row: any) => <SelectItem key={row.id} value={row.id}>{row.name}</SelectItem>)}</SelectContent></Select></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Service Due</Label><Input type="date" value={serviceDueAt || ""} onChange={(e) => setServiceDueAt(e.target.value)} /></div>
        <div><Label>Notes</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes" /></div>
      </div>
      <div className="flex justify-end"><Button type="submit" disabled={busy}>Save</Button></div>
    </form>
  )
}

export default function ToolingPage() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<ToolAsset | null>(null)
  const [searchQuery, setSearchQuery] = useState("")

  const { data: tools = [] } = useQuery({ queryKey: ["tool-assets"], queryFn: () => engineeringService.getToolAssets() })
  const { data: plants = [] } = useQuery({ queryKey: ["plants"], queryFn: factoryService.getPlants })
  const { data: locations = [] } = useQuery({ queryKey: ["factory-locations"], queryFn: factoryService.getLocations })
  const { data: vendors = [] } = useQuery({ queryKey: ["vendors"], queryFn: masterDataService.getVendors })

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return tools
    return tools.filter((row: ToolAsset) => [row.code, row.name, row.asset_type, row.status, row.plant_name, row.location_name, row.rack_code, row.slot_code].map((value) => String(value || "").toLowerCase()).join(" ").includes(q))
  }, [tools, searchQuery])

  const stats = useMemo(() => ({
    total: filtered.length,
    ready: filtered.filter((row) => row.status === "READY").length,
    service: filtered.filter((row) => row.status === "SERVICE_DUE").length,
    retired: filtered.filter((row) => row.status === "RETIRED").length,
  }), [filtered])

  const createMutation = useMutation({ mutationFn: engineeringService.createToolAsset, onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["tool-assets"] }); setOpen(false); toast({ title: "Tool asset created" }) }, onError: (err: any) => toast({ title: "Create failed", description: err?.response?.data?.detail || err?.message, variant: "destructive" }) })
  const updateMutation = useMutation({ mutationFn: ({ id, payload }: { id: string; payload: Partial<ToolAsset> }) => engineeringService.updateToolAsset(id, payload), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["tool-assets"] }); setEditing(null); toast({ title: "Tool asset updated" }) }, onError: (err: any) => toast({ title: "Update failed", description: err?.response?.data?.detail || err?.message, variant: "destructive" }) })
  const deleteMutation = useMutation({ mutationFn: engineeringService.deleteToolAsset, onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["tool-assets"] }); toast({ title: "Tool asset deleted" }) }, onError: (err: any) => toast({ title: "Delete failed", description: err?.response?.data?.detail || err?.message, variant: "destructive" }) })

  return (
    <MasterRegistryShell
      title="Tool Room"
      description="Generic plant tooling register for anilox, sleeves, dies, shafts, adapters, and other production tools."
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      searchPlaceholder="Search tool code, plant, type, rack, slot, or status"
      actions={<Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button><Plus className="mr-2 h-4 w-4" /> Add Tool</Button></DialogTrigger><DialogContent className="max-w-3xl"><DialogHeader><DialogTitle>Create Tool Asset</DialogTitle></DialogHeader><ToolAssetForm plants={plants} locations={locations} vendors={vendors} onSubmit={(payload: any) => createMutation.mutate(payload)} busy={createMutation.isPending} /></DialogContent></Dialog>}
      stats={[
        { label: "Tracked Tools", value: stats.total, icon: Wrench, toneClassName: "bg-blue-50 text-blue-600" },
        { label: "Ready", value: stats.ready, icon: Factory, toneClassName: "bg-success-bg text-emerald-600" },
        { label: "Service Due", value: stats.service, icon: MapPin, toneClassName: "bg-warning-bg text-amber-600" },
        { label: "Retired", value: stats.retired, icon: Trash2, toneClassName: "bg-danger-bg text-rose-600" },
      ]}
      chips={[{ kind: "toolingStatus", value: "READY" }, { kind: "toolingStatus", value: "SERVICE_DUE" }, { kind: "toolingStatus", value: "MAINTENANCE" }]}
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((row) => (
          <Card key={row.id} className="border-0 shadow-sm ring-1 ring-slate-100">
            <CardContent className="space-y-4 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-black tracking-tight text-slate-900">{row.name}</div>
                  <div className="mt-1 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-content-4">{row.code}</div>
                </div>
                <SemanticBadge kind="toolingStatus" value={row.status} />
              </div>
              <div className="flex flex-wrap gap-2">
                <SemanticBadge kind="severity" value="INFO" label={row.asset_type.replaceAll("_", " ")} />
                <SemanticBadge kind="severity" value="LOW" label={`${row.plant_name || "No plant"}`} />
              </div>
              <div className="rounded-2xl bg-slate-50/70 p-4 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-content-4">Storage</div>
                    <div className="mt-1 font-bold text-slate-900">{row.location_name || "Not assigned"}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-content-4">Rack / Slot</div>
                    <div className="mt-1 font-bold text-slate-900">{row.rack_code || "-"} / {row.slot_code || "-"}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-content-4">Vendor</div>
                    <div className="mt-1 font-bold text-slate-900">{row.vendor_name || "-"}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-content-4">Service Due</div>
                    <div className="mt-1 font-bold text-slate-900">{row.service_due_at || "-"}</div>
                  </div>
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

      <Dialog open={!!editing} onOpenChange={(next) => !next && setEditing(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Edit Tool Asset</DialogTitle></DialogHeader>
          {editing ? <ToolAssetForm initial={editing} plants={plants} locations={locations} vendors={vendors} onSubmit={(payload: any) => updateMutation.mutate({ id: editing.id, payload })} busy={updateMutation.isPending} /> : null}
        </DialogContent>
      </Dialog>
    </MasterRegistryShell>
  )
}
