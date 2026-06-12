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

export interface TradingGoodReceiptPayload {
  trading_good: string
  vendor: string
  plant: string
  qty: number | string
  rate: number | string
  gst_pct?: number | string
  vendor_invoice_no?: string
  vendor_invoice_date?: string
  vehicle_no?: string
  driver_name?: string
  lr_no?: string
  notes?: string
}

export interface TradingGoodReceipt {
  id: string
  code: string
  trading_good: string
  trading_good_code?: string
  trading_good_name?: string
  base_uom?: string
  vendor: string
  vendor_code?: string
  vendor_name?: string
  plant: string
  plant_name?: string
  qty_received: number
  rate: number
  gst_pct?: number
  line_subtotal?: number
  line_gst?: number
  line_total?: number
  vendor_invoice_no?: string
  vendor_invoice_date?: string | null
  vehicle_no?: string
  driver_name?: string
  lr_no?: string
  notes?: string
  received_at?: string
  created_at?: string
}

export const tradingGoodReceiptService = {
  list: async (params?: { vendor?: string; plant?: string; trading_good?: string; search?: string }) => {
    const { data } = await api.get("/api/procurement/trading-good-receipts/", {
      params: { page_size: 200, ...params },
    })
    return unwrap<TradingGoodReceipt>(data)
  },
  create: async (body: TradingGoodReceiptPayload) =>
    (await api.post<TradingGoodReceipt>("/api/procurement/trading-good-receipts/", body)).data,
}
