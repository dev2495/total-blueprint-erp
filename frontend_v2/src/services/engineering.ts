import { api } from "@/lib/api";

// --- Types ---
export interface Artwork {
    id: string;
    design_code: string;
    name: string;
    print_type?: "FLEXO" | "ROTO" | "DIGITAL";
    color_list: string[]; // List of color names (visual)
    front_colors_count?: number;
    back_colors_count?: number;
    front_colors?: string[];
    back_colors?: string[];
    total_side_colors?: number;
    cylinder_ready?: boolean;
    colors_count: number;
    file_path: string;
    image?: string | null; // URL to uploaded image
    version: number;
    status: 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
    created_at: string;
}

export interface Cylinder {
    id: string;
    code: string;
    name: string;

    diameter_mm: number;
    circumference: number; // Printing Repeat
    width_mm: number;
    cell_depth_microns: number;

    artwork: string | null; // ID
    artwork_name?: string;
    artwork_image?: string | null;

    engraving_vendor?: string | null; // ID
    engraving_vendor_name?: string;

    storage_location?: string | null; // ID
    location_name?: string;

    color_name: string;
    side?: "FRONT" | "BACK";
    side_slot_index?: number;
    is_draft?: boolean;
    lifecycle_status?: string;
    cost: number;
    life_cycles_count: number;
    usage_count_linear_meters: number;

    status: "ACTIVE" | "MAINTENANCE" | "RE_CHROME" | "SCRAP";
    created_at: string;
}

export interface ToolAsset {
    id: string;
    plant: string;
    plant_name?: string;
    asset_type: "ANILOX" | "SLEEVE" | "CUTTING_DIE" | "SEALING_JAW" | "CORE_SHAFT" | "MOUNTING_ADAPTER" | "TOOLING_OTHER";
    code: string;
    name: string;
    status: "READY" | "IN_USE" | "SERVICE_DUE" | "MAINTENANCE" | "RETIRED";
    storage_location?: string | null;
    location_name?: string | null;
    rack_code?: string;
    slot_code?: string;
    vendor?: string | null;
    vendor_name?: string | null;
    service_due_at?: string | null;
    notes?: string;
    meta_json?: Record<string, any>;
    created_at?: string;
    updated_at?: string;
}

// --- Service ---
export const engineeringService = {
    // Artwork
    getArtworks: async (params?: {
        status?: string;
        print_type?: string;
        front_colors_count?: number;
        back_colors_count?: number;
        cylinder_ready?: boolean | string;
        exclude_cylinder_artwork?: boolean | string;
    }) => {
        const { data } = await api.get<Artwork[]>("/api/engineering/artworks/", { params });
        return data;
    },
    createArtwork: async (data: any) => {
        const isFormData = data instanceof FormData;
        const { data: res } = await api.post<Artwork>("/api/engineering/artworks/", data, {
            headers: isFormData ? { 'Content-Type': 'multipart/form-data' } : {}
        });
        return res;
    },
    updateArtwork: async (id: string, data: any) => {
        const isFormData = data instanceof FormData;
        const { data: res } = await api.patch<Artwork>(`/api/engineering/artworks/${id}/`, data, {
            headers: isFormData ? { 'Content-Type': 'multipart/form-data' } : {}
        });
        return res;
    },
    approveArtwork: async (id: string) => {
        const { data: res } = await api.post<Artwork>(`/api/engineering/artworks/${id}/approve/`);
        return res;
    },
    generateArtworkCylinders: async (id: string) => {
        const { data: res } = await api.post(`/api/engineering/artworks/${id}/generate-cylinders/`);
        return res;
    },
    deleteArtwork: async (id: string) => {
        await api.delete(`/api/engineering/artworks/${id}/`);
    },

    // Cylinders
    getCylinders: async (params?: any) => {
        const { data } = await api.get<Cylinder[]>("/api/tooling/cylinders/", { params });
        return data;
    },
    createCylinder: async (data: Partial<Cylinder>) => {
        const { data: res } = await api.post<Cylinder>("/api/tooling/cylinders/", data);
        return res;
    },
    updateCylinder: async (id: string, data: Partial<Cylinder>) => {
        const { data: res } = await api.patch<Cylinder>(`/api/tooling/cylinders/${id}/`, data);
        return res;
    },
    deleteCylinder: async (id: string) => {
        await api.delete(`/api/tooling/cylinders/${id}/`);
    },

    // Tool assets
    getToolAssets: async (params?: any) => {
        const { data } = await api.get<ToolAsset[]>("/api/tooling/assets/", { params });
        return data;
    },
    createToolAsset: async (data: Partial<ToolAsset>) => {
        const { data: res } = await api.post<ToolAsset>("/api/tooling/assets/", data);
        return res;
    },
    updateToolAsset: async (id: string, data: Partial<ToolAsset>) => {
        const { data: res } = await api.patch<ToolAsset>(`/api/tooling/assets/${id}/`, data);
        return res;
    },
    deleteToolAsset: async (id: string) => {
        await api.delete(`/api/tooling/assets/${id}/`);
    },
};
