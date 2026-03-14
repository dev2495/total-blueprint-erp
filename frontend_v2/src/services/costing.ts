import { api } from "@/lib/api";

export interface ProcessCostRate {
    id: string;
    process: string;
    process_name: string;
    process_code: string;
    machine: string | null;
    machine_name: string | null;
    machine_code: string | null;
    cost_per_hour: string;
    power_cost_per_hour: string;
    labor_cost_per_hour: string;
    overhead_cost_per_hour: string;
    is_active: boolean;
}

export interface OrderCost {
    id: string;
    sales_order_item: string;
    order_number: string;
    customer_name: string;
    product_name: string;
    material_cost: string;
    conversion_cost: string;
    total_cost: string;
    selling_price: string;
    margin_value: string;
    margin_percent: string;
    is_frozen: boolean;
    created_at: string;
}

export interface MonthlyOverhead {
    id: string;
    year: number;
    month: number;
    electricity_cost: string;
    labor_cost: string;
    other_overheads: string;
    created_at: string;
    updated_at: string;
}

export const costingService = {
    // Process Rates
    getProcessRates: async (): Promise<ProcessCostRate[]> => {
        const { data } = await api.get('/api/costing/process-rates/');
        return data;
    },
    updateProcessRate: async (id: string, payload: Partial<ProcessCostRate>): Promise<ProcessCostRate> => {
        const { data } = await api.patch(`/api/costing/process-rates/${id}/`, payload);
        return data;
    },
    createProcessRate: async (payload: Partial<ProcessCostRate>): Promise<ProcessCostRate> => {
        const { data } = await api.post('/api/costing/process-rates/', payload);
        return data;
    },

    // Order Costing
    getOrderCosts: async (): Promise<OrderCost[]> => {
        const { data } = await api.get('/api/costing/order-costs/');
        return data;
    },
    getDashboardStats: async (): Promise<any> => {
        const { data } = await api.get('/api/costing/order-costs/dashboard-stats/');
        return data;
    },
    calculateOrderItemCost: async (itemId: string): Promise<OrderCost> => {
        const { data } = await api.post(`/api/costing/order-costs/calculate-item/${itemId}/`);
        return data;
    },

    // Monthly Overheads
    getMonthlyOverheads: async (): Promise<MonthlyOverhead[]> => {
        const { data } = await api.get('/api/costing/monthly-overheads/');
        return data;
    },
    createMonthlyOverhead: async (payload: Partial<MonthlyOverhead>): Promise<MonthlyOverhead> => {
        const { data } = await api.post('/api/costing/monthly-overheads/', payload);
        return data;
    },
    updateMonthlyOverhead: async (id: string, payload: Partial<MonthlyOverhead>): Promise<MonthlyOverhead> => {
        const { data } = await api.patch(`/api/costing/monthly-overheads/${id}/`, payload);
        return data;
    }
};
