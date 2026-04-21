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
    type: 'INWARD' | 'CONSUME' | 'TRANSFER' | 'ADJUST'
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
    type: 'INWARD' | 'CONSUME' | 'TRANSFER' | 'ADJUST' | 'PRODUCE'
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
    status: "DRAFT" | "POSTED" | "LOCKED" | "VOID"
    notes?: string
    source_file_name?: string
    summary_json?: Record<string, any>
    line_count?: number
    lines?: InventoryAuditLine[]
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

export interface StockCardPayload {
    opening_qty: number
    movement_qty: number
    closing_qty: number
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
    getLocations: async (plantId: string) => {
        const { data } = await api.get<MaybePaginated<Location>>(`/api/inventory/plants/${plantId}/locations/`)
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

    getPackagingStock: async (params?: any) => {
        const { data } = await api.get("/api/inventory/packaging/stock/", { params })
        return unwrapList<PackagingStockRow>(data)
    },

    getPackagingTransactions: async (params?: any) => {
        const { data } = await api.get("/api/inventory/packaging/transactions/", { params })
        return unwrapList<PackagingTransactionRow>(data)
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

    getAuditBatch: async (id: string) => {
        const { data } = await api.get<InventoryAuditBatch>(`/api/inventory/audit/batches/${id}/`)
        return data
    },

    importAuditLines: async (id: string, payload: { lines: any[] }) => {
        const { data } = await api.post<InventoryAuditBatch>(`/api/inventory/audit/batches/${id}/lines/import/`, payload)
        return data
    },

    validateAuditBatch: async (id: string) => {
        const { data } = await api.post<InventoryAuditBatch & { validation?: any }>(`/api/inventory/audit/batches/${id}/lines/validate/`)
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

    getClosingPreview: async (params?: { plant?: string; financial_year?: string }) => {
        const { data } = await api.get<InventoryClosingPreview>("/api/inventory/audit/closing-preview/", { params })
        return data
    },

    getStockCard: async (params?: { material?: string; plant?: string; location?: string; from?: string; to?: string }) => {
        const { data } = await api.get<StockCardPayload>("/api/inventory/audit/stock-card/", { params })
        return data
    },

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
