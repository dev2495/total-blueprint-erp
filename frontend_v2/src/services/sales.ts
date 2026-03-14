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
    }
};
