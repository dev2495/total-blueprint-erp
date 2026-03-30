import { api } from "@/lib/api";

export interface CostAbsorptionGroup {
  id: string;
  code: string;
  label: string;
  description: string;
  default_intensity_factor: string;
  is_active: boolean;
}

export interface PlantCostPoolLine {
  id: string;
  month_record: string;
  cost_group: string;
  cost_group_code: string;
  cost_group_label: string;
  entry_mode: "DIRECT" | "ALLOCATED";
  allocation_percent: string;
  electricity_cost: string;
  labor_cost: string;
  overhead_cost: string;
  maintenance_cost: string;
  service_burden_cost: string;
  pool_total: string;
}

export interface PlantCostPoolMonth {
  id: string;
  plant: string;
  plant_name: string;
  plant_code: string;
  year: number;
  month: number;
  entry_mode: "DIRECT" | "ALLOCATED";
  status: "DRAFT" | "REVIEWED" | "LOCKED";
  plant_total_electricity: string;
  plant_total_labor: string;
  plant_total_overhead: string;
  plant_total_maintenance: string;
  plant_total_service_burden: string;
  notes: string;
  lines: PlantCostPoolLine[];
}

export interface OrderCost {
  id: string;
  sales_order_item: string;
  order_number: string;
  customer_name: string;
  product_name: string;
  sku_code?: string | null;
  material_cost: string;
  conversion_cost: string;
  overhead_cost_absorbed: string;
  total_cost: string;
  material_cost_actual: string;
  conversion_cost_actual: string;
  selling_price: string;
  contribution_margin: string;
  contribution_margin_percent: string;
  absorbed_margin: string;
  absorbed_margin_percent: string;
  margin_value: string;
  margin_percent: string;
  costing_mode: "ACTUAL" | "HYBRID" | "ESTIMATED";
  actual_cost_coverage_pct: string;
  coverage_flags: string[];
  is_frozen: boolean;
  created_at: string;
}

export interface CostingDashboardSummary {
  hero: {
    title: string;
    month_label: string;
    status: string;
    entry_mode?: string;
  };
  kpis: {
    cost_group_count: number;
    locked_months: number;
    unabsorbed_pool_value: number;
    avg_actual_cost_coverage_pct: number;
  };
  exceptions: Array<{
    sales_order_item__sales_order__order_number: string;
    costing_mode: string;
    coverage_flags: string[];
  }>;
  line_count?: number;
  pool_total?: number;
}

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

export const costingService = {
  getCostGroups: async (): Promise<CostAbsorptionGroup[]> => {
    const { data } = await api.get("/api/costing/cost-groups/");
    return Array.isArray(data) ? data : data.results || [];
  },

  createCostGroup: async (payload: Partial<CostAbsorptionGroup>): Promise<CostAbsorptionGroup> => {
    const { data } = await api.post("/api/costing/cost-groups/", payload);
    return data;
  },

  updateCostGroup: async (id: string, payload: Partial<CostAbsorptionGroup>): Promise<CostAbsorptionGroup> => {
    const { data } = await api.patch(`/api/costing/cost-groups/${id}/`, payload);
    return data;
  },

  deleteCostGroup: async (id: string): Promise<void> => {
    await api.delete(`/api/costing/cost-groups/${id}/`);
  },

  getPlantPoolMonths: async (): Promise<PlantCostPoolMonth[]> => {
    const { data } = await api.get("/api/costing/plant-pool-months/");
    return Array.isArray(data) ? data : data.results || [];
  },

  createPlantPoolMonth: async (payload: Partial<PlantCostPoolMonth>): Promise<PlantCostPoolMonth> => {
    const { data } = await api.post("/api/costing/plant-pool-months/", payload);
    return data;
  },

  updatePlantPoolMonth: async (id: string, payload: Partial<PlantCostPoolMonth>): Promise<PlantCostPoolMonth> => {
    const { data } = await api.patch(`/api/costing/plant-pool-months/${id}/`, payload);
    return data;
  },

  allocateMonthFromTotals: async (id: string, percentages: Record<string, number | string>) => {
    const { data } = await api.post(`/api/costing/plant-pool-months/${id}/allocate-from-totals/`, { percentages });
    return data as PlantCostPoolMonth;
  },

  createPlantPoolLine: async (payload: Partial<PlantCostPoolLine>): Promise<PlantCostPoolLine> => {
    const { data } = await api.post("/api/costing/plant-pool-lines/", payload);
    return data;
  },

  updatePlantPoolLine: async (id: string, payload: Partial<PlantCostPoolLine>): Promise<PlantCostPoolLine> => {
    const { data } = await api.patch(`/api/costing/plant-pool-lines/${id}/`, payload);
    return data;
  },

  reviewMonth: async (id: string) => {
    const { data } = await api.post(`/api/costing/plant-pool-months/${id}/review/`);
    return data;
  },

  lockMonth: async (id: string) => {
    const { data } = await api.post(`/api/costing/plant-pool-months/${id}/lock/`);
    return data;
  },

  getDashboardSummary: async (): Promise<CostingDashboardSummary> => {
    const { data } = await api.get("/api/costing/plant-pool-months/dashboard-summary/");
    return data;
  },

  getOrderCosts: async (): Promise<OrderCost[]> => {
    const { data } = await api.get("/api/costing/order-costs/");
    return Array.isArray(data) ? data : data.results || [];
  },

  getOrderDashboardStats: async (): Promise<any> => {
    const { data } = await api.get("/api/costing/order-costs/dashboard-stats/");
    return data;
  },

  calculateOrderItemCost: async (itemId: string): Promise<OrderCost> => {
    const { data } = await api.post(`/api/costing/order-costs/calculate-item/${itemId}/`);
    return data;
  },

  getProcessRates: async (): Promise<ProcessCostRate[]> => {
    const { data } = await api.get("/api/costing/process-rates/");
    return Array.isArray(data) ? data : data.results || [];
  },

  updateProcessRate: async (id: string, payload: Partial<ProcessCostRate>): Promise<ProcessCostRate> => {
    const { data } = await api.patch(`/api/costing/process-rates/${id}/`, payload);
    return data;
  },

  createProcessRate: async (payload: Partial<ProcessCostRate>): Promise<ProcessCostRate> => {
    const { data } = await api.post("/api/costing/process-rates/", payload);
    return data;
  },
};
