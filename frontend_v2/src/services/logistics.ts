import { api } from '@/lib/api';

function normalizeListPayload<T = any>(payload: any): T[] {
    if (Array.isArray(payload)) return payload as T[];
    if (Array.isArray(payload?.results)) return payload.results as T[];
    if (Array.isArray(payload?.items)) return payload.items as T[];
    if (Array.isArray(payload?.data)) return payload.data as T[];
    return [];
}

export interface FGBatch {
    id: string;
    batch_number: string;
    so_number: string;
    customer: string;
    qty_pcs: number;
    qty_kg: number | null;
    original_qty: number;
    produced: number;
    packed: number;
    remaining: number;
    product: string;
    template__name: string;
    location__name: string;
    status: string;
    primary_pack_enabled?: boolean;
    pcs_per_pack?: number | null;
    default_content_mode?: 'LOOSE_POUCHES' | 'PRIMARY_PACKS' | string;
}

export interface Gonny {
    id: string;
    label_id: string;
    qty_pcs: number;
    content_mode?: 'LOOSE_POUCHES' | 'PRIMARY_PACKS' | string;
    primary_pack_count?: number | null;
    weight_kg: number | null;
    net_product_weight_kg?: number | null;
    inner_pack_tare_kg?: number | null;
    secondary_pack_tare_kg?: number | null;
    extras_tare_kg?: number | null;
    expected_gross_weight_kg?: number | null;
    gross_weight_kg?: number | null;
    gross_variance_kg?: number | null;
    gross_variance_pct?: number | null;
    gross_variance_reason?: string;
    tare_breakdown_json?: Record<string, any> | null;
    status: string;
    released_to_dispatch?: boolean;
    fg_batch__batch_number?: string;
    batch_no?: string;
    location: {
        id: string;
        name: string;
        plant_id: string;
        plant_name: string;
    };
}

export interface DispatchableRoll {
    id: string;
    sales_order_item_id?: string | null;
    label_id: string;
    batch_no?: string;
    weight_kg: number;
    width_mm: number;
    packed_for_dispatch?: boolean;
    dispatch_lineage?: 'MTO' | 'STOCK_CLAIM' | string;
    source_stock_order_id?: string | null;
    source_stock_order_no?: string | null;
    remaining_stock_pool_kg?: number;
    split_parent_label?: string | null;
    roll_pack_enabled?: boolean;
    default_pack_lines?: Array<{ material_id: string; qty: number; uom?: string; basis?: string }>;
    released_to_dispatch?: boolean;
    release_mode?: 'PACKED' | 'UNPACKED' | string;
    material__name: string;
    location: {
        id: string;
        name: string;
        plant_id: string;
        plant_name: string;
    };
}

export interface DeliveryChallan {
    id: string;
    dc_no: string;
    customer_name: string;
    status: string;
    vehicle_no: string;
    driver_name?: string;
    driver_phone?: string;
    transporter_name?: string;
    lr_number?: string;
    e_way_bill_number?: string;
    dispatch_notes?: string;
    ship_to_address_snapshot?: Record<string, any>;
    dispatch_date: string | null;
    plant__name: string;
    sales_order__order_number: string | null;
}

export interface PackingBoardSnapshot {
    totals: Record<string, number>;
    orders: Array<{
        sales_order: PackingSalesOrderRow;
        pending: SOPackingSummary["packing_pending"];
        ready_for_dispatch: SOPackingSummary["ready_for_dispatch"];
    }>;
}

export interface DispatchBoardSnapshot {
    totals: Record<string, number>;
    orders: Array<{
        sales_order: SODispatchSummary["sales_order"];
        available_for_dispatch: SODispatchSummary["available_for_dispatch"];
        packing_pending?: SODispatchSummary["packing_pending"];
        dispatched_qty?: SODispatchSummary["dispatched_qty"];
    }>;
}

export interface SODispatchSummary {
    sales_order: {
        id: string;
        order_number: string;
        customer_name: string;
        status: string;
    };
    ordered_qty: number;
    produced_qty: {
        rolls_kg: number;
        batches_pcs: number;
    };
    packed_qty: number;
    dispatched_qty: {
        rolls_kg: number;
        gonnies_pcs: number;
    };
    available_for_dispatch: {
        rolls_count: number;
        rolls_kg: number;
        gonnies_count: number;
        gonnies_pcs: number;
        gonnies_net_kg?: number;
        gonnies_gross_kg?: number;
    };
    packing_pending?: {
        open_gonnies_count: number;
        open_gonnies_pcs: number;
        unpacked_batch_count?: number;
        unpacked_batch_pcs?: number;
        unreleased_rolls_count?: number;
        unreleased_sealed_gonnies_count?: number;
    };
    batches?: Array<{
        id: string;
        batch_number: string;
        qty_pcs: number;
        qty_kg: number;
        status: string;
        location: {
            id: string | null;
            name: string | null;
            plant_id: string | null;
            plant_name: string | null;
        };
    }>;
    rolls: DispatchableRoll[];
    gonnies: Gonny[];
}

export interface PackingSalesOrderRow {
    id: string;
    order_number: string;
    customer_name: string;
    status: string;
}

export interface SOPackingSummary {
    sales_order: {
        id: string;
        order_number: string;
        customer_name: string;
        status: string;
    };
    ordered_qty: number;
    packing_pending: {
        rolls_count: number;
        batches_count: number;
        batches_pcs: number;
        open_gonnies_count: number;
        sealed_gonnies_count: number;
    };
    ready_for_dispatch: {
        rolls_count: number;
        rolls_kg: number;
        gonnies_count: number;
        gonnies_pcs: number;
        gonnies_net_kg: number;
        gonnies_gross_kg: number;
    };
    rolls: DispatchableRoll[];
    batches: Array<{
        id: string;
        batch_number: string;
        qty_pcs: number;
        qty_kg: number;
        status: string;
        template_name?: string | null;
        location: {
            id: string | null;
            name: string | null;
            plant_id: string | null;
            plant_name: string | null;
        };
    }>;
    gonnies: Gonny[];
}

export const logisticsService = {
    // Packing
    async getPackingOrders(): Promise<PackingSalesOrderRow[]> {
        const response = await api.get('/api/production/packing/orders/');
        return normalizeListPayload<any>(response.data).map((row) => ({
            id: String(row?.id || ''),
            order_number: String(row?.order_number || ''),
            customer_name: String(row?.customer_name || ''),
            status: String(row?.status || ''),
        })).filter((row) => row.id);
    },

    async getPackingBoard(): Promise<PackingBoardSnapshot> {
        const response = await api.get('/api/production/packing/yard-snapshot/');
        return response.data as PackingBoardSnapshot;
    },

    async getSOPackingSummary(salesOrderId: string): Promise<SOPackingSummary> {
        const response = await api.get('/api/production/packing/so_summary/', {
            params: { sales_order_id: salesOrderId },
        });
        return (response.data?.data || response.data) as SOPackingSummary;
    },

    async getAvailableBatches(plantId?: string): Promise<FGBatch[]> {
        const params = plantId ? { plant_id: plantId } : {};
        const response = await api.get('/api/production/packing/batches/', { params });
        return normalizeListPayload<FGBatch>(response.data);
    },

    async getGonnies(plantId?: string, status?: string): Promise<Gonny[]> {
        const params: Record<string, string> = {};
        if (plantId) params.plant_id = plantId;
        if (status) params.status = status;
        const response = await api.get('/api/production/packing/gonnies/', { params });
        return normalizeListPayload<Gonny>(response.data);
    },

    async createGonny(data: {
        fgBatchId: string;
        qtyPcs: number;
        gonnyMaterialId?: string;
        locationId?: string;
        contentMode?: 'LOOSE_POUCHES' | 'PRIMARY_PACKS';
        primaryPackCount?: number;
    }): Promise<{ id: string; label_id: string; message: string }> {
        const response = await api.post('/api/production/packing/create_gonny/', {
            fg_batch_id: data.fgBatchId,
            qty_pcs: data.qtyPcs,
            gonny_material_id: data.gonnyMaterialId,
            location_id: data.locationId,
            content_mode: data.contentMode,
            primary_pack_count: data.primaryPackCount,
        });
        return response.data;
    },

    async sealGonny(
        gonnyId: string,
        weightKg: number,
        extras: Array<{ material_id: string; qty: number; uom?: string; basis?: string }> = [],
        varianceReason = "",
    ): Promise<{ id: string; label_id: string; message: string }> {
        const response = await api.post(`/api/production/packing/${gonnyId}/seal/`, {
            weight_kg: weightKg,
            extras,
            gross_variance_reason: varianceReason,
        });
        return response.data;
    },

    async releaseGonny(gonnyId: string): Promise<{ id: string; label_id: string; message: string }> {
        const response = await api.post(`/api/production/packing/${gonnyId}/release/`);
        return response.data;
    },

    async releaseRoll(
        rollId: string,
        releaseMode: 'PACKED' | 'UNPACKED',
        lines: Array<{ material_id: string; qty: number; uom?: string; basis?: string }> = [],
    ) {
        const response = await api.post('/api/production/packing/release-roll/', {
            roll_id: rollId,
            release_mode: releaseMode,
            lines,
        });
        return response.data as {
            id: string
            roll_id: string
            sales_order_item_id: string
            packed_at: string
            lines: Array<{ material_id: string; qty: number; uom: string; basis: string; tx_id?: string }>
            tx_ids: string[]
            released_to_dispatch: boolean
            release_mode: 'PACKED' | 'UNPACKED'
            message: string
        }
    },

    // Dispatch
    async getSalesOrdersWithFG(): Promise<{ id: string; order_number: string; customer_name: string; status: string }[]> {
        const response = await api.get('/api/production/challans/so_with_fg/');
        return normalizeListPayload<any>(response.data).map((row) => ({
            id: String(row?.id || ''),
            order_number: String(row?.order_number || ''),
            customer_name: String(row?.customer_name || ''),
            status: String(row?.status || ''),
        })).filter((row) => row.id);
    },

    async getDispatchBoard(): Promise<DispatchBoardSnapshot> {
        const response = await api.get('/api/production/challans/board/');
        return response.data as DispatchBoardSnapshot;
    },

    async getSODispatchableItems(salesOrderId: string): Promise<SODispatchSummary> {
        const response = await api.get('/api/production/challans/get_so_dispatchable_items/', {
            params: { sales_order_id: salesOrderId }
        });
        return (response.data?.data || response.data) as SODispatchSummary;
    },

    async getChallans(plantId?: string, status?: string): Promise<DeliveryChallan[]> {
        const params: Record<string, string> = {};
        if (plantId) params.plant_id = plantId;
        if (status) params.status = status;
        const response = await api.get('/api/production/challans/list_challans/', { params });
        return normalizeListPayload<any>(response.data).map((row) => ({
            ...row,
            plant__name: row?.plant__name || row?.plant_name || '',
            sales_order__order_number: row?.sales_order__order_number || row?.so_number || '',
        })) as DeliveryChallan[];
    },

    async createChallan(data: {
        customer_name: string;
        plant_id: string;
        sales_order_id?: string;
        vehicle_no?: string;
        driver_name?: string;
        driver_phone?: string;
        transporter_name?: string;
        lr_number?: string;
        e_way_bill_number?: string;
        dispatch_notes?: string;
        ship_to_address_snapshot?: Record<string, any>;
        roll_ids?: string[];
        gonny_ids?: string[];
    }): Promise<{ id: string; dc_no: string; message: string }> {
        const response = await api.post('/api/production/challans/create_challan/', data);
        return response.data;
    },

    async packRoll(rollId: string, lines: Array<{ material_id: string; qty: number; uom?: string; basis?: string }> = []) {
        const response = await api.post('/api/production/challans/pack_roll/', {
            roll_id: rollId,
            lines,
        })
        return response.data as {
            id: string
            roll_id: string
            sales_order_item_id: string
            packed_at: string
            lines: Array<{ material_id: string; qty: number; uom: string; basis: string; tx_id?: string }>
            tx_ids: string[]
            packed_for_dispatch: boolean
        }
    },

    async dispatchChallan(challanId: string): Promise<{ dc_no: string; status: string; message: string }> {
        const response = await api.post(`/api/production/challans/${challanId}/dispatch/`);
        return response.data;
    },

    async updateChallanStatus(challanId: string, status: string): Promise<{ dc_no: string; status: string; message: string }> {
        const response = await api.post(`/api/production/challans/${challanId}/update_status/`, { status });
        return response.data;
    },

    async markReceived(challanId: string): Promise<{ dc_no: string; status: string; message: string }> {
        const response = await api.post(`/api/production/challans/${challanId}/mark_received/`);
        return response.data;
    },

    async getChallanDetail(challanId: string): Promise<{
        id: string;
        dc_no: string;
        customer_name: string;
        status: string;
        vehicle_no: string;
        driver_name: string;
        driver_phone: string;
        transporter_name?: string;
        lr_number?: string;
        e_way_bill_number?: string;
        dispatch_notes?: string;
        ship_to_address_snapshot?: Record<string, any>;
        dispatch_date: string | null;
        items: {
            id: string;
            type: string;
            label: string;
            weight_kg: number;
            qty_pcs: number | null;
            net_product_weight_kg?: number | null;
            gross_weight_kg?: number | null;
            expected_gross_weight_kg?: number | null;
            gross_variance_kg?: number | null;
            gross_variance_pct?: number | null;
            gross_variance_reason?: string;
            content_mode?: string | null;
            primary_pack_count?: number | null;
        }[];
        total_weight_kg: number;
        total_pcs: number;
        total_net_product_weight_kg?: number;
        total_gross_weight_kg?: number;
    }> {
        const response = await api.get(`/api/production/challans/${challanId}/detail/`);
        return response.data;
    },

    getChallanPrintUrl(challanId: string): string {
        return `/api/production/challans/${challanId}/print-list/`;
    }
};
