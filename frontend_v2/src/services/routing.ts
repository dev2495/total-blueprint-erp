import { api } from "@/lib/api";

export interface RoutingRule {
    id: string;
    name: string;
    description: string;
    ordered_processes: string[]; // List of process codes
    route_graph?: RouteGraph | null;
    allowed_workcenters: string[]; // List of WC IDs
    interplant_required: boolean;
    is_active: boolean;
}

export interface RouteGraphNode {
    id: string;
    label?: string;
    process_code: string;
    route_index: number;
    branch_key?: string;
    join_key?: string;
    parallel_group?: string;
    predecessor_node_ids?: string[];
    matching_rule?: Record<string, any>;
}

export interface RouteGraphEdge {
    from: string;
    to: string;
}

export interface RouteGraph {
    nodes?: RouteGraphNode[];
    edges?: RouteGraphEdge[];
}

export const routingService = {
    getRules: async (params?: { include_inactive?: string | boolean }) => {
        const response = await api.get<RoutingRule[]>("/api/routing/rules/", { params });
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
    disableRule: async (id: string) => {
        const response = await api.post<RoutingRule>(`/api/routing/rules/${id}/disable/`);
        return response.data;
    },
};
