import { api } from "@/lib/api"

export interface ProductionJob {
    id: string;
    job_number: string;
    status: string;
    job_state: 'WAITING' | 'PLANNED' | 'RELEASED' | 'EXECUTING' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';
    source_type: string;
    priority: number;
    planned_date: string;
    is_on_hold: boolean;
    hold_reason: string;
    template_name: string;
    product_name: string;
    process_code: string;
    process_category: string;
    roll_behavior?: 'CREATE_NEW' | 'MODIFY_EXISTING' | 'MULTI_INPUT_COMBINE' | 'SPLIT' | 'NONE';
    layer_count: number;
    work_center_name: string;
    quantity: number;
    uom: string;
    order_number: string;
    customer_name: string;
    current_step_index: number;
    sales_order_item_id?: string | null;
    sales_order_line_label?: string;
    production_batch_id?: string | null;
    production_batch_number?: string;
    production_batch_status?: string;
    route_node?: {
        route_node_id?: string;
        route_node_label?: string;
        process_code?: string;
        route_branch_key?: string;
        join_key?: string;
        parallel_group?: string;
        predecessor_node_ids?: string[];
        successor_node_ids?: string[];
        is_join?: boolean;
        is_parallel_start?: boolean;
        optional_at_planning?: boolean;
        skippable_after_previous_output?: boolean;
        process_allows_optional_at_planning?: boolean;
        process_allows_skip_after_previous_output?: boolean;
        route_step_policy?: string;
    } | null;
    route_step_decision?: {
        decision?: string;
        source?: string;
        reason?: string;
        route_node_id?: string;
        route_node_label?: string;
        process_code?: string;
        previous_job_id?: string;
        decided_at?: string;
        decided_by?: string;
    } | null;
    runtime_skip_options?: Array<{
        job_id: string;
        job_number: string;
        process_code?: string;
        process_name?: string;
        route_node_id?: string;
        route_node_label?: string;
        route_step_policy?: string;
    }>;
    route_node_id?: string;
    route_branch_key?: string;
    process_name?: string;
    machine_name?: string;
    operator_name?: string;
    created_at?: string;
    updated_at?: string;
    closed_at?: string | null;
    input_form: 'ROLL' | 'BULK' | 'NONE';
    output_form: 'ROLL' | 'BULK';
    remaining_qty: number;
    sales_order_item?: string;
    total_weight_kg?: number;
    step_target_kg?: number;
    step_target_pcs?: number | null;
    primary_uom?: "KG" | "PCS";
    step_target_primary?: number | null;
    step_produced_primary?: number | null;
    step_remaining_primary?: number | null;
    step_adjusted_total_kg?: number;
    ink_colors?: string[];
    front_colors?: string[];
    back_colors?: string[];
    color_revision_no?: number;
    color_revision_changed_at?: string | null;
    color_revision_changed_by?: string;
    color_revision_reason?: string;
    previous_front_colors?: string[];
    previous_back_colors?: string[];
    operator_notice_required?: boolean;

    // Technical Specs
    geometry?: any;
    layers?: any[];
    printing?: any;
    addons?: any[];
    product_spec?: any;
}

export interface StockProductionOrder {
    id: string;
    order_number: string;
    template: string;
    template_name: string;
    plant: string;
    plant_name: string;
    target_qty: number;
    produced_qty: number;
    geometry_override?: {
        width_mm?: number;
        height_mm?: number;
        gusset_mm?: number;
        adjustments?: Array<{ name: string; value: number; impact: 'WIDTH' | 'HEIGHT' | 'BOTH' }>;
    };
    start_step_index?: number;
    stop_step_index?: number;
    target_step_index?: number;
    status: 'DRAFT' | 'PLANNING_REQUIRED' | 'PLANNED' | 'RELEASED' | 'STOCK_READY' | 'COMPLETED' | 'CANCELLED';
    created_at: string;
    created_by_name: string;
    updated_at?: string;
    name?: string;
    internal_name?: string;
    quantity?: number;
    quantity_uom?: string;
    stock_purpose?: string;
    stock_strategy?: string;
    planner_stock_class?: string;
    derived_output_type?: string;
    geometry?: any;
    geometry_snapshot?: any;
    film_layers?: any[];
    layer_snapshot?: any[];
    printing?: any;
    printing_snapshot?: any;
    addons?: any[];
    addons_snapshot?: any[];
    packaging_snapshot?: any;
    bom_snapshot?: any;
    spec_signature?: string;
    unit_weight_g?: number;
    total_weight_kg?: number;
}

export interface BulkStockOrder {
    id: string;
    order_number: string;
    bulk_class: string;
    material: string;
    material_code: string;
    material_name: string;
    plant: string;
    plant_name: string;
    quantity_kg: number;
    target_qty_kg: number;
    produced_qty_kg: number;
    name?: string;
    internal_name?: string;
    pod_profile_snapshot?: Record<string, any>;
    planner_origin_meta?: Record<string, any>;
    status: string;
    created_by_name?: string;
    created_at: string;
    updated_at: string;
}

export interface CurrentShift {
    shift_code: string;
    started_at: string | null;
    ends_at: string | null;
}

export const productionService = {
    getJobs: async (params?: any) => {
        const { data } = await api.get<ProductionJob[]>("/api/production/jobs/", { params });
        return data;
    },

    getCurrentShift: async (at?: string) => {
        const { data } = await api.get<CurrentShift>("/api/production/current-shift/", {
            params: at ? { at } : undefined,
        });
        return data;
    },

    getJob: async (id: string) => {
        const { data } = await api.get<ProductionJob>(`/api/production/jobs/${id}/`);
        return data;
    },

    releaseJob: async (id: string) => {
        const { data } = await api.post(`/api/production/jobs/${id}/release/`);
        return data;
    },

    toggleHold: async (id: string, reason?: string) => {
        const { data } = await api.post(`/api/production/jobs/${id}/toggle-hold/`, { reason });
        return data;
    },

    resumeJob: async (id: string) => {
        const { data } = await api.post(`/api/production/jobs/${id}/resume/`);
        return data;
    },

    reprioritizeJob: async (id: string, priority: number) => {
        const { data } = await api.post(`/api/production/jobs/${id}/reprioritize/`, { priority });
        return data;
    },

    splitJob: async (id: string, split_qty: number) => {
        const { data } = await api.post<{ original: ProductionJob, child: ProductionJob }>(`/api/production/jobs/${id}/split/`, { split_qty });
        return data;
    },

    sendToJobWork: async (
        id: string,
        payload?: {
            vendor_id?: string
            mode?: "PLANNED_STEP" | "EMERGENCY"
            emergency_reason?: string
            notes?: string
        }
    ) => {
        const { data } = await api.post(`/api/production/jobs/${id}/job-work/`, payload || {});
        return data;
    },

    // Stock Production Orders (Stock)
    getStockOrders: async (params?: any) => {
        const { data } = await api.get<StockProductionOrder[]>("/api/production/stock-orders/", { params });
        return data;
    },

    getStockOrder: async (id: string) => {
        const { data } = await api.get<StockProductionOrder>(`/api/production/stock-orders/${id}/`);
        return data;
    },

    getBulkStockOrder: async (id: string) => {
        const { data } = await api.get<BulkStockOrder>(`/api/production/bulk-stock-orders/${id}/`);
        return data;
    },

    createStockOrder: async (payload: { template: string; qty_planned: number; plant?: string }) => {
        const { data } = await api.post<StockProductionOrder>("/api/production/stock-orders/", payload);
        return data;
    },

    createJobFromStockOrder: async (id: string) => {
        const { data } = await api.post<{ message: string, job_id: string }>(`/api/production/stock-orders/${id}/create_job/`);
        return data;
    },

    // Phase 64B: WCM Execution
    getExecutionContext: async (id: string) => {
        const { data } = await api.get(`/api/production/execution/${id}/execution-context/`);
        return data;
    },

    assignRoll: async (jobId: string, rollId: string) => {
        const { data } = await api.post(`/api/production/execution/${jobId}/assign-rolls/`, { roll_id: rollId });
        return data;
    },

    unassignRoll: async (jobId: string, reservationId: string) => {
        const { data } = await api.post(`/api/production/execution/${jobId}/unassign-roll/`, { reservation_id: reservationId });
        return data;
    },

    startJob: async (id: string) => {
        const { data } = await api.post(`/api/production/execution/${id}/start/`);
        return data;
    },

    completeJob: async (id: string, actualQty: number) => {
        const { data } = await api.post(`/api/production/execution/${id}/complete/`, { actual_qty: actualQty });
        return data;
    }
}
