import { api } from "@/lib/api";

// ====================================================================
// Quotation service — V37 Quote workspace
// ====================================================================

export interface QuoteLineLayer {
    position?: string;
    material_id?: string | null;
    material_code?: string;
    material_name?: string;
    material_category?: string;
    name?: string;
    micron?: number;
    gsm?: number;
    gsm_auto?: boolean;
    density_gcm3?: number | null;
    rate_per_kg?: number;
    cost_source_type?: string;
    cost_source_ref?: string;
    cost_source_lot_ref?: string;
    cost_source_effective_at?: string | null;
    cost_available_qty?: number;
    cost_uom?: string;
}

export interface QuoteLineAddon {
    material_id?: string | null;
    material_code?: string;
    code?: string;
    name: string;
    qty_per_pouch?: number;
    rate_per_kg: number;
    cost_source_type?: string;
    cost_source_ref?: string;
    cost_source_lot_ref?: string;
    cost_source_effective_at?: string | null;
    cost_available_qty?: number;
    cost_uom?: string;
}

export interface QuoteMaterialComponent {
    material_id?: string | null;
    material_code?: string;
    material_name?: string;
    name?: string;
    gsm?: number;
    quantity?: number;
    uom?: string;
    rate_per_kg?: number;
    cost_source_type?: string;
    cost_source_ref?: string;
    cost_source_lot_ref?: string;
    cost_source_effective_at?: string | null;
    cost_available_qty?: number;
    cost_uom?: string;
}

export interface InventoryMaterialOption {
    id: string;
    code: string;
    name: string;
    category: string;
    category_display?: string;
    base_uom: string;
    density_gcm3?: number | null;
    avg_cost: number;
    stock_qty?: number;
    substitutes_count?: number;
}

export interface QuoteLineSpec {
    product_master_id?: string | null;
    product_master_code?: string | null;
    product_master_name?: string | null;
    size_id?: string | null;
    size_code?: string | null;
    size_label?: string | null;
    base_product_master_id?: string | null;
    base_product_master_code?: string | null;
    base_product_master_name?: string | null;
    base_size_id?: string | null;
    base_size_code?: string | null;
    base_size_label?: string | null;
    pouch_style_id?: string | null;
    pouch_style_code?: string | null;
    pouch_style_roll_axis?: string | null;
    stock_form?: string | null;
    width_basis?: string | null;
    film_area_width_mm?: number | null;
    print_capable?: boolean | null;
    artwork_required?: boolean | null;
    artwork_id?: string | null;
    artwork_code?: string | null;
    artwork_name?: string | null;
    artwork_print_type?: string | null;
    artwork_substrate_mode?: string | null;
    artwork_front_colors_count?: number | null;
    artwork_back_colors_count?: number | null;
    artwork_ink_gsm_total?: number | null;
    child_target_width_mm?: number | null;
    width_mm?: number;
    height_mm?: number;
    gusset_mm?: number;
    flap_mm?: number;
    layers?: QuoteLineLayer[];
    adhesives?: QuoteMaterialComponent[];
    inks?: QuoteMaterialComponent[];
    solvents?: QuoteMaterialComponent[];
    additives?: QuoteMaterialComponent[];
    addons?: QuoteLineAddon[];
    optional_inner_pack?: QuoteLineInnerPack | null;
    child_web_width_mm?: number;
    conversion_stages?: string[];
    quote_variant_kind?: "EXISTING_READY" | "QUOTE_SCOPED_VARIANT";
    total_gsm?: number | string;
    unit_weight_g?: number | string;
    total_weight_kg?: number | string;
    product_variant_id?: string | null;
    product_variant_code?: string | null;
    saved_variant_id?: string | null;
    saved_variant_code?: string | null;
    cost_overrides?: Array<{
        component_key?: string;
        material_id: string;
        role: string;
        sequence: number;
        rate: number;
        reason: string;
        expires_at: string;
    }>;
    // Read-only compatibility for quotations created before first-class
    // material component arrays were introduced. New saves use plural arrays.
    adhesive_gsm?: number;
    adhesive_rate_per_kg?: number;
    adhesive_name?: string;
    ink_gsm?: number;
    ink_rate_per_kg?: number;
    ink_name?: string;
}

export interface QuoteLineInnerPack {
    material_id?: string | null;
    code?: string;
    name?: string;
    pcs_per_inner?: number;
    rate_per_kg?: number;
    optional?: boolean;
}

export interface CostingBreakdownRow {
    kind?: string;
    stage?: string;
    name?: string;
    rate_per_kg?: number;
    contribution_per_kg?: number;
    gsm?: number;
    micron?: number;
    scrap_pct?: number;
    qty_per_pouch?: number;
    unit_rate_per_kg?: number;
}

export interface CostingBreakdown {
    materials: CostingBreakdownRow[];
    conversion: CostingBreakdownRow[];
}

export interface CostingResult {
    material_cost_per_kg: number;
    conversion_cost_per_kg: number;
    total_cost_per_kg: number;
    margin_pct: number;
    margin_source: "MANUAL" | "CUSTOMER" | "POUCH_STYLE" | "PLANT" | "COMPANY_DEFAULT";
    suggested_rate: number;
    is_indicative: boolean;
    warnings: string[];
    breakdown: CostingBreakdown;
}

export interface CostPreviewPayload {
    spec: QuoteLineSpec;
    customer_id?: string | null;
    plant_id?: string | null;
    manual_margin_pct?: number | null;
    manual_rate?: number | null;
}

export interface QuotationItem {
    id?: string;
    line_kind?: "CATALOG" | "AD_HOC";
    line_name?: string;
    finished_good_type?: string;
    qty_value?: number | string;
    qty_uom?: string;
    price_basis?: string;
    quoted_unit_price?: number | string;
    quoted_line_total?: number | string;
    spec_snapshot?: QuoteLineSpec & Record<string, unknown>;
    costing_snapshot?: Record<string, unknown>;
    margin_lock?: boolean;
    manual_rate_override?: number | string | null;
    template?: string | null;
    sku_variant?: string | null;
    product_master?: string | null;
    size?: string | null;
    product_master_size?: string | null;
    product_variant?: string | null;
    pouch_style_master?: string | null;
    canonical_source_snapshot?: Record<string, unknown>;
    spec_signature?: string;
    cost_snapshot_checksum?: string;
    packaging_snapshot?: Record<string, unknown> | null;
    actual_variance?: {
        quoted_material_cost: number | string;
        quoted_conversion_cost: number | string;
        quoted_total_cost: number | string;
        actual_material_cost: number | string;
        actual_conversion_cost: number | string;
        actual_total_cost: number | string;
        variance_amount: number | string;
        variance_percent: number | string;
        actual_coverage_pct: number | string;
        source: Record<string, unknown>;
        calculated_at: string;
    } | null;
}

export interface QuotationListItem {
    id: string;
    quote_number: string;
    customer_name: string;
    customer?: string | null;
    enquiry_reference?: string;
    contact_name?: string;
    contact_email?: string;
    contact_phone?: string;
    billing_address?: string;
    shipping_address?: string;
    plant?: string | null;
    plant_name?: string | null;
    status: string;
    valid_until?: string | null;
    currency: string;
    revision_no: number;
    parent_quotation?: string | null;
    sent_at?: string | null;
    sent_by?: string | null;
    sent_by_name?: string | null;
    approved_at?: string | null;
    approved_by?: string | null;
    approved_by_name?: string | null;
    rejected_by?: string | null;
    rejected_by_name?: string | null;
    rejection_reason?: string | null;
    accepted_at?: string | null;
    acceptance_reference?: string;
    acceptance_channel?: string;
    cancellation_reason?: string;
    void_reason?: string;
    frozen_at?: string | null;
    terms?: string | null;
    payment_terms?: string;
    delivery_terms?: string;
    requested_delivery_date?: string | null;
    place_of_supply?: string;
    tax_snapshot?: Record<string, unknown>;
    custom_terms?: string | null;
    notes?: string | null;
    discount_pct?: number | string;
    discount_amount?: number | string;
    freight_amount?: number | string;
    freight_included?: boolean;
    other_charges?: Array<{ label: string; amount: number }>;
    gst_rate?: number | string;
    status_history?: Array<{
        status: string;
        at: string;
        by_id?: string | null;
        by_name?: string | null;
        note?: string;
    }>;
    converted_sales_order_number?: string | null;
    created_at: string;
    updated_at: string;
    totals_snapshot?: Record<string, unknown>;
    converted_sales_order?: string | null;
    items?: QuotationItem[];
    readiness?: { ready: boolean; errors: string[] };
    cost_build?: CostBuild | null;
    approval_gates?: ApprovalGate[];
    deliveries?: QuoteDelivery[];
}

export interface CostComponent {
    id?: string;
    quotation_item_id?: string;
    component_key?: string;
    category: "MATERIAL" | "PROCESS" | "LABOUR" | "OVERHEAD" | "WASTAGE" | "PACKING" | "FREIGHT" | "OTHER";
    role?: string;
    label: string;
    material_id?: string;
    material_code?: string;
    material_name?: string;
    source_type: string;
    source_ref?: string;
    source_lot_ref?: string;
    source_effective_at?: string | null;
    baseline_rate: number | string;
    baseline_available_qty: number | string;
    baseline_uom: string;
    quote_quantity: number | string;
    quote_uom: string;
    effective_rate: number | string;
    component_cost: number | string;
    override_rate?: number | string | null;
    override_reason?: string;
    override_status: string;
    override_expires_at?: string | null;
    readiness_status: string;
    provenance?: Record<string, unknown>;
}

export interface CostBuild {
    id?: string;
    status: string;
    currency?: string;
    cost_entry_mode?: "CONVERSION_TOTAL" | "STEPWISE";
    pricing_definition?: "MARKUP_ON_COST" | "GROSS_MARGIN_ON_SALES";
    target_percent?: number | string;
    material_cost?: number | string;
    conversion_cost?: number | string;
    total_cost?: number | string;
    list_price?: number | string;
    target_price?: number | string;
    discount_amount?: number | string;
    net_sale?: number | string;
    tax_amount?: number | string;
    rounding_amount?: number | string;
    grand_total?: number | string;
    contribution?: number | string;
    markup_pct?: number | string;
    gross_margin_pct?: number | string;
    formula_version?: string;
    readiness?: { ready: boolean; errors: string[]; warnings?: string[]; pending_override_count?: number };
    sensitivity?: Record<string, { cost: string; contribution: string; gross_margin_pct: string }>;
    checksum?: string;
    components?: CostComponent[];
    source_snapshot?: {
        items?: Array<{
            quotation_item_id: string;
            physics?: { output_kg?: number | string; unit_weight_g?: number | string; total_gsm?: number | string };
        }>;
    };
}

export interface ApprovalGate {
    id: string;
    gate: string;
    status: string;
    reason?: string;
    requested_at?: string;
    decided_at?: string | null;
    expires_at?: string | null;
    snapshot_checksum?: string;
}

export interface QuoteDelivery {
    id: string;
    channel: string;
    recipient: string;
    status: string;
    provider?: string;
    provider_message_id?: string;
    attempted_at?: string;
    delivered_at?: string | null;
    artifact_checksum?: string;
}

export interface CustomerSummary {
    id: string;
    code: string;
    name: string;
    credit_limit?: number | string;
    credit_days?: number;
    gst_no?: string;
    contact_person?: string;
    phone?: string;
    email?: string;
}

export interface ProductMasterSummary {
    id: string;
    code: string;
    name: string;
    version_group?: string;
    version?: number;
    is_current_version?: boolean;
    superseded_by?: string | null;
    product_kind: string;
    sizes_count?: number;
}

export interface ProductMasterSize {
    id: string;
    code: string;
    label: string;
    width_mm?: number | null;
    height_mm?: number | null;
    gusset_mm?: number | null;
    flap_mm?: number | null;
    standard_qty?: number | null;
    qty_uom?: string;
    active?: boolean;
    pouch_style_id?: string | null;
    pouch_style?: string | null;
    pouch_style_master?: string | null;
    pouch_style_master_code?: string | null;
    pouch_style_roll_axis?: string | null;
    pouch_style_version?: number | string | null;
    child_target_width_mm?: number | null;
    stock_form?: string | null;
    width_basis?: string | null;
    film_area_width_mm?: number | null;
    roll_width_mm?: number | null;
}

export interface ProductVariantSummary {
    id: string;
    code: string;
    axis_values?: Record<string, unknown>;
    geometry_snapshot?: Record<string, unknown>;
    layer_snapshot?: QuoteLineLayer[];
    spec_snapshot?: QuoteLineSpec;
    active?: boolean;
}

export interface BomLayer {
    position?: string;
    material_id?: string | null;
    material_code?: string;
    material_name?: string;
    micron: number;
    gsm: number;
    gsm_auto?: boolean;
    rate_per_kg: number;
    density_gcm3?: number | null;
    cost_source_type?: string;
    cost_source_ref?: string;
    cost_source_lot_ref?: string;
    cost_source_effective_at?: string | null;
    cost_available_qty?: number;
    cost_uom?: string;
}

export interface BomAdhesive {
    material_id?: string | null;
    code?: string;
    name?: string;
    gsm: number;
    rate_per_kg: number;
    cost_source_type?: string;
    cost_source_ref?: string;
    cost_source_lot_ref?: string;
    cost_source_effective_at?: string | null;
    cost_available_qty?: number;
    cost_uom?: string;
}

export interface BomInk {
    material_id?: string | null;
    code?: string;
    name?: string;
    gsm: number;
    rate_per_kg: number;
    coverage?: "LIGHT" | "MEDIUM" | "HEAVY" | string;
    cost_source_type?: string;
    cost_source_ref?: string;
    cost_source_lot_ref?: string;
    cost_source_effective_at?: string | null;
    cost_available_qty?: number;
    cost_uom?: string;
}

export interface BomAddon {
    material_id?: string | null;
    code?: string;
    name: string;
    qty_per_pouch: number;
    rate_per_kg: number;
    cost_source_type?: string;
    cost_source_ref?: string;
    cost_source_lot_ref?: string;
    cost_source_effective_at?: string | null;
    cost_available_qty?: number;
    cost_uom?: string;
}

export interface FeatureOption {
    key: string;
    label: string;
    default?: boolean;
}

export interface ProductMasterBom {
    product_master_id: string;
    product_master_code: string;
    product_master_name: string;
    default_pouch_style_id?: string | null;
    print_capable?: boolean;
    artwork_required?: boolean;
    sizes: ProductMasterSize[];
    layers: BomLayer[];
    adhesive: BomAdhesive;
    ink: BomInk;
    addons: BomAddon[];
    feature_options: FeatureOption[];
    feature_defaults: Record<string, boolean>;
}

export interface CompatibleArtwork {
    id: string;
    design_code: string;
    name: string;
    status: string;
    print_type?: string | null;
    substrate_mode?: string | null;
    front_colors_count?: number;
    back_colors_count?: number;
    colors_count?: number;
    ink_gsm_total?: number | string;
    primary_image?: string | null;
}

export interface CompatibleArtworkResponse {
    count: number;
    results: CompatibleArtwork[];
    context?: {
        print_type?: string | null;
        substrate_mode?: string | null;
    };
    needs_size?: boolean;
    reason?: string;
}

export interface ProductionPreviewResult {
    pouches_needed: number;
    total_kg: number;
    weight_per_pouch_g: number;
    lanes_per_parent: number;
    pouches_per_parent_roll: number;
    parent_rolls_needed: number;
    machine_time_hrs: number;
    child_web_mm: number;
    material_availability: Array<{
        material_id: string;
        material_code: string;
        material_name: string;
        needed_kg: number;
        available_kg: number;
        ok: boolean;
    }>;
    note?: string;
}

const BASE = "/api/sales/quotations";

function listFromPayload<T>(payload: unknown): T[] {
    if (Array.isArray(payload)) return payload as T[];
    if (payload && typeof payload === "object" && "results" in (payload as Record<string, unknown>)) {
        const results = (payload as { results?: unknown }).results;
        if (Array.isArray(results)) return results as T[];
    }
    return [];
}

export const quotationService = {
    list: async (params?: Record<string, unknown>): Promise<QuotationListItem[]> => {
        const { data } = await api.get(`${BASE}/`, { params });
        return listFromPayload<QuotationListItem>(data);
    },

    get: async (id: string): Promise<QuotationListItem> => {
        const { data } = await api.get<QuotationListItem>(`${BASE}/${id}/`);
        return data;
    },

    create: async (body: Record<string, unknown>): Promise<QuotationListItem> => {
        const { data } = await api.post<QuotationListItem>(`${BASE}/`, body);
        return data;
    },

    update: async (id: string, body: Record<string, unknown>): Promise<QuotationListItem> => {
        const { data } = await api.patch<QuotationListItem>(`${BASE}/${id}/`, body);
        return data;
    },

    remove: async (id: string): Promise<void> => {
        await api.delete(`${BASE}/${id}/`);
    },

    costPreview: async (body: CostPreviewPayload): Promise<CostingResult> => {
        const { data } = await api.post<CostingResult>(`${BASE}/cost-preview/`, body);
        return data;
    },

    getCostBuild: async (id: string): Promise<CostBuild> => {
        const { data } = await api.get<CostBuild>(`${BASE}/${id}/cost-build/`);
        return data;
    },

    saveCostBuild: async (id: string, body: Record<string, unknown>): Promise<CostBuild> => {
        const { data } = await api.post<CostBuild>(`${BASE}/${id}/cost-build/`, body);
        return data;
    },

    approveCostOverrides: async (id: string, reason: string): Promise<QuotationListItem> => {
        const { data } = await api.post<QuotationListItem>(`${BASE}/${id}/approve-cost-overrides/`, { reason });
        return data;
    },

    submitForApproval: async (id: string): Promise<QuotationListItem> => {
        const { data } = await api.post<QuotationListItem>(`${BASE}/${id}/submit-for-approval/`, {});
        return data;
    },

    cloneRevision: async (id: string): Promise<QuotationListItem> => {
        const { data } = await api.post<QuotationListItem>(`${BASE}/${id}/clone-revision/`, {});
        return data;
    },

    send: async (
        id: string,
        body: { recipients: string[] },
    ): Promise<{ status: string; sent_at: string }> => {
        const { data } = await api.post(`${BASE}/${id}/send/`, body);
        return data;
    },

    approve: async (id: string, gate: "COMMERCIAL" | "FINANCE", reason = ""): Promise<QuotationListItem> => {
        const { data } = await api.post(`${BASE}/${id}/approve/`, { gate, reason });
        return data;
    },

    convertToOrder: async (id: string): Promise<{ sales_order_id: string; sales_order_number: string }> => {
        const { data } = await api.post(`${BASE}/${id}/convert-to-order/`, {});
        return data;
    },

    reject: async (id: string, reason: string, gate: "COMMERCIAL" | "FINANCE" = "COMMERCIAL"): Promise<QuotationListItem> => {
        const { data } = await api.post(`${BASE}/${id}/reject/`, { reason, gate });
        return data;
    },

    recordClientOutcome: async (id: string, body: { outcome: "ACCEPTED" | "REJECTED"; reference?: string; channel?: string; reason?: string }): Promise<QuotationListItem> => {
        const { data } = await api.post<QuotationListItem>(`${BASE}/${id}/client-outcome/`, body);
        return data;
    },

    cancel: async (id: string, reason: string): Promise<QuotationListItem> => {
        const { data } = await api.post<QuotationListItem>(`${BASE}/${id}/cancel/`, { reason });
        return data;
    },

    void: async (id: string, reason: string): Promise<QuotationListItem> => {
        const { data } = await api.post<QuotationListItem>(`${BASE}/${id}/void/`, { reason });
        return data;
    },

    expire: async (id: string): Promise<{ status: string }> => {
        const { data } = await api.post(`${BASE}/${id}/expire/`, {});
        return data;
    },

    bulkUpdateItems: async (id: string, items: QuotationItem[]): Promise<QuotationListItem> => {
        const { data } = await api.post<QuotationListItem>(`${BASE}/${id}/bulk-update-items/`, { items });
        return data;
    },

    saveLineAsVariant: async (
        id: string,
        body: { quotation_item_id: string; code: string; reason: string },
    ): Promise<{ quotation_item_id: string; product_variant_id: string; product_variant_code: string; created: boolean; costs_promoted: false }> => {
        const { data } = await api.post(`${BASE}/${id}/save-line-as-variant/`, body);
        return data;
    },

    pdfUrl: (id: string, opts?: { customerView?: boolean; download?: boolean }): string => {
        const params = new URLSearchParams();
        if (opts?.customerView) params.set("customer_view", "1");
        if (opts?.download) params.set("download", "1");
        const qs = params.toString() ? `?${params.toString()}` : "";
        return `${BASE}/${id}/pdf/${qs}`;
    },

    // V37 BOM picker — InventoryMaterial lookup with rates + density.
    lookupMaterials: async (params: {
        category: string;
        search?: string;
        page_size?: number;
    }): Promise<InventoryMaterialOption[]> => {
        const { data } = await api.get(`/api/master/library/bom-lookup/`, { params });
        if (Array.isArray(data?.results)) return data.results as InventoryMaterialOption[];
        return [];
    },

    // V37 customer context panel.
    getCustomer: async (id: string): Promise<CustomerSummary> => {
        const { data } = await api.get<CustomerSummary>(`/api/sales/customers/${id}/`);
        return data;
    },

    listCustomers: async (params?: { search?: string; page_size?: number }): Promise<CustomerSummary[]> => {
        const { data } = await api.get(`/api/sales/customers/`, { params });
        return listFromPayload<CustomerSummary>(data);
    },

    listCustomerQuotes: async (
        customerId: string,
        opts?: { limit?: number },
    ): Promise<QuotationListItem[]> => {
        const { data } = await api.get(`${BASE}/`, {
            params: { customer: customerId, page_size: opts?.limit || 5 },
        });
        return listFromPayload<QuotationListItem>(data);
    },

    listCustomerOrders: async (
        customerId: string,
        opts?: { limit?: number },
    ): Promise<Array<{ id: string; order_number: string; created_at: string; totals_snapshot?: Record<string, unknown> }>> => {
        const { data } = await api.get(`/api/sales/orders/`, {
            params: { customer: customerId, page_size: opts?.limit || 1 },
        });
        return listFromPayload(data);
    },

    // Product catalog lookup used by the V37 catalog line picker.
    listProductMasters: async (params?: { q?: string; current_only?: boolean }): Promise<ProductMasterSummary[]> => {
        const { data } = await api.get(`/api/master/products/`, { params: { ...params, for_sales: true, current_only: params?.current_only ?? true } });
        return listFromPayload<ProductMasterSummary>(data);
    },

    listProductMasterSizes: async (productMasterId: string, q?: string): Promise<ProductMasterSize[]> => {
        const { data } = await api.get(`/api/master/products/${productMasterId}/sizes/`, { params: { q: q || undefined, active: true, limit: 120 } });
        return listFromPayload<ProductMasterSize>(data);
    },

    listProductMasterVariants: async (productMasterId: string, q?: string): Promise<ProductVariantSummary[]> => {
        const { data } = await api.get(`/api/master/products/${productMasterId}/variants/`, { params: { q: q || undefined, active: true, limit: 120 } });
        return listFromPayload<ProductVariantSummary>(data);
    },

    listProcessCostRates: async (): Promise<Array<{
        id: string; process_name: string; process_code: string; machine_name?: string | null;
        machine_code?: string | null; cost_per_hour: number | string; is_active: boolean;
    }>> => {
        const { data } = await api.get(`/api/costing/process-rates/`, { params: { is_active: true, page_size: 500 } });
        return listFromPayload(data);
    },

    listCompatibleArtworks: async (
        productMasterId: string,
        params?: {
            size?: string | null;
            axis_values?: Record<string, unknown>;
            status?: string;
        },
    ): Promise<CompatibleArtworkResponse> => {
        const axisValues =
            params?.axis_values && Object.keys(params.axis_values).length > 0
                ? JSON.stringify(params.axis_values)
                : undefined;
        const { data } = await api.get<CompatibleArtworkResponse>(
            `/api/master/products/${productMasterId}/compatible-artworks/`,
            {
                params: {
                    status: params?.status || "APPROVED",
                    size: params?.size || undefined,
                    axis_values: axisValues,
                },
            },
        );
        return {
            count: Number(data?.count || 0),
            results: Array.isArray(data?.results) ? data.results : [],
            context: data?.context || {},
            needs_size: Boolean(data?.needs_size),
            reason: data?.reason || "",
        };
    },

    // V37 catalog BOM hydration — returns the PM's full bill of materials so a
    // catalog quote line can render the same builder UI as an ad-hoc line.
    getProductMasterBom: async (productMasterId: string, plantId?: string | null, productVariantId?: string | null): Promise<ProductMasterBom> => {
        const { data } = await api.get<ProductMasterBom>(
            `/api/master/products/${productMasterId}/bom/`,
            { params: { plant: plantId || undefined, variant: productVariantId || undefined } },
        );
        return data;
    },

    // V37 production preview — pouches/parent roll, machine time, material availability.
    productionPreview: async (body: {
        spec: QuoteLineSpec;
        plant_id?: string | null;
        qty?: number;
        qty_uom?: "KG" | "PCS";
    }): Promise<ProductionPreviewResult> => {
        const { data } = await api.post<ProductionPreviewResult>(
            `${BASE}/production-preview/`,
            body,
        );
        return data;
    },
};

export type QuotationStatus =
    | "DRAFT"
    | "PENDING_APPROVAL"
    | "APPROVED"
    | "SENT"
    | "ACCEPTED"
    | "REJECTED"
    | "EXPIRED"
    | "CANCELLED"
    | "VOID"
    | "CONVERTED";

export const QUOTATION_STATUSES: QuotationStatus[] = [
    "DRAFT",
    "PENDING_APPROVAL",
    "APPROVED",
    "SENT",
    "ACCEPTED",
    "REJECTED",
    "EXPIRED",
    "CANCELLED",
    "VOID",
    "CONVERTED",
];
