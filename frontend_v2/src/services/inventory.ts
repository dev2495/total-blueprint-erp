import { api } from "@/lib/api"

type MaybePaginated<T> = T[] | { results?: T[] } | unknown

function unwrapList<T>(data: MaybePaginated<T>): T[] {
    if (Array.isArray(data)) return data
    if (data && typeof data === "object" && Array.isArray((data as any).results)) {
        return (data as any).results as T[]
    }
    return []
}

export interface Location {
    id: string
    plant: string
    plant_name?: string
    code: string
    name: string
    type: string
    is_active: boolean
}

export interface Vendor {
    id: string
    name: string
    code: string
    type: 'RM' | 'JOBWORK' | 'SERVICE' | 'BOTH'
    under_group?: string
    gst_no?: string
    pan_no?: string
    address?: string
    mailing_name?: string
    mailing_state?: string
    mailing_country?: string
    mailing_pincode?: string
    additional_addresses?: AddressBookEntry[]
    phone_number?: string
    email?: string
    contact_person?: string
    contact_details?: string
    payment_terms?: string
    credit_days?: number
    interest_calculation?: string
    bank_details?: string
    tds_deductable?: boolean
    tcs_deductable?: boolean
    lead_time_days: number
    jobwork_capabilities?: string[]
    jobwork_plants?: string[]
    turnaround_hours?: number
    qc_required?: boolean
    status: 'ACTIVE' | 'INACTIVE' | 'BLACKLISTED'
    created_at?: string
    updated_at?: string
}

export interface AddressBookEntry {
    label?: string
    name?: string
    address?: string
    state?: string
    country?: string
    pincode?: string
    contact_person?: string
    phone?: string
    email?: string
}

export interface Roll {
    id: string,
    label_id: string
    material_name: string
    material_code: string
    batch_no: string
    thickness_micron: number
    width_mm: number
    length_m: number
    weight_kg: number
    location_name: string
    status: string
    age_days: number
    stage_index: number
    stage_name: string
}

export interface InventoryBulk {
    id: string
    material: string
    material_name: string
    material_code: string
    material_category: string
    granule_quality_code?: string | null
    granule_quality_code_id?: string | null
    plant: string
    plant_name: string
    location: string
    location_name: string
    qty_kg: number
    quantity?: number
    uom?: string
    stock_uom?: string
    avg_cost: number
    updated_at: string
}

export interface BulkTransaction {
    id: string
    material: string
    material_name: string
    material_code: string
    granule_quality_code?: string | null
    granule_quality_code_id?: string | null
    location: string
    location_name: string
    type: 'INWARD' | 'PRODUCE' | 'CONSUME' | 'TRANSFER' | 'ADJUST' | 'OPENING_BALANCE' | 'OPENING_BALANCE_ADJUST' | 'COUNT_SHORT' | 'COUNT_EXCESS' | 'FY_ROLLFORWARD' | 'FY_CORRECTION'
    qty_kg: number
    avg_cost: number
    reference: string
    job: string | null
    job_no: string | null
    created_at: string
}

export interface PackagingStockRow {
    id: string
    material: string
    material_name: string
    material_code: string
    packaging_kind: string
    base_uom: string
    plant: string
    plant_name: string
    location: string
    location_name: string
    qty: number
    avg_cost: number
    updated_at: string
}

export interface PackagingTransactionRow {
    id: string
    type: 'INWARD' | 'CONSUME' | 'TRANSFER' | 'ADJUST' | 'PRODUCE' | 'OPENING_BALANCE' | 'OPENING_BALANCE_ADJUST' | 'COUNT_SHORT' | 'COUNT_EXCESS' | 'FY_ROLLFORWARD' | 'FY_CORRECTION'
    material: string
    material_name: string
    material_code: string
    base_uom?: string
    location: string
    location_name: string
    qty: number
    avg_cost?: number | null
    vendor?: string | null
    vendor_name?: string | null
    job?: string | null
    job_no?: string | null
    sales_order_item?: string | null
    mts_order?: string | null
    reference?: string | null
    created_at: string
    meta_json?: Record<string, any>
}

export interface GrnHistoryRow {
    id: string
    source_type: "BULK" | "PACKAGING" | "ROLL"
    source_id: string
    material?: string
    material_code?: string
    material_name?: string
    material_category?: string
    granule_quality_code?: string
    packaging_kind?: string
    roll?: string
    label_id?: string
    batch_no?: string
    grade_name?: string
    width_mm?: number
    thickness_micron?: number
    plant?: string
    plant_name?: string
    location?: string
    location_name?: string
    quantity: number
    uom: string
    avg_cost?: number
    reference?: string
    vendor?: string | null
    vendor_code?: string | null
    vendor_name?: string | null
    created_at?: string | null
}

export interface GrnCorrectionPayload {
    reason: string
    quantity?: number
    avg_cost?: number
    reference?: string
    label_id?: string
    batch_no?: string
}

export interface WipAgingPool {
    klass: string // RAW-FILM | EXT-ROLL | PRINTED | LAMINATED | SLIT | FG-POUCH
    label: string
    description?: string
    uom: "KG" | "PCS" | "M"
    total: number
    fresh: number
    aging: number
    stale: number
    dead: number
    line_counts?: { fresh: number; aging: number; stale: number; dead: number }
    tags?: Array<{ code: string; label?: string; count?: number; tone?: "blue" | "rose" | "emerald" | "amber" | "violet" | "fuchsia" | "slate" }>
}

export interface WipAgingResponse {
    generated_at: string
    fresh_max_days: number
    aging_max_days: number
    stale_max_days: number
    pools: WipAgingPool[]
}

export interface InventoryFinancialPeriod {
    id: string
    financial_year: string
    start_date: string
    end_date: string
    status: "OPEN" | "CLOSING_IN_PROGRESS" | "CLOSED"
    closed_at?: string | null
    closing_batch?: string | null
    closing_batch_no?: string | null
    opening_batch_next_year?: string | null
    opening_batch_next_year_no?: string | null
}

export interface InventoryAuditLine {
    id: string
    stock_class: "BULK" | "ROLL" | "PACKAGING"
    material: string
    material_code?: string
    material_name?: string
    material_category?: string
    granule_code?: string | null
    granule_code_label?: string | null
    grade?: string | null
    grade_name?: string | null
    plant: string
    plant_name?: string
    location: string
    location_name?: string
    uom: string
    system_qty: number
    counted_qty?: number | null
    variance_qty: number
    opening_qty: number
    rate?: number | null
    value: number
    label_id?: string
    batch_no?: string
    width_mm?: number | null
    thickness_micron?: number | null
    length_m?: number | null
    is_fg?: boolean
    stage_index?: number
    status?: string
    packaging_kind?: string
    base_uom?: string
    row_errors?: string[]
    posted_reference_json?: Record<string, any>
}

export interface InventoryAuditBatch {
    id: string
    batch_no: string
    type: "OPENING_STOCK" | "PHYSICAL_COUNT" | "FY_CLOSE" | "FY_CORRECTION"
    plant: string
    plant_name?: string
    plant_code?: string
    financial_year: string
    cutoff_at: string
    status: "DRAFT" | "SUBMITTED" | "APPROVED" | "POSTED" | "LOCKED" | "CANCELLED" | "VOID"
    notes?: string
    source_file_name?: string
    summary_json?: Record<string, any>
    line_count?: number
    lines?: InventoryAuditLine[]
    created_by_name?: string | null
    posted_by_name?: string | null
    posted_at?: string | null
}

export interface InventoryClosingPreview {
    financial_year: string
    plant?: { id: string; name: string; code: string } | null
    rows: Array<Record<string, any>>
    totals: Record<string, number>
    movements: Record<string, number>
    blockers: Array<{ code: string; label: string; count: number }>
}

export interface InventoryStockSnapshotPayload {
    plant?: { id: string; name: string; code: string } | null
    rows: Array<Record<string, any>>
    totals: Record<string, number>
}

export interface InventoryV36SnapshotPayload {
    as_of: string
    plant_id?: string | null
    kpi: Record<string, any>
    rolls: Roll[]
    bulk: InventoryBulk[]
    packaging: PackagingStockRow[]
}

export interface StockCardPayload {
    opening_qty: number
    movement_qty: number
    closing_qty: number
    opening_value?: number
    movement_value?: number
    closing_rate?: number
    closing_value?: number
    rows: Array<{
        at: string
        source: string
        reference: string
        material_id?: string | null
        material_code?: string
        material_name?: string
        location_id?: string | null
        location_name?: string
        qty: number
        in_qty?: number
        out_qty?: number
        balance_qty?: number
        rate?: number | null
        balance_rate?: number | null
        transaction_value?: number | null
        value?: number | null
        display_value?: number | null
        uom: string
        meta?: Record<string, any>
    }>
}

export interface BulkStock {
    material_id: string
    material_name: string
    material_code: string
    location_name: string
    quantity: number
    uom: string
}

export interface JobWorkOrder {
    id: string
    plant: string
    plant_name: string
    vendor?: string | null
    vendor_name: string
    production_job?: string | null
    production_job_number?: string | null
    mode?: 'PLANNED_STEP' | 'EMERGENCY'
    route_step_index?: number | null
    emergency_reason?: string
    sent_material_type: string
    expected_return_type: string
    status: string
    notes: string
    dispatched_at?: string | null
    received_at?: string | null
    meta_json?: Record<string, any>
    created_at: string
}

export interface JobWorkVendorCandidate {
    id: string
    name: string
    code: string
    type: string
    status: string
    turnaround_hours: number
    qc_required: boolean
    jobwork_capabilities: string[]
    jobwork_plants: string[]
    vendor_capability_match: boolean
    match_reasons: string[]
}

export interface JobWorkEligibleRoll {
    id: string
    label_id: string
    material_name?: string | null
    status: string
    weight_kg: number
    location_name?: string | null
    production_job_number?: string | null
}

export const inventoryService = {
    // Locations
    getLocations: async (plantId?: string) => {
        const url = plantId ? `/api/inventory/plants/${plantId}/locations/` : "/api/inventory/locations/"
        const { data } = await api.get<MaybePaginated<Location>>(url)
        return unwrapList<Location>(data)
    },

    // Vendors
    getVendors: async () => {
        const { data } = await api.get<MaybePaginated<Vendor>>("/api/inventory/vendors/")
        return unwrapList<Vendor>(data)
    },
    createVendor: async (payload: Partial<Vendor>) => {
        const { data } = await api.post<Vendor>("/api/inventory/vendors/", payload)
        return data
    },
    updateVendor: async (id: string, payload: Partial<Vendor>) => {
        const { data } = await api.patch<Vendor>(`/api/inventory/vendors/${id}/`, payload)
        return data
    },
    deleteVendor: async (id: string) => {
        await api.delete(`/api/inventory/vendors/${id}/`)
    },

    // Stock
    getBulkStock: async (params?: any) => {
        const { data } = await api.get("/api/inventory/bulk/", { params })
        return data as InventoryBulk[] // Unified Phase 56 model
    },

    getBulkTransactions: async (params?: any) => {
        const { data } = await api.get("/api/inventory/bulk-transactions/", { params })
        return data as BulkTransaction[]
    },

    getRollStock: async (plantId?: string, locationId?: string, jobId?: string) => {
        const params: any = {}
        if (plantId) params.plant = plantId
        if (locationId) params.location = locationId
        if (jobId) params.reserved_for_job = jobId

        const { data } = await api.get<MaybePaginated<Roll>>("/api/inventory/rolls/", { params })
        return unwrapList<Roll>(data)
    },

    getInventorySnapshot: async (params?: { plant_id?: string; plant?: string; as_of?: string }) => {
        const { data } = await api.get<InventoryV36SnapshotPayload>("/api/inventory/snapshot/", { params })
        return data
    },

    getInventoryClassSnapshot: async (klass: "rolls" | "bulk" | "packaging" | "addons", params?: Record<string, any>) => {
        const endpoint = klass === "addons" ? "/api/inventory/addons/" : `/api/inventory/${klass}/v36/`
        const { data } = await api.get(endpoint, { params })
        return data as { items: Array<Record<string, any>>; total: number; next_cursor?: string | null; facets?: Record<string, any[]> }
    },

    getInventoryCoverage: async (params?: Record<string, any>) => {
        const { data } = await api.get<{ items: Array<Record<string, any>> }>("/api/inventory/coverage/", { params })
        return data.items || []
    },

    getInventoryTrend: async (params?: { days?: number; plant_id?: string }) => {
        const { data } = await api.get<{ items: Array<Record<string, any>> }>("/api/inventory/snapshot/trend/", { params })
        return data.items || []
    },

    /**
     * WIP aging by stock class (RAW-FILM, EXT-ROLL, PRINTED, LAMINATED, SLIT, FG-POUCH).
     * Default age buckets: fresh ≤2d · aging 3-5d · stale 6-10d · dead >10d.
     * Falls back to a derived view from getRollStock + getBulkStock when backend lacks
     * the dedicated endpoint, so the Visual Factory page renders against real seed data
     * without requiring a new backend deploy.
     */
    getWipAging: async (params?: { plant_id?: string; klass?: string }): Promise<WipAgingResponse> => {
        try {
            const { data } = await api.get<WipAgingResponse>("/api/inventory/wip/aging/", { params })
            if (data && Array.isArray((data as any).pools)) return data
        } catch {/* fall through to local derive */}
        return deriveWipAgingLocally(params)
    },

    getInventoryExportUrl: (klass: "rolls" | "bulk" | "packaging" | "addons") => {
        return `/api/inventory/${klass}/export/`
    },

    getSavedViews: async (workspace: "rolls" | "bulk" | "packaging" | "addons" | "home") => {
        const { data } = await api.get<{ items: Array<Record<string, any>> }>("/api/inventory/saved-views/", { params: { workspace } })
        return data.items || []
    },

    createSavedView: async (payload: { workspace: string; name: string; icon?: string; pinned?: boolean; state: Record<string, any> }) => {
        const { data } = await api.post("/api/inventory/saved-views/", payload)
        return data
    },

    updateSavedView: async (id: string, payload: Partial<{ name: string; icon: string; pinned: boolean; state: Record<string, any> }>) => {
        const { data } = await api.patch(`/api/inventory/saved-views/${id}/`, payload)
        return data
    },

    deleteSavedView: async (id: string) => {
        await api.delete(`/api/inventory/saved-views/${id}/`)
    },

    getInventoryAnomalies: async (params?: { plant_id?: string; kind?: string }) => {
        const { data } = await api.get<{ items: Array<Record<string, any>> }>("/api/inventory/anomalies/", { params })
        return data.items || []
    },

    getInventoryReservations: async (params?: { ref_id?: string; ref_type?: "ROLL" | "BULK" | "PACKAGING" }) => {
        const { data } = await api.get<{ items: Array<Record<string, any>> }>("/api/inventory/reservations/", { params })
        return data.items || []
    },

    // GRN
    createBulkGRN: async (payload: {
        material_id: string, location_id: string, vendor_id: string, quantity: number, reference?: string, [key: string]: any
    }) => {
        return await api.post("/api/inventory/grn/bulk/", payload)
    },

    createRollGRN: async (payload: {
        material_id: string, location_id: string, vendor_id: string, rolls: any[], reference?: string, [key: string]: any
    }) => {
        return await api.post("/api/inventory/grn/roll/", payload)
    },

    createPackagingGRN: async (payload: {
        material_id: string
        location_id: string
        vendor_id: string
        quantity: number
        cost?: number
        reference?: string
        [key: string]: any
    }) => {
        return await api.post("/api/inventory/grn/packaging/", payload)
    },

    createUnifiedGRN: async (payload: {
        klass: "BULK" | "ROLL" | "PACKAGING"
        vendor_id?: string
        vendor_invoice_no?: string
        vendor_invoice_date?: string
        plant_id?: string
        store_location_id?: string
        warehouse_id?: string
        reference_po_id?: string
        transport?: Record<string, any>
        remarks?: string
        lines: Array<Record<string, any>>
        [key: string]: any
    }) => {
        const { data } = await api.post("/api/inventory/grn/create/", payload)
        return data
    },

    uploadRollGrnExcel: async (file: File, context?: {
        vendor_id?: string
        warehouse_id?: string
        vendor_invoice_no?: string
        vendor_invoice_date?: string
        dry_run?: boolean
    }) => {
        const form = new FormData()
        form.append("file", file)
        if (context?.vendor_id) form.append("vendor_id", context.vendor_id)
        if (context?.warehouse_id) form.append("warehouse_id", context.warehouse_id)
        if (context?.vendor_invoice_no) form.append("vendor_invoice_no", context.vendor_invoice_no)
        if (context?.vendor_invoice_date) form.append("vendor_invoice_date", context.vendor_invoice_date)
        if (context?.dry_run) form.append("dry_run", "true")
        const { data } = await api.post("/api/inventory/grn/upload-rolls/", form, {
            headers: { "Content-Type": "multipart/form-data" },
        })
        return data
    },

    downloadRollGrnTemplate: async () => {
        const { data } = await api.get("/api/inventory/grn/roll-upload-template/", {
            responseType: "blob",
        })
        return data as Blob
    },

    getPackagingStock: async (params?: any) => {
        const { data } = await api.get("/api/inventory/packaging/stock/", { params })
        return unwrapList<PackagingStockRow>(data)
    },

    getPackagingTransactions: async (params?: any) => {
        const { data } = await api.get("/api/inventory/packaging/transactions/", { params })
        return unwrapList<PackagingTransactionRow>(data)
    },

    getGrnHistory: async (params?: any) => {
        const { data } = await api.get<MaybePaginated<GrnHistoryRow>>("/api/inventory/grn/history/", { params })
        return unwrapList<GrnHistoryRow>(data)
    },

    correctGrnHistoryRow: async (sourceType: GrnHistoryRow["source_type"], id: string, payload: GrnCorrectionPayload) => {
        const { data } = await api.post(`/api/inventory/grn/history/${sourceType}/${id}/correct/`, payload)
        return data as { status: string; audit_id: string; delta: Record<string, any> }
    },

    // Job Work
    getOrders: async () => {
        const { data } = await api.get<MaybePaginated<JobWorkOrder>>("/api/inventory/job-work/")
        return unwrapList<JobWorkOrder>(data)
    },

    createOrder: async (orderData: {
        plant: string
        vendor: string
        mode?: "PLANNED_STEP" | "EMERGENCY"
        route_step_index?: number
        emergency_reason?: string
        sent_material_type: "RM" | "WIP" | "FG"
        expected_return_type: "RM" | "WIP" | "FG"
        production_job?: string
        notes?: string
    }) => {
        const { data } = await api.post("/api/inventory/job-work/", orderData)
        return data as JobWorkOrder
    },

    dispatchOrder: async (orderId: string, payload: { roll_ids: string[], bulk_items?: any[] }) => {
        const { data } = await api.post(`/api/inventory/job-work/${orderId}/dispatch/`, payload)
        return data
    },

    receiveOrder: async (orderId: string, payload: { target_location_id: string, received_rolls?: any[], received_bulk?: any[] }) => {
        const { data } = await api.post(`/api/inventory/job-work/${orderId}/receive/`, payload)
        return data
    },

    getJobWorkVendorCandidates: async (params?: {
        production_job_id?: string
        plant_id?: string
        process_code?: string
    }) => {
        const { data } = await api.get<{ results?: JobWorkVendorCandidate[] }>("/api/inventory/job-work/vendor-candidates/", { params })
        return data?.results || []
    },

    getJobWorkEligibleRolls: async (orderId: string) => {
        const { data } = await api.get<{ results?: JobWorkEligibleRoll[] }>(`/api/inventory/job-work/${orderId}/eligible-rolls/`)
        return data?.results || []
    },

    getLedger: async (params?: any) => {
        const { data } = await api.get("/api/inventory/ledger/", { params })
        return data
    },

    getAuditPeriods: async () => {
        const { data } = await api.get<MaybePaginated<InventoryFinancialPeriod>>("/api/inventory/audit/periods/")
        return unwrapList<InventoryFinancialPeriod>(data)
    },

    startAuditPeriod: async (payload: { financial_year: string }) => {
        const { data } = await api.post<InventoryFinancialPeriod>("/api/inventory/audit/periods/start/", payload)
        return data
    },

    beginPeriodClose: async (periodId: string) => {
        const { data } = await api.post<InventoryFinancialPeriod>(`/api/inventory/audit/periods/${periodId}/begin-close/`)
        return data
    },

    closePeriod: async (periodId: string, payload: { plant: string }) => {
        const { data } = await api.post<InventoryFinancialPeriod>(`/api/inventory/audit/periods/${periodId}/close/`, payload)
        return data
    },

    getAuditBatches: async (params?: any) => {
        const { data } = await api.get<MaybePaginated<InventoryAuditBatch>>("/api/inventory/audit/batches/", { params })
        return unwrapList<InventoryAuditBatch>(data)
    },

    createAuditBatch: async (payload: Partial<InventoryAuditBatch>) => {
        const { data } = await api.post<InventoryAuditBatch>("/api/inventory/audit/batches/", payload)
        return data
    },

    startAuditBatch: async (id: string) => {
        const { data } = await api.post<InventoryAuditBatch>(`/api/inventory/audit/batches/${id}/start/`)
        return data
    },

    finalizeAuditBatch: async (id: string) => {
        const { data } = await api.post<InventoryAuditBatch>(`/api/inventory/audit/batches/${id}/finalize/`)
        return data
    },

    submitAuditCountLine: async (id: string, payload: Record<string, any>) => {
        const { data } = await api.post(`/api/inventory/audit/batches/${id}/submit-line/`, payload)
        return data
    },

    syncAuditCountLines: async (id: string, events: Array<Record<string, any>>) => {
        const { data } = await api.post(`/api/inventory/audit/batches/${id}/sync/`, { events })
        return data
    },

    getAuditBatchLocations: async (id: string) => {
        const { data } = await api.get<{ items?: Array<Record<string, any>> }>(`/api/inventory/audit/batches/${id}/locations/`)
        return data.items || []
    },

    getAuditBatchItems: async (id: string, params?: { location?: string; cursor?: string }) => {
        const { data } = await api.get<{ items?: Array<Record<string, any>> }>(`/api/inventory/audit/batches/${id}/items/`, { params })
        return data.items || []
    },

    getAuditBatch: async (id: string) => {
        const { data } = await api.get<InventoryAuditBatch>(`/api/inventory/audit/batches/${id}/`)
        return data
    },

    importAuditLines: async (id: string, payload: { lines: any[] }) => {
        const { data } = await api.post<InventoryAuditBatch>(`/api/inventory/audit/batches/${id}/lines/import/`, payload)
        return data
    },

    importAuditLinesFile: async (id: string, file: File, stockClass?: string) => {
        const form = new FormData()
        form.append("file", file)
        if (stockClass) form.append("stock_class", stockClass)
        const { data } = await api.post<InventoryAuditBatch>(`/api/inventory/audit/batches/${id}/lines/import-file/`, form, {
            headers: { "Content-Type": "multipart/form-data" },
        })
        return data
    },

    validateAuditBatch: async (id: string) => {
        const { data } = await api.post<InventoryAuditBatch & { validation?: any }>(`/api/inventory/audit/batches/${id}/lines/validate/`)
        return data
    },

    previewAuditBatch: async (id: string) => {
        const { data } = await api.get<{
            ok: boolean
            batch: Record<string, any>
            summary: Record<string, any>
            transaction_count: number
            blockers: Array<Record<string, any>>
            rows: Array<Record<string, any>>
            impact: Record<string, any>
        }>(`/api/inventory/audit/batches/${id}/preview/`)
        return data
    },

    submitAuditBatch: async (id: string) => {
        const { data } = await api.post<InventoryAuditBatch>(`/api/inventory/audit/batches/${id}/submit/`)
        return data
    },

    approveAuditBatch: async (id: string) => {
        const { data } = await api.post<InventoryAuditBatch>(`/api/inventory/audit/batches/${id}/approve/`)
        return data
    },

    loadAuditBatchFromSystemStock: async (id: string, payload: {
        stock_class?: string
        location?: string
        material?: string
        query?: string
        replace_existing?: boolean
    }) => {
        const { data } = await api.post<InventoryAuditBatch>(`/api/inventory/audit/batches/${id}/load-system-stock/`, payload)
        return data
    },

    postAuditBatch: async (id: string) => {
        const { data } = await api.post<InventoryAuditBatch>(`/api/inventory/audit/batches/${id}/post/`)
        return data
    },

    voidAuditBatch: async (id: string, reason?: string) => {
        const { data } = await api.post<InventoryAuditBatch>(`/api/inventory/audit/batches/${id}/void/`, { reason })
        return data
    },

    cancelAuditBatch: async (id: string, reason?: string) => {
        const { data } = await api.post<InventoryAuditBatch>(`/api/inventory/audit/batches/${id}/cancel/`, { reason })
        return data
    },

    getClosingPreview: async (params?: { plant?: string; financial_year?: string }) => {
        const { data } = await api.get<InventoryClosingPreview>("/api/inventory/audit/closing-preview/", { params })
        return data
    },

    getStockSnapshot: async (params?: { plant?: string; stock_class?: string; location?: string; material?: string; query?: string }) => {
        const { data } = await api.get<InventoryStockSnapshotPayload>("/api/inventory/audit/stock-snapshot/", { params })
        return data
    },

    postOpeningStockManual: async (payload: {
        plant?: string
        plant_id?: string
        financial_year?: string
        cutoff_at?: string
        notes?: string
        lines: Array<Record<string, any>>
    }) => {
        const { data } = await api.post<{
            batch_id: string
            rows_committed: number
            opening_value_inr: number
        }>("/api/inventory/opening-stock/manual/", payload)
        return data
    },

    postOpeningStockFromCount: async (payload: {
        batch_id: string
        financial_year?: string
        cutoff_at?: string
    }) => {
        const { data } = await api.post<{
            batch_id: string
            rows_committed: number
            opening_value_inr: number
        }>("/api/inventory/opening-stock/from-count/", payload)
        return data
    },

    getStockCard: async (params?: { material?: string; plant?: string; location?: string; financial_year?: string; from?: string; to?: string }) => {
        const { data } = await api.get<StockCardPayload>("/api/inventory/audit/stock-card/", { params })
        return data
    },

    getAuditBatchExportUrl: (id: string) => `/api/inventory/audit/batches/${id}/export/`,
    getAuditSampleTemplateUrl: (params?: { type?: string; stock_class?: string }) => {
        const query = new URLSearchParams()
        if (params?.type) query.set("type", params.type)
        if (params?.stock_class) query.set("stock_class", params.stock_class)
        return `/api/inventory/audit/batches/sample-template/${query.toString() ? `?${query.toString()}` : ""}`
    },
    getClosingPreviewExportUrl: () => `/api/inventory/audit/closing-preview/`,
    getStockCardExportUrl: () => `/api/inventory/audit/stock-card/`,

    reserveRolls: async (jobId: string, rollIds: string[]) => {
        return await api.post("/api/inventory/rolls/reserve/", {
            job_id: jobId,
            roll_ids: rollIds
        })
    },

    splitRoll: async (rollId: string, payload: { child_weight_kg: number; reason?: string }) => {
        const { data } = await api.post(`/api/inventory/rolls/${rollId}/split/`, payload)
        return data as {
            status: string
            parent_roll_id: string
            parent_roll_label: string
            claim_roll: Roll | null
            balance_roll: Roll | null
        }
    },

    // Inter-Plant
    getChallans: async () => {
        const { data } = await api.get<MaybePaginated<DeliveryChallan>>("/api/inventory/inter-plant/")
        return unwrapList<DeliveryChallan>(data)
    },

    createChallan: async (payload: {
        from_plant: string
        to_plant: string
        vehicle_no?: string
        driver_name?: string
        driver_phone?: string
        transporter_name?: string
        lr_number?: string
    }) => {
        return await api.post("/api/inventory/inter-plant/", payload)
    },

    dispatchChallan: async (id: string, payload: { target_location_id?: string, roll_ids?: string[], bulk_items?: any[] }) => {
        return await api.post(`/api/inventory/inter-plant/${id}/dispatch/`, payload)
    },

    receiveChallan: async (id: string, payload: { target_location_id: string, roll_ids?: string[], bulk_items?: Array<{ material_id: string; quantity: number }> }) => {
        return await api.post(`/api/inventory/inter-plant/${id}/receive_challan/`, payload)
    },

    getInterPlantPrintPdfUrl: (id: string) => {
        return `/api/inventory/inter-plant/${id}/print-pdf/`
    },
}

/**
 * Local-derive helper for the WIP-aging endpoint until the backend ships a dedicated route.
 * Pulls existing roll + bulk inventory snapshots and buckets each row by its age in days
 * (created_at / received_at → today). Returns the canonical WipAgingResponse shape so the
 * UI doesn't need to branch on "real vs derived".
 *
 * Bucket thresholds:
 *   fresh  ≤ 2 days
 *   aging  3–5 days
 *   stale  6–10 days
 *   dead   > 10 days
 */
async function deriveWipAgingLocally(params?: { plant_id?: string; klass?: string }): Promise<WipAgingResponse> {
    const FRESH_MAX = 2
    const AGING_MAX = 5
    const STALE_MAX = 10

    const ageDaysOf = (iso: string | null | undefined): number => {
        if (!iso) return 0
        const dt = new Date(iso).getTime()
        if (!Number.isFinite(dt)) return 0
        return Math.max(0, Math.floor((Date.now() - dt) / (1000 * 60 * 60 * 24)))
    }

    const bucketise = (rows: Array<{ kg: number; age: number }>) => {
        const pool = { total: 0, fresh: 0, aging: 0, stale: 0, dead: 0, fresh_n: 0, aging_n: 0, stale_n: 0, dead_n: 0 }
        for (const r of rows) {
            const kg = Number(r.kg) || 0
            pool.total += kg
            if (r.age <= FRESH_MAX) { pool.fresh += kg; pool.fresh_n += 1 }
            else if (r.age <= AGING_MAX) { pool.aging += kg; pool.aging_n += 1 }
            else if (r.age <= STALE_MAX) { pool.stale += kg; pool.stale_n += 1 }
            else { pool.dead += kg; pool.dead_n += 1 }
        }
        return pool
    }

    // Pull what the backend currently exposes — gracefully tolerate failures.
    let rollRows: any[] = []
    let bulkRows: any[] = []
    try { rollRows = await inventoryService.getRollStock(params?.plant_id) || [] } catch {/* no-op */}
    try { bulkRows = await inventoryService.getBulkStock(params?.plant_id ? { plant: params.plant_id } : undefined) || [] } catch {/* no-op */}

    // Bucket rolls by their role/stage signature.
    const rollByStage: Record<string, Array<{ kg: number; age: number }>> = {
        "EXT-ROLL": [], "PRINTED": [], "LAMINATED": [], "SLIT": [], "FG-POUCH": [],
    }
    for (const r of rollRows) {
        const role = String((r as any).role || (r as any).stock_class || (r as any).inventory_class || "").toUpperCase()
        const kg = Number((r as any).net_weight_kg || (r as any).weight_kg || (r as any).quantity || 0) || 0
        const age = ageDaysOf((r as any).created_at || (r as any).received_at)
        const target =
            role.includes("PRINT") ? "PRINTED" :
            role.includes("LAMIN") ? "LAMINATED" :
            role.includes("SLIT") ? "SLIT" :
            role.includes("POUCH") || role.includes("FG") ? "FG-POUCH" :
            "EXT-ROLL"
        rollByStage[target].push({ kg, age })
    }
    const raw = bulkRows.map((b: any) => ({
        kg: Number(b.net_weight_kg || b.weight_kg || b.quantity || 0) || 0,
        age: ageDaysOf(b.received_at || b.created_at),
    }))

    const POOL_META: Array<{ klass: string; label: string; description: string; uom: "KG"; rows: Array<{ kg: number; age: number }> }> = [
        { klass: "RAW-FILM", label: "Granule / raw resin", description: "Before extrusion", uom: "KG", rows: raw },
        { klass: "EXT-ROLL", label: "Extruded film roll", description: "Before printing / lamination", uom: "KG", rows: rollByStage["EXT-ROLL"] },
        { klass: "PRINTED", label: "Printed roll", description: "Artwork-locked · before lamination", uom: "KG", rows: rollByStage["PRINTED"] },
        { klass: "LAMINATED", label: "Laminated jumbo", description: "Before slit / pouching", uom: "KG", rows: rollByStage["LAMINATED"] },
        { klass: "SLIT", label: "Slit reel", description: "Pouching-ready", uom: "KG", rows: rollByStage["SLIT"] },
        { klass: "FG-POUCH", label: "Finished pouches", description: "Awaiting packing", uom: "KG", rows: rollByStage["FG-POUCH"] },
    ]

    const pools: WipAgingPool[] = POOL_META
        .filter((p) => !params?.klass || params.klass.toUpperCase() === p.klass)
        .map((p) => {
            const b = bucketise(p.rows)
            return {
                klass: p.klass,
                label: p.label,
                description: p.description,
                uom: p.uom,
                total: Math.round(b.total),
                fresh: Math.round(b.fresh),
                aging: Math.round(b.aging),
                stale: Math.round(b.stale),
                dead: Math.round(b.dead),
                line_counts: { fresh: b.fresh_n, aging: b.aging_n, stale: b.stale_n, dead: b.dead_n },
            }
        })

    return {
        generated_at: new Date().toISOString(),
        fresh_max_days: FRESH_MAX,
        aging_max_days: AGING_MAX,
        stale_max_days: STALE_MAX,
        pools,
    }
}

export interface DeliveryChallan {
    id: string
    dc_no?: string
    from_plant: string
    from_plant_name: string
    to_plant: string
    to_plant_name: string
    status: string
    dispatched_at?: string | null
    received_at?: string | null
    vehicle_no?: string
    driver_name?: string
    driver_phone?: string
    transporter_name?: string
    lr_number?: string
    is_system_generated?: boolean
    source_job?: string | null
    target_job?: string | null
    items?: DeliveryChallanItem[]
    transfer_summary?: {
        total_lines: number
        roll_lines: number
        bulk_lines: number
        dispatched_total_kg: number
        received_total_kg: number
        output_lines?: number
        remainder_lines?: number
        output_dispatched_kg?: number
        output_received_kg?: number
        remainder_dispatched_kg?: number
        remainder_received_kg?: number
    }
    item_preview?: Array<{
        line_type: 'ROLL' | 'BULK'
        roll_label?: string | null
        roll_role?: string | null
        material_name?: string | null
        dispatched_qty_kg: number
        from_location_name?: string | null
        to_location_name?: string | null
    }>
    created_at: string
    updated_at?: string
}

export interface DeliveryChallanItem {
    id: string
    line_type: 'ROLL' | 'BULK'
    status: 'PENDING' | 'DISPATCHED' | 'PARTIAL' | 'RECEIVED'
    roll?: string | null
    roll_label?: string | null
    roll_role?: string | null
    material?: string | null
    material_name?: string | null
    from_location?: string | null
    from_location_name?: string | null
    to_location?: string | null
    to_location_name?: string | null
    planned_qty_kg: number
    dispatched_qty_kg: number
    received_qty_kg: number
    created_at?: string
    updated_at?: string
}
