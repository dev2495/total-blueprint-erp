import { api } from "@/lib/api"
import { ProductionJob } from "./production"

export interface WorkCenterAssignment {
    id: string;
    production_job: string;
    job_details: ProductionJob;
    work_center: string;
    work_center_name: string;
    assigned_machine: string | null;
    assigned_machine_name: string | null;
    status: 'WC_READY' | 'ASSIGNED' | 'EXECUTION_READY';
    plant_id?: string;
    allocated_rolls: string[];
    allocated_roll_details?: any[];
    sales_order_item?: string;
    assigned_by: string | null;
    assigned_at: string | null;
    created_at: string;
    audit_events?: Array<{
        id: string;
        action: string;
        actor: string;
        actor_id?: string | null;
        reason?: string;
        before_status?: string;
        after_status?: string;
        machine?: string;
        machine_id?: string | null;
        payload?: Record<string, any>;
        occurred_at: string;
    }>;
    history_summary?: {
        output_qty?: number;
        scrap_qty?: number;
        material_rows?: any[];
        downtime_rows?: any[];
        closed_by?: string;
        closed_at?: string;
        force_reason?: string;
    };
}

export interface RollOverridePayload {
    manual_override?: boolean;
    override_reason?: string;
}

export interface CurrentStepMaterialPolicyItem {
    policy_key: string;
    requirement_id?: string;
    material_id?: string;
    material_name: string;
    material_code?: string;
    category_code?: string;
    step_sequence: number;
    step_name?: string;
    theoretical_qty: number;
    planned_issue_qty: number;
    template_issue_policy_mode: string;
    template_issue_policy_value: number;
    effective_issue_policy_mode: string;
    effective_issue_policy_value: number;
    policy_source: string;
    override_reason?: string;
}

export interface CurrentStepMaterialPolicyResponse {
    job_id: string;
    current_step_sequence: number;
    current_process_name?: string | null;
    items: CurrentStepMaterialPolicyItem[];
}

export const wcmService = {
    getQueue: async (wcId: string) => {
        const { data } = await api.get<WorkCenterAssignment[]>(`/api/production/wc/${wcId}/queue/`);
        return data;
    },
    getHistory: async (
        wcId: string,
        filters?: { q?: string; status?: string; days?: number | null; limit?: number }
    ) => {
        const params: Record<string, string | number> = {};
        if (filters?.q) params.q = filters.q;
        if (filters?.status && filters.status !== "ALL") params.status = filters.status;
        if (filters && "days" in filters) params.days = filters.days == null ? 0 : filters.days;
        if (filters?.limit) params.limit = filters.limit;
        const { data } = await api.get<WorkCenterAssignment[]>(`/api/production/wc/${wcId}/history/`, { params });
        return data;
    },
    getStats: async (wcId: string) => {
        const { data } = await api.get<{ running: number; waiting: number; total_active: number }>(`/api/production/wc/${wcId}/stats/`);
        return data;
    },

    getEligibleRolls: async (jobId: string) => {
        const { data } = await api.get<any[]>(`/api/production/wc-allocation/${jobId}/eligible-rolls/`);
        return data;
    },

    getTieredRolls: async (jobId: string) => {
        const { data } = await api.get<{
            candidates: Array<{
                roll_id: string;
                label_id: string;
                width_mm: number;
                thickness_micron: number;
                weight_kg: number;
                material_code: string;
                material_name: string;
                stage_index: number;
                tier: "ORDER_BOUND" | "EXACT" | "WIDER_OK_WITH_SLIT" | "REMAINDER_POOL";
                slit_preview: {
                    child_widths_mm: number[];
                    remainder_mm: number;
                    trim_mm: number;
                    gang_group_id?: string;
                    gang_job_count?: number;
                    assign_job_ids?: string[];
                } | null;
                meta: Record<string, any>;
            }>;
            target_width_mm: number | null;
        }>(`/api/production/jobs/${jobId}/tiered-rolls/`);
        return data;
    },

    allocateWithSlit: async (jobId: string, rollId: string, childWidthsMm: number[], reason?: string) => {
        const { data } = await api.post<{
            child_ids: string[];
            remainder_id: string | null;
            waste_mm: number;
            gang_group_id?: string;
            assigned_jobs?: Array<{ job_id: string; job_number: string; child_roll_id: string }>;
        }>(
            `/api/production/jobs/${jobId}/allocate-with-slit/`,
            { roll_id: rollId, child_widths_mm: childWidthsMm, reason: reason || "" },
        );
        return data;
    },

    getForWCM: async (params: any) => {
        const { data } = await api.get<any[]>(`/api/inventory/rolls/for-wcm/`, { params });
        return data;
    },

    assignMachine: async (assignmentId: string, machineId: string, rollIds?: string[], override?: RollOverridePayload) => {
        const { data } = await api.post<WorkCenterAssignment>(`/api/production/wc-allocation/assign-machine/`, {
            assignment_id: assignmentId,
            machine_id: machineId,
            roll_ids: rollIds,
            manual_override: Boolean(override?.manual_override),
            override_reason: override?.override_reason
        });
        return data;
    },

    allocateRolls: async (assignmentId: string, rollIds: string[], override?: RollOverridePayload) => {
        const { data } = await api.post<WorkCenterAssignment>(`/api/production/wc-allocation/allocate-rolls/`, {
            assignment_id: assignmentId,
            roll_ids: rollIds,
            manual_override: Boolean(override?.manual_override),
            override_reason: override?.override_reason
        });
        return data;
    },

    unassignRoll: async (assignmentId: string, reservationId: string) => {
        const { data } = await api.post<WorkCenterAssignment>(`/api/production/wc-allocation/unassign-roll/`, {
            assignment_id: assignmentId,
            reservation_id: reservationId
        });
        return data;
    },

    unassignRollByRoll: async (assignmentId: string, rollId: string) => {
        const { data } = await api.post<WorkCenterAssignment>(`/api/production/wc-allocation/unassign-roll-by-roll/`, {
            assignment_id: assignmentId,
            roll_id: rollId
        });
        return data;
    },

    markReady: async (assignmentId: string, materialConfirmations?: any[]) => {
        const { data } = await api.post<WorkCenterAssignment>(`/api/production/wc-allocation/ready/`, {
            assignment_id: assignmentId,
            material_confirmations: materialConfirmations
        });
        return data;
    },
    closeJob: async (assignmentId: string, mode: "SHORT_CLOSE" | "CANCEL", reason: string) => {
        const { data } = await api.post<WorkCenterAssignment>(`/api/production/wc-allocation/close-job/`, {
            assignment_id: assignmentId,
            mode,
            reason,
        });
        return data;
    },

    logDowntime: async (machineId: string, reason: string, durationMinutes?: number) => {
        const { data } = await api.post(`/api/factory/machines/${machineId}/downtime/`, {
            reason,
            duration_minutes: durationMinutes
        });
        return data;
    },

    // ========================================
    // Phase 68: Universal Flow Engine APIs
    // ========================================

    /**
     * Get satisfaction status for a job.
     * Returns required/available/missing roll counts & bulk consumption preview.
     */
    getSatisfactionStatus: async (jobId: string) => {
        const { data } = await api.get<SatisfactionStatus>(`/api/production/flow-engine/${jobId}/satisfaction/`);
        return data;
    },

    /**
     * Get WIP pool for a job (flat list).
     */
    getWipPool: async (jobId: string) => {
        const { data } = await api.get<WipRoll[]>(`/api/production/flow-engine/${jobId}/wip-pool/`);
        return data;
    },

    /**
     * Get WIP pool grouped by material family.
     */
    getWipPoolGrouped: async (jobId: string) => {
        const { data } = await api.get<Record<string, WipRoll[]>>(`/api/production/flow-engine/${jobId}/wip-pool-grouped/`);
        return data;
    },

    /**
     * Auto-satisfy job inputs from WIP pool.
     */
    autoSatisfy: async (jobId: string) => {
        const { data } = await api.post<{ auto_assigned: number; status: SatisfactionStatus }>(`/api/production/flow-engine/${jobId}/auto-satisfy/`);
        return data
    },

    /**
     * Get full job execution context.
     */
    getJobContext: async (jobId: string) => {
        const { data } = await api.get(`/api/production/flow-engine/${jobId}/context/`);
        return data;
    },
    getCurrentStepMaterialPolicy: async (jobId: string) => {
        const { data } = await api.get<CurrentStepMaterialPolicyResponse>(`/api/production/flow-engine/${jobId}/current-step-material-policy/`);
        return data;
    },
    updateCurrentStepMaterialPolicy: async (
        jobId: string,
        overrides: Array<{
            policy_key: string;
            issue_policy_mode: 'NONE' | 'PERCENT_OVER_THEORY' | 'FIXED_EXTRA_KG' | 'MINIMUM_ISSUE_KG';
            issue_policy_value: number;
            reason?: string;
        }>
    ) => {
        const { data } = await api.post<CurrentStepMaterialPolicyResponse>(`/api/production/flow-engine/${jobId}/current-step-material-policy/`, {
            overrides,
        });
        return data;
    },
    // (legacy duplicate removed)
}

// Phase 68 Types
export interface SatisfactionStatus {
    job_id: string;
    process_code: string;
    input_form: 'BULK' | 'ROLL' | 'NONE';
    roll_behavior?: 'CREATE_NEW' | 'MODIFY_EXISTING' | 'MULTI_INPUT_COMBINE' | 'SPLIT' | 'NONE';
    rolls_required: number;
    rolls_available: number;
    rolls_reserved: number;
    rolls_auto_forwarded: number;
    rolls_pool?: number;
    rolls_fallback_available?: number;
    rolls_missing: number;
    rolls_missing_lineage?: number;
    bulk_consumption: BulkConsumptionPreview[];
    is_satisfied: boolean;
    can_start: boolean;
    status_message: string;
}

export interface BulkConsumptionPreview {
    requirement_id?: string;
    material_id?: string;
    material_name?: string;
    category: string;
    category_display: string;
    mode: string;
    estimated_qty_kg?: number;
    required_qty_kg?: number;
    available_qty_kg?: number;
    plant_available_qty_kg?: number;
    global_available_qty_kg?: number;
    source_location_available_qty_kg?: number;
    current_plant_available_qty_kg?: number;
    other_plants_available_qty_kg?: number;
    available_qty?: number;
    capture_mode?: string;
    strategy?: string;
    granule_code_options?: Array<{
        granule_code_id: string;
        code: string;
        available_qty_kg: number;
        location_id?: string;
        location_name?: string;
        plant_id?: string;
        plant_name?: string;
    }>;
    is_auto_deduct: boolean;
}

export interface WipRoll {
    id: string;
    label_id: string;
    material_name: string;
    weight_kg: number;
    width_mm?: number;
    status: string;
    stage?: string;
}
