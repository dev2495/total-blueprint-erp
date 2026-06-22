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
    display_name?: string;
    family_display_name?: string;
    size_line?: string;
    process_state_label?: string;
    completed_step_index: number;
    quantity_kg: number;
    allocated_qty_kg: number;
    allocatable_qty_kg: number;
    is_final_step: boolean;
    stock_strategy?: 'FINAL_STOCK' | 'INTERMEDIATE_POOL' | 'PACKAGING_STOCK' | string;
    signature_match_mode?: 'FINAL_SPEC' | 'SEMI_INVARIANT' | 'PRE_ARTWORK_INVARIANT' | 'STEP0_RAW' | string;
    source_bucket?: 'FINISHED_STOCK' | 'CARRY_FORWARD_WIP' | 'SHARED_INVARIANT_ROLL_STOCK' | 'COMPATIBLE_UPSTREAM_ROLL_STOCK' | string;
    source_label?: string;
    location_id?: string | null;
    location_code?: string;
    location_name?: string;
    plant_id?: string;
    plant_code?: string;
    plant_name?: string;
    required_width_mm?: number | null;
    stock_width_mm?: number | null;
    width_match_mode?: 'EXACT_WIDTH' | 'WIDER_SLITTABLE' | 'CAN_SLIT' | 'WIDTH_NOT_REQUIRED' | 'TOO_NARROW' | string;
    can_slit_to_required_width?: boolean;
}

export type PlannerSourceOption =
    | 'FG'
    | 'WIP_CONTINUE'
    | 'SHARED_INVARIANT'
    | 'UPSTREAM_STOCK'
    | 'POD_BULK'
    | 'PACKAGING_STOCK'
    | 'FRESH';

export interface PlannerStockOrderMatch {
    order_id: string;
    order_number: string;
    status: string;
    start_step_index: number;
    stop_step_index: number;
    remaining_qty_kg: number;
    produced_qty_kg: number;
    planner_stock_class?: string;
    match_mode?: string;
    stock_strategy?: 'FINAL_STOCK' | 'INTERMEDIATE_POOL' | 'PACKAGING_STOCK' | string;
}

export interface PlannerContinuationCandidate {
    candidate_type: "INVENTORY" | "STOCK_ORDER" | string;
    candidate_kind: "inventory" | "stock_order" | string;
    inventory_type?: string;
    inventory_id?: string;
    label?: string;
    display_name?: string;
    planner_stock_class?: string;
    stock_strategy?: string;
    source_bucket?: string;
    source_label?: string;
    completed_step_index?: number;
    allocatable_qty_kg?: number;
    candidate_label?: string;
    reason_label?: string;
    resume_action_allowed?: boolean;
    claim_action_allowed?: boolean;
    recommended_action?: string;
    route_span_label?: string;
    order_id?: string;
    order_number?: string;
    start_step_index?: number;
    stop_step_index?: number;
    remaining_qty_kg?: number;
    produced_qty_kg?: number;
    match_mode?: string;
}

export interface PlannerContinuationSummary {
    recommended_mode: string;
    recommended_label: string;
    recommended_reason: string;
    exact_fg_count: number;
    exact_stock_route_count: number;
    carry_forward_wip_count: number;
    shared_invariant_count: number;
    upstream_route_count: number;
    exact_fg_candidates: PlannerContinuationCandidate[];
    exact_stock_route_candidates: PlannerContinuationCandidate[];
    carry_forward_wip_candidates: PlannerContinuationCandidate[];
    shared_invariant_candidates: PlannerContinuationCandidate[];
    stopped_invariant_route_candidates: PlannerContinuationCandidate[];
    upstream_candidates: PlannerContinuationCandidate[];
    stopped_upstream_route_candidates: PlannerContinuationCandidate[];
}

export interface PlannerRouteDispatchWorkCenter {
    id: string;
    code: string;
    name: string;
    plant_id?: string;
    plant_code?: string;
    plant_name?: string;
    label?: string;
}

export interface PlannerRouteDispatchStatus {
    status: string;
    candidate_count: number;
    filtered_candidate_count: number;
    candidates: PlannerRouteDispatchWorkCenter[];
    valid_candidates: PlannerRouteDispatchWorkCenter[];
    allowed_work_center_ids: string[];
    default_work_center: PlannerRouteDispatchWorkCenter | null;
    default_work_center_valid: boolean;
    selection_policy: "AUTO_IF_SINGLE" | "AUTO_DEFAULT" | "PLANNER_REQUIRED" | string;
}

export interface PlannerControlOrder {
    order_kind: PlannerOrderKind;
    order_id: string;
    sales_order_item_id?: string | null;
    sales_order_line_index?: number;
    line_label?: string;
    line_status?: string;
    line_status_display?: string;
    line_status_reason?: string;
    qty_open?: number;
    qty_final_output?: number;
    qty_dispatchable?: number;
    qty_replan_remaining?: number;
    qty_replan_remaining_kg?: number;
    qty_cancelled?: number;
    qty_short_closed?: number;
    qty_dispatched?: number;
    parent_status?: string;
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
    unit_weight_g?: number | null;
    qty_uom?: string;
    math_valid?: boolean;
    math_error?: string;
    required_start_step: number;
    route_last_step_index: number;
    required_roll_width_mm?: number | null;
    geometry_override: GeometryOverridePayload;
    geometry_snapshot?: any;
    spec_signature?: string;
    effective_dims?: { width_mm: number; height_mm: number };
    roll_invariants?: {
        width_mm?: number | null;
        thickness_micron?: number | null;
        density_gcm3?: number | null;
        derived_area_m2?: number | null;
        derived_length_m?: number | null;
    };
    layer_snapshot?: any[];
    layer_summary?: any[];
    printing_snapshot?: any;
    addons_snapshot?: any[];
    packaging_snapshot?: any;
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
        product_master_id?: string | null;
        product_master_code?: string | null;
        axis_values?: Record<string, any>;
        print_type?: string;
        substrate_mode?: string;
        ink_base_family?: string;
        front_colors_count?: number;
        back_colors_count?: number;
        artwork_id?: string | null;
    }>;
    printing_enabled?: boolean;
    print_type?: string;
    substrate_mode?: string;
    ink_base_family?: string;
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
    completed_at?: string | null;
    job_numbers?: string[];
    completed_jobs?: Array<{
        id: string;
        job_number: string;
        step_label: string;
        process_code?: string;
        input_form?: string;
        output_form?: string;
        planned_qty: number;
        produced_qty: number;
        remaining_qty: number;
        scrap_qty: number;
        uom: string;
        work_center_name?: string;
        machine_name?: string;
        operator_name?: string;
        closed_by_name?: string;
        closed_at?: string | null;
    }>;
    display_qty_kg?: string;
    display_qty_pcs?: string;
    display_geometry_label?: string;
    display_layers?: string[];
    display_printing_label?: string;
    display_addons_label?: string;
    display_packaging_label?: string;
    display_route_summary?: string;
    display_material_summary?: string;
    display_action_label?: string;
    display_action_help?: string;
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
        carry_forward_wip_count?: number;
        shared_invariant_roll_count?: number;
        compatible_upstream_roll_match_count?: number;
        fresh_raw_input_count?: number;
        has_fg: boolean;
        has_wip: boolean;
        has_carry_forward_wip?: boolean;
        has_shared_invariant_roll_stock?: boolean;
        has_compatible_upstream_roll?: boolean;
        has_fresh_raw_input?: boolean;
        pod_bulk_material_count?: number;
        packaging_stock_material_count?: number;
    };
    source_summary?: {
        fg_match_count: number;
        wip_match_count: number;
        matching_stock_order_count: number;
        recommended_option: "FG" | "WIP_CONTINUE" | "FRESH" | string;
        recommended_label: string;
    };
    continuation?: PlannerContinuationSummary;
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
            substrate_mode?: string;
            ink_base_family?: string;
            front_colors_count?: number;
            back_colors_count?: number;
            artwork_id?: string | null;
        };
        items: NonNullable<PlannerControlOrder["pending_artwork_items"]>;
        print_type?: string;
        substrate_mode?: string;
        ink_base_family?: string;
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
        pod_label?: string;
        partial_shortfall_kg?: number;
        partial_replan_required?: boolean;
        release_risk?: "LOW" | "MEDIUM" | "HIGH" | string;
        stock_strategy?: 'FINAL_STOCK' | 'INTERMEDIATE_POOL' | 'PACKAGING_STOCK' | string;
        repeat_confidence?: {
            level: "FRESH" | "REPEAT_READY" | "REVIEW_REQUIRED" | string;
            inherited: string[];
            review_flags: string[];
        };
        // Backend serializer also returns these labels — used by Control Tower v2:
        profile_kind?: string;
        profile_label?: string;
        roll_form?: string | null;
        print_profile_label?: string;
        geometry_label?: string;
        route_span_label?: string;
        has_started_final_output?: boolean;
    };
    template_steps?: Array<{
        sequence_number: number;
        display_sequence?: number;
        process_code: string;
        process_name: string;
        step_name?: string;
        input_form?: string;
        output_form?: string;
        dispatch_status?: PlannerRouteDispatchStatus | null;
    }>;
}

export interface ControlHubResponse {
    orders: PlannerControlOrder[];
    active_orders: PlannerControlOrder[];
    order_history: PlannerControlOrder[];
    detail_order?: PlannerControlOrder | null;
    summary?: boolean;
    kpis?: {
        planning_queue_count: number;
        ready_released_count: number;
        history_count: number;
        history_offset?: number;
        history_limit?: number;
        history_next_offset?: number;
        history_has_more?: boolean;
        queue_blocked_count: number;
        queue_recoverable_rows: number;
        queue_required_qty_kg: number;
        queue_allocatable_qty_kg: number;
    };
}

export interface PlannerLiveSummary {
    generated_at?: string;
    state_counts: Record<string, number>;
    kpis: {
        executing_count: number;
        released_count: number;
        waiting_count: number;
        paused_count: number;
        planned_count: number;
        total_in_flight: number;
        active_kg: number;
        closed_24h: number;
        variance_count: number;
    };
    source_mix: Array<{
        source_type: string;
        origin: string;
        count: number;
        quantity: number;
        produced: number;
    }>;
}

export interface PlannerControlHubParams {
    summary?: boolean;
    planning_limit?: number;
    active_limit?: number;
    history_limit?: number;
    history_offset?: number;
    history_job_limit?: number;
    scan_limit?: number;
    history_days?: number | null;
    history_query?: string;
    history_source?: "ALL" | "FG" | "WIP" | "FRESH" | string;
    history_order_kind?: "ALL" | "SALES" | "STOCK" | string;
    detail_order_kind?: "sales" | "stock" | string;
    detail_order_id?: string;
    detail_sales_order_item_id?: string;
    queue_search?: string;
    queue_customer?: string;
    queue_template?: string;
    queue_fg_type?: string;
    queue_material?: string;
    queue_source_path?: string;
    queue_release?: string;
    queue_age?: string;
    queue_print?: string;
    queue_lifecycle?: string;
    queue_min_width?: string;
    queue_max_width?: string;
    queue_overdue_only?: boolean;
    timeout_ms?: number;
}

export interface PlannerJobsParams {
    summary?: boolean;
    limit?: number;
    states?: string[] | string;
    timeout_ms?: number;
}

export interface PlannerLiveSummaryParams {
    limit?: number;
    timeout_ms?: number;
}

export type CompletedTraceJob = Partial<PlannerControlOrder> & {
    id?: string;
    job_id?: string;
    job_number?: string;
    planned_qty?: number;
    produced_qty?: number;
    remaining_qty?: number;
    scrap_qty?: number;
    uom?: string;
    step_label?: string;
    process_code?: string;
    work_center_name?: string;
    machine_name?: string;
    operator_name?: string;
    closed_by_name?: string;
    closed_at?: string | null;
};

export interface CompletedTraceParams {
    days?: number;
    limit?: number;
    offset?: number;
    q?: string;
    source?: "ALL" | "FG" | "WIP" | "FRESH" | string;
    customer?: string;
    order_kind?: "ALL" | "SALES" | "STOCK" | string;
    timeout_ms?: number;
}

export interface CompletedTraceResponse {
    results: CompletedTraceJob[];
    count: number;
    limit: number;
    offset: number;
    next_offset: number;
    has_more: boolean;
    kpis?: {
        completed_jobs: number;
        completed_orders: number;
        planned_qty: number;
        produced_qty: number;
        remaining_qty: number;
        variance_qty: number;
        variance_jobs: number;
        in_flight_jobs: number;
        days: number;
    };
}

export interface PlannerAllocationPayload {
    inventory_type: 'ROLL' | 'FG_BATCH';
    inventory_id: string;
    allocated_qty_kg: number;
    source_bucket?: string;
    signature_match_mode?: string;
}

export interface PlannerWorkCenterOverridePayload {
    step_index: number;
    work_center_id: string;
}

export interface PlanOrderPayload {
    option: PlannerSourceOption;
    item_id?: string;
    start_step_index?: number;
    stop_step_index?: number;
    allocations?: PlannerAllocationPayload[];
    work_center_overrides?: PlannerWorkCenterOverridePayload[];
    plan_remaining_fresh_now?: boolean;
}

export interface AssignArtworkPayload {
    artwork_id: string;
    item_id?: string;
}

export interface ShortClosePayload {
    reason: string;
    item_id?: string;
}

export interface CancelLinePayload {
    reason: string;
    item_id?: string;
}

export interface CloneOrderPayload {
    order_kind: PlannerOrderKind;
    order_id: string;
    name?: string;
}

export interface CreateStockOrderPayload {
    template_id?: string;
    product_master?: string | null;
    axis_values?: Record<string, any>;
    commitment_scope?: 'GENERIC' | 'CUSTOMER' | 'ARTWORK' | 'CUSTOMER_ARTWORK';
    committed_customer?: string | null;
    committed_artwork?: string | null;
    planner_sku_variant_id?: string;
    sales_sku_variant_id?: string;
    launcher_mode?: 'FINAL_ROLL' | 'SHARED_INVARIANT_ROLL' | 'BASE_UPSTREAM_ROLL' | 'POD_STOCK' | 'PACKAGING_STOCK';
    pod_sku_variant_id?: string;
    name?: string;
    quantity: number;
    quantity_uom: 'KG' | 'PCS' | 'METER';
    stock_purpose?: 'PRODUCT' | 'PACKAGING';
    stock_strategy?: 'FINAL_STOCK' | 'INTERMEDIATE_POOL' | 'PACKAGING_STOCK';
    packaging_material_id?: string;
    roll_form?: 'FLAT' | 'FOLDED' | 'TUBING';
    geometry_override?: GeometryOverridePayload;
    geometry?: any;
    film_layers?: any[];
    printing: any;
    addons: any[];
    packaging_snapshot?: any;
    start_step_index: number;
    stop_step_index?: number;
    preferred_plant_id?: string;
}

export interface ValidateStockPoolPayload {
    template_id?: string;
    product_master?: string | null;
    commitment_scope?: 'GENERIC' | 'CUSTOMER' | 'ARTWORK' | 'CUSTOMER_ARTWORK';
    committed_customer?: string | null;
    committed_artwork?: string | null;
    stop_step_index?: number;
}

export interface ValidateStockPoolResult {
    valid: boolean;
    first_artwork_step_index?: number | null;
    route_last_step_index?: number;
    message?: string;
    error?: any;
    detail?: any;
}

export interface CreateStockOrdersBulkResponse {
    created: any[];
    failed: Array<{ index: number; error: string | Record<string, unknown> }>;
}

export interface PlannerSkuVariantPreset {
    id: string;
    sku: string;
    sku_code?: string;
    sku_name?: string;
    code: string;
    name: string;
    active: boolean;
    launch_kind: 'FINAL_ROLL' | 'SHARED_INVARIANT_ROLL' | 'BASE_UPSTREAM_ROLL' | 'POD_STOCK' | 'PACKAGING_STOCK';
    template?: string | null;
    template_name?: string;
    product_master?: string | null;
    product_master_name?: string | null;
    product_master_code?: string | null;
    commitment_scope?: 'GENERIC' | 'CUSTOMER' | 'ARTWORK' | 'CUSTOMER_ARTWORK';
    committed_customer?: string | null;
    committed_customer_name?: string | null;
    committed_artwork?: string | null;
    committed_artwork_design_code?: string | null;
    default_plant?: string | null;
    default_plant_name?: string;
    default_qty: number;
    quantity_uom: 'KG' | 'PCS' | 'METER';
    stock_purpose: 'PRODUCT' | 'PACKAGING';
    stock_strategy: 'FINAL_STOCK' | 'INTERMEDIATE_POOL' | 'PACKAGING_STOCK' | string;
    planner_stock_class: 'FINAL_PRODUCT' | 'FINAL_PLAIN_ROLL' | 'EXTRUDED_BASE_ROLL' | 'SHARED_INVARIANT_ROLL' | 'PACKAGING_STOCK' | string;
    start_step_index: number;
    stop_step_index?: number | null;
    geometry_snapshot: any;
    layer_snapshot: any[];
    printing_snapshot: any;
    addons_snapshot: any[];
    packaging_snapshot: any;
    packaging_material?: string | null;
    packaging_material_name?: string;
    pod_sku_variant?: string | null;
    pod_sku_variant_name?: string;
    spec_signature?: string;
    invariant_signature?: string;
    planner_origin_meta?: Record<string, any>;
}

export interface PlannerSkuPreset {
    id: string;
    code: string;
    name: string;
    template: string;
    template_name?: string;
    product_master?: string | null;
    product_master_name?: string | null;
    product_master_code?: string | null;
    default_plant?: string | null;
    default_plant_name?: string;
    active: boolean;
    notes?: string;
    variants: PlannerSkuVariantPreset[];
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

export interface GangCandidateJob {
    job_id: string;
    job_number: string;
    job_state: string;
    quantity: number;
    remaining_qty: number;
    uom: string;
    target_width_mm: number;
    process_name: string;
    process_code: string;
    step_index: number;
    template_name: string;
    sales_order_number: string;
    customer_name: string;
    origin: string;
    is_generic_stock: boolean;
}

export interface GangCandidateGroup {
    group_key: string;
    layer_signature_hash: string;
    step_index: number;
    process_code: string;
    jobs: GangCandidateJob[];
    job_count: number;
    total_qty_kg: number;
    eligible_for_ganging: boolean;
}

export const plannerService = {
    getDemand: async () => {
        const { data } = await api.get<MaybePaginated<SalesDemand>>('/api/production/planner/demand/');
        return unwrapList<SalesDemand>(data);
    },

    getGangCandidates: async (params?: { limit?: number; scan_limit?: number }) => {
        const { data } = await api.get<{ groups: GangCandidateGroup[]; total_groups: number }>(
            '/api/production/planner/gang-candidates/',
            {
                params: {
                    limit: params?.limit ?? 60,
                    scan_limit: params?.scan_limit ?? 160,
                },
                timeout: 15000,
            }
        );
        return data;
    },

    commitGang: async (layerSig: string, jobIds: string[]) => {
        const { data } = await api.post<{ gang_group_id: string; affected_jobs: number }>(
            '/api/production/planner/commit-gang/',
            { layer_signature_hash: layerSig, job_ids: jobIds }
        );
        return data;
    },

    getStock: async () => {
        const { data } = await api.get<MaybePaginated<StockSummary>>('/api/production/planner/stock/');
        return unwrapList<StockSummary>(data);
    },

    getCapacity: async () => {
        const { data } = await api.get<MaybePaginated<WCCapacity>>('/api/production/planner/capacity/');
        return unwrapList<WCCapacity>(data);
    },

    getJobs: async (params?: PlannerJobsParams): Promise<ProductionJob[]> => {
        const states = Array.isArray(params?.states) ? params.states.join(",") : params?.states;
        const { data } = await api.get<MaybePaginated<ProductionJob>>('/api/production/planner/jobs/', {
            params: {
                summary: (params?.summary ?? true) ? 1 : 0,
                limit: params?.limit ?? 160,
                states: states || undefined,
            },
            timeout: params?.timeout_ms ?? 15000,
        });
        return unwrapList<ProductionJob>(data);
    },

    getLiveProductionSummary: async (params?: PlannerLiveSummaryParams): Promise<PlannerLiveSummary> => {
        const { data } = await api.get<PlannerLiveSummary>('/api/production/planner/live-summary/', {
            params: {
                limit: params?.limit ?? 160,
            },
            timeout: params?.timeout_ms ?? 12000,
        });
        const payload: any = data;
        return {
            generated_at: typeof payload?.generated_at === "string" ? payload.generated_at : undefined,
            state_counts: payload?.state_counts && typeof payload.state_counts === "object" ? payload.state_counts : {},
            kpis: {
                executing_count: Number(payload?.kpis?.executing_count || 0),
                released_count: Number(payload?.kpis?.released_count || 0),
                waiting_count: Number(payload?.kpis?.waiting_count || 0),
                paused_count: Number(payload?.kpis?.paused_count || 0),
                planned_count: Number(payload?.kpis?.planned_count || 0),
                total_in_flight: Number(payload?.kpis?.total_in_flight || 0),
                active_kg: Number(payload?.kpis?.active_kg || 0),
                closed_24h: Number(payload?.kpis?.closed_24h || 0),
                variance_count: Number(payload?.kpis?.variance_count || 0),
            },
            source_mix: Array.isArray(payload?.source_mix) ? payload.source_mix : [],
        };
    },

    getCompletedJobTrace: async (params?: CompletedTraceParams): Promise<CompletedTraceResponse> => {
        const { data } = await api.get<CompletedTraceResponse>('/api/production/planner/completed-job-trace/', {
            params: {
                days: params?.days ?? 90,
                limit: params?.limit ?? 40,
                offset: params?.offset ?? 0,
                q: params?.q || undefined,
                source: params?.source || undefined,
                customer: params?.customer || undefined,
                order_kind: params?.order_kind || undefined,
            },
            timeout: params?.timeout_ms ?? 20000,
        });
        const payload: any = data;
        return {
            results: Array.isArray(payload?.results) ? payload.results : [],
            count: Number(payload?.count || 0),
            limit: Number(payload?.limit || params?.limit || 40),
            offset: Number(payload?.offset || params?.offset || 0),
            next_offset: Number(payload?.next_offset || 0),
            has_more: Boolean(payload?.has_more),
            kpis: payload?.kpis && typeof payload.kpis === "object" ? {
                completed_jobs: Number(payload.kpis.completed_jobs || 0),
                completed_orders: Number(payload.kpis.completed_orders || 0),
                planned_qty: Number(payload.kpis.planned_qty || 0),
                produced_qty: Number(payload.kpis.produced_qty || 0),
                remaining_qty: Number(payload.kpis.remaining_qty || 0),
                variance_qty: Number(payload.kpis.variance_qty || 0),
                variance_jobs: Number(payload.kpis.variance_jobs || 0),
                in_flight_jobs: Number(payload.kpis.in_flight_jobs || 0),
                days: Number(payload.kpis.days || params?.days || 90),
            } : undefined,
        };
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

    validateStockPool: async (payload: ValidateStockPoolPayload) => {
        const { data } = await api.post<ValidateStockPoolResult>('/api/production/planner/stock-pools/validate/', payload);
        return data;
    },

    createStockOrdersBulk: async (rows: CreateStockOrderPayload[], idempotencyKey?: string): Promise<CreateStockOrdersBulkResponse> => {
        const { data } = await api.post(
            '/api/production/planner/create-stock-orders-bulk/',
            { rows },
            { headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined },
        );
        return data;
    },

    matchRecipe: async (invariantSignature: string) => {
        const { data } = await api.get('/api/production/planner/match-recipe/', {
            params: { invariant_signature: invariantSignature },
        });
        return data;
    },

    getPlannerSkus: async (params?: { template_id?: string; active?: boolean }) => {
        const { data } = await api.get<MaybePaginated<PlannerSkuPreset>>('/api/production/planner/sku-catalog/', { params });
        return unwrapList<PlannerSkuPreset>(data);
    },

    getPlannerSkuVariants: async (params?: { sku_id?: string; launch_kind?: string; active?: boolean }) => {
        const { data } = await api.get<MaybePaginated<PlannerSkuVariantPreset>>('/api/production/planner/sku-variants/', { params });
        return unwrapList<PlannerSkuVariantPreset>(data);
    },

    createPlannerSku: async (payload: Partial<PlannerSkuPreset>) => {
        const { data } = await api.post<PlannerSkuPreset>('/api/production/planner/sku-catalog/', payload);
        return data;
    },

    updatePlannerSku: async (id: string, payload: Partial<PlannerSkuPreset>) => {
        const { data } = await api.patch<PlannerSkuPreset>(`/api/production/planner/sku-catalog/${id}/`, payload);
        return data;
    },

    createPlannerSkuVariant: async (payload: Partial<PlannerSkuVariantPreset>) => {
        const { data } = await api.post<PlannerSkuVariantPreset>('/api/production/planner/sku-variants/', payload);
        return data;
    },

    updatePlannerSkuVariant: async (id: string, payload: Partial<PlannerSkuVariantPreset>) => {
        const { data } = await api.patch<PlannerSkuVariantPreset>(`/api/production/planner/sku-variants/${id}/`, payload);
        return data;
    },

    cloneOrderToStock: async (payload: CloneOrderPayload) => {
        const { data } = await api.post('/api/production/planner/control-hub/clone/', payload);
        return data;
    },

    getControlHub: async (params?: PlannerControlHubParams): Promise<ControlHubResponse> => {
        const { data } = await api.get<ControlHubResponse>('/api/production/planner/control-hub/', {
            params: {
                summary: params?.summary ? 1 : undefined,
                planning_limit: params?.planning_limit ?? 18,
                active_limit: params?.active_limit ?? 24,
                history_limit: params?.history_limit ?? 48,
                history_offset: params?.history_offset ?? undefined,
                history_job_limit: params?.history_job_limit ?? undefined,
                scan_limit: params?.scan_limit ?? undefined,
                history_days: params?.history_days ?? undefined,
                history_query: params?.history_query || undefined,
                history_source: params?.history_source || undefined,
                history_order_kind: params?.history_order_kind || undefined,
                detail_order_kind: params?.detail_order_kind || undefined,
                detail_order_id: params?.detail_order_id || undefined,
                detail_sales_order_item_id: params?.detail_sales_order_item_id || undefined,
                queue_search: params?.queue_search || undefined,
                queue_customer: params?.queue_customer || undefined,
                queue_template: params?.queue_template || undefined,
                queue_fg_type: params?.queue_fg_type || undefined,
                queue_material: params?.queue_material || undefined,
                queue_source_path: params?.queue_source_path || undefined,
                queue_release: params?.queue_release || undefined,
                queue_age: params?.queue_age || undefined,
                queue_print: params?.queue_print || undefined,
                queue_lifecycle: params?.queue_lifecycle || undefined,
                queue_min_width: params?.queue_min_width || undefined,
                queue_max_width: params?.queue_max_width || undefined,
                queue_overdue_only: params?.queue_overdue_only ? 1 : undefined,
            },
            timeout: params?.timeout_ms ?? 30000,
        });
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
            detail_order: payload.detail_order && typeof payload.detail_order === "object" ? payload.detail_order : null,
            summary: Boolean(payload.summary),
            kpis: payload.kpis && typeof payload.kpis === "object" ? payload.kpis : undefined,
        };
    },

    planOrder: async (orderKind: PlannerOrderKind, orderId: string, payload: PlanOrderPayload) => {
        const { data } = await api.post(`/api/production/planner/control-hub/${orderKind}/${orderId}/plan/`, payload);
        return data;
    },

    releasePlannedOrder: async (orderKind: PlannerOrderKind, orderId: string, payload?: { item_id?: string }) => {
        const { data } = await api.post(`/api/production/planner/control-hub/${orderKind}/${orderId}/release/`, payload || {});
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

    cancelPlannedLine: async (orderKind: PlannerOrderKind, orderId: string, payload: CancelLinePayload) => {
        const { data } = await api.post(`/api/production/planner/control-hub/${orderKind}/${orderId}/cancel/`, payload);
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

    resumeStockRouteToSales: async (salesOrderItemId: string, stockOrderId: string) => {
        const { data } = await api.post(`/api/production/planner/control-hub/sales-items/${salesOrderItemId}/resume-stock-route/`, {
            stock_order_id: stockOrderId,
        });
        return data;
    },
}
