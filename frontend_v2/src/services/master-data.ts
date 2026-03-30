import { api } from "@/lib/api";

type MaybePaginated<T> = T[] | { results?: T[] } | unknown

function unwrapList<T>(data: MaybePaginated<T>): T[] {
    if (Array.isArray(data)) return data
    if (data && typeof data === "object" && Array.isArray((data as any).results)) {
        return (data as any).results as T[]
    }
    return []
}

// Common types
export interface Material {
    id: string;
    code: string;
    name: string;
    status: string;
    category?: string;
    created_at: string;
    base_type?: 'POLY' | 'PET';
    color_name?: string;
    parent_family_name?: string;
    is_purchasable?: boolean;
    is_extrudable?: boolean;
    grade?: string | null;
    pod_type?: "SINGLE" | "DOUBLE" | null;
    pod_fixed_height_mm?: number | null;
    pod_thickness_micron?: number | null;
    pod_panel_count?: number | null;
    pod_is_inhouse_produced?: boolean;
    density_gcm3?: number | null;
}

export interface Addon extends Material {
    weight_mode: 'PER_MM' | 'PER_PIECE' | 'FIXED';
    weight_value: number;
}

export interface PackagingMaterial extends Material {
    base_uom: 'PCS' | 'KG' | 'METER';
    packaging_kind: 'INNER_POUCH' | 'GONNY' | 'TAPE' | 'SHEET' | 'FILM' | 'BOX' | 'LABEL' | 'TAG' | 'OTHER';
    packaging_supply_mode: 'PURCHASED' | 'IN_HOUSE' | 'BOTH';
    production_template?: string | null;
    production_template_name?: string | null;
    packaging_defaults_json?: Record<string, any>;
    tare_weight_kg?: number | null;
    per_sheet_base_qty?: number | null;
}

export interface PodSkuVariant {
    id: string;
    pod_sku: string;
    pod_sku_code: string;
    pod_sku_name: string;
    code: string;
    name: string;
    material: string;
    material_code: string;
    material_name: string;
    material_status?: string;
    pod_type?: "SINGLE" | "DOUBLE" | null;
    pod_fixed_height_mm?: number | null;
    pod_thickness_micron?: number | null;
    pod_panel_count?: number | null;
    density_gcm3?: number | null;
    pod_is_inhouse_produced?: boolean;
    production_defaults_json?: Record<string, any>;
    reporting_attributes_json?: Record<string, any>;
    active: boolean;
    created_at: string;
    updated_at: string;
}

export interface PodSku {
    id: string;
    code: string;
    name: string;
    family?: string;
    active: boolean;
    active_variant_count?: number;
    variants?: PodSkuVariant[];
    created_at: string;
    updated_at: string;
}

export interface Customer {
    id: string;
    name: string;
    code: string;
    gst_no: string;
    billing_address: string;
    shipping_address: string;
    contact_person: string;
    phone: string;
    email: string;
    credit_days: number;
    credit_limit: number;
    status: string;
}

export interface Vendor {
    id: string;
    name: string;
    code: string;
    type: string;
    gst_no: string;
    address: string;
    payment_terms: string;
    lead_time_days: number;
    status: string;
}

export interface Location {
    id: string;
    code: string;
    name: string;
    type: string;
    plant: string;
}

// Services
export const masterDataService = {
    // Granules
    getGranules: async () => {
        const { data } = await api.get<Material[]>("/api/master/granules/");
        return data;
    },
    createGranule: async (data: { code: string; name: string }) => {
        const { data: res } = await api.post<Material>("/api/master/granules/", data);
        return res;
    },
    updateGranule: async (id: string, data: { code: string; name: string }) => {
        const { data: res } = await api.put<Material>(`/api/master/granules/${id}/`, data);
        return res;
    },
    deleteGranule: async (id: string) => {
        await api.delete(`/api/master/granules/${id}/`);
    },

    // Inks
    getInks: async () => {
        const { data } = await api.get<Material[]>("/api/master/inks/");
        return data;
    },
    createInk: async (data: { base_type: 'POLY' | 'PET'; color_name: string; name?: string }) => {
        const { data: res } = await api.post<Material>("/api/master/inks/", data);
        return res;
    },
    updateInk: async (id: string, data: { base_type?: 'POLY' | 'PET'; color_name?: string; name?: string }) => {
        const { data: res } = await api.put<Material>(`/api/master/inks/${id}/`, data);
        return res;
    },
    deleteInk: async (id: string) => {
        await api.delete(`/api/master/inks/${id}/`);
    },

    // Adhesives & Solvents
    getAdhesivesSolvents: async (category?: 'ADHESIVE' | 'SOLVENT') => {
        const params = category ? { category } : {};
        const { data } = await api.get<Material[]>("/api/master/adhesives-solvents/", { params });
        return data;
    },
    createAdhesiveSolvent: async (data: { code: string; name: string; category: 'ADHESIVE' | 'SOLVENT' }) => {
        const { data: res } = await api.post<Material>("/api/master/adhesives-solvents/", data);
        return res;
    },
    updateAdhesiveSolvent: async (id: string, data: { code: string; name: string; category: 'ADHESIVE' | 'SOLVENT' }) => {
        const { data: res } = await api.put<Material>(`/api/master/adhesives-solvents/${id}/`, data);
        return res;
    },
    deleteAdhesiveSolvent: async (id: string) => {
        await api.delete(`/api/master/adhesives-solvents/${id}/`);
    },

    // Addons
    getAddons: async () => {
        const { data } = await api.get<MaybePaginated<Addon>>("/api/master/addons/");
        return unwrapList<Addon>(data);
    },
    createAddon: async (data: { code: string; name: string; weight_mode: string; weight_value: number }) => {
        const { data: res } = await api.post<Addon>("/api/master/addons/", data);
        return res;
    },
    updateAddon: async (id: string, data: { code: string; name: string; weight_mode: string; weight_value: number }) => {
        const { data: res } = await api.put<Addon>(`/api/master/addons/${id}/`, data);
        return res;
    },
    // Film Families
    getFilmFamilies: async () => {
        const { data } = await api.get<MaybePaginated<Material>>("/api/master/film-families/");
        return unwrapList<Material>(data);
    },
    // Film Variants
    getFilmVariants: async () => {
        const { data } = await api.get<MaybePaginated<Material>>("/api/master/film-variants/");
        return unwrapList<Material>(data);
    },

    deleteAddon: async (id: string) => {
        await api.delete(`/api/master/addons/${id}/`);
    },

    // Packaging
    getPackaging: async () => {
        const { data } = await api.get<MaybePaginated<PackagingMaterial>>("/api/master/packaging/");
        return unwrapList<PackagingMaterial>(data);
    },
    createPackaging: async (payload: Partial<PackagingMaterial>) => {
        const { data } = await api.post<PackagingMaterial>("/api/master/packaging/", payload);
        return data;
    },
    updatePackaging: async (id: string, payload: Partial<PackagingMaterial>) => {
        const { data } = await api.patch<PackagingMaterial>(`/api/master/packaging/${id}/`, payload);
        return data;
    },
    deletePackaging: async (id: string) => {
        await api.delete(`/api/master/packaging/${id}/`);
    },

    // Customers
    getCustomers: async () => {
        const { data } = await api.get<MaybePaginated<Customer>>("/api/sales/customers/");
        return unwrapList<Customer>(data);
    },
    createCustomer: async (data: Partial<Customer>) => {
        const { data: res } = await api.post<Customer>("/api/sales/customers/", data);
        return res;
    },
    updateCustomer: async (id: string, data: Partial<Customer>) => {
        const { data: res } = await api.put<Customer>(`/api/sales/customers/${id}/`, data);
        return res;
    },
    deleteCustomer: async (id: string) => {
        await api.delete(`/api/sales/customers/${id}/`);
    },
    // POD Materials
    getPODMaterials: async () => {
        const { data } = await api.get<Material[]>("/api/master/pod/");
        return data;
    },
    createPODMaterial: async (data: {
        code: string;
        name: string;
        pod_type: "SINGLE" | "DOUBLE";
        pod_fixed_height_mm: number;
        pod_thickness_micron: number;
        pod_panel_count: number;
        pod_is_inhouse_produced?: boolean;
        density_gcm3: number;
        status?: "ACTIVE" | "INACTIVE";
    }) => {
        const { data: res } = await api.post<Material>("/api/master/pod/", data);
        return res;
    },
    updatePODMaterial: async (id: string, data: Partial<{
        code: string;
        name: string;
        pod_type: "SINGLE" | "DOUBLE";
        pod_fixed_height_mm: number;
        pod_thickness_micron: number;
        pod_panel_count: number;
        pod_is_inhouse_produced: boolean;
        density_gcm3: number;
        status: "ACTIVE" | "INACTIVE";
    }>) => {
        const { data: res } = await api.put<Material>(`/api/master/pod/${id}/`, data);
        return res;
    },
    deletePODMaterial: async (id: string) => {
        await api.delete(`/api/master/pod/${id}/`);
    },
    getPodSkus: async () => {
        const { data } = await api.get<MaybePaginated<PodSku>>("/api/master/pod-skus/");
        return unwrapList<PodSku>(data);
    },
    createPodSku: async (payload: Partial<PodSku>) => {
        const { data } = await api.post<PodSku>("/api/master/pod-skus/", payload);
        return data;
    },
    updatePodSku: async (id: string, payload: Partial<PodSku>) => {
        const { data } = await api.patch<PodSku>(`/api/master/pod-skus/${id}/`, payload);
        return data;
    },
    deletePodSku: async (id: string) => {
        await api.delete(`/api/master/pod-skus/${id}/`);
    },
    getPodSkuVariants: async (params?: { pod_sku?: string; active?: boolean; material?: string }) => {
        const { data } = await api.get<MaybePaginated<PodSkuVariant>>("/api/master/pod-sku-variants/", { params });
        return unwrapList<PodSkuVariant>(data);
    },
    createPodSkuVariant: async (payload: Partial<PodSkuVariant>) => {
        const { data } = await api.post<PodSkuVariant>("/api/master/pod-sku-variants/", payload);
        return data;
    },
    updatePodSkuVariant: async (id: string, payload: Partial<PodSkuVariant>) => {
        const { data } = await api.patch<PodSkuVariant>(`/api/master/pod-sku-variants/${id}/`, payload);
        return data;
    },
    deletePodSkuVariant: async (id: string) => {
        await api.delete(`/api/master/pod-sku-variants/${id}/`);
    },

    // Vendors
    getVendors: async () => {
        const { data } = await api.get<Vendor[]>("/api/inventory/vendors/");
        return data;
    },
    createVendor: async (data: Partial<Vendor>) => {
        const { data: res } = await api.post<Vendor>("/api/inventory/vendors/", data);
        return res;
    },
    updateVendor: async (id: string, data: Partial<Vendor>) => {
        const { data: res } = await api.put<Vendor>(`/api/inventory/vendors/${id}/`, data);
        return res;
    },
    deleteVendor: async (id: string) => {
        await api.delete(`/api/inventory/vendors/${id}/`);
    },

    // Locations
    getLocations: async (type?: string) => {
        const params = type ? { type } : {};
        const { data } = await api.get<Location[]>("/api/inventory/locations/", { params });
        return data;
    },
    // Unified Library
    getLibrary: async (params?: any) => {
        const { data } = await api.get<Material[]>("/api/master/library/", { params });
        return data;
    },
};
