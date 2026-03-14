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
}

export interface CreateExtrusionRecipeDto {
    film_variant: string;
    grade: string;
    thickness_min_micron: number;
    thickness_max_micron: number;
    components: { granule: string; percentage: number }[];
}

export const recipeService = {
    getGrades: async (variant_id?: string) => {
        const params = variant_id ? { variant_id } : {};
        const response = await api.get<RecipeGrade[]>("/api/recipes/grades/", { params });
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
    getAll: async () => {
        const response = await api.get<ExtrusionRecipe[]>("/api/recipes/recipes/");
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
    delete: async (id: string) => {
        await api.delete(`/api/recipes/recipes/${id}/`);
    },
};
