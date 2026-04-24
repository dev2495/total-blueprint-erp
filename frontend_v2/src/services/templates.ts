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
    notes: string;
    is_removed_from_route?: boolean;
    materials: TemplateMaterial[];
    roll_handling?: TemplateProcessStepRollHandlingRule | null;
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
    operator_entry_mode?: "PROCESS_DEFAULT" | "ROLL_SINGLE" | "ROLL_MULTI" | "GRID_SPLIT" | "DISCRETE_ONLY";
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
    getTemplates: async (params?: any) => {
        const { data } = await api.get<MaybePaginated<TemplateBlueprint>>("/api/templates/", { params });
        return unwrapList<TemplateBlueprint>(data);
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
    cloneTemplate: async (id: string) => {
        const { data } = await api.post<TemplateBlueprint>(`/api/templates/${id}/clone/`);
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
