import { api } from "@/lib/api";

export function normalizeMediaUrl(url?: string | null) {
    const raw = String(url || "").trim();
    if (!raw) return null;
    return raw;
}

export function isPdfMediaUrl(url?: string | null, mimeType?: string | null) {
    const type = String(mimeType || "").toLowerCase();
    if (type.includes("pdf")) return true;
    const raw = String(url || "").split("?")[0].toLowerCase();
    return raw.endsWith(".pdf");
}

export function artworkImageUrls(artwork?: Pick<Artwork, "primary_image" | "image" | "images"> | null) {
    if (!artwork) return [];
    const urls = [
        artwork.primary_image,
        artwork.image,
        ...(Array.isArray(artwork.images) ? artwork.images.map((row) => row?.image) : []),
    ]
        .map((url) => normalizeMediaUrl(url))
        .filter((url): url is string => Boolean(url));
    return Array.from(new Set(urls)).slice(0, 3);
}

// --- Types ---
export interface Artwork {
    id: string;
    design_code: string;
    name: string;
    print_type?: "FLEXO" | "ROTO" | "DIGITAL";
    substrate_mode?: "SHEET" | "TUBING";
    product_master?: string | null;
    product_master_code?: string | null;
    product_master_name?: string | null;
    design_family_code?: string;
    colorway_name?: string;
    color_list: string[]; // List of color names (visual)
    front_colors_count?: number;
    back_colors_count?: number;
    front_colors?: string[];
    back_colors?: string[];
    color_mapping?: Record<string, string | { POLY?: string; PET?: string }>;
    ink_swatch_mapping?: Record<string, InkSwatchInfo | Record<string, InkSwatchInfo | null> | null>;
    ink_gsm_total?: number;
    ink_gsm_split_mode?: "EQUAL" | "PERCENT";
    ink_gsm_color_percentages?: Record<string, number>;
    ink_gsm_by_color?: Record<string, number>;
    cylinder_circumference_mm?: number;
    cylinder_length_mm?: number;
    total_side_colors?: number;
    cylinder_ready?: boolean;
    colors_count: number;
    file_path: string;
    image?: string | null; // URL to uploaded image
    primary_image?: string | null;
    images?: Array<{ id: string; image: string | null; sort_order: number; created_at?: string }>;
    version: number;
    previous_version?: string | null;
    is_current_version?: boolean;
    status: 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
    created_at: string;
}

export interface InkSwatchInfo {
    id: string;
    code?: string;
    name?: string;
    base_type?: "POLY" | "PET" | string;
    color_name?: string;
    swatch_hex?: string;
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
    vendor_name?: string;

    storage_location?: string | null; // ID
    location_name?: string;

    color_name: string;
    side?: "FRONT" | "BACK";
    side_slot_index?: number;
    is_draft?: boolean;
    is_catalog_active?: boolean;
    lifecycle_status?: string;
    cost: number;
    life_cycles_count: number;
    usage_count_linear_meters: number;

    status: "ACTIVE" | "MAINTENANCE" | "RE_CHROME" | "SCRAP";
    created_at: string;
}

export interface CylinderSlotAssignment {
    id: string;
    artwork: string;
    artwork_name?: string;
    artwork_design_code?: string;
    cylinder: string;
    cylinder_code?: string;
    cylinder_name?: string;
    cylinder_artwork_name?: string;
    cylinder_artwork_design_code?: string;
    cylinder_circumference?: number;
    cylinder_width_mm?: number;
    cylinder_diameter_mm?: number;
    cylinder_cell_depth_microns?: number;
    cylinder_engraving_vendor?: string | null;
    cylinder_vendor_name?: string | null;
    cylinder_storage_location?: string | null;
    cylinder_location_name?: string | null;
    cylinder_lifecycle_status?: string;
    cylinder_is_draft?: boolean;
    cylinder_status?: string;
    side: "FRONT" | "BACK";
    side_slot_index: number;
    color_name?: string;
    created_at?: string;
    updated_at?: string;
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
        substrate_mode?: string;
        film_type?: string;
        front_colors_count?: number;
        back_colors_count?: number;
        cylinder_ready?: boolean | string;
        exclude_cylinder_artwork?: boolean | string;
        product_master?: string;
        product_master_id?: string;
    }) => {
        const { data } = await api.get<Artwork[]>("/api/engineering/artworks/", { params });
        return data;
    },
    createArtwork: async (data: any) => {
        const { data: res } = await api.post<Artwork>("/api/engineering/artworks/", data);
        return res;
    },
    updateArtwork: async (id: string, data: any) => {
        const { data: res } = await api.patch<Artwork>(`/api/engineering/artworks/${id}/`, data);
        return res;
    },
    approveArtwork: async (id: string) => {
        const { data: res } = await api.post<Artwork>(`/api/engineering/artworks/${id}/approve/`);
        return res;
    },
    generateArtworkCylinders: async (id: string, payload?: { side?: "FRONT" | "BACK"; slot?: number; targets?: Array<{ side: "FRONT" | "BACK"; slot: number }>; circumference?: number; cylinder_circumference_mm?: number; length_mm?: number; width_mm?: number; cylinder_length_mm?: number; engraving_vendor?: string; storage_location?: string; status?: string }) => {
        const { data: res } = await api.post(`/api/engineering/artworks/${id}/generate-cylinders/`, payload || {});
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
    getCylinderSlotAssignments: async (params?: any) => {
        const { data } = await api.get<CylinderSlotAssignment[]>("/api/tooling/cylinder-slot-assignments/", { params });
        return data;
    },
    assignCylinderSlot: async (data: { artwork: string; cylinder: string; side: "FRONT" | "BACK"; side_slot_index: number }) => {
        const { data: res } = await api.post<CylinderSlotAssignment>("/api/tooling/cylinder-slot-assignments/", data);
        return res;
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
