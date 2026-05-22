import { api } from "@/lib/api"

export interface SlittingWasteRule {
    inter_cut_mm?: number
    edge_trim_mm?: number
    formula?: "PER_CUT" | "PER_LANE" | "FIXED"
}

export interface WebWidthPolicy {
    id: string
    code: string
    name: string
    description: string
    is_default: boolean
    scope_type: "GLOBAL" | "PRODUCT_KIND" | "PRODUCT_MASTER" | "POUCH_STYLE" | "PROCESS" | "MACHINE"
    scope_ref: string
    allowed_lanes: number[]
    allowed_parent_widths: number[]
    parent_width_strategy: "CALCULATED" | "NEAREST_STANDARD" | "STRICT_STANDARD"
    min_parent_width_mm?: string | number | null
    max_parent_width_mm?: string | number | null
    slitting_waste_rule: SlittingWasteRule
    min_remainder_mm: number
    prefer_remainder_first: boolean
    deprecated: boolean
    notes: string
    created_at?: string
    updated_at?: string
}

export type WebWidthPolicyPayload = Partial<Omit<WebWidthPolicy, "id" | "created_at" | "updated_at">> & {
    code: string
    name: string
}

export interface WebWidthPlan {
    policy_id?: string | null
    policy_code: string
    policy_name: string
    scope_type: string
    scope_ref: string
    parent_width_strategy: WebWidthPolicy["parent_width_strategy"]
    allowed_lanes: number[]
    allowed_parent_widths: number[]
    child_width_mm: number
    lane_count: number
    trim_mm: number
    computed_run_width_mm: number
    planned_parent_width_mm: number
    selected_standard_parent_width_mm?: number | null
    remainder_mm: number
    remainder_disposition: "NONE" | "KEEP" | "SCRAP"
    min_remainder_mm: number
    prefer_remainder_first: boolean
    warnings: string[]
}

export const webWidthPolicyService = {
    list: async () => {
        const { data } = await api.get("/api/master/web-width-policies/", { params: { page_size: 200 } })
        if (Array.isArray(data)) return data as WebWidthPolicy[]
        if (data && Array.isArray((data as any).results)) return (data as any).results as WebWidthPolicy[]
        return [] as WebWidthPolicy[]
    },
    get: async (id: string) => (await api.get<WebWidthPolicy>(`/api/master/web-width-policies/${id}/`)).data,
    getDefault: async () => (await api.get<WebWidthPolicy>(`/api/master/web-width-policies/default/`)).data,
    resolve: async (params: Record<string, string | number | undefined>) => (
        await api.get<{ policy: WebWidthPolicy; context: Record<string, string>; plan?: WebWidthPlan; error?: string }>(
            `/api/master/web-width-policies/resolve/`,
            { params },
        )
    ).data,
    create: async (body: WebWidthPolicyPayload) => (await api.post<WebWidthPolicy>("/api/master/web-width-policies/", body)).data,
    update: async (id: string, body: Partial<WebWidthPolicyPayload>) => (await api.patch<WebWidthPolicy>(`/api/master/web-width-policies/${id}/`, body)).data,
    remove: async (id: string) => { await api.delete(`/api/master/web-width-policies/${id}/`) },
}

function positiveWidths(values?: number[] | null) {
    return (values || []).map(Number).filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b)
}

export function computeWebWidthPlan(
    childTargetWidthMm: number,
    laneCount: number,
    policy?: Pick<WebWidthPolicy, "slitting_waste_rule" | "allowed_lanes" | "allowed_parent_widths" | "parent_width_strategy" | "min_parent_width_mm" | "max_parent_width_mm" | "min_remainder_mm" | "prefer_remainder_first" | "code" | "name" | "id" | "scope_type" | "scope_ref"> | null,
): WebWidthPlan {
    const child = Number(childTargetWidthMm || 0)
    const lane = Math.max(1, Number(laneCount || 1))
    if (!child || lane < 1) {
        return {
            policy_id: policy?.id || null,
            policy_code: policy?.code || "BUILTIN",
            policy_name: policy?.name || "Built-in fallback",
            scope_type: policy?.scope_type || "GLOBAL",
            scope_ref: policy?.scope_ref || "",
            parent_width_strategy: policy?.parent_width_strategy || "CALCULATED",
            allowed_lanes: policy?.allowed_lanes || [],
            allowed_parent_widths: positiveWidths(policy?.allowed_parent_widths),
            child_width_mm: 0,
            lane_count: lane,
            trim_mm: 0,
            computed_run_width_mm: 0,
            planned_parent_width_mm: 0,
            selected_standard_parent_width_mm: null,
            remainder_mm: 0,
            remainder_disposition: "NONE",
            min_remainder_mm: Number(policy?.min_remainder_mm || 50),
            prefer_remainder_first: policy?.prefer_remainder_first ?? true,
            warnings: [],
        }
    }
    const rule = policy?.slitting_waste_rule || { inter_cut_mm: 5, edge_trim_mm: 2 }
    const interCut = Number(rule.inter_cut_mm ?? 5)
    const edge = Number(rule.edge_trim_mm ?? 2)
    const formula = String(rule.formula || "PER_CUT").toUpperCase()
    const trim =
        formula === "PER_LANE"
            ? lane * interCut + 2 * edge
            : formula === "FIXED"
              ? interCut + 2 * edge
              : Math.max(0, lane - 1) * interCut + 2 * edge
    const computed = Math.round((child * lane + trim) * 100) / 100
    const minParent = Number(policy?.min_parent_width_mm || 0)
    const maxParent = Number(policy?.max_parent_width_mm || 0)
    const strategy = policy?.parent_width_strategy || "CALCULATED"
    const widths = positiveWidths(policy?.allowed_parent_widths)
    const warnings: string[] = []
    let planned = computed
    let selectedStandard: number | null = null

    if (strategy === "NEAREST_STANDARD" || strategy === "STRICT_STANDARD") {
        const fit = widths.find((w) => w >= computed && (!minParent || w >= minParent) && (!maxParent || w <= maxParent))
        if (fit) {
            planned = fit
            selectedStandard = fit
        } else if (strategy === "NEAREST_STANDARD") {
            warnings.push("No standard parent width fits; using calculated width.")
        }
    }
    if (minParent && planned < minParent) {
        planned = minParent
        warnings.push(`Raised to minimum parent width ${minParent} mm.`)
    }
    if (maxParent && planned > maxParent) {
        warnings.push(`Above maximum parent width ${maxParent} mm.`)
    }

    const remainder = Math.max(0, Math.round((planned - computed) * 100) / 100)
    const minRemainder = Number(policy?.min_remainder_mm || 50)
    const remainderDisposition = remainder <= 0 ? "NONE" : remainder >= minRemainder ? "KEEP" : "SCRAP"
    return {
        policy_id: policy?.id || null,
        policy_code: policy?.code || "BUILTIN",
        policy_name: policy?.name || "Built-in fallback",
        scope_type: policy?.scope_type || "GLOBAL",
        scope_ref: policy?.scope_ref || "",
        parent_width_strategy: strategy,
        allowed_lanes: policy?.allowed_lanes || [],
        allowed_parent_widths: widths,
        child_width_mm: child,
        lane_count: lane,
        trim_mm: Math.round(trim * 100) / 100,
        computed_run_width_mm: computed,
        planned_parent_width_mm: Math.round(planned * 100) / 100,
        selected_standard_parent_width_mm: selectedStandard,
        remainder_mm: remainder,
        remainder_disposition: remainderDisposition,
        min_remainder_mm: minRemainder,
        prefer_remainder_first: policy?.prefer_remainder_first ?? true,
        warnings,
    }
}

export function computePlannedParentWidth(
    childTargetWidthMm: number,
    laneCount: number,
    policy?: Parameters<typeof computeWebWidthPlan>[2],
): number {
    return computeWebWidthPlan(childTargetWidthMm, laneCount, policy).planned_parent_width_mm
}
