import { api } from "@/lib/api";

export interface Metric {
    label: string;
    value: number | string;
    unit: string;
    trend?: number; // percentage
}

export interface DashboardStats {
    metrics: Metric[];
    departments?: {
        sales?: any;
        production?: any;
        inventory?: any;
        dispatch?: any;
    };
    recent_orders?: any[];
    recent_activity?: any[];
    running_jobs?: any[];
}

export const dashboardService = {
    getStats: async () => {
        const { data } = await api.get<DashboardStats>("/api/dashboard/stats");
        return data;
    }
};
