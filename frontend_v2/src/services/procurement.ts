import { api } from "@/lib/api"

export type POStatus =
  | "DRAFT"
  | "SENT"
  | "ACK"
  | "PARTIAL"
  | "COMPLETED"
  | "CANCELLED"

export interface POItem {
  id?: string
  line_no: number
  material: string
  material_code?: string
  material_name?: string
  material_category?: string
  description?: string
  qty_ordered: number | string
  uom: string
  rate_per_uom: number | string
  gst_pct: number | string
  line_subtotal?: number
  line_gst?: number
  line_total?: number
  expected_delivery_date?: string | null
  qty_received?: number | string
  qty_open?: number
  progress_pct?: number
  is_closed?: boolean
  close_reason?: string
  expected_width_mm?: number | string | null
  expected_thickness_micron?: number | string | null
}

export interface POReceiptLine {
  id: string
  po_item: string
  po_item_line_no?: number
  material_code?: string
  material_name?: string
  qty_received: number
  rate: number
  notes?: string
  rejection_reason?: string
  bulk_tx_id?: string | null
  roll_id?: string | null
  packaging_tx_id?: string | null
}

export interface POReceipt {
  id: string
  code: string
  purchase_order: string
  purchase_order_code?: string
  plant: string
  plant_name?: string
  received_at: string
  vendor_invoice_no?: string
  vendor_invoice_date?: string | null
  vehicle_no?: string
  driver_name?: string
  lr_no?: string
  quality_status?: "PENDING" | "APPROVED" | "REJECTED"
  notes?: string
  received_by?: string | null
  received_by_name?: string
  lines: POReceiptLine[]
  created_at: string
}

export interface PurchaseOrder {
  id: string
  code: string
  vendor: string
  vendor_name?: string
  vendor_gstin?: string
  plant: string
  plant_name?: string
  order_date: string
  expected_delivery_date?: string | null
  status: POStatus
  currency: string
  payment_terms: string
  freight_terms: string
  delivery_address: string
  notes: string
  source_mrp_suggestion?: string | null
  subtotal: number
  gst_total: number
  freight_amount: number
  grand_total: number
  sent_at?: string | null
  acknowledged_at?: string | null
  ack_ref?: string
  completed_at?: string | null
  cancelled_at?: string | null
  cancel_reason?: string
  status_history: Array<Record<string, unknown>>
  items: POItem[]
  receipts?: POReceipt[]
  items_count?: number
  open_qty_total?: number
  qty_ordered_total?: number
  qty_received_total?: number
  progress_pct?: number
  created_at: string
  updated_at: string
}

export interface PurchaseOrderListItem {
  id: string
  code: string
  vendor: string
  vendor_name: string
  plant: string
  plant_name: string
  status: POStatus
  grand_total: number
  qty_ordered_total: number
  qty_received_total: number
  progress_pct: number
  order_date: string
  expected_delivery_date?: string | null
  items_count: number
  updated_at: string
}

type MaybePaginated<T> = T[] | { results?: T[] } | unknown

function unwrapList<T>(data: MaybePaginated<T>): T[] {
  if (Array.isArray(data)) return data
  if (data && typeof data === "object" && Array.isArray((data as { results?: T[] }).results)) {
    return (data as { results: T[] }).results
  }
  return []
}

export interface VendorPerformance {
  vendor_id: string
  vendor_name: string
  on_time_delivery_pct: number
  quality_reject_pct: number
  avg_delay_days: number
  ytd_value_inr: number
  open_po_value_inr: number
  total_pos: number
  completed_pos_fy: number
  open_pos: number
  total_receipts: number
}

export const procurementService = {
  list: async (params?: { status?: string; vendor?: string; search?: string }) => {
    const res = await api.get("/api/procurement/purchase-orders/", { params })
    return unwrapList<PurchaseOrderListItem>(res.data)
  },
  get: async (id: string) =>
    (await api.get<PurchaseOrder>(`/api/procurement/purchase-orders/${id}/`)).data,
  create: async (body: Partial<PurchaseOrder>) =>
    (await api.post<PurchaseOrder>("/api/procurement/purchase-orders/", body)).data,
  update: async (id: string, body: Partial<PurchaseOrder>) =>
    (await api.patch<PurchaseOrder>(`/api/procurement/purchase-orders/${id}/`, body)).data,
  remove: async (id: string) =>
    (await api.delete(`/api/procurement/purchase-orders/${id}/`)).data,
  send: async (id: string, channel = "pdf_only") =>
    (await api.post<PurchaseOrder>(`/api/procurement/purchase-orders/${id}/send/`, { channel })).data,
  acknowledge: async (id: string, ack_ref: string, ack_date?: string) =>
    (await api.post(`/api/procurement/purchase-orders/${id}/acknowledge/`, { ack_ref, ack_date })).data,
  cancel: async (id: string, reason: string) =>
    (await api.post(`/api/procurement/purchase-orders/${id}/cancel/`, { reason })).data,
  closeShort: async (id: string, line_id: string | null, reason: string) =>
    (await api.post(`/api/procurement/purchase-orders/${id}/close_short/`, { line_id, reason })).data,
  pdfUrl: (id: string) => `/api/procurement/purchase-orders/${id}/pdf/`,
  fromMrp: async (suggestion_id: string) =>
    (await api.post(`/api/procurement/purchase-orders/from_mrp/`, { suggestion_id })).data,
  vendorPerformance: async (vendor_id: string) =>
    (await api.get<VendorPerformance>(`/api/procurement/purchase-orders/vendor_performance/`, { params: { vendor: vendor_id } })).data,
  createReceipt: async (body: {
    purchase_order: string
    vendor_invoice_no?: string
    vendor_invoice_date?: string | null
    vehicle_no?: string
    driver_name?: string
    lr_no?: string
    notes?: string
    quality_status?: "PENDING" | "APPROVED" | "REJECTED"
    lines: Array<{
      po_item_id: string
      qty_received: number | string
      rate?: number | string
      notes?: string
      rejection_reason?: string
      width_mm?: number | string
      thickness_micron?: number | string
    }>
  }) => (await api.post<POReceipt>(`/api/procurement/purchase-order-receipts/`, body)).data,
  listReceipts: async (purchase_order?: string) => {
    const res = await api.get(`/api/procurement/purchase-order-receipts/`, {
      params: purchase_order ? { purchase_order } : undefined,
    })
    return unwrapList<POReceipt>(res.data)
  },
}
