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
    granule_codes?: Array<{ id: string; code: string; label?: string; name?: string }>
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
    granule_code?: string | null
    grade?: string | null
    grade_id?: string | null
    label_id?: string
    batch_no?: string
    width_mm?: number
    thickness_micron?: number
    length_m?: number
    stock_form?: string
    width_basis?: string
    granule_code_id?: string | null
    rate?: number | null
    notes?: string
}

export interface OpeningStockPayload {
    plant_id: string
    financial_year?: string
    cutoff_at?: string
    counted_as_of?: string
    opening_mode?: "TRUE_OPENING" | "CUTOVER_OPENING" | string
    cutover?: boolean
    reason_code?: string
    notes?: string
    lines: OpeningStockLine[]
}

export interface OpeningStockUploadPayload {
    plant_id: string
    financial_year?: string
    cutoff_at?: string
    opening_mode?: "TRUE_OPENING" | "CUTOVER_OPENING" | string
    reason_code?: string
    commit?: boolean
    dry_run?: boolean
}

export interface OpeningStockUploadResult {
    batch_id?: string
    rows_total?: number
    rows_valid?: number
    rows_invalid?: number
    rows_committed?: number
    opening_value_inr?: number
    summary_by_klass?: Record<string, number>
    errors?: Array<{ row?: number; field?: string; message?: string }>
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
    uploadOpeningStock: async (file: File, payload: OpeningStockUploadPayload): Promise<OpeningStockUploadResult> => {
        const form = new FormData()
        form.append("file", file)
        form.append("plant_id", payload.plant_id)
        if (payload.financial_year) form.append("financial_year", payload.financial_year)
        if (payload.cutoff_at) form.append("cutoff_at", payload.cutoff_at)
        if (payload.opening_mode) form.append("opening_mode", payload.opening_mode)
        if (payload.reason_code) form.append("reason_code", payload.reason_code)
        if (payload.commit !== undefined) form.append("commit", payload.commit ? "true" : "false")
        if (payload.dry_run !== undefined) form.append("dry_run", payload.dry_run ? "true" : "false")
        const response = await api.post<OpeningStockUploadResult>(
            "/api/inventory/opening-stock/csv/",
            form,
            { headers: { "Content-Type": "multipart/form-data" } }
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
            `/api/inventory/audit/batches/${batchId}/post/`
        )
        return response.data
    },
    cancelBatch: async (batchId: string, reason?: string) => {
        const response = await api.post(
            `/api/inventory/audit/batches/${batchId}/cancel/`,
            { reason }
        )
        return response.data
    },
    createInventorySnapshot: async (plantId: string) => {
        const response = await api.post(
            "/api/inventory/snapshots/create_now/",
            { plant_id: plantId }
        )
        return response.data
    },
}
