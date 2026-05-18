"use client"

import { useState, useMemo, useEffect, useRef, type MouseEvent } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useParams } from "next/navigation"
import { wcmService, WorkCenterAssignment } from "@/services/wcm"
import {
    Card, CardHeader, CardTitle, CardContent
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { SemanticBadge } from "@/components/ui-custom/semantic-badge"
import {
    Table, TableHeader, TableRow, TableHead, TableBody, TableCell
} from "@/components/ui/table"
import {
    Loader2, CheckCircle2, AlertCircle,
    ArrowUpRight, Activity, ArrowDownRight, Trash2, Search, History, Scissors
} from "lucide-react"
import { WcmRollPickerDialog } from "@/components/wcm/roll-picker-dialog"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/components/auth-provider"
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import { inventoryService } from "@/services/inventory"
import { normalizeProductSpec } from "@/lib/product-spec"

type StepPolicyDraft = {
    issue_policy_mode: "NONE" | "PERCENT_OVER_THEORY" | "FIXED_EXTRA_KG" | "MINIMUM_ISSUE_KG"
    issue_policy_value: number
    reason: string
}

type WcmMaterialIssueDraft = {
    material_id?: string
    actual_issued_qty: string
    actual_returned_qty: string
    actual_scrap_qty: string
    is_estimated: boolean
    granule_code_allocations?: Array<{ granule_code_id: string; qty_kg: string }>
}

function policyModeLabel(mode?: string | null, value?: number | null) {
    const normalized = String(mode || "NONE").toUpperCase()
    const safeValue = Number(value || 0)
    if (normalized === "PERCENT_OVER_THEORY") return `${safeValue}% over theory`
    if (normalized === "FIXED_EXTRA_KG") return `+${safeValue} kg`
    if (normalized === "MINIMUM_ISSUE_KG") return `Minimum ${safeValue} kg`
    return "Template default"
}

function outputCaptureModeLabel(mode?: string | null) {
    const normalized = String(mode || "PROCESS_DEFAULT").toUpperCase()
    if (normalized === "KG_ONLY") return "Bulk KG only"
    if (normalized === "KG_AND_PCS") return "Bulk KG + PCS"
    if (normalized === "DISCRETE_ONLY") return "Discrete required"
    return "Template default"
}

function toNullableNumber(value: unknown): number | null {
    const num = Number(value)
    return Number.isFinite(num) ? num : null
}

function formatSmartValue(value: number | null, uom: "KG" | "PCS", digits?: number) {
    if (value === null) return "—"
    const precision = digits ?? (uom === "PCS" ? 0 : 3)
    return value.toLocaleString(undefined, {
        minimumFractionDigits: precision,
        maximumFractionDigits: precision,
    })
}

function formatDateLabel(value?: string | null) {
    if (!value) return "—"
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) return String(value)
    return parsed.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })
}

function firstNonEmpty(...values: unknown[]) {
    for (const value of values) {
        const text = String(value ?? "").trim()
        if (text && text !== "—" && text.toLowerCase() !== "null" && text.toLowerCase() !== "undefined") return text
    }
    return ""
}

function assignmentHasMachineStart(assignment: any) {
    const job = assignment?.job_details || {}
    const assignmentStatus = String(assignment?.status || "").toUpperCase()
    const state = String(job?.job_state || "").toUpperCase()
    const status = String(job?.status || "").toUpperCase()
    return assignmentStatus === "EXECUTION_READY" && Boolean(assignment?.assigned_machine) && (state === "EXECUTING" || state === "PAUSED" || status === "RUNNING")
}

function assignmentIsMachineReady(assignment: any) {
    const assignmentStatus = String(assignment?.status || "").toUpperCase()
    const hasMachine = Boolean(assignment?.assigned_machine)
    if (assignmentHasMachineStart(assignment)) return true
    return assignmentStatus === "EXECUTION_READY" && hasMachine
}

function productNameFromJob(job: any, context?: any) {
    return normalizeProductSpec(job, context).productName
}

function geometryFromJob(job: any, context?: any) {
    const spec = normalizeProductSpec(job, context)
    return {
        width: spec.size.widthMm != null ? String(spec.size.widthMm) : "",
        height: spec.size.heightMm != null ? String(spec.size.heightMm) : "",
        gusset: spec.size.gussetMm != null ? String(spec.size.gussetMm) : "",
        area: "",
        label: spec.size.label,
    }
}

function podLabelFromJob(job: any, context?: any) {
    const spec = normalizeProductSpec(job, context)
    return spec.podLabels.length ? spec.podLabels.join(", ") : "No POD"
}

function addonsLabelFromJob(job: any, context?: any) {
    const spec = normalizeProductSpec(job, context)
    return spec.addonLabels.length ? spec.addonLabels.slice(0, 4).join(", ") + (spec.addonLabels.length > 4 ? ` +${spec.addonLabels.length - 4}` : "") : "No add-ons"
}

function layerHighlightsFromJob(job: any, context?: any) {
    return normalizeProductSpec(job, context).layers.slice(0, 4).map((layer) => layerQueueLabel(layer))
}

function layerQueueLabel(layer: any) {
    return [
        firstNonEmpty(layer.variantName, layer.variant_name, layer.name, `Layer ${layer.index || ""}`),
        firstNonEmpty(layer.grade, layer.grade_name),
        layer.thicknessMicron != null ? `${layer.thicknessMicron}u` : firstNonEmpty(layer.thickness_micron, layer.thickness) ? `${firstNonEmpty(layer.thickness_micron, layer.thickness)}u` : "",
        layer.widthMm != null ? `${layer.widthMm}mm` : firstNonEmpty(layer.width_mm, layer.roll_width_mm) ? `${firstNonEmpty(layer.width_mm, layer.roll_width_mm)}mm` : "",
    ].filter(Boolean).join(" · ")
}

function materialIssueTargetKg(row: any) {
    const candidates = [
        row?.planned_issue_qty_kg,
        row?.required_qty_kg,
        row?.estimated_qty_kg,
        row?.theoretical_qty_kg,
        row?.estimated_actual_qty_kg,
        row?.actual_issued_qty_kg,
    ]
    for (const candidate of candidates) {
        const value = Number(candidate)
        if (Number.isFinite(value) && value > 0) return value
    }
    return 0
}

function materialIssueAvailableKg(row: any) {
    const candidates = [
        row?.source_location_available_qty_kg,
        row?.available_qty_kg,
        row?.available_qty,
        row?.current_plant_available_qty_kg,
        row?.plant_available_qty_kg,
        row?.global_available_qty_kg,
    ]
    for (const candidate of candidates) {
        const value = Number(candidate)
        if (Number.isFinite(value) && value >= 0) return value
    }
    return 0
}

function materialIssueKind(row: any) {
    const category = String(row?.category || row?.category_code || "").toUpperCase()
    if (category === "GRANULE") return "GRANULE"
    if (category.includes("INK")) return "INK"
    if (category.includes("SOLVENT")) return "SOLVENT"
    if (category.includes("ADHESIVE")) return "ADHESIVE"
    if (category.includes("ROLL")) return "ROLL"
    return category || "BULK"
}

function materialIssueKindLabel(row: any) {
    const kind = materialIssueKind(row)
    if (kind === "GRANULE") return "Granule"
    if (kind === "ADHESIVE") return "Adhesive"
    if (kind === "SOLVENT") return "Solvent"
    if (kind === "INK") return "Ink"
    if (kind === "ROLL") return "Roll input"
    return "Bulk"
}

function materialSpecsFromJob(job: any, context?: any) {
    const specRows = normalizeProductSpec(job, context).layers
    if (specRows.length) {
        return specRows.map((layer) => ({
            material: firstNonEmpty(layer.variantName, layer.variantCode, `Layer ${layer.index}`),
            code: layer.variantCode,
            thickness: layer.thicknessMicron != null ? String(layer.thicknessMicron) : "",
            grade: layer.grade || "Grade not set",
            width: layer.widthMm != null ? String(layer.widthMm) : "",
            qty: "",
            source: "Order spec",
        }))
    }
    const bom = context?.bom_snapshot || job?.bom_snapshot || {}
    const layers = Array.isArray(context?.bom_layers) && context.bom_layers.length
        ? context.bom_layers
        : (Array.isArray(job?.layers) ? job.layers : [])
    const films = Array.isArray(bom?.films) ? bom.films : []
    const planningLines = Array.isArray(bom?.planning_lines) ? bom.planning_lines : []
    const geometry = geometryFromJob(job, context)
    const rows = layers.map((layer: any, idx: number) => {
        const film = films.find((item: any) => {
            const sameVariant = item?.variant_id && layer?.variant_id && String(item.variant_id) === String(layer.variant_id)
            const sameFamily = item?.family_id && layer?.family_id && String(item.family_id) === String(layer.family_id)
            const sameThickness = Number(item?.thickness_micron || 0) === Number(layer?.thickness_micron || layer?.thickness || 0)
            return sameVariant || (sameFamily && (sameThickness || !layer?.thickness_micron))
        }) || films[idx] || {}
        const policyKey = firstNonEmpty(film?.code, film?.material_code, layer?.code)
        const plan = planningLines.find((item: any) => {
            const code = firstNonEmpty(item?.material_code, item?.policy_key)
            return policyKey && code.includes(policyKey)
        }) || planningLines[idx] || {}
        const material = firstNonEmpty(
            layer?.variant_name,
            layer?.material_name,
            film?.material_name,
            film?.code,
            plan?.material_name,
            plan?.material_code,
            layer?.name && layer.name !== "Material" ? layer.name : "",
            `Layer ${idx + 1}`
        )
        const width = firstNonEmpty(
            Number(layer?.roll_width_mm || 0) > 0 ? layer.roll_width_mm : "",
            layer?.width_mm,
            film?.width_mm,
            geometry.width
        )
        return {
            material,
            code: firstNonEmpty(film?.code, plan?.material_code, layer?.code),
            thickness: firstNonEmpty(layer?.thickness_micron, layer?.thickness, film?.thickness_micron),
            grade: firstNonEmpty(layer?.grade_name, layer?.grade, film?.grade_name, "Grade not set"),
            width,
            qty: firstNonEmpty(plan?.planned_issue_qty, film?.weight_kg, layer?.weight_kg),
            source: firstNonEmpty(film?.source, plan?.policy_source, "Template"),
        }
    })
    if (rows.length === 0 && films.length > 0) {
        return films.map((film: any, idx: number) => {
            const plan = planningLines.find((item: any) => firstNonEmpty(item?.material_code, item?.policy_key).includes(firstNonEmpty(film?.code))) || planningLines[idx] || {}
            return {
                material: firstNonEmpty(film?.material_name, film?.code, plan?.material_name, `Film ${idx + 1}`),
                code: firstNonEmpty(film?.code, plan?.material_code),
                thickness: firstNonEmpty(film?.thickness_micron),
                grade: firstNonEmpty(film?.grade_name, "Grade not set"),
                width: firstNonEmpty(film?.width_mm, geometry.width),
                qty: firstNonEmpty(plan?.planned_issue_qty, film?.weight_kg),
                source: firstNonEmpty(film?.source, plan?.policy_source, "Template"),
            }
        })
    }
    return rows
}

export default function WCMTerminal() {
    const params = useParams()
    const wcId = params?.id as string
    const { toast } = useToast()
    const queryClient = useQueryClient()
    const { user, effectiveRole } = useAuth()
    const userRole = effectiveRole || user?.role_info?.code
    const isManager = ["WORK_CENTER_MANAGER", "ADMIN", "OWNER", "SUPER_ADMIN"].includes(userRole || "")

    const [activeAssignmentId, setActiveAssignmentId] = useState<string | null>(null)
    const [activeMainTab, setActiveMainTab] = useState<"terminal" | "running" | "history">("terminal")
    const [selectedMachineId, setSelectedMachineId] = useState<string>("")
    const [manualOverrideEnabled, setManualOverrideEnabled] = useState(false)
    const [tieredPickerOpen, setTieredPickerOpen] = useState(false)
    const [overrideReason, setOverrideReason] = useState("")
    const [stepPolicyDrafts, setStepPolicyDrafts] = useState<Record<string, StepPolicyDraft>>({})
    const [activeStepPolicyOverrides, setActiveStepPolicyOverrides] = useState<Record<string, boolean>>({})
    const [materialIssueDrafts, setMaterialIssueDrafts] = useState<Record<string, WcmMaterialIssueDraft>>({})
    const [queueSearch, setQueueSearch] = useState("")
    const [queueStatusFilter, setQueueStatusFilter] = useState<"ALL" | "READY" | "ASSIGNED" | "NEEDS_MACHINE">("ALL")
    const [historySearch, setHistorySearch] = useState("")
    const [historyStatusFilter, setHistoryStatusFilter] = useState("ALL")
    const [historyDaysFilter, setHistoryDaysFilter] = useState("30")
    const [queuePage, setQueuePage] = useState(1)
    const [runningPage, setRunningPage] = useState(1)
    const [historyPage, setHistoryPage] = useState(1)
    const [closeJobAction, setCloseJobAction] = useState<{ assignment: any; mode: "SHORT_CLOSE" | "CANCEL" } | null>(null)
    const [closeJobReason, setCloseJobReason] = useState("")
    const autoAssignRef = useRef<Set<string>>(new Set())

    // 1. Data Fetching
    const { data: assignments, isLoading } = useQuery({
        queryKey: ["wcm-queue", wcId],
        queryFn: () => wcmService.getQueue(wcId),
        refetchInterval: 5000 // Polling for new jobs
    })

    const { data: workCenter } = useQuery({
        queryKey: ["work-center", wcId],
        queryFn: async () => {
            const { data } = await api.get(`/api/factory/work-centers/${wcId}/`)
            return data
        }
    })

    const { data: historyJobs, isLoading: isLoadingHistory } = useQuery({
        queryKey: ["wcm-history", wcId, historySearch, historyStatusFilter, historyDaysFilter],
        queryFn: () => wcmService.getHistory(wcId, {
            q: historySearch.trim() || undefined,
            status: historyStatusFilter,
            days: historyDaysFilter === "ALL" ? null : Number(historyDaysFilter || 30),
            limit: 300,
        }),
        refetchInterval: 30000, // History can update less frequently
        enabled: activeMainTab === "history"
    })

    const { data: wcStats } = useQuery({
        queryKey: ["wcm-stats", wcId],
        queryFn: () => wcmService.getStats(wcId),
        refetchInterval: 5000
    })

    const { data: machines } = useQuery({
        queryKey: ["wc-machines", wcId],
        queryFn: async () => {
            const { data } = await api.get(`/api/factory/machines/?work_center=${wcId}`)
            if (Array.isArray(data)) return data
            if (data && typeof data === "object" && Array.isArray((data as any).results)) return (data as any).results
            return []
        }
    })
    const machineOptions = useMemo(() => {
        const list = Array.isArray(machines) ? machines : []
        return list
            .map((m: any) => ({
                id: String(m?.id || ""),
                name: String(m?.name || m?.code || "Machine"),
            }))
            .filter((m: any) => m.id)
    }, [machines])
    const assignmentsList = Array.isArray(assignments) ? assignments : []
    const activeAssignments = useMemo(
        () => assignmentsList.filter((a: any) => {
            const state = String(a?.job_details?.job_state || "").toUpperCase()
            const status = String(a?.job_details?.status || "").toUpperCase()
            return (
                state !== "COMPLETED" &&
                state !== "CANCELLED" &&
                status !== "COMPLETED" &&
                status !== "CANCELLED"
            )
        }),
        [assignmentsList]
    )
    const runningAssignments = useMemo(
        () => activeAssignments.filter((a: any) => assignmentIsMachineReady(a)),
        [activeAssignments]
    )
    const baseQueueAssignments = useMemo(
        () => activeAssignments.filter((a: any) => {
            const status = String(a?.status || "").toUpperCase()
            if (assignmentIsMachineReady(a)) return false
            return status === "WC_READY" || status === "ASSIGNED" || status === "EXECUTION_READY"
        }),
        [activeAssignments]
    )
    const visibleQueueAssignments = useMemo(
        () => baseQueueAssignments.filter((assignment: any) => {
            const job = assignment?.job_details || {}
            const status = String(assignment?.status || "").toUpperCase()
            const hasMachine = Boolean(assignment?.assigned_machine)
            if (queueStatusFilter === "READY" && status !== "WC_READY") return false
            if (queueStatusFilter === "ASSIGNED" && status !== "ASSIGNED") return false
            if (queueStatusFilter === "NEEDS_MACHINE" && hasMachine) return false

            const search = queueSearch.trim().toLowerCase()
            if (!search) return true
            const spec = normalizeProductSpec(job)
            return [spec.searchText, job?.job_number, job?.process_code, assignment?.assigned_machine_name]
                .join(" ")
                .toLowerCase()
                .includes(search)
        }),
        [baseQueueAssignments, queueSearch, queueStatusFilter]
    )
    const visibleRunningAssignments = useMemo(
        () => runningAssignments.filter((assignment: any) => {
            const job = assignment?.job_details || {}
            const search = queueSearch.trim().toLowerCase()
            if (!search) return true
            const spec = normalizeProductSpec(job)
            return [spec.searchText, job?.job_number, job?.process_code, assignment?.assigned_machine_name]
                .join(" ")
                .toLowerCase()
                .includes(search)
        }),
        [runningAssignments, queueSearch]
    )
    const queuePageSize = 20
    const historyPageSize = 30
    const queuePageCount = Math.max(1, Math.ceil(visibleQueueAssignments.length / queuePageSize))
    const runningPageCount = Math.max(1, Math.ceil(visibleRunningAssignments.length / queuePageSize))
    const historyPageCount = Math.max(1, Math.ceil(((historyJobs || []) as any[]).length / historyPageSize))
    const pagedQueueAssignments = visibleQueueAssignments.slice((queuePage - 1) * queuePageSize, queuePage * queuePageSize)
    const pagedRunningAssignments = visibleRunningAssignments.slice((runningPage - 1) * queuePageSize, runningPage * queuePageSize)
    const pagedHistoryJobs = ((historyJobs || []) as any[]).slice((historyPage - 1) * historyPageSize, historyPage * historyPageSize)
    const activeAssignmentPool = activeMainTab === "running" ? visibleRunningAssignments : visibleQueueAssignments
    const activeAssignment = activeAssignmentId
        ? (activeAssignmentPool.find((a) => a.id === activeAssignmentId) || null)
        : null
    const selectedJobId = activeAssignment?.production_job ? String(activeAssignment.production_job) : ""
    const assignedMachineId = activeAssignment?.assigned_machine ? String(activeAssignment.assigned_machine) : ""
    const assignedMachineName = (activeAssignment as any)?.assigned_machine_name
        ? String((activeAssignment as any).assigned_machine_name)
        : ""
    const machineOptionsResolved = useMemo(() => {
        const base = Array.isArray(machineOptions) ? [...machineOptions] : []
        if (assignedMachineId && !base.some((m: any) => String(m.id) === assignedMachineId)) {
            base.unshift({
                id: assignedMachineId,
                name: assignedMachineName || `Machine ${assignedMachineId.slice(0, 8)}`
            })
        }
        return base
    }, [machineOptions, assignedMachineId, assignedMachineName])

    useEffect(() => {
        // Keep selection stable across polling and recover if selected job disappears.
        if (activeMainTab === "history") return
        if (!activeAssignmentPool.length) {
            setActiveAssignmentId(null)
            return
        }
        if (!activeAssignmentId) {
            setActiveAssignmentId(activeAssignmentPool[0].id)
            return
        }
        if (!activeAssignmentPool.some((a) => a.id === activeAssignmentId)) {
            setActiveAssignmentId(activeAssignmentPool[0].id)
        }
    }, [activeAssignmentPool, activeAssignmentId, activeMainTab])

    useEffect(() => {
        setQueuePage(1)
        setRunningPage(1)
    }, [queueSearch, queueStatusFilter])

    useEffect(() => {
        setHistoryPage(1)
    }, [historySearch, historyStatusFilter, historyDaysFilter])

    useEffect(() => {
        // Sync machine selector from latest assignment payload whenever selected job changes.
        if (activeAssignment) {
            if (activeAssignment.assigned_machine) {
                setSelectedMachineId(String(activeAssignment.assigned_machine))
            } else if (!selectedMachineId) {
                setSelectedMachineId("")
            }
        } else {
            setSelectedMachineId("")
        }
    }, [activeAssignment?.id, activeAssignment?.assigned_machine, selectedMachineId])

    useEffect(() => {
        setManualOverrideEnabled(false)
        setOverrideReason("")
    }, [activeAssignment?.id])

    // Execution Context (Flow Engine)
    const { data: executionContext, refetch: refetchContext } = useQuery({
        queryKey: ["execution-context", selectedJobId],
        queryFn: () => wcmService.getJobContext(selectedJobId),
        enabled: !!selectedJobId,
        refetchInterval: 5000
    })

    // Phase 68: Satisfaction Status (Universal Flow Engine)
    const { data: satisfactionStatus, refetch: refetchSatisfaction } = useQuery({
        queryKey: ["satisfaction-status", selectedJobId],
        queryFn: () => wcmService.getSatisfactionStatus(selectedJobId),
        enabled: !!selectedJobId,
        refetchInterval: 5000
    })

    const { data: currentStepPolicy, refetch: refetchCurrentStepPolicy } = useQuery({
        queryKey: ["current-step-material-policy", selectedJobId],
        queryFn: () => wcmService.getCurrentStepMaterialPolicy(selectedJobId),
        enabled: !!selectedJobId,
        refetchInterval: 10000,
    })

    useEffect(() => {
        const nextDrafts: Record<string, StepPolicyDraft> = {}
        const nextActive: Record<string, boolean> = {}
        ;(currentStepPolicy?.items || []).forEach((item) => {
            const isOverride = String(item.policy_source || "").toUpperCase().includes("OVERRIDE")
            nextDrafts[item.policy_key] = {
                issue_policy_mode: (isOverride ? String(item.effective_issue_policy_mode || "NONE") : "NONE").toUpperCase() as StepPolicyDraft["issue_policy_mode"],
                issue_policy_value: isOverride ? Number(item.effective_issue_policy_value || 0) : 0,
                reason: isOverride ? String(item.override_reason || "") : "",
            }
            nextActive[item.policy_key] = isOverride
        })
        setStepPolicyDrafts(nextDrafts)
        setActiveStepPolicyOverrides(nextActive)
    }, [currentStepPolicy])

    // Phase 68: WIP Pool Grouped
    const { data: wipPoolGrouped } = useQuery({
        queryKey: ["wip-pool-grouped", selectedJobId],
        queryFn: () => wcmService.getWipPoolGrouped(selectedJobId),
        enabled: !!selectedJobId,
        refetchInterval: selectedJobId ? 5000 : false,
    })

    // Use Context specific eligible rolls if available, else fallback to WC endpoint
    const { data: eligibleRollsFallback } = useQuery({
        queryKey: ["eligible-rolls", selectedJobId],
        queryFn: () => wcmService.getEligibleRolls(selectedJobId),
        enabled: !!selectedJobId && !executionContext
    })
    const eligibleRolls = useMemo(() => {
        const raw = (executionContext as any)?.eligible_rolls ?? eligibleRollsFallback
        if (Array.isArray(raw)) return raw
        if (raw && typeof raw === "object" && Array.isArray((raw as any).results)) return (raw as any).results
        return []
    }, [executionContext, eligibleRollsFallback])

    // 2. Stats Calculation
    const stats = useMemo(() => {
        return {
            running: wcStats?.running || 0,
            waiting: wcStats?.waiting || 0,
            total: wcStats?.total_active || 0
        }
    }, [wcStats])

    const wipPool = useMemo(() => {
        if (!wipPoolGrouped) return []
        return Object.values(wipPoolGrouped).flat()
    }, [wipPoolGrouped])

    const autoForwardedRolls = useMemo(() => {
        return wipPool
    }, [wipPool])

    const baseManualEligibleRolls = useMemo(() => {
        return [...eligibleRolls].sort((a: any, b: any) => {
            const aExact = a?.spec_exact ? 1 : 0
            const bExact = b?.spec_exact ? 1 : 0
            if (aExact !== bExact) return bExact - aExact
            const aMissing = a?.spec_missing ? 1 : 0
            const bMissing = b?.spec_missing ? 1 : 0
            if (aMissing !== bMissing) return aMissing - bMissing
            return String(a.label_id || "").localeCompare(String(b.label_id || ""))
        })
    }, [eligibleRolls])

    const selectedJob = (activeAssignment as any)?.job_details
    const selectedTargetPlantId = String(
        activeAssignment?.plant_id ||
        selectedJob?.work_center?.plant_id ||
        (workCenter as any)?.plant_id ||
        (workCenter as any)?.plant ||
        ""
    )
    const selectedTargetPlantName = String(
        selectedJob?.work_center?.plant_name ||
        (workCenter as any)?.plant_name ||
        (workCenter as any)?.plant?.name ||
        ""
    )
    const bomSnapshot = (executionContext as any)?.bom_snapshot || (selectedJob as any)?.bom_snapshot || {}
    const bomFilms: any[] = Array.isArray((bomSnapshot as any)?.films) ? (bomSnapshot as any).films : []
    const bomGranules: any[] = Array.isArray((bomSnapshot as any)?.granules) ? (bomSnapshot as any).granules : []
    const bomInks: any[] = Array.isArray((bomSnapshot as any)?.inks) ? (bomSnapshot as any).inks : []
    const bomChemicals: any[] = Array.isArray((bomSnapshot as any)?.chemicals) ? (bomSnapshot as any).chemicals : []
    const bomAddons: any[] = Array.isArray((bomSnapshot as any)?.addons) ? (bomSnapshot as any).addons : []
    const estimatedPcs =
        (executionContext as any)?.job?.estimated_pcs ??
        (selectedJob as any)?.estimated_pcs ??
        (selectedJob as any)?.quantity_pcs ??
        null
    const stepTargetKg = Number(
        (executionContext as any)?.step_execution?.total_target_kg ??
        (executionContext as any)?.job?.target_weight_kg ??
        0
    )
    const stepRollTargetKg = Number((executionContext as any)?.step_execution?.roll_target_kg ?? 0)
    const stepBulkTargetKg = Number((executionContext as any)?.step_execution?.bulk_target_kg ?? 0)
    const orderTotalRawKg = Number(
        (executionContext as any)?.order_progress?.weight_kg?.target ??
        (executionContext as any)?.job?.order_target_weight_kg ??
        (selectedJob as any)?.order_reference_target_kg ??
        (selectedJob as any)?.step_adjusted_total_kg ??
        (selectedJob as any)?.total_weight_kg ??
        ((selectedJob as any)?.uom === "KG" ? Number((selectedJob as any)?.quantity || 0) : 0)
    )
    const orderTotalKg = Math.max(orderTotalRawKg, Number(stepTargetKg || 0), 0)
    const selectedOutputForm = String(
        (executionContext as any)?.job?.output_form ??
        (selectedJob as any)?.output_form ??
        ""
    ).toUpperCase()
    const selectedOutputCapturePolicy =
        (executionContext as any)?.step_policy?.output_capture_policy ||
        (executionContext as any)?.roll_handling?.output_capture_policy ||
        {}
    const selectedOutputCaptureMode = String(
        selectedOutputCapturePolicy?.effective_mode ||
        (executionContext as any)?.roll_handling?.operator_entry_mode ||
        "PROCESS_DEFAULT"
    ).toUpperCase()
    const selectedInputForm = String(
        (executionContext as any)?.job?.input_form ??
        (selectedJob as any)?.input_form ??
        ""
    ).toUpperCase()
    const selectedPrimaryUom = String(
        (selectedJob as any)?.primary_uom ||
        ((String((selectedJob as any)?.uom || "").toUpperCase() === "PCS" &&
            selectedOutputForm === "BULK" &&
            selectedInputForm === "ROLL")
            ? "PCS"
            : "KG")
    ).toUpperCase() as "KG" | "PCS"
    const selectedPrimaryDecimals = selectedPrimaryUom === "PCS" ? 0 : 3
    const stepTargetPrimary = toNullableNumber((selectedJob as any)?.step_target_primary) ?? (
        selectedPrimaryUom === "PCS"
            ? (String((selectedJob as any)?.uom || "").toUpperCase() === "PCS" ? Number((selectedJob as any)?.quantity || 0) : null)
            : Number(stepTargetKg || 0)
    )
    const stepRemainingPrimary = toNullableNumber((selectedJob as any)?.step_remaining_primary)
    const showPrimarySupportKg = selectedPrimaryUom === "PCS" && stepTargetKg > 0
    const showPcsSecondary = selectedOutputForm === "BULK"
    const displayPcsSecondary =
        showPcsSecondary && (selectedJob as any)?.uom === "PCS"
            ? Number((selectedJob as any)?.quantity || 0)
            : (showPcsSecondary && estimatedPcs != null ? Number(estimatedPcs) : null)

    const stepPolicyMutation = useMutation({
        mutationFn: async () => {
            if (!selectedJobId) throw new Error("Select a job first.")
            const overrides = Object.entries(stepPolicyDrafts)
                .filter(([policy_key, row]) => Boolean(activeStepPolicyOverrides[policy_key]) && row.issue_policy_mode !== "NONE")
                .map(([policy_key, row]) => ({
                    policy_key,
                    issue_policy_mode: row.issue_policy_mode,
                    issue_policy_value: Number(row.issue_policy_value || 0),
                    reason: String(row.reason || "").trim(),
                }))
            return wcmService.updateCurrentStepMaterialPolicy(selectedJobId, overrides)
        },
        onSuccess: async () => {
            toast({
                title: "Current-step policy updated",
                description: "Issue policy now reflects the execution decision for this step.",
            })
            await Promise.all([refetchCurrentStepPolicy(), refetchContext(), refetchSatisfaction()])
        },
        onError: (err: any) => {
            toast({
                variant: "destructive",
                title: "Current-step policy update failed",
                description: err?.response?.data?.error || err?.message || "Could not save current-step policy overrides.",
            })
        },
    })

    const jobGeometry = (executionContext as any)?.job?.geometry || selectedJob?.geometry || {}
    const geometryBase = (jobGeometry as any)?.base || jobGeometry || {}
    const geometryAdjustments = (() => {
        const candidates = [
            (jobGeometry as any)?.adjustments,
            (geometryBase as any)?.adjustments,
            (jobGeometry as any)?.adjustment_schema,
            (executionContext as any)?.job?.adjustment_schema,
            (selectedJob as any)?.adjustment_schema,
            (selectedJob as any)?.geometry?.adjustments
        ]
        for (const c of candidates) {
            if (Array.isArray(c) && c.length > 0) return c
        }
        const derived: any[] = []
        const pushDerived = (source: any, on: string) => {
            if (!source || typeof source !== "object") return
            Object.entries(source).forEach(([rawKey, rawValue]) => {
                const key = String(rawKey)
                const k = key.toLowerCase()
                if (!(k.includes("adjust") || k.includes("gusset") || k.includes("pod"))) return
                if (rawValue == null || rawValue === "") return
                const value = Number(rawValue)
                if (!Number.isFinite(value)) return
                derived.push({
                    type: key.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()),
                    on,
                    value
                })
            })
        }
        pushDerived(jobGeometry, "Geometry")
        pushDerived(geometryBase, "Geometry")
        pushDerived((jobGeometry as any)?.pod, "POD")
        return derived
    })()

    const targetRollSpecs = useMemo(
        () => (Array.isArray((executionContext as any)?.target_roll_invariant_list) ? (executionContext as any).target_roll_invariant_list : []),
        [executionContext]
    )

    const targetSpecByLayer = useMemo(() => {
        const map = new Map<number, any>()
        targetRollSpecs.forEach((spec: any) => {
            const idx = Number(spec?.layer_index || 0)
            if (Number.isFinite(idx) && idx > 0 && !map.has(idx)) {
                map.set(idx, spec)
            }
        })
        return map
    }, [targetRollSpecs])

    const layerSnapshot = Array.isArray(selectedJob?.layers) ? selectedJob.layers : []
    const displayLayers = useMemo(() => {
        const ctxLayers = (executionContext as any)?.bom_layers
        if (Array.isArray(ctxLayers) && ctxLayers.length > 0) {
            return ctxLayers.map((layer: any, idx: number) => {
                const snap = layerSnapshot[idx] || {}
                const spec = targetSpecByLayer.get(Number(layer.index || idx + 1)) || {}
                const layerWeightKg =
                    layer.weight_kg ??
                    layer.layer_weight_kg ??
                    layer.required_qty_kg ??
                    snap.weight_kg ??
                    snap.layer_weight_kg ??
                    null
                const normalizedMaterials = Array.isArray(layer.materials)
                    ? layer.materials.map((m: any) => ({
                        ...m,
                        weight_kg: m?.weight_kg ?? m?.required_qty_kg ?? m?.qty_kg ?? m?.quantity ?? 0,
                    }))
                    : []
                return {
                    ...layer,
                    index: layer.index || idx + 1,
                    variant_name: layer.variant_name || snap.variant_name || spec.variant_name || snap.name || layer.name,
                    name: layer.variant_name || snap.variant_name || spec.variant_name || snap.name || layer.name || `Layer ${idx + 1}`,
                    thickness: layer.thickness ?? snap.thickness_micron ?? snap.thickness ?? spec.thickness_micron,
                    thickness_micron: layer.thickness_micron ?? layer.thickness ?? snap.thickness_micron ?? snap.thickness ?? spec.thickness_micron,
                    grade: layer.grade || snap.grade_name || snap.grade || spec.grade_name,
                    grade_name: layer.grade_name || layer.grade || snap.grade_name || snap.grade || spec.grade_name,
                    code: layer.code || snap.code || spec.code || snap.variant_code || snap.material_code,
                    weight_kg: layerWeightKg != null ? Number(layerWeightKg) : null,
                    materials: normalizedMaterials
                }
            })
        }
        if (layerSnapshot.length === 0 && targetRollSpecs.length > 0) {
            return targetRollSpecs.map((spec: any, idx: number) => ({
                index: Number(spec.layer_index || idx + 1),
                variant_name: spec.variant_name || spec.family_name || `Layer ${idx + 1}`,
                name: spec.variant_name || spec.family_name || `Layer ${idx + 1}`,
                thickness: spec.thickness_micron ?? null,
                thickness_micron: spec.thickness_micron ?? null,
                grade: spec.grade_name || null,
                grade_name: spec.grade_name || null,
                code: spec.code || null,
                weight_kg: spec.weight_kg ?? spec.required_qty_kg ?? null,
                materials: []
            }))
        }
        return layerSnapshot.map((l: any, idx: number) => ({
            index: idx + 1,
            variant_name: l.variant_name || l.name || l.code || `Layer ${idx + 1}`,
            name: l.variant_name || l.name || l.code || `Layer ${idx + 1}`,
            thickness: l.thickness_micron ?? l.thickness,
            thickness_micron: l.thickness_micron ?? l.thickness,
            grade: l.grade_name || l.grade,
            grade_name: l.grade_name || l.grade,
            code: l.code || l.variant_code || l.material_code,
            weight_kg: l.weight_kg ?? l.layer_weight_kg ?? l.required_qty_kg ?? null,
            materials: []
        }))
    }, [executionContext, layerSnapshot, targetRollSpecs, targetSpecByLayer])

    const assignedRolls = useMemo(() => {
        const normalize = (roll: any) => ({
            id: String(roll?.id ?? ""),
            label_id: roll?.label_id ?? roll?.label ?? "—",
            material_name: roll?.material_name ?? roll?.material?.name ?? roll?.material_code ?? "—",
            quantity: Number(roll?.quantity ?? roll?.weight_kg ?? 0),
            weight_kg: Number(roll?.weight_kg ?? roll?.quantity ?? 0),
            width_mm: roll?.width_mm ?? null,
            thickness_micron: roll?.thickness_micron ?? null,
            grade_name: roll?.grade_name ?? null,
            status: roll?.status ?? null,
            location_name: roll?.location_name ?? roll?.location ?? roll?.location_name_display ?? "—",
            reservation_id: roll?.reservation_id || null,
            roll_role: roll?.roll_role || null,
            is_remainder: Boolean(roll?.is_remainder),
            stage_index: Number(roll?.stage_index ?? 0),
            current_step_index: Number(roll?.current_step_index ?? 0),
            completed_step_index: Number(roll?.completed_step_index ?? 0),
            target_lane_key: roll?.target_lane_key || null,
            target_lane_label: roll?.target_lane_label || null,
            target_layer_index: roll?.target_layer_index ?? null,
            target_variant_name: roll?.target_variant_name || null,
            target_grade_name: roll?.target_grade_name || null,
            target_thickness_micron: roll?.target_thickness_micron ?? null,
            target_width_mm: roll?.target_width_mm ?? null,
        })

        const ctxRolls = (executionContext as any)?.allocated_rolls
        if (Array.isArray(ctxRolls)) return ctxRolls.map(normalize)

        const fallback = (activeAssignment as any)?.allocated_roll_details
        if (Array.isArray(fallback) && fallback.length > 0) return fallback.map(normalize)

        const idOnly = Array.isArray((activeAssignment as any)?.allocated_rolls) ? (activeAssignment as any).allocated_rolls : []
        if (idOnly.length > 0) {
            return idOnly.map((rollId: string) => ({
                id: String(rollId),
                label_id: `ROLL-${String(rollId).slice(0, 8).toUpperCase()}`,
                material_name: "Reserved Roll",
                quantity: 0,
                weight_kg: 0,
                width_mm: null,
                thickness_micron: null,
                grade_name: null,
                status: "RESERVED",
                location_name: "—",
                reservation_id: null
            }))
        }

        return []
    }, [executionContext, activeAssignment])

    const stepRaw = (executionContext as any)?.current_step
    const currentStepNumber = typeof stepRaw === 'object' ? stepRaw?.sequence : (stepRaw ?? (selectedJob?.current_step_index != null ? (Number(selectedJob.current_step_index) + 1) : null))
    const currentStepIndex = Math.max(
        0,
        Number(
            (executionContext as any)?.job?.current_step_index ??
            (selectedJob as any)?.current_step_index ??
            ((typeof currentStepNumber === "number" ? currentStepNumber - 1 : 0) || 0)
        ) || 0
    )
    const rollBehaviorRaw =
        satisfactionStatus?.roll_behavior ||
        (executionContext as any)?.process_config?.roll_behavior ||
        (selectedJob as any)?.roll_behavior ||
        "NONE"
    const rollBehavior = typeof rollBehaviorRaw === "string" ? rollBehaviorRaw : "NONE"
    const assignedRollsForDisplay = useMemo(() => assignedRolls, [assignedRolls])
    const laneGroups = useMemo(() => {
        const groups = (executionContext as any)?.wip_pool_meta?.lane_groups
        return Array.isArray(groups) ? groups : []
    }, [executionContext])
    const rollBehaviorLabel = rollBehavior.replace(/_/g, " ")
    const rollBehaviorGuidance: Record<string, string> = {
        CREATE_NEW: "Create new output roll from produced size + weight.",
        MODIFY_EXISTING: "Use exactly one reserved parent roll and update its weight.",
        MULTI_INPUT_COMBINE: "Reserve required input rolls and combine into one output roll.",
        SPLIT: "Reserve one parent roll and split into multiple child rolls.",
        NONE: "Follow configured roll input requirement for this step."
    }
    const rollsRequired = satisfactionStatus?.rolls_required ?? 0
    const rollsReserved = satisfactionStatus?.rolls_reserved ?? 0
    const lineageRollsAvailable = Number(
        (executionContext as any)?.wip_pool_meta?.lineage_roll_count ??
        satisfactionStatus?.rolls_available ??
        0
    )
    const rollsPool = (satisfactionStatus as any)?.rolls_pool ?? satisfactionStatus?.rolls_available ?? 0
    const fallbackRollsAvailable = Number(
        (executionContext as any)?.wip_pool_meta?.fallback_roll_count ??
        (satisfactionStatus as any)?.rolls_fallback_available ??
        0
    )
    const rollsMissingPool = Math.max(
        0,
        Number((satisfactionStatus as any)?.rolls_missing_pool ?? (rollsRequired - rollsPool))
    )
    const missingLineageRolls = Math.max(
        0,
        Number(
            (executionContext as any)?.wip_pool_meta?.missing_lineage_rolls ??
            (satisfactionStatus as any)?.rolls_missing_lineage ??
            (rollsRequired - lineageRollsAvailable)
        )
    )
    const rollAssignmentValidation = (executionContext as any)?.roll_assignment_validation || {}
    const matchedSlotCount = Number((rollAssignmentValidation as any)?.matched_target_slots?.length || 0)
    const unmatchedSlotCount = Number((rollAssignmentValidation as any)?.unmatched_target_slots?.length || 0)
    const manualEligibleRolls = useMemo(() => {
        return [...baseManualEligibleRolls].sort((a: any, b: any) => {
            const sourceRank = (row: any) => {
                const value = String(row?.roll_source || "").toUpperCase()
                if (value === "LINEAGE") return 3
                if (value === "PURCHASED_FALLBACK") return 2
                if (value === "COMPATIBLE_FALLBACK") return 1
                return 0
            }
            const aSource = sourceRank(a)
            const bSource = sourceRank(b)
            if (aSource !== bSource) return bSource - aSource
            const aExact = a?.spec_exact ? 1 : 0
            const bExact = b?.spec_exact ? 1 : 0
            if (aExact !== bExact) return bExact - aExact
            const aMissing = a?.spec_missing ? 1 : 0
            const bMissing = b?.spec_missing ? 1 : 0
            if (aMissing !== bMissing) return aMissing - bMissing
            return String(a.label_id || "").localeCompare(String(b.label_id || ""))
        })
    }, [baseManualEligibleRolls])
    const assignmentReservedCount = Array.isArray((activeAssignment as any)?.allocated_rolls)
        ? (activeAssignment as any).allocated_rolls.length
        : 0
    const effectiveRollsReserved = Math.max(rollsReserved, assignedRollsForDisplay.length, assignmentReservedCount)
    const rollsMissing = Math.max(0, rollsRequired - effectiveRollsReserved)
    const requiresManualRollAssign = satisfactionStatus?.input_form === "ROLL" && rollsMissing > 0
    const rollGuidanceText =
        (satisfactionStatus?.input_form === "ROLL" && rollsRequired > 0 && rollBehavior === "NONE")
            ? "Reserve required input roll(s) for this step."
            : (rollBehaviorGuidance[rollBehavior] || rollBehaviorGuidance.NONE)
    const showRollGuidance = satisfactionStatus?.input_form === "ROLL" && requiresManualRollAssign
    const canManualAssign = satisfactionStatus?.input_form === "ROLL" && (rollsMissing > 0 || manualOverrideEnabled)
    const assignedRollIdSet = useMemo(
        () => new Set(assignedRollsForDisplay.map((r: any) => String(r.id || ""))),
        [assignedRollsForDisplay]
    )
    const assignedRollLabelSet = useMemo(
        () =>
            new Set(
                assignedRollsForDisplay
                    .map((r: any) => String(r.label_id || "").trim().toUpperCase())
                    .filter(Boolean)
            ),
        [assignedRollsForDisplay]
    )
    const wipPoolDisplayRolls = useMemo(() => {
        const out: any[] = []
        const seen = new Set<string>()
        for (const roll of (autoForwardedRolls || [])) {
            const id = String(roll?.id || "")
            if (!id) continue
            const label = String(roll?.label_id || "").trim().toUpperCase()
            const dedupeKey = label || id
            if (seen.has(dedupeKey)) continue
            seen.add(dedupeKey)
            out.push({
                ...roll,
                is_assigned: assignedRollIdSet.has(id) || (label && assignedRollLabelSet.has(label)),
            })
        }
        return out
    }, [autoForwardedRolls, assignedRollIdSet, assignedRollLabelSet])
    const wipPoolRolls = useMemo(
        () => wipPoolDisplayRolls,
        [wipPoolDisplayRolls]
    )
    const wipUnassignedRolls = useMemo(
        () => wipPoolDisplayRolls.filter((roll: any) => !roll?.is_assigned),
        [wipPoolDisplayRolls]
    )
    const rollAllocationCandidates = useMemo(() => {
        const map = new Map<string, any>()
            ; (manualEligibleRolls || []).forEach((roll: any) => {
                const id = String(roll?.id || "")
                if (!id || assignedRollIdSet.has(id)) return
                map.set(id, roll)
            })
            ; (wipUnassignedRolls || []).forEach((roll: any) => {
                const id = String(roll?.id || "")
                if (!id || assignedRollIdSet.has(id) || map.has(id)) return
                map.set(id, {
                    ...roll,
                    location: roll?.location || roll?.location_name || "—",
                    location_name: roll?.location_name || roll?.location || "—",
                    location_type: roll?.location_type || "",
                    spec_exact: false,
                    spec_missing: true,
                })
            })
        return Array.from(map.values())
    }, [manualEligibleRolls, wipUnassignedRolls, assignedRollIdSet])
    const showRollAllocator = canManualAssign
    const showRollTransfer = (satisfactionStatus?.input_form === "ROLL" && rollsMissingPool > 0) && rollAllocationCandidates.length === 0

    const bulkRows = (satisfactionStatus?.bulk_consumption || []).map((bulk: any) => {
        const required = Number(bulk.required_qty_kg ?? bulk.estimated_actual_qty_kg ?? bulk.estimated_qty_kg ?? 0)
        const sourceLocationAvailable = Number(
            bulk.source_location_available_qty_kg ??
            bulk.available_qty_kg ??
            bulk.available_qty ??
            0
        )
        const currentPlantAvailable = Number(
            bulk.current_plant_available_qty_kg ??
            bulk.plant_available_qty_kg ??
            0
        )
        const globalAvailable = Number(bulk.global_available_qty_kg ?? 0)
        const fallbackOtherPlants = Math.max(0, globalAvailable - currentPlantAvailable)
        const otherPlantsAvailableRaw = Number(
            bulk.other_plants_available_qty_kg ??
            fallbackOtherPlants
        )
        const otherPlantsAvailable = Number.isFinite(otherPlantsAvailableRaw)
            ? Math.max(0, otherPlantsAvailableRaw)
            : 0

        const localAvailable = currentPlantAvailable
        const shortfall = Math.max(0, required - localAvailable)
        const hasNonLocalStock = otherPlantsAvailable > 0.0001
        const isOk = shortfall <= 0
        const needsTransfer = shortfall > 0 && hasNonLocalStock && Boolean(bulk.material_id || bulk.materialId)
        const statusText = isOk ? "READY" : (hasNonLocalStock ? "INSUFFICIENT" : "NO STOCK")

        return {
            material: bulk.material_name || bulk.category_display || bulk.category,
            materialId: bulk.material_id,
            type: "BULK",
            required,
            localAvailable,
            plantInventory: otherPlantsAvailable,
            sourceLocationAvailable,
            shortfall,
            isOk,
            needsTransfer,
            statusText,
            locationName: bulk.location_name || null
        }
    })

    const rollRow = satisfactionStatus?.input_form === "ROLL" ? (() => {
        const rollsLocalAvailable = Number((satisfactionStatus as any)?.rolls_available ?? 0)
        const isOk = effectiveRollsReserved >= rollsRequired
        const statusText = isOk ? "READY" : "INSUFFICIENT"
        return {
            material: "Rolls",
            type: "ROLL",
            required: rollsRequired,
            localAvailable: rollsLocalAvailable,
            plantInventory: null,
            isOk,
            needsTransfer: rollsMissingPool > 0,
            statusText,
            shortfall: rollsMissingPool > 0 ? rollsMissingPool : rollsMissing,
            locationName: null
        }
    })() : null

    const requirementRows = [...bulkRows, ...(rollRow ? [rollRow] : [])]
    const materialIssueRows = useMemo(
        () => (satisfactionStatus?.bulk_consumption || []).filter((row: any) => {
            const required = Number(row?.required_qty_kg ?? row?.estimated_actual_qty_kg ?? row?.estimated_qty_kg ?? 0)
            const planned = Number(row?.planned_issue_qty_kg ?? 0)
            const issued = Number(row?.actual_issued_qty_kg ?? 0)
            const theoretical = Number(row?.theoretical_qty_kg ?? 0)
            return required > 0 || planned > 0 || theoretical > 0 || issued > 0
        }),
        [satisfactionStatus]
    )
    const updateMaterialIssueDraft = (requirementId: string, patch: Partial<WcmMaterialIssueDraft>) => {
        if (!requirementId) return
        setMaterialIssueDrafts((prev) => ({
            ...prev,
            [requirementId]: {
                ...(prev[requirementId] || {
                    actual_issued_qty: "",
                    actual_returned_qty: "0",
                    actual_scrap_qty: "0",
                    is_estimated: true,
                }),
                ...patch,
            },
        }))
    }
    useEffect(() => {
        if (!selectedJobId) {
            setMaterialIssueDrafts({})
            return
        }
        const persisted = Array.isArray((executionContext as any)?.current_step_material_confirmations)
            ? (executionContext as any).current_step_material_confirmations
            : []
        setMaterialIssueDrafts((prev) => {
            const next: Record<string, WcmMaterialIssueDraft> = {}
            materialIssueRows.forEach((row: any) => {
                const requirementId = String(row?.requirement_id || "").trim()
                if (!requirementId) return
                const saved = persisted.find((item: any) => String(item?.requirement_id || "") === requirementId)
                const issueTarget = materialIssueTargetKg(row)
                const codeOptions = Array.isArray(row?.granule_code_options) ? row.granule_code_options : []
                next[requirementId] = {
                    material_id: String(row?.material_id || saved?.material_id || ""),
                    actual_issued_qty: String(saved?.actual_issued_qty ?? prev[requirementId]?.actual_issued_qty ?? (issueTarget > 0 ? issueTarget.toFixed(3) : "")),
                    actual_returned_qty: String(saved?.actual_returned_qty ?? prev[requirementId]?.actual_returned_qty ?? "0"),
                    actual_scrap_qty: String(saved?.actual_scrap_qty ?? prev[requirementId]?.actual_scrap_qty ?? "0"),
                    is_estimated: Boolean(saved?.is_estimated ?? prev[requirementId]?.is_estimated ?? true),
                    granule_code_allocations: Array.isArray(saved?.granule_code_allocations)
                        ? saved.granule_code_allocations.map((allocation: any) => ({
                            granule_code_id: String(allocation?.granule_code_id || ""),
                            qty_kg: String(allocation?.qty_kg ?? allocation?.quantity ?? ""),
                        }))
                        : (prev[requirementId]?.granule_code_allocations ||
                            (String(row?.category || "").toUpperCase() === "GRANULE" && codeOptions.length
                                ? [{ granule_code_id: String(codeOptions[0]?.granule_code_id || ""), qty_kg: issueTarget > 0 ? issueTarget.toFixed(3) : "" }]
                                : [])),
                }
            })
            return next
        })
    }, [selectedJobId, executionContext, materialIssueRows])
    const materialIssuePayload = useMemo(
        () => materialIssueRows.map((row: any) => {
            const requirementId = String(row?.requirement_id || "").trim()
            const draft = materialIssueDrafts[requirementId]
            if (!requirementId || !draft) return null
            const isGranule = String(row?.category || row?.category_code || "").toUpperCase() === "GRANULE"
            const issuedQty = Math.max(0, Number(draft.actual_issued_qty || 0))
            const granuleCodeAllocations = isGranule && issuedQty > 0 ? (draft.granule_code_allocations || [])
                .map((allocation) => ({
                    granule_code_id: allocation.granule_code_id,
                    qty_kg: Math.max(0, Number(allocation.qty_kg || 0)),
                }))
                .filter((allocation) => allocation.granule_code_id && allocation.qty_kg > 0) : []
            return {
                requirement_id: requirementId,
                material_id: draft.material_id || row?.material_id,
                actual_issued_qty: issuedQty,
                actual_returned_qty: 0,
                actual_scrap_qty: 0,
                is_estimated: draft.is_estimated,
                granule_code_allocations: granuleCodeAllocations.length ? granuleCodeAllocations : undefined,
            }
        }).filter(Boolean),
        [materialIssueDrafts, materialIssueRows]
    )
    const materialIssueErrors = useMemo(() => {
        const errors: string[] = []
        materialIssueRows.forEach((row: any) => {
            const requirementId = String(row?.requirement_id || "").trim()
            if (!requirementId) return
            const materialName = String(row?.material_name || row?.category_display || row?.category || "Material")
            const draft = materialIssueDrafts[requirementId]
            const issued = Number(draft?.actual_issued_qty ?? 0)
            if (!Number.isFinite(issued) || issued < 0) {
                errors.push(`${materialName}: issued kg is invalid`)
                return
            }
            if (materialIssueTargetKg(row) > 0 && issued <= 0) {
                errors.push(`${materialName}: enter issued kg`)
                return
            }
            const category = String(row?.category || row?.category_code || "").toUpperCase()
            const codeOptions = Array.isArray(row?.granule_code_options) ? row.granule_code_options : []
            const allowedCodes = new Set(codeOptions.map((option: any) => String(option?.granule_code_id || "")))
            const allocations = draft?.granule_code_allocations || []
            if (category === "GRANULE" && issued > 0) {
                if (!codeOptions.length) {
                    errors.push(`${materialName}: no coded stock available`)
                    return
                }
                if (!allocations.length) {
                    errors.push(`${materialName}: select code split`)
                    return
                }
                let allocated = 0
                for (const allocation of allocations) {
                    const codeId = String(allocation.granule_code_id || "")
                    const qty = Number(allocation.qty_kg || 0)
                    if (!allowedCodes.has(codeId)) {
                        errors.push(`${materialName}: code is not allowed`)
                        return
                    }
                    if (!Number.isFinite(qty) || qty < 0) {
                        errors.push(`${materialName}: code kg is invalid`)
                        return
                    }
                    allocated += qty
                }
                if (Math.abs(allocated - issued) > 0.0001) {
                    errors.push(`${materialName}: code split must equal issued kg`)
                }
            }
        })
        return errors
    }, [materialIssueDrafts, materialIssueRows])
    const stepOtherRequirementsRaw: any[] = Array.isArray((executionContext as any)?.other_requirements)
        ? (executionContext as any).other_requirements
        : []
    const allOtherRequirementsRaw: any[] = Array.isArray((executionContext as any)?.all_other_requirements)
        ? (executionContext as any).all_other_requirements
        : []
    const stepOtherRequirements = useMemo(() => {
        return stepOtherRequirementsRaw.map((item: any) => ({
            ...item,
            weight_kg: Number(item.weight_kg || item.required_qty_kg || item.qty_kg || item.quantity || 0),
            scope: "STEP",
        }))
    }, [stepOtherRequirementsRaw])
    const referenceOtherRequirements: any[] = useMemo(() => {
        const rows: any[] = []
        const push = (item: any, category: string) => {
            if (!item || typeof item !== "object") return
            rows.push({
                material_id: item.material_id || item.variant_id || item.id || null,
                code: item.code || item.material_code || "",
                name: item.name || item.material_name || "—",
                category,
                weight_kg: Number(item.weight_kg || item.required_qty_kg || item.qty_kg || item.quantity || 0),
                uom: "KG",
            })
        }
            ; (Array.isArray(bomInks) ? bomInks : []).forEach((item: any) => push(item, "INK"))
            ; (Array.isArray(bomChemicals) ? bomChemicals : []).forEach((item: any) => push(item, "CHEMICAL"))
            ; (Array.isArray(bomAddons) ? bomAddons : []).forEach((item: any) => push(item, "ADDON"))
        return rows
    }, [bomInks, bomChemicals, bomAddons])
    const historyOtherRequirements = useMemo(() => {
        return allOtherRequirementsRaw
            .filter((item: any) => {
                const stepSeq = Number(item?.step_sequence || 0)
                const currentSeq = Number(currentStepNumber || 0)
                if (!stepSeq || !currentSeq) return false
                // Show only historical (already passed) items, never future-step materials.
                if (!(stepSeq < currentSeq)) return false
                const qty = Number(item.weight_kg || item.required_qty_kg || item.qty_kg || item.quantity || 0)
                return qty > 0
            })
            .map((item: any) => ({
                ...item,
                weight_kg: Number(item.weight_kg || item.required_qty_kg || item.qty_kg || item.quantity || 0),
                scope: "OTHER_STEP",
            }))
    }, [allOtherRequirementsRaw, currentStepNumber])
    const displayOtherRequirements = useMemo(() => {
        const map = new Map<string, any>()
        const push = (item: any) => {
            if (!item) return
            const codeKey = String(item.code || item.material_code || "").trim().toUpperCase()
            const nameKey = String(item.name || "").trim().toUpperCase()
            const categoryKey = String(item.category || "").trim().toUpperCase()
            // Prefer semantic dedupe (code/name/category) to avoid duplicate
            // "current + prior/reference" rows for the same material label.
            const materialKey = String(item.material_id || item.variant_id || "").trim()
            const semanticKey = `${codeKey || nameKey || "ITEM"}::${categoryKey || "UNCAT"}`
            const key = semanticKey || materialKey
            const incoming = {
                ...item,
                weight_kg: Number(item.weight_kg || item.required_qty_kg || item.qty_kg || item.quantity || 0),
            }
            const existing = map.get(key)
            if (!existing) {
                map.set(key, incoming)
                return
            }
            const scopeRank = (scope: string) => {
                if (scope === "STEP") return 3
                if (scope === "OTHER_STEP") return 2
                return 1
            }
            const existingRank = scopeRank(String(existing.scope || ""))
            const incomingRank = scopeRank(String(incoming.scope || ""))
            if (incomingRank > existingRank) {
                map.set(key, incoming)
                return
            }
            if (incomingRank === existingRank && Number(incoming.weight_kg || 0) > Number(existing.weight_kg || 0)) {
                map.set(key, incoming)
            }
        }
        stepOtherRequirements.forEach(push)
        historyOtherRequirements.forEach(push)
        // Always merge BOM reference rows; semantic dedupe above prevents noisy duplicates.
        referenceOtherRequirements.forEach(push)
        return Array.from(map.values())
    }, [stepOtherRequirements, historyOtherRequirements, referenceOtherRequirements])
    const otherRequirementsLabel = "Inks, Chemicals & Add-ons"

    const isReleasedToMachine = assignmentIsMachineReady(activeAssignment)
    const bulkOk = bulkRows.length ? bulkRows.every(r => r.isOk) : true
    const rollOk = rollRow ? rollRow.isOk : true
    const requirementsSatisfied = bulkOk && rollOk
    const pushBlockingReasons = useMemo(() => {
        const reasons: string[] = []
        const blockedRows = requirementRows.filter((r: any) => !r.isOk)
        blockedRows.forEach((row: any) => {
            if (row.statusText && row.statusText !== "READY") {
                reasons.push(`${row.material}: ${row.statusText}`)
            } else {
                reasons.push(`${row.material}: requirement not satisfied`)
            }
        })
        if (!selectedMachineId) {
            reasons.push("Machine: not assigned")
        }
        materialIssueErrors.forEach((error) => reasons.push(error))
        return reasons
    }, [requirementRows, selectedMachineId, materialIssueErrors])
    const canPushToOperator = !isReleasedToMachine && pushBlockingReasons.length === 0
    const wcmNextAction = !activeAssignment
        ? "Pick a job from the left queue."
        : isReleasedToMachine
            ? "Execution is ready on the machine terminal."
        : !requirementsSatisfied
            ? "Clear the blocked requirement before sending this step forward."
            : !selectedMachineId
                ? "Choose the machine for this step."
                : canPushToOperator
                    ? "Assigning the machine will release this step."
                    : "Review the last blocker and clear it."
    const wcmStatusSummary = isReleasedToMachine
        ? "Preparation is locked after release."
        : requirementsSatisfied
        ? "Material and roll checks are ready."
        : "One or more inputs still need action."

    useEffect(() => {
        if (!activeAssignment || !satisfactionStatus) return
        if (satisfactionStatus.input_form !== "ROLL") return
        if (rollsRequired <= 0) return
        if (rollsPool >= rollsRequired) return
        if (effectiveRollsReserved >= rollsRequired) return
        const jobId = activeAssignment.production_job
        if (!jobId) return
        if (autoAssignRef.current.has(jobId)) return

        autoAssignRef.current.add(jobId)
        wcmService.autoSatisfy(jobId).then(() => {
            refetchContext()
            refetchSatisfaction()
            queryClient.invalidateQueries({ queryKey: ["wip-pool-grouped", jobId] })
        }).catch(() => {
            // Keep silent; WCM can still manually allocate if needed.
        })
    }, [activeAssignment?.production_job, satisfactionStatus?.input_form, rollsRequired, rollsPool, effectiveRollsReserved, queryClient, refetchContext, refetchSatisfaction])

    // 3. Mutations
    const mutation = useMutation({
        mutationFn: async (action: () => Promise<any>) => await action(),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["wcm-queue", wcId] })
            toast({ title: "Success", description: "Action completed successfully." })
        },
        onError: (err: any) => {
            toast({
                variant: "destructive",
                title: "Action Failed",
                description: err?.response?.data?.error || err?.message || "Unknown error occurred."
            })
        }
    })

    const handleUnassignRoll = (reservationId: string) => {
        if (!activeAssignment) return
        mutation.mutate(async () => {
            await wcmService.unassignRoll(activeAssignment.id, reservationId)
            await refetchContext()
            await refetchSatisfaction()
            queryClient.invalidateQueries({ queryKey: ["wcm-queue", wcId] })
        })
    }

    const handleUnassignRollByRoll = (rollId: string) => {
        if (!activeAssignment) return
        mutation.mutate(async () => {
            await wcmService.unassignRollByRoll(activeAssignment.id, rollId)
            await refetchContext()
            await refetchSatisfaction()
            queryClient.invalidateQueries({ queryKey: ["wcm-queue", wcId] })
        })
    }

    const handlePushToOperator = () => {
        if (!activeAssignment) return
        mutation.mutate(async () => {
            if (isReleasedToMachine) {
                throw new Error("This job is already released to machine execution.")
            }
            if (!canPushToOperator) {
                throw new Error(pushBlockingReasons[0] || "Requirements are not fully satisfied.")
            }
            if (!selectedMachineId) {
                throw new Error("Machine must be selected before push.")
            }
            // Ensure machine assignment is persisted before push.
            if (String(activeAssignment.assigned_machine || "") !== String(selectedMachineId)) {
                await wcmService.assignMachine(activeAssignment.id, selectedMachineId)
            }
            if (satisfactionStatus?.input_form === "ROLL" && rollsMissingPool > 0) {
                await wcmService.autoSatisfy(activeAssignment.production_job)
            }
            // Mark ready for operator
            await wcmService.markReady(activeAssignment.id, materialIssuePayload as any[])
            setActiveAssignmentId(null)
            await refetchContext()
            await refetchSatisfaction()
            queryClient.invalidateQueries({ queryKey: ["wcm-queue", wcId] })
        })
    }

    const handleAssignAndMaybeRelease = (event?: MouseEvent<HTMLButtonElement>) => {
        event?.preventDefault()
        event?.stopPropagation()
        if (!activeAssignment) {
            toast({ variant: "destructive", title: "No job selected", description: "Pick a queue job before assigning a machine." })
            return
        }
        if (!selectedMachineId) {
            toast({ variant: "destructive", title: "Machine required", description: "Select a machine before release." })
            return
        }
        mutation.mutate(async () => {
            if (isReleasedToMachine) {
                throw new Error("This job is already released to machine execution.")
            }
            if (String(activeAssignment.assigned_machine || "") !== String(selectedMachineId)) {
                const updated = await wcmService.assignMachine(activeAssignment.id, selectedMachineId)
                if (updated?.assigned_machine) {
                    setSelectedMachineId(String(updated.assigned_machine))
                }
            }
            if (!canPushToOperator) {
                return
            }
            if (satisfactionStatus?.input_form === "ROLL" && rollsMissingPool > 0) {
                await wcmService.autoSatisfy(activeAssignment.production_job)
            }
            const released = await wcmService.markReady(activeAssignment.id, materialIssuePayload as any[])
            if (released?.assigned_machine) {
                setSelectedMachineId(String(released.assigned_machine))
            }
            setActiveAssignmentId(String(released?.id || activeAssignment.id))
            await refetchContext()
            await refetchSatisfaction()
            queryClient.invalidateQueries({ queryKey: ["wcm-queue", wcId] })
            queryClient.invalidateQueries({ queryKey: ["wcm-stats", wcId] })
        })
    }

    const handleCloseJobAction = () => {
        if (!closeJobAction) return
        mutation.mutate(async () => {
            await wcmService.closeJob(closeJobAction.assignment.id, closeJobAction.mode, closeJobReason.trim())
            setCloseJobAction(null)
            setCloseJobReason("")
            setActiveAssignmentId(null)
            await refetchContext()
            await refetchSatisfaction()
            queryClient.invalidateQueries({ queryKey: ["wcm-queue", wcId] })
            queryClient.invalidateQueries({ queryKey: ["wcm-history", wcId] })
        })
    }

    if (isLoading) {
        return (
            <div className="flex h-[50vh] items-center justify-center">
                <Loader2 className="h-10 w-10 animate-spin text-blue-500" />
            </div>
        )
    }

    const targetSpec = (executionContext as any)?.target_roll_invariants || {}
    const currentStepPolicyItems = currentStepPolicy?.items || []
    const hasEditableCurrentStepPolicy = currentStepPolicyItems.length > 0
    const hasActiveStepPolicyOverride = currentStepPolicyItems.some((item) => Boolean(activeStepPolicyOverrides[item.policy_key]))
    const hasStepPolicyChangeIntent = hasActiveStepPolicyOverride || currentStepPolicyItems.some((item) => String(item.policy_source || "").toUpperCase().includes("OVERRIDE") && !activeStepPolicyOverrides[item.policy_key])
    const selectedProductName = productNameFromJob(selectedJob, executionContext)
    const selectedGeometry = geometryFromJob(selectedJob, executionContext)
    const selectedPodLabel = podLabelFromJob(selectedJob, executionContext)
    const selectedAddonsLabel = addonsLabelFromJob(selectedJob, executionContext)
    const selectedMaterialSpecs = materialSpecsFromJob(selectedJob, executionContext)
    const selectedLayerChips = selectedMaterialSpecs.length ? selectedMaterialSpecs : (displayLayers.length ? displayLayers : layerHighlightsFromJob(selectedJob, executionContext)).slice(0, 4)
    const selectedStepName = firstNonEmpty(currentStepPolicy?.current_process_name, (executionContext as any)?.current_step?.process_name, selectedJob?.process_code, "Current step")

    if ((activeMainTab as string) !== "legacy") {
        const selectedSpec = normalizeProductSpec(selectedJob, executionContext)
        const currentWorkList = activeMainTab === "running" ? pagedRunningAssignments : pagedQueueAssignments
        const currentWorkTotal = activeMainTab === "running" ? visibleRunningAssignments.length : visibleQueueAssignments.length
        const currentWorkPage = activeMainTab === "running" ? runningPage : queuePage
        const currentWorkPageCount = activeMainTab === "running" ? runningPageCount : queuePageCount
        const setCurrentWorkPage = activeMainTab === "running" ? setRunningPage : setQueuePage
        const queueCounts = {
            all: baseQueueAssignments.length,
            ready: baseQueueAssignments.filter((a: any) => String(a?.status || "").toUpperCase() === "WC_READY").length,
            assigned: baseQueueAssignments.filter((a: any) => String(a?.status || "").toUpperCase() === "ASSIGNED").length,
            executionReady: baseQueueAssignments.filter((a: any) => String(a?.status || "").toUpperCase() === "EXECUTION_READY").length,
            noMachine: baseQueueAssignments.filter((a: any) => !a?.assigned_machine).length,
        }
        const selectedMachine = machineOptionsResolved.find((machine: any) => String(machine.id) === String(selectedMachineId))
        const blockerLabel = isReleasedToMachine
            ? "Execution ready"
            : pushBlockingReasons.length
            ? `${pushBlockingReasons.length} blocker${pushBlockingReasons.length > 1 ? "s" : ""}`
            : "Ready"
        const materialReleaseLabel = materialIssueErrors.length
            ? `${materialIssueErrors.length} check${materialIssueErrors.length > 1 ? "s" : ""}`
            : materialIssueRows.length
                ? "Issue ready"
                : "No issue"
        const machineGateLabel = isReleasedToMachine
            ? "Execution ready"
            : !selectedMachineId
            ? "Pick machine"
            : canPushToOperator
                ? "Ready to release"
                : "Release locked"
        const machineGateHelp = isReleasedToMachine
            ? "This job is already released. Preparation controls are locked and execution continues on the machine terminal."
            : !selectedMachineId
            ? "Select a production line. Release unlocks after current-step inputs are confirmed."
            : canPushToOperator
                ? "Machine and current-step input checks are clear. This action releases the job."
                : pushBlockingReasons[0] || "Complete material and roll checks before release."

        return (
            <div className="min-h-screen bg-[#f7f8fb] text-slate-900" data-testid="wcm-terminal-page">
                <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/80 backdrop-blur-xl">
                    <div className="flex h-14 w-full items-center gap-4 px-6">
                        <div className="grid h-8 w-8 place-items-center rounded-lg bg-blue-600 text-sm font-semibold text-white shadow-sm">W</div>
                        <div className="leading-tight">
                            <div className="text-sm font-semibold tracking-tight">ERP · Production</div>
                            <div className="text-[11px] text-slate-500">Work Center Terminal</div>
                        </div>
                        <nav className="ml-4 hidden items-center gap-1 md:flex">
                            <button
                                type="button"
                                onClick={() => setActiveMainTab("terminal")}
                                className={cn("rounded-md px-3 py-1.5 text-sm transition", activeMainTab === "terminal" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100")}
                            >
                                Queue
                            </button>
                            <button
                                type="button"
                                onClick={() => setActiveMainTab("running")}
                                className={cn("rounded-md px-3 py-1.5 text-sm transition", activeMainTab === "running" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100")}
                            >
                                Running / ready
                            </button>
                            <a className="rounded-md px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-100" href={selectedMachineId ? `/production/machine/${selectedMachineId}` : "/production/machine-selector"}>
                                Machine Terminal
                            </a>
                            <button
                                type="button"
                                onClick={() => setActiveMainTab("history")}
                                className={cn("rounded-md px-3 py-1.5 text-sm transition", activeMainTab === "history" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100")}
                            >
                                History
                            </button>
                        </nav>
                        <div className="ml-auto hidden items-center gap-2 text-xs text-slate-600 md:flex">
                            <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_0_5px_rgba(16,185,129,0.12)]" />
                            Live · polling every 5s
                        </div>
                    </div>
                </header>

                <main className="w-full px-6 py-6">
                    <section className="flex flex-wrap items-end gap-4">
                        <div className="min-w-[280px] flex-1">
                            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                                <span>{workCenter?.plant_name || (workCenter as any)?.plant?.name || "Production plant"}</span>
                                <span>·</span>
                                <span>Shift A</span>
                                <span>·</span>
                                <span>{new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                            </div>
                            <h1 className="mt-1 text-[28px] font-semibold tracking-tight text-slate-950">
                                {workCenter?.name || (activeAssignment as any)?.work_center_name || "Work Center"}
                                <span className="text-xl font-normal text-slate-400">
                                    {" · "}{activeMainTab === "running" ? "Running / ready" : activeMainTab === "history" ? "History" : "Queue"}
                                </span>
                            </h1>
                        </div>
                        <div className="grid w-full grid-cols-2 gap-3 md:w-auto md:grid-cols-4">
                            {[
                                ["Running / ready", visibleRunningAssignments.length, "text-emerald-600"],
                                ["Waiting", stats.waiting, "text-slate-950"],
                                ["Queue", visibleQueueAssignments.length, "text-blue-700"],
                                ["No machine", queueCounts.noMachine, "text-amber-700"],
                            ].map(([label, value, tone]) => (
                                <div key={String(label)} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                                    <div className="text-[11px] uppercase tracking-wider text-slate-500">{label}</div>
                                    <div className={cn("text-xl font-semibold tabular-nums", String(tone))}>{value}</div>
                                </div>
                            ))}
                        </div>
                    </section>

                    <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                            <div className="relative flex-1">
                                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                <Input
                                    value={queueSearch}
                                    onChange={(event) => setQueueSearch(event.target.value)}
                                    placeholder="Search by customer, SO #, product, size, grade, addon..."
                                    className="h-11 rounded-xl border-slate-200 bg-slate-50/80 pl-10 pr-20 text-sm"
                                />
                                <div className="absolute right-2 top-1/2 hidden -translate-y-1/2 items-center gap-1 md:flex">
                                    <span className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[11px] text-slate-500">⌘</span>
                                    <span className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[11px] text-slate-500">K</span>
                                </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                {([
                                    ["ALL", `Queue · ${queueCounts.all}`],
                                    ["READY", `WC Ready · ${queueCounts.ready}`],
                                    ["ASSIGNED", `Assigned · ${queueCounts.assigned}`],
                                    ["NEEDS_MACHINE", `No Machine · ${queueCounts.noMachine}`],
                                ] as const).map(([value, label]) => (
                                    <button
                                        key={value}
                                        type="button"
                                        onClick={() => {
                                            setActiveMainTab("terminal")
                                            setQueueStatusFilter(value)
                                        }}
                                        className={cn(
                                            "h-9 rounded-lg border px-3 text-sm font-medium transition",
                                            activeMainTab !== "running" && activeMainTab !== "history" && queueStatusFilter === value
                                                ? "border-slate-900 bg-slate-900 text-white"
                                                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                                        )}
                                    >
                                        {label}
                                    </button>
                                ))}
                                <button type="button" className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
                                    Sort: Priority
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setActiveMainTab("running")}
                                    className={cn(
                                        "h-9 rounded-lg border px-3 text-sm font-medium transition",
                                        activeMainTab === "running"
                                            ? "border-emerald-700 bg-emerald-700 text-white"
                                            : "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                                    )}
                                >
                                    Running / ready · {visibleRunningAssignments.length}
                                </button>
                            </div>
                        </div>
                        {(queueSearch || queueStatusFilter !== "ALL") && (
                            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-xs">
                                <span className="text-slate-500">Filters:</span>
                                {queueSearch && <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 font-medium text-slate-600">Search · {queueSearch}</span>}
                                {queueStatusFilter !== "ALL" && <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 font-medium text-slate-600">Status · {queueStatusFilter}</span>}
                                <button type="button" onClick={() => { setQueueSearch(""); setQueueStatusFilter("ALL") }} className="font-semibold text-blue-600 hover:underline">
                                    Clear all
                                </button>
                            </div>
                        )}
                    </section>

                    <section className={cn("mt-5 grid gap-5", activeMainTab === "history" ? "xl:grid-cols-1" : "xl:grid-cols-12")}>
                        <div className={cn("space-y-3", activeMainTab === "history" ? "xl:col-span-1" : "max-h-[calc(100vh-270px)] overflow-y-auto pr-2 xl:col-span-7")}>
                            {activeMainTab === "history" ? (
                                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                                    <div className="flex flex-wrap items-start justify-between gap-4">
                                        <div>
                                            <div className="text-[11px] uppercase tracking-wider text-slate-500">History</div>
                                            <div className="text-lg font-semibold text-slate-950">WCM audit and production history</div>
                                            <p className="mt-1 text-sm text-slate-500">Search actions, material issue, machine release, output, scrap, and close records.</p>
                                        </div>
                                        {isLoadingHistory && <Loader2 className="h-5 w-5 animate-spin text-blue-600" />}
                                    </div>
                                    <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_160px_140px]">
                                        <div className="relative">
                                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                            <Input
                                                value={historySearch}
                                                onChange={(event) => setHistorySearch(event.target.value)}
                                                placeholder="Search customer, SO, material, code, machine, user, reason..."
                                                className="h-11 rounded-xl border-slate-200 bg-slate-50 pl-10"
                                            />
                                        </div>
                                        <Select value={historyStatusFilter} onValueChange={setHistoryStatusFilter}>
                                            <SelectTrigger className="h-11 rounded-xl border-slate-200 bg-white">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="ALL">All statuses</SelectItem>
                                                <SelectItem value="RELEASED">Released</SelectItem>
                                                <SelectItem value="EXECUTING">Executing</SelectItem>
                                                <SelectItem value="PAUSED">Paused</SelectItem>
                                                <SelectItem value="COMPLETED">Completed</SelectItem>
                                                <SelectItem value="CANCELLED">Cancelled</SelectItem>
                                                <SelectItem value="MATERIAL_ISSUE">Material issue</SelectItem>
                                                <SelectItem value="SHORT_CLOSE">Short close</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <Select value={historyDaysFilter} onValueChange={setHistoryDaysFilter}>
                                            <SelectTrigger className="h-11 rounded-xl border-slate-200 bg-white">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="30">Last 30 days</SelectItem>
                                                <SelectItem value="7">Last 7 days</SelectItem>
                                                <SelectItem value="1">Today</SelectItem>
                                                <SelectItem value="ALL">All history</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="mt-5 space-y-3">
                                        {pagedHistoryJobs.map((assignment: any) => {
                                            const job = assignment?.job_details || {}
                                            const spec = normalizeProductSpec(job)
                                            const summary = assignment?.history_summary || {}
                                            const events = Array.isArray(assignment?.audit_events) ? assignment.audit_events : []
                                            const latestEvent = events[0]
                                            return (
                                                <div key={assignment.id} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                                                    <div className="flex flex-wrap items-start justify-between gap-4">
                                                        <div className="min-w-[260px] flex-1">
                                                            <div className="flex flex-wrap items-center gap-2">
                                                                <div className="font-semibold text-slate-900">{job.customer_name || spec.customerName || "Customer"}</div>
                                                                <span className="text-sm font-semibold text-blue-700">{job.order_number || spec.orderNumber || "SO —"}</span>
                                                            </div>
                                                            <div className="text-sm text-slate-500">{spec.productName} · {spec.size.label}</div>
                                                            <div className="mt-2 flex flex-wrap gap-1.5">
                                                                {spec.layers.slice(0, 4).map((layer) => (
                                                                    <span key={`${assignment.id}-${layer.index}`} className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700">{layerQueueLabel(layer)}</span>
                                                                ))}
                                                                {spec.podLabels.map((label) => <span key={`${assignment.id}-pod-${label}`} className="rounded-full border border-sky-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-sky-700">PoD · {label}</span>)}
                                                                {spec.addonLabels.map((label) => <span key={`${assignment.id}-addon-${label}`} className="rounded-full border border-orange-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-orange-700">+ {label}</span>)}
                                                            </div>
                                                            <div className="mt-3 grid gap-2 text-xs md:grid-cols-4">
                                                                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2"><span className="block text-slate-400">Output</span><b>{Number(summary.output_qty || job.produced_qty || 0).toFixed(3)} {job.uom || "KG"}</b></div>
                                                                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2"><span className="block text-slate-400">Scrap</span><b>{Number(summary.scrap_qty || 0).toFixed(3)} KG</b></div>
                                                                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2"><span className="block text-slate-400">Machine</span><b>{assignment.assigned_machine_name || "—"}</b></div>
                                                                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2"><span className="block text-slate-400">Closed by</span><b>{summary.closed_by || "—"}</b></div>
                                                            </div>
                                                            <div className="mt-3 space-y-1">
                                                                {events.slice(0, 4).map((event: any) => (
                                                                    <div key={event.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs">
                                                                        <span className="font-black uppercase tracking-wider text-slate-500">{String(event.action || "").replace(/_/g, " ")}</span>
                                                                        <span className="text-slate-400">by</span>
                                                                        <span className="font-semibold text-slate-800">{event.actor || "system"}</span>
                                                                        <span className="text-slate-400">·</span>
                                                                        <span className="text-slate-500">{event.occurred_at ? new Date(event.occurred_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : "—"}</span>
                                                                        {event.reason ? <span className="ml-auto text-slate-600">{event.reason}</span> : null}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                            <div className="mt-2 text-xs text-slate-500">
                                                                {summary.closed_at ? `Closed ${new Date(summary.closed_at).toLocaleString()}` : latestEvent ? `Latest ${String(latestEvent.action || "").replace(/_/g, " ").toLowerCase()}` : "Latest activity"} · {summary.force_reason || job.completion_force_reason || "No variance note"}
                                                            </div>
                                                        </div>
                                                        <Badge variant="outline">{job.job_state || job.status || "Closed"}</Badge>
                                                    </div>
                                                </div>
                                            )
                                        })}
                                        {!isLoadingHistory && !(historyJobs || []).length && (
                                            <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm font-medium text-slate-500">No history rows yet.</div>
                                        )}
                                        {((historyJobs || []) as any[]).length > historyPageSize ? (
                                            <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600">
                                                <span>History page {historyPage} of {historyPageCount} · {((historyJobs || []) as any[]).length} jobs</span>
                                                <div className="flex gap-2">
                                                    <Button type="button" variant="outline" className="h-9 rounded-xl" disabled={historyPage <= 1} onClick={() => setHistoryPage(Math.max(1, historyPage - 1))}>Previous</Button>
                                                    <Button type="button" variant="outline" className="h-9 rounded-xl" disabled={historyPage >= historyPageCount} onClick={() => setHistoryPage(Math.min(historyPageCount, historyPage + 1))}>Next</Button>
                                                </div>
                                            </div>
                                        ) : null}
                                    </div>
                                </div>
                            ) : currentWorkList.length === 0 ? (
                                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center shadow-sm">
                                    <div className="text-lg font-semibold text-slate-900">{activeMainTab === "running" ? "No released or running jobs right now." : "No jobs in this queue right now."}</div>
                                    <p className="mt-1 text-sm text-slate-500">Try clearing filters or widening the date range.</p>
                                    <Button type="button" variant="outline" className="mt-4 rounded-xl" onClick={() => { setQueueSearch(""); setQueueStatusFilter("ALL") }}>Clear filters</Button>
                                </div>
                            ) : currentWorkList.map((assignment: any) => {
                                const job = assignment?.job_details || {}
                                const spec = normalizeProductSpec(job)
                                const status = String(assignment?.status || "WC_READY").toUpperCase()
                                const isQueueReleased = status === "EXECUTION_READY"
                                const jobState = String(job?.job_state || "").toUpperCase()
                                const jobStatus = String(job?.status || "").toUpperCase()
                                const hasStartedExecution = jobState === "EXECUTING" || jobState === "PAUSED" || jobStatus === "RUNNING" || Number(job?.produced_qty || job?.step_produced_primary || 0) > 0
                                const canCancelFromWcm = activeMainTab !== "running" || !hasStartedExecution
                                const canShortCloseFromWcm = activeMainTab === "running" && hasStartedExecution
                                const queueOutputFormRaw = String(job?.output_form || spec.size.finishedGoodType || "OUTPUT").toUpperCase()
                                const queueInputFormRaw = String(job?.input_form || "").toUpperCase()
                                const queueOrderUom = String(job?.uom || "").toUpperCase()
                                const queuePrimaryUom = String(
                                    job?.primary_uom ||
                                    ((queueOrderUom === "PCS" && queueOutputFormRaw === "BULK" && queueInputFormRaw === "ROLL") ? "PCS" : "KG")
                                ).toUpperCase() as "KG" | "PCS"
                                const queuePrimaryDecimals = queuePrimaryUom === "PCS" ? 0 : 3
                                const target = toNullableNumber(job?.step_target_primary) ?? Number(job?.step_target_kg || job?.quantity || 0)
                                const remaining = toNullableNumber(job?.step_remaining_primary)
                                const produced = Math.max(0, Number(target || 0) - Number(remaining ?? target ?? 0))
                                const percent = target && target > 0 ? Math.min(100, Math.max(0, (produced / target) * 100)) : 0
                                const priority = Number(job?.priority ?? 50)
                                const rail = priority >= 80 ? "from-rose-500 via-rose-400 to-rose-300" : priority >= 50 ? "from-amber-500 via-amber-400 to-amber-300" : "from-emerald-500 via-emerald-400 to-emerald-300"
                                const queueSkuLabel = firstNonEmpty((job as any)?.sku_name, (job as any)?.sku_display_name, spec.variantName, (job as any)?.sku_variant_name, spec.variantCode, (job as any)?.sku_variant_code)
                                const queueFinalProduct = [
                                    queueOutputFormRaw,
                                    spec.size.label,
                                    spec.layers.length ? `${spec.layers.length} layer${spec.layers.length > 1 ? "s" : ""}` : "",
                                ].filter(Boolean).join(" · ")
                                const queueFinalQtyReq = `${formatSmartValue(target || 0, queuePrimaryUom, queuePrimaryDecimals)} ${queuePrimaryUom}`
                                const showQueueSkuLine = queueSkuLabel && queueSkuLabel.toLowerCase() !== String(spec.productName || "").toLowerCase()
                                return (
                                    <article
                                        key={assignment.id}
                                        data-testid={`wcm-assignment-row-${assignment.id}`}
                                        onClick={() => setActiveAssignmentId(assignment.id)}
                                        className={cn(
                                            "overflow-hidden rounded-2xl border bg-white shadow-sm transition hover:border-slate-300 hover:shadow-md",
                                            activeAssignmentId === assignment.id ? "border-blue-500 ring-2 ring-blue-100" : "border-slate-200"
                                        )}
                                    >
                                        <div className="flex flex-col xl:flex-row">
                                            <div className={cn("h-1 w-full bg-gradient-to-r xl:h-auto xl:w-1.5 xl:bg-gradient-to-b", rail)} />
                                            <div className="flex-1 p-5">
                                                <div className="flex flex-wrap items-start gap-3">
                                                    <div className="min-w-[240px] flex-1">
                                                        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-slate-500">
                                                            <span>Sales Order</span><span className="text-slate-300">/</span><span>Customer</span>
                                                        </div>
                                                        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                                                            <span className="text-xl font-semibold tracking-tight text-slate-950">{job.customer_name || spec.customerName || "Customer not captured"}</span>
                                                            <span className="font-semibold text-blue-700">{job.order_number || spec.orderNumber || "SO not captured"}</span>
                                                        </div>
                                                        <div className="mt-0.5 text-sm font-semibold text-slate-600">
                                                            <span className="font-medium text-slate-800">{spec.productName}</span>
                                                            {showQueueSkuLine ? <span className="text-slate-400"> · <span className="text-slate-700">{queueSkuLabel}</span></span> : null}
                                                        </div>
                                                    </div>
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <span className={cn(
                                                            "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold",
                                                            status === "EXECUTION_READY" ? "bg-emerald-50 text-emerald-700" :
                                                                status === "ASSIGNED" ? "bg-cyan-50 text-cyan-700" : "bg-blue-50 text-blue-700"
                                                        )}>
                                                            {status === "EXECUTION_READY" ? "✓ Execution Ready" : status === "ASSIGNED" ? `● Assigned${assignment.assigned_machine_name ? ` to ${assignment.assigned_machine_name}` : ""}` : "◷ WC Ready"}
                                                        </span>
                                                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">▲ Priority {priority}</span>
                                                    </div>
                                                </div>

                                                <div className="mt-3 flex flex-wrap gap-1.5">
                                                    <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">Size · {spec.size.label}</span>
                                                    {spec.layers.slice(0, 4).map((layer) => (
                                                        <span key={`${assignment.id}-layer-${layer.index}`} className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">{layerQueueLabel(layer)}</span>
                                                    ))}
                                                    {spec.podLabels.map((label) => <span key={label} className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700">PoD · {label}</span>)}
                                                    {spec.addonLabels.map((label) => <span key={label} className="rounded-full border border-orange-200 bg-orange-50 px-2.5 py-1 text-xs font-semibold text-orange-700">+ {label}</span>)}
                                                </div>

                                                <div className="mt-4 grid items-center gap-4 md:grid-cols-12">
                                                    <div className="md:col-span-5">
                                                        <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-slate-500">
                                                            <span>Step {Number(job.current_step_index ?? 0) + 1} · {job.process_code || selectedStepName}</span>
                                                            <span>{Math.round(percent)}%</span>
                                                        </div>
                                                        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
                                                            <span className="block h-full rounded-full bg-gradient-to-r from-blue-500 to-blue-500" style={{ width: `${percent}%` }} />
                                                        </div>
                                                        <div className="mt-2 flex flex-wrap items-start gap-x-5 gap-y-2">
                                                            <div><div className="text-lg font-semibold tabular-nums">{formatSmartValue(target || 0, queuePrimaryUom, queuePrimaryDecimals)} <span className="text-sm font-medium text-slate-400">{queuePrimaryUom}</span></div><div className="text-[11px] uppercase tracking-wider text-slate-500">Step target</div></div>
                                                            <div><div className="text-lg font-semibold tabular-nums">{formatSmartValue(remaining ?? 0, queuePrimaryUom, queuePrimaryDecimals)} <span className="text-sm font-medium text-slate-400">{queuePrimaryUom}</span></div><div className="text-[11px] uppercase tracking-wider text-slate-500">Remaining</div></div>
                                                            <div className="min-w-[180px] max-w-[280px]"><div className="text-lg font-semibold tabular-nums text-emerald-800">{queueFinalQtyReq}</div><div className="text-xs font-semibold leading-snug text-emerald-700">{queueFinalProduct}</div><div className="text-[11px] uppercase tracking-wider text-slate-500">Final output req</div></div>
                                                        </div>
                                                    </div>
                                                    <div className="flex flex-wrap gap-2 md:col-span-4">
                                                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">Machine · {assignment.assigned_machine_name || "assign"}</span>
                                                        <TooltipProvider delayDuration={100}>
                                                            <Tooltip>
                                                                <TooltipTrigger asChild>
                                                                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">WIP · {Number((assignment as any)?.allocated_roll_details?.length || 0)} rolls</span>
                                                                </TooltipTrigger>
                                                                <TooltipContent side="top" className="max-w-[320px] rounded-xl border-slate-200 bg-white p-3 text-slate-800 shadow-xl">
                                                                    <div className="text-[11px] font-black uppercase tracking-wider text-slate-500">WIP rolls in this flow</div>
                                                                    <div className="mt-2 space-y-1">
                                                                        {Array.isArray((assignment as any)?.allocated_roll_details) && (assignment as any).allocated_roll_details.length ? (assignment as any).allocated_roll_details.slice(0, 6).map((roll: any) => (
                                                                            <div key={String(roll.id || roll.label_id)} className="flex justify-between gap-4 text-xs">
                                                                                <span className="font-semibold">{roll.label_id || roll.roll_number || "Roll"}</span>
                                                                                <span className="text-slate-500">{Number(roll.current_qty || roll.quantity_kg || roll.net_weight_kg || 0).toFixed(3)} kg</span>
                                                                            </div>
                                                                        )) : <div className="text-xs text-slate-500">No WIP rolls assigned yet.</div>}
                                                                    </div>
                                                                </TooltipContent>
                                                            </Tooltip>
                                                        </TooltipProvider>
                                                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">Order placed · {formatDateLabel(job.order_placed_at || job.created_at)}</span>
                                                    </div>
                                                    <div className="flex justify-end gap-2 md:col-span-3">
                                                        {activeMainTab === "running" ? (
                                                            <a
                                                                href={assignment.assigned_machine ? `/production/machine/${assignment.assigned_machine}` : "#"}
                                                                onClick={(event) => { if (!assignment.assigned_machine) event.preventDefault() }}
                                                                className={cn("inline-flex h-10 items-center rounded-xl px-4 text-sm font-semibold", assignment.assigned_machine ? "bg-blue-600 text-white hover:bg-blue-700" : "bg-slate-100 text-slate-400")}
                                                            >
                                                                Open terminal
                                                            </a>
                                                        ) : null}
                                                        <DropdownMenu>
                                                            <DropdownMenuTrigger asChild>
                                                                <button
                                                                    type="button"
                                                                    onClick={(event) => event.stopPropagation()}
                                                                    className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                                                                >
                                                                    ⋯
                                                                </button>
                                                            </DropdownMenuTrigger>
                                                            <DropdownMenuContent align="end" className="w-56">
                                                                <DropdownMenuItem disabled={!canShortCloseFromWcm} onClick={(event) => { event.stopPropagation(); setCloseJobAction({ assignment, mode: "SHORT_CLOSE" }); setCloseJobReason("") }}>
                                                                    Short close step
                                                                </DropdownMenuItem>
                                                                <DropdownMenuItem disabled={!canCancelFromWcm} className="text-rose-600 focus:text-rose-700" onClick={(event) => { event.stopPropagation(); setCloseJobAction({ assignment, mode: "CANCEL" }); setCloseJobReason("") }}>
                                                                    Cancel job
                                                                </DropdownMenuItem>
                                                            </DropdownMenuContent>
                                                        </DropdownMenu>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </article>
                                )
                            })}
                            {currentWorkTotal > queuePageSize ? (
                                <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 shadow-sm">
                                    <span>{activeMainTab === "running" ? "Running / ready" : "Queue"} page {currentWorkPage} of {currentWorkPageCount} · {currentWorkTotal} jobs</span>
                                    <div className="flex gap-2">
                                        <Button type="button" variant="outline" className="h-9 rounded-xl" disabled={currentWorkPage <= 1} onClick={() => setCurrentWorkPage(Math.max(1, currentWorkPage - 1))}>Previous</Button>
                                        <Button type="button" variant="outline" className="h-9 rounded-xl" disabled={currentWorkPage >= currentWorkPageCount} onClick={() => setCurrentWorkPage(Math.min(currentWorkPageCount, currentWorkPage + 1))}>Next</Button>
                                    </div>
                                </div>
                            ) : null}
                        </div>

                        {activeMainTab !== "history" ? <aside className="max-h-[calc(100vh-270px)] overflow-y-auto pr-1 xl:col-span-5">
                            <div className="space-y-4">
                                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="min-w-0">
                                            <div className="text-[11px] uppercase tracking-wider text-slate-500">Selected sales product</div>
                                            <h2 className="mt-1 text-2xl font-semibold leading-tight tracking-tight text-slate-950">{selectedSpec.productName}</h2>
                                            <div className="mt-2 flex flex-wrap gap-1.5 text-xs font-semibold">
                                                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-slate-700">{selectedJob?.customer_name || selectedSpec.customerName || "Customer not captured"}</span>
                                                <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-blue-700">{selectedJob?.order_number || selectedSpec.orderNumber || "SO not captured"}</span>
                                                {selectedSpec.templateName || selectedJob?.template_name ? (
                                                    <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-slate-600">{selectedSpec.templateName || selectedJob?.template_name}</span>
                                                ) : null}
                                            </div>
                                        </div>
                                        <TooltipProvider delayDuration={100}>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <span className={cn("shrink-0 rounded-full px-3 py-1.5 text-xs font-black uppercase tracking-wider", pushBlockingReasons.length ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700")}>{blockerLabel}</span>
                                                </TooltipTrigger>
                                                <TooltipContent side="left" className="max-w-[320px] rounded-xl border-slate-200 bg-white p-3 text-slate-800 shadow-xl">
                                                    {pushBlockingReasons.length ? pushBlockingReasons.slice(0, 6).map((reason) => <div key={reason} className="text-xs font-semibold">{reason}</div>) : <div className="text-xs font-semibold">Machine and material checks are ready.</div>}
                                                </TooltipContent>
                                            </Tooltip>
                                        </TooltipProvider>
                                    </div>

                                    <div className="mt-5 grid gap-3 md:grid-cols-2">
                                        <div className="rounded-xl border border-blue-100 bg-blue-50 p-3">
                                            <div className="text-[10px] font-black uppercase tracking-wider text-blue-600">Final product size</div>
                                            <div className="mt-1 text-lg font-semibold leading-tight text-blue-950">{selectedSpec.size.label || selectedGeometry.label}</div>
                                            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-semibold text-blue-800">
                                                <span>Width {selectedSpec.size.widthMm != null ? `${selectedSpec.size.widthMm} mm` : "—"}</span>
                                                <span>Height {selectedSpec.size.heightMm != null ? `${selectedSpec.size.heightMm} mm` : "—"}</span>
                                                {selectedSpec.size.gussetMm != null && selectedSpec.size.gussetMm > 0 ? <span>Gusset {selectedSpec.size.gussetMm} mm</span> : null}
                                            </div>
                                        </div>
                                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                            <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">Output form</div>
                                            <div className="mt-1 text-lg font-semibold leading-tight text-slate-950">{selectedOutputForm || selectedSpec.size.finishedGoodType || "Output"}</div>
                                            <div className="mt-2 text-[11px] font-semibold text-slate-500">
                                                {selectedInputForm === "ROLL" && selectedOutputForm === "BULK"
                                                    ? outputCaptureModeLabel(selectedOutputCaptureMode)
                                                    : `${selectedSpec.layers.length || 0} layer${selectedSpec.layers.length === 1 ? "" : "s"} in this sales specification`}
                                            </div>
                                        </div>
                                        <div className="rounded-xl border border-sky-100 bg-sky-50 p-3">
                                            <div className="text-[10px] font-black uppercase tracking-wider text-sky-700">POD</div>
                                            <div className="mt-1 flex flex-wrap gap-1.5">
                                                {selectedSpec.podLabels.length ? selectedSpec.podLabels.map((label) => (
                                                    <span key={`selected-pod-${label}`} className="rounded-full border border-sky-200 bg-white px-2 py-1 text-xs font-semibold text-sky-700">{label}</span>
                                                )) : <span className="text-sm font-semibold text-sky-900">{selectedPodLabel}</span>}
                                            </div>
                                        </div>
                                        <div className="rounded-xl border border-orange-100 bg-orange-50 p-3">
                                            <div className="text-[10px] font-black uppercase tracking-wider text-orange-700">Add-ons</div>
                                            <div className="mt-1 flex flex-wrap gap-1.5">
                                                {selectedSpec.addonLabels.length ? selectedSpec.addonLabels.map((label) => (
                                                    <span key={`selected-addon-${label}`} className="rounded-full border border-orange-200 bg-white px-2 py-1 text-xs font-semibold text-orange-700">{label}</span>
                                                )) : <span className="text-sm font-semibold text-orange-900">{selectedAddonsLabel}</span>}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="mt-5">
                                        <div className="mb-2 flex items-center justify-between gap-3">
                                            <div>
                                                <div className="text-[11px] font-black uppercase tracking-wider text-slate-500">Layer build</div>
                                                <div className="text-sm font-semibold text-slate-950">Variant, grade, thickness, and roll width by layer</div>
                                            </div>
                                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600">{selectedSpec.layers.length || 0} layers</span>
                                        </div>
                                        <div className="space-y-2">
                                            {selectedSpec.layers.length ? selectedSpec.layers.map((layer) => (
                                                <div key={`selected-layer-card-${layer.index}`} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                                        <div className="min-w-0">
                                                            <div className="text-[10px] font-black uppercase tracking-wider text-emerald-700">Layer {layer.index}</div>
                                                            <div className="mt-0.5 text-sm font-semibold leading-tight text-slate-950">{firstNonEmpty(layer.variantName, layer.variantCode, `Layer ${layer.index}`)}</div>
                                                            {layer.variantCode && layer.variantCode !== layer.variantName ? (
                                                                <div className="mt-0.5 text-[11px] font-semibold text-slate-500">{layer.variantCode}</div>
                                                            ) : null}
                                                        </div>
                                                        <div className="grid min-w-[260px] flex-1 grid-cols-3 gap-2 text-xs font-semibold">
                                                            <div className="rounded-lg border border-white bg-white px-2.5 py-2">
                                                                <div className="text-[9px] font-black uppercase tracking-wider text-slate-400">Grade</div>
                                                                <div className="mt-0.5 truncate text-slate-800">{firstNonEmpty(layer.grade, "—")}</div>
                                                            </div>
                                                            <div className="rounded-lg border border-white bg-white px-2.5 py-2">
                                                                <div className="text-[9px] font-black uppercase tracking-wider text-slate-400">Thickness</div>
                                                                <div className="mt-0.5 text-slate-800">{layer.thicknessMicron != null ? `${layer.thicknessMicron}u` : "—"}</div>
                                                            </div>
                                                            <div className="rounded-lg border border-white bg-white px-2.5 py-2">
                                                                <div className="text-[9px] font-black uppercase tracking-wider text-slate-400">Layer width</div>
                                                                <div className="mt-0.5 text-slate-800">{layer.widthMm != null ? `${layer.widthMm} mm` : "—"}</div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            )) : (
                                                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs font-semibold text-slate-400">No layer details captured for this sales product.</div>
                                            )}
                                        </div>
                                    </div>
                                </section>

                                {activeMainTab === "running" ? (
                                    <section className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5 shadow-sm">
                                        <div className="flex flex-wrap items-start justify-between gap-4">
                                            <div>
                                                <div className="text-[11px] uppercase tracking-wider text-emerald-700">Sent to machine</div>
                                                <div className="mt-1 text-lg font-semibold text-slate-950">{assignedMachineName || selectedMachine?.name || "Machine assigned"}</div>
                                                <p className="mt-1 text-xs font-semibold text-emerald-800">Preparation is locked. Execution changes now happen only inside the machine terminal.</p>
                                            </div>
                                            <a
                                                href={assignedMachineId ? `/production/machine/${assignedMachineId}` : "#"}
                                                onClick={(event) => { if (!assignedMachineId) event.preventDefault() }}
                                                className={cn("inline-flex h-10 items-center rounded-xl px-4 text-sm font-semibold", assignedMachineId ? "bg-blue-600 text-white hover:bg-blue-700" : "bg-slate-100 text-slate-400")}
                                            >
                                                Open terminal
                                            </a>
                                        </div>
                                        <div className="mt-4 grid gap-3 md:grid-cols-3">
                                            <div className="rounded-xl border border-white bg-white/80 p-3">
                                                <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">Machine</div>
                                                <div className="mt-1 text-sm font-semibold text-slate-950">{assignedMachineName || selectedMachine?.name || "—"}</div>
                                            </div>
                                            <div className="rounded-xl border border-white bg-white/80 p-3">
                                                <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">Rolls locked</div>
                                                <div className="mt-1 text-sm font-semibold text-slate-950">{effectiveRollsReserved}/{rollsRequired} allocated</div>
                                            </div>
                                            <div className="rounded-xl border border-white bg-white/80 p-3">
                                                <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">Material policy</div>
                                                <div className="mt-1 text-sm font-semibold text-slate-950">
                                                    {currentStepPolicyItems.length ? `${currentStepPolicyItems.length} step rule${currentStepPolicyItems.length === 1 ? "" : "s"}` : "No step issue rule"}
                                                </div>
                                            </div>
                                        </div>
                                        {currentStepPolicyItems.length ? (
                                            <div className="mt-4 space-y-2">
                                                {currentStepPolicyItems.map((item) => (
                                                    <div key={`running-policy-${item.policy_key}`} className="rounded-xl border border-white bg-white/80 px-3 py-2 text-xs">
                                                        <div className="font-semibold text-slate-950">{item.material_name}</div>
                                                        <div className="mt-0.5 text-slate-500">
                                                            Template {policyModeLabel(item.template_issue_policy_mode, item.template_issue_policy_value)} · Effective {policyModeLabel(item.effective_issue_policy_mode, item.effective_issue_policy_value)}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : null}
                                    </section>
                                ) : (
                                <>
                                {satisfactionStatus?.input_form === "ROLL" ? (
                                    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                        <div className="flex flex-wrap items-start justify-between gap-3">
                                            <div>
                                                <div className="text-[11px] uppercase tracking-wider text-slate-500">Roll allocation</div>
                                                <div className="mt-1 text-lg font-semibold text-slate-950">{rollBehaviorLabel}</div>
                                                <p className="mt-1 text-xs font-medium text-slate-500">{rollGuidanceText}</p>
                                            </div>
                                            <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", rollOk ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700")}>
                                                {effectiveRollsReserved}/{rollsRequired} allocated
                                            </span>
                                        </div>
                                        <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                                            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                                                <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">Required</div>
                                                <div className="mt-1 text-lg font-semibold text-slate-950">{rollsRequired}</div>
                                            </div>
                                            <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2">
                                                <div className="text-[10px] font-black uppercase tracking-wider text-blue-600">Reserved</div>
                                                <div className="mt-1 text-lg font-semibold text-blue-950">{effectiveRollsReserved}</div>
                                            </div>
                                            <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2">
                                                <div className="text-[10px] font-black uppercase tracking-wider text-emerald-700">Lineage</div>
                                                <div className="mt-1 text-lg font-semibold text-emerald-950">{lineageRollsAvailable}</div>
                                            </div>
                                            <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2">
                                                <div className="text-[10px] font-black uppercase tracking-wider text-amber-700">Fallback</div>
                                                <div className="mt-1 text-lg font-semibold text-amber-950">{fallbackRollsAvailable}</div>
                                            </div>
                                        </div>
                                        {showRollGuidance ? (
                                            <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                                                Assign {rollsMissing} more roll{rollsMissing === 1 ? "" : "s"} before release.
                                            </div>
                                        ) : (
                                            <div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
                                                Roll requirement is covered for this current step.
                                            </div>
                                        )}
                                        <div className="mt-4 flex flex-wrap items-center gap-2">
                                            {selectedJobId && showRollAllocator ? (
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    className="border-indigo-300 bg-indigo-50 text-indigo-800 hover:bg-indigo-100"
                                                    onClick={() => setTieredPickerOpen(true)}
                                                >
                                                    <Scissors className="mr-1.5 h-3.5 w-3.5" /> Pick with tiers
                                                </Button>
                                            ) : null}
                                            {showRollAllocator ? (
                                                <RollAssignmentModal
                                                    activeAssignment={activeAssignment}
                                                    targetSpec={targetSpec}
                                                    targetSpecs={targetRollSpecs}
                                                    rollBehavior={rollBehavior}
                                                    targetPlantId={selectedTargetPlantId}
                                                    targetPlantName={selectedTargetPlantName}
                                                    targetLocationId={
                                                        (executionContext as any)?.job?.from_location_id ||
                                                        (selectedJob as any)?.from_location_id ||
                                                        (selectedJob as any)?.from_location
                                                    }
                                                    targetLocationName={
                                                        (executionContext as any)?.job?.from_location_name ||
                                                        (selectedJob as any)?.from_location_name ||
                                                        (selectedJob as any)?.from_location_display
                                                    }
                                                    manualEligibleRolls={rollAllocationCandidates}
                                                    wipPoolMeta={(executionContext as any)?.wip_pool_meta || {}}
                                                    rollAssignmentValidation={rollAssignmentValidation}
                                                    strictSpecMatch={!manualOverrideEnabled}
                                                    disabled={isReleasedToMachine || !canManualAssign}
                                                    disabledLabel={isReleasedToMachine ? "LOCKED" : "ROLLS ASSIGNED"}
                                                    required={rollsRequired}
                                                    manualOverride={manualOverrideEnabled}
                                                    overrideReason={overrideReason}
                                                    onAssigned={() => {
                                                        refetchContext()
                                                        refetchSatisfaction()
                                                        queryClient.invalidateQueries({ queryKey: ["wip-pool-grouped", selectedJobId] })
                                                    }}
                                                />
                                            ) : null}
                                            {showRollTransfer ? (
                                                <RollTransferModal
                                                    targetSpec={targetSpec}
                                                    targetSpecs={targetRollSpecs}
                                                    rollBehavior={rollBehavior}
                                                    targetPlantId={selectedTargetPlantId}
                                                    targetPlantName={selectedTargetPlantName}
                                                    targetLocationId={
                                                        (executionContext as any)?.job?.from_location_id ||
                                                        (selectedJob as any)?.from_location_id ||
                                                        (selectedJob as any)?.from_location
                                                    }
                                                    targetLocationName={
                                                        (executionContext as any)?.job?.from_location_name ||
                                                        (selectedJob as any)?.from_location_name ||
                                                        (selectedJob as any)?.from_location_display
                                                    }
                                                    onRequested={() => {
                                                        refetchContext()
                                                        refetchSatisfaction()
                                                    }}
                                                />
                                            ) : null}
                                            {showRollGuidance ? (
                                                <label className={cn("inline-flex h-8 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs font-semibold text-slate-700", isReleasedToMachine && "opacity-60")}>
                                                    <Checkbox
                                                        checked={manualOverrideEnabled}
                                                        disabled={isReleasedToMachine}
                                                        onCheckedChange={(checked) => {
                                                            const enabled = Boolean(checked)
                                                            setManualOverrideEnabled(enabled)
                                                            if (!enabled) setOverrideReason("")
                                                        }}
                                                    />
                                                    Policy override
                                                </label>
                                            ) : null}
                                        </div>
                                        {manualOverrideEnabled && showRollGuidance ? (
                                            <Input
                                                value={overrideReason}
                                                disabled={isReleasedToMachine}
                                                onChange={(event) => setOverrideReason(event.target.value)}
                                                placeholder="Reason required for roll policy override"
                                                className="mt-3 h-9 rounded-xl border-slate-200 bg-slate-50 text-xs font-semibold"
                                            />
                                        ) : null}
                                        <div className="mt-4 grid gap-3 lg:grid-cols-2">
                                            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                                <div className="mb-2 flex items-center justify-between">
                                                    <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">Allocated now</div>
                                                    <span className="text-[11px] font-semibold text-slate-500">{assignedRollsForDisplay.length} rolls</span>
                                                </div>
                                                <div className="space-y-2">
                                                    {assignedRollsForDisplay.length ? assignedRollsForDisplay.map((roll: any) => (
                                                        <div key={roll.id} className="flex items-center gap-2 rounded-lg border border-white bg-white px-2.5 py-2">
                                                            <div className="min-w-0 flex-1">
                                                                <div className="truncate text-xs font-semibold text-slate-950">{roll.label_id}</div>
                                                                <div className="truncate text-[11px] font-medium text-slate-500">{roll.material_name} · {roll.width_mm ? `${roll.width_mm}mm` : "—"} · {Number(roll.weight_kg || 0).toFixed(3)} kg</div>
                                                            </div>
                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="icon"
                                                                disabled={isReleasedToMachine || mutation.isPending}
                                                                className="h-8 w-8 rounded-lg text-slate-400 hover:text-rose-600"
                                                                data-testid={roll.reservation_id ? `wcm-unassign-roll-${String(roll.reservation_id)}` : `wcm-unassign-roll-by-roll-${String(roll.id)}`}
                                                                onClick={() => roll.reservation_id ? handleUnassignRoll(roll.reservation_id) : handleUnassignRollByRoll(roll.id)}
                                                            >
                                                                <Trash2 className="h-4 w-4" />
                                                            </Button>
                                                        </div>
                                                    )) : (
                                                        <div className="rounded-lg border border-dashed border-slate-200 bg-white px-3 py-4 text-center text-xs font-semibold text-slate-400">No roll allocated for this step yet.</div>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                                <div className="mb-2 flex items-center justify-between">
                                                    <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">Available choices</div>
                                                    <span className="text-[11px] font-semibold text-slate-500">{rollAllocationCandidates.length} candidates</span>
                                                </div>
                                                <div className="space-y-2">
                                                    {rollAllocationCandidates.slice(0, 4).map((roll: any) => (
                                                        <div key={String(roll.id || roll.label_id)} className="rounded-lg border border-white bg-white px-2.5 py-2">
                                                            <div className="text-xs font-semibold text-slate-950">{roll.label_id || "Roll"}</div>
                                                            <div className="text-[11px] font-medium text-slate-500">{roll.material_name || roll.material_code || "Material"} · {roll.thickness_micron ? `${roll.thickness_micron}u` : "—"} · {roll.width_mm ? `${roll.width_mm}mm` : "—"}</div>
                                                        </div>
                                                    ))}
                                                    {!rollAllocationCandidates.length ? (
                                                        <div className="rounded-lg border border-dashed border-slate-200 bg-white px-3 py-4 text-center text-xs font-semibold text-slate-400">No compatible roll in the current pool.</div>
                                                    ) : null}
                                                </div>
                                            </div>
                                        </div>
                                    </section>
                                ) : null}

                                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                    <div className="flex items-center justify-between gap-3">
                                        <div>
                                            <div className="text-[11px] uppercase tracking-wider text-slate-500">Machine assignment</div>
                                            <div className="text-lg font-semibold text-slate-950">{selectedMachine?.name || "Select production line"}</div>
                                        </div>
                                        <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", canPushToOperator ? "bg-emerald-50 text-emerald-700" : selectedMachineId ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600")}>{machineGateLabel}</span>
                                    </div>
                                    <div className={cn("mt-3 rounded-xl border px-3 py-2 text-xs font-semibold", canPushToOperator ? "border-emerald-100 bg-emerald-50 text-emerald-800" : selectedMachineId ? "border-amber-100 bg-amber-50 text-amber-800" : "border-slate-200 bg-slate-50 text-slate-600")}>
                                        {machineGateHelp}
                                    </div>
                                    <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
                                        <Select value={selectedMachineId} onValueChange={setSelectedMachineId} disabled={isReleasedToMachine || mutation.isPending}>
                                            <SelectTrigger data-testid="wcm-machine-select" className="h-11 rounded-xl border-slate-200 bg-slate-50">
                                                <SelectValue placeholder="Select machine..." />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {machineOptionsResolved.map((machine: any) => (
                                                    <SelectItem key={machine.id} value={machine.id}>{machine.name}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <Button
                                            type="button"
                                            data-testid="wcm-assign-release"
                                            className="h-11 rounded-xl bg-slate-900 px-5 font-semibold text-white hover:bg-slate-800"
                                            disabled={isReleasedToMachine || !activeAssignment || !selectedMachineId || mutation.isPending}
                                            onClick={handleAssignAndMaybeRelease}
                                        >
                                            {isReleasedToMachine ? "Execution ready" : canPushToOperator ? "Assign + release" : selectedMachineId ? "Save machine" : "Assign machine"}
                                        </Button>
                                    </div>
                                </section>

                                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <div className="text-[11px] uppercase tracking-wider text-slate-500">Material release</div>
                                            <div className="text-lg font-semibold text-slate-950">Current-step issue</div>
                                            <p className="mt-1 text-xs font-medium text-slate-500">Issue input material only. Returns, scrap, and variance stay on machine output.</p>
                                        </div>
                                        <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", materialIssueErrors.length ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700")}>{materialReleaseLabel}</span>
                                    </div>
                                    {currentStepPolicyItems.length ? (
                                        <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50/80 p-3">
                                            <div className="flex flex-wrap items-start justify-between gap-3">
                                                <div>
                                                    <div className="text-[10px] font-black uppercase tracking-wider text-blue-700">Template policy and WCM override</div>
                                                    <p className="mt-1 text-xs font-semibold text-blue-900">Template issue rules are shown first. Change only the row that needs a real shop-floor issue exception.</p>
                                                </div>
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    className="h-9 rounded-xl bg-blue-600 px-3 text-xs font-semibold hover:bg-blue-700"
                                                    disabled={isReleasedToMachine || stepPolicyMutation.isPending || !selectedJobId || !hasEditableCurrentStepPolicy || !hasStepPolicyChangeIntent}
                                                    onClick={() => stepPolicyMutation.mutate()}
                                                >
                                                    {stepPolicyMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                                    Save override
                                                </Button>
                                            </div>
                                            <div className={cn("mt-3 space-y-2.5", isReleasedToMachine && "pointer-events-none opacity-75")}>
                                                {currentStepPolicyItems.map((item) => {
                                                    const draft = stepPolicyDrafts[item.policy_key] || {
                                                        issue_policy_mode: "NONE" as const,
                                                        issue_policy_value: 0,
                                                        reason: "",
                                                    }
                                                    const source = String(item.policy_source || "TEMPLATE_DEFAULT").replaceAll("_", " ")
                                                    const overrideActive = Boolean(activeStepPolicyOverrides[item.policy_key])
                                                    return (
                                                        <div key={`issue-policy-${item.policy_key}`} className="rounded-xl border border-blue-100 bg-white p-3">
                                                            <div className="flex flex-wrap items-start justify-between gap-3">
                                                                <div>
                                                                    <div className="text-sm font-black text-slate-950">{item.material_name}</div>
                                                                    <div className="mt-0.5 text-[11px] font-semibold text-slate-500">
                                                                        {item.category_code || "Material"} · Theory {Number(item.theoretical_qty || 0).toFixed(3)} kg · Issue plan {Number(item.planned_issue_qty || 0).toFixed(3)} kg
                                                                    </div>
                                                                </div>
                                                                <span className={cn(
                                                                    "rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wider",
                                                                    source.includes("OVERRIDE") ? "border-amber-200 bg-amber-50 text-amber-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"
                                                                )}>
                                                                    {source}
                                                                </span>
                                                                <Button
                                                                    type="button"
                                                                    size="sm"
                                                                    variant={overrideActive ? "outline" : "default"}
                                                                    disabled={isReleasedToMachine || stepPolicyMutation.isPending}
                                                                    className={cn("h-8 rounded-lg px-3 text-xs font-semibold", overrideActive ? "border-slate-200 bg-white text-slate-700" : "bg-slate-900 text-white hover:bg-slate-800")}
                                                                    onClick={() => {
                                                                        if (overrideActive) {
                                                                            setActiveStepPolicyOverrides((prev) => ({ ...prev, [item.policy_key]: false }))
                                                                            setStepPolicyDrafts((prev) => ({
                                                                                ...prev,
                                                                                [item.policy_key]: { issue_policy_mode: "NONE", issue_policy_value: 0, reason: "" },
                                                                            }))
                                                                            return
                                                                        }
                                                                        setActiveStepPolicyOverrides((prev) => ({ ...prev, [item.policy_key]: true }))
                                                                        setStepPolicyDrafts((prev) => ({
                                                                            ...prev,
                                                                            [item.policy_key]: {
                                                                                issue_policy_mode: String(item.effective_issue_policy_mode || item.template_issue_policy_mode || "NONE").toUpperCase() as StepPolicyDraft["issue_policy_mode"],
                                                                                issue_policy_value: Number(item.effective_issue_policy_value ?? item.template_issue_policy_value ?? 0),
                                                                                reason: String(item.override_reason || ""),
                                                                            },
                                                                        }))
                                                                    }}
                                                                >
                                                                    {overrideActive ? "Use template" : "Override"}
                                                                </Button>
                                                            </div>
                                                            <div className="mt-3 grid gap-2 lg:grid-cols-[1fr_1fr_132px_1fr]">
                                                                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                                                                    <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">Template rule</div>
                                                                    <div className="mt-1 text-xs font-bold text-slate-900">{policyModeLabel(item.template_issue_policy_mode, item.template_issue_policy_value)}</div>
                                                                </div>
                                                                <Select
                                                                    value={draft.issue_policy_mode}
                                                                    disabled={isReleasedToMachine || !overrideActive}
                                                                    onValueChange={(value) =>
                                                                        setStepPolicyDrafts((prev) => ({
                                                                            ...prev,
                                                                            [item.policy_key]: {
                                                                                ...draft,
                                                                                issue_policy_mode: value as StepPolicyDraft["issue_policy_mode"],
                                                                            },
                                                                        }))
                                                                    }
                                                                >
                                                                    <SelectTrigger className="h-10 rounded-lg border-slate-200 bg-white text-xs font-semibold">
                                                                        <SelectValue />
                                                                    </SelectTrigger>
                                                                    <SelectContent>
                                                                        <SelectItem value="NONE">Use template policy</SelectItem>
                                                                        <SelectItem value="PERCENT_OVER_THEORY">% over theory</SelectItem>
                                                                        <SelectItem value="FIXED_EXTRA_KG">Fixed extra kg</SelectItem>
                                                                        <SelectItem value="MINIMUM_ISSUE_KG">Minimum issue kg</SelectItem>
                                                                    </SelectContent>
                                                                </Select>
                                                                <Input
                                                                    type="number"
                                                                    disabled={isReleasedToMachine || !overrideActive || draft.issue_policy_mode === "NONE"}
                                                                    className="h-10 rounded-lg border-slate-200 bg-white text-right text-xs font-semibold"
                                                                    value={String(draft.issue_policy_value ?? 0)}
                                                                    onChange={(event) =>
                                                                        setStepPolicyDrafts((prev) => ({
                                                                            ...prev,
                                                                            [item.policy_key]: {
                                                                                ...draft,
                                                                                issue_policy_value: Number(event.target.value || 0),
                                                                            },
                                                                        }))
                                                                    }
                                                                />
                                                                <Input
                                                                    disabled={isReleasedToMachine || !overrideActive || draft.issue_policy_mode === "NONE"}
                                                                    className="h-10 rounded-lg border-slate-200 bg-white text-xs font-semibold"
                                                                    placeholder="Reason for override"
                                                                    value={draft.reason}
                                                                    onChange={(event) =>
                                                                        setStepPolicyDrafts((prev) => ({
                                                                            ...prev,
                                                                            [item.policy_key]: {
                                                                                ...draft,
                                                                                reason: event.target.value,
                                                                            },
                                                                        }))
                                                                    }
                                                                />
                                                            </div>
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        </div>
                                    ) : null}
                                    <div className={cn("mt-4 space-y-2.5", isReleasedToMachine && "pointer-events-none opacity-75")}>
                                        {materialIssueRows.length === 0 ? (
                                            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm font-medium text-slate-600">No current-step material issue is needed for this step.</div>
                                        ) : materialIssueRows.map((row: any, index: number) => {
                                            const requirementId = String(row?.requirement_id || "")
                                            const issueTarget = materialIssueTargetKg(row)
                                            const availableKg = materialIssueAvailableKg(row)
                                            const materialName = String(row?.material_name || row?.category_display || row?.category || "Material")
                                            const draft = materialIssueDrafts[requirementId] || {
                                                material_id: String(row?.material_id || ""),
                                                actual_issued_qty: issueTarget > 0 ? issueTarget.toFixed(3) : "",
                                                actual_returned_qty: "0",
                                                actual_scrap_qty: "0",
                                                is_estimated: true,
                                                granule_code_allocations: [],
                                            }
                                            const codeOptions = Array.isArray(row?.granule_code_options) ? row.granule_code_options : []
                                            const isGranule = materialIssueKind(row) === "GRANULE"
                                            const allocations = draft.granule_code_allocations && draft.granule_code_allocations.length
                                                ? draft.granule_code_allocations
                                                : (isGranule && codeOptions.length
                                                    ? [{ granule_code_id: String(codeOptions[0]?.granule_code_id || ""), qty_kg: issueTarget > 0 ? issueTarget.toFixed(3) : "" }]
                                                    : [])
                                            const issuedKg = Number(draft.actual_issued_qty || 0)
                                            const allocatedKg = allocations.reduce((sum, item) => sum + Number(item.qty_kg || 0), 0)
                                            const splitOk = !isGranule || issuedKg <= 0 || Math.abs(allocatedKg - issuedKg) <= 0.0001
                                            const rowErrors = materialIssueErrors.filter((error) => error.startsWith(`${materialName}:`))
                                            return (
                                                <div key={requirementId || index} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                                                    <div className="grid gap-3 md:grid-cols-[1fr_122px] md:items-start">
                                                        <div>
                                                            <div className="flex flex-wrap items-center gap-2">
                                                                <div className="font-semibold text-slate-950">{materialName}</div>
                                                                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider", isGranule ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-blue-700")}>{materialIssueKindLabel(row)}</span>
                                                            </div>
                                                            <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] font-semibold text-slate-500">
                                                                <span>Need {issueTarget > 0 ? `${issueTarget.toFixed(3)} kg` : "not planned"}</span>
                                                                <span>·</span>
                                                                <span>Stock {availableKg.toFixed(3)} kg</span>
                                                                {row?.location_name ? <><span>·</span><span>{row.location_name}</span></> : null}
                                                            </div>
                                                        </div>
                                                        <label className="block">
                                                            <span className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Issued kg</span>
                                                            <Input
                                                                value={draft.actual_issued_qty}
                                                                onChange={(event) => updateMaterialIssueDraft(requirementId, { actual_issued_qty: event.target.value, actual_returned_qty: "0", actual_scrap_qty: "0", is_estimated: false })}
                                                                className="h-10 rounded-xl border-slate-200 bg-white text-right font-semibold"
                                                                placeholder="0.000"
                                                            />
                                                        </label>
                                                    </div>
                                                    {isGranule ? (
                                                        <div className="mt-3 rounded-xl border border-emerald-100 bg-white p-2.5">
                                                            <div className="mb-2 flex items-center justify-between gap-2">
                                                                <div className="text-[11px] font-semibold text-emerald-800">
                                                                    Code split {allocatedKg.toFixed(3)} / {Math.max(0, issuedKg).toFixed(3)} kg
                                                                </div>
                                                                <Button
                                                                    type="button"
                                                                    variant="outline"
                                                                    size="sm"
                                                                    className="h-8 rounded-lg border-emerald-200 px-2.5 text-xs font-semibold"
                                                                    disabled={!requirementId || codeOptions.length === 0}
                                                                    onClick={() => updateMaterialIssueDraft(requirementId, {
                                                                        granule_code_allocations: [...allocations, { granule_code_id: String(codeOptions[0]?.granule_code_id || ""), qty_kg: "" }],
                                                                        is_estimated: false,
                                                                    })}
                                                                >
                                                                    Add code
                                                                </Button>
                                                            </div>
                                                            {codeOptions.length === 0 ? (
                                                                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">No coded stock is available for this granule at the issue location.</div>
                                                            ) : (
                                                                <div className="space-y-2">
                                                                    {allocations.map((allocation, allocationIndex) => (
                                                                        <div key={`${requirementId}-${allocationIndex}`} className="grid gap-2 md:grid-cols-[minmax(0,1fr)_112px_34px]">
                                                                            <Select
                                                                                value={allocation.granule_code_id || String(codeOptions[0]?.granule_code_id || "")}
                                                                                onValueChange={(value) => updateMaterialIssueDraft(requirementId, {
                                                                                    granule_code_allocations: allocations.map((item, rowIndex) => rowIndex === allocationIndex ? { ...item, granule_code_id: value } : item),
                                                                                    is_estimated: false,
                                                                                })}
                                                                            >
                                                                                <SelectTrigger className="h-9 rounded-lg border-slate-200 bg-white text-xs font-semibold">
                                                                                    <SelectValue placeholder="Code" />
                                                                                </SelectTrigger>
                                                                                <SelectContent>
                                                                                    {codeOptions.map((option: any) => (
                                                                                        <SelectItem key={option.granule_code_id} value={String(option.granule_code_id)}>
                                                                                            {option.code} · {Number(option.available_qty_kg || 0).toFixed(3)} kg
                                                                                        </SelectItem>
                                                                                    ))}
                                                                                </SelectContent>
                                                                            </Select>
                                                                            <Input
                                                                                value={allocation.qty_kg}
                                                                                onChange={(event) => updateMaterialIssueDraft(requirementId, {
                                                                                    granule_code_allocations: allocations.map((item, rowIndex) => rowIndex === allocationIndex ? { ...item, qty_kg: event.target.value } : item),
                                                                                    is_estimated: false,
                                                                                })}
                                                                                placeholder="kg"
                                                                                className="h-9 rounded-lg border-slate-200 bg-white text-right text-xs font-semibold"
                                                                            />
                                                                            <Button
                                                                                type="button"
                                                                                variant="ghost"
                                                                                size="icon"
                                                                                className="h-9 w-9 rounded-lg text-slate-400 hover:text-rose-600"
                                                                                disabled={allocations.length <= 1}
                                                                                onClick={() => updateMaterialIssueDraft(requirementId, {
                                                                                    granule_code_allocations: allocations.filter((_, rowIndex) => rowIndex !== allocationIndex),
                                                                                    is_estimated: false,
                                                                                })}
                                                                            >
                                                                                <Trash2 className="h-4 w-4" />
                                                                            </Button>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                            <div className={cn("mt-2 text-[11px] font-semibold", splitOk ? "text-emerald-700" : "text-rose-700")}>
                                                                {splitOk ? "Code split matches issued kg." : "Code split must equal issued kg before release."}
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className="mt-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600">No code split for this input. Enter issued kg only.</div>
                                                    )}
                                                    {rowErrors.length ? (
                                                        <div className="mt-2 rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{rowErrors.map((error) => error.replace(`${materialName}: `, "")).join(" · ")}</div>
                                                    ) : null}
                                                </div>
                                            )
                                        })}
                                    </div>
                                </section>

                                </>
                                )}
                            </div>
                        </aside> : null}
                    </section>
                </main>
                <Dialog open={Boolean(closeJobAction)} onOpenChange={(open) => { if (!open) { setCloseJobAction(null); setCloseJobReason("") } }}>
                    <DialogContent className="rounded-2xl">
                        <DialogHeader>
                            <DialogTitle>{closeJobAction?.mode === "CANCEL" ? "Cancel job" : "Short close step"}</DialogTitle>
                            <DialogDescription>
                                This writes an audit reason to the production job and removes it from the active WCM queue.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-3">
                            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                                <div className="font-semibold text-slate-900">{closeJobAction?.assignment?.job_details?.customer_name || "Selected job"}</div>
                                <div className="text-slate-500">{closeJobAction?.assignment?.job_details?.product_name || closeJobAction?.assignment?.job_details?.template_name || "Production job"}</div>
                            </div>
                            <Textarea
                                value={closeJobReason}
                                onChange={(event) => setCloseJobReason(event.target.value)}
                                placeholder="Reason required for audit history"
                                className="min-h-24 rounded-xl"
                            />
                            <div className="flex justify-end gap-2">
                                <Button type="button" variant="outline" className="rounded-xl" onClick={() => { setCloseJobAction(null); setCloseJobReason("") }}>Cancel</Button>
                                <Button type="button" className={cn("rounded-xl", closeJobAction?.mode === "CANCEL" ? "bg-rose-600 hover:bg-rose-700" : "bg-slate-900 hover:bg-slate-800")} disabled={closeJobReason.trim().length < 5 || mutation.isPending} onClick={handleCloseJobAction}>
                                    {mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                    Confirm
                                </Button>
                            </div>
                        </div>
                    </DialogContent>
                </Dialog>
            </div>
        )
    }

    return (
            <div className="space-y-6 bg-slate-50" data-testid="wcm-terminal-page">
            {/* HEADER */}
            <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">
                        Work Center Terminal - {workCenter?.name || (activeAssignment as any)?.work_center_name || wcId}
                        {workCenter?.code ? <span className="ml-2 text-sm font-semibold text-slate-500">({workCenter.code})</span> : null}
                    </h1>
                    <p className="text-slate-500">Pick a job, check the step, assign the machine, then release it to machine execution.</p>
                </div>
                <div className="flex flex-wrap gap-3">
                    <SemanticBadge kind="jobState" value="RUNNING" label={`Running ${stats.running}`} className="text-sm px-4 py-2" />
                    <SemanticBadge kind="jobState" value="WC_READY" label={`Waiting ${stats.waiting}`} className="text-sm px-4 py-2" />
                </div>
            </div>
            <div className="flex min-h-0 flex-col gap-6">
                <Tabs value={activeMainTab} onValueChange={(v: any) => setActiveMainTab(v)} className="w-full">
                    <TabsList className="bg-white border p-1 h-12 rounded-xl shadow-sm">
                        <TabsTrigger value="terminal" className="px-8 font-black uppercase tracking-wider data-[state=active]:bg-blue-600 data-[state=active]:text-white transition-all">
                            Run Step
                        </TabsTrigger>
                        {isManager && (
                            <TabsTrigger value="history" className="px-8 font-black uppercase tracking-wider data-[state=active]:bg-blue-600 data-[state=active]:text-white transition-all">
                                Past Jobs
                            </TabsTrigger>
                        )}
                    </TabsList>

                    <TabsContent value="terminal" className="mt-6">
                        <Card className="border-slate-200 bg-white">
                            <CardContent className="grid gap-3 p-4 md:grid-cols-4">
                                {[
                                    "1. Pick the job from the left queue.",
                                    "2. Check step requirements and material rule.",
                                    "3. Assign roll and machine if needed.",
                                    "4. Release the job to machine execution when ready.",
                                ].map((step) => (
                                    <div key={step} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">
                                        {step}
                                    </div>
                                ))}
                            </CardContent>
                        </Card>
                        <Card className="border-blue-100 bg-blue-50/70 shadow-sm">
                            <CardContent className="grid gap-3 p-4 md:grid-cols-[1.5fr_1fr_1fr]">
                                <div className="rounded-2xl border border-blue-200 bg-white px-4 py-3">
                                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-700">Next action now</div>
                                    <div className="mt-2 text-lg font-black text-slate-900">{wcmNextAction}</div>
                                    <div className="mt-1 text-sm text-slate-600">{wcmStatusSummary}</div>
                                </div>
                                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Step status</div>
                                    <div className="mt-2"><SemanticBadge kind="jobState" value={requirementsSatisfied ? "READY" : "BLOCKED"} label={requirementsSatisfied ? "Ready" : "Needs action"} className="text-xs px-3 py-1.5" /></div>
                                    <div className="mt-2 text-xs text-slate-500">Current step {currentStepNumber || "—"}</div>
                                </div>
                                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Machine</div>
                                    <div className="mt-2"><SemanticBadge kind="jobState" value={selectedMachineId ? "ASSIGNED" : "PENDING"} label={selectedMachineId ? "Machine set" : "Machine needed"} className="text-xs px-3 py-1.5" /></div>
                                    <div className="mt-2 text-xs text-slate-500">{selectedMachineId ? "This step can move forward once all checks stay green." : "Pick the production line before handoff."}</div>
                                </div>
                            </CardContent>
                        </Card>
                        <div className="grid gap-6 xl:grid-cols-12 xl:min-h-[680px]">
                            {/* COLUMN 1: SCHEDULED QUEUE */}
                            <Card className="flex max-h-[60vh] flex-col overflow-hidden border border-slate-200 bg-white shadow-sm xl:col-span-3 xl:max-h-none xl:h-full">
                                <CardHeader className="bg-white py-3 shrink-0 border-b border-slate-100">
                                    <CardTitle className="flex items-center justify-between text-xs font-semibold text-slate-600 uppercase tracking-wider">
                                        <span>Queue</span>
                                        <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] text-slate-500">{visibleQueueAssignments.length}/{baseQueueAssignments.length}</span>
                                    </CardTitle>
                                    <div className="mt-3 space-y-2">
                                        <div className="relative">
                                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                            <Input
                                                value={queueSearch}
                                                onChange={(event) => setQueueSearch(event.target.value)}
                                                placeholder="Search customer, size, variant, POD"
                                                className="h-10 rounded-xl border-slate-200 bg-slate-50 pl-9 text-xs font-semibold"
                                            />
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                            {([
                                                ["ALL", "All"],
                                                ["READY", "Ready"],
                                                ["ASSIGNED", "Assigned"],
                                                ["NEEDS_MACHINE", "No machine"],
                                            ] as const).map(([value, label]) => (
                                                <Button
                                                    key={value}
                                                    type="button"
                                                    variant={queueStatusFilter === value ? "default" : "outline"}
                                                    size="sm"
                                                    className="h-8 rounded-lg text-[10px] font-black uppercase tracking-wide"
                                                    onClick={() => setQueueStatusFilter(value)}
                                                >
                                                    {label}
                                                </Button>
                                            ))}
                                        </div>
                                    </div>
                                </CardHeader>
                                <CardContent className="flex-1 overflow-y-auto p-2 space-y-2 bg-slate-50/50">
                                    {visibleQueueAssignments.map((assignment: any) => {
                                        const hasRollAllocations =
                                            (Array.isArray((assignment as any)?.allocated_roll_details) && (assignment as any).allocated_roll_details.length > 0) ||
                                            (Array.isArray((assignment as any)?.allocated_rolls) && (assignment as any).allocated_rolls.length > 0)
                                        const displayStatus = (assignment.job_details?.input_form === "ROLL" && assignment.status === "ASSIGNED" && !hasRollAllocations)
                                            ? "WC_READY"
                                            : assignment.status
                                        const queueQty = Number(assignment.job_details?.quantity || 0)
                                        const queueUom = String(assignment.job_details?.uom || "").toUpperCase()
                                        const queueUnitWeightG = Number(assignment.job_details?.unit_weight_g || 0)
                                        const queueTotalRawKg = Number(
                                            assignment.job_details?.order_reference_target_kg ??
                                            assignment.job_details?.step_adjusted_total_kg ??
                                            assignment.job_details?.total_weight_kg ??
                                            (queueUom === "KG"
                                                ? queueQty
                                                : (queueUom === "PCS" && queueUnitWeightG > 0 ? (queueQty * queueUnitWeightG) / 1000 : 0))
                                        )
                                        const queueStepTargetKg = Number(
                                            assignment.job_details?.step_target_kg ??
                                            queueTotalRawKg
                                        )
                                        const queueTotalKg = Math.max(
                                            Number(assignment.job_details?.order_reference_target_kg ?? 0),
                                            queueTotalRawKg,
                                            queueStepTargetKg
                                        )
                                        const queueOutputForm = String(assignment.job_details?.output_form || "").toUpperCase()
                                        const queuePcs = (queueUom === "PCS" && queueOutputForm === "BULK") ? queueQty : null
                                        const queuePrimaryUom = String(
                                            assignment.job_details?.primary_uom ||
                                            ((queueUom === "PCS" && queueOutputForm === "BULK" && String(assignment.job_details?.input_form || "").toUpperCase() === "ROLL")
                                                ? "PCS"
                                                : "KG")
                                        ).toUpperCase() as "KG" | "PCS"
                                        const queuePrimaryTarget = toNullableNumber(assignment.job_details?.step_target_primary) ?? (
                                            queuePrimaryUom === "PCS" ? queuePcs : queueStepTargetKg
                                        )
                                        const queueJob = assignment.job_details || {}
                                        const queueGeometry = geometryFromJob(queueJob)
                                        const queueLayers = layerHighlightsFromJob(queueJob)
                                        const queuePod = podLabelFromJob(queueJob)
                                        return (
                                            <div
                                                key={assignment.id}
                                                onClick={() => {
                                                    setActiveAssignmentId(assignment.id)
                                                }}
                                                data-testid={`wcm-assignment-row-${assignment.id}`}
                                                className={cn(
                                                    "p-3 rounded-xl border cursor-pointer transition-all hover:shadow-md",
                                                    activeAssignmentId === assignment.id
                                                        ? "bg-white border-blue-500 shadow-blue-100 ring-1 ring-blue-500"
                                                        : "bg-white border-slate-200 hover:border-blue-300"
                                                )}
                                            >
                                                <div className="flex justify-between items-start gap-2">
                                                    <div className="min-w-0">
                                                        <p className="truncate text-sm font-black text-slate-900">{assignment.job_details?.customer_name || "—"}</p>
                                                        <p className="mt-0.5 line-clamp-2 text-xs font-semibold text-slate-600">{productNameFromJob(queueJob)}</p>
                                                    </div>
                                                    <SemanticBadge kind="jobState" value={displayStatus} label={displayStatus === "WC_READY" ? "Ready" : displayStatus} className="text-[10px] h-auto px-2 py-1" />
                                                </div>
                                                <div className="mt-3 space-y-2 text-[11px] text-slate-600">
                                                    <p className="rounded-lg bg-slate-50 px-2 py-1 font-black text-slate-900">
                                                        {queueGeometry.label}
                                                    </p>
                                                    {queueLayers.length > 0 && (
                                                        <div className="flex flex-wrap gap-1">
                                                            {queueLayers.slice(0, 2).map((layer: string, index: number) => (
                                                                <span key={`${assignment.id}-layer-${index}`} className="rounded-md bg-blue-50 px-2 py-1 text-[9px] font-black uppercase text-blue-700">
                                                                    {layer}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    )}
                                                    <div className="flex flex-wrap gap-1">
                                                        <span className="rounded-md bg-sky-50 px-2 py-1 text-[9px] font-black uppercase text-sky-700">POD {queuePod}</span>
                                                        <span className="rounded-md bg-slate-100 px-2 py-1 text-[9px] font-bold text-slate-500">{assignment.job_details?.process_code || "Step"}</span>
                                                    </div>
                                                    <p className="font-black text-slate-900">
                                                        {formatSmartValue(queuePrimaryTarget, queuePrimaryUom, queuePrimaryUom === "PCS" ? 0 : 2)} {queuePrimaryUom}
                                                        {assignment.job_details?.process_code ? ` • ${assignment.job_details.process_code}` : ""}
                                                    </p>
                                                    {queuePrimaryUom === "PCS" && Number.isFinite(queueTotalKg) && (
                                                        <p className="text-[10px] text-slate-500 font-semibold">
                                                            Support weight {queueTotalKg.toFixed(3)} KG
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        )
                                    })}
                                    {visibleQueueAssignments.length === 0 && (
                                        <div className="text-center p-8 text-slate-400">No matching jobs in queue</div>
                                    )}
                                </CardContent>
                            </Card>

                            {/* MAIN CONTENT AREA: COLUMN 2 & 3 */}
                            <div className="grid min-h-0 gap-6 overflow-hidden xl:col-span-9 xl:grid-cols-9 xl:h-full">
                                {activeAssignment ? (
                                    <>
                                        {/* COLUMN 2: JOB SPECIFICATION & BOM */}
                                        <Card className="flex min-h-0 flex-col overflow-hidden border border-slate-200 bg-white shadow-sm xl:col-span-4 xl:h-full">
                                            <CardHeader className="bg-slate-100 py-3 shrink-0 flex flex-row items-center justify-between border-b border-slate-200">
                                                <CardTitle className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Sales Product & Step</CardTitle>
                                                <SemanticBadge kind="processState" value={selectedStepName} label={`Step ${currentStepNumber || "—"}`} className="text-[10px] px-3 py-1" />
                                            </CardHeader>
                                            <CardContent className="flex-1 space-y-6 overflow-y-auto p-4">
                                                {/* Core Job Info & Prominent Qty */}
                                                <div className="space-y-4 border-b border-slate-100 pb-4">
                                                    <div className="flex justify-between gap-4">
                                                        <div className="min-w-0">
                                                            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-blue-600">Sales product</div>
                                                            <div className="mt-1 text-2xl font-black leading-tight text-slate-950">{selectedProductName}</div>
                                                            <div className="mt-1 text-sm font-bold text-slate-600">{selectedJob?.customer_name || "—"}</div>
                                                            <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                                                                {selectedJob?.order_number ? `SO ${selectedJob.order_number}` : "SO —"} · Job {selectedJob?.job_number || "—"}
                                                            </div>
                                                        </div>
                                                        <div className="shrink-0 text-right">
                                                            <div className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Step Target</div>
                                                            <div className="text-4xl font-black text-blue-600 leading-none">
                                                                {formatSmartValue(stepTargetPrimary, selectedPrimaryUom, selectedPrimaryDecimals)}
                                                                <span className="text-sm ml-1 text-slate-400 uppercase">{selectedPrimaryUom}</span>
                                                            </div>
                                                            <div className="text-[10px] font-bold text-slate-400 mt-1 uppercase">
                                                                Order Total: {Number(orderTotalKg || 0).toFixed(3)} kg
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="grid gap-3 md:grid-cols-3">
                                                        <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 md:col-span-2">
                                                            <div className="text-[10px] font-black uppercase tracking-widest text-blue-700">Size</div>
                                                            <div className="mt-1 text-lg font-black text-slate-950">{selectedGeometry.label}</div>
                                                        </div>
                                                        <div className="rounded-xl border border-sky-100 bg-sky-50 p-3">
                                                            <div className="text-[10px] font-black uppercase tracking-widest text-sky-700">POD</div>
                                                            <div className="mt-1 text-sm font-black text-slate-950">{selectedPodLabel}</div>
                                                        </div>
                                                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 md:col-span-3">
                                                            <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Add-ons</div>
                                                            <div className="mt-1 text-sm font-black text-slate-900">{selectedAddonsLabel}</div>
                                                        </div>
                                                    </div>
                                                    <div className="rounded-2xl border border-slate-200 bg-white p-3">
                                                        <div className="mb-3 flex items-center justify-between">
                                                            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Material stack</div>
                                                            <Badge variant="outline" className="bg-slate-50 text-[10px] font-black">{selectedMaterialSpecs.length || displayLayers.length} layers</Badge>
                                                        </div>
                                                        <div className="space-y-2">
                                                            {selectedMaterialSpecs.length > 0 ? selectedMaterialSpecs.map((row: any, idx: number) => (
                                                                <div key={`selected-material-${idx}`} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-3">
                                                                    <div className="flex items-start justify-between gap-3">
                                                                        <div className="min-w-0">
                                                                            <div className="text-sm font-black text-slate-950">{row.material}</div>
                                                                            <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                                                                                {row.code || "No code"} · {row.source}
                                                                            </div>
                                                                        </div>
                                                                        {row.qty ? (
                                                                            <div className="shrink-0 rounded-lg bg-white px-2 py-1 text-right text-[10px] font-black text-slate-700">
                                                                                {Number(row.qty || 0).toFixed(4)} kg
                                                                            </div>
                                                                        ) : null}
                                                                    </div>
                                                                    <div className="mt-3 grid grid-cols-3 gap-2 text-[10px] font-black uppercase">
                                                                        <div className="rounded-lg bg-white px-2 py-2 text-slate-700">
                                                                            <div className="text-[8px] text-slate-400">Thickness</div>
                                                                            {row.thickness ? `${row.thickness} μ` : "—"}
                                                                        </div>
                                                                        <div className="rounded-lg bg-white px-2 py-2 text-slate-700">
                                                                            <div className="text-[8px] text-slate-400">Width</div>
                                                                            {row.width ? `${row.width} mm` : "—"}
                                                                        </div>
                                                                        <div className="rounded-lg bg-white px-2 py-2 text-slate-700">
                                                                            <div className="text-[8px] text-slate-400">Grade</div>
                                                                            {row.grade || "—"}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            )) : (
                                                                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-5 text-center text-xs font-semibold text-slate-400">
                                                                    No material stack captured for this job.
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div className="flex flex-wrap gap-2">
                                                        {selectedLayerChips.length > 0 ? selectedLayerChips.map((layer: any, idx: number) => {
                                                            const label = typeof layer === "string"
                                                                ? layer
                                                                : [layer.material || layer.variant_name || layer.name || `Layer ${idx + 1}`, layer.thickness || layer.thickness_micron ? `${layer.thickness ?? layer.thickness_micron}μ` : "", layer.grade_name || layer.grade || ""].filter(Boolean).join(" · ")
                                                            return (
                                                                <span key={`selected-layer-${idx}`} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase text-slate-700">
                                                                    {label}
                                                                </span>
                                                            )
                                                        }) : (
                                                            <span className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase text-slate-400">No layer snapshot</span>
                                                        )}
                                                    </div>
                                                    <div className="text-right">
                                                        {showPrimarySupportKg ? (
                                                            <div className="text-[10px] font-semibold text-slate-500 mt-1">
                                                                Support weight {Number(stepTargetKg || 0).toFixed(3)} kg
                                                            </div>
                                                        ) : (
                                                            <div className="text-[10px] font-semibold text-slate-500 mt-1">
                                                                Roll {Number(stepRollTargetKg || 0).toFixed(3)} kg + Bulk {Number(stepBulkTargetKg || 0).toFixed(3)} kg
                                                            </div>
                                                        )}
                                                        {stepRemainingPrimary !== null && (
                                                            <div className="text-[10px] font-bold text-slate-500 mt-1 uppercase">
                                                                Remaining: {formatSmartValue(stepRemainingPrimary, selectedPrimaryUom, selectedPrimaryDecimals)} {selectedPrimaryUom}
                                                            </div>
                                                        )}
                                                        {displayPcsSecondary != null && (
                                                            <div className="text-[10px] font-bold text-slate-400 uppercase">
                                                                PCS: {Number(displayPcsSecondary).toLocaleString()}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>

                                                <div className="rounded-2xl border border-blue-200 bg-blue-50/60 p-4 space-y-3" data-testid="wcm-current-step-policy">
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div>
                                                            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-blue-700">Current Step Material Policy</div>
                                                            <div className="mt-1 text-sm font-semibold text-slate-900">
                                                                Change this only when the running step needs a real issue exception.
                                                            </div>
                                                            <div className="text-xs text-slate-600">
                                                                Step {currentStepPolicy?.current_step_sequence || currentStepNumber} · {currentStepPolicy?.current_process_name || "Current process"} · Planner only reviews this rule
                                                            </div>
                                                        </div>
                                                        <Button
                                                            size="sm"
                                                            className="bg-blue-600 hover:bg-blue-700"
                                                            onClick={() => stepPolicyMutation.mutate()}
                                                            disabled={stepPolicyMutation.isPending || !selectedJobId || !hasEditableCurrentStepPolicy || !hasStepPolicyChangeIntent}
                                                            data-testid="wcm-save-current-step-policy"
                                                        >
                                                            {stepPolicyMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                                            Save step rule
                                                        </Button>
                                                    </div>
                                                    {!hasEditableCurrentStepPolicy ? (
                                                        <div className="rounded-xl border border-dashed border-blue-200 bg-white/80 px-4 py-5 text-sm text-slate-500">
                                                            This step has no editable issue rule. Use the template or route setup if this step should allow a WCM override.
                                                        </div>
                                                    ) : (
                                                        <div className="space-y-3">
                                                            {currentStepPolicyItems.map((item) => {
                                                                const draft = stepPolicyDrafts[item.policy_key] || {
                                                                    issue_policy_mode: "NONE" as const,
                                                                    issue_policy_value: 0,
                                                                    reason: "",
                                                                }
                                                                const overrideActive = Boolean(activeStepPolicyOverrides[item.policy_key])
                                                                return (
                                                                    <div key={item.policy_key} className="rounded-xl border border-blue-100 bg-white p-3 space-y-3">
                                                                        <div className="flex items-start justify-between gap-3">
                                                                            <div>
                                                                                <div className="text-sm font-black text-slate-900">{item.material_name}</div>
                                                                                <div className="text-[11px] text-slate-500">
                                                                                    {item.category_code} · Theory {Number(item.theoretical_qty || 0).toFixed(3)} kg · Planned {Number(item.planned_issue_qty || 0).toFixed(3)} kg
                                                                                </div>
                                                                            </div>
                                                                            <div className="flex flex-wrap justify-end gap-2">
                                                                                <SemanticBadge kind="approval" value={String(item.policy_source || "TEMPLATE_DEFAULT").includes("OVERRIDE") ? "PENDING" : "APPROVED"} label={String(item.policy_source || "TEMPLATE_DEFAULT").replaceAll("_", " ")} className="text-[10px]" />
                                                                                <Button
                                                                                    type="button"
                                                                                    size="sm"
                                                                                    variant={overrideActive ? "outline" : "default"}
                                                                                    disabled={isReleasedToMachine || stepPolicyMutation.isPending}
                                                                                    className={cn("h-8 rounded-lg px-3 text-xs font-semibold", overrideActive ? "border-slate-200 bg-white text-slate-700" : "bg-slate-900 text-white hover:bg-slate-800")}
                                                                                    onClick={() => {
                                                                                        if (overrideActive) {
                                                                                            setActiveStepPolicyOverrides((prev) => ({ ...prev, [item.policy_key]: false }))
                                                                                            setStepPolicyDrafts((prev) => ({
                                                                                                ...prev,
                                                                                                [item.policy_key]: { issue_policy_mode: "NONE", issue_policy_value: 0, reason: "" },
                                                                                            }))
                                                                                            return
                                                                                        }
                                                                                        setActiveStepPolicyOverrides((prev) => ({ ...prev, [item.policy_key]: true }))
                                                                                        setStepPolicyDrafts((prev) => ({
                                                                                            ...prev,
                                                                                            [item.policy_key]: {
                                                                                                issue_policy_mode: String(item.effective_issue_policy_mode || item.template_issue_policy_mode || "NONE").toUpperCase() as StepPolicyDraft["issue_policy_mode"],
                                                                                                issue_policy_value: Number(item.effective_issue_policy_value ?? item.template_issue_policy_value ?? 0),
                                                                                                reason: String(item.override_reason || ""),
                                                                                            },
                                                                                        }))
                                                                                    }}
                                                                                >
                                                                                    {overrideActive ? "Use template" : "Override"}
                                                                                </Button>
                                                                            </div>
                                                                        </div>
                                                                        <div className="grid gap-3 md:grid-cols-4">
                                                                            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px]">
                                                                                <div className="text-slate-500">Template</div>
                                                                                <div className="font-semibold text-slate-900">
                                                                                    {policyModeLabel(item.template_issue_policy_mode, item.template_issue_policy_value)}
                                                                                </div>
                                                                            </div>
                                                                            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px]">
                                                                                <div className="text-slate-500">Current effective</div>
                                                                                <div className="font-semibold text-slate-900">
                                                                                    {policyModeLabel(item.effective_issue_policy_mode, item.effective_issue_policy_value)}
                                                                                </div>
                                                                            </div>
                                                                            <div>
                                                                                <div className="mb-1 text-[10px] font-black uppercase tracking-wide text-slate-500">Override mode</div>
                                                                                <Select
                                                                                    value={draft.issue_policy_mode}
                                                                                    disabled={isReleasedToMachine || !overrideActive}
                                                                                    onValueChange={(value) =>
                                                                                        setStepPolicyDrafts((prev) => ({
                                                                                            ...prev,
                                                                                            [item.policy_key]: {
                                                                                                ...draft,
                                                                                                issue_policy_mode: value as StepPolicyDraft["issue_policy_mode"],
                                                                                            },
                                                                                        }))
                                                                                    }
                                                                                >
                                                                                    <SelectTrigger className="h-9 bg-white text-xs">
                                                                                        <SelectValue />
                                                                                    </SelectTrigger>
                                                                                    <SelectContent>
                                                                                        <SelectItem value="NONE">Template default</SelectItem>
                                                                                        <SelectItem value="PERCENT_OVER_THEORY">% over theory</SelectItem>
                                                                                        <SelectItem value="FIXED_EXTRA_KG">Fixed extra kg</SelectItem>
                                                                                        <SelectItem value="MINIMUM_ISSUE_KG">Minimum issue kg</SelectItem>
                                                                                    </SelectContent>
                                                                                </Select>
                                                                            </div>
                                                                            <div>
                                                                                <div className="mb-1 text-[10px] font-black uppercase tracking-wide text-slate-500">Override value</div>
                                                                                <Input
                                                                                    type="number"
                                                                                    className="h-9 bg-white text-xs"
                                                                                    disabled={isReleasedToMachine || !overrideActive || draft.issue_policy_mode === "NONE"}
                                                                                    value={String(draft.issue_policy_value ?? 0)}
                                                                                    onChange={(event) =>
                                                                                        setStepPolicyDrafts((prev) => ({
                                                                                            ...prev,
                                                                                            [item.policy_key]: {
                                                                                                ...draft,
                                                                                                issue_policy_value: Number(event.target.value || 0),
                                                                                            },
                                                                                        }))
                                                                                    }
                                                                                />
                                                                            </div>
                                                                            <div>
                                                                                <div className="mb-1 text-[10px] font-black uppercase tracking-wide text-slate-500">Reason</div>
                                                                                <Input
                                                                                    className="h-9 bg-white text-xs"
                                                                                    disabled={isReleasedToMachine || !overrideActive || draft.issue_policy_mode === "NONE"}
                                                                                    placeholder="Why this execution exception is needed"
                                                                                    value={draft.reason}
                                                                                    onChange={(event) =>
                                                                                        setStepPolicyDrafts((prev) => ({
                                                                                            ...prev,
                                                                                            [item.policy_key]: {
                                                                                                ...draft,
                                                                                                reason: event.target.value,
                                                                                            },
                                                                                        }))
                                                                                    }
                                                                                />
                                                                            </div>
                                                                        </div>
                                                                        <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-[11px] text-blue-800">
                                                                            Use a change only when the real shop-floor issue is different from the template rule. This change affects the current running step only.
                                                                        </div>
                                                                    </div>
                                                                )
                                                            })}
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Geometry & Details */}
                                                <div className="grid grid-cols-2 gap-3">
                                                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                                                        <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Base Geometry</div>
                                                        <div className="text-lg font-black text-slate-800 flex items-center gap-2">
                                                            {(geometryBase as any)?.width_mm || "—"}
                                                            <span className="text-slate-300 text-sm font-light">×</span>
                                                            {(geometryBase as any)?.height_mm || "—"}
                                                            <span className="text-[10px] font-bold text-slate-400 lowercase">mm</span>
                                                        </div>
                                                    </div>
                                                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                                                        <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Adjustments & POD</div>
                                                        <div className="text-xs font-bold text-slate-700 space-y-1">
                                                            <div>POD: <Badge variant="outline" className="text-[10px] h-4 bg-white">
                                                                {typeof (jobGeometry as any)?.pod === 'object' ? (jobGeometry as any).pod?.type : (jobGeometry as any)?.pod || "None"}
                                                            </Badge></div>
                                                            {(() => {
                                                                const base = geometryBase || {}
                                                                const gusset = base.gusset_mm ?? base.gusset ?? null
                                                                if (!gusset) return null
                                                                return (
                                                                    <div className="text-[10px] font-semibold text-slate-600">
                                                                        Gusset: <span className="font-bold text-slate-800">{gusset}mm</span>
                                                                    </div>
                                                                )
                                                            })()}
                                                            {geometryAdjustments.length > 0 ? (
                                                                <div className="flex flex-wrap gap-1 mt-1">
                                                                    {geometryAdjustments.map((adj: any, aIdx: number) => (
                                                                        <Badge key={aIdx} variant="secondary" className="text-[9px] h-4 px-2 bg-amber-50 text-amber-700 border border-amber-100">
                                                                            {(adj.type || adj.name || adj.impact || "Adjustment")}
                                                                            {adj.on ? ` on ${adj.on}` : ""}
                                                                            {adj.value != null ? `: ${adj.value}mm` : ""}
                                                                        </Badge>
                                                                    ))}
                                                                </div>
                                                            ) : (
                                                                <div className="text-[10px] text-slate-500">No adjustments recorded</div>
                                                            )}
                                                            {selectedJob?.printing && (
                                                                <div className="text-[10px] font-semibold text-slate-600 mt-2">
                                                                    Printing: <span className="font-bold text-slate-800">
                                                                        {selectedJob.printing.printing_type || selectedJob.printing.type || "—"}
                                                                    </span>
                                                                    {selectedJob.printing.required_color_count || selectedJob.printing.color_count ? (
                                                                        <span className="ml-2 text-slate-500">
                                                                            • {selectedJob.printing.required_color_count || selectedJob.printing.color_count} colors
                                                                        </span>
                                                                    ) : null}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* NESTED BOM (Layers + Granules) */}
                                                <div className="space-y-4">
                                                    <div className="flex items-center justify-between">
                                                        <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Material Requirements (Nested)</div>
                                                        <Badge variant="outline" className="text-[10px] bg-slate-50">{displayLayers.length} Layers</Badge>
                                                    </div>

                                                    <div className="space-y-3">
                                                        {displayLayers.length === 0 ? (
                                                            <div className="text-xs text-slate-400 italic bg-slate-50 p-6 rounded-xl text-center border-2 border-dashed border-slate-200">
                                                                No layer-wise requirements found.
                                                            </div>
                                                        ) : (
                                                            displayLayers.map((layer: any, idx: number) => (
                                                                <div key={idx} className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden group hover:border-blue-300 transition-colors">
                                                                    <div className="bg-slate-50/80 group-hover:bg-slate-50 px-4 py-3 border-b border-slate-200 flex justify-between items-center">
                                                                        <div>
                                                                            <div className="flex items-center gap-2">
                                                                                <div className="h-4 w-4 rounded-full bg-blue-500 flex items-center justify-center text-[10px] text-white font-bold">{layer.index}</div>
                                                                                <div className="text-[13px] font-black text-slate-800 uppercase tracking-tight">
                                                                                    {layer.variant_name || layer.name || `Layer ${layer.index}`}
                                                                                </div>
                                                                            </div>
                                                                            <div className="text-[10px] text-slate-500 font-bold mt-0.5 ml-6">
                                                                                {(layer.thickness_micron ?? layer.thickness ?? "—")}μ • {layer.grade_name || layer.grade || "Standard Grade"}
                                                                                {layer.code || layer.variant_code || layer.material_code ? ` • ${layer.code || layer.variant_code || layer.material_code}` : ""}
                                                                            </div>
                                                                        </div>
                                                                        <div className="text-right">
                                                                            <div className="text-[13px] font-mono font-black text-blue-700 italic">
                                                                                {layer.weight_kg != null ? `${Number(layer.weight_kg || 0).toFixed(3)} kg` : "—"}
                                                                            </div>
                                                                            <div className="text-[9px] font-black text-slate-400 uppercase">Layer Weight</div>
                                                                        </div>
                                                                    </div>

                                                                    {layer.materials && layer.materials.length > 0 && (
                                                                        <div className="px-0">
                                                                            <table className="w-full text-[11px]">
                                                                                <tbody className="divide-y divide-slate-100">
                                                                                    {layer.materials.map((m: any, mIdx: number) => (
                                                                                        <tr key={mIdx} className="hover:bg-blue-50/20 transition-colors">
                                                                                            <td className="pl-10 py-2.5 text-slate-600 font-semibold">
                                                                                                <div className="flex items-center gap-3">
                                                                                                    <ArrowDownRight className="h-3 w-3 text-slate-300" />
                                                                                                    <span className="truncate max-w-[150px]">{m.name || m.code}</span>
                                                                                                </div>
                                                                                            </td>
                                                                                            <td className="py-2.5 px-4 text-right">
                                                                                                <span className="font-bold text-slate-800">{Number(m.weight_kg || 0).toFixed(3)} kg</span>
                                                                                            </td>
                                                                                            <td className="py-2.5 pr-6 text-right w-16">
                                                                                                <span className="text-[10px] font-black text-slate-400">{m.percentage != null ? `${Number(m.percentage).toFixed(1)}%` : ""}</span>
                                                                                            </td>
                                                                                        </tr>
                                                                                    ))}
                                                                                </tbody>
                                                                            </table>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            ))
                                                        )}
                                                    </div>
                                                </div>

                                                {/* OTHER ITEMS (Inks, Adhesive, etc.) */}
                                                {displayOtherRequirements.length > 0 && (
                                                    <div className="pt-6 border-t border-slate-100 space-y-3">
                                                        <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">{otherRequirementsLabel}</div>
                                                        <div className="grid grid-cols-1 gap-2">
                                                            {displayOtherRequirements.map((item: any, idx: number) => (
                                                                <div key={idx} className="flex justify-between items-center px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl hover:border-slate-300 transition-colors">
                                                                    <div className="flex items-center gap-3">
                                                                        <div className={cn(
                                                                            "h-2 w-2 rounded-full",
                                                                            (item.code?.includes('INK') || String(item.category || "").toUpperCase() === "INK") ? "bg-red-400" : "bg-teal-400"
                                                                        )} />
                                                                        <div className="flex items-center gap-2">
                                                                            <div className="text-xs font-bold text-slate-700">{item.name || item.code}</div>
                                                                            {item.scope === "OTHER_STEP" && (
                                                                                <Badge variant="outline" className="h-4 text-[9px] bg-blue-50 text-blue-700 border-blue-200">Prior Step</Badge>
                                                                            )}
                                                                            {item.scope !== "STEP" && item.scope !== "OTHER_STEP" && (
                                                                                <Badge variant="outline" className="h-4 text-[9px] bg-slate-100 text-slate-600 border-slate-200">Reference</Badge>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                    <div className="text-xs font-black text-slate-900 border-l border-slate-200 pl-4 italic">
                                                                        {Number(item.weight_kg || item.qty_kg || 0).toFixed(3)} kg
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </CardContent>
                                        </Card>

                                        {/* COLUMN 3: REQUIREMENTS, WIP & ASSIGNMENT */}
                                        <div className="space-y-6 overflow-y-auto pr-2 xl:col-span-5 xl:h-full">
                                            {/* 1. REQUIREMENTS (Current Step) */}
                                            <Card className="border-none shadow-md overflow-hidden bg-white">
                                                <CardHeader className="bg-slate-100 py-3 flex flex-row justify-between items-center border-b border-slate-200">
                                                    <CardTitle className="text-xs font-semibold text-slate-600 uppercase tracking-wider">1. Requirements (Current Step)</CardTitle>
                                                    <SemanticBadge kind="jobState" value={requirementsSatisfied ? "READY" : "BLOCKED"} label={requirementsSatisfied ? "Ready" : "Blocked"} />
                                                </CardHeader>
                                                <CardContent className="p-0">
                                                    <div className="px-4 py-3 text-[11px] font-semibold text-slate-500 border-b border-slate-100">
                                                        Local source: {bulkRows.find((r: any) => r.locationName)?.locationName || (executionContext as any)?.job?.from_location_name || "—"}
                                                    </div>
                                                    <Table>
                                                        <TableHeader className="bg-slate-50/50">
                                                            <TableRow className="border-none hover:bg-transparent">
                                                                <TableHead className="h-9 text-[10px] font-bold uppercase text-slate-400">Material</TableHead>
                                                                <TableHead className="h-9 text-[10px] font-bold uppercase text-slate-400">Type</TableHead>
                                                                <TableHead className="h-9 text-[10px] font-bold uppercase text-slate-400 text-right">Required</TableHead>
                                                                <TableHead className="h-9 text-[10px] font-bold uppercase text-slate-400 text-right">Local Available</TableHead>
                                                                <TableHead className="h-9 text-[10px] font-bold uppercase text-slate-400 text-right">Plant Inventory</TableHead>
                                                                <TableHead className="h-9 text-[10px] font-bold uppercase text-slate-400 text-right">Status</TableHead>
                                                            </TableRow>
                                                        </TableHeader>
                                                        <TableBody>
                                                            {requirementRows.length === 0 && (
                                                                <TableRow>
                                                                    <TableCell colSpan={6} className="text-center text-slate-400 py-6">
                                                                        No requirements detected for this step.
                                                                    </TableCell>
                                                                </TableRow>
                                                            )}
                                                            {requirementRows.map((row: any, bIdx: number) => (
                                                                <TableRow key={bIdx} className="hover:bg-slate-50/50 transition-colors border-slate-100">
                                                                    <TableCell className="py-3 font-semibold text-slate-700 text-xs">
                                                                        {row.material}
                                                                    </TableCell>
                                                                    <TableCell className="py-3 text-xs font-bold text-slate-500">
                                                                        <Badge variant="outline" className="text-[9px] uppercase">{row.type}</Badge>
                                                                    </TableCell>
                                                                    <TableCell className="py-3 text-right font-mono text-xs font-bold text-slate-900">
                                                                        {row.type === "ROLL" ? row.required : `${Number(row.required).toFixed(2)} kg`}
                                                                    </TableCell>
                                                                    <TableCell className="py-3 text-right">
                                                                        <div className={cn(
                                                                            "inline-flex items-center px-2 py-0.5 rounded font-mono text-xs font-bold",
                                                                            row.isOk ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                                                                        )}>
                                                                            {row.type === "ROLL"
                                                                                ? row.localAvailable
                                                                                : `${Number(row.localAvailable || 0).toFixed(2)} kg`}
                                                                        </div>
                                                                    </TableCell>
                                                                    <TableCell className="py-3 text-right">
                                                                        {row.plantInventory == null ? (
                                                                            <div className="text-[11px] font-medium text-slate-400">—</div>
                                                                        ) : (
                                                                            <div className="text-[11px] font-medium text-slate-500">
                                                                                {row.type === "ROLL"
                                                                                    ? `${row.plantInventory} rolls`
                                                                                    : `${Number(row.plantInventory || 0).toFixed(1)} kg`}
                                                                            </div>
                                                                        )}
                                                                    </TableCell>
                                                                    <TableCell className="py-3 text-right">
                                                                        <div className="flex flex-col items-end gap-1">
                                                                            {!row.isOk && row.type === "BULK" && row.needsTransfer && (
                                                                                <BulkTransferModal
                                                                                    row={row}
                                                                                    targetPlantId={selectedTargetPlantId}
                                                                                    targetPlantName={selectedTargetPlantName}
                                                                                    targetLocationId={
                                                                                        (executionContext as any)?.job?.from_location_id ||
                                                                                        (selectedJob as any)?.from_location_id ||
                                                                                        (selectedJob as any)?.from_location
                                                                                    }
                                                                                    targetLocationName={
                                                                                        (executionContext as any)?.job?.from_location_name ||
                                                                                        (selectedJob as any)?.from_location_name ||
                                                                                        (selectedJob as any)?.from_location_display
                                                                                    }
                                                                                    onRequested={() => {
                                                                                        refetchContext()
                                                                                        refetchSatisfaction()
                                                                                    }}
                                                                                />
                                                                            )}
                                                                            <span className={cn(
                                                                                "text-[10px] font-semibold",
                                                                                row.isOk ? "text-emerald-600" : "text-rose-600"
                                                                            )}>
                                                                                {row.statusText || (row.isOk ? "READY" : "INSUFFICIENT")}
                                                                            </span>
                                                                            {!row.isOk && row.type === "ROLL" && (showRollAllocator || showRollTransfer) && (
                                                                                <span className="text-[10px] font-medium text-slate-500">Panel 2 action</span>
                                                                            )}
                                                                        </div>
                                                                    </TableCell>
                                                                </TableRow>
                                                            ))}
                                                        </TableBody>
                                                    </Table>
                                                </CardContent>
                                            </Card>

                                            {/* 2. ROLL ASSIGNMENT & POOL */}
                                            <Card className="border-none shadow-md overflow-hidden bg-white">
                                                <CardHeader className="bg-slate-100 py-3 flex flex-row justify-between items-center border-b border-slate-200">
                                                    <CardTitle className="text-xs font-semibold text-slate-600 uppercase tracking-wider">2. Roll Assignments</CardTitle>
                                                    <div className="flex items-center gap-2">
                                                        {satisfactionStatus?.input_form === "ROLL" && (
                                                            <>
                                                                {showRollAllocator && (
                                                                    <RollAssignmentModal
                                                                        activeAssignment={activeAssignment}
                                                                        targetSpec={targetSpec}
                                                                        targetSpecs={targetRollSpecs}
                                                                        rollBehavior={rollBehavior}
                                                                        targetPlantId={selectedTargetPlantId}
                                                                        targetPlantName={selectedTargetPlantName}
                                                                        targetLocationId={
                                                                            (executionContext as any)?.job?.from_location_id ||
                                                                            (selectedJob as any)?.from_location_id ||
                                                                            (selectedJob as any)?.from_location
                                                                        }
                                                                        targetLocationName={
                                                                            (executionContext as any)?.job?.from_location_name ||
                                                                            (selectedJob as any)?.from_location_name ||
                                                                            (selectedJob as any)?.from_location_display
                                                                        }
                                                                        manualEligibleRolls={rollAllocationCandidates}
                                                                        wipPoolMeta={(executionContext as any)?.wip_pool_meta || {}}
                                                                        rollAssignmentValidation={rollAssignmentValidation}
                                                                        strictSpecMatch={!manualOverrideEnabled}
                                                                        disabled={!canManualAssign}
                                                                        required={rollsRequired}
                                                                        manualOverride={manualOverrideEnabled}
                                                                        overrideReason={overrideReason}
                                                                        onAssigned={() => {
                                                                            refetchContext()
                                                                            refetchSatisfaction()
                                                                            queryClient.invalidateQueries({ queryKey: ["wip-pool-grouped", activeAssignment.production_job] })
                                                                        }}
                                                                    />
                                                                )}
                                                                {showRollTransfer && (
                                                                    <RollTransferModal
                                                                        targetSpec={targetSpec}
                                                                        targetSpecs={targetRollSpecs}
                                                                        rollBehavior={rollBehavior}
                                                                        targetPlantId={selectedTargetPlantId}
                                                                        targetPlantName={selectedTargetPlantName}
                                                                        targetLocationId={
                                                                            (executionContext as any)?.job?.from_location_id ||
                                                                            (selectedJob as any)?.from_location_id ||
                                                                            (selectedJob as any)?.from_location
                                                                        }
                                                                        targetLocationName={
                                                                            (executionContext as any)?.job?.from_location_name ||
                                                                            (selectedJob as any)?.from_location_name ||
                                                                            (selectedJob as any)?.from_location_display
                                                                        }
                                                                        onRequested={() => {
                                                                            refetchContext()
                                                                            refetchSatisfaction()
                                                                        }}
                                                                    />
                                                                )}
                                                            </>
                                                        )}
                                                        <Badge variant="outline" className="text-[10px] font-bold bg-white">
                                                            {assignedRollsForDisplay.length} assigned
                                                        </Badge>
                                                    </div>
                                                </CardHeader>
                                                <CardContent className="p-4 space-y-4">
                                                    {satisfactionStatus?.input_form === "ROLL" && (
                                                        <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
                                                            {showRollGuidance ? (
                                                                <div className="text-[11px] font-semibold text-slate-600">
                                                                    <span className="font-black text-slate-700">{rollBehaviorLabel}:</span>{" "}
                                                                    {rollGuidanceText}{" "}
                                                                    {`Assign ${rollsMissing} roll(s) to proceed.`}
                                                                </div>
                                                            ) : (
                                                                <div className="text-[11px] font-semibold text-emerald-700">
                                                                    All required rolls assigned. Ready for machine execution.
                                                                </div>
                                                            )}
                                                            {showRollGuidance && (
                                                                <div className="mt-3 flex items-center gap-3">
                                                                    <Checkbox
                                                                        id="manual-override"
                                                                        checked={manualOverrideEnabled}
                                                                        onCheckedChange={(checked) => {
                                                                            const enabled = Boolean(checked)
                                                                            setManualOverrideEnabled(enabled)
                                                                            if (!enabled) setOverrideReason("")
                                                                        }}
                                                                    />
                                                                    <label htmlFor="manual-override" className="text-[11px] font-semibold text-slate-700">
                                                                        Override spec match
                                                                    </label>
                                                                    <span className="text-[10px] text-slate-500">
                                                                        Use to assign a roll that doesn&apos;t match the target spec.
                                                                    </span>
                                                                </div>
                                                            )}
                                                            {manualOverrideEnabled && (
                                                                <div className="mt-2">
                                                                    <Input
                                                                        value={overrideReason}
                                                                        onChange={(e) => setOverrideReason(e.target.value)}
                                                                        placeholder="Override reason (required)"
                                                                        className="h-8 text-xs"
                                                                    />
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                    {satisfactionStatus?.input_form === "ROLL" && (
                                                        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                                                            <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
                                                                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">True WIP</div>
                                                                <div className="mt-2 text-2xl font-black text-slate-900">{lineageRollsAvailable}</div>
                                                                <div className="text-[11px] text-slate-500">Strict downstream lineage rolls</div>
                                                            </div>
                                                            <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-3">
                                                                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-700">Fallback</div>
                                                                <div className="mt-2 text-2xl font-black text-amber-900">{fallbackRollsAvailable}</div>
                                                                <div className="text-[11px] text-amber-700">Compatible manual-only candidates</div>
                                                            </div>
                                                            <div className="rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-3">
                                                                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-blue-600">Reserved</div>
                                                                <div className="mt-2 text-2xl font-black text-blue-900">{effectiveRollsReserved}/{rollsRequired}</div>
                                                                <div className="text-[11px] text-blue-700">Current-step assignment truth</div>
                                                            </div>
                                                            <div className="rounded-xl border border-slate-200 bg-slate-900 px-3 py-3 text-white">
                                                                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-300">Slot Coverage</div>
                                                                <div className="mt-2 text-2xl font-black">{matchedSlotCount}/{Math.max(rollsRequired, Number((rollAssignmentValidation as any)?.required_rolls || 0))}</div>
                                                                <div className="text-[11px] text-slate-300">
                                                                    {unmatchedSlotCount > 0 ? `${unmatchedSlotCount} slot(s) still unmatched` : "All current slots map cleanly"}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}
                                                    {satisfactionStatus?.input_form === "ROLL" && (
                                                        <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                                                            <Badge variant="outline" className="border-slate-200 bg-white text-slate-700">
                                                                Missing lineage {missingLineageRolls}
                                                            </Badge>
                                                            <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">
                                                                Missing assignment {rollsMissing}
                                                            </Badge>
                                                            {fallbackRollsAvailable > 0 && (
                                                                <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                                                                    Fallback is manual only
                                                                </Badge>
                                                            )}
                                                        </div>
                                                    )}
                                                    {satisfactionStatus?.input_form === "ROLL" && laneGroups.length > 0 && (
                                                        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                                                            {laneGroups.map((lane: any) => (
                                                                <div key={String(lane?.lane_key || lane?.lane_label)} className="rounded-2xl border border-blue-100 bg-blue-50/50 p-3">
                                                                    <div className="flex items-start justify-between gap-3">
                                                                        <div>
                                                                            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-blue-500">{lane?.lane_label || lane?.lane_key || "Lane"}</div>
                                                                            <div className="mt-1 text-sm font-black text-slate-900">{lane?.variant_name || lane?.family_name || lane?.source_role || "Required lane"}</div>
                                                                            <div className="mt-1 text-[11px] font-semibold text-slate-600">
                                                                                {[lane?.grade_name, lane?.thickness_micron ? `${lane.thickness_micron}μ` : null, lane?.width_mm ? `${lane.width_mm}mm` : null].filter(Boolean).join(" • ") || "Spec comes from layer snapshot"}
                                                                            </div>
                                                                        </div>
                                                                        <Badge variant="outline" className="border-blue-200 bg-white text-[10px] text-blue-700">
                                                                            {(lane?.matched_rolls || lane?.rolls || []).length} roll(s)
                                                                        </Badge>
                                                                    </div>
                                                                    <div className="mt-3 space-y-1.5">
                                                                        {(lane?.matched_rolls || lane?.rolls || []).map((roll: any) => (
                                                                            <div key={String(roll?.id || roll?.label_id)} className="flex items-center justify-between rounded-xl border border-white/80 bg-white/70 px-2.5 py-2 text-[10px] font-semibold text-slate-600">
                                                                                <span className="font-black text-slate-800">{roll?.label_id || String(roll?.id || "").slice(0, 8)}</span>
                                                                                <span>{Number(roll?.weight_kg || 0).toFixed(2)} kg</span>
                                                                            </div>
                                                                        ))}
                                                                        {(lane?.matched_rolls || lane?.rolls || []).length === 0 ? (
                                                                            <div className="rounded-xl border border-dashed border-blue-200 bg-white/50 px-2.5 py-2 text-[10px] font-bold text-blue-500">
                                                                                No compatible roll assigned to this lane yet.
                                                                            </div>
                                                                        ) : null}
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                    <div className="grid grid-cols-2 gap-4">
                                                        {/* Left Sub-Column: Reserved for current step */}
                                                        <div className="space-y-3 border-r border-slate-100 pr-4">
                                                            <div className="flex items-center justify-between">
                                                                <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Current Step Allocated</h3>
                                                                <SemanticBadge kind="jobState" value={assignedRollsForDisplay.length > 0 ? "ASSIGNED" : "PENDING"} label={`${assignedRollsForDisplay.length} assigned`} className="text-[10px]" />
                                                            </div>
                                                            <div className="space-y-2 min-h-[100px]">
                                                                {assignedRollsForDisplay.map((roll: any) => (
                                                                    <div
                                                                        key={roll.id}
                                                                        data-testid={`wcm-assigned-roll-${String(roll.id)}`}
                                                                        className="flex items-center gap-3 p-2 bg-blue-50/50 border border-blue-100 rounded-lg group"
                                                                    >
                                                                        <div className="h-2 w-2 rounded-full bg-blue-500" />
                                                                        <div className="flex-1 min-w-0">
                                                                            <p className="text-[11px] font-bold text-slate-900 truncate uppercase">{roll.label_id}</p>
                                                                            <p className="text-[10px] text-slate-600 font-semibold truncate">{roll.material_name}</p>
                                                                            <p className="text-[10px] text-slate-500 font-medium">
                                                                                {roll.thickness_micron ? `${roll.thickness_micron}μ` : "—"} • {roll.width_mm ? `${roll.width_mm}mm` : "—"} • {roll.weight_kg}kg
                                                                                {roll.grade_name ? ` • ${roll.grade_name}` : ""}
                                                                            </p>
                                                                            {roll.target_lane_label ? (
                                                                                <p className="mt-1 text-[9px] font-black uppercase tracking-wider text-blue-600">
                                                                                    {roll.target_lane_label}
                                                                                    {roll.target_layer_index ? ` • Layer ${roll.target_layer_index}` : ""}
                                                                                </p>
                                                                            ) : null}
                                                                        </div>
                                                                        {roll.reservation_id ? (
                                                                            <Button
                                                                                variant="ghost"
                                                                                size="icon"
                                                                                className="h-6 w-6 text-slate-400 hover:text-red-500 hover:bg-red-50"
                                                                                data-testid={`wcm-unassign-roll-${String(roll.reservation_id)}`}
                                                                                onClick={() => handleUnassignRoll(roll.reservation_id)}
                                                                            >
                                                                                <Trash2 className="h-3 w-3" />
                                                                            </Button>
                                                                        ) : (
                                                                            <Button
                                                                                variant="ghost"
                                                                                size="icon"
                                                                                className="h-6 w-6 text-slate-400 hover:text-red-500 hover:bg-red-50"
                                                                                data-testid={`wcm-unassign-roll-by-roll-${String(roll.id)}`}
                                                                                onClick={() => handleUnassignRollByRoll(roll.id)}
                                                                            >
                                                                                <Trash2 className="h-3 w-3" />
                                                                            </Button>
                                                                        )}
                                                                        <CheckCircle2 className="h-4 w-4 text-blue-500 shrink-0" />
                                                                    </div>
                                                                ))}
                                                                {assignedRollsForDisplay.length === 0 && (
                                                                    <div className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-slate-100 rounded-lg text-slate-400">
                                                                        <p className="text-[11px] font-medium">No rolls assigned</p>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>

                                                        {/* Right Sub-Column: Order WIP Pool (all detected, with assignment state) */}
                                                        <div className="space-y-3 pl-2">
                                                            <div className="flex items-center justify-between">
                                                                <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">WIP Pool</h3>
                                                                <SemanticBadge kind="jobState" value={wipPoolRolls.length > 0 ? "READY" : "PENDING"} label={`${wipPoolRolls.length} detected`} className="text-[10px]" />
                                                            </div>
                                                            <div className="space-y-2 max-h-[250px] overflow-y-auto">
                                                                {wipPoolRolls.map((roll: any) => (
                                                                    <div key={roll.id} className="flex items-center gap-3 p-2 bg-emerald-50/30 border border-emerald-100/50 rounded-lg">
                                                                        <ArrowUpRight className="h-3 w-3 text-emerald-500 shrink-0" />
                                                                        <div className="flex-1 min-w-0">
                                                                            <p className="text-[11px] font-bold text-slate-900 truncate uppercase">{roll.label_id}</p>
                                                                            <p className="text-[10px] text-slate-500 font-medium">
                                                                                {roll.weight_kg} kg • <span className="text-emerald-600 font-bold uppercase">{roll.stage}</span>
                                                                            </p>
                                                                            <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">
                                                                                {roll?.is_assigned ? "Reserved in current step" : "Unassigned in current step"}
                                                                            </p>
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                                {wipPoolRolls.length === 0 && (
                                                                    <div className="p-4 text-center text-[10px] text-slate-400 font-medium italic">
                                                                        No order WIP rolls detected for this step.
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </CardContent>
                                            </Card>

                                            {/* 3. MACHINE ASSIGNMENT */}
                                            <Card className="border-none shadow-md overflow-hidden bg-white">
                                                <CardHeader className="bg-slate-100 py-3 border-b border-slate-200 flex flex-row items-center justify-between">
                                                    <CardTitle className="text-xs font-semibold text-slate-600 uppercase tracking-wider">3. Machine Assignment</CardTitle>
                                                    <SemanticBadge kind="jobState" value={selectedMachineId ? "ASSIGNED" : "PENDING"} label={selectedMachineId ? "Confirmed" : "Pending"} className="h-auto px-3 py-1" />
                                                </CardHeader>
                                                <CardContent className="p-4 space-y-4">
                                                    <div className="flex items-end gap-3">
                                                        <div className="flex-1 space-y-1.5">
                                                            <label className="text-[10px] font-black text-slate-500 uppercase">Select Production Line</label>
                                                            <Select value={selectedMachineId} onValueChange={setSelectedMachineId}>
                                                                <SelectTrigger className="w-full h-10 border-slate-200 font-semibold text-slate-800" data-testid="wcm-machine-select">
                                                                    <SelectValue placeholder="Select Machine..." />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    {machineOptionsResolved.map((m: any) => (
                                                                        <SelectItem key={m.id} value={m.id} className="font-semibold">{m.name}</SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>
                                                        </div>
                                                        <Button
                                                            variant="outline"
                                                            className="h-10 px-6 border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100 font-black"
                                                            data-testid="wcm-save-machine"
                                                            onClick={() => {
                                                                if (!selectedMachineId) {
                                                                    toast({ variant: "destructive", title: "Missing Data", description: "Select a machine first." })
                                                                    return
                                                                }
                                                                mutation.mutate(async () => {
                                                                    if (!activeAssignment?.id) {
                                                                        throw new Error("No active assignment selected.")
                                                                    }
                                                                    const updated = await wcmService.assignMachine(activeAssignment.id, selectedMachineId)
                                                                    if (updated?.assigned_machine) {
                                                                        setSelectedMachineId(String(updated.assigned_machine))
                                                                    }
                                                                    await refetchContext()
                                                                    await refetchSatisfaction()
                                                                    queryClient.invalidateQueries({ queryKey: ["wcm-queue", wcId] })
                                                                })
                                                            }}
                                                        >
                                                            SAVE
                                                        </Button>
                                                    </div>

                                                    {/* Action Button */}
                                                    <div className="pt-4 mt-2 border-t border-slate-100">
                                                        <Button
                                                            data-testid="wcm-push-to-operator"
                                                            className={cn(
                                                                "w-full h-14 text-base font-black uppercase tracking-wider shadow-lg transition-all",
                                                                canPushToOperator
                                                                    ? "bg-blue-600 hover:bg-blue-700 shadow-blue-200"
                                                                    : "bg-slate-200 text-slate-400 cursor-not-allowed"
                                                            )}
                                                            disabled={!canPushToOperator || mutation.isPending}
                                                            onClick={handlePushToOperator}
                                                        >
                                                            {mutation.isPending ? (
                                                                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                                            ) : (
                                                                <>PUSH TO MACHINE EXECUTION <Activity className="ml-3 h-5 w-5" /></>
                                                            )}
                                                        </Button>
                                                        <p className="mt-3 text-center text-[10px] font-bold text-slate-400">
                                                            Finalize checks and send this job to machine terminal execution.
                                                        </p>
                                                        {pushBlockingReasons.length > 0 && (
                                                            <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[10px] font-semibold text-rose-700 space-y-1">
                                                                {pushBlockingReasons.map((reason, idx) => (
                                                                    <div key={`${reason}-${idx}`}>• {reason}</div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                </CardContent>
                                            </Card>
                                        </div>
                                    </>
                                ) : (
                                    <div className="space-y-4 xl:col-span-10 xl:h-full">
                                        <div className="flex flex-col items-center justify-center bg-white rounded-xl border border-dashed border-slate-300 h-full p-12 text-slate-400">
                                            <div className="h-16 w-16 bg-slate-50 rounded-full flex items-center justify-center mb-4">
                                                <Activity className="h-8 w-8 text-slate-300" />
                                            </div>
                                            <h2 className="text-xl font-bold text-slate-500">No Job Selected</h2>
                                            <p className="text-sm">Select a job from the scheduled queue to begin allocation.</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </TabsContent>

                    <TabsContent value="history" className="mt-6 space-y-6">
                        {/* Active Jobs Section */}
                        {(historyJobs || []).filter((a: any) => ["EXECUTION_READY", "RUNNING"].includes(a.status) || a.job_details?.job_state === "EXECUTING").length > 0 && (
                            <div className="space-y-4">
                                <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] px-1">Active on Machines</h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                    {(historyJobs || [])
                                        .filter((a: any) => ["EXECUTION_READY", "RUNNING"].includes(a.status) || a.job_details?.job_state === "EXECUTING")
                                        .map((assignment: any) => {
                                            const job = assignment.job_details || {}
                                            const isRunning = job.job_state === "EXECUTING" || assignment.status === "RUNNING"

                                            return (
                                                <div
                                                    key={assignment.id}
                                                    className="group relative p-5 rounded-[2rem] bg-white border border-slate-200 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-500 overflow-hidden"
                                                >
                                                    <div className={cn(
                                                        "absolute top-0 left-0 w-1.5 h-full",
                                                        isRunning ? "bg-blue-500" : "bg-amber-400"
                                                    )} />

                                                    <div className="flex items-start justify-between mb-4">
                                                        <div>
                                                            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">
                                                                {assignment.assigned_machine_name || "Machine Assigned"}
                                                            </div>
                                                            <h4 className="text-lg font-black text-slate-900 tracking-tight">{job.job_number}</h4>
                                                        </div>
                                                        <Badge className={cn(
                                                            "text-[9px] font-black uppercase px-2 py-0 border",
                                                            isRunning ? "bg-blue-50 text-blue-600 border-blue-100" : "bg-amber-50 text-amber-600 border-amber-100"
                                                        )}>
                                                            {isRunning ? "RUNNING" : "SENT TO MACHINE"}
                                                        </Badge>
                                                    </div>

                                                    <div className="space-y-3">
                                                        <div>
                                                            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-tight line-clamp-1">
                                                                {job.product_name || job.template_name}
                                                            </div>
                                                            <div className="text-[10px] font-black text-blue-600 uppercase tracking-widest mt-0.5">
                                                                {job.process_code}
                                                            </div>
                                                        </div>

                                                        <div className="pt-2 border-t border-slate-50">
                                                            <div className="flex items-center justify-between text-[11px] font-bold">
                                                                <span className="text-slate-400 uppercase tracking-wider">Produced</span>
                                                                <span className="text-slate-900">
                                                                    {formatSmartValue(Number(job.produced_qty || 0), String(job.uom || "KG").toUpperCase() as "KG" | "PCS", String(job.uom || "KG").toUpperCase() === "PCS" ? 0 : 1)} / {formatSmartValue(Number(job.quantity || 0), String(job.uom || "KG").toUpperCase() as "KG" | "PCS", String(job.uom || "KG").toUpperCase() === "PCS" ? 0 : 1)} {job.uom || "KG"}
                                                                </span>
                                                            </div>
                                                            <div className="mt-1.5 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                                                <div
                                                                    className={cn(
                                                                        "h-full rounded-full transition-all duration-1000",
                                                                        isRunning ? "bg-blue-500" : "bg-amber-400"
                                                                    )}
                                                                    style={{ width: `${Math.min(100, (Number(job.produced_qty || 0) / Number(job.quantity || 1)) * 100)}%` }}
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            )
                                        })}
                                </div>
                            </div>
                        )}

                        {/* Historical Log Section */}
                        <div className="space-y-4">
                            <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] px-1">Historical Log</h3>
                            <Card className="border-none shadow-xl shadow-slate-200/50 overflow-hidden bg-white/70 backdrop-blur-md rounded-[2rem]">
                                <CardContent className="p-0">
                                    <Table>
                                        <TableHeader className="bg-slate-50/50 border-b border-slate-100">
                                            <TableRow>
                                                <TableHead className="px-6 text-[10px] font-black uppercase text-slate-400 tracking-widest">Job Details</TableHead>
                                                <TableHead className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Machine</TableHead>
                                                <TableHead className="text-[10px] font-black uppercase text-slate-400 tracking-widest text-center">Outcome</TableHead>
                                                <TableHead className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Performance</TableHead>
                                                <TableHead className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Customer</TableHead>
                                                <TableHead className="px-6 text-[10px] font-black uppercase text-slate-400 tracking-widest text-right">Completed At</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody className="divide-y divide-slate-50">
                                            {(historyJobs || [])
                                                .filter((a: any) => ["COMPLETED", "CANCELLED"].includes(a.job_details?.job_state))
                                                .map((assignment: any) => {
                                                    const job = assignment.job_details || {}
                                                    const jobState = String(job.job_state || "").toUpperCase()
                                                    const isCompleted = jobState === "COMPLETED"

                                                    return (
                                                        <TableRow key={assignment.id} className="hover:bg-white transition-colors group">
                                                            <TableCell className="px-6 py-5">
                                                                <div className="text-sm font-black text-slate-900 group-hover:text-blue-600 transition-colors uppercase tracking-tight">
                                                                    {job.job_number}
                                                                </div>
                                                                <div className="text-[10px] font-bold text-slate-400 mt-0.5 line-clamp-1 uppercase">
                                                                    {job.product_name || job.template_name}
                                                                </div>
                                                            </TableCell>
                                                            <TableCell>
                                                                <div className="flex items-center gap-2">
                                                                    <div className="w-6 h-6 rounded-lg bg-slate-50 flex items-center justify-center">
                                                                        <Activity className="h-3 w-3 text-slate-400" />
                                                                    </div>
                                                                    <span className="text-[11px] font-black text-slate-700 uppercase">{assignment.assigned_machine_name}</span>
                                                                </div>
                                                            </TableCell>
                                                            <TableCell className="text-center">
                                                                <Badge className={cn(
                                                                    "text-[9px] font-black uppercase px-2 py-0 border",
                                                                    isCompleted ? "bg-emerald-50 text-emerald-600 border-emerald-100" : "bg-rose-50 text-rose-600 border-rose-100"
                                                                )}>
                                                                    {jobState}
                                                                </Badge>
                                                            </TableCell>
                                                            <TableCell>
                                                                <div className="space-y-1">
                                                                    <div className="text-[11px] font-black text-slate-800">
                                                                        {formatSmartValue(Number(job.produced_qty || 0), String(job.uom || "KG").toUpperCase() as "KG" | "PCS", String(job.uom || "KG").toUpperCase() === "PCS" ? 0 : 2)} {job.uom || "KG"}
                                                                    </div>
                                                                    <div className="h-1 w-24 bg-slate-100 rounded-full overflow-hidden">
                                                                        <div
                                                                            className="h-full bg-slate-300 rounded-full"
                                                                            style={{ width: `${Math.min(100, (Number(job.produced_qty || 0) / Number(job.quantity || 1)) * 100)}%` }}
                                                                        />
                                                                    </div>
                                                                </div>
                                                            </TableCell>
                                                            <TableCell>
                                                                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-tight max-w-[150px] truncate">
                                                                    {job.customer_name || "Internal Stock"}
                                                                </div>
                                                            </TableCell>
                                                            <TableCell className="px-6 text-right">
                                                                <div className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">
                                                                    {assignment.updated_at ? new Date(assignment.updated_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : "—"}
                                                                </div>
                                                            </TableCell>
                                                        </TableRow>
                                                    )
                                                })}
                                            {(historyJobs || []).filter((a: any) => ["COMPLETED", "CANCELLED"].includes(a.job_details?.job_state)).length === 0 && !isLoadingHistory && (
                                                <TableRow>
                                                    <TableCell colSpan={6} className="h-64 text-center">
                                                        <div className="flex flex-col items-center justify-center text-slate-400">
                                                            <div className="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center mb-4">
                                                                <History className="h-6 w-6 text-slate-200" />
                                                            </div>
                                                            <p className="text-xs font-black uppercase tracking-widest">No completed jobs records</p>
                                                        </div>
                                                    </TableCell>
                                                </TableRow>
                                            )}
                                        </TableBody>
                                    </Table>
                                </CardContent>
                            </Card>
                        </div>
                    </TabsContent>
                </Tabs>
            </div>
            {selectedJobId ? (
                <WcmRollPickerDialog
                    jobId={selectedJobId}
                    open={tieredPickerOpen}
                    onOpenChange={setTieredPickerOpen}
                    onAssigned={() => {
                        refetchContext()
                        refetchSatisfaction()
                        queryClient.invalidateQueries({ queryKey: ["wip-pool-grouped", selectedJobId] })
                    }}
                />
            ) : null}
        </div >
    )
}

function RollAssignmentModal({
    activeAssignment,
    targetSpec,
    targetSpecs = [],
    rollBehavior,
    targetPlantId,
    targetPlantName,
    targetLocationId,
    targetLocationName,
    manualEligibleRolls,
    wipPoolMeta = {},
    rollAssignmentValidation = {},
    onAssigned,
    disabled,
    disabledLabel = "ROLLS ASSIGNED",
    required,
    strictSpecMatch = true,
    manualOverride = false,
    overrideReason = ""
}: any) {
    const [open, setOpen] = useState(false)
    const [activeTab, setActiveTab] = useState<"local" | "external">("local")
    const [selectedRollIds, setSelectedRollIds] = useState<string[]>([])
    const [selectedExternalRollIds, setSelectedExternalRollIds] = useState<string[]>([])
    const [rollSearch, setRollSearch] = useState("")

    // New Precise Filters
    const [filterVariant, setFilterVariant] = useState<string>("ALL")
    const [filterThickness, setFilterThickness] = useState<string>("ALL")
    const [filterGrade, setFilterGrade] = useState<string>("ALL")
    const [filterWidth, setFilterWidth] = useState<string>("ALL")
    const [selectedTransferPlantId, setSelectedTransferPlantId] = useState<string>("")
    const [selectedSourceLocationId, setSelectedSourceLocationId] = useState<string>("ALL")
    const [selectedTargetLocationId, setSelectedTargetLocationId] = useState<string>(targetLocationId ? String(targetLocationId) : "")

    const queryClient = useQueryClient()
    const { toast } = useToast()
    const effectiveTargetPlantId = String(targetPlantId || activeAssignment?.plant_id || "")
    const behaviorNormalized = String(rollBehavior || "").trim().toUpperCase()
    const isMultiInputCombine = (
        behaviorNormalized === "MULTI_INPUT_COMBINE" ||
        behaviorNormalized === "MULTI_INPUT" ||
        (behaviorNormalized.includes("MULTI") && behaviorNormalized.includes("COMBINE"))
    )

    const mutation = useMutation({
        mutationFn: async (rollIds: string[]) => {
            if (manualOverride && !String(overrideReason || "").trim()) {
                throw new Error("Override reason is required for manual override.")
            }
            await wcmService.allocateRolls(activeAssignment.id, rollIds, {
                manual_override: manualOverride,
                override_reason: String(overrideReason || "").trim() || undefined
            })
        },
        onSuccess: () => {
            onAssigned()
            setOpen(false)
            setSelectedRollIds([])
            setSelectedExternalRollIds([])
            queryClient.invalidateQueries({ queryKey: ["wcm-queue"] })
            toast({ title: "Success", description: "Rolls assigned successfully." })
        },
        onError: (err: any) => {
            toast({ variant: "destructive", title: "Assignment Failed", description: err.response?.data?.error || "Error assigning rolls." })
        }
    })

    const variants = useMemo<string[]>(() => {
        const set = new Set(manualEligibleRolls.map((r: any) => String(r.material_name || r.material_code || "")))
        return (["ALL", ...Array.from(set).filter(Boolean).sort()] as string[])
    }, [manualEligibleRolls])
    const lineageCandidateCount = useMemo(
        () => manualEligibleRolls.filter((r: any) => String(r?.roll_source || '').toUpperCase() === 'LINEAGE').length,
        [manualEligibleRolls]
    )
    const fallbackCandidateCount = Math.max(
        0,
        manualEligibleRolls.length - lineageCandidateCount
    )
    const matchedSlotCount = Number((rollAssignmentValidation as any)?.matched_target_slots?.length || 0)
    const unmatchedSlotCount = Number((rollAssignmentValidation as any)?.unmatched_target_slots?.length || 0)

    const thicknesses = useMemo<string[]>(() => {
        const set = new Set(manualEligibleRolls.map((r: any) => String(r.thickness_micron || "")))
        return (["ALL", ...Array.from(set).filter(Boolean).sort()] as string[])
    }, [manualEligibleRolls])

    const grades = useMemo<string[]>(() => {
        const set = new Set(manualEligibleRolls.map((r: any) => String(r.grade_name || "")))
        return (["ALL", ...Array.from(set).filter(Boolean).sort()] as string[])
    }, [manualEligibleRolls])

    const widths = useMemo<string[]>(() => {
        const set = new Set(manualEligibleRolls.map((r: any) => String(r.width_mm || "")))
        return (["ALL", ...Array.from(set).filter(Boolean).sort()] as string[])
    }, [manualEligibleRolls])

    const normalizedSpecs = useMemo(() => {
        const list = Array.isArray(targetSpecs) && targetSpecs.length > 0 ? targetSpecs : [targetSpec]
        const byKey = new Map<string, any>()
        list.filter(Boolean).forEach((spec: any) => {
            const key = [
                String(spec?.variant_id || ""),
                String(spec?.family_id || ""),
                String(spec?.thickness_micron ?? "")
            ].join("|")
            if (!byKey.has(key)) {
                byKey.set(key, spec)
                return
            }
            const prev = byKey.get(key)
            const prevGrade = Boolean(prev?.grade_id)
            const nextGrade = Boolean(spec?.grade_id)
            const prevWidth = Number(prev?.min_width_mm || 0)
            const nextWidth = Number(spec?.min_width_mm || 0)
            if ((!prevGrade && nextGrade) || (nextGrade === prevGrade && nextWidth > prevWidth)) {
                byKey.set(key, spec)
            }
        })
        return Array.from(byKey.values())
    }, [targetSpec, targetSpecs])

    const { data: externalAvailability } = useQuery({
        queryKey: ["roll-allocation-external-availability", normalizedSpecs, effectiveTargetPlantId, isMultiInputCombine],
        queryFn: async () => {
            if (!effectiveTargetPlantId) return []
            const strictSingleSpec = normalizedSpecs.length === 1 && !isMultiInputCombine
            const single = strictSingleSpec ? normalizedSpecs[0] : null
            const { data } = await api.get("/api/inventory/rolls/availability/", {
                params: {
                    variant_id: single?.variant_id,
                    family_id: single?.family_id,
                    thickness_micron: single?.thickness_micron,
                    grade_id: single?.grade_id,
                    min_width_mm: single?.min_width_mm,
                    exclude_plant: effectiveTargetPlantId
                }
            })
            const primary = Array.isArray(data) ? data : []
            const primaryRolls = primary.reduce((sum: number, plant: any) => sum + Number(plant?.total_rolls || 0), 0)
            if (normalizedSpecs.length > 1 && primaryRolls <= 1) {
                const { data: broadData } = await api.get("/api/inventory/rolls/availability/", {
                    params: { exclude_plant: effectiveTargetPlantId }
                })
                const broad = Array.isArray(broadData) ? broadData : []
                const broadRolls = broad.reduce((sum: number, plant: any) => sum + Number(plant?.total_rolls || 0), 0)
                if (broadRolls > primaryRolls) return broad
            }
            return primary
        },
        enabled: open && Boolean(effectiveTargetPlantId)
    })

    const { data: targetLocations } = useQuery({
        queryKey: ["roll-allocation-target-locations", effectiveTargetPlantId],
        queryFn: async () => {
            if (!effectiveTargetPlantId) return []
            try {
                return await inventoryService.getLocations(String(effectiveTargetPlantId))
            } catch {
                return []
            }
        },
        enabled: open && Boolean(effectiveTargetPlantId)
    })

    const matchesAnyTargetSpec = (roll: any) => {
        if (!normalizedSpecs.length) return true
        return normalizedSpecs.some((spec: any) => {
            const variantOk = spec?.variant_id ? String(roll?.material_id || "") === String(spec.variant_id) : true
            const familyOk = spec?.family_id ? String(roll?.family_id || "") === String(spec.family_id) : true
            const materialOk = spec?.variant_id || spec?.family_id ? (variantOk || familyOk) : true
            const thicknessOk = spec?.thickness_micron != null
                ? Number(roll?.thickness_micron || 0) === Number(spec.thickness_micron)
                : true
            const gradeOk = spec?.grade_id
                ? String(roll?.grade_id || "") === String(spec.grade_id)
                : true
            const minWidth = spec?.min_width_mm != null ? Number(spec.min_width_mm) : null
            const maxAutoWidth = spec?.max_auto_width_mm != null ? Number(spec.max_auto_width_mm) : null
            const rollWidth = Number(roll?.width_mm || 0)
            const widthMinOk = minWidth != null ? rollWidth >= minWidth : true
            const widthMaxOk = (!strictSpecMatch || maxAutoWidth == null) ? true : rollWidth <= maxAutoWidth
            const widthOk = widthMinOk && widthMaxOk
            return materialOk && thicknessOk && gradeOk && widthOk
        })
    }

    const filtered = useMemo(() => {
        return manualEligibleRolls.filter((r: any) => {
            if (strictSpecMatch && !matchesAnyTargetSpec(r)) return false
            if (filterVariant !== "ALL" && (r.material_name !== filterVariant && r.material_code !== filterVariant)) return false
            if (filterThickness !== "ALL" && String(r.thickness_micron) !== filterThickness) return false
            if (filterGrade !== "ALL" && r.grade_name !== filterGrade) return false
            if (filterWidth !== "ALL" && String(r.width_mm) !== filterWidth) return false

            const q = rollSearch.toLowerCase().trim()
            if (q) {
                const searchStr = `${r.label_id} ${r.material_name} ${r.material_code} ${r.family_name}`.toLowerCase()
                if (!searchStr.includes(q)) return false
            }
            return true
        })
    }, [manualEligibleRolls, filterVariant, filterThickness, filterGrade, filterWidth, rollSearch, normalizedSpecs, strictSpecMatch])

    const transferPlantOptions = useMemo(() => {
        const rows = Array.isArray(externalAvailability) ? externalAvailability : []
        return rows
            .filter((p: any) => Number(p?.total_rolls || 0) > 0)
            .map((p: any) => ({
                id: String(p.plant_id),
                name: String(p.plant_name || p.plant_id || "Plant"),
                totalRolls: Number(p.total_rolls || 0),
                totalWeightKg: Number(p.total_weight_kg || 0),
                rolls: Array.isArray(p.rolls) ? p.rolls : []
            }))
            .sort((a: any, b: any) => Number(b.totalWeightKg || 0) - Number(a.totalWeightKg || 0))
    }, [externalAvailability])

    const selectedTransferPlant = useMemo(
        () => transferPlantOptions.find((p: any) => String(p.id) === String(selectedTransferPlantId)),
        [transferPlantOptions, selectedTransferPlantId]
    )

    const sourceLocationOptions = useMemo(() => {
        const rows = Array.isArray(selectedTransferPlant?.rolls) ? selectedTransferPlant.rolls : []
        const map = new Map<string, string>()
        rows.forEach((roll: any) => {
            const locationId = String(roll.location_id || "")
            const locationName = String(roll.location_name || "Location")
            if (locationId) map.set(locationId, locationName)
        })
        return Array.from(map.entries()).map(([id, name]) => ({ id, name }))
    }, [selectedTransferPlant])

    const filteredExternalRolls = useMemo(() => {
        const rows = Array.isArray(selectedTransferPlant?.rolls) ? selectedTransferPlant.rolls : []
        return rows.filter((r: any) => {
            if (strictSpecMatch && !matchesAnyTargetSpec(r)) return false
            if (selectedSourceLocationId !== "ALL" && String(r.location_id || "") !== String(selectedSourceLocationId)) return false
            if (filterVariant !== "ALL" && (String(r.material_name || "") !== filterVariant && String(r.material_code || "") !== filterVariant)) return false
            if (filterThickness !== "ALL" && String(r.thickness_micron || "") !== filterThickness) return false
            if (filterGrade !== "ALL" && String(r.grade_name || "") !== filterGrade) return false
            if (filterWidth !== "ALL" && String(r.width_mm || "") !== filterWidth) return false
            const q = rollSearch.toLowerCase().trim()
            if (q) {
                const searchStr = `${r.label_id} ${r.material_name} ${r.material_code} ${r.location_name}`.toLowerCase()
                if (!searchStr.includes(q)) return false
            }
            return true
        })
    }, [selectedTransferPlant, selectedSourceLocationId, strictSpecMatch, filterVariant, filterThickness, filterGrade, filterWidth, rollSearch, normalizedSpecs])

    const externalEligibleCount = useMemo(() => {
        const rows = Array.isArray(externalAvailability) ? externalAvailability : []
        let total = 0
        rows.forEach((plant: any) => {
            const rolls = Array.isArray(plant?.rolls) ? plant.rolls : []
            rolls.forEach((roll: any) => {
                if (!strictSpecMatch || matchesAnyTargetSpec(roll)) total += 1
            })
        })
        return total
    }, [externalAvailability, strictSpecMatch, normalizedSpecs])

    const normalizedTargetLocations = useMemo(() => {
        const rows = Array.isArray(targetLocations) ? targetLocations : []
        const normalized = rows
            .map((loc: any) => ({
                id: String(loc.id || loc.location_id || ""),
                name: String(loc.name || loc.location_name || loc.code || "Location")
            }))
            .filter((loc: any) => loc.id)
        const preset = targetLocationId ? String(targetLocationId) : ""
        if (preset && !normalized.some((loc: any) => loc.id === preset)) {
            normalized.unshift({ id: preset, name: String(targetLocationName || `Location ${preset.slice(0, 8)}`) })
        }
        return normalized
    }, [targetLocations, targetLocationId, targetLocationName])

    const transferMutation = useMutation({
        mutationFn: async () => {
            if (!selectedTransferPlantId || selectedExternalRollIds.length === 0) {
                throw new Error("Select source plant and at least one roll")
            }
            const destinationLocationId = String(selectedTargetLocationId || targetLocationId || "")
            if (!destinationLocationId) {
                throw new Error("Target location missing")
            }
            const challan = await inventoryService.createChallan({
                from_plant: selectedTransferPlantId,
                to_plant: effectiveTargetPlantId
            })
            const challanId = (challan as any)?.data?.id || (challan as any)?.id
            await inventoryService.dispatchChallan(challanId, {
                target_location_id: destinationLocationId,
                roll_ids: selectedExternalRollIds
            })
        },
        onSuccess: () => {
            toast({ title: "Transfer Requested", description: "DC created for selected rolls. Receive it, then allocate." })
            setOpen(false)
            setSelectedExternalRollIds([])
            onAssigned()
        },
        onError: (err: any) => {
            toast({ variant: "destructive", title: "Transfer Failed", description: err?.message || err?.response?.data?.error || "Unable to create roll transfer." })
        }
    })

    const toggleRoll = (rollId: string) => {
        setSelectedRollIds((prev) => {
            if (prev.includes(rollId)) return prev.filter((id) => id !== rollId)
            return [...prev, rollId]
        })
    }

    const toggleExternalRoll = (rollId: string) => {
        setSelectedExternalRollIds((prev) => {
            if (prev.includes(rollId)) return prev.filter((id) => id !== rollId)
            return [...prev, rollId]
        })
    }

    useEffect(() => {
        if (!open) return
        if (filtered.length === 0 && externalEligibleCount > 0) {
            setActiveTab("external")
        } else {
            setActiveTab("local")
        }
        setSelectedRollIds([])
        setSelectedExternalRollIds([])
    }, [open])

    useEffect(() => {
        if (!open) return
        if (selectedRollIds.length > 0 || selectedExternalRollIds.length > 0) return
        if (filtered.length === 0 && externalEligibleCount > 0) {
            setActiveTab("external")
        } else {
            setActiveTab("local")
        }
    }, [open, filtered.length, externalEligibleCount, selectedRollIds.length, selectedExternalRollIds.length])

    useEffect(() => {
        if (!open) return
        if (!transferPlantOptions.length) {
            setSelectedTransferPlantId("")
            setSelectedSourceLocationId("ALL")
            return
        }
        if (!transferPlantOptions.some((p: any) => String(p.id) === String(selectedTransferPlantId))) {
            setSelectedTransferPlantId(String(transferPlantOptions[0].id))
            setSelectedSourceLocationId("ALL")
        }
    }, [open, transferPlantOptions, selectedTransferPlantId])

    useEffect(() => {
        if (!open) return
        setSelectedSourceLocationId("ALL")
        setSelectedExternalRollIds([])
    }, [open, selectedTransferPlantId])

    useEffect(() => {
        if (!open) return
        const preset = targetLocationId ? String(targetLocationId) : ""
        if (preset && normalizedTargetLocations.some((loc: any) => String(loc.id) === preset)) {
            setSelectedTargetLocationId(preset)
            return
        }
        if (normalizedTargetLocations.length > 0 && !normalizedTargetLocations.some((loc: any) => String(loc.id) === String(selectedTargetLocationId))) {
            setSelectedTargetLocationId(String(normalizedTargetLocations[0].id))
        }
    }, [open, normalizedTargetLocations, selectedTargetLocationId, targetLocationId])

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => setOpen(true)}
                className="h-7 border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100 font-bold px-3 disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {disabled ? disabledLabel : "ALLOCATE ROLLS"}
            </Button>
                <DialogContent data-testid="wcm-allocation-dialog" className="flex h-[min(85vh,900px)] max-h-[85vh] max-w-5xl flex-col overflow-hidden p-0">
                <DialogHeader className="p-6 bg-slate-50 border-b shrink-0">
                    <DialogTitle className="flex items-center gap-2">
                        Resource Discovery & Allocation
                        <Badge variant="secondary" className="font-mono text-[10px]">{activeAssignment?.job_details?.job_number}</Badge>
                    </DialogTitle>
                    <DialogDescription>
                        Select roll inputs matching BOM specs. Allocation persists as WCM reservation.
                    </DialogDescription>
                    <div className="mt-2 text-[11px] text-slate-500">
                        Spec: {normalizedSpecs.length > 0
                            ? normalizedSpecs.map((s: any) => (
                                [
                                    s.variant_name || s.family_name || "Roll",
                                    s.thickness_micron ? `${s.thickness_micron}μ` : null,
                                    s.grade_name || (s.grade_id ? "Grade: required" : null)
                                ].filter(Boolean).join(" • ")
                            )).join("  |  ")
                            : "—"}
                        {normalizedSpecs.some((s: any) => s?.min_width_mm != null)
                            ? ` • Min Width: ${Number(normalizedSpecs.map((s: any) => s?.min_width_mm || 0).filter((v: number) => v > 0).sort((a: number, b: number) => a - b)[0] || 0).toFixed(0)}mm`
                            : ""}
                    </div>
                    {required && filtered.length === 0 && externalEligibleCount > 0 && (
                        <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-800">
                            No eligible roll in current plant. Open <span className="font-bold">Other Plants / Transfer</span> tab to raise transfer request.
                        </div>
                    )}
                    <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
                        <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
                            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">True WIP</div>
                            <div className="mt-2 text-2xl font-black text-slate-900">{Number((wipPoolMeta as any)?.lineage_roll_count || lineageCandidateCount || 0)}</div>
                            <div className="text-[11px] text-slate-500">Strict lineage choices</div>
                        </div>
                        <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-3">
                            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-700">Fallback</div>
                            <div className="mt-2 text-2xl font-black text-amber-900">{Number((wipPoolMeta as any)?.fallback_roll_count || fallbackCandidateCount || 0)}</div>
                            <div className="text-[11px] text-amber-700">Manual assignment only</div>
                        </div>
                        <div className="rounded-xl border border-blue-200 bg-blue-50/70 px-3 py-3">
                            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-blue-700">Required</div>
                            <div className="mt-2 text-2xl font-black text-blue-900">{Number(required || 0)}</div>
                            <div className="text-[11px] text-blue-700">Rolls needed for this step</div>
                        </div>
                        <div className="rounded-xl border border-slate-900 bg-slate-900 px-3 py-3 text-white">
                            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-300">Slot Coverage</div>
                            <div className="mt-2 text-2xl font-black">{matchedSlotCount}/{Math.max(Number(required || 0), Number((rollAssignmentValidation as any)?.required_rolls || 0))}</div>
                            <div className="text-[11px] text-slate-300">
                                {unmatchedSlotCount > 0 ? `${unmatchedSlotCount} target slot(s) still open` : "Current set maps cleanly"}
                            </div>
                        </div>
                    </div>
                    <div className="mt-4 grid grid-cols-5 gap-4">
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-black text-slate-500 uppercase">Search</label>
                            <div className="relative">
                                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                                <Input placeholder="Roll ID / Label..." value={rollSearch} onChange={e => setRollSearch(e.target.value)} className="h-9 pl-9" />
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-black text-slate-500 uppercase">Variant</label>
                            <Select value={filterVariant} onValueChange={setFilterVariant}>
                                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                                <SelectContent>{variants.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-black text-slate-500 uppercase">Thickness</label>
                            <Select value={filterThickness} onValueChange={setFilterThickness}>
                                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                                <SelectContent>{thicknesses.map(t => <SelectItem key={t} value={t}>{t === "ALL" ? t : `${t}μ`}</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-black text-slate-500 uppercase">Grade</label>
                            <Select value={filterGrade} onValueChange={setFilterGrade}>
                                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                                <SelectContent>{grades.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-black text-slate-500 uppercase">Width</label>
                            <Select value={filterWidth} onValueChange={setFilterWidth}>
                                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                                <SelectContent>{widths.map(w => <SelectItem key={w} value={w}>{w === "ALL" ? w : `${w}mm`}</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                    </div>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto bg-white p-6 pb-28">
                    <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "local" | "external")} className="space-y-4">
                        <TabsList className="grid w-full grid-cols-2">
                            <TabsTrigger value="local" className="text-xs font-bold">
                                Current Plant ({filtered.length})
                            </TabsTrigger>
                            <TabsTrigger value="external" className="text-xs font-bold">
                                Other Plants / Transfer ({externalEligibleCount})
                            </TabsTrigger>
                        </TabsList>

                        <TabsContent value="local" className="space-y-3">
                            <div className="grid grid-cols-1 gap-3">
                                {filtered.map((roll: any) => {
                                    const rollId = String(roll.id)
                                    return (
                                        <div
                                            key={rollId}
                                            data-testid={`wcm-local-roll-select-${rollId}`}
                                            data-roll-id={rollId}
                                            onClick={() => toggleRoll(rollId)}
                                            className={cn(
                                                "flex items-center gap-4 p-4 rounded-xl border-2 transition-all cursor-pointer group",
                                                selectedRollIds.includes(rollId)
                                                    ? "border-blue-500 bg-blue-50/30 shadow-sm"
                                                    : "border-slate-100 hover:border-slate-200"
                                            )}
                                        >
                                            <div className={cn(
                                                "h-6 w-6 rounded-md border-2 flex items-center justify-center transition-all",
                                                selectedRollIds.includes(rollId)
                                                    ? "bg-blue-600 border-blue-600 text-white"
                                                    : "bg-white border-slate-200 group-hover:border-blue-300"
                                            )}>
                                                {selectedRollIds.includes(rollId) && <CheckCircle2 className="h-4 w-4" />}
                                            </div>
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className="text-sm font-black text-slate-900 uppercase">{roll.label_id}</span>
                                                    {roll.spec_exact && <Badge className="bg-emerald-100 text-emerald-700 text-[10px] font-bold">EXACT MATCH</Badge>}
                                                    {String(roll.roll_source || "").toUpperCase() === "LINEAGE" && (
                                                        <Badge className="bg-slate-900 text-white text-[10px] font-bold">TRUE WIP</Badge>
                                                    )}
                                                    {String(roll.roll_source || "").toUpperCase() === "PURCHASED_FALLBACK" && (
                                                        <Badge className="bg-amber-100 text-amber-800 text-[10px] font-bold">PURCHASED FALLBACK</Badge>
                                                    )}
                                                    {String(roll.roll_source || "").toUpperCase() === "COMPATIBLE_FALLBACK" && (
                                                        <Badge className="bg-blue-100 text-blue-700 text-[10px] font-bold">COMPATIBLE FALLBACK</Badge>
                                                    )}
                                                </div>
                                                <div className="text-[11px] font-medium text-slate-600">
                                                    {roll.material_name} • {roll.thickness_micron}μ • {roll.width_mm}mm • Grade: {roll.grade_name || "—"}
                                                </div>
                                                <div className="text-[10px] text-slate-400 font-bold uppercase mt-1">
                                                    Loc: {roll.location || roll.location_name} {roll.location_type ? `(${roll.location_type})` : ""}
                                                </div>
                                            </div>
                                            <div className="flex shrink-0 flex-col items-end gap-2 text-right">
                                                <div className="text-lg font-black text-slate-900 leading-none">{roll.weight_kg} <span className="text-[10px] text-slate-500">KG</span></div>
                                                <div className="text-xs font-bold text-slate-500">{roll.width_mm} <span className="text-[10px]">MM</span></div>
                                                <Button
                                                    size="sm"
                                                    variant={selectedRollIds.includes(rollId) ? "default" : "outline"}
                                                    className={cn(
                                                        "relative z-10 h-7 shrink-0 px-4 text-[10px] font-black uppercase tracking-tighter",
                                                        selectedRollIds.includes(rollId) ? "bg-blue-600" : "text-blue-600 border-blue-200"
                                                    )}
                                                    onClick={(e) => {
                                                        e.preventDefault()
                                                        e.stopPropagation()
                                                        toggleRoll(rollId)
                                                    }}
                                                >
                                                    {selectedRollIds.includes(rollId) ? "SELECTED" : "SELECT"}
                                                </Button>
                                            </div>
                                        </div>
                                    )
                                })}
                                {filtered.length === 0 && (
                                    <div className="text-center py-20 text-slate-400">
                                        <Activity className="h-12 w-12 mx-auto mb-4 opacity-10" />
                                        <p className="font-bold">No eligible rolls in current plant with current filters</p>
                                        {externalEligibleCount > 0 && (
                                            <Button variant="outline" className="mt-4 text-xs" onClick={() => setActiveTab("external")}>
                                                View Other Plants & Request Transfer
                                            </Button>
                                        )}
                                    </div>
                                )}
                            </div>
                        </TabsContent>

                        <TabsContent value="external" className="space-y-3">
                            <div className="grid grid-cols-3 gap-3">
                                <div>
                                    <label className="text-[10px] font-black uppercase text-slate-500">From Plant</label>
                                    <Select value={selectedTransferPlantId} onValueChange={(val) => { setSelectedTransferPlantId(val); setSelectedExternalRollIds([]) }}>
                                        <SelectTrigger className="h-9"><SelectValue placeholder="Select plant" /></SelectTrigger>
                                        <SelectContent>
                                            {transferPlantOptions.map((p: any) => (
                                                <SelectItem key={p.id} value={p.id}>
                                                    {p.name} ({p.totalRolls} rolls, {p.totalWeightKg.toFixed(1)} kg)
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div>
                                    <label className="text-[10px] font-black uppercase text-slate-500">From Location</label>
                                    <Select value={selectedSourceLocationId} onValueChange={setSelectedSourceLocationId}>
                                        <SelectTrigger className="h-9"><SelectValue placeholder="All locations" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="ALL">All locations</SelectItem>
                                            {sourceLocationOptions.map((loc: any) => (
                                                <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div>
                                    <label className="text-[10px] font-black uppercase text-slate-500">To Location</label>
                                    <Select value={selectedTargetLocationId} onValueChange={setSelectedTargetLocationId}>
                                        <SelectTrigger className="h-9"><SelectValue placeholder="Select location" /></SelectTrigger>
                                        <SelectContent>
                                            {normalizedTargetLocations.map((loc: any) => (
                                                <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <div className="text-[11px] text-slate-500">
                                Destination plant: <span className="font-bold text-slate-800">{targetPlantName || targetPlantId || "—"}</span>
                            </div>
                            <div className="space-y-2 max-h-[360px] overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3">
                                {filteredExternalRolls.length === 0 && (
                                    <div className="text-center py-14 text-slate-400">
                                        <p className="font-bold">No transferable rolls found in other plants for this spec.</p>
                                    </div>
                                )}
                                {filteredExternalRolls.map((roll: any) => {
                                    const rollId = String(roll.id)
                                    const checked = selectedExternalRollIds.includes(rollId)
                                    return (
                                        <div
                                            key={rollId}
                                            onClick={() => toggleExternalRoll(rollId)}
                                            className={cn(
                                                "flex items-center justify-between rounded-lg border p-3 bg-white cursor-pointer",
                                                checked ? "border-amber-400 bg-amber-50/40" : "border-slate-200"
                                            )}
                                        >
                                            <div className="flex items-center gap-3">
                                                <div onClick={(e) => e.stopPropagation()}>
                                                    <Checkbox checked={checked} onCheckedChange={() => toggleExternalRoll(rollId)} />
                                                </div>
                                                <div>
                                                    <div className="text-xs font-black text-slate-900 uppercase">{roll.label_id}</div>
                                                    <div className="text-[11px] text-slate-600">
                                                        {roll.material_name} • {roll.thickness_micron}μ • {roll.width_mm}mm • {roll.grade_name || "—"}
                                                    </div>
                                                    <div className="text-[10px] font-medium text-slate-500">{roll.location_name || "—"}</div>
                                                </div>
                                            </div>
                                            <div className="text-right text-xs font-bold text-slate-700">
                                                {Number(roll.weight_kg || 0).toFixed(3)} kg
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        </TabsContent>
                    </Tabs>
                </div>

                <div className="p-6 bg-slate-50 border-t shrink-0 flex justify-between items-center">
                    <div className="text-sm">
                        {activeTab === "local" ? (
                            <>
                                <span className="font-bold text-slate-900">{selectedRollIds.length}</span> rolls selected for allocation
                            </>
                        ) : (
                            <>
                                <span className="font-bold text-slate-900">{selectedExternalRollIds.length}</span> rolls selected for transfer
                            </>
                        )}
                    </div>
                    <div className="flex gap-3">
                        <Button variant="ghost" onClick={() => setOpen(false)} className="font-bold">CANCEL</Button>
                        {activeTab === "local" ? (
                            <Button
                                className="bg-blue-600 hover:bg-blue-700 font-black px-8"
                                disabled={
                                    selectedRollIds.length === 0
                                    || mutation.isPending
                                    || (manualOverride && !String(overrideReason || "").trim())
                                }
                                onClick={() => mutation.mutate(selectedRollIds)}
                            >
                                {mutation.isPending ? <Loader2 className="animate-spin" /> : "FINALIZE ALLOCATION"}
                            </Button>
                        ) : (
                            <Button
                                className="bg-amber-600 hover:bg-amber-700 text-white font-black px-8"
                                disabled={
                                    selectedExternalRollIds.length === 0
                                    || transferMutation.isPending
                                    || !selectedTransferPlantId
                                    || !selectedTargetLocationId
                                }
                                onClick={() => transferMutation.mutate()}
                            >
                                {transferMutation.isPending ? <Loader2 className="animate-spin" /> : "CREATE TRANSFER REQUEST"}
                            </Button>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog >
    )
}

function BulkTransferModal({ row, targetPlantId, targetPlantName, targetLocationId, targetLocationName, onRequested }: any) {
    const [open, setOpen] = useState(false)
    const [selectedPlantId, setSelectedPlantId] = useState<string>("")
    const [selectedLocationId, setSelectedLocationId] = useState<string>("")
    const [selectedMaterialId, setSelectedMaterialId] = useState<string>(row.materialId ? String(row.materialId) : "")
    const effectiveTargetPlantId = targetPlantId ? String(targetPlantId) : ""
    const [selectedTargetLocationId, setSelectedTargetLocationId] = useState<string>(targetLocationId ? String(targetLocationId) : "")
    const [qty, setQty] = useState<number>(Math.max(0, Number(row.required || 0) - Number(row.localAvailable || 0)))
    const { toast } = useToast()
    const requiresMaterialSelection = !row.materialId
    const effectiveMaterialId = String((requiresMaterialSelection ? selectedMaterialId : row.materialId) || "")

    const { data: bulkCatalog } = useQuery({
        queryKey: ["bulk-transfer-catalog"],
        queryFn: () => inventoryService.getBulkStock(),
        enabled: open
    })

    const { data: availability } = useQuery({
        queryKey: ["bulk-availability", effectiveMaterialId, effectiveTargetPlantId],
        queryFn: async () => {
            if (!effectiveMaterialId) return []
            const { data } = await api.get("/api/inventory/stock/bulk-availability/", {
                params: {
                    material_id: effectiveMaterialId,
                    exclude_plant: effectiveTargetPlantId || undefined
                }
            })
            return data
        },
        enabled: open && Boolean(effectiveMaterialId)
    })

    const { data: plants } = useQuery({
        queryKey: ["plants-for-transfer"],
        queryFn: async () => {
            const { data } = await api.get("/api/factory/plants/")
            return Array.isArray(data) ? data : (Array.isArray((data as any)?.results) ? (data as any).results : [])
        },
        enabled: open
    })

    const { data: targetLocations } = useQuery({
        queryKey: ["target-locations-for-transfer", effectiveTargetPlantId],
        queryFn: async () => {
            if (!effectiveTargetPlantId) return []
            const normalize = (payload: any) => {
                if (Array.isArray(payload)) return payload
                if (payload && typeof payload === "object" && Array.isArray((payload as any).results)) return (payload as any).results
                return []
            }

            const scopedResp = await api.get("/api/factory/locations/", { params: { plant: effectiveTargetPlantId } })
            let rows = normalize(scopedResp.data)

            if (rows.length === 0) {
                // Fallback: fetch full list and filter by plant when backend ignores `plant` param.
                const fullResp = await api.get("/api/factory/locations/")
                const allRows = normalize(fullResp.data)
                rows = allRows.filter((loc: any) => {
                    const plantValue = String(loc?.plant || loc?.plant_id || loc?.plant?.id || "")
                    return plantValue === String(effectiveTargetPlantId)
                })
            }

            if (rows.length === 0) {
                // Final fallback via inventory locations endpoint.
                const invRows = await inventoryService.getLocations(effectiveTargetPlantId)
                rows = Array.isArray(invRows) ? invRows : []
            }

            return rows
        },
        enabled: open && Boolean(effectiveTargetPlantId)
    })

    const selectedPlant = (availability || []).find((p: any) => String(p.plant_id) === String(selectedPlantId))
    const locationsRaw = selectedPlant?.locations || []
    const locationsFromAvailability = Array.isArray(locationsRaw) ? locationsRaw.map((l: any) => ({
        location_id: String(l.location_id || l.location || l.id || ""),
        location_name: l.location_name || l.name || l.code || "Location",
        quantity: Number(l.quantity ?? l.qty_kg ?? l.available_qty ?? 0)
    })).filter((l: any) => l.location_id) : []
    const locations = locationsFromAvailability
        .filter((l: any) => Number(l.quantity || 0) > 0.001)
        .sort((a: any, b: any) => Number(b.quantity || 0) - Number(a.quantity || 0))
    const resolvedTargetPlantName = targetPlantName || (plants || []).find((p: any) => String(p.id) === String(effectiveTargetPlantId))?.name || effectiveTargetPlantId || "—"
    const materialOptions = useMemo(() => {
        const rows = Array.isArray(bulkCatalog) ? bulkCatalog : []
        const map = new Map<string, string>()
        rows.forEach((item: any) => {
            const id = String(item.material || item.material_id || "").trim()
            const label = String(item.material_name || item.material_code || "").trim()
            if (!id || !label) return
            if (Number(item.qty_kg || 0) <= 0) return
            if (!map.has(id)) map.set(id, label)
        })
        return Array.from(map.entries()).map(([id, label]) => ({ id, label }))
    }, [bulkCatalog])
    const selectedMaterialLabel = useMemo(() => {
        if (!effectiveMaterialId) return row.material || "—"
        const hit = materialOptions.find((m) => m.id === effectiveMaterialId)
        return hit?.label || row.material || "—"
    }, [effectiveMaterialId, materialOptions, row.material])
    const sourcePlantOptions = useMemo(() => {
        return Array.isArray(availability)
            ? [...availability]
                .filter((p: any) => Number(p?.total_qty || 0) > 0.001)
                .sort((a: any, b: any) => Number(b.total_qty || 0) - Number(a.total_qty || 0))
                .map((p: any) => ({
                    id: String(p.plant_id),
                    name: String(p.plant_name || p.plant_id || "Plant"),
                    totalQty: Number(p.total_qty || 0),
                    qtyLabel: `${Number(p.total_qty || 0).toFixed(1)} kg`
                }))
            : []
    }, [availability, plants, effectiveTargetPlantId])
    const normalizedTargetLocations = useMemo(() => {
        const rows = Array.isArray(targetLocations) ? targetLocations : []
        const normalized = rows
            .map((loc: any) => ({
                id: String(loc.id || loc.location_id || ""),
                name: String(loc.name || loc.location_name || loc.code || loc.location_id || loc.id || "Location")
            }))
            .filter((loc: any) => loc.id)
        const preset = targetLocationId ? String(targetLocationId) : ""
        if (preset && !normalized.some((loc: any) => loc.id === preset)) {
            normalized.unshift({
                id: preset,
                name: String(targetLocationName || `Location ${preset.slice(0, 8)}`)
            })
        }
        return normalized
    }, [targetLocations, targetLocationId, targetLocationName])

    useEffect(() => {
        if (!open) return
        if (requiresMaterialSelection && !selectedMaterialId && materialOptions.length > 0) {
            setSelectedMaterialId(materialOptions[0].id)
        }
    }, [open, requiresMaterialSelection, selectedMaterialId, materialOptions])

    useEffect(() => {
        if (!open) return

        if (!sourcePlantOptions.length) {
            setSelectedPlantId("")
            setSelectedLocationId("")
            return
        }
        if (!sourcePlantOptions.some((p: any) => String(p.id) === String(selectedPlantId))) {
            setSelectedPlantId(String(sourcePlantOptions[0].id))
            setSelectedLocationId("")
        }
    }, [open, selectedPlantId, sourcePlantOptions])

    useEffect(() => {
        if (!open) return
        if (!selectedPlantId || locations.length === 0) {
            setSelectedLocationId("")
            return
        }
        const hasSelected = locations.some((l: any) => String(l.location_id) === String(selectedLocationId))
        if (!hasSelected) {
            setSelectedLocationId(String(locations[0].location_id))
        }
    }, [open, selectedPlantId, selectedLocationId, locations])

    useEffect(() => {
        if (!open) return
        setSelectedPlantId("")
        setSelectedLocationId("")
    }, [open, effectiveMaterialId])

    useEffect(() => {
        if (!open) return
        const locations = normalizedTargetLocations
        const preset = targetLocationId ? String(targetLocationId) : ""
        if (preset && locations.some((l: any) => String(l.id) === preset)) {
            setSelectedTargetLocationId(preset)
            return
        }
        if (locations.length > 0 && !locations.some((l: any) => String(l.id) === String(selectedTargetLocationId))) {
            setSelectedTargetLocationId(String(locations[0].id))
        }
    }, [open, normalizedTargetLocations, targetLocationId, selectedTargetLocationId])

    const shortageQty = useMemo(
        () => Math.max(0, Number(row.required || 0) - Number(row.localAvailable || 0)),
        [row.required, row.localAvailable]
    )
    const selectedLocationAvailableQty = useMemo(() => {
        const hit = locations.find((l: any) => String(l.location_id) === String(selectedLocationId))
        return Number(hit?.quantity || 0)
    }, [locations, selectedLocationId])

    useEffect(() => {
        if (!open) return
        let nextQty = shortageQty
        if (selectedLocationAvailableQty > 0) {
            nextQty = Math.min(nextQty, selectedLocationAvailableQty)
        }
        if (!Number.isFinite(nextQty) || nextQty < 0) nextQty = 0
        setQty(Number(nextQty.toFixed(3)))
    }, [open, shortageQty, selectedPlantId, selectedLocationId, selectedLocationAvailableQty])

    const mutation = useMutation({
        mutationFn: async () => {
            if (!selectedPlantId || !selectedLocationId) {
                throw new Error("Select source plant and location")
            }
            if (!effectiveMaterialId) {
                throw new Error("Select a material")
            }
            const effectiveTargetLocationId = String(selectedTargetLocationId || targetLocationId || "")
            if (!effectiveTargetPlantId || !effectiveTargetLocationId) {
                throw new Error("Target plant/location missing")
            }
            if (!qty || qty <= 0) {
                throw new Error("Quantity must be > 0")
            }
            const selectedLocation = locations.find((l: any) => String(l.location_id) === String(selectedLocationId))
            const maxAvailable = Number(selectedLocation?.quantity || 0)
            if (maxAvailable > 0 && Number(qty) > maxAvailable) {
                throw new Error(`Quantity exceeds source location stock (${maxAvailable.toFixed(3)} kg).`)
            }
            if (String(selectedPlantId) === String(effectiveTargetPlantId) && String(selectedLocationId) === String(effectiveTargetLocationId)) {
                throw new Error("Source and destination locations must be different.")
            }

            if (String(selectedPlantId) === String(effectiveTargetPlantId)) {
                await api.post("/api/inventory/bulk/transfer/", {
                    material_id: effectiveMaterialId,
                    qty,
                    from_location_id: selectedLocationId,
                    to_location_id: effectiveTargetLocationId,
                    reference: "WCM-LOCAL-TRANSFER"
                })
            } else {
                const challan = await inventoryService.createChallan({
                    from_plant: selectedPlantId,
                    to_plant: effectiveTargetPlantId
                })

                const challanId = (challan as any)?.data?.id || (challan as any)?.id
                await inventoryService.dispatchChallan(challanId, {
                    target_location_id: effectiveTargetLocationId,
                    bulk_items: [{
                        material_id: effectiveMaterialId,
                        quantity: qty,
                        location_id: selectedLocationId
                    }]
                })
            }
        },
        onSuccess: () => {
            if (String(selectedPlantId) === String(effectiveTargetPlantId)) {
                toast({ title: "Material Moved", description: "Bulk moved to the required source location." })
            } else {
                toast({ title: "Transfer Requested", description: "DC created and dispatched from source plant." })
            }
            setOpen(false)
            if (onRequested) onRequested()
        },
        onError: (err: any) => {
            toast({ variant: "destructive", title: "Transfer Failed", description: err.message || err.response?.data?.error || "Unknown error" })
        }
    })

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button size="sm" variant="outline" className="h-7 text-[10px] font-black text-amber-700 border-amber-200 bg-amber-50 hover:bg-amber-100">
                    TRANSFER
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl">
                <DialogHeader>
                    <DialogTitle>Request Inter-Plant Transfer</DialogTitle>
                    <DialogDescription>
                        Move current-step bulk to the required source location. Same plant uses stock move, different plant creates a DC.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="space-y-1">
                        <label className="text-[10px] font-black uppercase text-slate-500">Material</label>
                        {requiresMaterialSelection ? (
                            <Select value={selectedMaterialId} onValueChange={setSelectedMaterialId}>
                                <SelectTrigger className="h-10"><SelectValue placeholder="Select material" /></SelectTrigger>
                                <SelectContent>
                                    {materialOptions.map((m) => (
                                        <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        ) : (
                            <Input value={selectedMaterialLabel} readOnly className="h-10 bg-slate-50" />
                        )}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-[10px] font-black uppercase text-slate-500">From Plant</label>
                            <Select value={selectedPlantId} onValueChange={(val) => { setSelectedPlantId(val); setSelectedLocationId("") }}>
                                <SelectTrigger className="h-10"><SelectValue placeholder="Select Plant" /></SelectTrigger>
                                <SelectContent>
                                    {sourcePlantOptions.map((p: any) => (
                                        <SelectItem key={String(p.id)} value={String(p.id)}>
                                            {p.name} ({p.qtyLabel})
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {sourcePlantOptions.length === 0 && (
                                <div className="text-[10px] text-slate-400 mt-1">No eligible source plant found for this transfer.</div>
                            )}
                        </div>
                        <div>
                            <label className="text-[10px] font-black uppercase text-slate-500">From Location</label>
                            <Select value={selectedLocationId} onValueChange={setSelectedLocationId}>
                                <SelectTrigger className="h-10"><SelectValue placeholder="Select Location" /></SelectTrigger>
                                <SelectContent>
                                    {locations.map((l: any) => (
                                        <SelectItem key={String(l.location_id)} value={String(l.location_id)}>
                                            {l.location_name}{l.quantity != null ? ` (${Number(l.quantity || 0).toFixed(1)} kg)` : ""}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {locations.length === 0 && (
                                <div className="text-[10px] text-slate-400 mt-1">No locations with stock found.</div>
                            )}
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-[10px] font-black uppercase text-slate-500">To Plant</label>
                            <Input value={resolvedTargetPlantName} readOnly className="h-10 bg-slate-50" />
                        </div>
                        <div>
                            <label className="text-[10px] font-black uppercase text-slate-500">To Location</label>
                            {normalizedTargetLocations.length > 0 ? (
                                <Select value={selectedTargetLocationId} onValueChange={setSelectedTargetLocationId}>
                                    <SelectTrigger className="h-10">
                                        <SelectValue placeholder="Select Location" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {normalizedTargetLocations.map((loc: any) => (
                                            <SelectItem key={String(loc.id)} value={String(loc.id)}>
                                                {loc.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            ) : (
                                <Input value={targetLocationName || targetLocationId || "No active location found"} readOnly className="h-10 bg-slate-50" />
                            )}
                        </div>
                    </div>

                    <div className="text-[10px] text-slate-500">
                        Destination: <span className="font-bold text-slate-700">{resolvedTargetPlantName}</span>
                    </div>

                    <div>
                        <label className="text-[10px] font-black uppercase text-slate-500">Quantity (kg)</label>
                        <Input
                            type="number"
                            step="0.01"
                            value={Number.isFinite(qty) ? qty : 0}
                            onChange={(e) => setQty(Number(e.target.value))}
                            className="h-10"
                        />
                    </div>

                    <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                        <Button
                            onClick={() => mutation.mutate()}
                            disabled={mutation.isPending || !selectedPlantId || !selectedLocationId || !selectedTargetLocationId}
                            className="bg-amber-600 hover:bg-amber-700 text-white"
                        >
                            {mutation.isPending ? "Requesting..." : (String(selectedPlantId) === String(effectiveTargetPlantId) ? "Move Stock" : "Create DC Transfer")}
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}

function RollTransferModal({ targetSpec, targetSpecs = [], rollBehavior, targetPlantId, targetPlantName, targetLocationId, targetLocationName, onRequested }: any) {
    const [open, setOpen] = useState(false)
    const [selectedPlantId, setSelectedPlantId] = useState<string>("")
    const [selectedSourceLocationId, setSelectedSourceLocationId] = useState<string>("ALL")
    const [selectedTargetLocationId, setSelectedTargetLocationId] = useState<string>(targetLocationId ? String(targetLocationId) : "")
    const [selectedRollIds, setSelectedRollIds] = useState<string[]>([])
    const { toast } = useToast()
    const behaviorNormalized = String(rollBehavior || "").trim().toUpperCase()
    const isMultiInputCombine = (
        behaviorNormalized === "MULTI_INPUT_COMBINE" ||
        behaviorNormalized === "MULTI_INPUT" ||
        (behaviorNormalized.includes("MULTI") && behaviorNormalized.includes("COMBINE"))
    )

    const normalizedSpecs = useMemo(() => {
        const list = Array.isArray(targetSpecs) && targetSpecs.length > 0 ? targetSpecs : [targetSpec]
        const byKey = new Map<string, any>()
        list.filter(Boolean).forEach((spec: any) => {
            const key = [
                String(spec?.variant_id || ""),
                String(spec?.family_id || ""),
                String(spec?.thickness_micron ?? "")
            ].join("|")
            if (!byKey.has(key)) {
                byKey.set(key, spec)
                return
            }
            const prev = byKey.get(key)
            const prevGrade = Boolean(prev?.grade_id)
            const nextGrade = Boolean(spec?.grade_id)
            const prevWidth = Number(prev?.min_width_mm || 0)
            const nextWidth = Number(spec?.min_width_mm || 0)
            if ((!prevGrade && nextGrade) || (nextGrade === prevGrade && nextWidth > prevWidth)) {
                byKey.set(key, spec)
            }
        })
        return Array.from(byKey.values())
    }, [targetSpec, targetSpecs])

    const { data: availability } = useQuery({
        queryKey: ["roll-availability", normalizedSpecs, targetPlantId],
        queryFn: async () => {
            const strictSingleSpec = normalizedSpecs.length === 1 && !isMultiInputCombine
            const single = strictSingleSpec ? normalizedSpecs[0] : null
            const { data } = await api.get("/api/inventory/rolls/availability/", {
                params: {
                    variant_id: single?.variant_id,
                    family_id: single?.family_id,
                    thickness_micron: single?.thickness_micron,
                    grade_id: single?.grade_id,
                    min_width_mm: single?.min_width_mm,
                    exclude_plant: targetPlantId
                }
            })
            const primary = Array.isArray(data) ? data : []
            const primaryRolls = primary.reduce((sum: number, plant: any) => sum + Number(plant?.total_rolls || 0), 0)
            if (normalizedSpecs.length > 1 && primaryRolls <= 1) {
                const { data: broadData } = await api.get("/api/inventory/rolls/availability/", {
                    params: { exclude_plant: targetPlantId }
                })
                const broad = Array.isArray(broadData) ? broadData : []
                const broadRolls = broad.reduce((sum: number, plant: any) => sum + Number(plant?.total_rolls || 0), 0)
                if (broadRolls > primaryRolls) return broad
            }
            return primary
        },
        enabled: open
    })

    const selectedPlant = (availability || []).find((p: any) => String(p.plant_id) === String(selectedPlantId))
    const rollsRaw = selectedPlant?.rolls || []
    const sourceLocationOptions = useMemo(() => {
        const map = new Map<string, string>()
            ; (Array.isArray(rollsRaw) ? rollsRaw : []).forEach((roll: any) => {
                const id = String(roll.location_id || roll.location || "")
                const name = String(roll.location_name || roll.location || "Location")
                if (id) map.set(id, name)
            })
        return Array.from(map.entries()).map(([id, name]) => ({ id, name }))
    }, [rollsRaw])
    const { data: targetLocations } = useQuery({
        queryKey: ["roll-transfer-target-locations", targetPlantId],
        queryFn: async () => {
            if (!targetPlantId) return []
            try {
                return await inventoryService.getLocations(String(targetPlantId))
            } catch {
                return []
            }
        },
        enabled: open && Boolean(targetPlantId)
    })
    const normalizedTargetLocations = useMemo(() => {
        const rows = Array.isArray(targetLocations) ? targetLocations : []
        const normalized = rows
            .map((loc: any) => ({
                id: String(loc.id || loc.location_id || ""),
                name: String(loc.name || loc.location_name || loc.code || "Location")
            }))
            .filter((loc: any) => loc.id)
        const preset = targetLocationId ? String(targetLocationId) : ""
        if (preset && !normalized.some((loc: any) => loc.id === preset)) {
            normalized.unshift({ id: preset, name: String(targetLocationName || `Location ${preset.slice(0, 8)}`) })
        }
        return normalized
    }, [targetLocations, targetLocationId, targetLocationName])
    const specMatchedRolls = useMemo(() => {
        const matchSpec = (roll: any, spec: any) => {
            if (!spec) return true
            const rollVariantId = roll?.material_id ? String(roll.material_id) : null
            const rollFamilyId = roll?.family_id ? String(roll.family_id) : null
            const variantOk = spec.variant_id ? String(spec.variant_id) === rollVariantId : true
            const familyOk = spec.family_id ? String(spec.family_id) === rollFamilyId : true
            const thicknessOk = spec.thickness_micron != null ? Number(roll.thickness_micron) === Number(spec.thickness_micron) : true
            const gradeOk = spec.grade_id ? String(spec.grade_id) === String(roll.grade_id || "") : true
            const widthOk = isMultiInputCombine
                ? true
                : (spec.min_width_mm != null ? Number(roll.width_mm) >= Number(spec.min_width_mm) : true)
            return (variantOk || familyOk) && thicknessOk && gradeOk && widthOk
        }
        if (!normalizedSpecs.length) return rollsRaw
        const filtered = rollsRaw.filter((r: any) => normalizedSpecs.some((s: any) => matchSpec(r, s)))
        if (isMultiInputCombine && filtered.length === 0) {
            return rollsRaw
        }
        return filtered
    }, [rollsRaw, normalizedSpecs, isMultiInputCombine])
    const rolls = useMemo(() => {
        if (selectedSourceLocationId === "ALL") return specMatchedRolls
        return specMatchedRolls.filter((r: any) => String(r.location_id || r.location || "") === String(selectedSourceLocationId))
    }, [specMatchedRolls, selectedSourceLocationId])

    const mutation = useMutation({
        mutationFn: async () => {
            if (!selectedPlantId || selectedRollIds.length === 0) {
                throw new Error("Select at least one roll from a source plant")
            }
            if (!targetPlantId) {
                throw new Error("Target plant missing")
            }
            const effectiveTargetLocationId = String(selectedTargetLocationId || targetLocationId || "")
            if (!effectiveTargetLocationId) {
                throw new Error("Target location missing")
            }
            const challan = await inventoryService.createChallan({
                from_plant: selectedPlantId,
                to_plant: targetPlantId
            })
            const challanId = (challan as any)?.data?.id || (challan as any)?.id
            await inventoryService.dispatchChallan(challanId, {
                target_location_id: effectiveTargetLocationId,
                roll_ids: selectedRollIds
            })
        },
        onSuccess: () => {
            toast({ title: "Transfer Requested", description: "DC created and dispatched for selected rolls." })
            setOpen(false)
            setSelectedRollIds([])
            if (onRequested) onRequested()
        },
        onError: (err: any) => {
            toast({ variant: "destructive", title: "Transfer Failed", description: err.message || err.response?.data?.error || "Unknown error" })
        }
    })

    useEffect(() => {
        if (!open) return
        if (!selectedPlantId && Array.isArray(availability) && availability.length > 0) {
            setSelectedPlantId(String(availability[0].plant_id))
        }
    }, [open, availability, selectedPlantId])
    useEffect(() => {
        if (!open) return
        setSelectedSourceLocationId("ALL")
        setSelectedRollIds([])
    }, [open, selectedPlantId])
    useEffect(() => {
        if (!open) return
        const preset = targetLocationId ? String(targetLocationId) : ""
        if (preset && normalizedTargetLocations.some((loc: any) => String(loc.id) === preset)) {
            setSelectedTargetLocationId(preset)
            return
        }
        if (normalizedTargetLocations.length > 0 && !normalizedTargetLocations.some((loc: any) => String(loc.id) === String(selectedTargetLocationId))) {
            setSelectedTargetLocationId(String(normalizedTargetLocations[0].id))
        }
    }, [open, normalizedTargetLocations, targetLocationId, selectedTargetLocationId])

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button size="sm" variant="outline" className="h-7 text-[10px] font-black text-amber-700 border-amber-200 bg-amber-50 hover:bg-amber-100">
                    TRANSFER
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Request Roll Transfer</DialogTitle>
                    <DialogDescription>
                        Create a delivery challan for matching rolls from another plant to this work center plant.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="text-xs text-slate-500">
                        Required specs:{" "}
                        <span className="font-bold text-slate-800">
                            {normalizedSpecs.length > 0
                                ? normalizedSpecs.map((s: any) => (
                                    [s.variant_name || s.family_name || "Roll", s.thickness_micron ? `${s.thickness_micron}μ` : null, s.grade_name || null]
                                        .filter(Boolean)
                                        .join(" • ")
                                )).join("  |  ")
                                : "—"}
                        </span>
                    </div>
                    <div className="text-xs text-slate-500">
                        To plant: <span className="font-bold text-slate-800">{targetPlantName || targetPlantId || "—"}</span>
                    </div>

                    <div>
                        <label className="text-[10px] font-black uppercase text-slate-500">From Plant</label>
                        <Select value={selectedPlantId} onValueChange={(val) => { setSelectedPlantId(val); setSelectedRollIds([]) }}>
                            <SelectTrigger className="h-10"><SelectValue placeholder="Select Plant" /></SelectTrigger>
                            <SelectContent>
                                {(availability || []).map((p: any) => (
                                    <SelectItem key={p.plant_id} value={p.plant_id}>
                                        {p.plant_name} ({p.total_rolls} rolls, {Number(p.total_weight_kg || 0).toFixed(1)} kg)
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div>
                        <label className="text-[10px] font-black uppercase text-slate-500">From Location</label>
                        <Select value={selectedSourceLocationId} onValueChange={setSelectedSourceLocationId}>
                            <SelectTrigger className="h-10"><SelectValue placeholder="All locations" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="ALL">All locations</SelectItem>
                                {sourceLocationOptions.map((loc: any) => (
                                    <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div>
                        <label className="text-[10px] font-black uppercase text-slate-500">To Location</label>
                        {normalizedTargetLocations.length > 0 ? (
                            <Select value={selectedTargetLocationId} onValueChange={setSelectedTargetLocationId}>
                                <SelectTrigger className="h-10"><SelectValue placeholder="Select destination location" /></SelectTrigger>
                                <SelectContent>
                                    {normalizedTargetLocations.map((loc: any) => (
                                        <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        ) : (
                            <Input value={targetLocationName || targetLocationId || "No destination location found"} readOnly className="h-10 bg-slate-50" />
                        )}
                    </div>

                    <div className="space-y-2 max-h-[240px] overflow-y-auto border rounded-lg p-3 bg-slate-50">
                        {rolls.length === 0 && (
                            <div className="text-xs text-slate-400">No rolls available for this spec.</div>
                        )}
                        {rolls.map((r: any) => {
                            const checked = selectedRollIds.includes(r.id)
                            return (
                                <div key={r.id} className="flex items-center justify-between bg-white border rounded-md p-2">
                                    <div className="flex items-center gap-2">
                                        <Checkbox
                                            checked={checked}
                                            onCheckedChange={() => {
                                                if (checked) setSelectedRollIds(selectedRollIds.filter(id => id !== r.id))
                                                else setSelectedRollIds([...selectedRollIds, r.id])
                                            }}
                                        />
                                        <div>
                                            <div className="text-xs font-bold text-slate-800">{r.label_id}</div>
                                            <div className="text-[10px] text-slate-500">
                                                {r.thickness_micron}μ • {r.width_mm}mm • {r.weight_kg}kg • {r.grade_name || "—"}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="text-[10px] text-slate-400">{r.location_name}</div>
                                </div>
                            )
                        })}
                    </div>

                    <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                        <Button
                            onClick={() => mutation.mutate()}
                            disabled={mutation.isPending || selectedRollIds.length === 0 || !selectedTargetLocationId}
                            className="bg-amber-600 hover:bg-amber-700 text-white"
                        >
                            {mutation.isPending ? "Requesting..." : "Create DC Transfer"}
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
