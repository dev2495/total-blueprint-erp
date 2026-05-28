import { api } from "@/lib/api"

export interface ReorderPolicyRow {
  id: string
  code: string
  name: string
  category: string
  category_label: string
  base_uom: string
  status: string
  reorder_qty: string | number | null
  safety_stock: string | number | null
  lead_time_override_days: number | null
  current_stock: number
  last_alert_at: string | null
}

export interface ReorderPolicyListResponse {
  results?: ReorderPolicyRow[]
  count?: number
}

function unwrap(data: unknown): ReorderPolicyRow[] {
  if (Array.isArray(data)) return data as ReorderPolicyRow[]
  if (data && typeof data === "object" && Array.isArray((data as { results?: ReorderPolicyRow[] }).results)) {
    return (data as { results: ReorderPolicyRow[] }).results
  }
  return []
}

export const reorderPolicyApi = {
  async list(params?: { category?: string; search?: string; no_policy?: boolean }): Promise<ReorderPolicyRow[]> {
    const search: Record<string, string> = {}
    if (params?.category) search.category = params.category
    if (params?.search) search.search = params.search
    if (params?.no_policy) search.no_policy = "1"
    const { data } = await api.get("/api/materials/reorder-policy/", { params: search })
    return unwrap(data)
  },
  async patch(id: string, payload: Partial<Pick<ReorderPolicyRow, "reorder_qty" | "safety_stock" | "lead_time_override_days">>): Promise<ReorderPolicyRow> {
    const { data } = await api.patch(`/api/materials/reorder-policy/${id}/`, payload)
    return data as ReorderPolicyRow
  },
  async runScan(): Promise<{ raised: number; resolved: number; scanned: number }> {
    const { data } = await api.post("/api/materials/reorder-policy/run-scan/")
    return data as { raised: number; resolved: number; scanned: number }
  },
}
