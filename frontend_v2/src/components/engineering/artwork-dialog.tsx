"use client"

import { useState, useEffect, useMemo } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, Palette, ShieldCheck, RefreshCw, Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog"
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
    FormDescription,
} from "@/components/ui/form"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/hooks/use-toast"
import { engineeringService, Artwork } from "@/services/engineering"
import { masterDataService } from "@/services/master-data"

const artworkSchema = z.object({
    design_code: z.string().min(3, "Design code required"),
    name: z.string().min(3, "Name required"),
    print_type: z.enum(["FLEXO", "ROTO", "DIGITAL"]),
    substrate_mode: z.enum(["SHEET", "TUBING"]),
    front_colors_count: z.number().min(0),
    back_colors_count: z.number().min(0),
    front_colors: z.array(z.string()),
    back_colors: z.array(z.string()),
    colors_count: z.number().min(0),
    color_list: z.array(z.string()),
    file_path: z.string().optional(),
    image: z.any().optional(), // Used for local file selection
})

type ArtworkFormValues = z.infer<typeof artworkSchema>

interface ArtworkDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    artwork?: Artwork | null
}

export function ArtworkDialog({ open, onOpenChange, artwork }: ArtworkDialogProps) {
    const { toast } = useToast()
    const queryClient = useQueryClient()
    const [previewUrl, setPreviewUrl] = useState<string | null>(null)
    const [activeArtworkId, setActiveArtworkId] = useState<string | null>(artwork?.id || null)
    const [generatingSlotKey, setGeneratingSlotKey] = useState<string | null>(null)

    const { data: inks } = useQuery({
        queryKey: ["inks"],
        queryFn: () => masterDataService.getInks()
    })

    const form = useForm<ArtworkFormValues>({
        resolver: zodResolver(artworkSchema),
        defaultValues: {
            design_code: "",
            name: "",
            print_type: "FLEXO" as const,
            substrate_mode: "SHEET" as const,
            front_colors_count: 0,
            back_colors_count: 0,
            front_colors: [],
            back_colors: [],
            colors_count: 0,
            color_list: [],
            file_path: "",
        }
    })

    useEffect(() => {
        setActiveArtworkId(artwork?.id || null)
        if (artwork) {
            form.reset({
                design_code: artwork.design_code,
                name: artwork.name,
                print_type: (artwork as any).print_type || "FLEXO",
                substrate_mode: (artwork as any).substrate_mode || "SHEET",
                front_colors_count: Number((artwork as any).front_colors_count || 0),
                back_colors_count: Number((artwork as any).back_colors_count || 0),
                front_colors: ((artwork as any).front_colors || []).map((v: any) => String(v)),
                back_colors: ((artwork as any).back_colors || []).map((v: any) => String(v)),
                colors_count: artwork.colors_count,
                color_list: artwork.color_list || [],
                file_path: artwork.file_path || "",
            })
            setPreviewUrl(artwork.image || null)
        } else {
            form.reset({
                design_code: "",
                name: "",
                print_type: "FLEXO",
                substrate_mode: "SHEET",
                front_colors_count: 0,
                back_colors_count: 0,
                front_colors: [],
                back_colors: [],
                colors_count: 0,
                color_list: [],
                file_path: "",
            })
            setPreviewUrl(null)
        }
    }, [artwork, form])

    const mutation = useMutation({
        mutationFn: (values: ArtworkFormValues) => {
            const formData = new FormData()
            formData.append("design_code", values.design_code)
            formData.append("name", values.name)
            formData.append("print_type", values.print_type)
            formData.append("substrate_mode", values.substrate_mode)
            formData.append("film_type", values.substrate_mode)
            formData.append("front_colors_count", String(values.front_colors_count || 0))
            formData.append("back_colors_count", String(values.back_colors_count || 0))
            formData.append("front_colors", JSON.stringify(values.front_colors || []))
            formData.append("back_colors", JSON.stringify(values.back_colors || []))
            formData.append("colors_count", values.colors_count.toString())
            formData.append("color_list", JSON.stringify(values.color_list))

            if (values.image instanceof File) {
                formData.append("image", values.image)
            }

            if (artwork?.id) return engineeringService.updateArtwork(artwork.id, formData)
            return engineeringService.createArtwork(formData)
        },
        onSuccess: (saved: any) => {
            const savedId = String(saved?.id || "")
            if (savedId) {
                setActiveArtworkId(savedId)
            }
            if (saved?.image) {
                setPreviewUrl(String(saved.image))
            }
            queryClient.invalidateQueries({ queryKey: ["artworks"] })
        },
        onError: (err: any) => toast({ title: "Error", description: err.response?.data?.detail || err.message, variant: "destructive" })
    })

    const approveMutation = useMutation({
        mutationFn: (artworkId: string) => engineeringService.approveArtwork(artworkId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["artworks"] })
            toast({ title: "Artwork Approved", description: "This artwork is now valid for production." })
            onOpenChange(false)
        },
        onError: (err: any) => {
            const apiError = err?.response?.data || {}
            const code = String(apiError?.error?.code || apiError?.code || "").trim()
            const message = String(apiError?.error?.message || apiError?.detail || err?.message || "Approval failed.")
            const checklist = Array.isArray(apiError?.error?.checklist) ? apiError.error.checklist : []
            const detail = checklist.length
                ? `${message} ${checklist.map((row: any) => String(row?.detail || row?.message || "").trim()).filter(Boolean).join(" ")}`
                : message
            toast({
                title: code ? `Approval Failed (${code})` : "Approval Failed",
                description: detail,
                variant: "destructive",
            })
        },
    })
    const generateCylindersMutation = useMutation({
        mutationFn: ({ artworkId, side, slot }: { artworkId: string; side: "FRONT" | "BACK"; slot: number }) =>
            engineeringService.generateArtworkCylinders(artworkId, { side, slot }),
        onSuccess: (res: any) => {
            queryClient.invalidateQueries({ queryKey: ["artworks"] })
            queryClient.invalidateQueries({ queryKey: ["cylinders"] })
            queryClient.invalidateQueries({ queryKey: ["artwork-cylinders"] })
            queryClient.invalidateQueries({ queryKey: ["cylinder-slot-assignments"] })
            toast({
                title: Number(res?.count || 0) > 0 ? "Draft cylinder generated" : "Cylinder slot already covered",
                description: `Created ${Number(res?.count || 0)}, existing draft ${Number(res?.existing_draft_count || 0)}, existing finalized ${Number(res?.existing_finalized_count || 0)}.`,
            })
        },
        onError: (err: any) => {
            const apiError = err?.response?.data || {}
            const code = String(apiError?.error?.code || apiError?.code || "").trim()
            const message = String(apiError?.error?.message || apiError?.detail || err?.message || "Could not generate cylinders.")
            toast({
                title: "Cylinder generation failed",
                description: code ? `${message} (${code})` : message,
                variant: "destructive",
            })
        },
    })

    const isApproved = artwork?.status === "APPROVED"
    const printType = String(form.watch("print_type") || "FLEXO").toUpperCase()
    const substrateMode = String(form.watch("substrate_mode") || "SHEET").toUpperCase()
    const hasBackSide = substrateMode === "TUBING"
    const frontColors = form.watch("front_colors") || []
    const backColors = hasBackSide ? (form.watch("back_colors") || []) : []
    const frontColorCount = Number(form.watch("front_colors_count") || 0)
    const backColorCount = Number(form.watch("back_colors_count") || 0)
    const { data: artworkCylinders = [] } = useQuery({
        queryKey: ["artwork-cylinders", activeArtworkId || "none"],
        queryFn: () => engineeringService.getCylinders({ artwork: activeArtworkId }),
        enabled: Boolean(activeArtworkId) && printType === "ROTO",
    })
    const { data: cylinderAssignments = [] } = useQuery({
        queryKey: ["cylinder-slot-assignments", activeArtworkId || "none"],
        queryFn: () => engineeringService.getCylinderSlotAssignments({ artwork: activeArtworkId }),
        enabled: Boolean(activeArtworkId) && printType === "ROTO",
    })
    const inkColorOptions = useMemo(() => {
        const uniq = new Set<string>()
        for (const row of (inks || [])) {
            const color = String((row as any)?.color_name || "").trim().toUpperCase()
            if (color) uniq.add(color)
        }
        return Array.from(uniq).sort()
    }, [inks])
    const colorList = [...frontColors, ...backColors].map(c => String(c).trim().toUpperCase()).filter(Boolean)
    const hasPrintColors = colorList.length > 0
    const colorContractOk = hasPrintColors && frontColorCount === frontColors.length && (!hasBackSide || backColorCount === backColors.length)
    const filePathAsset = String(form.watch("file_path") || "").trim()
    const hasImage = !!previewUrl
    const hasProductionAsset = hasImage || !!filePathAsset

    const finalizedCylinders = useMemo(
        () => (artworkCylinders || []).filter((row: any) => !Boolean(row?.is_draft)),
        [artworkCylinders]
    )
    const finalizedAssignments = useMemo(
        () => (cylinderAssignments || []).filter((row: any) => !Boolean(row?.cylinder_is_draft)),
        [cylinderAssignments]
    )
    const requiredFrontSlots = useMemo(
        () => Array.from({ length: Math.max(0, frontColorCount) }, (_, idx) => idx + 1),
        [frontColorCount]
    )
    const requiredBackSlots = useMemo(
        () => Array.from({ length: Math.max(0, backColorCount) }, (_, idx) => idx + 1),
        [backColorCount]
    )
    const finalizedFrontSlots = useMemo(
        () => new Set([
            ...finalizedCylinders.filter((row: any) => String(row?.side || "FRONT").toUpperCase() !== "BACK").map((row: any) => Number(row?.side_slot_index || 0)),
            ...finalizedAssignments.filter((row: any) => String(row?.side || "FRONT").toUpperCase() !== "BACK").map((row: any) => Number(row?.side_slot_index || 0)),
        ]),
        [finalizedCylinders, finalizedAssignments]
    )
    const finalizedBackSlots = useMemo(
        () => new Set([
            ...finalizedCylinders.filter((row: any) => String(row?.side || "").toUpperCase() === "BACK").map((row: any) => Number(row?.side_slot_index || 0)),
            ...finalizedAssignments.filter((row: any) => String(row?.side || "").toUpperCase() === "BACK").map((row: any) => Number(row?.side_slot_index || 0)),
        ]),
        [finalizedCylinders, finalizedAssignments]
    )
    const missingFrontSlots = useMemo(
        () => requiredFrontSlots.filter((slot) => !finalizedFrontSlots.has(slot)),
        [requiredFrontSlots, finalizedFrontSlots]
    )
    const missingBackSlots = useMemo(
        () => requiredBackSlots.filter((slot) => !finalizedBackSlots.has(slot)),
        [requiredBackSlots, finalizedBackSlots]
    )
    const incompleteFinalizedSlots = useMemo(() => {
        return finalizedCylinders
            .filter((row: any) => {
                return (
                    !String(row?.code || "").trim() ||
                    !String(row?.name || "").trim() ||
                    !String(row?.color_name || "").trim() ||
                    Number(row?.diameter_mm || 0) <= 0 ||
                    Number(row?.width_mm || 0) <= 0 ||
                    Number(row?.circumference || 0) <= 0 ||
                    Number(row?.cell_depth_microns || 0) <= 0
                )
            })
            .map((row: any) => `${String(row?.side || "FRONT").toUpperCase()}-${Number(row?.side_slot_index || 0)}`)
            .concat(
                finalizedAssignments
                    .filter((row: any) => {
                        return (
                            Number(row?.cylinder_diameter_mm || 0) <= 0 ||
                            Number(row?.cylinder_width_mm || 0) <= 0 ||
                            Number(row?.cylinder_circumference || 0) <= 0 ||
                            Number(row?.cylinder_cell_depth_microns || 0) <= 0
                        )
                    })
                    .map((row: any) => `${String(row?.side || "FRONT").toUpperCase()}-${Number(row?.side_slot_index || 0)}`)
            )
    }, [finalizedCylinders, finalizedAssignments])

    const rotoChecklist = useMemo(
        () => [
            {
                id: "image",
                label: "Artwork image or file uploaded",
                ok: hasProductionAsset,
            },
            {
                id: "colors-assigned",
                label: "At least one print color assigned",
                ok: hasPrintColors,
            },
            {
                id: "front-colors",
                label: "Front color count matches list",
                ok: frontColorCount === frontColors.length,
            },
            {
                id: "back-colors",
                label: "Back color count matches list",
                ok: !hasBackSide || backColorCount === backColors.length,
            },
            {
                id: "front-slots",
                label: "Finalized front cylinder slots complete",
                ok: printType !== "ROTO" || missingFrontSlots.length === 0,
                detail: missingFrontSlots.length ? `Missing slots: ${missingFrontSlots.join(", ")}` : "",
            },
            {
                id: "back-slots",
                label: "Finalized back cylinder slots complete",
                ok: printType !== "ROTO" || !hasBackSide || missingBackSlots.length === 0,
                detail: missingBackSlots.length ? `Missing slots: ${missingBackSlots.join(", ")}` : "",
            },
            {
                id: "technical-finalized",
                label: "Finalized cylinders have technical details",
                ok: printType !== "ROTO" || incompleteFinalizedSlots.length === 0,
                detail: incompleteFinalizedSlots.length ? `Incomplete: ${incompleteFinalizedSlots.join(", ")}` : "",
            },
        ],
        [
            hasProductionAsset,
            hasPrintColors,
            frontColorCount,
            frontColors.length,
            backColorCount,
            backColors.length,
            hasBackSide,
            printType,
            missingFrontSlots,
            missingBackSlots,
            incompleteFinalizedSlots,
        ]
    )

    const approvalBlockers = useMemo(() => {
        const blockers: string[] = []
        if (!hasProductionAsset) blockers.push("Upload artwork image or file.")
        if (!hasPrintColors) blockers.push(hasBackSide ? "Add at least one front or back print color." : "Add at least one front print color.")
        if (frontColorCount !== frontColors.length) blockers.push("Front color list/count mismatch.")
        if (hasBackSide && backColorCount !== backColors.length) blockers.push("Back color list/count mismatch.")
        if (!activeArtworkId) blockers.push("Save draft before approval.")
        if (printType === "ROTO") {
            if (missingFrontSlots.length) blockers.push(`Missing finalized front slots: ${missingFrontSlots.join(", ")}.`)
            if (hasBackSide && missingBackSlots.length) blockers.push(`Missing finalized back slots: ${missingBackSlots.join(", ")}.`)
            if (incompleteFinalizedSlots.length) blockers.push(`Finalize technical data for: ${incompleteFinalizedSlots.join(", ")}.`)
        }
        return blockers
    }, [
        hasProductionAsset,
        hasPrintColors,
        frontColorCount,
        frontColors.length,
        backColorCount,
        backColors.length,
        hasBackSide,
        activeArtworkId,
        printType,
        missingFrontSlots,
        missingBackSlots,
        incompleteFinalizedSlots,
    ])
    const canApprove = !isApproved && approvalBlockers.length === 0
    const canGenerateCylinders = printType === "ROTO" && colorContractOk
    const slotCoverage = useMemo(() => {
        const map = new Map<string, { state: "draft" | "ready"; label: string }>()
        for (const row of artworkCylinders || []) {
            const side = String((row as any)?.side || "FRONT").toUpperCase()
            const slot = Number((row as any)?.side_slot_index || 0)
            if (!slot) continue
            map.set(`${side}:${slot}`, {
                state: Boolean((row as any)?.is_draft) ? "draft" : "ready",
                label: String((row as any)?.code || (row as any)?.name || "Cylinder"),
            })
        }
        for (const row of cylinderAssignments || []) {
            const side = String((row as any)?.side || "FRONT").toUpperCase()
            const slot = Number((row as any)?.side_slot_index || 0)
            if (!slot) continue
            map.set(`${side}:${slot}`, {
                state: Boolean((row as any)?.cylinder_is_draft) ? "draft" : "ready",
                label: String((row as any)?.cylinder_code || (row as any)?.cylinder_name || "Assigned cylinder"),
            })
        }
        return map
    }, [artworkCylinders, cylinderAssignments])
    const rotoColorSlots = useMemo(() => {
        const front = frontColors.map((color, index) => ({ side: "FRONT" as const, slot: index + 1, color: String(color || "").toUpperCase() }))
        const back = hasBackSide
            ? backColors.map((color, index) => ({ side: "BACK" as const, slot: index + 1, color: String(color || "").toUpperCase() }))
            : []
        return [...front, ...back]
    }, [frontColors, backColors, hasBackSide])

    async function generateCylinderForSlot(target: { side: "FRONT" | "BACK"; slot: number }) {
        setGeneratingSlotKey(`${target.side}:${target.slot}`)
        try {
            const saved = await mutation.mutateAsync(form.getValues() as ArtworkFormValues)
            const targetId = String(saved?.id || activeArtworkId || "")
            if (!targetId) {
                toast({
                    title: "Draft required",
                    description: "Please save artwork details first.",
                    variant: "destructive",
                })
                return
            }
            await generateCylindersMutation.mutateAsync({ artworkId: targetId, side: target.side, slot: target.slot })
        } catch {
            // handled in mutation onError / generate onError
        } finally {
            setGeneratingSlotKey(null)
        }
    }

    useEffect(() => {
        if (!hasBackSide && (form.getValues("back_colors") || []).length > 0) {
            form.setValue("back_colors", [], { shouldDirty: true, shouldValidate: true })
        }
        form.setValue("front_colors_count", frontColors.length, { shouldValidate: true })
        form.setValue("back_colors_count", backColors.length, { shouldValidate: true })
        form.setValue("colors_count", colorList.length, { shouldValidate: true })
        form.setValue("color_list", colorList, { shouldValidate: false })
    }, [frontColors, backColors, colorList.join("|"), form, hasBackSide])

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl bg-[#fafafa]" data-testid="artwork-dialog">
                <DialogHeader className="border-b pb-2">
                    <div className="flex items-center justify-between pr-4">
                        <div>
                            <DialogTitle className="text-xl font-black uppercase text-slate-800">
                                {artwork ? `Edit: ${artwork.design_code}` : "New Artwork"}
                            </DialogTitle>
                            <DialogDescription className="text-xs font-medium text-slate-500">
                                Manage visual definition, side colors, and print method.
                            </DialogDescription>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="ghost" size="icon" className="h-8 w-8 text-slate-400"
                                onClick={() => queryClient.invalidateQueries({ queryKey: ["artworks"] })}
                                title="Force Refresh"
                            >
                                <RefreshCw className="h-3 w-3" />
                            </Button>
                            {isApproved && <Badge className="bg-emerald-500 text-white font-bold">APPROVED</Badge>}
                            {!isApproved && artwork && <Badge variant="outline" className="text-amber-600 bg-amber-50">DRAFT</Badge>}
                        </div>
                    </div>
                </DialogHeader>

                <Form {...form}>
                    <form className="space-y-4">
                        <div className="space-y-5 px-1 max-h-[70vh] overflow-y-auto pb-4 pr-2">
                            <div className="grid grid-cols-2 gap-4">
                                <FormField control={form.control} name="design_code" render={({ field }) => (
                                    <FormItem><FormLabel className="text-[10px] font-bold uppercase text-slate-500">Code</FormLabel><FormControl><Input {...field} className="font-mono bg-white" placeholder="ART-XXX" data-testid="artwork-design-code" /></FormControl></FormItem>
                                )} />
                                <FormField control={form.control} name="name" render={({ field }) => (
                                    <FormItem><FormLabel className="text-[10px] font-bold uppercase text-slate-500">Name</FormLabel><FormControl><Input {...field} className="bg-white" placeholder="Description" data-testid="artwork-name" /></FormControl></FormItem>
                                )} />
                            </div>
                            <FormField control={form.control} name="image" render={({ field: { value, onChange, ...field } }) => (
                                <FormItem>
                                    <FormLabel className="text-[10px] font-bold uppercase text-slate-500">Artwork Image (JPG/PNG)</FormLabel>
                                    <FormControl>
                                        <div className="space-y-4">
                                            {previewUrl && (
                                                <div className="relative w-full max-h-[300px] flex items-center justify-center rounded-2xl overflow-hidden border bg-slate-50/50 shadow-inner group p-2">
                                                    <img
                                                        src={previewUrl}
                                                        alt="Artwork Preview"
                                                        className="max-w-full max-h-[280px] w-auto h-auto object-contain drop-shadow-sm"
                                                        onLoad={(event) => {
                                                            if (!event.currentTarget.naturalWidth) setPreviewUrl(null)
                                                        }}
                                                        onError={() => setPreviewUrl(null)}
                                                    />
                                                    {!isApproved && (
                                                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                            <Button
                                                                variant="secondary" size="sm" type="button"
                                                                onClick={() => { setPreviewUrl(null); onChange(null) }}
                                                                className="text-xs font-bold"
                                                            >
                                                                Remove
                                                            </Button>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                            {!isApproved && !previewUrl && (
                                                <div className="relative flex items-center justify-center w-full h-32 px-4 transition bg-slate-50 border-2 border-slate-300 border-dashed rounded-2xl appearance-none cursor-pointer hover:border-blue-400 focus:outline-none">
                                                    <input
                                                        type="file"
                                                        accept="image/*"
                                                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                                        data-testid="artwork-image-input"
                                                        onChange={(e) => {
                                                            const file = e.target.files?.[0]
                                                            if (file) {
                                                                onChange(file)
                                                                setPreviewUrl(URL.createObjectURL(file))
                                                            }
                                                        }}
                                                        {...field}
                                                    />
                                                    <div className="flex flex-col items-center space-y-2">
                                                        <Palette className="w-8 h-8 text-slate-400" />
                                                        <span className="text-xs font-medium text-slate-600">Select Artwork Image</span>
                                                        <span className="text-[10px] text-slate-400">JPG, JPEG, or PNG supported</span>
                                                    </div>
                                                </div>
                                            )}
                                            {isApproved && !previewUrl && (
                                                <div className="flex h-32 w-full items-center justify-center rounded-2xl border bg-slate-50 text-slate-400">
                                                    <Palette className="h-8 w-8" />
                                                </div>
                                            )}
                                        </div>
                                    </FormControl>
                                    <FormDescription className="text-[10px]">Actual production asset required for approval.</FormDescription>
                                </FormItem>
                            )} />
                            <div className="grid grid-cols-2 gap-4">
                                <FormField control={form.control} name="print_type" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-[10px] font-bold uppercase text-slate-500">Print Type</FormLabel>
                                        <Select value={field.value} onValueChange={field.onChange}>
                                            <FormControl>
                                                <SelectTrigger className="bg-white" data-testid="artwork-print-type"><SelectValue /></SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                <SelectItem value="FLEXO">FLEXO</SelectItem>
                                                <SelectItem value="ROTO">ROTO</SelectItem>
                                                <SelectItem value="DIGITAL">DIGITAL</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </FormItem>
                                )} />
                                <FormField control={form.control} name="substrate_mode" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-[10px] font-bold uppercase text-slate-500">Film Type</FormLabel>
                                        <Select value={field.value} onValueChange={field.onChange}>
                                            <FormControl>
                                                <SelectTrigger className="bg-white" data-testid="artwork-film-type"><SelectValue /></SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                <SelectItem value="SHEET">SHEET</SelectItem>
                                                <SelectItem value="TUBING">TUBING</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <FormDescription className="text-[10px]">
                                            Sheet uses front colors only. Tubing enables front and back colors.
                                        </FormDescription>
                                    </FormItem>
                                )} />
                            </div>
                            <FormField control={form.control} name="front_colors" render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-[10px] font-bold uppercase text-slate-500">Front Colors</FormLabel>
                                    <div className="space-y-2">
                                        {(field.value || []).map((color: string, index: number) => (
                                            <div key={`front-${index}`} className="grid grid-cols-[1fr_34px] gap-2">
                                                <Select
                                                    value={String(color || "")}
                                                    onValueChange={(val) => {
                                                        const next = [...(field.value || [])]
                                                        next[index] = String(val || "").toUpperCase()
                                                        field.onChange(next)
                                                    }}
                                                >
                                                    <SelectTrigger className="bg-white">
                                                        <SelectValue placeholder="Select front color" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {!inkColorOptions.includes(String(color || "").toUpperCase()) && String(color || "").trim() ? (
                                                            <SelectItem value={String(color || "").toUpperCase()}>{String(color || "").toUpperCase()}</SelectItem>
                                                        ) : null}
                                                        {inkColorOptions.map((inkColor) => (
                                                            <SelectItem key={`front-option-${inkColor}`} value={inkColor}>{inkColor}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-9 w-9 text-red-500"
                                                    onClick={() => field.onChange((field.value || []).filter((_: string, idx: number) => idx !== index))}
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </Button>
                                            </div>
                                        ))}
                                        <Button
                                            type="button"
                                            variant="outline"
                                            className="h-8 text-[10px] font-bold uppercase"
                                            data-testid="artwork-add-front-color"
                                            onClick={() => {
                                                if (!inkColorOptions.length) return
                                                const existing = (field.value || []).map((v: string) => String(v).toUpperCase())
                                                const defaultColor = inkColorOptions.find((v) => !existing.includes(v)) || inkColorOptions[0]
                                                field.onChange([...(field.value || []), defaultColor])
                                            }}
                                        >
                                            <Plus className="h-3.5 w-3.5 mr-1" />
                                            Add Front Color
                                        </Button>
                                        {!inkColorOptions.length ? (
                                            <p className="text-[10px] text-amber-600">No ink colors found in master data.</p>
                                        ) : null}
                                    </div>
                                </FormItem>
                            )} />
                            {hasBackSide ? (
                            <FormField control={form.control} name="back_colors" render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-[10px] font-bold uppercase text-slate-500">Back Colors</FormLabel>
                                    <div className="space-y-2">
                                        {(field.value || []).map((color: string, index: number) => (
                                            <div key={`back-${index}`} className="grid grid-cols-[1fr_34px] gap-2">
                                                <Select
                                                    value={String(color || "")}
                                                    onValueChange={(val) => {
                                                        const next = [...(field.value || [])]
                                                        next[index] = String(val || "").toUpperCase()
                                                        field.onChange(next)
                                                    }}
                                                >
                                                    <SelectTrigger className="bg-white">
                                                        <SelectValue placeholder="Select back color" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {!inkColorOptions.includes(String(color || "").toUpperCase()) && String(color || "").trim() ? (
                                                            <SelectItem value={String(color || "").toUpperCase()}>{String(color || "").toUpperCase()}</SelectItem>
                                                        ) : null}
                                                        {inkColorOptions.map((inkColor) => (
                                                            <SelectItem key={`back-option-${inkColor}`} value={inkColor}>{inkColor}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-9 w-9 text-red-500"
                                                    onClick={() => field.onChange((field.value || []).filter((_: string, idx: number) => idx !== index))}
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </Button>
                                            </div>
                                        ))}
                                        <Button
                                            type="button"
                                            variant="outline"
                                            className="h-8 text-[10px] font-bold uppercase"
                                            data-testid="artwork-add-back-color"
                                            onClick={() => {
                                                if (!inkColorOptions.length) return
                                                const existing = (field.value || []).map((v: string) => String(v).toUpperCase())
                                                const defaultColor = inkColorOptions.find((v) => !existing.includes(v)) || inkColorOptions[0]
                                                field.onChange([...(field.value || []), defaultColor])
                                            }}
                                        >
                                            <Plus className="h-3.5 w-3.5 mr-1" />
                                            Add Back Color
                                        </Button>
                                        {!inkColorOptions.length ? (
                                            <p className="text-[10px] text-amber-600">No ink colors found in master data.</p>
                                        ) : null}
                                    </div>
                                    <FormDescription className="text-[10px]">
                                        Auto counts: Front {frontColors.length} / Back {backColors.length}.
                                    </FormDescription>
                                </FormItem>
                            )} />
                            ) : null}
                            <div className="rounded-md border bg-slate-50 p-3">
                                <p className="text-[10px] font-bold uppercase text-slate-600">Ink Family Mapping Note</p>
                                <p className="mt-1 text-[10px] text-slate-500">
                                    Do not map PET/POLY here. Sales confirmation selects PET/POLY from stack density and resolves inks by these colors.
                                </p>
                            </div>
                            {printType === "ROTO" ? (
                                <div className="space-y-3 rounded-md border border-slate-200 bg-white p-3" data-testid="artwork-roto-checklist">
                                    <div>
                                        <p className="text-[10px] font-bold uppercase text-slate-600">ROTO Readiness Checklist</p>
                                    <div className="mt-2 space-y-1.5">
                                        {rotoChecklist.map((item) => (
                                            <div key={item.id} className="text-[11px]">
                                                <span className={item.ok ? "font-semibold text-emerald-700" : "font-semibold text-amber-700"}>
                                                    {item.ok ? "PASS" : "BLOCK"}:
                                                </span>{" "}
                                                <span className="text-slate-700">{item.label}</span>
                                                {item.detail ? <span className="text-slate-500"> · {item.detail}</span> : null}
                                            </div>
                                        ))}
                                    </div>
                                    </div>
                                    <div className="rounded-lg border border-slate-100 bg-slate-50/80 p-3" data-testid="artwork-cylinder-color-actions">
                                        <div className="flex items-center justify-between gap-3">
                                            <div>
                                                <p className="text-[10px] font-bold uppercase text-slate-600">Cylinder generation by color</p>
                                                <p className="mt-1 text-[10px] text-slate-500">Generate only the colors that need a new cylinder. Reuse existing cylinders from the Cylinder Catalog.</p>
                                            </div>
                                            <Badge variant="outline">{rotoColorSlots.length} color slots</Badge>
                                        </div>
                                        <div className="mt-3 grid gap-2">
                                            {rotoColorSlots.length ? rotoColorSlots.map((slot) => {
                                                const key = `${slot.side}:${slot.slot}`
                                                const coverage = slotCoverage.get(key)
                                                const isBusy = generatingSlotKey === key && (mutation.isPending || generateCylindersMutation.isPending)
                                                return (
                                                    <div key={key} className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
                                                        <div className="min-w-0">
                                                            <div className="truncate text-xs font-black text-slate-900">{slot.side} {slot.slot} · {slot.color || "Color pending"}</div>
                                                            <div className="mt-0.5 text-[10px] text-slate-500">
                                                                {coverage ? `${coverage.state === "ready" ? "Ready" : "Draft"}: ${coverage.label}` : "No cylinder assigned yet"}
                                                            </div>
                                                        </div>
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            variant={coverage ? "outline" : "default"}
                                                            disabled={Boolean(coverage) || !canGenerateCylinders || mutation.isPending || generateCylindersMutation.isPending}
                                                            onClick={form.handleSubmit(() => generateCylinderForSlot({ side: slot.side, slot: slot.slot }))}
                                                        >
                                                            {isBusy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-2 h-3.5 w-3.5" />}
                                                            {coverage ? "Covered" : "Generate"}
                                                        </Button>
                                                    </div>
                                                )
                                            }) : (
                                                <div className="rounded-xl border border-dashed border-slate-200 bg-white px-3 py-4 text-center text-xs text-slate-400">
                                                    Add print colors before generating cylinders.
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ) : null}
                            {approvalBlockers.length > 0 ? (
                                <div className="rounded-md border border-amber-300 bg-amber-50 p-3" data-testid="artwork-approval-blockers">
                                    <p className="text-[10px] font-bold uppercase text-amber-700">Approval Blockers</p>
                                    <ul className="mt-1 list-disc pl-4 text-[10px] text-amber-800 space-y-0.5">
                                        {approvalBlockers.map((blocker) => (
                                            <li key={blocker}>{blocker}</li>
                                        ))}
                                    </ul>
                                </div>
                            ) : null}
                        </div>

                        <div className="flex gap-2 pt-2 border-t mt-4">
                            <Button
                                type="button" variant="ghost" className="flex-1 text-slate-500"
                                onClick={() => onOpenChange(false)}
                            >
                                Cancel
                            </Button>
                            {!isApproved ? (
                                <>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        className="flex-1 border-slate-300 text-slate-700"
                                        disabled={mutation.isPending}
                                        data-testid="artwork-save-draft"
                                        onClick={form.handleSubmit(async (v) => {
                                            try {
                                                await mutation.mutateAsync(v as ArtworkFormValues)
                                                toast({ title: "Draft saved" })
                                                onOpenChange(false)
                                            } catch {
                                                // handled in mutation onError
                                            }
                                        })}
                                    >
                                        {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                        Save Draft
                                    </Button>
                                    {(artwork || activeArtworkId) && (
                                        <Button
                                            type="button"
                                            className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                                            disabled={!canApprove || approveMutation.isPending || mutation.isPending}
                                            data-testid="artwork-approve"
                                            onClick={form.handleSubmit(async (v) => {
                                                // Save first, then approve in onSuccess chain
                                                try {
                                                    const saved = await mutation.mutateAsync(v as ArtworkFormValues)
                                                    const targetId = String(saved?.id || activeArtworkId || "")
                                                    if (!targetId) {
                                                        toast({
                                                            title: "Draft required",
                                                            description: "Please save artwork details first.",
                                                            variant: "destructive",
                                                        })
                                                        return
                                                    }
                                                    await approveMutation.mutateAsync(targetId)
                                                } catch {
                                                    // handled in mutation onError
                                                }
                                            })}
                                        >
                                            {(approveMutation.isPending || mutation.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                            <ShieldCheck className="h-4 w-4 mr-2" />
                                            Approve
                                        </Button>
                                    )}
                                </>
                            ) : (
                                <div className="flex-1 text-center py-2 text-xs font-bold text-emerald-600 bg-emerald-50 rounded-md">
                                    Asset is Approved & Locked
                                </div>
                            )}
                        </div>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    )
}
