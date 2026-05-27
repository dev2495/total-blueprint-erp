import { api } from "@/lib/api";

export interface MRPPlan {
    id: string;
    plant: string | null;
    plant_name: string | null;
    status: 'DRAFT' | 'RUNNING' | 'COMPLETED' | 'FAILED';
    total_demand_kg: string;
    total_available_kg: string;
    total_wip_kg: string;
    total_shortage_kg: string;
    purchase_value_est: string;
    created_by_name: string;
    created_at: string;
    updated_at: string;
    requirements?: MRPRequirement[];
    suggestions?: MRPSuggestion[];
}

export interface MRPRequirement {
    id: string;
    material: string;
    material_details: {
        code: string;
        name: string;
        category: string;
        cost_snapshots?: { avg_rate_per_kg: string }[];
    };
    required_qty_kg: string;
    available_qty_kg: string;
    shortage_qty_kg: string;
    source_type: string;
    source_ref: string;
}

export interface MRPSuggestion {
    id: string;
    type: 'PURCHASE' | 'MTS_PRODUCE' | 'TRANSFER';
    action?: 'PURCHASE' | 'PRODUCE' | 'TRANSFER' | string;
    material: string;
    material_details: {
        code: string;
        name: string;
        category: string;
        cost_snapshots?: { avg_rate_per_kg: string }[];
    };
    qty: string;
    quantity?: string | number;
    unit?: string;
    material_name?: string;
    material_code?: string;
    reason: string;
    required_date?: string | null;
    priority?: string;
    action_status?: string;
    draft_ref?: string;
    source_plant: string | null;
    target_plant: string | null;
}

export interface MRPDraftActionResponse extends MRPSuggestion {
    suggestion_id?: string;
    action_status: string;
    draft_ref: string;
    action: string;
    po_id?: string;
}

export const mrpService = {
    getPlans: async (): Promise<MRPPlan[]> => {
        const { data } = await api.get('/api/mrp/plans/');
        return data;
    },
    getPlanDetail: async (id: string): Promise<MRPPlan> => {
        const { data } = await api.get(`/api/mrp/plans/${id}/`);
        return data;
    },
    getLatestPlan: async (): Promise<MRPPlan> => {
        const { data } = await api.get('/api/mrp/plans/latest/');
        return data;
    },
    runMRP: async (plantId?: string): Promise<MRPPlan> => {
        const { data } = await api.post('/api/mrp/plans/run/', { plant_id: plantId });
        return data;
    },
    getRequirements: async (planId?: string): Promise<MRPRequirement[]> => {
        const url = planId ? `/api/mrp/requirements/?plan=${planId}` : '/api/mrp/requirements/';
        const { data } = await api.get(url);
        return data;
    },
    getSuggestions: async (planId?: string): Promise<MRPSuggestion[]> => {
        const url = planId ? `/api/mrp/suggestions/?plan=${planId}` : '/api/mrp/suggestions/';
        const { data } = await api.get(url);
        return data;
    },
    createDraftPO: async (suggestionId: string): Promise<MRPDraftActionResponse> => {
        const { data } = await api.post(`/api/mrp/suggestions/${suggestionId}/create-draft-po/`);
        return data;
    },
    createDraftJob: async (suggestionId: string): Promise<MRPDraftActionResponse> => {
        const { data } = await api.post(`/api/mrp/suggestions/${suggestionId}/create-draft-job/`);
        return data;
    },
    createDraftTransfer: async (suggestionId: string): Promise<MRPDraftActionResponse> => {
        const { data } = await api.post(`/api/mrp/suggestions/${suggestionId}/create-draft-transfer/`);
        return data;
    },
    bulkDraftPO: async (suggestionIds: string[]): Promise<{ results: MRPDraftActionResponse[]; errors: Array<{ suggestion_id: string; error: string }> }> => {
        const { data } = await api.post(`/api/mrp/suggestions/bulk-draft-po/`, { suggestion_ids: suggestionIds });
        return data;
    },
};
