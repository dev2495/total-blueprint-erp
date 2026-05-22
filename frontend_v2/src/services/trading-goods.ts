import { api } from "@/lib/api"

export interface TradingGoodStockRow {
  id: string
  trading_good: string
  plant: string
  plant_name?: string
  plant_code?: string
  qty: number
  avg_cost: number
  updated_at?: string
}

export interface TradingGood {
  id: string
  code: string
  name: string
  trade_type: "READY_POUCH" | "READY_ROLL" | "PACKAGING" | "RAW_MATERIAL" | "OTHER" | string
  description: string
  base_uom: string
  hsn_code: string
  default_gst_pct: number
  default_sale_rate: number | null
  default_buy_rate: number | null
  is_active: boolean
  notes: string
  current_stock_qty?: number
  stocks?: TradingGoodStockRow[]
  created_at?: string
  updated_at?: string
}

export type TradingGoodPayload = Partial<Omit<TradingGood, "id" | "created_at" | "updated_at" | "current_stock_qty" | "stocks">> & {
  code: string
  name: string
}

export interface SellableMaterial {
  id: string
  code: string
  name: string
  category: string
  base_uom: string
  is_sellable: boolean
  default_gst_pct: number | null
  parent_family?: string | null
  parent_family_name?: string | null
  status: string
  current_stock_qty?: number
  plant_stock_qty?: number | null
  stock_by_plant?: TradingGoodStockRow[]
}

function unwrap<T>(data: any): T[] {
  if (!data) return []
  if (Array.isArray(data)) return data as T[]
  if (Array.isArray(data?.results)) return data.results as T[]
  return []
}

export const tradingGoodService = {
  list: async (params?: { is_active?: boolean; q?: string }) => {
    const { data } = await api.get("/api/master/trading-goods/", {
      params: { page_size: 200, ...params },
    })
    return unwrap<TradingGood>(data)
  },
  get: async (id: string) => (await api.get<TradingGood>(`/api/master/trading-goods/${id}/`)).data,
  create: async (body: TradingGoodPayload) =>
    (await api.post<TradingGood>("/api/master/trading-goods/", body)).data,
  update: async (id: string, body: Partial<TradingGoodPayload>) =>
    (await api.patch<TradingGood>(`/api/master/trading-goods/${id}/`, body)).data,
  remove: async (id: string) => {
    await api.delete(`/api/master/trading-goods/${id}/`)
  },
  stock: async (id: string) => {
    const { data } = await api.get<TradingGoodStockRow[]>(`/api/master/trading-goods/${id}/stock/`)
    return data || []
  },
  sellableMaterials: async () => {
    const { data } = await api.get("/api/sales/sellable-materials/")
    return unwrap<SellableMaterial>(data)
  },
}
