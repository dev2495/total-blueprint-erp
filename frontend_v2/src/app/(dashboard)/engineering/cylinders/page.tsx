"use client"

import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Disc, Pencil, Plus, Search, Trash2, Wrench } from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/hooks/use-toast"
import { engineeringService, type Cylinder } from "@/services/engineering"
import { CylinderDialog } from "@/components/engineering/cylinder-dialog"
import { MasterRegistryShell } from "@/components/master/master-registry-shell"
import { SemanticBadge } from "@/components/ui-custom/semantic-badge"

export default function CylinderManagementPage() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [searchQuery, setSearchQuery] = useState("")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Cylinder | null>(null)

  const { data: cylinders = [], isLoading } = useQuery({ queryKey: ["cylinders"], queryFn: () => engineeringService.getCylinders() })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => engineeringService.deleteCylinder(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cylinders"] })
      toast({ title: "Cylinder deleted" })
    },
    onError: (err: any) => {
      toast({ title: "Delete failed", description: err?.response?.data?.detail || err?.message || "Could not delete cylinder.", variant: "destructive" })
    },
  })

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return cylinders
    return cylinders.filter((row) => [row.code, row.name, row.color_name, row.artwork_name, row.lifecycle_status, row.location_name].map((value) => String(value || "").toLowerCase()).join(" ").includes(q))
  }, [cylinders, searchQuery])

  const stats = useMemo(() => ({
    total: filtered.length,
    draft: filtered.filter((row) => Boolean(row.is_draft)).length,
    ready: filtered.filter((row) => !Boolean(row.is_draft)).length,
    service: filtered.filter((row) => ["MAINTENANCE", "RE_CHROME"].includes(String(row.status || "").toUpperCase())).length,
  }), [filtered])

  return (
    <MasterRegistryShell
      title="Cylinder Catalog"
      description="Artwork-linked print tooling with side-slot mapping, lifecycle, vendor, and storage visibility."
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      searchPlaceholder="Search cylinder code, artwork, color, lifecycle, or storage"
      actions={
        <Button
          onClick={() => {
            setEditing(null)
            setDialogOpen(true)
          }}
          data-testid="cylinder-new-button"
        >
          <Plus className="mr-2 h-4 w-4" /> New Cylinder
        </Button>
      }
      stats={[
        { label: "Total Cylinders", value: stats.total, icon: Disc, toneClassName: "bg-blue-50 text-blue-600" },
        { label: "Draft", value: stats.draft, icon: Pencil, toneClassName: "bg-amber-50 text-amber-600" },
        { label: "Production Ready", value: stats.ready, icon: Disc, toneClassName: "bg-emerald-50 text-emerald-600" },
        { label: "Service Focus", value: stats.service, icon: Wrench, toneClassName: "bg-rose-50 text-rose-600" },
      ]}
      chips={[
        { kind: "toolingStatus", value: "READY" },
        { kind: "toolingStatus", value: "MAINTENANCE" },
        { kind: "toolingStatus", value: "SERVICE_DUE" },
      ]}
    >
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => <Card key={index} className="h-[320px] border-0 shadow-sm ring-1 ring-slate-100" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-0 shadow-sm ring-1 ring-slate-100"><CardContent className="p-10 text-center text-slate-400">No cylinders found.</CardContent></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((row) => (
            <Card key={row.id} className="overflow-hidden border-0 shadow-sm ring-1 ring-slate-100">
              <div className="relative h-40 overflow-hidden bg-slate-100">
                {row.artwork_image ? (
                  <img src={row.artwork_image} alt={row.artwork_name || row.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center bg-gradient-to-br from-slate-100 via-white to-blue-50 text-slate-400">
                    <Disc className="h-12 w-12" />
                  </div>
                )}
              </div>
              <CardContent className="space-y-4 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-black tracking-tight text-slate-900">{row.name}</div>
                    <div className="mt-1 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">{row.code}</div>
                  </div>
                  <SemanticBadge kind="toolingStatus" value={row.status === "ACTIVE" ? "READY" : row.status} label={row.lifecycle_status || row.status} />
                </div>

                <div className="flex flex-wrap gap-2">
                  <SemanticBadge kind="approval" value={row.is_draft ? "PENDING" : "APPROVED"} label={row.is_draft ? "Draft" : "Production"} />
                  <SemanticBadge kind="severity" value="INFO" label={`${row.side || "FRONT"} #${row.side_slot_index || 1}`} />
                </div>

                <div className="grid grid-cols-2 gap-3 rounded-2xl bg-slate-50/70 p-4 text-sm">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Artwork</div>
                    <div className="mt-1 font-bold text-slate-900">{row.artwork_name || "Not linked"}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Color</div>
                    <div className="mt-1 font-bold text-slate-900">{row.color_name || "-"}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Vendor</div>
                    <div className="mt-1 font-bold text-slate-900">{row.engraving_vendor_name || "-"}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Storage</div>
                    <div className="mt-1 font-bold text-slate-900">{row.location_name || "Tool room not assigned"}</div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div className="rounded-xl border border-slate-100 bg-white p-3">
                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Width</div>
                    <div className="mt-1 font-black text-slate-900">{row.width_mm} mm</div>
                  </div>
                  <div className="rounded-xl border border-slate-100 bg-white p-3">
                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Repeat</div>
                    <div className="mt-1 font-black text-slate-900">{row.circumference} mm</div>
                  </div>
                  <div className="rounded-xl border border-slate-100 bg-white p-3">
                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Cell Depth</div>
                    <div className="mt-1 font-black text-slate-900">{row.cell_depth_microns} μ</div>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <Button size="sm" variant="outline" onClick={() => { setEditing(row); setDialogOpen(true) }}>
                    <Pencil className="mr-2 h-4 w-4" /> Edit
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => deleteMutation.mutate(row.id)} disabled={deleteMutation.isPending}>
                    <Trash2 className="mr-2 h-4 w-4" /> Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <CylinderDialog open={dialogOpen} onOpenChange={setDialogOpen} cylinder={editing} />
    </MasterRegistryShell>
  )
}
