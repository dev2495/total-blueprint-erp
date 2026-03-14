import { api } from "@/lib/api";

export interface OperatorJob {
    id: string;
    job_number: string;
    product_name: string;
    process_name: string;
    job_state: 'RELEASED' | 'WAITING' | 'EXECUTING' | 'PAUSED' | 'COMPLETED';
    priority: number;
    planned_date: string;
    quantity: number;
    uom: string;
    // Relationships
    work_center?: { id: string; name: string };
    machine?: { id: string; name: string };
    sales_order_no: string;
    customer_name: string;
    // Execution Data
    start_date?: string;
    assignment?: {
        status: string;
        assigned_rolls: any[];
    }
}

export const operatorService = {
    getDashboard: async (workCenterId?: string, machineId?: string) => {
        const params: any = {};
        if (workCenterId) params.work_center_id = workCenterId;
        if (machineId) params.machine_id = machineId;

        const { data } = await api.get<OperatorJob[]>("/api/production/operator/dashboard/", { params });
        return data;
    },

    startJob: async (id: string) => {
        const { data } = await api.post(`/api/production/operator/${id}/start/`);
        return data;
    },

    pauseJob: async (id: string, reason: string) => {
        const { data } = await api.post(`/api/production/operator/${id}/pause/`, { reason });
        return data;
    },

    resumeJob: async (id: string) => {
        const { data } = await api.post(`/api/production/operator/${id}/resume/`);
        return data;
    },

    logOutput: async (id: string, quantity: number) => {
        const { data } = await api.post(`/api/production/operator/${id}/log-output/`, { quantity });
        return data;
    },

    logScrap: async (id: string, quantity: number, reason: string, notes?: string) => {
        const { data } = await api.post(`/api/production/operator/${id}/log-scrap/`, { quantity, reason, notes });
        return data;
    },

    logDowntime: async (id: string, startTime: string, endTime: string | null, reason: string) => {
        const { data } = await api.post(`/api/production/operator/${id}/log-downtime/`, { start_time: startTime, end_time: endTime, reason });
        return data;
    },

    completeSession: async (id: string, payload: { actual_qty: number; scrap_qty?: number; output_width_mm?: number; output_length_m?: number; split_outputs?: any[] }) => {
        const { data } = await api.post(`/api/production/operator/${id}/complete-session/`, payload);
        return data;
    },

    completeJob: async (id: string) => {
        const { data } = await api.post(`/api/production/operator/${id}/complete/`);
        return data;
    }
};
