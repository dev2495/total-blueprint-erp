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
    input_form: 'ROLL' | 'BULK' | 'NONE';
    output_form: 'ROLL' | 'BULK';
    remaining_qty: number;
    sales_order_item?: string;
    total_weight_kg?: number;
    step_target_kg?: number;
    step_target_pcs?: number | null;
    step_adjusted_total_kg?: number;

    // Technical Specs
    geometry?: any;
    layers?: any[];
    printing?: any;
    addons?: any[];
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
}

export const productionService = {
    getJobs: async (params?: any) => {
        const { data } = await api.get<ProductionJob[]>("/api/production/jobs/", { params });
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
