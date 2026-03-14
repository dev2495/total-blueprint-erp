import { api } from "@/lib/api";

export interface RoutingRule {
    id: string;
    name: string;
    description: string;
    ordered_processes: string[]; // List of process codes
    allowed_workcenters: string[]; // List of WC IDs
    interplant_required: boolean;
    is_active: boolean;
}

export const routingService = {
    getRules: async () => {
        const response = await api.get<RoutingRule[]>("/api/routing/rules/");
        return response.data;
    },
    createRule: async (data: Partial<RoutingRule>) => {
        const response = await api.post<RoutingRule>("/api/routing/rules/", data);
        return response.data;
    },
    updateRule: async (id: string, data: Partial<RoutingRule>) => {
        const response = await api.put<RoutingRule>(`/api/routing/rules/${id}/`, data);
        return response.data;
    },
    deleteRule: async (id: string) => {
        await api.delete(`/api/routing/rules/${id}/`);
    },
};
