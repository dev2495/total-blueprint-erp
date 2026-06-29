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
}

export interface QuoteLineAddon {
    material_id?: string | null;
    material_code?: string;
    code?: string;
    name: string;
    qty_per_pouch?: number;
    rate_per_kg: number;
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
    adhesive_name?: string;
    adhesive_gsm?: number;
    adhesive_rate_per_kg?: number;
    ink_name?: string;
    ink_gsm?: number;
    ink_rate_per_kg?: number;
    addons?: QuoteLineAddon[];
    optional_inner_pack?: QuoteLineInnerPack | null;
    child_web_width_mm?: number;
    conversion_stages?: string[];
    save_as_master?: boolean;
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
    packaging_snapshot?: Record<string, unknown> | null;
}

export interface QuotationListItem {
    id: string;
    quote_number: string;
    customer_name: string;
    customer?: string | null;
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
    terms?: string | null;
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
}

export interface BomAdhesive {
    material_id?: string | null;
    code?: string;
    name?: string;
    gsm: number;
    rate_per_kg: number;
}

export interface BomInk {
    material_id?: string | null;
    code?: string;
    name?: string;
    gsm: number;
    rate_per_kg: number;
    coverage?: "LIGHT" | "MEDIUM" | "HEAVY" | string;
}

export interface BomAddon {
    material_id?: string | null;
    code?: string;
    name: string;
    qty_per_pouch: number;
    rate_per_kg: number;
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

    cloneRevision: async (id: string): Promise<QuotationListItem> => {
        const { data } = await api.post<QuotationListItem>(`${BASE}/${id}/clone-revision/`, {});
        return data;
    },

    send: async (
        id: string,
        body: { via: "email" | "whatsapp" | "pdf_only"; recipients?: string[] },
    ): Promise<{ status: string; sent_at: string }> => {
        const { data } = await api.post(`${BASE}/${id}/send/`, body);
        return data;
    },

    approve: async (id: string): Promise<{ status: string; approved_at: string }> => {
        const { data } = await api.post(`${BASE}/${id}/approve/`, {});
        return data;
    },

    convertToOrder: async (id: string): Promise<{ sales_order_id: string; sales_order_number: string }> => {
        const { data } = await api.post(`${BASE}/${id}/convert-to-order/`, {});
        return data;
    },

    reject: async (id: string, reason: string): Promise<{ status: string }> => {
        const { data } = await api.post(`${BASE}/${id}/reject/`, { reason });
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

    pdfUrl: (id: string, opts?: { customerView?: boolean }): string => {
        const qs = opts?.customerView ? "?customer_view=1" : "";
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

    listProductMasterSizes: async (productMasterId: string): Promise<ProductMasterSize[]> => {
        const { data } = await api.get(`/api/master/products/${productMasterId}/sizes/`);
        return listFromPayload<ProductMasterSize>(data);
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
    getProductMasterBom: async (productMasterId: string): Promise<ProductMasterBom> => {
        const { data } = await api.get<ProductMasterBom>(
            `/api/master/products/${productMasterId}/bom/`,
        );
        return data;
    },

    // V37 promote-modified-BOM — pushes a tweaked spec back onto the master.
    // Gated server-side by master.manage.
    updateProductMasterBom: async (
        productMasterId: string,
        body: Partial<Pick<ProductMasterBom, "layers" | "adhesive" | "ink" | "addons" | "feature_defaults" | "feature_options">>,
    ): Promise<ProductMasterSummary> => {
        const { data } = await api.post<ProductMasterSummary>(
            `/api/master/products/${productMasterId}/update-bom/`,
            body,
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
    | "SENT"
    | "APPROVED"
    | "REJECTED"
    | "EXPIRED"
    | "CONVERTED";

export const QUOTATION_STATUSES: QuotationStatus[] = [
    "DRAFT",
    "SENT",
    "APPROVED",
    "REJECTED",
    "EXPIRED",
    "CONVERTED",
];
