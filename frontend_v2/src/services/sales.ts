import { api } from "@/lib/api";

type MaybePaginated<T> = T[] | { results?: T[] } | unknown

function unwrapList<T>(data: MaybePaginated<T>): T[] {
    if (Array.isArray(data)) return data
    if (data && typeof data === "object" && Array.isArray((data as any).results)) {
        return (data as any).results as T[]
    }
    return []
}

export interface SalesOrder {
    id: string;
    order_number: string;
    line_name?: string | null;
    customer_name: string;
    customer_id?: string;
    plant_name?: string | null;
    order_type?: string;
    status:
        | 'DRAFT'
        | 'CONFIRMED'
        | 'PLANNING_REQUIRED'
        | 'PLANNED'
        | 'RELEASED'
        | 'DISPATCH_READY'
        | 'COMPLETED'
        | 'CANCELLED';
    delivery_date: string;
    geometry_override?: {
        width_mm?: number;
        height_mm?: number;
        gusset_mm?: number;
        adjustments?: Array<{ name: string; value: number; impact: 'WIDTH' | 'HEIGHT' | 'BOTH' }>;
    };
    commercial_confirmed_at?: string | null;
    items: any[];
    created_at: string;
}

export interface PreviewPayload {
    finished_good_type: 'POUCH' | 'ROLL';
    geometry: any;
    film_layers: any[];
    is_printing_enabled: boolean;
    printing: any;
    inks: any[];
    chemicals: any[];
    addons: any[];
    order_qty: number;
    uom: 'PCS' | 'KG';
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
    template?: string | null;
    template_id?: string | null;
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
    line_name?: string;
    qty_value?: number;
    qty_uom?: "PCS" | "KG";
    price_basis?: "PCS" | "KG";
}

export interface QuotationItem {
    id: string;
    template?: string | null;
    template_name?: string | null;
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
    getOrders: async () => {
        const { data } = await api.get<MaybePaginated<SalesOrder>>("/api/sales/orders/");
        return unwrapList<SalesOrder>(data);
    },

    getRecentOrders: async () => {
        // Assuming recently created orders (no special endpoint needed based on current usage, just main list)
        const { data } = await api.get<MaybePaginated<SalesOrder>>("/api/sales/orders/");
        return unwrapList<SalesOrder>(data);
    },

    createOrder: async (payload: any) => {
        const { data } = await api.post("/api/sales/orders/", payload);
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
