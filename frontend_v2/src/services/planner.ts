import { api } from "@/lib/api"
import { ProductionJob } from "./production"

type MaybePaginated<T> = T[] | { results?: T[] } | unknown

function unwrapList<T>(data: MaybePaginated<T>): T[] {
    if (Array.isArray(data)) return data
    if (data && typeof data === "object" && Array.isArray((data as any).results)) {
        return (data as any).results as T[]
    }
    return []
}

export interface SalesDemand {
    so_number: string;
    customer: string;
    template_id: string;
    template_name: string;
    ordered_qty: number;
    produced_qty: number;
    pending_qty: number;
    due_date: string;
    so_item_id: string;
    material_status?: string;
}

export interface StockSummary {
    template__id: string;
    template__name: string;
    completed_step_index: number;
    total_weight: number;
    roll_count: number;
}

export interface WCCapacity {
    wc_id: string;
    wc_name: string;
    machine_count: number;
    running_jobs: number;
    free_slots: number;
    utilization: number;
    pending_load_hours?: number;
}

export interface RouteStep {
    index: number;
    label?: string;
    process_code?: string;
    name: string;
    input_form?: string;
    output_form: string;
    roll_behavior?: string;
    notes?: string;
}

export type PlannerOrderKind = 'sales' | 'stock'

export interface GeometryOverridePayload {
    width_mm?: number;
    height_mm?: number;
    gusset_mm?: number;
    adjustments?: Array<{
        name: string;
        value: number;
        impact: 'WIDTH' | 'HEIGHT' | 'BOTH';
    }>;
}

export interface PlannerInventoryOption {
    inventory_type: 'ROLL' | 'FG_BATCH';
    inventory_id: string;
    label: string;
    completed_step_index: number;
    quantity_kg: number;
    allocated_qty_kg: number;
    allocatable_qty_kg: number;
    is_final_step: boolean;
    stock_strategy?: 'FINAL_STOCK' | 'INTERMEDIATE_POOL' | 'PACKAGING_STOCK' | string;
    signature_match_mode?: 'FINAL_SPEC' | 'SEMI_INVARIANT' | 'STEP0_RAW' | string;
}

export interface PlannerStockOrderMatch {
    order_id: string;
    order_number: string;
    status: string;
    start_step_index: number;
    stop_step_index: number;
    remaining_qty_kg: number;
    produced_qty_kg: number;
    stock_strategy?: 'FINAL_STOCK' | 'INTERMEDIATE_POOL' | 'PACKAGING_STOCK' | string;
}

export interface PlannerControlOrder {
    order_kind: PlannerOrderKind;
    order_id: string;
    sales_order_item_id?: string | null;
    order_number: string;
    status: string;
    template_id: string;
    template_name: string;
    fg_type?: string;
    final_product_type?: string | null;
    planned_output_type?: string | null;
    stock_strategy?: 'FINAL_STOCK' | 'INTERMEDIATE_POOL' | 'PACKAGING_STOCK' | string;
    required_qty_kg: number;
    required_qty_pcs?: number;
    qty_uom?: string;
    math_valid?: boolean;
    math_error?: string;
    required_start_step: number;
    route_last_step_index: number;
    geometry_override: GeometryOverridePayload;
    spec_signature?: string;
    effective_dims?: { width_mm: number; height_mm: number };
    roll_invariants?: {
        width_mm?: number | null;
        thickness_micron?: number | null;
        density_gcm3?: number | null;
        derived_area_m2?: number | null;
        derived_length_m?: number | null;
    };
    material_plan_lines?: Array<{
        policy_key: string;
        category_code: string;
        material_id?: string | null;
        material_code?: string | null;
        material_name: string;
        uom: string;
        consumption_basis?: string;
        formula_driver?: string;
        formula_params?: Record<string, any>;
        capture_mode?: string;
        theoretical_qty: number;
        planned_issue_qty: number;
        template_issue_policy_mode: string;
        template_issue_policy_value: number;
        override_issue_policy_mode?: string | null;
        override_issue_policy_value?: number | null;
        effective_issue_policy_mode: string;
        effective_issue_policy_value: number;
        policy_source: string;
        step_id?: string | null;
        step_sequence?: number | null;
        step_name?: string | null;
    }>;
    material_plan_summary?: {
        line_count: number;
        override_count: number;
        default_count: number;
        theoretical_total_qty: number;
        planned_issue_total_qty: number;
        uom: string;
    };
    inventory_options?: PlannerInventoryOption[];
    matching_stock_orders?: PlannerStockOrderMatch[];
    artwork_assignment_required?: boolean;
    assigned_artwork_id?: string;
    pending_artwork_items?: Array<{
        id: string;
        label: string;
        line_name?: string;
        print_type?: string;
        front_colors_count?: number;
        back_colors_count?: number;
        artwork_id?: string | null;
    }>;
    printing_enabled?: boolean;
    print_type?: string;
    front_colors_count?: number;
    back_colors_count?: number;
    partial_replan_required?: boolean;
    partial_shortfall_kg?: number;
    partial_shortfall_pct?: number;
    partial_produced_kg?: number;
    partial_target_kg?: number;
    job_count?: number;
    jobs_released?: number;
    jobs_completed?: number;
    created_at?: string;
    row_error?: string;
    row_error_detail?: string;
    row_recoverable?: boolean;
    inventory_options_error?: string;
    blockers?: Array<{
        code: string;
        message: string;
        severity: "LOW" | "MEDIUM" | "HIGH" | string;
        resolvable: boolean;
    }>;
    customer_name?: string;
    display_name?: string;
    delivery_date?: string | null;
    source_availability?: {
        fg_match_count: number;
        wip_match_count: number;
        has_fg: boolean;
        has_wip: boolean;
    };
    source_summary?: {
        fg_match_count: number;
        wip_match_count: number;
        matching_stock_order_count: number;
        recommended_option: "FG" | "WIP_CONTINUE" | "FRESH" | string;
        recommended_label: string;
    };
    summary?: {
        required_qty_kg: number;
        allocatable_qty_kg: number;
        coverage_pct: number;
        theoretical_total_qty: number;
        planned_issue_total_qty: number;
        override_count: number;
        line_count: number;
    };
    workspace?: {
        route_span?: {
            required_start_step: number;
            route_last_step_index: number;
        };
        material_plan_lines: PlannerControlOrder["material_plan_lines"];
        material_plan_summary: PlannerControlOrder["material_plan_summary"];
        inventory_options: PlannerControlOrder["inventory_options"];
        matching_stock_orders: PlannerControlOrder["matching_stock_orders"];
        source_availability?: PlannerControlOrder["source_availability"];
    };
    artwork_gate?: {
        active: boolean;
        message: string;
        pending_count: number;
        selected_item?: {
            id: string;
            label: string;
            line_name?: string;
            template_name?: string;
            print_type?: string;
            front_colors_count?: number;
            back_colors_count?: number;
            artwork_id?: string | null;
        };
        items: NonNullable<PlannerControlOrder["pending_artwork_items"]>;
        print_type?: string;
        front_colors_count?: number;
        back_colors_count?: number;
    };
    release_checklist?: {
        release_ready: boolean;
        blocked_count: number;
        items: Array<{
            code: string;
            label: string;
            status: "READY" | "ATTENTION" | "BLOCKED" | string;
            message: string;
        }>;
    };
    action_recommendation?: {
        key: string;
        label: string;
        description: string;
        tone: "critical" | "warning" | "info" | string;
    };
    order_fact_sheet?: {
        order_number: string;
        order_kind: string;
        customer_name?: string;
        display_name?: string;
        delivery_date?: string | null;
        template_name: string;
        status: string;
        fg_type?: string;
        planned_output_type?: string;
        required_qty_kg: number;
        required_qty_pcs?: number | null;
        qty_uom?: string;
        print_type?: string;
        front_colors_count?: number;
        back_colors_count?: number;
        partial_shortfall_kg?: number;
        partial_replan_required?: boolean;
        release_risk?: "LOW" | "MEDIUM" | "HIGH" | string;
        stock_strategy?: 'FINAL_STOCK' | 'INTERMEDIATE_POOL' | 'PACKAGING_STOCK' | string;
        repeat_confidence?: {
            level: "FRESH" | "REPEAT_READY" | "REVIEW_REQUIRED" | string;
            inherited: string[];
            review_flags: string[];
        };
    };
}

export interface ControlHubResponse {
    orders: PlannerControlOrder[];
    active_orders: PlannerControlOrder[];
    order_history: PlannerControlOrder[];
    kpis?: {
        planning_queue_count: number;
        ready_released_count: number;
        history_count: number;
        queue_blocked_count: number;
        queue_recoverable_rows: number;
        queue_required_qty_kg: number;
        queue_allocatable_qty_kg: number;
    };
}

export interface PlannerAllocationPayload {
    inventory_type: 'ROLL' | 'FG_BATCH';
    inventory_id: string;
    allocated_qty_kg: number;
}

export interface PlanOrderPayload {
    option: 'FG' | 'WIP_CONTINUE' | 'FRESH';
    start_step_index?: number;
    stop_step_index?: number;
    allocations?: PlannerAllocationPayload[];
}

export interface AssignArtworkPayload {
    artwork_id: string;
    item_id?: string;
}

export interface ShortClosePayload {
    reason: string;
}

export interface CloneOrderPayload {
    order_kind: PlannerOrderKind;
    order_id: string;
    name?: string;
}

export interface CreateStockOrderPayload {
    template_id: string;
    name?: string;
    quantity: number;
    quantity_uom: 'KG' | 'PCS' | 'METER';
    stock_purpose?: 'PRODUCT' | 'PACKAGING';
    stock_strategy?: 'FINAL_STOCK' | 'INTERMEDIATE_POOL' | 'PACKAGING_STOCK';
    packaging_material_id?: string;
    roll_form?: 'FLAT' | 'FOLDED' | 'TUBING';
    geometry_override?: GeometryOverridePayload;
    geometry: any;
    film_layers: any[];
    printing: any;
    addons: any[];
    packaging_snapshot?: any;
    start_step_index: number;
    stop_step_index?: number;
    preferred_plant_id?: string;
}

export interface ClaimCandidate {
    inventory_type: 'ROLL' | 'FG_BATCH';
    inventory_id: string;
    label: string;
    source_stock_order_id: string | null;
    source_stock_order_no: string | null;
    current_qty_kg: number;
    already_claimed_qty_kg: number;
    claimable_qty_kg: number;
    requires_split_for_partial: boolean;
}

export interface ClaimCandidatesResponse {
    sales_order_item_id: string;
    spec_signature: string;
    invariant_signature: string;
    remaining_qty_kg?: number;
    candidates: ClaimCandidate[];
}

export interface ClaimStockPayload {
    inventory_type: 'ROLL' | 'FG_BATCH';
    inventory_id: string;
    claim_qty_kg: number;
}

export const plannerService = {
    getDemand: async () => {
        const { data } = await api.get<MaybePaginated<SalesDemand>>('/api/production/planner/demand/');
        return unwrapList<SalesDemand>(data);
    },

    getStock: async () => {
        const { data } = await api.get<MaybePaginated<StockSummary>>('/api/production/planner/stock/');
        return unwrapList<StockSummary>(data);
    },

    getCapacity: async () => {
        const { data } = await api.get<MaybePaginated<WCCapacity>>('/api/production/planner/capacity/');
        return unwrapList<WCCapacity>(data);
    },

    getJobs: async () => {
        const { data } = await api.get<MaybePaginated<ProductionJob>>('/api/production/planner/jobs/');
        return unwrapList<ProductionJob>(data);
    },

    releaseJob: async (jobId: string) => {
        const { data } = await api.post(`/api/production/planner/${jobId}/release/`);
        return data;
    },

    holdJob: async (jobId: string, reason?: string) => {
        const { data } = await api.post(`/api/production/planner/${jobId}/hold/`, { reason });
        return data;
    },

    splitJob: async (jobId: string, qty: number) => {
        const { data } = await api.post(`/api/production/planner/${jobId}/split/`, { qty });
        return data;
    },

    reprioritizeJob: async (jobId: string, priority: number) => {
        const { data } = await api.post(`/api/production/planner/${jobId}/reprioritize/`, { priority });
        return data;
    },

    getRouteSteps: async (templateId: string) => {
        const { data } = await api.get<RouteStep[]>(`/api/templates/${templateId}/route-steps/`);
        if (Array.isArray(data)) {
            return data;
        }
        throw new Error("Route steps response was malformed.");
    },

    createStockOrder: async (payload: CreateStockOrderPayload) => {
        const { data } = await api.post('/api/production/planner/create-stock-order/', payload);
        return data;
    },

    cloneOrderToStock: async (payload: CloneOrderPayload) => {
        const { data } = await api.post('/api/production/planner/control-hub/clone/', payload);
        return data;
    },

    getControlHub: async (): Promise<ControlHubResponse> => {
        const { data } = await api.get<ControlHubResponse>('/api/production/planner/control-hub/');
        if (!data || typeof data !== "object" || Array.isArray(data)) {
            throw new Error("Invalid planner control-hub response payload")
        }
        const payload: any = data
        if (String(payload.status || "").toLowerCase() === "error") {
            throw new Error(String(payload.detail || payload.message || "Planner control-hub request failed"))
        }
        return {
            orders: Array.isArray(payload.orders) ? payload.orders : [],
            active_orders: Array.isArray(payload.active_orders) ? payload.active_orders : [],
            order_history: Array.isArray(payload.order_history) ? payload.order_history : [],
            kpis: payload.kpis && typeof payload.kpis === "object" ? payload.kpis : undefined,
        };
    },

    planOrder: async (orderKind: PlannerOrderKind, orderId: string, payload: PlanOrderPayload) => {
        const { data } = await api.post(`/api/production/planner/control-hub/${orderKind}/${orderId}/plan/`, payload);
        return data;
    },

    releasePlannedOrder: async (orderKind: PlannerOrderKind, orderId: string) => {
        const { data } = await api.post(`/api/production/planner/control-hub/${orderKind}/${orderId}/release/`);
        return data;
    },

    assignArtworkToOrder: async (orderKind: PlannerOrderKind, orderId: string, payload: AssignArtworkPayload) => {
        const { data } = await api.post(`/api/production/planner/control-hub/${orderKind}/${orderId}/assign-artwork/`, payload);
        return data;
    },

    shortCloseOrder: async (orderKind: PlannerOrderKind, orderId: string, payload: ShortClosePayload) => {
        const { data } = await api.post(`/api/production/planner/control-hub/${orderKind}/${orderId}/short-close/`, payload);
        return data;
    },

    getClaimCandidates: async (salesOrderItemId: string) => {
        const { data } = await api.get<ClaimCandidatesResponse>(`/api/production/planner/control-hub/sales-items/${salesOrderItemId}/claim-candidates/`);
        return {
            sales_order_item_id: String((data as any)?.sales_order_item_id || salesOrderItemId),
            spec_signature: String((data as any)?.spec_signature || ""),
            invariant_signature: String((data as any)?.invariant_signature || ""),
            remaining_qty_kg: Number((data as any)?.remaining_qty_kg || 0),
            candidates: Array.isArray((data as any)?.candidates) ? (data as any).candidates : [],
        } as ClaimCandidatesResponse
    },

    claimStockToSales: async (salesOrderItemId: string, payload: ClaimStockPayload) => {
        const { data } = await api.post(`/api/production/planner/control-hub/sales-items/${salesOrderItemId}/claim-stock/`, payload);
        return data;
    },
}
