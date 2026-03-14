import { api } from "@/lib/api";

export interface FilmVariant {
    id: string;
    code: string;
    name: string;
    parent_family: string;
    parent_family_name: string;
    grade?: string | null;
    grade_name?: string | null;
    commercial_family?: string | null;
    commercial_family_name?: string | null;
    is_extrudable: boolean;
    is_purchasable: boolean;
    status: string;
    density_gcm3?: number;
}

export interface CreateFilmVariantDto {
    code: string;
    name: string;
    parent_family: string;
    grade?: string | null;
    commercial_family?: string | null;
    is_extrudable: boolean;
    is_purchasable: boolean;
}

export const filmVariantService = {
    getAll: async () => {
        const response = await api.get<FilmVariant[]>("/api/master/film-variants/");
        return response.data;
    },
    create: async (data: CreateFilmVariantDto) => {
        const response = await api.post<FilmVariant>("/api/master/film-variants/", data);
        return response.data;
    },
    update: async (id: string, data: CreateFilmVariantDto) => {
        const response = await api.put<FilmVariant>(`/api/master/film-variants/${id}/`, data);
        return response.data;
    },
    delete: async (id: string) => {
        await api.delete(`/api/master/film-variants/${id}/`);
    },
};
