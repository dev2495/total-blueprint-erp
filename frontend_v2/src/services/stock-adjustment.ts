import { api } from "@/lib/api"

export type StockAdjustmentStatus = "DRAFT" | "POSTED" | "VOID"

export type StockClass = "BULK" | "ROLL" | "PACKAGING" | "TRADING_GOOD"

export type StockAdjustmentReason =
  | "DAMAGE"
  | "WRITE_OFF"
  | "FOUND"
  | "COUNT_CORRECTION"
  | "RECLASSIFY"
  | "OTHER"

export interface StockAdjustmentLine {
  id?: string
  line_no?: number
  stock_class: StockClass
  inventory_material?: string | null
  inventory_material_code?: string | null
  inventory_material_name?: string | null
  trading_good?: string | null
  trading_good_code?: string | null
  trading_good_name?: string | null
  location?: string | null
  location_name?: string | null
  inventory_roll?: string | null
  inventory_roll_label?: string | null
  before_qty?: number
  delta_qty: number
  after_qty?: number
  uom?: string
  value_inr?: number
  notes?: string
}

export interface StockAdjustment {
  id: string
  code: string
  plant: string
  plant_name?: string
  plant_code?: string
  reason: StockAdjustmentReason
  status: StockAdjustmentStatus
  notes: string
  lines: StockAdjustmentLine[]
  created_at?: string
  created_by?: string | null
  created_by_name?: string | null
  posted_at?: string | null
  posted_by?: string | null
  posted_by_name?: string | null
}

export interface StockAdjustmentPayload {
  plant: string
  reason?: StockAdjustmentReason
  notes?: string
  lines?: Array<Omit<StockAdjustmentLine, "id" | "before_qty" | "after_qty" | "value_inr">>
}

function unwrap<T>(data: any): T[] {
  if (!data) return []
  if (Array.isArray(data)) return data as T[]
  if (Array.isArray(data?.results)) return data.results as T[]
  return []
}

export const stockAdjustmentService = {
  list: async (params?: { status?: StockAdjustmentStatus; plant?: string }) => {
    const { data } = await api.get("/api/inventory/adjustments/", {
      params: { page_size: 200, ...params },
    })
    return unwrap<StockAdjustment>(data)
  },
  get: async (id: string) =>
    (await api.get<StockAdjustment>(`/api/inventory/adjustments/${id}/`)).data,
  create: async (body: StockAdjustmentPayload) =>
    (await api.post<StockAdjustment>("/api/inventory/adjustments/", body)).data,
  update: async (id: string, body: Partial<StockAdjustmentPayload>) =>
    (await api.patch<StockAdjustment>(`/api/inventory/adjustments/${id}/`, body)).data,
  remove: async (id: string) => {
    await api.delete(`/api/inventory/adjustments/${id}/`)
  },
  post: async (id: string) =>
    (await api.post<StockAdjustment>(`/api/inventory/adjustments/${id}/post/`, {})).data,
  void: async (id: string) =>
    (await api.post<StockAdjustment>(`/api/inventory/adjustments/${id}/void/`, {})).data,
  addLine: async (
    id: string,
    line: Omit<StockAdjustmentLine, "id" | "before_qty" | "after_qty" | "value_inr">,
  ) =>
    (await api.post<StockAdjustmentLine>(
      `/api/inventory/adjustments/${id}/add-line/`,
      line,
    )).data,
  removeLine: async (id: string, lineId: string) => {
    await api.delete(`/api/inventory/adjustments/${id}/lines/${lineId}/`)
  },
}

export const STOCK_ADJUSTMENT_REASONS: { value: StockAdjustmentReason; label: string }[] = [
  { value: "DAMAGE", label: "Damaged / spoiled" },
  { value: "WRITE_OFF", label: "Write-off" },
  { value: "FOUND", label: "Found / unaccounted" },
  { value: "COUNT_CORRECTION", label: "Count correction" },
  { value: "RECLASSIFY", label: "Reclassification" },
  { value: "OTHER", label: "Other" },
]

export const STOCK_CLASS_OPTIONS: { value: StockClass; label: string }[] = [
  { value: "BULK", label: "Bulk (granules / chemicals)" },
  { value: "ROLL", label: "Roll" },
  { value: "PACKAGING", label: "Packaging" },
  { value: "TRADING_GOOD", label: "Trading Good" },
]
