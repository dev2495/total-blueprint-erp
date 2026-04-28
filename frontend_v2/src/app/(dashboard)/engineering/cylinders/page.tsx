"use client"

import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, Disc, Pencil, Plus, Wrench } from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { artworkImageUrls, normalizeMediaUrl, engineeringService, type Artwork, type Cylinder, type CylinderSlotAssignment } from "@/services/engineering"
import { masterDataService } from "@/services/master-data"
import { CylinderDialog } from "@/components/engineering/cylinder-dialog"
import { MasterRegistryShell } from "@/components/master/master-registry-shell"
import { SemanticBadge } from "@/components/ui-custom/semantic-badge"

type CylinderSlotView = {
  key: string
  side: "FRONT" | "BACK"
  slot: number
  color: string
  cylinder?: Cylinder | null
  assignment?: CylinderSlotAssignment | null
}

function slotKey(side: string, slot: number) {
  return `${String(side || "FRONT").toUpperCase()}:${slot}`
}

function asNumber(value: unknown, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function ArtworkCardMedia({ src, name }: { src?: string | null; name: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  if (src && !failed) {
    return <img src={src} alt={name} className="h-full w-full object-cover" onError={() => setFailed(true)} />
  }
  return (
    <div className="flex h-full items-center justify-center bg-gradient-to-br from-slate-100 via-white to-blue-50 text-slate-400">
      <Disc className="h-12 w-12" />
    </div>
  )
}

function artworkSlots(artwork: Artwork, cylinders: Cylinder[], assignments: CylinderSlotAssignment[]): CylinderSlotView[] {
  const frontColors = (artwork.front_colors || []).map((value) => String(value || "").trim().toUpperCase())
  const backColors = (artwork.back_colors || []).map((value) => String(value || "").trim().toUpperCase())
  const directBySlot = new Map<string, Cylinder>()
  const assignmentBySlot = new Map<string, CylinderSlotAssignment>()
  cylinders
    .filter((row) => String(row.artwork || "") === String(artwork.id))
    .forEach((row) => directBySlot.set(slotKey(row.side || "FRONT", Number(row.side_slot_index || 0)), row))
  assignments
    .filter((row) => String(row.artwork || "") === String(artwork.id))
    .forEach((row) => assignmentBySlot.set(slotKey(row.side || "FRONT", Number(row.side_slot_index || 0)), row))

  const rows: CylinderSlotView[] = []
  const pushRows = (side: "FRONT" | "BACK", count: number, colors: string[]) => {
    for (let index = 0; index < count; index += 1) {
      const slot = index + 1
      const key = slotKey(side, slot)
      const assignment = assignmentBySlot.get(key) || null
      const assignedCylinder = assignment ? cylinders.find((row) => String(row.id) === String(assignment.cylinder)) || null : null
      rows.push({
        key,
        side,
        slot,
        color: colors[index] || `${side}-${slot}`,
        cylinder: assignedCylinder || directBySlot.get(key) || null,
        assignment,
      })
    }
  }
  pushRows("FRONT", Number(artwork.front_colors_count || frontColors.length || 0), frontColors)
  if (String(artwork.substrate_mode || "SHEET").toUpperCase() === "TUBING") {
    pushRows("BACK", Number(artwork.back_colors_count || backColors.length || 0), backColors)
  }
  return rows
}

function CylinderArtworkGroupDialog({
  open,
  artwork,
  slots,
  cylinders,
  onOpenChange,
  onEditCylinder,
}: {
  open: boolean
  artwork: Artwork | null
  slots: CylinderSlotView[]
  cylinders: Cylinder[]
  onOpenChange: (open: boolean) => void
  onEditCylinder: (cylinder: Cylinder) => void
}) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [circumference, setCircumference] = useState("")
  const [commonDiameter, setCommonDiameter] = useState("")
  const [commonWidth, setCommonWidth] = useState("")
  const [commonCellDepth, setCommonCellDepth] = useState("")
  const [commonVendor, setCommonVendor] = useState("")
  const [commonLocation, setCommonLocation] = useState("")
  const [commonStatus, setCommonStatus] = useState<"ACTIVE" | "MAINTENANCE" | "SCRAP">("ACTIVE")
  const [selectedBySlot, setSelectedBySlot] = useState<Record<string, string>>({})
  const { data: vendorsRaw = [] } = useQuery({ queryKey: ["vendors"], queryFn: () => masterDataService.getVendors() })
  const { data: locationsRaw = [] } = useQuery({ queryKey: ["locations", "TOOLING"], queryFn: () => masterDataService.getLocations("TOOLING") })
  const vendors = Array.isArray(vendorsRaw) ? vendorsRaw : []
  const locations = Array.isArray(locationsRaw) ? locationsRaw : []

  useEffect(() => {
    if (!open) return
    const first = slots.find((slot) => slot.cylinder)?.cylinder
    setCircumference(first?.circumference ? String(first.circumference) : "")
    setCommonDiameter(first?.diameter_mm ? String(first.diameter_mm) : "")
    setCommonWidth(first?.width_mm ? String(first.width_mm) : "")
    setCommonCellDepth(first?.cell_depth_microns ? String(first.cell_depth_microns) : "")
    setCommonVendor(first?.engraving_vendor || "")
    setCommonLocation(first?.storage_location || "")
    setCommonStatus((["ACTIVE", "MAINTENANCE", "SCRAP"].includes(String(first?.status || "")) ? String(first?.status) : "ACTIVE") as "ACTIVE" | "MAINTENANCE" | "SCRAP")
    setSelectedBySlot({})
  }, [open, artwork?.id])

  const reuseCandidates = useMemo(() => {
    const required = asNumber(circumference, 0)
    return cylinders
      .filter((row) => !Boolean(row.is_draft))
      .filter((row) => Number(row.circumference || 0) > 0)
      .filter((row) => Boolean(row.engraving_vendor && row.storage_location))
      .filter((row) => (required > 0 ? Math.abs(Number(row.circumference || 0) - required) < 0.01 : true))
      .sort((left, right) => String(left.artwork_name || "").localeCompare(String(right.artwork_name || "")) || String(left.code || "").localeCompare(String(right.code || "")))
  }, [cylinders, circumference])

  const assignMutation = useMutation({
    mutationFn: ({ slot, cylinderId }: { slot: CylinderSlotView; cylinderId: string }) => engineeringService.assignCylinderSlot({
      artwork: artwork?.id || "",
      cylinder: cylinderId,
      side: slot.side,
      side_slot_index: slot.slot,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cylinders"] })
      queryClient.invalidateQueries({ queryKey: ["artworks"] })
      queryClient.invalidateQueries({ queryKey: ["cylinder-slot-assignments"] })
      toast({ title: "Cylinder slot assigned" })
    },
    onError: (err: any) => {
      toast({
        title: "Reuse failed",
        description: err?.response?.data?.detail || err?.message || "Could not assign cylinder.",
        variant: "destructive",
      })
    },
  })

  const finalizeGeneratedMutation = useMutation({
    mutationFn: async () => {
      const generatedDrafts = slots
        .map((slot) => slot.cylinder)
        .filter((row): row is Cylinder => Boolean(row && row.is_draft && String(row.artwork || "") === String(artwork?.id || "")))
      if (!generatedDrafts.length) throw new Error("No generated draft cylinders are waiting for common details.")
      if (!commonVendor) throw new Error("Select engraving vendor before finalizing generated cylinders.")
      if (!commonLocation) throw new Error("Select storage location before finalizing generated cylinders.")
      if (asNumber(circumference, 0) <= 0) throw new Error("Enter circumference before finalizing generated cylinders.")
      const payload: Partial<Cylinder> = {
        diameter_mm: asNumber(commonDiameter, 100),
        width_mm: asNumber(commonWidth, 500),
        circumference: asNumber(circumference, 0),
        cell_depth_microns: asNumber(commonCellDepth, 0),
        engraving_vendor: commonVendor,
        storage_location: commonLocation,
        is_draft: false,
        lifecycle_status: commonStatus,
        status: commonStatus,
      }
      await Promise.all(generatedDrafts.map((row) => engineeringService.updateCylinder(row.id, payload)))
      return generatedDrafts.length
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["cylinders"] })
      queryClient.invalidateQueries({ queryKey: ["artworks"] })
      queryClient.invalidateQueries({ queryKey: ["cylinder-slot-assignments"] })
      toast({ title: "Generated cylinders finalized", description: `${count} cylinder(s) now share the common technical details.` })
    },
    onError: (err: any) => {
      toast({
        title: "Finalization blocked",
        description: err?.response?.data?.detail || err?.message || "Could not finalize generated cylinders.",
        variant: "destructive",
      })
    },
  })

  if (!artwork) return null

  const coveredCount = slots.filter((slot) => slot.cylinder).length
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-hidden p-0" data-testid="cylinder-artwork-group-dialog">
        <DialogHeader className="border-b border-slate-100 px-6 py-5">
          <DialogTitle className="text-xl font-black text-slate-950">{artwork.design_code} cylinder set</DialogTitle>
          <div className="mt-1 text-sm text-slate-500">
            {artwork.name} · {artwork.print_type || "PRINT"} · {artwork.substrate_mode || "SHEET"} · {coveredCount}/{slots.length} slots covered
          </div>
        </DialogHeader>
        <div className="grid max-h-[72vh] gap-5 overflow-y-auto p-6 lg:grid-cols-[280px_1fr]">
          <aside className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div>
              <Label className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Required Circumference</Label>
              <Input
                type="number"
                step="0.01"
                value={circumference}
                onChange={(event) => setCircumference(event.target.value)}
                placeholder="Repeat in mm"
                className="mt-2 bg-white"
                data-testid="cylinder-reuse-circumference"
              />
              <p className="mt-2 text-xs leading-5 text-slate-500">
                Enter the repeat once, then reuse any finalized cylinder with the same circumference for empty slots.
              </p>
            </div>
            <div className="space-y-3 border-t border-slate-200 pt-4">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Common Technical Details</div>
              <Select value={commonVendor || "__NONE__"} onValueChange={(value) => setCommonVendor(value === "__NONE__" ? "" : value)}>
                <SelectTrigger className="bg-white"><SelectValue placeholder="Engraving vendor" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__NONE__">Select vendor</SelectItem>
                  {vendors.map((vendor: any) => <SelectItem key={vendor.id} value={vendor.id}>{vendor.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={commonLocation || "__NONE__"} onValueChange={(value) => setCommonLocation(value === "__NONE__" ? "" : value)}>
                <SelectTrigger className="bg-white"><SelectValue placeholder="Cylinder location" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__NONE__">Select location</SelectItem>
                  {locations.map((location: any) => <SelectItem key={location.id} value={location.id}>{location.name} ({location.code})</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={commonStatus} onValueChange={(value) => setCommonStatus(value as "ACTIVE" | "MAINTENANCE" | "SCRAP")}>
                <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">ACTIVE</SelectItem>
                  <SelectItem value="MAINTENANCE">MAINTENANCE</SelectItem>
                  <SelectItem value="SCRAP">SCRAP</SelectItem>
                </SelectContent>
              </Select>
              <Button className="w-full" disabled={finalizeGeneratedMutation.isPending} onClick={() => finalizeGeneratedMutation.mutate()}>
                <CheckCircle2 className="mr-2 h-4 w-4" /> Confirm Generated Cylinders
              </Button>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Matching Reuse Pool</div>
              <div className="mt-2 text-2xl font-black text-slate-950">{reuseCandidates.length}</div>
              <div className="text-xs text-slate-500">finalized cylinders</div>
            </div>
          </aside>
          <div className="space-y-3">
            {slots.map((slot) => {
              const selected = selectedBySlot[slot.key] || ""
              return (
                <div key={slot.key} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:grid-cols-[1fr_320px]">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{slot.side} {slot.slot}</Badge>
                      <div className="text-sm font-black text-slate-950">{slot.color}</div>
                      {slot.cylinder ? (
                        <SemanticBadge kind="approval" value={slot.cylinder.is_draft ? "PENDING" : "APPROVED"} label={slot.cylinder.is_draft ? "Draft cylinder" : "Ready / reused"} />
                      ) : (
                        <SemanticBadge kind="severity" value="MEDIUM" label="Empty slot" />
                      )}
                    </div>
                    {slot.cylinder ? (
                      <div className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-3">
                        <div><span className="font-semibold text-slate-900">{slot.cylinder.code}</span><br />{slot.cylinder.artwork_name || "Current artwork"}</div>
                        <div>{slot.cylinder.circumference || 0} mm repeat<br />{slot.cylinder.engraving_vendor_name || "Vendor pending"}</div>
                        <div>{slot.cylinder.location_name || "Location pending"}<br />{slot.cylinder.lifecycle_status || slot.cylinder.status}</div>
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-slate-500">No new cylinder is required unless this color has no reusable physical cylinder.</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {slot.cylinder ? (
                      <Button variant="outline" className="w-full" onClick={() => onEditCylinder(slot.cylinder as Cylinder)}>
                        <Pencil className="mr-2 h-4 w-4" /> Edit cylinder
                      </Button>
                    ) : (
                      <>
                        <Select value={selected || "__NONE__"} onValueChange={(value) => setSelectedBySlot((current) => ({ ...current, [slot.key]: value === "__NONE__" ? "" : value }))}>
                          <SelectTrigger className="bg-white" data-testid={`cylinder-reuse-${slot.side}-${slot.slot}`}>
                            <SelectValue placeholder="Reuse existing cylinder" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__NONE__">Select matching cylinder</SelectItem>
                            {reuseCandidates.map((candidate) => (
                              <SelectItem key={candidate.id} value={candidate.id}>
                                {candidate.code} · {candidate.color_name || "Color"} · {candidate.artwork_name || "Unlinked"} · {candidate.circumference}mm
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          disabled={!selected || assignMutation.isPending}
                          onClick={() => assignMutation.mutate({ slot, cylinderId: selected })}
                        >
                          Use
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default function CylinderManagementPage() {
  const [searchQuery, setSearchQuery] = useState("")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Cylinder | null>(null)
  const [groupArtwork, setGroupArtwork] = useState<Artwork | null>(null)

  const { data: cylindersRaw = [], isLoading } = useQuery({ queryKey: ["cylinders"], queryFn: () => engineeringService.getCylinders() })
  const { data: artworksRaw = [] } = useQuery<Artwork[]>({ queryKey: ["artworks"], queryFn: () => engineeringService.getArtworks() })
  const { data: assignmentsRaw = [] } = useQuery<CylinderSlotAssignment[]>({
    queryKey: ["cylinder-slot-assignments"],
    queryFn: () => engineeringService.getCylinderSlotAssignments(),
  })
  const cylinders = Array.isArray(cylindersRaw) ? cylindersRaw : []
  const artworks = Array.isArray(artworksRaw) ? artworksRaw : []
  const assignments = Array.isArray(assignmentsRaw) ? assignmentsRaw : []

  const groups = useMemo(() => {
    const artworkById = new Map(artworks.map((artwork) => [String(artwork.id), artwork]))
    for (const cylinder of cylinders) {
      if (cylinder.artwork && !artworkById.has(String(cylinder.artwork))) {
        artworkById.set(String(cylinder.artwork), {
          id: String(cylinder.artwork),
          design_code: "",
          name: cylinder.artwork_name || "Linked artwork",
          print_type: "ROTO",
          substrate_mode: "TUBING",
          color_list: [],
          colors_count: 0,
          file_path: "",
          image: cylinder.artwork_image || null,
          primary_image: cylinder.artwork_image || null,
          images: cylinder.artwork_image ? [{ id: "linked", image: cylinder.artwork_image, sort_order: 0 }] : [],
          version: 1,
          status: "DRAFT",
          created_at: "",
        } as Artwork)
      }
    }
    return Array.from(artworkById.values())
      .map((artwork) => ({ artwork, slots: artworkSlots(artwork, cylinders, assignments) }))
      .filter((group) => group.slots.length > 0 || cylinders.some((row) => String(row.artwork || "") === String(group.artwork.id)))
  }, [artworks, cylinders, assignments])

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return groups
    return groups.filter((group) => {
      const haystack = [
        group.artwork.design_code,
        group.artwork.name,
        group.artwork.print_type,
        group.artwork.substrate_mode,
        ...group.slots.flatMap((slot) => [slot.color, slot.cylinder?.code, slot.cylinder?.name, slot.cylinder?.artwork_name]),
      ].map((value) => String(value || "").toLowerCase()).join(" ")
      return haystack.includes(q)
    })
  }, [groups, searchQuery])

  const stats = useMemo(() => ({
    total: filtered.reduce((sum, group) => sum + group.slots.length, 0),
    draft: filtered.reduce((sum, group) => sum + group.slots.filter((slot) => slot.cylinder?.is_draft).length, 0),
    ready: filtered.reduce((sum, group) => sum + group.slots.filter((slot) => slot.cylinder && !slot.cylinder.is_draft).length, 0),
    service: cylinders.filter((row) => ["MAINTENANCE", "RE_CHROME"].includes(String(row.status || "").toUpperCase())).length,
  }), [filtered, cylinders])

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
          {filtered.map((group) => {
            const covered = group.slots.filter((slot) => slot.cylinder).length
            const draft = group.slots.filter((slot) => slot.cylinder?.is_draft).length
            const ready = group.slots.filter((slot) => slot.cylinder && !slot.cylinder.is_draft).length
            const firstCylinder = group.slots.find((slot) => slot.cylinder)?.cylinder || null
            const artworkImage = artworkImageUrls(group.artwork)[0] || normalizeMediaUrl(firstCylinder?.artwork_image) || null
            return (
            <Card key={group.artwork.id} className="overflow-hidden border-0 shadow-sm ring-1 ring-slate-100">
              <div className="relative h-40 overflow-hidden bg-slate-100">
                <ArtworkCardMedia src={artworkImage} name={group.artwork.name} />
              </div>
              <CardContent className="space-y-4 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-black tracking-tight text-slate-900">{group.artwork.name}</div>
                    <div className="mt-1 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">{group.artwork.design_code || "ARTWORK"}</div>
                  </div>
                  <SemanticBadge kind="toolingStatus" value={covered === group.slots.length ? "READY" : "SERVICE_DUE"} label={`${covered}/${group.slots.length} covered`} />
                </div>

                <div className="flex flex-wrap gap-2">
                  <SemanticBadge kind="approval" value={draft ? "PENDING" : "APPROVED"} label={draft ? `${draft} draft` : `${ready} ready`} />
                  <SemanticBadge kind="severity" value="INFO" label={`${group.artwork.print_type || "PRINT"} · ${group.artwork.substrate_mode || "SHEET"}`} />
                </div>

                <div className="grid grid-cols-2 gap-3 rounded-2xl bg-slate-50/70 p-4 text-sm">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Front / Back</div>
                    <div className="mt-1 font-bold text-slate-900">F{group.artwork.front_colors_count || 0} / B{group.artwork.back_colors_count || 0}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Empty Slots</div>
                    <div className="mt-1 font-bold text-slate-900">{Math.max(0, group.slots.length - covered)}</div>
                  </div>
                  <div className="col-span-2">
                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Slot Colors</div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {group.slots.slice(0, 8).map((slot) => (
                        <span key={slot.key} className={`rounded-full border px-2 py-1 text-[10px] font-bold ${slot.cylinder ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-500"}`}>
                          {slot.side[0]}{slot.slot} {slot.color}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div className="rounded-xl border border-slate-100 bg-white p-3">
                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Ready</div>
                    <div className="mt-1 font-black text-slate-900">{ready}</div>
                  </div>
                  <div className="rounded-xl border border-slate-100 bg-white p-3">
                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Draft</div>
                    <div className="mt-1 font-black text-slate-900">{draft}</div>
                  </div>
                  <div className="rounded-xl border border-slate-100 bg-white p-3">
                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Reuse</div>
                    <div className="mt-1 font-black text-slate-900">{group.slots.filter((slot) => slot.assignment && slot.cylinder?.artwork !== group.artwork.id).length}</div>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <Button size="sm" variant="outline" onClick={() => setGroupArtwork(group.artwork)}>
                    <Pencil className="mr-2 h-4 w-4" /> Manage Slots
                  </Button>
                </div>
              </CardContent>
            </Card>
            )
          })}
        </div>
      )}

      <CylinderDialog open={dialogOpen} onOpenChange={setDialogOpen} cylinder={editing} />
      <CylinderArtworkGroupDialog
        open={Boolean(groupArtwork)}
        artwork={groupArtwork}
        slots={groupArtwork ? artworkSlots(groupArtwork, cylinders, assignments) : []}
        cylinders={cylinders}
        onOpenChange={(open) => {
          if (!open) setGroupArtwork(null)
        }}
        onEditCylinder={(cylinder) => {
          setEditing(cylinder)
          setDialogOpen(true)
        }}
      />
    </MasterRegistryShell>
  )
}
