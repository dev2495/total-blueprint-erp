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
    allowed_lanes: number[]
    allowed_parent_widths: number[]
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

export const webWidthPolicyService = {
    list: async () => {
        const { data } = await api.get("/api/master/web-width-policies/", { params: { page_size: 200 } })
        if (Array.isArray(data)) return data as WebWidthPolicy[]
        if (data && Array.isArray((data as any).results)) return (data as any).results as WebWidthPolicy[]
        return [] as WebWidthPolicy[]
    },
    get: async (id: string) => (await api.get<WebWidthPolicy>(`/api/master/web-width-policies/${id}/`)).data,
    getDefault: async () => (await api.get<WebWidthPolicy>(`/api/master/web-width-policies/default/`)).data,
    create: async (body: WebWidthPolicyPayload) => (await api.post<WebWidthPolicy>("/api/master/web-width-policies/", body)).data,
    update: async (id: string, body: Partial<WebWidthPolicyPayload>) => (await api.patch<WebWidthPolicy>(`/api/master/web-width-policies/${id}/`, body)).data,
    remove: async (id: string) => { await api.delete(`/api/master/web-width-policies/${id}/`) },
}

export function computePlannedParentWidth(
    childTargetWidthMm: number,
    laneCount: number,
    policy?: Pick<WebWidthPolicy, "slitting_waste_rule"> | null,
): number {
    if (!childTargetWidthMm || laneCount < 1) return 0
    const rule = policy?.slitting_waste_rule || { inter_cut_mm: 5, edge_trim_mm: 2 }
    const interCut = Number(rule.inter_cut_mm ?? 5)
    const edge = Number(rule.edge_trim_mm ?? 2)
    const formula = String(rule.formula || "PER_CUT").toUpperCase()
    const trim =
        formula === "PER_LANE"
            ? laneCount * interCut + 2 * edge
            : formula === "FIXED"
              ? interCut + 2 * edge
              : Math.max(0, laneCount - 1) * interCut + 2 * edge
    return Math.round((childTargetWidthMm * laneCount + trim) * 100) / 100
}
