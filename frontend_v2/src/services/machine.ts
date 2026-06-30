/**
 * Machine Service - Machine-Centric Execution API
 * 
 * This service provides API interactions for the Machine Terminal.
 * Jobs belong to machines. Operators control machines.
 */
import { api } from '@/lib/api';

export interface MachineDetail {
    machine: {
        id: string;
        code: string;
        name: string;
        status: string;
        work_center_id: string;
        work_center_name: string;
        plant_id: string;
        plant_name: string;
    };
    operator: {
        id: string;
        username: string;
        name: string;
    } | null;
    current_job: ProductionJob | null;
    queue_count: number;
}

export interface ProductionJob {
    id: string;
    job_number: string;
    status: string;
    job_state: string;
    origin: string;
    priority: number;
    planned_date: string | null;
    template: string;
    template_name: string;
    current_process: string | null;
    process_code: string;
    roll_behavior: string | null;
    work_center: string | null;
    work_center_name: string;
    machine: string | null;
    machine_name: string;
    operator: string | null;
    operator_name: string;
    quantity: number;
    uom: string;
    customer_name: string;
    order_number: string;
    sales_order_line_label?: string;
    line_label?: string;
    display_label?: string;
    product_name: string;
    geometry: Record<string, any>;
    layers: Array<Record<string, any>>;
    bom_snapshot: Record<string, any>;
    unit_weight_g: number;
    total_weight_kg: number;
    product_spec?: any;
    produced_qty: number;
    remaining_qty: number;
    primary_uom?: 'KG' | 'PCS';
    step_target_primary?: number | null;
    step_produced_primary?: number | null;
    step_remaining_primary?: number | null;
    tolerance_primary?: number | null;
    step_target_kg?: number;
    step_target_pcs?: number | null;
    step_produced_kg?: number;
    step_remaining_kg?: number;
    step_target_source?: string;
    order_target_source?: string;
    execution_model_version?: number;
    input_form: 'NONE' | 'BULK' | 'ROLL';
    output_form: 'BULK' | 'ROLL';
    /** 0-based index of the current step within the job's routing rule. */
    current_step_index?: number;
    committed_artwork_id?: string | null;
    committed_artwork_code?: string | null;
    committed_artwork_name?: string | null;
    /** Text color names from artwork, not ink-master consumption mapping. */
    ink_colors?: string[];
    current_step_print_capable?: boolean;
}

export interface InterPlantDCMeta {
    id: string;
    dc_no: string;
    print_pdf_url: string;
}

export type MachineCompleteResponse = ProductionJob & {
    interplant_dc?: InterPlantDCMeta;
    completion_mode?: 'NORMAL' | 'FORCED_VARIANCE';
    variance_kg?: number;
    force_reason?: string | null;
};

export interface OperatorMachine {
    id: string;
    code: string;
    name: string;
    status: string;
    work_center_name: string;
    plant_name: string;
    current_job: {
        id: string;
        job_number: string;
        product_name: string;
    } | null;
    queue_count: number;
    // --- Live machine state (WC machines payload enrichment) ---
    /** Live execution state for the machine card. */
    state?: 'IDLE' | 'RUNNING' | 'DOWN';
    /** Job number currently running on this machine, if any. */
    current_job_number?: string | null;
    /** ISO timestamp the machine is reserved/busy until, if known. */
    busy_until?: string | null;
    /** Active roll reservations against this machine, if surfaced in the payload. */
    reservations?: Array<{
        id: string;
        roll_id: string;
        roll_label: string;
        material_name: string;
        qty_reserved: number;
        job_number?: string | null;
    }>;
}

export interface OperatorMachineParams {
    limit?: number;
    offset?: number;
    q?: string;
    search?: string;
    work_center_id?: string;
    plant_id?: string;
}

export interface JobSatisfactionStatus {
    is_satisfied: boolean;
    roll_requirements: Array<{
        type: string;
        material_name: string;
        required_qty: number;
        reserved_qty: number;
        satisfied: boolean;
    }>;
    bulk_requirements: Array<{
        material_name: string;
        required_qty: number;
        available_qty: number;
        satisfied: boolean;
    }>;
    bulk_consumption?: Array<any>;
}

export interface JobContext {
    job: ProductionJob;
    continuation_banner?: {
        title: string;
        body: string;
        source_order_number?: string | null;
        planner_stock_class?: string | null;
        start_step_index?: number | null;
        stop_step_index?: number | null;
        tone?: string | null;
    } | null;
    execution_model_version?: number;
    display?: {
        template_name?: string;
        product_name?: string;
        step_name?: string;
        step_code?: string;
        roll_behavior?: string;
        show_pcs_secondary?: boolean;
    };
    execution_profile?: {
        primary_unit?: 'KG' | 'PCS';
        secondary_unit?: 'KG' | 'PCS';
        job_uom?: string;
        unit_weight_g?: number | null;
        derivation_available?: boolean;
        step_target_primary?: number | null;
        step_produced_primary?: number | null;
        step_remaining_primary?: number | null;
        tolerance_primary?: number | null;
        max_output_kg?: number | null;
        output_cap_source?: string;
        progress?: {
            weight_kg?: { target?: number | null; produced?: number | null; remaining?: number | null };
            pcs?: { target?: number | null; produced?: number | null; remaining?: number | null };
            primary?: {
                uom?: 'KG' | 'PCS';
                target?: number | null;
                produced?: number | null;
                remaining?: number | null;
                tolerance?: number | null;
            };
        };
    };
    progress?: {
        weight_kg?: { target?: number | null; produced?: number | null; remaining?: number | null };
        pcs?: { target?: number | null; produced?: number | null; remaining?: number | null };
        primary?: {
            uom?: 'KG' | 'PCS';
            target?: number | null;
            produced?: number | null;
            remaining?: number | null;
            tolerance?: number | null;
        };
    };
    roll_handling?: {
        output_variant?: string | null;
        output_variant_id?: string | null;
        thickness_rule?: string | null;
        width_rule?: string | null;
        operator_entry_mode?: string | null;
        behavior?: string | null;
        output_capture_policy?: Record<string, any>;
    };
    current_step_roll_handling?: Record<string, any>;
    target_roll_invariants?: Record<string, any>;
    target_roll_invariant_list?: Array<Record<string, any>>;
    current_step?: {
        /** 1-based sequence number of the current step in the route. */
        sequence?: number;
        process_name?: string;
        process_code?: string;
        input_form?: 'NONE' | 'BULK' | 'ROLL';
        output_form?: 'BULK' | 'ROLL';
    };
    /**
     * Per-step non-film material requirements up to and including the current
     * step. Each row carries the process name + 1-based sequence, which the
     * machine terminal uses to render the full process route strip.
     */
    all_other_requirements?: Array<{
        material_id?: string;
        code?: string;
        name?: string;
        category?: string;
        weight_kg?: number;
        uom?: string;
        step_sequence?: number | null;
        step_name?: string | null;
    }>;
    satisfaction: JobSatisfactionStatus;
    wip_pool: Array<{
        id: string;
        label_id: string;
        material_name: string;
        weight_kg: number;
        thickness_micron?: number;
        width_mm?: number;
        stock_form?: string | null;
        width_basis?: string | null;
        grade?: string | null;
        location_name?: string | null;
        status: string;
    }>;
    wip_pool_meta?: {
        required_for_step?: boolean;
        eligible_count?: number;
        eligible_weight_kg?: number;
        lineage_roll_count?: number;
        lineage_total_weight_kg?: number;
        discoverable_roll_count?: number;
        discoverable_total_weight_kg?: number;
        fallback_roll_count?: number;
        fallback_total_weight_kg?: number;
        required_rolls?: number;
        reserved_rolls?: number;
        missing_rolls?: number;
        missing_lineage_rolls?: number;
        missing_assignment_rolls?: number;
        missing_discoverable_rolls?: number;
        blocked_reasons?: string[];
        action_hints?: string[];
    };
    discoverable_pool?: Array<{
        id: string;
        label_id: string;
        material_name?: string | null;
        weight_kg: number;
        thickness_micron?: number;
        width_mm?: number;
        stock_form?: string | null;
        width_basis?: string | null;
        grade?: string | null;
        location_name?: string | null;
        status: string;
        roll_source?: string | null;
    }>;
    fallback_pool?: Array<{
        id: string;
        label_id: string;
        material_name?: string | null;
        weight_kg: number;
        thickness_micron?: number;
        width_mm?: number;
        stock_form?: string | null;
        width_basis?: string | null;
        grade?: string | null;
        location_name?: string | null;
        status: string;
        roll_source?: string | null;
    }>;
    roll_assignment_validation?: {
        required_rolls?: number;
        required_target_specs?: Array<Record<string, any>>;
        matched_target_slots?: Array<Record<string, any>>;
        unmatched_target_slots?: Array<Record<string, any>>;
        matched_roll_ids?: string[];
        unmatched_roll_ids?: string[];
        assigned_roll_count?: number;
        slot_satisfied?: boolean;
        is_complete?: boolean;
    };
    wip_recent_lineage?: Array<{
        id: string;
        label_id: string;
        material_name?: string | null;
        weight_kg: number;
        status: string;
        location_name?: string | null;
        stage?: string;
        width_mm?: number;
        thickness_micron?: number;
        stock_form?: string | null;
        width_basis?: string | null;
        grade?: string | null;
    }>;
    reservations?: Array<{
        id: string;
        roll_id: string;
        roll_label: string;
        material_name: string;
        qty_reserved: number;
    }>;
    allocated_rolls?: Array<{
        id: string;
        label_id: string;
        material_name: string;
        weight_kg: number;
        width_mm?: number;
        thickness_micron?: number;
        stock_form?: string | null;
        width_basis?: string | null;
        reservation_id?: string | null;
        location_name?: string;
        status?: string;
    }>;
    inputs?: {
        rolls_required?: number;
        rolls_reserved?: number;
        reserved_rolls?: Array<{
            id: string;
            label_id: string;
            weight_kg: number;
            thickness_micron?: number;
            width_mm?: number;
            stock_form?: string | null;
            width_basis?: string | null;
            variant?: string;
            variant_id?: string;
            grade?: string | null;
            grade_id?: string | null;
            location_name?: string;
        }>;
        bulk_preview?: Array<{
            requirement_id?: string;
            material_id?: string;
            material_name?: string;
            required_qty_kg?: number;
            theoretical_qty_kg?: number;
            planned_issue_qty_kg?: number;
            actual_issued_qty_kg?: number;
            actual_returned_qty_kg?: number;
            actual_scrap_qty_kg?: number;
            actual_consumed_qty_kg?: number;
            variance_qty_kg?: number;
            estimated_actual_qty_kg?: number;
            capture_mode?: string;
            strategy?: string;
            available_qty_kg?: number;
            current_plant_available_qty_kg?: number;
            other_plants_available_qty_kg?: number;
        }>;
        bulk_preview_theoretical?: Array<{
            requirement_id?: string;
            material_id?: string;
            material_name?: string;
            required_qty_kg?: number;
            theoretical_qty_kg?: number;
            planned_issue_qty_kg?: number;
            actual_issued_qty_kg?: number;
            actual_returned_qty_kg?: number;
            actual_scrap_qty_kg?: number;
            actual_consumed_qty_kg?: number;
            variance_qty_kg?: number;
            estimated_actual_qty_kg?: number;
            capture_mode?: string;
            strategy?: string;
            available_qty_kg?: number;
            current_plant_available_qty_kg?: number;
            other_plants_available_qty_kg?: number;
        }>;
    };
    live_consumption?: {
        total_consumed_kg?: number;
        total_scrap_kg?: number;
        last_events?: Array<{
            type: string;
            timestamp?: string | null;
            quantity_kg?: number;
            uom?: string;
            reason?: string;
        }>;
    };
    telemetry?: {
        execution_health?: {
            primary_uom?: 'KG' | 'PCS';
            step_target_primary?: number | null;
            step_produced_primary?: number | null;
            step_remaining_primary?: number | null;
            input_ready?: boolean;
            roll_shortage_count?: number;
            step_target_kg?: number;
            step_produced_kg?: number;
            step_remaining_kg?: number;
            next_action_hint?: string;
            last_transition?: {
                type?: string;
                timestamp?: string | null;
                quantity_kg?: number;
            } | null;
        };
        inventory_counters?: {
            bulk_consumed_kg?: number;
            rolls_consumed_kg?: number;
            rolls_consumed_count?: number;
            rolls_created_kg?: number;
            rolls_created_count?: number;
            scrap_kg?: number;
            live_logs?: Array<{
                type: string;
                timestamp?: string | null;
                quantity_kg?: number;
                roll_label?: string;
                reason?: string;
            }>;
        };
        bulk_consumed_kg?: number;
        rolls_consumed_kg?: number;
        rolls_consumed_count?: number;
        rolls_created_kg?: number;
        rolls_created_count?: number;
        scrap_kg?: number;
        live_logs?: Array<{
            type: string;
            timestamp?: string | null;
            quantity_kg?: number;
            roll_label?: string;
            reason?: string;
        }>;
    };
    geometry_cards?: {
        base_geometry?: Record<string, any>;
        effective_geometry?: Record<string, any>;
        adjustments_summary?: Array<{
            name?: string;
            value?: number | string | null;
            unit?: string | null;
            on?: string | null;
        }>;
        pod_summary?: Record<string, any>;
    };
    step_execution?: {
        primary_uom?: 'KG' | 'PCS';
        secondary_uom?: 'KG' | 'PCS';
        roll_target_kg?: number;
        bulk_target_kg?: number;
        total_target_kg?: number;
        produced_kg?: number;
        remaining_kg?: number;
        max_output_kg?: number | null;
        input_cap_kg?: number | null;
        cap_source?: string;
        target_pcs?: number | null;
        produced_pcs?: number | null;
        remaining_pcs?: number | null;
        target_primary?: number | null;
        produced_primary?: number | null;
        remaining_primary?: number | null;
        tolerance_kg?: number;
        tolerance_primary?: number | null;
        derivation_fallback?: boolean;
        closed_with_variance?: boolean;
        target_source?: string;
    };
    step_policy?: {
        execution_model_version?: number;
        allocation_required?: boolean;
        allocation_mode?: string;
        allocation_scope?: string;
        roll_to_bulk_validation_mode?: string;
        output_capture_policy?: Record<string, any>;
        step_target_source?: string;
        order_target_source?: string;
        tolerance_kg?: number;
    };
    order_progress?: {
        weight_kg?: { target?: number | null; produced?: number | null; remaining?: number | null };
        pcs?: { target?: number | null; produced?: number | null; remaining?: number | null };
    };
    input_form: 'NONE' | 'BULK' | 'ROLL';
    output_form: 'BULK' | 'ROLL';
}

export type MachineHistoryStatus = 'ALL' | 'NORMAL' | 'FORCED_VARIANCE';

export interface MachineHistoryFilters {
    date_from?: string;
    date_to?: string;
    status?: MachineHistoryStatus;
}

export interface MachineHistoryResponse {
    machine: {
        id: string;
        name: string;
        code: string;
        work_center_name?: string | null;
        plant_name?: string | null;
    };
    filters: {
        date_from?: string | null;
        date_to?: string | null;
        status: MachineHistoryStatus;
    };
    summary: {
        jobs_completed: number;
        produced_kg: number;
        scrap_kg: number;
        forced_variance_count: number;
    };
    daily: Array<{
        date: string;
        produced_kg: number;
        scrap_kg: number;
        jobs_completed: number;
    }>;
    jobs: Array<{
        job_id: string;
        job_number: string;
        template_name: string;
        step_name: string;
        completed_at: string | null;
        completion_mode: 'NORMAL' | 'FORCED_VARIANCE';
        variance_kg: number;
        produced_kg: number;
        scrap_kg: number;
    }>;
}

export interface MachineJobEvent {
    id: string;
    type: 'OUTPUT' | 'SCRAP' | 'DOWNTIME_START' | 'DOWNTIME_END' | 'CONSUMPTION' | 'QUALITY' | string;
    ts?: string | null;
    quantity?: number;
    uom?: string;
    label?: string;
    reason?: string;
    material?: string;
    granule_code?: string | null;
    parameter?: string;
    value?: string;
    in_spec?: boolean;
    duration_min?: number;
    user?: string | null;
}

export const machineService = {
    _normalizeList<T = any>(payload: any): T[] {
        if (Array.isArray(payload)) return payload as T[];
        const p = payload || {};
        const candidates = [p.queue, p.results, p.jobs, p.machines, p.data];
        for (const candidate of candidates) {
            if (Array.isArray(candidate)) return candidate as T[];
        }
        return [];
    },

    // Get machine details with operator and current job
    getMachineDetail: async (machineId: string): Promise<MachineDetail> => {
        const { data } = await api.get(`/api/production/machine/${machineId}/`);
        return (data?.data || data) as MachineDetail;
    },

    // Get job queue for a machine
    getQueue: async (machineId: string): Promise<ProductionJob[]> => {
        const { data } = await api.get(`/api/production/machine/${machineId}/queue/`);
        return machineService._normalizeList<ProductionJob>(data?.data || data);
    },

    // Start a job on a machine
    startJob: async (machineId: string, jobId: string): Promise<ProductionJob> => {
        const { data } = await api.post(`/api/production/machine/${machineId}/jobs/${jobId}/start/`);
        return (data?.data || data) as ProductionJob;
    },

    // Stop/pause a job on a machine
    stopJob: async (machineId: string, jobId: string, reason?: string): Promise<ProductionJob> => {
        const { data } = await api.post(`/api/production/machine/${machineId}/jobs/${jobId}/stop/`, { reason });
        return (data?.data || data) as ProductionJob;
    },

    // Log output (keeps step open)
    logOutput: async (
        machineId: string,
        jobId: string,
        payload: {
            actual_qty: number;
            output_width_mm?: number;
            output_length_m?: number;
            output_pcs?: number;
            output_stock_form?: string;
            stock_form?: string;
            scrap_qty?: number;
            roll_outputs?: Array<{ width_mm: number; weight_kg: number; length_m?: number; tare_weight_kg?: number; gross_weight_kg?: number; stock_form?: string; width_basis?: string }>;
            split_outputs?: Array<{ width_mm: number; weight_kg: number; tare_weight_kg?: number; gross_weight_kg?: number; stock_form?: string; width_basis?: string }>;
            remainder_location_id?: string;
        }
    ): Promise<ProductionJob> => {
        const { data } = await api.post(`/api/production/machine/${machineId}/jobs/${jobId}/log-output/`, payload);
        return (data?.data || data) as ProductionJob;
    },

    // Complete/close current step
    completeJob: async (
        machineId: string,
        jobId: string,
        payload?: {
            force_reason?: string;
            material_confirmations?: Array<{
                requirement_id: string;
                material_id?: string;
                actual_issued_qty: number;
                actual_returned_qty: number;
                actual_scrap_qty: number;
                is_estimated?: boolean;
                granule_code_allocations?: Array<{ granule_code_id: string; qty_kg: number }>;
            }>;
        }
    ): Promise<MachineCompleteResponse> => {
        const { data } = await api.post(`/api/production/machine/${machineId}/jobs/${jobId}/complete/`, payload || {});
        return (data?.data || data) as MachineCompleteResponse;
    },

    // Get full job execution context
    getJobContext: async (machineId: string, jobId: string): Promise<JobContext> => {
        const { data } = await api.get(`/api/production/machine/${machineId}/jobs/${jobId}/context/`);
        return (data?.data || data) as JobContext;
    },

    // Get input satisfaction status
    getJobSatisfaction: async (machineId: string, jobId: string): Promise<JobSatisfactionStatus> => {
        const { data } = await api.get(`/api/production/machine/${machineId}/jobs/${jobId}/satisfaction/`);
        return (data?.data || data) as JobSatisfactionStatus;
    },

    // Machine-level completion history
    getMachineHistory: async (
        machineId: string,
        filters?: MachineHistoryFilters
    ): Promise<MachineHistoryResponse> => {
        const params = new URLSearchParams();
        if (filters?.date_from) params.set('date_from', filters.date_from);
        if (filters?.date_to) params.set('date_to', filters.date_to);
        if (filters?.status) params.set('status', filters.status);
        const query = params.toString();
        const { data } = await api.get(
            `/api/production/machine/${machineId}/history/${query ? `?${query}` : ''}`
        );
        return (data?.data || data) as MachineHistoryResponse;
    },

    // Log scrap for a job
    logScrap: async (
        machineId: string,
        jobId: string,
        payload: { quantity: number; reason: string; reason_master_id?: string; notes?: string }
    ): Promise<ProductionJob> => {
        const { data } = await api.post(`/api/production/machine/${machineId}/jobs/${jobId}/log-scrap/`, payload);
        return (data?.data || data) as ProductionJob;
    },

    logDowntime: async (
        machineId: string,
        jobId: string,
        payload: {
            reason: string;
            reason_master_id?: string;
            start_time?: string;
            end_time?: string;
            notes?: string;
            auto_stop?: boolean;
        }
    ): Promise<ProductionJob> => {
        const { data } = await api.post(`/api/production/machine/${machineId}/jobs/${jobId}/log-downtime/`, payload);
        return (data?.data || data) as ProductionJob;
    },

    logConsumption: async (
        machineId: string,
        jobId: string,
        payload: {
            material_id?: string;
            granule_code_id?: string;
            roll_id?: string;
            quantity: number;
            uom?: string;
            is_estimated?: boolean;
            notes?: string;
        }
    ): Promise<any> => {
        const { data } = await api.post(`/api/production/machine/${machineId}/jobs/${jobId}/log-consumption/`, payload);
        return data?.data || data;
    },

    logQuality: async (
        machineId: string,
        jobId: string,
        payload: {
            readings: Array<{
                code: string;
                value_numeric?: number | null;
                value_text?: string;
                spec_min?: number | null;
                spec_max?: number | null;
                in_spec?: boolean;
            }>;
        }
    ): Promise<{ created: string[] }> => {
        const { data } = await api.post(`/api/production/machine/${machineId}/jobs/${jobId}/log-quality/`, payload);
        return (data?.data || data) as { created: string[] };
    },

    getJobEvents: async (machineId: string, jobId: string, limit = 20): Promise<MachineJobEvent[]> => {
        const { data } = await api.get(`/api/production/machine/${machineId}/jobs/${jobId}/events/`, {
            params: { limit },
        });
        const payload = data?.data || data;
        return machineService._normalizeList<MachineJobEvent>(payload?.events ? { results: payload.events } : payload);
    },

    // Get operator's assigned machines (for machine selector)
    getOperatorMachines: async (params?: OperatorMachineParams): Promise<OperatorMachine[]> => {
        const { data } = await api.get('/api/production/operator/machines/', { params });
        return machineService._normalizeList<OperatorMachine>(data?.data || data);
    },
};
