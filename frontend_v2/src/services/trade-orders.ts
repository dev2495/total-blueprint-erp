import { api } from "@/lib/api"

export type TradeOrderStatus =
  | "DRAFT"
  | "CONFIRMED"
  | "DISPATCHED"
  | "INVOICED"
  | "CANCELLED"

export interface TradeOrderItem {
  id?: string
  line_no: number
  item_type: "INVENTORY_MATERIAL" | "TRADING_GOOD"
  inventory_material?: string | null
  inventory_material_id?: string | null
  trading_good?: string | null
  trading_good_id?: string | null
  description: string
  qty: number
  uom: string
  rate: number
  gst_pct: number
  line_subtotal?: number
  line_gst?: number
  line_total?: number
  display_name?: string
}

export interface TradeOrder {
  id: string
  code: string
  customer: string
  customer_name?: string
  plant: string | null
  plant_name?: string | null
  order_date: string
  status: TradeOrderStatus
  notes: string
  subtotal: number
  gst_total: number
  grand_total: number
  dispatched_at?: string | null
  invoice_no?: string
  items: TradeOrderItem[]
  created_at?: string
  updated_at?: string
}

export interface TradeOrderItemOption {
  key: string
  item_type: "INVENTORY_MATERIAL" | "TRADING_GOOD"
  id: string
  code: string
  name: string
  category: string
  category_label?: string
  base_uom: string
  default_gst_pct?: number | null
  default_sale_rate?: number | null
  available_qty: number
  plant_stock_qty?: number
  plant_name?: string
  plant_code?: string
  parent_family_name?: string
  stock_by_plant?: Array<{
    plant: string
    plant_name?: string
    plant_code?: string
    qty: number
    uom?: string
    stock_class?: string
    detail?: string
  }>
}

export type TradeOrderPayload = Partial<
  Omit<TradeOrder, "id" | "code" | "subtotal" | "gst_total" | "grand_total" | "created_at" | "updated_at" | "dispatched_at">
>

function unwrap<T>(data: any): T[] {
  if (!data) return []
  if (Array.isArray(data)) return data as T[]
  if (Array.isArray(data?.results)) return data.results as T[]
  return []
}

export const tradeOrderService = {
  list: async (params?: { status?: string; customer?: string }) => {
    const { data } = await api.get("/api/sales/trade-orders/", {
      params: { page_size: 200, ...params },
    })
    return unwrap<TradeOrder>(data)
  },
  get: async (id: string) => (await api.get<TradeOrder>(`/api/sales/trade-orders/${id}/`)).data,
  create: async (body: TradeOrderPayload) =>
    (await api.post<TradeOrder>("/api/sales/trade-orders/", body)).data,
  update: async (id: string, body: Partial<TradeOrderPayload>) =>
    (await api.patch<TradeOrder>(`/api/sales/trade-orders/${id}/`, body)).data,
  remove: async (id: string) => {
    await api.delete(`/api/sales/trade-orders/${id}/`)
  },
  confirm: async (id: string) =>
    (await api.post<TradeOrder>(`/api/sales/trade-orders/${id}/confirm/`, {})).data,
  dispatch: async (id: string) =>
    (await api.post<TradeOrder>(`/api/sales/trade-orders/${id}/dispatch/`, {})).data,
  cancel: async (id: string) =>
    (await api.post<TradeOrder>(`/api/sales/trade-orders/${id}/cancel/`, {})).data,
  itemOptions: async (plantId?: string | null) => {
    const { data } = await api.get<TradeOrderItemOption[]>("/api/sales/trade-order-item-options/", {
      params: plantId ? { plant: plantId } : {},
    })
    return data || []
  },
}
