import { api } from "@/lib/api";

export interface CommercialFamily {
    id: string;
    code: string;
    name: string;
    default_form: "ROLL" | "POUCH";
    default_reporting_group: "FILM" | "PRINTED" | "LAMINATED" | "SEMI_FG" | "FG" | "PACKAGING" | "OTHER";
    active: boolean;
    created_at?: string;
    updated_at?: string;
}

export interface CommercialFamilyInput {
    code: string;
    name: string;
    default_form: "ROLL" | "POUCH";
    default_reporting_group: "FILM" | "PRINTED" | "LAMINATED" | "SEMI_FG" | "FG" | "PACKAGING" | "OTHER";
    active: boolean;
}

export const commercialFamilyService = {
    getAll: async () => {
        const response = await api.get<CommercialFamily[]>("/api/master/commercial-families/");
        return response.data;
    },
    create: async (data: CommercialFamilyInput) => {
        const response = await api.post<CommercialFamily>("/api/master/commercial-families/", data);
        return response.data;
    },
    update: async (id: string, data: CommercialFamilyInput) => {
        const response = await api.put<CommercialFamily>(`/api/master/commercial-families/${id}/`, data);
        return response.data;
    },
    delete: async (id: string) => {
        await api.delete(`/api/master/commercial-families/${id}/`);
    },
};

