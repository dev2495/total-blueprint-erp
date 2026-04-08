/**
 * Phase 58: Inventory Observability API Service
 */

import { api } from "@/lib/api";

export interface InventoryHealth {
    bulk: {
        total_kg: number;
        sku_count: number;
    };
    rolls: {
        available_count: number;
        available_kg: number;
        reserved_count: number;
        reserved_kg: number;
        fg_count: number;
        fg_kg: number;
    };
    alerts: {
        total_open: number;
        critical: number;
        high: number;
    };
}

export interface InventoryAlert {
    id: string;
    type: string;
    type_display: string;
    message: string;
    severity: string;
    severity_display: string;
    material?: string;
    material_name?: string;
    material_code?: string;
    roll?: string;
    roll_label?: string;
    plant?: string;
    plant_name?: string;
    expected_value?: number;
    actual_value?: number;
    resolved: boolean;
    resolved_at?: string;
    resolved_by_name?: string;
    resolution_note?: string;
    created_at: string;
}

export interface InventorySnapshot {
    id: string;
    created_at: string;
    plant: string;
    plant_name: string;
    plant_code: string;
    total_bulk_kg: number;
    total_roll_kg: number;
    total_fg_kg: number;
    total_wip_kg: number;
    reserved_roll_kg: number;
    scrap_kg: number;
    bulk_sku_count: number;
    roll_count: number;
    fg_roll_count: number;
}

export interface RollGenealogy {
    roll_id: string;
    trees: GenealogyNode[];
    ancestors: { id: string; label_id: string; stage_index: number; weight_kg: number }[];
    timeline: TimelineEvent[];
}

export interface GenealogyNode {
    id: string;
    label_id: string;
    weight_kg: number;
    original_weight_kg: number;
    status: string;
    stage_index: number;
    stage_name?: string | null;
    material_name?: string | null;
    width_mm?: number | null;
    thickness_micron?: number | null;
    created_at: string;
    job_number?: string;
    location?: string;
    children: GenealogyNode[];
    consumptions: {
        consumed_kg: number;
        output_roll_id?: string;
        job_number?: string;
        timestamp?: string;
    }[];
}

export interface TimelineEvent {
    type: 'MOVEMENT' | 'CONSUMPTION';
    timestamp: string;
    from?: string;
    to?: string;
    reason?: string;
    consumed_kg?: number;
    job?: string;
}

export interface RollTraceResponse {
    query: string;
    matched_by: string | null;
    roll: {
        id: string;
        label_id: string;
        material_name?: string | null;
        material_code?: string | null;
        grade_name?: string | null;
        weight_kg: number;
        original_weight_kg: number;
        width_mm: number;
        thickness_micron: number;
        status: string;
        stage_name?: string | null;
        roll_role?: string | null;
        location_name?: string | null;
        plant_name?: string | null;
        job_number?: string | null;
        created_at?: string | null;
    };
    genealogy: RollGenealogy;
    recent_movements: Array<{
        timestamp?: string | null;
        from_location_name?: string | null;
        to_location_name?: string | null;
        reason?: string | null;
        reason_note?: string | null;
    }>;
}

export const observabilityApi = {
    // Health
    getHealth: async (plantId?: string): Promise<InventoryHealth> => {
        const params = plantId ? { plant: plantId } : {};
        const { data } = await api.get("/api/inventory/health/", { params });
        return data;
    },

    // Alerts
    getAlerts: async (filters?: {
        type?: string;
        severity?: string;
        resolved?: boolean;
        plant?: string;
    }): Promise<InventoryAlert[]> => {
        const { data } = await api.get("/api/inventory/alerts/", { params: filters });
        return data;
    },

    resolveAlert: async (alertId: string, note?: string): Promise<InventoryAlert> => {
        const { data } = await api.post(`/api/inventory/alerts/${alertId}/resolve/`, {
            resolution_note: note || ''
        });
        return data;
    },

    runAudit: async (plantId?: string): Promise<{ total_alerts: number;[key: string]: number }> => {
        const { data } = await api.post("/api/inventory/alerts/run_audit/", {
            plant_id: plantId
        });
        return data;
    },

    // Snapshots
    getSnapshots: async (
        plantId?: string,
        options?: {
            limit?: number;
            days?: number;
        }
    ): Promise<InventorySnapshot[]> => {
        const params: Record<string, string | number> = {};
        if (plantId) params.plant = plantId;
        if (options?.limit) params.limit = options.limit;
        if (options?.days) params.days = options.days;
        const { data } = await api.get("/api/inventory/snapshots/", { params });
        return data;
    },

    createSnapshot: async (plantId: string): Promise<InventorySnapshot> => {
        const { data } = await api.post("/api/inventory/snapshots/create_now/", {
            plant_id: plantId
        });
        return data;
    },

    // Roll Genealogy
    getRollGenealogy: async (rollId: string): Promise<RollGenealogy> => {
        const { data } = await api.get(`/api/inventory/rolls/${rollId}/genealogy/`);
        return data;
    },

    // Roll Trace Lookup (UUID or label)
    getRollTrace: async (query: string): Promise<RollTraceResponse> => {
        const { data } = await api.get('/api/inventory/roll-trace/', { params: { q: query } });
        return data;
    },
};

export default observabilityApi;
