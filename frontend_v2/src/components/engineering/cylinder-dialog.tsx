"use client"

import { useEffect, useMemo, useState } from "react"
import { Resolver, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { useToast } from "@/hooks/use-toast"
import { engineeringService, Artwork, Cylinder } from "@/services/engineering"
import { masterDataService } from "@/services/master-data"

const LIFECYCLE_STATUSES = ["DRAFT", "READY", "ACTIVE", "MAINTENANCE", "RE_CHROME", "SCRAP"] as const

const cylinderSchema = z
  .object({
    code: z.string().min(3, "Code required"),
    name: z.string().min(3, "Name required"),
    color_name: z.string().min(1, "Color required"),
    side: z.enum(["FRONT", "BACK"]).default("FRONT"),
    side_slot_index: z.coerce.number().int().min(1),
    artwork: z.string().nullable().optional(),
    engraving_vendor: z.string().nullable().optional(),
    storage_location: z.string().nullable().optional(),
    diameter_mm: z.coerce.number().min(0),
    width_mm: z.coerce.number().min(0),
    circumference: z.coerce.number().min(0),
    cell_depth_microns: z.coerce.number().int().min(0),
    is_draft: z.boolean().default(true),
    lifecycle_status: z.enum(LIFECYCLE_STATUSES).default("DRAFT"),
    status: z.enum(["ACTIVE", "MAINTENANCE", "RE_CHROME", "SCRAP"]).default("ACTIVE"),
  })
  .superRefine((value, ctx) => {
    const requiresFinalization = !value.is_draft || value.lifecycle_status !== "DRAFT"
    if (!requiresFinalization) return
    if (value.diameter_mm <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["diameter_mm"], message: "Diameter is required for finalization." })
    }
    if (value.width_mm <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["width_mm"], message: "Width is required for finalization." })
    }
    if (value.circumference <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["circumference"], message: "Circumference is required for finalization." })
    }
    if (value.cell_depth_microns <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cell_depth_microns"],
        message: "Cell depth is required for finalization.",
      })
    }
    if (!value.engraving_vendor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["engraving_vendor"],
        message: "Vendor is required for finalization.",
      })
    }
  })

type CylinderFormValues = z.infer<typeof cylinderSchema>

interface CylinderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  cylinder?: Cylinder | null
}

function toNullIfNone(value?: string | null): string | null {
  const text = String(value || "").trim()
  if (!text || text === "none") return null
  return text
}

export function CylinderDialog({ open, onOpenChange, cylinder }: CylinderDialogProps) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [submitChecklist, setSubmitChecklist] = useState<string[]>([])

  const { data: artworks = [] } = useQuery<Artwork[]>({
    queryKey: ["artworks"],
    queryFn: () => engineeringService.getArtworks(),
  })
  const { data: locations = [] } = useQuery<any[]>({
    queryKey: ["locations"],
    queryFn: () => masterDataService.getLocations(),
  })
  const { data: vendors = [] } = useQuery<any[]>({
    queryKey: ["vendors"],
    queryFn: () => masterDataService.getVendors(),
  })

  const form = useForm<CylinderFormValues>({
    resolver: zodResolver(cylinderSchema) as Resolver<CylinderFormValues>,
    defaultValues: {
      code: "",
      name: "",
      color_name: "",
      side: "FRONT",
      side_slot_index: 1,
      artwork: null,
      engraving_vendor: null,
      storage_location: null,
      diameter_mm: 100,
      width_mm: 500,
      circumference: 0,
      cell_depth_microns: 0,
      is_draft: true,
      lifecycle_status: "DRAFT",
      status: "ACTIVE",
    },
  })

  useEffect(() => {
    if (cylinder) {
      setSubmitChecklist([])
      form.reset({
        code: cylinder.code,
        name: cylinder.name,
        color_name: cylinder.color_name || "",
        side: (cylinder.side || "FRONT") as "FRONT" | "BACK",
        side_slot_index: Number(cylinder.side_slot_index || 1),
        artwork: cylinder.artwork || null,
        engraving_vendor: cylinder.engraving_vendor || null,
        storage_location: cylinder.storage_location || null,
        diameter_mm: Number(cylinder.diameter_mm || 0),
        width_mm: Number(cylinder.width_mm || 0),
        circumference: Number(cylinder.circumference || 0),
        cell_depth_microns: Number(cylinder.cell_depth_microns || 0),
        is_draft: Boolean(cylinder.is_draft),
        lifecycle_status: ((cylinder.lifecycle_status || "DRAFT").toUpperCase() as CylinderFormValues["lifecycle_status"]) || "DRAFT",
        status: (cylinder.status || "ACTIVE") as CylinderFormValues["status"],
      })
    } else {
      setSubmitChecklist([])
      form.reset({
        code: "",
        name: "",
        color_name: "",
        side: "FRONT",
        side_slot_index: 1,
        artwork: null,
        engraving_vendor: null,
        storage_location: null,
        diameter_mm: 100,
        width_mm: 500,
        circumference: 0,
        cell_depth_microns: 0,
        is_draft: true,
        lifecycle_status: "DRAFT",
        status: "ACTIVE",
      })
    }
  }, [cylinder, form])

  const selectedArtworkId = form.watch("artwork")
  const selectedSide = form.watch("side")
  const isDraft = form.watch("is_draft")
  const lifecycleStatus = form.watch("lifecycle_status")
  const requiresFinalization = !isDraft || lifecycleStatus !== "DRAFT"
  const watchedFinalizeFields = form.watch([
    "diameter_mm",
    "width_mm",
    "circumference",
    "cell_depth_microns",
    "engraving_vendor",
    "code",
    "name",
    "color_name",
  ])

  const selectedArtwork = useMemo(
    () => artworks.find((item) => item.id === selectedArtworkId) || null,
    [artworks, selectedArtworkId]
  )

  const frontPalette = useMemo(
    () =>
      (selectedArtwork?.front_colors || [])
        .map((value) => String(value || "").trim().toUpperCase())
        .filter(Boolean),
    [selectedArtwork]
  )
  const backPalette = useMemo(
    () =>
      (selectedArtwork?.back_colors || [])
        .map((value) => String(value || "").trim().toUpperCase())
        .filter(Boolean),
    [selectedArtwork]
  )

  const availableSides = useMemo(() => {
    if (!selectedArtwork) return ["FRONT", "BACK"] as const
    const options: Array<"FRONT" | "BACK"> = []
    if (Number(selectedArtwork.front_colors_count || frontPalette.length || 0) > 0) options.push("FRONT")
    if (Number(selectedArtwork.back_colors_count || backPalette.length || 0) > 0) options.push("BACK")
    return options.length ? options : (["FRONT", "BACK"] as const)
  }, [selectedArtwork, frontPalette.length, backPalette.length])

  const maxSideSlots = useMemo(() => {
    if (!selectedArtwork) return 0
    if (selectedSide === "BACK") {
      return Number(selectedArtwork.back_colors_count || backPalette.length || 0)
    }
    return Number(selectedArtwork.front_colors_count || frontPalette.length || 0)
  }, [selectedArtwork, selectedSide, frontPalette.length, backPalette.length])

  const sideSlotOptions = useMemo(
    () => (maxSideSlots > 0 ? Array.from({ length: maxSideSlots }, (_, index) => index + 1) : []),
    [maxSideSlots]
  )

  const colorOptions = useMemo(() => {
    if (selectedSide === "BACK" && backPalette.length) return backPalette
    if (selectedSide === "FRONT" && frontPalette.length) return frontPalette
    return []
  }, [selectedSide, frontPalette, backPalette])

  useEffect(() => {
    if (!availableSides.includes(selectedSide)) {
      form.setValue("side", availableSides[0], { shouldDirty: true, shouldValidate: true })
    }
  }, [availableSides, selectedSide, form])

  useEffect(() => {
    const currentSlot = Number(form.getValues("side_slot_index") || 1)
    if (!sideSlotOptions.length) return
    if (currentSlot > sideSlotOptions.length || currentSlot <= 0) {
      form.setValue("side_slot_index", sideSlotOptions[0], { shouldDirty: true, shouldValidate: true })
    }
  }, [sideSlotOptions, form])

  useEffect(() => {
    if (!colorOptions.length) return
    const currentColor = String(form.getValues("color_name") || "").trim().toUpperCase()
    if (currentColor && colorOptions.includes(currentColor)) return
    form.setValue("color_name", colorOptions[0], { shouldDirty: true, shouldValidate: true })
  }, [colorOptions, form])

  const finalizeMissing = useMemo(() => {
    if (!requiresFinalization) return []
    const values = form.getValues()
    const missing: string[] = []
    if (Number(values.diameter_mm || 0) <= 0) missing.push("Diameter (mm)")
    if (Number(values.width_mm || 0) <= 0) missing.push("Width (mm)")
    if (Number(values.circumference || 0) <= 0) missing.push("Circumference (mm)")
    if (Number(values.cell_depth_microns || 0) <= 0) missing.push("Cell Depth (microns)")
    if (!String(values.engraving_vendor || "").trim()) missing.push("Vendor")
    if (!String(values.code || "").trim()) missing.push("Cylinder Code")
    if (!String(values.name || "").trim()) missing.push("Cylinder Name")
    if (!String(values.color_name || "").trim()) missing.push("Color")
    return missing
  }, [form, requiresFinalization, watchedFinalizeFields])

  const mutation = useMutation({
    mutationFn: (values: CylinderFormValues) => {
      const payload = {
        ...values,
        artwork: toNullIfNone(values.artwork),
        engraving_vendor: toNullIfNone(values.engraving_vendor),
        storage_location: toNullIfNone(values.storage_location),
        color_name: String(values.color_name || "").trim().toUpperCase(),
      }
      if (cylinder?.id) return engineeringService.updateCylinder(cylinder.id, payload)
      return engineeringService.createCylinder(payload)
    },
    onSuccess: () => {
      setSubmitChecklist([])
      queryClient.invalidateQueries({ queryKey: ["cylinders"] })
      toast({ title: cylinder ? "Cylinder Updated" : "Cylinder Created" })
      onOpenChange(false)
    },
    onError: (err: any) => {
      const detail = String(err?.response?.data?.detail || err?.response?.data?.error || err?.message || "").trim()
      const checklistFromServer = detail.match(/requires:\s*(.*)$/i)?.[1]
      setSubmitChecklist(
        checklistFromServer
          ? checklistFromServer
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean)
          : finalizeMissing,
      )
      toast({
        title: "Error",
        description: detail || "Could not save cylinder.",
        variant: "destructive",
      })
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col overflow-hidden" data-testid="cylinder-dialog">
        <DialogHeader>
          <DialogTitle>{cylinder ? "Edit Cylinder" : "New Cylinder"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} className="flex min-h-0 flex-1 flex-col">
            <div className="space-y-4 overflow-y-auto pr-1">
              <section className="space-y-3 rounded-lg border border-slate-200 p-3">
                <h3 className="text-xs font-black uppercase tracking-wide text-slate-600">Identity</h3>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="code"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cylinder Code</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="e.g. CYL-001" data-testid="cylinder-code" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="e.g. Trident Front #1" data-testid="cylinder-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                </div>
              </section>

              <section className="space-y-3 rounded-lg border border-slate-200 p-3">
                <h3 className="text-xs font-black uppercase tracking-wide text-slate-600">Artwork Mapping</h3>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="artwork"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Link Artwork</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || "none"}>
                        <FormControl>
                          <SelectTrigger data-testid="cylinder-artwork-select">
                            <SelectValue placeholder="Select artwork" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {artworks.map((item) => (
                            <SelectItem key={item.id} value={item.id}>
                              {item.design_code} · {item.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="color_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Color</FormLabel>
                      {colorOptions.length > 0 ? (
                        <Select onValueChange={field.onChange} value={field.value || colorOptions[0]}>
                          <FormControl>
                            <SelectTrigger data-testid="cylinder-color-select">
                              <SelectValue placeholder="Select mapped color" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {colorOptions.map((color) => (
                              <SelectItem key={color} value={color}>
                                {color}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <FormControl>
                          <Input {...field} placeholder="e.g. YELLOW" data-testid="cylinder-color-input" />
                        </FormControl>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="side"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Side</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                            <SelectTrigger data-testid="cylinder-side-select">
                              <SelectValue />
                            </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {availableSides.includes("FRONT") ? <SelectItem value="FRONT">FRONT</SelectItem> : null}
                          {availableSides.includes("BACK") ? <SelectItem value="BACK">BACK</SelectItem> : null}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="side_slot_index"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Side Slot #</FormLabel>
                      {sideSlotOptions.length > 0 ? (
                        <Select onValueChange={(value) => field.onChange(Number(value))} value={String(field.value || sideSlotOptions[0])}>
                          <FormControl>
                            <SelectTrigger data-testid="cylinder-side-slot-select">
                              <SelectValue placeholder="Select slot" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {sideSlotOptions.map((slot) => (
                              <SelectItem key={slot} value={String(slot)}>
                                Slot {slot}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <FormControl>
                          <Input
                            type="number"
                            min={1}
                            value={field.value}
                            onChange={(event) => field.onChange(Number(event.target.value || 1))}
                          />
                        </FormControl>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />
                </div>
              </section>

              <section className="space-y-3 rounded-lg border border-slate-200 p-3">
                <h3 className="text-xs font-black uppercase tracking-wide text-slate-600">Technical Finalization</h3>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <FormField
                  control={form.control}
                  name="diameter_mm"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Diameter (mm)</FormLabel>
                      <FormControl>
                        <Input type="number" min={0} step="0.01" value={field.value} onChange={(event) => field.onChange(Number(event.target.value || 0))} data-testid="cylinder-diameter" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="width_mm"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Width (mm)</FormLabel>
                      <FormControl>
                        <Input type="number" min={0} step="0.01" value={field.value} onChange={(event) => field.onChange(Number(event.target.value || 0))} data-testid="cylinder-width" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="circumference"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Circumference (mm)</FormLabel>
                      <FormControl>
                        <Input type="number" min={0} step="0.01" value={field.value} onChange={(event) => field.onChange(Number(event.target.value || 0))} data-testid="cylinder-circumference" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <FormField
                  control={form.control}
                  name="cell_depth_microns"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cell Depth (microns)</FormLabel>
                      <FormControl>
                        <Input type="number" min={0} step="1" value={field.value} onChange={(event) => field.onChange(Number(event.target.value || 0))} data-testid="cylinder-cell-depth" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="engraving_vendor"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Vendor</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || "none"}>
                        <FormControl>
                          <SelectTrigger data-testid="cylinder-vendor-select">
                            <SelectValue placeholder="Select vendor" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {vendors.map((vendor) => (
                            <SelectItem key={vendor.id} value={vendor.id}>
                              {vendor.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="storage_location"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Storage Location</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || "none"}>
                        <FormControl>
                          <SelectTrigger data-testid="cylinder-storage-location-select">
                            <SelectValue placeholder="Select location" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {locations.map((location) => (
                            <SelectItem key={location.id} value={location.id}>
                              {location.name} ({location.code})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                </div>
              </section>

              <section className="space-y-3 rounded-lg border border-slate-200 p-3">
                <h3 className="text-xs font-black uppercase tracking-wide text-slate-600">Lifecycle</h3>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <FormField
                  control={form.control}
                  name="is_draft"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Lifecycle Mode</FormLabel>
                      <Select
                        value={field.value ? "DRAFT" : "PRODUCTION"}
                        onValueChange={(value) => {
                          const draftMode = value === "DRAFT"
                          setSubmitChecklist([])
                          field.onChange(draftMode)
                          if (draftMode) {
                            form.setValue("lifecycle_status", "DRAFT", { shouldDirty: true, shouldValidate: true })
                          } else {
                            form.setValue("lifecycle_status", "READY", { shouldDirty: true, shouldValidate: true })
                          }
                        }}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="cylinder-lifecycle-mode">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="DRAFT">DRAFT</SelectItem>
                          <SelectItem value="PRODUCTION">PRODUCTION</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="lifecycle_status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Lifecycle Status</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="cylinder-lifecycle-status">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="DRAFT">DRAFT</SelectItem>
                          {!isDraft ? (
                            <>
                              <SelectItem value="READY">READY</SelectItem>
                              <SelectItem value="ACTIVE">ACTIVE</SelectItem>
                              <SelectItem value="MAINTENANCE">MAINTENANCE</SelectItem>
                              <SelectItem value="RE_CHROME">RE_CHROME</SelectItem>
                              <SelectItem value="SCRAP">SCRAP</SelectItem>
                            </>
                          ) : null}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Operational Status</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="cylinder-operational-status">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="ACTIVE">ACTIVE</SelectItem>
                          <SelectItem value="MAINTENANCE">MAINTENANCE</SelectItem>
                          <SelectItem value="RE_CHROME">RE_CHROME</SelectItem>
                          <SelectItem value="SCRAP">SCRAP</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                </div>
                {requiresFinalization && (submitChecklist.length > 0 || finalizeMissing.length > 0) ? (
                  <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800" data-testid="cylinder-finalization-checklist">
                    Finalization checklist missing: {(submitChecklist.length > 0 ? submitChecklist : finalizeMissing).join(", ")}.
                  </div>
                ) : null}
              </section>
            </div>

            <div className="mt-4 border-t border-slate-200 bg-white pt-4">
              <Button type="submit" className="w-full" disabled={mutation.isPending} data-testid="cylinder-submit">
              {mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {cylinder ? "Update" : "Create"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
