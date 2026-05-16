"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { FileText, Loader2, Palette, ShieldCheck, RefreshCw, Plus, Trash2 } from "lucide-react"

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
import { artworkImageUrls, engineeringService, isPdfMediaUrl, Artwork } from "@/services/engineering"
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
    color_mapping: z.record(z.string(), z.any()).optional(),
    ink_gsm_total: z.number().min(0),
    ink_gsm_split_mode: z.enum(["EQUAL", "PERCENT"]),
    ink_gsm_color_percentages: z.record(z.string(), z.number().min(0)).optional(),
    cylinder_circumference_mm: z.number().min(0),
    cylinder_length_mm: z.number().min(0),
    file_path: z.string().optional(),
    image: z.any().optional(), // Used for local file selection
})

type ArtworkFormValues = z.infer<typeof artworkSchema>

function sameStringArray(left: string[] = [], right: string[] = []) {
    if (left.length !== right.length) return false
    return left.every((value, index) => String(value || "") === String(right[index] || ""))
}

function ArtworkAssetPreview({ url, file, compact = false }: { url: string; file?: File; compact?: boolean }) {
    const isPdf = isPdfMediaUrl(url, file?.type)
    if (isPdf) {
        if (compact) {
            return (
                <div className="flex h-full w-full items-center justify-center bg-rose-50 text-rose-500">
                    <FileText className="h-6 w-6" />
                </div>
            )
        }
        return (
            <iframe
                src={url}
                title={file?.name || "Artwork PDF preview"}
                className="h-[300px] w-full rounded-xl bg-white"
            />
        )
    }
    return (
        <img
            src={url}
            alt={file?.name || "Artwork preview"}
            className={compact ? "h-full w-full object-cover" : "h-auto max-h-[300px] w-auto max-w-full object-contain drop-shadow-sm"}
        />
    )
}

interface ArtworkDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    artwork?: Artwork | null
}

export function ArtworkDialog({ open, onOpenChange, artwork }: ArtworkDialogProps) {
    const { toast } = useToast()
    const queryClient = useQueryClient()
    const [previewUrls, setPreviewUrls] = useState<string[]>([])
    const [selectedImages, setSelectedImages] = useState<File[]>([])
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
            color_mapping: {},
            ink_gsm_total: 0,
            ink_gsm_split_mode: "EQUAL",
            ink_gsm_color_percentages: {},
            cylinder_circumference_mm: 0,
            cylinder_length_mm: 0,
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
                color_mapping: artwork.color_mapping || {},
                ink_gsm_total: Number(artwork.ink_gsm_total || 0),
                ink_gsm_split_mode: (artwork.ink_gsm_split_mode || "EQUAL") as "EQUAL" | "PERCENT",
                ink_gsm_color_percentages: artwork.ink_gsm_color_percentages || {},
                cylinder_circumference_mm: Number(artwork.cylinder_circumference_mm || 0),
                cylinder_length_mm: Number(artwork.cylinder_length_mm || 0),
                file_path: artwork.file_path || "",
            })
            setPreviewUrls(artworkImageUrls(artwork))
            setSelectedImages([])
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
                color_mapping: {},
                ink_gsm_total: 0,
                ink_gsm_split_mode: "EQUAL",
                ink_gsm_color_percentages: {},
                cylinder_circumference_mm: 0,
                cylinder_length_mm: 0,
                file_path: "",
            })
            setPreviewUrls([])
            setSelectedImages([])
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
            formData.append("color_mapping", JSON.stringify(values.color_mapping || {}))
            formData.append("ink_gsm_total", String(values.ink_gsm_total || 0))
            formData.append("ink_gsm_split_mode", values.ink_gsm_split_mode || "EQUAL")
            formData.append("ink_gsm_color_percentages", JSON.stringify(values.ink_gsm_color_percentages || {}))
            formData.append("cylinder_circumference_mm", String(values.cylinder_circumference_mm || 0))
            formData.append("cylinder_length_mm", String(values.cylinder_length_mm || 0))
            if (artwork?.id && artwork.status !== "APPROVED") {
                formData.append("update_in_place", "true")
            }

            const imageFiles = Array.isArray(values.image)
                ? values.image.filter((file): file is File => file instanceof File)
                : values.image instanceof File
                    ? [values.image]
                    : selectedImages
            for (const file of imageFiles.slice(0, 3)) {
                formData.append("images", file)
            }

            if (artwork?.id) return engineeringService.updateArtwork(artwork.id, formData)
            return engineeringService.createArtwork(formData)
        },
        onSuccess: async (saved: any) => {
            const savedId = String(saved?.id || "")
            if (savedId) {
                setActiveArtworkId(savedId)
            }
            setPreviewUrls(artworkImageUrls(saved))
            setSelectedImages([])
            await queryClient.invalidateQueries({ queryKey: ["artworks"] })
            await queryClient.refetchQueries({ queryKey: ["artworks"], type: "active" })
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
            engineeringService.generateArtworkCylinders(artworkId, {
                side,
                slot,
                circumference: Number(form.getValues("cylinder_circumference_mm") || 0),
                length_mm: Number(form.getValues("cylinder_length_mm") || 0),
            }),
        onSuccess: async (res: any, variables) => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ["artworks"] }),
                queryClient.invalidateQueries({ queryKey: ["cylinders"] }),
                queryClient.invalidateQueries({ queryKey: ["artwork-cylinders"] }),
                queryClient.invalidateQueries({ queryKey: ["cylinder-slot-assignments"] }),
            ])
            await Promise.all([
                queryClient.refetchQueries({ queryKey: ["artworks"], type: "active" }),
                queryClient.refetchQueries({ queryKey: ["cylinders"], type: "active" }),
                queryClient.refetchQueries({ queryKey: ["artwork-cylinders", variables.artworkId], type: "active" }),
                queryClient.refetchQueries({ queryKey: ["cylinder-slot-assignments", variables.artworkId], type: "active" }),
            ])
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
    const sourceIsApproved = artwork?.status === "APPROVED"
    const printType = String(form.watch("print_type") || "FLEXO").toUpperCase()
    const substrateMode = String(form.watch("substrate_mode") || "SHEET").toUpperCase()
    const hasBackSide = substrateMode === "TUBING"
    const frontColors = form.watch("front_colors") || []
    const backColors = hasBackSide ? (form.watch("back_colors") || []) : []
    const frontColorCount = Number(form.watch("front_colors_count") || 0)
    const backColorCount = Number(form.watch("back_colors_count") || 0)
    const cylinderCircumference = Number(form.watch("cylinder_circumference_mm") || 0)
    const cylinderLength = Number(form.watch("cylinder_length_mm") || 0)
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
    const colorMapping = (form.watch("color_mapping") || {}) as Record<string, string>
    const uniqueInkColors = useMemo(() => Array.from(new Set(colorList)), [colorList.join("|")])
    const inkGsmTotal = Number(form.watch("ink_gsm_total") || 0)
    const inkSplitMode = String(form.watch("ink_gsm_split_mode") || "EQUAL").toUpperCase()
    const inkPercentages = (form.watch("ink_gsm_color_percentages") || {}) as Record<string, number>
    const equalInkGsm = uniqueInkColors.length ? inkGsmTotal / uniqueInkColors.length : 0
    const percentageTotal = uniqueInkColors.reduce((sum, color) => sum + Number(inkPercentages[color] || 0), 0)
    const percentSplitOk = inkSplitMode !== "PERCENT" || (
        uniqueInkColors.length > 0 &&
        uniqueInkColors.every((color) => Number.isFinite(Number(inkPercentages[color]))) &&
        Math.abs(percentageTotal - 100) <= 0.01
    )
    const inkContractOk = inkGsmTotal > 0 && uniqueInkColors.length > 0 && percentSplitOk
    const inkRows = useMemo(
        () =>
            (inks || [])
                .filter((ink: any) => String(ink?.id || "").trim())
                .map((ink: any) => ({
                    id: String(ink.id),
                    code: String(ink.code || ""),
                    name: String(ink.name || ""),
                    base: String(ink.base_type || "").toUpperCase(),
                    color: String(ink.color_name || "").toUpperCase(),
                })),
        [inks]
    )
    const hasPrintColors = colorList.length > 0
    const colorContractOk = hasPrintColors && frontColorCount === frontColors.length && (!hasBackSide || backColorCount === backColors.length)
    const filePathAsset = String(form.watch("file_path") || "").trim()
    const hasImage = previewUrls.length > 0
    const hasProductionAsset = hasImage || !!filePathAsset

    const finalizedCylinders = useMemo(
        () => (artworkCylinders || []).filter((row: any) => !Boolean(row?.is_draft)),
        [artworkCylinders]
    )
    const generatedDraftCylinders = useMemo(
        () =>
            (artworkCylinders || []).filter(
                (row: any) => Boolean(row?.is_draft) && String(row?.artwork || "") === String(activeArtworkId || "")
            ),
        [artworkCylinders, activeArtworkId]
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
                    Number(row?.circumference || 0) <= 0 ||
                    Number(row?.width_mm || 0) <= 0 ||
                    !String(row?.engraving_vendor || "").trim() ||
                    !String(row?.storage_location || "").trim()
                )
            })
            .map((row: any) => `${String(row?.side || "FRONT").toUpperCase()}-${Number(row?.side_slot_index || 0)}`)
            .concat(
                finalizedAssignments
                    .filter((row: any) => {
                        return (
                            Number(row?.cylinder_circumference || 0) <= 0 ||
                            Number(row?.cylinder_width_mm || 0) <= 0 ||
                            !String(row?.cylinder_engraving_vendor || "").trim() ||
                            !String(row?.cylinder_storage_location || "").trim()
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
                id: "ink-gsm",
                label: "Ink GSM contract captured",
                ok: inkContractOk,
                detail: inkSplitMode === "PERCENT" ? `${percentageTotal.toFixed(2)}% assigned` : "",
            },
            {
                id: "repeat",
                label: "Cylinder repeat captured",
                ok: printType !== "ROTO" || cylinderCircumference > 0,
                detail: cylinderCircumference > 0 ? `${cylinderCircumference} mm` : "",
            },
            {
                id: "length",
                label: "Cylinder length captured",
                ok: printType !== "ROTO" || cylinderLength > 0,
                detail: cylinderLength > 0 ? `${cylinderLength} mm` : "",
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
            inkContractOk,
            inkSplitMode,
            percentageTotal,
            cylinderCircumference,
            cylinderLength,
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
        if (inkGsmTotal <= 0) blockers.push("Enter total ink GSM.")
        if (inkSplitMode === "PERCENT" && !percentSplitOk) blockers.push("Ink color percentages must total 100.")
        if (frontColorCount !== frontColors.length) blockers.push("Front color list/count mismatch.")
        if (hasBackSide && backColorCount !== backColors.length) blockers.push("Back color list/count mismatch.")
        if (!activeArtworkId) blockers.push("Save draft before approval.")
        if (printType === "ROTO") {
            if (cylinderCircumference <= 0) blockers.push("Enter artwork cylinder circumference.")
            if (cylinderLength <= 0) blockers.push("Enter artwork cylinder length.")
            if (missingFrontSlots.length) blockers.push(`Missing finalized front slots: ${missingFrontSlots.join(", ")}.`)
            if (hasBackSide && missingBackSlots.length) blockers.push(`Missing finalized back slots: ${missingBackSlots.join(", ")}.`)
            if (incompleteFinalizedSlots.length) blockers.push(`Finalize technical data for: ${incompleteFinalizedSlots.join(", ")}.`)
        }
        return blockers
    }, [
        hasProductionAsset,
        hasPrintColors,
        inkGsmTotal,
        inkSplitMode,
        percentSplitOk,
        frontColorCount,
        frontColors.length,
        backColorCount,
        backColors.length,
        hasBackSide,
        activeArtworkId,
        printType,
        cylinderCircumference,
        cylinderLength,
        missingFrontSlots,
        missingBackSlots,
        incompleteFinalizedSlots,
    ])
    const canApprove = approvalBlockers.length === 0
    const canGenerateCylinders = printType === "ROTO" && colorContractOk && cylinderCircumference > 0 && cylinderLength > 0
    const setColorMapping = useCallback(
        (color: string, inkId: string) => {
            const key = String(color || "").trim().toUpperCase()
            if (!key) return
            const next = { ...(form.getValues("color_mapping") || {}) } as Record<string, string>
            if (!inkId || inkId === "__AUTO__") delete next[key]
            else next[key] = inkId
            form.setValue("color_mapping", next, { shouldDirty: true, shouldValidate: true })
        },
        [form]
    )
    const setInkPercentage = useCallback(
        (color: string, value: string) => {
            const key = String(color || "").trim().toUpperCase()
            if (!key) return
            const next = { ...(form.getValues("ink_gsm_color_percentages") || {}) } as Record<string, number>
            next[key] = Math.max(0, Number(value || 0))
            form.setValue("ink_gsm_color_percentages", next, { shouldDirty: true, shouldValidate: true })
        },
        [form]
    )
    const slotCoverage = useMemo(() => {
        const map = new Map<string, { state: "draft" | "ready"; label: string; repeat?: number; length?: number }>()
        for (const row of artworkCylinders || []) {
            const side = String((row as any)?.side || "FRONT").toUpperCase()
            const slot = Number((row as any)?.side_slot_index || 0)
            if (!slot) continue
            map.set(`${side}:${slot}`, {
                state: Boolean((row as any)?.is_draft) ? "draft" : "ready",
                label: String((row as any)?.code || (row as any)?.name || "Cylinder"),
                repeat: Number((row as any)?.circumference || 0),
                length: Number((row as any)?.width_mm || 0),
            })
        }
        for (const row of cylinderAssignments || []) {
            const side = String((row as any)?.side || "FRONT").toUpperCase()
            const slot = Number((row as any)?.side_slot_index || 0)
            if (!slot) continue
            map.set(`${side}:${slot}`, {
                state: Boolean((row as any)?.cylinder_is_draft) ? "draft" : "ready",
                label: String((row as any)?.cylinder_code || (row as any)?.cylinder_name || "Assigned cylinder"),
                repeat: Number((row as any)?.cylinder_circumference || 0),
                length: Number((row as any)?.cylinder_width_mm || 0),
            })
        }
        return map
    }, [artworkCylinders, cylinderAssignments])
    const draftSlotCoverageCount = useMemo(
        () => Array.from(slotCoverage.values()).filter((row) => row.state === "draft").length,
        [slotCoverage]
    )
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
            await Promise.all([
                queryClient.refetchQueries({ queryKey: ["artwork-cylinders", targetId], type: "active" }),
                queryClient.refetchQueries({ queryKey: ["cylinder-slot-assignments", targetId], type: "active" }),
            ])
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
        if (Number(form.getValues("front_colors_count") || 0) !== frontColors.length) {
            form.setValue("front_colors_count", frontColors.length, { shouldValidate: true })
        }
        if (Number(form.getValues("back_colors_count") || 0) !== backColors.length) {
            form.setValue("back_colors_count", backColors.length, { shouldValidate: true })
        }
        if (Number(form.getValues("colors_count") || 0) !== colorList.length) {
            form.setValue("colors_count", colorList.length, { shouldValidate: true })
        }
        if (!sameStringArray(form.getValues("color_list") || [], colorList)) {
            form.setValue("color_list", colorList, { shouldValidate: false })
        }
        const existingMapping = (form.getValues("color_mapping") || {}) as Record<string, string>
        const allowed = new Set(colorList)
        const pruned = Object.fromEntries(Object.entries(existingMapping).filter(([color]) => allowed.has(String(color).toUpperCase())))
        if (Object.keys(pruned).length !== Object.keys(existingMapping).length) {
            form.setValue("color_mapping", pruned, { shouldValidate: false })
        }
        const existingPercentages = (form.getValues("ink_gsm_color_percentages") || {}) as Record<string, number>
        const prunedPercentages = Object.fromEntries(
            Object.entries(existingPercentages).filter(([color]) => allowed.has(String(color).toUpperCase()))
        ) as Record<string, number>
        const splitMode = String(form.getValues("ink_gsm_split_mode") || "EQUAL").toUpperCase()
        const uniqueColors = Array.from(allowed)
        const needsBalancedPercentages =
            splitMode === "PERCENT" &&
            uniqueColors.length > 0 &&
            uniqueColors.some((color) => !Number.isFinite(Number(prunedPercentages[color])))
        if (needsBalancedPercentages) {
            const equalPct = Number((100 / uniqueColors.length).toFixed(4))
            form.setValue(
                "ink_gsm_color_percentages",
                Object.fromEntries(uniqueColors.map((color) => [color, equalPct])),
                { shouldValidate: true }
            )
        } else if (Object.keys(prunedPercentages).length !== Object.keys(existingPercentages).length) {
            form.setValue("ink_gsm_color_percentages", prunedPercentages, { shouldValidate: false })
        }
    }, [frontColors.length, backColors.length, colorList.join("|"), form, hasBackSide, inkSplitMode])

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl bg-[#fafafa]" data-testid="artwork-dialog">
                <DialogHeader className="border-b pb-2">
                    <div className="flex items-center justify-between pr-4">
                        <div>
                            <DialogTitle className="text-xl font-black uppercase text-slate-800">
                                {artwork ? `New Version: ${artwork.design_code}` : "New Artwork"}
                            </DialogTitle>
                            <DialogDescription className="text-xs font-medium text-slate-500">
                                {artwork ? `Existing usage stays on v${artwork.version || 1}; saving creates the next artwork version.` : "Manage visual definition, side colors, and print method."}
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
                            {sourceIsApproved && <Badge className="bg-emerald-500 text-white font-bold">SOURCE APPROVED</Badge>}
                            {artwork && <Badge variant="outline" className="text-amber-600 bg-amber-50">V{Number(artwork.version || 1) + 1} DRAFT</Badge>}
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
                                    <FormLabel className="text-[10px] font-bold uppercase text-slate-500">Artwork Images (max 3)</FormLabel>
                                    <FormControl>
                                        <div className="space-y-4">
                                            {previewUrls.length > 0 && (
                                                <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
                                                    <div className="relative flex min-h-[220px] max-h-[320px] items-center justify-center overflow-hidden rounded-2xl border bg-slate-50/50 p-2 shadow-inner">
                                                        <ArtworkAssetPreview url={previewUrls[0]} file={selectedImages[0]} />
                                                    </div>
                                                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-1">
                                                        {previewUrls.map((url, index) => (
                                                            <div key={`${url}-${index}`} className="relative h-20 overflow-hidden rounded-xl border bg-white">
                                                                <ArtworkAssetPreview url={url} file={selectedImages[index]} compact />
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                            <div className="relative flex h-32 w-full cursor-pointer items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 transition hover:border-blue-400 focus:outline-none">
                                                <input
                                                    type="file"
                                                    accept="image/*,application/pdf"
                                                    multiple
                                                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                                                    data-testid="artwork-image-input"
                                                    onChange={(e) => {
                                                        const files = Array.from(e.target.files || []).slice(0, 3)
                                                        if (files.length) {
                                                            setSelectedImages(files)
                                                            onChange(files)
                                                            setPreviewUrls(files.map((file) => URL.createObjectURL(file)))
                                                            if ((e.target.files?.length || 0) > 3) {
                                                                toast({ title: "Only 3 images kept", description: "Artwork supports a maximum of 3 images." })
                                                            }
                                                        }
                                                    }}
                                                    name={field.name}
                                                    onBlur={field.onBlur}
                                                    ref={field.ref}
                                                />
                                                <div className="flex flex-col items-center space-y-2">
                                                    <Palette className="w-8 h-8 text-slate-400" />
                                                    <span className="text-xs font-medium text-slate-600">{previewUrls.length ? "Replace artwork assets" : "Select artwork image/PDF"}</span>
                                                    <span className="text-[10px] text-slate-400">JPG, PNG, or PDF supported. Maximum 3.</span>
                                                </div>
                                            </div>
                                            {previewUrls.length > 0 && (
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    type="button"
                                                    onClick={() => { setPreviewUrls([]); setSelectedImages([]); onChange(null) }}
                                                    className="text-xs font-bold"
                                                >
                                                    Remove selected previews
                                                </Button>
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
                            <div className="rounded-xl border border-rose-100 bg-rose-50/60 p-3">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-rose-700">Ink GSM</p>
                                        <p className="mt-1 text-[10px] text-rose-700/80">Artwork-level ink laydown for live BOM and production approval.</p>
                                    </div>
                                    <Badge variant="outline" className="bg-white">
                                        {inkGsmTotal > 0 ? `${inkGsmTotal.toFixed(4).replace(/\.?0+$/, "")} gsm` : "Missing"}
                                    </Badge>
                                </div>
                                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                    <FormField control={form.control} name="ink_gsm_total" render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-[10px] font-bold uppercase text-slate-500">Total ink GSM</FormLabel>
                                            <FormControl>
                                                <Input
                                                    type="number"
                                                    min={0}
                                                    step="0.0001"
                                                    data-testid="artwork-ink-gsm-total"
                                                    value={String(field.value ?? 0)}
                                                    onChange={(event) => field.onChange(Number(event.target.value || 0))}
                                                    className="bg-white"
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )} />
                                    <FormField control={form.control} name="ink_gsm_split_mode" render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-[10px] font-bold uppercase text-slate-500">Split mode</FormLabel>
                                            <Select value={field.value} onValueChange={field.onChange}>
                                                <FormControl>
                                                    <SelectTrigger className="bg-white" data-testid="artwork-ink-gsm-split-mode"><SelectValue /></SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    <SelectItem value="EQUAL">Equal by color</SelectItem>
                                                    <SelectItem value="PERCENT">Percent by color</SelectItem>
                                                </SelectContent>
                                            </Select>
                                            <FormMessage />
                                        </FormItem>
                                    )} />
                                </div>
                                <div className="mt-3 grid gap-2">
                                    {uniqueInkColors.length ? uniqueInkColors.map((color) => {
                                        const pct = Number(inkPercentages[color] || 0)
                                        const gsm = inkSplitMode === "PERCENT" ? (inkGsmTotal * pct / 100) : equalInkGsm
                                        return (
                                            <div key={`ink-gsm-${color}`} className="grid gap-2 rounded-lg border border-rose-100 bg-white p-2 sm:grid-cols-[minmax(0,1fr)_120px_90px] sm:items-center">
                                                <div className="min-w-0">
                                                    <div className="text-xs font-black text-slate-900">{color}</div>
                                                    <div className="text-[10px] font-semibold text-slate-500">{gsm.toFixed(4).replace(/\.?0+$/, "") || "0"} gsm</div>
                                                </div>
                                                {inkSplitMode === "PERCENT" ? (
                                                    <Input
                                                        type="number"
                                                        min={0}
                                                        max={100}
                                                        step="0.01"
                                                        value={String(inkPercentages[color] ?? 0)}
                                                        data-testid={`artwork-ink-percent-${color.replace(/[^A-Z0-9_-]/g, "-")}`}
                                                        onChange={(event) => setInkPercentage(color, event.target.value)}
                                                        className="h-9 bg-white text-xs"
                                                    />
                                                ) : (
                                                    <div className="rounded-lg bg-rose-50 px-3 py-2 text-center text-xs font-black text-rose-700">Equal</div>
                                                )}
                                                <div className={percentageTotal > 100.01 || (inkSplitMode === "PERCENT" && Math.abs(percentageTotal - 100) > 0.01) ? "text-right text-xs font-black text-amber-700" : "text-right text-xs font-black text-slate-700"}>
                                                    {inkSplitMode === "PERCENT" ? `${pct.toFixed(2).replace(/\.?0+$/, "")}%` : `${(uniqueInkColors.length ? 100 / uniqueInkColors.length : 0).toFixed(2).replace(/\.?0+$/, "")}%`}
                                                </div>
                                            </div>
                                        )
                                    }) : (
                                        <div className="rounded-lg border border-dashed border-rose-200 bg-white px-3 py-4 text-center text-xs font-semibold text-slate-500">
                                            Add print colors to split ink GSM.
                                        </div>
                                    )}
                                </div>
                                {inkSplitMode === "PERCENT" ? (
                                    <div className={percentSplitOk ? "mt-2 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-700" : "mt-2 text-[10px] font-bold uppercase tracking-[0.14em] text-amber-700"}>
                                        Percent total {percentageTotal.toFixed(2).replace(/\.?0+$/, "")}%
                                    </div>
                                ) : null}
                            </div>
                            <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-blue-700">Inventory ink mapping</p>
                                        <p className="mt-1 text-[10px] text-blue-700/80">
                                            Auto mode resolves PET/POLY from the product layer stack and color name. Pick a specific ink only when the color uses a controlled inventory ink code.
                                        </p>
                                    </div>
                                    <Badge variant="outline" className="bg-white">{Object.keys(colorMapping).length} mapped</Badge>
                                </div>
                                <div className="mt-3 grid gap-2">
                                    {colorList.length ? colorList.map((color, index) => {
                                        const exactInks = inkRows.filter((ink) => ink.color === color)
                                        const visibleInks = exactInks.length ? exactInks : inkRows
                                        return (
                                            <div key={`${color}-${index}`} className="grid gap-2 rounded-lg border border-blue-100 bg-white p-2 sm:grid-cols-[minmax(0,1fr)_minmax(220px,1.5fr)] sm:items-center">
                                                <div className="min-w-0">
                                                    <div className="text-xs font-black text-slate-900">{color}</div>
                                                    <div className="text-[10px] font-semibold text-slate-500">
                                                        {exactInks.length ? `${exactInks.length} matching inventory ink${exactInks.length === 1 ? "" : "s"}` : "No exact color-name match; choose manually or add ink master."}
                                                    </div>
                                                </div>
                                                <Select
                                                    value={String(colorMapping[color] || "__AUTO__")}
                                                    onValueChange={(value) => setColorMapping(color, value)}
                                                >
                                                    <SelectTrigger className="h-9 rounded-xl bg-white text-xs">
                                                        <SelectValue placeholder="Auto by color + film base" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="__AUTO__">Auto by color + film base</SelectItem>
                                                        {visibleInks.map((ink) => (
                                                            <SelectItem key={ink.id} value={ink.id}>
                                                                {ink.base} · {ink.color || ink.name} · {ink.code}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        )
                                    }) : (
                                        <div className="rounded-lg border border-dashed border-blue-200 bg-white px-3 py-4 text-center text-xs font-semibold text-slate-500">
                                            Add front/back colors to map inventory inks.
                                        </div>
                                    )}
                                </div>
                            </div>
                            {printType === "ROTO" ? (
                                <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" data-testid="artwork-roto-checklist">
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-600">Cylinder specs</p>
                                            <p className="mt-1 text-[10px] text-slate-500">One repeat and one length for this artwork. Reuse only matches both specs.</p>
                                        </div>
                                        <Badge variant="outline" className="bg-slate-50">
                                            {cylinderCircumference > 0 && cylinderLength > 0 ? `${cylinderCircumference} × ${cylinderLength} mm` : "Required"}
                                        </Badge>
                                    </div>
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <FormField control={form.control} name="cylinder_circumference_mm" render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-[10px] font-bold uppercase text-slate-500">Circumference / repeat (mm)</FormLabel>
                                                <FormControl>
                                                    <Input
                                                        type="number"
                                                        min={0}
                                                        step="0.01"
                                                        data-testid="artwork-cylinder-circumference"
                                                        value={String(field.value ?? 0)}
                                                        onChange={(event) => field.onChange(Number(event.target.value || 0))}
                                                        className="bg-white"
                                                    />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )} />
                                        <FormField control={form.control} name="cylinder_length_mm" render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-[10px] font-bold uppercase text-slate-500">Cylinder length (mm)</FormLabel>
                                                <FormControl>
                                                    <Input
                                                        type="number"
                                                        min={0}
                                                        step="0.01"
                                                        data-testid="artwork-cylinder-length"
                                                        value={String(field.value ?? 0)}
                                                        onChange={(event) => field.onChange(Number(event.target.value || 0))}
                                                        className="bg-white"
                                                    />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )} />
                                    </div>
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
                                                <p className="mt-1 text-[10px] text-slate-500">Each button covers only that color slot. A covered slot cannot generate another cylinder.</p>
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
                                                                {coverage
                                                                    ? `${coverage.state === "ready" ? "Ready" : "Draft"}: ${coverage.label} · ${coverage.repeat || cylinderCircumference}×${coverage.length || cylinderLength} mm`
                                                                    : "No cylinder assigned yet"}
                                                            </div>
                                                        </div>
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            variant={coverage ? "outline" : "default"}
                                                            data-testid={!coverage && canGenerateCylinders ? `artwork-generate-cylinder-${slot.side}-${slot.slot}` : undefined}
                                                            disabled={Boolean(coverage) || !canGenerateCylinders || mutation.isPending || generateCylindersMutation.isPending}
                                                            onClick={form.handleSubmit(() => generateCylinderForSlot({ side: slot.side, slot: slot.slot }))}
                                                        >
                                                            {isBusy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-2 h-3.5 w-3.5" />}
                                                            {coverage ? "Covered" : `Generate ${slot.side} ${slot.slot}`}
                                                        </Button>
                                                    </div>
                                                )
                                            }) : (
                                                <div className="rounded-xl border border-dashed border-slate-200 bg-white px-3 py-4 text-center text-xs text-slate-400">
                                                    Add print colors before generating cylinders.
                                                </div>
                                            )}
                                        </div>
                                        {Math.max(generatedDraftCylinders.length, draftSlotCoverageCount) > 0 ? (
                                            <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50/70 p-3" data-testid="artwork-cylinder-catalog-handoff">
                                                <div className="flex flex-wrap items-center justify-between gap-2">
                                                    <div>
                                                        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-blue-700">Finish generated drafts in Cylinder Catalog</p>
                                                        <p className="mt-1 text-[10px] text-blue-700/80">
                                                            {Math.max(generatedDraftCylinders.length, draftSlotCoverageCount)} generated draft slot{Math.max(generatedDraftCylinders.length, draftSlotCoverageCount) === 1 ? "" : "s"} now need vendor, location, and final status in the cylinder map.
                                                        </p>
                                                    </div>
                                                    <Badge variant="outline" className="bg-white">{cylinderCircumference || 0} × {cylinderLength || 0} mm</Badge>
                                                </div>
                                            </div>
                                        ) : null}
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
                            <Button
                                type="button"
                                variant="outline"
                                className="flex-1 border-slate-300 text-slate-700"
                                disabled={mutation.isPending}
                                data-testid="artwork-save-draft"
                                onClick={form.handleSubmit(async (v) => {
                                    try {
                                        await mutation.mutateAsync(v as ArtworkFormValues)
                                        toast({ title: artwork ? "Version draft saved" : "Draft saved" })
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
                        </div>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    )
}
