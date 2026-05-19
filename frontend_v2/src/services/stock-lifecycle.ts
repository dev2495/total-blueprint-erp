import { api } from "@/lib/api"

export interface StockLifecycleLocation {
    id: string | null
    name: string
    qty: number
}

export interface StockLifecycleRow {
    id: string
    code: string
    name: string
    category: string
    stock_class: "BULK" | "ROLL" | "PACKAGING"
    base_uom: string
    is_extrudable?: boolean
    default_grade_id?: string | null
    default_grade_name?: string | null
    system_qty: number
    locations: StockLifecycleLocation[]
}

export interface MasterCatalog {
    plant: { id: string; name: string; code: string } | null
    rows: StockLifecycleRow[]
    by_category: Record<string, StockLifecycleRow[]>
}

export interface InventoryFinancialPeriod {
    id: string
    label?: string
    financial_year: string
    start_date?: string
    end_date?: string
    status: "OPEN" | "CLOSING_IN_PROGRESS" | "CLOSED" | string
    closing_batch_no?: string | null
    opening_batch_next_year_no?: string | null
    closed_by_name?: string | null
    closed_at?: string | null
}

export interface OpeningStockLine {
    material: string
    qty: number
    location?: string | null
    stock_class?: string
    grade?: string | null
    grade_id?: string | null
    label_id?: string
    batch_no?: string
    width_mm?: number
    thickness_micron?: number
    rate?: number | null
    notes?: string
}

export interface OpeningStockPayload {
    plant_id: string
    financial_year?: string
    notes?: string
    lines: OpeningStockLine[]
}

export interface CountBatchPayload {
    plant: string
    financial_year?: string
    type?: string
    cutoff_at?: string
    notes?: string
    lines?: Array<Record<string, unknown>>
    [key: string]: unknown
}

export const stockLifecycleService = {
    getPeriods: async (): Promise<InventoryFinancialPeriod[]> => {
        const response = await api.get<InventoryFinancialPeriod[] | { results?: InventoryFinancialPeriod[] }>(
            "/api/inventory/audit/periods/"
        )
        const data = response.data
        if (Array.isArray(data)) return data
        if (data && Array.isArray((data as any).results)) return (data as any).results
        return []
    },
    startPeriod: async (financialYear: string): Promise<InventoryFinancialPeriod> => {
        const response = await api.post<InventoryFinancialPeriod>(
            "/api/inventory/audit/periods/start/",
            { financial_year: financialYear }
        )
        return response.data
    },
    closePeriod: async (periodId: string, plantId: string): Promise<InventoryFinancialPeriod> => {
        const response = await api.post<InventoryFinancialPeriod>(
            `/api/inventory/audit/periods/${periodId}/close/`,
            { plant: plantId }
        )
        return response.data
    },
    getCatalog: async (plantId: string): Promise<MasterCatalog> => {
        const response = await api.get<MasterCatalog>(
            "/api/inventory/audit/master-catalog/",
            { params: { plant: plantId } }
        )
        return response.data
    },
    getSnapshot: async (plantId: string) => {
        const response = await api.get(
            "/api/inventory/audit/stock-snapshot/",
            { params: { plant: plantId } }
        )
        return response.data
    },
    getClosingPreview: async (plantId: string, fy?: string) => {
        const response = await api.get(
            "/api/inventory/audit/closing-preview/",
            { params: { plant: plantId, financial_year: fy } }
        )
        return response.data
    },
    postOpeningStock: async (payload: OpeningStockPayload) => {
        const response = await api.post(
            "/api/inventory/opening-stock/manual/",
            payload
        )
        return response.data
    },
    createCountBatch: async (payload: CountBatchPayload) => {
        const response = await api.post(
            "/api/inventory/audit/batches/",
            payload
        )
        return response.data
    },
    postBatch: async (batchId: string) => {
        const response = await api.post(
            `/api/inventory/audit/batches/${batchId}/post-batch/`
        )
        return response.data
    },
}
