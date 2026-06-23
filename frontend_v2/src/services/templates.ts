import type { AxiosRequestConfig } from "axios";

import { api } from "@/lib/api";

type MaybePaginated<T> = T[] | { results?: T[] } | unknown;

function unwrapList<T>(data: MaybePaginated<T>): T[] {
    if (Array.isArray(data)) return data;
    if (data && typeof data === "object" && Array.isArray((data as any).results)) {
        return (data as any).results as T[];
    }
    return [];
}

export interface TemplateBlueprint {
    id: string;
    name: string;
    fg_type: "POUCH" | "ROLL";
    pouch_style?: "THREE_SIDE_SEAL" | "PILLOW" | "STAND_UP" | "SIDE_GUSSET" | "QUAD_SEAL" | "FLAT_BOTTOM" | "SPOUT" | "SHAPED" | "";
    commercial_family?: string | null;
    commercial_family_name?: string | null;
    default_stock_strategy?: "FINAL_STOCK" | "INTERMEDIATE_POOL" | "PACKAGING_STOCK";
    status: "DRAFT" | "ENGINEERING" | "APPROVED" | "LIVE" | "OBSOLETE";
    routing_rule: string | null;
    routing_rule_name?: string;
    version: number;
    version_group?: string;
    is_current_version?: boolean;
    source_template?: string | null;
    source_template_name?: string | null;
    superseded_by?: string | null;
    superseded_by_name?: string | null;
    correction_draft_id?: string | null;
    correction_reason?: string;
    created_by_name?: string;
    created_at: string;
    created_from?: string;
    editable_fields?: string[];
    geometry_schema?: Record<string, any> | null;
    layer_schema?: Record<string, any> | null;
    printing_schema?: Record<string, any> | null;
    chemistry_gsm?: Record<string, any> | null;
    addons_schema?: Record<string, any> | null;
    pod_type?: string | null;
    artwork?: any;
    process_steps?: TemplateProcessStep[];
    readiness?: TemplateReadiness;
    theoretical_requirements?: {
        step_id: string;
        step_sequence: number;
        category: string;
        name?: string;
        consumption_basis?: string;
        issue_policy_mode?: string;
        issue_policy_value?: number;
        capture_mode?: string;
        quantity_mode: string;
        value: number;
        weight_kg?: number;
        is_optional: boolean;
    }[];
}

export interface TemplateReadiness {
    ready: boolean;
    blockers: string[];
    warnings: string[];
    active_steps: number;
    lamination_passes: Array<{
        step_id: string;
        sequence_number: number;
        process_name: string;
        pass_index: number;
        lane_count: number;
        adhesive_split_pct: number;
        solvent_split_pct: number;
    }>;
    supported_categories: string[];
}

export interface TemplateProcessStep {
    id: string;
    template: string;
    sequence_number: number;
    process: string;
    process_name: string;
    process_code: string;
    process_input_form: "BULK" | "ROLL" | "NONE";
    process_output_form: "BULK" | "ROLL";
    process_roll_behavior?: "CREATE_NEW" | "MODIFY_EXISTING" | "MULTI_INPUT_COMBINE" | "SPLIT" | "NONE";
    allowed_work_center_ids?: string[];
    default_work_center?: string | null;
    default_work_center_code?: string | null;
    default_work_center_name?: string | null;
    work_center_selection_policy?: "AUTO_IF_SINGLE" | "AUTO_DEFAULT" | "PLANNER_REQUIRED";
    dispatch_notes?: string;
    dispatch_updated_at?: string | null;
    dispatch_status?: RouteDispatchStepStatus;
    notes: string;
    is_removed_from_route?: boolean;
    materials: TemplateMaterial[];
    roll_handling?: TemplateProcessStepRollHandlingRule | null;
}

export interface RouteDispatchWorkCenter {
    id: string;
    code: string;
    name: string;
    plant_id?: string;
    plant_code?: string;
    plant_name?: string;
    label?: string;
}

export interface RouteDispatchStepStatus {
    status: "CONFIGURED" | "AUTO_RESOLVABLE" | "PLANNER_REQUIRED" | "NEEDS_DECISION" | "NO_CAPABILITY" | "INVALID_ALLOWED_WORK_CENTERS" | "INVALID_DEFAULT_WORK_CENTER";
    candidate_count: number;
    filtered_candidate_count: number;
    candidates: RouteDispatchWorkCenter[];
    valid_candidates: RouteDispatchWorkCenter[];
    allowed_work_center_ids: string[];
    default_work_center: RouteDispatchWorkCenter | null;
    default_work_center_valid: boolean;
    selection_policy: "AUTO_IF_SINGLE" | "AUTO_DEFAULT" | "PLANNER_REQUIRED";
}

export interface RouteDispatchRow extends RouteDispatchStepStatus {
    step_id: string;
    template_id: string;
    template_name: string;
    template_status: TemplateBlueprint["status"];
    sequence_number: number;
    process_id: string;
    process_code: string;
    process_name: string;
    dispatch_notes?: string;
}

export interface RouteDispatchResponse {
    rows: RouteDispatchRow[];
    status_counts: Record<string, number>;
    process_counts: Record<string, number>;
    total: number;
    needs_decision: number;
}

export interface TemplateProcessStepRollHandlingRule {
    id: string;
    template_step: string;
    input_roll_count: number;
    combine_mode?: "STRICT_ROLL_COUNT" | "LANE_GROUPS";
    input_lane_count?: number;
    lamination_pass_index?: number;
    active_min_layer_count?: number;
    adhesive_split_pct?: number;
    solvent_split_pct?: number;
    lane_schema?: Array<Record<string, any>>;
    thickness_rule: "INHERIT_INPUT" | "SUM_INPUTS" | "FIXED" | "TEMPLATE_DEFAULT";
    width_rule: "LOCK_INPUT" | "MIN_INPUT" | "FIXED" | "OPERATOR" | "OPERATOR_GRID" | "TEMPLATE_DEFAULT";
    operator_entry_mode?: "PROCESS_DEFAULT" | "ROLL_SINGLE" | "ROLL_MULTI" | "GRID_SPLIT" | "DISCRETE_ONLY" | "KG_ONLY" | "KG_AND_PCS";
    notes?: string;
}

export interface TemplateMaterial {
    id: string;
    template_step: string;
    source_kind: "CATEGORY";
    category_code: string;
    material_name?: string | null;
    material_code?: string | null;
    material_category?: string | null;
    consumption_basis?: "SNAPSHOT_GSM" | "FIXED_KG" | "FIXED_PCS" | "CATEGORY_FORMULA" | "INVALID_LEGACY";
    formula_driver?: "NONE" | "ADDON_MASTER_WEIGHT_MODE" | "POD_MASTER_PROFILE";
    formula_params?: Record<string, any>;
    issue_policy_mode?: "NONE" | "PERCENT_OVER_THEORY" | "FIXED_EXTRA_KG" | "MINIMUM_ISSUE_KG";
    issue_policy_value?: number;
    capture_mode?: "AUTO_FROM_OUTPUT" | "AUTO_ESTIMATED_CONFIRM" | "OPERATOR_REQUIRED";
    value: number;
    quantity_mode: "KG" | "PCS" | "GSM" | "PERCENT" | "RECIPE";
    is_optional: boolean;
}

export interface TemplateRouteSyncPreview {
    steps_to_keep: Array<{
        step_id: string;
        from_sequence: number;
        to_sequence: number;
        process_name: string;
        process_code: string;
        will_reorder: boolean;
    }>;
    steps_to_create: Array<{
        target_sequence: number;
        process_name: string;
        process_code: string;
    }>;
    steps_to_mark_removed: Array<{
        step_id: string;
        sequence_number: number;
        process_name: string;
        process_code: string;
    }>;
}

export interface TemplateRouteStep {
    index: number;
    label?: string;
    process_code?: string;
    name?: string;
    input_form?: string;
    output_form?: string;
    roll_behavior?: string;
    notes?: string;
}

export interface TemplateSchemaHealth {
    healthy: boolean;
    message: string;
    detail?: string;
}

export interface TemplateApiErrorEnvelope {
    status: "error";
    message: string;
    detail?: string;
    field_errors?: Record<string, string[]>;
}

export const templateService = {
    getTemplates: async (params?: any, config?: AxiosRequestConfig) => {
        const { data } = await api.get<MaybePaginated<TemplateBlueprint>>("/api/templates/", { ...config, params });
        return unwrapList<TemplateBlueprint>(data);
    },
    getLiveTemplateOptions: async (params?: any) => {
        return templateService.getTemplates({ status: "LIVE", options: "1", ...(params || {}) }, { timeout: 30_000 });
    },
    getTemplate: async (id: string) => {
        const { data } = await api.get<TemplateBlueprint>(`/api/templates/${id}/`);
        return data;
    },
    getSchemaHealth: async () => {
        const { data } = await api.get<TemplateSchemaHealth>("/api/templates/schema-health/");
        return data;
    },
    createTemplate: async (data: Partial<TemplateBlueprint>) => {
        const { data: res } = await api.post<TemplateBlueprint>("/api/templates/", data);
        return res;
    },
    updateTemplate: async (id: string, data: Partial<TemplateBlueprint>) => {
        const { data: res } = await api.patch<TemplateBlueprint>(`/api/templates/${id}/`, data);
        return res;
    },
    approveTemplate: async (id: string) => {
        const { data } = await api.post(`/api/templates/${id}/approve/`);
        return data;
    },
    requestReview: async (id: string) => {
        const { data } = await api.post(`/api/templates/${id}/request-review/`);
        return data;
    },
    makeLive: async (id: string) => {
        const { data } = await api.post(`/api/templates/${id}/publish/`);
        return data;
    },
    retireTemplate: async (id: string) => {
        const { data } = await api.post(`/api/templates/${id}/retire/`);
        return data;
    },
    purgeDraftTemplates: async (apply = false) => {
        const { data } = await api.post<{
            status: string;
            scanned: number;
            deleted: number;
            disabled: number;
            delete_ids: string[];
            disabled_ids: string[];
            blocked_refs: Record<string, Record<string, number>>;
            selector_refs: Record<string, Record<string, number>>;
        }>("/api/templates/purge-drafts/", { apply });
        return data;
    },
    cloneTemplate: async (id: string) => {
        const { data } = await api.post<TemplateBlueprint>(`/api/templates/${id}/clone/`);
        return data;
    },
    editTemplateDraft: async (id: string, reason?: string) => {
        const { data } = await api.post<TemplateBlueprint>(`/api/templates/${id}/edit-draft/`, { reason: reason || "" });
        return data;
    },
    getReadiness: async (id: string) => {
        const { data } = await api.get<TemplateReadiness>(`/api/templates/${id}/readiness/`);
        return data;
    },
    getProcessSteps: async (templateId: string) => {
        const { data } = await api.get<MaybePaginated<TemplateProcessStep>>(`/api/templates/${templateId}/process-steps/`);
        return unwrapList<TemplateProcessStep>(data);
    },
    getRouteSteps: async (templateId: string) => {
        const { data } = await api.get<MaybePaginated<TemplateRouteStep>>(`/api/templates/${templateId}/route-steps/`);
        return unwrapList<TemplateRouteStep>(data);
    },
    getRouteDispatch: async (params?: { include_obsolete?: string; include_samples?: string; include_versions?: string }) => {
        const { data } = await api.get<RouteDispatchResponse>("/api/templates/route-dispatch/", { params });
        return data;
    },
    backfillRouteDispatch: async (apply = false) => {
        const { data } = await api.post<{ status: string; eligible: number; applied: number }>("/api/templates/route-dispatch/backfill/", { apply });
        return data;
    },
    updateStepDispatch: async (
        templateId: string,
        stepId: string,
        payload: {
            allowed_work_center_ids: string[];
            default_work_center?: string | null;
            work_center_selection_policy: "AUTO_IF_SINGLE" | "AUTO_DEFAULT" | "PLANNER_REQUIRED";
            dispatch_notes?: string;
        },
    ) => {
        const { data } = await api.patch<TemplateProcessStep>(`/api/templates/${templateId}/process-steps/${stepId}/dispatch/`, payload);
        return data;
    },
    previewWorkflowSync: async (templateId: string) => {
        const { data } = await api.post<TemplateRouteSyncPreview>(`/api/templates/${templateId}/sync-workflow-preview/`);
        return data;
    },
    applyWorkflowSync: async (templateId: string) => {
        const { data } = await api.post(`/api/templates/${templateId}/sync-workflow-apply/`);
        return data;
    },
    rebuildWorkflowFromRoute: async (templateId: string) => {
        const { data } = await api.post(`/api/templates/${templateId}/rebuild-from-route/`);
        return data;
    },
    addStepMaterial: async (templateId: string, stepId: string, materialData: any) => {
        const { data } = await api.post(`/api/templates/${templateId}/process-steps/${stepId}/materials/`, materialData);
        if (data && typeof data === "object" && (data as any).data) {
            return (data as any).data;
        }
        return data;
    },
    updateStepMaterial: async (templateId: string, stepId: string, materialId: string, materialData: any) => {
        const { data } = await api.put(`/api/templates/${templateId}/process-steps/${stepId}/materials/${materialId}/`, materialData);
        return data;
    },
    removeStepMaterial: async (templateId: string, stepId: string, materialId: string) => {
        const { data } = await api.delete(`/api/templates/${templateId}/process-steps/${stepId}/materials/${materialId}/`);
        return data;
    },
    getStepRollHandling: async (templateId: string, stepId: string) => {
        const { data } = await api.get<TemplateProcessStepRollHandlingRule>(`/api/templates/${templateId}/process-steps/${stepId}/roll-handling/`);
        return data;
    },
    updateStepRollHandling: async (templateId: string, stepId: string, payload: Partial<TemplateProcessStepRollHandlingRule>) => {
        const { data } = await api.patch<TemplateProcessStepRollHandlingRule>(`/api/templates/${templateId}/process-steps/${stepId}/roll-handling/`, payload);
        return data;
    },
    reorderProcessSteps: async (templateId: string, steps: Array<{ id: string; sequence_number: number }>) => {
        const { data } = await api.post<TemplateProcessStep[]>(`/api/templates/${templateId}/process-steps/reorder/`, { steps });
        return data;
    },
};
