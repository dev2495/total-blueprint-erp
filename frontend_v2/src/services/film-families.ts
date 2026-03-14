import { api } from "@/lib/api";

export interface FilmFamily {
    id: string; // or number, keeping it flexible but usually ID from standard django is number or uuid.
    name: string;
    density_gcm3: number; // Density is critical
    commercial_family?: string | null;
    commercial_family_name?: string | null;
}

export interface CreateFilmFamilyDto {
    name: string;
    density_gcm3: number;
    commercial_family?: string | null;
}

export const filmFamilyService = {
    getAll: async () => {
        const response = await api.get<FilmFamily[]>("/api/master/film-families/");
        return response.data;
    },
    create: async (data: CreateFilmFamilyDto) => {
        const response = await api.post<FilmFamily>("/api/master/film-families/", data);
        return response.data;
    },
    update: async (id: string | number, data: CreateFilmFamilyDto) => {
        const response = await api.put<FilmFamily>(`/api/master/film-families/${id}/`, data);
        return response.data;
    },
    delete: async (id: string | number) => {
        await api.delete(`/api/master/film-families/${id}/`);
    },
};
