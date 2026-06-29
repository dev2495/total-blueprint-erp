import { api } from "@/lib/api";

type MaybePaginated<T> = T[] | { results?: T[] } | unknown

function unwrapList<T>(data: MaybePaginated<T>): T[] {
    if (Array.isArray(data)) return data
    if (data && typeof data === "object" && Array.isArray((data as any).results)) {
        return (data as any).results as T[]
    }
    return []
}

export interface SalesOrderLine {
    id: string;
    line_name?: string | null;
    template_name?: string | null;
    product_master?: string | null;
    product_master_id?: string | null;
    product_master_name?: string | null;
    product_master_code?: string | null;
    axis_values?: Record<string, any> | null;
    geometry_snapshot?: Record<string, any> | null;
    layer_snapshot?: any[] | null;
    printing_snapshot?: Record<string, any> | null;
    addons_snapshot?: any[] | null;
    packaging_snapshot?: Record<string, any> | null;
    bom_snapshot?: Record<string, any> | null;
    artwork_preview?: {
        artwork_id?: string;
        design_code?: string;
        name?: string;
        thumbnail_url?: string;
        color_count?: number;
    } | null;
    qty_value?: number | string;
    qty_uom?: string;
    uom?: string | null;
    unit_price?: number | string | null;
    price_basis?: "KG" | "PCS" | string | null;
    line_status?: string;
    line_status_display?: string;
    qty_dispatched?: number | string;
    qty_open?: number | string;
    qty_final_output?: number | string;
    qty_dispatchable?: number | string;
    qty_replan_remaining?: number | string;
    qty_cancelled?: number | string;
    qty_short_closed?: number | string;
    qty_closed_without_dispatch?: number | string;
    line_closed_reason?: string | null;
    line_closed_at?: string | null;
    template?: { name?: string } | null;
    production_batch_summary?: {
        batch_count?: number;
        status_counts?: Record<string, number>;
        produced_kg?: number | string;
        dispatched_kg?: number | string;
        batches?: Array<{
            id: string;
            batch_number: string;
            batch_sequence?: number;
            status: string;
            planned_qty?: number | string;
            planned_uom?: string;
            produced_qty_kg?: number | string;
            produced_qty_pcs?: number | string;
            packed_qty_kg?: number | string;
            packed_qty_pcs?: number | string;
            dispatched_qty_kg?: number | string;
            dispatched_qty_pcs?: number | string;
            current_step_index?: number;
            current_route_node_id?: string;
            current_route_branch_key?: string;
            current_route_node_label?: string;
            current_route_process_code?: string;
            current_route_join_key?: string;
            current_route_parallel_group?: string;
            route_graph?: { nodes?: any[] } | Record<string, any>;
            allow_partial_movement?: boolean;
            required_input_refs?: any[];
            matched_input_refs?: any[];
            source?: string;
        }>;
    } | null;
}

export interface SalesOrder {
    id: string;
    order_number: string;
    order_name?: string | null;
    line_name?: string | null;
    customer?: string;
    customer_name: string;
    customer_id?: string;
    ship_to_customer?: string | null;
    ship_to_customer_name?: string | null;
    address_override?: string | null;
    remarks?: string | null;
    plant_name?: string | null;
    order_type?: string;
    status:
        | 'DRAFT'
        | 'CONFIRMED'
        | 'PLANNING_REQUIRED'
        | 'PLANNED'
        | 'RELEASED'
        | 'PACKING_READY'
        | 'DISPATCH_READY'
        | 'COMPLETED'
        | 'CANCELLED';
    delivery_date: string;
    geometry_override?: {
        width_mm?: number;
        height_mm?: number;
        gusset_mm?: number;
        trim_loss_mm?: number;
        flap_tape_mm?: number;
        pouch_style?: string;
        adjustments?: Array<{ name: string; value: number; impact: 'WIDTH' | 'HEIGHT' | 'BOTH' }>;
    };
    commercial_confirmed_at?: string | null;
    total_weight_kg?: number | string;
    total_value?: number;
    item_summary?: {
        variant_code?: string;
        variant_name?: string;
        template_name?: string;
        template_tag?: string;
        finished_good_type?: "POUCH" | "ROLL" | string;
        size_or_form?: string;
        layer_count?: number;
        layer_labels?: string[];
        printing_summary?: string;
        pod_enabled?: boolean;
        packaging_summary?: string;
        addons_count?: number;
        claimed_stock_order_nos?: string[];
        line_count?: number;
        unit_weight_g?: number;
        spec_facets?: any;
        layers?: any[];
        size?: any;
        pod_labels?: string[];
        addon_labels?: string[];
        search_text?: string;
    };
    qty_summary?: {
        ordered_kg?: number | null;
        ordered_pcs?: number | null;
    };
    fulfillment_summary?: {
        produced_kg?: number | null;
        packed_kg?: number | null;
        dispatchable_kg?: number | null;
        dispatched_kg?: number | null;
        remaining_kg?: number | null;
        produced_pcs?: number | null;
        dispatched_pcs?: number | null;
        remaining_pcs?: number | null;
        completion_percent?: number | null;
    };
    line_preview?: SalesOrderLine[];
    items: SalesOrderLine[];
    created_at: string;
}

export interface SalesSkuVariant {
    id: string;
    sku: string;
    sku_code?: string;
    sku_name?: string;
    code: string;
    name: string;
    active: boolean;
    finished_good_type: "POUCH" | "ROLL";
    roll_form?: "FLAT" | "FOLDED" | "TUBING" | "" | null;
    geometry_snapshot: any;
    layer_snapshot: any[];
    printing_snapshot: any;
    chemicals_snapshot: any;
    addons_snapshot: any[];
    packaging_snapshot: any;
    derived_from_planner_variant?: string | null;
    derived_from_planner_variant_code?: string | null;
    derived_from_planner_variant_name?: string | null;
    template?: string;
    template_name?: string;
    created_at: string;
    updated_at: string;
}

export interface SalesSku {
    id: string;
    code: string;
    name: string;
    template: string;
    template_name?: string;
    commercial_family?: string | null;
    commercial_family_name?: string | null;
    default_line_name?: string;
    active: boolean;
    customer_usage_count?: number;
    customer_last_used_at?: string | null;
    variants: SalesSkuVariant[];
    created_at: string;
    updated_at: string;
}

export interface RepeatLineCandidate {
    id: string;
    order_id: string;
    order_number: string;
    order_name?: string;
    customer_id?: string | null;
    customer_name: string;
    order_created_at: string;
    template_id: string;
    template_name: string;
    sku_variant_id?: string | null;
    sku_variant_name?: string | null;
    sku_variant_code?: string | null;
    line_name: string;
    qty_value: number | string;
    qty_uom: "PCS" | "KG";
    price_basis: "PCS" | "KG";
    unit_price: number | string;
    geometry_snapshot: any;
    layer_snapshot: any[];
    printing_snapshot: any;
    chemicals_snapshot: any;
    addons_snapshot: any[];
    packaging_snapshot: any;
    summary: {
        finished_good_type: "POUCH" | "ROLL";
        roll_form?: "FLAT" | "FOLDED" | "TUBING" | "";
        pouch_style?: string;
        width_mm?: number;
        height_mm?: number;
        layer_count?: number;
        printing_enabled?: boolean;
        printing_type?: string;
        pod_enabled?: boolean;
        addons_count?: number;
    };
}

export interface BatchCreateOrderRow {
    client_reference: string;
    source_type: "SKU" | "REPEAT" | "CUSTOM";
    order_name?: string;
    delivery_date: string;
    order_type?: string;
    ship_to_customer?: string;
    ship_to_customer_name?: string;
    remarks?: string;
    items: any[];
}

export interface BatchCreateOrderResult {
    client_reference?: string;
    source_type: "SKU" | "REPEAT" | "CUSTOM";
    status: "created" | "failed";
    sales_order_id?: string;
    sales_order_number?: string;
    error?: string;
}

export interface BatchCreateResponse {
    customer?: string;
    customer_name?: string;
    created_count: number;
    failed_count: number;
    results: BatchCreateOrderResult[];
}

export interface PreviewPayload {
    template_id?: string;
    finished_good_type: 'POUCH' | 'ROLL';
    geometry: any;
    film_layers: any[];
    printing: any;
    chemicals?: any;
    addons?: any[];
    packaging_snapshot?: any;
    roll_form?: "FLAT" | "FOLDED" | "TUBING" | "" | null;
    order_qty: number;
    uom: 'PCS' | 'KG';
    is_printing_enabled?: boolean;
    inks?: any[];
}

export interface PreviewResult {
    unit_weight_g: number;
    total_weight_kg: number;
    physics?: {
        geometry_snapshot?: {
            effective_width_mm?: number;
            effective_height_mm?: number;
            area_m2?: number;
        };
        roll_preview?: {
            weight_kg: number;
            width_mm: number;
            thickness_micron: number;
            density_gcm3: number;
            derived_area_m2: number;
            derived_length_m: number;
        };
    };
    roll_preview?: {
        weight_kg: number;
        width_mm: number;
        thickness_micron: number;
        density_gcm3: number;
        derived_area_m2: number;
        derived_length_m: number;
    };
    geometry_snapshot?: {
        effective_width_mm?: number;
        effective_height_mm?: number;
        area_m2?: number;
    };
    bom?: {
        addons?: Array<{ weight_kg?: number }>;
        pod?: Array<{ weight_kg?: number }>;
    };
    bom_preview: {
        components: {
            material_name: string;
            qty: number;
            uom: string;
        }[];
    };
}

export interface QuotationProcessRow {
    sequence?: number;
    process_id?: string | null;
    process_code?: string;
    process_name?: string;
    machine_id?: string | null;
    machine_name?: string;
    rate_id?: string | null;
    hourly_rate?: number;
    setup_hours?: number;
    run_hours?: number;
    notes?: string;
    cost?: number;
}

export interface QuotationCommercialSnapshot {
    wastage_percent?: number;
    freight_value?: number;
    packing_value?: number;
    misc_value?: number;
    discount_percent?: number;
    discount_value?: number;
    tax_percent?: number;
    margin_target_percent?: number;
    manual_unit_price?: number;
    manual_line_total?: number;
}

export interface QuotationCostingSnapshot {
    material_lines: Array<{
        category: string;
        material_id?: string | null;
        material_code?: string | null;
        material_name?: string | null;
        weight_kg: number;
        rate_per_kg: number;
        cost: number;
    }>;
    process_lines: Array<QuotationProcessRow>;
    material_cost: number;
    process_cost: number;
    direct_cost: number;
    wastage_percent: number;
    wastage_cost: number;
    freight_value: number;
    packing_value: number;
    misc_value: number;
    landed_cost: number;
    discount_percent: number;
    discount_value: number;
    discount_amount: number;
    tax_percent: number;
    tax_value: number;
    gross_sell_total: number;
    net_total: number;
    grand_total: number;
    unit_price: number;
    margin_value: number;
    margin_percent: number;
    pricing_mode: string;
    warnings?: string[];
}

export interface QuotationLinePayload {
    id?: string;
    plant?: string | null;
    template?: string | null;
    template_id?: string | null;
    sku_variant?: string | null;
    sku_variant_id?: string | null;
    source_mode?: "SKU" | "CUSTOM";
    line_name: string;
    finished_good_type: "POUCH" | "ROLL";
    roll_form?: "FLAT" | "FOLDED" | "TUBING" | "";
    qty_value: number;
    qty_uom: "PCS" | "KG";
    price_basis: "PCS" | "KG";
    geometry?: any;
    geometry_snapshot?: any;
    film_layers?: any[];
    layer_snapshot?: any[];
    printing?: any;
    printing_snapshot?: any;
    chemicals?: any;
    chemicals_snapshot?: any;
    addons?: any[];
    addons_snapshot?: any[];
    packaging_snapshot?: any;
    process_cost_rows?: QuotationProcessRow[];
    process_rows?: QuotationProcessRow[];
    commercial_snapshot?: QuotationCommercialSnapshot;
    commercial?: QuotationCommercialSnapshot;
}

export interface QuotationPreview extends PreviewResult {
    costing: QuotationCostingSnapshot;
    process_cost_rows: QuotationProcessRow[];
    commercial_snapshot: QuotationCommercialSnapshot;
    template_id?: string | null;
    sku_variant_id?: string | null;
    sku_variant_name?: string | null;
    sku_variant_code?: string | null;
    source_mode?: "SKU" | "CUSTOM";
    line_name?: string;
    qty_value?: number;
    qty_uom?: "PCS" | "KG";
    price_basis?: "PCS" | "KG";
}

export interface QuotationItem {
    id: string;
    template?: string | null;
    template_name?: string | null;
    sku_variant?: string | null;
    sku_variant_name?: string | null;
    sku_variant_code?: string | null;
    source_mode?: "SKU" | "CUSTOM";
    line_name: string;
    finished_good_type: "POUCH" | "ROLL";
    roll_form?: "FLAT" | "FOLDED" | "TUBING" | "";
    qty_value: string | number;
    qty_uom: "PCS" | "KG";
    price_basis: "PCS" | "KG";
    geometry_snapshot: any;
    layer_snapshot: any[];
    printing_snapshot: any;
    chemicals_snapshot: any;
    addons_snapshot: any[];
    packaging_snapshot: any;
    physics_snapshot: any;
    bom_snapshot: any;
    process_cost_rows: QuotationProcessRow[];
    commercial_snapshot: QuotationCommercialSnapshot;
    costing_snapshot: QuotationCostingSnapshot;
    unit_weight_g: string | number;
    total_weight_kg: string | number;
    quoted_unit_price: string | number;
    quoted_line_total: string | number;
}

export interface Quotation {
    id: string;
    quote_number: string;
    customer?: string | null;
    customer_name: string;
    customer_code?: string | null;
    plant?: string | null;
    plant_name?: string | null;
    status: "DRAFT" | "SENT" | "APPROVED" | "REJECTED" | "EXPIRED" | "CONVERTED";
    valid_until?: string | null;
    currency: string;
    terms: string;
    notes: string;
    totals_snapshot: {
        item_count?: number;
        subtotal?: number;
        tax_total?: number;
        grand_total?: number;
        landed_cost_total?: number;
        margin_total?: number;
        margin_percent?: number;
        currency?: string;
    };
    converted_sales_order?: string | null;
    converted_sales_order_number?: string | null;
    items: QuotationItem[];
    created_at: string;
    updated_at: string;
}

export interface QuotationConvertResult {
    sales_order_id: string;
    sales_order_number: string;
    quotation_id: string;
    quotation_number: string;
}

export const salesService = {
    getOrders: async (params?: { q?: string; status?: string; limit?: number; offset?: number; summary?: boolean }) => {
        const { data } = await api.get<MaybePaginated<SalesOrder>>("/api/sales/orders/", {
            params: {
                limit: params?.limit ?? 50,
                summary: params?.summary === false ? undefined : 1,
                ...(params || {}),
            },
        });
        return unwrapList<SalesOrder>(data);
    },

    getSalesSkus: async (params?: { customer_id?: string; active?: boolean }) => {
        const { data } = await api.get<MaybePaginated<SalesSku>>("/api/sales/sku-catalog/", { params });
        return unwrapList<SalesSku>(data);
    },

    createSalesSku: async (payload: Partial<SalesSku>) => {
        const { data } = await api.post<SalesSku>("/api/sales/sku-catalog/", payload);
        return data;
    },

    updateSalesSku: async (id: string, payload: Partial<SalesSku>) => {
        const { data } = await api.patch<SalesSku>(`/api/sales/sku-catalog/${id}/`, payload);
        return data;
    },

    getSalesSkuVariants: async (params?: { customer_id?: string; sku_id?: string; active?: boolean }) => {
        const { data } = await api.get<MaybePaginated<SalesSkuVariant>>("/api/sales/sku-variants/", { params });
        return unwrapList<SalesSkuVariant>(data);
    },

    createSalesSkuVariant: async (payload: Partial<SalesSkuVariant>) => {
        const { data } = await api.post<SalesSkuVariant>("/api/sales/sku-variants/", payload);
        return data;
    },

    updateSalesSkuVariant: async (id: string, payload: Partial<SalesSkuVariant>) => {
        const { data } = await api.patch<SalesSkuVariant>(`/api/sales/sku-variants/${id}/`, payload);
        return data;
    },

    getRepeatLines: async (params?: { customer_id?: string; q?: string }) => {
        const { data } = await api.get<RepeatLineCandidate[]>("/api/sales/orders/repeat-lines/", { params });
        return Array.isArray(data) ? data : [];
    },

    getRecentOrders: async () => {
        const { data } = await api.get<MaybePaginated<SalesOrder>>("/api/sales/orders/", { params: { limit: 12, summary: false } });
        return unwrapList<SalesOrder>(data);
    },

    createOrder: async (payload: any) => {
        const { data } = await api.post("/api/sales/orders/", payload);
        return data;
    },

    batchCreateOrders: async (payload: {
        customer: string;
        customer_name?: string;
        ship_to_customer?: string;
        ship_to_customer_name?: string;
        address_override?: string;
        extra_address?: string;
        remarks?: string;
        orders: BatchCreateOrderRow[];
    }) => {
        const { data } = await api.post<BatchCreateResponse>("/api/sales/orders/batch-create/", payload);
        return data;
    },

    createCustomOrder: async (payload: any) => {
        const { data } = await api.post("/api/sales/orders/custom/", payload);
        return data;
    },

    previewItem: async (payload: PreviewPayload) => {
        const { data } = await api.post<PreviewResult>("/api/sales/orders/preview-item/", payload);
        return data;
    },

    confirmOrder: async (id: string) => {
        const { data } = await api.post(`/api/sales/orders/${id}/confirm/`);
        return data;
    },

    cancelOrder: async (id: string, reason?: string, itemIds?: string[]) => {
        const { data } = await api.post<SalesOrder>(`/api/sales/orders/${id}/cancel/`, {
            reason: reason || "",
            item_ids: itemIds || [],
        });
        return data;
    },

    getOrder: async (id: string) => {
        const { data } = await api.get<SalesOrder>(`/api/sales/orders/${id}/`);
        return data;
    },

    getBlockReasons: async (id: string) => {
        // Needs endpoint verification if used
        return [];
    },

    getQuotations: async () => {
        const { data } = await api.get<MaybePaginated<Quotation>>("/api/sales/quotations/");
        return unwrapList<Quotation>(data);
    },

    getQuotation: async (id: string) => {
        const { data } = await api.get<Quotation>(`/api/sales/quotations/${id}/`);
        return data;
    },

    previewQuotationLine: async (payload: QuotationLinePayload) => {
        const { data } = await api.post<QuotationPreview>("/api/sales/quotations/preview-line/", payload);
        return data;
    },

    createQuotation: async (payload: {
        customer?: string | null;
        customer_name: string;
        plant?: string | null;
        status?: Quotation["status"];
        valid_until?: string | null;
        currency?: string;
        terms?: string;
        notes?: string;
        items: QuotationLinePayload[];
    }) => {
        const { data } = await api.post<Quotation>("/api/sales/quotations/", payload);
        return data;
    },

    updateQuotation: async (
        id: string,
        payload: Partial<{
            customer?: string | null;
            customer_name: string;
            plant?: string | null;
            status?: Quotation["status"];
            valid_until?: string | null;
            currency?: string;
            terms?: string;
            notes?: string;
            items: QuotationLinePayload[];
        }>
    ) => {
        const { data } = await api.patch<Quotation>(`/api/sales/quotations/${id}/`, payload);
        return data;
    },

    duplicateQuotation: async (id: string) => {
        const { data } = await api.post<Quotation>(`/api/sales/quotations/${id}/duplicate/`);
        return data;
    },

    convertQuotationToOrder: async (id: string) => {
        const { data } = await api.post<QuotationConvertResult>(`/api/sales/quotations/${id}/convert-to-order/`);
        return data;
    },

    getQuotationPdfUrl: (id: string) => `/api/sales/quotations/${id}/pdf/`,
};
