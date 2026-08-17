import { api } from "@/lib/api";

export interface RecipeGrade {
    id: string;
    name: string;
}

export interface ExtrusionRecipeComponent {
    id: string; // optional for new
    granule: string; // ID
    granule_name: string;
    percentage: number;
}

export interface RecipeImpact {
    matched_total: number;
    refreshable: number;
    frozen: number;
    released: number;
    in_production: number;
    closed: number;
    without_queue: number;
    samples: Array<{
        order_number: string;
        line_id: string;
        order_status: string;
        line_status: string;
        outcome: "REFRESHABLE" | "FROZEN";
        reason: string;
    }>;
}

export interface RecipeRevisionSummary {
    revision_no: number;
    event: "CREATE" | "BASELINE" | "UPDATE" | "DISABLE" | "ENABLE";
    change_reason: string;
    changed_by: string;
    created_at: string;
    impact?: Record<string, unknown>;
}

export interface ExtrusionRecipe {
    id: string;
    film_variant: string;
    film_variant_name: string;
    grade: string;
    grade_name: string;
    thickness_min_micron: number;
    thickness_max_micron: number;
    components: ExtrusionRecipeComponent[];
    is_active: boolean;
    created_at: string;
    updated_at: string;
    revision_no: number;
    recent_revisions: RecipeRevisionSummary[];
    bom_refresh?: {
        matched_items: number;
        checked: number;
        refreshed: number;
        failed: number;
        skipped: number;
        queues_rebuilt: number;
        queues_frozen: number;
        queues_planning_required: number;
        still_blocked: number;
        matched_total?: number;
        historical_frozen?: number;
    } | null;
}

export interface CreateExtrusionRecipeDto {
    film_variant: string;
    grade: string;
    thickness_min_micron: number;
    thickness_max_micron: number;
    components: { granule: string; percentage: number }[];
    change_reason?: string;
}

export const recipeService = {
    getGrades: async (_variant_id?: string) => {
        // Grade master is intentionally global. Recipe matching is resolved later
        // with variant + selected grade + thickness.
        const response = await api.get<RecipeGrade[]>("/api/recipes/grades/");
        return response.data;
    },
    createGrade: async (data: { name: string }) => {
        const response = await api.post<RecipeGrade>("/api/recipes/grades/", data);
        return response.data;
    },
    updateGrade: async (id: string, data: { name: string }) => {
        const response = await api.put<RecipeGrade>(`/api/recipes/grades/${id}/`, data);
        return response.data;
    },
    deleteGrade: async (id: string) => {
        await api.delete(`/api/recipes/grades/${id}/`);
    },
    getAll: async (params?: any) => {
        const requestParams = params && typeof params === "object" && !("queryKey" in params) && !("signal" in params) ? params : undefined;
        const response = await api.get<ExtrusionRecipe[]>("/api/recipes/recipes/", { params: requestParams });
        return response.data;
    },
    create: async (data: CreateExtrusionRecipeDto) => {
        const response = await api.post<ExtrusionRecipe>("/api/recipes/recipes/", data);
        return response.data;
    },
    update: async (id: string, data: CreateExtrusionRecipeDto) => {
        const response = await api.put<ExtrusionRecipe>(`/api/recipes/recipes/${id}/`, data);
        return response.data;
    },
    impact: async (id: string, data: Partial<CreateExtrusionRecipeDto>) => {
        const response = await api.post<RecipeImpact>(`/api/recipes/recipes/${id}/impact/`, data);
        return response.data;
    },
    disable: async (id: string, changeReason: string) => {
        const response = await api.post<ExtrusionRecipe>(`/api/recipes/recipes/${id}/disable/`, {
            change_reason: changeReason,
        });
        return response.data;
    },
    delete: async (id: string) => {
        await api.delete(`/api/recipes/recipes/${id}/`);
    },
};
