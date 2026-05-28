import { api } from "@/lib/api"

export interface DispatchLine {
  id?: string
  sales_order_item: string
  sales_order_item_label?: string
  qty_dispatched: number | string
  uom?: string
  notes?: string
}

export interface CustomerDispatch {
  id: string
  code: string
  sales_order: string
  sales_order_number?: string
  plant: string | null
  plant_name?: string
  customer: string | null
  customer_name?: string
  dispatch_date: string
  status: "DRAFT" | "CONFIRMED" | "DISPATCHED" | "CANCELLED"
  vehicle_no: string
  driver_name: string
  lr_no: string
  invoice_no: string
  notes: string
  created_at: string
  confirmed_at: string | null
  dispatched_at: string | null
  cancelled_at: string | null
  lines: DispatchLine[]
}

function unwrap<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[]
  if (data && typeof data === "object" && Array.isArray((data as { results?: T[] }).results)) {
    return (data as { results: T[] }).results
  }
  return []
}

export const customerDispatchApi = {
  async list(params?: { sales_order?: string; status?: string }): Promise<CustomerDispatch[]> {
    const { data } = await api.get("/api/sales/customer-dispatches/", { params })
    return unwrap<CustomerDispatch>(data)
  },
  async get(id: string): Promise<CustomerDispatch> {
    const { data } = await api.get(`/api/sales/customer-dispatches/${id}/`)
    return data as CustomerDispatch
  },
  async create(payload: Partial<CustomerDispatch> & { sales_order: string; lines: DispatchLine[] }): Promise<CustomerDispatch> {
    const { data } = await api.post("/api/sales/customer-dispatches/", payload)
    return data as CustomerDispatch
  },
  async update(id: string, payload: Partial<CustomerDispatch>): Promise<CustomerDispatch> {
    const { data } = await api.patch(`/api/sales/customer-dispatches/${id}/`, payload)
    return data as CustomerDispatch
  },
  async confirm(id: string): Promise<CustomerDispatch> {
    const { data } = await api.post(`/api/sales/customer-dispatches/${id}/confirm/`)
    return data as CustomerDispatch
  },
  async markDispatched(id: string): Promise<CustomerDispatch> {
    const { data } = await api.post(`/api/sales/customer-dispatches/${id}/mark_dispatched/`)
    return data as CustomerDispatch
  },
  async cancel(id: string): Promise<CustomerDispatch> {
    const { data } = await api.post(`/api/sales/customer-dispatches/${id}/cancel/`)
    return data as CustomerDispatch
  },
}
